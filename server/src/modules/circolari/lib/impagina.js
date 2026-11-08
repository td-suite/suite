// Impaginazione di una circolare in file: DOCX sempre (lib/render.js), PDF con LibreOffice se disponibile (lib/pdf.js).
// Non scrive nel database: la usano la pubblicazione del modulo (routes/circolari.js) e il ponte con Comunicazione (lib/ponte.js),
// ognuno con la propria connessione e transazione.
import { renderDocx } from './render.js';
import { docxToPdf, pdfAvailable, pdfPages } from './pdf.js';

export async function produciFile(c, { publicUrl = null } = {}) {
  const { buffer, orientamento } = await renderDocx(c, { publicUrl });
  let pdf = null, pages = null, error = null;
  if (await pdfAvailable()) {
    try { pdf = await docxToPdf(buffer); pages = pdfPages(pdf); } catch (e) { error = e.message; }
  } else error = 'LibreOffice non disponibile su questo server: generato solo il DOCX';
  return { docx: buffer, pdf, pages, orientamento, error };
}
