// Gestione del Personale · simulazione dei cedolini del mese (v0.94.0, CEO 23/11/2026): per ogni dipendente in forza nel mese, il lordo
// del mese e la sua divisione fra NETTO IN BUSTA (da pagare ai dipendenti) e F24 (contributi INPS a carico del dipendente e dell'azienda,
// IRPEF trattenuta, addizionali regionale e comunale, al netto del trattamento integrativo anticipato in busta). Stesse aliquote e stessa
// stima del netto del Simulatore busta paga (lib/payroll.js netEstimate, Impostazioni del widget).
// È UNA STIMA per la pianificazione di cassa: non sostituisce l'elaborazione del consulente del lavoro. Non considera presenze, assenze,
// straordinari, premi e MBO, carichi familiari, conguagli, rateazione effettiva delle addizionali, sgravi contributivi, fondi dei dirigenti,
// TFR e INAIL (che non passano dall'F24 mensile). Ipotesi dichiarate: tredicesima a dicembre, quattordicesima a giugno; chi entra o esce
// nel mese è contato in proporzione ai giorni di calendario; RAL vigente a fine mese (scatti programmati compresi).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { many } from '../db.js';
import { getSettings, netEstimate, ralAt } from './payroll.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseEsteso = (m) => `${MESI[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const meseCorrente = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7);
const CONTRATTO = { TIND: 'Tempo indeterminato', TDET: 'Tempo determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente' };
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/** Estremi del mese "AAAA-MM": primo e ultimo giorno, numero di giorni. */
export function estremiMese(mese) {
  const [y, m] = mese.split('-').map(Number);
  const giorni = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { primo: `${mese}-01`, ultimo: `${mese}-${String(giorni).padStart(2, '0')}`, giorni, numero: m };
}

/**
 * Cedolino simulato di un dipendente per il mese. e = { ral, ral_steps, monthly_payments, contract_type, inizio, fine } (date ISO o null).
 * Ritorna null se nel mese non è in forza. Funzione pura.
 */
export function simulaCedolino(e, settings, mese) {
  const M = estremiMese(mese);
  const dal = e.inizio && e.inizio > M.primo ? e.inizio : M.primo;
  const al = e.fine && e.fine < M.ultimo ? e.fine : M.ultimo;
  if (dal > al) return null;
  const giorni = Math.round((Date.parse(`${al}T12:00:00Z`) - Date.parse(`${dal}T12:00:00Z`)) / 86400000) + 1;
  const quotaGiorni = giorni / M.giorni;
  const ral = ralAt(e, M.ultimo);
  const mensilita = Number(e.monthly_payments) || (e.contract_type === 'DIRIGENTE' ? 13 : 14);
  const quota = ral / mensilita;
  // mensilità aggiuntive: tredicesima a dicembre, quattordicesima a giugno (ipotesi)
  const aggiuntive = (M.numero === 12 && mensilita >= 13 ? 1 : 0) + (M.numero === 6 && mensilita >= 14 ? 1 : 0);
  const lordo = r2(quota * quotaGiorni + quota * aggiuntive);
  const N = netEstimate(ral, settings, mensilita);
  const k = ral > 0 ? lordo / ral : 0;                                   // quota dell'anno che cade nel mese
  const inpsDip = r2(lordo * Number(settings.employee_inps_pct || 9.19) / 100);
  const irpef = r2(N.irpef * k);
  const addizionali = r2((N.add_regional + N.add_municipal) * k);
  const integrativo = r2(N.bonus * k);
  const netto = r2(lordo - inpsDip - irpef - addizionali + integrativo);
  const pctAz = e.contract_type === 'APPRENDISTATO' ? Number(settings.cost_apprentice_inps_pct || 11.61) : Number(settings.cost_inps_pct || 29);
  const inpsAz = r2(lordo * pctAz / 100);
  const f24 = r2(inpsDip + inpsAz + irpef + addizionali - integrativo);
  return { ral: r2(ral), mensilita, giorni, giorni_mese: M.giorni, parziale: giorni < M.giorni, mensilita_aggiuntive: aggiuntive, lordo, inps_dipendente: inpsDip, irpef, addizionali, integrativo,
    netto, inps_azienda: inpsAz, inps_azienda_pct: pctAz, f24, totale: r2(netto + f24) };
}

const somma = (righe, k) => r2(righe.reduce((s, x) => s + (Number(x[k]) || 0), 0));

/** Simulazione dei cedolini del mese per tutti i dipendenti in forza (anche solo per una parte del mese). */
export async function simulazioneCedolini(mese = meseCorrente()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mese)) throw Object.assign(new Error('Mese non valido (AAAA-MM)'), { status: 400 });
  const S = await getSettings();
  const M = estremiMese(mese);
  // dipendenti con contratto, non in fase "Lettera di impegno", in forza almeno un giorno del mese
  const rows = await many(`SELECT r.id, r.last_name, r.first_name, r.status, r.hired_at, r.terminated_at, e.contract_type, e.level, e.job_title, e.ral, e.ral_steps, e.monthly_payments, e.start_date, e.end_date, e.weekly_hours
      FROM resources_v r JOIN employments e ON e.resource_id = r.id
     WHERE r.kind = 'DIPENDENTE' AND r.status IN ('ATTIVO','CESSATO') AND r.in_hr
       AND coalesce(e.start_date, r.hired_at, $1::date) <= $2::date AND coalesce(r.terminated_at, e.end_date, $2::date) >= $1::date
     ORDER BY r.last_name, r.first_name`, [M.primo, M.ultimo]);
  const righe = []; const senzaRal = [];
  for (const x of rows) {
    const e = { ...x, ral: Number(x.ral), ral_steps: x.ral_steps || [], inizio: iso(x.start_date || x.hired_at), fine: iso(x.terminated_at || x.end_date) };
    const c = simulaCedolino(e, S, mese);
    if (!c) continue;
    if (!(c.ral > 0)) { senzaRal.push(`${x.last_name} ${x.first_name}`); continue; }
    righe.push({ id: x.id, nome: `${x.last_name} ${x.first_name}`, contratto: CONTRATTO[x.contract_type] || x.contract_type, contract_type: x.contract_type, livello: x.level || null, mansione: x.job_title || null,
      ore_settimanali: x.weekly_hours != null ? Number(x.weekly_hours) : null, dal: e.inizio && e.inizio > M.primo ? e.inizio : null, al: e.fine && e.fine < M.ultimo ? e.fine : null, ...c });
  }
  const tot = Object.fromEntries(['lordo', 'inps_dipendente', 'irpef', 'addizionali', 'integrativo', 'netto', 'inps_azienda', 'f24', 'totale'].map((k) => [k, somma(righe, k)]));
  // l'F24 dei contributi e delle ritenute del mese si versa entro il 16 del mese successivo
  const [y, m] = mese.split('-').map(Number); const succ = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { mese, mese_label: meseEsteso(mese), dipendenti: righe.length, righe, totali: tot, f24_scadenza: `${succ}-16`, senza_ral: senzaRal,
    ipotesi: { inps_dipendente_pct: Number(S.employee_inps_pct || 9.19), inps_azienda_pct: Number(S.cost_inps_pct || 29), inps_apprendisti_pct: Number(S.cost_apprentice_inps_pct || 11.61),
      addizionale_regionale_pct: Number(S.addizionale_regionale_pct || 1.42), addizionale_comunale_pct: Number(S.addizionale_comunale_pct || 0.3) },
    note: NOTE };
}

export const NOTE = [
  'Stima per la pianificazione di cassa: non sostituisce l\'elaborazione dei cedolini del consulente del lavoro.',
  'Netto in busta = lordo del mese meno contributi INPS a carico del dipendente, IRPEF e addizionali, più l\'eventuale trattamento integrativo.',
  'F24 = contributi INPS a carico del dipendente e dell\'azienda, IRPEF trattenuta, addizionali regionale e comunale, meno il trattamento integrativo anticipato in busta (credito in compensazione).',
  'Non sono considerati: presenze, assenze, straordinari, premi e MBO, carichi familiari e altre detrazioni, conguagli, rateazione effettiva delle addizionali, sgravi contributivi, fondi dei dirigenti, TFR e INAIL.',
  'Ipotesi: RAL vigente a fine mese divisa per le mensilità; tredicesima a dicembre e quattordicesima a giugno; ingressi e uscite nel mese in proporzione ai giorni di calendario.',
];

const eur = '#,##0.00';
export async function xlsxCedolini(d) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD · Gestione del Personale';
  const ws = wb.addWorksheet(`Cedolini ${d.mese}`, { views: [{ state: 'frozen', ySplit: 6 }] });
  const COL = [['Dipendente', 30, 'nome'], ['Contratto', 20, 'contratto'], ['Livello', 9, 'livello'], ['RAL', 13, 'ral'], ['Mensilità', 10, 'mensilita'], ['Giorni nel mese', 11, (r) => (r.parziale ? `${r.giorni} su ${r.giorni_mese}` : 'intero')],
    ['Lordo del mese', 15, 'lordo'], ['INPS a carico dipendente', 15, 'inps_dipendente'], ['IRPEF', 13, 'irpef'], ['Addizionali', 13, 'addizionali'], ['Trattamento integrativo', 14, 'integrativo'],
    ['NETTO IN BUSTA', 16, 'netto'], ['INPS a carico azienda', 15, 'inps_azienda'], ['F24', 16, 'f24'], ['Totale da pagare', 16, 'totale']];
  ws.columns = COL.map(([, w]) => ({ width: w }));
  ws.getCell('A1').value = `Simulazione dei cedolini di ${d.mese_label}`; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1C505E' } };
  ws.getCell('A2').value = `Toscana Diagnostica S.r.l. · ${d.dipendenti} dipendenti · stima del ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} · non sostituisce l'elaborazione del consulente del lavoro`;
  ws.getCell('A3').value = 'Netti in busta da pagare'; ws.getCell('D3').value = d.totali.netto;
  ws.getCell('A4').value = `F24 (entro il ${d.f24_scadenza.split('-').reverse().join('/')})`; ws.getCell('D4').value = d.totali.f24;
  ws.getCell('F3').value = 'Totale da pagare'; ws.getCell('H3').value = d.totali.totale;
  for (const c of ['A3', 'A4', 'F3', 'D3', 'D4', 'H3']) ws.getCell(c).font = { bold: true };
  for (const c of ['D3', 'D4', 'H3']) ws.getCell(c).numFmt = eur;
  const h = ws.getRow(6); COL.forEach(([t], i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  h.height = 32;
  const val = (r, k) => (typeof k === 'function' ? k(r) : r[k]);
  for (const r of d.righe) { const row = ws.addRow(COL.map(([, , k]) => val(r, k))); [4, 7, 8, 9, 10, 11, 12, 13, 14, 15].forEach((i) => { row.getCell(i).numFmt = eur; }); [12, 14].forEach((i) => { row.getCell(i).font = { bold: true }; }); }
  const t = ws.addRow(['Totale', '', '', '', '', '', d.totali.lordo, d.totali.inps_dipendente, d.totali.irpef, d.totali.addizionali, d.totali.integrativo, d.totali.netto, d.totali.inps_azienda, d.totali.f24, d.totali.totale]);
  t.font = { bold: true }; [7, 8, 9, 10, 11, 12, 13, 14, 15].forEach((i) => { t.getCell(i).numFmt = eur; t.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4F5' } }; });
  ws.addRow([]);
  for (const n of d.note) ws.addRow([n]);
  ws.addRow([`Aliquote usate (Impostazioni del widget): INPS dipendente ${d.ipotesi.inps_dipendente_pct}%, INPS azienda ${d.ipotesi.inps_azienda_pct}% (apprendisti ${d.ipotesi.inps_apprendisti_pct}%), addizionale regionale ${d.ipotesi.addizionale_regionale_pct}%, comunale ${d.ipotesi.addizionale_comunale_pct}%.`]);
  if (d.senza_ral.length) ws.addRow([`Esclusi perché senza RAL in scheda: ${d.senza_ral.join(', ')}.`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'orders', 'assets');
const C = { teal: '#1C505E', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', light: '#EEF4F5' };
const fmt = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const CONTRATTO_BREVE = { TIND: 'Indeterminato', TDET: 'Determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente' };

export function pdfCedolini(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 40, left: 36, right: 36 }, info: { Title: `Simulazione dei cedolini di ${d.mese_label}`, Author: 'Toscana Diagnostica' } });
    const pezzi = []; doc.on('data', (b) => pezzi.push(b)); doc.on('end', () => resolve(Buffer.concat(pezzi))); doc.on('error', reject);
    try { doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf')); doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf')); }
    catch { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
    const L = doc.page.margins.left; const W = doc.page.width - L - doc.page.margins.right; const FONDO = doc.page.height - doc.page.margins.bottom;
    const COL = [['Dipendente', 0.195, 'l'], ['Contratto', 0.125, 'l'], ['RAL', 0.075], ['Lordo mese', 0.075], ['INPS dip.', 0.065], ['IRPEF', 0.065], ['Addiz.', 0.055], ['Netto in busta', 0.095], ['INPS azienda', 0.075], ['F24', 0.085], ['Totale', 0.09]].map(([t, w, a]) => ({ t, w: w * W, a: a || 'r' }));
    const testa = (prima) => {
      doc.rect(0, 0, doc.page.width, 4).fill(C.teal);
      let y = doc.page.margins.top;
      if (prima) {
        doc.font('B').fontSize(15).fillColor(C.teal).text(`Simulazione dei cedolini di ${d.mese_label}`, L, y); y += 20;
        doc.font('R').fontSize(8.5).fillColor(C.grey).text(`Toscana Diagnostica S.r.l. · ${d.dipendenti} dipendenti in forza nel mese · stima del ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} · non sostituisce l'elaborazione del consulente del lavoro`, L, y); y += 18;
        const box = [['Netti in busta da pagare', d.totali.netto, 'ai dipendenti'], ['F24', d.totali.f24, `entro il ${d.f24_scadenza.split('-').reverse().join('/')}`], ['Totale da pagare', d.totali.totale, 'netti + F24']];
        const bw = (W - 20) / 3;
        box.forEach(([t, v, s], i) => { const x = L + i * (bw + 10); doc.roundedRect(x, y, bw, 50, 4).fill(i === 2 ? C.teal : C.light);
          doc.font('R').fontSize(8).fillColor(i === 2 ? '#FFFFFF' : C.grey).text(t.toUpperCase(), x + 10, y + 7); doc.font('B').fontSize(15).fillColor(i === 2 ? '#FFFFFF' : C.jet).text(`€ ${fmt(v)}`, x + 10, y + 18);
          doc.font('R').fontSize(7.5).fillColor(i === 2 ? '#FFFFFF' : C.grey).text(s, x + 10, y + 36); });
        y += 62;
      }
      doc.rect(L, y, W, 18).fill(C.teal); let x = L;
      for (const c of COL) { doc.font('B').fontSize(7.5).fillColor('#FFFFFF').text(c.t, x + 4, y + 5.5, { width: c.w - 8, align: c.a === 'l' ? 'left' : 'right', lineBreak: false }); x += c.w; }
      return y + 18;
    };
    const riga = (y, celle, { bold = false, fill = null } = {}) => {
      if (fill) doc.rect(L, y, W, 15).fill(fill);
      let x = L;
      celle.forEach((v, i) => { const c = COL[i]; doc.font(bold || i === 7 || i === 9 ? 'B' : 'R').fontSize(8).fillColor(C.jet).text(String(v ?? ''), x + 4, y + 4, { width: c.w - 8, align: c.a === 'l' ? 'left' : 'right', lineBreak: false, ellipsis: true }); x += c.w; });
      doc.moveTo(L, y + 15).lineTo(L + W, y + 15).lineWidth(0.4).strokeColor(C.line).stroke();
      return y + 15;
    };
    let y = testa(true);
    d.righe.forEach((r, i) => {
      if (y + 15 > FONDO - 10) { doc.addPage(); y = testa(false); }
      y = riga(y, [`${r.nome}${r.parziale ? ` (${r.giorni} gg su ${r.giorni_mese})` : ''}`, `${CONTRATTO_BREVE[r.contract_type] || r.contratto}${r.livello ? ` · liv. ${r.livello}` : ''}`, fmt(r.ral), fmt(r.lordo), fmt(r.inps_dipendente), fmt(r.irpef), fmt(r.addizionali), fmt(r.netto), fmt(r.inps_azienda), fmt(r.f24), fmt(r.totale)], { fill: i % 2 ? '#F7FAFA' : null });
    });
    if (y + 15 > FONDO - 10) { doc.addPage(); y = testa(false); }
    y = riga(y, ['Totale', '', '', fmt(d.totali.lordo), fmt(d.totali.inps_dipendente), fmt(d.totali.irpef), fmt(d.totali.addizionali), fmt(d.totali.netto), fmt(d.totali.inps_azienda), fmt(d.totali.f24), fmt(d.totali.totale)], { bold: true, fill: C.light });
    y += 10;
    const note = [...d.note, `Aliquote usate (Impostazioni del widget): INPS dipendente ${d.ipotesi.inps_dipendente_pct}%, INPS azienda ${d.ipotesi.inps_azienda_pct}% (apprendisti ${d.ipotesi.inps_apprendisti_pct}%), addizionale regionale ${d.ipotesi.addizionale_regionale_pct}%, comunale ${d.ipotesi.addizionale_comunale_pct}%.`,
      ...(d.totali.integrativo ? [`Trattamento integrativo anticipato in busta nel mese: € ${fmt(d.totali.integrativo)} (già dentro i netti e sottratto dall'F24).`] : []),
      ...(d.senza_ral.length ? [`Esclusi perché senza RAL in scheda: ${d.senza_ral.join(', ')}.`] : [])];
    doc.font('R').fontSize(7.5);
    const alto = note.reduce((s, n) => s + doc.heightOfString(`• ${n}`, { width: W }) + 2, 0);
    if (y + alto > FONDO) { doc.addPage(); doc.rect(0, 0, doc.page.width, 4).fill(C.teal); y = doc.page.margins.top; }
    for (const n of note) { doc.font('R').fontSize(7.5).fillColor(C.grey).text(`• ${n}`, L, y, { width: W }); y = doc.y + 2; }
    doc.end();
  });
}
