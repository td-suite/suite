// v0.78.0 · Orders Management, giacenza mensile: più lotti con scadenze diverse per lo stesso articolo (riga replicata).
// Il totale dell'articolo resta il dato di rettifiche e riordino; salvataggi senza `lots` (comportamento precedente) non perdono i lotti.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Giacenza mensile con più lotti per articolo', { skip: SALTA }, () => {
  let H, S, db, O, sede, art, altro, cid;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o; sede = D.site.pp1;
    assert.equal((await O.post('/api/travaso/orders/run')).s, 200);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('PROVA','Prova') ON CONFLICT DO NOTHING`);
    const a = async (code) => (await db.query(`INSERT INTO orders.articles (code, category_code, name, unit, pack_size, pack_label) VALUES ($1,'PROVA',$2,'pz',100,'Confezione da 100') RETURNING id`, [code, `Provetta di prova ${code}`])).rows[0].id;
    art = await a('LOTTI-1'); altro = await a('LOTTI-2');
    // 5 confezioni a sistema del primo articolo, 2 del secondo: così entrambi entrano nell'elenco della sede
    for (let i = 0; i < 5; i++) await db.query(`INSERT INTO orders.packages (struttura_id, article_id, seq, status, origin, received_at) VALUES ($1,$2,$3,'RICEVUTO','INIZIALE',now())`, [sede, art, i + 1]);
    for (let i = 0; i < 2; i++) await db.query(`INSERT INTO orders.packages (struttura_id, article_id, seq, status, origin, received_at) VALUES ($1,$2,$3,'RICEVUTO','INIZIALE',now())`, [sede, altro, i + 1]);
    const ap = await O.post('/api/orders/stock/counts/open', { struttura_id: sede });
    assert.equal(ap.s, 200, ap.text); cid = ap.j.id;
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const riga = async (id = art) => (await O.get(`/api/orders/stock/counts/${cid}`)).j.lines.find((l) => l.article_id === id);

  test('riga replicata: tre lotti con scadenze diverse, totale = somma', async () => {
    const r0 = await riga();
    assert.equal(r0.system_qty, 5); assert.equal(r0.counted_qty, 5); assert.deepEqual(r0.lots, []); assert.equal(r0.first_qty, 5);
    const s = await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 3, lot: 'L-AAA', expiry: '2027-01-31',
      lots: [{ qty: 2, lot: 'L-BBB', expiry: '2027-06-30' }, { qty: 4, lot: 'L-CCC', expiry: '2028-02-29' }, { qty: 0, lot: '', expiry: '' }] }] });
    assert.equal(s.s, 200, s.text);
    const r = await riga();
    assert.equal(r.counted_qty, 9, 'totale dell\'articolo'); assert.equal(r.first_qty, 3); assert.equal(r.lot, 'L-AAA'); assert.equal(String(r.expiry).slice(0, 10), '2027-01-31');
    assert.deepEqual(r.lots.map((x) => [x.qty, x.lot, String(x.expiry).slice(0, 10)]), [[2, 'L-BBB', '2027-06-30'], [4, 'L-CCC', '2028-02-29']], 'la replica vuota non si salva');
    assert.equal((await riga(altro)).counted_qty, 2, 'gli altri articoli non cambiano');
  });

  test('un salvataggio senza lots (vecchio formato) non perde i lotti e ricalcola il totale', async () => {
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 1 }] })).s, 200);
    const r = await riga();
    assert.equal(r.lots.length, 2); assert.equal(r.first_qty, 1); assert.equal(r.counted_qty, 7); assert.equal(r.lot, 'L-AAA');
  });

  test('togliere le repliche riporta la riga unica; quantità non valide rifiutate', async () => {
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 3, lots: [{ qty: -1 }] }] })).s, 400);
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 6, lot: 'L-AAA', lots: [] }] })).s, 200);
    const r = await riga();
    assert.deepEqual(r.lots, []); assert.equal(r.counted_qty, 6); assert.equal(r.first_qty, 6);
    // di nuovo due lotti per la conferma: 3 + 4 = 7 contro 5 a sistema
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 3, lot: 'L-AAA', expiry: '2027-01-31', lots: [{ qty: 4, lot: 'L-CCC', expiry: '2028-02-29' }] }] })).s, 200);
  });

  test('conferma: la rettifica usa il totale dell\'articolo e la giacenza confermata conserva i lotti', async () => {
    const c = await O.post(`/api/orders/stock/counts/${cid}/confirm`);
    assert.equal(c.s, 200, c.text); assert.equal(c.j.adjusted, 2, 'da 5 a 7 confezioni');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO'`, [sede, art])).rows[0].n, 7);
    assert.equal((await db.query(`SELECT stock_packs FROM orders.order_lines WHERE order_id=$1 AND article_id=$2`, [c.j.orderId, art])).rows[0].stock_packs, 7);
    const r = await riga();
    assert.equal(r.lots.length, 1); assert.equal(r.lots[0].lot, 'L-CCC');
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: art, counted_qty: 1, lots: [] }] })).s, 400, 'confermata: non si modifica');
  });
});
