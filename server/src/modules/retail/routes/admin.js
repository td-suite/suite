// Route amministrative dell'app di origine senza la gestione utenti (utenti, password, profili: li gestisce la Suite).
// Restano: impostazioni (app_settings), set dimostrativo, impostazioni Retail delle sedi (anagrafica unica), linee di prodotto, registro attività.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
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
// Anagrafica unica: l'elenco viene da public.sites (vista sites_v), qui si modificano solo le impostazioni Retail (site_ext, upsert).
// Creazione, rinomina, indirizzo e stato attivo si fanno in Amministrazione > Sedi (/admin/sites).
const SITE_COLS = `s.*, (SELECT count(*)::int FROM exposure_items e WHERE e.site_id=s.id) AS exposure_items,
    (SELECT count(*)::int FROM exposure_items e WHERE e.site_id=s.id AND e.status='INSTALLATO') AS exposure_ok,
    (SELECT coalesce(sum(net_amount),0) FROM sales x WHERE x.site_id=s.id AND x.sale_date >= date_trunc('year', CURRENT_DATE)) AS revenue_ytd,
    (SELECT count(*)::int FROM public.people p WHERE p.site_id=s.id AND p.status='ATTIVO') AS people_count`;
const extSchema = z.object({
  in_network: z.boolean().nullable().optional(),
  tuotempo_area_id: z.string().max(40).nullable().optional(), gipo_site_code: z.string().max(40).nullable().optional(), studiolab_code: z.string().max(40).nullable().optional(),
  saturday_open: z.boolean().optional(), catchment_cities: z.string().max(400).nullable().optional(),
  sqm_waiting: z.number().int().nullable().optional(), surface_sqm: z.number().int().nullable().optional(), rooms: z.number().int().nullable().optional(), boxes: z.number().int().nullable().optional(),
  parking: z.string().nullable().optional(), accessibility: z.string().nullable().optional(), services: z.string().nullable().optional(), description: z.string().nullable().optional(),
  opened_at: z.string().nullable().optional(), notes: z.string().max(4000).nullable().optional(),
});
const EXT_COLS = ['in_network', 'tuotempo_area_id', 'gipo_site_code', 'studiolab_code', 'saturday_open', 'catchment_cities', 'sqm_waiting', 'surface_sqm', 'rooms', 'boxes', 'parking', 'accessibility', 'services', 'description', 'opened_at', 'notes'];
const cleanStr = (v) => { const t = (v ?? '').toString().trim(); return t || null; };

// Impostazioni Retail della sede: upsert su site_ext (la riga nasce alla prima scrittura). Usato dalla pagina Sedi e dalla scheda struttura.
export async function upsertSiteExt(siteId, body) {
  const b = parse(extSchema, body);
  const site = await one('SELECT id, code, name FROM public.sites WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata nell\'anagrafica della Suite');
  const cur = (await one('SELECT * FROM site_ext WHERE site_id=$1', [siteId])) || {};
  const next = {};
  for (const k of EXT_COLS) {
    if (!(k in b)) { next[k] = cur[k] ?? (k === 'saturday_open' ? true : null); continue; }
    const v = b[k];
    next[k] = typeof v === 'string' ? cleanStr(v) : v ?? null;
    if (k === 'saturday_open') next[k] = v !== false;
  }
  await q(`INSERT INTO site_ext (site_id, ${EXT_COLS.join(', ')}) VALUES ($1, ${EXT_COLS.map((_, i) => `$${i + 2}`).join(', ')})
    ON CONFLICT (site_id) DO UPDATE SET ${EXT_COLS.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}, updated_at=now()`, [siteId, ...EXT_COLS.map((c) => next[c])]);
  return { site, data: b };
}

// Elenco: sedi attive dell'anagrafica unica (?all=1 anche le disattivate; ?network=1 solo quelle del network Retail)
r.get('/sites', ah(async (req, res) => {
  const w = [];
  if (req.query.all !== '1') w.push('s.active');
  if (req.query.network === '1') w.push('s.in_network');
  const rows = await many(`SELECT ${SITE_COLS} FROM sites_v s ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY s.active DESC, s.in_network DESC, s.sort_order, s.name`);
  const mine = new Set(req.user.site_ids || []);
  res.json(rows.map((s) => ({ ...s, mine: mine.has(s.id) })));
}));
r.get('/sites/:id', ah(async (req, res) => {
  const s = await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1`, [Number(req.params.id)]);
  if (!s) throw notFound('Sede non trovata');
  res.json(s);
}));
r.put('/sites/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const { site, data } = await upsertSiteExt(id, req.body);
  await audit(req, 'SITE_EXT_UPDATE', 'site', id, { label: `${site.name} (${site.code})`, ...data });
  res.json(await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1`, [id]));
}));
// Nessuna creazione o eliminazione di sedi nel modulo: si fa in Amministrazione > Sedi
r.post('/sites', requireWrite, ah(async () => { throw bad('Le sedi si creano in Amministrazione > Sedi (/admin/sites)'); }));
r.delete('/sites/:id', requireWrite, ah(async () => { throw bad('Le sedi si disattivano o eliminano in Amministrazione > Sedi (/admin/sites)'); }));

// Organizzazioni dell'anagrafica unica, per collegare i clienti B2B (aziende, strutture, partner)
r.get('/organizations', ah(async (_req, res) => {
  res.json(await many(`SELECT id, kind, code, name, vat_number, city, province, active FROM public.organizations WHERE active ORDER BY kind, name`));
}));

r.get('/product-lines', ah(async (_req, res) => res.json(await many('SELECT * FROM product_lines ORDER BY sort_order'))));

// ---------------- Registro attività ----------------
r.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  res.json(await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));

export default r;
