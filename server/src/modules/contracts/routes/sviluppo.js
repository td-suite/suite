// Gestione del Personale, v0.77.0 (richiesta del CEO del 16/11/2026): formazione aziendale e crediti ECM, tirocinio, medicina del lavoro.
// Accessi:
// - formazione, ECM e tirocinio: lettura a chi vede la scheda (ADMIN, HR, VIEWER), scrittura ad ADMIN e HR;
// - medicina del lavoro: solo ADMIN, HR e il titolare (il giudizio di idoneità è un dato relativo alla salute: VIEWER non lo vede);
//   le convocazioni le fanno gli amministratori del modulo (profilo ADMIN, quindi anche il titolare);
// - profilo LP: nessuna di queste route è nell'elenco chiuso di lib/access.js, quindi rispondono tutte 403.
// Ogni lettura della sezione di medicina del lavoro è registrata nel read_log della Suite; ogni scrittura nell'audit del modulo.
import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse, HttpError } from '../lib/util.js';
import { requireWrite, requireRole, readLog } from '../lib/access.js';
import { config } from '../config.js';
import { getSettings } from '../lib/payroll.js';
import { TIPI_FORMAZIONE, RINNOVO_MESI, statoEcm, personePerEcm, ecmRegole, soggettoEcm, contatoreEcm, leggiAttestato } from '../lib/formazione.js';
import { GIUDIZI, TIPI_VISITA, STATI_VISITA, soggettiMdl, elencoMdl, convoca } from '../lib/mdl.js';
import { sendFromPeople } from '../lib/peopleMail.js';
import { layout } from '../../../lib/mailer.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const opt = (s) => z.preprocess((v) => (v === '' || v === 'null' || v === 'undefined' || v === undefined ? null : v), s.nullable());
const optDate = () => opt(z.string().regex(dateRe, 'data non valida (AAAA-MM-GG)'));
const optNum = (max = 100000) => z.preprocess((v) => (v === '' || v == null || v === 'null' ? null : Number(String(v).replace(',', '.'))), z.number().min(0).max(max).nullable());
const bool = () => z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());
const optBool = () => z.preprocess((v) => (v === '' || v == null || v === 'null' ? null : v === true || v === 'true' || v === '1'), z.boolean().nullable());
const nomeFile = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const itDate = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10).split('-').reverse().join('/') : '');

async function persona(id) {
  const [p] = await personePerEcm(id);
  if (!p) throw notFound('Persona non trovata');
  return p;
}
/** Salva un file nel dossier della persona senza scadenza propria: la scadenza la porta la riga di formazione o la visita. */
async function allega(c, { id, file, category, issued_at, notes, userId }) {
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const row = (await c.query(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, sha256, issued_at, expires_at, signed, notes, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,FALSE,$9,$10) RETURNING id`, [id, category, nomeFile(file), file.mimetype, file.size, file.buffer, sha, issued_at || null, notes || null, userId])).rows[0];
  return row.id;
}

// ================================================================ FORMAZIONE ED ECM
const corsoSchema = z.object({
  tipo: z.string().refine((v) => Boolean(TIPI_FORMAZIONE[v]), 'tipo di formazione non valido').default('AZIENDALE'),
  titolo: z.string().trim().min(2, 'titolo mancante').max(300),
  ente: opt(z.string().trim().max(200)),
  stato: z.enum(['PROGRAMMATA', 'SVOLTA']).default('SVOLTA'),
  data: optDate(), data_prevista: optDate(), scadenza: optDate(),
  ore: optNum(2000), crediti_ecm: optNum(500),
  obbligatoria: bool().default(false),
  codice_evento: opt(z.string().trim().max(60)),
  note: opt(z.string().trim().max(2000)),
});
function controllaCorso(d) {
  if (d.stato === 'SVOLTA' && !d.data) throw bad('Per un corso svolto serve la data di conseguimento');
  if (d.stato === 'PROGRAMMATA' && !d.data_prevista) throw bad('Per un corso programmato serve la data prevista');
  if (d.stato === 'PROGRAMMATA' && Number(d.crediti_ecm) > 0) throw bad('I crediti ECM si registrano quando il corso è svolto: un corso programmato non riduce il contatore');
  if (d.scadenza && d.data && d.scadenza < d.data) throw bad('La scadenza non può precedere la data del corso');
}

r.get('/resources/:id/formazione', ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const corsi = await many(`SELECT f.id, f.tipo, f.titolo, f.ente, f.stato, f.data, f.data_prevista, f.ore, f.crediti_ecm, f.scadenza, f.obbligatoria, f.codice_evento, f.attachment_id, f.fonte, f.note, f.created_at,
      a.filename AS attachment_name, u.full_name AS created_by_name
    FROM formazione f LEFT JOIN attachments a ON a.id=f.attachment_id LEFT JOIN users u ON u.id=f.created_by WHERE f.resource_id=$1 ORDER BY coalesce(f.data, f.data_prevista) DESC NULLS LAST, f.id DESC`, [p.id]);
  res.json({ corsi, ecm: await statoEcm(p), tipi: TIPI_FORMAZIONE, rinnovo_mesi: RINNOVO_MESI, lettura_ai: Boolean(config.anthropicKey) });
}));

/** Legge l'attestato e propone i campi del corso: non salva nulla. */
r.post('/resources/:id/formazione/leggi', requireWrite, upload.single('file'), ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  if (!req.file) throw bad('File mancante');
  try {
    const out = await leggiAttestato({ buffer: req.file.buffer, mime: req.file.mimetype, filename: nomeFile(req.file), personName: `${p.first_name} ${p.last_name}` });
    // doppione probabile: stesso codice evento o stesso titolo nello stesso giorno
    const dup = out.titolo || out.codice_evento ? await one(`SELECT id, titolo, data FROM formazione WHERE resource_id=$1 AND ((codice_evento IS NOT NULL AND codice_evento=$2) OR (lower(titolo)=lower($3) AND data IS NOT DISTINCT FROM $4::date)) LIMIT 1`,
      [p.id, out.codice_evento, out.titolo || '', out.data]) : null;
    await audit(req, 'FORMAZIONE_LETTURA', 'resource', p.id, { filename: nomeFile(req.file), method: out.method, crediti_ecm: out.crediti_ecm });
    res.json({ ...out, doppione: dup });
  } catch (e) { throw new HttpError(e.status || 424, e.message); }
}));

r.post('/resources/:id/formazione', requireWrite, upload.single('file'), ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const d = parse(corsoSchema, req.body);
  controllaCorso(d);
  let lettura = null; try { lettura = req.body.lettura ? JSON.parse(req.body.lettura) : null; } catch { lettura = null; }
  const row = await tx(async (c) => {
    const attId = req.file ? await allega(c, { id: p.id, file: req.file, category: Number(d.crediti_ecm) > 0 || d.tipo === 'ECM' ? 'ECM' : /^SICUREZZA|PREPOSTO|DIRIGENTE_SICUREZZA|RLS|ANTINCENDIO|PRIMO_SOCCORSO/.test(d.tipo) ? 'FORMAZIONE_SICUREZZA' : 'FORMAZIONE',
      issued_at: d.data, notes: `Attestato: ${d.titolo}`.slice(0, 500), userId: req.user.id }) : null;
    const x = (await c.query(`INSERT INTO formazione (resource_id, tipo, titolo, ente, stato, data, data_prevista, ore, crediti_ecm, scadenza, obbligatoria, codice_evento, attachment_id, fonte, lettura, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [p.id, d.tipo, d.titolo, d.ente, d.stato, d.data, d.data_prevista, d.ore, d.crediti_ecm || 0, d.scadenza, d.obbligatoria, d.codice_evento, attId, lettura ? 'ATTESTATO' : 'MANUALE', lettura ? JSON.stringify(lettura) : null, d.note, req.user.id])).rows[0];
    // il primo corso con crediti attiva la posizione ECM (soggetto resta automatico): da qui il contatore genera scadenze e richiami
    if (Number(d.crediti_ecm) > 0) await c.query('INSERT INTO ecm_profili (resource_id) VALUES ($1) ON CONFLICT (resource_id) DO NOTHING', [p.id]);
    return x;
  });
  await audit(req, 'FORMAZIONE_CREATE', 'formazione', row.id, { resource_id: p.id, tipo: d.tipo, titolo: d.titolo, crediti_ecm: d.crediti_ecm || 0, attestato: Boolean(req.file) });
  res.status(201).json({ id: row.id, ecm: await statoEcm(p) });
}));

r.put('/resources/:id/formazione/:fid', requireWrite, ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const cur = await one('SELECT * FROM formazione WHERE id=$1 AND resource_id=$2', [Number(req.params.fid), p.id]);
  if (!cur) throw notFound('Corso non trovato');
  const iso = (v) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(v) : v);
  const d = parse(corsoSchema, { ...cur, data: iso(cur.data), data_prevista: iso(cur.data_prevista), scadenza: iso(cur.scadenza), ...req.body });
  controllaCorso(d);
  await q(`UPDATE formazione SET tipo=$3, titolo=$4, ente=$5, stato=$6, data=$7, data_prevista=$8, ore=$9, crediti_ecm=$10, scadenza=$11, obbligatoria=$12, codice_evento=$13, note=$14, updated_at=now() WHERE id=$1 AND resource_id=$2`,
    [cur.id, p.id, d.tipo, d.titolo, d.ente, d.stato, d.data, d.data_prevista, d.ore, d.crediti_ecm || 0, d.scadenza, d.obbligatoria, d.codice_evento, d.note]);
  if (Number(d.crediti_ecm) > 0) await q('INSERT INTO ecm_profili (resource_id) VALUES ($1) ON CONFLICT (resource_id) DO NOTHING', [p.id]);
  await audit(req, 'FORMAZIONE_UPDATE', 'formazione', cur.id, { resource_id: p.id, prima: { stato: cur.stato, crediti_ecm: Number(cur.crediti_ecm) }, dopo: { stato: d.stato, crediti_ecm: d.crediti_ecm || 0 } });
  res.json({ ok: true, ecm: await statoEcm(p) });
}));

// L'attestato resta nel dossier: si toglie da lì, se serve
r.delete('/resources/:id/formazione/:fid', requireWrite, ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const cur = await one('DELETE FROM formazione WHERE id=$1 AND resource_id=$2 RETURNING id, titolo, crediti_ecm', [Number(req.params.fid), p.id]);
  if (!cur) throw notFound('Corso non trovato');
  await audit(req, 'FORMAZIONE_DELETE', 'formazione', cur.id, { resource_id: p.id, titolo: cur.titolo, crediti_ecm: Number(cur.crediti_ecm) });
  res.json({ ok: true, ecm: await statoEcm(p) });
}));

const ecmSchema = z.object({ soggetto: optBool(), professione: opt(z.string().trim().max(120)), obbligo_triennio: optNum(1000), riduzione: optNum(1000), riduzione_motivo: opt(z.string().trim().max(300)), note: opt(z.string().trim().max(1000)) });
r.put('/resources/:id/ecm', requireWrite, ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const d = parse(ecmSchema, req.body || {});
  if (Number(d.riduzione) > 0 && !d.riduzione_motivo) throw bad('Indica il motivo della riduzione (esonero, esenzione, bonus)');
  await q(`INSERT INTO ecm_profili (resource_id, soggetto, professione, obbligo_triennio, riduzione, riduzione_motivo, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (resource_id) DO UPDATE SET soggetto=EXCLUDED.soggetto, professione=EXCLUDED.professione, obbligo_triennio=EXCLUDED.obbligo_triennio, riduzione=EXCLUDED.riduzione,
      riduzione_motivo=EXCLUDED.riduzione_motivo, note=EXCLUDED.note, updated_at=now()`, [p.id, d.soggetto, d.professione, d.obbligo_triennio, d.riduzione || 0, d.riduzione_motivo, d.note]);
  await audit(req, 'ECM_PROFILO', 'resource', p.id, d);
  res.json({ ok: true, ecm: await statoEcm(p) });
}));

/** Non considerare (o tornare a considerare) una risorsa per un anno: l'anno in corso se non indicato. Motivo obbligatorio. */
r.post('/formazione/ecm/escludi', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ id: z.coerce.number().int().positive(), anno: z.coerce.number().int().min(2020).max(2100).optional(), escludi: z.boolean().default(true), motivo: opt(z.string().trim().max(300)) }), req.body || {});
  const p = await persona(d.id);
  const anno = d.anno || Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 4));
  if (d.escludi && !d.motivo) throw bad('Indica il motivo per cui la risorsa non va considerata (per esempio maternità, lunga assenza, ingresso a fine anno)');
  await q('INSERT INTO ecm_profili (resource_id) VALUES ($1) ON CONFLICT (resource_id) DO NOTHING', [p.id]);
  if (d.escludi) await q(`UPDATE ecm_profili SET anni_esclusi = (SELECT array_agg(DISTINCT a ORDER BY a) FROM unnest(anni_esclusi || $2::int) a), esclusione_motivo=$3, updated_at=now() WHERE resource_id=$1`, [p.id, anno, d.motivo]);
  else await q(`UPDATE ecm_profili SET anni_esclusi = array_remove(anni_esclusi, $2::int), esclusione_motivo = CASE WHEN cardinality(array_remove(anni_esclusi, $2::int)) = 0 THEN NULL ELSE esclusione_motivo END, updated_at=now() WHERE resource_id=$1`, [p.id, anno]);
  await audit(req, d.escludi ? 'ECM_ESCLUDI_ANNO' : 'ECM_RICONSIDERA_ANNO', 'resource', p.id, { anno, motivo: d.motivo || null });
  res.json({ ok: true, anno, ecm: await statoEcm(p) });
}));

/** Quadro ECM: professioni sanitarie attive con il contatore del triennio. Le posizioni non attivate non generano scadenze. */
r.get('/formazione/ecm', ah(async (_req, res) => {
  const S = await getSettings(); const regole = ecmRegole(S);
  const persone = await personePerEcm();
  const ids = persone.map((x) => x.id);
  const profili = new Map((ids.length ? await many('SELECT * FROM ecm_profili WHERE resource_id = ANY($1)', [ids]) : []).map((x) => [x.resource_id, x]));
  const corsi = ids.length ? await many('SELECT resource_id, stato, data, crediti_ecm FROM formazione WHERE resource_id = ANY($1) AND crediti_ecm > 0', [ids]) : [];
  const righe = [];
  for (const p of persone) {
    const profilo = profili.get(p.id) || null; const sog = soggettoEcm(p, profilo);
    if (!sog.soggetto) continue;
    righe.push({ id: p.id, nome: `${p.last_name} ${p.first_name}`, kind: p.kind, person_kind: p.person_kind, professione: profilo?.professione || p.job_title || p.discipline || p.person_job_title || p.person_discipline || null,
      automatico: sog.automatico, attivata: Boolean(profilo), ...contatoreEcm({ regole, profilo, corsi: corsi.filter((c) => c.resource_id === p.id) }) });
  }
  righe.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  // gli indicatori contano solo le risorse considerate per l'anno in corso
  const cons = righe.filter((x) => !x.escluso_anno);
  res.json({ regole, righe, totali: { persone: cons.length, in_regola: cons.filter((x) => x.mancano_anno === 0).length, da_attivare: cons.filter((x) => !x.attivata).length, escluse: righe.length - cons.length } });
}));
r.post('/formazione/ecm/attiva', requireWrite, ah(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw bad('Nessuna persona selezionata');
  const ok = (await many('SELECT id FROM resources_v WHERE id = ANY($1)', [ids])).map((x) => x.id);
  for (const id of ok) await q('INSERT INTO ecm_profili (resource_id) VALUES ($1) ON CONFLICT (resource_id) DO NOTHING', [id]);
  await audit(req, 'ECM_ATTIVA', 'resource', null, { ids: ok });
  res.json({ ok: true, attivate: ok.length });
}));

// ================================================================ TIROCINIO
export const tirocinioSchema = z.object({
  tipo: z.enum(['CURRICULARE', 'EXTRACURRICULARE', 'PROFESSIONALIZZANTE', 'ALTRO']).default('EXTRACURRICULARE'),
  ente_promotore: opt(z.string().trim().max(200)), ente_email: opt(z.string().trim().email('email dell\'ente non valida')), tutor_ente: opt(z.string().trim().max(160)),
  convenzione_numero: opt(z.string().trim().max(60)), convenzione_data: optDate(),
  start_date: optDate(), end_date: optDate(), weekly_hours: optNum(60), indennita_mensile: optNum(10000),
  work_site_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().nullable()),
  tutor_person_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().nullable()),
  obiettivi: opt(z.string().trim().max(4000)),
  pf_stato: z.enum(['DA_RICHIEDERE', 'RICHIESTO', 'RICEVUTO', 'FIRMATO']).default('DA_RICHIEDERE'),
  pf_richiesto_il: optDate(), pf_ricevuto_il: optDate(), pf_firmato_il: optDate(),
  giudizio_esito: opt(z.enum(['POSITIVO', 'POSITIVO_CON_RISERVA', 'NEGATIVO', 'INTERROTTO'])), giudizio_data: optDate(), giudizio_note: opt(z.string().trim().max(4000)),
  notes: opt(z.string().trim().max(4000)),
});
const TIR_COLS = ['tipo', 'ente_promotore', 'ente_email', 'tutor_ente', 'convenzione_numero', 'convenzione_data', 'start_date', 'end_date', 'weekly_hours', 'indennita_mensile', 'work_site_id', 'tutor_person_id', 'obiettivi',
  'pf_stato', 'pf_richiesto_il', 'pf_ricevuto_il', 'pf_firmato_il', 'giudizio_esito', 'giudizio_data', 'giudizio_note', 'notes'];
/** Inserisce o aggiorna il tirocinio (stessa transazione della creazione della persona, se c'è). */
export async function upsertTirocinio(c, id, d, { giudizioDa = null } = {}) {
  if (d.start_date && d.end_date && d.end_date < d.start_date) throw bad('La fine del tirocinio non può precedere l\'inizio');
  if (d.tutor_person_id === id) throw bad('Il tutor aziendale non può essere il tirocinante stesso');
  if (d.tutor_person_id) {
    const t = (await c.query(`SELECT kind, status FROM resources_v WHERE id=$1`, [d.tutor_person_id])).rows[0];
    if (!t) throw bad('Tutor aziendale non trovato');
    if (t.kind === 'TIROCINANTE') throw bad('Il tutor aziendale deve essere un dipendente o un professionista, non un tirocinante');
  }
  if (d.giudizio_esito && !d.giudizio_data) throw bad('Indica la data del giudizio finale');
  const vals = TIR_COLS.map((k) => d[k] ?? null);
  await c.query(`INSERT INTO tirocini (resource_id, ${TIR_COLS.join(',')}, giudizio_da) VALUES ($1, ${TIR_COLS.map((_, i) => `$${i + 2}`).join(',')}, $${TIR_COLS.length + 2})
    ON CONFLICT (resource_id) DO UPDATE SET ${TIR_COLS.map((k) => `${k}=EXCLUDED.${k}`).join(', ')}, giudizio_da=CASE WHEN EXCLUDED.giudizio_esito IS NULL THEN NULL ELSE coalesce(tirocini.giudizio_da, EXCLUDED.giudizio_da) END, updated_at=now()`,
  [id, ...vals, d.giudizio_esito ? giudizioDa : null]);
  // la persona eredita ingresso e sede dal tirocinio, come accade con il contratto di lavoro
  await c.query(`UPDATE public.people SET hired_at = coalesce($2::date, hired_at), site_id = coalesce($3, site_id), manager_person_id = coalesce(manager_person_id, $4), updated_at = now() WHERE id=$1`, [id, d.start_date, d.work_site_id, d.tutor_person_id]);
}
async function leggiTirocinio(id) {
  return one(`SELECT t.*, ws.name AS work_site_name, tp.last_name || ' ' || tp.first_name AS tutor_name, tp.email AS tutor_email
    FROM tirocini t LEFT JOIN public.sites ws ON ws.id=t.work_site_id LEFT JOIN resources_v tp ON tp.id=t.tutor_person_id WHERE t.resource_id=$1`, [id]);
}
async function tirocinante(id) {
  const p = await one('SELECT id, kind, first_name, last_name, email FROM resources_v WHERE id=$1', [id]);
  if (!p) throw notFound('Persona non trovata');
  if (p.kind !== 'TIROCINANTE') throw bad('La persona non è un tirocinante');
  return p;
}

r.get('/resources/:id/tirocinio', ah(async (req, res) => {
  const p = await tirocinante(Number(req.params.id));
  res.json({ tirocinio: await leggiTirocinio(p.id) });
}));
r.put('/resources/:id/tirocinio', requireWrite, ah(async (req, res) => {
  const p = await tirocinante(Number(req.params.id));
  const cur = await one('SELECT * FROM tirocini WHERE resource_id=$1', [p.id]);
  const iso = (v) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(v) : v);
  const base = cur ? Object.fromEntries(TIR_COLS.map((k) => [k, iso(cur[k])])) : {};
  const d = parse(tirocinioSchema, { ...base, ...(req.body || {}) });
  const chi = (await one('SELECT person_id FROM public.users WHERE id=$1', [req.suiteUser?.id || 0]).catch(() => null))?.person_id || null;
  await tx((c) => upsertTirocinio(c, p.id, d, { giudizioDa: chi }));
  await audit(req, 'TIROCINIO_UPDATE', 'resource', p.id, { pf_stato: d.pf_stato, giudizio_esito: d.giudizio_esito, tutor_person_id: d.tutor_person_id });
  res.json({ ok: true, tirocinio: await leggiTirocinio(p.id) });
}));

/** Richiesta del progetto formativo all'ente promotore: segna la richiesta e, se chiesto, la invia dalla casella People. */
r.post('/resources/:id/tirocinio/richiedi-progetto', requireWrite, ah(async (req, res) => {
  const p = await tirocinante(Number(req.params.id));
  const t = await leggiTirocinio(p.id);
  if (!t) throw bad('Inserisci prima i dati del tirocinio');
  if (t.pf_stato === 'FIRMATO') throw bad('Il progetto formativo risulta già firmato');
  const invia = req.body?.invia === true;
  let esito = null;
  if (invia) {
    if (!t.ente_email) throw bad('Manca l\'email dell\'ente promotore: inseriscila nei dati del tirocinio oppure registra la richiesta senza invio');
    const S = await getSettings();
    const corpo = `<p>Buongiorno,</p>
      <p>in vista dell'avvio del tirocinio ${esc(t.tipo.toLowerCase())} di <b>${esc(p.first_name)} ${esc(p.last_name)}</b>${t.start_date ? `, previsto dal <b>${itDate(t.start_date)}</b>${t.end_date ? ` al <b>${itDate(t.end_date)}</b>` : ''}` : ''}, vi chiediamo di trasmetterci il <b>progetto formativo individuale</b> da sottoscrivere${t.convenzione_numero ? ` (convenzione n. ${esc(t.convenzione_numero)}${t.convenzione_data ? ` del ${itDate(t.convenzione_data)}` : ''})` : ''}.</p>
      <p>Soggetto ospitante: ${esc(S.company_name || 'Toscana Diagnostica')}${t.work_site_name ? `, sede di ${esc(t.work_site_name)}` : ''}.<br>${t.tutor_name ? `Tutor aziendale: ${esc(t.tutor_name)}${t.tutor_email ? ` (${esc(t.tutor_email)})` : ''}.<br>` : ''}${t.weekly_hours ? `Impegno previsto: ${Number(t.weekly_hours)} ore settimanali.` : ''}</p>
      <p>Potete rispondere a questa email allegando il documento.</p><p>Cordiali saluti,<br>Ufficio People · Toscana Diagnostica</p>`;
    esito = await sendFromPeople({ to: [t.ente_email], subject: `Toscana Diagnostica · richiesta del progetto formativo per il tirocinio di ${p.first_name} ${p.last_name}`, html: layout('Richiesta del progetto formativo', corpo, { footer: 'Ufficio People · Toscana Diagnostica' }),
      text: `Richiesta del progetto formativo individuale per il tirocinio di ${p.first_name} ${p.last_name}.`, ref: `contracts:tirocinio:pf:${p.id}` });
    if (esito.status === 'FALLITO') throw new HttpError(424, `Invio non riuscito: ${esito.error || 'errore della posta'}. La richiesta non è stata registrata.`);
  }
  await q(`UPDATE tirocini SET pf_stato='RICHIESTO', pf_richiesto_il=CURRENT_DATE, updated_at=now() WHERE resource_id=$1`, [p.id]);
  await audit(req, 'TIROCINIO_RICHIESTA_PF', 'resource', p.id, { invia, a: invia ? t.ente_email : null, esito: esito?.status || null });
  res.json({ ok: true, inviata: invia, esito: esito?.status || null, tirocinio: await leggiTirocinio(p.id) });
}));

// ================================================================ MEDICINA DEL LAVORO
const vedeMdl = (u) => u?.suite_level === 'OWNER' || ['ADMIN', 'HR'].includes(u?.role);
const soloMdl = (req, _res, next) => (vedeMdl(req.user) ? next() : next(forbidden('Sezione riservata all\'ufficio People (profili Amministratore e Risorse umane) e al titolare')));
const senzaClinica = (req, _res, next) => (req.body && Object.keys(req.body).some((k) => /diagnos|anamnes|refert|esit[oi]_accert|cartella/i.test(k)) ? next(bad('In Suite si registra solo il giudizio di idoneità: diagnosi, referti e cartella sanitaria restano al medico competente')) : next());

async function soggettoMdl(id) {
  const p = await one('SELECT id, kind, first_name, last_name, hired_at FROM resources_v WHERE id=$1', [id]);
  if (!p) throw notFound('Persona non trovata');
  if (!soggettiMdl.includes(p.kind)) throw bad('La sorveglianza sanitaria riguarda dipendenti e tirocinanti');
  return p;
}
const schedaSchema = z.object({ sorveglianza: bool().default(true), protocollo_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().nullable()), mansione: opt(z.string().trim().max(200)),
  rischi: opt(z.string().trim().max(1000)), periodicita_mesi: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(120).nullable()), medico_competente: opt(z.string().trim().max(160)), note: opt(z.string().trim().max(1000)) });
const visitaSchema = z.object({
  tipo: z.string().refine((v) => Boolean(TIPI_VISITA[v]), 'tipo di visita non valido').default('PERIODICA'),
  stato: z.string().refine((v) => Boolean(STATI_VISITA[v]), 'stato non valido').default('EFFETTUATA'),
  data_prevista: optDate(), ora: opt(z.string().trim().regex(/^\d{1,2}[:.]\d{2}$/, 'ora non valida (HH:MM)')), luogo: opt(z.string().trim().max(200)), medico: opt(z.string().trim().max(160)),
  data_visita: optDate(), giudizio: opt(z.string().refine((v) => Boolean(GIUDIZI[v]), 'giudizio non valido')), prescrizioni: opt(z.string().trim().max(2000)), scadenza: optDate(), note: opt(z.string().trim().max(1000)),
});
function controllaVisita(d) {
  if (d.stato === 'EFFETTUATA') {
    if (!d.data_visita) throw bad('Per una visita effettuata serve la data della visita');
    if (!d.giudizio) throw bad('Per una visita effettuata serve il giudizio di idoneità');
    if (['IDONEO_PRESCRIZIONI', 'IDONEO_LIMITAZIONI'].includes(d.giudizio) && !d.prescrizioni) throw bad('Riporta le prescrizioni o le limitazioni indicate nel giudizio');
    if (d.scadenza && d.scadenza < d.data_visita) throw bad('La prossima visita non può precedere la visita');
  } else {
    if (['PROGRAMMATA', 'CONVOCATA'].includes(d.stato) && !d.data_prevista) throw bad('Indica la data prevista della visita');
    if (d.giudizio) throw bad('Il giudizio si registra solo su una visita effettuata');
  }
}
async function quadroMdl(p) {
  const scheda = await one('SELECT * FROM mdl_schede WHERE resource_id=$1', [p.id]);
  const visite = await many(`SELECT v.id, v.tipo, v.stato, v.data_prevista, v.ora, v.luogo, v.medico, v.data_visita, v.giudizio, v.prescrizioni, v.scadenza, v.attachment_id, v.note, v.created_at, a.filename AS attachment_name
    FROM mdl_visite v LEFT JOIN attachments a ON a.id=v.attachment_id WHERE v.resource_id=$1 ORDER BY coalesce(v.data_visita, v.data_prevista) DESC NULLS LAST, v.id DESC`, [p.id]);
  const [posizione] = await elencoMdl({ resourceId: p.id });
  return { scheda, visite, posizione: posizione || null, protocolli: await many('SELECT * FROM mdl_protocolli WHERE attivo ORDER BY nome'), giudizi: GIUDIZI, tipi: TIPI_VISITA, stati: STATI_VISITA };
}

r.get('/resources/:id/mdl', soloMdl, ah(async (req, res) => {
  const p = await soggettoMdl(Number(req.params.id));
  await readLog(req, 'mdl', p.id);
  res.json(await quadroMdl(p));
}));
r.put('/resources/:id/mdl', soloMdl, requireWrite, senzaClinica, ah(async (req, res) => {
  const p = await soggettoMdl(Number(req.params.id));
  const d = parse(schedaSchema, req.body || {});
  if (d.protocollo_id && !await one('SELECT 1 FROM mdl_protocolli WHERE id=$1', [d.protocollo_id])) throw bad('Protocollo sanitario non trovato');
  await q(`INSERT INTO mdl_schede (resource_id, sorveglianza, protocollo_id, mansione, rischi, periodicita_mesi, medico_competente, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (resource_id) DO UPDATE SET sorveglianza=EXCLUDED.sorveglianza, protocollo_id=EXCLUDED.protocollo_id, mansione=EXCLUDED.mansione, rischi=EXCLUDED.rischi, periodicita_mesi=EXCLUDED.periodicita_mesi,
      medico_competente=EXCLUDED.medico_competente, note=EXCLUDED.note, updated_at=now()`, [p.id, d.sorveglianza, d.protocollo_id, d.mansione, d.rischi, d.periodicita_mesi, d.medico_competente, d.note]);
  await audit(req, 'MDL_SCHEDA', 'resource', p.id, { sorveglianza: d.sorveglianza, protocollo_id: d.protocollo_id, periodicita_mesi: d.periodicita_mesi });
  res.json(await quadroMdl(p));
}));
r.post('/resources/:id/mdl/visite', soloMdl, requireWrite, upload.single('file'), senzaClinica, ah(async (req, res) => {
  const p = await soggettoMdl(Number(req.params.id));
  const d = parse(visitaSchema, req.body || {});
  controllaVisita(d);
  const row = await tx(async (c) => {
    // l'unico documento ammesso è il giudizio di idoneità (categoria VISITA_MEDICA del dossier)
    const attId = req.file ? await allega(c, { id: p.id, file: req.file, category: 'VISITA_MEDICA', issued_at: d.data_visita, notes: 'Giudizio di idoneità alla mansione', userId: req.user.id }) : null;
    await c.query('INSERT INTO mdl_schede (resource_id) VALUES ($1) ON CONFLICT (resource_id) DO NOTHING', [p.id]);
    return (await c.query(`INSERT INTO mdl_visite (resource_id, tipo, stato, data_prevista, ora, luogo, medico, data_visita, giudizio, prescrizioni, scadenza, attachment_id, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [p.id, d.tipo, d.stato, d.data_prevista, d.ora, d.luogo, d.medico, d.data_visita, d.giudizio, d.prescrizioni, d.scadenza, attId, d.note, req.user.id])).rows[0];
  });
  // l'audit dice che un giudizio è stato registrato, non quale: il contenuto resta nella tabella riservata
  await audit(req, 'MDL_VISITA_CREATE', 'mdl_visita', row.id, { resource_id: p.id, tipo: d.tipo, stato: d.stato, giudizio_registrato: Boolean(d.giudizio) });
  res.status(201).json({ id: row.id, ...(await quadroMdl(p)) });
}));
r.put('/resources/:id/mdl/visite/:vid', soloMdl, requireWrite, upload.single('file'), senzaClinica, ah(async (req, res) => {
  const p = await soggettoMdl(Number(req.params.id));
  const cur = await one('SELECT * FROM mdl_visite WHERE id=$1 AND resource_id=$2', [Number(req.params.vid), p.id]);
  if (!cur) throw notFound('Visita non trovata');
  const iso = (v) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(v) : v);
  const d = parse(visitaSchema, { ...cur, data_prevista: iso(cur.data_prevista), data_visita: iso(cur.data_visita), scadenza: iso(cur.scadenza), ...(req.body || {}) });
  controllaVisita(d);
  await tx(async (c) => {
    const attId = req.file ? await allega(c, { id: p.id, file: req.file, category: 'VISITA_MEDICA', issued_at: d.data_visita, notes: 'Giudizio di idoneità alla mansione', userId: req.user.id }) : cur.attachment_id;
    await c.query(`UPDATE mdl_visite SET tipo=$3, stato=$4, data_prevista=$5, ora=$6, luogo=$7, medico=$8, data_visita=$9, giudizio=$10, prescrizioni=$11, scadenza=$12, attachment_id=$13, note=$14, updated_at=now() WHERE id=$1 AND resource_id=$2`,
      [cur.id, p.id, d.tipo, d.stato, d.data_prevista, d.ora, d.luogo, d.medico, d.data_visita, d.giudizio, d.prescrizioni, d.scadenza, attId, d.note]);
  });
  await audit(req, 'MDL_VISITA_UPDATE', 'mdl_visita', cur.id, { resource_id: p.id, stato: d.stato, giudizio_registrato: Boolean(d.giudizio) });
  res.json(await quadroMdl(p));
}));
r.delete('/resources/:id/mdl/visite/:vid', soloMdl, requireWrite, ah(async (req, res) => {
  const p = await soggettoMdl(Number(req.params.id));
  const cur = await one('DELETE FROM mdl_visite WHERE id=$1 AND resource_id=$2 RETURNING id, stato', [Number(req.params.vid), p.id]);
  if (!cur) throw notFound('Visita non trovata');
  await audit(req, 'MDL_VISITA_DELETE', 'mdl_visita', cur.id, { resource_id: p.id, stato: cur.stato });
  res.json(await quadroMdl(p));
}));

/**
 * Scadenze di medicina del lavoro in sola lettura (profilo MDL del responsabile HQS, e chi vede già la sezione): chi è soggetto, quando è
 * stata fatta l'ultima visita, quando è dovuta la prossima, se è già fissata. Senza giudizio di idoneità e senza prescrizioni.
 */
r.get('/mdl/scadenze', (req, _res, next) => (vedeMdl(req.user) || req.user?.role === 'MDL' ? next() : next(forbidden('Sezione riservata'))), ah(async (req, res) => {
  const S = await getSettings();
  await readLog(req, 'mdl_scadenze', null);
  const righe = (await elencoMdl()).map((x) => ({ id: x.id, nome: x.nome, kind: x.kind, mansione: x.mansione, area: x.area, sede: x.sede, protocollo: x.protocollo, sorveglianza: x.sorveglianza, impostata: x.impostata,
    periodicita_mesi: x.periodicita_mesi, ultima_visita: x.ultima_visita, prossima: x.prossima, giorni: x.giorni, motivo: x.motivo, stato: x.stato, fissata: x.fissata ? { data: x.fissata.data, ora: x.fissata.ora, luogo: x.fissata.luogo, stato: x.fissata.stato } : null }));
  res.json({ righe, anticipo_giorni: Number(S.mdl_anticipo_giorni || 60) });
}));

/** Calendario della sorveglianza: tutti i soggetti con la prossima visita dovuta, le visite fissate e le ultime convocazioni. */
r.get('/mdl', soloMdl, ah(async (req, res) => {
  const S = await getSettings();
  const elenco = await elencoMdl();
  await readLog(req, 'mdl', null);
  const fissate = await many(`SELECT v.id, v.resource_id, v.tipo, v.stato, v.data_prevista, v.ora, v.luogo, v.medico, r.last_name || ' ' || r.first_name AS nome
    FROM mdl_visite v JOIN resources_v r ON r.id=v.resource_id WHERE v.stato IN ('PROGRAMMATA','CONVOCATA') AND v.data_prevista >= CURRENT_DATE - 7 ORDER BY v.data_prevista, v.ora NULLS LAST, nome`);
  const convocazioni = await many(`SELECT c.id, c.data, c.ora, c.luogo, c.medico, c.note, c.persone, c.inviate, c.esiti, c.created_at, u.full_name AS created_by_name FROM mdl_convocazioni c LEFT JOIN users u ON u.id=c.created_by ORDER BY c.created_at DESC LIMIT 20`);
  res.json({ elenco, fissate, convocazioni, protocolli: await many('SELECT * FROM mdl_protocolli ORDER BY attivo DESC, nome'), giudizi: GIUDIZI, tipi: TIPI_VISITA,
    predefiniti: { medico: S.mdl_medico_competente || '', luogo: S.mdl_luogo || '', anticipo_giorni: Number(S.mdl_anticipo_giorni || 60) }, puo_convocare: req.user.role === 'ADMIN' });
}));

const convSchema = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1, 'Seleziona almeno una persona').max(200), data: z.string().regex(dateRe, 'data non valida'),
  ora: opt(z.string().trim().regex(/^\d{1,2}[:.]\d{2}$/, 'ora non valida (HH:MM)')), luogo: opt(z.string().trim().max(200)), medico: opt(z.string().trim().max(160)), note: opt(z.string().trim().max(1000)), invia: z.boolean().default(true) });
// Le convocazioni le fanno gli amministratori del modulo (richiesta del CEO): HR prepara e registra le visite, ma non convoca
r.post('/mdl/convocazioni', soloMdl, requireRole('ADMIN'), ah(async (req, res) => {
  const d = parse(convSchema, req.body || {});
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  if (d.data < oggi) throw bad('La data della convocazione è nel passato');
  const out = await convoca({ personIds: [...new Set(d.ids)], data: d.data, ora: d.ora, luogo: d.luogo, medico: d.medico, note: d.note, invia: d.invia, userId: req.user.id });
  if (!out.convocazione) throw bad('Nessuna delle persone selezionate è soggetta a sorveglianza sanitaria');
  await audit(req, 'MDL_CONVOCAZIONE', 'mdl_convocazione', out.convocazione, { data: d.data, persone: out.esiti.length, invia: d.invia, esiti: out.esiti.map((e) => ({ id: e.id, stato: e.stato })) });
  res.status(201).json(out);
}));

const protSchema = z.object({ nome: z.string().trim().min(2).max(120), mansioni: opt(z.string().trim().max(500)), rischi: opt(z.string().trim().max(1000)), accertamenti: opt(z.string().trim().max(2000)),
  periodicita_mesi: z.coerce.number().int().min(1).max(120).default(12), attivo: z.boolean().default(true) });
r.post('/mdl/protocolli', soloMdl, requireWrite, ah(async (req, res) => {
  const d = parse(protSchema, req.body || {});
  if (await one('SELECT 1 FROM mdl_protocolli WHERE lower(nome)=lower($1)', [d.nome])) throw bad('Esiste già un protocollo con questo nome');
  const row = await one('INSERT INTO mdl_protocolli (nome, mansioni, rischi, accertamenti, periodicita_mesi, attivo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [d.nome, d.mansioni, d.rischi, d.accertamenti, d.periodicita_mesi, d.attivo]);
  await audit(req, 'MDL_PROTOCOLLO_CREATE', 'mdl_protocollo', row.id, { nome: d.nome });
  res.status(201).json({ id: row.id });
}));
r.put('/mdl/protocolli/:pid', soloMdl, requireWrite, ah(async (req, res) => {
  const d = parse(protSchema, req.body || {});
  if (await one('SELECT 1 FROM mdl_protocolli WHERE lower(nome)=lower($1) AND id<>$2', [d.nome, Number(req.params.pid)])) throw bad('Esiste già un protocollo con questo nome');
  const row = await one('UPDATE mdl_protocolli SET nome=$2, mansioni=$3, rischi=$4, accertamenti=$5, periodicita_mesi=$6, attivo=$7, updated_at=now() WHERE id=$1 RETURNING id', [Number(req.params.pid), d.nome, d.mansioni, d.rischi, d.accertamenti, d.periodicita_mesi, d.attivo]);
  if (!row) throw notFound('Protocollo non trovato');
  await audit(req, 'MDL_PROTOCOLLO_UPDATE', 'mdl_protocollo', row.id, { nome: d.nome, attivo: d.attivo });
  res.json({ ok: true });
}));

export default r;
