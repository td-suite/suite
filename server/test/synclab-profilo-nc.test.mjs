// v0.67.1 (decisioni del CEO del 09/11/2026 sera): profilo dei pazienti del laboratorio in Retail dalla PROIEZIONE STANDARD di Synclab
// e recupero PUNTUALE del paziente per le Non conformità. Unica sorgente: il server finto test/helpers/fakeSynclab.mjs (dati sintetici di
// CB Sistemi; per NC la "Persona Dimostrativa" degli esempi). Nessun dato reale, password del client finto casuale. Parte pura sempre;
// parte con database (DATABASE_URL_TEST, database temporaneo suite_slprof_<pid>) solo se la variabile c'è.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import express from 'express';
import ExcelJS from 'exceljs';
import { creaFakeSynclab, datiProfilo, ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database predefinito "suite". Senza DATABASE_URL_TEST un indirizzo inesistente (le regole pure non interrogano il database).
const nomeDb = `suite_slprof_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const { periodoProfilo, filtriProfilo, annoPrima } = await import('../src/lib/synclab/letture.js');

describe('Profilo pazienti: regole pure', () => {
  test('periodi: ultimi 12 mesi (predefinito), mese, trimestre, anno; anno prima con il 29 febbraio', () => {
    assert.deepEqual(periodoProfilo({ oggi: '2026-11-09' }), { tipo: '12m', da: '2025-12-01', a: '2026-11-09', etichetta: 'ultimi 12 mesi', prec: { da: '2024-12-01', a: '2025-11-09' } });
    assert.deepEqual(periodoProfilo({ periodo: '2026-10' }).prec, { da: '2025-10-01', a: '2025-10-31' });
    assert.equal(periodoProfilo({ periodo: '2026-Q2' }).a, '2026-06-30');
    assert.equal(periodoProfilo({ periodo: '2025' }).da, '2025-01-01');
    assert.equal(annoPrima('2024-02-29'), '2023-02-28');
    assert.throws(() => periodoProfilo({ da: '2026-02-01', a: '2026-01-01' }), /Periodo non valido/);
  });
  test('filtri: valori ammessi, il resto scartato', () => {
    assert.deepEqual(filtriProfilo({ site_id: '7', mdl: 'si', sex: 'f', fascia: '30-44', patient_type: 'PRIVATO' }), { site_id: 7, mdl: 'si', sex: 'F', fascia: '30-44', patient_type: 'PRIVATO' });
    assert.deepEqual(filtriProfilo({ site_id: 'ND', mdl: 'forse', sex: 'Z', fascia: '99' }), { site_id: 'ND' });
    assert.throws(() => filtriProfilo({ site_id: 'abc' }), /Sede non valida/);
  });
  test('dati sintetici del collaudo: nessun paziente nella proiezione standard, solo demografia', () => {
    const d = datiProfilo({ n: 60, oggi: '2026-11-09', conPaziente: false });
    assert.ok(d.requests.length >= 60);
    assert.ok(d.requests.every((r) => !r.patient));
    assert.equal(new Set(d.requests.map((r) => r.clientId)).size, 3);
  });
});

describe('Profilo pazienti e recupero puntuale NC con il server finto', { skip: SALTA }, () => {
  const M = {};
  let fake, db, password, srv, baseApp;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;
  const RIC = (o) => { const r = copia(ESEMPI.standardRequest); delete r.patient; return { ...r, invoiceIds: [], samples: [], items: r.items.map((x) => ({ ...x, invoiceIds: [], sampleIds: [] })), ...o }; };
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const studiolab = (settings) => M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: fake.url, auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password }, settings }, null);

  before(async () => {
    password = `Fz${crypto.randomBytes(6).toString('base64url')}!9`;
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    const dbm = await import('../src/db.js');
    assert.equal((await dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    M.conn = await import('../src/lib/connectors.js'); await M.conn.loadConnectors();
    M.api = await import('../src/lib/synclab/client.js'); M.api.configura({ scalaAttese: 0.002, chiamateAlMinuto: 100000 });
    M.sync = await import('../src/lib/synclab/sync.js');
    M.pers = await import('../src/lib/synclab/persistenza.js');
    M.let = await import('../src/lib/synclab/letture.js');
    M.dbm = await import('../src/db.js');
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('nc', null); await tr.startFresh('retail', null);
    M.ncp = await import('../src/modules/nc/lib/pazienteSynclab.js');
    M.ncu = await import('../src/modules/nc/lib/util.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    fake = creaFakeSynclab({ password, retryAfter: 2, polling: 0, dati: { clients: [], exams: [copia(ESEMPI.exam)], 'price-lists': [], requests: [copia(ESEMPI.optInRequest)], invoices: [] } });
    fake.url = await fake.avvia();
    // anagrafica di prova: due sedi (Firenze FI, Prato PO) con il codice StudioLAB dei due client sintetici
    const org = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDPROVA', 'Gruppo Prova') RETURNING id`);
    M.sA = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code, lat, lng) VALUES ('PP-A', 'Punto Prova Firenze', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1, 'CLI-A', 43.77, 11.25) RETURNING id`, [org.id])).id;
    M.sB = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-B', 'Punto Prova Prato', 'PUNTO_PRELIEVI', 'Prato', 'PO', $1, 'CLI-B') RETURNING id`, [org.id])).id;
    const cli = (x) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}` });
    await importa('clients', [cli('A'), cli('B'), cli('C')]);   // C senza sede abbinata
    await importa('exams', [copia(ESEMPI.exam)]);
    // 2026-10: accettazioni con età, sesso e comuni noti
    const r = [];
    let k = 0;
    const add = (cliId, date, dem, o = {}) => r.push(RIC({ id: `R-${++k}`, requestNumber: `2026/T${k}`, date, clientId: cliId, createdAtLocal: `${date}T08:15:00`, demographics: dem, ...o }));
    add('CLI-ID-A', '2026-10-05', { ageYears: 5, sex: 'F', city: 'Firenze', province: 'FI', postalCode: '50100' });          // 0-17, stesso comune
    add('CLI-ID-A', '2026-10-06', { ageYears: 20, sex: 'M', city: 'Sesto Fiorentino', province: 'FI', postalCode: '50019' }); // 18-29, stessa provincia
    add('CLI-ID-A', '2026-10-07', { ageYears: 35, sex: 'F', city: 'Prato', province: 'PO', postalCode: '59100' });            // 30-44, fuori area
    add('CLI-ID-A', '2026-10-08', { ageYears: 50, sex: 'F', city: null, province: null, postalCode: null });                 // 45-59, non valutabile
    add('CLI-ID-B', '2026-10-09', { ageYears: 65, sex: 'M', city: 'Prato', province: 'PO', postalCode: '59100' }, { patientType: 'CONVENZIONATO' });
    add('CLI-ID-B', '2026-10-10', { ageYears: 80, sex: 'F', city: 'Firenze', province: 'FI', postalCode: '50100' }, { occupationalMedicine: true }); // fuori area per Prato
    add('CLI-ID-C', '2026-10-11', { ageYears: null, sex: 'X', city: 'Pistoia', province: 'PT', postalCode: '51100' });       // età n.d., altro codice, senza sede
    // ventidue comuni diversi per il "top 20 + altri" (sede A, 30-44)
    for (let i = 1; i <= 22; i++) add('CLI-ID-A', '2026-10-20', { ageYears: 40, sex: 'M', city: `Comune Prova ${String(i).padStart(2, '0')}`, province: 'LU', postalCode: '55100' });
    // escluse: righe tutte cancellate, accettazione rimossa
    add('CLI-ID-A', '2026-10-12', { ageYears: 30, sex: 'F', city: 'Firenze', province: 'FI' }, { items: [{ ...RIC({}).items[0], id: 'x-del', deleted: true }] });
    add('CLI-ID-A', '2026-10-13', { ageYears: 30, sex: 'F', city: 'Firenze', province: 'FI' });
    // anno prima (2025-10): tre accettazioni
    add('CLI-ID-A', '2025-10-05', { ageYears: 7, sex: 'F', city: 'Firenze', province: 'FI' });
    add('CLI-ID-A', '2025-10-06', { ageYears: 9, sex: 'M', city: 'Prato', province: 'PO' });
    add('CLI-ID-B', '2025-10-07', { ageYears: 70, sex: 'M', city: 'Prato', province: 'PO' });
    await importa('requests', r);
    await db.query(`UPDATE synclab.requests SET disponibilita='RIMOSSO_STATO_ESCLUSO', deleted_at=now() WHERE request_number = $1`, [`2026/T${k - 3}`]);
    // app Express minima con le route del modulo Retail (utente del modulo simulato)
    const rp = (await import('../src/modules/retail/routes/profiloPazienti.js')).default;
    const app = express(); app.use(express.json());
    app.use((req, _res, nx) => { req.user = { id: null, role: 'ADMIN', site_ids: [] }; nx(); });
    app.use('/api/retail/profilo-pazienti', rp);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    baseApp = `http://127.0.0.1:${srv.address().port}`;
  }, { timeout: 180000 });
  after(async () => {
    await fake?.chiudi(); srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('sintesi, fasce × sesso, età non disponibile e anno prima', async () => {
    const p = await M.let.profiloPazienti({ periodo: '2026-10' });
    assert.equal(p.unita, 'accettazioni, non persone');
    assert.equal(p.sintesi.pazienti_distinti, null);
    assert.equal(p.sintesi.accettazioni, 7 + 22, 'escluse le righe tutte cancellate e l\'accettazione rimossa');
    assert.equal(p.sintesi.eta_nd, 1); assert.equal(p.sintesi.quota_eta_nd, Math.round((1 / 29) * 1000) / 10);
    assert.equal(p.sintesi.sesso_altro, 1);
    assert.equal(p.sintesi.eta_mediana, 40);
    const fa = Object.fromEntries(p.fasce.map((x) => [x.fascia, x]));
    assert.deepEqual([fa['0-17'].totale, fa['18-29'].totale, fa['30-44'].totale, fa['45-59'].totale, fa['60-74'].totale, fa['75+'].totale, fa.ND.totale], [1, 1, 23, 1, 1, 1, 1]);
    assert.equal(fa['0-17'].F, 1); assert.equal(fa['30-44'].M, 22); assert.equal(fa.ND.ALTRO, 1);
    assert.equal(p.sintesi.anno_prima.accettazioni, 3);
    assert.equal(fa['0-17'].anno_prima.totale, 2); assert.equal(fa['0-17'].delta, -1); assert.equal(fa['60-74'].anno_prima.M, 1);
    // nessuna colonna identificativa nel risultato
    assert.doesNotMatch(JSON.stringify(p), /patient_|lastName|firstName|fiscal/i);
  });

  test('provenienza: province, top 20 comuni + altri, CAP della sede, fuori area e bacino per sede', async () => {
    const p = await M.let.profiloPazienti({ periodo: '2026-10' });
    const pr = p.provenienza;
    assert.equal(pr.comuni.top.length, 20);
    assert.equal(pr.comuni.totale_comuni, 22 + 4);
    assert.equal(pr.comuni.altri.comuni, 6); assert.equal(pr.comuni.non_disponibile, 1);
    assert.equal(pr.province.find((x) => x.provincia === 'LU').n, 22);
    // fuori area: A/Prato (PO≠FI) e B/Firenze (FI≠PO); valutabili: tutte con sede e provenienza note (le 22 LU sono fuori area per A)
    assert.equal(pr.fuori_area.fuori, 2 + 22);
    assert.equal(pr.fuori_area.non_valutabili, 2, 'senza comune (sede A) e senza sede (client C)');
    const bA = pr.bacino.find((b) => b.site_id === M.sA);
    assert.deepEqual([bA.n, bA.stesso_comune, bA.stessa_provincia, bA.fuori_area, bA.non_valutabili], [26, 1, 1, 23, 1]);
    const bB = pr.bacino.find((b) => b.site_id === M.sB);
    assert.deepEqual([bB.n, bB.stesso_comune, bB.fuori_area], [2, 1, 1]);
    assert.ok(pr.bacino.some((b) => b.site_id == null && b.n === 1), 'client senza sede abbinata a parte');
    assert.equal(pr.cap, null, 'CAP solo con una sede scelta');
    const conSede = await M.let.profiloPazienti({ periodo: '2026-10', site_id: String(M.sB) });
    assert.equal(conSede.sintesi.accettazioni, 2);
    assert.deepEqual(conSede.provenienza.cap.map((c) => [c.cap, c.n]).sort(), [['50100', 1], ['59100', 1]]);
    // filtri: medicina del lavoro, tipo paziente, sesso
    assert.equal((await M.let.profiloPazienti({ periodo: '2026-10', mdl: 'si' })).sintesi.accettazioni, 1);
    assert.equal((await M.let.profiloPazienti({ periodo: '2026-10', patient_type: 'CONVENZIONATO' })).sintesi.accettazioni, 1);
    assert.equal((await M.let.profiloPazienti({ periodo: '2026-10', sex: 'F' })).sintesi.accettazioni, 4);
  });

  test('andamento, esami (catalogo), orari senza conversione di fuso; Cockpit', async () => {
    const p = await M.let.profiloPazienti({ periodo: '2026-10' });
    assert.deepEqual(p.andamento.mesi, ['2026-10']);
    assert.equal(p.andamento.medicina_lavoro[0].n, 1);
    assert.equal(p.andamento.per_tipo.righe[0].PRIVATO, 27);
    assert.equal(p.esami.top[0].codice, 'GLU'); assert.equal(p.esami.top[0].descrizione, ESEMPI.exam.description);
    assert.equal(p.esami.top[0].esami, 29);
    assert.ok(p.esami.per_fascia['30-44'][0].esami === 23 && p.esami.per_sesso.F[0].esami === 4);
    assert.ok(p.esami.per_sede.some((s) => s.site_id === M.sA));
    assert.equal(p.orari.ore.find((h) => h.ora === 8).n, 29, 'ora locale 08:15 resta alle 8');
    assert.equal(p.orari.giorni.find((g) => g.dow === 2).n, p.orari.matrice.filter((x) => x.dow === 2).reduce((t, x) => t + x.n, 0));
    const s = await M.let.sintesiProfilo('2026-10-01', '2026-10-31');
    assert.equal(s.eta_mediana, 40); assert.equal(s.quota_fuori_area, Math.round((24 / 27) * 1000) / 10);
  });

  test('export Excel: fogli dei blocchi 2-5 e nessun dato identificativo', async () => {
    const res = await fetch(`${baseApp}/api/retail/profilo-pazienti/export.xlsx?periodo=2026-10`);
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const nomi = wb.worksheets.map((w) => w.name);
    for (const n of ['Fasce età e sesso', 'Provenienza province', 'Provenienza comuni', 'Bacino per sede', 'Andamento per sede', 'Andamento per tipo', 'Esami top 15', 'Esami per sede']) assert.ok(nomi.includes(n), n);
    const ws = wb.getWorksheet('Fasce età e sesso');
    assert.equal(ws.getRow(1).getCell(1).value, 'Fascia d\'età');
    assert.equal(ws.getRow(2).getCell(6).value, 1);   // 0-17 totale
    const comuni = wb.getWorksheet('Provenienza comuni');
    assert.equal(comuni.rowCount, 1 + 20 + 1 + 1, 'top 20 + altri + non disponibile');
    const j = await (await fetch(`${baseApp}/api/retail/profilo-pazienti?periodo=2026-10`)).json();
    assert.equal(j.mappa.comuni.length, 0, 'nessun comune in cache: nessuna coordinata inventata');
    assert.equal(j.mappa.sedi.length, 1, 'solo la sede con coordinate');
    await db.query(`INSERT INTO public.geo_comuni (comune_norm, provincia_norm, comune, provincia, lat, lng, source, esito) VALUES ('prato', 'PO', 'Prato', 'PO', 43.88, 11.1, 'prova', 'OK')`);
    const j2 = await (await fetch(`${baseApp}/api/retail/profilo-pazienti?periodo=2026-10`)).json();
    assert.deepEqual(j2.mappa.comuni.map((c) => [c.comune, c.n]), [['Prato', 2]]);
    // geocodifica a lotti con cache: il secondo giro non ripete i comuni già tentati
    const { geocodificaComuni } = await import('../src/lib/geocode.js');
    let chiamate = 0;
    const trova = async ({ city }) => { chiamate++; return city === 'Firenze' ? { lat: 43.77, lng: 11.25, precision: 'citta', source: 'prova' } : null; };
    const g1 = await geocodificaComuni([{ comune: 'Firenze', provincia: 'FI' }, { comune: 'Prato', provincia: 'PO' }, { comune: 'Ignoto', provincia: 'XX' }], { trova });
    assert.deepEqual([g1.tentati, g1.trovati, g1.non_trovati], [2, 1, 1]);
    const g2 = await geocodificaComuni([{ comune: 'Firenze', provincia: 'FI' }, { comune: 'Ignoto', provincia: 'XX' }], { trova });
    assert.equal(g2.tentati, 0); assert.equal(chiamate, 2);
    // errore di rete: registrato come ERRORE (non come "non trovato") e ritentato al giro dopo
    const g3 = await geocodificaComuni([{ comune: 'Senza Rete', provincia: 'FI' }], { trova: async () => { throw new Error('non raggiungibile'); } });
    assert.equal(g3.errori, 1);
    assert.equal((await uno(`SELECT esito FROM public.geo_comuni WHERE comune_norm = 'senza rete'`)).esito, 'ERRORE');
    const g4 = await geocodificaComuni([{ comune: 'Senza Rete', provincia: 'FI' }], { trova });
    assert.equal(g4.tentati, 1);
  });

  test('NC: cache senza paziente → dettaglio opt-in di UNA accettazione → cache valorizzata; nulla nelle tabelle synclab', async () => {
    const P = ESEMPI.optInRequest.patient;
    M.ncp.azzeraLimite();
    // la copia Synclab ha l'accettazione degli esempi nella proiezione standard (nessun paziente)
    await studiolab({ data_api_enabled: true });
    M.conn.studiolabClientTokenReset();
    await M.sync.eseguiCiclo('requests');
    assert.equal((await uno(`SELECT patient_last_name FROM synclab.requests WHERE request_number = $1`, [ESEMPI.optInRequest.requestNumber])).patient_last_name, null);
    await db.query(`INSERT INTO nc.accettazioni (id, origine) VALUES ($1, 'MANUALE')`, [ESEMPI.optInRequest.requestNumber]);
    const acc = await uno(`SELECT * FROM nc.accettazioni WHERE id = $1`, [ESEMPI.optInRequest.requestNumber]);
    const prima = fake.richiesteDati().length;
    const req = { user: { id: null }, ip: '127.0.0.1' };
    const r = await M.ncp.recuperaPaziente(acc, { req, audit: M.ncu.audit, ncCodice: 'NC-2026-0001' });
    assert.equal(r.esito, 'RECUPERATO', r.messaggio);
    const det = fake.richiesteDati().slice(prima);
    assert.equal(det.length, 1, 'una sola chiamata');
    assert.equal(det[0].path, `/api/v1/data/requests/${ESEMPI.optInRequest.id}`); assert.equal(det[0].query.includePatient, 'true');
    const c = await uno(`SELECT paziente_cognome, paziente_nome, paziente_nascita, paziente_sesso, paziente_cf, origine FROM nc.accettazioni WHERE id = $1`, [acc.id]);
    assert.deepEqual([c.paziente_cognome, c.paziente_nome, c.paziente_nascita, c.paziente_sesso, c.paziente_cf, c.origine], [P.lastName, P.firstName, P.birthDate, ESEMPI.optInRequest.demographics.sex, P.fiscalCode, 'MANUALE']);
    // nessun dato paziente salvato nella copia Synclab, nei registri e nell'audit
    const s = await uno(`SELECT patient_last_name, patient_fiscal_code, raw ? 'patient' AS rawp FROM synclab.requests WHERE request_number = $1`, [acc.id]);
    assert.deepEqual([s.patient_last_name, s.patient_fiscal_code, s.rawp], [null, null, false]);
    const a = await uno(`SELECT label, data::text AS data FROM nc.audit_log WHERE action = 'ACC_PAZIENTE_SYNCLAB'`);
    assert.equal(a.label, 'Paziente recuperato dal gestionale per la NC NC-2026-0001');
    const testi = [a.label, a.data, ...(await tutti(`SELECT endpoint || ' ' || coalesce(message, '') AS t FROM public.connector_log`)).map((x) => x.t), ...(await tutti(`SELECT coalesce(dettaglio, '') AS t FROM nc.lis_eventi`)).map((x) => x.t)];
    for (const t of testi) for (const v of [P.lastName, P.firstName, P.fiscalCode, P.birthDate]) assert.ok(!t.includes(v), `dato paziente nel registro: ${t}`);
    // già presente: nessuna chiamata
    const r2 = await M.ncp.recuperaPaziente({ ...acc, paziente_cognome: 'x' });
    assert.equal(r2.esito, 'PRESENTE');
  });

  test('NC: limite di una chiamata ogni 10 minuti per accettazione; ricerca per barcode; Data API spenta → nessuna chiamata', async () => {
    const id = ESEMPI.optInRequest.requestNumber;
    await db.query(`UPDATE nc.accettazioni SET paziente_cognome = NULL, paziente_nome = NULL WHERE id = $1`, [id]);
    const acc = await uno(`SELECT * FROM nc.accettazioni WHERE id = $1`, [id]);
    let n = fake.richiesteDati().length;
    const r = await M.ncp.recuperaPaziente(acc);
    assert.equal(r.esito, 'ATTESA'); assert.match(r.messaggio, /tra \d+ minut/);
    assert.equal(fake.richiesteDati().length, n, 'nessuna chiamata entro i 10 minuti');
    // barcode del campione (accettazione registrata con il codice della provetta)
    const bc = ESEMPI.optInRequest.samples[0].barcode;
    await db.query(`INSERT INTO nc.accettazioni (id, origine) VALUES ($1, 'MANUALE')`, [bc]);
    const r3 = await M.ncp.recuperaPaziente(await uno(`SELECT * FROM nc.accettazioni WHERE id = $1`, [bc]));
    assert.equal(r3.esito, 'RECUPERATO', r3.messaggio);
    assert.equal(fake.richiesteDati().length, n + 1);
    // non in copia: messaggio chiaro, nessuna chiamata
    n = fake.richiesteDati().length;
    const r4 = await M.ncp.recuperaPaziente({ id: '2026/NONCE', paziente_cognome: null });
    assert.equal(r4.esito, 'NON_IN_COPIA'); assert.equal(fake.richiesteDati().length, n);
    // Data API spenta
    M.ncp.azzeraLimite();
    await studiolab({ data_api_enabled: false });
    const r5 = await M.ncp.recuperaPaziente(acc);
    assert.equal(r5.esito, 'DISATTIVATA'); assert.match(r5.messaggio, /disabilitata/);
    assert.equal(fake.richiesteDati().length, n, 'Data API spenta: nessuna chiamata');
  });
});
