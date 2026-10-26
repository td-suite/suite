// Ticket: catalogo, elenco, apertura, dettaglio, azioni dei gestori e del richiedente, commenti, allegati, osservatori.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import { q, one, many, tx } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad, HttpError } from '../../../lib/util.js';
import { config } from '../config.js';
import { userContext, visibleSql, canSee, isGestore, seesName, unitHeadUserIds, assignableUsers, unitInfo } from '../lib/access.js';
import { KEY, PRIORITA, STATO_LABEL, nextNumero, formatProtocollo, settings, slaDeadlines, evento, notifica, loadTicket, pubTicket, indexTicket, T_COLS, T_FROM } from '../lib/core.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 1 } }).single('file');
const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw notFound('Ticket non trovato'); return n; };

// Carica un ticket visibile all'utente (404 se non esiste, 403 se non visibile)
async function visibile(req, id) {
  const t = await loadTicket(idOf(id));
  if (!t) throw notFound('Ticket non trovato');
  const ctx = await userContext(req);
  if (!canSee(ctx, t)) throw forbidden('Non hai accesso a questo ticket');
  return { t, ctx };
}
async function gestore(req, id) {
  const { t, ctx } = await visibile(req, id);
  if (!isGestore(ctx, t)) throw forbidden('Operazione riservata ai responsabili della casella destinataria');
  return { t, ctx };
}
const aperto = (t) => !['CHIUSO', 'ANNULLATO'].includes(t.stato);
const risp = async (req, res, id, extra = {}) => res.json({ ...pubTicket(await loadTicket(id), { seesName: true }), ...extra });

// ---- Catalogo per i form: categorie, SLA, unità dell'organigramma con percorso, sedi TD e Legal entity, proposta "per conto di"
r.get('/catalogo', ah(async (req, res) => {
  const ctx = await userContext(req);
  const [categorie, sla, unita, sedi, orgs, s] = await Promise.all([
    many('SELECT id, nome, descrizione, unit_id, priorita_default, riservata, sort_order FROM categorie WHERE attiva ORDER BY sort_order, nome'),
    many('SELECT * FROM sla ORDER BY priorita'),
    many(`SELECT u.id, u.name, u.kind, u.parent_id, u.branch, u.sort_order, org_unit_path(u.id) AS path,
            EXISTS (SELECT 1 FROM public.org_positions op WHERE op.unit_id=u.id AND op.is_head) OR u.head_person_id IS NOT NULL AS has_head,
            (SELECT string_agg(p.last_name || ' ' || p.first_name, ', ' ORDER BY p.last_name) FROM public.org_positions op JOIN public.people p ON p.id=op.person_id WHERE op.unit_id=u.id AND op.is_head) AS responsabili
          FROM public.org_units u WHERE u.active ORDER BY u.sort_order, u.name`),
    many(`SELECT id, code, name, short_name, kind, city FROM public.sites WHERE active AND kind <> 'SERVICE' ORDER BY name`),
    many(`SELECT id, code, name, kind FROM public.organizations WHERE active ORDER BY name`),
    settings(),
  ]);
  // proposta "per conto di": sede e legal entity della persona dell'utente (o dell'utente)
  const me = await one(`SELECT coalesce(p.site_id, u.site_id) AS site_id, coalesce(p.organization_id, u.organization_id, s.organization_id) AS org_id, p.unit_id
      FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id LEFT JOIN public.sites s ON s.id=coalesce(p.site_id, u.site_id) WHERE u.id=$1`, [ctx.uid]);
  res.json({ categorie, sla, unita, sedi, organizzazioni: orgs, proposta: { site_id: me?.site_id || null, org_id: me?.org_id || null, unit_id: me?.unit_id || null }, avviso_privacy: s.avviso_privacy, avviso_riservato: s.avviso_riservato, limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerTicket, estensioni: config.allowedExt, riapertura_giorni: config.riaperturaGiorni } });
}));

// Utenti assegnabili per una casella (afferenti alla casella o a una discendente)
r.get('/unita/:id/utenti', ah(async (req, res) => res.json(await assignableUsers(idOf(req.params.id)))));

// ---- Elenco
const listSchema = z.object({
  q: z.string().trim().max(200).optional().default(''), stato: z.string().max(20).optional().default(''), categoria: z.coerce.number().int().optional(),
  priorita: z.string().max(2).optional().default(''), unit_id: z.coerce.number().int().optional(), mine: z.string().optional(), gestiti: z.string().optional(),
  sforati: z.string().optional(), aperti: z.string().optional(), anno: z.coerce.number().int().optional(), per_conto: z.string().max(20).optional().default(''),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export function listWhere(ctx, f, params) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [visibleSql(ctx, params)];
  if (f.stato) where.push(`t.stato = ANY(${p(f.stato.split(','))}::text[])`);
  if (f.aperti === '1') where.push(`t.stato NOT IN ('CHIUSO','ANNULLATO')`);
  if (f.categoria) where.push(`t.categoria_id = ${p(f.categoria)}`);
  if (f.priorita) where.push(`t.priorita = ${p(f.priorita)}`);
  if (f.unit_id) where.push(`t.unit_id IN (SELECT id FROM unit_subtree(ARRAY[${p(f.unit_id)}]::int[]))`);
  if (f.anno) where.push(`t.anno = ${p(f.anno)}`);
  if (f.mine === '1') where.push(`(t.richiedente_user_id = ${p(ctx.uid)} OR EXISTS (SELECT 1 FROM osservatori o WHERE o.ticket_id=t.id AND o.user_id = ${p(ctx.uid)}))`);
  if (f.gestiti === '1') {
    if (!ctx.isAdmin) {
      const parts = [`t.assegnatario_user_id = ${p(ctx.uid)}`];
      if (ctx.subtree.length) { const s = p(ctx.subtree); parts.push(`(NOT t.riservato AND (t.unit_id = ANY(${s}::int[]) OR t.escalation_unit_id = ANY(${s}::int[])))`); }
      if (ctx.managed.length) parts.push(`(t.riservato AND t.unit_id = ANY(${p(ctx.managed)}::int[]))`);
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  if (f.sforati === '1') where.push(`t.stato NOT IN ('CHIUSO','ANNULLATO') AND ((t.prima_risposta_at IS NULL AND t.sla_risposta_scadenza < now()) OR (t.risolto_at IS NULL AND t.stato <> 'IN_ATTESA' AND t.sla_risoluzione_scadenza < now()) OR t.sla_risposta_sforato OR t.sla_risoluzione_sforato)`);
  if (f.per_conto) {
    const [kind, id] = f.per_conto.split(':');
    if (kind === 'site' && Number(id)) where.push(`t.per_conto_site_id = ${p(Number(id))}`);
    if (kind === 'org' && Number(id)) where.push(`t.per_conto_org_id = ${p(Number(id))}`);
  }
  let order = `CASE WHEN t.stato IN ('CHIUSO','ANNULLATO') THEN 1 ELSE 0 END, t.priorita, t.sla_risoluzione_scadenza, t.id DESC`;
  if (f.q) {
    const qi = p(f.q);
    where.push(`(t.fts @@ websearch_to_tsquery('italian', ${qi}) OR t.protocollo ILIKE '%' || ${qi} || '%' OR t.titolo ILIKE '%' || ${qi} || '%')`);
    order = `ts_rank_cd(t.fts, websearch_to_tsquery('italian', ${qi})) DESC, ${order}`;
  }
  return { where: `WHERE ${where.join(' AND ')}`, order };
}
r.get('/tickets', ah(async (req, res) => {
  const f = parse(listSchema, req.query);
  const ctx = await userContext(req);
  const params = [];
  const { where, order } = listWhere(ctx, f, params);
  const total = (await one(`SELECT count(*)::int AS n FROM tickets t ${where}`, params)).n;
  const rows = await many(`SELECT ${T_COLS} FROM ${T_FROM} ${where} ORDER BY ${order} LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params);
  res.json({ total, page: f.page, pageSize: f.pageSize, rows: rows.map((t) => { const x = pubTicket(t, { seesName: seesName(ctx, t) }); delete x.descrizione; return x; }) });
}));

// ---- Apertura
const openSchema = z.object({
  titolo: z.string().trim().min(5, 'almeno 5 caratteri').max(200), descrizione: z.string().trim().min(10, 'descrivi la richiesta (almeno 10 caratteri)').max(10000),
  categoria_id: z.coerce.number().int(), priorita: z.enum(PRIORITA).optional(), unit_id: z.coerce.number().int().optional().nullable(),
  per_conto_site_id: z.coerce.number().int().optional().nullable(), per_conto_org_id: z.coerce.number().int().optional().nullable(),
  anonimo: z.boolean().optional(), osservatori: z.array(z.coerce.number().int()).max(20).optional(),
});
r.post('/tickets', ah(async (req, res) => {
  const b = parse(openSchema, req.body || {});
  const ctx = await userContext(req);
  const s = await settings();
  const oggi = (await one(`SELECT count(*)::int AS n FROM tickets WHERE richiedente_user_id=$1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome'`, [ctx.uid])).n;
  if (oggi >= Number(s.max_aperture_giorno || 20)) throw new HttpError(429, `Hai già aperto ${oggi} ticket oggi: il limite giornaliero è ${s.max_aperture_giorno}`);
  const cat = await one('SELECT * FROM categorie WHERE id=$1 AND attiva', [b.categoria_id]);
  if (!cat) throw bad('Categoria non valida');
  const unitId = b.unit_id || cat.unit_id;
  if (!unitId) throw bad('Indica la casella destinataria: la categoria non ne ha una predefinita');
  const unit = await unitInfo(unitId);
  if (!unit || !unit.active) throw bad('Casella destinataria non valida');
  if (b.per_conto_site_id && !(await one(`SELECT 1 FROM public.sites WHERE id=$1 AND active`, [b.per_conto_site_id]))) throw bad('Sede non valida');
  if (b.per_conto_org_id && !(await one(`SELECT 1 FROM public.organizations WHERE id=$1 AND active`, [b.per_conto_org_id]))) throw bad('Legal entity non valida');
  const riservato = Boolean(cat.riservata);
  const priorita = b.priorita || cat.priorita_default;
  const t = await tx(async (client) => {
    const anno = new Date().getFullYear();
    const numero = await nextNumero(client, anno);
    const now = new Date();
    const d = await slaDeadlines(priorita, now, 0, client.query.bind(client));
    const row = (await client.query(`INSERT INTO tickets (anno, numero, protocollo, titolo, descrizione, categoria_id, priorita, riservato, anonimo, richiedente_user_id, richiedente_person_id, per_conto_site_id, per_conto_org_id, unit_id, sla_risposta_scadenza, sla_risoluzione_scadenza, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *`,
      [anno, numero, formatProtocollo(anno, numero), b.titolo, b.descrizione, cat.id, priorita, riservato, riservato && Boolean(b.anonimo), ctx.uid, req.user.person_id || null, b.per_conto_site_id || null, b.per_conto_org_id || null, unitId, d.risposta, d.risoluzione, now])).rows[0];
    await evento(row.id, 'APERTO', ctx.uid, { priorita, unit_id: unitId, unit: unit.name, categoria: cat.nome, riservato }, client);
    if (!riservato && b.osservatori?.length) {
      for (const uid of new Set(b.osservatori.filter((x) => x !== ctx.uid))) await client.query('INSERT INTO osservatori (ticket_id, user_id) SELECT $1, id FROM public.users WHERE id=$2 AND status=\'ACTIVE\' ON CONFLICT DO NOTHING', [row.id, uid]);
    }
    return row;
  });
  const full = await loadTicket(t.id);
  await notifica(await unitHeadUserIds(unitId), full, { evento: 'aperto', title: 'Nuovo ticket per la tua casella', body: full.descrizione.slice(0, 300), exclude: [ctx.uid] });
  await indexTicket(full);
  await audit(req, 'TICKET_APERTO', { module: KEY, entity: 'ticket', entityId: full.id, label: `${full.protocollo} ${riservato ? '(riservato)' : full.titolo}`, data: { unit_id: unitId, priorita, riservato } });
  res.status(201).json(pubTicket(full));
}));

// ---- Dettaglio (commenti e allegati filtrati per visibilità; letture dei riservati registrate)
r.get('/tickets/:id', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const g = isGestore(ctx, t);
  const mine = t.richiedente_user_id === ctx.uid;
  if (t.riservato && !mine) {
    // una lettura per utente ogni 10 minuti, per non riempire la cronologia a ogni aggiornamento della pagina
    const recent = await one(`SELECT 1 FROM eventi WHERE ticket_id=$1 AND tipo='LETTURA_RISERVATO' AND user_id=$2 AND created_at > now() - interval '10 minutes'`, [t.id, ctx.uid]);
    if (!recent) {
      await evento(t.id, 'LETTURA_RISERVATO', ctx.uid, { ruolo: ctx.role });
      await audit(req, 'TICKET_LETTURA_RISERVATO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo });
    }
  }
  const commenti = await many(`SELECT cm.*, u.full_name AS autore_nome FROM commenti cm LEFT JOIN public.users u ON u.id=cm.autore_user_id WHERE cm.ticket_id=$1 ${g ? '' : 'AND NOT cm.interno'} ORDER BY cm.created_at`, [t.id]);
  const allegati = await many(`SELECT a.id, a.commento_id, a.filename, a.mime, a.size, a.caricato_da_user_id, a.created_at, u.full_name AS caricato_da_nome, cm.interno
      FROM allegati a LEFT JOIN public.users u ON u.id=a.caricato_da_user_id LEFT JOIN commenti cm ON cm.id=a.commento_id WHERE a.ticket_id=$1 ${g ? '' : 'AND coalesce(cm.interno, FALSE) = FALSE'} ORDER BY a.created_at`, [t.id]);
  const eventi = await many(`SELECT e.*, u.full_name AS user_nome FROM eventi e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.ticket_id=$1 ${g ? '' : "AND e.tipo <> 'NOTA'"} ORDER BY e.created_at, e.id`, [t.id]);
  const osservatori = await many('SELECT o.user_id, u.full_name, u.email FROM osservatori o JOIN public.users u ON u.id=o.user_id WHERE o.ticket_id=$1 ORDER BY u.full_name', [t.id]);
  const responsabili = await many(`SELECT DISTINCT p.id AS person_id, p.last_name || ' ' || p.first_name AS nome, u.id AS user_id FROM public.org_positions op JOIN public.people p ON p.id=op.person_id LEFT JOIN public.users u ON u.person_id=p.id WHERE op.unit_id=$1 AND op.is_head ORDER BY nome`, [t.unit_id]);
  const sn = seesName(ctx, t);
  const hide = (uid) => (!sn && uid === t.richiedente_user_id ? 'Riservato' : null);
  const giorniRiapertura = t.risolto_at ? (Date.now() - new Date(t.risolto_at).getTime()) / 86400_000 : null;
  const permessi = {
    gestore: g, richiedente: mine, admin: ctx.isAdmin,
    modifica: mine && t.stato === 'APERTO',
    prendi_in_carico: g && t.stato === 'APERTO' && t.assegnatario_user_id !== ctx.uid,
    assegna: g && aperto(t), gira: g && aperto(t), priorita: g && aperto(t),
    in_attesa: g && ['APERTO', 'IN_CORSO'].includes(t.stato), riprendi: g && t.stato === 'IN_ATTESA', risolvi: g && ['APERTO', 'IN_CORSO', 'IN_ATTESA'].includes(t.stato),
    chiudi: (mine || g) && t.stato === 'RISOLTO',
    riapri: (mine || g) && t.stato === 'RISOLTO' && giorniRiapertura != null && giorniRiapertura <= config.riaperturaGiorni,
    annulla: (mine && t.stato === 'APERTO') || (ctx.isAdmin && aperto(t)),
    commenta: aperto(t) || t.stato === 'CHIUSO', nota_interna: g, allega: aperto(t) && t.n_allegati < config.maxFilesPerTicket,
    osservatori: !t.riservato && (mine || g),
  };
  res.json({
    ...pubTicket(t, { seesName: sn }),
    commenti: commenti.map((c) => ({ ...c, autore_nome: hide(c.autore_user_id) || c.autore_nome })),
    allegati: allegati.map((a) => ({ ...a, caricato_da_nome: hide(a.caricato_da_user_id) || a.caricato_da_nome })),
    eventi: eventi.map((e) => ({ ...e, user_nome: hide(e.user_id) || e.user_nome })),
    osservatori, responsabili, permessi,
  });
}));

// ---- Modifica di titolo e descrizione (solo richiedente, finché APERTO)
r.put('/tickets/:id', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  if (t.richiedente_user_id !== ctx.uid) throw forbidden('Solo il richiedente modifica il ticket');
  if (t.stato !== 'APERTO') throw bad('Il ticket non si modifica più dopo la presa in carico: aggiungi un commento');
  const b = parse(z.object({ titolo: z.string().trim().min(5).max(200), descrizione: z.string().trim().min(10).max(10000) }), req.body || {});
  await q('UPDATE tickets SET titolo=$2, descrizione=$3, updated_at=now() WHERE id=$1', [t.id, b.titolo, b.descrizione]);
  await evento(t.id, 'MODIFICA', ctx.uid, { titolo_prima: t.titolo });
  await indexTicket(await loadTicket(t.id));
  await risp(req, res, t.id);
}));

// ---- Azioni dei gestori
r.post('/tickets/:id/prendi-in-carico', ah(async (req, res) => {
  const { t, ctx } = await gestore(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  if (t.assegnatario_user_id === ctx.uid) throw bad('Il ticket è già in carico a te');
  await q(`UPDATE tickets SET assegnatario_user_id=$2, stato = CASE WHEN stato='APERTO' THEN 'IN_CORSO' ELSE stato END, prima_risposta_at=coalesce(prima_risposta_at, now()),
      sla_risposta_sforato = CASE WHEN prima_risposta_at IS NULL AND now() > sla_risposta_scadenza THEN TRUE ELSE sla_risposta_sforato END, updated_at=now() WHERE id=$1`, [t.id, ctx.uid]);
  await evento(t.id, 'PRESO_IN_CARICO', ctx.uid, { prima: t.assegnatario_user_id });
  const full = await loadTicket(t.id);
  await notifica([t.richiedente_user_id], full, { evento: 'presa_in_carico', title: `Preso in carico da ${req.user.full_name}`, exclude: [ctx.uid] });
  await audit(req, 'TICKET_PRESO_IN_CARICO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

r.post('/tickets/:id/assegna', ah(async (req, res) => {
  const { t, ctx } = await gestore(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  const b = parse(z.object({ user_id: z.coerce.number().int() }), req.body || {});
  if (b.user_id !== ctx.uid && !ctx.isAdmin) {
    const ok = (await assignableUsers(t.unit_id)).some((u) => u.id === b.user_id);
    if (!ok) throw bad('La persona scelta non afferisce alla casella destinataria');
  }
  const dest = await one(`SELECT id, full_name FROM public.users WHERE id=$1 AND status='ACTIVE'`, [b.user_id]);
  if (!dest) throw bad('Utente non valido');
  await q(`UPDATE tickets SET assegnatario_user_id=$2, stato = CASE WHEN stato='APERTO' THEN 'IN_CORSO' ELSE stato END, prima_risposta_at=coalesce(prima_risposta_at, now()),
      sla_risposta_sforato = CASE WHEN prima_risposta_at IS NULL AND now() > sla_risposta_scadenza THEN TRUE ELSE sla_risposta_sforato END, updated_at=now() WHERE id=$1`, [t.id, b.user_id]);
  await evento(t.id, 'ASSEGNATO', ctx.uid, { a_user_id: b.user_id, a: dest.full_name, prima: t.assegnatario_user_id });
  const full = await loadTicket(t.id);
  await notifica([b.user_id], full, { evento: 'assegnato', title: `Ticket assegnato a te da ${req.user.full_name}`, exclude: [ctx.uid] });
  await notifica([t.richiedente_user_id], full, { evento: 'assegnato_richiedente', title: `Preso in carico da ${dest.full_name}`, exclude: [ctx.uid, b.user_id] });
  await audit(req, 'TICKET_ASSEGNATO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { a: b.user_id } });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

r.post('/tickets/:id/gira', ah(async (req, res) => {
  const { t, ctx } = await gestore(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  const b = parse(z.object({ unit_id: z.coerce.number().int(), motivo: z.string().trim().min(3, 'indica il motivo').max(1000) }), req.body || {});
  if (b.unit_id === t.unit_id) throw bad('Il ticket è già in questa casella');
  const unit = await unitInfo(b.unit_id);
  if (!unit || !unit.active) throw bad('Casella non valida');
  await q(`UPDATE tickets SET unit_id=$2, assegnatario_user_id=NULL, escalation_unit_id=NULL, escalated_at=NULL, stato = CASE WHEN stato IN ('IN_CORSO','IN_ATTESA') THEN 'APERTO' ELSE stato END,
      attesa_secondi = attesa_secondi + CASE WHEN attesa_da IS NOT NULL THEN EXTRACT(EPOCH FROM now() - attesa_da)::int ELSE 0 END,
      sla_risoluzione_scadenza = sla_risoluzione_scadenza + CASE WHEN attesa_da IS NOT NULL THEN (now() - attesa_da) ELSE interval '0' END, attesa_da=NULL, updated_at=now() WHERE id=$1`, [t.id, b.unit_id]);
  await evento(t.id, 'GIRATO', ctx.uid, { da_unit_id: t.unit_id, da: t.unit_nome, a_unit_id: b.unit_id, a: unit.name, motivo: b.motivo });
  const full = await loadTicket(t.id);
  await notifica(await unitHeadUserIds(b.unit_id), full, { evento: 'girato', title: `Ticket girato alla tua casella da ${req.user.full_name}`, body: b.motivo, exclude: [ctx.uid] });
  await notifica([t.richiedente_user_id], full, { evento: 'girato_richiedente', title: `Girato alla casella ${unit.name}`, body: b.motivo, exclude: [ctx.uid] });
  await audit(req, 'TICKET_GIRATO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { da: t.unit_id, a: b.unit_id } });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

r.post('/tickets/:id/priorita', ah(async (req, res) => {
  const { t, ctx } = await gestore(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  const b = parse(z.object({ priorita: z.enum(PRIORITA), motivo: z.string().trim().max(500).optional() }), req.body || {});
  if (b.priorita === t.priorita) throw bad('Priorità invariata');
  const d = await slaDeadlines(b.priorita, t.created_at, t.attesa_secondi);
  const now = Date.now();
  const rispSforato = t.prima_risposta_at ? new Date(t.prima_risposta_at) > d.risposta : now > d.risposta.getTime();
  const risSforato = t.risolto_at ? new Date(t.risolto_at) > d.risoluzione : (t.stato !== 'IN_ATTESA' && now > d.risoluzione.getTime());
  await q('UPDATE tickets SET priorita=$2, sla_risposta_scadenza=$3, sla_risoluzione_scadenza=$4, sla_risposta_sforato=$5, sla_risoluzione_sforato=$6, updated_at=now() WHERE id=$1', [t.id, b.priorita, d.risposta, d.risoluzione, rispSforato, risSforato]);
  await evento(t.id, 'PRIORITA', ctx.uid, { da: t.priorita, a: b.priorita, motivo: b.motivo || null, scadenza_risposta: d.risposta, scadenza_risoluzione: d.risoluzione });
  await audit(req, 'TICKET_PRIORITA', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { da: t.priorita, a: b.priorita } });
  await risp(req, res, t.id);
}));

// Stato: IN_ATTESA (congela lo SLA di risoluzione), IN_CORSO (riprende e sposta la scadenza), RISOLTO (con messaggio al richiedente)
r.post('/tickets/:id/stato', ah(async (req, res) => {
  const { t, ctx } = await gestore(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  const b = parse(z.object({ stato: z.enum(['IN_ATTESA', 'IN_CORSO', 'RISOLTO']), messaggio: z.string().trim().max(5000).optional() }), req.body || {});
  if (b.stato === t.stato) throw bad('Stato invariato');
  const dati = { da: t.stato, a: b.stato, messaggio: b.messaggio || null };
  if (b.stato === 'IN_ATTESA') {
    if (!['APERTO', 'IN_CORSO'].includes(t.stato)) throw bad('Si mette in attesa un ticket aperto o in corso');
    await q(`UPDATE tickets SET stato='IN_ATTESA', attesa_da=now(), updated_at=now() WHERE id=$1`, [t.id]);
  } else {
    // uscita dall'attesa: il tempo fermo sposta in avanti la scadenza di risoluzione
    let pausa = 0;
    if (t.stato === 'IN_ATTESA' && t.attesa_da) {
      pausa = Math.max(0, Math.round((Date.now() - new Date(t.attesa_da).getTime()) / 1000));
      dati.intervallo_attesa = { inizio: t.attesa_da, fine: new Date(), secondi: pausa };
    }
    const sforato = (scad) => `(${scad} + make_interval(secs => ${pausa})) < now()`;
    if (b.stato === 'IN_CORSO') {
      if (t.stato !== 'IN_ATTESA' && t.stato !== 'APERTO') throw bad('Passaggio di stato non ammesso');
      await q(`UPDATE tickets SET stato='IN_CORSO', attesa_secondi = attesa_secondi + $2, sla_risoluzione_scadenza = sla_risoluzione_scadenza + make_interval(secs => $2), attesa_da=NULL, updated_at=now() WHERE id=$1`, [t.id, pausa]);
      dati.nuova_scadenza = (await one('SELECT sla_risoluzione_scadenza FROM tickets WHERE id=$1', [t.id])).sla_risoluzione_scadenza;
    } else {
      if (!b.messaggio || b.messaggio.length < 3) throw bad('Scrivi il messaggio di risoluzione per il richiedente');
      await q(`UPDATE tickets SET stato='RISOLTO', risolto_at=now(), messaggio_risoluzione=$3, attesa_secondi = attesa_secondi + $2, sla_risoluzione_scadenza = sla_risoluzione_scadenza + make_interval(secs => $2), attesa_da=NULL,
          prima_risposta_at = coalesce(prima_risposta_at, now()), sla_risposta_sforato = CASE WHEN prima_risposta_at IS NULL AND now() > sla_risposta_scadenza THEN TRUE ELSE sla_risposta_sforato END,
          sla_risoluzione_sforato = ${sforato('sla_risoluzione_scadenza')}, updated_at=now() WHERE id=$1`, [t.id, pausa, b.messaggio]);
    }
  }
  await evento(t.id, 'STATO', ctx.uid, dati);
  const full = await loadTicket(t.id);
  if (b.stato === 'RISOLTO') await notifica([t.richiedente_user_id, ...(t.osservatori_ids || [])], full, { evento: 'risolto', title: `Risolto da ${req.user.full_name}: conferma la chiusura o riapri entro ${config.riaperturaGiorni} giorni`, body: b.messaggio, exclude: [ctx.uid] });
  else await notifica([t.richiedente_user_id], full, { evento: 'stato', title: `Stato: ${STATO_LABEL[b.stato]}`, body: b.messaggio, exclude: [ctx.uid] });
  await audit(req, 'TICKET_STATO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { da: t.stato, a: b.stato } });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

// ---- Richiedente (e gestori): chiusura con valutazione, riapertura, annullamento
r.post('/tickets/:id/chiudi', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const mine = t.richiedente_user_id === ctx.uid;
  if (!mine && !isGestore(ctx, t)) throw forbidden('Solo il richiedente o un gestore chiude il ticket');
  if (t.stato !== 'RISOLTO') throw bad('Si chiude solo un ticket risolto');
  const b = parse(z.object({ valutazione: z.coerce.number().int().min(1).max(5).optional().nullable(), nota: z.string().trim().max(2000).optional() }), req.body || {});
  const val = mine ? b.valutazione || null : null;
  await q(`UPDATE tickets SET stato='CHIUSO', chiuso_at=now(), valutazione=coalesce($2, valutazione), valutazione_nota=coalesce($3, valutazione_nota), updated_at=now() WHERE id=$1`, [t.id, val, mine ? b.nota || null : null]);
  await evento(t.id, 'CHIUSO', ctx.uid, { da_richiedente: mine, nota: mine ? b.nota || null : null });
  if (val) await evento(t.id, 'VALUTATO', ctx.uid, { valutazione: val, nota: b.nota || null });
  const full = await loadTicket(t.id);
  if (mine) await notifica([t.assegnatario_user_id].filter(Boolean), full, { evento: 'chiuso', title: `Chiuso dal richiedente${val ? ` con valutazione ${val}/5` : ''}`, body: b.nota, exclude: [ctx.uid] });
  else await notifica([t.richiedente_user_id], full, { evento: 'chiuso', title: `Chiuso da ${req.user.full_name}`, exclude: [ctx.uid] });
  await audit(req, 'TICKET_CHIUSO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { valutazione: val } });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

r.post('/tickets/:id/riapri', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const mine = t.richiedente_user_id === ctx.uid;
  if (!mine && !isGestore(ctx, t)) throw forbidden('Solo il richiedente o un gestore riapre il ticket');
  if (t.stato !== 'RISOLTO') throw bad('Si riapre solo un ticket risolto e non ancora chiuso');
  if ((Date.now() - new Date(t.risolto_at).getTime()) / 86400_000 > config.riaperturaGiorni) throw bad(`La riapertura è possibile entro ${config.riaperturaGiorni} giorni dalla risoluzione: apri un nuovo ticket`);
  const b = parse(z.object({ motivo: z.string().trim().min(3, 'indica il motivo').max(2000) }), req.body || {});
  await q(`UPDATE tickets SET stato='IN_CORSO', risolto_at=NULL, riaperture=riaperture+1, sla_risoluzione_sforato=FALSE, updated_at=now() WHERE id=$1`, [t.id]);
  await evento(t.id, 'RIAPERTO', ctx.uid, { motivo: b.motivo, riaperture: t.riaperture + 1 });
  const full = await loadTicket(t.id);
  const dest = t.assegnatario_user_id ? [t.assegnatario_user_id] : await unitHeadUserIds(t.unit_id);
  await notifica(mine ? dest : [t.richiedente_user_id], full, { evento: 'riaperto', title: `Riaperto da ${req.user.full_name}`, body: b.motivo, exclude: [ctx.uid] });
  await audit(req, 'TICKET_RIAPERTO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

r.post('/tickets/:id/annulla', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const mine = t.richiedente_user_id === ctx.uid;
  if (!(mine && t.stato === 'APERTO') && !(ctx.isAdmin && aperto(t))) throw forbidden('Il richiedente annulla un ticket ancora aperto; l\'amministratore uno non chiuso');
  const motivo = String(req.body?.motivo || '').slice(0, 1000);
  await q(`UPDATE tickets SET stato='ANNULLATO', chiuso_at=now(), attesa_da=NULL, updated_at=now() WHERE id=$1`, [t.id]);
  await evento(t.id, 'ANNULLATO', ctx.uid, { motivo });
  const full = await loadTicket(t.id);
  await notifica([...(mine ? [] : [t.richiedente_user_id]), t.assegnatario_user_id].filter(Boolean), full, { evento: 'annullato', title: `Annullato da ${req.user.full_name}`, body: motivo, exclude: [ctx.uid] });
  await audit(req, 'TICKET_ANNULLATO', { module: KEY, entity: 'ticket', entityId: t.id, label: t.protocollo, data: { motivo } });
  await indexTicket(full);
  res.json(pubTicket(full));
}));

// ---- Commenti (pubblici o note interne)
r.post('/tickets/:id/commenti', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  if (t.stato === 'ANNULLATO') throw bad('Il ticket è annullato');
  const b = parse(z.object({ testo: z.string().trim().min(1).max(10000), interno: z.boolean().optional() }), req.body || {});
  const g = isGestore(ctx, t);
  const interno = Boolean(b.interno);
  if (interno && !g) throw forbidden('Le note interne sono riservate ai gestori');
  const c = await one('INSERT INTO commenti (ticket_id, autore_user_id, testo, interno) VALUES ($1,$2,$3,$4) RETURNING *', [t.id, ctx.uid, b.testo, interno]);
  if (!interno && g && !t.prima_risposta_at) {
    await q(`UPDATE tickets SET prima_risposta_at=now(), sla_risposta_sforato = now() > sla_risposta_scadenza, updated_at=now() WHERE id=$1`, [t.id]);
  } else await q('UPDATE tickets SET updated_at=now() WHERE id=$1', [t.id]);
  await evento(t.id, interno ? 'NOTA' : 'COMMENTO', ctx.uid, { commento_id: c.id, anteprima: b.testo.slice(0, 120) });
  const full = await loadTicket(t.id);
  if (!interno) {
    const mine = t.richiedente_user_id === ctx.uid;
    const dest = [t.richiedente_user_id, t.assegnatario_user_id, ...(t.osservatori_ids || [])].filter(Boolean);
    if (mine && !t.assegnatario_user_id) dest.push(...(await unitHeadUserIds(t.unit_id)));
    await notifica(dest, full, { evento: `commento:${c.id}`, title: `Nuovo commento di ${req.user.full_name}`, body: b.testo, exclude: [ctx.uid] });
  }
  res.status(201).json({ ...c, autore_nome: req.user.full_name });
}));

// ---- Allegati (BYTEA nello schema del modulo)
const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
r.post('/tickets/:id/allegati', (req, res, next) => upload(req, res, (e) => (e ? next(bad(e.code === 'LIMIT_FILE_SIZE' ? `File troppo grande (massimo ${config.maxFileBytes / 1024 / 1024} MB)` : e.message)) : next())), ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  if (!aperto(t)) throw bad('Il ticket è chiuso');
  if (!req.file) throw bad('Nessun file');
  const ext = extOf(req.file.originalname);
  if (!config.allowedExt.includes(ext)) throw bad(`Tipo di file non ammesso (${config.allowedExt.join(', ')})`);
  if (t.n_allegati >= config.maxFilesPerTicket) throw bad(`Massimo ${config.maxFilesPerTicket} allegati per ticket`);
  let commentoId = Number(req.body?.commento_id) || null;
  if (commentoId) {
    const cm = await one('SELECT id, interno FROM commenti WHERE id=$1 AND ticket_id=$2', [commentoId, t.id]);
    if (!cm) throw bad('Commento non valido');
    if (cm.interno && !isGestore(ctx, t)) throw forbidden('Nota interna riservata ai gestori');
  }
  const a = await one('INSERT INTO allegati (ticket_id, commento_id, filename, mime, size, data, caricato_da_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ticket_id, commento_id, filename, mime, size, caricato_da_user_id, created_at',
    [t.id, commentoId, req.file.originalname.slice(0, 200), req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, ctx.uid]);
  await evento(t.id, 'ALLEGATO', ctx.uid, { allegato_id: a.id, filename: a.filename, size: a.size });
  await q('UPDATE tickets SET updated_at=now() WHERE id=$1', [t.id]);
  res.status(201).json({ ...a, caricato_da_nome: req.user.full_name });
}));
r.get('/tickets/:id/allegati/:aid', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const a = await one('SELECT a.*, cm.interno FROM allegati a LEFT JOIN commenti cm ON cm.id=a.commento_id WHERE a.id=$1 AND a.ticket_id=$2', [idOf(req.params.aid), t.id]);
  if (!a) throw notFound('Allegato non trovato');
  if (a.interno && !isGestore(ctx, t)) throw forbidden('Allegato di una nota interna');
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
  res.send(a.data);
}));

// ---- Osservatori (mai sui riservati)
r.post('/tickets/:id/osservatori', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  if (t.riservato) throw bad('I ticket riservati non hanno osservatori');
  if (t.richiedente_user_id !== ctx.uid && !isGestore(ctx, t)) throw forbidden('Solo richiedente e gestori aggiungono osservatori');
  const b = parse(z.object({ user_id: z.coerce.number().int() }), req.body || {});
  const u = await one(`SELECT id, full_name FROM public.users WHERE id=$1 AND status='ACTIVE'`, [b.user_id]);
  if (!u) throw bad('Utente non valido');
  await q('INSERT INTO osservatori (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t.id, b.user_id]);
  await evento(t.id, 'OSSERVATORE', ctx.uid, { aggiunto: u.full_name, user_id: u.id });
  const full = await loadTicket(t.id);
  await notifica([u.id], full, { evento: 'osservatore', title: `${req.user.full_name} ti ha aggiunto come osservatore`, exclude: [ctx.uid] });
  await indexTicket(full);
  res.json(await many('SELECT o.user_id, u.full_name, u.email FROM osservatori o JOIN public.users u ON u.id=o.user_id WHERE o.ticket_id=$1 ORDER BY u.full_name', [t.id]));
}));
r.delete('/tickets/:id/osservatori', ah(async (req, res) => {
  const { t, ctx } = await visibile(req, req.params.id);
  const b = parse(z.object({ user_id: z.coerce.number().int() }), req.body || {});
  if (t.richiedente_user_id !== ctx.uid && !isGestore(ctx, t) && b.user_id !== ctx.uid) throw forbidden('Operazione non consentita');
  await q('DELETE FROM osservatori WHERE ticket_id=$1 AND user_id=$2', [t.id, b.user_id]);
  await evento(t.id, 'OSSERVATORE', ctx.uid, { rimosso: b.user_id });
  await indexTicket(await loadTicket(t.id));
  res.json(await many('SELECT o.user_id, u.full_name, u.email FROM osservatori o JOIN public.users u ON u.id=o.user_id WHERE o.ticket_id=$1 ORDER BY u.full_name', [t.id]));
}));

// Ricerca utenti per osservatori/assegnazione (anagrafica unica, nessuna copia)
r.get('/utenti', ah(async (req, res) => {
  const s = String(req.query.q || '').trim();
  if (s.length < 2) return res.json([]);
  res.json(await many(`SELECT id, full_name, email FROM public.users WHERE status='ACTIVE' AND (lower(full_name) LIKE '%' || lower($1) || '%' OR lower(email) LIKE '%' || lower($1) || '%') ORDER BY full_name LIMIT 20`, [s]));
}));

export default r;
