import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireWrite, Params } from '../lib/access.js';
import { toXlsx } from '../lib/exports.js';

const r = Router();

// Elenco con performance nel periodo (default: ultimi 12 mesi) e confronto con il periodo precedente
r.get('/', ah(async (req, res) => {
  const p = new Params();
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(new Date(to).getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));
  const pf = p.add(from); const pt = p.add(to); const pd = p.add(days);
  const w = ['1=1'];
  if (req.query.q) { const t = p.add(`%${req.query.q}%`); w.push(`(pr.code ILIKE ${t} OR pr.description ILIKE ${t} OR pr.specialty ILIKE ${t})`); }
  if (req.query.line_id) w.push(`pr.line_id=${p.add(Number(req.query.line_id))}`);
  if (req.query.sector) w.push(`pr.sector=${p.add(req.query.sector)}`);
  if (req.query.sold === '1') w.push('coalesce(cur.qty,0) > 0');
  if (req.query.active !== 'all') w.push('pr.active');
  if (req.query.site_id) { const s = p.add(Number(req.query.site_id)); w.push(`EXISTS (SELECT 1 FROM sales x WHERE x.product_id=pr.id AND x.site_id=${s})`); }
  const siteFilter = req.query.site_id ? `AND s.site_id=${p.add(Number(req.query.site_id))}` : '';
  const kindFilter = req.query.kind === 'B2B' ? 'AND s.b2b_customer_id IS NOT NULL' : req.query.kind === 'B2C' ? 'AND s.customer_id IS NOT NULL' : '';
  const rows = await many(`SELECT pr.*, pl.name AS line_name, pl.code AS line_code, pl.color AS line_color,
      coalesce(cur.qty,0) AS qty, coalesce(cur.revenue,0) AS revenue, coalesce(cur.customers,0) AS customers, coalesce(cur.discount,0) AS discount,
      coalesce(prev.qty,0) AS qty_prev, coalesce(prev.revenue,0) AS revenue_prev,
      CASE WHEN nullif(pr.cost,0) IS NOT NULL AND cur.qty > 0 THEN cur.revenue - pr.cost * cur.qty END AS margin,
      CASE WHEN nullif(pr.cost,0) IS NOT NULL AND cur.qty > 0 AND cur.revenue > 0 THEN round(((cur.revenue - pr.cost * cur.qty) / cur.revenue * 100)::numeric, 1) END AS margin_pct
    FROM products pr LEFT JOIN product_lines pl ON pl.id=pr.line_id
    LEFT JOIN LATERAL (SELECT sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue, sum(s.discount) AS discount, count(DISTINCT coalesce(s.customer_id, s.b2b_customer_id))::int AS customers FROM sales s WHERE s.product_id=pr.id AND s.sale_date BETWEEN ${pf} AND ${pt} ${siteFilter} ${kindFilter}) cur ON true
    LEFT JOIN LATERAL (SELECT sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue FROM sales s WHERE s.product_id=pr.id AND s.sale_date BETWEEN ${pf}::date - (${pd} || ' days')::interval AND ${pf}::date - interval '1 day' ${siteFilter} ${kindFilter}) prev ON true
    WHERE ${w.join(' AND ')} ORDER BY revenue DESC, pr.description`, p.values);
  const sectors = await many('SELECT sector AS label, count(*)::int AS n FROM products WHERE sector IS NOT NULL GROUP BY 1 ORDER BY 1');
  res.json({ rows, from, to, sectors });
}));

r.get('/export.xlsx', ah(async (req, res) => {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(new Date(to).getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const rows = await many(`SELECT pr.code, pr.description, pl.name AS line, pr.sector, pr.specialty, pr.destination, pr.price, pr.price_mdl, pr.price_service, pr.cost, coalesce(c.qty,0) AS qty, coalesce(c.revenue,0) AS revenue, CASE WHEN nullif(pr.cost,0) IS NOT NULL THEN coalesce(c.revenue,0) - pr.cost * coalesce(c.qty,0) END AS margin, coalesce(c.customers,0) AS customers
    FROM products pr LEFT JOIN product_lines pl ON pl.id=pr.line_id LEFT JOIN LATERAL (SELECT sum(quantity)::int AS qty, sum(net_amount) AS revenue, count(DISTINCT coalesce(customer_id,b2b_customer_id))::int AS customers FROM sales s WHERE s.product_id=pr.id AND s.sale_date BETWEEN $1 AND $2) c ON true WHERE pr.active ORDER BY revenue DESC`, [from, to]);
  const buf = await toXlsx([{ name: 'Prestazioni', columns: [{ header: 'Codice', key: 'code' }, { header: 'Prestazione', key: 'description', width: 44 }, { header: 'Linea', key: 'line', width: 26 }, { header: 'Settore', key: 'sector', width: 22 }, { header: 'Settore clinico', key: 'specialty', width: 26 }, { header: 'Destinazione', key: 'destination', width: 22 }, { header: 'Listino privati', key: 'price', money: true }, { header: 'Listino MDL', key: 'price_mdl', money: true }, { header: 'Listino service', key: 'price_service', money: true }, { header: 'Costo', key: 'cost', money: true }, { header: 'Quantità', key: 'qty', int: true }, { header: 'Fatturato', key: 'revenue', money: true }, { header: 'Margine', key: 'margin', money: true }, { header: 'Clienti', key: 'customers', int: true }], rows, totals: { qty: rows.reduce((a, x) => a + x.qty, 0), revenue: rows.reduce((a, x) => a + Number(x.revenue), 0) } }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="prestazioni_${from}_${to}.xlsx"`);
  res.send(buf);
}));

const schema = z.object({
  code: z.string().trim().min(1).max(30), description: z.string().trim().min(2).max(250), line_id: z.number().int().nullable().optional(), specialty: z.string().nullable().optional(), nomenclature: z.string().nullable().optional(),
  price: z.number().nullable().optional(), price_ssn: z.number().nullable().optional(), cost: z.number().nullable().optional(), duration_min: z.number().int().nullable().optional(), is_package: z.boolean().optional(), periodicity_months: z.number().int().nullable().optional(), active: z.boolean().optional(),
  sector: z.string().nullable().optional(), sector_clinical: z.string().nullable().optional(), destination: z.string().nullable().optional(), price_mdl: z.number().nullable().optional(), price_service: z.number().nullable().optional(), cost_service: z.number().nullable().optional(), is_vet: z.boolean().optional(), exclude_from_counts: z.boolean().optional(),
});
r.post('/', requireWrite, ah(async (req, res) => {
  const d = parse(schema, req.body);
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO products(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => d[c]));
  await audit(req, 'PRODUCT_CREATE', 'product', row.id, d);
  res.status(201).json(row);
}));
r.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const pr = await one('SELECT pr.*, pl.name AS line_name FROM products pr LEFT JOIN product_lines pl ON pl.id=pr.line_id WHERE pr.id=$1', [id]);
  if (!pr) throw notFound();
  const trend = await many(`SELECT to_char(date_trunc('month', sale_date), 'YYYY-MM') AS month, sum(quantity)::int AS qty, sum(net_amount) AS revenue FROM sales WHERE product_id=$1 AND sale_date >= date_trunc('month', CURRENT_DATE) - interval '11 months' GROUP BY 1 ORDER BY 1`, [id]);
  const by_site = await many(`SELECT st.name AS label, sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue FROM sales s JOIN sites_v st ON st.id=s.site_id WHERE s.product_id=$1 AND s.sale_date >= CURRENT_DATE - interval '12 months' GROUP BY st.name ORDER BY revenue DESC`, [id]);
  const by_sex = await many(`SELECT coalesce(c.sex, s.patient_sex, 'n.d.') AS label, count(*)::int AS count FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.product_id=$1 AND s.sale_date >= CURRENT_DATE - interval '12 months' GROUP BY 1`, [id]);
  const by_age = await many(`SELECT CASE WHEN coalesce(c.birth_date, s.patient_birth_date) IS NULL THEN 'n.d.' ELSE (width_bucket(date_part('year', age(coalesce(c.birth_date, s.patient_birth_date))), ARRAY[18,30,45,60,75]) ) ::text END AS bucket, count(*)::int AS count FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.product_id=$1 AND s.sale_date >= CURRENT_DATE - interval '12 months' GROUP BY 1 ORDER BY 1`, [id]);
  const by_b2b = await many(`SELECT coalesce(b.group_name, b.company_name) AS label, sum(s.quantity)::int AS qty, sum(s.net_amount) AS revenue, round(avg(s.net_amount)::numeric, 2) AS avg_price FROM sales s JOIN customers b ON b.id=s.b2b_customer_id WHERE s.product_id=$1 AND s.sale_date >= CURRENT_DATE - interval '12 months' GROUP BY 1 ORDER BY revenue DESC LIMIT 10`, [id]);
  const basket = await many(`SELECT p2.id, p2.code, p2.description, count(*)::int AS n FROM sales a JOIN sales b ON b.external_ref=a.external_ref AND b.source=a.source AND b.product_id<>a.product_id JOIN products p2 ON p2.id=b.product_id WHERE a.product_id=$1 AND a.sale_date >= CURRENT_DATE - interval '12 months' GROUP BY p2.id ORDER BY n DESC LIMIT 8`, [id]);
  res.json({ ...pr, trend, by_site, by_sex, by_age, by_b2b, basket });
}));
r.put('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(schema.partial(), req.body);
  if (d.cost !== undefined) { d.cost_source = 'MANUALE'; d.cost_updated_at = new Date(); }
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'PRODUCT_UPDATE', 'product', id, d);
  res.json({ ok: true });
}));
r.delete('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM sales WHERE product_id=$1', [id])).n;
  if (n > 0) throw bad('La prestazione ha vendite collegate: disattivala invece di eliminarla');
  await q('DELETE FROM products WHERE id=$1', [id]);
  res.json({ ok: true });
}));

export default r;
