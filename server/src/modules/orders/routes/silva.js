// Silva (Guida tecnica API ordini v1, 09/11/2026): destinazioni, proposta di abbinamento delle strutture, stato dell'integrazione e
// attivazione della trasmissione automatica dopo il primo invio concordato. Montate sotto /api/orders/silva (sessione della Suite).
import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { getConnector, saveConnector } from '../../../lib/connectors.js';
import { destinazioniSilva, destinazioniSalvate, statoIntegrazioneSilva, connettorePubblico, aggiornaStatiSilva, abbinaAutomaticamente, elencoUnitaSilva, classificaUnita } from '../lib/silva.js';

const r = Router();
r.use(requireRole(...OPS_ROLES));

r.get('/stato', ah(async (_req, res) => res.json(await statoIntegrazioneSilva())));

// Destinazioni autorizzate: dalla cache di 10 minuti; ?refresh=1 rilegge da Silva ("Aggiorna destinazioni") e abbina in automatico le
// unità con una sola destinazione coincidente e libera (v0.68.3)
r.get('/destinazioni', ah(async (req, res) => {
  if (req.query.refresh === '1' || req.query.refresh === 'true') {
    const d = await destinazioniSilva({ force: true });
    const a = await abbinaAutomaticamente({ actor: req.user?.full_name || 'Aggiorna destinazioni' });
    if (a.abbinate.length) await audit(req, 'SILVA_ABBINAMENTO_AUTO', 'struttura', null, { abbinate: a.abbinate.length, unita: a.abbinate.map((x) => `${x.label} → ${x.codice}`) });
    return res.json({ ...d, abbinate_auto: a.abbinate });
  }
  try { return res.json(await destinazioniSilva()); }
  catch (e) {
    // Silva non raggiungibile o connettore spento: l'ultima lettura riuscita, con l'errore
    const salvate = await destinazioniSalvate();
    if (!salvate) throw e;
    return res.json({ ...salvate, errore: e.message, da_cache: true });
  }
}));

// Unità da abbinare (v0.68.3: sedi TD, Legal entity cliente senza punti service, ogni punto service delle Legal entity cliente) con la
// destinazione scelta, il modo (automatico o manuale), le candidate plausibili e lo stato: ABBINATA, NON_AUTORIZZATA, DA_SCEGLIERE,
// NON_IN_SILVA. In più le destinazioni Silva non abbinate a nessuna unità ("presenti in Silva, non in anagrafica").
r.get('/strutture', ah(async (_req, res) => {
  const elenco = await destinazioniSalvate();
  const destinazioni = elenco?.destinazioni || [];
  const { unita, usati } = await elencoUnitaSilva();
  const cl = classificaUnita(unita, destinazioni, usati);
  const conta = (st) => cl.unita.filter((u) => u.stato === st).length;
  const ultimo = await many(`SELECT value FROM app_settings WHERE key='silva_ultimo_abbinamento'`);
  res.json({
    destinazioni, letto_al: elenco?.letto_al || null,
    strutture: cl.unita, non_in_anagrafica: cl.non_in_anagrafica,
    conteggi: { abbinate: conta('ABBINATA'), automatiche: cl.unita.filter((u) => u.stato === 'ABBINATA' && u.silva_match === 'AUTO').length, da_scegliere: conta('DA_SCEGLIERE') + conta('NON_AUTORIZZATA'), non_in_silva: conta('NON_IN_SILVA'), non_in_anagrafica: cl.non_in_anagrafica.length },
    ultimo_abbinamento: ultimo[0]?.value ? JSON.parse(ultimo[0].value) : null,
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
