// Referti esterni · casella template@ e invio al mittente (richiesta del CEO del 31/10/2026): test delle funzioni pure
// (lib/regoleInvio.js: decisione del flusso automatico, mai due invii dello stesso file senza azione esplicita, oggetto, mittente)
// e della resa a blocchi dell'antibiogramma del corpo 1 (lib/micro.js). Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisioneAutomatica, puoInviare, oggettoReferto, indirizzoDa, allegatoPdf, emailValida } from '../src/modules/referti/lib/regoleInvio.js';
import { partiSettore, titoloEsame, sirDi } from '../src/modules/referti/lib/micro.js';

test('flusso automatico: verde e senza anomalie → conferma e invio; altrimenti bozza e notifica LAB', () => {
  const base = { origine: 'CASELLA', coerenzaOk: true, anomalie: [], invioAttivo: true, fromEmail: 'lab@clinica.it' };
  assert.deepEqual(decisioneAutomatica(base), { conferma: true, invia: true, notifica: false, motivo: 'confermata e inviata al mittente' });
  let d = decisioneAutomatica({ ...base, anomalie: [{ codice: 'OCR' }] });
  assert.equal(d.conferma, false); assert.equal(d.invia, false); assert.equal(d.notifica, true); assert.match(d.motivo, /1 anomalia/);
  d = decisioneAutomatica({ ...base, coerenzaOk: false });
  assert.equal(d.conferma, false); assert.equal(d.notifica, true); assert.match(d.motivo, /coerenza/);
  d = decisioneAutomatica({ ...base, invioAttivo: false });
  assert.equal(d.conferma, true); assert.equal(d.invia, false); assert.equal(d.notifica, false);
  d = decisioneAutomatica({ ...base, fromEmail: 'non-un-indirizzo' });
  assert.equal(d.conferma, true); assert.equal(d.invia, false); assert.equal(d.notifica, true);
  d = decisioneAutomatica({ ...base, origine: 'UPLOAD' });
  assert.deepEqual([d.conferma, d.invia, d.notifica], [false, false, false]);
  assert.equal(decisioneAutomatica({ ...base, anomalie: 2 }).conferma, false);
});

test('invio: mai due volte lo stesso file allo stesso destinatario senza azione esplicita', () => {
  const to = 'Lab@Clinica.it';
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: [], allaConferma: true }).invia, true);
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: [], allaConferma: true, invioAttivo: false }).invia, false);
  const inviato = [{ to_email: 'lab@clinica.it', stato: 'INVIATO', file_sha256: 'a' }];
  // alla conferma (anche dopo Riapri, con file rigenerato) non si reinvia da soli
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'b', invii: inviato, allaConferma: true }).invia, false);
  assert.match(puoInviare({ toEmail: to, fileSha256: 'b', invii: inviato, allaConferma: true }).motivo, /Reinvia/);
  // "Invia al mittente" manuale: stesso file già partito → no; file nuovo → sì
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: inviato }).invia, false);
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'b', invii: inviato }).invia, true);
  // "Reinvia" (esplicito) sempre
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: inviato, esplicito: true }).invia, true);
  // un invio fallito non conta; un altro destinatario nemmeno
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: [{ to_email: 'lab@clinica.it', stato: 'FALLITO', file_sha256: 'a' }], allaConferma: true }).invia, true);
  assert.equal(puoInviare({ toEmail: 'altro@clinica.it', fileSha256: 'a', invii: inviato, allaConferma: true }).invia, true);
  // registro (MAIL_PROVIDER=log) conta come partito
  assert.equal(puoInviare({ toEmail: to, fileSha256: 'a', invii: [{ to_email: 'lab@clinica.it', stato: 'REGISTRATO', file_sha256: 'a' }] }).invia, false);
  assert.equal(puoInviare({ toEmail: '', fileSha256: 'a', esplicito: true }).invia, false);
  assert.equal(puoInviare({ toEmail: to, fileSha256: null, allaConferma: true }).invia, false);
});

test('oggetto, mittente, allegati PDF', () => {
  assert.equal(oggettoReferto('verdi  anna'), 'Toscana Diagnostica · Referto VERDI ANNA');
  assert.equal(indirizzoDa('Laboratorio Rossi <Lab@Rossi.IT>'), 'lab@rossi.it');
  assert.equal(indirizzoDa('lab@rossi.it'), 'lab@rossi.it');
  assert.equal(indirizzoDa('senza indirizzo'), '');
  assert.ok(emailValida('a.b@c.it')); assert.ok(!emailValida('a@b'));
  assert.ok(allegatoPdf('Referto ROSSI.pdf', 'application/octet-stream')); assert.ok(allegatoPdf('documento', 'application/pdf'));
  assert.ok(!allegatoPdf('logo.png', 'image/png')); assert.ok(!allegatoPdf('firma.pdf', 'application/pdf')); assert.ok(!allegatoPdf('referto.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
});

test('antibiogramma del corpo 1 a blocchi: esame, campi, Microrganismo #n e righe S/I/R; righe fuori dal blocco invariate', () => {
  assert.deepEqual(titoloEsame('U - Urinocoltura POSITIVA Ricerca completa microrganismi'), { titolo: 'Urinocoltura', flag: 'POSITIVA', descrizione: 'Ricerca completa microrganismi' });
  assert.deepEqual(titoloEsame('U - Urinocoltura (1)'), { titolo: 'Urinocoltura (1)', flag: '', descrizione: '' });
  assert.equal(sirDi('Sensibile'), 'S'); assert.equal(sirDi('intermedio'), 'I'); assert.equal(sirDi('R'), 'R');
  const righe = [
    { tipo: 'esame', nome: 'Glucosio', risultato: '90', unita: 'mg/dL', riferimento: '70 - 110' },
    { tipo: 'esame', nome: 'U - Urinocoltura', risultato: 'Positivo', riferimento: '', sotto: ['Metodo: Colturale', 'Materiale Urine'] },
    { tipo: 'esame', nome: 'Germe Isolato', risultato: 'Escherichia coli' },
    { tipo: 'legenda', testo: 'S = Sensibile' },
    { tipo: 'esame', nome: 'Germe Isolato', risultato: 'Escherichia coli' },
    { tipo: 'antibiotico', nome: 'Amikacina', esito: 'Sensibile', mic: '2' },
    { tipo: 'esame', nome: 'ESBL', descrizione: '(Extended Spectrum Beta Lactamase)', risultato: 'Negativo' },
    { tipo: 'antibiotico', nome: 'Ampicillina', esito: 'Resistente', mic: 'MIC >16' },
    { tipo: 'esame', nome: 'Germe Isolato', risultato: 'Klebsiella pneumoniae' },
    { tipo: 'antibiotico', nome: 'Cefixime', esito: 'Intermedio', mic: '1' },
    { tipo: 'esame', nome: 'Esame batterioscopico', risultato: 'Rari batteri' },
  ];
  const parti = partiSettore(righe);
  assert.deepEqual(parti.map((p) => p.tipo), ['righe', 'esame', 'righe']);
  assert.equal(parti[0].righe[0].nome, 'Glucosio'); assert.equal(parti[2].righe[0].nome, 'Esame batterioscopico');
  const e = parti[1];
  assert.equal(e.titolo, 'Urinocoltura'); assert.equal(e.metodo, 'Colturale'); assert.equal(e.materiale, 'Urine');
  assert.deepEqual(e.campi.map((c) => [c.etichetta, c.valore]), [['Esito', 'Positivo'], ['Germe Isolato', 'Escherichia coli'], ['ESBL (Extended Spectrum Beta Lactamase)', 'Negativo'], ['Germe Isolato', 'Klebsiella pneumoniae']]);
  assert.equal(e.antibiogrammi.length, 2);
  assert.deepEqual(e.antibiogrammi.map((b) => [b.n, b.specie, b.legenda, b.nota_legenda]), [[1, 'Escherichia coli', '', 'S = Sensibile'], [2, 'Klebsiella pneumoniae', '', 'S = Sensibile']]);
  assert.deepEqual(e.antibiogrammi[0].righe, [{ antibiotico: 'Amikacina', sir: 'S', mic: '2' }, { antibiotico: 'Ampicillina', sir: 'R', mic: '>16' }]);
  assert.deepEqual(e.antibiogrammi[1].righe, [{ antibiotico: 'Cefixime', sir: 'I', mic: '1' }]);
  // senza antibiotici: una sola parte, resa invariata
  assert.deepEqual(partiSettore(righe.slice(0, 1)), [{ tipo: 'righe', righe: righe.slice(0, 1) }]);
  assert.deepEqual(partiSettore([]), []);
});
