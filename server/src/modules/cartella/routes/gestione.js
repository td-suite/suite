// Cartella condivisa, gestione (profilo ADMIN): cartelle (crea, rinomina, sposta, elimina), documenti (carica, rinomina,
// descrizione, sposta, evidenza, nuova versione, elimina). Ogni scrittura lascia un evento nel modulo e una riga nell'audit della Suite.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { q, one, many, tx } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad, HttpError } from '../../../lib/util.js';
import { config } from '../config.js';
import { KEY, idOf, cartellaIdOf, extOf, mimeFor, loadDocumento, loadCartella, evento, indexDocumento, unindexDocumento, reindexSottoalbero } from '../lib/core.js';

const r = Router();
const MB = 1024 * 1024;

const soloAdmin = (req, _res, next) => (req.moduleUser?.role === 'ADMIN' ? next() : next(forbidden('Operazione riservata alla gestione della cartella condivisa')));

const nomeSchema = z.string().trim().min(1, 'indica il nome').max(120).refine((s) => !/[\\/]/.test(s), 'il nome non può contenere barre');
const docNomeSchema = z.string().trim().min(1, 'indica il nome').max(200).refine((s) => !/[\\/]/.test(s), 'il nome non può contenere barre');
const parentSchema = z.union([z.coerce.number().int().positive(), z.null()]).optional();

async function cartellaEsistente(id) {
  if (id == null) return null;
  const c = await one('SELECT id FROM cartelle WHERE id=$1', [id]);
  if (!c) throw bad('Cartella di destinazione non trovata');
  return c.id;
}
const duplicatoCartella = (e) => e.code === '23505' && /cartelle_nome_unica/.test(e.constraint || e.message || '');
const duplicatoDocumento = (e) => e.code === '23505' && /documenti_nome_unico/.test(e.constraint || e.message || '');

// ---- Cartelle
r.post('/cartelle', soloAdmin, ah(async (req, res) => {
  const b = parse(z.object({ nome: nomeSchema, descrizione: z.string().trim().max(1000).optional().default(''), parent_id: parentSchema }), req.body || {});
  const parent = await cartellaEsistente(b.parent_id ?? null);
  let c;
  try { c = await one('INSERT INTO cartelle (parent_id, nome, descrizione, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id', [parent, b.nome, b.descrizione, req.user.id]); }
  catch (e) { if (duplicatoCartella(e)) throw new HttpError(409, `Esiste già una cartella "${b.nome}" in questa posizione`); throw e; }
  await evento('CARTELLA_CREATA', req.user.id, { cartella_id: c.id, dati: { nome: b.nome, parent_id: parent } });
  await audit(req, 'CARTELLA_CARTELLA_CREATA', { module: KEY, entity: 'cartella', entityId: c.id, label: b.nome });
  res.status(201).json(await loadCartella(c.id));
}));

r.put('/cartelle/:id', soloAdmin, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Cartella non trovata');
  const c = await loadCartella(id);
  if (!c) throw notFound('Cartella non trovata');
  const b = parse(z.object({ nome: nomeSchema.optional(), descrizione: z.string().trim().max(1000).optional(), parent_id: parentSchema, sort_order: z.coerce.number().int().optional() }), req.body || {});
  const sets = []; const params = [id]; const p = (v) => { params.push(v); return `$${params.length}`; };
  let spostata = false;
  if (b.parent_id !== undefined && (b.parent_id ?? null) !== c.parent_id) {
    const dest = await cartellaEsistente(b.parent_id ?? null);
    if (dest) {
      // controllo dei cicli: la destinazione non può essere la cartella stessa né una sua discendente
      const ciclo = await one('SELECT 1 FROM discendenti($1) WHERE id=$2', [id, dest]);
      if (ciclo) throw bad('Non puoi spostare una cartella dentro se stessa o in una sua sottocartella');
    }
    sets.push(`parent_id=${p(dest)}`); spostata = true;
  }
  if (b.nome !== undefined && b.nome !== c.nome) sets.push(`nome=${p(b.nome)}`);
  if (b.descrizione !== undefined) sets.push(`descrizione=${p(b.descrizione)}`);
  if (b.sort_order !== undefined) sets.push(`sort_order=${p(b.sort_order)}`);
  if (!sets.length) return res.json(c);
  try { await q(`UPDATE cartelle SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params); }
  catch (e) { if (duplicatoCartella(e)) throw new HttpError(409, 'Esiste già una cartella con questo nome nella destinazione'); throw e; }
  const dopo = await loadCartella(id);
  if (spostata) { await evento('CARTELLA_SPOSTATA', req.user.id, { cartella_id: id, dati: { da: c.percorso, a: dopo.percorso } }); await audit(req, 'CARTELLA_CARTELLA_SPOSTATA', { module: KEY, entity: 'cartella', entityId: id, label: dopo.nome, data: { da: c.percorso, a: dopo.percorso } }); }
  if (b.nome !== undefined && b.nome !== c.nome) { await evento('CARTELLA_RINOMINATA', req.user.id, { cartella_id: id, dati: { da: c.nome, a: b.nome } }); await audit(req, 'CARTELLA_CARTELLA_RINOMINATA', { module: KEY, entity: 'cartella', entityId: id, label: b.nome, data: { da: c.nome } }); }
  if (spostata || (b.nome !== undefined && b.nome !== c.nome)) await reindexSottoalbero(id);
  res.json(dopo);
}));

r.delete('/cartelle/:id', soloAdmin, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Cartella non trovata');
  const c = await loadCartella(id);
  if (!c) throw notFound('Cartella non trovata');
  const tot = await one('SELECT (SELECT count(*)::int FROM documenti WHERE cartella_id IN (SELECT id FROM discendenti($1))) AS documenti, (SELECT count(*)::int FROM discendenti($1)) - 1 AS sottocartelle', [id]);
  if (tot.documenti || tot.sottocartelle) throw bad(`La cartella non è vuota: ${tot.sottocartelle} sottocartelle e ${tot.documenti} documenti. Spostali o eliminali prima.`, { sottocartelle: tot.sottocartelle, documenti: tot.documenti });
  await q('DELETE FROM cartelle WHERE id=$1', [id]);
  await evento('CARTELLA_ELIMINATA', req.user.id, { cartella_id: id, dati: { nome: c.nome, percorso: c.percorso } });
  await audit(req, 'CARTELLA_CARTELLA_ELIMINATA', { module: KEY, entity: 'cartella', entityId: id, label: c.nome });
  res.json({ ok: true });
}));

// ---- Documenti: caricamento (più file, campo "file"), in memoria. sostituisci=1: un nome già presente diventa nuova versione
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: config.maxFilesPerUpload } }).array('file', config.maxFilesPerUpload);
const conUpload = (req, res, next) => upload(req, res, (e) => {
  if (!e) return next();
  if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${config.maxFileBytes / MB} MB)`));
  if (e.code === 'LIMIT_FILE_COUNT') return next(bad(`Massimo ${config.maxFilesPerUpload} file per caricamento`));
  next(bad(e.message));
});

async function nuovaVersione(req, docId, file) {
  const mime = mimeFor(file.originalname);
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM documenti WHERE id=$1 FOR UPDATE', [docId])).rows[0];
    if (!cur) throw notFound('Documento non trovato');
    await c.query('INSERT INTO versioni (documento_id, versione, filename, mime, size, data, caricato_da_user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [cur.id, cur.versione, cur.filename, cur.mime, cur.size, cur.data, cur.caricato_da_user_id, cur.updated_at]);
    await c.query('UPDATE documenti SET filename=$2, mime=$3, size=$4, data=$5, caricato_da_user_id=$6, versione=versione+1, updated_at=now() WHERE id=$1',
      [cur.id, file.originalname.slice(0, 200), mime, file.size, file.buffer, req.user.id]);
    await evento('VERSIONE', req.user.id, { documento_id: cur.id, cartella_id: cur.cartella_id, dati: { versione: cur.versione + 1, filename: file.originalname, size: file.size } }, c);
    return cur.versione + 1;
  });
}

async function caricaIn(req, res, cartellaId) {
  const files = req.files || [];
  if (!files.length) throw bad('Nessun file ricevuto (campo "file")');
  const sostituisci = ['1', 'true'].includes(String(req.body?.sostituisci || req.query?.sostituisci || ''));
  const descrizione = String(req.body?.descrizione || '').trim().slice(0, 1000);
  const caricati = []; const errori = [];
  for (const f of files) {
    const nomeOrig = String(f.originalname || 'file').slice(0, 200);
    const ext = extOf(nomeOrig); const mime = mimeFor(nomeOrig);
    if (!mime) { errori.push({ filename: nomeOrig, codice: 'TIPO', error: `Tipo di file non ammesso (.${ext || '?'}): consentiti ${config.allowedExt.join(', ')}` }); continue; }
    const esistente = await one('SELECT id, versione FROM documenti WHERE coalesce(cartella_id,0)=coalesce($1,0) AND lower(nome)=lower($2)', [cartellaId, nomeOrig]);
    if (esistente) {
      if (!sostituisci) { errori.push({ filename: nomeOrig, codice: 'DUPLICATO', documento_id: esistente.id, error: `Esiste già "${nomeOrig}" in questa cartella (versione ${esistente.versione}): caricalo come nuova versione o rinomina il file` }); continue; }
      const v = await nuovaVersione(req, esistente.id, f);
      await audit(req, 'CARTELLA_VERSIONE', { module: KEY, entity: 'documento', entityId: esistente.id, label: nomeOrig, data: { versione: v, size: f.size } });
      const d = await loadDocumento(esistente.id, req.user.id); await indexDocumento(d);
      caricati.push({ ...d, nuova_versione: true });
      continue;
    }
    let row;
    try {
      row = await one('INSERT INTO documenti (cartella_id, nome, filename, mime, size, data, descrizione, caricato_da_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [cartellaId, nomeOrig, nomeOrig, mime, f.size, f.buffer, descrizione, req.user.id]);
    } catch (e) { if (duplicatoDocumento(e)) { errori.push({ filename: nomeOrig, codice: 'DUPLICATO', error: `Esiste già "${nomeOrig}" in questa cartella` }); continue; } throw e; }
    // chi carica ha già visto il documento
    await q('INSERT INTO letture (documento_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, req.user.id]);
    await evento('CARICATO', req.user.id, { documento_id: row.id, cartella_id: cartellaId, dati: { filename: nomeOrig, size: f.size, mime } });
    await audit(req, 'CARTELLA_CARICATO', { module: KEY, entity: 'documento', entityId: row.id, label: nomeOrig, data: { size: f.size, mime, cartella_id: cartellaId } });
    const d = await loadDocumento(row.id, req.user.id); await indexDocumento(d);
    caricati.push(d);
  }
  if (!caricati.length) throw bad(errori.length === 1 ? errori[0].error : `Nessun file caricato: ${errori.map((e) => `${e.filename}: ${e.error}`).join('; ')}`, { caricati, errori });
  res.status(201).json({ caricati, errori });
}
r.post('/cartelle/:id/documenti', soloAdmin, conUpload, ah(async (req, res) => {
  const cid = cartellaIdOf(req.params.id);
  if (cid && !(await one('SELECT 1 FROM cartelle WHERE id=$1', [cid]))) throw notFound('Cartella non trovata');
  await caricaIn(req, res, cid);
}));
r.post('/documenti', soloAdmin, conUpload, ah(async (req, res) => {
  const cid = cartellaIdOf(req.body?.cartella_id);
  if (cid && !(await one('SELECT 1 FROM cartelle WHERE id=$1', [cid]))) throw notFound('Cartella non trovata');
  await caricaIn(req, res, cid);
}));

// ---- Modifica: nome, descrizione, cartella, evidenza
r.put('/documenti/:id', soloAdmin, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Documento non trovato');
  const d = await loadDocumento(id, req.user.id);
  if (!d) throw notFound('Documento non trovato');
  const b = parse(z.object({ nome: docNomeSchema.optional(), descrizione: z.string().trim().max(1000).optional(), cartella_id: parentSchema,
    in_evidenza: z.boolean().optional(), evidenza_fino: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG'), z.null()]).optional() }), req.body || {});
  const sets = []; const params = [id]; const p = (v) => { params.push(v); return `$${params.length}`; };
  const ev = [];
  if (b.nome !== undefined && b.nome !== d.nome) { sets.push(`nome=${p(b.nome)}`); ev.push(['RINOMINATO', { da: d.nome, a: b.nome }]); }
  if (b.descrizione !== undefined && b.descrizione !== d.descrizione) { sets.push(`descrizione=${p(b.descrizione)}`); ev.push(['MODIFICATO', { descrizione: b.descrizione.slice(0, 200) }]); }
  if (b.cartella_id !== undefined && (b.cartella_id ?? null) !== d.cartella_id) {
    const dest = await cartellaEsistente(b.cartella_id ?? null);
    sets.push(`cartella_id=${p(dest)}`);
    const a = dest ? (await loadCartella(dest)).percorso : null;
    ev.push(['SPOSTATO', { da: d.percorso || null, a }]);
  }
  if (b.in_evidenza !== undefined || b.evidenza_fino !== undefined) {
    const inEv = b.in_evidenza ?? d.in_evidenza;
    const fino = inEv ? (b.evidenza_fino !== undefined ? b.evidenza_fino : d.evidenza_fino) : null;
    sets.push(`in_evidenza=${p(inEv)}`, `evidenza_fino=${p(fino)}`);
    if (inEv !== d.in_evidenza || String(fino || '') !== String(d.evidenza_fino ? new Date(d.evidenza_fino).toISOString().slice(0, 10) : '')) ev.push(['EVIDENZA', { in_evidenza: inEv, fino }]);
  }
  if (!sets.length) return res.json(d);
  try { await q(`UPDATE documenti SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params); }
  catch (e) { if (duplicatoDocumento(e)) throw new HttpError(409, 'Esiste già un documento con questo nome nella cartella'); throw e; }
  for (const [tipo, dati] of ev) { await evento(tipo, req.user.id, { documento_id: id, cartella_id: d.cartella_id, dati }); await audit(req, `CARTELLA_${tipo}`, { module: KEY, entity: 'documento', entityId: id, label: b.nome || d.nome, data: dati }); }
  const dopo = await loadDocumento(id, req.user.id);
  await indexDocumento(dopo);
  res.json(dopo);
}));

// ---- Nuova versione (un solo file; stesso nome mostrato, versione + 1)
r.post('/documenti/:id/versione', soloAdmin, conUpload, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Documento non trovato');
  const d = await loadDocumento(id, req.user.id);
  if (!d) throw notFound('Documento non trovato');
  const f = (req.files || [])[0];
  if (!f) throw bad('Nessun file ricevuto (campo "file")');
  if (!mimeFor(f.originalname)) throw bad(`Tipo di file non ammesso: consentiti ${config.allowedExt.join(', ')}`);
  const v = await nuovaVersione(req, id, f);
  await audit(req, 'CARTELLA_VERSIONE', { module: KEY, entity: 'documento', entityId: id, label: d.nome, data: { versione: v, filename: f.originalname, size: f.size } });
  const dopo = await loadDocumento(id, req.user.id);
  await indexDocumento(dopo);
  res.status(201).json(dopo);
}));

r.delete('/documenti/:id', soloAdmin, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Documento non trovato');
  const d = await loadDocumento(id, req.user.id);
  if (!d) throw notFound('Documento non trovato');
  await q('DELETE FROM documenti WHERE id=$1', [id]);
  await unindexDocumento(id);
  await evento('ELIMINATO', req.user.id, { documento_id: id, cartella_id: d.cartella_id, dati: { nome: d.nome, filename: d.filename, percorso: d.percorso, versione: d.versione } });
  await audit(req, 'CARTELLA_ELIMINATO', { module: KEY, entity: 'documento', entityId: id, label: d.nome, data: { percorso: d.percorso } });
  res.json({ ok: true });
}));

// ---- Cronologia del modulo (ultimi 200 eventi), per la pagina Gestione
r.get('/eventi', soloAdmin, ah(async (req, res) => {
  res.json(await many(`SELECT e.id, e.tipo, e.documento_id, e.cartella_id, e.user_id, u.full_name AS user_nome, e.dati, e.created_at,
      d.nome AS documento_nome, c.nome AS cartella_nome
    FROM eventi e LEFT JOIN public.users u ON u.id=e.user_id LEFT JOIN documenti d ON d.id=e.documento_id LEFT JOIN cartelle c ON c.id=e.cartella_id
    ORDER BY e.created_at DESC, e.id DESC LIMIT 200`));
}));

export default r;
