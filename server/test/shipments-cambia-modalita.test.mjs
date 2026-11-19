// v0.87.0 · Shipments: cambio di modalità di una richiesta Endeavor già spedita (da Standard a Express e simili), senza annullare
// la richiesta né scartare il kit. Cambiano modalità, servizio delle tratte e tariffa; parte la rettifica ad Affinity.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Shipments: cambia modalità dopo la spedizione', { skip: SALTA }, () => {
  let H, S, db, O, M, oid, n = 0;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o;
    // Shipments non parte vuoto (riceve i dati con il travaso dall'app originale): qui lo schema si crea dalle sue migrazioni e il
    // modulo si mette LIVE a mano, come fa il travaso dopo la copia.
    const fs = await import('node:fs'); const path = await import('node:path'); const url = await import('node:url');
    const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../src/modules/shipments/migrations');
    await db.query('CREATE SCHEMA IF NOT EXISTS shipments'); await db.query('SET search_path = shipments, public');
    await db.query('CREATE TABLE IF NOT EXISTS shipments.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) { await db.query(fs.readFileSync(path.join(dir, f), 'utf8')); await db.query('INSERT INTO shipments.schema_migrations(name) VALUES ($1)', [f]); }
    await db.query('SET search_path = public');
    await db.query(`INSERT INTO public.module_state (key, schema_ready, mode, live_since) VALUES ('shipments', true, 'LIVE', now()) ON CONFLICT (key) DO UPDATE SET schema_ready=true, mode='LIVE', live_since=now()`);
    const mm = await O.get('/api/shipments/modes'); assert.equal(mm.s, 200, mm.text);
    M = Object.fromEntries(mm.j.map((m) => [m.code, m]));
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const spedita = async (modo, extra = {}) => {
    n++; const bc = `EDTEST00000${n}IT`;
    const lot = await O.post('/api/shipments/kits/lots', { project: 'ENDEAVOR', received_at: '2026-11-01', barcodes: [bc] }); assert.equal(lot.s, 201, lot.text);
    const c = await O.post('/api/shipments/orders', { project: 'ENDEAVOR', order_type: 'ENDEAVOR', external_ref: bc, shipping_mode_id: M[modo].id, patient_first_name: 'Prova', patient_last_name: 'Destinatario', address1: 'Via di prova 1', city: 'Firenze', barcode: bc });
    assert.equal(c.s, 201, c.text);
    if (c.j.status === 'NEW') assert.equal((await O.post(`/api/shipments/orders/${c.j.id}/assign`, { barcode: bc })).s, 200);
    const s = await O.post(`/api/shipments/orders/${c.j.id}/ship`, { outbound_tracking: `1C000000000${n}`, ...extra }); assert.equal(s.s, 200, s.text);
    return c.j.id;
  };
  const tratte = (o) => o.shipments.map((s) => `${s.direction}/${s.service}`).sort().join(' ');
  const mail = async (id) => (await db.query(`SELECT kind, subject, body FROM shipments.email_log WHERE order_id=$1 AND kind='AFFINITY_MODE' ORDER BY id`, [id])).rows;

  test('da Standard a Express in andata: stesso kit e stessa lettera di vettura, servizio e tariffa aggiornati, rettifica ad Affinity', async () => {
    oid = await spedita('STD_OUT');
    const prima = (await O.get(`/api/shipments/orders/${oid}`)).j;
    assert.equal(prima.status, 'SHIPPED'); assert.equal(Number(prima.fee_shipping), 6.8); assert.equal(tratte(prima), 'OUTBOUND/STANDARD');
    assert.equal((await O.put(`/api/shipments/orders/${oid}`, { shipping_mode_id: M.EXP_OUT.id })).s, 400, 'la Modifica normale resta bloccata dopo la spedizione');
    const r = await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_OUT.id, motivo: 'richiesta del cliente' });
    assert.equal(r.s, 200, r.text);
    const o = r.j;
    assert.equal(o.status, 'SHIPPED'); assert.equal(o.mode_code, 'EXP_OUT'); assert.equal(Number(o.fee_shipping), 9.9); assert.equal(tratte(o), 'OUTBOUND/EXPRESS');
    assert.equal(o.kit_status, 'SHIPPED'); assert.equal(o.barcode, prima.barcode);
    assert.equal(o.shipments[0].tracking_number, prima.shipments[0].tracking_number); assert.equal(o.shipments[0].id, prima.shipments[0].id);
    assert.ok(o.events.some((e) => e.event === 'MODE_CHANGED' && e.data.from === 'STD_OUT' && e.data.to === 'EXP_OUT'));
    const m = await mail(oid); assert.equal(m.length, 1);
    assert.match(m[0].body, /Previous mode: .*Standard/i); assert.match(m[0].body, /New mode: .*Express/i); assert.match(m[0].body, new RegExp(prima.shipments[0].tracking_number));
  });

  test('stessa modalità rifiutata; senza comunicazione se richiesto; il ritorno si aggiunge e si toglie', async () => {
    assert.equal((await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_OUT.id })).s, 400);
    let r = await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_OUT_EXP_RET.id, notifica: false });
    assert.equal(r.s, 200, r.text); assert.equal(tratte(r.j), 'OUTBOUND/EXPRESS RETURN/EXPRESS'); assert.equal(Number(r.j.fee_shipping), 19.8);
    assert.equal((await mail(oid)).length, 1, 'nessuna nuova email');
    r = await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.STD_OUT_EXP_RET.id, notifica: false });
    assert.equal(r.s, 200, r.text); assert.equal(tratte(r.j), 'OUTBOUND/STANDARD RETURN/EXPRESS');
    r = await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.STD_OUT.id, notifica: false });
    assert.equal(r.s, 200, r.text); assert.equal(tratte(r.j), 'OUTBOUND/STANDARD'); assert.equal(Number(r.j.fee_shipping), 6.8);
  });

  test('l\'andata è un fatto avvenuto: non si passa a una modalità senza andata; ritorno già in viaggio non si toglie', async () => {
    assert.equal((await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_RET.id })).s, 400);
    await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.STD_OUT_STD_RET.id, notifica: false });
    await db.query(`UPDATE shipments.shipments SET last_status='IN_TRANSIT' WHERE order_id=$1 AND direction='RETURN'`, [oid]);
    const r = await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_OUT.id });
    assert.equal(r.s, 400); assert.match(r.text, /ritorno/);
    assert.equal((await O.post(`/api/shipments/orders/${oid}/mode`, { shipping_mode_id: M.EXP_OUT_EXP_RET.id, notifica: false })).s, 200, 'cambiare il servizio del ritorno resta possibile');
  });

  test('periodo di rendicontazione chiuso e richiesta annullata: modalità non più modificabile', async () => {
    const id = await spedita('STD_OUT');
    const p = (await db.query(`INSERT INTO shipments.billing_periods (project, month, status) VALUES ('ENDEAVOR','2026-11','CLOSED') RETURNING id`)).rows[0].id;
    await db.query('UPDATE shipments.orders SET ship_billing_period_id=$2 WHERE id=$1', [id, p]);
    let r = await O.post(`/api/shipments/orders/${id}/mode`, { shipping_mode_id: M.EXP_OUT.id });
    assert.equal(r.s, 400); assert.match(r.text, /rendicontata/);
    await db.query('UPDATE shipments.orders SET ship_billing_period_id=NULL WHERE id=$1', [id]);
    assert.equal((await O.post(`/api/shipments/orders/${id}/cancel`, { reason: 'prova di annullamento' })).s, 200);
    r = await O.post(`/api/shipments/orders/${id}/mode`, { shipping_mode_id: M.EXP_OUT.id });
    assert.equal(r.s, 400);
  });
});
