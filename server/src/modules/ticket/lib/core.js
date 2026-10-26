// Funzioni comuni del modulo Ticket: protocollo, SLA, impostazioni, eventi, notifiche, lettura del ticket con i nomi dell'anagrafica.
import { q, one, many } from '../db.js';
import { config } from '../config.js';
import { notify } from '../../../lib/community.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { upsertIndex, removeFromIndex } from '../../../lib/search.js';
import { chainHeadUserIds } from './access.js';

export const KEY = 'ticket';
export const STATI = ['APERTO', 'IN_CORSO', 'IN_ATTESA', 'RISOLTO', 'CHIUSO', 'ANNULLATO'];
export const PRIORITA = ['P1', 'P2', 'P3', 'P4'];
export const STATO_LABEL = { APERTO: 'Aperto', IN_CORSO: 'In corso', IN_ATTESA: 'In attesa', RISOLTO: 'Risolto', CHIUSO: 'Chiuso', ANNULLATO: 'Annullato' };
export const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Protocollo TK-AAAA/NNNN: progressivo annuale assegnato dal database in transazione
export const formatProtocollo = (anno, numero) => `${config.protocolPrefix}-${anno}/${String(numero).padStart(4, '0')}`;
export async function nextNumero(client, anno) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ticket:protocollo:${anno}`]);
  const r = await client.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM tickets WHERE anno = $1', [anno]);
  return Number(r.rows[0].n);
}

// ---- Impostazioni
const DEFAULTS = { chiusura_automatica_giorni: 7, escalation_attiva: true, max_aperture_giorno: 20, avviso_privacy: '', avviso_riservato: '' };
export async function settings() {
  const rows = await many('SELECT key, value FROM impostazioni');
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function setSetting(key, value) {
  await q('INSERT INTO impostazioni (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}

// ---- SLA: scadenze dalla priorità; il tempo in attesa sposta in avanti la scadenza di risoluzione
export async function slaFor(priorita, runner = q) {
  const r = await runner('SELECT * FROM sla WHERE priorita=$1', [priorita]);
  return r.rows[0] || { prima_risposta_ore: 48, risoluzione_ore: 240 };
}
export async function slaDeadlines(priorita, createdAt, attesaSecondi = 0, runner = q) {
  const s = await slaFor(priorita, runner);
  const base = new Date(createdAt).getTime();
  return {
    risposta: new Date(base + s.prima_risposta_ore * 3600_000),
    risoluzione: new Date(base + s.risoluzione_ore * 3600_000 + (attesaSecondi || 0) * 1000),
  };
}

// ---- Eventi (cronologia). user_id NULL = sistema
export async function evento(ticketId, tipo, userId, dati = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  await runner('INSERT INTO eventi (ticket_id, tipo, user_id, dati) VALUES ($1,$2,$3,$4)', [ticketId, tipo, userId || null, JSON.stringify(dati || {})]);
}

// ---- Notifiche: in app (notify della Suite) + email a chi la vuole. Per i riservati nelle email solo protocollo e link.
export async function notifica(userIds, t, { evento: ev, title, body, exclude = [] }) {
  const ids = [...new Set((userIds || []).map(Number).filter((x) => Number.isInteger(x) && !exclude.includes(x)))];
  if (!ids.length) return 0;
  const link = `/ticket/${t.id}`;
  const safeBody = t.riservato ? null : body || null;
  await notify(ids, { kind: 'TICKET', module_key: KEY, title: `${t.protocollo} · ${title}`, body: safeBody, link });
  const users = await many(`SELECT id, email, full_name FROM public.users WHERE id = ANY($1::int[]) AND status='ACTIVE' AND notify_email AND email IS NOT NULL`, [ids]);
  const url = `${config.baseUrl}${link}`;
  const subject = t.riservato ? `Ticket ${t.protocollo}: ${title}` : `Ticket ${t.protocollo}: ${title} · ${t.titolo}`;
  const html = layout(`Ticket ${t.protocollo}`, t.riservato
    ? `<p>${escapeHtml(title)}.</p><p>Il ticket è riservato: il contenuto si legge solo nella Suite.</p><p><a href="${url}">Apri il ticket</a></p>`
    : `<p><b>${escapeHtml(t.titolo)}</b></p><p>${escapeHtml(title)}${body ? `: ${escapeHtml(body).slice(0, 1500)}` : ''}</p><p>Priorità ${escapeHtml(t.priorita)} · stato ${escapeHtml(STATO_LABEL[t.stato] || t.stato)}</p><p><a href="${url}">Apri il ticket</a></p>`);
  for (const u of users) {
    try { await sendMail({ to: u.email, subject, html, ref: `ticket:${t.id}:${ev}` }); } catch (e) { console.error('[ticket:mail]', e.message); }
  }
  return ids.length;
}

// ---- Lettura con i nomi dell'anagrafica unica (nessuna copia: join su public.*)
export const T_COLS = `t.*, c.nome AS categoria_nome, c.riservata AS categoria_riservata,
  u.name AS unit_nome, u.kind AS unit_kind, org_unit_path(u.id) AS unit_path, u.parent_id AS unit_parent_id,
  eu.name AS escalation_unit_nome, org_unit_path(eu.id) AS escalation_unit_path,
  ru.full_name AS richiedente_nome, ru.email AS richiedente_email,
  au.full_name AS assegnatario_nome,
  s.name AS per_conto_site_nome, s.code AS per_conto_site_code, o.name AS per_conto_org_nome,
  (SELECT coalesce(array_agg(os.user_id), '{}') FROM osservatori os WHERE os.ticket_id=t.id) AS osservatori_ids,
  (SELECT count(*)::int FROM allegati a WHERE a.ticket_id=t.id) AS n_allegati,
  (SELECT count(*)::int FROM commenti cm WHERE cm.ticket_id=t.id AND NOT cm.interno) AS n_commenti`;
export const T_FROM = `tickets t LEFT JOIN categorie c ON c.id=t.categoria_id JOIN public.org_units u ON u.id=t.unit_id
  LEFT JOIN public.org_units eu ON eu.id=t.escalation_unit_id LEFT JOIN public.users ru ON ru.id=t.richiedente_user_id
  LEFT JOIN public.users au ON au.id=t.assegnatario_user_id LEFT JOIN public.sites s ON s.id=t.per_conto_site_id
  LEFT JOIN public.organizations o ON o.id=t.per_conto_org_id`;

export async function loadTicket(id, runner = q) {
  const r = await runner(`SELECT ${T_COLS} FROM ${T_FROM} WHERE t.id=$1`, [id]);
  return r.rows[0] || null;
}

// Rappresentazione pubblica: toglie i campi tecnici e applica "Riservato" al nome quando serve
export function pubTicket(t, { seesName = true } = {}) {
  const { fts, ...rest } = t;
  const out = { ...rest, per_conto: t.per_conto_site_nome ? `${t.per_conto_site_nome}` : t.per_conto_org_nome || null };
  if (!seesName) { out.richiedente_nome = 'Riservato'; out.richiedente_email = null; out.richiedente_person_id = null; }
  const now = Date.now();
  out.sla_risposta_in_ritardo = !t.prima_risposta_at && ['APERTO', 'IN_CORSO'].includes(t.stato) && new Date(t.sla_risposta_scadenza).getTime() < now;
  out.sla_risoluzione_in_ritardo = !t.risolto_at && ['APERTO', 'IN_CORSO'].includes(t.stato) && new Date(t.sla_risoluzione_scadenza).getTime() < now;
  return out;
}

// ---- Indice di ricerca della Suite: solo ticket non riservati, audience ristretta a chi li vede (USERS)
export async function indexTicket(t) {
  if (!t) return;
  if (t.riservato || t.stato === 'ANNULLATO') { await removeFromIndex('ticket', `ticket:${t.id}`); return; }
  const heads = await chainHeadUserIds(t.unit_id);
  const esc = t.escalation_unit_id ? await chainHeadUserIds(t.escalation_unit_id) : [];
  const ids = [...new Set([t.richiedente_user_id, t.assegnatario_user_id, ...(t.osservatori_ids || []), ...heads, ...esc].filter(Boolean))];
  await upsertIndex({ kind: 'ticket', ref_id: `ticket:${t.id}`, module_key: KEY, title: `${t.protocollo} · ${t.titolo}`, body: [t.descrizione, t.categoria_nome, t.unit_path, STATO_LABEL[t.stato]].filter(Boolean).join('\n'), link: `/ticket/${t.id}`, audience: { type: 'USERS', ids }, sensitive: false });
}
export async function reindexTickets() {
  const rows = await many(`SELECT ${T_COLS} FROM ${T_FROM}`);
  for (const t of rows) await indexTicket(t);
  return { tickets: rows.filter((t) => !t.riservato && t.stato !== 'ANNULLATO').length };
}
