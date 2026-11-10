// v0.68.3: punto di consegna degli ordini delle Legal entity cliente con più sedi service e abbinamento automatico delle destinazioni Silva.
// Parte pura sempre (destinazione dell'ordine, via e civico normalizzati, classificazione delle unità); parte con database
// (DATABASE_URL_TEST, database temporaneo suite_pc_<pid>) e un finto Silva in processo: Legal entity con 2 punti → ordine senza punto
// rifiutato, con punto ok e POST con il codice del punto; 1 punto preselezionato; perimetro dell'utente; approvazione che chiede il punto;
// punto immutabile dopo la ricevuta di Silva; abbinamento automatico univoco, ambiguo resta manuale, codice già usato non si riassegna.
// Dati e chiave solo fittizi.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import pg from 'pg';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_pc_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
process.env.MAIL_PROVIDER = 'log';
const CHIAVE = 'chiave-finta-punti-0001';   // fittizia: mai una chiave reale nei test

// ------------------------------------------------------------------ parte pura
describe('Punto di consegna e abbinamento · regole pure', () => {
  let S;
  before(async () => { S = await import('../src/modules/orders/lib/silva.js'); });
  const le = { id: -50, origin: 'ORG', org_id: 50, name: 'Kos Prova S.p.A.', silva_code: null, delivery_notes: 'Note della Legal entity' };
  const p1 = { id: 501, name: 'Villa Prova Pini', organization_id: 50, silva_code: '31', delivery_notes: 'Rampa B' };
  const p2 = { id: 502, name: 'Villa Prova Nozzano', organization_id: 50, silva_code: null, delivery_notes: null };

  test('destinazione: codice e note del punto; note della Legal entity se il punto non ne ha; due punti senza scelta = problema', () => {
    const d = S.destinazioneOrdine(le, p1, []);
    assert.equal(d.silva_code, '31'); assert.equal(d.delivery_notes, 'Rampa B'); assert.equal(d.name, 'Kos Prova S.p.A. · Villa Prova Pini');
    const c = S.componiOrdineSilva({ number: 'ORD-2026-0001', urgent: false }, d, [{ article_id: 1, article_name: 'X', qty_approved: 1, pack_size: 1, silva_code: 'A', source: 'SILVA', unit: 'PZ' }]);
    assert.deepEqual(c.problemi, []); assert.deepEqual(c.payload.destinazione, { codice: '31', noteConsegna: 'Rampa B' });
    const d2 = S.destinazioneOrdine(le, p2, []);
    assert.equal(d2.delivery_notes, 'Note della Legal entity');
    const c2 = S.componiOrdineSilva({ number: 'ORD-2026-0002' }, d2, [{ article_id: 1, qty_approved: 1, pack_size: 1, silva_code: 'A', source: 'SILVA', unit: 'PZ' }]);
    assert.ok(c2.problemi.some((x) => /punto di consegna Villa Prova Nozzano \(Kos Prova S\.p\.A\.\) senza destinazione Silva/.test(x)), c2.problemi.join(' | '));
    const d3 = S.destinazioneOrdine(le, null, [p1, p2]);
    const c3 = S.componiOrdineSilva({ number: 'ORD-2026-0003' }, d3, [{ article_id: 1, qty_approved: 1, pack_size: 1, silva_code: 'A', source: 'SILVA', unit: 'PZ' }]);
    assert.ok(c3.problemi.some((x) => /2 sedi service attive .*indica il punto di consegna/.test(x)));
    const d4 = S.destinazioneOrdine(le, null, [p1]);
    assert.equal(d4.silva_code, '31'); assert.equal(d4.implicito, true);
    const sede = { id: 7, origin: 'SITE', name: 'Punto TD', silva_code: '10', delivery_notes: null };
    assert.equal(S.destinazioneOrdine(sede, null, []).silva_code, '10');
    assert.match(S.destinazioneOrdine(le, { ...p1, organization_id: 99 }, []).problema_punto, /non appartiene/);
  });

  test('via e civico normalizzati', () => {
    assert.deepEqual(S.chiaveIndirizzo('V.le della Repubblica, 88/C'), { via: 'viale della repubblica', civico: '88c' });
    assert.deepEqual(S.chiaveIndirizzo('Viale della Repubblica 88 C'), { via: 'viale della repubblica', civico: '88c' });
    assert.deepEqual(S.chiaveIndirizzo('Via di Pratignone n. 13/4'), { via: 'via di pratignone', civico: '134' });
    assert.equal(S.chiaveIndirizzo('Via XX Settembre 15').civico, '15');
  });

  test('classificazione: coincidenza univoca automatica, due coincidenze = da scegliere, codice usato non si riassegna, nessuna plausibile', () => {
    const dest = [
      { codice: '31', nome: 'KOS VILLA PINI', indirizzo: 'Via dei Pini 10', cap: '55100', citta: 'Lucca', provincia: 'LU' },
      { codice: '32', nome: 'Ville di Nozzano', indirizzo: 'Via Sarzanese 2', cap: '55100', citta: 'Lucca', provincia: 'LU' },
      { codice: '33', nome: 'Ville di Nozzano bis', indirizzo: 'Via Sarzanese, 2', cap: '55100', citta: 'Lucca', provincia: 'LU' },
      { codice: '40', nome: 'Punto Prova Prato', indirizzo: 'Viale della Prova 3', cap: '59100', citta: 'Prato', provincia: 'PO' },
      { codice: '50', nome: 'Magazzino Silva Interno', indirizzo: 'Via Lontana 1', cap: '20100', citta: 'Milano', provincia: 'MI' },
    ];
    const unita = [
      { id: 501, tipo: 'PUNTO', label: 'Kos · Villa dei Pini', name: 'Villa dei Pini', address: 'Via dei Pini, 10', zip: '55100', city: 'Lucca', silva_code: null },
      { id: 502, tipo: 'PUNTO', label: 'Kos · Ville di Nozzano', name: 'Ville di Nozzano', address: 'Via Sarzanese 2', zip: '55100', city: 'Lucca', silva_code: null },
      { id: 7, tipo: 'SEDE', label: 'Punto Prova Prato', name: 'Punto Prova Prato', address: 'Viale della Prova, 3', zip: '59100', city: 'Prato', silva_code: null },
      { id: 8, tipo: 'SEDE', label: 'Punto Prova Bari', name: 'Punto Prova Bari', address: 'Via Adriatica 1', zip: '70100', city: 'Bari', silva_code: null },
      { id: 9, tipo: 'SEDE', label: 'Punto già fatto', name: 'Punto già fatto', address: 'x', zip: '00000', city: 'Roma', silva_code: '50', silva_match: 'MANUALE' },
    ];
    // il codice 40 è già usato da una struttura disattivata
    const usati = new Map([['50', { id: 9, label: 'Punto già fatto' }], ['40', { id: 99, label: 'Sede chiusa' }]]);
    const { unita: cl, non_in_anagrafica: fuori } = S.classificaUnita(unita, dest, usati);
    const per = Object.fromEntries(cl.map((u) => [u.id, u]));
    assert.equal(per[501].auto.codice, '31'); assert.equal(per[501].auto.motivo, 'CAP, via e civico');
    assert.equal(per[502].auto, null, 'due destinazioni coincidono: resta a mano'); assert.equal(per[502].stato, 'DA_SCEGLIERE');
    assert.equal(per[502].candidate.filter((c) => c.coincide).length, 2);
    assert.equal(per[7].auto, null, 'codice già usato: non si riassegna'); assert.equal(per[7].stato, 'DA_SCEGLIERE');
    assert.equal(per[7].candidate.find((c) => c.codice === '40').usata_da, 'Sede chiusa');
    assert.equal(per[8].stato, 'NON_IN_SILVA');
    assert.equal(per[9].stato, 'ABBINATA');
    assert.deepEqual(fuori.map((d) => d.codice).sort(), ['32', '33']);
    // CAP + nome identico normalizzato
    const n = S.classificaUnita([{ id: 1, tipo: 'PUNTO', label: 'Kos · Villa Pini', name: 'Kos Villa Pini', address: 'altro indirizzo', zip: '55100' }], dest, new Map());
    assert.equal(n.unita[0].auto?.codice, '31'); assert.equal(n.unita[0].auto?.motivo, 'CAP e nome');
    // destinazione tolta a mano (ESCLUSA): non si rimette in automatico
    const escl = S.classificaUnita([{ ...unita[0], silva_match: 'ESCLUSA' }], dest, new Map());
    assert.equal(escl.unita[0].auto, null); assert.equal(escl.unita[0].stato, 'DA_SCEGLIERE');
    // due unità coincidono con la stessa destinazione: nessun automatismo
    const due = S.classificaUnita([unita[0], { ...unita[0], id: 777, label: 'Altro punto stesso indirizzo' }], dest, new Map());
    assert.ok(due.unita.every((u) => !u.auto));
  });
});

// ------------------------------------------------------------------ finto Silva in processo
function fintoSilva() {
  const m = { richieste: [], acquisiti: {}, destinazioni: [
    { codice: '31', nome: 'KOS PROVA VILLA DEI PINI', indirizzo: 'Via dei Pini, 10', cap: '55100', citta: 'Lucca', provincia: 'LU' },
    { codice: '32', nome: 'KOS PROVA NOZZANO A', indirizzo: 'Via Sarzanese 2', cap: '55100', citta: 'Lucca', provincia: 'LU' },
    { codice: '33', nome: 'KOS PROVA NOZZANO B', indirizzo: 'Via Sarzanese 2', cap: '55100', citta: 'Lucca', provincia: 'LU' },
    { codice: '41', nome: 'Punto Prova Firenze', indirizzo: 'Via di Prova 1', cap: '50100', citta: 'Firenze', provincia: 'FI' },
    { codice: '60', nome: 'Destinazione sconosciuta', indirizzo: 'Via Remota 9', cap: '20100', citta: 'Milano', provincia: 'MI' },
  ] };
  const json = (res, st, body) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  m.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      m.richieste.push({ method: req.method, path: u.pathname, key: req.headers['x-api-key'], body });
      if (req.headers['x-api-key'] !== CHIAVE) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && u.pathname === '/portaleordini/api/v1/destinazioni') return json(res, 200, { destinazioni: m.destinazioni });
      if (req.method === 'POST' && u.pathname === '/portaleordini/api/v1/ordini') {
        if (!m.destinazioni.some((d) => d.codice === String(body.destinazione?.codice))) return json(res, 400, { error: 'destination_not_allowed', message: 'Destinazione non autorizzata', campo: 'destinazione.codice' });
        const ricevuta = { numero: body.numero, riferimento: `OC ${700 + Object.keys(m.acquisiti).length}`, ricevutoAl: '2026-11-10T09:00:00Z' };
        m.acquisiti[body.numero] = ricevuta;
        return json(res, 201, ricevuta);
      }
      json(res, 404, { error: 'not_found' });
    });
  });
  m.post = (numero) => m.richieste.filter((r) => r.method === 'POST' && r.body?.numero === numero);
  return m;
}

// ------------------------------------------------------------------ parte con database
describe('Punto di consegna con database e finto Silva', { skip: SALTA }, () => {
  const M = {};
  let db, silva;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const leggi = (id) => uno('SELECT * FROM orders.orders WHERE id=$1', [id]);
  const eventi = async (id) => (await db.query('SELECT event FROM orders.order_events WHERE order_id=$1 ORDER BY id', [id])).rows.map((x) => x.event);
  const req = (user) => ({ user, ip: '127.0.0.1', suiteUser: null });

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('orders', null);
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    silva = fintoSilva();
    await new Promise((r) => silva.server.listen(0, '127.0.0.1', r));
    M.conn = await import('../src/lib/connectors.js');
    await M.conn.saveConnector('SILVA', { enabled: true, base_url: `http://127.0.0.1:${silva.server.address().port}/portaleordini`, auth_kind: 'API_KEY', credentials: { api_key: CHIAVE }, settings: { catalog_years: '2026' } }, null);
    M.S = await import('../src/modules/orders/lib/silva.js');
    M.S.silvaLimiter.reset();
    M.O = await import('../src/modules/orders/routes/orders.js');
    M.P = await import('../src/modules/orders/lib/punti.js');
    // anagrafica fittizia: Legal entity cliente con due punti service (Villa dei Pini, Ville di Nozzano), una con un solo punto, una sede TD
    M.kos = (await uno(`INSERT INTO public.organizations (kind, code, name, address, zip, city) VALUES ('CLIENTE', 'KOSPC', 'Kos Prova S.p.A.', 'Via Sede Legale 1', '20100', 'Milano') RETURNING id`)).id;
    const sito = async (code, name, kind, org, addr, zip, city) => (await uno(`INSERT INTO public.sites (code, name, kind, address, zip, city, province, organization_id) VALUES ($1,$2,$3,$4,$5,$6,'LU',$7) RETURNING id`, [code, name, kind, addr, zip, city, org])).id;
    M.pini = await sito('KOS-PINI', 'Villa dei Pini', 'SERVICE', M.kos, 'Via dei Pini 10', '55100', 'Lucca');
    M.nozzano = await sito('KOS-NOZ', 'Ville di Nozzano', 'SERVICE', M.kos, 'Via Sarzanese, 2', '55100', 'Lucca');
    M.uno = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', 'UNOPC', 'Cliente Un Punto Prova') RETURNING id`)).id;
    M.unico = await sito('UNO-P1', 'Unico Punto Prova', 'SERVICE', M.uno, 'Via Unica 5', '56100', 'Pisa');
    const soc = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDPC', 'Società Prova PC') RETURNING id`)).id;
    M.sede = await sito('PP-PC', 'Punto Prova Firenze', 'PUNTO_PRELIEVI', soc, 'Via di Prova 1', '50100', 'Firenze');
    M.sedeNo = await sito('PP-BARI', 'Punto Prova Bari', 'PUNTO_PRELIEVI', soc, 'Via Adriatica 1', '70100', 'Bari');
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('TST', 'Prova') ON CONFLICT DO NOTHING`);
    M.art = (await uno(`INSERT INTO orders.articles (code, silva_code, category_code, name, unit, pack_size, pack_label, source, active, sort, visible_all) VALUES ('PC-1','PC-1','TST','Provetta prova punti','PZ',10,'conf.','SILVA',TRUE,1,TRUE) RETURNING id`)).id;
    M.ops = (await uno(`INSERT INTO orders.users (email, full_name, role) VALUES ('ops@prova.invalid', 'Ops Prova', 'SUPERADMIN') RETURNING id`)).id;
    M.cli = (await uno(`INSERT INTO orders.users (email, full_name, role) VALUES ('cliente@prova.invalid', 'Cliente Prova', 'CLIENTE') RETURNING id`)).id;
    M.uOps = { id: M.ops, role: 'SUPERADMIN', full_name: 'Ops Prova', site_ids: [] };
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await new Promise((r) => (silva ? silva.server.close(r) : r()));
    await M.dbm?.pool.end().catch(() => {});
    const om = await import('../src/modules/orders/db.js').catch(() => null);
    await om?.pool?.end?.().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('vista delle unità: la Legal entity con punti non si abbina, i suoi punti sì; la Legal entity con un punto idem', async () => {
    const u = (await db.query('SELECT id, tipo, label FROM orders.silva_unita_v ORDER BY label')).rows;
    assert.ok(u.some((x) => x.id === M.pini && x.tipo === 'PUNTO' && x.label === 'Kos Prova S.p.A. · Villa dei Pini'));
    assert.ok(u.some((x) => x.id === M.nozzano && x.tipo === 'PUNTO'));
    assert.ok(!u.some((x) => x.id === -M.kos), 'la Legal entity con punti non è un\'unità');
    assert.ok(u.some((x) => x.id === M.sede && x.tipo === 'SEDE'));
  });

  test('Legal entity con 2 punti: ordine senza punto rifiutato, con punto ok; perimetro dell\'utente; approvazione chiede il punto', async () => {
    const righe = [{ article_id: M.art, qty: 2 }];
    await assert.rejects(M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: righe }), /Indica il punto di consegna: Kos Prova S\.p\.A\. ha 2 sedi service attive/);
    await assert.rejects(M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: righe, delivery_site_id: M.unico }), /non è un punto attivo di Kos Prova/);
    const { id } = await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: righe, delivery_site_id: M.pini });
    const o = await leggi(id);
    assert.equal(o.delivery_site_id, M.pini); assert.equal(o.struttura_id, -M.kos, 'l\'ordine resta della Legal entity');
    assert.ok((await eventi(id)).some((e) => /consegna a Villa dei Pini/.test(e)));
    // utente del cliente con perimetro su Ville di Nozzano: preselezionata la sua, l'altra non si sceglie
    const uCli = { id: M.cli, role: 'CLIENTE', full_name: 'Cliente Prova', struttura_id: -M.kos, site_ids: [M.nozzano] };
    const opz = await M.P.opzioniPunto(uCli, -M.kos, false);
    assert.deepEqual(opz.punti.map((p) => p.id), [M.nozzano]); assert.equal(opz.preselezionato, M.nozzano); assert.equal(opz.obbligatorio, false);
    const c = await M.O.creaOrdine(req(uCli), { strutturaId: -M.kos, lines: righe });
    assert.equal((await leggi(c.id)).delivery_site_id, M.nozzano);
    await assert.rejects(M.O.creaOrdine(req(uCli), { strutturaId: -M.kos, lines: righe, delivery_site_id: M.pini }), /non è nel tuo perimetro/);
    // Dotazione di avvio: il punto non è obbligatorio alla creazione, lo è all'approvazione (come gli ordini creati prima della 0.68.3)
    const dot = await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: righe, puntoRichiesto: false });
    assert.equal((await leggi(dot.id)).delivery_site_id, null);
    await db.query(`UPDATE orders.orders SET status='INVIATO' WHERE id=$1`, [dot.id]);
    await assert.rejects(M.O.approvaOrdine(req(M.uOps), dot.id), /Indica il punto di consegna prima di approvare/);
    const det = await M.O.dettaglioOrdine(req(M.uOps), dot.id);
    assert.equal(det.punto_mancante, true); assert.equal(det.punto_modificabile, true); assert.equal(det.punti_consegna.length, 2);
    assert.equal(M.O.puntoModificabile(M.uOps, { status: 'INVIATO' }), true);
  });

  test('Legal entity con un solo punto: preselezionato alla creazione; sede TD senza punto', async () => {
    const opz = await M.P.opzioniPunto(M.uOps, -M.uno, true);
    assert.equal(opz.preselezionato, M.unico); assert.equal(opz.obbligatorio, false);
    const { id } = await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.uno, lines: [{ article_id: M.art, qty: 1 }] });
    assert.equal((await leggi(id)).delivery_site_id, M.unico);
    const s = await M.O.creaOrdine(req(M.uOps), { strutturaId: M.sede, lines: [{ article_id: M.art, qty: 1 }] });
    assert.equal((await leggi(s.id)).delivery_site_id, null);
    await assert.rejects(M.O.creaOrdine(req(M.uOps), { strutturaId: M.sede, lines: [{ article_id: M.art, qty: 1 }], delivery_site_id: M.pini }), /sede TD/);
    // il punto non è una struttura ordinabile a sé (decisione A4)
    await assert.rejects(M.O.creaOrdine(req(M.uOps), { strutturaId: M.pini, lines: [{ article_id: M.art, qty: 1 }] }), /scegliendo Villa dei Pini in "Consegnare a"/);
  });

  test('abbinamento automatico: Villa dei Pini si abbina da sola, Nozzano (ambiguo) resta a mano, codice usato non si riassegna', async () => {
    await db.query(`INSERT INTO orders.site_ext (site_id, silva_code, silva_match) VALUES ($1, '41', 'MANUALE')`, [M.sedeNo]);   // 41 già usato (a torto) da Bari
    await M.S.destinazioniSilva({ force: true });
    const a = await M.S.abbinaAutomaticamente({ actor: 'test' });
    const ids = a.abbinate.map((x) => x.id);
    assert.ok(ids.includes(M.pini), JSON.stringify(a));
    assert.ok(!ids.includes(M.nozzano), 'due destinazioni coincidono: resta a mano');
    assert.ok(!ids.includes(M.sede), 'il codice 41 è già usato: non si riassegna');
    const e = await uno('SELECT silva_code, silva_match FROM orders.site_ext WHERE site_id=$1', [M.pini]);
    assert.deepEqual(e, { silva_code: '31', silva_match: 'AUTO' });
    const au = await uno(`SELECT data FROM orders.audit_log WHERE action='STRUTTURA_SILVA_AUTO' AND entity_id=$1`, [String(M.pini)]);
    assert.equal(au.data.esito, 'abbinata automaticamente'); assert.equal(au.data.codice, '31');
    const { unita, usati } = await M.S.elencoUnitaSilva();
    const cl = M.S.classificaUnita(unita, (await M.S.destinazioniSalvate()).destinazioni, usati);
    const per = Object.fromEntries(cl.unita.map((u) => [u.id, u]));
    assert.equal(per[M.pini].stato, 'ABBINATA'); assert.equal(per[M.nozzano].stato, 'DA_SCEGLIERE'); assert.equal(per[M.sede].stato, 'DA_SCEGLIERE');
    assert.equal(per[M.unico].stato, 'NON_IN_SILVA');
    assert.ok(cl.non_in_anagrafica.some((d) => d.codice === '60'), 'destinazione Silva non in anagrafica');
    // ripetere non cambia nulla
    assert.equal((await M.S.abbinaAutomaticamente()).abbinate.length, 0);
    // D53: le unità senza destinazione (Nozzano, la sede, il cliente con un punto), non la Legal entity con punti
    const diag = await import('../src/lib/diagnostica.js');
    const [k] = await diag.esegui({ ids: ['D53'] });
    assert.ok(k.righe.some((r) => r.name === 'Kos Prova S.p.A. · Ville di Nozzano'), JSON.stringify(k).slice(0, 400));
    assert.ok(!k.righe.some((r) => r.name === 'Kos Prova S.p.A. · Villa dei Pini'));
    assert.ok(!k.righe.some((r) => r.id === -M.kos));
    const st = await M.S.statoIntegrazioneSilva();
    assert.ok(st.strutture_senza_destinazione.some((x) => x.name === 'Kos Prova S.p.A. · Ville di Nozzano'));
  });

  test('trasmissione: POST con il codice del punto; punto senza destinazione = blocco chiaro; dopo la ricevuta il punto non si cambia', async () => {
    const id = (await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: [{ article_id: M.art, qty: 3 }], delivery_site_id: M.pini })).id;
    await db.query(`UPDATE orders.orders SET status='APPROVATO', approved_at=now(), ops_notes=NULL WHERE id=$1`, [id]);
    await db.query(`UPDATE orders.order_lines SET qty_approved=qty_requested WHERE order_id=$1`, [id]);
    await db.query(`UPDATE orders.site_ext SET delivery_notes='Consegna alla rampa B' WHERE site_id=$1`, [M.pini]);
    const n = (await leggi(id)).number;
    const out = await M.S.pushOrderToSilva(id, { actor: 'Ops', manuale: true, conferma: true });
    assert.equal(out.ok, true, JSON.stringify(out));
    const [p] = silva.post(n);
    assert.deepEqual(p.body.destinazione, { codice: '31', noteConsegna: 'Consegna alla rampa B' });
    assert.deepEqual(p.body.righe, [{ codiceArticolo: 'PC-1', unitaTotali: 30, unita: 'PZ' }]);
    const o = await M.O.dettaglioOrdine(req(M.uOps), id);
    assert.equal(o.struttura_label, 'Kos Prova S.p.A. · Villa dei Pini');
    assert.equal(o.punto_modificabile, false, 'immutabile dopo la ricevuta di Silva');
    assert.equal(M.O.puntoModificabile(M.uOps, { status: 'APPROVATO', silva_send_status: 'INVIATO' }), false);
    assert.equal(M.O.puntoModificabile(M.uOps, { status: 'APPROVATO', silva_send_status: 'BLOCCATO' }), true);
    assert.equal(M.O.puntoModificabile({ role: 'CLIENTE', struttura_id: -M.kos }, { status: 'INVIATO', struttura_id: -M.kos }), false, 'il cliente solo in bozza');
    // Nozzano senza destinazione: blocco locale con messaggio chiaro, nessuna POST
    const id2 = (await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: [{ article_id: M.art, qty: 1 }], delivery_site_id: M.nozzano })).id;
    await db.query(`UPDATE orders.orders SET status='APPROVATO', approved_at=now() WHERE id=$1`, [id2]);
    await db.query(`UPDATE orders.order_lines SET qty_approved=qty_requested WHERE order_id=$1`, [id2]);
    const out2 = await M.S.pushOrderToSilva(id2, { manuale: true, conferma: true });
    assert.equal(out2.bloccato, true);
    assert.ok(out2.problemi.some((x) => /punto di consegna Ville di Nozzano \(Kos Prova S\.p\.A\.\) senza destinazione Silva: sceglila in Ordini > Strutture > Destinazioni Silva/.test(x)), out2.problemi.join(' | '));
    assert.equal(silva.post((await leggi(id2)).number).length, 0);
    // ordine senza punto di una Legal entity con 2 punti (prima della 0.68.3): blocco "indica il punto"
    const id3 = (await M.O.creaOrdine(req(M.uOps), { strutturaId: -M.kos, lines: [{ article_id: M.art, qty: 1 }], puntoRichiesto: false })).id;
    await db.query(`UPDATE orders.orders SET status='APPROVATO', approved_at=now() WHERE id=$1`, [id3]);
    await db.query(`UPDATE orders.order_lines SET qty_approved=qty_requested WHERE order_id=$1`, [id3]);
    const out3 = await M.S.pushOrderToSilva(id3, { manuale: true, conferma: true });
    assert.ok(out3.problemi.some((x) => /indica il punto di consegna nel dettaglio dell'ordine/.test(x)));
    // consegna: le confezioni annotano il punto (solo informativo), la giacenza resta della Legal entity
    const flow = await import('../src/modules/orders/lib/orderflow.js');
    const full = await flow.byNumber(n);
    await flow.markDelivered(full, { actor: 'test' });
    const pk = (await db.query('SELECT DISTINCT struttura_id, delivery_site_id FROM orders.packages WHERE order_id=$1', [id])).rows;
    assert.deepEqual(pk, [{ struttura_id: -M.kos, delivery_site_id: M.pini }]);
    assert.ok((await eventi(id)).some((e) => /punto di consegna Villa dei Pini/.test(e)));
  });
});
