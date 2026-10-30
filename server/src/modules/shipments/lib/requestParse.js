// Richieste da documento (PDF o email) in "Richieste in arrivo": funzioni pure, senza database né rete, coperte da
// test/shipments-upload.test.mjs. La parte con I/O (testo del PDF, Claude, abbinamento alla Legal entity) è in lib/requestReader.js.
//  - fileKind: riconosce il tipo di file caricato (pdf, eml, txt; msg non supportato)
//  - parseEml: lettore semplice di email .eml (intestazioni From/Subject/Date, parti text/plain o text/html, allegati PDF)
//  - mockExtract: estrattore a espressioni regolari per il collaudo (SHIPMENTS_AI_MOCK=1, mai in produzione)
//  - extractedToItems: dal JSON letto (Claude o mock) alle righe di revisione nella stessa forma di `parsed` usata da Inbox.jsx
//  - requesterIssue: coerenza dei campi del richiedente (Persona o Legal entity), usata dalla validazione di routes/orders.js
import { htmlToText, provinceOf } from './parser.js';

export const MAX_FILE_MB = 20;
export const MAX_FILES = 10;
export const MAX_CHARS = 40_000;
export const MAX_KITS = 50;
export const MSG_NOT_SUPPORTED = 'Formato .msg di Outlook non supportato: salva l\'email come .eml (File > Salva con nome) o stampala in PDF e caricala di nuovo';

// ---------------- tipo di file ----------------
export function fileKind(name, mime) {
  const n = String(name || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (n.endsWith('.msg') || m === 'application/vnd.ms-outlook') return 'msg';
  if (n.endsWith('.pdf') || m === 'application/pdf') return 'pdf';
  if (n.endsWith('.eml') || m === 'message/rfc822') return 'eml';
  if (n.endsWith('.txt') || m === 'text/plain') return 'txt';
  return null;
}

// ---------------- lettore .eml ----------------
// Decodifica dei byte con il charset dichiarato (utf-8, latin1/windows-1252...), con ricaduta su utf-8
function decodeBytes(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}
function qpToBytes(s) {
  const clean = String(s).replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) { out.push(parseInt(clean.slice(i + 1, i + 3), 16)); i += 2; }
    else { const b = Buffer.from(c, 'utf8'); for (const x of b) out.push(x); }
  }
  return Buffer.from(out);
}
// Parole codificate RFC 2047 nelle intestazioni: =?utf-8?B?...?= e =?iso-8859-1?Q?...?=
export function decodeHeader(v) {
  return String(v || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qpToBytes(txt.replace(/_/g, ' '));
    return decodeBytes(bytes, cs);
  }).replace(/\s+/g, ' ').trim();
}
// Intestazioni (con le righe di continuazione) e corpo separati dalla prima riga vuota
function splitPart(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m) { const k = m[1].toLowerCase(); if (!(k in headers)) headers[k] = m[2]; }
  }
  return { headers, body };
}
const param = (h, name) => { const m = String(h || '').match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i')); return m ? (m[2] ?? m[1]) : null; };
function decodeBody(body, headers) {
  const enc = String(headers['content-transfer-encoding'] || '').toLowerCase().trim();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return qpToBytes(body);
  return Buffer.from(body, 'latin1');   // 7bit/8bit: il testo grezzo è stato letto come latin1, i byte tornano quelli originali
}
// Visita ricorsiva delle parti MIME
function walk(raw, acc, depth = 0) {
  const { headers, body } = splitPart(raw);
  const ct = String(headers['content-type'] || 'text/plain').toLowerCase();
  const type = ct.split(';')[0].trim();
  if (type.startsWith('multipart/') && depth < 8) {
    const boundary = param(headers['content-type'], 'boundary');
    if (!boundary) return;
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of parts.slice(1)) if (p.trim()) walk(p, acc, depth + 1);
    return;
  }
  if (type === 'message/rfc822' && depth < 8) { walk(body, acc, depth + 1); return; }
  const disp = String(headers['content-disposition'] || '').toLowerCase();
  const fname = decodeHeader(param(headers['content-disposition'], 'filename') || param(headers['content-type'], 'name') || '');
  const bytes = decodeBody(body, headers);
  if (type === 'application/pdf' || /\.pdf$/i.test(fname)) { acc.pdfs.push({ filename: fname || 'allegato.pdf', buffer: bytes }); return; }
  if (disp.startsWith('attachment')) return;
  const cs = param(headers['content-type'], 'charset');
  if (type === 'text/plain') acc.plain.push(decodeBytes(bytes, cs));
  else if (type === 'text/html') acc.html.push(decodeBytes(bytes, cs));
}

// parseEml(buffer|string) → { from, subject, date, text, pdfs: [{ filename, buffer }] }
export function parseEml(input) {
  const raw = Buffer.isBuffer(input) ? input.toString('latin1') : String(input || '');
  const { headers } = splitPart(raw);
  const acc = { plain: [], html: [], pdfs: [] };
  walk(raw, acc);
  const text = (acc.plain.length ? acc.plain.join('\n\n') : acc.html.map(htmlToText).join('\n\n')).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  let date = null;
  if (headers.date) { const d = new Date(headers.date); if (!Number.isNaN(d.getTime())) date = d.toISOString(); }
  return { from: decodeHeader(headers.from || '') || null, subject: decodeHeader(headers.subject || '') || null, date, text, pdfs: acc.pdfs };
}
// Indirizzo email dentro "Nome Cognome <nome@dominio>"
export const emailOf = (s) => (String(s || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '').toLowerCase() || null;

// ---------------- estrattore di prova (SHIPMENTS_AI_MOCK=1) ----------------
// Stessa forma del JSON chiesto a Claude. Riconosce: ragione sociale con forma societaria o "Studio/Centro/Farmacia...", P.IVA,
// codice fiscale, referente ("referente", "dott./dott.ssa"), email, telefono, "N kit", "con analisi/esame", via e numero, CAP città (PR).
const FORME = /\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|onlus|coop(?:erativa)?|societ[àa] [a-z]+)(?=[\s,;)]|$)/i;
const NUM_WORDS = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export function mockExtract(text) {
  const t = String(text || '').replace(/\r/g, '');
  const flat = t.replace(/\s+/g, ' ');
  const conf = {};
  const hit = (key, value, quote, livello = 'media') => { if (value != null && value !== '') conf[key] = { livello, citazione: String(quote || value).slice(0, 200) }; return value ?? null; };
  // richiedente
  const piva = flat.match(/\b(?:p\.?\s?iva|partita iva|vat(?: number)?)\s*[:.]?\s*(?:IT)?\s?(\d{11})\b/i);
  const cf = flat.match(/\b(?:c\.?\s?f\.?|codice fiscale)\s*[:.]?\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\b/i);
  let ragione = null; let ragioneQuote = null;
  const forma = FORME.exec(t);
  if (forma) {
    // parole con l'iniziale maiuscola subito prima della forma societaria, sulla stessa riga (al massimo sei)
    const words = t.slice(t.lastIndexOf('\n', forma.index) + 1, forma.index).trim().split(/\s+/);
    const name = [];
    while (words.length && name.length < 6 && /^[A-ZÀ-Ü0-9&]/.test(words[words.length - 1])) name.unshift(words.pop());
    if (name.length) { ragione = `${name.join(' ')} ${forma[0].trim()}`.replace(/[,;]+$/, ''); ragioneQuote = ragione; }
  }
  if (!ragione) { const s = flat.match(/\b((?:Studio|Centro|Poliambulatorio|Farmacia|Ambulatorio|Clinica|Laboratorio)\s+(?:[A-ZÀ-Ü][\wÀ-ü'.-]*\s?){1,4})/); if (s) { ragione = s[1].trim(); ragioneQuote = s[0]; } }
  const entity = Boolean(ragione || piva);
  const email = flat.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || null;
  const tel = flat.match(/\b(?:tel(?:efono)?|phone|cell(?:ulare)?|mobile)\.?\s*[:.]?\s*(\+?[\d][\d\s/.-]{6,}\d)/i);
  const refM = flat.match(/\breferente\s*[:,]?\s*((?:dott\.?(?:ssa)?|dr\.?|sig\.?(?:ra)?|prof\.?(?:ssa)?)?\s*[A-ZÀ-Ü][\wÀ-ü'-]+(?:\s+[A-ZÀ-Ü][\wÀ-ü'-]+){1,2})/i)
    || flat.match(/\b((?:dott\.?(?:ssa)?|dr\.?|prof\.?(?:ssa)?)\s+[A-ZÀ-Ü][\wÀ-ü'-]+(?:\s+[A-ZÀ-Ü][\wÀ-ü'-]+){1,2})/);
  const referente = refM ? refM[1].replace(/\s+/g, ' ').trim() : null;
  // destinatario: nome della persona (se il richiedente è una persona) e indirizzo
  let nome = null; let cognome = null; let titolo = null;
  if (!entity) {
    const n = flat.match(/\b(?:nome|name)\s*[:]\s*([A-ZÀ-Ü][\wÀ-ü'-]+)\s+(?:cognome|surname)\s*[:]\s*([A-ZÀ-Ü][\wÀ-ü' -]+?)(?=[,;\n]| (?:via|indirizzo|email|tel)\b|$)/i)
      || flat.match(/\b(sig\.?(?:ra)?|signor[ae]?|mr\.?|mrs\.?|ms\.?|dott\.?(?:ssa)?)\s+([A-ZÀ-Ü][\wÀ-ü'-]+)\s+([A-ZÀ-Ü][\wÀ-ü'-]+)/i);
    if (n && n.length === 3) { nome = hit('destinatario.nome', n[1], n[0]); cognome = hit('destinatario.cognome', n[2].trim(), n[0]); }
    else if (n) { titolo = n[1].replace(/\.$/, ''); nome = hit('destinatario.nome', n[2], n[0]); cognome = hit('destinatario.cognome', n[3], n[0]); }
  }
  // indirizzo di consegna: prima quello dopo "consegnare a / spedire a / ship to", altrimenti il primo del testo (l'intestazione
  // della carta intestata del richiedente non è l'indirizzo di consegna)
  const VIA_RE = /\b((?:via|viale|piazza|piazzale|corso|largo|vicolo|strada|loc\.?|localit[àa])\s+[^,\n]{2,60}?,?\s*\d+[a-z]?(?:\/\d+)?)\b/i;
  const CAP_RE = /\b(\d{5})\s+([A-ZÀ-Ü][\wÀ-ü' -]{1,40}?)\s*(?:\(([A-Z]{2})\)|,|\.|$)/;
  const deliv = flat.search(/\b(consegn\w*|spedi\w*|recapit\w*|indirizzo di consegna|ship(?:ping)?(?: address)? to|deliver\w*(?: to)?)\b/i);
  const after = deliv >= 0 ? flat.slice(deliv) : '';
  const via = after.match(VIA_RE) || flat.match(VIA_RE);
  const capCitta = after.match(CAP_RE) || flat.match(CAP_RE);
  // richiesta
  const q = flat.match(/\b(\d{1,3}|un[oa]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kit)\b/i);
  const quantita = q ? (Number(q[1]) || NUM_WORDS[q[1].toLowerCase()] || 1) : null;
  const esame = /\b(con (?:l')?(?:analisi|esame|esami|referto)|kit\s*\+\s*esame|and (?:lab )?(?:analysis|test))/i.exec(flat);
  const soloKit = /\b(solo (?:il )?kit|kit only|senza analisi)\b/i.exec(flat);
  const ordine = flat.match(/\b(?:ordine|order|rif(?:erimento)?\.?)\s*(?:n\.?|nr\.?|no\.?|#)?\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{3,})\b/i);
  const out = {
    richiedente: {
      tipo: entity ? 'LEGAL_ENTITY' : 'PERSONA',
      ragione_sociale: hit('richiedente.ragione_sociale', ragione, ragioneQuote),
      piva: hit('richiedente.piva', piva?.[1] || null, piva?.[0], 'alta'),
      cf: hit('richiedente.cf', cf?.[1] || null, cf?.[0], 'alta'),
      referente: hit('richiedente.referente', entity ? referente : null, refM?.[0]),
      email: entity ? hit('richiedente.email', email, email, 'alta') : null,
      telefono: entity ? hit('richiedente.telefono', tel?.[1]?.replace(/[^\d+]/g, '') || null, tel?.[0]) : null,
    },
    destinatario: {
      titolo,
      nome, cognome,
      indirizzo1: hit('destinatario.indirizzo1', via ? via[1].replace(/,\s*$/, '').trim() : null, via?.[0]),
      indirizzo2: null,
      cap: hit('destinatario.cap', capCitta?.[1] || null, capCitta?.[0], 'alta'),
      citta: hit('destinatario.citta', capCitta?.[2]?.trim() || null, capCitta?.[0]),
      provincia: hit('destinatario.provincia', capCitta?.[3] || null, capCitta?.[0]),
      paese: 'Italia',
      telefono: entity ? null : hit('destinatario.telefono', tel?.[1]?.replace(/[^\d+]/g, '') || null, tel?.[0]),
      email: entity ? null : hit('destinatario.email', email, email, 'alta'),
    },
    richiesta: {
      tipo: hit('richiesta.tipo', esame ? 'KIT_AND_EXAM' : soloKit ? 'KIT_ONLY' : null, (esame || soloKit)?.[0]),
      quantita_kit: hit('richiesta.quantita_kit', quantita, q?.[0], 'alta'),
      prodotto: null,
      riferimento_esterno: hit('richiesta.riferimento_esterno', ordine?.[1] || null, ordine?.[0], 'bassa'),
      note: null,
      lingua: /\b(dear|please|kit only|shipping address)\b/i.test(flat) ? 'en' : 'it',
    },
    confidenza: conf,
  };
  return out;
}

// ---------------- dal JSON letto alle righe di revisione ----------------
const s = (v, max = 200) => { const x = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return x && x.toLowerCase() !== 'null' ? x.slice(0, max) : ''; };
const LIVELLO_BASSO = new Set(['bassa', 'low']);

// Campi a bassa confidenza (notazione puntata), per gli avvisi
export function lowConfidence(extracted) {
  return Object.entries(extracted?.confidenza || {}).filter(([, v]) => LIVELLO_BASSO.has(String(v?.livello || '').toLowerCase())).map(([k]) => k);
}

/**
 * extractedToItems(extracted, { match })
 *  match: Legal entity abbinata al richiedente ({ id, name, how }) oppure null
 * Ritorna { items, warnings }: items nella forma di `parsed` (come i blocchi Endeavor, più i campi Lifestyle e del richiedente),
 * una riga per kit se quantita_kit > 1 (con riferimento esterno numerato -1, -2...: il riferimento è unico per richiesta).
 */
export function extractedToItems(extracted, { match = null } = {}) {
  const e = extracted || {};
  const ric = e.richiedente || {}; const dst = e.destinatario || {}; const req = e.richiesta || {};
  const entity = String(ric.tipo || '').toUpperCase() === 'LEGAL_ENTITY' || Boolean(s(ric.ragione_sociale) || s(ric.piva));
  const ragione = s(ric.ragione_sociale) || match?.name || '';
  let first = s(dst.nome, 80); let last = s(dst.cognome, 80);
  const named = Boolean(first || last);
  if (!named && entity) { last = ragione.slice(0, 80); first = ''; }
  const tipo = String(req.tipo || '').toUpperCase();
  const orderType = ['KIT_ONLY', 'KIT_AND_EXAM'].includes(tipo) ? tipo : 'KIT_ONLY';
  const qty = Math.max(1, Math.min(MAX_KITS, Math.round(Number(req.quantita_kit) || 1)));
  const lang = String(req.lingua || '').toLowerCase() === 'en' ? 'en' : 'it';
  const prov = s(dst.provincia, 40);
  const notes = [s(req.prodotto, 300), s(req.note, 1500)].filter(Boolean).join(' · ');
  const ref = s(req.riferimento_esterno, 55);
  const base = {
    project: 'LIFESTYLE', order_type: orderType, external_ref: ref || null,
    requester_kind: entity ? 'LEGAL_ENTITY' : 'PERSONA',
    requester_org_id: entity ? (match?.id || null) : null,
    requester_name: entity ? ragione || null : null,
    requester_vat: entity ? s(ric.piva, 20) || null : null,
    requester_contact: entity ? s(ric.referente, 120) || null : null,
    requester_email: entity ? (s(ric.email, 200).toLowerCase() || null) : null,
    requester_phone: entity ? (s(ric.telefono, 40) || null) : null,
    patient_title: s(dst.titolo, 20) || null, patient_first_name: first, patient_last_name: last,
    address1: s(dst.indirizzo1), address2: s(dst.indirizzo2) || null, city: s(dst.citta, 100), province: prov ? provinceOf(prov) : null,
    zip: s(dst.cap, 12) || null, country: s(dst.paese, 60) || 'Italia',
    phone: s(dst.telefono, 40) || null, email: s(dst.email, 200).toLowerCase() || null,
    lang, notes: notes || null, quantity: qty,
  };
  const w = [];
  if (!base.patient_last_name || (!entity && !base.patient_first_name)) w.push('name');
  if (!base.address1) w.push('address');
  if (!base.city) w.push('city');
  if (!['KIT_ONLY', 'KIT_AND_EXAM'].includes(tipo)) w.push('type');
  if (entity && !base.requester_org_id) w.push('requester_unmatched');
  const items = Array.from({ length: qty }, (_, i) => ({ ...base, external_ref: ref ? (qty > 1 ? `${ref}-${i + 1}` : ref) : null, warnings: [...w] }));
  return { items, warnings: w, entity, quantity: qty };
}

// ---------------- coerenza del richiedente ----------------
// Ritorna null se i dati sono coerenti, altrimenti { path, it, en } con il messaggio da mostrare.
export function requesterIssue(d) {
  const kind = d?.requester_kind || 'PERSONA';
  if (kind === 'LEGAL_ENTITY') {
    if (!d.requester_org_id) return { path: 'requester_org_id', it: 'Scegli la Legal entity che richiede il kit', en: 'Choose the legal entity requesting the kit' };
    if (!s(d.patient_last_name)) return { path: 'patient_last_name', it: 'Indica il destinatario del kit (persona, reparto o la ragione sociale stessa)', en: 'Enter the kit recipient (person, department or the company name itself)' };
    return null;
  }
  if (kind !== 'PERSONA') return { path: 'requester_kind', it: 'Tipo di richiedente non valido', en: 'Invalid requester type' };
  if (!s(d.patient_first_name) || !s(d.patient_last_name)) return { path: 'patient_first_name', it: 'Nome e cognome del paziente sono obbligatori', en: 'Patient first and last name are required' };
  return null;
}

// ---------------- notifica di spedizione ----------------
// Destinatario della email "kit spedito" (impostazione notify_patient_on_ship): il destinatario del kit se ha un'email; altrimenti,
// con richiedente Legal entity, il richiedente (email della richiesta o, in mancanza, quella della Legal entity). { email, greet, toRequester } o null
export const patientLabel = (o) => [o.patient_title, o.patient_first_name, o.patient_last_name].filter(Boolean).join(' ');
export function shipNoticeRecipient(o, orgEmail = null) {
  if (o.email) return { email: o.email, greet: o.patient_first_name || patientLabel(o), toRequester: false };
  if (o.requester_kind !== 'LEGAL_ENTITY') return null;
  const email = o.requester_email || orgEmail;
  if (!email) return null;
  return { email, greet: o.requester_contact || o.requester_org_name || 'Cliente', toRequester: true };
}
