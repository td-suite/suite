// Generazione del modulo: DOCX dal template aziendale (docxtemplater) e PDF via LibreOffice headless
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { config } from '../config.js';
import { itDate, itDateTime } from './util.js';
import { amountToWords, eur } from './rules.js';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'autorizzazione_pagamento.docx');
const CHK = (b) => (b ? '☒' : '☐');
const DOC_LABEL = { FATTURA: 'Fattura', CONTRATTO: 'Contratto', ORDINE: 'Ordine', ALTRO: 'Altro' };
const ROLE_LABEL = { CEO: 'Amministratore Delegato', CFO: 'Chief Financial Officer' };

// Dati per il template a partire da istanza, firme e impostazioni
export function formData(r, signatures, settings, signers) {
  const sig = (role) => signatures.find((s) => s.role === role && s.valid);
  const required = r.tier === 'SINGOLA' ? [r.single_signer] : ['CEO', 'CFO'];
  const sigBlock = (role) => {
    const s = sig(role);
    const u = signers?.[role];
    const name = s ? s.user_name : (u ? `${u.title ? `${u.title} ` : ''}${u.full_name}` : '');
    if (!required.includes(role)) return { name, date: '—', signature: 'Non richiesta (scaglione a firma singola)' };
    if (!s) return { name, date: '____ / ____ / ________', signature: 'in attesa' };
    return { name, date: itDate(s.signed_at), signature: `firmato elettronicamente il ${itDateTime(s.signed_at)} (accesso ${s.auth_method === 'ENTRA' ? 'Microsoft 365' : 'locale'}, ${s.user_email}) · impronta ${s.content_hash.slice(0, 16)}` };
  };
  const ceo = sigBlock('CEO'); const cfo = sigBlock('CFO');
  const c = r.checks || {};
  return {
    title: r.tier === 'SINGOLA' ? settings.form_title_single : settings.form_title_joint,
    form_ref: settings.form_ref,
    auth_text: settings.auth_text,
    protocol: r.protocol || '', request_date: itDate(r.request_date), requester: r.requester || '', cost_center: r.cost_center || '',
    beneficiary_name: r.beneficiary_name, beneficiary_tax_id: r.beneficiary_tax_id || '', beneficiary_iban: r.beneficiary_iban,
    beneficiary_bank: [r.beneficiary_bank, r.beneficiary_bic].filter(Boolean).join(' – '),
    amount: new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(r.amount)),
    amount_words: amountToWords(r.amount),
    purpose: r.purpose,
    chk_fattura: CHK(r.doc_type === 'FATTURA'), chk_contratto: CHK(r.doc_type === 'CONTRATTO'), chk_ordine: CHK(r.doc_type === 'ORDINE'), chk_doc_altro: CHK(r.doc_type === 'ALTRO'),
    doc_other: r.doc_other || '________', doc_number: r.doc_number || '__________', doc_date: r.doc_date ? itDate(r.doc_date) : '___/___/______',
    debit_account: r.debit_account || '',
    chk_sepa: CHK(r.payment_method === 'SEPA'), chk_urgente: CHK(r.payment_method === 'URGENTE'), chk_estero: CHK(r.payment_method === 'ESTERO'), chk_f24: CHK(r.payment_method === 'F24'), chk_pm_altro: CHK(r.payment_method === 'ALTRO'),
    pm_other: r.payment_method_other || '________',
    value_date: r.value_date ? itDate(r.value_date) : '____ / ____ / ________',
    threshold_single: eur(settings.threshold_single), threshold_joint: eur(settings.threshold_joint),
    chk_tier_single: CHK(r.tier === 'SINGOLA'), chk_tier_joint: CHK(r.tier === 'CONGIUNTA'), chk_tier_cda: CHK(r.tier === 'CDA'),
    single_signer_label: r.tier === 'SINGOLA' ? ROLE_LABEL[r.single_signer] : '—',
    board_number: r.board_number || '______', board_date: r.board_date ? itDate(r.board_date) : '___/___/______',
    chk_prior: CHK(r.prior_approval), prior_ref: r.prior_approval_ref || '_______________________________',
    chk_v1: CHK(c.budget), chk_v2: CHK(c.aggregation), chk_v3: CHK(c.documents), chk_v4: CHK(c.related_party), chk_v5: CHK(c.cfo_consent), chk_v6: CHK(c.iban_verified),
    ceo_name: ceo.name, ceo_date: ceo.date, ceo_signature: ceo.signature,
    cfo_name: cfo.name, cfo_date: cfo.date, cfo_signature: cfo.signature,
    executed_by: r.executed_by || '', executed_at: r.executed_at ? itDate(r.executed_at) : '____ / ____ / ________', cro_trn: r.cro_trn || '', attachments_count: String(r.attachments_count ?? ''),
    trace_line: `Istanza ${r.protocol || r.id} · versione ${r.version} · impronta SHA-256 del contenuto autorizzato ${r.content_hash || ''} · documento generato da Toscana Diagnostica · Finance il ${itDateTime(new Date())}`,
  };
}

export function renderDocx(data) {
  const zip = new PizZip(fs.readFileSync(TEMPLATE));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Coda sequenziale: LibreOffice non gestisce bene conversioni concorrenti sullo stesso profilo
let queue = Promise.resolve();
export function docxToPdf(docxBuffer) {
  const job = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdf-'));
    const input = path.join(dir, 'doc.docx');
    fs.writeFileSync(input, docxBuffer);
    const profile = path.join(os.tmpdir(), 'tdf-lo-profile');
    await new Promise((resolve, reject) => {
      execFile(config.sofficeBin, [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input],
        { timeout: 120_000, env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } },
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

export { DOC_LABEL, ROLE_LABEL };
