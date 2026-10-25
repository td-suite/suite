import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse } from '../lib/util.js';
import { canEdit, canSeeStruttura } from '../lib/access.js';

const r = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional();
// sede: id di public.sites (il client la manda come stringa dal selettore)
const siteRef = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive().nullable().optional());
const schema = z.object({
  kind: z.enum(['ASSENZA', 'CHIUSURA', 'SESSIONE_EXTRA']),
  persona_key: z.string().max(200).nullable().optional(),
  persona_nome: z.string().max(200).nullable().optional(),
  sede_id: siteRef,
  persona_id: z.string().max(40).nullable().optional(),
  dal: date, al: date,
  sost_persona_id: z.string().max(40).nullable().optional(),
  sost_nome: z.string().max(200).nullable().optional(),
  room_id: z.string().max(40).nullable().optional(),
  ora_da: hhmm, ora_a: hhmm,
  nota: z.string().max(1000).nullable().optional(),
}).refine((d) => d.al >= d.dal, { message: 'la data di fine precede quella di inizio' })
  .refine((d) => d.kind !== 'CHIUSURA' || d.sede_id, { message: 'la chiusura richiede la sede' })
  .refine((d) => d.kind !== 'ASSENZA' || d.persona_key, { message: "l'assenza richiede la persona" })
  .refine((d) => d.kind !== 'SESSIONE_EXTRA' || (d.sede_id && d.persona_key && d.room_id && d.ora_da && d.ora_a), { message: 'la sessione extra richiede sede, persona, ambulatorio e orario' });

// Eventi in un intervallo (default: da oggi -30 a +120 giorni)
r.get('/eventi', ah(async (req, res) => {
  const dal = req.query.dal || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const al = req.query.al || new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const rows = await many(`SELECT e.*, u.full_name AS created_by_name FROM eventi e LEFT JOIN users u ON u.id=e.created_by WHERE e.al >= $1 AND e.dal <= $2 ORDER BY e.dal, e.id`, [dal, al]);
  res.json(rows.filter((e) => !e.sede_id || canSeeStruttura(req.user, e.sede_id)));
}));

r.post('/eventi', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Profilo in sola consultazione');
  const d = parse(schema, req.body);
  if (d.sede_id && !canSeeStruttura(req.user, d.sede_id)) throw forbidden('Sede non autorizzata');
  const row = await one(`INSERT INTO eventi (kind, persona_key, persona_nome, sede_id, persona_id, dal, al, sost_persona_id, sost_nome, room_id, ora_da, ora_a, nota, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
  [d.kind, d.persona_key || null, d.persona_nome || null, d.sede_id || null, d.persona_id || null, d.dal, d.al, d.sost_persona_id || null, d.sost_nome || null, d.room_id || null, d.ora_da || null, d.ora_a || null, d.nota || null, req.user.id]);
  await audit(req, 'EVENTO_CREATE', 'evento', row.id, { kind: d.kind, persona: d.persona_nome, sede: d.sede_id, dal: d.dal, al: d.al });
  res.status(201).json(row);
}));

r.put('/eventi/:id', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Profilo in sola consultazione');
  const id = Number(req.params.id);
  if (!await one('SELECT 1 FROM eventi WHERE id=$1', [id])) throw notFound();
  const d = parse(schema, req.body);
  const row = await one(`UPDATE eventi SET kind=$2, persona_key=$3, persona_nome=$4, sede_id=$5, persona_id=$6, dal=$7, al=$8, sost_persona_id=$9, sost_nome=$10, room_id=$11, ora_da=$12, ora_a=$13, nota=$14 WHERE id=$1 RETURNING *`,
    [id, d.kind, d.persona_key || null, d.persona_nome || null, d.sede_id || null, d.persona_id || null, d.dal, d.al, d.sost_persona_id || null, d.sost_nome || null, d.room_id || null, d.ora_da || null, d.ora_a || null, d.nota || null]);
  await audit(req, 'EVENTO_UPDATE', 'evento', id, { kind: d.kind, dal: d.dal, al: d.al });
  res.json(row);
}));

r.delete('/eventi/:id', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Profilo in sola consultazione');
  const id = Number(req.params.id);
  const e = await one('DELETE FROM eventi WHERE id=$1 RETURNING kind, persona_nome, dal, al', [id]);
  if (!e) throw notFound();
  await audit(req, 'EVENTO_DELETE', 'evento', id, e);
  res.json({ ok: true });
}));

export default r;
