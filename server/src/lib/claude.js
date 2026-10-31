// Suite TD · wrapper su Anthropic (frase del giorno, risposta della ricerca). Mai dati sensibili verso il modello.
// Ogni chiamata viene registrata in ai_log (tipo, modello, token, esito).
import Anthropic from '@anthropic-ai/sdk';
import { q } from '../db.js';
import { config } from '../config.js';
import { HttpError } from './util.js';

export const aiEnabled = () => config.anthropic.enabled;
export function resetClient() { client = null; }

let client = null;
function getClient() {
  if (!config.anthropic.enabled) throw new HttpError(503, 'Ricerca intelligente non configurata');
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 1 });
  return client;
}

async function logAi({ kind, model, tokensIn, tokensOut, query, ok, error, userId }) {
  try {
    await q('INSERT INTO ai_log (user_id, kind, model, tokens_in, tokens_out, query, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [userId || null, kind, model || config.anthropic.model, tokensIn ?? null, tokensOut ?? null, query ? String(query).slice(0, 2000) : null, ok, error ? String(error).slice(0, 1000) : null]);
  } catch (e) { console.error('[ai_log]', e.message); }
}

// Pulizia del testo prodotto dal modello: niente emoji, niente trattini lunghi, spazi normalizzati
export function cleanText(s, max) {
  let t = String(s || '')
    .replace(/[\u2013\u2014\u2015]/g, ', ')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
  if (max && t.length > max) t = t.slice(0, max).replace(/[\s,;:]+\S*$/, '').trim();
  return t;
}

// Estrae il primo blocco JSON dalla risposta (il modello a volte aggiunge testo o recinti di codice)
function extractJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = Math.min(...['[', '{'].map((c) => s.indexOf(c)).filter((i) => i >= 0));
  if (!Number.isFinite(start)) throw new Error('Risposta del modello senza JSON');
  const end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  return JSON.parse(s.slice(start, end + 1));
}

async function call({ kind, system, user, maxTokens = 1200, userId, query, timeoutMs = 30_000, withMeta = false }) {
  const c = getClient();
  const model = config.anthropic.model;
  try {
    const res = await c.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { timeout: timeoutMs });
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    await logAi({ kind, model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens, query: `${query || ''}${res.stop_reason === 'max_tokens' ? ' [troncata]' : ''}`, ok: true, userId });
    return withMeta ? { text, stopReason: res.stop_reason } : text;
  } catch (e) {
    await logAi({ kind, model, query, ok: false, error: e.message, userId });
    if (e instanceof HttpError) throw e;
    // L'errore di Anthropic arriva all'utente in chiaro (4xx, non mascherato dal gestore dei 5xx): modello inesistente, chiave non valida,
    // credito esaurito, limite di richieste, timeout. Senza questo l'utente vedeva solo "Errore interno del server".
    throw Object.assign(new HttpError(422, `Intelligenza artificiale: ${spiegaErrore(e, model)}`), { code: 'AI_ERROR' });
  }
}
export function spiegaErrore(e, model) {
  const st = e?.status || e?.statusCode;
  const msg = e?.error?.error?.message || e?.error?.message || e?.message || String(e);
  if (st === 401) return 'chiave API non valida o revocata (Amministrazione > Impostazioni > Claude)';
  if (st === 403) return `accesso negato dal servizio: ${msg}`;
  if (st === 404 || /model/i.test(msg) && /not found|does not exist|invalid/i.test(msg)) return `modello "${model}" non disponibile per questa chiave: imposta un modello valido in Amministrazione > Impostazioni > Claude (${msg})`;
  if (st === 429) return 'limite di richieste o credito esaurito sul conto Anthropic';
  if (st === 400) return `richiesta rifiutata dal servizio: ${msg}`;
  if (e?.name === 'APIConnectionTimeoutError' || /timeout|timed out/i.test(msg)) return 'nessuna risposta dal servizio entro il tempo massimo: riprova';
  if (st >= 500) return `servizio Anthropic non disponibile (${st})`;
  return msg;
}

// Chiamata generica con risposta JSON, usata dai moduli (es. Circolari per strutturare le bozze). Mai dati sensibili.
// Se la risposta è troncata (max_tokens) o non è JSON, un secondo tentativo con più spazio e l'istruzione esplicita "solo JSON".
const SOLO_JSON = '\n\nRispondi esclusivamente con il JSON richiesto, senza testo prima o dopo e senza recinti di codice.';
export async function askJson({ kind, system, user, maxTokens = 2000, userId, query, timeoutMs = 60_000 }) {
  let r = await call({ kind, system, user, maxTokens, userId, query, timeoutMs, withMeta: true });
  let parsed = null; let err = null;
  try { parsed = r.stopReason === 'max_tokens' ? null : extractJson(r.text); } catch (e) { err = e; }
  if (parsed === null) {
    const bigger = Math.min(Math.max(maxTokens * 2, 4000), 16000);
    r = await call({ kind, system, user: `${user}${SOLO_JSON}`, maxTokens: bigger, userId, query: `${query || ''} [secondo tentativo]`, timeoutMs: Math.max(timeoutMs, 120_000), withMeta: true });
    try { parsed = extractJson(r.text); } catch (e) { err = e; }
    if (parsed === null) {
      const why = r.stopReason === 'max_tokens' ? 'risposta troncata anche con il doppio dello spazio: riduci il documento' : `il modello ha risposto con testo non interpretabile (${(err?.message || '').slice(0, 80)})`;
      throw Object.assign(new HttpError(422, `Intelligenza artificiale: la risposta del modello non è un JSON leggibile (${why})`), { code: 'AI_ERROR' });
    }
  }
  return parsed;
}
// Prova della configurazione: elenco dei modelli disponibili per la chiave e una richiesta minima con il modello impostato
export async function testAi() {
  if (!aiEnabled()) return { ok: false, message: 'Chiave Anthropic non impostata' };
  const c = getClient(); const model = config.anthropic.model;
  let models = [];
  try { const l = await c.models.list({ limit: 50 }); models = (l.data || []).map((m) => m.id); } catch (e) { return { ok: false, message: `Chiave rifiutata o servizio non raggiungibile: ${spiegaErrore(e, model)}`, models: [] }; }
  try {
    const t0 = Date.now();
    const res = await c.messages.create({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Rispondi solo: OK' }] }, { timeout: 30_000 });
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ok: true, message: `Modello ${model} risponde (${Date.now() - t0} ms): "${text.trim().slice(0, 40)}"`, model, models };
  } catch (e) { return { ok: false, message: spiegaErrore(e, model), model, models }; }
}

// Frasi del giorno ispirate ai valori aziendali: positive, mai banali, massimo 180 caratteri, in italiano
export async function generateQuotes(values, n = 7, { userId } = {}) {
  const count = Math.min(Math.max(Number(n) || 7, 1), 20);
  const vals = (Array.isArray(values) && values.length ? values : ['Cura delle persone', 'Qualità e rigore', 'Lavoro di rete']).map((v) => cleanText(v, 200));
  const system = [
    'Sei la redazione interna di Toscana Diagnostica, rete toscana di laboratori e centri diagnostici.',
    'Scrivi in italiano, con tono caldo, concreto e professionale. Niente retorica, niente frasi fatte, niente citazioni attribuite a persone reali.',
    'Non usare emoji e non usare trattini lunghi. Ogni frase deve avere al massimo 180 caratteri.',
    'Rispondi esclusivamente con un array JSON, senza testo prima o dopo.',
  ].join(' ');
  const user = `Genera ${count} frasi del giorno per la intranet aziendale, ispirate a questi valori:\n${vals.map((v, i) => `${i + 1}. ${v}`).join('\n')}\n\n` +
    'Ogni frase deve essere originale, positiva e utile per iniziare la giornata di chi lavora in laboratorio, in accettazione, in ambulatorio o negli uffici. Evita banalità e frasi motivazionali generiche. ' +
    'Formato: [{"text": "...", "author_label": "Valori Toscana Diagnostica · <tema in due o tre parole>", "theme": "<tema in due o tre parole>"}]';
  const text = await call({ kind: 'quote', system, user, maxTokens: 1800, userId, query: `generateQuotes n=${count}` });
  let arr;
  try { arr = extractJson(text); } catch { throw new HttpError(502, 'Risposta del modello non interpretabile'); }
  if (!Array.isArray(arr)) throw new HttpError(502, 'Risposta del modello non interpretabile');
  return arr
    .map((x) => ({
      text: cleanText(x?.text, 180),
      author_label: cleanText(x?.author_label || `Valori Toscana Diagnostica · ${x?.theme || ''}`, 120),
      theme: cleanText(x?.theme, 60) || null,
    }))
    .filter((x) => x.text.length >= 12)
    .slice(0, count);
}

// Risposta alla ricerca in linguaggio naturale, basata SOLO sui risultati forniti (già filtrati e non sensibili).
// Restituisce { text, sources } dove sources sono i numeri delle citazioni [1], [2]... (1 = primo risultato)
export async function answerSearch(question, results, { userId } = {}) {
  const items = (results || []).slice(0, 12);
  if (!items.length) return { text: 'Non trovo nei contenuti della Suite una risposta a questa domanda.', sources: [] };
  const system = [
    'Sei l\'assistente di ricerca della Suite TD, la intranet di Toscana Diagnostica.',
    'Rispondi in italiano, in modo breve e preciso, usando ESCLUSIVAMENTE le informazioni contenute nei risultati forniti.',
    'Cita i risultati che usi con il loro numero tra parentesi quadre, ad esempio [1] o [2].',
    'Se i risultati non bastano a rispondere, dillo chiaramente: scrivi che non trovi la risposta nei contenuti disponibili e non inventare nulla.',
    'Non usare emoji e non usare trattini lunghi.',
    'Rispondi esclusivamente con un oggetto JSON: {"text": "...", "sources": [numeri dei risultati citati]}',
  ].join(' ');
  const user = `Domanda: ${cleanText(question, 500)}\n\nRisultati:\n` +
    items.map((r, i) => `[${i + 1}] (${r.kind}) ${cleanText(r.title, 200)}\n${cleanText(r.snippet || r.body || '', 600)}`).join('\n\n');
  const text = await call({ kind: 'search', system, user, maxTokens: 700, userId, query: question, timeoutMs: 9_000 });
  let obj;
  try { obj = extractJson(text); } catch { obj = { text, sources: [] }; }
  const sources = [...new Set((Array.isArray(obj?.sources) ? obj.sources : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length))];
  const cited = [...String(obj?.text || '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= items.length);
  for (const n of cited) if (!sources.includes(n)) sources.push(n);
  return { text: cleanText(obj?.text || text, 2000), sources };
}

// Questionario di comprensione di una circolare: tre domande a risposta multipla (quattro opzioni, una corretta) ricavate dal testo
export async function generateQuiz({ title, body, n = 3 }, { userId } = {}) {
  const count = Math.min(Math.max(Number(n) || 3, 1), 5);
  const system = [
    'Sei la redazione interna di Toscana Diagnostica, rete toscana di laboratori e centri diagnostici.',
    'Prepari brevi questionari di comprensione delle circolari aziendali per verificare che chi legge abbia colto i punti essenziali.',
    'Scrivi in italiano, in modo chiaro e concreto. Non usare emoji e non usare trattini lunghi.',
    'Le domande devono riguardare SOLO quanto scritto nel testo (regole, scadenze, responsabilità, comportamenti richiesti), mai nozioni esterne.',
    'Ogni domanda ha quattro opzioni plausibili e una sola corretta; le opzioni sbagliate devono essere credibili ma inequivocabilmente errate rispetto al testo.',
    'Rispondi esclusivamente con un array JSON, senza testo prima o dopo.',
  ].join(' ');
  const user = `Circolare: ${cleanText(title, 200)}\n\nTesto:\n${String(body || '').slice(0, 12000)}\n\n` +
    `Genera ${count} domande a risposta multipla. Formato: [{"q": "domanda", "options": ["A", "B", "C", "D"], "answer": indice della risposta corretta da 0 a 3}]`;
  const text = await call({ kind: 'quiz', system, user, maxTokens: 1500, userId, query: `generateQuiz news "${cleanText(title, 80)}"`, timeoutMs: 45_000 });
  let arr;
  try { arr = extractJson(text); } catch { throw new HttpError(502, 'Risposta del modello non interpretabile'); }
  if (!Array.isArray(arr)) throw new HttpError(502, 'Risposta del modello non interpretabile');
  const out = arr.map((x) => ({
    q: cleanText(x?.q, 300),
    options: (Array.isArray(x?.options) ? x.options : []).map((o) => cleanText(o, 200)).filter(Boolean).slice(0, 4),
    answer: Number(x?.answer),
  })).filter((x) => x.q && x.options.length >= 3 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length).slice(0, count);
  if (!out.length) throw new HttpError(502, 'Il modello non ha prodotto domande valide');
  return out;
}
