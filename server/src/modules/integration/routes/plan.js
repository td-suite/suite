import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, diff, HttpError, parse } from '../lib/util.js';
import { requireEditor, requireAdmin } from '../lib/access.js';
import { publish, sseHandler } from '../lib/events.js';
import { readPlan, readMeta, targetRowToObj, actRowToObj, normTarget, normAct, T_FIELDS, A_FIELDS, FIELD_LABELS, STATUS_LABELS, takeSnapshot, importPlan } from '../lib/plan.js';

const r = Router();

const who = (req) => req.user?.full_name || req.user?.email || 'utente';
const clientIdOf = (req) => req.get('X-Client-Id') || null;

// Etichetta leggibile della modifica per registro e notifiche in tempo reale
function describe(changes, kind) {
  const parts = [];
  for (const [k, [a, b]] of Object.entries(changes)) {
    const lab = FIELD_LABELS[k] || k;
    if (k === 'st') parts.push(`${lab}: ${STATUS_LABELS[a] ?? a} → ${STATUS_LABELS[b] ?? b}`);
    else if (k === 'support' || k === 'linee') parts.push(`${lab}: ${(a || []).join(', ') || '–'} → ${(b || []).join(', ') || '–'}`);
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

// ---- target
const targetSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/, 'identificativo non valido'),
  version: z.number().int().optional(),
}).passthrough();

r.post('/targets', requireEditor, ah(async (req, res) => {
  const body = parse(targetSchema, req.body);
  const nt = normTarget(body);
  const atts = Array.isArray(body.atts) ? body.atts : [];
  const row = await tx(async (c) => {
    const ex = await c.query('SELECT 1 FROM targets WHERE id=$1', [body.id]);
    if (ex.rows.length) throw new HttpError(409, 'Esiste già una target con questo identificativo');
    const pos = (await c.query('SELECT coalesce(max(position)+1,0) AS p FROM targets')).rows[0].p;
    const ins = await c.query(
      `INSERT INTO targets (id, position, nome, rs, ind, piva, ref, tel, mail, web, pec, fatt, pfn, ev, linee, loi, prelim, closing, hor, lm, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [body.id, pos, nt.nome, nt.rs, nt.ind, nt.piva, nt.ref, nt.tel, nt.mail, nt.web, nt.pec, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee),
        nt.loi, nt.prelim, nt.closing, nt.hor, nt.lm || Date.now(), req.user.id]);
    let i = 0;
    for (const a of atts) {
      if (!a || !a.id) continue;
      const na = normAct(a);
      await c.query(
        `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner, support, dett, note, st, pl, ms, fine, lm, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`,
        [body.id, String(a.id), i++, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner, JSON.stringify(na.support),
          na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, req.user.id]);
    }
    await audit(req, 'TARGET_CREATED', { entity: 'target', entityId: body.id, targetId: body.id, label: `Nuova target ${nt.nome || body.id} (${i} attività)` }, c);
    return ins.rows[0];
  });
  const obj = targetRowToObj(row);
  await emit(req, 'target.created', obj, { label: `nuova target ${obj.nome}`, targetId: obj.id });
  res.status(201).json(obj);
}));

r.patch('/targets/:id', requireEditor, ah(async (req, res) => {
  const id = req.params.id;
  const incoming = req.body || {};
  const cur = await one('SELECT * FROM targets WHERE id=$1', [id]);
  if (!cur) throw notFound('Target non trovata');
  if (incoming.version != null && Number(incoming.version) !== cur.version) {
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'target', row: targetRowToObj(cur) }; throw err;
  }
  const merged = { ...targetRowToObj(cur) };
  for (const k of T_FIELDS) if (k in incoming) merged[k] = incoming[k];
  const nt = normTarget(merged);
  const changes = diff(targetRowToObj(cur), { ...nt, fatt: nt.fatt === '' ? '' : Number(nt.fatt), pfn: nt.pfn === '' ? '' : Number(nt.pfn), ev: nt.ev === '' ? '' : Number(nt.ev) },
    T_FIELDS.filter((k) => k !== 'lm'));
  const upd = await one(
    `UPDATE targets SET nome=$2, rs=$3, ind=$4, piva=$5, ref=$6, tel=$7, mail=$8, web=$9, pec=$10, fatt=$11, pfn=$12, ev=$13, linee=$14,
       loi=$15, prelim=$16, closing=$17, hor=$18, lm=$19, version=version+1, updated_by=$20, updated_at=now()
     WHERE id=$1 AND version=$21 RETURNING *`,
    [id, nt.nome, nt.rs, nt.ind, nt.piva, nt.ref, nt.tel, nt.mail, nt.web, nt.pec, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee),
      nt.loi, nt.prelim, nt.closing, nt.hor, Math.max(nt.lm || 0, Date.now()), req.user.id, cur.version]);
  if (!upd) {
    const now = await one('SELECT * FROM targets WHERE id=$1', [id]);
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'target', row: targetRowToObj(now) }; throw err;
  }
  const obj = targetRowToObj(upd);
  if (Object.keys(changes).length) {
    const label = `${obj.nome} · ${describe(changes, 'scheda target')}`;
    await audit(req, 'TARGET_UPDATED', { entity: 'target', entityId: id, targetId: id, label, data: changes });
    await emit(req, 'target.updated', obj, { label, targetId: id });
  }
  res.json(obj);
}));

r.delete('/targets/:id', requireEditor, ah(async (req, res) => {
  const id = req.params.id;
  const cur = await one('SELECT * FROM targets WHERE id=$1', [id]);
  if (!cur) throw notFound('Target non trovata');
  await tx(async (c) => {
    await takeSnapshot('pre-delete', `Eliminazione target ${cur.nome}`, req.user.id, c);
    await c.query('DELETE FROM targets WHERE id=$1', [id]);
    await audit(req, 'TARGET_DELETED', { entity: 'target', entityId: id, targetId: id, label: `Eliminata target ${cur.nome}` }, c);
  });
  await emit(req, 'target.deleted', { id }, { label: `eliminata target ${cur.nome}`, targetId: id });
  res.json({ ok: true });
}));

// ---- attività
r.post('/targets/:tid/activities', requireEditor, ah(async (req, res) => {
  const tid = req.params.tid;
  const t = await one('SELECT * FROM targets WHERE id=$1', [tid]);
  if (!t) throw notFound('Target non trovata');
  const body = req.body || {};
  const id = String(body.id || '').trim();
  if (!id || id.length > 80) throw bad('Identificativo attività non valido');
  const na = normAct(body);
  const row = await tx(async (c) => {
    const pos = (await c.query('SELECT coalesce(max(position)+1,0) AS p FROM activities WHERE target_id=$1', [tid])).rows[0].p;
    const ins = await c.query(
      `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner, support, dett, note, st, pl, ms, fine, lm, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (target_id, id) DO NOTHING RETURNING *`,
      [tid, id, pos, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner, JSON.stringify(na.support),
        na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm || Date.now(), req.user.id]);
    if (!ins.rows.length) throw new HttpError(409, 'Attività già presente');
    const a = actRowToObj(ins.rows[0]);
    await audit(req, 'ACTIVITY_CREATED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: tid, label: `${actTitle(t, a)} · nuova attività` }, c);
    return ins.rows[0];
  });
  const obj = actRowToObj(row);
  await emit(req, 'activity.created', obj, { label: `${actTitle(t, obj)} (nuova)`, targetId: tid });
  res.status(201).json(obj);
}));

r.patch('/targets/:tid/activities/:id', requireEditor, ah(async (req, res) => {
  const { tid, id } = req.params;
  const incoming = req.body || {};
  const t = await one('SELECT * FROM targets WHERE id=$1', [tid]);
  if (!t) throw notFound('Target non trovata');
  const cur = await one('SELECT * FROM activities WHERE target_id=$1 AND id=$2', [tid, id]);
  if (!cur) throw notFound('Attività non trovata');
  if (incoming.version != null && Number(incoming.version) !== cur.version) {
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'activity', row: actRowToObj(cur) }; throw err;
  }
  const merged = { ...actRowToObj(cur) };
  for (const k of A_FIELDS) if (k in incoming) merged[k] = incoming[k];
  const na = normAct(merged);
  const changes = diff(actRowToObj(cur), na, A_FIELDS.filter((k) => k !== 'lm'));
  const upd = await one(
    `UPDATE activities SET cid=$3, nome=$4, proc=$5, sw=$6, ew=$7, owner=$8, support=$9, dett=$10, note=$11, st=$12, pl=$13, ms=$14, fine=$15, lm=$16,
       version=version+1, updated_by=$17, updated_at=now()
     WHERE target_id=$1 AND id=$2 AND version=$18 RETURNING *`,
    [tid, id, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner, JSON.stringify(na.support),
      na.dett, na.note, na.st, na.pl, na.ms, na.fine, Math.max(na.lm || 0, Date.now()), req.user.id, cur.version]);
  if (!upd) {
    const now = await one('SELECT * FROM activities WHERE target_id=$1 AND id=$2', [tid, id]);
    const err = new HttpError(409, 'Modificata da un altro utente'); err.current = { kind: 'activity', row: actRowToObj(now) }; throw err;
  }
  const obj = actRowToObj(upd);
  if (Object.keys(changes).length) {
    const label = `${actTitle(t, obj)} · ${describe(changes)}`;
    await audit(req, 'ACTIVITY_UPDATED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: tid, label, data: changes });
    await emit(req, 'activity.updated', obj, { label, targetId: tid });
  }
  res.json(obj);
}));

r.delete('/targets/:tid/activities/:id', requireEditor, ah(async (req, res) => {
  const { tid, id } = req.params;
  const t = await one('SELECT * FROM targets WHERE id=$1', [tid]);
  const cur = await one('SELECT * FROM activities WHERE target_id=$1 AND id=$2', [tid, id]);
  if (!t || !cur) throw notFound('Attività non trovata');
  await q('DELETE FROM activities WHERE target_id=$1 AND id=$2', [tid, id]);
  const label = `${actTitle(t, actRowToObj(cur))} · attività eliminata`;
  await audit(req, 'ACTIVITY_DELETED', { entity: 'activity', entityId: `${tid}/${id}`, targetId: tid, label, data: { deleted: actRowToObj(cur) } });
  await emit(req, 'activity.deleted', { target_id: tid, id }, { label, targetId: tid });
  res.json({ ok: true });
}));

r.put('/targets/:tid/order', requireEditor, ah(async (req, res) => {
  const tid = req.params.tid;
  const { ids } = parse(z.object({ ids: z.array(z.string()).max(1000) }), req.body);
  const t = await one('SELECT * FROM targets WHERE id=$1', [tid]);
  if (!t) throw notFound('Target non trovata');
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE activities SET position=$3 WHERE target_id=$1 AND id=$2', [tid, ids[i], i]);
    await audit(req, 'ACTIVITIES_REORDERED', { entity: 'target', entityId: tid, targetId: tid, label: `${t.nome} · riordino attività` }, c);
  });
  await emit(req, 'activities.reordered', { target_id: tid, ids }, { label: `${t.nome} · riordino attività`, targetId: tid });
  res.json({ ok: true });
}));

// ---- team (registro ruoli): sostituzione dell'elenco completo
r.put('/team', requireEditor, ah(async (req, res) => {
  const { members } = parse(z.object({ members: z.array(z.object({ r: z.string().max(120).default(''), f: z.string().max(40).default('Interna'), n: z.string().max(160).default(''), lm: z.number().optional() }).passthrough()).max(200) }), req.body);
  const before = await many('SELECT r, f, n FROM team ORDER BY position, id');
  const rows = await tx(async (c) => {
    await c.query('DELETE FROM team');
    const out = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const ins = await c.query('INSERT INTO team (position, r, f, n, lm) VALUES ($1,$2,$3,$4,$5) RETURNING id, position, r, f, n, lm', [i, m.r, m.f, m.n, Math.round(m.lm || Date.now())]);
      out.push(ins.rows[0]);
    }
    await audit(req, 'TEAM_UPDATED', { entity: 'team', label: 'Registro ruoli aggiornato', data: { before, after: out.map(({ r: rr, f, n }) => ({ r: rr, f, n })) } }, c);
    return out;
  });
  await emit(req, 'team.updated', { members: rows }, { label: 'registro ruoli' });
  res.json(rows);
}));

// ---- import / snapshot (amministratori)
r.post('/plan/import', requireAdmin, ah(async (req, res) => {
  const st = req.body || {};
  if (!Array.isArray(st.targets) || !st.targets.length) throw bad('File senza target');
  const rep = await importPlan(st, { userId: req.user.id });
  const label = `Import da file: ${rep.tN} target nuove, ${rep.tU} aggiornate, ${rep.aN} attività nuove, ${rep.aU} aggiornate`;
  await audit(req, 'PLAN_IMPORTED', { entity: 'plan', label, data: rep });
  await emit(req, 'plan.replaced', {}, { label });
  res.json(rep);
}));

r.get('/snapshots', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT s.id, s.kind, s.note, s.created_at, u.full_name AS created_by,
      jsonb_array_length(s.data->'targets') AS n_targets,
      (SELECT sum(jsonb_array_length(t->'atts')) FROM jsonb_array_elements(s.data->'targets') t)::int AS n_activities
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
  const label = `Ripristino snapshot #${s.id} del ${new Date(s.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`;
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
  res.json(await many(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.target_id, a.label, a.data, a.ip, u.full_name, u.email
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.at DESC, a.id DESC LIMIT $1`, params));
}));

export default r;
