import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
export const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', silk: '#FFFAE3', mauve: '#DEC0F1', grey: '#5B6B70', line: '#C9D9DC', ink: '#0f2a33' };
export const MM = 2.8346;
export const PAGE = { w: 595.28, h: 841.89 };
export const M = { left: 18 * MM, right: 18 * MM, top: 12 * MM, bottom: 14 * MM };
export const W = PAGE.w - M.left - M.right;

export const COMPANY = {
  name: 'Toscana Diagnostica S.r.l.',
  footer: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI). Tel. e Fax: 055776511. Direttore Sanitario: prof. Gian Luigi Taddei.\nP.IVA e C.F.: 07528130482, REA n. FI-709602, Capitale Sociale: € 50.000,00 i.v.',
  email: 'shipments@toscanadiagnostica.it',
  website: 'www.toscanadiagnostica.it',
};
const LOGO = fs.readFileSync(path.join(ASSETS, 'logo-td.png'));

export async function barcode(text, opts = {}) {
  return bwipjs.toBuffer({ bcid: 'code128', text: String(text), scale: 3, height: opts.height || 14, includetext: false, backgroundcolor: 'FFFFFF' });
}

export function newDoc(info) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info: { Author: COMPANY.name, Creator: 'TD Shipments', ...info } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  return doc;
}

export function letterhead(doc, title, subtitle) {
  const top = M.top;
  try { doc.image(LOGO, M.left, top + 2, { fit: [62 * MM, 18 * MM] }); } catch { /* */ }
  doc.font('R').fontSize(8).fillColor(C.teal);
  let y = top + 3;
  for (const txt of [COMPANY.email, COMPANY.website]) { doc.text(txt, PAGE.w - M.right - doc.widthOfString(txt), y, { lineBreak: false }); y += 12; }
  const fy = PAGE.h - M.bottom - 22;
  doc.font('B').fontSize(8).fillColor(C.teal).text(COMPANY.name, M.left, fy, { width: W, align: 'center' });
  doc.font('R').fontSize(7.5).fillColor(C.teal).text(COMPANY.footer, M.left, fy + 10, { width: W, align: 'center', lineGap: 1 });
  if (title) {
    doc.font('B').fontSize(15).fillColor(C.jet).text(title, M.left, top + 26 * MM, { width: W });
    if (subtitle) doc.font('R').fontSize(9.5).fillColor(C.grey).text(subtitle, M.left, top + 26 * MM + 20, { width: W });
    doc.moveTo(M.left, top + 26 * MM + 36).lineTo(PAGE.w - M.right, top + 26 * MM + 36).lineWidth(0.8).strokeColor(C.blue).stroke();
  }
  return top + 26 * MM + 46;
}

export function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export const fmtDate = (d, lang = 'it') => {
  if (!d) return '';
  const s = typeof d === 'string' ? d.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(d));
  const [y, m, dd] = s.split('-');
  return lang === 'en' ? `${dd}/${m}/${y}` : `${dd}/${m}/${y}`;
};
export const money = (n, lang = 'it') => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

// Riquadro con etichetta e testo multilinea
export function box(doc, x, y, w, label, text, opts = {}) {
  const pad = 8;
  doc.font('B').fontSize(7.5).fillColor(C.teal).text(label.toUpperCase(), x + pad, y + 6, { width: w - pad * 2, characterSpacing: .6 });
  const ty = Math.max(y + 18, doc.y + 4);
  doc.font(opts.bold ? 'B' : 'R').fontSize(opts.size || 11).fillColor(C.ink).text(String(text || '').replace(/\\n/g, '\n'), x + pad, ty, { width: w - pad * 2, lineGap: 2 });
  const h = Math.max(opts.minH || 0, doc.y - y + pad);
  doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor(opts.strong ? C.teal : C.line).stroke();
  return h;
}
