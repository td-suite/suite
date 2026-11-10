// Finance Management · Controllo di gestione: esportazioni XLSX (exceljs) e PDF (pdfkit, stessa impaginazione dei rapporti di Facility)
// del conto economico di sede e del margine per cliente Service. Solo i dati calcolati da lib/controlloData.js: nessuna cifra aggiunta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany } from '../../../lib/company.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', '..', 'shipments', 'assets');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const LATO = ['/usr/share/fonts/truetype/lato', '/usr/share/fonts/lato', '/usr/local/share/fonts'];
const findFont = (n, fb) => { for (const d of LATO) { const f = path.join(d, n); if (fs.existsSync(f)) return f; } return fb; };
const FONT_R = findFont('Lato-Regular.ttf', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
const FONT_B = findFont('Lato-Bold.ttf', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
const C = { teal: '#1C505E', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', soft: '#EAF5F7', white: '#FFFFFF', red: '#B3261E', amber: '#A35A00' };
const EUR = '#,##0.00 €;[Red]-#,##0.00 €';
const eur = (v) => (v == null ? 'n.d.' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }));
const pct = (v) => (v == null ? '' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);

export const CALCOLO_PL = (imp, lab) => [
  'Ricavi = produzione, non fatturato (decisione 12): vendite nette di Retail per sede e data (senza dati dimostrativi; le vendite B2B dei clienti Service vanno nella riga Service) e produzione dei clienti Service attribuita alla sede del Laboratorio' + (lab ? ` (${lab.name})` : '') + '.',
  'Ricavi Service solo dalla produzione effettiva (Synclab Data API, file StudioLAB, Retail, Ordini, inserita a mano): le stime commerciali del Business Hub (fonte STIMA) stanno nella riga "Stime commerciali (non sommate)" sotto il totale, con il numero di clienti stimati (v0.68.1).',
  'Stime commerciali (v0.68.4): solo i clienti Service ATTIVI (regola del Business Hub: niente prospect né contrattualizzati non avviati), nei mesi senza produzione effettiva, IN PRO QUOTA sul periodo: fatturato FY atteso × giorni lavorativi del periodo successivi alla data di avvio (fino a oggi) / giorni lavorativi dell\'anno. A parte la "Proiezione FY" dell\'anno seguente: fatturato FY atteso pieno dei clienti attivi. Né le stime né la proiezione si sommano ai ricavi o al margine.',
  'Incassi Cash: riga di controllo, non sommata ai ricavi (rendiconti da CLOSED in poi: contanti da versare + POS + bonifici); si mostra la differenza con Retail.',
  `Costi diretti di sede: canone (scatti del contratto dello Scadenziario o canone di Amministrazione > Sedi, IVA ${imp.iva_costi === 'COSTO' ? 'sommata come costo indetraibile' : 'esclusa'} quando il canone è più IVA), bollette registrate ripartite per giorni del periodo, royalties di sede confermate in Cash, personale assegnato alla sede (RAL × coefficiente oneri ${String(imp.coefficiente).replace('.', ',')} / 12, oppure il coefficiente del contratto se indicato da HR), compensi fissi dei liberi professionisti (variabili "da indicare"), manutenzioni con costo (Facility), pagamenti Finance con la sede come centro di costo (con il solo cliente: al Laboratorio).`,
  `Costi centrali (decisione 11): personale e pagamenti senza sede, costi delle sedi centrali (${imp.sedi_centrali_predefinite ? 'predefinito: sedi di tipo Sede direzionale' : 'impostazione'}), ripartiti su ogni sede in proporzione ai ricavi della sede sul totale del periodo (chiave ${imp.chiave}).`,
  'Esclusi i pagamenti creati dallo Scadenziario (già contati in canone e utenze) e quelli segnati "fuori dal conto economico" (stipendi, contributi, rate, imposte).',
  'Fonte non disponibile (modulo non attivo o lettura fallita) = riga "non disponibile", mai zero. Margine "parziale" quando manca una fonte o ci sono importi da indicare.',
];

// ------------------------------------------------------------------ XLSX conto economico
export async function contoXlsx(d) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Finance Management';
  const ws = wb.addWorksheet('Conto economico', { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  const cols = d.colonne;
  ws.addRow([`Conto economico di sede · ${d.periodo.etichetta}`]).font = { bold: true, size: 13 };
  ws.addRow([`Confronto: ${d.precedente.etichetta}. Valori in euro.`]);
  const head = ws.addRow(['Voce', ...cols.map((c) => c.sede.name), 'Totale']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; });
  const riga = (label, f, opt = {}) => {
    const r = ws.addRow([label, ...cols.map(f), opt.tot !== undefined ? opt.tot : null]);
    for (let i = 2; i <= cols.length + 2; i++) r.getCell(i).numFmt = opt.fmt || EUR;
    if (opt.bold) r.font = { bold: true };
    return r;
  };
  const disp = (k) => d.fonti[k]?.disponibile !== false;
  ws.addRow(['RICAVI']).font = { bold: true };
  for (const k of ['ricavi_retail', 'ricavi_service']) {
    const lb = d.righe.find((x) => x.key === k).label;
    if (!disp(k)) { ws.addRow([`${lb}: non disponibile (${d.fonti[k].nota})`]); continue; }
    riga(lb, (c) => c.voci[k].importo, { tot: d.totale.voci[k] });
  }
  riga('Totale ricavi (produzione effettiva)', (c) => c.ricavi, { tot: d.totale.ricavi, bold: true });
  riga(`Stime commerciali in pro quota (non sommate)${d.totale.stime?.clienti ? `: ${d.totale.stime.clienti} clienti attivi` : ''}`, (c) => c.voci.stime_service.importo, { tot: d.totale.voci.stime_service });
  riga(`Proiezione FY ${d.totale.proiezione?.anno || d.periodo.anno + 1} (fatturato atteso pieno dei clienti attivi, non sommata)${d.totale.proiezione?.clienti ? `: ${d.totale.proiezione.clienti} clienti` : ''}`, (c) => c.voci.proiezione_fy.importo, { tot: d.totale.voci.proiezione_fy });
  if (disp('incassi_cash')) {
    riga('Incassi Cash (controllo, non sommati)', (c) => c.voci.incassi_cash.importo, { tot: d.totale.voci.incassi_cash });
    riga('Differenza Cash − Retail', (c) => c.controllo_cash?.differenza ?? null, { tot: d.totale.controllo_cash?.differenza ?? null });
  } else ws.addRow([`Incassi Cash: non disponibile (${d.fonti.incassi_cash.nota})`]);
  ws.addRow(['COSTI DIRETTI DI SEDE']).font = { bold: true };
  for (const r of d.righe.filter((x) => x.gruppo === 'COSTI')) {
    if (!disp(r.key)) { ws.addRow([`${r.label}: non disponibile (${d.fonti[r.key].nota})`]); continue; }
    const x = riga(r.label, (c) => c.voci[r.key].importo, { tot: d.totale.voci[r.key] });
    const daInd = cols.reduce((a, c) => a + c.voci[r.key].da_indicare, 0);
    if (daInd) x.getCell(1).value = `${r.label} (${daInd} da indicare)`;
  }
  riga('Totale costi diretti', (c) => c.costi_diretti, { tot: d.totale.costi_diretti, bold: true });
  riga('Margine prima dei costi centrali', (c) => c.margine_prima_dei_centrali, { tot: d.totale.margine_prima_dei_centrali });
  riga('Quota costi centrali', (c) => c.quota_centrali, { tot: d.totale.quota_centrali });
  riga('Percentuale usata', (c) => (c.quota_pct == null ? null : c.quota_pct / 100), { tot: d.ripartizione.ripartibile ? 1 : null, fmt: '0.00%' });
  riga('MARGINE DI SEDE', (c) => c.margine, { tot: d.totale.margine, bold: true });
  riga('Margine %', (c) => (c.margine_pct == null ? null : c.margine_pct / 100), { tot: d.totale.margine_pct == null ? null : d.totale.margine_pct / 100, fmt: '0.0%' });
  riga(`Margine ${d.precedente.etichetta}`, (c) => c.precedente?.margine ?? null, { tot: d.totale.precedente?.margine ?? null });
  riga('Variazione del margine', (c) => (c.variazione_margine == null ? null : c.variazione_margine / 100), { tot: d.totale.variazione_margine == null ? null : d.totale.variazione_margine / 100, fmt: '0.0%' });
  const parz = ws.addRow(['Stato', ...cols.map((c) => (c.parziale ? 'parziale' : 'completo')), '']); parz.font = { italic: true };
  ws.getColumn(1).width = 46; for (let i = 2; i <= cols.length + 2; i++) ws.getColumn(i).width = 18;

  const wc = wb.addWorksheet('Costi centrali');
  wc.addRow(['Voce', 'Importo']).font = { bold: true };
  for (const r of d.righe.filter((x) => x.gruppo === 'COSTI')) { const x = wc.addRow([r.label, d.fonti[r.key]?.disponibile === false ? null : d.centrali.voci[r.key].importo]); x.getCell(2).numFmt = EUR; }
  const tc = wc.addRow(['Totale costi centrali', d.centrali.totale]); tc.font = { bold: true }; tc.getCell(2).numFmt = EUR;
  wc.addRow([d.ripartizione.ripartibile ? `Ripartiti in proporzione ai ricavi (totale ricavi ${eur(d.ripartizione.totale_ricavi)})` : d.ripartizione.motivo]);
  wc.addRow(['Sedi centrali', d.centrali.sedi.map((s) => s.name).join(', ') || 'nessuna']);
  wc.getColumn(1).width = 50; wc.getColumn(2).width = 18;

  const wd = wb.addWorksheet('Dettaglio');
  wd.addRow(['Sede', 'Voce', 'Modulo', 'Data / periodo', 'Descrizione', 'Importo', 'Note']).font = { bold: true };
  const lbl = Object.fromEntries(d.righe.map((r) => [r.key, r.label]));
  for (const c of cols) for (const r of d.righe) for (const m of c.voci[r.key].righe) { const x = wd.addRow([c.sede.name, lbl[r.key], m.modulo, m.data, m.descrizione, m.importo, m.importo == null ? 'da indicare' : '']); x.getCell(6).numFmt = EUR; }
  for (const r of d.righe.filter((x) => x.gruppo === 'COSTI')) for (const m of d.centrali.voci[r.key].righe) { const x = wd.addRow(['Costi centrali', lbl[r.key], m.modulo, m.data, m.descrizione, m.importo, [m.centrale, m.importo == null ? 'da indicare' : ''].filter(Boolean).join(' · ')]); x.getCell(6).numFmt = EUR; }
  [16, 30, 26, 22, 70, 16, 30].forEach((w, i) => { wd.getColumn(i + 1).width = w; });

  const wn = wb.addWorksheet('Come è calcolato');
  for (const t of CALCOLO_PL(d.impostazioni, d.laboratorio)) wn.addRow([t]);
  wn.addRow([]); wn.addRow(['Fonti']).font = { bold: true };
  for (const r of d.righe) wn.addRow([`${r.label}: ${d.fonti[r.key]?.disponibile === false ? 'NON DISPONIBILE · ' : ''}${d.fonti[r.key]?.nota || ''}`]);
  for (const a of d.avvisi || []) wn.addRow([`Avviso: ${a}`]);
  wn.getColumn(1).width = 160;
  return wb.xlsx.writeBuffer();
}

// ------------------------------------------------------------------ PDF comune
async function nuovoPdf(title) {
  const co = await getCompany();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: title, Author: co.legal_name || 'Toscana Diagnostica', Creator: 'Suite TD · Finance Management' } });
  if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
  const W = 841.89, H = 595.28, M = 32;
  const st = { doc, W, H, M };
  st.addPage = () => {
    doc.addPage();
    const logoW = LOGO ? 22 * 5.13 + 12 : 0;
    if (LOGO) { try { doc.image(LOGO, M, 22, { height: 22 }); } catch { /* logo non leggibile */ } }
    doc.font('B').fontSize(10).fillColor(C.teal).text(co.name || 'Toscana Diagnostica', M + logoW, 22, { width: 260, lineBreak: false });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(co.address_full || '', M + logoW, 35, { width: 260, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(10).fillColor(C.jet).text(title, W / 2, 24, { width: W / 2 - M, align: 'right' });
    doc.moveTo(M, 52).lineTo(W - M, 52).lineWidth(0.8).strokeColor(C.teal).stroke();
    doc.y = 60;
  };
  st.p = (t, { size = 8, color = C.ink, font = 'R' } = {}) => { if (doc.y > H - 60) st.addPage(); doc.font(font).fontSize(size).fillColor(color).text(t, M, doc.y, { width: W - 2 * M, lineGap: 1 }); };
  st.table = (widths, head, rows, { size = 7, bold = () => false } = {}) => {
    const scale = (W - 2 * M) / widths.reduce((a, b) => a + b, 0);
    const c = widths.map((w) => w * scale);
    const row = (cells, { headRow = false, b = false } = {}) => {
      doc.font(headRow || b ? 'B' : 'R').fontSize(size);
      const h = Math.max(12, ...cells.map((x, i) => doc.heightOfString(String(x ?? ''), { width: c[i] - 5 }))) + 5;
      if (doc.y + h > H - 40) { st.addPage(); if (!headRow) row(head, { headRow: true }); }
      let x = M; const y = doc.y;
      cells.forEach((v, i) => {
        if (headRow) doc.rect(x, y, c[i], h).fill(C.teal); else if (b) doc.rect(x, y, c[i], h).fill(C.soft);
        doc.rect(x, y, c[i], h).lineWidth(0.4).strokeColor(C.line).stroke();
        doc.fillColor(headRow ? C.white : C.ink).font(headRow || b ? 'B' : 'R').fontSize(size).text(String(v ?? ''), x + 2.5, y + 2.5, { width: c[i] - 5, align: i === 0 ? 'left' : 'right' });
        x += c[i];
      });
      doc.y = y + h;
    };
    row(head, { headRow: true });
    for (const r of rows) row(r, { b: bold(r) });
    doc.moveDown(0.4);
  };
  st.finish = (footer) => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('R').fontSize(7).fillColor(C.grey).text(footer, M, H - 24, { width: W - 2 * M - 70, lineBreak: false, ellipsis: true });
      doc.text(`Pagina ${i - range.start + 1} di ${range.count}`, W - M - 70, H - 24, { width: 70, align: 'right', lineBreak: false });
    }
    doc.end();
  };
  return st;
}
const buffer = (doc) => new Promise((resolve, reject) => { const ch = []; doc.on('data', (b) => ch.push(b)); doc.on('end', () => resolve(Buffer.concat(ch))); doc.on('error', reject); });

// ------------------------------------------------------------------ PDF conto economico
export async function contoPdf(d) {
  const title = `Conto economico di sede · ${d.periodo.etichetta}`;
  const st = await nuovoPdf(title); const out = buffer(st.doc);
  st.addPage();
  st.p(title, { size: 14, font: 'B', color: C.teal });
  st.p(`Confronto con ${d.precedente.etichetta}. Valori in euro. Margine "parziale" se manca una fonte o ci sono importi da indicare.`, { color: C.grey });
  st.doc.moveDown(0.4);
  const disp = (k) => d.fonti[k]?.disponibile !== false;
  // le colonne si spezzano in gruppi di 6 sedi (A4 orizzontale)
  const gruppi = []; for (let i = 0; i < d.colonne.length; i += 6) gruppi.push(d.colonne.slice(i, i + 6));
  if (!gruppi.length) gruppi.push([]);
  gruppi.forEach((cols, gi) => {
    const ultimo = gi === gruppi.length - 1;
    const head = ['Voce', ...cols.map((c) => c.sede.name), ...(ultimo ? ['Totale'] : [])];
    const v = (f, tot) => [...cols.map((c) => f(c)), ...(ultimo ? [tot] : [])];
    const rows = [];
    for (const k of ['ricavi_retail', 'ricavi_service']) rows.push([d.righe.find((x) => x.key === k).label, ...(disp(k) ? v((c) => eur(c.voci[k].importo), eur(d.totale.voci[k])) : v(() => 'non disp.', 'non disp.'))]);
    rows.push(['Totale ricavi (produzione effettiva)', ...v((c) => eur(c.ricavi), eur(d.totale.ricavi))]);
    rows.push([`Stime commerciali in pro quota (non sommate)${d.totale.stime?.clienti ? `, ${d.totale.stime.clienti} clienti attivi` : ''}`, ...v((c) => eur(c.voci.stime_service.importo), eur(d.totale.voci.stime_service))]);
    rows.push([`Proiezione FY ${d.totale.proiezione?.anno || d.periodo.anno + 1} (non sommata)${d.totale.proiezione?.clienti ? `, ${d.totale.proiezione.clienti} clienti attivi` : ''}`, ...v((c) => eur(c.voci.proiezione_fy.importo), eur(d.totale.voci.proiezione_fy))]);
    rows.push(['Incassi Cash (controllo)', ...(disp('incassi_cash') ? v((c) => eur(c.voci.incassi_cash.importo), eur(d.totale.voci.incassi_cash)) : v(() => 'non disp.', 'non disp.'))]);
    rows.push(['Differenza Cash − Retail', ...(disp('incassi_cash') ? v((c) => eur(c.controllo_cash?.differenza), eur(d.totale.controllo_cash?.differenza)) : v(() => '', ''))]);
    for (const r of d.righe.filter((x) => x.gruppo === 'COSTI')) rows.push([r.label, ...(disp(r.key) ? v((c) => `${eur(c.voci[r.key].importo)}${c.voci[r.key].da_indicare ? ' *' : ''}`, eur(d.totale.voci[r.key])) : v(() => 'non disp.', 'non disp.'))]);
    rows.push(['Totale costi diretti', ...v((c) => eur(c.costi_diretti), eur(d.totale.costi_diretti))]);
    rows.push(['Quota costi centrali', ...v((c) => (c.quota_centrali == null ? 'non ripartibile' : `${eur(c.quota_centrali)} (${pct(c.quota_pct)})`), eur(d.totale.quota_centrali))]);
    rows.push(['MARGINE DI SEDE', ...v((c) => `${eur(c.margine)}${c.parziale ? ' (parziale)' : ''}`, eur(d.totale.margine))]);
    rows.push(['Margine %', ...v((c) => pct(c.margine_pct), pct(d.totale.margine_pct))]);
    rows.push([`Margine ${d.precedente.etichetta}`, ...v((c) => eur(c.precedente?.margine), eur(d.totale.precedente?.margine))]);
    rows.push(['Variazione', ...v((c) => (c.variazione_margine == null ? '' : `${c.variazione_margine > 0 ? '+' : ''}${pct(c.variazione_margine)}`), d.totale.variazione_margine == null ? '' : pct(d.totale.variazione_margine))]);
    st.table([3.2, ...head.slice(1).map(() => 1.6)], head, rows, { bold: (r) => ['Totale ricavi', 'Totale costi diretti', 'MARGINE DI SEDE'].includes(r[0]) });
  });
  st.p('* importi da indicare in quella voce (vedi il dettaglio nella Suite).', { color: C.grey, size: 7 });
  st.p(`Costi centrali: ${eur(d.centrali.totale)} · ${d.ripartizione.ripartibile ? `ripartiti sui ricavi (${eur(d.ripartizione.totale_ricavi)})` : d.ripartizione.motivo} · sedi centrali: ${d.centrali.sedi.map((s) => s.name).join(', ') || 'nessuna'}`, { size: 8 });
  st.doc.moveDown(0.5);
  st.p('Come è calcolato', { size: 10, font: 'B', color: C.teal });
  for (const t of CALCOLO_PL(d.impostazioni, d.laboratorio)) st.p(`· ${t}`, { size: 7.5 });
  const nd = d.righe.filter((r) => d.fonti[r.key]?.disponibile === false);
  if (nd.length) { st.doc.moveDown(0.3); st.p('Fonti non disponibili', { size: 9, font: 'B', color: C.red }); for (const r of nd) st.p(`· ${r.label}: ${d.fonti[r.key].nota}`, { size: 7.5 }); }
  for (const a of d.avvisi || []) st.p(`Avviso: ${a}`, { size: 7.5, color: C.amber });
  st.finish(`Suite TD · Finance Management · Controllo di gestione · generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`);
  return out;
}

// ------------------------------------------------------------------ margine per cliente Service
export const CALCOLO_SRV = (imp, giorni) => [
  'Clienti: Service ATTIVI (conferma del CEO, regola unica del Business Hub) della vista clienti_attivi_v; i CONTRATTUALIZZATI non avviati compaiono solo se hanno produzione effettiva nel periodo, mai con stime né proiezione (v0.68.4).',
  'Produzione del mese dalla fonte migliore: riga inserita o caricata in Finance Management (MANUALE o STUDIOLAB), poi SYNCLAB (produzione erogata, v0.68.5: accettazioni del gestionale in stato erogato con data nel mese, righe d\'esame non cancellate, netto di riga × quantità × (1 − sconto di testata)), poi StudioLAB arrivato alla Suite (vendite B2B di Retail, poi produzione di Ordini), infine, solo per i clienti ATTIVI, la STIMA in pro quota: fatturato FY atteso della scheda account × giorni lavorativi del mese successivi alla data di avvio (fino a oggi) / ' + giorni + ' (senza fatturato FY atteso: volumi giornalieri attesi × ' + giorni + ' × prezzo medio per esame); esami stimati = volumi giornalieri attesi × gli stessi giorni.',
  'Proiezione FY dell\'anno seguente: fatturato FY atteso pieno dei clienti attivi, mostrato a parte e mai sommato.',
  'Ricavo: con la fonte SYNCLAB la produzione erogata (netti di riga del gestionale con lo sconto di testata applicato una volta; le righe senza prezzo al listino corrente se c\'è); con le altre fonti gli esami ai prezzi del listino corrente del cliente (prezzo offerto, altrimenti listino) quando la produzione ha il dettaglio per esame; altrimenti il valore caricato o stimato.',
  'Fatturato da documenti (Synclab): contributo al fatturato netto dei documenti economici con data nel mese (una volta per documento, note di credito già negative). È una grandezza diversa dalla produzione del mese (dato secondario, "Documenti emessi"): è mostrato accanto e non entra nel ricavo né nel margine.',
  `Costi diretti: ritiri del mese (giorni a orario fisso del contratto Service × costo per ritiro ${imp.costo_ritiro != null ? eur(imp.costo_ritiro) : 'da indicare'}; ritiri a chiamata non quantificabili), costo analitico degli esami (tabella costi esami per codice, altrimenti costo medio ${imp.costo_medio_esame != null ? eur(imp.costo_medio_esame) : 'da indicare'}), pagamenti Finance con il cliente indicato.`,
  'Le ipotesi (stima della produzione, costo medio per esame, costo per ritiro) sono segnate "stima".',
];
export async function margineXlsx(d) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Finance Management';
  const ws = wb.addWorksheet('Margine Service', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([`Margine per cliente Service · ${d.periodo.etichetta}`]).font = { bold: true, size: 13 };
  ws.addRow(['Valori in euro; "stima" = contiene ipotesi; "da indicare" = dato mancante']);
  const annoFy = d.proiezione?.anno || d.periodo.anno + 1;
  const h = ws.addRow(['Cliente', 'Livello', 'Fonte produzione', 'Esami', 'Ricavo', 'Ritiri', 'Costo ritiri', 'Costo esami', 'Pagamenti', 'Costi diretti', 'Margine', 'Margine %', 'Stime', 'Da indicare', 'Fatturato da documenti (Synclab, non sommato)', 'Di cui stima in pro quota (non effettiva)', `Proiezione FY ${annoFy} (non sommata)`]);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; });
  for (const c of d.clienti) {
    const t = c.totale;
    const r = ws.addRow([c.org_name, c.livello, t.fonti.join(', '), t.esami, t.ricavo, Object.values(c.mesi).reduce((a, m) => a + (m.ritiri || 0), 0), t.costo_ritiri, t.costo_esami, t.pagamenti, t.costi_diretti, t.margine, t.margine_pct == null ? null : t.margine_pct / 100, t.stime.join(', '), t.da_indicare.join('; '), t.fatturato_documenti ?? null, t.ricavo_stime ?? null, c.proiezione_fy?.importo ?? null]);
    [5, 7, 8, 9, 10, 11, 15, 16, 17].forEach((i) => { r.getCell(i).numFmt = EUR; }); r.getCell(12).numFmt = '0.0%';
  }
  const T = d.totale;
  const tr = ws.addRow(['Totale linea', '', '', T.esami, T.ricavo, null, T.costo_ritiri, T.costo_esami, T.pagamenti, T.costi_diretti, T.margine, T.margine_pct == null ? null : T.margine_pct / 100, '', '', T.fatturato_documenti ?? null, T.ricavo_stime ?? null, d.proiezione?.importo ?? null]);
  tr.font = { bold: true }; [5, 7, 8, 9, 10, 11, 15, 16, 17].forEach((i) => { tr.getCell(i).numFmt = EUR; }); tr.getCell(12).numFmt = '0.0%';
  const te = ws.addRow(['Totale effettivo (senza stime)', '', '', T.esami - (T.esami_stimati || 0), T.ricavo_effettivo, null, null, null, null, T.costi_diretti, T.margine_effettivo]);
  te.font = { italic: true }; [5, 10, 11].forEach((i) => { te.getCell(i).numFmt = EUR; });
  [38, 18, 18, 10, 16, 8, 14, 14, 14, 16, 16, 10, 30, 50, 18, 18, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const wm = wb.addWorksheet('Mese per mese');
  wm.addRow(['Cliente', 'Mese', 'Fonte', 'Origine', 'Esami', 'Ricavo', 'Ricavo da', 'Ritiri', 'Costo ritiri', 'Costo esami', 'Pagamenti', 'Margine', 'Fatturato da documenti (Synclab)']).font = { bold: true };
  for (const c of d.clienti) for (const [mk, m] of Object.entries(c.mesi)) {
    const r = wm.addRow([c.org_name, mk, m.produzione?.fonte || '', m.produzione?.origine || 'nessuna produzione', m.esami, m.ricavo, m.ricavo_da || '', m.ritiri, m.costo_ritiri, m.costo_esami, m.pagamenti, m.margine, m.fatturato_documenti ?? null]);
    [6, 9, 10, 11, 12, 13].forEach((i) => { r.getCell(i).numFmt = EUR; });
  }
  [38, 9, 12, 44, 8, 14, 10, 8, 14, 14, 14, 14].forEach((w, i) => { wm.getColumn(i + 1).width = w; });
  const wn = wb.addWorksheet('Come è calcolato');
  for (const t of CALCOLO_SRV(d.impostazioni, d.giorni_lavorativi_anno)) wn.addRow([t]);
  for (const a of d.avvisi || []) wn.addRow([`Avviso: ${a}`]);
  wn.getColumn(1).width = 160;
  return wb.xlsx.writeBuffer();
}
export async function marginePdf(d) {
  const title = `Margine per cliente Service · ${d.periodo.etichetta}`;
  const st = await nuovoPdf(title); const out = buffer(st.doc);
  st.addPage();
  st.p(title, { size: 14, font: 'B', color: C.teal });
  st.p('Valori in euro. "stima" = contiene ipotesi (produzione stimata, costo medio, costo per ritiro).', { color: C.grey });
  st.doc.moveDown(0.4);
  const head = ['Cliente', 'Fonte', 'Esami', 'Ricavo', 'Costo ritiri', 'Costo esami', 'Pagamenti', 'Margine', 'Margine %', 'Note'];
  const rows = d.clienti.map((c) => { const t = c.totale; return [c.org_name, t.fonti.join(', ') || 'nessuna', String(t.esami), eur(t.ricavo), eur(t.costo_ritiri), eur(t.costo_esami), eur(t.pagamenti), eur(t.margine), pct(t.margine_pct), [t.stime.length ? 'stima' : '', t.da_indicare.length ? 'da indicare' : ''].filter(Boolean).join(', ')]; });
  const T = d.totale;
  rows.push(['Totale linea', '', String(T.esami), eur(T.ricavo), eur(T.costo_ritiri), eur(T.costo_esami), eur(T.pagamenti), eur(T.margine), pct(T.margine_pct), '']);
  rows.push(['Totale effettivo (senza stime)', '', String(T.esami - (T.esami_stimati || 0)), eur(T.ricavo_effettivo), '', '', '', eur(T.margine_effettivo), '', '']);
  st.table([3.4, 1.2, 0.8, 1.3, 1.2, 1.2, 1.2, 1.3, 0.8, 1.4], head, rows, { bold: (r) => r[0] === 'Totale linea' });
  st.p(`Di cui stime in pro quota (clienti attivi, non effettive): ${eur(T.ricavo_stime)} · Proiezione FY ${d.proiezione?.anno || d.periodo.anno + 1}: ${eur(d.proiezione?.importo)} su ${d.proiezione?.clienti || 0} clienti attivi (fatturato atteso pieno, non sommata)`, { size: 8 });
  st.p('Come è calcolato', { size: 10, font: 'B', color: C.teal });
  for (const t of CALCOLO_SRV(d.impostazioni, d.giorni_lavorativi_anno)) st.p(`· ${t}`, { size: 7.5 });
  for (const a of d.avvisi || []) st.p(`Avviso: ${a}`, { size: 7.5, color: C.amber });
  st.finish(`Suite TD · Finance Management · Controllo di gestione · generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`);
  return out;
}
