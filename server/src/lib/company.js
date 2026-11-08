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
  // Piè di pagina della Home come il sito (richiesta del CEO, 05/11/2026): dati dal sito www.toscanadiagnostica.it
  sdi_code: 'M5UXCR1',
  health_authorization: 'Autorizzazione Sanitaria n. 12 del 12/06/2026 rilasciata dal Comune di Sesto Fiorentino',
  booking_hours: 'Lun – Ven: dalle 7:30 alle 19:00\nSabato: dalle 7:30 alle 12:30',
  support_hours: 'Lun – Ven: dalle 7:30 alle 19:00\nSabato: dalle 7:30 alle 12:00',
  support_phone: '055 776511',
  support_email: 'supporto.clienti@toscanadiagnostica.it',
  social_facebook: '',
  social_instagram: '',
  social_linkedin: '',
  service_charter_url: '',
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
  ['sdi_code', 'Codice SDI', 'Codice destinatario per la fatturazione elettronica (piè di pagina della Home).'],
  ['health_authorization', 'Autorizzazione sanitaria', 'Es. Autorizzazione Sanitaria n. 12 del 12/06/2026 rilasciata dal Comune di Sesto Fiorentino.'],
  ['booking_hours', 'Orari prenotazione telefonica', 'Una riga per fascia (piè di pagina della Home).'],
  ['support_hours', 'Orari supporto clienti', 'Una riga per fascia (piè di pagina della Home).'],
  ['support_phone', 'Telefono supporto clienti', ''], ['support_email', 'Email supporto clienti', ''],
  ['social_facebook', 'Facebook (URL)', 'Vuoto = icona nascosta.'], ['social_instagram', 'Instagram (URL)', 'Vuoto = icona nascosta.'], ['social_linkedin', 'LinkedIn (URL)', 'Vuoto = icona nascosta.'],
  ['service_charter_url', 'Carta dei servizi (URL)', 'Link al PDF sul sito; vuoto = voce nascosta.'],
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

// ---- A9 (programma anagrafica unica, 08/11/2026): Legal entity di Toscana Diagnostica = Dati aziendali.
// app_settings.company_org_id indica la riga di public.organizations che è TD. Proposta automatica (decisione 6 del CEO): la Legal entity
// con la stessa P.IVA dei Dati aziendali, altrimenti quella che si chiama "Toscana Diagnostica" (società del gruppo per prime).
// Il salvataggio dei Dati aziendali aggiorna quella riga (ragione sociale, P.IVA, CF, indirizzo, PEC, SDI) nella stessa transazione.
import { one, many } from '../db.js';
const soloCifre = (s) => String(s || '').replace(/\D+/g, '');

export async function companyOrgId() {
  const v = await getSetting('company_org_id', null).catch(() => null);
  const id = Number(v);
  if (!id) return null;
  return (await one('SELECT id FROM organizations WHERE id=$1', [id]))?.id || null;
}

/** Proposta della riga TD: { id, name, vat_number, come } oppure null. */
export async function propostaCompanyOrg(company = null) {
  const c = company || await getCompany();
  const vat = soloCifre(c.vat);
  if (vat) {
    const r = await many(`SELECT id, name, kind, vat_number FROM organizations WHERE regexp_replace(coalesce(vat_number,''), '\\D', '', 'g') = $1
      ORDER BY (kind IN ('SOCIETA','GRUPPO')) DESC, active DESC, id`, [vat]);
    if (r.length) return { ...r[0], come: `stessa P.IVA dei Dati aziendali (${c.vat})${r.length > 1 ? `; ${r.length} Legal entity con questa P.IVA: le altre sono duplicati (D16a)` : ''}` };
  }
  const r = await many(`SELECT id, name, kind, vat_number FROM organizations WHERE lower(unaccent(name)) LIKE 'toscana diagnostica%'
    ORDER BY (kind IN ('SOCIETA','GRUPPO')) DESC, active DESC, id`);
  if (r.length) return { ...r[0], come: 'nome "Toscana Diagnostica" (nessuna Legal entity con la P.IVA dei Dati aziendali)' };
  return null;
}

/** Campi della Legal entity TD dai Dati aziendali (solo quelli valorizzati: mai cancellare un valore dell'anagrafica) */
export function orgFieldsFromCompany(c) {
  const out = { name: c.legal_name || c.name, vat_number: soloCifre(c.vat) || null, tax_code: c.tax_code || null, address: c.address || null, zip: c.zip || null,
    city: c.city || null, province: c.province || null, pec: c.pec || null, sdi: c.sdi_code || null };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && String(v).trim() !== ''));
}

/**
 * Allinea la riga TD di organizations ai Dati aziendali. `c` = client della transazione (pool se assente). Ritorna { org_id, modifiche }
 * oppure { org_id: null } se company_org_id non è impostato.
 */
export async function aggiornaOrgTd(client, saved) {
  const run = (sql, p) => (client ? client.query(sql, p) : import('../db.js').then((m) => m.q(sql, p)));
  const idRow = (await run(`SELECT value FROM app_settings WHERE key='company_org_id'`)).rows[0];
  const id = Number(idRow?.value);
  if (!id) return { org_id: null };
  const cur = (await run('SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!cur) return { org_id: null };
  const comp = { ...DEFAULT_COMPANY };
  if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (v != null && String(v).trim() !== '') comp[k] = String(v);
  const f = orgFieldsFromCompany(comp);
  const mod = {};
  for (const [k, v] of Object.entries(f)) if (String(cur[k] ?? '') !== String(v)) mod[k] = [cur[k] ?? null, v];
  if (!Object.keys(mod).length) return { org_id: id, modifiche: {} };
  const ks = Object.keys(mod);
  await run(`UPDATE organizations SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...ks.map((k) => mod[k][1])]);
  return { org_id: id, modifiche: mod };
}

/**
 * B9 (08/11/2026): il Laboratorio di Analisi è la sede di tipo LABORATORIO in Amministrazione > Sedi (fonte unica di nome e indirizzo,
 * prima copiati nelle impostazioni del Business Hub `lab_address` e di NC `lab_nome`/`lab_indirizzo`). Con più laboratori attivi vale
 * quello della Legal entity di TD, poi l'ordine della sede. null se non c'è: i moduli usano allora il proprio valore predefinito.
 * Ritorna { id, code, name, address, zip, city, province, email, phone, indirizzo (via, CAP città (PR)), indirizzo_contratti (città (PR), via) }.
 */
export async function getLaboratorio() {
  const td = await companyOrgId().catch(() => null);
  const s = await one(`SELECT id, code, name, address, zip, city, province, email, phone FROM sites WHERE kind='LABORATORIO' AND active
     ORDER BY (organization_id IS NOT DISTINCT FROM $1::int) DESC, sort_order NULLS LAST, id LIMIT 1`, [td]).catch(() => null);
  if (!s) return null;
  const prov = s.province ? ` (${s.province})` : '';
  return { ...s,
    indirizzo: [s.address, [s.zip, s.city].filter(Boolean).join(' ') + (s.city ? prov : '')].filter((x) => x && x.trim()).join(', '),
    indirizzo_contratti: [s.city ? `${s.city}${prov}` : null, s.address].filter(Boolean).join(', ') };
}
