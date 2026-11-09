// Coordinate dall'indirizzo: Google Geocoding se è impostata GOOGLE_MAPS_SERVER_KEY (lib/googleMaps.js), poi Nominatim (OpenStreetMap, gratuito, 1 richiesta al secondo, User-Agent obbligatorio) con precisione al
// civico; se non trova nulla, Open-Meteo per la sola città. Senza chiave Google funziona lo stesso. Usato dal form Sedi (pulsante) e al salvataggio di una
// sede senza coordinate; nelle importazioni delle sedi le coordinate mancanti si completano in coda, una al secondo.
import { geocodeCity } from './weather.js';
import { chiaveServer, geocodificaGoogle, senzaChiave } from './googleMaps.js';

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
  // 0. Google Geocoding se c'è la chiave server (GOOGLE_MAPS_SERVER_KEY, docs/RETAIL_INTORNO.md): più precisa al civico in Italia.
  //    Se non trova o dà errore si prosegue con OpenStreetMap come prima.
  if (chiaveServer()) {
    try {
      const g = await geocodificaGoogle(`${addressLine({ address, zip, city, province })}, Italia`);
      if (g) return { lat: g.lat, lng: g.lng, label: g.label, precision: g.precision, source: g.source };
    } catch (e) { console.warn('[geocode] Google:', senzaChiave(e.message)); }
  }
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

// ---- Comuni di provenienza (profilo dei pazienti del laboratorio in Retail, v0.67.1): coordinate del COMUNE (non di un indirizzo) con
// cache in public.geo_comuni (migrazione core 053). La pagina disegna le bolle solo per i comuni già in cache; la geocodifica dei mancanti
// si fa a richiesta, a piccoli lotti (OpenStreetMap: 1 richiesta al secondo). Un comune non trovato resta NON_TROVATO e non si ripete
// prima di 30 giorni; un errore di rete resta ERRORE e si ritenta al giro dopo. Nessun dato inventato: senza coordinate il comune resta solo in tabella.
export const normComune = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const normProvincia = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Coordinate di un COMUNE (centro): Google Geocoding se c'è la chiave server, altrimenti Nominatim (ricerca strutturata per città in
 * Italia), poi Open-Meteo. A differenza di geocodeAddress gli errori di rete NON diventano "non trovato": si propagano, così la cache
 * registra ERRORE e il comune si ritenta al giro dopo. Ritorna { lat, lng, label, precision: 'citta', source } oppure null (non trovato).
 */
export async function geocodeComune({ city, province = null }) {
  const nome = String(city || '').trim();
  if (!nome) return null;
  let errore = null;
  if (chiaveServer()) {
    try { const g = await geocodificaGoogle(`${nome}${province ? ` (${province})` : ''}, Italia`); if (g) return { lat: g.lat, lng: g.lng, label: g.label, precision: 'citta', source: g.source }; }
    catch (e) { errore = new Error(senzaChiave(e.message)); }
  }
  try {
    const hit = await nominatim({ city: nome });
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name, precision: 'citta', source: 'OpenStreetMap Nominatim' };
    errore = null;
  } catch (e) { errore = e; }
  let c = null;
  try { c = await geocodeCity(nome); } catch (e) { throw errore || e; }
  if (c) return { lat: c.lat, lng: c.lng, label: c.name, precision: 'citta', source: 'Open-Meteo' };
  if (errore) throw errore;   // Nominatim non raggiungibile e Open-Meteo senza risultato: non è un "non trovato" certo
  return null;
}

/** Coordinate in cache per un elenco [{ comune, provincia }]: Map 'comune|PR' → riga di geo_comuni (solo esito OK). */
export async function comuniInCache(lista) {
  const { many } = await import('../db.js');
  const out = new Map();
  if (!lista?.length) return out;
  const rows = await many(`SELECT comune_norm, provincia_norm, lat, lng, precision, source, esito, tentato_at FROM public.geo_comuni
     WHERE (comune_norm, provincia_norm) IN (SELECT * FROM unnest($1::text[], $2::text[]))`, [lista.map((x) => normComune(x.comune)), lista.map((x) => normProvincia(x.provincia))]);
  for (const r of rows) out.set(`${r.comune_norm}|${r.provincia_norm}`, r);
  return out;
}

/**
 * Geocodifica dei comuni non ancora in cache (al più `max` per chiamata) con geocodeAddress (città + provincia). trova: funzione
 * sostituibile nei test. Ritorna { tentati, trovati, non_trovati, errori, restanti }.
 */
export async function geocodificaComuni(lista, { max = 15, trova = geocodeComune } = {}) {
  const { q } = await import('../db.js');
  const cache = await comuniInCache(lista);
  const daFare = [];
  const visti = new Set();
  for (const x of lista) {
    const k = `${normComune(x.comune)}|${normProvincia(x.provincia)}`;
    if (!normComune(x.comune) || visti.has(k)) continue;
    visti.add(k);
    const c = cache.get(k);
    if (c && (c.esito === 'OK' || (c.esito === 'NON_TROVATO' && Date.now() - new Date(c.tentato_at).getTime() < 30 * 86400_000))) continue;   // ERRORE (rete): si ritenta
    daFare.push(x);
  }
  const out = { tentati: 0, trovati: 0, non_trovati: 0, errori: 0, restanti: Math.max(0, daFare.length - max) };
  for (const x of daFare.slice(0, max)) {
    out.tentati++;
    let g = null, esito = 'NON_TROVATO';
    try { g = await trova({ city: String(x.comune).trim(), province: normProvincia(x.provincia) || null }); if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng))) esito = 'OK'; }
    catch (e) { esito = 'ERRORE'; console.warn('[geocode] comune:', e.message); }
    out[esito === 'OK' ? 'trovati' : esito === 'ERRORE' ? 'errori' : 'non_trovati']++;
    await q(`INSERT INTO public.geo_comuni (comune_norm, provincia_norm, comune, provincia, lat, lng, precision, source, label, esito, tentato_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (comune_norm, provincia_norm) DO UPDATE SET comune=EXCLUDED.comune, provincia=EXCLUDED.provincia, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
         precision=EXCLUDED.precision, source=EXCLUDED.source, label=EXCLUDED.label, esito=EXCLUDED.esito, tentato_at=now()`,
    [normComune(x.comune), normProvincia(x.provincia), String(x.comune).trim(), normProvincia(x.provincia) || null, esito === 'OK' ? g.lat : null, esito === 'OK' ? g.lng : null,
      esito === 'OK' ? g.precision || null : null, esito === 'OK' ? g.source || null : null, esito === 'OK' ? String(g.label || '').slice(0, 300) : null, esito]);
  }
  return out;
}
