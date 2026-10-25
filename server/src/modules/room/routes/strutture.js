import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse, HttpError } from '../lib/util.js';
import { canSeeStruttura, canEditStruttura, canEdit, isAdmin } from '../lib/access.js';
import { BLOB_KINDS, splitStruttura, joinStruttura, sortStrutture, validateLite } from '../lib/strutture.js';

const r = Router();

const visible = (u) => (rows) => rows.filter((s) => canSeeStruttura(u, s.id));
const stripId = (rows) => rows;

// Elenco sedi (documento lite + logo) in ordine alfabetico. ?deleted=1 (admin) elenca il cestino.
r.get('/', ah(async (req, res) => {
  const deleted = req.query.deleted === '1';
  if (deleted && !isAdmin(req.user)) throw forbidden();
  const rows = await many(`SELECT s.id, s.data, s.version, s.updated_at, s.deleted_at, u.full_name AS updated_by_name,
      (SELECT data FROM struttura_blobs b WHERE b.struttura_id=s.id AND b.kind='logo') AS logo,
      EXISTS (SELECT 1 FROM struttura_blobs b WHERE b.struttura_id=s.id AND b.kind='planPdf') AS has_plan
    FROM strutture s LEFT JOIN users u ON u.id=s.updated_by WHERE s.deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}`);
  const list = visible(req.user)(rows).map((x) => ({ ...x.data, logo: x.logo || null, plan: { markers: x.data.plan?.markers || {} },
    _version: x.version, _updatedAt: x.updated_at, _updatedBy: x.updated_by_name, _deletedAt: x.deleted_at, _hasPlan: x.has_plan }));
  res.json(sortStrutture(list));
}));

async function load(req, id, { withPdf = false } = {}) {
  const row = await one('SELECT s.*, u.full_name AS updated_by_name FROM strutture s LEFT JOIN users u ON u.id=s.updated_by WHERE s.id=$1', [id]);
  if (!row || (row.deleted_at && !isAdmin(req.user))) throw notFound('Sede non trovata');
  if (!canSeeStruttura(req.user, id)) throw forbidden('Sede non autorizzata');
  const kinds = withPdf ? BLOB_KINDS : ['logo', 'planImg'];
  const blobs = Object.fromEntries((await many('SELECT kind, data FROM struttura_blobs WHERE struttura_id=$1 AND kind = ANY($2)', [id, kinds])).map((b) => [b.kind, b.data]));
  const hasPdf = withPdf ? Boolean(blobs.planPdf) : Boolean(await one(`SELECT 1 FROM struttura_blobs WHERE struttura_id=$1 AND kind='planPdf'`, [id]));
  return { row, full: joinStruttura(row.data, blobs), hasPdf };
}

// Sede completa (senza PDF della planimetria, che si scarica a parte per non appesantire)
r.get('/:id', ah(async (req, res) => {
  const { row, full, hasPdf } = await load(req, req.params.id);
  res.json({ struttura: full, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by_name, hasPlanPdf: hasPdf, deletedAt: row.deleted_at,
    canEdit: canEditStruttura(req.user, row.id) && !row.deleted_at });
}));

r.get('/:id/blob/:kind', ah(async (req, res) => {
  if (!BLOB_KINDS.includes(req.params.kind)) throw bad('tipo non valido');
  await load(req, req.params.id, {}); // controlla permessi
  const b = await one('SELECT data FROM struttura_blobs WHERE struttura_id=$1 AND kind=$2', [req.params.id, req.params.kind]);
  res.json({ data: b ? b.data : null });
}));

const blobsSchema = z.object({ logo: z.string().nullable().optional(), planPdf: z.string().nullable().optional(), planImg: z.string().nullable().optional() }).optional();

// Crea sede
r.post('/', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Profilo in sola consultazione');
  if (!isAdmin(req.user) && (req.user.struttura_ids || []).length) throw forbidden('Il tuo profilo è limitato alle sedi assegnate: la creazione spetta a un amministratore');
  const { data, blobs } = parse(z.object({ data: z.any(), blobs: blobsSchema }), req.body);
  const err = validateLite(data);
  if (err) throw bad(err);
  if (await one('SELECT 1 FROM strutture WHERE id=$1', [data.id])) throw bad('Esiste già una sede con questo id');
  await tx(async (c) => {
    await c.query('INSERT INTO strutture (id, data, version, updated_by) VALUES ($1,$2,1,$3)', [data.id, JSON.stringify(data), req.user.id]);
    for (const k of BLOB_KINDS) if (blobs?.[k]) await c.query('INSERT INTO struttura_blobs (struttura_id, kind, data) VALUES ($1,$2,$3)', [data.id, k, blobs[k]]);
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,1,$2,$3,$4,$5)', [data.id, JSON.stringify(data), req.user.id, req.user.full_name, 'creazione']);
  });
  await audit(req, 'STRUTTURA_CREATE', 'struttura', data.id, { denominazione: data.denominazione });
  res.status(201).json({ ok: true, version: 1 });
}));

// Salva sede (salvataggio automatico dal client). Controllo di concorrenza ottimistico sulla versione:
// se un collega ha salvato nel frattempo, risponde 409 con la versione corrente e il client ricarica.
r.put('/:id', ah(async (req, res) => {
  const id = req.params.id;
  if (!canEditStruttura(req.user, id)) throw forbidden('Non puoi modificare questa sede');
  const { data, version, blobs } = parse(z.object({ data: z.any(), version: z.number().int(), blobs: blobsSchema }), req.body);
  if (data.id !== id) throw bad('id incoerente');
  const err = validateLite(data);
  if (err) throw bad(err);
  const row = await one('SELECT version, deleted_at, updated_at, updated_by FROM strutture WHERE id=$1', [id]);
  if (!row) throw notFound('Sede non trovata');
  if (row.deleted_at) throw new HttpError(409, 'La sede è nel cestino: ripristinala prima di modificarla');
  if (row.version !== version) {
    const by = row.updated_by ? await one('SELECT full_name FROM users WHERE id=$1', [row.updated_by]) : null;
    const e = new HttpError(409, `Un collega (${by?.full_name || 'sconosciuto'}) ha salvato questa sede nel frattempo`);
    e.code = 'VERSION_CONFLICT'; e.details = { version: row.version, updatedAt: row.updated_at, updatedBy: by?.full_name };
    throw e;
  }
  const newVersion = version + 1;
  await tx(async (c) => {
    await c.query('UPDATE strutture SET data=$2, version=$3, updated_at=now(), updated_by=$4 WHERE id=$1', [id, JSON.stringify(data), newVersion, req.user.id]);
    for (const k of BLOB_KINDS) {
      if (!blobs || !(k in blobs)) continue; // blob non inviato = invariato
      if (blobs[k]) await c.query('INSERT INTO struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [id, k, blobs[k]]);
      else await c.query('DELETE FROM struttura_blobs WHERE struttura_id=$1 AND kind=$2', [id, k]);
    }
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name) VALUES ($1,$2,$3,$4,$5)', [id, newVersion, JSON.stringify(data), req.user.id, req.user.full_name]);
    // conserva al massimo 500 versioni per sede
    await c.query('DELETE FROM struttura_history WHERE struttura_id=$1 AND id NOT IN (SELECT id FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 500)', [id]);
  });
  // Anagrafica dei professionisti allineata alla scheda di sede (stessa persona per chiave del nome): email e profilo
  try {
    const { personKey } = await import('../lib/personale.js');
    for (const x of data.personale || []) {
      if (!x.nome?.trim()) continue;
      const pr = await one('SELECT id, email, profilo, tipo FROM professionisti WHERE persona_key=$1', [personKey(x.nome)]);
      if (!pr) continue;
      const email = x.email || pr.email || null, profilo = (pr.tipo === 'sanitario' && x.profilo) ? x.profilo : pr.profilo;
      if (email !== pr.email || profilo !== pr.profilo) await q('UPDATE professionisti SET email=$2, profilo=$3, updated_at=now(), updated_by=$4 WHERE id=$1', [pr.id, email, profilo, req.user.id]);
    }
  } catch (e) { console.error('[sync professionisti]', e.message); }
  await audit(req, 'STRUTTURA_SAVE', 'struttura', id, { version: newVersion, blobs: blobs ? Object.keys(blobs) : [] });
  res.json({ ok: true, version: newVersion, updatedAt: new Date().toISOString(), updatedBy: req.user.full_name });
}));

// Cestino: eliminazione soft (ripristinabile), definitiva solo dal cestino
r.delete('/:id', ah(async (req, res) => {
  const id = req.params.id;
  if (!canEditStruttura(req.user, id)) throw forbidden();
  const row = await one('SELECT data, deleted_at FROM strutture WHERE id=$1', [id]);
  if (!row) throw notFound();
  if (row.deleted_at) {
    if (!isAdmin(req.user)) throw forbidden('Solo un amministratore elimina definitivamente');
    if (req.query.confirm !== 'DEFINITIVO') throw bad('Conferma mancante');
    await q('DELETE FROM strutture WHERE id=$1', [id]);
    await audit(req, 'STRUTTURA_PURGE', 'struttura', id, { denominazione: row.data.denominazione });
    return res.json({ ok: true, purged: true });
  }
  await q('UPDATE strutture SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [id, req.user.id]);
  await audit(req, 'STRUTTURA_DELETE', 'struttura', id, { denominazione: row.data.denominazione });
  res.json({ ok: true });
}));

r.post('/:id/restore', ah(async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden();
  const row = await one('SELECT data FROM strutture WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id]);
  if (!row) throw notFound();
  await q('UPDATE strutture SET deleted_at=NULL, deleted_by=NULL WHERE id=$1', [req.params.id]);
  await audit(req, 'STRUTTURA_RESTORE', 'struttura', req.params.id, { denominazione: row.data.denominazione });
  res.json({ ok: true });
}));

// Cronologia versioni
r.get('/:id/history', ah(async (req, res) => {
  await load(req, req.params.id);
  res.json(await many(`SELECT id, version, user_name, note, at, (SELECT count(*) FROM jsonb_array_elements(data->'ambulatori')) AS n_amb,
      (SELECT count(*) FROM jsonb_array_elements(data->'personale')) AS n_pers FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 300`, [req.params.id]));
}));
r.get('/:id/history/:hid', ah(async (req, res) => {
  await load(req, req.params.id);
  const h = await one('SELECT * FROM struttura_history WHERE id=$1 AND struttura_id=$2', [Number(req.params.hid), req.params.id]);
  if (!h) throw notFound();
  res.json(h);
}));
r.post('/:id/history/:hid/restore', ah(async (req, res) => {
  const id = req.params.id;
  if (!canEditStruttura(req.user, id)) throw forbidden();
  const h = await one('SELECT * FROM struttura_history WHERE id=$1 AND struttura_id=$2', [Number(req.params.hid), id]);
  if (!h) throw notFound();
  const row = await one('SELECT version FROM strutture WHERE id=$1', [id]);
  const newVersion = row.version + 1;
  await tx(async (c) => {
    await c.query('UPDATE strutture SET data=$2, version=$3, updated_at=now(), updated_by=$4, deleted_at=NULL WHERE id=$1', [id, JSON.stringify(h.data), newVersion, req.user.id]);
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,$4,$5,$6)', [id, newVersion, JSON.stringify(h.data), req.user.id, req.user.full_name, `ripristino della versione ${h.version} del ${new Date(h.at).toLocaleString('it-IT')}`]);
  });
  await audit(req, 'STRUTTURA_RESTORE_VERSION', 'struttura', id, { from: h.version, to: newVersion });
  res.json({ ok: true, version: newVersion });
}));

export default r;
