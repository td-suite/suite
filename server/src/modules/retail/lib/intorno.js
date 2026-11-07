// Intorno: cosa c'è intorno a ogni sede (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md).
// Google Places API (New) lato server con la chiave GOOGLE_MAPS_SERVER_KEY (mai al browser, mai nei log): per ogni sottocategoria TD
// una chiamata searchNearby (tipi della Table A) o searchText (query in italiano con locationBias circolare) entro il raggio della
// sede (3 km, 10 km per le sedi extraurbane). Ogni chiamata passa dal contatore giornaliero (tetto in Impostazioni): oltre il tetto
// la rilevazione si ferma con un errore chiaro. I risultati si normalizzano, si deduplicano tra sottocategorie, si confrontano con
// la rilevazione precedente dello stesso punto (nuovi, scomparsi, cambiati) e producono un punteggio di attrattività dichiarato con
// le sue componenti. INTORNO_MOCK=1 (mai in produzione) sostituisce Google con risposte finte dichiarate di prova.
//
// La prima parte del file è fatta di funzioni pure (testabili senza rete né database), la seconda legge e scrive lo schema retail.
import { one, many, q, tx } from '../db.js';
import { HttpError, todayRome } from './util.js';
import { chiaveServer, chiaveBrowser, mascheraChiave, senzaChiave, normalizzaGeocodifica, GEOCODING_URL } from '../../../lib/googleMaps.js';

export const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
export const TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
export const TIMEOUT_MS = 10_000;
export const MAX_RISULTATI = 20;           // limite di Google per chiamata
export const PAGINE_MAX_TESTO = 2;          // searchText: al massimo una pagina in più (nextPageToken) e solo se serve
export const CERCHI_M = [500, 1000, 3000];  // cerchi disegnati sulla mappa
export const ENTRO_M = 1000;                // raggio del punteggio e dei numeri di sintesi
export const PREDEFINITI = { tetto_giornaliero: 300, raggio_urbano: 3000, raggio_extraurbano: 10000 };
const RAGGIO_MAX = 50_000;                  // limite di Google per il cerchio

// Campi richiesti a Google (X-Goog-FieldMask): solo questi vengono restituiti (e fatturati)
export const CAMPI = ['id', 'displayName', 'formattedAddress', 'location', 'types', 'primaryType', 'rating', 'userRatingCount',
  'regularOpeningHours', 'websiteUri', 'nationalPhoneNumber', 'businessStatus'];
export const FIELD_MASK = CAMPI.map((c) => `places.${c}`).join(',');

export const CATEGORIE = {
  CONCORRENTE: { etichetta: 'Concorrenti diretti', breve: 'Concorrenti', colore: '#b3372f' },
  PRESCRITTORE: { etichetta: 'Prescrittori', breve: 'Prescrittori', colore: '#1C505E' },
  ATTRATTORE: { etichetta: 'Attrattori', breve: 'Attrattori', colore: '#8a5aa8' },
  CONTESTO: { etichetta: 'Contesto', breve: 'Contesto', colore: '#e0b84a' },
};

// Sottocategorie TD → chiamate a Google. "nearby" = searchNearby con includedTypes (Table A dei tipi della nuova API);
// "testo" = searchText con la query in italiano. "riserva" = query usata se Google rifiuta i tipi (tipo non supportato).
// L'ordine conta: un luogo trovato da più sottocategorie resta in quella il cui elenco di tipi contiene il suo tipo principale,
// altrimenti nella prima in quest'ordine (i concorrenti prima di tutto).
export const SOTTOCATEGORIE = [
  { chiave: 'laboratorio', categoria: 'CONCORRENTE', etichetta: 'Laboratorio di analisi', tipi: ['medical_lab'],
    fonti: [{ tipo: 'nearby', includedTypes: ['medical_lab'] }, { tipo: 'testo', query: 'laboratorio analisi cliniche' }] },
  { chiave: 'centro_diagnostico', categoria: 'CONCORRENTE', etichetta: 'Centro diagnostico', tipi: [], fonti: [{ tipo: 'testo', query: 'centro diagnostico' }] },
  { chiave: 'radiologia', categoria: 'CONCORRENTE', etichetta: 'Radiologia', tipi: [], fonti: [{ tipo: 'testo', query: 'radiologia' }] },
  { chiave: 'poliambulatorio', categoria: 'CONCORRENTE', etichetta: 'Poliambulatorio', tipi: [], fonti: [{ tipo: 'testo', query: 'poliambulatorio' }] },
  { chiave: 'medico', categoria: 'PRESCRITTORE', etichetta: 'Medico / studio medico', tipi: ['doctor'], fonti: [{ tipo: 'nearby', includedTypes: ['doctor'], riserva: 'studio medico' }] },
  { chiave: 'farmacia', categoria: 'ATTRATTORE', etichetta: 'Farmacia', tipi: ['pharmacy', 'drugstore'], fonti: [{ tipo: 'nearby', includedTypes: ['pharmacy', 'drugstore'], riserva: 'farmacia' }] },
  { chiave: 'rsa', categoria: 'ATTRATTORE', etichetta: 'RSA', tipi: [], fonti: [{ tipo: 'testo', query: 'RSA residenza sanitaria assistenziale' }] },
  { chiave: 'casa_di_cura', categoria: 'ATTRATTORE', etichetta: 'Casa di cura', tipi: [], fonti: [{ tipo: 'testo', query: 'casa di cura' }] },
  { chiave: 'ospedale', categoria: 'ATTRATTORE', etichetta: 'Ospedale', tipi: ['hospital'], fonti: [{ tipo: 'nearby', includedTypes: ['hospital'], riserva: 'ospedale' }] },
  { chiave: 'asl', categoria: 'ATTRATTORE', etichetta: 'ASL / distretto sanitario', tipi: [], fonti: [{ tipo: 'testo', query: 'ASL distretto sanitario' }] },
  { chiave: 'supermercato', categoria: 'CONTESTO', etichetta: 'Supermercato', tipi: ['supermarket', 'grocery_store'], fonti: [{ tipo: 'nearby', includedTypes: ['supermarket', 'grocery_store'], riserva: 'supermercato' }] },
  { chiave: 'posta', categoria: 'CONTESTO', etichetta: 'Ufficio postale', tipi: ['post_office'], fonti: [{ tipo: 'nearby', includedTypes: ['post_office'], riserva: 'ufficio postale' }] },
  { chiave: 'banca', categoria: 'CONTESTO', etichetta: 'Banca', tipi: ['bank'], fonti: [{ tipo: 'nearby', includedTypes: ['bank'], riserva: 'banca' }] },
  { chiave: 'scuola', categoria: 'CONTESTO', etichetta: 'Scuola', tipi: ['school', 'primary_school', 'secondary_school'], fonti: [{ tipo: 'nearby', includedTypes: ['school', 'primary_school', 'secondary_school'], riserva: 'scuola' }] },
  { chiave: 'parcheggio', categoria: 'CONTESTO', etichetta: 'Parcheggio', tipi: ['parking'], fonti: [{ tipo: 'nearby', includedTypes: ['parking'], riserva: 'parcheggio' }] },
  { chiave: 'fermata', categoria: 'CONTESTO', etichetta: 'Fermata bus / tram / treno', tipi: ['bus_station', 'bus_stop', 'transit_station', 'train_station', 'light_rail_station'],
    fonti: [{ tipo: 'nearby', includedTypes: ['bus_station', 'bus_stop', 'transit_station', 'train_station', 'light_rail_station'], riserva: 'fermata autobus tramvia stazione' }] },
];
export const SOTTO = Object.fromEntries(SOTTOCATEGORIE.map((s) => [s.chiave, s]));

// Punteggio di attrattività: pesi dichiarati, conteggi entro 1 km dei soli luoghi aperti (non chiusi né scomparsi).
// Il contesto vale mezzo punto a luogo ma al massimo 10 punti (20 luoghi), perché in centro città fermate e parcheggi sono decine.
export const PESI = {
  PRESCRITTORE: { peso: 2, etichetta: 'Prescrittori entro 1 km' },
  ATTRATTORE: { peso: 1, etichetta: 'Attrattori entro 1 km' },
  CONTESTO: { peso: 0.5, massimo: 10, etichetta: 'Contesto entro 1 km' },
  CONCORRENTE: { peso: -3, etichetta: 'Concorrenti entro 1 km' },
};
export const FORMULA = 'Attrattività = 2 × prescrittori + 1 × attrattori + 0,5 × contesto (max 10 punti) − 3 × concorrenti, contando i luoghi aperti entro 1 km';

// ---------------------------------------------------------------------------------------------------------------------------
// Funzioni pure
// ---------------------------------------------------------------------------------------------------------------------------

/** Distanza in metri tra due punti {lat,lng} (formula dell'emisenoverso, raggio terrestre medio 6.371 km), arrotondata al metro */
export function distanzaM(a, b) {
  const R = 6_371_000; const rad = (x) => (Number(x) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Corpo della richiesta a Google per una fonte di una sottocategoria */
export function corpoRichiesta(fonte, centro, raggio, pageToken = null) {
  const center = { latitude: Number(centro.lat), longitude: Number(centro.lng) };
  const radius = Math.min(RAGGIO_MAX, Math.max(1, Number(raggio)));
  if (fonte.tipo === 'nearby') {
    return { includedTypes: fonte.includedTypes, maxResultCount: MAX_RISULTATI, rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center, radius } }, languageCode: 'it', regionCode: 'IT' };
  }
  return { textQuery: fonte.query, pageSize: MAX_RISULTATI, rankPreference: 'DISTANCE', locationBias: { circle: { center, radius } },
    languageCode: 'it', regionCode: 'IT', ...(pageToken ? { pageToken } : {}) };
}

const testo = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s || null; };
const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Un luogo della risposta di Places API (New) → riga normalizzata, oppure null se manca l'id o la posizione.
 * { place_id, nome, indirizzo, lat, lng, distanza_m, tipi[], tipo_principale, rating, n_recensioni, orari, sito, telefono, stato_attivita }
 */
export function normalizzaLuogo(p, centro) {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const lat = numero(p.location?.latitude); const lng = numero(p.location?.longitude);
  if (lat == null || lng == null) return null;
  const oh = p.regularOpeningHours;
  const orari = oh && (Array.isArray(oh.weekdayDescriptions) || Array.isArray(oh.periods))
    ? { weekdayDescriptions: (oh.weekdayDescriptions || []).map(String), periods: oh.periods || [] } : null;
  const rating = numero(p.rating);
  return {
    place_id: String(p.id),
    nome: testo(p.displayName?.text ?? p.displayName) || 'Senza nome',
    indirizzo: testo(p.formattedAddress),
    lat, lng,
    distanza_m: centro ? distanzaM(centro, { lat, lng }) : null,
    tipi: Array.isArray(p.types) ? p.types.map(String) : [],
    tipo_principale: testo(p.primaryType),
    rating: rating == null ? null : Math.round(rating * 10) / 10,
    n_recensioni: numero(p.userRatingCount) == null ? null : Math.round(Number(p.userRatingCount)),
    orari,
    sito: testo(p.websiteUri),
    telefono: testo(p.nationalPhoneNumber),
    stato_attivita: testo(p.businessStatus),
  };
}

/** Risposta di una chiamata → luoghi normalizzati entro il raggio (searchText con locationBias può restituire luoghi più lontani) */
export function normalizzaRisposta(json, { centro, raggio }) {
  const out = [];
  for (const p of json?.places || []) {
    const l = normalizzaLuogo(p, centro);
    if (l && (raggio == null || l.distanza_m <= raggio)) out.push(l);
  }
  return out;
}

/**
 * Unisce i risultati delle sottocategorie: un luogo una volta sola. Resta nella sottocategoria i cui tipi contengono il suo tipo
 * principale (una farmacia trovata anche cercando "laboratorio analisi" resta farmacia), altrimenti nella prima nell'ordine di
 * SOTTOCATEGORIE. Ritorna i luoghi ordinati per distanza, con categoria e sottocategoria.
 * @param {Record<string, object[]>} perSottocategoria chiave → luoghi normalizzati
 */
export function unisciRisultati(perSottocategoria) {
  const ordine = SOTTOCATEGORIE.map((s) => s.chiave);
  const scelto = new Map();
  for (const chiave of ordine) {
    for (const l of perSottocategoria[chiave] || []) {
      const cur = scelto.get(l.place_id);
      const sc = SOTTO[chiave];
      if (!cur) { scelto.set(l.place_id, { ...l, categoria: sc.categoria, sottocategoria: chiave }); continue; }
      const curTipoGiusto = SOTTO[cur.sottocategoria].tipi.includes(cur.tipo_principale);
      const nuovoTipoGiusto = sc.tipi.includes(l.tipo_principale);
      if (!curTipoGiusto && nuovoTipoGiusto) scelto.set(l.place_id, { ...l, categoria: sc.categoria, sottocategoria: chiave });
    }
  }
  return [...scelto.values()].sort((a, b) => (a.distanza_m ?? 0) - (b.distanza_m ?? 0) || a.nome.localeCompare(b.nome, 'it'));
}

const CAMPI_CONFRONTO = [['nome', 'nome'], ['indirizzo', 'indirizzo'], ['stato_attivita', 'stato dell\'attività'], ['telefono', 'telefono'], ['sito', 'sito']];
export const aperto = (l) => l.presente !== false && !['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'].includes(l.stato_attivita);

/**
 * Confronto con la rilevazione precedente dello stesso punto.
 * Considera solo le sottocategorie lette senza errori in entrambe e, per gli scomparsi, i luoghi precedenti entro il raggio attuale
 * (se il raggio si è ristretto, i luoghi più lontani non sono "scomparsi"). Senza rilevazione precedente non c'è nessuna novità.
 * @returns {{ nuovi: Set<string>, scomparsi: object[], cambiati: Map<string, {campo, etichetta, prima, dopo}[]>, riepilogo }}
 */
export function confronta(precedenti, attuali, { raggio, sottocategorieAttuali, sottocategoriePrecedenti }) {
  const vuoto = { nuovi: new Set(), scomparsi: [], cambiati: new Map(), riepilogo: { nuovi: 0, scomparsi: 0, cambiati: 0, confrontabile: false } };
  if (!precedenti) return vuoto;
  const comuni = new Set((sottocategorieAttuali || []).filter((s) => (sottocategoriePrecedenti || []).includes(s)));
  const prec = precedenti.filter((l) => l.presente !== false);
  const precPerId = new Map(prec.map((l) => [l.place_id, l]));
  const attPerId = new Map(attuali.map((l) => [l.place_id, l]));
  const nuovi = new Set(attuali.filter((l) => comuni.has(l.sottocategoria) && !precPerId.has(l.place_id)).map((l) => l.place_id));
  const scomparsi = prec.filter((l) => comuni.has(l.sottocategoria) && !attPerId.has(l.place_id) && (l.distanza_m == null || l.distanza_m <= raggio));
  const cambiati = new Map();
  for (const a of attuali) {
    const p = precPerId.get(a.place_id);
    if (!p) continue;
    const diff = CAMPI_CONFRONTO.filter(([k]) => (p[k] ?? null) !== (a[k] ?? null)).map(([k, etichetta]) => ({ campo: k, etichetta, prima: p[k] ?? null, dopo: a[k] ?? null }));
    if (diff.length) cambiati.set(a.place_id, diff);
  }
  return { nuovi, scomparsi, cambiati, riepilogo: { nuovi: nuovi.size, scomparsi: scomparsi.length, cambiati: cambiati.size, confrontabile: true } };
}

/** Contatori per categoria e sottocategoria (solo luoghi aperti): entro 500 m, entro 1 km, entro il raggio della rilevazione */
export function sintesi(luoghi) {
  const vuota = () => ({ entro_500: 0, entro_1000: 0, totale: 0 });
  const categorie = Object.fromEntries(Object.keys(CATEGORIE).map((k) => [k, vuota()]));
  const sottocategorie = Object.fromEntries(SOTTOCATEGORIE.map((s) => [s.chiave, vuota()]));
  let chiusi = 0;
  for (const l of luoghi) {
    if (l.presente === false) continue;
    if (!aperto(l)) { chiusi += 1; continue; }
    for (const c of [categorie[l.categoria], sottocategorie[l.sottocategoria]]) {
      if (!c) continue;
      c.totale += 1;
      if (l.distanza_m != null && l.distanza_m <= 500) c.entro_500 += 1;
      if (l.distanza_m != null && l.distanza_m <= ENTRO_M) c.entro_1000 += 1;
    }
  }
  return { categorie, sottocategorie, chiusi, luoghi: luoghi.filter((l) => l.presente !== false).length };
}

/** Punteggio di attrattività con le componenti (lo si mostra sempre con le componenti, mai il numero da solo) */
export function punteggio(luoghi) {
  const n = Object.fromEntries(Object.keys(PESI).map((k) => [k, 0]));
  for (const l of luoghi) if (aperto(l) && l.distanza_m != null && l.distanza_m <= ENTRO_M && n[l.categoria] != null) n[l.categoria] += 1;
  const componenti = Object.entries(PESI).map(([categoria, p]) => {
    let punti = n[categoria] * p.peso;
    const limitato = p.massimo != null && punti > p.massimo;
    if (limitato) punti = p.massimo;
    return { categoria, etichetta: p.etichetta, n: n[categoria], peso: p.peso, massimo: p.massimo ?? null, limitato, punti: Math.round(punti * 10) / 10 };
  });
  const totale = Math.round(componenti.reduce((a, c) => a + c.punti, 0) * 10) / 10;
  return { totale, componenti, entro_m: ENTRO_M, formula: FORMULA };
}

/** Messaggio leggibile dell'errore di Google ({ error: { code, status, message } }) senza chiave */
export function erroreGoogle(status, json) {
  const e = json?.error;
  const dettaglio = e ? `${e.status || e.code || ''}${e.message ? `: ${e.message}` : ''}` : `HTTP ${status}`;
  return senzaChiave(`Google Places ${status}${dettaglio ? ` · ${dettaglio}` : ''}`).slice(0, 400);
}
// Google rifiuta un tipo non supportato con 400 INVALID_ARGUMENT che cita il tipo: si passa alla query testuale di riserva
const tipoNonSupportato = (status, json) => status === 400 && /type/i.test(String(json?.error?.message || ''));

export class TettoRaggiunto extends HttpError {
  constructor(tetto, usate) {
    super(429, `Tetto giornaliero di ${tetto} chiamate a Google raggiunto (oggi ne sono state fatte ${usate}). La rilevazione si è fermata: riprova domani o alza il tetto in Retail > Impostazioni > Intorno.`);
    this.code = 'INTORNO_TETTO';
  }
}

/**
 * Contatore in memoria con la stessa interfaccia di quello su database (per i test): prenota() → true se la chiamata rientra nel
 * tetto e la conta, false se il tetto è raggiunto (e non la conta).
 */
export function contatoreMemoria(tetto, giaUsate = 0) {
  let n = giaUsate;
  return { tetto, get usate() { return n; }, residuo: async () => Math.max(0, tetto - n), prenota: async () => { if (n >= tetto) return false; n += 1; return true; } };
}

/** Numero minimo di chiamate di una rilevazione (una per fonte), per il controllo prima di iniziare */
export const chiamateMinime = (sottocategorie) => sottocategorie.reduce((a, k) => a + (SOTTO[k]?.fonti.length || 0), 0);

/**
 * Esegue le chiamate a Google per le sottocategorie indicate. Nessun accesso al database: il contatore e fetch sono passati.
 * Errori per sottocategoria (la rilevazione prosegue con le altre); al tetto raggiunto si ferma tutto (interrotta).
 * @returns {Promise<{ luoghi, sottocategorie_ok, errori, n_chiamate, interrotta }>}
 */
export async function eseguiRicerca({ centro, raggio, sottocategorie, chiave, fetchFn = fetch, contatore, timeoutMs = TIMEOUT_MS, pagineMaxTesto = PAGINE_MAX_TESTO }) {
  const perSotto = {}; const errori = {}; const ok = [];
  let n = 0; let interrotta = null;
  const chiama = async (url, corpo) => {
    if (!(await contatore.prenota())) { const e = new TettoRaggiunto(contatore.tetto, await contatore.residuo().then((r) => contatore.tetto - r)); throw e; }
    n += 1;
    let res;
    try {
      res = await fetchFn(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': chiave, 'X-Goog-FieldMask': `${FIELD_MASK},nextPageToken` }, body: JSON.stringify(corpo) });
    } catch (e) { throw new Error(senzaChiave(e.name === 'TimeoutError' ? `Google Places: nessuna risposta in ${timeoutMs / 1000} s` : `Google Places non raggiungibile: ${e.message}`, chiave)); }
    let json = null;
    try { json = await res.json(); } catch { /* risposta non JSON */ }
    return { status: res.status, ok: res.ok, json };
  };
  for (const k of sottocategorie) {
    const sc = SOTTO[k];
    if (!sc) continue;
    const trovati = [];
    try {
      for (const fonte of sc.fonti) {
        if (fonte.tipo === 'nearby') {
          const r = await chiama(NEARBY_URL, corpoRichiesta(fonte, centro, raggio));
          if (r.ok) { trovati.push(...normalizzaRisposta(r.json, { centro, raggio })); continue; }
          if (!(fonte.riserva && tipoNonSupportato(r.status, r.json))) throw new Error(erroreGoogle(r.status, r.json));
          // tipo non supportato dalla nuova API: query testuale di riserva
          const t = await chiama(TEXT_URL, corpoRichiesta({ tipo: 'testo', query: fonte.riserva }, centro, raggio));
          if (!t.ok) throw new Error(erroreGoogle(t.status, t.json));
          trovati.push(...normalizzaRisposta(t.json, { centro, raggio }));
        } else {
          let token = null;
          for (let pagina = 1; pagina <= pagineMaxTesto; pagina++) {
            const r = await chiama(TEXT_URL, corpoRichiesta(fonte, centro, raggio, token));
            if (!r.ok) throw new Error(erroreGoogle(r.status, r.json));
            const luoghi = normalizzaRisposta(r.json, { centro, raggio });
            trovati.push(...luoghi);
            // pagina successiva solo se questa era piena e il più lontano dei risultati è ancora dentro il raggio
            const tutti = r.json?.places || [];
            token = r.json?.nextPageToken || null;
            if (!token || tutti.length < MAX_RISULTATI || luoghi.length < tutti.length) break;
          }
        }
      }
      perSotto[k] = trovati; ok.push(k);
    } catch (e) {
      if (e instanceof TettoRaggiunto) { interrotta = e.message; break; }
      errori[k] = senzaChiave(e.message, chiave);
    }
  }
  return { luoghi: unisciRisultati(perSotto), sottocategorie_ok: ok, errori, n_chiamate: n, interrotta };
}

/** Chiave dello storico di un indirizzo valutato: testo normalizzato, oppure coordinate a 4 decimali (circa 10 m) */
export function chiaveIndirizzo({ indirizzo, lat, lng }) {
  const t = String(indirizzo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (t) return `indirizzo:${t}`;
  return `coord:${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Risposte finte (INTORNO_MOCK=1, mai in produzione): una decina di luoghi per sottocategoria intorno al centro richiesto, tutti
// dichiarati di prova nel nome e nell'indirizzo, su domini .example. Dalla seconda rilevazione dello stesso punto (variante ≥ 1)
// manca una farmacia e ne compare una nuova, per provare il confronto.
// ---------------------------------------------------------------------------------------------------------------------------
export const mockAttivo = () => process.env.INTORNO_MOCK === '1' && process.env.NODE_ENV !== 'production';

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
function sottocategoriaDaCorpo(corpo) {
  for (const sc of SOTTOCATEGORIE) {
    for (const f of sc.fonti) {
      if (corpo.includedTypes && f.includedTypes && f.includedTypes.join() === corpo.includedTypes.join()) return sc;
      if (corpo.textQuery && (f.query === corpo.textQuery || f.riserva === corpo.textQuery)) return sc;
    }
  }
  return null;
}
function luogoProva(sc, i, centro) {
  const h = hash(sc.chiave);
  const angolo = (((h % 360) + i * 37) % 360) * (Math.PI / 180);
  const dist = 120 + ((i * 277 + h) % 2300);   // tra 120 m e circa 2,4 km
  const lat = centro.lat + (dist * Math.cos(angolo)) / 111_320;
  const lng = centro.lng + (dist * Math.sin(angolo)) / (111_320 * Math.cos((centro.lat * Math.PI) / 180));
  const giorni = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  return {
    id: `prova-${sc.chiave}-${i}`,
    displayName: { text: `${sc.etichetta} di prova ${i}`, languageCode: 'it' },
    formattedAddress: `Indirizzo di prova ${i} (dato di prova, non reale)`,
    location: { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 },
    types: [...(sc.tipi.length ? [sc.tipi[0]] : []), 'point_of_interest', 'establishment'],
    ...(sc.tipi.length ? { primaryType: sc.tipi[0] } : {}),
    rating: Math.min(5, 3 + ((i * 3) % 21) / 10),
    userRatingCount: i * 7,
    regularOpeningHours: { weekdayDescriptions: giorni.map((g, d) => `${g}: ${d === 6 ? 'Chiuso' : d === 5 ? '08:00–12:30' : '07:30–19:00'}`) },
    websiteUri: `https://luogo-di-prova.example/${sc.chiave}/${i}`,
    nationalPhoneNumber: `000 000 ${String(i).padStart(4, '0')}`,
    businessStatus: i === 10 ? 'CLOSED_TEMPORARILY' : 'OPERATIONAL',
  };
}
/** fetch finto per Places e Geocoding (la variante cambia i risultati per provare il confronto) */
export function creaMockFetch({ variante = 0 } = {}) {
  return async (url, init = {}) => {
    const risposta = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (String(url).startsWith(GEOCODING_URL)) {
      const indirizzo = new URL(url).searchParams.get('address') || '';
      // centro di Sesto Fiorentino con uno scarto per indirizzo (meno di 1 km), dichiarato di prova
      const h = hash(indirizzo);
      return risposta(200, { status: 'OK', results: [{ formatted_address: `${indirizzo} (geocodifica di prova)`, place_id: `prova-geo-${h}`, types: ['street_address'],
        geometry: { location: { lat: Math.round((43.8323 + ((h % 100) - 50) / 10000) * 1e6) / 1e6, lng: Math.round((11.1993 + (((h >> 7) % 100) - 50) / 10000) * 1e6) / 1e6 }, location_type: 'ROOFTOP' } }] });
    }
    const corpo = JSON.parse(init.body || '{}');
    const sc = sottocategoriaDaCorpo(corpo);
    if (!sc) return risposta(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Richiesta di prova non riconosciuta' } });
    const circ = corpo.locationRestriction?.circle || corpo.locationBias?.circle;
    const centro = { lat: circ.center.latitude, lng: circ.center.longitude };
    let indici = Array.from({ length: 10 }, (_, k) => k + 1);
    if (variante >= 1 && sc.chiave === 'farmacia') indici = [...indici.filter((i) => i !== 1), 11];
    const places = indici.map((i) => luogoProva(sc, i, centro))
      .map((p) => ({ p, d: distanzaM(centro, { lat: p.location.latitude, lng: p.location.longitude }) }))
      .filter((x) => x.d <= circ.radius).sort((a, b) => a.d - b.d).slice(0, MAX_RISULTATI).map((x) => x.p);
    return risposta(200, { places });
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Database: impostazioni, contatore, rilevazioni
// ---------------------------------------------------------------------------------------------------------------------------
const K = { tetto: 'retail.intorno.tetto_giornaliero', urbano: 'retail.intorno.raggio_urbano', extra: 'retail.intorno.raggio_extraurbano', sotto: 'retail.intorno.sottocategorie' };

export async function leggiImpostazioni() {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [Object.values(K)]);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const intero = (x, def) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Math.round(Number(x)) : def);
  const sotto = v[K.sotto] != null ? String(v[K.sotto]).split(',').map((s) => s.trim()).filter((s) => SOTTO[s]) : SOTTOCATEGORIE.map((s) => s.chiave);
  return {
    tetto_giornaliero: intero(v[K.tetto], PREDEFINITI.tetto_giornaliero),
    raggio_urbano: intero(v[K.urbano], PREDEFINITI.raggio_urbano),
    raggio_extraurbano: intero(v[K.extra], PREDEFINITI.raggio_extraurbano),
    sottocategorie: sotto,
  };
}

export async function salvaImpostazioni(b) {
  const set = async (k, val) => q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(val)]);
  if (b.tetto_giornaliero !== undefined) await set(K.tetto, b.tetto_giornaliero);
  if (b.raggio_urbano !== undefined) await set(K.urbano, b.raggio_urbano);
  if (b.raggio_extraurbano !== undefined) await set(K.extra, b.raggio_extraurbano);
  if (b.sottocategorie !== undefined) await set(K.sotto, b.sottocategorie.filter((s) => SOTTO[s]).join(','));
  return leggiImpostazioni();
}

/** Contatore su database: una riga per giorno (Europe/Rome); l'incremento è atomico e non supera il tetto */
export function contatoreDb(tetto) {
  return {
    tetto,
    residuo: async () => { const r = await one('SELECT n FROM intorno_chiamate WHERE giorno=$1', [todayRome()]); return Math.max(0, tetto - (r?.n || 0)); },
    prenota: async () => {
      const r = await one(`INSERT INTO intorno_chiamate (giorno, n) VALUES ($1, 1) ON CONFLICT (giorno) DO UPDATE SET n = intorno_chiamate.n + 1, aggiornato_at = now()
        WHERE intorno_chiamate.n < $2 RETURNING n`, [todayRome(), tetto]);
      if (r && r.n > tetto) { await q('UPDATE intorno_chiamate SET n = n - 1 WHERE giorno=$1', [todayRome()]); return false; }   // tetto 0
      return Boolean(r);
    },
  };
}

export async function statoContatore() {
  const oggi = todayRome();
  const r = await one(`SELECT coalesce((SELECT n FROM intorno_chiamate WHERE giorno=$1), 0)::int AS oggi,
    coalesce((SELECT sum(n) FROM intorno_chiamate WHERE date_trunc('month', giorno) = date_trunc('month', $1::date)), 0)::int AS mese`, [oggi]);
  const imp = await leggiImpostazioni();
  return { giorno: oggi, oggi: r.oggi, mese: r.mese, tetto_giornaliero: imp.tetto_giornaliero, residuo_oggi: Math.max(0, imp.tetto_giornaliero - r.oggi) };
}

/** Chiave server e fetch da usare: il mock se attivo, altrimenti Google con la chiave d'ambiente. Errore chiaro senza chiave. */
export function sorgente({ variante = 0 } = {}) {
  if (mockAttivo()) return { chiave: 'chiave-di-prova', fetchFn: creaMockFetch({ variante }), prova: true };
  const chiave = chiaveServer();
  if (!chiave) throw new HttpError(400, 'Chiave Google non configurata: imposta GOOGLE_MAPS_SERVER_KEY su Render (docs/RETAIL_INTORNO.md)');
  return { chiave, fetchFn: fetch, prova: false };
}

export function configPubblica(imp) {
  return {
    chiave_browser: mockAttivo() ? null : chiaveBrowser(),
    chiave_server: Boolean(chiaveServer()), mock: mockAttivo(),
    raggi: { urbano: imp.raggio_urbano, extraurbano: imp.raggio_extraurbano }, cerchi: CERCHI_M, entro_m: ENTRO_M,
    categorie: CATEGORIE,
    sottocategorie: SOTTOCATEGORIE.map((s) => ({ chiave: s.chiave, categoria: s.categoria, etichetta: s.etichetta, attiva: imp.sottocategorie.includes(s.chiave),
      fonti: s.fonti.map((f) => (f.tipo === 'nearby' ? `tipi ${f.includedTypes.join(', ')}` : `ricerca «${f.query}»`)) })),
    pesi: PESI, formula: FORMULA,
  };
}

/** Geocodifica di un indirizzo libero con il contatore (indirizzi valutati); null se non trovato */
export async function geocodifica(indirizzo) {
  const imp = await leggiImpostazioni();
  const src = sorgente();
  const cont = contatoreDb(imp.tetto_giornaliero);
  if (!(await cont.prenota())) throw new TettoRaggiunto(imp.tetto_giornaliero, imp.tetto_giornaliero - (await cont.residuo()));
  const u = new URL(GEOCODING_URL);
  u.searchParams.set('address', indirizzo); u.searchParams.set('region', 'it'); u.searchParams.set('language', 'it'); u.searchParams.set('key', src.chiave);
  let res;
  try { res = await src.fetchFn(u.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } }); }
  catch (e) { throw new HttpError(422, senzaChiave(`Geocoding non raggiungibile: ${e.message}`, src.chiave)); }
  let j = null; try { j = await res.json(); } catch { /* non JSON */ }
  try { const g = normalizzaGeocodifica(j); return g ? { ...g, prova: src.prova } : null; }
  catch (e) { throw new HttpError(422, senzaChiave(e.message, src.chiave)); }
}

const COLONNE_LUOGO = ['place_id', 'categoria', 'sottocategoria', 'nome', 'indirizzo', 'lat', 'lng', 'distanza_m', 'tipi', 'tipo_principale', 'rating', 'n_recensioni',
  'orari', 'sito', 'telefono', 'stato_attivita', 'presente', 'novita', 'cambiamenti', 'prima_vista', 'ultima_vista', 'chiuso_at'];

export async function ultimaCompletata(chiave, { prima = null } = {}) {
  return one(`SELECT * FROM intorno_rilevazioni WHERE chiave=$1 AND stato IN ('COMPLETATA','PARZIALE') ${prima ? 'AND id < $2' : ''} ORDER BY eseguita_at DESC, id DESC LIMIT 1`, prima ? [chiave, prima] : [chiave]);
}

/**
 * Rilevazione di un punto (sede o indirizzo). Controlla il tetto prima di iniziare (servono almeno le chiamate minime), esegue,
 * confronta con la precedente, salva luoghi e sintesi. Al tetto raggiunto a metà: rilevazione INTERROTTA (senza luoghi) e 429.
 */
export async function rileva({ siteId = null, chiave, etichetta, indirizzo = null, lat, lng, raggio, origine = 'MANUALE', userId = null, geocodifica: geo = null }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) throw new HttpError(400, 'Coordinate mancanti: geocodifica prima l\'indirizzo');
  const imp = await leggiImpostazioni();
  const sotto = imp.sottocategorie;
  if (!sotto.length) throw new HttpError(400, 'Nessuna categoria attiva: scegline almeno una in Retail > Impostazioni > Intorno');
  const precedente = await ultimaCompletata(chiave);
  const variante = mockAttivo() ? Number((await one(`SELECT count(*)::int AS n FROM intorno_rilevazioni WHERE chiave=$1 AND stato IN ('COMPLETATA','PARZIALE')`, [chiave])).n) : 0;
  const src = sorgente({ variante });
  const cont = contatoreDb(imp.tetto_giornaliero);
  const residuo = await cont.residuo();
  const minime = chiamateMinime(sotto);
  if (residuo < minime) throw new TettoRaggiunto(imp.tetto_giornaliero, imp.tetto_giornaliero - residuo);
  const oggi = todayRome();
  const centro = { lat: Number(lat), lng: Number(lng) };
  const ril = await one(`INSERT INTO intorno_rilevazioni (site_id, chiave, etichetta, indirizzo, lat, lng, raggio_m, data, categorie, stato, origine, prova, geocodifica, precedente_id, creata_da)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IN_CORSO',$10,$11,$12,$13,$14) RETURNING id`,
  [siteId, chiave, etichetta, indirizzo, centro.lat, centro.lng, raggio, oggi, sotto, origine, src.prova, geo ? JSON.stringify(geo) : null, precedente?.id || null, userId]);
  let esito;
  try { esito = await eseguiRicerca({ centro, raggio, sottocategorie: sotto, chiave: src.chiave, fetchFn: src.fetchFn, contatore: cont }); }
  catch (e) {
    await q(`UPDATE intorno_rilevazioni SET stato='ERRORE', errori=$2 WHERE id=$1`, [ril.id, JSON.stringify({ generale: senzaChiave(e.message) })]);
    throw e;
  }
  if (esito.interrotta) {
    await q(`UPDATE intorno_rilevazioni SET stato='INTERROTTA', n_chiamate=$2, errori=$3 WHERE id=$1`, [ril.id, esito.n_chiamate, JSON.stringify({ ...esito.errori, interruzione: esito.interrotta })]);
    const e = new HttpError(429, esito.interrotta); e.code = 'INTORNO_TETTO'; throw e;
  }
  if (!esito.sottocategorie_ok.length) {
    await q(`UPDATE intorno_rilevazioni SET stato='ERRORE', n_chiamate=$2, errori=$3 WHERE id=$1`, [ril.id, esito.n_chiamate, JSON.stringify(esito.errori)]);
    throw new HttpError(422, `Nessuna categoria letta da Google: ${Object.values(esito.errori)[0] || 'errore sconosciuto'}`);
  }
  // confronto con la precedente
  const precLuoghi = precedente ? await many(`SELECT * FROM intorno_luoghi WHERE rilevazione_id=$1`, [precedente.id]) : null;
  const conf = confronta(precLuoghi, esito.luoghi, { raggio, sottocategorieAttuali: esito.sottocategorie_ok, sottocategoriePrecedenti: precedente?.sottocategorie_ok || [] });
  const precPerId = new Map((precLuoghi || []).map((l) => [l.place_id, l]));
  const righe = esito.luoghi.map((l) => {
    const p = precPerId.get(l.place_id);
    const chiuso = l.stato_attivita === 'CLOSED_PERMANENTLY' ? (p?.chiuso_at || oggi) : null;
    return { ...l, presente: true, novita: conf.nuovi.has(l.place_id) ? 'NUOVO' : conf.cambiati.has(l.place_id) ? 'CAMBIATO' : null,
      cambiamenti: conf.cambiati.get(l.place_id) || null, prima_vista: p?.prima_vista || oggi, ultima_vista: oggi, chiuso_at: chiuso };
  });
  for (const s of conf.scomparsi) righe.push({ ...s, presente: false, novita: 'SCOMPARSO', cambiamenti: null, ultima_vista: s.ultima_vista, chiuso_at: oggi });
  const sin = sintesi(righe); const pun = punteggio(righe);
  const riepilogo = { ...conf.riepilogo, precedente_id: precedente?.id || null, precedente_data: precedente?.data || null };
  await tx(async (c) => {
    for (const l of righe) {
      await c.query(`INSERT INTO intorno_luoghi (rilevazione_id, ${COLONNE_LUOGO.join(', ')}) VALUES ($1, ${COLONNE_LUOGO.map((_, i) => `$${i + 2}`).join(', ')})`,
        [ril.id, ...COLONNE_LUOGO.map((k) => (['orari', 'cambiamenti'].includes(k) ? (l[k] ? JSON.stringify(l[k]) : null) : l[k] ?? null))]);
    }
    await c.query(`UPDATE intorno_rilevazioni SET stato=$2, sottocategorie_ok=$3, n_chiamate=$4, errori=$5, sintesi=$6, punteggio=$7, confronto=$8 WHERE id=$1`,
      [ril.id, Object.keys(esito.errori).length ? 'PARZIALE' : 'COMPLETATA', esito.sottocategorie_ok, esito.n_chiamate,
        Object.keys(esito.errori).length ? JSON.stringify(esito.errori) : null, JSON.stringify(sin), JSON.stringify(pun), JSON.stringify(riepilogo)]);
  });
  return dettaglio(ril.id);
}

export async function dettaglio(id) {
  const r = await one(`SELECT r.*, s.name AS site_name, s.code AS site_code, u.full_name AS creata_da_nome FROM intorno_rilevazioni r
    LEFT JOIN public.sites s ON s.id=r.site_id LEFT JOIN users u ON u.id=r.creata_da WHERE r.id=$1`, [id]);
  if (!r) return null;
  const luoghi = await many(`SELECT * FROM intorno_luoghi WHERE rilevazione_id=$1 ORDER BY presente DESC, distanza_m NULLS LAST, nome`, [id]);
  return { ...r, luoghi: luoghi.map((l) => ({ ...l, rating: l.rating == null ? null : Number(l.rating) })) };
}

export async function storico(chiave) {
  return many(`SELECT id, data, eseguita_at, stato, origine, prova, raggio_m, n_chiamate, (punteggio->>'totale')::numeric AS punteggio, confronto, errori,
      (SELECT count(*)::int FROM intorno_luoghi l WHERE l.rilevazione_id=r.id AND l.presente) AS n_luoghi
    FROM intorno_rilevazioni r WHERE chiave=$1 ORDER BY eseguita_at DESC, id DESC LIMIT 60`, [chiave]);
}

/** Sede del Retail con il raggio dell'Intorno (extraurbana → raggio extraurbano) */
export async function sedeIntorno(siteId) {
  const s = await one(`SELECT id, code, name, address, zip, city, province, lat, lng, active, extraurbana FROM public.sites WHERE id=$1`, [siteId]);
  if (!s) return null;
  const imp = await leggiImpostazioni();
  return { ...s, raggio_m: s.extraurbana ? imp.raggio_extraurbano : imp.raggio_urbano };
}

export async function rilevaSede(siteId, { origine = 'MANUALE', userId = null } = {}) {
  const s = await sedeIntorno(siteId);
  if (!s) throw new HttpError(404, 'Sede non trovata');
  if (s.lat == null || s.lng == null) throw new HttpError(400, 'La sede non ha coordinate: usa "Geocodifica" nella scheda Intorno o in Amministrazione > Sedi');
  const indirizzo = [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.province ? `(${s.province})` : null].filter(Boolean).join(', ');
  return rileva({ siteId: s.id, chiave: `sede:${s.id}`, etichetta: s.name, indirizzo, lat: s.lat, lng: s.lng, raggio: s.raggio_m, origine, userId });
}

/** Confronto tra le sedi attive del network: ultima rilevazione di ciascuna con contatori e punteggio */
export async function confrontoSedi() {
  return many(`SELECT s.id AS site_id, s.code, s.name, s.city, s.lat IS NOT NULL AND s.lng IS NOT NULL AS ha_coordinate, ps.extraurbana,
      r.id AS rilevazione_id, r.data, r.stato, r.raggio_m, r.prova, r.sintesi, r.punteggio, r.confronto
    FROM sites_v s JOIN public.sites ps ON ps.id=s.id
    LEFT JOIN LATERAL (SELECT * FROM intorno_rilevazioni x WHERE x.chiave = 'sede:' || s.id AND x.stato IN ('COMPLETATA','PARZIALE') ORDER BY x.eseguita_at DESC, x.id DESC LIMIT 1) r ON TRUE
    WHERE s.active AND s.in_network ORDER BY (r.punteggio->>'totale')::numeric DESC NULLS LAST, s.sort_order, s.name`);
}

/** Indirizzi valutati (senza sede): ultima rilevazione per indirizzo */
export async function valutazioni() {
  return many(`SELECT DISTINCT ON (chiave) id, chiave, etichetta, indirizzo, lat, lng, data, eseguita_at, raggio_m, prova, punteggio, sintesi, confronto,
      (SELECT count(*)::int FROM intorno_rilevazioni y WHERE y.chiave = x.chiave AND y.stato IN ('COMPLETATA','PARZIALE')) AS n_rilevazioni
    FROM intorno_rilevazioni x WHERE site_id IS NULL AND stato IN ('COMPLETATA','PARZIALE') ORDER BY chiave, eseguita_at DESC, id DESC`);
}

/**
 * Rilevazione mensile (job retail:intorno, ogni giorno): le sedi attive del network con coordinate e senza una rilevazione riuscita
 * nel mese corrente, dalla meno recente. Si ferma al tetto giornaliero: il giorno dopo riprende dalle restanti.
 */
export async function rilevazioneMensile() {
  const sedi = await many(`SELECT s.id, s.name, s.lat, s.lng,
      (SELECT max(eseguita_at) FROM intorno_rilevazioni r WHERE r.chiave='sede:' || s.id AND r.stato IN ('COMPLETATA','PARZIALE')) AS ultima,
      EXISTS (SELECT 1 FROM intorno_rilevazioni r WHERE r.chiave='sede:' || s.id AND r.stato IN ('COMPLETATA','PARZIALE')
              AND date_trunc('month', r.data) = date_trunc('month', $1::date)) AS fatta
    FROM sites_v s WHERE s.active AND s.in_network ORDER BY 4 NULLS FIRST, s.id`, [todayRome()]);
  const esito = { eseguite: [], gia_fatte: sedi.filter((s) => s.fatta).length, senza_coordinate: [], errori: [], fermata_dal_tetto: null, restanti: 0 };
  for (const [i, s] of sedi.entries()) {
    if (s.fatta) continue;
    if (s.lat == null || s.lng == null) { esito.senza_coordinate.push(s.name); continue; }
    try { const r = await rilevaSede(s.id, { origine: 'JOB' }); esito.eseguite.push({ sede: s.name, rilevazione_id: r.id, luoghi: r.luoghi.filter((l) => l.presente).length }); }
    catch (e) {
      if (e.code === 'INTORNO_TETTO') { esito.fermata_dal_tetto = e.message; esito.restanti = sedi.slice(i).filter((x) => !x.fatta && x.lat != null && x.lng != null).length; break; }
      esito.errori.push({ sede: s.name, errore: senzaChiave(e.message) });
    }
  }
  return esito;
}

/** Prova della chiave (solo Admin): una chiamata searchNearby di farmacie entro 500 m, con la risposta grezza e la chiave mascherata */
export async function provaChiave({ lat, lng }) {
  const imp = await leggiImpostazioni();
  const src = sorgente();
  const cont = contatoreDb(imp.tetto_giornaliero);
  if (!(await cont.prenota())) throw new TettoRaggiunto(imp.tetto_giornaliero, imp.tetto_giornaliero - (await cont.residuo()));
  const corpo = corpoRichiesta(SOTTO.farmacia.fonti[0], { lat, lng }, 500);
  const t0 = Date.now();
  let status = null; let grezza = null; let errore = null;
  try {
    const res = await src.fetchFn(NEARBY_URL, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': src.chiave, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(corpo) });
    status = res.status;
    try { grezza = await res.json(); } catch { grezza = null; }
  } catch (e) { errore = senzaChiave(e.message, src.chiave); }
  const testoGrezzo = senzaChiave(JSON.stringify(grezza, null, 2) ?? '', src.chiave);
  const ok = status >= 200 && status < 300;
  return {
    ok, prova: src.prova, chiave: src.prova ? 'di prova (INTORNO_MOCK=1)' : mascheraChiave(src.chiave), status, ms: Date.now() - t0,
    richiesta: { url: NEARBY_URL, field_mask: FIELD_MASK, corpo },
    luoghi: ok ? (grezza?.places || []).length : 0,
    errore: errore || (ok ? null : erroreGoogle(status, grezza)),
    risposta_grezza: testoGrezzo.length > 20000 ? `${testoGrezzo.slice(0, 20000)}\n… (troncata a 20.000 caratteri)` : testoGrezzo,
  };
}
