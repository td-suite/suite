// Report: rapporto energetico annuale (PDF e XLSX, per sede o di rete) e registro delle manutenzioni (PDF e XLSX con KPI), KPI delle
// manutenzioni per il cruscotto e la pagina Report. Il site manager scarica solo le proprie sedi; il manutentore solo i propri dati.
import { Router } from 'express';
import { one } from '../db.js';
import { ah, audit, bad, forbidden } from '../../../lib/util.js';
import { assertSite, limitedToSites, mySiteIds, isManutentore, vendorScope } from '../lib/access.js';
import { KEY, settings, todayRome, financeLive, FINANCE_OFF, siteById } from '../lib/core.js';
import { loadEnergyData, buildEnergy } from '../lib/energy.js';
import { maintenanceKpi } from '../lib/kpi.js';
import { listPlans } from './plans.js';
import { energiaPdf, energiaXlsx, manutenzioniPdf, manutenzioniXlsx } from '../lib/export.js';
import { many } from '../db.js';
import { slaState } from '../lib/calc.js';

const r = Router();
const yearOf = (v) => { const y = Number(v) || Number(todayRome().slice(0, 4)); if (y < 2000 || y > 2100) throw bad('Anno non valido'); return y; };
const siteOf = (req) => { if (req.query.site_id) { const id = Number(req.query.site_id); assertSite(req, id); return id; } if (limitedToSites(req)) { if (mySiteIds(req).length === 1) return mySiteIds(req)[0]; throw bad('Scegli la sede'); } return null; };
const fname = (s) => s.replace(/[^\w\-. àèéìòù]/gi, '');

r.get('/kpi', ah(async (req, res) => {
  const year = yearOf(req.query.year);
  const siteId = req.query.site_id ? siteOf(req) : null;
  const vs = vendorScope(req);
  res.json(await maintenanceKpi({ siteIds: siteId ? [siteId] : (limitedToSites(req) ? mySiteIds(req) : null), year, vendorOrgId: vs?.orgId || null }));
}));

async function energyReport(req) {
  if (isManutentore(req)) throw forbidden('Report energetici non disponibili per i manutentori');
  if (!(await financeLive())) throw bad(FINANCE_OFF);
  const year = yearOf(req.query.year);
  const siteId = siteOf(req);
  const data = await loadEnergyData({ siteIds: siteId ? [siteId] : null });
  const e = buildEnergy(data, await settings(), year);
  const analisi = await one(`SELECT id, result, model, generated_at FROM energy_analyses WHERE coalesce(site_id,0)=$1 AND year=$2 ORDER BY generated_at DESC LIMIT 1`, [siteId || 0, year]);
  const scope = siteId ? (await siteById(siteId)).name : 'Rete';
  return { e, siteId, analisi, year, scope };
}
r.get('/report/energia.pdf', ah(async (req, res) => {
  const x = await energyReport(req);
  const pdf = await energiaPdf(x.e, { siteId: x.siteId, analisi: x.analisi });
  await audit(req, 'FACILITY_REPORT', { module: KEY, entity: 'report', label: 'energia.pdf', data: { year: x.year, site_id: x.siteId } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fname(`Rapporto energetico ${x.year} ${x.scope}.pdf`))}`);
  res.send(pdf);
}));
r.get('/report/energia.xlsx', ah(async (req, res) => {
  const x = await energyReport(req);
  const buf = await energiaXlsx(x.e, { siteId: x.siteId });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname(`Rapporto energetico ${x.year} ${x.scope}.xlsx`))}`);
  res.send(buf);
}));

async function maintReport(req) {
  const year = yearOf(req.query.year);
  const siteId = req.query.site_id ? siteOf(req) : null;
  const plans = await listPlans(req, { site_id: siteId || undefined, from: `${year}-01-01`, to: `${year}-12-31`, limit: 5000 });
  const params = [year]; const w = ['extract(year FROM w.opened_at)=$1'];
  if (siteId) { params.push(siteId); w.push(`w.site_id=$${params.length}`); } else if (limitedToSites(req)) { params.push(mySiteIds(req)); w.push(`w.site_id = ANY($${params.length}::int[])`); }
  const vs = vendorScope(req);
  if (vs) { params.push(vs.orgId); w.push(`w.vendor_org_id=$${params.length}`); }
  const wos = (await many(`SELECT w.*, s.name AS site_name, v.name AS vendor_name, au.full_name AS assigned_name FROM work_orders w JOIN public.sites s ON s.id=w.site_id LEFT JOIN public.organizations v ON v.id=w.vendor_org_id
    LEFT JOIN public.users au ON au.id=w.assigned_user_id WHERE ${w.join(' AND ')} ORDER BY w.opened_at`, params)).map((x) => ({ ...x, sla: slaState(x), mttr_hours: x.closed_at ? Math.round(((new Date(x.closed_at) - new Date(x.opened_at)) / 3_600_000) * 10) / 10 : null }));
  const kpi = await maintenanceKpi({ siteIds: siteId ? [siteId] : (limitedToSites(req) ? mySiteIds(req) : null), year, vendorOrgId: vs?.orgId || null });
  const scope = siteId ? (await siteById(siteId)).name : 'Rete';
  return { plans, wos, kpi, year, scope };
}
r.get('/report/manutenzioni.xlsx', ah(async (req, res) => {
  const x = await maintReport(req);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname(`Registro manutenzioni ${x.year} ${x.scope}.xlsx`))}`);
  res.send(await manutenzioniXlsx(x));
}));
r.get('/report/manutenzioni.pdf', ah(async (req, res) => {
  const x = await maintReport(req);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fname(`Registro manutenzioni ${x.year} ${x.scope}.pdf`))}`);
  res.send(await manutenzioniPdf(x));
}));

export default r;
