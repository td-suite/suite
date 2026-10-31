// Casella template@toscanadiagnostica.it (richiesta del CEO del 31/10/2026): "metti in lettura la mail template@. I PDF che arrivano
// mettili in lavorazione da trasformare. Una volta riprodotto il referto, invialo in automatico da template@ al mittente della mail".
// - Lettura (job referti:inbox ogni 10 minuti, lib condivisa server/src/lib/graphInbox.js): ogni messaggio nuovo con allegati PDF
//   diventa un'elaborazione per allegato (origine CASELLA, dedupe su graph_id + sha256), il parser crea le schede in BOZZA; i messaggi
//   senza PDF si ignorano con una riga nel registro. Ogni messaggio letto resta in messaggi_casella.
// - Flusso automatico (lib/regoleInvio.js decisioneAutomatica): coerenza verde e nessuna anomalia → conferma automatica e invio del PDF
//   al mittente; altrimenti BOZZA con notifica in app ai profili LAB e invio alla conferma manuale.
// - Invio: lib/mailer.js della Suite con from = casella (Mail.Send applicativo su template@), oggetto "Toscana Diagnostica · Referto
//   COGNOME NOME", corpo senza dati clinici, PDF allegato; esito in invii (INVIATO, REGISTRATO, FALLITO).
// Privacy: nei log del server solo id e conteggi; nel registro email della Suite l'oggetto è "Referto (scheda N)", mai il nome.
import { randomUUID } from 'node:crypto';
import { one, many, q } from '../db.js';
import { config, MAILBOX_DEFAULT } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail } from '../../../lib/mailer.js';
import { notify, adminUserIds } from '../../../lib/community.js';
import { graphConfigured, graphToken, tokenRoles, resolveMailbox, messaggiDa, allegatiFile, provaCasella, motivoLettura, motivoInvio } from '../../../lib/graphInbox.js';
import { settings, setSetting, registra, elaboraUpload, confermaScheda } from './core.js';
import { readBuffer, sha256 } from './storage.js';
import { HttpError } from '../../../lib/util.js';
import { decisioneAutomatica, puoInviare, oggettoReferto, indirizzoDa, allegatoPdf, emailValida } from './regoleInvio.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- Casella e impostazioni
export async function casella(imp = null) {
  if (config.mailboxEnv) return { address: config.mailboxEnv, source: 'env' };
  const s = imp || await settings();
  const a = String(s.casella_indirizzo || '').trim().toLowerCase();
  return { address: a || MAILBOX_DEFAULT, source: a && a !== MAILBOX_DEFAULT ? 'setting' : 'default' };
}

export async function statoCasella() {
  const imp = await settings();
  const mb = await casella(imp);
  const m = await one(`SELECT count(*)::int AS letti, count(*) FILTER (WHERE esito='IMPORTATO')::int AS importati, count(*) FILTER (WHERE esito='IGNORATO')::int AS ignorati,
    count(*) FILTER (WHERE simulato)::int AS simulati FROM messaggi_casella`);
  const inv = await one(`SELECT count(*) FILTER (WHERE stato='INVIATO')::int AS inviati, count(*) FILTER (WHERE stato='REGISTRATO')::int AS registrati, count(*) FILTER (WHERE stato='FALLITO')::int AS falliti,
    max(at) FILTER (WHERE stato IN ('INVIATO','REGISTRATO')) AS ultimo_invio, max(at) FILTER (WHERE stato='FALLITO') AS ultimo_fallito FROM invii`);
  const fallito = inv.ultimo_fallito && (!inv.ultimo_invio || new Date(inv.ultimo_fallito) > new Date(inv.ultimo_invio))
    ? await one(`SELECT errore FROM invii WHERE stato='FALLITO' ORDER BY at DESC, id DESC LIMIT 1`) : null;
  return {
    mailbox: mb.address, mailbox_source: mb.source,
    lettura: imp.casella_lettura !== false, invio: imp.invio_mittente !== false,
    graph_configured: graphConfigured(), mail_provider: suite.mail.provider,
    ultima_lettura: imp.casella_ultima_lettura || null, errore_lettura: imp.casella_errore || null,
    ultimo_invio: inv.ultimo_invio || null, errore_invio: fallito?.errore || null,
    messaggi: m, invii: { inviati: inv.inviati, registrati: inv.registrati, falliti: inv.falliti },
    intervallo_minuti: config.inboxMinutes,
    simulazione: process.env.NODE_ENV !== 'production',
  };
}

// ---- Destinatari delle notifiche in app: profili LAB del modulo (in mancanza, Owner e Admin della Suite)
async function utentiLab() {
  const ids = (await many(`SELECT DISTINCT u.id FROM public.grants g JOIN public.users u ON u.id=g.user_id
    WHERE g.module_key='referti' AND g.profile='LAB' AND NOT g.proposed AND u.status='ACTIVE'`)).map((r) => r.id);
  return ids.length ? ids : adminUserIds();
}
export async function notificaDaVerificare(scheda, filename, motivo) {
  const ids = await utentiLab();
  return notify(ids, { kind: 'MODULO', module_key: 'referti', title: `Referto da verificare: ${String(filename || 'PDF dalla casella').slice(0, 150)}`, body: `Arrivato dalla casella: ${motivo}. Controlla la scheda e confermala: il referto partirà al mittente.`, link: `/referti/schede/${scheda}` }).catch(() => 0);
}

// ---- Invio del PDF prodotto al mittente
function mailReferto() {
  const html = `<!doctype html><html lang="it"><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dbe5e7">
    <div style="background:#004F5F;padding:16px 24px;color:#fff;font-weight:700;font-size:15px">Toscana Diagnostica</div>
    <div style="padding:22px 24px;font-size:14px;line-height:1.55"><p>Gentile cliente,</p><p>in allegato trova il referto in formato PDF.</p><p>Cordiali saluti,<br>Laboratorio di Analisi · Toscana Diagnostica</p></div>
    <div style="padding:12px 24px;background:#f3f6f6;color:#5b6f75;font-size:11.5px">Toscana Diagnostica S.r.l. · Messaggio inviato automaticamente: il documento allegato è riservato al destinatario.</div>
  </div></body></html>`;
  return { html, text: 'Gentile cliente, in allegato trova il referto in formato PDF. Cordiali saluti, Laboratorio di Analisi · Toscana Diagnostica' };
}

/**
 * Invia il PDF della scheda confermata al mittente della mail (from_email dell'elaborazione).
 * opzioni: { userId, automatico, allaConferma, esplicito (Reinvia) }. Restituisce { inviato, stato, motivo, errore, to }.
 */
export async function inviaAlMittente(schedaId, { userId = null, automatico = false, allaConferma = false, esplicito = false } = {}) {
  const s = await one(`SELECT s.id, s.stato, s.cognome_nome, s.nome_file, s.versione, e.origine, e.from_email FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1`, [schedaId]);
  if (!s) return { inviato: false, motivo: 'scheda non trovata' };
  if (s.stato !== 'CONFERMATA') return { inviato: false, motivo: 'il referto non è confermato' };
  const imp = await settings();
  const pdf = await one(`SELECT id, filename, sha256, data, blob_path FROM file_prodotti WHERE scheda_id=$1 AND kind='PDF' ORDER BY id DESC LIMIT 1`, [schedaId]);
  const invii = await many('SELECT to_email, stato, file_sha256 FROM invii WHERE scheda_id=$1', [schedaId]);
  const dec = puoInviare({ toEmail: s.from_email, fileSha256: pdf?.sha256 || null, invii, allaConferma, esplicito, invioAttivo: imp.invio_mittente !== false });
  if (!dec.invia) return { inviato: false, motivo: dec.motivo, to: s.from_email || null };
  const buf = await readBuffer(pdf);
  if (!buf) return { inviato: false, motivo: 'contenuto del PDF non disponibile', to: s.from_email };
  const { address } = await casella(imp);
  const to = String(s.from_email).trim().toLowerCase();
  const { html, text } = mailReferto();
  const out = await sendMail({ from: address, to: [to], subject: oggettoReferto(s.cognome_nome), logSubject: `Toscana Diagnostica · Referto (scheda ${s.id})`, html, text, ref: `referti:scheda:${s.id}`,
    attachments: [{ filename: `${s.nome_file || 'Referto'}.pdf`, content: buf, contentType: 'application/pdf' }] });
  const stato = !out.ok ? 'FALLITO' : out.logged ? 'REGISTRATO' : 'INVIATO';
  const errore = out.ok ? null : motivoInvio(out.error || 'Invio non riuscito', address);
  await q(`INSERT INTO invii (scheda_id, to_email, from_email, stato, message_id, errore, file_sha256, versione, automatico, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [s.id, to, address, stato, out.logId ? `email_log:${out.logId}` : null, errore, pdf.sha256, s.versione || 1, automatico, automatico ? null : userId]);
  await registra(stato === 'FALLITO' ? 'INVIO_FALLITO' : 'INVIATO', { scheda_id: s.id, user_id: automatico ? null : userId, dettagli: { to_email: to, from: address, stato, automatico, reinvio: esplicito || undefined, versione: s.versione || 1, errore: errore || undefined } });
  console.log(`[referti] invio scheda ${s.id}: ${stato}${automatico ? ' (automatico)' : ''}`);   // solo id ed esito
  return { inviato: stato !== 'FALLITO', stato, errore, to, motivo: dec.motivo };
}

// Dopo una conferma manuale (o "Conferma tutte le verdi"): se la scheda viene dalla casella e l'interruttore è acceso, il PDF parte al
// mittente, ma solo la prima volta (dopo una riapertura la Suite propone "Reinvia")
export async function dopoConferma(schedaId, userId) {
  const e = await one('SELECT e.origine FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1', [schedaId]);
  if (e?.origine !== 'CASELLA') return null;
  return inviaAlMittente(schedaId, { userId, allaConferma: true });
}

// ---- Flusso automatico di una scheda nata dalla casella
export async function flussoAutomatico(scheda, { filename, fromEmail }) {
  const imp = await settings();
  const anomalie = scheda.anomalie || [];
  let coerenzaOk = true;   // con anomalie non si prova nemmeno a confermare (resta BOZZA per le anomalie)
  let confermata = null;
  if (!anomalie.length) {
    try { confermata = await confermaScheda(scheda.id, null, { automatica: true }); coerenzaOk = confermata.coerenza.ok; }
    catch (e) { if (e instanceof HttpError && e.status === 400) coerenzaOk = false; else throw e; }
  }
  const dec = decisioneAutomatica({ origine: 'CASELLA', coerenzaOk, anomalie, invioAttivo: imp.invio_mittente !== false, fromEmail });
  let invio = null;
  if (confermata && dec.invia) invio = await inviaAlMittente(scheda.id, { automatico: true, allaConferma: true });
  if (!confermata || dec.notifica) await notificaDaVerificare(scheda.id, filename, dec.motivo);
  return { scheda_id: scheda.id, confermata: Boolean(confermata), invio: invio ? invio.stato || null : null, motivo: dec.motivo };
}

// ---- Ingest di un messaggio (lettura Graph o simulazione di collaudo)
// files: [{ filename, mime, buffer }]
export async function ingestMessaggio({ graphId, messageId = null, receivedAt = null, fromEmail, fromName = null, subject = '', files = [], simulato = false }) {
  if (await one('SELECT 1 FROM messaggi_casella WHERE graph_id=$1', [graphId])) return { duplicato: true };
  const from = indirizzoDa(fromEmail);
  const pdf = (files || []).filter((f) => f?.buffer?.length && allegatoPdf(f.filename, f.mime));
  const salva = (esito, n, dettaglio = null) => q(`INSERT INTO messaggi_casella (graph_id, message_id, received_at, from_email, from_name, subject, n_pdf, esito, dettaglio, simulato)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (graph_id) DO UPDATE SET esito=EXCLUDED.esito, n_pdf=EXCLUDED.n_pdf, dettaglio=EXCLUDED.dettaglio, at=now()`,
  [graphId, messageId, receivedAt || new Date(), from || null, fromName ? String(fromName).slice(0, 200) : null, String(subject || '').slice(0, 500), n, esito, dettaglio, simulato]);
  if (!pdf.length) {
    await salva('IGNORATO', 0, 'nessun allegato PDF');
    await registra('CASELLA_IGNORATO', { dettagli: { graph_id: graphId, from_email: from || null, allegati: (files || []).length, motivo: 'nessun allegato PDF', simulato: simulato || undefined } });
    console.log(`[referti] casella: messaggio senza PDF ignorato`);
    return { ignorato: true, elaborazioni: [] };
  }
  const out = [];
  for (const f of pdf) {
    const digest = sha256(f.buffer);
    if (await one('SELECT 1 FROM elaborazioni WHERE graph_id=$1 AND sha256=$2', [graphId, digest])) { out.push({ filename: f.filename, duplicato: true }); continue; }
    let el;
    try {
      el = await elaboraUpload({ buffer: f.buffer, originalname: f.filename || 'referto.pdf' }, null, { origine: 'CASELLA', graph_id: graphId, from_email: from || null, from_name: fromName, subject, received_at: receivedAt || new Date(), message_id: messageId });
    } catch (e) {
      out.push({ filename: f.filename, stato: 'SCARTATO', motivo_scarto: e.message, schede: [] });
      continue;
    }
    const schede = [];
    for (const s of el.schede || []) {
      try { schede.push(await flussoAutomatico(s, { filename: el.filename, fromEmail: from })); }
      catch (e) { console.error(`[referti] flusso automatico della scheda ${s.id} non riuscito:`, e.message); schede.push({ scheda_id: s.id, confermata: false, errore: 'errore interno' }); await notificaDaVerificare(s.id, el.filename, 'errore durante la conferma automatica'); }
    }
    out.push({ id: el.id, filename: el.filename, stato: el.stato, motivo_scarto: el.motivo_scarto || null, schede });
  }
  const importate = out.filter((x) => x.id).length;
  await salva(importate ? 'IMPORTATO' : 'DUPLICATO', pdf.length, out.some((x) => x.stato === 'SCARTATO') ? 'uno o più PDF scartati' : null);
  console.log(`[referti] casella: messaggio con ${pdf.length} PDF, ${importate} elaborazioni, ${out.reduce((n, x) => n + (x.schede || []).length, 0)} schede`);
  return { elaborazioni: out };
}

// ---- Lettura della casella (job referti:inbox e "Leggi ora")
export async function pollCasella({ force = false } = {}) {
  if (!graphConfigured()) return { skipped: 'graph_non_configurato' };
  const imp = await settings();
  if (!force && imp.casella_lettura === false) return { skipped: 'lettura_disattivata' };
  const { address } = await casella(imp);
  const since = imp.casella_since || new Date(Date.now() - 2 * 86400000).toISOString();
  let letti = 0; let importati = 0; let last = since;
  try {
    const id = (await resolveMailbox(address)).id;
    for (const m of await messaggiDa(id, since)) {
      letti++;
      if (m.receivedDateTime > last) last = m.receivedDateTime;
      const from = m.from?.emailAddress || {};
      if (String(from.address || '').toLowerCase() === address) continue;   // le nostre risposte
      if (await one('SELECT 1 FROM messaggi_casella WHERE graph_id=$1', [m.id])) continue;
      const files = m.hasAttachments ? await allegatiFile(id, m.id, (a) => allegatoPdf(a.name, a.contentType)) : [];
      const r = await ingestMessaggio({ graphId: m.id, messageId: m.internetMessageId || null, receivedAt: m.receivedDateTime, fromEmail: from.address, fromName: from.name, subject: m.subject, files });
      if (r.elaborazioni?.some((x) => x.id)) importati++;
    }
    await setSetting('casella_since', last);
    await setSetting('casella_ultima_lettura', new Date().toISOString());
    await setSetting('casella_errore', '');
  } catch (e) {
    await setSetting('casella_errore', motivoLettura(e.message, address));
    throw e;
  }
  return { letti, importati };
}

// ---- Prove dalle Impostazioni
export async function provaLettura() {
  const imp = await settings();
  const { address } = await casella(imp);
  return provaCasella(address, { serveInvio: imp.invio_mittente !== false });
}

export async function provaInvio(to) {
  const addr = String(to || '').trim().toLowerCase();
  if (!emailValida(addr)) return { ok: false, message: 'Indirizzo di prova non valido' };
  const { address } = await casella();
  if (suite.mail.provider === 'graph' && graphConfigured()) {
    try {
      const roles = tokenRoles(await graphToken());
      if (roles && !roles.includes('Mail.Send')) return { ok: false, message: `Permesso Mail.Send mancante sull'app registration della Suite (permesso applicativo Microsoft Graph con consenso amministratore). Presenti: ${roles.join(', ') || 'nessuno'}` };
    } catch (e) { return { ok: false, message: motivoInvio(e.message, address) }; }
  }
  const html = `<p>Email di prova inviata dalla casella <b>${esc(address)}</b> della Suite TD (modulo Referti esterni).</p><p>Se la ricevi, i referti riprodotti partiranno da questo mittente.</p>`;
  const out = await sendMail({ from: address, to: [addr], subject: 'Toscana Diagnostica · prova di invio dei referti', html, text: 'Prova di invio dei referti', ref: 'referti:prova' });
  if (out.ok && !out.logged) return { ok: true, message: `Email di prova inviata da ${address} a ${addr}: verifica la ricezione (e la cartella Posta indesiderata).` };
  if (out.ok && out.logged) return { ok: true, logged: true, message: `Posta in modalità registro (MAIL_PROVIDER=log${graphConfigured() ? '' : ', credenziali Microsoft Graph assenti'}): l'email da ${address} a ${addr} è solo nel registro email, nessun invio reale.` };
  return { ok: false, message: motivoInvio(out.error || 'Invio non riuscito', address) };
}

export const nuovoIdSimulato = () => `SIM-${randomUUID()}`;
