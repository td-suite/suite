// File: caricamento su Azure Blob Storage (metadati in tabella files), cartella personale con quota, download con controllo
// dei permessi, avatar. Senza Blob configurato le rotte rispondono 503 con codice BLOB_DISABLED.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, notFound, forbidden, HttpError } from '../lib/util.js';
import { isAdmin, hasModule } from '../lib/access.js';
import { canSee } from '../lib/audience.js';
import * as blob from '../lib/blob.js';

const r = Router();
const MB = 1024 * 1024;
const SCOPES = ['PERSONAL', 'POST', 'NEWS', 'AVATAR', 'DOC'];
const AVATAR_MAX = 3 * MB;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// multer in memoria: il contenuto va dritto sul Blob, mai su disco
const uploader = (limitBytes) => {
  const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: limitBytes, files: 1 } }).single('file');
  return (req, res, next) => m(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${Math.round(limitBytes / MB)} MB)`));
      return next(bad(`Caricamento non valido (${err.code})`));
    }
    next(err);
  });
};
const uploadAny = uploader(config.maxUploadMb * MB);
const uploadAvatar = uploader(AVATAR_MAX);

const fileSchema = z.object({ scope: z.enum(SCOPES).default('PERSONAL'), folder: z.string().trim().max(120).optional() });
const cleanFolder = (f) => {
  const s = String(f || '').replace(/\\/g, '/').split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..').join('/');
  return s || null;
};
const pub = (f) => ({ id: f.id, scope: f.scope, filename: f.filename, mime: f.mime, size: f.size, folder: f.folder, created_at: f.created_at, owner_user_id: f.owner_user_id });

async function personalUsage(userId) {
  const row = await one(`SELECT coalesce(sum(size),0)::bigint AS used FROM files WHERE owner_user_id=$1 AND scope='PERSONAL' AND deleted_at IS NULL`, [userId]);
  return Number(row?.used || 0);
}

async function storeFile(req, { scope, folder, file }) {
  const path = blob.blobPath(scope, file.originalname);
  const sha = createHash('sha256').update(file.buffer).digest('hex');
  const mime = file.mimetype || 'application/octet-stream';
  const filename = blob.sanitizeFilename(file.originalname);
  await blob.putBlob(path, file.buffer, mime);
  try {
    const row = await one(`INSERT INTO files (scope, owner_user_id, blob_path, filename, mime, size, sha256, folder) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [scope, req.user.id, path, filename, mime, file.size, sha, folder]);
    return row;
  } catch (e) {
    await blob.deleteBlob(path).catch(() => {});
    throw e;
  }
}

// ---- Upload: campo multipart "file", query scope e folder
r.post('/files/upload', blob.requireBlob, uploadAny, ah(async (req, res) => {
  const { scope, folder } = parse(fileSchema, req.query);
  if (!req.file) throw bad('Nessun file ricevuto (campo "file")');
  if (scope === 'DOC' && !isAdmin(req.user) && !hasModule(req.user, 'comunicazione', 'EDITOR', 'PUBLISHER') && !hasModule(req.user, 'sgi', 'EDITOR')) throw forbidden('Caricamento documenti riservato');
  if (scope === 'NEWS' && !isAdmin(req.user) && !hasModule(req.user, 'comunicazione', 'EDITOR', 'PUBLISHER')) throw forbidden('Allegati delle news riservati alla redazione');
  if (scope === 'AVATAR') {
    if (!IMAGE_MIMES.includes(req.file.mimetype)) throw bad('L\'avatar deve essere un\'immagine (JPEG, PNG, WebP o GIF)');
    if (req.file.size > AVATAR_MAX) throw new HttpError(413, 'Avatar troppo grande (massimo 3 MB)');
  }
  if (scope === 'PERSONAL') {
    const quota = config.personalQuotaMb * MB;
    const used = await personalUsage(req.user.id);
    if (used + req.file.size > quota) throw new HttpError(413, `Spazio personale esaurito: ${Math.round(used / MB)} MB usati su ${config.personalQuotaMb} MB`);
  }
  const row = await storeFile(req, { scope, folder: scope === 'PERSONAL' ? cleanFolder(folder) : null, file: req.file });
  await audit(req, 'FILE_UPLOADED', { entity: 'file', entityId: row.id, label: row.filename, data: { scope, size: row.size, mime: row.mime, folder: row.folder } });
  res.status(201).json({ id: row.id, filename: row.filename, mime: row.mime, size: row.size, folder: row.folder, scope: row.scope });
}));

// ---- Avatar: immagine fino a 3 MB, imposta users.avatar_file_id
r.post('/files/avatar', blob.requireBlob, uploadAvatar, ah(async (req, res) => {
  if (!req.file) throw bad('Nessuna immagine ricevuta (campo "file")');
  if (!IMAGE_MIMES.includes(req.file.mimetype)) throw bad('L\'avatar deve essere un\'immagine (JPEG, PNG, WebP o GIF)');
  const row = await storeFile(req, { scope: 'AVATAR', folder: null, file: req.file });
  const prev = req.user.avatar_file_id;
  await q('UPDATE users SET avatar_file_id=$2, updated_at=now() WHERE id=$1', [req.user.id, row.id]);
  if (prev) {
    const old = await one('UPDATE files SET deleted_at=now() WHERE id=$1 AND owner_user_id=$2 AND scope=\'AVATAR\' AND deleted_at IS NULL RETURNING blob_path', [prev, req.user.id]);
    if (old) blob.deleteBlob(old.blob_path).catch(() => {});
  }
  await audit(req, 'AVATAR_UPDATED', { entity: 'user', entityId: req.user.id, data: { file_id: row.id } });
  res.status(201).json({ id: row.id, filename: row.filename, mime: row.mime, size: row.size, avatar_file_id: row.id });
}));

// ---- Cartella personale
r.get('/files/mine', ah(async (req, res) => {
  const folder = req.query.folder != null ? cleanFolder(req.query.folder) : undefined;
  const params = [req.user.id];
  let where = '';
  if (folder !== undefined) { params.push(folder); where = folder === null ? 'AND folder IS NULL' : `AND folder = $2`; }
  const rows = await many(`SELECT * FROM files WHERE owner_user_id=$1 AND scope='PERSONAL' AND deleted_at IS NULL ${where} ORDER BY folder NULLS FIRST, lower(filename)`, params);
  const folders = (await many(`SELECT DISTINCT folder FROM files WHERE owner_user_id=$1 AND scope='PERSONAL' AND deleted_at IS NULL AND folder IS NOT NULL ORDER BY folder`, [req.user.id])).map((x) => x.folder);
  res.json({ used: await personalUsage(req.user.id), quota: config.personalQuotaMb * MB, enabled: blob.isEnabled(), folders, rows: rows.map(pub) });
}));

// ---- Permessi di lettura per scope
async function canRead(user, f) {
  if (isAdmin(user)) return true;
  if (f.owner_user_id === user.id) return true;
  switch (f.scope) {
    case 'AVATAR': return true;
    case 'PERSONAL': return false;
    case 'POST': {
      const posts = await many('SELECT p.audience FROM post_files pf JOIN posts p ON p.id=pf.post_id WHERE pf.file_id=$1 AND p.deleted_at IS NULL', [f.id]);
      return posts.some((p) => canSee(user, p.audience));
    }
    case 'NEWS': {
      if (hasModule(user, 'comunicazione', 'EDITOR', 'PUBLISHER')) return true;
      const news = await many(`SELECT n.audience, n.status FROM news n WHERE n.cover_file_id=$1 OR n.id IN (SELECT news_id FROM news_files WHERE file_id=$1)`, [f.id]);
      return news.some((n) => n.status === 'PUBLISHED' && canSee(user, n.audience));
    }
    case 'DOC': return true;
    default: return false;
  }
}

export async function streamFile(res, f, { inlineOnly = false } = {}) {
  const { stream, mime, size } = await blob.getBlobStream(f.blob_path);
  const inline = inlineOnly || /^(image\/|application\/pdf|text\/plain|video\/|audio\/)/.test(f.mime);
  res.setHeader('Content-Type', f.mime || mime);
  if (size != null) res.setHeader('Content-Length', String(size)); else if (f.size) res.setHeader('Content-Length', String(f.size));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  stream.on('error', (e) => { console.error('[files] stream', e.message); if (!res.headersSent) res.status(502).end(); else res.end(); });
  stream.pipe(res);
}

r.get('/files/:id', blob.requireBlob, ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1 AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!f) throw notFound('File non trovato');
  if (!(await canRead(req.user, f))) throw forbidden('Non hai accesso a questo file');
  await streamFile(res, f);
}));

r.put('/files/:id', ah(async (req, res) => {
  const b = parse(z.object({ folder: z.string().max(120).nullable().optional(), filename: z.string().min(1).max(160).optional() }), req.body);
  const f = await one('SELECT * FROM files WHERE id=$1 AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!f) throw notFound('File non trovato');
  if (f.owner_user_id !== req.user.id && !isAdmin(req.user)) throw forbidden();
  const sets = []; const params = [f.id];
  if (b.folder !== undefined) { params.push(f.scope === 'PERSONAL' ? cleanFolder(b.folder) : null); sets.push(`folder=$${params.length}`); }
  if (b.filename !== undefined) { params.push(blob.sanitizeFilename(b.filename)); sets.push(`filename=$${params.length}`); }
  if (!sets.length) return res.json(pub(f));
  const row = await one(`UPDATE files SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  await audit(req, 'FILE_UPDATED', { entity: 'file', entityId: row.id, label: row.filename, data: b });
  res.json(pub(row));
}));

r.delete('/files/:id', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1 AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!f) throw notFound('File non trovato');
  if (f.owner_user_id !== req.user.id && !isAdmin(req.user)) throw forbidden();
  await q('UPDATE files SET deleted_at=now() WHERE id=$1', [f.id]);
  await q('UPDATE users SET avatar_file_id=NULL WHERE avatar_file_id=$1', [f.id]);
  if (blob.isEnabled()) blob.deleteBlob(f.blob_path).catch((e) => console.warn('[files] eliminazione blob', e.message));
  await audit(req, 'FILE_DELETED', { entity: 'file', entityId: f.id, label: f.filename, data: { scope: f.scope } });
  res.json({ ok: true });
}));

export default r;
