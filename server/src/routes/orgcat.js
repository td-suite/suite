// Catalogo dei ruoli (Amministrazione > Organizzazione). La colonna testuale people.job_title resta allineata al catalogo
// (la leggono Rubrica, ricerca e moduli). L'organigramma si compone da sede, ruolo e responsabile.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';

const r = Router();
const roleSchema = z.object({ name: z.string().trim().min(2).max(200), description: z.string().max(600).nullable().optional(), sort_order: z.number().int().optional(), active: z.boolean().optional() });

const ROLE_COLS = `r.*, (SELECT count(*)::int FROM people x WHERE x.role_id=r.id AND x.status='ATTIVO') AS people_count`;
r.get('/job-roles', ah(async (req, res) => {
  const all = req.query.all === '1';
  res.json(await many(`SELECT ${ROLE_COLS} FROM job_roles r ${all ? '' : 'WHERE r.active'} ORDER BY r.sort_order, r.name`));
}));
r.post('/job-roles', requireAdmin, ah(async (req, res) => {
  const b = parse(roleSchema, req.body);
  const cols = Object.keys(b);
  const row = await one(`INSERT INTO job_roles (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(b));
  await audit(req, 'JOB_ROLE_CREATED', { entity: 'job_role', entityId: row.id, label: row.name });
  res.status(201).json(row);
}));
r.put('/job-roles/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(roleSchema.partial(), req.body);
  const sets = []; const params = [id];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE job_roles SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!row) throw notFound();
  if (b.name) await q('UPDATE people SET job_title=$2 WHERE role_id=$1', [id, row.name]);
  await audit(req, 'JOB_ROLE_UPDATED', { entity: 'job_role', entityId: id, label: row.name, data: b });
  res.json(row);
}));
r.delete('/job-roles/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM people WHERE role_id=$1', [id])).n;
  if (n) throw bad(`${n} person${n === 1 ? 'a ha' : 'e hanno'} questo ruolo: cambialo prima, oppure disattiva il ruolo`);
  const row = await one('DELETE FROM job_roles WHERE id=$1 RETURNING name', [id]); if (!row) throw notFound();
  await audit(req, 'JOB_ROLE_DELETED', { entity: 'job_role', entityId: id, label: row.name });
  res.json({ ok: true });
}));

// ---- Reparti per sede
const unitSchema = z.object({ site_id: z.number().int(), name: z.string().trim().min(2).max(160), head_person_id: z.number().int().nullable().optional(), phone_ext: z.string().max(10).nullable().optional(), description: z.string().max(600).nullable().optional(), sort_order: z.number().int().optional(), active: z.boolean().optional() });
const UNIT_COLS = `u.*, s.code AS site_code, s.name AS site_name, h.last_name || ' ' || h.first_name AS head_name, (SELECT count(*)::int FROM people x WHERE x.unit_id=u.id AND x.status='ATTIVO') AS people_count`;
r.get('/org-units', ah(async (req, res) => {
  const all = req.query.all === '1'; const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const where = [all ? null : 'u.active', siteId ? `u.site_id=${siteId}` : null].filter(Boolean);
  res.json(await many(`SELECT ${UNIT_COLS} FROM org_units u JOIN sites s ON s.id=u.site_id LEFT JOIN people h ON h.id=u.head_person_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY lower(s.name), u.sort_order, lower(u.name)`));
}));
r.post('/org-units', requireAdmin, ah(async (req, res) => {
  const b = parse(unitSchema, req.body); const cols = Object.keys(b);
  const row = await one(`INSERT INTO org_units (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(b));
  await audit(req, 'ORG_UNIT_CREATED', { entity: 'org_unit', entityId: row.id, label: row.name });
  res.status(201).json(row);
}));
r.put('/org-units/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id); const b = parse(unitSchema.partial(), req.body);
  const sets = []; const params = [id];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE org_units SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params); if (!row) throw notFound();
  if (b.site_id) await q('UPDATE people SET unit_id=NULL WHERE unit_id=$1 AND site_id<>$2', [id, b.site_id]);
  await audit(req, 'ORG_UNIT_UPDATED', { entity: 'org_unit', entityId: id, label: row.name, data: b });
  res.json(row);
}));
r.delete('/org-units/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM people WHERE unit_id=$1', [id])).n;
  if (n) throw bad(`${n} person${n === 1 ? 'a appartiene' : 'e appartengono'} a questo reparto: spostale prima, oppure disattivalo`);
  const row = await one('DELETE FROM org_units WHERE id=$1 RETURNING name', [id]); if (!row) throw notFound();
  await audit(req, 'ORG_UNIT_DELETED', { entity: 'org_unit', entityId: id, label: row.name });
  res.json({ ok: true });
}));

// Organigramma: persone attive con sede, ruolo e responsabile (l'albero si costruisce sul responsabile; il raggruppamento per sede è della pagina)
r.get('/org-chart', ah(async (_req, res) => {
  const people = await many(`SELECT p.id, p.last_name, p.first_name, p.title, p.email, p.role_id, p.job_title, p.site_id, p.unit_id, u.name AS unit_name, p.manager_person_id, s.short_name AS site_name, s.name AS site_full_name,
    (SELECT u.avatar_file_id FROM users u WHERE u.person_id=p.id LIMIT 1) AS avatar_file_id FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN org_units u ON u.id=p.unit_id WHERE p.status='ATTIVO' ORDER BY p.last_name, p.first_name`);
  res.json({ people });
}));

// Riferimento ai cataloghi quando una persona viene scritta: area_id/role_id ← testo, oppure testo ← id
export async function resolveCatalog(b, { createMissing = false } = {}) {
  if (b.unit_id != null) { const u = await one('SELECT site_id FROM org_units WHERE id=$1', [b.unit_id]); if (!u) throw bad('Reparto inesistente'); if (b.site_id != null && u.site_id !== b.site_id) throw bad('Il reparto appartiene a un\'altra sede'); }
  if (b.unit !== undefined) {
    if (!b.unit) b.unit_id = null;
    else {
      if (b.site_id == null) throw bad('Per indicare il reparto serve la sede');
      let u = await one('SELECT id FROM org_units WHERE site_id=$1 AND lower(name)=lower($2)', [b.site_id, b.unit.trim()]);
      if (!u) { if (!createMissing) throw bad(`Reparto "${b.unit}" non presente nella sede: crealo in Amministrazione > Organizzazione`); u = await one('INSERT INTO org_units (site_id, name) VALUES ($1,$2) RETURNING id', [b.site_id, b.unit.trim()]); }
      b.unit_id = u.id;
    }
    delete b.unit;
  }
  if (b.role_id != null) { const r0 = await one('SELECT name FROM job_roles WHERE id=$1', [b.role_id]); if (!r0) throw bad('Ruolo inesistente'); b.job_title = r0.name; }
  else if (b.job_title !== undefined) { const r0 = b.job_title ? await one('SELECT id, name FROM job_roles WHERE lower(name)=lower($1)', [b.job_title.trim()]) : null; if (b.job_title && !r0) { if (!createMissing) throw bad(`Ruolo "${b.job_title}" non in catalogo: scegline uno dall'elenco o crealo in Amministrazione > Organizzazione`); const nr = await one('INSERT INTO job_roles (name) VALUES ($1) RETURNING id, name', [b.job_title.trim()]); b.role_id = nr.id; b.job_title = nr.name; return b; } b.role_id = r0?.id || null; b.job_title = r0?.name || null; }
  return b;
}

export default r;
