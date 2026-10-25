import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireWrite, requireRole } from '../lib/access.js';
import { config } from '../config.js';
import { getSettings, decompose, decomposeDirigente, minimumFor, costCoefficient, companyCost, netEstimate } from '../lib/payroll.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

r.get('/', ah(async (_req, res) => {
  const levels = await many('SELECT * FROM ccnl_levels ORDER BY sort_order');
  const mins = await many('SELECT * FROM ccnl_minimums ORDER BY valid_from');
  const sections = await many('SELECT * FROM ccnl_sections ORDER BY sort_order');
  const documents = await many("SELECT d.id, d.title, d.filename, d.mime, d.size, d.uploaded_at, u.full_name AS uploaded_by_name FROM ccnl_documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.scope='CCNL' ORDER BY d.uploaded_at DESC");
  const dates = [...new Set(mins.map((m) => m.valid_from))].sort();
  const table = levels.map((l) => ({ ...l, minimums: Object.fromEntries(mins.filter((m) => m.level_id === l.id).map((m) => [m.valid_from, { amount: m.amount, enac: m.enac }])) }));
  const S = await getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const current = dates.filter((d) => d <= today).pop();
  // Tabella RAL: minimo mensile x 14, per livello, alla data vigente
  const ral = table.map((l) => { const m = l.minimums[current]?.amount || 0; return { level: l.level, description: l.description, monthly: m, ral_14: Math.round(m * 14 * 100) / 100, cost_annual: companyCost(m * 14, costCoefficient(S)).annual }; });
  res.json({ levels: table, dates, current_from: current, ral, sections, documents, cost_coefficient: costCoefficient(S) });
}));

r.put('/sections/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ title: z.string().min(2).max(200), body: z.string().min(2).max(20000) }), req.body);
  await q('UPDATE ccnl_sections SET title=$2, body=$3, updated_at=now() WHERE id=$1', [Number(req.params.id), d.title, d.body]);
  await audit(req, 'CCNL_SECTION_UPDATE', 'ccnl_section', req.params.id);
  res.json({ ok: true });
}));
r.post('/sections', requireRole('ADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ title: z.string().min(2).max(200), body: z.string().min(2).max(20000) }), req.body);
  const row = await one('INSERT INTO ccnl_sections(title, body, sort_order) VALUES ($1,$2,(SELECT coalesce(max(sort_order),0)+10 FROM ccnl_sections)) RETURNING id', [d.title, d.body]);
  res.status(201).json(row);
}));
r.delete('/sections/:id', requireRole('ADMIN'), ah(async (req, res) => { await q('DELETE FROM ccnl_sections WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

r.put('/minimums', requireRole('ADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ level: z.string(), valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number().positive(), enac: z.number().nullable().optional() }), req.body);
  const l = await one('SELECT id FROM ccnl_levels WHERE upper(level)=upper($1)', [d.level]);
  if (!l) throw notFound('Livello non trovato');
  await q('INSERT INTO ccnl_minimums(level_id, valid_from, amount, enac) VALUES ($1,$2,$3,$4) ON CONFLICT (level_id, valid_from) DO UPDATE SET amount=EXCLUDED.amount, enac=EXCLUDED.enac', [l.id, d.valid_from, d.amount, d.enac ?? null]);
  await audit(req, 'CCNL_MINIMUM_UPDATE', 'ccnl_level', l.id, d);
  res.json({ ok: true });
}));

r.post('/documents', requireRole('ADMIN'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const title = String(req.body.title || req.file.originalname).slice(0, 200);
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const row = await one('INSERT INTO ccnl_documents(title, filename, mime, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [title, filename, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]);
  await audit(req, 'CCNL_DOCUMENT_UPLOAD', 'ccnl_document', row.id, { title });
  res.status(201).json(row);
}));
r.get('/documents/:id/download', ah(async (req, res) => {
  const d = await one('SELECT filename, mime, data FROM ccnl_documents WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound();
  res.set('Content-Type', d.mime).set('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.filename)}`).send(d.data);
}));
r.delete('/documents/:id', requireRole('ADMIN'), ah(async (req, res) => { await q('DELETE FROM ccnl_documents WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

// Simulatore busta paga (come l'Elaboratore Buste Paga + stima costo azienda e netto)
r.post('/simulate', ah(async (req, res) => {
  const d = parse(z.object({
    ral: z.number().min(0).optional().nullable(),
    level: z.string().optional().nullable(),
    monthly_payments: z.number().int().min(12).max(15).default(14),
    at_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    contract_type: z.enum(['TIND', 'TDET', 'APPRENDISTATO', 'DIRIGENTE']).default('TIND'),
    mbo_pct: z.number().min(0).max(100).optional().nullable(),
    weekly_hours: z.number().min(1).max(48).default(40),
  }), req.body);
  const S = await getSettings();
  const m = await minimumFor(d.level, d.at_date);
  let ral = d.ral;
  if (!ral && m) ral = Math.round(Number(m.amount) * d.monthly_payments * 100) / 100; // RAL minima = minimo x mensilità
  const ptFactor = Math.min(1, d.weekly_hours / 40);
  const dec = d.contract_type === 'DIRIGENTE' ? decomposeDirigente(ral || Number(S.dirigenti_minimum || 85000), S, d.monthly_payments) : decompose(ral, d.monthly_payments, m ? Number(m.amount) * ptFactor : null, Number(S.function_allowance_share || 0.7));
  if (d.contract_type === 'DIRIGENTE' && !ral) ral = dec.ral;
  const coef = costCoefficient(S, { contract_type: d.contract_type });
  const cost = companyCost(ral, coef, d.mbo_pct || 0);
  const net = netEstimate(ral, S, d.monthly_payments);
  res.json({ minimum: m, decomposition: dec, cost: { coefficient: coef, ...cost }, net, assumptions: { cost_inps_pct: S.cost_inps_pct, cost_inail_pct: S.cost_inail_pct, cost_tfr_pct: S.cost_tfr_pct, employee_inps_pct: S.employee_inps_pct } });
}));

export default r;
