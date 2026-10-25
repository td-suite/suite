// Email in uscita del modulo Non conformità dentro la Suite.
// Il trasporto è quello della Suite (lib/mailer.js: Microsoft Graph dalla casella suite@, oppure MAIL_PROVIDER=log che registra
// soltanto). Restano dell'app: la coda e il registro email_log (schema nc), i tentativi, i template HTML.
//
// Regola di protezione dati: nelle email NON compaiono dati del paziente. Viaggiano solo codice NC, numero
// accettazione, sede, tipologia, azione attesa e il link all'applicazione; il resto si legge dopo il login.
import { config } from '../config.js';
import { one, q, many } from '../db.js';
import { sendMail as suiteSendMail } from '../../../lib/mailer.js';

export const splitAddresses = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

// Mette in coda e prova subito l'invio
export async function enqueue({ ncId, tipo, to, cc, subject, html }) {
  const toList = [...new Set(splitAddresses(Array.isArray(to) ? to.join(',') : to))];
  const ccList = [...new Set(splitAddresses(Array.isArray(cc) ? cc.join(',') : cc))].filter((x) => !toList.includes(x));
  const row = await one(
    `INSERT INTO email_log (nc_id, tipo, destinatari, cc, oggetto, corpo_html, stato) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ncId || null, tipo, toList.join(', '), ccList.join(', ') || null, subject, html, toList.length ? 'IN_CODA' : 'ERRORE']);
  if (!toList.length) { await q(`UPDATE email_log SET errore='Nessun destinatario valido' WHERE id=$1`, [row.id]); return row; }
  return deliver(row);
}

export async function deliver(row) {
  const to = splitAddresses(row.destinatari), cc = splitAddresses(row.cc);
  try {
    if (config.mail.provider !== 'graph') {
      // nessun trasporto reale configurato nella Suite: l'email resta registrata come simulata (come MAIL_PROVIDER=log dell'app)
      await suiteSendMail({ to, cc, subject: row.oggetto, html: row.corpo_html, ref: `nc:email:${row.id}` });
      return one(`UPDATE email_log SET stato='SIMULATA', tentativi=tentativi+1, sent_at=now(), errore=NULL WHERE id=$1 RETURNING *`, [row.id]);
    }
    const r = await suiteSendMail({ to, cc, subject: row.oggetto, html: row.corpo_html, ref: `nc:email:${row.id}` });
    if (!r.ok) throw new Error(r.error || 'invio non riuscito');
    return one(`UPDATE email_log SET stato='INVIATA', tentativi=tentativi+1, sent_at=now(), errore=NULL WHERE id=$1 RETURNING *`, [row.id]);
  } catch (e) {
    console.error('[nc:mail]', e.message);
    return one(`UPDATE email_log SET stato=CASE WHEN tentativi+1 >= 5 THEN 'ERRORE' ELSE 'IN_CODA' END, tentativi=tentativi+1, errore=$2 WHERE id=$1 RETURNING *`, [row.id, e.message.slice(0, 500)]);
  }
}

// Riprova le email in coda (chiamato dallo scheduler)
export async function retryQueue() {
  const rows = await many(`SELECT * FROM email_log WHERE stato='IN_CODA' AND tentativi > 0 AND created_at > now() - interval '2 days' ORDER BY id LIMIT 20`);
  for (const r of rows) await deliver(r);
  return rows.length;
}

// ---------- template -----------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');

export function layout({ title, intro, rows, cta, outro, footer }) {
  const trs = (rows || []).map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6f75;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#0f2a33;font-size:14px;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f3f6f6;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px">
    <div style="background:#01212C;border-radius:14px 14px 0 0;padding:20px 24px;color:#fff">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#71B1BD;font-weight:700">Toscana Diagnostica · Laboratorio di Analisi</div>
      <div style="font-size:20px;font-weight:750;margin-top:6px">${esc(title)}</div>
    </div>
    <div style="background:#fff;border:1px solid #dbe5e7;border-top:0;border-radius:0 0 14px 14px;padding:22px 24px">
      ${intro ? `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.5">${intro}</p>` : ''}
      ${trs ? `<table style="border-collapse:collapse;margin:6px 0 16px">${trs}</table>` : ''}
      ${cta ? `<p style="margin:18px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#1C505E;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:9px">${esc(cta.label)}</a></p>
      <p style="font-size:12px;color:#5b6f75;margin:0 0 14px">Se il pulsante non funziona, copia questo indirizzo nel browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>` : ''}
      ${outro ? `<p style="margin:14px 0 0;font-size:13.5px;line-height:1.5;color:#2f444b">${outro}</p>` : ''}
      <hr style="border:0;border-top:1px solid #dbe5e7;margin:20px 0 12px">
      <p style="margin:0;font-size:11.5px;color:#5b6f75;line-height:1.5">${footer || 'Messaggio generato automaticamente dal sistema di gestione delle non conformità del Laboratorio di Analisi di Toscana Diagnostica, Via di Pratignone 13/4, Sesto Fiorentino (FI). Per tutelare la riservatezza, questa email non contiene dati del paziente: i dettagli sono consultabili dopo l\'accesso con le credenziali fornite in fase di attivazione del servizio.'}</p>
    </div>
  </div></body></html>`;
}

export const ncUrl = (nc) => `${config.baseUrl}/nc/${nc.id}`;
export const GRAVITA = { MINORE: 'Minore', MAGGIORE: 'Maggiore', CRITICA: 'Critica' };
export const MACRO = { FISICA: 'Fisica / biologica', INFORMATICA: 'Informatica / LIS', DOCUMENTALE: 'Documentale' };

export function tplApertura(nc, sede, tipoLabel, lab) {
  const rows = [['Non conformità', nc.codice], ['Accettazione', nc.accettazione_id], ['Sede inviante', sede.nome], ['Tipologia', `${MACRO[nc.macro]} · ${tipoLabel}`], ['Gravità', GRAVITA[nc.gravita]],
    ['Esami coinvolti', (nc.esami_coinvolti || []).map((e) => e.cod).join(', ') || 'tutti gli esami dell\'accettazione'], ['Azione richiesta', nc.azione_attesa], ['Risposta attesa entro', itDT(nc.sla_due_at)]];
  return {
    subject: `[${nc.codice}] Non conformità su accettazione ${nc.accettazione_id} · azione richiesta`,
    html: layout({ title: 'Non conformità rilevata su un campione', intro: `Il laboratorio ha rilevato una non conformità pre-analitica su un campione inviato da <b>${esc(sede.nome)}</b>. Il campione è stato messo in stato di blocco in attesa della vostra risposta.`, rows,
      cta: { url: ncUrl(nc), label: 'Gestisci la non conformità' },
      outro: `Accedendo con le credenziali fornite da Toscana Diagnostica potrete leggere il dettaglio, chiedere chiarimenti oppure confermare l'azione eseguita. Per urgenze: ${esc(lab.lab_email)}${lab.lab_telefono ? ` · ${esc(lab.lab_telefono)}` : ''}.` }),
  };
}
export function tplRichiesta(nc, sede, testo) {
  return {
    subject: `[${nc.codice}] Nuova comunicazione dal laboratorio · accettazione ${nc.accettazione_id}`,
    html: layout({ title: 'Nuova comunicazione dal laboratorio', intro: `Il laboratorio ha aggiunto una comunicazione alla non conformità <b>${esc(nc.codice)}</b> (accettazione ${esc(nc.accettazione_id)}, sede ${esc(sede.nome)}).`,
      rows: [['Messaggio', testo.length > 600 ? `${testo.slice(0, 600)}…` : testo], ['Risposta attesa entro', itDT(nc.sla_due_at)]], cta: { url: ncUrl(nc), label: 'Rispondi' } }),
  };
}
export function tplRispostaAlLab(nc, sede, msg) {
  return {
    subject: `[${nc.codice}] Risposta della sede ${sede.nome} · accettazione ${nc.accettazione_id}`,
    html: layout({ title: 'La sede ha risposto', intro: `<b>${esc(sede.nome)}</b> ha risposto alla non conformità <b>${esc(nc.codice)}</b>${msg.azione_eseguita ? ' dichiarando di aver <b>eseguito l\'azione richiesta</b>' : ''}.`,
      rows: [['Riferimento sede', `${msg.contatto_nome} · ${msg.contatto_email} · ${msg.contatto_tel}`], ['Messaggio', msg.testo.length > 600 ? `${msg.testo.slice(0, 600)}…` : msg.testo]],
      cta: { url: ncUrl(nc), label: 'Apri la non conformità' }, footer: 'Notifica interna del sistema td-nc.' }),
  };
}
export function tplSollecito(nc, sede, tipoLabel) {
  return {
    subject: `[${nc.codice}] Sollecito · non conformità in attesa di risposta · accettazione ${nc.accettazione_id}`,
    html: layout({ title: 'Sollecito: risposta attesa', intro: `La non conformità <b>${esc(nc.codice)}</b> inviata a <b>${esc(sede.nome)}</b> non ha ancora ricevuto risposta. Il campione resta bloccato e gli esami non possono essere refertati.`,
      rows: [['Accettazione', nc.accettazione_id], ['Tipologia', tipoLabel], ['Azione richiesta', nc.azione_attesa], ['Scadenza', itDT(nc.sla_due_at)]], cta: { url: ncUrl(nc), label: 'Rispondi ora' } }),
  };
}
export function tplEscalation(nc, sede, tipoLabel) {
  return {
    subject: `[${nc.codice}] ESCALATION · nessuna risposta da ${sede.nome} · accettazione ${nc.accettazione_id}`,
    html: layout({ title: 'Escalation: sede senza risposta', intro: `La sede <b>${esc(sede.nome)}</b> non ha risposto alla non conformità <b>${esc(nc.codice)}</b> entro i termini. Serve un contatto diretto (telefono) o una decisione sul trattamento del campione.`,
      rows: [['Accettazione', nc.accettazione_id], ['Tipologia', tipoLabel], ['Gravità', GRAVITA[nc.gravita]], ['Scadenza superata', itDT(nc.sla_due_at)], ['Telefono sede', sede.telefono || 'non censito']],
      cta: { url: ncUrl(nc), label: 'Apri la non conformità' }, footer: 'Notifica interna del sistema td-nc.' }),
  };
}
export function tplChiusura(nc, sede, esito) {
  return {
    subject: `[${nc.codice}] Non conformità chiusa · accettazione ${nc.accettazione_id}`,
    html: layout({ title: 'Non conformità chiusa', intro: `La non conformità <b>${esc(nc.codice)}</b> relativa all'accettazione ${esc(nc.accettazione_id)} (sede ${esc(sede.nome)}) è stata chiusa dal laboratorio.`,
      rows: [['Esito', esito || '–']], cta: { url: ncUrl(nc), label: 'Consulta il fascicolo' }, outro: 'Vi ringraziamo per la collaborazione. Le non conformità ricorrenti vengono analizzate periodicamente insieme alle sedi per migliorare la fase pre-analitica.' }),
  };
}
export function tplTest(to) {
  return { subject: 'td-nc · email di prova', html: layout({ title: 'Email di prova', intro: `Configurazione email funzionante. Destinatario: ${esc(to)}.`, footer: 'Notifica interna del sistema td-nc.' }) };
}
