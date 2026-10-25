// Lettura delle email "Kits to send out" di Affinity / Endeavor DNA.
// Principio: il codice scritto nell'email (oggetto o testo) è il codice a barre del kit. Il riconoscimento parte quindi
// dall'elenco dei kit caricati a magazzino (qualunque formato di codice) e, in subordine, da qualunque token che
// somigli a un codice. Per ogni kit trovato si ricavano dal testo nome, indirizzo, telefono e modalità di spedizione.
// Formato tipico di un blocco:
//   AFF298672IT - Standard SDA
//   Ms. Andrea Green
//   CAMPING LA ROCCIA, VIA MADONNA 84
//   LAMPEDUSA
//   AGRIGENTO
//   92031
//   Italy
//   TEL: 00393342107111
// Il parser è tollerante: ogni campo non riconosciuto resta vuoto e l'operatore lo completa prima della conferma.

const TOKEN_SRC = '[A-Z][A-Z0-9-]{3,}[A-Z0-9]';                      // candidati codice: lettere/numeri/trattini
const tokens = (s) => [...String(s).matchAll(new RegExp(TOKEN_SRC, 'gi'))].map((m) => m[0]); // regex nuova a ogni uso: niente lastIndex condiviso
const hasToken = (s) => new RegExp(TOKEN_SRC, 'i').test(s);
const LOOKS_LIKE_CODE = /^(?=.*\d{3,})[A-Z][A-Z0-9-]{5,}$/i;     // fallback: almeno 3 cifre, lunghezza minima
const TITLE_RE = /^(mr|mrs|ms|miss|mx|dr|sig|sig\.ra|sig\.na|sigra|dott|dott\.ssa|prof)\.?\s+/i;
const PHONE_RE = /^(tel|phone|telefono|mobile|cell|cellulare)\.?\s*[:.]?\s*(.+)$/i;
const ZIP_RE = /^\d{5}$/;
const HEADER_RE = /^(da|from|a|to|cc|ccn|bcc|inviato|sent|date|data|oggetto|subject|re|r|fw|fwd|i)\s*:/i;
const NOISE_RE = /^(hi|hello|dear|ciao|buongiorno|good morning|could you|please|thanks|thank you|regards|kind regards|best regards|administration|cordiali|grazie|saluti|inviato da|sent from|www\.|http)/i;
const MODE_WORDS = /\b(standard|express|sda|return|ritorno|outbound|andata|solo|only)\b/i;
const COUNTRIES = ['italy', 'italia', 'san marino', 'vatican', 'vaticano', 'switzerland', 'svizzera', 'france', 'francia', 'germany', 'germania', 'spain', 'spagna', 'austria', 'slovenia', 'malta', 'united kingdom', 'uk'];

export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Riconosce la modalità di spedizione.
// 1) frase breve uguale a un alias del tariffario (es. "Standard SDA", "Express Return SDA");
// 2) altrimenti legge tutta la frase: ogni STANDARD/EXPRESS viene attribuito all'andata o al ritorno dal contesto
//    (busta/envelope/reply/return/ritorno = ritorno; send/ship/kit by/andata = andata) e la coppia di tratte sceglie la modalità.
const RETURN_CTX = /\b(return|reply|back|ritorno|rientro|restituzione|envelope|busta|prepaid|prepagat)/i;
const OUT_CTX = /\b(send|ship|dispatch|deliver|kit by|outbound|andata|invio|spedire|spedizione del kit)/i;

export function inferLegs(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const re = /\b(standard|express)\b/gi;
  const legs = { outbound: null, ret: null };
  const undecided = [];
  let m;
  while ((m = re.exec(t))) {
    const svc = m[1].toUpperCase();
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    const after = t.slice(m.index, m.index + 45);
    const byOut = /\b(kit|send|sent|ship|shipped|sending|spedire|spedito)\s+(it\s+|this\s+kit\s+|the\s+kit\s+)?(by|via|con|in)\s*$/i.test(before);
    const retSig = /\b(envelope|busta|reply)\b/i.test(after) || /\b(return|ritorno|rientro|back)\b/i.test(after.slice(0, 30)) || /\b(return|reply|ritorno|rientro)\b/i.test(before.slice(-25));
    const outSig = /\b(outbound|andata|only|solo)\b/i.test(after.slice(0, 30)) || /\b(send|ship|dispatch|invio|spedizione)\b/i.test(before.slice(-25));
    let side = null;
    if (byOut) side = 'outbound'; else if (retSig) side = 'ret'; else if (outSig) side = 'outbound';
    if (side === 'outbound' && !legs.outbound) legs.outbound = svc;
    else if (side === 'ret' && !legs.ret) legs.ret = svc;
    else undecided.push(svc);
  }
  for (const svc of undecided) { if (!legs.outbound) legs.outbound = svc; else if (!legs.ret) legs.ret = svc; }
  if (legs.outbound && !legs.ret && /\b(both ways|round trip|outbound and return|andata e ritorno|a\/r|go and return)\b/i.test(t)) legs.ret = legs.outbound;
  if (!legs.outbound && !legs.ret) return null;
  return legs;
}

export function matchMode(text, modes) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!]+$/, '').trim();
  if (!t) return null;
  const aliasesOf = (m) => String(m.email_aliases || '').split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const m of modes) if (aliasesOf(m).includes(t) || [m.name_it, m.name_en].map((x) => String(x || '').toLowerCase()).includes(t)) return { id: m.id, code: m.code, exact: true };
  const legs = inferLegs(t);
  if (legs) {
    const found = modes.find((m) => (m.outbound_service || null) === legs.outbound && (m.return_service || null) === legs.ret);
    if (found) return { id: found.id, code: found.code, exact: false, legs };
  }
  let best = null;
  for (const m of modes) for (const alias of aliasesOf(m)) if (t.includes(alias) && (!best || alias.length > best.len)) best = { id: m.id, code: m.code, len: alias.length };
  if (best && !legs) return { id: best.id, code: best.code, exact: false };
  if (legs) return { id: null, code: null, exact: false, legs }; // tratte lette ma nessuna modalità del tariffario le copre
  return null;
}

const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const isHeader = (l) => HEADER_RE.test(l);

/**
 * parseKitEmail(text, modes, { subject, knownCodes })
 *  knownCodes: elenco dei codici a barre presenti nel sistema (qualunque stato) oppure mappa { CODICE: stato }
 * Ritorna un blocco per codice trovato, con in_stock / kit_status quando il codice è a magazzino.
 */
export function parseKitEmail(text, modes = [], opts = {}) {
  const subject = String(opts.subject || '');
  const known = new Map();
  if (opts.knownCodes) {
    if (Array.isArray(opts.knownCodes)) for (const k of opts.knownCodes) known.set(norm(typeof k === 'string' ? k : k.barcode), typeof k === 'string' ? null : k.status);
    else for (const [k, v] of Object.entries(opts.knownCodes)) known.set(norm(k), v);
  }
  const body = htmlToText(text);
  const lines = body.split('\n').map((l) => l.trim());

  // 1) candidati: prima i codici noti a magazzino, poi quelli che somigliano a un codice
  const found = [];     // { code, lineIdx, fromSubject }
  const seen = new Set();
  const consider = (raw, lineIdx, fromSubject) => {
    const code = norm(raw);
    if (seen.has(code)) return;
    const isKnown = known.has(code);
    if (!isKnown && !LOOKS_LIKE_CODE.test(code)) return;
    if (!isKnown && /^(TEL|CAP|ZIP|IBAN|AFF|AFFINITY|SDA|FEDEX|AWB)$/i.test(code)) return;
    seen.add(code);
    found.push({ code, lineIdx, fromSubject });
  };
  lines.forEach((l, i) => { if (isHeader(l)) return; for (const tk of tokens(l)) consider(tk, i, false); });
  // righe di intestazione citate (inoltri) e oggetto: il codice conta, ma la riga non è l'inizio del blocco
  lines.forEach((l) => { if (isHeader(l)) for (const tk of tokens(l)) consider(tk, -1, true); });
  for (const tk of tokens(subject)) consider(tk, -1, true);
  // tiene solo i noti se ce ne sono (evita falsi positivi tipo parole in maiuscolo); altrimenti tutti i candidati plausibili
  const knownFound = found.filter((f) => known.has(f.code));
  const candidates = knownFound.length ? knownFound : found.filter((f) => /\d{4,}/.test(f.code));
  if (!candidates.length) return [];

  // 2) per ogni candidato individua il blocco di righe con i dati del paziente
  const codeLineIdx = new Set(candidates.filter((c) => c.lineIdx >= 0).map((c) => c.lineIdx));
  const blockFrom = (start) => {
    const out = [];
    for (let i = start; i < lines.length; i++) {
      const l = lines[i];
      if (!l) { if (out.length) break; else continue; }
      if (i !== start && codeLineIdx.has(i)) break;
      if (isHeader(l) || /^(thanks|regards|kind regards|best regards|administration|cordiali|grazie|saluti|inviato da|sent from)/i.test(l)) break;
      if (i === start) continue; // la riga del codice stesso
      out.push(l);
    }
    return out;
  };
  // blocco generico: primo gruppo di righe che contiene un telefono o un CAP (per codici presenti solo in oggetto/intestazione)
  const genericBlock = () => {
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i] || isHeader(lines[i]) || NOISE_RE.test(lines[i]) || codeLineIdx.has(i)) { start = -1; continue; }
      if (start < 0) start = i;
      if (PHONE_RE.test(lines[i]) || ZIP_RE.test(lines[i]) || COUNTRIES.includes(lines[i].toLowerCase())) {
        const out = [];
        for (let j = start; j < lines.length && lines[j]; j++) if (!isHeader(lines[j]) && !NOISE_RE.test(lines[j])) out.push(lines[j]);
        return out;
      }
    }
    return [];
  };

  const results = [];
  for (const c of candidates) {
    const r = { external_ref: c.code, mode_text: '', mode: null, in_stock: known.get(c.code) === 'IN_STOCK', kit_known: known.has(c.code), kit_status: known.get(c.code) || null,
      patient_title: null, patient_first_name: '', patient_last_name: '', address1: '', address2: null, city: '', province: null, zip: null, country: 'Italia', phone: null, warnings: [] };
    let block = [];
    if (c.lineIdx >= 0) {
      // testo della modalità: resto della riga del codice, depurato da altri codici e separatori
      let rest = lines[c.lineIdx];
      for (const k of candidates) rest = rest.replace(new RegExp(k.code.replace(/[-]/g, '\\-'), 'ig'), ' ');
      rest = rest.replace(/^[\s,;:|–-]+|[\s,;:|–-]+$/g, '').replace(/\s*[,;|]\s*/g, ' ').trim();
      r.mode_text = rest;
      block = blockFrom(c.lineIdx);
      if (!r.mode_text && block.length && MODE_WORDS.test(block[0]) && block[0].split(/\s+/).length <= 6 && !TITLE_RE.test(block[0])) r.mode_text = block.shift();
    } else {
      block = genericBlock();
      if (block.length && MODE_WORDS.test(block[0]) && block[0].split(/\s+/).length <= 6 && !TITLE_RE.test(block[0])) r.mode_text = block.shift();
    }
    if (!r.mode_text) { // cerca la modalità in qualunque riga breve del testo
      const l = lines.find((x) => x && !isHeader(x) && MODE_WORDS.test(x) && x.split(/\s+/).length <= 6 && !TITLE_RE.test(x) && !hasToken(x.replace(/\b(SDA)\b/ig, '')));
      if (l) r.mode_text = l;
    }
    r.mode = matchMode(r.mode_text, modes) || (r.mode_text ? null : matchMode(body.split('\n').filter((x) => MODE_WORDS.test(x) && x.length < 80).join(' | '), modes));

    const rest = [];
    for (const l of block) {
      const p = l.match(PHONE_RE);
      if (p) { r.phone = p[2].replace(/[^\d+]/g, ''); continue; }
      if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(l)) { r.email = l.toLowerCase(); continue; }
      rest.push(l);
    }
    if (rest.length) {
      let name = rest.shift();
      const t = name.match(TITLE_RE);
      if (t) { r.patient_title = t[1].replace(/\.$/, ''); name = name.replace(TITLE_RE, ''); }
      const parts = name.trim().split(/\s+/);
      r.patient_first_name = parts.shift() || '';
      r.patient_last_name = parts.join(' ');
      if (!r.patient_last_name) { r.patient_last_name = r.patient_first_name; r.patient_first_name = ''; r.warnings.push('name'); }
    }
    if (rest.length && COUNTRIES.includes(rest[rest.length - 1].toLowerCase())) {
      const cn = rest.pop().toLowerCase();
      r.country = (cn === 'italy' || cn === 'italia') ? 'Italia' : capitalize(cn);
    }
    const zipIdx = rest.findIndex((l) => ZIP_RE.test(l));
    if (zipIdx >= 0) { r.zip = rest[zipIdx]; rest.splice(zipIdx, 1); }
    else { const z = rest.join(' ').match(/\b(\d{5})\b/); if (z) r.zip = z[1]; }
    if (rest.length >= 3) { r.province = provinceOf(rest.pop()); r.city = rest.pop(); }
    else if (rest.length === 2) { r.city = rest.pop(); }
    r.address1 = rest.shift() || '';
    if (rest.length) r.address2 = rest.join(', ');
    if (!r.address1) r.warnings.push('address');
    if (!r.city) r.warnings.push('city');
    if (r.mode && !r.mode.id) { r.legs = r.mode.legs; r.mode = null; r.warnings.push('mode_no_tariff'); }
    if (!r.mode) r.warnings.push('mode');
    if (!r.kit_known) r.warnings.push('kit_unknown');
    else if (!r.in_stock) r.warnings.push('kit_not_available');
    results.push(r);
  }
  return results;
}

const PROVINCES = { agrigento: 'AG', alessandria: 'AL', ancona: 'AN', aosta: 'AO', arezzo: 'AR', 'ascoli piceno': 'AP', asti: 'AT', avellino: 'AV', bari: 'BA', 'barletta-andria-trani': 'BT', belluno: 'BL', benevento: 'BN', bergamo: 'BG', biella: 'BI', bologna: 'BO', bolzano: 'BZ', brescia: 'BS', brindisi: 'BR', cagliari: 'CA', caltanissetta: 'CL', campobasso: 'CB', caserta: 'CE', catania: 'CT', catanzaro: 'CZ', chieti: 'CH', como: 'CO', cosenza: 'CS', cremona: 'CR', crotone: 'KR', cuneo: 'CN', enna: 'EN', fermo: 'FM', ferrara: 'FE', firenze: 'FI', foggia: 'FG', 'forli-cesena': 'FC', 'forlì-cesena': 'FC', frosinone: 'FR', genova: 'GE', gorizia: 'GO', grosseto: 'GR', imperia: 'IM', isernia: 'IS', 'la spezia': 'SP', "l'aquila": 'AQ', latina: 'LT', lecce: 'LE', lecco: 'LC', livorno: 'LI', lodi: 'LO', lucca: 'LU', macerata: 'MC', mantova: 'MN', 'massa-carrara': 'MS', 'massa carrara': 'MS', matera: 'MT', messina: 'ME', milano: 'MI', modena: 'MO', 'monza e brianza': 'MB', 'monza e della brianza': 'MB', napoli: 'NA', novara: 'NO', nuoro: 'NU', oristano: 'OR', padova: 'PD', palermo: 'PA', parma: 'PR', pavia: 'PV', perugia: 'PG', 'pesaro e urbino': 'PU', pescara: 'PE', piacenza: 'PC', pisa: 'PI', pistoia: 'PT', pordenone: 'PN', potenza: 'PZ', prato: 'PO', ragusa: 'RG', ravenna: 'RA', 'reggio calabria': 'RC', 'reggio emilia': 'RE', rieti: 'RI', rimini: 'RN', roma: 'RM', rovigo: 'RO', salerno: 'SA', sassari: 'SS', savona: 'SV', siena: 'SI', siracusa: 'SR', sondrio: 'SO', 'sud sardegna': 'SU', taranto: 'TA', teramo: 'TE', terni: 'TR', torino: 'TO', trapani: 'TP', trento: 'TN', treviso: 'TV', trieste: 'TS', udine: 'UD', varese: 'VA', venezia: 'VE', 'verbano-cusio-ossola': 'VB', vercelli: 'VC', verona: 'VR', 'vibo valentia': 'VV', vicenza: 'VI', viterbo: 'VT' };
export function provinceOf(s) {
  const t = String(s || '').trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return PROVINCES[t.toLowerCase()] || t;
}
const capitalize = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
