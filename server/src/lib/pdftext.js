// Estrazione del testo dai PDF, condivisa dai moduli (Referti esterni, Scadenziario strutture di Payments): pdftotext -layout pagina
// per pagina (poppler); se il PDF non ha testo estraibile, OCR con tesseract (lingua italiana) sulle immagini prodotte da pdftoppm.
// Nessun contenuto del PDF finisce nei log. `createPdfText(opts)` costruisce le funzioni con i binari, la lingua OCR, la soglia di
// caratteri per pagina sotto la quale si passa all'OCR e la pulizia del testo di pagina del modulo chiamante.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const env = process.env;
export const DEFAULTS = {
  pdftotextBin: env.PDFTOTEXT_BIN || 'pdftotext',
  pdfinfoBin: env.PDFINFO_BIN || 'pdfinfo',
  pdftoppmBin: env.PDFTOPPM_BIN || 'pdftoppm',
  tesseractBin: env.TESSERACT_BIN || 'tesseract',
  ocrLang: env.PDF_OCR_LANG || 'ita',
  ocrSogliaCaratteri: Number(env.PDF_OCR_SOGLIA || 40),
  tmpPrefix: 'tdpdf-',
  clean: (txt) => String(txt || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n'),
};

const run = (bin, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: opts.timeout || 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return reject(Object.assign(new Error(`${path.basename(bin)}: ${String(stderr || err.message).split('\n')[0]}`), { code: err.code }));
    resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

export function createPdfText(opts = {}) {
  const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), cfg.tmpPrefix));

  // Numero di pagine (pdfinfo); in mancanza si conta il testo
  async function contaPagine(file) {
    try {
      const { stdout } = await run(cfg.pdfinfoBin, [file], { timeout: 30_000 });
      const m = stdout.match(/^Pages:\s+(\d+)/m);
      if (m) return Number(m[1]);
    } catch { /* si ripiega sul conteggio dal testo */ }
    return null;
  }

  // Testo delle pagine con pdftotext -layout: un elemento per pagina (il separatore di pagina è il form feed)
  async function testoPagine(file) {
    const { stdout } = await run(cfg.pdftotextBin, ['-layout', '-enc', 'UTF-8', file, '-']);
    const pagine = stdout.split('\f');
    if (pagine.length && !pagine[pagine.length - 1].trim()) pagine.pop();
    return pagine.map(cfg.clean);
  }

  // OCR di riserva: pdftoppm → PNG a 300 dpi → tesseract -l ita (una pagina per volta); se manca l'italiano si ripiega sull'inglese
  async function ocrPagine(file, nPagine) {
    const dir = tmpDir();
    let lingua = cfg.ocrLang;
    try {
      await run(cfg.pdftoppmBin, ['-r', '300', '-png', file, path.join(dir, 'p')], { timeout: 300_000 });
      const imgs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
      const out = [];
      for (const img of imgs) {
        const base = path.join(dir, path.basename(img, '.png'));
        try { await run(cfg.tesseractBin, [path.join(dir, img), base, '-l', lingua, '--psm', '6'], { timeout: 300_000 }); }
        catch (e) {
          if (lingua !== 'eng' && /traineddata|Failed loading language/i.test(e.message)) { lingua = 'eng'; await run(cfg.tesseractBin, [path.join(dir, img), base, '-l', lingua, '--psm', '6'], { timeout: 300_000 }); }
          else throw e;
        }
        out.push(cfg.clean(fs.readFileSync(`${base}.txt`, 'utf8')));
      }
      while (nPagine && out.length < nPagine) out.push('');
      return { pagine: out, lingua };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  async function ocrDisponibile() {
    try { await run(cfg.tesseractBin, ['--version'], { timeout: 20_000 }); return true; } catch { return false; }
  }

  // Estrae il testo di un PDF (buffer): { pagine: [testo], n_pagine, ocr, ocr_lingua }
  async function estraiTesto(buffer) {
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
      if (n > 0 && caratteri < cfg.ocrSogliaCaratteri * n) {
        if (!(await ocrDisponibile())) throw new Error('Il PDF non ha testo estraibile e l\'OCR (tesseract) non è disponibile su questo server');
        const r = await ocrPagine(file, n);
        pagine = r.pagine; ocr = true; ocr_lingua = r.lingua;
      }
      return { pagine, n_pagine: n, ocr, ocr_lingua };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  return { contaPagine, testoPagine, ocrPagine, ocrDisponibile, estraiTesto };
}

// Istanza con le impostazioni predefinite (pulizia minima del testo)
export const pdfText = createPdfText();
export const estraiTesto = pdfText.estraiTesto;
