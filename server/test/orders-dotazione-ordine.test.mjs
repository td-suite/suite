// v0.83.0 · Orders, Dotazione di avvio: "Genera ordine" dalla scheda Modelli. Scelta la struttura, il piano riparte dal modello e
// nasce l'ordine in bozza; niente contatore sul menu. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Dotazione di avvio: ordine generato dal modello', { skip: SALTA }, () => {
  let H, S, db, O, sede, a1, a2;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o; sede = D.site.pp1;
    assert.equal((await O.post('/api/travaso/orders/run')).s, 200);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('PROVA','Prova') ON CONFLICT DO NOTHING`);
    const a = async (code) => (await db.query(`INSERT INTO orders.articles (code, silva_code, source, category_code, name, unit, pack_size, pack_label, visible_all) VALUES ($1,$1,'SILVA','PROVA',$2,'Cf',1,'confezione',TRUE) RETURNING id`, [code, `Articolo di prova ${code}`])).rows[0].id;
    a1 = await a('DOT-1'); a2 = await a('DOT-2');
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('modello vuoto: errore chiaro, nessun ordine', async () => {
    const r = await O.post('/api/orders/dotazione/modelli/PUNTO_PRELIEVI/ordine', { struttura_id: sede });
    assert.equal(r.s, 400); assert.match(r.text, /modello.*vuoto/i);
  });

  test('ordine in bozza con le righe del modello, piano pianificato, non ripetibile; menu senza contatore', async () => {
    assert.equal((await O.post('/api/orders/dotazione/modelli/PUNTO_PRELIEVI/righe', { article_id: a1, packs: 3, note: '300 provette' })).s, 201);
    assert.equal((await O.post('/api/orders/dotazione/modelli/PUNTO_PRELIEVI/righe', { article_id: a2, packs: 5 })).s, 201);
    const sedi = (await O.get('/api/orders/dotazione/sedi')).j.rows;
    const riga = sedi.find((x) => x.id === sede);
    assert.equal(riga.tipologia, 'PUNTO_PRELIEVI');
    assert.equal((await O.post('/api/orders/dotazione/modelli/LABORATORIO/ordine', { struttura_id: sede })).s, 400, 'tipologia diversa dal modello');
    const r = await O.post('/api/orders/dotazione/modelli/PUNTO_PRELIEVI/ordine', { struttura_id: sede });
    assert.equal(r.s, 201, r.text); assert.equal(r.j.righe, 2); assert.ok(r.j.number);
    const d = (await O.get(`/api/orders/dotazione/sedi/${sede}`)).j;
    assert.equal(d.struttura.stato, 'PIANIFICATA'); assert.equal(d.struttura.order_id, r.j.id);
    assert.deepEqual(d.lines.map((l) => [l.article_id, l.packs_planned]).sort(), [[a1, 3], [a2, 5]].sort());
    const o = (await db.query('SELECT status, (SELECT count(*)::int FROM orders.order_lines l WHERE l.order_id=o.id) AS n FROM orders.orders o WHERE id=$1', [r.j.id])).rows[0];
    assert.equal(o.status, 'BOZZA'); assert.equal(o.n, 2);
    assert.equal((await O.post('/api/orders/dotazione/modelli/PUNTO_PRELIEVI/ordine', { struttura_id: sede })).s, 409, 'un solo ordine di dotazione per struttura');
    assert.equal((await O.get('/api/orders/badges')).j.dotazione, 0);
  });
});
