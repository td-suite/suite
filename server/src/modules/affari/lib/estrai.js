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
