import { q } from '../db.js';

// Ricalcola i dati aggregati dei clienti dalle vendite (visite, fatturato, prima e ultima visita, sede di riferimento)
export async function refreshCustomerStats(customerIds = null) {
  const where = customerIds?.length ? `WHERE c.id = ANY($1::int[])` : '';
  const params = customerIds?.length ? [customerIds] : [];
  await q(`UPDATE customers c SET
      visits = coalesce(s.visits, 0), revenue = coalesce(s.revenue, 0), first_visit = s.first_visit, last_visit = s.last_visit,
      home_site_id = coalesce(c.home_site_id, s.home_site_id), updated_at = now()
    FROM (
      SELECT cid, count(DISTINCT coalesce(external_ref, id::text))::int AS visits, sum(net_amount) AS revenue, min(sale_date) AS first_visit, max(sale_date) AS last_visit,
             (array_agg(site_id ORDER BY sale_date))[1] AS home_site_id
      FROM (SELECT coalesce(customer_id, b2b_customer_id) AS cid, id, external_ref, net_amount, sale_date, site_id FROM sales) x WHERE cid IS NOT NULL GROUP BY cid
    ) s
    ${where ? `${where} AND s.cid = c.id` : 'WHERE s.cid = c.id'}`, params);
  // clienti senza più vendite
  await q(`UPDATE customers c SET visits=0, revenue=0, first_visit=NULL, last_visit=NULL WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id=c.id OR s.b2b_customer_id=c.id) AND (c.visits<>0 OR c.revenue<>0) ${customerIds?.length ? 'AND c.id = ANY($1::int[])' : ''}`, params);
}

export const ageBand = (bands) => (age) => {
  if (age == null) return 'n.d.';
  for (const b of bands) {
    const [lo, hi] = b.includes('+') ? [Number(b.replace('+', '')), 999] : b.split('-').map(Number);
    if (age >= lo && age <= hi) return b;
  }
  return 'n.d.';
};
