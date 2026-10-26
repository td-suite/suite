// Conversione DOCX → PDF con LibreOffice headless (presente nell'immagine Docker della Suite; in locale può mancare:
// in quel caso la circolare resta con il solo DOCX e render_error spiega il motivo). Una conversione alla volta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from '../config.js';

let queue = Promise.resolve();
let available = null;

export async function pdfAvailable() {
  if (available != null) return available;
  available = await new Promise((resolve) => execFile(config.sofficeBin, ['--version'], { timeout: 20_000 }, (err) => resolve(!err)));
  return available;
}

export function docxToPdf(docxBuffer) {
  const job = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-'));
    try {
      const input = path.join(dir, 'circolare.docx');
      fs.writeFileSync(input, docxBuffer);
      await new Promise((resolve, reject) => {
        execFile(config.sofficeBin, [`-env:UserInstallation=file://${config.loProfile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input],
          { timeout: 180_000, env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } },
          (err, _stdout, stderr) => (err ? reject(new Error(`Conversione PDF fallita: ${stderr || err.message}`)) : resolve()));
      });
      const out = path.join(dir, 'circolare.pdf');
      if (!fs.existsSync(out)) throw new Error('Conversione PDF fallita: file non prodotto');
      return fs.readFileSync(out);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
}

// Numero di pagine del PDF (conteggio degli oggetti pagina; sufficiente per i PDF prodotti da LibreOffice)
export function pdfPages(buf) {
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : null;
}
