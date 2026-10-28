/* Room Planning · motore di pianificazione e interfaccia struttura.
   Codice portato dalla versione artifact (v8) senza modifiche funzionali: solo import ESM al posto dei globali. */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
// jspdf-autotable v5 non estende più il prototipo: lo ripristiniamo per il codice esistente (doc.autoTable / doc.lastAutoTable)
if (!jsPDF.API.autoTable) jsPDF.API.autoTable = function (opts) { autoTable(this, opts); return this; };

function dl(name, wb) { XLSX.writeFile(wb, name); }
function savePdf(doc, name) { doc.save(name); }

import { DAYS, DAYS_S, DISC, EQUIP, LUNCH, LUNCH_MIN_SHIFT, PRELIEVI, PROFILI_SAN, SHARED_EQUIP, clone, cmp, computePlan, contractMin, coverM, defaultHours, deskLabel, deskReq, dispFromHours, durTxt, emptyDisp, hasLunch, hexRgb, intersectM, isMedP, isPrelievi, m2t, maxDayMin, medDisc, medDiscTxt, mergeM, newPerson, newRoom, newStruttura, prelieviRanges, rangesM, roomExclusive, roomNum, sanRanges, slotsOf, subtractM, sumM, t2m, uid } from '../lib/engine.js';
function aoaSheet(wb, name, aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws['!cols'] = widths.map(w => ({
    wch: w
  }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}
function exportDeskXLSX(str, plan) {
  const wb = XLSX.utils.book_new();
  plan.deskWeeks.forEach((wk, i) => {
    const sfx = plan.deskWeeks.length > 1 ? ' ' + wk.label.replace('Settimana ', 'sett. ') : '';
    const aoa = [['Struttura', str.denominazione], ['Copertura desk accettazione' + (plan.deskWeeks.length > 1 ? ' · ' + wk.label : ''), 'Fabbisogno per turno: ' + deskLabel(plan.desk)], [], ['Giorno', 'Dalle', 'Alle', 'Operatore']];
    aoa[aoa.length - 1].push('Pausa pranzo', 'Ore lavorate');
    wk.deskShifts.forEach(s => aoa.push([DAYS[s.d], m2t(s.s), m2t(s.e), plan.byId[s.personId].nome, s.pausa ? m2t(s.pausa[0]) + '-' + m2t(s.pausa[1]) : '', (s.work != null ? s.work : s.e - s.s - (s.presenza ? LUNCH : 0)) / 60]));
    aoaSheet(wb, 'Copertura Desk' + sfx, aoa, [14, 8, 8, 28, 14, 12]);
    const sh = [['Scoperture' + (plan.deskWeeks.length > 1 ? ' · ' + wk.label : '')], ['Giorno', 'Dalle', 'Alle', 'Operatori mancanti']];
    wk.shortages.forEach(x => sh.push([DAYS[x.d], m2t(x.s), m2t(x.e), x.missing]));
    if (wk.shortages.length === 0) sh.push(['Nessuna scopertura']);
    aoaSheet(wb, 'Scoperture' + sfx, sh, [14, 8, 8, 20]);
  });
  const mh = [['Monte ore settimanale (settimana A)'], ['Operatore', 'Turno', 'Giorni', 'Ore/giorno', 'Riposo', 'Ore a contratto', 'Assegnate al desk', 'Residue', 'Ore sopra il minimo']];
  plan.deskHours.forEach(h => mh.push([h.nome, h.side, h.workDays, h.daily / 60, h.off.map(d => DAYS[d]).join(', '), h.contratto / 60, h.assegnate / 60, h.residue / 60, h.reducible / 60]));
  mh.push(['Fabbisogno desk', plan.deskBalance.need / 60], ['Totale ore a contratto', plan.deskBalance.supply / 60]);
  aoaSheet(wb, 'Monte ore', mh, [28, 16, 18, 12]);
  dl('Desk_' + safeName(str) + '.xlsx', wb);
}
function exportAssXLSX(str, plan) {
  const wb = XLSX.utils.book_new();
  const aoa = [['Struttura', str.denominazione], ['Assegnazione medici agli ambulatori'], [], ['Giorno', 'Dalle', 'Alle', 'Ambulatorio', 'Medico', 'Disciplina', 'Supporto sanitario', 'Durata prestazione (min)', 'Slot']];
  plan.assigns.forEach(a => aoa.push([DAYS[a.d], m2t(a.s), m2t(a.e), plan.byId[a.roomId].nome, plan.byId[a.medId].nome, medDiscTxt(plan.byId[a.medId]), a.sanId ? plan.byId[a.sanId].nome : '', +plan.byId[a.medId].durataPrestazione || '', a.slots != null ? a.slots : '']));
  aoaSheet(wb, 'Riepilogo', aoa, [14, 8, 8, 22, 26, 20, 24]);
  str.ambulatori.forEach(r => {
    const g = roomGrid(str, plan, r);
    const sh = [[r.nome + (r.discipline.length ? ' · ' + r.discipline.join(', ') : ' · polivalente') + (r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : '')], ['', ...g.days.map(d => DAYS[d])]];
    g.rows.forEach(row => sh.push([m2t(row.m), ...row.cells.map(c => c.k === 'prel' ? 'Punto Prelievi' : c.k === 'occ' ? medDiscTxt(plan.byId[c.a.medId]) + ': ' + plan.byId[c.a.medId].nome + (c.a.slots != null ? ' [' + c.a.slots + ' slot]' : '') + (c.a.sanId ? ' (+' + plan.byId[c.a.sanId].nome + ')' : '') : c.k === 'na' ? 'n.d.' : '')]));
    aoaSheet(wb, r.nome.slice(0, 31).replace(/[\\/?*\[\]:]/g, ' '), sh, [8, ...g.days.map(() => 34)]);
  });
  const na = [['Non allocati'], ['Medico', 'Giorno', 'Dalle', 'Alle', 'Motivo']];
  plan.unassigned.forEach(u => na.push([plan.byId[u.medId].nome, DAYS[u.d], m2t(u.s), m2t(u.e), u.reason]));
  if (plan.unassigned.length === 0) na.push(['Tutti i medici sono stati allocati']);
  aoaSheet(wb, 'Non allocati', na, [26, 14, 8, 8, 60]);
  dl('Ambulatori_' + safeName(str) + '.xlsx', wb);
}
function exportFreeXLSX(str, plan) {
  const wb = XLSX.utils.book_new();
  const aoa = [['Struttura', str.denominazione], ['Spazi liberi settimanali (proponibili a nuovi medici)', 'Aggiornato: ' + plan.generated], [], ['Giorno', 'Ambulatorio', 'Dalle', 'Alle', 'Durata', 'Attrezzature presenti']];
  plan.free.forEach(f => aoa.push([DAYS[f.d], plan.byId[f.roomId].nome, m2t(f.s), m2t(f.e), durTxt(f.e - f.s), plan.byId[f.roomId].attrezzature.join(', ')]));
  aoaSheet(wb, 'Riepilogo', aoa, [14, 22, 8, 8, 10, 40]);
  str.ambulatori.forEach(r => {
    const g = roomGrid(str, plan, r);
    const fr = plan.free.filter(f => f.roomId === r.id);
    const sh = [[r.nome + (r.discipline.length ? ' · ' + r.discipline.join(', ') : ' · polivalente') + (r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : '')], ['', ...g.days.map(d => DAYS[d])]];
    g.rows.forEach(row => sh.push([m2t(row.m), ...row.cells.map((c, i) => {
      if (c.k === 'closed') return '';
      if (c.k === 'na') return 'n.d.';
      const f = fr.find(x => x.d === g.days[i] && x.s <= row.m && x.e > row.m);
      return f ? 'LIBERO' : 'occupato';
    })]));
    aoaSheet(wb, r.nome.slice(0, 31).replace(/[\\/?*\[\]:]/g, ' '), sh, [8, ...g.days.map(() => 14)]);
  });
  dl('SpaziLiberi_' + safeName(str) + '.xlsx', wb);
}
const safeName = str => ((str.denominazione || 'struttura') + (str.nomeSede ? '_' + str.nomeSede : '')).replace(/[^\w]+/g, '_');
function loadImg(src) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}
async function mkPdf(str, title, brand) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });
  const [r, g, b] = hexRgb(brand.c.p);
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 297, 4, 'F');
  let tx = 12;
  const lg = str.logo || brand.logo || TD_LOGO;
  if (lg) {
    const im = await loadImg(lg);
    if (im && im.width) {
      const h = 12,
        w = Math.min(55, h * im.width / im.height);
      try {
        const fmt = lg.indexOf('image/png') > -1 ? 'PNG' : 'JPEG';
        doc.addImage(lg, fmt, 12, 9, w, h, undefined, 'FAST');
        tx = 12 + w + 6;
      } catch (e) {}
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(r, g, b);
  doc.text((str.denominazione || 'Struttura') + (str.nomeSede ? ' · ' + str.nomeSede : ''), tx, 14);
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text(title, tx, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text((str.indirizzo || '') + '   ·   Generato il ' + new Date().toLocaleString('it-IT'), tx, 25);
  return doc;
}
function pdfTable(doc, head, body, startY, brand) {
  doc.autoTable({
    head: [head],
    body,
    startY,
    styles: {
      fontSize: 8,
      cellPadding: 1.6
    },
    headStyles: {
      fillColor: hexRgb(brand.c.p),
      fontSize: 8
    },
    alternateRowStyles: {
      fillColor: [246, 249, 250]
    },
    margin: {
      left: 12,
      right: 12
    }
  });
  return doc.lastAutoTable.finalY;
}
async function exportDeskPDF(str, plan, brand) {
  const doc = await mkPdf(str, 'Orario di copertura del desk di accettazione (fabbisogno ' + deskLabel(plan.desk) + ')', brand);
  let y = 32;
  plan.deskWeeks.forEach((wk, i) => {
    if (i > 0) {
      doc.addPage();
      y = 16;
    }
    if (plan.deskWeeks.length > 1) {
      doc.setFontSize(11);
      doc.setTextColor(...hexRgb(brand.c.p));
      doc.text(wk.label + (i === 0 ? ' (turnazione: le settimane si alternano)' : ''), 12, y - 4);
    }
    y = pdfTable(doc, ['Giorno', 'Dalle', 'Alle', 'Operatore', 'Pausa pranzo', 'Ore lavorate'], wk.deskShifts.map(s => [DAYS[s.d], m2t(s.s), m2t(s.e), plan.byId[s.personId].nome, s.pausa ? m2t(s.pausa[0]) + '-' + m2t(s.pausa[1]) : '', durTxt(s.work != null ? s.work : s.e - s.s - (s.presenza ? LUNCH : 0))]), y, brand);
    if (wk.shortages.length) {
      doc.setFontSize(10);
      doc.setTextColor(176, 58, 46);
      doc.text('Scoperture da sanare', 12, y + 8);
      y = pdfTable(doc, ['Giorno', 'Dalle', 'Alle', 'Operatori mancanti'], wk.shortages.map(x => [DAYS[x.d], m2t(x.s), m2t(x.e), String(x.missing)]), y + 11, brand);
    }
  });
  if (plan.deskHours.length) {
    doc.setFontSize(10);
    doc.setTextColor(28, 80, 94);
    doc.text('Monte ore settimanale (fabbisogno ' + durTxt(plan.deskBalance.need) + ' · contratti ' + durTxt(plan.deskBalance.supply) + ')', 12, y + 8);
    pdfTable(doc, ['Operatore', 'Contratto', 'Assegnate', 'Residue'], plan.deskHours.map(h => [h.nome, durTxt(h.contratto), durTxt(h.assegnate), durTxt(h.residue)]), y + 11, brand);
  }
  savePdf(doc, 'Desk_' + safeName(str) + '.pdf');
}
async function exportAssPDF(str, plan, brand) {
  const doc = await mkPdf(str, 'Pianificazione settimanale per ambulatorio', brand);
  let first = true;
  for (const r of str.ambulatori) {
    const g = roomGrid(str, plan, r);
    const ty = first ? 30 : 14;
    if (!first) doc.addPage();
    first = false;
    doc.setFontSize(12);
    doc.setTextColor(...hexRgb(brand.c.p));
    doc.text(r.nome + (r.discipline.length ? ' · ' + r.discipline.join(', ') : ' · polivalente') + (r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : ''), 12, ty);
    const body = g.rows.map(row => [m2t(row.m), ...row.cells.map(c => c.k === 'prel' ? 'Punto Prelievi' : c.k === 'occ' ? medDiscTxt(plan.byId[c.a.medId]) + '\n' + plan.byId[c.a.medId].nome + (c.a.slots != null && c.a.s === row.m ? '\n' + c.a.slots + ' slot' : '') : c.k === 'na' ? 'n.d.' : '')]);
    doc.autoTable({
      head: [['', ...g.days.map(d => DAYS[d])]],
      body,
      startY: ty + 4,
      styles: {
        fontSize: 6.5,
        cellPadding: 0.8,
        minCellHeight: 4.5,
        valign: 'middle'
      },
      headStyles: {
        fillColor: hexRgb(brand.c.p),
        fontSize: 7
      },
      columnStyles: {
        0: {
          cellWidth: 12,
          fontStyle: 'bold'
        }
      },
      margin: {
        left: 12,
        right: 12
      },
      didParseCell: h => {
        if (h.section === 'body' && h.column.index > 0) {
          const v = h.cell.raw;
          if (v && v !== 'n.d.') {
            h.cell.styles.fillColor = [231, 241, 243];
            h.cell.styles.textColor = [1, 33, 44];
          } else if (v === 'n.d.') {
            h.cell.styles.textColor = [180, 190, 195];
          }
        }
      }
    });
  }
  doc.addPage();
  doc.setFontSize(12);
  doc.setTextColor(...hexRgb(brand.c.p));
  doc.text('Riepilogo assegnazioni', 12, 16);
  let y = pdfTable(doc, ['Giorno', 'Dalle', 'Alle', 'Ambulatorio', 'Medico', 'Disciplina', 'Supporto'], plan.assigns.map(a => [DAYS[a.d], m2t(a.s), m2t(a.e), plan.byId[a.roomId].nome, plan.byId[a.medId].nome, medDiscTxt(plan.byId[a.medId]), a.sanId ? plan.byId[a.sanId].nome : '']), 20, brand);
  if (plan.unassigned.length) {
    doc.setFontSize(10);
    doc.setTextColor(176, 58, 46);
    doc.text('Medici non allocati', 12, y + 8);
    pdfTable(doc, ['Medico', 'Giorno', 'Fascia', 'Motivo'], plan.unassigned.map(u => [plan.byId[u.medId].nome, DAYS[u.d], m2t(u.s) + '-' + m2t(u.e), u.reason]), y + 11, brand);
  }
  savePdf(doc, 'Ambulatori_' + safeName(str) + '.pdf');
}
/* Agenda settimanale di un medico: righe = orario, colonne = giorni, celle = ambulatorio */
function medGrid(str, plan, m) {
  const days = [0, 1, 2, 3, 4, 5, 6].filter(d => plan.open[d]);
  const lo = Math.min(...days.map(d => plan.open[d][0])),
    hi = Math.max(...days.map(d => plan.open[d][1]));
  const rows = [];
  for (let t = lo; t < hi; t += 30) {
    const cells = days.map(d => {
      if (!plan.open[d] || t < plan.open[d][0] || t >= plan.open[d][1]) return { k: 'closed' };
      const a = plan.assigns.find(x => x.medId === m.id && x.d === d && x.s <= t && x.e > t);
      if (a) return { k: 'occ', a, start: a.s === t, span: (a.e - a.s) / 30 };
      const u = plan.unassigned.find(x => x.medId === m.id && x.d === d && x.s <= t && x.e > t);
      if (u) return { k: 'un', u, start: u.s === t, span: (u.e - u.s) / 30 };
      const disp = intersectM(rangesM((m.disp || {})[d]), plan.open[d]).some(([x, y]) => x <= t && y >= t + 30);
      return { k: disp ? 'disp' : 'na' };
    });
    rows.push({ m: t, cells });
  }
  return { days, rows, lo, hi };
}
const mediciDi = str => str.personale.filter(p => p.tipo === 'medico' && p.nome.trim()).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
async function exportMedPDF(str, plan, brand, medId) {
  const list = medId ? mediciDi(str).filter(m => m.id === medId) : mediciDi(str);
  if (!list.length) return;
  const doc = await mkPdf(str, medId ? 'Programmazione settimanale · ' + list[0].nome : 'Programmazione settimanale per medico (tutti i medici)', brand);
  let first = true;
  for (const m of list) {
    const g = medGrid(str, plan, m);
    const mine = plan.assigns.filter(a => a.medId === m.id);
    const un = plan.unassigned.filter(u => u.medId === m.id);
    if (!first) doc.addPage();
    const ty = first ? 30 : 14;
    first = false;
    doc.setFontSize(12);
    doc.setTextColor(...hexRgb(brand.c.p));
    doc.text(m.nome + (medDiscTxt(m) ? ' · ' + medDiscTxt(m) : '') + (m.contratto === 'dipendente' ? ' · dipendente' : ' · LP'), 12, ty);
    doc.setFontSize(8);
    doc.setTextColor(80, 90, 95);
    const tot = mine.reduce((t, a) => t + (a.e - a.s), 0), slots = mine.reduce((t, a) => t + (a.slots || 0), 0);
    doc.text(mine.length + ' sessioni · ' + durTxt(tot) + '/settimana' + (slots ? ' · ' + slots + ' slot' : '') + (m.durataPrestazione ? ' · prestazione ' + m.durataPrestazione + "'" : '') + (un.length ? ' · ' + un.length + ' sessioni NON allocate' : '') + (m.note ? ' · ' + m.note : ''), 12, ty + 5);
    const body = g.rows.map(row => [m2t(row.m), ...row.cells.map(c => c.k === 'occ' ? plan.byId[c.a.roomId].nome + (c.a.start ? '\n' + m2t(c.a.s) + '-' + m2t(c.a.e) + (c.a.sanId ? '\n' + plan.byId[c.a.sanId].nome : '') : '') : c.k === 'un' ? 'NON ALLOCATO' : c.k === 'disp' ? 'disp.' : c.k === 'na' ? '' : '')]);
    doc.autoTable({
      head: [['', ...g.days.map(d => DAYS[d])]],
      body,
      startY: ty + 8,
      styles: { fontSize: 6.5, cellPadding: 0.8, minCellHeight: 4.5, valign: 'middle' },
      headStyles: { fillColor: hexRgb(brand.c.p), fontSize: 7 },
      columnStyles: { 0: { cellWidth: 12, fontStyle: 'bold' } },
      margin: { left: 12, right: 12 },
      didParseCell: h => {
        if (h.section === 'body' && h.column.index > 0) {
          const v = h.cell.raw;
          if (v === 'NON ALLOCATO') { h.cell.styles.fillColor = [246, 222, 218]; h.cell.styles.textColor = [176, 58, 46]; }
          else if (v === 'disp.') { h.cell.styles.textColor = [180, 190, 195]; }
          else if (v) { h.cell.styles.fillColor = hexRgb(brand.c.p); h.cell.styles.textColor = [255, 255, 255]; }
        }
      }
    });
    let y = doc.lastAutoTable.finalY + 6;
    if (y > 150) { doc.addPage(); y = 14; }
    doc.setFontSize(10);
    doc.setTextColor(...hexRgb(brand.c.p));
    doc.text('Sessioni della settimana', 12, y);
    y = pdfTable(doc, ['Giorno', 'Dalle', 'Alle', 'Ambulatorio', 'Slot', 'Supporto sanitario', 'Note'], mine.map(a => [DAYS[a.d], m2t(a.s), m2t(a.e), plan.byId[a.roomId].nome, a.slots != null ? String(a.slots) : '', a.sanId ? plan.byId[a.sanId].nome : '', a.partial ? 'allocazione parziale (' + m2t(a.orig[0]) + '-' + m2t(a.orig[1]) + ')' : '']), y + 3, brand);
    if (un.length) {
      if (y > 170) { doc.addPage(); y = 14; }
      doc.setFontSize(10);
      doc.setTextColor(176, 58, 46);
      doc.text('Sessioni non allocate', 12, y + 8);
      pdfTable(doc, ['Giorno', 'Fascia', 'Motivo'], un.map(u => [DAYS[u.d], m2t(u.s) + '-' + m2t(u.e), u.reason]), y + 11, brand);
    }
  }
  savePdf(doc, (medId ? 'Medico_' + list[0].nome.replace(/[^\w]+/g, '_') + '_' : 'Medici_') + safeName(str) + '.pdf');
}
async function exportFreePDF(str, plan, brand) {
  const doc = await mkPdf(str, 'Spazi liberi settimanali proponibili a nuovi medici', brand);
  let first = true;
  for (const r of str.ambulatori) {
    const g = roomGrid(str, plan, r);
    const fr = plan.free.filter(f => f.roomId === r.id);
    const ty = first ? 30 : 14;
    if (!first) doc.addPage();
    first = false;
    doc.setFontSize(12);
    doc.setTextColor(...hexRgb(brand.c.p));
    doc.text(r.nome + (r.discipline.length ? ' · ' + r.discipline.join(', ') : ' · polivalente') + (r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : '') + ' · libero ' + durTxt(fr.reduce((t, f) => t + (f.e - f.s), 0)) + '/settimana', 12, ty);
    const body = g.rows.map(row => [m2t(row.m), ...row.cells.map((c, i) => {
      if (c.k === 'closed') return '';
      if (c.k === 'na') return 'n.d.';
      const f = fr.find(x => x.d === g.days[i] && x.s <= row.m && x.e > row.m);
      return f ? 'LIBERO' : '';
    })]);
    doc.autoTable({
      head: [['', ...g.days.map(d => DAYS[d])]],
      body,
      startY: ty + 4,
      styles: {
        fontSize: 6.5,
        cellPadding: 0.8,
        minCellHeight: 4.5,
        valign: 'middle',
        halign: 'center'
      },
      headStyles: {
        fillColor: hexRgb(brand.c.p),
        fontSize: 7
      },
      columnStyles: {
        0: {
          cellWidth: 12,
          fontStyle: 'bold'
        }
      },
      margin: {
        left: 12,
        right: 12
      },
      didParseCell: h => {
        if (h.section === 'body' && h.column.index > 0) {
          const v = h.cell.raw;
          if (v === 'LIBERO') {
            h.cell.styles.fillColor = [227, 241, 233];
            h.cell.styles.textColor = [29, 107, 65];
          } else if (v === 'n.d.') {
            h.cell.styles.textColor = [180, 190, 195];
          } else {
            h.cell.styles.fillColor = [223, 230, 232];
          }
        }
      }
    });
  }
  doc.addPage();
  doc.setFontSize(12);
  doc.setTextColor(...hexRgb(brand.c.p));
  doc.text('Riepilogo fasce libere', 12, 16);
  pdfTable(doc, ['Giorno', 'Ambulatorio', 'Dalle', 'Alle', 'Durata', 'Attrezzature presenti'], plan.free.map(f => [DAYS[f.d], plan.byId[f.roomId].nome, m2t(f.s), m2t(f.e), durTxt(f.e - f.s), plan.byId[f.roomId].attrezzature.join(', ')]), 20, brand);
  savePdf(doc, 'SpaziLiberi_' + safeName(str) + '.pdf');
}
function Field({
  l,
  children,
  style
}) {
  return React.createElement("div", {
    style: style
  }, React.createElement("label", null, l), children);
}
function TagInput({
  value,
  onChange,
  suggestions,
  placeholder
}) {
  const [txt, setTxt] = useState('');
  const listId = useRef('dl' + uid()).current;
  const add = v => {
    const t = v.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setTxt('');
  };
  return React.createElement("div", null, React.createElement("div", null, value.map(v => React.createElement("span", {
    className: "pill",
    key: v
  }, v, React.createElement("button", {
    onClick: () => onChange(value.filter(x => x !== v)),
    "aria-label": 'rimuovi ' + v
  }, "×")))), React.createElement("input", {
    list: listId,
    value: txt,
    placeholder: placeholder || 'Scrivi e premi Invio',
    onChange: e => setTxt(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add(txt);
      }
    },
    onBlur: () => txt && add(txt),
    style: {
      marginTop: 6
    }
  }), suggestions && React.createElement("datalist", {
    id: listId
  }, suggestions.map(s => React.createElement("option", {
    key: s,
    value: s
  }))));
}
function AvailabilityEditor({
  value,
  onChange,
  hours
}) {
  const upd = (d, fn) => {
    const v = clone(value);
    fn(v[d] = v[d] || []);
    onChange(v);
  };
  return React.createElement("div", null, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 6
    }
  }, React.createElement("button", {
    className: "btn sm",
    onClick: () => onChange(dispFromHours(hours))
  }, "Copia orari di apertura"), React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => onChange(emptyDisp())
  }, "Azzera")), DAYS.map((dn, d) => React.createElement("div", {
    className: "avrow",
    key: d
  }, React.createElement("div", {
    className: "dn"
  }, DAYS_S[d]), React.createElement("div", null, (value[d] || []).map((r, i) => React.createElement("span", {
    className: "rng",
    key: i
  }, React.createElement("input", {
    type: "time",
    step: "1800",
    value: r.from,
    onChange: e => upd(d, l => l[i].from = e.target.value),
    "aria-label": dn + ' dalle'
  }), React.createElement("span", {
    className: "mono"
  }, "→"), React.createElement("input", {
    type: "time",
    step: "1800",
    value: r.to,
    onChange: e => upd(d, l => l[i].to = e.target.value),
    "aria-label": dn + ' alle'
  }), React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => upd(d, l => l.splice(i, 1)),
    "aria-label": "rimuovi fascia"
  }, "×"))), React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => upd(d, l => l.push({
      from: hours[d].closed ? '08:00' : hours[d].open,
      to: hours[d].closed ? '13:00' : hours[d].close
    }))
  }, "+ fascia")))));
}
function ChipPicker({
  value,
  onChange,
  options,
  extra,
  onExtraChange,
  addLabel
}) {
  const [txt, setTxt] = useState('');
  const listId = useRef('cl' + uid()).current;
  const all = [...options, ...(extra || []).filter(x => !options.includes(x)), ...value.filter(x => !options.includes(x) && !(extra || []).includes(x))];
  const tog = e => onChange(value.includes(e) ? value.filter(x => x !== e) : [...value, e]);
  const add = () => {
    const t = txt.trim();
    if (!t) return;
    const hit = all.find(x => x.toLowerCase() === t.toLowerCase());
    const name = hit || t;
    if (!hit && onExtraChange) onExtraChange([...(extra || []), name]);
    if (!value.includes(name)) onChange([...value, name]);
    setTxt('');
  };
  return React.createElement("div", {
    className: "chips"
  }, all.map(e => React.createElement("span", {
    key: e,
    className: 'chip' + (value.includes(e) ? ' on' : ''),
    role: "checkbox",
    "aria-checked": value.includes(e),
    tabIndex: "0",
    onClick: () => tog(e),
    onKeyDown: ev => {
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        tog(e);
      }
    }
  }, e, !options.includes(e) && onExtraChange && React.createElement("button", {
    className: "rm",
    title: "Rimuovi dall'elenco",
    onClick: ev => {
      ev.stopPropagation();
      if (confirm('Rimuovere "' + e + '" dall\'elenco delle specialità?')) onExtraChange(extra.filter(x => x !== e));
    }
  }, "×"))), React.createElement("span", {
    className: "chipadd"
  }, React.createElement("input", {
    list: listId,
    value: txt,
    placeholder: addLabel || '+ aggiungi…',
    onChange: e => setTxt(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    },
    onBlur: () => txt && add()
  }), React.createElement("datalist", {
    id: listId
  }, all.filter(x => !value.includes(x)).map(x => React.createElement("option", {
    key: x,
    value: x
  })))));
}
function EquipPicker({
  value,
  onChange,
  options
}) {
  const tog = e => onChange(value.includes(e) ? value.filter(x => x !== e) : [...value, e]);
  return React.createElement("div", {
    className: "eqgrid"
  }, options.map(e => React.createElement("label", {
    key: e,
    className: value.includes(e) ? 'on' : ''
  }, React.createElement("input", {
    type: "checkbox",
    checked: value.includes(e),
    onChange: () => tog(e)
  }), e)));
}
function FileBtn({
  label,
  accept,
  onData
}) {
  const ref = useRef();
  return React.createElement("span", null, React.createElement("button", {
    className: "btn sm",
    onClick: () => ref.current.click()
  }, label), React.createElement("input", {
    ref: ref,
    type: "file",
    accept: accept,
    style: {
      display: 'none'
    },
    onChange: e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => onData(rd.result, f);
      rd.readAsDataURL(f);
      e.target.value = '';
    }
  }));
}
async function pdfToImg(dataUrl) {
  try {
    if (!pdfjsLib || !dataUrl) return null;
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({
      data: arr
    }).promise;
    const page = await pdf.getPage(1);
    const vp0 = page.getViewport({
      scale: 1
    });
    const scale = Math.min(2, 1600 / vp0.width);
    const vp = page.getViewport({
      scale
    });
    const cv = document.createElement('canvas');
    cv.width = vp.width;
    cv.height = vp.height;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({
      canvasContext: ctx,
      viewport: vp
    }).promise;
    return cv.toDataURL('image/jpeg', 0.82);
  } catch (e) {
    console.warn('conversione planimetria in immagine non riuscita', e);
    return null;
  }
}
function PlanCanvas({
  str,
  mode,
  selRoom,
  onPlace,
  statusFn
}) {
  const cvRef = useRef(),
    wrapRef = useRef();
  const [dims, setDims] = useState({
    w: 900,
    h: 560
  });
  const hasImg = !!(str.plan && str.plan.imgUrl);
  const hasPdf = !!(str.plan && str.plan.dataUrl);
  const hasPlan = hasImg || hasPdf;
  useEffect(() => {
    let dead = false;
    const cv = cvRef.current;
    if (!cv) return;
    const W = Math.max(420, Math.min(940, (wrapRef.current && wrapRef.current.parentElement.clientWidth || 940) - (mode === 'view' ? 330 : 0)));
    if (hasImg) {
      const im = new Image();
      im.onload = () => {
        if (dead) return;
        const sc = W / im.width,
          H = Math.round(im.height * sc);
        cv.width = W;
        cv.height = H;
        cv.getContext('2d').drawImage(im, 0, 0, W, H);
        setDims({
          w: W,
          h: H
        });
      };
      im.onerror = () => {
        if (dead) return;
        drawFallback(cv, str, W);
        setDims({
          w: W,
          h: Math.max(320, 120 * Math.ceil(str.ambulatori.length / 3))
        });
      };
      im.src = str.plan.imgUrl;
    } else if (hasPdf && pdfjsLib) {
      const b64 = str.plan.dataUrl.split(',')[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      pdfjsLib.getDocument({
        data: arr
      }).promise.then(pdf => pdf.getPage(1)).then(page => {
        if (dead) return;
        const vp0 = page.getViewport({
          scale: 1
        });
        const scale = W / vp0.width;
        const vp = page.getViewport({
          scale
        });
        cv.width = vp.width;
        cv.height = vp.height;
        setDims({
          w: vp.width,
          h: vp.height
        });
        return page.render({
          canvasContext: cv.getContext('2d'),
          viewport: vp
        }).promise;
      }).catch(() => {
        drawFallback(cv, str, W);
        setDims({
          w: W,
          h: Math.max(320, 120 * Math.ceil(str.ambulatori.length / 3))
        });
      });
    } else {
      const H = Math.max(320, 140 * Math.max(1, Math.ceil(str.ambulatori.length / 3)));
      cv.width = W;
      cv.height = H;
      drawFallback(cv, str, W);
      setDims({
        w: W,
        h: H
      });
    }
    return () => {
      dead = true;
    };
  }, [str.plan && str.plan.dataUrl, str.plan && str.plan.imgUrl, str.ambulatori.length, mode]);
  const pos = r => {
    if (hasPlan) {
      const mk = str.plan.markers[r.id];
      return mk ? {
        x: mk.x * dims.w,
        y: mk.y * dims.h
      } : null;
    }
    const i = str.ambulatori.findIndex(x => x.id === r.id);
    const cols = 3,
      cw = dims.w / cols,
      ch = 140;
    return {
      x: i % cols * cw + cw / 2,
      y: Math.floor(i / cols) * ch + ch / 2
    };
  };
  const [hl, setHl] = useState(null);
  const colorOf = st => st.state === 'occ' ? 'var(--p)' : st.state === 'free' ? 'var(--amber)' : st.state === 'na' ? '#8CA2AA' : 'var(--teal)';
  const statuses = {};
  str.ambulatori.forEach(r => statuses[r.id] = statusFn ? statusFn(r.id) : {
    state: 'idle'
  });
  return React.createElement("div", {
    className: "planrow"
  }, React.createElement("div", {
    className: "planwrap",
    ref: wrapRef,
    style: {
      cursor: mode === 'edit' && selRoom ? 'crosshair' : 'default'
    },
    onClick: e => {
      if (mode !== 'edit' || !selRoom || !hasPlan) return;
      const rect = cvRef.current.getBoundingClientRect();
      onPlace(selRoom, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    }
  }, React.createElement("canvas", {
    ref: cvRef,
    role: "img",
    "aria-label": "Planimetria della struttura"
  }), str.ambulatori.map(r => {
    const p = pos(r);
    if (!p) return null;
    const st = statuses[r.id];
    const scale = cvRef.current && cvRef.current.getBoundingClientRect().width / dims.w || 1;
    const tip = r.nome + (st.state === 'occ' ? ' · ' + (st.spec ? st.spec + ': ' : '') + st.label + (st.time ? ' (' + st.time + ')' : '') : st.state === 'free' ? ' · libero' : st.state === 'na' ? ' · non disponibile' : '');
    return React.createElement("div", {
      key: r.id,
      className: 'badge' + (st.state === 'free' ? ' free' : '') + (hl === r.id ? ' hl' : ''),
      title: tip,
      onMouseEnter: () => setHl(r.id),
      onMouseLeave: () => setHl(null),
      style: {
        left: p.x * scale,
        top: p.y * scale,
        background: colorOf(st),
        outline: mode === 'edit' && selRoom === r.id ? '3px solid var(--p2)' : 'none'
      }
    }, roomNum(r));
  })), mode === 'view' && React.createElement("div", {
    className: "planlegend"
  }, str.ambulatori.map(r => {
    const st = statuses[r.id];
    const placed = !!pos(r);
    return React.createElement("div", {
      key: r.id,
      className: 'it' + (hl === r.id ? ' hl' : ''),
      onMouseEnter: () => setHl(r.id),
      onMouseLeave: () => setHl(null)
    }, React.createElement("span", {
      className: "nb",
      style: {
        background: colorOf(st),
        color: st.state === 'free' ? '#01212C' : '#fff'
      }
    }, roomNum(r)), React.createElement("div", {
      className: "tx"
    }, React.createElement("b", null, r.nome, !placed && React.createElement("span", {
      className: "mut"
    }, " · non posizionato")), st.state === 'occ' ? React.createElement("span", null, React.createElement("span", {
      className: "who"
    }, st.label), st.spec ? ' · ' + st.spec : '', st.time ? React.createElement("span", {
      className: "mut"
    }, " · ", st.time) : null, st.san ? React.createElement("span", {
      className: "mut"
    }, " · supporto ", st.san) : null) : st.state === 'free' ? React.createElement("span", {
      className: "mut"
    }, "libero", r.discipline.length ? ' · ' + r.discipline.join(', ') : ' · polivalente') : st.state === 'na' ? React.createElement("span", {
      className: "mut"
    }, "non disponibile") : React.createElement("span", {
      className: "mut"
    }, r.discipline.length ? r.discipline.join(', ') : 'polivalente')));
  })));
}
function drawFallback(cv, str, W) {
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FBFDFD';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const cols = 3,
    cw = W / cols,
    ch = 140;
  str.ambulatori.forEach((r, i) => {
    const x = i % cols * cw + 14,
      y = Math.floor(i / cols) * ch + 14;
    ctx.fillStyle = '#EFF5F6';
    ctx.strokeStyle = '#C6D6DB';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, cw - 28, ch - 28, 10);
    ctx.fill();
    ctx.stroke();
    if (r.wc) {
      ctx.fillStyle = '#DCE9EC';
      roundRect(ctx, x + cw - 70, y + 8, 32, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#5A7078';
      ctx.font = '10px IBM Plex Mono';
      ctx.fillText('WC', x + cw - 62, y + 25);
    }
    ctx.fillStyle = '#1C505E';
    ctx.font = '700 13px Archivo';
    ctx.fillText(r.nome, x + 12, y + 24);
    ctx.fillStyle = '#5A7078';
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText((r.mq ? r.mq + ' mq' : '') + (r.attrezzature.length ? '  ·  ' + r.attrezzature.slice(0, 2).join(', ') : ''), x + 10, y + ch - 42);
  });
  if (!str.ambulatori.length) {
    ctx.fillStyle = '#8CA2AA';
    ctx.font = '13px IBM Plex Sans';
    ctx.fillText('Aggiungi gli ambulatori oppure carica la planimetria PDF', 20, 40);
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function Anagrafica({
  str,
  upd
}) {
  const set = p => upd(s => Object.assign(s, p));
  const n = t => str.personale.filter(p => p.tipo === t).length;
  // Denominazione, indirizzo, contatti e site manager vengono dall'anagrafica unica della Suite (public.sites): qui in sola lettura
  const ro = (l, v, placeholder) => React.createElement(Field, {
    l
  }, React.createElement("input", {
    value: v || '',
    readOnly: true,
    placeholder: placeholder || 'da inserire in Amministrazione',
    title: "Dato dell'anagrafica unica: si modifica in Amministrazione > Sedi",
    style: {
      background: 'var(--teal-050, #eef5f6)',
      cursor: 'default'
    }
  }));
  return React.createElement("div", null, React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "rowline",
    style: {
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, React.createElement("h3", null, "Dati generali"), React.createElement("span", {
    className: "small muted"
  }, "Denominazione, indirizzo e contatti sono dell'anagrafica unica della Suite: ", React.createElement("a", {
    href: "/admin/sites"
  }, "Apri in Amministrazione"))), React.createElement("div", {
    className: "grid3"
  }, ro("Denominazione", str.denominazione), ro("Indirizzo", str.indirizzo), ro("Site manager (dall'organigramma)", str.siteManager || 'da inserire in Amministrazione > Organizzazione'), React.createElement(Field, {
    l: "Email del site manager (conferma presenze)"
  }, React.createElement("input", {
    type: "email",
    value: str.siteManagerEmail || '',
    placeholder: str.siteManagerEmailDefault || "nome@toscanadiagnostica.it",
    title: str.siteManagerEmailDefault ? "Vuoto = il responsabile di sede dell'organigramma (" + str.siteManagerEmailDefault + ") conferma le presenze; scrivi un'email per indicare un'altra persona" : "L'utente con questa email può confermare ogni giorno le presenze del personale sanitario di questa sede",
    onChange: e => set({
      siteManagerEmail: e.target.value
    })
  })), React.createElement(Field, {
    l: "Logo della struttura"
  }, React.createElement("div", {
    className: "rowline"
  }, str.logo && React.createElement("img", {
    src: str.logo,
    alt: "logo struttura",
    style: {
      height: 36,
      borderRadius: 6
    }
  }), React.createElement(FileBtn, {
    label: str.logo ? 'Sostituisci' : 'Carica logo',
    accept: "image/*",
    onData: d => set({
      logo: d
    })
  }), str.logo && React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => set({
      logo: null
    })
  }, "Rimuovi"))), ro("Contatti telefonici", str.telefono), ro("Mail", str.email))), React.createElement("div", {
    className: "card"
  }, React.createElement("h3", null, "Orari di apertura"), DAYS.map((dn, d) => React.createElement("div", {
    className: "avrow",
    key: d
  }, React.createElement("div", {
    className: "dn"
  }, DAYS_S[d]), React.createElement("div", {
    className: "rowline"
  }, React.createElement("label", {
    style: {
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      textTransform: 'none'
    }
  }, React.createElement("input", {
    type: "checkbox",
    checked: !str.hours[d].closed,
    onChange: e => upd(s => {
      s.hours[d].closed = !e.target.checked;
    })
  }), " Aperto"), !str.hours[d].closed && React.createElement("span", {
    className: "rng"
  }, React.createElement("input", {
    type: "time",
    step: "1800",
    value: str.hours[d].open,
    onChange: e => upd(s => {
      s.hours[d].open = e.target.value;
    })
  }), React.createElement("span", {
    className: "mono"
  }, "→"), React.createElement("input", {
    type: "time",
    step: "1800",
    value: str.hours[d].close,
    onChange: e => upd(s => {
      s.hours[d].close = e.target.value;
    })
  })), d === 0 && !str.hours[0].closed && React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => upd(s => {
      for (let i = 1; i < 7; i++) if (!s.hours[i].closed) {
        s.hours[i].open = s.hours[0].open;
        s.hours[i].close = s.hours[0].close;
      }
    })
  }, "Copia in tutti gli altri giorni aperti"))))), React.createElement("div", {
    className: "card"
  }, React.createElement("h3", null, "Capacità e organico"), React.createElement("div", {
    className: "grid3",
    style: {
      marginBottom: 12
    }
  }, React.createElement(Field, {
    l: "Desk · minimo turno mattina"
  }, React.createElement("input", {
    type: "number",
    min: "0",
    value: str.deskCapAM != null ? str.deskCapAM : str.deskCapacity,
    onChange: e => set({
      deskCapAM: e.target.value
    })
  })), React.createElement(Field, {
    l: "Desk · minimo turno pomeriggio/sera"
  }, React.createElement("input", {
    type: "number",
    min: "0",
    value: str.deskCapPM != null ? str.deskCapPM : str.deskCapacity,
    onChange: e => set({
      deskCapPM: e.target.value
    })
  })), React.createElement(Field, {
    l: "Desk · ora cambio turno"
  }, React.createElement("input", {
    type: "time",
    step: "1800",
    style: {
      width: '100%'
    },
    value: str.deskSplit || '14:00',
    onChange: e => set({
      deskSplit: e.target.value || '14:00'
    })
  }))), React.createElement("div", {
    className: "grid3",
    style: {
      marginBottom: 6
    }
  }, React.createElement(Field, {
    l: "Desk · +1 addetto ogni N ambulatori attivi"
  }, React.createElement("input", {
    type: "number",
    min: "1",
    value: str.deskRatio || 4,
    onChange: e => set({
      deskRatio: e.target.value
    })
  })), React.createElement(Field, {
    l: "Desk · massimo addetti contemporanei"
  }, React.createElement("input", {
    type: "number",
    min: "1",
    value: str.deskMax || '',
    placeholder: String(Math.max(+str.deskCapAM || 0, +str.deskCapPM || 0, +str.deskCapacity || 0) + 1),
    onChange: e => set({
      deskMax: e.target.value
    })
  })), React.createElement(Field, {
    l: "Desk · sovrapposizione al cambio turno (min)"
  }, React.createElement("input", {
    type: "number",
    min: "0",
    step: "30",
    value: str.deskOverlap != null && str.deskOverlap !== '' ? str.deskOverlap : 30,
    onChange: e => set({
      deskOverlap: e.target.value
    })
  }))), React.createElement("div", {
    className: "note",
    style: {
      marginBottom: 12
    }
  }, "Il fabbisogno del desk segue il carico degli ambulatori: parte dal minimo del turno e cresce di un addetto ogni N ambulatori attivi (sessioni mediche e prelievi in corso), fino al massimo indicato. Si sale e si scende in modo progressivo nella giornata, con sovrapposizione al cambio turno. I dipendenti oltre 30 ore settimanali hanno 30' di pausa pranzo nei turni di almeno 6 ore (7h di lavoro = 7h30' di presenza)."), React.createElement("div", {
    className: "grid3"
  }, React.createElement(Field, {
    l: "Ambulatori"
  }, React.createElement("div", {
    className: "kpi",
    style: {
      padding: '8px 12px'
    }
  }, React.createElement("div", {
    className: "v",
    style: {
      fontSize: 20
    }
  }, str.ambulatori.length), React.createElement("div", {
    className: "l"
  }, "configurati"))), React.createElement(Field, {
    l: "Accettazione / Sanitari"
  }, React.createElement("div", {
    className: "kpi",
    style: {
      padding: '8px 12px'
    }
  }, React.createElement("div", {
    className: "v",
    style: {
      fontSize: 20
    }
  }, n('accettazione'), " / ", n('sanitario')), React.createElement("div", {
    className: "l"
  }, "operatori"))), React.createElement(Field, {
    l: "Personale medico"
  }, React.createElement("div", {
    className: "kpi",
    style: {
      padding: '8px 12px'
    }
  }, React.createElement("div", {
    className: "v",
    style: {
      fontSize: 20
    }
  }, n('medico')), React.createElement("div", {
    className: "l"
  }, "professionisti")))), React.createElement("p", {
    className: "note",
    style: {
      marginBottom: 0
    }
  }, "I contatori si aggiornano automaticamente dalle sezioni Personale e Ambulatori.")));
}
function RoomEditor({
  room,
  str,
  upd,
  onClose
}) {
  const set = fn => upd(s => {
    const r = s.ambulatori.find(x => x.id === room.id);
    fn(r);
  });
  const r = str.ambulatori.find(x => x.id === room.id) || room;
  return React.createElement("div", {
    className: "modal-bg",
    onClick: onClose
  }, React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 12
    }
  }, React.createElement("h3", {
    style: {
      fontSize: 17,
      color: 'var(--p)'
    }
  }, "Caratterizzazione ambulatorio"), React.createElement("span", {
    className: "sp"
  }), React.createElement("button", {
    className: "btn sm",
    onClick: onClose
  }, "Chiudi")), React.createElement("div", {
    className: "grid3"
  }, React.createElement(Field, {
    l: "Nome"
  }, React.createElement("input", {
    value: r.nome,
    onChange: e => set(x => x.nome = e.target.value)
  })), React.createElement(Field, {
    l: "Metri quadri"
  }, React.createElement("input", {
    type: "number",
    min: "0",
    value: r.mq,
    onChange: e => set(x => x.mq = e.target.value)
  })), React.createElement(Field, {
    l: "WC interno"
  }, React.createElement("select", {
    value: r.wc ? '1' : '0',
    onChange: e => set(x => x.wc = e.target.value === '1')
  }, React.createElement("option", {
    value: "0"
  }, "No"), React.createElement("option", {
    value: "1"
  }, "Sì")))), React.createElement(Field, {
    l: "Specialità ammesse (vuoto = polivalente)",
    style: {
      marginTop: 10
    }
  }, React.createElement(ChipPicker, {
    value: r.discipline,
    onChange: v => set(x => x.discipline = v),
    options: DISC,
    extra: str.extraDisc || [],
    onExtraChange: v => upd(x => x.extraDisc = v),
    addLabel: "+ altra specialità, Invio"
  }), React.createElement("div", {
    className: "note",
    style: {
      marginTop: 6
    }
  }, r.discipline.length ? 'Ambulatorio dedicato a: ' + r.discipline.join(', ') : 'Nessuna selezione: ambulatorio polivalente, accoglie qualsiasi specialità.'), r.discipline.length > 0 && !isPrelievi(r) && React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      textTransform: 'none',
      letterSpacing: 0,
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--ink)'
    }
  }, React.createElement("input", {
    type: "checkbox",
    checked: roomExclusive(r),
    onChange: e => set(x => x.esclusivo = e.target.checked)
  }), "Uso esclusivo delle specialità indicate", React.createElement("span", {
    className: "note",
    style: {
      fontWeight: 400
    }
  }, r.esclusivo === true || r.esclusivo === false ? '(impostazione manuale)' : '(automatico: ' + (roomExclusive(r) ? 'dedicato' : 'aperto ad altre specialità perché le sole attrezzature sono Ecografo/EMG') + ')'), (r.esclusivo === true || r.esclusivo === false) && React.createElement("button", {
    className: "btn sm ghost",
    onClick: ev => {
      ev.preventDefault();
      set(x => {
        delete x.esclusivo;
      });
    }
  }, "ripristina automatico")), React.createElement("div", {
    className: "note",
    style: {
      marginTop: 4
    }
  }, roomExclusive(r) ? 'Solo i medici delle specialità indicate possono essere assegnati a questo ambulatorio.' : 'Le specialità indicate hanno la precedenza, ma l\'ambulatorio può essere assegnato anche a medici di altre specialità quando è libero.')), React.createElement("div", {
    style: { marginTop: 10 }
  }, React.createElement("label", {
    style: { display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }
  }, React.createElement("input", {
    type: "checkbox",
    checked: !!r.soloVincolati,
    onChange: e => set(x => x.soloVincolati = e.target.checked)
  }), "Uso esclusivo ai Medici vincolati allo specifico ambulatorio", React.createElement("span", {
    className: "note",
    style: { fontWeight: 400 }
  }, '(' + str.personale.filter(p => p.tipo === 'medico' && p.roomMode === 'req' && p.roomId === r.id && p.nome.trim()).length + ' medici vincolati)')), React.createElement("div", {
    className: "note",
    style: { marginTop: 4 }
  }, r.soloVincolati ? 'La programmazione oraria include solo i medici che hanno questo ambulatorio come assegnazione obbligatoria (Personale → Ambulatorio → Obbligatorio). Tutti gli altri medici non vengono allocati qui.' : 'Se attivo, l\'ambulatorio è riservato ai soli medici con vincolo obbligatorio di assegnazione a questa stanza.'))), isPrelievi(r) && React.createElement(Field, {
    l: "Orario attività Punto Prelievi",
    style: {
      marginTop: 10
    }
  }, React.createElement("div", {
    className: "note",
    style: {
      marginBottom: 6
    }
  }, "In queste fasce l'ambulatorio è riservato ai prelievi. Fuori da queste fasce è polivalente e accoglie qualsiasi specialità."), React.createElement(AvailabilityEditor, {
    value: r.prelievi || emptyDisp(),
    onChange: v => set(x => x.prelievi = v),
    hours: str.hours
  })), React.createElement(Field, {
    l: "Attrezzature assegnate",
    style: {
      marginTop: 10
    }
  }, React.createElement(ChipPicker, {
    value: r.attrezzature,
    onChange: v => set(x => x.attrezzature = v),
    options: EQUIP,
    extra: str.extraEquip || [],
    onExtraChange: v => upd(x => x.extraEquip = v),
    addLabel: "+ altra attrezzatura, Invio"
  })), React.createElement(Field, {
    l: "Disponibilità settimanale dell'ambulatorio",
    style: {
      marginTop: 10
    }
  }, React.createElement(AvailabilityEditor, {
    value: r.disp,
    onChange: v => set(x => x.disp = v),
    hours: str.hours
  })), React.createElement(Field, {
    l: "Note",
    style: {
      marginTop: 10
    }
  }, React.createElement("textarea", {
    rows: "2",
    value: r.note,
    onChange: e => set(x => x.note = e.target.value)
  }))));
}
function AmbulatoriTab({
  str,
  upd
}) {
  const [edit, setEdit] = useState(null);
  return React.createElement("div", null, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 12
    }
  }, React.createElement("h3", {
    style: {
      color: 'var(--p)'
    }
  }, "Ambulatori"), React.createElement("span", {
    className: "sp"
  }), React.createElement("button", {
    className: "btn pri",
    onClick: () => upd(s => {
      const r = newRoom(s);
      s.ambulatori.push(r);
      setTimeout(() => setEdit(r.id), 0);
    })
  }, "+ Nuovo ambulatorio")), str.ambulatori.length === 0 && React.createElement("div", {
    className: "empty"
  }, "Nessun ambulatorio. Aggiungi il primo per iniziare la caratterizzazione degli spazi."), str.ambulatori.map(r => React.createElement("div", {
    className: "list-item",
    key: r.id
  }, React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    className: "ti"
  }, r.nome, " ", r.wc && React.createElement("span", {
    className: "pill grn"
  }, "WC interno"), r.mq && React.createElement("span", {
    className: "pill"
  }, r.mq, " mq")), React.createElement("div", {
    className: "su"
  }, isPrelievi(r) ? 'Punto Prelievi · polivalente fuori dall\'orario prelievi' + (r.discipline.filter(x => x !== PRELIEVI).length ? ' · ' + r.discipline.filter(x => x !== PRELIEVI).join(', ') : '') : r.discipline.length ? (roomExclusive(r) ? 'Dedicato: ' : 'Preferenziale: ') + r.discipline.join(', ') + (roomExclusive(r) ? '' : ' · aperto ad altre specialità') : 'Polivalente', r.attrezzature.length > 0 && ' · ' + r.attrezzature.join(', '), ' · Disponibile: ' + DAYS_S.filter((_, d) => (r.disp[d] || []).length > 0).join(', '))), React.createElement("button", {
    className: "btn sm",
    onClick: () => setEdit(r.id)
  }, "Modifica"), React.createElement("button", {
    className: "btn sm danger",
    onClick: () => {
      if (confirm('Eliminare ' + r.nome + '?')) upd(s => {
        s.ambulatori = s.ambulatori.filter(x => x.id !== r.id);
        delete s.plan.markers[r.id];
      });
    }
  }, "Elimina"))), edit && React.createElement(RoomEditor, {
    room: str.ambulatori.find(x => x.id === edit),
    str: str,
    upd: upd,
    onClose: () => setEdit(null)
  }));
}
function PersonEditor({
  person,
  str,
  upd,
  onClose
}) {
  const set = fn => upd(s => {
    const p = s.personale.find(x => x.id === person.id);
    fn(p);
  });
  const p = str.personale.find(x => x.id === person.id) || person;
  const isMed = p.tipo === 'medico';
  return React.createElement("div", {
    className: "modal-bg",
    onClick: onClose
  }, React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 12
    }
  }, React.createElement("h3", {
    style: {
      fontSize: 17,
      color: 'var(--p)'
    }
  }, isMed ? 'Medico' : p.tipo === 'sanitario' ? 'Personale sanitario' : 'Personale di accettazione'), React.createElement("span", {
    className: "sp"
  }), React.createElement("button", {
    className: "btn sm",
    onClick: onClose
  }, "Chiudi")), React.createElement("div", {
    className: "grid2"
  }, React.createElement(Field, {
    l: "Nome e cognome"
  }, React.createElement("input", {
    value: p.nome,
    onChange: e => set(x => x.nome = e.target.value)
  })), React.createElement(Field, {
    l: "Email (per agenda e proposte)"
  }, React.createElement("input", {
    type: "email",
    value: p.email || '',
    placeholder: "nome@esempio.it",
    onChange: e => set(x => x.email = e.target.value)
  })), React.createElement(Field, {
    l: "Rapporto di lavoro"
  }, React.createElement("div", {
    className: "chips",
    style: {
      marginTop: 4
    }
  }, React.createElement("span", {
    className: 'chip' + (p.contratto === 'dipendente' ? ' on' : ''),
    role: "radio",
    "aria-checked": p.contratto === 'dipendente',
    tabIndex: "0",
    onClick: () => set(x => x.contratto = 'dipendente')
  }, "Dipendente"), React.createElement("span", {
    className: 'chip' + (p.contratto === 'lp' ? ' on' : ''),
    role: "radio",
    "aria-checked": p.contratto === 'lp',
    tabIndex: "0",
    onClick: () => set(x => x.contratto = 'lp')
  }, "LP · Libero professionista"), !p.contratto && React.createElement("span", {
    className: "note"
  }, "da indicare")))), isMed && React.createElement(Field, {
    l: "Specialità",
    style: {
      marginTop: 10
    }
  }, React.createElement(ChipPicker, {
    value: medDisc(p),
    onChange: v => set(x => {
      x.discipline = v;
      x.disciplina = v[0] || '';
    }),
    options: DISC,
    extra: str.extraDisc || [],
    onExtraChange: v => upd(x => x.extraDisc = v),
    addLabel: "+ altra specialità, Invio"
  })), isMed && React.createElement(Field, {
    l: "Ambulatorio",
    style: {
      marginTop: 10
    }
  }, React.createElement("div", {
    className: "rowline",
    style: {
      flexWrap: 'wrap'
    }
  }, React.createElement("select", {
    style: {
      width: 'auto',
      minWidth: 220
    },
    value: p.roomId || '',
    onChange: e => set(x => {
      x.roomId = e.target.value || null;
      if (!x.roomMode) x.roomMode = 'pref';
    })
  }, React.createElement("option", {
    value: ""
  }, "Nessuna indicazione (scelta automatica)"), str.ambulatori.map(r => React.createElement("option", {
    key: r.id,
    value: r.id
  }, r.nome, r.discipline.length ? ' · ' + r.discipline.join(', ') : '', r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : ''))), p.roomId && React.createElement("div", {
    className: "chips"
  }, React.createElement("span", {
    className: 'chip' + ((p.roomMode || 'pref') === 'pref' ? ' on' : ''),
    role: "radio",
    "aria-checked": (p.roomMode || 'pref') === 'pref',
    tabIndex: "0",
    onClick: () => set(x => x.roomMode = 'pref')
  }, "Preferenziale"), React.createElement("span", {
    className: 'chip' + (p.roomMode === 'req' ? ' on' : ''),
    role: "radio",
    "aria-checked": p.roomMode === 'req',
    tabIndex: "0",
    onClick: () => set(x => x.roomMode = 'req')
  }, "Obbligatorio"))), React.createElement("div", {
    className: "note",
    style: {
      marginTop: 6
    }
  }, !p.roomId ? 'La pianificazione sceglie l\'ambulatorio in base a specialità, attrezzature e disponibilità.' : p.roomMode === 'req' ? 'Il medico viene assegnato solo a questo ambulatorio; se non è disponibile la sessione resta non allocata.' : 'A parità di condizioni la pianificazione privilegia questo ambulatorio, ma può usarne altri compatibili.'), React.createElement("label", {
    style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, textTransform: 'none', letterSpacing: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }
  }, React.createElement("input", {
    type: "checkbox",
    checked: !!p.stessaStanza,
    onChange: e => set(x => x.stessaStanza = e.target.checked)
  }), "Sempre nello stesso ambulatorio per tutta la programmazione"), React.createElement("div", {
    className: "note",
    style: { marginTop: 4 }
  }, p.stessaStanza ? (p.roomId && p.roomMode === 'req' ? 'Già garantito dall\'assegnazione obbligatoria: tutte le sessioni si svolgono in ' + ((str.ambulatori.find(r => r.id === p.roomId) || {}).nome || 'questo ambulatorio') + '.' : 'La pianificazione sceglie un unico ambulatorio (quello che ospita il maggior numero di sessioni del medico, privilegiando il preferenziale) e vi colloca tutte le sessioni della settimana; le sessioni che non vi trovano posto restano non allocate invece di essere spostate altrove.') : 'Se attivo, il medico non cambia mai stanza tra un giorno e l\'altro.')), isMed && React.createElement(Field, {
    l: "Durata prestazione (minuti)",
    style: {
      marginTop: 10
    }
  }, React.createElement("div", {
    className: "rowline"
  }, React.createElement("input", {
    type: "number",
    min: "5",
    step: "5",
    style: {
      width: 120
    },
    value: p.durataPrestazione || '',
    onChange: e => set(x => x.durataPrestazione = e.target.value),
    placeholder: "Es. 20"
  }), React.createElement("span", {
    className: "note"
  }, "Serve a calcolare il numero di slot prenotabili in ogni sessione (durata sessione ÷ durata prestazione)."))), isMed && React.createElement(Field, {
    l: "Attrezzature necessarie in ambulatorio",
    style: {
      marginTop: 10
    }
  }, React.createElement(ChipPicker, {
    value: p.attrezzature,
    onChange: v => set(x => x.attrezzature = v),
    options: EQUIP,
    extra: str.extraEquip || [],
    onExtraChange: v => upd(x => x.extraEquip = v),
    addLabel: "+ altra attrezzatura, Invio"
  })), isMed && React.createElement(Field, {
    l: "Supporto richiesto",
    style: {
      marginTop: 10
    }
  }, React.createElement("label", {
    style: {
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      textTransform: 'none'
    }
  }, React.createElement("input", {
    type: "checkbox",
    checked: p.richiedeSanitario,
    onChange: e => set(x => x.richiedeSanitario = e.target.checked)
  }), " Richiede personale sanitario in affiancamento")), React.createElement(Field, {
    l: "Dispositivi in dotazione o richiesti",
    style: {
      marginTop: 10
    }
  }, React.createElement(TagInput, {
    value: p.dispositivi,
    onChange: v => set(x => x.dispositivi = v),
    placeholder: "Es. Palmare accettazione, saturimetro"
  })), isMed && React.createElement(Field, {
    l: "Professionisti a supporto",
    style: {
      marginTop: 10
    }
  }, (() => {
    const staff = str.personale.filter(x => (x.tipo === 'sanitario' || x.tipo === 'accettazione') && x.nome.trim());
    const sel = (p.supportoIds || []).filter(id => staff.some(x => x.id === id));
    const tog = id => set(x => {
      const cur = (x.supportoIds || []).filter(i => i !== id);
      x.supportoIds = cur.length === (x.supportoIds || []).length ? [...cur, id] : cur;
    });
    if (!staff.length) return React.createElement("div", {
      className: "note"
    }, "Nessun operatore disponibile: inserisci prima il personale sanitario o di accettazione nelle rispettive sezioni.");
    return React.createElement("div", null, React.createElement("div", {
      className: "chips"
    }, staff.map(x => React.createElement("span", {
      key: x.id,
      className: 'chip' + (sel.includes(x.id) ? ' on' : ''),
      role: "checkbox",
      "aria-checked": sel.includes(x.id),
      tabIndex: "0",
      onClick: () => tog(x.id),
      onKeyDown: ev => {
        if (ev.key === ' ' || ev.key === 'Enter') {
          ev.preventDefault();
          tog(x.id);
        }
      }
    }, x.nome, React.createElement("span", {
      style: {
        opacity: .7,
        fontWeight: 400,
        fontSize: 11
      }
    }, x.tipo === 'sanitario' ? 'sanitario' : 'accettazione')))), React.createElement("div", {
      className: "note",
      style: {
        marginTop: 6
      }
    }, sel.length ? 'Affiancamento preferenziale: ' + sel.map(id => staff.find(x => x.id === id).nome).join(', ') : 'Nessuna preferenza: se richiesto, il supporto sanitario viene scelto tra tutti i disponibili.'));
  })()), isMed && React.createElement(Field, {
    l: "Note (es. frequenza: ogni 15 giorni, 1°-3° mercoledì)",
    style: {
      marginTop: 10
    }
  }, React.createElement("input", {
    value: p.note || '',
    onChange: e => set(x => x.note = e.target.value),
    placeholder: "Facoltativo"
  })), p.tipo === 'sanitario' && React.createElement(Field, {
    l: "Profilo professionale",
    style: {
      marginTop: 10
    }
  }, React.createElement("div", {
    className: "chips"
  }, PROFILI_SAN.map(pr => React.createElement("span", {
    key: pr,
    className: 'chip' + (p.profilo === pr ? ' on' : ''),
    role: "radio",
    "aria-checked": p.profilo === pr,
    tabIndex: "0",
    onClick: () => set(x => x.profilo = x.profilo === pr ? '' : pr)
  }, pr)), React.createElement("span", {
    className: "chipadd"
  }, React.createElement("input", {
    value: p.profilo && !PROFILI_SAN.includes(p.profilo) ? p.profilo : '',
    placeholder: "+ altro profilo",
    onChange: e => set(x => x.profilo = e.target.value)
  })))), p.tipo === 'sanitario' && React.createElement(Field, {
    l: "Competenze sui dispositivi medici (skill)",
    style: {
      marginTop: 10
    }
  }, React.createElement(ChipPicker, {
    value: p.attrezzature,
    onChange: v => set(x => x.attrezzature = v),
    options: EQUIP,
    extra: str.extraEquip || [],
    onExtraChange: v => upd(x => x.extraEquip = v),
    addLabel: "+ altro dispositivo, Invio"
  }), React.createElement("div", {
    className: "note",
    style: {
      marginTop: 6
    }
  }, "Il sanitario può affiancare un medico solo se possiede le competenze sui dispositivi che il medico utilizza (es. un TSRM senza esperienza su RM 1.5T non viene proposto in quella sala).")), p.tipo === 'accettazione' || p.tipo === 'sanitario' && p.contratto === 'dipendente' ? React.createElement("div", {
    className: "grid2",
    style: {
      marginTop: 10
    }
  }, React.createElement(Field, {
    l: "Ore settimanali a contratto"
  }, React.createElement("input", {
    type: "number",
    min: "0",
    step: "0.5",
    value: p.oreContratto != null && p.oreContratto !== '' ? p.oreContratto : contractMin(p) / 60 || '',
    onChange: e => set(x => x.oreContratto = e.target.value),
    placeholder: "Es. 36"
  })), React.createElement(Field, {
    l: "Massimo ore al giorno"
  }, React.createElement("input", {
    type: "number",
    min: "1",
    max: "13",
    step: "0.5",
    value: p.maxOreGiorno || 8,
    onChange: e => set(x => x.maxOreGiorno = e.target.value)
  })), React.createElement(Field, {
    l: "Giorni lavorativi a settimana"
  }, React.createElement("input", {
    type: "number",
    min: "1",
    max: "7",
    value: p.giorniSett || Object.values(str.hours).filter(h => !h.closed).length,
    onChange: e => set(x => x.giorniSett = e.target.value)
  })), React.createElement(Field, {
    l: "Ore al giorno (calcolate)"
  }, React.createElement("div", {
    className: "kpi",
    style: {
      padding: '8px 12px'
    }
  }, React.createElement("div", {
    className: "v",
    style: {
      fontSize: 18
    }
  }, (+p.giorniSett || Object.values(str.hours).filter(h => !h.closed).length) >= 6 ? durTxt(Math.round(contractMin(p) * 7 / 40 / 30) * 30) + ' lun–ven · sabato ' + durTxt(Math.max(0, contractMin(p) - 5 * Math.round(contractMin(p) * 7 / 40 / 30) * 30)) : durTxt(Math.round(contractMin(p) / Math.max(1, +p.giorniSett || 5) / 30) * 30)), React.createElement("div", {
    className: "l"
  }, hasLunch(p) ? '+30\' pausa pranzo nei turni ≥ 6h' : 'senza pausa pranzo'))), React.createElement(Field, {
    l: "Turno preferito"
  }, React.createElement("div", {
    className: "chips",
    style: {
      marginTop: 4
    }
  }, [['mattina', 'Mattina'], ['pomeriggio', 'Pomeriggio / sera'], ['indifferente', 'Indifferente']].map(([k, l]) => React.createElement("span", {
    key: k,
    className: 'chip' + ((p.turnoPref || 'indifferente') === k ? ' on' : ''),
    role: "radio",
    "aria-checked": (p.turnoPref || 'indifferente') === k,
    tabIndex: "0",
    onClick: () => set(x => x.turnoPref = k)
  }, l)))), React.createElement(Field, {
    l: "Turnazione settimanale"
  }, React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      textTransform: 'none',
      letterSpacing: 0,
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--ink)',
      marginTop: 8
    }
  }, React.createElement("input", {
    type: "checkbox",
    checked: !!p.turnazione,
    onChange: e => set(x => x.turnazione = e.target.checked)
  }), " Alterna il turno ogni settimana ", (p.turnoPref || 'indifferente') === 'indifferente' ? '(mattina/pomeriggio assegnati dalla pianificazione, invertiti ogni settimana)' : '(A: ' + (p.turnoPref === 'pomeriggio' ? 'pomeriggio' : 'mattina') + ' · B: ' + (p.turnoPref === 'pomeriggio' ? 'mattina' : 'pomeriggio') + ')')), React.createElement("div", {
    className: "note",
    style: {
      gridColumn: '1 / -1'
    }
  }, "Full time su 5 giorni = 8h al giorno; su 6 giorni = 7h lun–ven + 5h il sabato (40h esatte; part-time in proporzione). La pausa pranzo di 30' è fuori contratto e non pagata: allunga solo la presenza nei turni di almeno 6h. Le ore a contratto vengono usate per intero: chi è di mattina entra all'apertura, chi è di pomeriggio esce alla chiusura; i turni interi superano il cambio turno e si sovrappongono. Se i giorni di apertura sono più dei giorni lavorativi, i riposi vengono sfalsati tra colleghi. Con la turnazione la pianificazione produce due settimane (A e B) che si alternano.")) : React.createElement(Field, {
    l: p.tipo === 'sanitario' ? 'Orario settimanale (libero professionista)' : 'Disponibilità oraria settimanale',
    style: {
      marginTop: 10
    }
  }, p.tipo === 'sanitario' && !p.contratto && React.createElement("div", {
    className: "note",
    style: {
      marginBottom: 6
    }
  }, "Indica prima il rapporto di lavoro: da dipendente l'orario si ricava da ore e giorni; da libero professionista si inserisce qui."), React.createElement(AvailabilityEditor, {
    value: p.disp,
    onChange: v => set(x => x.disp = v),
    hours: str.hours
  }))));
}
function PersonaleTab({
  str,
  upd
}) {
  const [edit, setEdit] = useState(null);
  const groups = [['accettazione', 'Personale di accettazione'], ['sanitario', 'Personale sanitario'], ['medico', 'Personale Medico, Attività Specialistica']];
  const [sort, setSort] = useState({});
  const coll = new Intl.Collator('it', {
    sensitivity: 'base'
  });
  const parts = p => {
    const w = (p.nome || '').trim().split(/\s+/);
    return {
      cognome: w[0] || '',
      nome: w.slice(1).join(' ')
    };
  };
  const sorted = (list, t) => {
    const k = sort[t];
    if (!k) return list;
    return [...list].sort((a, b) => {
      const A = parts(a),
        B = parts(b);
      return k === 'cognome' ? coll.compare(A.cognome, B.cognome) || coll.compare(A.nome, B.nome) : coll.compare(A.nome, B.nome) || coll.compare(A.cognome, B.cognome);
    });
  };
  const SortBtn = ({
    t,
    k,
    label
  }) => React.createElement("button", {
    className: 'btn sm ' + (sort[t] === k ? 'pri' : ''),
    title: sort[t] === k ? 'Clicca per tornare all\'ordine di inserimento' : label,
    onClick: () => setSort(o => ({
      ...o,
      [t]: o[t] === k ? null : k
    }))
  }, label);
  return React.createElement("div", null, groups.map(([t, label]) => React.createElement("div", {
    className: "card",
    key: t
  }, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 10
    }
  }, React.createElement("h3", null, label), React.createElement("span", {
    className: "sp"
  }), str.personale.filter(p => p.tipo === t).length > 1 && React.createElement(React.Fragment, null, React.createElement("span", {
    className: "note",
    style: {
      marginRight: 2
    }
  }, "Ordina per"), React.createElement(SortBtn, {
    t: t,
    k: "cognome",
    label: "Cognome"
  }), React.createElement(SortBtn, {
    t: t,
    k: "nome",
    label: "Nome"
  }), React.createElement("span", {
    style: {
      width: 8
    }
  })), React.createElement("button", {
    className: "btn pri sm",
    onClick: () => upd(s => {
      const p = newPerson(t);
      s.personale.push(p);
      setTimeout(() => setEdit(p.id), 0);
    })
  }, "+ Aggiungi")), str.personale.filter(p => p.tipo === t).length === 0 && React.createElement("div", {
    className: "empty"
  }, "Nessun profilo inserito. Aggiungi le persone e le loro disponibilità settimanali."), sorted(str.personale.filter(p => p.tipo === t), t).map(p => React.createElement("div", {
    className: "list-item",
    key: p.id
  }, React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    className: "ti"
  }, p.nome || '(senza nome)', " ", p.contratto && React.createElement("span", {
    className: "pill",
    style: {
      background: '#EEF2F4',
      color: 'var(--mut)'
    }
  }, p.contratto === 'lp' ? 'LP' : 'Dipendente'), p.tipo === 'sanitario' && p.profilo && React.createElement("span", {
    className: "pill amb"
  }, p.profilo), medDisc(p).map(d => React.createElement("span", {
    key: d,
    className: "pill"
  }, d)), p.richiedeSanitario && React.createElement("span", {
    className: "pill amb"
  }, "con supporto sanitario"), p.roomId && str.ambulatori.find(r => r.id === p.roomId) && React.createElement("span", {
    className: 'pill ' + (p.roomMode === 'req' ? 'red' : '')
  }, str.ambulatori.find(r => r.id === p.roomId).nome, p.roomMode === 'req' ? ' · obbligatorio' : ' · preferenziale'), p.stessaStanza && !(p.roomId && p.roomMode === 'req') && React.createElement("span", { className: "pill" }, "stessa stanza per tutta la settimana"), (p.supportoIds || []).map(id => str.personale.find(x => x.id === id)).filter(Boolean).map(x => React.createElement("span", {
    key: x.id,
    className: "pill grn"
  }, "supporto: ", x.nome))), React.createElement("div", {
    className: "su"
  }, p.tipo === 'accettazione' || p.tipo === 'sanitario' && p.contratto === 'dipendente' ? 'Contratto: ' + (contractMin(p) ? durTxt(contractMin(p)) + '/settimana · max ' + (p.maxOreGiorno || 8) + 'h/giorno' : 'ore da definire') + (p.turnazione ? (p.turnoPref || 'indifferente') === 'indifferente' ? ' · turnazione mattina/pomeriggio alternata' : ' · turnazione A: ' + (p.turnoPref === 'pomeriggio' ? 'pomeriggio' : 'mattina') + ' / B: ' + (p.turnoPref === 'pomeriggio' ? 'mattina' : 'pomeriggio') : p.turnoPref && p.turnoPref !== 'indifferente' ? ' · turno ' + (p.turnoPref === 'pomeriggio' ? 'pomeriggio/sera' : 'mattina') : '') : 'Disponibile: ' + (DAYS_S.filter((_, d) => (p.disp[d] || []).length > 0).join(', ') || 'da definire'), p.attrezzature.length > 0 && (p.tipo === 'sanitario' ? ' · Skill: ' : ' · Richiede: ') + p.attrezzature.join(', '), isMedP(p) && p.durataPrestazione ? ' · prestazione ' + p.durataPrestazione + "'" : '', p.note ? ' · ' + p.note : '', p.dispositivi.length > 0 && ' · Dispositivi: ' + p.dispositivi.join(', '))), React.createElement("button", {
    className: "btn sm",
    onClick: () => setEdit(p.id)
  }, "Modifica"), React.createElement("button", {
    className: "btn sm danger",
    onClick: () => {
      if (confirm('Eliminare ' + (p.nome || 'profilo') + '?')) upd(s => {
        s.personale = s.personale.filter(x => x.id !== p.id);
      });
    }
  }, "Elimina"))))), edit && React.createElement(PersonEditor, {
    person: str.personale.find(x => x.id === edit),
    str: str,
    upd: upd,
    onClose: () => setEdit(null)
  }));
}
function PlanimetriaTab({
  str,
  upd
}) {
  const [selRoom, setSelRoom] = useState(null);
  return React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 10
    }
  }, React.createElement("h3", null, "Planimetria dinamica"), React.createElement("span", {
    className: "sp"
  }), React.createElement(FileBtn, {
    label: str.plan.dataUrl ? 'Sostituisci PDF' : 'Carica PDF planimetria',
    accept: "application/pdf",
    onData: (d, f) => {
      if (f.size > 3800000) {
        alert('Il PDF supera 3,8 MB: verrà mostrato in sessione ma potrebbe non essere salvato tra le sessioni. Consiglio una versione compressa.');
      }
      upd(s => {
        s.plan.dataUrl = d;
        s.plan.imgUrl = null;
      });
      pdfToImg(d).then(img => {
        if (img) upd(s => {
          if (s.plan.dataUrl === d) s.plan.imgUrl = img;
        });
      });
    }
  }), str.plan.dataUrl && React.createElement("button", {
    className: "btn sm ghost",
    onClick: () => upd(s => {
      s.plan.dataUrl = null;
      s.plan.imgUrl = null;
    })
  }, "Rimuovi PDF")), str.plan.dataUrl ? React.createElement("p", {
    className: "note"
  }, "Seleziona un ambulatorio e clicca sulla planimetria per posizionarlo: sulla pianta compare solo il numero; nome, medico in attività e orario si leggono nel pannello a fianco e al passaggio del mouse.") : React.createElement("p", {
    className: "note"
  }, "Senza PDF viene generato uno schema automatico degli ambulatori, comunque dinamico. Carica la planimetria reale per il posizionamento puntuale."), str.plan.dataUrl && React.createElement("div", {
    className: "rowline",
    style: {
      margin: '8px 0'
    }
  }, str.ambulatori.map(r => React.createElement("button", {
    key: r.id,
    className: 'subtab' + (selRoom === r.id ? ' on' : ''),
    onClick: () => setSelRoom(selRoom === r.id ? null : r.id)
  }, React.createElement("span", {
    className: "nb",
    style: {
      display: 'inline-flex',
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: 'var(--teal)',
      color: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 10,
      fontWeight: 800,
      marginRight: 6
    }
  }, roomNum(r)), r.nome, str.plan.markers[r.id] ? ' ✓' : ''))), React.createElement(PlanCanvas, {
    str: str,
    mode: "edit",
    selRoom: selRoom,
    onPlace: (rid, x, y) => upd(s => {
      s.plan.markers[rid] = {
        x,
        y
      };
    }),
    statusFn: null
  }));
}
function CoverageStrip({
  cells
}) {
  return React.createElement("div", {
    className: "strip",
    role: "img",
    "aria-label": "Copertura oraria"
  }, cells.map((c, i) => React.createElement("div", {
    key: i,
    title: m2t(c.m) + ' · fabbisogno ' + c.need + (c.activity != null ? ' (' + c.activity + ' ambulatori attivi, minimo ' + c.min + ')' : '') + ' · ' + (c.missing > 0 ? 'mancano ' + c.missing : c.ids.length > c.need ? 'presenti ' + c.ids.length + ', sopra il minimo' : c.ids.length ? 'coperto ' + c.ids.length + '/' + c.need : 'nessun operatore richiesto'),
    style: {
      background: c.missingMin > 0 ? 'var(--red)' : c.missing > 0 ? '#D9A441' : c.ids.length > c.need ? '#1d6b41' : c.ids.length ? 'var(--green)' : 'var(--line)'
    }
  })));
}
function DeskView({
  str,
  plan,
  brand
}) {
  const [wi, setWi] = useState(0);
  const wk = plan.deskWeeks[Math.min(wi, plan.deskWeeks.length - 1)];
  const P = {
    ...plan,
    deskGrid: wk.deskGrid,
    deskShifts: wk.deskShifts,
    shortages: wk.shortages,
    deskHours: wk.deskHours
  };
  return React.createElement("div", null, React.createElement("div", {
    className: "exp"
  }, React.createElement("button", {
    className: "btn",
    onClick: () => exportDeskXLSX(str, plan)
  }, "Scarica XLSX"), React.createElement("button", {
    className: "btn",
    onClick: () => exportDeskPDF(str, plan, brand)
  }, "Scarica PDF"), plan.turnazione && React.createElement("span", {
    className: "chips",
    style: {
      marginLeft: 'auto'
    }
  }, plan.deskWeeks.map((w, i) => React.createElement("span", {
    key: i,
    className: 'chip' + (i === wi ? ' on' : ''),
    role: "tab",
    tabIndex: "0",
    onClick: () => setWi(i)
  }, w.label)), React.createElement("span", {
    className: "note"
  }, "turnazione: le due settimane si alternano"))), P.deskHours.length > 0 && React.createElement("div", {
    className: "card",
    style: {
      padding: 12
    }
  }, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 6
    }
  }, React.createElement("h3", {
    style: {
      margin: 0
    }
  }, "Monte ore settimanale"), React.createElement("span", {
    className: "sp"
  }), React.createElement("span", {
    className: "note"
  }, "Fabbisogno desk ", durTxt(plan.deskBalance.need), " · ore a contratto ", durTxt(plan.deskBalance.supply), plan.deskBalance.supply < plan.deskBalance.need ? ' · mancano ' + durTxt(plan.deskBalance.need - plan.deskBalance.supply) : '')), React.createElement("table", {
    className: "t"
  }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Operatore"), React.createElement("th", null, "Turno"), React.createElement("th", null, "Giorni · ore/giorno"), React.createElement("th", null, "Riposo"), React.createElement("th", null, "Contratto"), React.createElement("th", null, "Assegnate al desk"), React.createElement("th", null, "Residue"), React.createElement("th", null, "Sopra il minimo"))), React.createElement("tbody", null, P.deskHours.map(h => React.createElement("tr", {
    key: h.id
  }, React.createElement("td", null, h.nome), React.createElement("td", null, h.side === 'mattina' ? 'mattina' : 'pomeriggio/sera', h.pref === 'indifferente' ? ' (assegnato)' : '', plan.byId[h.id].turnazione ? ' · turnazione' : ''), React.createElement("td", {
    className: "mono"
  }, h.workDays, " · ", durTxt(h.daily), h.dailySat != null ? ' (sab ' + durTxt(h.dailySat) + ')' : ''), React.createElement("td", null, h.off.length ? h.off.map(d => DAYS_S[d]).join(', ') : '—'), React.createElement("td", {
    className: "mono"
  }, durTxt(h.contratto)), React.createElement("td", {
    className: "mono"
  }, durTxt(h.assegnate)), React.createElement("td", {
    className: "mono",
    style: {
      color: h.residue >= 30 ? 'var(--red)' : 'inherit'
    }
  }, h.residue < 0 ? '+' + durTxt(-h.residue) + ' oltre contratto' : durTxt(h.residue)), React.createElement("td", {
    className: "mono"
  }, durTxt(h.reducible))))))), DAYS.map((dn, d) => P.deskGrid[d] && React.createElement("div", {
    key: d
  }, React.createElement("div", {
    className: "day-h"
  }, dn, " · ", m2t(plan.open[d][0]), "-", m2t(plan.open[d][1])), React.createElement(CoverageStrip, {
    cells: P.deskGrid[d]
  }), React.createElement("table", {
    className: "t",
    style: {
      marginTop: 6
    }
  }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", {
    style: {
      width: 140
    }
  }, "Turno"), React.createElement("th", null, "Operatore di accettazione"))), React.createElement("tbody", null, P.deskShifts.filter(s => s.d === d).map((s, i) => React.createElement("tr", {
    key: i
  }, React.createElement("td", {
    className: "tt"
  }, m2t(s.s), " → ", m2t(s.e)), React.createElement("td", null, plan.byId[s.personId].nome, s.pausa && React.createElement("span", {
    className: "pill",
    style: {
      marginLeft: 6
    }
  }, "pausa ", m2t(s.pausa[0]), "–", m2t(s.pausa[1])), React.createElement("span", {
    className: "note"
  }, " · ", durTxt(s.work != null ? s.work : s.e - s.s - (s.presenza ? LUNCH : 0)), " lavorate", s.presenza ? ', ' + durTxt(s.e - s.s) + ' di presenza' : '')))), P.deskShifts.filter(s => s.d === d).length === 0 && React.createElement("tr", null, React.createElement("td", {
    colSpan: "2",
    style: {
      color: 'var(--red)'
    }
  }, "Nessun operatore disponibile")))))), React.createElement("div", {
    className: "legend"
  }, React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--green)'
    }
  }), "Coperto (", deskLabel(plan.desk), ")"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#1d6b41'
    }
  }), "Sopra il fabbisogno (sovrapposizione)"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#D9A441'
    }
  }), "Sotto il fabbisogno da carico ambulatori (minimo rispettato)"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--red)'
    }
  }), "Sotto il minimo del turno")));
}
function roomGrid(str, plan, r, medFilter) {
  const days = [0, 1, 2, 3, 4, 5, 6].filter(d => plan.open[d]);
  const lo = Math.min(...days.map(d => plan.open[d][0])),
    hi = Math.max(...days.map(d => plan.open[d][1]));
  const rows = [];
  for (let m = lo; m < hi; m += 30) {
    const cells = days.map(d => {
      if (!plan.open[d] || m < plan.open[d][0] || m >= plan.open[d][1]) return {
        k: 'closed'
      };
      const pr = plan.prelievi.find(x => x.roomId === r.id && x.d === d && x.s <= m && x.e > m);
      if (pr) return {
        k: 'prel',
        pr,
        start: pr.s === m,
        span: (pr.e - pr.s) / 30
      };
      const a = plan.assigns.find(x => x.roomId === r.id && x.d === d && x.s <= m && x.e > m);
      if (a && medFilter && a.medId !== medFilter) return {
        k: 'other',
        a
      };
      if (a) return {
        k: 'occ',
        a,
        start: a.s === m,
        span: (a.e - a.s) / 30
      };
      const av = intersectM(rangesM(r.disp[d]), plan.open[d]).some(([x, y]) => x <= m && y >= m + 30);
      return {
        k: av ? 'free' : 'na'
      };
    });
    rows.push({
      m,
      cells
    });
  }
  return {
    days,
    rows,
    lo,
    hi
  };
}
function AssignView({
  str,
  plan,
  brand
}) {
  const [d, setD] = useState(0);
  const [slot, setSlot] = useState(0);
  const [medSel, setMedSel] = useState('');
  const medici = mediciDi(str);
  const medFilter = medici.some(m => m.id === medSel) ? medSel : '';
  const medObj = medFilter ? plan.byId[medFilter] : null;
  const roomsShown = medFilter ? str.ambulatori.filter(r => plan.assigns.some(a => a.medId === medFilter && a.roomId === r.id)) : str.ambulatori;
  const unShown = medFilter ? plan.unassigned.filter(u => u.medId === medFilter) : plan.unassigned;
  const days = Object.keys(plan.open).filter(k => plan.open[k]).map(Number);
  const dd = days.includes(d) ? d : days[0] !== undefined ? days[0] : 0;
  const slots = plan.open[dd] ? Array.from({
    length: (plan.open[dd][1] - plan.open[dd][0]) / 30
  }, (_, i) => plan.open[dd][0] + i * 30) : [];
  const curM = slots[Math.min(slot, Math.max(0, slots.length - 1))] || 0;
  const statusFn = rid => {
    const r = plan.byId[rid];
    const availToday = plan.open[dd] && intersectM(rangesM(r.disp[dd]), plan.open[dd]) || [];
    if (!availToday.some(([a, b]) => a <= curM && b >= curM + 30)) return {
      state: 'na',
      label: 'non disponibile'
    };
    const pr = plan.prelievi.find(x => x.roomId === rid && x.d === dd && x.s <= curM && x.e > curM);
    if (pr) return {
      state: 'occ',
      label: 'Punto Prelievi',
      time: m2t(pr.s) + '–' + m2t(pr.e)
    };
    const a = plan.assigns.find(x => x.roomId === rid && x.d === dd && x.s <= curM && x.e > curM);
    if (a) return {
      state: 'occ',
      label: plan.byId[a.medId].nome,
      spec: medDiscTxt(plan.byId[a.medId]),
      time: m2t(a.s) + '–' + m2t(a.e),
      san: a.sanId ? plan.byId[a.sanId].nome : null
    };
    return {
      state: 'free',
      label: 'libero'
    };
  };
  return React.createElement("div", null, React.createElement("div", {
    className: "exp"
  }, React.createElement("button", {
    className: "btn",
    onClick: () => exportAssXLSX(str, plan)
  }, "Scarica XLSX"), React.createElement("button", {
    className: "btn",
    onClick: () => exportAssPDF(str, plan, brand)
  }, "Scarica PDF"), React.createElement("select", {
    style: { width: 'auto', minWidth: 220, marginLeft: 10 },
    value: medFilter,
    onChange: e => setMedSel(e.target.value),
    title: "Mostra in agenda solo la programmazione del medico selezionato"
  }, React.createElement("option", { value: "" }, "Tutti i medici"), medici.map(m => React.createElement("option", { key: m.id, value: m.id }, m.nome, medDiscTxt(m) ? ' · ' + medDiscTxt(m) : ''))), React.createElement("button", {
    className: "btn",
    onClick: () => exportMedPDF(str, plan, brand, medFilter || null),
    title: medFilter ? 'PDF con la programmazione settimanale del solo medico selezionato' : 'PDF con la programmazione settimanale di tutti i medici, una pagina per medico'
  }, "Scarica PDF per Medico")), medObj && React.createElement("div", {
    className: "card",
    style: { padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }
  }, React.createElement("strong", null, medObj.nome), React.createElement("span", { className: "meta" }, medDiscTxt(medObj)), React.createElement("span", { className: "meta" }, plan.assigns.filter(a => a.medId === medFilter).length, " sessioni · ", durTxt(plan.assigns.filter(a => a.medId === medFilter).reduce((t, a) => t + (a.e - a.s), 0)), "/settimana", unShown.length ? ' · ' + unShown.length + ' non allocate' : ''), React.createElement("span", { className: "sp" }), React.createElement("span", { className: "meta" }, "In agenda: solo le sessioni di questo medico; le altre occupazioni sono in grigio."), React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setMedSel('')
  }, "Mostra tutti")), str.ambulatori.length === 0 && React.createElement("div", {
    className: "empty"
  }, "Nessun ambulatorio configurato."), medObj && roomsShown.length === 0 && React.createElement("div", {
    className: "empty"
  }, "Nessuna sessione allocata per questo medico" + (unShown.length ? ': vedi le sessioni non allocate qui sotto.' : '.')), roomsShown.map(r => {
    const g = roomGrid(str, plan, r, medFilter || null);
    const st = plan.roomStats[r.id] || {};
    const sessions = plan.assigns.filter(a => a.roomId === r.id && (!medFilter || a.medId === medFilter)).length;
    return React.createElement("div", {
      key: r.id,
      className: "card",
      style: {
        padding: '12px 14px'
      }
    }, React.createElement("div", {
      className: "roomhead",
      style: {
        marginTop: 0
      }
    }, React.createElement("h3", null, r.nome), React.createElement("span", {
      className: "meta"
    }, isPrelievi(r) ? 'Punto Prelievi (polivalente fuori orario prelievi)' : r.discipline.length ? r.discipline.join(', ') + (roomExclusive(r) ? ' (esclusivo)' : ' (preferenziale, aperto ad altre specialità)') : 'Polivalente', r.soloVincolati ? ' · solo medici vincolati' : '', r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : '', r.mq ? ' · ' + r.mq + ' mq' : ''), React.createElement("span", {
      className: "sp"
    }), React.createElement("span", {
      className: "meta"
    }, sessions, " sessioni", st.slots ? ' · ' + st.slots + ' slot/settimana' : '', " · utilizzo ", st.util != null ? st.util + '%' : '-', st.avail != null ? ' · libero ' + durTxt(Math.max(0, st.avail - (st.busy || 0))) : '')), React.createElement("table", {
      className: "wk"
    }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", {
      className: "tm"
    }), g.days.map(d => React.createElement("th", {
      key: d
    }, DAYS[d])))), React.createElement("tbody", null, g.rows.map(row => React.createElement("tr", {
      key: row.m
    }, React.createElement("td", {
      className: "tm"
    }, m2t(row.m)), row.cells.map((c, i) => {
      if ((c.k === 'occ' || c.k === 'prel') && !c.start) return null;
      if (c.k === 'prel') return React.createElement("td", {
        key: i,
        className: "occ prel",
        rowSpan: c.span,
        title: 'Punto Prelievi ' + m2t(c.pr.s) + '-' + m2t(c.pr.e)
      }, React.createElement("div", {
        className: "sp1"
      }, "Punto Prelievi"), React.createElement("div", {
        className: "sp3"
      }, m2t(c.pr.s), "–", m2t(c.pr.e)));
      if (c.k === 'occ') {
        const m = plan.byId[c.a.medId];
        return React.createElement("td", {
          key: i,
          className: 'occ' + (c.a.partial ? ' partial' : ''),
          rowSpan: c.span,
          title: m2t(c.a.s) + '-' + m2t(c.a.e) + ' · ' + m.nome + (c.a.sanId ? ' · supporto ' + plan.byId[c.a.sanId].nome : '') + (c.a.partial ? ' · fascia ridotta' : '')
        }, React.createElement("div", {
          className: "sp1"
        }, medDiscTxt(m) || '—'), React.createElement("div", {
          className: "sp2"
        }, m.nome), React.createElement("div", {
          className: "sp3"
        }, m2t(c.a.s), "–", m2t(c.a.e), c.a.slots != null ? ' · ' + c.a.slots + ' slot da ' + m.durataPrestazione + "'" : '', c.a.sanId ? ' · ' + plan.byId[c.a.sanId].nome : '', m.note ? ' · ' + m.note : ''));
      }
      return React.createElement("td", {
        key: i,
        className: c.k === 'other' ? 'na other' : c.k,
        title: c.k === 'na' ? 'ambulatorio non disponibile' : c.k === 'free' ? 'libero' : c.k === 'other' ? 'occupato da ' + plan.byId[c.a.medId].nome + ' ' + m2t(c.a.s) + '-' + m2t(c.a.e) : ''
      });
    }))))));
  }), React.createElement("div", {
    className: "legend"
  }, React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--p)'
    }
  }), "Sessione medica"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--p2)'
    }
  }), "Fascia ridotta rispetto alla disponibilità del medico"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#7A4E9E'
    }
  }), "Attività Punto Prelievi"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#F5F8F9',
      border: '1px solid var(--line)'
    }
  }), "Libero"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'repeating-linear-gradient(135deg,#DDE4E7 0 2px,#F8FAFB 2px 4px)'
    }
  }), "Non disponibile")), unShown.length > 0 && React.createElement("div", {
    className: "card",
    style: {
      marginTop: 14
    }
  }, React.createElement("h3", {
    style: {
      color: 'var(--red)'
    }
  }, "Medici non allocati"), React.createElement("table", {
    className: "t"
  }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Medico"), React.createElement("th", null, "Giorno"), React.createElement("th", null, "Fascia"), React.createElement("th", null, "Motivo"))), React.createElement("tbody", null, unShown.map((u, i) => React.createElement("tr", {
    key: i
  }, React.createElement("td", null, plan.byId[u.medId].nome), React.createElement("td", null, DAYS[u.d]), React.createElement("td", {
    className: "tt"
  }, m2t(u.s), "–", m2t(u.e)), React.createElement("td", null, u.reason)))))), React.createElement("div", {
    className: "card",
    style: {
      marginTop: 18
    }
  }, React.createElement("h3", null, "Vista sulla planimetria"), React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 8
    }
  }, React.createElement("select", {
    style: {
      width: 'auto'
    },
    value: dd,
    onChange: e => {
      setD(+e.target.value);
      setSlot(0);
    }
  }, days.map(x => React.createElement("option", {
    key: x,
    value: x
  }, DAYS[x]))), React.createElement("input", {
    type: "range",
    min: "0",
    max: Math.max(0, slots.length - 1),
    value: Math.min(slot, Math.max(0, slots.length - 1)),
    onChange: e => setSlot(+e.target.value),
    style: {
      flex: 1,
      minWidth: 180
    },
    "aria-label": "Ora del giorno"
  }), React.createElement("span", {
    className: "tt",
    style: {
      fontWeight: 600
    }
  }, m2t(curM))), React.createElement(PlanCanvas, {
    str: str,
    mode: "view",
    statusFn: statusFn
  }), React.createElement("div", {
    className: "legend"
  }, React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--p)'
    }
  }), "Occupato"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--amber)'
    }
  }), "Libero"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#8CA2AA'
    }
  }), "Non disponibile"))));
}
function FreeView({
  str,
  plan,
  brand
}) {
  const [q, setQ] = useState({
    d: 0,
    from: '09:00',
    to: '12:00',
    eq: [],
    disc: ''
  });
  const match = useMemo(() => {
    const s = t2m(q.from),
      e = t2m(q.to);
    if (e <= s) return [];
    return str.ambulatori.filter(r => {
      if (q.disc && r.discipline.length && roomExclusive(r) && !r.discipline.includes(q.disc)) return false;
      if (!q.eq.every(x => r.attrezzature.includes(x))) return false;
      return plan.free.some(f => f.roomId === r.id && f.d === +q.d && f.s <= s && f.e >= e);
    });
  }, [q, plan, str]);
  const tot = plan.free.reduce((t, f) => t + (f.e - f.s), 0);
  return React.createElement("div", null, React.createElement("div", {
    className: "exp"
  }, React.createElement("button", {
    className: "btn",
    onClick: () => exportFreeXLSX(str, plan)
  }, "Scarica XLSX"), React.createElement("button", {
    className: "btn",
    onClick: () => exportFreePDF(str, plan, brand)
  }, "Scarica PDF"), React.createElement("span", {
    className: "pill grn",
    style: {
      marginLeft: 'auto'
    }
  }, "Capacità residua: ", durTxt(tot), "/settimana")), React.createElement("div", {
    className: "card"
  }, React.createElement("h3", null, "Verifica inserimento nuovo medico"), React.createElement("div", {
    className: "rowline"
  }, React.createElement("select", {
    style: {
      width: 'auto'
    },
    value: q.d,
    onChange: e => setQ({
      ...q,
      d: e.target.value
    })
  }, DAYS.map((x, i) => React.createElement("option", {
    key: i,
    value: i
  }, x))), React.createElement("input", {
    type: "time",
    step: "1800",
    value: q.from,
    onChange: e => setQ({
      ...q,
      from: e.target.value
    })
  }), React.createElement("span", {
    className: "mono"
  }, "→"), React.createElement("input", {
    type: "time",
    step: "1800",
    value: q.to,
    onChange: e => setQ({
      ...q,
      to: e.target.value
    })
  }), React.createElement("input", {
    list: "disclist2",
    style: {
      width: 180
    },
    placeholder: "Disciplina (opz.)",
    value: q.disc,
    onChange: e => setQ({
      ...q,
      disc: e.target.value
    })
  }), React.createElement("datalist", {
    id: "disclist2"
  }, [...DISC, ...(str.extraDisc || [])].map(x => React.createElement("option", {
    key: x,
    value: x
  })))), React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, React.createElement(ChipPicker, {
    value: q.eq,
    onChange: v => setQ({
      ...q,
      eq: v
    }),
    options: [...EQUIP, ...(str.extraEquip || [])]
  })), React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, match.length ? React.createElement("span", null, "Disponibili: ", match.map(r => React.createElement("span", {
    className: "pill grn",
    key: r.id
  }, r.nome))) : React.createElement("span", {
    className: "pill red"
  }, "Nessun ambulatorio compatibile e libero nella fascia richiesta"))), str.ambulatori.map(r => {
    const g = roomGrid(str, plan, r);
    const st = plan.roomStats[r.id] || {};
    const fr = plan.free.filter(f => f.roomId === r.id);
    const tot = fr.reduce((t, f) => t + (f.e - f.s), 0);
    const freeAt = (d, m) => fr.find(f => f.d === d && f.s <= m && f.e > m);
    return React.createElement("div", {
      key: r.id,
      className: "card",
      style: {
        padding: '12px 14px'
      }
    }, React.createElement("div", {
      className: "roomhead",
      style: {
        marginTop: 0
      }
    }, React.createElement("h3", null, r.nome), React.createElement("span", {
      className: "meta"
    }, isPrelievi(r) ? 'Punto Prelievi (polivalente fuori orario prelievi)' : r.discipline.length ? r.discipline.join(', ') + (roomExclusive(r) ? ' (esclusivo)' : ' (preferenziale, aperto ad altre specialità)') : 'Polivalente', r.soloVincolati ? ' · solo medici vincolati' : '', r.attrezzature.length ? ' · ' + r.attrezzature.join(', ') : '', r.mq ? ' · ' + r.mq + ' mq' : ''), React.createElement("span", {
      className: "sp"
    }), React.createElement("span", {
      className: 'pill ' + (tot > 0 ? 'grn' : '')
    }, tot > 0 ? 'libero ' + durTxt(tot) + '/settimana in ' + fr.length + ' fasce' : 'saturo')), React.createElement("table", {
      className: "wk"
    }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", {
      className: "tm"
    }), g.days.map(d => React.createElement("th", {
      key: d
    }, DAYS[d])))), React.createElement("tbody", null, g.rows.map(row => React.createElement("tr", {
      key: row.m
    }, React.createElement("td", {
      className: "tm"
    }, m2t(row.m)), row.cells.map((c, i) => {
      const d = g.days[i];
      if (c.k === 'closed') return React.createElement("td", {
        key: i,
        className: "closed"
      });
      if (c.k === 'na') return React.createElement("td", {
        key: i,
        className: "na",
        title: "ambulatorio non disponibile"
      });
      const f = freeAt(d, row.m);
      if (f) {
        if (f.s !== row.m) return null;
        return React.createElement("td", {
          key: i,
          className: "freeblk",
          rowSpan: (f.e - f.s) / 30,
          title: 'libero ' + m2t(f.s) + '-' + m2t(f.e)
        }, React.createElement("div", {
          className: "sp1"
        }, "Libero · ", durTxt(f.e - f.s)), React.createElement("div", {
          className: "sp2"
        }, m2t(f.s), "–", m2t(f.e)));
      }
      return React.createElement("td", {
        key: i,
        className: "busy",
        title: c.k === 'occ' ? 'occupato: ' + plan.byId[c.a.medId].nome : c.k === 'prel' ? 'attività Punto Prelievi' : 'occupato'
      });
    }))))));
  }), React.createElement("div", {
    className: "legend"
  }, React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#E3F1E9',
      border: '1px solid #bfdccb'
    }
  }), "Fascia libera proponibile"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: '#DFE6E8'
    }
  }), "Occupato"), React.createElement("span", null, React.createElement("span", {
    className: "dot",
    style: {
      background: 'repeating-linear-gradient(135deg,#DDE4E7 0 2px,#F8FAFB 2px 4px)'
    }
  }), "Non disponibile")));
}
function CritView({
  plan
}) {
  return React.createElement("div", null, plan.crit.map((c, i) => React.createElement("div", {
    key: i,
    className: 'crit ' + (c.lv === 'media' ? 'm' : c.lv === 'info' ? 'i' : '')
  }, React.createElement("b", null, c.lv === 'alta' ? 'Criticità' : c.lv === 'media' ? 'Ottimizzazione' : 'Nota'), " · ", c.t)));
}
function ResultsTab({
  str,
  brand
}) {
  const plan = useMemo(() => computePlan(str), [str]);
  const [sub, setSub] = useState('desk');
  const nAlta = plan.crit.filter(c => c.lv === 'alta').length;
  const totFree = plan.free.reduce((t, f) => t + (f.e - f.s), 0);
  const totAss = plan.assigns.reduce((t, a) => t + (a.e - a.s), 0);
  return React.createElement("div", null, React.createElement("div", {
    className: "kpis"
  }, React.createElement("div", {
    className: "kpi"
  }, React.createElement("div", {
    className: "v"
  }, plan.deskShifts.length ? 'OK' : '-'), React.createElement("div", {
    className: "l"
  }, "Turni desk generati · ", (() => {
    const mn = plan.deskWeeks.reduce((t, w) => t + w.shortages.filter(x => x.missingMin > 0).length, 0),
      tg = plan.deskWeeks.reduce((t, w) => t + w.shortages.filter(x => !(x.missingMin > 0)).length, 0);
    return mn + ' sotto il minimo · ' + tg + ' sotto carico';
  })())), React.createElement("div", {
    className: "kpi"
  }, React.createElement("div", {
    className: "v"
  }, plan.assigns.length), React.createElement("div", {
    className: "l"
  }, "Sessioni mediche allocate · ", durTxt(totAss), (() => {
    const n = plan.assigns.reduce((t, a) => t + (a.slots || 0), 0);
    return n ? ' · ' + n + ' slot' : '';
  })())), React.createElement("div", {
    className: "kpi"
  }, React.createElement("div", {
    className: "v"
  }, durTxt(totFree)), React.createElement("div", {
    className: "l"
  }, "Capacità residua settimanale")), React.createElement("div", {
    className: "kpi"
  }, React.createElement("div", {
    className: "v",
    style: {
      color: nAlta ? 'var(--red)' : 'var(--green)'
    }
  }, nAlta), React.createElement("div", {
    className: "l"
  }, "Criticità da gestire"))), React.createElement("div", {
    className: "subtabs"
  }, [['desk', 'Copertura desk'], ['amb', 'Ambulatori e medici'], ['free', 'Spazi liberi'], ['crit', 'Criticità e ottimizzazioni']].map(([k, l]) => React.createElement("button", {
    key: k,
    className: 'subtab' + (sub === k ? ' on' : ''),
    onClick: () => setSub(k)
  }, l, k === 'crit' && nAlta > 0 && React.createElement("span", null, " (", nAlta, ")")))), React.createElement("p", {
    className: "note",
    style: {
      marginTop: -6
    }
  }, "Pianificazione ricalcolata in tempo reale a ogni modifica della configurazione. Ultimo calcolo: ", plan.generated, "."), sub === 'desk' && React.createElement(DeskView, {
    str: str,
    plan: plan,
    brand: brand
  }), sub === 'amb' && React.createElement(AssignView, {
    str: str,
    plan: plan,
    brand: brand
  }), sub === 'free' && React.createElement(FreeView, {
    str: str,
    plan: plan,
    brand: brand
  }), sub === 'crit' && React.createElement(CritView, {
    plan: plan
  }));
}
function Struttura({
  str,
  upd,
  onBack,
  brand
}) {
  const [tab, setTab] = useState('ana');
  const tabs = [['ana', 'Anagrafica'], ['amb', 'Ambulatori', str.ambulatori.length], ['per', 'Personale', str.personale.length], ['pla', 'Planimetria'], ['res', 'Pianificazione e controllo']];
  return React.createElement("div", null, React.createElement("div", {
    className: "rowline",
    style: {
      marginBottom: 8
    }
  }, React.createElement("button", {
    className: "btn ghost",
    onClick: onBack
  }, "← Strutture"), str.logo && React.createElement("img", {
    src: str.logo,
    alt: "",
    style: {
      height: 30,
      borderRadius: 6
    }
  }), React.createElement("h2", {
    style: {
      fontSize: 18,
      color: 'var(--p)'
    }
  }, (str.denominazione || 'Nuova struttura') + (str.nomeSede ? ' · ' + str.nomeSede : '')), str.siteManager && React.createElement("span", {
    className: "pill"
  }, "SM: ", str.siteManager)), React.createElement("div", {
    className: "tabs",
    role: "tablist"
  }, tabs.map(([k, l, n]) => React.createElement("button", {
    key: k,
    role: "tab",
    "aria-selected": tab === k,
    className: 'tab' + (tab === k ? ' on' : ''),
    onClick: () => setTab(k)
  }, l, n !== undefined && React.createElement("span", {
    className: "n"
  }, n)))), tab === 'ana' && React.createElement(Anagrafica, {
    str: str,
    upd: upd
  }), tab === 'amb' && React.createElement(AmbulatoriTab, {
    str: str,
    upd: upd
  }), tab === 'per' && React.createElement(PersonaleTab, {
    str: str,
    upd: upd
  }), tab === 'pla' && React.createElement(PlanimetriaTab, {
    str: str,
    upd: upd
  }), tab === 'res' && React.createElement(ResultsTab, {
    str: str,
    brand: brand
  }));
}
const DEF_C = {
  p: '#1C505E',
  p2: '#35768A',
  teal: '#71B1BD',
  amber: '#DEC0F1',
  green: '#2F8F5B',
  red: '#B03A2E'
};
const TD_LOGO = 'data:image/png;base64,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';
const APP_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTIwIiB3aWR0aD0iMjQwIiBoZWlnaHQ9IjI0MCI+CiAgPHJlY3Qgd2lkdGg9IjEyMCIgaGVpZ2h0PSIxMjAiIHJ4PSIyNyIgZmlsbD0iIzFDNTA1RSIvPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPgogICAgPCEtLSBUIC0tPgogICAgPHBhdGggZD0iTTE0IDM0IEggNTIgTSAzMyAzNCBWIDg2Ii8+CiAgICA8IS0tIEQ6IHBpYW50YSBkaSB1biBhbWJ1bGF0b3JpbyBjb24gZHVlIHN0YW56ZSAtLT4KICAgIDxwYXRoIGQ9Ik04MiAzNCBBIDI2IDI2IDAgMCAxIDgyIDg2IEggNjIgViAzNCBaIi8+CiAgICA8cGF0aCBkPSJNNjIgNjAgSCA3MiBNIDgwIDYwIEggMTAyIiBzdHJva2Utd2lkdGg9IjQiLz4KICA8L2c+CiAgPCEtLSBzdGFuemEgb2NjdXBhdGEgKHNvcHJhKSBlIHNsb3QgbGliZXJvIChzb3R0bykgLS0+CiAgPHJlY3QgeD0iNjkiIHk9IjQyIiB3aWR0aD0iMjQiIGhlaWdodD0iMTAiIHJ4PSIyLjUiIGZpbGw9IiM3MUIxQkQiLz4KICA8cmVjdCB4PSI2OSIgeT0iNjgiIHdpZHRoPSIyNCIgaGVpZ2h0PSIxMCIgcng9IjIuNSIgZmlsbD0iI0RFQzBGMSIvPgo8L3N2Zz4K';
export { Struttura, computePlan, DAYS, DAYS_S, DISC, EQUIP, DEF_C, TD_LOGO, APP_ICON, newStruttura, clone, uid, durTxt, medDiscTxt, isPrelievi, roomExclusive };
