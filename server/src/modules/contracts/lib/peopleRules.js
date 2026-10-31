// Casella People: regole pure (senza database) per richiami e lettura della casella people@toscanadiagnostica.it.
// Chiave della scadenza e identificativo [TD-SCAD-<chiave>], soglie di anticipo, scelta del destinatario per tipo di scadenza,
// abbinamento dei messaggi in arrivo (identificativo, email del mittente, nome nel soggetto) e proposta di prova del documento
// (CONTRACTS_AI_MOCK=1). Coperte da server/test/contracts-people.test.mjs.
import crypto from 'node:crypto';

export const DEFAULT_MAILBOX = 'people@toscanadiagnostica.it';
export const DEFAULT_THRESHOLDS = [60, 30, 7, 0];
// Destinatario del richiamo per tipo di scadenza: PERSONA (diretto destinatario, con copia a HR se impostata), HR, NESSUNO
export const DEFAULT_MAP = { DOCUMENTO: 'PERSONA', PROVA: 'HR', CONTRATTO: 'HR', MANUALE: 'HR', IMPEGNO: 'HR', RAL: 'HR', MBO: 'HR' };
export const RECIPIENTS = ['PERSONA', 'HR', 'NESSUNO'];
// Oltre questi giorni di ritardo una scadenza non genera più il richiamo "scaduta" (evita la raffica al primo avvio)
export const OVERDUE_MAX_DAYS = 30;
// Tipi di file accettati dalla casella: PDF, Word, immagini
export const INBOX_MIMES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/heic', 'image/tiff', 'image/webp']);
export const inboxExt = (n) => /\.(pdf|docx?|jpe?g|png|heic|tiff?|webp)$/i.test(n || '');
export const acceptedFile = (name, mime) => INBOX_MIMES.has(String(mime || '').toLowerCase()) || inboxExt(name);

const CODES = { DOCUMENTO: 'D', CONTRATTO: 'C', PROVA: 'P', RAL: 'R', MBO: 'B', IMPEGNO: 'L', MANUALE: 'M' };
const hash4 = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 4).toUpperCase();

/**
 * Chiave stabile della scadenza (maiuscole, cifre e trattini): A<id> per gli allegati del dossier, M<id> per le scadenze manuali,
 * altrimenti <codice tipo><id persona>-<AAAAMMGG>-<4 caratteri del titolo>. La data è nella chiave: rinnovata la scadenza
 * (nuova data) la chiave cambia e il vecchio richiamo non si ripete.
 */
export function deadlineKey(item) {
  if (item?.ref?.attachment_id) return `A${item.ref.attachment_id}`;
  if (item?.ref?.deadline_id) return `M${item.ref.deadline_id}`;
  const code = CODES[item?.type] || 'X';
  const ymd = String(item?.due_date || '').slice(0, 10).replace(/-/g, '');
  const extra = item?.ref?.letter_id ? `L${item.ref.letter_id}` : '';
  return `${code}${item?.resource_id || 0}-${ymd}-${hash4(`${extra}${item?.title || ''}`)}`;
}

export const scadTag = (key) => `[TD-SCAD-${key}]`;

/** Primo identificativo [TD-SCAD-...] trovato nei testi (soggetto, corpo): restituisce la chiave in maiuscolo o null. */
export function parseScadKey(...texts) {
  for (const t of texts) {
    const s = String(t || '');
    const m = s.match(/\[\s*TD-SCAD-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s*\]/) || s.match(/\bTD-SCAD-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Soglie di anticipo da testo ("60, 30, 7, 0"): interi 0..365, senza doppioni, in ordine decrescente. Vuoto = predefinite. */
export function parseThresholds(v) {
  const arr = (Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/)).filter((x) => String(x).trim() !== '').map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  const out = [...new Set(arr)].sort((a, b) => b - a);
  return out.length ? out : [...DEFAULT_THRESHOLDS];
}

/**
 * Soglia da inviare oggi per una scadenza a `days` giorni (negativo = scaduta): la più piccola soglia raggiunta (days <= soglia),
 * se non è già stata inviata. Si manda solo la soglia corrente: una scadenza scoperta a 20 giorni riceve il richiamo dei 30,
 * non anche quello dei 60. Oltre OVERDUE_MAX_DAYS di ritardo nessun richiamo. Restituisce la soglia o null.
 */
export function thresholdDue(days, thresholds = DEFAULT_THRESHOLDS, sent = new Set(), { overdueMaxDays = OVERDUE_MAX_DAYS } = {}) {
  if (!Number.isFinite(days) || days < -overdueMaxDays) return null;
  const reached = thresholds.filter((t) => days <= t);
  if (!reached.length) return null;
  const cur = Math.min(...reached);
  return sent.has(cur) ? null : cur;
}

/** Elenco di indirizzi email da testo libero (virgole, punto e virgola, spazi), validati e senza doppioni. */
export function parseEmailList(v) {
  const arr = (Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/)).map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return [...new Set(arr)];
}

/** Mappa tipo di scadenza -> destinatario da JSON (valori non validi ignorati, chiavi mancanti dalle predefinite). */
export function parseRecipientMap(v) {
  let obj = {};
  try { obj = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}); } catch { obj = {}; }
  const out = { ...DEFAULT_MAP };
  for (const [k, x] of Object.entries(obj || {})) if (k in DEFAULT_MAP && RECIPIENTS.includes(String(x).toUpperCase())) out[k] = String(x).toUpperCase();
  return out;
}

/** Scadenze interne: MBO, scatti RAL e cessazioni riguardano HR, mai la persona, qualunque sia la mappa. */
export const isInternal = (item) => ['MBO', 'RAL'].includes(item?.type) || /cessazione/i.test(item?.title || '');

/**
 * Destinatario del richiamo. PERSONA: alla persona (email della risorsa) con copia agli indirizzi HR; se la persona non ha email
 * il richiamo va a HR. HR: agli indirizzi HR. NESSUNO: nessun richiamo. Restituisce { recipient, to, cc, reason }.
 */
export function chooseRecipient(item, { map = DEFAULT_MAP, personEmail = null, hrEmails = [], hrCc = [] } = {}) {
  let mode = isInternal(item) ? 'HR' : (map[item?.type] || 'HR');
  if (mode === 'NESSUNO') return { recipient: null, to: [], cc: [], reason: 'tipo di scadenza escluso dai richiami' };
  const pe = parseEmailList(personEmail)[0] || null;
  let reason = null;
  if (mode === 'PERSONA' && !pe) { mode = 'HR'; reason = 'persona senza email: richiamo a HR'; }
  if (mode === 'PERSONA') return { recipient: 'PERSONA', to: [pe], cc: parseEmailList(hrCc).filter((x) => x !== pe), reason };
  const to = parseEmailList(hrEmails);
  if (!to.length) return { recipient: 'HR', to: [], cc: [], reason: reason || 'nessun indirizzo HR impostato' };
  return { recipient: 'HR', to, cc: [], reason };
}

const itDate = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };

/** Soggetto del richiamo, con l'identificativo per abbinare la risposta. */
export const reminderSubject = (item, key) => `Toscana Diagnostica · promemoria: ${item.title} entro il ${itDate(item.due_date)} ${scadTag(key)}`;

// ---------------- abbinamento dei messaggi in arrivo ----------------
export const normText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@./\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
export const normEmail = (s) => String(s || '').trim().toLowerCase();

/** Persona con email uguale al mittente (persone: [{ id, email, ... }]); solo se l'abbinamento è unico. */
export function matchByEmail(from, people) {
  const e = normEmail(from);
  if (!e) return null;
  const hits = (people || []).filter((p) => [p.email, p.user_email].some((x) => x && normEmail(x) === e));
  const ids = [...new Set(hits.map((p) => p.id))];
  return ids.length === 1 ? hits[0] : null;
}

/** Persona il cui nome completo (cognome nome o nome cognome) compare nel testo; solo se l'abbinamento è unico. */
export function matchByName(text, people) {
  const t = ` ${normText(text)} `;
  if (!t.trim()) return null;
  const hits = (people || []).filter((p) => {
    const ln = normText(p.last_name); const fn = normText(p.first_name);
    if (!ln || !fn) return false;
    return t.includes(` ${ln} ${fn} `) || t.includes(` ${fn} ${ln} `);
  });
  const ids = [...new Set(hits.map((p) => p.id))];
  return ids.length === 1 ? hits[0] : null;
}

// ---------------- proposta di prova del documento (CONTRACTS_AI_MOCK=1) e ripiego senza modello ----------------
const CATEGORY_RULES = [
  ['POLIZZA_RC', /polizz|assicuraz|responsabilita civile|\brc professionale/],
  ['VISITA_MEDICA', /idoneita|medico competente|sorveglianza sanitaria|giudizio di idoneita/],
  ['CI', /carta d.?identita|documento di identita|passaporto|permesso di soggiorno|patente di guida/],
  ['ALBO', /\balbo\b|iscrizione all.?ordine|ordine dei (medici|biologi|tecnici|psicologi)|quota (annuale|associativa)/],
  ['ECM', /\becm\b|crediti formativi|educazione continua/],
  ['FORMAZIONE_SICUREZZA', /sicurezza sul lavoro|81\/2008|d ?lgs ?81|formazione (generale|specifica) (dei )?lavorator/],
  ['FORMAZIONE', /attestat|corso di|\bblsd?\b|partecipazione al corso/],
  ['CF', /codice fiscale|tessera sanitaria/],
  ['INCOMPATIBILITA', /incompatibilita/],
  ['DETRAZIONI', /detrazion/],
  ['CONTRATTO_FIRMATO', /contratto/],
];
const MONTHS = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
const pad = (n) => String(n).padStart(2, '0');
const validIso = (y, m, d) => (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

/** Date presenti in un testo (gg/mm/aaaa, gg-mm-aaaa, gg.mm.aaaa, aaaa-mm-gg, "31 dicembre 2027") con la loro posizione. */
export function findDates(text) {
  const s = normText(text).replace(/(\d)\s*([./-])\s*(\d)/g, '$1$2$3');
  const out = [];
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) { const iso = validIso(+m[3], +m[2], +m[1]); if (iso) out.push({ iso, index: m.index }); }
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { const iso = validIso(+m[1], +m[2], +m[3]); if (iso) out.push({ iso, index: m.index }); }
  for (const m of s.matchAll(/\b(\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre) (\d{4})\b/g)) { const iso = validIso(+m[3], MONTHS[m[2]], +m[1]); if (iso) out.push({ iso, index: m.index }); }
  return { text: s, dates: out.sort((a, b) => a.index - b.index) };
}

/**
 * Proposta senza modello: categoria del dossier da parole chiave (testo e nome del file), scadenza dalla data vicina a
 * "scadenza / valido fino / scade" (altrimenti la data più lontana), intestatario dal nome di una persona nota trovato nel testo.
 * La citazione è la sola riga della scadenza o dell'intestatario, mai altro testo del documento.
 */
export function heuristicProposal({ text = '', filename = '', categories = [], people = [] } = {}) {
  const hay = normText(`${filename} ${text}`);
  const allowed = new Set(categories.length ? categories : CATEGORY_RULES.map(([c]) => c).concat('ALTRO'));
  const cat = (CATEGORY_RULES.find(([c, re]) => allowed.has(c) && re.test(hay)) || [allowed.has('ALTRO') ? 'ALTRO' : null])[0];
  const { text: s, dates } = findDates(text);
  let expires = null; let quote = null; let conf = 0.3;
  const kw = /(scadenza|scade|valid[oa] fino|fino al|validita|data di scadenza|expiry|expires)/g;
  for (const k of s.matchAll(kw)) {
    const d = dates.find((x) => x.index >= k.index && x.index - k.index <= 60);
    if (d) { expires = d.iso; quote = s.slice(Math.max(0, k.index), Math.min(s.length, d.index + 10)).trim().slice(0, 160); conf = 0.8; break; }
  }
  if (!expires && dates.length) { expires = dates.map((d) => d.iso).sort().pop(); conf = 0.4; }
  const holder = matchByName(text, people);
  if (holder) conf = Math.min(0.95, conf + 0.1);
  if (cat && cat !== 'ALTRO') conf = Math.min(0.95, conf + 0.05);
  return {
    category: cat,
    expires_at: expires,
    holder: holder ? `${holder.last_name} ${holder.first_name}` : null,
    holder_id: holder?.id || null,
    confidence: Math.round(conf * 100) / 100,
    quote,
  };
}

/** Normalizza la risposta del modello: categoria ammessa, data ISO, confidenza 0..1, citazione corta. */
export function cleanProposal(raw, categories = []) {
  const allowed = new Set(categories);
  const cat = String(raw?.category || '').toUpperCase();
  const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.expires_at || '')) ? raw.expires_at : null;
  const c = Number(raw?.confidence);
  return {
    category: allowed.has(cat) ? cat : (allowed.has('ALTRO') ? 'ALTRO' : null),
    expires_at: exp,
    holder: raw?.holder ? String(raw.holder).slice(0, 120) : null,
    confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, Math.round(c * 100) / 100)) : null,
    quote: raw?.quote ? String(raw.quote).replace(/\s+/g, ' ').slice(0, 200) : null,
  };
}
