// Modulo Contracts (Contratti del Personale, People): dipendenti e liberi professionisti, dossier con allegati, CCNL e
// minimi tabellari, simulatore busta paga, generazione DOCX/PDF di contratti, MBO, lettere di impegno e contratti LP,
// organigramma generato dai ruoli, scadenze, CV Box, caricamento massivo e pacchetto iniziale.
// Travasato dall'app contracts.toscanadiagnostica.it: il codice delle route è quello dell'app, cambiano solo accesso
// (sessione e grant della Suite) e montaggio sotto /api/contracts.
// MODULO RISERVATO: entra solo chi ha il grant contracts oppure il titolare della Suite (OWNER). Un ADMIN Suite senza grant
// non vede nulla, a differenza degli altri moduli. Ogni lettura di una scheda viene registrata nel read_log della Suite.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { HttpError, forbidden } from '../../lib/util.js';
import { config } from './config.js';
import { publicUser } from './lib/access.js';
import { applyDueTerminations } from './lib/termination.js';
import adminRoutes from './routes/admin.js';
import resourceRoutes from './routes/resources.js';
import documentRoutes from './routes/documents.js';
import scoutingRoutes from './routes/scouting.js';
import ccnlRoutes from './routes/ccnl.js';
import orgRoutes from './routes/org.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/imports.js';

const KEY = 'contracts';

export default function mount(app) {
  const r = Router();
  // Modulo riservato: il controllo sta prima di requireModuleReady così un ADMIN Suite senza grant viene respinto (403)
  // senza che venga creata la sua riga nella tabella users dello schema del modulo. defaultAdminRole 'ADMIN' vale quindi SOLO per OWNER.
  const requireGrantOrOwner = (req, _res, next) => (req.user.level === 'OWNER' || req.user.grants?.[KEY] ? next() : next(forbidden('Modulo riservato: accesso consentito solo con un profilo assegnato dal titolare')));
  r.use(requireAuth, requireGrantOrOwner, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  r.use((req, _res, next) => {
    if (req.user.level !== 'OWNER' && !req.user.grants?.[KEY]) return next(forbidden('Modulo riservato'));   // difesa in profondità
    // l'app ragiona con il "suo" utente: la riga della tabella users dello schema contracts, con role = profilo del grant Suite
    req.suiteUser = req.user;
    req.user = req.moduleUser;
    next();
  });

  r.get('/state', async (req, res, next) => {
    try {
      const st = await getModuleState(KEY);
      res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
    } catch (e) { next(e); }
  });
  // stessa forma che il front-end dell'app si aspetta da /auth/me
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', onboarding: null }));
  r.get('/auth/config', (_req, res) => res.json({ appName: config.appName, entraEnabled: false }));

  // Il simulatore busta paga è un POST di solo calcolo (nessuna scrittura): resta disponibile anche in MIRROR
  r.use('/ccnl', (req, res, next) => (req.method === 'POST' && req.path === '/simulate' ? ccnlRoutes(req, res, next) : next()));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);                // settings, areas, work-sites, audit (gli utenti li gestisce la Suite)
  r.use('/resources', resourceRoutes);
  r.use(documentRoutes);              // /resources/:id/documents/generate, /documents/...
  r.use('/scouting', scoutingRoutes);
  r.use('/ccnl', ccnlRoutes);
  r.use('/org', orgRoutes);
  r.use('/stats', statsRoutes);
  r.use('/import', importRoutes);
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

  // Errori propri del modulo (multer, duplicati): il resto lo gestisce l'error handler della Suite
  r.use((err, req, _res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (max ${req.path.startsWith('/import') ? config.maxPackMb : config.maxUploadMb} MB)`));
    if (err?.code === '23505') return next(new HttpError(409, 'Elemento duplicato (codice fiscale o email già presenti)'));
    next(err);
  });

  app.use(`/api/${KEY}`, r);

  // Cessazioni con decorrenza raggiunta: una volta al giorno, solo con modulo LIVE (in MIRROR i dati arrivano dall'app originale)
  registerJob(`${KEY}:cessazioni`, 24 * 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    const n = await applyDueTerminations();
    return { cessate: n };
  });
}
