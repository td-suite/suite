// Sviluppo rete (richiesta del CEO del 17/11/2026, docs/RETAIL_SVILUPPO_RETE.md): posizionamento rispetto ai concorrenti, valutazione
// di un indirizzo (resa, B2B, rete) e comuni della Toscana dove aprire. Lettura per tutti i profili del modulo; scelte, prezzi e
// rilevazioni per ADMIN e RETAIL; impostazioni e scansione a mano solo ADMIN.
import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireRole, requireWrite } from '../lib/access.js';
import { posizionamento, impostaSchedaGoogle, valutazione, doveAprire, rilevaComune, scansioneComuni, impostazioniRete, salvaImpostazioniRete } from '../lib/rete.js';

const r = Router();
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('Identificativo non valido'); return n; };

// ---- 1. Posizionamento
r.get('/rete/posizionamento', ah(async (_req, res) => res.json({ sedi: await posizionamento() })));
r.put('/rete/sedi/:id/scheda-google', requireWrite, ah(async (req, res) => {
  const b = parse(z.object({ place_id: z.string().trim().max(300).nullable() }), req.body);
  const out = await impostaSchedaGoogle(id(req.params.id), b.place_id || null, req.user.id);
  await audit(req, 'RETE_SCHEDA_GOOGLE', 'site', id(req.params.id), { scelta: out?.nome || null });
  res.json({ ok: true, scheda: out });
}));
const prezzoSchema = z.object({
  site_id: z.number().int().positive(), place_id: z.string().trim().max(300).nullable().optional(), concorrente: z.string().trim().min(2).max(200), prestazione: z.string().trim().min(2).max(200),
  prezzo: z.number().min(0).max(100000), prezzo_td: z.number().min(0).max(100000).nullable().optional(), rilevato_il: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fonte: z.string().trim().max(200).nullable().optional(), nota: z.string().trim().max(500).nullable().optional(),
});
r.post('/rete/prezzi', requireWrite, ah(async (req, res) => {
  const b = parse(prezzoSchema, req.body);
  const riga = await one(`INSERT INTO rete_prezzi (site_id, place_id, concorrente, prestazione, prezzo, prezzo_td, rilevato_il, fonte, nota, creato_da) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.site_id, b.place_id || null, b.concorrente, b.prestazione, b.prezzo, b.prezzo_td ?? null, b.rilevato_il, b.fonte || null, b.nota || null, req.user.id]);
  await audit(req, 'RETE_PREZZO_NUOVO', 'rete_prezzo', riga.id, { concorrente: b.concorrente, prestazione: b.prestazione, prezzo: b.prezzo });
  res.status(201).json(riga);
}));
r.delete('/rete/prezzi/:id', requireWrite, ah(async (req, res) => {
  const riga = await one('DELETE FROM rete_prezzi WHERE id=$1 RETURNING id, concorrente, prestazione', [id(req.params.id)]);
  if (!riga) throw notFound('Prezzo non trovato');
  await audit(req, 'RETE_PREZZO_ELIMINATO', 'rete_prezzo', riga.id, { concorrente: riga.concorrente, prestazione: riga.prestazione });
  res.json({ ok: true });
}));

// ---- 2. Valutazione di un indirizzo (o di una sede): resa dalle sedi simili, clienti B2B e prospect vicini, sede TD più vicina
r.get('/rete/valutazioni/:id', ah(async (req, res) => res.json(await valutazione(id(req.params.id)))));

// ---- 3. Dove aprire
r.get('/rete/comuni', ah(async (_req, res) => res.json(await doveAprire())));
r.post('/rete/comuni/:istat/rileva', requireWrite, ah(async (req, res) => {
  if (!/^\d{6}$/.test(req.params.istat)) throw bad('Codice ISTAT non valido');
  const out = await rilevaComune(req.params.istat, { userId: req.user.id });
  await audit(req, 'RETE_COMUNE_RILEVA', 'rete_comune', null, { comune: out.nome, luoghi: out.luoghi, n_chiamate: out.n_chiamate, prova: out.prova });
  res.status(201).json(out);
}));
r.put('/rete/comuni/:istat', requireWrite, ah(async (req, res) => {
  const b = parse(z.object({ escluso: z.boolean().optional(), nota: z.string().trim().max(500).nullable().optional(), popolazione: z.number().int().min(0).max(5000000).optional(),
    popolazione_anno: z.number().int().min(2000).max(2100).optional(), over65: z.number().int().min(0).max(5000000).nullable().optional() }), req.body);
  const sets = []; const par = [req.params.istat];
  for (const [k, v] of Object.entries(b)) { par.push(v); sets.push(`${k}=$${par.length}`); }
  if (!sets.length) throw bad('Nessun dato da salvare');
  const riga = await one(`UPDATE rete_comuni SET ${sets.join(', ')}, updated_at=now() WHERE istat=$1 RETURNING istat, nome, escluso, nota, popolazione, popolazione_anno, over65`, par);
  if (!riga) throw notFound('Comune non trovato');
  await audit(req, 'RETE_COMUNE_MODIFICA', 'rete_comune', null, { comune: riga.nome, ...b });
  res.json(riga);
}));
r.get('/rete/impostazioni', ah(async (_req, res) => res.json(await impostazioniRete())));
r.put('/rete/impostazioni', requireRole('ADMIN'), ah(async (req, res) => {
  const b = parse(z.object({ soglia_abitanti: z.number().int().min(0).max(500000).optional(), comuni_per_notte: z.number().int().min(0).max(100).optional(),
    giorni_ricontrollo: z.number().int().min(30).max(1095).optional(), scansione_attiva: z.boolean().optional() }), req.body);
  const out = await salvaImpostazioniRete(b);
  await audit(req, 'RETE_IMPOSTAZIONI', 'rete', null, b);
  res.json(out);
}));
r.post('/rete/comuni/scansione', requireRole('ADMIN'), ah(async (req, res) => {
  const out = await scansioneComuni({ limite: Math.min(30, Math.max(1, Number(req.body?.limite) || 5)) });
  await audit(req, 'RETE_SCANSIONE', 'rete', null, { rilevati: out.rilevati?.length || 0, errori: out.errori?.length || 0, fermata: Boolean(out.fermata_dal_tetto) });
  res.json(out);
}));

export default r;
