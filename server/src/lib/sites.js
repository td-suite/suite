// Funzione unica di scrittura delle sedi (correzione A0 del programma "anagrafica unica", approvato dal CEO l'08/11/2026).
// Regola di governo (docs/ANAGRAFICA.md): ogni scrittura su public.sites passa da qui. saveSite applica le regole del titolo di
// godimento (leaseBlock), scrive l'audit del core (SITE_CREATED / SITE_UPDATED con l'origine e le modifiche prima/dopo), allinea lo
// specchio di Cash (cash.site_ext), crea o aggiorna il contratto di Payments (siteToLease), crea o adotta il nodo Sede
// dell'organigramma (ensureSiteNodes), ricalcola le coordinate quando cambia l'indirizzo, riallinea i perimetri degli accessi esterni
// delle Legal entity toccate (ospitante vecchia e nuova, proprietaria dei punti SERVICE) e, alla chiusura, restituisce il quadro
// d'impatto (B17 minimo). La usano: Amministrazione > Sedi (routes/core.js), connettore e import XLSX (routes/ingest.js), Business
// (contratto PP, lib/contrattoSede.js), Ordini (Dotazione, data di apertura), Retail (Intorno, coordinate), Payments (leaseToSite).
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { bad, notFound, audit, parse, today, diff } from './util.js';
import { siteToLease, tenureIssue, normalizeLeaseFields, LEASE_SITE_KEYS } from './leaseSync.js';
import { geocodeAddress } from './geocode.js';
import { indexSite } from './search.js';
import { realignOrgPerimeters } from './esterni.js';
import { ensureSiteNodes } from '../routes/orgcat.js';
import { companyOrgId } from './company.js';

// ---------- schema (spostato da routes/core.js) ----------
const numOrNull = (v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v));
const money = z.preprocess(numOrNull, z.number().min(0).max(100_000_000).nullable().optional());
const smallInt = (max) => z.preprocess(numOrNull, z.number().int().min(0).max(max).nullable().optional());
const isoDate = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());
export const SITE_KINDS = ['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO'];
export const siteSchema = z.object({
  code: z.string().min(2).max(40), name: z.string().min(2).max(250), short_name: z.string().max(120).nullable().optional(),
  kind: z.enum(SITE_KINDS).optional(),
  organization_id: z.number().int().nullable().optional(), host_organization_id: z.preprocess((v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v)), z.number().int().nullable().optional()), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(),
  province: z.string().max(4).nullable().optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(), org_node: z.boolean().optional(), opening_hours: z.string().nullable().optional(), opening_hours_json: z.record(z.array(z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) })).max(3)).nullable().optional(), legacy_brand: z.string().nullable().optional(),
  studiolab_code: z.string().nullable().optional(), active: z.boolean().optional(), needs_review: z.boolean().optional(), sort_order: z.number().int().optional(), notes: z.string().nullable().optional(),
  opened_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),   // data di apertura della sede (letta da Cash e Retail)
  closed_at: isoDate,   // data di chiusura (B17 minimo, A1): impostata da sola alla disattivazione se non indicata
  extraurbana: z.boolean().optional(),   // sede extraurbana: raggio dell'Intorno del Retail più ampio (10 km predefiniti, docs/RETAIL_INTORNO.md)
  // Titolo di godimento e locazione (fonte unica: Payments e Facility leggono da qui, lib/leaseSync.js)
  tenure: z.enum(['PROPRIETA', 'LOCAZIONE', 'COMODATO', 'OSPITATA']).optional(),
  rent_amount: money, rent_period: z.enum(['MESE', 'TRIMESTRE', 'SEMESTRE', 'ANNO']).optional(),
  rent_vat: z.preprocess((v) => (v === '' ? null : v), z.enum(['PIU_IVA', 'ESENTE', 'IVA_INCLUSA']).nullable().optional()), rent_vat_rate: z.preprocess(numOrNull, z.number().min(0).max(100).nullable().optional()),
  lease_start: isoDate, lease_years: smallInt(99), lease_renewal_years: smallInt(99), lease_notice_months: smallInt(60), lease_end: isoDate,
  lease_landlord_org_id: z.preprocess(numOrNull, z.number().int().nullable().optional()),
  lease_registration: z.preprocess((v) => (v === '' ? null : v), z.enum(['IMPOSTA_ANNUALE', 'UNICA_SOLUZIONE', 'CEDOLARE_SECCA', 'DA_REGISTRARE']).nullable().optional()),
  guarantee_bank_amount: money, guarantee_insurance_amount: money, deposit_amount: money, guarantee_notes: z.string().max(2000).nullable().optional(),
});

// Orari strutturati → testo riassuntivo (es. "Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00"), giorni consecutivi uguali raggruppati
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; const DAY_LABEL = { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Gio', fri: 'Ven', sat: 'Sab', sun: 'Dom' };
export function hoursText(j) {
  if (!j) return null;
  const fmt = (d) => (j[d] || []).map((r) => `${r.from.replace(/^0/, '')}-${r.to.replace(/^0/, '')}`).join(', ');
  const groups = [];
  for (const d of DAYS) { const t = fmt(d); if (!t) continue; const last = groups[groups.length - 1]; if (last && last.t === t && DAYS.indexOf(last.to) === DAYS.indexOf(d) - 1) last.to = d; else groups.push({ from: d, to: d, t }); }
  return groups.map((g) => `${DAY_LABEL[g.from]}${g.from !== g.to ? `-${DAY_LABEL[g.to]}` : ''} ${g.t}`).join('; ') || null;
}
export const withHours = (b) => { if (b.opening_hours_json !== undefined) { b.opening_hours_json = b.opening_hours_json ? JSON.stringify(b.opening_hours_json) : null; if (b.opening_hours_json) b.opening_hours = hoursText(JSON.parse(b.opening_hours_json)); } return b; };

// ---------- regole del titolo di godimento (pure, provate in test/sites.test.mjs) ----------
/**
 * Applica le regole del titolo a una modifica `b` della sede `cur`: titolo proposto dalla Legal entity ospitante, coerenza titolo /
 * ospitante (errore se OSPITATA senza ospitante), ospitante ripulito quando il titolo esce da OSPITATA (A0: prima restava valorizzato,
 * controllo D03), campi della locazione ripuliti secondo il titolo, fine del primo periodo ricalcolata. Ritorna { b, errore }.
 */
export function regoleTitolo(b, cur = {}) {
  const touched = [...LEASE_SITE_KEYS, 'host_organization_id'].some((k) => b[k] !== undefined);
  if (!touched) return { b, errore: null };
  const out = { ...b };
  const merged = { ...cur, ...Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) };
  if (out.tenure === undefined) {   // titolo non indicato: segue la Legal entity ospitante
    if (out.host_organization_id && cur.host_organization_id !== out.host_organization_id) merged.tenure = 'OSPITATA';
    else if (out.host_organization_id === null && cur.tenure === 'OSPITATA') merged.tenure = 'LOCAZIONE';
    else merged.tenure = cur.tenure || (merged.host_organization_id ? 'OSPITATA' : 'LOCAZIONE');
  }
  // titolo diverso da OSPITATA: l'ospitante non ha più senso e si ripulisce (se non è stato indicato esplicitamente)
  if (merged.tenure !== 'OSPITATA' && merged.host_organization_id != null && out.host_organization_id === undefined) { merged.host_organization_id = null; out.host_organization_id = null; }
  const errore = tenureIssue(merged);
  if (errore) return { b: out, errore };
  if (out.lease_end === undefined && (out.lease_start !== undefined || out.lease_years !== undefined)) merged.lease_end = null;   // ricalcolata
  const norm = normalizeLeaseFields(merged);
  for (const k of LEASE_SITE_KEYS) if (norm[k] !== undefined && (out[k] !== undefined || norm[k] !== (cur[k] ?? null) || k === 'tenure')) out[k] = norm[k];
  return { b: out, errore: null };
}

async function leaseBlock(c, b, cur = {}) {
  const { b: out, errore } = regoleTitolo(b, cur);
  if (errore) throw bad(errore);
  if (out.lease_landlord_org_id && !(await c.query('SELECT 1 FROM organizations WHERE id=$1', [out.lease_landlord_org_id])).rows[0]) throw bad('Locatore inesistente: scegli una Legal entity dell\'anagrafica');
  if (out.host_organization_id && !(await c.query('SELECT 1 FROM organizations WHERE id=$1', [out.host_organization_id])).rows[0]) throw bad('Legal entity ospitante inesistente');
  if (out.organization_id && !(await c.query('SELECT 1 FROM organizations WHERE id=$1', [out.organization_id])).rows[0]) throw bad('Legal entity proprietaria inesistente');
  return out;
}

// Specchio di Cash (cash.site_ext.host_org_id / ownership) allineato al core: per Cash una sede è OSPITATA solo se il titolo è Ospitata.
// Cash non scrive più titolo e ospitante (A2); le colonne restano come specchio per il controllo D06 della Diagnostica.
export async function syncHostToCash(c, siteId) {
  if (!(await c.query(`SELECT to_regclass('cash.site_ext') IS NOT NULL AS ok`)).rows[0]?.ok) return 0;
  const r = await c.query(`UPDATE cash.site_ext e SET host_org_id = CASE WHEN s.tenure='OSPITATA' THEN s.host_organization_id END,
      ownership = CASE WHEN s.tenure='OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END, updated_at=now()
     FROM public.sites s WHERE s.id=e.site_id AND e.site_id=$1
       AND (e.host_org_id IS DISTINCT FROM CASE WHEN s.tenure='OSPITATA' THEN s.host_organization_id END
         OR e.ownership IS DISTINCT FROM CASE WHEN s.tenure='OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END)`, [siteId]);
  return r.rowCount;
}

const ADDRESS_KEYS = ['address', 'zip', 'city', 'province'];
const LEASE_CHANGE = ['rent_amount', 'rent_period'];
const NODE_KEYS = ['name', 'kind', 'active', 'org_node'];
const changed = (b, cur, k) => b[k] !== undefined && String(b[k] ?? '') !== String(cur?.[k] ?? '');
// Attore dell'audit: la richiesta HTTP (req.user, req.ip) oppure un id utente per i lavori interni
const attoreDi = ({ req, actorId }) => (req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null });

/**
 * Parte transazionale della scrittura: valida, applica le regole, scrive la sede e l'audit dentro il client `c`.
 * opts: { id (null = nuova), data, origine, req | actorId, extra: { manager_name?, legacy_refs? } (solo connettore), validato }.
 * Ritorna { site, prima, campi, created, effetti } dove effetti() esegue dopo il COMMIT le conseguenze fuori transazione.
 */
export async function scriviSede(c, { id = null, data = {}, origine = 'Amministrazione > Sedi', req = null, actorId = null, extra = {}, validato = false } = {}) {
  const cur = id ? (await c.query('SELECT * FROM sites WHERE id=$1 FOR UPDATE', [id])).rows[0] : null;
  if (id && !cur) throw notFound('Sede non trovata');
  let b = validato ? { ...data } : parse(id ? siteSchema.partial() : siteSchema, data);
  for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
  b = await leaseBlock(c, withHours(b), cur || {});
  // A9: vincolo applicativo "sede TD (non SERVICE) ⇒ Legal entity proprietaria": alla creazione si propone la Legal entity di TD
  // (Dati aziendali, company_org_id); toglierla a una sede TD esistente non è ammesso
  const kindFinale = b.kind ?? cur?.kind ?? 'PUNTO_PRELIEVI';
  if (kindFinale !== 'SERVICE') {
    if (!cur && b.organization_id == null) { const td = await companyOrgId(); if (td) b.organization_id = td; }
    else if (cur && b.organization_id === null && cur.organization_id != null) throw bad('Una sede di Toscana Diagnostica deve avere la Legal entity proprietaria (Dati aziendali)');
  }
  // chiusura e riapertura (B17 minimo): data di chiusura alla disattivazione, tolta alla riattivazione
  if (cur && b.active === false && cur.active && b.closed_at == null) b.closed_at = today();
  if (cur && b.active === true && !cur.active) b.closed_at = null;
  // solo le colonne che cambiano davvero (un salvataggio identico non produce audit)
  if (cur) for (const k of Object.keys(b)) if (JSON.stringify(b[k] ?? null) === JSON.stringify(cur[k] instanceof Date ? cur[k].toISOString() : cur[k] ?? null) || String(b[k] ?? '') === String(cur[k] ?? '')) delete b[k];
  const ext = {};
  if (extra.manager_name !== undefined && (!cur || String(extra.manager_name ?? '') !== String(cur.manager_name ?? ''))) ext.manager_name = extra.manager_name;
  const refs = extra.legacy_refs && Object.keys(extra.legacy_refs).length ? extra.legacy_refs : null;
  let site; let created = false;
  if (!cur) {
    const cols = [...Object.keys(b), ...Object.keys(ext)]; const vals = [...Object.values(b), ...Object.values(ext)];
    if (refs) { cols.push('legacy_refs'); vals.push(JSON.stringify(refs)); }
    site = (await c.query(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals)).rows[0];
    created = true;
  } else {
    const sets = []; const params = [cur.id];
    for (const [k, v] of Object.entries({ ...b, ...ext })) { params.push(v); sets.push(`${k}=$${params.length}`); }
    const refsNew = refs && Object.entries(refs).some(([k, v]) => String(cur.legacy_refs?.[k] ?? '') !== String(v));
    if (refsNew) { params.push(JSON.stringify(refs)); sets.push(`legacy_refs = legacy_refs || $${params.length}::jsonb`); }
    if (!sets.length) return { site: cur, prima: cur, campi: {}, created: false, effetti: async () => ({}) };
    site = (await c.query(`UPDATE sites SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params)).rows[0];
  }
  const campi = { ...b, ...ext };
  const titoloCambiato = created || ['tenure', 'host_organization_id'].some((k) => b[k] !== undefined);
  if (titoloCambiato) await syncHostToCash(c, site.id);
  const modifiche = cur ? diff(cur, site, Object.keys(campi)) : undefined;
  await audit(attoreDi({ req, actorId }), created ? 'SITE_CREATED' : 'SITE_UPDATED',
    { entity: 'site', entityId: site.id, label: `${site.code} ${site.name}`, data: { origine, campi, modifiche } }, c);
  const prima = cur;
  const effetti = () => effettiSede({ site, prima, campi, created, origine, req, actorId });
  return { site, prima, campi, created, effetti };
}

// Conseguenze fuori transazione (dopo il COMMIT): Payments, ricerca, coordinate, organigramma, perimetri, quadro d'impatto
async function effettiSede({ site: s, prima: cur, campi: b, created, origine, req, actorId }) {
  const out = { avvisi: [] };
  // Payments: contratto della sede creato o aggiornato dall'anagrafica (gli scatti successivi registrati in Payments restano)
  const leaseTouched = LEASE_SITE_KEYS.some((k) => b[k] !== undefined);
  const rentChanged = created || LEASE_CHANGE.some((k) => changed(b, cur, k));
  if ((created && s.tenure === 'LOCAZIONE' && s.rent_amount != null) || (!created && leaseTouched)) {
    out.lease_sync = await siteToLease(s.id, { rentChanged }).catch((e) => ({ status: 'error', reason: e.message }));
  }
  indexSite(s).catch(() => {});
  // Coordinate: ricalcolate quando cambia l'indirizzo (prima restavano quelle vecchie), completate se mancano
  const coordsGiven = b.lat !== undefined || b.lng !== undefined;
  const addrChanged = !created && ADDRESS_KEYS.some((k) => changed(b, cur, k));
  if (!coordsGiven && (s.address || s.city) && (addrChanged || s.lat == null || s.lng == null)) {
    geocodeAddress(s).then((g) => (g ? q(`UPDATE sites SET lat=$2, lng=$3, updated_at=now() WHERE id=$1 ${addrChanged ? '' : 'AND (lat IS NULL OR lng IS NULL)'}`, [s.id, g.lat, g.lng]) : null))
      .catch((e) => console.warn('[geocode]', s.id, e.message));
  }
  // Organigramma: nodo Sede creato (o adottato se esiste un nodo omonimo senza sede, A8) e nome allineato
  if (created || NODE_KEYS.some((k) => b[k] !== undefined)) await ensureSiteNodes().catch((e) => out.avvisi.push(`Organigramma: ${e.message}`));
  // Perimetri degli accessi esterni: ospitante vecchia e nuova (punti ospitati), proprietaria dei punti SERVICE (vecchia e nuova)
  const orgs = new Set();
  if (created || ['tenure', 'host_organization_id', 'active'].some((k) => b[k] !== undefined)) { if (cur?.host_organization_id) orgs.add(cur.host_organization_id); if (s.host_organization_id) orgs.add(s.host_organization_id); }
  if ((s.kind === 'SERVICE' || cur?.kind === 'SERVICE') && (created || ['organization_id', 'kind', 'active'].some((k) => b[k] !== undefined))) { if (cur?.organization_id) orgs.add(cur.organization_id); if (s.organization_id) orgs.add(s.organization_id); }
  out.perimetri = [];
  for (const orgId of orgs) {
    const ext = await one(`SELECT count(*)::int AS n FROM users u LEFT JOIN people p ON p.id=u.person_id WHERE u.is_external AND u.status IN ('ACTIVE','PENDING') AND coalesce(p.organization_id, u.organization_id)=$1`, [orgId]);
    if (!ext?.n) continue;
    const rep = await realignOrgPerimeters(orgId, { actorId }).catch((e) => ({ error: e.message }));
    out.perimetri.push({ organization_id: orgId, users: rep.users ?? 0, changed: rep.changed ?? 0, error: rep.error });
    if (rep.changed || rep.error) await audit(attoreDi({ req, actorId }), 'EXTERNAL_PERIMETERS_REALIGNED', { entity: 'organization', entityId: orgId, label: `Sede ${s.code}: perimetri degli accessi esterni ricalcolati (${origine})`, data: { site_id: s.id, changed: rep.changed ?? null, error: rep.error } });
  }
  // Chiusura: quadro d'impatto (cosa resta collegato alla sede disattivata)
  if (cur && cur.active && b.active === false) out.impatto = await impattoChiusura(s.id);
  return out;
}

/** Quadro d'impatto della chiusura di una sede (B17 minimo): cosa resta collegato. Solo conteggi, nessuna modifica. */
export async function impattoChiusura(siteId) {
  const has = async (t) => Boolean((await one(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t]))?.ok);
  const n = async (sql, p = [siteId]) => (await one(sql, p).catch(() => null))?.n ?? null;
  const out = {
    persone_attive: await n(`SELECT count(*)::int AS n FROM people WHERE site_id=$1 AND status='ATTIVO'`),
    utenti_attivi: await n(`SELECT count(*)::int AS n FROM users WHERE site_id=$1 AND status='ACTIVE'`),
    perimetri: await n(`SELECT count(*)::int AS n FROM grant_scopes WHERE scope_type='SITE' AND scope_id=$1`),
    nodo_organigramma: await n(`SELECT count(*)::int AS n FROM org_units WHERE kind='SEDE' AND site_id=$1 AND active`),
  };
  if (await has('business.accounts')) out.account_pp = await n(`SELECT count(*)::int AS n FROM business.accounts WHERE pp_site_id=$1`);
  if (await has('business.contracts')) out.contratti_pp_vigenti = await n(`SELECT count(*)::int AS n FROM business.contracts WHERE site_id=$1 AND kind='PP' AND status IN ('FIRMATO','AUTORIZZATO','ATTIVO')`);
  if (await has('finance.lease_contracts')) out.contratti_payments_attivi = await n(`SELECT count(*)::int AS n FROM finance.lease_contracts WHERE site_id=$1 AND active`);
  const voci = [];
  if (out.contratti_payments_attivi) voci.push(`${out.contratti_payments_attivi} contratto di locazione attivo in Payments (le scadenze continuano: chiudilo nello Scadenziario strutture)`);
  if (out.persone_attive) voci.push(`${out.persone_attive} persone attive con questa sede di lavoro`);
  if (out.utenti_attivi) voci.push(`${out.utenti_attivi} utenti attivi con questa sede`);
  if (out.perimetri) voci.push(`${out.perimetri} ambiti di accesso sulla sede`);
  if (out.nodo_organigramma) voci.push('nodo Sede ancora attivo nell\'organigramma');
  if (out.account_pp) voci.push(`${out.account_pp} account Punti Prelievo del Business Hub collegati`);
  if (out.contratti_pp_vigenti) voci.push(`${out.contratti_pp_vigenti} contratti PP ancora vigenti`);
  return { ...out, voci };
}

/**
 * Scrittura completa di una sede (transazione + conseguenze). Ritorna la sede con lease_sync, perimetri, impatto, avvisi.
 * Esempio: await saveSite({ id: 12, data: { tenure: 'OSPITATA', host_organization_id: 7 }, origine: 'Business Hub, firma contratto PP', req })
 */
export async function saveSite(opts) {
  const r = await tx((c) => scriviSede(c, opts));
  const eff = await r.effetti();
  return { ...r.site, created: r.created, modificato: r.created || Object.keys(r.campi).length > 0, ...eff };
}

/** Sedi lette per gli altri moduli (comodità) */
export const getSite = (id) => one('SELECT * FROM sites WHERE id=$1', [id]);
export const listSites = (where = 'TRUE', params = []) => many(`SELECT * FROM sites WHERE ${where} ORDER BY lower(name)`, params);
