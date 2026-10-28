// Dove stanno i documenti di Business (contratti e fascicoli): su Azure Blob Storage quando l'archivio file della Suite è configurato
// (lib/blob.js, lo stesso di Cartella e Community), altrimenti nel database (colonna bytea). Il database Render da 1 GB non regge i
// fascicoli di autorizzazione: con il blob nel database restano solo i metadati. Chi legge usa sendFile, che serve indifferentemente
// dal blob o dal database; chi cancella usa dropBlobs per non lasciare orfani nell'archivio.
import * as blob from '../../../lib/blob.js';
import { sha256 } from './crypto.js';

export const storageMode = () => (blob.isEnabled() ? 'blob' : 'db');

// Prepara i valori da inserire: { data, blob_path, size, sha256 }
export async function storeBuffer(scope, filename, mime, buf) {
  const digest = sha256(buf);
  if (!blob.isEnabled()) return { data: buf, blob_path: null, size: buf.length, sha256: digest };
  const path = blob.blobPath(`business-${scope}`, filename);
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
export async function dropBlobs(paths) {
  for (const p of (paths || []).filter(Boolean)) await blob.deleteBlob(p).catch((e) => console.warn('[business] blob non rimosso', p, e.message));
}
