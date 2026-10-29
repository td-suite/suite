// Esportazioni del modulo Audit SGI: archivio XLSX (fogli Archivio, Punteggi per sezione, NC) e PDF (lista impaginata con intestazione
// Toscana Diagnostica); singolo audit XLSX (checklist compilata voce per voce, colonne Sede e Verifica per gli AUTO) e PDF nello stile
// del MOD originale (testata, sezioni con tabella voce / Si / No / NC / N.A. / Note [+ Verifica], pagina Audit report con NC e
// osservazioni, piè con codice modello e revisione). PDF con pdfkit; font Lato se installato sul sistema, altrimenti Liberation Sans
// (metricamente compatibile con Helvetica, copre gli accenti).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany } from '../../../lib/company.js';
import { KINDS, STATUS_LABEL } from '../config.js';
import { itemsOf, sectionsOf, levelOf, monthLabel } from './scoring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIB_ASSETS = path.join(here, '..', '..', 'shipments', 'assets');
const LOGO = fs.existsSync(path.join(LIB_ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(LIB_ASSETS, 'logo-td.png')) : null;
const LATO_DIRS = ['/usr/share/fonts/truetype/lato', '/usr/share/fonts/lato', '/usr/share/fonts/truetype/google-fonts', '/usr/local/share/fonts'];
function findFont(names, fallback) {
  for (const d of LATO_DIRS) for (const n of names) { const f = path.join(d, n); if (fs.existsSync(f)) return f; }
  return fallback;
}
export const FONT_R = findFont(['Lato-Regular.ttf'], path.join(LIB_ASSETS, 'LiberationSans-Regular.ttf'));
export const FONT_B = findFont(['Lato-Bold.ttf'], path.join(LIB_ASSETS, 'LiberationSans-Bold.ttf'));
export const fontName = () => (/Lato/.test(FONT_R) ? 'Lato' : (fs.existsSync(FONT_R) ? 'Liberation Sans' : 'Helvetica'));

const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', bg: '#F3F7F8', soft: '#EAF5F7', white: '#FFFFFF', red: '#B3261E', amber: '#A35A00', green: '#2F7D5B', si: '#DDF2E6', no: '#FBE3E1', nc: '#F7D6D1', na: '#E8ECEE' };
const dd = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
const dt = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
const pctS = (v) => (v == null ? '' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const lvl = (v) => { const l = levelOf(v); return l ? `${l.letter} ${l.label}` : ''; };
const ANS = { SI: 'Sì', NO: 'No', NC: 'NC', NA: 'N.A.' };
const ESITO = { CONFORME: 'Conforme', CONFORME_CON_RILIEVI: 'Conforme con rilievi', NON_CONFORME: 'Non conforme', ALTRO: 'Altro', IDONEO: 'Idoneo', IDONEO_CON_AZIONI: 'Idoneo con azioni', NON_IDONEO: 'Non idoneo' };
const esitoL = (v) => (v ? ESITO[v] || String(v).replace(/_/g, ' ').toLowerCase() : '');
export const dataAudit = (a) => (a.kind === 'AUTO' && a.period ? monthLabel(a.period) : dd(a.conducted_at || a.created_at));
const soggetto = (a) => (a.kind === 'LEGAL_ENTITY' ? a.org_name : a.site_name) || '';
const condotto = (a) => a.header?.effettuato_da || a.conducted_by_name || '';

// ------------------------------------------------------------------ XLSX archivio
const headStyle = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } }; };
export async function archivioXlsx(rows) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Audit SGI';
  const ws = wb.addWorksheet('Archivio');
  ws.columns = [
    { header: 'Id', key: 'id', width: 7 }, { header: 'Data / mese', key: 'data', width: 16 }, { header: 'Tipo', key: 'tipo', width: 22 }, { header: 'Sede / partner', key: 'soggetto', width: 32 }, { header: 'Codice sede', key: 'codice', width: 12 },
    { header: 'Condotto da', key: 'condotto', width: 26 }, { header: 'Verificato da', key: 'verificato', width: 26 }, { header: 'Stato', key: 'stato', width: 12 }, { header: 'Punteggio sede', key: 'score', width: 14 }, { header: 'Punteggio verifica', key: 'score_v', width: 16 },
    { header: 'Scostamento', key: 'delta', width: 12 }, { header: 'Punteggio che fa fede', key: 'eff', width: 18 }, { header: 'Livello', key: 'livello', width: 26 }, { header: 'NC', key: 'nc', width: 6 }, { header: 'Allegati', key: 'files', width: 9 },
    { header: 'Ente (terze parti)', key: 'ente', width: 24 }, { header: 'Esito (terze parti / partner)', key: 'esito', width: 24 }, { header: 'Modello', key: 'modello', width: 16 }, { header: 'Osservazioni', key: 'oss', width: 50 },
  ];
  for (const a of rows) {
    ws.addRow({ id: a.id, data: dataAudit(a), tipo: KINDS[a.kind] || a.kind, soggetto: soggetto(a), codice: a.site_code || '', condotto: condotto(a), verificato: a.verified_by_name || '', stato: STATUS_LABEL[a.status] || a.status,
      score: a.score ?? '', score_v: a.score_verifier ?? '', delta: a.score_delta ?? '', eff: a.effective_score ?? '', livello: lvl(a.effective_score), nc: a.n_nc || 0, files: a.n_files || 0,
      ente: a.kind === 'TERZI' ? `${a.third_party?.ente_tipo || ''} ${a.third_party?.ente || ''}`.trim() : '', esito: a.kind === 'TERZI' ? esitoL(a.third_party?.esito) : esitoL(a.report?.esito), modello: a.template_code ? `${a.template_code} rev. ${a.template_rev}` : '', oss: a.observations || '' });
  }
  headStyle(ws);
  const ps = wb.addWorksheet('Punteggi per sezione');
  ps.columns = [{ header: 'Id audit', key: 'id', width: 8 }, { header: 'Data / mese', key: 'data', width: 16 }, { header: 'Tipo', key: 'tipo', width: 22 }, { header: 'Sede / partner', key: 'soggetto', width: 32 }, { header: 'Sezione', key: 'sez', width: 44 },
    { header: 'Punteggio sede', key: 'score', width: 14 }, { header: 'Punteggio verifica', key: 'score_v', width: 16 }, { header: 'Sì', key: 'si', width: 6 }, { header: 'No', key: 'no', width: 6 }, { header: 'NC', key: 'nc', width: 6 }, { header: 'N.A.', key: 'na', width: 6 }, { header: 'Risposte', key: 'ans', width: 10 }, { header: 'Voci', key: 'tot', width: 8 }];
  for (const a of rows) for (const [k, s] of Object.entries(a.score_by_section || {})) ps.addRow({ id: a.id, data: dataAudit(a), tipo: KINDS[a.kind] || a.kind, soggetto: soggetto(a), sez: `${k} · ${s.title || ''}`, score: s.score ?? '', score_v: s.score_verifier ?? '', si: s.si || 0, no: s.no || 0, nc: s.nc || 0, na: s.na || 0, ans: s.answered || 0, tot: s.total || 0 });
  headStyle(ps);
  const nc = wb.addWorksheet('NC');
  nc.columns = [{ header: 'Id audit', key: 'id', width: 8 }, { header: 'Data / mese', key: 'data', width: 16 }, { header: 'Tipo', key: 'tipo', width: 22 }, { header: 'Sede / partner', key: 'soggetto', width: 32 }, { header: 'Voce', key: 'n', width: 8 }, { header: 'Descrizione', key: 'descrizione', width: 44 },
    { header: 'Cause', key: 'cause', width: 30 }, { header: 'Soluzione', key: 'soluzione', width: 30 }, { header: 'Azione correttiva', key: 'azione', width: 34 }, { header: 'Persona di riferimento', key: 'persona', width: 24 }, { header: 'Entro', key: 'entro', width: 12 }];
  for (const a of rows) for (const n of (a.ncs || []).filter((x) => x && (x.descrizione || x.n))) nc.addRow({ id: a.id, data: dataAudit(a), tipo: KINDS[a.kind] || a.kind, soggetto: soggetto(a), n: n.n || '', descrizione: n.descrizione || '', cause: n.cause || '', soluzione: n.soluzione || '', azione: n.azione_correttiva || '', persona: n.persona_riferimento || '', entro: n.entro || '' });
  headStyle(nc);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ XLSX singolo audit
export async function auditXlsx(a) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Audit SGI';
  const ws = wb.addWorksheet('Checklist');
  const auto = a.kind === 'AUTO';
  const items = a.template ? itemsOf(a.template.body) : [];
  ws.columns = [{ header: 'Parte', key: 'parte', width: 18 }, { header: 'Sezione', key: 'sez', width: 36 }, { header: 'N.', key: 'n', width: 7 }, { header: 'Voce', key: 'voce', width: 70 }, { header: 'Rev.', key: 'rev', width: 7 },
    { header: auto ? 'Sede' : 'Esito', key: 'v', width: 8 }, { header: auto ? 'Nota sede' : 'Nota', key: 'nota', width: 40 }, ...(auto ? [{ header: 'Verifica', key: 'vv', width: 9 }, { header: 'Nota verifica', key: 'vnota', width: 40 }] : []), ...(a.kind === 'LEGAL_ENTITY' ? [{ header: 'Rischio', key: 'risk', width: 9 }] : [])];
  const top = [[`${a.template?.title || 'Audit'}`], [`${KINDS[a.kind]} · ${soggetto(a)} · ${dataAudit(a)} · effettuato da ${condotto(a)} · stato ${STATUS_LABEL[a.status] || a.status}`], [`Punteggio ${auto ? 'sede' : ''} ${pctS(a.score)}${a.score_verifier != null ? ` · verifica ${pctS(a.score_verifier)}` : ''} · livello ${lvl(a.effective_score)}`], []];
  ws.spliceRows(1, 0, ...top);
  ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1C505E' } };
  ws.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } };
  for (const it of items) {
    const x = a.answers?.[it.key] || {}; const v = a.verifier_answers?.[it.key] || {};
    if (it.free && !x.free && !v.free) continue;
    ws.addRow({ parte: it.part_title, sez: `${it.section_key} · ${it.section_title}`, n: it.key, voce: it.free ? `${it.label}: ${x.free || v.free || ''}` : (it.parent ? `${it.parent} · ${it.label}` : it.label), rev: x.rev || '', v: ANS[x.v] || '', nota: x.note || '', vv: ANS[v.v] || '', vnota: v.note || '', risk: x.risk || '' });
  }
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  const rep = wb.addWorksheet('Audit report');
  rep.columns = [{ header: 'N.', key: 'n', width: 7 }, { header: 'Descrizione NC', key: 'descrizione', width: 44 }, { header: 'Cause', key: 'cause', width: 30 }, { header: 'Soluzione', key: 'soluzione', width: 30 }, { header: 'Azione correttiva', key: 'azione', width: 34 }, { header: 'Persona di riferimento', key: 'persona', width: 24 }, { header: 'Entro', key: 'entro', width: 12 }];
  headStyle(rep);
  for (const n of (a.ncs || []).filter((x) => x && (x.descrizione || x.n))) rep.addRow({ n: n.n || '', descrizione: n.descrizione || '', cause: n.cause || '', soluzione: n.soluzione || '', azione: n.azione_correttiva || '', persona: n.persona_riferimento || '', entro: n.entro || '' });
  rep.addRow([]); rep.addRow(['Osservazioni', a.observations || '']);
  if (a.kind === 'LEGAL_ENTITY') { rep.addRow(['Rischio finale', a.report?.livello_rischio_finale || '']); rep.addRow(['Esito', a.report?.esito || '']); }
  const sez = wb.addWorksheet('Punteggi');
  sez.columns = [{ header: 'Sezione', key: 'sez', width: 44 }, { header: auto ? 'Sede' : 'Punteggio', key: 'score', width: 12 }, ...(auto ? [{ header: 'Verifica', key: 'score_v', width: 12 }] : []), { header: 'Sì', key: 'si', width: 6 }, { header: 'No', key: 'no', width: 6 }, { header: 'NC', key: 'nc', width: 6 }, { header: 'N.A.', key: 'na', width: 6 }];
  headStyle(sez);
  for (const [k, s] of Object.entries(a.score_by_section || {})) sez.addRow({ sez: `${k} · ${s.title || ''}`, score: s.score ?? '', score_v: s.score_verifier ?? '', si: s.si || 0, no: s.no || 0, nc: s.nc || 0, na: s.na || 0 });
  sez.addRow({ sez: 'TOTALE', score: a.score ?? '', score_v: a.score_verifier ?? '' }).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF comune (pdfkit)
const A4 = { W: 595.28, H: 841.89 }; const M = 40;
async function newDoc(title, { landscape = false } = {}) {
  const co = await getCompany();
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: title, Author: co.legal_name || 'Toscana Diagnostica', Creator: 'Suite TD · Audit SGI' } });
  if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
  const W = landscape ? A4.H : A4.W, H = landscape ? A4.W : A4.H;
  const st = { doc, co, W, H, M, title, footer: '' };
  st.addPage = () => {
    doc.addPage();
    // intestazione: logo (se presente) + ragione sociale a sinistra, titolo a destra
    // il logo TD è largo (1800x351): 22 pt di altezza → circa 113 pt di larghezza; il testo parte dopo
    const logoW = LOGO ? 22 * 5.13 + 12 : 0;
    if (LOGO) { try { doc.image(LOGO, M, 24, { height: 22 }); } catch { /* logo non leggibile */ } }
    doc.font('B').fontSize(10).fillColor(C.teal).text(co.name || 'Toscana Diagnostica', M + logoW, 24, { width: 240, lineBreak: false });
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(co.address_full || '', M + logoW, 37, { width: 240, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(9).fillColor(C.jet).text(title, W / 2, 26, { width: W / 2 - M, align: 'right' });
    doc.moveTo(M, 56).lineTo(W - M, 56).lineWidth(.8).strokeColor(C.teal).stroke();
    doc.y = 66;
    return doc;
  };
  st.finish = () => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('R').fontSize(7.5).fillColor(C.grey).text(st.footer, M, H - 30, { width: W - 2 * M - 60, lineBreak: false, ellipsis: true });
      doc.text(`Pagina ${i - range.start + 1} di ${range.count}`, W - M - 60, H - 30, { width: 60, align: 'right', lineBreak: false });
    }
    doc.end();
    return new Promise((resolve, reject) => { const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  };
  st.ensure = (h) => { if (doc.y + h > H - 48) st.addPage(); };
  return st;
}
// riga di tabella con celle a capo automatico e altezza calcolata; fills: colore di sfondo per cella
function tableRow(st, x, y, cols, cells, { font = 'R', size = 8, fills = [], color = C.ink, pad = 3, head = false, minH = 14 } = {}) {
  const { doc } = st;
  doc.font(font).fontSize(size);
  const heights = cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: cols[i] - pad * 2, lineGap: 1 }));
  const h = Math.max(minH, ...heights) + pad * 2;
  let cx = x;
  cells.forEach((c, i) => {
    const fill = head ? C.teal : fills[i];
    if (fill) doc.rect(cx, y, cols[i], h).fill(fill);
    doc.rect(cx, y, cols[i], h).lineWidth(.4).strokeColor(C.line).stroke();
    doc.fillColor(head ? C.white : color).font(head ? 'B' : font).fontSize(size).text(String(c ?? ''), cx + pad, y + pad, { width: cols[i] - pad * 2, lineGap: 1 });
    cx += cols[i];
  });
  return h;
}

// ------------------------------------------------------------------ PDF archivio (lista filtrata, orizzontale)
export async function archivioPdf(rows, { filtri = '' } = {}) {
  const st = await newDoc('Archivio audit SGI', { landscape: true });
  st.footer = `Archivio audit SGI · generato il ${dt(new Date())} da Suite TD${filtri ? ` · filtri: ${filtri}` : ''}`;
  const { doc, W } = st;
  st.addPage();
  doc.font('B').fontSize(15).fillColor(C.jet).text('Archivio audit SGI', M, doc.y);
  doc.font('R').fontSize(9).fillColor(C.grey).text(`${rows.length} audit${filtri ? ` · ${filtri}` : ''} · generato il ${dt(new Date())}`, M, doc.y + 2);
  doc.y += 12;
  const cols = [58, 92, 150, 110, 58, 46, 46, 110, 26, 64];
  const scale = (W - 2 * M) / cols.reduce((a, b) => a + b, 0);
  const c = cols.map((w) => w * scale);
  const head = ['Data / mese', 'Tipo', 'Sede / partner', 'Condotto da', 'Stato', 'Sede %', 'Verif. %', 'Livello', 'NC', 'Esito / ente'];
  let y = doc.y;
  y += tableRow(st, M, y, c, head, { head: true, size: 8 });
  for (const a of rows) {
    const cells = [dataAudit(a), KINDS[a.kind] || a.kind, soggetto(a), condotto(a), STATUS_LABEL[a.status] || a.status, pctS(a.score), pctS(a.score_verifier), lvl(a.effective_score), String(a.n_nc || 0), a.kind === 'TERZI' ? `${esitoL(a.third_party?.esito)} · ${a.third_party?.ente || ''}` : esitoL(a.report?.esito)];
    doc.font('R').fontSize(7.5);
    const h = Math.max(14, ...cells.map((x, i) => doc.heightOfString(x, { width: c[i] - 6 }))) + 6;
    if (y + h > st.H - 48) { st.addPage(); y = doc.y; y += tableRow(st, M, y, c, head, { head: true, size: 8 }); }
    const l = levelOf(a.effective_score);
    const fills = []; fills[7] = l ? { A: C.si, B: C.soft, C: '#FFF1D6', D: C.no }[l.letter] : null;
    y += tableRow(st, M, y, c, cells, { size: 7.5, fills });
  }
  return st.finish();
}

// ------------------------------------------------------------------ PDF singolo audit (modulo compilato)
export async function auditPdf(a) {
  const auto = a.kind === 'AUTO';
  const t = a.template?.body;
  const titolo = t?.title || KINDS[a.kind];
  const st = await newDoc(`${KINDS[a.kind]} · ${soggetto(a)}`);
  st.footer = `${t ? `${t.code} rev. ${t.rev}${t.rev_date ? ` del ${dd(t.rev_date)}` : ''}` : 'Audit SGI'} · ${KINDS[a.kind]} · ${soggetto(a)} · ${dataAudit(a)} · stampato il ${dt(new Date())} da Suite TD`;
  const { doc, W } = st;
  const CW = W - 2 * M;
  st.addPage();
  // Testata nello stile del MOD
  doc.font('B').fontSize(14).fillColor(C.jet).text(titolo, M, doc.y, { width: CW });
  doc.font('R').fontSize(8.5).fillColor(C.grey).text(`${KINDS[a.kind]}${t?.derived_from ? ` · ${t.derived_from}` : ''}`, M, doc.y + 1, { width: CW });
  doc.y += 10;
  const hf = (t?.header_fields || []).map((f) => [f.label, f.source === 'site' ? a.site_name : f.source === 'organization' ? a.org_name : (f.type === 'date' ? dd(a.header?.[f.key] || a.conducted_at || a.created_at) : (a.header?.[f.key] || ''))]);
  if (auto) hf.splice(1, 0, ['Mese', monthLabel(a.period)]);
  hf.push(['Stato', `${STATUS_LABEL[a.status] || a.status}${a.verified_by_name ? ` · verificato da ${a.verified_by_name} il ${dd(a.verified_at)}` : ''}`]);
  const half = Math.ceil(hf.length / 2);
  const boxH = Math.max(half, hf.length - half) * 24 + 10;
  doc.roundedRect(M, doc.y, CW, boxH, 6).fill(C.bg);
  let by = doc.y + 6;
  [hf.slice(0, half), hf.slice(half)].forEach((col, ci) => {
    let yy = by;
    for (const [l, v] of col) {
      doc.font('B').fontSize(6.5).fillColor(C.teal).text(String(l).toUpperCase(), M + 8 + ci * (CW / 2), yy, { width: CW / 2 - 16, characterSpacing: .4, lineBreak: false, ellipsis: true });
      doc.font('R').fontSize(9).fillColor(C.ink).text(String(v || '-'), M + 8 + ci * (CW / 2), yy + 8, { width: CW / 2 - 16, lineBreak: false, ellipsis: true });
      yy += 24;
    }
  });
  doc.y = by + boxH + 2;
  // Punteggi
  const l = levelOf(a.effective_score);
  const tone = l ? { A: C.green, B: C.teal, C: C.amber, D: C.red }[l.letter] : C.grey;
  const py = doc.y;
  doc.roundedRect(M, py, CW, 44, 6).lineWidth(.6).strokeColor(C.line).stroke();
  doc.font('B').fontSize(20).fillColor(tone).text(a.effective_score != null ? pctS(a.effective_score) : 'n.d.', M + 12, py + 10, { width: 90, lineBreak: false });
  doc.font('B').fontSize(9).fillColor(tone).text(l ? `${l.letter} · ${l.label}` : (a.kind === 'TERZI' ? 'Punteggio non calcolato' : 'Senza punteggio'), M + 105, py + 9, { width: 220, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(C.grey).text(auto ? `Colonna sede ${pctS(a.score) || 'n.d.'}${a.score_verifier != null ? ` · colonna verifica ${pctS(a.score_verifier)} (scostamento ${a.score_delta >= 0 ? '+' : ''}${a.score_delta})` : ' · verifica non ancora compilata'}. Fa fede ${a.score_source === 'VERIFICA' ? 'la verifica' : 'la sede'}.` : `Sì = 1, No/NC = 0, N.A. escluse. ${a.n_nc || 0} non conformità.`, M + 105, py + 24, { width: CW - 120, lineBreak: false, ellipsis: true });
  doc.y = py + 52;

  if (a.kind === 'TERZI') {
    const tp = a.third_party || {};
    doc.font('B').fontSize(11).fillColor(C.teal).text('Rapporto dell\'ente', M, doc.y); doc.y += 4;
    for (const [k, v] of [['Tipo di ente', tp.ente_tipo], ['Ente', tp.ente], ['Data', dd(tp.data)], ['Esito', esitoL(tp.esito)], ['Note', tp.note]]) { doc.font('B').fontSize(8.5).fillColor(C.ink).text(`${k}: `, M, doc.y, { continued: true }); doc.font('R').text(String(v || '-')); }
    doc.y += 6;
    doc.font('B').fontSize(9).fillColor(C.ink).text(`Allegati (${(a.files || []).length})`, M, doc.y);
    for (const f of a.files || []) doc.font('R').fontSize(8.5).text(`• ${f.filename}${f.label ? ` (${f.label})` : ''}`, M + 8, doc.y);
    return st.finish();
  }

  // Sezioni del modello: tabella voce / Sì / No / NC / N.A. / Note (+ Verifica / Note verifica per gli AUTO)
  const items = t ? itemsOf(t) : [];
  const vcols = auto ? [24, 24, 24, 26] : [26, 26, 26, 28];
  const colsBase = auto ? [32, 176, 24, ...vcols, 66, 24, 24, 24, 26, 66] : [34, 256, 28, ...vcols, 89];
  const scale = CW / colsBase.reduce((x, y) => x + y, 0);
  const cols = colsBase.map((w) => w * scale);
  const head = auto ? ['N.', 'Voce', 'Rev.', 'Sì', 'No', 'NC', 'N.A.', 'Note sede', 'Sì', 'No', 'NC', 'N.A.', 'Note verifica'] : ['N.', 'Voce', 'Rev.', 'Sì', 'No', 'NC', 'N.A.', 'Note'];
  const mark = (v, k) => (v === k ? 'X' : '');
  const fillsFor = (v, offset) => { const f = []; const idx = { SI: 0, NO: 1, NC: 2, NA: 3 }[v]; if (idx != null) f[offset + idx] = { SI: C.si, NO: C.no, NC: C.nc, NA: C.na }[v]; return f; };
  for (const part of t?.parts || []) {
    st.ensure(60);
    doc.y += 4;
    doc.font('B').fontSize(12).fillColor(C.jet).text(part.title.toUpperCase(), M, doc.y, { characterSpacing: .5 });
    doc.y += 2;
    for (const sec of part.sections || []) {
      st.ensure(70);
      doc.y += 4;
      const sb = a.score_by_section?.[sec.key];
      doc.font('B').fontSize(9.5).fillColor(C.teal).text(`${sec.key} · ${sec.title}`, M, doc.y, { width: CW - 150, continued: false });
      const scoreTxt = sb ? `${auto ? 'sede ' : ''}${pctS(sb.score) || 'n.d.'}${sb.score_verifier != null ? ` · verifica ${pctS(sb.score_verifier)}` : ''}` : '';
      doc.font('B').fontSize(8.5).fillColor(C.grey).text(scoreTxt, W - M - 150, doc.y - 11, { width: 150, align: 'right', lineBreak: false });
      if (sec.hint) doc.font('R').fontSize(7.5).fillColor(C.grey).text(sec.hint, M, doc.y, { width: CW });
      doc.y += 3;
      if (auto) {
        // fascia sopra l'intestazione: "Sede" e "Verifica"
        const x0 = M + cols.slice(0, 3).reduce((x, y) => x + y, 0);
        const wS = cols.slice(3, 8).reduce((x, y) => x + y, 0), wV = cols.slice(8).reduce((x, y) => x + y, 0);
        doc.rect(x0, doc.y, wS, 11).fill(C.blue); doc.rect(x0 + wS, doc.y, wV, 11).fill(C.teal);
        doc.font('B').fontSize(7).fillColor(C.white).text('COMPILAZIONE DELLA SEDE', x0, doc.y + 2, { width: wS, align: 'center', lineBreak: false }).text('VERIFICA', x0 + wS, doc.y - 7.5, { width: wV, align: 'center', lineBreak: false });
        doc.y += 11;
      }
      let y = doc.y;
      y += tableRow(st, M, y, cols, head, { head: true, size: 7.5, minH: 12 });
      let lastGroup = null;
      for (const it of items.filter((x) => x.section_key === sec.key)) {
        const x = a.answers?.[it.key] || {}; const v = a.verifier_answers?.[it.key] || {};
        if (it.free && !x.free && !v.free) continue;
        if (it.group && it.group !== lastGroup) {
          if (y + 14 > st.H - 48) { st.addPage(); y = doc.y; y += tableRow(st, M, y, cols, head, { head: true, size: 7.5, minH: 12 }); }
          doc.rect(M, y, CW, 12).fill(C.soft); doc.font('B').fontSize(7.5).fillColor(C.teal).text(it.group, M + 4, y + 2.5, { lineBreak: false }); y += 12; lastGroup = it.group;
        }
        const voce = it.free ? `${it.label}: ${x.free || v.free || ''}` : (it.parent ? `${it.parent} · ${it.label}` : it.label);
        const cells = auto ? [it.key, voce, x.rev || '', mark(x.v, 'SI'), mark(x.v, 'NO'), mark(x.v, 'NC'), mark(x.v, 'NA'), x.note || '', mark(v.v, 'SI'), mark(v.v, 'NO'), mark(v.v, 'NC'), mark(v.v, 'NA'), v.note || '']
          : [it.key, voce, x.rev || '', mark(x.v, 'SI'), mark(x.v, 'NO'), mark(x.v, 'NC'), mark(x.v, 'NA'), [x.note, x.risk ? `rischio ${x.risk}` : null].filter(Boolean).join(' · ')];
        doc.font('R').fontSize(7.5);
        const h = Math.max(13, ...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i] - 6, lineGap: 1 }))) + 6;
        if (y + h > st.H - 48) { st.addPage(); y = doc.y; y += tableRow(st, M, y, cols, head, { head: true, size: 7.5, minH: 12 }); }
        const fills = fillsFor(x.v, 3); if (auto) Object.assign(fills, Object.fromEntries(Object.entries(fillsFor(v.v, 8)).filter(([, c]) => c)));
        y += tableRow(st, M, y, cols, cells, { size: 7.5, fills, minH: 13 });
      }
      doc.y = y + 2;
    }
  }
  // Pagina Audit report
  st.addPage();
  doc.font('B').fontSize(13).fillColor(C.jet).text(t?.report?.title || 'Audit report', M, doc.y);
  doc.font('R').fontSize(8).fillColor(C.grey).text(t?.report?.hint || '', M, doc.y + 2, { width: CW });
  doc.y += 10;
  const ncCols = [26, 120, 80, 80, 90, 70, 49].map((w) => (w * CW) / 515);
  let y = doc.y;
  y += tableRow(st, M, y, ncCols, ['N.', 'Descrizione NC', 'Cause', 'Soluzione', 'Azione correttiva', 'Persona di riferimento', 'Entro'], { head: true, size: 7.5 });
  const ncs = (a.ncs || []).filter((x) => x && (x.descrizione || x.n));
  if (!ncs.length) y += tableRow(st, M, y, [CW], ['Nessuna non conformità registrata'], { size: 8, color: C.grey, minH: 18 });
  for (const n of ncs) {
    const cells = [n.n || '', n.descrizione || '', n.cause || '', n.soluzione || '', n.azione_correttiva || '', n.persona_riferimento || '', n.entro || ''];
    doc.font('R').fontSize(7.5);
    const h = Math.max(14, ...cells.map((c, i) => doc.heightOfString(String(c), { width: ncCols[i] - 6 }))) + 6;
    if (y + h > st.H - 48) { st.addPage(); y = doc.y; }
    y += tableRow(st, M, y, ncCols, cells, { size: 7.5 });
  }
  doc.y = y + 12;
  st.ensure(80);
  doc.font('B').fontSize(10).fillColor(C.teal).text(t?.report?.observations_label || 'Ulteriori eventuali osservazioni', M, doc.y);
  doc.y += 2;
  const oy = doc.y; const oh = Math.max(60, doc.font('R').fontSize(9).heightOfString(a.observations || ' ', { width: CW - 16 }) + 16);
  doc.roundedRect(M, oy, CW, oh, 4).lineWidth(.6).strokeColor(C.line).stroke();
  doc.font('R').fontSize(9).fillColor(C.ink).text(a.observations || '', M + 8, oy + 8, { width: CW - 16 });
  doc.y = oy + oh + 10;
  for (const f of t?.report?.extra_fields || []) { doc.font('B').fontSize(9).fillColor(C.ink).text(`${f.label}: `, M, doc.y, { continued: true }); doc.font('R').text(esitoL(a.report?.[f.key]) || '-'); }
  if ((a.files || []).length) { doc.y += 8; doc.font('B').fontSize(9).fillColor(C.ink).text(`Evidenze allegate (${a.files.length})`, M, doc.y); for (const f of a.files) doc.font('R').fontSize(8.5).text(`• ${f.filename}${f.label ? ` (${f.label})` : ''}`, M + 8, doc.y); }
  // firme
  st.ensure(70);
  doc.y += 18;
  const sy = doc.y;
  [['Effettuato da', condotto(a)], [auto ? 'Verificato da' : 'Visto Qualità', a.verified_by_name || '']].forEach(([l2, v2], i) => {
    const x = M + i * (CW / 2);
    doc.font('B').fontSize(7).fillColor(C.teal).text(l2.toUpperCase(), x, sy, { characterSpacing: .4 });
    doc.font('R').fontSize(9).fillColor(C.ink).text(v2 || ' ', x, sy + 10);
    doc.moveTo(x, sy + 34).lineTo(x + CW / 2 - 24, sy + 34).lineWidth(.5).strokeColor(C.grey).stroke();
    doc.font('R').fontSize(7).fillColor(C.grey).text('firma', x, sy + 36);
  });
  return st.finish();
}
