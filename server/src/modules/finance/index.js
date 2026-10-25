// Modulo Finance (Payments): autorizzazioni di pagamento con firma congiunta CEO/CFO, beneficiari, conti di addebito,
// moduli DOCX/PDF, link di firma via email, controllo anti-frazionamento. Travaso dell'app finance.toscanadiagnostica.it.
// Autenticazione, utenti e profili sono della Suite: il ruolo dell'app (SUPPORT, CEO, CFO, VIEWER) è il profilo del grant,
// il flag is_admin dell'app vale anche per i livelli OWNER e ADMIN della Suite.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { getModuleState, moduleUser, blockWritesInMirror } from '../../lib/modules.js';
import { HttpError } from '../../lib/util.js';
import { registerJob } from '../../lib/jobs.js';
import { config } from './config.js';
import { USER_COLS } from './lib/access.js';
import { pdfAvailable } from './lib/docgen.js';
import { runReminders } from './lib/workflow.js';
import adminRoutes from './routes/admin.js';
import requestRoutes, { filesRouter } from './routes/requests.js';
import signRoutes from './routes/sign.js';
import statsRoutes from './routes/stats.js';

const KEY = 'finance';
const PUBLIC_COLS = USER_COLS.split(',').map((s) => s.trim());

// Forma dell'utente che l'interfaccia dell'app si aspetta, più il metodo di accesso della sessione Suite (serve alla firma)
const publicUser = (u, req) => {
  const out = {};
  for (const c of PUBLIC_COLS) out[c] = u[c] ?? null;
  out.role = u.role; out.is_admin = Boolean(u.is_admin); out.active = true; out.first_name = u.first_name || null; out.last_name = u.last_name || null;
  out.suite_level = u.suite_level; out.auth_method = req.session?.authMethod || null;
  return out;
};

// Come requireModuleReady della Suite, ma con il ruolo amministrativo scelto per utente: il titolare (OWNER) senza grant entra
// come CEO (è il firmatario seed dell'app), gli ADMIN senza grant come Finance Support. Se il ruolo CEO/CFO è già occupato
// (indice users_signer_uq: un solo firmatario attivo per ruolo) si ripiega su SUPPORT, con is_admin comunque attivo.
const ready = async (req, _res, next) => {
  try {
    const st = await getModuleState(KEY);
    if (st.mode === 'OFF' || !st.schema_ready) return next(Object.assign(new HttpError(503, 'Modulo non ancora travasato nella Suite'), { code: 'MODULE_OFF' }));
    const preferred = req.user.level === 'OWNER' ? 'CEO' : 'SUPPORT';
    let mu;
    try { mu = await moduleUser(KEY, req.user, { roleColumn: 'role', extraColumns: { defaultAdminRole: preferred } }); }
    catch (e) {
      if (e.code !== '23505') throw e;
      mu = await moduleUser(KEY, req.user, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'SUPPORT' } });
    }
    const isSuiteAdmin = req.user.level === 'OWNER' || req.user.level === 'ADMIN';
    req.moduleUser = { ...mu, is_admin: Boolean(mu.is_admin) || isSuiteAdmin };
    req.moduleMode = st.mode;
    next();
  } catch (e) { next(e); }
};

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, ready);
  // l'app ragiona con il "suo" utente: la riga della sua tabella users (schema finance) con role = profilo del grant Suite
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const r = await one(`SELECT count(*) FILTER (WHERE status='IN_FIRMA')::int AS in_firma, count(*) FILTER (WHERE status='FIRMATA')::int AS da_eseguire FROM payment_requests`);
      const role = req.user.role;
      const mine = ['CEO','CFO'].includes(role) ? (await one(`SELECT count(*)::int AS n FROM payment_requests r WHERE r.status='IN_FIRMA' AND (r.tier <> 'SINGOLA' OR r.single_signer=$1) AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.request_id=r.id AND s.valid AND s.role=$1)`, [role])).n : 0;
      res.json({ in_firma: r.in_firma, da_eseguire: r.da_eseguire, da_firmare: mine });
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res, next) => {
    try {
      const st = await getModuleState(KEY);
      res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user, req), pdfEnabled: await pdfAvailable(), mailMode: config.mail.mode, signAllowLocal: config.signAllowLocal });
    } catch (e) { next(e); }
  });
  // stessa forma che l'app si aspetta da /api/auth/me: authMethod è quello della sessione Suite (ENTRA o LOCAL)
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user, req), authMethod: req.session?.authMethod || 'SUITE', onboarding: null }));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);
  r.use('/requests', requestRoutes);
  r.use(filesRouter);
  r.use('/sign', signRoutes);
  r.use('/stats', statsRoutes);
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));
  // Errori propri dell'app (duplicati, dimensione allegati) con i messaggi dell'app
  r.use((err, req, res, next) => {
    if (err.code === '23505') return res.status(409).json({ error: err.constraint === 'users_signer_uq' ? 'Esiste già un utente attivo con questo profilo di firma (CEO o CFO): un solo firmatario per ruolo' : 'Elemento duplicato', code: err.code });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File troppo grande (max ${config.maxUploadMb} MB)` });
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Troppi file in un solo caricamento (massimo 10)' });
    next(err);
  });
  app.use(`/api/${KEY}`, r);

  // Solleciti automatici ai firmatari (l'app controllava ogni 6 ore): solo con modulo LIVE, i dati in MIRROR sono una copia
  registerJob(`${KEY}:solleciti-firma`, 6 * 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    await runReminders();
    return { ok: true };
  });
}
