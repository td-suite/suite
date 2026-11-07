// Rubriche esterne a supporto della Suite (richiesta del CEO del 07/11/2026): ricerca nei contatti di Outlook/Microsoft 365 della
// casella francesco.epifani@ (Microsoft Graph, permesso applicativo Contacts.Read) e nella rubrica Google di fraepi@gmail.com
// (Google People API, consenso OAuth dato una volta da Francesco, refresh token cifrato in app_settings con CREDENTIALS_KEY).
// Servono a compilare i referenti delle Legal entity (Business Hub, Registra contatto, Amministrazione) senza ricopiare a mano.
// Privacy: nessuna copia in massa nella Suite (si salva solo il contatto scelto, dal form), cache in memoria di 60 secondi per
// query, nessuna email in chiaro nei log (mascheraEmail), audit RUBRICA_CERCA con la query troncata a 40 caratteri e mascherata.
// Le funzioni di normalizzazione e l'orchestratore della ricerca sono pure (testabili senza rete né database).
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q, one, many } from '../db.js';
import { encrypt, decrypt } from './secrets.js';
import { getSetting } from './util.js';
import { graph, graphToken, graphConfigured, tokenRoles, resolveMailbox } from './graphInbox.js';

export const MAX_PER_FONTE = 15;
export const TIMEOUT_MS = 8000;
export const CACHE_MS = 60_000;
export const CASELLA_PREDEFINITA = 'francesco.epifani@toscanadiagnostica.it';
export const ACCOUNT_GOOGLE_PREDEFINITO = 'fraepi@gmail.com';
export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/contacts.readonly';
const CHIAVE_IMPOSTAZIONI = 'rubriche';
const CHIAVE_GOOGLE = 'secret:rubriche_google';   // refresh token cifrato: escluso da GET /api/settings come tutte le secret:*

// Contatti dichiaratamente di prova (RUBRICHE_MOCK=1, solo fuori produzione): dominio .example riservato, "(prova)" nel nome
export const mockAttivo = () => process.env.RUBRICHE_MOCK === '1' && process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------------------------------------------------------
// Funzioni pure
// ---------------------------------------------------------------------------------------------------------------------------

/** Maschera gli indirizzi email in un testo (log, audit, messaggi d'errore): mario.rossi@clinica.it → m***@clinica.it */
export function mascheraEmail(s) {
  return String(s ?? '').replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
}

/** Query per l'audit: spazi compattati, email mascherate, al massimo 40 caratteri */
export const queryPerAudit = (s) => mascheraEmail(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, 40);

const pulito = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unici = (arr) => [...new Set(arr.filter(Boolean))];
const minuscolo = (s) => pulito(s).toLowerCase();

/** Nome e cognome da un nome completo "Mario Rossi" (prima parola = nome): solo ripiego quando la fonte non li distingue */
export function dividiNome(completo) {
  const p = pulito(completo).split(' ').filter(Boolean);
  if (p.length < 2) return { nome_proprio: p[0] || '', cognome: '' };
  return { nome_proprio: p[0], cognome: p.slice(1).join(' ') };
}

const TIPO_TEL_GOOGLE = { mobile: 'cellulare', work: 'lavoro', workMobile: 'cellulare', home: 'casa', main: 'lavoro', homeFax: 'fax', workFax: 'fax', other: 'altro' };
// telefoni senza doppioni (stesse cifre), nell'ordine: cellulari, lavoro, casa, altri
function telefoniUnici(lista) {
  const visti = new Set(); const out = [];
  for (const t of lista) {
    const numero = pulito(t.numero); const k = numero.replace(/[^\d+]/g, '');
    if (!numero || !k || visti.has(k)) continue;
    visti.add(k); out.push({ tipo: t.tipo || 'altro', numero });
  }
  const ordine = ['cellulare', 'lavoro', 'casa', 'altro', 'fax'];
  return out.sort((a, b) => ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo));
}

/**
 * Contatto di Outlook (risorsa contact di Microsoft Graph) → formato comune
 * { id, fonte, nome, nome_proprio, cognome, email[], telefoni[{tipo,numero}], azienda, ruolo }
 */
export function normalizzaOutlook(c) {
  if (!c || typeof c !== 'object') return null;
  const nomeProprio = pulito(c.givenName); const cognome = pulito(c.surname);
  const nome = pulito(c.displayName) || pulito(`${nomeProprio} ${cognome}`) || pulito(c.companyName);
  const email = unici((c.emailAddresses || []).map((e) => minuscolo(e?.address)).filter((e) => e.includes('@')));
  const telefoni = telefoniUnici([
    ...(c.mobilePhone ? [{ tipo: 'cellulare', numero: c.mobilePhone }] : []),
    ...(c.businessPhones || []).map((n) => ({ tipo: 'lavoro', numero: n })),
    ...(c.homePhones || []).map((n) => ({ tipo: 'casa', numero: n })),
  ]);
  if (!nome && !email.length) return null;
  const diviso = nomeProprio || cognome ? { nome_proprio: nomeProprio, cognome } : dividiNome(nome);
  return { id: `outlook:${c.id || email[0] || nome}`, fonte: 'OUTLOOK', nome: nome || email[0], ...diviso, email, telefoni,
    azienda: pulito(c.companyName), ruolo: pulito(c.jobTitle) };
}

/** Persona della Google People API (people.connections / people:searchContacts) → formato comune */
export function normalizzaGoogle(p) {
  if (!p || typeof p !== 'object') return null;
  const n = (p.names || [])[0] || {};
  const org = (p.organizations || [])[0] || {};
  const nomeProprio = pulito(n.givenName); const cognome = pulito(n.familyName);
  const nome = pulito(n.displayName) || pulito(`${nomeProprio} ${cognome}`) || pulito(org.name);
  const email = unici((p.emailAddresses || []).map((e) => minuscolo(e?.value)).filter((e) => e.includes('@')));
  const telefoni = telefoniUnici((p.phoneNumbers || []).map((t) => ({ tipo: TIPO_TEL_GOOGLE[t?.type] || 'altro', numero: t?.value })));
  if (!nome && !email.length) return null;
  const diviso = nomeProprio || cognome ? { nome_proprio: nomeProprio, cognome } : dividiNome(nome);
  return { id: `google:${p.resourceName || email[0] || nome}`, fonte: 'GOOGLE', nome: nome || email[0], ...diviso, email, telefoni,
    azienda: pulito(org.name), ruolo: pulito(org.title) };
}

/** Il contatto risponde alla ricerca? Tutte le parole della query devono comparire in nome, email o azienda (senza accenti) */
const senzaAccenti = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function corrisponde(c, query) {
  const parole = senzaAccenti(query).split(/\s+/).filter(Boolean);
  if (!parole.length || !c) return false;
  const testo = senzaAccenti([c.nome, c.nome_proprio, c.cognome, c.azienda, ...(c.email || [])].join(' '));
  return parole.every((p) => testo.includes(p));
}

/** Filtro $filter OData per i contatti di Outlook (startswith su nome, cognome, nome visualizzato, azienda; email esatta) */
export function filtroOutlook(query) {
  const s = pulito(query).replace(/'/g, "''");
  const parti = ['displayName', 'givenName', 'surname', 'companyName'].map((f) => `startswith(${f},'${s}')`);
  if (s.includes('@')) parti.push(`emailAddresses/any(a:a/address eq '${s.toLowerCase()}')`);
  return parti.join(' or ');
}

/** Raggruppa per fonte togliendo i doppioni (stesso id o stessa prima email) e taglia a `max` */
export function deduplica(lista, max = MAX_PER_FONTE) {
  const visti = new Set(); const out = [];
  for (const c of lista) {
    if (!c) continue;
    const k = c.email?.[0] ? `e:${c.email[0]}` : `i:${c.id}`;
    if (visti.has(k) || visti.has(`i:${c.id}`)) continue;
    visti.add(k); visti.add(`i:${c.id}`); out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Promessa con limite di tempo: oltre `ms` rifiuta con un messaggio leggibile */
export function conTimeout(promessa, ms, etichetta) {
  let t;
  return Promise.race([
    promessa,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${etichetta}: nessuna risposta entro ${Math.round(ms / 1000)} secondi`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Orchestratore della ricerca: esegue ogni fonte in parallelo con limite di tempo; l'errore di una fonte non blocca le altre.
 * `fonti` = { outlook: async (q) => contatti normalizzati, google: ... }; `cache` = Map condivisa (chiave fonte|query, 60 s).
 * Ritorna { risultati: { outlook: [...], google: [...] }, errori: { google: 'motivo' }, dallaCache: { outlook: true } }.
 */
export async function cercaInFonti(query, fonti, { timeoutMs = TIMEOUT_MS, cache = null, cacheMs = CACHE_MS, max = MAX_PER_FONTE, ora = Date.now } = {}) {
  const chiaveQ = minuscolo(query);
  const risultati = {}; const errori = {}; const dallaCache = {};
  await Promise.all(Object.entries(fonti).map(async ([nome, fn]) => {
    const k = `${nome}|${chiaveQ}`;
    const c = cache?.get(k);
    if (c && ora() - c.at < cacheMs) { risultati[nome] = c.lista; dallaCache[nome] = true; return; }
    try {
      const lista = deduplica(await conTimeout(Promise.resolve().then(() => fn(query)), timeoutMs, nome === 'outlook' ? 'Outlook' : nome === 'google' ? 'Gmail' : nome), max);
      risultati[nome] = lista;
      if (cache) {
        cache.set(k, { at: ora(), lista });
        if (cache.size > 500) for (const [kk, v] of cache) if (ora() - v.at >= cacheMs) cache.delete(kk);
      }
    } catch (e) {
      risultati[nome] = [];
      errori[nome] = mascheraEmail(e.motivo || e.message || String(e)).slice(0, 400);
    }
  }));
  return { risultati, errori, dallaCache };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Impostazioni e configurazione
// ---------------------------------------------------------------------------------------------------------------------------

export async function impostazioni() {
  const v = await getSetting(CHIAVE_IMPOSTAZIONI, null).catch(() => null);
  const o = v && typeof v === 'object' ? v : {};
  return { outlook_casella: pulito(o.outlook_casella) || CASELLA_PREDEFINITA, google_account: minuscolo(o.google_account) || ACCOUNT_GOOGLE_PREDEFINITO };
}
export async function salvaImpostazioni({ outlook_casella, google_account }, userId) {
  const corrente = await impostazioni();
  const nuovo = { outlook_casella: pulito(outlook_casella ?? corrente.outlook_casella), google_account: minuscolo(google_account ?? corrente.google_account) };
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [CHIAVE_IMPOSTAZIONI, JSON.stringify(nuovo), userId || null]);
  svuotaCache();
  return nuovo;
}

export const googleCredenziali = () => ({ clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' });
export const googleRedirectUri = () => process.env.GOOGLE_REDIRECT_URI || `${config.baseUrl}/api/rubriche/google/callback`;

async function googleSalvato() {
  const r = await one('SELECT value, updated_at FROM app_settings WHERE key=$1', [CHIAVE_GOOGLE]).catch(() => null);
  return r?.value && typeof r.value === 'object' ? r.value : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Outlook (Microsoft Graph, Contacts.Read applicativo sulla casella)
// ---------------------------------------------------------------------------------------------------------------------------

const SELECT_OUTLOOK = 'id,displayName,givenName,surname,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle';
let cartelleOutlook = { casella: null, at: 0, ids: [] };

// Motivo leggibile di un errore Graph sui contatti
export function motivoContatti(msg, casella) {
  const m = mascheraEmail(msg);
  if (/ErrorAccessDenied|Authorization_RequestDenied|Access is denied|\b403\b/i.test(msg)) return `Permesso mancante: sull'app registration della Suite serve Contacts.Read (applicativo, consenso amministratore) e, se c'è una Application Access Policy, deve includere ${casella}. Dettaglio: ${m}`;
  if (/ErrorInvalidUser|ResourceNotFound|MailboxNotEnabled|\b404\b/i.test(msg)) return `Microsoft non trova la casella ${casella}: verifica l'indirizzo in Impostazioni > Rubriche esterne. Dettaglio: ${m}`;
  if (/\b401\b|invalid_client|AADSTS7000215|AADSTS7000222|Token Microsoft non ottenuto/i.test(msg)) return `Credenziali Microsoft Graph non valide o segreto scaduto. Dettaglio: ${m}`;
  return m;
}

async function idCartelleOutlook(casella) {
  if (cartelleOutlook.casella === casella && Date.now() - cartelleOutlook.at < 10 * 60_000) return cartelleOutlook.ids;
  let ids = [];
  try {
    const j = await graph(`/users/${encodeURIComponent(casella)}/contactFolders?$select=id,displayName&$top=20`);
    ids = (j.value || []).map((f) => f.id).slice(0, 10);
  } catch { ids = []; }   // senza sottocartelle (o senza permesso di elencarle) si cerca solo nella cartella Contatti
  cartelleOutlook = { casella, at: Date.now(), ids };
  return ids;
}

/** Ricerca nei contatti Outlook della casella: cartella Contatti e sue cartelle, $filter con ripiego sul filtro locale */
export async function cercaOutlook(query, casella) {
  const filtro = encodeURIComponent(filtroOutlook(query));
  const percorsi = [`/users/${encodeURIComponent(casella)}/contacts`, ...(await idCartelleOutlook(casella)).map((id) => `/users/${encodeURIComponent(casella)}/contactFolders/${encodeURIComponent(id)}/contacts`)];
  const leggi = async (p) => {
    try { return (await graph(`${p}?$filter=${filtro}&$top=${MAX_PER_FONTE}&$select=${SELECT_OUTLOOK}`)).value || []; }
    catch (e) {
      if (e.status !== 400) throw e;
      // filtro non supportato dal servizio (es. email con caratteri particolari): un blocco di contatti filtrato qui, mai salvato
      const j = await graph(`${p}?$top=500&$select=${SELECT_OUTLOOK}`);
      return (j.value || []).filter((c) => corrisponde(normalizzaOutlook(c), query));
    }
  };
  const esiti = await Promise.allSettled(percorsi.map(leggi));
  if (esiti[0].status === 'rejected') throw Object.assign(new Error(esiti[0].reason.message), { motivo: motivoContatti(esiti[0].reason.message, casella) });
  return esiti.flatMap((e) => (e.status === 'fulfilled' ? e.value : [])).map(normalizzaOutlook).filter(Boolean).filter((c) => corrisponde(c, query) || filtroLargo(c, query));
}
// $filter con startswith restituisce anche chi inizia con la query su un solo campo: lo si tiene (es. "Ros" → Rossi)
const filtroLargo = (c, query) => [c.nome, c.nome_proprio, c.cognome, c.azienda, ...(c.email || [])].some((v) => senzaAccenti(v).startsWith(senzaAccenti(pulito(query))));

/** Prova passo per passo della rubrica Outlook (come provaCasella): credenziali, permesso Contacts.Read, casella, lettura */
export async function provaOutlook() {
  const { outlook_casella: casella } = await impostazioni();
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, steps, message: `${step}: ${detail}` }; };
  if (mockAttivo()) return { ok: true, steps: [{ step: 'Modalità di prova', ok: true, detail: 'RUBRICHE_MOCK=1: contatti finti, nessuna chiamata a Microsoft' }], message: 'Rubrica Outlook in modalità di prova' };
  if (!graphConfigured()) return fail('Credenziali Microsoft Graph della Suite', 'assenti: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)');
  let tok;
  try { tok = await graphToken(); steps.push({ step: 'Credenziali Microsoft Graph della Suite', ok: true, detail: `tenant ${config.mail.graph.tenantId}` }); } catch (e) { return fail('Credenziali Microsoft Graph della Suite', `non valide o segreto scaduto: ${e.message}`); }
  const roles = tokenRoles(tok);
  if (roles) {
    const ok = roles.some((r) => /^Contacts\.Read(Write)?$/.test(r));
    steps.push({ step: 'Permesso Contacts.Read dell\'app registration', ok, detail: ok ? `presente (${roles.filter((r) => /^Contacts/.test(r)).join(', ')})` : `manca Contacts.Read (permesso applicativo Microsoft Graph con consenso amministratore). Presenti: ${roles.join(', ') || 'nessuno'}` });
    if (!ok) return { ok: false, steps, message: 'Permesso Contacts.Read mancante sull\'app registration' };
  }
  let u;
  try { u = await resolveMailbox(casella); steps.push({ step: `Casella ${casella}`, ok: true, detail: `trovata per ${u.how}` }); } catch (e) { return fail(`Casella ${casella}`, motivoContatti(e.message, casella)); }
  try {
    const j = await graph(`/users/${encodeURIComponent(casella)}/contacts?$top=1&$select=id&$count=true`);
    const n = j['@odata.count'];
    steps.push({ step: 'Lettura dei contatti', ok: true, detail: n != null ? `${n} contatti nella cartella Contatti` : ((j.value || []).length ? 'contatti leggibili' : 'cartella Contatti vuota') });
  } catch (e) { return fail('Lettura dei contatti', motivoContatti(e.message, casella)); }
  return { ok: true, steps, message: `Rubrica Outlook di ${casella} leggibile` };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Google (People API, OAuth 2.0 applicazione web, consenso di Francesco una volta)
// ---------------------------------------------------------------------------------------------------------------------------

let tokenGoogle = { value: null, exp: 0, rif: null };
let riscaldato = { rif: null, at: 0 };

/** URL del consenso Google (accesso offline per il refresh token, consenso sempre richiesto per riaverlo) */
export function urlConsensoGoogle(state, loginHint) {
  const { clientId } = googleCredenziali();
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: googleRedirectUri(), response_type: 'code', scope: GOOGLE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  if (loginHint) p.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Email dell'account dal token id (ricevuto direttamente da Google in TLS, quindi non serve verificarne la firma) */
export function emailDaIdToken(idToken) {
  try { return minuscolo(JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email); } catch { return ''; }
}

/** Scambio del code del consenso: ritorna { refresh_token, account, scope } senza salvare nulla */
export async function scambiaCodeGoogle(code) {
  const { clientId, clientSecret } = googleCredenziali();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(), grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google non ha accettato il codice del consenso: ${j.error_description || j.error || res.status}`);
  if (!j.refresh_token) throw new Error('Google non ha restituito il refresh token: rimuovi l\'accesso della Suite da myaccount.google.com/permissions e ricollega');
  if (!String(j.scope || '').includes('contacts.readonly')) throw new Error('Il consenso non comprende la lettura dei contatti: ricollega e lascia spuntata la voce "Visualizzare i tuoi contatti"');
  return { refresh_token: j.refresh_token, account: emailDaIdToken(j.id_token), scope: j.scope };
}

export async function salvaGoogle({ refresh_token, account, scope }, userId) {
  const valore = { enc: encrypt(refresh_token), account, scope, consenso_at: new Date().toISOString(), by: userId || null, hint: refresh_token.slice(-4) };
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [CHIAVE_GOOGLE, JSON.stringify(valore), userId || null]);
  tokenGoogle = { value: null, exp: 0, rif: null };
  svuotaCache();
}

/** Scollega: revoca il token presso Google (se possibile) e lo cancella dalla Suite */
export async function revocaGoogle() {
  const s = await googleSalvato();
  let revocato = false;
  if (s?.enc) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(s.enc))}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      revocato = r.ok;
    } catch { revocato = false; }
  }
  await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_GOOGLE]);
  tokenGoogle = { value: null, exp: 0, rif: null };
  svuotaCache();
  return { revocato, era_collegato: Boolean(s?.enc) };
}

async function accessTokenGoogle() {
  const s = await googleSalvato();
  if (!s?.enc) throw Object.assign(new Error('Account Google non collegato'), { motivo: 'Account Google non collegato: in Amministrazione > Impostazioni > Rubriche esterne, "Collega l\'account Google" (lo fa Francesco)' });
  const { clientId, clientSecret } = googleCredenziali();
  if (!clientId || !clientSecret) throw Object.assign(new Error('Credenziali Google assenti'), { motivo: 'Credenziali OAuth Google assenti: su Render servono GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET' });
  if (tokenGoogle.value && tokenGoogle.rif === s.consenso_at && Date.now() < tokenGoogle.exp - 60_000) return tokenGoogle.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(s.enc), grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const motivo = j.error === 'invalid_grant'
      ? 'Il consenso Google non è più valido (revocato, password cambiata o app in modalità test oltre i 7 giorni): ricollega l\'account Google'
      : `Token Google non ottenuto: ${j.error_description || j.error || res.status}`;
    throw Object.assign(new Error(motivo), { motivo });
  }
  tokenGoogle = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, rif: s.consenso_at };
  return j.access_token;
}

async function peopleGet(path, tok) {
  const res = await fetch(`https://people.googleapis.com/v1/${path}`, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 300);
    const motivo = res.status === 403 && /SERVICE_DISABLED|has not been used|disabled/i.test(t) ? 'API People non abilitata nel progetto Google Cloud: abilitala (vedi docs/RUBRICHE.md)'
      : res.status === 403 ? `Google nega l'accesso ai contatti (scope contacts.readonly mancante?): ricollega l'account. ${t}` : `Google People ${res.status}: ${t}`;
    throw Object.assign(new Error(motivo), { motivo, status: res.status });
  }
  return res.json();
}

const READ_MASK = 'names,emailAddresses,phoneNumbers,organizations';
/** Ricerca nella rubrica Google (people:searchContacts, con la richiesta di "riscaldamento" a vuoto che Google chiede ogni tanto) */
export async function cercaGoogle(query) {
  const tok = await accessTokenGoogle();
  if (riscaldato.rif !== tok && Date.now() - riscaldato.at > 30 * 60_000) {
    await peopleGet(`people:searchContacts?query=&readMask=${READ_MASK}&pageSize=1`, tok).catch(() => null);
    riscaldato = { rif: tok, at: Date.now() };
  }
  const j = await peopleGet(`people:searchContacts?query=${encodeURIComponent(pulito(query))}&readMask=${READ_MASK}&pageSize=${MAX_PER_FONTE}`, tok);
  return (j.results || []).map((r) => normalizzaGoogle(r.person)).filter(Boolean);
}

/** Prova della rubrica Google: credenziali, consenso, token, lettura di un contatto */
export async function provaGoogle() {
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, steps, message: `${step}: ${detail}` }; };
  if (mockAttivo()) return { ok: true, steps: [{ step: 'Modalità di prova', ok: true, detail: 'RUBRICHE_MOCK=1: contatti finti, nessuna chiamata a Google' }], message: 'Rubrica Gmail in modalità di prova' };
  const { clientId, clientSecret } = googleCredenziali();
  if (!clientId || !clientSecret) return fail('Credenziali OAuth Google', 'assenti: su Render servono GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (guida in docs/RUBRICHE.md)');
  steps.push({ step: 'Credenziali OAuth Google', ok: true, detail: `client ${clientId.slice(0, 12)}… · redirect ${googleRedirectUri()}` });
  const s = await googleSalvato();
  if (!s?.enc) return fail('Consenso dell\'account Google', 'non ancora dato: "Collega l\'account Google" e accedi con l\'account della rubrica');
  steps.push({ step: 'Consenso dell\'account Google', ok: true, detail: `${s.account || 'account'} · ${new Date(s.consenso_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` });
  let tok;
  try { tok = await accessTokenGoogle(); steps.push({ step: 'Token di accesso', ok: true, detail: 'ottenuto dal refresh token' }); } catch (e) { return fail('Token di accesso', e.motivo || e.message); }
  try {
    const j = await peopleGet('people/me/connections?personFields=names&pageSize=1', tok);
    steps.push({ step: 'Lettura dei contatti', ok: true, detail: j.totalPeople != null ? `${j.totalPeople} contatti in rubrica` : 'contatti leggibili' });
  } catch (e) { return fail('Lettura dei contatti', e.motivo || e.message); }
  return { ok: true, steps, message: `Rubrica Google di ${s.account || 'Francesco'} leggibile` };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Contatti di prova (RUBRICHE_MOCK=1)
// ---------------------------------------------------------------------------------------------------------------------------

const MOCK_OUTLOOK = [
  { id: 'prova-o1', displayName: 'Laura Prova (contatto di prova Outlook)', givenName: 'Laura', surname: 'Prova', emailAddresses: [{ address: 'laura.prova@rubrica-di-prova.example' }], businessPhones: ['055 000 0001'], mobilePhone: '333 000 0001', companyName: 'Laboratorio di Prova S.r.l.', jobTitle: 'Direttrice di laboratorio (prova)' },
  { id: 'prova-o2', displayName: 'Marco Esempio (contatto di prova Outlook)', givenName: 'Marco', surname: 'Esempio', emailAddresses: [{ address: 'marco.esempio@rubrica-di-prova.example' }], businessPhones: ['055 000 0002'], companyName: 'Clinica di Prova', jobTitle: 'Amministrazione (prova)' },
];
const MOCK_GOOGLE = [
  { resourceName: 'people/prova-g1', names: [{ displayName: 'Giulia Prova (contatto di prova Gmail)', givenName: 'Giulia', familyName: 'Prova' }], emailAddresses: [{ value: 'giulia.prova@rubrica-di-prova.example' }], phoneNumbers: [{ value: '+39 340 000 0003', type: 'mobile' }], organizations: [{ name: 'Studio di Prova', title: 'Titolare (prova)' }] },
  { resourceName: 'people/prova-g2', names: [{ displayName: 'Paolo Esempio (contatto di prova Gmail)', givenName: 'Paolo', familyName: 'Esempio' }], emailAddresses: [{ value: 'paolo.esempio@rubrica-di-prova.example' }], phoneNumbers: [{ value: '0571 000 004', type: 'work' }] },
];
const cercaMock = (lista, norm) => async (query) => lista.map(norm).filter((c) => corrisponde(c, query));

// ---------------------------------------------------------------------------------------------------------------------------
// Stato e ricerca (usati dalla route /api/rubriche)
// ---------------------------------------------------------------------------------------------------------------------------

export async function stato() {
  const imp = await impostazioni();
  const s = await googleSalvato();
  const { clientId, clientSecret } = googleCredenziali();
  if (mockAttivo()) {
    return { mock: true, outlook: { configurata: true, casella: imp.outlook_casella, nota: 'Modalità di prova (RUBRICHE_MOCK=1): contatti finti' },
      google: { configurata: true, account: null, account_atteso: imp.google_account, consenso_at: null, credenziali: true, redirect_uri: googleRedirectUri(), nota: 'Modalità di prova (RUBRICHE_MOCK=1): contatti finti' } };
  }
  const outlook = { configurata: graphConfigured() && Boolean(imp.outlook_casella), casella: imp.outlook_casella };
  if (!graphConfigured()) outlook.errore = 'Credenziali Microsoft Graph della Suite assenti (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET su Render)';
  else if (!imp.outlook_casella) outlook.errore = 'Casella da leggere non impostata (Impostazioni > Rubriche esterne)';
  const google = { configurata: Boolean(clientId && clientSecret && s?.enc), credenziali: Boolean(clientId && clientSecret), account: s?.account || null, account_atteso: imp.google_account,
    consenso_at: s?.consenso_at || null, redirect_uri: googleRedirectUri() };
  if (!clientId || !clientSecret) google.errore = 'Credenziali OAuth Google assenti (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET su Render): vedi docs/RUBRICHE.md';
  else if (!s?.enc) google.errore = 'Account Google non ancora collegato: "Collega l\'account Google" in Impostazioni > Rubriche esterne';
  return { mock: false, outlook, google };
}

const cache = new Map();
export const svuotaCache = () => { cache.clear(); cartelleOutlook = { casella: null, at: 0, ids: [] }; };

/** Fonti esterne attive in questo momento (funzioni di ricerca) e motivi delle fonti non configurate */
export async function fontiEsterne() {
  if (mockAttivo()) return { fonti: { outlook: cercaMock(MOCK_OUTLOOK, normalizzaOutlook), google: cercaMock(MOCK_GOOGLE, normalizzaGoogle) }, nonConfigurate: {} };
  const st = await stato();
  const fonti = {}; const nonConfigurate = {};
  if (st.outlook.configurata) fonti.outlook = (query) => cercaOutlook(query, st.outlook.casella); else nonConfigurate.outlook = `Non configurata: ${st.outlook.errore}`;
  if (st.google.configurata) fonti.google = (query) => cercaGoogle(query); else nonConfigurate.google = `Non configurata: ${st.google.errore}`;
  return { fonti, nonConfigurate };
}

/** Ricerca nelle rubriche esterne (Outlook, Gmail) con cache condivisa di 60 s */
export async function cercaEsterne(query) {
  const { fonti, nonConfigurate } = await fontiEsterne();
  const r = await cercaInFonti(query, fonti, { cache });
  for (const k of ['outlook', 'google']) { if (!r.risultati[k]) r.risultati[k] = []; if (nonConfigurate[k]) r.errori[k] = nonConfigurate[k]; }
  r.interrogate = Object.keys(fonti).filter((k) => !r.dallaCache[k]);   // rubriche davvero interrogate (non dalla cache)
  return r;
}

/** Contatto esterno con esattamente questa email (per "trovato in Outlook" quando l'email si scrive a mano) */
export async function cercaPerEmail(email) {
  const e = minuscolo(email);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return { contatto: null, interrogate: [] };
  const r = await cercaEsterne(e);
  for (const k of ['outlook', 'google']) {
    const c = r.risultati[k].find((x) => x.email.includes(e));
    if (c) return { contatto: c, interrogate: r.interrogate };
  }
  return { contatto: null, interrogate: r.interrogate };
}

/**
 * Fonte "Suite": persone dell'anagrafica unica e, per chi ha il Business Hub, referenti già presenti negli account.
 * Sono dati già nella Suite: servono a non creare doppioni.
 */
export async function cercaSuite(query, { conBusiness = false } = {}) {
  const parole = pulito(query).toLowerCase().split(' ').filter(Boolean).slice(0, 5);
  if (!parole.length) return [];
  const cond = (expr, off) => parole.map((_, i) => `${expr} LIKE $${i + 1 + off}`).join(' AND ');
  const params = parole.map((p) => `%${p.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const persone = await many(`SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.phone_office, p.job_title, o.name AS org_name
      FROM people p LEFT JOIN organizations o ON o.id = p.organization_id
     WHERE p.status <> 'CESSATO' AND ${cond(`lower(coalesce(p.last_name,'') || ' ' || coalesce(p.first_name,'') || ' ' || coalesce(p.email,'') || ' ' || coalesce(o.name,''))`, 0)}
     ORDER BY lower(p.last_name), lower(p.first_name) LIMIT ${MAX_PER_FONTE}`, params);
  const out = persone.map((p) => ({ id: `persona:${p.id}`, fonte: 'SUITE', origine: 'Persone', person_id: p.id, nome: pulito(`${p.first_name || ''} ${p.last_name || ''}`),
    nome_proprio: pulito(p.first_name), cognome: pulito(p.last_name), email: p.email ? [p.email.toLowerCase()] : [],
    telefoni: telefoniUnici([{ tipo: 'cellulare', numero: p.phone }, { tipo: 'lavoro', numero: p.phone_office }]), azienda: pulito(p.org_name), ruolo: pulito(p.job_title) }));
  if (conBusiness && (await one(`SELECT to_regclass('business.contatti') IS NOT NULL AS c`))?.c) {
    const ref = await many(`SELECT c.id, c.nome, c.email, c.telefono, c.ruolo, o.name AS org_name
        FROM business.contatti c JOIN business.accounts a ON a.id = c.account_id LEFT JOIN organizations o ON o.id = a.organization_id
       WHERE c.person_id IS NULL AND ${cond(`lower(coalesce(c.nome,'') || ' ' || coalesce(c.email,'') || ' ' || coalesce(o.name,''))`, 0)}
       ORDER BY c.principale DESC, lower(c.nome) LIMIT ${MAX_PER_FONTE}`, params).catch(() => []);
    for (const c of ref) out.push({ id: `referente:${c.id}`, fonte: 'SUITE', origine: 'Business Hub', nome: pulito(c.nome), ...dividiNome(c.nome),
      email: c.email ? [c.email.toLowerCase()] : [], telefoni: telefoniUnici([{ tipo: 'lavoro', numero: c.telefono }]), azienda: pulito(c.org_name), ruolo: pulito(c.ruolo) });
  }
  return deduplica(out, MAX_PER_FONTE);
}

/** Stato di collegamento OAuth: state casuale legato alla sessione e all'utente, valido 10 minuti */
export const nuovoState = () => crypto.randomBytes(24).toString('base64url');
