// Ordini e Magazzino · fonte Synclab (v0.67.1): produzione dalla copia Synclab del gestionale e correlazione esami → materiali dai
// contenitori osservati nei campioni. Logica in lib/synclab.js; documentazione in docs/SYNCLAB_DATA_API.md ("Chi usa i dati") e
// docs/ORDINI_SYNCLAB.md. Solo profili Operations (come Produzione StudioLab e Correlazione).
import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { aggiornaProduzioneSynclab, statoProduzioneSynclab, aggiornaContenitori, elencoContenitori, coppiePerEsame, proponiCorrelazioni, synclabDisponibile } from '../lib/synclab.js';

const r = Router();
const ops = requireRole(...OPS_ROLES);

r.get('/production/synclab', ops, ah(async (_req, res) => res.json(await statoProduzioneSynclab())));
r.post('/production/synclab/aggiorna', ops, ah(async (req, res) => {
  const out = await aggiornaProduzioneSynclab({ userId: req.user.id });
  if (out.skipped) throw bad(out.motivo);
  await audit(req, 'PRODUCTION_SYNCLAB', 'production', null, out);
  res.json(out);
}));

// Contenitori visti nel gestionale (coppie materiale/contenitore) e abbinamento a un articolo
r.get('/mappings/synclab/contenitori', ops, ah(async (_req, res) => {
  const disp = await synclabDisponibile();
  res.json({ disponibile: disp.ok, motivo: disp.motivo || null, contenitori: disp.ok ? await elencoContenitori() : [] });
}));
r.post('/mappings/synclab/contenitori/aggiorna', ops, ah(async (req, res) => {
  const disp = await synclabDisponibile();
  if (!disp.ok) throw bad(disp.motivo);
  const out = await aggiornaContenitori();
  await audit(req, 'MAPPINGS_SYNCLAB_CONTENITORI', 'contenitori_synclab', null, out);
  res.json(out);
}));
r.put('/mappings/synclab/contenitori/:id', ops, ah(async (req, res) => {
  const b = parse(z.object({ articolo_id: z.number().int().nullable() }), req.body);
  if (b.articolo_id && !(await one('SELECT 1 FROM articles WHERE id=$1', [b.articolo_id]))) throw bad('Articolo inesistente');
  const row = await one('UPDATE contenitori_synclab SET articolo_id=$2 WHERE id=$1 RETURNING *', [Number(req.params.id), b.articolo_id]);
  if (!row) throw bad('Coppia non trovata');
  await audit(req, 'MAPPINGS_SYNCLAB_ABBINA', 'contenitori_synclab', row.id, { material: row.material, container: row.container, articolo_id: b.articolo_id });
  res.json(row);
}));
// Per la tabella delle correlazioni: coppia più frequente di ogni esame (colonna "Dal gestionale") e descrizione dal catalogo Synclab
r.get('/mappings/synclab/esami', ops, ah(async (_req, res) => {
  const disp = await synclabDisponibile();
  res.json(disp.ok ? Object.fromEntries(await coppiePerEsame()) : {});
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
