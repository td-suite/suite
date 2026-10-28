// Bianalisi S.p.A. – Laboratorio Firenze (variante B, corpo 1): 1 paziente per PDF, 1–3 pagine.
// Intestazione: "Referto R3YE… del gg/mm/aaaa", "Accettazione A3YE… del gg/mm/aaaa", "COGNOME NOME  F-16/04/1974 (anni 52) TOLAFI";
// testata colonne "Analisi | Risultati | Intervalli di Riferimento".
import { anagraficaB, anomalieAnagrafica, separaIntestazione, chiaveAnagrafica } from './common.js';
import { parseCorpo1, contaAntibioticiTesto1 } from './corpo1.js';

export const SORGENTE = 'BIANALISI';
export const riconosci = (testo) => /BIANALISI\s+S\.?p\.?A\.?/i.test(testo) || /\bR3YE[A-Z0-9]*\s+del\s+\d{2}\/\d{2}\/\d{4}/.test(testo);

const TESTATA = /Analisi\s{2,}.*Risultat/i;
const FINE_INTESTAZIONE = /\b[FM]\s*-\s*\d{2}\/\d{2}\/\d{4}\s*\(anni/i;

// Intestazione di una pagina: anagrafica + righe del corpo
export function pagina(testo) {
  const righe = testo.split('\n');
  const { testa, corpo, testataColonne } = separaIntestazione(righe, { testataColonne: TESTATA, fineIntestazione: FINE_INTESTAZIONE });
  const anagrafica = anagraficaB(testa.length ? testa : righe.slice(0, 8));
  return { anagrafica, chiave: chiaveAnagrafica(anagrafica), corpo, testata: testataColonne };
}

// Scheda completa dalle pagine (già raggruppate per paziente)
export function scheda(pagine) {
  const anomalie = [];
  const stato = { settori: [], note: [], corrente: null, ultimaRiga: null, ultimoEsame: null, pos: null };
  let anagrafica = null;
  for (const p of pagine) {
    const pg = pagina(p.testo);
    if (!anagrafica || (!anagrafica.cognome_nome && pg.anagrafica.cognome_nome)) anagrafica = { ...pg.anagrafica, ...(anagrafica || {}), ...pg.anagrafica };
    parseCorpo1(pg.corpo, { testata: pg.testata, anomalie, stato });
  }
  anagrafica = anagrafica || { variante: 'B' };
  anomalie.unshift(...anomalieAnagrafica(anagrafica));
  const testo = pagine.map((p) => p.testo).join('\n');
  return { sorgente: SORGENTE, variante: 'B', corpo: 1, anagrafica, settori: stato.settori, esami: [], antibiogrammi: [], note: stato.note, anomalie,
    conteggi: { antibiotici_sorgente: contaAntibioticiTesto1(testo) } };
}
