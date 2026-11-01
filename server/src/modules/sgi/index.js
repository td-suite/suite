// Modulo Portale SGI (area HQS, widget "SGI Management"): copia conforme del sito pubblico sgi.toscanadiagnostica.it dentro la Suite
// (richiesta del CEO, 01/11/2026: "Vorrei fare poi la stessa cosa con SGI! Perfettamente!", sul modello del Portale Service). Una sola
// fonte: il sito, rigenerato dalla routine RSGI (build\aggiorna_portale.bat → git push → Render); la Suite ne tiene uno specchio di sola
// lettura (job sgi:specchio ogni 6 ore, "Aggiorna adesso", ZIP del repo come ripiego) e ne riscrive la presentazione in React. I PDF
// arrivano a richiesta dal sito e restano in cache. Se il sito è protetto da password (SGI_PASSWORD su Render) la Suite usa le
// credenziali delle Impostazioni o di SGI_PORTAL_USER/SGI_PORTAL_PASSWORD.
// Nativo, senza travaso: all'avvio si attiva da solo (FRESH_MODULES) ed esegue il primo specchio. Aperto a tutti gli autenticati
// (decisione AD 01/10/2026: il SGI è pubblico), clienti service compresi: ruolo implicito LETTORE; EDITOR gestisce origine, credenziali,
// aggiornamento e cache; Owner e Admin della Suite sono EDITOR.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, getModuleState } from '../../lib/modules.js';
import { registerJob, runJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { montaLinkStabili } from '../../lib/specchioPortale.js';
import { one } from './db.js';
import { KEY, config } from './config.js';
import routes from './routes/sgi.js';
import { specchio, specchioSgi } from './lib/specchio.js';
import { inviaFile } from './lib/invio.js';

const OPZIONI = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'EDITOR', openToAll: true, defaultRole: 'LETTORE' } };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, OPZIONI));
  r.use(routes);
  app.use(`/api/${KEY}`, r);

  // Link stabili sotto il dominio della Suite: /sgi/doc/<codice>, /sgi/m/<codice>, /sgi/p/<shortcut> consegnano il PDF senza redirect
  // (come il sito); prestazione sconosciuta o con più preparazioni → pagina Preparazioni; documento inesistente → cruscotto con avviso.
  montaLinkStabili(app, {
    key: KEY, base: `/${KEY}`, specchio: specchioSgi, invia: inviaFile,
    urlElenco: (c) => `/${KEY}/preparazioni?codice=${encodeURIComponent(c)}`, urlNonTrovato: (c) => `/${KEY}?nontrovato=${encodeURIComponent(c)}`,
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
    console.log('[sgi] modulo Portale SGI attivato (nativo, specchio del sito pubblico)');
  }
  const pieno = await one('SELECT 1 FROM contenuti LIMIT 1');
  if (!pieno) {
    runJob(`${KEY}:specchio`).then((x) => console.log(`[sgi] primo specchio: ${x?.cambiato ? `caricata la pubblicazione del ${x.build}` : 'nessun cambiamento'}`))
      .catch((e) => console.warn(`[sgi] primo specchio non riuscito: ${e.message}. Il portale resta da caricare: Impostazioni > Aggiorna adesso oppure ZIP del repo`));
  }
}
