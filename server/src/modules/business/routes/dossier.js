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
import { DOSSIER_DOCS, DOC_BY_KEY, defaultChecklists, completeness, checklistXlsx } from '../lib/dossier.js';
import { loadContract, addEvent } from './contracts.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 } });
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

async function loadDossier(contractId) {
  const d = await one('SELECT * FROM dossiers WHERE contract_id=$1', [contractId]);
  if (!d) throw notFound('Fascicolo non trovato: riguarda i punti prelievi e le sedi TD in locazione');
  const files = await many('SELECT f.id, f.doc_key, f.source, f.filename, f.mime, f.size, f.sha256, f.label, f.created_at, u.full_name AS uploaded_by_name FROM dossier_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.dossier_id=$1 ORDER BY f.created_at DESC', [d.id]);
  return { ...d, ...completeness(d, files), catalog: DOSSIER_DOCS };
}

r.get('/:contractId', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.contractId));
  res.json({ contract: { id: c.id, kind: c.kind, protocol: c.protocol, status: c.status, title: c.title, start_date: c.start_date, data: c.data, org: c.org, site: c.site }, dossier: await loadDossier(c.id) });
}));

// Dati del fascicolo: orari, personale, strumentazione, note, codici, date
const staffSchema = z.array(z.object({ surname: z.string().trim().max(80), name: z.string().trim().max(80), affiliation: optStr(80), contract: optStr(40), hours: optStr(20), role: optStr(120), degree: optStr(300) })).max(60);
const equipmentSchema = z.array(z.object({ type: z.string().trim().max(120), maker: optStr(120), model: optStr(120), serial: optStr(120), power: optStr(60), ownership: optStr(60), condition: optStr(60), tested_at: optDate })).max(100);
const hoursSchema = z.array(z.object({ day: z.string(), draw: optStr(80), pickup: optStr(80) })).length(7);
const extraSchema = z.object({ floor: optStr(60), building_type: optStr(80), workers: optStr(10), prov_name: optStr(60), notes: optStr(1500), dvr_code: optStr(40), duvri_code: optStr(40), dirty_clean_clause: optStr(600) }).partial();

r.put('/:contractId', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const b = parse(z.object({ hours: hoursSchema.optional(), staff: staffSchema.optional(), equipment: equipmentSchema.optional(), extra: extraSchema.optional(), doc_date: optDate.optional(), submitted_at: optDate.optional(), authorized_at: optDate.optional(), authorization_ref: optStr(120).optional(), status: z.enum(['IN_CORSO', 'PRESENTATO', 'AUTORIZZATO']).optional() }), req.body);
  const extra = b.extra ? { ...d.extra, ...b.extra } : d.extra;
  await q(`UPDATE dossiers SET hours=$2, staff=$3, equipment=$4, extra=$5, doc_date=$6, submitted_at=$7, authorized_at=$8, authorization_ref=$9, status=$10, updated_at=now() WHERE id=$1`,
    [d.id, JSON.stringify(b.hours ?? d.hours), JSON.stringify(b.staff ?? d.staff), JSON.stringify(b.equipment ?? d.equipment), JSON.stringify(extra),
      b.doc_date === undefined ? d.doc_date : b.doc_date, b.submitted_at === undefined ? d.submitted_at : b.submitted_at, b.authorized_at === undefined ? d.authorized_at : b.authorized_at,
      b.authorization_ref === undefined ? d.authorization_ref : b.authorization_ref, b.status ?? d.status]);
  if (b.status === 'AUTORIZZATO' && c.status === 'FIRMATO') {
    await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1`, [c.id]);
    await addEvent(c.id, 'AUTORIZZATO', req.user.id, `Autorizzazione sanitaria ${b.authorization_ref || ''}`.trim());
  }
  await audit(req, 'DOSSIER_UPDATE', 'dossier', d.id, { fields: Object.keys(b) });
  res.json(await loadDossier(c.id));
}));

// Stato per documento (non applicabile, nota)
r.put('/:contractId/docs/:key', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  if (!DOC_BY_KEY[req.params.key]) throw notFound('Documento non in catalogo');
  const b = parse(z.object({ not_applicable: z.boolean().optional(), note: optStr(500).optional() }), req.body);
  const state = { ...(d.doc_state || {}) };
  state[req.params.key] = { ...(state[req.params.key] || {}), ...b };
  await q('UPDATE dossiers SET doc_state=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(state)]);
  res.json(await loadDossier(c.id));
}));

// Liste di autovalutazione: lettura e aggiornamento delle risposte
r.put('/:contractId/checklists/:list', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const b = parse(z.object({ items: z.array(z.object({ code: z.string(), text: z.string(), applicability: z.string().default(''), answer: z.string().max(400).default(''), document: z.string().max(4000).default(''), notes: z.string().max(4000).default(''), section: z.string().nullable().optional() })) }), req.body);
  const lists = d.checklists.map((L) => (L.code === req.params.list ? { ...L, items: b.items } : L));
  if (!lists.find((L) => L.code === req.params.list)) throw notFound('Lista non trovata');
  await q('UPDATE dossiers SET checklists=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(lists)]);
  await audit(req, 'DOSSIER_CHECKLIST_UPDATE', 'dossier', d.id, { list: req.params.list });
  res.json(await loadDossier(c.id));
}));

r.post('/:contractId/checklists/:list/reset', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const def = defaultChecklists().find((L) => L.code === req.params.list);
  if (!def) throw notFound('Lista non trovata');
  const lists = d.checklists.map((L) => (L.code === req.params.list ? def : L));
  await q('UPDATE dossiers SET checklists=$2, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(lists)]);
  res.json(await loadDossier(c.id));
}));

// Generazione di un documento del fascicolo (DOCX + PDF) o della lista XLSX
r.post('/:contractId/generate/:key', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const doc = DOC_BY_KEY[req.params.key];
  if (!doc || doc.source === 'UPLOAD') throw bad('Questo documento va caricato, non generato');
  const s = await getSettings();
  const site = c.site || {};
  const slug = `${doc.key}_${(site.city || 'sede').replace(/\W+/g, '_')}_${(d.doc_date || todayRome()).replace(/-/g, '')}`;
  await q('DELETE FROM dossier_files WHERE dossier_id=$1 AND doc_key=$2 AND source=$3', [d.id, doc.key, 'GEN']);
  const ins = (filename, mime, buf) => q('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, uploaded_by) VALUES ($1,$2,\'GEN\',$3,$4,$5,$6,$7,$8)', [d.id, doc.key, filename, mime, buf.length, sha256(buf), buf, req.user.id]);
  let pdfError = null;
  if (doc.source === 'CHECK') {
    const L = d.checklists.find((x) => x.code === doc.list);
    const buf = await checklistXlsx(L, { company: s.company_name, site: `${site.street || ''}, ${site.city || ''} (${site.prov || ''})`, ds: `${s.ds_title} ${s.ds_name}`, date: itDate(todayRome()) });
    await ins(`Autovalutazione_${doc.list}_${slug}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf);
  } else {
    const data = dossierData(d, c, c.org, s);
    const docx = renderDocx(doc.template, data);
    await ins(`${slug}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
    if (await pdfAvailable()) {
      try { await ins(`${slug}.pdf`, 'application/pdf', await docxToPdf(docx)); } catch (e) { pdfError = e.message; }
    } else pdfError = 'LibreOffice non disponibile: generato solo il DOCX';
  }
  await addEvent(c.id, 'FASCICOLO_GENERATO', req.user.id, doc.label.split(' · ')[0]);
  await audit(req, 'DOSSIER_GENERATE', 'dossier', d.id, { key: doc.key });
  res.json({ ...(await loadDossier(c.id)), pdfError });
}));

// Genera in sequenza tutti i documenti generabili (bozza completa del fascicolo)
r.post('/:contractId/generate-all', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const s = await getSettings();
  const site = c.site || {};
  const pdf = await pdfAvailable();
  const errors = [];
  for (const doc of DOSSIER_DOCS.filter((x) => x.source !== 'UPLOAD' && !d.doc_state?.[x.key]?.not_applicable)) {
    const slug = `${doc.key}_${(site.city || 'sede').replace(/\W+/g, '_')}_${(d.doc_date || todayRome()).replace(/-/g, '')}`;
    await q('DELETE FROM dossier_files WHERE dossier_id=$1 AND doc_key=$2 AND source=$3', [d.id, doc.key, 'GEN']);
    const ins = (filename, mime, buf) => q('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, uploaded_by) VALUES ($1,$2,\'GEN\',$3,$4,$5,$6,$7,$8)', [d.id, doc.key, filename, mime, buf.length, sha256(buf), buf, req.user.id]);
    try {
      if (doc.source === 'CHECK') {
        const L = d.checklists.find((x) => x.code === doc.list);
        await ins(`Autovalutazione_${doc.list}_${slug}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await checklistXlsx(L, { company: s.company_name, site: `${site.street || ''}, ${site.city || ''} (${site.prov || ''})`, ds: `${s.ds_title} ${s.ds_name}`, date: itDate(todayRome()) }));
      } else {
        const docx = renderDocx(doc.template, dossierData(d, c, c.org, s));
        await ins(`${slug}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
        if (pdf) await ins(`${slug}.pdf`, 'application/pdf', await docxToPdf(docx));
      }
    } catch (e) { errors.push(`${doc.key}: ${e.message}`); }
  }
  await addEvent(c.id, 'FASCICOLO_GENERATO', req.user.id, 'Generazione completa del fascicolo');
  await audit(req, 'DOSSIER_GENERATE_ALL', 'dossier', d.id);
  res.json({ ...(await loadDossier(c.id)), errors });
}));

// Upload (documenti da caricare o versione firmata di un documento generato)
r.post('/:contractId/upload/:key', upload.array('files', 20), ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const doc = DOC_BY_KEY[req.params.key];
  if (!doc) throw notFound('Documento non in catalogo');
  if (!req.files?.length) throw bad('Nessun file');
  if (!doc.multi && doc.source === 'UPLOAD' && req.files.length > 1) throw bad('Questo documento prevede un solo file');
  for (const f of req.files) {
    await q('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, label, uploaded_by) VALUES ($1,$2,\'UPLOAD\',$3,$4,$5,$6,$7,$8,$9)',
      [d.id, doc.key, f.originalname, f.mimetype || 'application/octet-stream', f.size, sha256(f.buffer), f.buffer, req.body.label || null, req.user.id]);
  }
  if (doc.key === 'AUTORIZZAZIONE') {
    await q(`UPDATE dossiers SET status='AUTORIZZATO', authorized_at=coalesce(authorized_at, current_date), updated_at=now() WHERE id=$1`, [d.id]);
    if (c.status === 'FIRMATO') { await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1`, [c.id]); await addEvent(c.id, 'AUTORIZZATO', req.user.id, 'Autorizzazione sanitaria caricata'); }
  }
  await addEvent(c.id, 'FASCICOLO_CARICATO', req.user.id, `${doc.label.split(' · ')[0]}: ${req.files.map((f) => f.originalname).join(', ')}`);
  await audit(req, 'DOSSIER_UPLOAD', 'dossier', d.id, { key: doc.key, files: req.files.map((f) => f.originalname) });
  res.json(await loadDossier(c.id));
}));

r.delete('/:contractId/files/:fid', ah(async (req, res) => {
  requireDossier(req.user);
  const c = await loadContract(Number(req.params.contractId));
  const d = await loadDossier(c.id);
  const f = await one('DELETE FROM dossier_files WHERE id=$1 AND dossier_id=$2 RETURNING filename, doc_key', [Number(req.params.fid), d.id]);
  if (!f) throw notFound();
  await addEvent(c.id, 'FASCICOLO_RIMOSSO', req.user.id, f.filename);
  res.json(await loadDossier(c.id));
}));

export const dossierFilesRouter = Router();
dossierFilesRouter.get('/dossier-files/:id', ah(async (req, res) => {
  const f = await one('SELECT filename, mime, data FROM dossier_files WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound();
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.send(f.data);
}));

export { baseData };
export default r;
