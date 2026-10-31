// Immobili: elenco delle sedi dell'anagrafica (immobili creati al volo), scheda con dati immobiliari, canone e scadenze dal contratto di
// Payments, Legal entity ospitante o locatore, obblighi di controllo, documenti con planimetria pubblicata in Room Planning, utenze della
// sede con stato della voltura e prossime bollette, dispositivi, interventi aperti, consumi dell'anno e indicatori.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { config, MB, TENURE, DOC_KINDS, OBLIGATION_KINDS } from '../config.js';
import { ah, audit, bad, parse, HttpError, forbidden, notFound } from '../../../lib/util.js';
import { storeBuffer, sendFile, dropBlobs } from '../../../lib/moduleStorage.js';
import { buildEvents } from '../../finance/lib/schedule.js';
import { requireFacility, assertSite, canSeeSite, limitedToSites, mySiteIds, isFacility, vendorScope, isManutentore } from '../lib/access.js';
import { KEY, idOf, settings, siteById, ensureProperties, propertyBySite, leaseInfo, financeLive, syncObligationPlan, todayRome } from '../lib/core.js';
import { publishPlanToRoom, roomPlanStatus, isPdf, isRoomImage } from '../lib/room.js';
import { siteEnergySummary } from '../lib/energy.js';
import { addDays } from '../lib/calc.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: config.maxFilesPerUpload } }).array('file', config.maxFilesPerUpload);
export const conUpload = (req, res, next) => upload(req, res, (e) => {
  if (!e) return next();
  if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${config.maxFileBytes / MB} MB)`));
  if (e.code === 'LIMIT_FILE_COUNT') return next(bad(`Massimo ${config.maxFilesPerUpload} file per caricamento`));
  next(bad(e.message));
});
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG');
const optDate = DATE.nullable().optional().or(z.literal('').transform(() => null));
const optNum = (min, max) => z.coerce.number().min(min).max(max).nullable().optional().or(z.literal('').transform(() => null));
const optText = (max) => z.string().trim().max(max).nullable().optional();

// ---- Elenco
r.get('/immobili', ah(async (req, res) => {
  await ensureProperties();
  const params = [];
  let w = 's.active';
  if (limitedToSites(req)) { params.push(mySiteIds(req)); w += ` AND s.id = ANY($${params.length}::int[])`; }
  // manutentore esterno: solo le sedi dove la sua Legal entity ha dispositivi o interventi
  const vs = vendorScope(req);
  if (vs) { params.push(vs.orgId); w += ` AND (s.id IN (SELECT site_id FROM assets WHERE vendor_org_id=$${params.length}) OR s.id IN (SELECT site_id FROM work_orders WHERE vendor_org_id=$${params.length}))`; }
  const rows = await many(`SELECT pr.*, s.code, s.name, s.kind, s.city, s.address, s.manager_name, s.host_organization_id, ho.name AS host_name, lo.name AS landlord_name,
      (SELECT count(*)::int FROM property_documents d WHERE d.property_id=pr.id AND d.kind='PLANIMETRIA') AS n_planimetrie,
      (SELECT max(d.published_room_at) FROM property_documents d WHERE d.property_id=pr.id AND d.kind='PLANIMETRIA') AS published_room_at,
      (SELECT count(*)::int FROM assets a WHERE a.site_id=s.id AND a.status <> 'DISMESSO') AS n_assets,
      (SELECT count(*)::int FROM work_orders w WHERE w.site_id=s.id AND w.status <> 'CHIUSO') AS n_wo_open,
      (SELECT count(*)::int FROM maintenance_plans p WHERE p.site_id=s.id AND p.status IN ('PIANIFICATA','SCADUTA') AND p.due_date < CURRENT_DATE) AS n_overdue,
      (SELECT count(*)::int FROM property_obligations o WHERE o.property_id=pr.id AND o.active) AS n_obblighi
    FROM sites_v s JOIN properties pr ON pr.site_id=s.id LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id LEFT JOIN public.organizations lo ON lo.id=pr.landlord_org_id
    WHERE ${w} ORDER BY s.sort_order, s.name`, params);
  const fin = await financeLive();
  const out = [];
  for (const p of rows) {
    const li = fin ? await leaseInfo(p.site_id, p.lease_id) : { available: false, lease: null };
    const ut = fin ? await one('SELECT count(*)::int AS n, count(*) FILTER (WHERE transfer_status IN (\'DA_AVVIARE\',\'IN_CORSO\'))::int AS volture FROM finance.utilities WHERE site_id=$1 AND active', [p.site_id]) : null;
    out.push({ ...p, tenure_label: TENURE[p.tenure], lease: li.lease ? { id: li.lease.id, rent_monthly: li.lease.rent_monthly, end_date: li.lease.end_date, landlord: li.lease.landlord, expired: li.lease.expired } : null,
      n_utilities: ut?.n ?? null, volture_aperte: ut?.volture ?? null });
  }
  res.json({ rows: out, finance: fin, can_edit: isFacility(req) });
}));

// ---- Scheda
r.get('/immobili/:siteId', ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  assertSite(req, siteId);
  if (isManutentore(req)) throw forbidden('La scheda dell\'immobile non è disponibile per i manutentori');
  const site = await siteById(siteId);
  const prop = await propertyBySite(siteId);
  const imp = await settings();
  const today = todayRome();
  const year = Number(String(today).slice(0, 4));
  const [host, landlord, li, obligations, documents, assets, wos, room] = await Promise.all([
    site.host_organization_id ? one('SELECT id, name, kind, vat_number, city FROM public.organizations WHERE id=$1', [site.host_organization_id]) : null,
    prop.landlord_org_id ? one('SELECT id, name, kind, vat_number, city FROM public.organizations WHERE id=$1', [prop.landlord_org_id]) : null,
    leaseInfo(siteId, prop.lease_id),
    many(`SELECT o.*, t.name AS asset_type_name, (SELECT row_to_json(x) FROM (SELECT p.id, p.due_date, p.status FROM maintenance_plans p WHERE p.obligation_id=o.id AND p.status IN ('PIANIFICATA','SCADUTA') ORDER BY p.due_date LIMIT 1) x) AS next_plan,
      (SELECT max(p.done_at) FROM maintenance_plans p WHERE p.obligation_id=o.id AND p.status='ESEGUITA') AS last_done
      FROM property_obligations o LEFT JOIN public.asset_types t ON t.code=o.asset_type_code WHERE o.property_id=$1 ORDER BY o.active DESC, o.title`, [prop.id]),
    many(`SELECT d.id, d.kind, d.title, d.filename, d.mime, d.size, d.valid_until, d.published_room_at, d.notes, d.created_at, u.full_name AS uploaded_by_name FROM property_documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.property_id=$1 ORDER BY d.kind, d.created_at DESC`, [prop.id]),
    many(`SELECT a.id, a.code, a.name, a.asset_type_code, t.name AS type_name, t.category, a.location, a.status, a.next_check_due, a.next_maintenance_due, a.last_outcome FROM assets a JOIN public.asset_types t ON t.code=a.asset_type_code WHERE a.site_id=$1 AND a.status <> 'DISMESSO' ORDER BY t.category, a.code`, [siteId]),
    many(`SELECT w.id, w.code, w.title, w.priority, w.status, w.opened_at, w.due_at FROM work_orders w WHERE w.site_id=$1 AND w.status <> 'CHIUSO' ORDER BY w.opened_at DESC`, [siteId]),
    roomPlanStatus(siteId),
  ]);
  // utenze della sede da Payments con stato della voltura e prossime bollette attese (calcolo dello scadenziario di Payments)
  let utilities = null, nextBills = [];
  if (li.available) {
    utilities = await many(`SELECT u.id, u.kind, coalesce(u.supplier_name, o.name) AS supplier_name, u.code, u.holder, u.transfer_status, u.period_months, u.ref_due, u.avg_amount, u.auto_pay, u.active,
        m.vector, m.pod_pdr, m.contracted_power_kw, (SELECT max(b.due_date) FROM finance.utility_bills b WHERE b.utility_id=u.id) AS last_bill
      FROM finance.utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN utility_meta m ON m.utility_id=u.id WHERE u.site_id=$1 ORDER BY u.active DESC, u.kind`, [siteId]);
    const act = utilities.filter((u) => u.active);
    const bills = act.length ? await many('SELECT * FROM finance.utility_bills WHERE utility_id = ANY($1::int[])', [act.map((u) => u.id)]) : [];
    nextBills = buildEvents({ utilities: act, bills, from: today, to: addDays(today, 120), today }).filter((e) => e.kind === 'bolletta' && !e.done).slice(0, 8);
  }
  const energy = li.available ? await siteEnergySummary(siteId, imp, year) : { available: false };
  const planimetria = documents.find((d) => d.kind === 'PLANIMETRIA') || null;
  res.json({ site, property: { ...prop, tenure_label: TENURE[prop.tenure] }, host, landlord, lease: li, obligations, documents, planimetria, room, assets, work_orders: wos, utilities, next_bills: nextBills, energy,
    finance: li.available, can_edit: isFacility(req), labels: { tenure: TENURE, doc_kinds: DOC_KINDS, obligation_kinds: OBLIGATION_KINDS } });
}));

const propSchema = z.object({
  tenure: z.enum(Object.keys(TENURE)).optional(),
  lease_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  landlord_org_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  surface_sqm: optNum(0, 1_000_000), floors: optNum(-5, 200), rooms: optNum(0, 10_000),
  cadastral: z.object({ foglio: optText(40), particella: optText(40), sub: optText(40), categoria: optText(40), rendita: optText(40) }).partial().optional(),
  energy_class: optText(10), ape_valid_until: optDate, heating_type: optText(200), cooling_type: optText(200), year_built: optNum(1000, 2100),
  occupancy_days_week: optNum(0, 7), opening_hours_week: optNum(0, 168), notes: optText(4000),
});
r.put('/immobili/:siteId', requireFacility, ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  const prop = await propertyBySite(siteId);
  const b = parse(propSchema, req.body || {});
  if (b.lease_id && await financeLive()) {
    const l = await one('SELECT site_id FROM finance.lease_contracts WHERE id=$1', [b.lease_id]);
    if (!l || l.site_id !== siteId) throw bad('Il contratto di affitto indicato non è di questa sede in Payments');
  }
  if (b.landlord_org_id && !await one('SELECT 1 FROM public.organizations WHERE id=$1', [b.landlord_org_id])) throw bad('Legal entity inesistente');
  const cols = Object.keys(b).filter((k) => b[k] !== undefined);
  if (cols.length) await q(`UPDATE properties SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now(), updated_by=$${cols.length + 2} WHERE id=$1`,
    [prop.id, ...cols.map((k) => (k === 'cadastral' ? JSON.stringify(b[k]) : b[k])), req.moduleUser.id]);
  await audit(req, 'FACILITY_IMMOBILE', { module: KEY, entity: 'property', entityId: prop.id, label: `sede ${siteId}`, data: { campi: cols } });
  res.json(await one('SELECT * FROM properties WHERE id=$1', [prop.id]));
}));

// ---- Obblighi di controllo
const oblSchema = z.object({
  title: z.string().trim().min(2).max(200), kind: z.enum(Object.keys(OBLIGATION_KINDS)).default('CONTRATTUALE'),
  interval_months: z.coerce.number().int().min(1).max(240), first_due: DATE, responsible: optText(200),
  asset_type_code: optText(40).transform((v) => v || null), cost_estimate: optNum(0, 10_000_000), notes: optText(2000), active: z.boolean().optional(),
});
r.post('/immobili/:siteId/obblighi', requireFacility, ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  const prop = await propertyBySite(siteId);
  const b = parse(oblSchema, req.body || {});
  const row = await one(`INSERT INTO property_obligations (property_id, title, kind, interval_months, first_due, responsible, asset_type_code, cost_estimate, notes, active, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [prop.id, b.title, b.kind, b.interval_months, b.first_due, b.responsible || null, b.asset_type_code || null, b.cost_estimate ?? null, b.notes || null, b.active ?? true, req.moduleUser.id]);
  const s = await syncObligationPlan(row.id);
  await audit(req, 'FACILITY_OBBLIGO', { module: KEY, entity: 'obligation', entityId: row.id, data: { site_id: siteId, kind: b.kind, interval: b.interval_months, scadenze: s.created } });
  res.status(201).json(row);
}));
r.put('/obblighi/:id', requireFacility, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Obbligo non trovato');
  const cur = await one('SELECT * FROM property_obligations WHERE id=$1', [id]);
  if (!cur) throw notFound('Obbligo non trovato');
  const b = parse(oblSchema.partial(), req.body || {});
  const cols = Object.keys(b).filter((k) => b[k] !== undefined);
  if (cols.length) await q(`UPDATE property_obligations SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((k) => b[k])]);
  await syncObligationPlan(id);
  await audit(req, 'FACILITY_OBBLIGO', { module: KEY, entity: 'obligation', entityId: id, data: { campi: cols } });
  res.json(await one('SELECT * FROM property_obligations WHERE id=$1', [id]));
}));
r.delete('/obblighi/:id', requireFacility, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Obbligo non trovato');
  const done = await one(`SELECT count(*)::int AS n FROM maintenance_plans WHERE obligation_id=$1 AND status='ESEGUITA'`, [id]);
  if (done.n) {   // con storico: si disattiva (le scadenze eseguite restano nel registro)
    await q('UPDATE property_obligations SET active=FALSE, updated_at=now() WHERE id=$1', [id]);
    await syncObligationPlan(id);
    return res.json({ ok: true, disattivato: true });
  }
  await q('DELETE FROM property_obligations WHERE id=$1', [id]);
  await audit(req, 'FACILITY_OBBLIGO_ELIMINATO', { module: KEY, entity: 'obligation', entityId: id });
  res.json({ ok: true });
}));

// ---- Documenti (planimetria pubblicata in Room Planning)
r.post('/immobili/:siteId/documenti', requireFacility, conUpload, ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  const prop = await propertyBySite(siteId);
  const b = parse(z.object({ kind: z.enum(Object.keys(DOC_KINDS)).default('ALTRO'), title: optText(200), valid_until: optDate, notes: optText(2000) }), req.body || {});
  const files = req.files || [];
  if (!files.length) throw bad('Nessun file ricevuto (campo "file")');
  if (b.kind === 'PLANIMETRIA') for (const f of files) if (!isPdf(f.mimetype, f.originalname) && !isRoomImage(f.mimetype, f.originalname)) throw bad(`"${f.originalname}": la planimetria va caricata in PDF o come immagine PNG, JPEG o WebP`);
  const out = [];
  for (const f of files) {
    const stored = await storeBuffer(KEY, 'documenti', `${prop.id}-${Date.now()}-${f.originalname}`, f.mimetype, f.buffer);
    const row = await one(`INSERT INTO property_documents (property_id, kind, title, filename, mime, size, sha256, data, blob_path, valid_until, notes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, property_id, kind, title, filename, mime, size, valid_until, created_at`,
    [prop.id, b.kind, b.title || null, String(f.originalname || 'documento').slice(0, 200), f.mimetype || 'application/octet-stream', stored.size, stored.sha256, stored.data, stored.blob_path, b.valid_until || null, b.notes || null, req.moduleUser.id]);
    out.push({ ...row, buffer: f.buffer });
  }
  // la planimetria più recente va in Room Planning
  let room = null;
  if (b.kind === 'PLANIMETRIA') { const last = out[out.length - 1]; room = await publishPlanToRoom(last, last.buffer); }
  await audit(req, 'FACILITY_DOCUMENTO', { module: KEY, entity: 'property', entityId: prop.id, data: { site_id: siteId, kind: b.kind, file: out.length, room: room?.published || false } });
  res.status(201).json({ documents: out.map(({ buffer, ...d }) => d), room });
}));
async function docWithSite(id) {
  const d = await one('SELECT d.*, p.site_id FROM property_documents d JOIN properties p ON p.id=d.property_id WHERE d.id=$1', [id]);
  if (!d) throw notFound('Documento non trovato');
  return d;
}
r.get('/documenti/:id', ah(async (req, res) => {
  const d = await docWithSite(idOf(req.params.id, 'Documento non trovato'));
  if (!canSeeSite(req, d.site_id)) throw forbidden('Documento di un\'altra sede');
  await sendFile(res, d, { inline: req.query.inline === '1' });
}));
r.post('/documenti/:id/pubblica-room', requireFacility, ah(async (req, res) => {
  const d = await docWithSite(idOf(req.params.id, 'Documento non trovato'));
  if (d.kind !== 'PLANIMETRIA') throw bad('In Room Planning si pubblica solo la planimetria');
  const out = await publishPlanToRoom(d);
  await audit(req, 'FACILITY_PLANIMETRIA_ROOM', { module: KEY, entity: 'document', entityId: d.id, data: { site_id: d.site_id, published: out.published } });
  res.json(out);
}));
r.delete('/documenti/:id', requireFacility, ah(async (req, res) => {
  const d = await docWithSite(idOf(req.params.id, 'Documento non trovato'));
  await q('DELETE FROM property_documents WHERE id=$1', [d.id]);
  await dropBlobs(KEY, [d.blob_path]);
  // se era la planimetria pubblicata, in Room va la più recente rimasta (se non ne restano, Room conserva l'ultima pubblicata: la si toglie da Room Planning)
  let room = null;
  if (d.kind === 'PLANIMETRIA' && d.published_room_at) {
    const next = await one(`SELECT * FROM property_documents WHERE property_id=$1 AND kind='PLANIMETRIA' ORDER BY created_at DESC LIMIT 1`, [d.property_id]);
    if (next) room = await publishPlanToRoom(next);
  }
  await audit(req, 'FACILITY_DOCUMENTO_ELIMINATO', { module: KEY, entity: 'document', entityId: d.id, data: { site_id: d.site_id, kind: d.kind } });
  res.json({ ok: true, room });
}));

// Contratti di affitto della sede in Payments (per collegare l'immobile)
r.get('/immobili/:siteId/contratti', requireFacility, ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  if (!(await financeLive())) return res.json({ finance: false, rows: [] });
  res.json({ finance: true, rows: await many(`SELECT l.id, l.kind, l.unit, l.start_date, l.active, coalesce(l.landlord_name, o.name) AS landlord FROM finance.lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id WHERE l.site_id=$1 ORDER BY l.active DESC, l.start_date DESC`, [siteId]) });
}));

export default r;
