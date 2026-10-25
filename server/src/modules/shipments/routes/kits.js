// Magazzino kit: lotti di carico, kit per codice a barre, scarico/rettifica
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, badL, notFound, audit, parse, logEvent, L } from '../lib/util.js';
import { requireRole, Params, OPERATORS } from '../lib/access.js';

const r = Router();
const PROJECT = z.enum(['ENDEAVOR', 'LIFESTYLE']);
export const normBarcode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

// Elenco kit con filtri (progetto, stato, ricerca barcode)
r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = ['TRUE'];
  if (req.query.project) where.push(`k.project = ${P.add(req.query.project)}`);
  if (req.query.status) where.push(`k.status = ANY(${P.add(String(req.query.status).split(','))}::text[])`);
  if (req.query.q) where.push(`(upper(k.barcode) LIKE ${P.add('%' + normBarcode(req.query.q) + '%')} OR upper(o.external_ref) LIKE ${P.add('%' + normBarcode(req.query.q) + '%')} OR upper(o.patient_last_name) LIKE ${P.add('%' + String(req.query.q).toUpperCase() + '%')})`);
  if (req.query.lot_id) where.push(`k.lot_id = ${P.add(Number(req.query.lot_id))}`);
  const limit = Math.min(Number(req.query.limit || 300), 2000);
  res.json(await many(`SELECT k.*, t.name AS kit_type, l.received_at AS lot_received_at, l.reference AS lot_reference,
      o.external_ref, o.patient_first_name, o.patient_last_name, o.status AS order_status
    FROM kits k LEFT JOIN kit_types t ON t.id=k.kit_type_id LEFT JOIN stock_lots l ON l.id=k.lot_id LEFT JOIN orders o ON o.id=k.order_id
    WHERE ${where.join(' AND ')} ORDER BY k.created_at DESC, k.id DESC LIMIT ${limit}`, P.values));
}));

// Ricerca puntuale per barcode (scansione)
r.get('/lookup/:barcode', ah(async (req, res) => {
  const k = await one(`SELECT k.*, t.name AS kit_type, o.external_ref, o.patient_first_name, o.patient_last_name, o.status AS order_status, o.project AS order_project
    FROM kits k LEFT JOIN kit_types t ON t.id=k.kit_type_id LEFT JOIN orders o ON o.id=k.order_id WHERE upper(k.barcode)=$1`, [normBarcode(req.params.barcode)]);
  if (!k) throw notFound(L(req, 'Kit non trovato in magazzino', 'Kit not found in stock'));
  res.json(k);
}));

r.get('/summary', ah(async (req, res) => {
  const P = new Params();
  const where = req.query.project ? `WHERE project = ${P.add(req.query.project)}` : '';
  const rows = await many(`SELECT project, status, count(*)::int AS n FROM kits ${where} GROUP BY project, status`, P.values);
  const lots = await many(`SELECT l.*, u.full_name AS created_by_name, (SELECT count(*)::int FROM kits k WHERE k.lot_id=l.id) AS kits, (SELECT count(*)::int FROM kits k WHERE k.lot_id=l.id AND k.status='IN_STOCK') AS in_stock
    FROM stock_lots l LEFT JOIN users u ON u.id=l.created_by ${where.replace('project', 'l.project')} ORDER BY l.received_at DESC, l.id DESC LIMIT 100`, P.values);
  res.json({ byStatus: rows, lots });
}));

// Carico a magazzino: un lotto con N codici a barre (scansionati o incollati)
const lotSchema = z.object({
  project: PROJECT,
  supplier: z.string().trim().min(2).max(120).default('Endeavor DNA'),
  received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  kit_type_id: z.number().int().nullable().optional(),
  barcodes: z.array(z.string().trim().min(3).max(60)).min(1).max(2000),
});
r.post('/lots', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(lotSchema, req.body);
  const codes = [...new Set(d.barcodes.map(normBarcode).filter(Boolean))];
  const dup = await many('SELECT barcode FROM kits WHERE upper(barcode) = ANY($1)', [codes]);
  if (dup.length) throw badL(req, `Codici già presenti in magazzino: ${dup.map((x) => x.barcode).join(', ')}`, `Barcodes already in stock: ${dup.map((x) => x.barcode).join(', ')}`);
  const typeId = d.kit_type_id || (await one('SELECT id FROM kit_types WHERE active ORDER BY id LIMIT 1'))?.id || null;
  const lot = await tx(async (c) => {
    const l = (await c.query('INSERT INTO stock_lots (project, supplier, received_at, reference, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [d.project, d.supplier, d.received_at, d.reference || null, d.notes || null, req.user.id])).rows[0];
    for (const b of codes) {
      const k = (await c.query('INSERT INTO kits (barcode, lot_id, kit_type_id, project, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b, l.id, typeId, d.project, req.user.id])).rows[0];
      await logEvent(c, { kitId: k.id, event: 'STOCK_IN', data: { lot: l.id, barcode: b }, userId: req.user.id });
    }
    return l;
  });
  await audit(req, 'STOCK_IN', 'lot', lot.id, { project: d.project, count: codes.length });
  res.status(201).json({ ...lot, kits: codes.length });
}));

// Aggiunta di singoli kit a un lotto esistente
r.post('/lots/:id/kits', requireRole(...OPERATORS), ah(async (req, res) => {
  const lot = await one('SELECT * FROM stock_lots WHERE id=$1', [Number(req.params.id)]);
  if (!lot) throw notFound();
  const { barcodes } = parse(z.object({ barcodes: z.array(z.string().trim().min(3).max(60)).min(1).max(500) }), req.body);
  const codes = [...new Set(barcodes.map(normBarcode))];
  const dup = await many('SELECT barcode FROM kits WHERE upper(barcode) = ANY($1)', [codes]);
  if (dup.length) throw badL(req, `Codici già presenti: ${dup.map((x) => x.barcode).join(', ')}`, `Barcodes already present: ${dup.map((x) => x.barcode).join(', ')}`);
  const typeId = (await one('SELECT kit_type_id FROM kits WHERE lot_id=$1 LIMIT 1', [lot.id]))?.kit_type_id || null;
  await tx(async (c) => {
    for (const b of codes) {
      const k = (await c.query('INSERT INTO kits (barcode, lot_id, kit_type_id, project, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b, lot.id, typeId, lot.project, req.user.id])).rows[0];
      await logEvent(c, { kitId: k.id, event: 'STOCK_IN', data: { lot: lot.id, barcode: b }, userId: req.user.id });
    }
  });
  await audit(req, 'STOCK_IN_ADD', 'lot', lot.id, { count: codes.length });
  res.status(201).json({ added: codes.length });
}));

// Rettifiche: scarto (danneggiato, smarrito), cambio progetto, note. Solo kit in magazzino.
r.put('/:id', requireRole(...OPERATORS), ah(async (req, res) => {
  const k = await one('SELECT * FROM kits WHERE id=$1', [Number(req.params.id)]);
  if (!k) throw notFound();
  const d = parse(z.object({ project: PROJECT.optional(), kit_type_id: z.number().int().nullable().optional(), notes: z.string().max(500).nullable().optional() }), req.body);
  if (d.project && d.project !== k.project && k.status !== 'IN_STOCK') throw badL(req, 'Il progetto si cambia solo per kit in magazzino', 'The project can be changed only for kits in stock');
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE kits SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [k.id, ...cols.map((c) => d[c])]);
  await audit(req, 'KIT_UPDATE', 'kit', k.id, d);
  res.json(await one('SELECT * FROM kits WHERE id=$1', [k.id]));
}));

r.post('/:id/discard', requireRole(...OPERATORS), ah(async (req, res) => {
  const k = await one('SELECT * FROM kits WHERE id=$1', [Number(req.params.id)]);
  if (!k) throw notFound();
  if (k.status !== 'IN_STOCK') throw badL(req, 'Si scartano solo kit in magazzino. Per un kit assegnato annulla prima la richiesta.', 'Only kits in stock can be discarded. For an assigned kit cancel the request first.');
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  await tx(async (c) => {
    await c.query(`UPDATE kits SET status='DISCARDED', discard_reason=$2, updated_at=now() WHERE id=$1`, [k.id, reason]);
    await logEvent(c, { kitId: k.id, event: 'DISCARDED', data: { reason }, userId: req.user.id });
  });
  await audit(req, 'KIT_DISCARD', 'kit', k.id, { reason });
  res.json({ ok: true });
}));

r.post('/:id/restore', requireRole(...OPERATORS), ah(async (req, res) => {
  const k = await one('SELECT * FROM kits WHERE id=$1', [Number(req.params.id)]);
  if (!k || k.status !== 'DISCARDED') throw notFound();
  await q(`UPDATE kits SET status='IN_STOCK', discard_reason=NULL, updated_at=now() WHERE id=$1`, [k.id]);
  await logEvent(null, { kitId: k.id, event: 'RESTORED', userId: req.user.id });
  await audit(req, 'KIT_RESTORE', 'kit', k.id);
  res.json({ ok: true });
}));

r.get('/:id/events', ah(async (req, res) => {
  res.json(await many(`SELECT e.*, u.full_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.kit_id=$1 OR e.order_id IN (SELECT id FROM orders WHERE kit_id=$1) ORDER BY e.at`, [Number(req.params.id)]));
}));

export default r;
