// v0.98.1 (Ordini, richieste del CEO del 25/11/2026): 1) campioni SENZA etichetta (la Data API non valorizza il contenitore): l'articolo
// si ricava dagli esami del campione, non più dall'abbinamento dell'etichetta vuota; 2) transcodifica dei contenitori generici delle
// correlazioni verso gli articoli di magazzino: proposta, conferma, annullo; 3) lo stesso cliente con due codici (sede TD e Legal entity
// service) è un cliente solo nella produzione; 4) il consumo porta la descrizione dell'articolo. Solo dati sintetici, nessun paziente.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));
const nomeDb = `suite_transc_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';

const oggi = new Date();
const M0 = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), 1)).toISOString().slice(0, 7);

describe('Proposta di transcodifica e nome del cliente (regole pure)', () => {
  let T;
  before(async () => { T = await import('../src/modules/orders/lib/transcodifica.js'); });
  const S = ['Provetta t/viola PET asp.3ml K3EDTA', 'Provetta t/giallo gel+attivatore', 'Provetta t/verde LI HEPARIN', 'Provetta t/verde oliva cilindriche urine', 'CONTENITORI PER FECI TAPPO ROSSO', 'CONTENITORI PER FECI TAPPO BLU'].map((name, i) => ({ id: i + 1, name }));
  test('stesso colore di tappo e stesso tipo; verde non è verde oliva; alla pari o senza indizi nessuna proposta', () => {
    assert.equal(T.proponiArticolo('Tappo Viola', S).article_id, 1);
    assert.equal(T.proponiArticolo('Tappo Giallo', S).article_id, 2);
    assert.equal(T.proponiArticolo('Tappo Verde', S).article_id, 3);
    assert.equal(T.proponiArticolo('Tappo Oliva Urine', S).article_id, 4);
    assert.equal(T.proponiArticolo('Contenitori urine del mattino tappo giallo 45 ml', S), null, 'giallo ma non per urine');
    assert.equal(T.proponiArticolo('Contenitore feci', S), null, 'due candidati alla pari');
    assert.equal(T.proponiArticolo('Kit Quantiferon', S), null);
  });
  test('nome del cliente senza forma societaria, accenti e punteggiatura', () => {
    assert.equal(T.nomeCliente('Centro Italiano di Fertilità e Sessualità S.r.l.'), T.nomeCliente('CENTRO ITALIANO DI FERTILITA E SESSUALITA'));
    assert.notEqual(T.nomeCliente('Centro Alfa S.r.l.'), T.nomeCliente('Centro Alfa Due S.r.l.'));
  });
});

describe('Campioni senza etichetta, transcodifica e cliente con due codici (database, fixture sintetiche)', { skip: SALTA }, () => {
  const M = {}; const ID = {};
  let db;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  let k = 0;
  const RIC = (clientId, clientCode, date, campioni) => {
    const r = copia(ESEMPI.standardRequest); delete r.patient; k++;
    const samples = []; const items = [];
    campioni.forEach(([material, codici], si) => {
      const s = { ...copia(ESEMPI.optInRequest.samples[0]), id: `T${k}-${si}`, barcode: `BT${k}${si}`, material, container: null }; samples.push(s);
      for (const code of codici) items.push({ ...copia(r.items[0]), id: `J${k}-${items.length}`, examCode: code, description: `riga ${code}`, deleted: false, invoiceIds: [], sampleIds: [s.id] });
    });
    return { ...r, id: `REQT-${k}`, requestNumber: `2026/T${k}`, date, clientId, clientCode, createdAtLocal: `${date}T09:10:00`, state: 50, invoiceIds: [], items, samples };
  };

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    await (await import('../src/migrate.js')).migrate();
    // la migrazione 024 scrive oggi come giorno da cui i campioni sono conservati: per le prove vale da oltre un anno
    await M.dbm.q(`INSERT INTO public.app_settings (key, value) VALUES ('synclab.campioni_dal', to_jsonb((current_date - 400)::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    M.conn = await import('../src/lib/connectors.js'); await M.conn.loadConnectors();
    M.pers = await import('../src/lib/synclab/persistenza.js');
    await (await import('../src/lib/travaso.js')).startFresh('orders', null);
    await (await import('../src/lib/travaso.js')).startFresh('etichette', null);
    M.ord = await import('../src/modules/orders/lib/synclab.js');
    M.sl = await import('../src/modules/orders/lib/studiolab.js');
    M.tr = await import('../src/modules/orders/lib/transcodifica.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    const grp = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'GRTRA', 'Gruppo Prova Transcodifica') RETURNING id`);
    ID.org = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', 'SERX1', 'Centro Prova Fertilità S.r.l.') RETURNING id`)).id;
    ID.sede = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('TDX1', 'Centro Prova Fertilità', 'POLIAMBULATORIO', 'Firenze', 'FI', $1, 'TDX1') RETURNING id`, [grp.id])).id;
    ID.sv = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('SV-TRA', 'Punto service transcodifica', 'SERVICE', 'Firenze', 'FI', $1, 'SERX1') RETURNING id`, [ID.org])).id;
    const imp = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
    await imp('clients', [{ ...copia(ESEMPI.client), id: 'CLI-TD', clientCode: 'TDX1' }, { ...copia(ESEMPI.client), id: 'CLI-SER', clientCode: 'SERX1' }]);
    await imp('exams', ['E1', 'E2', 'E4', 'E5'].map((c, i) => ({ ...copia(ESEMPI.exam), id: `EXT-${i}`, examCode: c, description: `Esame dimostrativo ${c}` })));
    await imp('requests', [
      RIC('CLI-TD', 'TDX1', `${M0}-03`, [['Sangue Inter EDTA', ['E1', 'E2']], ['Siero', ['E4']], ['Materiale Vario', ['E5']]]),
      RIC('CLI-SER', 'SERX1', `${M0}-04`, [['Sangue Inter EDTA', ['E1']]]),
    ]);
    await M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: 'http://127.0.0.1:1', auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password: 'non-usata-nei-test' }, settings: { data_api_enabled: true } }, null);
    await db.query(`INSERT INTO etichette.impostazioni (key, value) VALUES ('provette', to_jsonb($1::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, ['T.Viola Alinity = Sangue Inter EDTA | E2\nT.Viola = Sangue Inter EDTA\nT.Giallo Alinity = Siero']);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('TST', 'Prova') ON CONFLICT DO NOTHING`);
    const art = async (code, name, active = true) => (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label, pack_size, active) VALUES ($1, 'TST', $2, 'pezzi', 'conf. 100', 100, $3) RETURNING id`, [code, name, active])).id;
    ID.gViola = await art('G-VIO', 'Tappo Viola', false); ID.gGiallo = await art('G-GIA', 'Tappo Giallo', false);
    ID.mViola = await art('M-VIO', 'Provetta t/viola K3EDTA prova'); ID.mGiallo = await art('M-GIA', 'Provetta t/giallo gel prova');
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, article_id, qty_per_exam, source) VALUES ('E1', $1, 1, 'MANUALE'), ('E2', $1, 1, 'MANUALE'), ('E2', $2, 1, 'MANUALE'), ('E4', $3, 1, 'MANUALE')`, [ID.gViola, ID.mViola, ID.gGiallo]);
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('stesso cliente con due codici: la sede TD e la Legal entity service sommano la produzione, da entrambe le parti', async () => {
    assert.deepEqual((await M.tr.struttureGemelle(ID.sede)).map((g) => g.id), [-ID.org]);
    assert.deepEqual(await M.sl.productionStrutture(ID.sede), [ID.sede, -ID.org, ID.sv]);
    assert.deepEqual(await M.sl.productionStrutture(-ID.org), [-ID.org, ID.sv, ID.sede]);
    const a = await M.ord.pivotArticoli(await M.sl.productionStrutture(ID.sede), 6);
    const b = await M.ord.pivotArticoli(await M.sl.productionStrutture(-ID.org), 6);
    assert.deepEqual([a.campioni, b.campioni], [4, 4]);
  });

  test('v0.99.1 · si conta il testo delle etichette: nome dalla tabella delle provette, più etichette sullo stesso articolo, niente correlazioni', async () => {
    const agg = await M.ord.aggiornaEtichette();
    assert.deepEqual([agg.da_tabella, agg.senza_etichetta], [3, 1]);
    const el = await M.ord.elencoEtichette();
    assert.deepEqual(el.filter((e) => e.campioni > 0).map((e) => [e.etichetta, e.campioni, e.fonte]).sort((a, b) => a[0].localeCompare(b[0])), [['', 1, 'CAMPIONI'], ['T.Giallo Alinity', 1, 'PROVETTE'], ['T.Viola', 1, 'PROVETTE'], ['T.Viola Alinity', 1, 'PROVETTE']]);
    assert.equal(el.find((e) => e.etichetta === 'T.Viola Alinity').proposta?.article_id, ID.mViola, 'proposta dal colore del tappo');
    // prima dell'abbinamento: nessun articolo, anche se gli esami hanno correlazioni (la regola dagli esami non c'è più)
    const prima = await M.ord.pivotArticoli(await M.sl.productionStrutture(ID.sede), 6);
    assert.deepEqual([prima.articoli.length, prima.non_abbinate.totale, prima.campioni], [0, 4, 4]);
    // T.Viola e T.Viola Alinity → stessa provetta di magazzino; T.Giallo Alinity → gialla
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave IN ('T.VIOLA', 'T.VIOLA ALINITY')`, [ID.mViola]);
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'T.GIALLO ALINITY'`, [ID.mGiallo]);
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = ''`, [ID.mGiallo]);   // l'etichetta vuota abbinata non conta
    const p = await M.ord.pivotArticoli(await M.sl.productionStrutture(ID.sede), 6);
    const v = p.articoli.find((x) => x.article_id === ID.mViola);
    assert.deepEqual([v.totale, v.etichette.map((e) => [e.etichetta, e.totale]).sort((a, b) => a[0].localeCompare(b[0]))], [2, [['T.Viola', 1], ['T.Viola Alinity', 1]]]);
    assert.equal(p.articoli.find((x) => x.article_id === ID.mGiallo).totale, 1);
    assert.deepEqual(p.non_abbinate.etichette.map((e) => [e.etichetta, e.derivato, e.totale]), [['Materiale Vario', true, 1]], 'materiale senza riga nella tabella');
    // consumo: stessi numeri della tabella per articolo; le correlazioni contenitore non si sommano
    await M.ord.aggiornaProduzioneSynclab();
    const c = await M.sl.consumptionByArticle(ID.sede, 3);
    // v0.99.13: media per giorni osservati (dal primo campione, almeno 14) riportati al mese
    const g = c.map.get(ID.mViola).giorni; assert.ok(g >= 14 && g <= 31);
    const alMese = (n) => Math.round((n / (g / 30.44)) * 100) / 100;
    assert.deepEqual([c.map.get(ID.mViola).units, c.map.get(ID.mViola).fonte, c.map.get(ID.mGiallo).units], [alMese(2), 'CAMPIONI', alMese(1)]);
    assert.equal(c.map.get(ID.gViola), undefined, 'il contenitore generico delle correlazioni non compare più');
    assert.ok(c.nonContati.some((x) => x.article_id === ID.gViola), 'ed è dichiarato tra i non contati');
    assert.equal((await M.ord.proponiCorrelazioni()).voci.length, 0, 'l\'etichetta vuota non propone correlazioni');
  });

  test('transcodifica dei contenitori delle correlazioni: proposta, conferma (doppioni spenti), annullo', async () => {
    const el = await M.tr.elencoTranscodifica();
    assert.deepEqual(el.da_confermare.map((g) => [g.name, g.esami, g.proposta?.article_id]), [['Tappo Viola', 2, ID.mViola], ['Tappo Giallo', 1, ID.mGiallo]]);
    assert.ok(el.magazzino.every((a) => a.id !== ID.gViola), 'i generici non sono a magazzino');
    await assert.rejects(M.tr.confermaTranscodifica(ID.gViola, ID.gGiallo), /catalogo di magazzino/);
    const r = await M.tr.confermaTranscodifica(ID.gViola, ID.mViola, null);
    assert.deepEqual([r.spostate, r.gia_presenti], [1, 1], 'E1 spostata; E2 aveva già l\'articolo di magazzino');
    const dopo = await M.tr.elencoTranscodifica();
    assert.deepEqual(dopo.da_confermare.map((g) => g.name), ['Tappo Giallo']);
    assert.deepEqual(dopo.confermate.map((g) => [g.name, g.a_article_id]), [['Tappo Viola', ID.mViola]]);
    const an = await M.tr.annullaTranscodifica(ID.gViola);
    assert.equal(an.ripristinate, 2);
    const m = (await db.query(`SELECT exam_code, article_id, active, articolo_origine_id FROM orders.exam_mappings ORDER BY exam_code, article_id`)).rows;
    assert.deepEqual(m.filter((x) => x.article_id === ID.gViola).map((x) => [x.exam_code, x.active, x.articolo_origine_id]), [['E1', true, null], ['E2', true, null]]);
    assert.equal((await M.tr.elencoTranscodifica()).da_confermare.length, 2);
  });

  test('v0.99.0 · più materiali per esame: un contenitore per campione, i materiali in più si contano a ogni esame', async () => {
    const art = async (code, name) => (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label, pack_size) VALUES ($1, 'TST', $2, 'pezzi', 'conf. 10', 10) RETURNING id`, [code, name])).id;
    const sigillo = await art('M-SIG', 'Sigillo prova'); const tappo = await art('M-TAP', 'Tappo a vite prova');
    // E4 (1 campione, 1 esame nel mese): contenitore = provetta gialla di magazzino, in più 2 sigilli e 1 tappo a ogni esame
    await db.query(`DELETE FROM orders.exam_mappings WHERE exam_code = 'E4'`);
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, article_id, qty_per_exam, contenitore, source) VALUES ('E4', $1, 1, TRUE, 'MANUALE'), ('E4', $2, 2, FALSE, 'MANUALE'), ('E4', $3, 1, FALSE, 'MANUALE')`, [ID.mGiallo, sigillo, tappo]);
    const c = await M.sl.consumptionByArticle(ID.sede, 3);
    const g = c.map.get(ID.mGiallo).giorni; const alMese = (n) => Math.round((n / (g / 30.44)) * 100) / 100;
    assert.deepEqual([c.map.get(ID.mGiallo).units, c.map.get(ID.mGiallo).fonte], [alMese(1), 'CAMPIONI']);
    assert.deepEqual([c.map.get(sigillo).units, c.map.get(sigillo).packs, c.map.get(sigillo).fonte], [2, 0.2, 'ESAMI'], '1 esame × 2 sigilli');
    assert.deepEqual([c.map.get(tappo).units, c.map.get(tappo).fonte], [1, 'ESAMI']);
    // lo stesso articolo contenitore per un esame e materiale in più per un altro: le due parti si sommano
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, article_id, qty_per_exam, contenitore, source) VALUES ('E1', $1, 1, FALSE, 'MANUALE')`, [ID.mGiallo]);
    const c2 = await M.sl.consumptionByArticle(ID.sede, 3);
    assert.deepEqual([c2.map.get(ID.mGiallo).units, c2.map.get(ID.mGiallo).fonte], [Math.round((alMese(1) + 2) * 100) / 100, 'CAMPIONI+ESAMI'], '1 campione + 2 esami E1');
  });
});
