// Catalogo dei ruoli (Amministrazione > Organizzazione). La colonna testuale people.job_title resta allineata al catalogo
// (la leggono Rubrica, ricerca e moduli). L'organigramma si compone da sede, ruolo e responsabile.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { orgchartXlsx, orgchartPptx, orgchartPdf } from '../lib/orgchartExport.js';

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

// ---- Unità organizzative (albero) e incarichi
const unitSchema = z.object({
  name: z.string().trim().min(2).max(160), kind: z.enum(['DIREZIONE', 'AREA', 'SEDE', 'REPARTO', 'FUNZIONE']).optional(),
  parent_id: z.number().int().nullable().optional(), site_id: z.number().int().nullable().optional(), head_person_id: z.number().int().nullable().optional(),
  phone_ext: z.string().max(10).nullable().optional(), description: z.string().max(600).nullable().optional(), sort_order: z.number().int().optional(), active: z.boolean().optional(),
});
const UNIT_COLS = `u.*, s.code AS site_code, s.name AS site_name, pu.name AS parent_name,
  (SELECT count(*)::int FROM people x WHERE x.unit_id=u.id AND x.status='ATTIVO') AS people_count,
  (SELECT json_agg(json_build_object('id', op.id, 'person_id', op.person_id, 'role_id', op.role_id, 'is_head', op.is_head, 'sort_order', op.sort_order,
      'person_name', pp.last_name || ' ' || pp.first_name, 'person_email', pp.email, 'role_name', jr.name, 'avatar_file_id', (SELECT uu.avatar_file_id FROM users uu WHERE uu.person_id=pp.id LIMIT 1)) ORDER BY op.is_head DESC, op.sort_order, pp.last_name)
     FROM org_positions op JOIN people pp ON pp.id=op.person_id LEFT JOIN job_roles jr ON jr.id=op.role_id WHERE op.unit_id=u.id) AS positions`;
async function unitRows(where = '', params = []) {
  return many(`SELECT ${UNIT_COLS} FROM org_units u LEFT JOIN sites s ON s.id=u.site_id LEFT JOIN org_units pu ON pu.id=u.parent_id ${where} ORDER BY u.sort_order, lower(u.name)`, params);
}
r.get('/org-units', ah(async (req, res) => {
  const all = req.query.all === '1'; const siteId = req.query.site_id ? Number(req.query.site_id) : null; const kind = req.query.kind || null;
  // con site_id: i reparti della sede più quelli senza sede (reparti di area, es. il Laboratorio), così la tendina "Reparto" li offre entrambi
  const w = [all ? null : 'u.active', siteId ? `(u.site_id=$1 OR (u.kind='REPARTO' AND u.site_id IS NULL))` : null, kind ? `u.kind='${kind.replace(/[^A-Z_]/g, '')}'` : null].filter(Boolean);
  res.json(await unitRows(w.length ? 'WHERE ' + w.join(' AND ') : '', siteId ? [siteId] : []));
}));
r.post('/org-units', requireAdmin, ah(async (req, res) => {
  const b = parse(unitSchema, req.body);
  if (!b.kind) b.kind = b.site_id ? 'REPARTO' : 'AREA';
  if (b.kind === 'SEDE' && !b.site_id) throw bad('Un nodo di tipo sede deve indicare la sede');
  if (b.kind === 'REPARTO' && !b.site_id && b.parent_id) { const pr = await one('SELECT site_id FROM org_units WHERE id=$1', [b.parent_id]); b.site_id = pr?.site_id || null; }
  const cols = Object.keys(b);
  const row = await one(`INSERT INTO org_units (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(b));
  await audit(req, 'ORG_UNIT_CREATED', { entity: 'org_unit', entityId: row.id, label: row.name });
  res.status(201).json(row);
}));
r.put('/org-units/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id); const b = parse(unitSchema.partial(), req.body);
  if (b.parent_id === id) throw bad('Un\'unità non può dipendere da sé stessa');
  if (b.parent_id) { let p = b.parent_id; for (let i = 0; i < 20 && p; i++) { if (p === id) throw bad('Dipendenza circolare'); p = (await one('SELECT parent_id FROM org_units WHERE id=$1', [p]))?.parent_id; } }
  const sets = []; const params = [id];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE org_units SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params); if (!row) throw notFound();
  await audit(req, 'ORG_UNIT_UPDATED', { entity: 'org_unit', entityId: id, label: row.name, data: b });
  res.json(row);
}));
r.delete('/org-units/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM people WHERE unit_id=$1', [id])).n;
  if (n) throw bad(`${n} person${n === 1 ? 'a appartiene' : 'e appartengono'} a questa unità: spostale prima, oppure disattivala`);
  const c = (await one('SELECT count(*)::int AS n FROM org_units WHERE parent_id=$1', [id])).n;
  if (c) throw bad('L\'unità ha unità dipendenti: spostale o eliminale prima');
  const row = await one('DELETE FROM org_units WHERE id=$1 RETURNING name', [id]); if (!row) throw notFound();
  await audit(req, 'ORG_UNIT_DELETED', { entity: 'org_unit', entityId: id, label: row.name });
  res.json({ ok: true });
}));
// incarichi
const posSchema = z.object({ unit_id: z.number().int(), person_id: z.number().int(), role_id: z.number().int().nullable().optional(), is_head: z.boolean().optional(), sort_order: z.number().int().optional(), note: z.string().max(300).nullable().optional() });
r.post('/org-positions', requireAdmin, ah(async (req, res) => {
  const b = parse(posSchema, req.body);
  const row = await upsertPosition({ query: q }, b);
  if (b.is_head) await q('UPDATE org_units SET head_person_id=$2 WHERE id=$1', [b.unit_id, b.person_id]);
  await syncPersonFromPosition(b.person_id);
  await audit(req, 'ORG_POSITION_SET', { entity: 'org_position', entityId: row.id, data: b });
  res.status(201).json(row);
}));
r.delete('/org-positions/:id', requireAdmin, ah(async (req, res) => {
  const row = await one('DELETE FROM org_positions WHERE id=$1 RETURNING *', [Number(req.params.id)]); if (!row) throw notFound();
  if (row.is_head) await q('UPDATE org_units SET head_person_id=NULL WHERE id=$1 AND head_person_id=$2', [row.unit_id, row.person_id]);
  // la scheda persona segue gli incarichi rimasti
  await q('UPDATE people SET unit_id = CASE WHEN unit_id=$2 THEN NULL ELSE unit_id END, role_id = CASE WHEN role_id IS NOT DISTINCT FROM $3 THEN NULL ELSE role_id END WHERE id=$1', [row.person_id, row.unit_id, row.role_id]);
  await syncPersonFromPosition(row.person_id);
  await audit(req, 'ORG_POSITION_REMOVED', { entity: 'org_position', entityId: row.id });
  res.json({ ok: true });
}));

// Organigramma: persone attive con sede, ruolo e responsabile (l'albero si costruisce sul responsabile; il raggruppamento per sede è della pagina)
r.get('/org-chart', ah(async (_req, res) => {
  const units = await unitRows('WHERE u.active');
  const people = await many(`SELECT p.id, p.last_name, p.first_name, p.title, p.email, p.role_id, p.job_title, p.site_id, p.unit_id, u.name AS unit_name, p.manager_person_id, s.short_name AS site_name, s.name AS site_full_name,
    (SELECT u.avatar_file_id FROM users u WHERE u.person_id=p.id LIMIT 1) AS avatar_file_id FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN org_units u ON u.id=p.unit_id WHERE p.status='ATTIVO' ORDER BY p.last_name, p.first_name`);
  res.json({ units, people });
}));

// Un incarico per (unità, persona, ruolo). Se esiste già lo stesso incarico senza ruolo, prende il ruolo invece di sdoppiarsi.
export async function upsertPosition(c, b) {
  const run = async (sql, params) => { const r = await c.query(sql, params); return r.rows ? r.rows[0] : r; };
  if (b.role_id) {
    const blank = await run('SELECT id FROM org_positions WHERE unit_id=$1 AND person_id=$2 AND role_id IS NULL', [b.unit_id, b.person_id]);
    if (blank) return run(`UPDATE org_positions SET role_id=$2, is_head=coalesce($3, is_head), sort_order=coalesce($4, sort_order), note=coalesce($5, note) WHERE id=$1 RETURNING *`, [blank.id, b.role_id, b.is_head ?? null, b.sort_order ?? null, b.note ?? null]);
  }
  return run(`INSERT INTO org_positions (unit_id, person_id, role_id, is_head, sort_order, note) VALUES ($1,$2,$3,coalesce($4,FALSE),coalesce($5,100),$6)
    ON CONFLICT (unit_id, person_id, coalesce(role_id, 0)) DO UPDATE SET is_head=EXCLUDED.is_head, sort_order=EXCLUDED.sort_order, note=EXCLUDED.note RETURNING *`,
    [b.unit_id, b.person_id, b.role_id ?? null, b.is_head ?? null, b.sort_order ?? null, b.note ?? null]);
}

// ---- Le schede si parlano: Organizzazione ↔ Persone
// Dagli incarichi alla scheda persona: reparto e ruolo "principali" (il primo incarico da responsabile, altrimenti il primo) se la scheda non li ha
export async function syncPersonFromPosition(personId, c = { query: q }) {
  const pos = (await c.query(`SELECT op.unit_id, op.role_id, org_unit_site(u.id) AS site_id FROM org_positions op JOIN org_units u ON u.id=op.unit_id WHERE op.person_id=$1 ORDER BY (u.kind IN ('REPARTO','FUNZIONE')) DESC, op.is_head DESC, op.sort_order, op.id LIMIT 1`, [personId])).rows[0];
  if (!pos) return;
  await c.query(`UPDATE people SET unit_id = coalesce(unit_id, $2), role_id = coalesce(role_id, $3), site_id = coalesce(site_id, $4), updated_at=now() WHERE id=$1`, [personId, pos.unit_id, pos.role_id, pos.site_id]);
}
// Dalla scheda persona agli incarichi: reparto + ruolo scelti in Persone diventano (o aggiornano) l'incarico non da responsabile in quel reparto
export async function syncPositionFromPerson(p) {
  if (!p?.unit_id) return;
  const ex = await one('SELECT id, role_id, is_head FROM org_positions WHERE person_id=$1 AND unit_id=$2 ORDER BY is_head DESC, id LIMIT 1', [p.id, p.unit_id]);
  if (ex) { if (!ex.is_head && ex.role_id !== (p.role_id ?? null)) await q('UPDATE org_positions SET role_id=$2 WHERE id=$1', [ex.id, p.role_id ?? null]); return; }
  await upsertPosition({ query: q }, { unit_id: p.unit_id, person_id: p.id, role_id: p.role_id ?? null, is_head: false });
}

// ---- Esportazioni dell'organigramma
r.get('/org-chart/export.:fmt', ah(async (req, res) => {
  const units = await unitRows('WHERE u.active');
  const fmt = req.params.fmt; const name = `Organigramma_TD_${new Date().toISOString().slice(0, 10)}`;
  if (fmt === 'xlsx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); return res.send(await orgchartXlsx(units)); }
  if (fmt === 'pptx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pptx"`); return res.send(await orgchartPptx(units)); }
  if (fmt === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`); return res.send(await orgchartPdf(units)); }
  throw bad('Formato non previsto: xlsx, pptx o pdf');
}));

// Nodo sede e reparto nell'albero (creati se mancano). `c` è un client/pool con .query (anche dentro una transazione)
export async function ensureSiteNode(c, siteId) {
  const ex = (await c.query(`SELECT id FROM org_units WHERE kind='SEDE' AND site_id=$1`, [siteId])).rows[0];
  if (ex) return ex.id;
  const root = (await c.query(`SELECT id FROM org_units WHERE kind='DIREZIONE' ORDER BY id LIMIT 1`)).rows[0]
    || (await c.query(`INSERT INTO org_units (name, kind, sort_order) VALUES ('Toscana Diagnostica','DIREZIONE',0) RETURNING id`)).rows[0];
  const site = (await c.query('SELECT name FROM sites WHERE id=$1', [siteId])).rows[0];
  return (await c.query(`INSERT INTO org_units (name, kind, site_id, parent_id) VALUES ($1,'SEDE',$2,$3) RETURNING id`, [site?.name || `Sede ${siteId}`, siteId, root.id])).rows[0].id;
}
export async function ensureUnit(c, siteId, name, { create = true } = {}) {
  // prima il reparto della sede, poi un reparto di area con lo stesso nome (es. Core Lab sotto Laboratorio di Analisi), infine se ne crea uno nella sede
  // accetta anche il percorso "B2B › Service di Laboratorio" (o con / o >): si usa l'ultimo nome, il padre per disambiguare
  const parts = String(name).split(/\s*(?:›|>|\/)\s*/).map((x) => x.trim()).filter(Boolean);
  const leaf = parts[parts.length - 1] || name.trim(); const parentName = parts.length > 1 ? parts[parts.length - 2] : null;
  const cands = (await c.query(`SELECT u.id, u.kind, u.site_id, org_unit_site(u.id) AS any_site, pu.name AS parent_name FROM org_units u LEFT JOIN org_units pu ON pu.id=u.parent_id WHERE lower(u.name)=lower($1) AND u.active ORDER BY (u.kind='REPARTO') DESC, u.id`, [leaf])).rows
    .filter((u) => !parentName || (u.parent_name || '').toLowerCase() === parentName.toLowerCase());
  const ex = cands.find((u) => siteId && u.site_id === siteId) || cands.find((u) => siteId && u.any_site === siteId) || cands.find((u) => !u.site_id) || (cands.length === 1 ? cands[0] : null);
  if (ex || !create) return ex?.id || null;
  if (!siteId) return null;
  const parent = await ensureSiteNode(c, siteId);
  return (await c.query(`INSERT INTO org_units (name, kind, site_id, parent_id) VALUES ($1,'REPARTO',$2,$3) RETURNING id`, [name.trim(), siteId, parent])).rows[0].id;
}

// Riferimento ai cataloghi quando una persona viene scritta: area_id/role_id ← testo, oppure testo ← id
export async function resolveCatalog(b, { createMissing = false } = {}) {
  // Afferenza: l'unità può essere di qualunque tipo; la sede di lavoro, se non indicata, è quella dell'unità (o del primo antenato con sede)
  if (b.unit_id != null) { const u = await one('SELECT id, org_unit_site(id) AS site_id FROM org_units WHERE id=$1', [b.unit_id]); if (!u) throw bad('Unità inesistente'); if (b.site_id == null && u.site_id) b.site_id = u.site_id; }
  if (b.unit !== undefined) {
    if (!b.unit) b.unit_id = null;
    else {
      const { pool } = await import('../db.js');
      const uid = await ensureUnit(pool, b.site_id ?? null, b.unit, { create: createMissing });
      if (!uid) throw bad(`Unità "${b.unit}" non presente nell'organigramma: creala in Amministrazione, Organizzazione`);
      b.unit_id = uid;
    }
    delete b.unit;
  }
  if (b.role_id != null) { const r0 = await one('SELECT name FROM job_roles WHERE id=$1', [b.role_id]); if (!r0) throw bad('Ruolo inesistente'); b.job_title = r0.name; }
  else if (b.job_title !== undefined) { const r0 = b.job_title ? await one('SELECT id, name FROM job_roles WHERE lower(name)=lower($1)', [b.job_title.trim()]) : null; if (b.job_title && !r0) { if (!createMissing) throw bad(`Ruolo "${b.job_title}" non in catalogo: scegline uno dall'elenco o crealo in Amministrazione > Organizzazione`); const nr = await one('INSERT INTO job_roles (name) VALUES ($1) RETURNING id, name', [b.job_title.trim()]); b.role_id = nr.id; b.job_title = nr.name; return b; } b.role_id = r0?.id || null; b.job_title = r0?.name || null; }
  return b;
}

export default r;
