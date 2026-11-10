// v0.68.1 (richieste del CEO del 09/11/2026 sera): A) Business Hub ↔ Synclab (pro quota, run rate, semaforo, correlazione per account,
// D51); B) Conto economico senza stime nelle somme (scegliProduzione → margine → movimenti → componiConto: il totale esclude la stima);
// C) Cockpit a schermo unico (somma B2C + B2B, TOP 5 con quota e variazione, schermo calcolato con Synclab e GIPO sintetici); D) Room:
// vista professionisti_v (esterno con ruolo Accettazione dentro, referente senza niente fuori), aggancio per person_id (buildNetwork) e
// D52. Dati solo sintetici (forma degli esempi di CB Sistemi, test/helpers/fakeSynclab.mjs); nessun nome reale.
// Parte pura sempre; parte con database (DATABASE_URL_TEST, database temporaneo suite_v681_<pid>) solo se la variabile c'è.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_v681_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', 'web', 'src');
const copia = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ A. pro quota, run rate, semaforo (puri)
describe('A · Business Hub ↔ Synclab: regole pure', () => {
  let S;
  before(async () => { S = await import('../src/modules/business/lib/synclabAccount.js'); });

  test('giorni lavorativi lun-ven e pro quota: avvio precedente = dal 1° gennaio, avvio nell\'anno, avvio futuro', () => {
    assert.equal(S.giorniLavorativi('2026-11-02', '2026-11-08'), 5);   // lunedì-domenica
    assert.equal(S.giorniLavorativi('2026-11-09', '2026-11-09'), 1);
    const gennaio = S.giorniLavorativi('2026-01-01', '2026-11-09');
    const pq = S.proQuota({ fatturato_fy_atteso: 100000, avvio: '2025-05-01', oggi: '2026-11-09', giorniAnno: 250 });
    assert.equal(pq.inizio, '2026-01-01'); assert.equal(pq.giorni, gennaio);
    assert.equal(pq.importo, Math.round(100000 * Math.min(1, gennaio / 250) * 100) / 100);
    assert.match(pq.nota, /avvio precedente: dal 1° gennaio/);
    const sett = S.proQuota({ fatturato_fy_atteso: 50000, avvio: '2026-09-01', oggi: '2026-11-09' });
    assert.equal(sett.inizio, '2026-09-01'); assert.equal(sett.giorni, S.giorniLavorativi('2026-09-01', '2026-11-09'));
    assert.equal(sett.importo, Math.round(50000 * (sett.giorni / 250) * 100) / 100);
    assert.equal(S.proQuota({ fatturato_fy_atteso: 50000, avvio: '2026-12-01', oggi: '2026-11-09' }).importo, 0, 'avvio futuro: nessun pro quota');
    assert.equal(S.proQuota({ fatturato_fy_atteso: null, oggi: '2026-11-09' }), null, 'senza dichiarato niente pro quota');
    assert.equal(S.proQuota({ fatturato_fy_atteso: 1000, oggi: '2026-11-09' }).inizio, '2026-01-01', 'senza data di avvio dal 1° gennaio');
  });

  test('run rate: ultimi 3 mesi pieni × 12; con 2 mesi la nota; con 1 non calcolabile', () => {
    const mensile = { '2026-07': 900, '2026-08': 1000, '2026-09': 2000, '2026-10': 3000, '2026-11': 50 };
    const r = S.runRate({ mensile, inizio: '2026-07-01', oggi: '2026-11-09', fatturato_fy_atteso: 30000 });
    assert.deepEqual(r.mesi, ['2026-08', '2026-09', '2026-10'], 'novembre è in corso: non è pieno');
    assert.equal(r.media_mensile, 2000); assert.equal(r.importo, 24000); assert.equal(r.anno, 2027);
    assert.equal(r.scostamento, -6000); assert.equal(r.scostamento_pct, -20);
    const due = S.runRate({ mensile, inizio: '2026-08-15', oggi: '2026-11-09', fatturato_fy_atteso: 30000 });
    assert.deepEqual(due.mesi, ['2026-09', '2026-10'], 'agosto non è pieno: avvio a metà mese');
    assert.equal(due.importo, 30000); assert.match(due.nota, /Solo 2 mesi pieni/);
    const uno = S.runRate({ mensile, inizio: '2026-10-01', oggi: '2026-11-09' });
    assert.equal(uno.calcolabile, false); assert.equal(uno.importo, null); assert.match(uno.nota, /Un solo mese pieno/);
    assert.equal(S.runRate({ mensile, inizio: null, oggi: '2026-11-09' }).calcolabile, false);
  });

  test('semaforo: verde entro ±10% (e sopra), giallo fino a −25%, rosso oltre', () => {
    assert.deepEqual([S.semaforo(12), S.semaforo(-10), S.semaforo(-10.1), S.semaforo(-25), S.semaforo(-25.1), S.semaforo(null)], ['VERDE', 'VERDE', 'GIALLO', 'GIALLO', 'ROSSO', null]);
  });

  test('confronto di un account con fixture: maturato (produzione erogata, v0.68.5), pro quota, scostamento, ultimo mese, run rate', () => {
    // v0.68.5: il maturato è la PRODUZIONE EROGATA (prod); i documenti emessi (fat) sono un dato secondario, mai sommato
    const prod = new Map([['2026-08', { valore: 1000, esami: 10 }], ['2026-09', { valore: 2000, esami: 20 }], ['2026-10', { valore: 3000, esami: 40, accettazioni: 30 }], ['2026-11', { valore: 500, esami: 5 }]]);
    const fat = new Map([['2026-10', { fatturato: 2800, documenti: 1 }], ['2026-11', { fatturato: 450, documenti: 2, note_credito: 1 }]]);
    const c = S.confronta({ account: { fatturato_fy_atteso: 36000, data_avvio_effettiva: '2026-08-01' }, fat, prod, oggi: '2026-11-09' });
    assert.equal(c.maturato, 6500); assert.equal(c.grandezza, 'PRODUZIONE_EROGATA');
    assert.equal(c.documenti_emessi.importo, 3250, 'documenti emessi a parte'); assert.equal(c.documenti, 3);
    assert.equal(c.pro_quota.inizio, '2026-08-01');
    assert.equal(c.scostamento, Math.round((6500 - c.pro_quota.importo) * 100) / 100);
    assert.equal(c.semaforo, S.semaforo(c.scostamento_pct));
    assert.equal(c.ultimo_mese.mese, '2026-11'); assert.equal(c.ultimo_mese.in_corso, true);
    assert.deepEqual([c.produzione.esami, c.produzione.valore], [75, 6500]);
    assert.equal(c.run_rate.importo, 24000, '(1000 + 2000 + 3000) / 3 × 12');
    assert.equal(c.run_rate.scostamento_pct, -33.3);
  });
});

// ------------------------------------------------------------------ B. conto economico senza stime (puro)
describe('B · Conto economico: le stime non entrano nel totale', () => {
  let CE;
  before(async () => { CE = await import('../src/modules/finance/lib/contoEconomico.js'); });

  test('scegliProduzione → margineCliente → movimentiService → componiConto: un cliente stimato e uno Synclab', () => {
    const p = CE.periodo(2026, 11);
    const synclab = { esami: 3, valore: 90, righe: [{ codice: 'GLU', quantita: 3, righe: 3, valore: 90, prezzo_netto: 30 }] };
    const stima = CE.stimaProQuota({ fatturato_fy_atteso: 12500, volumi_giornalieri_attesi: 10 }, '2026-11', { giorniAnno: 250, oggi: '2026-11-09' });   // v0.68.4: pro quota
    const prodS = CE.scegliProduzione({ synclab });
    const prodE = CE.scegliProduzione({ stima });
    assert.equal(prodS.fonte, 'SYNCLAB'); assert.equal(prodS.stima, false);
    assert.equal(prodE.fonte, 'STIMA'); assert.equal(prodE.stima, true);
    assert.equal(CE.effettiva(prodS), true); assert.equal(CE.effettiva(prodE), false);
    const mS = CE.margineCliente({ produzione: prodS }), mE = CE.margineCliente({ produzione: prodE });
    assert.equal(mS.ricavo, 90); assert.equal(mE.ricavo, stima.valore);
    const clienti = [
      { org_id: 1, org_name: 'Cliente Synclab Prova', mesi: { '2026-11': { ...mS, produzione: { fonte: prodS.fonte, stima: prodS.stima } } } },
      { org_id: 2, org_name: 'Cliente Stimato Prova', mesi: { '2026-11': { ...mE, produzione: { fonte: prodE.fonte, stima: prodE.stima } } } },
    ];
    const mov = CE.movimentiService(clienti, { id: 10 }, p);
    assert.deepEqual(mov.map((m) => [m.riga, m.org_id, m.importo]), [['ricavi_service', 1, 90], ['stime_service', 2, stima.valore]]);
    mov.push({ riga: 'ricavi_retail', site_id: 10, importo: 40, modulo: 'Retail' });
    const conto = CE.componiConto({ sedi: [{ id: 10, code: 'LAB', name: 'Laboratorio Prova', kind: 'LABORATORIO' }], movimenti: mov, fonti: {} });
    assert.equal(conto.totale.ricavi, 130, 'Retail 40 + Service Synclab 90: la stima non entra');
    assert.equal(conto.totale.voci.stime_service, stima.valore);
    assert.deepEqual(conto.totale.stime, { importo: stima.valore, clienti: 1 });
    assert.deepEqual(conto.totale.service_fonti, ['SYNCLAB']);
    assert.equal(conto.colonne[0].ricavi, 130); assert.equal(conto.colonne[0].margine, 130);
    assert.equal(conto.colonne[0].parziale, false, 'la riga delle stime non rende parziale il margine');
    assert.equal(CE.RIGHE.find((r) => r.key === 'stime_service').gruppo, 'STIME');
  });

  test('stima salvata (fonte STIMA) fuori dal totale; riga MANUALE dentro', () => {
    const p = CE.periodo(2026, 10);
    const sal = CE.scegliProduzione({ salvata: { id: 1, fonte: 'STIMA', esami: 10, valore: 100 } });
    const man = CE.scegliProduzione({ salvata: { id: 2, fonte: 'MANUALE', esami: 4, valore: 60 } });
    const cl = [sal, man].map((x, i) => ({ org_id: i + 1, org_name: `Cliente ${i + 1}`, mesi: { '2026-10': { ...CE.margineCliente({ produzione: x }), produzione: { fonte: x.fonte, stima: x.stima } } } }));
    const conto = CE.componiConto({ sedi: [{ id: 10, code: 'LAB', name: 'Lab', kind: 'LABORATORIO' }], movimenti: CE.movimentiService(cl, { id: 10 }, p), fonti: {} });
    assert.equal(conto.totale.ricavi, 60); assert.equal(conto.totale.stime.importo, 100); assert.equal(conto.totale.stime.clienti, 1);
  });
});

// ------------------------------------------------------------------ C. Cockpit (puri)
describe('C · Cockpit a schermo unico: regole pure', () => {
  let M;
  before(async () => { M = await import('../src/lib/cockpitMonitor.js'); });
  test('somma dichiarata B2C + B2B: parziale con una sola componente, null senza', () => {
    assert.deepEqual(M.sommaComponenti(100, 50.5), { valore: 150.5, parziale: false, mancanti: [] });
    assert.deepEqual(M.sommaComponenti(null, 20), { valore: 20, parziale: true, mancanti: ['B2C'] });
    assert.equal(M.sommaComponenti(null, null).valore, null);
  });
  test('TOP 5: ordine per fatturato, quota sul totale B2B, variazione sul mese prima, "nuovo" senza mese prima', () => {
    const cur = [{ chiave: 'a', cliente: 'A', fatturato: 100 }, { chiave: 'b', cliente: 'B', fatturato: 300 }, { chiave: 'c', cliente: 'C', fatturato: 50 }, { chiave: 'd', cliente: 'D', fatturato: 25 }, { chiave: 'e', cliente: 'E', fatturato: 10 }, { chiave: 'f', cliente: 'F', fatturato: 15 }];
    const prev = [{ chiave: 'b', fatturato: 200 }, { chiave: 'a', fatturato: 125 }];
    const t = M.topClienti(cur, prev, 500, 5);
    assert.deepEqual(t.map((x) => x.chiave), ['b', 'a', 'c', 'd', 'f']);
    assert.deepEqual([t[0].quota, t[0].variazione, t[1].variazione, t[2].variazione], [60, 50, -20, null]);
    assert.equal(t[0].pos, 1);
  });
});

// ------------------------------------------------------------------ D. Room: aggancio per person_id (puro, lib del front-end)
describe('D · Room: buildNetwork aggancia prima per person_id', () => {
  test('stessa persona in due sedi con nomi scritti diversamente; la riga senza person_id con lo stesso nome si unisce', async () => {
    const N = await import(path.join(WEB, 'modules/room/lib/network.js'));
    const sede = (id, personale) => ({ id, denominazione: `Sede Prova ${id}`, personale, ambulatori: [], hours: {} });
    const net = N.buildNetwork([
      sede(1, [{ id: 'x1', nome: 'Dott. Prova Uno', tipo: 'medico', person_id: 41 }]),
      sede(2, [{ id: 'x2', nome: 'Uno Prova', tipo: 'medico', person_id: 41 }, { id: 'x3', nome: 'Altro Sanitario', tipo: 'sanitario' }]),
      sede(3, [{ id: 'x4', nome: 'Prova Uno', tipo: 'medico' }]),
    ]);
    const x = net.byPersonId[41];
    assert.ok(x, 'indice per persona'); assert.equal(x.nSedi, 3, 'person_id in due sedi + omonimo senza person_id nella terza');
    assert.equal(N.reteDi(net, { id: 41, nome: 'Nome Diverso In Anagrafica', personaKey: 'anagrafica diverso in nome' }), x, 'trovata per person_id anche con il nome diverso');
    assert.equal(N.reteDi(net, { id: 99, nome: 'Prova Uno' }), null, 'stesso nome ma persona diversa: non si aggancia a chi ha un altro person_id');
    assert.equal(N.reteDi(net, { id: 5, nome: 'Sanitario Altro' })?.nome, 'Altro Sanitario', 'senza person_id vale la chiave del nome');
  });
});

// ------------------------------------------------------------------ parte con database
describe('v0.68.1 con database e dati sintetici', { skip: SALTA }, () => {
  const M = {};
  let db;
  const OGGI = '2026-11-09';
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const RIC = (o) => { const r = copia(ESEMPI.standardRequest); delete r.patient; return { ...r, invoiceIds: [], samples: [], ...o, items: (o.items || r.items).map((x) => ({ ...x, invoiceIds: [], sampleIds: [] })) }; };
  const riga = (id, code, netto) => ({ ...copia(ESEMPI.standardRequest.items[0]), id, examCode: code, description: `Esame ${code}`, netUnitPriceExcludingVat: netto, quantity: 1, deleted: false });
  const DOC = (o) => ({ ...copia(ESEMPI.invoice), requestIds: [], items: [], ...o });
  const cli = (x, o = {}) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}`, legalName: `Client Prova ${x}`, vatNumber: '00000000000', ...o });

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    for (const k of ['retail', 'business', 'room']) await tr.startFresh(k, null);
    M.pers = await import('../src/lib/synclab/persistenza.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    // Legal entity di TD con una sede (Laboratorio in sede) e tre clienti esterni con il loro client Synclab
    const td = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDV681', 'Società Prova TD') RETURNING id`);
    await db.query(`INSERT INTO public.app_settings (key, value) VALUES ('company_org_id', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(td.id)]);
    M.sede = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-V1', 'Punto Prova Firenze', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1, 'CLI-S') RETURNING id`, [td.id])).id;
    M.org = {};
    for (const [k, nome, codice] of [['X', 'Cliente Prova Alfa', 'CLI-X'], ['Y', 'Cliente Prova Beta', 'CLI-Y'], ['Z', 'Cliente Prova Gamma', 'CLI-Z']]) {
      M.org[k] = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', $1, $2) RETURNING id`, [`SER-${k}`, nome])).id;
      await db.query(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ($1, $2, 'SERVICE', 'Lucca', 'LU', $3, $4)`, [`SRV-${k}`, `${nome} (service)`, M.org[k], codice]);
    }
    // account Service attivi: Alfa avviato a settembre (FY atteso 60.000), Beta avviato prima dell'anno (FY atteso 120.000)
    M.accX = (await uno(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, data_avvio_effettiva, attivo_dal) VALUES ($1, 'SRV', FALSE, TRUE, 7, 60000, '2026-09-01', '2026-09-01') RETURNING id`, [M.org.X])).id;
    M.accY = (await uno(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, data_avvio_effettiva, attivo_dal) VALUES ($1, 'SRV', FALSE, TRUE, 7, 120000, '2025-03-01', '2025-03-01') RETURNING id`, [M.org.Y])).id;
    await importa('clients', [cli('S'), cli('X'), cli('Y'), cli('Z')]);
    await importa('exams', [copia(ESEMPI.exam)]);
    // accettazioni: oggi 2 del punto TD (in sede) e 1 di Alfa; ieri 1 di Beta; nel mese altre di Beta
    const r = []; let k = 0;
    const add = (c, date, items) => r.push(RIC({ id: `RV-${++k}`, requestNumber: `2026/V${k}`, date, clientId: c, createdAtLocal: `${date}T08:00:00`, demographics: { ageYears: 40, sex: 'F', city: 'Firenze', province: 'FI' }, items }));
    add('CLI-ID-S', OGGI, [riga('s1', 'GLU', 10)]); add('CLI-ID-S', OGGI, [riga('s2', 'GLU', 10)]);
    add('CLI-ID-X', OGGI, [riga('x1', 'GLU', 9), riga('x2', 'ALT', 18)]);
    add('CLI-ID-Y', '2026-11-08', [riga('y1', 'GLU', 9)]);
    add('CLI-ID-Y', '2026-11-03', [riga('y2', 'GLU', 9)]);
    add('CLI-ID-X', '2026-10-10', [riga('x3', 'GLU', 9)]);
    await importa('requests', r);
    // documenti: novembre (oggi Alfa 200, il 3 Beta 1.000, Gamma 300), ottobre (Alfa 4.000, Beta 500, Gamma 600), settembre Alfa 4.000,
    // gennaio-agosto Beta 1.000 al mese; anno prima stesso giorno Beta 50
    const docs = []; let n = 0;
    const doc = (c, date, v) => docs.push(DOC({ id: `DV${++n}`, invoiceNumber: `2026/V${n}`, clientId: c, date, netRevenueContribution: v, total: v }));
    doc('CLI-ID-X', OGGI, 200); doc('CLI-ID-Y', '2026-11-03', 1000); doc('CLI-ID-Z', '2026-11-04', 300);
    doc('CLI-ID-X', '2026-10-05', 4000); doc('CLI-ID-Y', '2026-10-05', 500); doc('CLI-ID-Z', '2026-10-06', 600);
    doc('CLI-ID-X', '2026-09-10', 4000);
    for (let m = 1; m <= 8; m++) doc('CLI-ID-Y', `2026-${String(m).padStart(2, '0')}-15`, 1000);
    doc('CLI-ID-Y', '2025-11-09', 50);
    await importa('invoices', docs);
    // GIPO (B2C): oggi 2 accettazioni (30 + 45, una fuori area), nel mese un'altra (25); anno prima stesso giorno 20
    const c1 = await uno(`INSERT INTO retail.customers (kind, last_name, first_name, city, province) VALUES ('B2C', 'Prova', 'Uno', 'Firenze', 'FI') RETURNING id`);
    const c2 = await uno(`INSERT INTO retail.customers (kind, last_name, first_name, city, province) VALUES ('B2C', 'Prova', 'Due', 'Bologna', 'BO') RETURNING id`);
    const v = (ref, data, cust, net) => db.query(`INSERT INTO retail.sales (source, external_ref, sale_date, customer_id, site_id, product_code, quantity, net_amount) VALUES ('GIPO', $1, $2, $3, $4, 'PRE01', 1, $5)`, [ref, data, cust, M.sede, net]);
    await v('G1', OGGI, c1.id, 30); await v('G2', OGGI, c2.id, 45); await v('G3', '2026-11-02', c1.id, 25); await v('G0', '2025-11-09', c1.id, 20);
    M.S = await import('../src/modules/business/lib/synclabAccount.js');
    M.mon = await import('../src/lib/cockpitMonitor.js');
    M.diag = await import('../src/lib/diagnostica.js');
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('A · correlazione per account: maturato = produzione erogata (v0.68.5), pro quota dall\'avvio, run rate, semaforo', async () => {
    const acc = (await db.query(`SELECT id, organization_id, linea, fatturato_fy_atteso, data_avvio_effettiva::text, data_avvio_prevista::text, attivo_dal::text, cliente_attivo FROM business.accounts`)).rows;
    const c = await M.S.correlazioneAccounts(acc, { oggi: OGGI });
    assert.equal(c.disponibile, true);
    const x = c.per_account.get(M.accX), y = c.per_account.get(M.accY);
    assert.equal(x.maturato, 36, 'Alfa: produzione erogata 2026 = 9 + 18 (oggi) + 9 (ottobre); i documenti non contano');
    assert.equal(x.documenti_emessi.importo, 8200, 'Alfa: documenti emessi 4.000 + 4.000 + 200, dato secondario');
    assert.equal(x.pro_quota.inizio, '2026-09-01');
    assert.equal(x.pro_quota.importo, Math.round(60000 * (M.S.giorniLavorativi('2026-09-01', OGGI) / 250) * 100) / 100);
    assert.equal(x.run_rate.calcolabile, true); assert.deepEqual(x.run_rate.mesi, ['2026-09', '2026-10']); assert.equal(x.run_rate.importo, 54, '(0 + 9) / 2 × 12');
    assert.match(x.run_rate.nota, /Solo 2 mesi pieni/);
    assert.equal(x.produzione.esami, 3, 'righe d\'esame erogate di Alfa nel 2026');
    assert.equal(y.maturato, 18, 'Beta: due accettazioni erogate di novembre');
    assert.equal(y.pro_quota.inizio, '2026-01-01', 'avvio nel 2025: pro quota dal 1° gennaio');
    assert.equal(y.semaforo, 'ROSSO', 'molto sotto il pro quota di 120.000');
    assert.equal(y.run_rate.importo, 0, 'agosto, settembre e ottobre senza produzione erogata');
    const b = await M.S.bloccoAccount({ id: M.accX, linea: 'SRV', organization_id: M.org.X, fatturato_fy_atteso: 60000, data_avvio_effettiva: '2026-09-01' }, { oggi: OGGI });
    assert.equal(b.applicabile, true); assert.equal(b.chiave_b2b, String(M.org.X)); assert.match(b.fonte.testo, /produzione accettata \(stati 10, 15, 18, 20, 25, 30, 40, 50\), importi di riga \(sconto di testata non applicato\)/);
    assert.equal(b.giornaliero.giorni.length, 9, 'progressione giornaliera dal 1° a oggi'); assert.equal(b.giornaliero.giorni.at(-1).valore, 27);
    const none = await M.S.bloccoAccount({ id: 0, linea: 'PP', organization_id: M.org.X }, { oggi: OGGI });
    assert.equal(none.applicabile, false);
  });

  test('A · D51: clienti attivi sotto il 75% del pro quota (link alla scheda)', async () => {
    const [k] = await M.diag.esegui({ ids: ['D51'] });
    assert.notEqual(k.stato, 'ERRORE', k.nota);
    const ids = k.righe.map((x) => Number(x.account_id));
    // Beta ha 9.500 di maturato nel 2026 contro 120.000 di FY atteso: sotto il 75% del pro quota con la data di oggi reale
    assert.ok(ids.includes(M.accY), 'Beta in ritardo'); assert.match(k.righe.find((x) => Number(x.account_id) === M.accY).__link, /^\/business\/account\//);
  });

  test('C · schermo del Cockpit con Synclab e GIPO sintetici: ricavi B2C + B2B, laboratorio, TOP 5, retail', async () => {
    const d = await M.mon.calcolaMonitor({ oggi: OGGI });
    const S = d.schermo;
    assert.ok(S && !S.errore, S?.errore);
    const by = (l) => Object.fromEntries(l.map((x) => [x.chiave, x]));
    const R = by(S.ricavi), L = by(S.laboratorio), T = by(S.retail);
    // v0.68.6: Ricavi = B2C GIPO + produzione laboratorio StudioLab TUTTA (B2B + Laboratorio in sede), produzione accettata
    assert.equal(R.ricavi_oggi.valore, 122, 'B2C GIPO 75 + laboratorio 47 (Alfa 9 + 18, punto TD in sede 10 + 10)');
    assert.deepEqual(R.ricavi_oggi.parti.map((p) => p.valore), [75, 47]);
    assert.equal(R.ricavi_oggi.confronto, null, 'anno prima: la copia Synclab inizia il 10/10/2026, nessun confronto con zeri finti');
    assert.equal(R.ricavi_mese.valore, 100 + 65, 'GIPO 30 + 45 + 25; laboratorio B2B 27 + 9 + 9 e in sede 20');
    assert.match(R.ricavi_mese.fonte, /GIPO.*Synclab produzione accettata/);
    assert.equal(L.lab_acc_oggi.valore, 3); assert.deepEqual(L.lab_acc_oggi.parti.map((p) => p.valore), [1, 2], 'B2B 1 · in sede 2');
    assert.equal(L.lab_acc_ieri.valore, 1); assert.equal(L.lab_acc_mese.valore, 5); assert.equal(L.lab_esami_mese.valore, 6);
    assert.equal(L.lab_prod_oggi.valore, 27); assert.equal(L.lab_prod_mese.valore, 45);
    assert.equal(L.lab_prod_mese.secondario.valore, 1500, 'documenti emessi del mese come dato secondario');
    assert.deepEqual(S.top5.righe.map((x) => [x.cliente, x.valore, x.quota]), [['Cliente Prova Alfa', 27, 60], ['Cliente Prova Beta', 18, 40]]);
    assert.equal(S.top5.righe[0].variazione, null, 'Alfa: nessuna produzione dal 1° al 9 ottobre (quella del 10 è fuori dal periodo)');
    assert.equal(S.andamento.giorni.length, 9); assert.equal(S.andamento.giorni.at(-1).valore, 27); assert.equal(S.andamento.totale, 45);
    assert.equal(T.gipo_acc_oggi.valore, 2); assert.equal(T.gipo_acc_mese.valore, 3); assert.equal(T.gipo_scontrino.valore, 33.33);
    assert.equal(T.gipo_fuori_area.valore, 33.3, 'Bologna per una sede di Firenze: 1 accettazione su 3 valutabili nel mese');
    assert.deepEqual(S.fonti.map((f) => f.chiave), ['GIPO', 'TUOTEMPO', 'SYNCLAB']);
    for (const x of [...S.ricavi, ...S.laboratorio, ...S.retail, ...S.persone]) assert.ok(x.fonte || x.non_disponibile, `${x.chiave}: fonte dichiarata`);
    const u = await M.mon.monitorPerUtente({ level: 'OWNER', grants: {} }, { oggi: OGGI, fresco: true });
    assert.equal(u.schermo.versione, (await import('../src/version.js')).APP_VERSION);
    assert.equal(u.schermo.scadenze.length, 2); for (const b of u.schermo.scadenze) assert.ok(b.righe.length <= M.mon.MAX_RIGHE_SCHERMO);
  });

  test('D · vista professionisti_v: esterno con ruolo Accettazione dentro, referente senza niente fuori; D52', async () => {
    const ruolo = await uno(`INSERT INTO public.job_roles (name) VALUES ('Accettazione') RETURNING id`);
    const est = await uno(`INSERT INTO public.people (kind, status, last_name, first_name, role_id) VALUES ('ESTERNO', 'ATTIVO', 'Esterna', 'Accettazione', $1) RETURNING id`, [ruolo.id]);
    const ref = await uno(`INSERT INTO public.people (kind, status, last_name, first_name, organization_id) VALUES ('ESTERNO', 'ATTIVO', 'Referente', 'Cliente', $1) RETURNING id`, [M.org.X]);
    const sedeP = await uno(`INSERT INTO public.people (kind, status, last_name, first_name, site_id) VALUES ('ESTERNO', 'ATTIVO', 'Esterno', 'Consede', $1) RETURNING id`, [M.sede]);
    const v = Object.fromEntries((await db.query(`SELECT id, professionista, pianificabile FROM room.professionisti_v WHERE id = ANY($1::int[])`, [[est.id, ref.id, sedeP.id]])).rows.map((x) => [x.id, x]));
    assert.equal(v[est.id].professionista, true); assert.equal(v[est.id].pianificabile, true);
    assert.equal(v[sedeP.id].professionista, true, 'esterno con sede di lavoro');
    assert.equal(v[ref.id].professionista, false); assert.equal(v[ref.id].pianificabile, false, 'referente del cliente: fuori');
    // personale di sede: per person_id (nome scritto diverso), per omonimo, e una riga senza aggancio
    const med = await uno(`INSERT INTO public.people (kind, status, last_name, first_name) VALUES ('MEDICO', 'ATTIVO', 'Medico', 'Prova') RETURNING id`);
    await db.query(`INSERT INTO room.site_ext (site_id, data, version) VALUES ($1, $2, 1)`, [M.sede, JSON.stringify({ personale: [
      { id: 'a', nome: 'Dott. M. Prova', tipo: 'medico', person_id: med.id }, { id: 'b', nome: 'Accettazione Esterna', tipo: 'accettazione' },
      { id: 'c', nome: 'Persona Sconosciuta Prova', tipo: 'sanitario' }, { id: 'd', nome: 'Punto Prelievi', tipo: 'sanitario' }] })]);
    const [k] = await M.diag.esegui({ ids: ['D52'] });
    assert.notEqual(k.stato, 'ERRORE', k.nota);
    assert.deepEqual(k.righe.map((x) => x.nome), ['Persona Sconosciuta Prova']);
    assert.equal(k.righe[0].__link, `/room/sedi/${M.sede}`);
    // lato server: aggancio per person_id prima del nome
    const P = await import('../src/modules/room/lib/personale.js');
    assert.equal(P.stessaPersona({ nome: 'Dott. M. Prova', person_id: med.id }, { id: med.id, nome: 'Medico Prova' }), true);
    assert.equal(P.stessaPersona({ nome: 'Medico Prova', person_id: 999999 }, { id: med.id, nome: 'Medico Prova' }), false, 'con person_id vale solo quello');
    const trova = P.indicePersone([{ id: med.id, nome: 'Medico Prova' }, { id: est.id, nome: 'Esterna Accettazione' }]);
    assert.equal(trova({ nome: 'Dott. M. Prova', person_id: med.id })?.id, med.id);
    assert.equal(trova({ nome: 'Accettazione Esterna' })?.id, est.id, 'senza person_id: chiave del nome');
  });
});
