// Gestione del Personale · "Segnala Scadenza" (v0.92.0, CEO 21/11/2026): dal Calendario delle scadenze si selezionano le scadenze e si
// invia la prima email di segnalazione dalla casella People; da lì parte un sollecito ogni 7 giorni dall'ultimo invio (job
// contracts:solleciti) finché la scadenza resta aperta. I solleciti si fermano da soli quando la scadenza esce dal calendario
// (documento rinnovato, scadenza chiusa dall'approvazione della casella People, persona non più in servizio) o a mano ("Ferma").
// Se per la scadenza c'è un documento in attesa di approvazione nella Casella People il sollecito aspetta.
// Destinatario: lo stesso dei richiami automatici (lib/peopleRules.js chooseRecipient: alla persona con copia a HR, oppure a HR per
// le scadenze interne); un tipo escluso dai richiami automatici (NESSUNO) qui va a HR, perché la segnalazione è una scelta esplicita.
// A differenza dei richiami automatici per soglia, segnalazione e solleciti NON dipendono dall'interruttore "invio dei richiami":
// partono perché qualcuno ha premuto "Segnala Scadenza". Nei log solo chiavi e conteggi.
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { layout } from '../../../lib/mailer.js';
import { computeDeadlines } from './deadlines.js';
import { chooseRecipient, scadTag, DEFAULT_MAP } from './peopleRules.js';
import { peopleSettings, hrEmails, peopleDirectory, sendFromPeople, romeToday, setSetting } from './peopleMail.js';

export const GIORNI_SOLLECITO = 7;
const ORIZZONTE = 3650;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const itDate = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y ? `${d}/${m}/${y}` : ''; };
const quando = (days) => (days < 0 ? `è scaduta da ${-days} giorn${-days === 1 ? 'o' : 'i'}` : days === 0 ? 'scade oggi' : `scade tra ${days} giorn${days === 1 ? 'o' : 'i'}`);

/** Testo dell'email: n = 0 segnalazione, n >= 1 sollecito numero n. */
export function emailSegnalazione(item, { recipient, personName, n = 0, primaIl = null }) {
  const ref = `TD-SCAD-${item.key}`;
  const titolo = n ? `Sollecito n. ${n}: scadenza da regolarizzare` : 'Segnalazione di scadenza';
  const subject = `Toscana Diagnostica · ${n ? `sollecito n. ${n}` : 'segnalazione'}: ${item.title}${item.due_date ? ` entro il ${itDate(item.due_date)}` : ''} ${scadTag(item.key)}`;
  const richiamo = n ? `<p>Ti abbiamo già scritto il ${itDate(primaIl)}: la scadenza risulta ancora aperta.</p>` : '';
  let body;
  if (recipient === 'PERSONA') {
    body = `<p>Gentile ${esc(personName || '')},</p>
      <p>ti segnaliamo che <b>${esc(item.title)}</b> ${quando(item.days)} (data: <b>${itDate(item.due_date)}</b>).</p>${richiamo}
      <p><b>Cosa fare:</b> rispondi a questa email allegando il documento aggiornato (PDF o foto ben leggibile) oppure indicando quando lo invierai. Dopo la verifica dell'ufficio People il documento viene registrato nel tuo dossier e la scadenza chiusa.</p>
      <p style="color:#5b6f75;font-size:13px">Non modificare l'oggetto: contiene il riferimento <b>${ref}</b>. Finché la scadenza resta aperta riceverai un sollecito ogni ${GIORNI_SOLLECITO} giorni.</p>
      <p>Grazie,<br>Ufficio People · Toscana Diagnostica</p>`;
  } else {
    body = `<p>${n ? `Sollecito n. ${n}` : 'Segnalazione'} per l'ufficio People.</p>
      <p><b>${esc(item.title)}</b>${item.resource_name ? ` di <b>${esc(item.resource_name)}</b>` : ''} ${quando(item.days)} (data: <b>${itDate(item.due_date)}</b>).</p>${n ? `<p>Prima segnalazione del ${itDate(primaIl)}: la scadenza risulta ancora aperta.</p>` : ''}
      ${item.resource_id ? `<p><a href="${config.baseUrl}/risorse/${item.resource_id}" style="color:#1C505E;font-weight:700">Apri la scheda della persona</a></p>` : ''}
      <p style="color:#5b6f75;font-size:13px">Riferimento ${ref}. Sollecito ogni ${GIORNI_SOLLECITO} giorni finché la scadenza resta aperta; si ferma dal Calendario delle scadenze.</p>`;
  }
  const html = layout(titolo, body, { footer: 'Ufficio People · Toscana Diagnostica. Puoi rispondere a questa email allegando i documenti richiesti: la risposta viene letta e verificata dall\'ufficio People.' });
  const text = `${n ? `Sollecito n. ${n}. ` : ''}${item.title} ${quando(item.days)} (data: ${itDate(item.due_date)}). Rispondi a questa email allegando il documento aggiornato. Riferimento ${scadTag(item.key)}`;
  return { subject, html, text };
}

async function contesto() {
  const S = await peopleSettings();
  const dir = await peopleDirectory();
  const byId = new Map(); for (const p of dir) if (!byId.has(p.id) || (!byId.get(p.id).email && p.user_email)) byId.set(p.id, p);
  return { S, byId, hr: await hrEmails(S) };
}
function destinatario(item, { S, byId, hr }) {
  const person = item.resource_id ? byId.get(item.resource_id) : null;
  // la segnalazione è una scelta esplicita: un tipo escluso dai richiami automatici va a HR
  const map = { ...DEFAULT_MAP, ...S.map }; for (const k of Object.keys(map)) if (map[k] === 'NESSUNO') map[k] = 'HR';
  const rc = chooseRecipient(item, { map, personEmail: person?.email || person?.user_email || null, hrEmails: hr, hrCc: S.hr_cc });
  return { ...rc, personName: person ? `${person.first_name} ${person.last_name}` : item.resource_name };
}

/** Stato delle segnalazioni per chiave (per il Calendario): { [key]: { prima, ultimo, solleciti, prossimo, ferma, motivo, esito, a } }. */
export async function statoSegnalazioni(keys = null) {
  const rows = await many(`SELECT deadline_key, recipient, to_email, first_sent_at, last_sent_at, n_solleciti, last_status, last_error, stopped_at, stopped_reason,
      (coalesce(last_sent_at, created_at) + make_interval(days => ${GIORNI_SOLLECITO})) AS prossimo FROM deadline_signals ${keys ? 'WHERE deadline_key = ANY($1)' : ''}`, keys ? [keys] : []);
  return Object.fromEntries(rows.map((r) => [r.deadline_key, { prima: r.first_sent_at, ultimo: r.last_sent_at, solleciti: r.n_solleciti, prossimo: r.stopped_at || !r.first_sent_at ? null : r.prossimo,
    ferma: Boolean(r.stopped_at), motivo: r.stopped_reason, esito: r.last_status, errore: r.last_error, destinatario: r.recipient, a: r.to_email }]));
}

async function invia(item, ctx, { n, primaIl, userId }) {
  const rc = destinatario(item, ctx);
  const kind = n ? 'SOLLECITO' : 'SEGNALAZIONE';
  if (!rc.to.length) {
    await q(`INSERT INTO deadline_signal_sends (deadline_key, kind, n, status, error, user_id) VALUES ($1,$2,$3,'SENZA_DESTINATARIO',$4,$5)`, [item.key, kind, n, rc.reason, userId]);
    await q(`UPDATE deadline_signals SET last_try_at=now(), last_status='SENZA_DESTINATARIO', last_error=$2 WHERE deadline_key=$1`, [item.key, rc.reason]);
    return { status: 'SENZA_DESTINATARIO', error: rc.reason, to: [], cc: [] };
  }
  const mail = emailSegnalazione(item, { recipient: rc.recipient, personName: rc.personName, n, primaIl });
  const res = await sendFromPeople({ to: rc.to, cc: rc.cc, subject: mail.subject, html: mail.html, text: mail.text, ref: `contracts:segnalazione:${item.key}:${n}` });
  await q(`INSERT INTO deadline_signal_sends (deadline_key, kind, n, to_email, cc_email, from_email, channel, status, error, message_id, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [item.key, kind, n, rc.to.join(', '), rc.cc.join(', ') || null, res.from, res.channel, res.status, res.error, res.logId ? `email_log:${res.logId}` : null, userId]);
  const ok = ['INVIATO', 'REGISTRATO'].includes(res.status);
  await q(`UPDATE deadline_signals SET recipient=$2, to_email=$3, cc_email=$4, last_try_at=now(), last_status=$5, last_error=$6,
      first_sent_at = CASE WHEN $7 AND first_sent_at IS NULL THEN now() ELSE first_sent_at END, last_sent_at = CASE WHEN $7 THEN now() ELSE last_sent_at END,
      n_solleciti = CASE WHEN $7 AND $8::int > 0 THEN $8::int ELSE n_solleciti END WHERE deadline_key=$1`,
  [item.key, rc.recipient, rc.to.join(', '), rc.cc.join(', ') || null, res.status, res.error, ok, n]);
  return { status: res.status, error: res.error, to: rc.to, cc: rc.cc, recipient: rc.recipient };
}

/**
 * Segnala le scadenze scelte. prova = true: solo l'elenco con i destinatari, nessun invio. Una scadenza già segnalata e attiva non
 * riparte (resta il suo ritmo di solleciti); una segnalazione fermata, o la cui prima email non è riuscita, riparte da capo.
 */
export async function segnala(keys, { userId = null, prova = false, today = null, filtro = null } = {}) {
  const t0 = today || romeToday();
  const voluti = new Set((keys || []).map(String));
  let items = (await computeDeadlines({ horizonDays: ORIZZONTE, today: t0 })).filter((i) => voluti.has(i.key));
  if (filtro) items = items.filter(filtro);
  const ctx = await contesto();
  const stato = await statoSegnalazioni([...voluti]);
  const out = [];
  for (const it of items) {
    const s = stato[it.key];
    const base = { key: it.key, title: it.title, resource_name: it.resource_name, due_date: it.due_date, days: it.days };
    if (s && s.prima && !s.ferma) { out.push({ ...base, esito: 'GIA_SEGNALATA', a: s.a, prossimo: s.prossimo }); continue; }
    const rc = destinatario(it, ctx);
    if (prova) { out.push({ ...base, esito: rc.to.length ? 'DA_INVIARE' : 'SENZA_DESTINATARIO', destinatario: rc.recipient, a: rc.to.join(', '), cc: rc.cc.join(', '), motivo: rc.reason }); continue; }
    await q(`INSERT INTO deadline_signals (deadline_key, resource_id, deadline_type, title, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (deadline_key) DO UPDATE SET title=EXCLUDED.title, due_date=EXCLUDED.due_date, stopped_at=NULL, stopped_reason=NULL, first_sent_at=NULL, last_sent_at=NULL, n_solleciti=0, created_by=EXCLUDED.created_by, created_at=now()`,
    [it.key, it.resource_id || null, it.type, it.title, it.due_date, userId]);
    const r = await invia(it, ctx, { n: 0, primaIl: t0, userId });
    out.push({ ...base, esito: r.status, destinatario: r.recipient, a: r.to.join(', '), cc: r.cc.join(', '), motivo: r.error });
  }
  const mancanti = [...voluti].filter((k) => !items.some((i) => i.key === k));
  return { prova, giorni_sollecito: GIORNI_SOLLECITO, righe: out, non_trovate: mancanti.length };
}

export async function fermaSegnalazione(key, motivo = 'fermata a mano') {
  const r = await q(`UPDATE deadline_signals SET stopped_at=now(), stopped_reason=$2 WHERE deadline_key=$1 AND stopped_at IS NULL`, [key, motivo]);
  return r.rowCount;
}

/** Job dei solleciti: per ogni segnalazione attiva con ultimo invio riuscito da almeno 7 giorni, sollecito oppure chiusura. */
export async function runSolleciti({ now = new Date(), today = null } = {}) {
  const t0 = today || romeToday();
  const attive = await many(`SELECT * FROM deadline_signals WHERE stopped_at IS NULL AND first_sent_at IS NOT NULL ORDER BY last_sent_at`);
  const out = { oggi: t0, attive: attive.length, solleciti: 0, registrati: 0, falliti: 0, chiuse: 0, in_approvazione: 0, non_ancora: 0 };
  if (!attive.length) return out;
  const aperte = new Map((await computeDeadlines({ horizonDays: ORIZZONTE, today: t0 })).map((i) => [i.key, i]));
  const pending = new Set((await many(`SELECT deadline_key FROM people_inbox WHERE status='DA_APPROVARE' AND deadline_key IS NOT NULL`)).map((x) => x.deadline_key));
  const ctx = await contesto();
  for (const s of attive) {
    const it = aperte.get(s.deadline_key);
    if (!it) { await fermaSegnalazione(s.deadline_key, 'scadenza chiusa o non più in calendario'); out.chiuse++; continue; }
    if (now.getTime() - new Date(s.last_sent_at).getTime() < GIORNI_SOLLECITO * 86400000) { out.non_ancora++; continue; }
    if (pending.has(s.deadline_key)) { out.in_approvazione++; continue; }
    // dopo un invio fallito si riprova al giro successivo, non più di una volta ogni 6 ore
    if (s.last_status === 'FALLITO' && s.last_try_at && now.getTime() - new Date(s.last_try_at).getTime() < 6 * 3600000) { out.non_ancora++; continue; }
    const r = await invia(it, ctx, { n: s.n_solleciti + 1, primaIl: String(new Date(s.first_sent_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })), userId: null });
    if (r.status === 'INVIATO') out.solleciti++; else if (r.status === 'REGISTRATO') out.registrati++; else out.falliti++;
  }
  await setSetting('people_solleciti_last', new Date().toISOString());
  console.log(`[people solleciti] ${t0}: ${out.attive} segnalazioni attive, ${out.solleciti} solleciti, ${out.registrati} registrati, ${out.falliti} falliti, ${out.chiuse} chiuse`);
  return out;
}
