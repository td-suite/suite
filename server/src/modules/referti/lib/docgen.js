// Generatore del referto TD: corpo del documento con la libreria docx secondo il format canonico (specifica §4), poi
// trapianto OpenXML dentro il template della carta intestata (header, footer, media, sectPr del template; word/document.xml
// sostituito con il corpo generato). PDF con LibreOffice headless (coda sequenziale di business/lib/docgen.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign, TableLayoutType,
} from 'docx';
import { docxToPdf } from '../../business/lib/docgen.js';
import { pulisci } from './text.js';
import { partiSettore } from './micro.js';

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const TEMPLATE_DEFAULT = path.join(TPL_DIR, 'carta_intestata_default.docx');

// ---- Format canonico
const FONT = 'Lato';
const C = { titolo: '004F5F', etichetta: '5A6B70', testo: '1A1A1A', linea: 'C9E1E6', accento: '42B2BF', riquadro: 'EAF5F7', bianco: 'FFFFFF' };
const W = 9638;                       // larghezza utile A4 con margini 2 cm
const COL1 = [3969, 3061, 2608];      // corpo 1: esame | risultato | riferimento
const COL2 = [4309, 3628, 1701];      // corpo 2: etichetta | valore | (unità)
const COL2B = [4600, 5038];           // corpo 2 (modello Laboratorio): etichetta | valore con unità
const COLAB = [4876, 1928, 1474];     // antibiogramma: antibiotico | S/I/R | MIC (come il modello STEFANI)
const RIQUADRO = 4479;
// Margini canonici (twip): superiore 3,94 cm, altri 2 cm
export const PGMAR = { top: 2233, right: 1134, bottom: 1134, left: 1134 };
// Riquadro paziente staccato dall'intestazione come nel modello (STEFANI, correzione del CEO del 31/10/2026 sul caso RECCHIA): il
// margine superiore non scende mai sotto quello canonico, nemmeno con il template caricato dalle Impostazioni (l'intestazione con
// immagini ancorate non sposta il corpo: con un margine di 2,5 cm il riquadro si addossava al logo), e sopra il riquadro c'è uno
// spazio fisso. Bordo superiore del riquadro a ~4,3 cm dal bordo pagina, ~0,9 cm sotto i contatti dell'intestazione.
export const TOP_MINIMO = PGMAR.top;
export const SPAZIO_RIQUADRO = 200;

const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const NOB = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
const cellNOB = { top: none, bottom: none, left: none, right: none };

// Spazi compattati ma non rimossi ai bordi (le etichette finiscono con ": ")
const clean = (s) => { const str = String(s ?? ''); return pulisci(str).replace(/\s+/g, ' ') + (/\s$/.test(str) ? ' ' : ''); };
const t = (text, o = {}) => new TextRun({ text: clean(text), font: FONT, size: o.size || 19, bold: o.bold, italics: o.italics, color: o.color || C.testo, allCaps: o.caps });
const p = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: o.align || AlignmentType.LEFT, keepNext: o.keepNext, keepLines: o.keepLines,
  spacing: { before: o.before || 0, after: o.after == null ? 40 : o.after, line: o.line || 252, lineRule: 'auto' }, border: o.border });
const cell = (children, w, o = {}) => new TableCell({
  children: Array.isArray(children) ? children : [children],
  width: { size: w, type: WidthType.DXA },
  columnSpan: o.span,
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
  borders: o.borders || cellNOB,
  margins: o.margins || { top: 50, bottom: 50, left: 60, right: 60 },
  verticalAlign: o.valign || VerticalAlign.TOP,
});
const table = (rows, widths, o = {}) => new Table({ rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: o.borders || NOB, alignment: o.align });
const spacer = (h = 120) => new Paragraph({ children: [new TextRun({ text: '', size: 2 })], spacing: { before: 0, after: 0, line: h, lineRule: 'exact' } });

// Riquadro anagrafico a destra (4479 twip) come il modello della routine del Laboratorio (STEFANI UGHETTA, 29/10/2026): il titolo del
// riquadro è il nome del paziente, 12 pt bold 004F5F; sotto le righe 8,5 pt (etichetta grigia, valore bold) Data di nascita (con
// "(anni NN)" se disponibile), Sesso, Referto e Accettazione (codice e data, Bianalisi), Accettazione n°, Data Acc., Luogo di nascita,
// Indirizzo. Una riga si stampa SOLO se il valore c'è (correzione del CEO del 31/10/2026: mai righe vuote con "-").
export function righeRiquadro(a = {}) {
  const v = (x) => String(x ?? '').trim();
  const conData = (codice, data) => [v(codice), v(data) ? `del ${v(data)}` : ''].filter(Boolean).join(' ');
  const out = [];
  if (v(a.data_nascita)) out.push(['Data di nascita', v(a.eta) ? `${v(a.data_nascita)} (anni ${v(a.eta)})` : v(a.data_nascita)]);
  if (v(a.sesso)) out.push(['Sesso', v(a.sesso)]);
  if (v(a.referto_codice) || v(a.referto_data)) out.push(['Referto', conData(a.referto_codice, a.referto_data)]);
  if (v(a.accettazione_codice) || v(a.accettazione_data)) out.push(['Accettazione', conData(a.accettazione_codice, a.accettazione_data)]);
  if (v(a.accettazione_n)) out.push(['Accettazione n°', v(a.accettazione_n)]);
  if (v(a.data_acc)) out.push(['Data Acc.', v(a.data_acc)]);
  if (v(a.luogo_nascita)) out.push(['Luogo di nascita', v(a.luogo_nascita)]);
  if (v(a.indirizzo)) out.push(['Indirizzo', v(a.indirizzo)]);
  return out;
}
function riquadroAnagrafico(a) {
  const riga = ([label, value]) => p([t(`${label}: `, { size: 17, color: C.etichetta }), t(value, { size: 17, bold: true })], { after: 20, line: 240 });
  const righe = [p(t(a.cognome_nome || 'PAZIENTE', { size: 24, bold: true, color: C.titolo }), { after: 60, line: 276 }), ...righeRiquadro(a).map(riga)];
  return table([new TableRow({ children: [cell(righe, RIQUADRO, { fill: C.riquadro, margins: { top: 120, bottom: 120, left: 180, right: 180 },
    borders: { ...cellNOB, left: { style: BorderStyle.SINGLE, size: 24, color: C.accento } } })] })], [RIQUADRO], { align: AlignmentType.RIGHT });
}

// Titolo di settore 12,5 pt bold maiuscolo con filetto azzurro
const titoloSettore = (s) => p(t(s, { size: 25, bold: true, color: C.titolo, caps: true }), { before: 240, after: 100, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.linea, space: 4 } } });

// ---- Corpo 1: tabella esame | risultato | riferimento
function rigaEsame1(r) {
  const nome = [p(t(r.nome, { size: 19, bold: true }), { after: 0, line: 240 })];
  for (const s of r.sotto || []) nome.push(p(t(s, { size: 15, color: C.etichetta }), { after: 0, line: 220 }));
  if (r.descrizione) nome.push(p(t(r.descrizione, { size: 15, color: C.etichetta }), { after: 0, line: 220 }));
  const ris = [t(r.risultato || '', { size: 21, bold: true })];
  if (r.unita) ris.push(t(` ${r.unita}`, { size: 17, color: C.etichetta }));
  return new TableRow({ cantSplit: true, children: [
    cell(nome, COL1[0]),
    cell(p(ris, { align: AlignmentType.RIGHT, after: 0, line: 252 }), COL1[1]),
    cell(p(t(r.riferimento || '', { size: 17, color: C.etichetta }), { after: 0, line: 240 }), COL1[2]),
  ] });
}
function rigaAntibiotico1(r) {
  return new TableRow({ cantSplit: true, children: [
    cell(p(t(r.nome, { size: 19 }), { after: 0, line: 240 }), COL1[0]),
    cell(p(t(r.esito || '', { size: 21, bold: true }), { align: AlignmentType.RIGHT, after: 0, line: 252 }), COL1[1]),
    cell(p(t(r.mic ? `MIC ${r.mic}` : '', { size: 17 }), { after: 0, line: 240 }), COL1[2]),
  ] });
}
const rigaSpan = (testo, o = {}) => new TableRow({ cantSplit: true, children: [cell(p(t(testo, { size: o.size || 15, color: o.color || C.etichetta }), { after: 0, line: 220 }), W, { span: 3 })] });

function tabella1(righe) {
  const rows = righe.map((r) => {
    if (r.tipo === 'antibiotico') return rigaAntibiotico1(r);
    if (r.tipo === 'legenda') return rigaSpan(r.testo);
    if (r.tipo === 'testo') return rigaSpan(r.testo, { size: 18, color: C.testo });
    return rigaEsame1(r);
  });
  return rows.length ? [table(rows, COL1)] : [];
}
// Corpo 1: tabella a tre colonne; il blocco microbiologico con antibiogramma (Bianalisi) è reso come il modello del Laboratorio:
// esame con Metodo/Materiale e tabella etichetta/valore, poi "Microrganismo #n" e tabella teal (lib/micro.js partiSettore)
function corpo1(dati) {
  const out = [];
  for (const s of dati.settori || []) {
    if (s.titolo) out.push(titoloSettore(s.titolo));   // titolo di settore solo se la sorgente lo ha
    for (const parte of partiSettore(s.righe)) {
      if (parte.tipo === 'righe') out.push(...tabella1(parte.righe));
      else out.push(...esameModello(parte), ...parte.antibiogrammi.flatMap((b) => antibiogramma(b)));
    }
  }
  return out;
}

// ---- Corpo 2: titolo esame + metodo/materiale, tabella etichetta/valore, antibiogrammi per microrganismo
function antibiogramma(b) {
  const out = [];
  out.push(p(t(`Microrganismo #${b.n}${b.specie ? `: ${b.specie}` : ''}`, { size: 20, bold: true, color: C.titolo }), { before: 160, after: 40, keepNext: true }));
  if (b.carica) out.push(p(t(`${b.carica_label || 'Carica Batterica'}: ${b.carica}`, { size: 19, bold: true }), { after: 80, keepNext: true }));
  // testata come il modello del Laboratorio: legenda in corsivo nella prima colonna, specie + "#n" nella seconda, MIC nella terza
  const hcell = (children, i) => cell(children, COLAB[i], { fill: C.titolo, margins: { top: 60, bottom: 60, left: 80, right: 80 }, valign: VerticalAlign.CENTER });
  const hdr = new TableRow({ tableHeader: true, cantSplit: true, children: [
    hcell(p(t(b.legenda || 'R: Resistente  I: Sensibile con aumentata esposizione al farmaco', { size: 14, italics: true, color: C.bianco }), { after: 0, line: 220 }), 0),
    hcell([p(t(b.specie || 'Microrganismo', { size: 16, bold: true, color: C.bianco }), { after: 0, line: 220, align: AlignmentType.CENTER }), p(t(`#${b.n}`, { size: 16, bold: true, color: C.bianco }), { after: 0, line: 220, align: AlignmentType.CENTER })], 1),
    hcell(p(t('MIC', { size: 16, bold: true, color: C.bianco }), { after: 0, line: 240, align: AlignmentType.CENTER }), 2),
  ] });
  const rows = (b.righe || []).map((r, i) => new TableRow({ cantSplit: true, children: [
    cell(p(t(r.antibiotico, { size: 18 }), { after: 0, line: 240 }), COLAB[0], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
    cell(p(t(r.sir || '', { size: 18, bold: true, color: C.titolo }), { after: 0, line: 240, align: AlignmentType.CENTER }), COLAB[1], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
    cell(p(t(r.mic || '', { size: 18 }), { after: 0, line: 240, align: AlignmentType.CENTER }), COLAB[2], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
  ] }));
  out.push(table([hdr, ...rows], COLAB));
  if (b.nota_legenda) out.push(p(t(b.nota_legenda, { size: 14, italics: true, color: C.etichetta }), { before: 60, after: 0, line: 220 }));
  return out;
}
// Esame come il modello della routine del Laboratorio: titolo in teal maiuscolo, Metodo / Materiale / Sede / nota ognuno sulla sua riga,
// tabella etichetta/valore con filetto (valore bold teal; riferimento, se c'è, sotto il valore in grigio)
function esameModello(e) {
  const out = [];
  if (e.titolo) out.push(p(t(e.titolo, { size: 21, bold: true, color: C.titolo, caps: true }), { before: 180, after: 20, keepNext: true }));
  for (const m of [e.metodo ? `Metodo: ${e.metodo}` : null, e.materiale ? `Materiale: ${e.materiale}` : null, e.sede ? `Sede Anatomica: ${e.sede}` : null, ...(e.altre || []), e.nota || null].filter(Boolean)) {
    out.push(p(t(m, { size: 15, color: C.etichetta }), { after: 0, line: 220, keepNext: true }));
  }
  if (e.campi?.length) out.push(spacer(100));
  const sep = { ...cellNOB, bottom: { style: BorderStyle.SINGLE, size: 4, color: C.linea } };
  const mar = { top: 70, bottom: 70, left: 60, right: 60 };
  const rows = (e.campi || []).map((c) => {
    if (c.libero || !c.etichetta) return new TableRow({ cantSplit: true, children: [cell(p(t(c.valore, { size: 19 }), { after: 0, line: 252 }), W, { span: 2, borders: sep, margins: mar })] });
    const valore = [p(t(`${c.valore}${c.unita ? ` ${c.unita}` : ''}`, { size: 18, bold: true, color: C.titolo }), { after: 0, line: 252 })];
    if (c.riferimento) valore.push(p(t(`Riferimento: ${c.riferimento}`, { size: 15, color: C.etichetta }), { after: 0, line: 220 }));
    return new TableRow({ cantSplit: true, children: [
      cell(p(t(c.etichetta, { size: 18 }), { after: 0, line: 252 }), COL2B[0], { borders: sep, margins: mar }),
      cell(valore, COL2B[1], { borders: sep, margins: mar }),
    ] });
  });
  if (rows.length) out.push(table(rows, COL2B));
  return out;
}

function corpo2(dati) {
  const out = [];
  const esami = dati.esami || [];
  const ab = dati.antibiogrammi || [];
  (dati.settori || []).forEach((s, si) => {
    if (s.titolo) out.push(titoloSettore(s.titolo));
    esami.forEach((e, ei) => {
      if ((e.settore ?? 0) !== si) return;
      out.push(...esameModello(e));
      for (const b of ab) if ((b.esame ?? 0) === ei) out.push(...antibiogramma(b));
    });
  });
  // antibiogrammi orfani (esame non trovato)
  for (const b of ab) if (!esami[b.esame ?? 0]) out.push(...antibiogramma(b));
  return out;
}

// Corpo completo (senza intestazione: la mette il template)
function corpoDocumento(dati) {
  const children = [spacer(SPAZIO_RIQUADRO), riquadroAnagrafico(dati.anagrafica || {}), spacer(160)];
  children.push(...(Number(dati.corpo) === 2 ? corpo2(dati) : corpo1(dati)));
  if (dati.note?.length) {
    children.push(spacer(200));
    for (const n of dati.note) children.push(p(t(n, { size: 15, color: C.etichetta }), { after: 20, line: 220 }));
  }
  return children;
}

// ---- Trapianto OpenXML nel template della carta intestata
const xmlnsOf = (tag) => { const out = new Map(); for (const m of tag.matchAll(/\s(xmlns(?::[\w-]+)?)="([^"]*)"/g)) out.set(m[1], m[2]); return out; };
const rootTag = (xml) => (xml.match(/<w:document\b[^>]*>/) || [''])[0];
const bodyInner = (xml) => { const m = xml.match(/<w:body>([\s\S]*)<\/w:body>/); return m ? m[1] : ''; };
const sectPrOf = (xml) => { const all = [...xml.matchAll(/<w:sectPr\b[^>]*\/>|<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g)]; return all.length ? all[all.length - 1][0] : ''; };

// Patch dei margini (si usa per il template predefinito, che nasce da un'offerta commerciale)
function patchMargini(sectPr, mar) {
  const pgMar = `<w:pgMar w:top="${mar.top}" w:right="${mar.right}" w:bottom="${mar.bottom}" w:left="${mar.left}" w:header="708" w:footer="708" w:gutter="0"/>`;
  const pgSz = '<w:pgSz w:w="11906" w:h="16838"/>';
  let s = sectPr.replace(/<w:pgMar\b[^>]*\/>/, pgMar).replace(/<w:pgSz\b[^>]*\/>/, pgSz);
  if (!/<w:pgMar\b/.test(s)) s = s.replace('</w:sectPr>', `${pgMar}</w:sectPr>`);
  return s;
}

// Template caricato: margini del template conservati, ma il superiore non scende sotto il minimo (il corpo non deve salire
// sull'intestazione)
export function alzaMargineSuperiore(sectPr, minimo) {
  const m = sectPr.match(/<w:pgMar\b[^>]*\/>/);
  if (!m) return sectPr.replace('</w:sectPr>', `<w:pgMar w:top="${minimo}" w:right="${PGMAR.right}" w:bottom="${PGMAR.bottom}" w:left="${PGMAR.left}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`);
  const top = Number((m[0].match(/w:top="(-?\d+)"/) || [])[1] || 0);
  if (Math.abs(top) >= minimo) return sectPr;
  const nuovo = /w:top="/.test(m[0]) ? m[0].replace(/w:top="-?\d+"/, `w:top="${minimo}"`) : m[0].replace('<w:pgMar', `<w:pgMar w:top="${minimo}"`);
  return sectPr.replace(m[0], nuovo);
}

export function trapianta(generatoBuf, templateBuf, { margini = null } = {}) {
  const gen = new PizZip(generatoBuf);
  const tpl = new PizZip(templateBuf);
  const genXml = gen.file('word/document.xml')?.asText();
  const tplXml = tpl.file('word/document.xml')?.asText();
  if (!genXml || !tplXml) throw new Error('Template DOCX non valido (manca word/document.xml)');
  let body = bodyInner(genXml);
  const genSect = sectPrOf(body);
  if (genSect) body = body.replace(genSect, '');
  let sect = sectPrOf(tplXml);
  if (!sect) throw new Error('Il template non ha le proprietà di sezione (sectPr): impossibile usarne intestazione e piè di pagina');
  if (margini) sect = patchMargini(sect, margini);
  else sect = alzaMargineSuperiore(sect, TOP_MINIMO);
  const ns = new Map([...xmlnsOf(rootTag(tplXml)), ...xmlnsOf(rootTag(genXml))]);
  const ign = rootTag(tplXml).match(/\smc:Ignorable="([^"]*)"/);
  const root = `<w:document${[...ns].map(([k, v]) => ` ${k}="${v}"`).join('')}${ign && ns.has('xmlns:mc') ? ` mc:Ignorable="${ign[1]}"` : ''}>`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${root}<w:body>${body}${sect}</w:body></w:document>`;
  tpl.file('word/document.xml', xml);
  // il template non deve lasciare contenuti dinamici: niente bookmark/commenti orfani; i rels del documento restano quelli del template
  return tpl.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Verifica di un template caricato: deve essere un DOCX con document.xml e sectPr
export function verificaTemplate(buf) {
  try {
    const z = new PizZip(buf);
    const xml = z.file('word/document.xml')?.asText();
    if (!xml) return { ok: false, errore: 'Il file non è un documento Word (manca word/document.xml)' };
    if (!sectPrOf(xml)) return { ok: false, errore: 'Il documento non ha le proprietà di sezione (intestazione e piè di pagina)' };
    const headers = Object.keys(z.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).length;
    const footers = Object.keys(z.files).filter((f) => /^word\/footer\d*\.xml$/.test(f)).length;
    return { ok: true, headers, footers };
  } catch (e) { return { ok: false, errore: `File non leggibile: ${e.message}` }; }
}

// Genera il DOCX: corpo con la libreria docx + trapianto nel template (predefinito o caricato)
export async function generaDocx(dati, { template = null } = {}) {
  const doc = new Document({
    creator: 'Toscana Diagnostica · Referti esterni', title: 'Referto',
    styles: { default: { document: { run: { font: FONT, size: 19, color: C.testo } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { ...PGMAR, header: 708, footer: 708 } } }, children: corpoDocumento(dati) }],
  });
  const generato = await Packer.toBuffer(doc);
  const usaDefault = !template;
  const tplBuf = template || fs.readFileSync(TEMPLATE_DEFAULT);
  return trapianta(generato, tplBuf, { margini: usaDefault ? PGMAR : null });
}

// Testo del corpo di un DOCX (solo word/document.xml: intestazione e piè di pagina del template esclusi)
export function testoDocx(buf) {
  const z = new PizZip(buf);
  const xml = z.file('word/document.xml')?.asText() || '';
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export const generaPdf = (docxBuf) => docxToPdf(docxBuf);
