// Business Hub (richiesta del CEO del 06/11/2026): test delle regole pure di lib/hub.js (fasi e stallo, regola del cliente attivo,
// abbinamento email → account, mappatura delle colonne del DB Opportunità, accorpamento per gruppo) e lettura del file del CEO
// (salta se il file non c'è: BUSINESS_DB_OPPORTUNITA o il percorso di collaudo).
// Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  faseDaDate, faseEffettiva, puoAndareInFase, puoImpostareAttivo, ultimoAvanzamento, giorniDa, inStallo, spostaFase, abbinaEmail, dominioGenerico,
  leggiRiga, intestazioniMancanti, COLONNE_DB, parseEmailCampo, splitReferenti, chiaveGruppo, gruppoGenerico, raggruppa, rigaPrincipale, prioritaMassima, somma,
  regolaImportAttivo, esitoSomiglianza, differenzePipeline, indirizzi, CC_PREDEFINITI,
} from '../src/modules/business/lib/hub.js';
import { fasiDaContratto } from '../src/modules/business/lib/opportunita.js';

test('fasi: ultima fase con data, la 7 richiede il cliente attivo', () => {
  assert.equal(faseDaDate({}), 0);
  assert.equal(faseDaDate({ 1: '2026-05-04', 2: '2026-05-04', 4: '2026-05-21' }), 4);
  const tutte = { 1: '2026-05-04', 2: '2026-05-04', 3: '2026-05-04', 4: '2026-05-21', 5: '2026-06-29', 6: '2026-07-15', 7: '2026-07-20' };
  assert.equal(faseDaDate(tutte), 7);
  assert.equal(faseEffettiva(tutte, false), 6, 'senza cliente attivo la fase resta 6');
  assert.equal(faseEffettiva(tutte, true), 7);
  assert.equal(puoAndareInFase(7, false).ok, false);
  assert.match(puoAndareInFase(7, false).motivo, /CEO/);
  assert.equal(puoAndareInFase(7, true).ok, true);
  assert.equal(puoAndareInFase(5, false).ok, true);
  assert.equal(puoAndareInFase(9, true).ok, false);
});

test('cliente attivo: solo Admin del modulo o Owner della Suite (il CEO)', () => {
  assert.equal(puoImpostareAttivo('ADMIN', 'USER'), true);
  assert.equal(puoImpostareAttivo('SERVICE', 'OWNER'), true);
  assert.equal(puoImpostareAttivo('SERVICE', 'ADMIN'), false, 'un amministratore della Suite con profilo Service non basta');
  assert.equal(puoImpostareAttivo('VIEWER', 'USER'), false);
});

test('stallo: fasi 1-6 senza avanzamenti oltre la soglia', () => {
  const pd = { 1: '2026-05-04', 4: '2026-09-01' };
  assert.equal(ultimoAvanzamento(pd), '2026-09-01');
  assert.equal(giorniDa('2026-09-01', '2026-11-06'), 66);
  assert.equal(inStallo({ fase_corrente: 4, phase_dates: pd }, 45, '2026-11-06'), true);
  assert.equal(inStallo({ fase_corrente: 4, phase_dates: pd }, 90, '2026-11-06'), false);
  assert.equal(inStallo({ fase_corrente: 7, phase_dates: pd }, 45, '2026-11-06'), false, 'gli attivi non sono in stallo');
  assert.equal(inStallo({ fase_corrente: 0, phase_dates: {} }, 45, '2026-11-06'), false, 'i prospect censiti non sono in stallo');
  assert.equal(inStallo({ fase_corrente: 6, phase_dates: { 6: '2026-12-01' } }, 45, '2026-11-06'), false, 'data futura: nessuno stallo');
  assert.equal(inStallo({ fase_corrente: 6, phase_dates: { 6: '2026-07-15', 7: '2026-07-20' } }, 45, '2026-11-06'), false, 'Attivo / Starting in attesa del CEO: non è stallo');
});

test('spostamento di fase: data della fase di arrivo, indietro si tolgono le successive', () => {
  const pd = { 1: '2026-05-04', 2: '2026-05-10', 3: '2026-06-01' };
  let r = spostaFase(pd, 5, '2026-11-06');
  assert.deepEqual(r.phase_dates, { 1: '2026-05-04', 2: '2026-05-10', 3: '2026-06-01', 5: '2026-11-06' });
  r = spostaFase(pd, 2, '2026-11-06');
  assert.deepEqual(r.phase_dates, { 1: '2026-05-04', 2: '2026-11-06' });
  assert.deepEqual(r.tolte, { 3: '2026-06-01' });
  r = spostaFase(pd, 0);
  assert.deepEqual(r.phase_dates, {});
});

test('email in arrivo: indirizzo esatto, poi dominio (mai i provider), preferenza della linea della casella', () => {
  const voci = [
    { email: 'mario.rossi@clinica.it', account_id: 1, linea: 'SRV', fonte: 'referente' },
    { email: 'info@clinica.it', account_id: 1, linea: 'SRV', fonte: 'Legal entity' },
    { email: 'info@gruppo.it', account_id: 2, linea: 'SRV', fonte: 'Legal entity' },
    { email: 'info@gruppo.it', account_id: 3, linea: 'MDL', fonte: 'Legal entity' },
    { email: 'privato@gmail.com', account_id: 4, linea: 'PP', fonte: 'referente' },
  ];
  assert.deepEqual(abbinaEmail('Mario.Rossi@Clinica.it', voci), { account_id: 1, come: 'email di referente' });
  assert.equal(abbinaEmail('amministrazione@clinica.it', voci).account_id, 1, 'stesso dominio');
  assert.match(abbinaEmail('amministrazione@clinica.it', voci).come, /dominio clinica\.it/);
  assert.equal(abbinaEmail('info@gruppo.it', voci, 'MDL').account_id, 3, 'stesso indirizzo su due linee: vince quella della casella');
  assert.equal(abbinaEmail('info@gruppo.it', voci, 'PP').account_id, null, 'ambiguo: da assegnare');
  assert.deepEqual(abbinaEmail('info@gruppo.it', voci, 'PP').candidati, [2, 3]);
  assert.equal(abbinaEmail('privato@gmail.com', voci).account_id, 4, 'indirizzo esatto anche su un provider');
  assert.equal(abbinaEmail('altro@gmail.com', voci).account_id, null, 'mai per dominio su gmail');
  assert.equal(abbinaEmail('non-un-indirizzo', voci).account_id, null);
  assert.equal(dominioGenerico('pec.it'), true); assert.equal(dominioGenerico('legalmail.it'), true); assert.equal(dominioGenerico('clinica.it'), false);
  assert.deepEqual(indirizzi('a@b.it; C@D.it, a@b.it, x'), ['a@b.it', 'c@d.it']);
  assert.deepEqual(CC_PREDEFINITI.SRV, ['francesco.epifani@toscanadiagnostica.it', 'rosetta.greco@toscanadiagnostica.it']);
});

test('DB Opportunità: mappatura delle colonne, "n.d." vuoto con nota, testi non numerici conservati', () => {
  assert.equal(COLONNE_DB.length, 49);
  const headers = COLONNE_DB.map((c) => c.h);
  assert.deepEqual(intestazioniMancanti(headers), []);
  assert.deepEqual(intestazioniMancanti(headers.slice(1)), ['ID']);
  const v = Object.fromEntries(headers.map((h) => [h, null]));
  Object.assign(v, { ID: 3, 'Ragione Sociale / Denominazione': 'Biolabor', Indirizzo: 'n.d.', Città: 'Livorno', 'Prov.': 'LI', Email: 'biolabor@pec.it (PEC)', Priorità: 'alta',
    'Fatturato struttura (€)': 'Gruppo X 466,6 mln € (2024)', '1. Lead': new Date('2026-05-04T00:00:00Z'), '4. Offerta Inviata': new Date('2026-05-17T00:00:00Z'),
    'Fase Attuale': { formula: 'IF(...)', result: '4. Offerta Inviata' }, 'Sconto medio % vs listino': -0.2248, 'Fatturato FY atteso (€)': 180000, 'Prossima azione': { formula: 'x' } });
  const r = leggiRiga(headers, headers.map((h) => v[h]));
  assert.equal(r.id, 3); assert.equal(r.indirizzo, null); assert.deepEqual(r.nd, ['Indirizzo']);
  assert.equal(r.priorita, 'ALTA'); assert.equal(r.fatturato_struttura, null); assert.equal(r.testi['Fatturato struttura (€)'], 'Gruppo X 466,6 mln € (2024)');
  assert.deepEqual(r.phase_dates, { 1: '2026-05-04', 4: '2026-05-17' });
  assert.equal(r.fase_attuale, '4. Offerta Inviata'); assert.equal(r.prossima_azione, null);
  assert.equal(r.sconto_medio, -0.2248); assert.equal(r.fatturato_fy_atteso, 180000);
  assert.deepEqual(parseEmailCampo('biolabor@pec.it (PEC)'), { email: null, pec: 'biolabor@pec.it', nota: null });
  assert.deepEqual(parseEmailCampo('info.anniazzurri@kosgroup.com (email gruppo; NV 800 131851)'), { email: 'info.anniazzurri@kosgroup.com', pec: null, nota: 'email gruppo; NV 800 131851' });
  assert.deepEqual(splitReferenti('Riccardo Baronti, Marco Romanelli'), ['Riccardo Baronti', 'Marco Romanelli']);
  assert.deepEqual(splitReferenti('n.d.'), []);
});

test('accorpamento: stesso gruppo o ente gestore = una Legal entity; mai per le descrizioni generiche', () => {
  assert.equal(gruppoGenerico('gestione privata in convenzione'), true);
  assert.equal(gruppoGenerico('istituto religioso'), true);
  assert.equal(gruppoGenerico('Misericordia'), true);
  assert.equal(gruppoGenerico('Misericordia di Firenze'), false);
  assert.equal(gruppoGenerico('Sereni Orizzonti S.p.A.'), false);
  assert.equal(chiaveGruppo('Fondazione Filippo Turati'), chiaveGruppo('Fondazione Filippo Turati Onlus'), 'forme giuridiche ignorate');
  const R = (id, ragione_sociale, gruppo, extra = {}) => ({ id, ragione_sociale, gruppo, phase_dates: {}, nd: [], testi: {}, ...extra });
  const u = raggruppa([
    R(1, 'RSA A', 'Sereni Orizzonti S.p.A.', { priorita: 'BASSA', fatturato_fy_atteso: null }),
    R(2, 'RSA B', 'Sereni Orizzonti S.p.A.', { priorita: 'MEDIA', fatturato_fy_atteso: 1000, phase_dates: { 1: '2026-05-01' } }),
    R(3, 'RSA Pionta', 'gestione privata in convenzione'), R(4, 'RSA Coteto', 'gestione privata in convenzione'),
    R(5, 'Istituto Fanfani - sede Empoli', null), R(6, 'Studio Uno', 'Gruppo Solo'),
  ]);
  assert.equal(u.length, 5);
  assert.equal(u[0].gruppo, 'Sereni Orizzonti S.p.A.'); assert.equal(u[0].righe.length, 2);
  assert.equal(u[4].gruppo, null, 'un gruppo di una sola riga resta la struttura');
  assert.equal(rigaPrincipale(u[0].righe).id, 2, 'la riga più avanzata guida l\'account');
  assert.equal(prioritaMassima(u[0].righe), 'MEDIA');
  assert.equal(somma(u[0].righe, 'fatturato_fy_atteso'), 1000);
  assert.equal(somma(u[1].righe, 'fatturato_fy_atteso'), null);
});

test('import: cliente attivo mai automatico; somiglianza e riconciliazione con la pipeline del contratto', () => {
  const r = { fornitore_attuale: 'Toscana Diagnostica', situazione_fornitore: 'Cliente TD attivo', fase_7: '2026-07-20', phase_dates: {} };
  const x = regolaImportAttivo(r);
  assert.equal(x.cliente_attivo, false); assert.equal(x.da_confermare, true); assert.match(x.motivo, /CEO/);
  assert.equal(regolaImportAttivo({ fornitore_attuale: 'Synlab', situazione_fornitore: 'Incumbent da scalzare' }).da_confermare, false);
  assert.equal(esitoSomiglianza(0.95), 'ABBINATO'); assert.equal(esitoSomiglianza(0.78), 'DUBBIO'); assert.equal(esitoSomiglianza(0.6), 'NUOVO');
  const diff = differenzePipeline({ phase_dates: { 1: '2026-05-04', 7: '2026-09-14' }, fatturato_fy_atteso: 180000 },
    { fase_attuale: '7. Attivo', data_lead: '2026-05-04', data_attivo_starting: '2026-12-01', fatturato_fy_atteso_eur: 180000 });
  assert.deepEqual(diff.map((d) => d.campo), ['7. Attivo']);
  assert.equal(diff[0].db, '2026-09-14'); assert.equal(diff[0].contratto, '2026-12-01');
  const f = fasiDaContratto({ status: 'ATTIVO', proposal_date: '2026-05-08', signed_at: '2026-06-01', data: {} });
  assert.deepEqual(f.phase_dates, { 4: '2026-05-08', 6: '2026-06-01' });
  assert.equal(fasiDaContratto({ status: 'PROPOSTA', data: { pipeline: { data_lead: '2026-05-04', data_offerta_inviata: '2026-05-08' } } }).phase_dates[4], '2026-05-08');
});

// Il file del CEO (non nel repository): letto con le stesse regole dell'import
const FILE = process.env.BUSINESS_DB_OPPORTUNITA || '/tmp/claude-0/-home-claude/4278bdda-21c8-5fb1-a117-78e6b2a4d9c5/scratchpad/sf/offerta.xlsx';
test('DB Opportunità del CEO: 477 righe di dati, 49 colonne, gruppi e regola del cliente attivo', { skip: !fs.existsSync(FILE) && 'file del CEO assente' }, async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];
  const headers = ws.getRow(1).values.slice(1);
  assert.deepEqual(intestazioniMancanti(headers), []);
  const righe = []; ws.eachRow((row, i) => { if (i === 1) return; const r = leggiRiga(headers, row.values.slice(1)); if (Number.isInteger(r.id)) righe.push(r); });
  assert.equal(righe.length, 477, 'le righe di totale e legenda in fondo non sono dati');
  assert.equal(new Set(righe.map((r) => r.id)).size, righe.length, 'ID univoci');
  const unita = raggruppa(righe);
  assert.ok(unita.length < righe.length);
  assert.equal(unita.find((u) => u.gruppo === 'Sereni Orizzonti S.p.A.')?.righe.length, 10);
  assert.ok(!unita.some((u) => u.gruppo && gruppoGenerico(u.gruppo)), 'nessun accorpamento per descrizione generica');
  assert.equal(righe.filter((r) => regolaImportAttivo(r).da_confermare).length, 18);
  assert.equal(righe.filter((r) => r.alert_riconciliazione).length, 24);
  assert.ok(righe.every((r) => faseEffettiva(r.phase_dates, false) <= 6), 'nessun account nasce in fase 7');
});
