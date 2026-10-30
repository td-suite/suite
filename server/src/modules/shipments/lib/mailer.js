// Posta del modulo Shipments dentro la Suite.
// Invio: sendMail della Suite (casella suite@, Microsoft Graph oppure solo registro), con i template HTML dell'app di origine;
// l'esito viene registrato anche nell'email_log del modulo, con la stessa forma che le pagine dell'app si aspettano.
// Lettura della casella shipments@ (richieste in arrivo): Microsoft Graph con le credenziali applicative della Suite.
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail as suiteSendMail } from '../../../lib/mailer.js';

export const graphConfigured = () => config.graph.enabled;
export const mailConfigured = () => suite.mail.provider === 'graph';
// Stato della casella in arrivo con il motivo preciso quando non legge: credenziali Graph assenti (ENTRA_* / GRAPH_* su Render),
// oppure casella vuota. Il permesso Mail.Read si verifica con "Prova la casella" (testInbox).
export const inboxReason = () => (!graphConfigured() ? 'graph_credentials' : !config.graph.inbox ? 'no_mailbox' : null);
export const mailStatus = () => ({
  configured: mailConfigured(),
  mode: mailConfigured() ? 'microsoft365' : null,
  from: config.graph.sender || null,
  inbox: config.graph.inbox || null,
  inboxSource: config.graph.inboxEnv ? 'env' : config.graph.inboxOverride ? 'setting' : 'default',
  inboxConfigured: graphConfigured() && Boolean(config.graph.inbox),
  inboxReason: inboxReason(),
});
// Prova di lettura della casella (un messaggio): distingue casella inesistente (404), permesso Mail.Read mancante (403), credenziali errate (401)
export async function testInbox() {
  const reason = inboxReason();
  if (reason === 'graph_credentials') return { ok: false, message: 'Credenziali Microsoft Graph assenti: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)' };
  if (reason) return { ok: false, message: 'Casella da leggere non impostata' };
  try {
    const res = await graphFetch(`/users/${encodeURIComponent(config.graph.inbox)}/mailFolders/inbox/messages?$top=1&$select=id,receivedDateTime,subject`);
    if (res.ok) { const j = await res.json(); const m = (j.value || [])[0]; return { ok: true, message: `Casella ${config.graph.inbox} leggibile${m ? `: ultimo messaggio "${(m.subject || '').slice(0, 60)}" del ${new Date(m.receivedDateTime).toLocaleString('it-IT')}` : ' (vuota)'}` }; }
    const t = (await res.text()).slice(0, 200);
    if (res.status === 404) return { ok: false, message: `La casella ${config.graph.inbox} non esiste nel tenant o non è una casella Exchange (${t})` };
    if (res.status === 403) return { ok: false, message: `Permesso mancante: l'app registration della Suite deve avere il permesso applicativo Mail.Read (con consenso amministratore) e, se c'è una Application Access Policy, includere la casella ${config.graph.inbox} (${t})` };
    if (res.status === 401) return { ok: false, message: `Credenziali Graph non valide o segreto scaduto (${t})` };
    return { ok: false, message: `Graph ${res.status}: ${t}` };
  } catch (e) { return { ok: false, message: `Errore di rete verso Microsoft Graph: ${e.message}` }; }
}

let graphToken = { value: null, exp: 0 };
export async function getGraphToken() {
  if (graphToken.value && Date.now() < graphToken.exp - 60_000) return graphToken.value;
  const g = config.graph;
  const res = await fetch(`https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Token Microsoft non ottenuto: ${j.error_description || res.status}`);
  graphToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

export async function graphFetch(path, init = {}) {
  const token = await getGraphToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export function wrapHtml({ title, body, footer, lang = 'it' }) {
  const openLabel = lang === 'en' ? 'Open Shipments' : 'Apri Shipments';
  const foot = footer || (lang === 'en' ? 'Automatic message from the Toscana Diagnostica Shipments system.' : 'Messaggio generato automaticamente dal sistema Shipments di Toscana Diagnostica.');
  return `<!doctype html><html><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden">
    <div style="background:#01212C;padding:18px 24px;color:#FFFAE3;font-weight:700;font-size:15px">Toscana Diagnostica · Shipments</div>
    <div style="padding:22px 24px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#01212C">${esc(title)}</h2>
      <div style="font-size:14px;line-height:1.5">${esc(body)}</div>
      ${config.baseUrl && !/localhost/.test(config.baseUrl) ? `<p style="margin-top:20px"><a href="${config.baseUrl}" style="background:#1C505E;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:700;font-size:13px">${openLabel}</a></p>` : ''}
    </div>
    <div style="padding:12px 24px;border-top:1px solid #dbe5e7;color:#5b6f75;font-size:11.5px">${esc(foot)}</div>
  </div></body></html>`;
}

/**
 * Invia (o registra) una email. Non lancia mai: l'esito finisce nel registro invii del modulo.
 * opts: { kind, refKey, to, cc, subject, body, title, lang, orderId, sentBy }
 * Nota: gli allegati non sono supportati dal mailer della Suite; nessuna email dell'app li usa.
 */
export async function sendMail(opts) {
  const to = [].concat(opts.to).flatMap((s) => String(s || '').split(/[;,]/)).map((s) => s.trim()).filter(Boolean);
  const cc = [].concat(opts.cc || []).flatMap((s) => String(s || '').split(/[;,]/)).map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { status: 'FALLITA', error: 'Nessun destinatario' };
  if (opts.refKey) {
    const dup = await one("SELECT id FROM email_log WHERE ref_key=$1 AND status='INVIATA'", [opts.refKey]);
    if (dup) return { status: 'DUPLICATA', id: dup.id };
  }
  let status = 'NON_CONFIGURATA', error = null;
  const html = wrapHtml({ title: opts.title || opts.subject, body: opts.body, lang: opts.lang });
  if (mailConfigured()) {
    const out = await suiteSendMail({ to, cc, subject: opts.subject, html, text: opts.body, ref: opts.refKey ? `shipments:${opts.refKey}` : 'shipments' });
    if (out.ok) status = 'INVIATA'; else { status = 'FALLITA'; error = out.error || 'Invio non riuscito'; }
  } else {
    // provider "log": la Suite registra soltanto; nel registro del modulo resta NON_CONFIGURATA come nell'app
    await suiteSendMail({ to, cc, subject: opts.subject, html, text: opts.body, ref: opts.refKey ? `shipments:${opts.refKey}` : 'shipments' }).catch(() => {});
  }
  const row = await one(`INSERT INTO email_log (kind, ref_key, order_id, to_addr, cc_addr, subject, body, attachment_name, status, error, sent_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
  [opts.kind, opts.refKey || null, opts.orderId || null, to.join(', '), cc.join(', ') || null, opts.subject, opts.body, opts.attachment?.filename || null, status, error, opts.sentBy || null]);
  return { status, error, id: row.id };
}

export async function adminEmails() {
  const extra = (await one("SELECT value FROM app_settings WHERE key='notify_admins_email'"))?.value || '';
  const users = (await many(`SELECT email FROM users WHERE role IN ('SUPERADMIN','ADMIN') AND active`)).map((x) => x.email);
  return [...new Set([...users, ...extra.split(/[;,]/).map((s) => s.trim()).filter(Boolean)])];
}

export async function emailLog(limit = 200) {
  return many(`SELECT e.*, u.full_name AS sent_by_name FROM email_log e LEFT JOIN users u ON u.id=e.sent_by ORDER BY e.sent_at DESC LIMIT $1`, [limit]);
}

// Marca come usata una riga del registro (per riprovare invii falliti)
export async function markEmail(id, status, error) { await q('UPDATE email_log SET status=$2, error=$3 WHERE id=$1', [id, status, error || null]); }
