// Circolari · documenti del SGI agganciati alla circolare (v0.98.0, CEO 25/11/2026): elenco dallo specchio del portale SGI della Suite
// e unione dei loro PDF in coda al PDF della circolare. Il documento si prende nella versione "stampabile" (senza copertina) quando il
// SGI la pubblica, altrimenti nel PDF completo. Un allegato che non si riesce a leggere non blocca la circolare: l'esito lo dice.
import { PDFDocument } from 'pdf-lib';
import { readBuffer } from '../../../lib/moduleStorage.js';

const semplice = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
async function specchio() { return import('../../sgi/lib/specchio.js'); }

/** Documenti del SGI che corrispondono alla ricerca (codice o titolo): [{ code, titolo, rev, area, file, stampabile }]. */
export async function cercaDocumentiSgi(testo, { limite = 30 } = {}) {
  let docs;
  try { docs = (await (await specchio()).contenuto('docs'))?.json; } catch { docs = null; }
  if (!Array.isArray(docs)) return { disponibile: false, righe: [] };
  const parole = semplice(testo).split(/\s+/).filter(Boolean);
  const righe = [];
  for (const d of docs) {
    if (!d?.code || !(d.stampabile || d.pdf)) continue;
    const dove = semplice(`${d.code} ${d.code.replace(/^TD-SGI-/i, '')} ${d.title || ''}`);
    if (parole.length && !parole.every((w) => dove.includes(w))) continue;
    righe.push({ code: d.code, titolo: d.title || d.code, rev: d.rev ?? null, area: d.area || null, file: d.stampabile ? `stampabili/${d.stampabile}` : `docs/${d.pdf}`, stampabile: Boolean(d.stampabile) });
    if (righe.length >= limite) break;
  }
  return { disponibile: true, righe };
}

/**
 * Unisce al PDF della circolare i PDF degli allegati del SGI, nell'ordine dato. Ritorna { pdf, pagine, esito: [{ code, ok, pagine,
 * errore }] }. leggi(file) → Buffer è sostituibile nei test; per default legge dallo specchio del SGI (cache o sito di origine).
 */
export async function unisciAllegati(pdfCircolare, allegati, { leggi = null } = {}) {
  const esito = [];
  if (!pdfCircolare || !Array.isArray(allegati) || !allegati.length) return { pdf: pdfCircolare, pagine: null, esito };
  const leggiFile = leggi || (async (file) => { const { file: f } = await (await specchio()).leggiFile(file); return readBuffer(f); });
  const out = await PDFDocument.load(pdfCircolare);
  for (const a of allegati) {
    try {
      const buf = await leggiFile(a.file);
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pagine = await out.copyPages(src, src.getPageIndices());
      pagine.forEach((p) => out.addPage(p));
      esito.push({ code: a.code, ok: true, pagine: pagine.length });
    } catch (e) { esito.push({ code: a.code, ok: false, errore: String(e.message || e).slice(0, 200) }); }
  }
  const pdf = Buffer.from(await out.save());
  return { pdf, pagine: out.getPageCount(), esito };
}
