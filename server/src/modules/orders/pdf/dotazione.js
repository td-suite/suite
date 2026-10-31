// Stampa della Dotazione di avvio di una sede o Legal entity: intestazione aziendale, dati della struttura, elenco del materiale con
// la grafica dell'articolo (stessi disegni di web/src/modules/orders/components/art.jsx, in vettoriale pdfkit), confezioni
// pianificate e consegnate, lotto e scadenza, casella di spunta e firme per ricevuta. Stile delle altre stampe del modulo (pdf/order.js).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itDate } from '../lib/util.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', light: '#EEF4F5', bg: '#F3F6F6' };
const MM = 2.8346;
const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 16 * MM, right: 16 * MM, top: 12 * MM, bottom: 14 * MM };
const W = PAGE.w - M.left - M.right;
const TOP = 36 * MM;
const BOTTOM = PAGE.h - 28 * MM;
const STATO = { NON_PIANIFICATA: 'Non pianificata', PIANIFICATA: 'Pianificata', CONSEGNATA: 'Consegnata (Giacenza 0 registrata)' };

// ---- Grafica degli articoli (viewBox 80x80 come art.jsx) ----
const K = '#01212C';
const ART = {
  tube: (d, c) => { d.roundedRect(26, 14, 28, 12, 3).fillAndStroke(c, K); d.path('M30 26h20v34a10 10 0 0 1-20 0z').fillAndStroke('#fff', K); d.fillOpacity(0.28).path('M33 40h14v20a7 7 0 0 1-14 0z').fill(c).fillOpacity(1); },
  needle: (d, c) => { d.lineWidth(2.4).lineCap('round').moveTo(20, 44).lineTo(44, 20).stroke('#8a949a'); d.lineWidth(1.4).moveTo(44, 20).lineTo(54, 10).stroke('#5B6B70'); d.lineWidth(1.2).path('M26 56l-10 2 2-10 6-6 8 8z').fillAndStroke(c, K); d.path('M36 46l8-8 6 4-10 10z').fillAndStroke('#fff', K); },
  jar: (d, c) => { d.roundedRect(22, 16, 36, 12, 3).fillAndStroke(c, K); d.path('M25 28h30v30a4 4 0 0 1-4 4H29a4 4 0 0 1-4-4z').fillAndStroke('#fff', K); d.fillOpacity(0.25).roundedRect(30, 38, 20, 14, 2).fill(c).fillOpacity(1); },
  swab: (d, c) => { d.roundedRect(24, 12, 32, 54, 6).fillAndStroke('#fff', K); d.roundedRect(31, 12, 18, 10, 3).fillAndStroke(c, K); d.lineWidth(1.6).moveTo(40, 22).lineTo(40, 56).stroke('#8a949a'); d.ellipse(40, 58, 4, 5).fill(c); },
  bag: (d, c) => { d.fillOpacity(0.9).path('M20 16h40v48a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z').fillAndStroke(c, K).fillOpacity(1); d.fillOpacity(0.85).roundedRect(27, 32, 26, 20, 2).fill('#fff').fillOpacity(1); d.lineWidth(1.3).strokeOpacity(0.5).path('M31 38h18M31 43h12').stroke(K).strokeOpacity(1); },
  kit: (d, c) => { d.path('M16 28l24-10 24 10v26L40 64 16 54z').fillAndStroke('#fff', K); d.fillOpacity(0.35).path('M16 28l24 10v26L16 54z').fill(c).fillOpacity(1); d.path('M16 28l24 10 24-10M40 38v26').stroke(K); d.lineWidth(3).moveTo(28, 23).lineTo(52, 33).stroke(c); },
  slide: (d, c) => { d.roundedRect(14, 26, 52, 28, 2).fillAndStroke('#eaf3f6', K); d.fillOpacity(0.7).rect(14, 26, 14, 28).fill(c).fillOpacity(1); d.fillOpacity(0.35).circle(44, 40, 6).fill(c).fillOpacity(1); },
  bottle: (d, c) => { d.fillOpacity(0.6).roundedRect(33, 12, 14, 8, 2).fill(K).fillOpacity(1); d.path('M30 20h20v8c4 3 6 7 6 12v22a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V40c0-5 2-9 6-12z').fillAndStroke('#fff', K); d.fillOpacity(0.5).rect(28, 44, 24, 16).fill(c).fillOpacity(1); },
  doc: (d, c) => { d.path('M22 12h26l12 12v42a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z').fillAndStroke('#fff', K); d.path('M48 12v12h12').fillAndStroke(c, K); d.lineWidth(2.2).lineCap('round').path('M28 34h24M28 42h24M28 50h16').stroke(c === '#FFFAE3' ? C.teal : c); },
};
function drawArt(doc, icon, color, x, y, size) {
  const s = size / 80;
  doc.save();
  doc.translate(x, y).scale(s);
  doc.roundedRect(4, 4, 72, 72, 16).fill(C.bg);
  doc.lineWidth(1.2).lineCap('butt');
  try { (ART[icon] || ART.kit)(doc, color || C.blue); } catch { /* disegno non riuscito: resta il riquadro */ }
  doc.restore();
}

function letterhead(doc, company, titolo) {
  const top = M.top;
  if (company.logo) { try { doc.image(company.logo, M.left, top + 2, { fit: [60 * MM, 18 * MM] }); } catch { /* */ } }
  else { try { doc.image(path.join(ASSETS, 'logo-td.png'), M.left, top + 2, { fit: [60 * MM, 18 * MM] }); } catch { /* */ } }
  const contacts = [company.email, company.pec, company.website].filter(Boolean);
  let y = top + 3;
  doc.font('R').fontSize(8).fillColor(C.teal);
  for (const txt of contacts) { const tw = doc.widthOfString(txt); doc.text(txt, PAGE.w - M.right - tw, y, { lineBreak: false }); y += 12; }
  doc.font('B').fontSize(8.5).fillColor(C.teal).text(titolo, M.left, TOP - 14, { width: W });
  doc.moveTo(M.left, TOP - 3).lineTo(PAGE.w - M.right, TOP - 3).lineWidth(.6).strokeColor(C.blue).stroke();
  const fy = PAGE.h - M.bottom - 20;
  doc.font('B').fontSize(8).fillColor(C.teal).text(company.name || '', M.left, fy, { width: W, align: 'center' });
  doc.font('R').fontSize(7.5).fillColor(C.teal).text(company.letterhead_footer || '', M.left, fy + 10, { width: W, align: 'center', lineGap: 1 });
}
function section(doc, y, title) {
  doc.rect(M.left, y, W, 14).fill(C.teal);
  doc.font('B').fontSize(9).fillColor('#fff').text(title, M.left + 6, y + 3, { width: W - 12 });
  return y + 18;
}
function kv(doc, x, y, w, label, value) {
  doc.font('R').fontSize(7).fillColor(C.grey).text(label, x, y, { width: w });
  doc.font('B').fontSize(9).fillColor(C.jet).text(value || '–', x, y + 9, { width: w - 6, height: 22, ellipsis: true });
}

/** PDF della dotazione: { struttura, load, lines, totali, company } come da routes/dotazione.js (dettaglio). */
export async function buildDotazionePdf({ struttura: s, load, lines, totali, company }) {
  const titolo = `Dotazione di avvio · ${s.name}`;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: titolo, Author: company.name || 'Toscana Diagnostica', Subject: 'Dotazione di avvio', Creator: 'TD Orders Management' } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const newPage = () => { doc.addPage(); letterhead(doc, company, `Ordini e Magazzino · Dotazione di avvio sedi · ${s.code}`); return TOP + 4; };
  let y = newPage();

  doc.font('B').fontSize(16).fillColor(C.jet).text(titolo, M.left, y, { width: W });
  y = doc.y + 2;
  doc.font('R').fontSize(9).fillColor(C.grey).text(`${s.tipologia_name} · ${STATO[s.stato] || s.stato}`, M.left, y);
  y += 18;

  y = section(doc, y, s.origin === 'ORG' ? 'Legal entity destinataria' : 'Sede destinataria');
  const cw = W / 4;
  kv(doc, M.left, y, cw * 2, s.origin === 'ORG' ? 'Legal entity' : 'Sede', s.name); kv(doc, M.left + cw * 2, y, cw, 'Codice', s.code);
  kv(doc, M.left + cw * 3, y, cw, s.origin === 'ORG' ? 'Avvio del rapporto' : 'Data di apertura', itDate(s.opened_at));
  y += 24;
  kv(doc, M.left, y, cw * 2, 'Indirizzo', [s.address, [s.zip, s.city, s.province && `(${s.province})`].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  kv(doc, M.left + cw * 2, y, cw, 'Referente', s.referente); kv(doc, M.left + cw * 3, y, cw, 'Telefono', s.referente_phone || s.phone);
  y += 24;
  kv(doc, M.left, y, cw, 'Articoli', String(totali.articoli)); kv(doc, M.left + cw, y, cw, 'Confezioni pianificate', String(totali.pianificate));
  kv(doc, M.left + cw * 2, y, cw, 'Confezioni consegnate', load?.delivered_at ? String(totali.consegnate) : '–'); kv(doc, M.left + cw * 3, y, cw, 'Giacenza 0', load?.delivered_at ? itDate(load.delivered_at) : 'da registrare');
  y += 24;
  if (load?.note) { kv(doc, M.left, y, W, 'Note', load.note); y += 24; }
  y += 2;

  y = section(doc, y, 'Materiale di avvio (quantità in confezioni)');
  const cols = [
    { k: 'art', t: 'Articolo', w: W - 250, al: 'left' },
    { k: 'pian', t: 'Pianificate', w: 50, al: 'right' },
    { k: 'cons', t: 'Consegnate', w: 50, al: 'right' },
    { k: 'lot', t: 'Lotto', w: 52, al: 'left' },
    { k: 'exp', t: 'Scadenza', w: 52, al: 'left' },
    { k: 'ok', t: 'Ricevuto', w: 46, al: 'center' },
  ];
  const header = () => {
    let x = M.left;
    doc.rect(M.left, y, W, 13).fill(C.light);
    doc.font('B').fontSize(7).fillColor(C.teal);
    for (const c of cols) { doc.text(c.t, x + 3, y + 3.5, { width: c.w - 6, align: c.al, lineBreak: false }); x += c.w; }
    y += 15;
  };
  header();
  let lastCat = null;
  const ICON = 22;
  for (const l of lines) {
    if (l.category_name !== lastCat) {
      if (y > BOTTOM - 50) { y = newPage(); header(); }
      doc.font('B').fontSize(7.5).fillColor(C.teal).text(l.category_name || '', M.left + 3, y + 2); y += 12; lastCat = l.category_name;
    }
    const rowH = ICON + 6;
    if (y + rowH > BOTTOM - 10) { y = newPage(); header(); }
    let x = M.left;
    drawArt(doc, l.icon, l.color, x + 2, y + 3, ICON);
    doc.font('B').fontSize(8).fillColor(C.jet).text(l.article_name, x + ICON + 7, y + 4, { width: cols[0].w - ICON - 10, height: 11, ellipsis: true, lineBreak: false });
    doc.font('R').fontSize(6.8).fillColor(C.grey).text([l.pack_label, l.silva_code || l.article_code, l.note].filter(Boolean).join(' · '), x + ICON + 7, y + 15, { width: cols[0].w - ICON - 10, height: 10, ellipsis: true, lineBreak: false });
    x += cols[0].w;
    const vals = { pian: String(l.packs_planned), cons: l.packs_delivered != null ? String(l.packs_delivered) : '', lot: l.lot || '', exp: l.expiry ? itDate(l.expiry) : '' };
    for (const c of cols.slice(1)) {
      if (c.k === 'ok') { doc.rect(x + c.w / 2 - 5, y + rowH / 2 - 5, 10, 10).lineWidth(.8).strokeColor(C.teal).stroke(); }
      else doc.font(c.k === 'pian' ? 'B' : 'R').fontSize(c.k === 'pian' || c.k === 'cons' ? 9 : 7.5).fillColor(C.jet).text(vals[c.k], x + 3, y + rowH / 2 - 5, { width: c.w - 6, align: c.al, lineBreak: false });
      x += c.w;
    }
    doc.moveTo(M.left, y + rowH).lineTo(PAGE.w - M.right, y + rowH).lineWidth(.3).strokeColor(C.line).stroke();
    y += rowH;
  }
  doc.font('B').fontSize(8.5).fillColor(C.jet).text(`Totale: ${totali.articoli} articoli, ${totali.pianificate} confezioni pianificate${load?.delivered_at ? `, ${totali.consegnate} consegnate` : ''}`, M.left, y + 5, { width: W, align: 'right' });
  y += 24;

  // Firme per ricevuta
  if (y > BOTTOM - 95) y = newPage();
  y = section(doc, y, 'Consegna e firma per ricevuta');
  doc.font('R').fontSize(8).fillColor(C.grey).text('Il materiale sopra elencato costituisce la Giacenza 0 della struttura: le confezioni ricevute entrano nella giacenza del modulo Ordini e Magazzino alla data di consegna.', M.left, y, { width: W });
  y = doc.y + 14;
  const fw = (W - 24) / 3;
  const firma = (x, label, sub) => {
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(label, x, y, { width: fw });
    doc.moveTo(x, y + 34).lineTo(x + fw, y + 34).lineWidth(.6).strokeColor(C.jet).stroke();
    doc.font('R').fontSize(6.8).fillColor(C.grey).text(sub, x, y + 37, { width: fw });
  };
  firma(M.left, 'Data di consegna', load?.delivered_at ? itDate(load.delivered_at) : 'gg/mm/aaaa');
  firma(M.left + fw + 12, 'Consegnato da (Toscana Diagnostica)', 'Nome, cognome e firma');
  firma(M.left + (fw + 12) * 2, 'Ricevuto da (referente della struttura)', 'Nome, cognome e firma');

  // numeri di pagina
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(C.grey).text(`Pagina ${i + 1} di ${range.count}`, M.left, PAGE.h - M.bottom + 4, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
