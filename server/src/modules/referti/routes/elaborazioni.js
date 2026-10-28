// Elaborazioni: caricamento dei PDF (multiplo, in memoria, max 20 MB l'uno), elenco, dettaglio con schede, conferma delle schede "verdi".
import { Router } from 'express';
import multer from 'multer';
import { many, one } from '../db.js';
import { config } from '../config.js';
import { ah, audit, bad, HttpError } from '../../../lib/util.js';
import { requireLab } from '../lib/access.js';
import { KEY, idOf, elaboraUpload, elaborazioneCon, confermaScheda, S_COLS, S_FROM } from '../lib/core.js';

const r = Router();
const MB = 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: config.maxFilesPerUpload } }).array('file', config.maxFilesPerUpload);
const conUpload = (req, res, next) => upload(req, res, (e) => {
  if (!e) return next();
  if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${config.maxFileBytes / MB} MB per PDF)`));
  if (e.code === 'LIMIT_FILE_COUNT') return next(bad(`Massimo ${config.maxFilesPerUpload} PDF per caricamento`));
  next(bad(e.message));
});

// Caricamento: ogni PDF diventa un'elaborazione (ELABORATO con schede in BOZZA oppure SCARTATO con motivo)
r.post('/elaborazioni', requireLab, conUpload, ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw bad('Nessun file ricevuto (campo "file")');
  const out = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.originalname || '')) { out.push({ filename: f.originalname, stato: 'SCARTATO', motivo_scarto: 'Solo file PDF', schede: [] }); continue; }
    try {
      const e = await elaboraUpload(f, req.user.id);
      out.push({ id: e.id, filename: e.filename, stato: e.stato, motivo_scarto: e.motivo_scarto || null, pagine: e.pagine, sorgente: e.sorgente, ocr: e.ocr || false,
        schede: (e.schede || []).map((s) => ({ id: s.id, pagine: s.pagine, cognome_nome: s.cognome_nome, anomalie: s.anomalie, stato: s.stato })) });
    } catch (e) {
      if (e instanceof HttpError) { out.push({ filename: f.originalname, stato: 'SCARTATO', motivo_scarto: e.message, schede: [] }); continue; }
      console.error('[referti] elaborazione fallita', e.message);   // nessun nome di paziente nei log
      out.push({ filename: f.originalname, stato: 'SCARTATO', motivo_scarto: 'Errore interno durante l\'elaborazione', schede: [] });
    }
  }
  // audit della Suite: solo id e conteggi
  await audit(req, 'REFERTI_UPLOAD', { module: KEY, entity: 'elaborazione', label: `${out.length} PDF`, data: { elaborazioni: out.filter((x) => x.id).map((x) => x.id), scartati: out.filter((x) => x.stato === 'SCARTATO').length, schede: out.reduce((n, x) => n + x.schede.length, 0) } });
  res.status(201).json({ elaborazioni: out });
}));

r.get('/elaborazioni', ah(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const stato = typeof req.query.stato === 'string' && ['CARICATO', 'ELABORATO', 'SCARTATO'].includes(req.query.stato) ? req.query.stato : null;
  const rows = await many(`SELECT e.id, e.filename, e.size, e.pagine, e.sorgente, e.stato, e.motivo_scarto, e.ocr, e.created_at, u.full_name AS uploaded_by_nome,
      (SELECT count(*)::int FROM schede s WHERE s.elaborazione_id=e.id) AS n_schede,
      (SELECT count(*)::int FROM schede s WHERE s.elaborazione_id=e.id AND s.stato='BOZZA') AS n_bozze,
      (SELECT count(*)::int FROM schede s WHERE s.elaborazione_id=e.id AND s.stato='CONFERMATA') AS n_confermate,
      (SELECT count(*)::int FROM schede s WHERE s.elaborazione_id=e.id AND s.stato='SCARTATA') AS n_scartate,
      (SELECT count(*)::int FROM schede s WHERE s.elaborazione_id=e.id AND s.stato='BOZZA' AND jsonb_array_length(s.anomalie)=0) AS n_verdi
    FROM elaborazioni e LEFT JOIN public.users u ON u.id=e.uploaded_by ${stato ? 'WHERE e.stato=$2' : ''} ORDER BY e.created_at DESC LIMIT $1`, stato ? [limit, stato] : [limit]);
  res.json(rows);
}));

r.get('/elaborazioni/:id', ah(async (req, res) => res.json(await elaborazioneCon(idOf(req.params.id, 'Elaborazione non trovata')))));

// Conferma tutte le schede in bozza senza anomalie dell'elaborazione (tipico dei lotti KPC)
r.post('/elaborazioni/:id/conferma-verdi', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Elaborazione non trovata');
  if (!(await one('SELECT 1 FROM elaborazioni WHERE id=$1', [id]))) throw bad('Elaborazione non trovata');
  const verdi = await many(`SELECT id FROM schede WHERE elaborazione_id=$1 AND stato='BOZZA' AND jsonb_array_length(anomalie)=0 ORDER BY id`, [id]);
  const confermate = []; const nonCoerenti = [];
  for (const s of verdi) {
    try { confermate.push(await confermaScheda(s.id, req.user.id)); }
    catch (e) { if (e instanceof HttpError && e.status === 400) nonCoerenti.push({ id: s.id, coerenza: e.details?.coerenza || null, errore: e.message }); else throw e; }
  }
  await audit(req, 'REFERTI_CONFERMA_VERDI', { module: KEY, entity: 'elaborazione', entityId: id, data: { confermate: confermate.length, non_coerenti: nonCoerenti.length } });
  res.json({ confermate: confermate.map((c) => ({ id: c.id, nome_file: c.nome_file, suffisso: c.suffisso })), non_coerenti: nonCoerenti });
}));

// Schede in bozza di tutte le elaborazioni (Inbox)
r.get('/schede', ah(async (req, res) => {
  const stato = typeof req.query.stato === 'string' && ['BOZZA', 'CONFERMATA', 'SCARTATA'].includes(req.query.stato) ? req.query.stato : 'BOZZA';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json(await many(`SELECT ${S_COLS} FROM ${S_FROM} WHERE s.stato=$1 ORDER BY s.created_at DESC, s.id LIMIT $2`, [stato, limit]));
}));

export default r;
