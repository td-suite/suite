// Portale Service · regole pure (senza database né rete), testate in server/test/service-*.test.mjs:
// - risoluzione dei link stabili /p/<shortcut>, /m/<codice>, /doc/<codice> con le stesse regole di app.py del sito di origine;
// - percorsi dei file ammessi nella cache (docs, stampabili, certificati, vademecum, loghi in static);
// - JSON canonico e sha256 per riconoscere se lo specchio è cambiato (indipendente da formattazione e ordine delle chiavi);
// - lettura di X-Frame-Options e Content-Security-Policy frame-ancestors (si può incorporare il Vademecum online?);
// - mappa delle voci di menu Servizi (menu.json) con le quattro voci rimappate dal CEO (01/11/2026).
import { slug, costruisciIndice, cercaDocumento, risolviLink, validatorePercorsi, mimeDi, urlFile, canonico, shaJson, confrontaSpecchio as confrontaPer,
  senzaNul, validaContenutiPer, normalizzaNomeZip, radiceZip } from '../../../lib/specchioRegole.js';

// I nove JSON del sito di origine (data/*.json): meta e docs/preparazioni/fulltext generati dal build, gli altri redazionali
export const CHIAVI = ['meta', 'docs', 'preparazioni', 'fulltext', 'certificazioni', 'veq', 'contatti', 'blog', 'menu'];
// Cartelle dei file serviti dal sito di origine e messi in cache dalla Suite
export const CARTELLE = ['docs', 'stampabili', 'certificati', 'vademecum', 'static'];

// Regole comuni ai portali specchiati (server/src/lib/specchioRegole.js, condivise con il Portale SGI): link stabili come app.py,
// JSON canonico e sha, NUL, nomi e radice dello ZIP. Qui parametrizzate con le chiavi e le cartelle del Portale Service.
export { slug, costruisciIndice, cercaDocumento, risolviLink, mimeDi, urlFile, canonico, shaJson, senzaNul, normalizzaNomeZip, radiceZip };
/**
 * Percorso di un file ammesso nella cache: cartella nota, niente risalite né percorsi assoluti, solo PDF (e le immagini PNG/JPG
 * dei loghi in static/). Ritorna il percorso normalizzato (separatore "/") oppure null.
 */
export const percorsoValido = validatorePercorsi(CARTELLE);
/** Confronto tra lo specchio salvato e quanto letto ora dall'origine (build e sha dei nove JSON). Ritorna { cambiato, motivi }. */
export const confrontaSpecchio = (prec, nuovo) => confrontaPer(prec, nuovo, CHIAVI);
/** Controlli minimi sui JSON letti (dall'origine o dallo ZIP): una pagina d'errore non deve sostituire lo specchio. */
export const validaContenuti = (c) => validaContenutiPer(c, CHIAVI);

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
// Voci aggiunte dal CEO (01/11/2026) che non stanno ancora in menu.json del sito: "Referti di Laboratorio" → portale referti, scheda nuova.
// Se un giorno menu.json le include, la voce del sito prevale (stesso id) e questa non viene duplicata.
export const VOCI_AGGIUNTE = [
  { id: 'referti', label: 'Referti di Laboratorio', icon: 'doc', href: 'https://referti.toscanadiagnostica.it/', blank: true, evidenza: true,
    descrizione: 'Il portale dei referti del Laboratorio di Analisi: consultazione e download dei referti per i laboratori e le strutture clienti.' },
];

export function mappaVoci(voci = [], moduli = new Map(), { suiteHosts = [] } = {}) {
  const presenti = new Set((voci || []).filter((v) => v && v.id).map((v) => v.id));
  // Le voci in evidenza (Referti di Laboratorio) stanno in cima all'elenco, poi quelle del sito nel loro ordine
  const aggiunte = VOCI_AGGIUNTE.filter((v) => !presenti.has(v.id));
  const tutte = [...aggiunte.filter((v) => v.evidenza), ...(voci || []), ...aggiunte.filter((v) => !v.evidenza)];
  return tutte.filter((v) => v && v.id).map((v) => {
    const base = { id: v.id, label: v.label || v.id, icon: v.icon || 'link', descrizione: v.descrizione || '', box: v.box || null, modulo_sgi: v.modulo || null, evidenza: Boolean(v.evidenza) };
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
