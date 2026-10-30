// Shipments · richieste da documento (PDF o email) e richiedente Legal entity: test delle funzioni pure
// (modules/shipments/lib/requestParse.js). Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, parseEml, decodeHeader, emailOf, mockExtract, extractedToItems, lowConfidence, requesterIssue, shipNoticeRecipient } from '../src/modules/shipments/lib/requestParse.js';
import { parseKitEmail } from '../src/modules/shipments/lib/parser.js';

const CRLF = (s) => s.replace(/\n/g, '\r\n');

test('tipo di file: pdf, eml, txt riconosciuti; msg segnalato; altri rifiutati', () => {
  assert.equal(fileKind('Ordine.PDF', 'application/octet-stream'), 'pdf');
  assert.equal(fileKind('x', 'application/pdf'), 'pdf');
  assert.equal(fileKind('richiesta.eml', ''), 'eml');
  assert.equal(fileKind('a', 'message/rfc822'), 'eml');
  assert.equal(fileKind('note.txt', 'text/plain'), 'txt');
  assert.equal(fileKind('mail.msg', 'application/vnd.ms-outlook'), 'msg');
  assert.equal(fileKind('foto.jpg', 'image/jpeg'), null);
});

test('eml: intestazioni codificate, multipart con quoted-printable e allegato PDF', () => {
  const pdf = Buffer.from('%PDF-1.4 finto').toString('base64');
  const eml = CRLF(`From: =?UTF-8?Q?Studio_M=C3=A9dico?= <anna.verdi@studioverdi.it>
To: shipments@toscanadiagnostica.it
Subject: =?UTF-8?B?UmljaGllc3RhIGtpdCDDqCB1cmdlbnRl?=
Date: Thu, 29 Oct 2026 10:15:00 +0100
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="XYZ"

--XYZ
Content-Type: multipart/alternative; boundary="ALT"

--ALT
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Buongiorno, chiediamo 3 kit con analisi. Citt=C3=A0: Firenze=
 (FI)
--ALT
Content-Type: text/html; charset="utf-8"

<p>Buongiorno</p>
--ALT--
--XYZ
Content-Type: application/pdf; name="ordine.pdf"
Content-Disposition: attachment; filename="ordine.pdf"
Content-Transfer-Encoding: base64

${pdf}
--XYZ--
`);
  const m = parseEml(Buffer.from(eml, 'utf8'));
  assert.equal(m.subject, 'Richiesta kit è urgente');
  assert.equal(m.from, 'Studio Médico <anna.verdi@studioverdi.it>');
  assert.equal(emailOf(m.from), 'anna.verdi@studioverdi.it');
  assert.equal(m.date, '2026-10-29T09:15:00.000Z');
  assert.match(m.text, /chiediamo 3 kit con analisi\. Città: Firenze \(FI\)/);
  assert.doesNotMatch(m.text, /<p>/);                     // preferita la parte text/plain
  assert.equal(m.pdfs.length, 1);
  assert.equal(m.pdfs[0].filename, 'ordine.pdf');
  assert.equal(m.pdfs[0].buffer.toString(), '%PDF-1.4 finto');
});

test('eml solo HTML in latin1: testo ricavato dall\'HTML', () => {
  const body = Buffer.from('<div>Spedire a Via Roma 10<br>50123 Firenze</div><p>Grazie, perch\xe9 urgente</p>', 'latin1');
  const eml = Buffer.concat([Buffer.from(CRLF('From: a@b.it\nSubject: Prova\nContent-Type: text/html; charset=iso-8859-1\n\n')), body]);
  const m = parseEml(eml);
  assert.equal(m.subject, 'Prova');
  assert.match(m.text, /Via Roma 10\n50123 Firenze/);
  assert.match(m.text, /perché urgente/);
  assert.equal(decodeHeader('=?iso-8859-1?Q?Caff=E8?= ok'), 'Caffè ok');
});

test('email Affinity in .eml: il riconoscitore Endeavor legge i blocchi come per il testo incollato', () => {
  const eml = CRLF(`From: katie@easydna.com
Subject: Kits to send out
Content-Type: text/plain; charset=utf-8

Hi,

Could you please send the following kits:

AFF298672IT - Standard SDA
Ms. Andrea Green
CAMPING LA ROCCIA, VIA MADONNA 84
LAMPEDUSA
AGRIGENTO
92031
Italy
TEL: 00393342107111

Thanks
`);
  const m = parseEml(eml);
  const modes = [{ id: 1, code: 'STD_OUT', name_it: 'Standard in andata', name_en: 'Standard outbound', outbound_service: 'STANDARD', return_service: null, email_aliases: 'standard sda|standard' }];
  const blocks = parseKitEmail(m.text, modes, { subject: m.subject, knownCodes: [{ barcode: 'AFF298672IT', status: 'IN_STOCK' }] });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].external_ref, 'AFF298672IT');
  assert.equal(blocks[0].patient_last_name, 'Green');
  assert.equal(blocks[0].zip, '92031');
  assert.equal(blocks[0].province, 'AG');
  assert.equal(blocks[0].mode.id, 1);
});

const VERDI = 'Richiesta kit Lifestyle\nStudio Medico Verdi S.r.l., P.IVA 01234567890, referente dott.ssa Anna Verdi, anna.verdi@studioverdi.it, richiede 3 kit Lifestyle con analisi da consegnare a Via Roma 10, 50123 Firenze (FI)';

test('estrattore di prova: Legal entity con P.IVA, referente, 3 kit con analisi, indirizzo', () => {
  const e = mockExtract(VERDI);
  assert.equal(e.richiedente.tipo, 'LEGAL_ENTITY');
  assert.equal(e.richiedente.ragione_sociale, 'Studio Medico Verdi S.r.l.');
  assert.equal(e.richiedente.piva, '01234567890');
  assert.equal(e.richiedente.referente, 'dott.ssa Anna Verdi');
  assert.equal(e.richiedente.email, 'anna.verdi@studioverdi.it');
  assert.equal(e.richiesta.quantita_kit, 3);
  assert.equal(e.richiesta.tipo, 'KIT_AND_EXAM');
  assert.equal(e.destinatario.indirizzo1, 'Via Roma 10');
  assert.equal(e.destinatario.cap, '50123');
  assert.equal(e.destinatario.citta, 'Firenze');
  assert.equal(e.destinatario.provincia, 'FI');
  assert.equal(e.destinatario.nome, null);                  // nessun paziente nominato
  assert.equal(e.confidenza['richiedente.piva'].livello, 'alta');
  assert.match(e.confidenza['richiedente.piva'].citazione, /P\.IVA 01234567890/);
});

test('estrattore di prova: richiesta di una persona', () => {
  const e = mockExtract('Buongiorno, sono la Sig.ra Maria Rossi e vorrei solo il kit. Via Dante 3, 56100 Pisa (PI). maria.rossi@example.it tel. 333 1234567');
  assert.equal(e.richiedente.tipo, 'PERSONA');
  assert.equal(e.destinatario.nome, 'Maria');
  assert.equal(e.destinatario.cognome, 'Rossi');
  assert.equal(e.destinatario.email, 'maria.rossi@example.it');
  assert.equal(e.destinatario.telefono, '3331234567');
  assert.equal(e.richiesta.tipo, 'KIT_ONLY');
});

test('mappatura: Legal entity abbinata, 3 kit → 3 righe con cognome = ragione sociale', () => {
  const { items, warnings, entity } = extractedToItems(mockExtract(VERDI), { match: { id: 7, name: 'Studio Medico Verdi', how: 'partita IVA' } });
  assert.equal(entity, true);
  assert.equal(items.length, 3);
  assert.deepEqual(warnings, []);
  for (const it of items) {
    assert.equal(it.project, 'LIFESTYLE');
    assert.equal(it.order_type, 'KIT_AND_EXAM');
    assert.equal(it.requester_kind, 'LEGAL_ENTITY');
    assert.equal(it.requester_org_id, 7);
    assert.equal(it.requester_contact, 'dott.ssa Anna Verdi');
    assert.equal(it.requester_email, 'anna.verdi@studioverdi.it');
    assert.equal(it.patient_first_name, '');
    assert.equal(it.patient_last_name, 'Studio Medico Verdi S.r.l.');
    assert.equal(it.city, 'Firenze');
    assert.equal(requesterIssue(it), null);
  }
});

test('mappatura: riferimento numerato per più kit, avvisi su tipo e richiedente non abbinato', () => {
  const ex = { richiedente: { tipo: 'LEGAL_ENTITY', ragione_sociale: 'Farmacia Bianchi', piva: null }, destinatario: { nome: 'Luca', cognome: 'Neri', indirizzo1: 'Via Po 1', citta: 'Prato', provincia: 'prato', cap: '59100' },
    richiesta: { tipo: null, quantita_kit: '2', riferimento_esterno: 'ORD-55', lingua: 'en' }, confidenza: { 'destinatario.cap': { livello: 'bassa', citazione: '59100' } } };
  const { items, warnings } = extractedToItems(ex, { match: null });
  assert.deepEqual(items.map((x) => x.external_ref), ['ORD-55-1', 'ORD-55-2']);
  assert.ok(warnings.includes('type'));
  assert.ok(warnings.includes('requester_unmatched'));
  assert.equal(items[0].order_type, 'KIT_ONLY');
  assert.equal(items[0].province, 'PO');
  assert.equal(items[0].lang, 'en');
  assert.equal(items[0].patient_first_name, 'Luca');
  assert.deepEqual(lowConfidence(ex), ['destinatario.cap']);
  assert.equal(requesterIssue(items[0]).path, 'requester_org_id');     // da scegliere prima di confermare
});

test('mappatura: quantità limitata e valori "null" testuali ignorati', () => {
  const { items } = extractedToItems({ richiedente: { tipo: 'PERSONA' }, destinatario: { nome: 'null', cognome: 'Rossi', indirizzo1: 'Via A 1', citta: 'Siena' }, richiesta: { quantita_kit: 500 } });
  assert.equal(items.length, 50);
  assert.equal(items[0].patient_first_name, '');
  assert.ok(items[0].warnings.includes('name'));
});

test('validazione del richiedente', () => {
  assert.equal(requesterIssue({ requester_kind: 'PERSONA', patient_first_name: 'Anna', patient_last_name: 'Bini' }), null);
  assert.equal(requesterIssue({ patient_first_name: 'Anna', patient_last_name: 'Bini' }), null);                      // predefinito PERSONA
  assert.equal(requesterIssue({ requester_kind: 'PERSONA', patient_first_name: '', patient_last_name: 'Bini' }).path, 'patient_first_name');
  assert.equal(requesterIssue({ requester_kind: 'LEGAL_ENTITY', requester_org_id: null, patient_last_name: 'X' }).path, 'requester_org_id');
  assert.equal(requesterIssue({ requester_kind: 'LEGAL_ENTITY', requester_org_id: 3, patient_first_name: '', patient_last_name: 'Studio Verdi' }), null);
  assert.equal(requesterIssue({ requester_kind: 'LEGAL_ENTITY', requester_org_id: 3, patient_last_name: ' ' }).path, 'patient_last_name');
  assert.equal(requesterIssue({ requester_kind: 'ALTRO', patient_first_name: 'a', patient_last_name: 'b' }).path, 'requester_kind');
});

test('notifica di spedizione: destinatario, poi richiedente Legal entity, mai alla persona senza email', () => {
  assert.deepEqual(shipNoticeRecipient({ email: 'p@x.it', patient_first_name: 'Anna', patient_last_name: 'Bini' }), { email: 'p@x.it', greet: 'Anna', toRequester: false });
  assert.equal(shipNoticeRecipient({ email: null, requester_kind: 'PERSONA' }), null);
  assert.deepEqual(shipNoticeRecipient({ email: null, requester_kind: 'LEGAL_ENTITY', requester_email: 'anna.verdi@studioverdi.it', requester_contact: 'dott.ssa Anna Verdi' }), { email: 'anna.verdi@studioverdi.it', greet: 'dott.ssa Anna Verdi', toRequester: true });
  assert.equal(shipNoticeRecipient({ email: null, requester_kind: 'LEGAL_ENTITY', requester_org_name: 'Studio Verdi' }, 'info@studioverdi.it').email, 'info@studioverdi.it');
  assert.equal(shipNoticeRecipient({ email: null, requester_kind: 'LEGAL_ENTITY' }), null);
});
