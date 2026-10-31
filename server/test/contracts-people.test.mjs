// Contracts · casella People (people@toscanadiagnostica.it): test delle funzioni pure di lib/peopleRules.js
// (chiave della scadenza, soglie di anticipo, identificativo TD-SCAD, abbinamento per email e nome, destinatario per tipo, proposta).
// Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deadlineKey, scadTag, parseScadKey, parseThresholds, thresholdDue, parseEmailList, parseRecipientMap, chooseRecipient, isInternal,
  matchByEmail, matchByName, reminderSubject, heuristicProposal, cleanProposal, findDates, acceptedFile, DEFAULT_MAP,
} from '../src/modules/contracts/lib/peopleRules.js';

const PEOPLE = [
  { id: 1, last_name: 'Rossi', first_name: 'Mario', email: 'mario.rossi@toscanadiagnostica.it', user_email: null },
  { id: 2, last_name: 'Bianchi', first_name: 'Lucia', email: 'lucia.bianchi@gmail.com', user_email: 'l.bianchi@toscanadiagnostica.it' },
  { id: 3, last_name: 'De Luca', first_name: 'Niccolò', email: null, user_email: null },
  { id: 4, last_name: 'Rossi', first_name: 'Anna', email: 'condivisa@studio.it' },
  { id: 5, last_name: 'Verdi', first_name: 'Paolo', email: 'condivisa@studio.it' },
];

test('chiave della scadenza: allegato, manuale, calcolata stabile e dipendente dalla data', () => {
  assert.equal(deadlineKey({ type: 'DOCUMENTO', ref: { attachment_id: 42 }, resource_id: 7, due_date: '2026-11-25' }), 'A42');
  assert.equal(deadlineKey({ type: 'MANUALE', ref: { deadline_id: 9 }, resource_id: 7, due_date: '2026-11-25' }), 'M9');
  const pol = { type: 'DOCUMENTO', title: 'Scadenza polizza RC professionale', resource_id: 7, due_date: '2026-11-20' };
  const k = deadlineKey(pol);
  assert.match(k, /^D7-20261120-[0-9A-F]{4}$/);
  assert.equal(deadlineKey({ ...pol }), k, 'stessa scadenza, stessa chiave');
  assert.notEqual(deadlineKey({ ...pol, due_date: '2027-11-20' }), k, 'rinnovata: chiave nuova');
  assert.notEqual(deadlineKey({ ...pol, title: 'Scadenza incarico' }), k, 'titolo diverso: chiave diversa');
  assert.match(deadlineKey({ type: 'PROVA', title: 'Fine periodo di prova', resource_id: 3, due_date: '2026-12-01' }), /^P3-20261201-/);
  assert.match(deadlineKey({ type: 'IMPEGNO', title: 'x', resource_id: 3, due_date: '2026-12-01', ref: { letter_id: 5 } }), /^L3-20261201-/);
});

test('TD-SCAD: tag, parsing da soggetto e corpo, maiuscole, risposte "R:" e assenza', () => {
  assert.equal(scadTag('D7-20261120-AB12'), '[TD-SCAD-D7-20261120-AB12]');
  assert.equal(parseScadKey('R: Toscana Diagnostica · promemoria: Scadenza polizza entro il 20/11/2026 [TD-SCAD-D7-20261120-AB12]'), 'D7-20261120-AB12');
  assert.equal(parseScadKey('Polizza rinnovata', 'Buongiorno, allego. Rif. TD-SCAD-a42 grazie'), 'A42');
  assert.equal(parseScadKey('RE: [ TD-SCAD-M9 ] documento'), 'M9');
  assert.equal(parseScadKey('nessun riferimento', null, undefined), null);
  assert.equal(parseScadKey('TD-SCAD- senza chiave'), null);
  const it = { title: 'Scadenza polizza RC professionale', due_date: '2026-11-20' };
  assert.equal(parseScadKey(reminderSubject(it, 'D7-20261120-AB12')), 'D7-20261120-AB12', 'il soggetto del richiamo si rilegge');
  assert.match(reminderSubject(it, 'X'), /^Toscana Diagnostica · promemoria: Scadenza polizza RC professionale entro il 20\/11\/2026 \[TD-SCAD-X\]$/);
});

test('soglie di anticipo: parsing e soglia corrente da inviare una volta sola', () => {
  assert.deepEqual(parseThresholds('60, 30;7 0 30 abc 999'), [60, 30, 7, 0]);
  assert.deepEqual(parseThresholds(''), [60, 30, 7, 0]);
  assert.deepEqual(parseThresholds([15, 3]), [15, 3]);
  const T = [60, 30, 7, 0];
  assert.equal(thresholdDue(90, T), null, 'troppo presto');
  assert.equal(thresholdDue(60, T), 60);
  assert.equal(thresholdDue(45, T), 60);
  assert.equal(thresholdDue(45, T, new Set([60])), null, 'già inviato');
  assert.equal(thresholdDue(20, T), 30, 'scoperta a 20 giorni: solo la soglia dei 30, non anche quella dei 60');
  assert.equal(thresholdDue(25, T, new Set([60])), 30);
  assert.equal(thresholdDue(7, T), 7);
  assert.equal(thresholdDue(0, T), 0);
  assert.equal(thresholdDue(-3, T), 0, 'scaduta da poco: richiamo "scaduta"');
  assert.equal(thresholdDue(-3, T, new Set([0])), null);
  assert.equal(thresholdDue(-45, T), null, 'scaduta da troppo: nessun richiamo');
});

test('indirizzi e mappa dei destinatari', () => {
  assert.deepEqual(parseEmailList('HR@td.it; hr@td.it, people@td.it  non-valida'), ['hr@td.it', 'people@td.it']);
  const m = parseRecipientMap('{"DOCUMENTO":"hr","PROVA":"NESSUNO","XYZ":"PERSONA","MBO":"boh"}');
  assert.equal(m.DOCUMENTO, 'HR'); assert.equal(m.PROVA, 'NESSUNO'); assert.equal(m.MBO, 'HR'); assert.equal(m.XYZ, undefined);
  assert.deepEqual(parseRecipientMap('json rotto'), DEFAULT_MAP);
});

test('destinatario per tipo: documento alla persona con copia HR, interne e prova a HR, ripieghi', () => {
  const hr = ['hr@td.it'];
  const doc = chooseRecipient({ type: 'DOCUMENTO', title: 'Scadenza polizza RC professionale' }, { personEmail: 'Mario.Rossi@td.it', hrEmails: hr, hrCc: hr });
  assert.deepEqual(doc, { recipient: 'PERSONA', to: ['mario.rossi@td.it'], cc: ['hr@td.it'], reason: null });
  assert.equal(chooseRecipient({ type: 'DOCUMENTO' }, { personEmail: 'a@b.it', hrEmails: hr }).cc.length, 0, 'senza copia HR impostata');
  assert.equal(chooseRecipient({ type: 'PROVA', title: 'Fine periodo di prova' }, { personEmail: 'a@b.it', hrEmails: hr }).recipient, 'HR');
  assert.equal(chooseRecipient({ type: 'CONTRATTO', title: 'Scadenza contratto a termine' }, { personEmail: 'a@b.it', hrEmails: hr }).recipient, 'HR');
  // interne: HR anche se la mappa dice PERSONA
  const map = { ...DEFAULT_MAP, MBO: 'PERSONA', RAL: 'PERSONA', CONTRATTO: 'PERSONA' };
  assert.equal(isInternal({ type: 'CONTRATTO', title: 'Cessazione del rapporto' }), true);
  for (const it of [{ type: 'MBO', title: 'MBO 2026: valutazione finale' }, { type: 'RAL', title: 'Scatto RAL' }, { type: 'CONTRATTO', title: 'Cessazione del rapporto' }]) {
    assert.equal(chooseRecipient(it, { map, personEmail: 'a@b.it', hrEmails: hr }).recipient, 'HR', it.type);
  }
  assert.equal(chooseRecipient({ type: 'CONTRATTO', title: 'Scadenza incarico' }, { map, personEmail: 'a@b.it', hrEmails: hr }).recipient, 'PERSONA');
  const noMail = chooseRecipient({ type: 'DOCUMENTO' }, { personEmail: null, hrEmails: hr });
  assert.equal(noMail.recipient, 'HR'); assert.deepEqual(noMail.to, hr); assert.match(noMail.reason, /senza email/);
  const nobody = chooseRecipient({ type: 'PROVA' }, { personEmail: 'a@b.it', hrEmails: [] });
  assert.deepEqual(nobody.to, []); assert.match(nobody.reason, /nessun indirizzo HR/);
  assert.equal(chooseRecipient({ type: 'PROVA' }, { map: { ...DEFAULT_MAP, PROVA: 'NESSUNO' }, hrEmails: hr }).recipient, null);
});

test('abbinamento per email del mittente: anagrafica o account Suite, solo se unico', () => {
  assert.equal(matchByEmail('MARIO.ROSSI@toscanadiagnostica.it', PEOPLE)?.id, 1);
  assert.equal(matchByEmail('l.bianchi@toscanadiagnostica.it', PEOPLE)?.id, 2, 'email dell\'account Suite');
  assert.equal(matchByEmail('lucia.bianchi@gmail.com', PEOPLE)?.id, 2, 'email personale');
  assert.equal(matchByEmail('condivisa@studio.it', PEOPLE), null, 'due persone con la stessa email: nessun abbinamento');
  assert.equal(matchByEmail('sconosciuto@x.it', PEOPLE), null);
  assert.equal(matchByEmail('', PEOPLE), null);
});

test('abbinamento per nome nel soggetto: cognome nome o nome cognome, accenti, solo se unico', () => {
  assert.equal(matchByName('Polizza RC di Rossi Mario', PEOPLE)?.id, 1);
  assert.equal(matchByName('Invio attestato - Lucia Bianchi', PEOPLE)?.id, 2);
  assert.equal(matchByName('documento NICCOLO DE LUCA aggiornato', PEOPLE)?.id, 3, 'accenti e cognome composto');
  assert.equal(matchByName('Rossi', PEOPLE), null, 'solo cognome: non basta');
  assert.equal(matchByName('Mario Rossi e Anna Rossi', PEOPLE), null, 'due persone: nessun abbinamento');
  assert.equal(matchByName('Mariolina Rossini', PEOPLE), null);
});

test('proposta senza modello: categoria, scadenza vicina alla parola chiave, intestatario', () => {
  const text = 'POLIZZA DI ASSICURAZIONE RESPONSABILITA CIVILE PROFESSIONALE\nContraente: Verdi Paolo\nEmessa il 01/11/2026\nPeriodo di copertura: dal 20/11/2026 - Scadenza: 20/11/2027\nPremio annuo 450,00';
  const p = heuristicProposal({ text, filename: 'polizza_2027.pdf', categories: ['POLIZZA_RC', 'CI', 'ALTRO'], people: PEOPLE });
  assert.equal(p.category, 'POLIZZA_RC');
  assert.equal(p.expires_at, '2027-11-20');
  assert.equal(p.holder, 'Verdi Paolo');
  assert.ok(p.confidence >= 0.8);
  assert.match(p.quote, /scadenza/);
  const q = heuristicProposal({ text: 'Giudizio di idoneità alla mansione. Valido fino al 31 dicembre 2027.', filename: 'scan.pdf', categories: ['VISITA_MEDICA', 'ALTRO'] });
  assert.equal(q.category, 'VISITA_MEDICA'); assert.equal(q.expires_at, '2027-12-31');
  const z = heuristicProposal({ text: '', filename: 'foto.jpg', categories: ['CI', 'ALTRO'] });
  assert.equal(z.category, 'ALTRO'); assert.equal(z.expires_at, null);
  assert.deepEqual(findDates('il 2027-03-05 e il 5.4.2028').dates.map((d) => d.iso), ['2027-03-05', '2028-04-05']);
});

test('pulizia della proposta del modello e tipi di file accettati', () => {
  const p = cleanProposal({ category: 'polizza_rc', expires_at: '2027-11-20', holder: 'Verdi Paolo', confidence: 1.7, quote: 'Scadenza:   20/11/2027' }, ['POLIZZA_RC', 'ALTRO']);
  assert.deepEqual(p, { category: 'POLIZZA_RC', expires_at: '2027-11-20', holder: 'Verdi Paolo', confidence: 1, quote: 'Scadenza: 20/11/2027' });
  const b = cleanProposal({ category: 'INVENTATA', expires_at: '20/11/2027', confidence: 'x' }, ['POLIZZA_RC', 'ALTRO']);
  assert.equal(b.category, 'ALTRO'); assert.equal(b.expires_at, null); assert.equal(b.confidence, null);
  assert.equal(acceptedFile('a.PDF', 'application/octet-stream'), true);
  assert.equal(acceptedFile('foto', 'image/jpeg'), true);
  assert.equal(acceptedFile('doc.docx', ''), true);
  assert.equal(acceptedFile('virus.exe', 'application/x-msdownload'), false);
  assert.equal(acceptedFile('mail.eml', 'message/rfc822'), false);
});
