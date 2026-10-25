// Helper del modulo Personale sanitario (frontend) + PDF rendiconto e turni
import { mkDoc, table, section } from './exports.js';
import { DAYS, DAYS_S } from './network.js';

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseTxt = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return `${MESI[Number(mm) - 1]} ${y}`; };
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const daysOf = (m) => { const [y, mm] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
export const dow = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const itD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const t2m = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const ore = (da, a) => Math.max(0, t2m(a) - t2m(da)) / 60;
export const oreTxt = (h) => { const m = Math.round(h * 60); return m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}'` : `${m / 60}h`; };
export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
export const STATO_REND = { BOZZA: ['Bozza', 'grey'], DA_APPROVARE: ['Da approvare', 'amber'], APPROVATO: ['Approvato', 'teal'], INVIATO: ['Inviato', 'green'], RESPINTO: ['Respinto', 'red'] };
export const RAPPORTO = { LP: 'Libero professionista', DIPENDENTE: 'Dipendente', CONVENZIONATO: 'Convenzionato', SOCIETA: 'Società / cooperativa' };
export const REGIME = { FORFETTARIO: 'Forfettario (no IVA, no ritenuta)', ORDINARIO: 'Ordinario (IVA + ritenuta d\'acconto)', DIPENDENTE: 'Dipendente (busta paga)', ALTRO: 'Altro' };
export const DOC_LABEL = { CV: 'Curriculum', DOCUMENTO_IDENTITA: 'Documento d\'identità', CODICE_FISCALE: 'Codice fiscale / tessera', ALBO: 'Iscrizione all\'albo', ASSICURAZIONE: 'Assicurazione RC', TITOLO_STUDIO: 'Titolo di studio', CONTRATTO: 'Contratto', PRIVACY: 'Privacy / consensi', ALTRO: 'Altro' };
export { DAYS, DAYS_S };

export function pdfRendiconto(r) {
  const det = r.dettaglio || {}; const o = det.oneri || {};
  const doc = mkDoc(`Rendiconto compensi · ${meseTxt(r.mese)}`, `${r.nome}${r.profilo ? ' · ' + r.profilo : ''}${det.professionista?.piva ? ' · P.IVA ' + det.professionista.piva : ''}${det.professionista?.cf ? ' · CF ' + det.professionista.cf : ''}`);
  let y = 30;
  y = section(doc, det.tipo === 'FISSO' ? `Compenso fisso mensile: ${eur(det.fisso)}` : `Prestazioni confermate: ${oreTxt(Number(r.ore))} · imponibile ${eur(r.importo)}`, y);
  if (det.righe?.length) y = table(doc, ['Data', 'Sede', 'Dalle', 'Alle', 'Ore', 'Tariffa', 'Importo', 'Attività', 'Note'], det.righe.map((x) => [itD(x.data), x.sede, x.oraDa, x.oraA, oreTxt(x.ore), det.tipo === 'FISSO' ? '—' : eur(x.tariffa), det.tipo === 'FISSO' ? '—' : eur(x.importo), x.attivita, x.nota]), y) + 6;
  if (det.perSede?.length) { y = section(doc, 'Riepilogo per sede', y); y = table(doc, ['Sede', 'Presenze', 'Ore', 'Importo'], det.perSede.map((s) => [s.sede, String(s.presenze), oreTxt(s.ore), eur(s.importo)]), y) + 6; }
  y = section(doc, 'Totali per la fattura', y);
  const rows = [['Imponibile', eur(o.imponibile)]];
  if (det.compenso?.cassaPct) rows.push([`Cassa previdenziale ${det.compenso.cassaPct}%`, eur(o.cassa)]);
  if (det.compenso?.ivaPct) rows.push([`IVA ${det.compenso.ivaPct}%`, eur(o.iva)]);
  rows.push(['Totale fattura', eur(o.totaleFattura)]);
  if (det.compenso?.ritPct) rows.push([`Ritenuta d'acconto ${det.compenso.ritPct}%`, '− ' + eur(o.ritenuta)], ['Netto a pagare', eur(o.netto)]);
  y = table(doc, ['Voce', 'Importo'], rows, y, { columnStyles: { 1: { halign: 'right' } }, tableWidth: 120 }) + 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 90, 95);
  doc.text(`Stato: ${STATO_REND[r.stato]?.[0] || r.stato}${r.approvato_da_nome ? ` · approvato da ${r.approvato_da_nome} il ${new Date(r.approvato_at).toLocaleDateString('it-IT')}` : ''}${r.nota ? ` · ${r.nota}` : ''}`, 12, y);
  doc.text('Importi calcolati dalle presenze confermate dai gestori di sede e dalle condizioni di compenso in anagrafica; gli oneri fiscali sono indicativi e vanno verificati in fattura.', 12, y + 5);
  return { doc, filename: `Rendiconto_${r.mese}_${String(r.nome).replace(/[^\w]+/g, '_')}.pdf` };
}

export function pdfTurni(mese, turni, label, sediMap = {}) {
  const doc = mkDoc(`Turni · ${meseTxt(mese)}`, label || '');
  const byDay = {};
  for (const t of turni) (byDay[t.data] ||= []).push(t);
  let y = 28;
  for (const d of Object.keys(byDay).sort()) {
    y = section(doc, `${DAYS[dow(d)]} ${itD(d)}`, y + 4);
    y = table(doc, ['Sede', 'Dalle', 'Alle', 'Professionista', 'Profilo', 'Attività', 'Note'], byDay[d].sort((a, b) => (a.sede_id || '').localeCompare(b.sede_id || '') || a.ora_da.localeCompare(b.ora_da)).map((t) => [sediMap[t.sede_id] || t.sede || t.sede_id, t.ora_da, t.ora_a, t.prof_nome || t.nome || 'SCOPERTO', t.prof_profilo || t.profilo || '', t.attivita || '', t.nota || '']), y);
  }
  return { doc, filename: `Turni_${mese}${label ? '_' + label.replace(/[^\w]+/g, '_') : ''}.pdf` };
}
