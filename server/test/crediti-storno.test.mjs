// Recupero Crediti v0.99.6: lo storno si registra da solo. Una nota di credito arrivata dal gestionale chiude la fattura che storna
// (stesso cliente, stesso importo, fattura emessa prima) e la fattura riemessa resta aperta; nel dubbio la nota resta da applicare a mano.
// Serve DATABASE_URL_TEST.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Recupero Crediti: storno automatico da nota di credito', { skip: SALTA }, () => {
  let H, S, db, O, D;
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const doc = (org, n, numero, data, importo, stato) => db.query(`INSERT INTO crediti.fatture (fonte, fonte_id, organization_id, cliente_nome, numero, data, scadenza, scadenza_origine, importo, stato)
     VALUES ('SYNCLAB', $1, $2, 'Cliente', $3, $4, '2026-11-30', 'TERMINI', $5, $6)`, [`prova:${n}`, org, numero, data, importo, stato]);
  const elenco = async () => Object.fromEntries(must(await O.get('/api/crediti/fatture?stato=TUTTE'), 'fatture').righe.map((f) => [f.numero, f]));
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite({ env: { CREDITI_POSTA_PROVA: '1' } });
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base); O = D.o;
    must(await O.get('/api/crediti/fatture'), 'widget avviato');
    // cliente uno: il caso reale (22 stornata dalla 38, riemessa come 41, più una fattura che non c'entra)
    await doc(D.org.c1, 1, '26-00022/D', '2026-10-13', 7512.56, 'APERTA');
    await doc(D.org.c1, 2, '26-00038/D', '2026-10-13', -7512.56, 'NOTA_CREDITO');
    await doc(D.org.c1, 3, '26-00041/D', '2026-10-13', 7512.56, 'APERTA');
    await doc(D.org.c1, 4, '26-00052/D', '2026-10-31', 10831.68, 'APERTA');
    // cliente due: due fatture precedenti di pari importo, la nota non dice quale
    await doc(D.org.c2, 5, '26-00010/D', '2026-09-30', 500, 'APERTA');
    await doc(D.org.c2, 6, '26-00011/D', '2026-09-30', 500, 'APERTA');
    await doc(D.org.c2, 7, '26-00020/D', '2026-10-05', -500, 'NOTA_CREDITO');
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('alla lettura dal gestionale la fattura stornata si chiude da sola, quella riemessa resta aperta', async () => {
    const out = must(await O.post('/api/crediti/fatture-sincronizza', {}), 'sincronizza');
    assert.deepEqual([out.storni, out.note_da_applicare], [1, 1]);
    const f = await elenco();
    assert.deepEqual([f['26-00022/D'].stato, f['26-00022/D'].stornata, f['26-00022/D'].nota_numero, f['26-00022/D'].residuo], ['PAGATA', true, '26-00038/D', 0]);
    assert.deepEqual([f['26-00041/D'].stato, f['26-00041/D'].stornata, f['26-00041/D'].residuo], ['APERTA', false, 7512.56]);
    assert.equal(f['26-00052/D'].stato, 'APERTA');
    assert.equal(f['26-00038/D'].incassato, 7512.56, 'la nota è usata per intero');
    const ev = (await db.query(`SELECT testo FROM crediti.eventi WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`, [D.org.c1]).catch(() => ({ rows: [] }))).rows[0];
    if (ev) assert.match(ev.testo, /Storno registrato in automatico: la nota di credito n\. 26-00038\/D chiude la fattura n\. 26-00022\/D/);
    // non compare più tra le fatture abbinabili a un bonifico
    const abbinabili = must(await O.get('/api/crediti/riconciliazione/fatture?cerca=cliente test uno'), 'abbinabili').righe.map((x) => x.numero);
    assert.ok(abbinabili.includes('26-00041/D') && !abbinabili.includes('26-00022/D'), abbinabili.join(', '));
  });

  test('nel dubbio niente storno: la nota resta da applicare a mano; una seconda lettura non cambia nulla', async () => {
    const f = await elenco();
    assert.deepEqual([f['26-00010/D'].stato, f['26-00011/D'].stato, f['26-00020/D'].incassato], ['APERTA', 'APERTA', 0]);
    const out = must(await O.post('/api/crediti/fatture-sincronizza', {}), 'sincronizza');
    assert.deepEqual([out.storni, out.note_da_applicare], [0, 1]);
    // a mano resta possibile
    const nota = f['26-00020/D'];
    must(await O.post(`/api/crediti/note-credito/${nota.id}/applica`, { fattura_id: f['26-00011/D'].id }), 'applica a mano');
    assert.equal((await elenco())['26-00011/D'].stornata, true);
  });

  // v0.99.7: i movimenti della banca hanno una tipologia (dalla causale) e la pagina Incassi da abbinare si filtra per tipologia
  test('banca: il bonifico che cita la fattura stornata propone la sostitutiva; filtro per tipologia del movimento', async () => {
    const mov = (chiave, importo, causale) => db.query(`INSERT INTO public.bank_transactions (iban, chiave, booking_date, value_date, importo, causale) VALUES ('IT00PROVA', $1, current_date - 1, current_date - 1, $2, $3)`, [chiave, importo, causale]);
    await mov('m1', 7512.56, 'Bonifico a vs favore *INST 16:19 EDL International LLC 99-00022/D');
    await mov('m2', 85, 'Incassi PagoBancomat 24.11.26 - 0012'); await mov('m3', 120.5, 'Incassi Internazionali Numia SpA 4411'); await mov('m4', 300, 'Versamento contante allo sportello');
    must(await O.post('/api/crediti/riconciliazione/esegui', {}), 'riesamina');
    const prop = must(await O.get('/api/crediti/riconciliazione?stato=PROPOSTO'), 'proposte');
    assert.equal(prop.righe.length, 1); assert.equal(prop.righe[0].tipo, 'BONIFICO'); assert.equal(prop.righe[0].righe[0].numero, '26-00041/D', 'proposta la fattura che sostituisce la 22 stornata');
    const tutti = must(await O.get('/api/crediti/riconciliazione?stato=DA_ABBINARE'), 'senza abbinamento');
    assert.deepEqual(tutti.tipi.map((t) => [t.tipo, t.n]), [['POS', 2], ['CONTANTI', 1]]); assert.equal(tutti.totale, 3); assert.equal(tutti.righe.length, 3);
    const pos = must(await O.get('/api/crediti/riconciliazione?stato=DA_ABBINARE&tipo=POS'), 'solo POS');
    assert.deepEqual(pos.righe.map((r) => r.importo).sort((a, b) => a - b), [85, 120.5]); assert.equal(pos.totale, 3, 'i conteggi restano quelli di tutto lo stato');
    assert.equal(must(await O.get('/api/crediti/riconciliazione?stato=DA_ABBINARE&tipo=BONIFICO'), 'bonifici').righe.length, 0);
    assert.equal(must(await O.get('/api/crediti/riconciliazione?stato=DA_ABBINARE&tipo=INVENTATO'), 'tipo non valido').righe.length, 3);
  });
});
