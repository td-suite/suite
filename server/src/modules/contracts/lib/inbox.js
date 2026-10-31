// Casella di recruiting (recruitment@toscanadiagnostica.it) letta con Microsoft Graph: ogni allegato PDF / Word di un'email in
// arrivo diventa un CV nel CV Box (mittente come email e nome del candidato, oggetto come riferimento, sintesi AI se attiva).
// Permesso applicativo necessario sull'app registration della Suite: Mail.Read (o Mail.ReadWrite) sulla casella.
// Impostazioni del modulo: cv_inbox (indirizzo a cui scrivono i candidati), cv_inbox_mailbox (facoltativo: la casella vera da
// leggere quando cv_inbox è un alias o un gruppo di distribuzione; i messaggi si filtrano per destinatario), cv_inbox_enabled,
// cv_inbox_since (cursore), cv_inbox_last, cv_inbox_error.
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { extractText, quickFacts, summarizeCv } from './cv.js';

const CV_MIMES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const cvExt = (n) => /\.(pdf|docx?|rtf|odt)$/i.test(n || '');
const SKIP_NAMES = /^(image\d*|logo|firma|signature|outlook|banner)/i;

export const graphConfigured = () => Boolean(suite.mail.graph.tenantId && suite.mail.graph.clientId && suite.mail.graph.clientSecret);
async function setting(key, def = null) { const r = await one('SELECT value FROM app_settings WHERE key=$1', [key]); return r ? r.value : def; }
async function setSetting(key, value) { await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value ?? '')]); }

// graphToken, graph e resolveMailbox sono esportati: li riusa la casella People (lib/peopleMail.js, lib/peopleInbox.js)
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

// Diagnosi passo per passo (pulsante "Prova la casella")
export async function testInbox() {
  const steps = [];
  const address = ((await setting('cv_inbox', 'recruitment@toscanadiagnostica.it')) || '').trim();
  const mailbox = ((await setting('cv_inbox_mailbox', '')) || address).trim();
  if (!graphConfigured()) return { ok: false, steps: [{ step: 'Credenziali Microsoft della Suite', ok: false, detail: 'ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET mancanti su Render' }] };
  try { await graphToken(); steps.push({ step: 'Credenziali Microsoft della Suite', ok: true, detail: `tenant ${suite.mail.graph.tenantId}` }); } catch (e) { steps.push({ step: 'Credenziali Microsoft della Suite', ok: false, detail: e.message }); return { ok: false, steps }; }
  let u;
  try { u = await resolveMailbox(mailbox); steps.push({ step: `Casella "${mailbox}"`, ok: true, detail: `trovata per ${u.how}: ${u.displayName} · nome utente ${u.userPrincipalName} · indirizzo ${u.mail || '(vuoto)'} · id ${u.id}` }); } catch (e) { steps.push({ step: `Casella "${mailbox}"`, ok: false, detail: e.message }); return { ok: false, steps }; }
  try { const f = await graph(`/users/${u.id}/mailFolders/inbox?$select=id,totalItemCount,unreadItemCount`); steps.push({ step: 'Posta in arrivo', ok: true, detail: `${f.totalItemCount} email, ${f.unreadItemCount} non lette` }); } catch (e) { steps.push({ step: 'Posta in arrivo', ok: false, detail: /403|Access/i.test(e.message) ? `Permesso mancante: sull'app registration serve Mail.Read (applicativo) con consenso amministratore, oppure la casella è esclusa da una Application Access Policy. ${e.message}` : /ErrorInvalidUser/.test(e.message) ? `Exchange non riconosce questa casella con l'indirizzo usato. Aggiungi all'app registration il permesso applicativo User.Read.All (Microsoft Graph, consenso amministratore): la Suite potrà cercare la casella per id anche quando il nome utente interno è diverso dall'indirizzo. ${e.message}` : e.message }); return { ok: false, steps }; }
  return { ok: true, steps, mailbox_id: u.id };
}

export async function inboxStatus() {
  return {
    configured: graphConfigured(),
    mailbox: (await setting('cv_inbox', 'recruitment@toscanadiagnostica.it')) || '',
    real_mailbox: (await setting('cv_inbox_mailbox', '')) || '',
    enabled: (await setting('cv_inbox_enabled', 'true')) === 'true',
    last_poll: await setting('cv_inbox_last', null),
    last_error: await setting('cv_inbox_error', null),
    imported: Number((await one(`SELECT count(*)::int AS n FROM cv_box WHERE source LIKE 'Email %'`))?.n || 0),
  };
}

// Legge le email nuove della casella e crea i CV: una riga per allegato, mai due volte lo stesso allegato (graph_id)
export async function pollRecruitingInbox({ force = false } = {}) {
  if (!graphConfigured()) return { skipped: 'graph_non_configurato' };
  const address = ((await setting('cv_inbox', 'recruitment@toscanadiagnostica.it')) || '').trim();
  const mailbox = ((await setting('cv_inbox_mailbox', '')) || address).trim();   // casella letta davvero
  if (!address) return { skipped: 'casella_non_impostata' };
  if (!force && (await setting('cv_inbox_enabled', 'true')) !== 'true') return { skipped: 'disattivata' };
  const since = (await setting('cv_inbox_since', null)) || new Date(Date.now() - 30 * 86400000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since} and hasAttachments eq true`);
  const isAlias = mailbox.toLowerCase() !== address.toLowerCase();
  let userId = null;
  const toAddress = (m) => [...(m.toRecipients || []), ...(m.ccRecipients || [])].some((r) => (r.emailAddress?.address || '').toLowerCase() === address.toLowerCase());
  let created = 0; let fetched = 0; let last = since;
  try {
    userId = (await resolveMailbox(mailbox)).id;
    const j = await graph(`/users/${userId}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=50&$select=id,receivedDateTime,from,toRecipients,ccRecipients,subject,bodyPreview,hasAttachments`);
    const areas = (await many('SELECT name FROM areas WHERE active ORDER BY sort_order')).map((a) => a.name);
    for (const m of j.value || []) {
      fetched++;
      if (m.receivedDateTime > last) last = m.receivedDateTime;
      const from = m.from?.emailAddress || {};
      if ((from.address || '').toLowerCase() === mailbox.toLowerCase()) continue;
      if (isAlias && !toAddress(m)) continue;   // nella casella vera entrano anche altre email: solo quelle indirizzate a recruitment@
      const atts = await graph(`/users/${userId}/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline`);
      for (const a of atts.value || []) {
        if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
        if (!(CV_MIMES.has(a.contentType) || cvExt(a.name)) || SKIP_NAMES.test(a.name || '')) continue;
        const gid = `${m.id}:${a.id}`;
        if (await one('SELECT 1 FROM cv_box WHERE graph_id=$1', [gid])) continue;
        const full = await graph(`/users/${userId}/messages/${m.id}/attachments/${a.id}`);
        if (!full.contentBytes) continue;
        const buf = Buffer.from(full.contentBytes, 'base64');
        let text = ''; let facts = {}; let ai = null;
        try { text = await extractText(buf, a.contentType, a.name); facts = quickFacts(text); } catch (e) { console.error('[cv inbox] testo non estratto:', e.message); }
        if (text && config.anthropicKey) { try { ai = await summarizeCv(text, areas); } catch (e) { console.error('[cv inbox] sintesi AI:', e.message); } }
        const nameParts = String(from.name || '').trim().split(/\s+/);
        const guessLast = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0] || null;
        const guessFirst = nameParts.length > 1 ? nameParts[0] : null;
        const areaId = ai?.area ? (await one('SELECT id FROM areas WHERE lower(name)=lower($1)', [ai.area]))?.id || null : null;
        await q(`INSERT INTO cv_box (last_name, first_name, email, phone, area_id, role_target, summary, rating, status, source, filename, mime, size, data, text_excerpt, received_at, graph_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NUOVO',$9,$10,$11,$12,$13,$14,$15::date,$16)`,
          [ai?.last_name || guessLast, ai?.first_name || guessFirst, ai?.email || facts.email || from.address || null, ai?.phone || facts.phone || null, areaId,
            ai?.role_target || (m.subject ? m.subject.slice(0, 120) : null), ai?.summary || (m.bodyPreview ? m.bodyPreview.slice(0, 1000) : null), ai?.rating || null,
            `Email ${mailbox}`, a.name, a.contentType || 'application/octet-stream', buf.length, buf, text.slice(0, 4000) || null, m.receivedDateTime.slice(0, 10), gid]);
        created++;
      }
    }
    await setSetting('cv_inbox_since', last);
    await setSetting('cv_inbox_last', new Date().toISOString());
    await setSetting('cv_inbox_error', '');
  } catch (e) {
    let msg = e.message;
    if (/ErrorInvalidUser|ResourceNotFound/.test(msg)) msg = `Microsoft non trova una casella "${mailbox}": se recruitment@ è un alias o un gruppo di distribuzione, indica in Impostazioni la casella vera che lo riceve (campo "Casella da leggere"); se è una casella condivisa, verifica che esista con quell'indirizzo. Dettaglio: ${msg}`;
    else if (/ErrorAccessDenied|Authorization_RequestDenied|403/.test(msg)) msg = `Permesso mancante: sull'app registration della Suite serve Mail.Read (applicativo) con consenso amministratore. Dettaglio: ${msg}`;
    await setSetting('cv_inbox_error', msg);
    throw e;
  }
  return { fetched, created };
}
