// Profili di accesso: pacchetti di permessi "widget → profilo" (richiesta del CEO, 28/10/2026).
// Lettura e applicazione: amministratori. Creazione, modifica ed eliminazione: solo il titolare.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin, requireOwner } from '../lib/access.js';
import { applyProfile, applyDefaultToAll } from '../lib/accessProfiles.js';

const r = Router();

const itemSchema = z.object({ module_key: z.string().min(1), profile: z.string().min(1) });
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(400).nullable().optional(),
  is_default: z.boolean().optional(),
  items: z.array(itemSchema).max(100),
  sort_order: z.number().int().optional(),
});

const LIST_SQL = `SELECT p.*, u.full_name AS created_by_name,
    (SELECT count(DISTINCT g.user_id)::int FROM grants g WHERE g.profile_id=p.id) AS users_count
  FROM access_profiles p LEFT JOIN users u ON u.id=p.created_by`;

// Item validi: modulo esistente, profilo previsto dal modulo; un modulo compare una volta sola
async function validateItems(items) {
  const modules = await many('SELECT key, name, profiles, restricted FROM modules');
  const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));
  const seen = new Set(); const out = [];
  for (const it of items) {
    const m = byKey[it.module_key];
    if (!m) throw bad(`Widget "${it.module_key}" inesistente`);
    if (!(m.profiles || []).some((p) => p.key === it.profile)) throw bad(`Profilo "${it.profile}" non previsto da "${m.name}"`);
    if (seen.has(m.key)) continue;
    seen.add(m.key); out.push({ module_key: m.key, profile: it.profile });
  }
  return out;
}

r.get('/', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`${LIST_SQL} ORDER BY p.is_default DESC, p.sort_order, lower(p.name)`));
}));

r.get('/:id(\\d+)', requireAdmin, ah(async (req, res) => {
  const p = await one(`${LIST_SQL} WHERE p.id=$1`, [Number(req.params.id)]);
  if (!p) throw notFound('Profilo di accesso inesistente');
  const users = await many(`SELECT u.id, u.full_name, u.email, count(g.id)::int AS n FROM grants g JOIN users u ON u.id=g.user_id WHERE g.profile_id=$1 GROUP BY u.id ORDER BY lower(u.full_name)`, [p.id]);
  res.json({ ...p, users });
}));

r.post('/', requireOwner, ah(async (req, res) => {
  const b = parse(profileSchema, req.body);
  if (await one('SELECT 1 FROM access_profiles WHERE lower(name)=lower($1)', [b.name])) throw bad('Esiste già un profilo con questo nome');
  const items = await validateItems(b.items);
  const row = await tx(async (c) => {
    if (b.is_default) await c.query('UPDATE access_profiles SET is_default=FALSE, updated_at=now() WHERE is_default');
    const { rows: [p] } = await c.query(`INSERT INTO access_profiles (name, description, is_default, items, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.name, b.description || null, Boolean(b.is_default), JSON.stringify(items), b.sort_order ?? 100, req.user.id]);
    return p;
  });
  await audit(req, 'ACCESS_PROFILE_CREATED', { entity: 'access_profile', entityId: row.id, label: row.name, data: { is_default: row.is_default, items } });
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', requireOwner, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM access_profiles WHERE id=$1', [id]);
  if (!cur) throw notFound('Profilo di accesso inesistente');
  const b = parse(profileSchema.partial(), req.body);
  if (b.name && await one('SELECT 1 FROM access_profiles WHERE lower(name)=lower($1) AND id<>$2', [b.name, id])) throw bad('Esiste già un profilo con questo nome');
  const items = b.items ? await validateItems(b.items) : null;
  const row = await tx(async (c) => {
    if (b.is_default) await c.query('UPDATE access_profiles SET is_default=FALSE, updated_at=now() WHERE is_default AND id<>$1', [id]);
    const { rows: [p] } = await c.query(
      `UPDATE access_profiles SET name=coalesce($2, name), description=CASE WHEN $3::boolean THEN $4 ELSE description END, is_default=coalesce($5, is_default),
         items=coalesce($6::jsonb, items), sort_order=coalesce($7, sort_order), updated_at=now() WHERE id=$1 RETURNING *`,
      [id, b.name ?? null, b.description !== undefined, b.description ?? null, b.is_default ?? null, items ? JSON.stringify(items) : null, b.sort_order ?? null]);
    return p;
  });
  await audit(req, 'ACCESS_PROFILE_UPDATED', { entity: 'access_profile', entityId: id, label: row.name, data: { ...b, items } });
  res.json(row);
}));

// I grant nati dal profilo restano: perdono solo il riferimento (ON DELETE SET NULL)
r.delete('/:id(\\d+)', requireOwner, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM access_profiles WHERE id=$1', [id]);
  if (!cur) throw notFound('Profilo di accesso inesistente');
  const n = (await one('SELECT count(*)::int AS n FROM grants WHERE profile_id=$1', [id])).n;
  await q('DELETE FROM access_profiles WHERE id=$1', [id]);
  await audit(req, 'ACCESS_PROFILE_DELETED', { entity: 'access_profile', entityId: id, label: cur.name, data: { grants_detached: n } });
  res.json({ ok: true, grants_detached: n });
}));

r.post('/:id(\\d+)/apply', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(z.object({ user_ids: z.array(z.number().int()).min(1).max(1000), mode: z.enum(['merge', 'replace']).optional() }), req.body);
  const report = await applyProfile(id, b.user_ids, { actorId: req.user.id, mode: b.mode || 'merge' });
  await audit(req, 'ACCESS_PROFILE_APPLIED', { entity: 'access_profile', entityId: id, label: `${report.profile.name} → ${report.users} utent${report.users === 1 ? 'e' : 'i'} (${report.mode})`,
    data: { user_ids: b.user_ids, mode: report.mode, added: report.added, updated: report.updated, kept: report.kept, removed: report.removed, warnings: report.warnings.slice(0, 50) } });
  res.json(report);
}));

r.post('/default/apply-all', requireAdmin, ah(async (req, res) => {
  const report = await applyDefaultToAll(req.user.id);
  await audit(req, 'ACCESS_PROFILE_APPLIED', { entity: 'access_profile', entityId: report.profile.id, label: `${report.profile.name} → tutti gli utenti (${report.users})`,
    data: { all: true, mode: report.mode, added: report.added, updated: report.updated, kept: report.kept, warnings: report.warnings.slice(0, 50) } });
  res.json(report);
}));

export default r;
