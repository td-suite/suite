// Referti esterni: test dei parser (Bianalisi, Cerba RDI merge, Cerba Nuova Igea, non referto), del generatore DOCX e del controllo
// di coerenza (compreso il controllo inverso "nessun testo del laboratorio esterno nel DOCX" e l'anagrafica completa con luogo di
// nascita e indirizzo, correzione del 29/10/2026). I PDF di prova sono sintetici (test/fixtures/referti/genera.py): i parser vanno
// ricalibrati sui PDF reali.
// Il testo (.txt) è l'uscita di `pdftotext -layout`, così i test girano anche senza poppler. Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elabora, rilevaSorgente, spezzaPerPaziente } from '../src/modules/referti/lib/parsers/index.js';
import { segmenti, anagraficaA, anagraficaB, isTestoLaboratorio, isTestataTabella, isFirma, isDicituraLegale } from '../src/modules/referti/lib/parsers/common.js';
import { pulisci, anagraficaAbbreviata } from '../src/modules/referti/lib/text.js';
import { generaDocx, testoDocx, trapianta } from '../src/modules/referti/lib/docgen.js';
import { controllaCoerenza, tokenRisultati, contaAntibiotici, testoLabEsterno, righeSpurie } from '../src/modules/referti/lib/coerenza.js';
import { suffissoPer, nomeBase } from '../src/modules/referti/lib/core.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'referti');
const pagine = (name) => { const t = fs.readFileSync(path.join(FIX, `${name}.txt`), 'utf8').split('\f'); if (!t[t.length - 1].trim()) t.pop(); return t.map((p) => p.split('\n').map(pulisci).join('\n')); };
const codici = (s) => s.anomalie.map((a) => a.codice);

test('pulizia del testo: legature e simboli', () => {
  assert.equal(pulisci('Ceﬁxime e Ciproﬂoxacina ≤4'), 'Cefixime e Ciprofloxacina <=4');
  assert.equal(pulisci('MIC 0,25  '), 'MIC 0,25');
  assert.ok(anagraficaAbbreviata('CRS LCN'));
  assert.ok(!anagraficaAbbreviata('ROSSI MARIA'));
});

test('segmenti a colonne con posizione', () => {
  const s = segmenti('AMOXICILLINA/AC.CLAVULANICO        S     <=8         R    >32');
  assert.deepEqual(s.map((x) => x.testo), ['AMOXICILLINA/AC.CLAVULANICO', 'S', '<=8', 'R', '>32']);
  assert.equal(s[0].da, 0); assert.ok(s[1].da > 20);
});

test('anagrafica variante A e B: dati completi del paziente (luogo di nascita, indirizzo), codice di sede Bianalisi ignorato', () => {
  const a = anagraficaA(['Paziente: GIANNINI PAOLA        Nato il: 12/03/1960     Sesso: F', 'Luogo di nascita: FIRENZE (FI)      Residenza: Via Roma 12, 50123 Firenze (FI)', 'Accettazione n° 2026/0456781      Data Acc. 04/09/2026']);
  assert.deepEqual(a, { variante: 'A', cognome_nome: 'GIANNINI PAOLA', data_nascita: '12/03/1960', sesso: 'F', luogo_nascita: 'FIRENZE (FI)', indirizzo: 'Via Roma 12, 50123 Firenze (FI)', accettazione_n: '2026/0456781', data_acc: '04/09/2026' });
  // comune accanto alla data ("Nato il … a …"), senza indirizzo
  const a2 = anagraficaA(['Paziente: GRASSI TIZIANA      Nato il: 05/05/1955 a FIRENZE (FI)     Sesso: F']);
  assert.equal(a2.luogo_nascita, 'FIRENZE (FI)'); assert.equal(a2.indirizzo, undefined); assert.equal(a2.cognome_nome, 'GRASSI TIZIANA');
  const b = anagraficaB(['Referto R3YEA050123 del 05/10/2026      Accettazione A3YEA050123 del 02/10/2026', 'ROSSI MARIA        F-16/04/1974 (anni 52) TOLAFI', 'Nata a: PRATO (PO)      Indirizzo: Via dei Mille 3, 50131 Firenze (FI)']);
  assert.equal(b.cognome_nome, 'ROSSI MARIA'); assert.equal(b.eta, 52); assert.equal(b.referto_codice, 'R3YEA050123'); assert.equal(b.accettazione_data, '02/10/2026'); assert.equal(b.sesso, 'F');
  assert.equal(b.luogo_nascita, 'PRATO (PO)'); assert.equal(b.indirizzo, 'Via dei Mille 3, 50131 Firenze (FI)');
  // "TOLAFI" è un codice di sede, non il luogo di nascita
  const b2 = anagraficaB(['ROSSI MARIA        F-16/04/1974 (anni 52) TOLAFI']);
  assert.equal(b2.luogo_nascita, undefined);
  // etichetta PAZIENTE da sola: il nome è la riga che segue, mai l'etichetta (caso reale del 29/10/2026)
  const a3 = anagraficaA(['PAZIENTE', 'CHIARI STEFANIA', 'Data di nascita: 25/05/1965        Sesso: F', 'Accettazione n° 3370      Data Acc. 27/10/2026']);
  assert.equal(a3.cognome_nome, 'CHIARI STEFANIA'); assert.equal(a3.accettazione_n, '3370'); assert.equal(a3.data_acc, '27/10/2026');
  const a4 = anagraficaA(['PAZIENTE                 25/05/1965     F', 'CHIARI STEFANIA']);
  assert.equal(a4.cognome_nome, 'CHIARI STEFANIA');
  assert.equal(anagraficaA(['Paziente: CHIARI STEFANIA']).cognome_nome, 'CHIARI STEFANIA');
});

test('righe del laboratorio esterno fuori dal riquadro: riconosciute e scartate, note del riquadro conservate', () => {
  for (const r of ['BIANALISI S.p.A. Laboratorio Firenze', 'Cerba HealthCare Toscana s.r.l. - Nuova Igea', 'Direttore del laboratorio: dott.ssa L. Verdi', 'Medico richiedente: dott. G. Esposito',
    'Firma: Il Direttore del Laboratorio dott. M. Bianchi', 'Il presente referto non puo\' essere riprodotto parzialmente. Bianalisi S.p.A. - P.IVA 01234567890', 'Validato da: dott.ssa L. Verdi',
    'Tel. 049 0000000 - Fax 049 0000001', 'Referto R3YEA050123 - ROSSI MARIA', 'Accettazione n° 26/001234 - GRASSI TIZIANA', 'Richiedente: Toscana Diagnostica S.r.l. (service)',
    'TOSCANA DIAGNOSTICA S.R.L.', 'Cliente: Toscana Diagnostica Srl', 'Esame        Risultato      U.M.      Valori di Riferimento', 'Analisi       Risultati       Intervalli di Riferimento',
    '28-10-2026 15.30 SN=4918597, Emesso dall\'Ente Certificatore: InfoCamere Qualified Electronic Signature      Referto firmato da: GERINI LUCA', 'Referto firmato da: GERINI LUCA', 'Firmato digitalmente da ROSSI',
    'I risultati di questo referto sono interpretabili solo dal medico curante', 'I dati personali sono trattati ai sensi del GDPR', 'Regolamento. Il laboratorio dove sono state ottenute le analisi', 'Il laboratorio dove sono state ottenute le analisi', 'Pagina 1 di 1']) assert.ok(isTestoLaboratorio(r), r);
  assert.ok(isTestataTabella('Esame        Risultato      U.M.      Valori di Riferimento')); assert.ok(!isTestataTabella('Carbamazepina        10,6 µg/ml        4,0 - 12,0'));
  assert.ok(isFirma('28-10-2026 15.30 SN=4918597, Emesso dall\'Ente Certificatore: InfoCamere')); assert.ok(isDicituraLegale('I risultati di questo referto sono interpretabili'));
  for (const r of ['(1) Esame eseguito Bianalisi Verano Brianza (MB)', 'Il presente documento annulla e sostituisce il referto R3YEA050100 del 05/10/2026', 'Germe Isolato        Escherichia coli', 'KPC test di conferma     Negativo', 'R: Resistente I: Intermedio S: Sensibile', 'FARMACI', 'Carbamazepina        10,6 µg/ml        4,0 - 12,0', 'Metodo: Immunochimico (KIMS)']) assert.ok(!isTestoLaboratorio(r), r);
});

test('rilevamento della sorgente', () => {
  assert.equal(rilevaSorgente(pagine('bianalisi_urinocoltura')[0]), 'BIANALISI');
  assert.equal(rilevaSorgente(pagine('merge_kpc_rdi')[0]), 'CERBA_RDI');
  assert.equal(rilevaSorgente(pagine('nuova_igea_urinocoltura')[0]), 'CERBA_NUOVA_IGEA');
  assert.equal(rilevaSorgente(pagine('lettera_offerta')[0]), null);
});

test('PDF non referto: scartato con motivo', () => {
  const r = elabora({ pagine: pagine('lettera_offerta') });
  assert.equal(r.schede.length, 0); assert.match(r.motivo_scarto, /non è un referto/);
});

test('Bianalisi: una scheda su 2 pagine, settori, antibiogramma testuale, valore ricomposto, note', () => {
  const r = elabora({ pagine: pagine('bianalisi_urinocoltura') });
  assert.equal(r.sorgente, 'BIANALISI'); assert.equal(r.schede.length, 1);
  const s = r.schede[0]; const d = s.dati;
  assert.deepEqual(s.pagine, [1, 2]);
  assert.equal(d.corpo, 1); assert.equal(d.variante, 'B');
  assert.equal(d.anagrafica.cognome_nome, 'ROSSI MARIA'); assert.equal(d.anagrafica.eta, 52);
  assert.equal(d.anagrafica.sesso, 'F'); assert.equal(d.anagrafica.luogo_nascita, 'PRATO (PO)'); assert.equal(d.anagrafica.indirizzo, 'Via dei Mille 3, 50131 Firenze (FI)');
  assert.deepEqual(d.settori.map((x) => x.titolo), ['MICROBIOLOGIA', 'MICROBIOLOGIA MOLECOLARE']);
  const righe = d.settori[0].righe;
  const ab = righe.filter((x) => x.tipo === 'antibiotico');
  assert.equal(ab.length, 7);                                   // prosegue a pagina 2
  assert.deepEqual(ab.map((x) => x.nome).slice(0, 2), ['Amoxicillina/Ac. Clavulanico', 'Cefixime']);   // legatura normalizzata
  assert.deepEqual(ab.find((x) => x.nome === 'Ciprofloxacina'), { tipo: 'antibiotico', nome: 'Ciprofloxacina', esito: 'Intermedio', mic: '0,25' });
  const esbl = righe.findIndex((x) => x.nome?.startsWith('ESBL'));
  assert.ok(esbl > righe.findIndex((x) => x.nome === 'Cefixime') && esbl < righe.findIndex((x) => x.nome === 'Ciprofloxacina'), 'ESBL resta in mezzo agli antibiotici');
  assert.equal(righe.find((x) => x.nome === 'Esame batterioscopico urine').risultato, 'Sviluppo di un discreto numero di colonie');
  assert.equal(righe.filter((x) => x.tipo === 'legenda').length, 4);
  assert.equal(righe.find((x) => x.nome === 'Carica Batterica').risultato, '10^5 UFC/mL');
  assert.deepEqual(d.settori[1].righe[0].sotto, ['Metodo: PCR Real Time', 'Materiale Urine']);
  assert.deepEqual(d.note, ['(1) Esame eseguito Bianalisi Verano Brianza (MB)', 'Il presente documento annulla e sostituisce il referto R3YEA050100 del 05/10/2026']);
  assert.ok(codici(s).includes('VALORE_RICOMPOSTO')); assert.ok(codici(s).includes('SOSTITUZIONE'));
  assert.ok(!codici(s).includes('RIGA_NON_INTERPRETATA'), 'firme e diciture legali non finiscono nel corpo');
  assert.equal(d.conteggi.antibiotici_sorgente, 7);
  // riquadro isolato: testo_sorgente = riga anagrafica + riquadro, niente intestazione/piè del laboratorio esterno
  const ts = s.testo_sorgente;
  assert.ok(ts.startsWith('ROSSI MARIA  F  16/04/1974  (anni 52)  PRATO (PO)  Via dei Mille 3, 50131 Firenze (FI)  R3YEA050123  05/10/2026  A3YEA050123  02/10/2026'));
  for (const x of ['BIANALISI S.p.A', 'Via dei Laboratori', 'Referto R3YEA050123', 'Medico richiedente', 'Reparto', 'Firma', 'P.IVA', 'firmato digitalmente', 'Pagina 1 di 2', 'TOLAFI', 'Analisi  ']) assert.ok(!ts.includes(x), `testo_sorgente non deve contenere "${x}"`);
  for (const x of ['Carica Batterica', '10^5 UFC/mL', 'Sensibile - MIC <=4', '(1) Esame eseguito Bianalisi Verano Brianza (MB)', 'annulla e sostituisce il referto R3YEA050100']) assert.ok(ts.includes(x), `testo_sorgente deve contenere "${x}"`);
});

test('Cerba RDI: merge spezzato in 3 pazienti, anagrafica abbreviata segnalata, KPC senza anomalie', () => {
  const pg = pagine('merge_kpc_rdi');
  assert.equal(spezzaPerPaziente(pg, 'CERBA_RDI').length, 3);
  const r = elabora({ pagine: pg });
  assert.equal(r.schede.length, 3);
  assert.deepEqual(r.schede.map((s) => s.dati.anagrafica.cognome_nome), ['GIANNINI PAOLA', 'BEGUM FATIMA', 'CRS LCN']);
  assert.deepEqual(r.schede.map((s) => s.pagine), [[1], [2], [3]]);
  const g = r.schede[0].dati;
  assert.equal(g.anagrafica.accettazione_n, '2026/0456781'); assert.equal(g.anagrafica.data_acc, '04/09/2026');   // solo registro interno
  assert.equal(g.anagrafica.luogo_nascita, 'FIRENZE (FI)'); assert.equal(g.anagrafica.indirizzo, 'Via Roma 12, 50123 Firenze (FI)');
  assert.equal(r.schede[1].dati.anagrafica.luogo_nascita, 'DHAKA (BANGLADESH)'); assert.equal(r.schede[1].dati.anagrafica.indirizzo, undefined);   // indirizzo assente: nessuna anomalia
  for (const s of r.schede) for (const x of ['Rete Diagnostica', 'Direttore', 'Medico richiedente', 'Validato', 'P.IVA', 'Pagina 1 di 1', 'Accettazione n°', 'Esame  ', 'Valori di Riferimento']) assert.ok(!s.testo_sorgente.includes(x), `testo_sorgente non deve contenere "${x}"`);
  const kpc = g.settori[0].righe[0];
  assert.equal(kpc.nome, 'KPC test di conferma'); assert.equal(kpc.risultato, 'Negativo'); assert.equal(kpc.riferimento, 'Negativo');
  assert.deepEqual(kpc.sotto, ['Metodo: Colturale su terreno cromogeno', 'Materiale: T.AMIES', 'Sede Anatomica: rettale']);
  assert.deepEqual(codici(r.schede[0]), []);
  assert.deepEqual(codici(r.schede[2]), ['ANAGRAFICA_ABBREVIATA']);
});

test('Cerba Nuova Igea: corpo 2, due microrganismi affiancati separati, #2 senza gli antibiotici vuoti, esito lungo integrale', () => {
  const r = elabora({ pagine: pagine('nuova_igea_urinocoltura') });
  assert.equal(r.schede.length, 1);
  const s = r.schede[0]; const d = s.dati;
  assert.equal(d.corpo, 2);
  assert.equal(d.anagrafica.cognome_nome, 'GRASSI TIZIANA'); assert.equal(d.anagrafica.accettazione_n, '26/001234');
  assert.equal(d.anagrafica.luogo_nascita, 'FIRENZE (FI)'); assert.equal(d.anagrafica.indirizzo, 'Via Pisana 120, 50143 Firenze (FI)'); assert.equal(d.anagrafica.sesso, 'F');
  for (const x of ['Nuova Igea', 'Duccio di Buoninsegna', 'Direttore', 'Richiedente', 'Firma', 'www.', 'Pagina 1 di 1']) assert.ok(!s.testo_sorgente.includes(x), `testo_sorgente non deve contenere "${x}"`);
  assert.deepEqual(d.esami.map((e) => e.titolo), ['URINOCOLTURA', 'ESAME MICROSCOPICO DIVERSI']);
  const u = d.esami[0];
  assert.equal(u.metodo, 'Colturale'); assert.equal(u.materiale, 'Urine mitto intermedio'); assert.match(u.nota, /Nomenclatore 2025/);
  assert.equal(u.campi.find((c) => c.etichetta === 'Antibiogramma/Antimicogramma').valore, 'Interpretazione secondo EUCAST 2025. Sono riportati solo gli antibiotici con indicazione per le infezioni urinarie.');
  assert.equal(d.antibiogrammi.length, 2);
  const [a1, a2] = d.antibiogrammi;
  assert.equal(a1.specie, 'Escherichia coli'); assert.equal(a1.carica, '100.000 UFC/ml'); assert.equal(a1.carica_label, 'Carica Batterica');
  assert.equal(a2.specie, 'Klebsiella pneumoniae'); assert.equal(a2.carica_label, 'Carica Batterica Totale');
  assert.equal(a1.legenda, 'R: Resistente I: Sensibile con aumentata esposizione al farmaco S: Sensibile');
  assert.equal(a1.righe.length, 6); assert.equal(a2.righe.length, 4);
  assert.deepEqual(a1.righe[2], { antibiotico: 'CIPROFLOXACINA', sir: 'S', mic: '<=0,25' });
  assert.deepEqual(a2.righe[0], { antibiotico: 'AMOXICILLINA/AC.CLAVULANICO', sir: 'R', mic: '>32' });
  assert.ok(!a2.righe.some((x) => x.antibiotico === 'CIPROFLOXACINA'));
  assert.equal(d.esami[1].campi.length, 3);
  assert.deepEqual(codici(s), ['DUE_MICRORGANISMI']);
  assert.equal(d.conteggi.antibiotici_sorgente, 10);
  assert.equal(contaAntibiotici(d), 10);
});

test('OCR: anomalia "verifica manuale obbligatoria" in testa', () => {
  const r = elabora({ pagine: pagine('merge_kpc_rdi'), ocr: true });
  assert.equal(codici(r.schede[0])[0], 'OCR');
});

test('nome del file e suffisso', () => {
  const r = elabora({ pagine: pagine('merge_kpc_rdi') });
  assert.equal(nomeBase('GIANNINI PAOLA'), 'Referto - GIANNINI PAOLA');
  assert.equal(suffissoPer(r.schede[0].dati, 'ESAME'), 'KPC');
  assert.equal(suffissoPer(r.schede[0].dati, 'SORGENTE'), 'Cerba RDI');
  assert.equal(suffissoPer(r.schede[0].dati, 'DATA'), '04-09-2026');
  assert.equal(suffissoPer(elabora({ pagine: pagine('nuova_igea_urinocoltura') }).schede[0].dati, 'ESAME'), 'Urinocoltura');
});

test('generatore DOCX: anagrafica completa nel riquadro, nessun codice/testo del laboratorio esterno, coerenza superata (anche inversa)', async () => {
  for (const name of ['bianalisi_urinocoltura', 'nuova_igea_urinocoltura', 'merge_kpc_rdi']) {
    const pg = pagine(name);
    const r = elabora({ pagine: pg });
    for (const s of r.schede) {
      const docx = await generaDocx(s.dati);
      assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK');
      const testo = testoDocx(docx);
      const a = s.dati.anagrafica;
      // riquadro come il modello del Laboratorio (29/10/2026): titolo del riquadro = nome del paziente, poi Data di nascita, Sesso, riferimenti di accettazione; luogo/indirizzo solo se presenti
      const righe = testo.split('\n').filter(Boolean);
      assert.equal(righe[0], a.cognome_nome);
      assert.ok(testo.includes(`Sesso: ${a.sesso}`));
      assert.ok(testo.includes(a.eta != null ? `Data di nascita: ${a.data_nascita} (anni ${a.eta})` : `Data di nascita: ${a.data_nascita}`));
      if (a.variante === 'B') { assert.ok(testo.includes(`Referto: ${a.referto_codice} del ${a.referto_data}`)); assert.ok(testo.includes(`Accettazione: ${a.accettazione_codice} del ${a.accettazione_data}`)); }
      else { assert.ok(testo.includes(`Accettazione n°: ${a.accettazione_n}`)); assert.ok(testo.includes(`Data Acc.: ${a.data_acc}`)); }
      if (a.luogo_nascita) assert.ok(testo.includes(`Luogo di nascita: ${a.luogo_nascita}`)); else assert.ok(!testo.includes('Luogo di nascita'), 'senza luogo la riga non compare');
      if (a.indirizzo) assert.ok(testo.includes(`Indirizzo: ${a.indirizzo}`)); else assert.ok(!testo.includes('Indirizzo:'), 'senza indirizzo la riga non compare');
      assert.ok(!/: -$/m.test(testo), 'nessun trattino per campi vuoti');
      // nessun riferimento al laboratorio esterno né righe spurie (le note del riquadro sono ammesse)
      for (const x of ['BIANALISI S.p.A', 'Rete Diagnostica', 'Nuova Igea', 'Direttore', 'Medico richiedente', 'Pagina 1 di', 'Valori di Riferimento', 'Toscana Diagnostica']) assert.ok(!testo.includes(x), `${name}: "${x}" non deve comparire nel DOCX`);
      assert.deepEqual(testoLabEsterno(testo, s.dati.note), []); assert.deepEqual(righeSpurie(testo, s.dati.note), []);
      const coe = controllaCoerenza({ datiOrig: s.dati, dati: s.dati, testoSorgente: s.testo_sorgente, testoDocx: testo });
      assert.ok(coe.ok, `${name}: ${JSON.stringify(coe.check.filter((c) => !c.ok))}`);
      assert.deepEqual(coe.check.map((c) => c.codice), ['TOKEN_RISULTATI', 'N_ANTIBIOTICI', 'NUMERI_IN_PIU', 'ANAGRAFICA', 'TESTO_LAB_ESTERNO', 'RIGHE_SPURIE']);
      assert.ok(tokenRisultati(s.dati).length > 5);
    }
  }
});

test('coerenza inversa: testo del laboratorio esterno forzato nel referto TD fa fallire il controllo; anagrafica incompleta segnalata', async () => {
  const pg = pagine('merge_kpc_rdi');
  const orig = elabora({ pagine: pg }).schede[0];
  const testoSorgente = orig.testo_sorgente;
  // codice di accettazione esterno infilato in una riga del riquadro
  const mod = JSON.parse(JSON.stringify(orig.dati));
  mod.settori[0].righe.push({ tipo: 'testo', testo: 'Accettazione n° 2026/0456781 - Rete Diagnostica Italiana' });
  let coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod, testoSorgente, testoDocx: testoDocx(await generaDocx(mod)) });
  let by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(coe.ok, false); assert.equal(by.TESTO_LAB_ESTERNO.ok, false);
  assert.ok(by.TESTO_LAB_ESTERNO.dettagli.some((d) => /Accettazione/.test(d)) && by.TESTO_LAB_ESTERNO.dettagli.some((d) => /Rete Diagnostica/.test(d)));
  // codice R3YE nel nome di un esame
  const mod2 = JSON.parse(JSON.stringify(orig.dati));
  mod2.settori[0].righe[0].nome = 'KPC test di conferma R3YEA050123';
  coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod2, testoSorgente, testoDocx: testoDocx(await generaDocx(mod2)) });
  by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.TESTO_LAB_ESTERNO.ok, false); assert.match(by.TESTO_LAB_ESTERNO.dettagli[0], /R3YE/);
  // nota di sostituzione del riquadro (con codice R3YE) e nota "(1) Esame eseguito Bianalisi…": ammesse
  const bia = elabora({ pagine: pagine('bianalisi_urinocoltura') }).schede[0];
  assert.deepEqual(testoLabEsterno(testoDocx(await generaDocx(bia.dati)), bia.dati.note), []);
  // anagrafica incompleta: senza sesso e accettazione (il luogo di nascita è facoltativo: senza, nessuna anomalia)
  const mod3 = JSON.parse(JSON.stringify(orig.dati));
  mod3.anagrafica.luogo_nascita = ''; mod3.anagrafica.sesso = ''; mod3.anagrafica.accettazione_n = '';
  coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod3, testoSorgente, testoDocx: testoDocx(await generaDocx(mod3)) });
  by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.ANAGRAFICA.ok, false); assert.deepEqual(by.ANAGRAFICA.dettagli, ['sesso', 'accettazione']);
  const senzaLuogo = elabora({ pagine: pg.map((p) => p.replace(/Luogo di nascita: .*?\([A-Z]+\)/, '')) });
  assert.ok(senzaLuogo.schede.every((s) => !s.anomalie.some((x) => x.codice === 'ANAGRAFICA_INCOMPLETA')));
  const senzaSesso = elabora({ pagine: pg.map((p) => p.replace(/Sesso: [FM]/g, '')) });
  assert.ok(senzaSesso.schede.every((s) => s.anomalie.some((x) => x.codice === 'ANAGRAFICA_INCOMPLETA' && /sesso/.test(x.testo))));
  // righe spurie forzate nel corpo: testata di tabella, firma digitale, dicitura legale
  const mod4 = JSON.parse(JSON.stringify(orig.dati));
  mod4.settori[0].righe.push({ tipo: 'testo', testo: 'Esame   Risultato   U.M.   Valori di Riferimento' }, { tipo: 'testo', testo: '28-10-2026 15.30 SN=4918597, Emesso dall\'Ente Certificatore: InfoCamere' }, { tipo: 'testo', testo: 'I risultati di questo referto sono interpretabili solo dal medico curante' });
  coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod4, testoSorgente, testoDocx: testoDocx(await generaDocx(mod4)) });
  by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.RIGHE_SPURIE.ok, false); assert.equal(by.RIGHE_SPURIE.dettagli.length, 3);
  assert.match(by.RIGHE_SPURIE.dettagli[0], /testata/); assert.match(by.RIGHE_SPURIE.dettagli[1], /firma/); assert.match(by.RIGHE_SPURIE.dettagli[2], /dicitura legale/);
});

test('sorgente non riconosciuta (caso CHIARI STEFANIA / FARMACI del 29/10/2026): nome corretto, nessun settore inventato, una sola riga esame, riquadro con accettazione, DOCX senza righe spurie', async () => {
  const pg = pagine('altro_farmaci');
  assert.equal(rilevaSorgente(pg[0]), null);
  const r = elabora({ pagine: pg });
  assert.equal(r.sorgente, 'ALTRO'); assert.equal(r.motivo_scarto, null); assert.equal(r.schede.length, 1);   // non è uno scarto
  const s = r.schede[0]; const d = s.dati;
  assert.deepEqual(codici(s), ['SORGENTE_ALTRO']);
  assert.equal(d.anagrafica.cognome_nome, 'CHIARI STEFANIA'); assert.equal(d.anagrafica.data_nascita, '25/05/1965'); assert.equal(d.anagrafica.sesso, 'F');
  assert.equal(d.anagrafica.accettazione_n, '3370'); assert.equal(d.anagrafica.data_acc, '27/10/2026'); assert.equal(d.anagrafica.variante, 'A');
  assert.equal(d.anagrafica.luogo_nascita, undefined); assert.equal(d.anagrafica.indirizzo, undefined);
  assert.equal(d.corpo, 1);
  assert.deepEqual(d.settori.map((x) => x.titolo), ['FARMACI']);          // solo il settore della sorgente, nessun MICROBIOLOGIA
  assert.equal(d.settori[0].righe.length, 1);
  assert.deepEqual(d.settori[0].righe[0], { tipo: 'esame', nome: 'Carbamazepina', risultato: '10,6 µg/ml', unita: '', riferimento: '4,0 - 12,0', sotto: ['Metodo: Immunochimico (KIMS)', 'Materiale: SIERO'] });
  for (const x of ['TOSCANA DIAGNOSTICA', 'Valori di Riferimento', 'SN=', 'InfoCamere', 'GERINI', 'I risultati di questo referto', 'Regolamento', 'Pagina 1 di 1', 'SAN MARCO', 'P.IVA']) assert.ok(!s.testo_sorgente.includes(x), `testo_sorgente non deve contenere "${x}"`);
  const testo = testoDocx(await generaDocx(d));
  const righe = testo.split('\n').filter(Boolean);
  assert.deepEqual(righe.slice(0, 5), ['CHIARI STEFANIA', 'Data di nascita: 25/05/1965', 'Sesso: F', 'Accettazione n°: 3370', 'Data Acc.: 27/10/2026']);
  assert.deepEqual(righe.slice(5), ['FARMACI', 'Carbamazepina', 'Metodo: Immunochimico (KIMS)', 'Materiale: SIERO', '10,6 µg/ml', '4,0 - 12,0']);   // nient'altro
  assert.ok(!testo.includes('Luogo di nascita') && !testo.includes('Indirizzo'));
  const coe = controllaCoerenza({ datiOrig: d, dati: d, testoSorgente: s.testo_sorgente, testoDocx: testo });
  assert.ok(coe.ok, JSON.stringify(coe.check.filter((c) => !c.ok)));
  assert.equal(suffissoPer(d, 'SORGENTE'), 'Esterno');
});

test('senza titolo di settore nella sorgente il corpo parte senza titolo', async () => {
  const pg = pagine('altro_farmaci').map((p) => p.replace(/^FARMACI\s*$/m, ''));
  const s = elabora({ pagine: pg }).schede[0];
  assert.deepEqual(s.dati.settori.map((x) => x.titolo), ['']);
  assert.equal(s.dati.settori[0].righe.length, 1);
  const righe = testoDocx(await generaDocx(s.dati)).split('\n').filter(Boolean);
  assert.equal(righe[5], 'Carbamazepina');
});

test('coerenza: valore mancante, antibiotico in meno e numero in più vengono segnalati', async () => {
  const pg = pagine('nuova_igea_urinocoltura');
  const orig = elabora({ pagine: pg }).schede[0];
  const mod = JSON.parse(JSON.stringify(orig.dati));
  mod.antibiogrammi[0].righe.pop();                 // un antibiotico in meno
  mod.esami[0].campi[1].valore = 'Positivo 999';    // numero inventato
  const docx = await generaDocx(mod);
  const coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod, testoSorgente: orig.testo_sorgente, testoDocx: testoDocx(docx) });
  assert.equal(coe.ok, false);
  const by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.N_ANTIBIOTICI.ok, false); assert.equal(by.N_ANTIBIOTICI.dettagli.scheda, 9);
  assert.equal(by.NUMERI_IN_PIU.ok, false); assert.ok(by.NUMERI_IN_PIU.dettagli.includes('999'));
  assert.equal(by.TOKEN_RISULTATI.ok, false); assert.ok(by.TOKEN_RISULTATI.dettagli.includes('>4'));   // MIC dell'antibiotico tolto
  assert.equal(by.ANAGRAFICA.ok, true);
});

test('riquadro anagrafico: nome del paziente 12 pt bold 004F5F come titolo, righe 8,5 pt', async () => {
  const PizZip = (await import('pizzip')).default;
  const s = elabora({ pagine: pagine('altro_farmaci') }).schede[0];
  const xml = new PizZip(await generaDocx(s.dati)).file('word/document.xml').asText();
  const run = (testo) => { const i = xml.indexOf(`<w:t xml:space="preserve">${testo}</w:t>`) >= 0 ? xml.indexOf(`<w:t xml:space="preserve">${testo}</w:t>`) : xml.indexOf(`<w:t>${testo}</w:t>`); assert.ok(i > 0, testo); return xml.slice(xml.lastIndexOf('<w:r>', i), i); };
  const nome = run('CHIARI STEFANIA'); assert.match(nome, /w:sz w:val="24"/); assert.match(nome, /<w:b\/>/); assert.match(nome, /w:color w:val="004F5F"/);
  const data = run('25/05/1965'); assert.match(data, /w:sz w:val="17"/);
});

test('trapianto OpenXML: header, footer e media del template restano, document.xml è quello generato', async () => {
  const PizZip = (await import('pizzip')).default;
  const pg = pagine('merge_kpc_rdi');
  const s = elabora({ pagine: pg }).schede[0];
  const docx = await generaDocx(s.dati);
  const z = new PizZip(docx);
  assert.ok(z.file('word/header1.xml')); assert.ok(z.file('word/footer1.xml')); assert.ok(z.file('word/media/image1.png'));
  const xml = z.file('word/document.xml').asText();
  assert.match(xml, /<w:headerReference/); assert.match(xml, /w:top="2233"/);     // margini canonici sul template predefinito
  assert.match(xml, /KPC test di conferma/);
  assert.equal((xml.match(/<w:sectPr/g) || []).length, 1);
  // template "utente": margini del template conservati
  const tplBuf = fs.readFileSync(new URL('../src/modules/referti/templates/carta_intestata_default.docx', import.meta.url));
  const z2 = new PizZip(trapianta(docx, tplBuf));
  assert.match(z2.file('word/document.xml').asText(), /w:top="1417"/);
});

// Layout reale Nuova Igea (PDF del 29/10/2026, dati anonimizzati): nome da solo nella riga sopra "Data di nascita", "Carica Batterica" sulla
// riga del microrganismo, intestazione di colonna con la specie (anche spezzata), legenda con "#1 MIC" in coda, titolo di esame a capo,
// etichetta incollata al valore ("…di GramScarsi lattobacilli;"), tabella che prosegue a pagina 2 con la testata ripetuta
const NI_P1 = `                                                            Cerba HealthCare Toscana s.r.l. - Nuova Igea
                                                            Via Duccio di Buoninsegna 54 - 50143 - FIRENZE
                                                            Rev. 2.16 del 13/08/2026

ROSSI MARIA
                                                            ROSSI MARIA
Data di nascita: 03/02/1975                                 Sesso: F

                                                            Accettazione n°: 1409
                                                            Data Acc.: 24/10/2026                       130057473000

                                                            TOSCANA DIAGNOSTICA S.R.L.

                  Esame                                       Risultato                      U.M.      Valori di Riferimento
MICROBIOLOGIA
ESAME MICROBIOLOGICO DEL SECRETO
VAGINALE
Metodo: microscopico - colturale
Materiale: T.VAGI.AMIES
Nuova descrizione dell'esame come da Nomenclatore 2025

  Esame microscopico dopo colorazione di GramScarsi lattobacilli;
                                             Bacilli gram negativi

  Specie Microbiche Isolate                                   Escherichia coli
  Esito                                                       Esame colturale: POSITIVO

                Microrganismo #1: Escherichia coli                                   Carica Batterica: 1.000.000 UFC/ml

                                                                                   Escherichia
                                                                                   coli
                  R: Resistente I: Sensibile con aumentata esposizione al farmaco  #1        MIC
                AMIKACINA                                                           S         <=4
                CEFTAZIDIME                                                         R           8
                                                                                                            Pagina 1 di 2
`;
const NI_P2 = `                                                            Cerba HealthCare Toscana s.r.l. - Nuova Igea
ROSSI MARIA
Data di nascita: 03/02/1975                                 Sesso: F
                                                            Accettazione n°: 1409
                                                            Data Acc.: 24/10/2026
                  Esame                                       Risultato                      U.M.      Valori di Riferimento
                Microrganismo #1: Escherichia coli
                                                                                   Escherichia coli
                  R: Resistente I: Sensibile con aumentata esposizione al farmaco  #1        MIC
                MEROPENEM                                                           S       <=0,5
      28-10-2026   15.51   SN=72817115868 Emesso dall'Ente Certificatore                  Referto firmato da: DOTT.SSA BIANCHI ANNA
                                                                                                            Pagina 2 di 2
`;
test('Nuova Igea, layout reale del 29/10/2026: nome, carica, antibiogramma su due pagine, titolo a capo, etichetta incollata', async () => {
  const s = elabora({ pagine: [NI_P1, NI_P2] }).schede[0];
  const d = s.dati;
  assert.equal(d.anagrafica.cognome_nome, 'ROSSI MARIA'); assert.equal(d.anagrafica.data_nascita, '03/02/1975'); assert.equal(d.anagrafica.sesso, 'F'); assert.equal(d.anagrafica.accettazione_n, '1409');
  assert.deepEqual(d.settori.map((x) => x.titolo), ['MICROBIOLOGIA']);
  assert.equal(d.esami.length, 1); assert.equal(d.esami[0].titolo, 'ESAME MICROBIOLOGICO DEL SECRETO VAGINALE');
  assert.equal(d.esami[0].metodo, 'microscopico - colturale'); assert.equal(d.esami[0].materiale, 'T.VAGI.AMIES'); assert.match(d.esami[0].nota, /Nomenclatore 2025/);
  assert.deepEqual(d.esami[0].campi.map((c) => [c.etichetta, c.valore]), [['Esame microscopico dopo colorazione di Gram', 'Scarsi lattobacilli; Bacilli gram negativi'], ['Specie Microbiche Isolate', 'Escherichia coli'], ['Esito', 'Esame colturale: POSITIVO']]);
  assert.equal(d.antibiogrammi.length, 1);
  const b = d.antibiogrammi[0];
  assert.equal(b.specie, 'Escherichia coli'); assert.equal(b.carica, '1.000.000 UFC/ml'); assert.match(b.legenda, /^R: Resistente/); assert.ok(!/#1|MIC/.test(b.legenda));
  assert.deepEqual(b.righe.map((r) => [r.antibiotico, r.sir, r.mic]), [['AMIKACINA', 'S', '<=4'], ['CEFTAZIDIME', 'R', '8'], ['MEROPENEM', 'S', '<=0,5']]);
  assert.ok(!s.anomalie.some((a) => a.codice === 'RIGA_NON_INTERPRETATA' || a.codice === 'ANAGRAFICA_INCOMPLETA' || a.codice === 'CARICA_ASSENTE'), JSON.stringify(s.anomalie));
  const testo = testoDocx(await generaDocx(d));
  assert.equal(testo.split('\n').filter(Boolean)[0], 'ROSSI MARIA'); assert.ok(!testo.includes('PAZIENTE')); assert.ok(!testo.includes('Escherichia\ncoli')); assert.ok(!testo.includes('TOSCANA DIAGNOSTICA S.R.L.'));
});
