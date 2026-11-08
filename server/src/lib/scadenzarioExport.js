// Scadenzario di direzione: esportazioni XLSX (exceljs) e PDF (pdfkit), stessa impaginazione dei rapporti di Finance Management e
// Facility (logo TD, carattere Lato se presente, intestazione con i dati aziendali, piè di pagina con la pagina). Solo le righe già
// calcolate da lib/scadenzario.js e filtrate per l'utente: nessuna cifra aggiunta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany } from './company.js';
import { STATO_LABEL, AREE, itData, raggruppaPerSettimana, riepilogo } from './scadenzario.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', 'modules', 'shipments', 'assets');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const LATO = ['/usr/share/fonts/truetype/lato', '/usr/share/fonts/lato', '/usr/local/share/fonts'];
const findFont = (n, fb) => { for (const d of LATO) { const f = path.join(d, n); if (fs.existsSync(f)) return f; } return fb; };
const FONT_R = findFont('Lato-Regular.ttf', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
const FONT_B = findFont('Lato-Bold.ttf', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
const C = { teal: '#1C505E', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', soft: '#EAF5F7', white: '#FFFFFF', red: '#B3261E', amber: '#A35A00' };
const eur = (v) => (v == null ? '' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }));
const GRAV = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
const filtriTesto = (f) => [`dal ${itData(f.da)} al ${itData(f.a)}`, f.area && `area ${String(f.area).split(',').map((x) => AREE[x] || x).join(', ')}`, f.modulo && `modulo ${f.modulo}`, f.q && `ricerca "${f.q}"`].filter(Boolean).join(' · ');

export async function scadenzarioXlsx({ righe, filtri, fonti, generato }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Cockpit direzionale';
  const ws = wb.addWorksheet('Scadenzario', { views: [{ state: 'frozen', ySplit: 4 }] });
  const rip = riepilogo(righe);
  ws.addRow(['Scadenzario di direzione']).font = { bold: true, size: 13 };
  ws.addRow([`${filtriTesto(filtri)} · generato il ${new Date(generato).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`]);
  ws.addRow([`Scadute ${rip.SCADUTA} · oggi ${rip.OGGI} · entro 7 giorni ${rip.ENTRO_7} · entro 30 giorni ${rip.ENTRO_30} · oltre ${rip.OLTRE}`]);
  const head = ws.addRow(['Settimana', 'Data', 'Stato', 'Gravità', 'Area', 'Modulo', 'Tipo', 'Scadenza', 'Oggetto', 'Importo (EUR)', 'Stima', 'Responsabile', 'Note', 'Collegamento']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; });
  for (const g of raggruppaPerSettimana(righe)) {
    for (const r of g.righe) {
      const row = ws.addRow([g.etichetta, new Date(`${r.data}T12:00:00Z`), STATO_LABEL[r.stato], GRAV[r.gravita], AREE[r.area] || r.area, r.modulo_nome, r.tipo, r.titolo, r.oggetto || '', r.importo, r.stima ? 'sì' : '', r.responsabile || '', r.descrizione || '', r.link || '']);
      row.getCell(2).numFmt = 'dd/mm/yyyy'; row.getCell(10).numFmt = '#,##0.00 €';
      if (r.stato === 'SCADUTA') row.getCell(3).font = { bold: true, color: { argb: 'FFB3261E' } };
    }
  }
  [26, 11, 14, 9, 13, 30, 24, 60, 30, 13, 7, 22, 50, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 14 } };
  const wf = wb.addWorksheet('Fonti');
  wf.addRow(['Fonte', 'Modulo', 'Area', 'Stato', 'Righe', 'Nota', 'Campi letti']).font = { bold: true };
  for (const f of fonti) wf.addRow([f.nome, f.modulo, AREE[f.area] || f.area, f.stato === 'OK' ? 'letta' : f.stato === 'NON_ATTIVO' ? 'non disponibile' : 'errore', f.righe, f.nota || '', f.campi]);
  [40, 12, 12, 16, 8, 50, 90].forEach((w, i) => { wf.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function scadenzarioPdf({ righe, filtri, fonti, generato }) {
  const co = await getCompany();
  const title = 'Scadenzario di direzione';
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: title, Author: co.legal_name || 'Toscana Diagnostica', Creator: 'Suite TD · Cockpit direzionale' } });
  if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
  const W = 841.89, H = 595.28, M = 32;
  const done = new Promise((resolve, reject) => { const ch = []; doc.on('data', (b) => ch.push(b)); doc.on('end', () => resolve(Buffer.concat(ch))); doc.on('error', reject); });
  const addPage = () => {
    doc.addPage();
    const logoW = LOGO ? 22 * 5.13 + 12 : 0;
    if (LOGO) { try { doc.image(LOGO, M, 22, { height: 22 }); } catch { /* logo non leggibile */ } }
    doc.font('B').fontSize(10).fillColor(C.teal).text(co.name || 'Toscana Diagnostica', M + logoW, 22, { width: 260, lineBreak: false });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(co.address_full || '', M + logoW, 35, { width: 260, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(10).fillColor(C.jet).text(title, W / 2, 24, { width: W / 2 - M, align: 'right' });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(filtriTesto(filtri), W / 2, 37, { width: W / 2 - M, align: 'right', lineBreak: false, ellipsis: true });
    doc.moveTo(M, 52).lineTo(W - M, 52).lineWidth(0.8).strokeColor(C.teal).stroke();
    doc.y = 60;
  };
  addPage();
  const rip = riepilogo(righe);
  doc.font('B').fontSize(9).fillColor(C.ink).text(`Scadute ${rip.SCADUTA}   ·   oggi ${rip.OGGI}   ·   entro 7 giorni ${rip.ENTRO_7}   ·   entro 30 giorni ${rip.ENTRO_30}   ·   oltre ${rip.OLTRE}`, M, doc.y);
  doc.moveDown(0.6);
  const widths = [52, 58, 46, 70, 210, 130, 60, 110];
  const scale = (W - 2 * M) / widths.reduce((x, y) => x + y, 0);
  const c = widths.map((w) => w * scale);
  const head = ['Data', 'Stato', 'Gravità', 'Modulo', 'Scadenza', 'Oggetto', 'Importo', 'Responsabile'];
  const row = (cells, { headRow = false, tone = null } = {}) => {
    doc.font(headRow ? 'B' : 'R').fontSize(7);
    const h = Math.max(12, ...cells.map((x, i) => doc.heightOfString(String(x ?? ''), { width: c[i] - 5 }))) + 5;
    if (doc.y + h > H - 40) { addPage(); if (!headRow) row(head, { headRow: true }); }
    let x = M; const y = doc.y;
    cells.forEach((v, i) => {
      if (headRow) doc.rect(x, y, c[i], h).fill(C.teal);
      doc.rect(x, y, c[i], h).lineWidth(0.4).strokeColor(C.line).stroke();
      const col = headRow ? C.white : (i === 1 && tone) ? tone : C.ink;
      doc.fillColor(col).font(headRow || (i === 1 && tone) ? 'B' : 'R').fontSize(7).text(String(v ?? ''), x + 2.5, y + 2.5, { width: c[i] - 5, align: i === 6 ? 'right' : 'left' });
      x += c[i];
    });
    doc.y = y + h;
  };
  if (!righe.length) doc.font('R').fontSize(9).fillColor(C.grey).text('Nessuna scadenza nell\'intervallo con i filtri scelti.', M, doc.y);
  for (const g of raggruppaPerSettimana(righe)) {
    if (doc.y > H - 80) addPage();
    doc.font('B').fontSize(8.5).fillColor(C.teal).text(`${g.etichetta} · ${g.righe.length} ${g.righe.length === 1 ? 'scadenza' : 'scadenze'}`, M, doc.y + 4);
    doc.moveDown(0.3);
    row(head, { headRow: true });
    for (const r of g.righe) {
      row([itData(r.data), STATO_LABEL[r.stato], GRAV[r.gravita], r.modulo_nome, [r.titolo, r.descrizione].filter(Boolean).join('\n'), r.oggetto || '', r.importo != null ? `${r.stima ? '~ ' : ''}${eur(r.importo)}` : '', r.responsabile || ''],
        { tone: r.stato === 'SCADUTA' ? C.red : r.stato === 'OGGI' || r.stato === 'ENTRO_7' ? C.amber : null });
    }
    doc.moveDown(0.4);
  }
  const off = fonti.filter((f) => f.stato !== 'OK');
  if (off.length) {
    if (doc.y > H - 90) addPage();
    doc.moveDown(0.5).font('B').fontSize(8).fillColor(C.ink).text('Fonti non disponibili (nessuna riga, non zero):', M, doc.y);
    for (const f of off) doc.font('R').fontSize(7.5).fillColor(C.grey).text(`${f.nome}: ${f.nota}`, M, doc.y, { width: W - 2 * M });
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(C.grey).text(`Suite TD · Cockpit direzionale · generato il ${new Date(generato).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`, M, H - 24, { width: W - 2 * M - 70, lineBreak: false, ellipsis: true });
    doc.text(`Pagina ${i - range.start + 1} di ${range.count}`, W - M - 70, H - 24, { width: 70, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
