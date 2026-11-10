// Synclab Data API v1 (CB Sistemi, 09/11/2026): client, motore di sincronizzazione, copia locale e letture per Finance.
// Unica sorgente: il server finto test/helpers/fakeSynclab.mjs, costruito dai dati sintetici di CB Sistemi (esempi_sintetici.json).
// Nessun dato reale, nessuna password vera: quella del client finto è casuale a ogni esecuzione. Parte pura sempre; parte con database
// (DATABASE_URL_TEST, un database temporaneo suite_synclab_<pid> con le migrazioni core) solo se la variabile c'è.
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { creaFakeSynclab, datiIniziali, ESEMPI } from './helpers/fakeSynclab.mjs';
import * as CE from '../src/modules/finance/lib/contoEconomico.js';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ parte pura
describe('Synclab: regole pure', () => {
  test('scegliProduzione: SYNCLAB dopo la riga salvata a mano e prima di Retail e Ordini', () => {
    const synclab = { esami: 3, valore: 30, righe: [{ codice: 'GLU', quantita: 3, valore: 30 }], note: null };
    const retail = { esami: 5, valore: 50, righe: [{ codice: 'GLU', quantita: 5, valore: 50 }] };
    const ordini = { esami: 7, valore: null, righe: [{ codice: 'GLU', quantita: 7 }] };
    const p = CE.scegliProduzione({ synclab, retail, ordini });
    assert.equal(p.fonte, 'SYNCLAB'); assert.equal(p.origine, CE.ORIGINE_SYNCLAB); assert.match(p.origine, /produzione erogata/); assert.equal(p.esami, 3); assert.equal(p.stima, false);
    assert.equal(CE.scegliProduzione({ salvata: { id: 1, fonte: 'MANUALE', esami: 1, valore: 9 }, synclab, retail }).fonte, 'MANUALE');
    assert.equal(CE.scegliProduzione({ salvata: { id: 2, fonte: 'STIMA', esami: 1, valore: 9 }, synclab }).fonte, 'SYNCLAB');   // la stima salvata non prevale
    assert.equal(CE.scegliProduzione({ synclab: { esami: 0 }, retail }).origine, 'Retail: vendite B2B dal gestionale StudioLAB');
  });
  test('margine con fonte SYNCLAB: netti storici di riga, listino solo per le righe senza prezzo; documenti a parte', () => {
    const prod = CE.scegliProduzione({ synclab: { esami: 3, valore: 20, righe: [{ codice: 'GLU', quantita: 2, valore: 20 }, { codice: 'EMO', quantita: 1, valore: null }] } });
    const m = CE.margineCliente({ produzione: prod, listino: [{ codice: 'GLU', offerto: 99 }, { codice: 'EMO', offerto: 4 }], documenti: { fatturato: -10, documenti: 2 } });
    assert.equal(m.ricavo, 24); assert.equal(m.ricavo_da, 'SYNCLAB');                // 20 dal gestionale + 4 dal listino (non 2 × 99)
    assert.equal(m.fatturato_documenti, -10);                                         // mostrato, non sommato
    assert.equal(m.margine, 24);
    const senza = CE.margineCliente({ produzione: CE.scegliProduzione({ synclab: { esami: 1, valore: null, righe: [{ codice: 'X', quantita: 1, valore: null }] } }) });
    assert.match(senza.da_indicare.join(';'), /senza prezzo nel gestionale/);
  });
});

// ------------------------------------------------------------------ parte con database e server finto
describe('Synclab: sincronizzazione con il server finto', { skip: SALTA }, () => {
  const nomeDb = `suite_synclab_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const adminUrl = URL_TEST;
  let M = {};              // moduli della Suite (importati dopo DATABASE_URL)
  let fake, db, password;

  const adm = async (sql) => { const c = new pg.Client({ connectionString: adminUrl }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const dbUrl = () => { const m = adminUrl.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;

  /** Nuovo server finto, connettore puntato su di lui, copia locale vuota. */
  async function nuovo(opz = {}, settings = {}) {
    if (fake) await fake.chiudi();
    fake = creaFakeSynclab({ password, retryAfter: 2, polling: 1, ...opz });
    const base = await fake.avvia();
    M.conn.studiolabClientTokenReset();
    await db.query(`TRUNCATE synclab.sync_scope, synclab.sync_run, synclab.scope_records, synclab.run_visti, synclab.clients, synclab.exams, synclab.price_lists, synclab.price_list_items, synclab.requests,
      synclab.request_items, synclab.samples, synclab.invoices, synclab.invoice_items, synclab.request_invoices, synclab.request_item_invoices, synclab.request_item_samples, synclab.client_map CASCADE`);
    await db.query(`UPDATE public.connectors SET settings = '{}'::jsonb WHERE kind = 'STUDIOLAB'`);
    await M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: base, auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password }, settings: { data_api_enabled: true, ...settings } }, null);
    return fake;
  }
  const scope = (dataset) => uno(`SELECT * FROM synclab.sync_scope WHERE dataset=$1 ORDER BY id DESC LIMIT 1`, [dataset]);

  before(async () => {
    password = `Fz${crypto.randomBytes(6).toString('base64url')}!9`;
    await adm(`CREATE DATABASE ${nomeDb}`);
    process.env.DATABASE_URL = dbUrl();
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    M.conn = await import('../src/lib/connectors.js');
    await M.conn.loadConnectors();
    M.api = await import('../src/lib/synclab/client.js');
    M.sync = await import('../src/lib/synclab/sync.js');
    M.pers = await import('../src/lib/synclab/persistenza.js');
    M.let = await import('../src/lib/synclab/letture.js');
    M.db = await import('../src/db.js');
    M.api.configura({ scalaAttese: 0.002, chiamateAlMinuto: 100000 });
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
  }, { timeout: 180000 });
  after(async () => {
    await fake?.chiudi();
    await db?.end().catch(() => {});
    await M.db?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('login e rinnovo: la cache usa il validTo restituito; 401 → nuovo login e stessa richiesta con lo stesso cursor', async () => {
    await nuovo({ validitaS: 900 });
    await M.api.metadata(); await M.api.metadata();
    assert.equal(fake.stato.logins, 1, 'token valido 15 minuti: un solo login');
    await nuovo({ validitaS: 100 });   // scade fra meno di 2 minuti: ogni chiamata rinnova
    await M.api.metadata(); await M.api.metadata();
    assert.equal(fake.stato.logins, 2, 'token in scadenza: login a ogni chiamata');
    // 401 a metà di una cattura: login nuovo e ripetizione con lo stesso cursor
    await nuovo({ validitaS: 900, polling: 0 });
    const r0 = await M.api.pagina('exams', { pageSize: 10 });
    assert.equal(r0.status, 202);
    const prima = fake.stato.logins;
    fake.stato.invalidaTokens = true;
    const r1 = await M.api.pagina('exams', { pageSize: 10, cursor: r0.nextCursor });
    assert.equal(r1.status, 200);
    assert.equal(fake.stato.logins, prima + 1);
    const ult = fake.richiesteDati().slice(-2);
    assert.equal(ult[0].query.cursor, r0.nextCursor); assert.deepEqual(ult[0].query, ult[1].query, 'stessa richiesta ripetuta');
    assert.match(ult[1].ua, /^TD-Suite\//);
    // nessun token né cursore nel registro delle chiamate
    const log = await tutti(`SELECT endpoint, message FROM public.connector_log WHERE module IN ('synclab','core')`);
    for (const l of log) { assert.doesNotMatch(`${l.endpoint} ${l.message}`, /TOKEN-FINTO|cursor=|since=|password/i); }
  });

  test('202 con Retry-After: polling con lo stesso cursor (codificato) fino alla pagina; attesa registrata nel run', async () => {
    await nuovo({ polling: 2, retryAfter: 2 });
    const r = await M.sync.eseguiCiclo('exams');
    assert.equal(r.esito, 'OK'); assert.equal(r.tipo, 'COMPLETO'); assert.equal(r.prima_importazione, true);
    const q = fake.richiesteDati().filter((x) => x.path === '/api/v1/data/exams');
    assert.equal(q[0].query.cursor, undefined, 'prima richiesta senza cursor');
    assert.equal(q.length, 4, '202 iniziale, due 202 di polling, pagina');
    assert.ok(q[1].query.cursor.includes('='), 'cursore con caratteri da codificare arrivato intatto');
    assert.equal(q[1].query.cursor, q[2].query.cursor); assert.equal(q[2].query.cursor, q[3].query.cursor);
    const run = await uno('SELECT * FROM synclab.sync_run WHERE id=$1', [r.run_id]);
    assert.equal(run.attesa_ms, 6000);
    assert.equal(Number((await uno(`SELECT count(*) FROM synclab.exams`)).count), 1);
  });

  test('tre pagine: syncToken solo all\'ultima, checkpoint confermato solo dopo il commit; pagina ripetuta idempotente', async () => {
    await nuovo({ dati: datiIniziali({ copie: 2 }) }, { page_size: 1 });
    const visti = [];
    let rompi = true;
    // l'ultima pagina fallisce prima del commit: niente checkpoint, la pagina resta in sospeso
    const prova = {
      dopoCommit: async (p) => { const s = await scope('requests'); visti.push({ pagine: p.pagine_fatte, checkpoint: s.checkpoint, sospeso: Boolean(s.pagina_in_sospeso) }); },
      primaDelCommit: async (p) => { if (p.pagine_fatte === 2 && rompi) { rompi = false; throw new Error('arresto simulato prima del commit'); } },
    };
    await assert.rejects(M.sync.eseguiCiclo('requests', { prova }), /arresto simulato/);
    let s = await scope('requests');
    assert.equal(s.checkpoint, null, 'nessun checkpoint dopo il fallimento dell\'ultima pagina');
    assert.equal(s.pagina_in_sospeso.pagine_fatte, 2);
    assert.deepEqual(visti.map((v) => [v.pagine, v.checkpoint, v.sospeso]), [[1, null, true], [2, null, true]]);
    const r = await M.sync.eseguiCiclo('requests', { prova });
    assert.equal(r.esito, 'OK'); assert.equal(r.pagine, 3); assert.equal(r.record, 3);
    s = await scope('requests');
    assert.ok(s.checkpoint, 'checkpoint confermato'); assert.equal(s.pagina_in_sospeso, null);
    // syncToken solo nell'ultima risposta del server finto: il checkpoint è quello
    assert.match(s.checkpoint, /^CHECKPOINT:requests:/);
    assert.equal(Number((await uno('SELECT count(*) FROM synclab.requests')).count), 3);
    assert.equal(Number((await uno('SELECT count(*) FROM synclab.request_items')).count), 3);
    // pagina ripetuta: stesso risultato
    const istanza = s.instance_id;
    const foto = async () => JSON.stringify(await tutti(`SELECT r.id, r.request_number, r.source_amount::text, i.exam_code, i.net_unit_price_excluding_vat::text, (SELECT count(*) FROM synclab.request_item_samples x WHERE x.request_id = r.id) AS camp
      FROM synclab.requests r JOIN synclab.request_items i ON i.request_id = r.id ORDER BY r.id, i.ord`));
    const a = await foto();
    let pg0 = await M.api.pagina('requests', { pageSize: 10 });
    while (pg0.status === 202) pg0 = await M.api.pagina('requests', { pageSize: 10, cursor: pg0.nextCursor });
    const p2 = pg0.data;
    assert.equal(p2.items.length, 3);
    for (let k = 0; k < 2; k++) await M.db.tx(async (c) => { for (const it of p2.items) await M.pers.upsertAggregato(c, { instanceId: istanza, dataset: 'requests', d: it, capturedAt: p2.capturedAt }); });
    assert.equal(await foto(), a);
  });

  test('arresto fra commit e avanzamento: la ripresa continua dalla pagina in sospeso senza una nuova cattura', async () => {
    await nuovo({ dati: datiIniziali({ copie: 2 }) }, { page_size: 1 });
    let rompi = true;
    await assert.rejects(M.sync.eseguiCiclo('requests', { prova: { dopoCommit: async (p) => { if (p.pagine_fatte === 2 && rompi) { rompi = false; throw new Error('processo fermato'); } } } }), /processo fermato/);
    const s = await scope('requests');
    assert.equal(s.pagina_in_sospeso.pagine_fatte, 2); assert.ok(s.pagina_in_sospeso.cursor); assert.equal(s.checkpoint, null);
    const run = await uno('SELECT * FROM synclab.sync_run ORDER BY id DESC LIMIT 1');
    assert.equal(run.esito, 'ERRORE');
    const n = fake.richiesteDati().length;
    const r = await M.sync.eseguiCiclo('requests');
    assert.equal(r.esito, 'OK'); assert.equal(r.run_id, run.id, 'stesso run ripreso'); assert.equal(r.pagine, 3);
    const dopo = fake.richiesteDati().slice(n).filter((x) => x.path === '/api/v1/data/requests');
    assert.equal(dopo.length, 1, 'una sola richiesta: la terza pagina');
    assert.equal(dopo[0].query.cursor, s.pagina_in_sospeso.cursor);
  });

  test('delta: upsert con un figlio modificato e uno rimosso dalla nuova versione (sostituzione, non aggiunta)', async () => {
    await nuovo();
    await M.sync.eseguiCiclo('requests');
    const base = copia(ESEMPI.optInRequest); delete base.patient;
    const v2 = copia(base); v2.items = [{ ...v2.items[0], netUnitPriceExcludingVat: 9.5 }, { ...v2.items[0], id: '12346', examCode: 'AZO', invoiceIds: [], sampleIds: [] }];
    fake.cambia('requests', { id: base.id, revision: 'R2', operation: 'upsert', reason: null, data: v2 });
    let r = await M.sync.eseguiCiclo('requests');
    assert.equal(r.tipo, 'DELTA'); assert.equal(r.conteggi.upsert, 1);
    assert.deepEqual((await tutti('SELECT id, exam_code, net_unit_price_excluding_vat::text AS p FROM synclab.request_items ORDER BY ord')).map((x) => [x.id, x.exam_code, x.p]), [['12345', 'GLU', '9.5'], ['12346', 'AZO', '10']]);
    const v3 = copia(base); v3.items = [{ ...base.items[0], id: '12346', examCode: 'AZO', invoiceIds: [], sampleIds: [] }];
    fake.cambia('requests', { id: base.id, revision: 'R3', operation: 'upsert', reason: null, data: v3 });
    r = await M.sync.eseguiCiclo('requests');
    const righe = await tutti('SELECT id, exam_code FROM synclab.request_items');
    assert.deepEqual(righe.map((x) => x.id), ['12346'], 'la riga 12345 assente dalla nuova versione è sparita');
    assert.equal(Number((await uno(`SELECT count(*) FROM synclab.request_item_samples WHERE item_id='12345'`)).count), 0);
    // stessa revisione ripresentata: non si riapplica
    fake.cambia('requests', { id: base.id, revision: 'R3', operation: 'upsert', reason: null, data: v3 });
    r = await M.sync.eseguiCiclo('requests');
    assert.equal(r.conteggi.gia_applicati, 1);
  });

  test('delta: le quattro operazioni (upsert, remove/excluded_state, archived, unavailable)', async () => {
    await nuovo({ dati: datiIniziali({ copie: 3 }) });
    await M.sync.eseguiCiclo('requests');
    const ids = (await tutti('SELECT id FROM synclab.requests ORDER BY id')).map((x) => x.id);
    assert.equal(ids.length, 4);
    const [a, b, c, d] = ids;
    const da = copia(fake.stato.dati.requests.find((x) => x.id === a)); da.sourceAmount = 11;
    fake.cambia('requests', { id: a, revision: 'U1', operation: 'upsert', reason: null, data: da });
    fake.cambia('requests', { id: b, revision: 'X1', operation: 'remove', reason: 'excluded_state', data: null });
    fake.cambia('requests', { id: c, revision: 'A1', operation: 'archived', reason: 'confirmed_archive', data: null });
    fake.cambia('requests', { id: d, revision: 'I1', operation: 'unavailable', reason: 'source_exit_unknown', data: null });
    for (const ch of ESEMPI.changes.slice(1)) fake.cambia('requests', ch);   // uscite degli esempi su id mai importati: nessun errore
    const r = await M.sync.eseguiCiclo('requests');
    assert.deepEqual([r.conteggi.upsert, r.conteggi.remove, r.conteggi.archived, r.conteggi.unavailable], [1, 2, 2, 2]);
    const st = Object.fromEntries((await tutti('SELECT id, disponibilita, deleted_at IS NOT NULL AS del, source_amount::text AS amt, (SELECT count(*)::int FROM synclab.request_items i WHERE i.request_id = r.id) AS righe FROM synclab.requests r')).map((x) => [x.id, x]));
    assert.equal(st[a].disponibilita, 'ATTIVO'); assert.equal(st[a].amt, '11');
    assert.equal(st[b].disponibilita, 'RIMOSSO_STATO_ESCLUSO'); assert.equal(st[b].del, true); assert.equal(st[b].righe, 0, 'figli tolti solo per excluded_state');
    assert.equal(st[c].disponibilita, 'ARCHIVIATO'); assert.equal(st[c].righe, 1, 'archivio: contenuto conservato');
    assert.equal(st[d].disponibilita, 'USCITA_INCERTA'); assert.equal(st[d].righe, 1); assert.equal(st[d].del, false);
    assert.equal(Number((await uno('SELECT count(*) FROM synclab.requests')).count), 4, 'nessuna riga cancellata');
  });

  test('due ambiti con filtri diversi: out_of_scope toglie il record da un ambito senza cancellarlo nell\'altro', async () => {
    await nuovo();
    await M.sync.eseguiCiclo('requests', { filtri: { operatingCompany: 'LAB' } });
    await M.sync.eseguiCiclo('requests', { filtri: {} });
    assert.equal(Number((await uno('SELECT count(*) FROM synclab.sync_scope WHERE dataset=$1', ['requests'])).count), 2);
    const id = ESEMPI.optInRequest.id;
    fake.cambia('requests', { id, revision: 'O1', operation: 'remove', reason: 'out_of_scope', data: null }, { filtro: (q) => q.operatingCompany === 'LAB' });
    const r = await M.sync.eseguiCiclo('requests', { filtri: { operatingCompany: 'LAB' } });
    assert.equal(r.conteggi.fuori_ambito, 1);
    const mem = await tutti(`SELECT s.filtri_canonici, r.stato FROM synclab.scope_records r JOIN synclab.sync_scope s ON s.id = r.scope_id WHERE r.id = $1 ORDER BY s.id`, [id]);
    assert.deepEqual(mem.map((x) => [x.filtri_canonici, x.stato]), [[{ operatingCompany: 'LAB' }, 'FUORI_AMBITO'], [{}, 'ATTIVO']]);
    const rq = await uno('SELECT disponibilita, (SELECT count(*)::int FROM synclab.request_items WHERE request_id = $1) AS righe FROM synclab.requests WHERE id=$1', [id]);
    assert.equal(rq.disponibilita, 'ATTIVO', 'ancora attivo per l\'altro ambito'); assert.equal(rq.righe, 1);
    // l'altro ambito non vede il cambio: delta vuoto
    const r2 = await M.sync.eseguiCiclo('requests', { filtri: {} });
    assert.equal(r2.record, 0);
  });

  test('409 full_sync_required: completo fuso con la copia, /sync/status a blocchi di 200, nessuna cancellazione per assenza', async () => {
    await nuovo({ dati: datiIniziali({ copie: 3 }) });
    await M.sync.eseguiCiclo('requests');
    const [a, b, c, d] = (await tutti('SELECT id FROM synclab.requests ORDER BY id')).map((x) => x.id);
    // nella sorgente b, c, d non ci sono più (senza delta); /sync/status dice archived, excluded_state, available fuori filtro... e un nuovo record
    fake.stato.dati.requests = fake.stato.dati.requests.filter((x) => x.id === a);
    const nuovoReq = copia(ESEMPI.optInRequest); nuovoReq.id = 'NUOVO-DEMO'; nuovoReq.requestNumber = '2026/999'; fake.stato.dati.requests.push(nuovoReq);
    fake.statoId('requests', b, 'archived', 'confirmed_archive');
    fake.statoId('requests', c, 'remove', 'excluded_state');
    fake.forza409('requests', 'full_sync_required');
    const r = await M.sync.eseguiCiclo('requests');
    assert.equal(r.esito, 'OK'); assert.equal(r.tipo, 'RICONCILIAZIONE'); assert.equal(r.conteggi.verificati, 3);
    const st = Object.fromEntries((await tutti('SELECT id, disponibilita, (SELECT count(*)::int FROM synclab.request_items i WHERE i.request_id = r.id) AS righe FROM synclab.requests r')).map((x) => [x.id, x]));
    assert.equal(st[a].disponibilita, 'ATTIVO'); assert.equal(st['NUOVO-DEMO'].disponibilita, 'ATTIVO');
    assert.equal(st[b].disponibilita, 'ARCHIVIATO'); assert.equal(st[b].righe, 1);
    assert.equal(st[c].disponibilita, 'RIMOSSO_STATO_ESCLUSO'); assert.equal(st[c].righe, 0);
    assert.equal(st[d].disponibilita, 'USCITA_INCERTA', 'assente e non riconosciuto: uscita incerta, contenuto conservato'); assert.equal(st[d].righe, 1);
    const runs = await tutti(`SELECT tipo, esito FROM synclab.sync_run ORDER BY id`);
    assert.deepEqual(runs.map((x) => `${x.tipo}:${x.esito}`), ['COMPLETO:OK', 'DELTA:INTERROTTO', 'RICONCILIAZIONE:OK']);
    // blocchi di 200
    const prima = fake.richiesteDati().length;
    const ids = Array.from({ length: 450 }, (_, i) => `ID-${i}`);
    const out = await M.api.stato('requests', ids);
    assert.equal(out.length, 450);
    const blocchi = fake.richiesteDati().slice(prima).filter((x) => x.path === '/api/v1/data/sync/status');
    assert.deepEqual(blocchi.map((x) => x.ids.length), [200, 200, 50]);
  });

  test('429 e 503: attesa e ripetizione; 503 persistente = cattura fallita, nessun checkpoint, ripartenza dal confermato', async () => {
    await nuovo();
    fake.inietta(429, { volte: 1, retryAfter: 1, path: '/api/v1/data/exams' });
    fake.inietta(500, { volte: 1, path: '/api/v1/data/exams' });
    let r = await M.sync.eseguiCiclo('exams');
    assert.equal(r.esito, 'OK');
    const errori = (await tutti(`SELECT status FROM public.connector_log WHERE module='synclab' AND status IN ('429','500')`)).map((x) => x.status).sort();
    assert.deepEqual(errori, ['429', '500']);
    const cp = (await scope('exams')).checkpoint;
    // 503 su tutte le ripetizioni durante il polling del delta: errore, checkpoint invariato, nessuna pagina in sospeso
    fake.inietta(503, { volte: 5, path: '/api/v1/data/sync/changes', quando: (_u, q) => Boolean(q.cursor) });
    await assert.rejects(M.sync.eseguiCiclo('exams'), (e) => e.tipo === 'CATTURA_FALLITA' && e.status === 503);
    const s = await scope('exams');
    assert.equal(s.checkpoint, cp); assert.equal(s.pagina_in_sospeso, null); assert.equal(s.ultimo_esito.stato, 'ERRORE');
    fake.stato.iniezioni = [];
    r = await M.sync.eseguiCiclo('exams');
    assert.equal(r.tipo, 'DELTA'); assert.equal(r.esito, 'OK');
  });

  test('null e precisione: 12.5, 20, 10 restano tali; null ≠ 0; decimali oltre il double conservati', async () => {
    await nuovo();
    await M.sync.eseguiCiclo('price-lists');
    const it = await uno(`SELECT gross_unit_price_excluding_vat::text AS g, discount_percent::text AS s, net_unit_price_excluding_vat::text AS n, vat_rate, vat_amount, vat_code, vat_treatment FROM synclab.price_list_items`);
    assert.deepEqual([it.g, it.s, it.n], ['12.5', '20', '10']);
    assert.equal(it.vat_rate, null); assert.equal(it.vat_amount, null); assert.equal(it.vat_code, null); assert.equal(it.vat_treatment, 'not_available');
    const d = M.api.parsePreciso('{"id":"PRECISO","code":"P","items":[{"id":"r1","grossUnitPriceExcludingVat":0.12345678901234567890123,"discountPercent":null,"netUnitPriceExcludingVat":1e2}],"type":1,"state":10,"active":true}');
    await M.db.tx((c) => M.pers.upsertAggregato(c, { instanceId: 'X', dataset: 'price-lists', d }));
    const p = await uno(`SELECT gross_unit_price_excluding_vat::text AS g, discount_percent, net_unit_price_excluding_vat::text AS n, raw->>'grossUnitPriceExcludingVat' AS rg FROM synclab.price_list_items WHERE price_list_id='PRECISO'`);
    assert.equal(p.g, '0.12345678901234567890123'); assert.equal(p.rg, '0.12345678901234567890123'); assert.equal(p.discount_percent, null); assert.equal(Number(p.n), 100);
  });

  test('documenti: nota di credito manuale -10 sommata una volta (nessuna doppia inversione), annullati a zero, tipo sconosciuto escluso', async () => {
    const dati = datiIniziali();
    const annullata = copia(ESEMPI.invoice); annullata.id = 'ANNULLATA-DEMO'; annullata.cancelled = true; annullata.netRevenueContribution = 0; annullata.date = '2026-07-20';
    const ignota = copia(ESEMPI.invoice); ignota.id = 'IGNOTA-DEMO'; ignota.documentType = 'unknown'; ignota.netRevenueContribution = null; ignota.date = '2026-07-21';
    dati.invoices.push(annullata, ignota);
    await nuovo({ dati });
    await M.sync.eseguiCiclo('invoices');
    const f = await M.let.fatturatoMensile({ client_id: ESEMPI.client.id, mese: '2026-07' });
    assert.equal(f.fatturato, 0, '10 - 10 + 0: la NC non è invertita di nuovo');
    assert.equal(f.documenti, 4); assert.equal(f.note_credito, 1); assert.equal(f.annullati_proforma, 1); assert.equal(f.tipo_sconosciuto, 1);
    assert.match(f.note, /tipo sconosciuto/);
    const nc = await uno(`SELECT net_revenue_contribution::text AS c, total::text AS t, (SELECT net_amount_excluding_vat::text FROM synclab.invoice_items WHERE invoice_id = v.id) AS riga FROM synclab.invoices v WHERE id = $1`, [ESEMPI.manualCreditNote.id]);
    assert.deepEqual([nc.c, nc.t, nc.riga], ['-10', '-12.2', '-10']);
    assert.equal((await M.let.fatturatoMensile({ client_id: ESEMPI.client.id, mese: '2026-08' })).fatturato, null, 'nessun documento: null, non zero');
    // legami 0..N salvati anche dal lato del documento
    assert.equal(Number((await uno(`SELECT count(*) FROM synclab.request_invoices WHERE lato='INVOICE' AND request_id=$1`, [ESEMPI.standardRequest.id])).count), 4);
  });

  test('proiezione paziente: per default nessuna colonna paziente valorizzata; opt-in esplicito le valorizza; spegnerla le svuota', async () => {
    await nuovo();
    await M.sync.eseguiCiclo('requests');
    let r = await uno(`SELECT patient_id, patient_last_name, patient_first_name, patient_birth_date, patient_fiscal_code, raw ? 'patient' AS rawp, dem_age_years, dem_sex FROM synclab.requests`);
    assert.deepEqual([r.patient_id, r.patient_last_name, r.patient_first_name, r.patient_birth_date, r.patient_fiscal_code, r.rawp], [null, null, null, null, null, false]);
    assert.equal(r.dem_age_years, 42); assert.equal(r.dem_sex, 'F');
    assert.equal((await uno('SELECT historical_description FROM synclab.request_items')).historical_description, null);
    assert.equal(fake.richiesteDati().find((x) => x.path === '/api/v1/data/requests').query.includePatient, 'false');
    // opt-in dalle impostazioni del connettore
    await M.sync.salvaImpostazioni({ include_patient: true });
    await M.sync.eseguiCiclo('requests');
    r = await uno(`SELECT patient_last_name IS NOT NULL AS cognome, patient_fiscal_code IS NOT NULL AS cf, (SELECT historical_description IS NOT NULL FROM synclab.request_items LIMIT 1) AS storica FROM synclab.requests`);
    assert.deepEqual([r.cognome, r.cf, r.storica], [true, true, true]);
    const scopes = await tutti(`SELECT include_patient FROM synclab.sync_scope WHERE dataset='requests' ORDER BY id`);
    assert.deepEqual(scopes.map((x) => x.include_patient), [false, true], 'ambito distinto per la proiezione');
    const out = await M.sync.salvaImpostazioni({ include_patient: false });
    assert.equal(out.svuotati.accettazioni, 1);
    r = await uno(`SELECT patient_last_name, raw ? 'patient' AS rawp, (SELECT historical_description FROM synclab.request_items LIMIT 1) AS storica FROM synclab.requests`);
    assert.deepEqual([r.patient_last_name, r.rawp, r.storica], [null, false, null]);
  });

  test('produzioneMensile e fatturatoMensile per Legal entity (abbinamento dal codice StudioLAB della sede) e controllo D48', async () => {
    const dati = datiIniziali();
    const r2 = copia(ESEMPI.optInRequest); r2.id = 'SECONDA-DEMO'; r2.headerDiscountPercent = 5;
    r2.items = [{ ...r2.items[0], id: 'a1', netUnitPriceExcludingVat: 7.25 }, { ...r2.items[0], id: 'a2', netUnitPriceExcludingVat: null }, { ...r2.items[0], id: 'a3', deleted: true }];
    dati.requests.push(r2);
    await nuovo({ dati });
    for (const ds of ['clients', 'requests', 'invoices']) await M.sync.eseguiCiclo(ds);
    // senza Legal entity: il client è "da abbinare" (D48)
    const { esegui } = await import('../src/lib/diagnostica.js');
    let k = (await esegui({ ids: ['D48', 'D49', 'D50'] }));
    const by = Object.fromEntries(k.map((x) => [x.id, x]));
    assert.equal(by.D48.n, 1); assert.equal(by.D49.stato, 'ATTENZIONE');   // price-lists ed exams mai sincronizzati
    assert.deepEqual(by.D49.righe.map((x) => x.dataset).sort(), ['exams', 'price-lists']);
    assert.equal(by.D50.stato, 'OK');
    const org = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE','TSYN','Cliente Synclab di prova') RETURNING id`);
    await db.query(`INSERT INTO public.sites (code, name, kind, organization_id, studiolab_code) VALUES ('T-SYN','Service Synclab di prova','SERVICE',$1,'cliente-demo')`, [org.id]);
    const td = await uno('SELECT stato_abbinamento, regola_proposta, organization_id, perimetro_b2b FROM synclab.clients_td');
    assert.deepEqual([td.stato_abbinamento, td.regola_proposta, td.organization_id], ['PROPOSTO', 'CODICE_STUDIOLAB', org.id]);
    assert.equal(td.perimetro_b2b, false, 'non è un cliente attivo del Business Hub: fuori dal perimetro B2B calcolato');
    k = await esegui({ ids: ['D48'] }); assert.equal(k[0].stato, 'OK');
    const p = await M.let.produzioneMensile({ organization_id: org.id, mese: '2026-07' });
    assert.equal(p.esami, 3, 'righe non cancellate delle accettazioni attive: 1 + 2');
    // v0.68.5: produzione erogata = netto di riga × quantità × (1 − sconto di testata), una volta: 10 + 7,25 × 0,95 = 16,8875
    assert.equal(p.valore, 16.8875, 'netti di riga con lo sconto di testata del 5% applicato una volta; la riga senza prezzo non conta');
    assert.equal(p.righe_senza_prezzo, 1); assert.match(p.note, /senza prezzo/); assert.match(p.note, /sconto di testata \(5%\): applicato una volta/);
    assert.equal(p.sconto_testata.accettazioni, 1);
    assert.deepEqual(await M.let.produzioneMensile({ client_id: ESEMPI.client.id, mese: '2026-07' }).then((x) => [x.esami, x.valore]), [3, 16.8875]);
    const f = await M.let.fatturatoMensile({ organization_id: org.id, mese: '2026-07' });
    assert.equal(f.fatturato, 0); assert.equal(f.documenti, 2);
    const mappa = await M.let.produzionePerOrg([org.id], '2026-07-01', '2026-07-31');
    assert.equal(mappa.get(`${org.id}|2026-07`).esami, 3);
    // scegliProduzione con la fonte SYNCLAB su dati veri della copia
    const prod = CE.scegliProduzione({ synclab: mappa.get(`${org.id}|2026-07`), retail: { esami: 99, valore: 1 } });
    assert.equal(prod.fonte, 'SYNCLAB'); assert.equal(prod.valore, 16.89, 'arrotondato ai centesimi dal conto economico');
  });

  test('Prova connessione: metadati della Data API; il 403 di /auth/client/info non è un errore', async () => {
    await nuovo();
    const r = await M.conn.testConnector('STUDIOLAB');
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /istanza ISTANZA-DIMOSTRATIVA/); assert.match(r.message, /ruolo DataAPI: info non disponibile, metadati ok/);
    assert.equal(r.metadata.maxPageSize, 500); assert.equal(r.metadata.deltaWindowDays, 30);
  });

  test('ciclo notturno: solo con la Data API accesa, dopo l\'ora impostata, una volta al giorno', () => {
    const imp = { data_api_enabled: true, sync_ora: '02:30' };
    assert.equal(M.sync.daEseguire({ imp: { ...imp, data_api_enabled: false }, stato: null, ora: '03:00', oggi: '2026-11-10' }).esegui, false);
    assert.equal(M.sync.daEseguire({ imp, stato: null, ora: '02:15', oggi: '2026-11-10' }).esegui, false);
    assert.equal(M.sync.daEseguire({ imp, stato: null, ora: '02:30', oggi: '2026-11-10' }).esegui, true);
    assert.equal(M.sync.daEseguire({ imp, stato: { data: '2026-11-10', esito: 'OK' }, ora: '05:00', oggi: '2026-11-10' }).esegui, false);
    assert.equal(M.sync.daEseguire({ imp, stato: { data: '2026-11-10', esito: 'ERRORE', tentativi: 1 }, ora: '05:00', oggi: '2026-11-10' }).esegui, true);
    assert.equal(M.sync.daEseguire({ imp, stato: { data: '2026-11-10', esito: 'ERRORE', tentativi: 3 }, ora: '05:00', oggi: '2026-11-10' }).esegui, false);
  });
});
