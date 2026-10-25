// Impostazioni predefinite, etichette, regole dei contratti e del fascicolo
import { many } from '../db.js';

export const DEFAULT_SETTINGS = {
  // Società
  company_name: 'Toscana Diagnostica S.r.l.',
  company_legal_address: 'Sesto Fiorentino (FI), Via di Pratignone, 13/4',
  company_capital: '€ 50.000,00 i.v.',
  company_city: 'Firenze',
  company_prov: 'FI',
  company_vat: '07528130482',
  company_tax_code: '07528130482',
  company_phone: '055776511',
  company_fax: '055776511',
  company_pec: 'toscanadiagnostica@pec.it',
  lab_address: 'Sesto Fiorentino (FI), via di Pratignone, 13/4',
  // Legale rappresentante (i dati anagrafici vanno completati in Impostazioni: compaiono nei Modelli 5 e nelle dichiarazioni)
  lr_name: 'Francesco Epifani',
  lr_title: 'dott.',
  lr_role: 'Chief Executive Officer',
  lr_role_it: 'Amministratore Delegato',
  lr_birth_place: '',
  lr_birth_date: '',
  lr_residence: '',
  lr_tax_code: '',
  lr_phone: '',
  lr_email: 'francesco.epifani@toscanadiagnostica.it',
  // Direttore Sanitario (Modello 6)
  ds_name: 'Gian Luigi Taddei',
  ds_title: 'prof.',
  ds_birth_place: '',
  ds_birth_date: '',
  ds_residence: '',
  ds_tax_code: '',
  ds_phone: '055776511',
  ds_email: 'info@toscanadiagnostica.it',
  ds_degree: 'Laurea in Medicina e Chirurgia conseguita presso Università degli Studi di Firenze in data 7 novembre 1972',
  ds_specialization: 'Specialistica in Anatomia Patologica e Tecniche di Laboratorio conseguita presso Università di Parma in data 27 luglio 1977',
  ds_registration: 'Iscrizione all’Ordine Provinciale dei Medici Chirurghi e degli Odontoiatri di Firenze al numero 4732 dal 09/09/1974',
  ds_weekly_hours: '40',
  // Sicurezza (DVR, DUVRI)
  rspp_name: 'Iacopo Cupelli',
  rls_name: 'Sara Arrighetti',
  mc_name: 'Vincenzo Cupelli',
  // Contratti
  protocol_prefix_PP: 'PP',
  protocol_prefix_SRV: 'SRV',
  protocol_prefix_MDL: 'MDL',
  protocol_prefix_SEDE: 'SEDE',
  pp_duration_years: '3',
  payment_terms_default: 'Bonifico bancario 30 gg fm da emissione fattura',
  portal_url_default: 'https://portale.toscanadiagnostica.it',
  // Testi
  dirty_clean_default: 'che gli stessi sono localizzati all’interno della stanza in cui avvengono le prestazioni sanitarie.',
  duvri_costs_default: 'Non sono stati identificati rischi di interferenza, pertanto i costi sono pari a 0 Euro.',
};

export async function getSettings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export const KIND = {
  PP: { label: 'Punto Prelievi', long: 'Contratto di appalto per punto prelievi decentrato', role: 'RETAIL' },
  SRV: { label: 'Service di Laboratorio', long: 'Lettera di offerta per esecuzione di esami di laboratorio in service (TD-SGI-MOD230)', role: 'SERVICE' },
  MDL: { label: 'Medicina del Lavoro', long: 'Lettera di offerta per prestazioni di Medicina del Lavoro (TD-SGI-MOD231)', role: 'MDL' },
  SEDE: { label: 'Sede TD in locazione', long: 'Sede intestata a Toscana Diagnostica con contratto di locazione (laboratorio, punto prelievi o centro polidiagnostico flagship)', role: 'RETAIL' },
};
export const HAS_DOSSIER = (kind) => kind === 'PP' || kind === 'SEDE';
export const SITE_TYPE = { LABORATORIO: 'Laboratorio di Analisi', PUNTO_PRELIEVI: 'Punto Prelievi', CENTRO_POLIDIAGNOSTICO: 'Centro Polidiagnostico', ALTRO: 'Altra sede' };

export const STATUS_FLOW = ['BOZZA', 'PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO', 'ANNULLATO'];

// Chi può modificare i contratti di una sezione: Superamministratore e il manager della sezione
export function canEditKind(user, kind) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return KIND[kind]?.role === user.role;
}
// Il fascicolo di autorizzazione dei punti prelievi: Superamministratore, HQS Manager e Retail Manager
export function canEditDossier(user) {
  return ['ADMIN', 'HQS', 'RETAIL'].includes(user?.role);
}

// Numero in lettere per la durata (1..10 anni)
const YEARS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'];
export const yearsWords = (n) => YEARS[Number(n)] || String(n);

export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
export const pct = (n) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(n || 0))}%`;

// Clausola del corrispettivo del punto prelievi (art. 5.1): elenco di condizioni, una per sotto-articolo (5.1.1, 5.1.2, ...)
const PERIOD = { MESE: 'al mese', TRIMESTRE: 'a trimestre', ANNO: 'all’anno', UNA_TANTUM: 'una tantum' };
const VAT = { PIU_IVA: 'oltre IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente IVA ai sensi dell’art. 10 D.P.R. 633/1972' };
export const FEE_BASE_TEXT = {
  PUNTO_PRELIEVI: 'del fatturato generato dal Punto Prelievi',
  CENTRO_DIAGNOSTICO: 'del fatturato generato dal Centro Diagnostico (Medicina Specialistica, Diagnostica per Immagini)',
  POLIAMBULATORIO: 'del fatturato generato dall’attività poliambulatoriale',
};
const CLOSING = ' Detto corrispettivo costituisce una remunerazione complessiva ed onnicomprensiva per la prestazione dei Servizi da parte della Società.';
const endDot = (t) => (/[.;]$/.test(t) ? t : `${t}.`);
export function feeItemText(it = {}) {
  const vat = VAT[it.vat] || VAT.PIU_IVA;
  let t;
  if (it.kind === 'PERCENT') {
    const base = it.base === 'ALTRO' ? (it.base_other || '').trim() : FEE_BASE_TEXT[it.base] || FEE_BASE_TEXT.PUNTO_PRELIEVI;
    t = `${pct(it.percent)} (${pctWords(it.percent)} per cento) ${vat} ${base}${it.include_ssr ? ', ivi comprese le prestazioni effettuate a vantaggio del SSR' : ''}`;
  } else if (it.kind === 'FIXED') {
    t = `Euro ${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(Number(it.amount || 0))} (${amountWords(it.amount).replace(/^euro /, '')}) ${vat} ${PERIOD[it.period] || PERIOD.MESE}${(it.purpose || '').trim() ? ` ${it.purpose.trim()}` : ''}`;
  } else if (it.kind === 'MINIMUM') {
    t = `In ogni caso è garantito alla Società un corrispettivo minimo di Euro ${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(Number(it.amount || 0))} (${amountWords(it.amount).replace(/^euro /, '')}) ${vat} ${PERIOD[it.period] || PERIOD.MESE}${(it.purpose || '').trim() ? ` ${it.purpose.trim()}` : ''}`;
  } else {
    t = (it.text || '').trim();
  }
  t = endDot(t);
  if (it.kind !== 'TEXT' && (it.text || '').trim()) t += ` ${endDot(it.text.trim())}`;
  if (it.closing && it.kind !== 'TEXT') t += CLOSING;
  return t;
}
export function feeItems(fee = {}) {
  const items = (fee.items || []).map((it) => ({ text: feeItemText(it) }));
  return items.length ? items : [{ text: '[corrispettivo da definire].' }];
}

const UNITS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
function below1000(n) {
  let s = '';
  const h = Math.floor(n / 100); const r = n % 100;
  if (h === 1) s = 'cento'; else if (h > 1) s = UNITS[h] + 'cento';
  if (r < 20) s += UNITS[r];
  else { let t = TENS[Math.floor(r / 10)]; const u = r % 10; if (u === 1 || u === 8) t = t.slice(0, -1); s += t + UNITS[u]; }
  return s;
}
export function intWords(int) {
  if (int === 0) return 'zero';
  let s = '';
  const millions = Math.floor(int / 1e6); const thousands = Math.floor((int % 1e6) / 1000); const rest = int % 1000;
  if (millions === 1) s += 'unmilione'; else if (millions > 1) s += below1000(millions) + 'milioni';
  if (thousands === 1) s += 'mille'; else if (thousands > 1) s += below1000(thousands) + 'mila';
  return s + below1000(rest);
}
export function amountWords(amount) {
  const n = Math.round(Number(amount) * 100);
  return `euro ${intWords(Math.floor(n / 100))}/${String(n % 100).padStart(2, '0')}`;
}
export function pctWords(p) {
  const n = Math.round(Number(p) * 100);
  const int = Math.floor(n / 100); const dec = n % 100;
  return dec ? `${intWords(int)} virgola ${intWords(dec)}` : intWords(int);
}
