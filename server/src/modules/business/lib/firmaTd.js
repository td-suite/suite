// Business Hub · firma del firmatario dei contratti di Toscana Diagnostica (Impostazioni, "Firmatario dei contratti"; richiesta del CEO
// del 07/11/2026). Immagine PNG o JPG fino a 1 MB nella tabella firma_td (una riga, archivio a due vie come i documenti); nome e
// qualifica nelle impostazioni firma_nome e firma_qualifica, vuote = legale rappresentante (lr_name, lr_role). Alla generazione del PDF
// del contratto SRV e MDL la firma si appone nei blocchi firme di TD (contrattoPdf.js), se la spunta del contratto lo consente.
import { one, q } from '../db.js';
import { storeBuffer, readBuffer, dropBlobs } from './storage.js';
import { dimensioniImmagine } from './contrattoPdf.js';
import { bad } from './util.js';

export const FIRMA_MAX_BYTES = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tipo dell'immagine dai primi byte (non dall'estensione): image/png, image/jpeg o null. */
export function tipoImmagine(buf) {
  if (!buf?.length) return null;
  if (buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Nome e qualifica del firmatario come compaiono nei blocchi firme (impostazioni o legale rappresentante). */
export function firmatario(s) {
  return { nome: String(s.firma_nome || '').trim() || s.lr_name || '', ruolo: String(s.firma_qualifica || '').trim() || s.lr_role || '' };
}

/** Metadati della firma caricata (senza il contenuto) o null. */
export async function infoFirma() {
  return one('SELECT filename, mime, size, sha256, larghezza, altezza, updated_at FROM firma_td WHERE id=1');
}
/** Firma con il contenuto: { mime, buffer, sha256, ... } o null. */
export async function leggiFirma() {
  const r = await one('SELECT * FROM firma_td WHERE id=1');
  if (!r) return null;
  const buffer = await readBuffer(r);
  return buffer ? { ...r, buffer } : null;
}

/** Salva (o sostituisce) l'immagine della firma. f = file di multer. */
export async function salvaFirma(f, userId) {
  if (!f?.buffer?.length) throw bad('Nessun file');
  if (f.buffer.length > FIRMA_MAX_BYTES) throw bad('Immagine della firma oltre 1 MB');
  const mime = tipoImmagine(f.buffer);
  if (!mime) throw bad('La firma va caricata in PNG o JPG');
  let dim;
  try { dim = await dimensioniImmagine(f.buffer, mime); } catch (e) { throw bad(`Immagine non leggibile: ${e.message}`); }
  const filename = String(f.originalname || (mime === 'image/png' ? 'firma.png' : 'firma.jpg')).slice(0, 200);
  const st = await storeBuffer('firma', filename, mime, f.buffer);
  const prima = await one('SELECT blob_path FROM firma_td WHERE id=1');
  await q(`INSERT INTO firma_td (id, filename, mime, size, sha256, larghezza, altezza, data, blob_path, updated_by, updated_at) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (id) DO UPDATE SET filename=EXCLUDED.filename, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256, larghezza=EXCLUDED.larghezza,
      altezza=EXCLUDED.altezza, data=EXCLUDED.data, blob_path=EXCLUDED.blob_path, updated_by=EXCLUDED.updated_by, updated_at=now()`,
  [filename, mime, st.size, st.sha256, dim.larghezza, dim.altezza, st.data, st.blob_path, userId || null]);
  if (prima?.blob_path && prima.blob_path !== st.blob_path) await dropBlobs([prima.blob_path]);
  return infoFirma();
}

/** Rimuove l'immagine della firma. Ritorna true se c'era. */
export async function rimuoviFirma() {
  const r = await one('DELETE FROM firma_td WHERE id=1 RETURNING blob_path');
  if (r?.blob_path) await dropBlobs([r.blob_path]);
  return Boolean(r);
}
