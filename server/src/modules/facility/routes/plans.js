// Piano delle manutenzioni: scadenze da dispositivi e obblighi degli immobili (filtri per sede, tipo, stato, periodo, esecutore),
// chiusura con esito, rapportino allegato e costo, rigenerazione della successiva; un esito non conforme apre un intervento correttivo;
// un obbligo con costo avvisa Payments. Il site manager conferma solo i controlli di sede (sorveglianza) delle proprie sedi.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { PLAN_KINDS, PLAN_STATUS, OUTCOMES, STREAMS } from '../config.js';
import { ah, audit, bad, parse, forbidden, notFound } from '../../../lib/util.js';
import { sendFile } from '../../../lib/moduleStorage.js';
import { notify } from '../../../lib/community.js';
import { requireFacility, assertSite, canSeeSite, limitedToSites, mySiteIds, isFacility, isSite, isViewer, canExecute, vendorScope } from '../lib/access.js';
import { KEY, idOf, todayRome, closePlan, addFile, removeFile, isImageOrPdf, syncAssetPlans, syncObligationPlan, facilityUserIds, siteManagerUserIds, financeUserIds, vendorUserIds } from '../lib/core.js';
import { effectiveStatus } from '../lib/calc.js';
import { conUpload } from './properties.js';
import { createWorkOrder } from './workorders.js';

const r = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG');

const P_COLS = `p.*, s.name AS site_name, s.code AS site_code, a.code AS asset_code, a.name AS asset_name, a.location AS asset_location, a.vendor_org_id, t.name AS type_name, t.category, t.code AS type_code,
  o.title AS obligation_title, o.kind AS obligation_kind, o.cost_estimate, v.name AS vendor_name, (SELECT count(*)::int FROM files f WHERE f.entity='PLAN' AND f.entity_id=p.id) AS n_files`;
const P_FROM = `maintenance_plans p JOIN public.sites s ON s.id=p.site_id LEFT JOIN assets a ON a.id=p.asset_id LEFT JOIN public.asset_types t ON t.code=a.asset_type_code
  LEFT JOIN property_obligations o ON o.id=p.obligation_id LEFT JOIN public.organizations v ON v.id=a.vendor_org_id`;

function scope(req, w, params) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (limitedToSites(req)) w.push(`p.site_id = ANY(${p(mySiteIds(req))}::int[])`);
  const vs = vendorScope(req);
  if (vs) w.push(`a.vendor_org_id = ${p(vs.orgId)}`);
}
const decorate = (today) => (p) => ({ ...p, effective_status: effectiveStatus(p, today), days: Math.round((Date.parse(p.due_date) - Date.parse(today)) / 86_400_000), kind_label: PLAN_KINDS[p.kind], stream_label: STREAMS[p.stream] });

export async function listPlans(req, query = {}, { limit = 1000 } = {}) {
  const params = []; const w = ['TRUE'];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  scope(req, w, params);
  if (query.site_id) { assertSite(req, Number(query.site_id)); w.push(`p.site_id=${p(Number(query.site_id))}`); }
  if (query.kind && PLAN_KINDS[query.kind]) w.push(`p.kind=${p(query.kind)}`);
  if (query.stream && STREAMS[query.stream]) w.push(`p.stream=${p(query.stream)}`);
  if (query.category) w.push(`t.category=${p(String(query.category))}`);
  if (query.type) w.push(`a.asset_type_code=${p(String(query.type))}`);
  if (query.performer) w.push(`p.performer=${p(String(query.performer))}`);
  if (query.asset_id) w.push(`p.asset_id=${p(Number(query.asset_id))}`);
  if (query.status === 'APERTE') w.push(`p.status IN ('PIANIFICATA','SCADUTA')`);
  else if (query.status === 'SCADUTA') w.push(`p.status IN ('PIANIFICATA','SCADUTA') AND p.due_date < CURRENT_DATE`);
  else if (query.status === 'PIANIFICATA') w.push(`p.status IN ('PIANIFICATA','SCADUTA') AND p.due_date >= CURRENT_DATE`);
  else if (query.status && PLAN_STATUS[query.status]) w.push(`p.status=${p(query.status)}`);
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) w.push(`coalesce(p.done_at, p.due_date) >= ${p(query.from)}::date`);
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) w.push(`coalesce(p.done_at, p.due_date) <= ${p(query.to)}::date`);
  const qs = String(query.q || '').trim();
  if (qs) { const v = p(`%${qs}%`); w.push(`(p.title ILIKE ${v} OR a.code ILIKE ${v} OR s.name ILIKE ${v} OR t.name ILIKE ${v})`); }
  params.push(Math.min(5000, Number(query.limit) || limit));
  const today = todayRome();
  const order = query.status === 'ESEGUITA' ? 'p.done_at DESC, p.id DESC' : 'p.due_date, s.name, p.id';
  return (await many(`SELECT ${P_COLS} FROM ${P_FROM} WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT $${params.length}`, params)).map(decorate(today));
}

r.get('/piano', ah(async (req, res) => {
  const rows = await listPlans(req, { status: 'APERTE', ...req.query });
  res.json({ rows, can_edit: isFacility(req), can_execute: canExecute(req), is_site: isSite(req) });
}));

async function loadPlan(req, id) {
  const params = [id]; const w = ['p.id=$1'];
  scope(req, w, params);
  const pl = await one(`SELECT ${P_COLS} FROM ${P_FROM} WHERE ${w.join(' AND ')}`, params);
  if (!pl) {
    if (await one('SELECT 1 FROM maintenance_plans WHERE id=$1', [id])) throw forbidden('Scadenza di un\'altra sede o di un altro manutentore');
    throw notFound('Scadenza non trovata');
  }
  return decorate(todayRome())(pl);
}
// Chi chiude: Facility e manutentori; il site manager solo le sorveglianze di sede delle proprie sedi
const canClose = (req, pl) => (canExecute(req) && !isViewer(req)) || (isSite(req) && pl.performer === 'SEDE' && canSeeSite(req, pl.site_id));

r.get('/piano/:id', ah(async (req, res) => {
  const pl = await loadPlan(req, idOf(req.params.id, 'Scadenza non trovata'));
  const files = await many(`SELECT id, filename, mime, size, label, created_at FROM files WHERE entity='PLAN' AND entity_id=$1 ORDER BY id`, [pl.id]);
  const history = pl.asset_id ? await many(`SELECT id, stream, kind, due_date, done_at, status, outcome, cost, done_by_name FROM maintenance_plans WHERE asset_id=$1 AND stream=$2 AND id<>$3 ORDER BY due_date DESC LIMIT 20`, [pl.asset_id, pl.stream, pl.id])
    : await many(`SELECT id, stream, kind, due_date, done_at, status, outcome, cost, done_by_name FROM maintenance_plans WHERE obligation_id=$1 AND id<>$2 ORDER BY due_date DESC LIMIT 20`, [pl.obligation_id, pl.id]);
  const today = todayRome();
  res.json({ ...pl, files, history: history.map((h) => ({ ...h, effective_status: effectiveStatus(h, today) })), can_close: ['PIANIFICATA', 'SCADUTA'].includes(pl.status) && canClose(req, pl), can_edit: isFacility(req), outcomes: OUTCOMES });
}));

// Chiusura con esito (multipart: campo "file" facoltativo per il rapportino)
const closeSchema = z.object({
  done_at: DATE.optional(), outcome: z.enum(Object.keys(OUTCOMES)), cost: z.coerce.number().min(0).max(10_000_000).nullable().optional().or(z.literal('').transform(() => null)),
  notes: z.string().max(4000).nullable().optional(), open_work_order: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});
r.post('/piano/:id/chiudi', conUpload, ah(async (req, res) => {
  const pl = await loadPlan(req, idOf(req.params.id, 'Scadenza non trovata'));
  if (!['PIANIFICATA', 'SCADUTA'].includes(pl.status)) throw bad('La scadenza non è aperta');
  if (!canClose(req, pl)) throw forbidden(isSite(req) ? 'Il site manager conferma solo i controlli di sede (sorveglianza) della propria sede' : 'Operazione riservata a Facility e ai manutentori');
  const b = parse(closeSchema, req.body || {});
  const today = todayRome();
  const doneAt = b.done_at || today;
  if (doneAt > today) throw bad('La data di esecuzione non può essere futura');
  for (const f of req.files || []) if (!isImageOrPdf(f)) throw bad(`"${f.originalname}": il rapportino va caricato in PDF o come immagine`);
  let reportId = null;
  for (const f of req.files || []) { const x = await addFile('PLAN', pl.id, f, 'Rapportino', req.moduleUser.id); reportId = reportId || x.id; }
  const next = await tx((c) => closePlan(c, pl, { done_at: doneAt, outcome: b.outcome, cost: b.cost, notes: b.notes, report_file_id: reportId }, req.moduleUser));
  // esito non conforme: intervento correttivo (salvo rinuncia esplicita)
  let wo = null;
  const wantWo = String(b.open_work_order ?? 'true') !== 'false';
  if (b.outcome === 'NON_CONFORME' && wantWo) {
    wo = await createWorkOrder(req, { site_id: pl.site_id, asset_id: pl.asset_id, plan_id: pl.id, title: `Non conformità: ${pl.title}`, description: b.notes || `Esito non conforme del ${pl.kind_label.toLowerCase()} del ${doneAt}.`, priority: 'ALTA', location: pl.asset_location, vendor_org_id: pl.vendor_org_id || null });
    await q('UPDATE maintenance_plans SET work_order_id=$2 WHERE id=$1', [pl.id, wo.id]);
  }
  // obbligo con costo: proposta a Payments (avviso ai profili CEO/CFO/Support, nessuna istanza automatica: serve l'IBAN del beneficiario)
  let payments = 0;
  const cost = b.cost ?? pl.cost_estimate;
  if (pl.obligation_id && cost > 0) {
    const ids = await financeUserIds();
    payments = await notify(ids, { kind: 'MODULO', module_key: 'finance', title: `Costo da pagare: ${pl.title} · ${pl.site_name}`, body: `Obbligo dell'immobile eseguito il ${doneAt}, costo ${Number(cost).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}. Crea l'istanza di pagamento in Payments con la fattura del fornitore.`, link: '/finance/istanze' });
  }
  await audit(req, 'FACILITY_SCADENZA_CHIUSA', { module: KEY, entity: 'plan', entityId: pl.id, data: { site_id: pl.site_id, outcome: b.outcome, done_at: doneAt, next_id: next?.id || null, work_order: wo?.id || null, payments } });
  res.json({ ok: true, next, work_order: wo, payments_notified: payments });
}));

// Spostamento, note, annullamento (Facility)
r.put('/piano/:id', requireFacility, ah(async (req, res) => {
  const pl = await loadPlan(req, idOf(req.params.id, 'Scadenza non trovata'));
  const b = parse(z.object({ due_date: DATE.optional(), notes: z.string().max(4000).nullable().optional(), title: z.string().trim().min(2).max(200).optional() }), req.body || {});
  if (!['PIANIFICATA', 'SCADUTA'].includes(pl.status)) throw bad('Si modificano solo le scadenze aperte');
  await q(`UPDATE maintenance_plans SET due_date=coalesce($2, due_date), notes=CASE WHEN $3::boolean THEN $4 ELSE notes END, title=coalesce($5, title),
    status=CASE WHEN coalesce($2, due_date) >= CURRENT_DATE THEN 'PIANIFICATA' ELSE status END, updated_at=now() WHERE id=$1`, [pl.id, b.due_date || null, b.notes !== undefined, b.notes ?? null, b.title || null]);
  await audit(req, 'FACILITY_SCADENZA', { module: KEY, entity: 'plan', entityId: pl.id, data: b });
  res.json(await loadPlan(req, pl.id));
}));
r.post('/piano/:id/annulla', requireFacility, ah(async (req, res) => {
  const pl = await loadPlan(req, idOf(req.params.id, 'Scadenza non trovata'));
  if (!['PIANIFICATA', 'SCADUTA'].includes(pl.status)) throw bad('La scadenza non è aperta');
  await q(`UPDATE maintenance_plans SET status='ANNULLATA', notes=coalesce(notes || ' · ', '') || $2, updated_at=now() WHERE id=$1`, [pl.id, `annullata: ${String(req.body?.motivo || 'senza motivo').slice(0, 300)}`]);
  await audit(req, 'FACILITY_SCADENZA_ANNULLATA', { module: KEY, entity: 'plan', entityId: pl.id });
  res.json({ ok: true });
}));

// Rigenerazione del piano (Facility): serie mancanti di tutti i dispositivi in servizio e degli obblighi attivi
r.post('/piano/genera', requireFacility, ah(async (req, res) => {
  let created = 0;
  for (const a of await many(`SELECT id FROM assets WHERE status <> 'DISMESSO'`)) created += (await syncAssetPlans(a.id)).created;
  for (const o of await many('SELECT id FROM property_obligations WHERE active')) created += (await syncObligationPlan(o.id)).created;
  await audit(req, 'FACILITY_PIANO_GENERATO', { module: KEY, entity: 'plan', data: { created } });
  res.json({ ok: true, created });
}));

// Allegati delle scadenze
r.post('/piano/:id/files', conUpload, ah(async (req, res) => {
  const pl = await loadPlan(req, idOf(req.params.id, 'Scadenza non trovata'));
  if (!(isFacility(req) || canClose(req, pl))) throw forbidden();
  const out = [];
  for (const f of req.files || []) { if (!isImageOrPdf(f)) throw bad(`"${f.originalname}": sono ammessi PDF e immagini`); out.push(await addFile('PLAN', pl.id, f, String(req.body?.label || '').slice(0, 120) || 'Rapportino', req.moduleUser.id)); }
  if (!out.length) throw bad('Nessun file ricevuto (campo "file")');
  if (!pl.report_file_id) await q('UPDATE maintenance_plans SET report_file_id=$2 WHERE id=$1', [pl.id, out[0].id]);
  res.status(201).json({ files: out });
}));
r.get('/files/:id', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1', [idOf(req.params.id, 'Allegato non trovato')]);
  if (!f) throw notFound('Allegato non trovato');
  const owner = f.entity === 'PLAN' ? await one('SELECT site_id FROM maintenance_plans WHERE id=$1', [f.entity_id]) : await one('SELECT site_id FROM work_orders WHERE id=$1', [f.entity_id]);
  if (owner && !canSeeSite(req, owner.site_id)) throw forbidden();
  await sendFile(res, f, { inline: req.query.inline === '1' });
}));
r.delete('/files/:id', requireFacility, ah(async (req, res) => { await removeFile(idOf(req.params.id, 'Allegato non trovato')); res.json({ ok: true }); }));

export { facilityUserIds, siteManagerUserIds, vendorUserIds };
export default r;
