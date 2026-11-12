// v0.70.0 · Guida GIPO (modulo `gipoguida`, docs/GIPO_GUIDA.md). Parte pura sempre: filtro dei dati personali, seme dei contenuti (struttura,
// numeri minimi, regole di stile), sinonimi, "Apri in GIPO", markdown del PDF, pulizia del testo del modello. Parte con database
// (DATABASE_URL_TEST, database temporaneo suite_gg_<pid>) solo se la variabile c'è: caricamento del seme idempotente che non sovrascrive le
// sezioni toccate a mano, ricerca full text con sinonimi ed evidenziazione, /chiedi con il modello finto e senza AI, mascheramento prima del
// salvataggio e dell'invio al modello, limite orario, coda e risoluzione con FAQ e notifica, PDF (pagine > 20, titoli dei capitoli),
// ricerca globale della Suite, Diagnostica D56, riepilogo settimanale; integrazione con la Suite vera: l'accesso esterno è escluso.
// Nessun dato reale: domande e codici fiscali sono inventati.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import express from 'express';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database predefinito "suite". Senza DATABASE_URL_TEST un indirizzo inesistente (le parti pure non interrogano il database).
const nomeDb = `suite_gg_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
process.env.ANTHROPIC_API_KEY = '';
const P = await import('../src/modules/gipoguida/lib/privacy.js');
const SEME = await import('../src/modules/gipoguida/lib/seme.js');
const RIC = await import('../src/modules/gipoguida/lib/ricerca.js');
const CORE = await import('../src/modules/gipoguida/lib/core.js');
const PDF = await import('../src/modules/gipoguida/lib/pdf.js');
const RISP = await import('../src/modules/gipoguida/lib/risposta.js');

const CF_FINTO = 'RSSMRA80A01H501U';   // codice fiscale di esempio (formato valido, persona inesistente)

describe('Guida GIPO: filtro dei dati personali', () => {
  test('codici fiscali (anche con omocodia), email e numeri lunghi mascherati; date e importi restano', () => {
    const r = P.maschera(`Paziente ${CF_FINTO} e rssmra80a01h50mu, tel. 333 123 4567, +39 055.776511 mail nome.cognome@esempio.it il 12/03/2026 € 38,00 fattura n. 1234`);
    assert.ok(!r.testo.includes(CF_FINTO));
    assert.ok(!/rssmra80a01h50mu/i.test(r.testo), 'omocodia');
    assert.ok(!r.testo.includes('333 123 4567'));
    assert.ok(!r.testo.includes('055.776511'));
    assert.ok(!r.testo.includes('@esempio.it'));
    assert.match(r.testo, /12\/03\/2026/); assert.match(r.testo, /38,00/); assert.match(r.testo, /n\. 1234/);
    assert.deepEqual(r.mascherati.sort(), ['codice fiscale', 'email', 'numero di telefono o identificativo'].sort());
    assert.deepEqual(P.maschera('Come faccio una nota di credito?').mascherati, []);
  });
});

describe('Guida GIPO: seme dei contenuti', () => {
  const s = SEME.leggiSeme();
  test('struttura: 18 capitoli (0-17), almeno 130 sezioni e 110 FAQ, ogni FAQ collegata a una sezione esistente', () => {
    assert.deepEqual(s.capitoli.map((k) => k.numero), Array.from({ length: 18 }, (_, i) => i));
    assert.ok(s.sezioni.length >= 130, `sezioni ${s.sezioni.length}`);
    assert.ok(s.faq.length >= 110, `faq ${s.faq.length}`);
    const slugs = new Set(s.sezioni.map((x) => x.slug));
    assert.ok(s.faq.every((f) => f.sezione_slug && slugs.has(f.sezione_slug)));
    for (const k of s.capitoli) assert.ok(s.sezioni.some((x) => x.capitolo === k.numero), `capitolo ${k.numero} senza sezioni`);
    // le domande richieste dal brief ci sono
    for (const d of ['Come accetto un paziente arrivato?', 'Come annullo un appuntamento?', 'Come faccio una nota di credito?', 'Perché Nuovo referto dal menu dà errore?', 'Dove vedo l\'esito della fattura elettronica?', 'Come stampo la chiusura di cassa?']) {
      assert.ok(s.faq.some((f) => f.domanda === d), d);
    }
  });
  test('stile: niente trattini lunghi, emoji, "approfondire"; i percorsi sono quelli del menu di GIPO', () => {
    const testi = [...s.sezioni.flatMap((x) => [x.titolo, x.corpo]), ...s.faq.flatMap((f) => [f.domanda, f.risposta]), ...s.capitoli.flatMap((k) => [k.titolo, k.intro])].join('\n');
    assert.ok(!/[\u2013\u2014]/.test(testi), 'trattini lunghi');
    assert.ok(!/\p{Extended_Pictographic}/u.test(testi), 'emoji');
    assert.ok(!/approfondir/i.test(testi), 'approfondire');
    for (const x of s.sezioni.filter((y) => y.percorso_gipo)) assert.match(x.percorso_gipo, /^\/[A-Za-z0-9/_-]+$/, x.slug);
    assert.equal(s.sezioni.find((x) => x.slug === 'referto-avvio').corpo.includes('Errore creazione referto'), true);
    assert.equal(s.sezioni.find((x) => x.slug === 'gipo730').corpo.includes('Account non configurato'), true);
  });
  test('analizzaFile: front-matter e blocchi; errori chiari', () => {
    const a = SEME.analizzaFile('---\ncapitolo: 3\ntitolo: Prova\n---\n=== sezione\nslug: a\ntitolo: A\n===\ntesto A\n\n=== sezione\nslug: b\ntitolo: B\n===\ntesto B');
    assert.equal(a.meta.capitolo, '3'); assert.equal(a.blocchi.length, 2); assert.equal(a.blocchi[1].corpo, 'testo B');
    assert.throws(() => SEME.analizzaFile('=== sezione\nslug: x\n'), /non chiusa/);
  });
});

describe('Guida GIPO: funzioni pure', () => {
  test('sinonimi minimi del brief', () => {
    const g = (t) => RIC.gruppiRicerca(t).flatMap((x) => x.alternative);
    assert.ok(g('prenotare').includes('appuntamento'));
    assert.ok(g('incasso').includes('cassa'));
    assert.ok(g('storno').includes('nota di credito'));
    assert.ok(g('ricetta').includes('impegnativa'));
  });
  test('"Apri in GIPO" solo per i percorsi di consultazione', () => {
    assert.equal(CORE.linkGipo('/Fatture/Index'), 'https://www.giponext.it/Fatture/Index');
    for (const p of ['/Fatture/Create', '/NotaCredito/Create', '/medicina-dello-sport/nuova-visita', '/DDT/Create', 'javascript:x', '//altro.it', null]) assert.equal(CORE.linkGipo(p), null, String(p));
  });
  test('markdown del PDF e collegamenti alle sezioni', () => {
    const b = PDF.blocchiMarkdown('### Come si fa\n1. Apri **Fatturazione > Gestione cassa**.\n2. Premi [Elabora](sezione:gestione-cassa).\n\n> Attenzione: numero provvisorio');
    assert.deepEqual(b.map((x) => x.t), ['h', 'ol', 'quote']);
    const seg = PDF.segmenti(b[1].voci[1], (slug) => (slug === 'gestione-cassa' ? '8.10' : null));
    assert.equal(seg.map((x) => x.testo).join(''), 'Premi Elabora (sez. 8.10).');
  });
  test('pulizia del testo del modello: a capo conservati, niente trattini lunghi né "approfondire"', () => {
    const t = RISP.pulisci('Ecco \u2014 i passi:\n1. Apri\n2. Premi\n\n\n\nPer approfondire chiedi');
    assert.ok(!/[\u2014]/.test(t)); assert.ok(!/approfondir/i.test(t)); assert.match(t, /\n1\. Apri\n2\. Premi/);
  });
});

describe('Guida GIPO con database', { skip: SALTA }, () => {
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  let db; const M = {}; let srv; let base; let utente;
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const tutti = async (sql, p) => (await db.query(sql, p)).rows;
  const http = async (metodo, p, body) => {
    const r = await fetch(base + p, { method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, j: await r.json().catch(() => null) };
  };

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    await tr.startFresh('gipoguida', null);
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    M.owner = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('titolare.gg@prova.invalid', 'Titolare Prova', 'OWNER', 'ACTIVE') RETURNING id`)).id;
    M.lettore = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('lettore.gg@toscanadiagnostica.it', 'Lettore Prova', 'USER', 'ACTIVE') RETURNING id`)).id;
    // app Express minima con le route del modulo (utente del modulo simulato, come requireModuleReady)
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

  test('seme: primo caricamento, idempotente, non sovrascrive le sezioni toccate a mano, aggiorna le altre', async () => {
    const s = SEME.seme();
    const r1 = await SEME.caricaSeme();
    assert.equal(r1.sezioni.nuove, s.sezioni.length); assert.equal(r1.faq.nuove, s.faq.length);
    assert.equal((await uno(`SELECT count(*)::int AS n FROM gipoguida.sezioni WHERE stato = 'DA_VALIDARE'`)).n, s.sezioni.filter((x) => x.stato !== 'VALIDATA').length, 'da validare tutte tranne quelle del manuale TD');
    assert.equal((await uno(`SELECT count(*)::int AS n FROM gipoguida.sezioni WHERE stato = 'VALIDATA' AND fonte_validazione = 'Manuale operativo TD-SGI-MAN007' AND validata_da IS NULL`)).n,
      s.sezioni.filter((x) => x.stato === 'VALIDATA').length, 'VALIDATA dal seme con la fonte del manuale');
    assert.equal((await SEME.caricaSeme()).saltato, true, 'seconda volta: niente da fare');
    const r2 = await SEME.caricaSeme({ forza: true });
    assert.equal(r2.sezioni.invariate, s.sezioni.length); assert.equal(r2.sezioni.nuove, 0);
    // una sezione modificata a mano, una validata, una intatta; poi un "rilascio" con il testo cambiato per tutte e tre
    await db.query(`UPDATE gipoguida.sezioni SET corpo = corpo || E'\\n\\nNota della redazione.' WHERE slug = 'gestione-cassa'`);
    await db.query(`UPDATE gipoguida.sezioni SET stato = 'VALIDATA' WHERE slug = 'scadenzario'`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-seme-'));
    try {
      for (const f of fs.readdirSync(SEME.CONTENT_DIR)) {
        let t = fs.readFileSync(path.join(SEME.CONTENT_DIR, f), 'utf8');
        if (f.startsWith('08-')) t = t.replaceAll('Vedere gli incassi di un periodo', 'Vedere gli incassi del periodo').replaceAll('Seguire le rate dei documenti', 'Seguire le rate').replaceAll('Stampare il registro IVA delle vendite', 'Stampare il registro IVA');
        fs.writeFileSync(path.join(dir, f), t);
      }
      const r3 = await SEME.caricaSeme({ dir });
      assert.deepEqual(r3.sezioni.protette.sort(), ['gestione-cassa', 'scadenzario']);
      assert.equal(r3.sezioni.aggiornate, 1, 'registro-iva aggiornata');
      assert.match((await uno(`SELECT corpo FROM gipoguida.sezioni WHERE slug = 'gestione-cassa'`)).corpo, /Nota della redazione/);
      assert.match((await uno(`SELECT corpo FROM gipoguida.sezioni WHERE slug = 'registro-iva'`)).corpo, /^### A cosa serve\nStampare il registro IVA ed esportare/);
      assert.equal((await uno(`SELECT count(*)::int AS n FROM gipoguida.revisioni r JOIN gipoguida.sezioni s ON s.id = r.sezione_id WHERE s.slug = 'registro-iva' AND r.fonte = 'SEME'`)).n, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // ritorno al seme del rilascio e allo stato iniziale per i test successivi
    await db.query(`UPDATE gipoguida.sezioni SET stato = 'DA_VALIDARE' WHERE slug = 'scadenzario'`);
    await SEME.caricaSeme({ forza: true });
  });

  test('ricerca full text: sinonimi, prefisso mentre si scrive, evidenziazione, FAQ', async () => {
    const slugs = async (q) => (await RIC.cercaGuida(q)).filter((x) => x.tipo === 'sezione').map((x) => x.slug);
    assert.ok((await slugs('storno')).includes('nota-di-credito'), 'storno → nota di credito');
    assert.ok((await slugs('incasso')).includes('gestione-cassa'), 'incasso → cassa');
    assert.ok((await slugs('ricetta')).includes('assegnazione-ssn'), 'ricetta → impegnativa');
    assert.ok((await slugs('prenotare')).includes('agenda-prenotare'), 'prenotare → appuntamento');
    assert.ok((await slugs('prenotaz')).length > 0, 'prefisso');
    const r = await RIC.cercaGuida('nota di credito');
    assert.equal(r[0].slug, 'nota-di-credito');
    assert.match(r[0].snippet, /<b>/);
    assert.ok(r.some((x) => x.tipo === 'faq' && x.titolo === 'Come faccio una nota di credito?'));
    assert.deepEqual(await RIC.cercaGuida('xyzzyplugh'), []);
    utente = LETTORE();
    const h = await http('GET', `/cerca?q=${encodeURIComponent(`chiusura cassa ${CF_FINTO}`)}`);
    assert.equal(h.s, 200); assert.ok(h.j.risultati.length > 0); assert.deepEqual(h.j.mascherati, ['codice fiscale']);
    const reg = await tutti(`SELECT testo FROM gipoguida.ricerche`);
    assert.ok(reg.length >= 1 && reg.every((x) => !x.testo.includes(CF_FINTO)), 'ricerca registrata senza codice fiscale');
  });

  test('/chiedi con il modello finto: risposta in passi con le fonti; il modello non riceve mai i dati mascherati', async () => {
    const ricevuti = []; const piani = [];
    RISP._impostaModello(async ({ system, user, fase }) => {
      if (fase === 'pianifica') { piani.push({ system, user }); return { sezioni: [] }; }
      ricevuti.push({ system, user }); return { testo: 'Secondo la guida [1]:\n1. Apri **Gestione Fatture/NC**.\n2. Usa **Crea nota di credito** [1].', fonti: [1], copre: true };
    });
    utente = LETTORE();
    const r = await http('POST', '/chiedi', { domanda: `Come faccio una nota di credito per ${CF_FINTO}, tel 3331234567, mail a.b@esempio.it?` });
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.esito, 'RISPOSTA');
    assert.match(r.j.risposta, /\n1\. Apri/);
    assert.equal(r.j.fonti.filter((f) => f.citata).length, 1);
    assert.equal(r.j.fonti[0].slug, 'nota-di-credito');
    assert.equal(r.j.mascherati.length, 3);
    for (const x of [...ricevuti, ...piani]) assert.ok(!x.user.includes(CF_FINTO) && !x.user.includes('3331234567') && !x.user.includes('esempio.it'));
    assert.equal(piani.length, 1, 'un passaggio di pianificazione sull\'indice');
    assert.match(piani[0].user, /agenda-sottoconfigurazioni|Sottoconfigurazioni: periodi di validità/);
    assert.match(ricevuti[0].system, /SOLO le informazioni dei brani/);
    assert.match(ricevuti[0].user, /\[\d+\] Sezione "Nota di credito" \(nota-di-credito; capitolo 8 Fatturazione e cassa; da validare; fonte interfaccia; percorso in GIPO \/NotaCredito\/Create\)/);
    assert.ok((ricevuti[0].user.match(/^\[\d+\] /gm) || []).length <= 20, 'al più 12 sezioni e 8 FAQ');
    const d = await uno('SELECT testo, esito, modello, mascherati FROM gipoguida.domande WHERE id = $1', [r.j.id]);
    assert.ok(!d.testo.includes(CF_FINTO)); assert.equal(d.esito, 'RISPOSTA'); assert.equal(d.modello, 'modello di prova');
    // il modello dichiara che la guida non copre la domanda → SENZA_RISPOSTA (in coda)
    RISP._impostaModello(async ({ fase }) => (fase === 'pianifica' ? { sezioni: [] } : { testo: 'La guida non copre questa domanda.', fonti: [], copre: false }));
    const r2 = await http('POST', '/chiedi', { domanda: 'Come imposto la stampa della fattura in inglese?' });
    assert.equal(r2.j.esito, 'SENZA_RISPOSTA');
    // il modello non risponde → risultati della ricerca
    RISP._impostaModello(async () => { throw new Error('servizio non disponibile'); });
    const r3 = await http('POST', '/chiedi', { domanda: 'Come stampo la chiusura di cassa?' });
    assert.equal(r3.j.esito, 'SOLO_RICERCA'); assert.ok(r3.j.risultati.length > 0); assert.ok(r3.j.ai.errore);
  });

  test('/chiedi senza AI: SOLO_RICERCA con i risultati, SENZA_RISPOSTA senza brani pertinenti', async () => {
    RISP._impostaModello(false);
    utente = LETTORE();
    const r = await http('POST', '/chiedi', { domanda: 'Come stampo la chiusura di cassa?' });
    assert.equal(r.j.esito, 'SOLO_RICERCA'); assert.equal(r.j.risposta, null); assert.ok(r.j.risultati.some((x) => x.slug === 'gestione-cassa'));
    const v = await http('POST', '/chiedi', { domanda: 'zxqw ytrewq mnbvc' });
    assert.equal(v.j.esito, 'SENZA_RISPOSTA'); assert.deepEqual(v.j.fonti, []);
    assert.equal((await http('POST', '/chiedi', { domanda: CF_FINTO })).s, 400, 'domanda fatta solo di dati personali');
  });

  test('limite di 20 domande all\'ora per utente', async () => {
    RISP._impostaModello(false);
    const altro = (await uno(`INSERT INTO public.users (email, full_name, level, status) VALUES ('limite.gg@toscanadiagnostica.it', 'Limite Prova', 'USER', 'ACTIVE') RETURNING id`)).id;
    await db.query(`INSERT INTO gipoguida.domande (utente, testo, esito, creata_il) SELECT $1, 'domanda di prova ' || g, 'SOLO_RICERCA', now() - interval '10 minutes' FROM generate_series(1, 20) g`, [altro]);
    utente = { id: altro, role: 'LETTORE' };
    const r = await http('POST', '/chiedi', { domanda: 'Come accetto un paziente arrivato?' });
    assert.equal(r.s, 429); assert.match(r.j.error, /20 domande/);
    await db.query(`UPDATE gipoguida.domande SET creata_il = now() - interval '2 hours' WHERE utente = $1`, [altro]);
    assert.equal((await http('POST', '/chiedi', { domanda: 'Come accetto un paziente arrivato?' })).s, 200, 'dopo un\'ora si riparte');
  });

  test('coda: "non utile" e senza risposta in coda; risoluzione → FAQ pubblicata, domanda risolta, notifica a chi aveva chiesto', async () => {
    RISP._impostaModello(false);
    utente = LETTORE();
    const q1 = await http('POST', '/chiedi', { domanda: 'Come stampo la chiusura di cassa?' });
    assert.equal((await http('POST', `/domande/${q1.j.id}/valuta`, { utile: false, nota: 'Non dice quale stampa consegnare' })).j.in_coda, true);
    utente = ADMIN();
    assert.equal((await http('POST', `/domande/${q1.j.id}/valuta`, { utile: true })).s, 400, 'solo chi ha chiesto valuta');
    const coda = await http('GET', '/redazione/coda');
    assert.equal(coda.s, 200);
    const ids = coda.j.righe.map((x) => x.id);
    assert.ok(ids.includes(q1.j.id));
    assert.ok(coda.j.righe.every((x) => x.esito === 'SENZA_RISPOSTA' || x.utile === false));
    utente = LETTORE();
    assert.equal((await http('GET', '/redazione/coda')).s, 403, 'redazione solo ADMIN');
    utente = ADMIN();
    const sez = await uno(`SELECT id FROM gipoguida.sezioni WHERE slug = 'gestione-cassa'`);
    const ris = await http('POST', `/redazione/domande/${q1.j.id}/risolvi`, { domanda: 'Quale stampa della chiusura di cassa consegno?', risposta: 'La stampa **Per operatore** di Gestione cassa, salvo diversa indicazione della sede.', sezione_id: sez.id, ruolo: 'accettazione' });
    assert.equal(ris.s, 200, JSON.stringify(ris.j)); assert.equal(ris.j.notificato, true);
    const f = await uno('SELECT * FROM gipoguida.faq WHERE id = $1', [ris.j.faq_id]);
    assert.equal(f.origine, 'DOMANDA_UTENTE'); assert.equal(f.pubblicata, true); assert.equal(f.sezione_id, sez.id);
    const d = await uno('SELECT risolta_il, risolta_con_faq_id FROM gipoguida.domande WHERE id = $1', [q1.j.id]);
    assert.ok(d.risolta_il); assert.equal(d.risolta_con_faq_id, ris.j.faq_id);
    const n = await uno(`SELECT title, link FROM public.notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [M.lettore]);
    assert.match(n.title, /risposta alla tua domanda/); assert.equal(n.link, `/gipoguida/faq?voce=${ris.j.faq_id}`);
    assert.ok(!(await http('GET', '/redazione/coda')).j.righe.some((x) => x.id === q1.j.id), 'fuori dalla coda');
    // la nuova FAQ arricchisce la guida: nella sezione, nella ricerca
    utente = LETTORE();
    assert.ok((await http('GET', '/sezioni/gestione-cassa')).j.faq.some((x) => x.id === ris.j.faq_id));
    assert.ok((await RIC.cercaGuida('quale stampa consegno')).some((x) => x.tipo === 'faq' && x.id === ris.j.faq_id));
    // statistiche
    utente = ADMIN();
    const st = await http('GET', '/redazione/statistiche');
    assert.equal(st.s, 200); assert.ok(st.j.totali.domande >= 5); assert.ok(st.j.settimane.length >= 1); assert.equal(st.j.faq.da_domande, 1);
  });

  test('redazione: modifica con storico, validazione con nota, ripristino dal seme', async () => {
    utente = ADMIN();
    const s = await uno(`SELECT id FROM gipoguida.sezioni WHERE slug = 'nuovo-ddt'`);
    const det = (await http('GET', `/redazione/sezioni/${s.id}`)).j;
    assert.equal(det.modificata_a_mano, false); assert.equal(det.seme_diverso, false); assert.equal(det.numero, '9.3');
    const put = await http('PUT', `/redazione/sezioni/${s.id}`, { titolo: det.titolo, corpo: `${det.corpo}\n\nAggiunta della redazione.`, percorso_gipo: det.percorso_gipo, parole_chiave: det.parole_chiave, nota: 'prova' });
    assert.equal(put.s, 200); assert.equal(put.j.modificata_a_mano, true); assert.equal(put.j.revisioni.length, 1);
    assert.equal((await http('POST', `/redazione/sezioni/${s.id}/stato`, { stato: 'VALIDATA' })).s, 400, 'serve la nota');
    const v = await http('POST', `/redazione/sezioni/${s.id}/stato`, { stato: 'VALIDATA', nota: 'verificata in GIPO con un referente' });
    assert.equal(v.j.stato, 'VALIDATA'); assert.ok(v.j.validata_il);
    const rp = await http('POST', `/redazione/sezioni/${s.id}/ripristina-seme`);
    assert.equal(rp.j.stato, 'DA_VALIDARE'); assert.equal(rp.j.modificata_a_mano, false); assert.equal(rp.j.revisioni.length, 3);
    assert.equal((await http('PUT', `/redazione/sezioni/${s.id}`, { ...det, percorso_gipo: 'javascript:alert(1)' })).s, 400);
  });

  test('PDF: più di 20 pagine, titoli dei capitoli, bollino, FAQ in appendice; cache invalidata dalle modifiche', async () => {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    PDF.invalidaPdf();
    const p = await PDF.pdfGuida();
    assert.ok(p.pagine > 20, `pagine ${p.pagine}`);
    const t = (await pdfParse(p.buffer)).text.replace(/\s+/g, ' ');
    for (const k of await tutti('SELECT titolo FROM gipoguida.capitoli')) assert.ok(t.includes(k.titolo), k.titolo);
    assert.ok(t.includes('Indice')); assert.ok(t.includes('DA VALIDARE con un referente GIPO')); assert.ok(t.includes('Domande frequenti'));
    assert.ok(t.includes('Quale stampa della chiusura di cassa consegno?'), 'FAQ nata da una domanda');
    assert.match(t, /pagina \d+ di \d+/);
    assert.equal((await PDF.pdfGuida()).buffer, p.buffer, 'dalla cache');
    await db.query(`UPDATE gipoguida.sezioni SET aggiornata_il = now() WHERE slug = 'stato-magazzino'`);
    assert.notEqual((await PDF.pdfGuida()).buffer, p.buffer, 'rigenerato dopo una modifica');
  });

  test('ricerca globale della Suite: le sezioni della guida agli interni, non agli esterni', async () => {
    const { search } = await import('../src/lib/search.js');
    const interno = { id: M.lettore, level: 'USER', email: 'lettore.gg@toscanadiagnostica.it', organization_kind: 'SOCIETA', grants: {}, site_ids: [], org_ids: [] };
    const esterno = { id: 999, level: 'USER', email: 'esterno@cliente.invalid', is_external: true, grants: {}, site_ids: [], org_ids: [] };
    const ri = await search(interno, 'nota di credito');
    assert.ok(ri.some((x) => x.kind === 'guida_gipo' && x.link === '/gipoguida/guida/nota-di-credito'));
    assert.ok(!(await search(esterno, 'nota di credito')).some((x) => x.kind === 'guida_gipo'));
  });

  test('accesso: esterni esclusi (middleware e contatore), contatore della coda agli ADMIN, D56, riepilogo settimanale', async () => {
    const esterno = { id: 999, level: 'USER', email: 'esterno@cliente.invalid', is_external: true, grants: {} };
    let errore = null; CORE.soloInterni({ user: esterno }, null, (e) => { errore = e; });
    assert.equal(errore?.status, 403);
    errore = 'nessuno'; CORE.soloInterni({ user: { ...esterno, grants: { gipoguida: { profile: 'LETTORE' } } } }, null, (e) => { errore = e; });
    assert.equal(errore, undefined, 'con un grant esplicito sì');
    const { SOLO_INTERNI } = await import('../src/routes/core.js');
    assert.ok(SOLO_INTERNI.includes('gipoguida'));
    assert.equal(await CORE.contatoreHome(esterno), null);
    assert.equal(await CORE.contatoreHome({ id: M.lettore, level: 'USER', email: 'lettore.gg@toscanadiagnostica.it', organization_kind: 'SOCIETA', grants: {} }), null, 'il lettore non ha il contatore');
    const c = await CORE.contatoreHome({ id: M.owner, level: 'OWNER', email: 'titolare.gg@prova.invalid', grants: {} });
    assert.equal(c.value, await CORE.contaCoda()); assert.ok(c.value >= 1);
    // D56: una domanda in coda da 8 giorni
    await db.query(`INSERT INTO gipoguida.domande (utente, testo, esito, creata_il) VALUES ($1, 'Domanda vecchia di prova', 'SENZA_RISPOSTA', now() - interval '8 days')`, [M.lettore]);
    const diag = await import('../src/lib/diagnostica.js');
    const [d56] = await diag.esegui({ ids: ['D56'] });
    assert.equal(d56.n, 1); assert.equal(d56.stato, 'INFO');
    // riepilogo: fuori dal lunedì mattina non parte; forzato notifica gli amministratori della guida
    const domenica = new Date('2026-11-15T10:00:00Z');
    assert.equal((await CORE.riepilogoSettimanale({ now: domenica })).saltato, 'non è il momento');
    const lunedi = new Date('2026-11-16T09:00:00Z');   // 10:00 a Roma
    const r = await CORE.riepilogoSettimanale({ now: lunedi });
    assert.ok(r.coda >= 2); assert.ok(r.destinatari >= 1);
    assert.equal((await CORE.riepilogoSettimanale({ now: lunedi })).saltato, 'già inviato questa settimana');
    const n = await uno(`SELECT title FROM public.notifications WHERE user_id = $1 AND module_key = 'gipoguida' ORDER BY id DESC LIMIT 1`, [M.owner]);
    assert.match(n.title, /Guida GIPO: \d+ domande da risolvere/);
  });
});

// Integrazione con la Suite vera: il modulo si attiva da solo con il seme; l'accesso esterno non lo vede né in Home né via API
describe('Guida GIPO nella Suite (integrazione)', { skip: SALTA }, () => {
  let S, D, H;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    S = await H.avviaSuite(); D = await H.datiProva(S.base);
  }, { timeout: 180000 });
  after(async () => { await S?.stop(); });
  test('titolare: modulo LIVE con il seme; esterno: 403 e nessun widget', async () => {
    const st = await D.o.get('/api/gipoguida/state');
    assert.equal(st.s, 200); assert.equal(st.j.mode, 'LIVE'); assert.equal(st.j.user.role, 'ADMIN');
    const ind = await D.o.get('/api/gipoguida/indice');
    assert.ok(ind.j.totali.sezioni >= 60 && ind.j.totali.faq >= 60);
    assert.ok((await D.o.get('/api/home/modules')).j.areas.some((a) => a.modules.some((m) => m.key === 'gipoguida')));
    for (const est of [D.partner, D.cliente]) {
      assert.equal((await est.get('/api/gipoguida/state')).s, 403);
      assert.equal((await est.post('/api/gipoguida/chiedi', { domanda: 'Come faccio una nota di credito?' })).s, 403);
      const home = await est.get('/api/home/modules');
      assert.ok(!(home.j.areas || []).some((a) => a.modules.some((m) => m.key === 'gipoguida')), 'nessun widget per l\'esterno');
      assert.ok(!((await est.get('/api/modules')).j || []).some((m) => m.key === 'gipoguida'));
    }
    const pdf = await fetch(`${S.base}/api/gipoguida/guida.pdf`, { headers: { cookie: D.o.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  });
});
