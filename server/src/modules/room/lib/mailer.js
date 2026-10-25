// Posta del modulo Room Planning dentro la Suite: la casella mittente e le credenziali Graph sono quelle della Suite (suite@),
// i template HTML e il registro invii (email_log dello schema del modulo) restano quelli dell'app.
// Le email senza allegato passano da sendMail della Suite; quelle con allegato PDF (agende, rendiconti) usano la stessa
// registrazione Graph della Suite, perché il mailer comune non trasporta allegati.
import { one, many } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail as suiteSendMail } from '../../../lib/mailer.js';

export const mailConfigured = () => suite.mail.provider === 'graph';
export const mailStatus = () => ({ configured: mailConfigured(), from: suite.mail.sender || null });

let graphToken = { value: null, exp: 0 };
async function getGraphToken() {
  if (graphToken.value && Date.now() < graphToken.exp - 60_000) return graphToken.value;
  const g = suite.mail.graph;
  const res = await fetch(`https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Token Microsoft non ottenuto: ${j.error_description || res.status}`);
  graphToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function sendViaGraph({ to, cc, subject, html, attachment }) {
  const token = await getGraphToken();
  const msg = {
    subject, body: { contentType: 'HTML', content: html },
    toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
    ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
    attachments: attachment ? [{ '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.filename, contentType: attachment.contentType || 'application/pdf', contentBytes: attachment.base64 }] : [],
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(suite.mail.sender)}/sendMail`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: msg, saveToSentItems: true }),
  });
  if (res.status !== 202) { let d = ''; try { d = (await res.json()).error?.message || ''; } catch { /* */ } throw new Error(`Graph sendMail ${res.status}${d ? `: ${d}` : ''}`); }
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
export function wrapHtml({ title, body, footer, cta }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden">
    <div style="background:#01212C;padding:18px 24px;color:#FFFAE3;font-weight:700;font-size:15px">Toscana Diagnostica · Room Planning</div>
    <div style="padding:22px 24px"><h2 style="margin:0 0 12px;font-size:18px;color:#01212C">${esc(title)}</h2><div style="font-size:14px;line-height:1.5">${esc(body)}</div>
      ${cta !== false && config.baseUrl ? `<p style="margin-top:20px"><a href="${config.baseUrl}" style="background:#1C505E;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:700;font-size:13px">Apri Room Planning</a></p>` : ''}</div>
    <div style="padding:12px 24px;border-top:1px solid #dbe5e7;color:#5b6f75;font-size:11.5px">${esc(footer || 'Messaggio inviato da Room Planning di Toscana Diagnostica (Suite TD).')}</div>
  </div></body></html>`;
}
/** Invia (o registra) una email. Non lancia: l'esito finisce nel registro invii. opts: {kind, refKey, to, cc, subject, title, body, attachment:{filename, base64, contentType}, sedeId, sentBy, cta} */
export async function sendMail(opts) {
  const to = [].concat(opts.to).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  const cc = [].concat(opts.cc || []).filter(Boolean);
  if (!to.length) return { status: 'FALLITA', error: 'Nessun destinatario' };
  if (opts.refKey && await one("SELECT id FROM email_log WHERE ref_key=$1 AND status='INVIATA'", [opts.refKey])) return { status: 'DUPLICATA' };
  let status = 'NON_CONFIGURATA', error = null;
  if (mailConfigured()) {
    const html = wrapHtml({ title: opts.title || opts.subject, body: opts.body, cta: opts.cta, footer: opts.footer });
    try {
      if (opts.attachment) await sendViaGraph({ to, cc, subject: opts.subject, html, attachment: opts.attachment });
      else {
        const r = await suiteSendMail({ to, cc, subject: opts.subject, html, ref: opts.refKey ? `room:${opts.refKey}` : undefined });
        if (!r.ok) throw new Error(r.error || 'invio non riuscito');
      }
      status = 'INVIATA';
    } catch (e) { status = 'FALLITA'; error = e.message; }
  }
  const row = await one(`INSERT INTO email_log (kind, ref_key, sede_id, to_addr, cc_addr, subject, body, attachment_name, status, error, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [opts.kind, opts.refKey || null, opts.sedeId || null, to.join(', '), cc.join(', ') || null, opts.subject, opts.body, opts.attachment?.filename || null, status, error, opts.sentBy || null]);
  return { status, error, id: row.id };
}
// Amministratori del modulo: utenti Suite con grant ADMIN su room, più titolare e amministratori della Suite
export async function adminEmails() {
  return (await many(`SELECT DISTINCT u.email FROM public.users u LEFT JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'room' AND g.proposed = FALSE
      WHERE u.status = 'ACTIVE' AND (g.profile = 'ADMIN' OR u.level IN ('OWNER','ADMIN'))`)).map((x) => x.email);
}
