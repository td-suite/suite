// Cockpit direzionale · Monitor (CEO, 08/11/2026: pagina da monitor fisso, aggiornata ogni 5 minuti). Accesso: titolare, amministratori e
// chi ha il modulo Cockpit (stessa regola dello scadenzario). Logica e fonti in lib/cockpitMonitor.js; elenco in docs/COCKPIT.md "Monitor".
import { Router } from 'express';
import { ah, forbidden } from '../lib/util.js';
import { puoVedere } from '../lib/scadenzario.js';
import { monitorPerUtente } from '../lib/cockpitMonitor.js';

const r = Router();

// GET /api/cockpit/monitor[?fresco=1]: un solo JSON { generato_at, scadenze, indicatori, gruppi }, in cache 60 secondi per tutti i monitor
r.get('/cockpit/monitor', ah(async (req, res) => {
  if (!puoVedere(req.user)) throw forbidden('Il Cockpit è riservato alla direzione');
  res.setHeader('Cache-Control', 'no-store');
  res.json(await monitorPerUtente(req.user, { fresco: req.query.fresco === '1' }));
}));

export default r;
