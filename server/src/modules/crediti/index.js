// Modulo Recupero Crediti (chiave `crediti`, area FINANCE), v0.95.0. Richiesta del CEO del 24/11/2026: recupero crediti collegato al
// Business Hub, processo del memo "Modello di sollecito clienti B2B", comunicazioni e risposte gestite dalla casella
// amministrazione@toscanadiagnostica.it, riconciliazione dei bonifici con Enable Banking e solleciti che partono da soli alle date
// previste quando l'incasso manca; esclusione di un cliente dai solleciti decisa solo da CEO o CFO. Documentazione:
// docs/RECUPERO_CREDITI.md e docs/BANCA.md. Nativo, senza travaso: all'avvio si attiva da solo, in modalità PROVA (nulla esce).
import { Router } from 'express';
import { requireAuth, hasModule } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { ah, forbidden } from '../../lib/util.js';
import { KEY } from './config.js';
import { OPZIONI_UTENTE, contesto } from './lib/access.js';
import { impostazioni, oggiRoma, oraRoma } from './lib/impostazioni.js';
import { posizioni } from './lib/fatture.js';
import { giro } from './lib/motore.js';
import { leggiCasella } from './lib/casella.js';
import api from './routes/api.js';

export { OPZIONI_UTENTE };

export default function mount(app) {
  // Posizione creditizia di un cliente per la scheda account del Business Hub: sintesi in sola lettura per chi vede il Business Hub
  app.get(`/api/${KEY}/posizione-cliente/:orgId`, requireAuth, ah(async (req, res) => {
    if (!(hasModule(req.user, 'business') || hasModule(req.user, KEY))) throw forbidden('Modulo non assegnato');
    if ((await getModuleState(KEY)).mode !== 'LIVE') return res.json({ attivo: false });
    const orgId = Number(req.params.orgId); if (!Number.isInteger(orgId)) return res.json({ attivo: true, posizione: null });
    const imp = await impostazioni();
    const p = (await posizioni({ orgIds: [orgId], tolleranza: imp.tolleranza_promessa }))[0] || null;
    res.json({ attivo: true, apre: hasModule(req.user, KEY), posizione: p ? { totale: p.totale, scaduto: p.scaduto, fatture: p.fatture, giorni_max: p.giorni_max, stato: p.stato, fase_label: p.fase_label, escluso: p.escluso, promessa: p.promessa, ultimo_contatto: p.ultimo_contatto, contestato: p.contestato } : null });
  }));

  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, OPZIONI_UTENTE), contesto);
  r.get('/state', ah(async (req, res) => {
    const imp = await impostazioni();
    res.json({ mode: (await getModuleState(KEY)).mode, modalita: imp.modalita, casella: imp.casella, traccia_chiamata: imp.traccia_chiamata,
      user: { id: req.user.id, full_name: req.user.full_name, ruolo: req.cred.ruolo, dirige: req.cred.dirige, opera: req.cred.opera, commerciale: req.cred.commerciale, legale: req.cred.legale, tutto: req.cred.tutto } });
  }));
  r.use(blockWritesInMirror);
  r.use(api);
  app.use(`/api/${KEY}`, r);

  // Giro del motore ogni ora dalle 7 alle 20 (ora di Roma): fatture, incassi, promesse; la scala parte solo nei giorni e nelle ore di invio
  registerJob(`${KEY}:giro`, 60, async () => {
    if ((await getModuleState(KEY)).mode !== 'LIVE') return { saltato: 'modulo non attivo' };
    const h = oraRoma(); if (h < 7 || h > 20) return { saltato: 'fuori orario' };
    return giro();
  });
  // Casella amministrazione@: risposte dei clienti ogni 15 minuti
  registerJob(`${KEY}:casella`, 15, async () => {
    if ((await getModuleState(KEY)).mode !== 'LIVE') return { saltato: 'modulo non attivo' };
    return leggiCasella();
  });
}

export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') { await startFresh(KEY, null); console.log(`[crediti] modulo Recupero Crediti attivato (nativo, modalità Prova) · ${oggiRoma()}`); }
}
