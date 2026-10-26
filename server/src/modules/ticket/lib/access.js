// Visibilità e poteri sui ticket.
// Un utente vede un ticket se è il richiedente, un osservatore, l'assegnatario, responsabile (org_positions.is_head) della casella
// destinataria o di una casella antenata, responsabile della casella di escalation, oppure ADMIN/VIEWER del modulo.
// Riservati: solo richiedente, responsabili della casella destinataria (non gli antenati), assegnatario e ADMIN.
import { many, one } from '../db.js';

// Contesto dell'utente: ruolo del modulo, caselle di cui è responsabile e loro sottoalbero. Calcolato una volta per richiesta.
export async function userContext(req) {
  if (req.ticketCtx) return req.ticketCtx;
  const uid = req.user.id;
  const role = req.moduleUser?.role || 'UTENTE';
  const managed = (await many('SELECT id FROM managed_units($1)', [uid])).map((r) => r.id);
  const subtree = managed.length ? (await many('SELECT id FROM unit_subtree($1::int[])', [managed])).map((r) => r.id) : [];
  req.ticketCtx = { uid, role, managed, subtree, isAdmin: role === 'ADMIN', isViewer: role === 'VIEWER', isManager: managed.length > 0 };
  return req.ticketCtx;
}

// Frammento SQL (alias t) che filtra i ticket visibili all'utente; aggiunge i parametri a params
export function visibleSql(ctx, params, alias = 't') {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (ctx.isAdmin) return 'TRUE';
  const uid = p(ctx.uid);
  const parts = [`${alias}.richiedente_user_id = ${uid}`, `${alias}.assegnatario_user_id = ${uid}`,
    `(NOT ${alias}.riservato AND EXISTS (SELECT 1 FROM osservatori o WHERE o.ticket_id = ${alias}.id AND o.user_id = ${uid}))`];
  if (ctx.subtree.length) {
    const sub = p(ctx.subtree);
    parts.push(`(NOT ${alias}.riservato AND (${alias}.unit_id = ANY(${sub}::int[]) OR ${alias}.escalation_unit_id = ANY(${sub}::int[])))`);
  }
  if (ctx.managed.length) parts.push(`(${alias}.riservato AND ${alias}.unit_id = ANY(${p(ctx.managed)}::int[]))`);
  if (ctx.isViewer) parts.push(`NOT ${alias}.riservato`);
  return `(${parts.join(' OR ')})`;
}

export function canSee(ctx, t) {
  if (ctx.isAdmin) return true;
  if (t.richiedente_user_id === ctx.uid || t.assegnatario_user_id === ctx.uid) return true;
  if (t.riservato) return ctx.managed.includes(t.unit_id);
  if (ctx.isViewer) return true;
  if ((t.osservatori_ids || []).includes(ctx.uid)) return true;
  return ctx.subtree.includes(t.unit_id) || (t.escalation_unit_id && ctx.subtree.includes(t.escalation_unit_id));
}

// Gestore: può prendere in carico, assegnare, girare, cambiare priorità e stato, scrivere note interne
export function isGestore(ctx, t) {
  if (ctx.isAdmin) return true;
  if (t.assegnatario_user_id === ctx.uid) return true;
  if (t.riservato) return ctx.managed.includes(t.unit_id);
  return ctx.subtree.includes(t.unit_id) || (t.escalation_unit_id && ctx.subtree.includes(t.escalation_unit_id));
}

// Chi vede il nome del richiedente di un ticket riservato con "non mostrare il mio nome": richiedente, responsabili della
// casella destinataria, assegnatario. Per tutti gli altri (anche ADMIN) il nome è "Riservato".
export function seesName(ctx, t) {
  if (!t.riservato || !t.anonimo) return true;
  return t.richiedente_user_id === ctx.uid || t.assegnatario_user_id === ctx.uid || ctx.managed.includes(t.unit_id);
}

// Utenti attivi della Suite responsabili di una casella
export async function unitHeadUserIds(unitId) {
  if (!unitId) return [];
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u WHERE u.status='ACTIVE' AND (
      EXISTS (SELECT 1 FROM public.org_positions op WHERE op.unit_id=$1 AND op.is_head AND op.person_id=u.person_id)
      OR EXISTS (SELECT 1 FROM public.org_units ou WHERE ou.id=$1 AND ou.head_person_id=u.person_id))`, [unitId]);
  return rows.map((r) => r.id);
}

// Utenti attivi responsabili della casella o di una casella antenata (per l'indice di ricerca)
export async function chainHeadUserIds(unitId) {
  if (!unitId) return [];
  const rows = await many(`WITH RECURSIVE up AS (SELECT id, parent_id, 0 AS d FROM public.org_units WHERE id=$1 UNION ALL SELECT u.id, u.parent_id, up.d+1 FROM public.org_units u JOIN up ON u.id=up.parent_id WHERE up.d < 12)
    SELECT DISTINCT u.id FROM public.users u WHERE u.status='ACTIVE' AND (
      EXISTS (SELECT 1 FROM public.org_positions op JOIN up ON up.id=op.unit_id WHERE op.is_head AND op.person_id=u.person_id)
      OR EXISTS (SELECT 1 FROM public.org_units ou JOIN up ON up.id=ou.id WHERE ou.head_person_id=u.person_id))`, [unitId]);
  return rows.map((r) => r.id);
}

// Utenti assegnabili per una casella: chi afferisce alla casella o a una sua discendente (afferenza o incarico)
export async function assignableUsers(unitId) {
  return many(`SELECT DISTINCT u.id, u.full_name, u.email, (p.last_name || ' ' || p.first_name) AS person_name
      FROM public.users u JOIN public.people p ON p.id=u.person_id
      WHERE u.status='ACTIVE' AND (p.unit_id IN (SELECT id FROM unit_subtree(ARRAY[$1]::int[]))
        OR EXISTS (SELECT 1 FROM public.org_positions op WHERE op.person_id=p.id AND op.unit_id IN (SELECT id FROM unit_subtree(ARRAY[$1]::int[]))))
      ORDER BY person_name`, [unitId]);
}

export async function unitInfo(unitId) {
  if (!unitId) return null;
  return one(`SELECT u.id, u.name, u.kind, u.parent_id, u.active, org_unit_path(u.id) AS path, org_unit_site(u.id) AS site_id FROM public.org_units u WHERE u.id=$1`, [unitId]);
}
