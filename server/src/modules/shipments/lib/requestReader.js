// Richieste da documento (richiesta del CEO, 30/10/2026): testo del file caricato (PDF con lib/pdftext.js della Suite, OCR se
// scansione; email .eml con il lettore di lib/requestParse.js; .txt) e lettura assistita dei campi della richiesta Lifestyle con
// Claude (lib/claude.js askJson, ogni chiamata in ai_log). Il modello fa il trascrittore fedele: niente invenzioni, null dove il testo
// non dice. L'operatore controlla e conferma: niente salvataggio automatico delle richieste.
// SHIPMENTS_AI_MOCK=1 (solo con NODE_ENV diverso da production) sostituisce il modello con l'estrattore a espressioni regolari.
import { aiEnabled, askJson } from '../../../lib/claude.js';
import { config as suite } from '../../../config.js';
import { matchOrg } from '../../../lib/anagraficaMatch.js';
import { estraiTesto } from '../../../lib/pdftext.js';
import { bad } from './util.js';
import { fileKind, parseEml, emailOf, mockExtract, MAX_CHARS, MSG_NOT_SUPPORTED } from './requestParse.js';

export const AI_NOT_CONFIGURED = 'Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni';
export const mockEnabled = () => process.env.NODE_ENV !== 'production' && process.env.SHIPMENTS_AI_MOCK === '1';

const SYSTEM = [
  'Sei un trascrittore fedele di richieste di kit per il progetto Lifestyle di Toscana Diagnostica (kit per test, eventualmente con l\'analisi di laboratorio).',
  'Il documento è un ordine, un modulo o una email: riporta SOLO ciò che il testo dice, senza interpretazioni libere e senza inventare. Dove il testo non indica un dato scrivi null.',
  'Il richiedente è chi ordina e paga il kit: una persona (PERSONA) oppure un\'azienda, uno studio medico, una struttura sanitaria o un partner (LEGAL_ENTITY, con ragione sociale e, se presenti, partita IVA e codice fiscale).',
  'Il destinatario è chi riceve il kit all\'indirizzo di consegna: se è la stessa persona richiedente ripeti i suoi dati; se una Legal entity ordina kit senza indicare una persona lascia nome e cognome a null.',
  'richiesta.tipo: KIT_AND_EXAM se il kit include l\'analisi o l\'esame di laboratorio (campione da restituire), KIT_ONLY se è solo il kit, null se il testo non lo dice.',
  'quantita_kit: numero di kit richiesti (intero); provincia con la sigla di due lettere se il testo la indica; telefono senza spazi; lingua "it" o "en" secondo la lingua del documento.',
  'Per ogni campo che compili indica la confidenza (alta, media, bassa) e la citazione testuale breve (massimo 200 caratteri) da cui lo hai ricavato.',
  'Rispondi esclusivamente con un oggetto JSON, senza testo prima o dopo, con questa struttura:',
  '{"richiedente":{"tipo":"PERSONA|LEGAL_ENTITY","ragione_sociale":"","piva":"","cf":"","referente":"","email":"","telefono":""},',
  '"destinatario":{"titolo":"","nome":"","cognome":"","indirizzo1":"","indirizzo2":"","cap":"","citta":"","provincia":"","paese":"","telefono":"","email":""},',
  '"richiesta":{"tipo":"KIT_ONLY|KIT_AND_EXAM|null","quantita_kit":1,"prodotto":"","riferimento_esterno":"","note":"","lingua":"it|en"},',
  '"confidenza":{"<campo in notazione puntata, es. destinatario.cap>":{"livello":"alta|media|bassa","citazione":"..."}}}',
].join('\n');

// Testo del file caricato: { text, chars, ocr, pages, from, subject, date, avvisi }
export async function textOfFile(file) {
  const kind = fileKind(file.originalname, file.mimetype);
  if (kind === 'msg') throw bad(MSG_NOT_SUPPORTED);
  if (!kind) throw bad(`Formato non ammesso (${file.originalname}): carica un PDF, un'email .eml o un testo .txt`);
  const avvisi = [];
  let text = ''; let ocr = false; let pages = null; let from = null; let subject = null; let date = null;
  const pdf = async (buf, label) => {
    let r;
    try { r = await estraiTesto(buf); } catch (e) { throw bad(`${label}: ${e.message}`); }
    if (r.ocr) { ocr = true; avvisi.push(`${label} è una scansione: testo letto con OCR${r.ocr_lingua && r.ocr_lingua !== 'ita' ? ` (lingua ${r.ocr_lingua})` : ''}, possibili errori di lettura`); }
    pages = (pages || 0) + r.n_pagine;
    return r.pagine.join('\n\n');
  };
  if (kind === 'pdf') text = await pdf(file.buffer, `Il PDF ${file.originalname}`);
  else if (kind === 'txt') text = file.buffer.toString('utf8');
  else {
    const m = parseEml(file.buffer);
    from = m.from; subject = m.subject; date = m.date;
    text = m.text;
    // PDF allegati all'email (ordine o modulo di richiesta): il loro testo si aggiunge a quello del messaggio
    for (const a of m.pdfs.slice(0, 5)) {
      try { text += `\n\n--- Allegato ${a.filename} ---\n${await pdf(a.buffer, `L'allegato ${a.filename}`)}`; }
      catch (e) { avvisi.push(e.message); }
    }
  }
  text = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text.replace(/\s+/g, '').length) throw bad(`${file.originalname}: nessun testo leggibile nel documento`);
  if (text.length > MAX_CHARS) {
    avvisi.push(`Documento molto lungo (${text.length.toLocaleString('it-IT')} caratteri): la lettura si ferma ai primi ${MAX_CHARS.toLocaleString('it-IT')}`);
    text = text.slice(0, MAX_CHARS);
  }
  return { kind, text, chars: text.length, ocr, pages, from, from_addr: emailOf(from) || from, subject, date, avvisi };
}

// Lettura dei campi della richiesta Lifestyle: { extracted, model }
export async function readLifestyleRequest(text, { userId } = {}) {
  if (mockEnabled()) return { extracted: mockExtract(text), model: 'mock' };
  if (!aiEnabled()) throw bad(AI_NOT_CONFIGURED);
  const user = `Testo della richiesta (${text.length} caratteri):\n\n${text}`;
  const extracted = await askJson({ kind: 'shipments_lifestyle_request', system: SYSTEM, user, maxTokens: 2500, userId, query: 'shipments: lettura richiesta Lifestyle da documento', timeoutMs: 90_000 });
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) throw bad('Risposta del modello non interpretabile');
  return { extracted, model: suite.anthropic.model };
}

// Legal entity del richiedente: { id, name, how } oppure null (P.IVA, codice fiscale, nome anche simile: lib/anagraficaMatch.js)
export async function matchRequester(extracted) {
  const r = extracted?.richiedente || {};
  const entity = String(r.tipo || '').toUpperCase() === 'LEGAL_ENTITY' || r.ragione_sociale || r.piva;
  if (!entity) return null;
  if (!r.piva && !r.cf && !r.ragione_sociale) return null;
  return matchOrg({ vat_number: r.piva, tax_code: r.cf, name: r.ragione_sociale });
}
