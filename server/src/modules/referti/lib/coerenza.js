// Controllo di coerenza prima della conferma (specifica §5.4; motore del 03/11/2026 con il JSON a blocchi). Si confrontano tre testi:
// il riquadro dei risultati della sorgente (schede.testo_sorgente: riga anagrafica + righe del riquadro, lib/parsers analisiSorgente),
// il JSON della scheda e il testo del DOCX generato (lib/formatTD.js testoDocx). Checklist [{ codice, ok, testo, dettagli }]:
//  1. TOKEN_RISULTATI      ogni token "risultato" della sorgente (valori, MIC, UFC, classi, esiti Negativo/Positivo...) ricompare nel DOCX
//  2. VALORI_IN_SORGENTE   ogni valore del JSON (risultati, MIC, carica, riferimenti) esiste nella sorgente: nulla di inventato
//  3. N_ANTIBIOTICI        numero di antibiotici della scheda = conteggio indipendente sul testo della sorgente
//  4. NUMERI_IN_PIU        nessun numero nel DOCX assente dalla sorgente (note a piè escluse: sono copiate dal PDF)
//  5. ANAGRAFICA           cognome e nome, data di nascita, sesso, accettazione nel riquadro
//  6. TESTO_LAB_ESTERNO    nessun testo del laboratorio esterno nel corpo (riquadro anagrafico e note a piè ammessi)
//  7. RIGHE_SPURIE         nessuna testata di tabella, firma, dicitura legale, numero di pagina, ragione sociale del cliente
import { pulisci, compattaSpazi } from './text.js';
import { isTestataTabella, isFirma, isDicituraLegale, isPieDiPagina } from './parsers/common.js';
import { contaAntibiotici, colonneAnagrafica, testiParagrafi } from './blocchi.js';

const norm = (s) => compattaSpazi(pulisci(s)).toLowerCase().replace(/\s*([<>=:/,.-])\s*/g, '$1');

// Token di un valore: parole e numeri (con virgola/punto decimale, simboli <= > e ^)
export function tokenDi(valore) {
  const n = norm(valore);
  if (!n) return [];
  return (n.match(/(?:<=|>=|<|>)?\d+(?:[.,]\d+)*(?:\^\d+)?|[a-zà-ü]+(?:\/[a-zà-ü]+)?/g) || []).filter((tk) => tk.length >= 2 || /\d/.test(tk));
}

// Parole di esito che contano come "risultato" anche senza numeri
const RE_ESITO = /^(negativ[oai]|positiv[oai]|sensibile|resistente|intermedio|assent[ei]|present[ei]|rilevat[oi]|ufc\/ml|ufc)$/;
const isTokenRisultato = (tk) => /\d/.test(tk) || RE_ESITO.test(tk);

// Token risultato del riquadro della sorgente (la prima riga è l'anagrafica sintetica: i suoi numeri sono nel riquadro anagrafico)
export const tokenRisultatiSorgente = (testoSorgente) => [...new Set(tokenDi(String(testoSorgente || '')).filter(isTokenRisultato))];

// Valori del JSON (risultati, riferimenti, unità, MIC, S/I/R, carica): devono esistere nella sorgente
export function valoriScheda(dati) {
  const out = [];
  const add = (v) => { for (const tk of tokenDi(v)) if (isTokenRisultato(tk)) out.push(tk); };
  for (const b of dati?.blocchi || []) {
    if (b.tipo === 'tabella1') for (const r of b.righe || []) { add(r.risultato); add(r.riferimento); add(r.unit); }
    if (b.tipo === 'tabella2') for (const r of b.righe || []) { add(r.valore); add(r.riferimento); }
    if (b.tipo === 'antibiogramma') { add(b.carica); for (const r of b.righe || []) add(r[2]); }
  }
  return [...new Set(out)];
}

const numeri = (s) => new Set((norm(s).match(/\d+(?:[.,]\d+)*/g) || []));

// Righe del DOCX da non controllare (note a piè copiate dalla sorgente e righe del riquadro anagrafico)
function senzaRigheAmmesse(testoDocx, dati) {
  const note = new Set(testiParagrafi(dati).map((n) => compattaSpazi(pulisci(n))).filter(Boolean));
  const ana = new Set((dati?.anagrafica?.righe || []).map(([e, v]) => compattaSpazi(`${e}: ${v}`)));
  if (dati?.anagrafica?.cognome_nome) ana.add(compattaSpazi(dati.anagrafica.cognome_nome));
  return String(testoDocx || '').split('\n').filter((l) => { const c = compattaSpazi(pulisci(l)); return c && !note.has(c) && !ana.has(c); });
}

// Testo del laboratorio esterno che non deve comparire nel corpo del DOCX
export const TESTI_LAB_ESTERNO = [
  { re: /\bR3YE[A-Z0-9]*/i, nome: 'codice referto R3YE nel corpo' }, { re: /\bA3YE[A-Z0-9]*/i, nome: 'codice accettazione A3YE nel corpo' },
  { re: /\bAccettazione\s*n/i, nome: '"Accettazione n°" nel corpo' }, { re: /Data\s*Acc\b/i, nome: '"Data Acc." nel corpo' },
  { re: /\bBianalisi\b/i, nome: 'Bianalisi' }, { re: /Rete\s+Diagnostica/i, nome: 'Rete Diagnostica' }, { re: /Nuova\s+Igea/i, nome: 'Nuova Igea' }, { re: /\bCerba\b/i, nome: 'Cerba' },
  { re: /\bLimena\b/i, nome: 'Limena' }, { re: /Duccio\s+di\s+Buoninsegna/i, nome: 'via del laboratorio esterno' },
  { re: /Medico\s+richiedente/i, nome: 'medico richiedente' }, { re: /\bDirettore\b|Dir\.\s*Sanitario/i, nome: 'direttore' }, { re: /firmat[oa]\s+digitalmente/i, nome: 'firma digitale' }, { re: /P\.?\s?IVA\b/i, nome: 'partita IVA' },
];
export function testoLabEsterno(testoDocx, dati) {
  const txt = senzaRigheAmmesse(testoDocx, dati).join('\n');
  const trovati = [];
  for (const { re, nome } of TESTI_LAB_ESTERNO) { const m = txt.match(re); if (m) trovati.push(`${nome} ("${m[0]}")`); }
  return trovati;
}

const RE_TESTATA_TESTO = /^(?=.*\b(risultat[oi]|riferimento|analisi)\b)(?:(?:esam[ei]|analisi|test|descrizione|risultat[oi]|valor[ei]|esito|u\.?m\.?|unità|unita'?|di misura|um|di|riferimento|riferimenti|intervall[oi]|range|v\.?r\.?|note|metodo|metodica|precedent[ei]|\*|\|)\s*)+$/i;
export function righeSpurie(testoDocx, dati) {
  const out = [];
  for (const raw of senzaRigheAmmesse(testoDocx, dati)) {
    const l = compattaSpazi(pulisci(raw));
    if (isTestataTabella(raw) || RE_TESTATA_TESTO.test(l)) out.push(`testata di tabella: "${l.slice(0, 60)}"`);
    else if (isFirma(l)) out.push(`firma: "${l.slice(0, 60)}"`);
    else if (isDicituraLegale(l)) out.push(`dicitura legale: "${l.slice(0, 60)}"`);
    else if (isPieDiPagina(l)) out.push(`numero di pagina: "${l.slice(0, 60)}"`);
    else if (/Toscana\s+Diagnostica/i.test(l)) out.push(`ragione sociale del cliente: "${l.slice(0, 60)}"`);
  }
  return out;
}

/**
 * { dati, testoSorgente, testoDocx, antibioticiSorgente } → { ok, check }.
 * testoSorgente vuoto (PDF senza testo) o antibioticiSorgente null: i controlli che ne dipendono passano con la nota "non verificabile".
 */
export function controllaCoerenza({ dati, testoSorgente, testoDocx, antibioticiSorgente = null }) {
  const docx = norm(testoDocx);
  const docxCompatto = docx.replace(/\s+/g, '');
  const inDocx = (tk) => docx.includes(tk) || docxCompatto.includes(tk.replace(/\s+/g, ''));
  const sorg = norm(testoSorgente || '');
  const sorgCompatta = sorg.replace(/\s+/g, '');
  const inSorgente = (tk) => sorg.includes(tk) || sorgCompatta.includes(tk);
  const check = [];
  const conSorgente = Boolean(sorg.trim());
  // 1. sorgente → DOCX
  const tokens = conSorgente ? tokenRisultatiSorgente(testoSorgente) : [];
  const mancanti = tokens.filter((tk) => !inDocx(tk));
  check.push({ codice: 'TOKEN_RISULTATI', ok: mancanti.length === 0, testo: conSorgente ? `Valori della sorgente presenti nel referto TD (${tokens.length - mancanti.length} su ${tokens.length})` : 'Valori della sorgente: testo del PDF non disponibile, non verificabile', dettagli: mancanti.slice(0, 40) });
  // 2. JSON → sorgente (nulla di inventato)
  const valori = conSorgente ? valoriScheda(dati) : [];
  const inventati = valori.filter((tk) => !inSorgente(tk));
  check.push({ codice: 'VALORI_IN_SORGENTE', ok: inventati.length === 0, testo: conSorgente ? (inventati.length ? `Valori del referto TD non trovati nella sorgente: ${inventati.slice(0, 8).join(', ')}` : `Ogni valore del referto TD si trova nella sorgente (${valori.length})`) : 'Valori del referto: testo del PDF non disponibile, non verificabile', dettagli: inventati.slice(0, 40) });
  // 3. antibiotici
  const nNow = contaAntibiotici(dati);
  const nSorg = Number.isFinite(Number(antibioticiSorgente)) && antibioticiSorgente !== null ? Number(antibioticiSorgente) : null;
  check.push({ codice: 'N_ANTIBIOTICI', ok: nSorg === null || nNow === nSorg, testo: nSorg === null ? `Numero di antibiotici: ${nNow} nel referto TD (conteggio sulla sorgente non disponibile)` : `Numero di antibiotici: ${nNow} nel referto TD, ${nSorg} nella sorgente`, dettagli: { sorgente: nSorg, scheda: nNow } });
  // 4. nessun numero in più (note a piè e riquadro anagrafico esclusi; "#n" del microrganismo è del generatore)
  const numSorg = numeri(testoSorgente || '');
  const numDocx = numeri(senzaRigheAmmesse(testoDocx, dati).join('\n').replace(/#\d+/g, '#'));
  const extra = conSorgente ? [...numDocx].filter((n) => !numSorg.has(n)) : [];
  check.push({ codice: 'NUMERI_IN_PIU', ok: extra.length === 0, testo: extra.length ? `Numeri nel referto TD assenti nella sorgente: ${extra.slice(0, 10).join(', ')}` : 'Nessun numero in più rispetto alla sorgente', dettagli: extra.slice(0, 40) });
  // 5. anagrafica
  const col = colonneAnagrafica(dati?.anagrafica || {});
  const vuoti = [!col.cognome_nome && 'cognome e nome', !col.data_nascita && 'data di nascita', !col.sesso && 'sesso', !col.accettazione && !col.referto_codice && 'accettazione'].filter(Boolean);
  check.push({ codice: 'ANAGRAFICA', ok: vuoti.length === 0, testo: vuoti.length ? `Anagrafica incompleta: manca ${vuoti.join(', ')}` : 'Anagrafica completa (cognome e nome, data di nascita, sesso, accettazione)', dettagli: vuoti });
  // 6. controllo inverso
  const esterni = testoLabEsterno(testoDocx, dati);
  check.push({ codice: 'TESTO_LAB_ESTERNO', ok: esterni.length === 0, testo: esterni.length ? `Nel referto TD compare testo del laboratorio esterno: ${esterni.slice(0, 5).join(', ')}` : 'Nessun testo del laboratorio esterno nel corpo del referto TD (note a piè e riquadro anagrafico ammessi)', dettagli: esterni });
  // 7. righe spurie
  const spurie = righeSpurie(testoDocx, dati);
  check.push({ codice: 'RIGHE_SPURIE', ok: spurie.length === 0, testo: spurie.length ? `Righe spurie nel referto TD: ${spurie.slice(0, 5).join(', ')}` : 'Nessuna testata di tabella, firma o dicitura legale nel corpo', dettagli: spurie });
  return { ok: check.every((c) => c.ok), check };
}
