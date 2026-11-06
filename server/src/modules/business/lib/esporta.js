// Business Hub · vista "DB Opportunità": le 49 colonne del file del CEO ricostruite dagli account (dati vivi: fasi, owner, prossime
// azioni e cliente attivo sono quelli registrati nella Suite), più Linea e Cliente attivo. Export della selezione corrente in XLSX
// (exceljs) e in PDF su carta intestata TD (pdfkit, logo e piè di pagina dai Dati aziendali della Suite).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany, companyFooter } from '../../../lib/company.js';
import { COLONNE_DB, LINEE, faseDb, ultimoAvanzamento, giorniDa, inStallo } from './hub.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// Colonne della vista: le 49 del DB (stesse intestazioni) + due della Suite
export const COLONNE_VISTA = [...COLONNE_DB.map((c) => ({ k: c.k, h: c.h, t: c.t })),
  { k: 'linea', h: 'Linea', t: 't', suite: true }, { k: 'cliente_attivo', h: 'Cliente attivo (CEO)', t: 't', suite: true }];

const prima = (raw, h) => { for (const r of Object.values(raw || {})) if (r?.[h] != null && r[h] !== '') return r[h]; return null; };
const unici = (raw, h) => [...new Set(Object.values(raw || {}).map((r) => r?.[h]).filter((v) => v != null && v !== ''))].join(' · ') || null;

/** Account (con org, owner, referenti, contratti firmati) → riga con le chiavi di COLONNE_VISTA */
export function rigaVista(a, soglia, oggi) {
  const raw = a.import_raw?.righe || {};
  const sede0 = (a.sedi || [])[0] || {};
  const ua = ultimoAvanzamento(a.phase_dates);
  const g = giorniDa(ua, oggi);
  const r = {
    _id: a.id, _org: a.organization_id,
    id: Object.keys(raw).join(', ') || null, ragione_sociale: a.org_name, gruppo: a.gruppo, tipologia: a.tipologia, segmento_lab: a.segmento_lab,
    indirizzo: a.org_address || sede0.indirizzo || null, citta: a.citta || sede0.citta || null, prov: a.prov || sede0.prov || null, accreditata_ssr: a.accreditata_ssr, discipline: a.discipline,
    fatturato_struttura: a.fatturato_struttura ?? a.fatturato_struttura_testo ?? null, anno_bilancio: a.anno_bilancio,
    email: [a.org_email, a.org_pec ? `${a.org_pec} (PEC)` : null].filter(Boolean).join(' · ') || null, telefono: a.org_phone || sede0.telefono || null,
    referente: a.referenti || null, modalita_contatto: a.modalita_contatto, fornitore_attuale: a.fornitore_attuale, situazione_fornitore: a.situazione_fornitore,
    contratto_td: a.contratti_firmati > 0 ? 'Sì' : (a.contratto_td || 'No'), listino_riferimento: a.listino_riferimento, priorita: a.priorita, fonte_priorita: a.fonte_priorita,
    in_pipeline: a.fase_corrente >= 1 ? 'Sì' : 'No', cliente_pipeline: prima(raw, 'Cliente Pipeline'), affidabilita_match: unici(raw, 'Affidabilità match'), stato_cartella: a.stato_cartella,
    fase_attuale: faseDb(a.fase_corrente) || '0. Prospect', ultimo_avanzamento: ua, giorni_da_avanzamento: g, alert_stallo: inStallo(a, soglia, oggi) ? 'STALLO' : null,
    prossima_azione: a.prossima_azione, data_prossima_azione: a.data_prossima_azione, owner: a.owner_name,
    sconto_medio: a.sconto_medio, volume_fy_atteso: a.volume_fy_atteso, prezzo_medio_esame: a.prezzo_medio_esame, fatturato_fy_atteso: a.fatturato_fy_atteso,
    fatturato_2026: a.fatturato_2026, fatturato_2027: a.fatturato_2027, alert_riconciliazione: unici(raw, 'Alert riconciliazione DB vs Pipeline'), note: a.note, fonte_censimento: a.fonte_censimento,
    linea: LINEE[a.linea]?.label || a.linea, cliente_attivo: a.cliente_attivo ? `Sì${a.attivo_dal ? ` dal ${a.attivo_dal}` : ''}` : 'No',
  };
  for (let n = 1; n <= 7; n++) r[`fase_${n}`] = a.phase_dates?.[n] || null;
  return r;
}

const itData = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : s);
const fmt = (c, v) => {
  if (v == null || v === '') return '';
  if (c.t === 'd') return itData(v);
  if (c.k === 'sconto_medio' && typeof v === 'number') return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(v * 100)}%`;
  if (c.t === 'n' && typeof v === 'number') return new Intl.NumberFormat('it-IT', { maximumFractionDigits: c.k === 'prezzo_medio_esame' ? 2 : 0, useGrouping: 'always' }).format(v);
  return String(v);
};

export async function xlsxVista(righe, colonne, { titolo, filtri }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD · Business Hub';
  const ws = wb.addWorksheet('DB Opportunità', { views: [{ state: 'frozen', ySplit: 1, xSplit: Math.min(2, colonne.length) }] });
  ws.columns = colonne.map((c) => ({ header: c.h, key: c.k, width: Math.min(48, Math.max(10, c.h.length + 2, ...righe.slice(0, 200).map((r) => String(r[c.k] ?? '').length * 0.9))) }));
  for (const r of righe) {
    ws.addRow(Object.fromEntries(colonne.map((c) => {
      const v = r[c.k];
      if (c.t === 'd' && v && /^\d{4}-\d{2}-\d{2}/.test(v)) return [c.k, new Date(`${String(v).slice(0, 10)}T00:00:00Z`)];
      return [c.k, v ?? null];
    })));
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.alignment = { vertical: 'middle', wrapText: true }; head.height = 30;
  head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; });
  colonne.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.t === 'd') col.numFmt = 'dd/mm/yyyy';
    else if (c.k === 'sconto_medio') col.numFmt = '0.0%';
    else if (['fatturato_struttura', 'fatturato_fy_atteso', 'fatturato_2026', 'fatturato_2027'].includes(c.k)) col.numFmt = '#,##0 "€"';
    else if (c.k === 'prezzo_medio_esame') col.numFmt = '#,##0.00 "€"';
    else if (c.k === 'volume_fy_atteso') col.numFmt = '#,##0';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonne.length } };
  const info = wb.addWorksheet('Selezione');
  info.addRows([[titolo || 'DB Opportunità B2B Laboratorio · Business Hub'], [`Generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`], [`Righe: ${righe.length}`], [`Filtri: ${filtri || 'nessuno'}`],
    ['Fonte: account del Business Hub (dati vivi della Suite) costruiti dal DB Opportunità del CEO; Fase Attuale, Ultimo avanzamento, Giorni e Alert stallo sono ricalcolati.']]);
  info.getColumn(1).width = 120; info.getRow(1).font = { bold: true, size: 13 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function pdfVista(righe, colonne, { titolo, filtri }) {
  const company = await getCompany();
  const molte = colonne.length > 12;
  const size = molte ? 'A3' : 'A4';
  const doc = new PDFDocument({ size, layout: 'landscape', margin: 0, bufferPages: true, info: { Title: titolo || 'DB Opportunità', Author: company.legal_name || 'Toscana Diagnostica', Creator: 'Suite TD · Business Hub' } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width; const H = doc.page.height; const M = 28; const TEAL = '#1C505E'; const LINE = '#C9D9DC';
  const footer = companyFooter(company).replace(/\n/g, ' · ');
  const intestazione = () => {
    try { doc.image(path.join(ASSETS, 'logo-td.png'), M, 18, { height: 26 }); } catch { doc.font('B').fontSize(14).fillColor(TEAL).text(company.legal_name || 'Toscana Diagnostica', M, 22); }
    doc.font('B').fontSize(13).fillColor(TEAL).text(titolo || 'DB Opportunità B2B Laboratorio', M + 170, 20, { width: W - 2 * M - 170, align: 'right' });
    doc.font('R').fontSize(8).fillColor('#5B6B70').text(`${righe.length} righe · ${filtri || 'nessun filtro'} · generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`, M + 170, 37, { width: W - 2 * M - 170, align: 'right' });
    doc.moveTo(M, 52).lineTo(W - M, 52).lineWidth(1.2).strokeColor(TEAL).stroke();
  };
  // Larghezze dal contenuto (testo misurato con il font): date e numeri non vanno mai a capo. Se le colonne scelte non stanno nella
  // pagina, la tabella si divide in blocchi di colonne (ID e ragione sociale ripetuti in ogni blocco) stampati uno dopo l'altro.
  const fs = molte ? 6.6 : 7.8;
  const utile = W - 2 * M;
  const misura = (t, bold) => doc.font(bold ? 'B' : 'R').fontSize(fs).widthOfString(String(t || ''));
  const larghezza = (c) => {
    const parole = Math.max(...c.h.split(/\s+/).map((x) => misura(x, true)));
    const vals = righe.slice(0, 300).map((r) => misura(fmt(c, r[c.k]), c.k === 'ragione_sociale')).sort((a, b) => a - b);
    const p90 = vals.length ? vals[Math.floor(vals.length * 0.9)] : 0;
    const fisso = c.t === 'd' || c.t === 'n' || c.t === 'i';
    return Math.ceil(Math.max(parole, fisso ? (vals.at(-1) || 0) : Math.min(p90, c.k === 'ragione_sociale' ? 150 : 120), fisso ? 0 : 34) + 6);
  };
  const larghe = new Map(colonne.map((c) => [c.k, larghezza(c)]));
  const chiavi = colonne.filter((c) => ['id', 'ragione_sociale'].includes(c.k));
  const resto = colonne.filter((c) => !chiavi.includes(c));
  const baseW = chiavi.reduce((a, c) => a + larghe.get(c.k), 0);
  const blocchi = [];
  let cur = [];
  for (const c of resto) {
    const w = baseW + cur.reduce((a, x) => a + larghe.get(x.k), 0) + larghe.get(c.k);
    if (cur.length && w > utile) { blocchi.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length || !blocchi.length) blocchi.push(cur);
  const top = 60; const bottom = H - 40;
  let y;
  blocchi.forEach((blocco, bi) => {
    const cols = [...chiavi, ...blocco];
    const nat = cols.map((c) => larghe.get(c.k));
    const somma = nat.reduce((a, b) => a + b, 0);
    const larg = nat.map((w) => (w / somma) * utile);   // si allarga fino alla pagina
    const testata = () => {
      if (blocchi.length > 1) { doc.font('B').fontSize(8).fillColor(TEAL).text(`Colonne, parte ${bi + 1} di ${blocchi.length}`, M, y, { lineBreak: false }); y += 12; }
      doc.font('B').fontSize(fs);
      const h = Math.max(...cols.map((c, i) => doc.heightOfString(c.h, { width: larg[i] - 4 }))) + 6;
      doc.rect(M, y, utile, h).fill(TEAL);
      let x = M; cols.forEach((c, i) => { doc.fillColor('#FFFFFF').text(c.h, x + 2, y + 3, { width: larg[i] - 4 }); x += larg[i]; });
      y += h;
    };
    const nuovaPagina = (prima) => { if (!prima) doc.addPage(); intestazione(); y = top; testata(); };
    nuovaPagina(bi === 0);
    righe.forEach((r, ri) => {
      const testi = cols.map((c) => fmt(c, r[c.k]));
      const h = Math.max(...testi.map((t, i) => doc.font(cols[i].k === 'ragione_sociale' ? 'B' : 'R').fontSize(fs).heightOfString(t || ' ', { width: larg[i] - 4 }))) + 4;
      if (y + h > bottom) nuovaPagina(false);
      if (ri % 2) doc.rect(M, y, utile, h).fill('#F3F7F8');
      let x = M; testi.forEach((t, i) => { doc.font(cols[i].k === 'ragione_sociale' ? 'B' : 'R').fontSize(fs).fillColor(r.alert_stallo && cols[i].k === 'alert_stallo' ? '#B3261E' : '#0F2A33').text(t, x + 2, y + 2, { width: larg[i] - 4 }); x += larg[i]; });
      doc.moveTo(M, y + h).lineTo(W - M, y + h).lineWidth(0.3).strokeColor(LINE).stroke();
      y += h;
    });
  });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(TEAL).text(footer, M, H - 28, { width: W - 2 * M - 80, lineBreak: true, height: 20 });
    doc.text(`Pagina ${i + 1} di ${range.count}`, W - M - 80, H - 28, { width: 80, align: 'right' });
  }
  doc.end();
  return done;
}
