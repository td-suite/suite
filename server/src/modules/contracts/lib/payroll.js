// Calcoli retributivi: scomposizione RAL (come l'Elaboratore Buste Paga), costo azienda, stima netto
import { many, one } from '../db.js';
import { r2 } from './util.js';
import { getCompany } from '../../../lib/company.js';
import { DEFAULT_SETTINGS } from './seedData.js';

// Chiavi che vengono dai Dati aziendali della Suite (Amministrazione > Impostazioni, docs/IMPOSTAZIONI.md): qui in sola lettura.
// company_address (sede operativa / di lavoro predefinita) resta del modulo: se vuota vale la sede legale.
export const CORE_KEYS = ['company_name', 'company_legal_address', 'company_vat', 'company_rea', 'company_capital', 'company_phone', 'company_email', 'company_pec', 'company_website', 'health_director'];
export const coreSettings = (co) => ({ company_name: co.legal_name, company_legal_address: co.address_full, company_vat: co.vat, company_rea: co.rea, company_capital: co.share_capital,
  company_phone: co.phone, company_email: co.email, company_pec: co.pec, company_website: co.website, health_director: co.health_director });
export async function getSettings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const s = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  const core = coreSettings(await getCompany());
  for (const [k, v] of Object.entries(core)) if (v) s[k] = v;
  if (!s.company_address) s.company_address = s.company_legal_address;
  return s;
}

// Minimo tabellare vigente per livello alla data indicata
export async function minimumFor(level, atDate = null, ccnl = 'STUDI_PROFESSIONALI') {
  if (!level) return null;
  const row = await one(
    `SELECT m.amount, m.valid_from, m.enac FROM ccnl_minimums m JOIN ccnl_levels l ON l.id = m.level_id
      WHERE l.ccnl=$1 AND upper(l.level)=upper($2) AND m.valid_from <= $3::date ORDER BY m.valid_from DESC LIMIT 1`,
    [ccnl, String(level).replace(/^livello\s*/i, '').replace('Quadro', 'Q'), atDate || new Date().toISOString().slice(0, 10)],
  );
  return row;
}

// Scomposizione della RAL: paga base = minimo tabellare; indennità di funzione = 70% dell'eccedenza; superminimo = resto
export function decompose(ral, monthly = 14, basePay = null, share = 0.7) {
  const ralMonthly = r2(Number(ral || 0) / (monthly || 14));
  const base = basePay == null ? ralMonthly : Math.min(Number(basePay), ralMonthly);
  const diff = r2(ralMonthly - base);
  const functionAllowance = diff > 0 ? r2(diff * share) : 0;
  const superminimo = diff > 0 ? r2(diff - functionAllowance) : 0;
  return { ral: r2(ral), monthly, ral_monthly: ralMonthly, base_pay: r2(base), superminimo, function_allowance: functionAllowance };
}

// Dirigenti (CCNL Dirigenti Industria): nessun livello; minimo contrattuale di garanzia annuo + superminimo ad personam, 13 mensilità
export function decomposeDirigente(ral, settings, monthly = 13) {
  const minimo = Number(settings.dirigenti_minimum || 85000);
  const m = Number(monthly || settings.dirigenti_monthly_payments || 13);
  const ralMonthly = r2(Number(ral || 0) / m);
  const base = r2(Math.min(Number(ral || 0), minimo) / m);
  return { ral: r2(ral), monthly: m, ral_monthly: ralMonthly, base_pay: base, superminimo: r2(Math.max(0, ralMonthly - base)), function_allowance: 0, minimum_annual: minimo };
}

// Coefficiente di costo azienda (RAL x coefficiente = costo annuo lordo stimato)
export function costCoefficient(settings, employment = {}) {
  if (employment.cost_coefficient) return Number(employment.cost_coefficient);
  const tfr = Number(settings.cost_tfr_pct || 6.91) / 100;
  const inail = Number(settings.cost_inail_pct || 0.5) / 100;
  let inps = Number(settings.cost_inps_pct || 29) / 100;
  let extra = 0;
  if (employment.contract_type === 'APPRENDISTATO') inps = Number(settings.cost_apprentice_inps_pct || 11.61) / 100;
  if (employment.contract_type === 'DIRIGENTE') extra = Number(settings.cost_dirigente_extra_pct || 8) / 100;
  return Math.round((1 + inps + inail + tfr + extra) * 10000) / 10000;
}

export function companyCost(ral, coefficient, mboPct = 0) {
  const annual = r2(Number(ral || 0) * coefficient);
  const mbo = mboPct ? r2(Number(ral) * (Number(mboPct) / 100) * coefficient) : 0;
  return { annual, monthly: r2(annual / 12), mbo_max: mbo, annual_with_mbo: r2(annual + mbo) };
}

// Stima del netto annuo e mensile (IRPEF a scaglioni, detrazioni lavoro dipendente, addizionali): valore indicativo
export function netEstimate(ral, settings, monthly = 14) {
  const gross = Number(ral || 0);
  const inpsPct = Number(settings.employee_inps_pct || 9.19) / 100;
  const inps = r2(gross * inpsPct);
  const taxable = r2(gross - inps);
  let brackets;
  try { brackets = JSON.parse(settings.irpef_brackets); } catch { brackets = [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: null, rate: 43 }]; }
  let irpefGross = 0; let prev = 0;
  for (const b of brackets) {
    const top = b.upTo == null ? Infinity : b.upTo;
    if (taxable > prev) irpefGross += (Math.min(taxable, top) - prev) * (b.rate / 100);
    prev = top;
    if (taxable <= top) break;
  }
  // Detrazione per lavoro dipendente (art. 13 TUIR, valori 2025)
  let detr = 0;
  if (taxable <= 15000) detr = 1955;
  else if (taxable <= 28000) detr = 1910 + 1190 * ((28000 - taxable) / 13000);
  else if (taxable <= 50000) detr = 1910 * ((50000 - taxable) / 22000);
  if (taxable > 25000 && taxable <= 35000) detr += 65;
  const irpef = Math.max(0, r2(irpefGross - detr));
  const addReg = r2(taxable * Number(settings.addizionale_regionale_pct || 1.42) / 100);
  const addCom = r2(taxable * Number(settings.addizionale_comunale_pct || 0.3) / 100);
  const bonus = taxable <= 15000 && irpefGross > detr ? 1200 : 0; // trattamento integrativo (condizione semplificata)
  const netAnnual = r2(gross - inps - irpef - addReg - addCom + bonus);
  return { gross, inps, taxable, irpef_gross: r2(irpefGross), detractions: r2(detr), irpef, add_regional: addReg, add_municipal: addCom, bonus, net_annual: netAnnual, net_monthly: r2(netAnnual / monthly), note: 'Stima indicativa: IRPEF a scaglioni, detrazione lavoro dipendente, addizionali medie; non considera carichi familiari, fringe benefit e conguagli.' };
}

// RAL vigente alla data, applicando gli scatti programmati
export function ralAt(employment, date = new Date().toISOString().slice(0, 10)) {
  let ral = Number(employment.ral || 0);
  for (const s of employment.ral_steps || []) if (s.from && s.from <= date && Number(s.ral) > 0) ral = Number(s.ral);
  return ral;
}
