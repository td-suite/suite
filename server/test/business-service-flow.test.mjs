// Business Hub · processo Service da prospect a cliente (richiesta del CEO del 06/11/2026). Regole pure: riconoscimento delle colonne del
// listino StudioLAB con i sinonimi, lettura e riepilogo, differenze tra versioni, prerequisiti del kit, volumi giornalieri, selezione dei
// prospect da richiamare, token della form (scadenza, riferimento nell'oggetto), confronto dell'anagrafica MOD173, modelli dei testi,
// varianti del pacchetto, PDF del MOD173. In più il flusso con la posta simulata (Suite vera su un database di prova: serve
// DATABASE_URL_TEST, altrimenti si salta): form pubblica con il contratto firmato → contrattualizzazione, comunicazioni, attivazione dei
// servizi; risposta per email con il riferimento → allegati da verificare; anteprima del richiamo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { riconosciColonne, trovaIntestazione, numero, leggiRighe, riepilogo, differenze, versioneCorrente, leggiListino, perSettore, normIntestazione } from '../src/modules/business/lib/listino.js';
import {
  prerequisitiKit, datiClienteMancanti, volumiGiornalieri, prospectDaRichiamare, nuovoToken, scadenzaToken, statoToken, rifDaOggetto, etichettaRif, rifToken,
  precompila, validaMod173, confrontaAnagrafica, compila, allegatiDa, MODELLI_DEFAULT, SEGNAPOSTO_MODELLI, segnapostoDi, modelliFlussoDa, CAMPI_MOD173,
} from '../src/modules/business/lib/processo.js';
import { componiSezioni } from '../src/modules/business/lib/pacchetto.js';
import { mod173Pdf, winAnsi } from '../src/modules/business/lib/mod173Pdf.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

// ---------------------------------------------------------------- listino
test('listino: colonne riconosciute con i sinonimi (export StudioLAB plausibili)', () => {
  const a = riconosciColonne(['Cod. Esame', 'Descrizione Esame', 'Settore', 'Prezzo Listino €', 'Sconto %', 'Prezzo Scontato €', 'Note']);
  assert.deepEqual(a.mapping, { codice: 0, descrizione: 1, settore: 2, listino: 3, sconto: 4, offerto: 5, note: 6 });
  assert.deepEqual(a.mancanti, []);
  const b = riconosciColonne(['Codice', 'Prestazione', 'Tariffa', 'Prezzo netto']);
  assert.equal(b.mapping.descrizione, 1); assert.equal(b.mapping.listino, 2); assert.equal(b.mapping.offerto, 3);
  const c = riconosciColonne(['Sigla', 'Esame', 'Prezzo']);   // "Prezzo" da solo è il listino
  assert.equal(c.mapping.codice, 0); assert.equal(c.mapping.descrizione, 1); assert.equal(c.mapping.listino, 2); assert.equal(c.mapping.offerto, undefined);
  const d = riconosciColonne(['Colonna A', 'Colonna B']);
  assert.deepEqual(d.mancanti, ['descrizione', 'listino'], 'formato sconosciuto: mapping a video');
  assert.equal(normIntestazione('Unità di misura'), 'unita di misura');
});

test('listino: riga di intestazione dopo il titolo, numeri all\'italiana, sconto in frazioni o percentuale', () => {
  const righe = [['Listino StudioLAB'], [], ['Codice', 'Descrizione', 'Listino', 'Sconto'], ['A1', 'Glicemia', '2,50', 0.2], ['A2', 'Emocromo', '€ 4,00', 0.1], ['', 'Totale', '6,50', '']];
  const h = trovaIntestazione(righe);
  assert.equal(h.indice, 2);
  assert.equal(numero('1.234,50 €'), 1234.5); assert.equal(numero('12.5'), 12.5); assert.equal(numero('1,234.50'), 1234.5); assert.equal(numero('20%'), 20); assert.equal(numero('-'), null);
  const l = leggiRighe(righe.slice(3), h.mapping);
  assert.equal(l.righe.length, 2, 'la riga di totale si scarta');
  assert.equal(l.scartate, 1);
  assert.deepEqual(l.righe.map((x) => [x.codice, x.listino, x.offerto, x.sconto]), [['A1', 2.5, 2, 20], ['A2', 4, 3.6, 10]]);
  const pct = leggiRighe([['B1', 'Esame', 10, 15]], { codice: 0, descrizione: 1, listino: 2, sconto: 3 });
  assert.equal(pct.righe[0].offerto, 8.5, 'sconto 15 = 15%');
  const off = leggiRighe([['C1', 'Esame', 10, null, 7.5]], { codice: 0, descrizione: 1, listino: 2, offerto: 4 });
  assert.equal(off.righe[0].sconto, 25, 'sconto calcolato dal prezzo offerto');
});

test('listino: riepilogo con sconto medio ponderato, differenze tra versioni, versione corrente, settori', () => {
  const v1 = [{ codice: 'A1', descrizione: 'Glicemia', listino: 10, offerto: 10, sconto: 0, settore: 'Chimica' }, { codice: 'A2', descrizione: 'Emocromo', listino: 30, offerto: 30, sconto: 0, settore: 'Ematologia' }, { codice: 'A3', descrizione: 'PCR', listino: 20, offerto: 20, sconto: 0 }];
  const v2 = [{ codice: 'A1', descrizione: 'Glicemia', listino: 10, offerto: 8, sconto: 20, settore: 'Chimica' }, { codice: 'A2', descrizione: 'Emocromo', listino: 30, offerto: 30, sconto: 0, settore: 'Ematologia' }, { codice: 'A4', descrizione: 'TSH', listino: 15, offerto: 12, sconto: 20 }];
  const r = riepilogo(v2);
  assert.equal(r.esami, 3); assert.equal(r.totale_listino, 55); assert.equal(r.totale_offerto, 50);
  assert.equal(r.sconto_medio, 9.1, '1 - 50/55'); assert.equal(r.sconto_medio_semplice, 13.3);
  const d = differenze(v1, v2);
  assert.deepEqual(d.cambiate.map((x) => x.codice), ['A1']);
  assert.deepEqual(d.aggiunte.map((x) => x.codice), ['A4']);
  assert.deepEqual(d.tolte.map((x) => x.codice), ['A3']);
  assert.equal(d.invariate, 1); assert.equal(d.sconto_medio_prima, 0); assert.equal(d.variazione_sconto, 9.1);
  assert.equal(versioneCorrente([{ id: 1, versione: 1 }, { id: 2, versione: 2 }]).id, 2, 'l\'ultima');
  assert.equal(versioneCorrente([{ id: 1, versione: 1 }, { id: 2, versione: 2 }], 1).id, 1, 'salvo scelta');
  assert.equal(versioneCorrente([{ id: 2, versione: 2 }], 99).id, 2, 'scelta non più esistente: l\'ultima');
  assert.deepEqual(perSettore(v2).map((g) => g.settore), ['Chimica', 'Ematologia', 'Esami']);
});

test('listino: lettura di un .xlsx con il mapping salvato quando le intestazioni non si riconoscono', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Export');
  ws.addRow(['X1', 'X2', 'X3']); ws.addRow(['G01', 'Glicemia', 2.5]); ws.addRow(['G02', 'Colesterolo', 3]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const senza = await leggiListino(buf, 'export.xlsx');
  assert.deepEqual(senza.mancanti, ['descrizione', 'listino']);
  assert.equal(senza.righe.length, 0);
  const salvato = { mapping: { codice: 0, descrizione: 1, listino: 2 }, intestazioni: ['X1', 'X2', 'X3'] };
  const con = await leggiListino(buf, 'export.xlsx', { mappingSalvato: salvato });
  assert.equal(con.da_mapping_salvato, true);
  assert.equal(con.righe.length, 2); assert.equal(con.riepilogo.totale_listino, 5.5);
  const forz = await leggiListino(buf, 'export.xlsx', { mappingForzato: { descrizione: 1, listino: 2 } });
  assert.equal(forz.righe[0].codice, null); assert.equal(forz.righe[1].descrizione, 'Colesterolo');
});

// ---------------------------------------------------------------- kit, volumi, richiamo, token
test('kit: prerequisiti, l\'accesso alla Suite si crea da solo se c\'è il referente con email', () => {
  const tutto = { listino: { versione: 2, esami: 30 }, referente: { nome: 'Mario Rossi', email: 'm.rossi@lab.it' }, datiMancanti: [], studiolab: { url: 'https://referti', username: 'lab', fonte: 'contratto' },
    accesso: null, offerta: { versione: 2 }, lettera: { filename: 'MOD230.pdf' } };
  const p = prerequisitiKit(tutto);
  assert.equal(p.pronto, true);
  assert.equal(p.voci.find((v) => v.key === 'accesso').auto, true);
  assert.equal(prerequisitiKit({ ...tutto, referente: null }).pronto, false);
  const senzaOff = prerequisitiKit({ ...tutto, offerta: null });
  assert.equal(senzaOff.pronto, false); assert.match(senzaOff.voci.find((v) => v.key === 'offerta').dettaglio, /v2/);
  assert.equal(prerequisitiKit({ ...tutto, datiMancanti: ['P.IVA'] }).voci.find((v) => v.key === 'dati').ok, false);
  assert.deepEqual(datiClienteMancanti({ name: 'X', city: 'Prato', pec: 'x@pec.it' }), ['P.IVA', 'indirizzo']);
});

test('volumi giornalieri: il campo dell\'account, altrimenti volume annuo / giorni lavorativi', () => {
  assert.deepEqual(volumiGiornalieri({ volumi_giornalieri_attesi: 120, volume_fy_atteso: 1000 }), { valore: 120, fonte: 'campo', testo: '120 esami al giorno' });
  const c = volumiGiornalieri({ volume_fy_atteso: 30000 }, 250);
  assert.equal(c.valore, 120); assert.equal(c.fonte, 'calcolo'); assert.match(c.testo, /circa 120 esami al giorno/);
  assert.equal(volumiGiornalieri({ volume_fy_atteso: 1000 }, 0).valore, 4, 'giorni non validi: 250');
  assert.equal(volumiGiornalieri({}).valore, null);
});

test('richiamo: solo prospect Service non clienti, ogni N giorni, limite giornaliero, mai chi non vuole essere contattato', () => {
  const acc = [
    { id: 1, org_name: 'A', linea: 'SRV', fase_corrente: 0, email: 'a@a.it' },
    { id: 2, org_name: 'B', linea: 'SRV', fase_corrente: 3, email: 'b@b.it', ultimo_richiamo_at: '2026-10-20T10:00:00Z' },
    { id: 3, org_name: 'C', linea: 'SRV', fase_corrente: 2, email: 'c@c.it', ultimo_richiamo_at: '2026-08-01T10:00:00Z', priorita: 'ALTA' },
    { id: 4, org_name: 'D', linea: 'SRV', fase_corrente: 6, email: 'd@d.it' },
    { id: 5, org_name: 'E', linea: 'SRV', fase_corrente: 1, email: 'e@e.it', non_contattare: true },
    { id: 6, org_name: 'F', linea: 'PP', fase_corrente: 0, email: 'f@f.it' },
    { id: 7, org_name: 'G', linea: 'SRV', fase_corrente: 0, email: null },
    { id: 8, org_name: 'H', linea: 'SRV', fase_corrente: 4, email: 'h@h.it', ultima_email_at: '2026-11-01T09:00:00Z' },
    { id: 9, org_name: 'I', linea: 'SRV', fase_corrente: 5, email: 'i@i.it', cliente_attivo: true },
    { id: 10, org_name: 'L', linea: 'SRV', fase_corrente: 0, email: 'l@l.it', priorita: 'ALTA' },
  ];
  const r = prospectDaRichiamare(acc, { oggi: '2026-11-06', giorni: 60, limite: 2 });
  assert.deepEqual(r.selezionati.map((x) => x.id), [10, 1], 'mai richiamati prima, priorità alta in testa');
  assert.deepEqual(r.in_coda.map((x) => x.id), [3], 'richiamato più di 60 giorni fa: in coda per il limite');
  const motivi = Object.fromEntries(r.esclusi.map((x) => [x.id, x.motivo]));
  assert.match(motivi[2], /richiamato/); assert.equal(motivi[4], 'è già cliente'); assert.equal(motivi[5], 'non contattare'); assert.match(motivi[6], /linea/);
  assert.equal(motivi[7], 'nessun indirizzo email'); assert.match(motivi[8], /email inviata/); assert.equal(motivi[9], 'è già cliente');
  assert.equal(prospectDaRichiamare(acc, { oggi: '2026-11-06', giorni: 60, limite: 0 }).selezionati.length, 0);
});

test('token della form: scadenza, rinnovo, riferimento [TD-B2B-...] nell\'oggetto anche in risposta', () => {
  const t = nuovoToken();
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(nuovoToken(), t);
  assert.equal(scadenzaToken('2026-11-06', 60), '2027-01-05');
  assert.equal(scadenzaToken('2026-11-06', 0), '2027-01-05', 'giorni non validi: 60');
  assert.equal(statoToken({ token: t, scade: '2026-11-06' }, '2026-11-06').valido, true, 'vale fino a fine giornata');
  const sc = statoToken({ token: t, scade: '2026-11-05' }, '2026-11-06');
  assert.equal(sc.valido, false); assert.match(sc.motivo, /scaduto il 05\/11\/2026/);
  assert.equal(statoToken({}, '2026-11-06').valido, false);
  assert.equal(etichettaRif(t), `[TD-B2B-${t.slice(0, 10)}]`);
  assert.equal(rifDaOggetto(`R: Toscana Diagnostica · Proposta per Lab ${etichettaRif(t)}`), rifToken(t));
  assert.equal(rifDaOggetto('Fwd: [td-b2b-AbCdEfGhIjKl] firmato'), 'AbCdEfGhIj');
  assert.equal(rifDaOggetto('Contratto firmato'), null);
});

// ---------------------------------------------------------------- MOD173
test('MOD173: precompilazione dai dati della Suite, validazione, confronto con la Legal entity', () => {
  const org = { name: 'Lab Prova S.r.l.', vat_number: '01234567890', address: 'Via Roma 1', city: 'Prato', zip: '59100', email: 'info@labprova.it', pec: null };
  const ext = { pay_terms: 'Bonifico 30 gg', withholding: false, split_payment: false };
  const p = precompila({ org, ext, referente: { nome: 'Mario Rossi', email: 'm.rossi@labprova.it' }, linea: 'SRV', labAddress: 'Via di Pratignone 13/4' });
  assert.equal(p.ragione_sociale, 'Lab Prova S.r.l.'); assert.equal(p.business_line, 'Service di Laboratorio'); assert.equal(p.stato, 'Attiva');
  assert.equal(p.nazione, 'Italia'); assert.equal(p.valuta, 'EUR'); assert.equal(p.svc_contatto, 'Mario Rossi'); assert.equal(p.termine_pagamento, 'Bonifico 30 gg');
  assert.equal(p.ritenuta, '', 'FALSE di default: non è un dato'); assert.equal(p.laboratorio_riferimento, 'Via di Pratignone 13/4');
  const ko = validaMod173({ ...p, email: 'non-email', iban: 'IT00', ragione_sociale: '' });
  assert.deepEqual(ko.errori.map((e) => e.campo).sort(), ['email', 'iban', 'ragione_sociale']);
  const { dati, errori } = validaMod173({ ...p, pec: 'labprova@pec.it', codice_sdi: 'ABC1234', iban: 'it60 x054 2811 1010 0000 0123 456', split_payment: 'Sì', ritenuta: 'No', address: 'x', indirizzo: 'Via Roma 1', citta: 'Prato', piva: '01234567890', termine_pagamento: 'Bonifico 60 gg' });
  assert.deepEqual(errori, []);
  assert.equal(dati.iban, 'IT60X0542811101000000123456');
  const cf = confrontaAnagrafica({ org, ext }, dati);
  const riemp = Object.fromEntries(cf.riempire.map((v) => [v.campo, v.valore]));
  assert.equal(riemp.pec, 'labprova@pec.it'); assert.equal(riemp.codice_sdi, 'ABC1234'); assert.equal(riemp.split_payment, true); assert.equal(riemp.iban, 'IT60X0542811101000000123456');
  assert.ok(!('ritenuta' in riemp), '"No" su FALSE: nessuna modifica');
  assert.deepEqual(cf.differenze.map((v) => [v.campo, v.attuale, v.proposto]), [['termine_pagamento', 'Bonifico 30 gg', 'Bonifico 60 gg']], 'campo già valorizzato e diverso: proposta da applicare');
  const no = confrontaAnagrafica({ org, ext: { withholding: true } }, { ritenuta: 'No' });
  assert.equal(no.differenze[0].campo, 'ritenuta');
  assert.equal(CAMPI_MOD173.filter((c) => c.req).length, 5);
});

test('MOD173 in PDF: versione compilabile con i campi modulo, versione compilata stampata, caratteri fuori codifica', async () => {
  const dati = precompila({ org: { name: 'Lab Ło Prova' }, linea: 'SRV' });
  const comp = await mod173Pdf(dati, { modalita: 'compilabile', company: { legal_name: 'Toscana Diagnostica S.r.l.' } });
  const doc = await PDFDocument.load(comp);
  const nomi = doc.getForm().getFields().map((f) => f.getName());
  assert.ok(nomi.includes('mod173.ragione_sociale') && nomi.includes('mod173.iban') && nomi.includes('mod173.stato'));
  assert.equal(doc.getForm().getTextField('mod173.ragione_sociale').getText(), 'Lab ?o Prova');
  const fatto = await PDFDocument.load(await mod173Pdf(dati, { modalita: 'compilato', data: '2026-11-06', versione: 1 }));
  assert.equal(fatto.getForm().getFields().length, 0);
  assert.equal(fatto.getPageCount(), 1);
  assert.equal(winAnsi('Città € “ok” ✓'), 'Città € “ok” ?');
});

// ---------------------------------------------------------------- testi e pacchetto
test('modelli: segnaposto, righe senza dato tolte, modelli salvati con i predefiniti, allegati per linea', () => {
  assert.equal(compila('Gentile {{referente}},\nReferente: {{referente_dettaglio}}\nFine {{x}}', { referente: 'Mario', referente_dettaglio: '' }), 'Gentile Mario,\nFine {{x}}');
  assert.equal(compila('Preparata per {{cliente}}.', { cliente: 'Lab S.r.l.' }), 'Preparata per Lab S.r.l.', 'un solo punto a fine frase');
  for (const [g, l] of Object.entries(SEGNAPOSTO_MODELLI)) {
    const testi = Object.entries(MODELLI_DEFAULT).filter(([k]) => k === g || k.startsWith(`${g}_`)).map(([, v]) => v).join('\n');
    assert.deepEqual(segnapostoDi(testi).filter((x) => ![...l, 'referenti'].includes(x)), [], `${g}: solo segnaposto previsti`);
  }
  assert.match(MODELLI_DEFAULT.kit_testo, /\{\{link_form\}\}/);
  assert.match(MODELLI_DEFAULT.lettera_presentazione, /^\{\{referenti\}\}$/m);
  const m = modelliFlussoDa(JSON.stringify({ kit_oggetto: 'Proposta {{cliente}}', ignoto: 'x' }));
  assert.equal(m.kit_oggetto, 'Proposta {{cliente}}'); assert.equal(m.kit_testo, MODELLI_DEFAULT.kit_testo); assert.ok(!('ignoto' in m));
  const al = allegatiDa({ SRV: [{ titolo: 'Visura camerale', obbligatorio: true }, { titolo: '' }] });
  assert.equal(al.SRV[0].contratto, true); assert.equal(al.SRV[1].titolo, 'Visura camerale'); assert.equal(al.SRV.length, 2); assert.equal(al.PP.length, 1);
});

test('pacchetto: offerta economica dal listino, credenziali StudioLAB, variante prospect senza offerta né credenziali', () => {
  const by = (l) => Object.fromEntries(l.map((x) => [x.key, x]));
  const kit = by(componiSezioni('SRV', {}, { offerta: 'PDF', listino: true, studiolab: true, variante: 'KIT' }));
  assert.equal(kit.listino.inclusa, true); assert.equal(kit.studiolab.inclusa, true); assert.equal(kit.lettera.titolo, 'Lettera di presentazione');
  const pr = by(componiSezioni('SRV', {}, { offerta: 'PDF', listino: true, studiolab: true, variante: 'PROSPECT' }));
  for (const k of ['offerta', 'listino', 'credenziali', 'studiolab', 'avvio', 'checklist']) assert.equal(pr[k].inclusa, false, k);
  assert.equal(pr.portale.inclusa, true); assert.equal(pr.vademecum.inclusa, true); assert.equal(pr.referente.inclusa, true);
  assert.equal(by(componiSezioni('SRV', {}, { variante: 'PROSPECT', owner: false })).referente.inclusa, false, 'prospect senza owner: niente "Da assegnare"');
  const eco = by(componiSezioni('SRV', {}, { offerta: 'ECONOMICA', listino: true }));
  assert.equal(eco.offerta.inclusa, false, 'la pagina riassuntiva lascia il posto all\'offerta dal listino');
  const vecchio = by(componiSezioni('SRV', {}, { offerta: 'PDF' }));
  assert.equal(vecchio.listino.inclusa, false); assert.match(vecchio.studiolab.motivo, /pagina degli accessi/);
});

// ---------------------------------------------------------------- flusso con la posta simulata (integrazione)
const pdfMinimo = async (testo) => { const d = await PDFDocument.create(); const p = d.addPage([300, 200]); p.drawText(testo, { x: 20, y: 100, size: 12 }); return Buffer.from(await d.save()); };

test('flusso: form pubblica con il contratto firmato → fase 6, comunicazioni con le copie fisse, servizi attivati; risposta per email da verificare; richiamo', { skip: SALTA, timeout: 240000 }, async () => {
  const s = await avviaSuite();
  try {
    const o = await entra(client(s.base), OWNER.email, OWNER.password, OWNER.finale);
    const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
    must(await o.post('/api/travaso/business/run', {}), 'avvio Business Hub');
    const acc = must(await o.post('/api/business/hub/accounts', { linea: 'SRV', nuova_org: { name: 'Laboratorio Prova Flusso S.r.l.', city: 'Prato', province: 'PO', email: 'info@labflusso.test', address: 'Via Roma 1', vat_number: '01234567890' }, volume_fy_atteso: 25000 }), 'prospect');
    must(await o.post(`/api/business/hub/accounts/${acc.id}/contatti`, { nome: 'Maria Bianchi', ruolo: 'Direttrice', email: 'maria.bianchi@labflusso.test', principale: true }), 'referente');
    // senza listino il kit non è pronto
    const st0 = must(await o.get(`/api/business/hub/accounts/${acc.id}/processo`), 'processo');
    assert.equal(st0.prerequisiti.pronto, false);
    assert.equal(st0.prerequisiti.voci.find((v) => v.key === 'listino').ok, false);
    // accesso alla Suite: nessun widget prima della firma
    const accesso = must(await o.post(`/api/business/hub/accounts/${acc.id}/accesso`, {}), 'accesso');
    assert.ok(accesso.password_provvisoria, 'posta in modalità registro: la password torna a chi crea l\'accesso');
    const ext = await entra(client(s.base), 'maria.bianchi@labflusso.test', accesso.password_provvisoria, 'Esterna-Flusso-2026x');
    const prima = must(await ext.get('/api/home/modules'), 'home esterno');
    assert.equal(prima.areas.length, 0, 'prima della firma nessun widget, nemmeno quelli aperti a tutti');
    assert.equal(prima.in_attesa_contratto, true);
    assert.equal((await ext.get('/api/service/state')).s, 403, 'Portale Service chiuso prima della firma');
    // collegamento alla form e pagina pubblica (senza sessione)
    must(await o.post(`/api/business/hub/accounts/${acc.id}/b2b-link`, { azione: 'crea' }), 'link');
    const st1 = must(await o.get(`/api/business/hub/accounts/${acc.id}/processo`), 'processo');
    const token = st1.form.link.split('/b2b/')[1];
    const pub = await fetch(`${s.base}/api/business/b2b/${token}`);
    const pj = await pub.json();
    assert.equal(pub.status, 200); assert.equal(pj.valori.ragione_sociale, 'Laboratorio Prova Flusso S.r.l.'); assert.equal(pj.valori.svc_email, 'maria.bianchi@labflusso.test');
    assert.equal((await fetch(`${s.base}/api/business/b2b/tokenfalsotokenfalsotokenfalso`)).status, 404);
    // risposta per email con il riferimento [TD-B2B-...] da un mittente sconosciuto: abbinata, PDF da verificare
    const fdm = new FormData();
    fdm.append('linea', 'SRV'); fdm.append('from_email', 'segreteria@altro-dominio.test'); fdm.append('subject', `R: Proposta ${st1.form.rif}`); fdm.append('testo', 'In allegato');
    fdm.append('file', new Blob([await pdfMinimo('firmato per email')], { type: 'application/pdf' }), 'contratto_firmato_email.pdf');
    const sim = await fetch(`${s.base}/api/business/inbox/simula`, { method: 'POST', body: fdm, headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
    const simj = await sim.json();
    assert.equal(simj.abbinato, true); assert.equal(simj.account_id, acc.id); assert.match(simj.come, /riferimento/);
    const st2 = must(await o.get(`/api/business/hub/accounts/${acc.id}/processo`), 'processo');
    assert.equal(st2.da_verificare.length, 1);
    // form pubblica: anagrafica + contratto firmato
    const fd = new FormData();
    fd.append('dati', JSON.stringify({ ...pj.valori, pec: 'labflusso@pec.test', codice_sdi: 'XYZ1234', termine_pagamento: 'Bonifico 30 gg df fm', banca_nome: 'Banca di Prova', iban: 'IT60X0542811101000000123456', split_payment: 'Sì' }));
    fd.append('contratto', new Blob([await pdfMinimo('contratto firmato')], { type: 'application/pdf' }), 'Lettera_offerta_firmata.pdf');
    const inv = await fetch(`${s.base}/api/business/b2b/${token}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'td-suite' } });
    const invj = await inv.json();
    assert.equal(inv.status, 201, JSON.stringify(invj)); assert.equal(invj.contrattualizzato, true); assert.ok(invj.riempiti >= 2);
    const a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.fase_corrente, 6); assert.equal(a.cliente_attivo, false, 'la fase 7 resta al CEO');
    const out = a.attivita.filter((x) => x.tipo === 'EMAIL_OUT');
    const per = (st) => out.find((x) => x.sottotipo === st);
    assert.equal(per('CONTRATTUALIZZAZIONE').email_to, 'francesco.epifani@toscanadiagnostica.it, rosetta.greco@toscanadiagnostica.it');
    assert.equal(per('BENVENUTO').email_to, 'maria.bianchi@labflusso.test');
    assert.equal(per('BENVENUTO').email_cc, 'francesco.epifani@toscanadiagnostica.it, rosetta.greco@toscanadiagnostica.it', 'copie fisse');
    assert.equal(per('NUOVO_CLIENTE_LAB').email_to, 'laboratorio@toscanadiagnostica.it, valentina.zezza@toscanadiagnostica.it');
    assert.match(per('NUOVO_CLIENTE_LAB').testo, /circa 100 esami al giorno/);
    assert.ok(out.every((x) => x.email_from === 'service@toscanadiagnostica.it'), 'mittente sempre service@');
    assert.ok(['FORM_B2B', 'CONTRATTO_FIRMATO', 'ATTIVAZIONE', 'ACCESSO'].every((t) => a.attivita.some((x) => x.tipo === t)), 'tutto nel diario');
    // dopo la firma: profilo Cliente service sull'accesso esterno (già entrato: nessun nuovo invito)
    const dopo = must(await ext.get('/api/home/modules'), 'home esterno dopo');
    const chiavi = dopo.areas.flatMap((x) => x.modules.map((m) => m.key));
    for (const k of ['service', 'nc', 'orders', 'circolari', 'ticket']) assert.ok(chiavi.includes(k), `widget ${k} dopo la firma`);
    // il secondo contratto non rimanda le comunicazioni
    const n = out.length;
    const vr = must(await o.post(`/api/business/hub/documenti/${st2.da_verificare[0].id}/verifica`, { esito: 'CONTRATTO' }), 'verifica');
    assert.equal(vr.contrattualizzazione.gia, true);
    const a2 = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a2.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length, n);
    // anteprima del richiamo: il cliente contrattualizzato non c'è
    const rich = must(await o.get('/api/business/hub/richiamo/anteprima'), 'richiamo');
    assert.equal(rich.attivo, false); assert.ok(!rich.oggi.some((x) => x.id === acc.id));
  } finally { await s.stop(); }
});
