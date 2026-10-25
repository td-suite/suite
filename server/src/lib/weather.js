// Suite TD · meteo delle sedi via Open-Meteo (gratuito, senza chiave). Cache in memoria 30 minuti per coordinate.
import { q } from '../db.js';

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();   // chiave "lat,lng" → { at, data }
const FETCH_TIMEOUT_MS = 6000;

// Codici meteo WMO → etichetta italiana e icona (sun, cloud-sun, cloud, fog, drizzle, rain, snow, storm)
const WMO = [
  [[0], 'Sereno', 'sun'],
  [[1], 'Prevalentemente sereno', 'cloud-sun'],
  [[2], 'Parzialmente nuvoloso', 'cloud-sun'],
  [[3], 'Coperto', 'cloud'],
  [[45, 48], 'Nebbia', 'fog'],
  [[51, 53, 55, 56, 57], 'Pioviggine', 'drizzle'],
  [[61, 63, 65, 66, 67], 'Pioggia', 'rain'],
  [[80, 81, 82], 'Rovesci', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Neve', 'snow'],
  [[95, 96, 99], 'Temporale', 'storm'],
];
export function describeCode(code) {
  const c = Number(code);
  const hit = WMO.find(([codes]) => codes.includes(c));
  return hit ? { label: hit[1], icon: hit[2] } : { label: 'Variabile', icon: 'cloud' };
}

const key = (lat, lng) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'SuiteTD/0.1 (meteo sedi)' } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

// Previsioni per coordinate: { now:{temp, code, label, icon}, today:{min,max}, days:[{date,min,max,code,label,icon}] }
export async function getForecast(lat, lng) {
  const k = key(lat, lng);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}` +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FRome&forecast_days=5';
  const j = await fetchJson(url);
  const days = (j.daily?.time || []).map((date, i) => {
    const code = j.daily.weather_code?.[i];
    return { date, min: round1(j.daily.temperature_2m_min?.[i]), max: round1(j.daily.temperature_2m_max?.[i]), code, ...describeCode(code) };
  });
  const nowCode = j.current?.weather_code;
  const data = {
    now: { temp: round1(j.current?.temperature_2m), code: nowCode, ...describeCode(nowCode) },
    today: { min: days[0]?.min ?? null, max: days[0]?.max ?? null },
    days,
    fetched_at: new Date().toISOString(),
  };
  cache.set(k, { at: Date.now(), data });
  return data;
}
const round1 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

// Geocoding per città (quando la sede non ha coordinate)
export async function geocodeCity(city) {
  const j = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it&format=json&countryCode=IT`);
  const r = j.results?.[0];
  if (!r) return null;
  return { lat: Number(r.latitude), lng: Number(r.longitude), name: r.name };
}

// Meteo per una sede (riga della tabella sites). Se mancano lat/lng le ricava dalla città e le salva sulla sede.
// Non lancia mai: in caso di problemi di rete restituisce { unavailable: true }
export async function weatherForSite(site) {
  const base = { site: site ? { id: site.id, code: site.code, name: site.name } : null, city: site?.city || null };
  try {
    let { lat, lng } = site || {};
    if ((lat == null || lng == null) && site?.city) {
      const g = await geocodeCity(site.city);
      if (!g) return { ...base, unavailable: true, reason: 'Città non trovata' };
      lat = g.lat; lng = g.lng;
      if (site.id) await q('UPDATE sites SET lat=$2, lng=$3, updated_at=now() WHERE id=$1 AND lat IS NULL', [site.id, lat, lng]).catch(() => {});
    }
    if (lat == null || lng == null) return { ...base, unavailable: true, reason: 'Coordinate non disponibili' };
    const f = await getForecast(lat, lng);
    return { ...base, lat: Number(lat), lng: Number(lng), ...f };
  } catch (e) {
    console.warn('[meteo]', e.message);
    return { ...base, unavailable: true, reason: 'Servizio meteo non raggiungibile' };
  }
}

// Meteo per coordinate generiche (impostazione community.weather_default)
export async function weatherForPoint({ lat, lng, city }) {
  const base = { site: null, city: city || null };
  try {
    if (lat == null || lng == null) return { ...base, unavailable: true, reason: 'Coordinate non disponibili' };
    return { ...base, lat: Number(lat), lng: Number(lng), ...(await getForecast(lat, lng)) };
  } catch (e) {
    console.warn('[meteo]', e.message);
    return { ...base, unavailable: true, reason: 'Servizio meteo non raggiungibile' };
  }
}
