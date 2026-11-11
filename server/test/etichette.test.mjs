// v0.69.0 · Label (etichette provette, modulo `etichette`). Parte pura sempre: Code 128 (casi noti con checksum), modello ZPL con
// segnaposto e troncamenti, analisi e resa SVG del renderer condiviso con il browser (file identico in web/), una etichetta per campione
// con gli esami giusti. Parte con database (DATABASE_URL_TEST, database temporaneo suite_etich_<pid>) solo se la variabile c'è: ricerca
// per numero, barcode e cognome con il perimetro di sedi, lettura diretta dal gestionale con il 202, identità recenti (creazione, purga,
// limite delle chiamate, codice fiscale mai salvato), registro delle stampe e audit senza nomi, Diagnostica D54 e D55.
// Unica sorgente dei dati: il server finto test/helpers/fakeSynclab.mjs con pazienti SINTETICI ("Persona Dimostrativa" degli esempi di CB
// Sistemi e nomi di fantasia "Esempio", "Campione"). Nessun dato reale, password del client finto casuale.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import { creaFakeSynclab, ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const copia = (o) => JSON.parse(JSON.stringify(o));
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database predefinito "suite". Senza DATABASE_URL_TEST un indirizzo inesistente (le parti pure non interrogano il database).
const nomeDb = `suite_etich_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const Z = await import('../src/modules/etichette/lib/zpl.js');
const A = await import('../src/modules/etichette/lib/accettazioni.js');
const RIC = await import('../src/modules/etichette/lib/ricerca.js');

const MODELLO = `^XA^CI28^PW400^LL200
^FO16,8^A0N,26,24^FB370,1,0,L^FD{COGNOME:18} {NOME:14}^FS
^FO16,36^A0N,20,20^FDn. {NASCITA} {SESSO}^FS
^FO16,60^BY2,3,62^BCN,62,Y,N,N,A^FD{BARCODE}^FS
^FO16,150^A0N,20,20^FD{CONTENITORE} {MATERIALE}^FS
^FO16,174^A0N,18,18^FD{DATA} {ORA} {ESAMI:12}^FS
^FO300,174^A0N,18,18^FB84,1,0,R^FD{N}/{TOT}^FS^XZ`;

describe('Label: Code 128', () => {
  test('casi noti con checksum (modo automatico B/C)', () => {
    // esempio classico in insieme B: P J J 1 2 3 C → checksum 55
    assert.deepEqual(Z.code128Valori('PJJ123C').valori, [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
    // B poi C per le 6 cifre finali: H I [Code C] 34 56 78 → checksum 68
    assert.deepEqual(Z.code128Valori('HI345678').valori, [104, 40, 41, 99, 34, 56, 78, 68, 106]);
    // tutto numerico pari: Start C 12 34 → checksum 82
    assert.deepEqual(Z.code128Valori('1234').valori, [105, 12, 34, 82, 106]);
    // numerico dispari: C per le coppie, poi B per l'ultima cifra
    assert.deepEqual(Z.code128Valori('12345').valori, [105, 12, 34, 100, 21, 54, 106]);
    // cifra dispari lasciata in B prima del gruppo C finale
    assert.deepEqual(Z.code128Valori('BC00011').valori, [104, 34, 35, 16, 99, 0, 11, 100, 106]);
    // 3 cifre in mezzo restano in B (non conviene passare a C)
    assert.equal(Z.code128Valori('A123B').valori.filter((v) => v === 99).length, 0);
  });
  test('modo N della Zebra: insieme B, ">;" passa a C, ">:" torna a B', () => {
    assert.deepEqual(Z.code128Valori('1234', { modo: 'N' }).valori, [104, 17, 18, 19, 20, 88, 106]);
    const c = Z.code128Valori('>;1234>:A', { modo: 'N' });
    assert.deepEqual(c.valori.slice(0, 5), [105, 12, 34, 100, 33]);
    assert.equal(c.testo, '1234A');
    assert.throws(() => Z.code128Valori('>;123', { modo: 'N' }), /coppie di cifre/);
  });
  test('barre e moduli: 11 moduli per simbolo, 13 lo stop; caratteri non ammessi', () => {
    const b = Z.code128Barre('1234');
    assert.equal(b.moduli, 4 * 11 + 13);
    assert.equal(b.barre.length, 4 * 3 + 4, 'tre barre per simbolo, quattro nello stop');
    assert.throws(() => Z.code128Valori('caffè'), /non ammesso/);
    assert.throws(() => Z.code128Valori(''), /nessun dato/);
  });
});

describe('Label: modello ZPL e renderer', () => {
  test('segnaposto, troncamenti (predefiniti ed espliciti), caratteri ZPL ripuliti', () => {
    const z = Z.riempiModello('^XA^FO1,1^FD{COGNOME:5}|{NOME}|{SESSO}^FS^FO1,30^FD{ESAMI}^FS^XZ', { COGNOME: 'Dimostrativissima', NOME: 'Nome^Con~Caratteri', SESSO: 'Femminile', ESAMI: 'X'.repeat(80) });
    assert.match(z, /\^FDDimos\|Nome Con-Caratteri\|Fem\^FS/);
    assert.match(z, new RegExp(`\\^FD${'X'.repeat(60)}\\^FS`), 'ESAMI troncato a 60');
    assert.deepEqual(Z.segnapostoSconosciuti('^FD{COGNOME}{PIPPO}{N}{NOME:3}{ALTRO:2}^FS'), ['{PIPPO}', '{ALTRO:2}']);
  });
  test('campo vuoto tolto: barcode assente (etichetta richiesta) e testo vuoto', () => {
    const z = Z.riempiModello(MODELLO, { COGNOME: 'Persona', NOME: 'Dimostrativa', BARCODE: '', N: '1', TOT: '1' });
    assert.ok(!/\^BC/.test(z), 'nessun ^BC senza dati');
    assert.match(z, /\^FDPersona Dimostrativa\^FS/);
    assert.ok(!/\^FD\s*\^FS/.test(z));
    assert.match(z, /\^GB|\^XZ/);
  });
  test('analisi del modello predefinito: nessun comando non supportato, barcode dentro l\'etichetta', () => {
    const sql = fs.readFileSync(path.resolve(HERE, '..', 'src', 'modules', 'etichette', 'migrations', '001_init.sql'), 'utf8');
    const zpl = sql.match(/\$zpl\$([\s\S]*?)\$zpl\$/)[1];
    assert.deepEqual(Z.segnapostoSconosciuti(zpl), []);
    const a = Z.analizzaZpl(Z.riempiModello(zpl, { COGNOME: 'Persona', NOME: 'Dimostrativa', NASCITA: '01/02/1984', SESSO: 'F', ACCETTAZIONE: '2026/123', BARCODE: 'DEMO123', CONTENITORE: 'PROVETTA', MATERIALE: 'SIERO', DATA: '14/07/2026', ORA: '08:30', N: '1', TOT: '2' }), { larghezza: 400, altezza: 200 });
    assert.deepEqual(a.nonSupportati, []);
    assert.deepEqual(a.avvisi, []);
    const et = a.etichette[0];
    assert.equal(et.larghezza, 400); assert.equal(et.altezza, 200);
    const bc = et.elementi.find((e) => e.tipo === 'barcode');
    assert.equal(bc.testo, 'DEMO123');
    assert.equal(bc.larghezza, Z.code128Barre('DEMO123').moduli * 2);
    assert.ok(bc.x + bc.larghezza <= 400);
    assert.equal(et.elementi.filter((e) => e.tipo === 'testo').length, 6);
  });
  test('comandi non supportati segnalati, ^FB a capo, avvisi di uscita dall\'etichetta', () => {
    const a = Z.analizzaZpl('^XA^PW200^LL100^FO0,0^FR^A0N,20,20^FB100,2,0,C^FDuna frase lunga da andare a capo in due righe^FS^FO150,10^BY3^BCN,40,Y,N,N^FDABCDEFGH^FS~JA^XZ');
    assert.deepEqual(a.nonSupportati.sort(), ['^FR', '~JA']);
    const t = a.etichette[0].elementi.find((e) => e.tipo === 'testo');
    assert.equal(t.righe.length, 2);
    assert.ok(a.avvisi.some((x) => /esce dall'etichetta/.test(x)));
    assert.ok(a.avvisi.some((x) => /supera le 2 righe/.test(x)));
    assert.ok(Z.analizzaZpl('^FO1,1^FDx^FS').avvisi.some((x) => /\^XA/.test(x)));
  });
  test('resa SVG: una barra per ogni barra del Code 128, dimensioni in mm', () => {
    const a = Z.analizzaZpl('^XA^PW400^LL200^FO10,10^BY2^BCN,50,Y,N,N,A^FD1234^FS^FO10,120^A0N,20,20^FDTesto & <prova>^FS^FO0,0^GB400,200,3^FS^XZ');
    const svg = Z.svgEtichetta(a.etichette[0], { dpi: 203 });
    const barre = (svg.match(/<rect x="\d+(\.\d+)?" y="10" width="\d+" height="50"/g) || []).length;
    assert.equal(barre, Z.code128Barre('1234').barre.length);
    assert.match(svg, /width="50\.05mm" height="25\.02mm"/);
    assert.match(svg, /Testo &amp; &lt;prova&gt;/);
    assert.match(svg, />1234<\/text>/, 'testo in chiaro sotto il codice');
  });
  test('il renderer del browser è lo stesso file del server', () => {
    const s = fs.readFileSync(path.resolve(HERE, '..', 'src', 'modules', 'etichette', 'lib', 'zpl.js'), 'utf8');
    const w = fs.readFileSync(path.resolve(HERE, '..', '..', 'web', 'src', 'modules', 'etichette', 'lib', 'zpl.js'), 'utf8');
    assert.equal(w, s);
  });
});

describe('Label: etichette di un\'accettazione (puro)', () => {
  const acc = {
    fonte: 'COPIA',
    testata: { instance_id: 'I', id: 'R1', numero: '2026/1001', data: '2026-11-11', ora: '08:15', client_id: 'C', stato: 18, sesso_demografia: 'F' },
    righe: [
      { id: 'i1', codice: 'GLU', descrizione: 'Glucosio', cancellata: false, campioni: ['s1'] },
      { id: 'i2', codice: 'COL', descrizione: 'Colesterolo', cancellata: false, campioni: ['s1'] },
      { id: 'i3', codice: 'EMO', descrizione: 'Emocromo', cancellata: false, campioni: ['s2'] },
      { id: 'i4', codice: 'PT', descrizione: 'Tempo di protrombina', cancellata: true, campioni: ['s3'] },
      { id: 'i5', codice: 'GLU', descrizione: 'Glucosio', cancellata: false, campioni: ['s1'] },
    ],
    campioni: [
      { ord: 0, id: 's1', barcode: 'BC10011', materiale: 'SIERO', contenitore: 'PROVETTA' },
      { ord: 1, id: 's2', barcode: 'BC10012', materiale: 'SANGUE INTERO', contenitore: 'PROVETTA EDTA' },
      { ord: 2, id: 's3', barcode: 'BC10013', materiale: 'PLASMA', contenitore: 'PROVETTA CITRATO' },
      { ord: 3, id: 's4', barcode: null, materiale: 'URINE', contenitore: 'CONTENITORE STERILE' },
    ],
  };
  const paz = { cognome: 'Persona', nome: 'Dimostrativa', nascita: '1984-02-01', sesso: 'F' };
  test('una per campione con gli esami giusti; il campione delle sole righe cancellate non si stampa', () => {
    const e = A.costruisciEtichette(acc, paz, { modello: { zpl: MODELLO }, cliente: 'Cliente Prova', sede: 'PP-A Punto Prova' });
    assert.deepEqual(e.map((x) => x.barcode), ['BC10011', 'BC10012', null]);
    assert.deepEqual(e[0].esami.map((x) => x.codice), ['GLU', 'COL'], 'esami unici del campione');
    assert.deepEqual(e[1].esami.map((x) => x.codice), ['EMO']);
    assert.deepEqual(e[2].esami, [], 'campione senza righe collegate: stampato senza esami');
    assert.ok(e[2].avvisi.some((x) => /senza barcode/.test(x)));
    assert.deepEqual(e.map((x) => `${x.valori.N}/${x.valori.TOT}`), ['1/3', '2/3', '3/3']);
    assert.match(e[0].zpl, /\^FDPersona Dimostrativa\^FS/);
    assert.match(e[0].zpl, /\^FDBC10011\^FS/);
    assert.match(e[0].zpl, /\^FDn\. 01\/02\/1984 F\^FS/);
    assert.match(e[0].zpl, /\^FD11\/11\/2026 08:15 GLU COL\^FS/);
    assert.ok(!/\^BC/.test(e[2].zpl), 'senza barcode niente ^BC');
  });
  test('etichetta richiesta (impostazione) e senza paziente', () => {
    const e = A.costruisciEtichette(acc, null, { richiesta: true, modello: { zpl: MODELLO } });
    assert.equal(e.length, 4);
    assert.equal(e[3].tipo, 'RICHIESTA');
    assert.deepEqual(e[3].esami.map((x) => x.codice), ['GLU', 'COL', 'EMO']);
    assert.equal(e[0].valori.COGNOME, '');
    assert.equal(e[0].valori.SESSO, 'F', 'sesso dalla demografia se manca l\'identità');
  });
  test('tipo di ricerca e normalizzazione dei nomi', () => {
    assert.equal(RIC.tipoRicerca('2026/1001'), 'CODICE');
    assert.equal(RIC.tipoRicerca('BC10011'), 'CODICE');
    assert.equal(RIC.tipoRicerca('pe'), 'COGNOME');
    assert.equal(RIC.tipoRicerca('p'), null);
    assert.equal(RIC.normNome("  D'Àngelo  Né "), 'dangelo ne');
  });
});

// ------------------------------------------------------------------ con database
describe('Label con il server finto e il database', { skip: SALTA }, () => {
  const M = {};
  let fake, db, password, srv, base, ownerId, operId;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const giorniFa = (n) => { const d = new Date(`${oggi}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  // accettazione sintetica con paziente opt-in (il server finto toglie il paziente nella proiezione standard)
  const NOMI = [['Persona', 'Dimostrativa'], ['Esempio', 'Primo'], ['Campione', 'Seconda'], ['Esempio', 'Terzo']];
  const richiesta = (k, cliId, data, nome = NOMI[k % NOMI.length]) => {
    const r = copia(ESEMPI.optInRequest);
    r.id = `R-${k}`; r.requestNumber = `2026/${1000 + k}`; r.date = data; r.clientId = cliId; r.createdAtLocal = `${data}T08:${String(k % 60).padStart(2, '0')}:00`;
    r.patient = { ...r.patient, id: `P-${k}`, lastName: nome[0], firstName: nome[1], fiscalCode: 'NON_VALIDO_ESEMPIO' };
    r.samples = [{ ...r.samples[0], id: `S-${k}-1`, barcode: `BC${1000 + k}1`, material: 'SIERO', container: 'PROVETTA' }, { ...r.samples[0], id: `S-${k}-2`, barcode: `BC${1000 + k}2`, material: 'SANGUE INTERO', container: 'PROVETTA EDTA' }];
    r.items = [{ ...r.items[0], id: `I-${k}-1`, examCode: 'GLU', sampleIds: [`S-${k}-1`], invoiceIds: [] }, { ...r.items[0], id: `I-${k}-2`, examCode: 'EMO', description: 'Emocromo', sampleIds: [`S-${k}-2`], invoiceIds: [] }];
    r.invoiceIds = [];
    return r;
  };
  const standard = (r) => { const o = copia(r); delete o.patient; for (const i of o.items) delete i.historicalDescription; return o; };
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const studiolab = (settings) => M.conn.saveConnector('STUDIOLAB', { enabled: true, base_url: fake.url, auth_kind: 'CLIENT_JWT', credentials: { client_name: 'TDSuite', password }, settings }, null);
  const chiamateDettaglio = () => fake.stato.richieste.filter((r) => /^\/api\/v1\/data\/requests\/.+/.test(r.path)).length;
  let utente = null;   // { id, role, site_ids }
  const http = async (metodo, p, body) => {
    const r = await fetch(base + p, { method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
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
    await tr.startFresh('etichette', null);
    M.id = await import('../src/modules/etichette/lib/identita.js');
    M.diag = await import('../src/lib/diagnostica.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    // anagrafica: due sedi con il codice StudioLAB dei due client sintetici; il terzo client non è abbinato
    const org = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDPROVA', 'Gruppo Prova') RETURNING id`);
    M.sA = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('PP-A', 'Punto Prova A', 'PUNTO_PRELIEVI', 'Firenze', $1, 'CLI-A') RETURNING id`, [org.id])).id;
    M.sB = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('PP-B', 'Punto Prova B', 'PUNTO_PRELIEVI', 'Prato', $1, 'CLI-B') RETURNING id`, [org.id])).id;
    ownerId = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('titolare.etichette@prova.invalid', 'Titolare Prova', 'OWNER', 'ACTIVE') RETURNING id`)).id;
    operId = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('operatore.etichette@prova.invalid', 'Operatore Prova', 'USER', 'ACTIVE') RETURNING id`)).id;
    const cli = (x) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}`, legalName: `Cliente Prova ${x}` });
    // nella copia: 34 accettazioni recenti del client A, 2 del B, 1 del client non abbinato, 1 vecchia di 20 giorni, 1 non attiva
    const reqs = [];
    for (let k = 1; k <= 34; k++) reqs.push(richiesta(k, 'CLI-ID-A', giorniFa(k % 5)));
    reqs.push(richiesta(35, 'CLI-ID-B', oggi, ['Esempio', 'Prato']), richiesta(36, 'CLI-ID-B', giorniFa(1)));
    reqs.push(richiesta(37, 'CLI-ID-C', oggi));
    reqs.push(richiesta(38, 'CLI-ID-A', giorniFa(20)));
    reqs.push(richiesta(39, 'CLI-ID-A', oggi));
    // nel gestionale ma NON nella copia (accettazione di due minuti fa)
    M.nuova = richiesta(40, 'CLI-ID-A', oggi, ['Campione', 'Nuova']);
    fake = creaFakeSynclab({ password, retryAfter: 2, polling: 1, dati: { clients: ['A', 'B', 'C'].map(cli), exams: [copia(ESEMPI.exam)], 'price-lists': [], requests: [...reqs, M.nuova].map(copia), invoices: [] } });
    fake.url = await fake.avvia();
    await importa('clients', ['A', 'B', 'C'].map(cli));
    await importa('requests', reqs.map(standard));
    await db.query(`UPDATE synclab.requests SET disponibilita = 'ARCHIVIATO' WHERE id = 'R-39'`);
    await db.query(`INSERT INTO synclab.sync_scope (instance_id, client_name, dataset, filtri_canonici, include_patient) VALUES ('ISTANZA-DIMOSTRATIVA', 'TDSuite', 'requests', '{}', FALSE)`);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM synclab.requests WHERE patient_last_name IS NOT NULL`)).n, 0, 'copia in proiezione standard');
    // app Express minima con le route del modulo (utente del modulo simulato, come requireModuleReady)
    const stampa = (await import('../src/modules/etichette/routes/stampa.js')).default;
    const admin = (await import('../src/modules/etichette/routes/admin.js')).default;
    const app = express(); app.use(express.json());
    app.use((req, _res, nx) => { req.user = { id: utente.id }; req.moduleUser = { role: utente.role, site_ids: utente.site_ids }; nx(); });
    app.use('/api/etichette', stampa, admin);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    base = `http://127.0.0.1:${srv.address().port}/api/etichette`;
  }, { timeout: 180000 });
  after(async () => {
    await fake?.chiudi(); srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    const { modulePool } = await import('../src/lib/modules.js').catch(() => ({}));
    for (const k of ['etichette', 'nc']) await modulePool?.(k).end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  const ADMIN = () => ({ id: ownerId, role: 'ADMIN', site_ids: [] });
  const OPER_A = () => ({ id: operId, role: 'OPERATORE', site_ids: [M.sA] });

  test('modello predefinito "da validare", ADMIN al titolare, avviso e D54', async () => {
    const m = await tutti(`SELECT nome, predefinito, validato_il FROM etichette.modelli`);
    assert.equal(m.length, 1); assert.equal(m[0].nome, 'TD 50x25 (da validare)'); assert.equal(m[0].predefinito, true); assert.equal(m[0].validato_il, null);
    const [d54] = await M.diag.esegui({ ids: ['D54'] });
    assert.equal(d54.stato, 'INFO'); assert.equal(d54.n, 1);
    const core = await import('../src/modules/etichette/lib/core.js');
    assert.equal(await core.modelloValidato(), false);
    // la migrazione 001 dà ADMIN ai titolari esistenti all'avvio del modulo (il titolare del seme; quelli creati dopo il test no)
    const g = await tutti(`SELECT g.profile, u.level FROM public.grants g JOIN public.users u ON u.id = g.user_id WHERE g.module_key = 'etichette'`);
    const titolari = (await uno(`SELECT count(*)::int AS n FROM public.users WHERE level = 'OWNER' AND status = 'ACTIVE' AND id <> $1`, [ownerId])).n;
    assert.equal(g.length, titolari);
    assert.ok(g.every((x) => x.profile === 'ADMIN' && x.level === 'OWNER'));
  });

  test('ricerca per numero (esatta e normalizzata) e per barcode nella copia, con il perimetro', async () => {
    const core = await import('../src/modules/etichette/lib/core.js');
    const ctx = (u) => core.contesto({ moduleUser: { role: u.role, site_ids: u.site_ids }, user: { id: u.id } });
    let r = await RIC.cercaCodice('2026/1001', ctx(ADMIN()), { diretta: false });
    assert.equal(r.fonte, 'COPIA'); assert.equal(r.passo, 'ESATTA'); assert.equal(r.risultati.length, 1);
    assert.equal(r.risultati[0].provette, 2); assert.equal(r.risultati[0].sede, 'PP-A Punto Prova A'); assert.equal(r.risultati[0].cliente, 'Cliente Prova A');
    r = await RIC.cercaCodice('2026-1001', ctx(ADMIN()), { diretta: false });
    assert.equal(r.passo, 'NORMALIZZATA'); assert.equal(r.risultati[0].id, 'R-1');
    r = await RIC.cercaCodice('BC10352', ctx(ADMIN()), { diretta: false });
    assert.equal(r.risultati[0].id, 'R-35', 'barcode del secondo campione');
    // operatore della sede A: l'accettazione della sede B è fuori perimetro (contata, non mostrata)
    r = await RIC.cercaCodice('BC10352', ctx(OPER_A()), { diretta: false });
    assert.equal(r.risultati.length, 0); assert.equal(r.fuori, 1);
    // client non abbinato a una sede: solo l'ADMIN
    assert.equal((await RIC.cercaCodice('2026/1037', ctx(OPER_A()), { diretta: false })).fuori, 1);
    assert.equal((await RIC.cercaCodice('2026/1037', ctx(ADMIN()), { diretta: false })).risultati.length, 1);
  });

  test('Data API spenta: nessuna chiamata al gestionale, messaggio chiaro', async () => {
    const core = await import('../src/modules/etichette/lib/core.js');
    const prima = fake.stato.richieste.length;
    const r = await RIC.cercaCodice('2026/1040', core.contesto({ moduleUser: { role: 'ADMIN' }, user: { id: ownerId } }));
    assert.equal(r.risultati.length, 0); assert.match(r.messaggio, /non è disponibile/);
    assert.equal(fake.stato.richieste.length, prima);
    const g = await M.id.giroIdentita({ forza: true });
    assert.equal(g.skipped, true);
  });

  test('identità recenti: limite di 30 chiamate per giro, solo client abbinati, recenti e attive; CF mai salvato', async () => {
    await studiolab({ data_api_enabled: true });
    const prima = chiamateDettaglio();
    const g1 = await M.id.giroIdentita({ forza: true });
    assert.equal(g1.chiamate, 30); assert.equal(g1.salvate, 30);
    assert.equal(chiamateDettaglio() - prima, 30, 'al più 30 chiamate per giro');
    const g2 = await M.id.giroIdentita({ forza: true });
    // restano 34 + 2 (A e B) - 30 = 6: non il client non abbinato, non quella di 20 giorni fa, non quella archiviata
    assert.equal(g2.chiamate, 6);
    const ids = (await tutti(`SELECT request_id FROM etichette.pazienti_recenti`)).map((x) => x.request_id);
    assert.ok(!ids.includes('R-37') && !ids.includes('R-38') && !ids.includes('R-39'));
    assert.equal(ids.length, 36);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM etichette.pazienti_recenti WHERE cf IS NOT NULL`)).n, 0);
    await assert.rejects(db.query(`UPDATE etichette.pazienti_recenti SET cf = 'X' WHERE request_id = 'R-1'`), /check/i, 'il vincolo impedisce il CF');
    const p = await uno(`SELECT cognome, nome, nascita::text AS nascita, sesso FROM etichette.pazienti_recenti WHERE request_id = 'R-4'`);
    assert.deepEqual(p, { cognome: 'Persona', nome: 'Dimostrativa', nascita: '1984-02-01', sesso: 'F' });
    // nulla nella copia synclab, nessun nome nel registro dei connettori, percorsi senza query
    assert.equal((await uno(`SELECT count(*)::int AS n FROM synclab.requests WHERE patient_last_name IS NOT NULL OR raw::text ILIKE '%Dimostrativa%'`)).n, 0);
    const log = await tutti(`SELECT endpoint, message FROM public.connector_log WHERE module = 'synclab'`);
    assert.ok(log.length > 0);
    assert.ok(log.every((x) => !/Persona|Dimostrativa|Esempio|Campione|NON_VALIDO/i.test(`${x.endpoint} ${x.message}`)));
    assert.ok(log.every((x) => !/\?/.test(x.endpoint)));
    const st = await M.id.statoJob();
    assert.ok(st.ultimo_ok); assert.equal(st.esito.chiamate, 6);
    // fuori orario il giro si salta (senza forza)
    const notte = new Date(`${oggi}T02:30:00Z`);
    assert.equal((await M.id.giroIdentita({ adesso: notte })).skipped, true);
  });

  test('purga: identità e letture dirette più vecchie di N giorni', async () => {
    await db.query(`INSERT INTO etichette.pazienti_recenti (instance_id, request_id, cognome, nome, data_accettazione, letto_il) VALUES
      ('ISTANZA-DIMOSTRATIVA', 'VECCHIA-1', 'Esempio', 'Vecchio', $1, now()), ('ISTANZA-DIMOSTRATIVA', 'VECCHIA-2', 'Esempio', 'Letto', $2, now() - interval '9 days')`, [giorniFa(8), oggi]);
    const n = await M.id.purga(7);
    assert.equal(n.identita, 2);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM etichette.pazienti_recenti WHERE request_id LIKE 'VECCHIA%'`)).n, 0);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM etichette.pazienti_recenti`)).n, 36, 'le recenti restano');
  });

  test('ricerca per cognome (parziale, con nome e data) solo sulle identità recenti, con il perimetro', async () => {
    const core = await import('../src/modules/etichette/lib/core.js');
    const ctx = (u) => core.contesto({ moduleUser: { role: u.role, site_ids: u.site_ids }, user: { id: u.id } });
    let r = await RIC.cercaCognome('pers', ctx(ADMIN()));
    assert.ok(r.risultati.length >= 9 && r.risultati.every((x) => x.cognome === 'Persona'));
    r = await RIC.cercaCognome('esempio pr', ctx(ADMIN()));
    assert.ok(r.risultati.length > 0 && r.risultati.every((x) => x.nome === 'Primo' || x.nome === 'Prato'));
    assert.ok(r.risultati.some((x) => x.id === 'R-35'));
    r = await RIC.cercaCognome('esempio pr', ctx(OPER_A()));
    assert.ok(r.risultati.every((x) => x.site_id === M.sA)); assert.equal(r.fuori, 1, 'R-35 della sede B nascosta');
    r = await RIC.cercaCognome('esempio', ctx(ADMIN()), { data: oggi });
    assert.ok(r.risultati.length > 0 && r.risultati.every((x) => x.data === oggi));
    assert.equal((await RIC.cercaCognome('p', ctx(ADMIN()))).risultati.length, 0);
  });

  test('lettura diretta dal gestionale (202 e polling): accettazione di due minuti fa per numero e per barcode', async () => {
    const core = await import('../src/modules/etichette/lib/core.js');
    const ctx = core.contesto({ moduleUser: { role: 'OPERATORE', site_ids: [M.sA] }, user: { id: operId } });
    const r = await RIC.cercaCodice('2026/1040', ctx);
    assert.equal(r.fonte, 'GESTIONALE'); assert.equal(r.passo, 'GESTIONALE_NUMERO');
    assert.equal(r.risultati.length, 1); assert.equal(r.risultati[0].cognome, 'Campione'); assert.equal(r.risultati[0].provette, 2);
    const q = fake.stato.richieste.filter((x) => x.path === '/api/v1/data/requests' && x.query.requestNumber === '2026/1040');
    assert.ok(q.length >= 2 && q.some((x) => x.query.cursor), '202 e ripetizione con il cursor');
    assert.equal(q[0].query.includePatient, 'true');
    const d = await uno(`SELECT raw FROM etichette.accettazioni_dirette WHERE id = 'R-40'`);
    assert.ok(!d.raw.patient && !JSON.stringify(d.raw).includes('Campione'), 'la lettura diretta si salva senza paziente');
    // la seconda volta non serve il gestionale
    const prima = fake.stato.richieste.length;
    assert.equal((await RIC.cercaCodice('BC10402', ctx)).risultati[0].id, 'R-40');
    assert.equal(fake.stato.richieste.length, prima);
    // per barcode, direttamente nel gestionale (accettazione tolta dalle letture)
    await db.query(`DELETE FROM etichette.accettazioni_dirette`);
    const b = await RIC.cercaCodice('BC10401', ctx);
    assert.equal(b.passo, 'GESTIONALE_BARCODE'); assert.equal(b.risultati[0].id, 'R-40');
    assert.match((await RIC.cercaCodice('2026/9999', ctx)).messaggio, /né nella copia/);
  });

  test('API: cerca, anteprima con le etichette, perimetro, stampa e ristampa nel registro senza nomi', async () => {
    utente = OPER_A();
    let x = await http('GET', `/cerca?q=${encodeURIComponent('2026/1002')}`);
    assert.equal(x.s, 200); assert.equal(x.j.risultati.length, 1);
    const { instance_id: inst, id } = x.j.risultati[0];
    x = await http('GET', `/accettazioni/${encodeURIComponent(inst)}/${id}`);
    assert.equal(x.s, 200);
    assert.equal(x.j.etichette.length, 2);
    assert.deepEqual(x.j.etichette.map((e) => e.barcode), ['BC10021', 'BC10022']);
    assert.deepEqual(x.j.etichette[1].esami.map((e) => e.codice), ['EMO']);
    assert.match(x.j.etichette[0].zpl, /\^FDBC10021\^FS/);
    assert.equal(x.j.paziente.cognome, 'Campione'); assert.equal(x.j.modello.nome, 'TD 50x25 (da validare)');
    // fuori perimetro
    x = await http('GET', `/accettazioni/${encodeURIComponent(inst)}/R-35`);
    assert.equal(x.s, 403);
    // apertura di un'accettazione senza identità: lettura puntuale (una chiamata)
    await db.query(`DELETE FROM etichette.pazienti_recenti WHERE request_id = 'R-3'`);
    M.id.azzeraAperture();
    const c0 = chiamateDettaglio();
    x = await http('GET', `/accettazioni/${encodeURIComponent(inst)}/R-3`);
    assert.equal(x.j.paziente_esito, 'LETTA'); assert.equal(chiamateDettaglio() - c0, 1);
    // stampa e ristampa
    x = await http('POST', '/stampe', { instance_id: inst, request_id: id, etichette: 2, copie: 1, stampante: 'ZD421 Prova', metodo: 'ZEBRA', esito: 'OK' });
    assert.equal(x.s, 200); assert.equal(x.j.ristampa, false);
    x = await http('POST', '/stampe', { instance_id: inst, request_id: id, etichette: 1, copie: 2, stampante: 'ZD421 Prova', metodo: 'ZEBRA', esito: 'OK' });
    assert.equal(x.j.ristampa, true);
    x = await http('POST', '/stampe', { instance_id: inst, request_id: id, etichette: 2, metodo: 'ZEBRA', esito: 'ERRORE', errore: 'Browser Print non trovato' });
    assert.equal(x.s, 200);
    assert.equal((await http('POST', '/stampe', { instance_id: inst, request_id: 'R-35', etichette: 2, esito: 'OK' })).s, 403);
    assert.equal((await http('POST', '/stampe', { etichette: 1, metodo: 'PROVA', esito: 'OK' })).s, 403, 'prova solo ADMIN');
    // registro: niente dati del paziente nelle colonne né nell'audit
    const righe = await tutti(`SELECT * FROM etichette.stampe ORDER BY id`);
    assert.equal(righe.length, 3);
    assert.deepEqual(righe.map((r) => [r.esito, r.ristampa, r.site_id]), [['OK', false, M.sA], ['OK', true, M.sA], ['ERRORE', true, M.sA]]);
    assert.ok(righe.every((r) => !/Esempio|Primo|Persona|Dimostrativa|Campione/.test(JSON.stringify(r))));
    const au = await tutti(`SELECT action, label, data FROM public.audit_log WHERE module_key = 'etichette' ORDER BY id`);
    assert.deepEqual(au.map((a) => a.action), ['ETICHETTE_STAMPA', 'ETICHETTE_STAMPA']);
    assert.equal(au[0].label, 'Etichette stampate per l\'accettazione 2026/1002: 2 provette, sede PP-A Punto Prova A, stampante ZD421 Prova');
    assert.match(au[1].label, /ristampate.*1 provetta × 2 copie/);
    assert.ok(au.every((a) => !/Esempio|Primo|Persona|Dimostrativa/.test(JSON.stringify(a))));
    // il registro è dell'ADMIN
    assert.equal((await http('GET', '/registro')).s, 403);
    utente = ADMIN();
    x = await http('GET', '/registro');
    assert.equal(x.j.totale, 3); assert.equal(x.j.etichette, 4); assert.equal(x.j.righe[0].utente, 'Operatore Prova');
    assert.equal((await http('GET', '/registro?esito=ERRORE')).j.totale, 1);
  });

  test('modelli: avvisi dell\'editor, validazione (tolta se cambia il disegno), modello per sede, impostazioni', async () => {
    utente = ADMIN();
    let x = await http('POST', '/modelli', { nome: 'Prova 40x20', larghezza_mm: 40, altezza_mm: 20, dpi: 300, zpl: '^XA^FO10,10^FR^A0N,30,30^FD{COGNOME}{PIPPO}^FS^XZ' });
    assert.equal(x.s, 200);
    assert.deepEqual(x.j.controllo.non_supportati, ['^FR']); assert.deepEqual(x.j.controllo.segnaposto_sconosciuti, ['{PIPPO}']);
    const idN = x.j.id;
    assert.equal((await http('POST', '/modelli', { nome: 'Vuoto', larghezza_mm: 40, altezza_mm: 20, dpi: 203, zpl: '^FO1,1^FDx^FS' })).s, 400);
    assert.equal((await http('POST', `/modelli/${idN}/valida`, { nota: 'no' })).s, 400, 'nota obbligatoria');
    x = await http('POST', `/modelli/${idN}/valida`, { nota: 'Confrontato con l\'etichetta StudioLab e letto dagli strumenti' });
    assert.ok(x.j.validato_il);
    const [d54] = await M.diag.esegui({ ids: ['D54'] });
    assert.equal(d54.stato, 'OK');
    x = await http('PUT', `/modelli/${idN}`, { nome: 'Prova 40x20', larghezza_mm: 40, altezza_mm: 20, dpi: 300, zpl: '^XA^FO12,10^A0N,30,30^FD{COGNOME}^FS^XZ' });
    assert.equal(x.j.validazione_tolta, true); assert.equal(x.j.validato_il, null);
    // modello della sede A
    x = await http('PUT', '/impostazioni', { modelli_sede: [{ site_id: M.sA, modello_id: idN }], etichetta_richiesta: true });
    assert.equal(x.s, 200);
    x = await http('GET', `/accettazioni/ISTANZA-DIMOSTRATIVA/R-2`);
    assert.equal(x.j.modello.id, idN); assert.equal(x.j.etichette.length, 3, 'due campioni + etichetta richiesta');
    assert.equal(x.j.etichette[2].tipo, 'RICHIESTA');
    // meno giorni di identità: purga immediata
    await db.query(`UPDATE etichette.pazienti_recenti SET data_accettazione = $1 WHERE request_id = 'R-4'`, [giorniFa(3)]);
    x = await http('PUT', '/impostazioni', { giorni_identita: 2 });
    assert.ok(x.j.purgate.identita >= 1);
    assert.equal((await http('PUT', '/impostazioni', { giorni_identita: 31 })).s, 400);
    x = await http('GET', '/impostazioni');
    assert.equal(x.j.giorni_identita, 2); assert.equal(x.j.etichetta_richiesta, true);
    assert.ok(x.j.sedi.some((s) => s.id === M.sA && s.modello_id === idN));
    // operatore: niente modelli né impostazioni
    utente = OPER_A();
    assert.equal((await http('GET', '/modelli')).s, 403);
    assert.equal((await http('PUT', '/impostazioni', { giorni_identita: 5 })).s, 403);
  });

  test('D55: identità ferme con modulo LIVE, Data API accesa, in orario di lavoro', async () => {
    const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
    await db.query(`UPDATE public.module_state SET live_since = now() - interval '1 day' WHERE key = 'etichette'`);
    await db.query(`UPDATE public.connectors SET enabled = TRUE, auth_kind = 'CLIENT_JWT', settings = settings || '{"data_api_enabled": true}'::jsonb WHERE kind = 'STUDIOLAB'`);
    await db.query(`UPDATE etichette.job_stato SET ultimo_ok = now() - interval '3 hours' WHERE nome = 'identita'`);
    let [d] = await M.diag.esegui({ ids: ['D55'] });
    assert.equal(d.stato, h >= 8 && h <= 21 ? 'ATTENZIONE' : 'OK', `ora di Roma ${h}`);
    await db.query(`UPDATE etichette.job_stato SET ultimo_ok = now() WHERE nome = 'identita'`);
    [d] = await M.diag.esegui({ ids: ['D55'] });
    assert.equal(d.stato, 'OK');
  });
});
