// v0.71.1 · Guida GIPO, "risposte all'altezza del back-end" (docs/GIPO_GUIDA.md). Parte pura sempre: contenuti obbligatori del brief
// (sezioni di back-end, capitolo del manuale TD, almeno 40 FAQ di back-end, fonte, livello, sintesi, validazione dal manuale), sinonimi e
// frasi della ricerca, passi senza AI. Parte con database (DATABASE_URL_TEST, database temporaneo suite_ggd_<pid>) solo se la variabile
// c'è: REGRESSIONE DEL RECUPERO su almeno 25 domande reali di back-end, a partire da quella del CEO, con un modello finto che riceve i
// brani (si verifica che fra le sezioni passate al modello ci sia quella giusta); pianificazione sull'indice unita alla ricerca; esito
// PARZIALE; senza AI i passi già scritti; "Rigenera risposta" e "Segna come risolta dalla guida"; indice di ricerca mantenuto dai trigger;
// migrazione idempotente; seme con le sezioni validate dal manuale. Nessun dato reale.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import express from 'express';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database predefinito "suite". Senza DATABASE_URL_TEST un indirizzo inesistente (le parti pure non interrogano il database).
const nomeDb = `suite_ggd_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
process.env.ANTHROPIC_API_KEY = '';
const SEME = await import('../src/modules/gipoguida/lib/seme.js');
const RIC = await import('../src/modules/gipoguida/lib/ricerca.js');
const RISP = await import('../src/modules/gipoguida/lib/risposta.js');
const { DOMANDE_PROVA } = await import('../src/modules/gipoguida/lib/domande-prova.js');

const DOMANDA_CEO = 'come faccio ad impostare un\'agenda per un medico che viene in una struttura solo il primo e il terzo martedì di ogni mese';
const MANUALE = 'Manuale operativo TD-SGI-MAN007';

describe('Guida GIPO v0.71.1: contenuti di back-end e del manuale', () => {
  const s = SEME.leggiSeme();
  const titoli = new Set(s.sezioni.map((x) => x.titolo));
  test('le sezioni obbligatorie del brief ci sono, scritte come procedure (passi numerati)', () => {
    for (const t of ['Creare un\'agenda', 'Orario settimanale di un\'agenda (configurazione base)', 'Sottoconfigurazioni: periodi di validità, settimane alterne, giorni del mese',
      'Prestazioni prenotabili su un\'agenda', 'Occupazioni parziali', 'Duplicare un\'agenda', 'Giorni festivi e chiusure', 'Prestazione: listini e prezzi con validità',
      'Pacchetti con la distinta base', 'Moduli e consensi collegati a una prestazione', 'Nuovo medico e sue prestazioni', 'Regole di compenso del medico',
      'Listini: creare, copiare i prezzi con incremento', 'Tabelle che si modificano in riga', 'Assegnazione: schede SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note interne',
      'Rate e pagamenti in fattura', 'Tracciati ASL']) {
      assert.ok(titoli.has(t), t);
      const x = s.sezioni.find((y) => y.titolo === t);
      assert.match(x.corpo, /^1\. /m, `${t}: passi numerati`);
    }
  });
  test('sottoconfigurazioni: gli esempi svolti richiesti (primo e terzo martedì, settimane alterne, orario estivo, sostituzione, ferie)', () => {
    const x = s.sezioni.find((y) => y.slug === 'agenda-sottoconfigurazioni');
    for (const r of [/Esempio 1: medico presente il primo e il terzo martedì/, /Primo martedì\*\* e \*\*Terzo martedì/, /Periodicità in settimane\*\* 2/, /Esempio 3: orario estivo/,
      /Esempio 4: sostituzione temporanea/, /Esempio 5: chiusura per ferie/, /Giorni festivi/, /Cosa verificare dopo/, /Da provare prima su un'agenda di prova/]) assert.match(x.corpo, r);
    assert.equal(x.stato, 'DA_VALIDARE', 'procedura dedotta dai campi: resta da validare');
    assert.equal(x.livello, 'BACK_END');
  });
  test('capitoli "Back-end: configurare GIPO" e "Percorso del paziente secondo il manuale TD"; sezioni del manuale VALIDATE con la fonte', () => {
    assert.ok(s.capitoli.some((k) => k.titolo === 'Back-end: configurare GIPO'));
    assert.ok(s.capitoli.some((k) => k.titolo === 'Percorso del paziente secondo il manuale TD'));
    const validate = s.sezioni.filter((x) => x.stato === 'VALIDATA');
    assert.ok(validate.length >= 20, `validate ${validate.length}`);
    assert.ok(validate.every((x) => x.validazione === MANUALE && ['MANUALE_TD', 'INTERFACCIA+MANUALE'].includes(x.fonte)), 'solo il manuale valida');
    for (const slug of ['fase0-prenotazione', 'fase-arrivo', 'fase1-anagrafica-consensi', 'fase2-canale-ssn', 'fase2-canale-privato', 'fase2-canale-assicurazione', 'fase3-impegnativa',
      'fase4-assegnazione', 'fase5-fatturazione', 'fase6a-laboratorio', 'fase6b-immagini', 'fase7-refertazione', 'fase8-credenziali', 'fase9-post-erogazione', 'checklist-td',
      'riferimenti-normativi', 'glossario-manuale', 'sport-nuova-visita', 'sport-idoneita-certificati']) assert.ok(validate.some((x) => x.slug === slug), slug);
    // dove manuale e interfaccia divergono c'è la nota
    assert.ok(s.sezioni.filter((x) => /### Da riconciliare con il manuale/.test(x.corpo)).length >= 6);
    assert.match(s.sezioni.find((x) => x.slug === 'fase5-fatturazione').corpo, /Natura bollo\*\*.*\*\*N4\*\*/s);
    // nessun dato personale dal frontespizio del manuale (nomi di chi lo ha redatto e approvato)
    const tutto = s.sezioni.map((x) => x.corpo).join('\n');
    for (const nome of ['Greco', 'Cupelli', 'Epifani', '23133010']) assert.ok(!tutto.includes(nome), nome);
  });
  test('fonte, livello e sintesi su ogni sezione; almeno 40 FAQ di back-end nuove', () => {
    assert.ok(s.sezioni.every((x) => x.sintesi && SEME.FONTI.includes(x.fonte) && SEME.LIVELLI.includes(x.livello)));
    assert.ok(s.sezioni.filter((x) => x.livello === 'BACK_END').length >= 35);
    const be = s.faq.filter((f) => f.chiave.startsWith('be-'));
    assert.ok(be.length >= 40, `FAQ di back-end ${be.length}`);
    for (const d of ['Come imposto un medico presente solo alcuni giorni del mese?', 'Come cambio l\'orario di un\'agenda da una certa data?', 'Come blocco un\'agenda per ferie?',
      'Come aggiungo una prestazione a un listino?', 'Come aumento tutti i prezzi di un listino del 5%?', 'Come creo un pacchetto?', 'Come collego un consenso a una prestazione?',
      'Come imposto il compenso di un medico?', 'Come limito le prestazioni prenotabili su un\'agenda?', 'Come aggiungo una sede o un sezionale?']) assert.ok(s.faq.some((f) => f.domanda === d), d);
  });
  test('sinonimi e frasi della ricerca', () => {
    const alt = (t) => RIC.gruppiRicerca(t).flatMap((x) => [x.parola, ...x.alternative]);
    assert.ok(alt('calendario').includes('agenda')); assert.ok(alt('turni').includes('agenda'));
    assert.ok(alt('specialista').includes('medico')); assert.ok(alt('dottore').includes('medico'));
    assert.ok(alt('tariffa').includes('listino')); assert.ok(alt('provvigione').includes('compenso'));
    assert.ok(alt('ferie').includes('giorni festivi')); assert.ok(alt('distinta').includes('pacchetto'));
    assert.deepEqual(RIC.gruppiRicerca('come faccio a creare un pacchetto').map((g) => g.parola), ['creare', 'pacchetto'], 'parole vuote tolte');
    const fr = (t) => RIC.frasiRicerca(t).flatMap((x) => [x.parola, ...x.alternative]);
    assert.ok(fr(DOMANDA_CEO).includes('periodicità nel mese'));
    assert.ok(fr('viene ogni due settimane').includes('periodicità in settimane'));
    assert.ok(fr('aumento del 5%').includes('incremento'));
    assert.deepEqual(fr('Come faccio una nota di credito?'), []);
  });
  test('senza AI: i passi già scritti di una sezione', () => {
    const p = RISP.passiDi('### A cosa serve\nX.\n\n### Come si fa\n1. Apri.\n2. Salva.\n\n### Esempio\nUn caso.\n\n### Attenzioni\n- Y.');
    assert.match(p, /### Come si fa\n1\. Apri\.\n2\. Salva\./); assert.match(p, /### Esempio/); assert.ok(!/Attenzioni/.test(p));
  });
});

describe('Guida GIPO v0.71.1 con database: recupero e risposte', { skip: SALTA }, () => {
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  let db; const M = {}; let srv; let base; let utente;
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const http = async (metodo, p, body) => {
    const r = await fetch(base + p, { method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  // modello finto: il piano restituisce `piano` (id), la risposta registra i brani ricevuti e risponde secondo `risposta`
  const finto = { piano: [], risposta: () => ({ testo: 'Procedura [1].\n1. Apri.\nDa provare prima su un\'agenda di prova.', fonti: [1], copre: true, dedotto: true }), piani: [], brani: [] };
  const modelloFinto = async ({ fase, user, brani }) => {
    if (fase === 'pianifica') { finto.piani.push(user); return { sezioni: finto.piano }; }
    finto.brani.push({ user, brani }); return finto.risposta(brani);
  };

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('gipoguida', null);
    await SEME.caricaSeme();
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    M.owner = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('titolare.ggd@prova.invalid', 'Titolare Prova', 'OWNER', 'ACTIVE') RETURNING id`)).id;
    M.lettore = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('lettore.ggd@toscanadiagnostica.it', 'Lettore Prova', 'USER', 'ACTIVE') RETURNING id`)).id;
    const guida = (await import('../src/modules/gipoguida/routes/guida.js')).default;
    const red = (await import('../src/modules/gipoguida/routes/redazione.js')).default;
    const app = express(); app.use(express.json());
    app.use((req, _res, nx) => { req.user = { id: utente.id, level: utente.level || 'USER', grants: {} }; req.moduleUser = { role: utente.role }; nx(); });
    app.use('/api/gipoguida', guida, red);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    base = `http://127.0.0.1:${srv.address().port}/api/gipoguida`;
  }, { timeout: 180000 });
  after(async () => {
    RISP._impostaModello(undefined);
    srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    const { modulePool } = await import('../src/lib/modules.js').catch(() => ({}));
    await modulePool?.('gipoguida').end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });
  const ADMIN = () => ({ id: M.owner, role: 'ADMIN', level: 'OWNER' });
  const LETTORE = () => ({ id: M.lettore, role: 'LETTORE' });

  test(`regressione del recupero: ${DOMANDE_PROVA.length} domande di back-end, la sezione giusta è fra quelle passate al modello`, async () => {
    assert.ok(DOMANDE_PROVA.length >= 25);
    assert.equal(DOMANDE_PROVA[0].domanda, DOMANDA_CEO);
    RISP._impostaModello(modelloFinto);
    finto.piano = [];   // nessun aiuto dal piano: si verifica il recupero full text, che vale anche senza AI
    const mancate = [];
    for (const x of DOMANDE_PROVA) {
      finto.brani.length = 0;
      const r = await RISP.chiedi(x.domanda, { userId: null });
      assert.notEqual(r.esito, 'SENZA_RISPOSTA', x.domanda);
      const slugs = finto.brani[0].brani.filter((b) => b.tipo === 'sezione').map((b) => b.slug);
      assert.ok(slugs.length <= 12, 'al più 12 sezioni');
      if (!x.attese.some((a) => slugs.includes(a))) mancate.push(`${x.domanda} -> ${slugs.slice(0, 5).join(', ')}`);
    }
    assert.deepEqual(mancate, [], 'domande che non recuperano la sezione attesa');
  });

  test('domanda del CEO: Sottoconfigurazioni in testa, testo integrale con l\'esempio al modello, esito PARZIALE (non "non copre")', async () => {
    RISP._impostaModello(modelloFinto);
    finto.piano = []; finto.brani.length = 0; finto.piani.length = 0;
    utente = LETTORE();
    const r = await http('POST', '/chiedi', { domanda: DOMANDA_CEO });
    assert.equal(r.s, 200, JSON.stringify(r.j));
    const b = finto.brani[0].brani;
    assert.equal(b[0].slug, 'agenda-sottoconfigurazioni');
    assert.match(finto.brani[0].user, /\[1\] Sezione "Sottoconfigurazioni: periodi di validità, settimane alterne, giorni del mese" \(agenda-sottoconfigurazioni; capitolo 14 Back-end: configurare GIPO; da validare/);
    assert.match(finto.brani[0].user, /Esempio 1: medico presente il primo e il terzo martedì del mese/, 'testo integrale, non uno spezzone');
    assert.ok(b.some((x) => x.tipo === 'faq'), 'con le FAQ collegate');
    assert.equal(r.j.esito, 'PARZIALE');
    assert.equal(finto.piani.length, 1);
    assert.match(finto.piani[0], /\| Sottoconfigurazioni: periodi di validità/, 'il piano riceve l\'indice completo');
    const nSez = (await uno('SELECT count(*)::int AS n FROM gipoguida.sezioni')).n;
    assert.equal((finto.piani[0].match(/^\d+ \| cap\. /gm) || []).length, nSez, 'una riga per sezione');
    const d = await uno('SELECT esito FROM gipoguida.domande WHERE id = $1', [r.j.id]);
    assert.equal(d.esito, 'PARZIALE');
    const coda = (await uno(`SELECT count(*)::int AS n FROM gipoguida.domande d WHERE d.id = $1 AND d.risolta_il IS NULL AND (d.esito = 'SENZA_RISPOSTA' OR d.utile = FALSE)`, [r.j.id])).n;
    assert.equal(coda, 0, 'PARZIALE non va in coda');
  });

  test('pianificazione: le sezioni scelte dal modello sull\'indice si uniscono a quelle della ricerca', async () => {
    RISP._impostaModello(modelloFinto);
    const chk = await uno(`SELECT id FROM gipoguida.sezioni WHERE slug = 'checklist-td'`);
    finto.piano = [chk.id, 999999]; finto.brani.length = 0;
    await RISP.chiedi('Come aggiungo una prestazione a un listino?', { userId: null });
    const slugs = finto.brani[0].brani.filter((b) => b.tipo === 'sezione').map((b) => b.slug);
    assert.ok(slugs.includes('checklist-td'), 'sezione del piano inclusa');
    assert.ok(slugs.includes('prestazione-listini-prezzi'), 'e quella della ricerca resta');
    finto.piano = [];
  });

  test('senza AI: la domanda del CEO mostra i passi della sezione Sottoconfigurazioni (SOLO_RICERCA, non "senza risposta")', async () => {
    RISP._impostaModello(false);
    utente = LETTORE();
    const r = await http('POST', '/chiedi', { domanda: DOMANDA_CEO });
    assert.equal(r.j.esito, 'SOLO_RICERCA');
    assert.equal(r.j.procedure[0].slug, 'agenda-sottoconfigurazioni');
    assert.match(r.j.procedure[0].passi, /Periodicità nel mese/);
    assert.match(r.j.procedure[0].passi, /Esempio 1/);
  });

  test('il modello che dice "non copre" su un tema assente → SENZA_RISPOSTA con la sezione più vicina, in coda', async () => {
    RISP._impostaModello(async ({ fase }) => (fase === 'pianifica' ? { sezioni: [] } : { testo: 'La guida non copre questa domanda. La sezione più vicina è [1].', fonti: [1], copre: false }));
    utente = LETTORE();
    const r = await http('POST', '/chiedi', { domanda: 'Come imposto la stampa della fattura in inglese?' });
    assert.equal(r.j.esito, 'SENZA_RISPOSTA');
    assert.ok(r.j.procedure.length >= 1, 'la sezione più vicina');
  });

  test('redazione: Rigenera risposta e Segna come risolta dalla guida (notifica a chi aveva chiesto)', async () => {
    RISP._impostaModello(false);
    utente = LETTORE();
    const q1 = await http('POST', '/chiedi', { domanda: 'Come blocco un\'agenda per ferie?' });
    assert.equal((await http('POST', `/domande/${q1.j.id}/valuta`, { utile: false, nota: 'Mi serviva la procedura per un solo medico' })).j.in_coda, true);
    utente = ADMIN();
    RISP._impostaModello(modelloFinto);
    finto.risposta = () => ({ testo: 'Per un solo medico usa una sottoconfigurazione con i giorni spenti [1].', fonti: [1], copre: true, dedotto: false });
    const rg = await http('POST', `/redazione/domande/${q1.j.id}/rigenera`);
    assert.equal(rg.s, 200, JSON.stringify(rg.j));
    assert.equal(rg.j.esito, 'RISPOSTA'); assert.equal(rg.j.rigenerazioni, 1); assert.match(rg.j.risposta, /sottoconfigurazione/);
    const coda1 = await http('GET', '/redazione/coda');
    const voce = coda1.j.righe.find((x) => x.id === q1.j.id);
    assert.ok(voce, 'resta in coda finché la redazione non la segna risolta'); assert.equal(voce.rigenerazioni, 1);
    const ok = await http('POST', `/redazione/domande/${q1.j.id}/risolta-dalla-guida`, { nota: 'Aggiornata la sezione 14.4' });
    assert.equal(ok.s, 200, JSON.stringify(ok.j)); assert.equal(ok.j.notificato, true);
    assert.ok(!(await http('GET', '/redazione/coda')).j.righe.some((x) => x.id === q1.j.id), 'fuori dalla coda');
    const d = await uno('SELECT risolta_dalla_guida, risolta_il, risolta_con_faq_id FROM gipoguida.domande WHERE id = $1', [q1.j.id]);
    assert.equal(d.risolta_dalla_guida, true); assert.ok(d.risolta_il); assert.equal(d.risolta_con_faq_id, null);
    const n = await uno(`SELECT title, link FROM public.notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [M.lettore]);
    assert.match(n.title, /la guida ora risponde/); assert.equal(n.link, `/gipoguida?domanda=${q1.j.id}`);
    assert.equal((await http('POST', `/redazione/domande/${q1.j.id}/risolta-dalla-guida`, {})).s, 400, 'già risolta');
    utente = LETTORE();
    assert.equal((await http('POST', `/redazione/domande/${q1.j.id}/rigenera`)).s, 403, 'solo la redazione');
    const st = await http('GET', '/redazione/coda'); assert.equal(st.s, 403);
    finto.risposta = () => ({ testo: 'Procedura [1].', fonti: [1], copre: true, dedotto: true });
  });

  test('indice di ricerca: trigger su sezioni e FAQ, filtro per livello, ricerca della pagina', async () => {
    assert.equal((await uno('SELECT count(*)::int AS n FROM gipoguida.sezioni WHERE ricerca_tsv IS NULL')).n, 0);
    // una FAQ nuova con una parola che non c'è altrove porta la sua sezione nei risultati
    const s = await uno(`SELECT id FROM gipoguida.sezioni WHERE slug = 'agenda-duplicare'`);
    await db.query(`INSERT INTO gipoguida.faq (domanda, risposta, sezione_id, origine) VALUES ('Come gestisco lo zibaldone delle agende?', 'Con Duplica agenda.', $1, 'REDAZIONE')`, [s.id]);
    assert.ok((await RIC.recupera('zibaldone')).sezioni.some((x) => x.slug === 'agenda-duplicare'));
    await db.query(`UPDATE gipoguida.faq SET pubblicata = FALSE WHERE domanda LIKE '%zibaldone%'`);
    assert.ok(!(await RIC.recupera('zibaldone')).sezioni.some((x) => x.slug === 'agenda-duplicare'), 'tolta dalla pubblicazione, tolta dall\'indice');
    const be = await RIC.cercaGuida('agenda', { livello: 'BACK_END', tipi: ['sezione'] });
    assert.ok(be.length > 0 && be.every((x) => x.livello === 'BACK_END'));
    const r = await RIC.cercaGuida('nota di credito');
    assert.equal(r[0].slug, 'nota-di-credito');
    utente = LETTORE();
    const h = await http('GET', '/cerca?q=sottoconfigurazione&livello=BACK_END&registra=0');
    assert.equal(h.s, 200); assert.equal(h.j.risultati[0].slug, 'agenda-sottoconfigurazioni');
    const ind = await http('GET', '/indice');
    assert.ok(ind.j.totali.back_end >= 35 && ind.j.totali.dal_manuale >= 25);
    const sez = await http('GET', '/sezioni/fase5-fatturazione');
    assert.equal(sez.j.stato, 'VALIDATA'); assert.equal(sez.j.fonte, 'MANUALE_TD'); assert.equal(sez.j.fonte_validazione, MANUALE); assert.equal(sez.j.ricerca_tsv, undefined);
  });

  test('migrazione 002 idempotente; seme: validazione dal manuale aggiornabile, validazione di una persona protetta; ripristino con lo stato del seme', async () => {
    const sql = fs.readFileSync(path.join(SEME.CONTENT_DIR, '..', 'migrations', '002_back_end.sql'), 'utf8');
    const c = new pg.Client({ connectionString: dbUrl(), options: '-c search_path=gipoguida,public' }); await c.connect();
    try { await c.query(sql); await c.query(sql); } finally { await c.end(); }
    assert.equal((await uno('SELECT count(*)::int AS n FROM gipoguida.sezioni WHERE ricerca_tsv IS NULL')).n, 0);
    // una sezione validata da una persona non si tocca; una validata dal seme sì (il testo del seme è cambiato)
    utente = ADMIN();
    const fase3 = await uno(`SELECT id FROM gipoguida.sezioni WHERE slug = 'fase3-impegnativa'`);
    await http('POST', `/redazione/sezioni/${fase3.id}/stato`, { stato: 'DA_VALIDARE' });
    await http('POST', `/redazione/sezioni/${fase3.id}/stato`, { stato: 'VALIDATA', nota: 'verificata con la responsabile accettazione' });
    const dir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'ggd-seme-'));
    try {
      for (const f of fs.readdirSync(SEME.CONTENT_DIR)) {
        let t = fs.readFileSync(path.join(SEME.CONTENT_DIR, f), 'utf8');
        if (f.startsWith('15-')) t = t.replaceAll('Quasi tutte le impegnative sono dematerializzate', 'Le impegnative sono quasi tutte dematerializzate').replaceAll('Il percorso del paziente inizia dalla prenotazione', 'Il percorso inizia dalla prenotazione');
        fs.writeFileSync(path.join(dir, f), t);
      }
      const r = await SEME.caricaSeme({ dir });
      assert.ok(r.sezioni.protette.includes('fase3-impegnativa'), 'validata da una persona: protetta');
      assert.ok(!r.sezioni.protette.includes('fase0-prenotazione'));
      const f0 = await uno(`SELECT corpo, stato, fonte_validazione FROM gipoguida.sezioni WHERE slug = 'fase0-prenotazione'`);
      assert.match(f0.corpo, /Il percorso inizia dalla prenotazione/); assert.equal(f0.stato, 'VALIDATA'); assert.equal(f0.fonte_validazione, MANUALE);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // ripristino dal seme: torna VALIDATA con la fonte del manuale
    const rp = await http('POST', `/redazione/sezioni/${fase3.id}/ripristina-seme`);
    assert.equal(rp.j.stato, 'VALIDATA'); assert.equal(rp.j.fonte_validazione, MANUALE);
    await SEME.caricaSeme({ forza: true });
  });

  test('PDF: capitolo back-end, fonti e bollini', async () => {
    const PDF = await import('../src/modules/gipoguida/lib/pdf.js');
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    PDF.invalidaPdf();
    const p = await PDF.pdfGuida();
    const t = (await pdfParse(p.buffer)).text.replace(/\s+/g, ' ');
    for (const x of ['Back-end: configurare GIPO', 'Percorso del paziente secondo il manuale TD', 'VALIDATA · Manuale operativo TD-SGI-MAN007', 'BACK-END', 'Fonte: interfaccia di GIPO',
      'Esempio 1: medico presente il primo e il terzo martedì del mese', 'Da riconciliare con il manuale']) assert.ok(t.includes(x), x);
    assert.ok(p.pagine > 100, `pagine ${p.pagine}`);
  });
});
