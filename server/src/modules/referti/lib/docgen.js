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

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const TEMPLATE_DEFAULT = path.join(TPL_DIR, 'carta_intestata_default.docx');

// ---- Format canonico
const FONT = 'Lato';
const C = { titolo: '004F5F', etichetta: '5A6B70', testo: '1A1A1A', linea: 'C9E1E6', accento: '42B2BF', riquadro: 'EAF5F7', bianco: 'FFFFFF' };
const W = 9638;                       // larghezza utile A4 con margini 2 cm
const COL1 = [3969, 3061, 2608];      // corpo 1: esame | risultato | riferimento
const COL2 = [4309, 3628, 1701];      // corpo 2: etichetta | valore | (unità)
const COLAB = [4876, 1928, 1474];     // antibiogramma: antibiotico | S/I/R | MIC
const RIQUADRO = 4479;
// Margini canonici (twip): superiore 3,94 cm, altri 2 cm
export const PGMAR = { top: 2233, right: 1134, bottom: 1134, left: 1134 };

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

// Riquadro anagrafico a destra (4479 twip): nome 12 pt bold; righe 8,5 pt; variante A (Accettazione n° + Data Acc.) o B (Referto + Accettazione, età)
function riquadroAnagrafico(a) {
  const riga = (label, value) => p([t(`${label}: `, { size: 17, color: C.etichetta }), t(value || '-', { size: 17, bold: true })], { after: 20, line: 240 });
  const righe = [p(t(a.cognome_nome || 'PAZIENTE', { size: 24, bold: true, color: C.titolo }), { after: 60, line: 276 })];
  righe.push(riga('Data di nascita', a.variante === 'B' && a.eta != null && a.eta !== '' ? `${a.data_nascita || '-'} (anni ${a.eta})` : a.data_nascita));
  righe.push(riga('Sesso', a.sesso));
  if (a.variante === 'B') {
    righe.push(riga('Referto', [a.referto_codice, a.referto_data ? `del ${a.referto_data}` : ''].filter(Boolean).join(' ')));
    righe.push(riga('Accettazione', [a.accettazione_codice, a.accettazione_data ? `del ${a.accettazione_data}` : ''].filter(Boolean).join(' ')));
  } else {
    righe.push(riga('Accettazione n°', a.accettazione_n));
    righe.push(riga('Data Acc.', a.data_acc));
  }
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

function corpo1(dati) {
  const out = [];
  for (const s of dati.settori || []) {
    out.push(titoloSettore(s.titolo || 'ESAMI'));
    const rows = (s.righe || []).map((r) => {
      if (r.tipo === 'antibiotico') return rigaAntibiotico1(r);
      if (r.tipo === 'legenda') return rigaSpan(r.testo);
      if (r.tipo === 'testo') return rigaSpan(r.testo, { size: 18, color: C.testo });
      return rigaEsame1(r);
    });
    if (rows.length) out.push(table(rows, COL1));
  }
  return out;
}

// ---- Corpo 2: titolo esame + metodo/materiale, tabella etichetta/valore, antibiogrammi per microrganismo
function antibiogramma(b) {
  const out = [];
  out.push(p(t(`Microrganismo #${b.n}${b.specie ? `: ${b.specie}` : ''}`, { size: 20, bold: true, color: C.titolo }), { before: 160, after: 40, keepNext: true }));
  if (b.carica) out.push(p(t(`${b.carica_label || 'Carica Batterica'}: ${b.carica}`, { size: 19, bold: true }), { after: 40, keepNext: true }));
  if (b.legenda) out.push(p(t(b.legenda, { size: 15, color: C.etichetta }), { after: 60, keepNext: true }));
  const hdr = new TableRow({ tableHeader: true, cantSplit: true, children: ['Antibiotico', 'S / I / R', 'MIC'].map((h, i) => cell(p(t(h, { size: 17, bold: true, color: C.bianco }), { after: 0, line: 240, align: i ? AlignmentType.CENTER : AlignmentType.LEFT }), COLAB[i], { fill: C.titolo, margins: { top: 60, bottom: 60, left: 80, right: 80 } })) });
  const rows = (b.righe || []).map((r, i) => new TableRow({ cantSplit: true, children: [
    cell(p(t(r.antibiotico, { size: 18 }), { after: 0, line: 240 }), COLAB[0], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
    cell(p(t(r.sir || '', { size: 18, bold: true }), { after: 0, line: 240, align: AlignmentType.CENTER }), COLAB[1], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
    cell(p(t(r.mic || '', { size: 18 }), { after: 0, line: 240, align: AlignmentType.CENTER }), COLAB[2], { fill: i % 2 ? C.riquadro : C.bianco, margins: { top: 40, bottom: 40, left: 80, right: 80 } }),
  ] }));
  out.push(table([hdr, ...rows], COLAB));
  return out;
}
function corpo2(dati) {
  const out = [];
  const esami = dati.esami || [];
  const ab = dati.antibiogrammi || [];
  (dati.settori || []).forEach((s, si) => {
    out.push(titoloSettore(s.titolo || 'ESAMI'));
    esami.forEach((e, ei) => {
      if ((e.settore ?? 0) !== si) return;
      out.push(p(t(e.titolo, { size: 21, bold: true }), { before: 140, after: 20, keepNext: true }));
      const meta = [e.metodo ? `Metodo: ${e.metodo}` : null, e.materiale ? `Materiale: ${e.materiale}` : null, e.sede ? `Sede Anatomica: ${e.sede}` : null].filter(Boolean).join(' · ');
      if (meta) out.push(p(t(meta, { size: 15, color: C.etichetta }), { after: 20, keepNext: true }));
      if (e.nota) out.push(p(t(e.nota, { size: 15, color: C.etichetta }), { after: 40, keepNext: true }));
      const rows = (e.campi || []).map((c) => (c.libero || !c.etichetta
        ? new TableRow({ cantSplit: true, children: [cell(p(t(c.valore, { size: 19 }), { after: 0, line: 252 }), W, { span: 3 })] })
        : new TableRow({ cantSplit: true, children: [
          cell(p(t(c.etichetta, { size: 19 }), { after: 0, line: 252 }), COL2[0]),
          cell(p(t(c.valore, { size: 19, bold: true }), { after: 0, line: 252 }), COL2[1]),
          cell(p(t(c.unita || '', { size: 17, color: C.etichetta }), { after: 0, line: 252 }), COL2[2]),
        ] })));
      if (rows.length) out.push(table(rows, COL2));
      for (const b of ab) if ((b.esame ?? 0) === ei) out.push(...antibiogramma(b));
    });
  });
  // antibiogrammi orfani (esame non trovato)
  for (const b of ab) if (!esami[b.esame ?? 0]) out.push(...antibiogramma(b));
  return out;
}

// Corpo completo (senza intestazione: la mette il template)
function corpoDocumento(dati) {
  const children = [riquadroAnagrafico(dati.anagrafica || {}), spacer(160)];
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
