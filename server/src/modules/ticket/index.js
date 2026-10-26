// Modulo Ticket: richieste e segnalazioni ai responsabili delle unità dell'organigramma (caselle), con protocollo TK-AAAA/NNNN,
// SLA per priorità, cronologia completa, allegati, statistiche ed esportazioni. Nativo, si avvia vuoto (FRESH_MODULES).
// Accesso: chiunque sia autenticato nella Suite apre ticket e vede i propri, anche senza grant (ruolo implicito UTENTE);
// i profili del catalogo sono ADMIN, RESPONSABILE (responsabili di unità, cosmetico: il potere reale viene da org_positions.is_head)
// e VIEWER (consultazione di tutto, riservati esclusi).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { one } from './db.js';
import { config } from './config.js';
import { userContext, visibleSql } from './lib/access.js';
import { reindexTickets } from './lib/core.js';
import { runTicketJob } from './lib/job.js';
import ticketRoutes from './routes/tickets.js';
import adminRoutes from './routes/admin.js';
import reportRoutes from './routes/reports.js';

const KEY = 'ticket';

export default function mount(app) {
  const r = Router();
  // openToAll: nessun 403 senza grant, ruolo implicito UTENTE; Owner e Admin della Suite sono ADMIN del modulo
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', openToAll: true, defaultRole: 'UTENTE' } }));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const ctx = await userContext(req);
    const u = req.moduleUser;
    res.json({ mode: st.mode, user: { id: req.user.id, module_user_id: u.id, email: req.user.email, full_name: req.user.full_name, role: ctx.role, isAdmin: ctx.isAdmin, isViewer: ctx.isViewer, isManager: ctx.isManager, managedUnitIds: ctx.managed, person_id: req.user.person_id || null } });
  }));
  r.get('/badges', ah(async (req, res) => {
    const ctx = await userContext(req);
    const params = [ctx.uid];
    const vis = visibleSql(ctx, params);
    const x = await one(`SELECT count(*) FILTER (WHERE t.richiedente_user_id=$1 AND t.stato NOT IN ('CHIUSO','ANNULLATO'))::int AS miei,
        count(*) FILTER (WHERE t.richiedente_user_id=$1 AND t.stato='RISOLTO')::int AS da_confermare,
        count(*) FILTER (WHERE t.richiedente_user_id<>$1 AND t.stato NOT IN ('CHIUSO','ANNULLATO') AND ${vis})::int AS gestione,
        count(*) FILTER (WHERE t.stato NOT IN ('CHIUSO','ANNULLATO') AND ${vis} AND ((t.prima_risposta_at IS NULL AND t.sla_risposta_scadenza < now()) OR (t.risolto_at IS NULL AND t.stato <> 'IN_ATTESA' AND t.sla_risoluzione_scadenza < now())))::int AS sforati
      FROM tickets t`, params);
    // gestore: voce "Da gestire" visibile ai responsabili di almeno una casella, agli ADMIN e ai VIEWER
    res.json({ ...(x || {}), gestore: ctx.isManager || ctx.isAdmin || ctx.isViewer ? 1 : 0 });
  }));
  r.use(blockWritesInMirror);
  r.use(ticketRoutes);
  r.use(reportRoutes);
  r.use(adminRoutes);
  app.use(`/api/${KEY}`, r);

  // Lavori di sfondo (scheduler della Suite, disattivabile con DISABLE_SCHEDULER): SLA, escalation, chiusura automatica; indice di ricerca
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:sla`, config.jobMinutes, async () => (await live() ? runTicketJob() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: true });
  registerJob(`${KEY}:reindex`, 60, async () => (await live() ? reindexTickets() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: true });
}
