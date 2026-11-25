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
    M.conn = await import('../src/lib/connectors.js'); await M.conn.loadConnectors();
    M.pers = await import('../src/lib/synclab/persistenza.js');
    await (await import('../src/lib/travaso.js')).startFresh('orders', null);
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

  test('campioni senza etichetta: articolo dagli esami del campione, materiale come descrizione; l\'etichetta vuota abbinata non conta più', async () => {
    await M.ord.aggiornaEtichette();
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = ''`, [ID.mGiallo]);   // com'era in produzione: tutto su un articolo
    const p = await M.ord.pivotArticoli(await M.sl.productionStrutture(ID.sede), 6);
    const v = p.articoli.find((x) => x.article_id === ID.gViola);
    assert.deepEqual([v.name, v.totale, v.etichette.map((e) => [e.etichetta, e.derivato, e.totale])], ['Tappo Viola', 2, [['Sangue Inter EDTA', true, 2]]], '2 provette (una serve due esami)');
    assert.equal(p.articoli.find((x) => x.article_id === ID.gGiallo).totale, 1, 'solo il siero, non tutti i campioni');
    assert.deepEqual(p.non_abbinate.etichette.map((e) => [e.etichetta, e.derivato, e.totale]), [['Materiale Vario', true, 1]]);
    const pv = await M.ord.proponiCorrelazioni();
    assert.equal(pv.voci.length, 0, 'l\'etichetta vuota non propone correlazioni');
  });

  test('transcodifica: proposta, conferma (correlazioni all\'articolo di magazzino, doppioni spenti), consumo e pivot valorizzati, annullo', async () => {
    const el = await M.tr.elencoTranscodifica();
    assert.deepEqual(el.da_confermare.map((g) => [g.name, g.esami, g.proposta?.article_id]), [['Tappo Viola', 2, ID.mViola], ['Tappo Giallo', 1, ID.mGiallo]]);
    assert.ok(el.magazzino.every((a) => a.id !== ID.gViola), 'i generici non sono a magazzino');
    await assert.rejects(M.tr.confermaTranscodifica(ID.gViola, ID.gGiallo), /catalogo di magazzino/);
    const r = await M.tr.confermaTranscodifica(ID.gViola, ID.mViola, null);
    assert.deepEqual([r.spostate, r.gia_presenti], [1, 1], 'E1 spostata; E2 aveva già l\'articolo di magazzino');
    const dopo = await M.tr.elencoTranscodifica();
    assert.deepEqual(dopo.da_confermare.map((g) => g.name), ['Tappo Giallo']);
    assert.deepEqual(dopo.confermate.map((g) => [g.name, g.a_article_id]), [['Tappo Viola', ID.mViola]]);
    const p = await M.ord.pivotArticoli(await M.sl.productionStrutture(ID.sede), 6);
    assert.equal(p.articoli.find((x) => x.article_id === ID.mViola).totale, 2);
    assert.equal(p.articoli.find((x) => x.article_id === ID.gViola), undefined);
    await M.ord.aggiornaProduzioneSynclab();
    const c = await M.sl.consumptionByArticle(ID.sede, 3);
    assert.deepEqual([c.map.get(ID.mViola).units, c.map.get(ID.mViola).fonte], [2, 'CAMPIONI']);
    assert.equal(c.map.get(ID.gViola), undefined);
    const an = await M.tr.annullaTranscodifica(ID.gViola);
    assert.equal(an.ripristinate, 2);
    const m = (await db.query(`SELECT exam_code, article_id, active, articolo_origine_id FROM orders.exam_mappings ORDER BY exam_code, article_id`)).rows;
    assert.deepEqual(m.filter((x) => x.article_id === ID.gViola).map((x) => [x.exam_code, x.active, x.articolo_origine_id]), [['E1', true, null], ['E2', true, null]]);
    assert.equal((await M.tr.elencoTranscodifica()).da_confermare.length, 2);
  });
});
