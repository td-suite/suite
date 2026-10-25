// Estrazione del testo da un PDF (chiusura cassa del gestionale, Stampa cassa per utente di GIPO).
// L'app di origine usa pdf-parse 2.x (classe PDFParse); nella Suite il pacchetto pdf-parse è condiviso con altri moduli e può
// essere la 1.x (funzione pdfParse(buffer)). Qui si usa quella installata, con la stessa resa del testo riga per riga.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let v2 = null, v2Tried = false;

async function loadV2() {
  if (v2Tried) return v2;
  v2Tried = true;
  try { const m = await import('pdf-parse'); v2 = m.PDFParse ? m : null; } catch { v2 = null; }   // la 1.x in ESM tenta di leggere un file di test e fallisce
  return v2;
}

// pdf-parse 1.x: ricostruzione delle righe per coordinata y, con spazi tra le parole (la resa di default incolla le voci)
function renderPageV1(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((tc) => {
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
  });
}

export async function pdfText(buffer) {
  const m = await loadV2();
  if (m) {
    const parser = new m.PDFParse({ data: new Uint8Array(buffer) });
    try { return (await parser.getText()).text || ''; } finally { await parser.destroy().catch(() => {}); }
  }
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const out = await pdfParse(buffer, { pagerender: renderPageV1 });
  return out.text || '';
}
