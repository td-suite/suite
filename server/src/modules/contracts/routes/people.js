// Casella People (people@toscanadiagnostica.it), montata su /api/contracts/people-inbox.
// Impostazioni e prove (ADMIN e HR del modulo), registro dei richiami, messaggi ricevuti con approvazione (CEO = OWNER della Suite,
// HR Manager = profilo HR o ADMIN; VIEWER 403), endpoint di servizio /simula per il collaudo (mai con NODE_ENV=production).
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireWrite, requireApprover, readLog } from '../lib/access.js';
import { config } from '../config.js';
import { sendFile } from '../../../lib/moduleStorage.js';
import { CATEGORY_LABELS } from '../lib/seedData.js';
import { computeDeadlines } from '../lib/deadlines.js';
import { RECIPIENTS, DEFAULT_MAP, parseThresholds, parseEmailList } from '../lib/peopleRules.js';
import { peopleStatus, setSetting, runReminders, testSend, testPeopleInbox } from '../lib/peopleMail.js';
import { ingestMessage, pollPeopleInbox, closeApprovedMessage, approveMessage, rejectMessage, ignoreMessage } from '../lib/peopleInbox.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });
const dev = () => process.env.NODE_ENV !== 'production';
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

// ---------------- impostazioni, stato e prove ----------------
r.get('/stato', requireApprover, ah(async (_req, res) => res.json({ ...(await peopleStatus()), env_override: Boolean(process.env.CONTRACTS_PEOPLE_MAILBOX), recipients: RECIPIENTS, simulation: dev() })));

r.put('/impostazioni', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({
    people_mailbox: z.string().trim().max(200).optional(),
    people_send_enabled: z.boolean().optional(),
    people_read_enabled: z.boolean().optional(),
    people_reminder_days: z.union([z.string(), z.array(z.number())]).optional(),
    people_hr_cc: z.union([z.string(), z.array(z.string())]).optional(),
    people_reminder_map: z.record(z.enum(RECIPIENTS)).optional(),
  }), req.body);
  if (d.people_mailbox !== undefined) {
    if (d.people_mailbox && !parseEmailList(d.people_mailbox).length) throw bad('Indirizzo della casella People non valido');
    await setSetting('people_mailbox', d.people_mailbox.toLowerCase());
  }
  if (d.people_send_enabled !== undefined) await setSetting('people_send_enabled', d.people_send_enabled ? 'true' : 'false');
  if (d.people_read_enabled !== undefined) await setSetting('people_read_enabled', d.people_read_enabled ? 'true' : 'false');
  if (d.people_reminder_days !== undefined) await setSetting('people_reminder_days', parseThresholds(d.people_reminder_days).join(','));
  if (d.people_hr_cc !== undefined) await setSetting('people_hr_cc', parseEmailList(d.people_hr_cc).join(', '));
  if (d.people_reminder_map !== undefined) {
    const map = { ...DEFAULT_MAP };
    for (const [k, v] of Object.entries(d.people_reminder_map)) if (k in DEFAULT_MAP) map[k] = v;
    await setSetting('people_reminder_map', JSON.stringify(map));
  }
  await audit(req, 'PEOPLE_SETTINGS_UPDATE', 'settings', null, d);
  res.json(await peopleStatus());
}));

r.post('/prova-invio', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ to: z.string().trim().min(3).max(200) }), req.body);
  const out = await testSend(d.to);
  await audit(req, 'PEOPLE_TEST_SEND', 'settings', null, { to: d.to, ok: out.ok });
  res.json(out);
}));
r.post('/prova-casella', requireWrite, ah(async (_req, res) => res.json(await testPeopleInbox())));
r.post('/leggi', requireApprover, ah(async (req, res) => {
  const out = await pollPeopleInbox({ force: true });
  await audit(req, 'PEOPLE_INBOX_POLL', 'people_inbox', null, out);
  res.json(out);
}));

// ---------------- richiami ----------------
r.get('/richiami', requireApprover, ah(async (req, res) => {
  const rid = req.query.resource_id ? Number(req.query.resource_id) : null;
  res.json(await many(`SELECT d.*, r.last_name, r.first_name FROM deadline_reminders d LEFT JOIN resources_v r ON r.id=d.resource_id
    ${rid ? 'WHERE d.resource_id=$1' : ''} ORDER BY d.sent_at DESC LIMIT 300`, rid ? [rid] : []));
}));
// Esecuzione manuale del job dei richiami ("Invia ora"); la data forzata (oggi) è ammessa solo fuori produzione, per il collaudo
r.post('/richiami/esegui', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ oggi: z.string().regex(dateRe).optional() }), req.body || {});
  if (d.oggi && !dev()) throw bad('La data forzata è ammessa solo in sviluppo');
  const out = await runReminders({ today: d.oggi || null, force: true });
  await audit(req, 'PEOPLE_REMINDERS_RUN', 'deadline_reminders', null, out);
  res.json(out);
}));

// ---------------- messaggi ricevuti ----------------
const STATUSES = ['DA_APPROVARE', 'APPROVATO', 'RIFIUTATO', 'IGNORATO'];
r.get('/', requireApprover, ah(async (req, res) => {
  const st = STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = await many(`SELECT p.id, p.received_at, p.from_email, p.from_name, p.subject, p.resource_id, p.deadline_key, p.match_method, p.status,
      p.decided_at, p.note, p.source, r.last_name, r.first_name, u.full_name AS decided_by_name,
      (SELECT count(*)::int FROM people_inbox_files f WHERE f.inbox_id=p.id) AS files
    FROM people_inbox p LEFT JOIN resources_v r ON r.id=p.resource_id LEFT JOIN users u ON u.id=p.decided_by
    ${st ? 'WHERE p.status=$1' : ''} ORDER BY p.received_at DESC LIMIT 300`, st ? [st] : []);
  res.json(rows);
}));

r.get('/:id(\\d+)', requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  const row = await one(`SELECT p.*, r.last_name, r.first_name, r.kind, r.email AS resource_email, u.full_name AS decided_by_name
    FROM people_inbox p LEFT JOIN resources_v r ON r.id=p.resource_id LEFT JOIN users u ON u.id=p.decided_by WHERE p.id=$1`, [id]);
  if (!row) throw notFound('Messaggio non trovato');
  const files = await many(`SELECT id, filename, mime, size, proposed_category, proposed_expires_at, proposed_holder, confidence, quote, method,
    approved_category, approved_expires_at, include, attachment_id FROM people_inbox_files WHERE inbox_id=$1 ORDER BY id`, [id]);
  const deadlines = row.resource_id ? (await computeDeadlines({ resourceId: row.resource_id, includeClosed: row.status !== 'DA_APPROVARE' })).map((x) => ({ key: x.key, type: x.type, title: x.title, due_date: x.due_date, days: x.days, state: x.state })) : [];
  await readLog(req, 'people_inbox', id);
  res.json({ message: row, files, deadlines, category_labels: CATEGORY_LABELS });
}));

r.put('/:id(\\d+)', requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(z.object({ resource_id: z.number().int().nullable().optional(), deadline_key: z.string().max(60).nullable().optional() }), req.body);
  const row = await one('SELECT status, resource_id FROM people_inbox WHERE id=$1', [id]);
  if (!row) throw notFound();
  if (row.status !== 'DA_APPROVARE') throw bad('Messaggio già gestito');
  if (d.resource_id && !await one('SELECT 1 FROM resources_v WHERE id=$1', [d.resource_id])) throw bad('Persona inesistente');
  const resourceChanged = d.resource_id !== undefined && d.resource_id !== row.resource_id;
  await one(`UPDATE people_inbox SET resource_id=CASE WHEN $2 THEN $3 ELSE resource_id END,
      deadline_key=CASE WHEN $4 THEN $5 WHEN $2 THEN NULL ELSE deadline_key END,
      match_method=CASE WHEN $2 OR $4 THEN 'MANUALE' ELSE match_method END WHERE id=$1 RETURNING id`,
  [id, d.resource_id !== undefined, d.resource_id ?? null, d.deadline_key !== undefined, d.deadline_key || null]);
  await audit(req, 'PEOPLE_INBOX_ASSIGN', 'people_inbox', id, { ...d, resource_changed: resourceChanged });
  res.json({ ok: true });
}));

const approveSchema = z.object({
  resource_id: z.number().int().optional(),
  deadline_key: z.string().max(60).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  files: z.array(z.object({ id: z.number().int(), include: z.boolean().optional(), category: z.string().max(40).optional(), expires_at: z.string().regex(dateRe).nullable().optional() })).optional(),
});
r.post('/:id(\\d+)/approva', requireApprover, ah(async (req, res) => res.json(await approveMessage(req, Number(req.params.id), parse(approveSchema, req.body || {})))));
r.post('/:id(\\d+)/chiudi-scadenza', requireApprover, ah(async (req, res) => res.json(await closeApprovedMessage(req, Number(req.params.id), parse(z.object({ deadline_key: z.string().max(60), note: z.string().max(1000).nullable().optional() }), req.body || {})))));
r.post('/:id(\\d+)/rifiuta', requireApprover, ah(async (req, res) => res.json(await rejectMessage(req, Number(req.params.id), parse(z.object({ reason: z.string().max(1000) }), req.body || {})))));
r.post('/:id(\\d+)/ignora', requireApprover, ah(async (req, res) => res.json(await ignoreMessage(req, Number(req.params.id), parse(z.object({ note: z.string().max(1000).nullable().optional() }), req.body || {})))));

r.get('/files/:fid(\\d+)', requireApprover, ah(async (req, res) => {
  const f = await one('SELECT id, inbox_id, filename, mime, data, blob_path FROM people_inbox_files WHERE id=$1', [Number(req.params.fid)]);
  if (!f) throw notFound();
  await readLog(req, 'people_inbox_file', f.id);
  await sendFile(res, f, { inline: req.query.inline === '1' && /^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.mime) });
}));

// ---------------- simulazione di arrivo (solo sviluppo e collaudo) ----------------
// multipart: from_email, from_name, subject, body + file (uno o più); oppure JSON con files: [{ filename, mime, base64 }]
r.post('/simula', requireWrite, upload.array('file', 10), ah(async (req, res) => {
  if (!dev()) throw notFound('Endpoint inesistente');
  const b = req.body || {};
  const files = (req.files || []).map((f) => ({ filename: Buffer.from(f.originalname, 'latin1').toString('utf8'), mime: f.mimetype, buffer: f.buffer }))
    .concat((Array.isArray(b.files) ? b.files : []).map((f) => ({ filename: f.filename, mime: f.mime, buffer: Buffer.from(String(f.base64 || ''), 'base64') })));
  const out = await ingestMessage({ graphId: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date(), fromEmail: b.from_email, fromName: b.from_name, subject: b.subject, bodyText: b.body, files, source: 'SIMULAZIONE', userId: req.suiteUser?.id });
  if (out.skipped) throw bad('Nessun allegato PDF, Word o immagine nel messaggio simulato');
  await audit(req, 'PEOPLE_INBOX_SIMULATE', 'people_inbox', out.id, { files: out.files, match: out.match_method });
  res.status(201).json(out);
}));

export default r;
