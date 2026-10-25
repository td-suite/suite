// Generazione dei documenti: DOCX dai template aziendali (docxtemplater) e PDF via LibreOffice headless
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { config } from '../config.js';
import { itDate, itDateTime } from './util.js';
import { feeItems, yearsWords, eur, pct } from './rules.js';

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const CHK = (b) => (b ? '☒' : '☐');
const up = (s) => String(s || '').toUpperCase();
const nz = (v, d = '') => (v == null || v === '' ? d : String(v));

export function renderDocx(template, data) {
  const zip = new PizZip(fs.readFileSync(path.join(TPL_DIR, template)));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Dati comuni da Impostazioni: società, legale rappresentante, direttore sanitario, sicurezza
export function baseData(s) {
  const lrTitleName = `${s.lr_title ? `${s.lr_title} ` : ''}${s.lr_name}`.trim();
  const dsTitleName = `${s.ds_title ? `${s.ds_title} ` : ''}${s.ds_name}`.trim();
  return {
    company_name: s.company_name, company_name_upper: up(s.company_name),
    company_legal_address: s.company_legal_address, company_legal_address_upper: up(s.company_legal_address),
    company_city: s.company_city, company_prov: s.company_prov, company_vat: s.company_vat, company_tax_code: s.company_tax_code,
    company_phone: s.company_phone, company_fax: s.company_fax, company_pec: s.company_pec, company_capital: s.company_capital,
    lab_address: s.lab_address, lab_address_upper: up(s.lab_address),
    lr_name: s.lr_name, lr_name_upper: up(s.lr_name), lr_title_name: lrTitleName, lr_role: s.lr_role, lr_role_it: s.lr_role_it,
    lr_birth_place: nz(s.lr_birth_place, '________'), lr_birth_date: nz(s.lr_birth_date, '__/__/____'), lr_residence: nz(s.lr_residence, '________'),
    lr_tax_code: nz(s.lr_tax_code, '________________'), lr_phone: nz(s.lr_phone, s.company_phone), lr_email: s.lr_email,
    ds_name: s.ds_name, ds_name_upper: up(s.ds_name), ds_title_name: dsTitleName,
    ds_birth_place: nz(s.ds_birth_place, '________'), ds_birth_date: nz(s.ds_birth_date, '__/__/____'), ds_residence: nz(s.ds_residence, '________'),
    ds_tax_code: nz(s.ds_tax_code, '________________'), ds_phone: s.ds_phone, ds_email: s.ds_email,
    ds_degree: s.ds_degree, ds_specialization: s.ds_specialization, ds_registration: s.ds_registration, ds_weekly_hours: s.ds_weekly_hours,
    rspp_name: s.rspp_name, rspp_name_upper: up(s.rspp_name), rls_name: s.rls_name, rls_name_upper: up(s.rls_name), mc_name: s.mc_name, mc_name_upper: up(s.mc_name),
  };
}

const trace = (c, label) => `${label} ${c.protocol || `#${c.id}`} · versione ${c.version} · documento generato da Toscana Diagnostica · Business il ${itDateTime(new Date())}`;

// ---------------- Contratti ----------------
function partnerData(p, prefix) {
  return {
    [`${prefix}_name`]: p.name, [`${prefix}_street`]: nz(p.street), [`${prefix}_zip`]: nz(p.zip), [`${prefix}_city`]: nz(p.city), [`${prefix}_prov`]: nz(p.prov),
    [`${prefix}_vat`]: nz(p.vat, '__________'), [`${prefix}_tax_code`]: nz(p.tax_code, p.vat || '__________'),
    [`${prefix}_signer`]: nz(p.signer, p.legal_rep || '__________'), [`${prefix}_signer_role`]: nz(p.signer_role, 'Il Legale Rappresentante'),
    [`${prefix}_pec`]: nz(p.pec, '__________'), [`${prefix}_sdi`]: nz(p.sdi, '_______'),
  };
}

export function contractData(c, p, s) {
  const d = c.data || {};
  const base = baseData(s);
  const common = { protocol: c.protocol || 'bozza', proposal_date: itDate(c.proposal_date), trace_line: trace(c, 'Proposta') };
  if (c.kind === 'PP') {
    const site = d.site || {};
    const years = d.duration_years || s.pp_duration_years || 3;
    return {
      ...base, ...common, ...partnerData(p, 'partner'),
      partner_pec_clause: p.pec ? `, PEC ${p.pec}` : '',
      site_street: nz(site.street), site_city: nz(site.city), site_prov: nz(site.prov), site_zip: nz(site.zip),
      duration_years: String(years), duration_years_words: yearsWords(years),
      start_date: c.start_date ? itDate(c.start_date) : '__/__/____',
      fee_items: feeItems(d.fee),
      td_nursing: (d.services?.nursing || 'TD') === 'TD', host_nursing: d.services?.nursing === 'HOST',
      host_reception: (d.services?.reception || 'HOST') === 'HOST', td_reception: d.services?.reception === 'TD',
      duvri_costs_clause: nz(d.duvri_costs_clause, s.duvri_costs_default),
    };
  }
  const privacy = d.privacy || {};
  const priv = {
    priv_owner: CHK(privacy.role === 'TITOLARE'), priv_processor: CHK(privacy.role === 'RESPONSABILE'),
    priv_principal: privacy.role === 'RESPONSABILE' ? nz(privacy.principal, '__________') : '-',
    priv_measures_no: CHK(!privacy.measures), priv_measures_yes: CHK(Boolean(privacy.measures)), priv_measures: nz(privacy.measures),
    priv_dpo_name: nz(privacy.dpo_name, '-'), priv_dpo_contact: nz(privacy.dpo_contact, '-'),
  };
  const vatClause = d.vat_exemption === true ? '☒ Il Cliente dichiara che la prestazione sanitaria rientra nell’esenzione IVA ex art. 10, n. 18 D.P.R. 633/1972'
    : d.vat_exemption === false ? '☒ Il Cliente dichiara che la prestazione non rientra nell’esenzione IVA ex art. 10, n. 18 D.P.R. 633/1972: si applica l’IVA di legge'
      : 'Il Cliente dichiara se la prestazione sanitaria rientra nell’esenzione IVA ex art. 10, n. 18 D.P.R. 633/1972';
  const listClause = d.price_list_file ? `Listino allegato: ${d.price_list_file}.` : '';
  const client = { ...partnerData(p, 'client'), client_bank: nz(p.bank_name, 'Istituto di Credito che vorrete indicarci'), payment_terms: nz(d.payment_terms, s.payment_terms_default), vat_exemption_clause: vatClause, price_list_clause: listClause };
  if (c.kind === 'SRV') {
    const pk = d.pickup || {}; const days = pk.days || [];
    const dd = {};
    for (let i = 0; i < 6; i++) {
      const day = days[i] || {};
      const time = day.time_from ? (day.time_to ? `${day.time_from}-${day.time_to}` : `ore ${day.time_from}`) : '';
      dd[`d${i + 1}_fixed`] = CHK(day.mode === 'FISSO'); dd[`d${i + 1}_oncall`] = CHK(day.mode === 'CHIAMATA'); dd[`d${i + 1}_time`] = day.mode && day.mode !== 'NO' ? time : (day.mode === 'NO' ? 'Nessun ritiro' : '');
    }
    return {
      ...base, ...common, ...client, ...priv, ...dd,
      site_name: nz(d.site_name, p.name), site_address: nz(d.site_address, [p.street, p.zip, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')),
      client_ds: nz(d.client_ds, '____________________________'),
      pickup_site: nz(pk.site, d.site_name || p.name), pickup_street: nz(pk.street), pickup_city: nz(pk.city), pickup_contact: nz(pk.contact), pickup_contact_ref: [pk.phone, pk.email].filter(Boolean).join(' / '),
      sol1: CHK(d.interface_solution === 1), sol2: CHK(d.interface_solution === 2), sol3: CHK(d.interface_solution === 3),
    };
  }
  // MDL
  return {
    ...base, ...common, ...client, ...priv,
    service_email: nz(d.service_email, '______________'), service_contact: nz(d.service_contact, '______________'), service_phone: nz(d.service_phone, '__________'),
    invoice_email: nz(d.invoice_email, p.pec || '______________'), doctor_email: nz(d.doctor_email, '______________'),
  };
}

export const CONTRACT_TEMPLATE = { PP: 'contratto_punto_prelievi.docx', SRV: 'offerta_service.docx', MDL: 'offerta_mdl.docx' };
export const CONTRACT_DOCNAME = { PP: 'Contratto_Punto_Prelievi', SRV: 'Offerta_Service_Laboratorio', MDL: 'Offerta_Medicina_del_Lavoro' };

// ---------------- Fascicolo di autorizzazione ----------------
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export function dossierData(dossier, c, p, s) {
  const d = c.data || {}; const site = d.site || {}; const x = dossier.extra || {};
  const base = baseData(s);
  const docDate = dossier.doc_date ? itDate(dossier.doc_date) : itDate(new Date().toISOString());
  const hours = {};
  (dossier.hours?.length ? dossier.hours : DAYS.map((day) => ({ day, draw: '', pickup: '' }))).forEach((h, i) => {
    const closed = !h.draw && !h.pickup;
    hours[`h${i + 1}_draw`] = closed ? 'Chiuso' : nz(h.draw, '–'); hours[`h${i + 1}_pickup`] = closed ? '' : nz(h.pickup, '–');
  });
  const staff = (dossier.staff || []).map((r) => ({ surname: nz(r.surname), name: nz(r.name), affiliation: nz(r.affiliation), contract: nz(r.contract), hours: nz(r.hours), role: nz(r.role), degree: nz(r.degree) }));
  const equipment = (dossier.equipment || []).map((r, i) => ({ n: String(i + 1), type: up(r.type), maker: nz(r.maker), model: nz(r.model), serial: nz(r.serial), power: nz(r.power), ownership: nz(r.ownership), condition: nz(r.condition), tested_at: r.tested_at ? itDate(r.tested_at) : '' }));
  const period = c.start_date ? `${itDate(c.start_date)} - ${itDate(addYears(c.start_date, 1))}` : '__/__/____ - __/__/____';
  return {
    ...base, ...hours, staff, equipment,
    doc_date: docDate,
    site_street: nz(site.street), site_street_upper: up(site.street), site_city: nz(site.city), site_city_upper: up(site.city), site_prov: nz(site.prov), site_zip: nz(site.zip),
    site_prov_name: nz(x.prov_name, site.prov), site_floor: nz(x.floor, 'Piano Terra'), site_building_type: nz(x.building_type, 'Studi Medici'), site_workers: nz(x.workers, '1'),
    site_notes: nz(x.notes),
    host_name: p.name, host_name_upper: up(p.name), host_street: nz(p.street), host_zip: nz(p.zip), host_city: nz(p.city), host_prov: nz(p.prov),
    host_signer: nz(p.signer, p.legal_rep || 'Il Legale Rappresentante'), host_signer_role: nz(p.signer_role, 'Legale Rappresentante'),
    ds_start_date: c.start_date ? itDate(c.start_date) : '__/__/____',
    dvr_code: nz(x.dvr_code, 'TD-SGI-REG0xx_00'), duvri_code: nz(x.duvri_code, 'TD-SGI-REG0xx_00'),
    contract_period: period,
    dirty_clean_clause: nz(x.dirty_clean_clause, s.dirty_clean_default),
    trace_line: trace(c, 'Fascicolo'),
  };
}
function addYears(iso, n) { const d = new Date(iso); d.setFullYear(d.getFullYear() + n); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

// Coda sequenziale: LibreOffice non gestisce bene conversioni concorrenti sullo stesso profilo
let queue = Promise.resolve();
export function docxToPdf(docxBuffer) {
  const job = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdb-'));
    const input = path.join(dir, 'doc.docx');
    fs.writeFileSync(input, docxBuffer);
    const profile = path.join(os.tmpdir(), 'tdb-lo-profile');
    await new Promise((resolve, reject) => {
      execFile(config.sofficeBin, [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input],
        { timeout: 180_000, env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } },
        (err, _stdout, stderr) => (err ? reject(new Error(`Conversione PDF fallita: ${stderr || err.message}`)) : resolve()));
    });
    const out = path.join(dir, 'doc.pdf');
    if (!fs.existsSync(out)) throw new Error('Conversione PDF fallita: file non prodotto');
    const pdf = fs.readFileSync(out);
    fs.rmSync(dir, { recursive: true, force: true });
    return pdf;
  };
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
}

export async function pdfAvailable() {
  return new Promise((resolve) => execFile(config.sofficeBin, ['--version'], { timeout: 20_000 }, (err) => resolve(!err)));
}

export { eur };
