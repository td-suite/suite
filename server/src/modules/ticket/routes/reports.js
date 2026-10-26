// Statistiche ed esportazioni (XLSX, scheda PDF, rapporto PDF), sempre limitate ai ticket visibili all'utente.
import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, parse, audit, notFound, forbidden } from '../../../lib/util.js';
import { userContext, canSee, isGestore, seesName, unitInfo } from '../lib/access.js';
import { KEY, loadTicket, pubTicket, T_COLS, T_FROM } from '../lib/core.js';
import { computeStats } from '../lib/stats.js';
import { ticketsXlsx, schedaPdf, rapportoPdf } from '../lib/export.js';
import { listWhere } from './tickets.js';

const r = Router();
const periodo = z.object({ da: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), unit_id: z.coerce.number().int().optional() });

r.get('/stats', ah(async (req, res) => {
  const f = parse(periodo, req.query);
  res.json(await computeStats(await userContext(req), f));
}));

r.get('/export/tickets.xlsx', ah(async (req, res) => {
  const f = parse(z.object({ q: z.string().trim().max(200).optional().default(''), stato: z.string().max(60).optional().default(''), categoria: z.coerce.number().int().optional(), priorita: z.string().max(2).optional().default(''), unit_id: z.coerce.number().int().optional(), mine: z.string().optional(), gestiti: z.string().optional(), sforati: z.string().optional(), aperti: z.string().optional(), anno: z.coerce.number().int().optional(), per_conto: z.string().max(20).optional().default('') }), req.query);
  const ctx = await userContext(req);
  const params = [];
  const { where, order } = listWhere(ctx, f, params);
  const rows = (await many(`SELECT ${T_COLS} FROM ${T_FROM} ${where} ORDER BY ${order} LIMIT 5000`, params)).map((t) => pubTicket(t, { seesName: seesName(ctx, t) }));
  const stats = await computeStats(ctx, { unit_id: f.unit_id, da: f.anno ? `${f.anno}-01-01` : undefined, a: f.anno ? `${f.anno}-12-31` : undefined });
  const buf = await ticketsXlsx(rows, stats, { titolo: 'Ticket' });
  await audit(req, 'TICKET_EXPORT_XLSX', { module: KEY, entity: 'export', label: `${rows.length} ticket` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Ticket ${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
}));

r.get('/tickets/:id/scheda.pdf', ah(async (req, res) => {
  const t = await loadTicket(Number(req.params.id));
  if (!t) throw notFound('Ticket non trovato');
  const ctx = await userContext(req);
  if (!canSee(ctx, t)) throw forbidden('Non hai accesso a questo ticket');
  const g = isGestore(ctx, t);
  const commenti = await many(`SELECT cm.*, u.full_name AS autore_nome FROM commenti cm LEFT JOIN public.users u ON u.id=cm.autore_user_id WHERE cm.ticket_id=$1 ${g ? '' : 'AND NOT cm.interno'} ORDER BY cm.created_at`, [t.id]);
  const allegati = await many(`SELECT a.id, a.filename, a.mime, a.size, a.created_at FROM allegati a LEFT JOIN commenti cm ON cm.id=a.commento_id WHERE a.ticket_id=$1 ${g ? '' : 'AND coalesce(cm.interno, FALSE) = FALSE'} ORDER BY a.created_at`, [t.id]);
  const eventi = await many(`SELECT e.*, u.full_name AS user_nome FROM eventi e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.ticket_id=$1 ${g ? '' : "AND e.tipo <> 'NOTA'"} ORDER BY e.created_at, e.id`, [t.id]);
  const osservatori = await many('SELECT u.full_name FROM osservatori o JOIN public.users u ON u.id=o.user_id WHERE o.ticket_id=$1 ORDER BY u.full_name', [t.id]);
  const responsabili = await many(`SELECT DISTINCT p.last_name || ' ' || p.first_name AS nome FROM public.org_positions op JOIN public.people p ON p.id=op.person_id WHERE op.unit_id=$1 AND op.is_head ORDER BY nome`, [t.unit_id]);
  const sn = seesName(ctx, t);
  const hide = (uid, name) => (!sn && uid === t.richiedente_user_id ? 'Riservato' : name);
  const buf = await schedaPdf(pubTicket(t, { seesName: sn }), { commenti: commenti.map((c) => ({ ...c, autore_nome: hide(c.autore_user_id, c.autore_nome) })), eventi: eventi.map((e) => ({ ...e, user_nome: hide(e.user_id, e.user_nome) })), allegati, osservatori, responsabili });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Ticket ${t.protocollo.replace(/\//g, '-')}.pdf"`);
  res.send(buf);
}));

r.get('/export/rapporto.pdf', ah(async (req, res) => {
  const f = parse(periodo, req.query);
  const ctx = await userContext(req);
  const stats = await computeStats(ctx, f);
  const unit = f.unit_id ? await unitInfo(f.unit_id) : null;
  const buf = await rapportoPdf(stats, { da: f.da, a: f.a, unitName: unit?.name });
  await audit(req, 'TICKET_EXPORT_RAPPORTO', { module: KEY, entity: 'export', label: `${f.da || ''} ${f.a || ''}`.trim() || 'tutto' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Rapporto ticket ${f.da || 'inizio'} ${f.a || 'oggi'}.pdf"`);
  res.send(buf);
}));

export default r;
