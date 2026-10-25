// Modulo Integration M&A (Integration Plan Management) dentro la Suite TD.
// Le route dell'app di origine (routes/plan.js) lavorano sull'anagrafica unica: target = public.organizations (kind TARGET) con
// parametri in target_ext, owner e team = public.people con person_ext (docs/ANAGRAFICA.md). Il modulo parte vuoto (FRESH_MODULES).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { config } from './config.js';
import { one } from './db.js';
import { takeSnapshot } from './lib/plan.js';
import { clientCount } from './lib/events.js';
import planRoutes from './routes/plan.js';

const KEY = 'integration';

const publicUser = (u) => u && ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, status: 'ACTIVE', auth_provider: 'SUITE',
  organization: u.organization || null, must_change_password: false, suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

export default function mount(app) {
  const r = Router();
  // Profili Suite ADMIN/EDITOR/VIEWER = ruoli dell'app; OWNER e ADMIN della Suite senza grant ricevono ADMIN.
  // La riga users dell'app viene creata se manca, già attiva (le chiavi esterne updated_by/created_by restano valide).
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', insert: { status: 'ACTIVE', auth_provider: 'ENTRA', organization: 'Toscana Diagnostica' } } }));
  // L'app ragiona con il "suo" utente: la riga della tabella users dello schema del modulo, con role = profilo del grant
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });

  r.get('/state', async (req, res, next) => {
    try {
      const st = await getModuleState(KEY);
      res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
    } catch (e) { next(e); }
  });
  // Stessa forma che il front-end dell'app si aspetta da /auth/me e /auth/config
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', pending: false }));
  r.get('/auth/config', (_req, res) => res.json({ entraEnabled: false, appName: config.appName }));
  r.get('/health', (_req, res) => res.json({ ok: true, sse: clientCount() }));

  // In MIRROR le scritture sono bloccate (423): i dati arrivano dall'app di origine e verrebbero sovrascritti dalla copia successiva
  r.use(blockWritesInMirror);
  r.use(planRoutes);

  // Il gestore errori della Suite non riporta "current" (la riga aggiornata in caso di conflitto 409, usata dal motore
  // per il controllo di versione): lo gestiamo qui per il solo modulo, il resto passa al gestore generale.
  r.use((err, req, res, next) => {
    if (err && err.status === 409 && err.current) return res.status(409).json({ error: err.message, code: err.code, current: err.current });
    next(err);
  });

  app.use(`/api/${KEY}`, r);

  // Snapshot giornaliero automatico (ora di Roma), come lo scheduler dell'app: solo con modulo LIVE, una volta al giorno
  registerJob(`${KEY}:snapshot-giornaliero`, 30, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: `modulo ${st.mode}` };
    const rome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (t) => rome.find((p) => p.type === t)?.value;
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (Number(get('hour')) < config.snapshotHourRome) return { skipped: true, reason: 'prima dell\'ora prevista' };
    const done = await one(`SELECT 1 FROM snapshots WHERE kind='daily' AND (created_at AT TIME ZONE 'Europe/Rome')::date = $1::date`, [day]);
    if (done) return { skipped: true, reason: 'già eseguito oggi' };
    const s = await takeSnapshot('daily', `Snapshot automatico ${day}`, null);
    return { ok: true, snapshot: s.id, day };
  });
}
