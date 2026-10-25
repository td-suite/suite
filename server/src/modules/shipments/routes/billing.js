// Rendicontazione economica mensile del progetto Endeavor DNA: spedizioni (per modalità) e campioni inviati al laboratorio
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, badL, notFound, audit, parse, r2, getSetting } from '../lib/util.js';
import { requireRole, OPERATORS } from '../lib/access.js';
import { statementPdf } from '../pdf/statement.js';

const r = Router();
const MONTH = z.string().regex(/^\d{4}-\d{2}$/);

// Righe del mese: spedizioni e campioni con data competenza nel mese (periodo aperto: dinamico; chiuso: congelato dal collegamento).
// Nel ramo congelato $2 (mese) va comunque referenziato: PostgreSQL rifiuta i parametri di tipo indeterminato (correzione rispetto all'app di origine).
async function monthLines(project, month, period) {
  const frozen = period && period.status !== 'OPEN';
  const ship = await many(`SELECT o.id, o.external_ref, o.patient_last_name, o.patient_first_name, o.city, k.barcode, o.fee_shipping AS amount, o.fee_shipping_date AS date, m.code AS mode_code, m.name_it AS mode_it, m.name_en AS mode_en, 'SHIPPING' AS kind
    FROM orders o LEFT JOIN kits k ON k.id=o.kit_id LEFT JOIN shipping_modes m ON m.id=o.shipping_mode_id
    WHERE o.project=$1 AND o.fee_shipping IS NOT NULL AND ${frozen ? 'o.ship_billing_period_id=$3 AND $2::text IS NOT NULL' : `to_char(o.fee_shipping_date,'YYYY-MM')=$2 AND o.status<>'CANCELLED' AND (o.ship_billing_period_id IS NULL OR o.ship_billing_period_id=$3)`}
    ORDER BY o.fee_shipping_date, o.id`, [project, month, period?.id || null]);
  const samples = await many(`SELECT o.id, o.external_ref, o.patient_last_name, o.patient_first_name, o.city, k.barcode, o.fee_sample AS amount, o.fee_sample_date AS date, ls.awb_number, 'SAMPLE' AS kind
    FROM orders o LEFT JOIN kits k ON k.id=o.kit_id LEFT JOIN lab_shipments ls ON ls.id=o.lab_shipment_id
    WHERE o.project=$1 AND o.fee_sample IS NOT NULL AND ${frozen ? 'o.sample_billing_period_id=$3 AND $2::text IS NOT NULL' : `to_char(o.fee_sample_date,'YYYY-MM')=$2 AND (o.sample_billing_period_id IS NULL OR o.sample_billing_period_id=$3)`}
    ORDER BY o.fee_sample_date, o.id`, [project, month, period?.id || null]);
  const byMode = {};
  for (const s of ship) { const k = s.mode_code || '-'; byMode[k] = byMode[k] || { code: k, name_it: s.mode_it, name_en: s.mode_en, n: 0, amount: 0, unit: Number(s.amount) }; byMode[k].n++; byMode[k].amount = r2(byMode[k].amount + Number(s.amount)); }
  const totalShipping = r2(ship.reduce((a, x) => a + Number(x.amount), 0));
  const totalSamples = r2(samples.reduce((a, x) => a + Number(x.amount), 0));
  return { ship, samples, byMode: Object.values(byMode), totalShipping, totalSamples, total: r2(totalShipping + totalSamples), sampleUnit: Number(await getSetting('sample_fee', '3.50')) };
}

async function getPeriod(project, month) { return one('SELECT p.*, u.full_name AS closed_by_name FROM billing_periods p LEFT JOIN users u ON u.id=p.closed_by WHERE project=$1 AND month=$2', [project, month]); }

// Elenco mesi con totali (ultimi 24 mesi con movimenti più i periodi registrati)
r.get('/', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const months = await many(`SELECT month FROM (
      SELECT to_char(fee_shipping_date,'YYYY-MM') AS month FROM orders WHERE project=$1 AND fee_shipping_date IS NOT NULL AND status<>'CANCELLED'
      UNION SELECT to_char(fee_sample_date,'YYYY-MM') FROM orders WHERE project=$1 AND fee_sample_date IS NOT NULL
      UNION SELECT month FROM billing_periods WHERE project=$1
      UNION SELECT to_char(CURRENT_DATE,'YYYY-MM')) x WHERE month IS NOT NULL ORDER BY month DESC LIMIT 24`, [project]);
  const out = [];
  for (const { month } of months) {
    const period = await getPeriod(project, month);
    const l = await monthLines(project, month, period);
    out.push({ month, status: period?.status || 'OPEN', period, shipments: l.ship.length, samples: l.samples.length, totalShipping: l.totalShipping, totalSamples: l.totalSamples, total: l.total });
  }
  res.json(out);
}));

r.get('/:month', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const period = await getPeriod(project, month);
  res.json({ project, month, period, ...(await monthLines(project, month, period)) });
}));

// Chiusura del mese: congela le righe collegandole al periodo
r.post('/:month/close', requireRole(...OPERATORS), ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const cur = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7);
  if (month >= cur) throw badL(req, 'Il mese si chiude solo quando è concluso', 'The month can be closed only after it has ended');
  const out = await tx(async (c) => {
    let p = (await c.query('SELECT * FROM billing_periods WHERE project=$1 AND month=$2 FOR UPDATE', [project, month])).rows[0];
    if (p && p.status !== 'OPEN') throw badL(req, 'Periodo già chiuso', 'Period already closed');
    if (!p) p = (await c.query('INSERT INTO billing_periods (project, month) VALUES ($1,$2) RETURNING *', [project, month])).rows[0];
    await c.query(`UPDATE orders SET ship_billing_period_id=$3 WHERE project=$1 AND status<>'CANCELLED' AND fee_shipping IS NOT NULL AND to_char(fee_shipping_date,'YYYY-MM')=$2 AND ship_billing_period_id IS NULL`, [project, month, p.id]);
    await c.query(`UPDATE orders SET sample_billing_period_id=$3 WHERE project=$1 AND fee_sample IS NOT NULL AND to_char(fee_sample_date,'YYYY-MM')=$2 AND sample_billing_period_id IS NULL`, [project, month, p.id]);
    const l = await monthLines(project, month, { ...p, status: 'CLOSED' });
    await c.query(`UPDATE billing_periods SET status='CLOSED', closed_at=now(), closed_by=$2, total_shipping=$3, total_samples=$4, totals=$5 WHERE id=$1`, [p.id, req.user.id, l.totalShipping, l.totalSamples, JSON.stringify({ byMode: l.byMode, shipments: l.ship.length, samples: l.samples.length })]);
    return p;
  });
  await audit(req, 'BILLING_CLOSE', 'billing', out.id, { project, month });
  res.json(await getPeriod(project, month));
}));

r.post('/:month/reopen', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const p = await getPeriod(project, month);
  if (!p || p.status === 'OPEN') throw notFound();
  if (p.status === 'INVOICED') throw badL(req, 'Periodo già fatturato: togli prima il riferimento fattura', 'Period already invoiced: remove the invoice reference first');
  await tx(async (c) => {
    await c.query('UPDATE orders SET ship_billing_period_id=NULL WHERE ship_billing_period_id=$1', [p.id]);
    await c.query('UPDATE orders SET sample_billing_period_id=NULL WHERE sample_billing_period_id=$1', [p.id]);
    await c.query(`UPDATE billing_periods SET status='OPEN', closed_at=NULL, closed_by=NULL, total_shipping=NULL, total_samples=NULL, totals=NULL WHERE id=$1`, [p.id]);
  });
  await audit(req, 'BILLING_REOPEN', 'billing', p.id, { project, month });
  res.json(await getPeriod(project, month));
}));

r.post('/:month/invoice', requireRole(...OPERATORS), ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const d = parse(z.object({ invoice_ref: z.string().trim().max(60).nullable(), invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), notes: z.string().max(500).nullable().optional() }), req.body);
  const p = await getPeriod(project, month);
  if (!p || p.status === 'OPEN') throw badL(req, 'Chiudi prima il mese', 'Close the month first');
  await q(`UPDATE billing_periods SET invoice_ref=$2, invoice_date=$3, notes=coalesce($4, notes), status=CASE WHEN $2 IS NULL OR $2='' THEN 'CLOSED' ELSE 'INVOICED' END WHERE id=$1`, [p.id, d.invoice_ref || null, d.invoice_date || null, d.notes ?? null]);
  await audit(req, 'BILLING_INVOICE', 'billing', p.id, d);
  res.json(await getPeriod(project, month));
}));

// Export Excel del rendiconto mensile
r.get('/:month/export.xlsx', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const en = req.lang === 'en';
  const period = await getPeriod(project, month);
  const l = await monthLines(project, month, period);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Toscana Diagnostica · Shipments';
  const head = (ws, cols) => { ws.columns = cols; ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0F2' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const s1 = wb.addWorksheet(en ? 'Summary' : 'Riepilogo');
  head(s1, [{ header: en ? 'Item' : 'Voce', key: 'k', width: 46 }, { header: en ? 'Quantity' : 'Quantità', key: 'n', width: 12 }, { header: en ? 'Unit price €' : 'Prezzo unitario €', key: 'u', width: 16 }, { header: en ? 'Amount €' : 'Importo €', key: 'a', width: 14 }]);
  for (const m of l.byMode) s1.addRow({ k: en ? m.name_en : m.name_it, n: m.n, u: m.unit, a: m.amount });
  s1.addRow({ k: en ? 'Samples shipped to Endeavor DNA (FedEx)' : 'Campioni spediti a Endeavor DNA (FedEx)', n: l.samples.length, u: l.sampleUnit, a: l.totalSamples });
  const tot = s1.addRow({ k: en ? 'TOTAL' : 'TOTALE', n: '', u: '', a: l.total }); tot.font = { bold: true };
  s1.getColumn('u').numFmt = '#,##0.00'; s1.getColumn('a').numFmt = '#,##0.00';
  const s2 = wb.addWorksheet(en ? 'Shipments' : 'Spedizioni');
  head(s2, [{ header: en ? 'Date' : 'Data', key: 'date', width: 12 }, { header: en ? 'Reference' : 'Riferimento', key: 'ref', width: 16 }, { header: 'Kit', key: 'kit', width: 18 }, { header: en ? 'Patient' : 'Paziente', key: 'pat', width: 28 }, { header: en ? 'City' : 'Città', key: 'city', width: 18 }, { header: en ? 'Mode' : 'Modalità', key: 'mode', width: 36 }, { header: '€', key: 'a', width: 10 }]);
  for (const s of l.ship) s2.addRow({ date: s.date, ref: s.external_ref, kit: s.barcode, pat: `${s.patient_last_name} ${s.patient_first_name}`, city: s.city, mode: en ? s.mode_en : s.mode_it, a: Number(s.amount) });
  s2.getColumn('a').numFmt = '#,##0.00';
  const s3 = wb.addWorksheet(en ? 'Samples' : 'Campioni');
  head(s3, [{ header: en ? 'Date' : 'Data', key: 'date', width: 12 }, { header: en ? 'Reference' : 'Riferimento', key: 'ref', width: 16 }, { header: 'Kit', key: 'kit', width: 18 }, { header: en ? 'Patient' : 'Paziente', key: 'pat', width: 28 }, { header: 'FedEx AWB', key: 'awb', width: 18 }, { header: '€', key: 'a', width: 10 }]);
  for (const s of l.samples) s3.addRow({ date: s.date, ref: s.external_ref, kit: s.barcode, pat: `${s.patient_last_name} ${s.patient_first_name}`, awb: s.awb_number, a: Number(s.amount) });
  s3.getColumn('a').numFmt = '#,##0.00';
  const buf = await wb.xlsx.writeBuffer();
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="rendiconto-${project.toLowerCase()}-${month}.xlsx"`).send(Buffer.from(buf));
}));

r.get('/:month/statement.pdf', ah(async (req, res) => {
  const project = req.query.project || 'ENDEAVOR';
  const month = parse(MONTH, req.params.month);
  const period = await getPeriod(project, month);
  const l = await monthLines(project, month, period);
  const settings = Object.fromEntries((await many("SELECT key, value FROM app_settings WHERE key IN ('billing_customer','billing_customer_address')")).map((x) => [x.key, x.value]));
  res.type('application/pdf').set('Content-Disposition', `inline; filename="statement-${project.toLowerCase()}-${month}.pdf"`).send(await statementPdf({ project, month, period, lines: l, settings, lang: req.query.lang || req.lang }));
}));

export default r;
