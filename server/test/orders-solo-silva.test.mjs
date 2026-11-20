// v0.91.2 · Ordini e Magazzino (CEO, 20/11/2026): "elimina articoli creati da zero; devono vedersi solo quelli sincronizzati con Silva;
// permetti in ogni caso di creare articoli". Migrazione 020 (una tantum): i non Silva senza dati si eliminano, quelli usati si
// disattivano e spariscono da ogni elenco; gli articoli creati a mano dopo restano visibili e ordinabili.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SALTA = !process.env.DATABASE_URL_TEST;
const SQL = fs.readFileSync(new URL('../src/modules/orders/migrations/020_solo_silva.sql', import.meta.url), 'utf8');

describe('Ordini: catalogo solo Silva, creazione a mano sempre possibile', { skip: SALTA }, () => {
  let H, S, db, O, sede, id = {};
  const migra = async () => { await db.query('BEGIN'); await db.query('SET LOCAL search_path = orders, public'); await db.query(SQL); await db.query('COMMIT'); };
  const codici = async (url, campo = 'code') => { const r = await O.get(url); assert.equal(r.s, 200, r.text); return (Array.isArray(r.j) ? r.j : r.j.rows).map((x) => x[campo]); };
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o; sede = D.site.pp1;
    assert.equal((await O.post('/api/travaso/orders/run')).s, 200);
    await db.query(`INSERT INTO orders.categories (code, name) VALUES ('PROVA','Prova') ON CONFLICT DO NOTHING`);
    const a = async (code, source, extra = '') => (await db.query(`INSERT INTO orders.articles (code, category_code, name, unit, pack_size, pack_label, source, visible_all ${extra ? ', silva_code' : ''})
      VALUES ($1,'PROVA',$2,'pz',100,'Confezione da 100',$3,TRUE ${extra ? `, '${extra}'` : ''}) RETURNING id`, [code, `Articolo ${code}`, source])).rows[0].id;
    id.libero = await a('MANO-LIBERO', 'MANUALE'); id.usato = await a('MANO-USATO', 'MOD252'); id.modello = await a('MANO-MODELLO', 'MANUALE');
    await db.query(`INSERT INTO orders.packages (struttura_id, article_id, seq, status, origin, received_at) VALUES ($1,$2,1,'RICEVUTO','INIZIALE',now())`, [sede, id.usato]);
    await db.query(`INSERT INTO orders.startup_template_lines (kind, article_id, packs) VALUES ('PUNTO_PRELIEVI', $1, 2)`, [id.modello]);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('senza catalogo Silva la pulizia non tocca nulla', async () => {
    await migra();
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.articles WHERE code LIKE 'MANO-%' AND active`)).rows[0].n, 3);
    assert.equal((await db.query(`SELECT data->>'saltata' AS s FROM orders.audit_log WHERE action='CATALOGO_SOLO_SILVA' ORDER BY id DESC LIMIT 1`)).rows[0].s, 'true');
  });

  test('con il catalogo Silva: non usati eliminati, usati disattivati e nascosti; gli articoli Silva non cambiano', async () => {
    id.silva = (await db.query(`INSERT INTO orders.articles (code, silva_code, category_code, name, unit, pack_size, pack_label, source, visible_all) VALUES ('SILVA-1','SILVA-1','PROVA','Provetta Silva','pz',100,'Confezione da 100','SILVA',TRUE) RETURNING id`)).rows[0].id;
    await migra();
    const rimasti = (await db.query(`SELECT code, active, source FROM orders.articles ORDER BY code`)).rows;
    assert.deepEqual(rimasti.map((r) => [r.code, r.active]), [['MANO-USATO', false], ['SILVA-1', true]], 'libero e del modello eliminati; usato disattivato');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.startup_template_lines WHERE article_id=$1`, [id.modello])).rows[0].n, 0);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.packages WHERE article_id=$1`, [id.usato])).rows[0].n, 1, 'lo storico resta');
    const log = (await db.query(`SELECT data FROM orders.audit_log WHERE action='CATALOGO_SOLO_SILVA' ORDER BY id DESC LIMIT 1`)).rows[0].data;
    assert.equal(log.eliminati, 2); assert.equal(log.disattivati, 1); assert.equal(log.articoli.length, 3);
    // nessun elenco mostra più l'articolo non Silva disattivato: catalogo ordinabile, elenco completo, Magazzino Centrale, giacenza di sede
    assert.deepEqual(await codici('/api/orders/articles'), ['SILVA-1']);
    assert.deepEqual(await codici('/api/orders/articles?all=1'), ['SILVA-1']);
    assert.deepEqual(await codici('/api/orders/warehouse'), ['SILVA-1']);
    const st = await O.get(`/api/orders/stock?struttura_id=${sede}`); assert.equal(st.s, 200, st.text);
    assert.ok(!JSON.stringify(st.j).includes('MANO-USATO'));
    await migra();
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.articles`)).rows[0].n, 2, 'rieseguirla non cambia nulla');
  });

  test('creare un articolo resta possibile: nasce "a mano", si vede e si può ordinare', async () => {
    const c = await O.post('/api/orders/articles', { code: 'NUOVO-1', category_code: 'PROVA', name: 'Articolo nuovo', unit: 'pz', pack_size: 10, pack_label: 'Confezione da 10', visible_all: true });
    assert.equal(c.s, 201, c.text);
    assert.equal((await db.query(`SELECT source FROM orders.articles WHERE id=$1`, [c.j.id])).rows[0].source, 'MANUALE');
    assert.deepEqual(await codici('/api/orders/articles'), ['SILVA-1', 'NUOVO-1']);
    const w = (await O.get('/api/orders/warehouse')).j.rows.find((x) => x.code === 'NUOVO-1');
    assert.equal(w.ordinabile, true); assert.equal(w.non_ordinabile_motivo, null);
    // un articolo Silva disattivato resta nell'elenco completo (si riattiva da lì); non nel catalogo ordinabile
    await db.query(`UPDATE orders.articles SET active=FALSE WHERE code='SILVA-1'`);
    assert.deepEqual(await codici('/api/orders/articles'), ['NUOVO-1']);
    assert.deepEqual((await codici('/api/orders/articles?all=1')).sort(), ['NUOVO-1', 'SILVA-1']);
    assert.equal((await O.post('/api/orders/warehouse/pulizia-non-silva', { dry_run: false })).s, 404, 'la vecchia pulizia non esiste più: cancellerebbe i nuovi articoli');
  });
});
