// Modulo Room Planning (planning.toscanadiagnostica.it) travasato nella Suite: pianificazione ambulatori, sedi, personale sanitario.
// Autenticazione, utenti e profili sono della Suite; il codice dell'app lavora con la "sua" riga users nello schema room
// (req.moduleUser) con role = profilo del grant e struttura_ids = sedi degli scope del grant.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { HttpError } from '../../lib/util.js';
import { PROF_PREFIXES } from './lib/access.js';
import { runDailyAlert } from './lib/alerts.js';
import struttureRoutes from './routes/strutture.js';
import calendarioRoutes from './routes/calendario.js';
import commsRoutes from './routes/comms.js';
import personaleRoutes from './routes/personale.js';
import portaleRoutes from './routes/portale.js';
import adminRoutes from './routes/admin.js';

const KEY = 'room';

// Stessa forma dell'utente che il front-end dell'app si aspetta da /auth/me
export const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, role: u.role, auth_provider: u.auth_provider || 'ENTRA',
  must_change_password: false, totp_enabled: false, active: true, struttura_ids: u.struttura_ids || [],
  suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // L'app ragiona con il suo utente: la riga users dello schema room, con il ruolo = profilo del grant Suite.
  // Il perimetro (user_strutture dell'app) viene dagli scope del grant, tradotti negli id delle sedi dell'app.
  r.use((req, _res, next) => {
    req.suiteUser = req.user;
    req.user = { ...req.moduleUser, struttura_ids: req.moduleUser.legacy_site_ids || [] };
    next();
  });
  r.get('/state', async (req, res, next) => {
    try { const st = await getModuleState(KEY); res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) }); } catch (e) { next(e); }
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), onboarding: null, authMethod: 'SUITE' }));
  // I professionisti (profilo PROF) usano solo il proprio portale
  r.use((req, _res, next) => (req.user?.role === 'PROF' && !PROF_PREFIXES.some((p) => req.path.startsWith(p)) ? next(new HttpError(403, 'Area riservata al personale interno')) : next()));
  r.use(blockWritesInMirror);
  r.use('/personale', personaleRoutes);
  r.use('/portale', portaleRoutes);
  r.use('/strutture', struttureRoutes);
  r.use('/calendario', calendarioRoutes);
  r.use('/comms', commsRoutes);
  r.use(adminRoutes);   // settings, criticita, backup, audit
  app.use(`/api/${KEY}`, r);

  // Avviso giornaliero sulle criticità delle sedi (come lo scheduler dell'app): solo con modulo LIVE
  registerJob(`${KEY}:avvisi-criticita`, 10, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    return (await runDailyAlert()) || { skipped: true, reason: 'non dovuto' };
  });
}
