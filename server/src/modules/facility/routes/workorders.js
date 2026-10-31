// Interventi (work order): segnalazioni di guasto (anche dal site manager, con foto) e correttivi da esiti non conformi. Flusso APERTO →
// ASSEGNATO (manutentore interno o Legal entity fornitore) → IN_CORSO ↔ SOSPESO → CHIUSO (con risoluzione, costo, fermo), riapertura;
// scadenza dallo SLA della priorità (impostazioni: URGENTE 24 ore, ALTA 3 giorni, MEDIA 10, BASSA 30, benchmark da confermare);
// notifiche in app a Facility all'apertura, al manutentore all'assegnazione, a chi ha segnalato alla chiusura; cronologia degli eventi.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { PRIORITIES, WO_STATUS } from '../config.js';
import { ah, audit, bad, parse, forbidden, notFound } from '../../../lib/util.js';
import { notify } from '../../../lib/community.js';
import { requireFacility, assertSite, canSeeSite, limitedToSites, mySiteIds, isFacility, isManutentore, isViewer, vendorScope } from '../lib/access.js';
import { KEY, idOf, settings, siteById, addFile, isImageOrPdf, facilityUserIds, siteManagerUserIds, vendorUserIds, suiteUserIdOf } from '../lib/core.js';
import { slaDueAt, slaState, canTransition, workOrderCode } from '../lib/calc.js';
import { conUpload } from './properties.js';

const r = Router();
const W_COLS = `w.*, s.name AS site_name, s.code AS site_code, a.code AS asset_code, a.name AS asset_name, t.name AS asset_type_name, v.name AS vendor_name, au.full_name AS assigned_name,
  (SELECT count(*)::int FROM files f WHERE f.entity='WORK_ORDER' AND f.entity_id=w.id) AS n_files`;
const W_FROM = `work_orders w JOIN public.sites s ON s.id=w.site_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN public.asset_types t ON t.code=a.asset_type_code
  LEFT JOIN public.organizations v ON v.id=w.vendor_org_id LEFT JOIN public.users au ON au.id=w.assigned_user_id`;
const decorate = (w) => ({ ...w, sla: slaState(w), status_label: WO_STATUS[w.status], priority_label: PRIORITIES[w.priority],
  mttr_hours: w.closed_at ? Math.round(((new Date(w.closed_at) - new Date(w.opened_at)) / 3_600_000) * 10) / 10 : null });

function scope(req, w, params) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (limitedToSites(req)) w.push(`w.site_id = ANY(${p(mySiteIds(req))}::int[])`);
  const vs = vendorScope(req);
  if (vs) w.push(`(w.vendor_org_id = ${p(vs.orgId)} OR w.assigned_user_id = ${p(vs.userId)})`);
}
async function loadWo(req, id) {
  const params = [id]; const w = ['w.id=$1'];
  scope(req, w, params);
  const x = await one(`SELECT ${W_COLS} FROM ${W_FROM} WHERE ${w.join(' AND ')}`, params);
  if (!x) {
    if (await one('SELECT 1 FROM work_orders WHERE id=$1', [id])) throw forbidden('Intervento di un\'altra sede o non assegnato a te');
    throw notFound('Intervento non trovato');
  }
  return decorate(x);
}
const event = (c, woId, req, action, from, to, note) => c.query('INSERT INTO work_order_events (wo_id, user_id, user_name, action, from_status, to_status, note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [woId, req.moduleUser?.id || null, req.user?.full_name || null, action, from || null, to || null, note || null]);
// Il manutentore agisce sugli interventi assegnati a lui o alla sua Legal entity (gli interni anche su quelli non assegnati)
const isAssignee = (req, w) => isManutentore(req) && (w.assigned_user_id === req.user.id || (req.vendorOrgId && w.vendor_org_id === req.vendorOrgId) || !req.vendorOrgId);
const canWork = (req, w) => isFacility(req) || isAssignee(req, w);

// Creazione condivisa (anche dalle non conformità del piano)
export async function createWorkOrder(req, d) {
  const imp = await settings();
  const opened = new Date();
  const year = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 4));
  const site = await siteById(d.site_id);
  const row = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`facility-wo-${year}`]);
    const last = (await c.query(`SELECT coalesce(max(substring(code from 9)::int), 0) AS n FROM work_orders WHERE code LIKE $1`, [`WO-${year}-%`])).rows[0].n;
    const status = d.assigned_user_id || d.vendor_org_id ? 'ASSEGNATO' : 'APERTO';
    const w = (await c.query(`INSERT INTO work_orders (code, site_id, asset_id, plan_id, title, description, location, priority, status, reported_by, reported_by_name, assigned_user_id, vendor_org_id, opened_at, assigned_at, due_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [workOrderCode(year, Number(last) + 1), d.site_id, d.asset_id || null, d.plan_id || null, d.title, d.description || null, d.location || null, d.priority, status, req.moduleUser?.id || null, req.user?.full_name || null,
      d.assigned_user_id || null, d.vendor_org_id || null, opened, status === 'ASSEGNATO' ? opened : null, slaDueAt(opened, d.priority, imp.sla_hours)])).rows[0];
    await event(c, w.id, req, 'APERTURA', null, status, d.plan_id ? 'Aperto da un esito non conforme del piano' : null);
    if (d.asset_id && d.priority === 'URGENTE' && d.fuori_servizio) await c.query(`UPDATE assets SET status='FUORI_SERVIZIO', updated_at=now() WHERE id=$1 AND status='IN_SERVIZIO'`, [d.asset_id]);
    return w;
  });
  // notifiche: Facility sempre; per URGENTE anche i site manager della sede; il manutentore se già assegnato
  const dest = new Set(await facilityUserIds());
  if (d.priority === 'URGENTE') for (const id of await siteManagerUserIds(d.site_id)) dest.add(id);
  dest.delete(req.user?.id);
  await notify([...dest], { kind: 'MODULO', module_key: KEY, title: `${d.priority === 'URGENTE' ? 'Intervento URGENTE' : 'Nuovo intervento'}: ${d.title} · ${site.name}`, body: `${row.code}, priorità ${PRIORITIES[d.priority].toLowerCase()}, entro ${new Date(row.due_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}.`, link: `/facility/interventi/${row.id}` });
  if (row.status === 'ASSEGNATO') await notifyAssignee(row, site);
  return row;
}
async function notifyAssignee(w, site) {
  const dest = new Set(w.assigned_user_id ? [w.assigned_user_id] : []);
  for (const id of await vendorUserIds(w.vendor_org_id)) dest.add(id);
  if (!dest.size) return 0;
  return notify([...dest], { kind: 'MODULO', module_key: KEY, title: `Intervento assegnato: ${w.title} · ${site.name}`, body: `${w.code}, priorità ${PRIORITIES[w.priority].toLowerCase()}, entro ${new Date(w.due_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}.`, link: `/facility/interventi/${w.id}` });
}

r.get('/interventi', ah(async (req, res) => {
  const params = []; const w = ['TRUE'];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  scope(req, w, params);
  if (req.query.site_id) { assertSite(req, Number(req.query.site_id)); w.push(`w.site_id=${p(Number(req.query.site_id))}`); }
  if (req.query.status === 'APERTI') w.push(`w.status <> 'CHIUSO'`);
  else if (req.query.status && WO_STATUS[req.query.status]) w.push(`w.status=${p(req.query.status)}`);
  if (req.query.priority && PRIORITIES[req.query.priority]) w.push(`w.priority=${p(req.query.priority)}`);
  if (req.query.asset_id) w.push(`w.asset_id=${p(Number(req.query.asset_id))}`);
  const qs = String(req.query.q || '').trim();
  if (qs) { const v = p(`%${qs}%`); w.push(`(w.code ILIKE ${v} OR w.title ILIKE ${v} OR w.description ILIKE ${v} OR s.name ILIKE ${v} OR a.code ILIKE ${v})`); }
  const rows = (await many(`SELECT ${W_COLS} FROM ${W_FROM} WHERE ${w.join(' AND ')} ORDER BY (w.status='CHIUSO'), array_position(ARRAY['URGENTE','ALTA','MEDIA','BASSA'], w.priority), w.opened_at DESC LIMIT 1000`, params)).map(decorate);
  res.json({ rows, can_manage: isFacility(req), can_report: !isViewer(req) });
}));

r.get('/interventi/:id', ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  const events = await many('SELECT * FROM work_order_events WHERE wo_id=$1 ORDER BY at, id', [w.id]);
  const files = await many(`SELECT id, filename, mime, size, label, created_at FROM files WHERE entity='WORK_ORDER' AND entity_id=$1 ORDER BY id`, [w.id]);
  res.json({ ...w, events, files, can_manage: isFacility(req), can_work: canWork(req, w) && !isViewer(req), can_note: !isViewer(req), next: Object.keys(WO_STATUS).filter((s) => canTransition(w.status, s)) });
}));

// Segnalazione (multipart: foto nel campo "file"). Tutti tranne la consultazione; il site manager solo sulle proprie sedi.
const newSchema = z.object({
  site_id: z.coerce.number().int().positive(), asset_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  title: z.string().trim().min(3).max(200), description: z.string().max(4000).nullable().optional(), location: z.string().max(200).nullable().optional(),
  priority: z.enum(Object.keys(PRIORITIES)).default('MEDIA'), fuori_servizio: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});
r.post('/interventi', conUpload, ah(async (req, res) => {
  if (isViewer(req)) throw forbidden('Profilo in sola consultazione');
  const b = parse(newSchema, req.body || {});
  assertSite(req, b.site_id);
  if (b.asset_id) { const a = await one('SELECT site_id FROM assets WHERE id=$1', [b.asset_id]); if (!a || a.site_id !== b.site_id) throw bad('Il dispositivo non è di questa sede'); }
  for (const f of req.files || []) if (!isImageOrPdf(f)) throw bad(`"${f.originalname}": sono ammesse foto e PDF`);
  const w = await createWorkOrder(req, { ...b, fuori_servizio: String(b.fuori_servizio) === 'true' });
  for (const f of req.files || []) await addFile('WORK_ORDER', w.id, f, 'Foto della segnalazione', req.moduleUser.id);
  await audit(req, 'FACILITY_INTERVENTO_APERTO', { module: KEY, entity: 'work_order', entityId: w.id, label: w.code, data: { site_id: b.site_id, priority: b.priority, foto: (req.files || []).length } });
  res.status(201).json(w);
}));

// Assegnazione (Facility): manutentore interno (utente Suite) e/o Legal entity fornitore
r.post('/interventi/:id/assegna', requireFacility, ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  const b = parse(z.object({ assigned_user_id: z.coerce.number().int().positive().nullable().optional(), vendor_org_id: z.coerce.number().int().positive().nullable().optional(), note: z.string().max(2000).optional() }), req.body || {});
  if (!b.assigned_user_id && !b.vendor_org_id) throw bad('Indica il manutentore (utente) o la Legal entity fornitrice');
  if (w.status === 'CHIUSO') throw bad('Intervento chiuso: riaprilo prima');
  if (b.assigned_user_id && !await one(`SELECT 1 FROM public.users WHERE id=$1 AND status='ACTIVE'`, [b.assigned_user_id])) throw bad('Utente non attivo');
  if (b.vendor_org_id && !await one('SELECT 1 FROM public.organizations WHERE id=$1', [b.vendor_org_id])) throw bad('Legal entity inesistente');
  await tx(async (c) => {
    await c.query(`UPDATE work_orders SET assigned_user_id=$2, vendor_org_id=$3, status=CASE WHEN status='APERTO' THEN 'ASSEGNATO' ELSE status END, assigned_at=now(), updated_at=now() WHERE id=$1`, [w.id, b.assigned_user_id || null, b.vendor_org_id || null]);
    await event(c, w.id, req, 'ASSEGNAZIONE', w.status, w.status === 'APERTO' ? 'ASSEGNATO' : w.status, b.note || null);
  });
  const nw = await loadWo(req, w.id);
  const n = await notifyAssignee(nw, { name: nw.site_name });
  await audit(req, 'FACILITY_INTERVENTO_ASSEGNATO', { module: KEY, entity: 'work_order', entityId: w.id, label: w.code, data: { user: b.assigned_user_id || null, vendor: b.vendor_org_id || null, notifiche: n } });
  res.json({ ...nw, notified: n });
}));

// Cambio di stato (in corso, sospeso, ...): Facility e il manutentore assegnato
r.post('/interventi/:id/stato', ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  if (!canWork(req, w) || isViewer(req)) throw forbidden('Operazione riservata a Facility e al manutentore assegnato');
  const b = parse(z.object({ status: z.enum(['APERTO', 'ASSEGNATO', 'IN_CORSO', 'SOSPESO']), note: z.string().max(2000).optional() }), req.body || {});
  if (!canTransition(w.status, b.status)) throw bad(`Passaggio non ammesso: da ${WO_STATUS[w.status]} a ${WO_STATUS[b.status]}`);
  if (b.status === 'SOSPESO' && !b.note) throw bad('Indica il motivo della sospensione');
  await tx(async (c) => {
    await c.query(`UPDATE work_orders SET status=$2, started_at=CASE WHEN $2='IN_CORSO' AND started_at IS NULL THEN now() ELSE started_at END, updated_at=now() WHERE id=$1`, [w.id, b.status]);
    await event(c, w.id, req, 'STATO', w.status, b.status, b.note || null);
  });
  res.json(await loadWo(req, w.id));
}));

// Chiusura con risoluzione (Facility o manutentore assegnato); MTTR = chiusura - apertura
r.post('/interventi/:id/chiudi', ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  if (!canWork(req, w) || isViewer(req)) throw forbidden('Operazione riservata a Facility e al manutentore assegnato');
  if (w.status === 'CHIUSO') throw bad('Intervento già chiuso');
  const b = parse(z.object({ resolution: z.string().trim().min(3).max(4000), cost: z.coerce.number().min(0).max(10_000_000).nullable().optional(), downtime_hours: z.coerce.number().min(0).max(100_000).nullable().optional(),
    closed_at: z.string().datetime({ offset: true }).optional(), rimetti_in_servizio: z.boolean().optional() }), req.body || {});
  const closedAt = b.closed_at ? new Date(b.closed_at) : new Date();
  if (closedAt < new Date(w.opened_at)) throw bad('La chiusura non può precedere l\'apertura');
  await tx(async (c) => {
    await c.query(`UPDATE work_orders SET status='CHIUSO', resolution=$2, cost=$3, downtime_hours=$4, closed_at=$5, started_at=coalesce(started_at, $5), updated_at=now() WHERE id=$1`, [w.id, b.resolution, b.cost ?? null, b.downtime_hours ?? null, closedAt]);
    await event(c, w.id, req, 'CHIUSURA', w.status, 'CHIUSO', b.resolution);
    if (w.asset_id && b.rimetti_in_servizio !== false) await c.query(`UPDATE assets SET status='IN_SERVIZIO', updated_at=now() WHERE id=$1 AND status='FUORI_SERVIZIO'`, [w.asset_id]);
  });
  const reporter = await suiteUserIdOf(w.reported_by);
  const dest = new Set(await facilityUserIds());
  if (reporter) dest.add(reporter);
  dest.delete(req.user.id);
  await notify([...dest], { kind: 'MODULO', module_key: KEY, title: `Intervento chiuso: ${w.title} · ${w.site_name}`, body: `${w.code}: ${b.resolution.slice(0, 200)}`, link: `/facility/interventi/${w.id}` });
  const out = await loadWo(req, w.id);
  await audit(req, 'FACILITY_INTERVENTO_CHIUSO', { module: KEY, entity: 'work_order', entityId: w.id, label: w.code, data: { mttr_h: out.mttr_hours, cost: b.cost ?? null, sla_ok: !out.sla.late } });
  res.json(out);
}));
r.post('/interventi/:id/riapri', requireFacility, ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  if (w.status !== 'CHIUSO') throw bad('L\'intervento non è chiuso');
  await tx(async (c) => {
    await c.query(`UPDATE work_orders SET status='IN_CORSO', closed_at=NULL, updated_at=now() WHERE id=$1`, [w.id]);
    await event(c, w.id, req, 'RIAPERTURA', 'CHIUSO', 'IN_CORSO', String(req.body?.note || '').slice(0, 2000) || null);
  });
  res.json(await loadWo(req, w.id));
}));
r.post('/interventi/:id/nota', ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  if (isViewer(req)) throw forbidden('Profilo in sola consultazione');
  const note = String(req.body?.note || '').trim();
  if (note.length < 2) throw bad('Scrivi la nota');
  await event({ query: (t, p) => q(t, p) }, w.id, req, 'NOTA', null, null, note.slice(0, 2000));
  res.status(201).json({ ok: true });
}));
r.post('/interventi/:id/files', conUpload, ah(async (req, res) => {
  const w = await loadWo(req, idOf(req.params.id, 'Intervento non trovato'));
  if (isViewer(req)) throw forbidden('Profilo in sola consultazione');
  const out = [];
  for (const f of req.files || []) { if (!isImageOrPdf(f)) throw bad(`"${f.originalname}": sono ammesse foto e PDF`); out.push(await addFile('WORK_ORDER', w.id, f, String(req.body?.label || '').slice(0, 120) || null, req.moduleUser.id)); }
  if (!out.length) throw bad('Nessun file ricevuto (campo "file")');
  res.status(201).json({ files: out });
}));

// Manutentori assegnabili: utenti con grant MANUTENTORE o FACILITY del modulo, e Legal entity fornitrici
r.get('/manutentori', requireFacility, ah(async (_req, res) => {
  const users = await many(`SELECT DISTINCT u.id, u.full_name, u.email, g.profile, o.name AS organization_name FROM public.users u JOIN public.grants g ON g.user_id=u.id AND g.module_key=$1 AND NOT g.proposed
    LEFT JOIN public.people p ON p.id=u.person_id LEFT JOIN public.organizations o ON o.id=coalesce(p.organization_id, u.organization_id)
    WHERE u.status='ACTIVE' AND g.profile IN ('MANUTENTORE','FACILITY','ADMIN') ORDER BY u.full_name`, [KEY]);
  const vendors = await many(`SELECT o.id, o.name, o.kind, o.city, (SELECT count(*)::int FROM assets a WHERE a.vendor_org_id=o.id) AS n_assets FROM public.organizations o
    WHERE o.active AND o.kind NOT IN ('GRUPPO','SOCIETA','TARGET') ORDER BY (SELECT count(*) FROM assets a WHERE a.vendor_org_id=o.id) DESC, o.name LIMIT 300`);
  res.json({ users, vendors });
}));

export default r;
