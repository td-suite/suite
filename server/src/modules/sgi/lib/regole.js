// Portale SGI · regole pure (senza database né rete), testate in server/test/sgi-*.test.mjs.
// Le regole comuni ai portali specchiati (link stabili /p /m /doc come app.py, JSON canonico e sha, ZIP, intestazione HTTP Basic) sono
// in server/src/lib/specchioRegole.js; qui sono parametrizzate con le chiavi e le cartelle del sito sgi.toscanadiagnostica.it.
// I filtri del cruscotto (famiglie, riquadri, ultime emissioni, documenti cardine) sono nel front-end: web/src/modules/sgi/filtri.js.
import { slug, costruisciIndice, cercaDocumento, risolviLink, validatorePercorsi, mimeDi, urlFile, canonico, shaJson, confrontaSpecchio as confrontaPer,
  senzaNul, validaContenutiPer, normalizzaNomeZip, radiceZip, intestazioneBasic, urlConCredenziali } from '../../../lib/specchioRegole.js';
import { UTENTE_PREDEFINITO } from '../config.js';

// I quattro JSON del sito (data/*.json), tutti generati da build/build_site.py: meta (anche da /api/meta), docs, preparazioni, fulltext
export const CHIAVI = ['meta', 'docs', 'preparazioni', 'fulltext'];
// Cartelle dei file serviti dal sito (PDF di distribuzione e versioni stampabili senza cover) e messi in cache dalla Suite
export const CARTELLE = ['docs', 'stampabili'];

export { slug, costruisciIndice, cercaDocumento, risolviLink, mimeDi, urlFile, canonico, shaJson, senzaNul, normalizzaNomeZip, radiceZip, urlConCredenziali };
/** Percorso di un file ammesso nella cache (docs/<area>/<file>.pdf, stampabili/<file>.pdf), normalizzato; null se non ammesso. */
export const percorsoValido = validatorePercorsi(CARTELLE);
/** Confronto tra lo specchio salvato e quanto letto ora dall'origine (build e sha dei quattro JSON). Ritorna { cambiato, motivi }. */
export const confrontaSpecchio = (prec, nuovo) => confrontaPer(prec, nuovo, CHIAVI);
/** Controlli minimi sui JSON letti (dall'origine o dallo ZIP): meta.build, docs elenco, preparazioni.righe, fulltext oggetto. */
export function validaContenuti(c) {
  const errori = validaContenutiPer(c, CHIAVI);
  if (c.fulltext !== undefined && (typeof c.fulltext !== 'object' || c.fulltext === null || Array.isArray(c.fulltext))) errori.push('fulltext.json non è un oggetto codice → testo');
  return errori;
}
/** Authorization per l'origine protetta (SGI_USER/SGI_PASSWORD del sito): utente vuoto = "sgi" come app.py. Null senza password. */
export const autorizzazioneSgi = (utente, password) => intestazioneBasic(utente, password, UTENTE_PREDEFINITO);

/** Codici base (senza revisione) dei documenti dello specchio: servono al Portale Service per rimandare alla scheda SGI. */
export function codiciBase(docs = []) {
  const out = new Set();
  for (const d of docs || []) {
    if (!d?.code) continue;
    out.add(/_0[a-z]$/.test(d.code) ? d.code : d.code.split('_')[0]);
  }
  return [...out].sort();
}
