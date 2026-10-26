// Cartella condivisa, lettura: albero, contenuto delle cartelle, evidenza, recenti, novità, ricerca, download e anteprima.
// Tutti gli utenti con il grant (VIEWER e ADMIN) leggono tutto: nessun permesso per cartella.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { ah, parse, notFound, bad } from '../../../lib/util.js';
import { config } from '../config.js';
import { D_COLS, D_FROM, C_COLS, idOf, cartellaIdOf, loadDocumento, loadCartella, catena, isPreviewable } from '../lib/core.js';

const r = Router();
const uid = (req) => req.user.id;

// ---- Albero delle cartelle con conteggi (documenti diretti e nel sottoalbero)
r.get('/albero', ah(async (req, res) => {
  const cartelle = await many(`SELECT ${C_COLS},
      (SELECT count(*)::int FROM documenti d WHERE d.cartella_id IN (SELECT id FROM discendenti(c.id))) AS n_documenti_totale
    FROM cartelle c ORDER BY c.sort_order, lower(c.nome)`);
  const radice = await one(`SELECT (SELECT count(*)::int FROM documenti WHERE cartella_id IS NULL) AS n_documenti, (SELECT count(*)::int FROM documenti) AS n_documenti_totale, (SELECT count(*)::int FROM cartelle WHERE parent_id IS NULL) AS n_sottocartelle`);
  res.json({ radice, cartelle });
}));

// ---- Contenuto di una cartella (0 o "radice" = radice): sottocartelle, documenti, percorso
r.get('/cartelle/:id', ah(async (req, res) => {
  const cid = cartellaIdOf(req.params.id);
  const cartella = cid ? await loadCartella(cid) : null;
  if (cid && !cartella) throw notFound('Cartella non trovata');
  const where = cid ? 'c.parent_id=$1' : 'c.parent_id IS NULL';
  const params = cid ? [cid] : [];
  const sottocartelle = await many(`SELECT ${C_COLS}, (SELECT count(*)::int FROM documenti d WHERE d.cartella_id IN (SELECT id FROM discendenti(c.id))) AS n_documenti_totale,
      (SELECT count(*)::int FROM documenti d WHERE d.cartella_id IN (SELECT id FROM discendenti(c.id)) AND d.created_at > now() - make_interval(days => ${config.novitaGiorni}) AND NOT EXISTS (SELECT 1 FROM letture l WHERE l.documento_id=d.id AND l.user_id=$${params.length + 1})) AS n_nuovi
    FROM cartelle c WHERE ${where} ORDER BY c.sort_order, lower(c.nome)`, [...params, uid(req)]);
  const documenti = await many(`SELECT ${D_COLS} FROM ${D_FROM} WHERE ${cid ? 'd.cartella_id=$2' : 'd.cartella_id IS NULL'} ORDER BY lower(d.nome)`, cid ? [uid(req), cid] : [uid(req)]);
  res.json({ cartella, percorso: await catena(cid), sottocartelle, documenti });
}));

// ---- In evidenza (non scaduti), per data di aggiornamento
r.get('/evidenza', ah(async (req, res) => {
  res.json(await many(`SELECT ${D_COLS} FROM ${D_FROM} WHERE d.in_evidenza AND (d.evidenza_fino IS NULL OR d.evidenza_fino >= CURRENT_DATE) ORDER BY d.updated_at DESC`, [uid(req)]));
}));

// ---- Recenti: ultimi 20 caricati o aggiornati
r.get('/recenti', ah(async (req, res) => {
  res.json(await many(`SELECT ${D_COLS} FROM ${D_FROM} ORDER BY d.updated_at DESC LIMIT 20`, [uid(req)]));
}));

// ---- Novità per me: caricati negli ultimi N giorni e non ancora aperti dall'utente
r.get('/novita', ah(async (req, res) => {
  res.json(await many(`SELECT ${D_COLS} FROM ${D_FROM} WHERE d.created_at > now() - make_interval(days => ${config.novitaGiorni}) AND NOT EXISTS (SELECT 1 FROM letture l WHERE l.documento_id=d.id AND l.user_id=$1) ORDER BY d.created_at DESC LIMIT 100`, [uid(req)]));
}));

// ---- Ricerca su nome, descrizione, nome originale e percorso (anche cartelle per nome)
r.get('/cerca', ah(async (req, res) => {
  const { q: text } = parse(z.object({ q: z.string().trim().max(200).default('') }), req.query);
  if (text.length < 2) return res.json({ q: text, documenti: [], cartelle: [] });
  const like = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const documenti = await many(`SELECT ${D_COLS} FROM ${D_FROM}
      WHERE d.nome ILIKE $2 OR d.descrizione ILIKE $2 OR d.filename ILIKE $2 OR coalesce(percorso(d.cartella_id), '') ILIKE $2
      ORDER BY (d.nome ILIKE $2) DESC, lower(d.nome) LIMIT 100`, [uid(req), like]);
  const cartelle = await many(`SELECT ${C_COLS} FROM cartelle c WHERE c.nome ILIKE $1 OR c.descrizione ILIKE $1 ORDER BY lower(c.nome) LIMIT 50`, [like]);
  res.json({ q: text, documenti, cartelle });
}));

// ---- Scheda del documento (per la pagina di anteprima): metadati, percorso, versioni precedenti
r.get('/documenti/:id', ah(async (req, res) => {
  const d = await loadDocumento(idOf(req.params.id, 'Documento non trovato'), uid(req));
  if (!d) throw notFound('Documento non trovato');
  res.json({ ...d, anteprima: isPreviewable(d.mime), percorso_catena: await catena(d.cartella_id) });
}));
r.get('/documenti/:id/versioni', ah(async (req, res) => {
  const d = await loadDocumento(idOf(req.params.id, 'Documento non trovato'), uid(req));
  if (!d) throw notFound('Documento non trovato');
  const rows = await many(`SELECT v.id, v.versione, v.filename, v.mime, v.size, v.caricato_da_user_id, u.full_name AS caricato_da_nome, v.created_at
      FROM versioni v LEFT JOIN public.users u ON u.id=v.caricato_da_user_id WHERE v.documento_id=$1 ORDER BY v.versione DESC`, [d.id]);
  res.json({ corrente: { versione: d.versione, filename: d.filename, mime: d.mime, size: d.size, caricato_da_nome: d.caricato_da_nome, created_at: d.updated_at }, precedenti: rows });
}));

// ---- Download e anteprima: segnano la lettura (prima apertura per utente)
async function segnaLettura(docId, userId) {
  await q('INSERT INTO letture (documento_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [docId, userId]);
}
function invia(res, { nome, mime, data, size }, inline) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(size ?? data.length));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${String(nome).replace(/["\\\r\n]/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}
// Nome del file scaricato: nome mostrato con l'estensione originale, se manca
function nomeFile(d) {
  const ext = String(d.filename || '').split('.').pop()?.toLowerCase();
  if (ext && !d.nome.toLowerCase().endsWith(`.${ext}`)) return `${d.nome}.${ext}`;
  return d.nome;
}
r.get('/documenti/:id/download', ah(async (req, res) => {
  const d = await one('SELECT id, nome, filename, mime, size, data FROM documenti WHERE id=$1', [idOf(req.params.id, 'Documento non trovato')]);
  if (!d) throw notFound('Documento non trovato');
  await segnaLettura(d.id, uid(req));
  invia(res, { ...d, nome: nomeFile(d) }, false);
}));
r.get('/documenti/:id/anteprima', ah(async (req, res) => {
  const d = await one('SELECT id, nome, filename, mime, size, data FROM documenti WHERE id=$1', [idOf(req.params.id, 'Documento non trovato')]);
  if (!d) throw notFound('Documento non trovato');
  if (!isPreviewable(d.mime)) throw bad('Anteprima disponibile solo per PDF e immagini');
  await segnaLettura(d.id, uid(req));
  invia(res, { ...d, nome: nomeFile(d) }, true);
}));
// Versione precedente
r.get('/documenti/:id/versioni/:v/download', ah(async (req, res) => {
  const v = await one('SELECT v.id, v.versione, v.filename, v.mime, v.size, v.data FROM versioni v WHERE v.documento_id=$1 AND v.versione=$2', [idOf(req.params.id, 'Documento non trovato'), idOf(req.params.v, 'Versione non trovata')]);
  if (!v) throw notFound('Versione non trovata');
  invia(res, { ...v, nome: v.filename }, false);
}));

export default r;
