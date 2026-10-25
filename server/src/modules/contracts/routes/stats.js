import { Router } from 'express';
import { many, one } from '../db.js';
import { ah } from '../lib/util.js';
import { getSettings, costCoefficient, companyCost, ralAt } from '../lib/payroll.js';
import { computeDeadlines, missingDocuments } from '../lib/deadlines.js';

const r = Router();
const r2 = (n) => Math.round(n * 100) / 100;

async function headcount() {
  const rows = await many(`SELECT r.id, r.kind, r.status, r.sex, r.area_id, a.name AS area_name, at.root_name AS area_root, at.path AS area_path, r.last_name, r.first_name, r.hired_at, r.terminated_at, r.birth_date,
      e.contract_type, e.level, e.job_title, e.ral, e.ral_steps, e.mbo_enabled, e.mbo_pct, e.mbo_amount, e.cost_coefficient, e.weekly_hours,
      l.discipline, l.est_monthly_cost, l.fees
    FROM resources_v r LEFT JOIN areas a ON a.id=r.area_id LEFT JOIN areas_tree at ON at.id=r.area_id LEFT JOIN employments e ON e.resource_id=r.id LEFT JOIN lp_contracts l ON l.resource_id=r.id
    WHERE r.status IN ('ATTIVO','IMPEGNO') OR (r.status='CESSATO' AND r.terminated_at >= (CURRENT_DATE - INTERVAL '13 months')) ORDER BY r.last_name, r.first_name`);
  const S = await getSettings();
  const year = new Date().getFullYear();
  return rows.map((x) => {
    let annual = 0; let monthly = 0; let mbo = 0; let ral = null;
    if (x.kind === 'DIPENDENTE') {
      ral = ralAt(x);
      const c = companyCost(ral, costCoefficient(S, x), x.mbo_enabled ? (Number(x.mbo_amount) > 0 && ral ? Number(x.mbo_amount) / ral * 100 : x.mbo_pct) : 0);
      annual = c.annual; monthly = c.monthly; mbo = c.mbo_max;
    } else {
      monthly = Number(x.est_monthly_cost || 0); annual = r2(monthly * 12);
    }
    // Costo dell'esercizio corrente pro rata: dall'ingresso (o 1° gennaio) alla cessazione (o 31 dicembre)
    const from = x.hired_at && String(x.hired_at).slice(0, 10) > `${year}-01-01` ? String(x.hired_at).slice(0, 10) : `${year}-01-01`;
    const to = x.terminated_at && String(x.terminated_at).slice(0, 10) < `${year}-12-31` ? String(x.terminated_at).slice(0, 10) : `${year}-12-31`;
    const days = Math.max(0, (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 + 1);
    const cost_year = r2(annual * Math.min(1, days / 365));
    return { ...x, ral_current: ral, cost_annual: annual, cost_monthly: monthly, cost_mbo_max: mbo, cost_year, active_days_year: Math.round(days), leaving: Boolean(x.terminated_at) };
  });
}

r.get('/summary', ah(async (req, res) => {
  const rows = await headcount();
  const viewer = req.user.role === 'VIEWER';
  const active = rows.filter((x) => x.status === 'ATTIVO');
  const sum = (arr, k) => r2(arr.reduce((a, x) => a + Number(x[k] || 0), 0));
  const group = (arr, keyFn, labelFn = (k) => k) => {
    const m = new Map();
    for (const x of arr) { const k = keyFn(x) ?? 'Non assegnata'; if (!m.has(k)) m.set(k, { key: k, label: labelFn(k), count: 0, employees: 0, lp: 0, female: 0, male: 0, cost_annual: 0, cost_monthly: 0, ids: [] }); const g = m.get(k); g.count++; g[x.kind === 'DIPENDENTE' ? 'employees' : 'lp']++; if (x.sex === 'F') g.female++; if (x.sex === 'M') g.male++; g.cost_annual = r2(g.cost_annual + x.cost_annual); g.cost_monthly = r2(g.cost_monthly + x.cost_monthly); g.ids.push(x.id); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  const totals = {
    total: active.length,
    employees: active.filter((x) => x.kind === 'DIPENDENTE').length,
    lp: active.filter((x) => x.kind === 'LP').length,
    pending: rows.filter((x) => x.status === 'IMPEGNO').length,
    female: active.filter((x) => x.sex === 'F').length,
    male: active.filter((x) => x.sex === 'M').length,
    cost_annual: sum(active, 'cost_annual'),
    cost_monthly: sum(active, 'cost_monthly'),
    cost_mbo_max: sum(active, 'cost_mbo_max'),
    ral_total: sum(active.filter((x) => x.kind === 'DIPENDENTE'), 'ral_current'),
    cost_employees_annual: sum(active.filter((x) => x.kind === 'DIPENDENTE'), 'cost_annual'),
    cost_lp_annual: sum(active.filter((x) => x.kind === 'LP'), 'cost_annual'),
    cost_year: sum(rows.filter((x) => x.status !== 'IMPEGNO'), 'cost_year'),
    year: new Date().getFullYear(),
    leaving: active.filter((x) => x.terminated_at).length,
  };
  // raggruppa per unità di 2° livello (direzione/linea); le aree di 3° livello confluiscono nella loro linea
  for (const x of active) x.area_group = x.area_path ? (x.area_path.split(' › ')[1] || x.area_path) : x.area_name;
  const byArea = group(active, (x) => x.area_group);
  const byContract = group(active, (x) => (x.kind === 'LP' ? 'LP' : x.contract_type || 'TIND'), (k) => ({ TIND: 'Tempo indeterminato', TDET: 'Tempo determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente', LP: 'Libero professionista' }[k] || k));
  const byLevel = group(active.filter((x) => x.kind === 'DIPENDENTE'), (x) => x.level || 'n.d.', (k) => (k === 'Q' ? 'Quadro' : `Livello ${k}`));
  const byDiscipline = group(active.filter((x) => x.kind === 'LP'), (x) => x.discipline || 'n.d.');
  // Andamento organico per mese (ultimi 12 mesi e prossimi 3) in base alla data di ingresso
  const months = [];
  const now = new Date(); now.setDate(1);
  for (let i = -11; i <= 3; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push(d.toISOString().slice(0, 7)); }
  const trend = months.map((m) => { const end = `${m}-31`; const start = `${m}-01`; const inForce = rows.filter((x) => x.hired_at && String(x.hired_at).slice(0, 10) <= end && (!x.terminated_at || String(x.terminated_at).slice(0, 10) >= start)); return { month: m, employees: inForce.filter((x) => x.kind === 'DIPENDENTE').length, lp: inForce.filter((x) => x.kind === 'LP').length, cost_monthly: r2(inForce.reduce((a, x) => a + x.cost_monthly, 0)) }; });
  // Età media
  const ages = active.filter((x) => x.birth_date).map((x) => (Date.now() - new Date(x.birth_date)) / (365.25 * 86400000));
  const deadlines = await computeDeadlines({ horizonDays: Number((await getSettings()).deadline_alert_days || 60) });
  // Dossier incompleti
  const incomplete = [];
  for (const x of active) { const chk = await missingDocuments(x.id, x.kind); const miss = chk.filter((c) => c.required && !c.present); if (miss.length) incomplete.push({ id: x.id, name: `${x.last_name} ${x.first_name}`, kind: x.kind, missing: miss.length, items: miss.map((c) => c.label) }); }
  const cv = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='NUOVO')::int AS new FROM cv_box`);
  const letters = await one(`SELECT count(*) FILTER (WHERE status IN ('BOZZA','INVIATA'))::int AS open, count(*) FILTER (WHERE status='ACCETTATA')::int AS accepted FROM commitment_letters`);
  const strip = (g) => (viewer ? g.map(({ cost_annual, cost_monthly, ...rest }) => rest) : g);
  const t = viewer ? { ...totals, cost_annual: null, cost_monthly: null, cost_mbo_max: null, ral_total: null, cost_employees_annual: null, cost_lp_annual: null, cost_year: null } : totals;
  res.json({ totals: t, by_area: strip(byArea), by_contract: strip(byContract), by_level: strip(byLevel), by_discipline: strip(byDiscipline), trend: viewer ? trend.map(({ cost_monthly, ...x }) => x) : trend,
    avg_age: ages.length ? r2(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    deadlines: deadlines.slice(0, 50), deadlines_overdue: deadlines.filter((d) => d.days < 0).length, deadlines_soon: deadlines.filter((d) => d.days >= 0 && d.days <= 30).length,
    incomplete_dossiers: incomplete, cv, letters,
    people: viewer ? active.map(({ ral, ral_current, cost_annual, cost_monthly, cost_mbo_max, ral_steps, ...x }) => x) : active });
}));

r.get('/deadlines', ah(async (req, res) => {
  res.json(await computeDeadlines({ horizonDays: Number(req.query.days || 365) }));
}));

r.get('/costs.xlsx', ah(async (req, res) => {
  if (req.user.role === 'VIEWER') return res.status(403).json({ error: 'Non autorizzato' });
  const ExcelJS = (await import('exceljs')).default;
  const rows = await headcount();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Organico e costi');
  ws.columns = [{ header: 'Cognome', key: 'last_name', width: 18 }, { header: 'Nome', key: 'first_name', width: 16 }, { header: 'Tipo', key: 'kind', width: 12 }, { header: 'Stato', key: 'status', width: 10 }, { header: 'Sesso', key: 'sex', width: 6 }, { header: 'Area', key: 'area_name', width: 26 }, { header: 'Contratto', key: 'contract_type', width: 14 }, { header: 'Livello', key: 'level', width: 8 }, { header: 'Mansione / Disciplina', key: 'job', width: 36 }, { header: 'Ingresso', key: 'hired_at', width: 12 }, { header: 'RAL vigente', key: 'ral_current', width: 14 }, { header: 'Costo mensile', key: 'cost_monthly', width: 14 }, { header: 'Costo annuo', key: 'cost_annual', width: 14 }, { header: 'MBO max', key: 'cost_mbo_max', width: 12 }];
  for (const x of rows) ws.addRow({ ...x, job: x.job_title || x.discipline, hired_at: x.hired_at ? String(x.hired_at).slice(0, 10) : '' });
  ws.getRow(1).font = { bold: true };
  ['K', 'L', 'M', 'N'].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.00'; });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="organico_costi.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

export default r;
