// v0.71.0 · Lab Control (modulo `etichette`, già Label). Parte pura sempre: fase e linea del tempo di un'accettazione da stato e date
// (tutti gli stati, NC fuori linea, stato sconosciuto), avanzamento degli esami, ritardo (soglia, soglie per fase, finestra), percentili.
// Parte con database (DATABASE_URL_TEST, database temporaneo suite_lc_<pid>) solo se la variabile c'è: elenco con i filtri (cliente, sede,
// data, fase, stato, ritardo, NC, non fatturate, numero, barcode, cognome), perimetro (OPERATORE, LABORATORIO, ADMIN), valore come la
// produzione accettata, cruscotto, campioni in viaggio, ritardi e soglie, TAT (mediana, 90° percentile, mese prima), esami non eseguiti,
// clienti, scheda con Etichetta e Fattura (presente e assente), documento senza PDF, collegamenti (abbinato, non abbinato, modulo non LIVE,
// senza grant), link inversi, export senza nomi, lettura puntuale dal gestionale, ricerca globale, D57, Cockpit, compatibilità di Label.
// Dati SOLO sintetici: forme di docs/synclab-data-api/esempi_sintetici.json, nomi di fantasia ("Esempio", "Prova"), server finto.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import ExcelJS from 'exceljs';
import { creaFakeSynclab, ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const copia = (o) => JSON.parse(JSON.stringify(o));
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database predefinito "suite". Senza DATABASE_URL_TEST un indirizzo inesistente (le parti pure non interrogano il database).
const nomeDb = `suite_lc_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const F = await import('../src/modules/etichette/lib/fasi.js');

// ------------------------------------------------------------------ parte pura
describe('Lab Control: fasi e ritardi (puro)', () => {
  const t0 = { created_at_local: '2026-11-10T08:00:00', booking_at_local: null, report_at_local: null, modified_at_local: '2026-11-10T09:00:00' };
  const camp = [{ collected_at_local: '2026-11-10T08:20:00', checked_in_at_local: '2026-11-10T10:00:00' }];
  const righe = [
    { deleted: false, executed_at_local: '2026-11-10T11:00:00', validated_at_local: '2026-11-10T15:00:00', report_ready: true },
    { deleted: false, executed_at_local: '2026-11-10T12:00:00', validated_at_local: '2026-11-10T16:30:00', report_ready: false },
    { deleted: false, not_performed_code: 7 },
    { deleted: true, executed_at_local: null },
  ];
  test('fase per ogni stato del gestionale; NC fuori linea; stato sconosciuto', () => {
    const atteso = { 10: 'PRENOTATA', 30: 'PRENOTATA', 15: 'ACCETTATA', 18: 'PRELIEVO', 20: 'LAVORAZIONE', 25: 'FIRMA', 40: 'REFERTO', 50: 'CHIUSO' };
    for (const [st, k] of Object.entries(atteso)) {
      const f = F.faseAccettazione({ ...t0, state: Number(st) }, camp, righe);
      assert.equal(f.key, k, `stato ${st}`); assert.equal(f.fuori_linea, false);
      assert.equal(f.tappe.filter((x) => x.raggiunta).length, f.indice + 1);
      assert.equal(f.tappe.filter((x) => x.corrente).length, 1);
    }
    const nc = F.faseAccettazione({ ...t0, state: 11 }, camp, righe);
    assert.equal(nc.key, 'NC'); assert.equal(nc.fuori_linea, true); assert.equal(nc.indice, null); assert.ok(nc.tappe.every((x) => !x.raggiunta));
    const x = F.faseAccettazione({ ...t0, state: 99 }, [], []);
    assert.equal(x.key, null); assert.match(x.label, /Stato 99 del gestionale/);
    assert.deepEqual(F.statiDellaFase('PRENOTATA'), [10, 30]); assert.deepEqual(F.statiDellaFase('NC'), [11]); assert.deepEqual(F.statiDellaFase('X'), []);
  });
  test('linea del tempo: date delle fasi e durate; firma solo con tutte le righe valide validate', () => {
    const f = F.faseAccettazione({ ...t0, state: 40, report_at_local: '2026-11-10T18:00:00' }, camp, righe);
    const d = Object.fromEntries(f.tappe.map((x) => [x.key, x.data]));
    assert.equal(d.PRENOTATA, null, 'nessuna prenotazione distinta');
    assert.equal(d.ACCETTATA, '2026-11-10T08:00:00'); assert.equal(d.PRELIEVO, '2026-11-10T08:20:00'); assert.equal(d.LAVORAZIONE, '2026-11-10T10:00:00');
    assert.equal(d.FIRMA, '2026-11-10T16:30:00', 'ultimo validato (la riga non eseguita non blocca)'); assert.equal(d.REFERTO, '2026-11-10T18:00:00');
    assert.equal(f.tappe[1].durata_min, 20); assert.equal(f.tappe[2].durata_min, 100); assert.equal(f.tappe[4].durata_min, 90);
    assert.equal(f.accettazione_referto_min, 600);
    assert.deepEqual(f.esami, { totale: 3, eseguiti: 2, validati: 2, pronti: 1, non_eseguiti: 1, da_fare: 0 });
    // una riga valida non validata: niente data della firma
    const g = F.faseAccettazione({ ...t0, state: 20 }, camp, [...righe, { deleted: false, executed_at_local: null }]);
    assert.equal(g.tappe[4].data, null); assert.equal(g.tappe[4].raggiunta, false);
    // chiusa: modifiedAtLocal come data della chiusura
    assert.equal(F.faseAccettazione({ ...t0, state: 50 }, camp, righe).tappe[6].data, '2026-11-10T09:00:00');
    // prenotazione con data propria
    assert.equal(F.faseAccettazione({ ...t0, state: 10, booking_at_local: '2026-11-12T07:30:00' }, [], []).tappe[0].data, '2026-11-12T07:30:00');
    assert.deepEqual(F.statoEsame({ not_performed_code: 3 }), { key: 'NON_ESEGUITO', label: 'Non eseguito (codice 3)' });
    assert.equal(F.statoEsame({ executed_at_local: 'x' }).key, 'ESEGUITO');
    assert.equal(F.statoEsame({ deleted: true }).key, 'CANCELLATO');
  });
  test('ritardo: soglia dall\'accettazione, soglie per fase, finestra, stati non in corso', () => {
    const adesso = '2026-11-13T09:00:00';
    const t = { state: 20, created_at_local: '2026-11-10T08:00:00', modified_at_local: '2026-11-13T08:00:00', data: '2026-11-10' };
    assert.deepEqual(F.ritardo(t, { ore_ritardo: 72 }, adesso), { in_ritardo: true, ore: 73, motivo: 'oltre 72 ore dall\'accettazione senza referto' });
    assert.equal(F.ritardo(t, { ore_ritardo: 80 }, adesso).in_ritardo, false);
    const f = F.ritardo({ ...t, modified_at_local: '2026-11-12T08:00:00' }, { ore_ritardo: 80, soglie_fase: { 20: 24 } }, adesso);
    assert.equal(f.in_ritardo, true); assert.match(f.motivo, /ferma in "In lavorazione" da oltre 24 ore/);
    assert.equal(F.ritardo({ ...t, state: 40 }, { ore_ritardo: 1 }, adesso).in_ritardo, false, 'referto pronto: mai in ritardo');
    assert.equal(F.ritardo({ ...t, state: 11 }, { ore_ritardo: 1 }, adesso).in_ritardo, false);
    assert.equal(F.ritardo(t, { ore_ritardo: 72, dal: '2026-11-11' }, adesso).in_ritardo, false, 'fuori dalla finestra');
  });
  test('percentili come percentile_cont', () => {
    assert.equal(F.percentile([20, 50, 80], 0.5), 50);
    assert.equal(F.percentile([20, 50, 80], 0.9), 74);
    assert.equal(F.percentile([], 0.5), null);
    assert.equal(F.minutiTra('2026-11-10T08:00:00', '2026-11-11T09:30:00'), 1530);
  });
  test('compatibilità della sezione Label nel web: vecchi indirizzi, menu, file condivisi', () => {
    const web = path.resolve(HERE, '..', '..', 'web', 'src', 'modules', 'etichette');
    const idx = fs.readFileSync(path.join(web, 'index.jsx'), 'utf8');
    for (const [da, a] of [['modelli', 'label/modelli'], ['registro', 'label/registro'], ['stampa', 'label']]) assert.match(idx, new RegExp(`path="${da}" element={<Vecchio a="${a}" />}`));
    for (const p of ['label', 'label/modelli', 'label/registro', 'label/impostazioni', 'accettazioni/:inst/:id', 'impostazioni']) assert.ok(idx.includes(`path="${p}"`), p);
    const meta = fs.readFileSync(path.join(web, 'meta.js'), 'utf8');
    assert.match(meta, /title: 'Lab Control'/); assert.match(meta, /group: 'Label'/);
    for (const v of ['Stampa etichette', 'Modelli', 'Registro stampe', 'Impostazioni Label', 'Cruscotto', 'Accettazioni', 'Campioni', 'In ritardo', 'Tempi di refertazione', 'Esami non eseguiti', 'Clienti']) assert.ok(meta.includes(`'${v}'`), v);
    const seed = fs.readFileSync(path.resolve(HERE, '..', 'src', 'seed', 'modules.js'), 'utf8');
    assert.match(seed, /key: 'etichette', area: 'RETAIL_FLOW', name: 'Lab Control', tagline: 'Accettazioni, avanzamento, etichette'.*route: '\/etichette'/);
    assert.match(seed, /P\('LABORATORIO'/);
  });
});

// ------------------------------------------------------------------ con database
describe('Lab Control con il database e il server finto', { skip: SALTA }, () => {
  const M = {};
  let fake, db, password, srv, base;
  const INST = 'ISTANZA-DIMOSTRATIVA';
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;
  let ADESSO, OGGI;
  // istante locale di Roma h ore fa; per le accettazioni "di oggi" mai prima della mezzanotte
  const fa = (h) => new Date(Date.parse(`${ADESSO}Z`) - h * 3600e3).toISOString().slice(0, 19);
  const oggiFa = (h) => { const x = fa(h); return x.slice(0, 10) === OGGI ? x : `${OGGI}T00:00:01`; };
  const NOMI = { R2: ['Esempio', 'Primo'] };
  const req = (id, { cli, stato, creata, referto = null, prenotata = null, modificata = null, campioni = [], righe = 2, np = {}, validate = false, pronte = false, fatture = [], eseguite = false }) => {
    const r = copia(ESEMPI.optInRequest);
    r.id = id; r.requestNumber = `2026/LC${id.slice(1).padStart(3, '0')}`; r.date = creata.slice(0, 10); r.clientId = `CLI-ID-${cli}`; r.clientCode = `CLI-${cli}`; r.state = stato;
    r.createdAtLocal = creata; r.reportAtLocal = referto; r.bookingAtLocal = prenotata; r.modifiedAtLocal = modificata || referto || creata;
    r.patient = { ...r.patient, id: `P-${id}`, lastName: (NOMI[id] || ['Prova', 'Sintetica'])[0], firstName: (NOMI[id] || ['Prova', 'Sintetica'])[1], fiscalCode: 'NON_VALIDO_ESEMPIO' };
    r.samples = campioni.map((c, k) => ({ ...copia(ESEMPI.optInRequest.samples[0]), id: `${id}-S${k + 1}`, barcode: `BCLC${id.slice(1)}${k + 1}`, sampleAtLocal: c.raccolto || null, collectedAtLocal: c.raccolto || null, checkedInAtLocal: c.checkin || null, preparedAtLocal: null, checkedOutAtLocal: null }));
    r.items = Array.from({ length: righe }, (_, k) => ({ ...copia(ESEMPI.optInRequest.items[0]), id: `${id}-I${k + 1}`, examCode: k === 0 ? 'GLU' : `EX${k}`, description: k === 0 ? 'Glucosio' : `Esame dimostrativo ${k}`,
      sampleIds: r.samples.length ? [r.samples[k % r.samples.length].id] : [], invoiceIds: [], notPerformedCode: np[k] ?? null, reportReady: pronte, deleted: false,
      executedAtLocal: eseguite || validate ? creata : null, validatedAtLocal: validate ? (referto || creata) : null }));
    r.invoiceIds = fatture; r.demographics = { ...r.demographics, ageYears: 40 + Number(id.slice(1)), sex: Number(id.slice(1)) % 2 ? 'F' : 'M' };
    return r;
  };
  const standard = (r) => { const o = copia(r); delete o.patient; for (const i of o.items) delete i.historicalDescription; return o; };
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: INST, dataset, d }); });
  // utente del modulo simulato (come requireModuleReady) e utente della Suite (livello e grant) per i collegamenti
  let utente = null;
  const http = async (metodo, p, body, { raw = false } = {}) => {
    const r = await fetch(base + p, { method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
    return { s: r.status, j: await r.json().catch(() => null) };
  };

  before(async () => {
    password = `Fz${crypto.randomBytes(6).toString('base64url')}!9`;
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    M.conn = await import('../src/lib/connectors.js'); await M.conn.loadConnectors();
    M.api = await import('../src/lib/synclab/client.js'); M.api.configura({ scalaAttese: 0.002, chiamateAlMinuto: 100000 });
    M.pers = await import('../src/lib/synclab/persistenza.js');
    const tr = await import('../src/lib/travaso.js');
    for (const k of ['etichette', 'nc', 'business']) await tr.startFresh(k, null);
    M.core = await import('../src/modules/etichette/lib/core.js');
    M.L = await import('../src/modules/etichette/lib/lab.js');
    M.S = await import('../src/modules/etichette/lib/scheda.js');
    M.C = await import('../src/modules/etichette/lib/collegamenti.js');
    M.diag = await import('../src/lib/diagnostica.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    ADESSO = M.core.adessoRoma(); OGGI = ADESSO.slice(0, 10);
    // anagrafica: Legal entity del gruppo con due punti prelievi (client A e B), un cliente esterno con il suo punto service (client D) e
    // un account nel Business Hub; il client C non è abbinato
    const td = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDLC', 'Gruppo Prova LC') RETURNING id`);
    const ext = await uno(`INSERT INTO public.organizations (kind, code, name, active) VALUES ('CLIENTE', 'CLLC', 'Cliente Esterno Prova', TRUE) RETURNING id`);
    M.org = ext.id;
    M.sA = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('LC-A', 'Punto Prova A', 'PUNTO_PRELIEVI', 'Firenze', $1, 'CLI-A') RETURNING id`, [td.id])).id;
    M.sB = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('LC-B', 'Punto Prova B', 'PUNTO_PRELIEVI', 'Prato', $1, 'CLI-B') RETURNING id`, [td.id])).id;
    M.sD = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('LC-D', 'Service Prova D', 'SERVICE', 'Pistoia', $1, 'CLI-D') RETURNING id`, [ext.id])).id;
    M.account = (await uno(`INSERT INTO business.accounts (organization_id, linea, prospect) VALUES ($1, 'SRV', FALSE) RETURNING id`, [ext.id])).id;
    M.owner = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('titolare.lc@prova.invalid', 'Titolare Prova', 'OWNER', 'ACTIVE') RETURNING id`)).id;
    M.oper = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('operatore.lc@prova.invalid', 'Operatore Prova', 'USER', 'ACTIVE') RETURNING id`)).id;
    const cli = (x) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}`, legalName: `Cliente Prova ${x}`, vatNumber: null, fiscalCode: null });
    const fat = { ...copia(ESEMPI.invoice), id: 'FAT-LC-1', invoiceNumber: '2026/FLC1', clientId: 'CLI-ID-A', requestIds: ['R7'], items: [{ ...copia(ESEMPI.invoice.items[0]), requestId: 'R7', requestItemId: 'R7-I1' }], total: 24.4, date: OGGI };
    M.reqs = [
      req('R1', { cli: 'A', stato: 10, creata: oggiFa(0.5), prenotata: `${OGGI}T23:30:00`, campioni: [] }),
      req('R2', { cli: 'A', stato: 15, creata: oggiFa(1), campioni: [{}] }),
      req('R3', { cli: 'A', stato: 18, creata: oggiFa(3), campioni: [{ raccolto: oggiFa(2) }], np: { 1: 3 } }),
      req('R4', { cli: 'A', stato: 20, creata: fa(100), campioni: [{ raccolto: fa(99), checkin: fa(98) }], righe: 3, np: { 2: 5 }, eseguite: true }),
      req('R5', { cli: 'A', stato: 25, creata: fa(30), campioni: [{ raccolto: fa(29), checkin: fa(28) }], validate: true }),
      req('R6', { cli: 'A', stato: 40, creata: fa(48), referto: fa(28), campioni: [{ raccolto: fa(47), checkin: fa(46) }], validate: true, pronte: true }),
      req('R7', { cli: 'A', stato: 50, creata: fa(240), referto: fa(190), campioni: [{ raccolto: fa(239), checkin: fa(238) }], righe: 3, validate: true, pronte: true, fatture: ['FAT-LC-1'] }),
      req('R8', { cli: 'A', stato: 11, creata: oggiFa(2), campioni: [] }),
      req('R9', { cli: 'B', stato: 20, creata: fa(30), campioni: [{ raccolto: fa(30) }] }),
      req('R10', { cli: 'C', stato: 40, creata: fa(120), referto: fa(40), campioni: [{ raccolto: fa(119), checkin: fa(118) }], validate: true, pronte: true }),
      req('R11', { cli: 'D', stato: 18, creata: fa(80), campioni: [{ raccolto: fa(79), checkin: fa(78) }] }),
      req('R12', { cli: 'A', stato: 20, creata: fa(90 * 24), campioni: [] }),
    ];
    M.reqs[6].items[2].deleted = true;   // R7: una riga cancellata non conta nel valore
    fake = creaFakeSynclab({ password, retryAfter: 2, polling: 1, dati: { clients: ['A', 'B', 'C', 'D'].map(cli), exams: [copia(ESEMPI.exam)], 'price-lists': [], requests: M.reqs.map(copia), invoices: [fat] } });
    fake.url = await fake.avvia();
    await importa('clients', ['A', 'B', 'C', 'D'].map(cli));
    await importa('requests', M.reqs.map(standard));
    await importa('invoices', [fat]);
    await db.query(`INSERT INTO synclab.sync_scope (instance_id, client_name, dataset, filtri_canonici, include_patient, checkpoint_at) VALUES ($1, 'TDSuite', 'requests', '{}', FALSE, now())`, [INST]);
    // identità recente solo per R2 (Label)
    await db.query(`INSERT INTO etichette.pazienti_recenti (instance_id, request_id, request_number, data_accettazione, cognome, nome, nascita, sesso) VALUES ($1, 'R2', '2026/LC002', $2, 'Esempio', 'Primo', '1980-01-01', 'M')`, [INST, OGGI]);
    // una NC sulla R4 (modulo NC LIVE): sede inviante = sede A della Suite
    await db.query(`INSERT INTO nc.accettazioni (id, sede_id, origine) VALUES ('2026/LC004', $1, 'MANUALE')`, [M.sA]);
    await db.query(`INSERT INTO nc.nc (codice, accettazione_id, sede_id, macro, gravita, descrizione, azione_attesa) VALUES ('NC-2026-LC01', '2026/LC004', $1, 'FISICA', 'MINORE', 'Campione emolizzato di prova', 'Nuovo prelievo')`, [M.sA]);
    M.ncOk = true;
    // app Express con le route del modulo: utente del modulo (profilo e sedi) e utente della Suite (livello e grant)
    const lab = (await import('../src/modules/etichette/routes/lab.js')).default;
    const stampa = (await import('../src/modules/etichette/routes/stampa.js')).default;
    const admin = (await import('../src/modules/etichette/routes/admin.js')).default;
    const app = express(); app.use(express.json());
    app.use((req0, _res, nx) => { req0.user = { id: utente.id, level: utente.level || 'USER', grants: utente.grants || {} }; req0.moduleUser = { role: utente.role, site_ids: utente.site_ids || [] }; nx(); });
    app.use('/api/etichette', lab, stampa, admin);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    base = `http://127.0.0.1:${srv.address().port}/api/etichette`;
  }, { timeout: 240000 });
  after(async () => {
    await fake?.chiudi(); srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    const { modulePool } = await import('../src/lib/modules.js').catch(() => ({}));
    for (const k of ['etichette', 'nc', 'business', 'retail', 'orders']) await modulePool?.(k).end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  const ADMIN = () => ({ id: M.owner, level: 'OWNER', role: 'ADMIN', grants: { etichette: { profile: 'ADMIN' } } });
  const LAB = () => ({ id: M.oper, role: 'LABORATORIO', grants: { etichette: { profile: 'LABORATORIO' } } });
  const OPER_A = () => ({ id: M.oper, role: 'OPERATORE', site_ids: [M.sA], grants: { etichette: { profile: 'OPERATORE', scopes: [{ type: 'SITE', id: M.sA }] } } });
  const ids = (j) => j.righe.map((r) => r.id).sort();

  test('migrazione 002 idempotente: letture puntuali e indici sulla copia', async () => {
    const tr = await import('../src/lib/travaso.js');
    await tr.applyModuleMigrations();
    const mig = (await tutti(`SELECT name FROM etichette.schema_migrations ORDER BY name`)).map((x) => x.name);
    assert.deepEqual(mig.filter((x) => /^00[12]/.test(x)), ['001_init.sql', '002_lab_control.sql']);
    const idx = (await tutti(`SELECT indexname FROM pg_indexes WHERE schemaname = 'synclab' AND indexname LIKE 'lc_%'`)).map((x) => x.indexname).sort();
    assert.ok(['lc_items_non_eseguiti_idx', 'lc_requests_numero_idx', 'lc_samples_barcode_idx', 'lc_samples_viaggio_idx'].every((i) => idx.includes(i)), idx.join(','));
    assert.ok(await uno(`SELECT to_regclass('etichette.lc_letture') AS t`));
  });

  test('elenco: periodo, cliente, sede, fase, stato, ritardo, NC, non fatturate, numero, barcode e cognome', async () => {
    utente = ADMIN();
    let x = await http('GET', '/lab/accettazioni?periodo=oggi');
    assert.equal(x.s, 200);
    assert.deepEqual(ids(x.j), ['R1', 'R2', 'R3', 'R8']);
    x = await http('GET', '/lab/accettazioni?periodo=tutto');
    assert.equal(x.j.totale, 12);
    assert.deepEqual(ids(await http('GET', `/lab/accettazioni?periodo=tutto&cliente=c-CLI-ID-B`).then((r) => r.j)), ['R9']);
    assert.deepEqual(ids(await http('GET', `/lab/accettazioni?periodo=tutto&cliente=${M.org}`).then((r) => r.j)), ['R11'], 'Legal entity: tutti i suoi client');
    x = await http('GET', `/lab/accettazioni?periodo=tutto&cliente=${M.org}`);
    assert.match(x.j.cliente_nome, /Cliente Esterno Prova/);
    assert.deepEqual(ids(await http('GET', `/lab/accettazioni?periodo=tutto&sede=${M.sB}`).then((r) => r.j)), ['R9']);
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&sede=ND').then((r) => r.j)), ['R10']);
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&fase=LAVORAZIONE').then((r) => r.j)), ['R12', 'R4', 'R9'].sort());
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&fase=NC').then((r) => r.j)), ['R8']);
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&stato=25').then((r) => r.j)), ['R5']);
    // in ritardo (72 ore): R4 (100 ore) e R11 (80 ore); non R9 (30 ore), non R12 (fuori dalla finestra di 60 giorni), non i refertati
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&ritardo=1').then((r) => r.j)), ['R11', 'R4']);
    if (M.ncOk) assert.deepEqual(ids(await http('GET', '/lab/accettazioni?periodo=tutto&nc=1').then((r) => r.j)), ['R4']);
    x = await http('GET', '/lab/accettazioni?periodo=tutto&non_fatturate=1');
    assert.equal(x.j.totale, 11); assert.ok(!ids(x.j).includes('R7'));
    assert.deepEqual(ids(await http('GET', `/lab/accettazioni?q=${encodeURIComponent('2026/LC006')}&periodo=tutto`).then((r) => r.j)), ['R6']);
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?q=BCLC91&periodo=tutto').then((r) => r.j)), ['R9'], 'barcode del campione');
    assert.deepEqual(ids(await http('GET', '/lab/accettazioni?q=esempio&periodo=tutto').then((r) => r.j)), ['R2'], 'cognome solo sulle identità recenti');
    assert.equal((await http('GET', '/lab/accettazioni?q=prova&periodo=tutto')).j.totale, 0, 'i nomi del gestionale non sono nella copia');
    // ordinamento e paginazione lato server
    x = await http('GET', '/lab/accettazioni?periodo=tutto&ord=numero&dir=asc&per_pagina=10&pagina=2');
    assert.equal(x.j.righe.length, 2); assert.deepEqual(x.j.righe.map((r) => r.numero), ['2026/LC011', '2026/LC012']);
  });

  test('righe dell\'elenco: fase, avanzamento, paziente (solo identità recente), valore come la produzione accettata, fattura, NC, ritardo', async () => {
    utente = ADMIN();
    const x = await http('GET', '/lab/accettazioni?periodo=tutto&per_pagina=50');
    const R = Object.fromEntries(x.j.righe.map((r) => [r.id, r]));
    assert.equal(R.R2.paziente, 'Esempio Primo');
    assert.equal(R.R3.paziente, null); assert.equal(R.R3.eta, 43); assert.equal(R.R3.sesso, 'F');
    assert.equal(R.R4.fase.key, 'LAVORAZIONE'); assert.equal(R.R4.esami, 3); assert.equal(R.R4.esami_non_eseguiti, 1);
    assert.equal(R.R8.fase.key, 'NC'); assert.equal(R.R8.valore, null, 'NC mai arrivato: fuori dalla produzione accettata');
    assert.equal(R.R7.valore, 20, 'due righe da 10, la riga cancellata non conta');
    assert.deepEqual(R.R7.fatture.map((f) => f.numero), ['2026/FLC1']);
    assert.deepEqual(R.R6.fatture, []);
    if (M.ncOk) assert.deepEqual(R.R4.nc, { aperte: 1, totale: 1 });
    assert.equal(R.R4.ritardo.in_ritardo, true); assert.ok(R.R4.ritardo.ore >= 100);
    assert.equal(R.R12.ritardo.in_ritardo, false);
    assert.equal(R.R6.tat_min, 20 * 60);
    assert.equal(R.R11.link_cliente.href, `/business/account/${M.account}`, 'clic sul cliente: Business Hub');
    assert.equal(R.R10.link_cliente.href, '/admin/connectors/synclab?tab=clienti&q=CLI-C', 'client non abbinato: Abbina (amministratore)');
  });

  test('perimetro: OPERATORE solo le sue sedi; LABORATORIO tutto (anche i client non abbinati); impostazioni solo ADMIN', async () => {
    utente = OPER_A();
    let x = await http('GET', '/lab/accettazioni?periodo=tutto');
    assert.ok(x.j.righe.every((r) => r.site_id === M.sA)); assert.equal(x.j.totale, 9);
    assert.equal((await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R9')).s, 403);
    assert.equal((await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R10')).s, 403, 'client non abbinato: solo ADMIN e LABORATORIO');
    assert.equal((await http('GET', '/lab/impostazioni')).s, 403);
    x = await http('GET', '/lab/stato');
    assert.deepEqual(x.j.sedi.map((s) => s.id), [M.sA]); assert.equal(x.j.tutte, false);
    utente = { id: M.oper, role: 'OPERATORE', site_ids: [] };
    assert.equal((await http('GET', '/lab/accettazioni?periodo=tutto')).j.totale, 0, 'operatore senza sedi: niente');
    utente = LAB();
    x = await http('GET', '/lab/accettazioni?periodo=tutto');
    assert.equal(x.j.totale, 12);
    assert.equal((await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R10')).s, 200);
    assert.equal((await http('GET', '/lab/impostazioni')).s, 403, 'LABORATORIO senza Impostazioni');
    assert.equal((await http('GET', '/modelli')).s, 403, 'né modelli di Label');
    assert.equal((await http('GET', `/cerca?q=${encodeURIComponent('2026/LC010')}`)).j.risultati.length, 1, 'stampa di Label per tutte le sedi');
  });

  test('cruscotto: oggi per fase, in lavorazione, referti non chiusi, ritardi, TAT, campioni in viaggio, non eseguiti', async () => {
    utente = ADMIN();
    const x = (await http('GET', '/lab/cruscotto')).j;
    assert.equal(x.oggi_totale, 4);
    const f = Object.fromEntries(x.oggi_fasi.map((p) => [p.key, p.n]));
    assert.deepEqual([f.PRENOTATA, f.ACCETTATA, f.PRELIEVO], [1, 1, 1]); assert.equal(x.oggi_nc, 1);
    assert.equal(x.in_lavorazione, 6, 'R2, R3, R4, R5, R9, R11 (R12 fuori finestra)');
    assert.equal(x.referti_non_chiusi, 2, 'R6 e R10');
    assert.equal(x.in_ritardo, 2);
    assert.equal(x.campioni_viaggio, 2, 'R3 e R9 raccolti e non arrivati'); assert.equal(x.campioni_viaggio_oltre, 1, 'R9 da 30 ore');
    assert.equal(x.non_eseguiti_oggi.righe, 1);
    assert.equal(x.tat_7.n, 2, 'R6 (20 ore) e R10 (80 ore) refertate negli ultimi 7 giorni; R7 prima');
    assert.equal(x.tat_7.mediana, 50); assert.equal(x.tat_7.p90, 74);
    // perimetro: l'operatore della sede A non vede R9 né R11
    utente = OPER_A();
    const y = (await http('GET', '/lab/cruscotto')).j;
    assert.equal(y.in_lavorazione, 4); assert.equal(y.in_ritardo, 1); assert.equal(y.campioni_viaggio, 1);
  });

  test('ritardi: soglia, soglie per fase, raggruppati per cliente e sede, esami che bloccano, export senza nomi', async () => {
    utente = ADMIN();
    let x = (await http('GET', '/lab/ritardi')).j;
    assert.deepEqual(x.righe.map((r) => r.id), ['R4', 'R11'], 'dalla più vecchia');
    assert.deepEqual(x.per_cliente.map((c) => c.nome).sort(), ['Cliente Prova A', 'Cliente Prova D']);
    assert.ok(x.righe[0].bloccanti.length >= 1 && x.righe[0].bloccanti.every((b) => b.codice !== 'EX2'), 'la riga non eseguita non blocca');
    // soglia di fase per lo stato 20 (in lavorazione): R9 è ferma da 30 ore
    assert.equal((await http('PUT', '/lab/impostazioni', { soglie_fase: { 20: 24 } })).s, 200);
    x = (await http('GET', '/lab/ritardi')).j;
    assert.ok(x.righe.some((r) => r.id === 'R9' && /ferma/.test(r.ritardo.motivo)));
    assert.equal((await http('PUT', '/lab/impostazioni', { soglie_fase: { 20: null }, ore_ritardo: 90 })).s, 200);
    x = (await http('GET', '/lab/ritardi')).j;
    assert.deepEqual(x.righe.map((r) => r.id), ['R4'], 'soglia a 90 ore: solo R4');
    assert.equal((await http('PUT', '/lab/impostazioni', { ore_ritardo: 72 })).s, 200);
    assert.equal((await http('PUT', '/lab/impostazioni', { soglie_fase: { 40: 5 } })).s, 400);
    const xl = await http('GET', '/lab/ritardi.xlsx', null, { raw: true });
    assert.equal(xl.s, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buf);
    const testo = JSON.stringify(wb.worksheets[0].getSheetValues());
    assert.match(testo, /2026\/LC004/); assert.ok(!/Esempio|Primo|Prova Sintetica|NON_VALIDO/.test(testo));
  });

  test('export Excel dell\'elenco: senza nomi dei pazienti, con età e sesso; audit', async () => {
    utente = ADMIN();
    const xl = await http('GET', '/lab/accettazioni.xlsx?periodo=tutto', null, { raw: true });
    assert.equal(xl.s, 200); assert.match(xl.headers.get('content-disposition'), /lab-control-accettazioni_/);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buf);
    const ws = wb.worksheets[0];
    assert.equal(ws.rowCount, 2 + 12);
    const testo = JSON.stringify(ws.getSheetValues());
    assert.ok(!/Esempio|Primo/.test(testo), 'nessun nome, nemmeno delle identità recenti');
    assert.ok(ws.getRow(2).values.includes('Età') && ws.getRow(2).values.includes('Sesso'));
    const au = await uno(`SELECT label FROM public.audit_log WHERE action = 'LABCONTROL_EXPORT' ORDER BY id DESC LIMIT 1`);
    assert.match(au.label, /12 righe, senza nomi/);
  });

  test('TAT: mediana, 90° percentile, % entro soglia, per cliente e sede, esami lenti, mese prima', async () => {
    utente = ADMIN();
    const x = (await http('GET', '/lab/tat?periodo=30g&min_esami=1')).j;
    assert.equal(x.totale.n, 3, 'R6, R7 e R10 (le sole con il referto)');
    assert.equal(x.totale.mediana, 50); assert.equal(x.totale.p90, 74);
    assert.equal(x.totale.entro, 2); assert.equal(x.totale.entro_pct, 66.7);
    assert.ok(x.clienti.some((c) => c.client_id === 'CLI-ID-C' && c.mediana === 80));
    assert.ok(x.sedi.some((s) => s.site_id === M.sA && s.n === 2));
    assert.ok(x.esami_lenti.length >= 1 && x.esami_lenti[0].mediana >= x.esami_lenti.at(-1).mediana);
    assert.ok(x.mese_prima && x.mese_prima.totale.n === 0);
    assert.ok(x.settimane.length >= 1);
    const s = (await http('GET', `/lab/tat?periodo=30g&sede=${M.sA}`)).j;
    assert.equal(s.totale.n, 2); assert.equal(s.totale.mediana, 35);
    assert.equal((await http('GET', '/lab/tat?periodo=30g&esame=EX2')).j.totale.n, 0, 'EX2 refertato solo in R7, dove la riga è cancellata');
    assert.equal((await http('GET', '/lab/tat?periodo=30g&esame=EX1')).j.totale.n, 3);
  });

  test('esami non eseguiti e clienti', async () => {
    utente = ADMIN();
    const x = (await http('GET', '/lab/non-eseguiti?periodo=30g')).j;
    assert.equal(x.righe, 2); assert.equal(x.accettazioni, 2);
    assert.deepEqual(x.per_codice.map((c) => c.codice).sort(), [3, 5]);
    assert.ok(x.elenco.every((e) => e.numero && e.codice_esame));
    assert.equal((await http('GET', '/lab/non-eseguiti?periodo=30g&codice=5')).j.righe, 1);
    const c = (await http('GET', '/lab/clienti?periodo=30g')).j;
    const A = c.righe.find((r) => r.client_id === 'CLI-ID-A');
    assert.equal(A.accettazioni, 8, 'R1-R8; R12 è fuori dai 30 giorni'); assert.equal(A.in_ritardo, 1); assert.equal(A.refertate, 2); assert.equal(A.nc_mai_arrivato, 1);
    assert.equal(A.valore, 15 * 10, 'produzione accettata: R1-R7 (non R8, stato 11), 15 righe non cancellate da 10 €');
    const D = c.righe.find((r) => r.client_id === 'CLI-ID-D');
    assert.equal(D.link_cliente.href, `/business/account/${M.account}`);
    assert.equal((await http('GET', '/lab/clienti/cerca?q=cli-d')).j[0].value, 'c-CLI-ID-D');
  });

  test('campioni: in viaggio, non arrivati da più di N ore, barcode, stato', async () => {
    utente = ADMIN();
    let x = (await http('GET', '/lab/campioni?viaggio=1')).j;
    assert.equal(x.totale, 2);
    x = (await http('GET', '/lab/campioni?non_arrivati=1')).j;
    assert.equal(x.totale, 1); assert.equal(x.righe[0].numero, '2026/LC009'); assert.ok(x.righe[0].ore_viaggio >= 30);
    assert.equal((await http('GET', '/lab/campioni?non_arrivati=1&ore=1')).j.totale, 2);
    x = (await http('GET', '/lab/campioni?barcode=BCLC41')).j;
    assert.equal(x.totale, 1); assert.equal(x.righe[0].stato, 'ARRIVATO'); assert.ok(x.righe[0].esami.includes('GLU'));
    assert.equal((await http('GET', '/lab/campioni?periodo=tutto&stato=NON_RACCOLTO')).j.totale, 1, 'il campione di R2');
  });

  test('scheda: esami, campioni, linea del tempo, totali, Etichetta e Fattura (presente/assente), NC, audit con il paziente', async () => {
    utente = ADMIN();
    let x = await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R7');
    assert.equal(x.s, 200);
    const s = x.j;
    assert.equal(s.fase.key, 'CHIUSO'); assert.equal(s.righe.length, 3); assert.equal(s.righe.filter((r) => r.cancellata).length, 1);
    assert.equal(s.totali.lordo, 25); assert.equal(s.totali.sconti_riga, 5); assert.equal(s.totali.valore, 20);
    assert.deepEqual(s.fatture.map((f) => f.numero), ['2026/FLC1'], 'Fattura: documento collegato');
    assert.ok(s.campioni[0].esami.length >= 1);
    assert.equal(s.paziente, null, 'nessuna identità recente: età e sesso');
    assert.equal(s.collegamenti.accettazione.voci.find((v) => v.chiave === 'etichetta').href, '/etichette/label?acc=ISTANZA-DIMOSTRATIVA%7CR7');
    x = await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R6');
    assert.deepEqual(x.j.fatture, [], 'senza documenti: niente pulsante Fattura');
    assert.equal(x.j.tat_min, 1200);
    const d = await http('GET', '/lab/documenti/ISTANZA-DIMOSTRATIVA/FAT-LC-1');
    assert.equal(d.s, 200); assert.equal(d.j.numero, '2026/FLC1'); assert.equal(d.j.tipo, 'Fattura'); assert.match(d.j.pdf, /resta in StudioLab/);
    assert.deepEqual(d.j.accettazioni.map((a) => a.numero), ['2026/LC007']);
    utente = { id: M.oper, role: 'OPERATORE', site_ids: [M.sB] };
    assert.equal((await http('GET', '/lab/documenti/ISTANZA-DIMOSTRATIVA/FAT-LC-1')).s, 403, 'documento fuori perimetro');
    utente = ADMIN();
    if (M.ncOk) { x = await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R4'); assert.deepEqual(x.j.nc.map((n) => n.codice), ['NC-2026-LC01']); }
    // paziente: identità recente e audit senza nome
    x = await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R2');
    assert.equal(x.j.paziente.cognome, 'Esempio');
    await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R2');
    const au = await tutti(`SELECT label, data FROM public.audit_log WHERE action = 'LABCONTROL_SCHEDA_PAZIENTE'`);
    assert.equal(au.length, 1, 'una volta ogni 10 minuti per utente e accettazione');
    assert.ok(!/Esempio|Primo/.test(JSON.stringify(au)));
  });

  test('collegamenti: abbinato, non abbinato, modulo non LIVE, senza grant; link inversi', async () => {
    // amministratore della Suite: Business Hub dell'account, Retail non attivo (voce spenta con il motivo), NC attivo
    let c = await M.C.collegamenti({ id: M.owner, level: 'OWNER', grants: {} }, { client: { instance_id: INST, client_id: 'CLI-ID-D' } });
    const V = (k) => c.voci.find((v) => v.chiave === k);
    assert.equal(V('business').href, `/business/account/${M.account}`); assert.equal(c.principale, `/business/account/${M.account}`);
    assert.equal(V('retail').attivo, false); assert.match(V('retail').motivo, /Retail non è attivo/);
    assert.equal(V('labcontrol').href, '/etichette/accettazioni?cliente=c-CLI-ID-D');
    // client non abbinato: Abbina per l'amministratore, spento per gli altri
    c = await M.C.collegamenti({ id: M.owner, level: 'OWNER', grants: {} }, { client: { instance_id: INST, client_id: 'CLI-ID-C' } });
    assert.equal(c.voci[0].chiave, 'abbina'); assert.equal(c.voci[0].attivo, true);
    c = await M.C.collegamenti({ id: M.oper, level: 'USER', grants: { etichette: { profile: 'LABORATORIO' } } }, { client: { instance_id: INST, client_id: 'CLI-ID-C' } });
    assert.equal(c.voci[0].attivo, false); assert.match(c.voci[0].motivo, /amministratore della Suite/);
    // senza grant del Business Hub: voce spenta con il motivo
    c = await M.C.collegamenti({ id: M.oper, level: 'USER', grants: { etichette: { profile: 'LABORATORIO' } } }, { client: { instance_id: INST, client_id: 'CLI-ID-D' } });
    assert.equal(c.voci[0].attivo, false); assert.match(c.voci[0].motivo, /Non hai accesso a Business Hub/);
    // client di una sede TD: Retail punta al Laboratorio in sede (modulo non LIVE: spento ma con la ragione)
    c = await M.C.collegamenti({ id: M.owner, level: 'OWNER', grants: {} }, { client: { instance_id: INST, client_id: 'CLI-ID-A' } });
    assert.equal(c.ripartizione, 'LAB_SEDE'); assert.equal(c.voci.find((v) => v.chiave === 'retail').etichetta, 'Retail · Laboratorio in sede');
    const s = await M.C.collegamenti({ id: M.owner, level: 'OWNER', grants: {} }, { site: M.sA });
    assert.equal(s.voci[0].href, `/etichette/accettazioni?sede=${M.sA}`);
    const r = await M.C.collegamenti({ id: M.owner, level: 'OWNER', grants: {} }, { request: { instance_id: INST, id: 'R4' } });
    assert.equal(r.voci.find((v) => v.chiave === 'nc').href, '/nc/desk/2026%2FLC004');
    // API interna riusabile
    utente = ADMIN();
    assert.equal((await http('GET', `/lab/collegamenti?instance_id=${INST}&client_id=CLI-ID-D`)).j.principale, `/business/account/${M.account}`);
    assert.equal((await http('GET', '/lab/collegamenti')).s, 400);
    // link inversi: con il grant sì, senza no, modulo spento no
    assert.equal(await M.C.linkLabControl({ level: 'USER', grants: { etichette: { profile: 'OPERATORE' } } }, { cliente: M.org }), `/etichette/accettazioni?cliente=${M.org}`);
    assert.equal(await M.C.linkLabControl({ level: 'USER', grants: {} }, { cliente: M.org }), null);
    assert.equal(await M.C.linkLabControl({ level: 'OWNER', grants: {} }, { numero: '2026/LC004' }), '/etichette/accettazioni/ISTANZA-DIMOSTRATIVA/R4');
    await db.query(`UPDATE public.module_state SET mode = 'OFF' WHERE key = 'etichette'`);
    assert.equal(await M.C.linkLabControl({ level: 'OWNER', grants: {} }, { cliente: M.org }), null);
    await db.query(`UPDATE public.module_state SET mode = 'LIVE' WHERE key = 'etichette'`);
  });

  test('ricerca globale: l\'accettazione per numero solo con il grant e nel perimetro; Diagnostica D57; Cockpit', async () => {
    const { search } = await import('../src/lib/search.js');
    const conGrant = { id: M.oper, level: 'USER', kind: 'INTERNO', grants: { etichette: { profile: 'OPERATORE', scopes: [{ type: 'SITE', id: M.sA }] } } };
    let r = (await search(conGrant, '2026/LC004')).filter((x) => x.kind === 'accettazione');
    assert.equal(r.length, 1); assert.equal(r[0].link, '/etichette/accettazioni/ISTANZA-DIMOSTRATIVA/R4'); assert.equal(r[0].sensitive, true);
    assert.equal((await search(conGrant, '2026/LC009')).filter((x) => x.kind === 'accettazione').length, 0, 'fuori perimetro');
    assert.equal((await search({ ...conGrant, grants: {} }, '2026/LC004')).filter((x) => x.kind === 'accettazione').length, 0, 'senza grant');
    const [d57] = await M.diag.esegui({ ids: ['D57'] });
    assert.equal(d57.stato, 'INFO'); assert.equal(d57.n, 2);
    assert.ok(!/Esempio|Primo/.test(JSON.stringify(d57)));
    const k = await M.L.indicatoriCockpit();
    assert.equal(k.in_corso, 6); assert.equal(k.in_ritardo, 2); assert.equal(k.referti_aperti, 2); assert.equal(k.tat7.mediana, 50); assert.equal(k.tat7.n, 2);
  });

  test('Aggiorna dal gestionale: lettura puntuale senza paziente, la scheda la usa; una volta ogni 2 minuti; Data API spenta', async () => {
    utente = ADMIN();
    let x = await http('POST', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R6/aggiorna');
    assert.equal(x.j.esito, 'DISATTIVATA');
    await M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: fake.url, auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password }, settings: { data_api_enabled: true } }, null);
    // nel gestionale l'accettazione R6 è stata chiusa dopo l'ultimo delta
    fake.stato.dati.requests.find((r) => r.id === 'R6').state = 50;
    x = await http('POST', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R6/aggiorna');
    assert.equal(x.j.esito, 'LETTA');
    const l = await uno(`SELECT raw FROM etichette.lc_letture WHERE id = 'R6'`);
    assert.ok(!l.raw.patient && !JSON.stringify(l.raw).includes('NON_VALIDO'), 'senza paziente');
    assert.equal((await uno(`SELECT cf FROM etichette.pazienti_recenti WHERE request_id = 'R6'`)).cf, null);
    x = await http('GET', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R6');
    assert.equal(x.j.fonte, 'GESTIONALE'); assert.equal(x.j.fase.key, 'CHIUSO');
    assert.equal((await http('POST', '/lab/accettazioni/ISTANZA-DIMOSTRATIVA/R6/aggiorna')).j.esito, 'ATTESA');
    const log = await tutti(`SELECT endpoint FROM public.connector_log WHERE module = 'synclab'`);
    assert.ok(log.every((y) => !/\?/.test(y.endpoint)));
    assert.equal((await uno(`SELECT label FROM public.audit_log WHERE action = 'LABCONTROL_AGGIORNA'`)).label, 'Accettazione 2026/LC006 riletta dal gestionale');
    // la purga toglie la lettura quando la copia è più recente
    await db.query(`UPDATE synclab.requests SET updated_at = now() + interval '1 minute' WHERE id = 'R6'`);
    const { purga } = await import('../src/modules/etichette/lib/identita.js');
    assert.equal((await purga(7)).letture_puntuali, 1);
  });
});
