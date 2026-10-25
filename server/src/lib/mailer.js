// Posta in uscita via Microsoft Graph dalla casella suite@toscanadiagnostica.it (permesso applicativo Mail.Send,
// limitato alla casella con una Application Access Policy). MAIL_PROVIDER=log scrive solo nel registro.
import { q } from '../db.js';
import { config } from '../config.js';

let token = { value: null, exp: 0 };
async function graphToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const g = config.mail.graph;
  const res = await fetch(`https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Token Microsoft non ottenuto: ${j.error_description || res.status}`);
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

export const mailStatus = () => ({ provider: config.mail.provider, sender: config.mail.sender });

export function layout(title, bodyHtml) {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dbe5e7">
    <div style="background:#01212C;padding:18px 24px;color:#fff;font-weight:700;font-size:15px">Suite TD <span style="color:#71B1BD;font-weight:600"> · Toscana Diagnostica</span></div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;color:#1C505E;font-size:18px">${title}</h2>${bodyHtml}</div>
    <div style="padding:14px 24px;background:#f3f6f6;color:#5b6f75;font-size:12px">Messaggio automatico di ${config.baseUrl}. Non rispondere a questa email.</div>
  </div></body></html>`;
}

export async function sendMail({ to, cc = [], subject, html, text, ref, attachments = [] }) {
  // attachments: [{ filename, content (Buffer), contentType }]
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) return { ok: false, skipped: true };
  const log = async (status, error) => q('INSERT INTO email_log (to_addr, subject, status, error, ref) VALUES ($1,$2,$3,$4,$5)', [toList.join(', '), subject, status, error || null, ref || null]);
  if (config.mail.provider !== 'graph') { await log('LOGGED'); console.log(`[mail:log] → ${toList.join(', ')} · ${subject}`); return { ok: true, logged: true }; }
  try {
    const tok = await graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mail.sender)}/sendMail`, {
      method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ saveToSentItems: true, message: {
        subject, body: { contentType: 'HTML', content: html || `<pre>${text || ''}</pre>` },
        toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
        attachments: (attachments || []).filter((a) => a && a.content).map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename || 'allegato', contentType: a.contentType || 'application/octet-stream', contentBytes: Buffer.from(a.content).toString('base64') })),
      } }),
    });
    if (res.status !== 202) { let d = ''; try { d = (await res.json()).error?.message || ''; } catch { /* */ } throw new Error(`Graph sendMail ${res.status} ${d}`); }
    await log('SENT');
    return { ok: true };
  } catch (e) { await log('FAILED', e.message); console.error('[mail]', e.message); return { ok: false, error: e.message }; }
}
