// Modulo Label (chiave tecnica `etichette`, area Retail and Flow Management dopo il Business Hub), v0.69.0. Richiesta del CEO del
// 10/11/2026, "widget davvero fondamentale": dal numero di accettazione (o barcode) o dal cognome del paziente mostra in anteprima le
// etichette per provetta dell'accettazione StudioLab e le stampa sulla Zebra della sede con Zebra Browser Print (ripiego PDF).
// Fonte: copia Synclab della Suite (proiezione standard) + lettura diretta del gestionale per le accettazioni appena fatte; identità dei
// pazienti solo per gli ultimi N giorni (etichette.pazienti_recenti, job etichette:identita). Modello dell'etichetta configurabile (ZPL con
// segnaposto), avviso fisso finché nessun modello è validato dal laboratorio. Documentazione: docs/ETICHETTE.md.
// Accesso: solo con grant (non aperto a tutti). ADMIN = impostazioni, modelli, registro (Owner/Admin della Suite senza grant = ADMIN);
// OPERATORE = cerca, anteprima e stampa per le sedi del proprio perimetro (scope SITE del grant).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { config } from './config.js';
import { many } from './db.js';
import { KEY, contesto, modelloValidato, AVVISO_VALIDAZIONE, dataApiAttiva } from './lib/core.js';
import { giroIdentita } from './lib/identita.js';
import stampaRoutes from './routes/stampa.js';
import adminRoutes from './routes/admin.js';

export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, OPZIONI_UTENTE));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const ctx = contesto(req);
    const sedi = ctx.siteIds.length ? await many('SELECT id, code, name FROM public.sites WHERE id = ANY($1::int[]) ORDER BY code', [ctx.siteIds]) : [];
    const validato = await modelloValidato();
    res.json({
      mode: st.mode,
      user: { id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, role: ctx.role, isAdmin: ctx.isAdmin, site_ids: ctx.siteIds, sedi },
      browser_print: config.browserPrint,
      avviso_validazione: validato ? null : AVVISO_VALIDAZIONE,
      data_api: await dataApiAttiva(),
    });
  }));
  r.use(blockWritesInMirror);
  r.use(stampaRoutes);
  r.use(adminRoutes);
  app.use(`/api/${KEY}`, r);

  // Identità recenti: ogni 15 minuti, lavora solo tra le 6 e le 22 (ora di Roma) e con il modulo LIVE e la Data API accesa
  registerJob(`${KEY}:identita`, config.identitaMinuti, async () => giroIdentita());
}
