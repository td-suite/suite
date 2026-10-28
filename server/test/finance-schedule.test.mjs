// Scadenziario strutture (Payments): test della logica pura (modules/finance/lib/schedule.js). Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, forecast, contractEnd, occurrences, stepAt, parseDate, toIso, addMonths, kpis, billEstimate } from '../src/modules/finance/lib/schedule.js';

const TODAY = '2026-10-28';
const lease = (over = {}) => ({ id: 1, site_id: 10, unit: 'Piano terra', landlord_name: 'Rossi Immobiliare', kind: 'COMMERCIALE_6_6', start_date: '2024-03-01', first_term_years: 6, renewal_years: 6, notice_months: 12, period_months: 1, first_due: null, registration: 'IMPOSTA_ANNUALE', istat: true, auto_pay: false, active: true, ...over });
const steps = [
  { id: 1, lease_id: 1, valid_from: '2024-03-01', amount: 1000, reason: 'INIZIALE' },
  { id: 2, lease_id: 1, valid_from: '2025-03-01', amount: 1020, reason: 'ISTAT' },
  { id: 3, lease_id: 1, valid_from: '2026-03-01', amount: 1050, reason: 'ISTAT' },
];
const byKind = (evs, k) => evs.filter((e) => e.kind === k);

test('date: somma di mesi a fine mese e occorrenze nel periodo', () => {
  assert.equal(toIso(addMonths(parseDate('2026-01-31'), 1)), '2026-02-28');
  assert.equal(toIso(addMonths(parseDate('2024-01-31'), 1)), '2024-02-29');
  const occ = occurrences(parseDate('2024-03-15'), 3, parseDate('2026-01-01'), parseDate('2026-12-31')).map(toIso);
  assert.deepEqual(occ, ['2026-03-15', '2026-06-15', '2026-09-15', '2026-12-15']);
});

test('occorrenze della rata: mensili nel periodo, importo = scatto vigente', () => {
  const evs = buildEvents({ leases: [lease()], steps, from: '2026-01-01', to: '2026-12-31', today: TODAY });
  const canoni = byKind(evs, 'canone');
  assert.equal(canoni.length, 12);
  assert.equal(canoni.find((e) => e.date === '2026-02-01').amount, 1020);   // prima dello scatto di marzo 2026
  assert.equal(canoni.find((e) => e.date === '2026-03-01').amount, 1050);   // dallo scatto
  assert.equal(canoni[0].key, 'canone:lease:1:2026-01-01');
  assert.equal(canoni[0].cat, 'AFFITTO');
  assert.equal(canoni.find((e) => e.date === '2026-11-01').days, 4);
});

test('rata trimestrale con prima scadenza diversa dalla decorrenza', () => {
  const evs = buildEvents({ leases: [lease({ period_months: 3, first_due: '2024-03-10' })], steps, from: '2026-01-01', to: '2026-12-31', today: TODAY });
  assert.deepEqual(byKind(evs, 'canone').map((e) => e.date), ['2026-03-10', '2026-06-10', '2026-09-10', '2026-12-10']);
});

test('canone vigente a una data e scatti futuri non ancora validi', () => {
  assert.equal(stepAt(steps, parseDate('2024-02-01')), null);
  assert.equal(stepAt(steps, parseDate('2025-06-01')).amount, 1020);
  assert.equal(stepAt(steps, parseDate('2026-03-01')).amount, 1050);
  const evs = buildEvents({ leases: [lease()], steps: [...steps, { id: 4, lease_id: 1, valid_from: '2027-03-01', amount: 1100, reason: 'RINEGOZIAZIONE' }], from: '2027-02-01', to: '2027-03-31', today: TODAY });
  assert.deepEqual(byKind(evs, 'canone').map((e) => e.amount), [1050, 1100]);
});

test('ISTAT e imposta di registro all anniversario della decorrenza', () => {
  const evs = buildEvents({ leases: [lease()], steps, from: '2027-01-01', to: '2027-12-31', today: TODAY });
  const istat = byKind(evs, 'istat');
  assert.equal(istat.length, 1); assert.equal(istat[0].date, '2027-03-01');
  const reg = byKind(evs, 'registro');
  assert.equal(reg.length, 1); assert.equal(reg[0].date, '2027-03-31');        // entro 30 giorni dall'annualità
  assert.ok(reg[0].desc.includes('F24 ELIDE'));
  assert.equal(reg[0].amount, 252);                                             // 2% di 1050 x 12 (stima)
  assert.ok(reg[0].estimate);
  // senza ISTAT e con cedolare secca niente eventi
  const evs2 = buildEvents({ leases: [lease({ istat: false, registration: 'CEDOLARE_SECCA' })], steps, from: '2027-01-01', to: '2027-12-31', today: TODAY });
  assert.equal(byKind(evs2, 'istat').length + byKind(evs2, 'registro').length, 0);
});

test('scadenza del contratto con rinnovi taciti e termine di disdetta', () => {
  const T = parseDate(TODAY);
  // 6+6 dal 2024: prima scadenza 2030, nessun rinnovo ancora
  let ce = contractEnd(lease(), T);
  assert.equal(toIso(ce.end), '2030-03-01'); assert.equal(ce.renewals, 0); assert.equal(ce.expired, false);
  // decorrenza 2015: 2021 superato, rinnovato fino al 2027
  ce = contractEnd(lease({ start_date: '2015-03-01' }), T);
  assert.equal(toIso(ce.end), '2027-03-01'); assert.equal(ce.renewals, 1);
  // senza rinnovo: scaduto
  ce = contractEnd(lease({ start_date: '2015-03-01', renewal_years: 0 }), T);
  assert.equal(toIso(ce.end), '2021-03-01'); assert.equal(ce.expired, true);
  // disdetta 12 mesi prima della scadenza del 2027
  const evs = buildEvents({ leases: [lease({ start_date: '2015-03-01' })], steps: [{ lease_id: 1, valid_from: '2015-03-01', amount: 900 }], from: '2026-01-01', to: '2027-12-31', today: TODAY });
  const fine = byKind(evs, 'fine'); const dis = byKind(evs, 'disdetta');
  assert.equal(fine.length, 1); assert.equal(fine[0].date, '2027-03-01'); assert.ok(fine[0].desc.includes('rinnovato 1 volta'));
  assert.equal(dis.length, 1); assert.equal(dis[0].date, '2026-03-01');
  assert.ok(dis[0].days < 0);                                                   // termine superato: scaduta
});

test('contratto scaduto senza rinnovo: nessuna rata dopo la scadenza', () => {
  const l = lease({ start_date: '2020-01-01', first_term_years: 6, renewal_years: 0, notice_months: 6, istat: false, registration: null });
  const evs = buildEvents({ leases: [l], steps: [{ lease_id: 1, valid_from: '2020-01-01', amount: 500 }], from: '2025-10-01', to: '2026-12-31', today: TODAY });
  const canoni = byKind(evs, 'canone');
  assert.equal(canoni[canoni.length - 1].date, '2026-01-01');
  assert.equal(byKind(evs, 'fine')[0].title, 'Contratto scaduto');
});

test('esiti: segnata fatta, pagamento automatico, scadute', () => {
  const done = [{ event_key: 'canone:lease:1:2026-10-01', amount: 1050, note: 'bonifico' }];
  const evs = buildEvents({ leases: [lease()], steps, done, from: '2026-09-01', to: '2026-11-30', today: TODAY });
  const c = byKind(evs, 'canone');
  assert.equal(c.find((e) => e.date === '2026-10-01').done, true);
  assert.equal(c.find((e) => e.date === '2026-10-01').done_note, 'bonifico');
  assert.equal(c.find((e) => e.date === '2026-09-01').done, false);
  const k = kpis({ events: evs, leases: [lease()], steps, utilities: [], today: TODAY });
  assert.equal(k.overdue, 1);                                                   // settembre non segnata
  assert.equal(k.monthly_rent, 1050); assert.equal(k.leases_active, 1);
  // con addebito automatico le passate non sono scadute
  const evs2 = buildEvents({ leases: [lease({ auto_pay: true })], steps, from: '2026-09-01', to: '2026-11-30', today: TODAY });
  assert.equal(kpis({ events: evs2, leases: [lease({ auto_pay: true })], steps, utilities: [], today: TODAY }).overdue, 0);
});

const utility = (over = {}) => ({ id: 7, site_id: 10, kind: 'ENERGIA', supplier_name: 'Enel', code: 'IT001E123', holder: 'Vecchio intestatario', transfer_status: 'IN_CORSO', period_months: 2, ref_due: '2026-09-15', avg_amount: 300, offer_end: '2027-01-31', auto_pay: false, active: true, ...over });

test('utenze: bollette attese dalla scadenza nota, stima da importo medio o da media bollette', () => {
  let evs = buildEvents({ leases: [], utilities: [utility()], bills: [], from: '2026-09-01', to: '2027-03-31', today: TODAY });
  const b = byKind(evs, 'bolletta');
  assert.deepEqual(b.map((e) => e.date), ['2026-09-15', '2026-11-15', '2027-01-15', '2027-03-15']);
  assert.ok(b.every((e) => e.estimate && e.amount === 300));
  assert.equal(byKind(evs, 'offerta')[0].date, '2027-01-31');
  assert.equal(b[0].cat, 'UTENZA');
  // bollette registrate: media degli ultimi 12 mesi al posto dell'importo medio
  const bills = [{ id: 1, utility_id: 7, due_date: '2026-05-15', amount: 400, paid_at: '2026-05-14' }, { id: 2, utility_id: 7, due_date: '2026-07-15', amount: 350, paid_at: '2026-07-10' }, { id: 3, utility_id: 7, due_date: '2026-09-15', amount: 420, paid_at: null }];
  assert.equal(billEstimate(utility(), bills, parseDate(TODAY)).amount, 390);
  evs = buildEvents({ leases: [], utilities: [utility()], bills, from: '2026-09-01', to: '2027-03-31', today: TODAY });
  const bb = byKind(evs, 'bolletta');
  // settembre: bolletta reale (420, non pagata quindi scaduta); le successive sono stime a 390
  const sep = bb.find((e) => e.date === '2026-09-15');
  assert.equal(sep.amount, 420); assert.equal(sep.estimate, false); assert.equal(sep.done, false); assert.equal(sep.bill_id, 3);
  assert.ok(sep.days < 0 && !sep.done);
  assert.deepEqual(bb.filter((e) => e.estimate).map((e) => [e.date, e.amount]), [['2026-11-15', 390], ['2027-01-15', 390], ['2027-03-15', 390]]);
  // bolletta pagata = fatta
  const evs3 = buildEvents({ leases: [], utilities: [utility()], bills: [{ id: 3, utility_id: 7, due_date: '2026-09-15', amount: 420, paid_at: '2026-09-10' }], from: '2026-09-01', to: '2026-09-30', today: TODAY });
  assert.equal(byKind(evs3, 'bolletta')[0].done, true);
});

test('previsione 12 mesi: affitti con ISTAT ipotetico, registro, utenze con crescita, confronto con i 12 mesi precedenti', () => {
  const bills = [{ id: 1, utility_id: 7, due_date: '2026-05-15', amount: 400, paid_at: '2026-05-14' }, { id: 2, utility_id: 7, due_date: '2026-07-15', amount: 350, paid_at: '2026-07-10' }, { id: 3, utility_id: 7, due_date: '2026-09-15', amount: 420, paid_at: '2026-09-20' }];
  const done = [{ event_key: 'canone:lease:1:2026-09-01', amount: null }, { event_key: 'canone:lease:1:2026-10-01', amount: 1050 }];
  const f = forecast({ leases: [lease()], steps, utilities: [utility()], bills, done, settings: { istat_pct: 2, utility_growth_pct: 0 }, months: 12, today: TODAY });
  assert.equal(f.months.length, 12); assert.equal(f.months[0], '2026-10'); assert.equal(f.months[11], '2027-09');
  const s = f.sites.find((x) => x.site_id === 10);
  // fino a febbraio 2027 la rata è 1050; da marzo 2027 (anniversario) +2% = 1071
  assert.equal(s.rent[0], 1050); assert.equal(s.rent[4], 1050); assert.equal(s.rent[5], 1071); assert.equal(s.rent[11], 1071);
  // imposta di registro nel mese dell'anniversario + 30 giorni (marzo 2027): 2% del canone annuo rivalutato
  assert.equal(s.registry[5], Math.round(1071 * 12 * 0.02 * 100) / 100); assert.equal(s.registry[4], 0);
  // utenza: media bollette 390 ogni 2 mesi = 195 al mese
  assert.equal(s.utilities[0], 195); assert.equal(s.utilities[11], 195);
  assert.equal(s.total[0], 1245);
  assert.equal(f.totals.sum, Math.round(s.total.reduce((a, b) => a + b, 0) * 100) / 100);
  assert.equal(f.assumptions.istat_pct, 2);
  // 12 mesi precedenti (ott 2025 - set 2026): bollette pagate 400+350+420, canoni segnati fatti: settembre 1050 (importo dell'evento)
  assert.deepEqual(f.previous.months.slice(0, 1), ['2025-10']); assert.equal(f.previous.months.length, 12);
  assert.equal(f.previous.sum_utilities, 1170);
  assert.equal(f.previous.sum_rent, 1050);
  assert.equal(f.previous.sum, 2220);
  // crescita utenze 12% annuo: dopo un anno circa +12%
  const g = forecast({ leases: [], steps: [], utilities: [utility()], bills: [], settings: { istat_pct: 0, utility_growth_pct: 12 }, months: 13, today: TODAY });
  assert.equal(g.sites[0].utilities[0], 150); assert.equal(g.sites[0].utilities[12], 168);
});

test('previsione: nessun costo dopo la scadenza senza rinnovo', () => {
  const l = lease({ start_date: '2021-03-01', first_term_years: 6, renewal_years: 0, istat: false, registration: null });
  const f = forecast({ leases: [l], steps: [{ lease_id: 1, valid_from: '2021-03-01', amount: 600 }], settings: {}, months: 12, today: TODAY });
  const s = f.sites[0];
  assert.equal(s.rent[0], 600);           // ott 2026
  assert.equal(s.rent[4], 600);           // feb 2027
  assert.equal(s.rent[5], 0);             // mar 2027: scaduto il 1 marzo 2027
  assert.equal(s.leases[0].end, '2027-03-01');
});

test('istanze collegate: la scadenza porta protocollo e stato dell istanza', () => {
  const requests = [{ event_key: 'canone:lease:1:2026-11-01', request_id: 5, protocol: 'AP-2026-0005', status: 'IN_FIRMA', amount: 1050 }];
  const evs = buildEvents({ leases: [lease()], steps, requests, from: '2026-10-01', to: '2026-11-30', today: TODAY });
  const nov = evs.find((e) => e.key === 'canone:lease:1:2026-11-01');
  assert.deepEqual(nov.request, { id: 5, protocol: 'AP-2026-0005', status: 'IN_FIRMA', amount: 1050 });
  assert.equal(evs.find((e) => e.key === 'canone:lease:1:2026-10-01').request, null);
  // esito da istanza eseguita: request_id sull esito
  const done = [{ event_key: 'canone:lease:1:2026-10-01', amount: 1050, note: 'Istanza AP-2026-0004 eseguita', request_id: 4 }];
  const evs2 = buildEvents({ leases: [lease()], steps, done, from: '2026-10-01', to: '2026-10-31', today: TODAY });
  assert.equal(evs2[0].done, true); assert.equal(evs2[0].done_request_id, 4);
});

test('contratto in PDF: scatti iniziali dalle rate ridotte e canone a regime (lib/leaseAnalysis.js)', async () => {
  const { initialSteps, mockExtract } = await import('../src/modules/finance/lib/leaseAnalysis.js');
  const ex = { canone: { rate_iniziali: [{ dal: '2026-04-15', al: '2026-04-30', importo: 2500 }, { dal: '2026-05-01', al: '2026-05-31', importo: 5000 }] } };
  assert.deepEqual(initialSteps(ex, { start_date: '2026-04-15', amount: 7300 }).map((s) => [s.valid_from, s.amount, s.reason]), [['2026-04-15', 2500, 'ALTRO'], ['2026-05-01', 5000, 'ALTRO'], ['2026-06-01', 7300, 'INIZIALE']]);
  assert.deepEqual(initialSteps({ canone: {} }, { start_date: '2026-04-15', amount: 7300 }).map((s) => [s.valid_from, s.amount, s.reason]), [['2026-04-15', 7300, 'INIZIALE']]);
  assert.deepEqual(initialSteps(ex, { start_date: null, amount: 7300 }), []);
  // estrattore di prova (FINANCE_AI_MOCK) su un testo nello stile del contratto Pratignone
  const t = 'Con la presente scrittura la società (in seguito chiamata LOCATORE) ALFA IMMOBILIARE s.r.l., C.F. 01234567890, P.IVA 01234567890 con sede a Prato (PO) in Via Roma n. 1, nella persona del legale rappresentante Dr. Mario Rossi nato a Prato, concede in locazione l\'immobile sito a Prato (PO) in Via Roma n. 1 p.T, iscritto al catasto urbano al fgl. 1 part. 2 sub 3 cat. D/7 R.C. 100,00 alla società TOSCANA DIAGNOSTICA S.R.L., con sede in Firenze, c.f. e p.iva 07528130482 (in seguito chiamata CONDUTTORE). 1) La locazione avrà la durata di anni 6 (sei) con inizio dal 01/01/2027 e con rinnovazione tacita per ulteriori sei anni, salvo disdetta da comunicarsi, dodici mesi prima della scadenza. 2) Il canone di locazione è stabilito consensualmente in Euro 12.000,00 (dodicimila/00) da pagarsi n. 12 rate mensili anticipate di Euro 1.000,00 (mille/00). Il canone è esente iva. 12) a titolo di deposito cauzionale la parte conduttrice versa la somma di euro 3.000,00 pari a tre mensilità.';
  const ex2 = mockExtract(t);
  assert.equal(ex2.locatore.ragione_sociale, 'ALFA IMMOBILIARE s.r.l.'); assert.equal(ex2.locatore.piva, '01234567890');
  assert.equal(ex2.immobile.citta, 'Prato'); assert.equal(ex2.durata.decorrenza, '2027-01-01'); assert.equal(ex2.durata.rinnovo_anni, 6); assert.equal(ex2.durata.preavviso_mesi, 12);
  assert.equal(ex2.canone.importo, 1000); assert.equal(ex2.canone.periodo, 'MESE'); assert.equal(ex2.canone.iva, 'ESENTE'); assert.equal(ex2.canone.deposito, 3000); assert.equal(ex2.tipo_contratto, 'COMMERCIALE_6_6');
  assert.equal(ex2.confidenza['canone.importo'].livello, 'alta');
});
