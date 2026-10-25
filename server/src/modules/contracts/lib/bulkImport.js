// Caricamento massivo di risorse da Excel (format scaricabile dall'app)
import ExcelJS from 'exceljs';
import { one } from '../db.js';

const CONTRACTS = { 'TEMPO INDETERMINATO': 'TIND', TIND: 'TIND', 'TEMPO DETERMINATO': 'TDET', TDET: 'TDET', APPRENDISTATO: 'APPRENDISTATO', DIRIGENTE: 'DIRIGENTE' };
const LEVELS = ['Q', '1', '2', '3S', '3', '4S', '4', '5'];

// Colonne del format: key = campo, label = intestazione nel file, req = obbligatorio, target = person | employment | lp
const COMMON_HEAD = [
  { key: 'last_name', label: 'Cognome *', req: true, target: 'person', width: 20, example: 'Rossi' },
  { key: 'first_name', label: 'Nome *', req: true, target: 'person', width: 18, example: 'Maria' },
  { key: 'tax_code', label: 'Codice fiscale *', req: true, target: 'person', width: 20, example: 'RSSMRA80A41D612X' },
  { key: 'sex', label: 'Sesso (F/M)', target: 'person', width: 10, example: 'F' },
  { key: 'birth_date', label: 'Data di nascita', target: 'person', width: 14, example: '1980-01-01', date: true },
  { key: 'birth_place', label: 'Luogo di nascita', target: 'person', width: 20, example: 'Firenze (FI)' },
  { key: 'email', label: 'Email', target: 'person', width: 28, example: 'maria.rossi@toscanadiagnostica.it' },
  { key: 'phone', label: 'Cellulare personale', target: 'person', width: 16, example: '333 1234567' },
  { key: 'phone_office', label: 'Telefono fisso', target: 'person', width: 16, example: '055 776511' },
  { key: 'mobile_company', label: 'Cellulare aziendale', target: 'person', width: 16, example: '' },
  { key: 'address', label: 'Indirizzo', target: 'person', width: 26, example: 'Via Roma, 1' },
  { key: 'zip', label: 'CAP', target: 'person', width: 8, example: '50100' },
  { key: 'city', label: 'Città', target: 'person', width: 16, example: 'Firenze' },
  { key: 'province', label: 'Provincia', target: 'person', width: 9, example: 'FI' },
  { key: 'area', label: 'Area (denominazione)', target: 'area', width: 28, example: 'Network Punti Prelievo' },
  { key: 'manager', label: 'Riporta a (Cognome Nome)', target: 'manager', width: 24, example: 'Epifani Francesco' },
  { key: 'hired_at', label: 'Data di ingresso *', req: true, target: 'person', width: 14, example: '2026-09-01', date: true },
];
const EMP_COLS = [
  { key: 'contract_type', label: 'Tipo contratto * (Tempo indeterminato / Tempo determinato / Apprendistato / Dirigente)', req: true, target: 'employment', width: 30, example: 'Tempo indeterminato' },
  { key: 'level', label: 'Livello CCNL * (Q, 1, 2, 3S, 3, 4S, 4, 5; vuoto per i dirigenti)', target: 'employment', width: 20, example: '3' },
  { key: 'job_title', label: 'Mansione *', req: true, target: 'employment', width: 30, example: 'Infermiera' },
  { key: 'ral', label: 'RAL annua lorda *', req: true, target: 'employment', width: 16, example: 28000, num: true },
  { key: 'monthly_payments', label: 'Mensilità (14 o 13)', target: 'employment', width: 12, example: 14, num: true },
  { key: 'weekly_hours', label: 'Ore settimanali', target: 'employment', width: 12, example: 40, num: true },
  { key: 'end_date', label: 'Fine contratto (solo tempo determinato)', target: 'employment', width: 18, example: '', date: true },
  { key: 'probation_days', label: 'Giorni di prova', target: 'employment', width: 12, example: 90, num: true },
  { key: 'work_site', label: 'Sede di lavoro', target: 'employment', width: 30, example: 'Via di Pratignone 13/4, Sesto Fiorentino' },
  { key: 'mbo_amount', label: 'Premio MBO annuo (importo)', target: 'employment', width: 16, example: '', num: true },
];
const LP_COLS = [
  { key: 'vat_number', label: 'Partita IVA', target: 'person', width: 14, example: '01234567890' },
  { key: 'discipline', label: 'Disciplina *', req: true, target: 'lp', width: 26, example: 'Anatomia Patologica' },
  { key: 'role_description', label: 'Oggetto della prestazione', target: 'lp', width: 36, example: 'Refertazione esami istologici' },
  { key: 'start_date', label: 'Inizio contratto *', req: true, target: 'lp', width: 14, example: '2026-09-01', date: true },
  { key: 'end_date', label: 'Fine contratto', target: 'lp', width: 14, example: '2027-08-31', date: true },
  { key: 'fee_monthly', label: 'Compenso fisso mensile (importo)', target: 'fee', width: 18, example: 3000, num: true, fee: { type: 'FISSO', description: 'Compenso fisso mensile', unit: 'mese' } },
  { key: 'fee_service', label: 'Compenso a prestazione (importo per prestazione)', target: 'fee', width: 20, example: '', num: true, fee: { type: 'PRESTAZIONE', description: 'Compenso a prestazione', unit: 'cad' } },
  { key: 'fee_service_desc', label: 'Prestazione (descrizione del compenso a prestazione)', target: 'feedesc', width: 30, example: '' },
  { key: 'fee_hourly', label: 'Compenso a ore (importo orario)', target: 'fee', width: 16, example: '', num: true, fee: { type: 'ORARIO', description: 'Compenso orario', unit: 'ora' } },
  { key: 'fee_variable', label: 'Compenso variabile sul fatturato (%)', target: 'fee', width: 18, example: '', num: true, fee: { type: 'VARIABILE', description: 'Compenso variabile sul fatturato', unit: '%', notes: 'del fatturato' } },
  { key: 'fee_vat', label: 'IVA sui compensi * (Con IVA / Senza IVA)', req: true, target: 'vat', width: 18, example: 'Senza IVA' },
  { key: 'vat_regime', label: 'Regime IVA / cassa (es. esente art. 10; cassa 4%)', target: 'lp', width: 24, example: 'esente art. 10' },
  { key: 'order_name', label: 'Albo / Ordine', target: 'lp', width: 22, example: 'Ordine dei Medici' },
  { key: 'order_province', label: 'Provincia albo', target: 'lp', width: 12, example: 'FI' },
  { key: 'order_number', label: 'Numero iscrizione', target: 'lp', width: 14, example: '12345' },
  { key: 'insurance_expiry', label: 'Scadenza polizza RC', target: 'lp', width: 14, example: '', date: true },
];
const NOTES_COL = { key: 'notes', label: 'Note', target: 'person', width: 30, example: '' };

export function columnsFor(kind) { return [...COMMON_HEAD, ...(kind === 'LP' ? LP_COLS : EMP_COLS), NOTES_COL]; }

/** Format XLSX con intestazioni, riga di esempio e foglio istruzioni. */
export async function buildTemplate(kind) {
  const cols = columnsFor(kind);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'LP' ? 'Liberi professionisti' : 'Dipendenti');
  ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 44;
  cols.forEach((c, i) => { head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.req ? 'FF1B505F' : 'FF71B1BD' } }; });
  ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: 'FF666666' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  cols.forEach((c, i) => { if (c.date) ws.getColumn(i + 1).numFmt = '@'; });
  const info = wb.addWorksheet('Istruzioni');
  info.getColumn(1).width = 110;
  [
    `Format di caricamento massivo: ${kind === 'LP' ? 'liberi professionisti' : 'dipendenti'} - TD Contracts`,
    'Compilare una riga per persona nel primo foglio. La riga 2 è un esempio: sostituirla o cancellarla.',
    'Le colonne con asterisco e intestazione scura sono obbligatorie: se manca un valore il file viene rifiutato per intero e nessuna riga viene caricata.',
    'Date nel formato AAAA-MM-GG (es. 2026-09-01) oppure come data Excel. Importi senza simbolo di valuta (es. 28000).',
    kind === 'LP' ? 'Disciplina e inizio contratto sono obbligatori. Compensi: compilare una o più colonne tra fisso mensile (importo al mese), a prestazione (importo per singola prestazione, con la descrizione della prestazione nella colonna accanto), a ore (importo orario) e variabile sul fatturato (percentuale, es. 10). Almeno un compenso è obbligatorio.' : 'Tipo contratto, mansione, RAL e data di ingresso sono obbligatori; il livello CCNL è obbligatorio tranne che per i dirigenti.',
    ...(kind === 'LP' ? ['IVA sui compensi (obbligatorio): "Con IVA" se i compensi sono assoggettati a IVA, "Senza IVA" se non lo sono (es. prestazioni sanitarie esenti art. 10 DPR 633/72, regime forfettario). Il dettaglio del regime va nella colonna "Regime IVA / cassa". Il valore si applica a tutte le voci di compenso della riga; voci con trattamento IVA diverso si correggono poi nella scheda.'] : []),
    'Area: denominazione esatta di un\'area presente in Impostazioni. Riporta a: "Cognome Nome" di una risorsa già censita.',
    'Il codice fiscale identifica la persona: se esiste già, la riga aggiorna anagrafica e contratto invece di creare un duplicato.',
  ].forEach((t, i) => { const row = info.addRow([t]); if (i === 0) row.font = { bold: true, size: 13, color: { argb: 'FF1B505F' } }; row.alignment = { wrapText: true }; });
  return wb;
}

const cellStr = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') { if (v.richText) return v.richText.map((t) => t.text).join('').trim(); if (v.text) return String(v.text).trim(); if (v.result != null) return cellStr(v.result); return String(v).trim(); }
  return String(v).trim();
};
const toDate = (s) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); }
  return undefined; // non riconosciuta
};
const toNum = (s) => { if (s === '' || s == null) return null; const n = Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : undefined; };

/** Legge il file e restituisce { rows, errors }. rows[i] = { line, person, employment|lp, area_name, manager_name }. */
export async function readBulk(buffer, kind) {
  const cols = columnsFor(kind);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Il file non contiene fogli');
  // mappa intestazioni -> colonna (confronto sul testo prima dell'asterisco o della parentesi)
  const norm = (t) => cellStr(t).toLowerCase().replace(/\s*\(.*$/, '').replace(/\*/g, '').trim();
  const idx = {};
  ws.getRow(1).eachCell((cell, n) => { const h = norm(cell.value); const c = cols.find((x) => norm(x.label) === h); if (c) idx[c.key] = n; });
  const missingCols = cols.filter((c) => c.req && !idx[c.key]).map((c) => c.label);
  if (missingCols.length) return { rows: [], errors: [`Colonne obbligatorie assenti nel file: ${missingCols.join(', ')}. Usa il format scaricabile dall'app.`] };
  const rows = []; const errors = [];
  const example = Object.fromEntries(cols.map((c) => [c.key, String(c.example ?? '')]));
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const get = (k) => (idx[k] ? cellStr(row.getCell(idx[k]).value) : '');
    const vals = Object.fromEntries(cols.map((c) => [c.key, get(c.key)]));
    if (!Object.values(vals).some((v) => v !== '')) continue; // riga vuota
    if (cols.every((c) => vals[c.key] === example[c.key])) continue; // riga di esempio lasciata nel file
    const err = (m) => errors.push(`Riga ${n}: ${m}`);
    for (const c of cols) if (c.req && !vals[c.key] && !(kind !== 'LP' && c.key === 'level')) err(`manca "${c.label.replace(/\s*\(.*$/, '').replace('*', '').trim()}"`);
    const person = { kind, status: 'ATTIVO' };
    const emp = {}; const lp = {}; const fees = []; let feeVat = null; let feeDesc = '';
    for (const c of cols) {
      let v = vals[c.key];
      if (v === '' && !c.req) continue;
      if (c.date) { const d = toDate(v); if (d === undefined) { err(`"${c.label}" non è una data valida (${v})`); continue; } v = d; }
      if (c.num) { const x = toNum(v); if (x === undefined) { err(`"${c.label}" non è un numero (${v})`); continue; } v = x; }
      if (c.key === 'sex') { v = v.toUpperCase().slice(0, 1); if (v && !['F', 'M'].includes(v)) { err('Sesso deve essere F o M'); continue; } }
      if (c.key === 'tax_code') { v = v.toUpperCase().replace(/\s/g, ''); if (v && v.length !== 16) err(`codice fiscale di ${v.length} caratteri (attesi 16)`); }
      if (c.key === 'province') v = v.toUpperCase().slice(0, 2);
      if (c.key === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err(`email non valida (${v})`); continue; }
      if (c.key === 'contract_type') { const ct = CONTRACTS[v.toUpperCase()]; if (!ct) { err(`tipo contratto non riconosciuto (${v})`); continue; } v = ct; }
      if (c.key === 'level') { v = v.toUpperCase(); if (v && !LEVELS.includes(v)) { err(`livello CCNL non valido (${v})`); continue; } }
      if (c.target === 'person') person[c.key] = v;
      else if (c.target === 'employment') emp[c.key] = v;
      else if (c.target === 'lp') lp[c.key] = v;
      else if (c.target === 'fee') { if (v != null && v > 0) fees.push({ ...c.fee, amount: v }); }
      else if (c.target === 'feedesc') feeDesc = v;
      else if (c.target === 'vat') { const t = v.toUpperCase().replace(/\s+/g, ' ').trim(); if (/^(CON|CON IVA|SI|SÌ|S)$/.test(t)) feeVat = 'CON'; else if (/^(SENZA|SENZA IVA|NO|N|ESENTE)$/.test(t)) feeVat = 'SENZA'; else if (v) err(`"IVA sui compensi" deve essere "Con IVA" o "Senza IVA" (${v})`); }
      else if (c.target === 'area') { const a = await one('SELECT id FROM areas WHERE lower(name)=lower($1)', [v]); if (!a) err(`area "${v}" inesistente: crearla in Impostazioni o correggere il nome`); else person.area_id = a.id; }
      else if (c.target === 'manager') { const m = await one(`SELECT id FROM resources WHERE lower(last_name || ' ' || first_name)=lower($1) OR lower(first_name || ' ' || last_name)=lower($1)`, [v]); if (!m) err(`responsabile "${v}" non trovato tra le risorse`); else person.manager_id = m.id; }
    }
    if (kind !== 'LP') {
      if (emp.contract_type && emp.contract_type !== 'DIRIGENTE' && !emp.level) err('manca "Livello CCNL" (obbligatorio salvo dirigenti)');
      if (emp.contract_type === 'TDET' && !emp.end_date) err('tempo determinato senza "Fine contratto"');
      if (!emp.start_date && person.hired_at) emp.start_date = person.hired_at;
      if (emp.mbo_amount) emp.mbo_enabled = true;
    } else {
      if (!fees.length) err('manca il compenso: indicare almeno uno tra fisso mensile, a prestazione, a ore, variabile sul fatturato');
      for (const f of fees) { f.vat = feeVat; if (f.type === 'PRESTAZIONE' && feeDesc) f.description = feeDesc; }
      lp.fees = fees;
    }
    rows.push({ line: n, person, employment: kind !== 'LP' ? emp : null, lp: kind === 'LP' ? lp : null });
  }
  if (!rows.length && !errors.length) errors.push('Il file non contiene righe da caricare');
  // duplicati nel file
  const seen = new Map();
  for (const x of rows) { const cf = x.person.tax_code; if (!cf) continue; if (seen.has(cf)) errors.push(`Riga ${x.line}: codice fiscale ${cf} già presente alla riga ${seen.get(cf)}`); else seen.set(cf, x.line); }
  return { rows, errors };
}
