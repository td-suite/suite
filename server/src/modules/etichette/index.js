// Modulo Lab Control (v0.71.0, già Label: chiave tecnica `etichette` e route /etichette invariate). Richieste del CEO del 12/11/2026: il
// widget diventa il controllo del laboratorio sulle accettazioni StudioLab (cruscotto, elenco con le fasi fino al referto e alla chiusura,
// scheda con esami, campioni, Etichetta e Fattura, campioni in viaggio, ritardi, tempi di refertazione, esami non eseguiti, clienti, tutto
// collegato a Business Hub, Retail, Ordini e NC: routes/lab.js, lib/lab.js, lib/scheda.js, lib/collegamenti.js, docs/LAB_CONTROL.md) e
// "Label" diventa una sua sezione con il menu di prima. Nuovo profilo LABORATORIO (tutte le accettazioni, senza Impostazioni).
// Sezione Label (v0.69.0, area Retail and Flow Management dopo il Business Hub). Richiesta del CEO del
// 10/11/2026, "widget davvero fondamentale": dal numero di accettazione (o barcode) o dal cognome del paziente mostra in anteprima le
// etichette per provetta dell'accettazione StudioLab e le stampa sulla Zebra della sede con Zebra Browser Print (ripiego PDF).
// Fonte: copia Synclab della Suite (proiezione standard) + lettura diretta del gestionale per le accettazioni appena fatte; identità dei
// pazienti solo per gli ultimi N giorni (etichette.pazienti_recenti, job etichette:identita). Modello dell'etichetta configurabile (ZPL con
// segnaposto), avviso fisso finché nessun modello è validato dal laboratorio. Documentazione: docs/LAB_CONTROL.md (sezione Label).
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
import labRoutes from './routes/lab.js';

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
      user: { id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, role: ctx.role, isAdmin: ctx.isAdmin, isLab: ctx.isLab, tutte: ctx.tutte, site_ids: ctx.siteIds, sedi },
      browser_print: config.browserPrint,
      avviso_validazione: validato ? null : AVVISO_VALIDAZIONE,
      data_api: await dataApiAttiva(),
    });
  }));
  r.use(blockWritesInMirror);
  r.use(labRoutes);
  r.use(stampaRoutes);
  r.use(adminRoutes);
  app.use(`/api/${KEY}`, r);

  // Identità recenti: ogni 15 minuti, lavora solo tra le 6 e le 22 (ora di Roma) e con il modulo LIVE e la Data API accesa
  registerJob(`${KEY}:identita`, config.identitaMinuti, async () => giroIdentita());
}
