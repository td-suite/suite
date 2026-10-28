// Scadenziario strutture (Payments): lettura dei dati dal database, badge, avvisi in app e aggancio alle istanze di pagamento.
// La logica delle scadenze è in schedule.js (pura). Payments non ha un perimetro di sedi per utente: tutti gli utenti del modulo
// leggono tutto; scrivono SUPPORT e amministratori (canManage), CEO e CFO possono segnare gli esiti.
import { many, one, q } from '../db.js';
import { getSetting, todayRome, eur, itDate } from './util.js';
import { buildEvents, kpis, isOverdue } from './schedule.js';
import { notify } from '../../../lib/community.js';

export const EVENT_KEY_RE = /^(canone|istat|registro|fine|disdetta|bolletta|offerta):(lease|utility):(\d+):(\d{4}-\d{2}-\d{2})$/;

export async function scheduleSettings() {
  return {
    alert_days: Number(await getSetting('schedule_alert_days', '7')) || 7,
    istat_pct: Number(await getSetting('schedule_istat_pct', '1.5')) || 0,
    utility_growth_pct: Number(await getSetting('schedule_utility_growth_pct', '0')) || 0,
    notify_roles: String(await getSetting('schedule_notify_roles', 'CEO,CFO,SUPPORT')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  };
}

// Contratti, scatti, utenze, bollette, esiti e istanze collegate (sedi indicate o tutte), con nome e codice della sede
export async function loadScheduleData(siteIds = null, { includeInactive = false } = {}) {
  const where = (a) => [siteIds ? `${a}.site_id = ANY($1::int[])` : 'TRUE', includeInactive ? 'TRUE' : `${a}.active`].join(' AND ');
  const params = siteIds ? [siteIds] : [];
  const leases = await many(`SELECT l.*, o.name AS landlord_org_name, b.name AS beneficiary_name FROM lease_contracts l
    LEFT JOIN public.organizations o ON o.id=l.landlord_org_id LEFT JOIN beneficiaries b ON b.id=l.beneficiary_id WHERE ${where('l')} ORDER BY l.site_id, l.start_date`, params);
  const utilities = await many(`SELECT u.*, o.name AS supplier_org_name, b.name AS beneficiary_name FROM utilities u
    LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN beneficiaries b ON b.id=u.beneficiary_id WHERE ${where('u')} ORDER BY u.site_id, u.kind`, params);
  for (const l of leases) if (!l.landlord_name && l.landlord_org_name) l.landlord_name = l.landlord_org_name;
  for (const u of utilities) if (!u.supplier_name && u.supplier_org_name) u.supplier_name = u.supplier_org_name;
  const leaseIds = leases.map((l) => l.id), utilityIds = utilities.map((u) => u.id);
  const steps = leaseIds.length ? await many('SELECT * FROM lease_steps WHERE lease_id = ANY($1::int[]) ORDER BY lease_id, valid_from', [leaseIds]) : [];
  const bills = utilityIds.length ? await many('SELECT * FROM utility_bills WHERE utility_id = ANY($1::int[]) ORDER BY utility_id, due_date', [utilityIds]) : [];
  const done = await many(`SELECT * FROM schedule_done WHERE ${siteIds ? 'site_id = ANY($1::int[]) OR site_id IS NULL' : 'TRUE'}`, params);
  const requests = await many(`SELECT sr.event_key, sr.request_id, p.protocol, p.status, p.amount FROM schedule_requests sr JOIN payment_requests p ON p.id=sr.request_id`);
  const ids = [...new Set([...leases, ...utilities].map((x) => x.site_id))];
  const sites = ids.length ? await many('SELECT id, code, name, city FROM public.sites WHERE id = ANY($1::int[])', [ids]) : [];
  return { leases, steps, utilities, bills, done, requests, sites };
}

export const siteName = (sites, id) => { const s = sites.find((x) => x.id === id); return s ? s.name : `Sede ${id}`; };

// Contatore per la sidebar: scadute + in scadenza entro 7 giorni (non fatte, non automatiche)
export async function scheduleBadge() {
  const data = await loadScheduleData(null);
  if (!data.leases.length && !data.utilities.length) return 0;
  const events = buildEvents({ ...data, today: todayRome() });
  return events.filter((e) => isOverdue(e) || (e.days >= 0 && e.days <= 7 && !e.done && !e.auto)).length;
}

// Riquadro "Scadenze strutture" del cruscotto di Payments
export async function scheduleSummary() {
  const data = await loadScheduleData(null);
  const today = todayRome();
  const events = buildEvents({ ...data, today });
  const k = kpis({ events, leases: data.leases, steps: data.steps, utilities: data.utilities, today });
  const next = events.filter((e) => e.days >= 0 && e.days <= 30 && !e.done && !e.auto).slice(0, 5)
    .map((e) => ({ key: e.key, date: e.date, title: e.title, site_name: siteName(data.sites, e.site_id), amount: e.amount, estimate: e.estimate, request: e.request }));
  return { overdue: k.overdue, overdue_amount: k.overdue_amount, next30: k.next30, next30_amount: k.next30_amount, transfers_open: k.transfers_open, monthly_rent: k.monthly_rent, leases_active: k.leases_active, utilities_active: k.utilities_active, next };
}

export { kpis };

// Destinatari degli avvisi: utenti attivi della Suite con grant finance nei profili indicati (public.grants); con SUPPORT tra i profili
// anche titolari e amministratori della Suite senza grant (sono amministratori del modulo, is_admin). Le notifiche in app sono per
// utente Suite (public.users.id), diversamente dai solleciti di firma di runReminders che partono per email ai firmatari.
export async function alertRecipients(roles) {
  if (!roles.length) return [];
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u
    WHERE u.status='ACTIVE' AND (
      EXISTS (SELECT 1 FROM public.grants g WHERE g.user_id=u.id AND g.module_key='finance' AND NOT g.proposed AND g.profile = ANY($1::text[]))
      OR ($2 AND u.level IN ('OWNER','ADMIN')))`, [roles, roles.includes('SUPPORT')]);
  return rows.map((r) => r.id);
}

// Avvisi in app: scadenze dei prossimi schedule_alert_days giorni e scadute non segnate, una sola notifica per evento.
export async function runScheduleAlerts() {
  const s = await scheduleSettings();
  const today = todayRome();
  const data = await loadScheduleData(null);
  const events = buildEvents({ ...data, today }).filter((e) => !e.done && !e.auto && e.days <= s.alert_days);
  if (!events.length) return { date: today, events: 0, sent: 0 };
  const already = new Set((await many('SELECT event_key FROM schedule_notified WHERE event_key = ANY($1::text[])', [events.map((e) => e.key)])).map((r) => r.event_key));
  const todo = events.filter((e) => !already.has(e.key));
  if (!todo.length) return { date: today, events: events.length, sent: 0 };
  const ids = await alertRecipients(s.notify_roles);
  let sent = 0;
  for (const e of todo) {
    const site = siteName(data.sites, e.site_id);
    const when = e.days < 0 ? `scaduta il ${itDate(e.date)} (${-e.days} giorni fa)` : e.days === 0 ? 'scade oggi' : `scade il ${itDate(e.date)} (tra ${e.days} giorni)`;
    const body = [e.amount != null ? `${e.estimate ? 'Importo stimato ' : 'Importo '}${eur(e.amount)}` : null, when, e.request ? `istanza ${e.request.protocol || `n. ${e.request.id}`} ${String(e.request.status || '').toLowerCase()}` : null, e.desc || null].filter(Boolean).join(' · ');
    sent += await notify(ids, { kind: 'INFO', module_key: 'finance', title: `Scadenza: ${e.title} · ${site}`, body, link: `/finance/scadenziario?site_id=${e.site_id}` });
    await q('INSERT INTO schedule_notified (event_key) VALUES ($1) ON CONFLICT (event_key) DO NOTHING', [e.key]);
  }
  return { date: today, events: events.length, notified: todo.length, recipients: ids.length, sent };
}

export async function pruneScheduleNotified() {
  const r = await q(`DELETE FROM schedule_notified WHERE notified_at < now() - interval '400 days'`);
  return r.rowCount;
}

// ---- Aggancio alle istanze di pagamento (chiamato da routes/requests.js e routes/sign.js al cambio di stato) ----
// ESEGUITA: la scadenza collegata viene segnata fatta (importo eseguito, nota con protocollo e data).
// ANNULLATA o RIFIUTATA: il collegamento cade e la scadenza torna aperta (anche se era stata chiusa da quell'istanza).
export async function onRequestStatus(requestId, status, { client, userId = null } = {}) {
  const run = client ? client.query.bind(client) : q;
  const links = (await run('SELECT event_key FROM schedule_requests WHERE request_id=$1', [requestId])).rows;
  if (!links.length) return 0;
  if (status === 'ESEGUITA') {
    const p = (await run('SELECT id, protocol, amount, executed_at FROM payment_requests WHERE id=$1', [requestId])).rows[0];
    for (const l of links) {
      const m = l.event_key.match(EVENT_KEY_RE);
      const siteId = m ? (await run(`SELECT site_id FROM ${m[2] === 'lease' ? 'lease_contracts' : 'utilities'} WHERE id=$1`, [Number(m[3])])).rows[0]?.site_id ?? null : null;
      await run(`INSERT INTO schedule_done (event_key, site_id, user_id, note, amount, request_id) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (event_key) DO UPDATE SET done_at=now(), user_id=EXCLUDED.user_id, note=EXCLUDED.note, amount=EXCLUDED.amount, request_id=EXCLUDED.request_id`,
      [l.event_key, siteId, userId, `Istanza ${p.protocol || `n. ${p.id}`} eseguita il ${itDate(p.executed_at || todayRome())}`, p.amount, p.id]);
      if (m && m[1] === 'bolletta' && m[2] === 'utility') await run('UPDATE utility_bills SET paid_at=coalesce(paid_at, $3::date) WHERE utility_id=$1 AND due_date=$2::date', [Number(m[3]), m[4], p.executed_at || todayRome()]);
    }
    return links.length;
  }
  if (status === 'ANNULLATA' || status === 'RIFIUTATA') {
    await run('DELETE FROM schedule_done WHERE request_id=$1', [requestId]);
    await run('DELETE FROM schedule_requests WHERE request_id=$1', [requestId]);
    return links.length;
  }
  return 0;
}

export async function hasSchedule() { return !!(await one('SELECT 1 FROM lease_contracts LIMIT 1')) || !!(await one('SELECT 1 FROM utilities LIMIT 1')); }
