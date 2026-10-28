// Controllo di coerenza prima della conferma (specifica §5.4): tutti i token "risultato" della sorgente (valori, MIC, S/I/R, UFC,
// classi) devono ricomparire nel testo del DOCX generato; stesso numero di antibiotici; nessun numero in più oltre a quelli
// della sorgente. Esito come checklist [{ codice, ok, testo, dettagli }].
import { pulisci, compattaSpazi } from './text.js';

const norm = (s) => compattaSpazi(pulisci(s)).toLowerCase().replace(/\s*([<>=:/,.-])\s*/g, '$1');
const SIR = new Set(['s', 'i', 'r']);

// Token di un valore: parole e numeri (con virgola/punto decimale, simboli <= > e ^)
export function tokenDi(valore) {
  const n = norm(valore);
  if (!n) return [];
  return (n.match(/(?:<=|>=|<|>)?\d+(?:[.,]\d+)*(?:\^\d+)?|[a-zà-ü]+(?:\/[a-zà-ü]+)?/g) || []).filter((tk) => tk.length >= 2 || SIR.has(tk) || /\d/.test(tk));
}

// Token "risultato" del JSON intermedio (quello del parser = quello della sorgente)
export function tokenRisultati(dati) {
  const out = [];
  const add = (v) => { for (const tk of tokenDi(v)) out.push(tk); };
  for (const s of dati.settori || []) for (const r of s.righe || []) {
    if (r.tipo === 'esame') { add(r.risultato); add(r.unita); add(r.riferimento); }
    else if (r.tipo === 'antibiotico') { add(r.esito); add(r.mic); }
  }
  for (const e of dati.esami || []) for (const c of e.campi || []) add(c.valore);
  for (const b of dati.antibiogrammi || []) { add(b.carica); for (const r of b.righe || []) { add(r.sir); add(r.mic); } }
  for (const n of dati.note || []) add(n);
  const a = dati.anagrafica || {};
  for (const k of ['cognome_nome', 'data_nascita', 'accettazione_n', 'data_acc', 'referto_codice', 'referto_data', 'accettazione_codice', 'accettazione_data']) if (a[k]) add(a[k]);
  return out;
}

export const contaAntibiotici = (dati) => (dati.settori || []).reduce((n, s) => n + (s.righe || []).filter((r) => r.tipo === 'antibiotico').length, 0)
  + (dati.antibiogrammi || []).reduce((n, b) => n + (b.righe || []).length, 0);

// Numeri del testo (per il controllo "nessun numero in più")
const numeri = (s) => new Set((norm(s).match(/\d+(?:[.,]\d+)*/g) || []));

// Etichette aggiunte dal generatore (non sono token della sorgente): si escludono dal confronto dei numeri
const ETICHETTE_TD = ['Data di nascita', 'Sesso', 'Accettazione n°', 'Data Acc.', 'Referto', 'Accettazione', 'Antibiotico', 'S / I / R', 'MIC', 'Microrganismo', 'Metodo', 'Materiale', 'Sede Anatomica', 'anni'];

export function controllaCoerenza({ datiOrig, dati, testoSorgente, testoDocx }) {
  const docx = norm(testoDocx);
  const docxCompatto = docx.replace(/\s+/g, '');
  const presente = (tk) => docx.includes(tk) || docxCompatto.includes(tk.replace(/\s+/g, ''));
  const check = [];
  // 1. token risultato della sorgente nel DOCX
  const tokens = [...new Set(tokenRisultati(datiOrig || dati))];
  const mancanti = tokens.filter((tk) => !presente(tk));
  check.push({ codice: 'TOKEN_RISULTATI', ok: mancanti.length === 0, testo: `Valori della sorgente presenti nel referto TD (${tokens.length - mancanti.length} su ${tokens.length})`, dettagli: mancanti.slice(0, 40) });
  // 2. numero di antibiotici: sorgente (conteggio indipendente sul testo), parser, scheda corrente
  const nSorg = Number(datiOrig?.conteggi?.antibiotici_sorgente ?? dati?.conteggi?.antibiotici_sorgente ?? NaN);
  const nOrig = contaAntibiotici(datiOrig || dati);
  const nNow = contaAntibiotici(dati);
  const atteso = Number.isFinite(nSorg) ? Math.max(nSorg, nOrig) : nOrig;
  check.push({ codice: 'N_ANTIBIOTICI', ok: nNow === atteso, testo: `Numero di antibiotici: ${nNow} nel referto TD, ${atteso} nella sorgente`, dettagli: { sorgente: atteso, scheda: nNow } });
  // 3. nessun numero in più nel DOCX rispetto alla sorgente
  const numSorg = numeri(testoSorgente || '');
  const numDocx = numeri(testoDocx.split('\n').filter((l) => !ETICHETTE_TD.some((e) => norm(l).startsWith(norm(e)) && norm(l).length < 40)).join('\n'));
  // l'età "(anni NN)" e il numero del microrganismo "#n" sono prodotti dal generatore ma vengono dalla sorgente
  const extra = [...numDocx].filter((n) => !numSorg.has(n) && !(dati.anagrafica?.eta != null && String(dati.anagrafica.eta) === n) && !(dati.antibiogrammi || []).some((b) => String(b.n) === n));
  check.push({ codice: 'NUMERI_IN_PIU', ok: extra.length === 0, testo: extra.length ? `Numeri nel referto TD assenti nella sorgente: ${extra.slice(0, 10).join(', ')}` : 'Nessun numero in più rispetto alla sorgente', dettagli: extra.slice(0, 40) });
  // 4. anagrafica compilata
  const a = dati.anagrafica || {};
  const okAn = Boolean(a.cognome_nome && a.data_nascita && (a.accettazione_n || a.accettazione_codice || a.referto_codice));
  check.push({ codice: 'ANAGRAFICA', ok: okAn, testo: okAn ? 'Anagrafica completa (cognome e nome, data di nascita, accettazione)' : 'Anagrafica incompleta: cognome e nome, data di nascita e accettazione sono obbligatori' });
  return { ok: check.every((c) => c.ok), check };
}
