// Servizio dei file caricati dagli utenti (allegati di ticket e NC, Cartella, archivio file, referti, Business, Contracts, Facility,
// copie dei portali Service e SGI...). Regola unica per tutta la Suite (debug pre-produzione, B1):
// - il Content-Type NON viene mai dal client: si ricava dall'estensione del nome (elenco chiuso) e, quando il contenuto è a portata
//   di mano, dalla firma dei primi byte; un PDF o un'immagine che non ha la firma giusta diventa application/octet-stream;
// - in linea (inline) solo PDF e immagini raster (PNG, JPEG, WEBP, GIF); tutto il resto, SVG compreso, si scarica (attachment);
// - sempre X-Content-Type-Options: nosniff e, salvo i PDF in linea (il visore del browser non funziona in sandbox),
//   Content-Security-Policy: sandbox, così un file non può mai eseguire script nel dominio della Suite.
// Il tipo dichiarato al caricamento si usa solo come ultima risorsa e solo se è uno dei tipi dell'elenco.
import path from 'node:path';
import * as blob from './blob.js';

export const TIPI = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', xml: 'application/xml',
  zip: 'application/zip', p7m: 'application/pkcs7-mime', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
  mp4: 'video/mp4', mp3: 'audio/mpeg', dcm: 'application/dicom',
};
// Tipi che il browser può mostrare in linea senza rischio (nessuno script possibile con nosniff)
export const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const OCTET = 'application/octet-stream';

/** Firma dei primi byte: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null */
export function firma(buf) {
  if (!buf || buf.length < 4) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // %PDF può essere preceduto da qualche byte (BOM, spazi): lo si cerca nel primo KB come fanno i lettori PDF
  if (b.subarray(0, 1024).includes('%PDF-')) return 'application/pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

const estensione = (nome) => path.extname(String(nome || '')).slice(1).toLowerCase();

/**
 * Tipo con cui servire un file: { contentType, inline } dove inline dice se il browser può mostrarlo in linea.
 * nome: nome del file; buf: contenuto (facoltativo); dichiarato: tipo registrato al caricamento (solo ripiego).
 */
export function tipoFile(nome, buf = null, dichiarato = null) {
  let ct = TIPI[estensione(nome)] || null;
  const sig = buf ? firma(buf) : null;
  if (!ct && sig) ct = sig;                                         // senza estensione nota: dalla firma
  if (!ct && dichiarato) {                                          // ultima risorsa: il tipo dichiarato, solo se è in elenco
    const d = String(dichiarato).split(';')[0].trim().toLowerCase();
    ct = Object.values(TIPI).find((t) => t.split(';')[0] === d) || null;
  }
  if (!ct) return { contentType: OCTET, inline: false };
  // un PDF o un'immagine che non ha la firma del suo tipo non si mostra: si scarica come dato grezzo
  // (un'immagine con l'estensione sbagliata ma la firma di un altro tipo sicuro si serve con il tipo della firma)
  if (INLINE.has(ct) && buf && sig !== ct) return sig ? { contentType: sig, inline: true } : { contentType: OCTET, inline: false };
  return { contentType: ct, inline: INLINE.has(ct) };
}

/** Nome del file pulito per l'intestazione (niente virgolette, a capo, barre, caratteri di controllo) */
export function nomePulito(nome) {
  const n = String(nome || 'file').replace(/[\u0000-\u001f\u007f"\\/]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  return n || 'file';
}
export function contentDisposition(nome, inline = false) {
  const n = nomePulito(nome);
  const ascii = n.replace(/[^\x20-\x7e]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

/**
 * Imposta le intestazioni di risposta per un file caricato da un utente. Ritorna { contentType, inline } effettivi.
 * opts: { inline (richiesto dal chiamante), buf, mime (dichiarato), cache (Cache-Control), size }
 */
export function intestazioniFile(res, nome, { inline = false, buf = null, mime = null, cache = 'private, max-age=300', size = null } = {}) {
  const t = tipoFile(nome, buf, mime);
  const inl = Boolean(inline) && t.inline;
  res.setHeader('Content-Type', t.contentType);
  res.setHeader('Content-Disposition', contentDisposition(nome, inl));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // sandbox: nessuno script, nessun accesso al dominio. Il visore PDF integrato del browser non parte in sandbox: i PDF in linea
  // restano sotto la CSP generale della Suite (script-src 'self', object-src 'self')
  if (!(inl && t.contentType === 'application/pdf')) res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  if (cache) res.setHeader('Cache-Control', cache);
  if (size != null) res.setHeader('Content-Length', String(size));
  return { contentType: t.contentType, inline: inl };
}

/**
 * Invia un file caricato da un utente, dal database (data) o da Azure Blob (blob_path), con le regole sopra.
 * f: { filename, data?, blob_path?, mime? }. opts: { inline, cache }
 */
export async function servFile(res, f, { inline = false, cache = 'private, max-age=300' } = {}) {
  const nome = f.filename || f.nome || 'file';
  if (f.data != null) {
    const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    intestazioniFile(res, nome, { inline, buf, mime: f.mime, cache, size: buf.length });
    return res.end(buf);
  }
  if (f.blob_path) {
    const { stream, size } = await blob.getBlobStream(f.blob_path);
    intestazioniFile(res, nome, { inline, mime: f.mime, cache, size: size || f.size || null });
    stream.on('error', (e) => { console.error('[file] lettura dal blob', e.message); if (!res.headersSent) res.status(502).end(); else res.end(); });
    stream.pipe(res);
    return undefined;
  }
  return res.status(404).json({ error: 'Contenuto del file non disponibile' });
}
