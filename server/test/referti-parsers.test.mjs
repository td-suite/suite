// Referti esterni: test dei parser (Bianalisi, Cerba RDI merge, Cerba Nuova Igea, non referto), del generatore DOCX e del controllo
// di coerenza. I PDF di prova sono sintetici (test/fixtures/referti/genera.py): i parser vanno ricalibrati sui PDF reali.
// Il testo (.txt) è l'uscita di `pdftotext -layout`, così i test girano anche senza poppler. Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elabora, rilevaSorgente, spezzaPerPaziente } from '../src/modules/referti/lib/parsers/index.js';
import { segmenti, anagraficaA, anagraficaB } from '../src/modules/referti/lib/parsers/common.js';
import { pulisci, anagraficaAbbreviata } from '../src/modules/referti/lib/text.js';
import { generaDocx, testoDocx, trapianta } from '../src/modules/referti/lib/docgen.js';
import { controllaCoerenza, tokenRisultati, contaAntibiotici } from '../src/modules/referti/lib/coerenza.js';
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

test('anagrafica variante A e B', () => {
  const a = anagraficaA(['Paziente: GIANNINI PAOLA        Nato il: 12/03/1960     Sesso: F', 'Accettazione n° 2026/0456781      Data Acc. 04/09/2026']);
  assert.deepEqual(a, { variante: 'A', cognome_nome: 'GIANNINI PAOLA', data_nascita: '12/03/1960', sesso: 'F', accettazione_n: '2026/0456781', data_acc: '04/09/2026' });
  const b = anagraficaB(['Referto R3YEA050123 del 05/10/2026      Accettazione A3YEA050123 del 02/10/2026', 'ROSSI MARIA        F-16/04/1974 (anni 52) TOLAFI']);
  assert.equal(b.cognome_nome, 'ROSSI MARIA'); assert.equal(b.eta, 52); assert.equal(b.referto_codice, 'R3YEA050123'); assert.equal(b.accettazione_data, '02/10/2026'); assert.equal(b.sesso, 'F');
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
  assert.equal(d.conteggi.antibiotici_sorgente, 7);
});

test('Cerba RDI: merge spezzato in 3 pazienti, anagrafica abbreviata segnalata, KPC senza anomalie', () => {
  const pg = pagine('merge_kpc_rdi');
  assert.equal(spezzaPerPaziente(pg, 'CERBA_RDI').length, 3);
  const r = elabora({ pagine: pg });
  assert.equal(r.schede.length, 3);
  assert.deepEqual(r.schede.map((s) => s.dati.anagrafica.cognome_nome), ['GIANNINI PAOLA', 'BEGUM FATIMA', 'CRS LCN']);
  assert.deepEqual(r.schede.map((s) => s.pagine), [[1], [2], [3]]);
  const g = r.schede[0].dati;
  assert.equal(g.anagrafica.accettazione_n, '2026/0456781'); assert.equal(g.anagrafica.data_acc, '04/09/2026');
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

test('generatore DOCX: trapianto nel template, testo del corpo con tutti i valori, coerenza superata', async () => {
  for (const name of ['bianalisi_urinocoltura', 'nuova_igea_urinocoltura', 'merge_kpc_rdi']) {
    const pg = pagine(name);
    const r = elabora({ pagine: pg });
    for (const s of r.schede) {
      const docx = await generaDocx(s.dati);
      assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK');
      const testo = testoDocx(docx);
      assert.ok(testo.includes(s.dati.anagrafica.cognome_nome));
      const coe = controllaCoerenza({ datiOrig: s.dati, dati: s.dati, testoSorgente: s.pagine.map((n) => pg[n - 1]).join('\n'), testoDocx: testo });
      assert.ok(coe.ok, `${name}: ${JSON.stringify(coe.check.filter((c) => !c.ok))}`);
      assert.ok(tokenRisultati(s.dati).length > 5);
    }
  }
});

test('coerenza: valore mancante, antibiotico in meno e numero in più vengono segnalati', async () => {
  const pg = pagine('nuova_igea_urinocoltura');
  const orig = elabora({ pagine: pg }).schede[0];
  const mod = JSON.parse(JSON.stringify(orig.dati));
  mod.antibiogrammi[0].righe.pop();                 // un antibiotico in meno
  mod.esami[0].campi[1].valore = 'Positivo 999';    // numero inventato
  const docx = await generaDocx(mod);
  const coe = controllaCoerenza({ datiOrig: orig.dati, dati: mod, testoSorgente: pg.join('\n'), testoDocx: testoDocx(docx) });
  assert.equal(coe.ok, false);
  const by = Object.fromEntries(coe.check.map((c) => [c.codice, c]));
  assert.equal(by.N_ANTIBIOTICI.ok, false); assert.equal(by.N_ANTIBIOTICI.dettagli.scheda, 9);
  assert.equal(by.NUMERI_IN_PIU.ok, false); assert.ok(by.NUMERI_IN_PIU.dettagli.includes('999'));
  assert.equal(by.TOKEN_RISULTATI.ok, false); assert.ok(by.TOKEN_RISULTATI.dettagli.includes('>4'));   // MIC dell'antibiotico tolto
  assert.equal(by.ANAGRAFICA.ok, true);
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
