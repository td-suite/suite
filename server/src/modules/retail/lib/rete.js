// Sviluppo rete (richiesta del CEO del 17/11/2026, docs/RETAIL_SVILUPPO_RETE.md). Tre letture degli stessi dati:
//  1. Posizionamento: ogni sede TD accanto ai concorrenti rilevati intorno (rating, recensioni, sabato, nuovi e scomparsi, prezzi a mano);
//  2. Valutazione di un indirizzo: intorno, clienti B2B e prospect vicini, sede TD più vicina e stima di resa dalle sedi TD più simili;
//  3. Dove aprire: i comuni della Toscana in classifica per bacino, concorrenza, traino, spazio rispetto alla rete e presenza B2B.
// Nessun coefficiente inventato: la resa è l'intervallo osservato nelle sedi TD con l'intorno più simile, la classifica dei comuni è
// fatta di posizioni relative (percentili) con pesi dichiarati. Dove un dato manca lo si dice, non lo si stima.
// La prima parte è fatta di funzioni pure (testabili senza rete né database), la seconda legge e scrive lo schema retail.
import { readFileSync } from 'node:fs';
import { one, many, q } from '../db.js';
import { HttpError, todayRome } from './util.js';
import { senzaChiave } from '../../../lib/googleMaps.js';
import { aperto, distanzaM, rileva, geocodifica, leggiImpostazioni as impostazioniIntorno, MAX_RISULTATI, SOTTO, ENTRO_M } from './intorno.js';

// Scansione di un comune: solo le categorie che servono alla classifica (meno chiamate a Google di una rilevazione completa)
export const SCANSIONE = ['laboratorio', 'centro_diagnostico', 'poliambulatorio', 'medico', 'farmacia', 'centro_commerciale', 'supermercato'];
export const RAGGIO_COMUNE = 3000;
export const PREDEFINITI_RETE = { soglia_abitanti: 5000, comuni_per_notte: 12, giorni_ricontrollo: 180, scansione_attiva: true };
export const PESI_COMUNE = { bacino: 25, concorrenza: 25, traino: 15, spazio: 15, b2b: 20 };
export const FORMULA_COMUNI = 'Punteggio su 100 = bacino 25 (posizione per residenti) + concorrenza 25 (meno laboratori, centri diagnostici e poliambulatori ogni 10.000 residenti, entro 3 km dal centro) '
  + '+ traino 15 (medici, farmacie, centri commerciali e supermercati ogni 10.000 residenti) + spazio 15 (distanza dalla sede TD più vicina: zero sotto 3 km, pieno tra 8 e 30 km, ridotto oltre) '
  + '+ B2B 20 (clienti attivi, che contano doppio, e prospect del Business Hub nel comune). Le posizioni sono relative agli altri comuni in classifica.';

// ---------------------------------------------------------------------------------------------------------------------------
// Funzioni pure
// ---------------------------------------------------------------------------------------------------------------------------

export const normNome = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const eNostro = (l) => /\btoscana diagnostica\b/.test(normNome(l.nome));
const mediana = (v) => { const a = [...v].sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** La scheda Google della sede TD tra i luoghi rilevati: quella scelta a mano, altrimenti il luogo "Toscana Diagnostica" entro 150 m */
export function schedaTd(luoghi, { placeId = null } = {}) {
  if (placeId) return luoghi.find((l) => l.place_id === placeId) || null;
  return luoghi.filter((l) => l.presente !== false && l.distanza_m != null && l.distanza_m <= 150 && eNostro(l)).sort((a, b) => a.distanza_m - b.distanza_m)[0] || null;
}

/** Aperto il sabato secondo gli orari di Google: true, false, oppure null se gli orari non ci sono */
export function sabatoAperto(orari) {
  const righe = orari?.weekdayDescriptions;
  if (!Array.isArray(righe)) return null;
  const s = righe.find((x) => /^sabato/i.test(String(x)));
  return s == null ? null : !/chius/i.test(s);
}

/** Concorrenti veri: categoria concorrente, aperti, non la nostra scheda e nessun'altra sede Toscana Diagnostica */
export function concorrentiDi(luoghi, td) {
  return luoghi.filter((l) => l.categoria === 'CONCORRENTE' && aperto(l) && l.place_id !== td?.place_id && !eNostro(l));
}

/** Posizione di una sede rispetto ai concorrenti rilevati. Il posto in classifica considera solo chi ha almeno 10 recensioni. */
export function posizioneSede(luoghi, td, { raggio } = {}) {
  const conc = concorrentiDi(luoghi, td).sort((a, b) => (a.distanza_m ?? 1e9) - (b.distanza_m ?? 1e9));
  const entro = (m) => conc.filter((l) => l.distanza_m != null && l.distanza_m <= m).length;
  const votati = conc.filter((l) => l.rating != null && (l.n_recensioni || 0) >= 10);
  const ratingTd = td?.rating != null ? Number(td.rating) : null; const recTd = td?.n_recensioni ?? null;
  const posto = (valTd, campo) => (valTd == null ? null : 1 + votati.filter((l) => Number(l[campo]) > Number(valTd)).length);
  const conOrari = conc.filter((l) => sabatoAperto(l.orari) != null);
  const migliore = [...votati].sort((a, b) => Number(b.rating) - Number(a.rating) || (b.n_recensioni || 0) - (a.n_recensioni || 0))[0] || null;
  const piuRecensito = [...conc].sort((a, b) => (b.n_recensioni || 0) - (a.n_recensioni || 0))[0] || null;
  const scomparsi = luoghi.filter((l) => l.categoria === 'CONCORRENTE' && l.novita === 'SCOMPARSO');
  return {
    raggio_m: raggio ?? null,
    td: td ? { place_id: td.place_id, nome: td.nome, rating: ratingTd, n_recensioni: recTd, sabato: sabatoAperto(td.orari) } : null,
    concorrenti: { entro_500: entro(500), entro_1000: entro(1000), nel_raggio: conc.length, con_voto: votati.length },
    rating_medio: votati.length ? r1(votati.reduce((a, l) => a + Number(l.rating), 0) / votati.length) : null,
    recensioni_mediana: votati.length ? Math.round(mediana(votati.map((l) => l.n_recensioni || 0))) : null,
    posto_rating: ratingTd != null && (recTd || 0) >= 10 ? posto(ratingTd, 'rating') : null,
    posto_recensioni: recTd != null ? 1 + conc.filter((l) => (l.n_recensioni || 0) > recTd).length : null,
    su: votati.length + 1,
    sabato: { aperti: conOrari.filter((l) => sabatoAperto(l.orari)).length, con_orari: conOrari.length },
    migliore: migliore && { nome: migliore.nome, rating: Number(migliore.rating), n_recensioni: migliore.n_recensioni, distanza_m: migliore.distanza_m },
    piu_recensito: piuRecensito && piuRecensito.n_recensioni ? { nome: piuRecensito.nome, rating: piuRecensito.rating == null ? null : Number(piuRecensito.rating), n_recensioni: piuRecensito.n_recensioni, distanza_m: piuRecensito.distanza_m } : null,
    nuovi: conc.filter((l) => l.novita === 'NUOVO').map((l) => ({ nome: l.nome, distanza_m: l.distanza_m })),
    scomparsi: scomparsi.map((l) => ({ nome: l.nome, distanza_m: l.distanza_m })),
    elenco: conc.slice(0, 40).map((l) => ({ place_id: l.place_id, nome: l.nome, sottocategoria: l.sottocategoria, indirizzo: l.indirizzo, distanza_m: l.distanza_m, rating: l.rating == null ? null : Number(l.rating),
      n_recensioni: l.n_recensioni, sabato: sabatoAperto(l.orari), novita: l.novita || null, sito: l.sito || null })),
  };
}

/** Caratteristiche dell'intorno entro 1 km (luoghi aperti), senza la nostra scheda tra i concorrenti */
export function caratteristiche(luoghi, td = null) {
  const c = { concorrenti: 0, prescrittori: 0, attrattori: 0, contesto: 0 };
  const chiave = { CONCORRENTE: 'concorrenti', PRESCRITTORE: 'prescrittori', ATTRATTORE: 'attrattori', CONTESTO: 'contesto' };
  for (const l of luoghi) {
    if (!aperto(l) || l.distanza_m == null || l.distanza_m > ENTRO_M) continue;
    if (l.categoria === 'CONCORRENTE' && (l.place_id === td?.place_id || eNostro(l))) continue;
    if (chiave[l.categoria]) c[chiave[l.categoria]] += 1;
  }
  return c;
}

const ASSI = ['concorrenti', 'prescrittori', 'attrattori', 'contesto', 'bacino'];
/**
 * Le sedi TD con l'intorno più simile al punto valutato. Ogni asse è riportato alla stessa scala (scarto dalla media in deviazioni
 * standard delle sedi); bacino = log10 dei residenti del comune. Una sede senza un dato su un asse non è confrontata su quell'asse.
 */
export function sediSimili(punto, sedi, k = 3) {
  const val = (x, a) => (a === 'bacino' ? (x.popolazione > 0 ? Math.log10(x.popolazione) : null) : x.car?.[a] ?? null);
  const scala = {};
  for (const a of ASSI) {
    const v = sedi.map((s) => val(s, a)).filter((x) => x != null);
    const m = v.length ? v.reduce((p, x) => p + x, 0) / v.length : 0;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((p, x) => p + (x - m) ** 2, 0) / v.length) : 0;
    scala[a] = sd > 0 ? sd : null;
  }
  return sedi.map((s) => {
    let somma = 0; let n = 0;
    for (const a of ASSI) { const p = val(punto, a); const x = val(s, a); if (p == null || x == null || !scala[a]) continue; somma += ((p - x) / scala[a]) ** 2; n += 1; }
    return { ...s, scarto: n ? Math.round(Math.sqrt(somma / n) * 100) / 100 : null, assi: n };
  }).filter((s) => s.scarto != null).sort((a, b) => a.scarto - b.scarto).slice(0, k);
}

/** Stima di resa: intervallo e mediana delle medie mensili delle sedi simili. Con meno di 2 sedi non si stima. */
export function stimaResa(simili) {
  const ok = simili.filter((s) => s.mesi > 0);
  if (ok.length < 2) return null;
  const serie = (k) => { const v = ok.map((s) => s[k]); return { min: Math.round(Math.min(...v)), mediana: Math.round(mediana(v)), max: Math.round(Math.max(...v)) }; };
  return { sedi: ok.length, accettazioni_mese: serie('accettazioni_mese'), ricavi_mese: serie('ricavi_mese') };
}

/** Posizione relativa (0..1) di ogni valore nell'elenco: quota dei valori più bassi, i pari contano a metà */
export function percentili(valori) {
  const v = valori.filter((x) => x != null); const n = v.length;
  return valori.map((x) => (x == null || !n ? null : (v.filter((y) => y < x).length + 0.5 * (v.filter((y) => y === x).length - 1)) / Math.max(1, n - 1)));
}

/** Punti "spazio" dalla distanza (km) dalla sede TD più vicina */
export function puntiSpazio(km, max = PESI_COMUNE.spazio) {
  if (km == null) return null;
  if (km < 3) return 0;
  if (km < 8) return r1(max * ((km - 3) / 5));
  if (km <= 30) return max;
  if (km <= 60) return r1(max * (1 - 0.5 * ((km - 30) / 30)));
  return r1(max * 0.5);
}

/**
 * Classifica dei comuni. righe: { istat, popolazione, rilevato, concorrenti, traino, km_td, clienti, prospect }.
 * Un comune non rilevato ha solo bacino, spazio e B2B: punteggio parziale, dichiarato (su quanti punti è calcolato).
 */
export function classificaComuni(righe) {
  const per10k = (n, pop) => (n == null || !pop ? null : (n / pop) * 10000);
  const pBac = percentili(righe.map((r) => r.popolazione ?? null));
  const pCon = percentili(righe.map((r) => (r.rilevato ? per10k(r.concorrenti, r.popolazione) : null)));
  const pTra = percentili(righe.map((r) => (r.rilevato ? per10k(r.traino, r.popolazione) : null)));
  const b2b = righe.map((r) => 2 * (r.clienti || 0) + (r.prospect || 0));
  const pB2b = percentili(b2b.map((x) => (x > 0 ? x : null)));
  return righe.map((r, i) => {
    const c = {
      bacino: pBac[i] == null ? null : r1(PESI_COMUNE.bacino * pBac[i]),
      concorrenza: pCon[i] == null ? null : r1(PESI_COMUNE.concorrenza * (1 - pCon[i])),
      traino: pTra[i] == null ? null : r1(PESI_COMUNE.traino * pTra[i]),
      spazio: puntiSpazio(r.km_td),
      b2b: b2b[i] > 0 ? r1(PESI_COMUNE.b2b * (0.25 + 0.75 * (pB2b[i] ?? 0))) : 0,
    };
    const su = Object.entries(c).reduce((a, [k, v]) => a + (v == null ? 0 : PESI_COMUNE[k]), 0);
    const punti = r1(Object.values(c).reduce((a, v) => a + (v || 0), 0));
    return { ...r, componenti: c, punteggio: punti, su, completo: su === 100,
      concorrenti_10k: r.rilevato ? r1(per10k(r.concorrenti, r.popolazione)) : null, traino_10k: r.rilevato ? r1(per10k(r.traino, r.popolazione)) : null };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------------------------------------
const K = { soglia: 'retail.rete.soglia_abitanti', notte: 'retail.rete.comuni_per_notte', giorni: 'retail.rete.giorni_ricontrollo', attiva: 'retail.rete.scansione_attiva' };

export async function impostazioniRete() {
  const v = Object.fromEntries((await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [Object.values(K)])).map((r) => [r.key, r.value]));
  const n = (x, d, min, max) => { const y = Number(x); return x != null && x !== '' && Number.isFinite(y) && y >= min && y <= max ? Math.round(y) : d; };
  return { soglia_abitanti: n(v[K.soglia], PREDEFINITI_RETE.soglia_abitanti, 0, 500000), comuni_per_notte: n(v[K.notte], PREDEFINITI_RETE.comuni_per_notte, 0, 100),
    giorni_ricontrollo: n(v[K.giorni], PREDEFINITI_RETE.giorni_ricontrollo, 30, 1095), scansione_attiva: v[K.attiva] == null ? PREDEFINITI_RETE.scansione_attiva : v[K.attiva] === 'true' };
}
export async function salvaImpostazioniRete(b) {
  const set = (k, val) => q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(val)]);
  if (b.soglia_abitanti !== undefined) await set(K.soglia, b.soglia_abitanti);
  if (b.comuni_per_notte !== undefined) await set(K.notte, b.comuni_per_notte);
  if (b.giorni_ricontrollo !== undefined) await set(K.giorni, b.giorni_ricontrollo);
  if (b.scansione_attiva !== undefined) await set(K.attiva, b.scansione_attiva ? 'true' : 'false');
  return impostazioniRete();
}

/** Semina dei comuni della Toscana al primo uso (273 comuni: codice ISTAT, provincia, CAP, baricentro, residenti del censimento 2021) */
let seminati = false;
export async function seminaComuni() {
  if (seminati) return;
  if (!(await one('SELECT 1 AS x FROM rete_comuni LIMIT 1'))) {
    const righe = JSON.parse(readFileSync(new URL('../assets/comuni-toscana.json', import.meta.url), 'utf8'));
    for (const [istat, nome, provincia, cap, lat, lng, pop] of righe) {
      await q(`INSERT INTO rete_comuni (istat, nome, provincia, cap, lat, lng, popolazione, popolazione_anno) VALUES ($1,$2,$3,$4,$5,$6,$7,2021) ON CONFLICT (istat) DO NOTHING`, [istat, nome, provincia, cap, lat, lng, pop]);
    }
  }
  seminati = true;
}

const luoghiDi = (rilId) => many('SELECT * FROM intorno_luoghi WHERE rilevazione_id=$1', [rilId]);
const ultimaSede = (siteId) => one(`SELECT * FROM intorno_rilevazioni WHERE chiave=$1 AND stato IN ('COMPLETATA','PARZIALE') ORDER BY eseguita_at DESC, id DESC LIMIT 1`, [`sede:${siteId}`]);

/** Sedi attive del network con coordinate, ultima rilevazione e scheda Google scelta */
async function sediRete() {
  return many(`SELECT s.id, s.code, s.name, s.kind, s.city, s.province, s.lat::float8 AS lat, s.lng::float8 AS lng, g.place_id AS scheda_place_id
    FROM sites_v s LEFT JOIN rete_sedi_google g ON g.site_id = s.id WHERE s.active AND s.in_network ORDER BY s.sort_order, s.name`);
}

/** Medie mensili B2C per sede sugli ultimi 12 mesi chiusi (solo i mesi con vendite; mai i dati dimostrativi) */
async function venditeSedi() {
  const righe = await many(`SELECT site_id, count(*)::int AS mesi, avg(t)::float8 AS accettazioni_mese, avg(r)::float8 AS ricavi_mese FROM (
      SELECT site_id, date_trunc('month', sale_date) AS m, count(DISTINCT (source, external_ref)) AS t, sum(net_amount) AS r FROM sales
      WHERE site_id IS NOT NULL AND source <> 'DEMO' AND b2b_customer_id IS NULL
        AND sale_date >= date_trunc('month', $1::date) - interval '12 months' AND sale_date < date_trunc('month', $1::date)
      GROUP BY 1, 2) x GROUP BY site_id`, [todayRome()]);
  return new Map(righe.map((r) => [r.site_id, r]));
}

/** Clienti B2B attivi o contrattualizzati (Business Hub) con il comune della Legal entity e le coordinate delle loro sedi, se ci sono */
async function clientiB2B() {
  const righe = await many(`SELECT o.id, o.name, o.city, o.province, array_agg(DISTINCT v.linea) AS linee FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id
    WHERE o.active GROUP BY o.id, o.name, o.city, o.province`).catch(() => []);
  if (!righe.length) return [];
  const sedi = await many(`SELECT organization_id, lat::float8 AS lat, lng::float8 AS lng, city FROM public.sites WHERE organization_id = ANY($1::int[]) AND lat IS NOT NULL AND lng IS NOT NULL`, [righe.map((r) => r.id)]);
  return righe.map((r) => ({ ...r, punti: sedi.filter((s) => s.organization_id === r.id) }));
}

/** Prospect della Ricerca prospect del Business Hub (non scartati), se il modulo c'è */
async function prospectB2B() {
  if (!(await one(`SELECT to_regclass('business.scout_candidati') AS t`))?.t) return [];
  return many(`SELECT id, nome, categoria, linea, stato, punteggio, comune, provincia, lat::float8 AS lat, lon::float8 AS lng, organization_id FROM business.scout_candidati WHERE stato <> 'SCARTATO'`).catch(() => []);
}

const comunePerNome = (comuni, testo) => { const t = ` ${normNome(testo)} `; return comuni.filter((c) => t.includes(` ${normNome(c.nome)} `)).sort((a, b) => b.nome.length - a.nome.length)[0] || null; };
const comunePiuVicino = (comuni, p) => comuni.map((c) => ({ c, d: distanzaM(p, c) })).sort((a, b) => a.d - b.d)[0]?.c || null;

// ---------------------------------------------------------------- 1. Posizionamento
export async function posizionamento() {
  const sedi = await sediRete();
  const prezzi = await many(`SELECT p.*, u.full_name AS creato_da_nome FROM rete_prezzi p LEFT JOIN public.users u ON u.id = p.creato_da ORDER BY p.rilevato_il DESC, p.id DESC`);
  const out = [];
  for (const s of sedi) {
    const ril = await ultimaSede(s.id);
    const base = { site_id: s.id, code: s.code, name: s.name, city: s.city, kind: s.kind, ha_coordinate: s.lat != null && s.lng != null, prezzi: prezzi.filter((p) => p.site_id === s.id) };
    if (!ril) { out.push({ ...base, rilevazione: null }); continue; }
    const luoghi = await luoghiDi(ril.id);
    const td = schedaTd(luoghi, { placeId: s.scheda_place_id });
    // candidate a essere la nostra scheda: i luoghi entro 150 m (per sceglierla a mano se il nome non la rivela)
    const candidate = luoghi.filter((l) => l.presente !== false && l.distanza_m != null && l.distanza_m <= 150 && ['CONCORRENTE', 'PRESCRITTORE'].includes(l.categoria))
      .map((l) => ({ place_id: l.place_id, nome: l.nome, distanza_m: l.distanza_m }));
    out.push({ ...base, rilevazione: { id: ril.id, data: ril.data, stato: ril.stato, prova: ril.prova }, scheda_scelta: Boolean(s.scheda_place_id), candidate, ...posizioneSede(luoghi, td, { raggio: ril.raggio_m }) });
  }
  return out;
}

export async function impostaSchedaGoogle(siteId, placeId, userId) {
  if (!placeId) { await q('DELETE FROM rete_sedi_google WHERE site_id=$1', [siteId]); return null; }
  const ril = await ultimaSede(siteId);
  const l = ril ? await one('SELECT nome FROM intorno_luoghi WHERE rilevazione_id=$1 AND place_id=$2', [ril.id, placeId]) : null;
  if (!l) throw new HttpError(400, 'Il luogo scelto non è nell\'ultima rilevazione della sede');
  await q(`INSERT INTO rete_sedi_google (site_id, place_id, nome, impostata_da) VALUES ($1,$2,$3,$4)
    ON CONFLICT (site_id) DO UPDATE SET place_id=EXCLUDED.place_id, nome=EXCLUDED.nome, impostata_da=EXCLUDED.impostata_da, updated_at=now()`, [siteId, placeId, l.nome, userId]);
  return { place_id: placeId, nome: l.nome };
}

// ---------------------------------------------------------------- 2. Valutazione di un indirizzo: resa, B2B, rete
export async function valutazione(rilevazioneId) {
  await seminaComuni();
  const ril = await one('SELECT * FROM intorno_rilevazioni WHERE id=$1', [rilevazioneId]);
  if (!ril) throw new HttpError(404, 'Rilevazione non trovata');
  const punto = { lat: Number(ril.lat), lng: Number(ril.lng) };
  const comuni = await many('SELECT istat, nome, provincia, lat, lng, popolazione, popolazione_anno, coord_fonte FROM rete_comuni');
  const comune = comunePerNome(comuni, `${ril.etichetta || ''} ${ril.indirizzo || ''}`) || comunePiuVicino(comuni, punto);
  const luoghi = await luoghiDi(ril.id);
  const car = caratteristiche(luoghi);

  // le sedi TD: intorno, residenti del comune, medie mensili
  const sedi = await sediRete(); const vendite = await venditeSedi();
  const base = [];
  for (const s of sedi) {
    const r = await ultimaSede(s.id); if (!r) continue;
    const ll = await luoghiDi(r.id); const v = vendite.get(s.id);
    base.push({ site_id: s.id, name: s.name, kind: s.kind, city: s.city, car: caratteristiche(ll, schedaTd(ll, { placeId: s.scheda_place_id })),
      popolazione: comunePerNome(comuni, s.city || '')?.popolazione ?? null, mesi: v?.mesi || 0, accettazioni_mese: v?.accettazioni_mese ?? null, ricavi_mese: v?.ricavi_mese ?? null,
      km: s.lat != null && s.lng != null ? r1(distanzaM(punto, s) / 1000) : null });
  }
  const conVendite = base.filter((s) => s.mesi > 0);
  const punti = conVendite.filter((s) => s.kind === 'PUNTO_PRELIEVI');
  const soloPunti = punti.length >= 3;
  const simili = sediSimili({ car, popolazione: comune?.popolazione ?? null }, soloPunti ? punti : conVendite, 3);
  const resa = stimaResa(simili);

  // rete: sede TD più vicina
  const conCoord = sedi.filter((s) => s.lat != null && s.lng != null).map((s) => ({ site_id: s.id, name: s.name, kind: s.kind, km: r1(distanzaM(punto, s) / 1000) })).sort((a, b) => a.km - b.km);

  // B2B: entro il raggio se ci sono le coordinate, altrimenti nello stesso comune
  const nelComune = (citta) => comune && normNome(citta) === normNome(comune.nome);
  const clienti = (await clientiB2B()).map((c) => {
    const v = c.punti.map((p) => ({ p, d: distanzaM(punto, p) })).sort((a, b) => a.d - b.d)[0];
    const d = v?.d ?? null;
    return d != null && d <= ril.raggio_m ? { id: c.id, nome: c.name, linee: c.linee, distanza_m: d, citta: c.city, lat: v.p.lat, lng: v.p.lng } : d == null && nelComune(c.city) ? { id: c.id, nome: c.name, linee: c.linee, distanza_m: null, citta: c.city } : null;
  }).filter(Boolean).sort((a, b) => (a.distanza_m ?? 1e9) - (b.distanza_m ?? 1e9));
  const idClienti = new Set(clienti.map((c) => c.id));
  const prospect = (await prospectB2B()).filter((p) => !p.organization_id || !idClienti.has(p.organization_id)).map((p) => {
    const d = p.lat != null && p.lng != null ? distanzaM(punto, p) : null;
    return d != null ? (d <= ril.raggio_m ? { ...p, distanza_m: d } : null) : nelComune(p.comune) ? { ...p, distanza_m: null } : null;
  }).filter(Boolean).sort((a, b) => (a.distanza_m ?? 1e9) - (b.distanza_m ?? 1e9));

  return {
    rilevazione_id: ril.id, raggio_m: ril.raggio_m, caratteristiche: car,
    comune: comune && { istat: comune.istat, nome: comune.nome, provincia: comune.provincia, popolazione: comune.popolazione, popolazione_anno: comune.popolazione_anno },
    centri_commerciali: luoghi.filter((l) => l.sottocategoria === 'centro_commerciale' && aperto(l)).sort((a, b) => a.distanza_m - b.distanza_m).map((l) => ({ nome: l.nome, distanza_m: l.distanza_m })),
    centri_commerciali_rilevati: (ril.sottocategorie_ok || []).includes('centro_commerciale'),
    rete: { piu_vicina: conCoord[0] || null, entro_5_km: conCoord.filter((s) => s.km <= 5) },
    resa: { stima: resa, simili: simili.map((s) => ({ site_id: s.site_id, name: s.name, kind: s.kind, city: s.city, scarto: s.scarto, car: s.car, popolazione: s.popolazione, mesi: s.mesi,
      accettazioni_mese: Math.round(s.accettazioni_mese), ricavi_mese: Math.round(s.ricavi_mese), km: s.km })),
      base: { sedi_con_vendite: conVendite.length, sedi_rilevate: base.length, solo_punti_prelievo: soloPunti },
      nota: resa ? `Intervallo osservato nelle ${resa.sedi} sedi TD con l'intorno più simile (medie mensili B2C degli ultimi 12 mesi chiusi). Non è una previsione: una sede nuova parte più bassa e ci arriva con i mesi.`
        : 'Stima non calcolabile: servono almeno 2 sedi TD con l\'intorno rilevato e vendite negli ultimi 12 mesi.' },
    b2b: { clienti, prospect: prospect.slice(0, 200), prospect_totale: prospect.length },
  };
}

// ---------------------------------------------------------------- 3. Dove aprire
export async function doveAprire() {
  await seminaComuni();
  const imp = await impostazioniRete();
  const comuni = await many(`SELECT c.*, r.sintesi, r.stato AS ril_stato, r.prova AS ril_prova, r.data AS ril_data, r.sottocategorie_ok FROM rete_comuni c LEFT JOIN intorno_rilevazioni r ON r.id = c.rilevazione_id ORDER BY c.popolazione DESC NULLS LAST`);
  const sedi = (await sediRete()).filter((s) => s.lat != null && s.lng != null);
  const clienti = await clientiB2B(); const prospect = await prospectB2B();
  const idClienti = new Set(clienti.map((c) => c.id));
  const conta = (elenco, campo) => { const m = new Map(); for (const x of elenco) { const k = normNome(x[campo]); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
  const cPerComune = conta(clienti, 'city'); const pPerComune = conta(prospect.filter((p) => !p.organization_id || !idClienti.has(p.organization_id)), 'comune');
  const n = (sin, k) => sin?.sottocategorie?.[k]?.totale ?? sin?.sottocategorie?.[k]?.n ?? 0;
  const cittaSedi = new Set((await sediRete()).map((x) => normNome(x.city)).filter(Boolean));
  const righe = comuni.map((c) => {
    const vicina = sedi.map((s) => ({ name: s.name, km: distanzaM(c, s) / 1000 })).sort((a, b) => a.km - b.km)[0] || null;
    const ok = c.sottocategorie_ok || []; const sin = c.sintesi; const ril = Boolean(c.rilevazione_id && sin);
    const k = normNome(c.nome);
    const dett = ril ? Object.fromEntries(SCANSIONE.map((s) => [s, ok.includes(s) ? n(sin, s) : null])) : null;
    return { istat: c.istat, nome: c.nome, provincia: c.provincia, popolazione: c.popolazione, popolazione_anno: c.popolazione_anno, over65: c.over65, coord_fonte: c.coord_fonte, escluso: c.escluso, nota: c.nota, errore: c.errore,
      rilevato: ril, rilevato_il: c.ril_data || null, prova: c.ril_prova || false, rilevazione_id: c.rilevazione_id, dettaglio: dett,
      concorrenti: ril ? (dett.laboratorio || 0) + (dett.centro_diagnostico || 0) + (dett.poliambulatorio || 0) : null,
      traino: ril ? (dett.medico || 0) + (dett.farmacia || 0) + (dett.centro_commerciale || 0) + (dett.supermercato || 0) : null,
      // Google restituisce al massimo 20 luoghi per ricerca per tipo: a 20 il conteggio è un minimo, non il totale
      al_massimo: ril ? ['medico', 'farmacia', 'supermercato', 'centro_commerciale'].filter((s) => (dett[s] || 0) >= MAX_RISULTATI).map((s) => SOTTO[s].etichetta) : [],
      km_td: vicina ? r1(vicina.km) : null, sede_vicina: vicina?.name || null,
      // siamo già qui: una sede TD entro 3 km dal centro oppure con la città uguale al comune
      presente: Boolean((vicina && vicina.km < 3) || cittaSedi.has(k)),
      clienti: cPerComune.get(k) || 0, prospect: pPerComune.get(k) || 0 };
  });
  const inGara = righe.filter((r) => !r.escluso && (r.popolazione || 0) >= imp.soglia_abitanti);
  const classifica = classificaComuni(inGara).sort((a, b) => Number(b.completo) - Number(a.completo) || b.punteggio - a.punteggio);
  return { impostazioni: imp, formula: FORMULA_COMUNI, pesi: PESI_COMUNE, raggio_m: RAGGIO_COMUNE,
    comuni: classifica, esclusi: righe.filter((r) => r.escluso), sotto_soglia: righe.length - righe.filter((r) => (r.popolazione || 0) >= imp.soglia_abitanti).length,
    riepilogo: { totale: righe.length, in_classifica: classifica.length, rilevati: classifica.filter((r) => r.rilevato).length, sedi_td: sedi.length, clienti_b2b: clienti.length, prospect: prospect.length } };
}

/** Rileva un comune: alla prima volta cerca il centro abitato con la geocodifica (il baricentro può cadere in campagna o in mare) */
export async function rilevaComune(istat, { userId = null, origine = 'MANUALE' } = {}) {
  await seminaComuni();
  const c = await one('SELECT * FROM rete_comuni WHERE istat=$1', [istat]);
  if (!c) throw new HttpError(404, 'Comune non trovato');
  let { lat, lng } = c;
  try {
    if (c.coord_fonte === 'CENTROIDE') {
      const g = await geocodifica(`${c.nome}, ${c.provincia}, Toscana, Italia`);
      if (g && distanzaM(c, g) < 40_000) { lat = g.lat; lng = g.lng; await q(`UPDATE rete_comuni SET lat=$2, lng=$3, coord_fonte='GOOGLE', updated_at=now() WHERE istat=$1`, [istat, lat, lng]); }
    }
    const r = await rileva({ chiave: `comune:${istat}`, etichetta: `${c.nome} (${c.provincia})`, indirizzo: `Comune di ${c.nome}`, lat, lng, raggio: RAGGIO_COMUNE, origine, userId, sottocategorie: SCANSIONE });
    await q('UPDATE rete_comuni SET rilevazione_id=$2, rilevato_at=now(), errore=NULL, updated_at=now() WHERE istat=$1', [istat, r.id]);
    return { istat, nome: c.nome, rilevazione_id: r.id, luoghi: r.luoghi.filter((l) => l.presente).length, n_chiamate: r.n_chiamate, prova: r.prova };
  } catch (e) {
    if (e.code !== 'INTORNO_TETTO' && e.status !== 429) await q('UPDATE rete_comuni SET errore=$2, updated_at=now() WHERE istat=$1', [istat, senzaChiave(e.message).slice(0, 300)]);
    throw e;
  }
}

/** Scansione notturna: i comuni sopra soglia mai rilevati (dai più popolosi), poi quelli da ricontrollare. Si ferma al tetto di Google. */
export async function scansioneComuni({ limite = null } = {}) {
  await seminaComuni(); await impostazioniIntorno();
  const imp = await impostazioniRete();
  if (!imp.scansione_attiva && limite == null) return { saltata: 'scansione automatica spenta' };
  const lotto = limite ?? imp.comuni_per_notte;
  const righe = await many(`SELECT istat, nome FROM rete_comuni WHERE NOT escluso AND coalesce(popolazione,0) >= $1
      AND (rilevato_at IS NULL OR rilevato_at < now() - ($2 || ' days')::interval) ORDER BY (rilevato_at IS NULL) DESC, popolazione DESC NULLS LAST LIMIT $3`, [imp.soglia_abitanti, String(imp.giorni_ricontrollo), lotto]);
  const out = { rilevati: [], errori: [], fermata_dal_tetto: null };
  for (const c of righe) {
    try { const r = await rilevaComune(c.istat, { origine: 'JOB' }); out.rilevati.push({ comune: c.nome, luoghi: r.luoghi }); }
    catch (e) { if (e.code === 'INTORNO_TETTO' || e.status === 429) { out.fermata_dal_tetto = e.message; break; } out.errori.push({ comune: c.nome, errore: senzaChiave(e.message).slice(0, 200) }); }
  }
  out.restanti = (await one(`SELECT count(*)::int AS n FROM rete_comuni WHERE NOT escluso AND coalesce(popolazione,0) >= $1 AND rilevato_at IS NULL`, [imp.soglia_abitanti])).n;
  return out;
}
