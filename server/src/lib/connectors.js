// Connettori unici verso i sistemi esterni (StudioLAB ServiceNET, GIPO, TuoTempo, Silva): una riga per sistema in
// public.connectors, configurata in Amministrazione > Connettori e valida per tutta la Suite. I moduli leggono da qui base URL,
// credenziali e segreto in ingresso (getConnector / connectorSync), verificano le chiamate in ingresso (verifyInbound) e
// registrano le chiamate (logConnector). Finché la riga non è configurata valgono le variabili d'ambiente storiche dei moduli
// (LIS_*, STUDIOLAB_*, SILVA_*), così la produzione continua a funzionare senza interventi.
import { APP_VERSION } from '../version.js';
import crypto from 'node:crypto';
import { q, one, many } from '../db.js';
import { encrypt, decrypt } from './secrets.js';
import { config } from '../config.js';

export const CONNECTOR_KINDS = ['STUDIOLAB', 'GIPO', 'TUOTEMPO', 'SILVA'];
export const AUTH_KINDS = ['API_KEY', 'BASIC', 'OAUTH2', 'NONE', 'CLIENT_JWT'];

const env = process.env;
const DEFAULT_BASE_URL = { STUDIOLAB: 'https://servicenet.toscanadiagnostica.it/API', TUOTEMPO: 'https://app.tuotempo.com/api/v3', GIPO: null, SILVA: 'https://silva.cloud/portaleordini' };
const DEFAULT_NAME = { STUDIOLAB: 'StudioLAB ServiceNET (CB Sistemi)', GIPO: 'GIPO (Docplanner)', TUOTEMPO: 'TuoTempo (Docplanner)', SILVA: 'Silva Group (magazzino)' };

// Ripiego sulle variabili d'ambiente dei moduli di origine (nc: LIS_*, orders: STUDIOLAB_* e SILVA_*)
function envFallback(kind) {
  if (kind === 'STUDIOLAB') {
    const inbound = [env.LIS_PUSH_SECRET, env.STUDIOLAB_INBOUND_KEY].filter(Boolean);
    return {
      base_url: env.LIS_BASE_URL || env.STUDIOLAB_API_URL || DEFAULT_BASE_URL.STUDIOLAB,
      credentials: { api_key: env.LIS_API_KEY || env.STUDIOLAB_API_KEY || '' },
      inbound_secrets: [...new Set(inbound)],
      settings: { client_code: env.LIS_CODICE_CLIENTE || env.STUDIOLAB_CLIENT_CODE || 'TD', timeout_ms: Number(env.LIS_TIMEOUT_MS || 12000) },
      vars: ['LIS_API_KEY', 'LIS_BASE_URL', 'LIS_PUSH_SECRET', 'STUDIOLAB_API_KEY', 'STUDIOLAB_INBOUND_KEY'],
    };
  }
  if (kind === 'SILVA') {
    return {
      base_url: null, credentials: {}, inbound_secrets: [env.SILVA_INBOUND_KEY].filter(Boolean),
      settings: { customer_code: env.SILVA_CUSTOMER_CODE || 'TOSCANA-DIAGNOSTICA', order_email: env.SILVA_ORDER_EMAIL || '' },
      vars: ['SILVA_INBOUND_KEY', 'SILVA_CUSTOMER_CODE', 'SILVA_ORDER_EMAIL'],
    };
  }
  return { base_url: DEFAULT_BASE_URL[kind], credentials: {}, inbound_secrets: [], settings: {}, vars: [] };
}

const parseCreds = (blob) => { if (!blob) return {}; try { const v = JSON.parse(decrypt(blob)); return v && typeof v === 'object' ? v : {}; } catch (e) { console.error('[connectors] credenziali non leggibili:', e.message); return {}; } };
const parseSecret = (blob) => { if (!blob) return ''; try { return decrypt(blob); } catch (e) { console.error('[connectors] segreto non leggibile:', e.message); return ''; } };
const hasCreds = (c) => Object.values(c || {}).some((v) => v);

// Oggetto risolto che usano i moduli: valori in chiaro, mai da esporre all'interfaccia (per quella vedi publicConnector)
function resolve(row, kind) {
  const fb = envFallback(kind);
  const dbCreds = parseCreds(row?.credentials);
  const dbInbound = parseSecret(row?.inbound_secret);
  const configured = Boolean(row && (hasCreds(dbCreds) || dbInbound));
  const envConfigured = hasCreds(fb.credentials) || fb.inbound_secrets.length > 0;
  const source = configured ? 'db' : envConfigured ? 'env' : 'none';
  const settings = { ...fb.settings, ...(row?.settings || {}) };
  const base = configured
    ? { base_url: row.base_url || DEFAULT_BASE_URL[kind], credentials: dbCreds, inbound_secrets: dbInbound ? [dbInbound] : [], enabled: Boolean(row.enabled) }
    : { base_url: row?.base_url || fb.base_url, credentials: fb.credentials, inbound_secrets: fb.inbound_secrets, enabled: envConfigured };
  return {
    kind, name: row?.name || DEFAULT_NAME[kind], source, configured, auth_kind: row?.auth_kind || 'API_KEY', settings,
    ...base, inbound_secret: base.inbound_secrets[0] || '',
    // attivo = abilitato e con almeno una credenziale o un segreto
    active: base.enabled && (hasCreds(base.credentials) || base.inbound_secrets.length > 0),
    last_test_at: row?.last_test_at || null, last_status: row?.last_status || null, last_message: row?.last_message || null,
    updated_at: row?.updated_at || null, updated_by: row?.updated_by || null, schedule: row?.schedule || 'MANUALE', env_vars: fb.vars,
  };
}

// ---- cache in memoria: caricata all'avvio, aggiornata a ogni salvataggio
const cache = new Map();
let loaded = false;
export async function loadConnectors() {
  try {
    const rows = await many('SELECT * FROM public.connectors');
    for (const kind of CONNECTOR_KINDS) cache.set(kind, resolve(rows.find((r) => r.kind === kind) || null, kind));
    loaded = true;
  } catch (e) { console.error('[connectors] caricamento non riuscito:', e.message); }
}
export async function refreshConnector(kind) {
  const row = await one('SELECT * FROM public.connectors WHERE kind=$1', [kind]);
  cache.set(kind, resolve(row, kind));
  return cache.get(kind);
}
export async function getConnector(kind) {
  const k = String(kind || '').toUpperCase();
  if (!CONNECTOR_KINDS.includes(k)) throw new Error(`Connettore sconosciuto: ${kind}`);
  if (!loaded) await loadConnectors();
  return cache.get(k) || refreshConnector(k);
}
// Lettura sincrona dalla cache (per le configurazioni dei moduli con getter): prima del caricamento vale il ripiego sull'ambiente
export function connectorSync(kind) {
  const k = String(kind || '').toUpperCase();
  return cache.get(k) || resolve(null, k);
}

// StudioLAB: la base URL di produzione è https://servicenet.toscanadiagnostica.it/API, le chiamate REST vanno alla radice del nodo
// (GET /api/whoami, /api/esami, /api/accettazioni): si toglie il suffisso /API e si accoda il percorso
export const studiolabRoot = (baseUrl) => String(baseUrl || DEFAULT_BASE_URL.STUDIOLAB).trim().replace(/\/+$/, '').replace(/\/API$/i, '');
export const studiolabUrl = (baseUrl, path) => `${studiolabRoot(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;

// ---- verifica delle chiamate in ingresso (confronto a tempo costante)
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
export function verifyInbound(kind, provided) {
  const c = connectorSync(kind);
  if (!provided || !c.enabled || !c.inbound_secrets.length) return false;
  const given = digest(provided);
  return c.inbound_secrets.some((s) => crypto.timingSafeEqual(given, digest(s)));
}
export const inboundConfigured = (kind) => { const c = connectorSync(kind); return c.enabled && c.inbound_secrets.length > 0; };
export const newInboundSecret = () => crypto.randomBytes(24).toString('base64url');

// ---- registro delle chiamate (fire and forget: non deve mai bloccare il flusso)
let logCount = 0;
export function logConnector({ kind, direction, module, endpoint, status, ms, message }) {
  const k = String(kind || '').toUpperCase();
  if (!CONNECTOR_KINDS.includes(k)) return Promise.resolve();
  const p = q('INSERT INTO public.connector_log (kind, direction, module, endpoint, status, ms, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [k, direction === 'IN' ? 'IN' : 'OUT', module || null, endpoint ? String(endpoint).slice(0, 300) : null, status != null ? String(status).slice(0, 20) : null, ms != null ? Math.round(ms) : null, message ? String(message).slice(0, 1000) : null])
    .catch((e) => console.error('[connector_log]', e.message));
  if (++logCount % 200 === 0) q('DELETE FROM public.connector_log WHERE id IN (SELECT id FROM public.connector_log WHERE kind=$1 ORDER BY at DESC OFFSET 2000)', [k]).catch(() => {});
  return p;
}
export const connectorLog = (kind, limit = 50) => many('SELECT id, direction, module, endpoint, status, ms, message, at FROM public.connector_log WHERE kind=$1 ORDER BY at DESC LIMIT $2', [kind, limit]);

// ---- salvataggio dall'Amministrazione
export async function saveConnector(kind, patch, userId) {
  const cur = await one('SELECT * FROM public.connectors WHERE kind=$1', [kind]);
  if (!cur) throw new Error('Connettore inesistente');
  const sets = []; const vals = [kind];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.enabled !== undefined) add('enabled', Boolean(patch.enabled));
  if (patch.base_url !== undefined) add('base_url', patch.base_url ? String(patch.base_url).trim().replace(/\/+$/, '') : null);
  if (patch.auth_kind) add('auth_kind', patch.auth_kind);
  if (patch.schedule) add('schedule', patch.schedule);
  if (patch.settings) add('settings', JSON.stringify({ ...(cur.settings || {}), ...patch.settings }));
  if (patch.credentials === null) add('credentials', null);
  else if (patch.credentials && typeof patch.credentials === 'object') {
    const merged = { ...parseCreds(cur.credentials) };
    for (const [k, v] of Object.entries(patch.credentials)) { if (v === null || v === '') delete merged[k]; else if (typeof v === 'string' && !v.includes('••••')) merged[k] = v; }
    add('credentials', hasCreds(merged) ? encrypt(JSON.stringify(merged)) : null);
  }
  if (patch.inbound_secret === null) add('inbound_secret', null);
  else if (typeof patch.inbound_secret === 'string' && patch.inbound_secret.trim()) add('inbound_secret', encrypt(patch.inbound_secret.trim()));
  if (sets.length) {
    vals.push(userId || null);
    await q(`UPDATE public.connectors SET ${sets.join(', ')}, updated_at=now(), updated_by=$${vals.length} WHERE kind=$1`, vals);
  }
  return refreshConnector(kind);
}

// Forma per l'interfaccia: mai le credenziali in chiaro, solo "impostata" e gli ultimi 4 caratteri
const hint = (v) => (v ? String(v).slice(-4) : null);
export async function publicConnector(kind) {
  const c = await getConnector(kind);
  const row = await one('SELECT c.updated_at, c.updated_by, u.full_name AS updated_by_name, c.enabled AS db_enabled, c.base_url AS db_base_url, c.settings AS db_settings FROM public.connectors c LEFT JOIN users u ON u.id=c.updated_by WHERE c.kind=$1', [kind]);
  const credKeys = Object.entries(c.credentials).filter(([, v]) => v);
  return {
    kind: c.kind, name: c.name, source: c.source, configured: c.configured, enabled: c.configured ? c.enabled : Boolean(row?.db_enabled), active: c.active,
    base_url: row?.db_base_url || c.base_url, base_url_default: DEFAULT_BASE_URL[kind], auth_kind: c.auth_kind, settings: c.settings, schedule: c.schedule,
    credentials: { configured: credKeys.length > 0, keys: Object.fromEntries(credKeys.map(([k, v]) => [k, { set: true, hint: hint(v) }])) },
    inbound: { configured: c.inbound_secrets.length > 0, hint: hint(c.inbound_secrets[0]), count: c.inbound_secrets.length },
    env_vars: c.env_vars, env_in_use: c.source === 'env',
    last_test_at: c.last_test_at, last_status: c.last_status, last_message: c.last_message,
    updated_at: row?.updated_at || null, updated_by_name: row?.updated_by_name || null,
    endpoints: inboundEndpoints(kind),
  };
}

// Endpoint della Suite che il fornitore deve chiamare con il segreto in ingresso (o con una chiave API per l'ingestione)
export function inboundEndpoints(kind) {
  const base = config.baseUrl;
  const mk = (method, path, note, auth = 'X-API-KEY = segreto in ingresso') => ({ method, path, url: `${base}${path}`, note, auth });
  if (kind === 'STUDIOLAB') return [
    mk('POST', '/api/nc/hl7', 'Non conformità: messaggi HL7 v2.5 (OML^O21, ORL^O22, MDM^T02/T10, ADT) in text/plain, risposta ACK', 'X-API-KEY oppure X-Push-Secret = segreto in ingresso'),
    mk('POST', '/api/nc/lis/push', 'Non conformità: NotificaPush JSON {IdAccettazione, TipoNotifica, IdDocumento}', 'X-API-KEY oppure X-Push-Secret = segreto in ingresso'),
    mk('POST', '/api/orders/integrations/studiolab/hl7', 'Ordini: messaggi HL7 di accettazione (produzione per cliente) in text/plain, risposta ACK'),
  ];
  if (kind === 'SILVA') return [
    mk('GET', '/api/orders/integrations/silva/ping', 'Verifica della chiave'),
    mk('POST', '/api/orders/integrations/silva/stock', 'Feed delle giacenze di magazzino {articoli: [...]}'),
    mk('GET', '/api/orders/integrations/silva/orders', 'Ordini approvati da preparare (polling ogni 5 minuti)'),
    mk('GET', '/api/orders/integrations/silva/orders/:numero', 'Dettaglio di un ordine'),
    mk('POST', '/api/orders/integrations/silva/orders/:numero/presa-in-carico', 'Avanzamento: presa in carico'),
    mk('POST', '/api/orders/integrations/silva/orders/:numero/spedito', 'Avanzamento: spedito (DDT)'),
    mk('POST', '/api/orders/integrations/silva/orders/:numero/consegnato', 'Avanzamento: consegnato (righe, lotti, barcode)'),
  ];
  return [
    mk('GET', '/api/ingest/ping', 'Verifica della chiave API', 'Authorization: Bearer <chiave API di Amministrazione > Chiavi API>'),
    mk('POST', '/api/ingest/:dataset', 'Ingestione dati {batch_uid, source, rows: [...]} (people, sites, organizations, events, news, generico)', 'Authorization: Bearer <chiave API di Amministrazione > Chiavi API>'),
  ];
}

// ---- prova di connessione: una chiamata leggera per sistema, esito registrato sulla riga e nel registro
async function fetchJson(url, { method = 'GET', body = undefined, headers = {}, timeoutMs = 12000 } = {}) {
  const t0 = Date.now();
  let res, text;
  try { res = await fetch(url, { method, body, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) }); text = await res.text(); }
  catch (e) { throw Object.assign(new Error(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'nessuna risposta entro il tempo massimo' : `non raggiungibile: ${e.cause?.message || e.message}`), { ms: Date.now() - t0 }); }
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data, text, ms: Date.now() - t0 };
}
export async function testConnector(kind) {
  const c = await getConnector(kind);
  const t0 = Date.now();
  let out;
  let endpoint = null;
  try {
    if (kind === 'STUDIOLAB' && c.auth_kind === 'CLIENT_JWT') {
      // WebApi StudioLAB con client registrato: login → token → GET /api/v1/auth/client/info
      // prima la salute del servizio (senza token): distingue "non raggiungibile" da "credenziali sbagliate"
      const base = String(c.base_url).replace(/\/+$/, '');
      const h = await fetchJson(`${base}/api/v1/health`, { headers: studiolabExtraHeaders(c), timeoutMs: Number(c.settings.timeout_ms) || 12000 }).catch((e) => ({ errore: e.message }));
      if (h.errore) throw new Error(`StudioLAB non raggiungibile su ${base}/api/v1/health: ${h.errore}`);
      if (!h.res.ok) throw new Error(`StudioLAB /api/v1/health risponde ${h.res.status}: ${h.text.slice(0, 200)}`);
      // Synclab Data API v1 (09/11/2026): la verifica autenticata è GET /api/v1/data/metadata (ruolo DataAPI); /auth/client/info si prova
      // dopo e un suo 403 non è un errore (richiede il ruolo Application). Installazione senza Data API (metadata 404): vale info, come prima.
      const tok = await studiolabClientToken({ forza: true });
      const auth = { Authorization: `Bearer ${tok.accessToken}`, 'User-Agent': `TD-Suite/${APP_VERSION}`, ...studiolabExtraHeaders(c) };
      const tmo = Number(c.settings.timeout_ms) || 12000;
      const scad = `token valido fino al ${tok.validTo ? new Date(tok.validTo).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'n.d.'}`;
      const testo = (r) => (r.data && (r.data.title || r.data.message || r.data.Message)) || r.text.slice(0, 200) || r.res.statusText;
      endpoint = `${base}/api/v1/data/metadata`;
      const t1 = Date.now();
      const m = await fetchJson(endpoint, { headers: auth, timeoutMs: tmo });
      logConnector({ kind: 'STUDIOLAB', direction: 'OUT', module: 'synclab', endpoint: 'GET /api/v1/data/metadata', status: m.res.status, ms: Date.now() - t1, message: m.res.ok ? null : testo(m) });
      const infoUrl = `${base}/api/v1/auth/client/info`;
      const i = await fetchJson(infoUrl, { headers: auth, timeoutMs: tmo }).catch((e) => ({ errore: e.message }));
      const infoOk = !i.errore && i.res.ok; const info = infoOk && i.data && typeof i.data === 'object' ? i.data : {};
      if (m.res.ok && m.data && typeof m.data === 'object') {
        const d = m.data;
        const ds = Array.isArray(d.datasets) ? d.datasets.join(', ') : 'n.d.';
        const nota = infoOk ? `${info.name || info.Name ? ` · client ${info.name || info.Name}` : ''}` : !i.errore && i.res.status === 403 ? ' · ruolo DataAPI: info non disponibile, metadati ok' : '';
        out = { ok: true, message: `Connessione e autenticazione riuscite · Data API: istanza ${d.instanceId || 'n.d.'}, contratto ${d.contractVersion || 'n.d.'}, insiemi di dati ${ds}, pagina massima ${d.maxPageSize ?? 'n.d.'}, finestra delta ${d.deltaWindowDays ?? 'n.d.'} giorni · ${scad}${nota} (${m.ms} ms)`, metadata: { instanceId: d.instanceId || null, contractVersion: d.contractVersion || null, datasets: Array.isArray(d.datasets) ? d.datasets : [], maxPageSize: d.maxPageSize ?? null, deltaWindowDays: d.deltaWindowDays ?? null } };
      } else if (m.res.status === 404 && infoOk) {
        endpoint = infoUrl;
        out = { ok: true, message: `Connessione e autenticazione riuscite · ${scad}${info.name || info.Name ? ` · ${info.name || info.Name}` : ''} · Data API non pubblicata su questa installazione (metadata 404) (${i.ms} ms)` };
      } else if (m.res.status === 403) {
        throw new Error(`login riuscito ma /api/v1/data/metadata risponde 403: il client non ha il ruolo DataAPI (${testo(m)})`);
      } else {
        throw new Error(`StudioLAB /api/v1/data/metadata risponde ${m.res.status}: ${testo(m)}`);
      }
    } else if (kind === 'STUDIOLAB') {
      if (!c.credentials.api_key) throw new Error('Chiave API non impostata');
      endpoint = studiolabUrl(c.base_url, '/api/whoami');
      const r = await fetchJson(endpoint, { headers: { 'X-API-KEY': c.credentials.api_key, ...studiolabExtraHeaders(c) }, timeoutMs: Number(c.settings.timeout_ms) || 12000 });
      if (!r.res.ok) throw new Error(`StudioLAB risponde ${r.res.status}: ${(r.data && (r.data.Message || r.data.message)) || r.text.slice(0, 200) || r.res.statusText}`);
      const who = r.data && typeof r.data === 'object' ? r.data : {};
      out = { ok: true, message: `Connessione riuscita${who.CodiceServiceNet ? ` · nodo ${who.CodiceServiceNet}` : ''}${who.Versione || who.Version ? ` · WebApi ${who.Versione || who.Version}` : ''} (${r.ms} ms)` };
    } else if (kind === 'TUOTEMPO') {
      const token = c.credentials.api_key || c.credentials.token || c.credentials.password;
      if (!token) throw new Error('api_key TuoTempo non impostata');
      if (!c.settings.instance) throw new Error('Istanza TuoTempo (dbName) non impostata nelle impostazioni');
      endpoint = `${c.base_url.replace(/\/+$/, '')}/${c.settings.instance}/typologies?fields=typologyid,typologyTitle&lang=${c.settings.lang || 'it'}`;
      const r = await fetchJson(endpoint, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': `TD-Suite/${APP_VERSION}`, 'Content-Type': 'application/json; charset=utf-8' } });
      if (!r.res.ok || (r.data && r.data.result && r.data.result !== 'OK')) throw new Error(`TuoTempo risponde ${r.res.status}${r.data?.exception ? ` ${r.data.exception}` : ''}: ${r.data?.msg || r.text.slice(0, 200)}`);
      const rows = Array.isArray(r.data?.return?.results) ? r.data.return.results : Array.isArray(r.data?.results) ? r.data.results : [];
      out = { ok: true, message: `Connessione riuscita: ${rows.length} tipologie (${r.ms} ms)` };
    } else if (kind === 'SILVA') {
      // Guida tecnica API ordini v1 (09/11/2026): prima la GET delle destinazioni (sedi autorizzate, verifica anche il permesso ordini
      // della chiave), poi il catalogo dell'anno. Le chiamate passano dal limitatore condiviso (30 al minuto, modules/orders/lib/silva.js).
      if (c.credentials.api_key) {
        const { silvaCall, memorizzaDestinazioni, validaDestinazioni, primoInvioConfermato, pushAttivo } = await import('../modules/orders/lib/silva.js');
        const base = (c.base_url || DEFAULT_BASE_URL.SILVA).replace(/\/+$/, '');
        const testo = (r) => (r.data && (r.data.message || r.data.error || r.data.title)) || r.text.slice(0, 200) || r.res.statusText;
        endpoint = `${base}/api/v1/destinazioni`;
        const d = await silvaCall(c, 'GET', '/api/v1/destinazioni', { module: 'admin', timeoutMs: 30000 });
        if (d.status === 401) throw new Error('Silva rifiuta la chiave (401): verifica X-API-KEY e la sua scadenza');
        let destinazioni;
        if (d.status === 403) destinazioni = 'destinazioni non leggibili: la chiave non è abilitata a ordini e destinazioni (403)';
        else if (!d.res.ok) destinazioni = `destinazioni: Silva risponde ${d.status}: ${testo(d)}`;
        else if (!validaDestinazioni(d.data)) destinazioni = 'destinazioni: risposta non nel formato previsto';
        else { await memorizzaDestinazioni(d.data.destinazioni); destinazioni = null; }
        const nDest = destinazioni ? null : d.data.destinazioni.length;
        const anno = String(c.settings.catalog_years || '').split(/[;,\s]+/).map(Number).find((n) => n >= 2000) || new Date().getFullYear();
        endpoint = `${base}/api/v1/catalogo?anno=${anno}`;
        const r = await silvaCall(c, 'GET', `/api/v1/catalogo?anno=${anno}`, { module: 'admin', timeoutMs: 60000 });
        if (r.status === 401 || r.status === 403) throw new Error(`Silva rifiuta la chiave sul catalogo (${r.status}): verifica X-API-KEY e la sua scadenza`);
        if (!r.res.ok) throw new Error(`${nDest != null ? `${nDest} destinazioni autorizzate · ` : ''}catalogo: Silva risponde ${r.status}: ${testo(r)}`);
        const n = Array.isArray(r.data?.articoli) ? r.data.articoli.length : null;
        if (n == null) throw new Error('Risposta del catalogo non nel formato previsto (manca "articoli")');
        const upd = r.res.headers.get('x-catalog-updated-at');
        const scad = c.settings.key_expires_at ? ` · chiave valida fino al ${new Date(c.settings.key_expires_at).toLocaleDateString('it-IT')}` : '';
        const invio = !pushAttivo(c) ? 'trasmissione ordini all\'approvazione disattivata' : primoInvioConfermato(c) ? 'trasmissione ordini automatica attiva' : 'trasmissione automatica sospesa fino al primo invio concordato';
        if (destinazioni) throw new Error(`${destinazioni} · catalogo ${anno} letto: ${n} articoli`);
        out = { ok: true, message: `${nDest} destinazioni autorizzate · catalogo ${anno} letto: ${n} articoli con giacenza${upd ? `, aggiornato al ${new Date(upd).toLocaleString('it-IT')}` : ''} · ${invio} (${d.ms + r.ms} ms)${scad}`, destinazioni: nDest };
      } else {
        if (!c.inbound_secrets.length) throw new Error('Né chiave API Silva né segreto in ingresso impostati');
        out = { ok: true, message: `Segreto in ingresso impostato, codice cliente ${c.settings.customer_code || 'non indicato'}. Chiave API Silva assente: destinazioni, catalogo, ordini e stato non si usano finché non la inserisci.` };
      }
    } else {
      if (c.base_url) { try { new URL(c.base_url); } catch { throw new Error('Base URL non valida'); } }
      out = { ok: true, message: c.base_url ? `Configurazione valida (endpoint ${c.base_url}). GIPO non espone API documentate: i dati entrano con l'import da file e con le API di ingestione.` : 'Configurazione valida. GIPO non espone API documentate: i dati entrano con l\'import da file e con le API di ingestione.' };
    }
  } catch (e) {
    out = { ok: false, message: `Prova non riuscita: ${e.message}` };
  }
  const ms = Date.now() - t0;
  await q('UPDATE public.connectors SET last_test_at=now(), last_status=$2, last_message=$3 WHERE kind=$1', [kind, out.ok ? 'OK' : 'ERRORE', out.message]);
  await refreshConnector(kind);
  if (endpoint) await logConnector({ kind, direction: 'OUT', module: 'admin', endpoint: `TEST ${endpoint}`, status: out.ok ? 'OK' : 'ERRORE', ms, message: out.message });
  return { ...out, ms };
}

// ---- StudioLAB WebApi, client registrato (CB Sistemi, istruzioni dell'08/11/2026): POST /api/v1/auth/client/register (una volta,
// imposta la password del client già censito: name, id, host, password), POST /api/v1/auth/client/login → { accessToken, validTo },
// Bearer su ogni chiamata. Credenziali del connettore: client_name, client_id, client_host, password (cifrate). Il token resta in
// memoria fino a 2 minuti prima della scadenza; su 401 chi chiama ripete il login (forza: true).
let jwtCache = { token: null, validTo: 0 };
// Cloudflare Access (service token) davanti a un Cloudflare Tunnel che espone la WebApi del laboratorio: intestazioni aggiuntive su
// ogni chiamata (settings.cf_access_client_id + credentials.cf_access_client_secret). Vuote = nessuna intestazione.
export function studiolabExtraHeaders(c = connectorSync('STUDIOLAB')) {
  const id = c.settings?.cf_access_client_id; const secret = c.credentials?.cf_access_client_secret;
  return id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
}
const jwtBase = (c) => String(c.base_url || '').trim().replace(/\/+$/, '');
export async function studiolabClientToken({ forza = false } = {}) {
  const c = await getConnector('STUDIOLAB');
  if (c.auth_kind !== 'CLIENT_JWT') throw new Error('Il connettore StudioLAB non usa l\'autenticazione a client registrato');
  if (!c.credentials.client_name || !c.credentials.password) throw new Error('Nome del client e password non impostati');
  if (!forza && jwtCache.token && jwtCache.validTo - Date.now() > 120000) return { accessToken: jwtCache.token, validTo: new Date(jwtCache.validTo).toISOString(), cached: true };
  const t0 = Date.now();
  const r = await fetchJson(`${jwtBase(c)}/api/v1/auth/client/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...studiolabExtraHeaders(c) }, body: JSON.stringify({ name: c.credentials.client_name, password: c.credentials.password }), timeoutMs: Number(c.settings.timeout_ms) || 12000 });
  logConnector({ kind: 'STUDIOLAB', direction: 'OUT', module: 'core', endpoint: 'POST /api/v1/auth/client/login', status: r.res.status, ms: Date.now() - t0, message: r.res.ok ? null : r.text.slice(0, 300) });
  if (!r.res.ok) {
    const errs = Array.isArray(r.data?.errors) ? r.data.errors.map((e) => e.errorMessage || e.message).filter(Boolean) : [];
    throw new Error(`Login StudioLAB rifiutato (${r.res.status}): ${errs.length ? errs.join('; ') : (r.data && (r.data.message || r.data.Message || r.data.title)) || r.text.slice(0, 300) || r.res.statusText}`);
  }
  // scadenza = validTo restituito dal login (in questa installazione circa 15 minuti), mai un'ipotesi: senza validTo leggibile il token
  // vale per la sola richiesta in corso e la successiva rifà il login
  const token = r.data?.accessToken; const vt = r.data?.validTo ? Date.parse(r.data.validTo) : NaN; const validTo = Number.isFinite(vt) ? vt : Date.now();
  if (!token) throw new Error('Login StudioLAB senza accessToken nella risposta');
  jwtCache = { token, validTo };
  return { accessToken: token, validTo: new Date(validTo).toISOString(), cached: false };
}
export function studiolabClientTokenReset() { jwtCache = { token: null, validTo: 0 }; }
export async function studiolabClientRegister() {
  const c = await getConnector('STUDIOLAB');
  if (c.auth_kind !== 'CLIENT_JWT') throw new Error('Imposta prima l\'autenticazione "Client registrato (StudioLAB)"');
  const { client_name, client_id, client_host, password } = c.credentials;
  if (!client_name || !client_id || !password) throw new Error('Servono nome del client, id del client e password');
  if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/.test(password)) throw new Error('La password deve avere da 8 a 16 caratteri con maiuscola, minuscola, numero e carattere speciale');
  const t0 = Date.now();
  const r = await fetchJson(`${jwtBase(c)}/api/v1/auth/client/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...studiolabExtraHeaders(c) }, body: JSON.stringify({ name: client_name, id: client_id, host: client_host || client_name, password }), timeoutMs: Number(c.settings.timeout_ms) || 12000 });
  logConnector({ kind: 'STUDIOLAB', direction: 'OUT', module: 'core', endpoint: 'POST /api/v1/auth/client/register', status: r.res.status, ms: Date.now() - t0, message: r.res.ok ? null : r.text.slice(0, 300) });
  if (!r.res.ok) {
    // la WebApi risponde con una validazione { isValid, errors: [{ propertyName, errorMessage }] }: si mostra il messaggio, non il JSON
    const errs = Array.isArray(r.data?.errors) ? r.data.errors.map((e) => e.errorMessage || e.message).filter(Boolean) : [];
    const msg = errs.length ? errs.join('; ') : (r.data && (r.data.message || r.data.Message || r.data.title)) || r.text.slice(0, 300) || r.res.statusText;
    throw new Error(`Registrazione rifiutata (${r.res.status}): ${msg}. Se dice che la password è già impostata, è normale: passa alla Prova connessione; se la Prova dà "credenziali errate", la password registrata in passato è diversa da quella salvata qui e va riallineata con CB Sistemi.`);
  }
  studiolabClientTokenReset();
  return { ok: true, message: `Password del client ${client_name} registrata (${Date.now() - t0} ms)` };
}
