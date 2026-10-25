// Modulo Non conformità (nc.toscanadiagnostica.it) travasato nella Suite: NC preanalitiche in cinque fasi, desk accettazioni,
// sedi invianti (clienti StudioLAB), dialogo via email con le sedi, canali macchina StudioLAB (push, HL7), SLA, SSE.
// Autenticazione, utenti e profili sono della Suite; il codice dell'app lavora con la "sua" riga users nello schema nc
// (req.moduleUser) con role = profilo del grant e sedi = id di public.sites negli scope del grant (anagrafica unica: le sedi
// invianti sono quelle di Amministrazione, con le impostazioni NC in nc.site_ext).
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { config } from './config.js';
import { q } from './db.js';
import { ah, parse } from './lib/util.js';
import { sseHandler } from './lib/events.js';
import { runSlaCheck } from './lib/nc.js';
import inboundRoutes from './routes/inbound.js';
import sediRoutes from './routes/sedi.js';
import accRoutes from './routes/accettazioni.js';
import ncRoutes from './routes/nc.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';

const KEY = 'nc';

// Stessa forma dell'utente che il front-end dell'app si aspetta da /auth/me
export const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, status: 'ACTIVE', auth_provider: u.auth_provider || 'ENTRA',
  organization: u.organization, telefono: u.telefono, must_change_password: false, notify_email: u.notify_email !== false,
  sedi: u.sedi || [], suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

// I canali macchina di StudioLAB (POST /api/nc/lis/push e POST /api/nc/hl7, segreto condiviso LIS_PUSH_SECRET) restano
// raggiungibili senza sessione e senza header anti-CSRF: la Suite li monta prima della sessione tramite mountPublic.
// Canali macchina (StudioLAB): montati dalla Suite prima di sessione e CSRF
export function mountPublic(app) { app.use(`/api/${KEY}`, inboundRoutes); }

export default function mount(app) {

  const r = Router();
  // Gli utenti Suite che entrano per la prima volta nascono ACTIVE nella tabella users del modulo (l'app li filtra così per le notifiche)
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', insert: { status: 'ACTIVE', auth_provider: 'ENTRA' } } }));
  // L'app ragiona con il suo utente: la riga users dello schema nc, con il ruolo = profilo del grant Suite e sedi = scope del grant (public.sites)
  r.use(ah(async (req, _res, next) => {
    req.suiteUser = req.user;
    let u = req.moduleUser;
    // Lo stato dell'account lo decide la Suite: chi arriva qui è attivo anche per le notifiche dell'app
    if (u.status !== 'ACTIVE') { await q(`UPDATE users SET status='ACTIVE', updated_at=now() WHERE id=$1`, [u.id]); u = { ...u, status: 'ACTIVE' }; }
    // Perimetro: id delle sedi dell'anagrafica unica (public.sites) negli scope SITE del grant Suite (anagrafica unica, docs/ANAGRAFICA.md)
    const sedi = [...new Set((u.site_ids || []).map(Number).filter(Number.isFinite))];
    req.user = { ...u, sedi };
    next();
  }));
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const r = await one(`SELECT count(*) FILTER (WHERE stato='INVIATA_SEDE' AND sla_due_at < now())::int AS oltre_sla, count(*) FILTER (WHERE stato='CHIUSA' AND (rca_richiesta OR EXISTS (SELECT 1 FROM nc_azioni z WHERE z.nc_id=nc.id)))::int AS da_verificare FROM nc`);
      res.json(r);
    } catch (e) { next(e); }
  });
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
  }));
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', pending: false }));
  r.get('/auth/config', (_req, res) => res.json({ entraEnabled: false, appName: config.appName, lisEnabled: config.lis.enabled, mailProvider: config.mail.provider }));
  r.get('/events', sseHandler);
  r.use(blockWritesInMirror);
  // Preferenze personali dell'app (notifiche email, telefono di reperibilità): restano nella riga users del modulo
  r.put('/auth/me/preferences', ah(async (req, res) => {
    const b = parse(z.object({ notify_email: z.boolean().optional(), telefono: z.string().max(40).optional() }), req.body);
    await q('UPDATE users SET notify_email=coalesce($2,notify_email), telefono=coalesce($3,telefono), updated_at=now() WHERE id=$1', [req.user.id, b.notify_email ?? null, b.telefono ?? null]);
    res.json({ ok: true });
  }));
  r.use(sediRoutes);
  r.use(accRoutes);
  r.use(ncRoutes);
  r.use(statsRoutes);
  r.use(adminRoutes);   // tipi, settings, email, lis/status, audit, scheduler/run
  app.use(`/api/${KEY}`, r);

  // Scheduler dell'app (solleciti SLA, escalation, coda email): solo con modulo LIVE
  registerJob(`${KEY}:sla`, Math.max(1, config.schedulerMinutes), async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    return runSlaCheck();
  });
}
