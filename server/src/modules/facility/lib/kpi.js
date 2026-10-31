// KPI delle manutenzioni (cruscotto e report): scadenze rispettate %, scadute aperte, prossime 30 giorni, interventi per sede, MTTR,
// interventi chiusi entro SLA, costi per sede e per tipologia di dispositivo, dispositivi non conformi. Ambito: sedi indicate o tutte.
import { many, one } from '../db.js';
import { onTimeRate, mttrHours, slaState } from './calc.js';

export async function maintenanceKpi({ siteIds = null, year, vendorOrgId = null }) {
  const p = [year];
  const sw = (col) => (siteIds ? ` AND ${col} = ANY($${p.push(siteIds) && p.length}::int[])` : '');
  const sPlans = sw('p.site_id');
  const vPlans = vendorOrgId ? ` AND a.vendor_org_id = $${p.push(vendorOrgId) && p.length}` : '';
  const plans = await many(`SELECT p.status, p.due_date, p.done_at, p.cost, p.site_id, s.name AS site_name, t.name AS type_name FROM maintenance_plans p JOIN public.sites s ON s.id=p.site_id
    LEFT JOIN assets a ON a.id=p.asset_id LEFT JOIN public.asset_types t ON t.code=a.asset_type_code
    WHERE (extract(year FROM coalesce(p.done_at, p.due_date))=$1 OR p.status IN ('PIANIFICATA','SCADUTA'))${sPlans}${vPlans}`, p);
  const p2 = [year];
  const sw2 = siteIds ? ` AND w.site_id = ANY($${p2.push(siteIds) && p2.length}::int[])` : '';
  const vw2 = vendorOrgId ? ` AND w.vendor_org_id = $${p2.push(vendorOrgId) && p2.length}` : '';
  const wos = await many(`SELECT w.id, w.site_id, w.status, w.priority, w.opened_at, w.closed_at, w.due_at, w.cost, s.name AS site_name, t.name AS type_name FROM work_orders w JOIN public.sites s ON s.id=w.site_id
    LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN public.asset_types t ON t.code=a.asset_type_code
    WHERE (extract(year FROM w.opened_at)=$1 OR w.status <> 'CHIUSO')${sw2}${vw2}`, p2);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const doneYear = plans.filter((x) => x.status === 'ESEGUITA' && String(x.done_at).startsWith(String(year)));
  const woYear = wos.filter((w) => new Date(w.opened_at).getFullYear() === year);
  const closedYear = woYear.filter((w) => w.closed_at);
  const costi = new Map(), costiTipo = new Map(), perSede = new Map();
  for (const x of doneYear) { if (x.cost) { costi.set(x.site_name, (costi.get(x.site_name) || 0) + Number(x.cost)); costiTipo.set(x.type_name || 'Obblighi degli immobili', (costiTipo.get(x.type_name || 'Obblighi degli immobili') || 0) + Number(x.cost)); } }
  for (const w of woYear) {
    if (w.cost) { costi.set(w.site_name, (costi.get(w.site_name) || 0) + Number(w.cost)); costiTipo.set(w.type_name || 'Interventi senza dispositivo', (costiTipo.get(w.type_name || 'Interventi senza dispositivo') || 0) + Number(w.cost)); }
    const s = perSede.get(w.site_name) || { name: w.site_name, site_id: w.site_id, aperti: 0, chiusi: 0, urgenti: 0 };
    if (w.closed_at) s.chiusi++; else s.aperti++;
    if (w.priority === 'URGENTE') s.urgenti++;
    perSede.set(w.site_name, s);
  }
  const p3 = []; const sw3 = siteIds ? ` AND a.site_id = ANY($${p3.push(siteIds) && p3.length}::int[])` : '';
  const vw3 = vendorOrgId ? ` AND a.vendor_org_id = $${p3.push(vendorOrgId) && p3.length}` : '';
  const dev = await one(`SELECT count(*) FILTER (WHERE a.status='IN_SERVIZIO')::int AS dispositivi, count(*) FILTER (WHERE a.last_outcome='NON_CONFORME' AND a.status <> 'DISMESSO')::int AS non_conformi,
    count(*) FILTER (WHERE a.status='FUORI_SERVIZIO')::int AS fuori_servizio FROM assets a WHERE TRUE${sw3}${vw3}`, p3);
  const sort = (m) => [...m.entries()].map(([name, costo]) => ({ name, costo: Math.round(costo * 100) / 100 })).sort((a, b) => b.costo - a.costo);
  const slaOk = closedYear.filter((w) => !slaState(w).late).length;
  return {
    year, eseguite: doneYear.length, rispettate_pct: onTimeRate(doneYear),
    scadute: plans.filter((x) => ['PIANIFICATA', 'SCADUTA'].includes(x.status) && x.due_date < today).length,
    prossimi30: plans.filter((x) => x.status === 'PIANIFICATA' && x.due_date >= today && x.due_date <= in30).length,
    interventi_aperti_anno: woYear.length, interventi_aperti: wos.filter((w) => w.status !== 'CHIUSO').length,
    interventi_urgenti_aperti: wos.filter((w) => w.status !== 'CHIUSO' && ['URGENTE', 'ALTA'].includes(w.priority)).length,
    mttr_ore: mttrHours(closedYear), sla_pct: closedYear.length ? Math.round((slaOk / closedYear.length) * 1000) / 10 : null,
    non_conformi: dev?.non_conformi || 0, dispositivi: dev?.dispositivi || 0, fuori_servizio: dev?.fuori_servizio || 0,
    costo_totale: Math.round(sort(costi).reduce((a, x) => a + x.costo, 0) * 100) / 100, costi_per_sede: sort(costi), costi_per_tipo: sort(costiTipo),
    interventi_per_sede: [...perSede.values()].sort((a, b) => (b.aperti + b.chiusi) - (a.aperti + a.chiusi)),
  };
}
