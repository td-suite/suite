// Regole dell'invio automatico del referto al mittente della mail (richiesta del CEO del 31/10/2026). Funzioni pure: nessun accesso
// al database né alla posta, così si provano con node --test (server/test/referti-casella.test.mjs).

export const RE_EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;
export const emailValida = (s) => RE_EMAIL.test(String(s || '').trim());

/**
 * Cosa fare di una scheda appena nata dalla casella template@:
 *  - coerenza tutta verde e nessuna anomalia → conferma automatica (confirmed_by NULL, registro CONFERMATA_AUTO) e, se "Invia al
 *    mittente" è acceso e il mittente ha un indirizzo valido, invio del PDF;
 *  - altrimenti resta BOZZA con notifica in app ai profili LAB ("referto da verificare: <nome file>"); l'invio partirà alla conferma
 *    manuale.
 * Le schede caricate dall'Inbox (UPLOAD) non hanno flusso automatico.
 * Restituisce { conferma, invia, notifica, motivo }.
 */
export function decisioneAutomatica({ origine, coerenzaOk, anomalie = 0, invioAttivo, fromEmail }) {
  if (origine !== 'CASELLA') return { conferma: false, invia: false, notifica: false, motivo: 'caricata dall\'Inbox: nessun flusso automatico' };
  const nAnomalie = Array.isArray(anomalie) ? anomalie.length : Number(anomalie || 0);
  if (!coerenzaOk || nAnomalie > 0) {
    const perche = [!coerenzaOk && 'controllo di coerenza non superato', nAnomalie > 0 && `${nAnomalie} ${nAnomalie === 1 ? 'anomalia' : 'anomalie'}`].filter(Boolean).join(' e ');
    return { conferma: false, invia: false, notifica: true, motivo: `resta in bozza: ${perche}` };
  }
  if (!invioAttivo) return { conferma: true, invia: false, notifica: false, motivo: 'confermata; invio al mittente spento nelle Impostazioni' };
  if (!emailValida(fromEmail)) return { conferma: true, invia: false, notifica: true, motivo: 'confermata; indirizzo del mittente assente o non valido' };
  return { conferma: true, invia: true, notifica: false, motivo: 'confermata e inviata al mittente' };
}

/**
 * Invio alla conferma (automatica o manuale) e ai pulsanti "Invia al mittente" / "Reinvia":
 * mai due volte lo stesso file allo stesso destinatario senza un'azione esplicita.
 *  - esplicito (pulsante "Reinvia"): sempre ammesso se c'è un indirizzo valido;
 *  - alla conferma (automatico o manuale con l'interruttore acceso): solo se il referto non è mai stato inviato a quel destinatario
 *    (dopo una riapertura e una nuova conferma la Suite propone "Reinvia al mittente", non reinvia da sola);
 *  - "Invia al mittente" manuale (non esplicito): ammesso se quel file non è già partito per quel destinatario.
 * invii: [{ to_email, stato, file_sha256 }]. Restituisce { invia, motivo }.
 */
export function puoInviare({ toEmail, fileSha256, invii = [], allaConferma = false, esplicito = false, invioAttivo = true }) {
  if (!emailValida(toEmail)) return { invia: false, motivo: 'indirizzo del mittente assente o non valido' };
  if (!fileSha256) return { invia: false, motivo: 'PDF del referto non disponibile (attiva "Genera anche il PDF")' };
  if (esplicito) return { invia: true, motivo: 'reinvio richiesto' };
  const to = String(toEmail).trim().toLowerCase();
  const partiti = invii.filter((i) => ['INVIATO', 'REGISTRATO'].includes(i.stato) && String(i.to_email || '').toLowerCase() === to);
  if (allaConferma) {
    if (!invioAttivo) return { invia: false, motivo: 'invio al mittente spento nelle Impostazioni' };
    if (partiti.length) return { invia: false, motivo: 'già inviato in precedenza: usa "Reinvia al mittente"' };
    return { invia: true, motivo: 'prima conferma' };
  }
  if (partiti.some((i) => i.file_sha256 === fileSha256)) return { invia: false, motivo: 'questo PDF è già stato inviato a questo indirizzo: usa "Reinvia"' };
  return { invia: true, motivo: 'invio manuale' };
}

/** Oggetto della mail: "Toscana Diagnostica · Referto COGNOME NOME" (nessun dato clinico, né nel corpo). */
export const oggettoReferto = (cognomeNome) => `Toscana Diagnostica · Referto ${String(cognomeNome || '').replace(/\s+/g, ' ').trim().toUpperCase()}`.trim();

/** Indirizzo del mittente da un campo From ("Nome <a@b.it>" o "a@b.it"). */
export function indirizzoDa(from) {
  const s = String(from || '').trim();
  const m = s.match(/<([^>]+)>/);
  const a = (m ? m[1] : s).trim().toLowerCase();
  return emailValida(a) ? a : '';
}

/** Allegato PDF utile (non loghi o firme incorporati). */
export const allegatoPdf = (nome, mime) => (/\.pdf$/i.test(String(nome || '')) || /^application\/pdf$/i.test(String(mime || ''))) && !/^(image\d*|logo|firma|signature)\b/i.test(String(nome || ''));
