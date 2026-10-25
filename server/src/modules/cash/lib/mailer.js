// Posta del modulo Cash Management dentro la Suite.
// Invio: sendMail della Suite (casella suite@, Microsoft Graph oppure solo registro), con i template HTML dell'app di origine;
// l'esito viene registrato anche nell'email_log del modulo, con la stessa forma che le pagine dell'app si aspettano.
// Gli allegati PDF (report royalty) passano al mailer della Suite come { filename, content, contentType }.
import { one, many } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail as suiteSendMail } from '../../../lib/mailer.js';

export const mailConfigured = () => suite.mail.provider === 'graph';
export const mailStatus = () => ({
  configured: mailConfigured(),
  mode: mailConfigured() ? 'microsoft365' : null,
  from: suite.mail.sender || null,
  host: null, port: null,
});

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

// Testo semplice -> HTML con intestazione aziendale sobria (template dell'app di origine)
export function wrapHtml({ title, body, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden">
    <div style="background:#01212C;padding:18px 24px;color:#FFFAE3;font-weight:700;font-size:15px">Toscana Diagnostica · Cash Management</div>
    <div style="padding:22px 24px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#01212C">${esc(title)}</h2>
      <div style="font-size:14px;line-height:1.5">${esc(body)}</div>
      ${config.baseUrl && !/localhost/.test(config.baseUrl) ? `<p style="margin-top:20px"><a href="${config.baseUrl}" style="background:#1C505E;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:700;font-size:13px">Apri Cash Management</a></p>` : ''}
    </div>
    <div style="padding:12px 24px;border-top:1px solid #dbe5e7;color:#5b6f75;font-size:11.5px">${esc(footer || 'Messaggio generato automaticamente dal sistema Cash Management. Non rispondere a questa email.')}</div>
  </div></body></html>`;
}

/**
 * Invia (o registra) una email. Non lancia mai: l'esito finisce nel registro invii del modulo.
 * opts: { kind, refKey, to, cc, subject, body, title, attachment: {filename, content}, companyId, siteId, sentBy }
 */
export async function sendMail(opts) {
  const to = [].concat(opts.to).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  const cc = [].concat(opts.cc || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (!to.length) return { status: 'FALLITA', error: 'Nessun destinatario' };
  if (opts.refKey) {
    const dup = await one("SELECT id FROM email_log WHERE ref_key=$1 AND status='INVIATA'", [opts.refKey]);
    if (dup) return { status: 'DUPLICATA', id: dup.id };
  }
  let status = 'NON_CONFIGURATA', error = null;
  const html = wrapHtml({ title: opts.title || opts.subject, body: opts.body });
  const attachments = opts.attachment ? [{ filename: opts.attachment.filename, content: opts.attachment.content, contentType: 'application/pdf' }] : [];
  const ref = opts.refKey ? `cash:${opts.refKey}` : 'cash';
  if (mailConfigured()) {
    const out = await suiteSendMail({ to, cc, subject: opts.subject, html, text: opts.body, ref, attachments });
    if (out.ok) status = 'INVIATA'; else { status = 'FALLITA'; error = out.error || 'Invio non riuscito'; }
  } else {
    // provider "log": la Suite registra soltanto; nel registro del modulo resta NON_CONFIGURATA come nell'app
    await suiteSendMail({ to, cc, subject: opts.subject, html, text: opts.body, ref, attachments }).catch(() => {});
  }
  const row = await one(`INSERT INTO email_log (company_id, site_id, kind, ref_key, to_addr, cc_addr, subject, body, attachment_name, status, error, sent_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [opts.companyId || null, opts.siteId || null, opts.kind, opts.refKey || null, to.join(', '), cc.join(', ') || null, opts.subject, opts.body,
    opts.attachment?.filename || null, status, error, opts.sentBy || null]);
  return { status, error, id: row.id };
}

// Destinatari amministratori di un'azienda (email degli utenti ADMIN attivi del modulo)
export async function adminEmails(companyId) {
  return (await many(`SELECT email FROM users WHERE company_id=$1 AND role='ADMIN' AND active`, [companyId])).map((x) => x.email);
}
