// Regole dei poteri (delibere CdA n. 11 dell'8 ottobre 2026 e n. 12 del 14 ottobre 2026),
// impronta del contenuto firmato, validazione IBAN, importo in lettere.
import crypto from 'node:crypto';
import { many } from '../db.js';
import { getCompany } from '../../../lib/company.js';

export const DEFAULT_SETTINGS = {
  company_name: 'Toscana Diagnostica S.r.l.',
  threshold_single: '50000',   // fino a: firma singola AD o CFO
  threshold_joint: '250000',   // fino a: firma congiunta AD + CFO; oltre: delibera CdA + firma congiunta
  form_title_joint: 'AUTORIZZAZIONE CONGIUNTA AL PAGAMENTO',
  form_title_single: 'AUTORIZZAZIONE AL PAGAMENTO',
  form_ref: 'ai sensi della deliberazione del Consiglio di Amministrazione n. 11 dell’8 ottobre 2026 (Punto 2, lett. D e Punto 4) e della deliberazione n. 12 del 14 ottobre 2026 (Punto 2, procura al Chief Financial Officer)',
  auth_text: 'I sottoscritti, nelle rispettive qualità di Amministratore Delegato e di Chief Financial Officer di Toscana Diagnostica S.r.l., verificata la sussistenza dei presupposti sopra indicati, AUTORIZZANO l’esecuzione del pagamento descritto alla Sezione 1, nei limiti dei poteri conferiti con le deliberazioni del Consiglio di Amministrazione richiamate in epigrafe. Per le operazioni di importo superiore alla soglia di firma singola, l’operazione non ha efficacia vincolante per la Società in assenza della firma di entrambi. La firma è apposta in forma elettronica mediante accesso autenticato Microsoft 365 al link personale ricevuto all’indirizzo aziendale; data, ora, identità e impronta del contenuto sono registrate dal sistema.',
  aggregation_days: '90',      // finestra di controllo anti-frazionamento (stessa controparte)
  token_days: '15',            // validità del link di firma
  reminder_days: '2',          // sollecito automatico ai firmatari dopo n giorni
  mail_cc: '',                 // copia conoscenza su tutte le mail (es. amministrazione@)
  protocol_prefix: 'AP',
  // Scadenziario strutture (affitti e utenze): anticipo degli avvisi, ipotesi della previsione, profili avvisati
  schedule_alert_days: '7',
  schedule_istat_pct: '1.5',
  schedule_utility_growth_pct: '0',
  schedule_notify_roles: 'CEO,CFO,SUPPORT',
};

// Chiavi che vengono dai Dati aziendali della Suite (Amministrazione > Impostazioni, docs/IMPOSTAZIONI.md): qui in sola lettura
export const CORE_KEYS = ['company_name'];
export async function getSettings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  const co = await getCompany();
  s.company_name = co.legal_name;   // la ragione sociale è della Suite
  s.company = co;
  return s;
}

export const TIER_LABEL = { SINGOLA: 'Firma singola', CONGIUNTA: 'Firma congiunta AD + CFO', CDA: 'Delibera CdA + firma congiunta' };

// Scaglione applicabile all'importo
export function computeTier(amount, s) {
  const a = Number(amount);
  if (a <= Number(s.threshold_single)) return 'SINGOLA';
  if (a <= Number(s.threshold_joint)) return 'CONGIUNTA';
  return 'CDA';
}

// Firme richieste per l'istanza
export function requiredSigners(r) {
  if (r.tier === 'SINGOLA') return r.single_signer ? [r.single_signer] : [];
  return ['CEO', 'CFO'];
}

// Campi che compongono il contenuto firmato (qualunque modifica cambia l'impronta e invalida i link)
export const SIGNED_FIELDS = ['protocol', 'request_date', 'requester', 'cost_center', 'beneficiary_name', 'beneficiary_tax_id', 'beneficiary_iban', 'beneficiary_bic', 'beneficiary_bank', 'amount', 'purpose', 'doc_type', 'doc_other', 'doc_number', 'doc_date', 'debit_account', 'payment_method', 'payment_method_other', 'value_date', 'tier', 'single_signer', 'board_number', 'board_date', 'prior_approval', 'prior_approval_ref', 'checks', 'new_iban', 'iban_verified_note', 'notes'];

export function contentHash(r) {
  const o = {};
  for (const k of SIGNED_FIELDS) {
    let v = r[k];
    if (v === undefined) v = null;
    if (k === 'amount' && v != null) v = Number(v).toFixed(2);
    if (k === 'checks') v = Object.fromEntries(Object.entries(v || {}).sort());
    o[k] = v;
  }
  o.version = r.version;
  return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
}

// IBAN: formato e controllo mod 97
export function normalizeIban(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
export function validIban(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < digits.length; i += 7) rem = Number(String(rem) + digits.slice(i, i + 7)) % 97;
  return rem === 1;
}

// Importo in lettere (italiano), es. 125.430,50 -> "centoventicinquemilaquattrocentotrenta/50"
const UNITS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
function below1000(n) {
  let s = '';
  const h = Math.floor(n / 100); const r = n % 100;
  if (h === 1) s = 'cento'; else if (h > 1) s = UNITS[h] + 'cento';
  if (r < 20) s += UNITS[r];
  else {
    let t = TENS[Math.floor(r / 10)]; const u = r % 10;
    if (u === 1 || u === 8) t = t.slice(0, -1); // ventuno, ventotto
    s += t + UNITS[u];
  }
  return s;
}
export function amountToWords(amount) {
  const n = Math.round(Number(amount) * 100);
  const int = Math.floor(n / 100); const cents = n % 100;
  let s = '';
  if (int === 0) s = 'zero';
  else {
    const millions = Math.floor(int / 1e6); const thousands = Math.floor((int % 1e6) / 1000); const rest = int % 1000;
    if (millions === 1) s += 'unmilione'; else if (millions > 1) s += below1000(millions) + 'milioni';
    if (thousands === 1) s += 'mille'; else if (thousands > 1) s += below1000(thousands) + 'mila';
    s += below1000(rest);
  }
  return `${s}/${String(cents).padStart(2, '0')}`;
}

export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
