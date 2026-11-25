// Impaginazione di una circolare in file: DOCX sempre (lib/render.js), PDF con LibreOffice se disponibile (lib/pdf.js).
// Non scrive nel database: la usano la pubblicazione del modulo (routes/circolari.js) e il ponte con Comunicazione (lib/ponte.js),
// ognuno con la propria connessione e transazione.
import { renderDocx } from './render.js';
import { docxToPdf, pdfAvailable, pdfPages } from './pdf.js';
import { unisciAllegati } from './allegatiSgi.js';

export async function produciFile(c, { publicUrl = null } = {}) {
  const { buffer, orientamento } = await renderDocx(c, { publicUrl });
  let pdf = null, pages = null, error = null;
  if (await pdfAvailable()) {
    try { pdf = await docxToPdf(buffer); pages = pdfPages(pdf); } catch (e) { error = e.message; }
  } else error = 'LibreOffice non disponibile su questo server: generato solo il DOCX';
  // documenti del SGI agganciati: uniti in coda al PDF (il DOCX resta la sola circolare)
  let allegati = null;
  if (pdf && Array.isArray(c.allegati_sgi) && c.allegati_sgi.length) {
    try {
      const u = await unisciAllegati(pdf, c.allegati_sgi);
      pdf = u.pdf; pages = u.pagine ?? pages; allegati = u.esito;
      const no = u.esito.filter((x) => !x.ok);
      if (no.length) error = `Allegati del SGI non uniti al PDF: ${no.map((x) => `${x.code} (${x.errore})`).join('; ')}`;
    } catch (e) { error = `Allegati del SGI non uniti al PDF: ${e.message}`; }
  }
  return { docx: buffer, pdf, pages, orientamento, error, allegati };
}
