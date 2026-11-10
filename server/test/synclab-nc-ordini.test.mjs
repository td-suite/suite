// v0.67.1, integrazioni dopo il primo completo in produzione: Desk NC che cerca anche nella copia Synclab (numero/barcode, esatto,
// normalizzato, anno + numero), produzione di Ordini dalla copia Synclab (la riga manuale vince) e correlazione esami → materiali dalle
// etichette dei campioni (v0.68.4: chiave = testo dell'etichetta, synclab.samples.container). Solo fixture sintetiche (forma degli esempi di CB Sistemi, nessun paziente). Il database del processo si
// fissa PRIMA di importare la Suite (mai il database "suite").
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));
const nomeDb = `suite_slord_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const D = await import('../src/modules/nc/lib/synclabDesk.js');

describe('Desk NC: normalizzazione del numero', () => {
  test('codice normalizzato e anno + numero', () => {
    assert.equal(D.normCodice(' bc-00 1 '), 'BC001');
    assert.deepEqual(D.annoNumero('P26-006743'), { anno: '26', numero: '6743' });
    assert.deepEqual(D.annoNumero('2026/6743'), { anno: '26', numero: '6743' });
    assert.deepEqual(D.annoNumero('6743'), { anno: null, numero: '6743' });
    assert.equal(D.statoSynclab(50), 'Chiusa'); assert.equal(D.statoSynclab(77), 'Stato 77 del gestionale');
  });
});

describe('Synclab nel Desk NC e in Ordini (fixture sintetiche)', { skip: SALTA }, () => {
  const M = {};
  let db;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;
  const ID = {};
  // accettazione sintetica: righe [codice, cancellata?, [materiale, contenitore]]
  let k = 0;
  const RIC = (numero, clientId, date, righe, o = {}) => {
    const r = copia(ESEMPI.standardRequest); delete r.patient; k++;
    const samples = []; const items = righe.map(([code, del, pair], j) => {
      let s = samples.find((x) => x.material === pair?.[0] && x.container === pair?.[1]);
      if (pair && !s) { s = { ...copia(ESEMPI.optInRequest.samples[0]), id: `S${k}-${samples.length}`, barcode: o.barcode && !samples.length ? o.barcode : `BX${k}${samples.length}`, material: pair[0], container: pair[1] }; samples.push(s); }
      return { ...copia(r.items[0]), id: `I${k}-${j}`, examCode: code, description: `riga ${code}`, deleted: Boolean(del), invoiceIds: [], sampleIds: s ? [s.id] : [] };
    });
    return { ...r, id: `REQ-${k}`, requestNumber: numero, date, clientId, clientCode: o.clientCode || null, createdAtLocal: `${date}T09:10:00`, state: o.state ?? 50, invoiceIds: [], items, samples };
  };
  const SP = ['SIERO', 'PROVETTA'], PC = ['PLASMA', 'PROVETTA CITRATO'], UR = ['URINE', 'CONTENITORE STERILE'];

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    await (await import('../src/migrate.js')).migrate();
    M.conn = await import('../src/lib/connectors.js'); await M.conn.loadConnectors();
    M.pers = await import('../src/lib/synclab/persistenza.js');
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('nc', null); await tr.startFresh('orders', null);
    M.ord = await import('../src/modules/orders/lib/synclab.js');
    M.sl = await import('../src/modules/orders/lib/studiolab.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    const org = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', 'CLIPROVA', 'Cliente Prova Service') RETURNING id`);
    const grp = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'GRPROVA', 'Gruppo Prova') RETURNING id`);
    ID.org = org.id;
    ID.sA = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-A', 'Punto Prova', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1, 'CLI-A') RETURNING id`, [grp.id])).id;
    ID.sS = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('SV-P', 'Punto service prova', 'SERVICE', 'Prato', 'PO', $1, 'CLI-S') RETURNING id`, [org.id])).id;
    const imp = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
    await imp('clients', ['A', 'S', 'N'].map((x) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}` })));
    await imp('exams', ['E1', 'E2', 'E3', 'E4', 'E5'].map((c, i) => ({ ...copia(ESEMPI.exam), id: `EX-${i}`, examCode: c, description: `Esame dimostrativo ${c}` })));
    await imp('requests', [
      RIC('2026/6743', 'CLI-ID-A', '2026-10-05', [['E1', false, SP], ['E2', true, SP]], { barcode: 'BC-001', clientCode: 'CLI-A' }),
      RIC('2025/6743', 'CLI-ID-A', '2025-10-05', [['E1', false, SP]], { clientCode: 'CLI-A' }),
      RIC('2026/0888', 'CLI-ID-S', '2026-10-06', [['E1', false, SP]], { clientCode: 'CLI-S' }),
      RIC('P26-000888', 'CLI-ID-S', '2026-10-07', [['E1', false, SP], ['E3', false, UR]], { clientCode: 'CLI-S' }),
      RIC('2026/0901', 'CLI-ID-S', '2026-11-02', [['E1', false, PC], ['E4', false, SP], ['E5', false, SP]], { clientCode: 'CLI-S', state: 20 }),
      RIC('2026/0902', 'CLI-ID-S', '2026-11-03', [['E1', false, SP], ['E3', false, UR]], { clientCode: 'CLI-S' }),
      RIC('2026/0950', 'CLI-ID-N', '2026-11-04', [['E1', false, SP]], { clientCode: 'CLI-N' }),
    ]);
    await M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: 'http://127.0.0.1:1', auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password: 'non-usata-nei-test' }, settings: { data_api_enabled: true } }, null);
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('ricerca nella copia: esatta, normalizzata (barcode), anno + numero, più risultati, nessuno', async () => {
    let t = await D.cercaAccettazioniSynclab('2026/6743');
    assert.equal(t.passo, 'ESATTA'); assert.equal(t.candidati.length, 1);
    t = await D.cercaAccettazioniSynclab('P26-006743');
    assert.equal(t.passo, 'ANNO_NUMERO'); assert.deepEqual(t.candidati.map((x) => x.request_number), ['2026/6743'], 'l\'anno esclude 2025/6743');
    t = await D.cercaAccettazioniSynclab('bc 001');
    assert.equal(t.passo, 'NORMALIZZATA'); assert.equal(t.candidati[0].request_number, '2026/6743');
    t = await D.cercaAccettazioniSynclab('26-888');
    assert.equal(t.passo, 'ANNO_NUMERO'); assert.deepEqual(t.candidati.map((x) => x.request_number).sort(), ['2026/0888', 'P26-000888']);
    const elenco = await D.descriviCandidati(t.candidati);
    assert.ok(elenco.every((c) => c.synclab_id && c.numero && c.stato === 'Chiusa'));
    assert.doesNotMatch(JSON.stringify(elenco), /lastName|fiscal|patient/i);
    t = await D.cercaAccettazioniSynclab('X-999999');
    assert.equal(t.candidati.length, 0);
  });

  test('import nella cache NC: numero, data, stato tradotto, esami non cancellati, campioni, sede dal client abbinato', async () => {
    const r = await uno(`SELECT instance_id, id FROM synclab.requests WHERE request_number = '2026/6743'`);
    const out = await D.importaDaSynclab(r.instance_id, r.id);
    assert.equal(out.sede.come, 'PROPOSTA_CODICE');
    const a = await uno(`SELECT * FROM nc.accettazioni WHERE id = '2026/6743'`);
    assert.equal(a.origine, 'SYNCLAB'); assert.equal(a.sede_id, ID.sA); assert.equal(a.paziente_cognome, null);
    assert.deepEqual(a.esami.map((e) => [e.cod, e.descrizione]), [['E1', 'Esame dimostrativo E1']], 'la riga E2 cancellata non c\'è');
    assert.equal(a.lis_json.synclab.stato_label, 'Chiusa');
    assert.deepEqual(a.lis_json.synclab.campioni.map((c) => [c.barcode, c.material, c.container]), [['BC-001', 'SIERO', 'PROVETTA']]);
    assert.ok(a.data_accettazione);
    // punto SERVICE → Legal entity come sede inviante
    const s = await uno(`SELECT instance_id, id FROM synclab.requests WHERE request_number = '2026/0901'`);
    await D.importaDaSynclab(s.instance_id, s.id);
    const b = await uno(`SELECT sede_id, lis_json FROM nc.accettazioni WHERE id = '2026/0901'`);
    assert.equal(b.sede_id, -ID.org); assert.equal(b.lis_json.synclab.stato_label, 'In lavorazione');
    // client non abbinato: sede da assegnare, nessuna invenzione
    const n = await uno(`SELECT instance_id, id FROM synclab.requests WHERE request_number = '2026/0950'`);
    const on = await D.importaDaSynclab(n.instance_id, n.id);
    assert.equal(on.sede.come, 'DA_ASSEGNARE'); assert.equal((await uno(`SELECT sede_id FROM nc.accettazioni WHERE id = '2026/0950'`)).sede_id, null);
    const cp = await D.aggiornamentoCopia(); assert.equal(cp.accettazioni, 7);
  });

  test('produzione da Synclab: conteggio per struttura, mese ed esame; la riga MANUALE vince; righe STUDIOLAB superate tolte; idempotente', async () => {
    await db.query(`INSERT INTO orders.production (struttura_id, month, exam_code, exam_name, qty, source) VALUES ($1, '2026-10-01', 'E1', 'a mano', 99, 'MANUALE'), ($2, '2026-10-01', 'VECCHIO', 'HL7', 3, 'STUDIOLAB')`, [ID.sS, ID.sA]);
    const r = await M.ord.aggiornaProduzioneSynclab();
    assert.equal(r.manuali_mantenute, 1); assert.equal(r.rimosse, 1);
    assert.equal(r.dal, '2025-10'); assert.equal(r.al, '2026-11');
    const p = await tutti(`SELECT struttura_id, to_char(month, 'YYYY-MM') AS m, exam_code, qty, source FROM orders.production ORDER BY 1, 2, 3`);
    const q = (sid, m, e) => p.find((x) => x.struttura_id === sid && x.m === m && x.exam_code === e);
    assert.equal(q(ID.sA, '2026-10', 'E1').qty, 1); assert.equal(q(ID.sA, '2026-10', 'E2'), undefined, 'riga cancellata non contata');
    assert.equal(q(ID.sA, '2025-10', 'E1').qty, 1);
    assert.deepEqual([q(ID.sS, '2026-10', 'E1').qty, q(ID.sS, '2026-10', 'E1').source], [99, 'MANUALE']);
    assert.equal(q(ID.sS, '2026-10', 'E3').qty, 1); assert.equal(q(ID.sS, '2026-11', 'E1').qty, 2);
    assert.equal(q(ID.sA, '2026-10', 'VECCHIO'), undefined);
    assert.ok(!p.some((x) => x.exam_code === 'E1' && x.m === '2026-11' && x.struttura_id !== ID.sS), 'client non abbinato non contato');
    const r2 = await M.ord.aggiornaProduzioneSynclab();
    assert.deepEqual([r2.nuove, r2.aggiornate, r2.rimosse], [0, 0, 0]);
    const st = await M.ord.statoProduzioneSynclab();
    assert.equal(st.disponibile, true); assert.ok(st.ultimo.at); assert.equal(st.client_senza_struttura, 1);
    // consumo medio con le righe Synclab: Legal entity (chiave negativa) = produzione dei suoi punti service
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('TST', 'Prova') ON CONFLICT DO NOTHING`);
    ID.artX = (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label, pack_size) VALUES ('T-GIA', 'TST', 'Tappo Giallo prova', 'provette', 'conf. 100', 100) RETURNING id`)).id;
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ('E1', 'Esame 1', $1, 1)`, [ID.artX]);
    const cons = await M.sl.consumptionByArticle(-ID.org, 3);
    assert.equal(cons.months, 2); assert.equal(cons.map.get(ID.artX).units, (99 + 2) / 2);
  });

  test('etichette e proposta di correlazioni: anteprima (nuove, cambiano, conflitti), applicazione, MANUALE intatte', async () => {
    await M.ord.aggiornaEtichette();
    const el = await M.ord.elencoEtichette();
    const sp = el.find((c) => c.etichetta === 'PROVETTA');
    assert.ok(sp && sp.campioni === 7 && sp.esami >= 3, 'una riga per etichetta: 7 campioni PROVETTA');
    assert.equal(sp.materiali, 'SIERO 7', 'materiale solo informativo');
    let cp = await M.ord.etichettePerEsame();
    const e1 = cp.get('E1');
    assert.deepEqual([e1.etichetta, e1.materiale, e1.n, e1.tot, e1.pct, e1.descrizione], ['PROVETTA', 'SIERO', 6, 7, 85.7, 'Esame dimostrativo E1']);
    assert.equal(cp.get('E2'), undefined, 'solo righe non cancellate');
    // abbinamenti: etichetta PROVETTA → X, CONTENITORE STERILE → Y; E3 ha una correlazione MANUALE verso Z (conflitto); E5 una SYNCLAB verso Y (cambia)
    const artY = (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label) VALUES ('T-URI', 'TST', 'Contenitore urine prova', 'pezzi', 'conf.') RETURNING id`)).id;
    const artZ = (await uno(`INSERT INTO orders.articles (code, category_code, name, unit, pack_label) VALUES ('T-ALT', 'TST', 'Altro prova', 'pezzi', 'conf.') RETURNING id`)).id;
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'PROVETTA'`, [ID.artX]);
    await db.query(`UPDATE orders.etichette_synclab SET articolo_id = $1 WHERE chiave = 'CONTENITORE STERILE'`, [artY]);
    await db.query(`INSERT INTO orders.exam_mappings (exam_code, article_id, source) VALUES ('E3', $1, 'MANUALE'), ('E5', $2, 'SYNCLAB')`, [artZ, artY]);
    const pv = await M.ord.proponiCorrelazioni();
    assert.equal(pv.anteprima, true);
    const es = Object.fromEntries(pv.voci.map((v) => [v.exam_code, v.esito]));
    assert.deepEqual(es, { E1: 'COINCIDE', E3: 'CONFLITTO', E4: 'NUOVA', E5: 'CAMBIA' });
    assert.deepEqual([pv.sintesi.nuove, pv.sintesi.cambiano, pv.sintesi.conflitti], [1, 1, 1]);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM orders.exam_mappings`)).n, 3, 'l\'anteprima non scrive');
    const ap = await M.ord.proponiCorrelazioni({ conferma: true });
    assert.equal(ap.applicate, 2);
    const mm = await tutti(`SELECT exam_code, article_id, source FROM orders.exam_mappings ORDER BY exam_code, article_id`);
    assert.deepEqual(mm.map((x) => [x.exam_code, x.article_id, x.source]), [['E1', ID.artX, 'MANUALE'], ['E3', artZ, 'MANUALE'], ['E4', ID.artX, 'SYNCLAB'], ['E5', ID.artX, 'SYNCLAB']]);
    const pv2 = await M.ord.proponiCorrelazioni();
    assert.deepEqual([pv2.sintesi.nuove, pv2.sintesi.cambiano, pv2.sintesi.conflitti], [0, 0, 1]);
    cp = await M.ord.etichettePerEsame();
    assert.equal(cp.get('E3').articolo_id, artY, 'badge "diverso": la correlazione manuale di E3 non è l\'etichetta più frequente');
  });
});
