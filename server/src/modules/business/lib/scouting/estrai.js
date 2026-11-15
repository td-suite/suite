// Ricerca prospect · lettura dei dati di anagrafica dalle pagine di un sito aziendale italiano. Funzioni pure (nessuna rete), coperte dai test.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', egrave: 'è', eacute: 'é', agrave: 'à', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Egrave: 'È', Agrave: 'À', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', deg: '°', euro: '€', copy: '©', reg: '®', middot: '·', bull: '•', laquo: '«', raquo: '»', hellip: '…' };
export const decEnt = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m);

/** Testo leggibile di una pagina, una riga per blocco (titoli, paragrafi, celle, voci di elenco, a capo) */
export function testoPagina(html) {
  return decEnt(String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|nav|main|aside|address|dd|dt|dl|figure|figcaption|blockquote|form|hr|option|button|label)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** Collegamenti della pagina: [{ url, testo }] (assoluti, senza ancore, mai mailto/tel) */
export function linkPagina(html, base) {
  const out = []; const visti = new Set();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decEnt(m[1]).trim();
    if (/^(mailto|tel|javascript|whatsapp|sms|fax|data):/i.test(href)) continue;
    let u; try { u = new URL(href, base); } catch { continue; }
    if (!['http:', 'https:'].includes(u.protocol)) continue;
    u.hash = '';
    const k = u.toString(); if (visti.has(k)) continue; visti.add(k);
    out.push({ url: k, testo: decEnt(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120) });
  }
  return out;
}

/** Dati schema.org (JSON-LD) della pagina, appiattiti (anche dentro @graph) */
export function jsonLd(html) {
  const out = [];
  const piatti = (x) => { if (Array.isArray(x)) x.forEach(piatti); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) piatti(x['@graph']); } };
  for (const m of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { piatti(JSON.parse(m[1].trim())); } catch { /* JSON-LD non valido: si ignora */ }
  }
  return out;
}
const tipoLd = (x) => [].concat(x?.['@type'] || []).map(String);
export const organizzazioniLd = (ld) => ld.filter((x) => tipoLd(x).some((t) => /Organization|LocalBusiness|Medical|Hospital|Clinic|Physician|Pharmacy|Dentist|NursingHome|Corporation|Store/i.test(t)));

// ---------------------------------------------------------------- email
const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}\.)+[A-Za-z]{2,24}/g;
const NON_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i;
const SEGNAPOSTO = /^(nome|name|email|mail|tuo|tua|esempio|example|mario\.rossi|user|utente|your|you)@|@(example|esempio|dominio|domain|email|tuodominio|sentry|wixpress)\./i;
export function decodificaCloudflare(hex) {
  try {
    const k = parseInt(hex.slice(0, 2), 16); let s = '';
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    return s;
  } catch { return null; }
}
/** Indirizzi email pubblicati sulla pagina, anche se nascosti ai robot: [{ email, contesto }] (contesto = testo vicino) */
export function emailPubblicate(html) {
  const sorgente = String(html || '');
  const trovate = new Map();
  const aggiungi = (e, contesto = '') => {
    const email = String(e || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/\?.*$/, '').replace(/[.,;:)]+$/, '');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(email) || NON_EMAIL.test(email) || SEGNAPOSTO.test(email) || /\d+x\d*\.?$/.test(email.split('@')[0])) return;
    if (!trovate.has(email)) trovate.set(email, { email, contesto: contesto.replace(/\s+/g, ' ').trim().slice(0, 200) });
  };
  for (const m of sorgente.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) aggiungi(decodificaCloudflare(m[1]));
  for (const m of sorgente.matchAll(/data-user\s*=\s*["']([^"']+)["'][^>]*data-domain\s*=\s*["']([^"']+)["']/gi)) aggiungi(`${m[1]}@${m[2]}`);
  for (const m of sorgente.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) aggiungi(decEnt(decodeURIComponent(m[1])));
  const testo = testoPagina(sorgente);
  const chiaro = testo.replace(/\s*[\[({]\s*(?:at|chiocciola)\s*[\])}]\s*/gi, '@').replace(/\s*[\[({]\s*(?:dot|punto)\s*[\])}]\s*/gi, '.');
  for (const riga of chiaro.split('\n')) for (const m of riga.matchAll(EMAIL_RE)) aggiungi(m[0], riga);
  return [...trovate.values()];
}
const PEC_DOM = /@(?:pec\.|[\w.-]*\.pec\.|[\w.-]*pec\.it$|legalmail\.it|postecert\.it|arubapec\.it|pecimprese\.it|cert\.|[\w.-]*legalmail|sicurezzapostale\.it|mypec\.eu|pec-?[\w-]*\.)/i;
export const ePec = (email) => PEC_DOM.test(String(email || '')) || /^pec@/i.test(String(email || ''));
const GENERICHE = ['direzione', 'segreteria', 'info', 'amministrazione', 'acquisti', 'commerciale', 'contatti', 'accettazione', 'reception', 'ufficio', 'uffici', 'mail', 'posta', 'welcome', 'hello', 'contact', 'office', 'prenotazioni', 'urp', 'protocollo', 'marketing', 'comunicazione', 'personale', 'risorseumane', 'hr', 'privacy', 'dpo', 'noreply', 'no-reply', 'webmaster', 'support', 'assistenza', 'booking', 'cup', 'laboratorio', 'ambulatorio', 'studio', 'farmacia', 'rsa', 'sede', 'job', 'lavoraconnoi', 'cv', 'curriculum', 'fatture', 'fatturazione', 'contabilita', 'ordini'];
export const eGenerica = (email) => { const l = String(email || '').split('@')[0].toLowerCase().replace(/[._-]/g, ''); return GENERICHE.some((g) => l === g || l.startsWith(g) && l.length <= g.length + 3); };
const WEBMAIL = /@(gmail|googlemail|libero|hotmail|outlook|live|yahoo|tiscali|alice|virgilio|icloud|tin|fastwebnet|email|msn|aruba|pec)\./i;
export const eWebmail = (email) => WEBMAIL.test(String(email || ''));

// ---------------------------------------------------------------- telefono, P.IVA, codice fiscale, indirizzo
export function telefoni(testo, html = '') {
  const out = new Set();
  for (const m of String(html).matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) { const t = decEnt(m[1]).replace(/[^\d+]/g, ''); if (t.replace(/\D/g, '').length >= 6) out.add(t); }
  for (const m of String(testo || '').matchAll(/(?:tel(?:efono)?\.?|centralino|chiama(?:ci)?|numero)[\s.:]*((?:\+39[\s.]?)?(?:0\d{1,4}|3\d{2})[\s./-]?\d{2,4}[\s./-]?\d{2,4}(?:[\s./-]?\d{1,4})?)/gi)) {
    const t = m[1].replace(/[^\d+]/g, ''); if (t.replace(/\D/g, '').length >= 6 && t.replace(/\D/g, '').length <= 13) out.add(t);
  }
  return [...out];
}
/** Partita IVA italiana valida (11 cifre con cifra di controllo) */
export function pivaValida(p) {
  const s = String(p || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(s) || /^0{11}$/.test(s)) return false;
  let tot = 0;
  for (let i = 0; i < 10; i += 1) { let n = Number(s[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } tot += n; }
  return (10 - (tot % 10)) % 10 === Number(s[10]);
}
export function partiteIva(testo) {
  const out = [];
  for (const m of String(testo || '').matchAll(/(?:p(?:artita)?\.?\s*i\.?v\.?a\.?|vat(?:\s*(?:number|n\.?|id))?|c\.?\s*f\.?\s*(?:e|\/|-)\s*p\.?\s*i(?:va)?\.?|cod(?:ice)?\.?\s*fisc(?:ale)?\.?\s*(?:e|\/|-)\s*p(?:artita)?\.?\s*iva)\s*(?:n\.?|nr\.?|:|-|n°)?\s*(?:IT)?\s*((?:\d[\s.]?){11})(?!\d)/gi)) {
    const p = m[1].replace(/\D/g, ''); if (pivaValida(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
const SUFF = '(?:S\\.?\\s?r\\.?\\s?l\\.?(?:\\s?s\\.?)?|S\\.?\\s?p\\.?\\s?A\\.?|S\\.?\\s?n\\.?\\s?c\\.?|S\\.?\\s?a\\.?\\s?s\\.?|S\\.?\\s?c\\.?\\s?a\\.?\\s?r\\.?\\s?l\\.?|Soc(?:ietà|\\.)\\s+Coop(?:erativa|\\.)[\\w .]{0,25}|Cooperativa\\s+Sociale(?:\\s+Onlus)?|Onlus|ONLUS|ETS|Impresa\\s+Sociale)';
/** Ragione sociale come la scrive il sito (denominazione seguita dalla forma societaria), di norma nel piè di pagina */
export function ragioniSociali(testo) {
  const out = [];
  const re = new RegExp(`((?:[A-ZÀ-Ý0-9][\\wÀ-ÿ&'’.-]*\\s+){1,6}${SUFF})(?![\\wÀ-ÿ])`, 'g');
  // una denominazione non scavalca la fine di una frase o di una riga
  for (const m of String(testo || '').replace(/([a-zà-ÿ0-9)])[.;:|•·–—]\s+(?=[A-ZÀ-Ý])/g, '$1\n').split('\n').flatMap((riga) => [...riga.matchAll(re)])) {
    const r = m[1].replace(/\s+/g, ' ').trim().replace(/^(?:\d{4}\s+|©\s*)+/, '');
    if (r.length >= 5 && r.length <= 90 && !/^(Copyright|©|P\.?\s?IVA|Privacy|Cookie|Tutti|Sede|Via|Viale|Piazza)\b/i.test(r) && !out.includes(r)) out.push(r);
  }
  return out;
}
const VIA = '(?:Via|Viale|V\\.le|Piazza|P\\.zza|Piazzale|Corso|C\\.so|Largo|Vicolo|Strada|Loc\\.|Località|Lungarno|Borgo|Contrada|Frazione|Fraz\\.)';
/** Indirizzo italiano: { indirizzo, cap, comune, provincia } dal testo (via + CAP + comune + sigla) */
export function indirizzoDaTesto(testo) {
  const re = new RegExp(`(${VIA}\\s+[^\\n,;|]{2,60}?,?\\s*(?:n\\.?\\s*)?\\d{0,4}(?:\\/?[A-Za-z])?)\\s*[,\\n–-]?\\s*(\\d{5})\\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’ .-]{1,40}?)\\s*[,(–-]?\\s*\\(?([A-Z]{2})\\)?(?![A-Za-z])`, 'g');
  const m = re.exec(String(testo || '').replace(/\n/g, ' , '));
  if (!m) return null;
  return { indirizzo: m[1].replace(/\s*,\s*$/, '').replace(/\s+/g, ' ').trim(), cap: m[2], comune: m[3].replace(/\s+/g, ' ').trim(), provincia: m[4] };
}
export function indirizzoDaLd(ld) {
  for (const o of organizzazioniLd(ld)) {
    const a = [].concat(o.address || [])[0];
    if (a && typeof a === 'object' && (a.streetAddress || a.postalCode)) {
      return { indirizzo: a.streetAddress ? String(a.streetAddress).trim() : null, cap: a.postalCode ? String(a.postalCode).trim() : null, comune: a.addressLocality ? String(a.addressLocality).trim() : null,
        provincia: a.addressRegion && /^[A-Za-z]{2}$/.test(String(a.addressRegion).trim()) ? String(a.addressRegion).trim().toUpperCase() : null };
    }
  }
  return null;
}
/** Frase attorno a una corrispondenza, per mostrare l'evidenza (mai più di 240 caratteri) */
export function frase(testo, indice, lunghezza = 0, attorno = 110) {
  const t = String(testo || '');
  // l'evidenza resta dentro la riga (il blocco della pagina) in cui il dato compare: niente voci di menu o piè di pagina accanto
  const inizioRiga = t.lastIndexOf('\n', indice) + 1; const fr = t.indexOf('\n', indice + lunghezza); const fineRiga = fr < 0 ? t.length : fr;
  const da = Math.max(inizioRiga, indice - attorno); const a = Math.min(fineRiga, indice + lunghezza + attorno);
  return `${da > inizioRiga ? '…' : ''}${t.slice(da, a).replace(/\s+/g, ' ').trim()}${a < fineRiga ? '…' : ''}`.slice(0, 240);
}
