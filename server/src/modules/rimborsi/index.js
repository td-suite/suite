// Modulo Rimborso Spese (chiave `rimborsi`, area PEOPLE), v0.72.0. Richiesta del CEO del 13/11/2026: widget "Rimborso Spese" nell'area
// HR accessibile SOLO ai dipendenti e a nessun altro; approvazione secondo l'organigramma; compilazione mensile, archiviazione, invio al
// responsabile e sua approvazione; nella stessa scheda Rimborso Spese (TD-SGI-MOD025) e Rimborso Chilometrico (TD-SGI-MOD029); vetture
// aziendali e fuel card da Contratti del personale; foto dello scontrino obbligatoria salvo le eccezioni. Documentazione: docs/RIMBORSI.md.
// Accesso (regola SOLO_DIPENDENTI di routes/core.js): solo utenti interni collegati a una persona di tipo DIPENDENTE in stato ATTIVO o
// IMPEGNO; nessun grant, ruoli calcolati (lib/core.js). Nativo, senza travaso: all'avvio si attiva da solo e carica il seme delle
// eccezioni al giustificativo.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { ah } from '../../lib/util.js';
import { HttpError } from '../../lib/util.js';
import { KEY, config, MODULI_CARTACEI, RIF_PROCEDURA } from './config.js';
import { soloDipendenti, userContext } from './lib/core.js';
import { badges } from './lib/home.js';
import { caricaSemeEccezioni } from './lib/eccezioni.js';
import { eseguiJob } from './lib/job.js';
import { TESTO_GIUSTIFICATIVO } from './lib/scheda.js';
import noteRoutes from './routes/note.js';
import allegatiRoutes from './routes/allegati.js';
import flussoRoutes from './routes/flusso.js';
import elenchiRoutes from './routes/elenchi.js';
import adminRoutes, { moduliCartacei } from './routes/admin.js';

// ruolo tecnico unico: i ruoli veri (responsabile, P&C, titolare) si calcolano dall'organigramma e dai grant di Contratti del personale
export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'DIPENDENTE', openToAll: true, defaultRole: 'DIPENDENTE' } };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, soloDipendenti, requireModuleReady(KEY, OPZIONI_UTENTE));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const ctx = await userContext(req);
    res.json({
      mode: st.mode,
      user: { id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, person_id: ctx.personId, role: 'DIPENDENTE',
        isPC: ctx.isPC, isTitolare: ctx.isTitolare, isResponsabile: ctx.isResponsabile, tutto: ctx.tutto, inPerimetro: Boolean(ctx.me),
        approvatore: ctx.me ? { nome: ctx.me.approvatore_nome, al_pc: ctx.me.al_pc, origine: ctx.me.origine } : null },
      giorno_limite: ctx.settings.giorno_limite, testo_giustificativo: TESTO_GIUSTIFICATIVO,
      moduli_cartacei: await moduliCartacei(), rif_procedura: RIF_PROCEDURA, max_file_mb: Math.round(config.maxFileBytes / 1048576),
    });
  }));
  r.get('/badges', ah(async (req, res) => res.json(await badges(await userContext(req)))));
  r.use(blockWritesInMirror);
  r.use(noteRoutes);
  r.use(allegatiRoutes);
  r.use(flussoRoutes);
  r.use(elenchiRoutes);
  r.use(adminRoutes);
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));
  app.use(`/api/${KEY}`, r);

  // Promemoria: ogni ora (il job decide da solo cosa inviare, al massimo una volta al giorno per destinatario), solo con modulo LIVE
  registerJob(`${KEY}:promemoria`, config.jobMinutes, () => eseguiJob());
}

// Primo avvio e ogni rilascio: attivazione (nativo, schema vuoto) e seme delle eccezioni al giustificativo (solo voci non abbinate)
export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') {
    await startFresh(KEY, null);
    console.log('[rimborsi] modulo Rimborso Spese attivato (nativo)');
  }
  const out = await caricaSemeEccezioni();
  if (out.abbinate || out.non_abbinate) console.log(`[rimborsi] seme delle eccezioni: ${out.abbinate} abbinate, ${out.non_abbinate} da abbinare (Diagnostica D58)`);
}

export { MODULI_CARTACEI };
