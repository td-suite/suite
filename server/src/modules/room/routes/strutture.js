// Sedi: elenco dall'anagrafica unica (public.sites) con le impostazioni Room (site_ext: ambulatori, personale pianificato, orari,
// planimetria). Nessuna creazione, rinomina o disattivazione qui: si fa in Amministrazione > Sedi. La riga di site_ext nasce al
// primo salvataggio della sede in Room Planning.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse, HttpError } from '../lib/util.js';
import { canSeeStruttura, canEditStruttura, isAdmin } from '../lib/access.js';
import { BLOB_KINDS, joinStruttura, sortStrutture, validateLite, liteOf, extData, SITE_COLS } from '../lib/strutture.js';

const r = Router();
const siteId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('id sede non valido'); return n; };

// Elenco sedi (documento lite + logo) in ordine alfabetico: le sedi attive dell'anagrafica unica configurate in Room Planning.
// ?all=1 include anche le sedi attive non ancora configurate (per aprirle e configurarle).
r.get('/', ah(async (req, res) => {
  const all = req.query.all === '1';
  const rows = await many(`SELECT ${SITE_COLS}, u.full_name AS updated_by_name,
      (SELECT data FROM struttura_blobs b WHERE b.struttura_id=s.id AND b.kind='logo') AS logo,
      EXISTS (SELECT 1 FROM struttura_blobs b WHERE b.struttura_id=s.id AND b.kind='planPdf') AS has_plan
    FROM sites_v s LEFT JOIN users u ON u.id=s.updated_by WHERE s.active AND ($1::boolean OR s.configurata)`, [all]);
  const list = rows.filter((x) => canSeeStruttura(req.user, x.id)).map((x) => ({ ...liteOf(x), logo: x.logo || null,
    _version: x.version || 0, _updatedAt: x.updated_at, _updatedBy: x.updated_by_name, _hasPlan: x.has_plan }));
  res.json(sortStrutture(list));
}));

async function load(req, id, { withPdf = false } = {}) {
  const row = await one(`SELECT ${SITE_COLS}, u.full_name AS updated_by_name FROM sites_v s LEFT JOIN users u ON u.id=s.updated_by WHERE s.id=$1`, [id]);
  if (!row || (!row.active && !isAdmin(req.user))) throw notFound('Sede non trovata');
  if (!canSeeStruttura(req.user, id)) throw forbidden('Sede non autorizzata');
  const kinds = withPdf ? BLOB_KINDS : ['logo', 'planImg'];
  const blobs = Object.fromEntries((await many('SELECT kind, data FROM struttura_blobs WHERE struttura_id=$1 AND kind = ANY($2)', [id, kinds])).map((b) => [b.kind, b.data]));
  const hasPdf = withPdf ? Boolean(blobs.planPdf) : Boolean(await one(`SELECT 1 FROM struttura_blobs WHERE struttura_id=$1 AND kind='planPdf'`, [id]));
  return { row, full: joinStruttura(liteOf(row), blobs), hasPdf };
}

// Sede completa (senza PDF della planimetria, che si scarica a parte per non appesantire)
r.get('/:id', ah(async (req, res) => {
  const id = siteId(req.params.id);
  const { row, full, hasPdf } = await load(req, id);
  res.json({ struttura: full, version: row.version || 0, updatedAt: row.updated_at, updatedBy: row.updated_by_name, hasPlanPdf: hasPdf, deletedAt: null,
    configurata: Boolean(row.configurata), active: row.active, canEdit: canEditStruttura(req.user, id) && row.active });
}));

r.get('/:id/blob/:kind', ah(async (req, res) => {
  if (!BLOB_KINDS.includes(req.params.kind)) throw bad('tipo non valido');
  const id = siteId(req.params.id);
  await load(req, id, {}); // controlla permessi
  const b = await one('SELECT data FROM struttura_blobs WHERE struttura_id=$1 AND kind=$2', [id, req.params.kind]);
  res.json({ data: b ? b.data : null });
}));

const blobsSchema = z.object({ logo: z.string().nullable().optional(), planPdf: z.string().nullable().optional(), planImg: z.string().nullable().optional() }).optional();

// Le sedi si creano in Amministrazione > Sedi (anagrafica unica)
r.post('/', ah(async () => { throw new HttpError(405, 'Le sedi si creano in Amministrazione > Sedi: qui si configurano ambulatori, personale e planimetria'); }));

// Salva le impostazioni Room della sede (salvataggio automatico dal client). Controllo di concorrenza ottimistico sulla versione:
// se un collega ha salvato nel frattempo, risponde 409 con la versione corrente e il client ricarica. version 0 = sede non ancora configurata.
r.put('/:id', ah(async (req, res) => {
  const id = siteId(req.params.id);
  if (!canEditStruttura(req.user, id)) throw forbidden('Non puoi modificare questa sede');
  const { data, version, blobs } = parse(z.object({ data: z.any(), version: z.number().int(), blobs: blobsSchema }), req.body);
  const err = validateLite(data);
  if (err) throw bad(err);
  const site = await one('SELECT id, active FROM public.sites WHERE id=$1', [id]);
  if (!site) throw notFound('Sede non trovata');
  if (!site.active) throw new HttpError(409, 'La sede non è attiva nell\'anagrafica: riattivala in Amministrazione > Sedi prima di modificarla');
  const row = await one('SELECT version, updated_at, updated_by FROM site_ext WHERE site_id=$1', [id]);
  const current = row ? row.version : 0;
  if (current !== version) {
    const by = row?.updated_by ? await one('SELECT full_name FROM users WHERE id=$1', [row.updated_by]) : null;
    const e = new HttpError(409, `Un collega (${by?.full_name || 'sconosciuto'}) ha salvato questa sede nel frattempo`);
    e.code = 'VERSION_CONFLICT'; e.details = { version: current, updatedAt: row?.updated_at, updatedBy: by?.full_name };
    throw e;
  }
  const newVersion = version + 1;
  const ext = extData(data);
  await tx(async (c) => {
    await c.query(`INSERT INTO site_ext (site_id, data, version, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (site_id) DO UPDATE SET data=EXCLUDED.data, version=EXCLUDED.version, updated_at=now(), updated_by=EXCLUDED.updated_by`, [id, JSON.stringify(ext), newVersion, req.user.id]);
    for (const k of BLOB_KINDS) {
      if (!blobs || !(k in blobs)) continue; // blob non inviato = invariato
      if (blobs[k]) await c.query('INSERT INTO struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [id, k, blobs[k]]);
      else await c.query('DELETE FROM struttura_blobs WHERE struttura_id=$1 AND kind=$2', [id, k]);
    }
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,$4,$5,$6)', [id, newVersion, JSON.stringify(ext), req.user.id, req.user.full_name, version === 0 ? 'prima configurazione in Room Planning' : null]);
    // conserva al massimo 500 versioni per sede
    await c.query('DELETE FROM struttura_history WHERE struttura_id=$1 AND id NOT IN (SELECT id FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 500)', [id]);
  });
  // Schede Room dei professionisti allineate alla scheda di sede (stessa persona per chiave del nome): profilo del personale sanitario
  try {
    const { personKey } = await import('../lib/personale.js');
    const profs = await many('SELECT p.id, p.nome, p.tipo, p.profilo, p.in_room FROM professionisti_v p WHERE p.attivo');
    const byKey = new Map(profs.map((p) => [personKey(p.nome), p]));
    for (const x of data.personale || []) {
      if (!x.nome?.trim()) continue;
      const pr = byKey.get(personKey(x.nome));
      if (!pr || !pr.in_room || pr.tipo !== 'sanitario' || !x.profilo || x.profilo === pr.profilo) continue;
      await q('UPDATE person_ext SET profilo=$2, updated_at=now(), updated_by=$3 WHERE person_id=$1', [pr.id, x.profilo, req.user.id]);
    }
  } catch (e) { console.error('[sync professionisti]', e.message); }
  await audit(req, 'STRUTTURA_SAVE', 'struttura', id, { version: newVersion, blobs: blobs ? Object.keys(blobs) : [] });
  res.json({ ok: true, version: newVersion, updatedAt: new Date().toISOString(), updatedBy: req.user.full_name });
}));

// Rimuove la configurazione Room della sede (ambulatori, personale pianificato, planimetria, cronologia). La sede resta nell'anagrafica unica.
r.delete('/:id', ah(async (req, res) => {
  const id = siteId(req.params.id);
  if (!isAdmin(req.user)) throw forbidden('Solo un amministratore rimuove la configurazione di una sede');
  if (req.query.confirm !== 'DEFINITIVO') throw bad('Conferma mancante');
  const row = await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1`, [id]);
  if (!row || !row.configurata) throw notFound('Sede non configurata in Room Planning');
  await tx(async (c) => {
    await c.query('DELETE FROM struttura_blobs WHERE struttura_id=$1', [id]);
    await c.query('DELETE FROM struttura_history WHERE struttura_id=$1', [id]);
    await c.query('DELETE FROM site_ext WHERE site_id=$1', [id]);
  });
  await audit(req, 'STRUTTURA_PURGE', 'struttura', id, { denominazione: row.name });
  res.json({ ok: true, purged: true });
}));

// Cronologia versioni
r.get('/:id/history', ah(async (req, res) => {
  const id = siteId(req.params.id);
  await load(req, id);
  res.json(await many(`SELECT id, version, user_name, note, at, (SELECT count(*) FROM jsonb_array_elements(coalesce(data->'ambulatori','[]'::jsonb))) AS n_amb,
      (SELECT count(*) FROM jsonb_array_elements(coalesce(data->'personale','[]'::jsonb))) AS n_pers FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 300`, [id]));
}));
r.get('/:id/history/:hid', ah(async (req, res) => {
  const id = siteId(req.params.id);
  const { row } = await load(req, id);
  const h = await one('SELECT * FROM struttura_history WHERE id=$1 AND struttura_id=$2', [Number(req.params.hid), id]);
  if (!h) throw notFound();
  // il documento storico viene completato con l'anagrafica attuale della sede, così il confronto resta leggibile
  res.json({ ...h, data: liteOf({ ...row, data: h.data }) });
}));
r.post('/:id/history/:hid/restore', ah(async (req, res) => {
  const id = siteId(req.params.id);
  if (!canEditStruttura(req.user, id)) throw forbidden();
  const h = await one('SELECT * FROM struttura_history WHERE id=$1 AND struttura_id=$2', [Number(req.params.hid), id]);
  if (!h) throw notFound();
  const row = await one('SELECT version FROM site_ext WHERE site_id=$1', [id]);
  const newVersion = (row?.version || 0) + 1;
  const ext = extData(h.data);
  await tx(async (c) => {
    await c.query(`INSERT INTO site_ext (site_id, data, version, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (site_id) DO UPDATE SET data=EXCLUDED.data, version=EXCLUDED.version, updated_at=now(), updated_by=EXCLUDED.updated_by`, [id, JSON.stringify(ext), newVersion, req.user.id]);
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,$4,$5,$6)', [id, newVersion, JSON.stringify(ext), req.user.id, req.user.full_name, `ripristino della versione ${h.version} del ${new Date(h.at).toLocaleString('it-IT')}`]);
  });
  await audit(req, 'STRUTTURA_RESTORE_VERSION', 'struttura', id, { from: h.version, to: newVersion });
  res.json({ ok: true, version: newVersion });
}));

export default r;
