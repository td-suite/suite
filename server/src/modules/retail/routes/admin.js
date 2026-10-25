// Route amministrative dell'app di origine senza la gestione utenti (utenti, password, profili: li gestisce la Suite).
// Restano: impostazioni (app_settings), set dimostrativo, sedi del network, linee di prodotto, registro attività.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, requireWrite } from '../lib/access.js';
import { config } from '../config.js';
import { loadDemo, clearDemo } from '../lib/demo.js';
import { DEFAULT_SETTINGS } from '../lib/seedData.js';

const r = Router();

// ---------------- Impostazioni ----------------
const SETTING_KEYS = ['company_name', 'company_website', 'brand_claim', 'fiscal_year_start_month', 'age_bands', 'returning_days', 'churn_days', 'top_products_limit', 'exposure_check_days', 'promo_change_day'];

// Le impostazioni mancanti valgono il predefinito dell'app (nella Suite non c'è il seed al primo avvio: i dati arrivano dal travaso)
export async function getSettings() {
  const rows = await many('SELECT key, value FROM app_settings');
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((x) => [x.key, x.value])) };
}

r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  const counts = await one(`SELECT (SELECT count(*)::int FROM sales) AS sales, (SELECT count(*)::int FROM customers) AS customers, (SELECT count(*)::int FROM products) AS products, (SELECT count(*)::int FROM sales WHERE source='DEMO') AS demo_sales`);
  res.json({ settings: s, entraEnabled: config.entra.enabled, aiEnabled: Boolean(config.anthropicKey), maxUploadMb: config.maxUploadMb, counts });
}));

r.put('/settings', requireRole('ADMIN'), ah(async (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!SETTING_KEYS.includes(k)) throw bad(`Impostazione sconosciuta: ${k}`);
    await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(body[k] ?? '')]);
  }
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, body);
  res.json({ ok: true });
}));

// Set dimostrativo
r.post('/demo/load', requireRole('ADMIN'), ah(async (req, res) => {
  if ((await one('SELECT count(*)::int AS n FROM sales')).n > 0) throw bad('Il database contiene già vendite: il set dimostrativo si carica solo su database vuoto (oppure rimuovilo prima)');
  const out = await loadDemo();
  await audit(req, 'DEMO_LOAD', 'demo', null, out);
  res.json(out);
}));
r.post('/demo/clear', requireRole('ADMIN'), ah(async (req, res) => {
  await clearDemo();
  await audit(req, 'DEMO_CLEAR', 'demo', null);
  res.json({ ok: true });
}));

// ---------------- Sedi ----------------
const SITE_KINDS = ['LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'HEADQUARTER'];
const siteSchema = z.object({
  code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(120), kind: z.enum(SITE_KINDS),
  address: z.string().nullable().optional(), city: z.string().nullable().optional(), province: z.string().max(2).nullable().optional(), zip: z.string().nullable().optional(),
  lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), manager: z.string().nullable().optional(), legacy_brand: z.string().nullable().optional(),
  phone: z.string().nullable().optional(), email: z.string().nullable().optional(), opening_hours: z.string().nullable().optional(), sqm_waiting: z.number().int().nullable().optional(),
  active: z.boolean().optional(), sort_order: z.number().int().optional(), notes: z.string().nullable().optional(),
});
r.get('/sites', ah(async (req, res) => {
  const all = req.query.all === '1';
  res.json(await many(`SELECT s.*, (SELECT count(*)::int FROM exposure_items e WHERE e.site_id=s.id) AS exposure_items,
    (SELECT count(*)::int FROM exposure_items e WHERE e.site_id=s.id AND e.status='INSTALLATO') AS exposure_ok,
    (SELECT coalesce(sum(net_amount),0) FROM sales x WHERE x.site_id=s.id AND x.sale_date >= date_trunc('year', CURRENT_DATE)) AS revenue_ytd
    FROM sites s ${all ? '' : 'WHERE s.active'} ORDER BY s.sort_order, s.name`));
}));
r.post('/sites', requireWrite, ah(async (req, res) => {
  const d = parse(siteSchema, req.body);
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO sites(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => d[c]));
  await audit(req, 'SITE_CREATE', 'site', row.id, d);
  res.status(201).json(row);
}));
r.put('/sites/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(siteSchema.partial(), req.body);
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE sites SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'SITE_UPDATE', 'site', id, d);
  res.json({ ok: true });
}));
r.delete('/sites/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM sales WHERE site_id=$1', [id])).n;
  if (n > 0) { await q('UPDATE sites SET active=FALSE, updated_at=now() WHERE id=$1', [id]); await audit(req, 'SITE_DEACTIVATE', 'site', id); return res.json({ ok: true, deactivated: true }); }
  await q('DELETE FROM sites WHERE id=$1', [id]);
  await audit(req, 'SITE_DELETE', 'site', id);
  res.json({ ok: true });
}));

r.get('/product-lines', ah(async (_req, res) => res.json(await many('SELECT * FROM product_lines ORDER BY sort_order'))));

// ---------------- Registro attività ----------------
r.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  res.json(await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));

export default r;
