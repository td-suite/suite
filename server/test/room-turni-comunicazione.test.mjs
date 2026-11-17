// v0.79.0 · Room, turni: alla conferma del mese la persona in turno riceve la comunicazione della pianificazione con il prospetto del
// mese in PDF allegato. Qui: il PDF (pdfkit) nasce ed è leggibile, il testo riporta i dati del mese, la conferma registra l'allegato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pdfTurniPersona, testoComunicazioneTurni, oreTurni } from '../src/modules/room/lib/turniPdf.js';

const TURNI = [{ data: '2026-12-01', ora_da: '07:30:00', ora_a: '10:30:00', sede: 'Quarrata', attivita: 'Prelievi', nota: null }, { data: '2026-12-03', ora_da: '07:30', ora_a: '10:30', sede: 'Quarrata', attivita: 'Prelievi', nota: 'Sostituzione' }, { data: '2026-12-31', ora_da: '14:00', ora_a: '18:30', sede: 'Prato', attivita: null, nota: null }];

describe('Comunicazione dei turni: regole pure', () => {
  test('ore, testo e PDF del mese', async () => {
    assert.equal(oreTurni(TURNI), 10.5);
    const t = testoComunicazioneTurni({ nome: 'Maria Prova', mese: '2026-12', turni: TURNI, base: 'https://suite.example' });
    assert.match(t, /pianificazione dei turni di dicembre 2026/); assert.match(t, /3 turni, per un totale di 10,5 ore, nelle sedi di Quarrata, Prato/);
    assert.match(t, /Il primo è il 01\/12 dalle 07:30 alle 10:30, l'ultimo il 31\/12/); assert.match(t, /In allegato trovi il prospetto completo del mese in PDF/);
    assert.match(testoComunicazioneTurni({ nome: 'X', mese: '2026-12', turni: TURNI.slice(0, 1) }), /1 turno, per un totale di 3 ore, presso la sede di Quarrata/);
    const buf = await pdfTurniPersona({ mese: '2026-12', nome: 'Maria Prova', profilo: 'Infermiera', turni: TURNI, confermatoIl: '17/11/2026' });
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 1500);
    // un mese pieno va su più pagine senza errori
    const tanti = Array.from({ length: 80 }, (_, i) => ({ data: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`, ora_da: '08:00', ora_a: '12:00', sede: 'Sede con un nome piuttosto lungo', attivita: 'Ambulatorio', nota: '' }));
    assert.equal((await pdfTurniPersona({ mese: '2026-12', nome: 'Maria Prova', turni: tanti })).subarray(0, 5).toString(), '%PDF-');
  });
});

describe('Conferma del mese: email con il prospetto allegato', { skip: !process.env.DATABASE_URL_TEST }, () => {
  let H, S, db, D;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base);
    assert.equal((await D.o.post('/api/travaso/room/run')).s, 200);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('la persona in turno riceve la comunicazione con il PDF del suo mese', async () => {
    const o = D.o;
    for (const g of ['2026-12-01', '2026-12-02']) assert.equal((await o.post('/api/room/personale/turni', { sede_id: D.site.pp1, data: g, ora_da: '07:30', ora_a: '10:30', prof_id: D.person.interno, attivita: 'Prelievi' })).s, 201);
    assert.equal((await o.post('/api/room/personale/turni', { sede_id: D.site.pp1, data: '2026-12-03', ora_da: '07:30', ora_a: '10:30' })).s, 201);   // scoperto: nessun destinatario
    const c = await o.post('/api/room/personale/turni/mesi/2026-12/conferma', {});
    assert.equal(c.s, 200, c.text); assert.equal(c.j.professionisti, 1); assert.equal(c.j.esiti.length, 1); assert.equal(c.j.esiti[0].allegato, true);
    const m = (await db.query(`SELECT to_addr, subject, body, attachment_name, status FROM room.email_log WHERE kind='TURNI_MESE' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(m.to_addr, 'ivo.internotest@toscanadiagnostica.it'); assert.match(m.subject, /Pianificazione dei turni di dicembre 2026/);
    assert.match(m.body, /2 turni, per un totale di 6 ore, presso la sede di Punto Prelievi Test/); assert.match(m.attachment_name, /^Turni_2026-12_.*\.pdf$/);
    // elenco dei turni: ogni turno porta il nome della sede (serve al PDF del calendario)
    assert.ok((await o.get('/api/room/personale/turni?mese=2026-12')).j.turni.every((t) => t.sede === 'Punto Prelievi Test'));
  });
});
