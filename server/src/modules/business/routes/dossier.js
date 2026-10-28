import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse, itDate, todayRome } from '../lib/util.js';
import { requireDossier } from '../lib/access.js';
import { getSettings } from '../lib/rules.js';
import { dossierData, renderDocx, docxToPdf, pdfAvailable, baseData } from '../lib/docgen.js';
import { sha256 } from '../lib/crypto.js';
import { storeBuffer, sendFile, dropBlobs } from '../lib/storage.js';
import { DOSSIER_DOCS, DOC_BY_KEY, defaultChecklists, completeness, checklistXlsx, DEFAULT_HOURS } from '../lib/dossier.js';
import { addEvent, checkOrg, checkSite, defaultDocState, SITE_COLS } from './contracts.js';

// Fascicoli di autorizzazione sanitaria (L.R. Toscana 51/2009). Ogni fascicolo ha i propri riferimenti all'anagrafica unica:
// la sede TD autorizzanda (public.sites) e la controparte (public.organizations), almeno uno dei due. Nasce con il contratto
// di punto prelievi o di sede TD in locazione (e ne segue controparte e sede) oppure da solo, su una sede TD senza contratto.
// Le route sono per id del fascicolo.
const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 } });
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const optId = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable());

const DOSSIER_COLS = `d.*, coalesce(d.title, c.title, s.name, o.name) AS label,
  o.name AS org_name, o.city AS org_city, o.province AS org_prov,
  s.code AS site_code, s.name AS site_name, s.kind AS site_kind, s.address AS site_street, s.zip AS site_zip, s.city AS site_city, s.province AS site_prov,
  c.kind AS contract_kind, c.protocol, c.status AS contract_status, c.title AS contract_title, c.start_date, c.version AS contract_version`;
const DOSSIER_FROM = 'FROM dossiers d LEFT JOIN contracts c ON c.id=d.contract_id LEFT JOIN public.organizations o ON o.id=d.org_id LEFT JOIN public.sites s ON s.id=d.site_id';

// Fascicolo con contesto: riga, controparte (orgs_v), sede TD, contratto di origine (se c'è), file e completamento
export async function loadDossier(id) {
  const d = await one(`SELECT ${DOSSIER_COLS} ${DOSSIER_FROM} WHERE d.id=$1`, [id]);
  if (!d) throw notFound('Fascicolo non trovato');
  const files = await many('SELECT f.id, f.doc_key, f.source, f.filename, f.mime, f.size, f.sha256, f.label, f.created_at, u.full_name AS uploaded_by_name FROM dossier_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.dossier_id=$1 ORDER BY f.created_at DESC', [d.id]);
  d.org = d.org_id ? await one('SELECT * FROM orgs_v WHERE id=$1', [d.org_id]) : null;
  d.site = d.site_id ? await one(`SELECT ${SITE_COLS} FROM public.sites WHERE id=$1`, [d.site_id]) : null;
  d.contract = d.contract_id ? await one('SELECT id, kind, protocol, status, title, start_date, end_date, version, data FROM contracts WHERE id=$1', [d.contract_id]) : null;
  return { ...d, ...completeness(d, files), catalog: DOSSIER_DOCS };
}

// Contesto per i documenti generati: con il contratto si usano protocollo, decorrenza e versione del contratto
const docCtx = (d) => ({ id: d.contract?.id || `F${d.id}`, protocol: d.contract?.protocol || null, version: d.contract?.version || 1, start_date: d.contract?.start_date || null, kind: d.contract?.kind || 'SEDE', site: d.site, data: d.contract?.data || {} });
const logEvent = (d, kind, userId, note) => (d.contract_id ? addEvent(d.contract_id, kind, userId, note) : Promise.resolve());

// ---------------- Elenco e creazione ----------------
r.get('/', ah(async (req, res) => {
  const { org_id, site_id, status, q: qs } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (org_id) add('d.org_id = ?', Number(org_id));
  if (site_id) add('d.site_id = ?', Number(site_id));
  if (status) add('d.status = ?', String(status));
  if (qs) { p.push(String(qs).toLowerCase()); const i = p.length; where.push(`(lower(coalesce(o.name,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(s.name,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(s.city,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(c.protocol,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(d.title, c.title, '')) LIKE '%'||$${i}||'%')`); }
  const rows = await many(`SELECT ${DOSSIER_COLS} ${DOSSIER_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY coalesce(s.name, o.name), d.created_at DESC LIMIT 1000`, p);
  const files = rows.length ? await many('SELECT dossier_id, doc_key, source FROM dossier_files WHERE dossier_id = ANY($1::int[])', [rows.map((x) => x.id)]) : [];
  res.json(rows.map((d) => {
    const comp = completeness(d, files.filter((f) => f.dossier_id === d.id));
    const { hours, staff, equipment, checklists, doc_state, extra, ...rest } = d;
    return { ...rest, pct: comp.pct, done: comp.done, required: comp.required, missing: comp.rows.filter((x) => x.required && x.status === 'MANCANTE').map((x) => x.key) };
  }));
}));

// Fascicolo senza contratto: sede TD (e, se c'è una struttura ospitante, la controparte), almeno uno dei due
r.post('/', ah(async (req, res) => {
  requireDossier(req.user);
  const b = parse(z.object({ org_id: optId, site_id: optId, title: optStr(160), doc_date: optDate }), req.body);
  if (!b.org_id && !b.site_id) throw bad('Indica la sede TD o la controparte (Legal entity): almeno una delle due');
  const org = await checkOrg(b.org_id);
  const site = await checkSite(null, b.site_id, req.user);
  const title = b.title || (site ? `Autorizzazione ${site.name}` : `Autorizzazione ${org.name}`);
  const row = await one('INSERT INTO dossiers (org_id, site_id, title, hours, checklists, doc_date, doc_state, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [org?.id || null, site?.id || null, title, JSON.stringify(DEFAULT_HOURS), JSON.stringify(defaultChecklists()), b.doc_date || todayRome(), JSON.stringify(defaultDocState(!org)), req.user.id]);
  await audit(req, 'DOSSIER_CREATE', 'dossier', row.id, { org: org?.name, site: site?.name, title });
  res.status(201).json(await loadDossier(row.id));
}));

r.get('/:id', ah(async (req, res) => res.json(await loadDossier(Number(req.params.id)))));

// Dati del fascicolo: controparte e sede (solo senza contratto: con il contratto le segue), orari, personale, strumentazione, note, codici, date
const staffSchema = z.array(z.object({ surname: z.string().trim().max(80), name: z.string().trim().max(80), affiliation: optStr(80), contract: optStr(40), hours: optStr(20), role: optStr(120), degree: optStr(300) })).max(60);
const equipmentSchema = z.array(z.object({ type: z.string().trim().max(120), maker: optStr(120), model: optStr(120), serial: optStr(120), power: optStr(60), ownership: optStr(60), condition: optStr(60), tested_at: optDate })).max(100);
const hoursSchema = z.array(z.object({ day: z.string(), draw: optStr(80), pickup: optStr(80) })).length(7);
const extraSchema = z.object({ floor: optStr(60), building_type: optStr(80), workers: optStr(10), prov_name: optStr(60), notes: optStr(1500), dvr_code: optStr(40), duvri_code: optStr(40), dirty_clean_clause: optStr(600) }).partial();

r.put('/:id', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const b = parse(z.object({ org_id: optId.optional(), site_id: optId.optional(), title: optStr(160).optional(), hours: hoursSchema.optional(), staff: staffSchema.optional(), equipment: equipmentSchema.optional(), extra: extraSchema.optional(), doc_date: optDate.optional(), submitted_at: optDate.optional(), authorized_at: optDate.optional(), authorization_ref: optStr(120).optional(), status: z.enum(['IN_CORSO', 'PRESENTATO', 'AUTORIZZATO']).optional() }), req.body);
  let orgId = d.org_id; let siteId = d.site_id;
  if (b.org_id !== undefined || b.site_id !== undefined) {
    if (d.contract_id) throw bad('Controparte e sede di questo fascicolo si modificano dal contratto di origine');
    orgId = b.org_id !== undefined ? b.org_id : d.org_id;
    siteId = b.site_id !== undefined ? b.site_id : d.site_id;
    if (!orgId && !siteId) throw bad('Indica la sede TD o la controparte (Legal entity): almeno una delle due');
    await checkOrg(orgId);
    await checkSite(null, siteId, req.user);
  }
  const extra = b.extra ? { ...d.extra, ...b.extra } : d.extra;
  await q(`UPDATE dossiers SET org_id=$11, site_id=$12, title=$13, hours=$2, staff=$3, equipment=$4, extra=$5, doc_date=$6, submitted_at=$7, authorized_at=$8, authorization_ref=$9, status=$10, updated_at=now() WHERE id=$1`,
    [d.id, JSON.stringify(b.hours ?? d.hours), JSON.stringify(b.staff ?? d.staff), JSON.stringify(b.equipment ?? d.equipment), JSON.stringify(extra),
      b.doc_date === undefined ? d.doc_date : b.doc_date, b.submitted_at === undefined ? d.submitted_at : b.submitted_at, b.authorized_at === undefined ? d.authorized_at : b.authorized_at,
      b.authorization_ref === undefined ? d.authorization_ref : b.authorization_ref, b.status ?? d.status, orgId || null, siteId || null, b.title === undefined ? d.title : b.title]);
  if (b.status === 'AUTORIZZATO' && d.contract?.status === 'FIRMATO') {
    await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1`, [d.contract_id]);
    await addEvent(d.contract_id, 'AUTORIZZATO', req.user.id, `Autorizzazione sanitaria ${b.authorization_ref || ''}`.trim());
  }
  await audit(req, 'DOSSIER_UPDATE', 'dossier', d.id, { fields: Object.keys(b) });
  res.json(await loadDossier(d.id));
}));

// Fascicolo senza contratto: si elimina finché è in preparazione (quelli dei contratti seguono il contratto)
r.delete('/:id', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  if (d.contract_id) throw bad('Il fascicolo di un contratto si elimina con il contratto');
  if (d.status !== 'IN_CORSO') throw bad('Si elimina solo un fascicolo in preparazione');
  const blobs = await many('SELECT blob_path FROM dossier_files WHERE dossier_id=$1', [d.id]);
  await q('DELETE FROM dossiers WHERE id=$1', [d.id]);
  await dropBlobs(blobs.map((b) => b.blob_path));
  await audit(req, 'DOSSIER_DELETE', 'dossier', d.id, { title: d.label });
  res.json({ ok: true });
}));

// Stato per documento (non applicabile, nota)
r.put('/:id/docs/:key', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  if (!DOC_BY_KEY[req.params.key]) throw notFound('Documento non in catalogo');
  const b = parse(z.object({ not_applicable: z.boolean().optional(), note: optStr(500).optional() }), req.body);
  const state = { ...(d.doc_state || {}) };
  state[req.params.key] = { ...(state[req.params.key] || {}), ...b };
  await q('UPDATE dossiers SET doc_state=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(state)]);
  res.json(await loadDossier(d.id));
}));

// Liste di autovalutazione: lettura e aggiornamento delle risposte
r.put('/:id/checklists/:list', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const b = parse(z.object({ items: z.array(z.object({ code: z.string(), text: z.string(), applicability: z.string().default(''), answer: z.string().max(400).default(''), document: z.string().max(4000).default(''), notes: z.string().max(4000).default(''), section: z.string().nullable().optional() })) }), req.body);
  const lists = d.checklists.map((L) => (L.code === req.params.list ? { ...L, items: b.items } : L));
  if (!lists.find((L) => L.code === req.params.list)) throw notFound('Lista non trovata');
  await q('UPDATE dossiers SET checklists=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(lists)]);
  await audit(req, 'DOSSIER_CHECKLIST_UPDATE', 'dossier', d.id, { list: req.params.list });
  res.json(await loadDossier(d.id));
}));

r.post('/:id/checklists/:list/reset', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const def = defaultChecklists().find((L) => L.code === req.params.list);
  if (!def) throw notFound('Lista non trovata');
  const lists = d.checklists.map((L) => (L.code === req.params.list ? def : L));
  await q('UPDATE dossiers SET checklists=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(lists)]);
  res.json(await loadDossier(d.id));
}));

// Generazione di un documento del fascicolo (DOCX + PDF) o della lista XLSX
async function generateDoc(d, doc, s, pdf, userId) {
  const site = d.site || {};
  const slug = `${doc.key}_${(site.city || 'sede').replace(/\W+/g, '_')}_${(d.doc_date || todayRome()).replace(/-/g, '')}`;
  const old = await many('DELETE FROM dossier_files WHERE dossier_id=$1 AND doc_key=$2 AND source=$3 RETURNING blob_path', [d.id, doc.key, 'GEN']);
  await dropBlobs(old.map((r) => r.blob_path));
  const ins = async (filename, mime, buf) => { const st = await storeBuffer('fascicoli', filename, mime, buf); await q('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,$2,\'GEN\',$3,$4,$5,$6,$7,$8,$9)', [d.id, doc.key, filename, mime, st.size, st.sha256, st.data, st.blob_path, userId]); };
  if (doc.source === 'CHECK') {
    const L = d.checklists.find((x) => x.code === doc.list);
    const buf = await checklistXlsx(L, { company: s.company_name, site: `${site.street || ''}, ${site.city || ''} (${site.prov || ''})`, ds: `${s.ds_title} ${s.ds_name}`, date: itDate(todayRome()) });
    await ins(`Autovalutazione_${doc.list}_${slug}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf);
    return null;
  }
  const docx = renderDocx(doc.template, dossierData(d, docCtx(d), d.org, s));
  await ins(`${slug}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
  if (!pdf) return 'LibreOffice non disponibile: generato solo il DOCX';
  try { await ins(`${slug}.pdf`, 'application/pdf', await docxToPdf(docx)); } catch (e) { return e.message; }
  return null;
}

r.post('/:id/generate/:key', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const doc = DOC_BY_KEY[req.params.key];
  if (!doc || doc.source === 'UPLOAD') throw bad('Questo documento va caricato, non generato');
  if (!d.site) throw bad('Indica la sede TD del fascicolo: i documenti riportano indirizzo e comune della sede');
  const s = await getSettings();
  const pdfError = await generateDoc(d, doc, s, await pdfAvailable(), req.user.id);
  await logEvent(d, 'FASCICOLO_GENERATO', req.user.id, doc.label.split(' · ')[0]);
  await audit(req, 'DOSSIER_GENERATE', 'dossier', d.id, { key: doc.key });
  res.json({ ...(await loadDossier(d.id)), pdfError });
}));

// Genera in sequenza tutti i documenti generabili (bozza completa del fascicolo)
r.post('/:id/generate-all', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  if (!d.site) throw bad('Indica la sede TD del fascicolo: i documenti riportano indirizzo e comune della sede');
  const s = await getSettings();
  const pdf = await pdfAvailable();
  const errors = [];
  for (const doc of DOSSIER_DOCS.filter((x) => x.source !== 'UPLOAD' && !d.doc_state?.[x.key]?.not_applicable)) {
    try { const err = await generateDoc(d, doc, s, pdf, req.user.id); if (err) errors.push(`${doc.key}: ${err}`); } catch (e) { errors.push(`${doc.key}: ${e.message}`); }
  }
  await logEvent(d, 'FASCICOLO_GENERATO', req.user.id, 'Generazione completa del fascicolo');
  await audit(req, 'DOSSIER_GENERATE_ALL', 'dossier', d.id);
  res.json({ ...(await loadDossier(d.id)), errors });
}));

// Upload (documenti da caricare o versione firmata di un documento generato)
r.post('/:id/upload/:key', upload.array('files', 20), ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const doc = DOC_BY_KEY[req.params.key];
  if (!doc) throw notFound('Documento non in catalogo');
  if (!req.files?.length) throw bad('Nessun file');
  if (!doc.multi && doc.source === 'UPLOAD' && req.files.length > 1) throw bad('Questo documento prevede un solo file');
  for (const f of req.files) {
    const st = await storeBuffer('fascicoli', f.originalname, f.mimetype, f.buffer);
    await q('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, blob_path, label, uploaded_by) VALUES ($1,$2,\'UPLOAD\',$3,$4,$5,$6,$7,$8,$9,$10)',
      [d.id, doc.key, f.originalname, f.mimetype || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path, req.body.label || null, req.user.id]);
  }
  if (doc.key === 'AUTORIZZAZIONE') {
    await q(`UPDATE dossiers SET status='AUTORIZZATO', authorized_at=coalesce(authorized_at, current_date), updated_at=now() WHERE id=$1`, [d.id]);
    if (d.contract?.status === 'FIRMATO') { await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1`, [d.contract_id]); await addEvent(d.contract_id, 'AUTORIZZATO', req.user.id, 'Autorizzazione sanitaria caricata'); }
  }
  await logEvent(d, 'FASCICOLO_CARICATO', req.user.id, `${doc.label.split(' · ')[0]}: ${req.files.map((f) => f.originalname).join(', ')}`);
  await audit(req, 'DOSSIER_UPLOAD', 'dossier', d.id, { key: doc.key, files: req.files.map((f) => f.originalname) });
  res.json(await loadDossier(d.id));
}));

r.delete('/:id/files/:fid', ah(async (req, res) => {
  requireDossier(req.user);
  const d = await loadDossier(Number(req.params.id));
  const f = await one('DELETE FROM dossier_files WHERE id=$1 AND dossier_id=$2 RETURNING filename, doc_key, blob_path', [Number(req.params.fid), d.id]);
  if (!f) throw notFound();
  await dropBlobs([f.blob_path]);
  await logEvent(d, 'FASCICOLO_RIMOSSO', req.user.id, f.filename);
  res.json(await loadDossier(d.id));
}));

export const dossierFilesRouter = Router();
dossierFilesRouter.get('/dossier-files/:id', ah(async (req, res) => {
  const f = await one('SELECT filename, mime, data, blob_path FROM dossier_files WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound();
  await sendFile(res, f, { inline: Boolean(req.query.inline) });
}));

export { baseData };
export default r;
