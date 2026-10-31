// Planimetria verso Room Planning. Verso: Facility è la fonte. La PLANIMETRIA più recente caricata nella scheda dell'immobile si
// pubblica nella sede corrispondente di Room (room.struttura_blobs, chiave struttura_id = public.sites.id dalla migrazione room/005):
// PDF → kind 'planPdf' (e si toglie 'planImg', la vecchia resa in immagine che Room rigenera da sé), immagine → 'planImg' (e si toglie
// 'planPdf'). Room legge i binari come data URL base64 (GET /api/room/strutture/:id/blob/planPdf) e li disegna con pdf.js o come
// immagine; non si toccano site_ext (impostazioni, marker degli ambulatori, versione per il controllo di concorrenza) né la cronologia.
// Se Room non è avviato la pubblicazione si salta e lo stato lo dice; si può ripetere dalla scheda ("Pubblica in Room Planning").
import { q, one, tx } from '../db.js';
import { readBuffer } from '../../../lib/moduleStorage.js';
import { roomReady } from './core.js';

export const ROOM_MAX_BYTES = 20 * 1024 * 1024;   // oltre, il data URL appesantisce troppo la scheda Room (Room stessa avvisa oltre 3,8 MB)
export const isPdf = (mime, name) => mime === 'application/pdf' || /\.pdf$/i.test(name || '');
export const isRoomImage = (mime, name) => /^image\/(png|jpe?g|webp)$/.test(mime || '') || /\.(png|jpe?g|webp)$/i.test(name || '');

export async function publishPlanToRoom(doc, buffer = null) {
  if (!(await roomReady())) return { published: false, reason: 'Room Planning non avviato: la planimetria resta in Facility e si pubblica quando Room è attivo' };
  const pdf = isPdf(doc.mime, doc.filename);
  if (!pdf && !isRoomImage(doc.mime, doc.filename)) return { published: false, reason: 'Room Planning accetta la planimetria in PDF o come immagine PNG, JPEG o WebP' };
  const buf = buffer || await readBuffer(doc);
  if (!buf) return { published: false, reason: 'File della planimetria non leggibile' };
  if (buf.length > ROOM_MAX_BYTES) return { published: false, reason: `Planimetria troppo pesante per Room Planning (massimo ${ROOM_MAX_BYTES / 1024 / 1024} MB): caricane una versione compressa` };
  const prop = await one('SELECT site_id FROM properties WHERE id=$1', [doc.property_id]);
  const site = await one('SELECT id, active FROM public.sites WHERE id=$1', [prop.site_id]);
  if (!site?.active) return { published: false, reason: 'Sede non attiva nell\'anagrafica: Room Planning non la mostra' };
  const mime = pdf ? 'application/pdf' : (doc.mime || 'image/png');
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const kind = pdf ? 'planPdf' : 'planImg';
  await tx(async (c) => {
    await c.query(`INSERT INTO room.struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [site.id, kind, dataUrl]);
    await c.query('DELETE FROM room.struttura_blobs WHERE struttura_id=$1 AND kind=$2', [site.id, pdf ? 'planImg' : 'planPdf']);
    await c.query('UPDATE property_documents SET published_room_at=NULL WHERE property_id=$1 AND kind=\'PLANIMETRIA\' AND id<>$2', [doc.property_id, doc.id]);
    await c.query('UPDATE property_documents SET published_room_at=now() WHERE id=$1', [doc.id]);
  });
  return { published: true, kind, bytes: buf.length };
}

// Stato in Room della sede: binari presenti e data dell'ultimo aggiornamento
export async function roomPlanStatus(siteId) {
  if (!(await roomReady())) return { room: false, has_plan: false };
  const rows = (await q(`SELECT kind, length(data) AS chars, updated_at FROM room.struttura_blobs WHERE struttura_id=$1 AND kind IN ('planPdf','planImg')`, [siteId])).rows;
  const configurata = Boolean((await q('SELECT 1 FROM room.site_ext WHERE site_id=$1', [siteId]).catch(() => ({ rows: [] }))).rows.length);
  return { room: true, has_plan: rows.length > 0, kinds: rows.map((r) => r.kind), updated_at: rows.reduce((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null), configurata };
}
