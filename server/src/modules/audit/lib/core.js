// Funzioni comuni del modulo Audit SGI: impostazioni, modelli (seed dai JSON in data/), lettura degli audit con i punteggi,
// creazione, salvataggio, passaggi di stato, eliminazione (cestino), allegati. Nei log della Suite solo id e conteggi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, one, many, tx } from '../db.js';
import { KEY, SETTINGS_DEFAULT, STRUCTURE_KINDS, INTERNAL_ORG_KINDS, KINDS, STATUS_LABEL } from '../config.js';
import { bad, notFound, forbidden } from '../../../lib/util.js';
import { notify } from '../../../lib/community.js';
import { storeBuffer, dropBlobs } from '../../../lib/moduleStorage.js';
import { scoreAudit, effectiveScore, levelLetter, monthStart, validateTemplate } from './scoring.js';
import { isAuditor, isQualita, isAdmin, isSite, isManagerOf, canSeeSite, limitedToSites, mySiteIds } from './access.js';

export { KEY, KINDS, STATUS_LABEL };
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const idOf = (v, msg = 'Elemento non trovato') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw notFound(msg); return n; };

// ---- Impostazioni
export async function settings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const out = { ...SETTINGS_DEFAULT };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setSetting(key, value, userId) {
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), userId || null]);
}

// ---- Modelli: seed dei due JSON in data/ (una volta sola per code+rev), ultimo attivo per kind
let seeded = false;
export async function ensureTemplates() {
  if (seeded) return;
  for (const [file, kind] of [['checklist_sede.json', 'SEDE'], ['checklist_legal_entity.json', 'LEGAL_ENTITY']]) {
    const body = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    const errs = validateTemplate(body);
    if (errs.length) { console.error(`[audit] modello ${file} non valido: ${errs.join('; ')}`); continue; }
    const ex = await one('SELECT id FROM templates WHERE code=$1 AND rev=$2', [body.code, String(body.rev)]);
    if (!ex) {
      const altri = await one('SELECT 1 FROM templates WHERE kind=$1 AND active', [kind]);
      await q('INSERT INTO templates (code, title, rev, rev_date, kind, body, active) VALUES ($1,$2,$3,$4,$5,$6,$7)', [body.code, body.title, String(body.rev), body.rev_date || null, kind, JSON.stringify(body), !altri]);
    }
  }
  seeded = true;
}
export async function templateAttivo(kind) {
  return one('SELECT * FROM templates WHERE kind=$1 AND active ORDER BY id DESC LIMIT 1', [kind]);
}
export async function templateById(id) {
  const t = await one('SELECT * FROM templates WHERE id=$1', [id]);
  if (!t) throw notFound('Modello non trovato');
  return t;
}

// ---- Sedi e partner
export const SITE_COLS = `s.id, s.code, s.name, s.short_name, s.kind, s.city, s.province, s.address, s.manager_name, s.manager_email, s.manager_person_id, s.active, s.organization_id, s.opened_at, s.in_esercizio`;
export async function siteById(id) {
  const s = await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Sede non trovata');
  return s;
}
export const isStructure = (site) => STRUCTURE_KINDS.includes(site.kind);
// Sede in esercizio nel mese: attiva e aperta (opened_at nulla o entro la fine del mese). Una sede che apre in futuro (es. COR dal
// 2 gennaio 2027) non ha auto-audit, alert né conteggi finché non apre.
export const inEsercizio = (site, period) => {
  if (!site?.active) return false;
  if (!site.opened_at) return true;
  const p = period ? new Date(period) : new Date(); const fine = new Date(p.getFullYear(), p.getMonth() + 1, 0);
  return new Date(site.opened_at) <= fine;
};
export async function orgById(id) {
  const o = await one(`SELECT id, kind, code, name, vat_number, city, province, active FROM public.organizations WHERE id=$1`, [id]);
  if (!o) throw notFound('Legal entity non trovata');
  if (INTERNAL_ORG_KINDS.includes(o.kind)) throw bad('Le società del gruppo non si auditano come partner: sono sedi di Toscana Diagnostica');
  return o;
}

// Sedi gestite dall'utente: ambito SITE del grant + sedi di cui è manager_email (organigramma)
export async function managedSites(suiteUser) {
  const ids = new Set((suiteUser.grants?.[KEY]?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id)));
  const rows = await many('SELECT id FROM sites_v WHERE lower(manager_email)=lower($1)', [suiteUser.email]);
  for (const r of rows) ids.add(r.id);
  return [...ids];
}

// ---- Lettura degli audit
export const A_COLS = `a.id, a.kind, a.site_id, a.organization_id, a.template_id, a.period, a.status, a.conducted_by, a.conducted_at, a.verified_by, a.verified_at,
  a.header, a.ncs, a.observations, a.report, a.score, a.score_verifier, a.score_by_section, a.third_party - 'sintesi_testo' AS third_party, a.created_at, a.updated_at,
  s.name AS site_name, s.code AS site_code, s.kind AS site_kind, s.city AS site_city, o.name AS org_name, o.kind AS org_kind,
  cu.full_name AS conducted_by_name, vu.full_name AS verified_by_name, t.code AS template_code, t.rev AS template_rev, t.title AS template_title,
  (SELECT count(*)::int FROM audit_files f WHERE f.audit_id=a.id) AS n_files,
  (a.third_party->>'sintesi_testo' IS NOT NULL AND length(a.third_party->>'sintesi_testo') > 0) AS has_text`;
export const A_FROM = `audits a LEFT JOIN public.sites s ON s.id=a.site_id LEFT JOIN public.organizations o ON o.id=a.organization_id
  LEFT JOIN users cu ON cu.id=a.conducted_by LEFT JOIN users vu ON vu.id=a.verified_by LEFT JOIN templates t ON t.id=a.template_id`;

// Campi calcolati sulla riga: punteggio che fa fede, livello, numero di NC
export function decorate(a) {
  const eff = effectiveScore(a);
  const ncs = Array.isArray(a.ncs) ? a.ncs.filter((n) => n && (n.descrizione || n.n)) : [];
  const ncCount = Object.values(a.score_by_section || {}).reduce((n, s) => n + (eff.source === 'VERIFICA' && s.nc_verifier != null ? s.nc_verifier : (s.nc || 0)), 0);
  return { ...a, score: a.score == null ? null : Number(a.score), score_verifier: a.score_verifier == null ? null : Number(a.score_verifier), effective_score: eff.score, score_source: eff.source, score_delta: eff.delta,
    level: a.kind === 'TERZI' ? null : levelLetter(eff.score), n_nc: Math.max(ncs.length, ncCount), kind_label: KINDS[a.kind] || a.kind, status_label: STATUS_LABEL[a.status] || a.status, subject: a.kind === 'LEGAL_ENTITY' ? a.org_name : a.site_name };
}

export async function loadAudit(id, { withAnswers = true } = {}) {
  const a = await one(`SELECT ${A_COLS}${withAnswers ? ', a.answers, a.verifier_answers' : ''} FROM ${A_FROM} WHERE a.id=$1 AND a.deleted_at IS NULL`, [id]);
  if (!a) throw notFound('Audit non trovato');
  a.files = await many('SELECT id, filename, mime, size, label, uploaded_by, created_at FROM audit_files WHERE audit_id=$1 ORDER BY id', [id]);
  if (a.template_id) { const t = await one('SELECT id, code, title, rev, rev_date, kind, body FROM templates WHERE id=$1', [a.template_id]); a.template = t; }
  return decorate(a);
}

// Chi può vedere un audit: SITE solo quelli delle proprie sedi
export function assertCanSee(req, a) {
  if (limitedToSites(req)) {
    if (a.kind === 'LEGAL_ENTITY' || !canSeeSite(req, a.site_id)) throw forbidden('Audit di un\'altra sede');
  }
}
// Chi può compilare la colonna principale: AUTO in BOZZA → site manager della sede o auditor; INTERNO/LEGAL_ENTITY in BOZZA → auditor
export function canEditAnswers(req, a) {
  if (a.status !== 'BOZZA') return false;
  if (a.kind === 'AUTO') return isManagerOf(req, a.site_id) || isAuditor(req);
  return isAuditor(req);
}
// Colonna del verificatore: solo AUTO in INVIATO (o VERIFICATO per correzioni di Qualità), solo auditor
export const canVerify = (req, a) => a.kind === 'AUTO' && isAuditor(req) && (a.status === 'INVIATO' || (a.status === 'VERIFICATO' && isQualita(req)));
// Cestino: CHIUSO/VERIFICATO solo QUALITA/ADMIN; SITE solo le proprie BOZZE; AUDITOR gli altri stati
export function canDelete(req, a) {
  if (['CHIUSO', 'VERIFICATO'].includes(a.status)) return isQualita(req);
  if (isSite(req)) return a.kind === 'AUTO' && a.status === 'BOZZA' && isManagerOf(req, a.site_id);
  return isAuditor(req);
}

// ---- Creazione
export async function getOrCreateAuto(siteId, period, moduleUserId) {
  const site = await siteById(siteId);
  if (!isStructure(site)) throw bad('L\'auto-audit mensile riguarda le sedi struttura (punti prelievo, centri medici e diagnostici, laboratorio)');
  const p = period || monthStart(new Date());
  if (!inEsercizio(site, p)) throw bad(`La sede non è ancora in esercizio (apertura ${new Date(site.opened_at).toLocaleDateString('it-IT')}): l'auto-audit parte dal mese di apertura`);
  const ex = await one(`SELECT id FROM audits WHERE kind='AUTO' AND site_id=$1 AND period=$2 AND deleted_at IS NULL`, [siteId, p]);
  if (ex) return { id: ex.id, created: false };
  const t = await templateAttivo('SEDE');
  if (!t) throw bad('Nessun modello di checklist sede attivo');
  try {
    const row = await one(`INSERT INTO audits (kind, site_id, template_id, period, status, conducted_by, created_by, header) VALUES ('AUTO',$1,$2,$3,'BOZZA',$4,$4,$5) RETURNING id`,
      [siteId, t.id, p, moduleUserId, JSON.stringify({ sede: site.name, effettuato_da: site.manager_name || '', data: null })]);
    return { id: row.id, created: true };
  } catch (e) {
    if (e.code === '23505') { const again = await one(`SELECT id FROM audits WHERE kind='AUTO' AND site_id=$1 AND period=$2 AND deleted_at IS NULL`, [siteId, p]); return { id: again.id, created: false }; }
    throw e;
  }
}

export async function createAudit({ kind, site_id, organization_id, header }, moduleUserId, userName) {
  if (kind === 'INTERNO') {
    const site = await siteById(site_id);
    const t = await templateAttivo('SEDE');
    if (!t) throw bad('Nessun modello di checklist sede attivo');
    const row = await one(`INSERT INTO audits (kind, site_id, template_id, status, conducted_by, conducted_at, created_by, header) VALUES ('INTERNO',$1,$2,'BOZZA',$3,now(),$3,$4) RETURNING id`,
      [site_id, t.id, moduleUserId, JSON.stringify({ sede: site.name, effettuato_da: userName || '', data: new Date().toISOString().slice(0, 10), ...(header || {}) })]);
    return row.id;
  }
  if (kind === 'LEGAL_ENTITY') {
    const org = await orgById(organization_id);
    const t = await templateAttivo('LEGAL_ENTITY');
    if (!t) throw bad('Nessun modello ISO 37001 attivo');
    const row = await one(`INSERT INTO audits (kind, organization_id, template_id, status, conducted_by, conducted_at, created_by, header) VALUES ('LEGAL_ENTITY',$1,$2,'BOZZA',$3,now(),$3,$4) RETURNING id`,
      [organization_id, t.id, moduleUserId, JSON.stringify({ legal_entity: org.name, effettuato_da: userName || '', data: new Date().toISOString().slice(0, 10), ...(header || {}) })]);
    return row.id;
  }
  throw bad('Tipo di audit non previsto');
}

// ---- Salvataggio (ricalcola i punteggi)
export async function saveAudit(id, patch, { verifier = false } = {}) {
  const a = await one('SELECT a.*, t.body AS template_body FROM audits a LEFT JOIN templates t ON t.id=a.template_id WHERE a.id=$1 AND a.deleted_at IS NULL', [id]);
  if (!a) throw notFound('Audit non trovato');
  const next = { ...a };
  if (!verifier) {
    if (patch.answers) next.answers = patch.answers;
    if (patch.header) next.header = { ...(a.header || {}), ...patch.header };
    if (patch.ncs) next.ncs = patch.ncs;
    if (patch.observations !== undefined) next.observations = patch.observations;
    if (patch.report) next.report = { ...(a.report || {}), ...patch.report };
  } else {
    if (patch.verifier_answers) next.verifier_answers = patch.verifier_answers;
    if (patch.ncs) next.ncs = patch.ncs;
    if (patch.observations !== undefined) next.observations = patch.observations;
    if (patch.report) next.report = { ...(a.report || {}), ...patch.report };
  }
  const sc = a.template_body ? scoreAudit(a.template_body, next) : { score: null, score_verifier: null, by_section: {} };
  await q(`UPDATE audits SET answers=$2, verifier_answers=$3, header=$4, ncs=$5, observations=$6, report=$7, score=$8, score_verifier=$9, score_by_section=$10, updated_at=now() WHERE id=$1`,
    [id, JSON.stringify(next.answers || {}), JSON.stringify(next.verifier_answers || {}), JSON.stringify(next.header || {}), JSON.stringify(next.ncs || []), next.observations || null, JSON.stringify(next.report || {}), sc.score, sc.score_verifier, JSON.stringify(sc.by_section)]);
  return sc;
}

// ---- Passaggi di stato
export async function auditorUserIds() {
  // utenti Suite con grant audit QUALITA/AUDITOR/ADMIN confermato, più Owner e Admin della Suite
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u LEFT JOIN public.grants g ON g.user_id=u.id AND g.module_key=$1 AND NOT g.proposed
    WHERE u.status='ACTIVE' AND (u.level IN ('OWNER','ADMIN') OR g.profile IN ('QUALITA','AUDITOR','ADMIN'))`, [KEY]);
  return rows.map((r) => r.id);
}

export async function inviaAuto(id) {
  const a = await loadAudit(id, { withAnswers: true });
  if (a.kind !== 'AUTO') throw bad('Solo gli auto-audit si inviano al verificatore');
  if (a.status !== 'BOZZA') throw bad('L\'auto-audit non è in bozza');
  const sc = scoreAudit(a.template.body, a);
  if (!sc.answered) throw bad('Compila almeno una voce prima di inviare');
  await q(`UPDATE audits SET status='INVIATO', conducted_at=now(), updated_at=now() WHERE id=$1`, [id]);
  const ids = await auditorUserIds();
  await notify(ids, { kind: 'MODULO', module_key: KEY, title: `Auto-audit SGI inviato: ${a.site_name}`, body: `Mese ${a.period ? new Date(a.period).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : ''}, punteggio della sede ${sc.score ?? '-'}%. Da verificare.`, link: `/audit/miei/${id}` });
  return { id, score: sc.score, notified: ids.length };
}

export async function confermaRisposteSede(id) {
  const a = await one('SELECT answers FROM audits WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!a) throw notFound('Audit non trovato');
  const copy = {};
  for (const [k, v] of Object.entries(a.answers || {})) copy[k] = { v: v?.v || null, note: '', rev: v?.rev || '', free: v?.free || '' };
  return saveAudit(id, { verifier_answers: copy }, { verifier: true });
}

export async function chiudi(id, moduleUserId) {
  const a = await loadAudit(id);
  if (a.kind === 'AUTO') {
    if (a.status !== 'INVIATO') throw bad('Si chiude la verifica di un auto-audit inviato dalla sede');
    if (a.score_verifier == null) throw bad('Compila la colonna Verifica (o conferma le risposte della sede) prima di chiudere');
    await q(`UPDATE audits SET status='VERIFICATO', verified_by=$2, verified_at=now(), updated_at=now() WHERE id=$1`, [id, moduleUserId]);
    // avviso al site manager
    const site = await siteById(a.site_id);
    const dest = await siteManagerUserIds(site);
    await notify(dest, { kind: 'MODULO', module_key: KEY, title: `Auto-audit SGI verificato: ${site.name}`, body: `Punteggio della verifica ${a.score_verifier}% (sede ${a.score ?? '-'}%).`, link: `/audit/miei/${id}` });
    return 'VERIFICATO';
  }
  if (a.kind === 'TERZI') {
    if (a.status !== 'CARICATO') throw bad('L\'audit di terze parti è già chiuso');
    await q(`UPDATE audits SET status='CHIUSO', verified_by=$2, verified_at=now(), updated_at=now() WHERE id=$1`, [id, moduleUserId]);
    return 'CHIUSO';
  }
  if (a.status !== 'BOZZA') throw bad('L\'audit non è in bozza');
  if (!a.score && a.score !== 0) throw bad('Compila almeno una voce prima di chiudere');
  await q(`UPDATE audits SET status='CHIUSO', conducted_at=coalesce(conducted_at, now()), verified_by=$2, verified_at=now(), updated_at=now() WHERE id=$1`, [id, moduleUserId]);
  return 'CHIUSO';
}

// Riapertura (solo Qualità/Admin): torna in BOZZA (AUTO verificato torna INVIATO)
export async function riapri(id) {
  const a = await loadAudit(id);
  if (a.kind === 'TERZI') { await q(`UPDATE audits SET status='CARICATO', updated_at=now() WHERE id=$1`, [id]); return 'CARICATO'; }
  const st = a.kind === 'AUTO' && a.status === 'VERIFICATO' ? 'INVIATO' : 'BOZZA';
  await q(`UPDATE audits SET status=$2, verified_by=NULL, verified_at=NULL, updated_at=now() WHERE id=$1`, [id, st]);
  return st;
}

// Utenti Suite destinatari delle notifiche di una sede: manager_email oppure grant SITE del modulo sulla sede
export async function siteManagerUserIds(site) {
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u
    LEFT JOIN public.grants g ON g.user_id=u.id AND g.module_key=$2 AND NOT g.proposed
    LEFT JOIN public.grant_scopes gs ON gs.grant_id=g.id AND gs.scope_type='SITE' AND gs.scope_id=$1
    WHERE u.status='ACTIVE' AND (($3 <> '' AND lower(u.email)=lower($3)) OR gs.grant_id IS NOT NULL)`, [site.id, KEY, site.manager_email || '']);
  return rows.map((r) => r.id);
}

// ---- Cestino (soft delete)
export async function softDelete(id, moduleUserId) {
  await q(`UPDATE audits SET deleted_at=now(), deleted_by=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id, moduleUserId]);
}

// ---- Allegati
export async function addFile(auditId, file, label, moduleUserId) {
  const stored = await storeBuffer(KEY, 'files', `${auditId}-${Date.now()}-${file.originalname}`, file.mimetype, file.buffer);
  const row = await one(`INSERT INTO audit_files (audit_id, filename, mime, size, sha256, data, blob_path, label, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, filename, mime, size, label, created_at`,
    [auditId, String(file.originalname || 'allegato').slice(0, 200), file.mimetype || 'application/octet-stream', stored.size, stored.sha256, stored.data, stored.blob_path, label || null, moduleUserId]);
  return row;
}
export async function removeFile(fileId) {
  const f = await one('SELECT id, audit_id, blob_path FROM audit_files WHERE id=$1', [fileId]);
  if (!f) throw notFound('Allegato non trovato');
  await q('DELETE FROM audit_files WHERE id=$1', [fileId]);
  await dropBlobs(KEY, [f.blob_path]);
  return f;
}

// ---- Liste con filtri (archivio, sede, partner, miei)
export function buildFilters(req, query, params, w) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (query.kind && KINDS[query.kind]) w.push(`a.kind=${p(query.kind)}`);
  if (query.status && STATUS_LABEL[query.status]) w.push(`a.status=${p(query.status)}`);
  if (query.site_id && Number(query.site_id)) w.push(`a.site_id=${p(Number(query.site_id))}`);
  if (query.organization_id && Number(query.organization_id)) w.push(`a.organization_id=${p(Number(query.organization_id))}`);
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) w.push(`coalesce(a.conducted_at, a.created_at) >= ${p(query.from)}::date`);
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) w.push(`coalesce(a.conducted_at, a.created_at) < (${p(query.to)}::date + 1)`);
  const qs = String(query.q || '').trim();
  if (qs) { const v = p(`%${qs}%`); w.push(`(s.name ILIKE ${v} OR s.code ILIKE ${v} OR o.name ILIKE ${v} OR cu.full_name ILIKE ${v} OR a.third_party->>'ente' ILIKE ${v} OR a.observations ILIKE ${v})`); }
  if (limitedToSites(req)) { w.push(`a.kind <> 'LEGAL_ENTITY' AND a.site_id = ANY(${p(mySiteIds(req))}::int[])`); }
}
export async function listAudits(req, query, { limit = 500 } = {}) {
  const params = []; const w = ['a.deleted_at IS NULL'];
  buildFilters(req, query, params, w);
  params.push(Math.min(5000, Math.max(1, Number(query.limit) || limit)));
  const rows = await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE ${w.join(' AND ')} ORDER BY coalesce(a.conducted_at, a.created_at) DESC, a.id DESC LIMIT $${params.length}`, params);
  return rows.map(decorate);
}

export const isAdminReq = isAdmin;
