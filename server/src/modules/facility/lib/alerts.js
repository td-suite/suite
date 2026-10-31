// Job giornaliero `facility:scadenze` (solo con modulo LIVE; DISABLE_SCHEDULER lo ferma come gli altri job della Suite):
//  1. le scadenze pianificate con data passata diventano SCADUTA;
//  2. promemoria a 30, 7 e 0 giorni (impostazione reminder_days), mai doppi (plan_reminders con chiave scadenza+stadio): una notifica in
//     app per sede e stadio a Facility e ai site manager della sede, con l'elenco delle scadenze; email se il mailer è configurato;
//  3. attività per sede dalla fonte impostata (Retail o Cash), senza toccare le righe manuali;
//  4. anomalie dei consumi degli ultimi sei mesi notificate a Facility una volta sola per utenza e mese.
// `today` è un parametro (collaudo con data forzata, solo fuori produzione dalla route).
import { q, many } from '../db.js';
import { KEY } from '../config.js';
import { config as appConfig } from '../../../config.js';
import { notify } from '../../../lib/community.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { settings, facilityUserIds, siteManagerUserIds, todayRome, financeLive } from './core.js';
import { reminderStage, daysBetween, addDays, addMonths, monthKey } from './calc.js';
import { syncActivity } from './activity.js';
import { loadEnergyData } from './energy.js';
import { anomalies } from './calc.js';

const STAGE_TITLE = { D30: 'entro 30 giorni', D7: 'entro 7 giorni', D0: 'scadute o in scadenza oggi' };
const itDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('it-IT');

export async function runScadenze({ today, dryRun = false } = {}) {
  const oggi = today || todayRome();
  const imp = await settings();
  const ths = (Array.isArray(imp.reminder_days) ? imp.reminder_days : [30, 7, 0]).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const maxT = Math.max(...ths, 0);
  // 1. scadute
  const scadute = dryRun ? { rowCount: 0 } : await q(`UPDATE maintenance_plans SET status='SCADUTA', updated_at=now() WHERE status='PIANIFICATA' AND due_date < $1::date`, [oggi]);
  // (e tornano pianificate quelle spostate in avanti)
  if (!dryRun) await q(`UPDATE maintenance_plans SET status='PIANIFICATA', updated_at=now() WHERE status='SCADUTA' AND due_date >= $1::date`, [oggi]);
  // 2. promemoria
  const open = await many(`SELECT p.id, p.site_id, p.title, p.due_date, p.performer, s.name AS site_name FROM maintenance_plans p JOIN public.sites s ON s.id=p.site_id
    WHERE p.status IN ('PIANIFICATA','SCADUTA') AND p.due_date <= $1::date ORDER BY p.due_date`, [addDays(oggi, maxT)]);
  const sent = await many('SELECT plan_id, stage FROM plan_reminders WHERE plan_id = ANY($1::int[])', [open.map((p) => p.id)]);
  const sentBy = new Map();
  for (const s of sent) { if (!sentBy.has(s.plan_id)) sentBy.set(s.plan_id, []); sentBy.get(s.plan_id).push(s.stage); }
  const groups = new Map();   // site:stage → { site, stage, plans, mark }
  for (const p of open) {
    const st = reminderStage(daysBetween(oggi, p.due_date), sentBy.get(p.id) || [], ths);
    if (!st) continue;
    const k = `${p.site_id}:${st.stage}`;
    if (!groups.has(k)) groups.set(k, { site_id: p.site_id, site_name: p.site_name, stage: st.stage, plans: [] });
    groups.get(k).plans.push({ ...p, mark: st.mark });
  }
  const facility = await facilityUserIds();
  let notifiche = 0, email = 0;
  const dettaglio = [];
  for (const g of groups.values()) {
    const dest = new Set(facility);
    if (imp.notify_site_managers !== false) for (const id of await siteManagerUserIds(g.site_id)) dest.add(id);
    dettaglio.push({ site_id: g.site_id, stage: g.stage, scadenze: g.plans.length, destinatari: dest.size });
    if (dryRun) continue;
    const title = `Scadenze Facility ${STAGE_TITLE[g.stage] || ''} · ${g.site_name}: ${g.plans.length}`;
    const elenco = g.plans.slice(0, 6).map((p) => `${p.title} (${itDate(p.due_date)})`).join('; ');
    const body = `${elenco}${g.plans.length > 6 ? ` e altre ${g.plans.length - 6}` : ''}.`;
    notifiche += await notify([...dest], { kind: 'MODULO', module_key: KEY, title, body, link: `/facility/piano?site_id=${g.site_id}` });
    for (const p of g.plans) for (const m of p.mark) await q('INSERT INTO plan_reminders (plan_id, stage, users) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p.id, m, dest.size]);
    if (appConfig.mail.provider && ['D7', 'D0'].includes(g.stage)) {
      const users = await many(`SELECT email FROM public.users WHERE id = ANY($1::int[]) AND status='ACTIVE' AND notify_email IS NOT FALSE AND email IS NOT NULL`, [[...dest]]);
      if (users.length) {
        const html = layout(title, `<p>${body}</p><p><a href="${appConfig.baseUrl}/facility/piano?site_id=${g.site_id}">Apri il piano delle manutenzioni</a></p><p style="color:#5b6f75;font-size:12px">Promemoria automatico del modulo Facility e Manutenzioni.</p>`);
        const r = await sendMail({ to: users.map((u) => u.email), subject: title, html, ref: `facility:scadenze:${g.site_id}:${g.stage}:${oggi}` }).catch(() => ({ ok: false }));
        if (r.ok) email += users.length;
      }
    }
  }
  // 3. attività
  let attivita = null;
  if (!dryRun && imp.activity_source !== 'MANUALE') attivita = await syncActivity(imp.activity_source).catch((e) => ({ error: e.message }));
  // 4. anomalie recenti
  let anomalieNotificate = 0;
  if (!dryRun && await financeLive()) {
    const data = await loadEnergyData();
    const from = monthKey(addMonths(oggi, -6));   // le bollette trimestrali arrivano dopo il periodo: finestra di sei mesi
    const done = new Set((await many('SELECT key FROM anomaly_notified')).map((x) => x.key));
    for (const u of data.utilities) {
      const series = Object.fromEntries(Object.entries(u.monthly).map(([k, v]) => [k, v.qty]));
      for (const a of anomalies(series, { pct: Number(imp.anomaly_pct) || 20 })) {
        const key = `${u.id}:${a.month}`;
        if (a.month < from || done.has(key)) continue;
        const site = data.sites.find((s) => s.id === u.site_id);
        anomalieNotificate += await notify(facility, { kind: 'MODULO', module_key: KEY, title: `Anomalia dei consumi: ${u.vector.toLowerCase()} · ${site?.name || 'sede'}`,
          body: `${a.month}: ${a.value} ${u.unit} (+${a.delta_pct}% rispetto a ${a.ref_kind === 'ANNO_PRECEDENTE' ? 'stesso mese dell\'anno prima' : 'media dei tre mesi precedenti'}).`, link: `/facility/energia?site_id=${u.site_id}` });
        await q('INSERT INTO anomaly_notified (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
      }
    }
  }
  console.log(`[facility:scadenze] ${oggi}: ${scadute.rowCount} scadute, ${groups.size} gruppi di promemoria, ${notifiche} notifiche, ${email} email`);   // solo conteggi
  return { giorno: oggi, scadute: scadute.rowCount, gruppi: groups.size, notifiche, email, dettaglio, attivita, anomalie_notificate: anomalieNotificate };
}
