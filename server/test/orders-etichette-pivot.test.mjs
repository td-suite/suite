// v0.68.4 parte A (Ordini, richieste del CEO del 10/11/2026): 1) correlazione per TESTO DELL'ETICHETTA (synclab.samples.container, poi
// ServiceNET exam_catalog.label_text), il materiale solo informativo; migrazione 017 che rifonde contenitori_synclab per etichetta
// conservando gli abbinamenti; 2) produzione in pivot per ARTICOLO dai CAMPIONI (un campione = un contenitore) e consumo medio dai
// campioni, con ricaduta su esami × correlazione; 3) Magazzino Centrale unico (redirect di /orders/articoli). Solo dati sintetici (forma
// degli esempi di CB Sistemi, nessun paziente). Il database del processo si fissa PRIMA di importare la Suite (mai il database "suite").
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));
const nomeDb = `suite_etich_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', 'web', 'src', 'modules', 'orders');
const MIG017 = path.resolve(HERE, '..', 'src', 'modules', 'orders', 'migrations', '017_etichette_synclab.sql');

// mesi relativi a oggi: il mese in corso e il precedente (la pivot guarda gli ultimi mesi)
const oggi = new Date();
const meseIso = (d) => d.toISOString().slice(0, 7);
const M0 = meseIso(new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), 1)));
const M1 = meseIso(new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - 1, 1)));

describe('Regole pure: chiave dell\'etichetta, testo da ServiceNET, pivot', () => {
  let S, SL;
  before(async () => { S = await import('../src/modules/orders/lib/synclab.js'); SL = await import('../src/modules/orders/lib/studiolab.js'); });

  test('la chiave è il testo dell\'etichetta senza spazi doppi e in maiuscolo (non il materiale)', () => {
    assert.equal(S.chiaveEtichetta('  T.Viola '), 'T.VIOLA');
    assert.equal(S.chiaveEtichetta('Tappo   giallo'), 'TAPPO GIALLO');
    assert.equal(S.chiaveEtichetta(null), '');
  });

  test('testo delle etichette da /api/esami (Etichette[] come oggetti o stringhe), distinte, unite da " | "', () => {
    assert.equal(SL.testoEtichette({ Etichette: [{ DescrizioneEtichetta: 'T.Viola', Descrizione: 'ignorata' }, { Descrizione: 'Provetta  blu' }, 'T.VIOLA'] }), 'T.Viola | Provetta blu');
    assert.equal(SL.testoEtichette({ Etichette: [] }), null);
    assert.equal(SL.testoEtichette({}), null);
  });

  test('pivot: una riga per articolo con la somma delle etichette, totale, media sui mesi con campioni; non abbinate a parte', () => {
    const r = (mese, chiave, etichetta, n, articolo_id = null, article_name = null) => ({ mese, chiave, etichetta, n, articolo_id, article_name, article_code: articolo_id ? `A${articolo_id}` : null, pack_size: 100, pack_label: 'conf. 100', unit: 'provette' });
    const p = S.componiPivot([r('2026-10', 'T.VIOLA', 'T.Viola', 4, 1, 'Viola'), r('2026-11', 'T.VIOLA', 'T.Viola', 2, 1, 'Viola'), r('2026-11', 'EDTA K3', 'EDTA k3', 1, 1, 'Viola'),
      r('2026-10', 'TAPPO GIALLO', 'Tappo giallo', 3, 2, 'Giallo'), r('2026-11', 'URINE', 'Urine', 5)]);
    assert.deepEqual(p.mesi, ['2026-11', '2026-10']);
    const v = p.articoli.find((a) => a.article_id === 1);
    assert.deepEqual([v.mesi['2026-10'], v.mesi['2026-11'], v.totale, v.media, v.confezioni_mese], [4, 3, 7, 3.5, 0.04]);
    assert.deepEqual(v.etichette.map((e) => [e.etichetta, e.totale]), [['T.Viola', 6], ['EDTA k3', 1]]);
    assert.equal(p.articoli[0].article_id, 1, 'ordinati per totale');
    assert.deepEqual([p.non_abbinate.totale, p.non_abbinate.mesi['2026-11'], p.non_abbinate.etichette[0].etichetta], [5, 5, 'Urine']);
    assert.equal(p.campioni, 15);
    assert.deepEqual(S.componiPivot([]).articoli, []);
  });
});

describe('Magazzino Centrale unico: niente "Catalogo articoli" nel menu, redirect di /orders/articoli', () => {
  test('voce unica, schede e redirect a magazzino?scheda=articoli', async () => {
    const meta = (await import(path.join(WEB, 'meta.js'))).default;
    const L = await import(path.join(WEB, 'lib', 'magazzino.js'));
    assert.ok(!meta.nav.some((v) => v.to === 'articoli'), 'Catalogo articoli tolto dal menu');
    assert.equal(meta.nav.filter((v) => v.to === 'magazzino').length, 1);
    assert.equal(L.REDIRECT_ARTICOLI, 'magazzino?scheda=articoli');
    assert.deepEqual(L.SCHEDE_MAGAZZINO.map((s) => s.label), ['Giacenze Silva', 'Articoli ordinabili']);
    assert.equal(L.schedaMagazzino('scheda=articoli&articolo=4'), 'articoli');
    assert.equal(L.schedaMagazzino(''), 'giacenze'); assert.equal(L.schedaMagazzino('scheda=boh'), 'giacenze');
    assert.equal(L.linkArticolo(42), 'magazzino?scheda=articoli&articolo=42');
    const idx = fs.readFileSync(path.join(WEB, 'index.jsx'), 'utf8');
    assert.match(idx, /<Route path="articoli" element=\{ops \? <Navigate to=\{`\$\{BASE\}\/\$\{REDIRECT_ARTICOLI\}`\} replace \/>/);
    assert.match(idx, /<Route path="magazzino" element=\{ops \? <MagazzinoCentrale \/>/);
  });
});

describe('Etichette, migrazione 017, pivot e consumo dai campioni (database, fixture sintetiche)', { skip: SALTA }, () => {
  const M = {};
  let db;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const ID = {};
  // accettazione sintetica: campioni [etichetta, materiale, [codici esame]] (un campione può servire più esami)
  let k = 0;
  const RIC = (clientId, date, campioni, o = {}) => {
    const r = copia(ESEMPI.standardRequest); delete r.patient; k++;
    const samples = []; const items = [];
    campioni.forEach(([container, material, codici], si) => {
      const s = { ...copia(ESEMPI.optInRequest.samples[0]), id: `S${k}-${si}`, barcode: `BP${k}${si}`, material, container }; samples.push(s);
      for (const code of codici) items.push({ ...copia(r.items[0]), id: `I${k}-${items.length}`, examCode: code, description: `riga ${code}`, deleted: false, invoiceIds: [], sampleIds: [s.id] });
    });
    return { ...r, id: `REQP-${k}`, requestNumber: `2026/P${k}`, date, clientId, clientCode: o.clientCode || null, createdAtLocal: `${date}T09:10:00`, state: 50, invoiceIds: [], items, samples };
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
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    ID.org = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', 'CLIPIV', 'Cliente Pivot Prova') RETURNING id`)).id;
    const grp = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'GRPIV', 'Gruppo Pivot Prova') RETURNING id`);
    ID.sv = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('SV-PIV', 'Punto service pivot', 'SERVICE', 'Prato', 'PO', $1, 'CLI-P') RETURNING id`, [ID.org])).id;
    ID.pp = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id) VALUES ('PP-NOS', 'Punto senza Synclab', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1) RETURNING id`, [grp.id])).id;
    const imp = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
    await imp('clients', [{ ...copia(ESEMPI.client), id: 'CLI-ID-P', clientCode: 'CLI-P' }]);
    await imp('exams', ['E1', 'E2', 'E3', 'E4', 'E5'].map((c, i) => ({ ...copia(ESEMPI.exam), id: `EXP-${i}`, examCode: c, description: `Esame dimostrativo ${c}` })));
    await imp('requests', [
      RIC('CLI-ID-P', `${M1}-05`, [['T.Viola', 'SANGUE INTERO', ['E1', 'E2', 'E3']]], { clientCode: 'CLI-P' }),            // 1 provetta per 3 esami
      RIC('CLI-ID-P', `${M1}-12`, [['T.VIOLA ', 'SANGUE INTERO', ['E1']], ['Tappo Giallo', 'SIERO', ['E4']]], { clientCode: 'CLI-P' }),
      RIC('CLI-ID-P', `${M0}-02`, [['T.Viola', 'SANGUE INTERO', ['E1', 'E2']], ['Urine sterile', 'URINE', ['E5']]], { clientCode: 'CLI-P' }),
    ]);
    await M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: 'http://127.0.0.1:1', auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password: 'non-usata-nei-test' }, settings: { data_api_enabled: true } }, null);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('TST', 'Prova') ON CONFLICT DO NOTHING`);
    const art = async (code, name, pack) => (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label, pack_size) VALUES ($1, 'TST', $2, 'pezzi', $3, $4) RETURNING id`, [code, name, `conf. ${pack}`, pack])).id;
    ID.viola = await art('T-VIO', 'Provetta tappo viola prova', 100); ID.giallo = await art('T-GIA', 'Provetta tappo giallo prova', 50); ID.ago = await art('T-AGO', 'Ago prova', 100);
    // correlazioni esame → articolo (esami × correlazione: per la provetta viola sovrastimano, 3 esami sulla stessa provetta)
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, article_id, qty_per_exam, source) VALUES ('E1', $1, 1, 'MANUALE'), ('E2', $1, 1, 'MANUALE'), ('E3', $1, 1, 'MANUALE'), ('E4', $2, 1, 'MANUALE'), ('E1', $3, 1, 'MANUALE')`, [ID.viola, ID.giallo, ID.ago]);
    // seconda fonte: etichette del catalogo ServiceNET per un esame senza campioni
    await db.query(`INSERT INTO orders.exam_catalog (code, description, label_text) VALUES ('E9', 'Esame solo catalogo', 'T.Viola | Provetta blu')`);
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('etichetta come chiave: una riga per testo (varianti di scrittura unite), materiale solo informativo, ServiceNET in seconda battuta', async () => {
    const out = await M.ord.aggiornaEtichette();
    assert.deepEqual([out.da_campioni, out.da_servicenet], [3, 1]);
    const el = await M.ord.elencoEtichette();
    assert.deepEqual(el.map((e) => [e.chiave, e.etichetta, e.campioni, e.fonte]), [['T.VIOLA', 'T.Viola', 3, 'CAMPIONI'], ['TAPPO GIALLO', 'Tappo Giallo', 1, 'CAMPIONI'], ['URINE STERILE', 'Urine sterile', 1, 'CAMPIONI'], ['PROVETTA BLU', 'Provetta blu', 0, 'SERVICENET']]);
    const v = el[0];
    assert.equal(v.materiali, 'SANGUE INTERO 3');
    assert.deepEqual(v.esami_elenco.map((x) => [x.code, x.fonte]), [['E1', 'CAMPIONI'], ['E2', 'CAMPIONI'], ['E3', 'CAMPIONI'], ['E9', 'SERVICENET']]);
    assert.equal(v.esami, 4); assert.equal(v.esami_elenco[0].descrizione, 'Esame dimostrativo E1');
    // abbinamenti ad articoli; aggiornare di nuovo li lascia
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'T.VIOLA'`, [ID.viola]);
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'TAPPO GIALLO'`, [ID.giallo]);
    await M.ord.aggiornaEtichette();
    assert.equal((await uno(`SELECT articolo_id FROM orders.etichette_synclab WHERE chiave = 'T.VIOLA'`)).articolo_id, ID.viola);
    const pe = await M.ord.etichettePerEsame();
    assert.deepEqual([pe.get('E1').etichetta, pe.get('E1').articolo_id, pe.get('E1').fonte, pe.get('E1').pct], ['T.Viola', ID.viola, 'CAMPIONI', 100]);
    assert.deepEqual([pe.get('E9').etichetta, pe.get('E9').articolo_id, pe.get('E9').fonte], ['T.Viola', ID.viola, 'SERVICENET'], 'esame senza campioni: etichetta dal catalogo ServiceNET');
    const pv = await M.ord.proponiCorrelazioni();
    const es = Object.fromEntries(pv.voci.map((x) => [x.exam_code, x.esito]));
    assert.equal(es.E1, 'COINCIDE'); assert.equal(es.E9, 'NUOVA'); assert.equal(es.E5, undefined, 'etichetta non abbinata: nessuna proposta');
  });

  test('pivot per articolo dai campioni: T.Viola = provette (non esami), etichetta non abbinata a parte; Legal entity = somma dei punti', async () => {
    const ids = await M.sl.productionStrutture(-ID.org);
    assert.deepEqual(ids, [-ID.org, ID.sv]);
    const p = await M.ord.pivotArticoli(ids, 6);
    assert.equal(p.disponibile, true);
    assert.deepEqual(p.mesi, [M0, M1]);
    const v = p.articoli.find((a) => a.article_id === ID.viola);
    assert.deepEqual([v.mesi[M1], v.mesi[M0], v.totale, v.media], [2, 1, 3, 1.5], '3 provette viola: R1 (3 esami) conta 1');
    assert.deepEqual(p.articoli.find((a) => a.article_id === ID.giallo).mesi, { [M1]: 1 });
    assert.deepEqual([p.non_abbinate.totale, p.non_abbinate.etichette.map((e) => e.etichetta)], [1, ['Urine sterile']]);
    assert.equal(p.campioni, 5);
    const ps = await M.ord.pivotArticoli([ID.sv], 6);
    assert.equal(ps.campioni, 5, 'stessi campioni dalla sede service');
  });

  test('consumo medio: dai campioni per gli articoli delle etichette, esami × correlazione per gli altri e per le strutture senza campioni', async () => {
    await M.ord.aggiornaProduzioneSynclab();
    const c = await M.sl.consumptionByArticle(-ID.org, 3);
    assert.equal(c.fonte, 'CAMPIONI');
    const v = c.map.get(ID.viola);
    assert.deepEqual([v.units, v.packs, v.fonte, v.months], [1.5, 0.02, 'CAMPIONI', 2], '(2 + 1) provette / 2 mesi');
    // con esami × correlazione sarebbero (E1 2 + E2 1 + E3 1 + E1 1 + E2 1) / 2 = 3: sovrastima
    const ex = await uno(`SELECT sum(p.qty * m.qty_per_exam)::numeric / 2 AS u FROM orders.production p JOIN orders.exam_mappings m ON m.exam_code = p.exam_code AND m.active AND m.article_id = $1 WHERE p.struttura_id = $2`, [ID.viola, ID.sv]);
    assert.equal(Number(ex.u), 3);
    assert.deepEqual([c.map.get(ID.giallo).units, c.map.get(ID.giallo).fonte], [0.5, 'CAMPIONI']);
    assert.deepEqual([c.map.get(ID.ago).units, c.map.get(ID.ago).fonte], [1.5, 'ESAMI'], 'articolo senza etichetta: resta esami × correlazione');
    // struttura senza campioni Synclab: tutto da esami × correlazione, come prima
    await db.query(`INSERT INTO orders.production (struttura_id, month, exam_code, qty, source) VALUES ($1, $2, 'E1', 10, 'MANUALE')`, [ID.pp, `${M1}-01`]);
    const n = await M.sl.consumptionByArticle(ID.pp, 3);
    assert.equal(n.fonte, 'ESAMI');
    assert.deepEqual([n.map.get(ID.viola).units, n.map.get(ID.viola).fonte], [10, 'ESAMI']);
    // verifica dell'ordine: enrichLines usa lo stesso consumo
    const O = await import('../src/modules/orders/lib/orders.js');
    const o = await uno(`INSERT INTO orders.orders (number, struttura_id, status, kind, origin) VALUES ('ORD-PROVA-1', $1, 'INVIATO', 'SEDE', 'OPERATIONS') RETURNING id`, [-ID.org]);
    await db.query(`INSERT INTO orders.order_lines (order_id, article_id, qty_requested) VALUES ($1, $2, 1)`, [o.id, ID.viola]);
    await O.enrichLines(o.id, -ID.org, 'SEDE');
    const l = await uno(`SELECT prod_units_avg, prod_packs_avg FROM orders.order_lines WHERE order_id = $1`, [o.id]);
    assert.deepEqual([Number(l.prod_units_avg), Number(l.prod_packs_avg)], [1.5, 0.02]);
  });

  test('migrazione 017: rifonde le coppie per etichetta, tiene l\'articolo più osservato e segnala; idempotente', async () => {
    await db.query(`INSERT INTO orders.contenitori_synclab (material, container, articolo_id, osservazioni) VALUES ('SIERO', 'Tappo Rosso', $1, 10), ('PLASMA', 'TAPPO  ROSSO', $2, 3), ('SIERO', 'Provetta X', NULL, 2), ('SANGUE INTERO', 'T.Viola', $3, 7)`, [ID.giallo, ID.viola, ID.ago]);
    const sql = fs.readFileSync(MIG017, 'utf8');
    const esegui = async () => { await db.query('SET search_path = orders, public'); await db.query(sql); await db.query('RESET search_path'); };
    await esegui();
    const r = await uno(`SELECT * FROM orders.etichette_synclab WHERE chiave = 'TAPPO ROSSO'`);
    assert.deepEqual([r.etichetta, r.articolo_id, r.campioni, r.materiali, r.fonte], ['Tappo Rosso', ID.giallo, 13, 'SIERO 10, PLASMA 3', 'CAMPIONI']);
    assert.match(r.nota_rifusione, /articoli diversi \(Provetta tappo giallo prova 10 campioni, Provetta tappo viola prova 3 campioni\): tenuto il più osservato/);
    const x = await uno(`SELECT articolo_id, nota_rifusione FROM orders.etichette_synclab WHERE chiave = 'PROVETTA X'`);
    assert.deepEqual([x.articolo_id, x.nota_rifusione], [null, null]);
    assert.equal((await uno(`SELECT articolo_id FROM orders.etichette_synclab WHERE chiave = 'T.VIOLA'`)).articolo_id, ID.viola, 'etichetta già presente: non si tocca');
    // rieseguita: niente cambia, nemmeno un abbinamento fatto dopo
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'TAPPO ROSSO'`, [ID.viola]);
    const prima = (await db.query(`SELECT chiave, articolo_id, campioni FROM orders.etichette_synclab ORDER BY chiave`)).rows;
    await esegui();
    assert.deepEqual((await db.query(`SELECT chiave, articolo_id, campioni FROM orders.etichette_synclab ORDER BY chiave`)).rows, prima);
    assert.ok(await uno(`SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'orders' AND table_name = 'exam_catalog' AND column_name = 'label_text'`));
  });
});
