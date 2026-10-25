// Importazione da Excel/CSV esportati dai gestionali (GIPO, TuoTempo, StudioLab) con mappatura colonne guidata
import ExcelJS from 'exceljs';
import { q, one, many, tx } from '../db.js';
import { bad } from './util.js';
import { refreshCustomerStats } from './customers.js';

// Campi di destinazione per dataset: key, etichetta, obbligatorio, sinonimi per la mappatura automatica
export const DATASETS = {
  SALES: {
    label: 'Vendite / accettazioni',
    fields: [
      ['external_ref', 'Numero accettazione / fattura', true, ['numerorichiesta', 'numero_richiesta', 'richiesta', 'accettazione', 'n_accettazione', 'numero', 'id_accettazione', 'booking_id', 'id_prenotazione', 'documento', 'protocollo', 'n. accettazione', 'ordine']],
      ['line_no', 'Progressivo riga', false, ['riga', 'linea', 'progressivo', 'line']],
      ['sale_date', 'Data', true, ['dataaccettazione', 'data', 'data_accettazione', 'data_prestazione', 'date', 'data_documento', 'data prenotazione', 'start_date', 'data_erogazione']],
      ['sale_time', 'Ora', false, ['ora', 'orario', 'time', 'start_time']],
      ['customer_external_id', 'ID paziente nel gestionale', false, ['id_paziente', 'codice_paziente', 'paziente_id', 'patient_id', 'userid', 'id_cliente', 'codice cliente', 'cod_paz']],
      ['customer_tax_code', 'Codice fiscale', false, ['codice_fiscale', 'cf', 'codfisc', 'fiscal_code', 'cod_fiscale', 'codice fiscale']],
      ['customer_last_name', 'Cognome', false, ['cognome', 'last_name', 'lastname', 'surname']],
      ['customer_first_name', 'Nome', false, ['nome', 'first_name', 'firstname']],
      ['customer_sex', 'Sesso', false, ['sesso', 'sex', 'genere', 'gender']],
      ['customer_birth_date', 'Data di nascita', false, ['datanascita', 'data_nascita', 'nascita', 'birth_date', 'birthday', 'data di nascita', 'nato_il']],
      ['customer_city', 'Comune di residenza', false, ['comune', 'citta', 'città', 'city', 'residenza', 'comune_residenza', 'localita']],
      ['customer_province', 'Provincia', false, ['provincia', 'prov', 'province']],
      ['customer_zip', 'CAP', false, ['cap', 'zip', 'postal_code']],
      ['customer_email', 'Email paziente', false, ['email', 'e-mail', 'mail']],
      ['customer_phone', 'Telefono paziente', false, ['telefono', 'cellulare', 'phone', 'mobile', 'tel']],
      ['b2b_code', 'Codice cliente B2B nel gestionale', false, ['codicecliente', 'codice_cliente', 'cod_cliente', 'codcliente', 'cliente_codice', 'customer_code']],
      ['b2b_company', 'Azienda / struttura committente (B2B)', false, ['nomecliente', 'nome_cliente', 'azienda', 'ragione_sociale', 'ragione sociale', 'cliente', 'committente', 'ditta', 'struttura', 'company', 'intestatario']],
      ['b2b_vat', 'Partita IVA committente', false, ['partita_iva', 'piva', 'p.iva', 'vat', 'partita iva']],
      ['site_code', 'Sede (codice o nome)', false, ['sede', 'punto_prelievo', 'centro', 'struttura_erogante', 'site', 'location', 'ambulatorio', 'filiale', 'unita']],
      ['product_code', 'Codice prestazione', true, ['codiceanalisi', 'codice_analisi', 'codice', 'cod_prestazione', 'codice_prestazione', 'codice_td', 'articolo', 'code', 'cod', 'codice esame', 'cod_esame', 'id_prestazione']],
      ['product_desc', 'Descrizione prestazione', false, ['descrizioneanalisi', 'descrizione_analisi', 'descrizione', 'prestazione', 'esame', 'description', 'descrizione_prestazione', 'servizio', 'service']],
      ['quantity', 'Quantità', false, ['quantita', 'quantità', 'qta', 'qty', 'quantity', 'q.ta']],
      ['gross_amount', 'Importo lordo (listino)', false, ['prezzolordo', 'importo_lordo', 'lordo', 'prezzo_lordo', 'prezzo', 'prezzo_listino', 'listino', 'tariffa', 'importo', 'price', 'gross']],
      ['discount', 'Sconto', false, ['sconto', 'discount', 'abbuono', 'riduzione']],
      ['net_amount', 'Importo netto (incassato)', false, ['prezzonetto', 'prezzo_netto', 'importo_netto', 'netto', 'totale', 'incassato', 'pagato', 'net', 'amount', 'imponibile', 'totale_riga']],
      ['payment_kind', 'Regime (privato, SSN, convenzione...)', false, ['regime', 'tipo_pagamento', 'convenzione', 'pagamento', 'tipologia', 'payment', 'modalita', 'ente']],
      ['booking_channel', 'Canale di prenotazione', false, ['canale', 'channel', 'origine', 'provenienza', 'source', 'prenotato_da', 'modalita_prenotazione']],
      ['referrer', 'Medico prescrittore', false, ['medico', 'prescrittore', 'mmg', 'referrer', 'inviante', 'medico_curante']],
      ['promo_code', 'Codice promozione', false, ['promo', 'codice_promo', 'promozione', 'coupon', 'voucher', 'campagna']],
      ['invoice_ref', 'Numero fattura', false, ['numerofattura', 'numero_fattura', 'n_fattura', 'fattura', 'invoice', 'num_fattura']],
      ['operator', 'Operatore di accettazione (chi vende)', false, ['operatore', 'utente', 'accettato_da', 'cassiere', 'user', 'username', 'addetto', 'inserito_da', 'sportellista']],
    ],
  },
  CUSTOMERS: {
    label: 'Anagrafiche clienti',
    fields: [
      ['external_id', 'ID nel gestionale', false, ['id', 'id_paziente', 'codice_paziente', 'patient_id', 'userid', 'codice', 'id_cliente']],
      ['tax_code', 'Codice fiscale', false, ['codice_fiscale', 'cf', 'codfisc', 'fiscal_code', 'codice fiscale']],
      ['last_name', 'Cognome', false, ['cognome', 'last_name', 'surname']],
      ['first_name', 'Nome', false, ['nome', 'first_name']],
      ['sex', 'Sesso', false, ['sesso', 'sex', 'genere', 'gender']],
      ['birth_date', 'Data di nascita', false, ['data_nascita', 'nascita', 'birth_date', 'birthday', 'data di nascita']],
      ['email', 'Email', false, ['email', 'e-mail', 'mail']],
      ['phone', 'Telefono', false, ['telefono', 'cellulare', 'phone', 'mobile', 'tel']],
      ['address', 'Indirizzo', false, ['indirizzo', 'via', 'address']],
      ['zip', 'CAP', false, ['cap', 'zip']],
      ['city', 'Comune', false, ['comune', 'citta', 'città', 'city', 'residenza']],
      ['province', 'Provincia', false, ['provincia', 'prov']],
      ['marketing_consent', 'Consenso marketing', false, ['consenso', 'marketing', 'consenso_marketing', 'privacy_marketing', 'newsletter']],
      ['acquisition_channel', 'Canale di acquisizione', false, ['canale', 'origine', 'provenienza', 'come_ci_ha_conosciuto', 'source']],
      ['company_name', 'Ragione sociale (B2B)', false, ['ragione_sociale', 'ragione sociale', 'azienda', 'ditta', 'company']],
      ['vat_number', 'Partita IVA (B2B)', false, ['partita_iva', 'piva', 'p.iva', 'vat']],
      ['sector', 'Settore (B2B)', false, ['settore', 'sector', 'ateco', 'attivita']],
      ['contact_name', 'Referente (B2B)', false, ['referente', 'contatto', 'contact']],
      ['employees', 'Dipendenti (B2B)', false, ['dipendenti', 'addetti', 'employees', 'n_dipendenti']],
    ],
  },
  PRODUCTS: {
    label: 'Catalogo prestazioni',
    fields: [
      ['code', 'Codice', true, ['codice', 'code', 'cod', 'articolo', 'codice_td', 'codice_prestazione']],
      ['description', 'Descrizione', true, ['descrizione', 'description', 'prestazione', 'descrizione_in_fattura']],
      ['specialty', 'Specialità / branca', false, ['specialita', 'specialità', 'specialita_descrizione', 'branca', 'reparto', 'gruppo', 'specialty']],
      ['line_code', 'Linea (LAB, IMG, SPEC, MDL, PAC)', false, ['linea', 'line', 'area', 'macro']],
      ['price', 'Prezzo listino privato', false, ['prezzo', 'listino1_prezzo', 'listino', 'price', 'tariffa_pp', 'tariffa', 'prezzo_privato']],
      ['price_ssn', 'Tariffa SSN', false, ['tariffa_ssn', 'ssn', 'nomenclatore_prezzo', 'tariffa_regionale']],
      ['cost', 'Costo di produzione', false, ['costo', 'costo_produzione', 'cost', 'costo fisso materiali']],
      ['duration_min', 'Durata (minuti)', false, ['durata', 'tempo_previsto_minuti', 'minuti', 'duration']],
      ['nomenclature', 'Codice nomenclatore', false, ['nomenclatore', 'codice_nomenclatore', 'codice_regionale', 'codice regionale']],
      ['periodicity_months', 'Periodicità richiamo (mesi)', false, ['periodicita', 'richiamo', 'mesi']],
    ],
  },
  CATALOG_STUDIOLAB: {
    label: 'Tabella esami StudioLab (catalogo e listini)',
    fields: [
      ['code', 'Codice esame', true, ['codesame', 'cod_esame', 'codice']],
      ['description', 'Descrizione', true, ['descesame', 'desc_esame', 'descrizione']],
      ['description_short', 'Descrizione abbreviata', false, ['descesameabbr', 'desc_esame_abbr']],
      ['sector', 'Settore', false, ['codicesettore', 'codice_settore', 'settore']],
      ['sector_clinical', 'Settore clinico', false, ['codicesettoreclinico', 'codice_settore_clinico', 'settore_clinico']],
      ['destination', 'Destinazione (strumento / service)', false, ['destinazione']],
      ['nomenclature', 'Codice nomenclatore (CodUSL)', false, ['codusl', 'cod_usl', 'nomenclatore']],
      ['price_ssn', 'Tariffa SSN (PrezzoUSL_Esame)', false, ['prezzousl_esame', 'prezzo_usl_esame']],
      ['price', 'Prezzo privati', false, ['prezzoprivati', 'prezzo_privati']],
      ['price_mdl', 'Prezzo medicina del lavoro', false, ['prezzomdl', 'prezzo_mdl']],
      ['price_service', 'Prezzo service', false, ['prezzoservice', 'prezzo_service']],
      ['cost_service', 'Costo service (Tabella esami)', false, ['costoservice', 'costo_service']],
      ['is_vet', 'Veterinario', false, ['vet']],
      ['days', 'Giorni refertazione', false, ['giornirefertazione', 'giorni_refertazione']],
      ['non_usato', 'Non usato', false, ['nonusato', 'non_usato']],
    ],
  },
  COSTS: {
    label: 'Distinta base (costi per esame)',
    multiSheet: ['CodEsame', 'Costo Totale'], // fogli da unire: quelli che hanno entrambe le colonne
    fields: [
      ['code', 'Codice esame', true, ['codesame', 'cod_esame', 'codice']],
      ['cost', 'Costo totale', true, ['costo_totale', 'costototale', 'costo']],
      ['cost_unit', 'Costo unitario (materiali)', false, ['costo_unitario', 'costounitario']],
      ['cost_service', 'Costo service esterno', false, ['costo_service_esterno_bianalisi', 'costo_service_esterno', 'costo_service']],
      ['description', 'Descrizione', false, ['descesameabbr', 'desc_esame_abbr', 'descrizione']],
      ['sector_clinical', 'Settore clinico', false, ['codicesettoreclinico', 'settore_clinico']],
      ['destination', 'Destinazione', false, ['destinazione_toscana_diagnostica', 'destinazione']],
      ['in_use', 'In uso', false, ['in_uso', 'inuso']],
      ['price_b2b', 'Prezzo B2B (se presente)', false, ['b2b']],
      ['price_b2c', 'Prezzo B2C (se presente)', false, ['b2c']],
    ],
  },
};

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function autoMap(dataset, headers) {
  const def = DATASETS[dataset]; if (!def) throw bad('Dataset sconosciuto');
  const map = {}; const used = new Set();
  for (const [key, , , syn] of def.fields) {
    const cands = syn.map(norm);
    const h = headers.find((x) => !used.has(x) && cands.includes(norm(x))) || headers.find((x) => !used.has(x) && cands.some((c) => norm(x).includes(c) && c.length >= 4));
    if (h) { map[key] = h; used.add(h); }
  }
  return map;
}

// ---- parsing ----
function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
    if (v.result != null) return v.result;
    if (v.hyperlink) return v.text || v.hyperlink;
  }
  return v;
}

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; continue; }
    if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function gridToRows(grid) {
  if (!grid.length) return null;
  // riga di intestazione: la prima con almeno 2 celle testuali
  let hi = grid.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2); if (hi < 0) hi = 0;
  const headers = grid[hi].map((h, i) => (h == null || String(h).trim() === '' ? `Colonna ${i + 1}` : String(h).trim()));
  const rows = grid.slice(hi + 1).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? null; }); return o; });
  return { headers, rows };
}
const sheetGrid = (ws) => { const grid = []; ws.eachRow({ includeEmpty: false }, (row) => { const arr = []; row.eachCell({ includeEmpty: true }, (c, i) => { arr[i - 1] = cellValue(c.value); }); grid.push(arr); }); return grid; };

// multiSheet: unisce tutti i fogli che hanno la stessa colonna chiave (es. distinta base con un foglio per fornitore)
export async function parseFile(buffer, filename, { multiSheet = false, keyHeader = null } = {}) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    let text = buffer.toString('utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const r = gridToRows(parseCsv(text)); if (!r) throw bad('File vuoto'); return r;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.filter((w) => w.rowCount > 1);
  if (!sheets.length) throw bad('Il file non contiene fogli');
  if (!multiSheet) { const r = gridToRows(sheetGrid(sheets[0])); if (!r) throw bad('File vuoto'); return r; }
  const parts = sheets.map((ws) => ({ name: ws.name, ...gridToRows(sheetGrid(ws)) })).filter((x) => x.headers);
  const keys = (Array.isArray(keyHeader) ? keyHeader : keyHeader ? [keyHeader] : []).map(norm);
  const usable = keys.length ? parts.filter((x) => keys.every((k) => x.headers.some((h) => norm(h) === k))) : parts;
  if (!usable.length) throw bad(`Nessun foglio con le colonne ${[].concat(keyHeader).join(', ')}`);
  const headers = [...new Set(usable.flatMap((x) => x.headers))].filter((h) => !/^Colonna \d+$/.test(h));
  const rows = usable.flatMap((x) => x.rows.map((r) => { const o = {}; headers.forEach((h) => { o[h] = r[h] ?? null; }); o.__sheet = x.name; return o; }));
  return { headers, rows, sheets: usable.map((x) => ({ name: x.name, rows: x.rows.length })) };
}

// ---- normalizzazione valori ----
// celle con formula senza risultato in cache (formule condivise di Excel): exceljs non legge il valore; per i numeri vale 0, per i testi nulla
const isFormulaNoResult = (v) => v != null && typeof v === 'object' && (v.formula || v.sharedFormula) && v.result == null;
const S = (v) => (v == null || isFormulaNoResult(v) ? null : String(v).trim() || null);
export function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
const toTime = (v) => { if (v == null) return null; if (v instanceof Date) return v.toISOString().slice(11, 16); const m = String(v).match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
export const toNum = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v; if (isFormulaNoResult(v)) return 0; const s = String(v).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = Number(s); return Number.isFinite(n) ? n : null; };
const toSex = (v) => { const s = S(v)?.toUpperCase(); if (!s) return null; if (['F', 'FEMMINA', 'DONNA', 'FEMALE', 'W'].includes(s)) return 'F'; if (['M', 'MASCHIO', 'UOMO', 'MALE'].includes(s)) return 'M'; return null; };
const toBool = (v) => { const s = S(v)?.toLowerCase(); if (s == null) return null; return ['1', 'si', 'sì', 'true', 'x', 'yes', 'y', 's'].includes(s) ? true : ['0', 'no', 'false', 'n'].includes(s) ? false : null; };
const sexFromCf = (cf) => { if (!cf || cf.length !== 16) return null; const dd = Number(cf.slice(9, 11)); return Number.isNaN(dd) ? null : dd > 40 ? 'F' : 'M'; };
const birthFromCf = (cf) => {
  if (!cf || cf.length !== 16) return null;
  const M = { A: 1, B: 2, C: 3, D: 4, E: 5, H: 6, L: 7, M: 8, P: 9, R: 10, S: 11, T: 12 };
  const yy = Number(cf.slice(6, 8)); const mm = M[cf[8]]; let dd = Number(cf.slice(9, 11)); if (dd > 40) dd -= 40;
  if (!mm || Number.isNaN(yy) || Number.isNaN(dd)) return null;
  const now = new Date().getFullYear() % 100; const y = yy <= now ? 2000 + yy : 1900 + yy;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};
const PAY = { privato: 'PRIVATO', priv: 'PRIVATO', solvente: 'PRIVATO', ssn: 'SSN', ssr: 'SSN', ticket: 'SSN', asl: 'SSN', convenzione: 'CONVENZIONE', convenzionato: 'CONVENZIONE', assicurazione: 'ASSICURAZIONE', assicurato: 'ASSICURAZIONE', fondo: 'FONDO', azienda: 'AZIENDA', aziendale: 'AZIENDA' };
const normPay = (v) => { const s = norm(v); if (!s) return null; for (const k of Object.keys(PAY)) if (s.includes(k)) return PAY[k]; return S(v).toUpperCase().slice(0, 30); };
const CH = { web: 'WEB', online: 'WEB', sito: 'WEB', tuotempo: 'TUOTEMPO', app: 'APP', telefono: 'TELEFONO', call: 'TELEFONO', cc: 'TELEFONO', sportello: 'SPORTELLO', banco: 'SPORTELLO', desk: 'SPORTELLO', mmg: 'MMG', medico: 'MMG', cup: 'CUP', azienda: 'AZIENDA' };
const normChannel = (v) => { const s = norm(v); if (!s) return null; for (const k of Object.keys(CH)) if (s.includes(k)) return CH[k]; return S(v).toUpperCase().slice(0, 30); };

// ---- esecuzione dell'import ----
export async function runImport({ source, dataset, buffer, filename, mapping, userId, dryRun = false, defaultSiteCode = null }) {
  const def = DATASETS[dataset]; if (!def) throw bad('Dataset sconosciuto');
  const { headers, rows } = await parseFile(buffer, filename, { multiSheet: Boolean(def.multiSheet), keyHeader: def.multiSheet ? def.multiSheet : null });
  const map = mapping && Object.keys(mapping).length ? mapping : autoMap(dataset, headers);
  for (const [key, label, req] of def.fields) if (req && !map[key]) throw bad(`Colonna obbligatoria non mappata: ${label}`);
  for (const [k, h] of Object.entries(map)) if (h && !headers.includes(h)) throw bad(`La colonna "${h}" (${k}) non esiste nel file`);
  const g = (row, key) => (map[key] ? row[map[key]] : null);
  const errors = []; let ok = 0; let skipped = 0;
  const sites = await many('SELECT id, code, name, gipo_site_code, studiolab_code FROM sites_v WHERE active');
  const defaultSite = defaultSiteCode ? sites.find((x) => norm(x.code) === norm(defaultSiteCode)) || null : null;
  // riconoscimento della sede: codice Suite, codici nei gestionali (GIPO, StudioLab, impostazioni Retail della sede), poi nome
  const siteFind = (v) => { const s = norm(v); if (!s) return defaultSite; return sites.find((x) => norm(x.code) === s) || sites.find((x) => x.gipo_site_code && norm(x.gipo_site_code) === s) || sites.find((x) => x.studiolab_code && norm(x.studiolab_code) === s) || sites.find((x) => norm(x.name) === s) || sites.find((x) => norm(x.name).includes(s) || s.includes(norm(x.code))) || null; };
  const lines = Object.fromEntries((await many('SELECT id, code, name FROM product_lines')).map((l) => [norm(l.code), l.id]));
  const lineGuess = (specialty, desc) => {
    const s = norm(`${specialty || ''} ${desc || ''}`);
    if (/medicina_del_lavoro|sorveglianza|preassunt|audiometr|spirometr|tossicolog/.test(s)) return lines.mdl;
    if (/pacchetto|check_up|checkup|profilo/.test(s)) return lines.pac;
    if (/risonanza|tomografia|mammograf|ecograf|doppler|radiolog|rx_|_rx|moc|densitometr|elettromiograf|tac|imaging|senolog/.test(s)) return lines.img;
    if (/patologia_clinica|chimica|microbiolog|ematolog|laborator|biologia_molecolare|anatomia_patologica|allergolog|immunolog|urine|sangue|emocromo/.test(s)) return lines.lab;
    if (/visita|specialist|cardiolog|dermatolog|ortoped|ginecolog|urolog|neurolog|endoscop|oculist|otorino|fisiatr|nutriz|gastro|endocrin|pneumolog|angiolog|chirurg/.test(s)) return lines.spec;
    return null;
  };

  const res = await tx(async (c) => {
    let batchId = null;
    if (!dryRun) {
      batchId = (await c.query('INSERT INTO import_batches(source, dataset, filename, mapping, rows_total, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [source, dataset, filename, JSON.stringify(map), rows.length, userId, 'IN_CORSO'])).rows[0].id;
      await c.query('INSERT INTO import_mappings(source, dataset, mapping) VALUES ($1,$2,$3) ON CONFLICT (source, dataset) DO UPDATE SET mapping=EXCLUDED.mapping, updated_at=now()', [source, dataset, JSON.stringify(map)]);
    }
    const custCache = new Map(); const prodCache = new Map(); const costSeen = new Map(); const touched = new Set();
    const upsertCustomer = async (d) => {
      const key = d.external_code ? `c:${d.external_code}` : d.external_id ? `x:${d.source}:${d.external_id}` : d.tax_code ? `cf:${d.tax_code}` : d.vat_number ? `vat:${d.vat_number}` : d.company_name ? `co:${norm(d.company_name)}` : d.last_name && d.first_name && d.birth_date ? `nm:${norm(d.last_name)}:${norm(d.first_name)}:${d.birth_date}` : null;
      if (!key) return null;
      if (custCache.has(key)) return custCache.get(key);
      let row = null;
      if (d.external_code) row = (await c.query('SELECT id FROM customers WHERE external_code=$1', [d.external_code])).rows[0];
      if (!row && d.external_id) row = (await c.query('SELECT id FROM customers WHERE source=$1 AND external_id=$2', [d.source, d.external_id])).rows[0];
      if (!row && d.tax_code) row = (await c.query('SELECT id FROM customers WHERE upper(tax_code)=upper($1)', [d.tax_code])).rows[0];
      if (!row && d.vat_number) row = (await c.query('SELECT id FROM customers WHERE vat_number=$1', [d.vat_number])).rows[0];
      if (!row && d.kind === 'B2B' && d.company_name) row = (await c.query('SELECT id FROM customers WHERE kind=\'B2B\' AND lower(company_name)=lower($1)', [d.company_name])).rows[0];
      if (!row && d.kind === 'B2C' && d.last_name && d.first_name && d.birth_date) row = (await c.query('SELECT id FROM customers WHERE kind=\'B2C\' AND lower(last_name)=lower($1) AND lower(first_name)=lower($2) AND birth_date=$3', [d.last_name, d.first_name, d.birth_date])).rows[0];
      const cols = ['last_name', 'first_name', 'sex', 'birth_date', 'tax_code', 'email', 'phone', 'address', 'zip', 'city', 'province', 'marketing_consent', 'acquisition_channel', 'company_name', 'vat_number', 'sector', 'contact_name', 'employees', 'home_site_id', 'external_code', 'group_name', 'b2b_type'];
      if (row) {
        if (!dryRun) {
          const set = cols.filter((k) => d[k] != null && d[k] !== '');
          if (set.length) await c.query(`UPDATE customers SET ${set.map((k, i) => `${k}=coalesce(${k}, $${i + 2})`).join(', ')}, updated_at=now() WHERE id=$1`, [row.id, ...set.map((k) => d[k])]);
          if (d.external_id) await c.query('UPDATE customers SET external_id=coalesce(external_id,$2), source=CASE WHEN external_id IS NULL THEN $3 ELSE source END WHERE id=$1', [row.id, d.external_id, d.source]);
        }
        custCache.set(key, row.id); touched.add(row.id); return row.id;
      }
      if (dryRun) { custCache.set(key, -1); return -1; }
      const ins = await c.query(`INSERT INTO customers(kind, source, external_id, ${cols.join(',')}) VALUES ($1,$2,$3,${cols.map((_, i) => `$${i + 4}`).join(',')}) RETURNING id`, [d.kind, d.source, d.external_id || null, ...cols.map((k) => d[k] ?? null)]);
      custCache.set(key, ins.rows[0].id); touched.add(ins.rows[0].id); return ins.rows[0].id;
    };
    const upsertProduct = async (d) => {
      const code = S(d.code); if (!code) return null;
      const k = code.toUpperCase();
      const refresh = ['PRODUCTS', 'CATALOG_STUDIOLAB', 'COSTS'].includes(dataset); // stesso codice su più fogli/righe: l'ultima riga aggiorna (un costo 0 non sovrascrive un costo valorizzato)
      if (prodCache.has(k) && !refresh) return prodCache.get(k);
      if (dataset === 'COSTS' && d.cost === 0 && (costSeen.get(k) || 0) > 0) delete d.cost;
      if (dataset === 'COSTS' && d.cost > 0) costSeen.set(k, d.cost);
      const row = prodCache.has(k) ? { id: prodCache.get(k) } : (await c.query('SELECT id FROM products WHERE upper(code)=$1', [k])).rows[0];
      const PCOLS = ['description', 'specialty', 'line_id', 'price', 'price_ssn', 'cost', 'duration_min', 'nomenclature', 'periodicity_months', 'sector', 'sector_clinical', 'destination', 'price_mdl', 'price_service', 'cost_service', 'cost_source', 'cost_updated_at', 'is_vet', 'active', 'exclude_from_counts'];
      if (row) {
        if (!dryRun && ['PRODUCTS', 'CATALOG_STUDIOLAB', 'COSTS'].includes(dataset)) {
          // il catalogo aggiorna i dati anagrafici; la distinta base aggiorna solo i costi (e completa il resto se mancante)
          const set = PCOLS.filter((x) => d[x] != null && !(dataset === 'COSTS' && ['description', 'line_id'].includes(x)));
          const soft = dataset === 'COSTS' ? ['sector_clinical', 'destination', 'specialty'] : [];
          if (set.length) await c.query(`UPDATE products SET ${set.map((x, i) => (soft.includes(x) ? `${x}=coalesce(${x}, $${i + 2})` : `${x}=$${i + 2}`)).join(', ')}, updated_at=now() WHERE id=$1`, [row.id, ...set.map((x) => d[x])]);
        }
        prodCache.set(k, row.id); return row.id;
      }
      if (dryRun) { prodCache.set(k, -1); return -1; }
      const cols = PCOLS.filter((x) => d[x] != null);
      const ins = await c.query(`INSERT INTO products(code, source${cols.map((x) => `, ${x}`).join('')}${cols.includes('description') ? '' : ', description'}) VALUES ($1,$2${cols.map((_, i) => `,$${i + 3}`).join('')}${cols.includes('description') ? '' : `,$${cols.length + 3}`}) RETURNING id`,
        [code, source, ...cols.map((x) => d[x]), ...(cols.includes('description') ? [] : [code])]);
      prodCache.set(k, ins.rows[0].id); return ins.rows[0].id;
    };

    const campaignsByCode = Object.fromEntries((await c.query("SELECT id, upper(promo_code) AS code FROM campaigns WHERE promo_code IS NOT NULL")).rows.map((x) => [x.code, x.id]));
    const promosByCode = Object.fromEntries((await c.query("SELECT id, upper(promo_code) AS code FROM promotions WHERE promo_code IS NOT NULL")).rows.map((x) => [x.code, x.id]));
    const lineCounter = new Map();
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      try {
        if (dataset === 'PRODUCTS') {
          const specialty = S(g(row, 'specialty')); const desc = S(g(row, 'description'));
          const lc = norm(g(row, 'line_code'));
          await upsertProduct({ code: g(row, 'code'), description: desc, specialty, line_id: lines[lc] || lineGuess(specialty, desc), price: toNum(g(row, 'price')), price_ssn: toNum(g(row, 'price_ssn')), cost: toNum(g(row, 'cost')), duration_min: toNum(g(row, 'duration_min')), nomenclature: S(g(row, 'nomenclature')), periodicity_months: toNum(g(row, 'periodicity_months')) });
          ok++; continue;
        }
        if (dataset === 'CATALOG_STUDIOLAB') {
          const code = S(g(row, 'code')); if (!code) { skipped++; errors.push(`Riga ${line}: codice esame mancante`); continue; }
          const sector = S(g(row, 'sector')); const sectorClinical = S(g(row, 'sector_clinical'));
          const desc = S(g(row, 'description')) || S(g(row, 'description_short')) || code;
          await upsertProduct({ code, description: desc, specialty: sectorClinical || sector, sector: sector || sectorClinical || 'Altro', sector_clinical: sectorClinical, destination: S(g(row, 'destination')), line_id: lines.lab,
            price: toNum(g(row, 'price')), price_mdl: toNum(g(row, 'price_mdl')), price_service: toNum(g(row, 'price_service')), price_ssn: toNum(g(row, 'price_ssn')) || null, nomenclature: S(g(row, 'nomenclature')),
            is_vet: toBool(g(row, 'is_vet')) ?? (String(g(row, 'is_vet')) === 'true'), active: !(toBool(g(row, 'non_usato')) ?? (String(g(row, 'non_usato')) === 'true')), exclude_from_counts: code.toUpperCase() === 'IND' ? true : null });
          ok++; continue;
        }
        if (dataset === 'COSTS') {
          const code = S(g(row, 'code')); if (!code) { skipped++; continue; }
          const cost = toNum(g(row, 'cost'));
          if (cost == null) { skipped++; errors.push(`Riga ${line} (${row.__sheet || ''}): costo mancante per ${code}`); continue; }
          await upsertProduct({ code, description: S(g(row, 'description')), cost: Math.round(cost * 10000) / 10000, cost_service: toNum(g(row, 'cost_service')), cost_source: 'DISTINTA', cost_updated_at: new Date(), sector_clinical: S(g(row, 'sector_clinical')), destination: S(g(row, 'destination')), line_id: lines.lab });
          ok++; continue;
        }
        if (dataset === 'CUSTOMERS') {
          const company = S(g(row, 'company_name')); const vat = S(g(row, 'vat_number'));
          const cf = S(g(row, 'tax_code'))?.toUpperCase() || null;
          const id = await upsertCustomer({ kind: company || vat ? 'B2B' : 'B2C', source, external_id: S(g(row, 'external_id')), tax_code: cf, last_name: S(g(row, 'last_name')), first_name: S(g(row, 'first_name')), sex: toSex(g(row, 'sex')) || sexFromCf(cf), birth_date: toDate(g(row, 'birth_date')) || birthFromCf(cf), email: S(g(row, 'email')), phone: S(g(row, 'phone')), address: S(g(row, 'address')), zip: S(g(row, 'zip')), city: S(g(row, 'city')), province: S(g(row, 'province'))?.toUpperCase().slice(0, 2), marketing_consent: toBool(g(row, 'marketing_consent')), acquisition_channel: normChannel(g(row, 'acquisition_channel')), company_name: company, vat_number: vat, sector: S(g(row, 'sector')), contact_name: S(g(row, 'contact_name')), employees: toNum(g(row, 'employees')) });
          if (id == null) { skipped++; errors.push(`Riga ${line}: cliente non identificabile (serve ID, codice fiscale, partita IVA o nome+cognome+data di nascita)`); } else ok++;
          continue;
        }
        // SALES
        const extRef = S(g(row, 'external_ref')); const date = toDate(g(row, 'sale_date'));
        if (!extRef) { skipped++; errors.push(`Riga ${line}: numero accettazione mancante`); continue; }
        if (!date) { skipped++; errors.push(`Riga ${line}: data non valida (${g(row, 'sale_date')})`); continue; }
        let lineNo = toNum(g(row, 'line_no'));
        if (!lineNo) { lineNo = (lineCounter.get(extRef) || 0) + 1; lineCounter.set(extRef, lineNo); }
        const company = S(g(row, 'b2b_company')); const vat = S(g(row, 'b2b_vat'));
        const cf = S(g(row, 'customer_tax_code'))?.toUpperCase() || null;
        const siteRow = siteFind(g(row, 'site_code')) || defaultSite;
        let customerId = null; let b2bId = null; let patientRef = null; let patientSex = null; let patientBirth = null;
        const b2bCode = S(g(row, 'b2b_code'))?.toUpperCase() || null;
        if (company || vat || b2bCode) {
          // gruppo: "Casa di Cura X - Reparto" -> gruppo "Casa di Cura X"; clienti interni (TD, CONV) marcati INTERNO
          const groupName = company && company.includes(' - ') ? company.split(' - ')[0].trim() : null;
          const internal = b2bCode && /^(TD|CONV)/.test(b2bCode);
          const b2bType = internal ? 'INTERNO' : b2bCode && /^MDL/.test(b2bCode) ? 'AZIENDA' : /farmacia|apotheke/i.test(company || '') ? 'FARMACIA' : /veterinar|vet\b/i.test(company || '') ? 'VETERINARIO' : /casa di cura|ospedale|clinica|fondazione|centro medico|poliambulatorio|misericordia|istituto|surgery|s\.r\.l\.|srl|s\.p\.a|spa|inc|snc|s\.n\.c/i.test(company || '') ? 'STRUTTURA' : /dott|prof|biolog|nutrizion/i.test(company || '') ? 'MMG' : null;
          b2bId = await upsertCustomer({ kind: 'B2B', source, external_id: null, external_code: b2bCode, company_name: company || b2bCode, vat_number: vat, group_name: groupName, b2b_type: b2bType });
          // paziente finale del cliente B2B: non diventa un cliente B2C, resta un riferimento per contare i pazienti distinti
          const ln = S(g(row, 'customer_last_name')); const fn = S(g(row, 'customer_first_name'));
          patientBirth = toDate(g(row, 'customer_birth_date')) || birthFromCf(cf);
          patientSex = toSex(g(row, 'customer_sex')) || sexFromCf(cf);
          patientRef = cf || (ln && fn ? `${ln} ${fn} ${patientBirth || ''}`.trim().toUpperCase() : null);
        } else if (cf || S(g(row, 'customer_external_id')) || (S(g(row, 'customer_last_name')) && S(g(row, 'customer_first_name')))) {
          customerId = await upsertCustomer({ kind: 'B2C', source, external_id: S(g(row, 'customer_external_id')), tax_code: cf, last_name: S(g(row, 'customer_last_name')), first_name: S(g(row, 'customer_first_name')), sex: toSex(g(row, 'customer_sex')) || sexFromCf(cf), birth_date: toDate(g(row, 'customer_birth_date')) || birthFromCf(cf), email: S(g(row, 'customer_email')), phone: S(g(row, 'customer_phone')), city: S(g(row, 'customer_city')), province: S(g(row, 'customer_province'))?.toUpperCase().slice(0, 2), zip: S(g(row, 'customer_zip')), home_site_id: siteRow?.id || null, acquisition_channel: normChannel(g(row, 'booking_channel')) });
        }
        const code = S(g(row, 'product_code')); const desc = S(g(row, 'product_desc'));
        const productId = code ? await upsertProduct({ code, description: desc, line_id: source === 'STUDIOLAB' ? lines.lab : lineGuess(null, desc), exclude_from_counts: code.toUpperCase() === 'IND' ? true : null }) : null;
        const qty = toNum(g(row, 'quantity')) || 1;
        let gross = toNum(g(row, 'gross_amount')); let disc = toNum(g(row, 'discount')); let net = toNum(g(row, 'net_amount'));
        if (net == null && gross != null) net = Math.round((gross - (disc || 0)) * 100) / 100;
        if (gross == null && net != null) gross = Math.round((net + (disc || 0)) * 100) / 100;
        if (disc == null) disc = gross != null && net != null ? Math.round((gross - net) * 100) / 100 : 0;
        const promo = S(g(row, 'promo_code'))?.toUpperCase() || null;
        if (!dryRun) {
          await c.query(`INSERT INTO sales(source, external_ref, line_no, sale_date, sale_time, customer_id, b2b_customer_id, site_id, product_id, product_code, product_desc, quantity, gross_amount, discount, net_amount, payment_kind, booking_channel, referrer, promo_code, campaign_id, promotion_id, import_batch_id, operator, patient_ref, invoice_ref, patient_sex, patient_birth_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
            ON CONFLICT (source, external_ref, line_no) WHERE external_ref IS NOT NULL AND external_ref <> '' DO UPDATE SET sale_date=EXCLUDED.sale_date, customer_id=coalesce(EXCLUDED.customer_id, sales.customer_id), b2b_customer_id=coalesce(EXCLUDED.b2b_customer_id, sales.b2b_customer_id), site_id=coalesce(EXCLUDED.site_id, sales.site_id), product_id=coalesce(EXCLUDED.product_id, sales.product_id), quantity=EXCLUDED.quantity, gross_amount=EXCLUDED.gross_amount, discount=EXCLUDED.discount, net_amount=EXCLUDED.net_amount, payment_kind=coalesce(EXCLUDED.payment_kind, sales.payment_kind), booking_channel=coalesce(EXCLUDED.booking_channel, sales.booking_channel), import_batch_id=EXCLUDED.import_batch_id, operator=coalesce(EXCLUDED.operator, sales.operator), patient_ref=coalesce(EXCLUDED.patient_ref, sales.patient_ref), invoice_ref=coalesce(EXCLUDED.invoice_ref, sales.invoice_ref), patient_sex=coalesce(EXCLUDED.patient_sex, sales.patient_sex), patient_birth_date=coalesce(EXCLUDED.patient_birth_date, sales.patient_birth_date)`,
            [source, extRef, lineNo, date, toTime(g(row, 'sale_time')), customerId, b2bId, siteRow?.id || null, productId, code, desc, qty, gross ?? 0, disc ?? 0, net ?? 0, b2bId && !customerId ? 'AZIENDA' : normPay(g(row, 'payment_kind')), normChannel(g(row, 'booking_channel')), S(g(row, 'referrer')), promo, promo ? campaignsByCode[promo] || null : null, promo ? promosByCode[promo] || null : null, batchId, S(g(row, 'operator')), patientRef, S(g(row, 'invoice_ref')), patientSex, patientBirth]);
        }
        ok++;
      } catch (e) {
        skipped++; errors.push(`Riga ${line}: ${e.message}`);
        if (errors.length > 500) throw bad('Troppi errori: import interrotto', errors.slice(0, 50));
      }
    }
    if (!dryRun) {
      await c.query('UPDATE import_batches SET rows_ok=$2, rows_skipped=$3, errors=$4, status=$5 WHERE id=$1', [batchId, ok, skipped, JSON.stringify(errors.slice(0, 200)), skipped && !ok ? 'ERRORE' : 'OK']);
      await c.query(`UPDATE campaigns c SET bookings = s.n FROM (SELECT campaign_id, count(DISTINCT external_ref)::int AS n FROM sales WHERE campaign_id IS NOT NULL GROUP BY campaign_id) s WHERE s.campaign_id = c.id`);
    }
    return { batchId, touched: [...touched] };
  });
  if (!dryRun) await refreshCustomerStats(res.touched.length && res.touched.length < 5000 ? res.touched : null);
  return { batch_id: res.batchId, rows_total: rows.length, rows_ok: ok, rows_skipped: skipped, errors: errors.slice(0, 200), mapping: map, headers, dry_run: dryRun };
}

export async function savedMapping(source, dataset) {
  const r = await one('SELECT mapping FROM import_mappings WHERE source=$1 AND dataset=$2', [source, dataset]);
  return r?.mapping || null;
}
