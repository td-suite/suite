// Modulo Cash Management (rendiconti di cassa, flusso contante, royalty, SEPA): montaggio dentro la Suite TD.
// Le route sono quelle dell'app di origine, montate sotto /api/cash con gli stessi prefissi; autenticazione, utenti,
// profili e sedi sono della Suite (anagrafica unica, docs/ANAGRAFICA.md). Fuori dal modulo restano login, Entra, TOTP, gestione
// utenti e l'import da Excel di sedi e utenti (le sedi si creano in Amministrazione > Sedi).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState, moduleDb } from '../../lib/modules.js';
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
import monthlyRoutes from './routes/monthly.js';
import siteRoyaltyRoutes from './routes/siteRoyalty.js';

const KEY = 'cash';
const db = moduleDb(KEY);
const ROLES = ['SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR', 'PARTNER'];

// Utente come lo vede il front-end dell'app (stessa forma di /api/auth/me dell'app di origine)
const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, company_id: u.company_id, company_name: u.company_name, company_code: u.company_code,
  cash_float: u.cash_float, site_ids: u.site_ids || [], active: true, auth_provider: 'SUITE', must_change_password: false, totp_enabled: true,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level, person_id: u.person_id || null,
});

// Ruolo del modulo per l'utente Suite: profilo del grant, oppure SUPERADMIN per OWNER/ADMIN della Suite senza grant
function roleFor(suiteUser) {
  const g = suiteUser.grants?.[KEY];
  if (g?.profile && ROLES.includes(g.profile)) return g.profile;
  return suiteUser.level === 'OWNER' || suiteUser.level === 'ADMIN' ? 'SUPERADMIN' : null;
}

// Azienda Cash per un utente Suite: la sua organizzazione o quella dello scope ORG del grant (se società o gruppo),
// altrimenti l'azienda Cash (site_ext) della prima sede dello scope SITE, altrimenti la capofila (is_franchisor) o la prima società.
async function resolveCompanyId(suiteUser) {
  const g = suiteUser.grants?.[KEY];
  const orgIds = [suiteUser.organization_id, ...(g?.scopes || []).filter((s) => s.type === 'ORG').map((s) => Number(s.id))].filter(Boolean);
  if (orgIds.length) {
    const c = await db.one('SELECT id FROM companies_v WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id) LIMIT 1', [orgIds]);
    if (c) return c.id;
  }
  const siteIds = (g?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id));
  if (siteIds.length) {
    const s = await db.one('SELECT company_id FROM site_ext WHERE site_id = ANY($1::int[]) ORDER BY site_id LIMIT 1', [siteIds]);
    if (s) return s.company_id;
  }
  const c = await db.one('SELECT id FROM companies_v WHERE is_franchisor ORDER BY id LIMIT 1') || await db.one('SELECT id FROM companies_v WHERE active ORDER BY id LIMIT 1');
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
    const row = await db.one('SELECT id, role, company_id, suite_user_id FROM users WHERE lower(email)=lower($1)', [req.user.email]);
    if (role !== 'SUPERADMIN' && (!row || row.company_id == null)) {
      const cid = await resolveCompanyId(req.user);
      if (!cid) throw new HttpError(503, 'Nessuna società o gruppo nell\'anagrafica della Suite: creala in Amministrazione > Organizzazioni');
      if (row) await db.q('UPDATE users SET company_id=$2, suite_user_id=coalesce(suite_user_id, $3), updated_at=now() WHERE id=$1', [row.id, cid, req.user.id]);
      else await db.q(`INSERT INTO users (email, full_name, role, company_id, suite_user_id, auth_provider, must_change_password) VALUES ($1,$2,$3,$4,$5,'ENTRA',FALSE)`, [req.user.email, req.user.full_name || req.user.email, role, cid, req.user.id]);
    } else if (!row) {
      await db.q(`INSERT INTO users (email, full_name, role, company_id, suite_user_id, auth_provider, must_change_password) VALUES ($1,$2,'SUPERADMIN',NULL,$3,'ENTRA',FALSE)`, [req.user.email, req.user.full_name || req.user.email, req.user.id]);
    } else if (row.suite_user_id == null) {
      await db.q('UPDATE users SET suite_user_id=$2, updated_at=now() WHERE id=$1', [row.id, req.user.id]);
    }
    next();
  } catch (e) { next(e); }
}

// L'app ragiona con il "suo" utente: riga users del modulo + ruolo = profilo Suite + azienda + perimetro sedi.
// Il perimetro (site_ids) sono gli id di public.sites negli scope SITE del grant Suite (anagrafica unica, docs/ANAGRAFICA.md):
// le assegnazioni user_sites dell'app non esistono più.
async function buildAppUser(req, _res, next) {
  try {
    req.suiteUser = req.user;
    const mu = req.moduleUser;
    const company = mu.company_id ? await db.one('SELECT name AS company_name, code AS company_code FROM companies_v WHERE id=$1', [mu.company_id]) : null;
    const siteIds = [...new Set((mu.site_ids || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    // Fondo cassa personale dell'operatore: campo operativo di Cash per persona (user_ext, agganciato all'utente Suite)
    const ext = await db.one('SELECT cash_float FROM user_ext WHERE user_id=$1', [mu.suite_user_id]);
    req.user = { ...mu, ...(company || {}), site_ids: siteIds, cash_float: ext?.cash_float ?? null, active: true };
    next();
  } catch (e) { next(e); }
}

// Passo del travaso dedicato al modulo (non più usato: Cash parte vuoto, FRESH_MODULES in lib/travaso.js). Riempiva site_ext con le
// impostazioni Cash delle sedi dell'app di origine, tradotte in id di public.sites tramite legacy_refs->>'cash'. Le sedi
// dell'origine senza corrispondenza nell'anagrafica unica vengono scartate e contate (vanno riconciliate in Amministrazione).
const EXT_COLS = ['company_id', 'cash_float', 'operating_days', 'pos_terminals', 'start_date', 'ownership', 'hours', 'hours_note', 'expected_registers',
  'site_email', 'host_name', 'host_vat', 'host_email', 'royalty_fixed_monthly', 'royalty_pct', 'royalty_base', 'royalty_vat_rate', 'royalty_notes', 'created_at', 'updated_at'];
export async function afterTravaso(client, key, { legacyQuery, legacyMap, stats }) {
  const map = await legacyMap('sites');
  const src = await legacyQuery('SELECT * FROM public.sites ORDER BY id');
  await client.query('DELETE FROM site_ext');
  let n = 0, scartate = 0;
  for (const s of src) {
    const siteId = map.get(String(s.id));
    if (siteId == null) { scartate++; continue; }
    const vals = EXT_COLS.map((c) => (c === 'hours' ? JSON.stringify(s.hours ?? {}) : s[c] ?? null));
    await client.query(`INSERT INTO site_ext (site_id, ${EXT_COLS.join(', ')}) VALUES ($1, ${EXT_COLS.map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (site_id) DO UPDATE SET ${EXT_COLS.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}`, [siteId, ...vals]);
    n++;
  }
  stats.site_ext = n;
  if (scartate) { stats.__scartate = stats.__scartate || {}; stats.__scartate.site_ext = scartate; }
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
  r.use(adminRoutes);                         // aziende (public.organizations + org_ext), conti, sedi (public.sites + site_ext), users (sola lettura), settings, audit
  r.use('/reports', reportRoutes);
  r.use('/nc', ncRoutes);
  r.use('/stats', statsRoutes);
  r.use('/imports', importRoutes);
  r.use('/canoni', siteRoyaltyRoutes);
  r.use('/deposits', depositRoutes);
  r.use('/comms', commsRoutes);
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
