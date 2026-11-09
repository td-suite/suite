// v0.68.2: trasmissione degli ordini a Silva secondo la Guida tecnica API ordini v1 (docs/silva-api-ordini/, 09/11/2026).
// Parte pura sempre (corpo conforme, campo → articolo, Retry-After, proposta di destinazione); parte con database (DATABASE_URL_TEST,
// database temporaneo suite_sv1_<pid>) e un finto Silva in processo su una porta libera: destinazioni con cache, primo invio concordato,
// 201/200 concludono, blocco senza codice Silva, immutable_order non si ritenta, 400 con campo in chiaro, 429 con Retry-After, 503 con
// lo stesso contenuto, 401 fino al cambio di chiave, stato IN_PREPARAZIONE/EVASO/ANNULLATO/404. Dati e chiave solo fittizi.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_sv1_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
process.env.MAIL_PROVIDER = 'log';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHIAVE = 'chiave-finta-di-prova-0001';   // fittizia: mai una chiave reale nei test

const CAMPI_AMMESSI = ['numero', 'urgenza', 'destinazione', 'righe', 'note', 'motivoUrgenza', 'dataApprovazione'];

// ------------------------------------------------------------------ parte pura
describe('Silva v1 · regole pure', () => {
  let S;
  before(async () => { S = await import('../src/modules/orders/lib/silva.js'); });

  const ordine = (o = {}) => ({ number: 'ORD-2026-0142', urgent: false, approved_at: '2026-11-09T08:12:44.000Z', ops_notes: null, kind: 'SEDE', status: 'APPROVATO', ...o });
  const struttura = (s = {}) => ({ name: 'Punto Prova', silva_code: '10', delivery_notes: 'Ingresso laterale', code: 'PP1', address: 'Via Prova 1', ...s });
  const riga = (r = {}) => ({ article_id: 1, article_name: 'Provetta prova', qty_approved: 3, pack_size: 100, silva_code: 'Art-001', source: 'SILVA', unit: 'PZ', unit_silva: null, ...r });

  test('corpo conforme: solo i campi della guida, codice Silva esatto, unità del catalogo, unità totali intere, data con Z', () => {
    const c = S.componiOrdineSilva(ordine({ urgent: true, urgent_reason: 'Scorte finite', ops_notes: 'Consegna entro venerdì' }), struttura(), [riga(), riga({ article_id: 2, article_name: 'Ago prova', silva_code: 'ART-002', unit: 'n.', unit_silva: 'CF', pack_size: 1, qty_approved: 4 }), riga({ article_id: 3, qty_approved: 0, silva_code: null })]);
    assert.deepEqual(c.problemi, []);
    assert.deepEqual(Object.keys(c.payload), ['numero', 'urgenza', 'destinazione', 'righe', 'note', 'motivoUrgenza', 'dataApprovazione']);
    assert.ok(Object.keys(c.payload).every((k) => CAMPI_AMMESSI.includes(k)));
    assert.deepEqual(c.payload.destinazione, { codice: '10', noteConsegna: 'Ingresso laterale' });
    assert.deepEqual(c.payload.righe, [{ codiceArticolo: 'Art-001', unitaTotali: 300, unita: 'PZ' }, { codiceArticolo: 'ART-002', unitaTotali: 4, unita: 'CF' }]);
    assert.equal(c.payload.urgenza, 'URGENTE'); assert.equal(c.payload.motivoUrgenza, 'Scorte finite');
    assert.equal(c.payload.dataApprovazione, '2026-11-09T08:12:44.000Z');
    for (const k of ['cliente', 'stato', 'tipoDestinatario', 'origineDestinatario']) assert.equal(k in c.payload, false, k);
    for (const k of ['codiceSede', 'nome', 'indirizzo', 'referente', 'modalita']) assert.equal(k in c.payload.destinazione, false, k);
    for (const k of ['codiceSilva', 'gtin', 'descrizione', 'confezioni']) assert.equal(k in c.payload.righe[0], false, k);
    const semplice = S.componiOrdineSilva(ordine(), struttura({ delivery_notes: null }), [riga()]);
    assert.deepEqual(Object.keys(semplice.payload), ['numero', 'urgenza', 'destinazione', 'righe', 'dataApprovazione']);
    assert.deepEqual(semplice.payload.destinazione, { codice: '10' });
  });

  test('blocchi: articolo senza codice Silva, unità non del catalogo, destinazione mancante o non numerica, numero non valido, quantità', () => {
    const c = S.componiOrdineSilva(ordine({ number: '-ORD 1' }), struttura({ silva_code: 'TD01' }), [riga({ silva_code: null, article_name: 'Tampone X' }), riga({ article_name: 'Busta Y', silva_code: 'B-1', source: 'MANUALE', unit: 'pz' }), riga({ article_name: 'Grande Z', silva_code: 'G-1', pack_size: 500000, qty_approved: 3 })]);
    assert.ok(c.problemi.some((p) => /articolo Tampone X senza codice Silva: abbinalo nel catalogo/.test(p)));
    assert.ok(c.problemi.some((p) => /Busta Y: unità del catalogo Silva non nota/.test(p)));
    assert.ok(c.problemi.some((p) => /Grande Z: 1500000 PZ fuori dai limiti/.test(p)));
    assert.ok(c.problemi.some((p) => /codice Silva "TD01" non è un codice destinazione/.test(p)));
    assert.ok(c.problemi.some((p) => /numero d'ordine -ORD 1 non accettato/.test(p)));
    assert.ok(S.componiOrdineSilva(ordine(), struttura({ silva_code: null }), [riga()]).problemi.some((p) => /senza destinazione Silva/.test(p)));
    assert.ok(S.NUMERO_RE.test('ORD-2026-0142') && S.NUMERO_RE.test('TEST-TD-0001') && !S.NUMERO_RE.test('_X') && !S.NUMERO_RE.test('a'.repeat(65)));
    const dup = S.componiOrdineSilva(ordine(), struttura(), [riga(), riga({ article_id: 9, article_name: 'Doppione' })]);
    assert.ok(dup.problemi.some((p) => /stesso codice Silva Art-001/.test(p)));
  });

  test('note troncate a 2000 con avviso, motivoUrgenza 1000, noteConsegna 1000; campo → articolo; Retry-After', () => {
    const c = S.componiOrdineSilva(ordine({ ops_notes: 'x'.repeat(2500), urgent: true, urgent_reason: 'u'.repeat(1200) }), struttura({ delivery_notes: 'n'.repeat(1500) }), [riga()]);
    assert.equal(c.payload.note.length, 2000); assert.equal(c.payload.motivoUrgenza.length, 1000); assert.equal(c.payload.destinazione.noteConsegna.length, 1000);
    assert.ok(c.avvisi.some((a) => /troncate a 2000/.test(a)));
    assert.equal(S.spiegaCampo('righe[0].unita', c.righe), 'riga 1 (Provetta prova, codice Art-001): unità');
    assert.match(S.spiegaCampo('destinazione.codice', c.righe), /destinazione/);
    assert.equal(S.retryAfterMs('17'), 17000);
    assert.equal(S.retryAfterMs(new Date(Date.UTC(2026, 10, 9, 9, 0, 30)).toUTCString(), Date.UTC(2026, 10, 9, 9, 0, 0)), 30000);
    assert.equal(S.retryAfterMs(null), 60000);
  });

  test('proposta della destinazione: CAP, città e indirizzo; ambigua o lontana = nessuna proposta', () => {
    const dest = [
      { codice: '10', nome: 'TD Quarrata', indirizzo: 'Via della Repubblica 88/C', cap: '51039', citta: 'Quarrata', provincia: 'PT' },
      { codice: '11', nome: 'TD Calenzano', indirizzo: 'Via di Prato 5', cap: '50041', citta: 'Calenzano', provincia: 'FI' },
      { codice: '12', nome: 'Laboratorio Sesto', indirizzo: 'Via di Pratignone 13/4', cap: '50019', citta: 'Sesto Fiorentino', provincia: 'FI' },
    ];
    const p = S.proponiDestinazione({ name: 'Punto Prelievi Quarrata', address: 'Via della Repubblica, 88/C', zip: '51039', city: 'Quarrata' }, dest);
    assert.equal(p.codice, '10'); assert.match(p.motivo, /CAP/); assert.match(p.motivo, /indirizzo/);
    assert.equal(S.proponiDestinazione({ name: 'Laboratorio di analisi', address: 'Via di Pratignone, 13/4', zip: '50019', city: 'Sesto Fiorentino' }, dest).codice, '12');
    assert.equal(S.proponiDestinazione({ name: 'Sede Milano', address: 'Corso Buenos Aires 1', zip: '20124', city: 'Milano' }, dest), null);
  });

  test('i callback Silva → Suite restano montati (presa in carico, spedito, consegnato)', () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'src', 'modules', 'orders', 'routes', 'integrations.js'), 'utf8');
    for (const p of ['/silva/orders/:numero/presa-in-carico', '/silva/orders/:numero/spedito', '/silva/orders/:numero/consegnato', '/silva/orders']) assert.ok(src.includes(`'${p}'`), p);
  });
});

// ------------------------------------------------------------------ finto Silva in processo
function fintoSilva() {
  const m = { richieste: [], coda: {}, stati: {}, acquisiti: {}, destinazioni: [
    { codice: '10', nome: 'Punto Prova Firenze', indirizzo: 'Via di Prova 1', cap: '50100', citta: 'Firenze', provincia: 'FI' },
    { codice: '20', nome: 'Laboratorio Prova', indirizzo: 'Via del Laboratorio 2', cap: '50019', citta: 'Sesto Fiorentino', provincia: 'FI' },
  ] };
  const json = (res, st, body, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...h }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  m.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      m.richieste.push({ method: req.method, path: u.pathname, key: req.headers['x-api-key'], idem: req.headers['x-idempotency-key'], body, raw: b });
      if (req.headers['x-api-key'] !== m.chiave) return json(res, 401, { error: 'unauthorized', message: 'Chiave non valida' });
      if (req.method === 'GET' && u.pathname === '/portaleordini/api/v1/destinazioni') return json(res, 200, { destinazioni: m.destinazioni });
      if (req.method === 'POST' && u.pathname === '/portaleordini/api/v1/ordini') {
        if (u.search) return json(res, 400, { error: 'query_not_allowed', message: 'La POST si invia senza parametri', campo: null });
        const forzata = (m.coda[body.numero] || []).shift();
        if (forzata) return json(res, forzata.status, forzata.body, forzata.headers);
        const extra = Object.keys(body).filter((k) => !CAMPI_AMMESSI.includes(k));
        if (extra.length) return json(res, 400, { error: 'unknown_field', message: `Campo non ammesso: ${extra[0]}`, campo: extra[0] });
        const prima = m.acquisiti[body.numero];
        if (prima && prima.raw !== JSON.stringify(body)) return json(res, 400, { error: 'immutable_order', message: 'Stesso numero con dati diversi', campo: 'numero' });
        if (prima) return json(res, 200, prima.ricevuta);
        const ricevuta = { numero: body.numero, riferimento: `OC ${100 + Object.keys(m.acquisiti).length} (ID ${400 + Object.keys(m.acquisiti).length})`, ricevutoAl: '2026-11-09T09:10:00.1234567Z' };
        m.acquisiti[body.numero] = { raw: JSON.stringify(body), ricevuta };
        return json(res, 201, ricevuta);
      }
      const st = u.pathname.match(/^\/portaleordini\/api\/v1\/ordini\/([^/]+)\/stato$/);
      if (req.method === 'GET' && st) {
        const n = decodeURIComponent(st[1]);
        if (m.stati[n]) return json(res, 200, { numero: n, presente: true, stato: m.stati[n] });
        return json(res, 404, { numero: n, presente: false, stato: null });
      }
      json(res, 404, { error: 'not_found' });
    });
  });
  m.chiave = CHIAVE;
  m.post = (numero) => m.richieste.filter((r) => r.method === 'POST' && r.body?.numero === numero);
  return m;
}

// ------------------------------------------------------------------ parte con database
describe('Silva v1 con database e finto Silva', { skip: SALTA }, () => {
  const M = {};
  let db, silva, base;
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const ordine = async (numero, righe, o = {}) => {
    const r = await uno(`INSERT INTO orders.orders (number, struttura_id, kind, origin, status, urgent, urgent_reason, ops_notes, approved_at) VALUES ($1,$2,'SEDE','OPERATIONS','APPROVATO',$3,$4,$5, coalesce($6::timestamptz, now())) RETURNING id`,
      [numero, o.struttura ?? M.sede, Boolean(o.urgent), o.urgent_reason || null, o.ops_notes || null, o.approved_at || null]);
    for (const [art, qty] of righe) await db.query('INSERT INTO orders.order_lines (order_id, article_id, qty_requested, qty_approved) VALUES ($1,$2,$3,$3)', [r.id, art, qty]);
    return r.id;
  };
  const leggi = (id) => uno('SELECT * FROM orders.orders WHERE id=$1', [id]);
  const eventi = async (id) => (await db.query('SELECT event FROM orders.order_events WHERE order_id=$1 ORDER BY id', [id])).rows.map((x) => x.event);
  const connettore = (patch) => M.conn.saveConnector('SILVA', patch, null);

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
    base = `http://127.0.0.1:${silva.server.address().port}/portaleordini`;
    M.conn = await import('../src/lib/connectors.js');
    await connettore({ enabled: true, base_url: base, auth_kind: 'API_KEY', credentials: { api_key: CHIAVE }, settings: { catalog_years: '2026' } });
    M.S = await import('../src/modules/orders/lib/silva.js');
    M.S.silvaLimiter.reset();
    // anagrafica fittizia: una sede con destinazione 10, una senza; articoli del catalogo Silva e uno manuale
    const org = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDSV1', 'Società Prova SV1') RETURNING id`);
    M.sede = (await uno(`INSERT INTO public.sites (code, name, kind, address, zip, city, province, organization_id) VALUES ('PP-SV1', 'Punto Prova Firenze', 'PUNTO_PRELIEVI', 'Via di Prova 1', '50100', 'Firenze', 'FI', $1) RETURNING id`, [org.id])).id;
    M.sede2 = (await uno(`INSERT INTO public.sites (code, name, kind, address, zip, city, province, organization_id) VALUES ('LAB-SV1', 'Laboratorio Prova', 'LABORATORIO', 'Via del Laboratorio 2', '50019', 'Sesto Fiorentino', 'FI', $1) RETURNING id`, [org.id])).id;
    await db.query(`INSERT INTO orders.site_ext (site_id, silva_code, delivery_notes) VALUES ($1, '10', 'Suonare al citofono')`, [M.sede]);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('TST', 'Prova') ON CONFLICT DO NOTHING`);
    let ordinale = 0;
    const art = async (code, silva, name, unit, pack, source) => (await uno(`INSERT INTO orders.articles (code, silva_code, category_code, name, unit, pack_size, pack_label, source, active, sort) VALUES ($1,$2,'TST',$3,$4,$5,'conf.',$6,TRUE,$7) RETURNING id`, [code, silva, name, unit, pack, source, ++ordinale])).id;
    M.a1 = await art('Art-001', 'Art-001', 'Provetta siero prova', 'PZ', 100, 'SILVA');
    M.a2 = await art('ART-002', 'ART-002', 'Ago prova', 'n.', 1, 'SILVA');
    M.a3 = await art('MAN-1', null, 'Tampone manuale prova', 'pz', 10, 'MANUALE');
    const feed = await uno(`INSERT INTO orders.warehouse_feeds (source) VALUES ('API') RETURNING id`);
    await db.query(`INSERT INTO orders.warehouse_stock (feed_id, article_id, silva_code, description, qty, unit) VALUES ($1,$2,'ART-002','Ago prova',500,'CF')`, [feed.id, M.a2]);
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await new Promise((r) => (silva ? silva.server.close(r) : r()));
    await M.dbm?.pool.end().catch(() => {});
    const om = await import('../src/modules/orders/db.js').catch(() => null);
    await om?.pool?.end?.().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('destinazioni: GET con X-API-KEY, cache di 10 minuti, rilettura forzata; prova connessione = destinazioni + catalogo', async () => {
    const prima = silva.richieste.length;
    const d = await M.S.destinazioniSilva({ force: true });
    assert.equal(d.destinazioni.length, 2); assert.equal(d.destinazioni[0].codice, '10');
    await M.S.destinazioniSilva();
    assert.equal(silva.richieste.length, prima + 1, 'seconda lettura dalla cache');
    assert.equal(silva.richieste.at(-1).key, CHIAVE);
    assert.equal((await M.S.destinazioniSalvate()).destinazioni.length, 2);
    const t = await M.conn.testConnector('SILVA');
    assert.equal(t.ok, false, 'il finto Silva non ha il catalogo: la prova lo dice');
    assert.match(t.message, /2 destinazioni autorizzate · catalogo: Silva risponde 404/);
    const log = await M.dbm.many(`SELECT message, endpoint FROM public.connector_log WHERE kind='SILVA'`);
    assert.ok(log.every((x) => !String(x.message || '').includes(CHIAVE) && !String(x.endpoint || '').includes(CHIAVE)), 'mai la chiave nel registro');
  });

  test('primo_invio_confermato falso: niente invio automatico; a mano serve la conferma; 201 conclude e annota il primo invio', async () => {
    const id = await ordine('ORD-2026-0901', [[M.a1, 3], [M.a2, 4]], { ops_notes: 'Consegna entro venerdì', urgent: true, urgent_reason: 'Scorte finite' });
    const auto = await M.S.pushOrderToSilva(id, { actor: 'approvazione' });
    assert.match(auto.skipped, /primo invio concordato/);
    assert.match((await M.S.pushPendingOrders()).skipped, /primo invio concordato/);
    assert.equal(silva.post('ORD-2026-0901').length, 0, 'nessuna POST automatica');
    await assert.rejects(M.S.pushOrderToSilva(id, { actor: 'Ops', manuale: true }), /conferma esplicita/);
    const out = await M.S.pushOrderToSilva(id, { actor: 'Ops', manuale: true, conferma: true });
    assert.equal(out.ok, true); assert.equal(out.status, 201); assert.equal(out.proponi_automatismo, true); assert.equal(out.primo_invio, true);
    const [p] = silva.post('ORD-2026-0901');
    assert.equal(p.idem, 'ORD-2026-0901'); assert.equal(p.key, CHIAVE);
    assert.deepEqual(Object.keys(p.body), ['numero', 'urgenza', 'destinazione', 'righe', 'note', 'motivoUrgenza', 'dataApprovazione']);
    assert.deepEqual(p.body.destinazione, { codice: '10', noteConsegna: 'Suonare al citofono' });
    assert.deepEqual(p.body.righe, [{ codiceArticolo: 'Art-001', unitaTotali: 300, unita: 'PZ' }, { codiceArticolo: 'ART-002', unitaTotali: 4, unita: 'CF' }]);
    assert.match(p.body.dataApprovazione, /Z$/);
    const o = await leggi(id);
    assert.equal(o.silva_send_status, 'INVIATO'); assert.equal(o.silva_reference, 'OC 100 (ID 400)');
    assert.equal(new Date(o.silva_received_at).toISOString(), '2026-11-09T09:10:00.123Z');
    assert.ok((await eventi(id)).some((e) => /Trasmesso a Silva \(Ops\): nuovo ordine in preparazione · rif\. OC 100/.test(e)));
    const c = await M.conn.getConnector('SILVA');
    assert.equal(c.settings.primo_invio_numero, 'ORD-2026-0901'); assert.ok(c.settings.primo_invio_at);
    const di = await M.S.pushOrderToSilva(id, { actor: 'Ops', manuale: true, conferma: true });
    assert.equal(di.gia, true, 'dopo 201 l\'invio è concluso: niente seconda POST');
    assert.equal(silva.post('ORD-2026-0901').length, 1);
  });

  test('200 = ricevuta originale di un ordine identico: conclude come il 201', async () => {
    const id = await ordine('ORD-2026-0902', [[M.a1, 1]]);
    const { o, s, lines } = await M.S.datiOrdineSilva(id);
    const corpo = M.S.componiOrdineSilva(o, s, lines).payload;
    silva.acquisiti['ORD-2026-0902'] = { raw: JSON.stringify(corpo), ricevuta: { numero: 'ORD-2026-0902', riferimento: 'OC 77 (ID 7)', ricevutoAl: '2026-11-09T08:00:00Z' } };
    const out = await M.S.pushOrderToSilva(id, { manuale: true, conferma: true });
    assert.equal(out.status, 200); assert.equal(out.stato, 'INVIATO');
    const r = await leggi(id);
    assert.equal(r.silva_reference, 'OC 77 (ID 7)'); assert.match(r.silva_send_message, /Ricevuta originale/);
  });

  test('articolo senza codice Silva o struttura senza destinazione: nessuna POST, messaggio per Ops', async () => {
    const id = await ordine('ORD-2026-0903', [[M.a1, 1], [M.a3, 2]]);
    const out = await M.S.pushOrderToSilva(id, { manuale: true, conferma: true });
    assert.equal(out.bloccato, true);
    assert.ok(out.problemi.includes('articolo Tampone manuale prova senza codice Silva: abbinalo nel catalogo'));
    assert.equal(silva.post('ORD-2026-0903').length, 0);
    assert.equal((await leggi(id)).silva_send_status, 'BLOCCATO');
    const id2 = await ordine('ORD-2026-0904', [[M.a1, 1]], { struttura: M.sede2 });
    const out2 = await M.S.pushOrderToSilva(id2, { manuale: true, conferma: true });
    assert.ok(out2.problemi.some((p) => /Laboratorio Prova senza destinazione Silva/.test(p)));
  });

  test('immutable_order: segnalato, mai ritentato (né dal job né a mano); 400 con campo righe[0].unita → nome dell\'articolo', async () => {
    const id = await ordine('ORD-2026-0905', [[M.a1, 2]]);
    silva.acquisiti['ORD-2026-0905'] = { raw: '{"diverso":true}', ricevuta: {} };
    const out = await M.S.pushOrderToSilva(id, { manuale: true, conferma: true });
    assert.equal(out.stato, 'ERRORE_DATI'); assert.match(out.message, /già presso Silva con dati diversi: non si può modificare, creare un nuovo ordine/);
    await assert.rejects(M.S.pushOrderToSilva(id, { manuale: true, conferma: true }), /creare un nuovo ordine/);
    assert.equal(silva.post('ORD-2026-0905').length, 1);
    assert.ok((await eventi(id)).some((e) => /immutable_order/.test(e)));
    const id2 = await ordine('ORD-2026-0906', [[M.a2, 5]]);
    silva.coda['ORD-2026-0906'] = [{ status: 400, body: { error: 'unit_or_code_mismatch', message: 'L’unità deve corrispondere al catalogo Silva', campo: 'righe[0].unita' } }];
    const o2 = await M.S.pushOrderToSilva(id2, { manuale: true, conferma: true });
    assert.equal(o2.stato, 'ERRORE_DATI'); assert.equal(o2.riga, 'riga 1 (Ago prova, codice ART-002): unità');
    const r2 = await leggi(id2);
    assert.equal(r2.silva_error_code, 'unit_or_code_mismatch'); assert.equal(r2.silva_error_field, 'righe[0].unita');
    assert.match(r2.silva_send_message, /Ago prova/);
  });

  test('429 rispetta Retry-After: in coda fino all\'ora indicata, poi il job ripete la stessa richiesta', async () => {
    // automatismo attivo da ora (dopo il primo 201)
    await connettore({ settings: { primo_invio_confermato: true, primo_invio_confermato_at: new Date(Date.now() - 1000).toISOString() } });
    const id = await ordine('ORD-2026-0907', [[M.a1, 1]]);
    silva.coda['ORD-2026-0907'] = [{ status: 429, headers: { 'Retry-After': '120' }, body: { error: 'too_many_requests' } }];
    const t0 = Date.now();
    const out = await M.S.pushOrderToSilva(id, { actor: 'trasmissione automatica' });
    assert.equal(out.stato, 'IN_CODA');
    const r = await leggi(id);
    const attesa = new Date(r.silva_retry_at).getTime() - t0;
    assert.ok(attesa >= 119000 && attesa <= 122000, `retry dopo ~120 s (${attesa})`);
    assert.ok(M.S.silvaLimiter.stato().pausa_fino, 'pausa globale del limitatore');
    M.S.silvaLimiter.reset();
    const j = await M.S.pushPendingOrders();
    assert.ok(!j.esiti.some((e) => e.numero === 'ORD-2026-0907'), 'prima del Retry-After non si ritenta');
    await db.query(`UPDATE orders.orders SET silva_retry_at = now() - interval '1 second' WHERE id=$1`, [id]);
    const j2 = await M.S.pushPendingOrders();
    assert.ok(j2.esiti.some((e) => e.numero === 'ORD-2026-0907' && e.stato === 'INVIATO'));
    const [a, b] = silva.post('ORD-2026-0907');
    assert.equal(a.raw, b.raw, 'stessa richiesta originale');
  });

  test('503 e timeout: ritenta con lo stesso numero e contenuto anche se i dati cambiano nel frattempo', async () => {
    const id = await ordine('ORD-2026-0908', [[M.a1, 2]], { ops_notes: 'prima' });
    silva.coda['ORD-2026-0908'] = [{ status: 503, body: { error: 'unavailable' } }];
    const out = await M.S.pushOrderToSilva(id, { actor: 'trasmissione automatica' });
    assert.equal(out.stato, 'IN_CODA'); assert.match(out.message, /stesso numero e contenuto/);
    await db.query(`UPDATE orders.orders SET ops_notes='dopo', silva_retry_at = now() - interval '1 second' WHERE id=$1`, [id]);
    const j = await M.S.pushPendingOrders();
    assert.ok(j.esiti.some((e) => e.numero === 'ORD-2026-0908' && e.stato === 'INVIATO'));
    const [a, b] = silva.post('ORD-2026-0908');
    assert.equal(b.body.note, 'prima'); assert.deepEqual(b.body, a.body);
    assert.equal((await leggi(id)).silva_send_attempts, 2);
  });

  test('401: errore chiave, nessun ritentativo finché la chiave non cambia', async () => {
    const id = await ordine('ORD-2026-0909', [[M.a1, 1]]);
    silva.chiave = 'altra-chiave-finta';
    const out = await M.S.pushOrderToSilva(id, { actor: 'trasmissione automatica' });
    assert.equal(out.stato, 'ERRORE_CHIAVE');
    silva.chiave = CHIAVE;
    const n = silva.post('ORD-2026-0909').length;
    await M.S.pushPendingOrders();
    assert.equal(silva.post('ORD-2026-0909').length, n, 'stessa chiave: niente ritentativo');
    silva.chiave = 'chiave-finta-nuova-0002';
    await connettore({ credentials: { api_key: 'chiave-finta-nuova-0002' } });
    const j = await M.S.pushPendingOrders();
    assert.ok(j.esiti.some((e) => e.numero === 'ORD-2026-0909' && e.stato === 'INVIATO'), 'chiave cambiata: si ritenta');
    assert.ok(!(await M.dbm.many(`SELECT message FROM public.connector_log WHERE kind='SILVA'`)).some((x) => String(x.message).includes('chiave-finta')), 'mai la chiave nel registro');
  });

  test('automatismo: partono gli ordini approvati dopo l\'attivazione, non l\'arretrato', async () => {
    const vecchio = await ordine('ORD-2026-0910', [[M.a1, 1]], { approved_at: '2026-11-01T08:00:00Z' });
    const nuovo = await ordine('ORD-2026-0911', [[M.a1, 1]]);
    await M.S.pushPendingOrders();
    assert.equal(silva.post('ORD-2026-0910').length, 0, 'arretrato: resta da trasmettere a mano');
    assert.equal((await leggi(vecchio)).silva_send_status, null);
    assert.equal((await leggi(nuovo)).silva_send_status, 'INVIATO');
  });

  test('limitatore: oltre 28 chiamate nella finestra di 60 s si attende o si rinuncia', async () => {
    M.S.silvaLimiter.reset();
    for (let i = 0; i < 28; i++) await M.S.silvaLimiter.acquire();
    assert.equal(M.S.silvaLimiter.stato().usate_ultimo_minuto, 28);
    await assert.rejects(M.S.silvaLimiter.acquire({ maxAttesaMs: 100 }), (e) => e.code === 'SILVA_LIMITE');
    M.S.silvaLimiter.reset();
  });

  test('stato: IN_PREPARAZIONE → presa in carico (una volta), EVASO → spedito con la nota, ANNULLATO e 404 → segnalazione', async () => {
    M.S.silvaLimiter.reset();   // il giro di prova fa molte chiamate di fila: si riparte da una finestra vuota
    const id = await ordine('ORD-2026-0912', [[M.a1, 1]]);
    await M.S.pushOrderToSilva(id, { actor: 'trasmissione automatica' });
    silva.stati['ORD-2026-0912'] = 'IN_PREPARAZIONE';
    M.S.silvaLimiter.reset(); await M.S.aggiornaStatiSilva();
    M.S.silvaLimiter.reset(); await M.S.aggiornaStatiSilva();
    let o = await leggi(id);
    assert.equal(o.status, 'PRESO_IN_CARICO'); assert.equal(o.silva_stato, 'IN_PREPARAZIONE');
    assert.equal((await eventi(id)).filter((e) => /In preparazione presso Silva/.test(e)).length, 1, 'nessun evento duplicato');
    silva.stati['ORD-2026-0912'] = 'EVASO';
    const dal = Date.now();
    await M.S.statoOrdineSilva(id);
    o = await leggi(id);
    assert.equal(o.status, 'SPEDITO'); assert.equal(o.silva_stato, 'EVASO');
    assert.ok(new Date(o.shipped_at).getTime() >= dal - 1000, 'data = prima rilevazione');
    assert.ok((await eventi(id)).some((e) => /Silva ha emesso il DDT: la consegna la conferma la struttura al carico/.test(e)));
    M.S.silvaLimiter.reset(); const giro = await M.S.aggiornaStatiSilva();
    assert.ok(!giro.esiti.some((e) => e.numero === 'ORD-2026-0912'), 'evaso: non si interroga più');
    // annullato presso Silva
    const id2 = await ordine('ORD-2026-0913', [[M.a1, 1]]);
    await M.S.pushOrderToSilva(id2, { actor: 'trasmissione automatica' });
    silva.stati['ORD-2026-0913'] = 'ANNULLATO';
    await M.S.statoOrdineSilva(id2);
    const o2 = await leggi(id2);
    assert.equal(o2.status, 'ANNULLATO'); assert.match(o2.cancel_reason, /Annullato presso Silva/);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM orders.issues WHERE order_id=$1 AND status='APERTA'`, [id2])).n, 1);
    // 404 dopo la ricevuta
    const id3 = await ordine('ORD-2026-0914', [[M.a1, 1]]);
    await M.S.pushOrderToSilva(id3, { actor: 'trasmissione automatica' });
    await M.S.statoOrdineSilva(id3);
    await M.S.statoOrdineSilva(id3);
    const o3 = await leggi(id3);
    assert.equal(o3.silva_stato, 'ASSENTE'); assert.equal(o3.status, 'APPROVATO');
    assert.equal((await uno(`SELECT count(*)::int AS n FROM orders.issues WHERE order_id=$1`, [id3])).n, 1, 'una sola segnalazione');
    assert.equal((await eventi(id3)).filter((e) => /Silva non trova l'ordine \(404\)/.test(e)).length, 1);
    // NON_DISPONIBILE: mostrato e ritentato
    silva.stati['ORD-2026-0914'] = 'NON_DISPONIBILE';
    await M.S.statoOrdineSilva(id3);
    assert.equal((await leggi(id3)).silva_stato, 'NON_DISPONIBILE');
    M.S.silvaLimiter.reset(); const g = await M.S.aggiornaStatiSilva();
    assert.ok(g.esiti.some((e) => e.numero === 'ORD-2026-0914'), 'NON_DISPONIBILE resta nel giro');
  });

  test('stato dell\'integrazione e D53: strutture attive senza destinazione Silva', async () => {
    const st = await M.S.statoIntegrazioneSilva();
    assert.equal(st.destinazioni.lette, 2); assert.equal(st.connettore.automatico, true);
    assert.ok(st.strutture_senza_destinazione.some((x) => x.name === 'Laboratorio Prova'));
    assert.ok(!st.strutture_senza_destinazione.some((x) => x.name === 'Punto Prova Firenze'));
    const diag = await import('../src/lib/diagnostica.js');
    const [k] = await diag.esegui({ ids: ['D53'] });
    assert.ok(k.righe.some((r) => r.name === 'Laboratorio Prova'), JSON.stringify(k).slice(0, 300));
  });
});
