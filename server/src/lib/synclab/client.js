// Synclab Data API v1 (CB Sistemi): client HTTP in sola lettura. Contratto: docs/synclab-data-api/01_CONTRATTO_API.md.
// - Login con il connettore STUDIOLAB (auth_kind CLIENT_JWT): studiolabClientToken() tiene il token in memoria fino a 2 minuti prima
//   del validTo restituito dal login; su 401 un login nuovo (forza) e la ripetizione della stessa richiesta con lo stesso cursor.
// - 202 = cattura in corso: si restituisce { pending, snapshotId, nextCursor, retryAfter } e chi chiama ripete con il cursor.
// - 429: attesa del Retry-After e ripetizione (al più N volte); 500/502/504 e rete: ripetizioni limitate con attesa crescente; 503:
//   cattura fallita (ripetizioni limitate, poi errore: nessun import parziale); 400/403/404/409: errore senza ripetizioni.
// - Corpi decodificati in UTF-8 (application/json e application/problem+json); i numeri decimali che un double non rappresenta
//   esattamente restano testo esatto (JSON.rawJSON): importi e quantità arrivano al database senza arrotondamenti.
// - Registro con logConnector (modulo synclab): metodo, percorso senza query, esito, ms, conteggi e correlationId. Mai corpi, cursori,
//   token o intestazioni di autenticazione.
import { APP_VERSION } from '../../version.js';
import { getConnector, logConnector, studiolabClientToken, studiolabExtraHeaders } from '../connectors.js';

export const DATASETS = ['exams', 'clients', 'price-lists', 'requests', 'invoices'];   // ordine del ciclo notturno
export const DATASET_PAZIENTE = new Set(['requests', 'invoices']);                      // includePatient ammesso (proiezione)
export const FILTRI_AMMESSI = { clients: ['clientId', 'operatingCompany'], exams: [], 'price-lists': ['operatingCompany'], requests: ['clientId', 'operatingCompany', 'requestNumber', 'sampleBarcode'], invoices: ['clientId', 'operatingCompany'] };
export const NOMI_DATASET = { clients: 'clienti', exams: 'esami', 'price-lists': 'listini', requests: 'accettazioni', invoices: 'documenti economici' };

// Opzioni del processo (i test accorciano le attese: scalaAttese 0.01 = Retry-After di 2 s → 20 ms)
const opz = { scalaAttese: 1, chiamateAlMinuto: 60, max429: 5, max5xx: 3, max503: 2, timeoutMs: 120_000 };
export function configura(o = {}) { Object.assign(opz, o); return { ...opz }; }
export const attendi = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.round(ms * opz.scalaAttese))));

export class SynclabError extends Error {
  constructor(message, { status = null, code = null, title = null, correlationId = null, retryAfter = null, tipo = null } = {}) {
    super(message);
    this.name = 'SynclabError'; this.status = status; this.code = code; this.title = title; this.correlationId = correlationId; this.retryAfter = retryAfter;
    // tipo: CONFIGURAZIONE (400/403/scope_mismatch: nessun avanzamento), CURSORE_SCADUTO, COMPLETO_RICHIESTO, CATTURA_FALLITA, TRANSITORIO, AUTENTICAZIONE, ASSENTE
    this.tipo = tipo || tipoDa(status, code);
  }
}
function tipoDa(status, code) {
  if (code === 'cursor_expired') return 'CURSORE_SCADUTO';
  if (code === 'full_sync_required') return 'COMPLETO_RICHIESTO';
  if (status === 503) return 'CATTURA_FALLITA';
  if (status === 401) return 'AUTENTICAZIONE';
  if (status === 404) return 'ASSENTE';
  if (status === 400 || status === 403 || code === 'scope_mismatch') return 'CONFIGURAZIONE';
  return 'TRANSITORIO';
}

/**
 * JSON con i decimali esatti: un numero il cui testo non coincide con la sua forma double (es. 0.1000000000000000055, 1e3, interi oltre
 * 2^53) diventa JSON.rawJSON(testo): JSON.stringify lo riscrive identico e dec() lo passa a PostgreSQL come testo.
 */
export function parsePreciso(text) {
  return JSON.parse(text, function reviver(_k, v, ctx) {
    if (typeof v === 'number' && ctx && typeof ctx.source === 'string' && String(v) !== ctx.source && typeof JSON.rawJSON === 'function') return JSON.rawJSON(ctx.source);
    return v;
  });
}
/** Valore numerico per una colonna numeric: null resta null, il testo esatto resta testo. */
export const dec = (v) => (v == null ? null : (typeof JSON.isRawJSON === 'function' && JSON.isRawJSON(v)) ? v.rawJSON : typeof v === 'number' ? String(v) : String(v));

const retryAfterS = (res, def = 2) => { const h = res?.headers?.get?.('retry-after'); const n = Number(h); return h != null && h !== '' && Number.isFinite(n) && n >= 0 ? n : def; };

// ---- limitatore: al più N chiamate in 60 secondi per client (finestra scorrevole)
const chiamate = [];
async function limitatore() {
  for (;;) {
    const ora = Date.now();
    while (chiamate.length && ora - chiamate[0] >= 60_000) chiamate.shift();
    if (chiamate.length < opz.chiamateAlMinuto) { chiamate.push(ora); return; }
    await new Promise((r) => setTimeout(r, Math.max(50, 60_000 - (ora - chiamate[0]))));
  }
}

const baseUrl = (c) => String(c.base_url || '').trim().replace(/\/+$/, '');
const qsDa = (query = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) u.append(k, String(x)); else u.append(k, String(v));
  }
  return u.toString();
};

/**
 * GET autenticato. Ritorna { status: 200, data, ms, correlationId? } oppure { status: 202, pending: true, snapshotId, nextCursor, retryAfter }.
 * Errori: SynclabError con status, code, correlationId, retryAfter e tipo.
 * logInfo: { dataset } per il registro (mai la query: contiene cursori e checkpoint).
 */
export async function get(path, query = {}, { timeoutMs = null, logInfo = {}, logPath = null } = {}) {
  const c = await getConnector('STUDIOLAB');
  if (c.auth_kind !== 'CLIENT_JWT') throw new SynclabError('Il connettore StudioLAB non usa il client registrato (CLIENT_JWT): la Data API richiede il login del client', { tipo: 'CONFIGURAZIONE' });
  const base = baseUrl(c);
  if (!base) throw new SynclabError('Base URL del connettore StudioLAB non impostata', { tipo: 'CONFIGURAZIONE' });
  const qs = qsDa(query);
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const tmo = Number(timeoutMs) || Number(c.settings?.data_api_timeout_ms) || opz.timeoutMs;
  let rinnovato = false, n429 = 0, n5xx = 0, n503 = 0, nuovoToken = null;
  for (;;) {
    await limitatore();
    const tok = nuovoToken || await studiolabClientToken({ forza: false });
    nuovoToken = null;
    const t0 = Date.now();
    let res, text;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${tok.accessToken}`, 'User-Agent': `TD-Suite/${APP_VERSION}`, ...studiolabExtraHeaders(c) }, signal: AbortSignal.timeout(tmo) });
      text = await res.text();   // fetch decodifica sempre in UTF-8
    } catch (e) {
      const msg = e.name === 'TimeoutError' || e.name === 'AbortError' ? `nessuna risposta entro ${Math.round(tmo / 1000)} s` : `non raggiungibile: ${e.cause?.message || e.message}`;
      registra(logPath || path, 'ERRORE', Date.now() - t0, msg, logInfo);
      if (++n5xx <= opz.max5xx) { await attendi(2000 * 2 ** (n5xx - 1)); continue; }
      throw new SynclabError(`Synclab ${msg}`, { tipo: 'TRANSITORIO' });
    }
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (text) { try { data = /json/i.test(ct) || /^[\s]*[[{]/.test(text) ? parsePreciso(text) : text; } catch { data = text; } }
    const pb = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const correlationId = pb.correlationId || null;
    if (res.status === 200) {
      const n = Array.isArray(data) ? data.length : Array.isArray(data?.items) ? data.items.length : null;
      registra(logPath || path, 200, ms, [n != null ? `${n} elementi` : null, data?.nextCursor ? 'altre pagine' : data?.syncToken ? 'ultima pagina' : null, correlationId ? `correlationId ${correlationId}` : null].filter(Boolean).join(' · ') || null, logInfo);
      return { status: 200, data, ms, correlationId };
    }
    if (res.status === 202) {
      const ra = retryAfterS(res, 2);
      registra(logPath || path, 202, ms, `cattura in corso${pb.status ? ` (${pb.status})` : ''}, nuova richiesta tra ${ra} s`, logInfo);
      return { status: 202, pending: true, snapshotId: pb.snapshotId || null, nextCursor: pb.nextCursor || null, stato: pb.status || null, retryAfter: ra, ms };
    }
    const code = pb.code || null;
    const titolo = pb.title || pb.detail || (typeof data === 'string' ? data.slice(0, 200) : null) || res.statusText;
    registra(logPath || path, res.status, ms, [code, titolo, correlationId ? `correlationId ${correlationId}` : null].filter(Boolean).join(' · '), logInfo);
    if (res.status === 401 && !rinnovato) { rinnovato = true; nuovoToken = await studiolabClientToken({ forza: true }); continue; }   // stessa richiesta, stesso cursor
    if (res.status === 429 && ++n429 <= opz.max429) { await attendi(retryAfterS(res, 5) * 1000); continue; }
    if (res.status === 503 && ++n503 <= opz.max503) { await attendi(retryAfterS(res, 2 * 2 ** (n503 - 1)) * 1000); continue; }
    if ([500, 502, 504].includes(res.status) && ++n5xx <= opz.max5xx) { await attendi(2000 * 2 ** (n5xx - 1)); continue; }
    throw new SynclabError(`Synclab risponde ${res.status}${code ? ` ${code}` : ''}: ${titolo}`, { status: res.status, code, title: pb.title || null, correlationId, retryAfter: res.status === 429 || res.status === 503 ? retryAfterS(res, null) : null });
  }
}

function registra(path, status, ms, message, { dataset = null } = {}) {
  logConnector({ kind: 'STUDIOLAB', direction: 'OUT', module: 'synclab', endpoint: `GET ${path}${dataset && !path.includes(dataset) ? ` [${dataset}]` : ''}`, status, ms, message });
}

// ---------------------------------------------------------------- risorse
export const metadata = async () => (await get('/api/v1/data/metadata')).data;

/** Una pagina (o il 202 della cattura) di un completo: /api/v1/data/<dataset>. */
export function queryPagina(dataset, { pageSize = null, includePatient = undefined, filtri = {} } = {}) {
  const q = { pageSize: pageSize || undefined };
  if (DATASET_PAZIENTE.has(dataset)) q.includePatient = includePatient ? 'true' : 'false';
  for (const k of FILTRI_AMMESSI[dataset] || []) if (filtri?.[k]) q[k] = filtri[k];
  return q;
}
// requestNumber e sampleBarcode (solo requests, confronto esatto) non entrano mai negli ambiti del ciclo (filtriCanonici di sync.js li
// ignora): servono alla ricerca puntuale di Label (v0.69.0), che passa anche un timeoutMs breve. Il registro non scrive mai la query.
export const pagina = (dataset, { cursor = null, timeoutMs = null, ...o } = {}) => get(`/api/v1/data/${dataset}`, { ...queryPagina(dataset, o), cursor: cursor || undefined }, { logInfo: { dataset }, timeoutMs });

/** Delta: /api/v1/data/sync/changes con dataset, since, filtri e proiezione dell'ambito (since e cursor ripetuti a ogni pagina). */
export function queryDelta(dataset, { since, pageSize = null, includePatient = undefined, filtri = {} } = {}) {
  return { dataset, since, ...queryPagina(dataset, { pageSize, includePatient, filtri }) };
}
export const delta = (dataset, { cursor = null, ...o } = {}) => get('/api/v1/data/sync/changes', { ...queryDelta(dataset, o), cursor: cursor || undefined }, { logInfo: { dataset } });

/** Riconciliazione: /api/v1/data/sync/status a blocchi di al più 200 id (parametri id ripetuti). */
export async function stato(dataset, ids = []) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const blocco = ids.slice(i, i + 200);
    const r = await get('/api/v1/data/sync/status', { dataset, id: blocco }, { logInfo: { dataset } });
    if (!Array.isArray(r.data)) throw new SynclabError('Risposta di /sync/status non nel formato previsto (atteso un elenco)', { tipo: 'TRANSITORIO' });
    out.push(...r.data);
  }
  return out;
}

/** Dettaglio di un record (riconciliazione "available"): null se 404 (assente o escluso: non è una cancellazione). */
export async function dettaglio(dataset, id, { includePatient = false } = {}) {
  try {
    const r = await get(`/api/v1/data/${dataset}/${encodeURIComponent(id)}`, DATASET_PAZIENTE.has(dataset) ? { includePatient: includePatient ? 'true' : 'false' } : {}, { logInfo: { dataset }, logPath: `/api/v1/data/${dataset}/{id}` });
    return r.data;
  } catch (e) { if (e.status === 404) return null; throw e; }
}

/** Righe di un listino paginate: solo per il dettaglio a richiesta, mai nel ciclo (non emette checkpoint). */
export const righeListino = (id, { cursor = null, pageSize = 100 } = {}) => get(`/api/v1/data/price-lists/${encodeURIComponent(id)}/items`, { pageSize, cursor: cursor || undefined }, { logInfo: { dataset: 'price-lists' }, logPath: '/api/v1/data/price-lists/{id}/items' });
