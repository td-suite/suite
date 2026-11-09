// Riordino di Retail (decisione del CEO del 09/11/2026 sera): cruscotto complessivo, sezione B2C (TuoTempo + GIPO) e sezione B2B (tutto da
// StudioLab). Dati: solo sintetici, dalla forma degli esempi di CB Sistemi (test/helpers/fakeSynclab.mjs, ESEMPI) con client abbinati a sedi
// TD (Laboratorio in sede), a una Legal entity esterna e non abbinati. Parte pura (link e rotte del front-end, via lettura dei file) sempre;
// parte con database (DATABASE_URL_TEST, database temporaneo suite_rt_<pid>) solo se la variabile c'è.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import ExcelJS from 'exceljs';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
const copia = (o) => JSON.parse(JSON.stringify(o));
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_rt_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', 'web', 'src');
const leggi = (p) => fs.readFileSync(path.join(WEB, p), 'utf8');
const tutti = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? tutti(path.join(dir, d.name)) : /\.(jsx?|mjs)$/.test(d.name) ? [path.join(dir, d.name)] : []));

describe('Riordino di Retail: menu, rotte e link (lettura dei file)', () => {
  test('menu in tre parti: Cruscotto, B2C, B2B, Dati e amministrazione', async () => {
    const meta = (await import(path.join(WEB, 'modules/retail/meta.js'))).default;
    const gruppi = meta.nav.filter((x) => x.group).map((x) => x.group);
    assert.deepEqual(gruppi, ['B2C · centri medici e punti prelievo (TuoTempo + GIPO)', 'B2B · service e medicina del lavoro (StudioLab)', 'Dati e amministrazione']);
    const voci = meta.nav.filter((x) => !x.group).map((x) => x.to);
    for (const v of ['', 'b2c', 'b2c/clienti', 'b2c/richiami', 'b2c/prodotti', 'b2c/listino-online', 'b2c/vendite', 'b2c/prenotazioni', 'b2c/laboratorio', 'b2c/campagne', 'b2c/promozioni',
      'b2c/esposizione', 'b2c/sedi', 'b2c/budget', 'b2b', 'b2b/clienti', 'b2b/produzione', 'b2b/fatturato', 'b2b/listini', 'b2b/profilo-pazienti', 'b2b/budget', 'import', 'connettori', 'impostazioni', 'audit']) assert.ok(voci.includes(v), `voce ${v}`);
    assert.equal(meta.nav.find((x) => x.to === 'b2c/laboratorio').flag, 'laboratorio_in_sede', 'Laboratorio in sede visibile solo con l\'impostazione');
  });
  test('redirect dalle vecchie rotte verso le nuove (link salvati, Cockpit, Home)', () => {
    const idx = leggi('modules/retail/index.jsx');
    for (const [da, a] of [['clienti', 'b2c/clienti'], ['clienti/b2b', 'b2b/clienti'], ['profilo-pazienti', 'b2b/profilo-pazienti'], ['vendite', 'b2c/vendite'], ['richiami', 'b2c/richiami'],
      ['prodotti', 'b2c/prodotti'], ['listino-online', 'b2c/listino-online'], ['budget', 'b2c/budget'], ['campagne', 'b2c/campagne'], ['promozioni', 'b2c/promozioni'], ['esposizione', 'b2c/esposizione'], ['sedi', 'b2c/sedi']]) {
      assert.match(idx, new RegExp(`\\['${da.replace('/', '\\/')}', '${a.replace('/', '\\/')}'\\]`), `redirect ${da} → ${a}`);
    }
    for (const p of ['clienti/:id', 'campagne/:id', 'promozioni/:id', 'esposizione/:id', 'sedi/:id']) assert.ok(idx.includes(`'${p}'`), `redirect con parametro ${p}`);
  });
  test('nessun link interno alle vecchie rotte (grep su web/src e server/src)', () => {
    // ${base} vale /retail solo dentro il modulo Retail; altrove si cercano i percorsi assoluti /retail/...
    const rotte = '(clienti|profilo-pazienti|vendite|richiami|prodotti|listino-online|budget|campagne|promozioni|esposizione|sedi)\\b';
    const assolute = new RegExp(`(?<!/api)/retail/${rotte}`), relative = new RegExp(`\\$\\{base\\}/${rotte}`);
    const modRetail = path.join(WEB, 'modules', 'retail');
    const file = [...tutti(WEB), ...tutti(path.resolve(HERE, '..', 'src'))].filter((f) => !f.endsWith(path.join('modules', 'retail', 'index.jsx')));
    const trovati = [];
    for (const f of file) fs.readFileSync(f, 'utf8').split('\n').forEach((riga, i) => { if (assolute.test(riga) || (f.startsWith(modRetail) && relative.test(riga))) trovati.push(`${path.relative(path.resolve(HERE, '..', '..'), f)}:${i + 1}`); });
    assert.deepEqual(trovati, [], `link alle vecchie rotte: ${trovati.join(', ')}`);
  });
});

describe('Riordino di Retail con database e dati Synclab sintetici', { skip: SALTA }, () => {
  const M = {};
  let db, srv, baseApp;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const RIC = (o) => { const r = copia(ESEMPI.standardRequest); delete r.patient; return { ...r, invoiceIds: [], samples: [], ...o, items: (o.items || r.items).map((x) => ({ ...x, invoiceIds: [], sampleIds: [] })) }; };
  const riga = (id, code, netto, extra = {}) => ({ ...copia(ESEMPI.standardRequest.items[0]), id, examCode: code, description: `Esame ${code}`, netUnitPriceExcludingVat: netto, quantity: 1, deleted: false, ...extra });
  const DOC = (o) => ({ ...copia(ESEMPI.invoice), requestIds: [], items: [], ...o });
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const get = async (p) => { const r = await fetch(`${baseApp}${p}`); const j = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer(); if (r.status >= 400) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j; };
  const send = async (m, p, body) => { const r = await fetch(`${baseApp}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('retail', null); await tr.startFresh('business', null); await tr.startFresh('nc', null);
    M.pers = await import('../src/lib/synclab/persistenza.js');
    M.let = await import('../src/lib/synclab/letture.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    // anagrafica: Legal entity di TD (Dati aziendali), due sedi TD con codice StudioLAB, una Legal entity esterna CLIENTE con la sua sede SERVICE
    const td = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDPROVA', 'Società Prova TD') RETURNING id`);
    await db.query(`INSERT INTO public.app_settings (key, value) VALUES ('company_org_id', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(td.id)]);
    M.td = td.id;
    M.sA = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-A', 'Punto Prova Firenze', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1, 'CLI-A') RETURNING id`, [td.id])).id;
    M.sB = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-B', 'Punto Prova Prato', 'PUNTO_PRELIEVI', 'Prato', 'PO', $1, 'CLI-B') RETURNING id`, [td.id])).id;
    M.est = (await uno(`INSERT INTO public.organizations (kind, code, name, vat_number) VALUES ('CLIENTE', 'EST01', 'Struttura Esterna Prova', '11111111111') RETURNING id`)).id;
    await db.query(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('SRV-E', 'Struttura Esterna Prova (service)', 'SERVICE', 'Lucca', 'LU', $1, 'CLI-E')`, [M.est]);
    // Business Hub: account SRV del cliente esterno attivo con un listino (GLU offerto 9,50)
    const acc = await uno(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente) VALUES ($1, 'SRV', FALSE, TRUE, 7) RETURNING id`, [M.est]);
    await db.query(`INSERT INTO business.listini (account_id, versione, filename, mapping, righe, riepilogo) VALUES ($1, 1, 'listino-prova.xlsx', '{}', $2, '{}')`,
      [acc.id, JSON.stringify([{ codice: 'GLU', descrizione: 'Glucosio', listino: 12, offerto: 9.5 }, { codice: 'ALT', descrizione: 'Altro', listino: 20 }])]);
    // client Synclab: A e B (sedi TD), E (Legal entity esterna, listino base QkFTRQ con GLU netto 10), N (nessun abbinamento)
    const cli = (x, o = {}) => ({ ...copia(ESEMPI.client), id: `CLI-ID-${x}`, clientCode: `CLI-${x}`, legalName: `Client Prova ${x}`, vatNumber: '00000000000', ...o });
    await importa('clients', [cli('A'), cli('B'), cli('E'), cli('N', { priceListId: null })]);
    await importa('exams', [copia(ESEMPI.exam)]);
    await importa('price-lists', [copia(ESEMPI.priceList)]);
    const r = [];
    let k = 0;
    const add = (cliId, date, items, o = {}) => r.push(RIC({ id: `R-${++k}`, requestNumber: `2026/RT${k}`, date, clientId: cliId, createdAtLocal: `${date}T08:00:00`, demographics: { ageYears: 40, sex: 'F', city: 'Firenze', province: 'FI' }, items, ...o }));
    // ottobre 2026: A 3 accettazioni, B 1, E 2 (GLU a 9 e ALT a 18, + una riga cancellata), N nessuna
    for (let i = 0; i < 3; i++) add('CLI-ID-A', '2026-10-05', [riga(`a${i}`, 'GLU', 12)]);
    add('CLI-ID-B', '2026-10-06', [riga('b0', 'GLU', 12), riga('b1', 'ALT', null)]);
    add('CLI-ID-E', '2026-10-07', [riga('e0', 'GLU', 9), riga('e1', 'ALT', 18), riga('e2', 'GLU', 9, { deleted: true })], { demographics: { ageYears: 50, sex: 'M', city: 'Pisa', province: 'PI' } });
    add('CLI-ID-E', '2026-10-08', [riga('e3', 'GLU', 9)], { demographics: { ageYears: 51, sex: 'M', city: 'Lucca', province: 'LU' } });
    // ottobre 2025: E 5 accettazioni (calo del 60% sugli esami, del 64% sul valore), A 1
    for (let i = 0; i < 5; i++) add('CLI-ID-E', '2025-10-10', [riga(`ep${i}`, 'GLU', 10)]);
    add('CLI-ID-A', '2025-10-11', [riga('ap0', 'GLU', 12)]);
    // agosto 2026: N una accettazione (poi ferma: oltre 60 giorni al 09/11/2026)
    add('CLI-ID-N', '2026-08-15', [riga('n0', 'GLU', 15)]);
    await importa('requests', r);
    // documenti: E fattura 100 (due righe: si conta una volta), nota di credito −20, annullata 500, tipo sconosciuto 7; N fattura 50
    await importa('invoices', [
      DOC({ id: 'D1', invoiceNumber: '2026/F1', clientId: 'CLI-ID-E', date: '2026-10-31', netRevenueContribution: 100, total: 100, items: [{ ...ESEMPI.invoice.items[0], id: 'i1' }, { ...ESEMPI.invoice.items[0], id: 'i2' }] }),
      DOC({ id: 'D2', invoiceNumber: '2026/NC1', clientId: 'CLI-ID-E', date: '2026-10-31', documentType: 'credit_note', netRevenueContribution: -20, total: -20 }),
      DOC({ id: 'D3', invoiceNumber: '2026/F2', clientId: 'CLI-ID-E', date: '2026-10-20', cancelled: true, netRevenueContribution: 0, total: 500 }),
      DOC({ id: 'D4', invoiceNumber: '2026/X1', clientId: 'CLI-ID-E', date: '2026-10-21', documentType: 'unknown', netRevenueContribution: null, total: 7 }),
      DOC({ id: 'D5', invoiceNumber: '2026/F3', clientId: 'CLI-ID-N', date: '2026-08-31', netRevenueContribution: 50, total: 50 }),
    ]);
    // GIPO (B2C): due accettazioni di ottobre 2026 (una fuori area), una di ottobre 2025
    const c1 = await uno(`INSERT INTO retail.customers (kind, last_name, first_name, city, province) VALUES ('B2C', 'Prova', 'Uno', 'Firenze', 'FI') RETURNING id`);
    const c2 = await uno(`INSERT INTO retail.customers (kind, last_name, first_name, city, province) VALUES ('B2C', 'Prova', 'Due', 'Bologna', 'BO') RETURNING id`);
    const v = (ref, data, cust, net) => db.query(`INSERT INTO retail.sales (source, external_ref, sale_date, customer_id, site_id, product_code, quantity, net_amount) VALUES ('GIPO', $1, $2, $3, $4, 'PRE01', 1, $5)`, [ref, data, cust, M.sA, net]);
    await v('G1', '2026-10-03', c1.id, 30); await v('G2', '2026-10-04', c2.id, 45); await v('G0', '2025-10-04', c1.id, 25);
    // app Express minima con le route del modulo Retail (utente del modulo simulato, ADMIN)
    const app = express(); app.use(express.json());
    app.use((req, _res, nx) => { req.user = { id: null, role: 'ADMIN', site_ids: [] }; req.suiteUser = { level: 'OWNER' }; nx(); });
    app.use('/api/retail/b2b', (await import('../src/modules/retail/routes/b2b.js')).default);
    app.use('/api/retail/stats', (await import('../src/modules/retail/routes/stats.js')).default);
    app.use('/api/retail/laboratorio', (await import('../src/modules/retail/routes/laboratorio.js')).default);
    app.use('/api/retail/prenotazioni', (await import('../src/modules/retail/routes/prenotazioni.js')).default);
    app.use('/api/retail', (await import('../src/modules/retail/routes/admin.js')).default);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    baseApp = `http://127.0.0.1:${srv.address().port}`;
  }, { timeout: 180000 });
  after(async () => {
    srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('ripartizione B2C/B2B dei client Synclab (impostazione vera e falsa)', async () => {
    const rip = Object.fromEntries((await M.let.ripartizioneClienti()).map((c) => [c.client_code, c]));
    assert.deepEqual([rip['CLI-A'].ripartizione, rip['CLI-B'].ripartizione, rip['CLI-E'].ripartizione, rip['CLI-N'].ripartizione], ['LAB_SEDE', 'LAB_SEDE', 'B2B', 'B2B']);
    assert.equal(rip['CLI-E'].chiave, String(M.est)); assert.equal(rip['CLI-N'].chiave, 'c-CLI-ID-N');
    assert.equal(rip['CLI-N'].stato_abbinamento, 'DA_ABBINARE');
    assert.equal(rip['CLI-E'].perimetro_b2b, true, 'Legal entity CLIENTE attiva nel Business Hub');
    const tuttoB2B = await M.let.ripartizioneClienti({ privatiInB2c: false });
    assert.ok(tuttoB2B.every((c) => c.ripartizione === 'B2B'));
  });

  test('cruscotto di rete: GIPO, Laboratorio in sede, B2B affiancati con l\'anno prima e i connettori', async () => {
    const q = await M.let.quadroLaboratorio({ da: '2026-10-01', a: '2026-10-31' });
    assert.deepEqual([q.LAB_SEDE.accettazioni, q.LAB_SEDE.esami, q.LAB_SEDE.valore, q.LAB_SEDE.righe_senza_prezzo], [4, 5, 48, 1]);
    assert.deepEqual([q.B2B.accettazioni, q.B2B.esami, q.B2B.valore, q.B2B.clienti], [2, 3, 36, 1], 'la riga cancellata non conta');
    assert.deepEqual([q.B2B.documenti.fatturato, q.B2B.documenti.importo_nc, q.B2B.documenti.annullati, q.B2B.documenti.tipo_sconosciuto], [80, -20, 1, 1]);
    assert.deepEqual([q.B2B.anno_prima.accettazioni, q.LAB_SEDE.anno_prima.accettazioni], [5, 1]);
    assert.equal(q.B2B.var_accettazioni, -60);
    const rete = await get('/api/retail/stats/rete?periodo=2026-10');
    assert.deepEqual([rete.b2c.gipo.accettazioni, rete.b2c.gipo.vendite, rete.b2c.gipo.anno_prima.accettazioni], [2, 75, 1]);
    assert.equal(rete.b2c.gipo.fuori_area.quota, 50, 'Bologna (BO) per una sede di Firenze (FI)');
    assert.equal(rete.b2c.laboratorio.accettazioni, 4); assert.equal(rete.b2b.synclab.accettazioni, 2); assert.equal(rete.b2b.synclab.documenti.fatturato, 80);
    assert.equal(rete.b2b.synclab.fuori_area.fuori, 1, 'Pisa (PI) per la sede SERVICE di Lucca (LU); Lucca è lo stesso comune');
    assert.equal(rete.b2c.tuotempo.prenotazioni, null, 'prenotazioni non disponibili: nessun numero inventato');
    assert.deepEqual(rete.connettori.map((c) => c.chiave), ['GIPO', 'TUOTEMPO', 'SYNCLAB']);
  });

  test('cruscotto B2B: clienti del mese, top 10, in calo oltre il 20%, fermi da 60 giorni, non abbinati', async () => {
    const c = await M.let.cruscottoB2B({ mese: '2026-10', oggi: '2026-11-09' });
    assert.deepEqual([c.kpi.clienti, c.kpi.accettazioni, c.kpi.esami, c.kpi.valore, c.kpi.fatturato.fatturato], [1, 2, 3, 36, 80]);
    assert.equal(c.top10[0].chiave, String(M.est));
    assert.equal(c.in_calo.length, 1); assert.equal(c.in_calo[0].base, 'valore'); assert.equal(c.in_calo[0].variazione, -28, '36 contro 50');
    assert.deepEqual(c.senza_produzione.map((x) => [x.chiave, x.giorni]), [['c-CLI-ID-N', 86]]);
    assert.deepEqual(c.non_abbinati.map((x) => [x.client_code, x.accettazioni_12m]), [['CLI-N', 1]]);
    const j = await get('/api/retail/b2b/cruscotto?mese=2026-10');
    assert.equal(j.kpi.clienti, 1); assert.ok(j.fonte.includes('Synclab')); assert.ok('ultimo_checkpoint' in j.stato);
  });

  test('produzione per cliente e mese, export Excel', async () => {
    const p = await M.let.produzioneClientiMesi({ da: '2026-08-01', a: '2026-10-31' });
    assert.deepEqual(p.mesi, ['2026-08', '2026-09', '2026-10']);
    const e = p.clienti.find((x) => x.chiave === String(M.est)), n = p.clienti.find((x) => x.chiave === 'c-CLI-ID-N');
    assert.deepEqual([e.mesi['2026-10'].esami, e.mesi['2026-10'].valore, e.totale.accettazioni], [3, 36, 2]);
    assert.equal(n.mesi['2026-08'].valore, 15); assert.equal(n.cliente, 'Client Prova N');
    assert.ok(!p.clienti.some((x) => x.chiave === String(M.td)), 'il Laboratorio in sede non è nel B2B');
    const tutte = await M.let.produzioneClientiMesi({ da: '2026-10-01', a: '2026-10-31', ripartizione: null });
    assert.equal(tutte.totale.accettazioni, 6);
    const buf = await get('/api/retail/b2b/produzione/export.xlsx?da=2026-08-01&a=2026-10-31');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(buf));
    const ws = wb.getWorksheet('Produzione cliente × mese');
    assert.equal(ws.getRow(1).getCell(1).value, 'Cliente');
    assert.equal(ws.rowCount, 3, 'intestazione + 2 clienti B2B');
    assert.ok(wb.getWorksheet('Note'));
  });

  test('fatturato per cliente: una volta per documento, NC separate, annullati e tipo sconosciuto esclusi e contati', async () => {
    const f = await M.let.fatturatoClientiMesi({ da: '2026-08-01', a: '2026-10-31' });
    const e = f.clienti.find((x) => x.chiave === String(M.est));
    assert.deepEqual([e.totale.fatturato_fatture, e.totale.importo_nc, e.totale.fatturato, e.totale.annullati, e.totale.tipo_sconosciuto, e.totale.documenti], [100, -20, 80, 1, 1, 4]);
    assert.equal(f.totale.fatturato, 130);
    const j = await get('/api/retail/b2b/fatturato?da=2026-08-01&a=2026-10-31');
    assert.equal(j.totale.fatturato, 130); assert.match(j.regola, /una volta per documento/);
  });

  test('listini applicati: prezzo netto medio vs listino Synclab corrente vs listino del Business Hub', async () => {
    const rows = await M.let.prezziApplicati({ da: '2026-10-01', a: '2026-10-31' });
    const glu = rows.find((x) => x.chiave === String(M.est) && x.codice === 'GLU');
    assert.deepEqual([glu.prezzo_medio, glu.quantita, glu.listino_synclab, glu.scost_synclab, glu.scost_synclab_pct], [9, 2, 10, -1, -10]);
    const j = await get('/api/retail/b2b/listini?da=2026-10-01&a=2026-10-31');
    const g2 = j.righe.find((x) => x.chiave === String(M.est) && x.codice === 'GLU');
    assert.deepEqual([g2.listino_hub, g2.versione_hub, g2.scost_hub], [9.5, 1, -0.5]);
    const alt = j.righe.find((x) => x.chiave === String(M.est) && x.codice === 'ALT');
    assert.equal(alt.listino_hub, 20, 'senza offerto vale il prezzo di listino');
    assert.equal(alt.listino_synclab, null, 'ALT non è nel listino Synclab');
  });

  test('scheda cliente B2B: andamento, esami, documenti, NC (modulo LIVE), link al Business Hub', async () => {
    const j = await get(`/api/retail/b2b/clienti/${M.est}?da=2026-08-01&a=2026-10-31`);
    assert.equal(j.org.name, 'Struttura Esterna Prova');
    assert.deepEqual(j.andamento.map((x) => x.esami), [0, 0, 3]);
    assert.equal(j.andamento[2].documenti.fatturato, 80);
    assert.equal(j.esami[0].codice, 'GLU');
    assert.equal(j.documenti.length, 4);
    assert.equal(j.nc.disponibile, true); assert.equal(j.nc.aperte, 0);
    assert.match(j.link.business_hub, /^\/business\/account\/\d+$/);
    const n = await get('/api/retail/b2b/clienti/c-CLI-ID-N?da=2026-08-01&a=2026-10-31');
    assert.equal(n.org, null); assert.equal(n.totale.accettazioni, 1); assert.equal(n.hub.disponibile, false);
    const b = await get('/api/retail/b2b/clienti?mese=2026-10');
    const riga = b.clienti.find((x) => x.organization_id === M.est);
    assert.equal(riga.synclab.produzione.valore, 36); assert.equal(riga.synclab.fatturato.fatturato, 80); assert.equal(riga.synclab.listino_hub.versione, 1); assert.equal(riga.synclab.listino_synclab, 'BASE');
  });

  test('Laboratorio in sede e profilo dei pazienti con il filtro perimetro', async () => {
    const l = await M.let.laboratorioInSede({ da: '2026-10-01', a: '2026-10-31' });
    assert.deepEqual(l.sedi.map((s) => [s.site_id, s.totale.accettazioni, s.anno_prima.accettazioni]), [[M.sA, 3, 1], [M.sB, 1, 0]]);
    assert.equal(l.var_accettazioni, 300);
    assert.equal(l.esami[0].codice, 'GLU'); assert.equal(l.esami[0].esami, 4); assert.equal(l.esami[0].anno_prima, 1);
    assert.equal((await M.let.laboratorioInSede({ da: '2026-10-01', a: '2026-10-31', privatiInB2c: false })).attivo, false);
    const pb = await M.let.profiloPazienti({ periodo: '2026-10', perimetro: 'B2B' });
    const pl = await M.let.profiloPazienti({ periodo: '2026-10', perimetro: 'LAB_SEDE' });
    const pt = await M.let.profiloPazienti({ periodo: '2026-10' });
    assert.deepEqual([pb.sintesi.accettazioni, pl.sintesi.accettazioni, pt.sintesi.accettazioni], [2, 4, 6]);
    assert.equal((await M.let.profiloPazienti({ periodo: '2026-10', perimetro: 'LAB_SEDE', privati_in_b2c: 'false' })).sintesi.accettazioni, 0);
  });

  test('impostazione synclab_privati_in_b2c: valori ammessi e effetto sul cruscotto B2B; budget B2B', async () => {
    assert.equal((await send('PUT', '/api/retail/settings', { synclab_privati_in_b2c: 'forse' })).status, 400);
    assert.equal((await send('PUT', '/api/retail/settings', { synclab_privati_in_b2c: 'false' })).status, 200);
    const tutto = await get('/api/retail/b2b/cruscotto?mese=2026-10');
    assert.equal(tutto.kpi.accettazioni, 6, 'con l\'impostazione spenta tutto Synclab è B2B');
    assert.equal((await get('/api/retail/laboratorio?periodo=2026-10')).attivo, false);
    assert.equal((await send('PUT', '/api/retail/settings', { synclab_privati_in_b2c: 'true' })).status, 200);
    assert.equal((await get('/api/retail/b2b/cruscotto?mese=2026-10')).kpi.accettazioni, 2);
    // budget: obiettivi per cliente e mese, idempotente; riga vuota = tolta
    const put = (righe) => send('PUT', '/api/retail/b2b/budget', { anno: 2026, righe });
    assert.equal((await put([{ chiave: String(M.est), mese: 10, produzione: 50, fatturato: 90 }, { chiave: 'c-CLI-ID-N', cliente: 'Client Prova N', mese: 8, produzione: 10 }])).body.scritte, 2);
    assert.equal((await put([{ chiave: String(M.est), mese: 10, produzione: 60, fatturato: 90 }])).body.scritte, 1);
    const b = await get('/api/retail/b2b/budget?anno=2026');
    const e = b.clienti.find((x) => x.chiave === String(M.est));
    assert.deepEqual([e.mesi[9].budget_produzione, e.mesi[9].produzione, e.mesi[9].fatturato], [60, 36, 80]);
    assert.equal((await uno('SELECT count(*)::int AS n FROM retail.budget_b2b')).n, 2);
    assert.equal((await put([{ chiave: 'c-CLI-ID-N', mese: 8 }])).body.tolte, 1);
    assert.equal((await put([{ chiave: 'chiave sbagliata', mese: 1, produzione: 1 }])).status, 400);
  });

  test('prenotazioni online: senza storico TuoTempo nessun numero inventato', async () => {
    const p = await get('/api/retail/prenotazioni');
    assert.equal(p.prenotazioni.disponibile, false); assert.match(p.prenotazioni.nota, /Docplanner/);
    assert.equal(p.ultimo_giorno, null); assert.deepEqual(p.per_sede, []);
    await db.query(`INSERT INTO retail.tuotempo_aree (areaid, titolo, presente) VALUES ('AR1', 'Area Prova', TRUE)`);
    await db.query(`UPDATE public.sites SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || '{"tuotempo":"AR1"}' WHERE id = $1`, [M.sA]);
    await db.query(`INSERT INTO retail.tuotempo_attivita (data, activityid, areaid, site_id, typologyid, giorni_attesa) VALUES ('2026-11-08', 'A1', 'AR1', $1, 'T1', 2), ('2026-11-08', 'A2', 'AR1', $1, 'T1', 4), ('2026-11-01', 'A1', 'AR1', $1, 'T1', 6)`, [M.sA]);
    const q = await get('/api/retail/prenotazioni');
    assert.equal(q.ultimo_giorno, '2026-11-08'); assert.equal(q.rete.mediana, 3); assert.equal(q.rete.mediana_settimana_prima, 6);
    assert.deepEqual(q.per_sede.map((x) => [x.site_id, x.prestazioni, x.mediana]), [[M.sA, 2, 3]]);
    assert.equal(q.storico.length, 2); assert.equal(q.rete.aree_abbinate, 1);
  });
});
