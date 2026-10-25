// Posta del modulo Finance: usa il mailer della Suite (casella suite@, registro email_log) al posto del mailer dell'app.
// Il layout HTML delle email dell'app resta identico. Gli allegati (modulo PDF firmato) non sono previsti dal mailer della
// Suite: quando il provider è Graph vengono inviati con una chiamata Graph dalla stessa casella; altrimenti l'email parte
// senza allegato e rimanda alla scheda dell'istanza, dove il modulo è sempre scaricabile.
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail as suiteSendMail, mailStatus } from '../../../lib/mailer.js';
import { q } from '../../../db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Layout nello stile delle webapp aziendali
export function layout({ title, intro, rows = [], button, note }) {
  const trs = rows.filter((r) => r[1] != null && r[1] !== '').map(([k, v]) => `<tr><td style="padding:6px 10px;color:#5b6f75;font-size:12px;white-space:nowrap">${esc(k)}</td><td style="padding:6px 10px;font-weight:600;color:#0f2a33">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,system-ui,-apple-system,sans-serif;color:#0f2a33">
<div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden">
<div style="background:#01212C;padding:18px 24px;color:#FFFAE3"><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#71B1BD;font-weight:700">Toscana Diagnostica · Finance</div><div style="font-size:18px;font-weight:700;margin-top:6px">${esc(title)}</div></div>
<div style="padding:20px 24px;font-size:14px;line-height:1.5">${intro ? `<p style="margin:0 0 14px">${intro}</p>` : ''}
${trs ? `<table style="border-collapse:collapse;width:100%;background:#fafcfc;border:1px solid #dbe5e7;border-radius:8px">${trs}</table>` : ''}
${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1C505E;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:9px">${esc(button.label)}</a></p><p style="font-size:12px;color:#5b6f75">Se il pulsante non funziona copia questo indirizzo nel browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>` : ''}
${note ? `<p style="font-size:12px;color:#5b6f75;margin-top:16px">${note}</p>` : ''}
</div>
<div style="padding:12px 24px;background:#fafcfc;border-top:1px solid #dbe5e7;font-size:11px;color:#5b6f75">Messaggio automatico di Toscana Diagnostica · Finance, Suite TD (${esc(config.baseUrl)}). Non rispondere a questa email.</div>
</div></body></html>`;
}

let cached = { token: null, exp: 0 };
async function graphToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const g = suite.mail.graph;
  const body = new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const res = await fetch(`https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Token Graph non ottenuto: ${j.error_description || res.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

// Invio con allegati dalla casella della Suite (stessa app registration del mailer della Suite)
async function sendWithAttachments({ toList, ccList, subject, html, attachments }) {
  const token = await graphToken();
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: toList.map((address) => ({ emailAddress: { address } })),
    ccRecipients: ccList.map((address) => ({ emailAddress: { address } })),
    attachments: attachments.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentType: a.mime, contentBytes: Buffer.from(a.data).toString('base64') })),
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(suite.mail.sender)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (res.status !== 202) { const t = await res.text(); throw new Error(`Invio email non riuscito (${res.status}): ${t.slice(0, 300)}`); }
  await q('INSERT INTO public.email_log (to_addr, subject, status, error, ref) VALUES ($1,$2,$3,$4,$5)', [toList.join(', '), subject, 'SENT', null, 'finance']).catch(() => {});
}

export async function sendMail({ to, cc, subject, html, attachments = [] }) {
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean).filter((a) => !toList.includes(a));
  if (config.mail.mode !== 'GRAPH') {
    console.log(`[finance:mail:${config.mail.mode}] a: ${toList.join(', ')}${ccList.length ? ` cc: ${ccList.join(', ')}` : ''} · ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)}`);
    await suiteSendMail({ to: toList, cc: ccList, subject, html, ref: 'finance' });
    return { ok: true, mode: config.mail.mode };
  }
  if (attachments.length) {
    try { await sendWithAttachments({ toList, ccList, subject, html, attachments }); return { ok: true, mode: 'GRAPH' }; }
    catch (e) { console.error('[finance:mail] allegati non inviati, invio senza allegato:', e.message); }
  }
  const r = await suiteSendMail({ to: toList, cc: ccList, subject, html, ref: 'finance' });
  if (!r.ok) throw new Error(r.error || 'Invio email non riuscito');
  return { ok: true, mode: 'GRAPH' };
}

export async function mailAvailable() {
  if (config.mail.mode !== 'GRAPH') return { ok: false, mode: config.mail.mode, sender: mailStatus().sender };
  try { await graphToken(); return { ok: true, mode: 'GRAPH', sender: mailStatus().sender }; } catch (e) { return { ok: false, mode: 'GRAPH', error: e.message }; }
}
