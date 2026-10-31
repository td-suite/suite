// Esportazioni del modulo Facility e Manutenzioni (pdfkit ed exceljs, come Audit SGI):
//  - rapporto energetico annuale per sede o di rete (PDF con grafici disegnati con pdfkit, XLSX con fogli Riepilogo, Mensile, Vettori,
//    Sedi, Anomalie, Obiettivi): evidenza per il riesame ISO 9001 e, se intraprese, ISO 14001 / ISO 50001;
//  - registro delle manutenzioni (PDF e XLSX: scadenze eseguite e aperte, interventi, KPI);
//  - etichette con QR dei dispositivi (A4, due colonne per sette righe).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getCompany } from '../../../lib/company.js';
import { PLAN_KINDS, PLAN_STATUS, OUTCOMES, STREAMS, WO_STATUS, PRIORITIES, BENCHMARK_SOURCE } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', '..', 'shipments', 'assets');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const LATO = ['/usr/share/fonts/truetype/lato', '/usr/share/fonts/lato', '/usr/local/share/fonts'];
const findFont = (n, fb) => { for (const d of LATO) { const f = path.join(d, n); if (fs.existsSync(f)) return f; } return fb; };
const FONT_R = findFont('Lato-Regular.ttf', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
const FONT_B = findFont('Lato-Bold.ttf', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', soft: '#EAF5F7', white: '#FFFFFF', red: '#B3261E', amber: '#A35A00', green: '#2F7D5B', prev: '#B9CDD2' };
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const n0 = (v, d = 0) => (v == null || v === '' ? '–' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
const pct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const dd = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
const dt = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
const VEC = { ELETTRICO: 'Energia elettrica', GAS: 'Gas naturale', ACQUA: 'Acqua', TELERISCALDAMENTO: 'Teleriscaldamento', GASOLIO: 'Gasolio', ALTRO: 'Altro' };
const POS = { SOTTO: 'sotto la fascia', NELLA_FASCIA: 'nella fascia', SOPRA: 'sopra la fascia' };
const TGT = { RAGGIUNTO: 'Raggiunto', IN_LINEA: 'In linea', FUORI_LINEA: 'Fuori linea', NESSUN_DATO: 'Dati insufficienti' };

// ------------------------------------------------------------------ PDF comune
async function newDoc(title, { landscape = false } = {}) {
  const co = await getCompany();
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: title, Author: co.legal_name || 'Toscana Diagnostica', Creator: 'Suite TD · Facility e Manutenzioni' } });
  if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
  const W = landscape ? 841.89 : 595.28, H = landscape ? 595.28 : 841.89, M = 40;
  const st = { doc, W, H, M, footer: '' };
  st.addPage = () => {
    doc.addPage();
    const logoW = LOGO ? 22 * 5.13 + 12 : 0;
    if (LOGO) { try { doc.image(LOGO, M, 24, { height: 22 }); } catch { /* logo non leggibile */ } }
    doc.font('B').fontSize(10).fillColor(C.teal).text(co.name || 'Toscana Diagnostica', M + logoW, 24, { width: 240, lineBreak: false });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(co.address_full || '', M + logoW, 37, { width: 240, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(9).fillColor(C.jet).text(title, W / 2, 26, { width: W / 2 - M, align: 'right' });
    doc.moveTo(M, 56).lineTo(W - M, 56).lineWidth(0.8).strokeColor(C.teal).stroke();
    doc.y = 66;
  };
  st.ensure = (h) => { if (doc.y + h > H - 50) st.addPage(); };
  st.h2 = (t) => { st.ensure(40); doc.moveDown(0.4); doc.font('B').fontSize(11.5).fillColor(C.teal).text(t, M, doc.y); doc.moveDown(0.25); };
  st.p = (t, { size = 9, color = C.ink } = {}) => { doc.font('R').fontSize(size).fillColor(color).text(t, M, doc.y, { width: W - 2 * M, lineGap: 1.5 }); };
  st.table = (cols, head, rows, { size = 8, fills = () => [] } = {}) => {
    const scale = (W - 2 * M) / cols.reduce((a, b) => a + b, 0);
    const c = cols.map((w) => w * scale);
    const row = (cells, { headRow = false, fill = [] } = {}) => {
      doc.font(headRow ? 'B' : 'R').fontSize(size);
      const h = Math.max(13, ...cells.map((x, i) => doc.heightOfString(String(x ?? ''), { width: c[i] - 6 }))) + 6;
      if (doc.y + h > H - 50) { st.addPage(); if (!headRow) row(head, { headRow: true }); }
      let x = M; const y = doc.y;
      cells.forEach((v, i) => {
        const f = headRow ? C.teal : fill[i];
        if (f) doc.rect(x, y, c[i], h).fill(f);
        doc.rect(x, y, c[i], h).lineWidth(0.4).strokeColor(C.line).stroke();
        doc.fillColor(headRow ? C.white : C.ink).font(headRow ? 'B' : 'R').fontSize(size).text(String(v ?? ''), x + 3, y + 3, { width: c[i] - 6 });
        x += c[i];
      });
      doc.y = y + h;
    };
    row(head, { headRow: true });
    for (const r of rows) row(r, { fill: fills(r) });
    doc.moveDown(0.3);
  };
  st.finish = () => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('R').fontSize(7.5).fillColor(C.grey).text(st.footer, M, H - 30, { width: W - 2 * M - 70, lineBreak: false, ellipsis: true });
      doc.text(`Pagina ${i - range.start + 1} di ${range.count}`, W - M - 70, H - 30, { width: 70, align: 'right', lineBreak: false });
    }
    doc.end();
    return new Promise((resolve, reject) => { const chunks = []; doc.on('data', (x) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  };
  return st;
}

// Riquadri KPI su una riga
function kpiRow(st, items) {
  const { doc, M, W } = st;
  st.ensure(60);
  const w = (W - 2 * M - (items.length - 1) * 8) / items.length; const y = doc.y;
  items.forEach((k, i) => {
    const x = M + i * (w + 8);
    doc.roundedRect(x, y, w, 50, 6).fill(C.soft);
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(k.label, x + 8, y + 7, { width: w - 16, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(14).fillColor(k.color || C.jet).text(k.value, x + 8, y + 19, { width: w - 16, lineBreak: false, ellipsis: true });
    if (k.foot) doc.font('R').fontSize(7).fillColor(C.grey).text(k.foot, x + 8, y + 37, { width: w - 16, lineBreak: false, ellipsis: true });
  });
  doc.y = y + 60;
}

// Istogramma mensile: anno corrente (teal) e anno precedente (grigio chiaro) affiancati, con asse e legenda
function barChart(st, monthly, { title, unit = 'kWh', height = 170 } = {}) {
  const { doc, M, W } = st;
  st.ensure(height + 50);
  if (title) { doc.font('B').fontSize(9).fillColor(C.jet).text(title, M, doc.y); doc.moveDown(0.2); }
  const x0 = M + 40, y0 = doc.y + 6, w = W - 2 * M - 50, h = height;
  const vals = monthly.flatMap((m) => [m.kwh || 0, m.prev_kwh || 0]);
  const max = Math.max(1, ...vals);
  const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
  for (let i = 0; i <= 4; i++) {
    const y = y0 + h - (h * i) / 4;
    doc.moveTo(x0, y).lineTo(x0 + w, y).lineWidth(0.3).strokeColor(C.line).stroke();
    doc.font('R').fontSize(6.5).fillColor(C.grey).text(n0((top * i) / 4), M - 4, y - 4, { width: 40, align: 'right' });
  }
  const gw = w / 12;
  monthly.forEach((m, i) => {
    const bx = x0 + i * gw + gw * 0.15; const bw = gw * 0.33;
    const hp = ((m.prev_kwh || 0) / top) * h, hc = ((m.kwh || 0) / top) * h;
    if (hp) doc.rect(bx, y0 + h - hp, bw, hp).fill(C.prev);
    if (hc) doc.rect(bx + bw + 1, y0 + h - hc, bw, hc).fill(m.anomaly ? C.red : C.teal);
    doc.font('R').fontSize(7).fillColor(C.grey).text(MESI[i], x0 + i * gw, y0 + h + 3, { width: gw, align: 'center' });
  });
  const ly = y0 + h + 16;
  doc.rect(x0, ly, 8, 8).fill(C.teal); doc.font('R').fontSize(7.5).fillColor(C.ink).text(`anno corrente (${unit})`, x0 + 12, ly, { lineBreak: false });
  doc.rect(x0 + 130, ly, 8, 8).fill(C.prev); doc.fillColor(C.ink).text('anno precedente', x0 + 142, ly, { lineBreak: false });
  doc.rect(x0 + 230, ly, 8, 8).fill(C.red); doc.fillColor(C.ink).text('mese con anomalia', x0 + 242, ly, { lineBreak: false });
  doc.y = ly + 18;
}

// Barre orizzontali (classifica tra sedi)
function hBars(st, rows, { key, label, unit }) {
  const { doc, M, W } = st;
  const list = rows.filter((r) => r[key] != null).slice(0, 15);
  if (!list.length) return;
  st.ensure(20 + list.length * 15);
  doc.font('B').fontSize(9).fillColor(C.jet).text(label, M, doc.y); doc.moveDown(0.2);
  const max = Math.max(...list.map((r) => r[key]));
  for (const r of list) {
    const y = doc.y;
    doc.font('R').fontSize(7.5).fillColor(C.ink).text(`${r.rank}. ${r.name}`, M, y + 2, { width: 150, lineBreak: false, ellipsis: true });
    const bw = ((W - 2 * M - 230) * r[key]) / max;
    doc.rect(M + 155, y + 2, Math.max(1, bw), 9).fill(r.benchmark === 'SOPRA' ? C.amber : C.blue);
    doc.font('R').fontSize(7.5).fillColor(C.ink).text(`${n0(r[key], 2)} ${unit}`, M + 160 + bw, y + 2, { lineBreak: false });
    doc.y = y + 14;
  }
  doc.moveDown(0.3);
}

// ------------------------------------------------------------------ Rapporto energetico (PDF)
export async function energiaPdf(e, { siteId = null, analisi = null } = {}) {
  const s = siteId ? e.sites.find((x) => x.site.id === siteId) : null;
  const blk = s || e.network;
  const titolo = `Rapporto energetico ${e.year} · ${s ? s.site.name : 'Rete Toscana Diagnostica'}`;
  const st = await newDoc(titolo);
  st.footer = `${titolo} · generato il ${dt(new Date())} da Suite TD · Facility e Manutenzioni`;
  const { doc, M } = st;
  st.addPage();
  doc.font('B').fontSize(16).fillColor(C.jet).text(titolo, M, doc.y);
  st.p(s ? `${s.site.kind ? s.site.kind.replace(/_/g, ' ').toLowerCase() : ''}${s.site.city ? ` · ${s.site.city}` : ''}${blk.sqm ? ` · ${n0(blk.sqm)} m2` : ' · superficie non indicata'}` : `${e.sites.filter((x) => x.totals.kwh > 0).length} sedi con consumi · ${blk.sqm ? `${n0(blk.sqm)} m2 complessivi` : 'superfici non indicate'}`, { color: C.grey });
  doc.moveDown(0.5);
  kpiRow(st, [
    { label: 'Energia (kWh equivalenti)', value: n0(blk.totals.kwh), foot: `${blk.totals.months} mesi con dati` },
    { label: 'Variazione sugli stessi mesi', value: pct(blk.delta_kwh_pct), color: blk.delta_kwh_pct > 0 ? C.red : C.green, foot: `${n0(blk.prev_ytd.kwh)} kWh nel ${e.year - 1} (${blk.prev_ytd.months} mesi)` },
    { label: 'Spesa', value: eur(blk.totals.cost), foot: `${eur(blk.prev_ytd.cost)} negli stessi mesi del ${e.year - 1}` },
    { label: 'CO2 equivalente', value: `${n0(blk.totals.co2 / 1000, 2)} t`, foot: 'fattori indicativi' },
  ]);
  kpiRow(st, [
    { label: 'kWh per m2 all\'anno', value: n0(blk.intensity.kwh_m2_anno, 1), foot: blk.intensity.annualizzato ? 'annualizzato sui mesi con dati' : 'anno completo' },
    { label: 'kWh per accettazione', value: n0(blk.intensity.kwh_per_acc, 2), foot: blk.activity.accettazioni ? `${n0(blk.activity.accettazioni)} accettazioni` : 'attività non registrata' },
    { label: 'kWh per ora di apertura', value: n0(blk.intensity.kwh_per_ora, 2), foot: blk.activity.ore ? `${n0(blk.activity.ore)} ore` : 'ore non disponibili' },
    { label: 'kg CO2 per m2', value: n0(blk.intensity.co2_m2, 1), foot: s?.benchmark?.position ? `benchmark: ${POS[s.benchmark.position]}` : '' },
  ]);
  const anomMonths = new Set((blk.anomalies || []).filter((a) => a.month.startsWith(String(e.year))).map((a) => a.month));
  barChart(st, blk.monthly.map((m) => ({ ...m, anomaly: anomMonths.has(m.month) })), { title: 'Consumi mensili in kWh equivalenti, confronto con l\'anno precedente' });

  st.h2('Consumi e costi per vettore');
  st.table([90, 50, 70, 70, 60, 60, 55], ['Vettore', 'Unità', 'Quantità', 'Spesa', 'Costo unitario', 'CO2 (kg)', 'Var. anno'],
    blk.vectors.map((v) => [VEC[v.vector] || v.vector, v.unit || '', n0(v.qty), eur(v.cost), v.unit_cost != null ? `${n0(v.unit_cost, 4)} €/${v.unit}` : '–', n0(v.co2), pct(v.delta_pct)]));

  st.h2('Confronto anno su anno');
  st.p(blk.yoy.ytd.prev != null ? `Da inizio anno (${blk.yoy.ytd.months} mesi): ${n0(blk.yoy.ytd.cur)} kWh contro ${n0(blk.yoy.ytd.prev)} kWh negli stessi mesi del ${e.year - 1} (${pct(blk.yoy.ytd.delta_pct)}).` : 'Manca l\'anno precedente per il confronto cumulato.');
  st.table([60, 70, 70, 60], ['Mese', `${e.year} (kWh)`, `${e.year - 1} (kWh)`, 'Variazione'], blk.yoy.months.filter((m) => m.cur != null || m.prev != null).map((m) => [MESI[Number(m.month.slice(5)) - 1], n0(m.cur), n0(m.prev), pct(m.delta_pct)]),
    { fills: (r) => [null, null, null, String(r[3]).startsWith('+') && parseFloat(String(r[3]).replace('+', '').replace(',', '.')) > 20 ? '#FBE3E1' : null] });

  if (!s) {
    st.h2('Confronto tra le sedi a parità di attività');
    st.table([120, 60, 45, 55, 55, 55, 55, 60], ['Sede', 'kWh', 'm2', 'kWh/m2 anno', 'kWh/acc.', 'kWh/ora', 'Spesa', 'Benchmark'],
      e.sites.filter((x) => x.totals.kwh > 0).map((x) => [x.site.name, n0(x.totals.kwh), n0(x.sqm), n0(x.intensity.kwh_m2_anno, 1), n0(x.intensity.kwh_per_acc, 2), n0(x.intensity.kwh_per_ora, 2), eur(x.totals.cost), x.benchmark.position ? POS[x.benchmark.position] : '–']));
    hBars(st, e.classifica.per_accettazione, { key: 'kwh_per_acc', label: 'Classifica: kWh per accettazione (più basso = più efficiente)', unit: 'kWh/acc.' });
    hBars(st, e.classifica.per_m2, { key: 'kwh_m2_anno', label: 'Classifica: kWh per m2 all\'anno', unit: 'kWh/m2' });
  } else if (s.benchmark.band) {
    st.h2('Benchmark indicativo');
    st.p(`Fascia indicativa per ${s.benchmark.band.label.toLowerCase()}: ${s.benchmark.band.min}-${s.benchmark.band.max} kWh per m2 all'anno. Valore della sede: ${n0(s.intensity.kwh_m2_anno, 1)}${s.benchmark.position ? ` (${POS[s.benchmark.position]})` : ''}.`);
  }

  st.h2('Anomalie');
  const an = (blk.anomalies || []).filter((a) => a.month.startsWith(String(e.year)));
  if (!an.length) st.p('Nessun mese oltre la soglia rispetto allo stesso mese dell\'anno prima o alla media dei tre mesi precedenti.');
  else st.table([60, 110, 70, 70, 60, 120], ['Mese', 'Sede · vettore', 'Valore', 'Riferimento', 'Scarto', 'Confronto'],
    an.map((a) => [a.month, `${(e.sites.find((x) => x.site.id === a.site_id)?.site.name) || ''} · ${VEC[a.vector] || a.vector}`, `${n0(a.value)} ${a.unit || ''}`, n0(a.ref), pct(a.delta_pct), a.ref_kind === 'ANNO_PRECEDENTE' ? 'stesso mese anno prima' : 'media mobile 3 mesi']), { fills: () => [null, null, null, null, '#FBE3E1', null] });

  const ob = e.obiettivi.filter((t) => t.year === e.year && (!siteId || t.site_id === siteId || t.site_id == null));
  if (ob.length) {
    st.h2('Obiettivi di riduzione');
    st.table([110, 60, 60, 60, 70, 70], ['Ambito', 'Vettore', 'Obiettivo', 'Anno base', 'Riduzione ottenuta', 'Stato'],
      ob.map((t) => [t.site_name || 'Rete', t.vector ? VEC[t.vector] : 'Energia totale', `-${n0(t.target_pct_reduction, 1)}%`, t.baseline_year, t.progress.reduction_pct != null ? `${n0(t.progress.reduction_pct, 1)}% su ${t.progress.months} mesi` : '–', TGT[t.progress.status]]));
  }

  if (analisi?.result) {
    st.h2(`Analisi con Claude (${dt(analisi.generated_at)})`);
    st.p(analisi.result.commento || '');
    if (analisi.result.azioni?.length) { doc.moveDown(0.3); st.table([60, 200, 150, 80], ['Urgenza', 'Azione', 'Beneficio atteso', 'Sede'], analisi.result.azioni.map((a) => [a.urgenza, a.azione, a.beneficio_atteso, a.sede])); }
    if (analisi.result.note_certificazione) st.p(analisi.result.note_certificazione, { color: C.grey });
    st.p('Supporto all\'analisi generato da un modello di intelligenza artificiale: va verificato da Facility e dalla funzione Qualità.', { size: 7.5, color: C.grey });
  }

  st.h2('Metodo e note');
  st.p(`Consumi dalle bollette registrate in Payments (ripartite sui giorni del periodo di fatturazione) o, in mancanza, dalle letture dei contatori. kWh equivalenti: gas ${n0(e.factors.kwh.GAS, 2)} kWh/Smc, gasolio ${n0(e.factors.kwh.GASOLIO, 1)} kWh/l. CO2: elettrico ${n0(e.factors.co2.ELETTRICO, 2)} kg/kWh, gas ${n0(e.factors.co2.GAS, 2)} kg/Smc (fattori indicativi, modificabili nelle impostazioni). Anomalia: mese oltre la soglia impostata rispetto allo stesso mese dell'anno prima o alla media dei tre mesi precedenti. ${BENCHMARK_SOURCE}`, { size: 8, color: C.grey });
  return st.finish();
}

// ------------------------------------------------------------------ Rapporto energetico (XLSX)
const headStyle = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
export async function energiaXlsx(e, { siteId = null } = {}) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Facility e Manutenzioni';
  const sites = siteId ? e.sites.filter((x) => x.site.id === siteId) : e.sites;
  const ws = wb.addWorksheet('Riepilogo');
  ws.columns = [{ header: 'Sede', key: 'sede', width: 30 }, { header: 'Tipologia', key: 'kind', width: 18 }, { header: 'm2', key: 'sqm', width: 9 }, { header: 'kWh equivalenti', key: 'kwh', width: 16 }, { header: `kWh ${e.year - 1} stessi mesi`, key: 'prev', width: 20 },
    { header: 'Var. %', key: 'delta', width: 9 }, { header: 'Spesa €', key: 'cost', width: 12 }, { header: 'CO2 kg', key: 'co2', width: 12 }, { header: 'kWh/m2 anno', key: 'm2', width: 12 }, { header: 'kWh/accettazione', key: 'acc', width: 16 },
    { header: 'kWh/ora apertura', key: 'ora', width: 16 }, { header: 'Accettazioni', key: 'nacc', width: 13 }, { header: 'Mesi con dati', key: 'mesi', width: 13 }, { header: 'Benchmark', key: 'bench', width: 16 }];
  const add = (name, kind, b, bench) => ws.addRow({ sede: name, kind, sqm: b.sqm, kwh: b.totals.kwh, prev: b.prev_ytd.kwh, delta: b.delta_kwh_pct, cost: b.totals.cost, co2: b.totals.co2, m2: b.intensity.kwh_m2_anno, acc: b.intensity.kwh_per_acc, ora: b.intensity.kwh_per_ora, nacc: b.activity.accettazioni, mesi: b.totals.months, bench: bench ? POS[bench] : '' });
  for (const s of sites) add(s.site.name, s.site.kind, s, s.benchmark.position);
  if (!siteId) add('RETE', '', e.network, null);
  headStyle(ws);
  const wm = wb.addWorksheet('Mensile');
  wm.columns = [{ header: 'Sede', key: 'sede', width: 30 }, { header: 'Mese', key: 'mese', width: 10 }, { header: 'kWh eq.', key: 'kwh', width: 12 }, { header: 'kWh eq. anno prima', key: 'prev', width: 16 }, { header: 'Spesa €', key: 'cost', width: 12 }, { header: 'CO2 kg', key: 'co2', width: 12 },
    ...['ELETTRICO', 'GAS', 'ACQUA'].map((v) => ({ header: `${VEC[v]} (qtà)`, key: v, width: 16 }))];
  for (const s of [...sites.map((x) => [x.site.name, x]), ...(siteId ? [] : [['RETE', e.network]])]) for (const m of s[1].monthly) wm.addRow({ sede: s[0], mese: m.month, kwh: m.kwh, prev: m.prev_kwh, cost: m.cost, co2: m.co2, ELETTRICO: m.by_vector.ELETTRICO?.qty ?? null, GAS: m.by_vector.GAS?.qty ?? null, ACQUA: m.by_vector.ACQUA?.qty ?? null });
  headStyle(wm);
  const wv = wb.addWorksheet('Vettori');
  wv.columns = [{ header: 'Sede', key: 'sede', width: 30 }, { header: 'Vettore', key: 'v', width: 18 }, { header: 'Unità', key: 'u', width: 8 }, { header: 'Quantità', key: 'q', width: 12 }, { header: 'Spesa €', key: 'c', width: 12 }, { header: 'Costo unitario', key: 'uc', width: 14 }, { header: 'CO2 kg', key: 'co2', width: 12 }, { header: 'Var. %', key: 'd', width: 9 }];
  for (const s of sites) for (const v of s.vectors) wv.addRow({ sede: s.site.name, v: VEC[v.vector], u: v.unit, q: v.qty, c: v.cost, uc: v.unit_cost, co2: v.co2, d: v.delta_pct });
  headStyle(wv);
  if (!siteId) {
    const wc = wb.addWorksheet('Classifica');
    wc.columns = [{ header: 'Posizione', key: 'rank', width: 10 }, { header: 'Sede', key: 'name', width: 30 }, { header: 'kWh/accettazione', key: 'acc', width: 16 }, { header: 'Scarto dalla media %', key: 'vs', width: 18 }, { header: 'kWh/m2 anno', key: 'm2', width: 12 }, { header: 'kWh/ora', key: 'ora', width: 10 }];
    for (const r of e.classifica.per_accettazione) wc.addRow({ rank: r.rank, name: r.name, acc: r.kwh_per_acc, vs: r.vs_media_pct, m2: r.kwh_m2_anno, ora: r.kwh_per_ora });
    headStyle(wc);
  }
  const wa = wb.addWorksheet('Anomalie');
  wa.columns = [{ header: 'Mese', key: 'm', width: 10 }, { header: 'Sede', key: 's', width: 30 }, { header: 'Vettore', key: 'v', width: 18 }, { header: 'Valore', key: 'val', width: 12 }, { header: 'Unità', key: 'u', width: 8 }, { header: 'Riferimento', key: 'ref', width: 12 }, { header: 'Confronto', key: 'k', width: 24 }, { header: 'Scarto %', key: 'd', width: 10 }];
  for (const s of sites) for (const a of s.anomalies) wa.addRow({ m: a.month, s: s.site.name, v: VEC[a.vector], val: a.value, u: a.unit, ref: a.ref, k: a.ref_kind === 'ANNO_PRECEDENTE' ? 'stesso mese anno prima' : 'media mobile 3 mesi', d: a.delta_pct });
  headStyle(wa);
  const wo = wb.addWorksheet('Obiettivi');
  wo.columns = [{ header: 'Ambito', key: 'a', width: 30 }, { header: 'Anno', key: 'y', width: 8 }, { header: 'Vettore', key: 'v', width: 18 }, { header: 'Obiettivo %', key: 't', width: 12 }, { header: 'Anno base', key: 'b', width: 10 }, { header: 'Riduzione %', key: 'r', width: 12 }, { header: 'Mesi confrontati', key: 'n', width: 15 }, { header: 'Stato', key: 's', width: 16 }];
  for (const t of e.obiettivi.filter((x) => !siteId || x.site_id === siteId || x.site_id == null)) wo.addRow({ a: t.site_name || 'Rete', y: t.year, v: t.vector ? VEC[t.vector] : 'Energia totale', t: Number(t.target_pct_reduction), b: t.baseline_year, r: t.progress.reduction_pct, n: t.progress.months, s: TGT[t.progress.status] });
  headStyle(wo);
  const wn = wb.addWorksheet('Note');
  wn.columns = [{ header: 'Nota', key: 'n', width: 140 }];
  wn.addRow({ n: BENCHMARK_SOURCE }); wn.addRow({ n: `Fattori CO2 (kg per unità): ${Object.entries(e.factors.co2).map(([k, v]) => `${k} ${v}`).join(', ')}. Conversione in kWh: ${Object.entries(e.factors.kwh).map(([k, v]) => `${k} ${v}`).join(', ')}.` });
  headStyle(wn);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ Registro delle manutenzioni
export async function manutenzioniXlsx({ plans, wos, kpi, year }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Facility e Manutenzioni';
  const ws = wb.addWorksheet('Scadenze');
  ws.columns = [{ header: 'Sede', key: 's', width: 26 }, { header: 'Dispositivo / obbligo', key: 'd', width: 34 }, { header: 'Tipo', key: 't', width: 26 }, { header: 'Serie', key: 'serie', width: 20 }, { header: 'Attività', key: 'k', width: 18 },
    { header: 'Scadenza', key: 'due', width: 12 }, { header: 'Stato', key: 'st', width: 12 }, { header: 'Eseguita il', key: 'done', width: 12 }, { header: 'Esito', key: 'o', width: 16 }, { header: 'Da', key: 'by', width: 22 }, { header: 'Costo €', key: 'c', width: 10 }, { header: 'Note', key: 'n', width: 40 }];
  for (const p of plans) ws.addRow({ s: p.site_name, d: p.asset_code ? `${p.asset_code}${p.asset_name ? ` ${p.asset_name}` : ''}` : p.obligation_title, t: p.type_name || (p.obligation_kind ? `Obbligo ${p.obligation_kind.toLowerCase()}` : ''), serie: STREAMS[p.stream], k: PLAN_KINDS[p.kind], due: p.due_date, st: PLAN_STATUS[p.effective_status] || p.status, done: p.done_at, o: OUTCOMES[p.outcome] || '', by: p.done_by_name || '', c: p.cost, n: p.notes || '' });
  headStyle(ws);
  const ww = wb.addWorksheet('Interventi');
  ww.columns = [{ header: 'Codice', key: 'c', width: 14 }, { header: 'Sede', key: 's', width: 26 }, { header: 'Titolo', key: 't', width: 40 }, { header: 'Priorità', key: 'p', width: 10 }, { header: 'Stato', key: 'st', width: 12 }, { header: 'Aperto il', key: 'o', width: 17 },
    { header: 'Chiuso il', key: 'cl', width: 17 }, { header: 'Ore di ripristino', key: 'mttr', width: 15 }, { header: 'Entro SLA', key: 'sla', width: 10 }, { header: 'Manutentore', key: 'm', width: 26 }, { header: 'Costo €', key: 'co', width: 10 }, { header: 'Fermo (ore)', key: 'f', width: 11 }, { header: 'Risoluzione', key: 'r', width: 50 }];
  for (const w of wos) ww.addRow({ c: w.code, s: w.site_name, t: w.title, p: PRIORITIES[w.priority], st: WO_STATUS[w.status], o: dt(w.opened_at), cl: dt(w.closed_at), mttr: w.mttr_hours, sla: w.closed_at ? (w.sla.late ? 'no' : 'sì') : '', m: w.vendor_name || w.assigned_name || '', co: w.cost, f: w.downtime_hours, r: w.resolution || '' });
  headStyle(ww);
  const wk = wb.addWorksheet('KPI');
  wk.columns = [{ header: 'Indicatore', key: 'k', width: 50 }, { header: 'Valore', key: 'v', width: 18 }];
  for (const [k, v] of kpiRows(kpi, year)) wk.addRow({ k, v });
  wk.addRow({}); wk.addRow({ k: 'Costi per sede', v: '' });
  for (const x of kpi.costi_per_sede) wk.addRow({ k: x.name, v: x.costo });
  wk.addRow({}); wk.addRow({ k: 'Costi per tipologia di dispositivo', v: '' });
  for (const x of kpi.costi_per_tipo) wk.addRow({ k: x.name, v: x.costo });
  headStyle(wk);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const kpiRows = (k, year) => [
  [`Scadenze eseguite nel ${year}`, k.eseguite], ['Scadenze rispettate (eseguite entro la data) %', k.rispettate_pct ?? '–'], ['Scadenze aperte già scadute', k.scadute], ['Scadenze nei prossimi 30 giorni', k.prossimi30],
  [`Interventi aperti nel ${year}`, k.interventi_aperti_anno], ['Interventi ancora aperti', k.interventi_aperti], ['MTTR (ore medie di ripristino)', k.mttr_ore ?? '–'], ['Interventi chiusi entro lo SLA %', k.sla_pct ?? '–'],
  ['Dispositivi non conformi', k.non_conformi], ['Dispositivi in servizio', k.dispositivi], [`Costo totale manutenzioni e interventi ${year} €`, k.costo_totale],
];
export async function manutenzioniPdf({ plans, wos, kpi, year, scope }) {
  const titolo = `Registro manutenzioni ${year} · ${scope}`;
  const st = await newDoc(titolo, { landscape: true });
  st.footer = `${titolo} · generato il ${dt(new Date())} da Suite TD · Facility e Manutenzioni`;
  const { doc, M } = st;
  st.addPage();
  doc.font('B').fontSize(15).fillColor(C.jet).text(titolo, M, doc.y); doc.moveDown(0.4);
  kpiRow(st, [{ label: 'Scadenze rispettate', value: kpi.rispettate_pct == null ? '–' : `${n0(kpi.rispettate_pct, 1)}%`, foot: `${kpi.eseguite} eseguite` }, { label: 'Scadute aperte', value: n0(kpi.scadute), color: kpi.scadute ? C.red : C.green },
    { label: 'MTTR', value: kpi.mttr_ore == null ? '–' : `${n0(kpi.mttr_ore, 1)} h`, foot: `${kpi.interventi_aperti} interventi aperti` }, { label: 'Entro SLA', value: kpi.sla_pct == null ? '–' : `${n0(kpi.sla_pct, 1)}%` },
    { label: 'Non conformi', value: n0(kpi.non_conformi), color: kpi.non_conformi ? C.red : C.ink }, { label: 'Costo dell\'anno', value: eur(kpi.costo_totale) }]);
  st.h2('Scadenze');
  st.table([100, 150, 110, 70, 60, 60, 60, 70, 90, 50], ['Sede', 'Dispositivo / obbligo', 'Tipo', 'Attività', 'Scadenza', 'Stato', 'Eseguita', 'Esito', 'Da', 'Costo'],
    plans.map((p) => [p.site_name, p.asset_code ? `${p.asset_code}${p.asset_name ? ` ${p.asset_name}` : ''}` : p.obligation_title, p.type_name || 'Obbligo dell\'immobile', PLAN_KINDS[p.kind], dd(p.due_date), PLAN_STATUS[p.effective_status] || p.status, dd(p.done_at), OUTCOMES[p.outcome] || '', p.done_by_name || '', p.cost != null ? eur(p.cost) : '']),
    { size: 7.5, fills: (r) => [null, null, null, null, null, r[5] === 'Scaduta' ? '#FBE3E1' : null, null, r[7] === 'Non conforme' ? '#FBE3E1' : null] });
  st.h2('Interventi');
  st.table([60, 100, 170, 50, 60, 80, 80, 50, 50, 120], ['Codice', 'Sede', 'Titolo', 'Priorità', 'Stato', 'Aperto', 'Chiuso', 'Ore', 'SLA', 'Manutentore'],
    wos.map((w) => [w.code, w.site_name, w.title, PRIORITIES[w.priority], WO_STATUS[w.status], dt(w.opened_at), dt(w.closed_at), w.mttr_hours ?? '', w.closed_at ? (w.sla.late ? 'fuori' : 'entro') : '', w.vendor_name || w.assigned_name || '']), { size: 7.5 });
  st.h2('Costi');
  st.table([200, 80, 200, 80], ['Sede', 'Costo', 'Tipologia di dispositivo', 'Costo'], Array.from({ length: Math.max(kpi.costi_per_sede.length, kpi.costi_per_tipo.length) }, (_, i) => [kpi.costi_per_sede[i]?.name || '', kpi.costi_per_sede[i] ? eur(kpi.costi_per_sede[i].costo) : '', kpi.costi_per_tipo[i]?.name || '', kpi.costi_per_tipo[i] ? eur(kpi.costi_per_tipo[i].costo) : '']));
  return st.finish();
}

// ------------------------------------------------------------------ Etichette QR
export async function etichettePdf(rows) {
  const st = await newDoc('Etichette QR dispositivi');
  const { doc } = st;
  const cols = 2, rowsN = 7, mx = 28, my = 30, gw = (595.28 - 2 * mx) / cols, gh = (841.89 - 2 * my) / rowsN;
  for (let i = 0; i < rows.length; i++) {
    if (i % (cols * rowsN) === 0) doc.addPage();
    const k = i % (cols * rowsN); const x = mx + (k % cols) * gw, y = my + Math.floor(k / cols) * gh;
    const a = rows[i];
    doc.roundedRect(x + 4, y + 4, gw - 8, gh - 8, 6).lineWidth(0.5).strokeColor(C.line).stroke();
    const qs = gh - 26;
    const png = await QRCode.toBuffer(a.qr_url, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
    doc.image(png, x + 13, y + 13, { width: qs });
    const tx = x + 13 + qs + 12, tw = gw - qs - 40;
    doc.font('B').fontSize(10).fillColor(C.jet).text(a.code, tx, y + 14, { width: tw, lineBreak: false, ellipsis: true });
    doc.font('R').fontSize(8).fillColor(C.ink).text(a.name || a.type_name, tx, y + 30, { width: tw, height: 22, ellipsis: true });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(a.type_name, tx, y + 52, { width: tw, lineBreak: false, ellipsis: true });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(`${a.site_name}${a.location ? ` · ${a.location}` : ''}`, tx, y + 63, { width: tw, height: 20, ellipsis: true });
    doc.font('B').fontSize(7).fillColor(C.teal).text('Inquadra per aprire la scheda', tx, y + gh - 24, { width: tw, lineBreak: false, ellipsis: true });
  }
  st.footer = '';
  doc.end();
  return new Promise((resolve, reject) => { const chunks = []; doc.on('data', (x) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
}

export const fontName = () => (/Lato/.test(FONT_R) ? 'Lato' : (fs.existsSync(FONT_R) ? 'Liberation Sans' : 'Helvetica'));
