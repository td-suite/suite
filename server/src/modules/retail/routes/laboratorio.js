// Retail · B2C · "Laboratorio in sede" (riordino di Retail, 09/11/2026): accettazioni Synclab dei client abbinati a sedi TD (punti prelievo e
// centri), per sede e mese, esami più richiesti, confronto con lo stesso periodo dell'anno prima. Esiste solo con l'impostazione
// `synclab_privati_in_b2c` a true (predefinita); a false tutto Synclab è B2B e la pagina lo dice. Letture: lib/synclab/letture.js.
// Visibilità: tutti i profili del modulo (dati aggregati, nessun paziente).
import { Router } from 'express';
import { ah } from '../lib/util.js';
import { privatiInB2c } from '../lib/b2b.js';
import { laboratorioInSede, periodoProfilo, statoCopia, statiErogati, fonteProduzione, aggiornatoAlle, descriviStati } from '../../../lib/synclab/letture.js';

const r = Router();
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

r.get('/', ah(async (req, res) => {
  const privati = await privatiInB2c();
  const p = periodoProfilo({ periodo: req.query.periodo || '12m', da: req.query.da || null, a: req.query.a || null, oggi: oggiRoma() });
  const siteId = req.query.site_id === 'ND' ? 'ND' : req.query.site_id ? Number(req.query.site_id) : null;
  const d = await laboratorioInSede({ da: p.da, a: p.a, privatiInB2c: privati, siteId });
  const stato = await statoCopia(); const stati = await statiErogati(); const cp = stato?.insiemi?.requests?.checkpoint_at || null;
  // v0.68.5: accettazioni, esami e valore sono quelli EROGATI (definizione unica di letture.js)
  res.json({ ...d, periodo_richiesto: p, privati_in_b2c: privati, fonte: 'StudioLab (Synclab Data API, copia locale in sola lettura)', stato,
    stati, stati_descritti: descriviStati(stati), fonte_produzione: fonteProduzione(stati, cp), aggiornato: aggiornatoAlle(cp, oggiRoma()) });
}));

export default r;
