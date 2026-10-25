// Modulo Shipments (Spedizioni e Kit): montaggio dentro la Suite TD.
// Le route sono quelle dell'app di origine, montate sotto /api/shipments; autenticazione, utenti e profili sono della Suite.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { config } from './config.js';
import { readOnlyGuard } from './lib/access.js';
import { graphConfigured } from './lib/mailer.js';
import { pollInbox, runDailyAlerts, anonymizeClosed } from './lib/jobs.js';
import { pollTracking } from './lib/tracking.js';
import adminRoutes from './routes/admin.js';
import kitRoutes from './routes/kits.js';
import orderRoutes from './routes/orders.js';
import labRoutes from './routes/lab.js';
import reportRoutes from './routes/reports.js';
import billingRoutes from './routes/billing.js';

const KEY = 'shipments';

// Utente come lo vede il front-end dell'app: riga users del modulo + profilo Suite + lingua della Suite
const publicUser = (u, suiteUser) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, lang: suiteUser?.lang || u.lang || 'it',
  active: true, auth_provider: suiteUser?.auth_provider || u.auth_provider, totp_enabled: Boolean(suiteUser?.totp_enabled),
  suite_user_id: u.suite_user_id, suite_level: u.suite_level, legacy_site_ids: u.legacy_site_ids || [],
});

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'SUPERADMIN' } }));
  // l'app ragiona con il "suo" utente (tabella users dello schema shipments, ruolo = profilo del grant Suite);
  // la lingua dell'interfaccia e delle risposte è quella dell'utente Suite
  r.use((req, _res, next) => {
    req.suiteUser = req.user;
    req.user = req.moduleUser;
    req.lang = req.suiteUser.lang === 'en' ? 'en' : 'it';
    next();
  });
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { many } = await import('./db.js');
      const rows = await many(`SELECT project, count(*)::int AS n FROM orders WHERE status='NEW' GROUP BY project`);
      res.json(Object.fromEntries(rows.map((x) => [`${String(x.project).toLowerCase()}_new`, x.n])));
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res) => {
    const st = await getModuleState(KEY);
    res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user, req.suiteUser) });
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user, req.suiteUser), authMethod: 'SUITE', onboarding: null }));
  r.use(blockWritesInMirror);
  r.use(readOnlyGuard);
  r.use(adminRoutes);
  r.use('/kits', kitRoutes);
  r.use('/orders', orderRoutes);
  r.use('/lab', labRoutes);
  r.use('/reports', reportRoutes);
  r.use('/billing', billingRoutes);
  app.use(`/api/${KEY}`, r);

  // Lavori di sfondo: girano solo con modulo LIVE (in MIRROR i dati arrivano dall'app originale e verrebbero sovrascritti)
  const onlyLive = (fn) => async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: 'not_live' };
    return fn();
  };
  // Lettura della casella shipments@: solo con le variabili Graph presenti (credenziali applicative e casella)
  registerJob(`${KEY}:inbox`, Math.max(1, config.graph.pollMinutes), onlyLive(async () => {
    if (!graphConfigured() || !config.graph.inbox) return { skipped: 'graph_not_configured' };
    return pollInbox();
  }));
  registerJob(`${KEY}:tracking`, Math.max(5, config.tracking.pollMinutes), onlyLive(() => pollTracking()));
  registerJob(`${KEY}:alerts`, 10, onlyLive(() => runDailyAlerts()));
  registerJob(`${KEY}:retention`, 6 * 60, onlyLive(async () => ({ anonymized: await anonymizeClosed() })));
}
