// Richieste: dalla email (o inserimento manuale) all'assegnazione del kit, invio, consegna, ricezione del campione
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, badL, notFound, forbidden, audit, parse, logEvent, L, dateOnly, getSetting, itDate } from '../lib/util.js';
import { requireRole, Params, OPERATORS } from '../lib/access.js';
import { parseKitEmail } from '../lib/parser.js';
import { normBarcode } from './kits.js';
import { refreshOne, trackingUrl } from '../lib/tracking.js';
import { sendMail } from '../lib/mailer.js';
import { shippingSheet } from '../pdf/sheet.js';

const r = Router();
const PROJECT = z.enum(['ENDEAVOR', 'LIFESTYLE']);
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patientFields = {
  patient_title: opt(z.string().max(20)),
  patient_first_name: z.string().trim().min(1).max(80),
  patient_last_name: z.string().trim().min(1).max(80),
  address1: z.string().trim().min(2).max(200),
  address2: opt(z.string().max(200)),
  city: z.string().trim().min(1).max(100),
  province: opt(z.string().max(40).transform((v) => (v && v.length === 2 ? v.toUpperCase() : v))),
  zip: opt(z.string().max(12)),
  country: z.string().trim().min(2).max(60).default('Italia'),
  phone: opt(z.string().max(40)),
  email: opt(z.string().email().or(z.literal(''))),
  lang: z.enum(['it', 'en']).default('it'),
  notes: opt(z.string().max(2000)),
};
const orderSchema = z.object({
  project: PROJECT,
  order_type: z.enum(['ENDEAVOR', 'KIT_ONLY', 'KIT_AND_EXAM']),
  external_ref: opt(z.string().trim().max(60)),
  shipping_mode_id: z.number().int().nullable().optional(),
  barcode: opt(z.string().max(60)),
  ...patientFields,
});

const ORDER_COLS = `SELECT o.*, k.barcode, k.status AS kit_status, m.code AS mode_code, m.name_it AS mode_it, m.name_en AS mode_en, m.outbound_service, m.return_service, m.price AS mode_price,
    ls.awb_number, ls.status AS lab_status, u.full_name AS created_by_name`;
const ORDER_FROM = `FROM orders o LEFT JOIN kits k ON k.id=o.kit_id LEFT JOIN shipping_modes m ON m.id=o.shipping_mode_id LEFT JOIN lab_shipments ls ON ls.id=o.lab_shipment_id LEFT JOIN users u ON u.id=o.created_by`;
const ORDER_SELECT = `${ORDER_COLS} ${ORDER_FROM}`;

async function loadOrder(id) {
  const o = await one(`${ORDER_SELECT} WHERE o.id=$1`, [id]);
  if (!o) throw notFound();
  o.shipments = (await many('SELECT * FROM shipments WHERE order_id=$1 ORDER BY id', [id])).map((s) => ({ ...s, url: trackingUrl(s.carrier, s.tracking_number) }));
  o.events = await many('SELECT e.*, u.full_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 OR (e.kit_id=$2 AND e.order_id IS NULL) ORDER BY e.at, e.id', [id, o.kit_id || -1]);
  o.emails = await many('SELECT id, kind, to_addr, subject, status, error, sent_at FROM email_log WHERE order_id=$1 ORDER BY sent_at DESC', [id]);
  return o;
}

function validateType(req, d) {
  if (d.project === 'ENDEAVOR' && d.order_type !== 'ENDEAVOR') throw badL(req, 'Tipo di richiesta non valido per Endeavor', 'Invalid request type for Endeavor');
  if (d.project === 'LIFESTYLE' && d.order_type === 'ENDEAVOR') throw badL(req, 'Tipo di richiesta non valido per Lifestyle', 'Invalid request type for Lifestyle');
}
async function modeFor(req, d) {
  if (d.project !== 'ENDEAVOR') return null;
  if (!d.shipping_mode_id) return null;
  const m = await one('SELECT * FROM shipping_modes WHERE id=$1 AND active', [d.shipping_mode_id]);
  if (!m) throw badL(req, 'Modalità di spedizione non valida', 'Invalid shipping mode');
  return m;
}

// Legs effettive della richiesta
export function legsOf(o) {
  if (o.project === 'LIFESTYLE') return { outbound: 'STANDARD', ret: o.order_type === 'KIT_AND_EXAM' ? 'STANDARD' : null };
  return { outbound: o.outbound_service || null, ret: o.return_service || null };
}

// ---------------- Elenco e dettaglio ----------------
r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = ['TRUE'];
  if (req.query.project) where.push(`o.project = ${P.add(req.query.project)}`);
  if (req.query.status) where.push(`o.status = ANY(${P.add(String(req.query.status).split(','))}::text[])`);
  if (req.query.order_type) where.push(`o.order_type = ${P.add(req.query.order_type)}`);
  if (req.query.lab_shipment_id) where.push(`o.lab_shipment_id = ${P.add(Number(req.query.lab_shipment_id))}`);
  if (req.query.awaiting_lab === '1') where.push(`o.status='SAMPLE_RECEIVED' AND o.lab_shipment_id IS NULL`);
  if (req.query.q) { const s = P.add('%' + String(req.query.q).toUpperCase() + '%'); where.push(`(upper(o.external_ref) LIKE ${s} OR upper(k.barcode) LIKE ${s} OR upper(o.patient_last_name) LIKE ${s} OR upper(o.patient_first_name) LIKE ${s} OR upper(o.city) LIKE ${s})`); }
  if (req.query.from) where.push(`o.created_at >= ${P.add(req.query.from)}::date`);
  if (req.query.to) where.push(`o.created_at < (${P.add(req.query.to)}::date + 1)`);
  const limit = Math.min(Number(req.query.limit || 300), 2000);
  const rows = await many(`${ORDER_COLS},
      (SELECT tracking_number FROM shipments s WHERE s.order_id=o.id AND s.direction='OUTBOUND' ORDER BY id DESC LIMIT 1) AS out_tracking,
      (SELECT last_status FROM shipments s WHERE s.order_id=o.id AND s.direction='OUTBOUND' ORDER BY id DESC LIMIT 1) AS out_status,
      (SELECT tracking_number FROM shipments s WHERE s.order_id=o.id AND s.direction='RETURN' ORDER BY id DESC LIMIT 1) AS ret_tracking,
      (SELECT last_status FROM shipments s WHERE s.order_id=o.id AND s.direction='RETURN' ORDER BY id DESC LIMIT 1) AS ret_status
    ${ORDER_FROM} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`, P.values);
  res.json(rows);
}));

r.get('/counts', ah(async (req, res) => {
  const P = new Params();
  const where = req.query.project ? `WHERE project = ${P.add(req.query.project)}` : '';
  const st = await many(`SELECT project, order_type, status, count(*)::int AS n FROM orders ${where} GROUP BY project, order_type, status`, P.values);
  const inbox = (await one(`SELECT count(*)::int AS n FROM inbox_messages WHERE status IN ('NEW','PARSED')`)).n;
  const awaitingLab = (await one(`SELECT count(*)::int AS n FROM orders WHERE project='ENDEAVOR' AND status='SAMPLE_RECEIVED' AND lab_shipment_id IS NULL`)).n;
  res.json({ byStatus: st, inbox, awaitingLab });
}));

r.get('/:id(\\d+)', ah(async (req, res) => res.json(await loadOrder(Number(req.params.id)))));

// ---------------- Creazione manuale e modifica ----------------
r.post('/', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(orderSchema, req.body);
  validateType(req, d);
  const mode = await modeFor(req, d);
  if (d.project === 'ENDEAVOR' && !mode) throw badL(req, 'Scegli la modalità di spedizione', 'Choose the shipping mode');
  if (d.external_ref && await one('SELECT 1 FROM orders WHERE upper(external_ref)=upper($1) AND status<>$2', [d.external_ref, 'CANCELLED'])) throw badL(req, `Riferimento ${d.external_ref} già presente`, `Reference ${d.external_ref} already exists`);
  const order = await tx(async (c) => createOrder(c, req, d, mode, 'MANUAL', null));
  await audit(req, 'ORDER_CREATE', 'order', order.id, { ref: d.external_ref, project: d.project });
  res.status(201).json(await loadOrder(order.id));
}));

async function createOrder(c, req, d, mode, source, inboxId) {
  const o = (await c.query(`INSERT INTO orders (project, order_type, external_ref, shipping_mode_id, patient_title, patient_first_name, patient_last_name, address1, address2, city, province, zip, country, phone, email, lang, notes, source, inbox_message_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
  [d.project, d.order_type, d.external_ref || null, mode?.id || null, d.patient_title, d.patient_first_name, d.patient_last_name, d.address1, d.address2, d.city, d.province, d.zip, d.country, d.phone, d.email || null, d.lang, d.notes, source, inboxId, req.user.id])).rows[0];
  await logEvent(c, { orderId: o.id, event: 'CREATED', data: { source, ref: d.external_ref }, userId: req.user.id });
  if (d.barcode) await assignKit(c, req, o, d.barcode);
  return o;
}

async function assignKit(c, req, o, barcode) {
  const code = normBarcode(barcode);
  const k = (await c.query('SELECT * FROM kits WHERE upper(barcode)=$1 FOR UPDATE', [code])).rows[0];
  if (!k) throw badL(req, `Kit ${code} non presente in magazzino: caricalo prima nella sezione Immagazzinamento`, `Kit ${code} not in stock: load it first in Stock intake`);
  if (k.status !== 'IN_STOCK') throw badL(req, `Kit ${code} non disponibile (stato: ${k.status})`, `Kit ${code} not available (status: ${k.status})`);
  if (k.project !== o.project) throw badL(req, `Kit ${code} appartiene al progetto ${k.project}`, `Kit ${code} belongs to project ${k.project}`);
  await c.query(`UPDATE kits SET status='ASSIGNED', order_id=$2, updated_at=now() WHERE id=$1`, [k.id, o.id]);
  await c.query(`UPDATE orders SET kit_id=$2, status='ASSIGNED', assigned_at=now(), updated_at=now() WHERE id=$1`, [o.id, k.id]);
  await logEvent(c, { orderId: o.id, kitId: k.id, event: 'ASSIGNED', data: { barcode: k.barcode }, userId: req.user.id });
  return k;
}

r.put('/:id(\\d+)', requireRole(...OPERATORS), ah(async (req, res) => {
  const o = await one('SELECT * FROM orders WHERE id=$1', [Number(req.params.id)]);
  if (!o) throw notFound();
  if (['CLOSED', 'CANCELLED'].includes(o.status)) throw badL(req, 'Richiesta chiusa: non modificabile', 'Closed request: not editable');
  const d = parse(z.object({ external_ref: opt(z.string().trim().max(60)), shipping_mode_id: z.number().int().nullable().optional(), ...patientFields }).partial(), req.body);
  if (d.shipping_mode_id !== undefined && d.shipping_mode_id !== o.shipping_mode_id) {
    if (!['NEW', 'ASSIGNED'].includes(o.status)) throw badL(req, 'La modalità si cambia solo prima della spedizione', 'The shipping mode can be changed only before shipping');
    await modeFor(req, { project: o.project, shipping_mode_id: d.shipping_mode_id });
  }
  if (d.email === '') d.email = null;
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE orders SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [o.id, ...cols.map((c) => d[c])]);
  await logEvent(null, { orderId: o.id, event: 'EDITED', data: d, userId: req.user.id });
  await audit(req, 'ORDER_UPDATE', 'order', o.id, d);
  res.json(await loadOrder(o.id));
}));

// ---------------- Fasi ----------------
r.post('/:id(\\d+)/assign', requireRole(...OPERATORS), ah(async (req, res) => {
  const { barcode } = parse(z.object({ barcode: z.string().min(3) }), req.body);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!o) throw notFound();
    if (o.status !== 'NEW') throw badL(req, 'La richiesta ha già un kit assegnato', 'The request already has a kit assigned');
    await assignKit(c, req, o, barcode);
  });
  await audit(req, 'ORDER_ASSIGN', 'order', req.params.id, { barcode });
  res.json(await loadOrder(Number(req.params.id)));
}));

r.post('/:id(\\d+)/unassign', requireRole(...OPERATORS), ah(async (req, res) => {
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!o || o.status !== 'ASSIGNED') throw badL(req, 'Il kit si può sganciare solo prima della spedizione', 'The kit can be released only before shipping');
    await c.query(`UPDATE kits SET status='IN_STOCK', order_id=NULL, updated_at=now() WHERE id=$1`, [o.kit_id]);
    await c.query(`UPDATE orders SET kit_id=NULL, status='NEW', assigned_at=NULL, updated_at=now() WHERE id=$1`, [o.id]);
    await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'UNASSIGNED', userId: req.user.id });
  });
  await audit(req, 'ORDER_UNASSIGN', 'order', req.params.id);
  res.json(await loadOrder(Number(req.params.id)));
}));

// Invio del kit: registra lettera di vettura SDA in andata e, se prevista, l'etichetta precompilata del ritorno.
// Se la modalità non prevede l'andata (solo ritorno), il kit si registra come consegnato a mano.
const shipSchema = z.object({
  outbound_tracking: opt(z.string().trim().max(60)),
  return_tracking: opt(z.string().trim().max(60)),
  shipped_at: dateStr.optional(),
  handover_note: opt(z.string().max(300)),
});
r.post('/:id(\\d+)/ship', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(shipSchema, req.body);
  const id = Number(req.params.id);
  await tx(async (c) => {
    const o = (await c.query(`${ORDER_SELECT} WHERE o.id=$1 FOR UPDATE OF o`, [id])).rows[0];
    if (!o) throw notFound();
    if (o.status !== 'ASSIGNED') throw badL(req, 'Assegna prima il kit alla richiesta', 'Assign a kit to the request first');
    const legs = legsOf(o);
    const when = d.shipped_at ? new Date(`${d.shipped_at}T12:00:00+02:00`) : new Date();
    const feeDate = dateOnly(when);
    if (legs.outbound) {
      if (!d.outbound_tracking) throw badL(req, 'Inserisci il numero della lettera di vettura SDA di andata', 'Enter the SDA outbound waybill number');
      await c.query(`INSERT INTO shipments (order_id, direction, carrier, service, tracking_number, label_printed_at, shipped_at, last_status, created_by) VALUES ($1,'OUTBOUND','SDA',$2,$3,now(),$4,'IN_TRANSIT',$5)`, [o.id, legs.outbound, d.outbound_tracking, when, req.user.id]);
    }
    if (legs.ret) {
      await c.query(`INSERT INTO shipments (order_id, direction, carrier, service, tracking_number, label_printed_at, last_status, created_by) VALUES ($1,'RETURN','SDA',$2,$3,now(),'PENDING',$4)`, [o.id, legs.ret, d.return_tracking || null, req.user.id]);
    }
    const fee = o.project === 'ENDEAVOR' ? Number(o.mode_price || 0) : null;
    if (legs.outbound) {
      await c.query(`UPDATE orders SET status='SHIPPED', shipped_at=$2, fee_shipping=$3, fee_shipping_date=$4, updated_at=now() WHERE id=$1`, [o.id, when, fee, fee != null ? feeDate : null]);
      await c.query(`UPDATE kits SET status='SHIPPED', updated_at=now() WHERE id=$1`, [o.kit_id]);
      await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'SHIPPED', data: { outbound: d.outbound_tracking, return: d.return_tracking || null, service: legs.outbound }, userId: req.user.id });
    } else {
      await c.query(`UPDATE orders SET status='DELIVERED', handover=TRUE, shipped_at=$2, delivered_at=$2, fee_shipping=$3, fee_shipping_date=$4, updated_at=now() WHERE id=$1`, [o.id, when, fee, fee != null ? feeDate : null]);
      await c.query(`UPDATE kits SET status='DELIVERED', updated_at=now() WHERE id=$1`, [o.kit_id]);
      await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'HANDOVER', data: { return: d.return_tracking || null, note: d.handover_note || null }, userId: req.user.id });
    }
  });
  await audit(req, 'ORDER_SHIP', 'order', id, d);
  const o = await loadOrder(id);
  // notifica al paziente (facoltativa, impostazione)
  if ((await getSetting('notify_patient_on_ship', 'false')) === 'true' && o.email) {
    const out = o.shipments.find((s) => s.direction === 'OUTBOUND');
    if (out) {
      const en = o.lang === 'en';
      await sendMail({ kind: 'PAZIENTE_INVIO', refKey: `PAZIENTE_INVIO:${o.id}`, orderId: o.id, to: o.email, lang: o.lang,
        subject: en ? 'Your kit has been shipped' : 'Il tuo kit è stato spedito',
        title: en ? 'Your kit is on its way' : 'Il tuo kit è in viaggio',
        body: en ? `Dear ${o.patient_first_name},\n\nyour kit was handed to the courier SDA on ${itDate(dateOnly(o.shipped_at))}. Tracking number: ${out.tracking_number}\n${out.url}\n\nInside the envelope you will find the instructions and, where provided, the prepaid return label.`
          : `Gentile ${o.patient_first_name},\n\nil tuo kit è stato affidato al corriere SDA il ${itDate(dateOnly(o.shipped_at))}. Numero di tracciamento: ${out.tracking_number}\n${out.url}\n\nNella busta trovi le istruzioni e, dove prevista, l'etichetta prepagata per il ritorno del campione.` });
    }
  }
  // email ad Affinity / Endeavor con i numeri di tracciamento (richiesta ricorrente nelle loro email: "we will need both tracking numbers")
  if (o.project === 'ENDEAVOR' && (await getSetting('notify_affinity_on_ship', 'true')) === 'true') {
    const to = await getSetting('affinity_notify_emails', '');
    const out = o.shipments.find((s) => s.direction === 'OUTBOUND');
    const ret = o.shipments.find((s) => s.direction === 'RETURN');
    if (to) await sendMail({ kind: 'AFFINITY_SHIP', refKey: `AFFINITY_SHIP:${o.id}`, orderId: o.id, to, lang: 'en', sentBy: req.user.id,
      subject: `Kit ${o.barcode || ''} shipped · ${o.external_ref || ''} · ${o.patient_last_name}`, title: 'Kit shipped',
      body: `Hello,\n\nkit ${o.barcode || '-'} (order ${o.external_ref || '#' + o.id}) for ${[o.patient_title, o.patient_first_name, o.patient_last_name].filter(Boolean).join(' ')}, ${o.city || ''}, was ${o.handover ? 'handed over' : 'handed to SDA'} on ${itDate(dateOnly(o.shipped_at))}.\n\nShipping mode: ${o.mode_en || '-'}\n${out ? `Outbound SDA waybill: ${out.tracking_number}\n${out.url}\n` : ''}${ret ? `Return SDA label: ${ret.tracking_number || 'to be communicated'}${ret.url ? `\n${ret.url}` : ''}\n` : ''}\nBest regards\nToscana Diagnostica · Shipments` });
  }
  res.json(await loadOrder(id));
}));

r.post('/:id(\\d+)/deliver', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(z.object({ delivered_at: dateStr.optional() }), req.body);
  const id = Number(req.params.id);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o || o.status !== 'SHIPPED') throw badL(req, 'La richiesta non è in stato spedito', 'The request is not in shipped status');
    const when = d.delivered_at ? new Date(`${d.delivered_at}T12:00:00+02:00`) : new Date();
    await c.query(`UPDATE orders SET status='DELIVERED', delivered_at=$2, updated_at=now() WHERE id=$1`, [id, when]);
    await c.query(`UPDATE kits SET status='DELIVERED', updated_at=now() WHERE id=$1`, [o.kit_id]);
    await c.query(`UPDATE shipments SET last_status='DELIVERED', delivered_at=$2, last_status_text='Consegna registrata manualmente', updated_at=now() WHERE order_id=$1 AND direction='OUTBOUND'`, [id, when]);
    await logEvent(c, { orderId: id, kitId: o.kit_id, event: 'DELIVERED', data: { source: 'MANUAL' }, userId: req.user.id });
  });
  await audit(req, 'ORDER_DELIVER', 'order', id, d);
  res.json(await loadOrder(id));
}));

// Ricezione del campione (per id o per barcode scansionato)
const recvSchema = z.object({ received_at: dateStr.optional(), site: opt(z.string().max(100)), barcode: opt(z.string().max(60)) });
async function receiveSample(req, c, o, d) {
  if (!['SHIPPED', 'DELIVERED'].includes(o.status)) throw badL(req, `Stato non compatibile con la ricezione del campione (${o.status})`, `Status not compatible with sample receipt (${o.status})`);
  const when = d.received_at ? new Date(`${d.received_at}T12:00:00+02:00`) : new Date();
  const lifestyle = o.project === 'LIFESTYLE';
  await c.query(`UPDATE orders SET status=$2, sample_received_at=$3, sample_received_site=$4, delivered_at=coalesce(delivered_at,$3), closed_at=$5, updated_at=now() WHERE id=$1`,
    [o.id, lifestyle ? 'CLOSED' : 'SAMPLE_RECEIVED', when, d.site || null, lifestyle ? when : null]);
  await c.query(`UPDATE kits SET status=$2, updated_at=now() WHERE id=$1`, [o.kit_id, lifestyle ? 'CLOSED' : 'SAMPLE_RECEIVED']);
  await c.query(`UPDATE shipments SET last_status='DELIVERED', delivered_at=$2, last_status_text=coalesce(last_status_text,'Campione ricevuto in sede'), updated_at=now() WHERE order_id=$1 AND direction='RETURN' AND last_status<>'DELIVERED'`, [o.id, when]);
  await c.query(`UPDATE shipments SET last_status='DELIVERED', delivered_at=coalesce(delivered_at,$2), updated_at=now() WHERE order_id=$1 AND direction='OUTBOUND' AND last_status<>'DELIVERED'`, [o.id, when]);
  await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'SAMPLE_RECEIVED', data: { site: d.site || null }, userId: req.user.id });
  if (lifestyle) await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'CLOSED', userId: req.user.id });
}
r.post('/:id(\\d+)/sample-received', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(recvSchema, req.body);
  const id = Number(req.params.id);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw notFound();
    await receiveSample(req, c, o, d);
  });
  await audit(req, 'SAMPLE_RECEIVED', 'order', id, d);
  res.json(await loadOrder(id));
}));
r.post('/sample-received', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(recvSchema, req.body);
  if (!d.barcode) throw badL(req, 'Scansiona il codice del kit', 'Scan the kit barcode');
  let id;
  await tx(async (c) => {
    const k = (await c.query('SELECT * FROM kits WHERE upper(barcode)=$1 FOR UPDATE', [normBarcode(d.barcode)])).rows[0];
    if (!k) throw badL(req, `Kit ${normBarcode(d.barcode)} sconosciuto`, `Unknown kit ${normBarcode(d.barcode)}`);
    if (!k.order_id) throw badL(req, `Kit ${k.barcode} non assegnato a nessuna richiesta (stato: ${k.status})`, `Kit ${k.barcode} is not assigned to any request (status: ${k.status})`);
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [k.order_id])).rows[0];
    id = o.id;
    await receiveSample(req, c, o, d);
  });
  await audit(req, 'SAMPLE_RECEIVED', 'order', id, d);
  res.json(await loadOrder(id));
}));

// Annullamento con motivazione
r.post('/:id(\\d+)/cancel', requireRole(...OPERATORS), ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const id = Number(req.params.id);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw notFound();
    if (['CLOSED', 'CANCELLED', 'SHIPPED_TO_LAB'].includes(o.status)) throw badL(req, 'Richiesta non annullabile in questo stato', 'Request cannot be cancelled in this status');
    if (o.ship_billing_period_id && (await c.query('SELECT status FROM billing_periods WHERE id=$1', [o.ship_billing_period_id])).rows[0]?.status !== 'OPEN') throw badL(req, 'Richiesta già rendicontata in un periodo chiuso', 'Request already reported in a closed period');
    if (o.kit_id) {
      if (o.status === 'ASSIGNED') await c.query(`UPDATE kits SET status='IN_STOCK', order_id=NULL, updated_at=now() WHERE id=$1`, [o.kit_id]);
      else await c.query(`UPDATE kits SET status='DISCARDED', discard_reason=$2, updated_at=now() WHERE id=$1`, [o.kit_id, `Richiesta annullata: ${reason}`]);
    }
    await c.query(`UPDATE orders SET status='CANCELLED', cancelled_at=now(), cancel_reason=$2, fee_shipping=NULL, fee_shipping_date=NULL, ship_billing_period_id=NULL, updated_at=now() WHERE id=$1`, [id, reason]);
    await logEvent(c, { orderId: id, kitId: o.kit_id, event: 'CANCELLED', data: { reason }, userId: req.user.id });
  });
  await audit(req, 'ORDER_CANCEL', 'order', id, { reason });
  res.json(await loadOrder(id));
}));

// Annulla l'ultimo passaggio (torna indietro di uno stato)
r.post('/:id(\\d+)/undo', requireRole(...OPERATORS), ah(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw notFound();
    const billed = async (pid) => pid && (await c.query('SELECT status FROM billing_periods WHERE id=$1', [pid])).rows[0]?.status !== 'OPEN';
    if (o.status === 'SHIPPED' || (o.status === 'DELIVERED' && o.handover)) {
      if (await billed(o.ship_billing_period_id)) throw badL(req, 'Spedizione già rendicontata in un periodo chiuso', 'Shipment already reported in a closed period');
      await c.query('DELETE FROM shipments WHERE order_id=$1', [id]);
      await c.query(`UPDATE orders SET status='ASSIGNED', handover=FALSE, shipped_at=NULL, delivered_at=NULL, fee_shipping=NULL, fee_shipping_date=NULL, ship_billing_period_id=NULL, updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE kits SET status='ASSIGNED', updated_at=now() WHERE id=$1`, [o.kit_id]);
    } else if (o.status === 'DELIVERED') {
      await c.query(`UPDATE orders SET status='SHIPPED', delivered_at=NULL, updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE kits SET status='SHIPPED', updated_at=now() WHERE id=$1`, [o.kit_id]);
      await c.query(`UPDATE shipments SET last_status='IN_TRANSIT', delivered_at=NULL, updated_at=now() WHERE order_id=$1 AND direction='OUTBOUND'`, [id]);
    } else if (o.status === 'SAMPLE_RECEIVED' || (o.status === 'CLOSED' && o.project === 'LIFESTYLE')) {
      if (o.lab_shipment_id) throw badL(req, 'Il campione è già in una spedizione verso il laboratorio', 'The sample is already in a laboratory shipment');
      await c.query(`UPDATE orders SET status='DELIVERED', sample_received_at=NULL, sample_received_site=NULL, closed_at=NULL, updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE kits SET status='DELIVERED', updated_at=now() WHERE id=$1`, [o.kit_id]);
      await c.query(`UPDATE shipments SET last_status='PENDING', delivered_at=NULL, updated_at=now() WHERE order_id=$1 AND direction='RETURN'`, [id]);
    } else if (o.status === 'CANCELLED') {
      if (o.kit_id) {
        const k = (await c.query('SELECT * FROM kits WHERE id=$1', [o.kit_id])).rows[0];
        if (k.status === 'IN_STOCK') await c.query(`UPDATE kits SET status='ASSIGNED', order_id=$2 WHERE id=$1`, [k.id, id]);
        else if (k.status === 'DISCARDED') await c.query(`UPDATE kits SET status='ASSIGNED', discard_reason=NULL, order_id=$2 WHERE id=$1`, [k.id, id]);
      }
      await c.query(`UPDATE orders SET status=$2, cancelled_at=NULL, cancel_reason=NULL, updated_at=now() WHERE id=$1`, [id, o.kit_id ? 'ASSIGNED' : 'NEW']);
    } else throw badL(req, 'Nessun passaggio da annullare', 'Nothing to undo');
    await logEvent(c, { orderId: id, kitId: o.kit_id, event: 'UNDO', data: { from: o.status }, userId: req.user.id });
  });
  await audit(req, 'ORDER_UNDO', 'order', id);
  res.json(await loadOrder(id));
}));

// ---------------- Tracking per tratta ----------------
r.put('/:id(\\d+)/shipments/:sid', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(z.object({ tracking_number: opt(z.string().trim().max(60)), shipped_at: dateStr.nullable().optional() }), req.body);
  const sh = await one('SELECT * FROM shipments WHERE id=$1 AND order_id=$2', [Number(req.params.sid), Number(req.params.id)]);
  if (!sh) throw notFound();
  await q(`UPDATE shipments SET tracking_number=coalesce($2, tracking_number), shipped_at=coalesce($3::timestamptz, shipped_at), provider_registered=FALSE, last_checked_at=NULL, updated_at=now() WHERE id=$1`, [sh.id, d.tracking_number, d.shipped_at ? new Date(`${d.shipped_at}T12:00:00+02:00`) : null]);
  await logEvent(null, { orderId: sh.order_id, event: 'TRACKING_EDIT', data: { direction: sh.direction, ...d }, userId: req.user.id });
  res.json(await loadOrder(Number(req.params.id)));
}));
r.post('/:id(\\d+)/shipments/:sid/refresh', requireRole(...OPERATORS), ah(async (req, res) => {
  const out = await refreshOne(Number(req.params.sid), req.user.id);
  res.json({ ...out, order: await loadOrder(Number(req.params.id)) });
}));

// ---------------- Foglio di spedizione PDF ----------------
r.get('/:id(\\d+)/sheet.pdf', ah(async (req, res) => {
  const o = await loadOrder(Number(req.params.id));
  const settings = Object.fromEntries((await many("SELECT key, value FROM app_settings WHERE key IN ('return_address','lab_consignee')")).map((x) => [x.key, x.value]));
  const buf = await shippingSheet(o, { legs: legsOf(o), settings, lang: req.query.lang || o.lang });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="shipments-${o.external_ref || o.id}.pdf"`).send(buf);
}));

// ---------------- Posta in arrivo ----------------
r.get('/inbox', ah(async (req, res) => {
  const P = new Params();
  const where = [];
  if (req.query.status) where.push(`status = ANY(${P.add(String(req.query.status).split(','))}::text[])`);
  res.json(await many(`SELECT i.*, u.full_name AS processed_by_name FROM inbox_messages i LEFT JOIN users u ON u.id=i.processed_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY received_at DESC LIMIT 300`, P.values));
}));
r.get('/inbox/:id(\\d+)', ah(async (req, res) => {
  const m = await one('SELECT * FROM inbox_messages WHERE id=$1', [Number(req.params.id)]);
  if (!m) throw notFound();
  res.json(m);
}));
// Incolla il testo di una email (prima dell'attivazione della casella, o per email arrivate altrove)
r.post('/inbox/paste', requireRole(...OPERATORS), ah(async (req, res) => {
  const { text, subject, from_addr } = parse(z.object({ text: z.string().min(10).max(20000), subject: opt(z.string().max(200)), from_addr: opt(z.string().max(200)) }), req.body);
  const modes = await many('SELECT * FROM shipping_modes WHERE active');
  const parsed = parseKitEmail(text, modes, { subject: subject || '', knownCodes: await many('SELECT barcode, status FROM kits') });
  const row = await one(`INSERT INTO inbox_messages (source, from_addr, subject, body_text, parsed, status) VALUES ('PASTE',$1,$2,$3,$4,$5) RETURNING *`,
    [from_addr || null, subject || null, text, JSON.stringify(parsed), parsed.length ? 'PARSED' : 'NEW']);
  await audit(req, 'INBOX_PASTE', 'inbox', row.id, { blocks: parsed.length });
  res.status(201).json(row);
}));
r.post('/inbox/:id(\\d+)/reparse', requireRole(...OPERATORS), ah(async (req, res) => {
  const m = await one('SELECT * FROM inbox_messages WHERE id=$1', [Number(req.params.id)]);
  if (!m) throw notFound();
  const modes = await many('SELECT * FROM shipping_modes WHERE active');
  const parsed = parseKitEmail(m.body_text || '', modes, { subject: m.subject || '', knownCodes: await many('SELECT barcode, status FROM kits') });
  await q(`UPDATE inbox_messages SET parsed=$2, status=CASE WHEN status IN ('NEW','PARSED','ERROR') THEN $3 ELSE status END, error=NULL WHERE id=$1`, [m.id, JSON.stringify(parsed), parsed.length ? 'PARSED' : 'NEW']);
  res.json(await one('SELECT * FROM inbox_messages WHERE id=$1', [m.id]));
}));
// Rilegge tutte le email ancora da elaborare (dopo un carico a magazzino o un aggiornamento del riconoscitore)
r.post('/inbox/reparse-all', requireRole(...OPERATORS), ah(async (req, res) => {
  const modes = await many('SELECT * FROM shipping_modes WHERE active');
  const knownCodes = await many('SELECT barcode, status FROM kits');
  const msgs = await many(`SELECT id, subject, body_text FROM inbox_messages WHERE status IN ('NEW','PARSED','ERROR')`);
  let recognized = 0;
  for (const m of msgs) {
    const parsed = parseKitEmail(m.body_text || '', modes, { subject: m.subject || '', knownCodes });
    if (parsed.length) recognized++;
    await q(`UPDATE inbox_messages SET parsed=$2, status=$3, error=NULL WHERE id=$1`, [m.id, JSON.stringify(parsed), parsed.length ? 'PARSED' : 'NEW']);
  }
  await audit(req, 'INBOX_REPARSE_ALL', 'inbox', null, { total: msgs.length, recognized });
  res.json({ total: msgs.length, recognized });
}));
r.post('/inbox/:id(\\d+)/ignore', requireRole(...OPERATORS), ah(async (req, res) => {
  await q(`UPDATE inbox_messages SET status='IGNORED', processed_by=$2, processed_at=now() WHERE id=$1 AND status IN ('NEW','PARSED','ERROR')`, [Number(req.params.id), req.user.id]);
  await audit(req, 'INBOX_IGNORE', 'inbox', req.params.id);
  res.json({ ok: true });
}));
// Conferma: crea le richieste dai blocchi rivisti dall'operatore (uno o più kit per email)
r.post('/inbox/:id(\\d+)/confirm', requireRole(...OPERATORS), ah(async (req, res) => {
  const m = await one('SELECT * FROM inbox_messages WHERE id=$1', [Number(req.params.id)]);
  if (!m) throw notFound();
  if (!['NEW', 'PARSED', 'ERROR'].includes(m.status)) throw badL(req, 'Email già elaborata', 'Email already processed');
  const { items } = parse(z.object({ items: z.array(orderSchema).min(1).max(50) }), req.body);
  const ids = [];
  await tx(async (c) => {
    for (const d of items) {
      validateType(req, d);
      const mode = await modeFor(req, d);
      if (d.project === 'ENDEAVOR' && !mode) throw badL(req, `Scegli la modalità di spedizione per ${d.external_ref || d.patient_last_name}`, `Choose the shipping mode for ${d.external_ref || d.patient_last_name}`);
      if (d.external_ref && (await c.query('SELECT 1 FROM orders WHERE upper(external_ref)=upper($1) AND status<>$2', [d.external_ref, 'CANCELLED'])).rows.length) throw badL(req, `Riferimento ${d.external_ref} già presente`, `Reference ${d.external_ref} already exists`);
      const o = await createOrder(c, req, d, mode, 'EMAIL', m.id);
      ids.push(o.id);
    }
    // order_ids è JSONB nella Suite (migrazione 004): si passa come JSON, non come array PostgreSQL
    await c.query(`UPDATE inbox_messages SET status='CONFIRMED', order_ids=$2, processed_by=$3, processed_at=now() WHERE id=$1`, [m.id, JSON.stringify(ids), req.user.id]);
  });
  await audit(req, 'INBOX_CONFIRM', 'inbox', m.id, { orders: ids });
  res.status(201).json({ order_ids: ids });
}));

export default r;
