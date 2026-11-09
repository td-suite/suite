// Silva (Guida tecnica API ordini v1, 09/11/2026): destinazioni, proposta di abbinamento delle strutture, stato dell'integrazione e
// attivazione della trasmissione automatica dopo il primo invio concordato. Montate sotto /api/orders/silva (sessione della Suite).
import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { getConnector, saveConnector } from '../../../lib/connectors.js';
import { destinazioniSilva, destinazioniSalvate, proponiDestinazione, statoIntegrazioneSilva, connettorePubblico, aggiornaStatiSilva } from '../lib/silva.js';

const r = Router();
r.use(requireRole(...OPS_ROLES));

r.get('/stato', ah(async (_req, res) => res.json(await statoIntegrazioneSilva())));

// Destinazioni autorizzate: dalla cache di 10 minuti; ?refresh=1 rilegge da Silva ("Aggiorna destinazioni")
r.get('/destinazioni', ah(async (req, res) => {
  if (req.query.refresh === '1' || req.query.refresh === 'true') return res.json(await destinazioniSilva({ force: true }));
  try { return res.json(await destinazioniSilva()); }
  catch (e) {
    // Silva non raggiungibile o connettore spento: l'ultima lettura riuscita, con l'errore
    const salvate = await destinazioniSalvate();
    if (!salvate) throw e;
    return res.json({ ...salvate, errore: e.message, da_cache: true });
  }
}));

// Strutture attive con la destinazione scelta e la proposta automatica (CAP, città, indirizzo, nome) da confermare
r.get('/strutture', ah(async (_req, res) => {
  const elenco = await destinazioniSalvate();
  const destinazioni = elenco?.destinazioni || [];
  const perCodice = new Map(destinazioni.map((d) => [d.codice, d]));
  const strutture = await many(`SELECT id, origin, code, name, address, zip, city, province, silva_code, kind, site_kind, org_kind FROM strutture_v WHERE active AND NOT delivery_point ORDER BY origin DESC, name`);
  const usati = new Set(strutture.map((s) => s.silva_code).filter(Boolean));
  res.json({
    destinazioni, letto_al: elenco?.letto_al || null,
    strutture: strutture.map((s) => {
      const scelta = s.silva_code ? perCodice.get(String(s.silva_code)) || null : null;
      const valido = s.silva_code ? /^[1-9][0-9]*$/.test(String(s.silva_code)) : false;
      // la proposta solo per chi non ha una destinazione valida, tra le destinazioni non ancora usate
      const proposta = !scelta ? proponiDestinazione(s, destinazioni.filter((d) => !usati.has(d.codice))) : null;
      return { ...s, destinazione: scelta, codice_valido: valido, autorizzata: Boolean(scelta), proposta };
    }),
  });
}));

// Attivazione (o sospensione) della trasmissione automatica all'approvazione: dopo il primo invio concordato con Silva
r.post('/automatismo', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ attiva: z.boolean() }), req.body);
  const c = await getConnector('SILVA');
  if (d.attiva && !c.settings?.primo_invio_at) throw bad('Prima serve un invio concordato riuscito (201) con "Trasmetti a Silva (invio concordato)"');
  const settings = d.attiva ? { primo_invio_confermato: true, primo_invio_confermato_at: new Date().toISOString(), push_orders: true } : { primo_invio_confermato: false, primo_invio_confermato_at: null };
  const nuovo = await saveConnector('SILVA', { settings }, req.suiteUser?.id || null);
  await audit(req, 'SILVA_AUTOMATISMO', 'connector', null, { attiva: d.attiva });
  res.json(connettorePubblico(nuovo));
}));

// Controllo degli stati su richiesta (stesso lavoro del job orders:silva-stato)
r.post('/stato/aggiorna', ah(async (req, res) => {
  const out = await aggiornaStatiSilva();
  await audit(req, 'SILVA_STATO_JOB', 'order', null, { controllati: out.controllati ?? 0, interrotto: out.interrotto || null, skipped: out.skipped || null });
  res.json(out);
}));

export default r;
