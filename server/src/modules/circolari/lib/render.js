// Motore di impaginazione delle circolari: produce il DOCX sulla carta intestata Toscana Diagnostica (luglio 2026)
// nel format approvato da Francesco Epifani il 24/10/2026 (fascia CIRCOLARE bicolore, metadati, titolo, "In sintesi",
// corpo giustificato, tabelle con intestazione petrolio e celle centrate, box "Per informazioni" con QR code, firma,
// piè di pagina con protocollo). Stesso impianto in A4 verticale e orizzontale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { getCompany } from '../../../lib/company.js';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign, PageOrientation,
  Header, Footer, PageNumber, LevelFormat, TableLayoutType, HeadingLevel,
} from 'docx';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = (f) => fs.readFileSync(path.join(here, '..', 'assets', f));
const logo = asset('logo.png');
const iMail = asset('icon_mail.png');
const iWeb = asset('icon_web.png');

// Palette del brand (HEX Palette.txt): Dark Teal, Pacific Blue, Jet Black
const TEAL = '1C505E', TEAL_TXT = '1B505F', BLUE = '71B1BD', INK = '01212C', GREY = '666666';
const LIGHT = 'F4F6F8', LIGHT2 = 'EDF5F7', LINE = 'CCCCCC', FONT = 'Arial';
const WP = 9638, WL = 14570;   // larghezza utile in twip: A4 verticale e orizzontale con margini laterali 2 cm

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NOB = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thin = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const THIN = { top: thin, bottom: thin, left: thin, right: thin };
const cellMar = { top: 60, bottom: 60, left: 100, right: 100 };

// Testo pulito: niente trattini lunghi (regola di scrittura TD), spazi normalizzati
const clean = (s) => String(s ?? '').replace(/[—―]/g, ', ').replace(/\s+/g, ' ').trim();

const t = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 21, bold: o.bold, italics: o.italics, color: o.color || INK, characterSpacing: o.spacing, allCaps: o.caps });
const p = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: o.align, spacing: { before: o.before || 0, after: o.after == null ? 120 : o.after, line: o.line || 276 }, keepNext: o.keepNext });
const body = (text, o = {}) => p(t(clean(text), { size: 21, ...o }), { after: 140, align: AlignmentType.JUSTIFIED, ...o });
const spacer = (h = 120) => new Paragraph({ children: [new TextRun({ text: '', size: 10 })], spacing: { before: 0, after: 0, line: h, lineRule: 'exact' } });
// Attenzione: i paragrafi che contengono immagini non devono avere interlinea impostata (LibreOffice non le renderizza)
const imgPar = (img, w, h) => new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: 'png', data: img, transformation: { width: w, height: h } })] });
const cell = (children, w, o = {}) => new TableCell({
  children: Array.isArray(children) ? children : [children],
  width: { size: w, type: WidthType.DXA },
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
  borders: o.borders || NOB,
  margins: o.margins || cellMar,
  verticalAlign: o.valign || VerticalAlign.CENTER,
});
const table = (rows, widths, o = {}) => new Table({ rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: o.borders || NOB });

// ---------- Carta intestata ----------
// Dati societari (ragione sociale, piè di pagina, contatti) dai Dati aziendali della Suite (docs/IMPOSTAZIONI.md): company è
// impostato da renderDocx prima di comporre il documento; config.footer e config.contacts restano come ripiego.
let company = null;
const footerLines = () => (company ? [company.legal_name, ...company.footer_text.split('\n')] : [config.footer.line1, config.footer.line2, config.footer.line3]);
function header(W) {
  const logoW = 5370, cW = 2700, midW = W - logoW - cW;
  const contact = (icon, text) => new Paragraph({ spacing: { before: 0, after: 40 }, children: [new ImageRun({ type: 'png', data: icon, transformation: { width: 11, height: 11 } }), t('   ' + text, { size: 16, color: '1A3C47' })] });
  const [mail, pec, web] = company ? [company.email, company.pec, company.website] : config.contacts;
  return new Header({ children: [
    table([new TableRow({ height: { value: 1250, rule: 'atLeast' }, children: [
      cell(imgPar(logo, 232, 73), logoW, { margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
      cell(new Paragraph({ children: [] }), midW, { margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
      cell([contact(iMail, mail), contact(iMail, pec), contact(iWeb, web)], cW, { margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    ] })], [logoW, midW, cW]),
    new Paragraph({ spacing: { before: 60, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 1 } }, children: [t('', { size: 4 })] }),
  ] });
}

function footer(prot) {
  const f = (text, bold) => t(text, { size: 18, color: TEAL_TXT, bold });
  const num = (child) => new TextRun({ children: [child], font: FONT, size: 18, color: TEAL_TXT });
  return new Footer({ children: [
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 40 }, children: [f(`${prot ? `Circolare ${prot}` : 'Bozza non protocollata'} - Pag. `), num(PageNumber.CURRENT), f(' di '), num(PageNumber.TOTAL_PAGES)] }),
    ...footerLines().map((line, i) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [f(line, i === 0)] })),
  ] });
}

// ---------- Blocchi ----------
function banner(W, c) {
  const lw = Math.round(W * 0.56), rw = W - lw;
  const righe = [c.tipo, c.linea].map(clean).filter(Boolean);
  return table([new TableRow({ children: [
    cell([
      p([t('CIRCOLARE', { size: 44, bold: true, color: 'FFFFFF', spacing: 30 })], { after: 0, line: 240 }),
      ...righe.map((x) => p([t(x, { size: 16, color: 'FFFFFF', caps: true, spacing: 20 })], { after: 0, line: 240 })),
    ], lw, { fill: TEAL, margins: { top: 160, bottom: 160, left: 220, right: 120 } }),
    cell([
      p([t('Protocollo n.', { size: 15, color: 'FFFFFF', caps: true, spacing: 20 })], { after: 20, line: 240, align: AlignmentType.RIGHT }),
      p([t(c.protocollo || 'BOZZA', { size: 30, bold: true, color: 'FFFFFF' })], { after: 40, line: 240, align: AlignmentType.RIGHT }),
      p([t(`${clean(c.luogo)}, ${c.dataTesto}`, { size: 17, color: 'FFFFFF' })], { after: 0, line: 240, align: AlignmentType.RIGHT }),
    ], rw, { fill: BLUE, margins: { top: 160, bottom: 160, left: 120, right: 220 } }),
  ] })], [lw, rw]);
}

function meta(W, rows) {
  const lw = 1900, vw = W - lw;
  const rowB = { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE } };
  return table(rows.map(([k, v]) => new TableRow({ children: [
    cell(p([t(k, { size: 15, bold: true, color: TEAL_TXT, caps: true, spacing: 15 })], { after: 0, line: 240, align: AlignmentType.CENTER }), lw, { borders: rowB, margins: { top: 90, bottom: 90, left: 0, right: 100 } }),
    cell(p([t(clean(v), { size: 20 })], { after: 0, line: 260, align: AlignmentType.JUSTIFIED }), vw, { borders: rowB, margins: { top: 90, bottom: 90, left: 100, right: 0 } }),
  ] })), [lw, vw]);
}

const title = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 160, line: 380 }, children: [t(clean(text), { size: 32, bold: true, color: TEAL })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 240, after: 80, line: 260 }, children: [t(clean(text), { size: 24, bold: true, color: TEAL_TXT })] });

function keybox(W, text) {
  return table([new TableRow({ children: [cell([
    p([t('In sintesi', { size: 15, bold: true, color: TEAL_TXT, caps: true, spacing: 20 })], { after: 60, line: 240 }),
    p([t(clean(text), { size: 21 })], { after: 0, line: 276, align: AlignmentType.JUSTIFIED }),
  ], W, { fill: LIGHT2, borders: { top: noBorder, bottom: noBorder, right: noBorder, left: { style: BorderStyle.SINGLE, size: 36, color: BLUE } }, margins: { top: 140, bottom: 140, left: 220, right: 220 } })] })], [W]);
}

const bullet = (text) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 80, line: 276 }, children: [t(clean(text), { size: 21 })] });

// Larghezze delle colonne proporzionali alla lunghezza massima del contenuto, con un minimo per colonna
function columnWidths(colonne, righe, W) {
  const n = colonne.length;
  const lens = colonne.map((h, i) => Math.max(String(h || '').length, ...righe.map((r) => String(r[i] ?? '').length), 4));
  const capped = lens.map((l) => Math.min(l, 40));
  const tot = capped.reduce((a, b) => a + b, 0);
  const min = Math.min(1400, Math.floor(W / n));
  let widths = capped.map((l) => Math.max(min, Math.floor((W * l) / tot)));
  const diff = W - widths.reduce((a, b) => a + b, 0);
  widths[widths.indexOf(Math.max(...widths))] += diff;
  return widths;
}

function dataTable(W, colonne, righe) {
  const widths = columnWidths(colonne, righe, W);
  const hdr = new TableRow({ tableHeader: true, children: colonne.map((h, i) => cell(p([t(clean(h), { size: 18, bold: true, color: 'FFFFFF' })], { after: 0, line: 240, align: AlignmentType.CENTER }), widths[i], { fill: TEAL_TXT, borders: THIN, margins: { top: 80, bottom: 80, left: 100, right: 100 } })) });
  const rows = righe.map((r, ri) => new TableRow({ cantSplit: true, children: colonne.map((_, i) => cell(p([t(clean(r[i]), { size: 18, bold: i === 0 })], { after: 0, line: 240, align: AlignmentType.CENTER }), widths[i], { fill: ri % 2 ? LIGHT : 'FFFFFF', borders: THIN, margins: { top: 60, bottom: 60, left: 100, right: 100 } })) }));
  return table([hdr, ...rows], widths, { borders: THIN });
}

function closing(W, c, qr) {
  const lw = Math.round(W * 0.5), rw = W - lw;
  const contatti = (c.contatti || []).map(clean).filter(Boolean);
  const left = [p([t('Per informazioni', { size: 15, bold: true, color: TEAL_TXT, caps: true, spacing: 20 })], { after: 60, line: 240 }), ...contatti.map((x) => p([t(x, { size: 19 })], { after: 20, line: 250 }))];
  if (qr) {
    left.push(spacer(100), table([new TableRow({ children: [
      cell(imgPar(qr, 68, 68), 1100, { margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
      cell(p([t('Inquadra il QR code per consultare la versione digitale della circolare e l’archivio aggiornato.', { size: 15, color: GREY, italics: true })], { after: 0, line: 230 }), lw - 1540, { margins: { top: 0, bottom: 0, left: 80, right: 0 } }),
    ] })], [1100, lw - 1540]));
  }
  return table([new TableRow({ children: [
    cell(left, lw, { fill: LIGHT, margins: { top: 160, bottom: 160, left: 220, right: 220 }, valign: VerticalAlign.TOP }),
    cell([
      p([t(clean(c.saluto || 'Cordiali saluti,'), { size: 21 })], { after: 200 }),
      p([t(company ? company.legal_name : config.footer.line1, { size: 21, bold: true, color: TEAL })], { after: 400 }),
      p([t(clean(c.firma_nome), { size: 21, bold: true })], { after: 0, line: 250 }),
      p([t(clean(c.firma_ruolo), { size: 18, color: GREY })], { after: 0, line: 250 }),
    ], rw, { margins: { top: 160, bottom: 160, left: 320, right: 0 }, valign: VerticalAlign.TOP }),
  ] })], [lw, rw]);
}

// Blocchi del corpo: [{type:'titolo',text}, {type:'paragrafo',text}, {type:'elenco',items:[]}, {type:'tabella',colonne:[],righe:[[]]}]
function corpo(W, blocchi) {
  const out = [];
  for (const b of blocchi || []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'titolo' && b.text) out.push(h2(b.text));
    else if (b.type === 'paragrafo' && b.text) out.push(body(b.text));
    else if (b.type === 'elenco' && Array.isArray(b.items)) out.push(...b.items.filter(Boolean).map(bullet));
    else if (b.type === 'tabella' && Array.isArray(b.colonne) && b.colonne.length) { out.push(dataTable(W, b.colonne, Array.isArray(b.righe) ? b.righe : []), spacer(120)); }
  }
  return out;
}

export const hasWideTable = (blocchi, n = config.landscapeColumns) => (blocchi || []).some((b) => b?.type === 'tabella' && (b.colonne || []).length > n);
export function effectiveOrientation(c) {
  if (c.orientamento === 'ORIZZONTALE') return 'ORIZZONTALE';
  if (c.orientamento === 'VERTICALE') return 'VERTICALE';
  return hasWideTable(c.corpo) ? 'ORIZZONTALE' : 'VERTICALE';
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export function dataItaliana(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return String(d || '');
  return `${x.getDate()} ${MESI[x.getMonth()]} ${x.getFullYear()}`;
}

export async function qrPng(url) {
  return QRCode.toBuffer(url, { type: 'png', width: 350, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1C505E', light: '#FFFFFF' } });
}

// c: riga della tabella circolari (campi JSON già parsati). opts.publicUrl: URL del QR (solo se pubblicata)
export async function renderDocx(c, opts = {}) {
  try { company = await getCompany(); } catch { company = null; }
  const orient = effectiveOrientation(c);
  const landscape = orient === 'ORIZZONTALE';
  const W = landscape ? WL : WP;
  const qr = opts.publicUrl ? await qrPng(opts.publicUrl) : null;
  const cc = { ...c, dataTesto: dataItaliana(c.data) };
  const metaRows = [['Destinatari', c.destinatari], ['Oggetto', c.oggetto], ['Decorrenza', c.decorrenza], ['Riferimenti', c.riferimenti]].filter(([, v]) => clean(v));
  const children = [banner(W, cc), spacer(200)];
  if (metaRows.length) children.push(meta(W, metaRows));
  children.push(title(c.titolo));
  if (clean(c.sintesi)) children.push(keybox(W, c.sintesi), spacer(160));
  children.push(...corpo(W, c.corpo));
  children.push(spacer(200), closing(W, cc, qr));

  const doc = new Document({
    creator: company ? company.legal_name : config.footer.line1,
    title: `${c.protocollo ? `Circolare ${c.protocollo}` : 'Bozza di circolare'} - ${clean(c.titolo)}`,
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: TEAL }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true, color: TEAL_TXT }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 280 } }, run: { color: BLUE, bold: true } } }] }] },
    sections: [{
      properties: { page: { size: landscape ? { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE } : { width: 11906, height: 16838 }, margin: { top: 2300, right: 1134, bottom: 2000, left: 1134, header: 708, footer: 600 } } },
      headers: { default: header(W) },
      footers: { default: footer(c.protocollo) },
      children,
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, orientamento: orient };
}
