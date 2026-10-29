// Controllo di coerenza prima della conferma (specifica §5.4, corretto il 29/10/2026 su indicazione del CEO): tutti i token "risultato"
// del riquadro della sorgente (valori, MIC, S/I/R, UFC, classi) devono ricomparire nel testo del DOCX generato; stesso numero di
// antibiotici; nessun numero in più oltre a quelli della sorgente (riquadro + riga anagrafica); anagrafica completa; controllo inverso:
// nessun testo del laboratorio esterno nel DOCX (intestazioni, codici R3YE/A3YE nel corpo, nomi dei laboratori; le righe di
// accettazione/referto del riquadro anagrafico sono ammesse: fanno parte del modello TD); nessuna testata di tabella, firma o dicitura
// legale nel corpo. Esito come checklist [{ codice, ok, testo, dettagli }].
import { pulisci, compattaSpazi } from './text.js';
import { campiMancanti, isTestataTabella, isFirma, isDicituraLegale, isPieDiPagina } from './parsers/common.js';

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
  // anagrafica del riquadro TD: dati del paziente e riferimenti di accettazione
  const a = dati.anagrafica || {};
  for (const k of ['cognome_nome', 'data_nascita', 'luogo_nascita', 'indirizzo', 'accettazione_n', 'data_acc', 'referto_codice', 'referto_data', 'accettazione_codice', 'accettazione_data']) if (a[k]) add(a[k]);
  return out;
}

export const contaAntibiotici = (dati) => (dati.settori || []).reduce((n, s) => n + (s.righe || []).filter((r) => r.tipo === 'antibiotico').length, 0)
  + (dati.antibiogrammi || []).reduce((n, b) => n + (b.righe || []).length, 0);

// Numeri del testo (per il controllo "nessun numero in più")
const numeri = (s) => new Set((norm(s).match(/\d+(?:[.,]\d+)*/g) || []));

// Etichette aggiunte dal generatore (non sono token della sorgente): si escludono dal confronto dei numeri
const ETICHETTE_TD = ['PAZIENTE', 'Data di nascita', 'Sesso', 'Accettazione n°', 'Data Acc.', 'Referto', 'Accettazione', 'Luogo di nascita', 'Indirizzo', 'Antibiotico', 'S / I / R', 'MIC', 'Microrganismo', 'Metodo', 'Materiale', 'Sede Anatomica', 'anni'];

// Righe del riquadro anagrafico TD che portano i riferimenti di accettazione (ammesse dal controllo inverso)
const RE_RIGA_RIQUADRO = /^(Accettazione\s*n°|Data\s*Acc\.|Referto|Accettazione)\s*:/i;
const senzaRighe = (txt, skip) => txt.split('\n').filter((l) => !skip(compattaSpazi(pulisci(l)))).join('\n');

// Controllo inverso: testo del laboratorio esterno che non deve comparire nel corpo del DOCX. Si tolgono prima le righe del riquadro
// anagrafico con i riferimenti di accettazione e le note interne al riquadro dei risultati (es. "(1) Esame eseguito Bianalisi Verano
// Brianza", "annulla e sostituisce il referto R3YE…"): fanno parte del modello TD.
export const TESTI_LAB_ESTERNO = [
  { re: /\bR3YE[A-Z0-9]*/i, nome: 'codice referto R3YE nel corpo' }, { re: /\bA3YE[A-Z0-9]*/i, nome: 'codice accettazione A3YE nel corpo' },
  { re: /\bAccettazione\s*n/i, nome: '"Accettazione n°" nel corpo' }, { re: /Data\s*Acc\b/i, nome: '"Data Acc." nel corpo' },
  { re: /\bReferto\s+(?=[A-Z0-9]*\d)[A-Z0-9]{6,}/, nome: 'codice di referto esterno nel corpo' },   // codice (maiuscole e cifre), non parole come "firmato"
  { re: /\bBianalisi\b/i, nome: 'Bianalisi' }, { re: /Rete\s+Diagnostica/i, nome: 'Rete Diagnostica' }, { re: /Nuova\s+Igea/i, nome: 'Nuova Igea' }, { re: /\bCerba\b/i, nome: 'Cerba' },
  { re: /\bLimena\b/i, nome: 'Limena' }, { re: /Duccio\s+di\s+Buoninsegna/i, nome: 'via del laboratorio esterno' },
  { re: /Medico\s+richiedente/i, nome: 'medico richiedente' }, { re: /\bDirettore\b/i, nome: 'direttore' }, { re: /firmat[oa]\s+digitalmente/i, nome: 'firma digitale' }, { re: /P\.?\s?IVA/i, nome: 'partita IVA' },
];
export function testoLabEsterno(testoDocx, note = []) {
  const chiavi = new Set((note || []).map((n) => compattaSpazi(pulisci(n))).filter(Boolean));
  const txt = senzaRighe(String(testoDocx || ''), (l) => RE_RIGA_RIQUADRO.test(l) || chiavi.has(l));
  const trovati = [];
  for (const { re, nome } of TESTI_LAB_ESTERNO) { const m = txt.match(re); if (m) trovati.push(`${nome} ("${m[0]}")`); }
  return trovati;
}

// Righe spurie nel corpo del DOCX: testate di tabella, firme (anche digitali), diciture legali/privacy, numeri di pagina, ragione sociale
// del laboratorio cliente (nel corpo: l'intestazione e il piè TD stanno nel template, non in document.xml)
// Testata trascritta come riga di testo (spazi già compattati): solo parole di testata, almeno "Risultato"/"Riferimento"/"Analisi"
const RE_TESTATA_TESTO = /^(?=.*\b(risultat[oi]|riferimento|analisi)\b)(?:(?:esam[ei]|analisi|test|descrizione|risultat[oi]|valor[ei]|esito|u\.?m\.?|unità|unita'?|di misura|um|di|riferimento|riferimenti|intervall[oi]|range|v\.?r\.?|note|metodo|metodica|precedent[ei]|\*|\|)\s*)+$/i;
export function righeSpurie(testoDocx, note = []) {
  const chiavi = new Set((note || []).map((n) => compattaSpazi(pulisci(n))).filter(Boolean));
  const out = [];
  for (const raw of String(testoDocx || '').split('\n')) {
    const l = compattaSpazi(pulisci(raw));
    if (!l || chiavi.has(l)) continue;
    if (isTestataTabella(raw) || RE_TESTATA_TESTO.test(l)) out.push(`testata di tabella: "${l.slice(0, 60)}"`);
    else if (isFirma(l)) out.push(`firma: "${l.slice(0, 60)}"`);
    else if (isDicituraLegale(l)) out.push(`dicitura legale: "${l.slice(0, 60)}"`);
    else if (isPieDiPagina(l)) out.push(`numero di pagina: "${l.slice(0, 60)}"`);
    else if (/Toscana\s+Diagnostica/i.test(l)) out.push(`ragione sociale del cliente: "${l.slice(0, 60)}"`);
  }
  return out;
}

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
  // 4. anagrafica completa: cognome e nome, sesso, data di nascita, riferimento di accettazione (luogo di nascita e indirizzo solo se presenti)
  const campiVuoti = campiMancanti(dati.anagrafica || {});
  check.push({ codice: 'ANAGRAFICA', ok: campiVuoti.length === 0, testo: campiVuoti.length ? `Anagrafica incompleta: manca ${campiVuoti.join(', ')}` : 'Anagrafica completa (cognome e nome, sesso, data di nascita, accettazione)', dettagli: campiVuoti });
  // 5. controllo inverso: nessun testo del laboratorio esterno nel corpo del DOCX (i riferimenti del riquadro anagrafico sono ammessi)
  const esterni = testoLabEsterno(testoDocx, dati.note || []);
  check.push({ codice: 'TESTO_LAB_ESTERNO', ok: esterni.length === 0, testo: esterni.length ? `Nel referto TD compare testo del laboratorio esterno: ${esterni.slice(0, 5).join(', ')}` : 'Nessun testo del laboratorio esterno nel referto TD (intestazioni, codici nel corpo, nomi)', dettagli: esterni });
  // 6. nessuna testata di tabella, firma, dicitura legale o numero di pagina nel corpo
  const spurie = righeSpurie(testoDocx, dati.note || []);
  check.push({ codice: 'RIGHE_SPURIE', ok: spurie.length === 0, testo: spurie.length ? `Righe spurie nel referto TD: ${spurie.slice(0, 5).join(', ')}` : 'Nessuna testata di tabella, firma o dicitura legale nel corpo', dettagli: spurie });
  return { ok: check.every((c) => c.ok), check };
}
