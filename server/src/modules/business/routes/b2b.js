// Business Hub · form online PUBBLICA per il cliente (richiesta del CEO del 06/11/2026: "i relativi allegati che vorrei far compilare
// direttamente con delle form in suite"). Per la linea Punti Prelievo la stessa form in variante PARTNER: dati del referente del partner e
// contratto firmato (il MOD173 al partner non serve). Montata prima della sessione (mountPublic) sotto /api/business/b2b: nessun login, l'accesso è il
// token dell'account (nel link del kit di proposta), con scadenza (Impostazioni, 60 giorni) e rinnovo dalla scheda account.
// GET  /api/business/b2b/:token              dati della pagina (cliente, campi del MOD173 precompilati, allegati richiesti)
// GET  /api/business/b2b/:token/mod173.pdf   il modulo MOD173 compilabile precompilato
// POST /api/business/b2b/:token              invio: anagrafica (JSON nel campo "dati"), contratto firmato (PDF) e allegati
// Il modulo deve essere LIVE. Limiti: 10 MB per file, 12 file, 30 invii ogni 15 minuti per indirizzo IP. Le POST vogliono
// l'intestazione X-Requested-With della Suite (anti CSRF). Nei log solo l'id dell'account e gli esiti.
import express, { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { getModuleState } from '../../../lib/modules.js';
import { getCompany } from '../../../lib/company.js';
import { accountDaToken, datiForm, riceviForm, referentePrincipale } from '../lib/flusso.js';
import { precompila, SEZIONI_MOD173, CAMPI_MOD173 } from '../lib/processo.js';
import { mod173Pdf } from '../lib/mod173Pdf.js';
import { one } from '../db.js';
import { getSettings } from '../lib/rules.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 12, fields: 20, fieldSize: 200 * 1024 } });
const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Troppi invii in poco tempo: riprovate tra qualche minuto' } });
const lettura = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Troppe richieste: riprovate tra qualche minuto' } });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// il modulo deve essere LIVE (in MIRROR le scritture sono bloccate, OFF non esiste)
r.use(ah(async (_req, _res, next) => {
  const st = await getModuleState('business');
  if (st.mode !== 'LIVE' || !st.schema_ready) throw Object.assign(new Error('Servizio non disponibile'), { status: 503 });
  next();
}));
r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

r.get('/:token', lettura, ah(async (req, res) => {
  const a = await accountDaToken(req.params.token);
  // linea Punti Prelievo: variante PARTNER (referente e contratto firmato, senza MOD173): sezioni e campi li dà datiForm
  res.json({ variante: 'MOD173', sezioni: SEZIONI_MOD173, campi: CAMPI_MOD173.map(({ s, k, label, t, opzioni, req: obbl }) => ({ s, k, label, t, opzioni, obbligatorio: Boolean(obbl) })), ...(await datiForm(a)) });
}));

r.get('/:token/mod173.pdf', lettura, ah(async (req, res) => {
  const a = await accountDaToken(req.params.token);
  if (a.linea === 'PP') throw Object.assign(new Error('Il modulo MOD173 non serve per il punto prelievi'), { status: 404 });
  const [o, x, s, company, ref] = await Promise.all([
    one('SELECT * FROM public.organizations WHERE id=$1', [a.organization_id]), one('SELECT * FROM org_ext WHERE org_id=$1', [a.organization_id]), getSettings(), getCompany(), referentePrincipale(a.id),
  ]);
  const ultima = await one('SELECT dati FROM anagrafiche_b2b WHERE account_id=$1 ORDER BY versione DESC LIMIT 1', [a.id]);
  const pdf = await mod173Pdf(precompila({ org: o || {}, ext: x || {}, referente: ref, linea: a.linea, labAddress: s.lab_address, ultima: ultima?.dati }), { modalita: 'compilabile', company, cliente: a.org_name });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="TD-SGI-MOD173_00_Anagrafica_Clienti_B2B.pdf"');
  res.send(pdf);
}));

r.post('/:token', limite, (req, _res, next) => (req.get('X-Requested-With') === 'td-suite' ? next() : next(Object.assign(new Error('Richiesta non valida'), { status: 403 }))),
  (req, res, next) => upload.any()(req, res, (e) => (e ? next(Object.assign(new Error(e.code === 'LIMIT_FILE_SIZE' ? 'File troppo grande (massimo 10 MB)' : 'Caricamento non riuscito'), { status: e.code === 'LIMIT_FILE_SIZE' ? 413 : 400 })) : next())),
  ah(async (req, res) => {
    const a = await accountDaToken(req.params.token);
    let dati = {};
    try { dati = JSON.parse(req.body?.dati || '{}'); } catch { throw Object.assign(new Error('Dati non validi'), { status: 400 }); }
    const files = { contratto: null, allegati: [] };
    for (const f of req.files || []) {
      if (f.fieldname === 'contratto') files.contratto = f;
      else if (/^allegato_\d{1,2}$/.test(f.fieldname)) files.allegati.push({ indice: Number(f.fieldname.split('_')[1]), file: f });
    }
    const out = await riceviForm(a, dati, files, { ip: req.ip, contrattoPerEmail: req.body?.contratto_per_email === 'true' });
    res.status(201).json({ ok: true, ...out });
  }));

// errori della pagina pubblica: messaggio e dettagli dei campi, mai lo stack
r.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[business] form online: errore interno');
  res.status(status).json({ error: status >= 500 ? 'Errore interno: riprovate più tardi' : err.message, details: err.details || undefined });
});

export function mountB2b(app) { app.use('/api/business/b2b', express.json({ limit: '200kb' }), r); }
