// Contratto Service (MOD230) e lettera MdL (MOD231): ritocchi del PDF prodotto da LibreOffice (richiesta del CEO del 07/11/2026).
// - Firma di Toscana Diagnostica: l'immagine caricata in Impostazioni (firmaTd.js) apposta in ogni blocco firme, nello spazio tra la
//   qualifica e il nome del firmatario della colonna di TD (posizioni lette dal PDF con pdf-parse, regola pura spaziFirma in mod230.js):
//   proporzioni conservate, trasparenza del PNG rispettata (pdf-lib la porta come SMask), nessuna deformazione.
// - Politica della Qualità: le pagine del PDF dello specchio SGI in coda al contratto (pdf-lib).
// - Allegato 1 (seconda richiesta del CEO del 07/11/2026): le pagine dell'Offerta economica impaginata (offertaEconomica.js) inserite
//   dopo la pagina dell'Allegato 1 e prima dell'Allegato 2, posizione letta dal testo del PDF (posizioneOffertaAllegato1 in mod230.js);
//   se il contratto ha già dei segnalibri, uno in più per l'offerta economica.
// - Margine inferiore (terza richiesta del 07/11/2026): controllaPiede verifica che nessun testo del corpo stia nella fascia del piè di
//   pagina (regola pura testoSulPiede in mod230.js), sul PDF del contratto prima dell'inserimento dell'offerta e della Politica.
import { createRequire } from 'node:module';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNull, PDFNumber, PDFHexString } from 'pdf-lib';
import { spaziFirma, misuraFirma, posizioneOffertaAllegato1, testoSulPiede } from './mod230.js';

const require = createRequire(import.meta.url);

/** Testo con le posizioni, pagina per pagina: [{ w, h, items: [{ s, x, y, w, h }] }] (coordinate PDF). */
export async function posizioniTesto(buf) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');   // la 1.x dall'indice legge un file di prova e fallisce in ESM
  const pagine = [];
  // copia con un ArrayBuffer tutto suo: un Buffer piccolo di Node sta nel pool condiviso (byteOffset ≠ 0) e il pdf.js di pdf-parse
  // leggerebbe i byte sbagliati ("bad XRef entry")
  await pdfParse(new Uint8Array(buf), {
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

/** Testo di ogni pagina (stringhe), dalle posizioni di pdf-parse: le righe in ordine di lettura, separate da a capo. */
export async function testoPagine(buf) {
  return (await posizioniTesto(buf)).map((p) => p.items.map((it) => it.s).join(' '));
}

/** Indice (0-based) della pagina di destinazione di un segnalibro: Dest esplicita o azione GoTo; -1 se non si legge (destinazione con nome). */
function paginaSegnalibro(doc, voce, refs) {
  let dest = voce.lookup(PDFName.of('Dest'));
  if (!dest) { const az = voce.lookup(PDFName.of('A')); if (az instanceof PDFDict) dest = az.lookup(PDFName.of('D')); }
  const r = dest instanceof PDFArray ? dest.get(0) : null;
  return r instanceof PDFRef ? refs.indexOf(r.toString()) : -1;
}
/**
 * Segnalibro di primo livello per la pagina `indice` (0-based), solo se il PDF ha già dei segnalibri: inserito nell'ordine delle pagine
 * tra quelli di primo livello (in fondo se le destinazioni non si leggono). Ritorna true se aggiunto.
 */
export function aggiungiSegnalibroSePresenti(doc, titolo, indice) {
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict) || !root.get(PDFName.of('First'))) return false;
  const ctx = doc.context;
  const pagine = doc.getPages();
  const refs = pagine.map((p) => p.ref.toString());
  const rootRef = doc.catalog.get(PDFName.of('Outlines'));
  const voci = [];
  for (let ref = root.get(PDFName.of('First')); ref instanceof PDFRef && voci.length < 10000; ref = ctx.lookup(ref).get(PDFName.of('Next'))) voci.push(ref);
  // la nuova voce va prima del primo segnalibro che porta oltre la pagina inserita
  const dopo = voci.find((r) => paginaSegnalibro(doc, ctx.lookup(r), refs) > indice) || null;
  const prima = dopo ? ctx.lookup(dopo).get(PDFName.of('Prev')) || null : voci[voci.length - 1];
  const dest = PDFArray.withContext(ctx);
  dest.push(pagine[indice].ref); dest.push(PDFName.of('XYZ')); dest.push(PDFNull); dest.push(PDFNull); dest.push(PDFNull);
  const nuovo = ctx.nextRef();
  const d = { Title: PDFHexString.fromText(titolo), Parent: rootRef, Dest: dest };
  if (prima) d.Prev = prima;
  if (dopo) d.Next = dopo;
  ctx.assign(nuovo, ctx.obj(d));
  if (prima) ctx.lookup(prima).set(PDFName.of('Next'), nuovo); else root.set(PDFName.of('First'), nuovo);
  if (dopo) ctx.lookup(dopo).set(PDFName.of('Prev'), nuovo); else root.set(PDFName.of('Last'), nuovo);
  const n = root.lookup(PDFName.of('Count'));
  if (n instanceof PDFNumber) root.set(PDFName.of('Count'), PDFNumber.of(n.asNumber() >= 0 ? n.asNumber() + 1 : n.asNumber() - 1));
  return true;
}

/**
 * Inserisce tutte le pagine di `altroBuf` nel PDF prima della pagina `indice` (0-based; indice = numero di pagine = in coda).
 * Ritorna { pdf, pagine (inserite), segnalibro (aggiunto sì/no) }.
 */
export async function inserisciPdf(pdfBuf, altroBuf, indice, { segnalibro = null } = {}) {
  const doc = await PDFDocument.load(pdfBuf);
  const altro = await PDFDocument.load(altroBuf, { ignoreEncryption: true });
  const n = doc.getPageCount();
  if (!(Number.isInteger(indice) && indice >= 0 && indice <= n)) throw new Error(`posizione ${indice} fuori dal documento (${n} pagine)`);
  const copie = await doc.copyPages(altro, altro.getPageIndices());
  copie.forEach((p, i) => doc.insertPage(indice + i, p));
  const conSegnalibro = segnalibro ? aggiungiSegnalibroSePresenti(doc, segnalibro, indice) : false;
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), pagine: copie.length, segnalibro: conSegnalibro };
}

/**
 * Allegato 1 del contratto Service: inserisce le pagine dell'Offerta economica dopo la pagina dell'Allegato 1, prima dell'Allegato 2.
 * Ritorna { pdf, pagine, posizione: { allegato1, indice } (0-based), segnalibro } o lancia se i titoli degli allegati non si trovano.
 */
export async function inserisciOffertaAllegato1(pdfBuf, offertaBuf, { titolo = 'Allegato 1 · Offerta economica' } = {}) {
  const pos = posizioneOffertaAllegato1(await testoPagine(pdfBuf));
  if (!pos) throw new Error('titoli "ALLEGATO 1" e "ALLEGATO 2" non trovati nel PDF del contratto');
  const r = await inserisciPdf(pdfBuf, offertaBuf, pos.indice, { segnalibro: titolo });
  return { ...r, posizione: pos };
}

/** Testo del corpo sopra il piè di pagina: { pagine, senzaPiede, violazioni } (testoSulPiede sulle posizioni lette dal PDF). */
export async function controllaPiede(pdfBuf, opz = {}) {
  return testoSulPiede(await posizioniTesto(pdfBuf), opz);
}
