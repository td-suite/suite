// Suite TD · funzioni di supporto per Community: notifiche, risoluzione dell'audience in utenti, frase del giorno,
// protocollo delle circolari e lavori di sfondo (frase del giorno, promemoria di presa visione).
import { q, one, many } from '../db.js';
import { config } from '../config.js';
import { today, getSetting } from './util.js';
import { aiEnabled, generateQuotes } from './claude.js';

// Normalizza un'audience per renderla compatibile con audienceSql di lib/audience.js:
// SITES e ORGS con id in forma di stringa (operatore ?| su jsonb), USERS con id numerici (operatore @> to_jsonb(int))
export function normalizeAudience(a) {
  if (!a || typeof a !== 'object' || !a.type) return { type: 'ALL' };
  switch (a.type) {
    case 'ALL': case 'INTERNAL': return { type: a.type };
    case 'SITES': case 'ORGS': return { type: a.type, ids: [...new Set((a.ids || []).map((x) => String(Number(x))).filter((x) => x !== 'NaN'))] };
    case 'USERS': return { type: 'USERS', ids: [...new Set((a.ids || []).map(Number).filter(Number.isInteger))] };
    case 'MODULE': return { type: 'MODULE', key: String(a.key || '') };
    default: return { type: 'ALL' };
  }
}

// Utenti attivi che rientrano in un'audience (speculare a canSee: gli amministratori vedono tutto)
export async function audienceUsers(audience) {
  const a = normalizeAudience(audience);
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const admin = `u.level IN ('OWNER','ADMIN')`;
  let cond = 'TRUE';
  switch (a.type) {
    case 'INTERNAL':
      cond = `(${admin} OR o.kind IN ('GRUPPO','SOCIETA') OR lower(split_part(u.email,'@',2)) = ANY(${p(config.autoInternalDomains)}::text[]))`; break;
    case 'SITES': {
      const ids = a.ids.map(Number);
      cond = `(${admin} OR u.site_id = ANY(${p(ids)}::int[]) OR EXISTS (SELECT 1 FROM grants g JOIN grant_scopes gs ON gs.grant_id=g.id WHERE g.user_id=u.id AND NOT g.proposed AND gs.scope_type='SITE' AND gs.scope_id = ANY(${p(ids)}::int[])))`; break;
    }
    case 'ORGS': {
      const ids = a.ids.map(Number);
      cond = `(${admin} OR u.organization_id = ANY(${p(ids)}::int[]) OR EXISTS (SELECT 1 FROM grants g JOIN grant_scopes gs ON gs.grant_id=g.id WHERE g.user_id=u.id AND NOT g.proposed AND gs.scope_type='ORG' AND gs.scope_id = ANY(${p(ids)}::int[])))`; break;
    }
    case 'MODULE':
      cond = `(${admin} OR EXISTS (SELECT 1 FROM grants g JOIN modules m ON m.key=g.module_key WHERE g.user_id=u.id AND NOT g.proposed AND m.active AND g.module_key = ${p(a.key)}))`; break;
    case 'USERS':
      cond = `u.id = ANY(${p(a.ids)}::int[])`; break;
    default: cond = 'TRUE';
  }
  return many(`SELECT u.id, u.email, u.full_name, u.notify_email FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.status='ACTIVE' AND ${cond} ORDER BY u.id`, params);
}

// Notifica in app a un insieme di utenti (inserimento in blocco)
export async function notify(userIds, { kind = 'INFO', module_key = null, title, body = null, link = null }, client) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length || !title) return 0;
  const runner = client ? client.query.bind(client) : q;
  const r = await runner(
    `INSERT INTO notifications (user_id, kind, module_key, title, body, link)
     SELECT uid, $2, $3, $4, $5, $6 FROM unnest($1::int[]) AS uid`, [ids, kind, module_key, String(title).slice(0, 200), body ? String(body).slice(0, 1000) : null, link]);
  return r.rowCount;
}

export const adminUserIds = async () => (await many(`SELECT id FROM users WHERE status='ACTIVE' AND level IN ('OWNER','ADMIN')`)).map((u) => u.id);

// Frase del giorno: quella assegnata a oggi; se manca, pubblica la prima APPROVED (ordine di creazione) e la assegna a oggi
export async function ensureDailyQuote() {
  const d = today();
  const cur = await one(`UPDATE quotes SET status='PUBLISHED' WHERE for_date=$1 AND status<>'PUBLISHED' RETURNING id, text, author_label, theme, for_date`, [d])
    || await one('SELECT id, text, author_label, theme, for_date FROM quotes WHERE for_date=$1', [d]);
  if (cur) return cur;
  // for_date è UNIQUE: se due richieste arrivano insieme la seconda fallisce con 23505 e rilegge quella pubblicata
  try {
    return await one(
      `WITH pick AS (SELECT id FROM quotes WHERE status='APPROVED' AND for_date IS NULL ORDER BY created_at, id LIMIT 1)
       UPDATE quotes SET status='PUBLISHED', for_date=$1 FROM pick WHERE quotes.id=pick.id
       RETURNING quotes.id, quotes.text, quotes.author_label, quotes.theme, quotes.for_date`, [d]);
  } catch (e) {
    if (e.code === '23505') return one('SELECT id, text, author_label, theme, for_date FROM quotes WHERE for_date=$1', [d]);
    throw e;
  }
}

// Protocollo progressivo per anno: CIRC-AAAA-NNN. Da chiamare dentro una transazione (client) perché usa un blocco consultivo
export async function nextProtocol(prefix = 'CIRC', client) {
  const runner = client ? client.query.bind(client) : q;
  const year = today().slice(0, 4);
  await runner('SELECT pg_advisory_xact_lock(hashtext($1))', [`protocol:${prefix}:${year}`]).catch(() => {});
  const r = await runner(`SELECT max(NULLIF(regexp_replace(protocol, '^' || $1 || '-' || $2 || '-', ''), '')::int) AS n FROM news WHERE protocol ~ ('^' || $1 || '-' || $2 || '-[0-9]+$')`, [prefix, year]);
  const n = (r.rows[0]?.n || 0) + 1;
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

// ---- Lavori di sfondo
async function dailyQuoteJob() {
  const quote = await ensureDailyQuote();
  if (quote) return { published: quote.id };
  const pending = await one(`SELECT count(*)::int AS n FROM quotes WHERE status IN ('APPROVED','PROPOSED')`);
  if (pending.n > 0) return { published: null, pending: pending.n };
  if (!aiEnabled()) return { published: null, generated: 0, reason: 'AI non configurata' };
  const values = await getSetting('community.values', []);
  const quotes = await generateQuotes(values, 7);
  for (const x of quotes) await q('INSERT INTO quotes (text, author_label, theme, status) VALUES ($1,$2,$3,\'PROPOSED\')', [x.text, x.author_label, x.theme]);
  if (quotes.length) {
    await notify(await adminUserIds(), { kind: 'MODULO', module_key: 'comunicazione', title: 'Frasi del giorno da approvare',
      body: `Sono state proposte ${quotes.length} nuove frasi del giorno. Approvale nella sezione Comunicazione per pubblicarle.`, link: '/community/manage/quotes' });
  }
  return { published: null, generated: quotes.length };
}

async function ackRemindersJob() {
  const rows = await many(
    `SELECT id, title, slug, protocol, audience, ack_due FROM news
      WHERE status='PUBLISHED' AND requires_ack AND ack_due IS NOT NULL AND ack_due <= (CURRENT_DATE + 3) AND ack_due >= (CURRENT_DATE - 30)`);
  let sent = 0;
  for (const n of rows) {
    const users = await audienceUsers(n.audience);
    const acked = new Set((await many('SELECT user_id FROM news_acks WHERE news_id=$1', [n.id])).map((a) => a.user_id));
    const link = `/community/news/${n.slug}`;
    const recent = new Set((await many(`SELECT user_id FROM notifications WHERE link=$1 AND kind='CIRCOLARE' AND title LIKE 'Promemoria%' AND created_at > now() - interval '2 days'`, [link])).map((a) => a.user_id));
    const targets = users.filter((u) => !acked.has(u.id) && !recent.has(u.id)).map((u) => u.id);
    if (!targets.length) continue;
    const due = new Date(n.ack_due).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
    sent += await notify(targets, { kind: 'CIRCOLARE', module_key: 'comunicazione', title: `Promemoria: presa visione ${n.protocol || 'circolare'}`,
      body: `La circolare "${n.title}" richiede la tua presa visione entro il ${due}.`, link });
  }
  return { circolari: rows.length, promemoria: sent };
}

export function registerCommunityJobs(registerJob) {
  registerJob('community:daily-quote', 60, dailyQuoteJob, { runAtStart: true });
  registerJob('community:ack-reminders', 720, ackRemindersJob, { runAtStart: false });
}
