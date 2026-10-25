import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse, forbidden, todayRome } from '../lib/util.js';
import { requireWrite, canEditSite } from '../lib/access.js';
import { config } from '../config.js';
import { bookToPptx } from '../lib/exports.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
const KIND_LABEL = { LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', SERVICE: 'Struttura service', HEADQUARTER: 'Sede direzionale', ALTRO: 'Altro' };

r.get('/zones', ah(async (_req, res) => res.json(await many('SELECT * FROM exposure_zones ORDER BY sort_order'))));

// Standard espositivo
r.get('/standards', ah(async (_req, res) => res.json(await many('SELECT s.*, z.name AS zone_name, z.code AS zone_code FROM exposure_standards s JOIN exposure_zones z ON z.id=s.zone_id ORDER BY s.site_kind, z.sort_order, s.sort_order'))));
const stdSchema = z.object({ site_kind: z.string(), zone_id: z.number().int(), material: z.string().min(2), format: z.string().nullable().optional(), quantity: z.number().int().min(1).default(1), rule: z.string().nullable().optional(), mandatory: z.boolean().default(true), sort_order: z.number().int().default(100) });
r.post('/standards', requireWrite, ah(async (req, res) => {
  const d = parse(stdSchema, req.body);
  const row = await one('INSERT INTO exposure_standards(site_kind, zone_id, material, format, quantity, rule, mandatory, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [d.site_kind, d.zone_id, d.material, d.format || null, d.quantity, d.rule || null, d.mandatory, d.sort_order]);
  await audit(req, 'STANDARD_CREATE', 'exposure_standard', row.id, d);
  res.status(201).json(row);
}));
r.put('/standards/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id); const d = parse(stdSchema.partial(), req.body);
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE exposure_standards SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  res.json({ ok: true });
}));
r.delete('/standards/:id', requireWrite, ah(async (req, res) => { await q('DELETE FROM exposure_standards WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true }); }));

// Sintesi per sede (conformità)
r.get('/overview', ah(async (_req, res) => {
  const rows = await many(`SELECT s.id, s.code, s.name, s.kind, s.city, s.manager, s.active,
      count(e.id)::int AS total, count(e.id) FILTER (WHERE e.status='INSTALLATO')::int AS ok, count(e.id) FILTER (WHERE e.status='NON_CONFORME')::int AS bad,
      count(e.id) FILTER (WHERE e.status='DA_SOSTITUIRE')::int AS to_replace, count(e.id) FILTER (WHERE e.status='DA_INSTALLARE')::int AS to_install,
      max(e.checked_at) AS last_check,
      (SELECT count(*)::int FROM exposure_standards st WHERE st.site_kind IN ('TUTTE', s.kind) AND st.mandatory) AS standard_required
    FROM sites_v s LEFT JOIN exposure_items e ON e.site_id=s.id AND e.status<>'RIMOSSO' WHERE s.active AND s.in_network GROUP BY s.id, s.code, s.name, s.kind, s.city, s.manager, s.active, s.sort_order ORDER BY s.sort_order, s.name`);
  res.json(rows.map((x) => ({ ...x, kind_label: KIND_LABEL[x.kind], compliance_pct: x.total ? Math.round((x.ok / x.total) * 100) : 0 })));
}));

// Book di una sede
r.get('/sites/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const site = await one('SELECT * FROM sites_v WHERE id=$1', [id]);
  if (!site) throw notFound();
  const items = await many(`SELECT e.*, z.name AS zone_name, z.code AS zone_code, z.sort_order AS zone_order, st.rule, st.mandatory, p.name AS promotion_name, p.claim AS promotion_claim,
      (SELECT count(*)::int FROM exposure_photos ph WHERE ph.item_id=e.id) AS photos
    FROM exposure_items e JOIN exposure_zones z ON z.id=e.zone_id LEFT JOIN exposure_standards st ON st.id=e.standard_id LEFT JOIN promotions p ON p.id=e.promotion_id
    WHERE e.site_id=$1 ORDER BY z.sort_order, st.sort_order NULLS LAST, e.id`, [id]);
  const missing = await many(`SELECT st.*, z.name AS zone_name FROM exposure_standards st JOIN exposure_zones z ON z.id=st.zone_id WHERE st.site_kind IN ('TUTTE', $2) AND NOT EXISTS (SELECT 1 FROM exposure_items e WHERE e.site_id=$1 AND e.standard_id=st.id AND e.status<>'RIMOSSO') ORDER BY z.sort_order, st.sort_order`, [id, site.kind]);
  const photos = await many('SELECT id, item_id, filename, mime, size, taken_at, uploaded_at FROM exposure_photos WHERE site_id=$1 ORDER BY uploaded_at DESC', [id]);
  res.json({ site: { ...site, kind_label: KIND_LABEL[site.kind] }, items, missing, photos, can_edit: canEditSite(req.user, id) });
}));

// Applica lo standard alla sede (crea le voci mancanti)
r.post('/sites/:id/apply-standard', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditSite(req.user, id)) throw forbidden();
  const site = await one('SELECT * FROM sites_v WHERE id=$1', [id]);
  if (!site) throw notFound();
  const promo = await one('SELECT id, claim FROM promotions WHERE year=date_part(\'year\', CURRENT_DATE) AND month=date_part(\'month\', CURRENT_DATE) AND status<>\'ANNULLATA\' ORDER BY id LIMIT 1');
  const missing = await many(`SELECT st.* FROM exposure_standards st WHERE st.site_kind IN ('TUTTE', $2) AND NOT EXISTS (SELECT 1 FROM exposure_items e WHERE e.site_id=$1 AND e.standard_id=st.id AND e.status<>'RIMOSSO')`, [id, site.kind]);
  for (const st of missing) {
    const isPromo = /promo del mese/i.test(st.material);
    await q('INSERT INTO exposure_items(site_id, zone_id, standard_id, material, format, quantity, promotion_id, content, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'DA_INSTALLARE\')', [id, st.zone_id, st.id, st.material, st.format, st.quantity, isPromo ? promo?.id || null : null, isPromo ? promo?.claim || null : null]);
  }
  await audit(req, 'EXPOSURE_APPLY_STANDARD', 'site', id, { created: missing.length });
  res.json({ ok: true, created: missing.length });
}));

const itemSchema = z.object({ zone_id: z.number().int(), material: z.string().min(2), format: z.string().nullable().optional(), quantity: z.number().int().min(1).default(1), promotion_id: z.number().int().nullable().optional(), content: z.string().nullable().optional(), valid_from: z.string().nullable().optional(), valid_to: z.string().nullable().optional(), status: z.enum(['DA_INSTALLARE', 'INSTALLATO', 'DA_SOSTITUIRE', 'RIMOSSO', 'NON_CONFORME']).optional(), checked_at: z.string().nullable().optional(), checked_by: z.string().nullable().optional(), notes: z.string().nullable().optional(), standard_id: z.number().int().nullable().optional() });
const clean = (d) => { for (const k of Object.keys(d)) if (d[k] === '') d[k] = null; return d; };

r.post('/sites/:id/items', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditSite(req.user, id)) throw forbidden();
  const d = clean(parse(itemSchema, req.body));
  const cols = ['site_id', ...Object.keys(d)];
  const row = await one(`INSERT INTO exposure_items(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, [id, ...Object.keys(d).map((c) => d[c])]);
  await audit(req, 'EXPOSURE_ITEM_CREATE', 'exposure_item', row.id, { site_id: id, material: d.material });
  res.status(201).json(row);
}));
r.put('/items/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const it = await one('SELECT site_id FROM exposure_items WHERE id=$1', [id]);
  if (!it) throw notFound();
  if (!canEditSite(req.user, it.site_id)) throw forbidden();
  const d = clean(parse(itemSchema.partial(), req.body));
  if (d.status && d.status !== 'DA_INSTALLARE' && !d.checked_at) { d.checked_at = todayRome(); d.checked_by = d.checked_by || req.user.full_name; }
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE exposure_items SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'EXPOSURE_ITEM_UPDATE', 'exposure_item', id, d);
  res.json({ ok: true });
}));
r.delete('/items/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const it = await one('SELECT site_id FROM exposure_items WHERE id=$1', [id]);
  if (!it) throw notFound();
  if (!canEditSite(req.user, it.site_id)) throw forbidden();
  await q('DELETE FROM exposure_items WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// Verifica rapida: segna tutti i materiali della sede come installati (visita in sede)
r.post('/sites/:id/check-all', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditSite(req.user, id)) throw forbidden();
  const { status } = parse(z.object({ status: z.enum(['INSTALLATO', 'DA_SOSTITUIRE']).default('INSTALLATO') }), req.body || {});
  const n = (await q('UPDATE exposure_items SET status=$2, checked_at=$3, checked_by=$4, updated_at=now() WHERE site_id=$1 AND status<>\'RIMOSSO\'', [id, status, todayRome(), req.user.full_name])).rowCount;
  await audit(req, 'EXPOSURE_CHECK_ALL', 'site', id, { status, n });
  res.json({ ok: true, updated: n });
}));

// Cambio mese: aggiorna le voci "promo del mese" di tutte le sedi con la promozione corrente e le mette "da sostituire"
r.post('/rollover', requireWrite, ah(async (req, res) => {
  const promo = await one('SELECT id, name, claim FROM promotions WHERE year=date_part(\'year\', CURRENT_DATE) AND month=date_part(\'month\', CURRENT_DATE) AND status<>\'ANNULLATA\' ORDER BY id LIMIT 1');
  if (!promo) throw bad('Nessuna promozione per il mese corrente nel calendario');
  const n = (await q(`UPDATE exposure_items e SET promotion_id=$1, content=$2, status=CASE WHEN e.status='RIMOSSO' THEN e.status ELSE 'DA_SOSTITUIRE' END, valid_from=date_trunc('month', CURRENT_DATE)::date, valid_to=(date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date, updated_at=now()
    WHERE e.material ILIKE '%promo del mese%' AND (e.promotion_id IS DISTINCT FROM $1)`, [promo.id, promo.claim])).rowCount;
  await audit(req, 'EXPOSURE_ROLLOVER', 'promotion', promo.id, { updated: n });
  res.json({ ok: true, updated: n, promotion: promo.name });
}));

// Foto
r.post('/sites/:id/photos', upload.single('file'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditSite(req.user, id)) throw forbidden();
  if (!req.file) throw bad('File mancante');
  if (!/^image\//.test(req.file.mimetype)) throw bad('Caricare un\'immagine');
  const itemId = req.body.item_id ? Number(req.body.item_id) : null;
  const row = await one('INSERT INTO exposure_photos(site_id, item_id, filename, mime, size, data, taken_at, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [id, itemId, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.body.taken_at || todayRome(), req.user.id]);
  res.status(201).json(row);
}));
r.get('/photos/:id', ah(async (req, res) => {
  const p = await one('SELECT filename, mime, data FROM exposure_photos WHERE id=$1', [Number(req.params.id)]);
  if (!p) throw notFound();
  res.setHeader('Content-Type', p.mime); res.setHeader('Content-Disposition', `inline; filename="${p.filename}"`); res.send(p.data);
}));
r.delete('/photos/:id', ah(async (req, res) => {
  const p = await one('SELECT site_id FROM exposure_photos WHERE id=$1', [Number(req.params.id)]);
  if (!p) throw notFound();
  if (!canEditSite(req.user, p.site_id)) throw forbidden();
  await q('DELETE FROM exposure_photos WHERE id=$1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// Book retail in PowerPoint: una sede o tutte
r.get('/book.pptx', ah(async (req, res) => {
  const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const sites = await many(`SELECT * FROM sites_v WHERE active AND in_network ${siteId ? 'AND id=$1' : ''} ORDER BY sort_order, name`, siteId ? [siteId] : []);
  const zones = await many('SELECT * FROM exposure_zones ORDER BY sort_order');
  const items = await many(`SELECT e.*, st.rule FROM exposure_items e LEFT JOIN exposure_standards st ON st.id=e.standard_id WHERE e.status<>'RIMOSSO' ${siteId ? 'AND e.site_id=$1' : ''} ORDER BY e.zone_id, st.sort_order NULLS LAST`, siteId ? [siteId] : []);
  const promo = await one('SELECT name, claim FROM promotions WHERE year=date_part(\'year\', CURRENT_DATE) AND month=date_part(\'month\', CURRENT_DATE) AND status<>\'ANNULLATA\' ORDER BY id LIMIT 1');
  const buf = await bookToPptx({ sites: sites.map((s) => ({ ...s, kind_label: KIND_LABEL[s.kind], items: items.filter((i) => i.site_id === s.id) })), zones, promo, generatedAt: todayRome().split('-').reverse().join('/') });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="book_retail_${siteId ? sites[0]?.code || siteId : 'network'}.pptx"`);
  res.send(buf);
}));

export default r;
