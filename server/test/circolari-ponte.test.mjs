// Circolari interne: una sola serie (CEO, 08/11/2026). Ponte Comunicazione ↔ Circolari (server/src/modules/circolari/lib/ponte.js):
// - funzioni pure: Markdown della news → blocchi della circolare, pulizia in linea, esiti della diffusione dal registro email;
// - integrazione (con DATABASE_URL_TEST): modulo Circolari spento → CIRC- provvisorio con avviso; modulo avviato → TD-AAAA/NNN con riga in
//   Archivio (origine COMUNICAZIONE, allegato, PDF), stessa serie per le circolari redatte nel modulo, Diagnostica D42 "Registra" sulla
//   CIRC- preesistente (storico in protocol_legacy, nessuna nuova notifica), revisione -r1 dall'aggiornamento della news, niente doppioni.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { markdownInBlocchi, testoInLinea, esitiDiffusione } from '../src/modules/circolari/lib/ponte.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

test('testoInLinea: grassetti, corsivi, codice e collegamenti tolti senza perdere il testo', () => {
  assert.equal(testoInLinea('Il **nuovo** orario e *valido* dal `lunedì`'), 'Il nuovo orario e valido dal lunedì');
  assert.equal(testoInLinea('Vedi [la procedura](https://sgi.toscanadiagnostica.it/p/1)'), 'Vedi la procedura (https://sgi.toscanadiagnostica.it/p/1)');
  assert.equal(testoInLinea('Immagine ![foto](file:12) qui'), 'Immagine qui');
  assert.equal(testoInLinea('codice_fiscale e nome_file restano'), 'codice_fiscale e nome_file restano');
  assert.equal(testoInLinea('[allegato](file:33)'), 'allegato');
});

test('markdownInBlocchi: titoli, paragrafi, elenchi, citazioni, tabelle e separatori', () => {
  const md = '# Nuovo orario\n\nDal **1° dicembre** cambia\nl\'orario dei prelievi.\n\n## Cosa fare\n- Avvisare i pazienti\n- Aggiornare\n  il cartello\n1. primo\n2. secondo\n\n> Nota bene: vale per tutte le sedi.\n\n---\n\n| Sede | Orario |\n|---|---|\n| Firenze | 7-10 |\n| Prato | 7:30-10 |\n';
  assert.deepEqual(markdownInBlocchi(md), [
    { type: 'titolo', text: 'Nuovo orario' },
    { type: 'paragrafo', text: 'Dal 1° dicembre cambia l\'orario dei prelievi.' },
    { type: 'titolo', text: 'Cosa fare' },
    { type: 'elenco', items: ['Avvisare i pazienti', 'Aggiornare il cartello', '1. primo', '2. secondo'] },
    { type: 'paragrafo', text: 'Nota bene: vale per tutte le sedi.' },
    { type: 'tabella', colonne: ['Sede', 'Orario'], righe: [['Firenze', '7-10'], ['Prato', '7:30-10']] },
  ]);
});

test('markdownInBlocchi: nessun testo perso (paragrafi lunghi divisi, non troncati) e testo vuoto', () => {
  const frase = 'Questa è una frase della circolare che si ripete. ';
  const lungo = frase.repeat(250).trim();
  const b = markdownInBlocchi(lungo);
  assert.ok(b.length >= 3 && b.every((x) => x.type === 'paragrafo' && x.text.length <= 5000));
  assert.equal(b.map((x) => x.text).join(' '), lungo);
  assert.deepEqual(markdownInBlocchi(''), []);
  assert.deepEqual(markdownInBlocchi('| a | b |\n| c | d |'), [{ type: 'paragrafo', text: 'a b c d' }]);   // senza riga di separazione non è una tabella
});

test('esitiDiffusione: ultimo tentativo per indirizzo, senza email esclusi, inviate/registrate ok', () => {
  const dest = [{ email: 'a@td.it' }, { email: 'B@td.it' }, { email: 'c@td.it' }, { email: null }];
  const log = [{ to_addr: 'a@td.it', status: 'FAILED', error: 'x' }, { to_addr: 'a@td.it', status: 'SENT' }, { to_addr: 'b@td.it', status: 'FAILED', error: 'Graph 403' }];
  const e = esitiDiffusione(dest, log);
  assert.equal(e.inviati, 1); assert.equal(e.errori, 1);
  assert.deepEqual(e.esito.map((x) => x.stato), ['INVIATA', 'FALLITA', 'NON_INVIATA']);
  assert.equal(esitiDiffusione(dest, [{ to_addr: 'c@td.it', status: 'LOGGED' }]).esito[2].stato, 'SOLO_REGISTRATA');
});

// ------------------------------------------------------------------ integrazione
let suite = null;
after(async () => { if (suite) await suite.stop(); });

test('ponte Comunicazione ↔ Circolari: una sola serie TD-AAAA/NNN', { skip: SALTA, timeout: 300_000 }, async () => {
  suite = await avviaSuite();
  const o = await entra(client(suite.base), OWNER.email, OWNER.password, OWNER.finale);
  const db = new pg.Client({ connectionString: suite.url }); await db.connect();
  const anno = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date());
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const nuovaCircolare = async (title, extra = {}) => must(await o.post('/api/community/manage/news', { kind: 'CIRCOLARE', title, summary: `Sintesi di ${title}`, body: `# ${title}\n\nTesto della circolare **${title}**.\n\n- prima voce\n- seconda voce`, audience: { type: 'INTERNAL' }, requires_ack: true, ...extra }), `bozza ${title}`);
  try {
    // 1. Modulo Circolari non avviato: protocollo provvisorio CIRC- e avviso nell'esito
    const n1 = await nuovaCircolare('Circolare di lancio');
    const p1 = must(await o.post(`/api/community/manage/news/${n1.id}/publish`), 'pubblica n1');
    assert.equal(p1.protocol, `CIRC-${anno}-001`);
    assert.equal(p1.protocollo_provvisorio, true);
    assert.match(p1.avviso_registro, /avvia il modulo Circolari per il registro unico/);
    assert.equal(p1.circolare, null);
    const notifiche1 = Number((await db.query(`SELECT count(*) FROM notifications WHERE link = $1`, [`/community/news/${p1.slug}`])).rows[0].count);

    // 2. Avvio del modulo Circolari (vuoto, LIVE)
    must(await o.post('/api/travaso/circolari/run'), 'avvio circolari');

    // 3. Circolare da Comunicazione con presa visione e un allegato → TD-AAAA/001 in archivio, PDF, link incrociati
    const owner = (await db.query('SELECT id FROM users WHERE lower(email) = $1', [OWNER.email])).rows[0].id;
    const file = (await db.query(`INSERT INTO files (scope, owner_user_id, blob_path, filename, mime, size) VALUES ('NEWS', $1, 'news/test/modulo.pdf', 'Modulo di adesione.pdf', 'application/pdf', 2048) RETURNING id`, [owner])).rows[0].id;
    const n2 = await nuovaCircolare('Nuovo orario dei prelievi', { file_ids: [file], ack_due: `${anno}-12-31` });
    const p2 = must(await o.post(`/api/community/manage/news/${n2.id}/publish`), 'pubblica n2');
    assert.equal(p2.protocol, `TD-${anno}/001`);
    assert.equal(p2.protocollo_provvisorio, false);
    assert.ok(p2.circolare?.id, 'riga in Circolari');
    assert.equal(p2.circolare.link, `/circolari/${p2.circolare.id}`);
    const arch = must(await o.get('/api/circolari/circolari?origine=COMUNICAZIONE'), 'archivio');
    assert.equal(arch.total, 1);
    assert.equal(arch.rows[0].stato, 'PUBBLICATA');
    assert.equal(arch.rows[0].news.slug, p2.slug);
    const det = must(await o.get(`/api/circolari/circolari/${p2.circolare.id}`), 'scheda');
    assert.equal(det.origine, 'COMUNICAZIONE'); assert.equal(det.news_id, n2.id); assert.equal(det.tipo, 'INTERNA'); assert.equal(det.segmento, 'PERSONALE');
    assert.equal(det.destinatari, 'Personale interno');
    assert.deepEqual(det.allegati.map((a) => a.filename), ['Modulo di adesione.pdf']);
    assert.ok(det.corpo.some((b) => b.type === 'elenco' && b.items.includes('prima voce')));
    assert.ok(det.corpo.some((b) => b.type === 'elenco' && b.items.includes('Modulo di adesione.pdf')), 'allegati nel corpo');
    assert.ok(det.invii.some((i) => i.news_id === n2.id && /Comunicazione/.test(i.lista_nome)), 'diffusione al segmento Personale');
    const letta = must(await o.get(`/api/community/news/${p2.slug}`), 'news');
    assert.equal(letta.circolare.id, p2.circolare.id);
    assert.equal(letta.circolare.archivio, `/circolari/${p2.circolare.id}`);
    if (p2.circolare.has_pdf) {
      const pdf = await fetch(`${suite.base}/api/community/news/${n2.id}/pdf`, { headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
      assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    }
    const pv = await o.post(`/api/circolari/circolari/${p2.circolare.id}/presa-visione`);
    assert.equal(pv.s, 400, 'presa visione solo nella news');
    assert.equal((await o.post(`/api/circolari/circolari/${p2.circolare.id}/revisione`)).s, 400, 'revisione solo da Comunicazione');

    // 4. Circolare redatta nel modulo Circolari: numero successivo della stessa serie
    const bozza = must(await o.post('/api/circolari/circolari', { titolo: 'Circolare dal modulo', segmento: 'PERSONALE', corpo: [{ type: 'paragrafo', text: 'Testo della circolare redatta nel modulo.' }] }), 'bozza modulo');
    const pub = must(await o.post(`/api/circolari/circolari/${bozza.id}/pubblica`), 'pubblica modulo');
    assert.equal(pub.protocollo, `TD-${anno}/002`);

    // 5. Diagnostica D42: la CIRC- preesistente entra nel registro con il numero successivo, senza nuove notifiche
    const diag = must(await o.get('/api/admin/diagnostica'), 'diagnostica');
    const d42 = diag.risultati.find((k) => k.id === 'D42');
    assert.ok(d42, 'controllo D42');
    assert.equal(d42.n, 1);
    const corr = must(await o.post('/api/admin/diagnostica/D42/correggi', { ids: [n1.id], conferma: 'CORREGGI' }), 'Registra');
    assert.equal(corr.dopo.n, 0);
    const n1dopo = (await db.query('SELECT protocol, protocol_legacy, circolare_id FROM news WHERE id = $1', [n1.id])).rows[0];
    assert.equal(n1dopo.protocol, `TD-${anno}/003`);
    assert.equal(n1dopo.protocol_legacy, `CIRC-${anno}-001`);
    assert.ok(n1dopo.circolare_id);
    const notifiche1dopo = Number((await db.query(`SELECT count(*) FROM notifications WHERE link = $1`, [`/community/news/${p1.slug}`])).rows[0].count);
    assert.equal(notifiche1dopo, notifiche1, 'notifica non ripetuta');
    assert.equal((await o.post('/api/admin/diagnostica/D42/correggi', { ids: [n1.id], conferma: 'CORREGGI' })).s, 400, 'seconda Registra: nulla da fare');
    assert.equal(Number((await db.query('SELECT count(*) FROM circolari.circolari WHERE news_id = $1', [n1.id])).rows[0].count), 1, 'niente doppioni');

    // 6. Aggiornamento della circolare pubblicata in Comunicazione → revisione TD-AAAA/001-r1, la precedente SUPERATA
    const agg = must(await o.put(`/api/community/manage/news/${n2.id}`, { body: '# Nuovo orario dei prelievi\n\nTesto corretto della circolare.' }), 'aggiorna n2');
    assert.equal(agg.revisione_circolare?.protocollo, `TD-${anno}/001-r1`);
    assert.equal(agg.protocol, `TD-${anno}/001-r1`);
    const stati = (await db.query('SELECT revisione, stato FROM circolari.circolari WHERE news_id = $1 ORDER BY revisione', [n2.id])).rows;
    assert.deepEqual(stati.map((x) => [x.revisione, x.stato]), [[0, 'SUPERATA'], [1, 'PUBBLICATA']]);
    const soloTag = must(await o.put(`/api/community/manage/news/${n2.id}`, { tags: ['orari'] }), 'aggiorna solo i tag');
    assert.equal(soloTag.revisione_circolare, null, 'nessuna revisione senza modifiche al contenuto');

    // 7. Un nuovo protocollo provvisorio non riusa mai CIRC-AAAA-001 (storico in protocol_legacy)
    await db.query(`UPDATE module_state SET mode = 'OFF' WHERE key = 'circolari'`);
    const n3 = await nuovaCircolare('Circolare con modulo spento');
    const p3 = must(await o.post(`/api/community/manage/news/${n3.id}/publish`), 'pubblica n3');
    assert.equal(p3.protocol, `CIRC-${anno}-002`);
    await db.query(`UPDATE module_state SET mode = 'LIVE' WHERE key = 'circolari'`);
  } finally { await db.end(); }
});
