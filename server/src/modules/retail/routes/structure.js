// Scheda struttura della sede sull'anagrafica unica: la sede viene da public.sites (vista sites_v), le persone da public.people
// (site_id della persona), con il piano di lavoro Retail in person_ext; orari di dettaglio e dotazioni restano tabelle Retail
// (site_hours: solo le note operative per giorno; site_assets) con FK su public.sites. Le fasce di apertura per giorno sono
// quelle dell'anagrafica unica (public.sites.opening_hours_json, docs/IMPOSTAZIONI.md). Il profilo struttura si salva in site_ext (upsert).
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, notFound, audit, parse, forbidden } from '../lib/util.js';
import { canEditSite } from '../lib/access.js';
import { upsertSiteExt } from './admin.js';

const r = Router();
const guard = (req, siteId) => { if (!canEditSite(req.user, siteId)) throw forbidden(); };

// Persone della sede: anagrafica unica + piano di lavoro Retail
const PEOPLE = `SELECT p.id, p.kind, p.status, p.last_name, p.first_name, p.title, p.email, p.phone, p.phone_office, p.job_title, p.discipline, p.site_id,
    (p.status = 'ATTIVO') AS active, coalesce(e.retail_role, p.job_title, CASE p.kind WHEN 'MEDICO' THEN 'Medico' WHEN 'SANITARIO' THEN 'Sanitario' WHEN 'LP' THEN 'Libero professionista' ELSE NULL END) AS role,
    e.retail_role, e.weekly_hours, e.days, e.notes, coalesce(e.sort_order, 100) AS sort_order, (e.person_id IS NOT NULL) AS configured
  FROM public.people p LEFT JOIN person_ext e ON e.person_id = p.id`;

// Scheda struttura di una sede: profilo, persone, orari, dotazioni, numeri dell'anno
r.get('/sites/:id/structure', ah(async (req, res) => {
  const id = Number(req.params.id);
  const site = await one('SELECT * FROM sites_v WHERE id=$1', [id]);
  if (!site) throw notFound('Sede non trovata');
  const [staff, hours, assets, year, ops, market, sgi] = await Promise.all([
    many(`${PEOPLE} WHERE p.site_id=$1 AND p.status IN ('ATTIVO','IMPEGNO') ORDER BY (p.status='ATTIVO') DESC, coalesce(e.sort_order, 100), p.last_name, p.first_name`, [id]),
    many('SELECT weekday, note FROM site_hours WHERE site_id=$1 ORDER BY weekday', [id]),
    many('SELECT * FROM site_assets WHERE site_id=$1 ORDER BY active DESC, kind, name', [id]),
    one(`SELECT coalesce(sum(net_amount),0) AS revenue, count(DISTINCT (source, external_ref))::int AS tickets, count(DISTINCT customer_id)::int AS customers, count(DISTINCT sale_date)::int AS days FROM sales WHERE site_id=$1 AND sale_date >= date_trunc('year', CURRENT_DATE)`, [id]),
    many(`SELECT operator AS label, coalesce(sum(net_amount),0) AS revenue, count(DISTINCT (source, external_ref))::int AS tickets FROM sales WHERE site_id=$1 AND operator IS NOT NULL AND sale_date >= date_trunc('year', CURRENT_DATE) GROUP BY operator ORDER BY revenue DESC LIMIT 10`, [id]),
    many(`SELECT territory, metric, value, year, ateco, source FROM market_data WHERE territory_kind='COMUNE' AND lower(territory) = ANY($1) ORDER BY territory, metric, year DESC`, [[site.city, ...(site.catchment_cities || '').split(',')].map((x) => (x || '').trim().toLowerCase()).filter(Boolean)]),
    // Allineamento SGI della sede: esito della sintesi del modulo Audit SGI (public.site_sgi_scores, migrazione core 029); null se manca
    one('SELECT score, level, summary, computed_at, last_audit_at FROM public.site_sgi_scores WHERE site_id=$1', [id]).catch(() => null),
  ]);
  const fte = staff.filter((s) => s.active).reduce((a, s) => a + Number(s.weekly_hours || 0), 0) / 40;
  // Orari per giorno dall'anagrafica (fino a due fasce) + nota operativa Retail del giorno
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hj = site.hours_json || {};
  const hoursOut = DAYS.map((d, i) => { const r = Array.isArray(hj[d]) ? hj[d] : []; const n = hours.find((h) => h.weekday === i + 1); return { weekday: i + 1, closed: !r.length, open1: r[0]?.from || null, close1: r[0]?.to || null, open2: r[1]?.from || null, close2: r[1]?.to || null, note: n?.note || null }; });
  res.json({ site, staff, hours: hoursOut, assets, year, operators: ops, market, fte: Math.round(fte * 10) / 10, can_edit: canEditSite(req.user, id), sgi: sgi ? { score: sgi.score == null ? null : Number(sgi.score), level: sgi.level, summary: sgi.summary, computed_at: sgi.computed_at, last_audit_at: sgi.last_audit_at } : null });
}));

// Piano di lavoro Retail di una persona della sede (upsert su person_ext). Nome, ruolo contrattuale, contatti e sede si
// modificano in Amministrazione > Persone o in Contratti del personale.
const extSchema = z.object({ retail_role: z.string().max(80).nullable().optional(), weekly_hours: z.number().min(0).max(80).nullable().optional(), days: z.string().max(80).nullable().optional(), notes: z.string().max(2000).nullable().optional(), sort_order: z.number().int().optional() });
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; return d; };
r.put('/people/:id', ah(async (req, res) => {
  const pid = Number(req.params.id);
  const person = await one('SELECT id, site_id, last_name, first_name FROM public.people WHERE id=$1', [pid]);
  if (!person) throw notFound('Persona non trovata nell\'anagrafica della Suite');
  if (person.site_id == null) throw forbidden('La persona non è assegnata a una sede: impostala in Amministrazione > Persone');
  guard(req, person.site_id);
  const d = clean(parse(extSchema, req.body));
  const cur = (await one('SELECT * FROM person_ext WHERE person_id=$1', [pid])) || {};
  const next = { retail_role: 'retail_role' in d ? d.retail_role : cur.retail_role ?? null, weekly_hours: 'weekly_hours' in d ? d.weekly_hours : cur.weekly_hours ?? null, days: 'days' in d ? d.days : cur.days ?? null, notes: 'notes' in d ? d.notes : cur.notes ?? null, sort_order: d.sort_order ?? cur.sort_order ?? 100 };
  await q(`INSERT INTO person_ext (person_id, retail_role, weekly_hours, days, notes, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (person_id) DO UPDATE SET retail_role=EXCLUDED.retail_role, weekly_hours=EXCLUDED.weekly_hours, days=EXCLUDED.days, notes=EXCLUDED.notes, sort_order=EXCLUDED.sort_order, updated_at=now()`,
  [pid, next.retail_role, next.weekly_hours, next.days, next.notes, next.sort_order]);
  await audit(req, 'PERSON_EXT_UPDATE', 'person', pid, { name: `${person.last_name} ${person.first_name}`, ...d });
  res.json(await one(`${PEOPLE} WHERE p.id=$1`, [pid]));
}));
// Rimuove solo il piano di lavoro Retail: la persona resta in anagrafica
r.delete('/people/:id', ah(async (req, res) => {
  const pid = Number(req.params.id);
  const person = await one('SELECT id, site_id FROM public.people WHERE id=$1', [pid]);
  if (!person) throw notFound();
  guard(req, person.site_id);
  await q('DELETE FROM person_ext WHERE person_id=$1', [pid]);
  res.json({ ok: true });
}));

// Note operative per giorno (es. prelievi solo 7:30-10:30). Le fasce di apertura si modificano in Amministrazione > Sedi:
// il sabato aperto o chiuso (giorni lavorabili del Budget) deriva da lì.
r.put('/sites/:id/hours', ah(async (req, res) => {
  const id = Number(req.params.id); guard(req, id);
  if (!(await one('SELECT id FROM public.sites WHERE id=$1', [id]))) throw notFound('Sede non trovata');
  const d = parse(z.object({ hours: z.array(z.object({ weekday: z.number().int().min(1).max(7), note: z.string().max(300).nullable().optional() })) }), req.body);
  for (const h of d.hours) {
    const note = (h.note || '').trim() || null;
    if (note) await q('INSERT INTO site_hours(site_id, weekday, note) VALUES ($1,$2,$3) ON CONFLICT (site_id, weekday) DO UPDATE SET note=EXCLUDED.note', [id, h.weekday, note]);
    else await q('DELETE FROM site_hours WHERE site_id=$1 AND weekday=$2', [id, h.weekday]);
  }
  await audit(req, 'SITE_HOURS_UPDATE', 'site', id); res.json({ ok: true });
}));

const assetSchema = z.object({ kind: z.string().min(2), name: z.string().min(2), quantity: z.number().int().min(1).default(1), details: z.string().nullable().optional(), active: z.boolean().optional() });
r.post('/sites/:id/assets', ah(async (req, res) => { const id = Number(req.params.id); guard(req, id); const d = clean(parse(assetSchema, req.body)); const row = await one('INSERT INTO site_assets(site_id, kind, name, quantity, details, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id, d.kind, d.name, d.quantity, d.details || null, d.active !== false]); res.status(201).json(row); }));
r.put('/assets/:id', ah(async (req, res) => { const id = Number(req.params.id); const cur = await one('SELECT site_id FROM site_assets WHERE id=$1', [id]); if (!cur) throw notFound(); guard(req, cur.site_id); const d = clean(parse(assetSchema.partial(), req.body)); const cols = Object.keys(d); if (cols.length) await q(`UPDATE site_assets SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]); res.json({ ok: true }); }));
r.delete('/assets/:id', ah(async (req, res) => { const cur = await one('SELECT site_id FROM site_assets WHERE id=$1', [Number(req.params.id)]); if (!cur) throw notFound(); guard(req, cur.site_id); await q('DELETE FROM site_assets WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

// Profilo struttura (campi Retail di site_ext) modificabile anche dal site manager della sede
r.put('/sites/:id/profile', ah(async (req, res) => {
  const id = Number(req.params.id); guard(req, id);
  const { data } = await upsertSiteExt(id, req.body);
  await audit(req, 'SITE_PROFILE_UPDATE', 'site', id, Object.keys(data)); res.json({ ok: true });
}));

export default r;
