// Rimborso Spese · giustificativi: caricamento (foto dal telefono già compressa dal browser, PDF), più file per riga, archivio a due vie
// della Suite (Azure Blob se configurato, altrimenti nel database) con hash SHA-256, dimensione, chi e quando; download e anteprima con
// gli stessi permessi della nota (regola unica di lib/servFile.js); eliminazione solo in BOZZA; ZIP di tutti i giustificativi della nota.
import { Router } from 'express';
import multer from 'multer';
import PizZip from 'pizzip';
import { q, one, many, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit } from '../../../lib/util.js';
import { storeBuffer, sendFile, dropBlobs, readBuffer } from '../../../lib/moduleStorage.js';
import { firma } from '../../../lib/servFile.js';
import { sanitizeFilename } from '../../../lib/blob.js';
import { config } from '../config.js';
import { KEY, userContext, notaVisibile } from '../lib/core.js';
import { STATO_LABEL, nomeMese, itData } from '../lib/calcoli.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 6 } });
const conUpload = (req, res, next) => upload.array('file', 6)(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? bad(`File troppo grande (massimo ${Math.round(config.maxFileBytes / 1048576)} MB)`) : bad(e.message)) : next()));
const ESTENSIONI = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;

/** Controllo del file: foto (JPEG, PNG, WEBP; HEIC dal telefono) o PDF, riconosciuti dalla firma dei primi byte quando possibile */
export function controllaFile(f) {
  if (!f?.buffer?.length) throw bad('File vuoto');
  const sig = firma(f.buffer);
  const nome = String(f.originalname || 'giustificativo');
  if (sig) return { mime: sig, nome: ESTENSIONI.test(nome) ? nome : `${nome}.${sig === 'application/pdf' ? 'pdf' : sig.split('/')[1].replace('jpeg', 'jpg')}` };
  if (/\.(heic|heif)$/i.test(nome)) return { mime: 'image/heic', nome };
  throw bad(`"${nome}": sono ammessi solo foto (JPEG, PNG, WEBP, HEIC) e PDF`);
}

/** Salva un giustificativo nella transazione `c` e ritorna la riga */
export async function salvaAllegato(c, { nota, tipo, rigaId, file, userId }) {
  const { mime, nome } = controllaFile(file);
  const st = await storeBuffer('rimborsi', `${nota.anno}-${String(nota.mese).padStart(2, '0')}`, sanitizeFilename(nome), mime, file.buffer);
  return (await c.query(`INSERT INTO allegati (nota_id, riga_tipo, riga_id, filename, mime, size, sha256, data, blob_path, caricato_da) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, riga_tipo, riga_id, filename, mime, size, sha256, caricato_at`, [nota.id, tipo, rigaId, sanitizeFilename(nome), mime, st.size, st.sha256, st.data, st.blob_path, userId])).rows[0];
}

r.post('/note/:id/allegati', conUpload, ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  if (n.person_id !== ctx.personId) throw forbidden('Solo il dipendente allega i giustificativi della propria nota');
  if (n.stato !== 'BOZZA') throw bad(`La nota è ${STATO_LABEL[n.stato].toLowerCase()}: i giustificativi si aggiungono solo in bozza`);
  const tipo = String(req.body?.riga_tipo || '').toUpperCase();
  const rigaId = Number(req.body?.riga_id);
  if (!['SPESA', 'VIAGGIO'].includes(tipo) || !Number.isInteger(rigaId)) throw bad('Indica la riga (spesa o viaggio) a cui allegare il giustificativo');
  const tab = tipo === 'SPESA' ? 'spese' : 'viaggi';
  if (!(await one(`SELECT 1 FROM ${tab} WHERE id=$1 AND nota_id=$2`, [rigaId, n.id]))) throw notFound('Riga inesistente');
  if (!(req.files || []).length) throw bad('Nessun file');
  const righe = await tx(async (c) => { const out = []; for (const f of req.files) out.push(await salvaAllegato(c, { nota: n, tipo, rigaId, file: f, userId: ctx.uid })); return out; });
  await audit(req, 'RIMBORSI_GIUSTIFICATIVO', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(n.anno, n.mese)}: ${righe.length} file`, data: righe.map((x) => ({ id: x.id, sha256: x.sha256, size: x.size })) });
  res.status(201).json(righe);
}));

// Download e anteprima con gli stessi permessi della nota; ?inline=1 per l'anteprima (solo PDF e immagini raster)
r.get('/allegati/:aid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const a = await one('SELECT * FROM allegati WHERE id=$1', [Number(req.params.aid)]);
  if (!a) throw notFound('Giustificativo non trovato');
  await notaVisibile(ctx, a.nota_id);   // 404 se la nota non è visibile
  await sendFile(res, { ...a, filename: a.filename, mime: a.mime }, { inline: req.query.inline === '1' });
}));

r.delete('/allegati/:aid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const a = await one('SELECT * FROM allegati WHERE id=$1', [Number(req.params.aid)]);
  if (!a) throw notFound('Giustificativo non trovato');
  const n = await notaVisibile(ctx, a.nota_id);
  if (n.person_id !== ctx.personId) throw forbidden('Solo il dipendente gestisce i giustificativi della propria nota');
  if (n.stato !== 'BOZZA' || a.riga_tipo === 'NOTA') throw bad('Dopo l\'invio i giustificativi non si eliminano');
  await q('DELETE FROM allegati WHERE id=$1', [a.id]);
  await dropBlobs('rimborsi', [a.blob_path]);
  await audit(req, 'RIMBORSI_GIUSTIFICATIVO_ELIMINATO', { module: KEY, entity: 'nota', entityId: n.id, label: a.filename, data: { id: a.id, sha256: a.sha256 } });
  res.json({ ok: true });
}));

/** ZIP dei giustificativi della nota: una cartella per sezione, nome con numero di riga, data e descrizione; un indice in testo */
export async function zipGiustificativi(n) {
  const all = await many('SELECT * FROM allegati WHERE nota_id=$1 AND riga_tipo <> \'NOTA\' ORDER BY riga_tipo, riga_id, id', [n.id]);
  const spese = await many('SELECT id, data, descrizione, importo FROM spese WHERE nota_id=$1 ORDER BY data, id', [n.id]);
  const viaggi = await many('SELECT id, data, partenza, arrivo FROM viaggi WHERE nota_id=$1 ORDER BY data, id', [n.id]);
  const num = new Map([...spese.map((s, i) => [`SPESA:${s.id}`, { n: i + 1, t: `${itData(s.data)} ${s.descrizione}` }]), ...viaggi.map((v, i) => [`VIAGGIO:${v.id}`, { n: i + 1, t: `${itData(v.data)} ${v.partenza}-${v.arrivo}` }])]);
  const zip = new PizZip();
  const indice = [`Giustificativi della nota spese di ${nomeMese(n.anno, n.mese)} · ${n.persona}`, ''];
  for (const a of all) {
    const k = num.get(`${a.riga_tipo}:${a.riga_id}`) || { n: 0, t: 'riga eliminata' };
    const cartella = a.riga_tipo === 'SPESA' ? 'Spese' : 'Chilometri';
    const nome = `${cartella}/${String(k.n).padStart(2, '0')}_${a.id}_${sanitizeFilename(a.filename)}`;
    const buf = await readBuffer(a);
    if (!buf) continue;
    zip.file(nome, buf);
    indice.push(`${nome}  ·  riga ${k.n}: ${k.t}  ·  SHA-256 ${a.sha256}`);
  }
  if (all.length === 0) indice.push('Nessun giustificativo allegato.');
  zip.file('indice.txt', indice.join('\r\n'));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

r.get('/note/:id/giustificativi.zip', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  const buf = await zipGiustificativi(n);
  await audit(req, 'RIMBORSI_ZIP', { module: KEY, entity: 'nota', entityId: n.id, label: nomeMese(n.anno, n.mese) });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Giustificativi_${n.anno}-${String(n.mese).padStart(2, '0')}_${sanitizeFilename(n.persona)}.zip"`);
  res.send(buf);
}));

export default r;
