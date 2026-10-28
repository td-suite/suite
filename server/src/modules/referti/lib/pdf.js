// Estrazione del testo dai PDF dei referti: pdftotext -layout pagina per pagina (poppler); se il PDF non ha testo estraibile, OCR
// con tesseract (lingua italiana). La logica vive in server/src/lib/pdftext.js (condivisa con Payments); qui la configurazione del modulo.
import { config } from '../config.js';
import { createPdfText } from '../../../lib/pdftext.js';
import { puliscaPagina } from './text.js';

// Le funzioni di estrazione sono quelle condivise della Suite (server/src/lib/pdftext.js), costruite con i binari, la lingua OCR,
// la soglia e la pulizia di pagina di questo modulo: stesse firme di prima per core.js.
const pdf = createPdfText({ pdftotextBin: config.pdftotextBin, pdfinfoBin: config.pdfinfoBin, pdftoppmBin: config.pdftoppmBin, tesseractBin: config.tesseractBin, ocrLang: config.ocrLang, ocrSogliaCaratteri: config.ocrSogliaCaratteri, tmpPrefix: 'tdr-', clean: puliscaPagina });
export const contaPagine = pdf.contaPagine;
export const testoPagine = pdf.testoPagine;
export const ocrPagine = pdf.ocrPagine;
export const ocrDisponibile = pdf.ocrDisponibile;
export const estraiTesto = pdf.estraiTesto;

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
