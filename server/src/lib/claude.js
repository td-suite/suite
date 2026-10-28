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

async function call({ kind, system, user, maxTokens = 1200, userId, query, timeoutMs = 30_000 }) {
  const c = getClient();
  const model = config.anthropic.model;
  try {
    const res = await c.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { timeout: timeoutMs });
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    await logAi({ kind, model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens, query, ok: true, userId });
    return text;
  } catch (e) {
    await logAi({ kind, model, query, ok: false, error: e.message, userId });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Il servizio di intelligenza artificiale non ha risposto');
  }
}

// Chiamata generica con risposta JSON, usata dai moduli (es. Circolari per strutturare le bozze). Mai dati sensibili.
export async function askJson({ kind, system, user, maxTokens = 2000, userId, query, timeoutMs = 60_000 }) {
  const text = await call({ kind, system, user, maxTokens, userId, query, timeoutMs });
  try { return extractJson(text); } catch { throw new HttpError(502, 'Risposta del modello non interpretabile'); }
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
