// Coordinate dall'indirizzo: Nominatim (OpenStreetMap, gratuito, 1 richiesta al secondo, User-Agent obbligatorio) con precisione al
// civico; se non trova nulla, Open-Meteo per la sola città. Senza chiavi. Usato dal form Sedi (pulsante) e al salvataggio di una
// sede senza coordinate; nelle importazioni delle sedi le coordinate mancanti si completano in coda, una al secondo.
import { geocodeCity } from './weather.js';

const UA = 'SuiteTD/0.6 (suite.toscanadiagnostica.it; it@toscanadiagnostica.it)';
let last = 0;
async function throttle() { const wait = 1100 - (Date.now() - last); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); last = Date.now(); }

export function addressLine({ address, zip, city, province }) {
  return [address, [zip, city].filter(Boolean).join(' '), province ? `(${province})` : null].filter(Boolean).join(', ');
}

async function nominatim(params) {
  await throttle();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('format', 'jsonv2'); u.searchParams.set('limit', '1'); u.searchParams.set('countrycodes', 'it'); u.searchParams.set('addressdetails', '1'); u.searchParams.set('accept-language', 'it');
  const res = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const j = await res.json();
  return j?.[0] || null;
}

/** Ritorna { lat, lng, label, precision: 'civico'|'via'|'citta', source } oppure null */
export async function geocodeAddress({ address, zip, city, province }) {
  if (!address && !city) return null;
  try {
    // 1. ricerca strutturata (indirizzo + città + CAP), la più precisa
    let hit = address && city ? await nominatim({ street: address, city, postalcode: zip, state: province ? undefined : undefined }) : null;
    // 2. ricerca libera sulla riga completa
    if (!hit) hit = await nominatim({ q: addressLine({ address, zip, city, province }) });
    if (hit) {
      const a = hit.address || {};
      const precision = a.house_number ? 'civico' : a.road ? 'via' : 'citta';
      return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name, precision, source: 'OpenStreetMap Nominatim' };
    }
  } catch (e) { console.warn('[geocode] Nominatim:', e.message); }
  // 3. solo la città (Open-Meteo)
  if (city) {
    try { const c = await geocodeCity(city); if (c) return { lat: c.lat, lng: c.lng, label: c.name, precision: 'citta', source: 'Open-Meteo' }; } catch (e) { console.warn('[geocode] Open-Meteo:', e.message); }
  }
  return null;
}

/** Completa lat/lng di una sede salvata se mancano (non blocca il chiamante) */
export function autoGeocodeSite(site, save) {
  if (!site || (site.lat != null && site.lng != null) || (!site.address && !site.city)) return;
  geocodeAddress(site).then((g) => { if (g) return save(site.id, g); }).catch((e) => console.warn('[geocode]', e.message));
}
