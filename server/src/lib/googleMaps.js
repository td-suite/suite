// Google Maps Platform lato server (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md): chiavi, maschera della chiave e
// geocodifica con la Geocoding API. Le chiavi stanno SOLO nelle variabili d'ambiente:
//  - GOOGLE_MAPS_SERVER_KEY: Places API (New) e Geocoding, usata solo dal server, mai inviata al browser né scritta nei log;
//  - GOOGLE_MAPS_BROWSER_KEY: Maps JavaScript, consegnata alle pagine autenticate da GET /api/retail/intorno/config
//    (limitata per referrer su Google Cloud: è visibile a chi apre la pagina, come ogni chiave delle mappe nel browser).
// Le funzioni di normalizzazione sono pure (testabili senza rete): le risposte finte dei test non toccano Google.

export const TIMEOUT_MS = 10_000;
export const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export const chiaveServer = () => String(process.env.GOOGLE_MAPS_SERVER_KEY || '').trim();
export const chiaveBrowser = () => String(process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim() || null;

/** Chiave mascherata per le schermate di prova: solo le ultime 4 cifre (es. "••••3fQk"); null se assente */
export function mascheraChiave(k) {
  const s = String(k || '');
  if (!s) return null;
  return `••••${s.slice(-4)}`;
}

/** Toglie la chiave da un testo (messaggi d'errore, URL, risposte grezze): sia il valore sia i parametri key=… */
export function senzaChiave(testo, chiave = chiaveServer()) {
  let t = String(testo ?? '');
  if (chiave) t = t.split(chiave).join(mascheraChiave(chiave));
  return t.replace(/([?&]key=)[^&\s"']+/gi, '$1••••').replace(/(X-Goog-Api-Key["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]{8,}/gi, '$1••••');
}

// location_type della Geocoding API → precisione nel linguaggio della Suite (come lib/geocode.js)
const PRECISIONE = { ROOFTOP: 'civico', RANGE_INTERPOLATED: 'civico', GEOMETRIC_CENTER: 'via', APPROXIMATE: 'citta' };

/**
 * Risposta della Geocoding API → { lat, lng, label, precision, place_id, location_type, partial_match, source } oppure null.
 * Lancia un errore leggibile per gli stati d'errore di Google (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST…).
 */
export function normalizzaGeocodifica(j) {
  if (!j || typeof j !== 'object') throw new Error('Geocoding: risposta vuota');
  if (j.status === 'ZERO_RESULTS') return null;
  if (j.status && j.status !== 'OK') throw new Error(`Geocoding: ${j.status}${j.error_message ? ` (${j.error_message})` : ''}`);
  const r = (j.results || [])[0];
  const loc = r?.geometry?.location;
  if (!r || !Number.isFinite(Number(loc?.lat)) || !Number.isFinite(Number(loc?.lng))) return null;
  const lt = r.geometry.location_type || null;
  const tipi = r.types || [];
  let precision = PRECISIONE[lt] || 'citta';
  if (tipi.includes('street_address') || tipi.includes('premise') || tipi.includes('subpremise')) precision = 'civico';
  else if (tipi.includes('route') && precision === 'citta') precision = 'via';
  return { lat: Number(loc.lat), lng: Number(loc.lng), label: r.formatted_address || '', precision, place_id: r.place_id || null,
    location_type: lt, partial_match: Boolean(r.partial_match), source: 'Google Geocoding' };
}

/** Geocodifica di un indirizzo libero con la chiave server (fetchFn sostituibile nei test e dal mock della Suite) */
export async function geocodificaGoogle(indirizzo, { chiave = chiaveServer(), fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!chiave) throw new Error('GOOGLE_MAPS_SERVER_KEY non impostata');
  const u = new URL(GEOCODING_URL);
  u.searchParams.set('address', String(indirizzo || ''));
  u.searchParams.set('region', 'it');
  u.searchParams.set('language', 'it');
  u.searchParams.set('key', chiave);
  let res;
  try { res = await fetchFn(u.toString(), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } }); }
  catch (e) { throw new Error(senzaChiave(`Geocoding non raggiungibile: ${e.name === 'TimeoutError' ? `nessuna risposta in ${timeoutMs / 1000} s` : e.message}`, chiave)); }
  let j = null;
  try { j = await res.json(); } catch { /* non JSON */ }
  if (!res.ok && !j) throw new Error(`Geocoding: HTTP ${res.status}`);
  try { return normalizzaGeocodifica(j); } catch (e) { throw new Error(senzaChiave(e.message, chiave)); }
}
