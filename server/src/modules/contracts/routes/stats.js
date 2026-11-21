import { Router } from 'express';
import { many, one } from '../db.js';
import { z } from 'zod';
import { ah, audit, parse } from '../lib/util.js';
import { getSettings, costCoefficient, companyCost, ralAt } from '../lib/payroll.js';
import { computeDeadlines, missingDocuments } from '../lib/deadlines.js';
import { soloLp, requireWrite } from '../lib/access.js';
import { segnala, fermaSegnalazione, statoSegnalazioni, runSolleciti } from '../lib/segnalazioni.js';
import { compensiLp } from './resources.js';

const r = Router();
const r2 = (n) => Math.round(n * 100) / 100;

async function headcount() {
  const rows = await many(`SELECT r.id, r.kind, r.status, r.sex, r.area_id, a.name AS area_name, at.root_name AS area_root, at.path AS area_path, r.last_name, r.first_name, r.hired_at, r.terminated_at, r.birth_date,
      e.contract_type, e.level, e.job_title, e.ral, e.ral_steps, e.mbo_enabled, e.mbo_pct, e.mbo_amount, e.cost_coefficient, e.weekly_hours,
      l.discipline, l.est_monthly_cost, l.fees, ti.indennita_mensile
    FROM resources_v r LEFT JOIN areas a ON a.id=r.area_id LEFT JOIN areas_tree at ON at.id=r.area_id LEFT JOIN employments e ON e.resource_id=r.id LEFT JOIN lp_contracts l ON l.resource_id=r.id
      LEFT JOIN tirocini ti ON ti.resource_id=r.id
    WHERE r.status = 'ATTIVO' OR (r.status='CESSATO' AND r.terminated_at >= (CURRENT_DATE - INTERVAL '13 months')) ORDER BY r.last_name, r.first_name`);
  const S = await getSettings();
  const year = new Date().getFullYear();
  return rows.map((x) => {
    let annual = 0; let monthly = 0; let mbo = 0; let ral = null;
    if (x.kind === 'DIPENDENTE') {
      ral = ralAt(x);
      const c = companyCost(ral, costCoefficient(S, x), x.mbo_enabled ? (Number(x.mbo_amount) > 0 && ral ? Number(x.mbo_amount) / ral * 100 : x.mbo_pct) : 0);
      annual = c.annual; monthly = c.monthly; mbo = c.mbo_max;
    } else {
      // tirocinante: il costo è l'indennità di partecipazione, se prevista
      monthly = Number((x.kind === 'TIROCINANTE' ? x.indennita_mensile : x.est_monthly_cost) || 0); annual = r2(monthly * 12);
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
    for (const x of arr) { const k = keyFn(x) ?? 'Non assegnata'; if (!m.has(k)) m.set(k, { key: k, label: labelFn(k), count: 0, employees: 0, lp: 0, tirocinanti: 0, female: 0, male: 0, cost_annual: 0, cost_monthly: 0, ids: [] }); const g = m.get(k); g.count++; g[x.kind === 'DIPENDENTE' ? 'employees' : x.kind === 'TIROCINANTE' ? 'tirocinanti' : 'lp']++; if (x.sex === 'F') g.female++; if (x.sex === 'M') g.male++; g.cost_annual = r2(g.cost_annual + x.cost_annual); g.cost_monthly = r2(g.cost_monthly + x.cost_monthly); g.ids.push(x.id); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  const totals = {
    total: active.length,
    employees: active.filter((x) => x.kind === 'DIPENDENTE').length,
    lp: active.filter((x) => x.kind === 'LP').length,
    tirocinanti: active.filter((x) => x.kind === 'TIROCINANTE').length,
    pending: (await one(`SELECT count(*)::int AS n FROM resources_v WHERE status = 'IMPEGNO'`)).n,   // solo il numero: le persone in impegno non entrano nelle righe
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
  const byContract = group(active, (x) => (x.kind === 'LP' ? 'LP' : x.kind === 'TIROCINANTE' ? 'TIROCINIO' : x.contract_type || 'TIND'), (k) => ({ TIROCINIO: 'Tirocinio', TIND: 'Tempo indeterminato', TDET: 'Tempo determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente', LP: 'Libero professionista' }[k] || k));
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

// Chi resta fuori dalle scadenze perché non è in servizio (lib/servizio.js): l'elenco si mostra in fondo al Calendario delle scadenze
r.get('/deadlines/esclusi', ah(async (_req, res) => {
  const { nonInServizio, datoriLavoro } = await import('../lib/servizio.js');
  res.json({ non_in_servizio: await nonInServizio(), datore_lavoro: (await one(`SELECT value FROM app_settings WHERE key='datore_lavoro'`))?.value || null, datori: (await datoriLavoro()).size });
}));

r.get('/deadlines', ah(async (req, res) => {
  const tutte = await computeDeadlines({ horizonDays: Number(req.query.days || 365) });
  const viste = soloLp(req.user) ? tutte.filter((d) => d.kind === 'LP') : tutte;   // profilo LP: solo le scadenze dei liberi professionisti
  // v0.92.0: stato della segnalazione (prima email, solleciti, prossimo) accanto a ogni scadenza
  const st = viste.length ? await statoSegnalazioni(viste.map((d) => d.key)) : {};
  res.json(viste.map((d) => ({ ...d, segnalazione: st[d.key] || null })));
}));

// "Segnala Scadenza" (v0.92.0): prima email dalla casella People e poi un sollecito ogni 7 giorni finché la scadenza resta aperta.
// prova = true: solo l'elenco con i destinatari. Solo chi scrive nel modulo (ADMIN, HR).
r.post('/deadlines/segnala', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ keys: z.array(z.string().min(1).max(80)).min(1).max(200), prova: z.boolean().optional() }), req.body);
  const out = await segnala(d.keys, { userId: req.user.id, prova: Boolean(d.prova) });
  if (!d.prova) await audit(req, 'SCADENZE_SEGNALATE', 'deadline', null, { chiavi: out.righe.map((x) => x.key), esiti: out.righe.reduce((m, x) => ({ ...m, [x.esito]: (m[x.esito] || 0) + 1 }), {}) });
  res.json(out);
}));
// Esegue subito il giro dei solleciti (lo stesso del job orario): utile dopo aver sistemato la posta
r.post('/deadlines/solleciti/esegui', requireWrite, ah(async (req, res) => {
  const out = await runSolleciti();
  await audit(req, 'SCADENZE_SOLLECITI_ESEGUITI', 'deadline', null, out);
  res.json(out);
}));
r.post('/deadlines/segnala/ferma', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ key: z.string().min(1).max(80) }), req.body);
  const n = await fermaSegnalazione(d.key, 'fermata a mano');
  if (n) await audit(req, 'SCADENZA_SOLLECITI_FERMATI', 'deadline', null, { chiave: d.key });
  res.json({ fermate: n });
}));

r.get('/costs.xlsx', ah(async (req, res) => {
  if (req.user.role === 'VIEWER') return res.status(403).json({ error: 'Non autorizzato' });
  const ExcelJS = (await import('exceljs')).default;
  // L'estratto segue l'elenco da cui parte (CEO, 14/11/2026): ?kind=LP solo liberi professionisti, ?kind=DIPENDENTE solo dipendenti.
  // Il profilo LP ottiene SEMPRE e solo gli LP. Prima l'estratto dell'Elenco LP conteneva tutto l'organico.
  const kind = soloLp(req.user) ? 'LP' : ['LP', 'DIPENDENTE'].includes(String(req.query.kind)) ? String(req.query.kind) : null;
  if (kind === 'LP') return estrattoLp(res, ExcelJS);
  const rows = (await headcount()).filter((x) => !kind || x.kind === kind);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Organico e costi');
  ws.columns = [{ header: 'Cognome', key: 'last_name', width: 18 }, { header: 'Nome', key: 'first_name', width: 16 }, { header: 'Tipo', key: 'kind', width: 12 }, { header: 'Stato', key: 'status', width: 10 }, { header: 'Sesso', key: 'sex', width: 6 }, { header: 'Area', key: 'area_name', width: 26 }, { header: 'Contratto', key: 'contract_type', width: 14 }, { header: 'Livello', key: 'level', width: 8 }, { header: 'Mansione / Disciplina', key: 'job', width: 36 }, { header: 'Ingresso', key: 'hired_at', width: 12 }, { header: 'RAL vigente', key: 'ral_current', width: 14 }, { header: 'Costo mensile', key: 'cost_monthly', width: 14 }, { header: 'Costo annuo', key: 'cost_annual', width: 14 }, { header: 'MBO max', key: 'cost_mbo_max', width: 12 }];
  for (const x of rows) ws.addRow({ ...x, job: x.job_title || x.discipline, hired_at: x.hired_at ? String(x.hired_at).slice(0, 10) : '' });
  ws.getRow(1).font = { bold: true };
  ['K', 'L', 'M', 'N'].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.00'; });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="${kind === 'DIPENDENTE' ? 'dipendenti_costi' : 'organico_costi'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// Estratto dei liberi professionisti: un foglio con una riga per professionista (fisso, tariffe orarie, numero di compensi a
// prestazione e variabili, costo stimato) e un foglio "Compensi" con una riga per OGNI compenso dell'incarico, di qualunque tipo.
const TIPO_COMPENSO = { FISSO: 'Fisso', ORARIO: 'Orario', PRESTAZIONE: 'A prestazione', VARIABILE: 'Variabile' };
async function estrattoLp(res, ExcelJS) {
  const rows = await many(`SELECT r.id, r.person_kind, r.status, r.sex, r.last_name, r.first_name, r.hired_at, r.terminated_at, a.name AS area_name, s.name AS site_name,
      l.discipline, l.start_date, l.end_date, l.auto_renew, l.notice_days, l.est_monthly_cost, l.fees, l.vat_regime, l.insurance_expiry
    FROM resources_v r LEFT JOIN areas a ON a.id=r.area_id LEFT JOIN public.sites s ON s.id=r.site_id LEFT JOIN lp_contracts l ON l.resource_id=r.id
    WHERE r.kind='LP' AND (r.status = 'ATTIVO' OR (r.status='CESSATO' AND r.terminated_at >= (CURRENT_DATE - INTERVAL '13 months'))) ORDER BY r.last_name, r.first_name`);
  const d = (x) => (x ? String(x instanceof Date ? x.toISOString() : x).slice(0, 10) : '');
  const TIPO_PERSONA = { LP: 'Libero professionista', MEDICO: 'Medico', SANITARIO: 'Personale sanitario' };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Liberi professionisti');
  ws.columns = [{ header: 'Cognome', key: 'last_name', width: 18 }, { header: 'Nome', key: 'first_name', width: 16 }, { header: 'Tipo', key: 'tipo', width: 20 }, { header: 'Stato', key: 'status', width: 10 },
    { header: 'Disciplina', key: 'discipline', width: 26 }, { header: 'Area', key: 'area_name', width: 24 }, { header: 'Sede', key: 'site_name', width: 24 }, { header: 'Inizio incarico', key: 'inizio', width: 14 },
    { header: 'Fine incarico', key: 'fine', width: 14 }, { header: 'Compenso fisso mensile', key: 'fisso', width: 20 }, { header: 'Tariffe orarie', key: 'orari', width: 30 },
    { header: 'Compensi a prestazione (n.)', key: 'prestazione', width: 14 }, { header: 'Compensi variabili (n.)', key: 'variabili', width: 14 },
    { header: 'Costo mensile stimato', key: 'mensile', width: 18 }, { header: 'Costo annuo stimato', key: 'annuo', width: 18 }, { header: 'Regime IVA', key: 'vat_regime', width: 18 }, { header: 'Scadenza polizza', key: 'polizza', width: 14 }];
  const wc = wb.addWorksheet('Compensi');
  wc.columns = [{ header: 'Cognome', key: 'last_name', width: 18 }, { header: 'Nome', key: 'first_name', width: 16 }, { header: 'Disciplina', key: 'discipline', width: 26 }, { header: 'Tipo di compenso', key: 'tipo', width: 16 },
    { header: 'Codice', key: 'code', width: 10 }, { header: 'Descrizione', key: 'description', width: 46 }, { header: 'Categoria', key: 'category', width: 22 }, { header: 'Importo', key: 'amount', width: 12 },
    { header: 'Unità', key: 'unit', width: 12 }, { header: 'IVA', key: 'vat', width: 10 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const x of rows) {
    const c = compensiLp(x.fees);
    const mensile = x.est_monthly_cost != null ? Number(x.est_monthly_cost) : null;
    ws.addRow({ ...x, tipo: TIPO_PERSONA[x.person_kind] || x.person_kind, inizio: d(x.start_date || x.hired_at), fine: d(x.end_date || x.terminated_at), fisso: c.fisso_mensile || null,
      orari: c.orari.map((o) => `${o.importo != null ? o.importo.toFixed(2).replace('.', ',') : 'n.d.'} €/${o.unita}`).join('; '), prestazione: c.prestazione || null, variabili: c.variabili || null,
      mensile, annuo: mensile != null ? r2(mensile * 12) : null, polizza: d(x.insurance_expiry) });
    for (const f of Array.isArray(x.fees) ? x.fees : []) {
      wc.addRow({ last_name: x.last_name, first_name: x.first_name, discipline: x.discipline, tipo: TIPO_COMPENSO[f.type] || f.type, code: f.code, description: f.description, category: f.category,
        amount: f.amount != null ? Number(f.amount) : null, unit: f.unit || (f.type === 'FISSO' ? 'mese' : f.type === 'ORARIO' ? 'ora' : ''), vat: f.vat === 'CON' ? 'con IVA' : f.vat === 'SENZA' ? 'senza IVA' : '', notes: f.notes });
    }
  }
  ws.getRow(1).font = { bold: true }; wc.getRow(1).font = { bold: true };
  ['J', 'N', 'O'].forEach((k) => { ws.getColumn(k).numFmt = '#,##0.00'; });
  wc.getColumn('H').numFmt = '#,##0.00';
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="liberi_professionisti_compensi.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}

export default r;
