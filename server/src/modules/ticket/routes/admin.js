// Amministrazione del modulo Ticket (profilo ADMIN): categorie, SLA, impostazioni, esecuzione manuale del job.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad } from '../../../lib/util.js';
import { KEY, PRIORITA, settings, setSetting } from '../lib/core.js';
import { runTicketJob } from '../lib/job.js';

const r = Router();
const admin = (req, _res, next) => (req.moduleUser?.role === 'ADMIN' ? next() : next(forbidden('Operazione riservata all\'amministratore del modulo')));

const catSchema = z.object({
  nome: z.string().trim().min(2).max(120), descrizione: z.string().trim().max(600).optional().default(''), unit_id: z.coerce.number().int().optional().nullable(),
  priorita_default: z.enum(PRIORITA).optional().default('P3'), riservata: z.boolean().optional().default(false), attiva: z.boolean().optional().default(true), sort_order: z.coerce.number().int().optional().default(100),
});
const CAT_COLS = `c.*, u.name AS unit_nome, org_unit_path(u.id) AS unit_path, (SELECT count(*)::int FROM tickets t WHERE t.categoria_id=c.id) AS n_tickets`;

r.get('/categorie', ah(async (_req, res) => res.json(await many(`SELECT ${CAT_COLS} FROM categorie c LEFT JOIN public.org_units u ON u.id=c.unit_id ORDER BY c.sort_order, c.nome`))));
r.post('/categorie', admin, ah(async (req, res) => {
  const b = parse(catSchema, req.body || {});
  if (b.unit_id && !(await one('SELECT 1 FROM public.org_units WHERE id=$1 AND active', [b.unit_id]))) throw bad('Casella non valida');
  const c = await one('INSERT INTO categorie (nome, descrizione, unit_id, priorita_default, riservata, attiva, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [b.nome, b.descrizione, b.unit_id || null, b.priorita_default, b.riservata, b.attiva, b.sort_order]);
  await audit(req, 'TICKET_CATEGORIA', { module: KEY, entity: 'categoria', entityId: c.id, label: b.nome });
  res.status(201).json(await one(`SELECT ${CAT_COLS} FROM categorie c LEFT JOIN public.org_units u ON u.id=c.unit_id WHERE c.id=$1`, [c.id]));
}));
r.put('/categorie/:id', admin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM categorie WHERE id=$1', [req.params.id]);
  if (!cur) throw notFound('Categoria non trovata');
  const b = parse(catSchema, { ...cur, ...req.body });
  if (b.unit_id && !(await one('SELECT 1 FROM public.org_units WHERE id=$1 AND active', [b.unit_id]))) throw bad('Casella non valida');
  await q('UPDATE categorie SET nome=$2, descrizione=$3, unit_id=$4, priorita_default=$5, riservata=$6, attiva=$7, sort_order=$8, updated_at=now() WHERE id=$1', [cur.id, b.nome, b.descrizione, b.unit_id || null, b.priorita_default, b.riservata, b.attiva, b.sort_order]);
  await audit(req, 'TICKET_CATEGORIA', { module: KEY, entity: 'categoria', entityId: cur.id, label: b.nome });
  res.json(await one(`SELECT ${CAT_COLS} FROM categorie c LEFT JOIN public.org_units u ON u.id=c.unit_id WHERE c.id=$1`, [cur.id]));
}));
r.delete('/categorie/:id', admin, ah(async (req, res) => {
  const cur = await one('SELECT c.*, (SELECT count(*)::int FROM tickets t WHERE t.categoria_id=c.id) AS n FROM categorie c WHERE c.id=$1', [req.params.id]);
  if (!cur) throw notFound('Categoria non trovata');
  if (cur.n > 0) { await q('UPDATE categorie SET attiva=FALSE, updated_at=now() WHERE id=$1', [cur.id]); return res.json({ ok: true, disattivata: true }); }
  await q('DELETE FROM categorie WHERE id=$1', [cur.id]);
  await audit(req, 'TICKET_CATEGORIA_ELIMINATA', { module: KEY, entity: 'categoria', entityId: cur.id, label: cur.nome });
  res.json({ ok: true });
}));

r.get('/sla', ah(async (_req, res) => res.json(await many('SELECT * FROM sla ORDER BY priorita'))));
r.put('/sla', admin, ah(async (req, res) => {
  const b = parse(z.array(z.object({ priorita: z.enum(PRIORITA), etichetta: z.string().trim().min(1).max(40).optional(), prima_risposta_ore: z.coerce.number().int().min(1).max(10000), risoluzione_ore: z.coerce.number().int().min(1).max(100000) })).min(1), req.body);
  for (const s of b) await q('UPDATE sla SET prima_risposta_ore=$2, risoluzione_ore=$3, etichetta=coalesce($4, etichetta), updated_at=now() WHERE priorita=$1', [s.priorita, s.prima_risposta_ore, s.risoluzione_ore, s.etichetta || null]);
  await audit(req, 'TICKET_SLA', { module: KEY, entity: 'sla', label: 'SLA aggiornati', data: b });
  res.json(await many('SELECT * FROM sla ORDER BY priorita'));
}));

r.get('/impostazioni', ah(async (_req, res) => res.json(await settings())));
r.put('/impostazioni', admin, ah(async (req, res) => {
  const b = parse(z.object({ chiusura_automatica_giorni: z.coerce.number().int().min(0).max(365).optional(), escalation_attiva: z.boolean().optional(), max_aperture_giorno: z.coerce.number().int().min(1).max(500).optional(), avviso_privacy: z.string().trim().max(2000).optional(), avviso_riservato: z.string().trim().max(3000).optional() }), req.body || {});
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, v);
  await audit(req, 'TICKET_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', ') });
  res.json(await settings());
}));

// Esecuzione immediata del lavoro periodico (SLA, escalation, chiusura automatica)
r.post('/admin/job', admin, ah(async (req, res) => {
  const out = await runTicketJob();
  await audit(req, 'TICKET_JOB', { module: KEY, entity: 'job', label: 'Esecuzione manuale', data: out });
  res.json(out);
}));

export default r;
