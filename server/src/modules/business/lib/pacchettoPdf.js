// Business Hub · Pacchetto di benvenuto: unione dei PDF (pagine nostre, lettera di offerta generata, Vademecum dallo specchio del
// Portale Service) in un unico PDF con numerazione delle pagine e segnalibri (pdf-lib, JavaScript puro: niente qpdf/pdftk
// nell'immagine Docker).
// Numerazione (parte.numero): 'piede' sulle pagine nostre, dove la carta intestata aveva il campo PAGE (a destra sopra i dati
// societari, che pacchettoDocx.js toglie dal piè); 'copri' sulla lettera di offerta, che è sulla stessa carta intestata con il suo
// numero nello stesso punto: il numero dell'offerta si copre con un riquadro bianco e al suo posto va quello del pacchetto; 'testa' sul
// Vademecum (intestazione e fascia di piè proprie, con "Pagina N di M"): in alto a destra, piccolo, con la dicitura del pacchetto.
// La copertina non ha numero.
import { PDFDocument, PDFName, PDFNull, PDFNumber, PDFHexString, PDFArray, StandardFonts, rgb } from 'pdf-lib';

const TEAL = rgb(0x1b / 255, 0x50 / 255, 0x5f / 255);
const GRIGIO = rgb(0x5a / 255, 0x6b / 255, 0x70 / 255);
// Posizione del numero sulle pagine nostre (pt, origine in basso a sinistra): bordo destro del testo, linea di base
export const NUMERO_NOSTRE = { destra: 538.75, y: 69.5, size: 9 };
// Riquadro che copre il numero di pagina dell'offerta (stessa carta intestata: numero tra x 528 e 539, y 66-77 dal basso)
export const COPRI_NUMERO = { x: 492, y: 65, w: 52, h: 14 };

/** PDF valido e leggibile? Ritorna il numero di pagine o 0. */
export async function contaPagine(buf) {
  try { return (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch { return 0; }
}

/**
 * Pagine iniziali di ogni parte: parti [{ key, pagine }] nell'ordine → { key: numero della prima pagina (1-based) }. Pura, testata.
 */
export function paginaIniziale(parti) {
  const out = {}; let n = 1;
  for (const x of parti) { out[x.key] = n; n += Number(x.pagine) || 0; }
  return out;
}

/**
 * Unione. parti: [{ key, titolo, pdf: Buffer, numero: 'piede'|'copri'|'testa', segnalibro: bool, segnalibriInterni: [{ titolo, pagina }] }]
 * nell'ordine di stampa.
 * Ritorna { pdf: Buffer, pagine, inizi: { key: pagina } }.
 */
export async function assembla(parti, { titolo = 'Pacchetto di benvenuto', autore = 'Toscana Diagnostica', etichettaEsterne = 'Pacchetto di benvenuto' } = {}) {
  const out = await PDFDocument.create();
  out.setTitle(titolo, { showInWindowTitleBar: true });
  out.setAuthor(autore); out.setCreator('Suite TD · Business Hub'); out.setProducer('Suite TD'); out.setLanguage('it-IT');
  out.setCreationDate(new Date()); out.setModificationDate(new Date());
  const font = await out.embedFont(StandardFonts.Helvetica);
  const inizi = {}; const tipi = [];
  for (const parte of parti) {
    const src = await PDFDocument.load(parte.pdf, { ignoreEncryption: true, updateMetadata: false });
    const pagine = await out.copyPages(src, src.getPageIndices());
    inizi[parte.key] = out.getPageCount() + 1;
    for (const pg of pagine) { out.addPage(pg); tipi.push({ key: parte.key, numero: parte.numero || (parte.esterna ? 'testa' : 'piede') }); }
  }
  const totale = out.getPageCount();
  out.getPages().forEach((pg, i) => {
    const t = tipi[i];
    if (t.key === 'copertina') return;
    const n = String(i + 1);
    const { width, height } = pg.getSize();
    if (t.numero === 'piede' || t.numero === 'copri') {
      if (t.numero === 'copri') pg.drawRectangle({ x: COPRI_NUMERO.x, y: COPRI_NUMERO.y, width: COPRI_NUMERO.w, height: COPRI_NUMERO.h, color: rgb(1, 1, 1) });
      const w = font.widthOfTextAtSize(n, NUMERO_NOSTRE.size);
      pg.drawText(n, { x: NUMERO_NOSTRE.destra - w, y: NUMERO_NOSTRE.y, size: NUMERO_NOSTRE.size, font, color: TEAL });
    } else {
      const txt = `${etichettaEsterne}  ·  pagina ${n} di ${totale}`;
      const size = 7;
      const w = font.widthOfTextAtSize(txt, size);
      pg.drawText(txt, { x: width - 28 - w, y: height - 18, size, font, color: GRIGIO });
    }
  });
  // segnalibriInterni: voci dentro una parte (pagina 1-based nella parte), subito dopo la voce della parte (es. l'offerta economica
  // nell'Allegato 1 della lettera di offerta)
  aggiungiSegnalibri(out, parti.filter((x) => x.segnalibro !== false).flatMap((x) => [{ titolo: x.titolo, pagina: inizi[x.key] },
    ...(x.segnalibriInterni || []).map((y) => ({ titolo: y.titolo, pagina: inizi[x.key] + Number(y.pagina) - 1 }))]));
  const pdf = Buffer.from(await out.save({ useObjectStreams: true }));
  return { pdf, pagine: totale, inizi };
}

/** Segnalibri di primo livello (outline) che portano alla prima pagina di ogni sezione; il lettore apre il pannello. */
export function aggiungiSegnalibri(doc, voci) {
  if (!voci.length) return;
  const ctx = doc.context;
  const pagine = doc.getPages();
  const rootRef = ctx.nextRef();
  const refs = voci.map(() => ctx.nextRef());
  voci.forEach((v, i) => {
    const dest = PDFArray.withContext(ctx);
    dest.push(pagine[Math.max(0, Math.min(pagine.length - 1, v.pagina - 1))].ref); dest.push(PDFName.of('XYZ')); dest.push(PDFNull); dest.push(PDFNull); dest.push(PDFNull);
    const d = { Title: PDFHexString.fromText(v.titolo), Parent: rootRef, Dest: dest };
    if (i > 0) d.Prev = refs[i - 1];
    if (i < voci.length - 1) d.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(d));
  });
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(voci.length) }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Segnalibri di un PDF (per i test e il collaudo): [{ titolo, pagina }] */
export async function leggiSegnalibri(buf) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = doc.context;
  const pagine = doc.getPages().map((p) => p.ref.toString());
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  const out = [];
  if (!root) return out;
  let ref = root.get(PDFName.of('First'));
  while (ref) {
    const it = ctx.lookup(ref);
    const dest = it.lookup(PDFName.of('Dest'));
    const pRef = dest?.get?.(0)?.toString();
    out.push({ titolo: it.lookup(PDFName.of('Title')).decodeText(), pagina: pagine.indexOf(pRef) + 1 });
    ref = it.get(PDFName.of('Next'));
  }
  return out;
}
