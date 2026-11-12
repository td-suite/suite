// Modulo Guida GIPO (chiave tecnica `gipoguida`, area Retail and Flow Management dopo Label), v0.70.0. Richiesta del CEO del 12/11/2026,
// "widget davvero fondamentale": il personale in difficoltà con GipoNext (il gestionale ambulatoriale GIPO di Docplanner) interroga la
// Suite. Il widget contiene la guida completa (anche in PDF), le FAQ, una ricerca full text collegata alla guida e le domande con risposta
// (Claude risponde solo sui brani della guida, se configurato). La guida si aggiorna di continuo così: ogni domanda si registra, quelle
// senza risposta soddisfacente vanno nella coda della redazione e la risposta dell'amministratore diventa una FAQ. Non si legge nulla di
// ciò che gli utenti fanno dentro GIPO (sito di terzi con dati dei pazienti). Documentazione: docs/GIPO_GUIDA.md.
// Accesso: aperto a tutti gli INTERNI (openToAll, ruolo implicito LETTORE); gli accessi esterni no (soloInterni). ADMIN = redazione
// (Owner/Admin della Suite senza grant = ADMIN). Nativo, senza travaso: all'avvio si attiva da solo e carica il seme dei contenuti.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { ah } from '../../lib/util.js';
import { KEY, config } from './config.js';
import { contesto, soloInterni, contaCoda, riepilogoSettimanale } from './lib/core.js';
import { caricaSeme } from './lib/seme.js';
import { invalidaPdf } from './lib/pdf.js';
import guidaRoutes from './routes/guida.js';
import redazioneRoutes from './routes/redazione.js';

export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', openToAll: true, defaultRole: 'LETTORE' } };
export const AVVISO_DATI = 'Non scrivere nomi o dati di pazienti: le domande vengono registrate e lette dalla redazione.';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, soloInterni, requireModuleReady(KEY, OPZIONI_UTENTE));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const ctx = contesto(req);
    const { aiEnabled } = await import('../../lib/claude.js');
    res.json({
      mode: st.mode,
      user: { id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, role: ctx.role, isAdmin: ctx.isAdmin },
      ai: aiEnabled(), avviso_dati: AVVISO_DATI, gipo_base: config.gipoBase, domande_orarie: config.domandeOrarie,
      coda: ctx.isAdmin ? await contaCoda() : undefined,
    });
  }));
  r.use(guidaRoutes);
  r.use(redazioneRoutes);
  app.use(`/api/${KEY}`, r);

  // Riepilogo settimanale agli amministratori della guida (il lunedì dalle 8): il job gira ogni ora e decide da solo se è il momento
  registerJob(`${KEY}:riepilogo`, 60, () => riepilogoSettimanale());
}

// Primo avvio e ogni rilascio: attivazione (nativo, schema vuoto) e caricamento del seme dei contenuti (solo le voci non toccate a mano)
export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') {
    await startFresh(KEY, null);
    console.log('[gipoguida] modulo Guida GIPO attivato (nativo)');
  }
  const out = await caricaSeme();
  invalidaPdf();
  if (!out.saltato) console.log(`[gipoguida] seme caricato: sezioni ${out.sezioni.nuove} nuove, ${out.sezioni.aggiornate} aggiornate, ${out.sezioni.protette.length} protette; FAQ ${out.faq.nuove} nuove, ${out.faq.aggiornate} aggiornate, ${out.faq.protette.length} protette`);
}
