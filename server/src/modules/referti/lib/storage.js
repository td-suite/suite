// Dove stanno i file del modulo (PDF sorgente, DOCX e PDF prodotti): su Azure Blob Storage quando l'archivio file della Suite è
// configurato (lib/blob.js), altrimenti nel database (colonna bytea). Stesso schema a due vie di business/lib/storage.js.
import { createHash } from 'node:crypto';
import * as blob from '../../../lib/blob.js';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const storageMode = () => (blob.isEnabled() ? 'blob' : 'db');

// Valori da inserire: { data, blob_path, size, sha256 }
export async function storeBuffer(scope, filename, mime, buf) {
  const digest = sha256(buf);
  if (!blob.isEnabled()) return { data: buf, blob_path: null, size: buf.length, sha256: digest };
  const path = blob.blobPath(`referti-${scope}`, filename);
  await blob.putBlob(path, buf, mime);
  return { data: null, blob_path: path, size: buf.length, sha256: digest };
}

// Contenuto come Buffer (dal database o dal blob)
export async function readBuffer(f) {
  if (f.data) return Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
  if (f.blob_path) {
    const { stream } = await blob.getBlobStream(f.blob_path);
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
  return null;
}

const dispo = (filename, inline) => `${inline ? 'inline' : 'attachment'}; filename="${String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

export async function sendFile(res, f, { inline = false } = {}) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', dispo(f.filename, inline));
  res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (f.data) { res.setHeader('Content-Length', String(f.data.length)); return res.send(f.data); }
  if (f.blob_path) {
    const { stream, size } = await blob.getBlobStream(f.blob_path);
    if (size) res.setHeader('Content-Length', size);
    stream.pipe(res);
    return undefined;
  }
  return res.status(404).json({ error: 'Contenuto del file non disponibile' });
}

export async function dropBlobs(paths) {
  for (const p of (paths || []).filter(Boolean)) await blob.deleteBlob(p).catch(() => {});
}
