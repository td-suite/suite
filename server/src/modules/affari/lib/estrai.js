// Public Affairs · lettura delle fonti, funzioni pure (nessuna rete, nessun database): collegamenti di una pagina, voci di un feed RSS o
// Atom, testo di una pagina, scadenza scritta nel titolo. Coperte da server/test/affari.test.mjs.
const ent = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, '\'')
  .replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù').replace(/&igrave;/g, 'ì').replace(/&eacute;/g, 'é').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
// i feed portano spesso HTML codificato (&lt;b&gt;): si tolgono i marcatori prima e dopo la decodifica
const pulito = (s) => ent(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Indirizzo assoluto senza frammento; null se non è http(s). */
export function assoluto(href, base) {
  try { const u = new URL(String(href).trim(), base); if (!/^https?:$/.test(u.protocol)) return null; u.hash = ''; return u.toString(); } catch { return null; }
}
/** Stesso documento anche se cambia lo schema (http/https), il www o la barra finale. */
export const chiaveUrl = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();

/** Collegamenti di una pagina: [{ url, titolo }], senza doppioni, senza la pagina stessa, senza voci di servizio. filtro: testo che l'indirizzo deve contenere. */
export function estraiLink(html, base, { filtro = null } = {}) {
  const corpo = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const visti = new Map(); const stessa = chiaveUrl(assoluto(base, base));
  for (const m of corpo.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1].match(/\bhref\s*=\s*"([^"]*)"/i) || m[1].match(/\bhref\s*=\s*'([^']*)'/i) || m[1].match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href.trim())) continue;
    const url = assoluto(ent(href), base); if (!url) continue;
    const k = chiaveUrl(url); if (k === stessa) continue;
    if (filtro && !url.toLowerCase().includes(String(filtro).toLowerCase())) continue;
    let titolo = pulito(m[2]) || pulito((m[1].match(/\btitle\s*=\s*"([^"]*)"/i) || [])[1]);
    if (!titolo) { try { titolo = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ').replace(/\.(pdf|docx?|zip)$/i, ''); } catch { titolo = ''; } }
    if (titolo.length < 4) continue;
    const prima = visti.get(k);
    if (!prima || titolo.length > prima.titolo.length) visti.set(k, { url, titolo: titolo.slice(0, 500) });
  }
  return [...visti.values()];
}

const tag = (x, nome) => { const m = x.match(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)</${nome}>`, 'i')); return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : null; };
const giorno = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
/** Voci di un feed RSS 2.0 o Atom: [{ url, titolo, descrizione, pubblicata }]. */
export function leggiFeed(xml, base) {
  const out = []; const t = String(xml || '');
  for (const m of t.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const x = m[0];
    const link = pulito(tag(x, 'link')) || (x.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || pulito(tag(x, 'guid'));
    const url = assoluto(ent(link || ''), base); const titolo = pulito(tag(x, 'title'));
    if (!url || !titolo) continue;
    out.push({ url, titolo: titolo.slice(0, 500), descrizione: pulito(tag(x, 'content:encoded') || tag(x, 'description') || tag(x, 'summary') || tag(x, 'content')).slice(0, 4000) || null, pubblicata: giorno(pulito(tag(x, 'pubDate') || tag(x, 'published') || tag(x, 'updated') || tag(x, 'dc:date'))) });
  }
  return out;
}
export const sembraFeed = (testo, tipo = '') => /rss|atom|xml/i.test(tipo) && /<(rss|feed)\b/i.test(String(testo).slice(0, 2000));

/** Testo leggibile di una pagina (senza menu, script, piè di pagina quando sono marcati). */
export function testoPagina(html, max = 40000) {
  let t = String(html || '').replace(/<(script|style|nav|header|footer|noscript|svg|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const principale = t.match(/<(main|article)\b[\s\S]*?<\/\1>/i); if (principale && principale[0].length > 400) t = principale[0];
  return ent(t.replace(/<\/(p|div|li|tr|h\d|br)>/gi, '\n').replace(/<br\s*\/?>(?=.)/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
}

/** Scadenza scritta nel titolo: "scadenza 21/10/2026", "scad. 13-11-2026", "entro il 5/12/2026". */
export function scadenzaNelTitolo(titolo) {
  const m = String(titolo || '').match(/(?:scadenz[ae]|scad\.?|entro il|termine)\D{0,25}(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i);
  if (!m) return null;
  const [g, me, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(g >= 1 && g <= 31 && me >= 1 && me <= 12 && a >= 2020 && a <= 2100)) return null;
  return `${a}-${String(me).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- elenchi a righe e a più pagine (v0.97.0: archivio dal gennaio 2026)
const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
const iso = (a, m, g) => (a >= 2000 && a <= 2100 && m >= 1 && m <= 12 && g >= 1 && g <= 31 ? `${a}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}` : null);
/** Prima data scritta in un testo: "18 Novembre 2026", "18/11/2026", "18.11.2026", "2026-11-18". null se non c'è. */
export function dataNelTesto(s) {
  const t = String(s || '');
  let m = t.match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i);
  if (m) return iso(Number(m[3]), MESI[m[2].toLowerCase()], Number(m[1]));
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}
/**
 * Voci di un elenco a righe (tabella degli articoli di una categoria, come le pagine degli avvisi delle USL): una voce per riga <tr> con
 * un collegamento nel titolo; la data di pubblicazione è quella scritta nelle ALTRE celle della riga (non nel titolo, dove di solito c'è
 * la scadenza). Ritorna [] se la pagina non è fatta così (meno di 3 righe): chi chiama usa allora estraiLink.
 */
export function estraiRighe(html, base, { filtro = null } = {}) {
  const corpo = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const out = new Map(); const stessa = chiaveUrl(assoluto(base, base));
  for (const tb of corpo.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const tr of tb[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const a = tr[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i); if (!a) continue;
      const href = (a[1].match(/\bhref\s*=\s*"([^"]*)"/i) || a[1].match(/\bhref\s*=\s*'([^']*)'/i) || [])[1];
      if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href.trim())) continue;
      const url = assoluto(ent(href), base); if (!url) continue;
      const k = chiaveUrl(url); if (k === stessa || out.has(k)) continue;
      if (filtro && !url.toLowerCase().includes(String(filtro).toLowerCase())) continue;
      const titolo = pulito(a[2]); if (titolo.length < 4) continue;
      out.set(k, { url, titolo: titolo.slice(0, 500), pubblicata: dataNelTesto(pulito(tr[1].replace(a[0], ' '))) });
    }
  }
  return out.size >= 3 ? [...out.values()] : [];
}
/**
 * Pagina successiva di un elenco a più pagine: tra i collegamenti allo STESSO percorso che cambiano solo il parametro di paginazione
 * (start, limitstart, page, pagina, p), quello con il numero più piccolo fra i maggiori di quello della pagina attuale. null se non c'è.
 */
export function paginaSuccessiva(html, attuale) {
  let qui; try { qui = new URL(attuale); } catch { return null; }
  const numero = (u) => { for (const p of ['start', 'limitstart', 'page', 'pagina', 'p']) { const v = u.searchParams.get(p); if (v != null && /^\d+$/.test(v)) return { p, n: Number(v) }; } return null; };
  const ora = numero(qui) || { p: null, n: 0 };
  const percorso = (u) => u.pathname.replace(/\/+$/, '').replace(/^\/index\.php/, '');
  let meglio = null;
  for (const m of String(html || '').matchAll(/<a\b([^>]*)>/gi)) {
    const href = (m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!href) continue;
    const url = assoluto(ent(href), attuale); if (!url) continue;
    let u; try { u = new URL(url); } catch { continue; }
    if (u.hostname !== qui.hostname) continue;
    const x = numero(u); if (!x || (ora.p && x.p !== ora.p) || x.n <= ora.n) continue;
    // stessa sezione: stesso percorso; oppure (il sito riscrive l'indirizzo dell'elenco) un collegamento marcato come paginazione
    const stesso = percorso(u) === percorso(qui);
    if (!stesso && !/class\s*=\s*["'][^"']*(page-link|pagination|pager|pagenav)|rel\s*=\s*["']next|aria-label\s*=\s*["'][^"']*pagina/i.test(m[1])) continue;
    if (!meglio || (stesso && !meglio.stesso) || (stesso === meglio.stesso && x.n < meglio.n)) meglio = { n: x.n, url, stesso };
  }
  return meglio ? meglio.url : null;
}
