// Retail > Intorno (richiesta del CEO del 07/11/2026): normalizzazione delle risposte di Google Places API (New) e della Geocoding
// API (risposte finte scritte a mano), distanza, unione tra sottocategorie, confronto tra rilevazioni, punteggio con le componenti,
// tetto giornaliero delle chiamate e maschera della chiave. Nessuna chiamata reale: fetch è sempre finto, le chiavi sono di prova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanzaM, normalizzaLuogo, normalizzaRisposta, unisciRisultati, confronta, punteggio, sintesi, eseguiRicerca, contatoreMemoria, corpoRichiesta,
  chiamateMinime, chiaveIndirizzo, creaMockFetch, SOTTO, SOTTOCATEGORIE, FIELD_MASK, NEARBY_URL, TEXT_URL,
} from '../src/modules/retail/lib/intorno.js';
import { normalizzaGeocodifica, mascheraChiave, senzaChiave } from '../src/lib/googleMaps.js';

const CENTRO = { lat: 43.8323, lng: 11.1993 };
const CHIAVE_FINTA = 'CHIAVE-FINTA-DI-TEST-1234567890';
// punto a una distanza nota a nord del centro (1° di latitudine ≈ 111.195 m con R = 6.371 km)
const aNord = (m) => ({ lat: CENTRO.lat + m / 111_195, lng: CENTRO.lng });
const luogoGoogle = (id, punto, extra = {}) => ({ id, displayName: { text: `Luogo ${id}`, languageCode: 'it' }, formattedAddress: `Via Finta ${id}, Comune di Prova`,
  location: { latitude: punto.lat, longitude: punto.lng }, ...extra });

test('distanza con l\'emisenoverso: zero, 1 km a nord, simmetria', () => {
  assert.equal(distanzaM(CENTRO, CENTRO), 0);
  assert.equal(distanzaM(CENTRO, aNord(1000)), 1000);
  const a = { lat: 43.7696, lng: 11.2558 }; const b = { lat: 43.8323, lng: 11.1993 };
  assert.equal(distanzaM(a, b), distanzaM(b, a));
  assert.ok(distanzaM(a, b) > 8000 && distanzaM(a, b) < 9000);
});

test('normalizzazione di un luogo: campi della field mask, rating a un decimale, orari, luoghi senza id o posizione scartati', () => {
  const l = normalizzaLuogo(luogoGoogle('p1', aNord(250), { types: ['pharmacy', 'health', 'point_of_interest'], primaryType: 'pharmacy', rating: 4.66, userRatingCount: 38,
    regularOpeningHours: { openNow: true, weekdayDescriptions: ['lunedì: 08:30–19:30', 'domenica: Chiuso'], periods: [{ open: { day: 1, hour: 8, minute: 30 } }] },
    websiteUri: 'https://farmacia.example/', nationalPhoneNumber: '055 000 0000', businessStatus: 'OPERATIONAL' }), CENTRO);
  assert.deepEqual(l, { place_id: 'p1', nome: 'Luogo p1', indirizzo: 'Via Finta p1, Comune di Prova', lat: aNord(250).lat, lng: CENTRO.lng, distanza_m: 250,
    tipi: ['pharmacy', 'health', 'point_of_interest'], tipo_principale: 'pharmacy', rating: 4.7, n_recensioni: 38,
    orari: { weekdayDescriptions: ['lunedì: 08:30–19:30', 'domenica: Chiuso'], periods: [{ open: { day: 1, hour: 8, minute: 30 } }] },
    sito: 'https://farmacia.example/', telefono: '055 000 0000', stato_attivita: 'OPERATIONAL' });
  const minimo = normalizzaLuogo({ id: 'p2', location: { latitude: CENTRO.lat, longitude: CENTRO.lng } }, CENTRO);
  assert.equal(minimo.nome, 'Senza nome'); assert.equal(minimo.rating, null); assert.equal(minimo.orari, null); assert.deepEqual(minimo.tipi, []);
  assert.equal(normalizzaLuogo({ displayName: { text: 'senza id' }, location: { latitude: 1, longitude: 1 } }, CENTRO), null);
  assert.equal(normalizzaLuogo({ id: 'p3' }, CENTRO), null);
  // risposta completa: i luoghi oltre il raggio (searchText con locationBias) restano fuori; risposta vuota = nessun luogo
  const r = normalizzaRisposta({ places: [luogoGoogle('a', aNord(900)), luogoGoogle('b', aNord(3500)), { id: 'c' }] }, { centro: CENTRO, raggio: 3000 });
  assert.deepEqual(r.map((x) => x.place_id), ['a']);
  assert.deepEqual(normalizzaRisposta({}, { centro: CENTRO, raggio: 3000 }), []);
});

test('corpo delle richieste: searchNearby con locationRestriction, searchText con locationBias, lingua e regione italiane', () => {
  const n = corpoRichiesta(SOTTO.farmacia.fonti[0], CENTRO, 3000);
  assert.deepEqual(n, { includedTypes: ['pharmacy', 'drugstore'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: CENTRO.lat, longitude: CENTRO.lng }, radius: 3000 } }, languageCode: 'it', regionCode: 'IT' });
  const t = corpoRichiesta(SOTTO.radiologia.fonti[0], CENTRO, 10000, 'tok');
  assert.equal(t.textQuery, 'radiologia'); assert.equal(t.pageSize, 20); assert.equal(t.locationBias.circle.radius, 10000); assert.equal(t.pageToken, 'tok');
  assert.match(FIELD_MASK, /^places\.id,places\.displayName,.*places\.businessStatus$/);
  assert.equal(chiamateMinime(['laboratorio', 'farmacia']), 3);
});

test('unione tra sottocategorie: un luogo una volta sola, nella sottocategoria del suo tipo principale', () => {
  const f = normalizzaLuogo(luogoGoogle('f', aNord(300), { primaryType: 'pharmacy' }), CENTRO);
  const lab = normalizzaLuogo(luogoGoogle('lab', aNord(100), { primaryType: 'medical_lab' }), CENTRO);
  const x = normalizzaLuogo(luogoGoogle('x', aNord(700)), CENTRO);
  const u = unisciRisultati({ laboratorio: [lab, f], farmacia: [f], radiologia: [x], poliambulatorio: [x] });
  assert.deepEqual(u.map((l) => [l.place_id, l.categoria, l.sottocategoria]), [['lab', 'CONCORRENTE', 'laboratorio'], ['f', 'ATTRATTORE', 'farmacia'], ['x', 'CONCORRENTE', 'radiologia']]);
});

const riga = (id, sottocategoria, distanza_m, extra = {}) => ({ place_id: id, sottocategoria, categoria: SOTTO[sottocategoria].categoria, nome: `Luogo ${id}`, indirizzo: 'Via Finta', distanza_m, stato_attivita: 'OPERATIONAL', presente: true, ...extra });

test('confronto tra rilevazioni: nuovi, scomparsi entro il raggio, cambiati; solo sulle sottocategorie lette in entrambe', () => {
  const prec = [riga('a', 'farmacia', 200), riga('b', 'farmacia', 900), riga('c', 'farmacia', 4000), riga('d', 'banca', 300), riga('e', 'medico', 100, { telefono: '1' }), riga('z', 'farmacia', 50, { presente: false })];
  const att = [riga('a', 'farmacia', 200), riga('n', 'farmacia', 400), riga('e', 'medico', 100, { telefono: '2', stato_attivita: 'CLOSED_PERMANENTLY' }), riga('m', 'scuola', 600)];
  const c = confronta(prec, att, { raggio: 3000, sottocategorieAttuali: ['farmacia', 'medico', 'scuola'], sottocategoriePrecedenti: ['farmacia', 'medico', 'banca'] });
  assert.deepEqual([...c.nuovi], ['n']);   // 'm' (scuola) non era letta prima: non è "nuovo"
  assert.deepEqual(c.scomparsi.map((l) => l.place_id), ['b']);   // 'c' oltre il raggio attuale, 'd' banca non letta ora, 'z' già scomparso
  assert.deepEqual(c.cambiati.get('e').map((x) => x.campo), ['stato_attivita', 'telefono']);
  assert.deepEqual(c.riepilogo, { nuovi: 1, scomparsi: 1, cambiati: 1, confrontabile: true });
  const primo = confronta(null, att, { raggio: 3000, sottocategorieAttuali: ['farmacia'], sottocategoriePrecedenti: [] });
  assert.equal(primo.riepilogo.confrontabile, false); assert.equal(primo.nuovi.size, 0);
});

test('punteggio di attrattività con le componenti dichiarate, contesto con il massimo di 10 punti, solo luoghi aperti entro 1 km', () => {
  const luoghi = [
    riga('m1', 'medico', 300), riga('m2', 'medico', 999), riga('m3', 'medico', 1001),
    riga('f1', 'farmacia', 500), riga('o1', 'ospedale', 800, { stato_attivita: 'CLOSED_PERMANENTLY' }),
    riga('l1', 'laboratorio', 700), riga('l2', 'laboratorio', 400, { presente: false }),
    ...Array.from({ length: 25 }, (_, i) => riga(`k${i}`, 'fermata', 100 + i)),
  ];
  const p = punteggio(luoghi);
  const per = Object.fromEntries(p.componenti.map((c) => [c.categoria, c]));
  assert.deepEqual([per.PRESCRITTORE.n, per.PRESCRITTORE.punti], [2, 4]);
  assert.deepEqual([per.ATTRATTORE.n, per.ATTRATTORE.punti], [1, 1]);
  assert.deepEqual([per.CONTESTO.n, per.CONTESTO.punti, per.CONTESTO.limitato], [25, 10, true]);
  assert.deepEqual([per.CONCORRENTE.n, per.CONCORRENTE.punti], [1, -3]);
  assert.equal(p.totale, 12);
  assert.equal(p.entro_m, 1000); assert.match(p.formula, /2 × prescrittori/);
  const s = sintesi(luoghi);
  assert.equal(s.categorie.PRESCRITTORE.entro_1000, 2); assert.equal(s.categorie.PRESCRITTORE.totale, 3); assert.equal(s.chiusi, 1); assert.equal(s.luoghi, luoghi.length - 1);
  assert.equal(s.sottocategorie.medico.entro_500, 1);
});

// fetch finto che registra le richieste: risponde per URL e corpo, senza rete
function fetchFinto(risposte) {
  const chiamate = [];
  const fn = async (url, init) => {
    const corpo = JSON.parse(init.body);
    chiamate.push({ url, corpo, headers: init.headers });
    const r = risposte(url, corpo, chiamate.length);
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fn, chiamate };
}

test('ricerca: header con chiave e field mask, riserva testuale per un tipo rifiutato, errori per sottocategoria senza la chiave', async () => {
  const { fn, chiamate } = fetchFinto((url, corpo) => {
    if (url === NEARBY_URL && corpo.includedTypes?.includes('pharmacy')) return { status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unsupported types: drugstore.' } } };
    if (url === TEXT_URL && corpo.textQuery === 'farmacia') return { status: 200, body: { places: [luogoGoogle('f1', aNord(200), { primaryType: 'pharmacy' })] } };
    if (url === NEARBY_URL && corpo.includedTypes?.includes('bank')) return { status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: `API key not valid ${CHIAVE_FINTA}` } } };
    return { status: 200, body: { places: [luogoGoogle(`x${corpo.includedTypes?.[0] || corpo.textQuery}`, aNord(800))] } };
  });
  const cont = contatoreMemoria(100);
  const out = await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: ['farmacia', 'banca', 'posta'], chiave: CHIAVE_FINTA, fetchFn: fn, contatore: cont });
  assert.equal(chiamate[0].headers['X-Goog-Api-Key'], CHIAVE_FINTA);
  assert.match(chiamate[0].headers['X-Goog-FieldMask'], /places\.id/);
  assert.equal(out.n_chiamate, 4); assert.equal(cont.usate, 4);
  assert.deepEqual(out.sottocategorie_ok, ['farmacia', 'posta']);
  assert.ok(out.errori.banca.includes('PERMISSION_DENIED'));
  assert.ok(!out.errori.banca.includes(CHIAVE_FINTA), 'la chiave non deve comparire negli errori');
  assert.deepEqual(out.luoghi.map((l) => l.place_id), ['f1', 'xpost_office']);
  assert.equal(out.interrotta, null);
});

test('searchText: pagina successiva solo se la prima è piena ed entro il raggio, al massimo due pagine', async () => {
  const venti = (base, m) => Array.from({ length: 20 }, (_, i) => luogoGoogle(`${base}${i}`, aNord(m + i)));
  const { fn, chiamate } = fetchFinto((url, corpo) => (corpo.pageToken ? { status: 200, body: { places: venti('p2-', 1500), nextPageToken: 'tok3' } } : { status: 200, body: { places: venti('p1-', 100), nextPageToken: 'tok2' } }));
  const out = await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: ['radiologia'], chiave: CHIAVE_FINTA, fetchFn: fn, contatore: contatoreMemoria(10) });
  assert.equal(chiamate.length, 2); assert.equal(chiamate[1].corpo.pageToken, 'tok2'); assert.equal(out.luoghi.length, 40);
  // prima pagina con risultati oltre il raggio: nessuna pagina in più
  const f2 = fetchFinto(() => ({ status: 200, body: { places: venti('q-', 2990), nextPageToken: 'tok' } }));
  await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: ['radiologia'], chiave: CHIAVE_FINTA, fetchFn: f2.fn, contatore: contatoreMemoria(10) });
  assert.equal(f2.chiamate.length, 1);
});

test('tetto giornaliero: al limite la ricerca si ferma senza superarlo e lo dice', async () => {
  const { fn, chiamate } = fetchFinto(() => ({ status: 200, body: { places: [] } }));
  const cont = contatoreMemoria(5, 3);   // tetto 5, già 3 chiamate oggi
  const out = await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: ['farmacia', 'banca', 'posta', 'scuola'], chiave: CHIAVE_FINTA, fetchFn: fn, contatore: cont });
  assert.equal(chiamate.length, 2); assert.equal(cont.usate, 5); assert.equal(out.n_chiamate, 2);
  assert.match(out.interrotta, /Tetto giornaliero di 5 chiamate a Google raggiunto/);
  assert.deepEqual(out.sottocategorie_ok, ['farmacia', 'banca']);
  const c0 = contatoreMemoria(0);
  assert.equal(await c0.prenota(), false); assert.equal(c0.usate, 0);
});

test('risposte di prova (INTORNO_MOCK): dichiarate di prova, la seconda rilevazione perde una farmacia e ne trova una nuova', async () => {
  const una = await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: SOTTOCATEGORIE.map((s) => s.chiave), chiave: 'x', fetchFn: creaMockFetch({ variante: 0 }), contatore: contatoreMemoria(1000) });
  const due = await eseguiRicerca({ centro: CENTRO, raggio: 3000, sottocategorie: SOTTOCATEGORIE.map((s) => s.chiave), chiave: 'x', fetchFn: creaMockFetch({ variante: 1 }), contatore: contatoreMemoria(1000) });
  assert.ok(una.luoghi.length >= 140 && una.luoghi.every((l) => /di prova/.test(l.nome) && /dato di prova/.test(l.indirizzo)));
  const c = confronta(una.luoghi, due.luoghi, { raggio: 3000, sottocategorieAttuali: due.sottocategorie_ok, sottocategoriePrecedenti: una.sottocategorie_ok });
  assert.deepEqual([...c.nuovi], ['prova-farmacia-11']); assert.deepEqual(c.scomparsi.map((l) => l.place_id), ['prova-farmacia-1']);
});

test('geocodifica: normalizzazione, precisione, errori di Google; chiave mascherata e tolta dai testi; chiave dello storico', () => {
  const g = normalizzaGeocodifica({ status: 'OK', results: [{ formatted_address: 'Via Finta 1, 50019 Comune di Prova FI, Italia', place_id: 'gp1', types: ['street_address'], geometry: { location: { lat: 43.83, lng: 11.2 }, location_type: 'ROOFTOP' } }] });
  assert.deepEqual(g, { lat: 43.83, lng: 11.2, label: 'Via Finta 1, 50019 Comune di Prova FI, Italia', precision: 'civico', place_id: 'gp1', location_type: 'ROOFTOP', partial_match: false, source: 'Google Geocoding' });
  assert.equal(normalizzaGeocodifica({ status: 'OK', results: [{ formatted_address: 'Comune', types: ['locality'], geometry: { location: { lat: 1, lng: 2 }, location_type: 'APPROXIMATE' } }] }).precision, 'citta');
  assert.equal(normalizzaGeocodifica({ status: 'ZERO_RESULTS', results: [] }), null);
  assert.throws(() => normalizzaGeocodifica({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' }), /REQUEST_DENIED/);
  assert.equal(mascheraChiave(CHIAVE_FINTA), '••••7890'); assert.equal(mascheraChiave(''), null);
  const t = senzaChiave(`errore su https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${CHIAVE_FINTA} con ${CHIAVE_FINTA}`, CHIAVE_FINTA);
  assert.ok(!t.includes(CHIAVE_FINTA)); assert.match(t, /key=••••/);
  assert.equal(chiaveIndirizzo({ indirizzo: 'Via Giuseppe Garibaldi, 1 – Sesto Fiorentino' }), 'indirizzo:via giuseppe garibaldi 1 sesto fiorentino');
  assert.equal(chiaveIndirizzo({ indirizzo: '', lat: 43.832312, lng: 11.19931 }), 'coord:43.8323,11.1993');
});
