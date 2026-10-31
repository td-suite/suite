// Planimetria della sede: fonte unica per tutta la Suite (richiesta del CEO, 31/10/2026). Il file sta in public.site_documents con kind
// 'PLANIMETRIA' (migrazione 036): PDF o immagine PNG, JPEG, WebP; la corrente è la più recente della sede, le precedenti restano come
// storico scaricabile. Si carica da Amministrazione > Sedi (routes/core.js) o dalla scheda dell'immobile in Facility: entrambi chiamano
// storePlan, quindi da qualunque punto la si carichi la planimetria è una sola. Facility la legge da qui.
// Pubblicazione in Room Planning: la corrente va nella sede corrispondente di Room (room.struttura_blobs, struttura_id = public.sites.id
// dalla migrazione room/005): PDF → kind 'planPdf' (e si toglie 'planImg', la vecchia resa in immagine che Room rigenera da sé),
// immagine → 'planImg' (e si toglie 'planPdf'). Room legge i binari come data URL base64 (GET /api/room/strutture/:id/blob/planPdf) e li
// disegna con pdf.js o come immagine; non si toccano site_ext (impostazioni, marker degli ambulatori, versione per il controllo di
// concorrenza) né la cronologia. Se Room non è avviato la pubblicazione si salta e lo stato lo dice; si ripete con publishCurrentPlan.
import { q, one, many, tx } from '../db.js';
import { bad, notFound } from './util.js';
import { getModuleState } from './modules.js';
import { storeBuffer, readBuffer, dropBlobs } from './moduleStorage.js';

export const PLAN_MAX_BYTES = 25 * 1024 * 1024;   // limite del caricamento (Amministrazione > Sedi e Facility)
export const ROOM_MAX_BYTES = 20 * 1024 * 1024;   // oltre, il data URL appesantisce troppo la scheda Room (Room stessa avvisa oltre 3,8 MB)
export const isPdf = (mime, name) => mime === 'application/pdf' || /\.pdf$/i.test(name || '');
export const isRoomImage = (mime, name) => /^image\/(png|jpe?g|webp)$/.test(mime || '') || /\.(png|jpe?g|webp)$/i.test(name || '');
export const PLAN_FORMAT_MSG = 'La planimetria va caricata in PDF o come immagine PNG, JPEG o WebP';
// Colonne dei metadati (mai i byte)
export const PLAN_COLS = 'd.id, d.site_id, d.filename, d.mime, d.size, d.created_at, d.published_room_at, d.source, d.uploaded_by';

// Mime coerente con l'estensione (alcuni browser mandano application/octet-stream)
function planMime(mime, name) {
  if (isPdf(mime, name)) return 'application/pdf';
  if (/^image\/(png|jpe?g|webp)$/.test(mime || '')) return mime === 'image/jpg' ? 'image/jpeg' : mime;
  const ext = String(name || '').toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

// Room Planning avviato (MIRROR o LIVE) con lo schema pronto
export async function roomReady() {
  const st = await getModuleState('room');
  if (!['LIVE', 'MIRROR'].includes(st.mode) || !st.schema_ready) return false;
  const ok = await one(`SELECT to_regclass('room.struttura_blobs') IS NOT NULL AS ok`);
  return Boolean(ok?.ok);
}

// Planimetria corrente della sede (metadati), con il nome di chi l'ha caricata
export async function currentPlan(siteId) {
  return one(`SELECT ${PLAN_COLS}, u.full_name AS uploaded_by_name FROM public.site_documents d LEFT JOIN public.users u ON u.id=d.uploaded_by
    WHERE d.site_id=$1 AND d.kind='PLANIMETRIA' ORDER BY d.created_at DESC, d.id DESC LIMIT 1`, [siteId]);
}
// Tutte le versioni, dalla corrente alla più vecchia (la prima ha current: true)
export async function listPlans(siteId) {
  const rows = await many(`SELECT ${PLAN_COLS}, u.full_name AS uploaded_by_name FROM public.site_documents d LEFT JOIN public.users u ON u.id=d.uploaded_by
    WHERE d.site_id=$1 AND d.kind='PLANIMETRIA' ORDER BY d.created_at DESC, d.id DESC`, [siteId]);
  return rows.map((r, i) => ({ ...r, current: i === 0 }));
}
// Una versione con i byte (per servirla): docId nullo = la corrente
export async function planFile(siteId, docId = null) {
  const d = await one(`SELECT * FROM public.site_documents WHERE site_id=$1 AND kind='PLANIMETRIA' ${docId ? 'AND id=$2' : ''} ORDER BY created_at DESC, id DESC LIMIT 1`, docId ? [siteId, docId] : [siteId]);
  if (!d) throw notFound(docId ? 'Versione della planimetria non trovata' : 'Nessuna planimetria per questa sede');
  return d;
}

// Pubblica in Room Planning una versione (di norma la corrente). doc: riga di public.site_documents; buffer: i byte se già in memoria.
export async function publishPlanToRoom(doc, buffer = null) {
  if (!(await roomReady())) return { published: false, reason: 'Room Planning non avviato: la planimetria resta nell\'anagrafica e si pubblica quando Room è attivo' };
  const pdf = isPdf(doc.mime, doc.filename);
  if (!pdf && !isRoomImage(doc.mime, doc.filename)) return { published: false, reason: 'Room Planning accetta la planimetria in PDF o come immagine PNG, JPEG o WebP' };
  const buf = buffer || await readBuffer(doc);
  if (!buf) return { published: false, reason: 'File della planimetria non leggibile' };
  if (buf.length > ROOM_MAX_BYTES) return { published: false, reason: `Planimetria troppo pesante per Room Planning (massimo ${ROOM_MAX_BYTES / 1024 / 1024} MB): caricane una versione compressa` };
  const site = await one('SELECT id, active FROM public.sites WHERE id=$1', [doc.site_id]);
  if (!site?.active) return { published: false, reason: 'Sede non attiva nell\'anagrafica: Room Planning non la mostra' };
  const mime = pdf ? 'application/pdf' : planMime(doc.mime, doc.filename);
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const kind = pdf ? 'planPdf' : 'planImg';
  await tx(async (c) => {
    await c.query(`INSERT INTO room.struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [site.id, kind, dataUrl]);
    await c.query('DELETE FROM room.struttura_blobs WHERE struttura_id=$1 AND kind=$2', [site.id, pdf ? 'planImg' : 'planPdf']);
    await c.query(`UPDATE public.site_documents SET published_room_at=NULL WHERE site_id=$1 AND kind='PLANIMETRIA' AND id<>$2`, [site.id, doc.id]);
    await c.query('UPDATE public.site_documents SET published_room_at=now() WHERE id=$1', [doc.id]);
  });
  return { published: true, kind, bytes: buf.length };
}

// Toglie la planimetria da Room Planning (nessuna versione rimasta nell'anagrafica)
export async function removePlanFromRoom(siteId) {
  if (!(await roomReady())) return { published: false, removed: false, reason: 'Room Planning non avviato' };
  const r = await q(`DELETE FROM room.struttura_blobs WHERE struttura_id=$1 AND kind IN ('planPdf','planImg')`, [siteId]);
  return { published: false, removed: r.rowCount > 0 };
}

// Ripubblica la corrente (pulsante "Pubblica in Room Planning")
export async function publishCurrentPlan(siteId) {
  const d = await one(`SELECT * FROM public.site_documents WHERE site_id=$1 AND kind='PLANIMETRIA' ORDER BY created_at DESC, id DESC LIMIT 1`, [siteId]);
  if (!d) throw notFound('Nessuna planimetria per questa sede');
  return publishPlanToRoom(d);
}

// Nuova planimetria della sede (diventa la corrente) e pubblicazione in Room. file: { buffer, originalname, mimetype } di multer.
export async function storePlan(siteId, file, { userId = null, source = null } = {}) {
  if (!file?.buffer?.length) throw bad('Carica la planimetria (campo "file")');
  if (!isPdf(file.mimetype, file.originalname) && !isRoomImage(file.mimetype, file.originalname)) throw bad(`"${file.originalname}": ${PLAN_FORMAT_MSG}`);
  if (file.buffer.length > PLAN_MAX_BYTES) throw bad(`File troppo grande (massimo ${PLAN_MAX_BYTES / 1024 / 1024} MB)`);
  const site = await one('SELECT id FROM public.sites WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata');
  const filename = String(file.originalname || 'planimetria').slice(0, 200);
  const mime = planMime(file.mimetype, filename);
  const stored = await storeBuffer('sites', 'planimetrie', filename, mime, file.buffer);
  const row = await one(`INSERT INTO public.site_documents (site_id, kind, filename, mime, size, sha256, data, blob_path, uploaded_by, source)
    VALUES ($1,'PLANIMETRIA',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [siteId, filename, mime, stored.size, stored.sha256, stored.data, stored.blob_path, userId, source]);
  const room = await publishPlanToRoom(row, file.buffer);
  return { document: await one(`SELECT ${PLAN_COLS} FROM public.site_documents d WHERE d.id=$1`, [row.id]), room };
}

// Elimina una versione (docId nullo = la corrente). Se era la corrente, in Room va la precedente se esiste, altrimenti Room la perde.
export async function deletePlan(siteId, docId = null) {
  const cur = await one(`SELECT id FROM public.site_documents WHERE site_id=$1 AND kind='PLANIMETRIA' ORDER BY created_at DESC, id DESC LIMIT 1`, [siteId]);
  const d = await planFile(siteId, docId);
  await q('DELETE FROM public.site_documents WHERE id=$1', [d.id]);
  // il file nel blob si toglie solo se nessun'altra riga lo usa (le planimetrie migrate da Facility conservano il percorso originale)
  if (d.blob_path && !(await one('SELECT 1 FROM public.site_documents WHERE blob_path=$1', [d.blob_path]))) await dropBlobs('sites', [d.blob_path]);
  let room = null;
  if (cur?.id === d.id) {
    const next = await one(`SELECT * FROM public.site_documents WHERE site_id=$1 AND kind='PLANIMETRIA' ORDER BY created_at DESC, id DESC LIMIT 1`, [siteId]);
    room = next ? await publishPlanToRoom(next) : await removePlanFromRoom(siteId);
    room.republished_id = next?.id || null;
  }
  return { deleted: { id: d.id, filename: d.filename, was_current: cur?.id === d.id }, room };
}

// Stato in Room della sede: binari presenti e data dell'ultimo aggiornamento
export async function roomPlanStatus(siteId) {
  if (!(await roomReady())) return { room: false, has_plan: false };
  const rows = (await q(`SELECT kind, length(data) AS chars, updated_at FROM room.struttura_blobs WHERE struttura_id=$1 AND kind IN ('planPdf','planImg')`, [siteId])).rows;
  const configurata = Boolean((await q('SELECT 1 FROM room.site_ext WHERE site_id=$1', [siteId]).catch(() => ({ rows: [] }))).rows.length);
  return { room: true, has_plan: rows.length > 0, kinds: rows.map((r) => r.kind), updated_at: rows.reduce((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null), configurata };
}
