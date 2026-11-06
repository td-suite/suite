// Business Hub · caselle di linea (Impostazioni, Admin del modulo): stato, "Prova la casella", "Prova l'invio", "Leggi ora"; simulazione
// di un messaggio in arrivo per il collaudo (POST /api/business/inbox/simula, solo con NODE_ENV diverso da production: passa dallo
// stesso ingest della casella). Indirizzi, lettura on/off e copie fisse si salvano con PUT /api/business/settings (chiavi hub_*).
import { Router } from 'express';
import multer from 'multer';
import { ah, bad, audit } from '../lib/util.js';
import { HttpError } from '../../../lib/util.js';
import { requireAdmin, requireManager } from '../lib/access.js';
import { getSettings } from '../lib/rules.js';
import { LINEE_KEYS } from '../lib/hub.js';
import { statoCaselle, provaLettura, provaInvio, pollCaselle, ingestEmail, nuovoIdSimulato, casella } from '../lib/caselle.js';

const r = Router();
const linea = (req) => { const l = String(req.params.linea || req.body?.linea || '').toUpperCase(); if (!LINEE_KEYS.includes(l)) throw bad('Linea non valida (SRV, PP, MDL)'); return l; };

r.get('/hub/caselle', requireManager, ah(async (_req, res) => res.json(await statoCaselle())));

r.post('/hub/caselle/:linea/prova', requireAdmin, ah(async (req, res) => {
  const l = linea(req);
  const out = await provaLettura(l);
  await audit(req, 'HUB_CASELLA_PROVA', 'casella', l, { ok: out.ok });
  res.json(out);
}));
r.post('/hub/caselle/:linea/prova-invio', requireAdmin, ah(async (req, res) => {
  const l = linea(req);
  const out = await provaInvio(l, String(req.body?.to || req.suiteUser?.email || ''));
  await audit(req, 'HUB_CASELLA_PROVA_INVIO', 'casella', l, { ok: out.ok, logged: Boolean(out.logged) });
  res.json(out);
}));
r.post('/hub/caselle/leggi', requireAdmin, ah(async (req, res) => {
  const out = await pollCaselle({ force: true, solo: req.body?.linea || null });
  if (out.skipped === 'graph_non_configurato') throw bad('Microsoft Graph non configurato: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)');
  await audit(req, 'HUB_CASELLE_LETTURA', 'casella', null, out);
  res.json(out);
}));

// Simulazione di collaudo: mittente, oggetto, testo breve e allegati passano dallo stesso ingest della casella della linea
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 5 } }).array('file', 5);
const conUpload = (req, res, next) => upload(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'File troppo grande') : bad(e.message)) : next()));
r.post('/inbox/simula', (req, _res, next) => (process.env.NODE_ENV === 'production' ? next(new HttpError(404, 'Non disponibile')) : next()), requireManager, conUpload, ah(async (req, res) => {
  const l = linea(req);
  const fromEmail = String(req.body?.from_email || '').trim();
  if (!fromEmail) throw bad('Indica from_email (mittente simulato)');
  const s = await getSettings();
  const files = (req.files || []).map((f) => ({ filename: f.originalname, mime: f.mimetype, buffer: f.buffer }));
  const out = await ingestEmail({ linea: l, casella: casella(l, s).address, graphId: nuovoIdSimulato(), receivedAt: new Date(), fromEmail, fromName: req.body?.from_name || null,
    subject: req.body?.subject || '', preview: req.body?.testo || '', files, simulato: true });
  await audit(req, 'HUB_CASELLA_SIMULA', 'casella', l, { abbinato: out.abbinato, allegati: files.length });
  res.status(201).json(out);
}));

export default r;
