// Dispositivi installati nelle sedi (tipi dal Catalogo dispositivi di Amministrazione): elenco con filtri, scheda con registro (storico
// di controlli, manutenzioni e interventi), creazione con codice interno e QR, modifica (le scadenze del piano si riallineano), dismissione,
// QR in PNG/SVG che apre la scheda e foglio di etichette in PDF per la sede.
import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { ASSET_STATUS } from '../config.js';
import { config as appConfig } from '../../../config.js';
import { ah, audit, bad, parse, forbidden, notFound } from '../../../lib/util.js';
import { requireFacility, assertSite, canSeeSite, limitedToSites, mySiteIds, isFacility, vendorScope } from '../lib/access.js';
import { KEY, idOf, siteById, assetType, syncAssetPlans, todayRome } from '../lib/core.js';
import { effectiveStatus } from '../lib/calc.js';
import { etichettePdf } from '../lib/export.js';

const r = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG');
const optDate = DATE.nullable().optional().or(z.literal('').transform(() => null));
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const optInt = (min, max) => z.coerce.number().int().min(min).max(max).nullable().optional().or(z.literal('').transform(() => null));

export const qrUrl = (a) => `${appConfig.baseUrl}/facility/qr/${a.qr_code}`;
const A_COLS = `a.*, t.name AS type_name, t.category, t.check_kind, t.surveillance_months AS type_surveillance_months, t.check_interval_months AS type_check_interval_months,
  t.maintenance_interval_months AS type_maintenance_interval_months, t.legal_reference, t.requires_certified_vendor, s.name AS site_name, s.code AS site_code, v.name AS vendor_name`;
const A_FROM = `assets a JOIN public.asset_types t ON t.code=a.asset_type_code JOIN public.sites s ON s.id=a.site_id LEFT JOIN public.organizations v ON v.id=a.vendor_org_id`;

function scopeWhere(req, w, params) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (limitedToSites(req)) w.push(`a.site_id = ANY(${p(mySiteIds(req))}::int[])`);
  const vs = vendorScope(req);
  if (vs) w.push(`a.vendor_org_id = ${p(vs.orgId)}`);
}
async function loadAsset(req, id) {
  const params = [id]; const w = ['a.id=$1'];
  scopeWhere(req, w, params);
  const a = await one(`SELECT ${A_COLS} FROM ${A_FROM} WHERE ${w.join(' AND ')}`, params);
  if (!a) {
    if (await one('SELECT 1 FROM assets WHERE id=$1', [id])) throw forbidden('Dispositivo di un\'altra sede o di un altro manutentore');
    throw notFound('Dispositivo non trovato');
  }
  return a;
}

r.get('/dispositivi', ah(async (req, res) => {
  const params = []; const w = ['TRUE'];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  scopeWhere(req, w, params);
  if (req.query.site_id) { assertSite(req, Number(req.query.site_id)); w.push(`a.site_id=${p(Number(req.query.site_id))}`); }
  if (req.query.category) w.push(`t.category=${p(String(req.query.category))}`);
  if (req.query.type) w.push(`a.asset_type_code=${p(String(req.query.type))}`);
  if (req.query.status && ASSET_STATUS[req.query.status]) w.push(`a.status=${p(req.query.status)}`); else if (req.query.all !== '1') w.push(`a.status <> 'DISMESSO'`);
  if (req.query.non_conformi === '1') w.push(`a.last_outcome='NON_CONFORME'`);
  const qs = String(req.query.q || '').trim();
  if (qs) { const v = p(`%${qs}%`); w.push(`(a.code ILIKE ${v} OR a.name ILIKE ${v} OR a.brand ILIKE ${v} OR a.model ILIKE ${v} OR a.serial ILIKE ${v} OR a.location ILIKE ${v} OR t.name ILIKE ${v})`); }
  const rows = await many(`SELECT ${A_COLS},
      (SELECT count(*)::int FROM maintenance_plans pl WHERE pl.asset_id=a.id AND pl.status IN ('PIANIFICATA','SCADUTA') AND pl.due_date < CURRENT_DATE) AS n_overdue,
      (SELECT count(*)::int FROM work_orders wo WHERE wo.asset_id=a.id AND wo.status <> 'CHIUSO') AS n_wo_open
    FROM ${A_FROM} WHERE ${w.join(' AND ')} ORDER BY s.sort_order, s.name, t.category, a.code LIMIT 2000`, params);
  res.json({ rows, can_edit: isFacility(req) });
}));

r.get('/dispositivi/qr/:token', ah(async (req, res) => {
  const a = await one('SELECT id, site_id FROM assets WHERE qr_code=$1', [String(req.params.token)]);
  if (!a) throw notFound('QR non riconosciuto');
  if (!canSeeSite(req, a.site_id)) throw forbidden('Dispositivo di un\'altra sede');
  res.json({ id: a.id });
}));

// Scheda e registro del dispositivo
r.get('/dispositivi/:id', ah(async (req, res) => {
  const a = await loadAsset(req, idOf(req.params.id, 'Dispositivo non trovato'));
  const today = todayRome();
  const plans = (await many(`SELECT p.*, (SELECT count(*)::int FROM files f WHERE f.entity='PLAN' AND f.entity_id=p.id) AS n_files FROM maintenance_plans p WHERE p.asset_id=$1 ORDER BY (p.status IN ('PIANIFICATA','SCADUTA')) DESC, coalesce(p.done_at, p.due_date) DESC, p.id DESC`, [a.id]))
    .map((p) => ({ ...p, effective_status: effectiveStatus(p, today) }));
  const wos = await many('SELECT id, code, title, priority, status, opened_at, closed_at, cost, downtime_hours, resolution FROM work_orders WHERE asset_id=$1 ORDER BY opened_at DESC', [a.id]);
  const cost = plans.reduce((s, p) => s + Number(p.cost || 0), 0) + wos.reduce((s, w) => s + Number(w.cost || 0), 0);
  res.json({ ...a, qr_url: qrUrl(a), status_label: ASSET_STATUS[a.status], plans, work_orders: wos, costo_totale: Math.round(cost * 100) / 100, can_edit: isFacility(req) });
}));

r.get('/dispositivi/:id/qr.:fmt(png|svg)', ah(async (req, res) => {
  const a = await loadAsset(req, idOf(req.params.id, 'Dispositivo non trovato'));
  if (req.params.fmt === 'svg') { res.type('image/svg+xml').send(await QRCode.toString(qrUrl(a), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })); return; }
  res.type('image/png').send(await QRCode.toBuffer(qrUrl(a), { margin: 1, width: Math.min(1200, Math.max(120, Number(req.query.size) || 360)), errorCorrectionLevel: 'M' }));
}));

// Etichette con QR (foglio A4, 2 colonne per 7 righe) per una sede o per un elenco
r.get('/etichette.pdf', ah(async (req, res) => {
  const params = []; const w = [`a.status <> 'DISMESSO'`];
  scopeWhere(req, w, params);
  if (req.query.site_id) { assertSite(req, Number(req.query.site_id)); params.push(Number(req.query.site_id)); w.push(`a.site_id=$${params.length}`); }
  if (req.query.ids) { params.push(String(req.query.ids).split(',').map(Number).filter(Boolean)); w.push(`a.id = ANY($${params.length}::int[])`); }
  const rows = await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE ${w.join(' AND ')} ORDER BY s.name, a.code LIMIT 600`, params);
  if (!rows.length) throw bad('Nessun dispositivo da etichettare');
  const pdf = await etichettePdf(rows.map((a) => ({ ...a, qr_url: qrUrl(a) })));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="Etichette QR dispositivi.pdf"`);
  res.send(pdf);
}));

const assetSchema = z.object({
  site_id: z.coerce.number().int().positive(), asset_type_code: z.string().trim().min(2).max(40), code: optText(40), name: optText(200),
  brand: optText(120), model: optText(120), serial: optText(120), location: optText(200), installed_at: optDate, warranty_until: optDate,
  vendor_org_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)), contract_ref: optText(200),
  status: z.enum(Object.keys(ASSET_STATUS)).optional(), surveillance_months: optInt(1, 120), check_interval_months: optInt(1, 240), maintenance_interval_months: optInt(1, 240),
  next_check_due: optDate, next_maintenance_due: optDate, notes: optText(4000),
});
const COLS = ['site_id', 'asset_type_code', 'code', 'name', 'brand', 'model', 'serial', 'location', 'installed_at', 'warranty_until', 'vendor_org_id', 'contract_ref', 'status', 'surveillance_months', 'check_interval_months', 'maintenance_interval_months', 'next_check_due', 'next_maintenance_due', 'notes'];

async function nextCode(site, type) {
  const abbr = type.code.split('_')[0].slice(0, 4);
  const prefix = `${site.code}-${abbr}-`;
  const rows = await many('SELECT code FROM assets WHERE code LIKE $1', [`${prefix}%`]);
  let n = rows.reduce((m, x) => Math.max(m, Number(x.code.slice(prefix.length)) || 0), 0) + 1;
  while (await one('SELECT 1 FROM assets WHERE code=$1', [`${prefix}${String(n).padStart(3, '0')}`])) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

r.post('/dispositivi', requireFacility, ah(async (req, res) => {
  const b = parse(assetSchema, req.body || {});
  const site = await siteById(b.site_id);
  const type = await assetType(b.asset_type_code);
  if (!type.active) throw bad('Il tipo di dispositivo è disattivato nel Catalogo dispositivi');
  if (b.vendor_org_id && !await one('SELECT 1 FROM public.organizations WHERE id=$1', [b.vendor_org_id])) throw bad('Manutentore inesistente: scegli una Legal entity');
  b.code = b.code || await nextCode(site, type);
  if (await one('SELECT 1 FROM assets WHERE code=$1', [b.code])) throw bad(`Il codice ${b.code} è già usato`);
  const cols = COLS.filter((k) => b[k] !== undefined);
  const out = await tx(async (c) => {
    const a = (await c.query(`INSERT INTO assets (${cols.join(',')}, qr_code, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 2}) RETURNING id`,
      [...cols.map((k) => b[k]), crypto.randomBytes(12).toString('base64url'), req.moduleUser.id])).rows[0];
    const s = await syncAssetPlans(a.id, { client: c });
    return { id: a.id, scadenze: s.created };
  });
  await audit(req, 'FACILITY_DISPOSITIVO', { module: KEY, entity: 'asset', entityId: out.id, label: b.code, data: { site_id: b.site_id, type: b.asset_type_code, scadenze: out.scadenze } });
  res.status(201).json({ ...(await loadAsset(req, out.id)), scadenze_create: out.scadenze });
}));

r.put('/dispositivi/:id', requireFacility, ah(async (req, res) => {
  const cur = await loadAsset(req, idOf(req.params.id, 'Dispositivo non trovato'));
  const b = parse(assetSchema.partial(), req.body || {});
  if (b.asset_type_code && b.asset_type_code !== cur.asset_type_code) await assetType(b.asset_type_code);
  if (b.site_id && b.site_id !== cur.site_id) await siteById(b.site_id);
  if (b.code && b.code !== cur.code && await one('SELECT 1 FROM assets WHERE code=$1 AND id<>$2', [b.code, cur.id])) throw bad(`Il codice ${b.code} è già usato`);
  const cols = COLS.filter((k) => b[k] !== undefined);
  await tx(async (c) => {
    if (cols.length) await c.query(`UPDATE assets SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [cur.id, ...cols.map((k) => b[k])]);
    if (b.site_id && b.site_id !== cur.site_id) await c.query(`UPDATE maintenance_plans SET site_id=$2 WHERE asset_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [cur.id, b.site_id]);
    // cambio della periodicità o del tipo: le serie aperte si ricreano con la nuova periodicità
    const periodChanged = ['asset_type_code', 'surveillance_months', 'check_interval_months', 'maintenance_interval_months'].some((k) => b[k] !== undefined && String(b[k] ?? '') !== String(cur[k] ?? ''));
    if (periodChanged) await c.query(`UPDATE maintenance_plans SET status='ANNULLATA', notes=coalesce(notes || ' · ', '') || 'periodicità cambiata', updated_at=now() WHERE asset_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [cur.id]);
    // date indicate a mano: spostano la scadenza aperta della serie
    if (b.next_check_due && !periodChanged) await c.query(`UPDATE maintenance_plans SET due_date=$2, status='PIANIFICATA', updated_at=now() WHERE asset_id=$1 AND stream='CONTROLLO' AND status IN ('PIANIFICATA','SCADUTA')`, [cur.id, b.next_check_due]);
    if (b.next_maintenance_due && !periodChanged) await c.query(`UPDATE maintenance_plans SET due_date=$2, status='PIANIFICATA', updated_at=now() WHERE asset_id=$1 AND stream='MANUTENZIONE' AND status IN ('PIANIFICATA','SCADUTA')`, [cur.id, b.next_maintenance_due]);
    await syncAssetPlans(cur.id, { client: c });
  });
  await audit(req, 'FACILITY_DISPOSITIVO', { module: KEY, entity: 'asset', entityId: cur.id, label: cur.code, data: { campi: cols } });
  res.json(await loadAsset(req, cur.id));
}));

// Eliminazione: senza storico si elimina, con storico diventa DISMESSO (il registro resta)
r.delete('/dispositivi/:id', requireFacility, ah(async (req, res) => {
  const a = await loadAsset(req, idOf(req.params.id, 'Dispositivo non trovato'));
  const hist = await one(`SELECT (SELECT count(*) FROM maintenance_plans WHERE asset_id=$1 AND status='ESEGUITA') + (SELECT count(*) FROM work_orders WHERE asset_id=$1) AS n`, [a.id]);
  if (Number(hist.n)) {
    await tx(async (c) => { await c.query(`UPDATE assets SET status='DISMESSO', updated_at=now() WHERE id=$1`, [a.id]); await syncAssetPlans(a.id, { client: c }); });
    await audit(req, 'FACILITY_DISPOSITIVO_DISMESSO', { module: KEY, entity: 'asset', entityId: a.id, label: a.code });
    return res.json({ ok: true, dismesso: true });
  }
  await q('DELETE FROM assets WHERE id=$1', [a.id]);
  await audit(req, 'FACILITY_DISPOSITIVO_ELIMINATO', { module: KEY, entity: 'asset', entityId: a.id, label: a.code });
  res.json({ ok: true });
}));

// Catalogo (lettura per il form): tipi attivi, filtrabili per tipologia di sede
r.get('/catalogo', ah(async (req, res) => {
  const kind = req.query.site_kind ? String(req.query.site_kind) : null;
  const rows = await many(`SELECT * FROM public.asset_types WHERE active ${kind ? `AND (cardinality(applies_to_kinds)=0 OR $1 = ANY(applies_to_kinds))` : ''} ORDER BY category, sort, name`, kind ? [kind] : []);
  res.json(rows);
}));

export default r;
