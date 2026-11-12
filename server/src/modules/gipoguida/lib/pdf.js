// Guida GIPO · PDF completo della guida (GET /api/gipoguida/guida.pdf) dalle sezioni correnti del database, con pdfkit e lo stile dei PDF
// della Suite (font LiberationSans, logo e colori di lib/orgchartExport.js e ticket/lib/export.js; dati aziendali da lib/company.js).
// Struttura: copertina (edizione, data, avvertenze), indice con numeri di pagina e collegamenti, un capitolo per pagina nuova, ogni sezione
// con il bollino "da validare con un referente GIPO" o "validata", appendice con le FAQ pubblicate per capitolo. Intestazione e piè di
// pagina (versione della Suite, data di aggiornamento della guida, pagina n di N) su tutte le pagine tranne la copertina.
// Cache in memoria: la chiave cambia a ogni modifica di sezioni, capitoli o FAQ (e con la versione della Suite); invalidaPdf() la svuota.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { getCompany } from '../../../lib/company.js';
import { APP_VERSION } from '../../../version.js';
import { many, one } from '../db.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shipments', 'assets');
const FONT_R = path.join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_B = path.join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', bg: '#F3F7F8', white: '#FFFFFF',
  amber: '#8A4B00', amberBg: '#FFF1DC', amberLine: '#E0A84F', green: '#2F7D5B', greenBg: '#E3F2EA' };
const W = 595.28; const H = 841.89;
const M = { top: 66, bottom: 58, left: 52, right: 52 };
const TW = W - M.left - M.right;
const itData = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

// ---------------------------------------------------------------- dati
async function dati() {
  const capitoli = await many('SELECT numero, titolo, intro FROM capitoli ORDER BY numero');
  const sezioni = await many(`SELECT s.id, s.capitolo, s.ordine, s.titolo, s.slug, s.corpo, s.percorso_gipo, s.stato, s.validata_il, s.aggiornata_il,
      s.capitolo || '.' || row_number() OVER (PARTITION BY s.capitolo ORDER BY s.ordine, s.id) AS numero
    FROM sezioni s ORDER BY s.capitolo, s.ordine, s.id`);
  const faq = await many(`SELECT f.id, f.domanda, f.risposta, f.sezione_id, s.capitolo FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id
    WHERE f.pubblicata ORDER BY s.capitolo NULLS LAST, f.ordine, f.id`);
  const agg = await one(`SELECT greatest((SELECT max(aggiornata_il) FROM sezioni), (SELECT max(aggiornata_il) FROM faq), (SELECT max(updated_at) FROM capitoli)) AS at`);
  return { capitoli, sezioni, faq, aggiornata: agg?.at || new Date() };
}

// ---------------------------------------------------------------- markdown → blocchi (sottoinsieme usato dalla guida)
/** Blocchi: { t: 'h', livello, testo } | { t: 'p', testo } | { t: 'ul'|'ol', voci } | { t: 'quote', testo } | { t: 'table', righe }. Funzione pura. */
export function blocchiMarkdown(src) {
  const righe = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < righe.length) {
    const r = righe[i];
    if (!r.trim() || /^\s*-{3,}\s*$/.test(r)) { i++; continue; }
    const h = r.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ t: 'h', livello: h[1].length, testo: h[2].trim() }); i++; continue; }
    if (/^\s*>/.test(r)) {
      const buf = [];
      while (i < righe.length && /^\s*>/.test(righe[i])) buf.push(righe[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', testo: buf.join(' ').trim() });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(r)) {
      const voci = [];
      while (i < righe.length && (/^\s*[-*+]\s+/.test(righe[i]) || (/^\s{2,}\S/.test(righe[i]) && voci.length))) {
        if (/^\s*[-*+]\s+/.test(righe[i])) voci.push(righe[i].replace(/^\s*[-*+]\s+/, '')); else voci[voci.length - 1] += ` ${righe[i].trim()}`;
        i++;
      }
      out.push({ t: 'ul', voci });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(r)) {
      const voci = [];
      while (i < righe.length && (/^\s*\d+[.)]\s+/.test(righe[i]) || (/^\s{2,}\S/.test(righe[i]) && voci.length))) {
        if (/^\s*\d+[.)]\s+/.test(righe[i])) voci.push(righe[i].replace(/^\s*\d+[.)]\s+/, '')); else voci[voci.length - 1] += ` ${righe[i].trim()}`;
        i++;
      }
      out.push({ t: 'ol', voci });
      continue;
    }
    if (/^\|.*\|\s*$/.test(r)) {
      const tab = [];
      while (i < righe.length && /^\|.*\|\s*$/.test(righe[i])) { if (!/^\|?\s*:?-{2,}/.test(righe[i])) tab.push(righe[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      out.push({ t: 'table', righe: tab });
      continue;
    }
    const buf = [];
    while (i < righe.length && righe[i].trim() && !/^(#{1,6}\s|\s*>|\s*[-*+]\s+|\s*\d+[.)]\s+|\|)/.test(righe[i])) buf.push(righe[i++].trim());
    out.push({ t: 'p', testo: buf.join(' ') });
  }
  return out;
}

/** Testo in linea → segmenti { testo, grassetto, codice } (corsivo reso in tondo; collegamenti come testo, con il numero della sezione). */
export function segmenti(testo, numeroDi = () => null) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;
  let last = 0; let m;
  const s = String(testo || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ testo: s.slice(last, m.index) });
    if (m[1]) out.push({ testo: m[2], grassetto: true });
    else if (m[3]) {
      const dest = m[5];
      const sez = dest.startsWith('sezione:') ? numeroDi(dest.slice(8)) : null;
      out.push({ testo: m[4], grassetto: false, link: true });
      // "(vedi [titolo](sezione:x))" → "(vedi titolo, sez. 8.4)": niente doppie parentesi
      if (sez) out.push({ testo: s[m.index + m[0].length] === ')' ? `, sez. ${sez}` : ` (sez. ${sez})` });
      else if (/^https?:/.test(dest) && !m[4].includes(dest.replace(/^https?:\/\//, ''))) out.push({ testo: ` (${dest.replace(/^https?:\/\//, '')})` });
    } else if (m[6]) out.push({ testo: m[7], codice: true });
    else if (m[8]) out.push({ testo: m[9] });
    else if (m[10]) out.push({ testo: m[11] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ testo: s.slice(last) });
  return out.filter((x) => x.testo);
}

// ---------------------------------------------------------------- disegno
function nuovoDoc(info) {
  const doc = new PDFDocument({ size: 'A4', margins: M, bufferPages: true, autoFirstPage: false, info });
  doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B);
  return doc;
}
const maxY = () => H - M.bottom;

function scriviSegmenti(doc, segs, { x, width, size = 9.6, color = C.ink, lineGap = 2.2, align = 'left' }) {
  if (!segs.length) return;
  segs.forEach((s, k) => {
    const font = s.grassetto ? 'B' : (s.codice ? 'B' : 'R');
    const col = s.codice ? C.teal : s.link ? C.teal : color;
    const opts = { width, lineGap, align, continued: k < segs.length - 1 };
    if (k === 0) doc.font(font).fontSize(size).fillColor(col).text(s.testo, x, doc.y, opts);
    else doc.font(font).fontSize(size).fillColor(col).text(s.testo, opts);
  });
}
const altezzaTesto = (doc, testo, width, size = 9.6, font = 'R', lineGap = 2.2) => doc.font(font).fontSize(size).heightOfString(String(testo || '').replace(/\*\*|`/g, ''), { width, lineGap });
function assicura(doc, h) { if (doc.y + h > maxY()) { doc.addPage(); doc.y = M.top; } }

function corpoMarkdown(doc, src, numeroDi) {
  for (const b of blocchiMarkdown(src)) {
    if (b.t === 'h') {
      const size = b.livello <= 3 ? 10.6 : 10;
      assicura(doc, 46);
      doc.y += 5;
      doc.font('B').fontSize(size).fillColor(C.teal).text(b.testo.replace(/\*\*/g, ''), M.left, doc.y, { width: TW });
      doc.y += 3;
    } else if (b.t === 'p') {
      assicura(doc, Math.min(altezzaTesto(doc, b.testo, TW), 40));
      scriviSegmenti(doc, segmenti(b.testo, numeroDi), { x: M.left, width: TW });
      doc.y += 5;
    } else if (b.t === 'ul' || b.t === 'ol') {
      b.voci.forEach((v, k) => {
        const segno = b.t === 'ul' ? '•' : `${k + 1}.`;
        const rientro = b.t === 'ul' ? 12 : 18;
        assicura(doc, Math.min(altezzaTesto(doc, v, TW - rientro), 28));
        const y0 = doc.y;
        doc.font(b.t === 'ul' ? 'R' : 'B').fontSize(9.6).fillColor(C.teal).text(segno, M.left + 2, y0, { width: rientro, lineBreak: false });
        doc.y = y0;
        scriviSegmenti(doc, segmenti(v, numeroDi), { x: M.left + rientro + 2, width: TW - rientro - 2 });
        doc.y += 2.5;
      });
      doc.y += 3;
    } else if (b.t === 'quote') {
      // riquadro "attenzione": sfondo e barra disegnati prima del testo, altezza misurata sul testo semplice
      const segs = segmenti(b.testo, numeroDi);
      const piano = segs.map((x) => x.testo).join('');
      const h = doc.font('R').fontSize(9.4).heightOfString(piano, { width: TW - 26, lineGap: 2.2 }) + 16;
      assicura(doc, Math.min(h, maxY() - M.top - 10));
      const y0 = doc.y;
      const hBox = Math.min(h, maxY() - y0);
      doc.rect(M.left, y0, TW, hBox).fill(C.amberBg);
      doc.rect(M.left, y0, 3.5, hBox).fill(C.amberLine);
      doc.y = y0 + 8;
      scriviSegmenti(doc, segs, { x: M.left + 14, width: TW - 26, size: 9.4, color: C.amber });
      doc.y = Math.max(doc.y + 8, y0 + hBox) + 6;
    } else if (b.t === 'table') {
      for (const [k, r] of b.righe.entries()) {
        const testo = r.join('  ·  ');
        assicura(doc, altezzaTesto(doc, testo, TW, 9.2, k === 0 ? 'B' : 'R') + 4);
        doc.font(k === 0 ? 'B' : 'R').fontSize(9.2).fillColor(C.ink).text(testo, M.left, doc.y, { width: TW, lineGap: 1.5 });
        doc.y += 2;
      }
      doc.y += 4;
    }
  }
}

function bollino(doc, s) {
  const testo = s.stato === 'VALIDATA' ? `VALIDATA${s.validata_il ? ` il ${itData(s.validata_il)}` : ''}` : 'DA VALIDARE con un referente GIPO';
  doc.font('B').fontSize(7.4);
  const w = doc.widthOfString(testo) + 14;
  const y = doc.y;
  doc.roundedRect(M.left, y, w, 13, 6.5).fill(s.stato === 'VALIDATA' ? C.greenBg : C.amberBg);
  doc.font('B').fontSize(7.4).fillColor(s.stato === 'VALIDATA' ? C.green : C.amber).text(testo, M.left + 7, y + 3.2, { lineBreak: false });
  return { y, w };
}

/** Genera il PDF. Ritorna { buffer, pagine }. */
export async function generaPdf() {
  const { capitoli, sezioni, faq, aggiornata } = await dati();
  const co = await getCompany();
  const numeroDi = (slug) => sezioni.find((s) => s.slug === slug)?.numero || null;
  const daValidare = sezioni.filter((s) => s.stato !== 'VALIDATA').length;
  const faqNumero = new Map(faq.map((f, i) => [f.id, i + 1]));
  const doc = nuovoDoc({ Title: 'Guida operativa GipoNext · Toscana Diagnostica', Author: co.legal_name, Creator: `Suite TD ${APP_VERSION}`, Subject: 'Guida GIPO' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const fine = new Promise((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });
  // capitolo di ogni pagina (per l'intestazione), anche per le pagine aggiunte da pdfkit quando il testo scorre
  const capPagina = [];
  let capCorrente = '';
  doc.on('pageAdded', () => { capPagina.push(capCorrente); });

  // ---- copertina
  doc.addPage();
  doc.rect(0, 0, W, 300).fill(C.jet);
  if (LOGO) { try { doc.image(LOGO, M.left, 44, { fit: [190, 58] }); } catch { /* logo illeggibile: si va avanti */ } }
  doc.font('B').fontSize(30).fillColor(C.white).text('Guida operativa GipoNext', M.left, 150, { width: TW });
  doc.font('R').fontSize(13).fillColor('#B9CDD3').text('Il gestionale ambulatoriale GIPO spiegato al personale di Toscana Diagnostica: accettazione, agenda, assegnazioni, refertazione, fatturazione, cassa, SSN e configurazione.', M.left, 196, { width: TW - 40, lineGap: 3 });
  let y = 330;
  const riga = (et, val) => {
    doc.font('B').fontSize(9).fillColor(C.grey).text(et.toUpperCase(), M.left + 16, y, { width: 150, lineBreak: false });
    doc.font('R').fontSize(10.5).fillColor(C.ink).text(val, M.left + 170, y - 1, { width: TW - 186 });
    y = Math.max(doc.y, y + 14) + 7;
  };
  doc.roundedRect(M.left, y - 14, TW, 176, 10).fill(C.bg);
  riga('Edizione', `Suite TD v${APP_VERSION}`);
  riga('Aggiornata al', itData(aggiornata));
  riga('Contenuto', `${capitoli.length} capitoli, ${sezioni.length} sezioni, ${faq.length} domande frequenti`);
  riga('Da validare', daValidare ? `${daValidare} sezioni su ${sezioni.length} (bollino arancione)` : 'nessuna: tutte le sezioni sono validate');
  riga('Fonte', 'Analisi dell\'interfaccia di GipoNext del 12/11/2026 (menu, schermate, campi e pulsanti), arricchita con le risposte della redazione alle domande del personale.');
  y = Math.max(y + 22, 330 - 14 + 176 + 22);
  doc.font('B').fontSize(11).fillColor(C.amber).text('Prima di usare questa guida', M.left, y, { width: TW });
  doc.font('R').fontSize(9.8).fillColor(C.ink).text('Le procedure sono ricavate dai nomi di menu, campi e pulsanti visti nell\'interfaccia e non sono state eseguite dal vivo: le sezioni con il bollino "da validare con un referente GIPO" vanno confermate da chi usa GIPO ogni giorno. Dove la guida dice "non osservato" o "da verificare", chiedi all\'assistenza Gipo. La versione sempre aggiornata è nella Suite TD, widget Guida GIPO, dove puoi anche fare domande.', M.left, doc.y + 4, { width: TW, lineGap: 2.5 });
  doc.moveDown(0.6);
  doc.font('B').fontSize(9.8).fillColor(C.ink).text('Non scrivere mai nomi o dati di pazienti nelle domande alla Suite.', M.left, doc.y, { width: TW });
  doc.moveDown(0.8);
  doc.font('R').fontSize(9.2).fillColor(C.grey).text('Assistenza ufficiale Gipo: Nuovo ticket e I miei ticket dal menu Assistenza di GIPO, Tele assistenza, videotutorial.giponext.it, email next@gipo.it.', M.left, doc.y, { width: TW, lineGap: 2 });
  doc.font('R').fontSize(8).fillColor(C.grey).text(`${co.legal_name} · ${co.address_full} · documento per uso interno`, M.left, H - 70, { width: TW, align: 'center', lineBreak: false });

  // ---- indice: pagine riservate (righe di altezza fissa, una riga per voce)
  const RIGA_CAP = 21; const RIGA_SEZ = 14.2;
  const voci = [];
  for (const k of capitoli) {
    voci.push({ tipo: 'cap', k });
    for (const s of sezioni.filter((x) => x.capitolo === k.numero)) voci.push({ tipo: 'sez', s });
  }
  if (faq.length) voci.push({ tipo: 'app' });
  const disponibile = maxY() - M.top;
  let pagineIndice = 1; let usato = 46;
  // un capitolo non resta in fondo alla pagina da solo: serve spazio anche per la prima sezione
  const spazio = (v) => (v.tipo === 'sez' ? RIGA_SEZ : v.tipo === 'cap' ? RIGA_CAP + RIGA_SEZ : RIGA_CAP);
  for (const v of voci) { const h = v.tipo === 'sez' ? RIGA_SEZ : RIGA_CAP; if (usato + spazio(v) > disponibile) { pagineIndice++; usato = 0; } usato += h; }
  const primaIndice = doc.bufferedPageRange().count;
  for (let i = 0; i < pagineIndice; i++) { capCorrente = 'Indice'; doc.addPage(); }

  // ---- capitoli e sezioni
  const paginaDi = new Map();   // 'cap-N' | 'sez-slug' | 'app' → numero di pagina (1 = copertina)
  const paginaCorrente = () => doc.bufferedPageRange().start + doc.bufferedPageRange().count;
  for (const k of capitoli) {
    capCorrente = `${k.numero}. ${k.titolo}`;
    doc.addPage();
    paginaDi.set(`cap-${k.numero}`, paginaCorrente());
    doc.addNamedDestination(`cap-${k.numero}`);
    doc.y = M.top + 8;
    doc.font('B').fontSize(10).fillColor(C.blue).text(`CAPITOLO ${k.numero}`, M.left, doc.y, { width: TW, characterSpacing: 1.2 });
    doc.font('B').fontSize(21).fillColor(C.jet).text(k.titolo, M.left, doc.y + 2, { width: TW });
    if (k.intro) doc.font('R').fontSize(10.4).fillColor(C.grey).text(k.intro, M.left, doc.y + 4, { width: TW, lineGap: 2 });
    doc.moveTo(M.left, doc.y + 8).lineTo(W - M.right, doc.y + 8).strokeColor(C.blue).lineWidth(1.2).stroke();
    doc.y += 20;
    for (const s of sezioni.filter((x) => x.capitolo === k.numero)) {
      assicura(doc, 110);
      paginaDi.set(`sez-${s.slug}`, paginaCorrente());
      doc.addNamedDestination(`sez-${s.slug}`);
      doc.y += 6;
      doc.font('B').fontSize(13.2).fillColor(C.teal).text(`${s.numero}  ${s.titolo}`, M.left, doc.y, { width: TW });
      doc.y += 4;
      const b = bollino(doc, s);
      if (s.percorso_gipo) doc.font('R').fontSize(8.4).fillColor(C.grey).text(`Percorso in GIPO: ${s.percorso_gipo}`, M.left + b.w + 10, b.y + 3, { width: TW - b.w - 10, lineBreak: false });
      doc.y = b.y + 21;
      corpoMarkdown(doc, s.corpo, numeroDi);
      const collegate = faq.filter((f) => f.sezione_id === s.id).map((f) => faqNumero.get(f.id));
      if (collegate.length) {
        assicura(doc, 16);
        doc.font('R').fontSize(8.6).fillColor(C.grey).text(`Domande frequenti collegate (appendice): n. ${collegate.join(', ')}`, M.left, doc.y, { width: TW });
      }
      doc.y += 4;
      doc.moveTo(M.left, doc.y + 4).lineTo(W - M.right, doc.y + 4).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.y += 12;
    }
  }

  // ---- appendice: FAQ per capitolo
  if (faq.length) {
    capCorrente = 'Appendice · Domande frequenti';
    doc.addPage();
    paginaDi.set('app', paginaCorrente());
    doc.addNamedDestination('app');
    doc.y = M.top + 8;
    doc.font('B').fontSize(10).fillColor(C.blue).text('APPENDICE', M.left, doc.y, { width: TW, characterSpacing: 1.2 });
    doc.font('B').fontSize(21).fillColor(C.jet).text('Domande frequenti', M.left, doc.y + 2, { width: TW });
    doc.font('R').fontSize(10.4).fillColor(C.grey).text('Le domande più comuni del personale, con il rimando alla sezione della guida. Le risposte nate dalle domande arrivate alla Suite sono scritte dalla redazione.', M.left, doc.y + 4, { width: TW, lineGap: 2 });
    doc.y += 14;
    let capPrec = undefined;
    for (const f of faq) {
      if (f.capitolo !== capPrec) {
        capPrec = f.capitolo;
        const k = capitoli.find((x) => x.numero === f.capitolo);
        assicura(doc, 60);
        doc.y += 6;
        doc.font('B').fontSize(11.5).fillColor(C.teal).text(k ? `${k.numero}. ${k.titolo}` : 'Altre domande', M.left, doc.y, { width: TW });
        doc.moveTo(M.left, doc.y + 2).lineTo(W - M.right, doc.y + 2).strokeColor(C.blue).lineWidth(0.8).stroke();
        doc.y += 8;
      }
      assicura(doc, 46);
      doc.font('B').fontSize(10).fillColor(C.ink).text(`${faqNumero.get(f.id)}. ${f.domanda}`, M.left, doc.y, { width: TW });
      doc.y += 2;
      corpoMarkdown(doc, f.risposta, numeroDi);
      const s = sezioni.find((x) => x.id === f.sezione_id);
      if (s) { doc.font('R').fontSize(8.4).fillColor(C.grey).text(`Sezione ${s.numero} ${s.titolo}`, M.left, doc.y - 2, { width: TW }); }
      doc.y += 7;
    }
  }

  // ---- indice (pagine riservate all'inizio)
  doc.switchToPage(primaIndice);
  let yi = M.top + 4;
  doc.font('B').fontSize(21).fillColor(C.jet).text('Indice', M.left, yi, { width: TW });
  yi += 42;
  let pi = 0;
  const vociIndice = (testo, pagina, dest, { cap = false, rientro = 0, validare = false } = {}) => {
    const h = cap ? RIGA_CAP : RIGA_SEZ;
    const serve = cap && dest !== 'app' ? RIGA_CAP + RIGA_SEZ : h;
    if (yi + serve > M.top + disponibile) { pi++; doc.switchToPage(primaIndice + pi); yi = M.top; }
    const size = cap ? 10.6 : 9.4;
    const font = cap ? 'B' : 'R';
    const x = M.left + rientro;
    const num = String(pagina ?? '');
    const yt = yi + (cap ? 6 : 1);
    doc.font(font).fontSize(size);
    const wNum = doc.widthOfString(num);
    const extra = validare ? '  (da validare)' : '';
    const maxTesto = TW - rientro - wNum - 40;
    let t = testo;
    while (doc.widthOfString(t + extra) > maxTesto && t.length > 10) t = `${t.slice(0, -2).trimEnd()}…`;
    doc.fillColor(cap ? C.jet : C.ink).text(t, x, yt, { lineBreak: false, goTo: dest });
    const wT = doc.widthOfString(t);
    if (validare) doc.font('R').fontSize(7.6).fillColor(C.amber).text(extra, x + wT, yt + 1.6, { lineBreak: false });
    doc.font(font).fontSize(size);
    const xDot = x + wT + (validare ? doc.font('R').fontSize(7.6).widthOfString(extra) : 0) + 6;
    const xNum = W - M.right - wNum;
    doc.font('R').fontSize(size).fillColor(C.line);
    const punto = doc.widthOfString('.  ');
    let dots = ''; while (xDot + doc.widthOfString(`${dots}.  `) < xNum - 6) dots += '.  ';
    if (dots && punto) doc.text(dots, xDot, yt, { lineBreak: false });
    doc.font(font).fontSize(size).fillColor(cap ? C.jet : C.ink).text(num, xNum, yt, { lineBreak: false, goTo: dest });
    yi += h;
  };
  for (const v of voci) {
    if (v.tipo === 'cap') vociIndice(`${v.k.numero}. ${v.k.titolo}`, paginaDi.get(`cap-${v.k.numero}`), `cap-${v.k.numero}`, { cap: true });
    else if (v.tipo === 'sez') vociIndice(`${v.s.numero}  ${v.s.titolo}`, paginaDi.get(`sez-${v.s.slug}`), `sez-${v.s.slug}`, { rientro: 16, validare: v.s.stato !== 'VALIDATA' });
    else vociIndice('Appendice · Domande frequenti', paginaDi.get('app'), 'app', { cap: true });
  }

  // ---- intestazione e piè di pagina (tutte le pagine tranne la copertina)
  const range = doc.bufferedPageRange();
  const totale = range.count;
  for (let i = 1; i < totale; i++) {
    doc.switchToPage(range.start + i);
    const mb = doc.page.margins.bottom; const mt = doc.page.margins.top;
    doc.page.margins.bottom = 0; doc.page.margins.top = 0;
    doc.font('B').fontSize(8).fillColor(C.teal).text('Guida GipoNext · Toscana Diagnostica', M.left, 26, { width: TW / 2, lineBreak: false });
    doc.font('R').fontSize(8).fillColor(C.grey).text(capPagina[i] || '', M.left + TW / 2, 26, { width: TW / 2, align: 'right', lineBreak: false });
    doc.moveTo(M.left, 40).lineTo(W - M.right, 40).strokeColor(C.line).lineWidth(0.6).stroke();
    doc.moveTo(M.left, H - 40).lineTo(W - M.right, H - 40).strokeColor(C.line).lineWidth(0.6).stroke();
    doc.font('R').fontSize(7.4).fillColor(C.grey).text(`Suite TD v${APP_VERSION} · guida aggiornata al ${itData(aggiornata)} · uso interno, non contiene dati di pazienti`, M.left, H - 32, { width: TW * 0.75, lineBreak: false });
    doc.font('B').fontSize(7.6).fillColor(C.grey).text(`pagina ${i + 1} di ${totale}`, M.left + TW * 0.75, H - 32, { width: TW * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = mb; doc.page.margins.top = mt;
  }
  doc.end();
  return { buffer: await fine, pagine: totale };
}

// ---------------------------------------------------------------- cache
let cache = null;
async function chiaveCache() {
  const r = await one(`SELECT (SELECT coalesce(max(aggiornata_il)::text, '') || count(*) FROM sezioni) AS s, (SELECT coalesce(max(aggiornata_il)::text, '') || count(*) FROM faq WHERE pubblicata) AS f,
    (SELECT coalesce(max(updated_at)::text, '') || count(*) FROM capitoli) AS c`);
  return `${APP_VERSION}|${r.s}|${r.f}|${r.c}`;
}
export function invalidaPdf() { cache = null; }
/** PDF corrente della guida (dalla cache se nulla è cambiato). Ritorna { buffer, pagine, generato_il }. */
export async function pdfGuida() {
  const chiave = await chiaveCache();
  if (cache?.chiave === chiave) return cache.promessa ? cache.promessa : cache;
  const p = generaPdf().then((r) => ({ ...r, chiave, generato_il: new Date() }));
  cache = { chiave, promessa: p };
  try { const r = await p; if (cache?.chiave === chiave) cache = r; return r; } catch (e) { cache = null; throw e; }
}
