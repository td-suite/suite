// Finance Management · Controllo di gestione: regole pure del conto economico di sede e del margine per cliente Service
// (modules/finance/lib/contoEconomico.js). Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CE from '../src/modules/finance/lib/contoEconomico.js';

test('periodo: mese singolo, anno intero, anno precedente e validazione', () => {
  const p = CE.periodo(2026, 2);
  assert.deepEqual([p.da, p.a, p.mesi], ['2026-02-01', '2026-02-28', ['2026-02']]);
  assert.equal(p.etichetta, 'febbraio 2026');
  const y = CE.periodo(2026, null);
  assert.equal(y.mesi.length, 12); assert.equal(y.a, '2026-12-31');
  assert.equal(CE.periodoPrecedente(p).da, '2025-02-01');
  assert.throws(() => CE.periodo(2026, 13), /Mese non valido/);
  // anno in corso: fino al mese corrente, e l'anno precedente sugli stessi mesi
  const c = CE.periodo(2026, null, '2026-11-08');
  assert.equal(c.mesi.length, 11); assert.equal(c.a, '2026-11-30'); assert.equal(c.etichetta, 'anno 2026 (gennaio-novembre)');
  const pp = CE.periodoPrecedente(c);
  assert.equal(pp.mesi.length, 11); assert.equal(pp.a, '2025-11-30');
  assert.equal(CE.periodo(2025, null, '2026-11-08').mesi.length, 12);
});

test('copertura del mese a giorni e ripartizione di una bolletta per periodo', () => {
  assert.equal(CE.copertura(null, null, '2026-04'), 1);
  assert.equal(CE.copertura('2026-04-16', null, '2026-04'), 0.5);              // 15 giorni su 30
  assert.equal(CE.copertura('2026-05-01', null, '2026-04'), 0);
  assert.equal(CE.copertura(null, '2026-04-10', '2026-04'), 1 / 3);
  assert.equal(CE.costoDipendenteMese({ ral: 36000, inizio: '2026-10-16' }, '2026-10', 1.28).importo, 1981.94);   // 3840 × 16/31
  // bimestrale gen-feb 2026 da 590 € (31 + 28 giorni): quota di febbraio 280 €
  const q = CE.ripartisciPerGiorni(590, '2026-01-01', '2026-02-28', ['2026-02']);
  assert.equal(q['2026-02'], 280);
  const t = CE.ripartisciPerGiorni(590, '2026-01-01', '2026-02-28', ['2026-01', '2026-02']);
  assert.equal(t['2026-01'] + t['2026-02'], 590);
});

test('costo del dipendente: RAL vigente × coefficiente / 12, scatti e coefficiente del contratto', () => {
  const e = { ral: 30000, ral_steps: [{ from: '2026-07-01', ral: 33000 }], inizio: '2025-01-01', fine: null };
  assert.equal(CE.costoDipendenteMese(e, '2026-06', 1.28).importo, 3200);        // 30000 × 1,28 / 12
  assert.equal(CE.costoDipendenteMese(e, '2026-07', 1.28).importo, 3520);        // scatto di luglio
  assert.equal(CE.costoDipendenteMese({ ...e, cost_coefficient: 1.35 }, '2026-06', 1.28).importo, 3375);
  assert.equal(CE.costoDipendenteMese({ ...e, inizio: '2026-06-16' }, '2026-06', 1.28).importo, 1600);   // metà mese
  assert.equal(CE.costoDipendenteMese({ ...e, fine: '2026-05-31' }, '2026-06', 1.28).importo, 0);
});

test('compenso LP: fissi mensili quantificabili, variabili da indicare', () => {
  assert.deepEqual(CE.compensoLp({ fees: [{ type: 'FISSO', amount: 1500, unit: 'mese' }], est_monthly_cost: 1500 }), { mensile: 1500, variabile: false });
  assert.deepEqual(CE.compensoLp({ fees: [{ type: 'ORARIO', amount: 40, unit: 'ora' }], est_monthly_cost: 0 }), { mensile: null, variabile: true });
  assert.deepEqual(CE.compensoLp({ fees: [{ type: 'FISSO', amount: 800 }, { type: 'PRESTAZIONE', amount: 20, unit: 'cad' }], est_monthly_cost: null }), { mensile: 800, variabile: true });
});

test('canone: rata dagli scatti divisa per la periodicità, IVA come costo o esclusa', () => {
  const steps = [{ valid_from: '2024-01-01', amount: 3000 }, { valid_from: '2026-03-01', amount: 3060 }];
  assert.equal(CE.canoneMensileDaScatti(steps, 3, '2026-02'), 1000);
  assert.equal(CE.canoneMensileDaScatti(steps, 3, '2026-03'), 1020);
  assert.equal(CE.canoneMensileDaScatti([{ valid_from: '2026-05-15', amount: 900 }], 1, '2026-05'), 900);   // contratto che parte nel mese
  assert.equal(CE.conIva(1000, 'PIU_IVA', 22, 'COSTO'), 1220);
  assert.equal(CE.conIva(1000, 'PIU_IVA', 22, 'ESCLUSA'), 1000);
  assert.equal(CE.conIva(1220, 'IVA_INCLUSA', 22, 'ESCLUSA'), 1000);
  assert.equal(CE.conIva(1000, 'ESENTE', 22, 'COSTO'), 1000);
});

test('ritiri del mese dai giorni del contratto Service (lun-sab, FISSO / CHIAMATA / NO)', () => {
  // ottobre 2026: 1 è giovedì; lunedì 5, 12, 19, 26 (4); mercoledì 7, 14, 21, 28 (4); venerdì 2, 9, 16, 23, 30 (5)
  const days = [{ mode: 'FISSO' }, { mode: 'NO' }, { mode: 'FISSO' }, { mode: 'CHIAMATA' }, { mode: 'FISSO' }, { mode: 'NO' }];
  const r = CE.ritiriNelMese(days, '2026-10');
  assert.equal(r.fissi, 13); assert.equal(r.chiamata, 5);   // giovedì 1, 8, 15, 22, 29
  assert.deepEqual(r.giorni_settimana, ['mon', 'wed', 'fri']);
  assert.equal(CE.ritiriNelMese([], '2026-10').fissi, 0);
  assert.equal(CE.ritiriNelMese(days, '2026-10', '2026-10-15').fissi, 7);          // contratto dal 15: 16, 19, 21, 23, 26, 28, 30
  assert.equal(CE.ritiriNelMese(days, '2026-10', '2026-11-01').fissi, 0);          // contratto non ancora iniziato
});

test('ricavo ai prezzi del listino del cliente e costo analitico per codice o medio', () => {
  const listino = [{ codice: 'GLU', offerto: 1.5, listino: 2 }, { codice: 'emo', offerto: null, listino: 3 }];
  const righe = [{ codice: 'glu', quantita: 100 }, { codice: 'EMO', quantita: 10 }, { codice: 'XYZ', quantita: 5, valore: 20 }];
  const r = CE.ricavoDaListino(righe, listino);
  assert.equal(r.ricavo, 100 * 1.5 + 10 * 3 + 20);
  assert.equal(r.esami_prezzati, 110); assert.equal(r.esami_senza_prezzo, 5);
  const costi = new Map([['GLU', 0.4]]);
  const c = CE.costoAnalitico({ righe }, costi, 1);
  assert.equal(c.costo, 100 * 0.4 + 15 * 1); assert.equal(c.esami_al_medio, 15); assert.equal(c.stima, true);
  assert.equal(CE.costoAnalitico({ righe: null, esami: 50 }, new Map(), null).esami_scoperti, 50);
});

test('produzione: priorità delle fonti e stima in pro quota dall\'account del Business Hub (v0.68.4)', () => {
  // ottobre 2026: 22 giorni lavorativi; FY atteso 25.000 € su 250 giorni = 100 € al giorno lavorativo
  const st = CE.stimaProQuota({ fatturato_fy_atteso: 25000, volumi_giornalieri_attesi: 24 }, '2026-10', { giorniAnno: 250, oggi: '2026-11-10' });
  assert.deepEqual([st.giorni, st.valore, st.esami], [22, 2200, 528]);   // 25.000 × 22/250; 24 esami × 22 giorni
  // senza fatturato FY atteso: equivalente annuo volumi × giorni dell'anno × prezzo medio (24 × 240 × 5 = 28.800), pro quota 22/240
  assert.equal(CE.stimaProQuota({ volumi_giornalieri_attesi: 24, prezzo_medio_esame: 5 }, '2026-10', { giorniAnno: 240, oggi: '2026-11-10' }).valore, 2640);
  assert.equal(CE.stimaProQuota({}, '2026-10', { oggi: '2026-11-10' }), null);
  assert.equal(CE.stimaProQuota({ volumi_giornalieri_attesi: 10 }, '2026-10', { oggi: '2026-11-10' }), null, 'volumi senza prezzo né FY: nessun valore da stimare');
  assert.equal(CE.stimaProQuota({ fatturato_fy_atteso: 1000 }, '2026-10', { avvio: '2026-11-01', oggi: '2026-11-10' }), null, 'prima dell\'avvio');
  assert.equal(CE.stimaProQuota({ fatturato_fy_atteso: 1000 }, '2026-12', { oggi: '2026-11-10' }), null, 'mese futuro');
  assert.equal(CE.fatturatoFyAtteso({ fatturato_fy_atteso: 60000 }), 60000);
  const retail = { esami: 50, valore: 300, righe: [{ codice: 'GLU', quantita: 50 }] };
  assert.equal(CE.scegliProduzione({ salvata: { fonte: 'MANUALE', esami: 40, valore: 200 }, retail, stima: st }).fonte, 'MANUALE');
  assert.equal(CE.scegliProduzione({ salvata: { fonte: 'STIMA', esami: 40 }, retail }).origine, 'Retail: vendite B2B dal gestionale StudioLAB');
  assert.equal(CE.scegliProduzione({ ordini: { esami: 7, righe: [] } }).origine, 'Ordini: produzione StudioLAB (HL7 o import)');
  const s = CE.scegliProduzione({ stima: st });
  assert.equal(s.fonte, 'STIMA'); assert.equal(s.calcolata, true);
  assert.equal(CE.scegliProduzione({ salvata: { id: 9, fonte: 'STIMA', esami: 1, valore: 99999 }, stima: st }).valore, 2200, 'il pro quota prevale sulla stima salvata con la regola vecchia');
  assert.equal(CE.scegliProduzione({}), null);
});

test('margine del cliente: ricavo a listino, ritiri, costo esami, pagamenti e "da indicare"', () => {
  const produzione = { esami: 110, valore: null, righe: [{ codice: 'GLU', quantita: 100 }, { codice: 'EMO', quantita: 10 }], stima: false };
  const m = CE.margineCliente({ produzione, listino: [{ codice: 'GLU', offerto: 1.5 }, { codice: 'EMO', offerto: 3 }], costiEsami: new Map(), costoMedio: 0.5, costoRitiro: 12, ritiri: { fissi: 13, chiamata: 0 }, pagamenti: 40 });
  assert.equal(m.ricavo, 180); assert.equal(m.ricavo_da, 'LISTINO');
  assert.equal(m.costo_ritiri, 156); assert.equal(m.costo_esami, 55); assert.equal(m.costi_diretti, 251);
  assert.equal(m.margine, -71); assert.equal(m.margine_pct, -39.4);
  assert.ok(m.stime.includes('costo del ritiro'));
  const senza = CE.margineCliente({ produzione: { esami: 10, valore: null, righe: null }, costoRitiro: null, ritiri: { fissi: 4, chiamata: 0 } });
  assert.equal(senza.ricavo, null); assert.equal(senza.margine, null);
  assert.ok(senza.da_indicare.some((x) => x.startsWith('valore della produzione')));
  assert.ok(senza.da_indicare.includes('costo per ritiro (Impostazioni)'));
});

test('ripartizione dei costi centrali in proporzione ai ricavi (decisione 11), arrotondamento e ricavi a zero', () => {
  const r = CE.ripartisciCentrali(1000, { 1: 6000, 2: 3000, 3: 1000 });
  assert.deepEqual([r.quote[1].quota, r.quote[2].quota, r.quote[3].quota], [600, 300, 100]);
  assert.deepEqual([r.quote[1].pct, r.quote[3].pct], [60, 10]);
  const t = CE.ripartisciCentrali(100, { 1: 1, 2: 1, 3: 1 });
  assert.equal(t.quote[1].quota + t.quote[2].quota + t.quote[3].quota, 100);
  const z = CE.ripartisciCentrali(500, { 1: 0, 2: 0 });
  assert.equal(z.ripartibile, false); assert.match(z.motivo, /Ricavi del periodo a zero/);
});

test('conto economico: ricavi, costi diretti, centrali ripartiti, margine, Cash di controllo, fonti non disponibili', () => {
  const sedi = [{ id: 1, name: 'Sede A' }, { id: 2, name: 'Laboratorio' }];
  const centrali = [{ id: 9, name: 'HQ' }];
  const movimenti = [
    { riga: 'ricavi_retail', site_id: 1, importo: 10000 },
    { riga: 'ricavi_service', site_id: 2, importo: 5000 },
    { riga: 'incassi_cash', site_id: 1, importo: 9800 },
    { riga: 'canone', site_id: 1, importo: 1220 },
    { riga: 'personale', site_id: 1, importo: 3200 },
    { riga: 'personale', site_id: null, importo: 4000 },     // senza sede: centrale
    { riga: 'utenze', site_id: 9, importo: 500 },            // sede centrale
    { riga: 'pagamenti', site_id: 2, importo: 300 },
    { riga: 'lp', site_id: 2, importo: null },              // compenso da indicare
    { riga: 'ricavi_retail', site_id: 9, importo: 50 },      // ricavo su sede centrale: avviso, non attribuito
  ];
  const fonti = { royalty: { disponibile: false, nota: 'Cash non attivo' } };
  const c = CE.componiConto({ sedi, centrali, movimenti, fonti });
  const [a, lab] = c.colonne;
  assert.equal(a.ricavi, 10000); assert.equal(lab.ricavi, 5000);
  assert.equal(a.costi_diretti, 4420); assert.equal(lab.costi_diretti, 300);
  assert.equal(c.centrali.totale, 4500);
  assert.deepEqual([a.quota_centrali, lab.quota_centrali], [3000, 1500]);       // 2/3 e 1/3 dei 4500
  assert.deepEqual([a.quota_pct, lab.quota_pct], [66.67, 33.33]);
  assert.equal(a.margine, 10000 - 4420 - 3000); assert.equal(lab.margine, 5000 - 300 - 1500);
  assert.equal(a.margine_pct, 25.8);
  assert.deepEqual(a.controllo_cash, { incassi: 9800, retail: 10000, differenza: -200 });
  assert.equal(c.totale.margine, 15000 - 4720 - 4500);
  assert.equal(lab.da_indicare, 1); assert.equal(lab.parziale, true);
  assert.ok(a.mancanti.includes('Royalties al partner ospitante'));          // fonte non disponibile: margine parziale, mai zero silenzioso
  assert.equal(c.avvisi.length, 1);
  assert.equal(CE.variazione(110, 100), 10); assert.equal(CE.variazione(5, 0), null);
});
