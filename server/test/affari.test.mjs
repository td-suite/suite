// v0.96.0 · Public Affairs: lettura delle fonti (pagina e feed), prima lettura senza falsi avvisi, novità, valutazione, email del giorno
// una volta sola e solo se ci sono novità, permessi. Sito di prova locale; modello AI finto (AFFARI_AI_MOCK). Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { estraiLink, leggiFeed, scadenzaNelTitolo, testoPagina, chiaveUrl } from '../src/modules/affari/lib/estrai.js';

describe('Public Affairs: lettura delle fonti (funzioni pure)', () => {
  test('collegamenti di una pagina: assoluti, senza doppioni, senza voci di servizio', () => {
    const html = `<nav><a href="/">Home</a><a href="#top">su</a><a href="mailto:x@y.it">scrivi</a></nav><script>var a='<a href="/finto">no</a>'</script>
      <ul><li><a href="/avvisi/elenco/avviso-prelievi-scadenza-21-10-2026">Avviso di manifestazione di interesse per prestazioni di prelievo venoso - scadenza 21/10/2026</a></li>
      <li><a href='doc/bando.pdf' title="Bando laboratorio"><img src="x.png"></a></li><li><a href="/avvisi/elenco/avviso-prelievi-scadenza-21-10-2026#all">Leggi</a></li></ul>`;
    const l = estraiLink(html, 'https://ente.test/avvisi/elenco');
    assert.deepEqual(l.map((x) => x.url), ['https://ente.test/', 'https://ente.test/avvisi/elenco/avviso-prelievi-scadenza-21-10-2026', 'https://ente.test/avvisi/doc/bando.pdf']);
    assert.match(l[1].titolo, /^Avviso di manifestazione/); assert.equal(l[2].titolo, 'Bando laboratorio');
    assert.equal(estraiLink(html, 'https://ente.test/avvisi/elenco', { filtro: '/avvisi/elenco/' }).length, 1);
    assert.equal(chiaveUrl('http://www.Ente.test/a/'), chiaveUrl('https://ente.test/a'));
  });
  test('feed RSS e Atom, scadenza nel titolo, testo della pagina', () => {
    const rss = `<rss><channel><title>GU</title><item><title>MINISTERO DELLA SALUTE - DECRETO 3 novembre 2026</title><link>http://gu.test/eli/1</link><content:encoded>Tariffe delle prestazioni di &lt;b&gt;specialistica&lt;/b&gt; ambulatoriale.</content:encoded><pubDate>Sat, 21 Nov 2026 11:42:43 GMT</pubDate></item></channel></rss>`;
    assert.deepEqual(leggiFeed(rss, 'http://gu.test/rss'), [{ url: 'http://gu.test/eli/1', titolo: 'MINISTERO DELLA SALUTE - DECRETO 3 novembre 2026', descrizione: 'Tariffe delle prestazioni di specialistica ambulatoriale.', pubblicata: '2026-11-21' }]);
    assert.equal(leggiFeed(`<feed><entry><title><![CDATA[Delibera n. 10]]></title><link href="/atti/10"/><updated>2026-11-20T08:00:00Z</updated></entry></feed>`, 'https://regione.test/feed')[0].url, 'https://regione.test/atti/10');
    assert.equal(scadenzaNelTitolo('Avviso prelievi zona pratese - scadenza 21/10/2026 ore 12:00'), '2026-10-21'); assert.equal(scadenzaNelTitolo('M.I. locali, scad. 13-11-2026'), '2026-11-13'); assert.equal(scadenzaNelTitolo('Delibera del 10/10/2026'), null);
    assert.equal(testoPagina('<header>menu</header><main><h1>Avviso</h1><p>Testo &egrave; qui.</p></main><footer>piede</footer>'.replace('<main>', `<main>${'x '.repeat(250)}`)).includes('menu'), false);
  });
});

const SALTA = !process.env.DATABASE_URL_TEST;
describe('Public Affairs: nella Suite', { skip: SALTA }, () => {
  let H, S, db, O, D, sito, VIS, voci = [], feed = [];
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const posta = async () => (await db.query(`SELECT to_addr, subject FROM email_log WHERE ref LIKE 'affari:%' ORDER BY id`)).rows;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs'); const pg = (await import('pg')).default;
    const srv = http.createServer((req, res) => {
      if (req.url === '/avvisi') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<html><body><nav><a href="/chi-siamo">Chi siamo e contatti</a></nav><main>${voci.map((v) => `<p><a href="${v.href}">${v.t}</a></p>`).join('')}</main></body></html>`); }
      if (req.url === '/rss') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end(`<?xml version="1.0"?><rss><channel>${feed.map((v) => `<item><title>${v.t}</title><link>${v.href}</link><description>${v.d}</description></item>`).join('')}</channel></rss>`); }
      if (req.url.startsWith('/avvisi/') || req.url.startsWith('/atti/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<html><main><h1>Documento</h1><p>${'Prestazioni di laboratorio e prelievo venoso per l\'ambito territoriale. Requisiti: accreditamento istituzionale. '.repeat(6)}</p></main></html>`); }
      if (req.url === '/rotta') { res.writeHead(500); return res.end('errore'); }
      res.writeHead(404); res.end('no');
    });
    await new Promise((r) => srv.listen(0, r)); sito = { srv, base: `http://localhost:${srv.address().port}` };
    // SCOUTING_CONSENTI_LOCALE: il lettore accetta localhost solo in prova (stesso interruttore dei test della Ricerca prospect)
    S = await H.avviaSuite({ env: { AFFARI_AI_MOCK: '1', SCOUTING_CONSENTI_LOCALE: '1' } });
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base); O = D.o;
    const pe = must(await O.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Vistatest', first_name: 'Vito', email: 'vito.vistatest@toscanadiagnostica.it' }), 'persona');
    await new Promise((r) => setTimeout(r, 1200)); const uid = (await O.get(`/api/people/${pe.id}`)).j.user_id;
    must(await O.put(`/api/users/${uid}`, { auth_provider: 'BOTH' }), 'utente'); must(await O.put(`/api/users/${uid}/grants/affari`, { profile: 'VIEWER' }), 'grant');
    VIS = await H.entra(H.client(S.base), 'vito.vistatest@toscanadiagnostica.it', must(await O.post(`/api/users/${uid}/reset-password`, {}), 'pw').temporaryPassword, 'Vis-Affari-2026x');
    await db.query(`UPDATE affari.fonti SET attiva = FALSE`);   // le fonti proposte (siti veri) restano ferme durante la prova
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); sito?.srv.close(); });

  test('fonti proposte, profili, prova di lettura', async () => {
    const st = must(await O.get('/api/affari/state'), 'stato'); assert.equal(st.user.ruolo, 'DIREZIONE');
    const f = must(await O.get('/api/affari/fonti'), 'fonti').righe;
    assert.equal(f.length, 5); assert.ok(f.some((x) => /uslcentro/.test(x.url)) && f.some((x) => /uslnordovest/.test(x.url)) && f.some((x) => /uslsudest/.test(x.url)) && f.some((x) => x.tipo === 'RSS'));
    assert.equal((await VIS.get('/api/affari/state')).j.user.ruolo, 'VIEWER');
    assert.equal((await VIS.post('/api/affari/fonti', { nome: 'x', url: `${sito.base}/avvisi`, categoria: 'BANDI' })).s, 403); assert.equal((await VIS.put('/api/affari/impostazioni', { ora_invio: 9 })).s, 403);
    assert.equal((await D.cliente.get('/api/affari/state')).s, 403);
    assert.equal((await O.post('/api/affari/fonti/prova', { url: 'ftp://x' })).s, 400);
    assert.equal((await O.post('/api/affari/fonti/prova', { url: 'http://169.254.169.254/latest' })).j.ok, false, 'indirizzi interni rifiutati');
    voci = [{ href: '/avvisi/uno', t: 'Avviso già pubblicato sui locali per la continuità assistenziale' }];
    const p = must(await O.post('/api/affari/fonti/prova', { url: `${sito.base}/avvisi` }), 'prova'); assert.equal(p.ok, true); assert.equal(p.trovate, 2);
    assert.equal(must(await O.post('/api/affari/fonti/prova', { url: `${sito.base}/rotta` }), 'prova rotta').ok, false);
  });

  test('prima lettura: nessun avviso; poi le voci nuove sono novità valutate; email una volta al giorno e solo se serve', async () => {
    const a = must(await O.post('/api/affari/fonti', { nome: 'Ente di prova · Avvisi', url: `${sito.base}/avvisi`, categoria: 'BANDI' }), 'fonte');
    assert.equal(a.prima_lettura.prima, true); assert.equal(a.prima_lettura.nuove, 0);
    feed = [{ href: `${sito.base}/atti/1`, t: 'DECRETO già in Gazzetta', d: 'Vecchio' }];
    must(await O.post('/api/affari/fonti', { nome: 'Gazzetta di prova', url: `${sito.base}/rss`, tipo: 'RSS', categoria: 'NORMATIVA_NAZIONALE' }), 'feed');
    assert.equal(must(await O.get('/api/affari/voci'), 'voci').righe.length, 0, 'ciò che c\'era già non è una novità');
    assert.equal(must(await O.post('/api/affari/email/invia', {}), 'email').saltata, 'nessuna novità'); assert.equal((await posta()).length, 0);
    // compaiono un avviso e tre atti
    voci.unshift({ href: '/avvisi/due', t: 'Avviso di manifestazione di interesse per prestazioni di prelievo venoso e consegna campioni - scadenza 21/12/2026' });
    feed.unshift({ href: `${sito.base}/atti/2`, t: 'MINISTERO DELLA SALUTE - DECRETO tariffe', d: 'Aggiornamento del nomenclatore tariffario delle prestazioni di laboratorio.' }, { href: `${sito.base}/atti/3`, t: 'AGENZIA ITALIANA DEL FARMACO - COMUNICATO', d: 'Revoca dell\'autorizzazione all\'importazione parallela di un medicinale.' }, { href: `${sito.base}/atti/4`, t: 'DECRETO LEGISLATIVO sui prodotti difettosi', d: 'Responsabilità per danno.' });
    const g = must(await O.post('/api/affari/giro', {}), 'giro');
    assert.equal(g.nuove, 4); assert.equal(g.valutazione.valutate, 4); assert.equal(g.valutazione.approfondite, 3, 'sintesi sul documento per utilità alta e media');
    const r = must(await VIS.get('/api/affari/voci'), 'voci').righe;
    assert.equal(r.length, 3, 'in vista: avviso e normativa di utilità alta o media');
    const avviso = r.find((v) => v.categoria === 'BANDI'); assert.equal(avviso.utilita, 'ALTA'); assert.equal(avviso.scadenza, '2026-12-21'); assert.equal(avviso.approfondita, true); assert.equal(avviso.stato, 'NUOVA');
    assert.equal(must(await O.get('/api/affari/voci?vista=SCARSA'), 'scarsa').righe.length, 1);
    assert.equal((await VIS.get('/api/affari/badges')).j.novita, 3);
    const e = must(await O.post('/api/affari/email/invia', {}), 'email');
    assert.equal(e.inviata, true); assert.equal(e.voci, 3); assert.deepEqual(e.destinatari, [H.OWNER.email]);
    const p = await posta(); assert.equal(p.length, 1); assert.match(p[0].subject, /^Public Affairs: 3 novità, 2 di utilità alta/);
    assert.equal(must(await O.post('/api/affari/email/invia', {}), 'email 2').saltata, 'nessuna novità', 'le voci già inviate non si rimandano');
    // rilettura senza cambiamenti: nessuna novità
    assert.equal(must(await O.post('/api/affari/giro', {}), 'giro 2').nuove, 0);
    // chi legge segna la voce; archiviare è di chi gestisce
    must(await VIS.put(`/api/affari/voci/${avviso.id}`, { stato: 'IN_EVIDENZA' }), 'evidenza'); assert.equal((await VIS.put(`/api/affari/voci/${avviso.id}`, { stato: 'ARCHIVIATA' })).s, 403);
    assert.equal(must(await O.get('/api/affari/voci?vista=EVIDENZA'), 'evidenza').righe.length, 1);
  });

  test('destinatari scelti, fonte in errore segnalata, cambio di struttura della pagina senza valanga di avvisi', async () => {
    assert.equal((await O.put('/api/affari/impostazioni', { destinatari: 'non-un-indirizzo' })).s, 400);
    must(await O.put('/api/affari/impostazioni', { destinatari: 'direzione@toscanadiagnostica.it, cfo@toscanadiagnostica.it', max_novita_fonte: 5 }), 'impostazioni');
    assert.deepEqual(must(await O.get('/api/affari/impostazioni'), 'imp').destinatari_effettivi, ['direzione@toscanadiagnostica.it', 'cfo@toscanadiagnostica.it']);
    const rotta = must(await O.post('/api/affari/fonti', { nome: 'Fonte rotta', url: `${sito.base}/rotta`, categoria: 'ALTRO' }), 'rotta');
    assert.ok(rotta.prima_lettura.errore); assert.equal((await O.get('/api/affari/badges')).j.fonti_errore, 1);
    for (let i = 0; i < 8; i++) voci.push({ href: `/avvisi/nuova-struttura-${i}`, t: `Collegamento del nuovo sito numero ${i}` });
    const g = must(await O.post('/api/affari/giro', {}), 'giro'); assert.equal(g.nuove, 0, 'otto collegamenti nuovi insieme, oltre il tetto di 5: registrati senza avviso');
    assert.match(must(await O.get('/api/affari/fonti'), 'fonti').righe.find((f) => f.nome === 'Ente di prova · Avvisi').errore, /cambio di struttura/);
  });
});
