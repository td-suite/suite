// Cruscotto: sintesi delle istanze
import { Router } from 'express';
import { many, one } from '../db.js';
import { ah } from '../lib/util.js';
import { getSettings } from '../lib/rules.js';
import { scheduleSummary } from '../lib/scheduleData.js';

const r = Router();

r.get('/summary', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const s = await getSettings();
  const byStatus = await many('SELECT status, count(*)::int AS n, coalesce(sum(amount),0) AS amount FROM payment_requests GROUP BY status');
  const st = Object.fromEntries(byStatus.map((x) => [x.status, x]));
  const get = (k) => st[k] || { n: 0, amount: 0 };
  const ytd = await one(`SELECT count(*)::int AS n, coalesce(sum(amount),0) AS amount FROM payment_requests WHERE status IN ('FIRMATA','ESEGUITA') AND extract(year from request_date)=$1`, [year]);
  const executedYtd = await one(`SELECT count(*)::int AS n, coalesce(sum(amount),0) AS amount FROM payment_requests WHERE status='ESEGUITA' AND extract(year from executed_at)=$1`, [year]);
  const byTier = await many(`SELECT tier, count(*)::int AS n, coalesce(sum(amount),0) AS amount FROM payment_requests WHERE status NOT IN ('ANNULLATA') AND extract(year from request_date)=$1 GROUP BY tier`, [year]);
  const monthly = await many(`SELECT to_char(date_trunc('month', request_date), 'YYYY-MM') AS month, tier, count(*)::int AS n, coalesce(sum(amount),0) AS amount
    FROM payment_requests WHERE status NOT IN ('ANNULLATA') AND request_date >= date_trunc('month', now()) - interval '11 months' GROUP BY 1, 2 ORDER BY 1`, []);
  const topBeneficiaries = await many(`SELECT beneficiary_name AS label, count(*)::int AS n, coalesce(sum(amount),0) AS amount FROM payment_requests
    WHERE status IN ('FIRMATA','ESEGUITA') AND extract(year from request_date)=$1 GROUP BY 1 ORDER BY amount DESC LIMIT 8`, [year]);
  // tempi: dall'invio in firma all'ultima firma
  const timing = await one(`SELECT avg(extract(epoch from (signed_at - submitted_at))/3600)::numeric(10,1) AS avg_hours, max(extract(epoch from (signed_at - submitted_at))/3600)::numeric(10,1) AS max_hours
    FROM payment_requests WHERE signed_at IS NOT NULL AND submitted_at IS NOT NULL AND extract(year from request_date)=$1`, [year]);
  const pending = await many(`SELECT r.id, r.protocol, r.beneficiary_name, r.amount, r.tier, r.single_signer, r.submitted_at, r.value_date,
      (SELECT json_agg(s.role) FROM signatures s WHERE s.request_id=r.id AND s.valid) AS signed_roles,
      extract(epoch from (now() - r.submitted_at))/3600 AS hours_waiting
    FROM payment_requests r WHERE r.status='IN_FIRMA' ORDER BY r.submitted_at`);
  const toExecute = await many(`SELECT id, protocol, beneficiary_name, amount, tier, signed_at, value_date FROM payment_requests WHERE status='FIRMATA' ORDER BY coalesce(value_date, signed_at::date), signed_at`);
  const aggregationAlerts = await many(`SELECT id, protocol, beneficiary_name, amount, aggregation->>'warning' AS warning FROM payment_requests WHERE status IN ('IN_FIRMA','FIRMATA') AND aggregation->>'warning' IS NOT NULL ORDER BY submitted_at DESC`);
  const mine = ['CEO', 'CFO'].includes(req.user.role)
    ? pending.filter((p) => (p.tier !== 'SINGOLA' || p.single_signer === req.user.role) && !(p.signed_roles || []).includes(req.user.role))
    : [];
  const schedule = await scheduleSummary().catch(() => null);   // riquadro Scadenze strutture
  res.json({
    year, schedule, thresholds: { single: Number(s.threshold_single), joint: Number(s.threshold_joint) },
    counts: { draft: get('BOZZA'), in_signature: get('IN_FIRMA'), rejected: get('RIFIUTATA'), signed: get('FIRMATA'), executed: get('ESEGUITA'), cancelled: get('ANNULLATA') },
    ytd, executed_ytd: executedYtd, by_tier: byTier, monthly, top_beneficiaries: topBeneficiaries, timing, pending, to_execute: toExecute, aggregation_alerts: aggregationAlerts, mine,
  });
}));

export default r;
