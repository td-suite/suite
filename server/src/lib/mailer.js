// Posta in uscita via Microsoft Graph dalla casella suite@toscanadiagnostica.it (permesso applicativo Mail.Send,
// limitato alla casella con una Application Access Policy). MAIL_PROVIDER=log scrive solo nel registro.
// Mittente diverso (parametro `from`, es. people@ per i richiami di Contracts): la chiamata Graph diventa /users/<from>/sendMail,
// quindi serve Mail.Send anche su quella casella (se c'è una Application Access Policy, deve includerla). Il mittente finisce
// nel registro (email_log.from_addr, migrazione 035).
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

export function layout(title, bodyHtml, { footer } = {}) {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dbe5e7">
    <div style="background:#01212C;padding:18px 24px;color:#fff;font-weight:700;font-size:15px">Suite TD <span style="color:#71B1BD;font-weight:600"> · Toscana Diagnostica</span></div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;color:#1C505E;font-size:18px">${title}</h2>${bodyHtml}</div>
    <div style="padding:14px 24px;background:#f3f6f6;color:#5b6f75;font-size:12px">${footer || `Messaggio automatico di ${config.baseUrl}. Non rispondere a questa email.`}</div>
  </div></body></html>`;
}

export async function sendMail({ to, cc = [], subject, html, text, ref, attachments = [], from = null, logSubject = null }) {
  // attachments: [{ filename, content (Buffer), contentType }]; from: casella mittente (predefinita config.mail.sender);
  // logSubject: oggetto da scrivere nel registro email e nel log del server al posto di quello vero (es. i referti dei Referti esterni,
  // il cui oggetto porta il nome del paziente: mai nei log)
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) return { ok: false, skipped: true };
  const sender = String(from || config.mail.sender).trim();
  const subjectLog = logSubject || subject;
  const log = async (status, error) => (await q('INSERT INTO email_log (to_addr, subject, status, error, ref, from_addr) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [toList.join(', '), subjectLog, status, error || null, ref || null, sender])).rows[0]?.id;
  if (config.mail.provider !== 'graph') { const id = await log('LOGGED'); console.log(`[mail:log] ${sender} → ${toList.length} destinatari${cc.length ? ` (+${cc.length} in copia)` : ''} · ${subjectLog}`); return { ok: true, logged: true, logId: id, from: sender }; }
  try {
    const tok = await graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ saveToSentItems: true, message: {
        subject, body: { contentType: 'HTML', content: html || `<pre>${text || ''}</pre>` },
        toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
        attachments: (attachments || []).filter((a) => a && a.content).map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename || 'allegato', contentType: a.contentType || 'application/octet-stream', contentBytes: Buffer.from(a.content).toString('base64') })),
      } }),
    });
    if (res.status !== 202) { let d = ''; try { d = (await res.json()).error?.message || ''; } catch { /* */ } throw Object.assign(new Error(`Graph sendMail ${res.status} ${d}`), { status: res.status }); }
    const id = await log('SENT');
    return { ok: true, logId: id, from: sender };
  } catch (e) { const id = await log('FAILED', e.message); console.error('[mail]', e.message); return { ok: false, error: e.message, status: e.status || null, logId: id, from: sender }; }
}

/**
 * Invio a molti destinatari, UNO ALLA VOLTA e con ritentativi (3) su 429 e 5xx di Graph, rispettando Retry-After. Prima gli invii
 * di una circolare partivano tutti insieme in parallelo e Graph ne rifiutava una parte per throttling (08/11/2026: la circolare di
 * lancio è arrivata solo a una parte degli interni). Ritorna { inviati, falliti: [{ to, errore }] }. Chi chiama non deve aspettarla.
 */
export async function sendMailMany(list, { pausaMs = 150 } = {}) {
  const out = { inviati: 0, falliti: [] };
  for (const m of list) {
    let r = null;
    for (let tentativo = 1; tentativo <= 3; tentativo++) {
      r = await sendMail(m);
      if (r.ok || r.skipped) break;
      if (![429, 500, 502, 503, 504].includes(Number(r.status))) break;
      await new Promise((ok) => setTimeout(ok, 1500 * tentativo));
    }
    if (r?.ok) out.inviati++; else if (!r?.skipped) out.falliti.push({ to: Array.isArray(m.to) ? m.to.join(', ') : m.to, errore: r?.error || 'errore sconosciuto' });
    await new Promise((ok) => setTimeout(ok, pausaMs));
  }
  return out;
}
