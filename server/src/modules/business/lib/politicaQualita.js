// Contratto Service (MOD230), Allegato 8 "Politica della Qualità di Toscana Diagnostica" (richiesta del CEO del 07/11/2026: "dal
// widget SGI prendi la versione della politica della qualità più aggiornata e allegala come ultimo allegato al contratto"). Il documento
// si cerca nello specchio del Portale SGI (modulo sgi: docs.json e cache dei file, come il Vademecum del Portale Service nel Pacchetto)
// con la regola pura cercaPoliticaQualita (mod230.js); il PDF si accoda al contratto. Mai silenzio: se il modulo non è avviato, lo
// specchio è vuoto o il PDF non si legge, `avviso` lo dice (evento GENERATO e risposta della generazione) e l'allegato nel documento
// riporta "Documento non disponibile dallo specchio SGI".
import { getModuleState } from '../../../lib/modules.js';
import { readBuffer } from './storage.js';
import { cercaPoliticaQualita } from './mod230.js';

/** { doc: { code, rev, data, title, pdf } | null, pdf: Buffer | null, avviso: string | null } */
export async function politicaQualita() {
  const st = await getModuleState('sgi');
  if (!st.schema_ready || !['LIVE', 'MIRROR'].includes(st.mode)) return { doc: null, pdf: null, avviso: 'Politica della Qualità non allegata: il modulo SGI Management (specchio del Portale SGI) non è avviato' };
  let S;
  try { S = await import('../../sgi/lib/specchio.js'); } catch (e) { return { doc: null, pdf: null, avviso: `Politica della Qualità non allegata: specchio SGI non leggibile (${e.message})` }; }
  let docs;
  try { docs = (await S.contenuto('docs'))?.json; } catch (e) { return { doc: null, pdf: null, avviso: `Politica della Qualità non allegata: specchio SGI non leggibile (${e.message})` }; }
  if (!Array.isArray(docs) || !docs.length) return { doc: null, pdf: null, avviso: 'Politica della Qualità non allegata: lo specchio SGI è vuoto (SGI Management > Impostazioni, "Aggiorna adesso" o import dello ZIP)' };
  const d = cercaPoliticaQualita(docs);
  if (!d) return { doc: null, pdf: null, avviso: 'Politica della Qualità non allegata: documento non disponibile dallo specchio SGI' };
  const doc = { code: d.code, rev: d.rev, data: d.data, title: d.title, pdf: d.pdf };
  try {
    // nello specchio i PDF dei documenti stanno sotto docs/ (come i link del widget: web/src/modules/sgi/dati.js, docUrl)
    const { file } = await S.leggiFile(`docs/${String(d.pdf).replace(/^\/+/, '').replace(/^docs\//, '')}`);
    const buf = await readBuffer(file);
    if (!buf || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('il file non è un PDF');
    return { doc, pdf: buf, avviso: null };
  } catch (e) {
    return { doc, pdf: null, avviso: `Politica della Qualità ${d.code} non allegata: PDF non disponibile dallo specchio SGI (${e.message})` };
  }
}
