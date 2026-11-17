// Openapi nella Suite (v0.80.0): scheda dell'impresa, compilazione dei soli campi vuoti, differenze, cessazione, cache, tetto mensile, CAP.
// Servizio finto in locale, dati sintetici: nessuna chiamata a Openapi.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { avviaSuite, datiProva } from './helpers/suiteTest.mjs';

const SALTA = !process.env.DATABASE_URL_TEST;
const impresa = (o = {}) => ({ taxCode: '01234567897', vatCode: '01234567897', companyName: 'CENTRO PROVA REGISTRO S.R.L.', activityStatus: 'ATTIVA', reaCode: '123456', cciaa: 'PO', pec: 'CentroProva@pec.test', sdiCode: 'abc1234',
  address: { registeredOffice: { toponym: 'VIA', street: 'DEI COLLAUDI', streetNumber: '12', streetName: 'VIA DEI COLLAUDI 12', town: 'PRATO', province: 'PO', zipCode: '59100', gps: { coordinates: [11.09, 43.88] }, region: { description: 'TOSCANA' } } },
  atecoClassification: { ateco2007: { code: '8690', description: 'Altri servizi di assistenza sanitaria' } }, detailedLegalForm: { description: 'SOCIETA A RESPONSABILITA LIMITATA' }, startDate: '2010-01-01',
  balanceSheets: { last: { year: 2024, employees: 12, turnover: 900000, netWorth: 100000 } }, shareHolders: [{ name: 'Mario', surname: 'Prova', percentShare: 100 }], ...o });

describe('Openapi: funzioni pure', () => {
  test('scheda normalizzata e confronto con l\'anagrafica', async () => {
    const O = await import('../src/lib/openapi.js');
    assert.equal(O.pulisciCodice('IT 0123 4567 897'), '01234567897'); assert.equal(O.codiceValido('0123'), false); assert.equal(O.codiceValido('RSSMRA80A01H501U'), true);
    const s = O.normalizzaImpresa(impresa());
    assert.equal(s.indirizzo, 'Via Dei Collaudi 12'); assert.equal(s.citta, 'Prato'); assert.equal(s.pec, 'centroprova@pec.test'); assert.equal(s.sdi, 'ABC1234'); assert.equal(s.rea, 'PO-123456');
    assert.equal(s.cessata, false); assert.equal(s.ateco, '8690'); assert.equal(s.bilancio.dipendenti, 12); assert.deepEqual(s.gps, { lon: 11.09, lat: 43.88 }); assert.equal(s.soci[0].nome, 'Prova Mario');
    assert.equal(O.normalizzaImpresa(impresa({ activityStatus: 'CESSATA', endDate: '2025-03-31' })).cessata, true);
    assert.equal(O.normalizzaImpresa(null), null);
    const c = O.confrontaOrg({ name: 'Centro Prova Registro SRL', vat_number: '01234567897', address: 'via dei collaudi, 12', zip: '', city: 'Firenze', pec: null }, s);
    assert.deepEqual(c.vuoti.map((x) => x.campo).sort(), ['pec', 'province', 'sdi', 'tax_code', 'zip']);
    assert.deepEqual(c.diversi.map((x) => x.campo), ['city']);   // ragione sociale e indirizzo uguali a meno di forma e punteggiatura
  });
});

describe('Openapi: Legal entity e registro imprese', { skip: SALTA }, () => {
  let S; let D; let finto; const chiamate = []; let risposta = impresa();
  before(async () => {
    S = await avviaSuite(); D = await datiProva(S.base);
    finto = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); chiamate.push({ p: u.pathname, auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer token-di-prova') { res.writeHead(401); return res.end(JSON.stringify({ success: false, message: 'Wrong Token' })); }
      if (u.pathname === '/IT-advanced/01234567897') return res.end(JSON.stringify({ success: true, data: [risposta] }));
      if (u.pathname === '/cap/59100') return res.end(JSON.stringify({ success: true, data: { comuni: [{ comune: 'Prato', comune_istat: '100005', frazione: null }], provincia: 'Prato', sigla_provincia: 'PO', regione: 'Toscana' } }));
      res.writeHead(404); res.end(JSON.stringify({ success: false, message: 'not found' }));
    });
    await new Promise((ok) => finto.listen(0, '127.0.0.1', ok));
  });
  after(async () => { finto?.close(); await S?.stop(); });
  const must = (r, cosa) => { assert.ok(r.s >= 200 && r.s < 300, `${cosa}: ${r.s} ${r.text.slice(0, 300)}`); return r.j; };
  const attendi = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await new Promise((ok) => setTimeout(ok, 80)); } };
  const org = async (id) => must(await D.o.get('/api/organizations'), 'elenco').find((x) => x.id === id);

  test('connettore spento: nessuna chiamata, errore chiaro', async () => {
    const r = await D.o.get('/api/openapi/impresa/01234567897');
    assert.equal(r.s, 400); assert.match(r.text, /non è attivo/);
    assert.equal(chiamate.length, 0);
  });

  test('nuova Legal entity con partita IVA: campi vuoti compilati da soli, quelli scritti restano, differenza segnalata', async () => {
    must(await D.o.put('/api/connectors/OPENAPI', { enabled: true, base_url: `http://127.0.0.1:${finto.address().port}`, credentials: { api_key: 'token-di-prova' }, settings: { tetto_schede_mese: '3' } }), 'connettore');
    const o = must(await D.o.post('/api/organizations', { name: 'Centro Prova', kind: 'CLIENTE', vat_number: '01234567897', city: 'Firenze' }), 'crea');
    const dopo = await attendi(async () => { const x = await org(o.id); return x?.registry_checked_at ? x : null; });
    assert.ok(dopo, 'verifica in background eseguita');
    assert.equal(dopo.address, 'Via Dei Collaudi 12'); assert.equal(dopo.zip, '59100'); assert.equal(dopo.province, 'PO'); assert.equal(dopo.pec, 'centroprova@pec.test'); assert.equal(dopo.sdi, 'ABC1234');
    assert.equal(dopo.city, 'Firenze', 'un dato già scritto non si sovrascrive'); assert.equal(dopo.name, 'Centro Prova');
    assert.match(dopo.registry_alert, /Dati diversi dal registro: città/); assert.doesNotMatch(dopo.registry_alert, /ragione sociale/);
    assert.equal(dopo.registry_data.ateco, '8690'); assert.equal(dopo.registry_data.bilancio.dipendenti, 12);
    assert.equal(chiamate.filter((c) => c.p.startsWith('/IT-advanced')).length, 1);

    // confronto e applicazione a mano: dalla cache, senza nuove chiamate
    const c = must(await D.o.get(`/api/openapi/organizations/${o.id}/confronto`), 'confronto');
    assert.equal(c.daCache, true); assert.deepEqual(c.diversi.map((x) => x.campo).sort(), ['city', 'name']);
    const a = must(await D.o.post(`/api/openapi/organizations/${o.id}/applica`, { campi: ['city'] }), 'applica');
    assert.equal(a.organizzazione.city, 'Prato'); assert.equal(a.avviso, null);
    assert.equal(chiamate.filter((c2) => c2.p.startsWith('/IT-advanced')).length, 1, 'la scheda letta non si paga due volte');
    // salvataggio senza cambiare la partita IVA: nessuna verifica
    must(await D.o.put(`/api/organizations/${o.id}`, { name: 'Centro Prova', vat_number: '01234567897', notes: 'x' }), 'salva');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(chiamate.filter((c2) => c2.p.startsWith('/IT-advanced')).length, 1);
    D.orgId = o.id;
  });

  test('cessazione: rilettura forzata, avviso sulla Legal entity e nello stato', async () => {
    risposta = impresa({ activityStatus: 'CESSATA', endDate: '2026-09-30' });
    const v = must(await D.o.post(`/api/openapi/organizations/${D.orgId}/verifica`, { forza: true }), 'verifica');
    assert.equal(v.cessata, true); assert.match(v.avviso, /cessata nel registro imprese dal 30\/09\/2026/);
    const st = must(await D.o.get('/api/openapi/stato'), 'stato');
    assert.equal(st.uso.impresa, 2); assert.equal(st.impostazioni.tetto_schede_mese, 3); assert.ok(st.avvisi.some((x) => x.id === D.orgId));
  });

  test('tetto mensile: raggiunto il limite la Suite non chiede altre schede', async () => {
    assert.equal(must(await D.o.get('/api/openapi/impresa/01234567890'), 'non trovata').trovata, false);   // terza chiamata: non trovata, comunque contata
    const r = await D.o.get('/api/openapi/impresa/09876543210');
    assert.equal(r.s, 429); assert.match(r.text, /tetto di 3 schede/);
    const g = must(await D.o.post('/api/openapi/verifica-periodica', { limite: 5 }), 'giro');
    assert.ok(g.esaminate >= 0);
  });

  test('CAP: comune e provincia, poi dalla cache; registro chiamate senza la partita IVA', async () => {
    const c = must(await D.o.get('/api/openapi/cap/59100'), 'cap');
    assert.equal(c.sigla_provincia, 'PO'); assert.equal(c.comuni[0].comune, 'Prato'); assert.equal(c.daCache, false);
    assert.equal(must(await D.o.get('/api/openapi/cap/59100'), 'cap').daCache, true);
    assert.equal((await D.o.get('/api/openapi/cap/5910')).s, 400);
    const log = must(await D.o.get('/api/connectors/OPENAPI/log?limit=50'), 'log');
    const righe = JSON.stringify(log);
    assert.doesNotMatch(righe, /01234567897/); assert.match(righe, /IT-advanced\/…/);
  });

  test('token rifiutato: messaggio che dice cosa fare, nessun dato toccato', async () => {
    must(await D.o.put('/api/connectors/OPENAPI', { credentials: { api_key: 'sbagliato' }, settings: { tetto_schede_mese: '50' } }), 'token');
    const r = await D.o.get('/api/openapi/impresa/01234567897?forza=1');
    assert.equal(r.s, 400); assert.match(r.text, /token non valido o senza il permesso/);
  });
});
