// Modulo Cash Management (rendiconti di cassa, flusso contante, royalty, SEPA): montaggio dentro la Suite TD.
// Le route sono quelle dell'app di origine, montate sotto /api/cash con gli stessi prefissi; autenticazione, utenti,
// profili e sedi sono della Suite. Fuori dal modulo restano login, Entra, TOTP, gestione utenti e import utenti da Excel.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState, moduleDb } from '../../lib/modules.js';
import { many as suiteMany } from '../../db.js';
import { registerJob } from '../../lib/jobs.js';
import { HttpError } from './lib/util.js';
import { partnerGuard } from './lib/access.js';
import { runDailyCheck, runClosingAlerts } from './lib/alerts.js';
import adminRoutes from './routes/admin.js';
import reportRoutes from './routes/reports.js';
import ncRoutes from './routes/nc.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/imports.js';
import royaltyRoutes from './routes/royalty.js';
import depositRoutes from './routes/deposits.js';
import commsRoutes from './routes/comms.js';
import anagraficaImportRoutes from './routes/anagraficaImport.js';
import monthlyRoutes from './routes/monthly.js';
import siteRoyaltyRoutes from './routes/siteRoyalty.js';

const KEY = 'cash';
const db = moduleDb(KEY);
const ROLES = ['SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR', 'PARTNER'];

// Utente come lo vede il front-end dell'app (stessa forma di /api/auth/me dell'app di origine)
const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, role: u.role, company_id: u.company_id, company_name: u.company_name, company_code: u.company_code,
  cash_float: u.cash_float, site_ids: u.site_ids || [], active: true, auth_provider: 'SUITE', must_change_password: false, totp_enabled: true,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level, legacy_site_ids: u.legacy_site_ids || [],
});

// Ruolo del modulo per l'utente Suite: profilo del grant, oppure SUPERADMIN per OWNER/ADMIN della Suite senza grant
function roleFor(suiteUser) {
  const g = suiteUser.grants?.[KEY];
  if (g?.profile && ROLES.includes(g.profile)) return g.profile;
  return suiteUser.level === 'OWNER' || suiteUser.level === 'ADMIN' ? 'SUPERADMIN' : null;
}

// Azienda dell'app per un utente Suite: organizzazione dell'utente o dello scope ORG del grant (legacy_refs.cash),
// altrimenti l'azienda della prima sede dello scope SITE, altrimenti la capofila (is_franchisor) o la prima azienda.
async function resolveCompanyId(suiteUser) {
  const g = suiteUser.grants?.[KEY];
  const orgIds = [suiteUser.organization_id, ...(g?.scopes || []).filter((s) => s.type === 'ORG').map((s) => Number(s.id))].filter(Boolean);
  if (orgIds.length) {
    const refs = await suiteMany(`SELECT legacy_refs->>$2 AS ref FROM public.organizations WHERE id = ANY($1::int[]) AND legacy_refs ? $2`, [orgIds, KEY]);
    for (const r of refs) {
      const c = await db.one('SELECT id FROM companies WHERE id=$1', [Number(r.ref)]);
      if (c) return c.id;
    }
  }
  const siteIds = (g?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id));
  if (siteIds.length) {
    const refs = await suiteMany(`SELECT legacy_refs->>$2 AS ref FROM public.sites WHERE id = ANY($1::int[]) AND legacy_refs ? $2`, [siteIds, KEY]);
    for (const r of refs) {
      const s = await db.one('SELECT company_id FROM sites WHERE id=$1', [Number(r.ref)]);
      if (s) return s.company_id;
    }
  }
  const c = await db.one('SELECT id FROM companies WHERE is_franchisor ORDER BY id LIMIT 1') || await db.one('SELECT id FROM companies ORDER BY id LIMIT 1');
  return c?.id || null;
}

// La tabella users dell'app impone (role='SUPERADMIN') OR (company_id IS NOT NULL): prima che moduleUser crei o aggiorni la riga
// dell'utente Suite, qui si garantisce un company_id valido per i profili diversi da SUPERADMIN.
async function ensureCashUser(req, _res, next) {
  try {
    const st = await getModuleState(KEY);
    if (st.mode === 'OFF' || !st.schema_ready) return next();   // ci pensa requireModuleReady a rispondere 503
    const role = roleFor(req.user);
    if (!role) return next();                                   // nessun grant: requireModuleReady risponde 403
    const row = await db.one('SELECT id, role, company_id FROM users WHERE lower(email)=lower($1)', [req.user.email]);
    if (role !== 'SUPERADMIN' && (!row || row.company_id == null)) {
      const cid = await resolveCompanyId(req.user);
      if (!cid) throw new HttpError(503, 'Nessuna azienda censita nel modulo Cash: esegui il travaso o crea l\'azienda');
      if (row) await db.q('UPDATE users SET company_id=$2, updated_at=now() WHERE id=$1', [row.id, cid]);
      else await db.q(`INSERT INTO users (email, full_name, role, company_id, auth_provider, must_change_password) VALUES ($1,$2,$3,$4,'ENTRA',FALSE)`, [req.user.email, req.user.full_name || req.user.email, role, cid]);
    } else if (!row) {
      await db.q(`INSERT INTO users (email, full_name, role, company_id, auth_provider, must_change_password) VALUES ($1,$2,'SUPERADMIN',NULL,'ENTRA',FALSE)`, [req.user.email, req.user.full_name || req.user.email]);
    }
    next();
  } catch (e) { next(e); }
}

// L'app ragiona con il "suo" utente: riga users del modulo + ruolo = profilo Suite + azienda + perimetro sedi.
// Il perimetro viene dagli scope SITE del grant Suite (legacy_site_ids); se vuoto, dalle assegnazioni user_sites dell'app.
// Le assegnazioni user_sites vengono allineate agli scope Suite, così le query dell'app che le leggono (operatori di sede,
// comunicazioni agli operatori, conteggio utenti per sede) restano coerenti.
async function buildAppUser(req, _res, next) {
  try {
    req.suiteUser = req.user;
    const mu = req.moduleUser;
    const company = mu.company_id ? await db.one('SELECT name AS company_name, code AS company_code FROM companies WHERE id=$1', [mu.company_id]) : null;
    const assigned = (await db.many('SELECT site_id FROM user_sites WHERE user_id=$1 ORDER BY site_id', [mu.id])).map((x) => x.site_id);
    let siteIds = assigned;
    const legacy = (mu.legacy_site_ids || []).map(Number).filter(Number.isFinite);
    if (legacy.length) {
      const sorted = [...legacy].sort((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(assigned)) {
        await db.tx(async (c) => {
          await c.query('DELETE FROM user_sites WHERE user_id=$1', [mu.id]);
          for (const s of sorted) await c.query('INSERT INTO user_sites (user_id, site_id) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM sites WHERE id=$2) ON CONFLICT DO NOTHING', [mu.id, s]);
        });
      }
      siteIds = sorted;
    }
    req.user = { ...mu, ...(company || {}), site_ids: siteIds, active: true };
    next();
  } catch (e) { next(e); }
}

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, ensureCashUser, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'SUPERADMIN' } }), buildAppUser);
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const r = await one(`SELECT count(*)::int AS n FROM cash_reports WHERE status='CLOSED'`);
      res.json({ revisione: r.n });
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res) => {
    const st = await getModuleState(KEY);
    res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', onboarding: null }));
  r.use(blockWritesInMirror);
  r.use(partnerGuard);
  r.use(adminRoutes);                         // companies, bank-accounts, sites, users (sola lettura), settings, audit
  r.use('/reports', reportRoutes);
  r.use('/nc', ncRoutes);
  r.use('/stats', statsRoutes);
  r.use('/imports', importRoutes);
  r.use('/canoni', siteRoyaltyRoutes);
  r.use('/deposits', depositRoutes);
  r.use('/comms', commsRoutes);
  r.use('/anagrafica', anagraficaImportRoutes);
  r.use('/controllo-mensile', monthlyRoutes);
  r.use('/royalty', royaltyRoutes);
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));
  app.use(`/api/${KEY}`, r);

  // Controllo giornaliero automatico (riepilogo del mattino agli amministratori, solleciti alle sedi 60 minuti dopo la chiusura):
  // nell'app girava ogni 5 minuti; qui è un lavoro della Suite e gira solo con modulo LIVE (in MIRROR i dati arrivano dall'app).
  registerJob(`${KEY}:controllo-giornaliero`, 5, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: 'not_live' };
    const morning = await runDailyCheck();
    const closing = await runClosingAlerts();
    return { morning: morning ? { date: morning.date, missing: morning.missing, sent: morning.results.length } : null, closing: closing ? { date: closing.date, sent: (closing.results || []).filter((x) => x.status !== 'DUPLICATA').length } : null };
  });
}
