// Casella template@ (Impostazioni, profilo QUALITA o admin): stato, "Prova la casella", "Prova l'invio", "Leggi ora"; simulazione di
// un messaggio in arrivo per il collaudo (POST /inbox/simula, solo con NODE_ENV diverso da production: passa dallo stesso ingest della
// casella). Le impostazioni (indirizzo, Leggi la casella, Invia al mittente) si salvano con PUT /settings.
import { Router } from 'express';
import multer from 'multer';
import { ah, audit, bad, HttpError } from '../../../lib/util.js';
import { requireLab, requireQualita } from '../lib/access.js';
import { config } from '../config.js';
import { KEY } from '../lib/core.js';
import { statoCasella, provaLettura, provaInvio, pollCasella, ingestMessaggio, nuovoIdSimulato } from '../lib/casella.js';
import { motivoLettura } from '../../../lib/graphInbox.js';

const r = Router();

r.get('/casella', requireQualita, ah(async (_req, res) => res.json(await statoCasella())));

r.post('/casella/prova', requireQualita, ah(async (req, res) => {
  const out = await provaLettura();
  await audit(req, 'REFERTI_CASELLA_PROVA', { module: KEY, entity: 'casella', data: { ok: out.ok } });
  res.json(out);
}));

r.post('/casella/prova-invio', requireQualita, ah(async (req, res) => {
  const out = await provaInvio(String(req.body?.to || req.user.email || ''));
  await audit(req, 'REFERTI_CASELLA_PROVA_INVIO', { module: KEY, entity: 'casella', data: { ok: out.ok, logged: Boolean(out.logged) } });
  res.json(out);
}));

// Lettura immediata (oltre al job ogni 10 minuti)
r.post('/casella/leggi', requireQualita, ah(async (req, res) => {
  let out;
  try { out = await pollCasella({ force: true }); } catch (e) { throw bad(motivoLettura(e.message, (await statoCasella()).mailbox)); }
  if (out.skipped === 'graph_non_configurato') throw bad('Microsoft Graph non configurato: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)');
  await audit(req, 'REFERTI_CASELLA_LETTURA', { module: KEY, entity: 'casella', data: out });
  res.json(out);
}));

// Simulazione di collaudo: un messaggio con mittente, oggetto e PDF allegati passa dallo stesso ingest della casella
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 5 } }).array('file', 5);
const conUpload = (req, res, next) => upload(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'File troppo grande') : bad(e.message)) : next()));
r.post('/inbox/simula', (req, _res, next) => (process.env.NODE_ENV === 'production' ? next(new HttpError(404, 'Non disponibile')) : next()), requireLab, conUpload, ah(async (req, res) => {
  const files = (req.files || []).map((f) => ({ filename: f.originalname, mime: f.mimetype, buffer: f.buffer }));
  const fromEmail = String(req.body?.from_email || '').trim();
  if (!fromEmail) throw bad('Indica from_email (mittente simulato)');
  const out = await ingestMessaggio({ graphId: nuovoIdSimulato(), messageId: null, receivedAt: new Date(), fromEmail, fromName: req.body?.from_name || null, subject: req.body?.subject || '', files, simulato: true });
  await audit(req, 'REFERTI_CASELLA_SIMULA', { module: KEY, entity: 'casella', data: { pdf: files.length, elaborazioni: (out.elaborazioni || []).filter((x) => x.id).length } });
  res.status(201).json(out);
}));

export default r;
