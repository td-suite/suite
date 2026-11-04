// Referti esterni · lettura (motore del 03/11/2026): schema del JSON a blocchi, anomalie automatiche, lettura simulata
// (REFERTI_AI_MOCK=1) dei tre PDF uniti Cerba Nuova Igea (DINE KATERINA, STEFANI UGHETTA, SENSI ROMANA) → tre schede → DOCX identici ai
// referti del progetto, parser di riserva sugli stessi PDF, PDF che non è un referto, "Chiedi una correzione" simulata, prompt di
// sistema (esempi validi), controllo di coerenza sui casi reali.
// I PDF sorgente e i DOCX del progetto non stanno nel repository (dati reali): REFERTI_PDF_SORGENTI (cartella dei tre merge) e
// REFERTI_PACCHETTO; se mancano, i test che li usano vengono saltati. Serve poppler (pdftotext) per i PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { estraiTesto } from '../src/modules/referti/lib/pdf.js';
import { leggiReferto, mockCorrezione, PROMPT_SISTEMA, fixtureLettura } from '../src/modules/referti/lib/lettura.js';
import { validaDati, rispostaLetturaSchema, colonneAnagrafica, anomalieAutomatiche, contaAntibiotici, primoEsame, isSchemaBlocchi } from '../src/modules/referti/lib/blocchi.js';
import { generaDocx, documentXml, testoDocx } from '../src/modules/referti/lib/formatTD.js';
import { controllaCoerenza } from '../src/modules/referti/lib/coerenza.js';
import { documentXmlDi } from './helpers/docxInBlocchi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACCHETTO = process.env.REFERTI_PACCHETTO || '/home/claude/referti-pacchetto';
const DOCX_DIR = path.join(PACCHETTO, '01_Referti_DOCX');
const SORGENTI = process.env.REFERTI_PDF_SORGENTI || '/root/.claude/uploads/4278bdda-21c8-5fb1-a117-78e6b2a4d9c5';
const MERGE = { 'DINE KATERINA': '6fff134a-1793290375810_merge179328933914999870.pdf', 'STEFANI UGHETTA': '02f1789a-1793290375812_merge179328280768199870.pdf', 'SENSI ROMANA': 'b35e54b0-1793290375811_merge179328301210199870.pdf' };
const haPoppler = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const conMerge = haPoppler && Object.values(MERGE).every((f) => fs.existsSync(path.join(SORGENTI, f)));
const conPacchetto = fs.existsSync(DOCX_DIR);
const codici = (s) => s.anomalie.map((a) => a.codice);
const conMock = async (valore, fn) => { const prima = process.env.REFERTI_AI_MOCK; process.env.REFERTI_AI_MOCK = valore; try { return await fn(); } finally { if (prima == null) delete process.env.REFERTI_AI_MOCK; else process.env.REFERTI_AI_MOCK = prima; } };
const leggi = async (file, mock = '1') => { const buf = fs.readFileSync(file); const estratto = await estraiTesto(buf); return conMock(mock, () => leggiReferto({ buffer: buf, estratto, rif: 'test' })); };
const coerenzaDi = async (s, dati = s.dati) => controllaCoerenza({ dati, testoSorgente: s.testo_sorgente, testoDocx: testoDocx(await generaDocx(dati)), antibioticiSorgente: s.antibiotici_sorgente });

test('schema del JSON a blocchi: normalizzazioni ammesse, legature, tipi sconosciuti rifiutati', () => {
  const v = validaDati({
    anagrafica: { cognome_nome: 'ROSSI ANNA', righe: [{ etichetta: 'Sesso', valore: 'F' }, ['Data di nascita', '01/01/1970']] },
    blocchi: [
      { tipo: 'antibiogramma', specie: 'Escherichia coli', n: '1', carica: null, righe: [{ antibiotico: 'CEFIXIME', sir: 'S', mic: '<=1' }, ['Ciproﬂoxacina', 'R', '>2']] },
      { tipo: 'paragrafo', testo: '(1) nota' },
      { tipo: 'tabella2', righe: [{ etichetta: 'Esito', valore: 'Negativo', riferimento: '' }, { etichetta: 'Esito', valore: 'Negativa', riferimento: 'Negativa' }] },
      { tipo: 'esame2', nome: 'URINOCOLTURA', metodo: 'Metodo: Colturale\nMateriale: URINE' },
      { tipo: 'spacer' },
    ],
  });
  assert.ok(v.ok, v.errore);
  const [ab, par, t2, e2] = v.dati.blocchi;
  assert.deepEqual(v.dati.anagrafica.righe, [['Sesso', 'F'], ['Data di nascita', '01/01/1970']]);
  assert.deepEqual(ab.righe, [['CEFIXIME', 'S', '<=1'], ['Ciprofloxacina', 'R', '>2']]);   // legatura ricongiunta
  assert.equal(ab.n, 1); assert.equal(ab.carica, ''); assert.equal(ab.carica_lbl, 'Carica Batterica'); assert.equal(ab.legenda, 'R: Resistente   I: Intermedio   S: Sensibile');
  assert.deepEqual([par.stile, par.before, par.after], ['small', 0, 0]);
  assert.deepEqual(t2.righe, [{ etichetta: 'Esito', valore: 'Negativo' }, { etichetta: 'Esito', valore: 'Negativa', riferimento: 'Negativa' }]);   // riferimento vuoto → row2
  assert.deepEqual(e2.metodo, ['Metodo: Colturale', 'Materiale: URINE']);
  assert.equal(validaDati({ anagrafica: { cognome_nome: 'X', righe: [] }, blocchi: [{ tipo: 'firma', testo: 'Dott. Rossi' }] }).ok, false);
  assert.equal(validaDati({ anagrafica: { cognome_nome: 'X', righe: [] } }).ok, false);
  assert.ok(rispostaLetturaSchema.safeParse({ non_referto: true, motivo: 'lettera commerciale' }).success);
  assert.ok(!rispostaLetturaSchema.safeParse({ schede: [] }).success);
  assert.ok(isSchemaBlocchi(v.dati)); assert.ok(!isSchemaBlocchi({ anagrafica: {}, settori: [] }));
});

test('colonne di ricerca dal riquadro (varianti A e B) e anomalie automatiche', () => {
  assert.deepEqual(colonneAnagrafica({ cognome_nome: 'ROSSI ANNA', righe: [['Data di nascita', '12/03/1980 (anni 46)'], ['Sesso', 'F'], ['Referto', 'R3YEA000001 del 16/10/2026'], ['Accettazione', 'A3YEA000002 del 15/10/2026']] }),
    { cognome_nome: 'ROSSI ANNA', data_nascita: '12/03/1980', eta: 46, sesso: 'F', accettazione: 'A3YEA000002', data_acc: '15/10/2026', referto_codice: 'R3YEA000001', referto_data: '16/10/2026', luogo_nascita: null, indirizzo: null });
  const a = colonneAnagrafica({ cognome_nome: 'CRS LCN', righe: [['Data di nascita', '10/02/1941'], ['Sesso', 'M'], ['Accettazione n°', '2558'], ['Data Acc.', '03/10/2026']] });
  assert.deepEqual([a.accettazione, a.data_acc, a.eta], ['2558', '03/10/2026', null]);
  const ab = (n, carica) => ({ tipo: 'antibiogramma', specie: 'E. coli', n, carica, carica_lbl: 'Carica Batterica', legenda: 'x', righe: [['AMIKACINA', 'S', '<=4']] });
  const d = { anagrafica: { cognome_nome: 'CRS LCN', righe: [['Data di nascita', '10/02/1941'], ['Sesso', 'M'], ['Accettazione n°', '2558']] },
    blocchi: [ab(1, '1.000.000 UFC/ml'), ab(2, ''), { tipo: 'paragrafo', testo: 'Il presente documento annulla e sostituisce il referto R3YEA050100 del 05/10/2026' }], note_anomalie: ['valore incerto a pagina 2'] };
  assert.deepEqual(anomalieAutomatiche(d, { ocr: true, modo: 'RISERVA' }).map((x) => x.codice), ['OCR', 'PARSER_RISERVA', 'ANAGRAFICA_ABBREVIATA', 'CARICA_ASSENTE', 'DUE_MICRORGANISMI', 'SOSTITUZIONE', 'NOTA_LETTURA']);
  assert.match(anomalieAutomatiche(d).find((x) => x.codice === 'CARICA_ASSENTE').testo, /#2 E\. coli/);
  assert.deepEqual(anomalieAutomatiche({ anagrafica: { cognome_nome: 'ROSSI ANNA', righe: [] }, blocchi: [] }).map((x) => [x.codice, x.testo]), [['ANAGRAFICA_INCOMPLETA', 'Anagrafica incompleta: verificare i dati del paziente: manca data di nascita, sesso, accettazione']]);
  assert.equal(contaAntibiotici({ blocchi: [ab(1, ''), { tipo: 'tabella1', righe: [{ risultato: 'Sensibile - MIC <=4' }, { risultato: 'Negativo' }, { risultato: 'Resistente - MIC >16' }] }] }), 3);
  assert.equal(primoEsame({ blocchi: [{ tipo: 'settore', titolo: 'X' }, { tipo: 'esame2', nome: 'URINOCOLTURA' }] }), 'URINOCOLTURA');
});

test('prompt di sistema: regole della specifica e un esempio completo per ciascun corpo, valido per lo schema e per il generatore', async () => {
  for (const frase of ['fedeltà assoluta', 'Legature', 'virgola decimale', 'variante A', 'variante B', 'CORPO 1', 'CORPO 2', 'ESBL', 'Due microrganismi', 'carica "" (nessun segnaposto)', 'annulla e sostituisce', 'non_referto', 'una scheda per paziente', 'TRE spazi', '"Sensibile - MIC <=4"']) assert.ok(PROMPT_SISTEMA.includes(frase), frase);
  const esempi = [...PROMPT_SISTEMA.matchAll(/^ESEMPIO \d · .*\n(.*)$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(esempi.length, 5);
  for (const e of esempi.slice(0, 3)) { const v = validaDati(e); assert.ok(v.ok, v.errore); assert.match(testoDocx(await generaDocx(v.dati)), /MICROBIOLOGIA|ALLERGOLOGIA/); }
  assert.ok(rispostaLetturaSchema.safeParse(esempi[3]).success);
  // nessun dato reale dei pazienti del pacchetto negli esempi del prompt
  for (const nome of ['GAMBINO', 'GRASSI', 'DINE', 'SENSI', 'STEFANI', 'SARSI', 'AUDIBERTI', 'CELIN']) assert.ok(!PROMPT_SISTEMA.includes(nome), nome);
});

test('lettura simulata dei tre PDF uniti Nuova Igea: tre schede, anomalie corrette, coerenza verde, DOCX identici ai referti del progetto', { skip: !conMerge && 'PDF sorgente o pdftotext assenti (REFERTI_PDF_SORGENTI)' }, async () => {
  assert.equal(fixtureLettura().filter((f) => f.riconosci).length, 3);
  const attese = { 'DINE KATERINA': { pagine: [1, 2], anomalie: ['CARICA_ASSENTE'], antibiotici: 16 }, 'STEFANI UGHETTA': { pagine: [1], anomalie: [], antibiotici: 15 }, 'SENSI ROMANA': { pagine: [1], anomalie: [], antibiotici: 8 } };
  for (const [nome, file] of Object.entries(MERGE)) {
    const r = await leggi(path.join(SORGENTI, file));
    assert.equal(r.modo, 'MOCK'); assert.equal(r.schede.length, 1, nome);
    const s = r.schede[0];
    assert.equal(s.dati.nome_file, `Referto - ${nome}`); assert.equal(s.dati.sorgente, 'CERBA_NUOVA_IGEA');
    assert.deepEqual(s.pagine, attese[nome].pagine); assert.deepEqual(codici(s), attese[nome].anomalie, nome);
    assert.equal(s.antibiotici_sorgente, attese[nome].antibiotici); assert.equal(contaAntibiotici(s.dati), attese[nome].antibiotici);
    assert.equal(s.colonne.cognome_nome, nome);
    // il testo sorgente è riga anagrafica + riquadro: niente intestazione, piè, firme, diciture del laboratorio
    for (const x of ['Duccio di Buoninsegna', 'SN=', 'I risultati di questo referto', 'Pagina 1 di', 'TOSCANA DIAGNOSTICA', 'P.IVA']) assert.ok(!s.testo_sorgente.includes(x), `${nome}: "${x}" nel testo sorgente`);
    const coe = await coerenzaDi(s);
    assert.ok(coe.ok, `${nome}: ${JSON.stringify(coe.check.filter((c) => !c.ok))}`);
    if (conPacchetto) {
      const atteso = fs.readFileSync(path.join(DOCX_DIR, `Referto - ${nome}.docx`));
      if (nome === 'DINE KATERINA') {
        // disposizione del CEO 04/11/2026: la nota "(RDI) Test eseguiti in RDI ..." e il rimando "(RDI)" nel nome dell'esame non si
        // trascrivono (pubblicità sanitaria vietata dalla Regione Toscana): il referto del progetto li aveva, il nostro no
        const tOut = testoDocx(await generaDocx(s.dati));
        assert.ok(!/Test eseguiti in RDI|\(RDI\)/.test(tOut), 'nessun riferimento a RDI');
        const tAtt = testoDocx(atteso).split('\n').filter((r) => !/Test eseguiti in RDI/.test(r)).join('\n').replace(/ \(RDI\)/g, '');
        assert.equal(tOut, tAtt, `${nome}: testo del DOCX senza la nota RDI`);
      } else {
        assert.equal(testoDocx(await generaDocx(s.dati)), testoDocx(atteso), `${nome}: testo del DOCX`);
        assert.equal(documentXml(s.dati), documentXmlDi(atteso), `${nome}: document.xml`);
      }
    }
  }
});

test('parser di riserva sugli stessi PDF (senza Claude): una scheda per PDF con l\'anomalia "parser di riserva"; STEFANI e SENSI già identici al progetto', { skip: !conMerge && 'PDF sorgente o pdftotext assenti' }, async () => {
  for (const [nome, file] of Object.entries(MERGE)) {
    const r = await leggi(path.join(SORGENTI, file), '0');
    assert.equal(r.modo, 'RISERVA'); assert.equal(r.schede.length, 1);
    const s = r.schede[0];
    assert.equal(codici(s)[0], 'PARSER_RISERVA');
    assert.ok(validaDati(s.dati).ok);
    assert.ok((await coerenzaDi(s)).ok, nome);
    if (conPacchetto && nome !== 'DINE KATERINA') assert.equal(documentXml(s.dati), documentXmlDi(fs.readFileSync(path.join(DOCX_DIR, `Referto - ${nome}.docx`))), nome);
  }
});

test('PDF che non è un referto (lettera di offerta): non_referto con motivo, nessuna scheda', { skip: !haPoppler && 'pdftotext assente' }, async () => {
  const r = await leggi(path.join(HERE, 'fixtures', 'referti', 'lettera_offerta.pdf'));
  assert.equal(r.non_referto, true); assert.equal(r.schede.length, 0); assert.match(r.motivo, /non è un referto/);
});

test('"Chiedi una correzione" simulata: solo la modifica richiesta, il resto invariato; la coerenza segnala il valore assente dalla sorgente', { skip: !conMerge && 'PDF sorgente o pdftotext assenti' }, async () => {
  const s = (await leggi(path.join(SORGENTI, MERGE['SENSI ROMANA']))).schede[0];
  const nuovo = mockCorrezione(s.dati, 'cambia la carica in 100.000 UFC/ml');
  const ab = nuovo.blocchi.find((b) => b.tipo === 'antibiogramma');
  assert.equal(ab.carica, '100.000 UFC/ml');
  const senza = (d) => JSON.stringify({ ...d, blocchi: d.blocchi.map((b) => (b.tipo === 'antibiogramma' ? { ...b, carica: '' } : b)) });
  assert.equal(senza(nuovo), senza(s.dati), 'nessun\'altra modifica');
  assert.ok(testoDocx(await generaDocx(nuovo)).includes('Carica Batterica: 100.000 UFC/ml'));
  const coe = await coerenzaDi(s, nuovo);
  const by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.VALORI_IN_SORGENTE.ok, false); assert.ok(by.VALORI_IN_SORGENTE.dettagli.includes('100.000'));
  assert.equal(by.TOKEN_RISULTATI.ok, false); assert.ok(by.TOKEN_RISULTATI.dettagli.includes('1.000.000'));
  // sostituzione letterale e istruzione non riconosciuta (nota per l'operatore, dati invariati)
  assert.equal(mockCorrezione(s.dati, 'cambia "Pseudomonas aeruginosa" in "Pseudomonas putida"').blocchi.find((b) => b.tipo === 'antibiogramma').specie, 'Pseudomonas putida');
  const ignoto = mockCorrezione(s.dati, 'rendilo più bello');
  assert.equal(JSON.stringify(ignoto.blocchi), JSON.stringify(s.dati.blocchi)); assert.match(ignoto.note_anomalie.at(-1), /non riconosciuta/);
});
