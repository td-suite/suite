// Modulo Piano Ferie (area PEOPLE): piano ferie ANNUALE per area (Direzione, Laboratorio, Sedi), funzionamento stabilito dal CEO
// (08/11/2026): "Solo l'amministratore (il CEO) vede tutto. Ogni dipendente vede solo la propria area. Il dipendente inserisce il piano
// ferie annuale. Il responsabile dell'Area (approvatore) può modificare il piano dei dipendenti dell'area e poi approvarlo e renderlo
// definito." Piano per persona e anno (BOZZA → PROPOSTO → IN_REVISIONE → APPROVATO → DEFINITIVO), trasparente a tutta l'area e solo
// all'area; variazioni dopo l'approvazione; copertura minima, chiusure collettive, saldi, cruscotto, esportazioni XLSX e PDF, job.
// Nativo, si avvia vuoto (FRESH_MODULES) da Amministrazione > Attivazione moduli. Documentazione: docs/FERIE.md.
// Accesso: aperto a tutti gli interni (open_to_all, ruolo implicito DIPENDENTE: il proprio piano e quello della propria area).
// Approva il superiore diretto dell'anagrafica (CEO, 09/11/2026: "Segui pedissequamente quanto indicato in organigramma"), che vede in
// sola lettura i livelli sotto ("La mia catena"); il vertice non ha approvazione. ADMIN = Owner/Admin della Suite e HR con il grant ADMIN
// (tutto); il grant RESPONSABILE dà solo la visibilità delle aree del suo ambito. Gli accessi esterni non lo vedono.
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
import pianiRoutes from './routes/piani.js';
import { daApprovare, idsDaApprovare } from './lib/home.js';
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
      isAdmin: ctx.isAdmin, isViewer: ctx.isViewer, isApprovatore: ctx.isApprovatore, haCatena: ctx.haCatena, inPerimetro: Boolean(ctx.me), gruppo: ctx.me?.gruppo || null,
      rolAttivi: Boolean(ctx.settings.rol_attivi), contratti: ctx.perim.contratti,
    } });
  }));
  // Contatori della barra laterale; i flag nascondono le voci a chi non le usa
  r.get('/badges', ah(async (req, res) => {
    const ctx = await userContext(req);
    const anno = Number(oggi().slice(0, 4));
    const da = ctx.isAdmin || ctx.isApprovatore ? await daApprovare(idsDaApprovare(ctx), [anno, anno + 1]) : { piani: 0, variazioni: 0 };
    const mio = ctx.me ? await one(`SELECT stato FROM piani WHERE person_id=$1 AND anno=$2`, [ctx.me.id, anno]) : null;
    const mieVar = ctx.personId ? (await one(`SELECT count(*)::int AS n FROM richieste WHERE person_id=$1 AND (stato='RICHIESTA' OR variazione_proposta IS NOT NULL)`, [ctx.personId])).n : 0;
    const assenti = (await one(`SELECT count(DISTINCT person_id)::int AS n FROM richieste WHERE stato IN ('APPROVATA','GODUTA') AND $1::date BETWEEN data_inizio AND data_fine AND person_id = ANY($2::int[])`,
      [oggi(), [...ctx.perim.persone.values()].filter((p) => ctx.vedeGruppo(p.gruppo)).map((p) => p.id)])).n;
    res.json({
      piani_da_approvare: da.piani, variazioni_da_approvare: da.variazioni, da_approvare: da.piani + da.variazioni, mie_variazioni: mieVar, assenti_oggi: assenti,
      mio_piano_bozza: mio?.stato === 'BOZZA' ? 1 : 0,
      approvatore: ctx.isAdmin || ctx.isApprovatore ? 1 : 0, cruscotto: ctx.tutto || ctx.isApprovatore || ctx.haCatena ? 1 : 0, dipendente: ctx.me ? 1 : 0,
      area: ctx.me || ctx.isApprovatore || ctx.tutto || ctx.gruppi.length ? 1 : 0, catena: ctx.tutto || ctx.haCatena ? 1 : 0,
    });
  }));
  r.use(blockWritesInMirror);
  r.use(pianiRoutes);
  r.use(richiesteRoutes);
  r.use(pianoRoutes);
  r.use(hrRoutes);
  r.use(adminRoutes);
  app.use(`/api/${KEY}`, r);

  // Job giornaliero (scheduler della Suite, DISABLE_SCHEDULER lo ferma): GODUTA a data passata, promemoria dei piani non inviati
  // entro la scadenza, dei piani e delle variazioni in attesa del responsabile
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:promemoria`, config.jobMinutes, async () => (await live() ? eseguiJob() : { skipped: true, reason: 'modulo non LIVE' }));
}
