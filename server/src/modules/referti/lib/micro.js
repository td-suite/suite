// Antibiogramma del corpo 1 (Bianalisi) reso come il modello del Laboratorio (STEFANI, 29/10/2026; correzione del CEO del 31/10/2026
// sul caso RECCHIA): le righe del settore restano quelle del parser (modificabili nella scheda), ma alla resa il blocco microbiologico
// che contiene gli antibiotici diventa
//   titolo dell'esame (es. URINOCOLTURA) + Metodo / Materiale + tabella etichetta/valore (Esito, Germe Isolato, Carica, ESBL…)
//   + "Microrganismo #n: specie" + tabella teal dell'antibiogramma (legenda | specie #n | MIC) con S / I / R e MIC.
// Funzione pura: nessun dato inventato, ogni valore viene da una riga della scheda; le righe fuori dal blocco restano nella tabella
// a tre colonne del corpo 1 (prima e dopo, nell'ordine della sorgente).
import { compattaSpazi } from './text.js';

const RE_COLTURA = /coltur|tampone|espettorato|secreto|emocolt|coprocolt|urinocolt|liquido|broncoaspirato|catetere/i;
const RE_ACCESSORIA = /^(Germe\s+Isolato|Microrganismo\s+Isolato|Specie\s+(Microbiche|Isolata)|Carica\b|ESBL\b|Antibiogramma|Antimicogramma|Esito\b)/i;
const RE_GERME = /^(Germe\s+Isolato|Microrganismo\s+Isolato|Specie\s+Isolata)$/i;
const RE_TITOLO_AB = /^(Antibiogramma|Antimicogramma)(\s*\/\s*Antimicogramma)?\s*:?$/i;
const SIR = { SENSIBILE: 'S', INTERMEDIO: 'I', RESISTENTE: 'R', S: 'S', I: 'I', R: 'R' };

export const sirDi = (esito) => SIR[String(esito || '').trim().toUpperCase()] || compattaSpazi(esito);

// Titolo dell'esame dal nome della riga: senza codice "U - " e diviso sull'esito in maiuscolo ("Urinocoltura POSITIVA Ricerca completa
// microrganismi…" → titolo "Urinocoltura", esito "POSITIVA", descrizione "Ricerca completa microrganismi…")
export function titoloEsame(nome) {
  const n = compattaSpazi(nome).replace(/^[A-Z]{1,3}\s*-\s*/, '');
  const m = n.match(/^(.*?)\s+\b(POSITIV[OA]|NEGATIV[OA])\b\s*(.*)$/);
  if (m && m[1]) return { titolo: m[1], flag: m[2], descrizione: m[3] || '' };
  return { titolo: n, flag: '', descrizione: '' };
}

// Righe di legenda consecutive in un testo solo: "Interpretazione Eucast:" + "Resistente" → "Interpretazione Eucast: Resistente"
const unisciLegenda = (testi) => testi.reduce((acc, t) => (!acc ? t : /:\s*$/.test(acc) ? `${acc} ${t}` : `${acc} · ${t}`), '');

const isAntibiotico = (r) => r?.tipo === 'antibiotico';
const isAccessoria = (r) => r && (r.tipo === 'legenda' || (r.tipo === 'testo' && RE_TITOLO_AB.test(compattaSpazi(r.testo))) || (r.tipo === 'esame' && RE_ACCESSORIA.test(compattaSpazi(r.nome))));

/**
 * Divide le righe di un settore del corpo 1 in parti da rendere nell'ordine:
 *   { tipo: 'righe', righe }   tabella a tre colonne del corpo 1
 *   { tipo: 'esame', titolo, nota, metodo, materiale, altre, campi:[{ etichetta, valore, riferimento }], antibiogrammi:[{ n, specie, legenda, righe:[{ antibiotico, sir, mic }] }] }
 * Senza antibiotici: una sola parte 'righe' (resa invariata).
 */
export function partiSettore(righe) {
  const rr = righe || [];
  if (!rr.some(isAntibiotico)) return rr.length ? [{ tipo: 'righe', righe: rr }] : [];
  const parti = [];
  let i = 0; let n = 0;
  while (i < rr.length) {
    const primo = rr.findIndex((r, k) => k >= i && isAntibiotico(r));
    if (primo < 0) { parti.push({ tipo: 'righe', righe: rr.slice(i) }); break; }
    // inizio del blocco: l'ultima riga esame "colturale" (urinocoltura, tampone…) prima del primo antibiotico; altrimenti la prima
    // riga accessoria contigua (Germe Isolato, Carica, legenda) che precede gli antibiotici
    let inizio = -1;
    for (let k = primo - 1; k >= i; k--) if (rr[k].tipo === 'esame' && RE_COLTURA.test(rr[k].nome || '') && !RE_ACCESSORIA.test(compattaSpazi(rr[k].nome))) { inizio = k; break; }
    if (inizio < 0) { inizio = primo; while (inizio - 1 >= i && isAccessoria(rr[inizio - 1])) inizio--; }
    // fine del blocco: ultimo antibiotico di una sequenza di antibiotici e righe accessorie (ESBL in mezzo, antibiogramma su 2 pagine)
    let fine = primo;
    for (let k = primo + 1; k < rr.length; k++) {
      if (isAntibiotico(rr[k])) fine = k;
      else if (!isAccessoria(rr[k])) break;
    }
    if (inizio > i) parti.push({ tipo: 'righe', righe: rr.slice(i, inizio) });
    const blocco = bloccoEsame(rr.slice(inizio, fine + 1), n);
    n += blocco.antibiogrammi.length;
    parti.push(blocco);
    i = fine + 1;
  }
  return parti;
}

function bloccoEsame(righe, nPrima) {
  const e = { tipo: 'esame', titolo: '', nota: '', metodo: '', materiale: '', altre: [], campi: [], antibiogrammi: [] };
  const sotto = (lista) => {
    for (const s of lista || []) {
      const m = compattaSpazi(s).match(/^(Metodo|Materiale|Campione|Sede Anatomica|Sede)\s*:?\s*(.*)$/i);
      if (!m) { if (!e.altre.includes(s)) e.altre.push(compattaSpazi(s)); continue; }
      const k = m[1].toLowerCase(); const v = compattaSpazi(m[2]);
      if (k === 'metodo') { if (!e.metodo) e.metodo = v; else if (e.metodo.toLowerCase() !== v.toLowerCase() && !e.altre.includes(`Metodo: ${v}`)) e.altre.push(`Metodo: ${v}`); }
      else if (k === 'materiale' || k === 'campione') { if (!e.materiale) e.materiale = v; else if (e.materiale.toLowerCase() !== v.toLowerCase() && !e.altre.includes(`Materiale: ${v}`)) e.altre.push(`Materiale: ${v}`); }
      else if (!e.altre.includes(`Sede Anatomica: ${v}`)) e.altre.push(`Sede Anatomica: ${v}`);
    }
  };
  const campo = (etichetta, valore, riferimento) => {
    if (e.campi.some((c) => c.etichetta === etichetta && c.valore === valore && (c.riferimento || '') === (riferimento || ''))) return;   // "Germe Isolato" ripetuto prima degli antibiotici
    e.campi.push({ etichetta, valore, riferimento: riferimento || '' });
  };
  let legenda = []; let specie = ''; let corrente = null;
  righe.forEach((r, k) => {
    if (r.tipo === 'esame' && k === 0 && !RE_ACCESSORIA.test(compattaSpazi(r.nome))) {
      // riga dell'esame colturale: titolo, esito, riferimento
      const t = titoloEsame(r.nome);
      e.titolo = t.titolo;
      e.nota = [t.descrizione, r.descrizione].filter(Boolean).join(' ');
      const esito = [t.flag, compattaSpazi(`${r.risultato || ''}${r.unita ? ` ${r.unita}` : ''}`)].filter(Boolean).join(' ');
      if (esito || r.riferimento) campo('Esito', esito, r.riferimento);
      sotto(r.sotto);
      return;
    }
    if (r.tipo === 'esame') {
      const nome = compattaSpazi(`${r.nome}${r.descrizione ? ` ${r.descrizione}` : ''}`);
      if (RE_GERME.test(compattaSpazi(r.nome))) specie = compattaSpazi(r.risultato);
      campo(nome, compattaSpazi(`${r.risultato || ''}${r.unita ? ` ${r.unita}` : ''}`), r.riferimento);
      sotto(r.sotto);
      return;
    }
    if (r.tipo === 'legenda') { legenda.push(compattaSpazi(r.testo)); return; }
    if (r.tipo === 'testo') { if (!RE_TITOLO_AB.test(compattaSpazi(r.testo))) campo('', compattaSpazi(r.testo)); return; }
    if (r.tipo === 'antibiotico') {
      // un nuovo "Germe Isolato" diverso dal microrganismo corrente apre un altro antibiogramma (#2)
      if (!corrente || (specie && corrente.specie && specie.toLowerCase() !== corrente.specie.toLowerCase() && corrente.righe.length)) {
        corrente = { n: nPrima + e.antibiogrammi.length + 1, specie, legenda: '', righe: [] };
        e.antibiogrammi.push(corrente);
      }
      if (!corrente.specie && specie) corrente.specie = specie;
      corrente.righe.push({ antibiotico: compattaSpazi(r.nome), sir: sirDi(r.esito), mic: compattaSpazi(String(r.mic || '').replace(/^MIC\s*/i, '')) });
    }
  });
  // Nella testata della tabella va la legenda breve del modello (R / I / S); l'interpretazione Eucast per esteso, se c'è, finisce
  // come nota sotto la tabella (nota_legenda), così la testata resta leggibile come nel referto della routine.
  const leg = unisciLegenda(legenda);
  for (const b of e.antibiogrammi) { b.legenda = ''; if (leg) b.nota_legenda = leg; }
  return e;
}
