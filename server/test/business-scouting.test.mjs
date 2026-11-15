// Business Hub · Ricerca prospect: lettura del sito (anagrafica, segnali, key people, email), scoperta da OpenStreetMap, coorti,
// promozione in pipeline e completamento di un account esistente. Dati e siti sintetici (.test), nessuna rete esterna.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const SALTA = !process.env.DATABASE_URL_TEST;
const HOME = `<html><head><script type="application/ld+json">{"@type":"MedicalClinic","name":"Villa Prova","telephone":"+39 055 0000000"}</script></head><body>
<nav><a href="/chi-siamo">Chi siamo</a><a href="/contatti/">Contatti</a><a href="/lavora-con-noi">Lavora con noi</a><a href="/servizi/laboratorio">Laboratorio analisi</a><a href="/area-riservata/staff">Staff</a></nav>
<h1>Residenza Villa Prova</h1><p>La RSA dispone di 84 posti letto ed è accreditata con il Servizio Sanitario Regionale. La struttura fa parte del Gruppo Esempio Salute.</p>
<footer><p>Villa Prova S.r.l. - Via dei Collaudi 12, 50100 Firenze (FI) - P.IVA 01234567897 - <a href="mailto:info@villaprova.test">info@villaprova.test</a> - PEC: villaprova@pec.villaprova.test</p></footer></body></html>`;
const CHI = `<html><body><h2>Direzione</h2><div class="card"><h3>Dott.ssa Maria Collaudi</h3><p>Direttore Sanitario</p></div>
<p>Direttore Generale: Dott. Paolo Verifica</p><p>Luca Esempio - Responsabile Acquisti</p><p>m.collaudi@villaprova.test</p>
<p>"Ottimo servizio" Giovanni Bianchi, paziente</p><h3>Team di Esperti</h3><p>Responsabile di Struttura</p><p>Fino al 2019 il Direttore Sanitario è stato il Dott. Vecchio Titolare.</p></body></html>`;
const SITO = { '/robots.txt': 'User-agent: *\nDisallow: /area-riservata', '/': HOME, '/chi-siamo': CHI, '/contatti/': '<p>Tel. 055 1234567</p><p>segreteria [at] villaprova [dot] test</p>',
  '/lavora-con-noi': '<p>Cerchiamo infermieri e OSS per la nostra residenza.</p>', '/servizi/laboratorio': '<p>Punto prelievi interno in collaborazione con il laboratorio Bianalisi.</p>', '/area-riservata/staff': '<p>Direttore Generale: Dott. Segreto Nascosto</p>' };
const letti = [];
const leggi = async (u) => { const p = new URL(u).pathname; letti.push(p); return SITO[p] != null ? { ok: true, status: 200, url: u, tipo: p.endsWith('.txt') ? 'text/plain' : 'text/html', testo: SITO[p] } : { ok: false, errore: 'Risposta 404' }; };

describe('Ricerca prospect: funzioni pure', () => {
  test('partita IVA con cifra di controllo, indirizzo, ragione sociale, email nascoste e PEC', async () => {
    const E = await import('../src/modules/business/lib/scouting/estrai.js');
    assert.equal(E.pivaValida('01234567897'), true); assert.equal(E.pivaValida('01234567890'), false);
    assert.deepEqual(E.partiteIva('C.F. e P.IVA: IT 01234567897 - REA 12345678901'), ['01234567897']);
    assert.deepEqual(E.indirizzoDaTesto('Sede: Viale Europa 5/A\n59100 Prato PO'), { indirizzo: 'Viale Europa 5/A', cap: '59100', comune: 'Prato', provincia: 'PO' });
    assert.deepEqual(E.ragioniSociali('© 2026 Centro Medico Alfa S.p.A. Tutti i diritti'), ['Centro Medico Alfa S.p.A.']);
    const em = E.emailPubblicate('<a href="mailto:Direzione@Alfa.test?subject=x">scrivi</a> <span>mario (at) alfa (dot) test</span> <img src="logo@2x.png"> nome@esempio.it').map((x) => x.email);
    assert.deepEqual(em.sort(), ['direzione@alfa.test', 'mario@alfa.test']);
    assert.equal(E.ePec('studio@pec.alfa.test'), true); assert.equal(E.ePec('info@alfa.test'), false);
    assert.equal(E.eGenerica('segreteria@alfa.test'), true); assert.equal(E.eGenerica('m.rossi@alfa.test'), false);
  });
  test('key people: titolo e nome nelle tre forme; niente pazienti, titoli senza nome, ex titolari', async () => {
    const P = await import('../src/modules/business/lib/scouting/persone.js');
    const ps = P.personeDaTesto((await import('../src/modules/business/lib/scouting/estrai.js')).testoPagina(CHI), 'https://x.test/chi-siamo');
    assert.deepEqual(ps.map((p) => `${p.nome}|${p.ruolo}`), ['Maria Collaudi|DIRETTORE_SANITARIO', 'Paolo Verifica|DIREZIONE', 'Luca Esempio|ACQUISTI']);
    assert.ok(ps.every((p) => p.evidenza && p.url));
    assert.equal(P.nomePlausibile('Direttore Sanitario'), false); assert.equal(P.nomePlausibile('Anna De Rossi'), true);
    assert.equal(P.sceltaPersone([...ps, { nome: 'Rita Sicura', ruolo: 'SICUREZZA' }], 'MDL', 2)[0].nome, 'Rita Sicura');
  });
  test('email: indirizzo pubblicato abbinato alla persona, schema imparato, ipotesi solo se univoca e mai senza un esempio', async () => {
    const M = await import('../src/modules/business/lib/scouting/email.js');
    const persone = [{ nome: 'Maria Collaudi' }, { nome: 'Paolo Verifica' }, { nome: 'Piero Verifica' }];
    const a = M.abbinaEmail(persone, ['m.collaudi@alfa.test', 'info@alfa.test', 'alfa@pec.alfa.test'], 'alfa.test');
    assert.equal(a.schema, 'n.cognome');
    assert.deepEqual(a.persone.map((p) => [p.email || null, p.email_stato || null]), [['m.collaudi@alfa.test', 'PUBBLICATA'], [null, null], [null, null]], 'p.verifica sarebbe di due persone: nessuna ipotesi');
    assert.deepEqual(a.generali, ['info@alfa.test']); assert.deepEqual(a.pec, ['alfa@pec.alfa.test']);
    const b = M.abbinaEmail([{ nome: 'Maria Collaudi' }], ['info@alfa.test'], 'alfa.test');
    assert.equal(b.schema, null); assert.equal(b.persone[0].email, undefined);
    assert.equal(await M.dominioRicevePosta('alfa.test', { resolveMx: async () => [{ exchange: 'mx.alfa.test', priority: 10 }] }), true);
  });
  test('robots.txt rispettato, indirizzi non pubblici rifiutati', async () => {
    const W = await import('../src/modules/business/lib/scouting/web.js');
    const ok = W.leggiRobots('User-agent: *\nDisallow: /area-riservata\nAllow: /area-riservata/pubblica');
    assert.equal(ok('/chi-siamo'), true); assert.equal(ok('/area-riservata/x'), false); assert.equal(ok('/area-riservata/pubblica'), true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '172.20.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(W.ipPubblico(ip), false, ip);
    assert.equal(W.ipPubblico('93.184.216.34'), true);
    assert.equal((await W.scarica('http://127.0.0.1:9/')).errore, 'Indirizzo non pubblico');
    assert.equal(W.normUrl('javascript:alert(1)'), null); assert.equal(W.dominioDi('https://www.Alfa.test/x'), 'alfa.test');
  });
  test('profilo completo di un sito: anagrafica con provenienza, segnali con evidenza, persone, punteggio; le pagine vietate non si leggono', async () => {
    const { profilaSito } = await import('../src/modules/business/lib/scouting/profila.js');
    const { punteggio } = await import('../src/modules/business/lib/scouting/fit.js');
    const r = await profilaSito('villaprova.test', { leggi, attesa: 0, mx: async () => true });
    assert.equal(r.ok, true);
    assert.ok(!letti.includes('/area-riservata/staff'), 'robots.txt');
    assert.equal(r.anagrafica.piva.valore, '01234567897'); assert.equal(r.anagrafica.ragione_sociale.valore, 'Villa Prova S.r.l.');
    assert.equal(r.anagrafica.pec.valore, 'villaprova@pec.villaprova.test'); assert.equal(r.anagrafica.comune.valore, 'Firenze'); assert.equal(r.anagrafica.email.valore, 'segreteria@villaprova.test');
    assert.ok(Object.values(r.anagrafica).every((x) => x.url));
    assert.deepEqual(r.persone.map((p) => [p.nome, p.email, p.email_stato]), [['Maria Collaudi', 'm.collaudi@villaprova.test', 'PUBBLICATA'], ['Paolo Verifica', 'p.verifica@villaprova.test', 'IPOTESI'], ['Luca Esempio', 'l.esempio@villaprova.test', 'IPOTESI']]);
    assert.ok(!r.persone.some((p) => /Nascosto|Vecchio|Bianchi/.test(p.nome)));
    assert.equal(r.segnali.POSTI_LETTO.valore, 84); assert.equal(r.segnali.FORNITORE_LAB.valore, 'Bianalisi'); assert.equal(r.segnali.GRUPPO.valore, 'Gruppo Esempio Salute');
    for (const k of ['PRELIEVI_IN_SEDE', 'ACCREDITATO', 'ASSUME_SANITARI', 'DIRETTORE_SANITARIO_NOTO', 'PIVA_NOTA', 'SCHEMA_EMAIL']) assert.ok(r.segnali[k]?.evidenza && r.segnali[k]?.url, k);
    const p = punteggio({ categoria: 'RSA', segnali: r.segnali }, 'SRV');
    assert.ok(p.punteggio >= 80 && p.motivi.length >= 6);
    const spento = await profilaSito('villaprova.test', { leggi, attesa: 0, mx: async () => true, attivi: { POSTI_LETTO: false } });
    assert.equal(spento.segnali.POSTI_LETTO, undefined);
    assert.equal((await profilaSito('villaprova.test', { leggi: async (u) => (u.endsWith('robots.txt') ? { ok: true, tipo: 'text/plain', testo: 'User-agent: *\nDisallow: /' } : leggi(u)), attesa: 0 })).ok, false);
  });
  test('OpenStreetMap: query per provincia e tipologia, candidato con recapiti, strutture pubbliche segnate, dismesse escluse', async () => {
    const S = await import('../src/modules/business/lib/scouting/scoperta.js');
    const qy = S.costruisciQuery('FI', ['RSA', 'FARMACIA']);
    assert.match(qy, /IT-FI/); assert.match(qy, /nursing_home/); assert.match(qy, /pharmacy/);
    const c = S.candidatoDaOsm({ type: 'way', id: 7, center: { lat: 43.7, lon: 11.2 }, tags: { name: 'RSA Prova', amenity: 'nursing_home', website: 'www.rsaprova.test', 'addr:street': 'Via Roma', 'addr:housenumber': '1', 'addr:city': 'Firenze', phone: '+39 055 1;+39 055 2', 'ref:vatin': 'IT01234567897' } }, 'FI', ['RSA']);
    assert.equal(c.fonte_ref, 'way/7'); assert.equal(c.categoria, 'RSA'); assert.equal(c.dominio, 'rsaprova.test'); assert.equal(c.piva, '01234567897'); assert.equal(c.telefono, '+39 055 1'); assert.equal(c.indirizzo, 'Via Roma 1');
    assert.equal(S.candidatoDaOsm({ type: 'node', id: 8, tags: { name: 'Ospedale', amenity: 'hospital', operator: 'Azienda USL Toscana Centro' } }, 'FI', ['CASA_DI_CURA']).tags.pubblico, true);
    assert.equal(S.candidatoDaOsm({ type: 'node', id: 9, tags: { amenity: 'pharmacy' } }, 'FI', ['FARMACIA']), null);
    const r = await S.scopriProvincia('FI', ['RSA'], { fetchFn: async () => ({ ok: true, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { name: 'A', amenity: 'nursing_home' } }, { type: 'node', id: 1, tags: { name: 'A', amenity: 'nursing_home' } }] }) }) });
    assert.equal(r.candidati.length, 1);
    // il servizio che scade risponde 200 con "remark": è un errore, detto in chiaro con il nome della provincia
    await assert.rejects(S.scopriProvincia('FI', ['RSA'], { fetchFn: async () => ({ ok: true, json: async () => ({ elements: [], remark: 'runtime error: Query timed out in "query" at line 5 after 51 seconds.' }) }) }), /Firenze.*timed out/s);
    await assert.rejects(S.scopriProvincia('FI', ['RSA'], { fetchFn: async () => ({ ok: false, status: 429 }) }), /troppe richieste/);
  });
});

describe('Ricerca prospect nel Business Hub (integrazione)', { skip: SALTA }, () => {
  let H, S, db, D, sito, overpass, base;
  before(async () => {
    sito = http.createServer((req, res) => { const p = req.url.split('?')[0]; if (SITO[p] == null) { res.writeHead(404); return res.end('no'); } res.writeHead(200, { 'Content-Type': p.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8' }); res.end(SITO[p]); });
    await new Promise((ok) => sito.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${sito.address().port}`;
    overpass = http.createServer(async (req, res) => { let corpo = ''; for await (const c of req) corpo += c; if (decodeURIComponent(corpo).includes('IT-AR')) { res.writeHead(504); return res.end('occupato'); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ elements: [
      { type: 'node', id: 101, lat: 43.77, lon: 11.25, tags: { name: 'Residenza Villa Prova', amenity: 'nursing_home', website: base, 'addr:city': 'Firenze' } },
      { type: 'node', id: 102, lat: 43.7, lon: 11.2, tags: { name: 'RSA Senza Sito', amenity: 'nursing_home', 'addr:city': 'Scandicci' } },
      { type: 'node', id: 103, lat: 43.7, lon: 11.2, tags: { name: 'RSA Comunale', amenity: 'nursing_home', operator: 'ASL Toscana Centro' } }] })); });
    await new Promise((ok) => overpass.listen(0, '127.0.0.1', ok));
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite({ env: { SCOUTING_OVERPASS_URL: `http://127.0.0.1:${overpass.address().port}/`, SCOUTING_CONSENTI_LOCALE: '1', NODE_ENV: 'test' } });
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base);
    assert.equal((await D.o.post('/api/travaso/business/run')).s, 200);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); sito?.close(); overpass?.close(); });
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const attendi = async (fn, cosa) => { for (let i = 0; i < 150; i += 1) { const v = await fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 100)); } throw new Error(`in attesa di: ${cosa}`); };

  test('scoperta, profilo in coda, coorte, promozione in fase Lead senza doppioni, referenti con provenienza', async () => {
    const cat = must(await D.o.get('/api/business/scouting/catalogo?linea=SRV'), 'catalogo');
    assert.ok(cat.categorie.some((c) => c.key === 'RSA') && cat.segnali.some((s) => s.key === 'FORNITORE_LAB' && s.attivo));
    must(await D.o.post('/api/business/scouting/ricerche', { linea: 'SRV', province: ['FI'], categorie: ['RSA'] }), 'ricerca');
    const ric = await attendi(async () => { const r = must(await D.o.get('/api/business/scouting/ricerche?linea=SRV'), 'ricerche')[0]; return r.stato !== 'IN_CORSO' ? r : null; }, 'ricerca');
    assert.equal(ric.stato, 'FATTA', ric.errore); assert.equal(ric.trovati, 3); assert.equal(ric.nuovi, 3);
    let el = must(await D.o.get('/api/business/scouting/candidati?linea=SRV'), 'candidati');
    assert.equal(el.righe.length, 2, 'la struttura pubblica è nascosta se non richiesta');
    assert.equal(must(await D.o.get('/api/business/scouting/candidati?linea=SRV&pubblici=si'), 'pubblici').righe.length, 3);
    const villa = el.righe.find((x) => x.nome === 'Residenza Villa Prova'); const senza = el.righe.find((x) => x.nome === 'RSA Senza Sito');
    assert.ok(senza.segnali.SENZA_SITO);
    const pr = must(await D.o.post('/api/business/scouting/candidati/profila', { ids: [villa.id, senza.id] }), 'profila');
    assert.equal(pr.accodati, 1); assert.equal(pr.senza_sito, 1);
    const det = await attendi(async () => { const d = must(await D.o.get(`/api/business/scouting/candidati/${villa.id}`), 'dettaglio'); return d.candidato.profilato_at ? d : null; }, 'profilo');
    assert.equal(det.candidato.errore_profilo, null); assert.equal(det.candidato.piva, '01234567897'); assert.equal(det.candidato.stato, 'PROFILATO');
    assert.equal(det.persone.length, 3); assert.ok(det.fit.punteggio >= 80);
    // coorte: deve avere / non deve avere
    assert.equal(must(await D.o.get('/api/business/scouting/candidati?linea=SRV&con=PRELIEVI_IN_SEDE,FORNITORE_LAB&senza=LAB_INTERNO'), 'coorte').righe.length, 1);
    assert.equal(must(await D.o.get('/api/business/scouting/candidati?linea=SRV&con=LAB_INTERNO'), 'coorte vuota').righe.length, 0);
    // promozione
    const out = must(await D.o.post(`/api/business/scouting/candidati/${villa.id}/promuovi`, { fase: 1, persone: det.persone.map((p) => p.id) }), 'promuovi');
    assert.equal(out.org_creata, true); assert.equal(out.account_creato, true); assert.equal(out.referenti, 3);
    const acc = (await db.query('SELECT a.*, o.name, o.vat_number, o.pec, o.website FROM business.accounts a JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1', [out.account_id])).rows[0];
    assert.equal(acc.name, 'Villa Prova S.r.l.'); assert.equal(acc.vat_number, '01234567897'); assert.equal(acc.fase_corrente, 1); assert.ok(acc.phase_dates['1']); assert.equal(acc.fonte_censimento, 'Ricerca prospect');
    assert.equal(acc.fornitore_attuale, 'Bianalisi'); assert.equal(acc.gruppo, 'Esempio Salute'); assert.equal(acc.accreditata_ssr, 'Sì');
    const ct = (await db.query('SELECT nome, ruolo, email, principale, fonte, note FROM business.contatti WHERE account_id=$1 ORDER BY id', [out.account_id])).rows;
    assert.deepEqual(ct.map((c) => [c.nome, c.email, c.principale, c.fonte]), [['Maria Collaudi', 'm.collaudi@villaprova.test', true, 'SITO_WEB'], ['Paolo Verifica', null, false, 'SITO_WEB'], ['Luca Esempio', null, false, 'SITO_WEB']]);
    assert.match(ct[1].note, /ipotizzato.*p\.verifica@villaprova\.test/s); assert.match(ct[0].note, /chi-siamo/);
    assert.ok((await db.query(`SELECT 1 FROM business.activities WHERE account_id=$1 AND oggetto='Account creato dalla Ricerca prospect' AND testo LIKE 'Punteggio%'`, [out.account_id])).rows[0]);
    // seconda volta: nessun doppione
    assert.equal(must(await D.o.post(`/api/business/scouting/candidati/${villa.id}/promuovi`, {}), 'bis').gia, true);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM organizations WHERE vat_number='01234567897'`)).rows[0].n, 1);
    el = must(await D.o.get('/api/business/scouting/candidati?linea=SRV&stato=PROMOSSO'), 'promossi');
    assert.equal(el.righe.length, 1);
    // scarto: le persone lette dal sito si cancellano
    must(await D.o.put(`/api/business/scouting/candidati/${senza.id}`, { stato: 'SCARTATO', motivo: 'fuori zona' }), 'scarta');
    assert.equal(must(await D.o.get('/api/business/scouting/candidati?linea=SRV'), 'dopo').righe.length, 0);
    assert.equal((await D.cliente.get('/api/business/scouting/candidati')).s, 403);
  });

  test('una provincia che non risponde non ferma le altre; una ricerca rimasta appesa si chiude da sola; si può annullare', async () => {
    must(await D.o.post('/api/business/scouting/ricerche', { linea: 'PP', province: ['AR', 'FI'], categorie: ['POLIAMBULATORIO'] }), 'ricerca PP');
    const ric = await attendi(async () => { const r = must(await D.o.get('/api/business/scouting/ricerche?linea=PP'), 'ricerche')[0]; return r.stato !== 'IN_CORSO' ? r : null; }, 'ricerca PP');
    assert.equal(ric.stato, 'FATTA'); assert.equal(ric.trovati, 3, 'Firenze è stata letta'); assert.equal(ric.avvisi.length, 1); assert.match(ric.avvisi[0], /Arezzo.*504/s);
    await db.query(`INSERT INTO business.scout_ricerche (linea, province, categorie, stato, aggiornata_at) VALUES ('SRV','{PI}','{RSA}','IN_CORSO', now() - interval '10 minutes')`);
    const el = must(await D.o.get('/api/business/scouting/ricerche?linea=SRV'), 'ricerche');
    assert.equal(el[0].stato, 'ERRORE'); assert.match(el[0].errore, /interrotta/);
    const viva = (await db.query(`INSERT INTO business.scout_ricerche (linea, province, categorie, stato) VALUES ('SRV','{PI}','{RSA}','IN_CORSO') RETURNING id`)).rows[0].id;
    assert.equal((await D.o.post('/api/business/scouting/ricerche', { linea: 'SRV', province: ['FI'], categorie: ['RSA'] })).s, 400, 'una alla volta');
    must(await D.o.post(`/api/business/scouting/ricerche/${viva}/annulla`, {}), 'annulla');
    assert.equal(must(await D.o.get('/api/business/scouting/ricerche?linea=SRV'), 'ricerche')[0].stato, 'ANNULLATA');
  });

  test('account esistente: "Completa dal sito" propone i campi mancanti e i referenti, applica solo ciò che si sceglie e mai sopra un dato presente', async () => {
    const org = (await db.query(`INSERT INTO organizations (kind, name, phone) VALUES ('CLIENTE','Casa di Cura Collaudo','055 999') RETURNING id`)).rows[0].id;
    const aid = must(await D.o.post('/api/business/hub/accounts', { linea: 'SRV', organization_id: org }), 'account').id;
    const p = must(await D.o.post(`/api/business/scouting/account/${aid}/profila`, { sito: base }), 'profila account');
    assert.equal(p.ok, true);
    const stato = Object.fromEntries(p.campi.map((c) => [c.campo, c.stato]));
    assert.equal(stato.piva, 'MANCANTE'); assert.equal(stato.pec, 'MANCANTE'); assert.equal(stato.telefono, 'DIVERSO');
    assert.equal(p.persone.length, 3);
    const a = must(await D.o.post(`/api/business/scouting/account/${aid}/applica`, { campi: ['piva', 'telefono'], persone: [p.persone[0].id] }), 'applica');
    assert.equal(a.applicati.campi, 1, 'il telefono già presente non si sovrascrive'); assert.equal(a.applicati.referenti, 1);
    const o = (await db.query('SELECT vat_number, phone, pec FROM organizations WHERE id=$1', [org])).rows[0];
    assert.equal(o.vat_number, '01234567897'); assert.equal(o.phone, '055 999'); assert.equal(o.pec, null);
    assert.equal(a.persone.find((x) => x.nome === 'Maria Collaudi').gia_referente != null, true);
    // il profilo di un account non compare tra i candidati
    assert.ok(!must(await D.o.get('/api/business/scouting/candidati?linea=SRV&stato=NUOVO,PROFILATO,PROMOSSO,SCARTATO'), 'elenco').righe.some((x) => x.fonte === 'ACCOUNT'));
  });
});
