import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, diff, HttpError, parse } from '../lib/util.js';
import { requireEditor, requireAdmin } from '../lib/access.js';
import { publish, sseHandler } from '../lib/events.js';
import { readPlan, readMeta, readTarget, readEditableTarget, readAct, writeSupport, assertPeople, targetRowToObj, actRowToObj, normTarget, normAct, T_FIELDS, A_FIELDS, FIELD_LABELS, STATUS_LABELS, takeSnapshot, importPlan } from '../lib/plan.js';

const r = Router();

const who = (req) => req.user?.full_name || req.user?.email || 'utente';
const clientIdOf = (req) => req.get('X-Client-Id') || null;
const idParam = (v) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n <= 0) throw notFound('Target non trovata'); return n; };

// nomi delle persone per etichette leggibili (registro e notifiche)
async function personNames(ids) {
  const list = [...new Set(ids.filter((x) => x))];
  if (!list.length) return new Map();
  const rows = await many(`SELECT id, last_name || ' ' || first_name AS name FROM public.people WHERE id = ANY($1::int[])`, [list]);
  return new Map(rows.map((p) => [p.id, p.name]));
}

// Etichetta leggibile della modifica per registro e notifiche in tempo reale
async function describe(changes, kind) {
  const ids = [];
  if (changes.owner) ids.push(...changes.owner);
  if (changes.support) for (const arr of changes.support) ids.push(...(arr || []));
  const names = await personNames(ids);
  const pn = (id) => (id ? names.get(Number(id)) || `#${id}` : '–');
  const parts = [];
  for (const [k, [a, b]] of Object.entries(changes)) {
    const lab = FIELD_LABELS[k] || k;
    if (k === 'st') parts.push(`${lab}: ${STATUS_LABELS[a] ?? a} → ${STATUS_LABELS[b] ?? b}`);
    else if (k === 'owner') parts.push(`${lab}: ${pn(a)} → ${pn(b)}`);
    else if (k === 'support') parts.push(`${lab}: ${(a || []).map(pn).join(', ') || '–'} → ${(b || []).map(pn).join(', ') || '–'}`);
    else if (k === 'linee') parts.push(`${lab}: ${(a || []).join(', ') || '–'} → ${(b || []).join(', ') || '–'}`);
    else if (k === 'nome' && (typeof a === 'object' || typeof b === 'object')) parts.push(`${lab} aggiornato`);
    else if (k === 'lm') continue;
    else parts.push(`${lab}: ${a === '' || a == null ? '–' : a} → ${b === '' || b == null ? '–' : b}`);
  }
  return parts.join('; ') || (kind || 'aggiornamento');
}
const actTitle = (t, a) => `${t.nome} · ${a.cid && a.cid !== 'nuova' ? a.cid : ''}${a.nome ? (typeof a.nome === 'object' ? ` ${a.nome.it || a.nome.en || ''}` : ` ${a.nome}`) : ''}`.trim();

async function emit(req, type, data, { label, targetId } = {}) {
  publish({ type, data, by: who(req), label, targetId, clientId: clientIdOf(req), meta: await readMeta(), at: new Date().toISOString() });
}

// ---- lettura completa
r.get('/plan', ah(async (_req, res) => { res.json(await readPlan()); }));
r.get('/events', sseHandler);

// ---- anagrafica unica (sola lettura: le Legal entity si creano e si modificano in Amministrazione > Legal entity)
// Elenco delle sedi da integrare: tutte le Legal entity di tipo TARGET (anche senza piano avviato: in_plan=false)
// più quelle con un piano che nel frattempo sono diventate SOCIETA (integrated=true).
r.get('/organizations', ah(async (_req, res) => {
  res.json(await many(`SELECT o.id, o.kind, o.code, o.name, o.city, o.province, o.vat_number, o.active,
      (x.org_id IS NOT NULL) AS in_plan, (x.org_id IS NOT NULL AND o.kind <> 'TARGET') AS integrated
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id
    WHERE x.org_id IS NOT NULL OR o.kind = 'TARGET' ORDER BY lower(o.name)`));
}));
// Persone dell'anagrafica per il team: chi ha un grant sul modulo viene prima (has_grant), poi tutte le persone attive
r.get('/people', ah(async (req, res) => {
  const { q: qtext = '' } = req.query;
  const params = []; let where = `p.status IN ('ATTIVO','IMPEGNO')`;
  if (qtext) { params.push(`%${qtext}%`); where += ` AND lower(unaccent(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,''))) LIKE lower(unaccent($${params.length}))`; }
  res.json(await many(`SELECT p.id, p.last_name || ' ' || p.first_name AS name, p.email, p.job_title, p.kind, p.status,
      EXISTS (SELECT 1 FROM public.users u JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'integration' WHERE u.person_id = p.id) AS has_grant,
      (x.person_id IS NOT NULL) AS in_team
    FROM public.people p LEFT JOIN person_ext x ON x.person_id = p.id WHERE ${where}
    ORDER BY has_grant DESC, lower(p.last_name), lower(p.first_name) LIMIT 500`, params));
}));

// ---- target: avvio del piano per una Legal entity TARGET dell'anagrafica (crea la riga org_ext e le attività iniziali).
// Nessuna creazione o rinomina della società qui: nome, tipo e dati fiscali si cambiano in Amministrazione > Legal entity.
const targetSchema = z.object({
  org_id: z.coerce.number().int().positive(),
  version: z.number().int().optional(),
}).passthrough();

r.post('/targets', requireEditor, ah(async (req, res) => {
  const body = parse(targetSchema, req.body);
  const nt = normTarget(body);
  const atts = Array.isArray(body.atts) ? body.atts : [];
  const org = await one('SELECT id, kind, name, active FROM public.organizations WHERE id=$1', [body.org_id]);
  if (!org) throw notFound('Legal entity non trovata in anagrafica');
  if (org.kind !== 'TARGET') throw bad(`"${org.name}" non è una società target (tipo ${org.kind}): il tipo si cambia in Amministrazione > Legal entity`);
  await assertPeople(atts.flatMap((a) => { const na = normAct(a || {}); return [na.owner, ...na.support]; }));
  const row = await tx(async (c) => {
    const ex = await c.query('SELECT 1 FROM org_ext WHERE org_id=$1', [org.id]);
    if (ex.rows.length) throw new HttpError(409, 'Il piano di questa società è già stato avviato');
    const pos = (await c.query('SELECT coalesce(max(position)+1,0) AS p FROM org_ext')).rows[0].p;
    await c.query(
      `INSERT INTO org_ext (org_id, position, status, ref, fatt, pfn, ev, linee, loi, prelim, closing, hor, note, lm, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [org.id, pos, nt.status, nt.ref, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee), nt.loi, nt.prelim, nt.closing, nt.hor, nt.note, nt.lm || Date.now(), req.user.id]);
    let i = 0;
    for (const a of atts) {
      if (!a || !a.id) continue;
      const na = normAct(a);
      const ins = await c.query(
        `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner_id, dett, note, st, pl, ms, fine, lm, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING RETURNING id`,
        [org.id, String(a.id), i++, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
          na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, req.user.id]);
      if (ins.rows.length) await writeSupport(c, org.id, String(a.id), na.support);
    }
    await audit(req, 'TARGET_CREATED', { entity: 'target', entityId: org.id, targetId: String(org.id), label: `Piano avviato per ${org.name} (${i} attività)` }, c);
    return readTarget(org.id, c);
  });
  const obj = targetRowToObj(row);
  await emit(req, 'target.created', obj, { label: `piano avviato per ${obj.nome}`, targetId: obj.id });
  res.status(201).json(obj);
}));

r.patch('/targets/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const incoming = req.body || {};
  const cur = await readEditableTarget(id);
  if (incoming.version != null && Number(incoming.version) !== cur.version) {
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'target', row: targetRowToObj(cur) }; throw err;
  }
  const merged = { ...targetRowToObj(cur) };
  for (const k of T_FIELDS) if (k in incoming) merged[k] = incoming[k];
  const nt = normTarget(merged);
  const changes = diff(targetRowToObj(cur), { ...nt, fatt: nt.fatt === '' ? '' : Number(nt.fatt), pfn: nt.pfn === '' ? '' : Number(nt.pfn), ev: nt.ev === '' ? '' : Number(nt.ev) },
    T_FIELDS.filter((k) => k !== 'lm'));
  const upd = await one(
    `UPDATE org_ext SET status=$2, ref=$3, fatt=$4, pfn=$5, ev=$6, linee=$7, loi=$8, prelim=$9, closing=$10, hor=$11, note=$12, lm=$13,
       version=version+1, updated_by=$14, updated_at=now()
     WHERE org_id=$1 AND version=$15 RETURNING org_id`,
    [id, nt.status, nt.ref, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee), nt.loi, nt.prelim, nt.closing, nt.hor, nt.note,
      Math.max(nt.lm || 0, Date.now()), req.user.id, cur.version]);
  if (!upd) {
    const now = await readTarget(id);
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'target', row: targetRowToObj(now) }; throw err;
  }
  const obj = targetRowToObj(await readTarget(id));
  if (Object.keys(changes).length) {
    const label = `${obj.nome} · ${await describe(changes, 'parametri del piano')}`;
    await audit(req, 'TARGET_UPDATED', { entity: 'target', entityId: id, targetId: String(id), label, data: changes });
    await emit(req, 'target.updated', obj, { label, targetId: id });
  }
  res.json(obj);
}));

// rimozione del piano (la Legal entity resta in anagrafica e, se è ancora TARGET, resta nell'elenco come "da avviare")
r.delete('/targets/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await readTarget(id);
  if (!cur || !cur.configured) throw notFound('Piano non trovato');
  if (cur.integrated) throw bad(`"${cur.nome}" è ormai una società del gruppo: il piano di integrazione è chiuso e resta consultabile, non si rimuove`);
  await tx(async (c) => {
    await takeSnapshot('pre-delete', `Rimozione dal piano di ${cur.nome}`, req.user.id, c);
    await c.query('DELETE FROM activities WHERE target_id=$1', [id]);
    await c.query('DELETE FROM org_ext WHERE org_id=$1', [id]);
    await audit(req, 'TARGET_DELETED', { entity: 'target', entityId: id, targetId: String(id), label: `Rimosso dal piano ${cur.nome}` }, c);
  });
  await emit(req, 'target.deleted', { id }, { label: `rimosso dal piano ${cur.nome}`, targetId: id });
  res.json({ ok: true });
}));

// ---- attività
r.post('/targets/:tid/activities', requireEditor, ah(async (req, res) => {
  const tid = idParam(req.params.tid);
  const t = await readEditableTarget(tid);
  const body = req.body || {};
  const id = String(body.id || '').trim();
  if (!id || id.length > 80) throw bad('Identificativo attività non valido');
  const na = normAct(body);
  await assertPeople([na.owner, ...na.support]);
  const row = await tx(async (c) => {
    const pos = (await c.query('SELECT coalesce(max(position)+1,0) AS p FROM activities WHERE target_id=$1', [tid])).rows[0].p;
    const ins = await c.query(
      `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner_id, dett, note, st, pl, ms, fine, lm, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (target_id, id) DO NOTHING RETURNING id`,
      [tid, id, pos, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
        na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm || Date.now(), req.user.id]);
    if (!ins.rows.length) throw new HttpError(409, 'Attività già presente');
    await writeSupport(c, tid, id, na.support);
    const full = await readAct(tid, id, c);
    const a = actRowToObj(full);
    await audit(req, 'ACTIVITY_CREATED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: String(tid), label: `${actTitle(t, a)} · nuova attività` }, c);
    return full;
  });
  const obj = actRowToObj(row);
  await emit(req, 'activity.created', obj, { label: `${actTitle(t, obj)} (nuova)`, targetId: tid });
  res.status(201).json(obj);
}));

r.patch('/targets/:tid/activities/:id', requireEditor, ah(async (req, res) => {
  const tid = idParam(req.params.tid); const { id } = req.params;
  const incoming = req.body || {};
  const t = await readEditableTarget(tid);
  const cur = await readAct(tid, id);
  if (!cur) throw notFound('Attività non trovata');
  if (incoming.version != null && Number(incoming.version) !== cur.version) {
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'activity', row: actRowToObj(cur) }; throw err;
  }
  const merged = { ...actRowToObj(cur) };
  for (const k of A_FIELDS) if (k in incoming) merged[k] = incoming[k];
  const na = normAct(merged);
  const changes = diff(actRowToObj(cur), na, A_FIELDS.filter((k) => k !== 'lm'));
  if (changes.owner || changes.support) await assertPeople([na.owner, ...na.support]);
  const upd = await tx(async (c) => {
    const u = await c.query(
      `UPDATE activities SET cid=$3, nome=$4, proc=$5, sw=$6, ew=$7, owner_id=$8, dett=$9, note=$10, st=$11, pl=$12, ms=$13, fine=$14, lm=$15,
         version=version+1, updated_by=$16, updated_at=now()
       WHERE target_id=$1 AND id=$2 AND version=$17 RETURNING id`,
      [tid, id, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
        na.dett, na.note, na.st, na.pl, na.ms, na.fine, Math.max(na.lm || 0, Date.now()), req.user.id, cur.version]);
    if (!u.rows.length) return null;
    if (changes.support) await writeSupport(c, tid, id, na.support);
    return readAct(tid, id, c);
  });
  if (!upd) {
    const now = await readAct(tid, id);
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'activity', row: actRowToObj(now) }; throw err;
  }
  const obj = actRowToObj(upd);
  if (Object.keys(changes).length) {
    const label = `${actTitle(t, obj)} · ${await describe(changes)}`;
    await audit(req, 'ACTIVITY_UPDATED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: String(tid), label, data: changes });
    await emit(req, 'activity.updated', obj, { label, targetId: tid });
  }
  res.json(obj);
}));

r.delete('/targets/:tid/activities/:id', requireEditor, ah(async (req, res) => {
  const tid = idParam(req.params.tid); const { id } = req.params;
  const t = await readEditableTarget(tid);
  const cur = await readAct(tid, id);
  if (!cur) throw notFound('Attività non trovata');
  await q('DELETE FROM activities WHERE target_id=$1 AND id=$2', [tid, id]);
  const label = `${actTitle(t, actRowToObj(cur))} · attività eliminata`;
  await audit(req, 'ACTIVITY_DELETED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: String(tid), label, data: { deleted: actRowToObj(cur) } });
  await emit(req, 'activity.deleted', { target_id: tid, id }, { label, targetId: tid });
  res.json({ ok: true });
}));

r.put('/targets/:tid/order', requireEditor, ah(async (req, res) => {
  const tid = idParam(req.params.tid);
  const { ids } = parse(z.object({ ids: z.array(z.string()).max(1000) }), req.body);
  const t = await readEditableTarget(tid);
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE activities SET position=$3 WHERE target_id=$1 AND id=$2', [tid, ids[i], i]);
    await audit(req, 'ACTIVITIES_REORDERED', { entity: 'target', entityId: tid, targetId: String(tid), label: `${t.nome} · riordino attività` }, c);
  });
  await emit(req, 'activities.reordered', { target_id: tid, ids }, { label: `${t.nome} · riordino attività`, targetId: tid });
  res.json({ ok: true });
}));

// ---- team di integrazione: persone dell'anagrafica con il ruolo nel piano (sostituzione dell'elenco completo)
r.put('/team', requireEditor, ah(async (req, res) => {
  const { members } = parse(z.object({ members: z.array(z.object({
    person_id: z.coerce.number().int().positive(), r: z.string().max(120).default(''), f: z.enum(['Interna', 'Esterna']).default('Interna'),
    color: z.string().max(16).nullable().optional(), lm: z.number().optional(),
  }).passthrough()).max(200) }), req.body);
  const ids = [...new Set(members.map((m) => m.person_id))];
  const known = new Set((await many('SELECT id FROM public.people WHERE id = ANY($1::int[])', [ids])).map((p) => p.id));
  const missing = ids.filter((i) => !known.has(i));
  if (missing.length) throw bad(`Persona non trovata in anagrafica: ${missing.join(', ')}`);
  const before = await many('SELECT person_id, n, r, f FROM team_v ORDER BY position, lower(n)');
  const rows = await tx(async (c) => {
    await c.query('DELETE FROM person_ext');
    const seen = new Set();
    let i = 0;
    for (const m of members) {
      if (seen.has(m.person_id)) continue; seen.add(m.person_id);
      await c.query('INSERT INTO person_ext (person_id, position, r, f, color, lm) VALUES ($1,$2,$3,$4,$5,$6)', [m.person_id, i++, m.r, m.f, m.color || null, Math.round(m.lm || Date.now())]);
    }
    const out = (await c.query('SELECT person_id, position, r, f, color, lm, n, email, job_title, person_status FROM team_v ORDER BY position, lower(n)')).rows.map((x) => ({ ...x, lm: Number(x.lm) || 0 }));
    await audit(req, 'TEAM_UPDATED', { entity: 'team', label: 'Team di integrazione aggiornato', data: { before, after: out.map(({ person_id, n, r: rr, f }) => ({ person_id, n, r: rr, f })) } }, c);
    return out;
  });
  await emit(req, 'team.updated', { members: rows }, { label: 'team di integrazione' });
  res.json(rows);
}));

// ---- snapshot (amministratori)
r.get('/snapshots', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT s.id, s.kind, s.note, s.created_at, u.full_name AS created_by, coalesce((s.data->>'v')::int, 2) AS v,
      jsonb_array_length(s.data->'targets') AS n_targets,
      coalesce((SELECT sum(jsonb_array_length(t->'atts')) FROM jsonb_array_elements(s.data->'targets') t), 0)::int AS n_activities
    FROM snapshots s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC LIMIT 200`));
}));
r.post('/snapshots', requireAdmin, ah(async (req, res) => {
  const { note } = parse(z.object({ note: z.string().max(300).optional() }), req.body || {});
  const s = await takeSnapshot('manual', note, req.user.id);
  await audit(req, 'SNAPSHOT_CREATED', { entity: 'plan', entityId: s.id, label: `Snapshot manuale${note ? ': ' + note : ''}` });
  res.status(201).json(s);
}));
r.get('/snapshots/:id', requireAdmin, ah(async (req, res) => {
  const s = await one('SELECT * FROM snapshots WHERE id=$1', [req.params.id]);
  if (!s) throw notFound('Snapshot non trovato');
  res.json(s);
}));
r.post('/snapshots/:id/restore', requireAdmin, ah(async (req, res) => {
  const s = await one('SELECT * FROM snapshots WHERE id=$1', [req.params.id]);
  if (!s) throw notFound('Snapshot non trovato');
  const rep = await importPlan(s.data, { userId: req.user.id, replace: true });
  const label = `Ripristino snapshot #${s.id} del ${new Date(s.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}${rep.scartate ? ` (${rep.scartate} target non più in anagrafica)` : ''}`;
  await audit(req, 'PLAN_RESTORED', { entity: 'plan', entityId: s.id, label, data: rep });
  await emit(req, 'plan.replaced', {}, { label });
  res.json(rep);
}));

// ---- registro attività
r.get('/audit', ah(async (req, res) => {
  const { limit, target, action } = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).default(300), target: z.string().optional(), action: z.string().optional() }), req.query);
  const params = [limit]; let where = 'TRUE';
  if (target) { params.push(target); where += ` AND a.target_id = $${params.length}`; }
  if (action) { params.push(action); where += ` AND a.action = $${params.length}`; }
  res.json(await many(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.target_id, a.label, a.data, a.ip, u.full_name, u.email, o.name AS target_name
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN public.organizations o ON o.id::text = a.target_id WHERE ${where} ORDER BY a.at DESC, a.id DESC LIMIT $1`, params));
}));

export default r;
