// Referti esterni · casella template@ e invio al mittente (richiesta del CEO del 31/10/2026): test delle funzioni pure
// (lib/regoleInvio.js: decisione del flusso automatico, mai due invii dello stesso file senza azione esplicita, oggetto, mittente).
// La resa a blocchi dell'antibiogramma Bianalisi di lib/micro.js (31/10/2026) è stata sostituita il 03/11/2026 dal porting del
// generatore del progetto (lib/formatTD.js): i suoi test sono in referti-formatTD.test.mjs e referti-parsers.test.mjs.
// Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisioneAutomatica, puoInviare, oggettoReferto, indirizzoDa, allegatoPdf, emailValida } from '../src/modules/referti/lib/regoleInvio.js';

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
