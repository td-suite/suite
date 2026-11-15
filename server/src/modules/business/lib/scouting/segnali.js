// Ricerca prospect · catalogo dei SEGNALI: fatti verificabili letti dal sito della struttura che dicono perché può interessarci.
// Ogni segnale porta la frase e la pagina da cui è stato letto. Un segnale debole non si registra: un dato sbagliato in un primo
// contatto è peggio di nessun dato. Funzioni pure: `rileva({ pagine, candidato, fornitori })` → { valore, evidenza, url } | null.
import { frase } from './estrai.js';

export const FORNITORI_PREDEFINITI = ['Synlab', 'Bianalisi', 'Cerba', 'Lifebrain', 'PAIM', 'Rete Diagnostica Italiana', 'Biolab', 'Alliance Medical', 'Affidea', 'Centro Diagnostico Italiano', 'Lab Service'];

function trova(pagine, re) {
  for (const p of pagine) { const m = re.exec(p.testo); re.lastIndex = 0; if (m) return { m, url: p.url, evidenza: frase(p.testo, m.index, m[0].length) }; }
  return null;
}
function tutte(pagine, re) {
  const out = [];
  for (const p of pagine) for (const m of p.testo.matchAll(re)) out.push({ m, url: p.url, evidenza: frase(p.testo, m.index, m[0].length) });
  return out;
}
const si = (t) => (t ? { valore: true, evidenza: t.evidenza, url: t.url } : null);
const numeroMax = (pagine, re, { min = 1, max = 99999 } = {}) => {
  const v = tutte(pagine, re).map((x) => ({ ...x, n: Number(String(x.m[1]).replace(/\./g, '')) })).filter((x) => x.n >= min && x.n <= max).sort((a, b) => b.n - a.n)[0];
  return v ? { valore: v.n, evidenza: v.evidenza, url: v.url } : null;
};

export const SEGNALI = [
  // ---- profilo: cosa fa la struttura
  { key: 'PRELIEVI_IN_SEDE', gruppo: 'Laboratorio', etichetta: 'Fa prelievi o analisi', descrizione: 'Il sito parla di punto prelievi, analisi del sangue o esami di laboratorio: qualcuno glieli esegue.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /punto\s+prelievi?|centro\s+prelievi?|prelievi?\s+(?:ematic[io]|del\s+sangue|venos[io])|analisi\s+(?:del\s+sangue|cliniche|di\s+laboratorio)|esami\s+(?:del\s+sangue|ematochimici|di\s+laboratorio)|laboratorio\s+(?:di\s+)?analisi/i)) },
  { key: 'PRELIEVI_DOMICILIO', gruppo: 'Laboratorio', etichetta: 'Prelievi a domicilio', descrizione: 'Offre il prelievo a casa del paziente.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /prelievi?\s+(?:a|al)\s+domicilio|prelievo\s+domiciliare/i)) },
  { key: 'LAB_INTERNO', gruppo: 'Laboratorio', etichetta: 'Laboratorio interno dichiarato', descrizione: 'Dice di avere un laboratorio proprio: il service può riguardare gli esami di secondo livello.', linee: ['SRV'],
    rileva: ({ pagine }) => si(trova(pagine, /laboratorio\s+(?:di\s+)?analisi\s+(?:cliniche\s+)?(?:intern[oa]|propri[oa]|della\s+struttura)|(?:nostro|proprio)\s+laboratorio|laboratorio\s+intern[oa]/i)) },
  { key: 'FORNITORE_LAB', gruppo: 'Laboratorio', etichetta: 'Fornitore di laboratorio citato', descrizione: 'Il sito nomina il laboratorio con cui lavora oggi. Si registra solo se il nome compare vicino a parole come "in collaborazione con", "convenzione", "service", "laboratorio".', linee: ['SRV', 'PP'],
    rileva: ({ pagine, fornitori }) => {
      for (const f of fornitori || FORNITORI_PREDEFINITI) {
        const nome = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const forte = trova(pagine, new RegExp(`(?:in\\s+collaborazione\\s+con|convenzion\\w+\\s+con|service|partner|esegu\\w+\\s+(?:da|presso|dal)|presso\\s+(?:il\\s+)?laboratori\\w*|laboratorio)[^.\\n]{0,90}(?<![A-Za-z])${nome}(?![A-Za-z])|(?<![A-Za-z])${nome}(?![A-Za-z])[^.\\n]{0,60}(?:laboratori|analisi|service|convenzion)`, 'i'));
        if (forte) return { valore: f, evidenza: forte.evidenza, url: forte.url };
      }
      return null;
    } },
  { key: 'ACCREDITATO', gruppo: 'Struttura', etichetta: 'Accreditata o convenzionata', descrizione: 'Dichiara l\'accreditamento o la convenzione con il Servizio Sanitario.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /accreditat[oaie]\s+(?:con\s+(?:il|la)\s+|dal(?:la)?\s+|presso\s+(?:il|la)\s+)?(?:ssn|ssr|s\.s\.n\.|servizio\s+sanitario|regione)|convenzionat[oaie]\s+(?:con\s+(?:il|la|l['’])\s*)?(?:ssn|ssr|s\.s\.n\.|asl|usl|ausl|servizio\s+sanitario)|struttura\s+(?:sanitaria\s+)?accreditata|accreditamento\s+istituzionale/i)) },
  { key: 'GRUPPO', gruppo: 'Struttura', etichetta: 'Fa parte di un gruppo', descrizione: 'Il sito dichiara l\'appartenenza a un gruppo: la trattativa può essere di gruppo.', linee: ['SRV', 'PP', 'MDL'],
    rileva: ({ pagine }) => {
      const t = trova(pagine, /(?:fa\s+parte|parte|società|struttura|membro|azienda|residenza|centro)\s+del\s+(Gruppo\s+[A-ZÀ-Ý][\wÀ-ÿ&'’-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ&'’-]*){0,2})/);
      return t ? { valore: t.m[1].replace(/\s+/g, ' '), evidenza: t.evidenza, url: t.url } : null;
    } },
  { key: 'POSTI_LETTO', gruppo: 'Struttura', etichetta: 'Posti letto', descrizione: 'Numero di posti letto dichiarato: misura la dimensione di una RSA o di una casa di cura.', linee: ['SRV'], numerico: true,
    rileva: ({ pagine }) => numeroMax(pagine, /(\d{1,4})\s+posti(?:\s|-)letto/gi, { min: 5, max: 2000 }) },
  { key: 'SEDI_MULTIPLE', gruppo: 'Struttura', etichetta: 'Più sedi', descrizione: 'Numero di sedi, strutture o centri dichiarato.', linee: ['SRV', 'PP', 'MDL'], numerico: true,
    rileva: ({ pagine }) => numeroMax(pagine, /(\d{1,3})\s+(?:sedi|strutture|centri|residenze|ambulatori|punti\s+prelievo|farmacie|stabilimenti|filiali)\b/gi, { min: 2, max: 500 }) },
  { key: 'DIAGNOSTICA_IMMAGINI', gruppo: 'Struttura', etichetta: 'Diagnostica per immagini', descrizione: 'Offre risonanza, TAC, ecografie, radiologia o mammografia.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /risonanza\s+magnetica|\btac\b|ecografi[ae]|radiologia|mammografi[ae]|diagnostica\s+per\s+immagini/i)) },
  { key: 'MEDICINA_LAVORO', gruppo: 'Struttura', etichetta: 'Parla di medicina del lavoro', descrizione: 'Offre o cita medicina del lavoro e sorveglianza sanitaria: per una struttura è un possibile partner o concorrente, per un\'azienda dice che il tema è presidiato.', linee: ['SRV', 'MDL'],
    rileva: ({ pagine }) => si(trova(pagine, /medicina\s+del\s+lavoro|sorveglianza\s+sanitaria|medico\s+competente/i)) },
  { key: 'PRENOTAZIONE_ONLINE', gruppo: 'Struttura', etichetta: 'Prenotazione online', descrizione: 'Il sito ha una prenotazione online o rimanda a una piattaforma di prenotazione.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => { for (const p of pagine) { const m = /miodottore\.it|doctolib|tuotempo|cupsolidale|prenota(?:zione)?\s+on\s?-?line|prenota\s+(?:ora|subito|una\s+visita|un\s+esame)/i.exec(`${p.html || ''}`.slice(0, 600000)); if (m) return { valore: true, evidenza: `Trovato nella pagina: "${m[0]}"`, url: p.url }; } return null; } },
  // ---- azienda (medicina del lavoro)
  { key: 'DIPENDENTI', gruppo: 'Azienda', etichetta: 'Numero di dipendenti', descrizione: 'Dimensione dichiarata dell\'organico: misura il valore della sorveglianza sanitaria.', linee: ['MDL', 'SRV'], numerico: true,
    rileva: ({ pagine }) => numeroMax(pagine, /(\d{2,5}|\d{1,3}\.\d{3})\s+(?:dipendenti|collaboratori|addetti|lavoratori|professionisti|operatori)\b/gi, { min: 10, max: 99999 }) },
  { key: 'CERTIFICAZIONI', gruppo: 'Azienda', etichetta: 'Certificazioni ISO', descrizione: 'Certificazioni dichiarate (9001 qualità, 45001 salute e sicurezza, 15189 laboratori, 14001 ambiente).', linee: ['SRV', 'MDL'],
    rileva: ({ pagine }) => { const v = [...new Set(tutte(pagine, /iso\s?(9001|45001|15189|14001|13485)/gi).map((x) => `ISO ${x.m[1]}`))]; const t = trova(pagine, /iso\s?(?:9001|45001|15189|14001|13485)/i); return v.length ? { valore: v.join(', '), evidenza: t.evidenza, url: t.url } : null; } },
  { key: 'ASSUME', gruppo: 'Azienda', etichetta: 'Sta assumendo', descrizione: 'Ha posizioni aperte: l\'attività cresce.', linee: ['SRV', 'MDL', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /posizioni\s+aperte|stiamo\s+cercando|(?:cerchiamo|ricerchiamo|selezioniamo|assumiamo)\s+[a-zà-ÿ]/i)) },
  { key: 'ASSUME_SANITARI', gruppo: 'Azienda', etichetta: 'Cerca personale sanitario', descrizione: 'Cerca infermieri, OSS, biologi, tecnici di laboratorio o medici.', linee: ['SRV', 'PP'],
    rileva: ({ pagine }) => si(trova(pagine, /(?:cerchiamo|ricerchiamo|selezioniamo|assumiamo|ricerca\s+di|posizion\w+\s+apert\w+|candidat\w+)[^.\n]{0,140}(?:infermier|\boss\b|operator\w+\s+socio|biolog|tecnic\w+\s+(?:di\s+)?laboratorio|medic[oi]\b)/i)) },
];
export const SEGNALI_DERIVATI = [
  { key: 'SENZA_SITO', gruppo: 'Contatto', etichetta: 'Senza sito', descrizione: 'La fonte non riporta un sito: si profila solo dopo averlo indicato a mano.' },
  { key: 'DIRETTORE_SANITARIO_NOTO', gruppo: 'Persone', etichetta: 'Direttore sanitario noto', descrizione: 'Il sito pubblica il nome del direttore sanitario.' },
  { key: 'DECISORE_NOTO', gruppo: 'Persone', etichetta: 'Decisore noto', descrizione: 'Il sito nomina chi dirige o rappresenta la struttura.' },
  { key: 'EMAIL_GENERALE', gruppo: 'Contatto', etichetta: 'Email generale pubblicata', descrizione: 'Un indirizzo generale (direzione, segreteria, info) pubblicato dalla struttura.' },
  { key: 'EMAIL_DECISORE', gruppo: 'Contatto', etichetta: 'Email di un decisore', descrizione: 'Indirizzo pubblicato di una persona chiave, o ipotesi dallo schema degli indirizzi del dominio.' },
  { key: 'SCHEMA_EMAIL', gruppo: 'Contatto', etichetta: 'Schema degli indirizzi', descrizione: 'Come sono fatti gli indirizzi del dominio (es. nome.cognome), imparato da un indirizzo pubblicato.' },
  { key: 'PEC_NOTA', gruppo: 'Contatto', etichetta: 'PEC pubblicata', descrizione: 'Indirizzo PEC letto dal sito.' },
  { key: 'PIVA_NOTA', gruppo: 'Contatto', etichetta: 'Partita IVA pubblicata', descrizione: 'Partita IVA valida letta dal sito: serve per non creare doppioni in anagrafica.' },
  { key: 'DOMINIO_RICEVE_POSTA', gruppo: 'Contatto', etichetta: 'Il dominio riceve posta', descrizione: 'Il dominio del sito ha un servizio di posta attivo.' },
];
export const CATALOGO = [...SEGNALI, ...SEGNALI_DERIVATI].map(({ rileva: _r, ...s }) => s);

/** Esegue i segnali attivi sulle pagine lette: { CHIAVE: { valore, evidenza, url } } */
export function rilevaSegnali({ pagine, candidato = {}, fornitori = null, attivi = null, linea = null }) {
  const out = {};
  for (const s of SEGNALI) {
    if (attivi && attivi[s.key] === false) continue;
    if (linea && s.linee && !s.linee.includes(linea)) continue;
    try { const v = s.rileva({ pagine, candidato, fornitori }); if (v) out[s.key] = v; } catch { /* un segnale che sbaglia non ferma gli altri */ }
  }
  return out;
}
