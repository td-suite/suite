import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireWrite, Params } from '../lib/access.js';
import { config } from '../config.js';
import { DATASETS, parseFile, autoMap, runImport, savedMapping } from '../lib/importer.js';
import { toXlsx } from '../lib/exports.js';
import { refreshCustomerStats } from '../lib/customers.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

function filters(query) {
  const p = new Params(); const w = ['1=1'];
  if (query.from) w.push(`s.sale_date >= ${p.add(query.from)}`);
  if (query.to) w.push(`s.sale_date <= ${p.add(query.to)}`);
  if (query.site_id) w.push(`s.site_id=${p.add(Number(query.site_id))}`);
  if (query.product_id) w.push(`s.product_id=${p.add(Number(query.product_id))}`);
  if (query.line_id) w.push(`p.line_id=${p.add(Number(query.line_id))}`);
  if (query.kind === 'B2B') w.push('s.b2b_customer_id IS NOT NULL'); else if (query.kind === 'B2C') w.push('s.customer_id IS NOT NULL');
  if (query.payment_kind) w.push(`s.payment_kind=${p.add(query.payment_kind)}`);
  if (query.channel) w.push(`s.booking_channel=${p.add(query.channel)}`);
  if (query.source) w.push(`s.source=${p.add(query.source)}`);
  if (query.campaign_id) w.push(`s.campaign_id=${p.add(Number(query.campaign_id))}`);
  if (query.promotion_id) w.push(`s.promotion_id=${p.add(Number(query.promotion_id))}`);
  if (query.operator) w.push(`s.operator=${p.add(query.operator)}`);
  if (query.batch_id) w.push(`s.import_batch_id=${p.add(Number(query.batch_id))}`);
  if (query.q) { const t = p.add(`%${query.q}%`); w.push(`(s.external_ref ILIKE ${t} OR c.last_name ILIKE ${t} OR c.company_name ILIKE ${t} OR b.company_name ILIKE ${t} OR p.description ILIKE ${t} OR s.product_desc ILIKE ${t})`); }
  return { where: w.join(' AND '), params: p.values };
}
const FROM = `FROM sales s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN product_lines pl ON pl.id=p.line_id LEFT JOIN sites_v st ON st.id=s.site_id LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN customers b ON b.id=s.b2b_customer_id LEFT JOIN campaigns cp ON cp.id=s.campaign_id LEFT JOIN promotions pr ON pr.id=s.promotion_id`;
const SELECT = `SELECT s.*, coalesce(p.description, s.product_desc) AS product_description, pl.name AS line_name, pl.code AS line_code, st.name AS site_name, c.last_name, c.first_name, b.company_name, cp.name AS campaign_name, pr.name AS promotion_name`;

r.get('/', ah(async (req, res) => {
  const { where, params } = filters(req.query);
  const limit = Math.min(500, Number(req.query.limit || 200)); const offset = Math.max(0, Number(req.query.offset || 0));
  const rows = await many(`${SELECT} ${FROM} WHERE ${where} ORDER BY s.sale_date DESC, s.sale_time DESC NULLS LAST, s.external_ref, s.line_no LIMIT ${limit} OFFSET ${offset}`, params);
  const tot = await one(`SELECT count(*)::int AS n, count(DISTINCT s.external_ref)::int AS tickets, coalesce(sum(s.net_amount),0) AS revenue, coalesce(sum(s.gross_amount),0) AS gross, coalesce(sum(s.discount),0) AS discount ${FROM} WHERE ${where}`, params);
  res.json({ rows, ...tot, limit, offset });
}));

r.get('/export.xlsx', ah(async (req, res) => {
  const { where, params } = filters(req.query);
  const rows = await many(`${SELECT} ${FROM} WHERE ${where} ORDER BY s.sale_date DESC, s.external_ref, s.line_no LIMIT 50000`, params);
  const buf = await toXlsx([{ name: 'Vendite', columns: [{ header: 'Data', key: 'sale_date', date: true }, { header: 'Ora', key: 'sale_time' }, { header: 'Accettazione', key: 'external_ref' }, { header: 'Riga', key: 'line_no', int: true }, { header: 'Sede', key: 'site_name', width: 30 }, { header: 'Cliente', key: 'customer', width: 28 }, { header: 'Azienda (B2B)', key: 'company_name', width: 28 }, { header: 'Codice', key: 'product_code' }, { header: 'Prestazione', key: 'product_description', width: 40 }, { header: 'Linea', key: 'line_name', width: 24 }, { header: 'Q.tà', key: 'quantity', int: true }, { header: 'Lordo', key: 'gross_amount', money: true }, { header: 'Sconto', key: 'discount', money: true }, { header: 'Netto', key: 'net_amount', money: true }, { header: 'Regime', key: 'payment_kind' }, { header: 'Canale', key: 'booking_channel' }, { header: 'Promo', key: 'promo_code' }, { header: 'Campagna', key: 'campaign_name', width: 28 }, { header: 'Operatore', key: 'operator' }, { header: 'Origine', key: 'source' }],
    rows: rows.map((x) => ({ ...x, customer: x.last_name ? `${x.last_name} ${x.first_name || ''}` : '' })), totals: { net_amount: rows.reduce((a, x) => a + Number(x.net_amount), 0), gross_amount: rows.reduce((a, x) => a + Number(x.gross_amount), 0), discount: rows.reduce((a, x) => a + Number(x.discount), 0) } }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vendite_${req.query.from || 'inizio'}_${req.query.to || 'oggi'}.xlsx"`);
  res.send(buf);
}));

// Inserimento manuale (accettazione con più righe)
const manualSchema = z.object({
  sale_date: z.string(), sale_time: z.string().nullable().optional(), site_id: z.number().int(), customer_id: z.number().int().nullable().optional(), b2b_customer_id: z.number().int().nullable().optional(),
  payment_kind: z.string().nullable().optional(), booking_channel: z.string().nullable().optional(), referrer: z.string().nullable().optional(), promo_code: z.string().nullable().optional(), external_ref: z.string().nullable().optional(), operator: z.string().nullable().optional(),
  lines: z.array(z.object({ product_id: z.number().int(), quantity: z.number().int().min(1).default(1), gross_amount: z.number(), discount: z.number().default(0) })).min(1),
});
r.post('/', requireWrite, ah(async (req, res) => {
  const d = parse(manualSchema, req.body);
  if (!d.customer_id && !d.b2b_customer_id) throw bad('Indica il cliente (paziente o azienda)');
  const ref = d.external_ref || `M${Date.now().toString(36).toUpperCase()}`;
  const promo = d.promo_code ? d.promo_code.toUpperCase() : null;
  const camp = promo ? await one('SELECT id FROM campaigns WHERE upper(promo_code)=$1', [promo]) : null;
  const prom = promo ? await one('SELECT id FROM promotions WHERE upper(promo_code)=$1', [promo]) : null;
  for (const [i, l] of d.lines.entries()) {
    const pr = await one('SELECT code FROM products WHERE id=$1', [l.product_id]);
    await q(`INSERT INTO sales(source, external_ref, line_no, sale_date, sale_time, customer_id, b2b_customer_id, site_id, product_id, product_code, quantity, gross_amount, discount, net_amount, payment_kind, booking_channel, referrer, promo_code, campaign_id, promotion_id, operator)
      VALUES ('MANUALE',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [ref, i + 1, d.sale_date, d.sale_time || null, d.customer_id || null, d.b2b_customer_id || null, d.site_id, l.product_id, pr?.code || null, l.quantity, l.gross_amount, l.discount, Math.round((l.gross_amount - l.discount) * 100) / 100, d.payment_kind || (d.b2b_customer_id ? 'AZIENDA' : 'PRIVATO'), d.booking_channel || null, d.referrer || null, promo, camp?.id || null, prom?.id || null, d.operator || req.user.full_name]);
  }
  await refreshCustomerStats([d.customer_id, d.b2b_customer_id].filter(Boolean));
  await audit(req, 'SALE_CREATE', 'sale', ref, { lines: d.lines.length });
  res.status(201).json({ ok: true, external_ref: ref });
}));

r.delete('/ref/:source/:ref', requireWrite, ah(async (req, res) => {
  const ids = await many('SELECT DISTINCT customer_id, b2b_customer_id FROM sales WHERE source=$1 AND external_ref=$2', [req.params.source, req.params.ref]);
  await q('DELETE FROM sales WHERE source=$1 AND external_ref=$2', [req.params.source, req.params.ref]);
  await refreshCustomerStats(ids.flatMap((x) => [x.customer_id, x.b2b_customer_id]).filter(Boolean));
  await audit(req, 'SALE_DELETE', 'sale', req.params.ref, { source: req.params.source });
  res.json({ ok: true });
}));

// ---------------- Import da file ----------------
r.get('/import/datasets', ah(async (_req, res) => res.json(Object.fromEntries(Object.entries(DATASETS).map(([k, v]) => [k, { label: v.label, fields: v.fields.map(([key, label, required]) => ({ key, label, required })) }])))));

// Anteprima: intestazioni, prime righe e mappatura proposta (automatica o salvata)
r.post('/import/preview', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const { source, dataset } = parse(z.object({ source: z.enum(['GIPO', 'TUOTEMPO', 'STUDIOLAB', 'IMPORT']), dataset: z.enum(['SALES', 'CUSTOMERS', 'PRODUCTS', 'CATALOG_STUDIOLAB', 'COSTS']) }), req.body);
  const def = DATASETS[dataset];
  const { headers, rows, sheets } = await parseFile(req.file.buffer, req.file.originalname, { multiSheet: Boolean(def.multiSheet), keyHeader: def.multiSheet ? def.multiSheet : null });
  const saved = await savedMapping(source, dataset);
  const auto = autoMap(dataset, headers);
  const mapping = saved && Object.values(saved).every((h) => headers.includes(h)) ? saved : auto;
  res.json({ headers, sample: rows.slice(0, 8), rows_total: rows.length, mapping, saved: Boolean(saved), sheets: sheets || null, fields: def.fields.map(([key, label, required]) => ({ key, label, required })) });
}));

// Esecuzione (dry_run=1 per la sola validazione)
r.post('/import/run', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const { source, dataset, mapping, dry_run } = parse(z.object({ source: z.enum(['GIPO', 'TUOTEMPO', 'STUDIOLAB', 'IMPORT']), dataset: z.enum(['SALES', 'CUSTOMERS', 'PRODUCTS', 'CATALOG_STUDIOLAB', 'COSTS']), mapping: z.string().optional(), dry_run: z.string().optional(), default_site_code: z.string().optional() }), req.body);
  const map = mapping ? JSON.parse(mapping) : null;
  const out = await runImport({ source, dataset, buffer: req.file.buffer, filename: req.file.originalname, mapping: map, userId: req.user.id, dryRun: dry_run === '1', defaultSiteCode: req.body.default_site_code || null });
  if (dry_run !== '1') await audit(req, 'IMPORT_RUN', 'import', out.batch_id, { source, dataset, rows_ok: out.rows_ok, rows_skipped: out.rows_skipped });
  res.json(out);
}));

r.get('/import/batches', ah(async (_req, res) => res.json(await many('SELECT b.*, u.full_name AS user_name FROM import_batches b LEFT JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC LIMIT 100'))));

r.delete('/import/batches/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const ids = await many('SELECT DISTINCT customer_id, b2b_customer_id FROM sales WHERE import_batch_id=$1', [id]);
  const n = (await q('DELETE FROM sales WHERE import_batch_id=$1', [id])).rowCount;
  await q('DELETE FROM import_batches WHERE id=$1', [id]);
  await refreshCustomerStats(ids.flatMap((x) => [x.customer_id, x.b2b_customer_id]).filter(Boolean));
  await audit(req, 'IMPORT_UNDO', 'import', id, { deleted: n });
  res.json({ ok: true, deleted: n });
}));

// Format Excel scaricabile per i tre dataset
r.get('/import/template.xlsx', ah(async (req, res) => {
  const dataset = DATASETS[req.query.dataset] ? req.query.dataset : 'SALES';
  const def = DATASETS[dataset];
  const example = { SALES: { external_ref: 'A123456', line_no: 1, sale_date: '14/10/2026', sale_time: '08:30', customer_external_id: 'P000123', customer_tax_code: 'RSSMRA80A01D612X', customer_last_name: 'Rossi', customer_first_name: 'Maria', customer_sex: 'F', customer_birth_date: '01/01/1980', customer_city: 'Firenze', customer_province: 'FI', customer_zip: '50100', customer_email: 'maria.rossi@example.org', customer_phone: '3331234567', b2b_company: '', b2b_vat: '', site_code: 'FI-CEC', product_code: '0014', product_desc: 'Emocromocitometrico completo', quantity: 1, gross_amount: 7, discount: 0, net_amount: 7, payment_kind: 'PRIVATO', booking_channel: 'SPORTELLO', referrer: '', promo_code: '' },
    CUSTOMERS: { external_id: 'P000123', tax_code: 'RSSMRA80A01D612X', last_name: 'Rossi', first_name: 'Maria', sex: 'F', birth_date: '01/01/1980', email: 'maria.rossi@example.org', phone: '3331234567', address: 'Via Roma 1', zip: '50100', city: 'Firenze', province: 'FI', marketing_consent: 'SI', acquisition_channel: 'WEB', company_name: '', vat_number: '', sector: '', contact_name: '', employees: '' },
    PRODUCTS: { code: 'ECO012', description: 'Ecografia pelvica transvaginale', specialty: 'Ecografia', line_code: 'IMG', price: 70, price_ssn: 48.5, cost: 14, duration_min: 20, nomenclature: '2D53', periodicity_months: 12 },
    CATALOG_STUDIOLAB: { code: '0014', description: 'Emocromocitometrico completo', description_short: 'Emocromo', sector: 'ANALISI', sector_clinical: 'EMATOLOGIA E COAGULAZIONE', destination: 'Ematologia', nomenclature: '90.62.2', price_ssn: 0, price: 7, price_mdl: 4.15, price_service: 3.8, cost_service: 0.467, is_vet: 'False', days: 1, non_usato: 'False' },
    COSTS: { code: '0014', cost: 0.467, cost_unit: 0.467, cost_service: 0, description: 'Emocromocitometrico completo', sector_clinical: 'EMATOLOGIA E COAGULAZIONE', destination: 'Ematologia', in_use: 'Sì', price_b2b: '', price_b2c: '' } }[dataset];
  const buf = await toXlsx([{ name: def.label, columns: def.fields.map(([key, label, required]) => ({ header: `${label}${required ? ' *' : ''}`, key, width: Math.max(14, label.length + 2) })), rows: [example] },
    { name: 'Istruzioni', columns: [{ header: 'Istruzioni', key: 'a', width: 120 }], rows: ['Le colonne con asterisco sono obbligatorie. Le altre, se presenti, arricchiscono le anagrafiche.', 'Date in formato gg/mm/aaaa o aaaa-mm-gg. Importi con virgola o punto decimale.', 'La sede si riconosce dal codice (es. FI-CEC) o dal nome della sede configurata in Retail.', 'Per le vendite B2B (StudioLab) compila Azienda/struttura committente e lascia vuoti i dati del paziente.', 'Il numero di accettazione identifica la riga: ricaricando lo stesso file le righe vengono aggiornate, non duplicate.', 'I nomi delle colonne possono essere diversi: alla prima importazione si mappano le colonne e la mappatura resta salvata per la sorgente.'].map((a) => ({ a })) }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="format_${dataset.toLowerCase()}.xlsx"`);
  res.send(buf);
}));

export default r;
