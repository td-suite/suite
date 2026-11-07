// Contratto Service (MOD230) e lettera MdL (MOD231): ritocchi del PDF prodotto da LibreOffice (richiesta del CEO del 07/11/2026).
// - Firma di Toscana Diagnostica: l'immagine caricata in Impostazioni (firmaTd.js) apposta in ogni blocco firme, nello spazio tra la
//   qualifica e il nome del firmatario della colonna di TD (posizioni lette dal PDF con pdf-parse, regola pura spaziFirma in mod230.js):
//   proporzioni conservate, trasparenza del PNG rispettata (pdf-lib la porta come SMask), nessuna deformazione.
// - Politica della Qualità: le pagine del PDF dello specchio SGI in coda al contratto (pdf-lib).
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import { spaziFirma, misuraFirma } from './mod230.js';

const require = createRequire(import.meta.url);

/** Testo con le posizioni, pagina per pagina: [{ w, h, items: [{ s, x, y, w, h }] }] (coordinate PDF). */
export async function posizioniTesto(buf) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');   // la 1.x dall'indice legge un file di prova e fallisce in ESM
  const pagine = [];
  await pdfParse(buf, {
    pagerender: (pd) => {
      const vp = pd.getViewport(1);
      const idx = pd.pageIndex;
      return pd.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
        pagine[idx] = { w: vp.width, h: vp.height, items: tc.items.map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) })) };
        return '';
      });
    },
  });
  return pagine.map((p) => p || { w: 0, h: 0, items: [] });
}

/**
 * Appone la firma (immagine PNG o JPG) nei blocchi firme di TD. firmatario = { nome, ruolo } come stampati nel documento.
 * Ritorna { pdf, apposte } (apposte = numero di blocchi firmati; 0 = nessuno spazio trovato, PDF invariato).
 */
export async function apponiFirma(pdfBuf, immagine, firmatario) {
  const spazi = spaziFirma(await posizioniTesto(pdfBuf), firmatario);
  if (!spazi.length) return { pdf: pdfBuf, apposte: 0 };
  const doc = await PDFDocument.load(pdfBuf);
  const img = immagine.mime === 'image/png' ? await doc.embedPng(immagine.buffer) : await doc.embedJpg(immagine.buffer);
  const pagine = doc.getPages();
  for (const s of spazi) {
    const m = misuraFirma(s, img.width, img.height);
    pagine[s.pagina].drawImage(img, m);
  }
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), apposte: spazi.length };
}

/** Accoda le pagine di un altro PDF. Ritorna { pdf, pagine } (pagine accodate). */
export async function accodaPdf(pdfBuf, codaBuf) {
  const doc = await PDFDocument.load(pdfBuf);
  const coda = await PDFDocument.load(codaBuf, { ignoreEncryption: true });
  const copie = await doc.copyPages(coda, coda.getPageIndices());
  for (const p of copie) doc.addPage(p);
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), pagine: copie.length };
}

/** Larghezza e altezza in pixel di un PNG/JPG (validazione del caricamento): lancia se l'immagine non è leggibile. */
export async function dimensioniImmagine(buf, mime) {
  const doc = await PDFDocument.create();
  const img = mime === 'image/png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  return { larghezza: img.width, altezza: img.height };
}
