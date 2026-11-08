// Modulo Piano Ferie (area PEOPLE): ferie annuali dei dipendenti con piano per Area (Direzione, Laboratorio, Sedi), richieste e
// approvazioni dall'organigramma, copertura minima per giorno, chiusure collettive, cruscotto HR, esportazioni XLSX e PDF.
// Decisione del CEO (08/11/2026): "widget dedicato per le ferie annuali; solo dipendenti; piano ferie per Area". Nativo, si avvia
// vuoto (FRESH_MODULES) da Amministrazione > Travaso moduli. Documentazione: docs/FERIE.md.
// Accesso: aperto a tutti gli interni (open_to_all, ruolo implicito DIPENDENTE: le proprie ferie e il piano della propria area);
// RESPONSABILE approva la propria area o sede; ADMIN = HR (tutto); VIEWER consultazione. Gli accessi esterni non lo vedono.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { one } from './db.js';
import { config } from './config.js';
import { userContext, soloInterni, oggi } from './lib/core.js';
import { eseguiJob } from './lib/job.js';
import richiesteRoutes from './routes/richieste.js';
import pianoRoutes from './routes/piano.js';
import hrRoutes from './routes/hr.js';
import adminRoutes from './routes/admin.js';

const KEY = 'ferie';
export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', openToAll: true, defaultRole: 'DIPENDENTE' } };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, soloInterni, requireModuleReady(KEY, OPZIONI_UTENTE));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const ctx = await userContext(req);
    res.json({ mode: st.mode, user: {
      id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, person_id: ctx.personId, role: ctx.role,
      isAdmin: ctx.isAdmin, isViewer: ctx.isViewer, isApprovatore: ctx.isApprovatore, inPerimetro: Boolean(ctx.me), gruppo: ctx.me?.gruppo || null,
      rolAttivi: Boolean(ctx.settings.rol_attivi), contratti: ctx.perim.contratti,
    } });
  }));
  // Contatori della barra laterale; i flag nascondono le voci "Da approvare" e "Cruscotto HR" a chi non le usa
  r.get('/badges', ah(async (req, res) => {
    const ctx = await userContext(req);
    const ids = ctx.isAdmin ? null : [...ctx.approva];
    const da = ctx.isAdmin ? (await one(`SELECT count(*)::int AS n FROM richieste WHERE stato='RICHIESTA'`)).n
      : ids.length ? (await one(`SELECT count(*)::int AS n FROM richieste WHERE stato='RICHIESTA' AND person_id = ANY($1::int[])`, [ids])).n : 0;
    const mie = ctx.personId ? (await one(`SELECT count(*)::int AS n FROM richieste WHERE stato='RICHIESTA' AND person_id=$1`, [ctx.personId])).n : 0;
    const assenti = (await one(`SELECT count(DISTINCT person_id)::int AS n FROM richieste WHERE stato IN ('APPROVATA','GODUTA') AND $1::date BETWEEN data_inizio AND data_fine AND person_id = ANY($2::int[])`,
      [oggi(), [...ctx.perim.persone.values()].filter((p) => ctx.vedeGruppo(p.gruppo)).map((p) => p.id)])).n;
    res.json({ da_approvare: da, mie_in_attesa: mie, assenti_oggi: assenti, approvatore: ctx.isAdmin || ctx.isApprovatore ? 1 : 0, cruscotto: ctx.tutto || ctx.isApprovatore ? 1 : 0, dipendente: ctx.me ? 1 : 0 });
  }));
  r.use(blockWritesInMirror);
  r.use(richiesteRoutes);
  r.use(pianoRoutes);
  r.use(hrRoutes);
  r.use(adminRoutes);
  app.use(`/api/${KEY}`, r);

  // Job giornaliero (scheduler della Suite, DISABLE_SCHEDULER lo ferma): GODUTA a data passata e promemoria agli approvatori
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:promemoria`, config.jobMinutes, async () => (await live() ? eseguiJob() : { skipped: true, reason: 'modulo non LIVE' }));
}
