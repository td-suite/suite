// Business Hub · Pacchetto di benvenuto: impaginazione delle pagine "nostre" (copertina, indice, lettera del CEO, portale, credenziali,
// piano di avvio, referente, cosa ci rende diversi, checklist, offerta economica, rete, medicina del lavoro, vademecum come link) su
// carta intestata luglio 2026 (templates/carta_intestata_2026-07.docx: header1 con logo e contatti, footer1 con i dati societari).
// Meccanismo di referti/lib/formatTD.js: dal word/document.xml del template si tengono la testa fino a <w:body> e la coda da <w:sectPr>
// (intestazione, piè di pagina), in mezzo va il corpo generato; gli altri file del template restano com'erano. In più: margini fissi
// (l'intestazione è fatta di immagini ancorate che non spingono il corpo), il numero di pagina del piè tolto (la numerazione del
// pacchetto la stampa pacchettoPdf.js su tutte le pagine, comprese quelle dell'offerta e del Vademecum), il QR code come immagine.
// Ogni sezione è un DOCX a sé: la conversione in PDF è una sola chiamata a LibreOffice per tutte (docxToPdfBatch).
// Font Arial (Liberation Sans in LibreOffice: stesso risultato in locale e nell'immagine Docker).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { dataBreve, dataLunga, paragrafiLettera, conPunto } from './pacchetto.js';

const TPL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'carta_intestata_2026-07.docx');
export const TEMPLATE_CARTA = TPL;

// Colori della carta intestata e del format TD
export const C = { scuro: '004F5F', medio: '1B505F', accento: '42B2BF', chiaro: 'EAF5F7', bordo: 'C9E1E6', grigio: '5A6B70', testo: '1A1A1A', bianco: 'FFFFFF' };
// A4, margini: alto 4 cm (sotto il logo), basso 3 cm (sopra i dati societari), laterali 2 cm → larghezza utile 9638 twip
export const PAGINA = { w: 11906, h: 16838, top: 2268, bottom: 1701, left: 1134, right: 1134 };
export const LARGHEZZA = PAGINA.w - PAGINA.left - PAGINA.right;

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>';

// ---------------------------------------------------------------- primitive
/** Run di testo: { b, i, color, sz (mezzi punti), caps, spacing (twip), u } ; \n = a capo */
export function r(text, o = {}) {
  const pr = [FONT, o.b ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/>', o.i ? '<w:i/>' : '', o.caps ? '<w:caps/>' : '', o.u ? '<w:u w:val="single"/>' : '',
    `<w:color w:val="${o.color || C.testo}"/>`, o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : '', `<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/>`].join('');
  const body = String(text ?? '').split('\n').map((s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`).join('<w:br/>');
  return `<w:r><w:rPr>${pr}</w:rPr>${body}</w:r>`;
}
/** Paragrafo: contenuto = stringa (run normale) o run già pronti; o: { jc, before, after, line, keepNext, keepLines, pageBreakBefore, ind, tabs, border, shd, o (run opts) } */
export function p(content, o = {}) {
  const runs = Array.isArray(content) ? content.join('') : (typeof content === 'string' && !content.startsWith('<w:') ? r(content, o.run) : (content || ''));
  const ppr = [o.keepNext ? '<w:keepNext/>' : '', o.keepLines ? '<w:keepLines/>' : '', o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.border ? `<w:pBdr>${o.border}</w:pBdr>` : '', o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>` : '',
    o.tabs ? `<w:tabs>${o.tabs}</w:tabs>` : '',
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}" w:line="${o.line ?? 276}" w:lineRule="auto"/>`,
    o.ind ? `<w:ind ${o.ind}/>` : '', `<w:jc w:val="${o.jc || 'left'}"/>`].join('');
  return `<w:p><w:pPr>${ppr}<w:rPr>${FONT}<w:sz w:val="${o.run?.sz || 20}"/></w:rPr></w:pPr>${runs}</w:p>`;
}
export const vuoto = (h = 120) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, h)}" w:lineRule="exact"/></w:pPr><w:r><w:rPr>${FONT}<w:sz w:val="2"/></w:rPr></w:r></w:p>`;
export const bordo = (lato, colore, sz = 4, space = 0) => `<w:${lato} w:val="single" w:sz="${sz}" w:space="${space}" w:color="${colore}"/>`;
export const nil = (lato) => `<w:${lato} w:val="nil"/>`;

/** Cella: { w, fill, borders (xml), mar [t,l,b,r], vAlign, span } */
export function cella(contenuto, o = {}) {
  const mar = o.mar || [80, 120, 80, 120];
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${o.w}"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}`
    + `<w:tcBorders>${o.borders || [nil('top'), nil('left'), nil('bottom'), nil('right')].join('')}</w:tcBorders>`
    + `${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}`
    + `<w:tcMar><w:top w:w="${mar[0]}" w:type="dxa"/><w:left w:w="${mar[1]}" w:type="dxa"/><w:bottom w:w="${mar[2]}" w:type="dxa"/><w:right w:w="${mar[3]}" w:type="dxa"/></w:tcMar>`
    + `${o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : ''}</w:tcPr>${contenuto || p('')}</w:tc>`;
}
/** Tabella: widths (twip), righe = [[{ c, ...opzioni cella }]], o: { cantSplit, header } */
export function tabella(widths, righe, o = {}) {
  const tot = widths.reduce((a, b) => a + b, 0);
  return `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${tot}"/><w:jc w:val="${o.jc || 'left'}"/><w:tblLayout w:type="fixed"/>`
    + '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    + '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>'
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    + righe.map((riga, i) => `<w:tr><w:trPr>${o.cantSplit !== false ? '<w:cantSplit/>' : ''}${o.header && i === 0 ? '<w:tblHeader/>' : ''}${riga.h ? `<w:trHeight w:val="${riga.h}" w:hRule="atLeast"/>` : ''}</w:trPr>`
      + (riga.celle || riga).map((x) => cella(x.c, x)).join('') + '</w:tr>').join('')
    + '</w:tbl>';
}

// ---------------------------------------------------------------- blocchi comuni
const SMALL = { sz: 16, color: C.grigio };
/** Testata della sezione: occhiello, titolo, filetto. */
export function testata(occhiello, titolo, sottotitolo) {
  return [
    p(r(String(occhiello || '').toUpperCase(), { b: true, sz: 15, color: C.accento, spacing: 30 }), { after: 60, keepNext: true }),
    p(r(titolo, { b: true, sz: 40, color: C.scuro }), { after: 100, line: 240, keepNext: true }),
    p('', { border: bordo('bottom', C.accento, 18, 1), after: sottotitolo ? 140 : 280, keepNext: true, ind: `w:right="${LARGHEZZA - 1400}"` }),
    sottotitolo ? p(r(sottotitolo, { sz: 21, color: C.grigio }), { after: 280, line: 300 }) : '',
  ].join('');
}
export const titoletto = (t, o = {}) => p(r(t, { b: true, sz: 22, color: C.scuro }), { before: o.before ?? 240, after: 100, keepNext: true });
// Paragrafi giustificati: ogni a capo diventa un paragrafo a sé (un <w:br/> dentro un paragrafo giustificato fa allargare le parole
// della riga che lo precede a tutta riga, come "Gentile          Francesco          Sderci,"); l'ultima riga resta sempre a sinistra
export const righeTesto = (t) => String(t ?? '').replace(/\r\n?/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean);
export const testo = (t, o = {}) => { const l = righeTesto(t); return l.map((x, i) => p(r(x, { sz: o.sz || 20, color: o.color || C.testo, i: o.i }), { after: i === l.length - 1 ? (o.after ?? 120) : 0, line: o.line || 300, jc: o.jc || 'both' })).join(''); };

/** Scheda: titolo e testo su fondo chiaro con filetto a sinistra. */
function scheda(titolo, corpo, o = {}) {
  const paras = [].concat(corpo).filter(Boolean).map((x) => (x.startsWith?.('<w:') ? x : p(r(x, { sz: 18, color: C.testo }), { after: 60, line: 276 })));
  return [
    titolo ? p(r(titolo, { b: true, sz: 20, color: C.scuro }), { after: 60, keepNext: true }) : '',
    ...paras,
  ].join('');
}
export const BORDO_SCHEDA = [nil('top'), bordo('left', C.accento, 24), nil('bottom'), nil('right')].join('');
/** Griglia di schede a due colonne con spazio tra le colonne e tra le righe. items: [{ titolo, corpo }] */
export function griglia(items, { colonne = 2, gap = 280 } = {}) {
  const w = Math.floor((LARGHEZZA - gap * (colonne - 1)) / colonne);
  const widths = []; for (let i = 0; i < colonne; i++) { widths.push(w); if (i < colonne - 1) widths.push(gap); }
  const righe = [];
  for (let i = 0; i < items.length; i += colonne) {
    const celle = [];
    for (let j = 0; j < colonne; j++) {
      const it = items[i + j];
      celle.push(it ? { c: scheda(it.titolo, it.corpo), w, fill: it.fill || C.chiaro, borders: BORDO_SCHEDA, mar: [140, 200, 140, 180] } : { c: p(''), w });
      if (j < colonne - 1) celle.push({ c: p(''), w: gap });
    }
    if (righe.length) righe.push({ celle: widths.map((x) => ({ c: vuoto(40), w: x, mar: [0, 0, 0, 0] })), h: gap });
    righe.push({ celle });
  }
  return tabella(widths, righe);
}
/** Riquadro su tutta la larghezza (fondo chiaro o scuro). */
export function riquadro(contenuto, { fill = C.chiaro, scuro = false, mar = [200, 260, 200, 260] } = {}) {
  return tabella([LARGHEZZA], [[{ c: contenuto, w: LARGHEZZA, fill: scuro ? C.scuro : fill, borders: scuro ? '' : BORDO_SCHEDA, mar }]]);
}
/** Tabella dati con intestazione petrolio. cols: [{ t, w }], righe: [[testo]] */
export function tabellaDati(cols, righe, { sz = 18 } = {}) {
  const head = cols.map((c) => ({ c: p(r(c.t, { b: true, sz: 16, color: C.bianco }), { line: 240 }), w: c.w, fill: C.medio, mar: [90, 120, 90, 120] }));
  const body = righe.map((riga, i) => riga.map((v, j) => ({
    c: [].concat(v).map((x) => (String(x).startsWith('<w:') ? x : p(r(x, { sz, color: C.testo, b: j === 0 && cols[0].b }), { line: 252 }))).join(''),
    w: cols[j].w, fill: i % 2 ? 'F6FAFB' : null, borders: [nil('top'), nil('left'), bordo('bottom', C.bordo, 4), nil('right')].join(''), mar: [90, 120, 90, 120],
  })));
  return tabella(cols.map((c) => c.w), [head, ...body], { header: true });
}
export const elencoPuntato = (voci, o = {}) => voci.map((v) => p([r('•', { b: true, color: C.accento, sz: o.sz || 18 }), r(`\t${v}`, { sz: o.sz || 18 })],
  { tabs: '<w:tab w:val="left" w:pos="240"/>', ind: 'w:left="240" w:hanging="240"', after: 50, line: 264 })).join('');

// ---------------------------------------------------------------- immagini
const EMU = 914400 / 1440;   // EMU per twip
let idImg = 100;
export function immagine(rId, larghezzaTwip, altezzaTwip, nome = 'qr.png') {
  const cx = Math.round(larghezzaTwip * EMU); const cy = Math.round(altezzaTwip * EMU); const id = idImg++;
  return `<w:r><w:rPr>${FONT}</w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${esc(nome)}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(nome)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

// ---------------------------------------------------------------- costruzione del DOCX
let cacheTpl = null;
function parti() {
  if (!cacheTpl) {
    const buf = fs.readFileSync(TPL);
    const src = (new PizZip(buf).file('word/document.xml')?.asText() || '').replace(/\r\n?/g, '\n');
    const ib = src.indexOf('<w:body>'); const is = src.lastIndexOf('<w:sectPr');
    if (ib < 0 || is < ib) throw new Error('Carta intestata non valida: manca <w:body> o <w:sectPr>');
    cacheTpl = { buf, head: src.slice(0, ib + '<w:body>'.length), sect: src.slice(is) };
  }
  return cacheTpl;
}
/** Margini del pacchetto nel sectPr della carta intestata */
export function margini(sect) {
  const m = `<w:pgMar w:top="${PAGINA.top}" w:right="${PAGINA.right}" w:bottom="${PAGINA.bottom}" w:left="${PAGINA.left}" w:header="708" w:footer="567" w:gutter="0"/>`;
  return /<w:pgMar\b[^>]*\/>/.test(sect) ? sect.replace(/<w:pgMar\b[^>]*\/>/, m) : sect.replace('</w:sectPr>', `${m}</w:sectPr>`);
}
/** Piè di pagina senza il campo PAGE (la numerazione del pacchetto la stampa pacchettoPdf.js) */
export function senzaNumeroPagina(footerXml) {
  return String(footerXml || '').replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?fldCharType="begin"[\s\S]*?fldCharType="end"\/><\/w:r>/g, '')
    .replace(/<w:fldSimple\b[^>]*PAGE[^>]*>[\s\S]*?<\/w:fldSimple>/g, '');
}
/** DOCX di una sezione: corpo + immagini [{ rId, nome, buffer }] sulla carta intestata. */
export function costruisci(corpo, immagini = []) {
  const { buf, head, sect } = parti();
  const zip = new PizZip(buf);
  zip.file('word/document.xml', head + corpo + margini(sect));
  for (const f of Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n))) zip.file(f, senzaNumeroPagina(zip.file(f).asText()));
  if (immagini.length) {
    let rels = zip.file('word/_rels/document.xml.rels').asText();
    for (const im of immagini) {
      zip.file(`word/media/${im.nome}`, im.buffer);
      rels = rels.replace('</Relationships>', `<Relationship Id="${im.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.nome}"/></Relationships>`);
    }
    zip.file('word/_rels/document.xml.rels', rels);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ================================================================ pagine
const metaRiga = (etichetta, valore) => [
  { c: p(r(etichetta.toUpperCase(), { b: true, sz: 14, color: C.accento, spacing: 20 }), { line: 240 }), w: 1700, mar: [70, 0, 70, 120] },
  { c: p(r(valore, { sz: 20, color: C.testo }), { line: 252 }), w: 3900, mar: [70, 0, 70, 0] },
];

/** Copertina: titolo, cliente, data, linea, a cura di, destinatario, QR al portale. */
export function copertina(d) {
  const qr = d.qr ? immagine('rIdQrCopertina', 1980, 1980, 'qr-copertina.png') : '';
  const meta = [['Data', dataLunga(d.data)], ['Linea', d.lineaLabel], ['A cura di', d.owner?.nome ? [d.owner.nome, d.owner.ruolo].filter(Boolean).join(', ') : ''], ['Destinatario', d.destinatario || '']]
    .filter(([, v]) => v).map(([k, v]) => metaRiga(k, v));
  const colQr = 2300; const colMeta = LARGHEZZA - colQr - 300;
  const blocco = tabella([colMeta, 300, colQr], [[
    { c: tabella([1700, 3900], meta), w: colMeta, vAlign: 'bottom', mar: [0, 0, 0, 0] },
    { c: p(''), w: 300 },
    { c: d.qr ? [p(qr, { jc: 'center' }), p(r(d.qrDidascalia, { sz: 14, color: C.grigio }), { jc: 'center', before: 60, line: 240 })].join('') : p(''), w: colQr, vAlign: 'bottom', mar: [0, 0, 0, 0] },
  ]]);
  return [
    vuoto(900),
    p(r(d.kicker || 'PACCHETTO DI BENVENUTO', { b: true, sz: 17, color: C.accento, spacing: 60 }), { after: 260 }),
    p(r(d.titoloPre || 'Benvenuti in', { sz: 44, color: C.medio }), { line: 240, after: 40 }),
    p(r('Toscana Diagnostica', { b: true, sz: 64, color: C.scuro }), { line: 240, after: 320 }),
    p('', { border: bordo('bottom', C.accento, 24, 1), after: 360, ind: `w:right="${LARGHEZZA - 1800}"` }),
    // richiesta del CEO del 07/11/2026 (come per l'offerta economica): niente riga "preparato per" e niente fascia "Ci prendiamo cura
    // del tempo dei pazienti, ..." in copertina; il nome del cliente segue direttamente il filetto
    p(r(d.cliente, { b: true, sz: 36, color: C.testo }), { line: 260, after: 120 }),
    d.indirizzoCliente ? p(r(d.indirizzoCliente, { sz: 19, color: C.grigio }), { after: 0 }) : '',
    vuoto(d.indirizzoCliente ? 5600 : 5880),
    blocco,
  ].join('');
}

/** Indice: voci [{ n, titolo, pagina, nota }] */
export function indice(voci, d) {
  const righe = voci.map((v) => p([
    r(String(v.n).padStart(2, '0'), { b: true, sz: 20, color: C.accento }),
    r(`\t${v.titolo}`, { b: true, sz: 21, color: C.scuro }),
    r(`\t${v.pagina}`, { b: true, sz: 21, color: C.scuro }),
    v.nota ? r(`\n${v.nota}`, { sz: 16, color: C.grigio }) : '',
  ], { tabs: `<w:tab w:val="left" w:pos="620"/><w:tab w:val="right" w:leader="dot" w:pos="${LARGHEZZA}"/>`, ind: 'w:left="620" w:hanging="620"', after: 150, line: 264,
    border: bordo('bottom', C.bordo, 4, 6) }));
  return [
    testata('Il pacchetto', 'Indice', `Tutto quello che serve per iniziare a lavorare insieme, in un unico documento. Il PDF ha i segnalibri: dal pannello laterale del lettore si salta a ogni sezione.`),
    ...righe,
    d.omesse?.length ? p(r(`Non incluse in questa versione: ${d.omesse.join('; ')}.`, { sz: 16, color: C.grigio, i: true }), { before: 240, line: 264 }) : '',
  ].join('');
}

/** Lettera di benvenuto del CEO (modello modificabile con i segnaposto già sostituiti; {{referenti}} = blocco dei contatti). */
export function lettera(d) {
  const destinatario = [d.cliente, d.indirizzoCliente, d.destinatario ? `c.a. ${d.destinatario}` : null].filter(Boolean);
  // gli ultimi due paragrafi (chiusura e saluti) restano con la firma: mai la sola firma su una pagina nuova
  // ogni paragrafo è un <w:p> a sé, e così ogni riga andata a capo nel modello (niente <w:br/> nei paragrafi giustificati); il saluto
  // iniziale ("Gentile ...,") e la chiusura ("Con i migliori saluti,") sono allineati a sinistra
  const par = paragrafiLettera(d.testoLettera);
  const corpo = par.map((x, i) => {
    if (x.tipo === 'referenti') return bloccoReferenti(d.referenti);
    const finale = i >= par.length - 2;
    const righe = righeTesto(x.testo);
    return righe.map((riga, j) => {
      const saluto = rigaASinistra(riga, { prima: i === 0 && j === 0, ultima: i === par.length - 1 && j === righe.length - 1 });
      return p(r(riga, { sz: 20 }), { after: j === righe.length - 1 || saluto ? 160 : 0, line: 312, jc: saluto ? 'left' : 'both', keepNext: finale || j < righe.length - 1, keepLines: finale });
    }).join('');
  }).join('');
  return [
    p(r(`${d.luogo}, ${dataLunga(d.data)}`, { sz: 20, color: C.grigio }), { jc: 'right', after: 360 }),
    p(r('Spett.le', { sz: 19, color: C.grigio }), { after: 20 }),
    ...destinatario.map((x, i) => p(r(x, { b: i === 0, sz: 20 }), { after: 0, line: 264 })),
    vuoto(380),
    p(r(d.titoloLettera || 'Benvenuti in Toscana Diagnostica', { b: true, sz: 26, color: C.scuro }), { after: 260, keepNext: true }),
    corpo,
    p(r(d.firma.nome, { b: true, sz: 22, color: C.scuro }), { before: 420, after: 20, keepNext: true, keepLines: true }),
    p(r(d.firma.ruolo, { sz: 19, color: C.grigio }), { after: 0 }),
  ].join('');
}
/** Saluto iniziale o chiusura della lettera: riga breve che finisce con la virgola (o la prima/ultima del testo): a sinistra. */
export function rigaASinistra(riga, { prima = false, ultima = false } = {}) {
  const t = String(riga || '').trim();
  if (/^(gentil[ei]|egregi[oa]|spett|caro|cara|alla cortese)/i.test(t) && t.length <= 120) return true;
  if ((prima || ultima) && t.length <= 120 && /,$/.test(t)) return true;
  return /^(con i (migliori|più cordiali) saluti|cordiali saluti|distinti saluti|un cordiale saluto)/i.test(t);
}

// Tabella dei referenti (richiesta del CEO del 07/11/2026), la stessa nella lettera, nella pagina del referente e nella checklist:
// tre colonne a larghezza fissa allineate in alto: 1) ruolo in grassetto con la descrizione sotto in piccolo, 2) nome (se c'è) ed
// email, 3) telefoni (fisso e cellulare su righe separate). Righe separate da un filetto leggero; ogni riga di testo è un paragrafo
// a sé (niente a capo forzati), le parole non si spezzano mai a metà (nessuna sillabazione: celle abbastanza larghe per un'email).
export const COLONNE_REFERENTI = [3050, 4000, LARGHEZZA - 3050 - 4000];
const FILETTO_REF = (prima) => [prima ? bordo('top', C.accento, 8) : nil('top'), nil('left'), bordo('bottom', C.bordo, 4), nil('right')].join('');
/** Contatti in tabella: ruolo e descrizione | nome ed email | telefoni. voci: [{ ruolo, nota, nome, email, telefoni: [{ etichetta, numero }] }] */
export function bloccoReferenti(voci = []) {
  if (!voci.length) return '';
  const [w1, w2, w3] = COLONNE_REFERENTI;
  const mar = [90, 120, 90, 120];
  const intest = [['Referente', w1], ['Nome ed email', w2], ['Telefono', w3]].map(([t, w]) => ({ c: p(r(t.toUpperCase(), { b: true, sz: 13, color: C.accento, spacing: 20 }), { line: 240, keepNext: true }), w, mar: [40, 120, 60, 120] }));
  const righe = voci.map((v, i) => {
    const kn = i < voci.length - 1;
    const tel = (v.telefoni || []).filter((t) => t?.numero);
    return [
      { c: p(r(v.ruolo, { b: true, sz: 17, color: C.scuro }), { line: 252, keepNext: kn }) + (v.nota ? p(r(v.nota, { sz: 15, color: C.grigio }), { line: 240, keepNext: kn }) : ''), w: w1, mar, vAlign: 'top', borders: FILETTO_REF(i === 0) },
      { c: (v.nome ? p(r(v.nome, { b: true, sz: 17 }), { line: 252, keepNext: kn }) : '') + (v.email ? p(r(v.email, { sz: 16 }), { line: 252, keepNext: kn }) : '') || p(''), w: w2, mar, vAlign: 'top', borders: FILETTO_REF(i === 0) },
      { c: tel.length ? tel.map((t) => p([t.etichetta ? r(`${t.etichetta} `, { sz: 14, color: C.grigio }) : '', r(t.numero, { sz: 16 })], { line: 252, keepNext: kn })).join('') : p(''), w: w3, mar, vAlign: 'top', borders: FILETTO_REF(i === 0) },
    ];
  });
  return [vuoto(80), tabella([w1, w2, w3], [intest, ...righe], { header: true }), vuoto(200)].join('');
}

/** Il Portale Service e i servizi digitali (SRV): schede e livello di supporto. */
export function portale(d) {
  const sla = d.sla || {};
  const ncSla = sla.nc_ore ? `Ogni non conformità ha una scadenza di risposta: per le vostre sedi ${sla.nc_ore} ore lavorative.` : 'Ogni non conformità ha una scadenza di risposta concordata.';
  const schede = [
    { titolo: 'Il mio spazio', corpo: 'La prima pagina dopo l\'accesso: le non conformità aperte sulle vostre sedi, gli ordini del materiale in corso, le circolari ancora da leggere e i vostri ticket. Un colpo d\'occhio su ciò che richiede attenzione.' },
    { titolo: 'Preparazioni e documenti', corpo: 'Ricerca su prestazioni e documenti: preparazioni del paziente, istruzioni, moduli e procedure, anche nel testo integrale dei PDF. Ogni documento ha un link stabile che apre sempre la revisione in vigore: potete salvarlo o inviarlo ai pazienti.' },
    { titolo: 'Certificazioni e VEQ', corpo: 'Le certificazioni del Sistema di Gestione Integrato con numero, emissione e scadenza, e i programmi di Valutazione Esterna di Qualità a cui partecipiamo, con il centro regionale di riferimento.' },
    { titolo: 'Vademecum degli esami', corpo: 'La guida operativa per i laboratori clienti: come preparare, confezionare e inviare i campioni, tempi di refertazione, modulistica e contatti. Consultabile online e allegato in coda a questo documento.' },
    { titolo: 'Non conformità', corpo: `Se il laboratorio rileva un problema su un campione (emolisi, provetta errata, accettazione non trasmessa, consenso mancante) ricevete un'email senza dati del paziente. Nel portale leggete la descrizione e l'azione attesa, rispondete e allegate foto o documenti; alla chiusura arriva la notifica. ${ncSla}` },
    { titolo: 'Ordini del materiale', corpo: 'Provette, contenitori, buste di trasporto e modulistica dal catalogo. Ogni ordine attraversa fasi visibili: inviato, approvato, preso in carico, spedito con il documento di trasporto, consegnato. Resta disponibile anche il modulo TD-SGI-MOD252.' },
    { titolo: 'Sistema di Gestione della Qualità', corpo: 'Procedure, istruzioni operative e moduli del Sistema di Gestione Integrato, sempre nella revisione in vigore: quello che leggete è ciò che applichiamo.' },
    { titolo: 'Circolari con presa visione', corpo: 'Le comunicazioni operative del laboratorio (variazioni di metodo, tempi di refertazione, calendario delle festività, modulistica) arrivano protocollate, con un QR code che apre sempre l\'ultima revisione. La presa visione si conferma con un clic e resta registrata.' },
    { titolo: 'Audit', corpo: 'Gli audit sono informatizzati: auto-audit mensili delle sedi, audit interni e di terze parti, verifiche di due diligence sui partner secondo la ISO 37001, con punteggi, azioni e piani di miglioramento tracciati.' },
    { titolo: 'Ticket', corpo: 'Per ogni richiesta che non riguarda un campione si apre un ticket: riceve un protocollo, arriva ai responsabili della funzione competente e potete seguirlo, commentarlo, allegare file e confermarne la chiusura.' },
    { titolo: 'Contatti con il personale', corpo: 'La rubrica con i contatti pubblici delle funzioni di Toscana Diagnostica: sapete sempre a chi scrivere.' },
    { titolo: 'Referti di Laboratorio online', corpo: 'In evidenza nel menu Servizi: il portale dei referti per la consultazione e la stampa dei referti dei vostri pazienti.', fill: 'FFF8DC' },
  ];
  const supporto = [];
  if (d.company.support_hours) supporto.push(p([r('Orari  ', { b: true, sz: 18, color: C.scuro }), r(String(d.company.support_hours).split(/\n+/).join('  ·  '), { sz: 18 })], { after: 60 }));
  const rec = [d.company.support_phone && `Telefono ${d.company.support_phone}`, d.company.support_email].filter(Boolean).join('   ·   ');
  if (rec) supporto.push(p([r('Recapiti  ', { b: true, sz: 18, color: C.scuro }), r(rec, { sz: 18 })], { after: 60 }));
  if (d.laboratorio) supporto.push(p([r('Laboratorio  ', { b: true, sz: 18, color: C.scuro }), r([d.laboratorio.telefono, d.laboratorio.email].filter(Boolean).join('   ·   '), { sz: 18 })], { after: 60 }));
  const tabSla = sla.ticket?.length ? [
    titoletto('Tempi dei ticket', { before: 200 }),
    p(r('Prima risposta e risoluzione hanno un tempo massimo per priorità, misurato dall\'apertura; il tempo in attesa di una vostra risposta non conta.', { sz: 17, color: C.grigio }), { after: 100, line: 264 }),
    tabellaDati([{ t: 'Priorità', w: 3200, b: true }, { t: 'Prima risposta', w: 3219 }, { t: 'Risoluzione', w: 3219 }],
      sla.ticket.map((x) => [x.etichetta, `entro ${ore(x.prima_risposta_ore)}`, `entro ${ore(x.risoluzione_ore)}`])),
  ].join('') : p(r('Tempi di risposta di ticket e non conformità: quelli concordati con il vostro referente.', { sz: 18 }), { before: 120 });
  return [
    testata('I servizi digitali', 'Il Portale Service', `Il vostro spazio in ${d.suiteHost}: un solo accesso per documenti, dati, comunicazioni e persone. È lo stesso sistema che il nostro personale usa ogni giorno, quindi quello che vediamo noi lo vedete anche voi.`),
    griglia(schede),
    p(r('LIVELLO DI SUPPORTO', { b: true, sz: 15, color: C.accento, spacing: 30 }), { before: 480, after: 60, keepNext: true }),
    p(r('Sempre qualcuno che risponde', { b: true, sz: 30, color: C.scuro }), { after: 160, keepNext: true }),
    testo('Per i campioni, i referti e le preparazioni il primo contatto è il Laboratorio di Analisi; per tutto il resto il supporto clienti. Le richieste scritte passano dal portale (ticket e non conformità), così restano tracciate e potete seguirne lo stato in ogni momento.', { after: 200 }),
    riquadro(supporto.join('') || p(r('Recapiti nella pagina "Il vostro referente dedicato".', { sz: 18 }))),
    tabSla,
    titoletto('Come si raggiunge', { before: 280 }),
    testo(`Il portale è all'indirizzo ${d.portaleUrl}, da qualunque browser, senza installare nulla. Le istruzioni per il primo accesso sono nella pagina seguente.`),
  ].join('');
}
// Ore dei tempi di risposta: in ore fino a 48, in giorni (di 24 ore) dai 72 in su se il numero è intero
export const ore = (h) => { const n = Number(h); if (!(n > 0)) return '–'; if (n >= 72 && n % 24 === 0) return `${n / 24} giorni`; return n === 1 ? '1 ora' : `${n} ore`; };

/** Accesso al Portale / alla Suite: URL, accessi esterni, primo accesso, portale referti. */
export function credenziali(d) {
  const c = d.credenziali;
  const url = p([r('Indirizzo  ', { b: true, sz: 18, color: C.scuro }), r(c.suiteUrl, { b: true, sz: 26, color: C.scuro })], { after: 60 });
  const qr = d.qrCred ? immagine('rIdQrCred', 1300, 1300, 'qr-credenziali.png') : '';
  const testa = tabella([LARGHEZZA - 1700, 1700], [[
    { c: [url, p(r(d.linea === 'SRV' ? 'Dalla pagina principale si apre il Portale Service; il QR code porta direttamente lì.' : 'La Suite di Toscana Diagnostica: un solo accesso per tutti gli strumenti a vostra disposizione.', { sz: 17, color: C.grigio }), { line: 264 })].join(''), w: LARGHEZZA - 1700, fill: C.chiaro, borders: BORDO_SCHEDA, mar: [200, 240, 200, 200], vAlign: 'center' },
    { c: qr ? p(qr, { jc: 'center' }) : p(''), w: 1700, fill: C.chiaro, mar: [120, 100, 120, 100], vAlign: 'center' },
  ]]);
  const acc = c.righe.length
    ? tabellaDati([{ t: 'Persona', w: 2100, b: true }, { t: 'Utente (email)', w: 3500 }, { t: 'Profilo', w: 1500 }, { t: 'Password', w: 2538 }], c.righe.map((x) => [x.nome, x.email, x.profilo, x.password]), { sz: 17 })
    : testo('Gli accessi personali si creano dalla Suite per ogni persona che ci indicate: ciascuna riceve un invito via email con la password provvisoria.', { i: true });
  const passi = [
    ['Accedete', `Aprite ${c.suiteUrl} e inserite la vostra email e la password provvisoria ricevuta con l'invito.`],
    ['Scegliete una nuova password', 'Al primo accesso la Suite chiede di sostituire la password provvisoria con una vostra.'],
    ['Prendete visione delle informative', 'Informativa privacy e Informativa sull\'uso dell\'intelligenza artificiale: la presa d\'atto si registra una volta, e di nuovo solo se cambiano.'],
    ['Secondo fattore (facoltativo)', 'Dal vostro profilo potete attivare l\'autenticazione a due fattori con un\'app sul telefono: consigliata.'],
  ];
  const passiXml = tabella([700, LARGHEZZA - 700], passi.map(([t, x], i) => [
    { c: p(r(String(i + 1), { b: true, sz: 28, color: C.accento }), { jc: 'center', line: 240 }), w: 700, mar: [80, 0, 80, 0], vAlign: 'top' },
    { c: p(r(t, { b: true, sz: 19, color: C.scuro }), { after: 20, line: 252 }) + p(r(x, { sz: 18 }), { line: 264 }), w: LARGHEZZA - 700, mar: [80, 120, 100, 0], borders: [nil('top'), nil('left'), bordo('bottom', C.bordo, 4), nil('right')].join('') },
  ]));
  const ref = c.referti ? [
    titoletto('Portale dei referti', { before: 300 }),
    tabellaDati([{ t: 'Indirizzo', w: 3800, b: true }, { t: 'Utente', w: 2900 }, { t: 'Password', w: 2938 }], [[c.referti.url || '–', c.referti.username || '–', c.referti.password]]),
    c.referti.password_inclusa ? p(r('La password è stampata in questo documento su vostra richiesta: custoditelo con cura e cambiatela al primo accesso.', { sz: 16, color: 'A03030', i: true }), { before: 80, line: 252 }) : '',
  ].join('') : '';
  return [
    testata('Le credenziali', d.linea === 'SRV' ? 'Accesso al Portale' : 'Accesso alla Suite', 'Ogni persona ha il proprio accesso, personale e non cedibile: così ogni operazione resta attribuita a chi l\'ha fatta.'),
    testa,
    titoletto('Gli accessi della vostra struttura', { before: 300 }),
    acc,
    titoletto('Il primo accesso', { before: 300 }),
    passiXml,
    ref,
  ].join('');
}

/** Credenziali StudioLAB (portale dei referti): indirizzo, utente, password solo se l'operatore l'ha inclusa. */
export function studiolab(d) {
  const x = d.studiolab;
  return [
    testata('Le credenziali', 'Credenziali StudioLAB', 'Il portale dei referti di laboratorio: consultazione e stampa dei referti dei vostri pazienti.'),
    tabellaDati([{ t: 'Indirizzo', w: 3800, b: true }, { t: 'Utente', w: 2900 }, { t: 'Password', w: 2938 }], [[x.url || '–', x.username || '–', x.password]]),
    x.password_inclusa ? p(r('La password è stampata in questo documento su vostra richiesta: custoditelo con cura e cambiatela al primo accesso.', { sz: 16, color: 'A03030', i: true }), { before: 80, line: 252 }) : '',
    vuoto(240),
    riquadro(p([r('Credenziali personali. ', { b: true, sz: 18, color: C.scuro }), r('Ogni accesso al portale dei referti resta registrato: non condividete utente e password e segnalateci subito eventuali persone da abilitare o disabilitare.', { sz: 18 })], { line: 276 })),
  ].join('');
}

/** I primi 30-60-90 giorni: tre colonne con data e passi. */
export function avvio(d) {
  const gap = 200; const w = Math.floor((LARGHEZZA - 2 * gap) / 3);
  const col = (f, i) => [
    p(r(f.fase.toUpperCase(), { b: true, sz: 15, color: i === 0 ? C.bianco : C.accento, spacing: 20 }), { after: 40 }),
    p(r(f.titolo, { b: true, sz: 24, color: i === 0 ? C.bianco : C.scuro }), { after: 40, line: 252 }),
    p(r(f.entro ? `entro il ${dataBreve(f.entro)}` : '', { sz: 17, color: i === 0 ? 'D7EEF1' : C.grigio }), { after: 160 }),
    ...f.passi.map((x) => p([r('—', { b: true, sz: 17, color: i === 0 ? C.accento : C.accento }), r(`\t${x}`, { sz: 17, color: i === 0 ? C.bianco : C.testo })],
      { tabs: '<w:tab w:val="left" w:pos="300"/>', ind: 'w:left="300" w:hanging="300"', after: 90, line: 264 })),
  ].join('');
  const celle = d.piano.map((f, i) => ({ c: col(f, i), w, fill: i === 0 ? C.scuro : C.chiaro, borders: i === 0 ? '' : BORDO_SCHEDA, mar: [240, 220, 240, 200] }));
  return [
    testata('Il piano di avvio', 'I primi 30-60-90 giorni', 'Un percorso proposto per partire bene: le date sono calcolate da quella di questo documento e si concordano con il vostro referente.'),
    tabella([w, gap, w, gap, w], [{ celle: [celle[0], { c: p(''), w: gap }, celle[1], { c: p(''), w: gap }, celle[2]] }]),
    vuoto(300),
    riquadro([p(r('Come misuriamo l\'avvio', { b: true, sz: 20, color: C.scuro }), { after: 80 }),
      p(r(d.linea === 'SRV' ? 'Non conformità, ordini, circolari e ticket sono nel portale: alla revisione dei 30 giorni li guardiamo insieme, con gli stessi dati che vedete voi.' : 'Alle revisioni guardiamo insieme gli stessi dati che vedete nella Suite: nessun resoconto a parte.', { sz: 18 }), { line: 276 })].join('')),
  ].join('');
}

/** Il vostro referente dedicato: owner dell'account e gli altri contatti. */
export function referente(d) {
  const o = d.owner || {};
  const righe = [o.ruolo, o.email, ...(o.telefoni?.length ? o.telefoni.map((t) => `${t.etichetta} ${t.numero}`.trim()) : [o.telefono])].filter(Boolean);
  const card = riquadro([
    p(r('VOSTRO REFERENTE PER TOSCANA DIAGNOSTICA', { b: true, sz: 15, color: 'BFE6EB', spacing: 30 }), { after: 80 }),
    p(r(o.nome || 'Da assegnare', { b: true, sz: 40, color: C.bianco }), { after: 100, line: 240 }),
    ...righe.map((x) => p(r(x, { sz: 21, color: C.bianco }), { after: 40 })),
  ].join(''), { scuro: true, mar: [320, 360, 320, 360] });
  return [
    testata('Le persone', 'Il vostro referente dedicato', 'Una persona che conosce la vostra struttura e segue la collaborazione dall\'avvio in poi: è il primo nome da chiamare quando qualcosa non va, o quando può andare meglio.'),
    card,
    titoletto('Gli altri contatti', { before: 360 }),
    bloccoReferenti(d.referenti.filter((x) => x.ceo || !(x.owner || (o.email && x.email === o.email) || (o.nome && x.nome === o.nome)))),
    p(r(`Le email inviate a ${d.casella} arrivano alla linea ${d.lineaLabel} e restano registrate nella scheda della vostra struttura: chiunque vi risponda conosce la storia della collaborazione.`, { sz: 17, color: C.grigio }), { before: 120, line: 264 }),
  ].join('');
}

/** Cosa ci rende diversi: quattro schede e le certificazioni con numero e scadenza (dallo specchio del Portale Service). */
export function diversi(d) {
  const schede = [
    { titolo: 'Trasparenza', corpo: d.linea === 'SRV' ? 'Tutto è tracciato e consultabile da voi: non conformità con le risposte, ordini con le fasi, circolari con le prese visione, ticket con i tempi. Non chiedete un resoconto: lo avete già.' : 'Tutto è tracciato e consultabile da voi nella Suite: circolari con le prese visione, ticket con i tempi, i dati che vi riguardano. Non chiedete un resoconto: lo avete già.' },
    { titolo: 'Tempi dichiarati', corpo: d.linea === 'SRV' ? 'I tempi di refertazione di ogni esame sono scritti nel Vademecum; le non conformità e i ticket hanno scadenze di risposta misurate. Promettiamo solo quello che misuriamo.' : 'Le richieste hanno scadenze di risposta misurate e visibili. Promettiamo solo quello che misuriamo.' },
    { titolo: 'Certificazioni', corpo: 'Un Sistema di Gestione Integrato certificato da un ente terzo accreditato: qualità, ambiente, salute e sicurezza, prevenzione della corruzione. Gli audit interni sono continui e informatizzati.' },
    { titolo: 'Un solo portale', corpo: 'Un accesso personale per documenti, procedure, ordini, comunicazioni, richieste e contatti. Le stesse informazioni che usa il nostro personale, nella revisione in vigore.' },
  ];
  const cert = d.certificazioni?.length ? [
    titoletto('Le nostre certificazioni', { before: 360 }),
    tabellaDati([{ t: 'Norma', w: 2000, b: true }, { t: 'Sistema di gestione', w: 4238 }, { t: 'Certificato', w: 1900 }, { t: 'Valido fino al', w: 1500 }],
      d.certificazioni.map((c) => [c.norma, c.titolo, c.numero, c.scadenza || '–'])),
    d.organismo ? p(r(`Ente di certificazione: ${d.organismo}.`, { sz: 16, color: C.grigio }), { before: 80, line: 252 }) : '',
  ].join('') : '';
  return [
    testata('Il nostro metodo', 'Cosa ci rende diversi', 'Quattro scelte che vedete ogni giorno nel lavoro insieme, non solo in queste pagine.'),
    griglia(schede),
    cert,
  ].join('');
}

/** Checklist per iniziare: caselle da spuntare. */
export function checklist(d) {
  const righe = d.checklist.map((x) => [
    { c: p(r('☐', { sz: 28, color: C.accento }), { jc: 'center', line: 240 }), w: 700, mar: [70, 0, 70, 0], vAlign: 'center', borders: [nil('top'), nil('left'), bordo('bottom', C.bordo, 4), nil('right')].join('') },
    { c: p(r(x, { sz: 19 }), { line: 264 }), w: LARGHEZZA - 700, mar: [110, 80, 110, 0], vAlign: 'center', borders: [nil('top'), nil('left'), bordo('bottom', C.bordo, 4), nil('right')].join('') },
  ]);
  return [
    testata('Per iniziare', 'Checklist per iniziare', 'Da stampare o da tenere sottomano: le cose da fare nelle prime settimane, nell\'ordine in cui conviene farle.'),
    tabella([700, LARGHEZZA - 700], righe),
    titoletto('Serve aiuto?', { before: 360 }),
    aiutoChecklist(d),
  ].join('');
}

/** Contatti della checklist, nella tabella dei referenti: il CEO, l'owner dell'account (o la casella della linea) e il supporto clienti. */
function aiutoChecklist(d) {
  const voci = (d.referenti || []).filter((x) => x.ceo || x.owner || (d.owner?.email && x.email === d.owner.email) || x.ruolo === 'Supporto clienti' || (!d.owner && x.email === d.casella));
  const ordine = (x) => (x.ceo ? 0 : x.ruolo === 'Supporto clienti' ? 2 : 1);   // CEO, poi il referente dell'account, poi il supporto
  return voci.length ? bloccoReferenti([...voci].sort((a, b) => ordine(a) - ordine(b))) : testo(d.aiuto, { sz: 19 });
}

/** Offerta economica (ripiego quando la lettera di offerta non è stata generata): i soli dati della proposta presenti. */
export function offertaEconomica(d) {
  const righe = d.proposta.map((x) => [x.voce, x.valore]);
  return [
    testata('La proposta', 'Offerta economica', `Le condizioni proposte per ${conPunto(d.cliente)}`),
    tabellaDati([{ t: 'Voce', w: 4200, b: true }, { t: 'Proposta', w: LARGHEZZA - 4200 }], righe, { sz: 19 }),
    vuoto(240),
    testo('I valori riassumono la proposta registrata per la vostra struttura. Le condizioni contrattuali sono quelle della lettera di offerta e delle Condizioni Generali di Contratto che vi trasmetteremo per la firma.', { color: C.grigio, sz: 18 }),
  ].join('');
}

/** La rete (PP): le sedi attive dell'anagrafica, per tipologia. */
export function network(d) {
  const tipi = d.sedi.reduce((m, s) => { (m[s.tipo] = m[s.tipo] || []).push(s); return m; }, {});
  const blocchi = Object.entries(tipi).map(([tipo, l]) => [
    titoletto(`${tipo} (${l.length})`, { before: 240 }),
    tabellaDati([{ t: 'Sede', w: 3600, b: true }, { t: 'Indirizzo', w: LARGHEZZA - 3600 }], l.map((s) => [s.nome, s.indirizzo || '–']), { sz: 17 }),
  ].join('')).join('');
  return [
    testata('La rete', 'La rete Toscana Diagnostica', 'Un laboratorio, una direzione, un unico sistema di regole e una rete di sedi sul territorio: il punto prelievi della vostra struttura ne diventa parte.'),
    griglia([
      { titolo: 'Cosa porta la rete', corpo: 'Il laboratorio di Sesto Fiorentino, le procedure del Sistema di Gestione Integrato, la tracciabilità dei campioni, la modulistica e le circolari operative.' },
      { titolo: 'Cosa vedete voi', corpo: 'Nella Suite: le royalties del punto mese per mese, le circolari con la presa visione, i ticket per ogni richiesta, la rubrica con i contatti delle funzioni.' },
    ]),
    d.sedi.length ? blocchi : '',
  ].join('');
}

/** Medicina del Lavoro (MDL): come funziona il servizio, dai contenuti dell'offerta MOD231. */
export function mdl(d) {
  return [
    testata('Il servizio', 'La Medicina del Lavoro', 'Le prestazioni per i vostri lavoratori, organizzate da un unico interlocutore.'),
    griglia([
      { titolo: 'Chi visitiamo', corpo: `Ci indicate per iscritto i lavoratori da sottoporre alle prestazioni, scrivendo a ${d.casella}. Le prestazioni sono quelle dell'Allegato 1 delle Condizioni Generali di Contratto.` },
      { titolo: 'Gli appuntamenti', corpo: 'Organizziamo gli appuntamenti e li confermiamo all\'indirizzo email e al contatto di riferimento che ci indicate nella lettera di offerta.' },
      { titolo: 'La fatturazione', corpo: 'Mensile, con il riepilogo delle prestazioni, all\'indirizzo che ci indicate; se un documento contiene dati personali dei lavoratori viaggia via PEC.' },
      { titolo: 'La qualità', corpo: 'Le prestazioni seguono il Sistema di Gestione Integrato di Toscana Diagnostica, certificato e verificato con audit periodici.' },
    ]),
  ].join('');
}

/** Vademecum: frontespizio prima delle pagine del PDF (allegato = true) o pagina con link e QR (PDF non disponibile nello specchio). */
export function vademecumLink(d, { allegato = false, pagine = 0 } = {}) {
  return [
    testata('La guida agli esami', 'Vademecum degli esami', allegato
      ? `Nelle ${pagine} pagine che seguono trovate il Vademecum degli esami: per ogni esame codice, metodo, tempi di refertazione, campione e preparazione, valori di riferimento. Come preparare, confezionare e inviare i campioni.`
      : 'La guida operativa per i laboratori clienti: come preparare, confezionare e inviare i campioni, tempi di refertazione, modulistica e contatti.'),
    riquadro(tabella([LARGHEZZA - 2400 - 520, 2400], [[
      { c: [p(r('Sempre aggiornato, online', { b: true, sz: 24, color: C.scuro }), { after: 120 }), p(r(d.vademecumUrl, { b: true, sz: 21, color: C.medio }), { after: 120 }),
        p(r(allegato ? 'Le pagine allegate fotografano il Vademecum alla data di questo documento; la versione in vigore è sempre quella online: inquadrate il QR code o aprite l\'indirizzo da qualunque browser. La trovate anche nel Portale Service, alla voce Vademecum.' : 'Il Vademecum online è la versione in vigore: inquadrate il QR code o aprite l\'indirizzo da qualunque browser. Lo trovate anche nel Portale Service, alla voce Vademecum.', { sz: 18 }), { line: 276 })].join(''), w: LARGHEZZA - 2400 - 520, vAlign: 'center' },
      { c: p(immagine('rIdQrVad', 2200, 2200, 'qr-vademecum.png'), { jc: 'center' }), w: 2400, vAlign: 'center' },
    ]]), { mar: [300, 260, 300, 260] }),
  ].join('');
}
