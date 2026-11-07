// Business Hub · Pacchetto di benvenuto (richiesta del CEO del 06/11/2026): test delle regole pure (composizione delle sezioni per linea,
// segnaposto, piano 30-60-90, credenziali con e senza password, referenti dai soli dati presenti) e dell'unione dei PDF con pdf-lib
// (numerazione, segnalibri, Vademecum in coda se il PDF dello specchio di collaudo c'è). Nessun database né LibreOffice.
// Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  componiSezioni, sezioniLinea, sostituisci, segnapostoSconosciuti, valoriSegnaposto, pianoAvvio, addGiorni, dataLunga, paginaCredenziali, referentiDedicati,
  checklist, modelliDa, paragrafiLettera, nomeFile, LETTERA_CEO_DEFAULT, EMAIL_DEFAULT, OGGETTO_EMAIL, conPunto, certificazioniIso,
  telefoni, etichettaTelefono, righeReferenti, letteraConOfferta,
} from '../src/modules/business/lib/pacchetto.js';
import { assembla, paginaIniziale, leggiSegnalibri, contaPagine } from '../src/modules/business/lib/pacchettoPdf.js';
import { senzaNumeroPagina, margini, rigaASinistra, righeTesto, lettera, copertina, bloccoReferenti, COLONNE_REFERENTI, LARGHEZZA } from '../src/modules/business/lib/pacchettoDocx.js';
import { margineSuperioreMinimo, intestazioniRipetute } from '../src/modules/business/lib/docgen.js';

const chiavi = (l) => l.map((x) => x.key);

test('sezioni per linea: SRV completo, PP con la rete senza vademecum né portale, MDL con la medicina del lavoro', () => {
  assert.deepEqual(chiavi(sezioniLinea('SRV')), ['copertina', 'indice', 'lettera', 'offerta', 'listino', 'portale', 'credenziali', 'studiolab', 'avvio', 'referente', 'diversi', 'checklist', 'vademecum']);
  const pp = chiavi(sezioniLinea('PP'));
  assert.ok(pp.includes('network') && !pp.includes('vademecum') && !pp.includes('portale') && !pp.includes('mdl'));
  const mdl = chiavi(sezioniLinea('MDL'));
  assert.ok(mdl.includes('mdl') && !mdl.includes('vademecum') && !mdl.includes('portale') && !mdl.includes('network'));
});

test('composizione: spunte dell\'operatore, sezioni fisse, offerta omessa con il motivo se mancano i dati', () => {
  const s = componiSezioni('SRV', { lettera: false, copertina: false, vademecum: false }, { offerta: 'PDF' });
  const by = Object.fromEntries(s.map((x) => [x.key, x]));
  assert.equal(by.copertina.inclusa, true, 'la copertina è fissa');
  assert.equal(by.lettera.inclusa, false);
  assert.match(by.lettera.motivo, /operatore/);
  assert.equal(by.vademecum.inclusa, false);
  assert.equal(by.offerta.titolo, 'Lettera di offerta');
  const senza = componiSezioni('SRV', {}, { offerta: null }).find((x) => x.key === 'offerta');
  assert.equal(senza.inclusa, false);
  assert.match(senza.motivo, /Nessuna lettera di offerta/);
  assert.equal(componiSezioni('SRV', {}, { offerta: 'ECONOMICA' }).find((x) => x.key === 'offerta').titolo, 'Offerta economica');
  assert.equal(componiSezioni('PP', {}, { offerta: 'PDF' }).find((x) => x.key === 'offerta').titolo, 'Proposta di contratto');
  assert.equal(componiSezioni('PP', {}, {}).find((x) => x.key === 'credenziali').titolo, 'Accesso alla Suite');
});

test('segnaposto: {{cliente}} {{referente}} {{data}} {{owner}}, punto finale non raddoppiato, sconosciuti intatti', () => {
  const v = valoriSegnaposto({ cliente: 'AgapeLab S.r.l.', referente: 'dott. Mario Bianchi', data: '2026-11-06', owner: 'Rosetta Greco' });
  assert.equal(sostituisci('Gentile {{ referente }}, benvenuti {{CLIENTE}}. Data: {{data}}. {{owner}}', v), 'Gentile dott. Mario Bianchi, benvenuti AgapeLab S.r.l. Data: 6 novembre 2026. Rosetta Greco');
  assert.equal(sostituisci('{{referenti}} e {{sconosciuto}}', v), '{{referenti}} e {{sconosciuto}}');
  assert.deepEqual(segnapostoSconosciuti('{{cliente}} {{referenti}} {{nome}}'), ['nome']);
  const vuoti = valoriSegnaposto({ cliente: 'X' });
  assert.equal(vuoti.referente, 'Cliente');
  assert.equal(vuoti.owner, 'Il nostro team commerciale');
  assert.equal(conPunto('AgapeLab S.r.l.'), 'AgapeLab S.r.l.');
  assert.equal(conPunto('AgapeLab'), 'AgapeLab.');
  for (const l of ['SRV', 'PP', 'MDL']) {
    assert.match(LETTERA_CEO_DEFAULT[l], /\{\{referenti\}\}/);
    assert.ok(paragrafiLettera(LETTERA_CEO_DEFAULT[l]).some((x) => x.tipo === 'referenti'));
    assert.deepEqual(segnapostoSconosciuti(LETTERA_CEO_DEFAULT[l]), []);
  }
  assert.equal(sostituisci(OGGETTO_EMAIL, v), 'Toscana Diagnostica · Benvenuto AgapeLab S.r.l.');
  assert.match(sostituisci(EMAIL_DEFAULT, v), /^Gentile dott\. Mario Bianchi,/);
});

test('modelli salvati: le linee mancanti restano predefinite, JSON non valido ignorato', () => {
  const m = modelliDa({ lettera: JSON.stringify({ PP: 'Testo PP {{referenti}}' }), email: '' });
  assert.equal(m.lettera.PP, 'Testo PP {{referenti}}');
  assert.equal(m.lettera.SRV, LETTERA_CEO_DEFAULT.SRV);
  assert.equal(m.email, EMAIL_DEFAULT);
  assert.equal(modelliDa({ lettera: '{non json' }).lettera.MDL, LETTERA_CEO_DEFAULT.MDL);
});

test('piano 30-60-90: date dalla data del pacchetto, passi per linea', () => {
  assert.equal(addGiorni('2026-11-06', 30), '2026-12-06');
  assert.equal(addGiorni('2026-12-20', 30), '2027-01-19');
  assert.equal(dataLunga('2026-11-06'), '6 novembre 2026');
  const p = pianoAvvio('SRV', '2026-11-06');
  assert.deepEqual(p.map((x) => x.entro), ['2026-12-06', '2027-01-05', '2027-02-04']);
  assert.ok(p[0].passi.some((x) => /primo invio dei campioni/i.test(x)));
  assert.ok(p[0].passi.some((x) => /revisione a 30 giorni/i.test(x)));
  assert.ok(pianoAvvio('MDL', '2026-11-06')[0].passi.some((x) => /mdl@/.test(x)));
  assert.ok(!pianoAvvio('PP', '2026-11-06')[0].passi.some((x) => /campioni/.test(x)));
  assert.ok(checklist('SRV', { data: '2026-11-06', offerta: true }).some((x) => /firmata la lettera di offerta/.test(x)));
  assert.ok(!checklist('SRV', { data: '2026-11-06', offerta: true, firmata: true }).some((x) => /firmata/.test(x)));
});

test('credenziali: password solo se l\'operatore la include, altrimenti "comunicata separatamente"', () => {
  const portale = { portal_url: 'https://referti.toscanadiagnostica.it', username: 'agapelab', password: 'Segreta-1' };
  const accessi = [{ nome: 'Sderci Francesco', email: 'f@x.it', profilo: 'Cliente service', ultimo_accesso: null }, { nome: 'Rossi Anna', email: 'a@x.it', profilo: null, ultimo_accesso: '2026-11-01' }];
  const senza = paginaCredenziali({ suiteUrl: 'https://suite.toscanadiagnostica.it/service', accessi, portale, includiPassword: false });
  assert.equal(senza.referti.password, 'comunicata separatamente');
  assert.equal(senza.password_inclusa, false);
  assert.ok(!JSON.stringify(senza).includes('Segreta-1'));
  assert.match(senza.righe[0].password, /provvisoria/);
  assert.match(senza.righe[1].password, /già attiva/);
  assert.equal(senza.righe[1].profilo, 'Accesso esterno');
  const con = paginaCredenziali({ suiteUrl: 'x', accessi, portale, includiPassword: true });
  assert.equal(con.referti.password, 'Segreta-1');
  assert.equal(con.password_inclusa, true);
  const senzaPw = paginaCredenziali({ suiteUrl: 'x', portale: { ...portale, password: null }, includiPassword: true });
  assert.equal(senzaPw.referti.password, 'comunicata separatamente');
  assert.equal(paginaCredenziali({ suiteUrl: 'x', portale: null }).referti, null);
});

test('referenti: solo dati presenti (contatti.json e Dati aziendali), righe senza recapiti omesse', () => {
  const contatti = { gruppi: [{ contatti: [
    { ruolo: 'Laboratorio di Analisi', nome: '', email: 'laboratorio@toscanadiagnostica.it', tel: '055 7765108' },
    { ruolo: 'Direzione Sanitaria', nome: 'prof. Gian Luigi Taddei', email: 'direzione.sanitaria@toscanadiagnostica.it', tel: '055 7765108' },
    { ruolo: 'Direttore Tecnico del Laboratorio', nome: 'dott.ssa X', email: '', tel: '' },
  ] }, { contatti: [{ ruolo: 'Service, Flow & Back Office Manager', nome: 'Rosetta Greco', email: 'service@toscanadiagnostica.it', email2: 'rosetta.greco@toscanadiagnostica.it', tel: '055 7765103', cell: '393 0000000' }] }] };
  const company = { support_email: 'supporto.clienti@toscanadiagnostica.it', support_phone: '055 776511', support_hours: 'Lun – Ven\nSabato', health_director: 'prof. Gian Luigi Taddei', phone: '055776511' };
  const r = referentiDedicati({ contatti, company, linea: 'SRV' });
  assert.deepEqual(r.map((x) => x.ruolo), ['Laboratorio di Analisi', 'Service, Flow & Back Office Manager', 'Direzione Sanitaria', 'Supporto clienti']);
  assert.equal(r[1].email, 'rosetta.greco@toscanadiagnostica.it');
  assert.match(r[1].telefono, /cell\. 393/);
  assert.equal(r[3].nota, 'Lun – Ven · Sabato');
  const pp = referentiDedicati({ contatti: null, company, linea: 'PP', casella: 'network@toscanadiagnostica.it' });
  assert.deepEqual(pp.map((x) => x.ruolo), ['Linea Punti Prelievo', 'Direzione Sanitaria', 'Supporto clienti']);
  assert.equal(pp[1].email, null, 'senza specchio: direttore sanitario dai Dati aziendali, nessuna email inventata');
  assert.deepEqual(referentiDedicati({ contatti: null, company: {}, linea: 'SRV' }), []);
  assert.deepEqual(certificazioniIso({ certificazioni: [{ norma: 'ISO 9001:2015', titolo: 'Q', numero: 'N1', scadenza: '03/09/2029' }, { norma: 'PAS 24000:2022', titolo: 'R' }, { norma: 'ISO 7101:2024', titolo: 'S' }] }).map((x) => x.norma), ['ISO 9001:2015']);
});

test('nome del file e carta intestata: margini del pacchetto, numero di pagina tolto dal piè', () => {
  assert.equal(nomeFile('AGAPELAB SRL', 3, '2026-11-06'), '2026-11-06_Pacchetto_benvenuto_AGAPELAB_SRL_v3.pdf');
  assert.equal(nomeFile('Società Più', 1, '2026-11-06'), '2026-11-06_Pacchetto_benvenuto_Societa_Piu_v1.pdf');
  const piede = '<w:p><w:r><w:rPr/><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:r><w:t>Toscana Diagnostica S.r.l.</w:t></w:r></w:p>';
  const out = senzaNumeroPagina(piede);
  assert.ok(!out.includes('PAGE') && !out.includes('fldChar') && out.includes('Toscana Diagnostica S.r.l.'));
  assert.match(margini('<w:sectPr><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'), /w:top="2268"/);
  // lettere di offerta: margine superiore minimo e intestazioni delle tabelle ripetute con il titolo attaccato
  assert.match(margineSuperioreMinimo('<w:pgMar w:top="1417" w:right="1"/>'), /w:top="2232"/);
  assert.equal(margineSuperioreMinimo('<w:pgMar w:top="2500"/>'), '<w:pgMar w:top="2500"/>');
  const t = intestazioniRipetute('<w:p><w:pPr><w:pStyle w:val="N"/></w:pPr><w:r><w:t>Condizioni</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="N"/></w:pPr></w:p><w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="1B505F"/></w:tcPr></w:tc></w:tr></w:tbl>');
  assert.match(t, /<w:trPr><w:tblHeader\/><\/w:trPr>/);
  assert.equal((t.match(/<w:keepNext\/>/g) || []).length, 2);
  assert.ok(t.indexOf('<w:pStyle w:val="N"/><w:keepNext/>') >= 0, 'keepNext dopo pStyle');
});

test('niente doppione: l\'offerta economica già nell\'Allegato 1 della lettera di offerta non si ripete come sezione 03', () => {
  const meta = { allegato1_offerta: { listino_id: 12, versione: 3, documento_id: 40, pagine: 84, pagina: 21 } };
  assert.equal(letteraConOfferta(meta, 12), true);
  assert.equal(letteraConOfferta(meta, '12'), true);
  assert.equal(letteraConOfferta(meta, 13), false, 'lettera generata con un\'altra versione del listino');
  assert.equal(letteraConOfferta(null, 12), false, 'lettera generata prima: senza offerta dentro');
  assert.equal(letteraConOfferta({}, 12), false);
  assert.equal(letteraConOfferta(meta, null), false);
  assert.equal(letteraConOfferta({ allegato1_offerta: { ...meta.allegato1_offerta, pagine: 0 } }, 12), false);
  const by = (sez) => Object.fromEntries(sez.map((x) => [x.key, x]));
  // lettera con l'offerta dentro: la sezione "Offerta economica" non si aggiunge, con il motivo e il segno nellaLettera
  const dentro = by(componiSezioni('SRV', {}, { offerta: 'PDF', listino: true, listinoNellaLettera: true }));
  assert.equal(dentro.offerta.inclusa, true);
  assert.equal(dentro.listino.inclusa, false); assert.equal(dentro.listino.nellaLettera, true);
  assert.match(dentro.listino.motivo, /Già nella lettera di offerta \(Allegato 1/);
  // lettera esclusa dall'operatore: l'offerta economica torna sezione a sé
  const esclusa = by(componiSezioni('SRV', { offerta: false }, { offerta: 'PDF', listino: true, listinoNellaLettera: true }));
  assert.equal(esclusa.offerta.inclusa, false); assert.equal(esclusa.listino.inclusa, true);
  // lettera generata prima (senza offerta dentro): come prima, entrambe
  const prima = by(componiSezioni('SRV', {}, { offerta: 'PDF', listino: true, listinoNellaLettera: false }));
  assert.equal(prima.offerta.inclusa, true); assert.equal(prima.listino.inclusa, true); assert.equal(prima.listino.nellaLettera, undefined);
  // nessuna lettera generata (offerta ECONOMICA dai dati della proposta): il flag non conta, vale la regola di prima
  const eco = by(componiSezioni('SRV', {}, { offerta: 'ECONOMICA', listino: true, listinoNellaLettera: true }));
  assert.equal(eco.listino.inclusa, true); assert.equal(eco.offerta.inclusa, false);
  // account senza listino: nessuna offerta economica, qualunque cosa dica la lettera
  assert.equal(by(componiSezioni('SRV', {}, { offerta: 'PDF', listino: false, listinoNellaLettera: false })).listino.inclusa, false);
});

async function pdfDi(n, testo) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) d.addPage([595.28, 841.89]).drawText(`${testo} ${i + 1}`, { x: 50, y: 700, size: 12, font: f });
  return Buffer.from(await d.save());
}

test('unione dei PDF: pagine iniziali, numerazione, segnalibri alle sezioni', async () => {
  assert.deepEqual(paginaIniziale([{ key: 'a', pagine: 1 }, { key: 'b', pagine: 3 }, { key: 'c', pagine: 2 }]), { a: 1, b: 2, c: 5 });
  const parti = [
    { key: 'copertina', titolo: 'Copertina', pdf: await pdfDi(1, 'cop') },
    { key: 'indice', titolo: 'Indice', pdf: await pdfDi(1, 'ind') },
    { key: 'offerta', titolo: 'Lettera di offerta', pdf: await pdfDi(4, 'off'), numero: 'copri' },
    { key: 'vademecum', titolo: 'Vademecum degli esami', pdf: await pdfDi(1, 'vad') },
    { key: 'vademecum_pdf', titolo: 'pagine', pdf: await pdfDi(3, 'v'), numero: 'testa', segnalibro: false },
  ];
  const out = await assembla(parti, { titolo: 'Benvenuti in Toscana Diagnostica · Prova' });
  assert.equal(out.pagine, 10);
  assert.deepEqual(out.inizi, { copertina: 1, indice: 2, offerta: 3, vademecum: 7, vademecum_pdf: 8 });
  assert.equal(await contaPagine(out.pdf), 10);
  assert.deepEqual(await leggiSegnalibri(out.pdf), [
    { titolo: 'Copertina', pagina: 1 }, { titolo: 'Indice', pagina: 2 }, { titolo: 'Lettera di offerta', pagina: 3 }, { titolo: 'Vademecum degli esami', pagina: 7 },
  ]);
  const doc = await PDFDocument.load(out.pdf);
  assert.equal(doc.getTitle(), 'Benvenuti in Toscana Diagnostica · Prova');
  // segnalibro dell'offerta economica dentro la lettera di offerta (pagina 3 della lettera), subito dopo la voce della lettera
  const conA1 = await assembla(parti.map((x) => (x.key === 'offerta' ? { ...x, segnalibriInterni: [{ titolo: 'Offerta economica (Allegato 1, v3)', pagina: 3 }] } : x)));
  assert.deepEqual(await leggiSegnalibri(conA1.pdf), [
    { titolo: 'Copertina', pagina: 1 }, { titolo: 'Indice', pagina: 2 }, { titolo: 'Lettera di offerta', pagina: 3 }, { titolo: 'Offerta economica (Allegato 1, v3)', pagina: 5 },
    { titolo: 'Vademecum degli esami', pagina: 7 },
  ]);
});

const VADEMECUM = process.env.VADEMECUM_PDF || '/home/claude/legacy-service/service-main/vademecum/Toscana Diagnostica - Vademecum degli esami.pdf';
test('unione con il PDF del Vademecum dello specchio (salta se il file non c\'è)', { skip: !fs.existsSync(VADEMECUM) }, async () => {
  const v = fs.readFileSync(VADEMECUM);
  const n = await contaPagine(v);
  assert.ok(n > 10);
  const out = await assembla([{ key: 'copertina', titolo: 'Copertina', pdf: await pdfDi(1, 'cop') }, { key: 'vademecum', titolo: 'Vademecum degli esami', pdf: v, numero: 'testa' }]);
  assert.equal(out.pagine, n + 1);
  assert.deepEqual((await leggiSegnalibri(out.pdf)).map((x) => x.pagina), [1, 2]);
});

// Correzioni del CEO del 07/11/2026: niente "preparato per" né fascia, saluto a sinistra, tabella dei referenti a tre colonne con il CEO
test('tabella dei referenti: CEO in prima riga, telefoni su righe separate, owner in coda se non è già tra i referenti', () => {
  assert.deepEqual(telefoni({ fisso: '055 7765103', cellulare: '393 8543181' }), [{ etichetta: 'tel.', numero: '055 7765103' }, { etichetta: 'cell.', numero: '393 8543181' }]);
  assert.deepEqual(telefoni({ fisso: '055 776511', altro: '055776511' }), [{ etichetta: 'tel.', numero: '055 776511' }], 'doppione tolto');
  assert.deepEqual(telefoni({}), [], 'nessun numero inventato');
  assert.equal(etichettaTelefono('+39 347 1234567'), 'cell.');
  assert.equal(etichettaTelefono('055 776511'), 'tel.');
  const ref = referentiDedicati({ contatti: { gruppi: [{ contatti: [
    { ruolo: 'Laboratorio di Analisi', email: 'laboratorio@toscanadiagnostica.it', tel: '055 7765108' },
    { ruolo: 'Service, Flow & Back Office Manager', nome: 'Rosetta Greco', email2: 'rosetta.greco@toscanadiagnostica.it', tel: '055 7765103', cell: '393 0000000' }] }] }, company: {}, linea: 'SRV' });
  assert.deepEqual(ref[1].telefoni.map((t) => t.etichetta), ['tel.', 'cell.']);
  const ceo = { nome: 'Francesco Epifani', ruolo: 'Chief Executive Officer', email: 'francesco.epifani@toscanadiagnostica.it', telefoni: [] };
  const r = righeReferenti({ ceo, referenti: ref, owner: { nome: 'Mario Rossi', email: 'mario.rossi@toscanadiagnostica.it', ruolo: 'Commerciale', telefoni: [] } });
  assert.deepEqual(r.map((x) => x.ruolo), ['Chief Executive Officer', 'Laboratorio di Analisi', 'Service, Flow & Back Office Manager', 'Il vostro referente dedicato']);
  assert.equal(r[0].ceo, true);
  assert.deepEqual(r[0].telefoni, [], 'telefono del CEO assente in anagrafica: cella vuota');
  assert.equal(r[3].nota, 'Commerciale');
  const r2 = righeReferenti({ ceo, referenti: ref, owner: { nome: 'Rosetta Greco', email: 'rosetta.greco@toscanadiagnostica.it' } });
  assert.equal(r2.length, 3, 'owner già tra i referenti: nessuna riga in più');
  assert.equal(righeReferenti({ ceo, referenti: [{ ruolo: 'X', email: 'francesco.epifani@toscanadiagnostica.it' }] }).length, 1, 'il CEO non si ripete');
  const xml = bloccoReferenti(r);
  assert.equal(COLONNE_REFERENTI.reduce((a, b) => a + b, 0), LARGHEZZA);
  assert.equal((xml.match(/<w:gridCol /g) || []).length, 3, 'tre colonne');
  assert.ok(!/<w:br\/>/.test(xml), 'nessun a capo forzato nelle celle');
  assert.ok(xml.indexOf('Chief Executive Officer') < xml.indexOf('Laboratorio di Analisi'));
});

test('lettera e copertina: saluto a sinistra, nessun a capo forzato nei paragrafi giustificati, niente "preparato per" né fascia', () => {
  assert.equal(rigaASinistra('Gentile Francesco Sderci,'), true);
  assert.equal(rigaASinistra('Con i migliori saluti,'), true);
  assert.equal(rigaASinistra('benvenuti in Toscana Diagnostica. Con questa lettera desidero presentarvi chi siamo.'), false);
  assert.deepEqual(righeTesto('a\r\nb\n\n c '), ['a', 'b', 'c']);
  const d = { data: '2026-11-07', cliente: 'AGAPELAB SRL', indirizzoCliente: 'Via X 1', destinatario: 'Francesco Sderci', luogo: 'Sesto Fiorentino', firma: { nome: 'Francesco Epifani', ruolo: 'Chief Executive Officer' }, referenti: [],
    testoLettera: 'Gentile Francesco Sderci,\nbenvenuti in Toscana Diagnostica. Testo lungo della lettera.\n\nCon i migliori saluti,', lineaLabel: 'Service di Laboratorio' };
  const xml = lettera(d);
  assert.ok(!/<w:br\/>/.test(xml), 'nessun <w:br/> nella lettera');
  const para = xml.split('<w:p>').filter((x) => /Gentile Francesco Sderci,/.test(x))[0];
  assert.match(para, /<w:jc w:val="left"\/>/, 'saluto allineato a sinistra');
  assert.match(xml.split('<w:p>').filter((x) => /benvenuti in Toscana/.test(x))[0], /<w:jc w:val="both"\/>/);
  const cop = copertina({ ...d, qr: false });
  assert.ok(!/preparato per/i.test(cop) && !/prendiamo cura/i.test(cop));
  for (const l of ['SRV', 'PP', 'MDL']) assert.ok(!/preparat[eoa] per/i.test(LETTERA_CEO_DEFAULT[l]));
});
