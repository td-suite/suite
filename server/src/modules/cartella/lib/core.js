// Funzioni comuni del modulo Cartella condivisa: lettura dei documenti con percorso e stato di lettura, eventi, indice di ricerca.
import path from 'node:path';
import { q, many } from '../db.js';
import { config, TIPI } from '../config.js';
import { upsertIndex, removeFromIndex } from '../../../lib/search.js';
import { notFound } from '../../../lib/util.js';

export const KEY = 'cartella';

export const idOf = (v, msg = 'Elemento non trovato') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw notFound(msg); return n; };
// Id della cartella nel percorso: 0 o "radice" = radice (NULL)
export const cartellaIdOf = (v) => (v === 'radice' || v === '0' || v === 0 || v == null || v === '' ? null : idOf(v, 'Cartella non trovata'));

export const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
export const mimeFor = (name) => TIPI[extOf(name)] || null;
export const isPreviewable = (mime) => /^(application\/pdf|image\/)/.test(mime || '');

// Colonne del documento (alias d) senza il contenuto, con percorso, autore, numero di letture e stato di lettura per l'utente $1
export const D_COLS = `d.id, d.cartella_id, d.nome, d.filename, d.mime, d.size, d.descrizione, d.in_evidenza, d.evidenza_fino, d.caricato_da_user_id, d.versione, d.created_at, d.updated_at,
  u.full_name AS caricato_da_nome, percorso(d.cartella_id) AS percorso,
  (SELECT count(*)::int FROM letture l WHERE l.documento_id=d.id) AS n_letture,
  EXISTS (SELECT 1 FROM letture l WHERE l.documento_id=d.id AND l.user_id=$1) AS letto,
  (d.in_evidenza AND (d.evidenza_fino IS NULL OR d.evidenza_fino >= CURRENT_DATE)) AS evidenza_attiva,
  (d.created_at > now() - make_interval(days => ${config.novitaGiorni}) AND NOT EXISTS (SELECT 1 FROM letture l WHERE l.documento_id=d.id AND l.user_id=$1)) AS nuovo`;
export const D_FROM = `documenti d LEFT JOIN public.users u ON u.id=d.caricato_da_user_id`;

export async function loadDocumento(id, uid, runner = q) {
  const r = await runner(`SELECT ${D_COLS} FROM ${D_FROM} WHERE d.id=$2`, [uid, id]);
  return r.rows[0] || null;
}

export const C_COLS = `c.id, c.parent_id, c.nome, c.descrizione, c.sort_order, c.created_by_user_id, c.created_at, c.updated_at, percorso(c.id) AS percorso,
  (SELECT count(*)::int FROM documenti d WHERE d.cartella_id=c.id) AS n_documenti,
  (SELECT count(*)::int FROM cartelle s WHERE s.parent_id=c.id) AS n_sottocartelle`;
export async function loadCartella(id, runner = q) {
  const r = await runner(`SELECT ${C_COLS} FROM cartelle c WHERE c.id=$1`, [id]);
  return r.rows[0] || null;
}
// Catena dalla radice alla cartella (per il breadcrumb)
export async function catena(cartellaId) {
  if (!cartellaId) return [];
  return many(`WITH RECURSIVE up AS (
      SELECT c.id, c.parent_id, c.nome, 0 AS depth FROM cartelle c WHERE c.id=$1
      UNION ALL SELECT c.id, c.parent_id, c.nome, up.depth + 1 FROM cartelle c JOIN up ON c.id=up.parent_id WHERE up.depth < 30)
    SELECT id, nome FROM up ORDER BY depth DESC`, [cartellaId]);
}

// ---- Eventi (audit del modulo)
export async function evento(tipo, userId, { documento_id = null, cartella_id = null, dati = {} } = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  await runner('INSERT INTO eventi (tipo, documento_id, cartella_id, user_id, dati) VALUES ($1,$2,$3,$4,$5)', [tipo, documento_id, cartella_id, userId || null, JSON.stringify(dati || {})]);
}

// ---- Indice di ricerca della Suite: kind "cartella", audience = chi ha il grant sul modulo (MODULE)
export async function indexDocumento(d) {
  if (!d) return;
  await upsertIndex({ kind: KEY, ref_id: `${KEY}:${d.id}`, module_key: KEY, title: d.nome, body: [d.descrizione, d.percorso ? `Cartella: ${d.percorso}` : 'Cartella principale', d.filename !== d.nome ? d.filename : null].filter(Boolean).join('\n'),
    link: `/${KEY}/doc/${d.id}`, audience: { type: 'MODULE', key: KEY }, sensitive: false });
}
export async function unindexDocumento(id) { await removeFromIndex(KEY, `${KEY}:${id}`); }
export async function reindexDocumenti() {
  const rows = await many(`SELECT ${D_COLS} FROM ${D_FROM}`, [0]);
  for (const d of rows) await indexDocumento(d);
  await q('DELETE FROM public.search_index WHERE kind=$1 AND NOT (ref_id = ANY($2::text[]))', [KEY, rows.map((d) => `${KEY}:${d.id}`)]);
  return { documenti: rows.length };
}
// Dopo lo spostamento o la rinomina di una cartella il percorso cambia per tutti i documenti sotto
export async function reindexSottoalbero(cartellaId) {
  const rows = await many(`SELECT ${D_COLS} FROM ${D_FROM} WHERE d.cartella_id IN (SELECT id FROM discendenti($2))`, [0, cartellaId]);
  for (const d of rows) await indexDocumento(d);
}
