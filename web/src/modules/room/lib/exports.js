// Esportazioni PDF/XLSX di rete: agenda dello specialista, proposta di collaborazione, calendario reale, report direzione
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { TD_LOGO, durTxt } from '../planner/planner.jsx';
import { DAYS, DAYS_S, m2t, itDate } from './network.js';

const P = [28, 80, 94], INK = [1, 33, 44];
export function mkDoc(title, sub) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFillColor(...P); doc.rect(0, 0, 297, 4, 'F');
  try { doc.addImage(TD_LOGO, 'PNG', 12, 9, 44, 10, undefined, 'FAST'); } catch { /* logo assente */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...P); doc.text(title, 62, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80, 90, 95); doc.text(`${sub || ''}   ·   Room Planning · generato il ${new Date().toLocaleString('it-IT')}`, 62, 20);
  return doc;
}
export const table = (doc, head, body, startY, extra = {}) => { autoTable(doc, { head: [head], body, startY, styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: P, fontSize: 8 }, margin: { left: 12, right: 12 }, ...extra }); return doc.lastAutoTable.finalY; };
export const section = (doc, text, y) => { if (y > 180) { doc.addPage(); y = 14; } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...P); doc.text(text, 12, y); return y + 3; };
export const pdfBase64 = (doc) => doc.output('datauristring').split(',')[1];
const safe = (s) => String(s || '').replace(/[^\w]+/g, '_');

export function pdfAgendaSpecialista(x) {
  const doc = mkDoc(`Agenda settimanale · ${x.nome}`, `${x.discipline.join(', ') || x.profili.join(', ')} · ${x.nSedi} sedi · ${durTxt(x.ore)}/settimana`);
  const rows = x.sessioni.filter((q) => q.room).map((q) => [DAYS[q.d], `${m2t(q.s)}–${m2t(q.e)}`, q.sede, q.room, q.ruolo === 'titolare' ? (q.disciplina || '') : q.ruolo, q.slots != null ? String(q.slots) : '', q.note || '']);
  let y = table(doc, ['Giorno', 'Orario', 'Sede', 'Ambulatorio', 'Attività', 'Slot', 'Note'], rows.length ? rows : [['—', '', 'Nessuna sessione pianificata', '', '', '', '']], 28);
  const un = x.sessioni.filter((q) => !q.room);
  if (un.length) { y = section(doc, 'Disponibilità non allocate', y + 8); table(doc, ['Giorno', 'Orario', 'Sede', 'Motivo'], un.map((q) => [DAYS[q.d], `${m2t(q.s)}–${m2t(q.e)}`, q.sede, q.reason || '']), y); }
  return { doc, filename: `Agenda_${safe(x.nome)}.pdf` };
}

export function pdfProposta(x, sim, windows, intro) {
  const doc = mkDoc(`Proposta di collaborazione · ${x.nome}`, `${x.discipline.join(', ') || x.profili.join(', ')} · spazi disponibili nelle sedi del network`);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(intro, 270); doc.text(lines, 12, 30);
  let y = 30 + lines.length * 4.5 + 4;
  y = section(doc, 'Disponibilità comunicate', y);
  const w = Object.entries(windows).filter(([, v]) => v && v.length).map(([d, v]) => [DAYS[d], v.map((r) => `${r.from}–${r.to}`).join(', ')]);
  y = table(doc, ['Giorno', 'Fasce'], w.length ? w : [['—', 'nessuna']], y) + 8;
  y = section(doc, `Spazi proponibili (${durTxt(sim.totale)} complessive)`, y);
  y = table(doc, ['Sede', 'Indirizzo', 'Giorno', 'Orario', 'Durata', 'Ambulatorio', 'Dedicato a', 'Attrezzature'], sim.proposte.map((p) => [p.sede, p.indirizzo || '', DAYS[p.d], `${m2t(p.s)}–${m2t(p.e)}`, durTxt(p.min), p.room, p.dedicato, p.attrezzature.join(', ')]), y) + 8;
  if (x.sessioni.some((q) => q.room)) { y = section(doc, 'Impegni già in calendario con noi', y); table(doc, ['Giorno', 'Orario', 'Sede', 'Ambulatorio'], x.sessioni.filter((q) => q.room).map((q) => [DAYS[q.d], `${m2t(q.s)}–${m2t(q.e)}`, q.sede, q.room]), y); }
  return { doc, filename: `Proposta_${safe(x.nome)}.pdf` };
}

export function pdfPianoDisponibilita(x, sim, intro) {
  const doc = mkDoc(`Piano delle disponibilità nelle nostre strutture · ${x.nome}`, `${x.discipline.join(', ') || x.profili.join(', ')} · impegni attuali e spazi liberi compatibili nelle sedi Toscana Diagnostica`);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(intro, 270); doc.text(lines, 12, 30);
  let y = 30 + lines.length * 4.5 + 4;
  y = section(doc, `Impegni già in calendario con noi (${durTxt(x.ore)}/settimana)`, y);
  const imp = x.sessioni.filter((q) => q.room).map((q) => [DAYS[q.d], `${m2t(q.s)}–${m2t(q.e)}`, q.sede, q.room, q.ruolo === 'titolare' ? (q.disciplina || '') : q.ruolo]);
  y = table(doc, ['Giorno', 'Orario', 'Sede', 'Ambulatorio', 'Attività'], imp.length ? imp : [['—', '', 'Nessuna sessione pianificata', '', '']], y) + 8;
  y = section(doc, `Disponibilità nelle nostre strutture (${durTxt(sim.totale)} complessive, fuori dai tuoi impegni)`, y);
  table(doc, ['Sede', 'Indirizzo', 'Giorno', 'Orario', 'Durata', 'Ambulatorio', 'Dedicato a', 'Attrezzature'], sim.proposte.length ? sim.proposte.map((p) => [p.sede, p.indirizzo || '', DAYS[p.d], `${m2t(p.s)}–${m2t(p.e)}`, durTxt(p.min), p.room, p.dedicato, p.attrezzature.join(', ')]) : [['—', '', '', 'Nessuno spazio libero compatibile', '', '', '', '']], y);
  return { doc, filename: `Piano_disponibilita_${safe(x.nome)}.pdf` };
}

export function pdfCalendario(week, label) {
  const doc = mkDoc(`Calendario · ${label}`, `settimana dal ${itDate(week.mondayISO)} al ${itDate(week.sundayISO)}`);
  let y = 28;
  const STATO = { ok: '', assente: 'ASSENTE', sostituita: 'sostituzione', extra: 'extra', chiusa: 'SEDE CHIUSA' };
  for (const g of week.giorni) {
    if (!g.sessioni.length && !g.chiusure.length) continue;
    y = section(doc, `${DAYS[g.d]} ${itDate(g.iso)}${g.chiusure.length ? ' · chiusure: ' + g.chiusure.map((c) => c.sede).join(', ') : ''}`, y + 6);
    y = table(doc, ['Sede', 'Ambulatorio', 'Orario', 'Medico', 'Disciplina', 'Supporto', 'Stato'], g.sessioni.map((q) => [q.sede, q.room, `${m2t(q.s)}–${m2t(q.e)}`, q.stato === 'sostituita' ? `${q.sostituto} (per ${q.nome})` : q.nome, q.disciplina, q.san || '', STATO[q.stato] + (q.evento?.nota ? ' · ' + q.evento.nota : '')]), y,
      { didParseCell: (h) => { if (h.section === 'body') { const st = g.sessioni[h.row.index]?.stato; if (st === 'assente' || st === 'chiusa') { h.cell.styles.textColor = [176, 58, 46]; } else if (st === 'sostituita' || st === 'extra') { h.cell.styles.textColor = [122, 78, 158]; } } } });
  }
  return { doc, filename: `Calendario_${safe(label)}_${week.mondayISO}.pdf` };
}

export function reportDirezione(net) {
  const rows = net.sedi.map(({ s, plan, label }) => {
    const alte = plan ? plan.crit.filter((c) => c.lv === 'alta') : [];
    const med = s.personale.filter((p) => p.tipo === 'medico' && p.nome.trim()).length;
    const free = plan ? plan.free.reduce((t, f) => t + (f.e - f.s), 0) : 0;
    const busy = plan ? Object.values(plan.roomStats).reduce((t, r) => t + r.busy, 0) : 0, avail = plan ? Object.values(plan.roomStats).reduce((t, r) => t + r.avail, 0) : 0;
    return { s, plan, label, alte, med, free, busy, avail, util: avail ? Math.round(100 * busy / avail) : 0, sess: plan ? plan.assigns.length : 0, slots: plan ? plan.assigns.reduce((t, a) => t + (a.slots || 0), 0) : 0 };
  });
  const tot = rows.reduce((t, r) => ({ amb: t.amb + r.s.ambulatori.length, med: t.med + r.med, sess: t.sess + r.sess, slots: t.slots + r.slots, free: t.free + r.free, busy: t.busy + r.busy, avail: t.avail + r.avail, alte: t.alte + r.alte.length }), { amb: 0, med: 0, sess: 0, slots: 0, free: 0, busy: 0, avail: 0, alte: 0 });
  return { rows, tot, util: tot.avail ? Math.round(100 * tot.busy / tot.avail) : 0 };
}
export function pdfReportDirezione(net) {
  const { rows, tot, util } = reportDirezione(net);
  const doc = mkDoc('Report consolidato del network', `${rows.length} sedi · ${tot.amb} ambulatori · ${tot.med} medici · utilizzo medio ${util}% · ${durTxt(tot.free)} libere/settimana`);
  let y = table(doc, ['Sede', 'Responsabile', 'Ambulatori', 'Medici', 'Sessioni/sett.', 'Slot/sett.', 'Utilizzo', 'Ore libere', 'Criticità alte'],
    [...rows.map((r) => [r.label, r.s.siteManager || '', r.s.ambulatori.length, r.med, r.sess, r.slots, `${r.util}%`, durTxt(r.free), r.alte.length]), ['TOTALE', '', tot.amb, tot.med, tot.sess, tot.slots, `${util}%`, durTxt(tot.free), tot.alte]], 28,
    { didParseCell: (h) => { if (h.section === 'body' && h.row.index === rows.length) h.cell.styles.fontStyle = 'bold'; } });
  for (const r of rows) {
    if (!r.plan) continue;
    y = section(doc, `${r.label} · utilizzo per ambulatorio`, y + 8);
    y = table(doc, ['Ambulatorio', 'Dedicato a', 'Sessioni', 'Slot', 'Utilizzo', 'Libero'], r.s.ambulatori.map((a) => { const st = r.plan.roomStats[a.id] || {}; return [a.nome, (a.discipline || []).join(', ') || 'polivalente', r.plan.assigns.filter((q) => q.roomId === a.id).length, st.slots || 0, `${st.util || 0}%`, durTxt(Math.max(0, (st.avail || 0) - (st.busy || 0)))]; }), y);
    if (r.alte.length) { y = section(doc, 'Criticità alte', y + 6); y = table(doc, ['Descrizione'], r.alte.map((c) => [c.t]), y); }
  }
  // specialisti del network
  y = section(doc, 'Professionisti del network (medici e sanitari)', y + 8);
  table(doc, ['Nome', 'Tipo', 'Discipline / profilo', 'Sedi', 'Ore/sett.'], net.specialisti.filter((x) => !x.attivita).map((x) => [x.nome, x.tipo, x.discipline.join(', ') || x.profili.join(', '), x.sedi.map((z) => z.sede).filter((v, i, a) => a.indexOf(v) === i).join('; '), durTxt(x.ore)]), y);
  return { doc, filename: `Report_Direzione_${new Date().toISOString().slice(0, 10)}.pdf` };
}
export function xlsxReportDirezione(net) {
  const { rows, tot, util } = reportDirezione(net);
  const wb = XLSX.utils.book_new();
  const sheet = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  sheet('Sedi', [['Sede', 'Indirizzo', 'Responsabile', 'Ambulatori', 'Medici', 'Sessioni/sett.', 'Slot/sett.', 'Utilizzo %', 'Ore libere', 'Criticità alte'], ...rows.map((r) => [r.label, r.s.indirizzo, r.s.siteManager || '', r.s.ambulatori.length, r.med, r.sess, r.slots, r.util, +(r.free / 60).toFixed(1), r.alte.length]), ['TOTALE', '', '', tot.amb, tot.med, tot.sess, tot.slots, util, +(tot.free / 60).toFixed(1), tot.alte]]);
  sheet('Sessioni', [['Sede', 'Giorno', 'Dalle', 'Alle', 'Ambulatorio', 'Medico', 'Disciplina', 'Slot', 'Supporto'], ...net.sedi.flatMap(({ plan, label }) => plan ? plan.assigns.map((a) => [label, DAYS[a.d], m2t(a.s), m2t(a.e), plan.byId[a.roomId].nome, plan.byId[a.medId].nome, (plan.byId[a.medId].discipline || [plan.byId[a.medId].disciplina]).filter(Boolean).join(', '), a.slots ?? '', a.sanId ? plan.byId[a.sanId].nome : '']) : [])]);
  sheet('Professionisti', [['Nome', 'Tipo', 'Discipline / profilo', 'Sedi', 'Ore/sett.', 'Sessioni'], ...net.specialisti.filter((x) => !x.attivita).map((x) => [x.nome, x.tipo, x.discipline.join(', ') || x.profili.join(', '), [...new Set(x.sedi.map((z) => z.sede))].join('; '), +(x.ore / 60).toFixed(1), x.sessioni.filter((q) => q.room).length])]);
  sheet('Spazi liberi', [['Sede', 'Ambulatorio', 'Giorno', 'Dalle', 'Alle', 'Minuti'], ...net.sedi.flatMap(({ plan, label }) => plan ? plan.free.map((f) => [label, plan.byId[f.roomId].nome, DAYS[f.d], m2t(f.s), m2t(f.e), f.e - f.s]) : [])]);
  sheet('Criticità', [['Sede', 'Livello', 'Descrizione'], ...net.sedi.flatMap(({ plan, label }) => plan ? plan.crit.map((c) => [label, c.lv, c.t]) : [])]);
  XLSX.writeFile(wb, `Report_Direzione_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
