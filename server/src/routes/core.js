// Moduli (home a widget), anagrafiche (sedi, organizzazioni, persone), rubrica, notifiche, audit
import { Router } from 'express';
import { activeModuleKeys, moduleHref } from '../lib/modules.js';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound, readLog } from '../lib/util.js';
import { requireAdmin, isAdmin, hasModule } from '../lib/access.js';
import { indexPersonById, indexSite, indexOrg, removeFromIndex } from '../lib/search.js';

const r = Router();

// ---- Home: i moduli visibili all'utente, raggruppati per area, con contatori (riempiti dal modulo cockpit/legacy quando disponibili)
export const AREAS = [
  { key: 'DIREZIONE', name: 'Direzione', color: '#01212C' },
  { key: 'FINANCE', name: 'Finance', color: '#1C505E' },
  { key: 'RETAIL_FLOW', name: 'Retail and Flow Management', color: '#C77D2A' },
  { key: 'OPERATIONS', name: 'Operations', color: '#2F7D5B' },
  { key: 'HQS', name: 'HQS · Qualità, Sicurezza, SGI', color: '#71B1BD' },
  { key: 'PEOPLE', name: 'People', color: '#8E5BA6' },
];

r.get('/home/modules', ah(async (req, res) => {
  const mods = await many('SELECT key, area, name, tagline, icon, kind, legacy_url, route, restricted, sort_order, scope_type FROM modules WHERE active ORDER BY area, sort_order');
  const u = req.user;
  const active = await activeModuleKeys();   // moduli travasati (MIRROR/LIVE): si aprono dentro la Suite
  const visible = mods.filter((m) => {
    if (m.key === 'admin') return isAdmin(u);
    if (m.kind === 'PUBLIC') return true;                 // vetrine pubbliche: sempre raggiungibili
    return Boolean(u.grants[m.key]) || (isAdmin(u) && !m.restricted) || (u.level === 'OWNER');
  }).map((m) => ({ ...m, profile: u.grants[m.key]?.profile || (isAdmin(u) ? 'ADMIN' : null), href: moduleHref(m, active), inside: m.kind === 'NATIVE' || active.has(m.key), module_mode: active.get(m.key) || null }));
  const areas = AREAS.map((a) => ({ ...a, modules: visible.filter((m) => m.area === a.key) })).filter((a) => a.modules.length);
  res.json({ areas });
}));

r.get('/modules', ah(async (req, res) => {
  const rows = await many('SELECT * FROM modules ORDER BY area, sort_order');
  res.json(rows.map((m) => ({ ...m, sso_secret: undefined, sso_configured: Boolean(m.sso_secret) })));
}));
r.put('/modules/:key', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).optional(), tagline: z.string().nullable().optional(), legacy_url: z.string().url().nullable().optional(),
    active: z.boolean().optional(), sort_order: z.number().int().optional(), sso_secret: z.string().min(24).nullable().optional() }), req.body);
  if (b.sso_secret !== undefined && req.user.level !== 'OWNER') throw bad('Il segreto SSO lo imposta solo il titolare');
  const sets = []; const params = [req.params.key];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  await q(`UPDATE modules SET ${sets.join(', ')}, updated_at=now() WHERE key=$1`, params);
  await audit(req, 'MODULE_UPDATED', { module: req.params.key, data: { ...b, sso_secret: b.sso_secret ? '(impostato)' : undefined } });
  res.json({ ok: true });
}));

// ---- Sedi
const siteSchema = z.object({
  code: z.string().min(2).max(24), name: z.string().min(2), short_name: z.string().max(60).nullable().optional(),
  kind: z.enum(['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO']).optional(),
  organization_id: z.number().int().nullable().optional(), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(),
  province: z.string().max(4).nullable().optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(), manager_name: z.string().nullable().optional(), opening_hours: z.string().nullable().optional(), legacy_brand: z.string().nullable().optional(),
  studiolab_code: z.string().nullable().optional(), active: z.boolean().optional(), needs_review: z.boolean().optional(), sort_order: z.number().int().optional(), notes: z.string().nullable().optional(),
});
r.get('/sites', ah(async (req, res) => {
  const all = isAdmin(req.user) || req.query.all === '1';
  const rows = await many(`SELECT s.*, o.name AS organization_name, (SELECT count(*)::int FROM users u WHERE u.site_id=s.id AND u.status='ACTIVE') AS users_count
    FROM sites s LEFT JOIN organizations o ON o.id=s.organization_id ${all ? '' : 'WHERE s.active'} ORDER BY s.sort_order, s.name`);
  res.json(rows.map((s) => (isAdmin(req.user) ? s : { ...s, legacy_refs: undefined, notes: undefined })));
}));
r.post('/sites', requireAdmin, ah(async (req, res) => {
  const b = parse(siteSchema, req.body);
  const cols = Object.keys(b); const vals = Object.values(b);
  const s = await one(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'SITE_CREATED', { entity: 'site', entityId: s.id, label: `${s.code} ${s.name}` });
  indexSite(s).catch(() => {});
  res.status(201).json(s);
}));
r.put('/sites/:id', requireAdmin, ah(async (req, res) => {
  const b = parse(siteSchema.partial(), req.body);
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const s = await one(`UPDATE sites SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!s) throw notFound();
  await audit(req, 'SITE_UPDATED', { entity: 'site', entityId: s.id, label: `${s.code} ${s.name}`, data: b });
  indexSite(s).catch(() => {});
  res.json(s);
}));
// Unione di due sedi duplicate: la sorgente confluisce nella destinazione (riferimenti legacy, utenti, persone)
r.post('/sites/:id/merge-into/:target', requireAdmin, ah(async (req, res) => {
  const src = await one('SELECT * FROM sites WHERE id=$1', [Number(req.params.id)]);
  const dst = await one('SELECT * FROM sites WHERE id=$1', [Number(req.params.target)]);
  if (!src || !dst || src.id === dst.id) throw bad('Sedi non valide');
  await q(`UPDATE sites SET legacy_refs = legacy_refs || $2, needs_review=FALSE, updated_at=now() WHERE id=$1`, [dst.id, JSON.stringify(src.legacy_refs)]);
  await q('UPDATE users SET site_id=$2 WHERE site_id=$1', [src.id, dst.id]);
  await q('UPDATE people SET site_id=$2 WHERE site_id=$1', [src.id, dst.id]);
  await q(`UPDATE grant_scopes SET scope_id=$2 WHERE scope_type='SITE' AND scope_id=$1 AND NOT EXISTS (SELECT 1 FROM grant_scopes g2 WHERE g2.grant_id=grant_scopes.grant_id AND g2.scope_type='SITE' AND g2.scope_id=$2)`, [src.id, dst.id]);
  await q(`DELETE FROM grant_scopes WHERE scope_type='SITE' AND scope_id=$1`, [src.id]);
  await q('UPDATE events SET site_id=$2 WHERE site_id=$1', [src.id, dst.id]);
  await q('UPDATE posts SET site_id=$2 WHERE site_id=$1', [src.id, dst.id]);
  await q('DELETE FROM sites WHERE id=$1', [src.id]);
  removeFromIndex('site', String(src.id)).catch(() => {});
  await audit(req, 'SITE_MERGED', { entity: 'site', entityId: dst.id, label: `${src.code} → ${dst.code}`, data: { from: src, into: dst.code } });
  res.json({ ok: true });
}));

// ---- Organizzazioni
const orgSchema = z.object({
  kind: z.enum(['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO']).optional(), code: z.string().max(24).nullable().optional(), name: z.string().min(2),
  vat_number: z.string().max(20).nullable().optional(), tax_code: z.string().max(20).nullable().optional(), sdi: z.string().max(10).nullable().optional(), pec: z.string().nullable().optional(),
  email: z.string().nullable().optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(),
  province: z.string().max(4).nullable().optional(), website: z.string().nullable().optional(), active: z.boolean().optional(), needs_review: z.boolean().optional(), notes: z.string().nullable().optional(),
});
r.get('/organizations', ah(async (req, res) => {
  const rows = await many(`SELECT o.*, (SELECT count(*)::int FROM sites s WHERE s.organization_id=o.id) AS sites_count, (SELECT count(*)::int FROM users u WHERE u.organization_id=o.id) AS users_count FROM organizations o ORDER BY o.kind, o.name`);
  res.json(isAdmin(req.user) ? rows : rows.map((o) => ({ id: o.id, kind: o.kind, code: o.code, name: o.name, city: o.city, province: o.province })));
}));
r.post('/organizations', requireAdmin, ah(async (req, res) => {
  const b = parse(orgSchema, req.body);
  const cols = Object.keys(b); const vals = Object.values(b);
  const o = await one(`INSERT INTO organizations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'ORG_CREATED', { entity: 'organization', entityId: o.id, label: o.name });
  indexOrg(o).catch(() => {});
  res.status(201).json(o);
}));
r.put('/organizations/:id', requireAdmin, ah(async (req, res) => {
  const b = parse(orgSchema.partial(), req.body);
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const o = await one(`UPDATE organizations SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!o) throw notFound();
  await audit(req, 'ORG_UPDATED', { entity: 'organization', entityId: o.id, label: o.name, data: b });
  indexOrg(o).catch(() => {});
  res.json(o);
}));

// ---- Persone e rubrica (modulo "rubrica"; i dati contrattuali restano in Contracts: qui solo chi è, dove, cosa fa)
const personSchema = z.object({
  kind: z.enum(['DIPENDENTE', 'LP', 'MEDICO', 'SANITARIO', 'ESTERNO', 'DIRIGENTE']).optional(), status: z.enum(['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO']).optional(),
  last_name: z.string().min(1), first_name: z.string().min(1), title: z.string().max(20).nullable().optional(), sex: z.enum(['F', 'M']).nullable().optional(),
  email: z.string().email().nullable().optional(), phone: z.string().nullable().optional(), phone_office: z.string().nullable().optional(), area: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(), discipline: z.string().nullable().optional(), manager_person_id: z.number().int().nullable().optional(), site_id: z.number().int().nullable().optional(),
  organization_id: z.number().int().nullable().optional(), tax_code: z.string().max(16).nullable().optional(), needs_review: z.boolean().optional(),
});
const RUBRICA_COLS = `p.id, p.kind, p.status, p.last_name, p.first_name, p.title, p.email, p.phone, p.phone_office, p.area, p.job_title, p.discipline, p.manager_person_id, p.site_id, p.organization_id, p.photo_file_id,
  s.name AS site_name, s.city AS site_city, o.name AS organization_name, m.last_name || ' ' || m.first_name AS manager_name,
  (SELECT u.id FROM users u WHERE u.person_id=p.id LIMIT 1) AS user_id, (SELECT u.avatar_file_id FROM users u WHERE u.person_id=p.id LIMIT 1) AS avatar_file_id`;
r.get('/people', ah(async (req, res) => {
  const { qtext = '', area = '', kind = '', site_id = '', status = 'ATTIVO', all = '' } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (qtext) where.push(`lower(unaccent(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,'') || ' ' || coalesce(p.area,''))) LIKE lower(unaccent(${p(`%${qtext}%`)}))`);
  if (area) where.push(`p.area = ${p(area)}`);
  if (kind) where.push(`p.kind = ${p(kind)}`);
  if (site_id) where.push(`p.site_id = ${p(Number(site_id))}`);
  if (status && !all) where.push(`p.status = ${p(status)}`);
  const rows = await many(`SELECT ${RUBRICA_COLS} FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(p.last_name), lower(p.first_name) LIMIT 1000`, params);
  // Dati personali minimi per chi non è amministratore: niente codice fiscale, niente date; telefoni visibili (rubrica aziendale)
  res.json(rows);
}));
r.get('/people/areas', ah(async (_req, res) => {
  res.json(await many(`SELECT area, count(*)::int AS n FROM people WHERE area IS NOT NULL AND status='ATTIVO' GROUP BY area ORDER BY area`));
}));
r.get('/people/org-chart', ah(async (_req, res) => {
  const rows = await many(`SELECT ${RUBRICA_COLS} FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id WHERE p.status='ATTIVO' ORDER BY lower(p.last_name)`);
  res.json(rows);
}));
r.get('/people/:id', ah(async (req, res) => {
  const row = await one(`SELECT ${RUBRICA_COLS}, p.hired_at, p.legacy_refs, p.needs_review FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id WHERE p.id=$1`, [Number(req.params.id)]);
  if (!row) throw notFound();
  if (!isAdmin(req.user)) { delete row.legacy_refs; delete row.hired_at; }
  const reports = await many(`SELECT id, last_name, first_name, job_title FROM people WHERE manager_person_id=$1 AND status='ATTIVO' ORDER BY last_name`, [row.id]);
  await readLog(req, { module: 'rubrica', entity: 'person', entityId: row.id });
  res.json({ ...row, reports });
}));
r.post('/people', requireAdmin, ah(async (req, res) => {
  const b = parse(personSchema, req.body);
  const cols = Object.keys(b); const vals = Object.values(b);
  const row = await one(`INSERT INTO people (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'PERSON_CREATED', { entity: 'person', entityId: row.id, label: `${row.last_name} ${row.first_name}` });
  indexPersonById(row.id).catch(() => {});
  res.status(201).json(row);
}));
r.put('/people/:id', ah(async (req, res) => {
  if (!isAdmin(req.user) && !hasModule(req.user, 'rubrica', 'EDITOR')) throw bad('Operazione riservata');
  const b = parse(personSchema.partial(), req.body);
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE people SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!row) throw notFound();
  await audit(req, 'PERSON_UPDATED', { entity: 'person', entityId: row.id, label: `${row.last_name} ${row.first_name}`, data: b });
  indexPersonById(row.id).catch(() => {});
  res.json(row);
}));

// ---- Notifiche
r.get('/notifications', ah(async (req, res) => {
  const rows = await many('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  const unread = (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id])).n;
  res.json({ unread, rows });
}));
r.post('/notifications/read', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }), req.body);
  if (b.all) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  else if (b.ids?.length) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::bigint[])', [req.user.id, b.ids]);
  res.json({ ok: true });
}));

// ---- Audit e impostazioni (amministrazione)
r.get('/audit', requireAdmin, ah(async (req, res) => {
  const { action = '', user_id = '', qtext = '', page = 1 } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (action) where.push(`a.action = ${p(action)}`);
  if (user_id) where.push(`a.user_id = ${p(Number(user_id))}`);
  if (qtext) where.push(`(lower(coalesce(a.label,'')) LIKE ${p(`%${String(qtext).toLowerCase()}%`)} OR lower(coalesce(u.full_name,'')) LIKE ${p(`%${String(qtext).toLowerCase()}%`)})`);
  const rows = await many(`SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT 100 OFFSET ${p((Math.max(1, Number(page)) - 1) * 100)}`, params);
  res.json(rows);
}));
r.get('/read-log', requireAdmin, ah(async (req, res) => {
  if (req.user.level !== 'OWNER') throw bad('Riservato al titolare');
  res.json(await many('SELECT r.*, u.full_name AS user_name FROM read_log r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.at DESC LIMIT 200'));
}));
r.get('/settings', requireAdmin, ah(async (_req, res) => {
  res.json(Object.fromEntries((await many(`SELECT key, value FROM app_settings WHERE key NOT LIKE 'reset:%' AND key NOT LIKE 'secret:%'`)).map((s) => [s.key, s.value])));
}));
r.put('/settings/:key', requireAdmin, ah(async (req, res) => {
  if (req.params.key.startsWith('reset:') || req.params.key.startsWith('secret:')) throw bad('Chiave non valida');
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [req.params.key, JSON.stringify(req.body.value), req.user.id]);
  await audit(req, 'SETTING_UPDATED', { entity: 'setting', entityId: req.params.key });
  res.json({ ok: true });
}));

export default r;
