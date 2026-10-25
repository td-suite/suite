import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, notFound, audit, parse, bad } from '../lib/util.js';
import { requireWrite } from '../lib/access.js';
import { generateClaims, DEFAULT_PUSH_PLAN, DEFAULT_MATERIALS } from '../lib/ai.js';
import { promoCalendarToPptx } from '../lib/exports.js';

const r = Router();

const RESULTS = `LEFT JOIN LATERAL (SELECT count(DISTINCT s.external_ref)::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT s.customer_id)::int AS customers,
    count(DISTINCT s.customer_id) FILTER (WHERE cu.first_visit >= p.start_date)::int AS new_customers, coalesce(sum(s.discount),0) AS discount_total
  FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id WHERE s.promotion_id=p.id) r ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS n, count(*) FILTER (WHERE done)::int AS done FROM jsonb_to_recordset(p.push_plan) AS x(done boolean)) pp ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('CONSEGNATO','PUBBLICATO','INVIATO','ATTIVO','FATTO'))::int AS done FROM jsonb_to_recordset(p.materials) AS x(status text)) mm ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS n, count(*) FILTER (WHERE status='INSTALLATO')::int AS ok FROM exposure_items e WHERE e.promotion_id=p.id) ex ON true`;
const COLS = `p.*, r.tickets, r.revenue, r.customers, r.new_customers, r.discount_total, pp.n AS plan_total, pp.done AS plan_done, mm.n AS materials_total, mm.done AS materials_done, ex.n AS exposure_total, ex.ok AS exposure_ok,
  (SELECT count(*)::int FROM campaigns c WHERE c.promotion_id=p.id) AS campaigns`;

const discountLabel = (p) => p.discount_type === 'PERCENTUALE' ? `${Number(p.discount_value)}% di sconto` : p.discount_type === 'PREZZO_FISSO' ? `Prezzo fisso ${Number(p.discount_value).toLocaleString('it-IT')} €` : p.discount_type === 'IMPORTO' ? `${Number(p.discount_value).toLocaleString('it-IT')} € di sconto` : p.discount_type === 'PACCHETTO' ? `Pacchetto a ${Number(p.bundle_price || 0).toLocaleString('it-IT')} €` : p.discount_type === 'OMAGGIO' ? 'Omaggio' : 'Nessuno sconto (servizio)';

r.get('/', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const rows = await many(`SELECT ${COLS} FROM promotions p ${RESULTS} WHERE p.year=$1 ORDER BY p.month, p.id`, [year]);
  res.json(rows.map((p) => ({ ...p, discount_label: discountLabel(p) })));
}));

r.get('/calendar.pptx', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const rows = await many(`SELECT ${COLS} FROM promotions p ${RESULTS} WHERE p.year=$1 AND p.status<>'ANNULLATA' ORDER BY p.month`, [year]);
  const products = await many('SELECT id, code, description FROM products');
  const buf = await promoCalendarToPptx({ year, promotions: rows.map((p) => ({ ...p, discount_label: discountLabel(p) })), products });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="calendario_promozionale_${year}.pptx"`);
  res.send(buf);
}));

const schema = z.object({
  year: z.number().int().min(2024).max(2040), month: z.number().int().min(1).max(12), name: z.string().trim().min(2).max(200), theme: z.string().nullable().optional(), claim: z.string().nullable().optional(), claim_short: z.string().nullable().optional(), body: z.string().nullable().optional(),
  target: z.string().nullable().optional(), channel_scope: z.enum(['B2C', 'B2B', 'ENTRAMBI']).optional(), discount_type: z.enum(['PERCENTUALE', 'IMPORTO', 'PREZZO_FISSO', 'PACCHETTO', 'OMAGGIO', 'NESSUNO']).nullable().optional(), discount_value: z.number().nullable().optional(), bundle_price: z.number().nullable().optional(),
  start_date: z.string().nullable().optional(), end_date: z.string().nullable().optional(), product_ids: z.array(z.number().int()).optional(), site_ids: z.array(z.number().int()).optional(),
  push_plan: z.array(z.object({ channel: z.string(), action: z.string(), when: z.string().nullable().optional(), owner: z.string().nullable().optional(), done: z.boolean().optional() })).optional(),
  materials: z.array(z.object({ type: z.string(), status: z.string(), notes: z.string().nullable().optional() })).optional(),
  kpi_target: z.object({ bookings: z.number().nullable().optional(), revenue: z.number().nullable().optional(), new_customers: z.number().nullable().optional() }).optional(),
  status: z.enum(['BOZZA', 'APPROVATA', 'ATTIVA', 'CONCLUSA', 'ANNULLATA']).optional(), promo_code: z.string().nullable().optional(), notes: z.string().nullable().optional(),
});
const J = new Set(['product_ids', 'site_ids', 'push_plan', 'materials', 'kpi_target']);
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; if (d.promo_code) d.promo_code = d.promo_code.toUpperCase().trim(); return d; };

r.post('/', requireWrite, ah(async (req, res) => {
  const d = clean(parse(schema, req.body));
  if (!d.start_date) d.start_date = `${d.year}-${String(d.month).padStart(2, '0')}-01`;
  if (!d.end_date) d.end_date = new Date(Date.UTC(d.year, d.month, 0)).toISOString().slice(0, 10);
  if (!d.push_plan?.length) d.push_plan = DEFAULT_PUSH_PLAN(d);
  if (!d.materials?.length) d.materials = DEFAULT_MATERIALS();
  if (!d.promo_code) d.promo_code = `PROMO${String(d.year).slice(2)}${String(d.month).padStart(2, '0')}`;
  const cols = [...Object.keys(d), 'created_by'];
  const row = await one(`INSERT INTO promotions(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, [...Object.keys(d).map((c) => (J.has(c) ? JSON.stringify(d[c]) : d[c])), req.user.id]);
  await q('UPDATE sales SET promotion_id=$1 WHERE promotion_id IS NULL AND upper(promo_code)=$2', [row.id, d.promo_code]);
  await audit(req, 'PROMOTION_CREATE', 'promotion', row.id, { name: d.name, month: d.month, year: d.year });
  res.status(201).json(row);
}));

r.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const p = await one(`SELECT ${COLS} FROM promotions p ${RESULTS} WHERE p.id=$1`, [id]);
  if (!p) throw notFound();
  const products = await many('SELECT id, code, description, price FROM products WHERE id = ANY($1::int[])', [p.product_ids || []]);
  const sales_by_product = await many(`SELECT pr.description AS label, sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue FROM sales s JOIN products pr ON pr.id=s.product_id WHERE s.promotion_id=$1 GROUP BY pr.description ORDER BY revenue DESC`, [id]);
  const sales_by_site = await many(`SELECT st.name AS label, count(DISTINCT s.external_ref)::int AS tickets, sum(s.net_amount) AS revenue FROM sales s JOIN sites st ON st.id=s.site_id WHERE s.promotion_id=$1 GROUP BY st.name ORDER BY revenue DESC`, [id]);
  const trend = await many(`SELECT sale_date AS day, count(DISTINCT external_ref)::int AS tickets, sum(net_amount) AS revenue FROM sales WHERE promotion_id=$1 GROUP BY 1 ORDER BY 1`, [id]);
  const campaigns = await many('SELECT id, name, channel, status, budget, spent FROM campaigns WHERE promotion_id=$1 ORDER BY start_date', [id]);
  const exposure = await many(`SELECT e.status, count(*)::int AS n FROM exposure_items e WHERE e.promotion_id=$1 GROUP BY e.status`, [id]);
  // Confronto con lo stesso mese dell'anno precedente sulle stesse prestazioni
  const prev = await one(`SELECT count(DISTINCT s.external_ref)::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue FROM sales s WHERE s.product_id = ANY($1::int[]) AND s.sale_date BETWEEN ($2::date - interval '1 year') AND ($3::date - interval '1 year')`, [p.product_ids || [], p.start_date, p.end_date]);
  res.json({ ...p, discount_label: discountLabel(p), products, sales_by_product, sales_by_site, trend, campaigns, exposure, prev_year: prev });
}));

r.put('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = clean(parse(schema.partial(), req.body));
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE promotions SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => (J.has(c) ? JSON.stringify(d[c]) : d[c]))]);
  if (d.promo_code) await q('UPDATE sales SET promotion_id=$1 WHERE promotion_id IS NULL AND upper(promo_code)=$2', [id, d.promo_code]);
  await audit(req, 'PROMOTION_UPDATE', 'promotion', id, Object.keys(d));
  res.json({ ok: true });
}));

r.delete('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  await q('DELETE FROM promotions WHERE id=$1', [id]);
  await audit(req, 'PROMOTION_DELETE', 'promotion', id);
  res.json({ ok: true });
}));

// Proposte di claim (API Claude se configurata, altrimenti schemi)
r.post('/:id/claims', requireWrite, ah(async (req, res) => {
  const p = await one('SELECT * FROM promotions WHERE id=$1', [Number(req.params.id)]);
  if (!p) throw notFound();
  const products = await many('SELECT id, code, description, price FROM products WHERE id = ANY($1::int[])', [p.product_ids || []]);
  res.json(await generateClaims(p, products));
}));

// Duplica il calendario di un anno sull'anno successivo (bozze)
r.post('/clone-year', requireWrite, ah(async (req, res) => {
  const { from, to } = parse(z.object({ from: z.number().int(), to: z.number().int() }), req.body);
  if ((await one('SELECT count(*)::int AS n FROM promotions WHERE year=$1', [to])).n > 0) throw bad(`L'anno ${to} ha già promozioni`);
  const rows = await many('SELECT * FROM promotions WHERE year=$1 AND status<>\'ANNULLATA\' ORDER BY month', [from]);
  for (const p of rows) {
    const d = { ...p, year: to, status: 'BOZZA', start_date: `${to}-${String(p.month).padStart(2, '0')}-01`, end_date: new Date(Date.UTC(to, p.month, 0)).toISOString().slice(0, 10), promo_code: `PROMO${String(to).slice(2)}${String(p.month).padStart(2, '0')}` };
    d.push_plan = DEFAULT_PUSH_PLAN(d); d.materials = DEFAULT_MATERIALS();
    await q(`INSERT INTO promotions(year, month, name, theme, claim, claim_short, body, target, channel_scope, discount_type, discount_value, bundle_price, start_date, end_date, product_ids, site_ids, push_plan, materials, kpi_target, status, promo_code, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [d.year, d.month, d.name, d.theme, d.claim, d.claim_short, d.body, d.target, d.channel_scope, d.discount_type, d.discount_value, d.bundle_price, d.start_date, d.end_date, JSON.stringify(d.product_ids), JSON.stringify(d.site_ids), JSON.stringify(d.push_plan), JSON.stringify(d.materials), JSON.stringify(d.kpi_target), d.status, d.promo_code, d.notes, req.user.id]);
  }
  await audit(req, 'PROMOTION_CLONE_YEAR', 'promotion', null, { from, to, n: rows.length });
  res.json({ ok: true, created: rows.length });
}));

export default r;
