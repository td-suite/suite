import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireWrite, Params } from '../lib/access.js';
import { getSettings } from './admin.js';
import { toXlsx } from '../lib/exports.js';
import { refreshCustomerStats } from '../lib/customers.js';

const r = Router();

const BASE = `SELECT c.id, c.kind, c.source, c.external_id, c.last_name, c.first_name, c.sex, c.birth_date, c.tax_code, c.company_name, c.vat_number, c.sector, c.b2b_type, c.contact_name, c.employees,
  c.email, c.phone, c.address, c.zip, c.city, c.province, c.home_site_id, s.name AS home_site_name, c.acquisition_channel, c.marketing_consent, c.first_visit, c.last_visit, c.visits, c.revenue, c.tags, c.notes, c.created_at,
  CASE WHEN c.birth_date IS NULL THEN NULL ELSE date_part('year', age(c.birth_date))::int END AS age,
  CASE WHEN c.last_visit IS NULL THEN 'MAI' WHEN c.last_visit < CURRENT_DATE - ($CHURN || ' days')::interval THEN 'DORMIENTE' WHEN c.visits >= 2 THEN 'RICORRENTE' WHEN c.first_visit >= CURRENT_DATE - interval '90 days' THEN 'NUOVO' ELSE 'OCCASIONALE' END AS segment
  FROM customers c LEFT JOIN sites s ON s.id=c.home_site_id`;

function listQuery(query, settings) {
  const p = new Params();
  const w = [];
  const kind = query.kind === 'B2B' ? 'B2B' : query.kind === 'B2C' ? 'B2C' : null;
  if (kind) w.push(`c.kind=${p.add(kind)}`);
  if (query.q) { const t = p.add(`%${query.q}%`); w.push(`(c.last_name ILIKE ${t} OR c.first_name ILIKE ${t} OR (c.last_name || ' ' || c.first_name) ILIKE ${t} OR c.company_name ILIKE ${t} OR c.tax_code ILIKE ${t} OR c.vat_number ILIKE ${t} OR c.email ILIKE ${t} OR c.city ILIKE ${t} OR c.external_id ILIKE ${t})`); }
  if (query.sex) w.push(`c.sex=${p.add(query.sex)}`);
  if (query.province) w.push(`c.province=${p.add(query.province.toUpperCase())}`);
  if (query.city) w.push(`lower(c.city)=lower(${p.add(query.city)})`);
  if (query.site_id) w.push(`c.home_site_id=${p.add(Number(query.site_id))}`);
  if (query.channel) w.push(`c.acquisition_channel=${p.add(query.channel)}`);
  if (query.b2b_type) w.push(`c.b2b_type=${p.add(query.b2b_type)}`);
  if (query.consent === '1') w.push('c.marketing_consent IS TRUE');
  if (query.age_from) w.push(`c.birth_date <= CURRENT_DATE - (${p.add(Number(query.age_from))} || ' years')::interval`);
  if (query.age_to) w.push(`c.birth_date > CURRENT_DATE - (${p.add(Number(query.age_to) + 1)} || ' years')::interval`);
  if (query.product_id) w.push(`EXISTS (SELECT 1 FROM sales x WHERE (x.customer_id=c.id OR x.b2b_customer_id=c.id) AND x.product_id=${p.add(Number(query.product_id))})`);
  if (query.line_id) w.push(`EXISTS (SELECT 1 FROM sales x JOIN products pr ON pr.id=x.product_id WHERE (x.customer_id=c.id OR x.b2b_customer_id=c.id) AND pr.line_id=${p.add(Number(query.line_id))})`);
  if (query.campaign_id) w.push(`(c.acquisition_campaign_id=${p.add(Number(query.campaign_id))} OR EXISTS (SELECT 1 FROM sales x WHERE x.customer_id=c.id AND x.campaign_id=${p.add(Number(query.campaign_id))}))`);
  if (query.promotion_id) w.push(`EXISTS (SELECT 1 FROM sales x WHERE x.customer_id=c.id AND x.promotion_id=${p.add(Number(query.promotion_id))})`);
  if (query.last_visit_before) w.push(`c.last_visit < ${p.add(query.last_visit_before)}`);
  if (query.last_visit_after) w.push(`c.last_visit >= ${p.add(query.last_visit_after)}`);
  const churn = Number(settings.churn_days || 540);
  let sql = `${BASE.replace('$CHURN', String(churn))} ${w.length ? `WHERE ${w.join(' AND ')}` : ''}`;
  if (query.segment) sql = `SELECT * FROM (${sql}) t WHERE t.segment=${p.add(query.segment)}`;
  return { sql, params: p.values };
}

const SORT = { name: 'coalesce(last_name, company_name), first_name', revenue: 'revenue DESC', visits: 'visits DESC', last_visit: 'last_visit DESC NULLS LAST', first_visit: 'first_visit DESC NULLS LAST', age: 'birth_date DESC NULLS LAST', city: 'city, last_name' };

r.get('/', ah(async (req, res) => {
  const settings = await getSettings();
  const { sql, params } = listQuery(req.query, settings);
  const limit = Math.min(500, Number(req.query.limit || 200)); const offset = Math.max(0, Number(req.query.offset || 0));
  const order = SORT[req.query.sort] || SORT.name;
  const rows = await many(`SELECT * FROM (${sql}) t ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);
  const tot = await one(`SELECT count(*)::int AS n, coalesce(sum(revenue),0) AS revenue FROM (${sql}) t`, params);
  res.json({ rows, total: tot.n, revenue: tot.revenue, limit, offset });
}));

r.get('/export.xlsx', ah(async (req, res) => {
  const settings = await getSettings();
  const { sql, params } = listQuery(req.query, settings);
  const rows = await many(`SELECT * FROM (${sql}) t ORDER BY ${SORT.name} LIMIT 20000`, params);
  const buf = await toXlsx([{ name: 'Clienti', columns: [
    { header: 'Tipo', key: 'kind' }, { header: 'Cognome', key: 'last_name' }, { header: 'Nome', key: 'first_name' }, { header: 'Ragione sociale', key: 'company_name', width: 32 }, { header: 'Sesso', key: 'sex' }, { header: 'Età', key: 'age', int: true },
    { header: 'Comune', key: 'city' }, { header: 'Prov.', key: 'province' }, { header: 'CAP', key: 'zip' }, { header: 'Email', key: 'email', width: 28 }, { header: 'Telefono', key: 'phone' }, { header: 'Consenso mkt', key: 'marketing_consent' },
    { header: 'Sede di riferimento', key: 'home_site_name', width: 30 }, { header: 'Canale', key: 'acquisition_channel' }, { header: 'Segmento', key: 'segment' }, { header: 'Prima visita', key: 'first_visit', date: true }, { header: 'Ultima visita', key: 'last_visit', date: true }, { header: 'Visite', key: 'visits', int: true }, { header: 'Fatturato', key: 'revenue', money: true }, { header: 'Origine', key: 'source' }, { header: 'ID esterno', key: 'external_id' },
  ], rows }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="clienti_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
}));

// Valori distinti per i filtri
r.get('/facets', ah(async (_req, res) => {
  const [provinces, cities, channels, sectors] = await Promise.all([
    many(`SELECT province AS v, count(*)::int AS n FROM customers WHERE province IS NOT NULL GROUP BY province ORDER BY n DESC LIMIT 30`),
    many(`SELECT city AS v, count(*)::int AS n FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY n DESC LIMIT 60`),
    many(`SELECT acquisition_channel AS v, count(*)::int AS n FROM customers WHERE acquisition_channel IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
    many(`SELECT sector AS v, count(*)::int AS n FROM customers WHERE sector IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
  ]);
  res.json({ provinces, cities, channels, sectors });
}));

const schema = z.object({
  kind: z.enum(['B2C', 'B2B']), last_name: z.string().nullable().optional(), first_name: z.string().nullable().optional(), sex: z.enum(['F', 'M']).nullable().optional(), birth_date: z.string().nullable().optional(), tax_code: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(), vat_number: z.string().nullable().optional(), sector: z.string().nullable().optional(), b2b_type: z.string().nullable().optional(), contact_name: z.string().nullable().optional(), employees: z.number().int().nullable().optional(),
  email: z.string().nullable().optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(), province: z.string().max(2).nullable().optional(),
  home_site_id: z.number().int().nullable().optional(), acquisition_channel: z.string().nullable().optional(), acquisition_campaign_id: z.number().int().nullable().optional(), marketing_consent: z.boolean().nullable().optional(), tags: z.array(z.string()).optional(), notes: z.string().nullable().optional(),
});
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; if (d.tax_code) d.tax_code = d.tax_code.toUpperCase(); if (d.province) d.province = d.province.toUpperCase(); return d; };

r.post('/', requireWrite, ah(async (req, res) => {
  const d = clean(parse(schema, req.body));
  if (d.kind === 'B2C' && !(d.last_name && d.first_name)) throw bad('Cognome e nome obbligatori');
  if (d.kind === 'B2B' && !d.company_name) throw bad('Ragione sociale obbligatoria');
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO customers(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((c) => (c === 'tags' ? JSON.stringify(d[c]) : d[c])));
  await audit(req, 'CUSTOMER_CREATE', 'customer', row.id);
  res.status(201).json(row);
}));

r.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const settings = await getSettings();
  const c = await one(`SELECT * FROM (${BASE.replace('$CHURN', String(Number(settings.churn_days || 540)))}) t WHERE t.id=$1`, [id]);
  if (!c) throw notFound();
  const sales = await many(`SELECT s.*, p.description AS product_description, pl.name AS line_name, pl.code AS line_code, st.name AS site_name, cp.name AS campaign_name, pr.name AS promotion_name
    FROM sales s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN product_lines pl ON pl.id=p.line_id LEFT JOIN sites st ON st.id=s.site_id LEFT JOIN campaigns cp ON cp.id=s.campaign_id LEFT JOIN promotions pr ON pr.id=s.promotion_id
    WHERE s.customer_id=$1 OR s.b2b_customer_id=$1 ORDER BY s.sale_date DESC, s.external_ref, s.line_no LIMIT 1000`, [id]);
  const by_line = await many(`SELECT pl.name AS label, count(*)::int AS count, sum(s.net_amount) AS revenue FROM sales s JOIN products p ON p.id=s.product_id JOIN product_lines pl ON pl.id=p.line_id WHERE s.customer_id=$1 OR s.b2b_customer_id=$1 GROUP BY pl.name, pl.sort_order ORDER BY pl.sort_order`, [id]);
  const by_site = await many(`SELECT st.name AS label, count(DISTINCT s.external_ref)::int AS count, sum(s.net_amount) AS revenue FROM sales s JOIN sites st ON st.id=s.site_id WHERE s.customer_id=$1 OR s.b2b_customer_id=$1 GROUP BY st.name ORDER BY revenue DESC`, [id]);
  // Richiami: prestazioni periodiche già eseguite, con la prossima scadenza stimata
  const recalls = await many(`SELECT p.id AS product_id, p.code, p.description, p.periodicity_months, max(s.sale_date) AS last_date, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due_date
    FROM sales s JOIN products p ON p.id=s.product_id WHERE s.customer_id=$1 AND p.periodicity_months IS NOT NULL GROUP BY p.id ORDER BY due_date`, [id]);
  // Suggerimenti cross-selling: prodotti più acquistati dai clienti simili (stesso sesso e fascia d'età) non ancora acquistati
  const suggestions = c.kind === 'B2C' ? await many(`SELECT p.id, p.code, p.description, count(*)::int AS n FROM sales s JOIN products p ON p.id=s.product_id JOIN customers o ON o.id=s.customer_id
    WHERE o.id<>$1 AND o.sex IS NOT DISTINCT FROM $2 AND o.birth_date BETWEEN $3::date - interval '7 years' AND $3::date + interval '7 years'
      AND p.id NOT IN (SELECT product_id FROM sales WHERE customer_id=$1 AND product_id IS NOT NULL) AND p.line_id IN (SELECT id FROM product_lines WHERE code IN ('PAC','SPEC','IMG'))
    GROUP BY p.id ORDER BY n DESC LIMIT 5`, [id, c.sex, c.birth_date || '1970-01-01']) : [];
  res.json({ ...c, sales, by_line, by_site, recalls, suggestions });
}));

r.put('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = clean(parse(schema.partial(), req.body));
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE customers SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => (c === 'tags' ? JSON.stringify(d[c]) : d[c]))]);
  await audit(req, 'CUSTOMER_UPDATE', 'customer', id, d);
  res.json({ ok: true });
}));

r.delete('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM sales WHERE customer_id=$1 OR b2b_customer_id=$1', [id])).n;
  if (n > 0) throw bad(`Il cliente ha ${n} righe di vendita collegate: non può essere eliminato`);
  await q('DELETE FROM customers WHERE id=$1', [id]);
  await audit(req, 'CUSTOMER_DELETE', 'customer', id);
  res.json({ ok: true });
}));

// Unione di duplicati: sposta le vendite sul cliente principale ed elimina il secondario
r.post('/:id/merge', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id); const { other_id } = parse(z.object({ other_id: z.number().int() }), req.body);
  if (id === other_id) throw bad('Scegli un cliente diverso');
  await q('UPDATE sales SET customer_id=$1 WHERE customer_id=$2', [id, other_id]);
  await q('UPDATE sales SET b2b_customer_id=$1 WHERE b2b_customer_id=$2', [id, other_id]);
  await q('DELETE FROM customers WHERE id=$1', [other_id]);
  await refreshCustomerStats([id]);
  await audit(req, 'CUSTOMER_MERGE', 'customer', id, { other_id });
  res.json({ ok: true });
}));

export default r;
