// Business Hub · modulo TD-SGI-MOD173_00 "Anagrafica Clienti B2B" in PDF (richiesta del CEO del 06/11/2026: "il modulo in allegato come
// form da compilare"). Impaginato come il modulo del Sistema di Gestione Integrato (logo, recapiti, riquadro di registrazione, sezioni con
// la fascia verde scuro, tabelle a quattro colonne, piè con i dati societari) con pdf-lib, in due versioni:
// - "compilabile": campi modulo PDF (AcroForm) già riempiti con quello che la Suite sa del cliente, da completare con un lettore PDF;
// - "compilato": i dati inviati dalla form online stampati nel modulo, archiviato nel fascicolo del cliente.
// Font standard Helvetica (WinAnsi): i caratteri fuori dalla codifica diventano "?" invece di bloccare la generazione.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { CAMPO_MOD173 } from './processo.js';

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'logo-td.png');
export const CODICE_MOD173 = 'TD-SGI-MOD173_00';
const VERDE = rgb(0x0c / 255, 0x35 / 255, 0x12 / 255);
const TEAL = rgb(0x1b / 255, 0x50 / 255, 0x5f / 255);
const GRIGIO = rgb(0.35, 0.4, 0.42);
const NERO = rgb(0.1, 0.1, 0.1);
const BORDO = rgb(0.55, 0.6, 0.6);
const SFONDO = rgb(0.96, 0.97, 0.97);
const X0 = 40; const W = 515;

/** Testo nella codifica WinAnsi dei font standard (lettere accentate, €, virgolette tipografiche); il resto diventa "?". */
export const winAnsi = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF€‘’“”–—…•]/g, '?');

// Righe delle sezioni: coppie [sinistra, destra] di chiavi del modulo (null = cella vuota)
const RIGHE = {
  identificazione: [['ragione_sociale', 'servizi_contratto'], ['piva', 'laboratorio_riferimento'], ['codice_fiscale', 'cap'], ['codice_sdi', 'riferimento_fatturazione'],
    ['indirizzo', 'email'], ['citta', 'telefono'], ['nazione', 'pec']],
  servizio: [['svc_contatto', 'svc_email'], ['svc_cellulare', 'svc_indirizzo']],
  approvvigionamento: [['proc_contatto', 'proc_email'], ['proc_cellulare', 'proc_indirizzo']],
  pagamento: [['metodo_pagamento', 'valuta'], ['termine_pagamento', 'ritenuta'], ['territorialita_iva', 'dichiarazione_intento'], ['split_payment', 'tax_values']],
};
const SCELTE = { stato: ['Attiva', 'Non attiva'], business_line: ['B2C', 'Service di Laboratorio', 'Medicina del Lavoro'], ritenuta: ['', 'Sì', 'No'], split_payment: ['', 'Sì', 'No'] };

/**
 * Genera il PDF. dati: valori dei campi (chiavi di CAMPI_MOD173); opz: { modalita: 'compilabile'|'compilato', company, data (YYYY-MM-DD),
 * cliente, inviata_at, versione }. Ritorna un Buffer.
 */
export async function mod173Pdf(dati = {}, { modalita = 'compilato', company = {}, data = null, cliente = '', versione = null } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${CODICE_MOD173} · Anagrafica Clienti B2B${cliente ? ` · ${winAnsi(cliente)}` : ''}`);
  doc.setAuthor(company.legal_name || 'Toscana Diagnostica S.r.l.'); doc.setCreator('Suite TD · Business Hub'); doc.setProducer('Suite TD'); doc.setLanguage('it-IT');
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = modalita === 'compilabile' ? doc.getForm() : null;
  const H = page.getHeight();
  const txt = (s, x, y, o = {}) => page.drawText(winAnsi(s), { x, y, size: o.size || 7.5, font: o.bold ? fb : f, color: o.color || NERO });
  const destra = (s, xr, y, o = {}) => { const t = winAnsi(s); const w = (o.bold ? fb : f).widthOfTextAtSize(t, o.size || 7.5); txt(t, xr - w, y, o); };
  const centro = (s, x, w, y, o = {}) => { const t = winAnsi(s); const tw = (o.bold ? fb : f).widthOfTextAtSize(t, o.size || 7.5); txt(t, x + (w - tw) / 2, y, o); };
  const box = (x, y, w, h, o = {}) => page.drawRectangle({ x, y, width: w, height: h, borderColor: o.border === false ? undefined : BORDO, borderWidth: o.border === false ? 0 : 0.6, color: o.fill });
  /** Valore di un campo: nel compilabile un campo modulo (testo o tendina), nel compilato il testo che si riduce per stare nella cella. */
  const valore = (k, x, y, w, h, { multiline = false } = {}) => {
    const v = winAnsi(dati[k] ?? '');
    if (form) {
      if (SCELTE[k]) {
        const dd = form.createDropdown(`mod173.${k}`); dd.addOptions(SCELTE[k].map(winAnsi)); if (v && SCELTE[k].map(winAnsi).includes(v)) dd.select(v);
        dd.addToPage(page, { x: x + 1, y: y + 1, width: w - 2, height: h - 2, font: f, borderWidth: 0, backgroundColor: rgb(0.93, 0.97, 1) });
        dd.setFontSize(7);
      } else {
        const tf = form.createTextField(`mod173.${k}`); if (multiline) tf.enableMultiline(); if (v) tf.setText(v);
        tf.addToPage(page, { x: x + 1, y: y + 1, width: w - 2, height: h - 2, font: f, borderWidth: 0, backgroundColor: rgb(0.93, 0.97, 1) });
        tf.setFontSize(multiline ? 8 : 7);
      }
      return;
    }
    if (!v) return;
    if (multiline) {
      // a capo per parole dentro il riquadro delle note
      const parole = v.split(' '); const righe = []; let cur = '';
      for (const p of parole) { const t = cur ? `${cur} ${p}` : p; if (f.widthOfTextAtSize(t, 8) > w - 8) { righe.push(cur); cur = p; } else cur = t; }
      if (cur) righe.push(cur);
      righe.slice(0, Math.floor((h - 6) / 10)).forEach((r, i) => txt(r, x + 4, y + h - 11 - i * 10, { size: 8 }));
      return;
    }
    let size = 7.5;
    while (size > 5 && f.widthOfTextAtSize(v, size) > w - 6) size -= 0.25;
    let t = v; while (f.widthOfTextAtSize(t, size) > w - 6 && t.length > 4) t = `${t.slice(0, -2)}…`;
    txt(t, x + 3, y + (h - size) / 2 + 1, { size });
  };

  // ---- intestazione: logo, recapiti, codice del modulo
  try {
    const png = await doc.embedPng(fs.readFileSync(LOGO));
    const lw = 170; const lh = lw * png.height / png.width;
    page.drawImage(png, { x: X0, y: H - 40 - lh, width: lw, height: lh });
  } catch { txt('TOSCANA DIAGNOSTICA', X0, H - 60, { bold: true, size: 14, color: TEAL }); }
  [company.email, company.pec, company.website].filter(Boolean).forEach((s, i) => destra(s, X0 + W, H - 42 - i * 11, { size: 8, color: TEAL }));
  txt(`${CODICE_MOD173} · Modulo di registrazione Anagrafica Clienti B2B`, X0, H - 92, { size: 7, color: GRIGIO });

  // ---- riquadro "Registrazione dell'Anagrafica" (in alto a destra)
  const rx = X0 + W - 230; const rw = 230; let ry = H - 112;
  box(rx, ry, rw, 13, { fill: VERDE }); centro('Registrazione dell\'Anagrafica', rx, rw, ry + 3.5, { bold: true, color: rgb(1, 1, 1), size: 8 });
  const reg = [['Data', 'data_registrazione'], ['Stato', 'stato'], ['Business Line', 'business_line']];
  for (const [l, k] of reg) {
    ry -= 14; box(rx, ry, 70, 14); box(rx + 70, ry, rw - 70, 14);
    txt(l, rx + 3, ry + 4, { bold: true });
    if (k === 'data_registrazione') txt(data ? data.split('-').reverse().join('/') : '____/____/________', rx + 73, ry + 4);
    else valore(k, rx + 70, ry, rw - 70, 14);
  }

  // ---- sezioni
  let y = ry - 18;
  const fascia = (titolo, sotto) => {
    y -= 13; box(X0, y, W, 13, { fill: VERDE }); centro(titolo, X0, W, y + 3.5, { bold: true, color: rgb(1, 1, 1), size: 8.5 });
    if (sotto) { y -= 12; box(X0, y, W, 12, { fill: SFONDO }); centro(sotto, X0, W, y + 3, { bold: true, size: 8, color: VERDE }); }
  };
  const LW = 105; const VW = (W - 2 * LW) / 2;
  const riga4 = ([a, b], h = 15) => {
    y -= h;
    for (const [i, k] of [[0, a], [1, b]]) {
      const x = X0 + i * (LW + VW);
      box(x, y, LW, h, { fill: SFONDO }); box(x + LW, y, VW, h);
      if (!k) continue;
      const c = CAMPO_MOD173[k];
      const lab = c?.label || k; let size = 7;
      while (fb.widthOfTextAtSize(winAnsi(lab), size) > LW - 6 && size > 5.5) size -= 0.25;
      centro(lab, x, LW, y + (h - size) / 2 + 1, { bold: true, size });
      valore(k, x + LW, y, VW, h);
    }
  };
  fascia('ANAGRAFICA', 'IDENTIFICAZIONE DEL CLIENTE/PARTNER');
  RIGHE.identificazione.forEach((r) => riga4(r));
  y -= 10; fascia('RIFERIMENTI PER LA GESTIONE DEL SERVIZIO'); RIGHE.servizio.forEach((r) => riga4(r, 17));
  y -= 10; fascia('RIFERIMENTI PER L\'APPROVVIGIONAMENTO'); RIGHE.approvvigionamento.forEach((r) => riga4(r, 17));
  y -= 10; fascia('CONDIZIONI DI PAGAMENTO', 'CONDIZIONI DI PAGAMENTO E CLASSIFICAZIONE FISCALE'); RIGHE.pagamento.forEach((r) => riga4(r));
  y -= 10; fascia('ISTITUTO DI CREDITO DI RIFERIMENTO', 'BANCA DEL CLIENTE/PARTNER');
  for (const k of ['banca_nome', 'iban']) {
    y -= 15; box(X0, y, LW, 15, { fill: SFONDO }); box(X0 + LW, y, W - LW, 15);
    centro(CAMPO_MOD173[k].label, X0, LW, y + 5, { bold: true, size: 7.5 }); valore(k, X0 + LW, y, W - LW, 15);
  }
  y -= 10; fascia('NOTE');
  const hn = Math.max(40, y - 92);
  y -= hn; box(X0, y, W, hn); valore('note', X0, y, W, hn, { multiline: true });

  // ---- piè di pagina: dati societari dai Dati aziendali della Suite
  const indirizzo = [company.address, [company.zip, company.city].filter(Boolean).join(' ') + (company.province ? ` (${company.province})` : '')].filter((x) => x && x.trim()).join(', ');
  centro(company.legal_name || 'Toscana Diagnostica S.r.l.', X0, W, 58, { bold: true, size: 8, color: TEAL });
  centro([indirizzo, company.phone ? `Tel. ${company.phone}` : null, company.health_director ? `Direttore Sanitario: ${company.health_director}` : null].filter(Boolean).join('. '), X0, W, 47, { size: 7, color: TEAL });
  centro([company.vat ? `P.IVA e C.F.: ${company.vat}` : null, company.rea ? `REA n. ${company.rea}` : null, company.share_capital ? `Capitale Sociale: ${company.share_capital}` : null].filter(Boolean).join(' – '), X0, W, 37, { size: 7, color: TEAL });
  txt(`${CODICE_MOD173} rev. 00${modalita === 'compilato' ? ` · compilato online${versione ? ` (versione ${versione})` : ''}` : ' · versione compilabile'}`, X0, 22, { size: 6.5, color: GRIGIO });
  destra('Pagina 1 di 1', X0 + W, 22, { size: 6.5, color: GRIGIO });

  if (form) form.updateFieldAppearances(f);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
