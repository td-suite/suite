// Rimborso Spese · invio del PDF di approvazione (richiesta del CEO del 13/11/2026: "Dopo che il rimborso spese è stato approvato, invia
// il PDF di approvazione a Poggiali Angela e Caiani Matteo. Invia la mail da people@toscanadiagnostica.it").
// A ogni passaggio ad APPROVATA (manuale o automatico del vertice) parte UNA email con il PDF della nota approvata ai destinatari di
// Impostazioni (destinatari_approvazione: ESTERNI all'azienda) dal mittente mittente_approvazione (people@), con sendMail della Suite
// (parametro `from`: Graph /users/<from>/sendMail; registro email_log con from_addr). Solo il PDF, salvo allega_giustificativi.
// Un errore d'invio NON annulla l'approvazione: si registra (email_log, evento PDF_APPROVAZIONE, esito sulla nota) e P&C o il titolare
// usano "Reinvia". Una nota riapprovata dopo un rimando parte con l'oggetto "(aggiornata)". Interruttore invio_approvazione_attivo.
import { q, many } from '../db.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { readBuffer } from '../../../lib/moduleStorage.js';
import { sanitizeFilename } from '../../../lib/blob.js';
import { settings, perimetro, caricaNota, evento, escapeHtml } from './core.js';
import { nomeMese, eur, destinatariValidi } from './calcoli.js';
import { scheda } from './scheda.js';
import { notaPdf } from './pdf.js';

let invio = sendMail;
/** Solo per i test: mailer finto (null ripristina sendMail) */
export const _impostaInvio = (fn) => { invio = fn || sendMail; };

const dataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** Oggetto dell'email (funzione pura) */
export const oggettoApprovazione = (persona, anno, mese, aggiornata = false) => `Rimborso spese approvato · ${persona} · ${nomeMese(anno, mese)}${aggiornata ? ' (aggiornata)' : ''}`;

/** Contesto di sistema per comporre la scheda (sola lettura, numero di carta mascherato) */
async function ctxSistema() {
  const s = await settings();
  const perim = await perimetro();
  return { settings: s, perim, personId: null, isPC: false, isTitolare: false, ruolo: () => ({}) };
}

/**
 * Invia il PDF della nota approvata. Ritorna { esito: 'INVIATA'|'ERRORE'|'SALTATA', errore?, destinatari, from }. Non lancia mai errori.
 * opts: { userId (chi ha causato l'invio), reinvio }
 */
export async function inviaPdfApprovazione(notaId, { userId = null, reinvio = false } = {}) {
  try {
    const s = await settings();
    const n = await caricaNota(notaId);
    if (!n || !['APPROVATA', 'IN_LIQUIDAZIONE', 'LIQUIDATA', 'ARCHIVIATA'].includes(n.stato)) return { esito: 'SALTATA', errore: 'nota non approvata' };
    const dest = destinatariValidi(s.destinatari_approvazione);
    const from = String(s.mittente_approvazione || 'people@toscanadiagnostica.it').trim();
    if (s.invio_approvazione_attivo === false || !dest.length) {
      const motivo = s.invio_approvazione_attivo === false ? 'invio del PDF di approvazione disattivato in Impostazioni' : 'nessun destinatario configurato';
      await q(`UPDATE note SET email_approvazione_esito='SALTATA', email_approvazione_errore=$2, email_approvazione_at=now() WHERE id=$1`, [n.id, motivo]);
      await evento(n.id, 'PDF_APPROVAZIONE', { userId, testo: `non inviato: ${motivo}`, dati: { esito: 'SALTATA' } });
      return { esito: 'SALTATA', errore: motivo, destinatari: [], from };
    }
    // "(aggiornata)": c'è già stato un invio riuscito per un'approvazione precedente (nota rimandata e riapprovata)
    const precedenti = await many(`SELECT dati FROM eventi WHERE nota_id=$1 AND tipo='PDF_APPROVAZIONE' AND dati->>'esito'='INVIATA'`, [n.id]);
    const approvazione = new Date(n.approvata_at).toISOString();
    const aggiornata = precedenti.some((e) => e.dati?.approvata_at && e.dati.approvata_at !== approvazione);
    const sc = await scheda(n, await ctxSistema(), { perPdf: true });
    const pdf = await notaPdf(sc);
    const nomeFile = sanitizeFilename(`Nota_spese_${n.anno}-${String(n.mese).padStart(2, '0')}_${n.persona}_approvata.pdf`);
    const attachments = [{ filename: nomeFile, content: pdf, contentType: 'application/pdf' }];
    if (s.allega_giustificativi) {
      for (const a of await many(`SELECT * FROM allegati WHERE nota_id=$1 AND riga_tipo <> 'NOTA' ORDER BY id`, [n.id])) {
        const buf = await readBuffer(a).catch(() => null);
        if (buf) attachments.push({ filename: `${a.id}_${a.filename}`, content: buf, contentType: a.mime || 'application/octet-stream' });
      }
    }
    const approvatore = n.approvazione_automatica ? 'approvazione automatica del vertice dell\'organigramma' : (n.approvata_persona_nome || n.approvata_da_nome || 'responsabile');
    const subject = oggettoApprovazione(n.persona, n.anno, n.mese, aggiornata);
    const righe = [['Dipendente', n.persona], ['Mese', nomeMese(n.anno, n.mese)], ['Totale rimborsabile', eur(n.tot_rimborsabile)], ['Approvata da', approvatore], ['Approvata il', dataOra(n.approvata_at)]];
    const html = layout('Rimborso spese approvato', `<p>Gentili,</p><p>in allegato la nota spese approvata${aggiornata ? ' (versione aggiornata dopo una nuova approvazione)' : ''}.</p>
      <table style="border-collapse:collapse;font-size:14px">${righe.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#5b6f75">${k}</td><td style="padding:3px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>
      <p>Cordiali saluti,<br>People · Toscana Diagnostica</p>`, { footer: 'Documento con dati personali del dipendente: uso riservato alla gestione delle retribuzioni.' });
    let r;
    try { r = await invio({ to: dest.map((d) => d.email), subject, html, attachments, from, ref: `rimborsi:${n.id}:approvazione` }); } catch (e) { r = { ok: false, error: e.message }; }
    const ok = Boolean(r?.ok);
    const errore = ok ? null : String(r?.error || 'errore sconosciuto').slice(0, 500);
    await q(`UPDATE note SET email_approvazione_esito=$2, email_approvazione_errore=$3, email_approvazione_at=now() WHERE id=$1`, [n.id, ok ? 'INVIATA' : 'ERRORE', errore]);
    const elenco = dest.map((d) => (d.nome ? `${d.nome} <${d.email}>` : d.email)).join(', ');
    await evento(n.id, 'PDF_APPROVAZIONE', { userId, testo: ok ? `PDF di approvazione inviato a ${elenco}${aggiornata ? ' (aggiornata)' : ''}` : `PDF di approvazione NON inviato a ${elenco}: ${errore}`,
      dati: { esito: ok ? 'INVIATA' : 'ERRORE', errore, destinatari: dest.map((d) => d.email), from, log_id: r?.logId || null, aggiornata, reinvio, approvata_at: approvazione, allegati: attachments.length } });
    return { esito: ok ? 'INVIATA' : 'ERRORE', errore, destinatari: dest, from, aggiornata };
  } catch (e) {
    console.error('[rimborsi:invio-approvazione]', e.message);
    await q(`UPDATE note SET email_approvazione_esito='ERRORE', email_approvazione_errore=$2, email_approvazione_at=now() WHERE id=$1`, [notaId, e.message.slice(0, 500)]).catch(() => {});
    await evento(notaId, 'PDF_APPROVAZIONE', { userId, testo: `PDF di approvazione NON inviato: ${e.message}`, dati: { esito: 'ERRORE', errore: e.message } }).catch(() => {});
    return { esito: 'ERRORE', errore: e.message };
  }
}

