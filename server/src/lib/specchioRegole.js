// Portali specchiati (Portale Service, Portale SGI) · regole pure comuni, senza database né rete.
// I due siti pubblici (service.toscanadiagnostica.it, sgi.toscanadiagnostica.it) nascono dallo stesso generatore e hanno le stesse regole
// per i link stabili (/p /m /doc, app.py), gli stessi JSON in data/ e lo stesso ZIP del repo: qui le regole condivise, parametrizzate per
// modulo dove serve (chiavi dei JSON, cartelle dei file). Ogni modulo le riespone dal proprio lib/regole.js.
// Test: server/test/service-link.test.mjs (attraverso modules/service/lib/regole.js) e server/test/sgi-*.test.mjs.
import crypto from 'node:crypto';

/** slug() di app.py: NFKD, solo ASCII, ogni sequenza non alfanumerica diventa "-", trattini ai bordi tolti. */
export function slug(s) {
  const a = String(s ?? '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  return a.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Indici dei link stabili, come app.py: BY_BASE (codice con e senza revisione → documento) e PREP_BY_SLUG (shortcut, poi codice
 * GIPO come alias → riga della prestazione). Solo le prestazioni con almeno un link entrano nell'indice.
 */
export function costruisciIndice(docs = [], prep = {}) {
  const byBase = new Map();
  for (const d of docs || []) {
    if (!d || !d.code) continue;
    byBase.set(d.code, d);
    // INF001_0a..0s: il suffisso fa parte del codice, non è una revisione
    if (!/_0[a-z]$/.test(d.code)) byBase.set(d.code.split('_').slice(0, -1).join('_') || d.code, d);
  }
  const prepBySlug = new Map();
  const righe = (prep && prep.righe) || [];
  for (const r of righe) if (r.link && r.link.length) prepBySlug.set(slug(r.shortcut || r.codice).toLowerCase(), r);
  for (const r of righe) if (r.link && r.link.length) { const k = slug(r.codice).toLowerCase(); if (!prepBySlug.has(k)) prepBySlug.set(k, r); }
  return { byBase, prepBySlug };
}

/** _lookup() di app.py: codice esatto, maiuscolo, oppure maiuscolo con l'ultima lettera minuscola (TD-SGI-INF001_0A → _0a). */
export function cercaDocumento(codice, indice) {
  const c = String(codice || '').replace(/\.pdf$/i, '');
  if (!c) return null;
  const up = c.toUpperCase();
  return indice.byBase.get(c) || indice.byBase.get(up) || indice.byBase.get(up.slice(0, -1) + c.slice(-1).toLowerCase()) || null;
}

/**
 * Risolve un link stabile. tipo: 'p' | 'm' | 'doc'.
 * Ritorna { file: 'stampabili/x.pdf' } se c'è un PDF da servire, { elenco: '<codice>' } se va mostrato l'elenco delle preparazioni
 * (prestazione sconosciuta o con più preparazioni), null se il documento non esiste (404).
 */
export function risolviLink(tipo, codice, indice) {
  const raw = String(codice || '');
  if (tipo === 'p') {
    const wantPdf = /\.pdf$/i.test(raw);
    const key = slug(wantPdf ? raw.slice(0, -4) : raw).toLowerCase();
    const row = indice.prepBySlug.get(key);
    if (!row) return { elenco: raw };
    if (row.link.length === 1 || wantPdf) return { file: row.link[0].file };
    return { elenco: row.shortcut || row.codice };
  }
  const d = cercaDocumento(raw, indice);
  if (!d) return null;
  if (tipo === 'm') {
    if (d.stampabile) return { file: `stampabili/${d.stampabile}` };
    if (d.pdf) return { file: `docs/${d.pdf}` };
    return null;
  }
  if (tipo === 'doc') return d.pdf ? { file: `docs/${d.pdf}` } : null;
  return null;
}

/**
 * Validatore dei percorsi ammessi nella cache per un portale: cartelle note, niente risalite né percorsi assoluti, solo PDF (e, se la
 * cartella "static" è ammessa, le immagini PNG/JPG dei loghi direttamente sotto static/). Ritorna (p) → percorso normalizzato o null.
 */
export function validatorePercorsi(cartelle) {
  const ammesse = [...cartelle];
  return function percorsoValido(p) {
    // il percorso arriva già decodificato (parametro Express, docs.json, ZIP): nessuna seconda decodifica
    const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s || s.includes('\0')) return null;
    const parti = s.split('/');
    if (parti.some((x) => x === '' || x === '.' || x === '..')) return null;
    const [cartella] = parti;
    if (!ammesse.includes(cartella) || parti.length < 2) return null;
    if (cartella === 'static') return parti.length === 2 && /\.(png|jpe?g)$/i.test(s) ? s : null;
    return /\.pdf$/i.test(s) ? s : null;
  };
}
export const mimeDi = (p) => (/\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'application/pdf');
/** URL del file sul sito di origine: ogni segmento codificato (i nomi contengono spazi, #, virgole). */
export const urlFile = (origine, p) => `${String(origine).replace(/\/+$/, '')}/${p.split('/').map(encodeURIComponent).join('/')}`;

/** JSON canonico: chiavi ordinate a ogni livello, così lo sha non dipende da formattazione o ordine (jsonify di Flask le ordina). */
export function canonico(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
}
export const shaJson = (v) => crypto.createHash('sha256').update(canonico(v)).digest('hex');

/**
 * Confronto tra lo specchio salvato e quanto letto ora dall'origine.
 * prec: { build, sha: { chiave: sha } } (null se lo specchio è vuoto); nuovo: { build, sha: {...} }; chiavi: i JSON del portale, in ordine.
 * Ritorna { cambiato, motivi: [testo] }.
 */
export function confrontaSpecchio(prec, nuovo, chiavi) {
  if (!prec || !prec.sha || !Object.keys(prec.sha).length) return { cambiato: true, motivi: ['primo caricamento'] };
  const motivi = [];
  if ((prec.build || null) !== (nuovo.build || null)) motivi.push(`build ${prec.build || '-'} → ${nuovo.build || '-'}`);
  for (const k of chiavi || Object.keys(nuovo.sha || {})) {
    if (!(k in (nuovo.sha || {}))) continue;
    if (prec.sha[k] !== nuovo.sha[k]) motivi.push(prec.sha[k] ? `${k}.json modificato` : `${k}.json nuovo`);
  }
  return { cambiato: motivi.length > 0, motivi };
}

/**
 * Il carattere NUL (\u0000) non entra in un campo jsonb di PostgreSQL: compare nel testo estratto dai PDF (fulltext.json) e si
 * toglie dalle stringhe, chiavi comprese. Nessun altro cambiamento: il resto del JSON resta com'è sul sito.
 */
export function senzaNul(v) {
  if (typeof v === 'string') return v.includes('\u0000') ? v.replace(/\u0000/g, '') : v;
  if (Array.isArray(v)) return v.map(senzaNul);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [senzaNul(k), senzaNul(x)]));
  return v;
}

/**
 * Controlli minimi sui JSON letti (dall'origine o dallo ZIP): una pagina d'errore non deve sostituire lo specchio.
 * Comuni ai due portali: meta con build, docs elenco, preparazioni con righe, tutte le chiavi presenti.
 */
export function validaContenutiPer(c, chiavi) {
  const errori = [];
  if (!c.meta || typeof c.meta !== 'object' || !c.meta.build) errori.push('meta.json senza "build"');
  if (!Array.isArray(c.docs)) errori.push('docs.json non è un elenco');
  if (!c.preparazioni || !Array.isArray(c.preparazioni.righe)) errori.push('preparazioni.json senza "righe"');
  for (const k of chiavi) if (c[k] === undefined) errori.push(`${k}.json mancante`);
  return errori;
}

/**
 * Nome di un file dello ZIP come compare in docs.json: forma Unicode NFC e sequenze "#Uxxxx" (o "#Lxxxxxx") ridecodificate. Alcuni
 * strumenti di compressione ed estrazione (Info-ZIP senza supporto Unicode) scrivono "Paternit#U00e0" al posto di "Paternità".
 */
export function normalizzaNomeZip(nome) {
  return String(nome || '').replace(/#U([0-9a-fA-F]{4})|#L([0-9a-fA-F]{6})/g, (_, u, l) => String.fromCodePoint(parseInt(u || l, 16))).normalize('NFC');
}

/** Radice del repo dentro lo ZIP (GitHub aggiunge "<repo>-main/"): la cartella che contiene data/meta.json. */
export function radiceZip(nomi) {
  const cand = (nomi || []).filter((n) => n === 'data/meta.json' || n.endsWith('/data/meta.json')).map((n) => n.slice(0, -'data/meta.json'.length)).sort((a, b) => a.length - b.length);
  return cand.length ? cand[0] : null;
}

/**
 * Intestazione HTTP Basic per un'origine protetta (app.py del SGI: SGI_USER/SGI_PASSWORD). Senza password nessuna intestazione;
 * utente vuoto = "sgi" come il default del sito se non indicato diversamente. Utente e password in UTF-8 (RFC 7617).
 * Ritorna 'Basic <base64>' oppure null. I due punti non sono ammessi nell'utente (separano utente e password).
 */
export function intestazioneBasic(utente, password, utentePredefinito = '') {
  if (password == null || password === '') return null;
  const u = String(utente ?? '').trim() || utentePredefinito;
  if (u.includes(':')) throw new Error('Il nome utente non può contenere ":"');
  return `Basic ${Buffer.from(`${u}:${password}`, 'utf8').toString('base64')}`;
}

/** Un URL dell'origine non deve portare credenziali in chiaro (https://utente:password@host): vanno nei campi appositi. */
export function urlConCredenziali(u) {
  try { const x = new URL(u); return Boolean(x.username || x.password); } catch { return false; }
}
