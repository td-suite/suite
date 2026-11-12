// Guida GIPO · filtro dei dati personali nelle domande e nelle ricerche (lato server, prima del salvataggio e prima dell'invio al modello).
// GIPO contiene dati dei pazienti: chi chiede aiuto non deve scriverli. L'avviso fisso nella pagina lo chiede; qui si mascherano i dati
// riconoscibili con certezza: codici fiscali, indirizzi email e numeri lunghi (telefoni, tessere, partite IVA: almeno 9 cifre, separate al più
// da spazi, punti o trattini; le date gg/mm/aaaa e gli importi restano). I nomi delle persone non si riconoscono in modo affidabile: per
// quelli vale l'avviso. Funzioni pure (test: server/test/gipoguida.test.mjs).

// Codice fiscale delle persone fisiche, anche con omocodia (cifre sostituite da L M N P Q R S T U V)
const CF = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// Numeri: + o 00 facoltativo, poi cifre con spazi, punti o trattini tra i gruppi; si maschera solo con almeno 9 cifre in tutto
const NUMERO = /(?:\+|\b00)?\d(?:[\s.-]?\d){5,}/g;

export const ETICHETTE = { cf: 'codice fiscale', email: 'email', telefono: 'numero di telefono o identificativo' };

/**
 * Maschera i dati personali riconoscibili. Ritorna { testo, mascherati: ['codice fiscale', ...] } (categorie trovate, senza ripetizioni).
 */
export function maschera(input) {
  let testo = String(input ?? '');
  const trovati = new Set();
  testo = testo.replace(EMAIL, () => { trovati.add(ETICHETTE.email); return '[email rimossa]'; });
  testo = testo.replace(CF, () => { trovati.add(ETICHETTE.cf); return '[codice fiscale rimosso]'; });
  testo = testo.replace(NUMERO, (m) => {
    const cifre = m.replace(/\D/g, '');
    if (cifre.length < 9) return m;
    trovati.add(ETICHETTE.telefono);
    return '[numero rimosso]';
  });
  return { testo, mascherati: [...trovati] };
}

/** Il testo contiene dati da mascherare? */
export const contieneDatiPersonali = (s) => maschera(s).mascherati.length > 0;

/** Testo per la ricerca: senza i segnaposto del mascheramento (non devono diventare parole da cercare) */
export const senzaSegnaposto = (s) => String(s || '').replace(/\[(codice fiscale rimosso|numero rimosso|email rimossa)\]/g, ' ').replace(/\s+/g, ' ').trim();
