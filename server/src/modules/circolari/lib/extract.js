// Estrazione del testo dalla bozza grezza caricata dal laboratorio (DOCX, PDF, TXT, MD) e strutturazione euristica
// in blocchi del corpo: titolo | paragrafo | elenco | tabella. La strutturazione con Claude (lib/ai.js) parte da qui
// e, se non disponibile, il risultato euristico è comunque impaginabile.
import PizZip from 'pizzip';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const parText = (xml) => decode((xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map((m) => (m === '<w:tab/>' ? '\t' : m === '<w:br/>' ? '\n' : decode(m.replace(/<[^>]+>/g, '')))).join('')).replace(/[ \t]+/g, ' ').trim();

// DOCX: paragrafi in ordine; le tabelle di dati diventano blocchi tabella (prima riga = intestazione); le tabelle di
// impaginazione (una colonna, celle lunghe, tabelle annidate) vengono sciolte in paragrafi
export function fromDocx(buffer) {
  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml')?.asText() || '';
  const bodyXml = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || xml;
  const items = [];
  // Scansione di primo livello: tabelle bilanciate (anche annidate) e paragrafi fuori dalle tabelle
  let i = 0;
  const pushPar = (frag) => {
    const text = parText(frag);
    if (!text) return;
    const isHeading = /<w:pStyle w:val="(Titolo|Heading)\d"/.test(frag) || (/<w:b\/>/.test(frag) && text.length < 90 && !/[.:;]$/.test(text));
    const isList = /<w:numPr>/.test(frag);
    items.push({ type: isHeading ? 'titolo' : isList ? 'voce' : 'paragrafo', text });
  };
  while (i < bodyXml.length) {
    const t = bodyXml.indexOf('<w:tbl>', i);
    const pIdx = bodyXml.indexOf('<w:p', i);
    if (t < 0 && pIdx < 0) break;
    if (t >= 0 && (pIdx < 0 || t < pIdx)) {
      // tabella bilanciata
      let depth = 0, j = t;
      const re = /<w:tbl>|<\/w:tbl>/g; re.lastIndex = t;
      let m;
      while ((m = re.exec(bodyXml))) { depth += m[0] === '<w:tbl>' ? 1 : -1; if (depth === 0) { j = m.index + m[0].length; break; } }
      if (depth !== 0) break;
      const frag = bodyXml.slice(t, j);
      const inner = frag.slice(7, -8);
      // righe e celle di primo livello della tabella
      const rows = topLevel(inner, 'w:tr').map((tr) => topLevel(tr, 'w:tc').map((tc) => parText(tc)));
      const nCols = Math.max(0, ...rows.map((r) => r.length));
      const layout = nCols < 2 || rows.length < 2 || rows[0].some((c) => c.length > 80) || /<w:tbl>/.test(inner);
      if (layout) {
        for (const tr of topLevel(inner, 'w:tr')) for (const tc of topLevel(tr, 'w:tc')) for (const par of topLevel(tc, 'w:p', true)) pushPar(par);
      } else items.push({ type: 'tabella', colonne: rows[0].map((c) => c.slice(0, 120)), righe: rows.slice(1).map((r) => rows[0].map((_, k) => String(r[k] ?? '').slice(0, 400))) });
      i = j;
      continue;
    }
    // paragrafo di primo livello
    const close = bodyXml.indexOf('</w:p>', pIdx);
    const selfClose = bodyXml.indexOf('/>', pIdx);
    const gt = bodyXml.indexOf('>', pIdx);
    if (gt < 0) break;
    const isSelf = selfClose >= 0 && selfClose < gt + 1 && bodyXml.slice(pIdx, gt + 1).endsWith('/>');
    if (isSelf || close < 0) { i = gt + 1; continue; }
    // salta i tag che iniziano con <w:p ma non sono paragrafi (w:pPr, w:pStyle...)
    const tag = bodyXml.slice(pIdx, gt + 1);
    if (!/^<w:p[\s>]/.test(tag)) { i = gt + 1; continue; }
    pushPar(bodyXml.slice(pIdx, close + 6));
    i = close + 6;
  }
  const blocchi = mergeLists(items);
  return { text: blocchi.map((x) => (x.type === 'tabella' ? [x.colonne, ...x.righe].map((r) => r.join(' | ')).join('\n') : x.type === 'elenco' ? x.items.map((v) => `- ${v}`).join('\n') : x.text)).join('\n\n'), blocchi };
}

// Elementi <tag> di primo livello dentro un frammento (ignora quelli annidati in tabelle interne). Con deep=true scende nelle
// tabelle annidate per raccogliere i paragrafi
function topLevel(xml, tag, deep = false) {
  const out = [];
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
  let m;
  while ((m = open.exec(xml))) {
    const start = m.index;
    let depth = 1, j = start + m[0].length;
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, 'g'); re.lastIndex = j;
    let k;
    while ((k = re.exec(xml))) { depth += k[0].startsWith('</') ? -1 : 1; if (depth === 0) { j = k.index + k[0].length; break; } }
    const frag = xml.slice(start, j);
    // un paragrafo dentro una tabella annidata appartiene alla tabella, non al livello corrente
    if (!deep && tag === 'w:p') { out.push(frag); } else out.push(frag);
    open.lastIndex = j;
  }
  return out;
}

export async function fromPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return fromText(data.text || '');
}

// Testo libero: righe vuote separano i paragrafi; righe brevi senza punto finale sono titoli; righe che iniziano con - o • sono voci;
// righe con tabulazioni o " | " sono tabelle (prima riga = intestazione)
export function fromText(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\u2014\u2015]/g, ', ');
  const items = [];
  const isItem = (l) => /^[-•*–]\s+/.test(l) || /^\d+[.)]\s+/.test(l);
  const isTitle = (l) => l.length < 90 && !/[.:;,]$/.test(l) && /^[\dA-ZÀ-Ý]/.test(l);
  const paras = text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  for (const para of paras) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    const sep = lines.every((l) => l.includes('\t')) ? '\t' : lines.every((l) => l.includes(' | ')) ? ' | ' : null;
    if (sep && lines.length >= 2) {
      const rows = lines.map((l) => l.split(sep).map((x) => x.trim()));
      items.push({ type: 'tabella', colonne: rows[0], righe: rows.slice(1) });
      continue;
    }
    if (lines.some(isItem)) {
      // righe di testo prima dell'elenco: titolo se breve, altrimenti paragrafo; le voci diventano elenco
      let buf = [];
      const flush = () => { if (!buf.length) return; const j = buf.join(' '); items.push({ type: buf.length === 1 && isTitle(j) ? 'titolo' : 'paragrafo', text: j }); buf = []; };
      for (const l of lines) { if (isItem(l)) { flush(); items.push({ type: 'voce', text: l.replace(/^[-•*–]\s+|^\d+[.)]\s+/, '') }); } else buf.push(l); }
      flush();
      continue;
    }
    const joined = lines.join(' ');
    if (lines.length === 1 && isTitle(joined)) items.push({ type: 'titolo', text: joined });
    else items.push({ type: 'paragrafo', text: joined });
  }
  return { text, blocchi: mergeLists(items) };
}

// Voci consecutive → un blocco elenco
export function mergeLists(items) {
  const out = [];
  for (const it of items) {
    if (it.type === 'voce') {
      const last = out[out.length - 1];
      if (last && last.type === 'elenco') last.items.push(it.text); else out.push({ type: 'elenco', items: [it.text] });
    } else out.push(it);
  }
  return out;
}

export async function extract(buffer, filename, mime) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'docx' || /wordprocessingml/.test(mime || '')) return fromDocx(buffer);
  if (ext === 'pdf' || /pdf/.test(mime || '')) return fromPdf(buffer);
  return fromText(buffer.toString('utf8'));
}

// Struttura euristica completa (senza AI): titolo = primo titolo o prima riga; sintesi = primo paragrafo; corpo = il resto
export function heuristicStructure(blocchi) {
  const b = [...blocchi];
  let titolo = '';
  const iT = b.findIndex((x) => x.type === 'titolo');
  if (iT >= 0) titolo = b.splice(iT, 1)[0].text;
  else if (b[0]?.type === 'paragrafo') titolo = b[0].text.slice(0, 120);
  let sintesi = '';
  const iP = b.findIndex((x) => x.type === 'paragrafo' && x.text.length > 60);
  if (iP >= 0) sintesi = b[iP].text.length <= 400 ? b.splice(iP, 1)[0].text : b[iP].text.slice(0, 380).replace(/\s+\S*$/, '') + '.';
  return { titolo, oggetto: titolo, sintesi, corpo: b };
}

// Riporta i blocchi entro i limiti dello schema delle circolari (testi lunghi tagliati, tabelle regolarizzate)
export function clampBlocks(blocchi) {
  const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = [];
  for (const b of blocchi || []) {
    if (!b) continue;
    if (b.type === 'titolo') { const t = cut(b.text, 200); if (t) out.push({ type: 'titolo', text: t }); }
    else if (b.type === 'paragrafo') { const t = cut(b.text, 5000); if (t) out.push({ type: 'paragrafo', text: t }); }
    else if (b.type === 'elenco') { const items = (b.items || []).map((x) => cut(x, 800)).filter(Boolean).slice(0, 50); if (items.length) out.push({ type: 'elenco', items }); }
    else if (b.type === 'tabella') { const colonne = (b.colonne || []).map((x) => cut(x, 120)).slice(0, 12); if (!colonne.length) continue; out.push({ type: 'tabella', colonne, righe: (b.righe || []).slice(0, 300).map((r) => colonne.map((_, k) => cut(r?.[k], 400))) }); }
  }
  return out.slice(0, 80);
}
