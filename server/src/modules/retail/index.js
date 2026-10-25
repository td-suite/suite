// Modulo Retail Assistant (retail.toscanadiagnostica.it) travasato nella Suite: clienti B2C e B2B, vendite, prestazioni,
// campagne, calendario promozionale, esposizione e book retail, budget e scostamenti, import dai gestionali, connettori.
// Autenticazione, utenti e profili sono della Suite; il codice dell'app lavora con la "sua" riga users nello schema retail
// (req.moduleUser) con role = profilo del grant (ADMIN, RETAIL, SEDE, VIEWER) e site_ids = sedi dell'anagrafica unica negli scope del grant.
// Sedi e persone sono quelle della Suite (public.sites, public.people): il modulo tiene solo site_ext e person_ext (docs/ANAGRAFICA.md).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { many } from './db.js';
import { config } from './config.js';
import { syncConnector } from './lib/connectors.js';
import adminRoutes from './routes/admin.js';
import customerRoutes from './routes/customers.js';
import productRoutes from './routes/products.js';
import salesRoutes from './routes/sales.js';
import campaignRoutes from './routes/campaigns.js';
import promotionRoutes from './routes/promotions.js';
import exposureRoutes from './routes/exposure.js';
import connectorRoutes from './routes/connectors.js';
import statsRoutes from './routes/stats.js';
import budgetRoutes from './routes/budget.js';
import structureRoutes from './routes/structure.js';

const KEY = 'retail';

// Stessa forma dell'utente che il front-end dell'app si aspetta da /auth/me
export const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, site_id: u.site_id ?? null, site_ids: u.site_ids || [],
  auth_provider: u.auth_provider || 'ENTRA', must_change_password: false, totp_enabled: false, active: true,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // L'app ragiona con il suo utente: la riga users dello schema retail, con il ruolo = profilo del grant Suite.
  // Il perimetro del profilo SEDE sono gli id di public.sites negli scope SITE del grant (anagrafica unica, req.moduleUser.site_ids).
  r.use((req, _res, next) => {
    req.suiteUser = req.user;
    const siteIds = (req.moduleUser.site_ids || []).map(Number).filter(Number.isFinite);
    req.user = { ...req.moduleUser, site_id: siteIds[0] ?? null, site_ids: siteIds };
    next();
  });
  r.get('/state', async (req, res, next) => {
    try { const st = await getModuleState(KEY); res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) }); } catch (e) { next(e); }
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), onboarding: null, authMethod: 'SUITE' }));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);                 // settings, demo, sites, product-lines, audit
  r.use('/customers', customerRoutes);
  r.use('/products', productRoutes);
  r.use('/sales', salesRoutes);
  r.use('/campaigns', campaignRoutes);
  r.use('/promotions', promotionRoutes);
  r.use('/exposure', exposureRoutes);
  r.use('/connectors', connectorRoutes);
  r.use('/stats', statsRoutes);
  r.use(budgetRoutes);                // working-days, budgets, variance, market
  r.use('/structure', structureRoutes);
  // Errori specifici dell'app (duplicati, file troppo grandi) con i messaggi dell'app; il resto al gestore della Suite
  r.use((err, _req, res, next) => {
    if (err?.code === '23505') return res.status(409).json({ error: 'Elemento duplicato (codice, codice fiscale, partita IVA o email già presenti)' });
    if (err?.code === '23503') return res.status(400).json({ error: 'Riferimento non valido: la sede, la persona o l\'organizzazione indicata non esiste nell\'anagrafica della Suite' });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File troppo grande (max ${config.maxUploadMb} MB)` });
    next(err);
  });
  app.use(`/api/${KEY}`, r);

  // Sincronizzazione schedulata dei connettori abilitati (come lo scheduler dell'app, controllo ogni 15 minuti): solo con modulo LIVE
  registerJob(`${KEY}:sync-connettori`, 15, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    const rows = await many("SELECT kind, schedule, last_sync_at FROM connectors WHERE enabled AND schedule<>'MANUALE'");
    const done = [];
    for (const c of rows) {
      const hours = c.schedule === 'HOURLY' ? 1 : 24;
      if (c.last_sync_at && Date.now() - new Date(c.last_sync_at).getTime() < hours * 3600 * 1000) continue;
      try { await syncConnector(c.kind, null); done.push({ kind: c.kind, ok: true }); } catch (e) { done.push({ kind: c.kind, error: e.message }); }
    }
    return { synced: done };
  });
}
