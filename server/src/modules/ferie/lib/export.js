// Esportazioni del piano ferie per area: XLSX (un foglio per area con persone × giorni dell'anno e lo stato del piano di ciascuno,
// foglio Periodi e foglio Copertura) e PDF (una pagina per area e mese, griglia persone × giorni). PDF con pdfkit e i font
// LiberationSans della Suite. Codici: F ferie approvate, ½ mezza giornata, N nel piano non ancora approvato, A variazione in attesa,
// P permesso ROL.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { giorniTra, isoWeekday, quotaInData } from './calendario.js';
import { STATO_LABEL, itData } from './core.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shipments', 'assets');
const FONT_R = path.join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_B = path.join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', bg: '#F3F7F8', we: '#E6ECEE', fest: '#D4DDE0', chius: '#DCEFF3', ferie: '#1C505E', half: '#71B1BD', attesa: '#E9A23B', rol: '#8E5BA6', red: '#B3261E', piano: '#8FB8C2' };
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const GG = ['', 'L', 'M', 'M', 'G', 'V', 'S', 'D'];
const argb = (hex) => `FF${hex.replace('#', '').toUpperCase()}`;

/** Cella del piano: { quota, stato, tipo } della persona in una data (la richiesta più "forte" vince) */
function cella(assenze, personId, data) {
  let best = null;
  for (const a of assenze) {
    if (a.person_id !== personId) continue;
    const q = a.tipo === 'ROL' ? (data === String(a.data_inizio) ? 0.25 : 0) : quotaInData(a, data);
    if (!q) continue;
    if (!best || q > best.quota || (['RICHIESTA', 'PIANIFICATA'].includes(best.stato) && ['APPROVATA', 'GODUTA'].includes(a.stato))) best = { quota: q, stato: a.stato, tipo: a.tipo };
  }
  return best;
}
const codice = (c) => (!c ? '' : c.tipo === 'ROL' ? 'P' : c.stato === 'RICHIESTA' ? 'A' : c.stato === 'PIANIFICATA' ? 'N' : c.quota < 1 ? '½' : 'F');
const colore = (c) => (c.tipo === 'ROL' ? C.rol : c.stato === 'RICHIESTA' ? C.attesa : c.stato === 'PIANIFICATA' ? C.piano : c.quota < 1 ? C.half : C.ferie);
const inChiusura = (chiusure, d) => chiusure.find((c) => d >= String(c.data_inizio) && d <= String(c.data_fine));

// ------------------------------------------------------------------ XLSX
export async function pianoXlsx(piani, { anno, conDettagli = false } = {}) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD';
  const giorni = giorniTra(`${anno}-01-01`, `${anno}-12-31`);
  const nomi = new Set();
  for (const p of piani) {
    let nome = p.nome.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || 'Area';
    while (nomi.has(nome)) nome = `${nome.slice(0, 25)} ${nomi.size}`;
    nomi.add(nome);
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
    ws.getColumn(1).width = 28; ws.getColumn(2).width = 18; ws.getColumn(3).width = 16;
    ws.getCell(1, 1).value = `Piano ferie ${anno} · ${p.nome}`; ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: argb(C.teal) } };
    ws.getCell(1, 4).value = 'F ferie approvate · ½ mezza giornata · N nel piano da approvare · A variazione in attesa · P permesso ROL · grigio festivo o fine settimana · azzurro chiusura collettiva · rosso sotto la copertura minima';
    ws.getRow(2).getCell(1).value = 'Persona'; ws.getRow(2).getCell(2).value = 'Ruolo'; ws.getRow(2).getCell(3).value = 'Piano';
    const fest = new Map(p.festivi.map((f) => [f.data, f.nome]));
    const scop = new Set(p.scoperture.map((s) => s.data));
    giorni.forEach((d, i) => {
      const col = i + 4;
      ws.getColumn(col).width = 3.2;
      const h = ws.getCell(2, col); h.value = `${d.slice(8, 10)}/${d.slice(5, 7)}`; h.alignment = { textRotation: 90, horizontal: 'center' }; h.font = { size: 8, bold: d.slice(8, 10) === '01' };
      const w = ws.getCell(3, col); w.value = GG[isoWeekday(d)]; w.alignment = { horizontal: 'center' }; w.font = { size: 8 };
      if (scop.has(d)) { h.fill = w.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.red) } }; h.font = w.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } }; }
      else if (fest.has(d)) h.note = fest.get(d);
    });
    ws.getRow(2).height = 34;
    ws.getRow(2).getCell(1).font = ws.getRow(2).getCell(2).font = ws.getRow(2).getCell(3).font = { bold: true };
    let riga = 4;
    for (const persona of p.persone) {
      const row = ws.getRow(riga++);
      row.getCell(1).value = persona.nome; row.getCell(2).value = persona.ruolo || ''; row.getCell(3).value = persona.stato_piano || '';
      giorni.forEach((d, i) => {
        const cell = row.getCell(i + 4);
        const c = cella(p.assenze, persona.id, d);
        const lavoro = (persona.settimana || [1, 2, 3, 4, 5]).includes(isoWeekday(d)) && !fest.has(d);
        const ch = inChiusura(p.chiusure, d);
        if (c) {
          cell.value = codice(c); cell.alignment = { horizontal: 'center' }; cell.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colore(c)) } };
        } else if (!lavoro) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(fest.has(d) ? C.fest : C.we) } };
        else if (ch) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.chius) } };
      });
    }
    if (p.chiusure.length) { riga++; ws.getCell(riga++, 1).value = 'Chiusure collettive'; for (const c of p.chiusure) ws.getCell(riga++, 1).value = `${itData(c.data_inizio)} → ${itData(c.data_fine)} ${c.descrizione || ''}`; }
  }
  // Periodi del piano
  const rs = wb.addWorksheet('Periodi');
  rs.columns = [{ header: 'Area', key: 'area', width: 24 }, { header: 'Persona', key: 'persona', width: 28 }, { header: 'Tipo', key: 'tipo', width: 8 }, { header: 'Dal', key: 'dal', width: 12 }, { header: 'Al', key: 'al', width: 12 },
    { header: 'Mezza giornata', key: 'mezza', width: 22 }, ...(conDettagli ? [{ header: 'Giorni', key: 'giorni', width: 8 }, { header: 'Ore', key: 'ore', width: 8 }, { header: 'Note', key: 'note', width: 40 }] : []), { header: 'Stato', key: 'stato', width: 12 }];
  for (const p of piani) {
    const nomi2 = new Map(p.persone.map((x) => [x.id, x.nome]));
    for (const a of p.assenze) rs.addRow({ area: p.nome, persona: nomi2.get(a.person_id), tipo: a.tipo === 'ROL' ? 'ROL' : 'Ferie', dal: itData(a.data_inizio), al: itData(a.data_fine),
      mezza: [a.mezza_inizio ? 'primo giorno pomeriggio' : '', a.mezza_fine ? 'ultimo giorno mattina' : ''].filter(Boolean).join(', '), giorni: a.giorni, ore: a.ore, note: a.note, stato: STATO_LABEL[a.stato] || a.stato });
  }
  rs.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; rs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.teal) } };
  // Copertura
  const cs = wb.addWorksheet('Copertura');
  cs.columns = [{ header: 'Area', key: 'area', width: 24 }, { header: 'Data', key: 'data', width: 12 }, { header: 'Ruolo', key: 'ruolo', width: 24 }, { header: 'Minimo', key: 'minimo', width: 9 }, { header: 'Presenti', key: 'presenti', width: 9 }];
  for (const p of piani) for (const s of p.scoperture) cs.addRow({ area: p.nome, data: itData(s.data), ruolo: s.ruolo, minimo: s.minimo, presenti: s.presenti });
  if (!piani.some((p) => p.scoperture.length)) cs.addRow({ area: 'Nessun giorno sotto la copertura minima con i periodi del piano' });
  cs.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; cs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.teal) } };
  return wb.xlsx.writeBuffer();
}

// ------------------------------------------------------------------ PDF
export function pianoPdf(piani, { anno, mesi = null, generato = '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, info: { Title: `Piano ferie ${anno}`, Author: 'Suite TD · Toscana Diagnostica' } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
    const W = doc.page.width, H = doc.page.height, M = 28;
    const elencoMesi = mesi || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let prima = true;
    for (const p of piani) {
      const fest = new Map(p.festivi.map((f) => [f.data, f.nome]));
      const scop = new Map(); for (const s of p.scoperture) { if (!scop.has(s.data)) scop.set(s.data, []); scop.get(s.data).push(s); }
      for (const mese of elencoMesi) {
        const mm = String(mese).padStart(2, '0');
        const giorni = giorniTra(`${anno}-${mm}-01`, `${anno}-${mm}-${String(new Date(Date.UTC(anno, mese, 0)).getUTCDate()).padStart(2, '0')}`);
        const nomeW = 175, top = 78, rowH = 15;
        const cellW = (W - 2 * M - nomeW) / giorni.length;
        const perPagina = Math.max(1, Math.floor((H - top - 70) / rowH));
        const blocchi = [];
        for (let i = 0; i < Math.max(1, p.persone.length); i += perPagina) blocchi.push(p.persone.slice(i, i + perPagina));
        blocchi.forEach((persone, bi) => {
          if (!prima) doc.addPage(); prima = false;
          if (LOGO) { try { doc.image(LOGO, M, 20, { fit: [130, 30] }); } catch { /* logo facoltativo */ } }
          doc.font('B').fontSize(14).fillColor(C.teal).text(`Piano ferie · ${p.nome}`, M + (LOGO ? 150 : 0), 22, { width: W - 2 * M - 220 });
          doc.font('R').fontSize(10).fillColor(C.grey).text(`${MESI[mese - 1]} ${anno}${blocchi.length > 1 ? ` · parte ${bi + 1} di ${blocchi.length}` : ''}`, M + (LOGO ? 150 : 0), 41);
          doc.fontSize(8).text(`Generato il ${generato} dalla Suite TD`, W - M - 200, 26, { width: 200, align: 'right' });
          // intestazione dei giorni
          doc.font('B').fontSize(7).fillColor(C.ink).text('Persona', M, top - 14);
          giorni.forEach((d, i) => {
            const x = M + nomeW + i * cellW;
            const sotto = scop.has(d);
            if (sotto) doc.rect(x, top - 22, cellW, 20).fill(C.red);
            else if (fest.has(d) || isoWeekday(d) >= 6) doc.rect(x, top - 22, cellW, 20).fill(C.we);
            doc.fillColor(sotto ? '#FFFFFF' : C.ink).font('B').fontSize(7).text(d.slice(8, 10), x, top - 20, { width: cellW, align: 'center' });
            doc.font('R').fontSize(6).text(GG[isoWeekday(d)], x, top - 11, { width: cellW, align: 'center' });
          });
          persone.forEach((persona, ri) => {
            const y = top + ri * rowH;
            if (ri % 2) doc.rect(M, y, W - 2 * M, rowH).fill(C.bg);
            doc.fillColor(C.ink).font('R').fontSize(7.5).text(`${persona.nome}${persona.stato_piano ? ` · ${persona.stato_piano}` : ''}`, M + 2, y + 4, { width: nomeW - 4, height: rowH, ellipsis: true, lineBreak: false });
            giorni.forEach((d, i) => {
              const x = M + nomeW + i * cellW;
              const lavoro = (persona.settimana || [1, 2, 3, 4, 5]).includes(isoWeekday(d)) && !fest.has(d);
              const c = cella(p.assenze, persona.id, d);
              if (c) {
                const col = colore(c);
                doc.rect(x + 0.5, y + 1.5, cellW - 1, rowH - 3).fill(col);
                doc.fillColor('#FFFFFF').font('B').fontSize(6.5).text(codice(c), x, y + 4.5, { width: cellW, align: 'center' });
              } else if (!lavoro) doc.rect(x + 0.5, y + 1.5, cellW - 1, rowH - 3).fill(fest.has(d) ? C.fest : C.we);
              else if (inChiusura(p.chiusure, d)) doc.rect(x + 0.5, y + 1.5, cellW - 1, rowH - 3).fill(C.chius);
            });
            doc.moveTo(M, y + rowH).lineTo(W - M, y + rowH).lineWidth(0.3).strokeColor(C.line).stroke();
          });
          if (!p.persone.length) doc.fillColor(C.grey).font('R').fontSize(9).text('Nessuna persona in quest\'area.', M, top + 6);
          // legenda e scoperture del mese
          const ly = H - 58;
          const voce = (x, col, t) => { doc.rect(x, ly, 9, 9).fill(col); doc.fillColor(C.ink).font('R').fontSize(7.5).text(t, x + 12, ly + 1); return x + 14 + doc.widthOfString(t) + 10; };
          let lx = M;
          lx = voce(lx, C.ferie, 'F ferie approvate'); lx = voce(lx, C.half, '½ mezza giornata'); lx = voce(lx, C.piano, 'N nel piano da approvare'); lx = voce(lx, C.attesa, 'A variazione in attesa'); lx = voce(lx, C.rol, 'P permesso ROL');
          lx = voce(lx, C.we, 'festivo o riposo'); lx = voce(lx, C.chius, 'chiusura collettiva'); voce(lx, C.red, 'giorno sotto la copertura minima');
          const sMese = p.scoperture.filter((s) => s.data.slice(5, 7) === mm);
          if (sMese.length) doc.fillColor(C.red).font('R').fontSize(7.5).text(`Sotto la copertura minima: ${sMese.slice(0, 12).map((s) => `${s.data.slice(8, 10)}/${mm} ${s.ruolo} ${s.presenti}/${s.minimo}`).join(' · ')}${sMese.length > 12 ? ` e altri ${sMese.length - 12}` : ''}`, M, ly + 16, { width: W - 2 * M });
          const fMese = p.festivi.filter((f) => f.data.slice(5, 7) === mm);
          if (fMese.length) doc.fillColor(C.grey).font('R').fontSize(7).text(`Festivi: ${fMese.map((f) => `${f.data.slice(8, 10)}/${mm} ${f.nome}`).join(' · ')}`, M, ly + 28, { width: W - 2 * M });
        });
      }
    }
    doc.end();
  });
}
