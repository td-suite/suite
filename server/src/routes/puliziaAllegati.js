// Amministrazione > Pulizia allegati: ricerca per nome e contenuto negli allegati di Business Hub, Room Planning e sedi, ed eliminazione
// definitiva dei file scelti. SOLO il titolare della Suite; l'eliminazione chiede la parola ELIMINA e scrive l'audit con nome e origine
// di ogni file (mai il contenuto).
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireOwner } from '../lib/access.js';
import * as P from '../lib/puliziaAllegati.js';

const r = Router();
r.use('/admin/pulizia-allegati', requireOwner);

const vista = (s) => (s ? { id: s.id, in_corso: s.in_corso, termini: s.termini, contenuto: s.contenuto, avviata_at: s.avviata_at, finita_at: s.finita_at, totale: s.totale, letti: s.letti,
  errore: s.errore, righe: s.righe, non_analizzati: s.non_analizzati } : null);

r.get('/admin/pulizia-allegati', ah(async (_req, res) => {
  res.json({ termini_default: P.TERMINI_DEFAULT, sorgenti: (await P.sorgentiAttive()).map((s) => ({ key: s.key, modulo: s.modulo, tipo: s.tipo })), scansione: vista(P.stato()) });
}));

r.post('/admin/pulizia-allegati/scansione', ah(async (req, res) => {
  const b = parse(z.object({ termini: z.array(z.string().max(60)).max(10).optional(), contenuto: z.boolean().optional() }), req.body || {});
  const s = P.avvia({ termini: b.termini, contenuto: b.contenuto !== false, by: req.user.id });
  await audit(req, 'PULIZIA_ALLEGATI_SCANSIONE', { entity: 'allegati', label: `Ricerca negli allegati: ${s.termini.join(', ')}`, data: { termini: s.termini, contenuto: s.contenuto } });
  res.status(202).json({ scansione: vista(s) });
}));

r.post('/admin/pulizia-allegati/elimina', ah(async (req, res) => {
  const b = parse(z.object({ conferma: z.string(), voci: z.array(z.object({ sorgente: z.string(), id: z.number().int().positive() })).min(1).max(500) }), req.body || {});
  if (b.conferma !== 'ELIMINA') throw bad('Per eliminare scrivi ELIMINA');
  const fatte = await P.elimina(b.voci);
  await audit(req, 'PULIZIA_ALLEGATI_ELIMINATI', { entity: 'allegati', label: `Eliminati ${fatte.length} allegati (pulizia per termini)`, data: { termini: P.stato()?.termini || null, eliminati: fatte } });
  res.json({ eliminati: fatte, richiesti: b.voci.length });
}));

export default r;
