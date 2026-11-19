// v0.87.0 · Orders Management, giacenza mensile: annulla, rendi di nuovo modificabile, elimina (solo Superadmin).
// Gli effetti della conferma si stornano: rettifiche delle confezioni e ordine generato non ancora approvato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Giacenza mensile: annulla, riapri, elimina', { skip: SALTA }, () => {
  let H, S, db, O, sede, a1, a2, cid;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o; sede = D.site.pp1;
    assert.equal((await O.post('/api/travaso/orders/run')).s, 200);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('PROVA','Prova') ON CONFLICT DO NOTHING`);
    const a = async (code) => (await db.query(`INSERT INTO orders.articles (code, category_code, name, unit, pack_size, pack_label) VALUES ($1,'PROVA',$2,'pz',100,'Confezione da 100') RETURNING id`, [code, `Articolo di prova ${code}`])).rows[0].id;
    a1 = await a('ANN-1'); a2 = await a('ANN-2');
    for (let i = 0; i < 5; i++) await db.query(`INSERT INTO orders.packages (struttura_id, article_id, seq, status, origin, received_at) VALUES ($1,$2,$3,'RICEVUTO','INIZIALE',now())`, [sede, a1, i + 1]);
    for (let i = 0; i < 2; i++) await db.query(`INSERT INTO orders.packages (struttura_id, article_id, seq, status, origin, received_at) VALUES ($1,$2,$3,'RICEVUTO','INIZIALE',now())`, [sede, a2, i + 1]);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const inGiacenza = async (art) => (await db.query(`SELECT count(*)::int AS n FROM orders.packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO'`, [sede, art])).rows[0].n;
  const apri = async () => { const r = await O.post('/api/orders/stock/counts/open', { struttura_id: sede }); assert.equal(r.s, 200, r.text); return r.j.id; };
  const conferma = async (q1, q2) => {
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: a1, counted_qty: q1 }, { article_id: a2, counted_qty: q2 }] })).s, 200);
    const r = await O.post(`/api/orders/stock/counts/${cid}/confirm`); assert.equal(r.s, 200, r.text); return r.j;
  };
  const ordine = async (id) => (await db.query('SELECT status, cancel_reason FROM orders.orders WHERE id=$1', [id])).rows[0];
  const giacenza = async () => (await O.get(`/api/orders/stock/counts/${cid}`)).j;

  test('riapri: rettifiche stornate, ordine non approvato annullato, giacenza di nuovo modificabile', async () => {
    cid = await apri();
    const c = await conferma(3, 6);                    // a1: 5 → 3 (due tolte), a2: 2 → 6 (quattro aggiunte)
    assert.equal(await inGiacenza(a1), 3); assert.equal(await inGiacenza(a2), 6);
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: a1, counted_qty: 1 }] })).s, 400, 'confermata: non modificabile');
    const r = await O.post(`/api/orders/stock/counts/${cid}/reopen`, { motivo: 'contate le unità invece delle confezioni' });
    assert.equal(r.s, 200, r.text);
    assert.equal(r.j.tornate_in_giacenza, 2); assert.equal(r.j.tolte_dalla_giacenza, 4); assert.equal(r.j.gia_usate, 0); assert.equal(r.j.ordine.esito, 'ANNULLATO');
    assert.equal(await inGiacenza(a1), 5); assert.equal(await inGiacenza(a2), 2);
    const o = await ordine(c.orderId); assert.equal(o.status, 'ANNULLATO'); assert.match(o.cancel_reason, /riaperta/);
    const g = await giacenza();
    assert.equal(g.status, 'BOZZA'); assert.equal(g.order_id, null); assert.equal(g.confirmed_at, null);
    const l1 = g.lines.find((l) => l.article_id === a1); assert.equal(l1.system_qty, 5, 'giacenza teorica ricalcolata'); assert.equal(l1.counted_qty, 3, 'la quantità dichiarata resta');
    assert.equal((await O.post(`/api/orders/stock/counts/${cid}/reopen`, {})).s, 400, 'già modificabile');
  });

  test('riconferma dopo la riapertura: nuovo ordine, nessuna rettifica doppia', async () => {
    const c = await conferma(4, 2);
    assert.equal(await inGiacenza(a1), 4); assert.equal(await inGiacenza(a2), 2);
    assert.equal((await ordine(c.orderId)).status, 'INVIATO');
  });

  test('annulla: motivo obbligatorio, giacenza annullata e bloccata, poi riapribile', async () => {
    assert.equal((await O.post(`/api/orders/stock/counts/${cid}/cancel`, {})).s, 400);
    const r = await O.post(`/api/orders/stock/counts/${cid}/cancel`, { motivo: 'giacenza inserita per errore' });
    assert.equal(r.s, 200, r.text); assert.equal(r.j.tornate_in_giacenza, 1); assert.equal(r.j.ordine.esito, 'ANNULLATO');
    assert.equal(await inGiacenza(a1), 5);
    const g = await giacenza(); assert.equal(g.status, 'ANNULLATO'); assert.equal(g.cancel_reason, 'giacenza inserita per errore');
    assert.equal((await O.put(`/api/orders/stock/counts/${cid}`, { lines: [{ article_id: a1, counted_qty: 1 }] })).s, 400, 'annullata: non modificabile');
    assert.equal((await O.post(`/api/orders/stock/counts/${cid}/confirm`)).s, 400, 'annullata: non confermabile');
    assert.equal((await O.post(`/api/orders/stock/counts/${cid}/cancel`, { motivo: 'di nuovo' })).s, 400);
    assert.equal(await apri(), cid, 'apri la giacenza del mese non ne crea una seconda');
    assert.equal((await giacenza()).status, 'ANNULLATO', 'e non la riapre da sola');
    assert.equal((await O.post(`/api/orders/stock/counts/${cid}/reopen`, {})).s, 200);
    assert.equal((await giacenza()).status, 'BOZZA');
  });

  test('ordine già approvato: non si tocca; confezioni della rettifica già usate: restano', async () => {
    const c = await conferma(5, 4);                    // a2: 2 → 4 (due aggiunte)
    await db.query(`UPDATE orders.orders SET status='APPROVATO' WHERE id=$1`, [c.orderId]);
    await db.query(`UPDATE orders.packages SET status='IN_USO', used_at=now() WHERE id=(SELECT id FROM orders.packages WHERE struttura_id=$1 AND article_id=$2 AND origin='RETTIFICA' AND status='RICEVUTO' LIMIT 1)`, [sede, a2]);
    const r = await O.del(`/api/orders/stock/counts/${cid}`);
    assert.equal(r.s, 200, r.text);
    assert.equal(r.j.tolte_dalla_giacenza, 1); assert.equal(r.j.gia_usate, 1); assert.equal(r.j.ordine.esito, 'NON_TOCCATO');
    assert.equal((await ordine(c.orderId)).status, 'APPROVATO');
    assert.equal((await O.get(`/api/orders/stock/counts/${cid}`)).s, 404, 'eliminata');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders.stock_count_lines WHERE count_id=$1', [cid])).rows[0].n, 0);
    assert.equal(await inGiacenza(a2), 2);
    const nuova = await apri(); assert.notEqual(nuova, cid, 'dopo l\'eliminazione il mese si può rifare');
    assert.equal((await O.del(`/api/orders/stock/counts/${nuova}`)).s, 200, 'una bozza si elimina senza effetti');
  });

  test('solo il Superadmin del modulo: l\'Area Operations non annulla, non riapre e non elimina', async () => {
    const id = await apri();
    const bcrypt = (await import('bcryptjs')).default;
    const PW = 'Prova-Giacenza-2026!';
    const uid = (await db.query(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, password_hash, must_change_password, is_external)
      VALUES ('ops.giacenza@example.test','Prova Operations','Prova','Operations','USER','ACTIVE','BOTH',$1,false,false) RETURNING id`, [await bcrypt.hash(PW, 10)])).rows[0].id;
    await db.query(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,'orders','PROCUREMENT','MANUAL')`, [uid]);
    const P = await H.entra(H.client(S.base), 'ops.giacenza@example.test', PW, PW);
    assert.equal((await P.get(`/api/orders/stock/counts/${id}`)).s, 200, 'la vede');
    assert.equal((await P.del(`/api/orders/stock/counts/${id}`)).s, 403);
    assert.equal((await P.post(`/api/orders/stock/counts/${id}/cancel`, { motivo: 'prova' })).s, 403);
    assert.equal((await P.post(`/api/orders/stock/counts/${id}/reopen`, {})).s, 403);
  });
});
