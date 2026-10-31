// Energia: quadro per sede e per rete (consumi, costi, CO2, intensità, anno su anno, anomalie, classifica tra sedi a parità di attività,
// obiettivi, benchmark indicativi), attività per sede e mese (Retail, Cash o manuale), obiettivi di riduzione, analisi con Claude.
// Il site manager vede solo le proprie sedi; il manutentore non accede.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { VECTORS } from '../config.js';
import { ah, audit, bad, parse, forbidden, notFound } from '../../../lib/util.js';
import { requireFacility, assertSite, limitedToSites, mySiteIds, isFacility, isManutentore } from '../lib/access.js';
import { KEY, idOf, settings, todayRome, financeLive, FINANCE_OFF } from '../lib/core.js';
import { loadEnergyData, buildEnergy } from '../lib/energy.js';
import { syncActivity, activityAvailability } from '../lib/activity.js';
import { analizza, aiState } from '../lib/ai.js';

const r = Router();
const noMaint = (req, _res, next) => (isManutentore(req) ? next(forbidden('Sezione non disponibile per i manutentori')) : next());
r.use('/energia', noMaint);
const yearOf = (v) => { const y = Number(v) || Number(todayRome().slice(0, 4)); if (y < 2000 || y > 2100) throw bad('Anno non valido'); return y; };
const scopeIds = (req) => {
  if (req.query.site_id) { const id = Number(req.query.site_id); assertSite(req, id); return [id]; }
  return limitedToSites(req) ? mySiteIds(req) : null;
};

export async function energyFor(req, year) {
  const data = await loadEnergyData({ siteIds: scopeIds(req) });
  if (!data.available) return null;
  return buildEnergy(data, await settings(), year);
}

r.get('/energia', ah(async (req, res) => {
  if (!(await financeLive())) return res.json({ finance: false, message: FINANCE_OFF });
  const year = yearOf(req.query.year);
  const e = await energyFor(req, year);
  const ultima = await one(`SELECT id, site_id, year, model, result, generated_at FROM energy_analyses WHERE coalesce(site_id,0)=$1 AND year=$2 ORDER BY generated_at DESC LIMIT 1`, [Number(req.query.site_id) || 0, year]);
  // le serie complete restano lato server: al client mese per mese
  for (const s of [...e.sites, e.network]) delete s.series;
  res.json({ finance: true, ...e, analisi: ultima, ai: aiState(), can_edit: isFacility(req), limited: limitedToSites(req) });
}));

// ---- Attività per sede e mese
r.get('/energia/attivita', ah(async (req, res) => {
  const year = yearOf(req.query.year);
  const ids = scopeIds(req);
  const rows = await many(`SELECT a.site_id, to_char(a.month, 'YYYY-MM') AS month, a.accettazioni, a.prestazioni, a.ore_apertura, a.giorni_apertura, a.source, a.updated_at, s.name AS site_name
    FROM activity_metrics a JOIN public.sites s ON s.id=a.site_id WHERE extract(year FROM a.month)=$1 ${ids ? 'AND a.site_id = ANY($2::int[])' : ''} ORDER BY s.name, a.month`, ids ? [year, ids] : [year]);
  const imp = await settings();
  res.json({ year, rows, source: imp.activity_source, availability: await activityAvailability(), can_edit: isFacility(req) });
}));
const actSchema = z.object({ rows: z.array(z.object({
  site_id: z.coerce.number().int().positive(), month: z.string().regex(/^\d{4}-\d{2}$/),
  accettazioni: z.coerce.number().int().min(0).nullable().optional(), prestazioni: z.coerce.number().int().min(0).nullable().optional(),
  ore_apertura: z.coerce.number().min(0).max(744).nullable().optional(), giorni_apertura: z.coerce.number().int().min(0).max(31).nullable().optional(),
})).min(1).max(500) });
r.put('/energia/attivita', requireFacility, ah(async (req, res) => {
  const b = parse(actSchema, req.body || {});
  for (const x of b.rows) {
    await q(`INSERT INTO activity_metrics (site_id, month, accettazioni, prestazioni, ore_apertura, giorni_apertura, source, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'MANUALE',now())
      ON CONFLICT (site_id, month) DO UPDATE SET accettazioni=EXCLUDED.accettazioni, prestazioni=EXCLUDED.prestazioni, ore_apertura=EXCLUDED.ore_apertura, giorni_apertura=EXCLUDED.giorni_apertura, source='MANUALE', updated_at=now()`,
    [x.site_id, `${x.month}-01`, x.accettazioni ?? null, x.prestazioni ?? null, x.ore_apertura ?? null, x.giorni_apertura ?? null]);
  }
  await audit(req, 'FACILITY_ATTIVITA', { module: KEY, entity: 'activity', data: { righe: b.rows.length } });
  res.json({ ok: true, rows: b.rows.length });
}));
r.post('/energia/attivita/sync', requireFacility, ah(async (req, res) => {
  const imp = await settings();
  const out = await syncActivity(req.body?.source || imp.activity_source);
  await audit(req, 'FACILITY_ATTIVITA_SYNC', { module: KEY, entity: 'activity', data: out });
  res.json(out);
}));

// ---- Obiettivi di riduzione
r.get('/energia/obiettivi', ah(async (req, res) => {
  const ids = limitedToSites(req) ? mySiteIds(req) : null;
  res.json(await many(`SELECT t.*, s.name AS site_name FROM energy_targets t LEFT JOIN public.sites s ON s.id=t.site_id ${ids ? 'WHERE t.site_id IS NULL OR t.site_id = ANY($1::int[])' : ''} ORDER BY t.year DESC, t.site_id NULLS FIRST`, ids ? [ids] : []));
}));
const tgtSchema = z.object({
  site_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  year: z.coerce.number().int().min(2000).max(2100), vector: z.enum(VECTORS).nullable().optional().or(z.literal('').transform(() => null)),
  target_pct_reduction: z.coerce.number().min(0).max(100), baseline_year: z.coerce.number().int().min(2000).max(2100), notes: z.string().max(1000).nullable().optional(),
});
r.post('/energia/obiettivi', requireFacility, ah(async (req, res) => {
  const b = parse(tgtSchema, req.body || {});
  if (b.baseline_year >= b.year) throw bad('L\'anno base deve precedere l\'anno dell\'obiettivo');
  const row = await one(`INSERT INTO energy_targets (site_id, year, vector, target_pct_reduction, baseline_year, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (coalesce(site_id, 0), year, coalesce(vector, '*')) DO UPDATE SET target_pct_reduction=EXCLUDED.target_pct_reduction, baseline_year=EXCLUDED.baseline_year, notes=EXCLUDED.notes RETURNING *`,
  [b.site_id ?? null, b.year, b.vector ?? null, b.target_pct_reduction, b.baseline_year, b.notes || null, req.moduleUser.id]);
  await audit(req, 'FACILITY_OBIETTIVO', { module: KEY, entity: 'target', entityId: row.id, data: b });
  res.status(201).json(row);
}));
r.delete('/energia/obiettivi/:id', requireFacility, ah(async (req, res) => {
  const x = await one('DELETE FROM energy_targets WHERE id=$1 RETURNING id', [idOf(req.params.id, 'Obiettivo non trovato')]);
  if (!x) throw notFound('Obiettivo non trovato');
  res.json({ ok: true });
}));

// ---- Analisi con Claude (Facility): commento, anomalie, azioni per urgenza
r.post('/energia/analisi', requireFacility, ah(async (req, res) => {
  if (!(await financeLive())) throw bad(FINANCE_OFF);
  const year = yearOf(req.body?.year);
  const siteId = req.body?.site_id ? Number(req.body.site_id) : null;
  const data = await loadEnergyData({ siteIds: siteId ? [siteId] : null });
  const e = buildEnergy(data, await settings(), year);
  const out = await analizza(e, siteId, { userId: req.user.id });
  const row = await one(`INSERT INTO energy_analyses (site_id, year, model, result, generated_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, site_id, year, model, result, generated_at`, [siteId, year, out.model, JSON.stringify(out.result), req.moduleUser.id]);
  await audit(req, 'FACILITY_ANALISI_ENERGIA', { module: KEY, entity: 'energy_analysis', entityId: row.id, data: { site_id: siteId, year, model: out.model, azioni: out.result.azioni.length } });
  res.status(201).json(row);
}));

export default r;
