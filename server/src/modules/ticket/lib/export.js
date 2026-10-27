// Esportazioni del modulo Ticket: elenco XLSX (con foglio Statistiche), scheda PDF del ticket, rapporto PDF di periodo.
// PDF con pdfkit, font LiberationSans e logo come lib/orgchartExport.js della Suite.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getCompany } from '../../../lib/company.js';
import { STATO_LABEL } from './core.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shipments', 'assets');
const FONT_R = path.join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_B = path.join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', ink: '#0F2A33', bg: '#F3F7F8', white: '#FFFFFF', red: '#B3261E', amber: '#A35A00', green: '#2F7D5B' };
const PRIO = { P1: 'P1 Critica', P2: 'P2 Alta', P3: 'P3 Normale', P4: 'P4 Bassa' };
const dt = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
const dd = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
const ore = (a, b, attesa = 0) => (a && b ? Math.round(((new Date(b) - new Date(a)) / 3600_000 - (attesa || 0) / 3600) * 10) / 10 : null);
const EVENTO = { APERTO: 'Apertura', PRESO_IN_CARICO: 'Presa in carico', ASSEGNATO: 'Assegnazione', GIRATO: 'Giro ad altra casella', STATO: 'Cambio di stato', PRIORITA: 'Cambio di priorità', COMMENTO: 'Commento', NOTA: 'Nota interna', ALLEGATO: 'Allegato', ESCALATION: 'Escalation', RIAPERTO: 'Riapertura', CHIUSO: 'Chiusura', VALUTATO: 'Valutazione', LETTURA_RISERVATO: 'Lettura (riservato)', ANNULLATO: 'Annullamento', MODIFICA: 'Modifica', OSSERVATORE: 'Osservatori' };
export const descriviEvento = (e) => {
  const d = e.dati || {};
  switch (e.tipo) {
    case 'APERTO': return `Aperto con priorità ${d.priorita} verso ${d.unit || ''}${d.riservato ? ' (riservato)' : ''}`;
    case 'PRESO_IN_CARICO': return 'Preso in carico';
    case 'ASSEGNATO': return `Assegnato a ${d.a || ''}`;
    case 'GIRATO': return `Girato da ${d.da || ''} a ${d.a || ''}: ${d.motivo || ''}`;
    case 'STATO': return `Da ${STATO_LABEL[d.da] || d.da} a ${STATO_LABEL[d.a] || d.a}${d.intervallo_attesa ? ` (attesa ${Math.round(d.intervallo_attesa.secondi / 60)} min, scadenza spostata)` : ''}${d.messaggio ? `: ${d.messaggio}` : ''}`;
    case 'PRIORITA': return `Priorità da ${d.da} a ${d.a}${d.motivo ? `: ${d.motivo}` : ''}`;
    case 'COMMENTO': return `Commento: ${d.anteprima || ''}`;
    case 'NOTA': return `Nota interna: ${d.anteprima || ''}`;
    case 'ALLEGATO': return `Allegato ${d.filename || ''}`;
    case 'ESCALATION': return `Escalation a ${d.a_unit || ''}: ${d.motivo || ''}`;
    case 'RIAPERTO': return `Riaperto (${d.riaperture}): ${d.motivo || ''}`;
    case 'CHIUSO': return d.automatico ? `Chiuso automaticamente dopo ${d.giorni} giorni` : `Chiuso${d.da_richiedente ? ' dal richiedente' : ''}${d.nota ? `: ${d.nota}` : ''}`;
    case 'VALUTATO': return `Valutazione ${d.valutazione}/5${d.nota ? `: ${d.nota}` : ''}`;
    case 'LETTURA_RISERVATO': return 'Lettura del ticket riservato';
    case 'ANNULLATO': return `Annullato${d.motivo ? `: ${d.motivo}` : ''}`;
    case 'MODIFICA': return 'Titolo o descrizione modificati dal richiedente';
    case 'OSSERVATORE': return d.aggiunto ? `Aggiunto osservatore ${d.aggiunto}` : 'Rimosso un osservatore';
    default: return EVENTO[e.tipo] || e.tipo;
  }
};

// ------------------------------------------------------------------ XLSX
export async function ticketsXlsx(rows, stats, { titolo = 'Ticket' } = {}) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD';
  const ws = wb.addWorksheet('Ticket');
  ws.columns = [
    { header: 'Protocollo', key: 'protocollo', width: 14 }, { header: 'Titolo', key: 'titolo', width: 40 }, { header: 'Descrizione', key: 'descrizione', width: 50 }, { header: 'Categoria', key: 'categoria_nome', width: 24 },
    { header: 'Priorità', key: 'priorita', width: 10 }, { header: 'Stato', key: 'stato', width: 12 }, { header: 'Riservato', key: 'riservato', width: 10 }, { header: 'Richiedente', key: 'richiedente_nome', width: 26 },
    { header: 'Per conto di', key: 'per_conto', width: 30 }, { header: 'Casella', key: 'unit_nome', width: 26 }, { header: 'Percorso casella', key: 'unit_path', width: 50 }, { header: 'Assegnatario', key: 'assegnatario_nome', width: 26 },
    { header: 'Aperto il', key: 'created_at', width: 17 }, { header: 'Prima risposta', key: 'prima_risposta_at', width: 17 }, { header: 'Scadenza risposta', key: 'sla_risposta_scadenza', width: 17 }, { header: 'Risposta nei tempi', key: 'risp_ok', width: 12 },
    { header: 'Risolto il', key: 'risolto_at', width: 17 }, { header: 'Scadenza risoluzione', key: 'sla_risoluzione_scadenza', width: 17 }, { header: 'Risoluzione nei tempi', key: 'ris_ok', width: 12 }, { header: 'Ore attesa', key: 'ore_attesa', width: 10 },
    { header: 'Ore risoluzione', key: 'ore_ris', width: 12 }, { header: 'Chiuso il', key: 'chiuso_at', width: 17 }, { header: 'Escalation', key: 'escalation_unit_nome', width: 24 }, { header: 'Riaperture', key: 'riaperture', width: 10 },
    { header: 'Valutazione', key: 'valutazione', width: 11 }, { header: 'Commenti', key: 'n_commenti', width: 10 }, { header: 'Allegati', key: 'n_allegati', width: 10 },
  ];
  for (const t of rows) {
    ws.addRow({ ...t, descrizione: t.riservato ? '(riservato)' : t.descrizione, stato: STATO_LABEL[t.stato] || t.stato, riservato: t.riservato ? 'Sì' : 'No', created_at: dt(t.created_at), prima_risposta_at: dt(t.prima_risposta_at), sla_risposta_scadenza: dt(t.sla_risposta_scadenza),
      risp_ok: t.prima_risposta_at ? (new Date(t.prima_risposta_at) <= new Date(t.sla_risposta_scadenza) ? 'Sì' : 'No') : '', risolto_at: dt(t.risolto_at), sla_risoluzione_scadenza: dt(t.sla_risoluzione_scadenza),
      ris_ok: t.risolto_at || t.stato === 'CHIUSO' ? (t.sla_risoluzione_sforato ? 'No' : 'Sì') : '', ore_attesa: Math.round((t.attesa_secondi || 0) / 360) / 10, ore_ris: ore(t.created_at, t.risolto_at, t.attesa_secondi), chiuso_at: dt(t.chiuso_at) });
  }
  const head = (w) => { w.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; w.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; w.views = [{ state: 'frozen', ySplit: 1 }]; };
  head(ws); ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

  const st = wb.addWorksheet('Statistiche');
  st.getColumn(1).width = 42; st.getColumn(2).width = 16; st.getColumn(3).width = 16; st.getColumn(4).width = 16;
  const sec = (t) => { const r = st.addRow([t]); r.font = { bold: true, color: { argb: 'FF1C505E' }, size: 12 }; };
  st.addRow([`${titolo} · statistiche`, `generato il ${dd(new Date())}`]).font = { bold: true };
  st.addRow([]);
  sec('Totali'); st.addRow(['Ticket', stats.totale]); st.addRow(['Aperti', stats.aperti]);
  for (const [k, v] of Object.entries(stats.stati)) st.addRow([STATO_LABEL[k] || k, v]);
  st.addRow([]); sec('Tempi medi (ore)'); st.addRow(['Prima risposta', stats.tempi.ore_prima_risposta ?? '']); st.addRow(['Risoluzione (al netto delle attese)', stats.tempi.ore_risoluzione ?? '']);
  st.addRow([]); sec('SLA'); st.addRow(['Prime risposte nei tempi', stats.sla.pct_risposta != null ? `${stats.sla.pct_risposta}%` : '', stats.sla.risposte_ok, stats.sla.risposte]); st.addRow(['Risoluzioni nei tempi', stats.sla.pct_risoluzione != null ? `${stats.sla.pct_risoluzione}%` : '', stats.sla.risoluzioni_ok, stats.sla.risoluzioni]); st.addRow(['In ritardo adesso', stats.sla.in_ritardo_ora]);
  st.addRow([]); sec('Backlog per età (giorni)'); for (const [k, v] of Object.entries(stats.backlog)) st.addRow([k, v]);
  st.addRow([]); sec('Per categoria'); st.addRow(['Categoria', 'Ticket', 'Aperti']); for (const c of stats.categorie) st.addRow([c.nome || 'Senza categoria', c.n, c.aperti]);
  st.addRow([]); sec('Per casella'); st.addRow(['Casella', 'Ticket', 'Aperti', 'Sforati']); for (const u of stats.unita) st.addRow([u.path || u.nome, u.n, u.aperti, u.sforati]);
  st.addRow([]); sec('Per struttura'); st.addRow(['Struttura', 'Tipo', 'Ticket', 'Aperti']); for (const s of stats.strutture) st.addRow([s.nome, s.tipo, s.n, s.aperti]);
  st.addRow([]); sec('Andamento ultimi 12 mesi'); st.addRow(['Mese', 'Aperti', 'Chiusi']); for (const m of stats.mesi) st.addRow([m.mese, m.aperti, m.chiusi]);
  st.addRow([]); sec('Valutazione'); st.addRow(['Media', stats.valutazione.media ?? '', 'su', stats.valutazione.n]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF comune
async function newDoc(title) {
  const co = await getCompany();
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: title, Author: co.legal_name, Creator: 'Suite TD' } });
  doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B);
  const W = doc.page ? doc.page.width : 595.28, H = 841.89, M = 40;
  let n = 0;
  const header = (sub) => {
    n++;
    doc.addPage();
    doc.rect(0, 0, W, 64).fill(C.jet);
    if (LOGO) { try { doc.image(LOGO, M, 14, { fit: [120, 36] }); } catch { /* */ } }
    doc.font('B').fontSize(14).fillColor(C.white).text(title, 180, 16, { width: W - 180 - M, lineBreak: false });
    doc.font('R').fontSize(8.5).fillColor('#B9CDD3').text(sub || '', 180, 38, { width: W - 180 - M, lineBreak: false });
    doc.font('R').fontSize(7).fillColor(C.grey).text(`Suite TD · Toscana Diagnostica · ${dd(new Date())} · pagina ${n}`, M, H - 26, { width: W - 2 * M, align: 'right', lineBreak: false });
    doc.y = 84;
  };
  const ensure = (h, sub) => { if (doc.y + h > H - 40) header(sub); };
  const h2 = (t, sub) => { ensure(30, sub); doc.font('B').fontSize(11.5).fillColor(C.teal).text(t, M, doc.y, { width: W - 2 * M }); doc.moveTo(M, doc.y + 2).lineTo(W - M, doc.y + 2).strokeColor(C.blue).lineWidth(1).stroke(); doc.y += 8; };
  const para = (t, opts = {}) => { ensure(14); doc.font(opts.bold ? 'B' : 'R').fontSize(opts.size || 9.5).fillColor(opts.color || C.ink).text(t, M, doc.y, { width: W - 2 * M, ...opts }); doc.y += 4; };
  // tabella semplice: cols = [{ label, width (0..1), align }], rows = array di array
  const table = (cols, rows, sub) => {
    const tw = W - 2 * M; const xs = []; let x = M;
    for (const c of cols) { xs.push(x); x += c.width * tw; }
    const rowH = (vals, font, size) => Math.max(...vals.map((v, i) => { doc.font(font).fontSize(size); return doc.heightOfString(String(v ?? ''), { width: cols[i].width * tw - 8 }); })) + 7;
    const drawRow = (vals, { head = false, alt = false } = {}) => {
      const h = rowH(vals, head ? 'B' : 'R', head ? 8.2 : 8.6);
      ensure(h + 2, sub);
      const y0 = doc.y;   // pdfkit sposta doc.y dopo ogni text(): le celle partono tutte dalla stessa riga
      if (head) doc.rect(M, y0, tw, h).fill(C.teal); else if (alt) doc.rect(M, y0, tw, h).fill(C.bg);
      vals.forEach((v, i) => doc.font(head ? 'B' : 'R').fontSize(head ? 8.2 : 8.6).fillColor(head ? C.white : C.ink).text(String(v ?? ''), xs[i] + 4, y0 + 3.5, { width: cols[i].width * tw - 8, align: cols[i].align || 'left' }));
      doc.y = y0 + h;
      if (!head) { doc.moveTo(M, doc.y).lineTo(W - M, doc.y).strokeColor(C.line).lineWidth(0.4).stroke(); }
    };
    drawRow(cols.map((c) => c.label), { head: true });
    if (!rows.length) drawRow(cols.map((_, i) => (i === 0 ? 'Nessun dato' : '')));
    rows.forEach((r, i) => drawRow(r, { alt: i % 2 === 1 }));
    doc.y += 8;
  };
  const kpis = (items) => {
    const tw = W - 2 * M; const per = Math.min(items.length, 4); const bw = (tw - (per - 1) * 8) / per; const bh = 46;
    const rowsN = Math.ceil(items.length / per);
    ensure(rowsN * (bh + 8));
    const y0 = doc.y;
    items.forEach((k, i) => {
      const x = M + (i % per) * (bw + 8), y = y0 + Math.floor(i / per) * (bh + 8);
      doc.roundedRect(x, y, bw, bh, 6).fillAndStroke(C.bg, C.line);
      doc.font('R').fontSize(7.5).fillColor(C.grey).text(k.label.toUpperCase(), x + 8, y + 7, { width: bw - 16, lineBreak: false });
      doc.font('B').fontSize(15).fillColor(k.color || C.ink).text(String(k.value ?? '-'), x + 8, y + 19, { width: bw - 16, lineBreak: false });
      if (k.foot) doc.font('R').fontSize(7).fillColor(C.grey).text(k.foot, x + 8, y + 36, { width: bw - 16, lineBreak: false });
    });
    doc.y = y0 + rowsN * (bh + 8) + 4;
  };
  return { doc, header, h2, para, table, kpis, W, M, ensure };
}
const finish = (doc) => new Promise((resolve, reject) => { const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); doc.end(); });

// ------------------------------------------------------------------ Scheda PDF del ticket
export async function schedaPdf(t, { commenti = [], eventi = [], allegati = [], osservatori = [], responsabili = [] }) {
  const { doc, header, h2, para, table, kpis } = await newDoc(`Ticket ${t.protocollo}`);
  const sub = `${t.riservato ? 'RISERVATO · ' : ''}${t.categoria_nome || ''} · ${PRIO[t.priorita]} · ${STATO_LABEL[t.stato]}`;
  header(sub);
  para(t.titolo, { bold: true, size: 14 });
  kpis([
    { label: 'Stato', value: STATO_LABEL[t.stato] }, { label: 'Priorità', value: PRIO[t.priorita] },
    { label: 'Scadenza risposta', value: dt(t.sla_risposta_scadenza), foot: t.prima_risposta_at ? `risposta ${dt(t.prima_risposta_at)}` : 'nessuna risposta', color: t.sla_risposta_sforato ? C.red : C.ink },
    { label: 'Scadenza risoluzione', value: dt(t.sla_risoluzione_scadenza), foot: t.risolto_at ? `risolto ${dt(t.risolto_at)}` : `attesa ${Math.round((t.attesa_secondi || 0) / 60)} min`, color: t.sla_risoluzione_sforato ? C.red : C.ink },
  ]);
  h2('Scheda');
  table([{ label: 'Campo', width: 0.28 }, { label: 'Valore', width: 0.72 }], [
    ['Protocollo', t.protocollo], ['Richiedente', t.richiedente_nome || ''], ['Per conto di', t.per_conto || 'Non indicato'], ['Categoria', t.categoria_nome || ''],
    ['Casella destinataria', t.unit_path || t.unit_nome], ['Responsabili della casella', responsabili.map((r) => r.nome).join(', ') || 'Da assegnare'], ['Assegnatario', t.assegnatario_nome || 'Nessuno'],
    ['Escalation', t.escalation_unit_nome ? `${t.escalation_unit_nome} (${dt(t.escalated_at)})` : 'No'], ['Aperto il', dt(t.created_at)], ['Chiuso il', dt(t.chiuso_at) || ''], ['Riaperture', String(t.riaperture || 0)],
    ['Valutazione', t.valutazione ? `${t.valutazione}/5${t.valutazione_nota ? ` · ${t.valutazione_nota}` : ''}` : ''], ['Osservatori', osservatori.map((o) => o.full_name).join(', ') || 'Nessuno'],
  ], sub);
  h2('Descrizione');
  para(t.descrizione || '');
  if (t.messaggio_risoluzione) { h2('Messaggio di risoluzione'); para(t.messaggio_risoluzione); }
  h2('Commenti');
  table([{ label: 'Quando', width: 0.17 }, { label: 'Autore', width: 0.23 }, { label: 'Testo', width: 0.6 }], commenti.map((c) => [dt(c.created_at), `${c.autore_nome || ''}${c.interno ? ' (nota interna)' : ''}`, c.testo]), sub);
  h2('Allegati');
  table([{ label: 'File', width: 0.5 }, { label: 'Tipo', width: 0.25 }, { label: 'KB', width: 0.1, align: 'right' }, { label: 'Caricato il', width: 0.15 }], allegati.map((a) => [a.filename, a.mime, Math.round(a.size / 1024), dd(a.created_at)]), sub);
  h2('Cronologia');
  table([{ label: 'Quando', width: 0.17 }, { label: 'Chi', width: 0.22 }, { label: 'Evento', width: 0.16 }, { label: 'Dettaglio', width: 0.45 }], eventi.map((e) => [dt(e.created_at), e.user_nome || 'Sistema', EVENTO[e.tipo] || e.tipo, descriviEvento(e)]), sub);
  return finish(doc);
}

// ------------------------------------------------------------------ Rapporto PDF di periodo (una pagina per sezione)
export async function rapportoPdf(stats, { da, a, unitName } = {}) {
  const periodo = `${da ? `dal ${dd(da)}` : 'dall\'inizio'} ${a ? `al ${dd(a)}` : 'a oggi'}${unitName ? ` · ${unitName}` : ''}`;
  const { doc, header, h2, para, table, kpis } = await newDoc('Rapporto ticket');
  const pct = (v) => (v == null ? '-' : `${v}%`);
  header(`Periodo ${periodo}`);
  h2('Quadro generale');
  kpis([
    { label: 'Ticket nel periodo', value: stats.totale }, { label: 'Aperti', value: stats.aperti }, { label: 'Risolti', value: stats.stati.RISOLTO || 0 }, { label: 'Chiusi', value: stats.stati.CHIUSO || 0 },
    { label: 'Prima risposta media', value: stats.tempi.ore_prima_risposta != null ? `${stats.tempi.ore_prima_risposta} h` : '-' }, { label: 'Risoluzione media', value: stats.tempi.ore_risoluzione != null ? `${stats.tempi.ore_risoluzione} h` : '-', foot: 'al netto delle attese' },
    { label: 'SLA risposta', value: pct(stats.sla.pct_risposta), foot: `${stats.sla.risposte_ok || 0} su ${stats.sla.risposte || 0}`, color: stats.sla.pct_risposta != null && stats.sla.pct_risposta < 80 ? C.red : C.green },
    { label: 'SLA risoluzione', value: pct(stats.sla.pct_risoluzione), foot: `${stats.sla.risoluzioni_ok || 0} su ${stats.sla.risoluzioni || 0}`, color: stats.sla.pct_risoluzione != null && stats.sla.pct_risoluzione < 80 ? C.red : C.green },
  ]);
  table([{ label: 'Stato', width: 0.6 }, { label: 'Ticket', width: 0.4, align: 'right' }], Object.entries(stats.stati).map(([k, v]) => [STATO_LABEL[k] || k, v]));
  table([{ label: 'Priorità', width: 0.4 }, { label: 'Ticket', width: 0.3, align: 'right' }, { label: 'Aperti', width: 0.3, align: 'right' }], stats.priorita.map((p) => [PRIO[p.priorita] || p.priorita, p.n, p.aperti]));
  para(`Valutazione media del richiedente: ${stats.valutazione.media != null ? `${stats.valutazione.media}/5 su ${stats.valutazione.n} ticket valutati` : 'nessuna valutazione nel periodo'}. In ritardo adesso: ${stats.sla.in_ritardo_ora || 0} ticket.`);

  header(`Per categoria · ${periodo}`);
  h2('Ticket per categoria');
  table([{ label: 'Categoria', width: 0.6 }, { label: 'Ticket', width: 0.2, align: 'right' }, { label: 'Aperti', width: 0.2, align: 'right' }], stats.categorie.map((c) => [c.nome || 'Senza categoria', c.n, c.aperti]));

  header(`Per casella · ${periodo}`);
  h2('Ticket per casella dell\'organigramma');
  table([{ label: 'Casella', width: 0.55 }, { label: 'Ticket', width: 0.11, align: 'right' }, { label: 'Aperti', width: 0.11, align: 'right' }, { label: 'Sforati', width: 0.11, align: 'right' }, { label: 'Ore medie', width: 0.12, align: 'right' }], stats.unita.map((u) => [u.path || u.nome, u.n, u.aperti, u.sforati, u.ore_medie_risoluzione ?? '']));
  h2('Prime cinque caselle per carico aperto');
  table([{ label: 'Casella', width: 0.8 }, { label: 'Aperti', width: 0.2, align: 'right' }], stats.top5.map((u) => [u.path || u.nome, u.n]));

  header(`Per struttura · ${periodo}`);
  h2('Ticket per sede o Legal entity ("per conto di")');
  table([{ label: 'Struttura', width: 0.55 }, { label: 'Tipo', width: 0.2 }, { label: 'Ticket', width: 0.125, align: 'right' }, { label: 'Aperti', width: 0.125, align: 'right' }], stats.strutture.map((s) => [s.nome, s.tipo, s.n, s.aperti]));

  header(`Andamento e backlog · ${periodo}`);
  h2('Andamento ultimi 12 mesi');
  table([{ label: 'Mese', width: 0.4 }, { label: 'Aperti', width: 0.3, align: 'right' }, { label: 'Risolti o chiusi', width: 0.3, align: 'right' }], stats.mesi.map((m) => [m.mese, m.aperti, m.chiusi]));
  h2('Backlog aperto per età');
  table([{ label: 'Età (giorni)', width: 0.6 }, { label: 'Ticket aperti', width: 0.4, align: 'right' }], Object.entries(stats.backlog).map(([k, v]) => [k, v]));
  return finish(doc);
}
