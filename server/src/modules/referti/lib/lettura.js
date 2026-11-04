// Lettura del PDF del laboratorio esterno con Claude (motore del 03/11/2026, richiesta del CEO: "in Claude, in un progetto dedicato,
// direttamente su prompt fa referti perfetti ed esattamente quello che cerco"). Il PDF va al modello come documento, insieme al testo
// di pdftotext -layout come aiuto; il prompt di sistema contiene le regole di trascrizione della specifica della routine (sezioni 2, 3,
// 4 e 7, 03_Specifica_widget del pacchetto) e lo schema a blocchi del generatore (lib/blocchi.js) con un esempio completo per ciascun
// corpo, preso dai referti del progetto e anonimizzato. Il modello restituisce { schede: [{ pagine, dati }] } (una scheda per paziente
// nei PDF uniti) oppure { non_referto: true, motivo }.
// Modalità: CLAUDE (chiave Anthropic configurata), MOCK (REFERTI_AI_MOCK=1 fuori produzione: JSON attesi delle fixture), RISERVA
// (senza chiave, o lettura con Claude non riuscita: i parser a mano di lib/parsers, con l'anomalia "parser di riserva").
// "Chiedi una correzione" (correggi): PDF + JSON corrente + istruzione dell'operatore → JSON corretto, solo le modifiche richieste.
// Privacy: nei log del server solo id, pagine, conteggi, tempi e token; in ai_log la query è "referti lettura elaborazione N".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiEnabled, askJsonDocument } from '../../../lib/claude.js';
import { HttpError } from '../../../lib/util.js';
import { config } from '../config.js';
import { elabora, analisiSorgente, rilevaSorgente } from './parsers/index.js';
import { rispostaLetturaSchema, datiSchema, validaDati, anomalieAutomatiche, daParser, colonneAnagrafica, SORGENTI_AMMESSE, senzaRimandiLaboratorio } from './blocchi.js';
import { compattaSpazi } from './text.js';

export const mockAttivo = () => config.aiMock;
export const modoLettura = () => (mockAttivo() ? 'MOCK' : aiEnabled() ? 'CLAUDE' : 'RISERVA');
export const MODI = { CLAUDE: 'Lettura con Claude', MOCK: 'Lettura simulata (REFERTI_AI_MOCK)', RISERVA: 'Parser di riserva (senza Claude)' };

// ======================= Prompt di sistema =======================
const LEG_EST = 'R: Resistente   I: Sensibile con aumentata esposizione al farmaco';
// Esempi (dati anonimizzati, struttura e testi identici ai referti del progetto: gen9.py, AUDIBERTI, gen11.py, gen9.py GRASSI)
const ESEMPIO_BIANALISI_IGE = {
  anagrafica: { cognome_nome: 'ROSSI ANNA', righe: [['Data di nascita', '12/03/1980 (anni 46)'], ['Sesso', 'F'], ['Referto', 'R3YEA000001 del 16/10/2026'], ['Accettazione', 'A3YEA000002 del 15/10/2026']] },
  blocchi: [
    { tipo: 'settore', titolo: 'ALLERGOLOGIA E INTOLLERANZE' },
    { tipo: 'titolo_esame', testo: 'IgE specifiche per singoli allergeni' },
    { tipo: 'paragrafo', stile: 'small', before: 0, after: 120, testo: "Valori di Riferimento:\n< 0.10 non rilevabile. Non esclude la presenza di sensibilizzazione all'allergene testato.\n0.10 - 0.34 Concentrazione molto bassa.\nClasse 0: < 0.35 kU/L\nClasse 1: 0.35-0.70 kU/L\nClasse 2: 0.70-3.5 kU/L\nClasse 3: 3.5-17.5 kU/L\nClasse 4: 17.5-50.0 kU/L\nClasse 5: 50.0-100.0 kU/L\nClasse 6: > 100.0 kU/L" },
    { tipo: 'tabella1', righe: [
      { nome: 'S - f3 Merluzzo (Gadus morhua) (1)', risultato: '<0.1', riferimento: '', bold_name: true, small: ['Metodo: FEIA'], unit: 'kU/L' },
      { nome: 'S - f13 Arachide (Arachis hypogaea) (1)', risultato: '0.13 *', riferimento: '', bold_name: true, small: ['Metodo: FEIA'], unit: 'kU/L' },
    ] },
    { tipo: 'paragrafo', stile: 'small', before: 120, after: 0, testo: '(1) Esame eseguito Bianalisi Verano Brianza (MB)' },
    { tipo: 'spacer' },
  ],
  sorgente: 'BIANALISI', nome_file: 'Referto - ROSSI ANNA', note_anomalie: [],
};
const ESEMPIO_BIANALISI_ANTIBIOGRAMMA = {
  anagrafica: { cognome_nome: 'VERDI MARCO', righe: [['Data di nascita', '05/06/1982 (anni 44)'], ['Sesso', 'M'], ['Referto', 'R3YE9000003 del 26/09/2026'], ['Accettazione', 'A3YE9000004 del 24/09/2026']] },
  blocchi: [
    { tipo: 'settore', titolo: 'MICROBIOLOGIA' },
    { tipo: 'tabella1', righe: [
      { nome: 'U - Urinocoltura\nRicerca completa microrganismi e lieviti patogeni', risultato: 'POSITIVA', riferimento: 'Negativa', bold_name: true, small: ['Metodo: Colturale'], unit: '' },
      { nome: 'Carica batterica', risultato: '10^5', riferimento: '', bold_name: false, small: [], unit: 'UFC/mL' },
      { nome: 'Antibiogramma', risultato: '', riferimento: '', bold_name: true, small: ['Metodo: Colturale', 'Interpretazione Eucast:', 'Resistente', 'Sensibile = Sensibile, dosaggio standard', "Intermedio = Sensibile, aumentata esposizione (l'esposizione dipende da dose, modalità ed intervallo di somministrazione dell'agente antimicrobico e dalla sua distribuzione nel sito di infezione)"], unit: '' },
      { nome: 'Materiale', risultato: 'URINE', riferimento: '', bold_name: false, small: [], unit: '' },
      { nome: 'Germe Isolato', risultato: 'Escherichia coli', riferimento: '', bold_name: false, small: [], unit: '' },
      { nome: 'Amoxicillina/Acido clavulanico', risultato: 'Sensibile - MIC <=4', riferimento: '', bold_name: false, small: [], unit: '' },
      { nome: 'Ampicillina', risultato: 'Resistente - MIC >16', riferimento: '', bold_name: false, small: [], unit: '' },
      { nome: 'ESBL (Extended Spectrum Beta Lactamase)', risultato: 'Negativo', riferimento: '', bold_name: false, small: [], unit: '' },
      { nome: 'Amikacina', risultato: 'Intermedio - MIC 2', riferimento: '', bold_name: false, small: [], unit: '' },
    ] },
    { tipo: 'spacer' },
  ],
  sorgente: 'BIANALISI', nome_file: 'Referto - VERDI MARCO', note_anomalie: [],
};
const ESEMPIO_RDI = {
  anagrafica: { cognome_nome: 'NERI PAOLA', righe: [['Data di nascita', '24/04/1958'], ['Sesso', 'F'], ['Accettazione n°', '2000'], ['Data Acc.', '04/09/2026']] },
  blocchi: [
    { tipo: 'settore', titolo: 'MICROBIOLOGIA' },
    { tipo: 'tabella1', righe: [{ nome: 'KPC (Test di Conferma con Fenotipizzazione)', risultato: 'Negativo', riferimento: '', bold_name: true, small: ['Metodo: immunoenzimatico', 'Materiale: T.AMIES', 'Sede Anatomica: RETTALE'], unit: '' }] },
    { tipo: 'spacer' },
  ],
  sorgente: 'CERBA_RDI', nome_file: 'Referto - NERI PAOLA', note_anomalie: [],
};
const ESEMPIO_NUOVA_IGEA = {
  anagrafica: { cognome_nome: 'BIANCHI LAURA', righe: [['Data di nascita', '01/02/1975'], ['Sesso', 'F'], ['Accettazione n°', '1000'], ['Data Acc.', '24/10/2026']] },
  blocchi: [
    { tipo: 'settore', titolo: 'MICROBIOLOGIA' },
    { tipo: 'esame2', nome: 'ESAME MICROBIOLOGICO DEL SECRETO VAGINALE', metodo: ['Metodo: microscopico - colturale', 'Materiale: T.VAGI.AMIES', "Nuova descrizione dell'esame come da Nomenclatore 2025"] },
    { tipo: 'tabella2', righe: [
      { etichetta: 'Esame microscopico dopo colorazione di Gram', valore: 'Scarsi lattobacilli;\nBacilli gram negativi' },
      { etichetta: 'Specie Microbiche Isolate', valore: 'Escherichia coli' },
      { etichetta: 'Ricerca Trichomonas vaginalis', valore: 'Negativa' },
      { etichetta: 'Ricerca Lieviti', valore: 'Negativa' },
      { etichetta: 'Ricerca Streptococcus Agalactiae', valore: 'Negativa' },
      { etichetta: 'Esito', valore: 'Esame colturale: POSITIVO' },
    ] },
    { tipo: 'spacer' },
    { tipo: 'antibiogramma', specie: 'Escherichia coli', n: 1, carica: '', carica_lbl: 'Carica Batterica', legenda: LEG_EST, righe: [
      ['AMIKACINA', 'S', '<=4'], ['AZTREONAM', 'S', '<=1'], ['AMOXICILLINA-CLAVULANATO', 'R', '>32/2'], ['CEFTAZIDIME', 'R', '8'], ['CIPROFLOXACINA', 'S', '<=0,25'],
      ['CEFTRIAXONE', 'S', '<=0,5'], ['CEFTOLOZANO-TAZOBACTAM', 'S', '<=1/4'], ['CEFTAZIDIME-AVIBACTAM', 'S', '<=0,25/4'], ['ERTAPENEM', 'S', '<=0,125'], ['CEFEPIME', 'S', '<=1'],
      ['GENTAMICINA', 'S', '<=1'], ['IMIPENEM', 'S', '<=0,25'], ['MEROPENEM', 'S', '<=0,5'], ['TOBRAMICINA', 'S', '<=1'], ['TRIMETOPRIM-SULFAMETOXAZOLO', 'R', '>2/38'],
      ['PIPERACILLINA-TAZOBACTAM', 'S', '<=4/4']] },
    { tipo: 'spacer' },
    { tipo: 'esame2', nome: 'COLTURA PER NEISS. GONORRHOEAE (RDI)', metodo: ['Metodo: colturale', 'Materiale: T.AMIES', 'Sede Anatomica: CERVICALE'] },
    { tipo: 'tabella2', righe: [{ etichetta: 'Esito', valore: 'Negativa', riferimento: 'Negativa' }] },
    { tipo: 'spacer' },
    { tipo: 'esame2', nome: 'RICERCA MYCOPLASMI', metodo: ['Metodo: colturale', 'Materiale: T.CERV.AMIES 2'] },
    { tipo: 'tabella2', righe: [{ etichetta: 'Mycoplasma Hominis', valore: 'Negativo', riferimento: 'Negativo' }, { etichetta: 'Ureaplasma Urealyticum', valore: 'Negativo', riferimento: 'Negativo' }] },
    { tipo: 'paragrafo', stile: 'small', before: 120, after: 0, testo: '(RDI) Test eseguiti in RDI - RETE DIAGNOSTICA ITALIANA - Via del Santo 147 - 35010 LIMENA (PD) - C.F. 04296540281' },
    { tipo: 'spacer' },
  ],
  sorgente: 'CERBA_NUOVA_IGEA', nome_file: 'Referto - BIANCHI LAURA', note_anomalie: [],
};
const ESEMPIO_DUE_MICRORGANISMI = [
  { tipo: 'tabella2', righe: [{ etichetta: 'Specie Microbiche', valore: 'Escherichia coli.\nKlebsiella pneumoniae probabile ESBL+' }, { etichetta: 'Esito', valore: 'Esame colturale: POSITIVO' }] },
  { tipo: 'spacer' },
  { tipo: 'antibiogramma', specie: 'Escherichia coli', n: 1, carica: '1.000.000 UFC/ml', carica_lbl: 'Carica Batterica', legenda: LEG_EST, righe: [['AMPICILLINA', 'R', '>8'], ['FOSFOMICINA C/G6P', 'S', '<=8'], ['NITROFURANTOINA', 'S', '<=16'], ['GENTAMICINA', 'R', '>4']] },
  { tipo: 'spacer' },
  { tipo: 'antibiogramma', specie: 'Klebsiella pneumoniae ssp pneumoniae', n: 2, carica: '1.000.000 UFC/ml', carica_lbl: 'Carica Batterica Totale', legenda: LEG_EST, righe: [['AMPICILLINA', 'R', '>8'], ['GENTAMICINA', 'S', '<=1']] },
  { tipo: 'spacer' },
];

export const PROMPT_SISTEMA = `Sei il trascrittore dei referti dei laboratori esterni del Laboratorio di Analisi di Toscana Diagnostica (routine "Referti EXT su format TD").
Ricevi il PDF di un laboratorio esterno (Bianalisi S.p.A. Laboratorio Firenze, Cerba HealthCare Rete Diagnostica Italiana di Limena, Cerba HealthCare Toscana Nuova Igea di Firenze) e, come aiuto, il testo estratto con pdftotext -layout. Restituisci il JSON che il generatore del format TD stampa così com'è: ogni stringa che scrivi finisce identica nel referto.

REGOLE DI TRASCRIZIONE (fedeltà assoluta)
1. Non interpretare, non correggere, non completare, non tradurre, non riassumere: copia i testi della sorgente carattere per carattere (maiuscole e minuscole, punteggiatura, asterischi "*", spazi singoli tra le parole). Nessun valore inventato: se un dato non c'è, la riga non si scrive (mai "-", mai segnaposto).
2. Legature tipografiche ricongiunte ("Ceﬁxime" diventa "Cefixime", "Ciproﬂoxacina" diventa "Ciprofloxacina"). Conserva la virgola decimale, i simboli <=, >=, <, >, /, ^ esattamente come nella sorgente ("<=0,125", ">32/2", "10^5").
3. Valori e nomi spezzati su più righe dall'impaginazione si ricompongono con uno spazio ("ESAME MICROBIOLOGICO DEL SECRETO" + "VAGINALE" diventa "ESAME MICROBIOLOGICO DEL SECRETO VAGINALE"; "COLTURA PER NEISS. GONORRHOEAE" + "(RDI)" diventa "COLTURA PER NEISS. GONORRHOEAE (RDI)"). Gli a capo voluti dentro una stessa cella (due righe di esito, la descrizione sotto il nome dell'esame) si conservano con "\\n" ("Scarsi lattobacilli;\\nBacilli gram negativi").
4. Si trascrivono SOLO il riquadro anagrafico del paziente e il contenuto del riquadro dei risultati. Non si trascrivono: intestazione e piè di pagina del laboratorio esterno, ragione sociale del cliente (TOSCANA DIAGNOSTICA S.R.L.), testate di colonna (Esame, Risultato, U.M., Valori di Riferimento, Analisi, Risultati, Intervalli di Riferimento), medico richiedente, direttore sanitario, firme anche digitali (data e ora + SN=, "Emesso dall'Ente Certificatore", "Referto firmato da"), diciture legali e privacy ("I risultati di questo referto...", "I dati personali...", "Regolamento..."), numeri di pagina, la riga generica "Dove non diversamente indicato: test eseguiti in Laboratorio ...". La testata dell'antibiogramma ripetuta a pagina 2 e il "Microrganismo #n" ripetuto a pagina 2 sono continuazione: la tabella resta una.
5. Settori nell'ordine della sorgente, un blocco "settore" per ciascuno, titolo in MAIUSCOLO come lo scrive la sorgente (MICROBIOLOGIA, MICROBIOLOGIA MOLECOLARE, ALLERGOLOGIA, ALLERGOLOGIA E INTOLLERANZE, CHIMICA CLINICA, ...). Se la sorgente non ha un titolo di settore, non inventarlo.

RIQUADRO ANAGRAFICO (anagrafica)
- cognome_nome: in maiuscolo come nella sorgente, senza normalizzarlo (anche se abbreviato, es. "CRS LCN": trascrivilo com'è e aggiungi in note_anomalie "anagrafica abbreviata, verificare").
- righe, nell'ordine e con queste etichette esatte:
  variante A (Cerba RDI e Cerba Nuova Igea): ["Data di nascita", "gg/mm/aaaa"], ["Sesso", "F" o "M"], ["Accettazione n°", "<numero>"], ["Data Acc.", "gg/mm/aaaa"];
  variante B (Bianalisi): ["Data di nascita", "gg/mm/aaaa (anni NN)"] (l'età "(anni NN)" della riga "F-16/04/1974 (anni 52)"), ["Sesso", ...], ["Referto", "<codice R3YE...> del gg/mm/aaaa"], ["Accettazione", "<codice A3YE...> del gg/mm/aaaa"].
  Il codice dopo l'età nelle righe Bianalisi (es. "TOLAFI") è un codice di sede: non si trascrive. Una riga si scrive solo se il valore c'è.

CORPO 1 (Bianalisi e Cerba RDI Limena): tabella a tre colonne, blocco "tabella1"
- Ogni riga: nome (nome dell'esame; la descrizione sotto il nome va a capo con "\\n"), risultato, riferimento (intervallo/valore di riferimento della sorgente, anche su più righe con "\\n"; vuoto se non c'è), unit (unità di misura, vuota se non c'è), small (righe piccole grigie sotto il nome: "Metodo: ...", "Materiale: ...", "Sede Anatomica: ...", nell'ordine della sorgente), bold_name (true per gli esami principali con le loro righe Metodo/Materiale; false per le righe di dettaglio: Identificazione, Materiale, Germe Isolato, Carica Batterica, gli antibiotici, ESBL).
- Antibiogramma Bianalisi: resta nella STESSA tabella, una riga per antibiotico con nome dell'antibiotico, risultato "Sensibile - MIC <=4" / "Resistente - MIC >16" / "Intermedio - MIC 0,25" come scritto nella sorgente, riferimento vuoto. Prima degli antibiotici la riga "Antibiogramma" (bold_name true, small: "Metodo: Colturale" e le righe della legenda Eucast così come sono: "Interpretazione Eucast:", "Resistente", "Sensibile = Sensibile, dosaggio standard", "Intermedio = Sensibile, aumentata esposizione (...)"), poi Materiale, Germe Isolato, Carica Batterica (unit "UFC/mL") se presente. La riga "ESBL (Extended Spectrum Beta Lactamase)" va esattamente dove si trova nella sorgente, anche in mezzo agli antibiotici. Antibiogramma su due pagine: una tabella sola. Esami aggiuntivi dopo l'antibiogramma (Mycoplasma, Neisseria): righe in coda alla stessa tabella.
- IgE specifiche Bianalisi: blocco "titolo_esame" con il titolo del gruppo, poi il blocco "Valori di Riferimento" come "paragrafo" (stile small, before 0, after 120) con le righe separate da "\\n", poi la tabella; l'asterisco sul risultato si conserva ("0.13 *").
- Cerba RDI (anche PDF uniti con un paziente per pagina, es. lotti KPC): una tabella1 per paziente; IgE in chemiluminescenza con le classi 0-6 come riferimento su più righe.

CORPO 2 (Cerba Nuova Igea): blocchi "esame2" + "tabella2" + "antibiogramma"
- esame2: nome dell'esame in maiuscolo come nella sorgente (URINOCOLTURA, ESAME MICROBIOLOGICO DEL SECRETO VAGINALE, ESAME MICROSCOPICO DIVERSI, ...), metodo = righe "Metodo: ...", "Materiale: ...", "Sede Anatomica: ..." e l'eventuale "Nuova descrizione dell'esame come da Nomenclatore 2025", nell'ordine della sorgente.
- tabella2: coppie etichetta / valore nell'ordine della sorgente (Specie Microbiche, Esito, Carica Microbica Totale, Flogosi, Cellule, Ife fungine, Spore fungine, Flora microbica, Trichomonas Vaginalis, Esame microscopico dopo colorazione di Gram, Ricerca ..., Antibiogramma/Antimicogramma = nota interpretativa riportata per intero). riferimento solo se la sorgente ha un valore di riferimento per quella riga (esami RDI aggiuntivi), altrimenti omettilo. Esiti testuali lunghi (flora mista, contaminazione) integralmente nella cella valore.
- antibiogramma: per ogni microrganismo { specie, n, carica, carica_lbl, legenda, righe: [[ANTIBIOTICO, "S"/"I"/"R", MIC]] } nell'ordine della sorgente. carica_lbl "Carica Batterica" o "Carica Batterica Totale" come nella sorgente; carica assente: carica "" (nessun segnaposto). legenda copiata dalla sorgente con TRE spazi tra le voci: "R: Resistente   I: Intermedio   S: Sensibile" oppure "R: Resistente   I: Sensibile con aumentata esposizione al farmaco". Due microrganismi affiancati (colonne "#1 MIC #2 MIC"): due blocchi antibiogramma separati (#1 e #2), per #2 si omettono gli antibiotici senza valore.
- Sequenza dei blocchi di un referto Nuova Igea: settore, esame2, tabella2, spacer, antibiogramma (#1), [spacer, antibiogramma #2], spacer. Senza antibiogramma: settore, esame2, tabella2, spacer, spacer. Esami aggiuntivi dopo l'antibiogramma: spacer, esame2, tabella2 per ciascuno, poi le note e lo spacer finale.

NOTE E CHIUSURA
- Note a piè del riquadro dei risultati come "paragrafo" stile small dopo l'ultima tabella: la prima con before 120, le successive con before 40, after 0. Va SEMPRE riportata la frase "Il presente documento annulla e sostituisce il referto R3YE... del gg/mm/aaaa".
- VIETATO (normativa della Regione Toscana sulla pubblicità sanitaria, disposizione del CEO 04/11/2026): le note che indicano il laboratorio o il centro che ha eseguito l'esame NON si trascrivono MAI: "(1) Esame eseguito Bianalisi Verano Brianza (MB)", "(RDI) Test eseguiti in RDI - RETE DIAGNOSTICA ITALIANA ...", "Esame eseguito presso ...", e simili. Di conseguenza anche i rimandi "(1)", "(2)", "(RDI)" in coda ai nomi degli esami o degli allergeni vanno tolti (es. "S - f3 Merluzzo (Gadus morhua) (1)" → "S - f3 Merluzzo (Gadus morhua)", "COLTURA PER NEISS. GONORRHOEAE (RDI)" → "COLTURA PER NEISS. GONORRHOEAE"). Il referto TD non deve nominare nessun altro laboratorio.
- Ogni referto termina con un blocco { "tipo": "spacer" }.

PDF UNITI (merge) E PDF CHE NON SONO REFERTI
- Un PDF può contenere più pazienti: una scheda per paziente. Nuova scheda quando cambiano cognome e nome + numero di accettazione nell'intestazione di pagina; le pagine seguenti con la stessa accettazione sono continuazione (antibiogramma lungo). "pagine" = numeri di pagina del PDF (da 1) della scheda.
- Se il PDF non è un referto di laboratorio (lettera, offerta commerciale, documento qualsiasi) rispondi { "non_referto": true, "motivo": "<una frase>" }.

SCHEMA DEL JSON
{ "schede": [ { "pagine": [1], "dati": {
  "anagrafica": { "cognome_nome": "...", "righe": [["Data di nascita", "..."], ["Sesso", "..."], ...] },
  "blocchi": [ ...blocchi nell'ordine di stampa... ],
  "sorgente": "BIANALISI" | "CERBA_RDI" | "CERBA_NUOVA_IGEA" | "ALTRO",
  "nome_file": "Referto - COGNOME NOME",
  "note_anomalie": [ "...casi dubbi da far verificare all'operatore: anagrafica abbreviata, testo illeggibile, valore incerto, carica assente, due microrganismi, sostituzione..." ] } } ] }
Blocchi ammessi (nessun altro campo, nessun altro tipo):
{ "tipo": "settore", "titolo": "..." }
{ "tipo": "titolo_esame", "testo": "..." }
{ "tipo": "paragrafo", "testo": "...", "stile": "small", "before": 120, "after": 0 }
{ "tipo": "tabella1", "righe": [ { "nome": "...", "risultato": "...", "riferimento": "...", "bold_name": true, "small": ["Metodo: ..."], "unit": "..." } ] }
{ "tipo": "esame2", "nome": "...", "metodo": ["Metodo: ...", "Materiale: ..."] }
{ "tipo": "tabella2", "righe": [ { "etichetta": "...", "valore": "..." }, { "etichetta": "...", "valore": "...", "riferimento": "..." } ] }
{ "tipo": "antibiogramma", "specie": "...", "n": 1, "carica": "...", "carica_lbl": "Carica Batterica", "legenda": "...", "righe": [["AMIKACINA", "S", "<=4"]] }
{ "tipo": "spacer" }

ESEMPIO 1 · Bianalisi, IgE specifiche (variante B, corpo 1)
${JSON.stringify(ESEMPIO_BIANALISI_IGE)}

ESEMPIO 2 · Bianalisi, urinocoltura con antibiogramma nella stessa tabella (variante B, corpo 1; antibiotici accorciati)
${JSON.stringify(ESEMPIO_BIANALISI_ANTIBIOGRAMMA)}

ESEMPIO 3 · Cerba RDI, KPC (variante A, corpo 1)
${JSON.stringify(ESEMPIO_RDI)}

ESEMPIO 4 · Cerba Nuova Igea, secreto vaginale senza carica con esami aggiuntivi RDI e nota (RDI) (variante A, corpo 2), PDF di due pagine
${JSON.stringify({ schede: [{ pagine: [1, 2], dati: ESEMPIO_NUOVA_IGEA }] })}

ESEMPIO 5 · Cerba Nuova Igea, due microrganismi affiancati: blocchi dopo esame2 (antibiotici accorciati)
${JSON.stringify(ESEMPIO_DUE_MICRORGANISMI)}

Rispondi esclusivamente con il JSON, senza testo prima o dopo e senza recinti di codice.`;

const PROMPT_CORREZIONE = `${PROMPT_SISTEMA}

CORREZIONE RICHIESTA DALL'OPERATORE
Ora ricevi, oltre al PDF, il JSON corrente di UNA scheda (campo "dati") e un'istruzione dell'operatore del laboratorio. Restituisci { "dati": { ...JSON completo corretto... } } con lo stesso schema: applica SOLO le modifiche richieste; tutto il resto resta invariato carattere per carattere (stessi blocchi, stesso ordine, stessi testi). Se l'istruzione contrasta con il PDF, applicala comunque e segnalalo in note_anomalie con una frase. Non aggiungere né togliere blocchi se l'istruzione non lo chiede.`;

// Testo di aiuto: pagine numerate del pdftotext -layout
const testoAiuto = (pagine) => pagine.map((t, i) => `===== Pagina ${i + 1} di ${pagine.length} =====\n${t}`).join('\n');

// ======================= Mock (REFERTI_AI_MOCK=1) =======================
const FIX_DIR = () => config.aiMockDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'test', 'fixtures', 'referti', 'lettura');
export function fixtureLettura() {
  const dir = FIX_DIR();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}
function mockLettura(testo) {
  const t = compattaSpazi(testo);
  const f = fixtureLettura().find((x) => Array.isArray(x.riconosci) && x.riconosci.length && x.riconosci.every((s) => t.includes(compattaSpazi(s))));
  return f ? JSON.parse(JSON.stringify(f.risposta)) : null;
}
// Correzione simulata: "cambia la carica in X" (tutte le tabelle antibiogramma), "cambia <testo> in <testo>" (sostituzione letterale)
export function mockCorrezione(dati, istruzione) {
  const out = JSON.parse(JSON.stringify(dati));
  const s = String(istruzione || '').trim();
  let m = s.match(/^cambia\s+(?:la\s+)?carica(?:\s+batterica)?\s+in\s+(.+)$/i);
  if (m) { for (const b of out.blocchi) if (b.tipo === 'antibiogramma') b.carica = m[1].trim(); return out; }
  m = s.match(/^(?:cambia|sostituisci)\s+["«]?(.+?)["»]?\s+(?:in|con)\s+["«]?(.+?)["»]?$/i);
  if (m) {
    const [da, a] = [m[1], m[2]];
    const rimpiazza = (v) => (typeof v === 'string' ? v.split(da).join(a) : Array.isArray(v) ? v.map(rimpiazza) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rimpiazza(x)])) : v);
    return { ...rimpiazza(out), sorgente: out.sorgente, nome_file: out.nome_file };
  }
  out.note_anomalie = [...(out.note_anomalie || []), `Correzione simulata non applicata: istruzione non riconosciuta dal mock ("${s.slice(0, 80)}")`];
  return out;
}

// ======================= Lettura =======================
const nomeFileDi = (cognomeNome) => `Referto - ${compattaSpazi(cognomeNome || 'PAZIENTE').toUpperCase()}`;

// Testo sorgente della scheda (controllo di coerenza): riga anagrafica + riquadro dei risultati delle pagine (mai l'intero PDF)
function sorgenteScheda(estratto, pagine, dati) {
  const pg = pagine.map((n) => ({ n, testo: estratto.pagine[n - 1] || '' }));
  const an = analisiSorgente(pg, SORGENTI_AMMESSE.includes(dati.sorgente) && dati.sorgente !== 'ALTRO' ? dati.sorgente : null);
  const a = dati.anagrafica || {};
  const riga = [a.cognome_nome, ...(a.righe || []).map((r) => r[1])].filter(Boolean).join('  ');
  return { sorgente: an.sorgente, testo_sorgente: [riga, ...an.testo_riquadro].join('\n').replace(/\n{3,}/g, '\n\n'), antibiotici_sorgente: an.antibiotici_sorgente };
}

// Completa una scheda letta: pagine valide, sorgente, nome file, testo sorgente, conteggio indipendente degli antibiotici, anomalie
function completa(estratto, { pagine, dati }, modo) {
  const n = estratto.n_pagine || estratto.pagine.length;
  let pg = [...new Set((pagine || []).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))].sort((x, y) => x - y);
  if (!pg.length) pg = Array.from({ length: n }, (_, i) => i + 1);
  const src = sorgenteScheda(estratto, pg, dati);
  const sorgente = rilevaSorgente(pg.map((x) => estratto.pagine[x - 1] || '').join('\n')) || (SORGENTI_AMMESSE.includes(dati.sorgente) ? dati.sorgente : null) || src.sorgente || 'ALTRO';
  const d = senzaRimandiLaboratorio({ ...dati, sorgente, nome_file: nomeFileDi(dati.anagrafica?.cognome_nome), note_anomalie: dati.note_anomalie || [] });
  const anomalie = anomalieAutomatiche(d, { ocr: estratto.ocr, ocrLingua: estratto.ocr_lingua, modo });
  return { pagine: pg, dati: d, anomalie: dedup(anomalie), testo_sorgente: src.testo_sorgente, antibiotici_sorgente: src.antibiotici_sorgente, colonne: colonneAnagrafica(d.anagrafica) };
}
const dedup = (arr) => { const seen = new Set(); return arr.filter((a) => { const k = `${a.codice}|${a.testo}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

// Parser di riserva; nota (facoltativa) = motivo per cui non si è usato Claude, salvato in note_anomalie (resta anche dopo le modifiche)
function riserva(estratto, nota = null) {
  const r = elabora(estratto);
  if (r.motivo_scarto) return { modo: 'RISERVA', non_referto: true, motivo: r.motivo_scarto, schede: [] };
  return { modo: 'RISERVA', schede: r.schede.map((s) => { const d = daParser(s.dati); if (nota) d.note_anomalie = [nota]; return completa(estratto, { pagine: s.pagine, dati: d }, 'RISERVA'); }) };
}

function validaRisposta(json) {
  const r = rispostaLetturaSchema.safeParse(json);
  if (r.success) return r.data;
  const e = r.error.issues[0];
  throw Object.assign(new HttpError(422, `Intelligenza artificiale: la lettura non rispetta lo schema della scheda (${(e.path || []).join('.') || 'risposta'}: ${e.message})`), { code: 'AI_ERROR' });
}

/**
 * Legge un PDF già estratto (lib/pdf.js estraiTesto) e restituisce le schede.
 * { buffer, estratto: { pagine: [testo], n_pagine, ocr, ocr_lingua }, rif: identificativo tecnico per i log, userId }
 * → { modo, non_referto?, motivo?, schede: [{ pagine, dati, anomalie, testo_sorgente, antibiotici_sorgente, colonne }], ms, usage }
 */
export async function leggiReferto({ buffer, estratto, rif = '', userId = null }) {
  const t0 = Date.now();
  const modo = modoLettura();
  const fine = (out) => {
    const ms = Date.now() - t0;
    console.log(`[referti] lettura ${rif || '-'}: ${out.modo}, ${estratto.n_pagine} pagine, ${out.non_referto ? 'non referto' : `${out.schede.length} schede`}, ${ms} ms${out.usage ? `, token ${out.usage.input}/${out.usage.output}` : ''}`);   // nessun dato del paziente
    return { ...out, ms };
  };
  if (modo === 'MOCK') {
    const r = mockLettura(estratto.pagine.join('\n'));
    if (!r) return fine(riserva(estratto));
    const v = validaRisposta(r);
    if (v.non_referto) return fine({ modo, non_referto: true, motivo: v.motivo, schede: [] });
    return fine({ modo, schede: v.schede.map((s) => completa(estratto, s, modo)) });
  }
  if (modo === 'RISERVA') return fine(riserva(estratto));
  try {
    const user = `Trascrivi il referto del PDF allegato sul format TD secondo le regole. Il PDF ha ${estratto.n_pagine} pagine.${estratto.ocr ? ' Il testo di aiuto viene dall\'OCR: può contenere errori, fai fede al PDF.' : ''}\n\nTesto estratto con pdftotext -layout (solo aiuto, fa fede il PDF):\n${testoAiuto(estratto.pagine)}`;
    const r = await askJsonDocument({ kind: 'referti_lettura', system: PROMPT_SISTEMA, user, pdfBase64: Buffer.from(buffer).toString('base64'), maxTokens: config.letturaMaxTokens, timeoutMs: config.letturaTimeoutMs, userId, query: `referti lettura ${rif}` });
    const v = validaRisposta(r.json);
    if (v.non_referto) return fine({ modo, non_referto: true, motivo: v.motivo, schede: [], usage: r.usage });
    return fine({ modo, schede: v.schede.map((s) => completa(estratto, s, modo)), usage: r.usage });
  } catch (e) {
    // Lettura con Claude non riuscita (credito, timeout, risposta illeggibile): parser di riserva con l'anomalia che lo dice
    const motivo = String(e.message || e).replace(/^Intelligenza artificiale:\s*/, '').slice(0, 200);
    console.error(`[referti] lettura ${rif || '-'} con Claude non riuscita, parser di riserva: ${motivo.slice(0, 120)}`);
    return fine({ ...riserva(estratto, `lettura con Claude non riuscita (${motivo}): letta con il parser di riserva`), errore_claude: motivo });
  }
}

/**
 * "Chiedi una correzione": PDF + JSON corrente + istruzione → JSON corretto e validato (stesso schema; sorgente e nome file restano
 * quelli della scheda). In MOCK applica mockCorrezione; senza chiave Anthropic risponde 400.
 */
export async function correggiScheda({ buffer, dati, istruzione, rif = '', userId = null }) {
  const t0 = Date.now();
  const modo = modoLettura();
  if (modo === 'RISERVA') throw new HttpError(400, 'La correzione con Claude richiede la chiave Anthropic della Suite (Amministrazione > Impostazioni > Claude): correggi a mano i campi della scheda');
  let nuovo; let usage = null;
  if (modo === 'MOCK') nuovo = mockCorrezione(dati, istruzione);
  else {
    if (!buffer) throw new HttpError(400, 'Il PDF sorgente non è più disponibile (retention): correggi a mano i campi della scheda');
    const user = `Istruzione dell'operatore: ${String(istruzione).trim()}\n\nJSON corrente della scheda:\n${JSON.stringify({ dati: { anagrafica: dati.anagrafica, blocchi: dati.blocchi, note_anomalie: dati.note_anomalie || [] } })}`;
    const r = await askJsonDocument({ kind: 'referti_correzione', system: PROMPT_CORREZIONE, user, pdfBase64: Buffer.from(buffer).toString('base64'), maxTokens: config.letturaMaxTokens, timeoutMs: config.letturaTimeoutMs, userId, query: `referti correzione ${rif}` });
    nuovo = r.json?.dati || r.json;
    usage = r.usage;
  }
  const v = validaDati({ ...nuovo, sorgente: dati.sorgente, nome_file: dati.nome_file });
  if (!v.ok) throw Object.assign(new HttpError(422, `Intelligenza artificiale: la correzione non rispetta lo schema della scheda (${v.errore})`), { code: 'AI_ERROR' });
  console.log(`[referti] correzione ${rif || '-'}: ${modo}, ${v.dati.blocchi.length} blocchi, ${Date.now() - t0} ms${usage ? `, token ${usage.input}/${usage.output}` : ''}`);
  return { dati: { ...v.dati, sorgente: dati.sorgente, nome_file: dati.nome_file }, modo, usage };
}

export { datiSchema };
