// Flusso dell'istanza: invio in firma, link monouso, firma, rifiuto, completamento, PDF, notifiche, solleciti
import crypto from 'node:crypto';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { itDate, itDateTime, HttpError } from './util.js';
import { getSettings, requiredSigners, contentHash, eur, TIER_LABEL } from './rules.js';
import { sendMail, layout } from './mail.js';
import { formData, renderDocx, docxToPdf, pdfAvailable, ROLE_LABEL } from './docgen.js';

export const REQUEST_COLS = `r.*, (SELECT count(*)::int FROM request_attachments a WHERE a.request_id=r.id) AS attachments_count,
  u.full_name AS created_by_name, b.label AS bank_label`;
export const REQUEST_FROM = 'FROM payment_requests r JOIN users u ON u.id=r.created_by LEFT JOIN bank_accounts b ON b.id=r.bank_account_id';

export async function loadRequest(id) {
  const r = await one(`SELECT ${REQUEST_COLS} ${REQUEST_FROM} WHERE r.id=$1`, [id]);
  if (!r) return null;
  r.signatures = await many('SELECT id, role, user_id, user_name, user_email, signed_at, auth_method, content_hash, version, valid, voided_at, voided_reason, ip FROM signatures WHERE request_id=$1 ORDER BY signed_at', [id]);
  r.events = await many('SELECT e.id, e.kind, e.note, e.data, e.at, u.full_name AS user_name FROM request_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.request_id=$1 ORDER BY e.at', [id]);
  r.attachments = await many('SELECT a.id, a.category, a.filename, a.mime, a.size, a.sha256, a.created_at, u.full_name AS uploaded_by_name FROM request_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.request_id=$1 ORDER BY a.created_at', [id]);
  r.documents = await many('SELECT id, kind, filename, mime, size, sha256, version, created_at FROM generated_documents WHERE request_id=$1 ORDER BY created_at', [id]);
  r.pending = await many(`SELECT t.role, t.sent_at, t.expires_at, t.reminder, u.full_name AS user_name FROM sign_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.request_id=$1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now() ORDER BY t.sent_at`, [id]);
  r.required_signers = requiredSigners(r);
  r.missing_signers = r.required_signers.filter((role) => !r.signatures.some((s) => s.role === role && s.valid));
  return r;
}

export async function addEvent(requestId, kind, userId, note, data) {
  await q('INSERT INTO request_events(request_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [requestId, kind, userId || null, note || null, data ? JSON.stringify(data) : null]);
}

export async function signerUser(role) {
  return one('SELECT id, email, full_name, title, role FROM users WHERE role=$1 AND active', [role]);
}
export async function signers() {
  return { CEO: await signerUser('CEO'), CFO: await signerUser('CFO') };
}

// Protocollo progressivo per anno
export async function nextProtocol(client, prefix, year) {
  const row = (await client.query('INSERT INTO protocol_counters(year, last) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last=protocol_counters.last+1 RETURNING last', [year])).rows[0];
  return `${prefix}-${year}-${String(row.last).padStart(4, '0')}`;
}

// Istanze correlate alla stessa controparte nella finestra di controllo (anti-frazionamento)
export async function aggregationCheck(r, s) {
  const days = Number(s.aggregation_days || 90);
  const rows = await many(`SELECT id, protocol, request_date, amount, status, purpose FROM payment_requests
    WHERE id<>$1 AND status NOT IN ('ANNULLATA','RIFIUTATA') AND request_date >= $2::date - ($3 || ' days')::interval
      AND (beneficiary_iban=$4 OR (beneficiary_tax_id IS NOT NULL AND beneficiary_tax_id<>'' AND beneficiary_tax_id=$5) OR lower(beneficiary_name)=lower($6))
    ORDER BY request_date DESC`, [r.id || 0, r.request_date, days, r.beneficiary_iban, r.beneficiary_tax_id || '', r.beneficiary_name]);
  const total = rows.reduce((a, x) => a + Number(x.amount), Number(r.amount));
  const single = Number(s.threshold_single); const joint = Number(s.threshold_joint);
  const a = Number(r.amount);
  let warning = null;
  if (rows.length) {
    if (a <= single && total > single) warning = `Nella finestra di ${days} giorni la stessa controparte totalizza ${eur(total)}: aggregando le operazioni correlate si supera la soglia di firma singola (${eur(single)}).`;
    else if (a <= joint && total > joint) warning = `Nella finestra di ${days} giorni la stessa controparte totalizza ${eur(total)}: aggregando le operazioni correlate si supera la soglia che richiede la delibera del CdA (${eur(joint)}).`;
  }
  return { days, related: rows, total, warning };
}

const requestRows = (r) => [
  ['Protocollo', r.protocol], ['Beneficiario', r.beneficiary_name], ['IBAN', r.beneficiary_iban], ['Importo', eur(r.amount)],
  ['Causale', r.purpose], ['Scaglione', TIER_LABEL[r.tier]], ['Data richiesta', itDate(r.request_date)], ['Richiedente', r.requester],
  ['Data valuta richiesta', r.value_date ? itDate(r.value_date) : null],
];

const ccList = (s) => (s.mail_cc || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

// Revoca i link attivi e invalida le firme (modifica dei dati, rifiuto, annullamento)
export async function voidSignatures(requestId, reason, client = { query: (t, p) => q(t, p) }) {
  await client.query('UPDATE sign_tokens SET revoked_at=now() WHERE request_id=$1 AND used_at IS NULL AND revoked_at IS NULL', [requestId]);
  await client.query('UPDATE signatures SET valid=FALSE, voided_at=now(), voided_reason=$2 WHERE request_id=$1 AND valid', [requestId, reason]);
}

// Crea il link di firma per un ruolo e invia la mail
export async function issueToken(r, role, { reminder = false } = {}) {
  const s = await getSettings();
  const u = await signerUser(role);
  if (!u) throw new Error(`Nessun utente attivo con profilo ${role}: censirlo in Utenti prima di inviare in firma`);
  await q('UPDATE sign_tokens SET revoked_at=now() WHERE request_id=$1 AND role=$2 AND used_at IS NULL AND revoked_at IS NULL', [r.id, role]);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const days = Number(s.token_days || 15);
  await q('INSERT INTO sign_tokens(request_id, role, user_id, token_hash, content_hash, version, expires_at, reminder) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || \' days\')::interval, $8)',
    [r.id, role, u.id, hash, r.content_hash, r.version, String(days), reminder]);
  const url = `${config.baseUrl}/firma/${token}`;
  const other = role === 'CEO' ? 'CFO' : 'CEO';
  const both = r.tier !== 'SINGOLA';
  const html = layout({
    title: `${reminder ? 'Sollecito: ' : ''}Autorizzazione al pagamento ${r.protocol}`,
    intro: `${u.title ? `${u.title} ` : ''}${u.full_name}, Finance Support ha inserito un'istanza di pagamento che richiede la tua firma in qualità di ${ROLE_LABEL[role]}${both ? ` (firma congiunta con il ${ROLE_LABEL[other]})` : ' (firma singola)'}.${r.aggregation?.warning ? `<br><b style="color:#b3372f">Attenzione:</b> ${r.aggregation.warning}` : ''}`,
    rows: requestRows(r),
    button: { url, label: 'Apri e firma con Microsoft 365' },
    note: `Il link è personale, valido ${days} giorni e utilizzabile una sola volta. La firma richiede l'accesso con il tuo account Microsoft 365: vengono registrati data, ora e identità. Dal link puoi anche rifiutare l'istanza indicando la motivazione. Cruscotto: <a href="${config.baseUrl}">${config.baseUrl}</a>`,
  });
  await sendMail({ to: u.email, cc: ccList(s), subject: `${reminder ? '[Sollecito] ' : ''}Firma richiesta · ${r.protocol} · ${r.beneficiary_name} · ${eur(r.amount)}`, html });
  if (config.mail.mode !== 'GRAPH') console.log(`[firma] link ${role}: ${url}`);
  return { url: config.mail.mode !== 'GRAPH' ? url : undefined, user: u };
}

// Invio in firma: protocollo, impronta, link a tutti i firmatari richiesti
export async function submit(r, userId, { resubmit = false } = {}) {
  const s = await getSettings();
  const agg = await aggregationCheck(r, s);
  await tx(async (c) => {
    let protocol = r.protocol;
    if (!protocol) protocol = await nextProtocol(c, s.protocol_prefix || 'AP', new Date(r.request_date).getFullYear());
    r.protocol = protocol;
    r.content_hash = contentHash(r);
    await c.query('UPDATE payment_requests SET protocol=$2, status=\'IN_FIRMA\', content_hash=$3, submitted_at=now(), aggregation=$4, rejected_reason=NULL, updated_at=now() WHERE id=$1',
      [r.id, protocol, r.content_hash, JSON.stringify(agg)]);
  });
  r.aggregation = agg;
  await addEvent(r.id, resubmit ? 'RIINVIATA' : 'INVIATA', userId, `Inviata in firma (${TIER_LABEL[r.tier]})`, { protocol: r.protocol, version: r.version, aggregation_warning: agg.warning });
  const links = {};
  const failed = [];
  for (const role of requiredSigners(r)) {
    try {
      const res = await issueToken(r, role);
      if (res.url) links[role] = res.url;
    } catch (e) {
      failed.push(`${role}: ${e.message}`);
      await addEvent(r.id, 'ERRORE_MAIL', userId, `Email al ${role} non inviata: ${e.message}`);
      console.error('[mail]', e.message);
    }
  }
  if (failed.length) throw new HttpError(502, `Istanza protocollata (${r.protocol}) e in firma, ma l'email non è partita. ${failed.join('; ')}. Controlla Impostazioni > Invio email, poi usa "Reinvia link".`);
  return { protocol: r.protocol, links, aggregation: agg };
}

// Nuovi link ai firmatari che non hanno ancora firmato
export async function resend(r, { reminder = false } = {}) {
  const links = {};
  for (const role of r.missing_signers) {
    try {
      const res = await issueToken(r, role, { reminder });
      if (res.url) links[role] = res.url;
    } catch (e) {
      await addEvent(r.id, 'ERRORE_MAIL', null, `Email al ${role} non inviata: ${e.message}`);
      throw new HttpError(502, `Email al ${role} non inviata: ${e.message}`);
    }
  }
  return links;
}

// Genera e archivia il PDF del modulo
export async function generateDocument(requestId, kind) {
  const r = await loadRequest(requestId);
  const s = await getSettings();
  const data = formData(r, r.signatures, s, await signers());
  const docx = renderDocx(data);
  let buf = docx; let mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; let ext = 'docx';
  // PDF via LibreOffice quando disponibile; altrimenti il modulo resta in DOCX e il flusso prosegue (mai bloccante)
  let pdfNote = null;
  if (await pdfAvailable()) {
    try { buf = await docxToPdf(docx); mime = 'application/pdf'; ext = 'pdf'; }
    catch (e) { pdfNote = `Conversione PDF non riuscita (${e.message}): modulo archiviato in formato DOCX`; console.error('[finance:pdf]', e.message); }
  } else pdfNote = 'LibreOffice (soffice) non disponibile sul server: modulo archiviato in formato DOCX';
  if (pdfNote) await addEvent(requestId, 'ERRORE_PDF', null, pdfNote);
  const filename = `${r.protocol || `istanza-${r.id}`}_${kind === 'MODULO_FIRMATO' ? 'autorizzazione' : 'eseguito'}.${ext}`;
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const row = await one('INSERT INTO generated_documents(request_id, kind, filename, mime, size, sha256, data, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime, size',
    [requestId, kind, filename, mime, buf.length, sha, buf, r.version]);
  return { ...row, data: buf };
}

// Chiusura delle firme: stato FIRMATA, PDF, notifica a chi ha inserito e ai firmatari
export async function finalize(requestId) {
  await q('UPDATE payment_requests SET status=\'FIRMATA\', signed_at=now(), updated_at=now() WHERE id=$1', [requestId]);
  await addEvent(requestId, 'FIRMATA', null, 'Tutte le firme richieste sono state apposte');
  let doc = null;
  try { doc = await generateDocument(requestId, 'MODULO_FIRMATO'); } catch (e) { console.error('[pdf]', e.message); await addEvent(requestId, 'ERRORE_PDF', null, e.message); }
  const r = await loadRequest(requestId);
  const s = await getSettings();
  const creator = await one('SELECT email, full_name FROM users WHERE id=$1', [r.created_by]);
  const to = [creator?.email, ...r.signatures.filter((x) => x.valid).map((x) => x.user_email)].filter(Boolean);
  const html = layout({
    title: `Autorizzazione completata · ${r.protocol}`,
    intro: `L'istanza è stata autorizzata: ${r.signatures.filter((x) => x.valid).map((x) => `${x.user_name} (${ROLE_LABEL[x.role]}) il ${itDateTime(x.signed_at)}`).join('; ')}. Finance Support può procedere all'esecuzione e registrare CRO/TRN nell'applicazione.`,
    rows: requestRows(r),
    button: { url: `${config.baseUrl}/istanze/${r.id}`, label: 'Apri l\'istanza' },
    note: doc ? 'In allegato il modulo di autorizzazione con le firme elettroniche.' : 'Il modulo PDF non è stato generato: è disponibile dall\'applicazione.',
  });
  try {
    await sendMail({ to, cc: ccList(s), subject: `Autorizzazione completata · ${r.protocol} · ${r.beneficiary_name} · ${eur(r.amount)}`, html, attachments: doc ? [doc] : [] });
  } catch (e) { console.error('[mail]', e.message); await addEvent(requestId, 'ERRORE_MAIL', null, e.message); }
}

export async function notifyRejection(requestId, signature) {
  const r = await loadRequest(requestId);
  const s = await getSettings();
  const creator = await one('SELECT email, full_name FROM users WHERE id=$1', [r.created_by]);
  const sg = await signers();
  const to = [creator?.email, sg.CEO?.email, sg.CFO?.email].filter(Boolean);
  const html = layout({
    title: `Istanza rifiutata · ${r.protocol}`,
    intro: `${signature.user_name} (${ROLE_LABEL[signature.role]}) ha rifiutato l'istanza con questa motivazione:<br><b>${signature.reason}</b><br>Le firme e i link già emessi sono annullati. Finance Support può correggere l'istanza e inviarla nuovamente in firma.`,
    rows: requestRows(r),
    button: { url: `${config.baseUrl}/istanze/${r.id}`, label: 'Apri l\'istanza' },
  });
  try { await sendMail({ to, cc: ccList(s), subject: `Istanza rifiutata · ${r.protocol} · ${r.beneficiary_name}`, html }); } catch (e) { console.error('[mail]', e.message); }
}

// Solleciti automatici: firmatari con link emesso da più di reminder_days giorni e nessuna firma
export async function runReminders() {
  const s = await getSettings();
  const days = Number(s.reminder_days || 0);
  if (!days) return;
  const rows = await many(`SELECT r.id FROM payment_requests r WHERE r.status='IN_FIRMA' AND EXISTS (
      SELECT 1 FROM sign_tokens t WHERE t.request_id=r.id AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.sent_at < now() - ($1 || ' days')::interval)`, [String(days)]);
  for (const row of rows) {
    const r = await loadRequest(row.id);
    const stale = r.pending.filter((p) => new Date(p.sent_at) < Date.now() - days * 86400000).map((p) => p.role);
    for (const role of stale) {
      try { await issueToken(r, role, { reminder: true }); await addEvent(r.id, 'SOLLECITO', null, `Sollecito automatico inviato al ${ROLE_LABEL[role]}`); }
      catch (e) { console.error('[sollecito]', e.message); }
    }
  }
}
