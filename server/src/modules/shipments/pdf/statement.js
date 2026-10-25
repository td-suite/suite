// Rendiconto economico mensile (allegato alla fattura verso Endeavor DNA / Affinity)
import { newDoc, letterhead, finish, C, M, W, PAGE, MM, fmtDate, money } from './common.js';

const MONTHS = { it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
const T = {
  it: { title: 'Rendiconto mensile spedizioni', sub: (m, c) => `${m} · ${c}`, cust: 'Cliente', per: 'Periodo', status: 'Stato', st: { OPEN: 'provvisorio', CLOSED: 'chiuso', INVOICED: 'fatturato' }, sum: 'Riepilogo', cols: ['Voce', 'Quantità', 'Prezzo unitario', 'Importo'], samples: 'Campioni spediti a Endeavor DNA (FedEx)', total: 'Totale', ship: 'Dettaglio spedizioni', shipCols: ['Data', 'Riferimento', 'Kit', 'Paziente', 'Modalità', 'Importo'], smp: 'Dettaglio campioni', smpCols: ['Data', 'Riferimento', 'Kit', 'Paziente', 'FedEx AWB', 'Importo'], inv: 'Fattura', vat: 'Importi al netto di IVA, se dovuta.' },
  en: { title: 'Monthly shipments statement', sub: (m, c) => `${m} · ${c}`, cust: 'Customer', per: 'Period', status: 'Status', st: { OPEN: 'provisional', CLOSED: 'closed', INVOICED: 'invoiced' }, sum: 'Summary', cols: ['Item', 'Quantity', 'Unit price', 'Amount'], samples: 'Samples shipped to Endeavor DNA (FedEx)', total: 'Total', ship: 'Shipments detail', shipCols: ['Date', 'Reference', 'Kit', 'Patient', 'Mode', 'Amount'], smp: 'Samples detail', smpCols: ['Date', 'Reference', 'Kit', 'Patient', 'FedEx AWB', 'Amount'], inv: 'Invoice', vat: 'Amounts net of VAT, where applicable.' },
};

export async function statementPdf({ project, month, period, lines, settings, lang = 'it' }) {
  const t = T[lang] || T.it;
  const [yy, mm] = month.split('-');
  const monthLabel = `${MONTHS[lang === 'en' ? 'en' : 'it'][Number(mm) - 1]} ${yy}`;
  const customer = settings.billing_customer || 'Endeavor DNA Laboratories';
  const doc = newDoc({ Title: `${t.title} ${month}`, Subject: t.title });
  doc.addPage();
  let y = letterhead(doc, t.title, t.sub(monthLabel, customer));
  const info = [[t.cust, `${customer}${settings.billing_customer_address ? `, ${settings.billing_customer_address}` : ''}`], [t.per, monthLabel], [t.status, t.st[period?.status || 'OPEN']]];
  if (period?.invoice_ref) info.push([t.inv, `${period.invoice_ref}${period.invoice_date ? ` · ${fmtDate(period.invoice_date, lang)}` : ''}`]);
  doc.font('R').fontSize(9.5).fillColor(C.ink);
  for (const [k, v] of info) { doc.font('B').text(`${k}: `, M.left, y, { continued: true }).font('R').text(v, { width: W }); y = doc.y + 2; }
  y += 8;
  const table = (title, cols, widths, rows, totalRow) => {
    if (y > PAGE.h - 70 * MM) { doc.addPage(); letterhead(doc); y = 45 * MM; }
    doc.font('B').fontSize(7.5).fillColor(C.teal).text(title.toUpperCase(), M.left, y, { characterSpacing: .6 });
    y += 14;
    const row = (vals, bold, fill) => {
      if (y > PAGE.h - 40 * MM) { doc.addPage(); letterhead(doc); y = 45 * MM; }
      if (fill) doc.rect(M.left, y - 3, W, 17).fillColor(fill).fill();
      let x = M.left;
      doc.font(bold ? 'B' : 'R').fontSize(8.8).fillColor(C.ink);
      vals.forEach((v, i) => { const right = i >= vals.length - (title === t.sum ? 3 : 1); doc.text(String(v ?? ''), x + 4, y, { width: widths[i] - 8, lineBreak: false, align: right ? 'right' : 'left' }); x += widths[i]; });
      y += 17;
      doc.moveTo(M.left, y - 4).lineTo(M.left + W, y - 4).lineWidth(0.4).strokeColor(C.line).stroke();
    };
    row(cols, true, '#F3F6F6');
    rows.forEach((r, i) => row(r, false, i % 2 ? '#FAFCFC' : null));
    if (totalRow) row(totalRow, true, '#E8F0F2');
    y += 12;
  };
  const sumRows = lines.byMode.map((m) => [lang === 'en' ? m.name_en : m.name_it, m.n, money(m.unit, lang), money(m.amount, lang)]);
  sumRows.push([t.samples, lines.samples.length, money(lines.sampleUnit, lang), money(lines.totalSamples, lang)]);
  table(t.sum, t.cols, [W - 90 - 100 - 100, 90, 100, 100], sumRows, [t.total, '', '', money(lines.total, lang)]);
  doc.font('R').fontSize(8).fillColor(C.grey).text(t.vat, M.left, y - 8); y += 10;
  table(t.ship, t.shipCols, [60, 80, 90, 120, W - 60 - 80 - 90 - 120 - 60, 60], lines.ship.map((s) => [fmtDate(s.date, lang), s.external_ref || '', s.barcode || '', `${s.patient_last_name} ${s.patient_first_name}`, lang === 'en' ? s.mode_en : s.mode_it, money(s.amount, lang)]), [t.total, '', '', '', '', money(lines.totalShipping, lang)]);
  table(t.smp, t.smpCols, [60, 80, 90, 120, W - 60 - 80 - 90 - 120 - 60, 60], lines.samples.map((s) => [fmtDate(s.date, lang), s.external_ref || '', s.barcode || '', `${s.patient_last_name} ${s.patient_first_name}`, s.awb_number || '', money(s.amount, lang)]), [t.total, '', '', '', '', money(lines.totalSamples, lang)]);
  // numerazione pagine
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(`${i + 1} / ${range.count}`, PAGE.w - M.right - 40, PAGE.h - M.bottom - 2, { width: 40, align: 'right' });
  }
  return finish(doc);
}
