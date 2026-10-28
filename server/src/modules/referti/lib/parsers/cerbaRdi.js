// Cerba HealthCare – Rete Diagnostica Italiana (Limena) (variante A, corpo 1): PDF "merge" con più pazienti, una pagina ciascuno.
// Intestazione: "Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA", "Paziente: …", "Accettazione n° …", "Data Acc. …";
// testata colonne "Esame | Risultato | U.M. | Valori di Riferimento".
import { anagraficaA, anomalieAnagrafica, separaIntestazione, chiaveAnagrafica } from './common.js';
import { parseCorpo1, contaAntibioticiTesto1 } from './corpo1.js';

export const SORGENTE = 'CERBA_RDI';
export const riconosci = (testo) => /Rete\s+Diagnostica\s+Italiana/i.test(testo) || /VIA\s+DEL\s+SANTO\s+145/i.test(testo);

const TESTATA = /^\s*Esam[ei]\s{2,}.*Risultat/i;
const FINE_INTESTAZIONE = /Data\s*Acc/i;

export function pagina(testo) {
  const righe = testo.split('\n');
  const { testa, corpo, testataColonne } = separaIntestazione(righe, { testataColonne: TESTATA, fineIntestazione: FINE_INTESTAZIONE });
  const anagrafica = anagraficaA(testa.length ? testa : righe.slice(0, 8));
  return { anagrafica, chiave: chiaveAnagrafica(anagrafica), corpo, testata: testataColonne };
}

export function scheda(pagine) {
  const anomalie = [];
  const stato = { settori: [], note: [], corrente: null, ultimaRiga: null, ultimoEsame: null, pos: null };
  let anagrafica = null;
  for (const p of pagine) {
    const pg = pagina(p.testo);
    if (!anagrafica) anagrafica = pg.anagrafica; else for (const [k, v] of Object.entries(pg.anagrafica)) if (v && !anagrafica[k]) anagrafica[k] = v;
    parseCorpo1(pg.corpo, { testata: pg.testata, anomalie, stato });
  }
  anagrafica = anagrafica || { variante: 'A' };
  anomalie.unshift(...anomalieAnagrafica(anagrafica));
  const testo = pagine.map((p) => p.testo).join('\n');
  return { sorgente: SORGENTE, variante: 'A', corpo: 1, anagrafica, settori: stato.settori, esami: [], antibiogrammi: [], note: stato.note, anomalie,
    conteggi: { antibiotici_sorgente: contaAntibioticiTesto1(testo) } };
}
