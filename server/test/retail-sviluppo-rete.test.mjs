// Retail > Sviluppo rete (richiesta del CEO del 17/11/2026): posizionamento rispetto ai concorrenti, valutazione di un indirizzo con
// stima di resa dalle sedi simili, classifica dei comuni della Toscana. Risposte di Google finte (INTORNO_MOCK), dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';
import { schedaTd, sabatoAperto, posizioneSede, caratteristiche, sediSimili, stimaResa, percentili, puntiSpazio, classificaComuni, normNome } from '../src/modules/retail/lib/rete.js';

const SALTA = !process.env.DATABASE_URL_TEST;
const L = (o) => ({ presente: true, stato_attivita: 'OPERATIONAL', categoria: 'CONCORRENTE', sottocategoria: 'laboratorio', orari: null, novita: null, ...o });

describe('Sviluppo rete: funzioni pure', () => {
  test('la nostra scheda Google non è un concorrente; posto per rating solo tra chi ha almeno 10 recensioni', () => {
    const luoghi = [
      L({ place_id: 'td', nome: 'Toscana Diagnostica - Punto Prelievi', distanza_m: 20, rating: 4.6, n_recensioni: 80, orari: { weekdayDescriptions: ['lunedì: 07:00–19:00', 'sabato: 07:30–12:00'] } }),
      L({ place_id: 'a', nome: 'Lab Alfa', distanza_m: 300, rating: 4.8, n_recensioni: 200, orari: { weekdayDescriptions: ['sabato: Chiuso'] } }),
      L({ place_id: 'b', nome: 'Lab Beta', distanza_m: 900, rating: 4.2, n_recensioni: 35, novita: 'NUOVO', orari: { weekdayDescriptions: ['sabato: 08:00–12:00'] } }),
      L({ place_id: 'c', nome: 'Lab Gamma', distanza_m: 1500, rating: 5, n_recensioni: 3 }),
      L({ place_id: 'd', nome: 'Toscana Diagnostica Prato', distanza_m: 2500, rating: 4.9, n_recensioni: 50 }),
      L({ place_id: 'e', nome: 'Lab Chiuso', distanza_m: 400, stato_attivita: 'CLOSED_PERMANENTLY' }),
      L({ place_id: 'f', nome: 'Farmacia', categoria: 'ATTRATTORE', sottocategoria: 'farmacia', distanza_m: 100 }),
      L({ place_id: 'g', nome: 'Lab Sparito', distanza_m: 700, presente: false, novita: 'SCOMPARSO' }),
    ];
    const td = schedaTd(luoghi);
    assert.equal(td.place_id, 'td');
    assert.equal(schedaTd(luoghi, { placeId: 'a' }).place_id, 'a', 'la scelta a mano prevale');
    assert.equal(sabatoAperto(td.orari), true); assert.equal(sabatoAperto({ weekdayDescriptions: ['sabato: Chiuso'] }), false); assert.equal(sabatoAperto(null), null);
    const p = posizioneSede(luoghi, td, { raggio: 3000 });
    assert.deepEqual(p.concorrenti, { entro_500: 1, entro_1000: 2, nel_raggio: 3, con_voto: 2 });
    assert.equal(p.posto_rating, 2); assert.equal(p.su, 3); assert.equal(p.posto_recensioni, 2);
    assert.equal(p.rating_medio, 4.5); assert.equal(p.migliore.nome, 'Lab Alfa');
    assert.deepEqual(p.sabato, { aperti: 1, con_orari: 2 });
    assert.deepEqual(p.nuovi.map((x) => x.nome), ['Lab Beta']); assert.deepEqual(p.scomparsi.map((x) => x.nome), ['Lab Sparito']);
    assert.deepEqual(caratteristiche(luoghi, td), { concorrenti: 2, prescrittori: 0, attrattori: 1, contesto: 0 });
    assert.equal(normNome('Sesto  Fiorentino (FI) – Città'), 'sesto fiorentino fi citta');
  });

  test('sedi simili e stima di resa: intervallo delle sedi più vicine per intorno, nessuna stima con meno di due sedi', () => {
    const sedi = [
      { site_id: 1, car: { concorrenti: 1, prescrittori: 10, attrattori: 5, contesto: 20 }, popolazione: 50000, mesi: 12, accettazioni_mese: 400, ricavi_mese: 12000 },
      { site_id: 2, car: { concorrenti: 2, prescrittori: 12, attrattori: 6, contesto: 22 }, popolazione: 45000, mesi: 12, accettazioni_mese: 500, ricavi_mese: 15000 },
      { site_id: 3, car: { concorrenti: 9, prescrittori: 40, attrattori: 20, contesto: 60 }, popolazione: 360000, mesi: 12, accettazioni_mese: 2000, ricavi_mese: 70000 },
      { site_id: 4, car: { concorrenti: 0, prescrittori: 2, attrattori: 1, contesto: 4 }, popolazione: 6000, mesi: 6, accettazioni_mese: 150, ricavi_mese: 4000 },
    ];
    const s = sediSimili({ car: { concorrenti: 1, prescrittori: 11, attrattori: 5, contesto: 21 }, popolazione: 48000 }, sedi, 2);
    assert.deepEqual(s.map((x) => x.site_id), [1, 2]);
    const r = stimaResa(s);
    assert.deepEqual(r, { sedi: 2, accettazioni_mese: { min: 400, mediana: 450, max: 500 }, ricavi_mese: { min: 12000, mediana: 13500, max: 15000 } });
    assert.equal(stimaResa(s.slice(0, 1)), null);
    assert.equal(sediSimili({ car: null, popolazione: null }, sedi).length, 0, 'senza dati sul punto nessun confronto');
  });

  test('classifica dei comuni: posizioni relative, spazio dalla rete, parziale senza rilevazione', () => {
    assert.deepEqual(percentili([10, 20, 30, null]), [0, 0.5, 1, null]);
    assert.equal(puntiSpazio(1), 0); assert.equal(puntiSpazio(8), 15); assert.equal(puntiSpazio(20), 15); assert.equal(puntiSpazio(60), 7.5); assert.equal(puntiSpazio(null), null);
    const c = classificaComuni([
      { istat: 'A', popolazione: 60000, rilevato: true, concorrenti: 2, traino: 30, km_td: 12, clienti: 2, prospect: 5 },
      { istat: 'B', popolazione: 20000, rilevato: true, concorrenti: 6, traino: 8, km_td: 1, clienti: 0, prospect: 0 },
      { istat: 'C', popolazione: 8000, rilevato: false, concorrenti: null, traino: null, km_td: 25, clienti: 0, prospect: 1 },
    ]);
    const [a, b, d] = c;
    assert.equal(a.completo, true); assert.equal(a.su, 100); assert.equal(a.componenti.bacino, 25); assert.equal(a.componenti.concorrenza, 25); assert.equal(a.componenti.spazio, 15); assert.equal(a.componenti.b2b, 20);
    assert.equal(b.componenti.spazio, 0); assert.equal(b.componenti.b2b, 0); assert.equal(b.componenti.concorrenza, 0); assert.equal(b.concorrenti_10k, 3);
    assert.equal(d.completo, false); assert.equal(d.su, 60); assert.equal(d.componenti.concorrenza, null);
    assert.ok(a.punteggio > b.punteggio);
  });
});

describe('Sviluppo rete: dalla rilevazione alla classifica', { skip: SALTA }, () => {
  let S; let o; let db; const M = {};
  const must = (r, cosa) => { assert.ok(r.s >= 200 && r.s < 300, `${cosa}: ${r.s} ${r.text.slice(0, 300)}`); return r.j; };
  before(async () => {
    S = await avviaSuite({ env: { INTORNO_MOCK: '1', NODE_ENV: 'test' } });
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    must(await o.post('/api/travaso/retail/run'), 'retail'); must(await o.post('/api/travaso/business/run'), 'business');
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const sede = async (code, name, city, prov, lat, lng) => (await db.query(`INSERT INTO public.sites (code, name, kind, city, province, lat, lng) VALUES ($1,$2,'PUNTO_PRELIEVI',$3,$4,$5,$6) RETURNING id`, [code, name, city, prov, lat, lng])).rows[0].id;
    M.a = await sede('PP-FI', 'Punto Prova Firenze', 'Firenze', 'FI', 43.7699, 11.2556); M.b = await sede('PP-PO', 'Punto Prova Prato', 'Prato', 'PO', 43.8805, 11.0970); M.c = await sede('PP-LU', 'Punto Prova Lucca', 'Lucca', 'LU', 43.8429, 10.5027);
    // vendite B2C degli ultimi tre mesi chiusi: 30, 20 e 10 accettazioni al mese
    for (const [site, n] of [[M.a, 30], [M.b, 20], [M.c, 10]]) {
      await db.query(`INSERT INTO retail.sales (source, external_ref, sale_date, site_id, product_code, quantity, net_amount)
        SELECT 'GIPO', 'ACC-' || $1::int || '-' || m || '-' || i, (date_trunc('month', CURRENT_DATE) - (m || ' months')::interval + interval '5 days')::date, $1::int, 'PRE01', 1, 25 FROM generate_series(1,3) m, generate_series(1,$2::int) i`, [site, n]);
    }
    // un cliente B2B attivo e un prospect a Sesto Fiorentino
    const org = (await db.query(`INSERT INTO public.organizations (kind, name, city, province) VALUES ('CLIENTE', 'RSA Prova Sesto', 'Sesto Fiorentino', 'FI') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente) VALUES ($1, 'SRV', FALSE, TRUE, 7)`, [org]);
    await db.query(`INSERT INTO business.scout_candidati (linea, fonte, fonte_ref, nome, categoria, comune, provincia, stato) VALUES ('SRV', 'MANUALE', 'prova-1', 'Casa di cura di prova', 'CASA_DI_CURA', 'Sesto Fiorentino', 'FI', 'NUOVO'),
      ('SRV', 'MANUALE', 'prova-2', 'Scartato di prova', 'RSA', 'Sesto Fiorentino', 'FI', 'SCARTATO')`);
  });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('posizionamento: sedi rilevate con i concorrenti, scheda Google scelta a mano, prezzi dei concorrenti', async () => {
    for (const id of [M.a, M.b, M.c]) must(await o.post(`/api/retail/sedi/${id}/intorno/rileva`), 'rileva sede');
    let p = must(await o.get('/api/retail/rete/posizionamento'), 'posizionamento').sedi;
    const a = p.find((x) => x.site_id === M.a);
    assert.ok(a.rilevazione && a.concorrenti.nel_raggio > 0 && a.elenco.length > 0); assert.equal(a.td, null, 'nessuna scheda riconosciuta da sola');
    const scelto = a.elenco[0];
    assert.equal((await o.put(`/api/retail/rete/sedi/${M.a}/scheda-google`, { place_id: 'inesistente' })).s, 400);
    must(await o.put(`/api/retail/rete/sedi/${M.a}/scheda-google`, { place_id: scelto.place_id }), 'scheda');
    p = must(await o.get('/api/retail/rete/posizionamento'), 'posizionamento').sedi; const a2 = p.find((x) => x.site_id === M.a);
    assert.equal(a2.td.place_id, scelto.place_id); assert.equal(a2.concorrenti.nel_raggio, a.concorrenti.nel_raggio - 1, 'la nostra scheda esce dai concorrenti');
    const pr = must(await o.post('/api/retail/rete/prezzi', { site_id: M.a, concorrente: 'Laboratorio di prova', prestazione: 'Emocromo', prezzo: 6.5, prezzo_td: 5, rilevato_il: '2026-11-17', fonte: 'sito' }), 'prezzo');
    assert.equal(must(await o.get('/api/retail/rete/posizionamento'), 'p').sedi.find((x) => x.site_id === M.a).prezzi.length, 1);
    must(await o.del(`/api/retail/rete/prezzi/${pr.id}`), 'elimina prezzo');
  });

  test('valutazione di un indirizzo: comune, centri commerciali, clienti e prospect nel comune, sede più vicina, resa dalle sedi simili', async () => {
    const v = must(await o.post('/api/retail/intorno/valuta', { indirizzo: 'Via di Prova 1, Sesto Fiorentino' }), 'valuta');
    assert.ok(v.luoghi.some((l) => l.sottocategoria === 'centro_commerciale'), 'centri commerciali tra le categorie');
    const r = must(await o.get(`/api/retail/rete/valutazioni/${v.id}`), 'valutazione');
    assert.equal(r.comune.nome, 'Sesto Fiorentino'); assert.ok(r.comune.popolazione > 40000);
    assert.equal(r.centri_commerciali_rilevati, true); assert.ok(r.centri_commerciali.length > 0);
    assert.deepEqual(r.b2b.clienti.map((c) => c.nome), ['RSA Prova Sesto']); assert.deepEqual(r.b2b.prospect.map((x) => x.nome), ['Casa di cura di prova']);
    assert.ok(r.rete.piu_vicina.km > 0 && r.rete.piu_vicina.km < 15);
    assert.equal(r.resa.base.sedi_con_vendite, 3); assert.equal(r.resa.base.solo_punti_prelievo, true);
    assert.equal(r.resa.stima.sedi, 3); assert.deepEqual(r.resa.stima.accettazioni_mese, { min: 10, mediana: 20, max: 30 }); assert.deepEqual(r.resa.stima.ricavi_mese, { min: 250, mediana: 500, max: 750 });
    assert.ok(!must(await o.get('/api/retail/intorno/valutazioni'), 'elenco').some((x) => String(x.chiave).startsWith('comune:')));
  });

  test('dove aprire: 273 comuni seminati, soglia di abitanti, rilevazione di un comune, classifica completa solo per i rilevati', async () => {
    let d = must(await o.get('/api/retail/rete/comuni'), 'comuni');
    assert.equal(d.riepilogo.totale, 273); assert.equal(d.riepilogo.in_classifica, 154); assert.equal(d.riepilogo.rilevati, 0);
    assert.ok(d.comuni.every((c) => !c.completo && c.su === 60));
    const sesto = d.comuni.find((c) => c.nome === 'Sesto Fiorentino');
    assert.equal(sesto.clienti, 1); assert.equal(sesto.prospect, 1); assert.ok(sesto.componenti.b2b > 0);
    assert.equal(d.comuni.find((c) => c.nome === 'Firenze').presente, true);
    const ril = must(await o.post(`/api/retail/rete/comuni/${sesto.istat}/rileva`), 'rileva comune');
    assert.ok(ril.luoghi > 0 && ril.prova === true);
    d = must(await o.get('/api/retail/rete/comuni'), 'comuni');
    assert.equal(d.riepilogo.rilevati, 1); assert.equal(d.comuni[0].nome, 'Sesto Fiorentino'); assert.equal(d.comuni[0].completo, true);
    assert.ok(d.comuni[0].concorrenti > 0 && d.comuni[0].dettaglio.farmacia > 0 && d.comuni[0].coord_fonte === 'GOOGLE');
    // esclusione con nota, soglia, scansione a lotti
    must(await o.put(`/api/retail/rete/comuni/${sesto.istat}`, { escluso: true, nota: 'Già valutato' }), 'escludi');
    must(await o.put('/api/retail/rete/impostazioni', { soglia_abitanti: 50000 }), 'soglia');
    d = must(await o.get('/api/retail/rete/comuni'), 'comuni');
    assert.equal(d.esclusi.length, 1); assert.ok(d.riepilogo.in_classifica < 20 && d.comuni.every((c) => c.popolazione >= 50000));
    const sc = must(await o.post('/api/retail/rete/comuni/scansione', { limite: 2 }), 'scansione');
    assert.deepEqual(sc.rilevati.map((x) => x.comune), ['Firenze', 'Prato']);
  });
});
