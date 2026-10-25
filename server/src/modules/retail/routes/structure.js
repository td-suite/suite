import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, notFound, audit, parse, forbidden } from '../lib/util.js';
import { canEditSite } from '../lib/access.js';

const r = Router();
const guard = (req, siteId) => { if (!canEditSite(req.user, siteId)) throw forbidden(); };

// Scheda struttura di una sede: profilo, persone, orari, dotazioni, numeri dell'anno
r.get('/sites/:id/structure', ah(async (req, res) => {
  const id = Number(req.params.id);
  const site = await one('SELECT * FROM sites WHERE id=$1', [id]);
  if (!site) throw notFound();
  const [staff, hours, assets, year, ops, market] = await Promise.all([
    many('SELECT * FROM site_staff WHERE site_id=$1 ORDER BY active DESC, sort_order, name', [id]),
    many('SELECT * FROM site_hours WHERE site_id=$1 ORDER BY weekday', [id]),
    many('SELECT * FROM site_assets WHERE site_id=$1 ORDER BY active DESC, kind, name', [id]),
    one(`SELECT coalesce(sum(net_amount),0) AS revenue, count(DISTINCT (source, external_ref))::int AS tickets, count(DISTINCT customer_id)::int AS customers, count(DISTINCT sale_date)::int AS days FROM sales WHERE site_id=$1 AND sale_date >= date_trunc('year', CURRENT_DATE)`, [id]),
    many(`SELECT operator AS label, coalesce(sum(net_amount),0) AS revenue, count(DISTINCT (source, external_ref))::int AS tickets FROM sales WHERE site_id=$1 AND operator IS NOT NULL AND sale_date >= date_trunc('year', CURRENT_DATE) GROUP BY operator ORDER BY revenue DESC LIMIT 10`, [id]),
    many(`SELECT territory, metric, value, year, ateco, source FROM market_data WHERE territory_kind='COMUNE' AND lower(territory) = ANY($1) ORDER BY territory, metric, year DESC`, [[site.city, ...(site.catchment_cities || '').split(',')].map((x) => (x || '').trim().toLowerCase()).filter(Boolean)]),
  ]);
  const fte = staff.filter((s) => s.active).reduce((a, s) => a + Number(s.weekly_hours || 0), 0) / 40;
  res.json({ site, staff, hours, assets, year, operators: ops, market, fte: Math.round(fte * 10) / 10, can_edit: canEditSite(req.user, id) });
}));

const staffSchema = z.object({ name: z.string().min(2), role: z.string().min(2), kind: z.enum(['DIPENDENTE', 'LP', 'ESTERNO']).default('DIPENDENTE'), specialty: z.string().nullable().optional(), weekly_hours: z.number().nullable().optional(), days: z.string().nullable().optional(), phone: z.string().nullable().optional(), email: z.string().nullable().optional(), active: z.boolean().optional(), notes: z.string().nullable().optional(), sort_order: z.number().int().optional() });
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; return d; };
r.post('/sites/:id/staff', ah(async (req, res) => {
  const id = Number(req.params.id); guard(req, id);
  const d = clean(parse(staffSchema, req.body)); const cols = ['site_id', ...Object.keys(d)];
  const row = await one(`INSERT INTO site_staff(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, [id, ...Object.keys(d).map((k) => d[k])]);
  await audit(req, 'SITE_STAFF_CREATE', 'site', id, { name: d.name }); res.status(201).json(row);
}));
r.put('/staff/:id', ah(async (req, res) => {
  const id = Number(req.params.id); const cur = await one('SELECT site_id FROM site_staff WHERE id=$1', [id]); if (!cur) throw notFound(); guard(req, cur.site_id);
  const d = clean(parse(staffSchema.partial(), req.body)); const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE site_staff SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  res.json({ ok: true });
}));
r.delete('/staff/:id', ah(async (req, res) => { const cur = await one('SELECT site_id FROM site_staff WHERE id=$1', [Number(req.params.id)]); if (!cur) throw notFound(); guard(req, cur.site_id); await q('DELETE FROM site_staff WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

r.put('/sites/:id/hours', ah(async (req, res) => {
  const id = Number(req.params.id); guard(req, id);
  const d = parse(z.object({ hours: z.array(z.object({ weekday: z.number().int().min(1).max(7), closed: z.boolean().default(false), open1: z.string().nullable().optional(), close1: z.string().nullable().optional(), open2: z.string().nullable().optional(), close2: z.string().nullable().optional(), note: z.string().nullable().optional() })) }), req.body);
  for (const h of d.hours) await q('INSERT INTO site_hours(site_id, weekday, closed, open1, close1, open2, close2, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (site_id, weekday) DO UPDATE SET closed=EXCLUDED.closed, open1=EXCLUDED.open1, close1=EXCLUDED.close1, open2=EXCLUDED.open2, close2=EXCLUDED.close2, note=EXCLUDED.note', [id, h.weekday, h.closed, h.open1 || null, h.close1 || null, h.open2 || null, h.close2 || null, h.note || null]);
  // sabato aperto = usato per i giorni lavorabili
  const sat = d.hours.find((h) => h.weekday === 6); if (sat) await q('UPDATE sites SET saturday_open=$2 WHERE id=$1', [id, !sat.closed]);
  await audit(req, 'SITE_HOURS_UPDATE', 'site', id); res.json({ ok: true });
}));

const assetSchema = z.object({ kind: z.string().min(2), name: z.string().min(2), quantity: z.number().int().min(1).default(1), details: z.string().nullable().optional(), active: z.boolean().optional() });
r.post('/sites/:id/assets', ah(async (req, res) => { const id = Number(req.params.id); guard(req, id); const d = clean(parse(assetSchema, req.body)); const row = await one('INSERT INTO site_assets(site_id, kind, name, quantity, details, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id, d.kind, d.name, d.quantity, d.details || null, d.active !== false]); res.status(201).json(row); }));
r.put('/assets/:id', ah(async (req, res) => { const id = Number(req.params.id); const cur = await one('SELECT site_id FROM site_assets WHERE id=$1', [id]); if (!cur) throw notFound(); guard(req, cur.site_id); const d = clean(parse(assetSchema.partial(), req.body)); const cols = Object.keys(d); if (cols.length) await q(`UPDATE site_assets SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]); res.json({ ok: true }); }));
r.delete('/assets/:id', ah(async (req, res) => { const cur = await one('SELECT site_id FROM site_assets WHERE id=$1', [Number(req.params.id)]); if (!cur) throw notFound(); guard(req, cur.site_id); await q('DELETE FROM site_assets WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

// Profilo struttura (campi descrittivi) modificabile anche dal site manager
r.put('/sites/:id/profile', ah(async (req, res) => {
  const id = Number(req.params.id); guard(req, id);
  const d = clean(parse(z.object({ surface_sqm: z.number().int().nullable().optional(), rooms: z.number().int().nullable().optional(), boxes: z.number().int().nullable().optional(), parking: z.string().nullable().optional(), accessibility: z.string().nullable().optional(), services: z.string().nullable().optional(), description: z.string().nullable().optional(), opened_at: z.string().nullable().optional(), catchment_cities: z.string().nullable().optional(), phone: z.string().nullable().optional(), email: z.string().nullable().optional(), opening_hours: z.string().nullable().optional(), manager: z.string().nullable().optional(), sqm_waiting: z.number().int().nullable().optional() }), req.body));
  const cols = Object.keys(d); if (cols.length) await q(`UPDATE sites SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'SITE_PROFILE_UPDATE', 'site', id, cols); res.json({ ok: true });
}));

export default r;
