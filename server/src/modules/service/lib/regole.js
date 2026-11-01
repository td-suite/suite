// Portale Service · regole pure (senza database né rete), testate in server/test/service-*.test.mjs:
// - risoluzione dei link stabili /p/<shortcut>, /m/<codice>, /doc/<codice> con le stesse regole di app.py del sito di origine;
// - percorsi dei file ammessi nella cache (docs, stampabili, certificati, vademecum, loghi in static);
// - JSON canonico e sha256 per riconoscere se lo specchio è cambiato (indipendente da formattazione e ordine delle chiavi);
// - lettura di X-Frame-Options e Content-Security-Policy frame-ancestors (si può incorporare il Vademecum online?);
// - mappa delle voci di menu Servizi (menu.json) con le quattro voci rimappate dal CEO (01/11/2026).
import crypto from 'node:crypto';

// I nove JSON del sito di origine (data/*.json): meta e docs/preparazioni/fulltext generati dal build, gli altri redazionali
export const CHIAVI = ['meta', 'docs', 'preparazioni', 'fulltext', 'certificazioni', 'veq', 'contatti', 'blog', 'menu'];
// Cartelle dei file serviti dal sito di origine e messi in cache dalla Suite
export const CARTELLE = ['docs', 'stampabili', 'certificati', 'vademecum', 'static'];

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
 * Ritorna { file: 'stampabili/x.pdf' } se c'è un PDF da servire, { elenco: '<codice>' } se va mostrato l'elenco nella pagina
 * Preparazioni e documenti (prestazione sconosciuta o con più preparazioni), null se il documento non esiste (404).
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
 * Percorso di un file ammesso nella cache: cartella nota, niente risalite né percorsi assoluti, solo PDF (e le immagini PNG/JPG
 * dei loghi in static/). Ritorna il percorso normalizzato (separatore "/") oppure null.
 */
export function percorsoValido(p) {
  // il percorso arriva già decodificato (parametro Express, docs.json, ZIP): nessuna seconda decodifica
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('\0')) return null;
  const parti = s.split('/');
  if (parti.some((x) => x === '' || x === '.' || x === '..')) return null;
  const [cartella] = parti;
  if (!CARTELLE.includes(cartella) || parti.length < 2) return null;
  if (cartella === 'static') return parti.length === 2 && /\.(png|jpe?g)$/i.test(s) ? s : null;
  return /\.pdf$/i.test(s) ? s : null;
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
 * prec: { build, sha: { chiave: sha } } (null se lo specchio è vuoto); nuovo: { build, sha: {...} }.
 * Ritorna { cambiato, motivi: [testo] }.
 */
export function confrontaSpecchio(prec, nuovo) {
  if (!prec || !prec.sha || !Object.keys(prec.sha).length) return { cambiato: true, motivi: ['primo caricamento'] };
  const motivi = [];
  if ((prec.build || null) !== (nuovo.build || null)) motivi.push(`build ${prec.build || '-'} → ${nuovo.build || '-'}`);
  for (const k of CHIAVI) {
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

/** Controlli minimi sui JSON letti (dall'origine o dallo ZIP): una pagina d'errore non deve sostituire lo specchio. */
export function validaContenuti(c) {
  const errori = [];
  if (!c.meta || typeof c.meta !== 'object' || !c.meta.build) errori.push('meta.json senza "build"');
  if (!Array.isArray(c.docs)) errori.push('docs.json non è un elenco');
  if (!c.preparazioni || !Array.isArray(c.preparazioni.righe)) errori.push('preparazioni.json senza "righe"');
  for (const k of CHIAVI) if (c[k] === undefined) errori.push(`${k}.json mancante`);
  return errori;
}

/**
 * Nome di un file dello ZIP come compare in docs.json: forma Unicode NFC e sequenze "#Uxxxx" (o "#Lxxxxxx") ridecodificate. Alcuni
 * strumenti di compressione ed estrazione (Info-ZIP senza supporto Unicode) scrivono "Paternit#U00e0" al posto di "Paternità".
 */
export function normalizzaNomeZip(nome) {
  return String(nome || '').replace(/#U([0-9a-fA-F]{4})|#L([0-9a-fA-F]{6})/g, (_, u, l) => String.fromCodePoint(parseInt(u || l, 16))).normalize('NFC');
}

/** Radice del repo dentro lo ZIP (GitHub aggiunge "td-service-portale-main/"): la cartella che contiene data/meta.json. */
export function radiceZip(nomi) {
  const cand = (nomi || []).filter((n) => n === 'data/meta.json' || n.endsWith('/data/meta.json')).map((n) => n.slice(0, -'data/meta.json'.length)).sort((a, b) => a.length - b.length);
  return cand.length ? cand[0] : null;
}

// ---------------------------------------------------------------- incorporamento (iframe)
const origineDi = (u) => { try { return new URL(u).origin.toLowerCase(); } catch { return null; } };

/** Una sorgente di frame-ancestors (es. 'self', https://*.toscanadiagnostica.it, https:) ammette l'origine della Suite? */
export function sorgenteAmmette(src, suiteOrigin, targetOrigin) {
  const s = String(src || '').trim().toLowerCase();
  const suite = origineDi(suiteOrigin);
  if (!s || !suite) return false;
  if (s === '*') return true;
  if (s === "'none'") return false;
  if (s === "'self'") return Boolean(targetOrigin) && origineDi(targetOrigin) === suite;
  const su = new URL(suite);
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return su.protocol === s;                         // scheme-source (https:)
  const m = s.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+|\*)(?::(\d+|\*))?(\/.*)?$/);
  if (!m) return false;
  const [, schema, jolly, host, porta] = m;
  if (schema && `${schema}:` !== su.protocol) return false;
  if (!schema && su.protocol !== 'https:' && su.protocol !== 'http:') return false;
  const h = su.hostname;
  if (host !== '*') {
    if (jolly) { if (!h.endsWith(`.${host}`)) return false; } else if (h !== host) return false;
  }
  const portaSuite = su.port || (su.protocol === 'https:' ? '443' : '80');
  if (porta && porta !== '*' && porta !== portaSuite) return false;
  if (!porta && su.port) return false;
  return true;
}

/**
 * Si può mettere `target` in un iframe della Suite? Legge la risposta di prova.
 * risposta: { ok: boolean, status, headers: { 'x-frame-options', 'content-security-policy' } } oppure { errore }.
 * Regole dei browser attuali: se c'è CSP frame-ancestors comanda quella (ogni politica deve ammettere), altrimenti X-Frame-Options
 * (DENY vieta; SAMEORIGIN ammette solo la stessa origine; ALLOW-FROM è ignorato dai browser moderni, si tratta come vietato salvo
 * corrispondenza esatta). Una risposta non 2xx o un errore di rete = non incorporabile.
 * Ritorna { consentito, motivo }.
 */
export function valutaIncorporamento(risposta, suiteOrigin, target) {
  if (!risposta || risposta.errore) return { consentito: false, motivo: `sito non raggiungibile${risposta?.errore ? ` (${risposta.errore})` : ''}` };
  if (!risposta.ok) return { consentito: false, motivo: `il sito risponde ${risposta.status || 'con errore'}` };
  const h = Object.fromEntries(Object.entries(risposta.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const targetOrigin = origineDi(risposta.url || target);
  // più intestazioni CSP arrivano unite da virgole: ogni politica è separata da "," (le liste di sorgenti non ne contengono)
  const csp = [].concat(h['content-security-policy'] || []).flatMap((x) => String(x).split(','));
  const politiche = csp.map((p) => p.split(';').map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d))).filter(Boolean);
  if (politiche.length) {
    for (const fa of politiche) {
      const sorgenti = fa.split(/\s+/).slice(1);
      if (!sorgenti.length || !sorgenti.some((s) => sorgenteAmmette(s, suiteOrigin, targetOrigin))) return { consentito: false, motivo: `Content-Security-Policy: ${fa}` };
    }
    return { consentito: true, motivo: 'frame-ancestors ammette la Suite' };
  }
  const xfo = String([].concat(h['x-frame-options'] || [])[0] || '').trim();
  if (xfo) {
    const v = xfo.toUpperCase();
    if (v === 'DENY') return { consentito: false, motivo: 'X-Frame-Options: DENY' };
    if (v === 'SAMEORIGIN') return targetOrigin === origineDi(suiteOrigin) ? { consentito: true, motivo: 'stessa origine' } : { consentito: false, motivo: 'X-Frame-Options: SAMEORIGIN' };
    if (v.startsWith('ALLOW-FROM')) return origineDi(xfo.slice(10).trim()) === origineDi(suiteOrigin) ? { consentito: true, motivo: xfo } : { consentito: false, motivo: `X-Frame-Options: ${xfo}` };
    return { consentito: true, motivo: `X-Frame-Options non riconosciuto (${xfo}): ignorato dai browser` };
  }
  return { consentito: true, motivo: 'nessun divieto di incorporamento' };
}

// ---------------------------------------------------------------- voci di menu Servizi
// Rimappatura del CEO (01/11/2026): Vademecum → pagina interna che incorpora il Vademecum online; Circolari, Ordine del materiale e
// Portale NC → widget della Suite. Le altre voci seguono menu.json (link esterno o segnaposto "in allestimento").
export const RIMAPPA = { vademecum: { tipo: 'interno', to: 'vademecum' }, circolari: { tipo: 'widget', modulo: 'circolari' }, 'ordine-materiale': { tipo: 'widget', modulo: 'orders' }, 'portale-nc': { tipo: 'widget', modulo: 'nc' } };
// Domini delle app TD che oggi sono widget della Suite: un href verso uno di questi (o verso la Suite) diventa il widget
export const DOMINI_WIDGET = { 'nc.toscanadiagnostica.it': 'nc', 'orders.toscanadiagnostica.it': 'orders', 'circolari.toscanadiagnostica.it': 'circolari' };

/** Modulo della Suite a cui punta un href (https://suite.../orders, https://nc.toscanadiagnostica.it/), altrimenti null. */
export function moduloDaHref(href, suiteHosts = []) {
  let u; try { u = new URL(href); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (DOMINI_WIDGET[host]) return DOMINI_WIDGET[host];
  if (suiteHosts.map((x) => String(x).toLowerCase()).includes(host)) { const k = u.pathname.split('/')[1]; return k && /^[a-z_]+$/.test(k) ? k : null; }
  return null;
}

/**
 * Voci del menu Servizi per la Suite. voci: menu.json.voci; moduli: Map chiave → { accessibile, href, nome }; opzioni: { suiteHosts }.
 * Ogni voce: { id, label, icon, descrizione, tipo: 'interno'|'widget'|'esterno'|'segnaposto', to?, href?, blank, modulo?, accessibile,
 * box?, modulo_sgi? }. Per tipo widget, se l'utente non vede il modulo la voce resta (accessibile false) con il motivo.
 */
export function mappaVoci(voci = [], moduli = new Map(), { suiteHosts = [] } = {}) {
  return (voci || []).filter((v) => v && v.id).map((v) => {
    const base = { id: v.id, label: v.label || v.id, icon: v.icon || 'link', descrizione: v.descrizione || '', box: v.box || null, modulo_sgi: v.modulo || null };
    const r = RIMAPPA[v.id] || (v.href ? (() => { const m = moduloDaHref(v.href, suiteHosts); return m ? { tipo: 'widget', modulo: m } : null; })() : null);
    if (r?.tipo === 'interno') return { ...base, tipo: 'interno', to: r.to, blank: false, accessibile: true };
    if (r?.tipo === 'widget') {
      const m = moduli.get(r.modulo);
      return { ...base, tipo: 'widget', modulo: r.modulo, modulo_nome: m?.nome || r.modulo, href: m?.href || `/${r.modulo}`, blank: false, accessibile: Boolean(m?.accessibile) };
    }
    if (v.href && /^https?:\/\//i.test(v.href)) return { ...base, tipo: 'esterno', href: v.href, blank: v.blank !== false, accessibile: true };
    return { ...base, tipo: 'segnaposto', to: `servizi/${v.id}`, blank: false, accessibile: true };
  });
}
