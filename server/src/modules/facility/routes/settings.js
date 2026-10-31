// Cruscotto (scadenze prossime, interventi aperti, anomalie energia, immobili senza planimetria, KPI) e Impostazioni (Facility e
// amministratore: SLA per priorità, fattori CO2 e di conversione, promemoria, soglia delle anomalie, fonte dell'attività), esecuzione
// manuale del job delle scadenze (data di prova ammessa solo fuori produzione).
import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { config, CO2_DEFAULT, KWH_FACTOR, VECTORS } from '../config.js';
import { ah, audit, parse } from '../../../lib/util.js';
import { storageMode } from '../../../lib/moduleStorage.js';
import { mailStatus } from '../../../lib/mailer.js';
import { requireFacility, limitedToSites, mySiteIds, isManutentore, isFacility, isSite, vendorScope } from '../lib/access.js';
import { KEY, settings, setSetting, todayRome, financeLive, roomReady, ensureProperties } from '../lib/core.js';
import { maintenanceKpi } from '../lib/kpi.js';
import { listPlans } from './plans.js';
import { loadEnergyData, buildEnergy } from '../lib/energy.js';
import { activityAvailability } from '../lib/activity.js';
import { runScadenze } from '../lib/alerts.js';
import { aiState } from '../lib/ai.js';
import { fontName } from '../lib/export.js';
import { slaState } from '../lib/calc.js';

const r = Router();

r.get('/dashboard', ah(async (req, res) => {
  const today = todayRome();
  const year = Number(today.slice(0, 4));
  const ids = limitedToSites(req) ? mySiteIds(req) : null;
  const vs = vendorScope(req);
  const kpi = await maintenanceKpi({ siteIds: ids, year, vendorOrgId: vs?.orgId || null });
  const in30 = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
  const scadenze = (await listPlans(req, { status: 'APERTE', to: in30, limit: 12 }));
  const params = []; const w = [`w.status <> 'CHIUSO'`];
  if (ids) { params.push(ids); w.push(`w.site_id = ANY($${params.length}::int[])`); }
  if (vs) { params.push(vs.orgId, vs.userId); w.push(`(w.vendor_org_id=$${params.length - 1} OR w.assigned_user_id=$${params.length})`); }
  const interventi = (await many(`SELECT w.id, w.code, w.title, w.priority, w.status, w.opened_at, w.due_at, w.closed_at, s.name AS site_name FROM work_orders w JOIN public.sites s ON s.id=w.site_id WHERE ${w.join(' AND ')}
    ORDER BY array_position(ARRAY['URGENTE','ALTA','MEDIA','BASSA'], w.priority), w.opened_at LIMIT 10`, params)).map((x) => ({ ...x, sla: slaState(x) }));
  let anomalie = null; let energia = null;
  const fin = await financeLive();
  if (fin && !isManutentore(req)) {
    const e = buildEnergy(await loadEnergyData({ siteIds: ids }), await settings(), year);
    const from = new Date(Date.parse(today) - 365 * 86_400_000).toISOString().slice(0, 7);
    anomalie = e.anomalie.filter((a) => a.month >= from).slice(0, 8);
    energia = { kwh: e.network.totals.kwh, prev_kwh: e.network.prev.kwh, delta_pct: e.network.delta_kwh_pct, cost: e.network.totals.cost, co2: e.network.totals.co2, kwh_m2_anno: e.network.intensity.kwh_m2_anno, months: e.network.totals.months };
  }
  let senzaPlanimetria = [];
  if (!isManutentore(req)) {
    await ensureProperties();
    senzaPlanimetria = await many(`SELECT s.id, s.name, s.kind FROM sites_v s JOIN facility.properties p ON p.site_id=s.id WHERE s.active ${ids ? 'AND s.id = ANY($1::int[])' : ''}
      AND NOT EXISTS (SELECT 1 FROM public.site_documents d WHERE d.site_id=s.id AND d.kind='PLANIMETRIA') ORDER BY s.sort_order, s.name`, ids ? [ids] : []);
  }
  res.json({ today, year, kpi, scadenze, interventi, anomalie, energia, senza_planimetria: senzaPlanimetria, finance: fin, room: await roomReady(), ruolo: { facility: isFacility(req), site: isSite(req), manutentore: isManutentore(req) } });
}));

async function stato() {
  const imp = await settings();
  const ultimo = await one(`SELECT max(sent_at) AS sent_at, count(*)::int AS n FROM plan_reminders`);
  return { ...imp, defaults: { co2_factors: CO2_DEFAULT, kwh_factors: KWH_FACTOR }, storage: storageMode(), mail: mailStatus(), ai: aiState(), pdf_font: fontName(), finance: await financeLive(), room: await roomReady(),
    activity: await activityAvailability(), limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerUpload }, ultimo_promemoria: ultimo };
}
r.get('/settings', requireFacility, ah(async (_req, res) => res.json(await stato())));
const factors = z.object(Object.fromEntries(VECTORS.map((v) => [v, z.coerce.number().min(0).max(100)]))).partial();
r.put('/settings', requireFacility, ah(async (req, res) => {
  const b = parse(z.object({
    sla_hours: z.object({ URGENTE: z.coerce.number().min(1).max(2000), ALTA: z.coerce.number().min(1).max(4000), MEDIA: z.coerce.number().min(1).max(8000), BASSA: z.coerce.number().min(1).max(20000) }).partial().optional(),
    co2_factors: factors.optional(), kwh_factors: factors.optional(),
    reminder_days: z.array(z.coerce.number().int().min(0).max(120)).min(1).max(5).optional(),
    anomaly_pct: z.coerce.number().min(5).max(200).optional(),
    activity_source: z.enum(['AUTO', 'RETAIL', 'CASH', 'MANUALE']).optional(),
    notify_site_managers: z.boolean().optional(),
  }), req.body || {});
  const cur = await settings();
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, (v && typeof v === 'object' && !Array.isArray(v)) ? { ...cur[k], ...v } : v, req.user.id);
  await audit(req, 'FACILITY_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', ') });
  res.json(await stato());
}));

// Job delle scadenze eseguito a mano (data di prova solo fuori produzione)
r.post('/jobs/scadenze/run', requireFacility, ah(async (req, res) => {
  const today = process.env.NODE_ENV !== 'production' && /^\d{4}-\d{2}-\d{2}$/.test(req.body?.today || '') ? req.body.today : undefined;
  const out = await runScadenze({ today, dryRun: Boolean(req.body?.dry_run) });
  await audit(req, 'FACILITY_JOB_SCADENZE', { module: KEY, entity: 'job', label: 'scadenze', data: { scadute: out.scadute, gruppi: out.gruppi, notifiche: out.notifiche, test_date: today || null } });
  res.json(out);
}));

export default r;
