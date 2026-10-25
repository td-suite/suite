import { Router } from 'express';
import { one, many } from '../db.js';
import { ah } from '../lib/util.js';
import { Params } from '../lib/access.js';
import { getSettings } from './admin.js';

const r = Router();

function period(query) {
  const to = query.to || new Date().toISOString().slice(0, 10);
  const from = query.from || `${to.slice(0, 4)}-01-01`;
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(from).getTime() - days * 86400000).toISOString().slice(0, 10);
  return { from, to, days, prevFrom, prevTo };
}
function scope(query, p) {
  const w = [];
  if (query.site_id) w.push(`s.site_id=${p.add(Number(query.site_id))}`);
  if (query.kind === 'B2B') w.push('s.b2b_customer_id IS NOT NULL'); else if (query.kind === 'B2C') w.push('s.customer_id IS NOT NULL');
  if (query.line_id) w.push(`s.product_id IN (SELECT id FROM products WHERE line_id=${p.add(Number(query.line_id))})`);
  // i clienti B2B interni (passaggi tra sedi TD, convenzioni interne) non sono fatturato
  if (query.include_internal !== '1') w.push("(s.b2b_customer_id IS NULL OR s.b2b_customer_id NOT IN (SELECT id FROM customers WHERE b2b_type='INTERNO'))");
  return w.length ? `AND ${w.join(' AND ')}` : '';
}

r.get('/summary', ah(async (req, res) => {
  const settings = await getSettings();
  const { from, to, days, prevFrom, prevTo } = period(req.query);
  // ogni query costruisce i propri parametri (PostgreSQL rifiuta i parametri non referenziati)
  const ctx = (prev = false) => { const p = new Params(); const F = p.add(from); const T = p.add(to); const PF = prev ? p.add(prevFrom) : null; const PT = prev ? p.add(prevTo) : null; return { p, F, T, PF, PT, sc: scope(req.query, p) }; };
  const bands = (settings.age_bands || '0-17,18-29,30-44,45-59,60-74,75+').split(',').map((x) => x.trim());
  const bandFor = (col) => `CASE WHEN ${col} IS NULL THEN 'n.d.' ${bands.map((b) => { const [lo, hi] = b.includes('+') ? [Number(b.replace('+', '')), 200] : b.split('-').map(Number); return `WHEN date_part('year', age(s.sale_date, ${col})) BETWEEN ${lo} AND ${hi} THEN '${b}'`; }).join(' ')} ELSE 'n.d.' END`;
  const bandSql = bandFor('c.birth_date');

  const kpi = async (from_, to_) => { const pk = new Params(); const f = pk.add(from_); const t = pk.add(to_); const sck = scope(req.query, pk); return one(`SELECT coalesce(sum(s.net_amount),0) AS revenue, coalesce(sum(s.gross_amount),0) AS gross, coalesce(sum(s.discount),0) AS discount, count(DISTINCT (s.source, s.external_ref))::int AS tickets, coalesce(sum(s.quantity) FILTER (WHERE NOT coalesce(pq.exclude_from_counts,false)),0)::int AS items,
      count(DISTINCT s.customer_id)::int AS customers, count(DISTINCT s.b2b_customer_id)::int AS b2b_customers,
      coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NOT NULL),0) AS invoiced, coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NULL),0) AS uninvoiced, count(DISTINCT s.invoice_ref)::int AS invoices,
      coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS cost, coalesce(sum(s.net_amount) FILTER (WHERE nullif(pq.cost,0) IS NOT NULL),0) AS revenue_costed, coalesce(sum(s.quantity) FILTER (WHERE nullif(pq.cost,0) IS NULL AND NOT coalesce(pq.exclude_from_counts,false)),0)::int AS items_uncosted,
      count(DISTINCT s.patient_ref)::int AS patients,
      coalesce(sum(s.net_amount) FILTER (WHERE s.customer_id IS NOT NULL),0) AS revenue_b2c, coalesce(sum(s.net_amount) FILTER (WHERE s.b2b_customer_id IS NOT NULL),0) AS revenue_b2b,
      count(DISTINCT s.customer_id) FILTER (WHERE cu.first_visit BETWEEN ${f} AND ${t})::int AS new_customers,
      count(DISTINCT s.customer_id) FILTER (WHERE cu.first_visit < ${f})::int AS returning_customers
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id LEFT JOIN products pq ON pq.id=s.product_id WHERE s.sale_date BETWEEN ${f} AND ${t} ${sck}`, pk.values); };
  const cur = await kpi(from, to); const prev = await kpi(prevFrom, prevTo);

  const tc = ctx();
  const trend = await many(`SELECT to_char(date_trunc('month', s.sale_date), 'YYYY-MM') AS month, coalesce(sum(s.net_amount) FILTER (WHERE s.customer_id IS NOT NULL),0) AS b2c, coalesce(sum(s.net_amount) FILTER (WHERE s.b2b_customer_id IS NOT NULL),0) AS b2b,
      count(DISTINCT (s.source, s.external_ref))::int AS tickets, count(DISTINCT s.customer_id)::int AS customers, count(DISTINCT s.customer_id) FILTER (WHERE date_trunc('month', cu.first_visit)=date_trunc('month', s.sale_date))::int AS new_customers,
      coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NOT NULL),0) AS invoiced, coalesce(sum(s.net_amount),0) - coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS margin, coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS cost
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id LEFT JOIN products pq ON pq.id=s.product_id WHERE s.sale_date >= (${tc.F}::date - interval '12 months') AND s.sale_date <= ${tc.T} ${tc.sc} GROUP BY 1 ORDER BY 1`, tc.p.values);
  const group = (expr, join = '', order = 'revenue DESC', limit = 50) => { const { p, F, T, sc } = ctx(); return many(`SELECT ${expr} AS label, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT (s.source, s.external_ref))::int AS tickets, count(DISTINCT coalesce(s.customer_id, s.b2b_customer_id))::int AS customers, coalesce(sum(s.quantity) FILTER (WHERE NOT coalesce(pq.exclude_from_counts,false)),0)::int AS items,
      coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS cost, coalesce(sum(s.net_amount),0) - coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS margin, coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NOT NULL),0) AS invoiced
    FROM sales s LEFT JOIN products pq ON pq.id=s.product_id ${join} WHERE s.sale_date BETWEEN ${F} AND ${T} ${sc} GROUP BY 1 ORDER BY ${order} LIMIT ${limit}`, p.values); };
  const [by_line, by_site, by_channel, by_payment, by_sex, by_age, by_province, by_city, by_weekday, by_hour, by_source, by_b2b_type, by_sector, by_destination] = await Promise.all([
    group('coalesce(pl.name, \'Altro\')', 'LEFT JOIN product_lines pl ON pl.id=pq.line_id', 'min(pl.sort_order)'),
    group('st.name', 'JOIN sites st ON st.id=s.site_id'),
    group('coalesce(s.booking_channel, \'n.d.\')'),
    group('coalesce(s.payment_kind, \'n.d.\')'),
    group('coalesce(c.sex, \'n.d.\')', 'JOIN customers c ON c.id=s.customer_id'),
    group(bandSql, 'JOIN customers c ON c.id=s.customer_id', 'label'),
    group('coalesce(c.province, \'n.d.\')', 'JOIN customers c ON c.id=s.customer_id', 'revenue DESC', 12),
    group('coalesce(c.city, \'n.d.\') || coalesce(\' (\' || c.province || \')\', \'\')', 'JOIN customers c ON c.id=s.customer_id', 'revenue DESC', 15),
    group('extract(isodow FROM s.sale_date)::int', '', 'label'),
    group('extract(hour FROM s.sale_time)::int', '', 'label'),
    group('s.source'),
    group('coalesce(b.b2b_type, \'n.d.\')', 'JOIN customers b ON b.id=s.b2b_customer_id'),
    group('coalesce(pq.sector, \'Altro\')', '', 'revenue DESC', 20),
    group('coalesce(pq.destination, \'n.d.\')', '', 'revenue DESC', 20),
  ]);
  const lim = Number(settings.top_products_limit || 15);
  const prodSql = (order, costedOnly = false) => { const { p, F, T, PF, PT, sc } = ctx(true); return many(`SELECT pr.id, pr.code, pr.description AS label, pl.name AS line_name, pl.color, pr.sector, nullif(pr.cost,0) AS unit_cost, coalesce(sum(s.net_amount),0) AS revenue, sum(s.quantity)::int AS items, count(DISTINCT coalesce(s.customer_id, s.b2b_customer_id))::int AS customers,
      coalesce(sum(s.net_amount),0) - coalesce(sum(nullif(pr.cost,0) * s.quantity),0) AS margin, coalesce(sum(nullif(pr.cost,0) * s.quantity),0) AS cost,
      coalesce(prev.revenue,0) AS revenue_prev
    FROM products pr LEFT JOIN product_lines pl ON pl.id=pr.line_id JOIN sales s ON s.product_id=pr.id AND s.sale_date BETWEEN ${F} AND ${T} ${sc}
    LEFT JOIN LATERAL (SELECT sum(x.net_amount) AS revenue FROM sales x WHERE x.product_id=pr.id AND x.sale_date BETWEEN ${PF} AND ${PT}) prev ON true
    WHERE ${costedOnly ? 'nullif(pr.cost,0) IS NOT NULL' : 'true'} GROUP BY pr.id, pl.name, pl.color, prev.revenue ORDER BY ${order} LIMIT ${lim}`, p.values); };
  const [top_products, bottom_products, top_margin_products, low_margin_products] = await Promise.all([prodSql('revenue DESC'), prodSql('revenue ASC'), prodSql('margin DESC', true), prodSql('margin ASC', true)]);
  const { p, F, T, sc } = ctx();
  const top_b2b = await many(`SELECT min(b.id) AS id, coalesce(b.group_name, b.company_name) AS label, min(b.b2b_type) AS b2b_type, count(DISTINCT b.id)::int AS accounts, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT (s.source, s.external_ref))::int AS tickets, coalesce(sum(s.quantity) FILTER (WHERE NOT coalesce(pq.exclude_from_counts,false)),0)::int AS items, count(DISTINCT s.patient_ref)::int AS patients,
      coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS cost, coalesce(sum(s.net_amount),0) - coalesce(sum(nullif(pq.cost,0) * s.quantity),0) AS margin, coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NOT NULL),0) AS invoiced, coalesce(sum(s.net_amount) FILTER (WHERE s.invoice_ref IS NULL),0) AS uninvoiced
    FROM sales s JOIN customers b ON b.id=s.b2b_customer_id LEFT JOIN products pq ON pq.id=s.product_id WHERE s.sale_date BETWEEN ${F} AND ${T} ${sc} GROUP BY 2 ORDER BY revenue DESC LIMIT 15`, p.values);
  const top_customers = await many(`SELECT c.id, c.last_name || ' ' || coalesce(c.first_name,'') AS label, c.city, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT (s.source, s.external_ref))::int AS tickets FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.sale_date BETWEEN ${F} AND ${T} ${sc} GROUP BY c.id ORDER BY revenue DESC LIMIT 10`, p.values);

  const churn = Number(settings.churn_days || 540);
  const base = await one(`SELECT count(*) FILTER (WHERE kind='B2C')::int AS b2c, count(*) FILTER (WHERE kind='B2B')::int AS b2b, count(*) FILTER (WHERE kind='B2C' AND marketing_consent)::int AS consent,
      count(*) FILTER (WHERE kind='B2C' AND last_visit < CURRENT_DATE - interval '${churn} days')::int AS dormant,
      count(*) FILTER (WHERE kind='B2C' AND visits >= 2)::int AS recurring, round(avg(date_part('year', age(birth_date))) FILTER (WHERE kind='B2C' AND birth_date IS NOT NULL))::int AS avg_age
    FROM customers`);
  const recalls = await one(`SELECT count(*)::int AS due_30, count(*) FILTER (WHERE due < CURRENT_DATE)::int AS overdue FROM (SELECT s.customer_id, p.id, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due FROM sales s JOIN products p ON p.id=s.product_id WHERE s.customer_id IS NOT NULL AND p.periodicity_months IS NOT NULL GROUP BY s.customer_id, p.id) x
    WHERE due <= CURRENT_DATE + interval '30 days' AND NOT EXISTS (SELECT 1 FROM sales y WHERE y.customer_id=x.customer_id AND y.product_id=x.id AND y.sale_date > x.due - interval '2 months')`);
  const promo = await one(`SELECT p.id, p.name, p.claim, p.month, p.year, p.kpi_target, p.status, coalesce(r.revenue,0) AS revenue, coalesce(r.tickets,0) AS tickets, coalesce(r.customers,0) AS customers,
      (SELECT count(*)::int FROM exposure_items e WHERE e.promotion_id=p.id AND e.status='INSTALLATO') AS exposure_ok, (SELECT count(*)::int FROM exposure_items e WHERE e.promotion_id=p.id AND e.status<>'RIMOSSO') AS exposure_total
    FROM promotions p LEFT JOIN LATERAL (SELECT sum(net_amount) AS revenue, count(DISTINCT external_ref)::int AS tickets, count(DISTINCT customer_id)::int AS customers FROM sales WHERE promotion_id=p.id) r ON true
    WHERE p.year=date_part('year', CURRENT_DATE) AND p.month=date_part('month', CURRENT_DATE) AND p.status<>'ANNULLATA' ORDER BY p.id LIMIT 1`);
  const campaigns = await many(`SELECT c.id, c.name, c.channel, c.status, c.start_date, c.end_date, c.budget, c.spent, coalesce(r.revenue,0) AS revenue, coalesce(r.tickets,0) AS tickets FROM campaigns c LEFT JOIN LATERAL (SELECT sum(net_amount) AS revenue, count(DISTINCT external_ref)::int AS tickets FROM sales WHERE campaign_id=c.id) r ON true WHERE c.status='ATTIVA' OR (c.end_date >= CURRENT_DATE - 60 AND c.status<>'PIANIFICATA') ORDER BY c.start_date DESC LIMIT 8`);
  const exposure = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='INSTALLATO')::int AS ok, count(*) FILTER (WHERE status IN ('NON_CONFORME','DA_SOSTITUIRE'))::int AS issues, count(DISTINCT site_id) FILTER (WHERE status IN ('NON_CONFORME','DA_SOSTITUIRE','DA_INSTALLARE'))::int AS sites_with_issues FROM exposure_items WHERE status<>'RIMOSSO'`);
  const last_import = await one('SELECT created_at, source, dataset, rows_ok FROM import_batches ORDER BY created_at DESC LIMIT 1');
  const data_range = await one('SELECT min(sale_date) AS min, max(sale_date) AS max FROM sales');

  // Giorni lavorati nel periodo (pianificati dal calendario, reali dalle vendite) e produttività giornaliera
  const wdq = ctx();
  const wdPlanned = await one(`SELECT coalesce(sum(planned),0)::int AS n FROM working_days WHERE coalesce(site_id,0)=$1 AND make_date(year, month, 1) BETWEEN date_trunc('month', $2::date) AND $3::date`, [req.query.site_id ? Number(req.query.site_id) : 0, from, to]);
  const wdActual = await one(`SELECT count(DISTINCT s.sale_date)::int AS n FROM sales s WHERE s.sale_date BETWEEN ${wdq.F} AND ${wdq.T} ${wdq.sc}`, wdq.p.values);
  const working_days = { planned: wdPlanned.n, actual: wdActual.n, revenue_per_day: wdActual.n ? Number(cur.revenue) / wdActual.n : 0, tickets_per_day: wdActual.n ? cur.tickets / wdActual.n : 0 };
  // Spesa media per profilo (scontrino medio e spesa per paziente nel periodo)
  const profile = async (expr, join = '', order = 'spend_per_customer DESC') => { const { p, F, T, sc } = ctx(); return many(`SELECT ${expr} AS label, count(DISTINCT (s.source, s.external_ref))::int AS tickets, count(DISTINCT s.customer_id)::int AS customers, coalesce(sum(s.net_amount),0) AS revenue,
      coalesce(sum(s.net_amount),0) / nullif(count(DISTINCT (s.source, s.external_ref)),0) AS avg_ticket, coalesce(sum(s.net_amount),0) / nullif(count(DISTINCT s.customer_id),0) AS spend_per_customer
    FROM sales s JOIN customers c ON c.id=s.customer_id ${join} WHERE s.sale_date BETWEEN ${F} AND ${T} ${sc} GROUP BY 1 HAVING count(DISTINCT s.customer_id) >= 5 ORDER BY ${order} LIMIT 12`, p.values); };
  const [spend_by_sex, spend_by_age, spend_by_province, spend_by_segment, spend_by_channel] = await Promise.all([
    profile("coalesce(c.sex,'n.d.')"), profile(bandSql, '', 'label'), profile("coalesce(c.province,'n.d.')"),
    profile(`CASE WHEN c.first_visit BETWEEN ${'$F'} AND ${'$T'} THEN 'NUOVO' WHEN c.visits >= 2 THEN 'RICORRENTE' ELSE 'OCCASIONALE' END`.replace('$F', "'" + from + "'").replace('$T', "'" + to + "'")),
    profile("coalesce(s.booking_channel,'n.d.')"),
  ]);
  // Paziente tipo: i tre archetipi più numerosi per volume di richiesta (sesso, fascia di età, provincia) con cosa comprano
  const ac = ctx();
  const archRows = await many(`SELECT coalesce(c.sex,'n.d.') AS sex, ${bandSql} AS band, coalesce(c.province,'n.d.') AS province, count(DISTINCT (s.source, s.external_ref))::int AS tickets, count(DISTINCT c.id)::int AS customers, coalesce(sum(s.net_amount),0) AS revenue,
      round(avg(date_part('year', age(s.sale_date, c.birth_date))))::int AS avg_age
    FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.sale_date BETWEEN ${ac.F} AND ${ac.T} ${ac.sc} GROUP BY 1,2,3 ORDER BY tickets DESC LIMIT 3`, ac.p.values);
  const archetypes = [];
  for (const a of archRows) {
    const pc = ctx();
    const [products, cities, channels, lines] = await Promise.all([
      many(`SELECT pr.description AS label, count(*)::int AS n FROM sales s JOIN customers c ON c.id=s.customer_id JOIN products pr ON pr.id=s.product_id WHERE s.sale_date BETWEEN ${pc.F} AND ${pc.T} ${pc.sc} AND coalesce(c.sex,'n.d.')=$${pc.p.values.length + 1} AND ${bandSql}=$${pc.p.values.length + 2} AND coalesce(c.province,'n.d.')=$${pc.p.values.length + 3} GROUP BY 1 ORDER BY n DESC LIMIT 6`, [...pc.p.values, a.sex, a.band, a.province]),
      many(`SELECT coalesce(c.city,'n.d.') AS label, count(DISTINCT c.id)::int AS n FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.sale_date BETWEEN ${pc.F} AND ${pc.T} ${pc.sc} AND coalesce(c.sex,'n.d.')=$${pc.p.values.length + 1} AND ${bandSql}=$${pc.p.values.length + 2} AND coalesce(c.province,'n.d.')=$${pc.p.values.length + 3} GROUP BY 1 ORDER BY n DESC LIMIT 3`, [...pc.p.values, a.sex, a.band, a.province]),
      many(`SELECT coalesce(s.booking_channel,'n.d.') AS label, count(*)::int AS n FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.sale_date BETWEEN ${pc.F} AND ${pc.T} ${pc.sc} AND coalesce(c.sex,'n.d.')=$${pc.p.values.length + 1} AND ${bandSql}=$${pc.p.values.length + 2} AND coalesce(c.province,'n.d.')=$${pc.p.values.length + 3} GROUP BY 1 ORDER BY n DESC LIMIT 2`, [...pc.p.values, a.sex, a.band, a.province]),
      many(`SELECT pl.name AS label, coalesce(sum(s.net_amount),0) AS revenue FROM sales s JOIN customers c ON c.id=s.customer_id JOIN products pr ON pr.id=s.product_id JOIN product_lines pl ON pl.id=pr.line_id WHERE s.sale_date BETWEEN ${pc.F} AND ${pc.T} ${pc.sc} AND coalesce(c.sex,'n.d.')=$${pc.p.values.length + 1} AND ${bandSql}=$${pc.p.values.length + 2} AND coalesce(c.province,'n.d.')=$${pc.p.values.length + 3} GROUP BY 1 ORDER BY revenue DESC LIMIT 3`, [...pc.p.values, a.sex, a.band, a.province]),
    ]);
    archetypes.push({ ...a, share_tickets: cur.tickets ? Math.round((a.tickets / cur.tickets) * 1000) / 10 : 0, avg_ticket: a.tickets ? Number(a.revenue) / a.tickets : 0, spend_per_customer: a.customers ? Number(a.revenue) / a.customers : 0, products, cities, channels, lines });
  }
  // Classifica di chi vende di più: operatori di accettazione e sedi
  const oc = ctx();
  const top_operators = await many(`SELECT s.operator AS label, min(st.name) AS site_name, count(DISTINCT st.id)::int AS sites, coalesce(sum(s.net_amount),0) AS revenue, count(DISTINCT (s.source, s.external_ref))::int AS tickets, sum(s.quantity)::int AS items,
      coalesce(sum(s.net_amount),0) / nullif(count(DISTINCT (s.source, s.external_ref)),0) AS avg_ticket, count(DISTINCT s.sale_date)::int AS days
    FROM sales s LEFT JOIN sites st ON st.id=s.site_id WHERE s.operator IS NOT NULL AND s.sale_date BETWEEN ${oc.F} AND ${oc.T} ${oc.sc} GROUP BY s.operator ORDER BY revenue DESC LIMIT 15`, oc.p.values);
  // Pazienti finali del B2B: profilo da codice fiscale / data di nascita (non sono clienti, restano riferimenti)
  const pb = (expr, order = 'patients DESC') => { const { p, F, T, sc } = ctx(); return many(`SELECT ${expr} AS label, count(DISTINCT s.patient_ref)::int AS patients, count(DISTINCT (s.source, s.external_ref))::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue, coalesce(sum(s.net_amount),0) / nullif(count(DISTINCT s.patient_ref),0) AS spend_per_patient
    FROM sales s WHERE s.b2b_customer_id IS NOT NULL AND s.sale_date BETWEEN ${F} AND ${T} ${sc} GROUP BY 1 ORDER BY ${order}`, p.values); };
  const [pat_by_sex, pat_by_age, pat_known] = await Promise.all([pb("coalesce(s.patient_sex,'n.d.')"), pb(bandFor('s.patient_birth_date'), 'label'), (() => { const { p, F, T, sc } = ctx(); return one(`SELECT count(DISTINCT s.patient_ref)::int AS total, count(DISTINCT s.patient_ref) FILTER (WHERE s.patient_sex IS NOT NULL)::int AS with_sex, count(DISTINCT s.patient_ref) FILTER (WHERE s.patient_birth_date IS NOT NULL)::int AS with_birth, round(avg(date_part('year', age(s.sale_date, s.patient_birth_date))))::int AS avg_age FROM sales s WHERE s.b2b_customer_id IS NOT NULL AND s.sale_date BETWEEN ${F} AND ${T} ${sc}`, p.values); })()]);
  const b2b_patients = { ...pat_known, by_sex: pat_by_sex, by_age: pat_by_age };
  // Budget del periodo (per linea, network) e consuntivo
  const budget = await one(`SELECT coalesce(sum(amount),0) AS amount FROM budgets WHERE line_id IS NOT NULL AND site_id IS NULL AND make_date(year, month, 1) BETWEEN date_trunc('month', $1::date) AND $2::date`, [from, to]);
  const budgetSite = req.query.site_id ? await one(`SELECT coalesce(sum(amount),0) AS amount FROM budgets WHERE site_id=$3 AND line_id IS NULL AND make_date(year, month, 1) BETWEEN date_trunc('month', $1::date) AND $2::date`, [from, to, Number(req.query.site_id)]) : null;
  const budget_period = { amount: Number((budgetSite || budget).amount), actual: Number(cur.revenue), scope: budgetSite ? 'sede' : 'network' };

  res.json({ b2b_patients, by_sector, by_destination, top_margin_products, low_margin_products, working_days, spend_by_sex, spend_by_age, spend_by_province, spend_by_segment, spend_by_channel, archetypes, top_operators, budget_period, period: { from, to, days, prevFrom, prevTo }, kpi: cur, prev, trend, by_line, by_site, by_channel, by_payment, by_sex, by_age, by_province, by_city, by_weekday, by_hour, by_source, by_b2b_type, top_products, bottom_products, top_b2b, top_customers, base, recalls, promo, campaigns, exposure, last_import, data_range, bands });
}));

// Richiami: clienti con esami periodici in scadenza (lista operativa per SMS/telefono)
r.get('/recalls', ah(async (req, res) => {
  const days = Number(req.query.days || 30);
  const rows = await many(`SELECT x.customer_id, c.last_name, c.first_name, c.phone, c.email, c.marketing_consent, c.home_site_id, st.name AS site_name, p.id AS product_id, p.code, p.description, x.last_date, x.due
    FROM (SELECT s.customer_id, p.id AS pid, max(s.sale_date) AS last_date, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due FROM sales s JOIN products p ON p.id=s.product_id WHERE s.customer_id IS NOT NULL AND p.periodicity_months IS NOT NULL GROUP BY s.customer_id, p.id) x
    JOIN customers c ON c.id=x.customer_id JOIN products p ON p.id=x.pid LEFT JOIN sites st ON st.id=c.home_site_id
    WHERE x.due <= CURRENT_DATE + ($1 || ' days')::interval AND x.due >= CURRENT_DATE - interval '120 days' ${req.query.site_id ? 'AND c.home_site_id=$2' : ''}
    ORDER BY x.due LIMIT 2000`, req.query.site_id ? [days, Number(req.query.site_id)] : [days]);
  res.json(rows);
}));

export default r;
