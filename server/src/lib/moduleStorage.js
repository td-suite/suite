// Archivio dei documenti dei moduli (Business: contratti e fascicoli; Payments: contratti di affitto dello scadenziario) a due vie:
// su Azure Blob Storage quando l'archivio file della Suite è configurato (lib/blob.js, lo stesso di Cartella e Community), altrimenti
// nel database (colonna bytea). Chi legge usa sendFile, che serve indifferentemente dal blob o dal database; chi cancella usa dropBlobs
// per non lasciare orfani nell'archivio. `prefix` è il modulo (business, finance): i percorsi nel blob diventano "<prefix>-<scope>/...".
import crypto from 'node:crypto';
import * as blob from './blob.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const storageMode = () => (blob.isEnabled() ? 'blob' : 'db');

// Prepara i valori da inserire: { data, blob_path, size, sha256 }
export async function storeBuffer(prefix, scope, filename, mime, buf) {
  const digest = sha256(buf);
  if (!blob.isEnabled()) return { data: buf, blob_path: null, size: buf.length, sha256: digest };
  const path = blob.blobPath(`${prefix}-${scope}`, filename);
  await blob.putBlob(path, buf, mime);
  return { data: null, blob_path: path, size: buf.length, sha256: digest };
}

export async function sendFile(res, f, { inline = false } = {}) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  if (f.blob_path) {
    const { stream, size } = await blob.getBlobStream(f.blob_path);
    if (size) res.setHeader('Content-Length', size);
    stream.pipe(res);
    return;
  }
  res.send(f.data);
}

// Cancella dal blob i percorsi indicati (dopo la DELETE sul database); gli errori non bloccano
export async function dropBlobs(prefix, paths) {
  for (const p of (paths || []).filter(Boolean)) await blob.deleteBlob(p).catch((e) => console.warn(`[${prefix}] blob non rimosso`, p, e.message));
}

// Contenuto del documento come Buffer, dal database o dal blob (per rileggere un PDF archiviato)
export async function readBuffer(f) {
  if (f.data) return Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
  if (!f.blob_path) return null;
  const { stream } = await blob.getBlobStream(f.blob_path);
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
