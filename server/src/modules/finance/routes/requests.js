import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, forbidden, audit, parse, suiteAudit } from '../lib/util.js';
import { requireManage, canManage } from '../lib/access.js';
import { getSettings, computeTier, normalizeIban, validIban } from '../lib/rules.js';
import { loadRequest, addEvent, submit, resend, voidSignatures, aggregationCheck, generateDocument, signers, REQUEST_COLS, REQUEST_FROM } from '../lib/workflow.js';
import { formData, renderDocx, docxToPdf, pdfAvailable } from '../lib/docgen.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida');
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr.nullable());

const requestSchema = z.object({
  request_date: dateStr,
  requester: z.string().trim().min(2).max(160),
  cost_center: optStr(160),
  beneficiary_name: z.string().trim().min(2).max(200),
  beneficiary_tax_id: optStr(40),
  beneficiary_iban: z.string().trim().min(10).max(40),
  beneficiary_bic: optStr(20),
  beneficiary_bank: optStr(160),
  amount: z.coerce.number().positive().max(999999999.99),
  purpose: z.string().trim().min(3).max(600),
  doc_type: z.enum(['FATTURA', 'CONTRATTO', 'ORDINE', 'ALTRO']),
  doc_other: optStr(120),
  doc_number: optStr(80),
  doc_date: optDate,
  bank_account_id: z.coerce.number().int().positive().nullable().optional(),
  payment_method: z.enum(['SEPA', 'URGENTE', 'ESTERO', 'F24', 'ALTRO']),
  payment_method_other: optStr(120),
  value_date: optDate,
  single_signer: z.enum(['CEO', 'CFO']).nullable().optional(),
  board_number: optStr(80),
  board_date: optDate,
  prior_approval: z.boolean().default(false),
  prior_approval_ref: optStr(300),
  checks: z.object({ budget: z.boolean().default(false), aggregation: z.boolean().default(false), documents: z.boolean().default(false), related_party: z.boolean().default(false), cfo_consent: z.boolean().default(false), iban_verified: z.boolean().default(false) }).default({}),
  iban_verified_note: optStr(300),
  notes: optStr(2000),
});

const editable = (st) => ['BOZZA', 'RIFIUTATA', 'IN_FIRMA'].includes(st);

// Anagrafica beneficiario: riconosce la controparte per P.IVA/CF o nome; segnala IBAN mai visto o non confermato
async function upsertBeneficiary(d, client) {
  let b = null;
  if (d.beneficiary_tax_id) b = (await client.query('SELECT * FROM beneficiaries WHERE lower(tax_id)=lower($1)', [d.beneficiary_tax_id])).rows[0];
  if (!b) b = (await client.query('SELECT * FROM beneficiaries WHERE lower(name)=lower($1)', [d.beneficiary_name])).rows[0];
  if (!b) b = (await client.query('INSERT INTO beneficiaries(name, tax_id) VALUES ($1,$2) RETURNING *', [d.beneficiary_name, d.beneficiary_tax_id || null])).rows[0];
  else if (!b.tax_id && d.beneficiary_tax_id) await client.query('UPDATE beneficiaries SET tax_id=$2 WHERE id=$1', [b.id, d.beneficiary_tax_id]);
  let ib = (await client.query('SELECT * FROM beneficiary_ibans WHERE beneficiary_id=$1 AND iban=$2', [b.id, d.beneficiary_iban])).rows[0];
  const known = (await client.query('SELECT count(*)::int AS n FROM beneficiary_ibans WHERE beneficiary_id=$1 AND id<>coalesce($2,0)', [b.id, ib?.id || null])).rows[0].n;
  if (!ib) ib = (await client.query('INSERT INTO beneficiary_ibans(beneficiary_id, iban, bic, bank) VALUES ($1,$2,$3,$4) RETURNING *', [b.id, d.beneficiary_iban, d.beneficiary_bic || null, d.beneficiary_bank || null])).rows[0];
  // "nuovo IBAN": coordinate mai confermate tramite canale indipendente (prima volta o variazione rispetto a IBAN già noti)
  return { beneficiary: b, iban: ib, new_iban: !ib.verified_at, changed: known > 0 && !ib.verified_at };
}

async function prepare(d, s) {
  d.beneficiary_iban = normalizeIban(d.beneficiary_iban);
  if (!validIban(d.beneficiary_iban)) throw bad('IBAN del beneficiario non valido (controllo formale fallito)');
  d.tier = computeTier(d.amount, s);
  if (d.tier !== 'SINGOLA') d.single_signer = null;
  if (d.doc_type !== 'ALTRO') d.doc_other = null;
  if (d.payment_method !== 'ALTRO') d.payment_method_other = null;
  if (!d.prior_approval) d.prior_approval_ref = null;
  let debit = null;
  if (d.bank_account_id) {
    const b = await one('SELECT * FROM bank_accounts WHERE id=$1 AND active', [d.bank_account_id]);
    if (!b) throw bad('Conto di addebito non valido');
    debit = `${b.bank_name} – IBAN ${b.iban}`;
  }
  d.debit_account = debit;
  return d;
}

// Controlli di completezza per l'invio in firma
function submitErrors(r) {
  const e = [];
  if (r.tier === 'SINGOLA' && !r.single_signer) e.push('Per lo scaglione a firma singola indica chi firma (AD o CFO).');
  if (r.tier === 'CDA' && !r.prior_approval && !(r.board_number && r.board_date)) e.push('Oltre la soglia è richiesta la delibera preventiva del CdA: indica numero e data, oppure segnala che il pagamento è già specificamente approvato.');
  if (r.prior_approval && !r.prior_approval_ref) e.push('Indica gli estremi dell\'approvazione già acquisita.');
  if (!r.bank_account_id) e.push('Scegli il conto di addebito.');
  const c = r.checks || {};
  if (!c.budget) e.push('Verifica 1: coerenza con Piano Industriale, Piano Finanziario e budget.');
  if (!c.aggregation) e.push('Verifica 2: aggregazione delle operazioni correlate, nessun frazionamento.');
  if (!c.documents) e.push('Verifica 3: documentazione di supporto disponibile e allegata.');
  if (!c.iban_verified) e.push('Verifica 6: coordinate bancarie verificate.');
  if (r.new_iban && !r.iban_verified_note) e.push('IBAN nuovo o variato: indica come è stato confermato tramite canale indipendente.');
  if (!r.attachments_count) e.push('Allega almeno un documento di supporto (fattura, contratto, ordine, SAL, delibera).');
  return e;
}

// ---------------- Elenco ----------------
r.get('/', ah(async (req, res) => {
  const { status, q: qs, year, tier, mine } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (status) { const list = String(status).split(','); p.push(list); where.push(`r.status = ANY($${p.length})`); }
  if (tier) add('r.tier = ?', tier);
  if (year) add('extract(year from r.request_date) = ?', Number(year));
  if (qs) add("(lower(r.beneficiary_name) LIKE '%'||?||'%' OR lower(coalesce(r.protocol,'')) LIKE '%'||$" + (p.length + 1) + "||'%' OR lower(r.purpose) LIKE '%'||$" + (p.length + 1) + "||'%' OR lower(coalesce(r.doc_number,'')) LIKE '%'||$" + (p.length + 1) + "||'%')", String(qs).toLowerCase());
  if (mine === '1' && ['CEO', 'CFO'].includes(req.user.role)) {
    where.push(`r.status='IN_FIRMA' AND (r.tier<>'SINGOLA' OR r.single_signer='${req.user.role}') AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.request_id=r.id AND s.role='${req.user.role}' AND s.valid)`);
  }
  const rows = await many(`SELECT ${REQUEST_COLS},
      (SELECT json_agg(json_build_object('role', s.role, 'signed_at', s.signed_at) ORDER BY s.signed_at) FROM signatures s WHERE s.request_id=r.id AND s.valid) AS signatures
    ${REQUEST_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 1000`, p);
  res.json(rows);
}));

// ---------------- Dettaglio ----------------
r.get('/:id', ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  x.editable = canManage(req.user) && editable(x.status) && !x.signatures.some((s) => s.valid);
  x.submit_errors = x.editable ? submitErrors(x) : [];
  if (x.status !== 'IN_FIRMA' || !x.aggregation) x.aggregation_live = await aggregationCheck(x, await getSettings());
  res.json(x);
}));

// ---------------- Creazione e modifica ----------------
r.post('/', requireManage, ah(async (req, res) => {
  const s = await getSettings();
  const d = await prepare(parse(requestSchema, req.body), s);
  const row = await tx(async (c) => {
    const b = await upsertBeneficiary(d, c);
    const cols = ['request_date', 'requester', 'cost_center', 'beneficiary_id', 'beneficiary_name', 'beneficiary_tax_id', 'beneficiary_iban', 'beneficiary_bic', 'beneficiary_bank', 'amount', 'purpose', 'doc_type', 'doc_other', 'doc_number', 'doc_date', 'bank_account_id', 'debit_account', 'payment_method', 'payment_method_other', 'value_date', 'tier', 'single_signer', 'board_number', 'board_date', 'prior_approval', 'prior_approval_ref', 'checks', 'new_iban', 'iban_verified_note', 'notes', 'created_by'];
    const vals = { ...d, beneficiary_id: b.beneficiary.id, new_iban: b.new_iban, checks: JSON.stringify(d.checks), created_by: req.user.id };
    return (await c.query(`INSERT INTO payment_requests(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((k) => vals[k] ?? null))).rows[0];
  });
  await addEvent(row.id, 'CREATA', req.user.id, 'Istanza creata in bozza');
  await audit(req, 'REQUEST_CREATE', 'payment_request', row.id, { beneficiary: d.beneficiary_name, amount: d.amount, tier: d.tier });
  res.status(201).json(await loadRequest(row.id));
}));

r.put('/:id', requireManage, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await loadRequest(id);
  if (!cur) throw notFound();
  if (!editable(cur.status) || cur.signatures.some((x) => x.valid)) throw bad('Istanza non modificabile: è già stata firmata o chiusa');
  const s = await getSettings();
  const d = await prepare(parse(requestSchema, req.body), s);
  await tx(async (c) => {
    const b = await upsertBeneficiary(d, c);
    const cols = ['request_date', 'requester', 'cost_center', 'beneficiary_id', 'beneficiary_name', 'beneficiary_tax_id', 'beneficiary_iban', 'beneficiary_bic', 'beneficiary_bank', 'amount', 'purpose', 'doc_type', 'doc_other', 'doc_number', 'doc_date', 'bank_account_id', 'debit_account', 'payment_method', 'payment_method_other', 'value_date', 'tier', 'single_signer', 'board_number', 'board_date', 'prior_approval', 'prior_approval_ref', 'checks', 'new_iban', 'iban_verified_note', 'notes'];
    const vals = { ...d, beneficiary_id: b.beneficiary.id, new_iban: b.new_iban, checks: JSON.stringify(d.checks) };
    const bump = cur.status === 'IN_FIRMA';
    await c.query(`UPDATE payment_requests SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, version = version + ${bump ? 1 : 0}, updated_at=now() WHERE id=$1`, [id, ...cols.map((k) => vals[k] ?? null)]);
    if (bump) await voidSignatures(id, 'Dati modificati dopo l\'invio in firma', c);
  });
  await addEvent(id, 'MODIFICATA', req.user.id, cur.status === 'IN_FIRMA' ? 'Dati modificati durante la firma: link precedenti annullati' : 'Dati modificati');
  await audit(req, 'REQUEST_UPDATE', 'payment_request', id, { amount: d.amount, tier: d.tier, status: cur.status });
  let links = null;
  if (cur.status === 'IN_FIRMA') {
    const fresh = await loadRequest(id);
    const errs = submitErrors(fresh);
    if (errs.length) throw bad(`Dati salvati ma l'istanza non può restare in firma: ${errs.join(' ')}`, errs);
    links = (await submit(fresh, req.user.id, { resubmit: true })).links;
  }
  res.json({ ...(await loadRequest(id)), links });
}));

// ---------------- Invio in firma ----------------
r.post('/:id/submit', requireManage, ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (!['BOZZA', 'RIFIUTATA'].includes(x.status)) throw bad('L\'istanza è già stata inviata in firma');
  const errs = submitErrors(x);
  if (errs.length) throw bad('Istanza incompleta', errs);
  const sg = await signers();
  const missingUsers = (x.tier === 'SINGOLA' ? [x.single_signer] : ['CEO', 'CFO']).filter((role) => !sg[role]);
  if (missingUsers.length) throw bad(`Nessun utente attivo con profilo ${missingUsers.join(' e ')}: censirlo in Utenti (con l'email Microsoft 365) prima di inviare in firma.`);
  if (x.status === 'RIFIUTATA') { await q('UPDATE payment_requests SET version=version+1 WHERE id=$1', [x.id]); x.version += 1; }
  // la conferma dell'IBAN dichiarata nell'istanza viene registrata nell'anagrafica del beneficiario
  if (x.new_iban && x.iban_verified_note && x.beneficiary_id) {
    await q('UPDATE beneficiary_ibans SET verified_at=coalesce(verified_at, now()), verified_by=coalesce(verified_by,$3), verified_note=coalesce(verified_note,$4) WHERE beneficiary_id=$1 AND iban=$2', [x.beneficiary_id, x.beneficiary_iban, req.user.id, x.iban_verified_note]);
  }
  const out = await submit(x, req.user.id, { resubmit: x.status === 'RIFIUTATA' });
  await audit(req, 'REQUEST_SUBMIT', 'payment_request', x.id, { protocol: out.protocol, tier: x.tier, amount: x.amount });
  await suiteAudit(req, 'REQUEST_SUBMIT', 'payment_request', x.id, { protocol: out.protocol, tier: x.tier, amount: x.amount });
  res.json({ ...(await loadRequest(x.id)), links: out.links });
}));

r.post('/:id/resend', requireManage, ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (x.status !== 'IN_FIRMA') throw bad('L\'istanza non è in attesa di firma');
  const links = await resend(x);
  await addEvent(x.id, 'REINVIO', req.user.id, `Nuovi link di firma inviati a: ${x.missing_signers.join(', ')}`);
  await audit(req, 'REQUEST_RESEND', 'payment_request', x.id, { to: x.missing_signers });
  res.json({ ok: true, links });
}));

r.post('/:id/cancel', requireManage, ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (['ESEGUITA', 'ANNULLATA'].includes(x.status)) throw bad('Istanza già chiusa');
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  await tx(async (c) => {
    await c.query('UPDATE payment_requests SET status=\'ANNULLATA\', cancelled_at=now(), cancel_reason=$2, updated_at=now() WHERE id=$1', [x.id, reason]);
    await voidSignatures(x.id, `Istanza annullata: ${reason}`, c);
  });
  await addEvent(x.id, 'ANNULLATA', req.user.id, reason);
  await audit(req, 'REQUEST_CANCEL', 'payment_request', x.id, { reason });
  await suiteAudit(req, 'REQUEST_CANCEL', 'payment_request', x.id, { protocol: x.protocol, reason });
  res.json(await loadRequest(x.id));
}));

// ---------------- Esecuzione (tesoreria) ----------------
r.post('/:id/execute', requireManage, ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (x.status !== 'FIRMATA') throw bad('L\'esecuzione si registra solo su istanze autorizzate');
  const d = parse(z.object({ executed_at: dateStr, cro_trn: z.string().trim().min(3).max(80), executed_by: z.string().trim().min(2).max(120).optional() }), req.body);
  await q('UPDATE payment_requests SET status=\'ESEGUITA\', executed_at=$2, cro_trn=$3, executed_by=$4, executed_recorded_by=$5, executed_recorded_at=now(), updated_at=now() WHERE id=$1',
    [x.id, d.executed_at, d.cro_trn, d.executed_by || req.user.full_name, req.user.id]);
  await addEvent(x.id, 'ESEGUITA', req.user.id, `Pagamento eseguito il ${d.executed_at.split('-').reverse().join('/')} · CRO/TRN ${d.cro_trn}`);
  try { await generateDocument(x.id, 'MODULO_ESEGUITO'); } catch (e) { await addEvent(x.id, 'ERRORE_PDF', req.user.id, e.message); }
  await audit(req, 'REQUEST_EXECUTE', 'payment_request', x.id, d);
  await suiteAudit(req, 'REQUEST_EXECUTE', 'payment_request', x.id, { protocol: x.protocol, ...d });
  res.json(await loadRequest(x.id));
}));

// ---------------- Allegati ----------------
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/msword', 'application/vnd.ms-excel', 'message/rfc822', 'application/vnd.ms-outlook', 'text/plain', 'application/xml', 'text/xml'];
r.post('/:id/attachments', requireManage, upload.array('files', 10), ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (['ESEGUITA', 'ANNULLATA'].includes(x.status)) throw bad('Istanza chiusa: non è possibile aggiungere allegati');
  if (!req.files?.length) throw bad('Nessun file');
  const category = String(req.body.category || 'SUPPORTO').slice(0, 40);
  const out = [];
  for (const f of req.files) {
    if (!ALLOWED.includes(f.mimetype) && !/\.(pdf|jpe?g|png|docx?|xlsx?|msg|eml|xml|p7m)$/i.test(f.originalname)) throw bad(`Tipo di file non ammesso: ${f.originalname}`);
    const sha = crypto.createHash('sha256').update(f.buffer).digest('hex');
    const row = await one('INSERT INTO request_attachments(request_id, category, filename, mime, size, sha256, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, size',
      [x.id, category, f.originalname, f.mimetype, f.size, sha, f.buffer, req.user.id]);
    out.push(row);
  }
  await addEvent(x.id, 'ALLEGATO', req.user.id, `Caricati ${out.length} allegati: ${out.map((a) => a.filename).join(', ')}`);
  await audit(req, 'ATTACHMENT_UPLOAD', 'payment_request', x.id, { files: out.map((a) => a.filename) });
  res.status(201).json(out);
}));
r.delete('/:id/attachments/:aid', requireManage, ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  if (!editable(x.status) || x.signatures.some((s) => s.valid)) throw bad('Gli allegati di un\'istanza firmata non si eliminano');
  const a = await one('DELETE FROM request_attachments WHERE id=$1 AND request_id=$2 RETURNING filename', [Number(req.params.aid), x.id]);
  if (!a) throw notFound();
  await addEvent(x.id, 'ALLEGATO_RIMOSSO', req.user.id, a.filename);
  res.json({ ok: true });
}));

// ---------------- Anteprima del modulo (non archiviata) ----------------
r.get('/:id/preview', ah(async (req, res) => {
  const x = await loadRequest(Number(req.params.id));
  if (!x) throw notFound();
  const s = await getSettings();
  const docx = renderDocx(formData(x, x.signatures, s, await signers()));
  // PDF via LibreOffice se disponibile; se manca o la conversione fallisce l'anteprima viene servita in DOCX (mai bloccante)
  let wantPdf = req.query.format !== 'docx' && await pdfAvailable();
  let buf = docx;
  if (wantPdf) {
    try { buf = await docxToPdf(docx); }
    catch (e) { console.error('[finance:pdf]', e.message); wantPdf = false; res.setHeader('X-Finance-Pdf', 'unavailable'); }
  } else if (req.query.format !== 'docx') res.setHeader('X-Finance-Pdf', 'unavailable');
  res.setHeader('Content-Type', wantPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${(x.protocol || `istanza-${x.id}`)}_anteprima.${wantPdf ? 'pdf' : 'docx'}"`);
  res.send(buf);
}));

export default r;

// Download allegati e documenti generati (montati su /api)
export const filesRouter = Router();
filesRouter.get('/attachments/:id', ah(async (req, res) => {
  const a = await one('SELECT filename, mime, data FROM request_attachments WHERE id=$1', [Number(req.params.id)]);
  if (!a) throw notFound();
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
  res.send(a.data);
}));
filesRouter.get('/documents/:id', ah(async (req, res) => {
  const d = await one('SELECT filename, mime, data FROM generated_documents WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound();
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(d.filename)}"`);
  res.send(d.data);
}));
