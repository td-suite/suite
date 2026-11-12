// Guida GIPO · domande del personale (POST /api/gipoguida/chiedi), v0.71.1.
// 1. il testo si maschera (codici fiscali, email, numeri lunghi) PRIMA di salvarlo e di inviarlo al modello;
// 2. recupero: ricerca OR con ranking su sezioni e FAQ (lib/ricerca.js, sinonimi, frasi, idf, rinforzo dalle FAQ);
// 3. con l'intelligenza artificiale (aiEnabled del wrapper della Suite, tipo 'gipoguida' in ai_log) PRIMA un passaggio di pianificazione
//    economico: il modello riceve l'INDICE completo della guida (id, capitolo, titolo, parole chiave, sintesi) e sceglie fino a 10 sezioni;
//    si uniscono ai risultati della ricerca; POI la risposta sul testo integrale di quelle sezioni (fino a 12, con un tetto di caratteri)
//    più le FAQ collegate. Il modello risponde come un esperto di GIPO che ha davanti la guida: procedura in passi numerati con i nomi
//    esatti, esempio sui dati della domanda, cosa verificare dopo, riga finale "Da provare prima su..." se ci sono passi dedotti;
//    dice "la guida non copre" solo se nessuna sezione riguarda il tema (proponendo la più vicina, la domanda va in coda);
// 4. esiti: RISPOSTA; PARZIALE (risposta data, con parti dedotte); SENZA_RISPOSTA; SOLO_RICERCA (senza AI o se l'AI non risponde: le
//    sezioni migliori con i passi già scritti, non "senza risposta").
// Ogni domanda si registra (tabella domande); SENZA_RISPOSTA e le risposte giudicate "non utili" entrano nella coda della redazione, dove
// "Rigenera risposta" ripete l'elaborazione dopo un aggiornamento della guida (rigenera).
import { q, one, many } from '../db.js';
import { HttpError } from '../../../lib/util.js';
import { config } from '../config.js';
import { maschera, senzaSegnaposto } from './privacy.js';
import { recupera } from './ricerca.js';

// ---------------------------------------------------------------- modello (sostituibile nei test)
// undefined = wrapper reale; false = AI spenta; function = modello finto ({ system, user, fase: 'pianifica'|'risposta', brani }) → JSON
let sostituto;
export function _impostaModello(fn) { sostituto = fn; }
async function aiAttiva() {
  if (sostituto === false) return false;
  if (typeof sostituto === 'function') return true;
  const { aiEnabled } = await import('../../../lib/claude.js');
  return aiEnabled();
}
async function chiamaModello({ system, user, userId, query, fase, brani, maxTokens }) {
  if (typeof sostituto === 'function') return sostituto({ system, user, userId, query, fase, brani });
  const { askJson } = await import('../../../lib/claude.js');
  return askJson({ kind: 'gipoguida', system, user, maxTokens, userId, query, timeoutMs: config.aiTimeoutMs });
}
async function nomeModello() {
  if (typeof sostituto === 'function') return 'modello di prova';
  const { config: suite } = await import('../../../config.js');
  return suite.anthropic?.model || null;
}

// ---------------------------------------------------------------- testo
/** Pulizia del testo del modello: niente emoji, niente trattini lunghi, niente "approfondire"; gli a capo restano (passi numerati). */
export function pulisci(s, max = 9000) {
  let t = String(s || '')
    .replace(/[\u2013\u2014\u2015]/g, ', ')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/approfondir(e|ne|lo|la|li|le)?/gi, 'verificare meglio')
    .replace(/approfondimento/gi, 'verifica')
    .split('\n').map((r) => r.replace(/[ \t]+/g, ' ').replace(/\s+,/g, ',').trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > max) t = `${t.slice(0, max).replace(/\s+\S*$/, '')}...`;
  return t;
}

export const SYSTEM_PIANO = [
  'Sei l\'esperto di GipoNext (GIPO, il gestionale ambulatoriale) della Guida GIPO di Toscana Diagnostica.',
  'Ricevi una domanda del personale e l\'INDICE completo della guida: una riga per sezione con id, capitolo, titolo, sintesi e parole chiave.',
  'Scegli le sezioni il cui testo serve per rispondere bene, fino a 10, in ordine di utilità: la procedura principale, quelle che servono per i passi precedenti o successivi (per esempio creare l\'agenda prima di configurarne gli orari), le regole interne e le verifiche.',
  'Pensa al significato, non solo alle parole: "medico che viene solo il primo e il terzo martedì del mese" riguarda gli orari dell\'agenda per giorni del mese (sottoconfigurazioni); "bloccare l\'agenda per ferie" riguarda festivi e sottoconfigurazioni.',
  'Rispondi esclusivamente con un oggetto JSON: {"sezioni": [id, id, ...]}',
].join(' ');

export const SYSTEM = [
  'Sei un esperto di GipoNext (GIPO, il gestionale ambulatoriale di Docplanner) che lavora in Toscana Diagnostica e ha davanti la Guida GIPO: rispondi al personale, anche a chi configura GIPO in back-end.',
  'Usa SOLO le informazioni dei brani numerati della guida che ricevi: non inventare funzioni, campi, pulsanti, voci di menu o comportamenti che i brani non riportano. Puoi combinare più brani per costruire la procedura completa.',
  'Scrivi in italiano, in modo diretto. Struttura della risposta: una frase che dice dove si fa; poi la procedura in passi numerati (1., 2., 3. ...), uno per riga, con i nomi esatti di menu, schede, campi e pulsanti in grassetto (**Nome**); poi "Esempio:" applicato ai dati della domanda (giorni, orari, date, percentuali che la domanda indica); poi "Cosa verificare dopo:" con i controlli (per esempio aprire Agenda classica e controllare i giorni).',
  'Cita i brani che usi con il loro numero tra parentesi quadre, per esempio [1] o [3].',
  'I brani "da validare" descrivono procedure ricavate dall\'interfaccia: se la tua procedura usa passi dedotti, metti "dedotto": true e chiudi con una riga che inizia con "Da provare prima su" (per esempio "Da provare prima su un\'agenda di prova."). I brani "validata" (per esempio dal manuale operativo TD-SGI-MAN007) sono regole approvate dall\'azienda.',
  'Se i brani contengono una nota "Da riconciliare con il manuale", segnalala in una riga.',
  'Non rispondere che la guida non copre la domanda quando un brano riguarda l\'argomento: costruisci comunque la procedura con quello che c\'è e indica cosa resta da verificare. Solo se NESSUN brano riguarda il tema metti "copre": false, dillo in una frase e indica il brano più vicino.',
  'Non chiedere e non ripetere nomi o dati di pazienti. Non usare emoji, trattini lunghi o la parola "approfondire". Al massimo 450 parole.',
  'Rispondi esclusivamente con un oggetto JSON: {"testo": "...", "fonti": [numeri dei brani citati], "copre": true oppure false, "dedotto": true oppure false}',
].join(' ');

const pulisciMd = (s) => String(s || '').replace(/\[([^\]]*)\]\((sezione:|https?:)[^)]*\)/g, '$1').replace(/^\s*>\s?/gm, '').replace(/\*\*/g, '').replace(/[#_`]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
const ETICHETTA_FONTE = { INTERFACCIA: 'interfaccia', MANUALE_TD: 'manuale operativo TD', 'INTERFACCIA+MANUALE': 'interfaccia e manuale TD', REDAZIONE: 'redazione' };

/** Messaggio per il modello: domanda e brani numerati (sezioni con slug, capitolo, stato, fonte e percorso; FAQ). Funzione pura. */
export function messaggio(domanda, brani, { tetto = config.caratteriSezione } = {}) {
  const righe = brani.map((b, i) => {
    const intest = b.tipo === 'sezione'
      ? `[${i + 1}] Sezione "${b.titolo}" (${b.slug}; capitolo ${b.capitolo}${b.capitolo_titolo ? ` ${b.capitolo_titolo}` : ''}; ${b.stato === 'VALIDATA' ? 'validata' : 'da validare'}; fonte ${ETICHETTA_FONTE[b.fonte] || 'interfaccia'}${b.percorso_gipo ? `; percorso in GIPO ${b.percorso_gipo}` : ''})`
      : `[${i + 1}] Domanda frequente "${b.titolo}"${b.sezione_slug ? ` (sezione ${b.sezione_slug}${b.stato ? `, ${b.stato === 'VALIDATA' ? 'validata' : 'da validare'}` : ''})` : ''}`;
    return `${intest}\n${pulisciMd(b.testo).slice(0, tetto)}`;
  });
  return `Domanda del personale: ${domanda}\n\nBrani della guida:\n\n${righe.join('\n\n')}`;
}

/** Indice completo della guida per il passaggio di pianificazione (una riga per sezione). */
export async function indiceGuida() {
  const r = await many(`SELECT s.id, s.capitolo, k.titolo AS capitolo_titolo, s.titolo, s.sintesi, s.parole_chiave FROM sezioni s LEFT JOIN capitoli k ON k.numero = s.capitolo
    ORDER BY s.capitolo, s.ordine, s.id`);
  return r.map((x) => `${x.id} | cap. ${x.capitolo} ${x.capitolo_titolo || ''} | ${x.titolo} | ${x.sintesi || ''} | ${String(x.parole_chiave || '').slice(0, 160)}`).join('\n');
}

/** Passaggio di pianificazione: id delle sezioni scelte dal modello sull'indice (al più config.sezioniPiano); [] se non risponde. */
export async function pianifica(domanda, { userId } = {}) {
  const indice = await indiceGuida();
  try {
    const r = await chiamaModello({ fase: 'pianifica', system: SYSTEM_PIANO, user: `Domanda del personale: ${domanda}\n\nIndice della guida (id | capitolo | titolo | sintesi | parole chiave):\n${indice}`,
      userId, query: `gipoguida piano: ${domanda.slice(0, 200)}`, maxTokens: 400 });
    const ids = (Array.isArray(r?.sezioni) ? r.sezioni : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return [];
    const esistenti = new Set((await many('SELECT id FROM sezioni WHERE id = ANY($1::int[])', [ids])).map((x) => x.id));
    return [...new Set(ids.filter((n) => esistenti.has(n)))].slice(0, config.sezioniPiano);
  } catch { return []; }
}

const fonteDi = (b, citata) => ({ tipo: b.tipo, id: b.id, titolo: b.titolo, slug: b.slug || b.sezione_slug || null, link: b.link, stato: b.stato || null, fonte: b.fonte || null,
  capitolo: b.capitolo ?? null, citata });
const risultatoDi = (b) => ({ tipo: b.tipo, id: b.id, titolo: b.titolo, slug: b.slug, sezione_slug: b.sezione_slug, capitolo: b.capitolo, capitolo_titolo: b.capitolo_titolo,
  stato: b.stato, fonte: b.fonte, livello: b.livello, snippet: b.snippet, link: b.link, parziale: b.parziale });

/**
 * Passi già scritti di una sezione (senza AI): i blocchi "### Come si fa..." e "### Esempio..." del testo, altrimenti l'inizio del testo.
 * Funzione pura.
 */
export function passiDi(corpo, max = 3500) {
  const blocchi = String(corpo || '').split(/\n(?=### )/);
  const scelti = blocchi.filter((b) => /^### (Come si fa|Esempio|Cosa verificare|I controlli|Le verifiche|Il flusso|Le regole)/i.test(b.trim()));
  const t = (scelti.length ? scelti : blocchi.slice(0, 2)).join('\n\n').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}...` : t;
}

/**
 * Brani della risposta: sezioni (piano del modello + ricerca, al più config.sezioniRisposta, tetto di caratteri) e FAQ (collegate alle
 * sezioni scelte o trovate). Ritorna { brani, sezioni, faq, piano, trovate } senza chiamare il modello per la risposta.
 */
export async function preparaBrani(testo, { userId, conPiano = false } = {}) {
  const r = await recupera(testo, { limiteSezioni: config.sezioniRisposta + 6, limiteFaq: config.faqRisposta, prefisso: false });
  const pertinenti = r.sezioni.filter((s) => s.trovati > 0 || s.score > 0.25);
  const piano = conPiano ? await pianifica(testo, { userId }) : [];
  // ordine: i primi 3 della ricerca, poi le scelte del piano, poi il resto della ricerca
  const ordine = [...pertinenti.slice(0, 3).map((s) => s.id), ...piano, ...pertinenti.slice(3).map((s) => s.id)];
  const ids = [...new Set(ordine)].slice(0, config.sezioniRisposta);
  const mancano = ids.filter((id) => !pertinenti.some((s) => s.id === id));
  const extra = mancano.length ? await many(`SELECT 'sezione' AS tipo, s.id, s.titolo, s.slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, s.fonte, s.livello, s.sintesi,
      left(s.corpo, 240) AS snippet, s.corpo AS testo FROM sezioni s LEFT JOIN capitoli k ON k.numero = s.capitolo WHERE s.id = ANY($1::int[])`, [mancano]) : [];
  const perId = new Map([...pertinenti, ...extra.map((x) => ({ ...x, link: `/gipoguida/guida/${x.slug}`, dal_piano: true }))].map((x) => [x.id, x]));
  let caratteri = 0;
  const sezioni = [];
  for (const id of ids) {
    const s = perId.get(id);
    if (!s) continue;
    const n = Math.min(String(s.testo || '').length, config.caratteriSezione);
    if (sezioni.length && caratteri + n > config.caratteriBrani) break;
    caratteri += n;
    sezioni.push({ ...s, dal_piano: piano.includes(id) || Boolean(s.dal_piano) });
  }
  // FAQ: prima quelle trovate dalla ricerca e collegate alle sezioni scelte, poi le altre trovate, poi le collegate non trovate
  const scelte = new Set(sezioni.map((s) => s.id));
  const trovate = r.faq;
  const collegate = scelte.size ? await many(`SELECT 'faq' AS tipo, f.id, f.domanda AS titolo, NULL::text AS slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, s.fonte,
      f.sezione_id, s.slug AS sezione_slug, left(f.risposta, 240) AS snippet, f.risposta AS testo FROM faq f JOIN sezioni s ON s.id = f.sezione_id LEFT JOIN capitoli k ON k.numero = s.capitolo
    WHERE f.pubblicata AND f.sezione_id = ANY($1::int[]) ORDER BY array_position($1::int[], f.sezione_id), f.ordine, f.id`, [[...scelte]]) : [];
  const faqOrd = [...trovate.filter((f) => scelte.has(f.sezione_id)), ...trovate.filter((f) => !scelte.has(f.sezione_id)), ...collegate.map((f) => ({ ...f, link: `/gipoguida/faq?voce=${f.id}` }))];
  const faq = [];
  for (const f of faqOrd) { if (faq.length >= config.faqRisposta) break; if (!faq.some((x) => x.id === f.id)) faq.push(f); }
  return { brani: [...sezioni, ...faq], sezioni, faq, piano, trovate: r };
}

/** Domande dell'utente nell'ultima ora (limite orario) */
export async function domandeUltimaOra(userId) {
  return (await one(`SELECT count(*)::int AS n FROM domande WHERE utente = $1 AND creata_il > now() - interval '1 hour'`, [userId])).n;
}

/**
 * Elabora una domanda già mascherata (senza registrarla): recupero, piano e risposta del modello, oppure i passi già scritti.
 * Ritorna { esito, risposta, fonti, modello, risultati, procedure, ai }.
 */
export async function elabora(testo, { userId } = {}) {
  const ai = { attiva: await aiAttiva() };
  const pulito = senzaSegnaposto(testo);
  const { brani, sezioni, faq, piano } = await preparaBrani(pulito, { userId, conPiano: ai.attiva });
  const risultati = [...sezioni, ...faq].slice(0, 14).map(risultatoDi);
  const procedure = sezioni.slice(0, config.procedureSenzaAi).map((s) => ({ id: s.id, titolo: s.titolo, slug: s.slug, stato: s.stato, fonte: s.fonte, link: s.link, passi: passiDi(s.testo) }));
  ai.piano = piano.length;
  if (!brani.length) return { esito: 'SENZA_RISPOSTA', risposta: null, fonti: [], modello: null, risultati: [], procedure: [], ai };
  if (!ai.attiva) return { esito: 'SOLO_RICERCA', risposta: null, fonti: brani.map((b) => fonteDi(b, false)), modello: null, risultati, procedure, ai };
  try {
    const r = await chiamaModello({ fase: 'risposta', system: SYSTEM, user: messaggio(testo, brani), userId, query: `gipoguida: ${testo.slice(0, 300)}`, brani, maxTokens: 2600 });
    const t = pulisci(r?.testo || r?.text || '');
    if (!t) throw new Error('risposta vuota');
    const citati = new Set([...(Array.isArray(r?.fonti) ? r.fonti : []), ...[...t.matchAll(/\[(\d+)\]/g)].map((m) => m[1])].map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= brani.length));
    const dedotto = r?.dedotto === true || /^\s*da provare prima/im.test(t);
    const esito = r?.copre === false ? 'SENZA_RISPOSTA' : dedotto ? 'PARZIALE' : 'RISPOSTA';
    return { esito, risposta: t, fonti: brani.map((b, i) => fonteDi(b, citati.has(i + 1))), modello: await nomeModello(), risultati, procedure: esito === 'SENZA_RISPOSTA' ? procedure : [], ai };
  } catch (e) {
    ai.errore = e.message;
    return { esito: 'SOLO_RICERCA', risposta: null, fonti: brani.map((b) => fonteDi(b, false)), modello: null, risultati, procedure, ai };
  }
}

const AI_PUBBLICO = (ai) => ({ attiva: ai.attiva, piano: ai.piano || 0, errore: ai.errore ? 'L\'assistente non ha risposto: ecco le sezioni della guida con i passi' : undefined });

/**
 * Risponde a una domanda e la registra. Ritorna { id, domanda, mascherati, esito, risposta, fonti, risultati, procedure, ai }.
 * Errori: 400 (troppo corta dopo il mascheramento), 429 (oltre il limite orario).
 */
export async function chiedi(testoUtente, { userId }) {
  const { testo, mascherati } = maschera(String(testoUtente || '').trim().slice(0, 1000));
  if (senzaSegnaposto(testo).length < 5) throw new HttpError(400, 'Scrivi la domanda con qualche parola in più (almeno 5 caratteri, senza dati dei pazienti)');
  if (userId && await domandeUltimaOra(userId) >= config.domandeOrarie) {
    throw Object.assign(new HttpError(429, `Hai già fatto ${config.domandeOrarie} domande nell'ultima ora: riprova più tardi oppure consulta la guida e le FAQ`), { code: 'LIMITE_ORARIO' });
  }
  const e = await elabora(testo, { userId });
  const row = await one(`INSERT INTO domande (utente, testo, mascherati, risposta, fonti, modello, esito) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, creata_il`,
    [userId || null, testo, mascherati, e.risposta, JSON.stringify(e.fonti), e.modello, e.esito]);
  return { id: row.id, creata_il: row.creata_il, domanda: testo, mascherati, esito: e.esito, risposta: e.risposta, fonti: e.fonti, risultati: e.risultati, procedure: e.procedure, ai: AI_PUBBLICO(e.ai) };
}

/**
 * Redazione: "Rigenera risposta" su una domanda già posta (dopo un aggiornamento della guida). La domanda è già mascherata. Aggiorna
 * risposta, fonti, esito e modello; la valutazione di chi aveva chiesto resta (la domanda resta in coda finché la redazione non la
 * segna come risolta). Ritorna la domanda aggiornata con risultati e procedure.
 */
export async function rigenera(id, { userId }) {
  const d = await one('SELECT id, testo FROM domande WHERE id = $1', [id]);
  if (!d) return null;
  const e = await elabora(d.testo, { userId });
  const r = await one(`UPDATE domande SET risposta = $2, fonti = $3, modello = $4, esito = $5, rigenerata_il = now(), rigenerata_da = $6, rigenerazioni = rigenerazioni + 1
    WHERE id = $1 RETURNING id, testo, esito, risposta, fonti, rigenerata_il, rigenerazioni`, [id, e.risposta, JSON.stringify(e.fonti), e.modello, e.esito, userId || null]);
  return { ...r, risultati: e.risultati, procedure: e.procedure, ai: AI_PUBBLICO(e.ai) };
}

/** Valutazione di chi ha posto la domanda ("Mi è stata utile: sì / no" + nota). Solo il proprietario. */
export async function valuta(id, userId, { utile, nota }) {
  const n = nota ? maschera(String(nota).slice(0, 1000)).testo : null;
  const r = await q(`UPDATE domande SET utile = $3, nota_utente = $4, valutata_il = now() WHERE id = $1 AND utente = $2 RETURNING id, esito, utile`, [id, userId, Boolean(utile), n]);
  return r.rows[0] || null;
}
