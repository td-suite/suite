// Lavori periodici del modulo Shipments: lettura della casella shipments@, tracciamento, allarmi, conservazione dati
import { config } from '../config.js';
import { many, one, q } from '../db.js';
import { graphConfigured, graphFetch, sendMail, adminEmails } from './mailer.js';
import { parseKitEmail, htmlToText } from './parser.js';
import { pollTracking } from './tracking.js';
import { getSetting, itDate, todayRome } from './util.js';

// ---- Casella in arrivo (Microsoft Graph, permesso applicativo Mail.Read o Mail.ReadWrite sulla casella) ----
export async function pollInbox({ force = false } = {}) {
  if (!graphConfigured() || !config.graph.inbox) return { skipped: 'not_configured' };
  if (!force && (await getSetting('inbox_enabled', 'true')) !== 'true') return { skipped: 'disabled' };
  const since = await getSetting('inbox_since', null);
  const sinceIso = since || new Date(Date.now() - 7 * 86400000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso}`);
  const res = await graphFetch(`/users/${encodeURIComponent(config.graph.inbox)}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=50&$select=id,receivedDateTime,from,subject,body,bodyPreview`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Graph inbox ${res.status}: ${t.slice(0, 200)}`); }
  const j = await res.json();
  const senderFilter = ((await getSetting('affinity_sender_filter', '')) || '').split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const modes = await many('SELECT * FROM shipping_modes WHERE active');
  const knownCodes = await many('SELECT barcode, status FROM kits');
  let created = 0; let last = sinceIso;
  for (const m of j.value || []) {
    last = m.receivedDateTime > last ? m.receivedDateTime : last;
    if (await one('SELECT 1 FROM inbox_messages WHERE graph_id=$1', [m.id])) continue;
    const from = m.from?.emailAddress?.address || '';
    if (from.toLowerCase() === config.graph.inbox.toLowerCase()) continue; // risposte inviate dalla casella stessa: non sono richieste
    const text = m.body?.contentType === 'html' ? htmlToText(m.body.content) : (m.body?.content || m.bodyPreview || '');
    const looksLikeKit = /kit/i.test(m.subject || '') || /kit/i.test(text.slice(0, 400));
    const fromOk = !senderFilter.length || senderFilter.some((d) => from.toLowerCase().endsWith(d));
    if (!looksLikeKit && !fromOk) continue; // email estranea: non la importiamo
    const parsed = parseKitEmail(text, modes, { subject: m.subject || '', knownCodes });
    await q(`INSERT INTO inbox_messages (graph_id, source, received_at, from_addr, subject, body_text, parsed, status) VALUES ($1,'GRAPH',$2,$3,$4,$5,$6,$7)`,
      [m.id, m.receivedDateTime, from, m.subject || '', text, JSON.stringify(parsed), parsed.length ? 'PARSED' : 'NEW']);
    created++;
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('inbox_since', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [last]);
  await q(`INSERT INTO app_settings (key, value) VALUES ('inbox_last_poll', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [new Date().toISOString()]);
  return { fetched: (j.value || []).length, created };
}

// ---- Allarmi ----
// 1) kit consegnato ma campione non rientrato dopo N giorni (Endeavor e Lifestyle kit+esame)
export async function overdueReturns(days) {
  return many(`SELECT o.*, k.barcode, m.name_it AS mode_it, m.name_en AS mode_en FROM orders o LEFT JOIN kits k ON k.id=o.kit_id LEFT JOIN shipping_modes m ON m.id=o.shipping_mode_id
    WHERE o.status='DELIVERED' AND o.order_type IN ('ENDEAVOR','KIT_AND_EXAM') AND o.delivered_at < now() - ($1 || ' days')::interval ORDER BY o.delivered_at`, [String(days)]);
}
// 2) campioni ricevuti in attesa di lettera di vettura da più di N giorni (Endeavor)
export async function awaitingAwb(days) {
  return many(`SELECT o.*, k.barcode FROM orders o LEFT JOIN kits k ON k.id=o.kit_id
    WHERE o.project='ENDEAVOR' AND o.status='SAMPLE_RECEIVED' AND o.lab_shipment_id IS NULL AND o.sample_received_at < now() - ($1 || ' days')::interval ORDER BY o.sample_received_at`, [String(days)]);
}
// 3) scorte
export async function stockLevels() {
  return many(`SELECT project, count(*)::int AS n FROM kits WHERE status='IN_STOCK' GROUP BY project`);
}

export async function runDailyAlerts({ force = false } = {}) {
  const today = todayRome();
  const last = await getSetting('alerts_last_run', '');
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
  if (!force && (last === today || nowHour < 8)) return null;
  if ((await getSetting('daily_alerts_enabled', 'true')) !== 'true') { await q(`INSERT INTO app_settings (key, value) VALUES ('alerts_last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [today]); return { date: today, skipped: 'disabled' }; }
  const retDays = Number(await getSetting('alert_return_days', '21'));
  const awbDays = Number(await getSetting('alert_awb_days', '5'));
  const minStock = Number(await getSetting('alert_stock_min', '10'));
  const [ret, awb, stock] = await Promise.all([overdueReturns(retDays), awaitingAwb(awbDays), stockLevels()]);
  // soglia 0 = controllo scorte disattivato
  const low = minStock > 0 ? ['ENDEAVOR', 'LIFESTYLE'].map((p) => ({ project: p, n: stock.find((s) => s.project === p)?.n || 0 })).filter((s) => s.n < minStock) : [];
  const admins = await adminEmails();
  const lines = [];
  if (ret.length) lines.push(`Campioni non rientrati dopo ${retDays} giorni dalla consegna del kit: ${ret.length}\n${ret.map((o) => `• ${o.external_ref || '#' + o.id} ${o.patient_last_name} ${o.patient_first_name}, kit ${o.barcode || '-'}, consegnato il ${itDate(o.delivered_at?.toISOString?.() || o.delivered_at)}`).join('\n')}`);
  if (awb.length) lines.push(`Campioni in attesa di lettera di vettura FedEx da più di ${awbDays} giorni: ${awb.length}\n${awb.map((o) => `• ${o.external_ref || '#' + o.id} kit ${o.barcode || '-'}, ricevuto il ${itDate(o.sample_received_at?.toISOString?.() || o.sample_received_at)}`).join('\n')}`);
  if (low.length) lines.push(`Scorte sotto la soglia di ${minStock} kit: ${low.map((s) => `${s.project} (${s.n})`).join(', ')}`);
  let sent = null;
  if (lines.length && admins.length) {
    sent = await sendMail({ kind: 'ALLARMI', refKey: `ALLARMI:${today}`, to: admins, subject: `Shipments · controllo del ${itDate(today)}: ${ret.length + awb.length + low.length} segnalazioni`, title: `Controllo giornaliero del ${itDate(today)}`, body: lines.join('\n\n') });
  }
  // sollecito ad Affinity per le lettere di vettura mancanti (una volta per kit)
  const affinity = await getSetting('affinity_notify_emails', '');
  for (const o of awb) {
    if (!affinity) break;
    await sendMail({ kind: 'AWB_REMINDER', refKey: `AWB_REMINDER:${o.id}`, orderId: o.id, to: affinity, lang: 'en',
      subject: `Airway bill needed · kit ${o.barcode || ''} · ${o.external_ref || ''}`, title: 'Sample ready for shipment to the laboratory',
      body: `The sample for order ${o.external_ref || '#' + o.id} (kit ${o.barcode || '-'}) was received at Toscana Diagnostica on ${itDate(o.sample_received_at?.toISOString?.() || o.sample_received_at)} and is waiting for the FedEx airway bill.\n\nPlease send the airway bill to shipments@toscanadiagnostica.it so that we can ship the sample to Endeavor DNA Laboratories.` });
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('alerts_last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [today]);
  return { date: today, returns: ret.length, awb: awb.length, low, sent };
}

// ---- Conservazione: pseudonimizzazione dei dati del paziente dopo N mesi dalla chiusura ----
export async function anonymizeClosed() {
  const months = Number(await getSetting('retention_months', '12'));
  if (!months) return 0;
  const r = await q(`UPDATE orders SET patient_first_name = left(patient_first_name,1) || '.', patient_last_name = left(patient_last_name,1) || '.',
      address1='[rimosso]', address2=NULL, phone=NULL, email=NULL, notes=NULL, anonymized_at=now(), updated_at=now()
    WHERE anonymized_at IS NULL AND status IN ('CLOSED','CANCELLED') AND coalesce(closed_at, cancelled_at) < now() - ($1 || ' months')::interval`, [String(months)]);
  if (r.rowCount) await q(`UPDATE inbox_messages SET body_text='[rimosso per scadenza conservazione]', parsed=NULL WHERE status IN ('CONFIRMED','IGNORED') AND received_at < now() - ($1 || ' months')::interval AND body_text <> '[rimosso per scadenza conservazione]'`, [String(months)]);
  return r.rowCount;
}

// Lo scheduler dell'app non si porta: i lavori vengono registrati con registerJob della Suite in index.js e girano solo con modulo LIVE.
