// Modulo Business (Contratti B2C/B2B): partner, contratti in quattro sezioni (punti prelievo, sedi in locazione, service,
// medicina del lavoro), dossier e fascicoli di autorizzazione, protocolli, credenziali dei portali, generazione DOCX/PDF,
// importazione dello status quo. Travasato dall'app business.toscanadiagnostica.it: il codice delle route è quello dell'app,
// cambiano solo accesso (sessione e grant della Suite) e montaggio sotto /api/business.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { HttpError } from '../../lib/util.js';
import { config } from './config.js';
import { publicUser } from './lib/access.js';
import adminRoutes from './routes/admin.js';
import contractRoutes, { filesRouter } from './routes/contracts.js';
import dossierRoutes, { dossierFilesRouter } from './routes/dossier.js';
import statsRoutes from './routes/stats.js';

const KEY = 'business';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // l'app ragiona con il "suo" utente: la riga della tabella users dello schema business, con role = profilo del grant Suite
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });

  r.get('/state', async (req, res, next) => {
    try {
      const st = await getModuleState(KEY);
      res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
    } catch (e) { next(e); }
  });
  // stessa forma che il front-end dell'app si aspetta da /auth/me
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', onboarding: null }));
  r.get('/auth/config', (_req, res) => res.json({ appName: config.appName, entraEnabled: false }));

  r.use(blockWritesInMirror);
  r.use(adminRoutes);            // settings, partners, audit, import (gli utenti li gestisce la Suite)
  r.use('/contracts', contractRoutes);
  r.use('/dossiers', dossierRoutes);
  r.use(filesRouter);            // GET /contract-files/:id
  r.use(dossierFilesRouter);     // GET /dossier-files/:id
  r.use('/stats', statsRoutes);
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

  // Errori propri del modulo (multer, duplicati): il resto lo gestisce l'error handler della Suite
  r.use((err, req, _res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (max ${req.path.includes('/import') ? config.maxImportMb : config.maxUploadMb} MB)`));
    if (err?.code === '23505') return next(new HttpError(409, 'Elemento duplicato'));
    next(err);
  });

  app.use(`/api/${KEY}`, r);
}
