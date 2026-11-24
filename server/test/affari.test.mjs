// v0.96.0 · Public Affairs: lettura delle fonti (pagina e feed), prima lettura senza falsi avvisi, novità, valutazione, email del giorno
// una volta sola e solo se ci sono novità, permessi. Sito di prova locale; modello AI finto (AFFARI_AI_MOCK). Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { estraiLink, leggiFeed, scadenzaNelTitolo, testoPagina, chiaveUrl, estraiRighe, paginaSuccessiva, dataNelTesto } from '../src/modules/affari/lib/estrai.js';
import { dividi, parole } from '../src/modules/affari/lib/norme.js';

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

describe('Public Affairs v0.97.0: elenchi a righe, paginazione, brani delle norme (funzioni pure)', () => {
  const riga = (href, t, data) => `<tr class="cat-list-row0"><th class="list-title"><a href="${href}"> ${t} </a></th>${data ? `<td class="list-date small"> ${data} </td>` : ''}<td><span>Visite: 12</span></td></tr>`;
  const pagina = `<nav><a href="/chi">Chi siamo</a></nav><main><table><thead><tr><th><a href="/elenco#">Titolo</a></th></tr></thead><tbody>${riga('/elenco/a', 'Avviso prelievi - scadenza 21.10.2026', '18 Novembre 2026')}${riga('/elenco/b', 'Avviso immobili', '3 Marzo 2026')}${riga('/elenco/c', 'Bando senza data')}</tbody></table>
    <ul class="pagination"><li><a class="page-link" href="/elenco?start=40">3</a></li><li><a class="page-link" aria-label="Vai alla pagina 2" href="/elenco?start=20">2</a></li></ul></main>`;
  test('righe dell\'elenco con la data di pubblicazione della riga, non del titolo', () => {
    const r = estraiRighe(pagina, 'https://ente.test/elenco');
    assert.deepEqual(r.map((x) => [x.url, x.pubblicata]), [['https://ente.test/elenco/a', '2026-11-18'], ['https://ente.test/elenco/b', '2026-03-03'], ['https://ente.test/elenco/c', null]]);
    assert.deepEqual(estraiRighe('<p><a href="/x">Una pagina senza tabella</a></p>', 'https://ente.test/'), [], 'non è un elenco a righe');
    assert.equal(dataNelTesto('pubblicato il 5/1/2026'), '2026-01-05'); assert.equal(dataNelTesto('Visite: 1401'), null);
  });
  test('pagina successiva: il numero più piccolo fra i maggiori, stesso elenco', () => {
    assert.equal(paginaSuccessiva(pagina, 'https://ente.test/elenco'), 'https://ente.test/elenco?start=20');
    assert.equal(paginaSuccessiva(pagina, 'https://ente.test/elenco?start=20'), 'https://ente.test/elenco?start=40');
    assert.equal(paginaSuccessiva(pagina, 'https://ente.test/elenco?start=40'), null);
    assert.equal(paginaSuccessiva(pagina, 'https://ente.test/index.php/avvisi/445-elenco'), 'https://ente.test/elenco?start=20', 'indirizzo riscritto dal sito: vale il collegamento di paginazione');
    assert.equal(paginaSuccessiva('<a href="/altro?page=2">altro</a>', 'https://ente.test/elenco'), null, 'un altro elenco non è la pagina successiva');
  });
  test('brani con il riferimento e parole della ricerca', () => {
    const t = `ALLEGATO A\n\n### B1.1 MEDICINA DI LABORATORIO\n\n${'B1.1.1 Locale di esecuzione delle analisi commisurato alla complessità degli esami. '.repeat(12)}\n\nCapo II\n\nArt. 5 - Istanza di autorizzazione\n\n${'La struttura presenta domanda al Comune. '.repeat(20)}`;
    const b = dividi(t);
    assert.ok(b.length >= 2); assert.match(b[0].rif, /ALLEGATO A · B1\.1 MEDICINA DI LABORATORIO/); assert.match(b[b.length - 1].rif, /Art\. 5/);
    assert.deepEqual(parole('Quali requisiti per l\'accreditamento del punto prelievo B1.1.11?'), ['requis', 'accred', 'punto', 'prelie', 'b1.1.11']);
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
      if (req.url.startsWith('/elenco')) {   // elenco a righe su due pagine: la seconda è tutta del 2025
        const tr = (h, t, d) => `<tr><th><a href="${h}">${t}</a></th><td class="list-date">${d}</td></tr>`;
        const due = req.url.includes('start=20');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<html><body><nav><a href="/menu-servizi">Servizi al cittadino</a></nav><main><table><tbody>${due ? tr('/elenco/v4', 'Avviso laboratori anno precedente', '10 Dicembre 2025') + tr('/elenco/v5', 'Avviso immobili anno precedente', '2 Novembre 2025') + tr('/elenco/v6', 'Altro avviso anno precedente', '1 Ottobre 2025')
          : tr('/elenco/v1', 'Avviso di manifestazione di interesse per prestazioni di laboratorio', '18 Novembre 2026') + tr('/elenco/v2', 'Avviso locali per continuità assistenziale', '4 Febbraio 2026') + tr('/elenco/v3', 'Avviso veterinaria di fine anno', '20 Dicembre 2025')}</tbody></table>
          <a class="page-link" href="/elenco?start=20">2</a></main></body></html>`);
      }
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
    assert.equal((await VIS.put('/api/affari/impostazioni', { ora_invio: 9 })).s, 403);
    assert.equal((await D.cliente.get('/api/affari/state')).s, 403);
    assert.equal((await O.post('/api/affari/fonti/prova', { url: 'ftp://x' })).s, 400);
    assert.equal((await O.post('/api/affari/fonti/prova', { url: 'http://169.254.169.254/latest' })).j.ok, false, 'indirizzi interni rifiutati');
    voci = [{ href: '/avvisi/uno', t: 'Avviso già pubblicato sui locali per la continuità assistenziale' }];
    const p = must(await O.post('/api/affari/fonti/prova', { url: `${sito.base}/avvisi` }), 'prova'); assert.equal(p.ok, true); assert.equal(p.trovate, 2);
    assert.equal(must(await O.post('/api/affari/fonti/prova', { url: `${sito.base}/rotta` }), 'prova rotta').ok, false);
    // v0.97.2: chiunque abbia il widget prova e aggiunge una fonte; modificarla, sospenderla, leggerla a mano ed eliminarla resta alla Direzione
    assert.equal(must(await VIS.post('/api/affari/fonti/prova', { url: `${sito.base}/avvisi` }), 'prova del visualizzatore').ok, true);
    const fv = must(await VIS.post('/api/affari/fonti', { nome: 'Fonte del visualizzatore', url: `${sito.base}/atti/elenco-vis`, categoria: 'ALTRO' }), 'fonte del visualizzatore');
    assert.equal(must(await O.get('/api/affari/fonti'), 'fonti').righe.find((x) => x.id === fv.id).aggiunta_da, 'Vistatest Vito');
    assert.equal((await VIS.put(`/api/affari/fonti/${fv.id}`, { attiva: false })).s, 403); assert.equal((await VIS.del(`/api/affari/fonti/${fv.id}`)).s, 403); assert.equal((await VIS.post(`/api/affari/fonti/${fv.id}/leggi`, {})).s, 403);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE title LIKE 'Public Affairs: % ha aggiunto la fonte%'`).catch(() => ({ rows: [{ n: 1 }] }))).rows[0].n >= 1, true);
    must(await O.del(`/api/affari/fonti/${fv.id}`), 'elimina');
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
  test('v0.97.0 archivio dal gennaio 2026: pagine successive, niente email, voci valutate; normativa di riferimento e domande', async () => {
    // fonte registrata PRIMA che la Suite leggesse gli elenchi a righe: nell'archivio c'è anche un collegamento del menu
    const f = must(await O.post('/api/affari/fonti', { nome: 'Ente di prova · Elenco a pagine', url: `${sito.base}/elenco`, categoria: 'BANDI' }), 'fonte elenco');
    await db.query(`INSERT INTO affari.voci (fonte_id, url, titolo, preesistente, ai_stato) VALUES ($1,$2,'Servizi al cittadino',TRUE,'SENZA_AI')`, [f.id, `${sito.base}/menu-servizi`]);
    assert.equal((await VIS.post('/api/affari/archivio', {})).s, 403);
    const prima = (await posta()).length;
    const a = must(await O.post(`/api/affari/fonti/${f.id}/archivio`, {}), 'archivio');
    assert.equal(a.errore, null); assert.equal(a.pagine, 2, 'si ferma alla pagina tutta precedente al 2026'); assert.equal(a.trovate, 6); assert.equal(a.scartate_prima, 4); assert.equal(a.tolte_menu, 1);
    const st = must(await O.get(`/api/affari/voci?vista=STORICO&fonte=${f.id}&dal=2026-01-01`), 'storico').righe;
    assert.deepEqual(st.map((v) => v.pubblicata), ['2026-11-18', '2026-02-04']); assert.ok(st.every((v) => v.preesistente && v.utilita), 'archivio valutato dal modello, non è una novità');
    assert.equal(must(await O.get(`/api/affari/voci?vista=RILEVANTI&fonte=${f.id}`), 'novità').righe.length, 0);
    must(await O.post('/api/affari/email/invia', {}), 'invio'); assert.equal((await posta()).length, prima, 'l\'archivio non genera email');
    assert.equal(must(await O.post(`/api/affari/fonti/${f.id}/archivio`, {}), 'archivio bis').aggiunte, 0, 'idempotente');
    const tutte = must(await O.post('/api/affari/archivio', {}), 'archivio di tutte'); assert.ok(tutte.fonti.some((x) => x.fonte === f.id)); assert.ok(must(await O.get('/api/affari/archivio/stato'), 'stato').ultimo.at);
    // normativa di riferimento: tre testi nel programma, due collegamenti
    const n = must(await VIS.get('/api/affari/norme'), 'norme');
    assert.equal(n.righe.length, 5); assert.deepEqual(n.righe.filter((x) => x.con_testo).map((x) => x.chiave), ['lr-51-2009', 'reg-79R-2016', 'manuale-requisiti-2021']); assert.ok(n.righe.find((x) => x.chiave === 'reg-79R-2016').brani > 200);
    const r = must(await VIS.post('/api/affari/norme/chiedi', { domanda: 'Il punto prelievo collegato a un laboratorio accreditato deve accreditarsi?' }), 'domanda');
    assert.equal(r.esito, 'COMPLETA'); assert.ok(r.riferimenti.length >= 1 && r.riferimenti[0].norma && r.riferimenti[0].estratto); assert.ok(r.brani_consultati >= 5);
    assert.equal((await db.query(`SELECT riferimenti FROM affari.norme_domande WHERE id = $1`, [r.id])).rows[0].riferimenti.length, r.riferimenti.length);
    assert.equal((await VIS.post('/api/affari/norme/chiedi', { domanda: 'boh' })).s, 400);
    assert.equal((await VIS.post('/api/affari/norme', { titolo: 'Norma di prova', url: `${sito.base}/atti/1` })).s, 403);
    const nuova = must(await O.post('/api/affari/norme', { titolo: 'Atto di prova sui laboratori', url: `${sito.base}/atti/1` }), 'norma nuova'); assert.equal(nuova.acquisita, true);
    must(await O.del(`/api/affari/norme/${nuova.id}`), 'togli'); assert.equal(must(await O.get('/api/affari/norme'), 'norme').righe.length, 5);
  });
});
