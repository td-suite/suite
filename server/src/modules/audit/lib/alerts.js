// Alert dell'auto-audit mensile (job `audit:alert17`, ogni 60 minuti). Dal giorno alert_day (predefinito 17) fino a fine mese, per ogni
// sede attiva di tipo struttura senza auto-audit inviato nel mese: UNA notifica Suite per sede e mese ai site manager (utenti con email
// = manager_email della sede oppure con grant SITE del modulo sulla sede), con link alla compilazione, e un'email se il mailer è
// configurato; poi un promemoria ogni reminder_every_days finché non arriva l'invio. Nessuna data cablata: `today` è un parametro di test.
import { q, many } from '../db.js';
import { KEY, STRUCTURE_KINDS } from '../config.js';
import { config as appConfig } from '../../../config.js';
import { notify } from '../../../lib/community.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { settings, getOrCreateAuto, SITE_COLS } from './core.js';
import { sitesToAlert, alertRecipients, monthLabel, todayIt } from './scoring.js';

export async function runAlert17({ today, dryRun = false } = {}) {
  const imp = await settings();
  const oggi = todayIt(today);
  const period = `${oggi.slice(0, 7)}-01`;
  const sites = await many(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.active AND s.kind = ANY($1) ORDER BY s.name`, [STRUCTURE_KINDS]);
  const audits = await many(`SELECT site_id, period, status FROM audits WHERE kind='AUTO' AND period=$1 AND deleted_at IS NULL`, [period]);
  const sent = await many(`SELECT site_id, period, sent_at, kind FROM alerts_sent WHERE period=$1 AND channel='SUITE'`, [period]);
  const todo = sitesToAlert({ today: oggi, settings: imp, sites, audits, sent, structureKinds: STRUCTURE_KINDS });
  if (!todo.length) return { period, giorno: oggi, sedi: 0, notifiche: 0, email: 0, skipped: 'nessuna sede da avvisare' };
  const users = await many(`SELECT id, email, status, notify_email FROM public.users WHERE status='ACTIVE'`);
  const grants = await many(`SELECT g.user_id, gs.scope_id AS site_id FROM public.grants g JOIN public.grant_scopes gs ON gs.grant_id=g.id AND gs.scope_type='SITE' WHERE g.module_key=$1 AND NOT g.proposed AND g.profile='SITE'`, [KEY]);
  let notifiche = 0, email = 0;
  const esito = [];
  for (const t of todo) {
    const site = sites.find((s) => s.id === t.site_id);
    const dest = alertRecipients(site, users, grants);
    if (dryRun) { esito.push({ site_id: site.id, kind: t.kind, destinatari: dest.length }); continue; }
    // l'auto-audit del mese esiste (creato al volo) così il link porta alla compilazione
    const { id } = await getOrCreateAuto(site.id, period, null);
    const mese = monthLabel(period);
    const title = t.kind === 'ALERT' ? `Auto-audit SGI di ${site.name}: compilazione entro fine mese` : `Promemoria: auto-audit SGI di ${site.name} (${mese}) non ancora inviato`;
    const body = `L'auto-audit SGI del mese di ${mese} va compilato e inviato entro la fine del mese. Apri "I miei audit" nel widget Audit SGI.`;
    const n = await notify(dest, { kind: 'MODULO', module_key: KEY, title, body, link: `/audit/miei/${id}` });
    notifiche += n;
    await q(`INSERT INTO alerts_sent (site_id, period, channel, kind, users) VALUES ($1,$2,'SUITE',$3,$4)`, [site.id, period, t.kind, dest.length]);
    // email (solo se il mailer è configurato: con MAIL_PROVIDER=log finisce nel registro)
    const addr = users.filter((u) => dest.includes(u.id) && u.notify_email !== false && u.email).map((u) => u.email);
    if (addr.length && appConfig.mail.provider) {
      const html = layout(title, `<p>${body}</p><p><a href="${appConfig.baseUrl}/audit/miei/${id}">Apri l'auto-audit di ${site.name}</a></p><p style="color:#5b6f75;font-size:12px">Avviso automatico del modulo Audit SGI (giorno ${imp.alert_day} del mese${t.kind === 'REMINDER' ? ', promemoria' : ''}).</p>`);
      const r = await sendMail({ to: addr, subject: title, html, ref: `audit:alert17:${site.id}:${period}` });
      if (r.ok) { email += addr.length; await q(`INSERT INTO alerts_sent (site_id, period, channel, kind, users) VALUES ($1,$2,'EMAIL',$3,$4)`, [site.id, period, t.kind, addr.length]); }
    }
    esito.push({ site_id: site.id, audit_id: id, kind: t.kind, destinatari: dest.length });
  }
  console.log(`[audit:alert17] ${oggi}: ${todo.length} sedi, ${notifiche} notifiche, ${email} email`);   // solo id e conteggi
  return { period, giorno: oggi, sedi: todo.length, notifiche, email, dettaglio: esito };
}
