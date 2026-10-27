// Esportazione dell'organigramma (unità ad albero + incarichi) in XLSX (ricaricabile dalle Importazioni), PPTX e PDF.
// Le pagine seguono lo schema dell'Allegato 1 TD-SGI-IDL007: una pagina per ogni unità con dipendenti (il nodo in alto, i figli sotto).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany } from './company.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules', 'shipments', 'assets');
const FONT_R = path.join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_B = path.join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const C = { teal: '1C505E', blue: '71B1BD', jet: '01212C', grey: '5B6B70', line: 'C9D9DC', ink: '0F2a33', bg: 'F3F7F8', white: 'FFFFFF' };
const KIND = { DIREZIONE: 'Direzione', AREA: 'Area', SEDE: 'Sede', REPARTO: 'Reparto', FUNZIONE: 'Funzione' };
const HEAD_FILL = { DIREZIONE: C.jet, AREA: 'D9E9EC', SEDE: 'DCEFE9', REPARTO: C.bg, FUNZIONE: C.bg, STAFF: 'EFE3F8' };
const coll = new Intl.Collator('it');

/** Modello comune: albero ordinato e pagine (ogni unità con figli) */
export function buildModel(units) {
  const byId = new Map(units.map((u) => [u.id, { ...u, positions: u.positions || [], children: [] }]));
  const roots = [];
  for (const u of byId.values()) { const p = u.parent_id ? byId.get(u.parent_id) : null; if (p) p.children.push(u); else roots.push(u); }
  const sortKids = (list) => { list.sort((a, b) => (a.sort_order - b.sort_order) || coll.compare(a.name, b.name)); list.forEach((c) => sortKids(c.children)); };
  sortKids(roots);
  const pages = []; const walk = (u, crumbs) => { if (u.children.length) pages.push({ unit: u, crumbs }); u.children.forEach((c) => walk(c, [...crumbs, u.name])); };
  roots.forEach((r) => walk(r, []));
  const flat = []; const dfs = (u, depth) => { flat.push({ u, depth }); u.children.forEach((c) => dfs(c, depth + 1)); }; roots.forEach((r) => dfs(r, 0));
  return { roots, pages, flat };
}
const heads = (u) => u.positions.filter((p) => p.is_head);
const others = (u) => u.positions.filter((p) => !p.is_head);
const today = () => new Date().toLocaleDateString('it-IT');

// ---------------------------------------------------------------- XLSX
export async function orgchartXlsx(units) {
  const co = await getCompany();
  const { flat } = buildModel(units);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD';
  const ws = wb.addWorksheet('Organigramma');
  ws.columns = [
    { header: 'unit', key: 'unit', width: 34 }, { header: 'parent', key: 'parent', width: 30 }, { header: 'branch', key: 'branch', width: 10 }, { header: 'kind', key: 'kind', width: 12 }, { header: 'site_code', key: 'site_code', width: 12 },
    { header: 'role', key: 'role', width: 34 }, { header: 'person', key: 'person', width: 28 }, { header: 'person_email', key: 'person_email', width: 34 }, { header: 'is_head', key: 'is_head', width: 10 }, { header: 'sort_order', key: 'sort_order', width: 10 },
  ];
  for (const { u } of flat) {
    const base = { unit: u.name, parent: u.parent_name || '', branch: u.branch || 'LINEA', kind: u.kind, site_code: u.site_code || '', sort_order: u.sort_order };
    if (!u.positions.length) ws.addRow({ ...base, role: '', person: '', person_email: '', is_head: '' });
    for (const p of u.positions) ws.addRow({ ...base, role: p.role_name || '', person: p.person_name, person_email: p.person_email || '', is_head: p.is_head ? 'SI' : 'NO' });
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FF' + C.white } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.teal } };
  ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:J1';
  // vista leggibile: una riga per incarico
  const w2 = wb.addWorksheet('Incarichi');
  w2.columns = [{ header: 'Persona', key: 'person', width: 28 }, { header: 'Ruolo', key: 'role', width: 34 }, { header: 'Unità', key: 'unit', width: 34 }, { header: 'Tipo', key: 'kind', width: 12 }, { header: 'Dipende da', key: 'parent', width: 30 }, { header: 'Responsabile', key: 'head', width: 13 }];
  const rows = [];
  for (const { u } of flat) for (const p of u.positions) rows.push({ person: p.person_name, role: p.role_name || '', unit: u.name, kind: KIND[u.kind], parent: u.parent_name || '', head: p.is_head ? 'Sì' : '' });
  rows.sort((a, b) => coll.compare(a.person, b.person) || coll.compare(a.unit, b.unit)); rows.forEach((r) => w2.addRow(r));
  w2.getRow(1).font = { bold: true, color: { argb: 'FF' + C.white } }; w2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.teal } }; w2.views = [{ state: 'frozen', ySplit: 1 }]; w2.autoFilter = 'A1:F1';
  const w3 = wb.addWorksheet('Istruzioni'); w3.getColumn(1).width = 110;
  [`Organigramma ${co.name} esportato dalla Suite il ${today()}.`, 'Il foglio "Organigramma" ha le stesse colonne del modello di importazione: modificalo e ricaricalo da Amministrazione > Importazioni > Organigramma.', 'Il foglio "Incarichi" è una vista per persona, in sola lettura.'].forEach((t) => w3.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- layout comune per PPTX e PDF (unità in pollici su 13.33 x 7.5)
function boxLines(u) {
  const h = heads(u); const o = others(u);
  const lines = [];
  for (const p of h) lines.push({ t: p.person_name, b: true }, { t: p.role_name || 'Responsabile', s: true });
  if (!h.length) lines.push({ t: 'Da assegnare', i: true });
  for (const p of o) lines.push({ t: p.role_name || 'Incarico', s: true }, { t: p.person_name, b: false });
  return lines;
}
function layoutPage(page, W, H) {
  const { unit } = page; const staff = unit.children.filter((c) => c.branch === 'STAFF' && !c.children.length); const kids = unit.children.filter((c) => !staff.includes(c));
  const perRow = kids.length <= 5 ? kids.length : Math.ceil(kids.length / Math.ceil(kids.length / 5));
  const rowsN = Math.ceil(kids.length / perRow);
  const gap = 0.25; const bw = Math.min(2.4, (W - 0.8 - gap * (perRow - 1)) / perRow);
  const lineH = 0.17; const headH = 0.42;
  const boxH = (u) => headH + Math.max(1, boxLines(u).length) * lineH + 0.12;
  const rootH = boxH(unit); const rootW = 2.6;
  const top = 1.15;
  const root = { u: unit, x: (W - rootW) / 2, y: top, w: rootW, h: rootH };
  // tecnostruttura: colonna di caselle a destra del vertice, collegate con una linea orizzontale
  const staffBoxes = staff.map((c, i) => ({ u: c, x: root.x + rootW + 0.6, y: top + i * 0.95, w: 2.3, h: Math.min(0.9, boxH(c)), staff: true }));
  const rowH = Math.max(...kids.map(boxH), 0.8);
  const belowStaff = staff.length ? top + staff.length * 0.95 - 0.3 : 0;
  const rootH2 = Math.max(rootH, belowStaff - top);
  const avail = H - (top + rootH2 + 0.55) - 0.45;
  const rowGap = Math.min(0.5, Math.max(0.3, (avail - rowsN * rowH) / Math.max(1, rowsN)));
  const boxes = [];
  kids.forEach((k, i) => {
    const r = Math.floor(i / perRow); const inRow = r === rowsN - 1 ? kids.length - perRow * (rowsN - 1) : perRow;
    const rowW = inRow * bw + (inRow - 1) * gap; const x0 = (W - rowW) / 2;
    boxes.push({ u: k, x: x0 + (i % perRow) * (bw + gap), y: top + rootH2 + 0.55 + r * (rowH + rowGap), w: bw, h: boxH(k), row: r });
  });
  return { root, boxes, rowsN, staffBoxes };
}

// ---------------------------------------------------------------- PPTX
export async function orgchartPptx(units) {
  const co = await getCompany();
  const { pages } = buildModel(units);
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'Suite TD'; pptx.company = co.legal_name; pptx.title = `Organigramma ${co.name}`;
  const W = 13.333, H = 7.5;
  const drawBox = (slide, b) => {
    const fill = b.staff ? HEAD_FILL.STAFF : (HEAD_FILL[b.u.kind] || C.bg); const dark = b.u.kind === 'DIREZIONE';
    slide.addShape(pptx.ShapeType.rect, { x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: C.white }, line: { color: C.line, width: 0.75 }, shadow: { type: 'outer', blur: 3, offset: 1, angle: 90, color: '000000', opacity: 0.12 } });
    slide.addShape(pptx.ShapeType.rect, { x: b.x, y: b.y, w: b.w, h: 0.42, fill: { color: fill }, line: { color: fill, width: 0 } });
    slide.addText([{ text: (b.staff ? 'Tecnostruttura' : KIND[b.u.kind]).toUpperCase(), options: { fontSize: 6.5, color: dark ? 'B9CDD3' : C.grey, breakLine: true } }, { text: b.u.name, options: { fontSize: 9.5, bold: true, color: dark ? C.white : C.ink } }],
      { x: b.x + 0.08, y: b.y, w: b.w - 0.16, h: 0.42, fontFace: 'Calibri', valign: 'middle', margin: 0 });
    const runs = boxLines(b.u).map((l, i, arr) => ({ text: l.t, options: { fontSize: l.s ? 7 : 8.5, bold: Boolean(l.b), italic: Boolean(l.i), color: l.s || l.i ? C.grey : C.ink, breakLine: i < arr.length - 1 } }));
    slide.addText(runs, { x: b.x + 0.08, y: b.y + 0.45, w: b.w - 0.16, h: b.h - 0.5, fontFace: 'Calibri', valign: 'top', margin: 0, lineSpacingMultiple: 0.95 });
  };
  const chrome = (slide, title, sub, n) => {
    slide.background = { color: C.white };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.78, fill: { color: C.jet }, line: { color: C.jet, width: 0 } });
    if (LOGO) slide.addImage({ data: 'image/png;base64,' + LOGO.toString('base64'), x: 0.35, y: 0.17, h: 0.44, w: 1.55 });
    slide.addText(title, { x: 2.1, y: 0.1, w: 8.5, h: 0.38, fontFace: 'Calibri', fontSize: 16, bold: true, color: C.white, margin: 0 });
    slide.addText(sub, { x: 2.1, y: 0.44, w: 8.5, h: 0.28, fontFace: 'Calibri', fontSize: 9.5, color: 'B9CDD3', margin: 0 });
    slide.addText(`Organigramma ${co.name} · agg. ${today()} · Suite TD · ${n}`, { x: 0.35, y: H - 0.38, w: W - 0.7, h: 0.3, fontFace: 'Calibri', fontSize: 8, color: C.grey, align: 'right', margin: 0 });
  };
  if (!pages.length) { const s = pptx.addSlide(); chrome(s, 'Organigramma', 'Nessuna unità con dipendenti', 1); }
  pages.forEach((page, idx) => {
    const slide = pptx.addSlide();
    chrome(slide, page.unit.name, page.crumbs.length ? page.crumbs.join(' › ') : co.name, idx + 1);
    const { root, boxes, staffBoxes } = layoutPage(page, W, H);
    drawBox(slide, root);
    const cx = root.x + root.w / 2; const yBottom = root.y + root.h; const line = { color: C.line, width: 1 };
    staffBoxes.forEach((b) => { slide.addShape(pptx.ShapeType.line, { x: root.x + root.w, y: b.y + 0.21, w: 0.6, h: 0, line }); drawBox(slide, b); });
    const rows = {}; boxes.forEach((b) => { (rows[b.row] ||= []).push(b); });
    Object.values(rows).forEach((rb) => {
      const yBus = rb[0].y - 0.22;
      const xs = rb.map((b) => b.x + b.w / 2);
      slide.addShape(pptx.ShapeType.line, { x: Math.min(...xs, cx), y: yBus, w: Math.max(...xs, cx) - Math.min(...xs, cx), h: 0, line });
      slide.addShape(pptx.ShapeType.line, { x: cx, y: yBottom, w: 0, h: yBus - yBottom, line });
      rb.forEach((b) => { slide.addShape(pptx.ShapeType.line, { x: b.x + b.w / 2, y: yBus, w: 0, h: 0.22, line }); drawBox(slide, b); });
    });
  });
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}

// ---------------------------------------------------------------- PDF (A4 orizzontale, stesse pagine)
export async function orgchartPdf(units) {
  const co = await getCompany();
  const { pages } = buildModel(units);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, info: { Title: `Organigramma ${co.name}`, Author: co.legal_name, Creator: 'Suite TD' } });
  doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B);
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const PW = 841.89, PH = 595.28; const IN = PW / 13.333;   // il layout è calcolato in "pollici" sullo stesso rapporto 16:9 e scalato
  const X = (v) => v * IN, Y = (v) => v * IN * (PH / (7.5 * IN));
  const hex = (h) => '#' + h;
  const drawBox = (b) => {
    const x = X(b.x), y = Y(b.y), w = X(b.w), h = Y(b.h); const dark = b.u.kind === 'DIREZIONE';
    doc.save().roundedRect(x, y, w, h, 4).fillAndStroke(hex(C.white), hex(C.line)).restore();
    doc.save().rect(x, y, w, Y(0.42)).fill(hex(b.staff ? HEAD_FILL.STAFF : (HEAD_FILL[b.u.kind] || C.bg))).restore();
    doc.font('R').fontSize(5.5).fillColor(dark ? '#B9CDD3' : hex(C.grey)).text((b.staff ? 'Tecnostruttura' : KIND[b.u.kind]).toUpperCase(), x + 6, y + 5, { width: w - 12, lineBreak: false });
    doc.font('B').fontSize(8).fillColor(dark ? hex(C.white) : hex(C.ink)).text(b.u.name, x + 6, y + 13, { width: w - 12, height: Y(0.42) - 14, ellipsis: true, lineBreak: false });
    let yy = y + Y(0.42) + 5;
    for (const l of boxLines(b.u)) {
      doc.font(l.b ? 'B' : 'R').fontSize(l.s ? 6 : 7.2).fillColor(l.s || l.i ? hex(C.grey) : hex(C.ink));
      if (l.i) doc.font('R');
      doc.text(l.t, x + 6, yy, { width: w - 12, lineBreak: false, ellipsis: true }); yy += Y(0.17);
    }
  };
  const chrome = (title, sub, n) => {
    doc.addPage();
    doc.rect(0, 0, PW, Y(0.78)).fill(hex(C.jet));
    if (LOGO) { try { doc.image(LOGO, X(0.35), Y(0.17), { fit: [X(1.55), Y(0.44)] }); } catch { /* */ } }
    doc.font('B').fontSize(14).fillColor(hex(C.white)).text(title, X(2.1), Y(0.14), { width: X(8.5), lineBreak: false });
    doc.font('R').fontSize(8.5).fillColor('#B9CDD3').text(sub, X(2.1), Y(0.47), { width: X(8.5), lineBreak: false });
    doc.font('R').fontSize(7).fillColor(hex(C.grey)).text(`Organigramma ${co.name} · agg. ${today()} · Suite TD · ${n}`, X(0.35), PH - Y(0.36), { width: PW - X(0.7), align: 'right', lineBreak: false });
  };
  if (!pages.length) chrome('Organigramma', 'Nessuna unità con dipendenti', 1);
  pages.forEach((page, idx) => {
    chrome(page.unit.name, page.crumbs.length ? page.crumbs.join(' › ') : co.name, idx + 1);
    const { root, boxes, staffBoxes } = layoutPage(page, 13.333, 7.5);
    drawBox(root);
    const cx = X(root.x + root.w / 2); const yBottom = Y(root.y + root.h);
    doc.strokeColor(hex(C.line)).lineWidth(0.8);
    staffBoxes.forEach((b) => { doc.moveTo(X(root.x + root.w), Y(b.y + 0.21)).lineTo(X(b.x), Y(b.y + 0.21)).stroke(); drawBox(b); });
    const rows = {}; boxes.forEach((b) => { (rows[b.row] ||= []).push(b); });
    Object.values(rows).forEach((rb) => {
      const yBus = Y(rb[0].y - 0.22); const xs = rb.map((b) => X(b.x + b.w / 2));
      doc.moveTo(Math.min(...xs, cx), yBus).lineTo(Math.max(...xs, cx), yBus).stroke();
      doc.moveTo(cx, yBottom).lineTo(cx, yBus).stroke();
      rb.forEach((b) => { doc.moveTo(X(b.x + b.w / 2), yBus).lineTo(X(b.x + b.w / 2), Y(b.y)).stroke(); drawBox(b); });
    });
  });
  doc.end();
  return done;
}
