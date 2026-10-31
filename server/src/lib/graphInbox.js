// Lettura di una casella di posta con Microsoft Graph (credenziali applicative della Suite: ENTRA_* / GRAPH_*), condivisa dai moduli
// che leggono una casella: Contracts (recruitment@, people@ tramite modules/contracts/lib/inbox.js) e Referti esterni (template@).
// Token client_credentials con cache, chiamata GET con errore leggibile (status), ricerca della casella per nome utente o indirizzo,
// ruoli applicativi del token (Mail.Read / Mail.Send) e diagnosi dei 401/403/404 in italiano. Nessun contenuto dei messaggi nei log.
import { config as suite } from '../config.js';

export const graphConfigured = () => Boolean(suite.mail.graph.tenantId && suite.mail.graph.clientId && suite.mail.graph.clientSecret);

let token = { value: null, exp: 0 };
export async function graphToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const g = suite.mail.graph;
  const res = await fetch(`https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Token Microsoft non ottenuto: ${j.error_description || res.status}`);
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// GET su Graph: JSON oppure errore con status ("Graph 403: …")
export async function graph(path, { headers = {} } = {}) {
  const t = await graphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { authorization: `Bearer ${t}`, ConsistencyLevel: 'eventual', ...headers } });
  if (!res.ok) throw Object.assign(new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  return res.json();
}

// La casella si cerca per nome utente, poi per indirizzo (mail o proxyAddresses): l'id dell'oggetto è la chiave sicura per le
// chiamate di posta, anche quando il nome utente è sul dominio .onmicrosoft.com o l'indirizzo è un alias
export async function resolveMailbox(address) {
  const a = address.trim();
  // Leggere l'oggetto utente richiede User.Read.All (applicativo): se manca, si usa l'indirizzo così com'è
  try { const u = await graph(`/users/${encodeURIComponent(a)}?$select=id,mail,userPrincipalName,displayName`); return { ...u, how: 'nome utente' }; }
  catch (e) { if (/403|Authorization_RequestDenied|Insufficient/i.test(e.message)) return { id: a, mail: a, userPrincipalName: a, displayName: a, how: 'indirizzo (senza verifica: manca il permesso User.Read.All)' }; if (!/404/.test(e.message)) throw e; }
  const j = await graph(`/users?$filter=mail eq '${a.replace(/'/g, "''")}' or proxyAddresses/any(x:x eq 'smtp:${a.replace(/'/g, "''")}')&$select=id,mail,userPrincipalName,displayName&$count=true`);
  const u = (j.value || [])[0];
  if (!u) throw new Error(`Microsoft non trova nessun utente o casella con indirizzo "${a}" nel tenant delle credenziali della Suite (tenant ${suite.mail.graph.tenantId.slice(0, 8)}…): verifica che la casella condivisa sia in questo tenant e che l'indirizzo sia quello principale o un alias.`);
  return { ...u, how: 'indirizzo' };
}

/** Ruoli applicativi del token Graph (claim roles): dicono quali permessi ha l'app registration, senza leggere né inviare nulla. */
export function tokenRoles(tok) {
  try { return JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8')).roles || []; } catch { return null; }
}

// Motivo leggibile di un errore di lettura della casella (Mail.Read)
export function motivoLettura(msg, address) {
  if (/ErrorInvalidUser|ResourceNotFound|MailboxNotEnabled|\b404\b/i.test(msg)) return `Microsoft non trova la casella "${address}": verifica che esista come casella (anche condivisa) nel tenant della Suite. Dettaglio: ${msg}`;
  if (/ErrorAccessDenied|Authorization_RequestDenied|Access is denied|\b403\b/i.test(msg)) return `Permesso mancante: sull'app registration della Suite serve Mail.Read (applicativo) con consenso amministratore e, se c'è una Application Access Policy, deve includere ${address}. Dettaglio: ${msg}`;
  if (/\b401\b|invalid_client|AADSTS7000215|AADSTS7000222/i.test(msg)) return `Credenziali Microsoft Graph non valide o segreto scaduto. Dettaglio: ${msg}`;
  return msg;
}

// Motivo leggibile di un errore di invio (Mail.Send da una casella diversa da quella della Suite)
export function motivoInvio(msg, address) {
  if (!msg) return msg;
  if (/\b403\b|ErrorAccessDenied|Access is denied/i.test(msg)) return `Permesso mancante: l'app registration della Suite deve avere Mail.Send (applicativo, consenso amministratore) e, se c'è una Application Access Policy, deve includere ${address}. ${msg}`;
  if (/\b404\b|ErrorInvalidUser|MailboxNotEnabled|ResourceNotFound/i.test(msg)) return `La casella ${address} non esiste nel tenant o non è una casella Exchange. ${msg}`;
  if (/\b401\b|Token Microsoft non ottenuto/i.test(msg)) return `Credenziali Microsoft Graph non valide o segreto scaduto. ${msg}`;
  return msg;
}

/**
 * Prova passo per passo di una casella: credenziali, permessi del token (Mail.Read e, se richiesto, Mail.Send), casella, lettura di un
 * messaggio. Restituisce { ok, steps:[{ step, ok, detail }], message } con il motivo preciso di ciò che manca.
 */
export async function provaCasella(address, { serveInvio = false } = {}) {
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, steps, message: `${step}: ${detail}` }; };
  if (!graphConfigured()) return fail('Credenziali Microsoft Graph della Suite', 'assenti: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)');
  let tok;
  try { tok = await graphToken(); steps.push({ step: 'Credenziali Microsoft Graph della Suite', ok: true, detail: `tenant ${suite.mail.graph.tenantId}` }); } catch (e) { return fail('Credenziali Microsoft Graph della Suite', `non valide o segreto scaduto: ${e.message}`); }
  const roles = tokenRoles(tok);
  if (roles) {
    const read = roles.some((r) => /^Mail\.Read(Write)?$/.test(r)); const send = roles.includes('Mail.Send');
    const miss = [!read && 'Mail.Read', serveInvio && !send && 'Mail.Send'].filter(Boolean);
    steps.push({ step: 'Permessi dell\'app registration', ok: !miss.length, detail: miss.length ? `manca${miss.length > 1 ? 'no' : ''} ${miss.join(' e ')} (permesso applicativo Microsoft Graph con consenso amministratore). Presenti: ${roles.join(', ') || 'nessuno'}` : `presenti: ${roles.join(', ')}` });
    if (!read) return { ok: false, steps, message: 'Permesso Mail.Read mancante sull\'app registration' };
  }
  let u;
  try { u = await resolveMailbox(address); steps.push({ step: `Casella ${address}`, ok: true, detail: `trovata per ${u.how}: ${u.displayName || ''} · id ${u.id}` }); } catch (e) { return fail(`Casella ${address}`, /404|ErrorInvalidUser|ResourceNotFound|non trova/.test(e.message) ? `inesistente nel tenant o non è una casella Exchange (${e.message})` : e.message); }
  try {
    const j = await graph(`/users/${encodeURIComponent(u.id)}/mailFolders/inbox/messages?$top=1&$select=id,receivedDateTime`);
    const m = (j.value || [])[0];
    steps.push({ step: 'Lettura di un messaggio', ok: true, detail: m ? `ultimo messaggio del ${new Date(m.receivedDateTime).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : 'casella vuota' });
  } catch (e) {
    const d = /403|ErrorAccessDenied|Access/i.test(e.message) ? `permesso negato: serve Mail.Read (applicativo) e, se c'è una Application Access Policy, deve includere ${address} (${e.message})`
      : /404|ErrorInvalidUser|MailboxNotEnabled/i.test(e.message) ? `la casella ${address} non esiste o non ha una cassetta Exchange (${e.message})` : e.message;
    return fail('Lettura di un messaggio', d);
  }
  const ok = steps.every((s) => s.ok);
  return { ok, steps, mailbox_id: u.id, message: ok ? `Casella ${address} leggibile${serveInvio ? ', permessi Mail.Read e Mail.Send presenti' : ''}` : 'Casella leggibile, ma con un permesso mancante (vedi i passaggi)' };
}

/** Messaggi della posta in arrivo ricevuti dopo `since` (ISO), dal più vecchio, al massimo `top`. */
export async function messaggiDa(mailboxId, since, { top = 50, select = 'id,internetMessageId,receivedDateTime,from,subject,hasAttachments' } = {}) {
  const filter = encodeURIComponent(`receivedDateTime gt ${since}`);
  const j = await graph(`/users/${encodeURIComponent(mailboxId)}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=${top}&$select=${select}`);
  return j.value || [];
}

/** Allegati file (non in linea) di un messaggio con il contenuto, filtrati da `accetta({ name, contentType, size })`. */
export async function allegatiFile(mailboxId, messageId, accetta = () => true) {
  const atts = await graph(`/users/${encodeURIComponent(mailboxId)}/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`);
  const out = [];
  for (const a of atts.value || []) {
    if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
    if (!accetta(a)) continue;
    const full = await graph(`/users/${encodeURIComponent(mailboxId)}/messages/${messageId}/attachments/${a.id}`);
    if (full.contentBytes) out.push({ id: a.id, filename: a.name, mime: a.contentType, buffer: Buffer.from(full.contentBytes, 'base64') });
  }
  return out;
}
