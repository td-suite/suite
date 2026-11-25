// v0.95.0 · Recupero Crediti: il flusso intero su una Suite vera con una banca finta (server che parla come Enable Banking).
// Verifica le regole delicate: modalità Prova non spedisce nulla; in Attiva partono da soli solo avviso e 1° sollecito e solo con gli
// incassi verificati; l'esclusione di un cliente, la modalità e la firma del 2° sollecito sono solo di CEO e CFO; il bonifico certo si
// riconcilia da solo, quello incerto ferma il sollecito; risposte dei clienti, chiamata, area legale. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SALTA = !process.env.DATABASE_URL_TEST;
const g = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

describe('Recupero Crediti: flusso con banca finta', { skip: SALTA }, () => {
  let H, S, db, O, D, banca, ATT, CFO, COM, VIS, ADM, comUid, movimenti = [], casella, motore;
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const sql = async (t, p) => (await db.query(t, p)).rows;
  const posta = async () => (await sql(`SELECT to_addr, subject, from_addr, ref FROM email_log WHERE ref LIKE 'crediti:%' ORDER BY id`));
  const utente = async (last, first, profilo, pw, admin = false) => {
    const email = `${first}.${last}`.toLowerCase() + '@toscanadiagnostica.it';
    const pe = must(await O.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: last, first_name: first, email }), 'persona');
    await new Promise((r) => setTimeout(r, 1200));
    const uid = (await O.get(`/api/people/${pe.id}`)).j.user_id;
    must(await O.put(`/api/users/${uid}`, { auth_provider: 'BOTH', ...(admin ? { level: 'ADMIN' } : {}) }), 'utente');
    if (profilo) must(await O.put(`/api/users/${uid}/grants/crediti`, { profile: profilo }), `grant ${profilo}`);
    const rp = must(await O.post(`/api/users/${uid}/reset-password`, {}), 'password');
    return { uid, c: await H.entra(H.client(S.base), email, rp.temporaryPassword, pw) };
  };
  const fattura = async (org, numero, scadenza, importo, data = g(-60)) => must(await O.post('/api/crediti/fatture', { organization_id: org, numero, data, scadenza, importo }), `fattura ${numero}`).id;
  const giro = async (c = O) => must(await c.post('/api/crediti/giro', {}), 'giro');

  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    // banca finta: stesse rotte e stesse forme di Enable Banking; verifica che la Suite si presenti con un JWT RS256 firmato
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let corpo = '';
      req.on('data', (d) => { corpo += d; });
      req.on('end', () => {
        const out = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
        const [h, b, f] = String(req.headers.authorization || '').replace('Bearer ', '').split('.');
        const okFirma = h && crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(f || '', 'base64url'));
        const testa = okFirma ? JSON.parse(Buffer.from(h, 'base64url')) : {}; const claim = okFirma ? JSON.parse(Buffer.from(b, 'base64url')) : {};
        if (!okFirma || testa.kid !== 'app-di-prova' || testa.alg !== 'RS256' || claim.iss !== 'enablebanking.com' || claim.aud !== 'api.enablebanking.com' || claim.exp - claim.iat > 86400) return out(401, { message: 'jwt non valido' });
        banca.chiamate.push(`${req.method} ${u.pathname}`);
        if (u.pathname === '/aspsps') return out(200, { aspsps: [{ name: 'Banca di Prova', country: 'IT', psu_types: ['business'], maximum_consent_validity: 7776000 }] });   // nessuna intestazione dichiarata dalla banca: IP e browser partono comunque (v0.98.3)
        if (u.pathname === '/auth') { const j = JSON.parse(corpo); banca.auth = j; return out(200, { url: `https://banca.test/sca?state=${j.state}`, authorization_id: 'auth-1' }); }
        if (u.pathname === '/sessions') return out(200, { session_id: 'sess-1', accounts: [{ uid: 'conto-1', account_id: { iban: 'IT60X0542811101000000123456' }, name: 'Conto ordinario', currency: 'EUR', identification_hash: 'h1' }], access: { valid_until: new Date(Date.now() + 80 * 86400000).toISOString() } });
        if (u.pathname.startsWith('/accounts/conto-1/')) { banca.psu = req.headers['psu-ip-address'] || null; if (banca.limite) return out(429, { message: 'The access on the account has been exceeding the consented multiplicity per day.' }); }
        if (u.pathname === '/accounts/conto-1/balances') return out(200, { balances: [{ balance_type: 'CLBD', balance_amount: { amount: '15000.00', currency: 'EUR' } }] });
        // come Intesa Sanpaolo: storico oltre 90 giorni rifiutato con 422; date_from senza date_to = 400 "Error interacting with ASPSP"
        if (u.pathname === '/accounts/conto-1/transactions' && !banca.scaduta) {
          const sp = u.searchParams; banca.richieste = [...(banca.richieste || []), u.search.replace(/^\?/, '')];
          if (banca.rifiutaLongest && sp.get('strategy') === 'longest') return out(400, { code: 400, message: 'Error interacting with ASPSP', detail: 'Unknown error', error: 'ASPSP_ERROR' });
          if (sp.get('date_from') && !sp.get('date_to')) return out(400, { code: 400, message: 'Error interacting with ASPSP', detail: 'Unknown error', error: 'ASPSP_ERROR' });
          if (sp.get('date_from') && (Date.now() - new Date(sp.get('date_from')).getTime()) / 86400000 > 90.5) return out(422, { message: 'Wrong transactions period requested' });
        }
        if (u.pathname === '/accounts/conto-1/transactions') return banca.scaduta ? out(401, { error: 'EXPIRED_SESSION', message: 'session expired' }) : out(200, { transactions: movimenti });
        return out(404, { message: 'non previsto' });
      });
    });
    await new Promise((r) => srv.listen(0, r));
    banca = { srv, url: `http://localhost:${srv.address().port}`, chiamate: [], auth: null, scaduta: false };
    const env = { ENABLEBANKING_API: banca.url, ENABLEBANKING_APP_ID: 'app-di-prova', ENABLEBANKING_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'), CREDITI_POSTA_PROVA: '1', CREDITI_AI_MOCK: '' };
    S = await H.avviaSuite({ env });
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base); O = D.o;
    ATT = await utente('Ammintest', 'Anna', 'ATT', 'Att-Crediti-2026x'); CFO = await utente('Cfotest', 'Carlo', 'CFO', 'Cfo-Crediti-2026x');
    COM = await utente('Commtest', 'Bruno', 'COMMERCIALE', 'Com-Crediti-2026x'); VIS = await utente('Vistatest', 'Vera', 'VIEWER', 'Vis-Crediti-2026x');
    ADM = await utente('Admintest', 'Ada', null, 'Adm-Crediti-2026x', true); comUid = COM.uid;
    await sql(`UPDATE organizations SET email = 'amministrazione@cliente-uno.test', pec = 'clienteuno@pec.test' WHERE id = $1`, [D.org.c1]);
    await sql(`UPDATE organizations SET email = 'contabilita@cliente-due.test' WHERE id = $1`, [D.org.c2]);
    // le librerie del modulo, usate direttamente per la casella (messaggi iniettati) e per la data del giro
    Object.assign(process.env, { DATABASE_URL: S.url, MAIL_PROVIDER: 'log', NODE_ENV: 'test', ...env });
    casella = await import('../src/modules/crediti/lib/casella.js'); motore = await import('../src/modules/crediti/lib/motore.js');
  }, { timeout: 300000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); banca?.srv.close(); for (const k of ['casella', 'motore']) void k; const { pool } = await import('../src/modules/crediti/db.js'); await pool.end().catch(() => {}); const core = await import('../src/db.js'); await core.pool?.end?.().catch(() => {}); });

  test('il widget nasce in Prova; profili: chi non dirige non decide', async () => {
    const st = must(await O.get('/api/crediti/state'), 'stato');
    assert.equal(st.modalita, 'PROVA'); assert.equal(st.user.ruolo, 'CEO', 'il titolare senza grant entra come CEO'); assert.equal(st.casella, 'amministrazione@toscanadiagnostica.it');
    assert.equal((await ADM.c.get('/api/crediti/state')).j.user.ruolo, 'VIEWER', 'un amministratore della Suite senza grant è in sola lettura');
    assert.equal((await ATT.c.get('/api/crediti/state')).j.user.ruolo, 'ATT');
    assert.equal((await D.cliente.get('/api/crediti/state')).s, 403, 'gli accessi esterni no');
    for (const c of [ATT.c, VIS.c, ADM.c, COM.c]) {
      assert.equal((await c.post('/api/crediti/modalita', { modalita: 'ATTIVA', conferma: true })).s, 403, 'modalità Attiva: solo CEO e CFO');
      assert.equal((await c.post(`/api/crediti/clienti/${D.org.c1}/esclusione`, { escluso: true, motivo: 'prova di esclusione' })).s, 403, 'esclusione: solo CEO e CFO');
      assert.equal((await c.put('/api/crediti/impostazioni', { giorni_sollecito_1: 3 })).s, 403);
    }
    assert.equal((await VIS.c.post('/api/crediti/fatture', { organization_id: D.org.c1, numero: 'X', data: g(-5), scadenza: g(5), importo: 10 })).s, 403);
    assert.equal((await COM.c.get('/api/crediti/cruscotto')).s, 403); assert.equal((await COM.c.get('/api/crediti/riconciliazione')).s, 403);
    // impostazioni: scala incoerente rifiutata; valori utili per la prova (tutti i giorni, tutte le ore)
    assert.equal((await O.put('/api/crediti/impostazioni', { giorni_sollecito_2: 5 })).s, 400);
    assert.equal((await O.put('/api/crediti/impostazioni', { iban: 'non-un-iban' })).s, 400);
    must(await CFO.c.put('/api/crediti/impostazioni', { giorni_invio: [1, 2, 3, 4, 5, 6, 7], ora_invio_da: 0, ora_invio_a: 24, fatture_dal: g(-400) }), 'impostazioni');
    assert.equal((await O.post('/api/crediti/modalita', { modalita: 'ATTIVA', conferma: true })).s, 400, 'senza IBAN e firma non si attiva');
  });

  test('Prova: tutto si prepara, nulla esce, nessuna fase avanza', async () => {
    const f1 = await fattura(D.org.c1, '101/2026', g(-12), 1220);   // scaduta da 12 giorni: 1° sollecito
    const f2 = await fattura(D.org.c2, '202/2026', g(5), 800, g(-25));   // scade fra 5 giorni: avviso
    await fattura(D.org.c2, '203/2026', g(40), 300, g(-5));         // lontana: niente
    assert.equal((await O.post('/api/crediti/fatture', { organization_id: D.org.c1, numero: '101/2026', data: g(-60), scadenza: g(-12), importo: 1 })).s, 400, 'doppione');
    const r = await giro(ATT.c);
    assert.equal(r.modalita, 'PROVA'); assert.equal(r.simulate, 2); assert.equal(r.inviate, 0);
    assert.equal((await posta()).length, 0, 'nessuna email nel registro');
    assert.deepEqual((await sql('SELECT DISTINCT fase FROM crediti.fatture')).map((x) => x.fase), [0], 'nessuna fase avanzata');
    const sim = must(await O.get('/api/crediti/comunicazioni?stato=SIMULATE'), 'simulate').righe;
    assert.deepEqual(sim.map((k) => k.fase).sort(), [1, 2]);
    const s2 = sim.find((k) => k.fase === 2);
    assert.match(s2.motivo_attesa, /incassi non verificabili: nessun conto bancario collegato/); assert.match(s2.motivo_attesa, /testo incompleto, manca: .*iban/);
    assert.equal((await giro()).simulate, 0, 'il secondo giro non duplica');
    assert.equal((await O.post(`/api/crediti/comunicazioni/${s2.id}/approva`, {})).s, 400, 'in Prova nulla si approva');
    const pos = must(await O.get('/api/crediti/posizioni'), 'posizioni').righe;
    assert.equal(pos.find((p) => p.organization_id === D.org.c1).stato, 'SCADUTO'); assert.equal(pos.find((p) => p.organization_id === D.org.c1).scaduto, 1220);
    assert.equal(pos.find((p) => p.organization_id === D.org.c2).stato, 'REGOLARE'); assert.equal(pos.find((p) => p.organization_id === D.org.c2).totale, 1100);
    assert.deepEqual((await COM.c.get('/api/crediti/posizioni')).j.righe, [], 'il referente commerciale vede solo i suoi clienti');
    assert.equal((await COM.c.get(`/api/crediti/clienti/${D.org.c1}`)).s, 403);
    void f1; void f2;
  });

  test('attivazione: anteprima, poi Attiva; senza banca i solleciti restano in attesa', async () => {
    must(await O.put('/api/crediti/impostazioni', { iban: 'IT60 X054 2811 1010 0000 0123 456', firma_raf_nome: 'Carlo Cfotest', telefono_att: '055 0000000' }), 'testi');
    // termini di pagamento non indicati: la scadenza inserita a mano è certa (origine MANUALE), quindi non è un motivo di attesa
    const ant = must(await CFO.c.post('/api/crediti/modalita', { modalita: 'ATTIVA' }), 'anteprima');
    assert.equal(ant.modalita, 'PROVA'); assert.equal(ant.anteprima.invii.length, 0); assert.equal(ant.anteprima.attese.length, 2);
    assert.ok(ant.anteprima.attese.every((a) => a.motivi.some((m) => /nessun conto bancario collegato/.test(m))));
    assert.equal(must(await CFO.c.post('/api/crediti/modalita', { modalita: 'ATTIVA', conferma: true }), 'attiva').modalita, 'ATTIVA');
    const r = await giro();
    assert.equal(r.inviate, 0); assert.equal(r.in_attesa, 2);
    assert.equal((await posta()).length, 0);
    const att = must(await ATT.c.get('/api/crediti/comunicazioni?stato=DA_APPROVARE'), 'attesa').righe;
    assert.equal(att.length, 2); assert.ok(att.every((k) => /nessun conto bancario collegato/.test(k.motivo_attesa) && !/iban/.test(k.motivo_attesa)));
    assert.equal((await giro()).in_attesa, 0, 'nessun doppione');
    assert.equal((await ATT.c.get('/api/crediti/badges')).j.da_approvare, 2);
  });

  test('banca: collegamento con Enable Banking, bonifico certo riconciliato da solo, sollecito annullato e avviso sbloccato', async () => {
    assert.equal((await ATT.c.post('/api/banca/collega', { banca: 'Banca di Prova' })).s, 403, 'collegare un conto: solo CEO e CFO');
    assert.equal(must(await CFO.c.get('/api/banca/banche'), 'banche')[0].max_giorni, 90);
    const col = must(await CFO.c.post('/api/banca/collega', { banca: 'Banca di Prova' }), 'collega');
    assert.match(col.url, /^https:\/\/banca\.test\/sca\?state=/);
    assert.equal(banca.auth.redirect_url, `${S.base}/api/banca/ritorno`); assert.equal(banca.auth.access.transactions, true); assert.equal(banca.auth.psu_type, 'business');
    movimenti = [
      { entry_reference: 'E1', booking_date: g(-1), value_date: g(-1), transaction_amount: { amount: '1220.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', debtor: { name: 'CLIENTE TEST UNO' }, debtor_account: { iban: 'IT11A0000000000000000000001' }, remittance_information: ['SALDO FATTURA 101/2026'] },
      { entry_reference: 'E2', booking_date: g(-1), transaction_amount: { amount: '430.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', creditor: { name: 'Fornitore Reagenti' }, remittance_information: ['Fattura fornitore 55'] },
      { entry_reference: 'E3', booking_date: g(-2), transaction_amount: { amount: '75.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', debtor: { name: 'Incassi POS' }, remittance_information: ['Accredito POS'] },
    ];
    const rit = await CFO.c.get(`/api/banca/ritorno?code=codice-banca&state=${banca.auth.state}`);
    assert.equal(rit.s, 302); assert.match(rit.headers.get('location'), /\/crediti\/banca\?collegamento=ok$/);
    must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza');
    const st = must(await ATT.c.get('/api/banca/stato'), 'stato banca');
    assert.ok(banca.richieste.length && banca.richieste.every((x) => x === 'strategy=longest'), `v0.98.2: prima lettura con strategy=longest, senza periodi tentati a vuoto: ${banca.richieste.join(' | ')}`);
    assert.equal(st.conti.length, 1); assert.equal(Number(st.conti[0].saldo), 15000); assert.equal(st.aggiornata.ok, true); assert.equal(st.conti[0].movimenti, 3);
    assert.equal((await VIS.c.get('/api/banca/stato')).s, 403);
    const r = await giro();
    assert.equal(r.banca.automatici, 1, 'numero di fattura in causale e importo esatto: confermato da solo');
    assert.equal(r.annullate, 1, 'il sollecito in attesa per la fattura incassata si annulla');
    assert.equal(r.sbloccate, 1, 'l\'avviso riparte da solo ora che gli incassi sono verificati');
    const f = await sql(`SELECT numero, stato, incassato::float, chiusa_origine, fase FROM crediti.fatture ORDER BY numero`);
    assert.deepEqual(f[0], { numero: '101/2026', stato: 'PAGATA', incassato: 1220, chiusa_origine: 'BANCA', fase: 0 });
    assert.equal(f[1].fase, 1, 'avviso inviato: fase 1');
    const p = await posta();
    assert.equal(p.length, 1); assert.equal(p[0].to_addr, 'contabilita@cliente-due.test'); assert.equal(p[0].from_addr, 'amministrazione@toscanadiagnostica.it');
    assert.match(p[0].subject, /^Promemoria scadenza fattura n\. 202\/2026 .* \[TD-CRED-[A-F0-9]{10}\]$/);
    assert.equal((await sql('SELECT organization_id FROM crediti.clienti_iban'))[0].organization_id, D.org.c1, 'IBAN del cliente imparato');
    const ric = must(await ATT.c.get('/api/crediti/riconciliazione?stato=DA_ABBINARE'), 'riconciliazione');
    assert.equal(ric.righe.length, 1); assert.equal(ric.righe[0].controparte, 'Incassi POS');
    assert.equal((await ATT.c.post(`/api/crediti/movimenti/${ric.righe[0].id}/ignora`, {})).s, 400, 'serve il motivo');
    must(await ATT.c.post(`/api/crediti/movimenti/${ric.righe[0].id}/ignora`, { nota: 'Accredito POS, non è una fattura cliente' }), 'ignora');
    assert.equal((await giro()).inviate, 0, 'l\'avviso non si ripete');
  });

  test('bonifico incerto: proposta da confermare, e intanto il sollecito al cliente non parte da solo', async () => {
    const f = await fattura(D.org.c1, '110/2026', g(-15), 500);
    movimenti = [...movimenti, { entry_reference: 'E4', booking_date: g(-1), transaction_amount: { amount: '500.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', debtor: { name: 'Cliente Test Uno S.r.l.' }, debtor_account: { iban: 'IT11A0000000000000000000001' }, remittance_information: ['bonifico'] }];
    must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza');
    const r = await giro();
    assert.equal(r.banca.proposti, 1); assert.equal(r.banca.automatici, 0); assert.equal(r.inviate, 0); assert.equal(r.in_attesa, 1);
    const k = must(await ATT.c.get('/api/crediti/comunicazioni?stato=DA_APPROVARE'), 'attesa').righe[0];
    assert.match(k.motivo_attesa, /un bonifico recente da abbinare potrebbe essere il pagamento \(€ 500,00/);
    const prop = must(await ATT.c.get('/api/crediti/riconciliazione?stato=PROPOSTO'), 'proposte').righe[0];
    assert.equal(prop.organization_id, D.org.c1); assert.equal(prop.riconosciuto_per, 'IBAN già usato da questo cliente'); assert.deepEqual(prop.righe.map((x) => [x.fattura_id, x.importo]), [[f, 500]]);
    assert.equal((await VIS.c.post(`/api/crediti/movimenti/${prop.id}/conferma`, {})).s, 403);
    assert.equal((await ATT.c.post(`/api/crediti/movimenti/${prop.id}/conferma`, { righe: [{ fattura_id: f, importo: 600 }] })).s, 400, 'più del bonifico');
    must(await ATT.c.post(`/api/crediti/movimenti/${prop.id}/conferma`, {}), 'conferma');
    assert.equal((await sql('SELECT stato FROM crediti.fatture WHERE id = $1', [f]))[0].stato, 'PAGATA');
    assert.equal((await giro()).annullate, 1, 'sollecito in attesa annullato: la fattura è incassata');
    assert.equal((await posta()).length, 1, 'nessun sollecito è partito per una fattura pagata');
    // errore di abbinamento: si annulla e la fattura torna aperta
    must(await ATT.c.post(`/api/crediti/movimenti/${prop.id}/annulla`, {}), 'annulla');
    assert.equal((await sql('SELECT stato, incassato::float AS i FROM crediti.fatture WHERE id = $1', [f]))[0].stato, 'APERTA');
    must(await ATT.c.post(`/api/crediti/movimenti/${prop.id}/conferma`, { righe: [{ fattura_id: f, importo: 500 }] }), 'riabbina');
  });

  test('1° sollecito automatico con incassi verificati; consenso bancario scaduto: tutto torna in attesa', async () => {
    const f = await fattura(D.org.c1, '120/2026', g(-11), 900);
    const r = await giro();
    assert.equal(r.inviate, 1);
    const p = await posta();
    assert.equal(p.length, 2); assert.equal(p[1].to_addr, 'amministrazione@cliente-uno.test'); assert.match(p[1].subject, /^Sollecito di pagamento – fattura n\. 120\/2026 scaduta il /);
    assert.equal((await sql('SELECT fase FROM crediti.fatture WHERE id = $1', [f]))[0].fase, 2);
    const scheda = must(await ATT.c.get(`/api/crediti/clienti/${D.org.c1}`), 'scheda');
    assert.ok(scheda.eventi.some((e) => /1° sollecito scritto nel registro email \(posta non attiva\) a amministrazione@cliente-uno\.test per € 900,00 in automatico/.test(e.testo)));
    assert.equal(scheda.posizione.stato, 'IN_SOLLECITO');
    // v0.98.0: limite giornaliero della banca (429). Sincronizza premuto da una persona porta i dati dell'utente presente; la lettura
    // automatica non rilegge un conto letto da meno di 6 ore; il 429 si spiega e non fa scadere il collegamento
    assert.ok(banca.psu, 'la lettura chiesta da una persona porta Psu-Ip-Address');
    assert.ok(banca.richieste.some((x) => /^date_from/.test(x)) && banca.richieste.every((x) => x === 'strategy=longest' || /^date_from=\d{4}-\d{2}-\d{2}&date_to=\d{4}-\d{2}-\d{2}$/.test(x)), `v0.98.2: dopo la prima lettura sempre date_from e date_to insieme: ${banca.richieste.join(' | ')}`);
    banca.limite = true;
    const lim = must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza con limite'); assert.equal(lim.limite, 1);
    assert.match((await sql('SELECT last_error FROM bank_accounts'))[0].last_error, /limite giornaliero anche questa lettura, chiesta da una persona \(intestazioni inviate: Psu-Ip-Address, Psu-User-Agent; richieste dalla banca: nessuna dichiarata\)/); assert.equal((await sql('SELECT status FROM bank_connections'))[0].status, 'ATTIVA');
    banca.limite = false; must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza dopo il limite');
    // la banca rifiuta la sessione (consenso scaduto): il collegamento passa a SCADUTA e i movimenti non sono più "freschi"
    banca.scaduta = true;
    must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza');
    assert.equal((await sql('SELECT status FROM bank_connections'))[0].status, 'SCADUTA');
    await fattura(D.org.c2, '204/2026', g(-10), 150, g(-45));
    const r2 = await giro();
    assert.equal(r2.inviate, 0); assert.equal(r2.in_attesa, 1);
    const k = must(await ATT.c.get('/api/crediti/comunicazioni?stato=DA_APPROVARE'), 'attesa').righe[0];
    assert.match(k.motivo_attesa, /incassi non verificabili: nessun conto bancario collegato/);
    // l'Amministrazione, verificati gli incassi a mano, approva: parte
    const ok = must(await ATT.c.post(`/api/crediti/comunicazioni/${k.id}/approva`, {}), 'approva');
    assert.equal(ok.inviata, true); assert.equal((await posta()).length, 3);
    banca.scaduta = false;
  });

  test('esclusione dai solleciti: CEO o CFO, motivo obbligatorio, registro; il cliente escluso non riceve nulla', async () => {
    assert.equal((await CFO.c.post(`/api/crediti/clienti/${D.org.c2}/esclusione`, { escluso: true, motivo: '' })).s, 400);
    assert.equal((await CFO.c.post(`/api/crediti/clienti/${D.org.c2}/esclusione`, { escluso: true, motivo: 'Accordo commerciale in corso', fino: g(-1) })).s, 400);
    await fattura(D.org.c2, '205/2026', g(-13), 640, g(-50));
    await sql(`UPDATE bank_connections SET status = 'ATTIVA'`); must(await CFO.c.post('/api/banca/sincronizza', {}), 'sincronizza');
    must(await CFO.c.post(`/api/crediti/clienti/${D.org.c2}/esclusione`, { escluso: true, motivo: 'Accordo commerciale in corso con la Direzione', fino: g(20) }), 'esclude');
    const prima = (await posta()).length;
    const r = await giro();
    assert.equal(r.inviate, 0); assert.equal(r.in_attesa, 0); assert.equal(r.fermi.ESCLUSO, 1);
    assert.equal((await posta()).length, prima);
    const es = must(await VIS.c.get('/api/crediti/esclusioni'), 'esclusioni');
    assert.equal(es.attive.length, 1); assert.equal(es.attive[0].utente, 'Cfotest Carlo'); assert.equal(es.registro[0].azione, 'ESCLUSO');
    assert.equal(must(await ATT.c.get('/api/crediti/posizioni'), 'pos').righe.find((p) => p.organization_id === D.org.c2).stato, 'ESCLUSO');
    assert.equal((await ATT.c.post(`/api/crediti/clienti/${D.org.c2}/esclusione`, { escluso: false })).s, 403, 'anche riammettere è di CEO e CFO');
    // esclusione a termine: passata la data il cliente rientra da solo, con traccia
    await sql(`UPDATE crediti.clienti SET esclusione_fino = $2 WHERE organization_id = $1`, [D.org.c2, g(-1)]);
    const r2 = await giro();
    assert.equal(r2.riammessi, 1); assert.equal(r2.inviate, 1, 'riammesso: il 1° sollecito dovuto parte');
    assert.equal(must(await O.get('/api/crediti/esclusioni'), 'esclusioni').registro[0].azione, 'RIAMMESSO');
  });

  test('risposte dalla casella: promessa sospende, contestazione toglie le fatture dalla scala, il resto non entra', async () => {
    const k = (await sql(`SELECT id, rif, organization_id FROM crediti.comunicazioni WHERE stato = 'REGISTRATA' AND organization_id = $1 AND fase = 2 ORDER BY id DESC LIMIT 1`, [D.org.c2]))[0];
    const msg = (id, da, oggetto, testo) => ({ id, receivedDateTime: new Date().toISOString(), from: { emailAddress: { address: da, name: 'Ufficio contabilità' } }, subject: oggetto, body: { content: `<p>${testo}</p><p>Il giorno 24 nov 2026 amministrazione ha scritto:</p><blockquote>Gentile Cliente...</blockquote>` } });
    const out = await casella.leggiCasella({ messaggi: [
      msg('m1', 'altra.persona@cliente-due.test', `R: Sollecito [TD-CRED-${k.rif}]`, `Buongiorno, provvederemo al pagamento entro il ${g(6).split('-').reverse().join('/')}`),
      msg('m2', 'newsletter@fornitore-qualunque.test', 'Offerta reagenti', 'Scopri le promozioni'),
      msg('m3', 'qualcuno@gmail.com', 'Informazioni', 'Vorrei prenotare un esame'),
      msg('m4', 'amministrazione@cliente-uno.test', 'Risposta automatica: Sollecito', 'Sono fuori ufficio fino a lunedì'),
    ] });
    assert.deepEqual([out.letti, out.registrati, out.ignorati], [4, 2, 2], 'solo i messaggi dei clienti del recupero crediti');
    const rr = await sql('SELECT graph_id, classe, stato, abbinata_per, organization_id, effetto, anteprima FROM crediti.risposte ORDER BY id');
    assert.equal(rr[0].classe, 'PROMESSA'); assert.equal(rr[0].abbinata_per, 'RIFERIMENTO'); assert.equal(rr[0].stato, 'GESTITA'); assert.ok(!rr[0].anteprima.includes('Gentile Cliente'), 'la parte citata non si conserva');
    assert.equal(rr[1].classe, 'FUORI_UFFICIO'); assert.equal(rr[1].abbinata_per, 'MITTENTE'); assert.equal(rr[1].stato, 'GESTITA');
    assert.equal((await sql(`SELECT stato, origine FROM crediti.promesse WHERE organization_id = $1`, [D.org.c2]))[0].stato, 'APERTA');
    assert.equal(must(await ATT.c.get('/api/crediti/posizioni'), 'pos').righe.find((p) => p.organization_id === D.org.c2).stato, 'PROMESSA');
    // con la promessa aperta la scala è ferma anche se una fase sarebbe dovuta
    await sql(`UPDATE crediti.fatture SET scadenza = $2, fase_at = now() - interval '20 days' WHERE organization_id = $1 AND fase = 2`, [D.org.c2, g(-30)]);
    assert.equal((await giro()).fermi.PROMESSA, 1);
    // promessa non rispettata (data passata più la tolleranza): la scala riprende, e il 2° sollecito aspetta la firma
    await sql(`UPDATE crediti.promesse SET data = $1`, [g(-4)]);
    const r = await giro();
    assert.equal(r.promesse_mancate, 1); assert.equal(r.in_attesa, 1); assert.equal(r.inviate, 0);
    // contestazione: le fatture della comunicazione escono dalla scala e la risposta resta da gestire
    const o2 = await casella.leggiCasella({ messaggi: [msg('m5', 'contabilita@cliente-due.test', `Re: Sollecito [TD-CRED-${k.rif}]`, 'La fattura è errata: contestiamo l\'importo, chiediamo nota di credito')] });
    assert.equal(o2.registrati, 1);
    const c = (await sql(`SELECT classe, stato FROM crediti.risposte WHERE graph_id = 'm5'`))[0];
    assert.equal(c.classe, 'CONTESTAZIONE'); assert.equal(c.stato, 'DA_GESTIRE');
    assert.ok((await sql(`SELECT count(*)::int AS n FROM crediti.fatture WHERE organization_id = $1 AND contestata`, [D.org.c2]))[0].n >= 1);
    assert.equal((await casella.leggiCasella({ messaggi: [msg('m5', 'contabilita@cliente-due.test', 'x', 'y')] })).registrati, 0, 'lo stesso messaggio non entra due volte');
  });

  test('2° sollecito: firma di CFO o CEO; poi chiamata del referente, nessun riscontro, proposta all\'area legale, autorizzazione', async () => {
    const attesa = must(await ATT.c.get('/api/crediti/comunicazioni?stato=DA_APPROVARE'), 'attesa').righe.filter((k) => k.fase === 3);
    assert.equal(attesa.length, 1); assert.match(attesa[0].motivo_attesa, /firma del Responsabile Amministrazione e Finanza/);
    assert.equal((await ATT.c.post(`/api/crediti/comunicazioni/${attesa[0].id}/approva`, {})).s, 403, 'il 2° sollecito non lo approva l\'Amministrazione');
    // il cliente ha una contestazione aperta su una fattura: quella non entra nel testo, le altre sì
    const ok = must(await CFO.c.post(`/api/crediti/comunicazioni/${attesa[0].id}/approva`, {}), 'firma');
    const det = must(await ATT.c.get(`/api/crediti/comunicazioni/${attesa[0].id}`), 'dettaglio');
    if (ok.inviata) { assert.match(det.oggetto, /^Secondo sollecito di pagamento/); assert.ok(det.corpo_testo.includes('Carlo Cfotest') && det.corpo_testo.includes('giorni di ritardo')); }
    else assert.equal(ok.annullata, true);
    // chiamata: cliente uno, fattura 120 al 2° sollecito da 12 giorni e scaduta da 40; referente commerciale scelto nella scheda
    must(await ATT.c.put(`/api/crediti/clienti/${D.org.c1}`, { referente_user_id: comUid, pec: 'clienteuno@pec.test' }), 'referente');
    await sql(`UPDATE crediti.fatture SET scadenza = $2, fase = 3, fase_at = now() - interval '12 days' WHERE organization_id = $1 AND numero = '120/2026'`, [D.org.c1, g(-40)]);
    const r = await giro();
    assert.equal(r.chiamate_aperte, 1);
    assert.deepEqual((await COM.c.get('/api/crediti/posizioni')).j.righe.map((p) => p.organization_id), [D.org.c1], 'ora il referente vede il suo cliente');
    const att = must(await COM.c.get('/api/crediti/attivita'), 'attività').righe;
    assert.equal(att.length, 1); assert.equal(att[0].cliente, 'Cliente Test Uno');
    assert.ok((await COM.c.get('/api/notifications')).text.includes('Chiamata di recupero'));
    assert.equal((await COM.c.post('/api/crediti/chiamate', { organization_id: D.org.c2, esito: 'NESSUN_RISCONTRO' })).s, 403, 'non il cliente di un altro');
    assert.equal((await COM.c.post('/api/crediti/chiamate', { organization_id: D.org.c1, esito: 'PAGAMENTO_PROMESSO' })).s, 400, 'la promessa vuole una data');
    must(await COM.c.post('/api/crediti/chiamate', { organization_id: D.org.c1, attivita_id: att[0].id, esito: 'NESSUN_RISCONTRO', interlocutore: 'Segreteria', nota: 'Nessuno disponibile' }), 'esito');
    assert.equal((await COM.c.get('/api/crediti/attivita')).j.righe.length, 0);
    assert.equal((await giro()).pratiche_proposte, 0, 'prima dei 5 giorni lavorativi nessuna proposta');
    await sql(`UPDATE crediti.chiamate SET data = $1, created_at = now() - interval '9 days'`, [g(-9)]);
    assert.equal((await giro()).pratiche_proposte, 1);
    const pr = must(await CFO.c.get('/api/crediti/legale'), 'legale').righe[0];
    assert.equal(pr.stato, 'PROPOSTA'); assert.equal(Number(pr.totale), 900); assert.equal(pr.serve_dir, false);
    assert.equal((await ATT.c.post(`/api/crediti/legale/${pr.id}/autorizza`, {})).s, 403, 'autorizza solo il RAF (CFO) o il CEO');
    must(await CFO.c.post(`/api/crediti/legale/${pr.id}/autorizza`, {}), 'autorizza');
    assert.equal((await sql(`SELECT fase FROM crediti.fatture WHERE numero = '120/2026'`))[0].fase, 5);
    assert.equal(must(await ATT.c.get('/api/crediti/posizioni'), 'pos').righe.find((p) => p.organization_id === D.org.c1).stato, 'LEGALE');
    const fasc = must(await CFO.c.get(`/api/crediti/legale/${pr.id}/fascicolo`), 'fascicolo');
    assert.ok(fasc.messa_in_mora.testo.includes('costituiamo formalmente in mora') && fasc.messa_in_mora.testo.includes('120/2026')); assert.match(fasc.messa_in_mora.avvertenza, /validato dall'area legale/);
    assert.ok(fasc.eventi.length >= 4 && fasc.chiamate.length === 1);
    const prima = (await posta()).length; await giro();
    assert.equal((await posta()).length, prima, 'con la pratica autorizzata nessun altro sollecito al cliente');
  });

  test('partitario della contabilità: anteprima, importazione, chiusura per assenza solo con "file completo"', async () => {
    const csv = ['Numero;Data;Scadenza;Importo;Residuo;Cliente;Partita IVA', `204/2026;${g(-45).split('-').reverse().join('/')};${g(-8).split('-').reverse().join('/')};150,00;150,00;Cliente Test Due;`,
      `900/2026;${g(-20).split('-').reverse().join('/')};${g(10).split('-').reverse().join('/')};1.000,00;400,00;Cliente Test Due;`, `901/2026;${g(-20).split('-').reverse().join('/')};${g(10).split('-').reverse().join('/')};250,00;250,00;Studio Sconosciuto;01234567890`].join('\n');
    const invia = async (c, extra = {}) => { const fd = new FormData(); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'partitario.csv'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); const r = await fetch(`${S.base}/api/crediti/fatture-importa`, { method: 'POST', headers: { cookie: c.cookie, 'X-Requested-With': 'td-suite' }, body: fd }); return { s: r.status, j: await r.json() }; };
    assert.equal((await invia(VIS.c)).s, 403);
    const prima = (await sql('SELECT count(*)::int AS n FROM crediti.fatture'))[0].n;
    const a = (await invia(ATT.c, { completo: 'true' })).j;
    assert.equal(a.anteprima, true); assert.equal(a.righe, 3); assert.equal(a.nuove, 2); assert.equal(a.aggiornate, 1, 'la 204 esiste già: cambia la scadenza'); assert.equal(a.non_abbinate, 1); assert.ok(a.da_chiudere.length >= 1);
    assert.equal((await sql('SELECT count(*)::int AS n FROM crediti.fatture'))[0].n, prima, 'l\'anteprima non scrive');
    const b = (await invia(ATT.c, { conferma: 'true' })).j;
    assert.equal(b.anteprima, false); assert.equal(b.chiuse, 0, 'senza "file completo" nessuna chiusura per assenza');
    const f = await sql(`SELECT numero, stato, incassato::float AS inc, organization_id, scadenza_origine FROM crediti.fatture WHERE numero IN ('900/2026','901/2026','204/2026') ORDER BY numero`);
    assert.deepEqual(f.map((x) => [x.numero, x.stato, x.inc]), [['204/2026', 'APERTA', 0], ['900/2026', 'PARZIALE', 600], ['901/2026', 'APERTA', 0]]);
    assert.equal(f[0].scadenza_origine, 'FILE'); assert.equal(f[2].organization_id, null, 'cliente del file non riconosciuto: resta da abbinare, fuori dalla scala');
    assert.equal(must(await ATT.c.get('/api/crediti/fatture?stato=SENZA_CLIENTE'), 'senza cliente').righe.length, 1);
    assert.equal(must(await O.get('/api/crediti/cruscotto'), 'cruscotto').indicatori.senza_cliente, 1);
  });

  test('scheda account del Business Hub e contatore in home', async () => {
    const p = must(await O.get(`/api/crediti/posizione-cliente/${D.org.c1}`), 'posizione');
    assert.equal(p.attivo, true); assert.equal(p.posizione.stato, 'LEGALE'); assert.equal(p.posizione.scaduto, 900);
    assert.equal((await D.cliente.get(`/api/crediti/posizione-cliente/${D.org.c1}`)).s, 403);
    const home = (await ATT.c.get('/api/home/modules')).text; assert.ok(home.includes('"key":"crediti"'));
    assert.ok(!(await D.interno?.get?.('/api/home/modules'))?.text?.includes('"key":"crediti"'));
    const reg = must(await O.get('/api/crediti/impostazioni'), 'impostazioni').registro.map((x) => x.action);
    for (const a of ['MODALITA', 'ESCLUSIONE', 'IMPOSTAZIONI', 'LEGALE_AUTORIZZATA', 'COMUNICAZIONE_APPROVATA']) assert.ok(reg.includes(a), `registro: ${a}`);
  });
});
