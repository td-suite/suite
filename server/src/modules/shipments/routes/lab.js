// Spedizione dei campioni al laboratorio Endeavor DNA (FedEx, lettera di vettura fornita da Endeavor)
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, badL, notFound, audit, parse, logEvent, getSetting, dateOnly, itDate } from '../lib/util.js';
import { requireRole, Params, OPERATORS } from '../lib/access.js';
import { sendMail } from '../lib/mailer.js';
import { refreshOne, trackingUrl } from '../lib/tracking.js';
import { labSheet } from '../pdf/sheet.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const LAB_SELECT = `SELECT l.*, (l.awb_file IS NOT NULL) AS has_awb_file, u.full_name AS created_by_name,
    (SELECT count(*)::int FROM orders o WHERE o.lab_shipment_id=l.id) AS kits,
    (SELECT last_status FROM shipments s WHERE s.lab_shipment_id=l.id ORDER BY id DESC LIMIT 1) AS tracking_status,
    (SELECT last_status_text FROM shipments s WHERE s.lab_shipment_id=l.id ORDER BY id DESC LIMIT 1) AS tracking_text
  FROM lab_shipments l LEFT JOIN users u ON u.id=l.created_by`;

async function loadLab(id) {
  const l = await one(`${LAB_SELECT} WHERE l.id=$1`, [id]);
  if (!l) throw notFound();
  delete l.awb_file;
  l.orders = await many(`SELECT o.id, o.external_ref, o.patient_title, o.patient_first_name, o.patient_last_name, o.city, o.sample_received_at, o.status, o.fee_sample, k.barcode
    FROM orders o LEFT JOIN kits k ON k.id=o.kit_id WHERE o.lab_shipment_id=$1 ORDER BY o.sample_received_at, o.id`, [id]);
  l.shipment = await one('SELECT * FROM shipments WHERE lab_shipment_id=$1 ORDER BY id DESC LIMIT 1', [id]);
  if (l.shipment) l.shipment.url = trackingUrl('FEDEX', l.shipment.tracking_number);
  l.emails = await many(`SELECT id, kind, to_addr, subject, status, error, sent_at FROM email_log WHERE ref_key LIKE $1 ORDER BY sent_at DESC`, [`LAB%:${id}`]);
  return l;
}

r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = ['TRUE'];
  if (req.query.status) where.push(`l.status = ANY(${P.add(String(req.query.status).split(','))}::text[])`);
  res.json(await many(`${LAB_SELECT} WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 300`, P.values));
}));
r.get('/:id(\\d+)', ah(async (req, res) => res.json(await loadLab(Number(req.params.id)))));

async function attachOrders(c, req, labId, orderIds) {
  for (const oid of orderIds) {
    const o = (await c.query('SELECT o.*, k.barcode FROM orders o LEFT JOIN kits k ON k.id=o.kit_id WHERE o.id=$1 FOR UPDATE OF o', [oid])).rows[0];
    if (!o) throw notFound();
    if (o.project !== 'ENDEAVOR' || o.status !== 'SAMPLE_RECEIVED' || o.lab_shipment_id) throw badL(req, `Il campione ${o.barcode || o.external_ref} non è in attesa di spedizione`, `Sample ${o.barcode || o.external_ref} is not awaiting shipment`);
    await c.query('UPDATE orders SET lab_shipment_id=$2, updated_at=now() WHERE id=$1', [o.id, labId]);
    await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'LAB_ADDED', data: { lab_shipment_id: labId }, userId: req.user.id });
  }
}

const labSchema = z.object({
  order_ids: z.array(z.number().int()).default([]),
  barcodes: z.array(z.string().trim().min(3)).default([]),
  awb_number: opt(z.string().trim().max(40)),
  awb_received_at: dateStr.nullable().optional(),
  notes: opt(z.string().max(1000)),
});
async function resolveBarcodes(c, req, barcodes) {
  const ids = [];
  for (const b of barcodes) {
    const k = (await c.query('SELECT order_id, barcode, status FROM kits WHERE upper(barcode)=$1', [String(b).trim().toUpperCase()])).rows[0];
    if (!k?.order_id) throw badL(req, `Kit ${b} non collegato a una richiesta`, `Kit ${b} not linked to a request`);
    ids.push(k.order_id);
  }
  return ids;
}

r.post('/', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(labSchema, req.body);
  const lab = await tx(async (c) => {
    const ids = [...new Set([...d.order_ids, ...(await resolveBarcodes(c, req, d.barcodes))])];
    if (!ids.length) throw badL(req, 'Seleziona almeno un campione', 'Select at least one sample');
    const l = (await c.query('INSERT INTO lab_shipments (awb_number, awb_received_at, notes, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [d.awb_number || null, d.awb_received_at || null, d.notes || null, req.user.id])).rows[0];
    await attachOrders(c, req, l.id, ids);
    return l;
  });
  await audit(req, 'LAB_CREATE', 'lab', lab.id, { awb: d.awb_number });
  await notifyAffinity(lab.id, 'READY', req.user.id);
  res.status(201).json(await loadLab(lab.id));
}));

r.put('/:id(\\d+)', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(labSchema.extend({ remove_order_ids: z.array(z.number().int()).default([]) }), req.body);
  await tx(async (c) => {
    const l = (await c.query('SELECT * FROM lab_shipments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!l) throw notFound();
    await c.query('UPDATE lab_shipments SET awb_number=$2, awb_received_at=$3, notes=$4, updated_at=now() WHERE id=$1', [id, d.awb_number ?? l.awb_number, d.awb_received_at === undefined ? l.awb_received_at : d.awb_received_at, d.notes ?? l.notes]);
    if (l.status === 'PREPARING') {
      const ids = [...new Set([...d.order_ids, ...(await resolveBarcodes(c, req, d.barcodes))])];
      await attachOrders(c, req, id, ids);
      for (const oid of d.remove_order_ids) {
        await c.query('UPDATE orders SET lab_shipment_id=NULL, updated_at=now() WHERE id=$1 AND lab_shipment_id=$2', [oid, id]);
        await logEvent(c, { orderId: oid, event: 'LAB_REMOVED', data: { lab_shipment_id: id }, userId: req.user.id });
      }
    } else if (d.order_ids.length || d.barcodes.length || d.remove_order_ids.length) throw badL(req, 'Spedizione già partita: i kit non si modificano', 'Shipment already sent: kits cannot be changed');
    if (d.awb_number && d.awb_number !== l.awb_number) await c.query(`UPDATE shipments SET tracking_number=$2, provider_registered=FALSE, last_checked_at=NULL WHERE lab_shipment_id=$1`, [id, d.awb_number]);
  });
  await audit(req, 'LAB_UPDATE', 'lab', id, d);
  res.json(await loadLab(id));
}));

r.post('/:id(\\d+)/awb', requireRole(...OPERATORS), upload.single('file'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) throw badL(req, 'File mancante', 'Missing file');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(req.file.mimetype)) throw badL(req, 'Formati ammessi: PDF, PNG, JPEG', 'Allowed formats: PDF, PNG, JPEG');
  await q('UPDATE lab_shipments SET awb_file=$2, awb_file_name=$3, awb_file_mime=$4, awb_received_at=coalesce(awb_received_at, CURRENT_DATE), updated_at=now() WHERE id=$1', [id, req.file.buffer, req.file.originalname, req.file.mimetype]);
  await audit(req, 'LAB_AWB_UPLOAD', 'lab', id, { name: req.file.originalname });
  res.json(await loadLab(id));
}));
r.get('/:id(\\d+)/awb', ah(async (req, res) => {
  const l = await one('SELECT awb_file, awb_file_name, awb_file_mime FROM lab_shipments WHERE id=$1', [Number(req.params.id)]);
  if (!l?.awb_file) throw notFound();
  res.type(l.awb_file_mime).set('Content-Disposition', `inline; filename="${l.awb_file_name}"`).send(l.awb_file);
}));

r.post('/:id(\\d+)/ship', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(z.object({ shipped_at: dateStr.optional() }), req.body);
  const fee = Number(await getSetting('sample_fee', '3.50'));
  await tx(async (c) => {
    const l = (await c.query('SELECT * FROM lab_shipments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!l || l.status !== 'PREPARING') throw badL(req, 'Spedizione non in preparazione', 'Shipment not in preparation');
    if (!l.awb_number) throw badL(req, 'Inserisci la lettera di vettura FedEx ricevuta da Endeavor prima di spedire', 'Enter the FedEx airway bill received from Endeavor before shipping');
    const ords = (await c.query('SELECT * FROM orders WHERE lab_shipment_id=$1', [id])).rows;
    if (!ords.length) throw badL(req, 'Nessun campione nella spedizione', 'No samples in the shipment');
    const when = d.shipped_at ? new Date(`${d.shipped_at}T12:00:00+02:00`) : new Date();
    await c.query(`UPDATE lab_shipments SET status='SHIPPED', shipped_at=$2, updated_at=now() WHERE id=$1`, [id, when]);
    await c.query(`INSERT INTO shipments (lab_shipment_id, direction, carrier, tracking_number, shipped_at, last_status, created_by) VALUES ($1,'LAB','FEDEX',$2,$3,'IN_TRANSIT',$4)`, [id, l.awb_number, when, req.user.id]);
    for (const o of ords) {
      await c.query(`UPDATE orders SET status='SHIPPED_TO_LAB', fee_sample=$2, fee_sample_date=$3, updated_at=now() WHERE id=$1`, [o.id, fee, dateOnly(when)]);
      await c.query(`UPDATE kits SET status='SHIPPED_TO_LAB', updated_at=now() WHERE id=$1`, [o.kit_id]);
      await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'SHIPPED_TO_LAB', data: { awb: l.awb_number }, userId: req.user.id });
    }
  });
  await audit(req, 'LAB_SHIP', 'lab', id, d);
  await notifyAffinity(id, 'SHIPPED', req.user.id);
  res.json(await loadLab(id));
}));

r.post('/:id(\\d+)/deliver', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(z.object({ delivered_at: dateStr.optional() }), req.body);
  await tx(async (c) => {
    const l = (await c.query('SELECT * FROM lab_shipments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!l || l.status !== 'SHIPPED') throw badL(req, 'Spedizione non in viaggio', 'Shipment not in transit');
    const when = d.delivered_at ? new Date(`${d.delivered_at}T12:00:00+02:00`) : new Date();
    await c.query(`UPDATE lab_shipments SET status='DELIVERED', delivered_at=$2, updated_at=now() WHERE id=$1`, [id, when]);
    await c.query(`UPDATE shipments SET last_status='DELIVERED', delivered_at=$2, last_status_text='Consegna registrata manualmente', updated_at=now() WHERE lab_shipment_id=$1`, [id, when]);
    const ords = (await c.query(`UPDATE orders SET status='CLOSED', closed_at=$2, updated_at=now() WHERE lab_shipment_id=$1 RETURNING id, kit_id`, [id, when])).rows;
    for (const o of ords) { await c.query(`UPDATE kits SET status='CLOSED', updated_at=now() WHERE id=$1`, [o.kit_id]); await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'LAB_DELIVERED', data: { source: 'MANUAL' }, userId: req.user.id }); }
  });
  await audit(req, 'LAB_DELIVER', 'lab', id, d);
  res.json(await loadLab(id));
}));

r.post('/:id(\\d+)/undo', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (c) => {
    const l = (await c.query('SELECT * FROM lab_shipments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!l) throw notFound();
    const ords = (await c.query('SELECT * FROM orders WHERE lab_shipment_id=$1', [id])).rows;
    if (l.status === 'DELIVERED') {
      await c.query(`UPDATE lab_shipments SET status='SHIPPED', delivered_at=NULL, updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE shipments SET last_status='IN_TRANSIT', delivered_at=NULL WHERE lab_shipment_id=$1`, [id]);
      for (const o of ords) { await c.query(`UPDATE orders SET status='SHIPPED_TO_LAB', closed_at=NULL WHERE id=$1`, [o.id]); await c.query(`UPDATE kits SET status='SHIPPED_TO_LAB' WHERE id=$1`, [o.kit_id]); }
    } else if (l.status === 'SHIPPED') {
      const closed = ords.find((o) => o.sample_billing_period_id);
      if (closed && (await c.query('SELECT status FROM billing_periods WHERE id=$1', [closed.sample_billing_period_id])).rows[0]?.status !== 'OPEN') throw badL(req, 'Campioni già rendicontati in un periodo chiuso', 'Samples already reported in a closed period');
      await c.query(`UPDATE lab_shipments SET status='PREPARING', shipped_at=NULL, updated_at=now() WHERE id=$1`, [id]);
      await c.query('DELETE FROM shipments WHERE lab_shipment_id=$1', [id]);
      for (const o of ords) { await c.query(`UPDATE orders SET status='SAMPLE_RECEIVED', fee_sample=NULL, fee_sample_date=NULL, sample_billing_period_id=NULL WHERE id=$1`, [o.id]); await c.query(`UPDATE kits SET status='SAMPLE_RECEIVED' WHERE id=$1`, [o.kit_id]); }
    } else throw badL(req, 'Nessun passaggio da annullare', 'Nothing to undo');
    for (const o of ords) await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'UNDO', data: { from: l.status, lab: id }, userId: req.user.id });
  });
  await audit(req, 'LAB_UNDO', 'lab', id);
  res.json(await loadLab(id));
}));

r.delete('/:id(\\d+)', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (c) => {
    const l = (await c.query('SELECT * FROM lab_shipments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!l) throw notFound();
    if (l.status !== 'PREPARING') throw badL(req, 'Si elimina solo una spedizione in preparazione', 'Only a shipment in preparation can be deleted');
    const ords = (await c.query('UPDATE orders SET lab_shipment_id=NULL WHERE lab_shipment_id=$1 RETURNING id, kit_id', [id])).rows;
    for (const o of ords) await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'LAB_REMOVED', data: { lab_shipment_id: id, deleted: true }, userId: req.user.id });
    await c.query('DELETE FROM lab_shipments WHERE id=$1', [id]);
  });
  await audit(req, 'LAB_DELETE', 'lab', id);
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/refresh', requireRole(...OPERATORS), ah(async (req, res) => {
  const sh = await one('SELECT id FROM shipments WHERE lab_shipment_id=$1 ORDER BY id DESC LIMIT 1', [Number(req.params.id)]);
  if (!sh) throw notFound();
  const out = await refreshOne(sh.id, req.user.id);
  res.json({ ...out, lab: await loadLab(Number(req.params.id)) });
}));
r.post('/:id(\\d+)/notify', requireRole(...OPERATORS), ah(async (req, res) => {
  const l = await one('SELECT status FROM lab_shipments WHERE id=$1', [Number(req.params.id)]);
  if (!l) throw notFound();
  const out = await notifyAffinity(Number(req.params.id), l.status === 'PREPARING' ? 'READY' : 'SHIPPED', req.user.id, true);
  res.json(out);
}));

r.get('/:id(\\d+)/sheet.pdf', ah(async (req, res) => {
  const l = await loadLab(Number(req.params.id));
  const consignee = await getSetting('lab_consignee', '');
  const sender = await getSetting('return_address', '');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="fedex-${l.awb_number || l.id}.pdf"`).send(await labSheet(l, { consignee, sender }));
}));

// Email in inglese ad Affinity/Endeavor: alla preparazione (imminente invio) e alla spedizione (con lettera di vettura)
async function notifyAffinity(labId, phase, userId, force = false) {
  const l = await loadLab(labId);
  const to = await getSetting('affinity_notify_emails', '');
  if (!to) return { status: 'FALLITA', error: 'Nessun destinatario configurato' };
  const list = l.orders.map((o) => `• Kit ${o.barcode || '-'} · ${o.external_ref || ''} · ${[o.patient_title, o.patient_first_name, o.patient_last_name].filter(Boolean).join(' ')} (${o.city || ''}) · sample received ${itDate(dateOnly(o.sample_received_at))}`).join('\n');
  const n = l.orders.length;
  const subj = phase === 'READY'
    ? `Samples ready for shipment to Endeavor DNA · ${n} kit${n > 1 ? 's' : ''}${l.awb_number ? ` · AWB ${l.awb_number}` : ''}`
    : `Samples shipped to Endeavor DNA · FedEx AWB ${l.awb_number} · ${n} kit${n > 1 ? 's' : ''}`;
  const body = phase === 'READY'
    ? `Hello,\n\nthe following sample${n > 1 ? 's are' : ' is'} at Toscana Diagnostica and about to be shipped to Endeavor DNA Laboratories, Las Cruces NM:\n\n${list}\n\n${l.awb_number ? `FedEx airway bill: ${l.awb_number}.` : 'We are waiting for the FedEx airway bill: please send it to shipments@toscanadiagnostica.it.'}\n\nBest regards\nToscana Diagnostica · Shipments`
    : `Hello,\n\nthe following sample${n > 1 ? 's were' : ' was'} handed to FedEx on ${itDate(dateOnly(l.shipped_at))}:\n\n${list}\n\nFedEx airway bill: ${l.awb_number}\nTracking: ${trackingUrl('FEDEX', l.awb_number)}\n\nBest regards\nToscana Diagnostica · Shipments`;
  const out = await sendMail({ kind: phase === 'READY' ? 'LAB_READY' : 'LAB_SHIPPED', refKey: force ? null : `LAB_${phase}:${labId}`, to, lang: 'en', subject: subj, title: phase === 'READY' ? 'Samples ready for shipment' : 'Samples shipped', body, sentBy: userId });
  if (out.status === 'INVIATA') await q('UPDATE lab_shipments SET notification_sent_at=now() WHERE id=$1', [labId]);
  return out;
}

export default r;
