// Ricerca prospect · SCOPERTA: chi esiste. Fonte gratuita OpenStreetMap (servizio Overpass): strutture per provincia e tipologia, con
// nome, indirizzo, telefono, sito, gestore. Copertura dichiarata: buona per sanità e farmacie, scarsa per le aziende senza insegna.
import { CATEGORIE } from './fit.js';
import { UA, dominioDi, normUrl } from './web.js';
import { pivaValida } from './estrai.js';

export const PROVINCE = { AR: 'Arezzo', FI: 'Firenze', GR: 'Grosseto', LI: 'Livorno', LU: 'Lucca', MS: 'Massa-Carrara', PI: 'Pisa', PO: 'Prato', PT: 'Pistoia', SI: 'Siena' };
// tipologia → selettori OpenStreetMap
export const FILTRI = {
  RSA: ['["amenity"="nursing_home"]', '["amenity"="social_facility"]["social_facility"~"nursing_home|assisted_living"]', '["healthcare"="nursing_home"]'],
  CASA_DI_CURA: ['["amenity"="hospital"]', '["healthcare"="hospital"]'],
  POLIAMBULATORIO: ['["amenity"="clinic"]', '["healthcare"~"^(clinic|centre)$"]'],
  STUDIO_MEDICO: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
  FARMACIA: ['["amenity"="pharmacy"]'],
  LABORATORIO: ['["healthcare"="laboratory"]', '["healthcare"="sample_collection"]'],
  FISIOTERAPIA: ['["healthcare"~"^(physiotherapist|rehabilitation)$"]'],
  DENTISTA: ['["amenity"="dentist"]'],
  VETERINARIO: ['["amenity"="veterinary"]'],
  DIALISI: ['["healthcare"="dialysis"]'],
  AZIENDA: ['["office"="company"]', '["man_made"="works"]', '["industrial"]["name"]', '["craft"]["name"]["website"]'],
};
export const AVVISI_FONTE = {
  AZIENDA: 'OpenStreetMap censisce poco le aziende senza insegna o stabilimento: per la medicina del lavoro l\'elenco è parziale. Aggiungi a mano le aziende che conosci (nome e sito) e la Suite le profila allo stesso modo.',
  CASA_DI_CURA: 'L\'elenco comprende anche gli ospedali pubblici: quelli con gestore pubblico sono segnati e si possono scartare.',
};
const SERVIZI = () => (process.env.SCOUTING_OVERPASS_URL ? [process.env.SCOUTING_OVERPASS_URL] : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']);

export function costruisciQuery(provincia, categorie) {
  const sel = categorie.flatMap((c) => FILTRI[c] || []).map((f) => `  nwr${f}["name"](area.a);`).join('\n');
  return `[out:json][timeout:50];\narea["ISO3166-2"="IT-${provincia}"]->.a;\n(\n${sel}\n);\nout tags center 4000;`;
}
function categoriaDi(t, richieste) {
  const k = (c) => richieste.includes(c);
  if (k('RSA') && (t.amenity === 'nursing_home' || t.healthcare === 'nursing_home' || /nursing_home|assisted_living/.test(t.social_facility || ''))) return 'RSA';
  if (k('CASA_DI_CURA') && (t.amenity === 'hospital' || t.healthcare === 'hospital')) return 'CASA_DI_CURA';
  if (k('LABORATORIO') && /laboratory|sample_collection/.test(t.healthcare || '')) return 'LABORATORIO';
  if (k('DIALISI') && t.healthcare === 'dialysis') return 'DIALISI';
  if (k('POLIAMBULATORIO') && (t.amenity === 'clinic' || /^(clinic|centre)$/.test(t.healthcare || ''))) return 'POLIAMBULATORIO';
  if (k('FISIOTERAPIA') && /physiotherapist|rehabilitation/.test(t.healthcare || '')) return 'FISIOTERAPIA';
  if (k('STUDIO_MEDICO') && (t.amenity === 'doctors' || t.healthcare === 'doctor')) return 'STUDIO_MEDICO';
  if (k('FARMACIA') && t.amenity === 'pharmacy') return 'FARMACIA';
  if (k('DENTISTA') && t.amenity === 'dentist') return 'DENTISTA';
  if (k('VETERINARIO') && t.amenity === 'veterinary') return 'VETERINARIO';
  if (k('AZIENDA') && (t.office || t.man_made === 'works' || t.industrial || t.craft)) return 'AZIENDA';
  return 'ALTRO';
}
/** Elemento OpenStreetMap → candidato (solo dati dell'attività: nome, recapiti, gestore; nessuna persona) */
export function candidatoDaOsm(el, provincia, richieste) {
  const t = el.tags || {};
  if (!t.name || t.disused === 'yes' || t.abandoned === 'yes' || Object.keys(t).some((k) => /^(disused|abandoned|was):/.test(k) && !t.amenity && !t.healthcare && !t.office)) return null;
  const sito = normUrl(t.website || t['contact:website'] || t.url || '');
  const piva = String(t['ref:vatin'] || '').replace(/^IT/i, '').replace(/\D/g, '');
  const via = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const pubblico = /public|government|pubblic/i.test(t['operator:type'] || '') || /^(asl|usl|ausl|azienda (usl|ospedaliera|sanitaria))/i.test(t.operator || '');
  return {
    fonte: 'OSM', fonte_ref: `${el.type}/${el.id}`, nome: String(t.name).trim().slice(0, 200), categoria: categoriaDi(t, richieste),
    indirizzo: via || null, cap: t['addr:postcode'] || null, comune: t['addr:city'] || t['addr:town'] || t['addr:village'] || null, provincia,
    lat: el.lat ?? el.center?.lat ?? null, lon: el.lon ?? el.center?.lon ?? null,
    telefono: (t.phone || t['contact:phone'] || '').split(';')[0].trim() || null, email: (t.email || t['contact:email'] || '').split(';')[0].trim().toLowerCase() || null,
    sito, dominio: sito ? dominioDi(sito) : null, piva: pivaValida(piva) ? piva : null, operatore: t.operator || t.brand || null,
    tags: { ...Object.fromEntries(Object.entries(t).filter(([k]) => /^(amenity|healthcare|healthcare:speciality|social_facility|social_facility:for|office|industrial|craft|operator|operator:type|brand|beds|capacity|opening_hours|emergency|dispensing)$/.test(k))), pubblico },
  };
}
/** Interroga Overpass per una provincia: { candidati, servizio }. Prova i servizi pubblici in ordine; errori in chiaro. */
export async function scopriProvincia(provincia, categorie, { fetchFn = fetch, timeoutMs = 65_000 } = {}) {
  if (!PROVINCE[provincia]) throw new Error(`Provincia non prevista: ${provincia}`);
  const cat = categorie.filter((c) => FILTRI[c] && CATEGORIE[c]);
  if (!cat.length) throw new Error('Nessuna tipologia valida');
  const query = costruisciQuery(provincia, cat);
  const errori = [];
  const nome = (u) => { try { return new URL(u).hostname; } catch { return u; } };
  for (const url of SERVIZI()) {
    try {
      const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { errori.push(`${nome(url)}: risposta ${r.status}${r.status === 429 ? ' (troppe richieste)' : r.status === 504 ? ' (servizio occupato)' : ''}`); continue; }
      let j; try { j = await r.json(); } catch { errori.push(`${nome(url)}: risposta non leggibile`); continue; }
      // il servizio risponde 200 anche quando la ricerca scade o finisce la memoria: lo dice nel campo remark
      if (j.remark && /error|timed out|out of memory/i.test(String(j.remark)) && !(j.elements || []).length) { errori.push(`${nome(url)}: ${String(j.remark).slice(0, 120)}`); continue; }
      const visti = new Set(); const candidati = [];
      for (const el of j.elements || []) { const c = candidatoDaOsm(el, provincia, cat); if (c && !visti.has(c.fonte_ref)) { visti.add(c.fonte_ref); candidati.push(c); } }
      return { candidati, servizio: url, elementi: (j.elements || []).length };
    } catch (e) { errori.push(`${nome(url)}: ${e.name === 'TimeoutError' || e.name === 'AbortError' ? 'nessuna risposta in tempo' : (e.cause?.code || e.message)}`); }
  }
  throw new Error(`OpenStreetMap non ha risposto per ${PROVINCE[provincia]} (${errori.join('; ')})`);
}
