// Rilevamento della sorgente, spezzamento dei merge per paziente e dispatch al parser. Tutti i parser producono lo stesso
// JSON intermedio: { sorgente, variante, corpo, anagrafica, settori, esami, antibiogrammi, note, anomalie, conteggi }.
import * as bianalisi from './bianalisi.js';
import * as cerbaRdi from './cerbaRdi.js';
import * as cerbaNuovaIgea from './cerbaNuovaIgea.js';
import { anagraficaA, anagraficaB, anomalieAnagrafica, chiaveAnagrafica, separaIntestazione, anomalia, testoRiquadro } from './common.js';
import { parseCorpo1, contaAntibioticiTesto1 } from './corpo1.js';

const PARSER = { BIANALISI: bianalisi, CERBA_RDI: cerbaRdi, CERBA_NUOVA_IGEA: cerbaNuovaIgea };

// Sorgente di una pagina (null se nessuna intestazione nota)
export function rilevaSorgente(testoPagina) {
  // Nuova Igea prima di RDI: entrambe portano "Cerba HealthCare"
  if (cerbaNuovaIgea.riconosci(testoPagina)) return 'CERBA_NUOVA_IGEA';
  if (cerbaRdi.riconosci(testoPagina)) return 'CERBA_RDI';
  if (bianalisi.riconosci(testoPagina)) return 'BIANALISI';
  return null;
}

// Un PDF sembra un referto anche senza intestazione nota se ha un'anagrafica e righe risultato riconoscibili
export function sembraReferto(testo) {
  const a = { ...anagraficaA(testo.split('\n')), ...anagraficaB(testo.split('\n')) };
  return Boolean(a.cognome_nome && (a.data_nascita || a.accettazione_n || a.referto_codice)) && /(Risultat|Esito|Negativo|Positivo|UFC|MIC)/i.test(testo);
}

// Parser generico per una sorgente non riconosciuta (sorgente ALTRO, anomalia "sorgente non riconosciuta, verifica"): non è uno scarto,
// il corpo 1 a tre colonne (nome | valore con unità | riferimento) è il formato di default; nessun titolo di settore se la sorgente non lo ha
const generico = {
  pagina(testo) {
    const righe = testo.split('\n');
    const { testa, corpo, testataColonne } = separaIntestazione(righe, { testataColonne: /Risultat/i, fineIntestazione: /Data\s*Acc|\(anni\s*\d+\)|Sesso|Indirizzo|Residen|Luogo\s+di\s+nascita|Nat[oa]\s+(a|in)\b/i });
    const base = testa.length ? testa : righe.slice(0, 10);
    const b = anagraficaB(base);
    const anagrafica = { ...anagraficaA(base), ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v && k !== 'variante')) };
    anagrafica.variante = b.referto_codice || b.accettazione_codice ? 'B' : 'A';   // variante B solo con i codici Referto/Accettazione di Bianalisi
    return { anagrafica, chiave: chiaveAnagrafica(anagrafica), corpo, testata: testataColonne };
  },
  scheda(pagine) {
    const anomalie = [anomalia('SORGENTE_ALTRO')];
    const stato = { settori: [], note: [], corrente: null, ultimaRiga: null, ultimoEsame: null, pos: null };
    let anagrafica = null;
    const corpi = [];
    for (const p of pagine) {
      const pg = generico.pagina(p.testo);
      if (!anagrafica) anagrafica = pg.anagrafica; else for (const [k, v] of Object.entries(pg.anagrafica)) if (v && !anagrafica[k]) anagrafica[k] = v;
      parseCorpo1(pg.corpo, { testata: pg.testata, anomalie, stato });   // corpo 1 a tre colonne: formato di default per le sorgenti non riconosciute
      corpi.push(pg.corpo);
    }
    anagrafica = anagrafica || { variante: 'A' };
    anomalie.push(...anomalieAnagrafica(anagrafica));
    const testo_sorgente = testoRiquadro(anagrafica, corpi);
    return { sorgente: 'ALTRO', variante: anagrafica.variante || 'A', corpo: 1, anagrafica, settori: stato.settori, esami: [], antibiogrammi: [], note: stato.note, anomalie,
      conteggi: { antibiotici_sorgente: contaAntibioticiTesto1(testo_sorgente) }, testo_sorgente };
  },
};

// Spezza le pagine (già testo) in gruppi per paziente: nuova scheda quando cambia cognome/nome + accettazione nell'intestazione;
// le pagine senza intestazione riconoscibile sono continuazione della scheda precedente.
export function spezzaPerPaziente(pagine, sorgente) {
  const parser = PARSER[sorgente] || generico;
  const gruppi = [];
  let corrente = null;
  pagine.forEach((testo, i) => {
    const pg = parser.pagina(testo);
    const chiave = pg.chiave;
    if (!corrente || (chiave && corrente.chiave && chiave !== corrente.chiave) || (chiave && !corrente.chiave && corrente.pagine.length && !testo.trim())) {
      corrente = { chiave, pagine: [] }; gruppi.push(corrente);
    } else if (chiave && !corrente.chiave) corrente.chiave = chiave;
    corrente.pagine.push({ n: i + 1, testo });
  });
  // pagine completamente vuote in testa a un gruppo: si saltano
  return gruppi.filter((g) => g.pagine.some((p) => p.testo.trim()));
}

// Elabora un PDF già estratto: { sorgente, schede: [{ pagine:[n], dati, anomalie, testo_sorgente }], motivo_scarto }.
// testo_sorgente = riga anagrafica + riquadro dei risultati (mai l'intero testo del PDF).
export function elabora({ pagine, ocr = false, ocr_lingua = null }) {
  const testoTutto = pagine.join('\n');
  let sorgente = null;
  for (const p of pagine) { sorgente = rilevaSorgente(p); if (sorgente) break; }
  if (!sorgente && !sembraReferto(testoTutto)) {
    return { sorgente: 'ALTRO', schede: [], motivo_scarto: 'Il PDF non è un referto di un laboratorio esterno conosciuto (nessuna intestazione Bianalisi, Cerba RDI Limena o Cerba Nuova Igea e nessuna anagrafica riconoscibile)' };
  }
  const key = sorgente || 'ALTRO';
  const parser = PARSER[key] || generico;
  const gruppi = spezzaPerPaziente(pagine, key);
  const schede = gruppi.map((g) => {
    const dati = parser.scheda(g.pagine);
    const anomalie = [...dati.anomalie];
    const testo_sorgente = dati.testo_sorgente || '';
    delete dati.anomalie; delete dati.testo_sorgente;
    if (ocr) anomalie.unshift(anomalia('OCR', ocr_lingua && ocr_lingua !== 'ita' ? `lingua ${ocr_lingua}, pacchetto italiano non installato` : undefined));
    return { pagine: g.pagine.map((p) => p.n), dati, anomalie: dedup(anomalie), testo_sorgente };
  });
  return { sorgente: key, schede, motivo_scarto: null };
}

const dedup = (arr) => { const seen = new Set(); return arr.filter((a) => { const k = `${a.codice}|${a.testo}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

export { PARSER };
