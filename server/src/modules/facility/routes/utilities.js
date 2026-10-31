// Utenze: la fonte unica dei contratti di utenza e delle bollette è Payments (finance.utilities, finance.utility_bills, stesso database).
// Facility le legge e le scrive lì, così ogni utenza creata qui entra nelle scadenze ricorrenti dello Scadenziario strutture e ogni
// bolletta registrata qui vi compare con la sua scadenza di pagamento. Facility aggiunge l'estensione energetica (utility_meta: vettore,
// POD/PDR, potenza, tariffa, fattore CO2) e le letture dei contatori (meter_readings). Con Payments non avviato la sezione è disattivata.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { VECTORS, VECTOR_TO_KIND, UNIT_DEFAULT, KIND_TO_VECTOR } from '../config.js';
import { ah, audit, bad, parse, forbidden, notFound } from '../../../lib/util.js';
import { buildEvents } from '../../finance/lib/schedule.js';
import { requireFacility, assertSite, canSeeSite, limitedToSites, mySiteIds, isFacility, isSite, isManutentore } from '../lib/access.js';
import { KEY, idOf, siteById, requireFinance, financeLive, FINANCE_OFF, todayRome } from '../lib/core.js';
import { utilityMonthly, addDays } from '../lib/calc.js';

const r = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG');
const optDate = DATE.nullable().optional().or(z.literal('').transform(() => null));
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const optNum = (min, max) => z.coerce.number().min(min).max(max).nullable().optional().or(z.literal('').transform(() => null));
const noMaint = (req, _res, next) => (isManutentore(req) ? next(forbidden('Sezione non disponibile per i manutentori')) : next());

async function utilityRow(id) {
  const u = await one(`SELECT u.*, coalesce(u.supplier_name, o.name) AS supplier_label, m.vector, m.pod_pdr, m.contracted_power_kw, m.tariff, m.co2_factor, m.unit AS meta_unit, m.notes AS meta_notes, s.name AS site_name
    FROM finance.utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN utility_meta m ON m.utility_id=u.id LEFT JOIN public.sites s ON s.id=u.site_id WHERE u.id=$1`, [id]);
  if (!u) throw notFound('Utenza non trovata in Payments');
  u.vector = u.vector || KIND_TO_VECTOR[u.kind] || null;
  u.unit = u.meta_unit || (u.vector ? UNIT_DEFAULT[u.vector] : null);
  return u;
}

// ---- Elenco per sede (con stato della voltura e prossime bollette)
r.get('/utenze', noMaint, ah(async (req, res) => {
  if (!(await financeLive())) return res.json({ finance: false, message: FINANCE_OFF, rows: [] });
  const params = [];
  const w = ['TRUE'];
  if (req.query.site_id) { assertSite(req, Number(req.query.site_id)); params.push(Number(req.query.site_id)); w.push(`u.site_id=$${params.length}`); }
  if (limitedToSites(req)) { params.push(mySiteIds(req)); w.push(`u.site_id = ANY($${params.length}::int[])`); }
  if (req.query.all !== '1') w.push('u.active');
  const rows = await many(`SELECT u.id, u.site_id, s.name AS site_name, s.code AS site_code, u.kind, coalesce(u.supplier_name, o.name) AS supplier_name, u.code, u.holder, u.transfer_status, u.period_months, u.ref_due, u.avg_amount, u.offer_end, u.auto_pay, u.active,
      m.vector, m.pod_pdr, m.contracted_power_kw, m.tariff, (m.utility_id IS NOT NULL) AS has_meta,
      (SELECT count(*)::int FROM finance.utility_bills b WHERE b.utility_id=u.id) AS n_bills,
      (SELECT max(b.due_date) FROM finance.utility_bills b WHERE b.utility_id=u.id) AS last_bill,
      (SELECT count(*)::int FROM finance.utility_bills b WHERE b.utility_id=u.id AND b.paid_at IS NULL) AS unpaid,
      (SELECT count(*)::int FROM meter_readings r WHERE r.utility_id=u.id) AS n_readings
    FROM finance.utilities u JOIN public.sites s ON s.id=u.site_id LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN utility_meta m ON m.utility_id=u.id
    WHERE ${w.join(' AND ')} ORDER BY s.sort_order, s.name, u.kind, u.id`, params);
  // prossima bolletta attesa (stessa logica dello scadenziario di Payments)
  const ids = rows.filter((u) => u.active).map((u) => u.id);
  const bills = ids.length ? await many('SELECT * FROM finance.utility_bills WHERE utility_id = ANY($1::int[])', [ids]) : [];
  const today = todayRome();
  const ev = buildEvents({ utilities: rows.filter((u) => u.active), bills, from: today, to: addDays(today, 365), today }).filter((e) => e.kind === 'bolletta' && !e.done);
  res.json({ finance: true, rows: rows.map((u) => ({ ...u, vector: u.vector || KIND_TO_VECTOR[u.kind] || null, next_bill: ev.find((e) => e.ref === u.id) || null })), can_edit: isFacility(req), can_read_meter: isFacility(req) || isSite(req) });
}));

// ---- Scheda dell'utenza: bollette, letture e consumi mensili
r.get('/utenze/:id', noMaint, ah(async (req, res) => {
  await requireFinance();
  const u = await utilityRow(idOf(req.params.id, 'Utenza non trovata'));
  assertSite(req, u.site_id);
  const bills = await many('SELECT * FROM finance.utility_bills WHERE utility_id=$1 ORDER BY due_date DESC', [u.id]);
  const readings = await many('SELECT r.*, x.full_name AS created_by_name FROM meter_readings r LEFT JOIN users x ON x.id=r.created_by WHERE r.utility_id=$1 ORDER BY read_at DESC', [u.id]);
  const monthly = utilityMonthly(bills, readings);
  res.json({ ...u, bills, readings, monthly: Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })), can_edit: isFacility(req), can_read_meter: isFacility(req) || isSite(req) });
}));

// ---- Creazione e modifica: riga in finance.utilities (Payments) + estensione energetica in facility.utility_meta
const utilSchema = z.object({
  site_id: z.coerce.number().int().positive(),
  vector: z.enum(VECTORS),
  kind: z.enum(['ENERGIA', 'GAS', 'ACQUA', 'TARI', 'TELEFONIA', 'CONDOMINIO', 'VIGILANZA', 'PULIZIE', 'ALTRO']).optional(),   // tipo Payments (vuoto = dal vettore)
  supplier_org_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  supplier_name: optText(200), code: optText(100), holder: optText(200),
  transfer_status: z.enum(['DA_AVVIARE', 'IN_CORSO', 'COMPLETATA', 'NON_NECESSARIA']).default('NON_NECESSARIA'),
  period_months: z.coerce.number().int().refine((v) => [1, 2, 3, 4, 6, 12].includes(v), 'fatturazione ammessa: 1, 2, 3, 4, 6, 12 mesi').default(2),
  ref_due: optDate, avg_amount: optNum(0, 10_000_000), offer_end: optDate, auto_pay: z.boolean().default(false), notes: optText(2000), active: z.boolean().default(true),
  pod_pdr: optText(60), contracted_power_kw: optNum(0, 100_000), tariff: optText(120), co2_factor: optNum(0, 100), unit: optText(20), meta_notes: optText(1000),
});
const FIN_COLS = ['site_id', 'kind', 'supplier_org_id', 'supplier_name', 'code', 'holder', 'transfer_status', 'period_months', 'ref_due', 'avg_amount', 'offer_end', 'auto_pay', 'notes', 'active'];
const META_COLS = ['vector', 'pod_pdr', 'contracted_power_kw', 'tariff', 'co2_factor', 'unit'];
const upsertMeta = (c, id, d) => c.query(`INSERT INTO utility_meta (utility_id, vector, pod_pdr, contracted_power_kw, tariff, co2_factor, unit, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
  ON CONFLICT (utility_id) DO UPDATE SET vector=EXCLUDED.vector, pod_pdr=EXCLUDED.pod_pdr, contracted_power_kw=EXCLUDED.contracted_power_kw, tariff=EXCLUDED.tariff, co2_factor=EXCLUDED.co2_factor, unit=EXCLUDED.unit, notes=EXCLUDED.notes, updated_at=now()`,
[id, d.vector, d.pod_pdr ?? null, d.contracted_power_kw ?? null, d.tariff ?? null, d.co2_factor ?? null, d.unit || UNIT_DEFAULT[d.vector] || null, d.meta_notes ?? null]);

r.post('/utenze', requireFacility, ah(async (req, res) => {
  await requireFinance();
  const d = parse(utilSchema, req.body || {});
  await siteById(d.site_id);
  if (d.supplier_org_id && !await one('SELECT 1 FROM public.organizations WHERE id=$1', [d.supplier_org_id])) throw bad('Fornitore inesistente: scegli una Legal entity dell\'anagrafica');
  d.kind = d.kind || VECTOR_TO_KIND[d.vector];
  if (!d.code && d.pod_pdr) d.code = d.pod_pdr;                           // il codice dell'utenza in Payments è il POD/PDR
  const row = await tx(async (c) => {
    const u = (await c.query(`INSERT INTO finance.utilities (${FIN_COLS.join(', ')}) VALUES (${FIN_COLS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, FIN_COLS.map((k) => d[k] ?? null))).rows[0];
    await upsertMeta(c, u.id, d);
    return u;
  });
  await audit(req, 'FACILITY_UTENZA_CREATA', { module: KEY, entity: 'utility', entityId: row.id, data: { site_id: d.site_id, kind: d.kind, vector: d.vector, payments: true } });
  res.status(201).json(await utilityRow(row.id));
}));

r.put('/utenze/:id', requireFacility, ah(async (req, res) => {
  await requireFinance();
  const cur = await utilityRow(idOf(req.params.id, 'Utenza non trovata'));
  const d = parse(utilSchema.partial(), req.body || {});
  if (d.site_id && d.site_id !== cur.site_id) await siteById(d.site_id);
  await tx(async (c) => {
    const cols = FIN_COLS.filter((k) => d[k] !== undefined);   // con .partial() i predefiniti non si applicano: solo i campi inviati
    if (cols.length) await c.query(`UPDATE finance.utilities SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [cur.id, ...cols.map((k) => d[k])]);
    if (META_COLS.some((k) => d[k] !== undefined) || d.meta_notes !== undefined) {
      const m = { vector: d.vector || cur.vector || 'ALTRO', pod_pdr: d.pod_pdr !== undefined ? d.pod_pdr : cur.pod_pdr, contracted_power_kw: d.contracted_power_kw !== undefined ? d.contracted_power_kw : cur.contracted_power_kw,
        tariff: d.tariff !== undefined ? d.tariff : cur.tariff, co2_factor: d.co2_factor !== undefined ? d.co2_factor : cur.co2_factor, unit: d.unit !== undefined ? d.unit : cur.meta_unit, meta_notes: d.meta_notes !== undefined ? d.meta_notes : cur.meta_notes };
      await upsertMeta(c, cur.id, m);
    }
  });
  await audit(req, 'FACILITY_UTENZA', { module: KEY, entity: 'utility', entityId: cur.id, data: { campi: Object.keys(d) } });
  res.json(await utilityRow(cur.id));
}));

// ---- Bollette (finance.utility_bills): compaiono da sole nello scadenziario di Payments con la scadenza di pagamento
const billSchema = z.object({
  period_from: optDate, period_to: optDate, due_date: DATE, amount: z.coerce.number().min(0).max(100_000_000),
  consumption: optNum(0, 1e12), unit: optText(20), paid_at: optDate, notes: optText(500),
});
r.post('/utenze/:id/bollette', requireFacility, ah(async (req, res) => {
  await requireFinance();
  const u = await utilityRow(idOf(req.params.id, 'Utenza non trovata'));
  const d = parse(billSchema, req.body || {});
  if (d.period_from && d.period_to && d.period_to < d.period_from) throw bad('Il periodo della bolletta non è valido');
  const row = await one(`INSERT INTO finance.utility_bills (utility_id, period_from, period_to, due_date, amount, consumption, unit, paid_at, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [u.id, d.period_from ?? null, d.period_to ?? null, d.due_date, d.amount, d.consumption ?? null, d.unit || u.unit || null, d.paid_at ?? null, d.notes ? `${d.notes}` : 'Registrata da Facility']);
  await audit(req, 'FACILITY_BOLLETTA', { module: KEY, entity: 'utility', entityId: u.id, data: { bill_id: row.id, due_date: d.due_date, amount: d.amount, consumption: d.consumption ?? null } });
  res.status(201).json(row);
}));
r.put('/bollette/:id', requireFacility, ah(async (req, res) => {
  await requireFinance();
  const b = await one('SELECT * FROM finance.utility_bills WHERE id=$1', [idOf(req.params.id, 'Bolletta non trovata')]);
  if (!b) throw notFound('Bolletta non trovata');
  const d = parse(billSchema.partial(), req.body || {});
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE finance.utility_bills SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [b.id, ...cols.map((k) => d[k])]);
  await audit(req, 'FACILITY_BOLLETTA', { module: KEY, entity: 'utility', entityId: b.utility_id, data: { bill_id: b.id, campi: cols } });
  res.json(await one('SELECT * FROM finance.utility_bills WHERE id=$1', [b.id]));
}));
r.delete('/bollette/:id', requireFacility, ah(async (req, res) => {
  await requireFinance();
  const b = await one('SELECT * FROM finance.utility_bills WHERE id=$1', [idOf(req.params.id, 'Bolletta non trovata')]);
  if (!b) throw notFound('Bolletta non trovata');
  if (b.paid_at) throw bad('La bolletta risulta pagata in Payments: si corregge dallo Scadenziario strutture');
  await q('DELETE FROM finance.utility_bills WHERE id=$1', [b.id]);
  await audit(req, 'FACILITY_BOLLETTA_ELIMINATA', { module: KEY, entity: 'utility', entityId: b.utility_id, data: { bill_id: b.id } });
  res.json({ ok: true });
}));

// ---- Letture dei contatori (Facility; il site manager per la propria sede)
const readSchema = z.object({ read_at: DATE, value: z.coerce.number().min(0).max(1e13), source: z.enum(['MANUALE', 'BOLLETTA', 'SMART']).default('MANUALE'), notes: optText(500) });
r.post('/utenze/:id/letture', ah(async (req, res) => {
  await requireFinance();
  const u = await utilityRow(idOf(req.params.id, 'Utenza non trovata'));
  if (!(isFacility(req) || (isSite(req) && canSeeSite(req, u.site_id)))) throw forbidden('Le letture le registrano Facility o il site manager della sede');
  const d = parse(readSchema, req.body || {});
  const row = await one(`INSERT INTO meter_readings (utility_id, read_at, value, source, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (utility_id, read_at) DO UPDATE SET value=EXCLUDED.value, source=EXCLUDED.source, notes=EXCLUDED.notes, created_by=EXCLUDED.created_by RETURNING *`,
  [u.id, d.read_at, d.value, d.source, d.notes || null, req.moduleUser.id]);
  await audit(req, 'FACILITY_LETTURA', { module: KEY, entity: 'utility', entityId: u.id, data: { read_at: d.read_at } });
  res.status(201).json(row);
}));
r.delete('/letture/:id', requireFacility, ah(async (req, res) => {
  const x = await one('DELETE FROM meter_readings WHERE id=$1 RETURNING utility_id', [idOf(req.params.id, 'Lettura non trovata')]);
  if (!x) throw notFound('Lettura non trovata');
  res.json({ ok: true });
}));

// Legal entity per il fornitore (selettore)
r.get('/organizations', ah(async (req, res) => {
  if (limitedToSites(req)) throw forbidden();
  const qs = String(req.query.q || '').trim();
  const params = []; let w = 'o.active';
  if (qs) { params.push(`%${qs}%`); w += ` AND (o.name ILIKE $1 OR o.vat_number ILIKE $1 OR o.city ILIKE $1)`; }
  res.json(await many(`SELECT o.id, o.kind, o.name, o.vat_number, o.city FROM public.organizations o WHERE ${w} ORDER BY o.name LIMIT 60`, params));
}));

export default r;
