import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, getSetting, todayRome } from '../lib/util.js';
import { requireRole, isOps, Params, assertStruttura, OPS_ROLES } from '../lib/access.js';
import { ARTICLE_COLS, stockByArticle, openStockCount, stockCountDetail, proposeQty, nextOrderNumber, enrichLines, caricoIniziale } from '../lib/orders.js';
import { clausolaVisibilita } from '../lib/dotazione.js';
import { consumptionByArticle } from '../lib/studiolab.js';
import { sendMail, opsEmails } from '../lib/mailer.js';

const r = Router();
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));

function targetStruttura(req) {
  const id = isOps(req.user) ? Number(req.query.struttura_id || req.body?.struttura_id) : req.user.struttura_id;
  if (!id) throw bad('Sede obbligatoria');
  return id;
}

// ---------------- Giacenza attuale per articolo ----------------
r.get('/', ah(async (req, res) => {
  const sid = targetStruttura(req);
  const s = await assertStruttura(req.user, sid);
  const months = Number(await getSetting('production_months', '3'));
  const cons = s.kind === 'LAB' ? { map: new Map(), months: 0 } : await consumptionByArticle(sid, months);
  const rows = await many(`SELECT a.id AS article_id, ${ARTICLE_COLS}, a.min_stock_packs, c.name AS category_name, c.icon,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='RICEVUTO') AS packs,
      (SELECT min(expiry) FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='RICEVUTO') AS next_expiry,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='IN_USO' AND p.used_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Rome')) AS used_this_month,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='ATTESO') AS packs_incoming
    FROM articles a JOIN categories c ON c.code=a.category_code WHERE a.active AND (${clausolaVisibilita(s)} OR EXISTS (SELECT 1 FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id)) ORDER BY c.sort, a.sort`, [sid]);
  for (const row of rows) {
    const p = cons.map.get(row.article_id);
    row.prod_packs_avg = p ? p.packs : null;
    row.prod_units_avg = p ? p.units : null;
    row.coverage_months = p && p.packs > 0 ? Math.round((row.packs / p.packs) * 10) / 10 : null;
    row.alert = (p && p.packs > 0 && row.packs < p.packs * 0.5) || (row.min_stock_packs > 0 && row.packs < row.min_stock_packs);
  }
  res.json({ struttura: { id: s.id, name: s.name, kind: s.kind, code: s.code, stock_deadline_day: s.stock_deadline_day }, production_months: cons.months, rows });
}));

// Confezioni in giacenza di un articolo, ordinate per scadenza (FEFO)
r.get('/packages', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const P = new Params();
  const where = [`p.struttura_id=${P.add(sid)}`];
  where.push(req.query.status ? `p.status=${P.add(req.query.status)}` : `p.status='RICEVUTO'`);
  if (req.query.article_id) where.push(`p.article_id=${P.add(Number(req.query.article_id))}`);
  res.json(await many(`SELECT p.*, a.code AS article_code, a.name AS article_name, a.pack_label, a.color, o.number AS order_number, u.full_name AS used_by_name
    FROM packages p JOIN articles a ON a.id=p.article_id LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN users u ON u.id=p.used_by
    WHERE ${where.join(' AND ')} ORDER BY p.expiry NULLS LAST, p.received_at, p.id LIMIT 2000`, P.values));
}));

// Messa in uso: per confezione (id), per codice letto, o la prossima in scadenza dell'articolo (spunta)
r.post('/use', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const d = parse(z.object({ package_id: opt(z.coerce.number().int()), code: opt(z.string().max(120)), article_id: opt(z.coerce.number().int()), qty: z.coerce.number().int().min(1).max(500).default(1) }), req.body);
  let ids = [];
  if (d.package_id) ids = [d.package_id];
  else {
    let articleId = d.article_id;
    if (!articleId && d.code) {
      const byBarcode = await one("SELECT article_id FROM packages WHERE struttura_id=$1 AND barcode=$2 AND status='RICEVUTO' LIMIT 1", [sid, d.code.trim()]);
      const art = byBarcode || await one(`SELECT id AS article_id FROM articles WHERE (gtin IS NOT NULL AND $1 LIKE '%' || gtin || '%') OR upper(code)=upper($1) LIMIT 1`, [d.code.trim()]);
      if (!art) throw bad(`Codice ${d.code} non riconosciuto`);
      articleId = art.article_id;
    }
    if (!articleId) throw bad('Indica confezione, codice o articolo');
    ids = (await many("SELECT id FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO' ORDER BY expiry NULLS LAST, received_at, id LIMIT $3", [sid, articleId, d.qty])).map((x) => x.id);
    if (!ids.length) throw bad('Nessuna confezione in giacenza per questo articolo');
  }
  const rows = await many(`UPDATE packages SET status='IN_USO', used_at=now(), used_by=$2 WHERE id = ANY($1) AND struttura_id=$3 AND status='RICEVUTO' RETURNING id, article_id, lot, expiry`, [ids, req.user.id, sid]);
  if (!rows.length) throw bad('Confezione non in giacenza');
  await audit(req, 'PACKAGE_USE', 'package', rows.map((x) => x.id).join(','), { struttura_id: sid });
  const left = await one("SELECT count(*)::int AS n FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO'", [sid, rows[0].article_id]);
  res.json({ used: rows, remaining: left.n });
}));

// Annulla una messa in uso per errore (entro la giornata)
r.post('/unuse', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const { package_id } = parse(z.object({ package_id: z.coerce.number().int() }), req.body);
  const row = await one("UPDATE packages SET status='RICEVUTO', used_at=NULL, used_by=NULL WHERE id=$1 AND struttura_id=$2 AND status='IN_USO' AND used_at > now() - interval '1 day' RETURNING id", [package_id, sid]);
  if (!row) throw bad('Operazione non annullabile');
  await audit(req, 'PACKAGE_UNUSE', 'package', package_id);
  res.json({ ok: true });
}));

// Carico iniziale (prima giacenza) o rettifica manuale dell'Area Operations
r.post('/initial', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const d = parse(z.object({ lines: z.array(z.object({ article_id: z.coerce.number().int(), qty: z.coerce.number().int().min(0).max(5000), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) })).min(1), note: opt(z.string().max(300)) }), req.body);
  const n = await tx((c) => caricoIniziale(c, { strutturaId: sid, lines: d.lines, userId: req.user.id, note: d.note }));
  await audit(req, 'STOCK_INITIAL', 'struttura', sid, { packages: n });
  res.status(201).json({ packages: n });
}));

// ---------------- Giacenza mensile dichiarata ----------------
r.get('/counts', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `c.struttura_id=${P.add(req.user.struttura_id)}`];
  if (req.query.struttura_id) where.push(`c.struttura_id=${P.add(Number(req.query.struttura_id))}`);
  res.json(await many(`SELECT c.*, s.name AS struttura_name, s.code AS struttura_code, s.kind, u.full_name AS confirmed_by_name, o.number AS order_number, o.status AS order_status,
      (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id=c.id AND l.counted_qty <> l.system_qty) AS differences
    FROM stock_counts c JOIN strutture_v s ON s.id=c.struttura_id LEFT JOIN users u ON u.id=c.confirmed_by LEFT JOIN orders o ON o.id=c.order_id
    WHERE ${where.join(' AND ')} ORDER BY c.month DESC, s.name LIMIT 300`, P.values));
}));

r.post('/counts/open', ah(async (req, res) => {
  const sid = targetStruttura(req);
  const s = await assertStruttura(req.user, sid);
  if (s.kind === 'CLIENTE') throw bad('La giacenza mensile riguarda le sedi del network e il laboratorio');
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}/).default(todayRome().slice(0, 7)) }), req.body || {});
  const id = await openStockCount(sid, month);
  res.json({ id });
}));

r.get('/counts/:id', ah(async (req, res) => {
  const c = await stockCountDetail(req.params.id);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  res.json(c);
}));

// Fase 7: righe fuori elenco (articolo a catalogo non in elenco, oppure descrizione libera)
r.post('/counts/:id/extras', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status !== 'BOZZA') throw bad(c.status === 'ANNULLATO' ? 'Giacenza annullata: va prima riaperta' : 'Giacenza già confermata');
  const d = parse(z.object({ article_id: opt(z.coerce.number().int()), name: opt(z.string().max(200)), qty: z.coerce.number().int().min(0).max(99999), note: opt(z.string().max(300)),
    lot: opt(z.string().max(120)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }), req.body);
  if (!d.article_id && !d.name) throw bad('Indica un articolo del catalogo o una descrizione');
  const row = await one('INSERT INTO stock_count_extras (count_id, article_id, name, qty, note, lot, expiry) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [c.id, d.article_id, d.name, d.qty, d.note, d.lot || null, d.expiry || null]);
  res.status(201).json(row);
}));
r.delete('/counts/:id/extras/:eid', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status !== 'BOZZA') throw bad(c.status === 'ANNULLATO' ? 'Giacenza annullata: va prima riaperta' : 'Giacenza già confermata');
  await q('DELETE FROM stock_count_extras WHERE id=$1 AND count_id=$2', [req.params.eid, c.id]);
  res.json({ ok: true });
}));

// Fase 6: scarichi di oggi della struttura (registro della pagina Scarico)
r.get('/unloads', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  res.json(await many(`SELECT p.id, p.used_at, p.lot, p.expiry, p.barcode, a.name AS article_name, a.pack_label, a.color, u.full_name AS used_by_name,
      (SELECT count(*)::int FROM packages x WHERE x.struttura_id=p.struttura_id AND x.article_id=p.article_id AND x.status='RICEVUTO') AS remaining
    FROM packages p JOIN articles a ON a.id=p.article_id LEFT JOIN users u ON u.id=p.used_by
    WHERE p.struttura_id=$1 AND p.status='IN_USO' AND p.used_at >= now() - interval '7 days' ORDER BY p.used_at DESC LIMIT 200`, [sid]));
}));

r.put('/counts/:id', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status !== 'BOZZA') throw bad(c.status === 'ANNULLATO' ? 'Giacenza annullata: va prima riaperta' : 'Giacenza già confermata');
  const dataOpt = z.preprocess((v) => (v === '' || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
  const d = parse(z.object({ lines: z.array(z.object({ article_id: z.coerce.number().int(), counted_qty: z.coerce.number().int().min(0).max(99999),
    lot: z.preprocess((v) => (v == null ? null : String(v).trim().slice(0, 120) || null), z.string().nullable()).optional(), expiry: dataOpt.optional(),
    // altri lotti dello stesso articolo (migrazione 018): counted_qty è la quantità del primo lotto, il totale lo calcola il server
    lots: z.array(z.object({ qty: z.coerce.number().int().min(0).max(99999), lot: z.preprocess((v) => (v == null ? null : String(v).trim().slice(0, 120) || null), z.string().nullable()).optional(), expiry: dataOpt.optional() })).max(30).optional() })) }), req.body);
  await tx(async (cl) => {
    for (const l of d.lines) {
      // senza `lots` il comportamento è quello di sempre e gli eventuali lotti già salvati non si toccano
      if (l.lots === undefined) {
        const altri = Number((await cl.query('SELECT coalesce(sum(qty),0)::int AS n, count(*)::int AS k FROM stock_count_lots WHERE count_id=$1 AND article_id=$2', [c.id, l.article_id])).rows[0].n);
        await cl.query(`UPDATE stock_count_lines SET counted_qty=$3::int + $8::int, lot_qty=CASE WHEN EXISTS (SELECT 1 FROM stock_count_lots x WHERE x.count_id=$1 AND x.article_id=$2) THEN $3::int ELSE NULL END,
            lot=CASE WHEN $4 THEN $5 ELSE lot END, expiry=CASE WHEN $6 THEN $7::date ELSE expiry END WHERE count_id=$1 AND article_id=$2`,
        [c.id, l.article_id, l.counted_qty, l.lot !== undefined, l.lot ?? null, l.expiry !== undefined, l.expiry ?? null, altri]);
        continue;
      }
      // una replica del tutto vuota (quantità 0, senza lotto né scadenza) non si salva
      const lots = l.lots.filter((x) => x.qty > 0 || x.lot || x.expiry);
      const totale = l.counted_qty + lots.reduce((a, x) => a + x.qty, 0);
      if (totale > 99999) throw bad('Quantità totale dell\'articolo troppo alta');
      const r0 = await cl.query(`UPDATE stock_count_lines SET counted_qty=$3, lot_qty=$4, lot=CASE WHEN $5 THEN $6 ELSE lot END, expiry=CASE WHEN $7 THEN $8::date ELSE expiry END WHERE count_id=$1 AND article_id=$2`,
        [c.id, l.article_id, totale, lots.length ? l.counted_qty : null, l.lot !== undefined, l.lot ?? null, l.expiry !== undefined, l.expiry ?? null]);
      if (!r0.rowCount) continue;                                          // articolo non in elenco: niente lotti orfani
      await cl.query('DELETE FROM stock_count_lots WHERE count_id=$1 AND article_id=$2', [c.id, l.article_id]);
      let pos = 1;
      for (const x of lots) await cl.query('INSERT INTO stock_count_lots (count_id, article_id, position, qty, lot, expiry) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, l.article_id, pos++, x.qty, x.lot ?? null, x.expiry ?? null]);
    }
    await cl.query('UPDATE stock_counts SET updated_at=now() WHERE id=$1', [c.id]);
  });
  res.json({ ok: true });
}));

/**
 * Conferma della giacenza: allinea le confezioni a sistema al conteggio (rettifiche tracciate), poi
 * sedi del network: genera l'ordine potenziale con la formula di riordino e lo mette in verifica all'Area Operations;
 * laboratorio TD: apre una bozza d'ordine che l'Area Operations compila e approva direttamente.
 */
r.post('/counts/:id/confirm', ah(async (req, res) => {
  const c = await stockCountDetail(req.params.id);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status !== 'BOZZA') throw bad(c.status === 'ANNULLATO' ? 'Giacenza annullata: va prima riaperta' : 'Giacenza già confermata');
  const formula = await getSetting('reorder_formula', 'DIFF_X_FACTOR');
  const months = Number(await getSetting('production_months', '3'));
  const cons = c.kind === 'LAB' ? { map: new Map(), months: 0 } : await consumptionByArticle(c.struttura_id, months);
  const s = await one('SELECT * FROM strutture_v WHERE id=$1', [c.struttura_id]);
  const result = await tx(async (cl) => {
    let adjusted = 0;
    for (const l of c.lines) {
      const diff = l.counted_qty - l.system_qty;
      if (diff < 0) {
        await cl.query(`UPDATE packages SET status='RETTIFICATO', note=$4 WHERE id IN (SELECT id FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO' ORDER BY expiry NULLS FIRST, received_at LIMIT $3)`,
          [c.struttura_id, l.article_id, -diff, `Rettifica giacenza ${c.month.slice(0, 7)}`]);
        adjusted += -diff;
      } else if (diff > 0) {
        for (let i = 0; i < diff; i++) await cl.query("INSERT INTO packages (struttura_id, article_id, seq, status, origin, received_at, received_by, note) VALUES ($1,$2,$3,'RICEVUTO','RETTIFICA',now(),$4,$5)", [c.struttura_id, l.article_id, i + 1, req.user.id, `Rettifica giacenza ${c.month.slice(0, 7)}`]);
        adjusted += diff;
      }
    }
    const number = await nextOrderNumber(cl);
    const isSede = c.kind === 'SEDE';
    const o = await cl.query(`INSERT INTO orders (number, struttura_id, kind, origin, status, notes, stock_count_id, requested_by, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5='INVIATO' THEN now() ELSE NULL END) RETURNING id`,
    [number, c.struttura_id, c.kind, isSede ? 'SISTEMA' : 'OPERATIONS', isSede ? 'INVIATO' : 'BOZZA', `Generato dalla giacenza di ${c.month.slice(0, 7)}`, c.id, req.user.id]);
    const orderId = o.rows[0].id;
    let proposed = 0;
    for (const l of c.lines) {
      const p = cons.map.get(l.article_id);
      const qty = isSede ? proposeQty({ prodPacks: p?.packs || 0, stockPacks: l.counted_qty, factor: l.coverage_factor, formula }) : 0;
      proposed += qty;
      await cl.query(`INSERT INTO order_lines (order_id, article_id, qty_requested, qty_proposed, qty_approved, prod_units_avg, prod_packs_avg, stock_packs, last_order_qty)
        VALUES ($1,$2,$3,$3,$3,$4,$5,$6,$7)`, [orderId, l.article_id, qty, p?.units ?? null, p?.packs ?? null, l.counted_qty, l.last_order_qty]);
    }
    await cl.query("UPDATE stock_counts SET status='CONFERMATO', confirmed_by=$2, confirmed_at=now(), order_id=$3, updated_at=now() WHERE id=$1", [c.id, req.user.id, orderId]);
    await cl.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [orderId, req.user.id, isSede ? 'Ordine potenziale generato dalla giacenza' : 'Bozza aperta dalla giacenza del laboratorio', JSON.stringify({ formula, months: cons.months, proposed })]);
    return { orderId, number, adjusted, proposed };
  });
  await audit(req, 'STOCK_COUNT_CONFIRM', 'stock_count', c.id, result);
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'GIACENZA', refKey: `GIACENZA:${c.id}`, to, strutturaId: c.struttura_id, subject: `Giacenza ${c.month.slice(0, 7)} confermata · ${s.name}`, title: 'Giacenza mensile confermata',
    body: c.kind === 'SEDE' ? `${s.name} ha confermato la giacenza di ${c.month.slice(0, 7)}. Il sistema ha generato l'ordine potenziale ${result.number} (${result.proposed} confezioni proposte): verificalo e approvalo in Orders Management.` : `${s.name} ha confermato la giacenza di ${c.month.slice(0, 7)}. È aperta la bozza d'ordine ${result.number} da compilare e approvare.` });
  res.json(result);
}));

/**
 * Annullare, riaprire o eliminare una giacenza (solo Superadmin del modulo; richiesta del CEO del 19/11/2026).
 * Una giacenza CONFERMATA ha prodotto due effetti, che qui si stornano:
 *  - rettifiche delle confezioni: quelle tolte (RETTIFICATO) tornano in giacenza, quelle aggiunte (origin RETTIFICA) si tolgono se
 *    sono ancora in giacenza; quelle già messe in uso restano (sono state usate davvero) e vengono contate nell'esito;
 *  - ordine generato: se è ancora in BOZZA o INVIATO (non approvato) viene annullato; se è già approvato o oltre NON si tocca
 *    (il materiale è in arrivo) e l'esito lo dice.
 * Le confezioni della rettifica si riconoscono da struttura e nota "Rettifica giacenza AAAA-MM" (una sola giacenza per struttura e mese).
 */
async function stornaGiacenza(cl, c, userId, motivo) {
  const out = { tornate_in_giacenza: 0, tolte_dalla_giacenza: 0, gia_usate: 0, ordine: null };
  if (c.status !== 'CONFERMATO') return out;
  const nota = `Rettifica giacenza ${String(c.month).slice(0, 7)}`;
  out.tornate_in_giacenza = (await cl.query("UPDATE packages SET status='RICEVUTO', note=NULL WHERE struttura_id=$1 AND status='RETTIFICATO' AND note=$2", [c.struttura_id, nota])).rowCount;
  out.tolte_dalla_giacenza = (await cl.query("DELETE FROM packages WHERE struttura_id=$1 AND origin='RETTIFICA' AND status='RICEVUTO' AND note=$2", [c.struttura_id, nota])).rowCount;
  out.gia_usate = Number((await cl.query("SELECT count(*)::int AS n FROM packages WHERE struttura_id=$1 AND origin='RETTIFICA' AND status<>'RICEVUTO' AND note=$2", [c.struttura_id, nota])).rows[0].n);
  if (c.order_id) {
    const o = (await cl.query('SELECT id, number, status FROM orders WHERE id=$1 FOR UPDATE', [c.order_id])).rows[0];
    if (o && ['BOZZA', 'INVIATO'].includes(o.status)) {
      await cl.query("UPDATE orders SET status='ANNULLATO', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3, updated_at=now() WHERE id=$1", [o.id, userId, motivo]);
      await cl.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [o.id, userId, 'Ordine annullato', JSON.stringify({ reason: motivo })]);
      out.ordine = { number: o.number, esito: 'ANNULLATO' };
    } else if (o) out.ordine = { number: o.number, esito: o.status === 'ANNULLATO' ? 'GIA_ANNULLATO' : 'NON_TOCCATO', status: o.status };
  }
  return out;
}
const giacenzaPer = async (cl, id) => {
  const c = (await cl.query('SELECT c.*, s.name AS struttura_name FROM stock_counts c JOIN strutture_v s ON s.id=c.struttura_id WHERE c.id=$1 FOR UPDATE OF c', [id])).rows[0];
  if (!c) throw notFound();
  c.month = typeof c.month === 'string' ? c.month : new Date(c.month.getTime() - c.month.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return c;
};
const motivoSchema = (obbligatorio) => z.object({ motivo: obbligatorio ? z.string().trim().min(3).max(300) : z.string().trim().max(300).optional().nullable() });

// Annulla: la giacenza resta in elenco come ANNULLATA (non vale come giacenza del mese), effetti stornati
r.post('/counts/:id/cancel', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const { motivo } = parse(motivoSchema(true), req.body || {});
  const out = await tx(async (cl) => {
    const c = await giacenzaPer(cl, req.params.id);
    if (c.status === 'ANNULLATO') throw bad('Giacenza già annullata');
    const esito = await stornaGiacenza(cl, c, req.user.id, `Giacenza di ${c.month.slice(0, 7)} annullata: ${motivo}`);
    await cl.query("UPDATE stock_counts SET status='ANNULLATO', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3, order_id=NULL, updated_at=now() WHERE id=$1", [c.id, req.user.id, motivo]);
    return { id: c.id, struttura: c.struttura_name, month: c.month.slice(0, 7), da: c.status, motivo, ...esito };
  });
  await audit(req, 'STOCK_COUNT_CANCEL', 'stock_count', out.id, out);
  res.json(out);
}));

// Riapri: la giacenza torna in BOZZA e modificabile; la giacenza teorica viene ricalcolata, le quantità dichiarate restano
r.post('/counts/:id/reopen', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const { motivo } = parse(motivoSchema(false), req.body || {});
  const out = await tx(async (cl) => {
    const c = await giacenzaPer(cl, req.params.id);
    if (c.status === 'BOZZA') throw bad('La giacenza è già modificabile');
    const esito = await stornaGiacenza(cl, c, req.user.id, `Giacenza di ${c.month.slice(0, 7)} riaperta${motivo ? `: ${motivo}` : ''}`);
    await cl.query("UPDATE stock_counts SET status='BOZZA', confirmed_by=NULL, confirmed_at=NULL, order_id=NULL, cancelled_by=NULL, cancelled_at=NULL, cancel_reason=NULL, reopened_by=$2, reopened_at=now(), updated_at=now() WHERE id=$1", [c.id, req.user.id]);
    return { id: c.id, struttura_id: c.struttura_id, struttura: c.struttura_name, month: c.month.slice(0, 7), da: c.status, motivo: motivo || null, ...esito };
  });
  await openStockCount(out.struttura_id, out.month);     // giacenza teorica aggiornata dopo lo storno
  await audit(req, 'STOCK_COUNT_REOPEN', 'stock_count', out.id, out);
  res.json(out);
}));

// Elimina: la giacenza sparisce con righe, lotti e articoli fuori elenco; resta la traccia nel registro delle operazioni
r.delete('/counts/:id', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const out = await tx(async (cl) => {
    const c = await giacenzaPer(cl, req.params.id);
    const righe = Number((await cl.query('SELECT count(*)::int AS n FROM stock_count_lines WHERE count_id=$1 AND counted_qty > 0', [c.id])).rows[0].n);
    const esito = await stornaGiacenza(cl, c, req.user.id, `Giacenza di ${c.month.slice(0, 7)} eliminata`);
    await cl.query('UPDATE orders SET stock_count_id=NULL WHERE stock_count_id=$1', [c.id]);
    await cl.query('DELETE FROM stock_counts WHERE id=$1', [c.id]);
    return { id: c.id, struttura: c.struttura_name, month: c.month.slice(0, 7), da: c.status, righe_con_quantita: righe, ...esito };
  });
  await audit(req, 'STOCK_COUNT_DELETE', 'stock_count', out.id, out);
  res.json(out);
}));

// Consumo medio per articolo con dettaglio degli esami (per la verifica dell'Area Operations)
r.get('/consumption', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const months = Number(req.query.months || await getSetting('production_months', '3'));
  const cons = await consumptionByArticle(sid, months);
  // v0.98.1: ogni voce porta la descrizione dell'articolo (anche di quelli fuori dal catalogo di magazzino, che la pagina mostrava "#id")
  const ids = [...cons.map.keys()];
  const art = new Map((await many(`SELECT id, code, name, pack_label, active AS magazzino FROM articles WHERE id = ANY($1::int[])`, [ids])).map((a) => [a.id, a]));
  const items = [...cons.map.entries()].map(([article_id, v]) => { const a = art.get(article_id); return { article_id, article_code: a?.code || null, article_name: a?.name || null, pack_label: a?.pack_label || null, magazzino: a ? a.magazzino : false, ...v }; })
    .sort((p, q) => Number(q.magazzino) - Number(p.magazzino) || q.units - p.units);
  res.json({ months: cons.months, items });
}));

// ---------------- Difformità ----------------
r.get('/issues', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `i.struttura_id=${P.add(req.user.struttura_id)}`];
  if (req.query.status) where.push(`i.status=${P.add(req.query.status)}`);
  res.json(await many(`SELECT i.*, o.number AS order_number, s.name AS struttura_name, u.full_name AS opened_by_name FROM issues i LEFT JOIN orders o ON o.id=i.order_id JOIN strutture_v s ON s.id=i.struttura_id LEFT JOIN users u ON u.id=i.opened_by
    WHERE ${where.join(' AND ')} ORDER BY i.status, i.opened_at DESC LIMIT 300`, P.values));
}));
r.post('/issues/:id/close', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const { response } = parse(z.object({ response: z.string().min(3).max(1000) }), req.body);
  const i = await one("UPDATE issues SET status='CHIUSA', response=$2, closed_by=$3, closed_at=now() WHERE id=$1 AND status='APERTA' RETURNING *", [req.params.id, response, req.user.id]);
  if (!i) throw notFound();
  if (i.order_id) await q('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [i.order_id, req.user.id, 'Difformità chiusa', JSON.stringify({ response })]);
  const s = await one('SELECT email, name FROM strutture_v WHERE id=$1', [i.struttura_id]);
  if (s?.email) await sendMail({ kind: 'DIFFORMITA_CHIUSA', to: s.email, strutturaId: i.struttura_id, sentBy: req.user.id, subject: 'Difformità gestita da Toscana Diagnostica', title: 'Difformità gestita', body: `Segnalazione: ${i.description}\n\nRisposta dell'Area Operations: ${response}` });
  await audit(req, 'ISSUE_CLOSE', 'issue', i.id);
  res.json({ ok: true });
}));

export default r;
export { enrichLines, stockByArticle };
