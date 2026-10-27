// Dati aziendali di Toscana Diagnostica (app_settings.company, editor in Amministrazione > Impostazioni > Dati aziendali).
// Tutti i moduli che stampano carte intestate, piè di pagina, firme o intestazioni li leggono da qui (business, finance,
// shipments, circolari, contracts, orgchartExport, ticket, retail, orders). Le costanti DEFAULT_COMPANY restano solo come
// ripiego se la chiave manca o un campo è vuoto.
import { getSetting } from './util.js';

export const DEFAULT_COMPANY = {
  name: 'Toscana Diagnostica',
  legal_name: 'Toscana Diagnostica S.r.l.',
  vat: '07528130482',
  tax_code: '07528130482',
  rea: 'FI-709602',
  share_capital: '€ 50.000,00 i.v.',
  address: 'Via di Pratignone, 13/4',
  zip: '50019',
  city: 'Sesto Fiorentino',
  province: 'FI',
  phone: '055776511',
  fax: '055776511',
  email: 'info@toscanadiagnostica.it',
  pec: 'toscanadiagnostica@pec.it',
  website: 'www.toscanadiagnostica.it',
  health_director: 'prof. Gian Luigi Taddei',
  footer: '',
};

// Etichette e aiuto per l'editor di Amministrazione (stesso ordine della scheda)
export const COMPANY_FIELDS = [
  ['legal_name', 'Ragione sociale', 'Come compare in carta intestata e contratti (es. Toscana Diagnostica S.r.l.).'],
  ['name', 'Nome breve', 'Nome commerciale, senza forma giuridica.'],
  ['vat', 'Partita IVA', ''], ['tax_code', 'Codice fiscale', ''], ['rea', 'REA', 'Es. FI-709602.'], ['share_capital', 'Capitale sociale', 'Es. € 50.000,00 i.v.'],
  ['address', 'Indirizzo della sede legale', 'Via e civico.'], ['zip', 'CAP', ''], ['city', 'Città', ''], ['province', 'Provincia', 'Sigla.'],
  ['phone', 'Telefono', ''], ['fax', 'Fax', ''], ['email', 'Email', ''], ['pec', 'PEC', ''], ['website', 'Sito web', ''],
  ['health_director', 'Direttore Sanitario', 'Con il titolo, es. prof. Gian Luigi Taddei.'],
  ['footer', 'Piè di pagina della carta intestata', 'Testo libero su più righe. Se vuoto viene composto dagli altri campi.'],
];

// Indirizzo completo "Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)"
export const companyAddress = (c) => [c.address, [c.zip, c.city].filter(Boolean).join(' ') + (c.province ? ` (${c.province})` : '')].filter((x) => x && x.trim()).join(', ');

// Piè di pagina composto dai campi (usato quando footer è vuoto)
export function companyFooter(c) {
  if (c.footer && c.footer.trim()) return c.footer.trim();
  const l1 = [companyAddress(c), c.phone ? `Tel.${c.fax && c.fax === c.phone ? ' e Fax' : ''}: ${c.phone}` : null, c.fax && c.fax !== c.phone ? `Fax: ${c.fax}` : null, c.health_director ? `Direttore Sanitario: ${c.health_director}` : null].filter(Boolean).join('. ');
  const l2 = [c.vat ? `P.IVA${c.tax_code && c.tax_code === c.vat ? ' e C.F.' : ''}: ${c.vat}` : null, c.tax_code && c.tax_code !== c.vat ? `C.F.: ${c.tax_code}` : null, c.rea ? `REA n. ${c.rea}` : null, c.share_capital ? `Capitale Sociale: ${c.share_capital}` : null].filter(Boolean).join(', ');
  return [l1 ? `${l1}.` : null, l2].filter(Boolean).join('\n');
}

// "prof. Gian Luigi Taddei" -> { title: 'prof.', name: 'Gian Luigi Taddei' }
export function splitTitle(full) {
  const m = String(full || '').trim().match(/^((?:prof|dott|dr|ing|avv|sig)\.?(?:ssa|\.ssa)?)\s+(.+)$/i);
  return m ? { title: m[1], name: m[2] } : { title: '', name: String(full || '').trim() };
}

// Dati aziendali completi: valori salvati, con i campi vuoti riempiti dal ripiego, più address_full e footer_text calcolati
export async function getCompany() {
  let saved = null;
  try { saved = await getSetting('company', null); } catch { saved = null; }
  const c = { ...DEFAULT_COMPANY };
  if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (v != null && String(v).trim() !== '') c[k] = String(v);
  c.address_full = companyAddress(c);
  c.footer_text = companyFooter(c);
  return c;
}
