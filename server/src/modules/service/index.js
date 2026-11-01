// Modulo Portale Service (area HQS): copia conforme del sito pubblico service.toscanadiagnostica.it dentro la Suite (richiesta del
// CEO, 01/11/2026: "inglobarlo e renderlo parte della suite, ma continuare ad aggiornare la app separata"). Una sola fonte: il sito,
// rigenerato dalla routine RSGI; la Suite ne tiene uno specchio di sola lettura (job service:specchio ogni 6 ore, "Aggiorna adesso",
// ZIP del repo come ripiego) e ne riscrive la presentazione in React. I PDF arrivano a richiesta dal sito e restano in cache.
// Nativo, senza travaso: all'avvio si attiva da solo (FRESH_MODULES) ed esegue il primo specchio. Aperto a tutti gli autenticati
// (decisione AD 13/10/2026: il sito è pubblico), clienti service compresi: ruolo implicito LETTORE; EDITOR gestisce origine,
// aggiornamento e cache; Owner e Admin della Suite sono EDITOR.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, getModuleState } from '../../lib/modules.js';
import { registerJob, runJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { montaLinkStabili } from '../../lib/specchioPortale.js';
import { one } from './db.js';
import { KEY, config } from './config.js';
import routes from './routes/service.js';
import { specchio, specchioService } from './lib/specchio.js';
import { inviaFile } from './lib/invio.js';

const OPZIONI = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'EDITOR', openToAll: true, defaultRole: 'LETTORE' } };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, OPZIONI));
  r.use(routes);
  app.use(`/api/${KEY}`, r);

  // Link stabili sotto il dominio della Suite: /service/p/<shortcut>, /service/m/<codice>, /service/doc/<codice> consegnano il PDF
  // senza redirect (come il sito di origine); prestazione sconosciuta o con più preparazioni → elenco nella pagina del modulo.
  montaLinkStabili(app, {
    key: KEY, base: `/${KEY}`, specchio: specchioService, invia: inviaFile,
    urlElenco: (c) => `/${KEY}?codice=${encodeURIComponent(c)}`, urlNonTrovato: (c) => `/${KEY}?nontrovato=${encodeURIComponent(c)}`,
  });

  // Specchio del sito ogni 6 ore (scheduler della Suite, disattivabile con DISABLE_SCHEDULER)
  registerJob(`${KEY}:specchio`, config.specchioMinuti, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non attivo' };
    return specchio();
  }, { runAtStart: true });
}

// Primo avvio: il modulo non ha travaso, si attiva da solo e, se lo specchio è vuoto, lo esegue subito in background (se l'origine
// non risponde il modulo resta "da caricare" con l'errore visibile in Impostazioni; si rimedia con lo ZIP del repo).
export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') {
    await startFresh(KEY, null);
    console.log('[service] modulo Portale Service attivato (nativo, specchio del sito pubblico)');
  }
  const pieno = await one('SELECT 1 FROM contenuti LIMIT 1');
  if (!pieno) {
    runJob(`${KEY}:specchio`).then((x) => console.log(`[service] primo specchio: ${x?.cambiato ? `caricata la pubblicazione del ${x.build}` : 'nessun cambiamento'}`))
      .catch((e) => console.warn(`[service] primo specchio non riuscito: ${e.message}. Il portale resta da caricare: Impostazioni > Aggiorna adesso oppure ZIP del repo`));
  }
}
