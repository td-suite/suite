// Referti esterni: test dei parser a mano (Bianalisi, Cerba RDI merge, Cerba Nuova Igea, non referto). Dal motore del 03/11/2026 la
// lettura la fa Claude (lib/lettura.js) e i parser sono SOLO la riserva senza chiave Anthropic: la loro uscita passa da daParser
// (lib/blocchi.js) al JSON a blocchi del generatore format TD (lib/formatTD.js). Qui anche la resa della riserva e il controllo di
// coerenza sul nuovo JSON. I PDF di prova sono sintetici (test/fixtures/referti/genera.py).
// Il testo (.txt) è l'uscita di `pdftotext -layout`, così i test girano anche senza poppler. Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elabora, rilevaSorgente, spezzaPerPaziente } from '../src/modules/referti/lib/parsers/index.js';
import { segmenti, anagraficaA, anagraficaB, isTestoLaboratorio, isTestataTabella, isFirma, isDicituraLegale } from '../src/modules/referti/lib/parsers/common.js';
import { pulisci, anagraficaAbbreviata } from '../src/modules/referti/lib/text.js';
import { generaDocx, testoDocx } from '../src/modules/referti/lib/formatTD.js';
import { controllaCoerenza, testoLabEsterno, righeSpurie } from '../src/modules/referti/lib/coerenza.js';
import { daParser, validaDati, contaAntibiotici } from '../src/modules/referti/lib/blocchi.js';
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
  assert.equal(contaAntibiotici(daParser(d)), 10);
});

test('OCR: anomalia "verifica manuale obbligatoria" in testa', () => {
  const r = elabora({ pagine: pagine('merge_kpc_rdi'), ocr: true });
  assert.equal(codici(r.schede[0])[0], 'OCR');
});

test('nome del file e suffisso (JSON a blocchi)', () => {
  const r = elabora({ pagine: pagine('merge_kpc_rdi') });
  assert.equal(nomeBase('GIANNINI PAOLA'), 'Referto - GIANNINI PAOLA');
  const d = daParser(r.schede[0].dati);
  assert.equal(suffissoPer(d, 'ESAME'), 'KPC');
  assert.equal(suffissoPer(d, 'SORGENTE'), 'Cerba RDI');
  assert.equal(suffissoPer(d, 'DATA'), '04-09-2026');
  assert.equal(suffissoPer(daParser(elabora({ pagine: pagine('nuova_igea_urinocoltura') }).schede[0].dati), 'ESAME'), 'Urinocoltura');
});

// Riserva: uscita del parser → JSON a blocchi → DOCX del generatore → coerenza
const riserva = (name, pg = pagine(name)) => elabora({ pagine: pg }).schede.map((s) => ({ ...s, blocchi: daParser(s.dati) }));
const coerenza = async (s, dati = s.blocchi) => { const testo = testoDocx(await generaDocx(dati)); return { testo, coe: controllaCoerenza({ dati, testoSorgente: s.testo_sorgente, testoDocx: testo, antibioticiSorgente: s.dati.conteggi?.antibiotici_sorgente ?? null }) }; };
const per = (coe) => Object.fromEntries(coe.check.map((c) => [c.codice, c]));

test('parser di riserva → blocchi: schema valido, riquadro come il modello, nessun testo del laboratorio esterno, coerenza verde', async () => {
  for (const name of ['bianalisi_urinocoltura', 'nuova_igea_urinocoltura', 'merge_kpc_rdi', 'bianalisi_senza_colonne', 'altro_farmaci']) {
    for (const s of riserva(name)) {
      const v = validaDati(s.blocchi);
      assert.ok(v.ok, `${name}: ${v.errore}`);
      const { testo, coe } = await coerenza(s);
      const a = s.dati.anagrafica;
      const righe = testo.split('\n').filter(Boolean);
      assert.equal(righe[0], a.cognome_nome);
      assert.ok(testo.includes(`Sesso:  ${a.sesso}`));
      assert.ok(testo.includes(a.eta != null ? `Data di nascita:  ${a.data_nascita} (anni ${a.eta})` : `Data di nascita:  ${a.data_nascita}`));
      if (a.variante === 'B') assert.ok(testo.includes(`Referto:  ${a.referto_codice} del ${a.referto_data}`));
      else assert.ok(testo.includes(`Accettazione n°:  ${a.accettazione_n}`) && testo.includes(`Data Acc.:  ${a.data_acc}`));
      assert.ok(!/:\s+-$/m.test(testo), 'nessun trattino per campi vuoti');
      for (const x of ['BIANALISI S.p.A', 'Rete Diagnostica', 'Direttore', 'Medico richiedente', 'Pagina 1 di', 'Toscana Diagnostica']) assert.ok(!testo.includes(x), `${name}: "${x}" non deve comparire nel DOCX`);
      assert.ok(coe.ok, `${name}: ${JSON.stringify(coe.check.filter((c) => !c.ok))}`);
      assert.deepEqual(coe.check.map((c) => c.codice), ['TOKEN_RISULTATI', 'VALORI_IN_SORGENTE', 'N_ANTIBIOTICI', 'NUMERI_IN_PIU', 'ANAGRAFICA', 'TESTO_LAB_ESTERNO', 'RIGHE_SPURIE']);
      assert.equal(s.blocchi.blocchi[s.blocchi.blocchi.length - 1].tipo, 'spacer', 'ogni referto chiude con lo spacer');
    }
  }
});

test('coerenza inversa sul JSON a blocchi: testo del laboratorio esterno, codici R3YE e righe spurie nel corpo fanno fallire il controllo; note a piè ammesse', async () => {
  const s = riserva('merge_kpc_rdi')[0];
  const mod = JSON.parse(JSON.stringify(s.blocchi));
  const t1 = mod.blocchi.find((b) => b.tipo === 'tabella1');
  t1.righe.push({ nome: 'Accettazione n° 2026/0456781 - Rete Diagnostica Italiana', risultato: '', riferimento: '', bold_name: false, small: [], unit: '' });
  let by = per((await coerenza(s, mod)).coe);
  assert.equal(by.TESTO_LAB_ESTERNO.ok, false);
  assert.ok(by.TESTO_LAB_ESTERNO.dettagli.some((d) => /Accettazione/.test(d)) && by.TESTO_LAB_ESTERNO.dettagli.some((d) => /Rete Diagnostica/.test(d)));
  const mod2 = JSON.parse(JSON.stringify(s.blocchi));
  mod2.blocchi.find((b) => b.tipo === 'tabella1').righe[0].nome = 'KPC test di conferma R3YEA050123';
  by = per((await coerenza(s, mod2)).coe);
  assert.equal(by.TESTO_LAB_ESTERNO.ok, false); assert.match(by.TESTO_LAB_ESTERNO.dettagli[0], /R3YE/);
  // nota a piè con codice R3YE o nome del laboratorio: ammessa (paragrafo copiato dalla sorgente)
  const bia = riserva('bianalisi_urinocoltura')[0];
  const testoBia = testoDocx(await generaDocx(bia.blocchi));
  assert.deepEqual(testoLabEsterno(testoBia, bia.blocchi), []);
  // righe spurie forzate nel corpo
  const mod4 = JSON.parse(JSON.stringify(s.blocchi));
  mod4.blocchi.find((b) => b.tipo === 'tabella1').righe.push(...['Esame   Risultato   U.M.   Valori di Riferimento', '28-10-2026 15.30 SN=4918597, Emesso dall\'Ente Certificatore: InfoCamere', 'I risultati di questo referto sono interpretabili solo dal medico curante'].map((nome) => ({ nome, risultato: '', riferimento: '', bold_name: false, small: [], unit: '' })));
  const sp = righeSpurie(testoDocx(await generaDocx(mod4)), mod4);
  assert.equal(sp.length, 3); assert.match(sp[0], /testata/); assert.match(sp[1], /firma/); assert.match(sp[2], /dicitura legale/);
  // anagrafica incompleta: senza sesso e accettazione
  const mod3 = JSON.parse(JSON.stringify(s.blocchi));
  mod3.anagrafica.righe = mod3.anagrafica.righe.filter(([e]) => !['Sesso', 'Accettazione n°'].includes(e));
  by = per((await coerenza(s, mod3)).coe);
  assert.equal(by.ANAGRAFICA.ok, false); assert.deepEqual(by.ANAGRAFICA.dettagli, ['sesso', 'accettazione']);
});

test('coerenza: valore cambiato, antibiotico in meno e numero in più vengono segnalati', async () => {
  const s = riserva('nuova_igea_urinocoltura')[0];
  const mod = JSON.parse(JSON.stringify(s.blocchi));
  const ab = mod.blocchi.find((b) => b.tipo === 'antibiogramma');
  const tolto = ab.righe.pop();                                                 // un antibiotico in meno
  mod.blocchi.find((b) => b.tipo === 'tabella2').righe[0].valore += ' 999';     // numero inventato
  const { coe } = await coerenza(s, mod);
  const by = per(coe);
  assert.equal(coe.ok, false);
  assert.equal(by.N_ANTIBIOTICI.ok, false); assert.equal(by.N_ANTIBIOTICI.dettagli.scheda, contaAntibiotici(s.blocchi) - 1);
  assert.equal(by.NUMERI_IN_PIU.ok, false); assert.ok(by.NUMERI_IN_PIU.dettagli.includes('999'));
  assert.equal(by.VALORI_IN_SORGENTE.ok, false); assert.ok(by.VALORI_IN_SORGENTE.dettagli.includes('999'));
  assert.equal(by.TOKEN_RISULTATI.ok, false); assert.ok(by.TOKEN_RISULTATI.dettagli.includes(tolto[2]), `MIC dell'antibiotico tolto (${tolto[2]})`);
  assert.equal(by.ANAGRAFICA.ok, true);
});

test('sorgente non riconosciuta (caso CHIARI STEFANIA / FARMACI del 29/10/2026): nome corretto, solo il settore della sorgente, una riga esame, riquadro con accettazione', async () => {
  const pg = pagine('altro_farmaci');
  assert.equal(rilevaSorgente(pg[0]), null);
  const r = elabora({ pagine: pg });
  assert.equal(r.sorgente, 'ALTRO'); assert.equal(r.motivo_scarto, null); assert.equal(r.schede.length, 1);   // non è uno scarto
  const s = r.schede[0]; const d = s.dati;
  assert.deepEqual(codici(s), ['SORGENTE_ALTRO']);
  assert.equal(d.anagrafica.cognome_nome, 'CHIARI STEFANIA'); assert.equal(d.anagrafica.accettazione_n, '3370'); assert.equal(d.anagrafica.data_acc, '27/10/2026');
  assert.deepEqual(d.settori.map((x) => x.titolo), ['FARMACI']);
  assert.deepEqual(d.settori[0].righe[0], { tipo: 'esame', nome: 'Carbamazepina', risultato: '10,6 µg/ml', unita: '', riferimento: '4,0 - 12,0', sotto: ['Metodo: Immunochimico (KIMS)', 'Materiale: SIERO'] });
  for (const x of ['TOSCANA DIAGNOSTICA', 'Valori di Riferimento', 'SN=', 'InfoCamere', 'GERINI', 'I risultati di questo referto', 'Regolamento', 'Pagina 1 di 1', 'SAN MARCO', 'P.IVA']) assert.ok(!s.testo_sorgente.includes(x), `testo_sorgente non deve contenere "${x}"`);
  const b = daParser(d);
  assert.deepEqual(b.anagrafica.righe, [['Data di nascita', '25/05/1965'], ['Sesso', 'F'], ['Accettazione n°', '3370'], ['Data Acc.', '27/10/2026']]);
  assert.deepEqual(b.blocchi.map((x) => x.tipo), ['settore', 'tabella1', 'spacer']);
  const righe = testoDocx(await generaDocx(b)).split('\n').filter(Boolean);
  assert.deepEqual(righe, ['CHIARI STEFANIA', 'Data di nascita:  25/05/1965', 'Sesso:  F', 'Accettazione n°:  3370', 'Data Acc.:  27/10/2026', 'FARMACI', 'Carbamazepina', 'Metodo: Immunochimico (KIMS)', 'Materiale: SIERO', '10,6 µg/ml', '4,0 - 12,0']);
  assert.equal(suffissoPer(b, 'SORGENTE'), 'Esterno');
});

test('senza titolo di settore nella sorgente il corpo parte senza titolo', async () => {
  const pg = pagine('altro_farmaci').map((p) => p.replace(/^FARMACI\s*$/m, ''));
  const s = elabora({ pagine: pg }).schede[0];
  assert.deepEqual(s.dati.settori.map((x) => x.titolo), ['']);
  const b = daParser(s.dati);
  assert.deepEqual(b.blocchi.map((x) => x.tipo), ['tabella1', 'spacer']);
  assert.equal(testoDocx(await generaDocx(b)).split('\n').filter(Boolean)[5], 'Carbamazepina');
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
  // riserva → blocchi del corpo 2 come il generatore del progetto (legenda con tre spazi tra le voci)
  const bl = daParser(d);
  assert.deepEqual(bl.blocchi.map((x) => x.tipo), ['settore', 'esame2', 'tabella2', 'spacer', 'antibiogramma', 'spacer']);
  assert.deepEqual(bl.blocchi[1].metodo, ['Metodo: microscopico - colturale', 'Materiale: T.VAGI.AMIES', "Nuova descrizione dell'esame come da Nomenclatore 2025"]);
  assert.equal(bl.blocchi[4].legenda, 'R: Resistente   I: Sensibile con aumentata esposizione al farmaco');
  const testo = testoDocx(await generaDocx(bl));
  assert.equal(testo.split('\n').filter(Boolean)[0], 'ROSSI MARIA'); assert.ok(!testo.includes('TOSCANA DIAGNOSTICA S.R.L.'));
});

// Caso RECCHIA del 31/10/2026 (righe di recchia.pdf anonimizzate in bianalisi_senza_colonne.txt): il parser riconosce gli antibiotici
// stampati senza colonne. Resa dal 03/11/2026: come i referti Bianalisi del progetto (AUDIBERTI, BOATWNGHT, PENG), l'antibiogramma
// resta nella tabella del corpo 1, una riga per antibiotico "Resistente - MIC 16", con la legenda Eucast sotto la riga Antibiogramma.
test('Bianalisi senza colonne (caso RECCHIA): antibiotici riconosciuti, settore, ESBL, legenda; conteggi di coerenza', () => {
  const r = elabora({ pagine: pagine('bianalisi_senza_colonne') });
  assert.equal(r.sorgente, 'BIANALISI'); assert.equal(r.schede.length, 1);
  const s = r.schede[0]; const d = s.dati;
  assert.deepEqual(codici(s), [], JSON.stringify(s.anomalie));
  assert.equal(d.anagrafica.cognome_nome, 'VERDI ANNA');
  assert.deepEqual(d.settori.map((x) => x.titolo), ['MICROBIOLOGIA']);
  const righe = d.settori[0].righe;
  const ab = righe.filter((x) => x.tipo === 'antibiotico');
  assert.equal(ab.length, 15); assert.equal(d.conteggi.antibiotici_sorgente, 15);
  assert.deepEqual(ab[0], { tipo: 'antibiotico', nome: 'Amoxicillina/Acido clavulanico', esito: 'Resistente', mic: '16' });
  assert.equal(righe.find((x) => x.nome === 'ESBL').descrizione, '(Extended Spectrum Beta Lactamase)');
  assert.equal(righe.filter((x) => x.tipo === 'legenda').length, 4);
  assert.match(righe.filter((x) => x.tipo === 'legenda')[3].testo, /^Intermedio = .*nel sito di infezione\)$/);
});

test('Bianalisi senza colonne: riserva resa come i referti Bianalisi del progetto (righe "Resistente - MIC 16" nella tabella del corpo 1), coerenza verde', async () => {
  const s = riserva('bianalisi_senza_colonne')[0];
  const b = s.blocchi;
  assert.deepEqual(b.anagrafica.righe, [['Data di nascita', '12/03/1980 (anni 46)'], ['Sesso', 'F'], ['Referto', 'R3YEA070011 del 28/10/2026'], ['Accettazione', 'A3YEA070011 del 27/10/2026']]);
  assert.deepEqual(b.blocchi.map((x) => x.tipo), ['settore', 'tabella1', 'spacer']);
  const t = b.blocchi[1].righe;
  assert.equal(contaAntibiotici(b), 15);
  assert.deepEqual(t.find((x) => x.nome === 'Amoxicillina/Acido clavulanico'), { nome: 'Amoxicillina/Acido clavulanico', risultato: 'Resistente - MIC 16', riferimento: '', bold_name: false, small: [], unit: '' });
  assert.equal(t.find((x) => x.nome.startsWith('ESBL')).nome, 'ESBL\n(Extended Spectrum Beta Lactamase)');
  const { coe } = await coerenza(s);
  assert.ok(coe.ok, JSON.stringify(coe.check.filter((c) => !c.ok)));
});
