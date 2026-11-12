// Guida GIPO · domande del personale (POST /api/gipoguida/chiedi).
// 1. il testo si maschera (codici fiscali, email, numeri lunghi) PRIMA di salvarlo e di inviarlo al modello;
// 2. si recuperano le sezioni e le FAQ più pertinenti (al più 6, ricerca full text della guida);
// 3. con l'intelligenza artificiale configurata (aiEnabled del wrapper della Suite, tipo 'gipoguida' in ai_log) Claude risponde in italiano
//    SOLO sulla base di quei brani, in passi numerati, citando le sezioni usate e dichiarando quando la guida non copre la domanda;
// 4. senza AI, se l'AI non risponde o senza brani pertinenti: i migliori risultati della ricerca, esito SOLO_RICERCA o SENZA_RISPOSTA.
// Ogni domanda si registra (tabella domande); SENZA_RISPOSTA e le risposte giudicate "non utili" entrano nella coda della redazione.
import { q, one } from '../db.js';
import { HttpError } from '../../../lib/util.js';
import { config } from '../config.js';
import { maschera, senzaSegnaposto } from './privacy.js';
import { cercaGuida } from './ricerca.js';

// ---------------------------------------------------------------- modello (sostituibile nei test)
let sostituto;   // undefined = wrapper reale; false = AI spenta; function = modello finto ({ system, user }) → { testo, fonti, copre }
export function _impostaModello(fn) { sostituto = fn; }
async function aiAttiva() {
  if (sostituto === false) return false;
  if (typeof sostituto === 'function') return true;
  const { aiEnabled } = await import('../../../lib/claude.js');
  return aiEnabled();
}
async function chiamaModello({ system, user, userId, query }) {
  if (typeof sostituto === 'function') return sostituto({ system, user, userId, query });
  const { askJson } = await import('../../../lib/claude.js');
  return askJson({ kind: 'gipoguida', system, user, maxTokens: 1800, userId, query, timeoutMs: config.aiTimeoutMs });
}
async function nomeModello() {
  if (typeof sostituto === 'function') return 'modello di prova';
  const { config: suite } = await import('../../../config.js');
  return suite.anthropic?.model || null;
}

// ---------------------------------------------------------------- testo
/** Pulizia del testo del modello: niente emoji, niente trattini lunghi, niente "approfondire"; gli a capo restano (passi numerati). */
export function pulisci(s, max = 6000) {
  let t = String(s || '')
    .replace(/[\u2013\u2014\u2015]/g, ', ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/approfondir(e|ne|lo|la|li|le)?/gi, 'verificare meglio')
    .replace(/approfondimento/gi, 'verifica')
    .split('\n').map((r) => r.replace(/[ \t]+/g, ' ').replace(/\s+,/g, ',').trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > max) t = `${t.slice(0, max).replace(/\s+\S*$/, '')}...`;
  return t;
}

export const SYSTEM = [
  'Sei l\'assistente della Guida GIPO della Suite TD di Toscana Diagnostica: aiuti il personale (accettazione, medici, amministrazione) a usare GipoNext, il gestionale ambulatoriale.',
  'Rispondi in italiano, in modo diretto, usando ESCLUSIVAMENTE le informazioni dei brani numerati della guida che ricevi. Non aggiungere funzioni, campi, pulsanti o comportamenti che i brani non riportano.',
  'Quando la domanda riguarda una procedura, rispondi con passi numerati (1., 2., 3. ...), uno per riga, con i nomi esatti di menu, schede e pulsanti tra virgolette.',
  'Cita i brani che usi con il loro numero tra parentesi quadre, ad esempio [1] o [2].',
  'I brani segnati "da validare" descrivono procedure ricavate dall\'interfaccia e non ancora confermate: se li usi, riportane le cautele (ad esempio "da verificare con il referente GIPO").',
  'Se i brani non bastano a rispondere, dillo chiaramente in una frase, metti "copre": false e suggerisci di rivolgersi all\'assistenza Gipo (ticket o next@gipo.it) o al referente interno. Non inventare.',
  'Non chiedere e non ripetere nomi o dati di pazienti. Non usare emoji, trattini lunghi o la parola "approfondire". Al massimo 220 parole.',
  'Rispondi esclusivamente con un oggetto JSON: {"testo": "...", "fonti": [numeri dei brani citati], "copre": true oppure false}',
].join(' ');

const pulisciMd = (s) => String(s || '').replace(/\[([^\]]*)\]\((sezione:|https?:)[^)]*\)/g, '$1').replace(/^\s*>\s?/gm, '').replace(/[#*_`|]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

/** Messaggio per il modello: domanda e brani numerati (sezioni con capitolo, stato e percorso; FAQ con domanda e risposta). Funzione pura. */
export function messaggio(domanda, brani) {
  const righe = brani.map((b, i) => {
    const intest = b.tipo === 'sezione'
      ? `[${i + 1}] Sezione "${b.titolo}" (capitolo ${b.capitolo}${b.capitolo_titolo ? ` ${b.capitolo_titolo}` : ''}; ${b.stato === 'VALIDATA' ? 'validata' : 'da validare'}${b.percorso_gipo ? `; percorso in GIPO ${b.percorso_gipo}` : ''})`
      : `[${i + 1}] Domanda frequente "${b.titolo}"${b.stato ? ` (sezione collegata ${b.stato === 'VALIDATA' ? 'validata' : 'da validare'})` : ''}`;
    return `${intest}\n${pulisciMd(b.testo).slice(0, 3200)}`;
  });
  return `Domanda del personale: ${domanda}\n\nBrani della guida:\n\n${righe.join('\n\n')}`;
}

const fonteDi = (b, citata) => ({ tipo: b.tipo, id: b.id, titolo: b.titolo, slug: b.slug || b.sezione_slug || null, link: b.link, stato: b.stato || null, capitolo: b.capitolo ?? null, citata });

/** Domande dell'utente nell'ultima ora (limite orario) */
export async function domandeUltimaOra(userId) {
  return (await one(`SELECT count(*)::int AS n FROM domande WHERE utente = $1 AND creata_il > now() - interval '1 hour'`, [userId])).n;
}

/**
 * Risponde a una domanda e la registra. Ritorna { id, domanda, mascherati, esito, risposta, fonti, risultati, ai }.
 * Errori: 400 (troppo corta dopo il mascheramento), 429 (oltre il limite orario).
 */
export async function chiedi(testoUtente, { userId }) {
  const { testo, mascherati } = maschera(String(testoUtente || '').trim().slice(0, 1000));
  if (senzaSegnaposto(testo).length < 5) throw new HttpError(400, 'Scrivi la domanda con qualche parola in più (almeno 5 caratteri, senza dati dei pazienti)');
  if (userId && await domandeUltimaOra(userId) >= config.domandeOrarie) {
    throw Object.assign(new HttpError(429, `Hai già fatto ${config.domandeOrarie} domande nell'ultima ora: riprova più tardi oppure consulta la guida e le FAQ`), { code: 'LIMITE_ORARIO' });
  }
  // brani pertinenti: tutti quelli che contengono tutte le parole; nella seconda passata (solo alcune parole) quelli che ne coprono almeno metà
  const trovati = await cercaGuida(senzaSegnaposto(testo), { limite: config.braniRisposta, prefisso: false });
  const brani = trovati.filter((b) => !b.parziale || b.copertura >= 0.5);
  let esito; let risposta = null; let fonti = []; let modello = null; const ai = { attiva: await aiAttiva() };
  if (!brani.length) {
    esito = 'SENZA_RISPOSTA';
  } else if (!ai.attiva) {
    esito = 'SOLO_RICERCA';
    fonti = brani.map((b) => fonteDi(b, false));
  } else {
    try {
      const r = await chiamaModello({ system: SYSTEM, user: messaggio(testo, brani), userId, query: `gipoguida: ${testo.slice(0, 300)}` });
      const t = pulisci(r?.testo || r?.text || '');
      const citati = new Set([...(Array.isArray(r?.fonti) ? r.fonti : []), ...[...t.matchAll(/\[(\d+)\]/g)].map((m) => m[1])].map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= brani.length));
      if (!t) throw new Error('risposta vuota');
      risposta = t;
      modello = await nomeModello();
      fonti = brani.map((b, i) => fonteDi(b, citati.has(i + 1)));
      esito = r?.copre === false ? 'SENZA_RISPOSTA' : 'RISPOSTA';
    } catch (e) {
      ai.errore = e.message;
      esito = 'SOLO_RICERCA';
      fonti = brani.map((b) => fonteDi(b, false));
    }
  }
  const row = await one(`INSERT INTO domande (utente, testo, mascherati, risposta, fonti, modello, esito) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, creata_il`,
    [userId || null, testo, mascherati, risposta, JSON.stringify(fonti), modello, esito]);
  return {
    id: row.id, creata_il: row.creata_il, domanda: testo, mascherati, esito, risposta, fonti,
    risultati: (brani.length ? brani : trovati).map((b) => ({ tipo: b.tipo, id: b.id, titolo: b.titolo, slug: b.slug, sezione_slug: b.sezione_slug, capitolo: b.capitolo, capitolo_titolo: b.capitolo_titolo, stato: b.stato, snippet: b.snippet, link: b.link, parziale: b.parziale })),
    ai: { attiva: ai.attiva, errore: ai.errore ? 'L\'assistente non ha risposto: ecco i risultati della ricerca' : undefined },
  };
}

/** Valutazione di chi ha posto la domanda ("Mi è stata utile: sì / no" + nota). Solo il proprietario. */
export async function valuta(id, userId, { utile, nota }) {
  const n = nota ? maschera(String(nota).slice(0, 1000)).testo : null;
  const r = await q(`UPDATE domande SET utile = $3, nota_utente = $4, valutata_il = now() WHERE id = $1 AND utente = $2 RETURNING id, esito, utile`, [id, userId, Boolean(utile), n]);
  return r.rows[0] || null;
}
