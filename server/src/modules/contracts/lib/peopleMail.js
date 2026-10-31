// Casella People (people@toscanadiagnostica.it): impostazioni, stato, prove e richiami automatici sulle scadenze.
// Richiami (job contracts:richiami, ogni 60 minuti): per ogni scadenza di computeDeadlines entro l'orizzonte (soglia più alta) e per
// la soglia di anticipo raggiunta (60, 30, 7, 0 giorni, configurabili), una sola email per scadenza e soglia (deadline_reminders,
// UNIQUE deadline_key + days_before; dopo un errore o senza destinatario si riprova il giorno dopo). Mittente: la casella People via
// Graph (lib/mailer.js con `from`: serve Mail.Send applicativo su quella casella); con MAIL_PROVIDER=log l'email resta nel registro.
// Il soggetto e il corpo portano [TD-SCAD-<chiave>] per abbinare la risposta con gli allegati (lib/peopleInbox.js).
// Nei log solo identificativi e conteggi, mai contenuti dei documenti o dati sanitari.
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { computeDeadlines } from './deadlines.js';
import { graphConfigured, graphToken, graph, resolveMailbox } from './inbox.js';
import { DEFAULT_MAILBOX, parseThresholds, parseEmailList, parseRecipientMap, thresholdDue, chooseRecipient, reminderSubject, scadTag, DEFAULT_MAP } from './peopleRules.js';

export const SETTING_KEYS = ['people_mailbox', 'people_send_enabled', 'people_read_enabled', 'people_reminder_days', 'people_hr_cc', 'people_reminder_map'];

export async function setting(key, def = null) { const r = await one('SELECT value FROM app_settings WHERE key=$1', [key]); return r ? r.value : def; }
export async function setSetting(key, value) { await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value ?? '')]); }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const itDate = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y ? `${d}/${m}/${y}` : ''; };
export const romeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

/** Casella People: la variabile CONTRACTS_PEOPLE_MAILBOX ha la precedenza sull'impostazione del modulo. */
export async function peopleMailbox() {
  const env = (process.env.CONTRACTS_PEOPLE_MAILBOX || '').trim();
  if (env) return { address: env.toLowerCase(), source: 'env' };
  const s = ((await setting('people_mailbox', DEFAULT_MAILBOX)) || DEFAULT_MAILBOX).trim().toLowerCase();
  return { address: s || DEFAULT_MAILBOX, source: s && s !== DEFAULT_MAILBOX ? 'setting' : 'default' };
}

export async function peopleSettings() {
  const mb = await peopleMailbox();
  return {
    mailbox: mb.address,
    mailbox_source: mb.source,
    send_enabled: (await setting('people_send_enabled', 'false')) === 'true',
    read_enabled: (await setting('people_read_enabled', 'true')) === 'true',
    thresholds: parseThresholds(await setting('people_reminder_days', '60,30,7,0')),
    hr_cc: parseEmailList(await setting('people_hr_cc', '')),
    map: parseRecipientMap(await setting('people_reminder_map', JSON.stringify(DEFAULT_MAP))),
  };
}

/** Indirizzi HR: quelli impostati ("copia a HR"); in mancanza, gli utenti Suite attivi con profilo HR sul modulo Contracts. */
export async function hrEmails(settings) {
  if (settings.hr_cc.length) return settings.hr_cc;
  const rows = await many(`SELECT DISTINCT lower(u.email) AS email FROM public.grants g JOIN public.users u ON u.id=g.user_id
    WHERE g.module_key='contracts' AND g.profile='HR' AND NOT g.proposed AND u.status='ACTIVE' ORDER BY 1`);
  return rows.map((r) => r.email);
}

export async function peopleStatus() {
  const s = await peopleSettings();
  const last = await one(`SELECT max(sent_at) AS at FROM deadline_reminders WHERE status IN ('INVIATO','REGISTRATO')`);
  const counts = await one(`SELECT count(*) FILTER (WHERE status='DA_APPROVARE')::int AS da_approvare, count(*)::int AS totale FROM people_inbox`);
  return {
    ...s,
    graph_configured: graphConfigured(),
    mail_provider: suite.mail.provider,
    ai_mock: aiMock(),
    ai_enabled: Boolean(suite.anthropic.enabled),
    last_read: await setting('people_inbox_last', null),
    read_error: (await setting('people_inbox_error', '')) || null,
    last_send: last?.at || null,
    last_send_run: await setting('people_send_last', null),
    send_error: (await setting('people_send_error', '')) || null,
    inbox: counts,
    hr_effective: await hrEmails(s),
  };
}

export const aiMock = () => process.env.NODE_ENV !== 'production' && process.env.CONTRACTS_AI_MOCK === '1';

// ---------------- testo delle email ----------------
function whatToSend(item) {
  const t = (item.title || '').toLowerCase();
  if (/polizza/.test(t)) return 'la quietanza di rinnovo o la nuova polizza RC professionale, con il periodo di copertura ben leggibile';
  if (/identit|soggiorno|passaporto/.test(t)) return 'la copia fronte e retro del documento rinnovato';
  if (/idoneit/.test(t)) return 'il nuovo giudizio di idoneità rilasciato dal medico competente (solo il giudizio, nessun altro referto)';
  if (/albo|ordine/.test(t)) return 'la ricevuta del pagamento della quota annuale o il certificato di iscrizione aggiornato';
  if (/ecm|formazion|attestat|sicurezza/.test(t)) return 'l\'attestato o il certificato aggiornato';
  return 'il documento aggiornato';
}
const when = (days) => (days < 0 ? `è scaduta da ${-days} giorn${-days === 1 ? 'o' : 'i'}` : days === 0 ? 'scade oggi' : `scade tra ${days} giorn${days === 1 ? 'o' : 'i'}`);

export function reminderEmail(item, key, { recipient, personName }) {
  const subject = reminderSubject(item, key);
  const ref = `TD-SCAD-${key}`;
  let body;
  if (recipient === 'PERSONA') {
    body = `<p>Gentile ${esc(personName || '')},</p>
      <p>ti ricordiamo che <b>${esc(item.title)}</b> ${when(item.days)} (entro il <b>${itDate(item.due_date)}</b>).</p>
      <p><b>Cosa fare:</b> procurati ${esc(whatToSend(item))}.</p>
      <p><b>Cosa inviare:</b> rispondi a questa email allegando il documento aggiornato (PDF o foto ben leggibile): verrà preso in carico automaticamente e, dopo la verifica dell'ufficio People, registrato nel tuo dossier. La scadenza verrà chiusa all'approvazione.</p>
      <p style="color:#5b6f75;font-size:13px">Non modificare l'oggetto: contiene il riferimento <b>${ref}</b> che abbina la tua risposta a questa scadenza.</p>
      <p>Grazie,<br>Ufficio People · Toscana Diagnostica</p>`;
  } else {
    body = `<p>Promemoria per l'ufficio People.</p>
      <p><b>${esc(item.title)}</b>${item.resource_name ? ` di <b>${esc(item.resource_name)}</b>` : ''} ${when(item.days)} (entro il <b>${itDate(item.due_date)}</b>).</p>
      ${item.resource_id ? `<p><a href="${config.baseUrl}/risorse/${item.resource_id}" style="color:#1C505E;font-weight:700">Apri la scheda della persona</a></p>` : ''}
      <p style="color:#5b6f75;font-size:13px">Riferimento ${ref}. Eventuali documenti a chiusura si inviano rispondendo a questa email con gli allegati.</p>`;
  }
  const html = layout(`Promemoria scadenza`, body, { footer: 'Ufficio People · Toscana Diagnostica. Puoi rispondere a questa email allegando i documenti richiesti: la risposta viene letta e verificata dall\'ufficio People.' });
  const text = `${item.title} ${when(item.days)} (entro il ${itDate(item.due_date)}). Rispondi a questa email allegando il documento aggiornato: verrà preso in carico automaticamente. Riferimento ${scadTag(key)}`;
  return { subject, html, text };
}

/** Invio dalla casella People con esito normalizzato (INVIATO, REGISTRATO, FALLITO) e motivo leggibile. */
export async function sendFromPeople({ to, cc = [], subject, html, text, ref }) {
  const { address } = await peopleMailbox();
  const out = await sendMail({ from: address, to, cc, subject, html, text, ref });
  const status = !out.ok ? 'FALLITO' : out.logged ? 'REGISTRATO' : 'INVIATO';
  let error = out.error || null;
  if (error && /\b403\b|ErrorAccessDenied|Access is denied/i.test(error)) error = `Permesso mancante: l'app registration della Suite deve avere Mail.Send (applicativo, consenso amministratore) e, se c'è una Application Access Policy, deve includere ${address}. ${error}`;
  else if (error && /\b404\b|ErrorInvalidUser|MailboxNotEnabled|ResourceNotFound/i.test(error)) error = `La casella ${address} non esiste nel tenant o non è una casella Exchange. ${error}`;
  return { status, error, from: address, logId: out.logId || null, channel: suite.mail.provider === 'graph' ? 'EMAIL' : 'REGISTRO' };
}

// ---------------- richiami ----------------
/** Persone con email (anagrafica e account Suite) per l'abbinamento e i destinatari. */
export async function peopleDirectory() {
  return many(`SELECT r.id, r.last_name, r.first_name, r.kind, r.status, lower(r.email) AS email, lower(u.email) AS user_email
    FROM resources_v r LEFT JOIN public.users u ON u.person_id=r.id AND u.status='ACTIVE' WHERE r.status <> 'CESSATO'`);
}

export async function runReminders({ today = null, force = false } = {}) {
  const S = await peopleSettings();
  if (!force && !S.send_enabled) return { skipped: 'invio_disattivato' };
  const t0 = today || romeToday();
  const horizon = Math.max(...S.thresholds, 0);
  const items = (await computeDeadlines({ horizonDays: horizon, today: t0 })).filter((i) => i.resource_id);
  const dir = await peopleDirectory();
  const byId = new Map(); for (const p of dir) if (!byId.has(p.id)) byId.set(p.id, p); else if (!byId.get(p.id).email && p.user_email) byId.set(p.id, p);
  const hr = await hrEmails(S);
  const keys = items.map((i) => i.key);
  const prev = keys.length ? await many(`SELECT deadline_key, days_before, status, (sent_at AT TIME ZONE 'Europe/Rome')::date::text AS day FROM deadline_reminders WHERE deadline_key = ANY($1)`, [keys]) : [];
  const pending = new Set((await many(`SELECT deadline_key FROM people_inbox WHERE status='DA_APPROVARE' AND deadline_key IS NOT NULL`)).map((x) => x.deadline_key));
  const out = { oggi: t0, considerate: items.length, inviati: 0, registrati: 0, falliti: 0, senza_destinatario: 0, in_approvazione: 0, gia_inviati: 0 };
  let lastError = null;
  for (const it of items) {
    if (pending.has(it.key)) { out.in_approvazione++; continue; }
    const sent = new Set(prev.filter((p) => p.deadline_key === it.key && (['INVIATO', 'REGISTRATO'].includes(p.status) || p.day === t0)).map((p) => p.days_before));
    const th = thresholdDue(it.days, S.thresholds, sent);
    if (th === null) { if (sent.size) out.gia_inviati++; continue; }
    const person = byId.get(it.resource_id);
    const rc = chooseRecipient(it, { map: S.map, personEmail: person?.email || person?.user_email || null, hrEmails: hr, hrCc: S.hr_cc });
    if (!rc.recipient) continue;   // tipo escluso (NESSUNO)
    const base = [it.key, it.resource_id, it.type, it.title, it.due_date, th, rc.recipient];
    if (!rc.to.length) {
      await q(`INSERT INTO deadline_reminders (deadline_key, resource_id, deadline_type, title, due_date, days_before, recipient, status, error, from_email, channel)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'SENZA_DESTINATARIO',$8,$9,'EMAIL')
        ON CONFLICT (deadline_key, days_before) DO UPDATE SET status='SENZA_DESTINATARIO', error=EXCLUDED.error, sent_at=now()`, [...base, rc.reason, S.mailbox]);
      out.senza_destinatario++;
      continue;
    }
    const mail = reminderEmail(it, it.key, { recipient: rc.recipient, personName: person ? `${person.first_name} ${person.last_name}` : it.resource_name });
    const res = await sendFromPeople({ to: rc.to, cc: rc.cc, subject: mail.subject, html: mail.html, text: mail.text, ref: `contracts:richiamo:${it.key}:${th}` });
    await q(`INSERT INTO deadline_reminders (deadline_key, resource_id, deadline_type, title, due_date, days_before, recipient, to_email, cc_email, from_email, channel, status, error, message_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (deadline_key, days_before) DO UPDATE SET to_email=EXCLUDED.to_email, cc_email=EXCLUDED.cc_email, from_email=EXCLUDED.from_email, channel=EXCLUDED.channel,
        status=EXCLUDED.status, error=EXCLUDED.error, message_id=EXCLUDED.message_id, recipient=EXCLUDED.recipient, sent_at=now()`,
    [...base, rc.to.join(', '), rc.cc.join(', ') || null, res.from, res.channel, res.status, [rc.reason, res.error].filter(Boolean).join(' · ') || null, res.logId ? `email_log:${res.logId}` : null]);
    if (res.status === 'INVIATO') out.inviati++; else if (res.status === 'REGISTRATO') out.registrati++; else { out.falliti++; lastError = res.error; }
  }
  await setSetting('people_send_last', new Date().toISOString());
  await setSetting('people_send_error', lastError || '');
  console.log(`[people richiami] ${t0}: ${out.considerate} scadenze, ${out.inviati} inviati, ${out.registrati} registrati, ${out.falliti} falliti, ${out.senza_destinatario} senza destinatario`);
  return out;
}

// ---------------- prove ----------------
export async function testSend(to) {
  const addr = parseEmailList(to)[0];
  if (!addr) return { ok: false, message: 'Indirizzo di prova non valido' };
  const { address } = await peopleMailbox();
  const html = layout('Prova di invio dalla casella People', `<p>Questa è un'email di prova inviata dalla casella <b>${esc(address)}</b> della Suite TD (modulo Contratti del Personale).</p><p>Se la ricevi, i richiami sulle scadenze partiranno da questo mittente.</p>`, { footer: 'Ufficio People · Toscana Diagnostica' });
  const r = await sendFromPeople({ to: [addr], subject: 'Toscana Diagnostica · prova di invio dalla casella People', html, text: 'Prova di invio dalla casella People', ref: 'contracts:people:prova' });
  if (r.status === 'INVIATO') return { ok: true, message: `Email di prova inviata da ${r.from} a ${addr}: verifica la ricezione (e la cartella Posta indesiderata).` };
  if (r.status === 'REGISTRATO') return { ok: true, logged: true, message: `Posta in modalità registro (MAIL_PROVIDER=log o credenziali Graph assenti): l'email da ${r.from} a ${addr} è solo nel registro email, nessun invio reale.` };
  return { ok: false, message: r.error || 'Invio non riuscito' };
}

/** Ruoli applicativi del token Graph (claim roles): dicono quali permessi ha l'app registration, senza inviare né leggere nulla. */
function tokenRoles(tok) {
  try { return JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8')).roles || []; } catch { return null; }
}

// "Prova la casella": credenziali, permessi del token, casella, lettura di un messaggio; dice esattamente cosa manca
export async function testPeopleInbox() {
  const { address } = await peopleMailbox();
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, steps, message: `${step}: ${detail}` }; };
  if (!graphConfigured()) return fail('Credenziali Microsoft Graph della Suite', 'assenti: su Render servono ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (o le GRAPH_*)');
  let tok;
  try { tok = await graphToken(); steps.push({ step: 'Credenziali Microsoft Graph della Suite', ok: true, detail: `tenant ${suite.mail.graph.tenantId}` }); } catch (e) { return fail('Credenziali Microsoft Graph della Suite', `non valide o segreto scaduto: ${e.message}`); }
  const roles = tokenRoles(tok);
  if (roles) {
    const read = roles.some((r) => /^Mail\.Read(Write)?$/.test(r)); const send = roles.includes('Mail.Send');
    const miss = [!read && 'Mail.Read', !send && 'Mail.Send'].filter(Boolean);
    steps.push({ step: 'Permessi dell\'app registration', ok: !miss.length, detail: miss.length ? `manca${miss.length > 1 ? 'no' : ''} ${miss.join(' e ')} (permesso applicativo Microsoft Graph con consenso amministratore). Presenti: ${roles.join(', ') || 'nessuno'}` : `Mail.Read e Mail.Send presenti (${roles.join(', ')})` });
    if (!read) return { ok: false, steps, message: 'Permesso Mail.Read mancante sull\'app registration' };
  }
  let u;
  try { u = await resolveMailbox(address); steps.push({ step: `Casella ${address}`, ok: true, detail: `trovata per ${u.how}: ${u.displayName || ''} · id ${u.id}` }); } catch (e) { return fail(`Casella ${address}`, /404|ErrorInvalidUser|ResourceNotFound/.test(e.message) ? `inesistente nel tenant o non è una casella Exchange (${e.message})` : e.message); }
  try {
    const j = await graph(`/users/${encodeURIComponent(u.id)}/mailFolders/inbox/messages?$top=1&$select=id,receivedDateTime,subject`);
    const m = (j.value || [])[0];
    steps.push({ step: 'Lettura di un messaggio', ok: true, detail: m ? `ultimo messaggio del ${new Date(m.receivedDateTime).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : 'casella vuota' });
  } catch (e) {
    const d = /403|ErrorAccessDenied|Access/i.test(e.message) ? `permesso negato: serve Mail.Read (applicativo) e, se c'è una Application Access Policy, deve includere ${address} (${e.message})`
      : /404|ErrorInvalidUser|MailboxNotEnabled/i.test(e.message) ? `la casella ${address} non esiste o non ha una cassetta Exchange (${e.message})` : e.message;
    return fail('Lettura di un messaggio', d);
  }
  const ok = steps.every((s) => s.ok);
  return { ok, steps, message: ok ? `Casella ${address} leggibile, permessi Mail.Read e Mail.Send presenti` : 'Casella leggibile, ma con un permesso mancante (vedi i passaggi)' };
}
