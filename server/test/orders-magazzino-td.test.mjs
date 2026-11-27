// v0.99.14 · Magazzino TD (CEO, 28/11/2026): articoli interni mai a Silva; l'ordine misto si divide all'approvazione; l'ordine TD parte
// per email verso acquisti@; la giacenza scala all'uscita verso il destinatario; gestione dell'Area Operations.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Magazzino TD: regola pura della divisione', () => {
  let T;
  before(async () => { T = await import('../src/modules/orders/lib/magazzinoTd.js'); });
  test('solo Silva, solo TD, misto; le righe a zero non decidono', () => {
    assert.deepEqual(T.canaleOrdine([{ id: 1, source: 'SILVA', qty: 2 }]), { canale: 'SILVA', td: [] });
    assert.deepEqual(T.canaleOrdine([{ id: 1, source: 'TD', qty: 2 }, { id: 2, source: 'SILVA', qty: 0 }]), { canale: 'TD', td: [1] });
    assert.deepEqual(T.canaleOrdine([{ id: 1, source: 'TD', qty: 2 }, { id: 2, source: 'SILVA', qty: 1 }, { id: 3, source: 'TD', qty: 0 }]), { canale: 'MISTO', td: [1, 3] });
    assert.deepEqual(T.canaleOrdine([{ id: 1, source: 'TD', qty: 0 }, { id: 2, source: 'SILVA', qty: 1 }]), { canale: 'SILVA', td: [] });
  });
});

describe('Magazzino TD: articoli, divisione dell\'ordine, email, uscita e giacenza', { skip: SALTA }, () => {
  let H, S, db, O, sede, id = {};
  const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const giacenza = async (aid) => (await O.get('/api/orders/td')).j.articoli.find((a) => a.id === aid);
  const ordine = async (righe) => {
    const r = await O.post('/api/orders/orders', { struttura_id: sede, submit: true, lines: righe.map(([article_id, qty]) => ({ article_id, qty })) });
    assert.equal(r.s, 201, r.text); return r.j.id;
  };
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o; sede = D.site.pp1;
    assert.equal((await O.post('/api/travaso/orders/run')).s, 200);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('PROVA','Prova') ON CONFLICT DO NOTHING`);
    id.silva = (await uno(`INSERT INTO orders.articles (code, silva_code, category_code, name, unit, pack_size, pack_label, source, visible_all) VALUES ('SILVA-9','SILVA-9','PROVA','Provetta Silva','pz',100,'Confezione da 100','SILVA',TRUE) RETURNING id`)).id;
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('articolo interno: codice assegnato, giacenza iniziale, carico e rettifica; fuori dal Magazzino Centrale, dentro "Nuovo ordine"', async () => {
    const r = await O.post('/api/orders/td/articoli', { name: 'Modulistica consenso', unit: 'blocchi', pack_size: 10, pack_label: 'Pacco da 10 blocchi', min_stock_packs: 8, giacenza_iniziale: 10 });
    assert.equal(r.s, 201, r.text); assert.equal(r.j.code, 'TD-0001'); id.td = r.j.id;
    assert.equal((await O.post('/api/orders/td/articoli', { name: 'modulistica CONSENSO', unit: 'blocchi', pack_size: 10, pack_label: 'x' })).s, 400, 'stesso nome');
    let g = await giacenza(id.td);
    assert.deepEqual([g.giacenza, g.impegnate, g.code], [10, 0, 'TD-0001']);
    assert.equal((await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'CARICO', qty: 5, lot: 'L1' })).s, 201);
    assert.equal((await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'RETTIFICA', qty: -3 })).s, 400, 'rettifica senza motivo');
    assert.equal((await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'RETTIFICA', qty: -50, note: 'inventario' })).s, 400, 'mai sotto zero');
    assert.equal((await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'RETTIFICA', qty: -5, note: 'inventario' })).s, 201);
    assert.equal((await O.post('/api/orders/td/movimenti', { article_id: id.silva, kind: 'CARICO', qty: 1 })).s, 400, 'un articolo Silva non entra nel Magazzino TD');
    g = await giacenza(id.td); assert.equal(g.giacenza, 10);
    const centrale = (await O.get('/api/orders/warehouse')).j.rows.map((x) => x.code);
    assert.ok(centrale.includes('SILVA-9') && !centrale.includes('TD-0001'));
    assert.ok((await O.get('/api/orders/articles')).j.some((a) => a.code === 'TD-0001'), 'ordinabile');
  });

  test('ordine misto: si divide, la parte TD va per email ad acquisti@ e non a Silva; contatore del menu', async () => {
    id.misto = await ordine([[id.silva, 2], [id.td, 6]]);
    const a = await O.post(`/api/orders/orders/${id.misto}/approve`);
    assert.equal(a.s, 200, a.text + S.log().split('\n').filter((l) => /rror/.test(l)).slice(-6).join('\n'));
    assert.equal(a.j.canale, 'SILVA');
    const padre = await uno('SELECT number, channel, status FROM orders.orders WHERE id=$1', [id.misto]);
    assert.equal(a.j.ordine_td.number, `${padre.number}-TD`); id.figlio = a.j.ordine_td.id;
    const figlio = await uno('SELECT channel, status, parent_order_id, pdf IS NOT NULL AS pdf FROM orders.orders WHERE id=$1', [id.figlio]);
    assert.deepEqual([padre.channel, padre.status, figlio.channel, figlio.status, figlio.parent_order_id, figlio.pdf], ['SILVA', 'APPROVATO', 'TD', 'APPROVATO', id.misto, true]);
    const righe = async (oid) => (await db.query('SELECT article_id, qty_approved FROM orders.order_lines WHERE order_id=$1', [oid])).rows.map((x) => [x.article_id, x.qty_approved]);
    assert.deepEqual([await righe(id.misto), await righe(id.figlio)], [[[id.silva, 2]], [[id.td, 6]]]);
    const mail = await uno(`SELECT to_addr, subject, body, attachment_name FROM orders.email_log WHERE kind='ORDINE_MAGAZZINO_TD' AND ref_key=$1`, [`TD:${id.figlio}`]);
    assert.equal(mail.to_addr, 'acquisti@toscanadiagnostica.it');
    assert.match(mail.subject, /-TD · Magazzino TD/); assert.match(mail.body, /6 × Modulistica consenso \(TD-0001/); assert.equal(mail.attachment_name, `${padre.number}-TD.pdf`);
    const b = (await O.get('/api/orders/badges')).j;
    assert.deepEqual([b.trasmissione, b.magazzino_td], [1, 1]);
    const g = await giacenza(id.td);
    assert.deepEqual([g.giacenza, g.impegnate], [10, 6], 'approvare non scala: impegna');
    const push = await O.post(`/api/orders/orders/${id.figlio}/silva-push`, { conferma: true });
    assert.ok(!push.j.ok, 'l\'ordine TD non si trasmette a Silva');
  });

  test('la giacenza scala all\'uscita: non prima, mai oltre giacenza e approvato, una volta sola; la consegna porta le quantità uscite', async () => {
    assert.equal((await O.post(`/api/orders/orders/${id.figlio}/delivered`, {})).s, 400, 'consegna senza uscita');
    assert.equal((await O.post(`/api/orders/orders/${id.figlio}/arrivato`, {})).s, 400);
    const linea = (await uno('SELECT id FROM orders.order_lines WHERE order_id=$1', [id.figlio])).id;
    assert.equal((await O.post(`/api/orders/td/ordini/${id.figlio}/uscita`, { lines: [{ line_id: linea, qty: 7 }] })).s, 400, 'più dell\'approvato');
    assert.equal((await O.post(`/api/orders/td/ordini/${id.misto}/uscita`, {})).s, 400, 'l\'ordine Silva non esce dal Magazzino TD');
    await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'RETTIFICA', qty: -7, note: 'prova' });   // restano 3
    const poco = await O.post(`/api/orders/td/ordini/${id.figlio}/uscita`, {});
    assert.equal(poco.s, 400); assert.match(poco.text, /Giacenza insufficiente/);
    await O.post('/api/orders/td/movimenti', { article_id: id.td, kind: 'CARICO', qty: 7 });   // di nuovo 10
    const u = await O.post(`/api/orders/td/ordini/${id.figlio}/uscita`, { lines: [{ line_id: linea, qty: 4 }], ddt: 'DDT-1' });
    assert.equal(u.s, 200, u.text); assert.deepEqual([u.j.status, u.j.confezioni, u.j.parziali.length], ['SPEDITO', 4, 1]);
    const g = await giacenza(id.td);
    assert.deepEqual([g.giacenza, g.impegnate], [6, 0]);
    assert.equal((await O.post(`/api/orders/td/ordini/${id.figlio}/uscita`, {})).s, 400, 'una volta sola');
    const d = await O.post(`/api/orders/orders/${id.figlio}/delivered`, {});
    assert.equal(d.s, 200, d.text);
    assert.equal((await uno('SELECT count(*)::int AS n FROM orders.packages WHERE order_id=$1', [id.figlio])).n, 4, 'confezioni consegnate = uscite');
    assert.equal((await giacenza(id.td)).giacenza, 6, 'la consegna non scala una seconda volta');
    const mov = (await O.get(`/api/orders/td/movimenti?article_id=${id.td}`)).j;
    assert.deepEqual(mov.filter((m) => m.kind === 'USCITA').map((m) => [m.qty, m.order_id]), [[-4, id.figlio]]);
  });

  test('ordine di soli articoli interni: nessuna divisione, canale TD', async () => {
    const oid = await ordine([[id.td, 1]]);
    const a = await O.post(`/api/orders/orders/${oid}/approve`);
    assert.equal(a.s, 200, a.text); assert.deepEqual([a.j.canale, a.j.ordine_td], ['TD', null]);
    assert.equal((await uno('SELECT channel FROM orders.orders WHERE id=$1', [oid])).channel, 'TD');
    assert.ok(await uno(`SELECT 1 FROM orders.email_log WHERE ref_key=$1`, [`TD:${oid}`]));
    const el = (await O.get('/api/orders/td')).j.ordini;
    assert.deepEqual(el.filter((o) => o.status !== 'SPEDITO').map((o) => o.id), [oid]);
    const r = await O.post(`/api/orders/td/ordini/${oid}/email`);
    assert.equal(r.s, 200); assert.equal(r.j.to, 'acquisti@toscanadiagnostica.it');
  });
});
