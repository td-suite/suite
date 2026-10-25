import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireWrite } from '../lib/access.js';
import { config } from '../config.js';
import { plannedDays } from '../lib/calendar.js';
import { parseFile, toNum } from '../lib/importer.js';
import { toXlsx } from '../lib/exports.js';
import { collectSignals, narrative } from '../lib/variance.js';
import { METRIC_LABEL } from '../lib/marketSeed.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

// ---------------- Giorni lavorati ----------------
r.get('/working-days', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const site = siteId ? await one('SELECT saturday_open FROM sites WHERE id=$1', [siteId]) : null;
  const rows = await many('SELECT * FROM working_days WHERE year=$1 AND coalesce(site_id,0)=$2', [year, siteId || 0]);
  const actual = await many(`SELECT date_part('month', sale_date)::int AS month, count(DISTINCT sale_date)::int AS days, coalesce(sum(net_amount),0) AS revenue, count(DISTINCT (source, external_ref))::int AS tickets FROM sales WHERE date_part('year', sale_date)=$1 ${siteId ? 'AND site_id=$2' : ''} GROUP BY 1`, siteId ? [year, siteId] : [year]);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const row = rows.find((x) => x.month === m); const a = actual.find((x) => x.month === m);
    const planned = row?.planned ?? plannedDays(year, m, { saturday: site ? site.saturday_open : true });
    const actualDays = row?.actual_override ?? a?.days ?? 0;
    months.push({ month: m, planned, saved: Boolean(row), actual: actualDays, actual_from_sales: a?.days ?? 0, override: row?.actual_override ?? null, revenue: Number(a?.revenue || 0), tickets: a?.tickets || 0, revenue_per_day: actualDays ? Number(a?.revenue || 0) / actualDays : 0, notes: row?.notes || null });
  }
  res.json({ year, site_id: siteId, months, totals: { planned: months.reduce((x, m) => x + m.planned, 0), actual: months.reduce((x, m) => x + m.actual, 0) } });
}));
r.put('/working-days', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ year: z.number().int(), site_id: z.number().int().nullable().optional(), months: z.array(z.object({ month: z.number().int().min(1).max(12), planned: z.number().int().min(0).max(31), override: z.number().int().min(0).max(31).nullable().optional(), notes: z.string().nullable().optional() })) }), req.body);
  for (const m of d.months) await q(`INSERT INTO working_days(year, month, site_id, planned, actual_override, notes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (year, month, coalesce(site_id, 0)) DO UPDATE SET planned=EXCLUDED.planned, actual_override=EXCLUDED.actual_override, notes=EXCLUDED.notes, updated_at=now()`, [d.year, m.month, d.site_id || null, m.planned, m.override ?? null, m.notes || null]);
  await audit(req, 'WORKING_DAYS_UPDATE', 'working_days', `${d.year}/${d.site_id || 'network'}`);
  res.json({ ok: true });
}));
// Applica il calendario standard (festività nazionali) all'anno, per il network e per ogni sede
r.post('/working-days/default', requireWrite, ah(async (req, res) => {
  const { year } = parse(z.object({ year: z.number().int() }), req.body);
  const sites = await many("SELECT id, saturday_open FROM sites WHERE active AND kind<>'HEADQUARTER'");
  for (let m = 1; m <= 12; m++) {
    await q('INSERT INTO working_days(year, month, site_id, planned) VALUES ($1,$2,NULL,$3) ON CONFLICT (year, month, coalesce(site_id, 0)) DO UPDATE SET planned=EXCLUDED.planned', [year, m, plannedDays(year, m, { saturday: true })]);
    for (const s of sites) await q('INSERT INTO working_days(year, month, site_id, planned) VALUES ($1,$2,$3,$4) ON CONFLICT (year, month, coalesce(site_id, 0)) DO UPDATE SET planned=EXCLUDED.planned', [year, m, s.id, plannedDays(year, m, { saturday: s.saturday_open })]);
  }
  res.json({ ok: true });
}));

// ---------------- Budget ----------------
const ACTUAL = `SELECT date_part('month', s.sale_date)::int AS month, p.line_id, s.site_id, coalesce(sum(s.net_amount),0) AS amount, count(DISTINCT (s.source, s.external_ref))::int AS tickets FROM sales s LEFT JOIN products p ON p.id=s.product_id WHERE date_part('year', s.sale_date)=$1 GROUP BY 1,2,3`;

r.get('/budgets', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const [budgets, actual, lines, sites, prev] = await Promise.all([
    many('SELECT * FROM budgets WHERE year=$1', [year]), many(ACTUAL, [year]), many('SELECT id, code, name, color FROM product_lines ORDER BY sort_order'), many("SELECT id, code, name, kind FROM sites WHERE active AND kind<>'HEADQUARTER' ORDER BY sort_order, name"), many(ACTUAL, [year - 1]),
  ]);
  const sum = (rows, f) => rows.filter(f).reduce((a, x) => a + Number(x.amount), 0);
  const byLine = lines.map((l) => ({ line: l, months: Array.from({ length: 12 }, (_, i) => { const m = i + 1; const b = budgets.find((x) => x.month === m && x.line_id === l.id && !x.site_id); return { month: m, budget: Number(b?.amount || 0), budget_tickets: b?.tickets ?? null, actual: sum(actual, (x) => x.month === m && x.line_id === l.id), prev: sum(prev, (x) => x.month === m && x.line_id === l.id) }; }) }));
  const bySite = sites.map((s) => ({ site: s, months: Array.from({ length: 12 }, (_, i) => { const m = i + 1; const b = budgets.find((x) => x.month === m && x.site_id === s.id && !x.line_id); return { month: m, budget: Number(b?.amount || 0), budget_tickets: b?.tickets ?? null, actual: sum(actual, (x) => x.month === m && x.site_id === s.id), prev: sum(prev, (x) => x.month === m && x.site_id === s.id) }; }) }));
  const total = Array.from({ length: 12 }, (_, i) => { const m = i + 1; return { month: m, budget: byLine.reduce((a, l) => a + l.months[i].budget, 0), actual: sum(actual, (x) => x.month === m), prev: sum(prev, (x) => x.month === m) }; });
  res.json({ year, byLine, bySite, total, current_month: new Date().getMonth() + 1, current_year: new Date().getFullYear() });
}));

r.put('/budgets', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ year: z.number().int(), rows: z.array(z.object({ month: z.number().int().min(1).max(12), line_id: z.number().int().nullable().optional(), site_id: z.number().int().nullable().optional(), amount: z.number(), tickets: z.number().int().nullable().optional() })) }), req.body);
  for (const x of d.rows) await q('INSERT INTO budgets(year, month, line_id, site_id, amount, tickets, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (year, month, coalesce(line_id, 0), coalesce(site_id, 0)) DO UPDATE SET amount=EXCLUDED.amount, tickets=coalesce(EXCLUDED.tickets, budgets.tickets), updated_by=EXCLUDED.updated_by, updated_at=now()', [d.year, x.month, x.line_id || null, x.site_id || null, x.amount, x.tickets ?? null, req.user.id]);
  await audit(req, 'BUDGET_UPDATE', 'budget', String(d.year), { rows: d.rows.length });
  res.json({ ok: true });
}));

// Format Excel: un foglio per linea (12 colonne mese) e uno per sede
r.get('/budgets/template.xlsx', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const lines = await many('SELECT code, name FROM product_lines ORDER BY sort_order');
  const sites = await many("SELECT code, name FROM sites WHERE active AND kind<>'HEADQUARTER' ORDER BY sort_order, name");
  const budgets = await many('SELECT b.*, pl.code AS line_code, s.code AS site_code FROM budgets b LEFT JOIN product_lines pl ON pl.id=b.line_id LEFT JOIN sites s ON s.id=b.site_id WHERE year=$1', [year]);
  const cols = [{ header: 'Codice', key: 'code' }, { header: 'Nome', key: 'name', width: 36 }, ...Array.from({ length: 12 }, (_, i) => ({ header: `${String(i + 1).padStart(2, '0')}/${year}`, key: `m${i + 1}`, money: true, width: 13 }))];
  const rowFor = (code, name, f) => { const o = { code, name }; for (let m = 1; m <= 12; m++) o[`m${m}`] = Number(budgets.find((b) => b.month === m && f(b))?.amount || 0); return o; };
  const buf = await toXlsx([
    { name: 'Budget per linea', columns: cols, rows: lines.map((l) => rowFor(l.code, l.name, (b) => b.line_code === l.code && !b.site_id)) },
    { name: 'Budget per sede', columns: cols, rows: sites.map((s) => rowFor(s.code, s.name, (b) => b.site_code === s.code && !b.line_id)) },
    { name: 'Istruzioni', columns: [{ header: 'Istruzioni', key: 'a', width: 110 }], rows: ['Compila gli importi mensili (fatturato netto in euro) nei due fogli. Il codice identifica la linea (LAB, IMG, SPEC, MDL, PAC) o la sede (es. FI-CEC).', 'Le righe con codice non riconosciuto vengono ignorate e segnalate. Ricaricando il file i valori vengono sovrascritti.', 'Il budget per linea è il riferimento del network; il budget per sede serve per la lettura per punto vendita. I due totali possono differire.'].map((a) => ({ a })) },
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="budget_${year}.xlsx"`);
  res.send(buf);
}));

r.post('/budgets/import', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const year = Number(req.body.year || new Date().getFullYear());
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
  const lines = await many('SELECT id, code FROM product_lines'); const sites = await many('SELECT id, code, name FROM sites');
  let saved = 0; const errors = []; const ops = [];
  for (const ws of wb.worksheets) {
    if (/istruzioni/i.test(ws.name)) continue;
    const isSite = /sede|punto|site/i.test(ws.name);
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const code = String(row.getCell(1).value ?? '').trim().toUpperCase(); if (!code) return;
      const target = isSite ? sites.find((s) => s.code.toUpperCase() === code || s.name.toUpperCase() === code) : lines.find((l) => l.code.toUpperCase() === code);
      if (!target) { errors.push(`${ws.name}, riga ${i}: codice "${code}" non riconosciuto`); return; }
      for (let m = 1; m <= 12; m++) { const v = toNum(row.getCell(2 + m).value); if (v == null) continue; ops.push(['INSERT INTO budgets(year, month, line_id, site_id, amount, updated_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (year, month, coalesce(line_id, 0), coalesce(site_id, 0)) DO UPDATE SET amount=EXCLUDED.amount, updated_by=EXCLUDED.updated_by, updated_at=now()', [year, m, isSite ? null : target.id, isSite ? target.id : null, v, req.user.id]]); saved++; }
    });
  }
  for (const [sql, params] of ops) await q(sql, params);
  await audit(req, 'BUDGET_IMPORT', 'budget', String(year), { saved, errors: errors.length });
  res.json({ ok: true, saved, errors });
}));

// ---------------- Analisi degli scostamenti ----------------
r.get('/variance', ah(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = Number(req.query.month || new Date().getMonth() + 1);
  const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const lineId = req.query.line_id ? Number(req.query.line_id) : null;
  const withAi = req.query.ai === '1';
  const actualRows = await many(ACTUAL, [year]);
  const prevRows = await many(ACTUAL, [year - 1]);
  const budgets = await many('SELECT * FROM budgets WHERE year=$1 AND month=$2', [year, month]);
  const lines = await many('SELECT id, code, name FROM product_lines ORDER BY sort_order');
  const sites = await many("SELECT id, code, name, kind, city FROM sites WHERE active AND kind<>'HEADQUARTER' ORDER BY sort_order, name");
  const sum = (rows, f) => rows.filter((x) => x.month === month && f(x)).reduce((a, x) => a + Number(x.amount), 0);
  const mk = (label, budget, actual, prev, extra) => ({ label, budget, actual, prev, variance: actual - budget, variance_pct: budget ? Math.round(((actual - budget) / budget) * 1000) / 10 : null, yoy_pct: prev ? Math.round(((actual - prev) / prev) * 1000) / 10 : null, ...extra });
  const byLine = lines.map((l) => mk(l.name, Number(budgets.find((b) => b.line_id === l.id && !b.site_id)?.amount || 0), sum(actualRows, (x) => x.line_id === l.id && (!siteId || x.site_id === siteId)), sum(prevRows, (x) => x.line_id === l.id && (!siteId || x.site_id === siteId)), { line_id: l.id }));
  const bySite = sites.map((s) => mk(s.name, Number(budgets.find((b) => b.site_id === s.id && !b.line_id)?.amount || 0), sum(actualRows, (x) => x.site_id === s.id && (!lineId || x.line_id === lineId)), sum(prevRows, (x) => x.site_id === s.id && (!lineId || x.line_id === lineId)), { site_id: s.id, city: s.city }));
  const total = mk('Network', byLine.reduce((a, x) => a + x.budget, 0), sum(actualRows, (x) => (!siteId || x.site_id === siteId) && (!lineId || x.line_id === lineId)), sum(prevRows, (x) => (!siteId || x.site_id === siteId) && (!lineId || x.line_id === lineId)));
  const focus = siteId ? bySite.find((x) => x.site_id === siteId) : lineId ? byLine.find((x) => x.line_id === lineId) : total;
  const { signals, days, market } = await collectSignals({ year, month, siteId, lineId });
  // Mese in corso: budget pro rata sui giorni lavorati
  const ratio = days.in_progress && days.planned ? Math.min(1, (days.actual || 0) / days.planned) : 1;
  const prorata = (x) => { const b = Math.round(x.budget * ratio); return { ...x, budget_prorata: b, variance_prorata: x.actual - b, variance_prorata_pct: b ? Math.round(((x.actual - b) / b) * 1000) / 10 : null }; };
  const out = { total: prorata(total), byLine: byLine.map(prorata), bySite: bySite.map(prorata), focus: focus ? prorata(focus) : null, prorata_ratio: ratio };
  const notes = await many('SELECT n.*, u.full_name AS author FROM variance_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.year=$1 AND n.month=$2 AND coalesce(n.site_id,0)=$3 AND coalesce(n.line_id,0)=$4 ORDER BY n.created_at DESC', [year, month, siteId || 0, lineId || 0]);
  let text = null;
  if (withAi && out.focus) text = await narrative({ year, month, label: out.focus.label, budget: out.focus.budget_prorata, actual: out.focus.actual, variancePct: out.focus.variance_prorata_pct, signals, notes }).catch(() => null);
  res.json({ year, month, site_id: siteId, line_id: lineId, ...out, signals, days, market: market.map((m) => ({ ...m, metric_label: METRIC_LABEL[m.metric] || m.metric })), notes, narrative: text, ai_enabled: Boolean(config.anthropicKey) });
}));

r.post('/variance/notes', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ year: z.number().int(), month: z.number().int(), site_id: z.number().int().nullable().optional(), line_id: z.number().int().nullable().optional(), kind: z.enum(['INTERNA', 'ESTERNA', 'AZIONE']).default('INTERNA'), note: z.string().min(3) }), req.body);
  const row = await one('INSERT INTO variance_notes(year, month, site_id, line_id, kind, note, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [d.year, d.month, d.site_id || null, d.line_id || null, d.kind, d.note, req.user.id]);
  await audit(req, 'VARIANCE_NOTE', 'variance_note', row.id, d);
  res.status(201).json(row);
}));
r.delete('/variance/notes/:id', requireWrite, ah(async (req, res) => { await q('DELETE FROM variance_notes WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

// ---------------- Dati di mercato ----------------
r.get('/market', ah(async (req, res) => {
  const rows = await many('SELECT * FROM market_data ORDER BY territory_kind, territory, ateco NULLS FIRST, metric, year DESC');
  res.json({ rows: rows.map((x) => ({ ...x, metric_label: METRIC_LABEL[x.metric] || x.metric })), metrics: METRIC_LABEL });
}));
r.post('/market', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ year: z.number().int(), territory_kind: z.enum(['COMUNE', 'PROVINCIA', 'REGIONE', 'ITALIA']), territory: z.string().min(2), province: z.string().nullable().optional(), ateco: z.string().nullable().optional(), metric: z.string().min(2), value: z.number(), source: z.string().nullable().optional() }), req.body);
  await q('INSERT INTO market_data(year, territory_kind, territory, province, ateco, metric, value, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (year, territory_kind, lower(territory), coalesce(ateco, \'\'), metric) DO UPDATE SET value=EXCLUDED.value, source=EXCLUDED.source, province=EXCLUDED.province, updated_at=now()', [d.year, d.territory_kind, d.territory, d.province || null, d.ateco || null, d.metric, d.value, d.source || null]);
  res.json({ ok: true });
}));
r.delete('/market/:id', requireWrite, ah(async (req, res) => { await q('DELETE FROM market_data WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));
r.get('/market/template.xlsx', ah(async (_req, res) => {
  const buf = await toXlsx([{ name: 'Dati di mercato', columns: [{ header: 'Anno', key: 'year' }, { header: 'Tipo territorio (COMUNE, PROVINCIA, REGIONE, ITALIA)', key: 'territory_kind', width: 24 }, { header: 'Territorio', key: 'territory', width: 24 }, { header: 'Provincia', key: 'province' }, { header: 'ATECO (vuoto = generale)', key: 'ateco', width: 18 }, { header: 'Indicatore', key: 'metric', width: 26 }, { header: 'Valore', key: 'value' }, { header: 'Fonte', key: 'source', width: 36 }],
    rows: [{ year: 2024, territory_kind: 'COMUNE', territory: 'Prato', province: 'PO', ateco: '', metric: 'popolazione', value: 198000, source: 'ISTAT' }, { year: 2024, territory_kind: 'COMUNE', territory: 'Prato', province: 'PO', ateco: 'C', metric: 'imprese_attive', value: 8500, source: 'Camera di Commercio' }, { year: 2024, territory_kind: 'COMUNE', territory: 'Prato', province: 'PO', ateco: 'C', metric: 'var_addetti_pct', value: -2.1, source: 'ISTAT ASIA' }] },
  { name: 'Indicatori', columns: [{ header: 'Codice', key: 'k', width: 30 }, { header: 'Descrizione', key: 'v', width: 50 }], rows: Object.entries(METRIC_LABEL).map(([k, v]) => ({ k, v })) }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="dati_mercato_format.xlsx"');
  res.send(buf);
}));
r.post('/market/import', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const { headers, rows } = await parseFile(req.file.buffer, req.file.originalname);
  const find = (names) => headers.find((h) => names.some((n) => h.toLowerCase().includes(n)));
  const H = { year: find(['anno', 'year']), kind: find(['tipo', 'kind']), territory: find(['territorio', 'comune', 'territory']), province: find(['provincia', 'prov']), ateco: find(['ateco']), metric: find(['indicatore', 'metric']), value: find(['valore', 'value']), source: find(['fonte', 'source']) };
  if (!H.year || !H.territory || !H.metric || !H.value) throw bad('Servono le colonne Anno, Territorio, Indicatore, Valore (usa il format)');
  let ok = 0; const errors = [];
  for (const [i, row] of rows.entries()) {
    const year = toNum(row[H.year]); const value = toNum(row[H.value]); const territory = String(row[H.territory] ?? '').trim(); const metric = String(row[H.metric] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const kind = String(row[H.kind] ?? 'COMUNE').trim().toUpperCase();
    if (!year || value == null || !territory || !metric) { errors.push(`Riga ${i + 2}: dati incompleti`); continue; }
    if (!['COMUNE', 'PROVINCIA', 'REGIONE', 'ITALIA'].includes(kind)) { errors.push(`Riga ${i + 2}: tipo territorio "${kind}" non valido`); continue; }
    await q('INSERT INTO market_data(year, territory_kind, territory, province, ateco, metric, value, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (year, territory_kind, lower(territory), coalesce(ateco, \'\'), metric) DO UPDATE SET value=EXCLUDED.value, source=EXCLUDED.source, province=coalesce(EXCLUDED.province, market_data.province), updated_at=now()', [year, kind, territory, H.province ? String(row[H.province] ?? '').trim().toUpperCase().slice(0, 2) || null : null, H.ateco ? String(row[H.ateco] ?? '').trim() || null : null, metric, value, H.source ? String(row[H.source] ?? '').trim() || null : null]);
    ok++;
  }
  await audit(req, 'MARKET_IMPORT', 'market_data', null, { ok, errors: errors.length });
  res.json({ ok: true, saved: ok, errors });
}));

export default r;
