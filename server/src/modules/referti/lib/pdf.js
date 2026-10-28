// Estrazione del testo dai PDF: pdftotext -layout pagina per pagina (poppler); se il PDF non ha testo estraibile, OCR
// con tesseract (lingua italiana) sulle immagini prodotte da pdftoppm. Nessun contenuto del PDF finisce nei log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from '../config.js';
import { puliscaPagina } from './text.js';

const run = (bin, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: opts.timeout || 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return reject(Object.assign(new Error(`${path.basename(bin)}: ${String(stderr || err.message).split('\n')[0]}`), { code: err.code }));
    resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-'));

// Numero di pagine (pdfinfo); in mancanza si conta il testo
export async function contaPagine(file) {
  try {
    const { stdout } = await run(config.pdfinfoBin, [file], { timeout: 30_000 });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    if (m) return Number(m[1]);
  } catch { /* si ripiega sul conteggio dal testo */ }
  return null;
}

// Testo delle pagine con pdftotext -layout: un elemento per pagina (il separatore di pagina è il form feed)
export async function testoPagine(file) {
  const { stdout } = await run(config.pdftotextBin, ['-layout', '-enc', 'UTF-8', file, '-']);
  const pagine = stdout.split('\f');
  if (pagine.length && !pagine[pagine.length - 1].trim()) pagine.pop();
  return pagine.map(puliscaPagina);
}

// OCR di riserva: pdftoppm → PNG a 300 dpi → tesseract -l ita (una pagina per volta)
// Lingua: italiano (tesseract-ocr-ita); se il pacchetto manca si ripiega sull'inglese e lo si segnala
export async function ocrPagine(file, nPagine) {
  const dir = tmpDir();
  let lingua = config.ocrLang;
  try {
    await run(config.pdftoppmBin, ['-r', '300', '-png', file, path.join(dir, 'p')], { timeout: 300_000 });
    const imgs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    const out = [];
    for (const img of imgs) {
      const base = path.join(dir, path.basename(img, '.png'));
      try { await run(config.tesseractBin, [path.join(dir, img), base, '-l', lingua, '--psm', '6'], { timeout: 300_000 }); }
      catch (e) {
        if (lingua !== 'eng' && /traineddata|Failed loading language/i.test(e.message)) { lingua = 'eng'; await run(config.tesseractBin, [path.join(dir, img), base, '-l', lingua, '--psm', '6'], { timeout: 300_000 }); }
        else throw e;
      }
      out.push(puliscaPagina(fs.readFileSync(`${base}.txt`, 'utf8')));
    }
    while (nPagine && out.length < nPagine) out.push('');
    return { pagine: out, lingua };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function ocrDisponibile() {
  try { await run(config.tesseractBin, ['--version'], { timeout: 20_000 }); return true; } catch { return false; }
}

// Estrae il testo di un PDF (buffer): { pagine: [testo], n_pagine, ocr }
export async function estraiTesto(buffer) {
  const dir = tmpDir();
  const file = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(file, buffer);
    const nInfo = await contaPagine(file);
    let pagine;
    try { pagine = await testoPagine(file); } catch (e) { throw new Error(`Il file non è un PDF leggibile (${e.message})`); }
    const n = nInfo || pagine.length;
    while (pagine.length < n) pagine.push('');
    const caratteri = pagine.reduce((a, p) => a + p.replace(/\s+/g, '').length, 0);
    let ocr = false; let ocr_lingua = null;
    if (n > 0 && caratteri < config.ocrSogliaCaratteri * n) {
      if (!(await ocrDisponibile())) throw new Error('Il PDF non ha testo estraibile e l\'OCR (tesseract) non è disponibile su questo server');
      const r = await ocrPagine(file, n);
      pagine = r.pagine; ocr = true; ocr_lingua = r.lingua;
    }
    return { pagine, n_pagine: n, ocr, ocr_lingua };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Ritaglio delle pagine di un PDF con pdf-lib, se la libreria è installata; altrimenti null (si restituisce il PDF intero)
export async function ritagliaPagine(buffer, pagine) {
  let lib;
  try { lib = await import('pdf-lib'); } catch { return null; }
  try {
    const src = await lib.PDFDocument.load(buffer, { ignoreEncryption: true });
    const out = await lib.PDFDocument.create();
    const idx = pagine.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
    if (!idx.length) return null;
    const copied = await out.copyPages(src, idx);
    for (const p of copied) out.addPage(p);
    return Buffer.from(await out.save());
  } catch { return null; }
}
