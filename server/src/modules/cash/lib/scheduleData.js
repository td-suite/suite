// Scadenziario strutture: lettura dei dati dal database e avvisi in app. La logica delle scadenze è in schedule.js (pura).
import { many, one, q } from '../db.js';
import { getSetting, todayRome, eur, itDate } from './util.js';
import { Params, siteScope } from './access.js';
import { buildEvents, kpis, isOverdue } from './schedule.js';
import { notify } from '../../../lib/community.js';

export const WRITE_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];
export const READ_ROLES = [...WRITE_ROLES, 'OPERATOR', 'CASSIERE'];

// Sedi dell'anagrafica visibili all'utente nel modulo (sites_v con il perimetro del profilo): null = tutte
export async function visibleSiteIds(user) {
  if (user.role === 'SUPERADMIN') return null;
  const P = new Params();
  const rows = await many(`SELECT s.id FROM sites_v s WHERE ${siteScope(user, P)}`, P.values);
  return rows.map((r) => r.id);
}

export async function scheduleSettings() {
  return {
    alert_days: Number(await getSetting('schedule_alert_days', '7')) || 7,
    istat_pct: Number(await getSetting('schedule_istat_pct', '1.5')) || 0,
    utility_growth_pct: Number(await getSetting('schedule_utility_growth_pct', '0')) || 0,
    notify_roles: String(await getSetting('schedule_notify_roles', 'SUPERADMIN,ADMIN,FINANCE')).split(',').map((s) => s.trim()).filter(Boolean),
  };
}

// Contratti, scatti, utenze, bollette ed esiti delle sedi indicate (null = tutte), con nome e codice della sede
export async function loadScheduleData(siteIds = null, { includeInactive = false } = {}) {
  const where = (a) => [siteIds ? `${a}.site_id = ANY($1::int[])` : 'TRUE', includeInactive ? 'TRUE' : `${a}.active`].join(' AND ');
  const params = siteIds ? [siteIds] : [];
  const leases = await many(`SELECT l.*, o.name AS landlord_org_name FROM lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id WHERE ${where('l')} ORDER BY l.site_id, l.start_date`, params);
  const utilities = await many(`SELECT u.*, o.name AS supplier_org_name FROM utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id WHERE ${where('u')} ORDER BY u.site_id, u.kind`, params);
  for (const l of leases) if (!l.landlord_name && l.landlord_org_name) l.landlord_name = l.landlord_org_name;
  for (const u of utilities) if (!u.supplier_name && u.supplier_org_name) u.supplier_name = u.supplier_org_name;
  const leaseIds = leases.map((l) => l.id), utilityIds = utilities.map((u) => u.id);
  const steps = leaseIds.length ? await many('SELECT * FROM lease_steps WHERE lease_id = ANY($1::int[]) ORDER BY lease_id, valid_from', [leaseIds]) : [];
  const bills = utilityIds.length ? await many('SELECT * FROM utility_bills WHERE utility_id = ANY($1::int[]) ORDER BY utility_id, due_date', [utilityIds]) : [];
  const done = await many(`SELECT * FROM schedule_done WHERE ${siteIds ? 'site_id = ANY($1::int[]) OR site_id IS NULL' : 'TRUE'}`, params);
  const ids = [...new Set([...leases, ...utilities].map((x) => x.site_id))];
  const sites = ids.length ? await many('SELECT id, code, name, city FROM public.sites WHERE id = ANY($1::int[])', [ids]) : [];
  return { leases, steps, utilities, bills, done, sites };
}

export const siteName = (sites, id) => { const s = sites.find((x) => x.id === id); return s ? s.name : `Sede ${id}`; };

// Contatore per la sidebar: scadute + in scadenza entro 7 giorni (non fatte, non automatiche)
export async function scheduleBadge(user) {
  const siteIds = await visibleSiteIds(user);
  if (siteIds && !siteIds.length) return 0;
  const data = await loadScheduleData(siteIds);
  const today = todayRome();
  const events = buildEvents({ ...data, today });
  return events.filter((e) => isOverdue(e) || (e.days >= 0 && e.days <= 7 && !e.done && !e.auto)).length;
}

export { kpis };

// Avvisi in app: scadenze dei prossimi schedule_alert_days giorni e scadute non segnate, una sola notifica per evento.
// Destinatari: utenti della Suite con grant cash nei profili schedule_notify_roles (operators_v); i profili con perimetro di sede
// (OPERATOR, CASSIERE) ricevono solo le scadenze delle proprie sedi. Con SUPERADMIN tra i profili ricevono anche i titolari e
// gli amministratori della Suite senza grant (sono SUPERADMIN del modulo, vedi roleFor in index.js).
export async function runScheduleAlerts() {
  const s = await scheduleSettings();
  const today = todayRome();
  const data = await loadScheduleData(null);
  const events = buildEvents({ ...data, today }).filter((e) => !e.done && !e.auto && e.days <= s.alert_days);
  if (!events.length) return { date: today, events: 0, sent: 0 };
  const already = new Set((await many('SELECT event_key FROM schedule_notified WHERE event_key = ANY($1::text[])', [events.map((e) => e.key)])).map((r) => r.event_key));
  const todo = events.filter((e) => !already.has(e.key));
  if (!todo.length) return { date: today, events: events.length, sent: 0 };
  const roles = s.notify_roles;
  const ops = roles.length ? await many(`SELECT id, role, company_id, site_ids FROM operators_v WHERE active AND role = ANY($1::text[])`, [roles]) : [];
  const admins = roles.includes('SUPERADMIN') ? await many(`SELECT id FROM public.users WHERE status='ACTIVE' AND level IN ('OWNER','ADMIN')`) : [];
  const companyOf = new Map((await many('SELECT site_id, company_id FROM site_ext')).map((r) => [r.site_id, r.company_id]));
  let sent = 0;
  for (const e of todo) {
    const ids = new Set(admins.map((a) => a.id));
    for (const o of ops) {
      if (o.role === 'SUPERADMIN') ids.add(o.id);
      else if (['ADMIN', 'FINANCE'].includes(o.role)) { if (companyOf.get(e.site_id) === o.company_id) ids.add(o.id); }
      else if ((o.site_ids || []).includes(e.site_id)) ids.add(o.id);
    }
    const site = siteName(data.sites, e.site_id);
    const when = e.days < 0 ? `scaduta il ${itDate(e.date)} (${-e.days} giorni fa)` : e.days === 0 ? 'scade oggi' : `scade il ${itDate(e.date)} (tra ${e.days} giorni)`;
    const body = [e.amount != null ? `${e.estimate ? 'Importo stimato ' : 'Importo '}${eur(e.amount)}` : null, when, e.desc || null].filter(Boolean).join(' · ');
    sent += await notify([...ids], { kind: 'INFO', module_key: 'cash', title: `Scadenza: ${e.title} · ${site}`, body, link: `/cash/scadenziario?site_id=${e.site_id}` });
    await q('INSERT INTO schedule_notified (event_key) VALUES ($1) ON CONFLICT (event_key) DO NOTHING', [e.key]);
  }
  return { date: today, events: events.length, notified: todo.length, sent };
}

// Se una scadenza viene tolta dalle "fatte" l'avviso non si ripete: resta in schedule_notified. Pulizia dei record più vecchi di un anno.
export async function pruneScheduleNotified() {
  const r = await q(`DELETE FROM schedule_notified WHERE notified_at < now() - interval '400 days'`);
  return r.rowCount;
}

export async function hasSchedule() { return !!(await one('SELECT 1 FROM lease_contracts LIMIT 1')) || !!(await one('SELECT 1 FROM utilities LIMIT 1')); }
