// Suite TD · archivio file su Azure Blob Storage. Nel database restano solo i metadati (tabella files).
// Senza AZURE_STORAGE_CONNECTION_STRING il modulo è disattivo e le rotte rispondono 503 con codice BLOB_DISABLED.
import { randomUUID } from 'node:crypto';
import { ContainerClient } from '@azure/storage-blob';
import { config } from '../config.js';
import { HttpError } from './util.js';

export const isEnabled = () => config.blob.enabled;


export const DISABLED_MESSAGE = 'Archivio file non configurato (Azure Blob Storage)';
export const blobDisabledError = () => Object.assign(new HttpError(503, DISABLED_MESSAGE), { code: 'BLOB_DISABLED' });
// Risposta diretta (il gestore errori generale maschera i messaggi 5xx): il client deve leggere il codice BLOB_DISABLED
export const requireBlob = (_req, res, next) => (isEnabled() ? next() : res.status(503).json({ error: DISABLED_MESSAGE, code: 'BLOB_DISABLED' }));

let container = null;
export function resetClient() { container = null; ready = null; }
export const ensureContainer = () => getContainer();
let ready = null;
async function getContainer() {
  if (!isEnabled()) throw blobDisabledError();
  if (!container) container = new ContainerClient(config.blob.connectionString, config.blob.container);
  if (!ready) {
    // Accesso privato: nessun parametro "access" significa che i blob si leggono solo con credenziali
    ready = container.createIfNotExists().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return container;
}

// Nome file sicuro: senza percorsi, senza accenti, solo lettere, numeri, punto, trattino e sottolineatura
export function sanitizeFilename(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let clean = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').replace(/_{2,}/g, '_');
  if (!clean) clean = 'file';
  if (clean.length > 120) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? clean.slice(dot).slice(0, 12) : '';
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  return clean;
}

// Percorso del blob: <scope>/<anno>/<uuid>-<filename sanificato>
export function blobPath(scope, filename) {
  const year = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 4);
  return `${String(scope || 'other').toLowerCase()}/${year}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

export async function putBlob(path, buffer, mime) {
  const c = await getContainer();
  const blob = c.getBlockBlobClient(path);
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mime || 'application/octet-stream' } });
  return { path, size: buffer.length };
}

export async function getBlobStream(path) {
  const c = await getContainer();
  const blob = c.getBlobClient(path);
  try {
    const dl = await blob.download(0);
    return { stream: dl.readableStreamBody, mime: dl.contentType || 'application/octet-stream', size: dl.contentLength ?? null };
  } catch (e) {
    if (e.statusCode === 404) throw new HttpError(404, 'Contenuto del file non trovato nell\'archivio');
    throw e;
  }
}

export async function deleteBlob(path) {
  const c = await getContainer();
  await c.getBlobClient(path).deleteIfExists();
}
