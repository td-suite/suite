// Rendicontazione quantitativa, cruscotto, allarmi
import { Router } from 'express';
import { many, one } from '../db.js';
import { ah, getSetting } from '../lib/util.js';
import { Params } from '../lib/access.js';
import { overdueReturns, awaitingAwb } from '../lib/jobs.js';

const r = Router();

function range(req) {
  const to = req.query.to || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const from = req.query.from || `${to.slice(0, 4)}-01-01`;
  return { from, to };
}

// Cruscotto di progetto: contatori per fase, lavoro da fare oggi, allarmi
r.get('/dashboard', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const P = new Params();
  const p = P.add(project);
  const byStatus = await many(`SELECT status, order_type, count(*)::int AS n FROM orders WHERE project=${p} GROUP BY status, order_type`, P.values);
  const stock = await one(`SELECT count(*)::int AS n FROM kits WHERE project=$1 AND status='IN_STOCK'`, [project]);
  const inbox = project === 'ENDEAVOR' ? (await one(`SELECT count(*)::int AS n FROM inbox_messages WHERE status IN ('NEW','PARSED')`)).n : 0;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7);
  const monthStats = await one(`SELECT
      count(*) FILTER (WHERE to_char(created_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=$2)::int AS created,
      count(*) FILTER (WHERE to_char(shipped_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=$2)::int AS shipped,
      count(*) FILTER (WHERE to_char(delivered_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=$2)::int AS delivered,
      count(*) FILTER (WHERE to_char(sample_received_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=$2)::int AS samples,
      count(*) FILTER (WHERE to_char(fee_sample_date,'YYYY-MM')=$2)::int AS to_lab,
      coalesce(sum(fee_shipping) FILTER (WHERE to_char(fee_shipping_date,'YYYY-MM')=$2),0) + coalesce(sum(fee_sample) FILTER (WHERE to_char(fee_sample_date,'YYYY-MM')=$2),0) AS revenue
    FROM orders WHERE project=$1 AND status<>'CANCELLED'`, [project, month]);
  const retDays = Number(await getSetting('alert_return_days', '21'));
  const awbDays = Number(await getSetting('alert_awb_days', '5'));
  const minStock = Number(await getSetting('alert_stock_min', '10'));
  const overdue = (await overdueReturns(retDays)).filter((o) => o.project === project);
  const awaiting = project === 'ENDEAVOR' ? await awaitingAwb(awbDays) : [];
  const trackingIssues = await many(`SELECT s.*, o.external_ref, o.patient_last_name FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.project=$1 AND s.last_status='EXCEPTION' ORDER BY s.last_event_at DESC NULLS LAST LIMIT 20`, [project]);
  const recent = await many(`SELECT e.*, o.external_ref, o.patient_last_name, k.barcode, u.full_name FROM order_events e LEFT JOIN orders o ON o.id=e.order_id LEFT JOIN kits k ON k.id=coalesce(e.kit_id,o.kit_id) LEFT JOIN users u ON u.id=e.user_id
    WHERE coalesce(o.project, k.project)=$1 ORDER BY e.at DESC LIMIT 25`, [project]);
  const trend = await many(`SELECT to_char(d, 'YYYY-MM') AS month,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND o.status<>'CANCELLED' AND to_char(o.shipped_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=to_char(d,'YYYY-MM')) AS shipped,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.sample_received_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=to_char(d,'YYYY-MM')) AS samples,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.fee_sample_date,'YYYY-MM')=to_char(d,'YYYY-MM')) AS to_lab
    FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') d ORDER BY d`, [project]);
  res.json({ project, byStatus, stock: stock.n, lowStock: stock.n < minStock, minStock, inbox, month, monthStats, overdue, awaiting, trackingIssues, recent, trend, retDays, awbDays });
}));

// Rendicontazione quantitativa per periodo: eventi per fase per mese, per modalità, per tipo; tempi medi
r.get('/quantitative', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const { from, to } = range(req);
  const args = [project, from, to];
  const perMonth = await many(`WITH months AS (SELECT to_char(d,'YYYY-MM') AS m FROM generate_series(date_trunc('month',$2::date), date_trunc('month',$3::date), interval '1 month') d)
    SELECT m.m AS month,
      (SELECT count(*)::int FROM kits k JOIN stock_lots l ON l.id=k.lot_id WHERE k.project=$1 AND to_char(l.received_at,'YYYY-MM')=m.m) AS stock_in,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.created_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS requests,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND o.status<>'CANCELLED' AND to_char(o.shipped_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS shipped,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND o.status<>'CANCELLED' AND to_char(o.delivered_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS delivered,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.sample_received_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS samples,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.fee_sample_date,'YYYY-MM')=m.m) AS to_lab,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.closed_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS closed,
      (SELECT count(*)::int FROM orders o WHERE o.project=$1 AND to_char(o.cancelled_at AT TIME ZONE 'Europe/Rome','YYYY-MM')=m.m) AS cancelled
    FROM months m ORDER BY m.m`, args);
  const byMode = await many(`SELECT coalesce(m.code, o.order_type) AS code, coalesce(m.name_it, o.order_type) AS name_it, coalesce(m.name_en, o.order_type) AS name_en, count(*)::int AS n, coalesce(sum(o.fee_shipping),0) AS fees
    FROM orders o LEFT JOIN shipping_modes m ON m.id=o.shipping_mode_id WHERE o.project=$1 AND o.status<>'CANCELLED' AND o.shipped_at::date BETWEEN $2 AND $3 GROUP BY 1,2,3 ORDER BY n DESC`, args);
  const times = await one(`SELECT
      round(avg(EXTRACT(epoch FROM (assigned_at - created_at))/86400)::numeric, 1) AS req_to_assign,
      round(avg(EXTRACT(epoch FROM (shipped_at - created_at))/86400)::numeric, 1) AS req_to_ship,
      round((avg(EXTRACT(epoch FROM (delivered_at - shipped_at))/86400) FILTER (WHERE NOT handover))::numeric, 1) AS ship_to_deliver,
      round(avg(EXTRACT(epoch FROM (sample_received_at - delivered_at))/86400)::numeric, 1) AS deliver_to_sample,
      round(avg(EXTRACT(epoch FROM (fee_sample_date::timestamp - sample_received_at))/86400)::numeric, 1) AS sample_to_lab,
      round(avg(EXTRACT(epoch FROM (closed_at - created_at))/86400)::numeric, 1) AS total
    FROM orders WHERE project=$1 AND status<>'CANCELLED' AND created_at::date BETWEEN $2 AND $3`, args);
  const bySite = project === 'LIFESTYLE' ? await many(`SELECT coalesce(sample_received_site,'-') AS site, count(*)::int AS n FROM orders WHERE project=$1 AND sample_received_at::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY n DESC`, args) : [];
  const open = await many(`SELECT status, count(*)::int AS n FROM orders WHERE project=$1 AND status NOT IN ('CLOSED','CANCELLED') GROUP BY status`, [project]);
  const stock = await many(`SELECT status, count(*)::int AS n FROM kits WHERE project=$1 GROUP BY status`, [project]);
  res.json({ project, from, to, perMonth, byMode, times, bySite, open, stock });
}));

// Export CSV delle richieste del periodo
r.get('/orders.csv', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const { from, to } = range(req);
  const rows = await many(`SELECT o.id, o.external_ref, o.order_type, m.code AS mode, o.status, o.patient_last_name, o.patient_first_name, o.city, o.province, o.zip, o.country, k.barcode,
      o.created_at, o.assigned_at, o.shipped_at, o.delivered_at, o.sample_received_at, o.sample_received_site, ls.awb_number, o.fee_sample_date AS lab_shipped_at, o.closed_at, o.cancelled_at, o.fee_shipping, o.fee_sample,
      (SELECT tracking_number FROM shipments s WHERE s.order_id=o.id AND s.direction='OUTBOUND' ORDER BY id DESC LIMIT 1) AS outbound_tracking,
      (SELECT tracking_number FROM shipments s WHERE s.order_id=o.id AND s.direction='RETURN' ORDER BY id DESC LIMIT 1) AS return_tracking
    FROM orders o LEFT JOIN kits k ON k.id=o.kit_id LEFT JOIN shipping_modes m ON m.id=o.shipping_mode_id LEFT JOIN lab_shipments ls ON ls.id=o.lab_shipment_id
    WHERE o.project=$1 AND o.created_at::date BETWEEN $2 AND $3 ORDER BY o.id`, [project, from, to]);
  const cols = rows.length ? Object.keys(rows[0]) : ['id'];
  const fmt = (v) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v)).replace(/"/g, '""');
  const csv = [cols.join(';'), ...rows.map((r0) => cols.map((c) => `"${fmt(r0[c])}"`).join(';'))].join('\r\n');
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="shipments-${project.toLowerCase()}-${from}-${to}.csv"`).send('﻿' + csv);
}));

export default r;
