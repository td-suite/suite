import { Router } from 'express';
import { one, many } from '../db.js';
import { ah } from '../lib/util.js';
import { Params } from '../lib/access.js';
import { getSettings } from './admin.js';
import { periodoProfilo, annoPrima, quadroLaboratorio, profiloPazienti, statoCopia, fonteProduzione, aggiornatoAlle } from '../../../lib/synclab/letture.js';
import { privatiInB2c } from '../lib/b2b.js';
import { getConnector } from '../../../lib/connectors.js';

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
    group('st.name', 'JOIN sites_v st ON st.id=s.site_id'),
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
    FROM sales s LEFT JOIN sites_v st ON st.id=s.site_id WHERE s.operator IS NOT NULL AND s.sale_date BETWEEN ${oc.F} AND ${oc.T} ${oc.sc} GROUP BY s.operator ORDER BY revenue DESC LIMIT 15`, oc.p.values);
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

// ---------------------------------------------------------------- Cruscotto complessivo di rete (riordino di Retail, v0.68.0)
// Decisione del CEO del 09/11/2026 sera: B2C e B2B affiancati nello stesso periodo. B2C = accettazioni e vendite GIPO, prima disponibilità
// TuoTempo (le prenotazioni non sono ancora esposte da Docplanner), Laboratorio in sede (accettazioni Synclab dei punti TD, se
// l'impostazione lo prevede); B2B = accettazioni, produzione e fatturato da documenti di StudioLab (Synclab). Confronto con lo stesso
// periodo dell'anno prima, quota fuori area, stato dei tre connettori con l'ultimo aggiornamento. Nessun dato inventato: senza dati la
// voce è null con la nota.
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
r.get('/rete', ah(async (req, res) => {
  const oggi = oggiRoma();
  const per = periodoProfilo({ periodo: req.query.periodo || oggi.slice(0, 7), da: req.query.da || null, a: req.query.a || null, oggi });
  // periodo in corso: fino a oggi, l'anno prima fino allo stesso giorno (confronto omogeneo)
  if (per.a > oggi && per.da <= oggi) { per.a = oggi; per.prec = { da: annoPrima(per.da), a: annoPrima(oggi) }; per.troncato = true; }
  const privati = await privatiInB2c();

  // ---- B2C · GIPO (accettazioni e vendite dei clienti privati: righe senza committente B2B, niente dimostrative)
  const gipo = async (da, a) => one(`SELECT count(DISTINCT s.external_ref)::int AS accettazioni, coalesce(sum(s.net_amount), 0) AS vendite, coalesce(sum(s.quantity), 0)::int AS prestazioni,
      count(DISTINCT s.customer_id)::int AS clienti, count(*)::int AS righe
    FROM sales s WHERE s.source = 'GIPO' AND s.b2b_customer_id IS NULL AND s.sale_date BETWEEN $1::date AND $2::date`, [da, a]);
  const g = await gipo(per.da, per.a), gp = await gipo(per.prec.da, per.prec.a);
  // quota fuori area dei clienti GIPO: stessa regola del laboratorio (comune diverso da quello della sede e provincia diversa)
  const fa = async (da, a) => one(`WITH x AS (SELECT DISTINCT s.external_ref, nullif(lower(trim(c.city)), '') AS comune, nullif(upper(trim(c.province)), '') AS provincia,
        nullif(lower(trim(st.city)), '') AS sede_comune, nullif(upper(trim(st.province)), '') AS sede_provincia
      FROM sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN public.sites st ON st.id = s.site_id
     WHERE s.source = 'GIPO' AND s.b2b_customer_id IS NULL AND s.sale_date BETWEEN $1::date AND $2::date)
    SELECT count(*) FILTER (WHERE comune IS NOT NULL AND sede_comune IS NOT NULL AND (comune = sede_comune OR (provincia IS NOT NULL AND sede_provincia IS NOT NULL)))::int AS valutabili,
           count(*) FILTER (WHERE comune IS NOT NULL AND sede_comune IS NOT NULL AND comune <> sede_comune AND provincia IS NOT NULL AND sede_provincia IS NOT NULL AND provincia <> sede_provincia)::int AS fuori FROM x`, [da, a]);
  const gfa = await fa(per.da, per.a);
  const gconn = await one(`SELECT enabled, last_sync_at, last_status FROM connectors WHERE kind = 'GIPO'`).catch(() => null);
  const gimp = await one(`SELECT created_at, filename, rows_ok FROM import_batches WHERE source = 'GIPO' ORDER BY created_at DESC LIMIT 1`).catch(() => null);
  const gmax = await one(`SELECT max(sale_date) AS ultima FROM sales WHERE source = 'GIPO'`);

  // ---- B2C · TuoTempo (prima disponibilità: mediana della rete nell'ultimo giorno dello storico)
  const tt = await one(`SELECT max(data) AS d FROM tuotempo_attivita`).catch(() => null);
  const ttRete = tt?.d ? await one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS mediana, count(*)::int AS prestazioni FROM tuotempo_attivita WHERE data = $1`, [tt.d]) : null;
  const ttPrima = tt?.d ? await one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS mediana FROM tuotempo_attivita WHERE data = (SELECT max(data) FROM tuotempo_attivita WHERE data <= ($1::date - 7))`, [tt.d]) : null;
  const ttAree = await one(`SELECT count(*) FILTER (WHERE presente AND NOT coalesce(ignorata, FALSE))::int AS aree,
      count(*) FILTER (WHERE presente AND NOT coalesce(ignorata, FALSE) AND EXISTS (SELECT 1 FROM public.sites s WHERE s.legacy_refs->>'tuotempo' = tuotempo_aree.areaid))::int AS abbinate FROM tuotempo_aree`).catch(() => ({ aree: 0, abbinate: 0 }));
  const ttConn = await one(`SELECT last_sync_at, last_status FROM connectors WHERE kind = 'TUOTEMPO'`).catch(() => null);
  const r1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);

  // ---- Synclab (B2B e Laboratorio in sede)
  let lab = null, labNota = null, fuoriLab = { LAB_SEDE: null, B2B: null };
  const stato = await statoCopia().catch(() => null);
  try {
    if (stato?.conteggi?.requests || stato?.conteggi?.invoices) {
      lab = await quadroLaboratorio({ da: per.da, a: per.a, privatiInB2c: privati });
      for (const k of ['LAB_SEDE', 'B2B']) {
        if (k === 'LAB_SEDE' && !privati) continue;
        const pp = await profiloPazienti({ da: per.da, a: per.a, perimetro: k, privati_in_b2c: privati }).catch(() => null);
        fuoriLab[k] = pp ? { quota: pp.provenienza.fuori_area.quota, fuori: pp.provenienza.fuori_area.fuori, valutabili: pp.provenienza.fuori_area.valutabili } : null;
      }
    } else labNota = 'Nessuna accettazione né documento Synclab importato (Amministrazione > Connettori > StudioLAB > Dati Synclab)';
  } catch (e) { labNota = `Synclab: lettura non riuscita (${e.message})`; }
  const sl = await getConnector('STUDIOLAB').catch(() => null);
  const dataApi = sl?.settings?.data_api_enabled === true || sl?.settings?.data_api_enabled === 'true';

  const varPct = (c, p) => (p == null || Number(p) === 0 || c == null ? null : Math.round(((Number(c) - Number(p)) / Number(p)) * 1000) / 10);
  const piu = (...d) => d.filter(Boolean).map((x) => new Date(x).toISOString()).sort().pop() || null;
  res.json({
    periodo: per, oggi, privati_in_b2c: privati,
    b2c: {
      gipo: { ...g, vendite: Number(g.vendite), anno_prima: { ...gp, vendite: Number(gp.vendite) }, var_accettazioni: varPct(g.accettazioni, gp.accettazioni), var_vendite: varPct(g.vendite, gp.vendite),
        fuori_area: { quota: gfa.valutabili ? Math.round((gfa.fuori / gfa.valutabili) * 1000) / 10 : null, fuori: gfa.fuori, valutabili: gfa.valutabili, regola: 'clienti GIPO: comune di residenza diverso da quello della sede e provincia diversa' },
        fonte: 'GIPO (vendite importate)', ultima_vendita: gmax?.ultima || null },
      tuotempo: { prenotazioni: null, nota_prenotazioni: 'Prenotazioni online non ancora disponibili: Docplanner non ha aperto le API (Fase 2)', ultimo_giorno: tt?.d || null,
        attesa_mediana: r1(ttRete?.mediana), attesa_settimana_prima: r1(ttPrima?.mediana), prestazioni: ttRete?.prestazioni || 0, aree: ttAree.aree, aree_abbinate: ttAree.abbinate, fonte: 'TuoTempo (Key Entities)' },
      laboratorio: privati ? (lab ? { ...lab.LAB_SEDE, fuori_area: fuoriLab.LAB_SEDE } : null) : { spento: true, nota: 'Impostazione spenta: le accettazioni Synclab dei punti TD sono nel B2B' },
    },
    // v0.68.5: grandezza principale = produzione (v0.68.6: accettata, regola dello sconto di testata dall'impostazione); documenti secondari
    b2b: { synclab: lab ? { ...lab.B2B, fuori_area: fuoriLab.B2B } : null, nota: labNota, fonte: 'StudioLab (Synclab Data API)', stati: lab?.stati || null,
      fonte_produzione: lab ? fonteProduzione(lab.stati, stato?.insiemi?.requests?.checkpoint_at || null, lab.sconto) : null, aggiornato: aggiornatoAlle(stato?.insiemi?.requests?.checkpoint_at || null, oggi) },
    connettori: [
      { chiave: 'GIPO', nome: 'GIPO', ruolo: 'B2C: accettazioni e vendite dei centri medici e punti prelievo', attivo: Boolean(gconn?.enabled) || Boolean(gimp),
        ultimo_aggiornamento: piu(gconn?.last_sync_at, gimp?.created_at), dettaglio: gimp ? `ultimo import ${gimp.filename} (${gimp.rows_ok} righe)` : gconn?.last_sync_at ? `ultima sincronizzazione: ${gconn.last_status || ''}` : 'nessun import',
        link: '/retail/import' },
      { chiave: 'TUOTEMPO', nome: 'TuoTempo', ruolo: 'B2C: prestazioni online, prima disponibilità, medici', attivo: Boolean((await getConnector('TUOTEMPO').catch(() => null))?.active),
        ultimo_aggiornamento: ttConn?.last_sync_at || null, dettaglio: ttConn?.last_status ? `esito ${ttConn.last_status}` : 'mai allineato', link: '/retail/connettori' },
      { chiave: 'SYNCLAB', nome: 'StudioLAB / Synclab', ruolo: 'B2B (e Laboratorio in sede): accettazioni, produzione, documenti, listini', attivo: dataApi,
        ultimo_aggiornamento: stato?.ultimo_checkpoint || null, dettaglio: stato?.insiemi?.requests?.checkpoint_at ? `ultimo checkpoint delle accettazioni${dataApi ? '' : ' (Data API spenta)'}` : 'nessun checkpoint', link: '/admin/connectors/synclab' },
    ],
  });
}));

// Fonti delle pagine B2C (riordino del 09/11/2026): ultimo import GIPO (o sincronizzazione) e ultimo allineamento TuoTempo
r.get('/fonti', ah(async (_req, res) => {
  const gimp = await one(`SELECT max(created_at) AS t FROM import_batches WHERE source = 'GIPO'`).catch(() => null);
  const gconn = await one(`SELECT last_sync_at FROM connectors WHERE kind = 'GIPO'`).catch(() => null);
  const gmax = await one(`SELECT max(sale_date) AS d FROM sales WHERE source = 'GIPO'`);
  const tconn = await one(`SELECT last_sync_at FROM connectors WHERE kind = 'TUOTEMPO'`).catch(() => null);
  const tmax = await one(`SELECT max(data) AS d FROM tuotempo_attivita`).catch(() => null);
  const piu = (...d) => d.filter(Boolean).map((x) => new Date(x).toISOString()).sort().pop() || null;
  res.json({ gipo: { ultimo_import: piu(gimp?.t, gconn?.last_sync_at), ultima_vendita: gmax?.d || null }, tuotempo: { ultimo_allineamento: tconn?.last_sync_at || null, ultimo_giorno: tmax?.d || null } });
}));

// Richiami: clienti con esami periodici in scadenza (lista operativa per SMS/telefono)
r.get('/recalls', ah(async (req, res) => {
  const days = Number(req.query.days || 30);
  const rows = await many(`SELECT x.customer_id, c.last_name, c.first_name, c.phone, c.email, c.marketing_consent, c.home_site_id, st.name AS site_name, p.id AS product_id, p.code, p.description, x.last_date, x.due
    FROM (SELECT s.customer_id, p.id AS pid, max(s.sale_date) AS last_date, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due FROM sales s JOIN products p ON p.id=s.product_id WHERE s.customer_id IS NOT NULL AND p.periodicity_months IS NOT NULL GROUP BY s.customer_id, p.id) x
    JOIN customers c ON c.id=x.customer_id JOIN products p ON p.id=x.pid LEFT JOIN sites_v st ON st.id=c.home_site_id
    WHERE x.due <= CURRENT_DATE + ($1 || ' days')::interval AND x.due >= CURRENT_DATE - interval '120 days' ${req.query.site_id ? 'AND c.home_site_id=$2' : ''}
    ORDER BY x.due LIMIT 2000`, req.query.site_id ? [days, Number(req.query.site_id)] : [days]);
  res.json(rows);
}));

export default r;
