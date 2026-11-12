// Lab Control (v0.71.0) · export Excel dell'elenco delle accettazioni e dei ritardi. MAI i nomi dei pazienti: età e sesso della demografia.
import ExcelJS from 'exceljs';

const data = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const dataOra = (t) => (t ? `${data(t.slice(0, 10))} ${t.slice(11, 16)}` : '');

const COLONNE = [
  ['Numero', 14, (r) => r.numero], ['Data', 11, (r) => data(r.data)], ['Ora', 7, (r) => (r.creata_il || '').slice(11, 16)],
  ['Cliente', 32, (r) => r.cliente], ['Codice StudioLab', 16, (r) => r.client_code], ['Sede', 26, (r) => r.sede || ''],
  ['Età', 6, (r) => r.eta], ['Sesso', 6, (r) => r.sesso || ''], ['Tipo paziente', 14, (r) => r.tipo_paziente || ''], ['Medicina del lavoro', 10, (r) => (r.medicina_lavoro ? 'sì' : '')],
  ['Esami', 7, (r) => r.esami], ['di cui pronti', 9, (r) => r.esami_pronti], ['Non eseguiti', 9, (r) => r.esami_non_eseguiti], ['Campioni', 9, (r) => r.campioni],
  ['Stato', 18, (r) => r.stato_label], ['Fase', 22, (r) => r.fase.label], ['Ultimo aggiornamento', 17, (r) => dataOra(r.aggiornata_il)], ['Referto il', 17, (r) => dataOra(r.referto_il)],
  ['Accettazione → referto (ore)', 12, (r) => (r.tat_min == null ? null : Math.round(r.tat_min / 6) / 10)],
  ['Valore (produzione accettata, €)', 14, (r) => r.valore], ['Valore parziale', 9, (r) => (r.valore_parziale ? 'sì' : '')],
  ['Fattura', 16, (r) => r.fatture.map((f) => f.numero || f.id).join(', ')], ['NC', 6, (r) => (r.nc ? r.nc.totale : '')],
  ['In ritardo', 9, (r) => (r.ritardo.in_ritardo ? 'sì' : '')], ['Ore dall\'accettazione', 10, (r) => r.ritardo.ore], ['Motivo del ritardo', 40, (r) => r.ritardo.motivo || ''],
];

/** Excel delle accettazioni (righe di dettagliElenco senza nomi). intestazione = testo della prima riga (filtri e fonte). */
export async function xlsxAccettazioni(righe, { intestazione = '', foglio = 'Accettazioni', bloccanti = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD · Lab Control';
  const ws = wb.addWorksheet(foglio);
  const cols = bloccanti ? [...COLONNE, ['Esami che bloccano', 40, (r) => (r.bloccanti || []).map((b) => b.codice).join(' ')]] : COLONNE;
  ws.addRow([intestazione]);
  ws.getRow(1).font = { italic: true, color: { argb: 'FF555555' } };
  const h = ws.addRow(cols.map((c) => c[0]));
  h.font = { bold: true }; h.alignment = { wrapText: true, vertical: 'top' };
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });
  for (const r of righe) ws.addRow(cols.map((c) => { const v = c[2](r); return v == null ? '' : v; }));
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
