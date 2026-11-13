// v0.72.0 · Rimborso Spese (modulo `rimborsi`, docs/RIMBORSI.md) e benefit "vettura e fuel card" di Contratti del personale.
// Parte pura sempre: importi (km × tariffa), riepilogo e saldo con anticipi e carta, controlli dell'invio (giustificativo obbligatorio ed
// eccezioni, tariffa, date fuori mese o future), doppioni, massimali, finestra di invio, azioni per ruolo (nessuno approva la propria),
// approvatore dall'organigramma con la risalita e il vertice a P&C, maschera del numero di carta, voci dei benefit, seme delle eccezioni.
// Parte con database (DATABASE_URL_TEST): la Suite vera su un database temporaneo con persone INVENTATE (nessuna targa né numero di carta
// reali): accesso (dipendente sì; LP, medico, esterno, amministratore non dipendente no), una nota per mese, flusso completo con
// respingimento ed esclusione di riga, vertice a P&C, vettura aziendale e fuel card, doppioni, blocco dopo la liquidazione, PDF, ZIP,
// permessi sui file, modulistica cartacea, Diagnostica D58 e D59.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite (config.js legge DATABASE_URL una volta sola): mai il
// database "suite". Le parti pure non interrogano il database.
const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
process.env.DATABASE_URL = URL_TEST ? URL_TEST.replace(/(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)/, `$1suite_rs_${process.pid}_${crypto.randomBytes(3).toString('hex')}`) : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const CALC = await import('../src/modules/rimborsi/lib/calcoli.js');
const ORG = await import('../src/modules/rimborsi/lib/organigramma.js');
const BEN = await import('../src/modules/contracts/lib/benefitAuto.js');
const ECC = await import('../src/modules/rimborsi/lib/eccezioni.js');

describe('Rimborso Spese: calcoli', () => {
  test('km × tariffa con andata e ritorno, arrotondamento a 2 decimali; vettura aziendale a zero', () => {
    assert.deepEqual(CALC.importoViaggio({ km: 21.5, andata_ritorno: true, tariffa: 0.4321 }), { km_totali: 43, importo: 18.58 });
    assert.deepEqual(CALC.importoViaggio({ km: 10, andata_ritorno: false, tariffa: 0.3333 }), { km_totali: 10, importo: 3.33 });
    assert.deepEqual(CALC.importoViaggio({ km: 50, tariffa: null }), { km_totali: 50, importo: 0 });
    assert.equal(CALC.importoViaggio({ km: 50, tariffa: 0.5, rimborsabile: false }).importo, 0);
  });
  test('riepilogo come MOD025 + MOD029: spese, chilometrico, pedaggi, parcheggi, carta non rimborsabile, escluse, saldo con anticipi', () => {
    const categorie = new Map([[1, { tipo: 'SPESA' }], [2, { tipo: 'PEDAGGIO' }], [3, { tipo: 'PARCHEGGIO' }], [4, { tipo: 'CARBURANTE' }]]);
    const spese = [
      { importo: 16, categoria_id: 1, metodo: 'DIPENDENTE' }, { importo: 23.4, categoria_id: 1, metodo: 'DIPENDENTE' }, { importo: 92, categoria_id: 1, metodo: 'DIPENDENTE', esclusa: true },
      { importo: 6.3, categoria_id: 2, metodo: 'DIPENDENTE' }, { importo: 4.5, categoria_id: 3, metodo: 'DIPENDENTE' },
      { importo: 52.8, categoria_id: 4, metodo: 'FUEL_CARD' }, { importo: 30, categoria_id: 1, metodo: 'CARTA_AZIENDALE' },
    ];
    const viaggi = [{ km: 21.5, andata_ritorno: true, tariffa: 0.4321 }, { km: 78, andata_ritorno: true, veicolo_tipo: 'AZIENDALE', rimborsabile: false }];
    const r = CALC.riepilogo({ spese, viaggi, anticipi: 100, categorie });
    assert.equal(r.tot_spese, 39.4); assert.equal(r.tot_pedaggi, 6.3); assert.equal(r.tot_parcheggi, 4.5);
    assert.equal(r.tot_km, 43); assert.equal(r.tot_km_importo, 18.58); assert.equal(r.km_registro, 156);
    assert.equal(r.tot_carta, 82.8); assert.equal(r.tot_escluso, 92);
    assert.equal(r.tot_rimborsabile, 68.78);
    assert.equal(r.saldo, -31.22); assert.equal(r.saldo_a_favore, 'AZIENDA');
    assert.match(CALC.testoSaldo(r.saldo), /a favore dell'azienda/);
    assert.equal(CALC.riepilogo({ spese: [{ importo: 10, categoria_id: 1, metodo: 'DIPENDENTE' }], categorie }).saldo_a_favore, 'DIPENDENTE');
  });
  test('date: fuori mese e future bloccate; finestra di invio con il giorno limite', () => {
    assert.equal(CALC.controllaData('2026-10-31', { anno: 2026, mese: 10, oggi: '2026-11-13' }), null);
    assert.match(CALC.controllaData('2026-11-02', { anno: 2026, mese: 10, oggi: '2026-11-13' }), /fuori dal mese/);
    assert.match(CALC.controllaData('2026-11-20', { anno: 2026, mese: 11, oggi: '2026-11-13' }), /futura/);
    assert.deepEqual(CALC.finestraInvio({ anno: 2026, mese: 10, oggi: '2026-11-10', giornoLimite: 10 }), { scadenza: '2026-11-10', in_ritardo: false, mese_in_corso: false });
    assert.equal(CALC.finestraInvio({ anno: 2026, mese: 10, oggi: '2026-11-11' }).in_ritardo, true);
    assert.equal(CALC.finestraInvio({ anno: 2026, mese: 12, oggi: '2026-12-20' }).scadenza, '2027-01-10');
  });
  test('doppioni nello stesso mese e tra mesi diversi; le righe escluse non contano', () => {
    const d = CALC.doppioni([{ id: 1, nota_id: 1, data: '2026-10-09', importo: 28.5, categoria_id: 1 }, { id: 2, nota_id: 1, data: '2026-10-09', importo: '28.50', categoria_id: 1 },
      { id: 3, nota_id: 2, data: '2026-10-09', importo: 28.5, categoria_id: 1 }, { id: 4, nota_id: 1, data: '2026-10-09', importo: 28.5, categoria_id: 2 }, { id: 5, nota_id: 1, data: '2026-10-09', importo: 28.5, categoria_id: 1, esclusa: true }]);
    assert.deepEqual(d.get(1).map((x) => x.id).sort(), [2, 3]);
    assert.ok(!d.has(4) && !d.has(5));
  });
  test('massimali solo se configurati (vuoti di default): per spesa e per giorno', () => {
    const cat = new Map([[1, { nome: 'Vitto', massimale_spesa: null, massimale_giorno: null }]]);
    assert.equal(CALC.controllaMassimali([{ id: 1, categoria_id: 1, importo: 999, data: '2026-10-01' }], cat).size, 0);
    const cat2 = new Map([[1, { nome: 'Vitto', massimale_spesa: 20, massimale_giorno: 30 }]]);
    const m = CALC.controllaMassimali([{ id: 1, categoria_id: 1, importo: 25, data: '2026-10-01' }, { id: 2, categoria_id: 1, importo: 10, data: '2026-10-01' }], cat2);
    assert.equal(m.get(1).length, 2); assert.equal(m.get(2).length, 1);
  });
  test('controlli dell\'invio: giustificativo obbligatorio salvo eccezione, tariffa, motivazione, nota vuota', () => {
    const categorie = new Map([[1, { nome: 'Vitto', giustificativo_obbligatorio: true }], [2, { nome: 'Altro', giustificativo_obbligatorio: false }]]);
    const nota = { anno: 2026, mese: 10, motivazione: '' };
    const spese = [{ id: 1, data: '2026-10-05', categoria_id: 1, importo: 10, motivazione: 'visita' }, { id: 2, data: '2026-10-06', categoria_id: 2, importo: 5, motivazione: 'x' }];
    const viaggi = [{ id: 9, data: '2026-10-07', km: 10, tariffa: null, motivazione: 'visita' }];
    let c = CALC.controlliInvio({ nota, spese, viaggi, categorie, oggi: '2026-11-05' });
    assert.ok(c.bloccanti.some((b) => /giustificativo/.test(b)));
    assert.ok(c.bloccanti.some((b) => /tariffa/.test(b)));
    assert.deepEqual(c.righe.get('S:1'), ['giustificativo mancante']);
    assert.ok(!c.righe.has('S:2'), 'categoria senza obbligo');
    c = CALC.controlliInvio({ nota, spese, viaggi: [{ ...viaggi[0], tariffa: 0.4 }], categorie, oggi: '2026-11-05', eccezione: true });
    assert.deepEqual(c.bloccanti, [], 'eccezione: giustificativo facoltativo');
    c = CALC.controlliInvio({ nota, spese, viaggi: [], categorie, allegati: [{ riga_tipo: 'SPESA', riga_id: 1 }], oggi: '2026-11-05' });
    assert.deepEqual(c.bloccanti, []);
    assert.ok(CALC.controlliInvio({ nota, spese: [{ ...spese[1], motivazione: '' }], categorie, oggi: '2026-11-05' }).bloccanti.some((b) => /motivazione/.test(b)));
    assert.ok(CALC.controlliInvio({ nota: { ...nota, motivazione: 'trasferta' }, spese: [{ ...spese[1], motivazione: '' }], categorie, oggi: '2026-11-05' }).bloccanti.length === 0, 'vale la motivazione generale');
    assert.ok(CALC.controlliInvio({ nota, categorie, oggi: '2026-11-05' }).bloccanti.some((b) => /vuota/.test(b)));
    assert.ok(CALC.controlliInvio({ nota, spese: [spese[1]], categorie, oggi: '2026-11-15' }).avvisi.some((a) => /ritardo/.test(a)));
  });
  test('azioni: nessuno approva né liquida la propria nota; il vertice va a P&C', () => {
    const n = { stato: 'INVIATA', al_pc: false };
    assert.equal(CALC.azioni(n, { proprietario: true, responsabile: true, pc: true }).approva, false);
    assert.equal(CALC.azioni(n, { responsabile: true }).approva, true);
    assert.equal(CALC.azioni(n, { pc: true }).approva, false, 'P&C non approva le note con un responsabile');
    assert.equal(CALC.azioni({ stato: 'INVIATA', al_pc: true }, { pc: true }).approva, true);
    assert.equal(CALC.azioni({ stato: 'APPROVATA' }, { pc: true, proprietario: true }).liquida, false);
    assert.equal(CALC.azioni({ stato: 'APPROVATA' }, { pc: true }).liquida, true);
    assert.equal(CALC.azioni({ stato: 'LIQUIDATA' }, { pc: true }).archivia, true);
    assert.equal(CALC.azioni({ stato: 'INVIATA' }, { proprietario: true }).modifica, false, 'nessuna modifica dopo l\'invio');
  });
});

describe('Rimborso Spese: organigramma', () => {
  const nodi = (righe) => new Map(righe.map((r) => [r.id, { attivo: true, dipendente: true, user_id: r.id * 10, in_ferie: false, ...r }]));
  test('superiore diretto; risalita se cessato, senza accesso, non dipendente o in ferie; vertice a P&C', () => {
    const N = nodi([{ id: 1, nome: 'Vertice' }, { id: 2, nome: 'Resp', manager_id: 1 }, { id: 3, nome: 'Dip', manager_id: 2 }]);
    assert.equal(ORG.approvatore(3, N).approvatore_id, 2);
    assert.equal(ORG.approvatore(1, N).al_pc, true);
    for (const [k, v, motivo] of [['attivo', false, /cessato/], ['user_id', null, /accesso/], ['dipendente', false, /non è dipendente/], ['in_ferie', true, /ferie/]]) {
      const M = nodi([{ id: 1, nome: 'Vertice' }, { id: 2, nome: 'Resp', manager_id: 1, [k]: v }, { id: 3, nome: 'Dip', manager_id: 2 }]);
      const a = ORG.approvatore(3, M);
      assert.equal(a.approvatore_id, 1, k); assert.match(a.origine, motivo);
    }
    const Z = nodi([{ id: 1, nome: 'Vertice', attivo: false }, { id: 2, nome: 'Dip', manager_id: 1 }]);
    assert.equal(ORG.approvatore(2, Z).al_pc, true, 'nessuno raggiungibile: P&C');
    const C = nodi([{ id: 1, nome: 'A', manager_id: 2 }, { id: 2, nome: 'B', manager_id: 1, attivo: false }]);
    assert.equal(ORG.approvatore(1, C).approvatore_id, null, 'un ciclo non riporta mai alla persona');
    assert.deepEqual(ORG.discendenti(1, N).sort(), [2, 3]);
  });
});

describe('Contratti del personale: vettura e fuel card', () => {
  test('numero mascherato, voci dei benefit coerenti con il jsonb del contratto, assegnazione in corso', () => {
    assert.equal(BEN.mascheraNumero('0000 1111 2222 3333'), '•••• •••• •••• 3333');
    assert.equal(BEN.numeroLeggibile('0000111122223333'), '0000 1111 2222 3333');
    assert.deepEqual(BEN.vociBenefit(['PC portatile aziendale'], { vettura: true, fuel: true }), ['PC portatile aziendale', 'Vettura aziendale', 'Fuel card']);
    assert.deepEqual(BEN.vociBenefit(['Auto aziendale ad uso promiscuo'], { vettura: true, fuel: false }), ['Auto aziendale ad uso promiscuo'], 'voce equivalente scritta a mano');
    assert.deepEqual(BEN.vociBenefit(['Vettura aziendale', 'Fuel card', 'Telefono'], { vettura: false, fuel: false }), ['Telefono']);
    assert.ok(BEN.attivaIl({ dal: '2026-01-01', al: null }, '2026-10-13'));
    assert.ok(!BEN.attivaIl({ dal: '2026-01-01', al: '2026-06-30' }, '2026-10-13'));
  });
  test('seme delle eccezioni: abbinamento solo se univoco per cognome', () => {
    assert.deepEqual(ECC.SEME_COGNOMI, ['Epifani', 'Zezza', 'Malenchini', 'Corradi']);
    assert.equal(ECC.abbina('X', [{ id: 7, last_name: 'X', first_name: 'Y' }]).person_id, 7);
    assert.equal(ECC.abbina('X', []).person_id, null);
    assert.match(ECC.abbina('X', [{ id: 1 }, { id: 2 }]).nota, /non univoco/);
  });
});

// ------------------------------------------------------------------ PDF di approvazione con il mailer finto (nessun invio reale)
describe('Rimborso Spese: PDF di approvazione ai destinatari esterni (mailer finto)', { skip: SALTA }, () => {
  const pg0 = import('pg');
  let db, srv, base, utente, M = {}, I, chiamate = [], risposta = { ok: true, logId: null };
  const nomeDb = process.env.DATABASE_URL.match(/\/([^/?]+)(\?|$)/)[1];
  const adm = async (sql) => { const pg = (await pg0).default; const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const http = async (metodo, p, body) => { const r = await fetch(base + p, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
  const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const nota = async (pid, mese, stato, resp = null) => {
    const n = await uno(`INSERT INTO rimborsi.note (person_id, anno, mese, stato, responsabile_person_id, inviata_at, motivazione) VALUES ($1,2026,$2,$3,$4, CASE WHEN $3 <> 'BOZZA' THEN now() END, 'visita di prova') RETURNING id`, [pid, mese, stato, resp]);
    const c = await uno(`SELECT id FROM rimborsi.categorie WHERE codice='VITTO'`);
    const sp = await uno(`INSERT INTO rimborsi.spese (nota_id, data, descrizione, categoria_id, importo) VALUES ($1, make_date(2026, $2, 5), 'Pranzo di prova', $3, 20) RETURNING id`, [n.id, mese, c.id]);
    await db.query(`INSERT INTO rimborsi.allegati (nota_id, riga_tipo, riga_id, filename, mime, size, sha256, data) VALUES ($1,'SPESA',$2,'scontrino.jpg','image/jpeg',$3,'x',$4)`, [n.id, sp.id, JPEG.length, JPEG]);
    await M.core.ricalcola(n.id);
    return n.id;
  };
  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    const pg = (await pg0).default;
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    await (await import('../src/migrate.js')).migrate();
    await (await import('../src/lib/travaso.js')).startFresh('rimborsi', null);
    db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    const persona = async (nome, manager = null) => (await uno(`INSERT INTO people (kind, status, last_name, first_name, manager_person_id) VALUES ('DIPENDENTE','ATTIVO',$1,'Prova',$2) RETURNING id`, [nome, manager])).id;
    const nuovoUtente = async (pid, level = 'USER') => (await uno(`INSERT INTO users (email, full_name, level, status, person_id) VALUES ($1,$1,$2,'ACTIVE',$3) RETURNING id`, [`u${pid}@toscanadiagnostica.it`, level, pid])).id;
    M.v = await persona('Verticefinto'); M.r = await persona('Respfinto', M.v); M.d = await persona('Dipfinto', M.r); M.p = await persona('Pcfinto', M.v);
    M.uv = await nuovoUtente(M.v, 'OWNER'); M.ur = await nuovoUtente(M.r); M.ud = await nuovoUtente(M.d); M.up = await nuovoUtente(M.p);
    M.core = await import('../src/modules/rimborsi/lib/core.js');
    await M.core.setSetting('pc_person_ids', [M.p]);
    M.core.invalidaPerimetro();
    I = await import('../src/modules/rimborsi/lib/invioApprovazione.js');
    I._impostaInvio(async (m) => { chiamate.push(m); return typeof risposta === 'function' ? risposta(m) : risposta; });
    const flusso = (await import('../src/modules/rimborsi/routes/flusso.js')).default;
    const express = (await import('express')).default;
    const app = express(); app.use(express.json());
    app.use((req, _res, nx) => { req.user = { ...utente }; nx(); });
    app.use('/api/rimborsi', flusso);
    app.use((err, _req, res, _nx) => res.status(err.status || 500).json({ error: err.message }));
    srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    base = `http://127.0.0.1:${srv.address().port}/api/rimborsi`;
  }, { timeout: 180000 });
  after(async () => {
    I?._impostaInvio(null);
    srv?.close();
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    const { modulePool } = await import('../src/lib/modules.js').catch(() => ({}));
    await modulePool?.('rimborsi').end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });
  const come = (uid, pid, level = 'USER') => { utente = { id: uid, person_id: pid, level, grants: {} }; };
  const testoPdf = async (buf) => { const { createRequire } = await import('node:module'); const req = createRequire(import.meta.url); return (await req('pdf-parse/lib/pdf-parse.js')(buf)).text; };

  test('approvazione manuale: una email da people@ ai due destinatari del CEO con il PDF della nota approvata', async () => {
    const id = await nota(M.d, 9, 'INVIATA', M.r);
    chiamate = []; risposta = { ok: true, logId: null };
    come(M.ur, M.r);
    const r = await http('POST', `/note/${id}/approva`);
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.nota.stato, 'APPROVATA');
    assert.equal(chiamate.length, 1);
    const m = chiamate[0];
    assert.equal(m.from, 'people@toscanadiagnostica.it');
    assert.deepEqual(m.to, ['a.poggiali@confindustriaservizicentroecosta.it', 'm.caiani@confindustriaservizicentroecosta.it']);
    assert.equal(m.subject, 'Rimborso spese approvato · Dipfinto Prova · Settembre 2026');
    assert.equal(m.attachments.length, 1, 'solo il PDF, nessun giustificativo');
    assert.equal(m.attachments[0].contentType, 'application/pdf'); assert.equal(m.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
    assert.match(m.html, /in allegato la nota spese approvata/); assert.match(m.html, /People · Toscana Diagnostica/);
    const t = await testoPdf(m.attachments[0].content);
    assert.match(t, /TD-SGI-MOD025_00/); assert.match(t, /Approvata da/);
    assert.equal(r.j.invio_approvazione.esito, 'INVIATA');
    assert.ok(r.j.eventi.some((e) => e.tipo === 'PDF_APPROVAZIONE' && /inviato a Poggiali Angela/.test(e.testo)));
    // P&C rimanda al responsabile e la nota viene riapprovata: il PDF riparte "(aggiornata)"
    come(M.up, M.p);
    assert.equal((await http('POST', `/note/${id}/rimanda`, { a: 'RESPONSABILE', motivo: 'manca un dettaglio' })).s, 200);
    come(M.ur, M.r);
    assert.equal((await http('POST', `/note/${id}/approva`)).s, 200);
    assert.equal(chiamate.length, 2); assert.match(chiamate[1].subject, /\(aggiornata\)$/);
    // con allega_giustificativi anche le foto
    await M.core.setSetting('allega_giustificativi', true);
    come(M.up, M.p);
    await http('POST', `/note/${id}/reinvia-approvazione`);
    assert.equal(chiamate[2].attachments.length, 2);
    await M.core.setSetting('allega_giustificativi', false);
  });

  test('vertice: conferma = approvazione automatica, poi l\'invio del PDF; casella Responsabile "Approvazione automatica"', async () => {
    const id = await nota(M.v, 10, 'BOZZA');
    chiamate = []; risposta = { ok: true };
    come(M.uv, M.v, 'OWNER');
    const r = await http('POST', `/note/${id}/invia`);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.nota.stato, 'APPROVATA'); assert.equal(r.j.nota.approvazione_automatica, true); assert.equal(r.j.nota.approvata_person_id, M.v);
    assert.ok(r.j.eventi.some((e) => e.tipo === 'APPROVATA' && e.testo === 'Approvata automaticamente: nessun superiore in organigramma'));
    assert.equal(chiamate.length, 1);
    assert.match(await testoPdf(chiamate[0].attachments[0].content), /Approvazione automatica \(vertice\s+dell.organigramma\)/);
    assert.match(chiamate[0].html, /approvazione automatica del vertice/);
    come(M.up, M.p);
    assert.equal((await http('POST', `/note/${id}/rimanda`, { a: 'RESPONSABILE', motivo: 'x' })).s, 400, 'il vertice non ha un responsabile a cui rimandare');
    assert.equal((await http('POST', `/note/${id}/prendi-in-carico`)).s, 200, 'poi IN LIQUIDAZIONE come le altre');
  });

  test('chi ha un superiore non raggiungibile NON è approvato in automatico: va a P&C', async () => {
    await db.query(`UPDATE people SET status='CESSATO' WHERE id=$1`, [M.r]); M.core.invalidaPerimetro();
    const id = await nota(M.d, 8, 'BOZZA');
    chiamate = [];
    come(M.ud, M.d);
    const r = await http('POST', `/note/${id}/invia`);
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.nota.stato, 'INVIATA');
    assert.equal(chiamate.length, 0);
    await db.query(`UPDATE people SET status='ATTIVO' WHERE id=$1`, [M.r]); M.core.invalidaPerimetro();
    await db.query(`DELETE FROM rimborsi.note WHERE id=$1`, [id]);
  });

  test('errore d\'invio: l\'approvazione resta, esito ERRORE nella scheda, Reinvia per P&C e titolare', async () => {
    const id = await nota(M.d, 7, 'INVIATA', M.r);
    chiamate = []; risposta = { ok: false, error: 'Graph sendMail 403 Access is denied' };
    come(M.ur, M.r);
    const r = await http('POST', `/note/${id}/approva`);
    assert.equal(r.s, 200); assert.equal(r.j.nota.stato, 'APPROVATA');
    assert.equal(r.j.invio_approvazione.esito, 'ERRORE'); assert.match(r.j.invio_approvazione.errore, /403/);
    // anche un'eccezione del mailer non blocca
    const id2 = await nota(M.d, 6, 'INVIATA', M.r);
    risposta = () => { throw new Error('rete assente'); };
    assert.equal((await http('POST', `/note/${id2}/approva`)).j.nota.stato, 'APPROVATA');
    come(M.ud, M.d);
    assert.equal((await http('POST', `/note/${id}/reinvia-approvazione`)).s, 403, 'il dipendente non reinvia');
    risposta = { ok: true };
    come(M.up, M.p);
    const ri = await http('POST', `/note/${id}/reinvia-approvazione`);
    assert.equal(ri.s, 200); assert.equal(ri.j.invio_approvazione.esito, 'INVIATA');
    assert.ok(!/aggiornata/.test(chiamate.at(-1).subject), 'un reinvio dopo un errore non è una versione aggiornata');
    come(M.uv, M.v, 'OWNER');
    assert.equal((await http('POST', `/note/${id2}/reinvia-approvazione`)).s, 200, 'il titolare reinvia');
  });

  test('interruttore spento: nessun invio, esito SALTATA', async () => {
    await M.core.setSetting('invio_approvazione_attivo', false);
    const id = await nota(M.d, 5, 'INVIATA', M.r);
    chiamate = []; risposta = { ok: true };
    come(M.ur, M.r);
    const r = await http('POST', `/note/${id}/approva`);
    assert.equal(r.j.nota.stato, 'APPROVATA'); assert.equal(chiamate.length, 0); assert.equal(r.j.invio_approvazione.esito, 'SALTATA');
    await M.core.setSetting('invio_approvazione_attivo', true);
  });
});

// ------------------------------------------------------------------ integrazione con la Suite vera (persone inventate)
describe('Rimborso Spese nella Suite (integrazione)', { skip: SALTA }, () => {
  let H, S, db, ids = {}, C = {};
  const PW = 'Prova-Rimborsi-2026x';
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    const bcrypt = (await import('bcryptjs')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const o = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    C.o = o;
    for (const k of ['contracts', 'ferie']) assert.equal((await o.post(`/api/travaso/${k}/run`)).s, 200);
    const hash = await bcrypt.hash(PW, 10);
    const persona = async (last, first, kind, manager = null) => (await db.query(`INSERT INTO people (kind, status, last_name, first_name, email, job_title, manager_person_id) VALUES ($1,'ATTIVO',$2,$3,$4,'Ruolo di prova',$5) RETURNING id`,
      [kind, last, first, `${first}.${last}@toscanadiagnostica.it`.toLowerCase(), manager])).rows[0].id;
    const utente = async (pid, email, level = 'USER', ext = false) => (await db.query(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, password_hash, must_change_password, person_id, is_external)
      VALUES ($1,$1,'x','y',$2,'ACTIVE','BOTH',$3,false,$4,$5) RETURNING id`, [email, level, hash, pid, ext])).rows[0].id;
    ids.vertice = await persona('Primotest', 'Vittorio', 'DIPENDENTE');
    await db.query('UPDATE users SET person_id=$1 WHERE email=$2', [ids.vertice, H.OWNER.email]);
    ids.resp = await persona('Respotest', 'Rita', 'DIPENDENTE', ids.vertice);
    ids.pc = await persona('Pictest', 'Paola', 'DIPENDENTE', ids.vertice);
    ids.dip = await persona('Dipetest', 'Dario', 'DIPENDENTE', ids.resp);
    ids.auto = await persona('Autotest', 'Aldo', 'DIPENDENTE', ids.resp);
    ids.lp = await persona('Liberotest', 'Lia', 'LP', ids.resp);
    ids.med = await persona('Medicotest', 'Mino', 'MEDICO');
    const login = async (k, email) => { await H.entra(H.client(S.base), email, PW, PW).then((c) => { C[k] = c; }); };
    for (const k of ['resp', 'pc', 'dip', 'auto', 'lp', 'med']) {
      const r = (await db.query('SELECT first_name, last_name FROM people WHERE id=$1', [ids[k]])).rows[0];
      const email = `${r.first_name}.${r.last_name}@toscanadiagnostica.it`.toLowerCase();
      ids[`u_${k}`] = await utente(ids[k], email);
      await login(k, email);
    }
    await utente(null, 'admin.nondipendente@toscanadiagnostica.it', 'ADMIN'); await login('admin', 'admin.nondipendente@toscanadiagnostica.it');
    await utente(null, 'esterno.prova@partner-prova.test', 'USER', true); await login('est', 'esterno.prova@partner-prova.test');
    await db.query(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,'contracts','ADMIN','MANUAL')`, [ids.u_pc]);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const upload = async (c, nid, tipo, rid) => {
    const fd = new FormData(); fd.append('riga_tipo', tipo); fd.append('riga_id', String(rid));
    // JPEG minimo valido (1×1) fatto a mano: nessun dato reale
    fd.append('file', new Blob([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')], { type: 'image/jpeg' }), 'scontrino.jpg');
    const r = await fetch(`${S.base}/api/rimborsi/note/${nid}/allegati`, { method: 'POST', headers: { cookie: c.cookie, 'X-Requested-With': 'td-suite' }, body: fd });
    const t = await r.text(); assert.equal(r.status, 201, t); return JSON.parse(t)[0];
  };

  test('accesso: solo dipendenti (API 403 e nessun widget per LP, medico, esterno, amministratore non dipendente)', async () => {
    for (const k of ['lp', 'med', 'admin', 'est']) {
      assert.equal((await C[k].get('/api/rimborsi/state')).s, 403, k);
      assert.ok(!((await C[k].get('/api/home/modules')).j?.areas || []).some((a) => a.modules.some((m) => m.key === 'rimborsi')), `${k}: widget`);
      assert.equal((await C[k].get('/api/rimborsi/moduli/MOD025.pdf')).s, 403, `${k}: modulo cartaceo`);
    }
    const st = must(await C.dip.get('/api/rimborsi/state'), 'state');
    assert.equal(st.mode, 'LIVE'); assert.equal(st.user.approvatore.nome, 'Respotest Rita');
    assert.ok((await C.dip.get('/api/home/modules')).j.areas.some((a) => a.modules.some((m) => m.key === 'rimborsi')));
    assert.ok(must(await C.pc.get('/api/rimborsi/state'), 'pc').user.isPC);
    assert.ok(must(await C.o.get('/api/rimborsi/state'), 'vertice').user.approvatore.al_pc);
    const m = await fetch(`${S.base}/api/rimborsi/moduli/MOD029.pdf`, { headers: { cookie: C.dip.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), 'application/pdf');
  });

  test('flusso completo: una nota per mese, calcoli, giustificativi, respingimento, esclusione, liquidazione, blocco, PDF, ZIP, permessi', async () => {
    const cat = must(await C.dip.get('/api/rimborsi/categorie'), 'categorie');
    const c = (k) => cat.find((x) => x.codice === k).id;
    assert.ok(cat.every((x) => x.massimale_spesa == null && x.massimale_giorno == null), 'nessun massimale inventato');
    const n = must(await C.dip.post('/api/rimborsi/note', { anno: 2026, mese: 10 }), 'nota');
    assert.equal(must(await C.dip.post('/api/rimborsi/note', { anno: 2026, mese: 10 }), 'seconda').id, n.id, 'una nota per mese');
    assert.equal((await C.dip.post('/api/rimborsi/note', { anno: 2099, mese: 1 })).s, 400, 'mese futuro');
    // tariffa unica aziendale (0,42 EUR/km, predefinita dal 13/11/2026): un viaggio la riceve anche se il veicolo non ha tariffa
    assert.equal(must(await C.dip.get('/api/rimborsi/veicoli'), 'veicoli').tariffa_default.tariffa, 0.42);
    assert.equal((await C.dip.get('/api/rimborsi/veicoli')).j.tariffa_default.unica, true);
    // il resto del flusso prova la modalità "tariffa del veicolo" (unica spenta, nessuna predefinita), che resta disponibile
    must(await C.pc.put('/api/rimborsi/impostazioni', { tariffa_km_unica: false, tariffa_km_default: null }), 'modalità per veicolo');
    const v = must(await C.dip.post('/api/rimborsi/veicoli', { marca: 'Marca', modello: 'Modello', targa: 'PROVA09' }), 'veicolo');
    const s1 = must(await C.dip.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-07', descrizione: 'Pranzo di prova', categoria_id: c('VITTO'), importo: '16,00', motivazione: 'visita' }), 's1');
    const s2 = must(await C.dip.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-15', descrizione: 'Albergo di prova', categoria_id: c('ALLOGGIO'), importo: 92, motivazione: 'corso' }), 's2');
    const v1 = must(await C.dip.post(`/api/rimborsi/note/${n.id}/viaggi`, { data: '2026-10-21', partenza: 'Firenze', arrivo: 'Prato', andata_ritorno: true, km: 21.5, veicolo_id: v.id, motivazione: 'visita' }), 'v1');
    assert.equal((await C.dip.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-11-02', descrizione: 'fuori', categoria_id: c('VITTO'), importo: 1, motivazione: 'x' })).s, 400, 'fuori mese');
    let inv = await C.dip.post(`/api/rimborsi/note/${n.id}/invia`);
    assert.equal(inv.s, 400); assert.match(inv.j.error, /giustificativo/); assert.match(inv.j.error, /tariffa/);
    const a1 = await upload(C.dip, n.id, 'SPESA', s1.id); await upload(C.dip, n.id, 'SPESA', s2.id);
    must(await C.pc.put(`/api/rimborsi/veicoli/${v.id}`, { person_id: ids.dip, marca: 'Marca', modello: 'Modello', targa: 'PROVA09', tariffa: '0,4321', tariffa_fonte: 'valore di prova' }), 'tariffa P&C');
    must(await C.dip.put(`/api/rimborsi/note/${n.id}`, { anticipi: '50' }), 'anticipi');
    let sc = must(await C.dip.get(`/api/rimborsi/note/${n.id}`), 'scheda');
    assert.equal(sc.viaggi[0].importo, 18.58);
    assert.equal(sc.riepilogo.tot_rimborsabile, 126.58); assert.equal(sc.riepilogo.saldo, 76.58);
    assert.equal((await C.resp.get(`/api/rimborsi/allegati/${a1.id}`)).s, 404, 'bozza mai inviata: il responsabile non la vede');
    inv = must(await C.dip.post(`/api/rimborsi/note/${n.id}/invia`), 'invio');
    assert.equal(inv.nota.stato, 'INVIATA'); assert.equal(inv.nota.responsabile_person_id, ids.resp);
    assert.equal((await C.dip.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-08', descrizione: 'dopo', categoria_id: c('VITTO'), importo: 1, motivazione: 'x' })).s, 400, 'nessuna modifica dopo l\'invio');
    assert.equal((await C.dip.post(`/api/rimborsi/note/${n.id}/approva`)).s, 403, 'nessuno approva la propria');
    assert.equal((await C.pc.post(`/api/rimborsi/note/${n.id}/approva`)).s, 403);
    const n1 = await db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND module_key='rimborsi'`, [ids.u_resp]);
    assert.ok(n1.rows[0].n >= 1, 'notifica al responsabile');
    assert.equal((await fetch(`${S.base}/api/rimborsi/allegati/${a1.id}`, { headers: { cookie: C.resp.cookie, 'X-Requested-With': 'td-suite' } })).status, 200, 'il responsabile scarica i giustificativi');
    assert.equal((await C.auto.get(`/api/rimborsi/allegati/${a1.id}`)).s, 404, 'un collega no');
    must(await C.resp.post(`/api/rimborsi/note/${n.id}/respingi`, { motivo: 'Indica il corso' }), 'respingi');
    must(await C.dip.put(`/api/rimborsi/note/${n.id}`, { motivazione: 'Visite e corso' }), 'correzione');
    must(await C.dip.post(`/api/rimborsi/note/${n.id}/invia`), 'reinvio');
    sc = must(await C.resp.post(`/api/rimborsi/note/${n.id}/escludi`, { tipo: 'SPESA', riga_id: s2.id, motivo: 'pagato dall\'azienda' }), 'escludi');
    assert.equal(sc.riepilogo.tot_escluso, 92); assert.equal(sc.riepilogo.tot_rimborsabile, 34.58);
    must(await C.resp.post(`/api/rimborsi/note/${n.id}/approva`), 'approva');
    assert.equal((await C.dip.post(`/api/rimborsi/note/${n.id}/liquida`, { data: '2026-11-12', importo: 1, riferimento: 'x' })).s, 403);
    must(await C.pc.post(`/api/rimborsi/note/${n.id}/liquida`, { data: '2026-11-12', importo: 0, riferimento: 'cedolino di prova' }), 'liquida');
    sc = must(await C.pc.post(`/api/rimborsi/note/${n.id}/archivia`), 'archivia');
    assert.equal(sc.nota.stato, 'ARCHIVIATA'); assert.ok(sc.nota.pdf_allegato_id);
    assert.equal((await C.dip.post(`/api/rimborsi/note/${n.id}/viaggi`, { data: '2026-10-22', partenza: 'Firenze', arrivo: 'Prato', km: 5, veicolo_id: v.id, motivazione: 'x' })).s, 400, 'mese liquidato bloccato');
    const tipi = (await db.query(`SELECT tipo FROM rimborsi.eventi WHERE nota_id=$1 ORDER BY id`, [n.id])).rows.map((r) => r.tipo);
    assert.deepEqual(tipi.filter((t) => t !== 'CREATA'), ['INVIATA', 'RESPINTA', 'INVIATA', 'RIGA_ESCLUSA', 'APPROVATA', 'PDF_APPROVAZIONE', 'IN_LIQUIDAZIONE', 'LIQUIDATA', 'ARCHIVIATA']);
    const pdf = await fetch(`${S.base}/api/rimborsi/note/${n.id}/pdf`, { headers: { cookie: C.dip.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(pdf.status, 200); const buf = Buffer.from(await pdf.arrayBuffer()); assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    const zip = await fetch(`${S.base}/api/rimborsi/note/${n.id}/giustificativi.zip`, { headers: { cookie: C.pc.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(zip.status, 200); assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await C.auto.get(`/api/rimborsi/note/${n.id}/giustificativi.zip`)).s, 404, 'ZIP: stessi permessi');
    const xl = await fetch(`${S.base}/api/rimborsi/export.xlsx?anno=2026`, { headers: { cookie: C.pc.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(xl.status, 200);
    assert.equal((await C.dip.get('/api/rimborsi/export.xlsx?anno=2026')).s, 403);
    assert.ok(JSON.stringify((await C.dip.get('/api/search?q=nota%20spese%20ottobre')).j).includes(`/rimborsi/nota/${n.id}`), 'ricerca globale: le proprie note');
    assert.ok(!JSON.stringify((await C.auto.get('/api/search?q=nota%20spese%20ottobre')).j).includes(`/rimborsi/nota/${n.id}`), 'mai le note altrui');
  });

  test('vettura aziendale e fuel card da Contratti del personale; numero mascherato; doppioni; vertice a P&C; D58 e D59', async () => {
    const pin = await C.pc.post(`/api/contracts/benefit/persona/${ids.auto}/fuel-card`, { circuito: 'DKV', numero: '0000 1111 2222 3333', pin: '1234', dal: '2026-01-01' });
    assert.equal(pin.s, 400, 'il PIN non si salva');
    const vet = must(await C.pc.post(`/api/contracts/benefit/persona/${ids.auto}/vetture`, { marca: 'Marca', modello: 'Prova', targa: 'PROVA01', dal: '2026-01-01', uso_promiscuo: true }), 'vettura');
    const fc = must(await C.pc.post(`/api/contracts/benefit/persona/${ids.auto}/fuel-card`, { circuito: 'DKV', numero: '0000 1111 2222 3333', dal: '2026-01-01', vettura_id: vet.id }), 'fuel');
    assert.equal((await C.dip.get(`/api/contracts/benefit/persona/${ids.auto}`)).s, 403);
    const cat = must(await C.auto.get('/api/rimborsi/categorie'), 'categorie');
    const n = must(await C.auto.post('/api/rimborsi/note', { anno: 2026, mese: 10 }), 'nota');
    const vi = must(await C.auto.post(`/api/rimborsi/note/${n.id}/viaggi`, { data: '2026-10-13', partenza: 'Firenze', arrivo: 'Prato', andata_ritorno: true, km: 78, veicolo_tipo: 'PROPRIO', motivazione: 'visita' }), 'viaggio');
    assert.equal(vi.viaggi[0].veicolo_tipo, 'AZIENDALE'); assert.equal(vi.riepilogo.tot_km_importo, 0); assert.equal(vi.vettura_aziendale.targa, 'PROVA01');
    const carb = cat.find((x) => x.codice === 'CARBURANTE').id;
    const sf = must(await C.auto.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-13', descrizione: 'Gasolio', categoria_id: carb, importo: 52.8, metodo: 'FUEL_CARD', fuel_card_id: fc.fuel_card[0].id, motivazione: 'visita' }), 'fuel');
    assert.equal(sf.riepilogo.tot_carta, 52.8); assert.equal(sf.riepilogo.tot_rimborsabile, 0);
    assert.equal(sf.spese[0].fuel_card.numero, '0000 1111 2222 3333', 'assegnatario: numero intero');
    const d1 = must(await C.auto.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-14', descrizione: 'Cena', categoria_id: cat.find((x) => x.codice === 'VITTO').id, importo: 20, motivazione: 'x' }), 'd1');
    const d2 = must(await C.auto.post(`/api/rimborsi/note/${n.id}/spese`, { data: '2026-10-14', descrizione: 'Cena bis', categoria_id: cat.find((x) => x.codice === 'VITTO').id, importo: 20, motivazione: 'x' }), 'd2');
    assert.ok(d2.spese.filter((x) => x.doppione_di.length).length === 2 && d2.controlli.avvisi.some((a) => /doppione/.test(a)));
    for (const s of d2.spese) await upload(C.auto, n.id, 'SPESA', s.id);
    must(await C.auto.post(`/api/rimborsi/note/${n.id}/invia`), 'invio');
    const vista = must(await C.resp.get(`/api/rimborsi/note/${n.id}`), 'responsabile');
    assert.ok(vista.spese.find((x) => x.metodo === 'FUEL_CARD').fuel_card.numero.startsWith('••••'), 'responsabile: numero mascherato');
    assert.ok(d1);
    // vertice (titolare dipendente, nessun superiore): approvazione automatica alla conferma, poi P&C; PDF da people@ (registro email)
    const cv = must(await C.o.post('/api/rimborsi/note', { anno: 2026, mese: 10 }), 'nota vertice');
    const t = must(await C.o.post(`/api/rimborsi/note/${cv.id}/spese`, { data: '2026-10-20', descrizione: 'Taxi', categoria_id: cat.find((x) => x.codice === 'TAXI').id, importo: 18, motivazione: 'incontro' }), 'taxi');
    await upload(C.o, cv.id, 'SPESA', t.spese[0].id);
    const iv = must(await C.o.post(`/api/rimborsi/note/${cv.id}/invia`), 'conferma vertice');
    assert.equal(iv.nota.stato, 'APPROVATA'); assert.equal(iv.nota.approvazione_automatica, true); assert.equal(iv.nota.approvata_person_id, ids.vertice);
    assert.ok(iv.eventi.some((e) => e.tipo === 'APPROVATA' && /automaticamente/.test(e.testo)));
    assert.equal(iv.invio_approvazione.esito, 'INVIATA');
    const log = (await db.query(`SELECT from_addr, to_addr, subject, status FROM email_log WHERE ref = $1`, [`rimborsi:${cv.id}:approvazione`])).rows;
    assert.equal(log.length, 1); assert.equal(log[0].from_addr, 'people@toscanadiagnostica.it'); assert.equal(log[0].status, 'LOGGED');
    assert.match(log[0].to_addr, /a\.poggiali@confindustriaservizicentroecosta\.it.*m\.caiani@confindustriaservizicentroecosta\.it/);
    assert.match(log[0].subject, /^Rimborso spese approvato · Primotest Vittorio · Ottobre 2026$/);
    must(await C.pc.post(`/api/rimborsi/note/${cv.id}/prendi-in-carico`), 'P&C prende in carico la nota del vertice');
    // Diagnostica: D58 (seme non abbinato: i quattro cognomi non esistono nel database di prova) e D59 (attesa oltre 10 giorni)
    const k58 = must(await C.o.get('/api/admin/diagnostica/D58'), 'D58');
    assert.equal(k58.n, 4);
    await db.query(`UPDATE rimborsi.note SET inviata_at = now() - interval '12 days' WHERE id=$1`, [n.id]);
    const k59 = must(await C.o.get('/api/admin/diagnostica/D59'), 'D59');
    assert.equal(k59.n, 1);
  });
});
