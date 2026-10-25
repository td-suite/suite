import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, notFound, audit, parse, bad } from '../lib/util.js';
import { requireWrite } from '../lib/access.js';

const r = Router();

// Risultati per campagna: vendite collegate (codice promo o attribuzione), clienti nuovi acquisiti, ricavi, ROI
const RESULTS = `LEFT JOIN LATERAL (
    SELECT count(DISTINCT s.external_ref)::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT s.customer_id)::int AS customers,
      count(DISTINCT s.customer_id) FILTER (WHERE cu.first_visit >= c.start_date)::int AS new_customers
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id WHERE s.campaign_id=c.id) r ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT s.external_ref)::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue FROM sales s
    WHERE s.campaign_id IS NULL AND s.customer_id IS NOT NULL AND s.sale_date BETWEEN c.start_date AND coalesce(c.end_date, c.start_date + 30)
      AND (c.site_ids = '[]'::jsonb OR s.site_id IN (SELECT (v)::int FROM jsonb_array_elements_text(c.site_ids) v))
      AND (c.product_ids = '[]'::jsonb OR s.product_id IN (SELECT (v)::int FROM jsonb_array_elements_text(c.product_ids) v))) w ON true`;

const COLS = `c.*, pr.name AS promotion_name, r.tickets, r.revenue, r.customers, r.new_customers, w.tickets AS window_tickets, w.revenue AS window_revenue,
  CASE WHEN coalesce(c.spent, c.budget, 0) > 0 THEN round((r.revenue - coalesce(c.spent, c.budget)) / coalesce(c.spent, c.budget) * 100, 1) END AS roi_pct,
  CASE WHEN r.customers > 0 THEN round(coalesce(c.spent, c.budget, 0) / r.customers, 2) END AS cost_per_customer,
  CASE WHEN c.clicks > 0 AND c.impressions > 0 THEN round(c.clicks::numeric / c.impressions * 100, 2) END AS ctr_pct,
  CASE WHEN c.leads > 0 AND r.tickets > 0 THEN round(r.tickets::numeric / c.leads * 100, 1) END AS conversion_pct`;

r.get('/', ah(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : null;
  const rows = await many(`SELECT ${COLS} FROM campaigns c LEFT JOIN promotions pr ON pr.id=c.promotion_id ${RESULTS} ${year ? 'WHERE date_part(\'year\', c.start_date)=$1 OR date_part(\'year\', c.end_date)=$1' : ''} ORDER BY c.start_date DESC`, year ? [year] : []);
  res.json(rows);
}));

const schema = z.object({
  name: z.string().trim().min(2).max(200), channel: z.string().min(2).max(30), objective: z.string().nullable().optional(), target_segment: z.string().nullable().optional(),
  start_date: z.string(), end_date: z.string().nullable().optional(), budget: z.number().nullable().optional(), spent: z.number().nullable().optional(), promo_code: z.string().nullable().optional(),
  status: z.enum(['PIANIFICATA', 'ATTIVA', 'CONCLUSA', 'SOSPESA']).optional(), impressions: z.number().int().nullable().optional(), clicks: z.number().int().nullable().optional(), leads: z.number().int().nullable().optional(), bookings: z.number().int().nullable().optional(),
  site_ids: z.array(z.number().int()).optional(), product_ids: z.array(z.number().int()).optional(), promotion_id: z.number().int().nullable().optional(), notes: z.string().nullable().optional(),
});
const J = new Set(['site_ids', 'product_ids']);
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; if (d.promo_code) d.promo_code = d.promo_code.toUpperCase().trim(); return d; };

r.post('/', requireWrite, ah(async (req, res) => {
  const d = clean(parse(schema, req.body));
  if (d.promo_code && await one('SELECT id FROM campaigns WHERE upper(promo_code)=$1', [d.promo_code])) throw bad('Codice promo già usato da un\'altra campagna');
  const cols = [...Object.keys(d), 'created_by'];
  const row = await one(`INSERT INTO campaigns(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, [...Object.keys(d).map((c) => (J.has(c) ? JSON.stringify(d[c]) : d[c])), req.user.id]);
  if (d.promo_code) await q('UPDATE sales SET campaign_id=$1 WHERE campaign_id IS NULL AND upper(promo_code)=$2', [row.id, d.promo_code]);
  await audit(req, 'CAMPAIGN_CREATE', 'campaign', row.id, { name: d.name });
  res.status(201).json(row);
}));

r.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const c = await one(`SELECT ${COLS} FROM campaigns c LEFT JOIN promotions pr ON pr.id=c.promotion_id ${RESULTS} WHERE c.id=$1`, [id]);
  if (!c) throw notFound();
  const trend = await many(`SELECT sale_date AS day, count(DISTINCT external_ref)::int AS tickets, sum(net_amount) AS revenue FROM sales WHERE campaign_id=$1 GROUP BY 1 ORDER BY 1`, [id]);
  const products = await many(`SELECT p.description AS label, sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue FROM sales s JOIN products p ON p.id=s.product_id WHERE s.campaign_id=$1 GROUP BY p.description ORDER BY revenue DESC LIMIT 12`, [id]);
  const sites = await many(`SELECT st.name AS label, count(DISTINCT s.external_ref)::int AS tickets, sum(s.net_amount) AS revenue FROM sales s JOIN sites st ON st.id=s.site_id WHERE s.campaign_id=$1 GROUP BY st.name ORDER BY revenue DESC`, [id]);
  res.json({ ...c, trend, products, sites });
}));

r.put('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = clean(parse(schema.partial(), req.body));
  if (d.promo_code && await one('SELECT id FROM campaigns WHERE upper(promo_code)=$1 AND id<>$2', [d.promo_code, id])) throw bad('Codice promo già usato da un\'altra campagna');
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE campaigns SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => (J.has(c) ? JSON.stringify(d[c]) : d[c]))]);
  if (d.promo_code) await q('UPDATE sales SET campaign_id=$1 WHERE campaign_id IS NULL AND upper(promo_code)=$2', [id, d.promo_code]);
  await audit(req, 'CAMPAIGN_UPDATE', 'campaign', id, d);
  res.json({ ok: true });
}));

r.delete('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  await q('DELETE FROM campaigns WHERE id=$1', [id]);
  await audit(req, 'CAMPAIGN_DELETE', 'campaign', id);
  res.json({ ok: true });
}));

export default r;
