// Generazione documenti: DOCX dai template aziendali (docxtemplater) e PDF via LibreOffice headless
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { config } from '../config.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export const TEMPLATE_FILES = {
  CONTRATTO: 'contratto_dipendente.docx',
  MBO: 'mbo.docx',
  LETTERA_IMPEGNO: 'lettera_impegno.docx',
  CONTRATTO_LP: 'contratto_lp.docx',
  CONTRATTO_DIRIGENTE: 'contratto_dirigente.docx',
  MBO_DIRIGENTE: 'mbo_dirigente.docx',
};

export function renderDocx(kind, data) {
  const file = TEMPLATE_FILES[kind];
  if (!file) throw new Error(`Template sconosciuto: ${kind}`);
  const zip = new PizZip(fs.readFileSync(path.join(TEMPLATES, file)));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Coda sequenziale: LibreOffice non gestisce bene conversioni concorrenti sullo stesso profilo
let queue = Promise.resolve();
export function docxToPdf(docxBuffer, ext = 'docx') {
  const job = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-'));
    const input = path.join(dir, `doc.${ext}`);
    fs.writeFileSync(input, docxBuffer);
    const profile = path.join(os.tmpdir(), 'tdc-lo-profile');
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
