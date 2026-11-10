// Ordini e Magazzino · fonte Synclab (v0.67.1): produzione dalla copia Synclab del gestionale e correlazione esami → materiali dalle
// etichette osservate nei campioni (v0.68.4; prima coppie materiale/contenitore). Logica in lib/synclab.js; documentazione in docs/SYNCLAB_DATA_API.md ("Chi usa i dati") e
// docs/ORDINI_SYNCLAB.md. Solo profili Operations (come Produzione StudioLab e Correlazione).
import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { aggiornaProduzioneSynclab, statoProduzioneSynclab, aggiornaEtichette, elencoEtichette, etichettePerEsame, proponiCorrelazioni, synclabDisponibile } from '../lib/synclab.js';

const r = Router();
const ops = requireRole(...OPS_ROLES);

r.get('/production/synclab', ops, ah(async (_req, res) => res.json(await statoProduzioneSynclab())));
r.post('/production/synclab/aggiorna', ops, ah(async (req, res) => {
  const out = await aggiornaProduzioneSynclab({ userId: req.user.id });
  if (out.skipped) throw bad(out.motivo);
  await audit(req, 'PRODUCTION_SYNCLAB', 'production', null, out);
  res.json(out);
}));

// Etichette viste nel gestionale (v0.68.4: una riga per testo di etichetta, prima per coppia materiale/contenitore) e abbinamento a un articolo
r.get('/mappings/synclab/etichette', ops, ah(async (_req, res) => {
  const disp = await synclabDisponibile();
  res.json({ disponibile: disp.ok, motivo: disp.motivo || null, etichette: disp.ok ? await elencoEtichette() : [] });
}));
r.post('/mappings/synclab/etichette/aggiorna', ops, ah(async (req, res) => {
  const disp = await synclabDisponibile();
  if (!disp.ok) throw bad(disp.motivo);
  const out = await aggiornaEtichette();
  await audit(req, 'MAPPINGS_SYNCLAB_ETICHETTE', 'etichette_synclab', null, out);
  res.json(out);
}));
r.put('/mappings/synclab/etichette/:id', ops, ah(async (req, res) => {
  const b = parse(z.object({ articolo_id: z.number().int().nullable() }), req.body);
  if (b.articolo_id && !(await one('SELECT 1 FROM articles WHERE id=$1', [b.articolo_id]))) throw bad('Articolo inesistente');
  // l'abbinamento scelto a mano chiude la segnalazione della rifusione (migrazione 017)
  const row = await one('UPDATE etichette_synclab SET articolo_id=$2, nota_rifusione=NULL WHERE id=$1 RETURNING *', [Number(req.params.id), b.articolo_id]);
  if (!row) throw bad('Etichetta non trovata');
  await audit(req, 'MAPPINGS_SYNCLAB_ABBINA', 'etichette_synclab', row.id, { etichetta: row.etichetta, articolo_id: b.articolo_id });
  res.json(row);
}));
// Per la tabella delle correlazioni: etichetta più frequente di ogni esame (colonna "Dal gestionale") e descrizione dal catalogo Synclab
r.get('/mappings/synclab/esami', ops, ah(async (_req, res) => {
  const disp = await synclabDisponibile();
  res.json(disp.ok ? Object.fromEntries(await etichettePerEsame()) : {});
}));
// Proposta di correlazioni: anteprima (conferma false) e applicazione (conferma true); le MANUALE e LISTINO non si toccano
r.post('/mappings/synclab/proponi', ops, ah(async (req, res) => {
  const b = parse(z.object({ conferma: z.boolean().default(false) }), req.body || {});
  const disp = await synclabDisponibile();
  if (!disp.ok) throw bad(disp.motivo);
  const out = await proponiCorrelazioni({ conferma: b.conferma });
  if (b.conferma) await audit(req, 'MAPPINGS_SYNCLAB_PROPOSTE', 'exam_mappings', null, out.sintesi);
  res.json(out);
}));

export default r;
