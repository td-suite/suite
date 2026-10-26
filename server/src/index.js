// Suite TD · server (Express). Intranet e Operating Suite di Toscana Diagnostica
import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { loadUser, requireAuth } from './lib/access.js';
import { HttpError } from './lib/util.js';
import { startScheduler, listJobs } from './lib/jobs.js';
import { loadSecrets } from './lib/secrets.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import coreRoutes from './routes/core.js';
import ssoRoutes from './routes/sso.js';
import communityRoutes from './routes/community.js';
import filesRoutes from './routes/files.js';
import searchRoutes from './routes/search.js';
import ingestRoutes from './routes/ingest.js';
import legacyRoutes from './routes/legacy.js';
import travasoRoutes from './routes/travaso.js';
import importRoutes from './routes/importxlsx.js';
import orgcatRoutes from './routes/orgcat.js';
import { mountModules, mountModulesPublic } from './modules/index.js';
import { activeModuleKeys } from './lib/modules.js';
import { applyModuleMigrations } from './lib/travaso.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Dominio canonico: suite.toscanadiagnostica.it. Altri host → redirect permanente (tranne health e API macchina)
const canonicalHost = (() => { try { const u = new URL(config.baseUrl); return /localhost|127\.0\.0\.1/.test(u.hostname) ? null : u.host; } catch { return null; } })();
// Redirect al dominio canonico SOLO per le navigazioni di pagina (GET che accettano HTML) e solo se il dominio canonico è lo stesso
// servizio (host *.onrender.com o il dominio custom già attivo). Mai le chiamate API: un redirect delle API spegnerebbe l'app
// se BASE_URL puntasse a un dominio non ancora raggiungibile. Con CANONICAL_REDIRECT=false si disattiva del tutto.
if (canonicalHost && process.env.CANONICAL_REDIRECT !== 'false') {
  app.use((req, res, next) => {
    if (req.hostname === canonicalHost || req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    if (!/text\/html/.test(req.get('accept') || '')) return next();
    res.redirect(302, `https://${canonicalHost}${req.originalUrl}`);
  });
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.blob.core.windows.net', 'https://server.arcgisonline.com', 'https://*.arcgisonline.com', 'https://tile.openstreetmap.org'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'self'", 'blob:'],
      formAction: ["'self'", 'https://login.microsoftonline.com', 'https://*.toscanadiagnostica.it'],
      manifestSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Canali macchina (API di ingestione, chiave API) prima di sessione e CSRF
app.use('/api/ingest', express.json({ limit: '60mb' }), ingestRoutes);
await mountModulesPublic(app);   // canali macchina dei moduli (StudioLAB, Silva, HL7)

app.use(express.json({ limit: '30mb' }));   // le planimetrie PDF di Room viaggiano in base64 nel PUT della sede

const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
  name: 'suite.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: config.sessionHours * 3600 * 1000 },
}));

// CSRF: le richieste che modificano dati devono arrivare dal client della Suite (header custom)
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'td-suite') return next(new HttpError(403, 'Richiesta non valida'));
  next();
});

app.use(loadUser);
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, app: config.appName, version: process.env.APP_VERSION || '0.1.0', entra: config.entra.enabled, blob: config.blob.enabled, ai: config.anthropic.enabled, mail: config.mail.provider, jobs: listJobs().length }); }
  catch { res.status(503).json({ ok: false }); }
});
app.use('/api/auth', authRoutes);
app.use('/api/public', communityRoutes.public || ((_req, _res, next) => next()));   // vetrine pubbliche (blog, preparazioni) senza login

// Lancio moduli legacy: GET navigabile, deve passare per la sessione
app.use('/api', requireAuth);
app.use('/api', ssoRoutes);
app.use('/api', usersRoutes);
app.use('/api', coreRoutes);
app.use('/api', communityRoutes);
app.use('/api', filesRoutes);
app.use('/api', searchRoutes);
app.use('/api', legacyRoutes);
app.use('/api', travasoRoutes);
app.use('/api', importRoutes);
app.use('/api', orgcatRoutes);
await mountModules(app);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

// Scorciatoia navigabile: /go/<modulo>. Modulo già travasato (MIRROR/LIVE) → pagina del modulo dentro la Suite;
// altrimenti SSO verso l'app originale (richiede sessione; altrimenti login e ritorno)
app.get('/go/:module', async (req, res, next) => {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  try {
    const active = await activeModuleKeys();
    if (active.has(req.params.module)) return res.redirect(`/${req.params.module}${typeof req.query.path === 'string' ? req.query.path.replace(/^\/?/, '/') : ''}`);
  } catch (e) { return next(e); }
  const path_ = typeof req.query.path === 'string' ? `?path=${encodeURIComponent(req.query.path)}` : '';
  res.redirect(`/api/sso/launch/${encodeURIComponent(req.params.module)}${path_}`);
});

// Frontend (build Vite)
const webDir = process.env.WEB_DIR || path.join(__dirname, '..', 'public');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && err.code !== 'MODULE_OFF') console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (err.code === '23505') return res.status(409).json({ error: 'Elemento duplicato' });
  res.status(status).json({ error: status >= 500 ? 'Errore interno del server' : err.message, code: err.code, details: err.details, current: err.current });
});

async function start() {
  const deadline = Date.now() + 150_000;
  for (let attempt = 1; ; attempt++) {
    try { await pool.query('SELECT 1'); break; }
    catch (e) {
      if (Date.now() > deadline) throw new Error(`Database non raggiungibile: ${e.message}`);
      console.log(`[avvio] database non ancora pronto (tentativo ${attempt}). Riprovo tra 5 s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await migrate();
  await applyModuleMigrations();   // migrazioni nuove dei moduli già travasati o avviati (schema_ready)
  await loadSecrets();
  await import('./jobs/register.js').catch((e) => console.warn('[jobs] registro non caricato:', e.message));
  app.listen(config.port, () => console.log(`${config.appName} in ascolto su :${config.port} · Entra ${config.entra.enabled ? 'attivo' : 'non configurato'} · Blob ${config.blob.enabled ? 'attivo' : 'non configurato'} · AI ${config.anthropic.enabled ? 'attiva' : 'non configurata'} · mail ${config.mail.provider}`));
  if (!config.disableScheduler) startScheduler();
}
start().catch((e) => { console.error(e); process.exit(1); });
