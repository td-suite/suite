// Scadenziario strutture: contratti di affitto (con gli scatti del canone), utenze (con le bollette), agenda delle scadenze,
// esiti, previsione dei costi ed esportazione. Montato su /api/cash/scadenziario.
// Accesso: SUPERADMIN, ADMIN, FINANCE leggono e scrivono; OPERATOR e CASSIERE leggono le proprie sedi; PARTNER escluso.
import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome, itDate, eur } from '../lib/util.js';
import { Params, siteScope } from '../lib/access.js';
import { buildEvents, kpis, forecast, contractEnd, stepAt, toIso, parseDate, addMonths, isOverdue, UTILITY_LABEL, LEASE_KIND_LABEL, REGISTRATION_LABEL, TRANSFER_LABEL } from '../lib/schedule.js';
import { WRITE_ROLES, READ_ROLES, visibleSiteIds, loadScheduleData, scheduleSettings, siteName } from '../lib/scheduleData.js';

const r = Router();
r.use((req, _res, next) => (READ_ROLES.includes(req.user.role) ? next() : next(forbidden('Sezione non disponibile per il profilo'))));
const requireWrite = (req, _res, next) => (WRITE_ROLES.includes(req.user.role) ? next() : next(forbidden('Profilo in sola lettura sullo scadenziario')));

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG').refine((v) => { const t = parseDate(v); return t != null && toIso(t) === v; }, 'data inesistente');
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const optText = (max) => opt(z.string().trim().max(max));
const money = z.coerce.number().min(0).max(100_000_000);
const intId = z.coerce.number().int().positive();

// ---- perimetro ----
async function scopedSiteIds(req) {
  const ids = await visibleSiteIds(req.user);
  const asked = req.query.site_id ? Number(req.query.site_id) : null;
  if (asked) {
    if (ids && !ids.includes(asked)) throw forbidden('Sede non autorizzata');
    return [asked];
  }
  return ids;
}
async function assertSiteAccess(user, siteId) {
  const site = await one('SELECT id, code, name FROM sites_v WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata nell\'anagrafica della Suite (le strutture dei clienti service non si gestiscono qui)');
  const ids = await visibleSiteIds(user);
  if (ids && !ids.includes(siteId)) throw forbidden('Sede non autorizzata');
  return site;
}
async function assertOrg(id, label) {
  if (id == null) return;
  if (!await one('SELECT 1 FROM public.organizations WHERE id=$1', [id])) throw bad(`${label} inesistente: scegli una Legal entity dell'anagrafica`);
}
async function getLease(req, id) {
  const l = await one('SELECT l.*, coalesce(l.landlord_name, o.name) AS landlord_name FROM lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id WHERE l.id=$1', [id]);
  if (!l) throw notFound('Contratto non trovato');
  await assertSiteAccess(req.user, l.site_id);
  return l;
}
async function getUtility(req, id) {
  const u = await one('SELECT u.*, coalesce(u.supplier_name, o.name) AS supplier_name FROM utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id WHERE u.id=$1', [id]);
  if (!u) throw notFound('Utenza non trovata');
  await assertSiteAccess(req.user, u.site_id);
  return u;
}

// ---- sedi e Legal entity per i selettori ----
r.get('/sites', ah(async (req, res) => {
  const P = new Params();
  const rows = await many(`SELECT s.id, s.code, s.name, s.city, s.province, s.address, s.active, s.configured, s.ownership, s.host_name, s.company_id,
      (SELECT count(*)::int FROM lease_contracts l WHERE l.site_id=s.id AND l.active) AS leases_count,
      (SELECT count(*)::int FROM utilities u WHERE u.site_id=s.id AND u.active) AS utilities_count,
      (SELECT count(*)::int FROM utilities u WHERE u.site_id=s.id AND u.active AND u.transfer_status IN ('DA_AVVIARE','IN_CORSO')) AS transfers_open
    FROM sites_v s WHERE ${siteScope(req.user, P)} ${req.query.active === '1' ? 'AND s.active' : ''} ORDER BY s.name`, P.values);
  // prossima scadenza per sede (eventi futuri non fatti)
  const data = await loadScheduleData(rows.map((x) => x.id));
  const today = todayRome();
  const events = buildEvents({ ...data, today, from: today, to: toIso(parseDate(today) + 400 * 86400000) });
  for (const s of rows) {
    const next = events.find((e) => e.site_id === s.id && e.days >= 0 && !e.done);
    s.next_event = next ? { date: next.date, title: next.title, amount: next.amount, kind: next.kind } : null;
    s.overdue = events.filter((e) => e.site_id === s.id && isOverdue(e)).length;
  }
  res.json(rows);
}));

r.get('/organizations', ah(async (_req, res) => {
  res.json(await many(`SELECT id, kind, code, name, vat_number, city, active FROM public.organizations WHERE active ORDER BY lower(name)`));
}));

// ---- agenda ----
r.get('/events', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const today = todayRome();
  const from = req.query.from && DATE.safeParse(req.query.from).success ? req.query.from : toIso(parseDate(today) - 60 * 86400000);
  const to = req.query.to && DATE.safeParse(req.query.to).success ? req.query.to : toIso(parseDate(today) + 400 * 86400000);
  const data = await loadScheduleData(siteIds);
  let events = buildEvents({ ...data, from, to, today });
  const cat = String(req.query.cat || '').toUpperCase();
  if (['AFFITTO', 'UTENZA'].includes(cat)) events = events.filter((e) => e.cat === cat);
  const names = new Map(data.sites.map((s) => [s.id, s]));
  for (const e of events) { const s = names.get(e.site_id); e.site_name = s?.name || `Sede ${e.site_id}`; e.site_code = s?.code || null; }
  const settings = await scheduleSettings();
  res.json({ today, from, to, events, kpi: kpis({ events: buildEvents({ ...data, from, to, today }), leases: data.leases, steps: data.steps, utilities: data.utilities, today }), sites: data.sites, alert_days: settings.alert_days, can_write: WRITE_ROLES.includes(req.user.role) });
}));

const KEY_RE = /^(canone|istat|registro|fine|disdetta|bolletta|offerta):(lease|utility):(\d+):(\d{4}-\d{2}-\d{2})$/;
r.post('/events/done', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ key: z.string().regex(KEY_RE, 'chiave evento non valida'), note: optText(500), amount: opt(money) }), req.body);
  const [, kind, type, id, date] = d.key.match(KEY_RE);
  const owner = type === 'lease' ? await getLease(req, Number(id)) : await getUtility(req, Number(id));
  await tx(async (c) => {
    await c.query(`INSERT INTO schedule_done (event_key, site_id, user_id, note, amount) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (event_key) DO UPDATE SET done_at=now(), user_id=EXCLUDED.user_id, note=EXCLUDED.note, amount=EXCLUDED.amount`, [d.key, owner.site_id, req.user.id, d.note || null, d.amount ?? null]);
    // una bolletta registrata segnata come pagata prende la data di oggi come pagamento
    if (kind === 'bolletta' && type === 'utility') await c.query('UPDATE utility_bills SET paid_at=coalesce(paid_at, $3::date) WHERE utility_id=$1 AND due_date=$2::date', [owner.id, date, todayRome()]);
  });
  await audit(req, 'SCHEDULE_DONE', type, id, { key: d.key, note: d.note, amount: d.amount });
  res.status(201).json({ ok: true });
}));

r.delete('/events/done/:key', requireWrite, ah(async (req, res) => {
  const key = String(req.params.key);
  const m = key.match(KEY_RE);
  if (!m) throw bad('Chiave evento non valida');
  const [, kind, type, id, date] = m;
  const owner = type === 'lease' ? await getLease(req, Number(id)) : await getUtility(req, Number(id));
  await tx(async (c) => {
    await c.query('DELETE FROM schedule_done WHERE event_key=$1', [key]);
    if (kind === 'bolletta' && type === 'utility') await c.query('UPDATE utility_bills SET paid_at=NULL WHERE utility_id=$1 AND due_date=$2::date', [owner.id, date]);
  });
  await audit(req, 'SCHEDULE_UNDONE', type, id, { key });
  res.json({ ok: true });
}));

// ---- previsione ----
r.get('/forecast', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const months = Math.max(1, Math.min(36, Number(req.query.months) || 12));
  const data = await loadScheduleData(siteIds);
  const settings = await scheduleSettings();
  const f = forecast({ ...data, settings, months, today: todayRome() });
  const names = new Map(data.sites.map((s) => [s.id, s]));
  for (const s of f.sites) { s.site_name = names.get(s.site_id)?.name || `Sede ${s.site_id}`; s.site_code = names.get(s.site_id)?.code || null; }
  for (const s of f.previous.sites) s.site_name = names.get(s.site_id)?.name || `Sede ${s.site_id}`;
  res.json(f);
}));

// ---- contratti ----
const leaseSchema = z.object({
  site_id: intId,
  landlord_org_id: opt(intId),
  landlord_name: optText(200),
  unit: optText(200),
  kind: z.enum(['COMMERCIALE_6_6', 'COMMERCIALE_9_9', 'ABITATIVO_4_4', 'ABITATIVO_3_2', 'TRANSITORIO', 'COMODATO', 'ALTRO']).default('COMMERCIALE_6_6'),
  start_date: DATE,
  first_term_years: opt(z.coerce.number().int().min(0).max(99)),
  renewal_years: opt(z.coerce.number().int().min(0).max(99)),
  notice_months: opt(z.coerce.number().int().min(0).max(60)),
  period_months: z.coerce.number().int().refine((v) => [1, 2, 3, 6, 12].includes(v), 'periodicità ammessa: 1, 2, 3, 6, 12 mesi').default(1),
  first_due: opt(DATE),
  deposit: opt(money),
  registration: opt(z.enum(['IMPOSTA_ANNUALE', 'UNICA_SOLUZIONE', 'CEDOLARE_SECCA', 'DA_REGISTRARE'])),
  istat: z.boolean().default(false),
  auto_pay: z.boolean().default(false),
  business_contract_id: opt(intId),
  notes: optText(2000),
  active: z.boolean().default(true),
  amount: opt(money),      // importo iniziale della rata: crea o aggiorna lo scatto INIZIALE
});
const LEASE_COLS = ['site_id', 'landlord_org_id', 'landlord_name', 'unit', 'kind', 'start_date', 'first_term_years', 'renewal_years', 'notice_months', 'period_months', 'first_due', 'deposit', 'registration', 'istat', 'auto_pay', 'business_contract_id', 'notes', 'active'];
const partialOf = (schema) => z.object(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()])));

// Contratto arricchito: canone vigente, scadenza, disdetta, scatti
function decorateLease(l, steps, today) {
  const T = parseDate(today);
  const ls = steps.filter((s) => s.lease_id === l.id).sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)));
  const cur = stepAt(ls, T);
  const ce = contractEnd(l, T);
  const pm = Number(l.notice_months) || 0;
  return { ...l, steps: ls, current_amount: cur ? Number(cur.amount) : null, current_step_from: cur?.valid_from || null, monthly_amount: cur ? Math.round((Number(cur.amount) / (Number(l.period_months) || 1)) * 100) / 100 : null,
    end_date: ce ? toIso(ce.end) : null, expired: !!ce?.expired, renewals: ce?.renewals || 0, notice_by: ce && pm ? toIso(addMonths(ce.end, -pm)) : null,
    kind_label: LEASE_KIND_LABEL[l.kind] || l.kind, registration_label: l.registration ? REGISTRATION_LABEL[l.registration] : null };
}

r.get('/leases', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const data = await loadScheduleData(siteIds, { includeInactive: req.query.all === '1' });
  const today = todayRome();
  res.json(data.leases.map((l) => ({ ...decorateLease(l, data.steps, today), site_name: siteName(data.sites, l.site_id) })));
}));

r.get('/leases/:id', ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const steps = await many('SELECT s.*, u.full_name AS created_by_name FROM lease_steps s LEFT JOIN users_v u ON u.id=s.created_by WHERE s.lease_id=$1 ORDER BY s.valid_from', [l.id]);
  const site = await one('SELECT id, code, name FROM public.sites WHERE id=$1', [l.site_id]);
  res.json({ ...decorateLease(l, steps, todayRome()), site_name: site?.name });
}));

r.post('/leases', requireWrite, ah(async (req, res) => {
  const d = parse(leaseSchema, req.body);
  await assertSiteAccess(req.user, d.site_id);
  await assertOrg(d.landlord_org_id, 'Locatore');
  if (d.first_due && d.first_due < d.start_date) throw bad('La prima scadenza della rata non può precedere la decorrenza');
  const row = await tx(async (c) => {
    const l = (await c.query(`INSERT INTO lease_contracts (${LEASE_COLS.join(', ')}, created_by) VALUES (${LEASE_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${LEASE_COLS.length + 1}) RETURNING *`, [...LEASE_COLS.map((k) => d[k] ?? null), req.user.id])).rows[0];
    if (d.amount != null) await c.query(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, created_by) VALUES ($1,$2,$3,'INIZIALE',$4)`, [l.id, d.start_date, d.amount, req.user.id]);
    return l;
  });
  await audit(req, 'LEASE_CREATE', 'lease', row.id, { site_id: d.site_id, unit: d.unit, amount: d.amount });
  res.status(201).json(row);
}));

r.put('/leases/:id', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const d = parse(partialOf(leaseSchema), req.body);
  if (d.site_id != null && d.site_id !== l.site_id) await assertSiteAccess(req.user, d.site_id);
  if (d.landlord_org_id !== undefined) await assertOrg(d.landlord_org_id, 'Locatore');
  const start = d.start_date ?? l.start_date;
  const firstDue = d.first_due === undefined ? l.first_due : d.first_due;
  if (firstDue && firstDue < start) throw bad('La prima scadenza della rata non può precedere la decorrenza');
  await tx(async (c) => {
    const cols = LEASE_COLS.filter((k) => d[k] !== undefined);
    if (cols.length) await c.query(`UPDATE lease_contracts SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [l.id, ...cols.map((k) => d[k])]);
    // scatto INIZIALE allineato alla decorrenza e all'importo iniziale
    const ini = (await c.query(`SELECT id FROM lease_steps WHERE lease_id=$1 AND reason='INIZIALE' ORDER BY valid_from LIMIT 1`, [l.id])).rows[0];
    if (d.amount != null) {
      if (ini) await c.query('UPDATE lease_steps SET amount=$2, valid_from=$3 WHERE id=$1', [ini.id, d.amount, start]);
      else await c.query(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, created_by) VALUES ($1,$2,$3,'INIZIALE',$4) ON CONFLICT (lease_id, valid_from) DO UPDATE SET amount=EXCLUDED.amount`, [l.id, start, d.amount, req.user.id]);
    } else if (ini && d.start_date && d.start_date !== l.start_date) {
      await c.query('UPDATE lease_steps SET valid_from=$2 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM lease_steps x WHERE x.lease_id=$3 AND x.valid_from=$2 AND x.id<>$1)', [ini.id, start, l.id]);
    }
  });
  await audit(req, 'LEASE_UPDATE', 'lease', l.id, d);
  res.json(await one('SELECT * FROM lease_contracts WHERE id=$1', [l.id]));
}));

r.delete('/leases/:id', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  await tx(async (c) => {
    await c.query('DELETE FROM lease_contracts WHERE id=$1', [l.id]);
    await c.query(`DELETE FROM schedule_done WHERE event_key LIKE '%:lease:' || $1 || ':%'`, [String(l.id)]);
  });
  await audit(req, 'LEASE_DELETE', 'lease', l.id, { site_id: l.site_id, unit: l.unit });
  res.json({ ok: true });
}));

// ---- scatti del canone ----
const stepSchema = z.object({
  valid_from: DATE,
  amount: money,
  reason: z.enum(['INIZIALE', 'ISTAT', 'RINEGOZIAZIONE', 'ALTRO']).default('ALTRO'),
  pct: opt(z.coerce.number().min(-100).max(999)),
  notes: optText(500),
});
r.post('/leases/:id/steps', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const d = parse(stepSchema, req.body);
  if (d.valid_from < l.start_date) throw bad('Lo scatto non può precedere la decorrenza del contratto');
  if (await one('SELECT 1 FROM lease_steps WHERE lease_id=$1 AND valid_from=$2', [l.id, d.valid_from])) throw bad('Esiste già uno scatto con questa data: modificalo o scegli un\'altra data');
  const row = await one(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [l.id, d.valid_from, d.amount, d.reason, d.pct ?? null, d.notes || null, req.user.id]);
  await audit(req, 'LEASE_STEP_CREATE', 'lease', l.id, d);
  res.status(201).json(row);
}));
r.put('/steps/:id', requireWrite, ah(async (req, res) => {
  const s = await one('SELECT * FROM lease_steps WHERE id=$1', [Number(req.params.id)]);
  if (!s) throw notFound('Scatto non trovato');
  const l = await getLease(req, s.lease_id);
  const d = parse(partialOf(stepSchema), req.body);
  if (d.valid_from && d.valid_from < l.start_date) throw bad('Lo scatto non può precedere la decorrenza del contratto');
  if (d.valid_from && d.valid_from !== s.valid_from && await one('SELECT 1 FROM lease_steps WHERE lease_id=$1 AND valid_from=$2', [l.id, d.valid_from])) throw bad('Esiste già uno scatto con questa data');
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE lease_steps SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [s.id, ...cols.map((k) => d[k])]);
  await audit(req, 'LEASE_STEP_UPDATE', 'lease', l.id, { step_id: s.id, ...d });
  res.json(await one('SELECT * FROM lease_steps WHERE id=$1', [s.id]));
}));
r.delete('/steps/:id', requireWrite, ah(async (req, res) => {
  const s = await one('SELECT * FROM lease_steps WHERE id=$1', [Number(req.params.id)]);
  if (!s) throw notFound('Scatto non trovato');
  const l = await getLease(req, s.lease_id);
  await q('DELETE FROM lease_steps WHERE id=$1', [s.id]);
  await audit(req, 'LEASE_STEP_DELETE', 'lease', l.id, { step_id: s.id, valid_from: s.valid_from, amount: s.amount });
  res.json({ ok: true });
}));

// ---- utenze ----
const utilitySchema = z.object({
  site_id: intId,
  kind: z.enum(['ENERGIA', 'GAS', 'ACQUA', 'TARI', 'TELEFONIA', 'CONDOMINIO', 'VIGILANZA', 'PULIZIE', 'ALTRO']).default('ALTRO'),
  supplier_org_id: opt(intId),
  supplier_name: optText(200),
  code: optText(100),
  holder: optText(200),
  transfer_status: z.enum(['DA_AVVIARE', 'IN_CORSO', 'COMPLETATA', 'NON_NECESSARIA']).default('NON_NECESSARIA'),
  period_months: z.coerce.number().int().refine((v) => [1, 2, 3, 4, 6, 12].includes(v), 'fatturazione ammessa: 1, 2, 3, 4, 6, 12 mesi').default(2),
  ref_due: opt(DATE),
  avg_amount: opt(money),
  offer_end: opt(DATE),
  auto_pay: z.boolean().default(false),
  notes: optText(2000),
  active: z.boolean().default(true),
});
const UTILITY_COLS = ['site_id', 'kind', 'supplier_org_id', 'supplier_name', 'code', 'holder', 'transfer_status', 'period_months', 'ref_due', 'avg_amount', 'offer_end', 'auto_pay', 'notes', 'active'];

function decorateUtility(u, bills, today) {
  const ub = bills.filter((b) => b.utility_id === u.id).sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
  const T = parseDate(today), from12 = new Date(T); from12.setUTCFullYear(from12.getUTCFullYear() - 1);
  const recent = ub.filter((b) => parseDate(b.due_date) > from12.getTime() && parseDate(b.due_date) <= T);
  const avgBill = recent.length ? Math.round((recent.reduce((a, b) => a + Number(b.amount), 0) / recent.length) * 100) / 100 : null;
  return { ...u, bills: ub, bills_count: ub.length, avg_bill_12m: avgBill, estimate: avgBill ?? (u.avg_amount != null ? Number(u.avg_amount) : null), estimate_source: avgBill != null ? 'bollette' : u.avg_amount != null ? 'media' : null,
    unpaid: ub.filter((b) => !b.paid_at).length, kind_label: UTILITY_LABEL[u.kind] || u.kind, transfer_label: TRANSFER_LABEL[u.transfer_status] || u.transfer_status };
}

r.get('/utilities', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const data = await loadScheduleData(siteIds, { includeInactive: req.query.all === '1' });
  const today = todayRome();
  let rows = data.utilities.map((u) => ({ ...decorateUtility(u, data.bills, today), site_name: siteName(data.sites, u.site_id) }));
  if (req.query.transfers === '1') rows = rows.filter((u) => ['DA_AVVIARE', 'IN_CORSO'].includes(u.transfer_status));
  res.json(rows);
}));

r.get('/utilities/:id', ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const bills = await many('SELECT b.*, x.full_name AS created_by_name FROM utility_bills b LEFT JOIN users_v x ON x.id=b.created_by WHERE b.utility_id=$1 ORDER BY b.due_date DESC', [u.id]);
  const site = await one('SELECT id, code, name FROM public.sites WHERE id=$1', [u.site_id]);
  res.json({ ...decorateUtility(u, bills, todayRome()), site_name: site?.name });
}));

r.post('/utilities', requireWrite, ah(async (req, res) => {
  const d = parse(utilitySchema, req.body);
  await assertSiteAccess(req.user, d.site_id);
  await assertOrg(d.supplier_org_id, 'Fornitore');
  const row = await one(`INSERT INTO utilities (${UTILITY_COLS.join(', ')}, created_by) VALUES (${UTILITY_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${UTILITY_COLS.length + 1}) RETURNING *`, [...UTILITY_COLS.map((k) => d[k] ?? null), req.user.id]);
  await audit(req, 'UTILITY_CREATE', 'utility', row.id, { site_id: d.site_id, kind: d.kind, supplier: d.supplier_name });
  res.status(201).json(row);
}));

r.put('/utilities/:id', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const d = parse(partialOf(utilitySchema), req.body);
  if (d.site_id != null && d.site_id !== u.site_id) await assertSiteAccess(req.user, d.site_id);
  if (d.supplier_org_id !== undefined) await assertOrg(d.supplier_org_id, 'Fornitore');
  const cols = UTILITY_COLS.filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE utilities SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [u.id, ...cols.map((k) => d[k])]);
  await audit(req, 'UTILITY_UPDATE', 'utility', u.id, d);
  res.json(await one('SELECT * FROM utilities WHERE id=$1', [u.id]));
}));

r.delete('/utilities/:id', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  await tx(async (c) => {
    await c.query('DELETE FROM utilities WHERE id=$1', [u.id]);
    await c.query(`DELETE FROM schedule_done WHERE event_key LIKE '%:utility:' || $1 || ':%'`, [String(u.id)]);
  });
  await audit(req, 'UTILITY_DELETE', 'utility', u.id, { site_id: u.site_id, kind: u.kind });
  res.json({ ok: true });
}));

// ---- bollette ----
const billSchema = z.object({
  period_from: opt(DATE),
  period_to: opt(DATE),
  due_date: DATE,
  amount: money,
  consumption: opt(z.coerce.number().min(0)),
  unit: optText(20),
  paid_at: opt(DATE),
  notes: optText(500),
});
r.post('/utilities/:id/bills', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const d = parse(billSchema, req.body);
  if (d.period_from && d.period_to && d.period_to < d.period_from) throw bad('Il periodo della bolletta non è valido');
  const row = await one(`INSERT INTO utility_bills (utility_id, period_from, period_to, due_date, amount, consumption, unit, paid_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [u.id, d.period_from ?? null, d.period_to ?? null, d.due_date, d.amount, d.consumption ?? null, d.unit || null, d.paid_at ?? null, d.notes || null, req.user.id]);
  await audit(req, 'UTILITY_BILL_CREATE', 'utility', u.id, { bill_id: row.id, due_date: d.due_date, amount: d.amount });
  res.status(201).json(row);
}));
r.put('/bills/:id', requireWrite, ah(async (req, res) => {
  const b = await one('SELECT * FROM utility_bills WHERE id=$1', [Number(req.params.id)]);
  if (!b) throw notFound('Bolletta non trovata');
  const u = await getUtility(req, b.utility_id);
  const d = parse(partialOf(billSchema), req.body);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE utility_bills SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [b.id, ...cols.map((k) => d[k])]);
  await audit(req, 'UTILITY_BILL_UPDATE', 'utility', u.id, { bill_id: b.id, ...d });
  res.json(await one('SELECT * FROM utility_bills WHERE id=$1', [b.id]));
}));
r.delete('/bills/:id', requireWrite, ah(async (req, res) => {
  const b = await one('SELECT * FROM utility_bills WHERE id=$1', [Number(req.params.id)]);
  if (!b) throw notFound('Bolletta non trovata');
  const u = await getUtility(req, b.utility_id);
  await q('DELETE FROM utility_bills WHERE id=$1', [b.id]);
  await audit(req, 'UTILITY_BILL_DELETE', 'utility', u.id, { bill_id: b.id, due_date: b.due_date, amount: b.amount });
  res.json({ ok: true });
}));

// ---- esportazione XLSX: Agenda, Contratti, Utenze, Previsione ----
r.get('/export.xlsx', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const today = todayRome();
  const data = await loadScheduleData(siteIds);
  const settings = await scheduleSettings();
  const from = req.query.from && DATE.safeParse(req.query.from).success ? req.query.from : toIso(parseDate(today) - 60 * 86400000);
  const to = req.query.to && DATE.safeParse(req.query.to).success ? req.query.to : toIso(parseDate(today) + 400 * 86400000);
  const events = buildEvents({ ...data, from, to, today });
  const f = forecast({ ...data, settings, months: Math.max(1, Math.min(36, Number(req.query.months) || 12)), today });
  const wb = new ExcelJS.Workbook(); wb.creator = 'TD Cash Management';
  const head = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const money = '#,##0.00 €';
  const name = (id) => siteName(data.sites, id);

  const a = wb.addWorksheet('Agenda');
  a.columns = [{ header: 'Data', key: 'date', width: 12 }, { header: 'Sede', key: 'site', width: 28 }, { header: 'Categoria', key: 'cat', width: 10 }, { header: 'Scadenza', key: 'title', width: 32 }, { header: 'Dettaglio', key: 'desc', width: 50 }, { header: 'Importo', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Stima', key: 'est', width: 7 }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Stato', key: 'state', width: 16 }, { header: 'Nota', key: 'note', width: 30 }];
  for (const e of events) a.addRow({ date: itDate(e.date), site: name(e.site_id), cat: e.cat === 'AFFITTO' ? 'Affitto' : 'Utenza', title: e.title, desc: e.desc, amount: e.amount, est: e.estimate ? 'sì' : '', auto: e.auto ? 'sì' : '', state: e.done ? 'fatta' : isOverdue(e) ? `scaduta da ${-e.days} gg` : e.days < 0 ? 'passata' : e.days === 0 ? 'oggi' : `tra ${e.days} gg`, note: e.done_note || '' });
  head(a);

  const c = wb.addWorksheet('Contratti');
  c.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Immobile / unità', key: 'unit', width: 24 }, { header: 'Locatore', key: 'landlord', width: 28 }, { header: 'Tipologia', key: 'kind', width: 16 }, { header: 'Decorrenza', key: 'start', width: 12 }, { header: 'Periodicità (mesi)', key: 'period', width: 10 }, { header: 'Rata vigente', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Dal', key: 'from', width: 12 }, { header: 'Scadenza', key: 'end', width: 12 }, { header: 'Disdetta entro', key: 'notice', width: 12 }, { header: 'Rinnovo (anni)', key: 'renewal', width: 10 }, { header: 'ISTAT', key: 'istat', width: 7 }, { header: 'Registrazione', key: 'reg', width: 16 }, { header: 'Deposito', key: 'deposit', width: 12, style: { numFmt: money } }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Scatti', key: 'steps', width: 60 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const l of data.leases) {
    const d = decorateLease(l, data.steps, today);
    c.addRow({ site: name(l.site_id), unit: l.unit, landlord: l.landlord_name, kind: d.kind_label, start: itDate(l.start_date), period: l.period_months, amount: d.current_amount, from: itDate(d.current_step_from), end: itDate(d.end_date), notice: itDate(d.notice_by), renewal: l.renewal_years, istat: l.istat ? 'sì' : '', reg: d.registration_label || '', deposit: l.deposit, auto: l.auto_pay ? 'sì' : '',
      steps: d.steps.map((s) => `${itDate(s.valid_from)}: ${eur(s.amount)} (${s.reason.toLowerCase()}${s.pct != null ? ` ${s.pct}%` : ''})`).join('; '), notes: l.notes || '' });
  }
  head(c);

  const u = wb.addWorksheet('Utenze');
  u.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Tipo', key: 'kind', width: 18 }, { header: 'Fornitore', key: 'supplier', width: 28 }, { header: 'Codice', key: 'code', width: 20 }, { header: 'Intestatario', key: 'holder', width: 24 }, { header: 'Voltura', key: 'transfer', width: 14 }, { header: 'Fatturazione (mesi)', key: 'period', width: 10 }, { header: 'Scadenza nota', key: 'ref', width: 12 }, { header: 'Importo medio', key: 'avg', width: 14, style: { numFmt: money } }, { header: 'Media bollette 12 mesi', key: 'avg12', width: 14, style: { numFmt: money } }, { header: 'Fine offerta', key: 'offer', width: 12 }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Bollette registrate', key: 'bills', width: 12 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const x of data.utilities) {
    const d = decorateUtility(x, data.bills, today);
    u.addRow({ site: name(x.site_id), kind: d.kind_label, supplier: x.supplier_name, code: x.code, holder: x.holder, transfer: d.transfer_label, period: x.period_months, ref: itDate(x.ref_due), avg: x.avg_amount, avg12: d.avg_bill_12m, offer: itDate(x.offer_end), auto: x.auto_pay ? 'sì' : '', bills: d.bills_count, notes: x.notes || '' });
  }
  head(u);

  const b = wb.addWorksheet('Bollette');
  b.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Utenza', key: 'kind', width: 18 }, { header: 'Fornitore', key: 'supplier', width: 24 }, { header: 'Periodo dal', key: 'pf', width: 12 }, { header: 'al', key: 'pt', width: 12 }, { header: 'Scadenza', key: 'due', width: 12 }, { header: 'Importo', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Consumo', key: 'cons', width: 12 }, { header: 'Unità', key: 'unit', width: 8 }, { header: 'Pagata il', key: 'paid', width: 12 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const bill of data.bills) { const x = data.utilities.find((y) => y.id === bill.utility_id); if (!x) continue; b.addRow({ site: name(x.site_id), kind: UTILITY_LABEL[x.kind] || x.kind, supplier: x.supplier_name, pf: itDate(bill.period_from), pt: itDate(bill.period_to), due: itDate(bill.due_date), amount: Number(bill.amount), cons: bill.consumption != null ? Number(bill.consumption) : null, unit: bill.unit, paid: itDate(bill.paid_at), notes: bill.notes || '' }); }
  head(b);

  const p = wb.addWorksheet('Previsione');
  const mlabel = (mk) => { const [y, m] = mk.split('-'); return `${['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][Number(m) - 1]} ${y}`; };
  p.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Voce', key: 'row', width: 20 }, ...f.months.map((mk) => ({ header: mlabel(mk), key: mk, width: 12, style: { numFmt: money } })), { header: 'Totale', key: 'sum', width: 14, style: { numFmt: money } }];
  const line = (site, row, arr) => p.addRow({ site, row, ...Object.fromEntries(f.months.map((mk, i) => [mk, arr[i]])), sum: arr.reduce((s, v) => s + v, 0) });
  for (const s of f.sites) { line(s.site_name, 'Affitti', s.rent); if (s.registry.some(Boolean)) line(s.site_name, 'Imposta di registro', s.registry); line(s.site_name, 'Utenze', s.utilities); const tr = line(s.site_name, 'Totale sede', s.total); tr.font = { bold: true }; }
  line('Rete', 'Affitti', f.totals.rent); if (f.totals.registry.some(Boolean)) line('Rete', 'Imposta di registro', f.totals.registry); line('Rete', 'Utenze', f.totals.utilities); const tot = line('Rete', 'Totale', f.totals.total); tot.font = { bold: true };
  p.addRow({});
  p.addRow({ site: 'Ipotesi', row: `ISTAT ${f.assumptions.istat_pct}% annuo · crescita utenze ${f.assumptions.utility_growth_pct}% annuo · imposta di registro ${f.assumptions.registry_pct}% del canone annuo (minimo ${f.assumptions.registry_min} €)` });
  p.addRow({ site: 'Ultimi 12 mesi registrati', row: `Affitti ${eur(f.previous.sum_rent)} · Utenze ${eur(f.previous.sum_utilities)} · Totale ${eur(f.previous.sum)}` });
  head(p);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Scadenziario_strutture_${today}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
