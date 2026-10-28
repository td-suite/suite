import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, HttpError } from '../lib/util.js';
import { requireWrite, requireRole, readLog } from '../lib/access.js';
import { config } from '../config.js';
import { inboxStatus, pollRecruitingInbox, testInbox } from '../lib/inbox.js';
import { extractText, quickFacts, summarizeCv } from '../lib/cv.js';
import { personSchema } from './resources.js';
import { createPerson, updatePerson, reindexPerson } from '../lib/people.js';
import { generateDocument } from './documents.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
const opt = (s) => z.preprocess((v) => (v === '' || v === 'null' || v === 'undefined' ? null : v), s.optional().nullable()); // stringa vuota (form multipart) = assente
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const optDate = () => opt(z.string().regex(dateRe, 'data non valida'));
const num = () => z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nullable());

// ---------------- CV Box ----------------
const CV_COLS = 'c.id, c.last_name, c.first_name, c.email, c.phone, c.area_id, a.name AS area_name, c.role_target, c.summary, c.interview_notes, c.rating, c.status, c.source, c.filename, c.mime, c.size, c.resource_id, c.received_at, c.created_at, c.updated_at';

r.get('/cv', ah(async (req, res) => {
  const w = ['TRUE']; const P = [];
  if (req.query.status) { P.push(req.query.status); w.push(`c.status = $${P.length}`); }
  if (req.query.area_id) { P.push(Number(req.query.area_id)); w.push(`c.area_id = $${P.length}`); }
  if (req.query.q) { P.push(`%${req.query.q}%`); w.push(`(coalesce(c.last_name,'') || ' ' || coalesce(c.first_name,'') || ' ' || coalesce(c.role_target,'') || ' ' || coalesce(c.summary,'')) ILIKE $${P.length}`); }
  res.json(await many(`SELECT ${CV_COLS} FROM cv_box c LEFT JOIN areas a ON a.id=c.area_id WHERE ${w.join(' AND ')} ORDER BY c.received_at DESC, c.id DESC`, P));
}));

const cvSchema = z.object({
  last_name: opt(z.string().max(100)), first_name: opt(z.string().max(100)), email: opt(z.string().max(160)), phone: opt(z.string().max(40)),
  area_id: num(), role_target: opt(z.string().max(160)), summary: opt(z.string().max(6000)), interview_notes: opt(z.string().max(8000)), rating: num(),
  status: z.enum(['NUOVO', 'IN_VALUTAZIONE', 'COLLOQUIO', 'IN_ATTESA', 'SCARTATO', 'CONVERTITO']).optional(), source: opt(z.string().max(120)), received_at: optDate(),
});

r.post('/cv', requireWrite, upload.single('file'), ah(async (req, res) => {
  const d = parse(cvSchema, req.body);
  let text = ''; let ai = null; let facts = {}; let aiError = null;
  const file = req.file || null;
  const filename = file ? Buffer.from(file.originalname, 'latin1').toString('utf8') : null;
  if (file) {
    text = await extractText(file.buffer, file.mimetype, filename);
    facts = quickFacts(text);
    if (req.body.analyze !== 'false' && config.anthropicKey) {
      try { ai = await summarizeCv(text, (await many('SELECT name FROM areas WHERE active ORDER BY sort_order')).map((a) => a.name)); } catch (e) { console.error('[cv] sintesi AI non riuscita:', e.message); aiError = e.message; }
    }
  }
  let areaId = d.area_id;
  if (!areaId && ai?.area) areaId = (await one('SELECT id FROM areas WHERE lower(name)=lower($1)', [ai.area]))?.id || null;
  const row = await one(`INSERT INTO cv_box (last_name, first_name, email, phone, area_id, role_target, summary, rating, status, source, filename, mime, size, data, text_excerpt, received_at, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16, CURRENT_DATE),$17) RETURNING id`,
    [d.last_name || ai?.last_name || null, d.first_name || ai?.first_name || null, d.email || ai?.email || facts.email || null, d.phone || ai?.phone || facts.phone || null, areaId,
      d.role_target || ai?.role_target || null, d.summary || ai?.summary || null, d.rating || ai?.rating || null, d.status || 'NUOVO', d.source, filename, file?.mimetype || null, file?.size || null, file?.buffer || null, text.slice(0, 4000) || null, d.received_at, req.user.id]);
  await audit(req, 'CV_UPLOAD', 'cv', row.id, { filename });
  res.status(201).json({ id: row.id, ai_used: Boolean(ai), ai_error: aiError });
}));

r.put('/cv/:id', requireWrite, ah(async (req, res) => {
  const d = parse(cvSchema, req.body);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE cv_box SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [Number(req.params.id), ...cols.map((c) => d[c])]);
  res.json({ ok: true });
}));

r.post('/cv/:id/analyze', requireWrite, ah(async (req, res) => {
  const c = await one('SELECT data, mime, filename, text_excerpt FROM cv_box WHERE id=$1', [Number(req.params.id)]);
  if (!c) throw notFound();
  if (!config.anthropicKey) throw bad('Analisi automatica non configurata (ANTHROPIC_API_KEY mancante)');
  const text = c.data ? await extractText(c.data, c.mime, c.filename || '') : c.text_excerpt;
  let ai;
  try { ai = await summarizeCv(text, (await many('SELECT name FROM areas WHERE active ORDER BY sort_order')).map((a) => a.name)); } catch (e) { throw new HttpError(e.status || 424, e.message); }
  if (!ai) throw bad('Il modello non ha restituito una sintesi: riprova');
  const areaId = ai.area ? (await one('SELECT id FROM areas WHERE lower(name)=lower($1)', [ai.area]))?.id || null : null;
  await q(`UPDATE cv_box SET summary=coalesce($2, summary), role_target=coalesce($3, role_target), rating=coalesce($4, rating), area_id=coalesce($5, area_id),
    last_name=coalesce(last_name,$6), first_name=coalesce(first_name,$7), email=coalesce(email,$8), phone=coalesce(phone,$9), updated_at=now() WHERE id=$1`,
    [Number(req.params.id), ai.summary, ai.role_target, ai.rating, areaId, ai.last_name, ai.first_name, ai.email, ai.phone]);
  res.json(ai);
}));

r.get('/cv/:id/download', ah(async (req, res) => {
  const c = await one('SELECT filename, mime, data FROM cv_box WHERE id=$1', [Number(req.params.id)]);
  if (!c?.data) throw notFound();
  await readLog(req, 'cv', req.params.id);
  const inline = req.query.inline === '1' && c.mime === 'application/pdf';
  res.set('Content-Type', c.mime).set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(c.filename)}`).send(c.data);
}));

r.delete('/cv/:id', requireWrite, ah(async (req, res) => {
  await q('DELETE FROM cv_box WHERE id=$1', [Number(req.params.id)]);
  await audit(req, 'CV_DELETE', 'cv', req.params.id);
  res.json({ ok: true });
}));

// ---------------- Lettere di impegno ----------------
const letterSchema = z.object({
  letter_date: z.string().regex(dateRe).optional(),
  start_by: optDate(), valid_until: optDate(),
  level: opt(z.string().max(12)), qualification: opt(z.string().max(60)), job_title: opt(z.string().max(160)),
  weekly_hours: num().default(40), autonomous_hours: z.boolean().default(false),
  ral: num().default(0), ral_steps: z.array(z.object({ from: z.string().regex(dateRe), ral: num() })).default([]),
  mbo_enabled: z.boolean().default(false), mbo_pct: num(), work_site_id: num(),
  contract_type: z.enum(['TIND', 'TDET', 'APPRENDISTATO']).default('TIND'), notes: opt(z.string().max(4000)),
  status: z.enum(['BOZZA', 'INVIATA', 'ACCETTATA', 'RIFIUTATA', 'SCADUTA', 'CONVERTITA']).optional(), accepted_at: optDate(),
});
const LETTER_COLS = Object.keys(letterSchema.shape);

/** Alla conversione in contratto: se il dossier non ha il CV, lo recupera dal CV Box (per collegamento, codice fiscale, email o nominativo). */
export async function recoverCv(resourceId, req) {
  const r = await one('SELECT id, cv_attachment_id, last_name, first_name, email, tax_code FROM resources_v WHERE id=$1', [resourceId]);
  if (!r) return null;
  const has = await one("SELECT id FROM attachments WHERE resource_id=$1 AND category='CV' ORDER BY uploaded_at DESC LIMIT 1", [resourceId]);
  if (has) { if (!r.cv_attachment_id) await updatePerson(null, req, resourceId, { cv_attachment_id: has.id }, { audit: false }); return has.id; }
  const cv = await one(`SELECT * FROM cv_box WHERE data IS NOT NULL AND (resource_id=$1
      OR (lower(email)=lower($2) AND $2 <> '')
      OR (lower(last_name)=lower($3) AND lower(first_name)=lower($4)))
    ORDER BY (resource_id=$1) DESC, received_at DESC LIMIT 1`, [resourceId, r.email || '', r.last_name, r.first_name]);
  if (!cv) return null;
  const att = await one(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, uploaded_by, notes) VALUES ($1,'CV',$2,$3,$4,$5,$6,'Recuperato dal CV Box alla conversione della lettera di impegno') RETURNING id`, [resourceId, cv.filename, cv.mime, cv.size, cv.data, req?.user?.id || null]);
  await updatePerson(null, req, resourceId, { cv_attachment_id: att.id }, { audit: false });
  await q(`UPDATE cv_box SET status='CONVERTITO', resource_id=$2, updated_at=now() WHERE id=$1`, [cv.id, resourceId]);
  if (req) await audit(req, 'CV_RECOVERED', 'attachment', att.id, { resource_id: resourceId, cv_id: cv.id });
  return att.id;
}

r.get('/letters', ah(async (req, res) => {
  const w = ['TRUE']; const P = [];
  if (req.query.status) { P.push(req.query.status); w.push(`c.status = ANY(string_to_array($${P.length}, ','))`); }
  res.json(await many(`SELECT c.*, r.last_name, r.first_name, r.kind, r.status AS resource_status, r.tax_code, r.email, a.name AS area_name,
      (SELECT count(*)::int FROM generated_documents g WHERE g.kind='LETTERA_IMPEGNO' AND g.ref_id=c.id) AS documents_count
    FROM commitment_letters c JOIN resources_v r ON r.id=c.resource_id LEFT JOIN areas a ON a.id=r.area_id WHERE ${w.join(' AND ')} ORDER BY c.created_at DESC`, P));
}));

r.get('/letters/:id', ah(async (req, res) => {
  const l = await one(`SELECT c.*, ws.name AS work_site_name, r.last_name, r.first_name, r.tax_code, r.email, r.phone, r.area_id, r.manager_id, r.birth_place, r.birth_date, r.sex, r.status AS resource_status FROM commitment_letters c JOIN resources_v r ON r.id=c.resource_id LEFT JOIN public.sites ws ON ws.id=c.work_site_id WHERE c.id=$1`, [Number(req.params.id)]);
  if (!l) throw notFound();
  l.documents = await many('SELECT id, version, title, generated_at, (pdf IS NOT NULL) AS has_pdf, coalesce(data->\'_missing\', \'[]\'::jsonb) AS missing FROM generated_documents WHERE kind=\'LETTERA_IMPEGNO\' AND ref_id=$1 ORDER BY version DESC', [l.id]);
  l.signed_files = await many(`SELECT a.id, a.filename, a.size, a.issued_at, a.signed, a.uploaded_at, u.full_name AS uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.resource_id=$1 AND a.category='LETTERA_IMPEGNO' ORDER BY a.uploaded_at DESC`, [l.resource_id]);
  await readLog(req, 'letter', l.id);
  res.json(l);
}));

// Crea la lettera: su risorsa esistente (resource_id) o creando una nuova risorsa in stato IMPEGNO (person)
r.post('/letters', requireWrite, ah(async (req, res) => {
  const letter = parse(letterSchema, req.body.letter || {});
  let resourceId = req.body.resource_id ? Number(req.body.resource_id) : null;
  let created = false;
  const generate = Boolean(req.body.generate);
  const id = await tx(async (c) => {
    if (!resourceId) {
      // nuova persona in stato IMPEGNO sull'anagrafica unica (public.people + person_ext), con audit PERSON_CREATED della Suite
      const person = parse(personSchema, { kind: 'DIPENDENTE', status: 'IMPEGNO', ...(req.body.person || {}) });
      resourceId = await createPerson(c, req, person);
      created = true;
    }
    if (req.body.cv_id) {
      {
        // sposta il CV dal CV Box al dossier della risorsa (anche su risorsa già censita)
        const cv = (await c.query('SELECT * FROM cv_box WHERE id=$1', [Number(req.body.cv_id)])).rows[0];
        if (cv?.data) {
          const att = (await c.query(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, uploaded_by, notes) VALUES ($1,'CV',$2,$3,$4,$5,$6,'Da CV Box') RETURNING id`, [resourceId, cv.filename, cv.mime, cv.size, cv.data, req.user.id])).rows[0];
          await updatePerson(c, req, resourceId, { cv_attachment_id: att.id }, { audit: false });
        }
        await c.query(`UPDATE cv_box SET status='CONVERTITO', resource_id=$2, updated_at=now() WHERE id=$1`, [Number(req.body.cv_id), resourceId]);
      }
    }
    const cols = LETTER_COLS.filter((k) => letter[k] !== undefined);
    const vals = cols.map((k) => (k === 'ral_steps' ? JSON.stringify(letter[k]) : letter[k]));
    const row = (await c.query(`INSERT INTO commitment_letters (resource_id, created_by, ${cols.join(',')}) VALUES ($1,$2,${cols.map((_, i) => `$${i + 3}`).join(',')}) RETURNING id`, [resourceId, req.user.id, ...vals])).rows[0];
    return row.id;
  });
  if (created) reindexPerson(resourceId);
  await audit(req, 'LETTER_CREATE', 'letter', id, { resource_id: resourceId });
  let doc = null;
  if (generate) doc = await generateDocument({ req, resourceId, kind: 'LETTERA_IMPEGNO', refId: id });
  res.status(201).json({ id, resource_id: resourceId, document: doc });
}));

r.put('/letters/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const letter = parse(letterSchema.partial(), req.body);
  const cols = LETTER_COLS.filter((k) => letter[k] !== undefined);
  if (cols.length) await q(`UPDATE commitment_letters SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((k) => (k === 'ral_steps' ? JSON.stringify(letter[k]) : letter[k]))]);
  if (letter.status === 'ACCETTATA') await q(`UPDATE commitment_letters SET accepted_at=coalesce(accepted_at, CURRENT_DATE) WHERE id=$1`, [id]);
  if (letter.status === 'CONVERTITA') { const l = await one('SELECT resource_id FROM commitment_letters WHERE id=$1', [id]); if (l) await recoverCv(l.resource_id, req); }
  await audit(req, 'LETTER_UPDATE', 'letter', id, letter);
  res.json({ ok: true });
}));

r.post('/letters/:id/generate', requireWrite, ah(async (req, res) => {
  const l = await one('SELECT resource_id FROM commitment_letters WHERE id=$1', [Number(req.params.id)]);
  if (!l) throw notFound();
  const doc = await generateDocument({ req, resourceId: l.resource_id, kind: 'LETTERA_IMPEGNO', refId: Number(req.params.id) });
  await q(`UPDATE commitment_letters SET status = CASE WHEN status='BOZZA' THEN 'INVIATA' ELSE status END, updated_at=now() WHERE id=$1`, [Number(req.params.id)]);
  res.status(201).json(doc);
}));

r.delete('/letters/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const l = await one('DELETE FROM commitment_letters WHERE id=$1 RETURNING resource_id', [Number(req.params.id)]);
  if (!l) throw notFound();
  await q('DELETE FROM generated_documents WHERE kind=\'LETTERA_IMPEGNO\' AND ref_id=$1', [Number(req.params.id)]);
  // se la risorsa era solo "in impegno" senza altre lettere, resta in anagrafica con stato IMPEGNO (rimozione manuale dall'elenco risorse)
  await audit(req, 'LETTER_DELETE', 'letter', req.params.id, l);
  res.json({ ok: true });
}));

// Lettere accettate non ancora convertite: base per il contratto di assunzione
r.get('/letters-accepted', ah(async (_req, res) => {
  res.json(await many(`SELECT c.*, r.last_name, r.first_name, r.tax_code FROM commitment_letters c JOIN resources_v r ON r.id=c.resource_id WHERE c.status='ACCETTATA' ORDER BY c.accepted_at DESC`));
}));

// ---------------- Casella di recruiting (Microsoft Graph) ----------------
r.get('/cv-inbox', ah(async (_req, res) => res.json(await inboxStatus())));
r.post('/cv-inbox/test', requireWrite, ah(async (_req, res) => res.json(await testInbox())));
r.post('/cv-inbox/poll', requireWrite, ah(async (req, res) => {
  const out = await pollRecruitingInbox({ force: true });
  await audit(req, 'CV_INBOX_POLL', 'cv', null, out);
  res.json({ ...out, status: await inboxStatus() });
}));

export default r;
