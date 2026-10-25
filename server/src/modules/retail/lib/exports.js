// Esportazioni: Excel (exceljs) e PowerPoint (pptxgenjs) con la palette aziendale
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const C = { teal: '1C505E', blue: '71B1BD', jet: '01212C', silk: 'FFFAE3', mauve: 'DEC0F1', ink: '0F2A33', muted: '5B6F75', line: 'DBE5E7', green: '2F7D5B', red: 'B3372F' };
const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'logo-td.png');

export async function toXlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TD Retail'; wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[*?:\\/\[\]]/g, '-').slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width || Math.max(12, Math.min(48, c.header.length + 4)), style: c.money ? { numFmt: '#,##0.00 €' } : c.int ? { numFmt: '#,##0' } : c.pct ? { numFmt: '0.0%' } : c.date ? { numFmt: 'dd/mm/yyyy' } : {} }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.jet}` } };
    ws.getRow(1).height = 20;
    for (const r of s.rows) ws.addRow(s.columns.map((c) => { const v = r[c.key]; return c.date && v ? new Date(v) : v ?? null; }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    if (s.totals) {
      const tr = ws.addRow(s.columns.map((c, i) => (i === 0 ? 'Totale' : s.totals[c.key] ?? null)));
      tr.font = { bold: true }; tr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F6' } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function slideHeader(pptx, slide, title, subtitle) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: C.jet }, line: { color: C.jet } });
  if (fs.existsSync(LOGO)) slide.addImage({ path: LOGO, x: 0.35, y: 0.18, h: 0.54, w: 2.2 });
  slide.addText(title, { x: 2.8, y: 0.12, w: 9.2, h: 0.45, fontFace: 'Calibri', fontSize: 20, bold: true, color: 'FFFFFF' });
  if (subtitle) slide.addText(subtitle, { x: 2.8, y: 0.52, w: 9.2, h: 0.3, fontFace: 'Calibri', fontSize: 11, color: '9CC4CC' });
  slide.addText('Toscana Diagnostica · Retail · documento interno', { x: 0.35, y: 7.1, w: 8, h: 0.3, fontFace: 'Calibri', fontSize: 9, color: C.muted });
}

const STATUS_LABEL = { DA_INSTALLARE: 'Da installare', INSTALLATO: 'Installato', DA_SOSTITUIRE: 'Da sostituire', RIMOSSO: 'Rimosso', NON_CONFORME: 'Non conforme' };
const STATUS_COLOR = { DA_INSTALLARE: C.muted, INSTALLATO: C.green, DA_SOSTITUIRE: 'B8860B', RIMOSSO: C.muted, NON_CONFORME: C.red };

// Book retail: una sezione per sede con zone, materiali, stato e regole; prima slide di sintesi
export async function bookToPptx({ sites, zones, promo, generatedAt }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'TD Retail'; pptx.company = 'Toscana Diagnostica S.r.l.'; pptx.title = 'Book Retail';
  // Copertina
  const cover = pptx.addSlide();
  cover.background = { color: C.jet };
  if (fs.existsSync(LOGO)) cover.addImage({ path: LOGO, x: 0.8, y: 0.8, h: 0.9, w: 3.6 });
  cover.addText('Book Retail', { x: 0.8, y: 2.6, w: 11, h: 1, fontFace: 'Calibri', fontSize: 44, bold: true, color: 'FFFFFF' });
  cover.addText(sites.length === 1 ? sites[0].name : `${sites.length} sedi del network`, { x: 0.8, y: 3.6, w: 11, h: 0.6, fontFace: 'Calibri', fontSize: 22, color: C.blue });
  cover.addText(`${promo ? `Promozione del mese: ${promo.name} · "${promo.claim || ''}"` : 'Standard espositivo'} · aggiornato al ${generatedAt}`, { x: 0.8, y: 4.3, w: 11.5, h: 0.5, fontFace: 'Calibri', fontSize: 14, color: 'CFE3E7' });
  cover.addText('Ci prendiamo cura del tuo tempo, lì dove ogni minuto conta.', { x: 0.8, y: 6.3, w: 11, h: 0.5, fontFace: 'Calibri', fontSize: 14, italic: true, color: C.silk });
  // Sintesi conformità
  if (sites.length > 1) {
    const s = pptx.addSlide();
    slideHeader(pptx, s, 'Conformità espositiva per sede', 'Materiali installati sul totale previsto dallo standard');
    const rows = [[{ text: 'Sede', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Tipologia', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Materiali', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal }, align: 'right' } }, { text: 'Installati', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal }, align: 'right' } }, { text: 'Conformità', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal }, align: 'right' } }, { text: 'Criticità', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }]];
    for (const site of sites) {
      const tot = site.items.length; const ok = site.items.filter((i) => i.status === 'INSTALLATO').length;
      const pct = tot ? Math.round((ok / tot) * 100) : 0;
      const bad = site.items.filter((i) => ['NON_CONFORME', 'DA_SOSTITUIRE'].includes(i.status)).map((i) => i.material).slice(0, 3).join(', ');
      rows.push([site.name, site.kind_label, { text: String(tot), options: { align: 'right' } }, { text: String(ok), options: { align: 'right' } }, { text: `${pct}%`, options: { align: 'right', bold: true, color: pct >= 90 ? C.green : pct >= 70 ? 'B8860B' : C.red } }, { text: bad || '–', options: { fontSize: 9, color: C.muted } }]);
    }
    s.addTable(rows, { x: 0.4, y: 1.1, w: 12.5, colW: [3.6, 2.2, 1.1, 1.1, 1.2, 3.3], fontFace: 'Calibri', fontSize: 10, border: { type: 'solid', color: C.line, pt: 0.5 }, autoPage: true, autoPageRepeatHeader: true, rowH: 0.3 });
  }
  for (const site of sites) {
    const s = pptx.addSlide();
    slideHeader(pptx, s, site.name, `${site.kind_label} · ${site.address || ''} ${site.city || ''} · Site manager: ${site.manager || 'da definire'}`);
    const tot = site.items.length; const ok = site.items.filter((i) => i.status === 'INSTALLATO').length;
    s.addText([{ text: `${tot ? Math.round((ok / tot) * 100) : 0}%`, options: { fontSize: 28, bold: true, color: C.teal } }, { text: `  conformità (${ok}/${tot} materiali installati)`, options: { fontSize: 12, color: C.muted } }], { x: 0.4, y: 1.0, w: 7, h: 0.6, fontFace: 'Calibri' });
    if (promo) s.addText(`Promo del mese: ${promo.name} · ${promo.claim || ''}`, { x: 7.4, y: 1.05, w: 5.5, h: 0.5, fontFace: 'Calibri', fontSize: 11, color: C.ink, fill: { color: C.silk }, align: 'center', valign: 'middle' });
    const rows = [[{ text: 'Zona', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Materiale', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Formato', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Q.tà', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal }, align: 'right' } }, { text: 'Contenuto esposto', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Regola', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Stato', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }, { text: 'Verifica', options: { bold: true, color: 'FFFFFF', fill: { color: C.teal } } }]];
    for (const z of zones) {
      const items = site.items.filter((i) => i.zone_id === z.id);
      for (const it of items) rows.push([{ text: z.name, options: { bold: true, color: C.teal } }, it.material, it.format || '', { text: String(it.quantity), options: { align: 'right' } }, { text: it.content || '', options: { fontSize: 9 } }, { text: it.rule || '', options: { fontSize: 8, color: C.muted } }, { text: STATUS_LABEL[it.status] || it.status, options: { bold: true, color: STATUS_COLOR[it.status] || C.ink } }, { text: it.checked_at ? `${it.checked_at.split('-').reverse().join('/')}${it.checked_by ? ` · ${it.checked_by}` : ''}` : '–', options: { fontSize: 8, color: C.muted } }]);
    }
    if (rows.length === 1) rows.push([{ text: 'Nessun materiale registrato per questa sede: applica lo standard dalla pagina Esposizione.', options: { colspan: 8, color: C.muted } }]);
    s.addTable(rows, { x: 0.4, y: 1.7, w: 12.5, colW: [1.5, 2.6, 1.2, 0.5, 2.2, 2.4, 1.1, 1.0], fontFace: 'Calibri', fontSize: 9, border: { type: 'solid', color: C.line, pt: 0.5 }, autoPage: true, autoPageRepeatHeader: true, rowH: 0.28, newSlideStartY: 1.0 });
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}

// Calendario promozionale annuale in PPTX (una slide di overview + una per promozione)
export async function promoCalendarToPptx({ year, promotions, products }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'TD Retail'; pptx.company = 'Toscana Diagnostica S.r.l.'; pptx.title = `Calendario promozionale ${year}`;
  const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const ov = pptx.addSlide();
  slideHeader(pptx, ov, `Calendario promozionale ${year}`, 'Una promozione al mese: tema, claim, meccanica, target');
  const cellW = 3.05; const cellH = 1.45;
  for (let m = 0; m < 12; m++) {
    const x = 0.4 + (m % 4) * (cellW + 0.12); const y = 1.1 + Math.floor(m / 4) * (cellH + 0.12);
    const p = promotions.find((q) => q.month === m + 1);
    ov.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: cellH, fill: { color: p ? (p.status === 'ATTIVA' ? C.silk : 'F6FAFB') : 'FFFFFF' }, line: { color: C.line, pt: 0.75 } });
    ov.addText(MONTHS[m].toUpperCase(), { x: x + 0.1, y: y + 0.05, w: cellW - 0.2, h: 0.25, fontFace: 'Calibri', fontSize: 9, bold: true, color: C.teal, charSpacing: 1 });
    if (p) {
      ov.addText(p.name, { x: x + 0.1, y: y + 0.3, w: cellW - 0.2, h: 0.3, fontFace: 'Calibri', fontSize: 12, bold: true, color: C.jet });
      ov.addText(p.claim || '', { x: x + 0.1, y: y + 0.6, w: cellW - 0.2, h: 0.45, fontFace: 'Calibri', fontSize: 10, italic: true, color: C.ink });
      ov.addText(p.discount_label || '', { x: x + 0.1, y: y + 1.05, w: cellW - 0.2, h: 0.3, fontFace: 'Calibri', fontSize: 9, color: C.muted });
    } else ov.addText('da pianificare', { x: x + 0.1, y: y + 0.5, w: cellW - 0.2, h: 0.4, fontFace: 'Calibri', fontSize: 10, color: C.muted, italic: true });
  }
  for (const p of promotions) {
    const s = pptx.addSlide();
    slideHeader(pptx, s, `${MONTHS[p.month - 1]} ${year} · ${p.name}`, `${p.theme || ''} · target: ${p.target || 'adulti'} · stato: ${p.status}`);
    s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.1, w: 12.5, h: 1.3, fill: { color: C.jet }, line: { color: C.jet } });
    s.addText(p.claim || '(claim da definire)', { x: 0.6, y: 1.15, w: 12.1, h: 0.7, fontFace: 'Calibri', fontSize: 26, bold: true, color: 'FFFFFF' });
    s.addText(p.body || '', { x: 0.6, y: 1.85, w: 12.1, h: 0.5, fontFace: 'Calibri', fontSize: 12, color: 'CFE3E7' });
    s.addText('MECCANICA', { x: 0.4, y: 2.6, w: 4, h: 0.3, fontFace: 'Calibri', fontSize: 10, bold: true, color: C.teal });
    s.addText(`${p.discount_label || 'Nessuno sconto'}\nValidità: ${p.start_date ? p.start_date.split('-').reverse().join('/') : ''} – ${p.end_date ? p.end_date.split('-').reverse().join('/') : ''}\nCodice: ${p.promo_code || '–'}\nCanale: ${p.channel_scope}`, { x: 0.4, y: 2.9, w: 4, h: 1.4, fontFace: 'Calibri', fontSize: 11, color: C.ink, valign: 'top' });
    s.addText('PRESTAZIONI', { x: 0.4, y: 4.4, w: 4, h: 0.3, fontFace: 'Calibri', fontSize: 10, bold: true, color: C.teal });
    const prods = (p.product_ids || []).map((id) => products.find((x) => x.id === id)).filter(Boolean);
    s.addText(prods.length ? prods.map((x) => `• ${x.description} (${x.code})`).join('\n') : '–', { x: 0.4, y: 4.7, w: 4, h: 2.2, fontFace: 'Calibri', fontSize: 10, color: C.ink, valign: 'top' });
    s.addText('PIANO DI SPINTA', { x: 4.7, y: 2.6, w: 8.2, h: 0.3, fontFace: 'Calibri', fontSize: 10, bold: true, color: C.teal });
    const rows = [[{ text: 'Canale', options: { bold: true, fill: { color: 'F3F6F6' } } }, { text: 'Azione', options: { bold: true, fill: { color: 'F3F6F6' } } }, { text: 'Quando', options: { bold: true, fill: { color: 'F3F6F6' } } }, { text: 'Owner', options: { bold: true, fill: { color: 'F3F6F6' } } }, { text: 'Fatto', options: { bold: true, fill: { color: 'F3F6F6' } } }]];
    for (const a of p.push_plan || []) rows.push([{ text: a.channel || '', options: { bold: true, color: C.teal } }, a.action || '', a.when ? a.when.split('-').reverse().join('/') : '', a.owner || '', { text: a.done ? '✓' : '', options: { align: 'center', color: C.green, bold: true } }]);
    if (rows.length === 1) rows.push([{ text: 'Nessuna azione pianificata', options: { colspan: 5, color: C.muted } }]);
    s.addTable(rows, { x: 4.7, y: 2.9, w: 8.2, colW: [1.2, 4.1, 1.0, 1.4, 0.5], fontFace: 'Calibri', fontSize: 9, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.26, autoPage: true, newSlideStartY: 1.0 });
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
