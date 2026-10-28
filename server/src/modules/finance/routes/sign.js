// Firma elettronica dal link ricevuto via email: token monouso + sessione Microsoft 365
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, HttpError, suiteAudit } from '../lib/util.js';
import { loadRequest, addEvent, finalize, notifyRejection, voidSignatures } from '../lib/workflow.js';
import { onRequestStatus } from '../lib/scheduleData.js';
import { ROLE_LABEL } from '../lib/docgen.js';

const r = Router();
const hashOf = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Verifica il token e l'identità: ritorna { token, request, problem }
async function resolve(req) {
  const t = await one('SELECT t.*, u.email AS user_email FROM sign_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1', [hashOf(req.params.token)]);
  if (!t) return { problem: 'Link di firma non valido.' };
  const x = await loadRequest(t.request_id);
  const out = { token: t, request: x, role: t.role };
  if (t.used_at) return { ...out, problem: 'Questo link è già stato utilizzato.' };
  if (t.revoked_at) return { ...out, problem: 'Questo link è stato annullato (istanza modificata, rifiutata o reinviata): usa l\'ultima email ricevuta.' };
  if (new Date(t.expires_at) < new Date()) return { ...out, problem: 'Il link è scaduto: chiedi a Finance Support di reinviare la richiesta di firma.' };
  if (t.user_id !== req.user.id) return { ...out, problem: `Il link è personale di ${t.user_email}: sei collegato come ${req.user.email}.` };
  if (req.user.role !== t.role) return { ...out, problem: `Il tuo profilo non è ${ROLE_LABEL[t.role]}.` };
  if (req.session.authMethod !== 'ENTRA' && !config.signAllowLocal) return { ...out, problem: 'La firma richiede l\'accesso alla Suite con Microsoft 365: esci e rientra con il pulsante "Accedi con Microsoft 365".', needEntra: true };
  if (x.status !== 'IN_FIRMA') return { ...out, problem: `L'istanza non è più in attesa di firma (stato: ${x.status}).` };
  if (x.content_hash !== t.content_hash || x.version !== t.version) return { ...out, problem: 'L\'istanza è stata modificata dopo l\'invio di questo link: attendi la nuova email.' };
  if (x.signatures.some((s) => s.role === t.role && s.valid)) return { ...out, problem: 'Hai già firmato questa istanza.' };
  return out;
}

r.get('/:token', ah(async (req, res) => {
  const o = await resolve(req);
  res.json({ ok: !o.problem, problem: o.problem || null, needEntra: Boolean(o.needEntra), role: o.role || null, request: o.request ? { ...o.request, submit_errors: [] } : null });
}));

r.post('/:token', ah(async (req, res) => {
  const o = await resolve(req);
  if (o.problem) throw new HttpError(409, o.problem);
  const { token: t, request: x } = o;
  const sig = await tx(async (c) => {
    // monouso: il token viene consumato nella stessa transazione della firma
    const used = (await c.query('UPDATE sign_tokens SET used_at=now() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id', [t.id])).rows[0];
    if (!used) throw new HttpError(409, 'Link già utilizzato');
    return (await c.query(`INSERT INTO signatures(request_id, role, user_id, user_name, user_email, ip, user_agent, auth_method, content_hash, version, token_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [x.id, t.role, req.user.id, `${req.user.title ? `${req.user.title} ` : ''}${req.user.full_name}`, req.user.email, req.ip, String(req.get('user-agent') || '').slice(0, 300), req.session.authMethod, x.content_hash, x.version, t.id])).rows[0];
  });
  await addEvent(x.id, 'FIRMA', req.user.id, `Firmata dal ${ROLE_LABEL[t.role]} (${req.user.email}) · accesso ${req.session.authMethod === 'ENTRA' ? 'Microsoft 365' : 'locale'}`, { ip: req.ip, content_hash: x.content_hash, version: x.version });
  await audit(req, 'REQUEST_SIGN', 'payment_request', x.id, { role: t.role, content_hash: x.content_hash, version: x.version });
  await suiteAudit(req, 'REQUEST_SIGN', 'payment_request', x.id, { protocol: x.protocol, role: t.role, content_hash: x.content_hash, version: x.version });
  const after = await loadRequest(x.id);
  if (!after.missing_signers.length) await finalize(x.id);
  res.json({ ok: true, signed_at: sig.signed_at, completed: !after.missing_signers.length, request: await loadRequest(x.id) });
}));

r.post('/:token/reject', ah(async (req, res) => {
  const o = await resolve(req);
  if (o.problem) throw new HttpError(409, o.problem);
  const { token: t, request: x } = o;
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'motivazione troppo breve').max(1000) }), req.body);
  await tx(async (c) => {
    await c.query('UPDATE sign_tokens SET used_at=now() WHERE id=$1', [t.id]);
    await c.query('UPDATE payment_requests SET status=\'RIFIUTATA\', rejected_reason=$2, updated_at=now() WHERE id=$1', [x.id, reason]);
    await voidSignatures(x.id, `Rifiuto del ${ROLE_LABEL[t.role]}`, c);
    await onRequestStatus(x.id, 'RIFIUTATA', { client: c, userId: req.user.id });   // scadenziario: la scadenza collegata torna aperta
  });
  const who = `${req.user.title ? `${req.user.title} ` : ''}${req.user.full_name}`;
  await addEvent(x.id, 'RIFIUTO', req.user.id, `Rifiutata dal ${ROLE_LABEL[t.role]}: ${reason}`);
  await audit(req, 'REQUEST_REJECT', 'payment_request', x.id, { role: t.role, reason });
  await suiteAudit(req, 'REQUEST_REJECT', 'payment_request', x.id, { protocol: x.protocol, role: t.role, reason });
  await notifyRejection(x.id, { role: t.role, user_name: who, reason });
  res.json({ ok: true, request: await loadRequest(x.id) });
}));

export default r;
