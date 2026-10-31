// Attività per sede e mese (activity_metrics), misura "a parità di attività" per gli indicatori energetici. Fonti:
//  - RETAIL: retail.sales, accettazioni = numeri di accettazione distinti (external_ref; una riga senza riferimento conta da sola),
//    prestazioni = somma delle quantità;
//  - CASH: cash.cash_reports non in bozza, giorni con rendiconto = giorni di apertura (riserva quando Retail non è avviato);
//  - MANUALE: inserite a mano in Energia > Attività. Le righe MANUALE non vengono mai sovrascritte dalle sincronizzazioni.
// Impostazione activity_source: AUTO (Retail se avviato, altrimenti Cash, altrimenti solo manuale), RETAIL, CASH, MANUALE.
import { q, many } from '../db.js';
import { schemaLive } from './core.js';

export async function activityAvailability() {
  return { retail: await schemaLive('retail', 'sales'), cash: await schemaLive('cash', 'cash_reports') };
}

export async function syncActivity(source = 'AUTO', { months = 36 } = {}) {
  const av = await activityAvailability();
  const use = source === 'AUTO' ? (av.retail ? 'RETAIL' : av.cash ? 'CASH' : null) : source === 'MANUALE' ? null : source;
  if (!use) return { source: 'MANUALE', rows: 0, note: 'Nessuna sorgente automatica: attività inserita a mano' };
  if (use === 'RETAIL' && !av.retail) return { source: use, rows: 0, note: 'Retail Assistant non avviato' };
  if (use === 'CASH' && !av.cash) return { source: use, rows: 0, note: 'Cash Management non avviato' };
  let rows;
  if (use === 'RETAIL') {
    rows = await many(`SELECT s.site_id, date_trunc('month', s.sale_date)::date AS month, count(DISTINCT coalesce(s.external_ref, 'id:' || s.id::text))::int AS accettazioni,
        sum(s.quantity)::int AS prestazioni, NULL::int AS giorni
      FROM retail.sales s JOIN public.sites x ON x.id=s.site_id AND x.kind <> 'SERVICE'
      WHERE s.site_id IS NOT NULL AND s.sale_date >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval) GROUP BY 1, 2`, [String(months)]);
  } else {
    rows = await many(`SELECT r.site_id, date_trunc('month', r.report_date)::date AS month, NULL::int AS accettazioni, NULL::int AS prestazioni, count(DISTINCT r.report_date)::int AS giorni
      FROM cash.cash_reports r JOIN public.sites x ON x.id=r.site_id AND x.kind <> 'SERVICE'
      WHERE r.status <> 'DRAFT' AND r.report_date >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval) GROUP BY 1, 2`, [String(months)]);
  }
  let n = 0;
  for (const x of rows) {
    const r = await q(`INSERT INTO activity_metrics (site_id, month, accettazioni, prestazioni, giorni_apertura, source, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (site_id, month) DO UPDATE SET accettazioni=coalesce(EXCLUDED.accettazioni, activity_metrics.accettazioni), prestazioni=coalesce(EXCLUDED.prestazioni, activity_metrics.prestazioni),
        giorni_apertura=coalesce(EXCLUDED.giorni_apertura, activity_metrics.giorni_apertura), source=EXCLUDED.source, updated_at=now()
      WHERE activity_metrics.source <> 'MANUALE'`, [x.site_id, x.month, x.accettazioni, x.prestazioni, x.giorni, use]);
    n += r.rowCount;
  }
  return { source: use, rows: n, letti: rows.length };
}
