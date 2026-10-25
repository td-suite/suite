// Modulo Orders (Ordini e Magazzino, Orders Management v2): montaggio dentro la Suite TD.
// Le route sono quelle dell'app di origine, montate sotto /api/orders; autenticazione, utenti, profili e sedi sono della Suite.
// Canali macchina (Silva Group, StudioLab HL7): sotto /api/orders/integrations, con chiave API e senza sessione.
import express, { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { one } from './db.js';
import { ah } from './lib/util.js';
import { requireRole, OPS_ROLES, STRUTTURA_ROLES } from './lib/access.js';
import { runDailyAlerts } from './lib/alerts.js';
import adminRoutes from './routes/admin.js';
import orderRoutes from './routes/orders.js';
import stockRoutes from './routes/stock.js';
import productionRoutes from './routes/production.js';
import statsRoutes from './routes/stats.js';
import warehouseRoutes from './routes/warehouse.js';
import integrationRoutes from './routes/integrations.js';

const KEY = 'orders';

// Utente come lo vede il front-end dell'app: riga users del modulo + profilo Suite + sede di appartenenza (anagrafica unica)
const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, struttura_id: u.struttura_id ?? null,
  struttura_name: u.struttura_name || null, struttura_code: u.struttura_code || null, struttura_kind: u.struttura_kind || null, stock_deadline_day: u.stock_deadline_day ?? null,
  is_referente: Boolean(u.is_referente), active: true, auth_provider: 'SUITE', totp_enabled: false, must_change_password: false,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level, person_id: u.person_id ?? null, site_ids: u.site_ids || [],
});

// Perimetro: per i profili di struttura (CLIENTE, SEDE, LAB) la sede è quella dell'ambito del grant Suite (req.user.site_ids[0],
// id di public.sites). Il laboratorio TD è unico: senza ambito si prende la sede configurata come LAB. Senza alcuna assegnazione
// l'utente non ha sede e le route di struttura rispondono "Sede obbligatoria".
async function resolveStruttura(req, _res, next) {
  try {
    const u = req.moduleUser;
    u.struttura_id = null;
    if (STRUTTURA_ROLES.includes(u.role)) {
      let sid = u.site_ids?.[0] ?? null;
      if (sid == null && u.role === 'LAB') sid = (await one("SELECT id FROM sites_v WHERE kind='LAB' AND active ORDER BY configured DESC, sort_order, id LIMIT 1"))?.id ?? null;
      u.struttura_id = sid;
    }
    if (u.struttura_id != null) {
      const s = await one('SELECT name, code, kind, stock_deadline_day FROM sites_v WHERE id=$1', [u.struttura_id]);
      if (s) { u.struttura_name = s.name; u.struttura_code = s.code; u.struttura_kind = s.kind; u.stock_deadline_day = s.stock_deadline_day; }
      else u.struttura_id = null;
    }
    req.suiteUser = req.user;
    req.user = u;
    next();
  } catch (e) { next(e); }
}

// ---- Canali macchina: chiave API nell'header X-API-KEY, nessuna sessione, nessun controllo CSRF.
// La Suite li monta prima della sessione (mountPublic), come /api/ingest.
export function mountPublic(app) {
  const machine = Router();
  machine.use(express.json({ limit: '5mb' }));
  // In MIRROR i dati arrivano dall'app originale: anche gli avanzamenti e i feed dei fornitori si rifiutano (423), come le altre scritture
  machine.use(ah(async (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return next(Object.assign(new Error('Modulo in sola lettura: fino al passaggio definitivo i fornitori chiamano le API dell\'app originale'), { status: 423, code: 'MODULE_MIRROR' }));
    next();
  }));
  machine.use(integrationRoutes);
  machine.use((_req, _res, next) => next(Object.assign(new Error('Endpoint inesistente'), { status: 404 })));

  app.use(`/api/${KEY}/integrations`, machine);
}

export default function mount(app) {
  // ---- Route dell'app, con l'utente della Suite
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'SUPERADMIN' } }));
  r.use(resolveStruttura);
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const r = await one(`SELECT count(*) FILTER (WHERE status='INVIATO')::int AS verifica FROM orders`);
      const d = await one(`SELECT count(*)::int AS n FROM issues WHERE status='APERTA'`).catch(() => ({ n: 0 }));
      res.json({ verifica: r.verifica, difformita: d.n });
    } catch (e) { next(e); }
  });
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
  }));
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', onboarding: null }));
  r.get('/auth/config', (_req, res) => res.json({ entraEnabled: false, studiolabEnabled: false, appName: 'Toscana Diagnostica · Orders Management' }));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);
  r.use('/orders', orderRoutes);
  r.use('/stock', stockRoutes);
  r.use('/production', productionRoutes);
  r.use('/stats', statsRoutes);
  r.use('/warehouse', warehouseRoutes);
  r.post('/alerts/run', requireRole(...OPS_ROLES), ah(async (_req, res) => res.json(await runDailyAlerts({ force: true }))));
  app.use(`/api/${KEY}`, r);

  // ---- Lavori di sfondo: solleciti giornalieri (giacenze mensili, carichi mancanti, ordini da verificare), solo con modulo LIVE
  registerJob(`${KEY}:alerts`, 15, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: 'not_live' };
    return (await runDailyAlerts()) || { skipped: 'not_due' };
  });
}

