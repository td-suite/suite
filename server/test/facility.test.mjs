// Test del modulo Facility e Manutenzioni: funzioni pure di lib/calc.js (scadenze, promemoria, SLA, MTTR, consumi mensili da bollette e
// letture, CO2, kWh equivalenti, intensità, anno su anno, anomalie, classifica, obiettivi, benchmark) e seed del Catalogo dispositivi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, firstDue, nextDue, streamsFor, obligationPlanKind, effectiveStatus, reminderStage, slaDueAt, slaState, canTransition, mttrHours, onTimeRate,
  spreadByMonth, billsToMonthly, readingsToMonthly, utilityMonthly, co2Kg, kwhEq, unitCost, aggregateMonthly, yoy, anomalies, intensity, ranking, benchmarkPosition,
  targetProgress, estimateOpeningHours, workOrderCode,
} from '../src/modules/facility/lib/calc.js';
import { ASSET_TYPES_SEED, validateAssetTypes, ASSET_CATEGORIES } from '../src/seed/assetTypes.js';
import { CO2_DEFAULT, KWH_FACTOR, BENCHMARK_KWH_M2 } from '../src/modules/facility/config.js';

test('addMonths rispetta il fine mese', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-08-15', 6), '2027-02-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('prima scadenza: data indicata, installazione + periodicità, oggi se la storia è sconosciuta', () => {
  assert.equal(firstDue({ explicit: '2026-12-01', installedAt: '2020-01-01', intervalMonths: 6, today: '2026-10-31' }), '2026-12-01');
  assert.equal(firstDue({ installedAt: '2026-09-01', intervalMonths: 6, today: '2026-10-31' }), '2027-03-01');
  assert.equal(firstDue({ installedAt: '2019-01-01', intervalMonths: 6, today: '2026-10-31' }), '2026-10-31');
  assert.equal(firstDue({ intervalMonths: 12, today: '2026-10-31' }), '2026-10-31');
  assert.equal(nextDue('2026-10-31', 6), '2027-04-30');
  assert.equal(nextDue('2026-10-31', null), null);
});

test('serie di un dispositivo dal catalogo, con periodicità propria che prevale', () => {
  const est = ASSET_TYPES_SEED.find((t) => t.code === 'ESTINTORE_POLVERE');
  const s = streamsFor({ name: 'Estintore corridoio' }, est);
  assert.deepEqual(s.map((x) => [x.stream, x.kind, x.performer, x.interval_months]), [['SORVEGLIANZA', 'CONTROLLO', 'SEDE', 1], ['CONTROLLO', 'CONTROLLO', 'MANUTENTORE', 6], ['MANUTENZIONE', 'MANUTENZIONE', 'MANUTENTORE', 36]]);
  const terra = ASSET_TYPES_SEED.find((t) => t.code === 'IMPIANTO_ELETTRICO_TERRA');
  const s2 = streamsFor({ check_interval_months: 60 }, terra);
  assert.deepEqual(s2.map((x) => [x.stream, x.kind, x.performer, x.interval_months]), [['CONTROLLO', 'VERIFICA_NORMATIVA', 'ENTE', 60]]);
  assert.deepEqual(streamsFor({}, null), []);
  assert.equal(obligationPlanKind('NORMATIVO'), 'VERIFICA_NORMATIVA');
  assert.equal(obligationPlanKind('CONTRATTUALE'), 'CONTROLLO');
});

test('stato effettivo: pianificata con data passata è scaduta', () => {
  assert.equal(effectiveStatus({ status: 'PIANIFICATA', due_date: '2026-10-30' }, '2026-10-31'), 'SCADUTA');
  assert.equal(effectiveStatus({ status: 'PIANIFICATA', due_date: '2026-10-31' }, '2026-10-31'), 'PIANIFICATA');
  assert.equal(effectiveStatus({ status: 'ESEGUITA', due_date: '2026-01-01' }, '2026-10-31'), 'ESEGUITA');
  assert.equal(effectiveStatus({ status: 'SCADUTA', due_date: '2026-11-15' }, '2026-10-31'), 'PIANIFICATA');
});

test('promemoria 30/7/0 giorni mai doppi; il più urgente raggiunto segna anche i precedenti', () => {
  assert.equal(reminderStage(45, []), null);
  assert.deepEqual(reminderStage(30, []), { stage: 'D30', mark: ['D30'] });
  assert.equal(reminderStage(20, ['D30']), null);
  assert.deepEqual(reminderStage(7, ['D30']), { stage: 'D7', mark: ['D7'] });
  assert.deepEqual(reminderStage(5, []), { stage: 'D7', mark: ['D30', 'D7'] });
  assert.deepEqual(reminderStage(0, ['D30', 'D7']), { stage: 'D0', mark: ['D0'] });
  assert.deepEqual(reminderStage(-10, []), { stage: 'D0', mark: ['D30', 'D7', 'D0'] });
  assert.equal(reminderStage(-11, ['D30', 'D7', 'D0']), null);
});

test('SLA per priorità, stato dello SLA, transizioni, MTTR, scadenze rispettate', () => {
  const opened = '2026-10-31T08:00:00.000Z';
  assert.equal(slaDueAt(opened, 'URGENTE'), '2026-11-01T08:00:00.000Z');
  assert.equal(slaDueAt(opened, 'ALTA'), '2026-11-03T08:00:00.000Z');
  assert.equal(slaDueAt(opened, 'MEDIA'), '2026-11-10T08:00:00.000Z');
  assert.equal(slaDueAt(opened, 'BASSA'), '2026-11-30T08:00:00.000Z');
  assert.equal(slaDueAt(opened, 'URGENTE', { URGENTE: 4 }), '2026-10-31T12:00:00.000Z');
  assert.equal(slaState({ due_at: '2026-11-01T08:00:00Z', closed_at: '2026-10-31T20:00:00Z' }).late, false);
  assert.equal(slaState({ due_at: '2026-11-01T08:00:00Z' }, new Date('2026-11-02T08:00:00Z')).hours_left, -24);
  assert.equal(canTransition('APERTO', 'ASSEGNATO'), true);
  assert.equal(canTransition('CHIUSO', 'ASSEGNATO'), false);
  assert.equal(canTransition('SOSPESO', 'IN_CORSO'), true);
  assert.equal(mttrHours([{ opened_at: '2026-10-31T08:00:00Z', closed_at: '2026-10-31T14:00:00Z' }, { opened_at: '2026-10-31T08:00:00Z', closed_at: '2026-11-01T08:00:00Z' }, { opened_at: '2026-10-31T08:00:00Z' }]), 15);
  assert.equal(mttrHours([]), null);
  assert.equal(onTimeRate([{ status: 'ESEGUITA', due_date: '2026-10-10', done_at: '2026-10-09' }, { status: 'ESEGUITA', due_date: '2026-10-10', done_at: '2026-10-12' }, { status: 'PIANIFICATA', due_date: '2026-10-10' }]), 50);
  assert.equal(workOrderCode(2026, 7), 'WO-2026-0007');
});

test('consumi: ripartizione pro rata dei giorni, bollette senza periodo nel mese prima della scadenza', () => {
  const sp = spreadByMonth('2026-01-16', '2026-02-14', 300);   // 16 giorni a gennaio, 14 a febbraio
  assert.equal(Math.round(sp['2026-01']), 160);
  assert.equal(Math.round(sp['2026-02']), 140);
  const m = billsToMonthly([{ period_from: '2026-01-01', period_to: '2026-02-28', amount: 590, consumption: 5900 }, { due_date: '2026-04-20', amount: 100, consumption: null }]);
  assert.equal(Math.round(m['2026-01'].qty), 3100);
  assert.equal(Math.round(m['2026-02'].qty), 2800);
  assert.equal(Math.round(m['2026-01'].cost), 310);
  assert.equal(m['2026-03'].qty, null);
  assert.equal(m['2026-03'].cost, 100);
  const r = readingsToMonthly([{ read_at: '2026-01-31', value: 1000 }, { read_at: '2026-02-28', value: 1280 }, { read_at: '2026-03-31', value: 50 }]);
  assert.equal(Math.round(r['2026-02']), 280);
  assert.equal(r['2026-03'], undefined);                         // azzeramento del contatore scartato
  const u = utilityMonthly([{ period_from: '2026-02-01', period_to: '2026-02-28', amount: 200, consumption: null }], [{ read_at: '2026-01-31', value: 0 }, { read_at: '2026-02-28', value: 900 }]);
  assert.equal(u['2026-02'].qty, 900);
  assert.equal(u['2026-02'].cost, 200);
  assert.equal(u['2026-02'].source, 'LETTURE');
});

test('CO2, kWh equivalenti, costo unitario e totali mensili', () => {
  assert.equal(co2Kg(1000, 'ELETTRICO', CO2_DEFAULT), 260);
  assert.equal(co2Kg(100, 'GAS', CO2_DEFAULT), 198);
  assert.equal(co2Kg(100, 'GAS', CO2_DEFAULT, 2), 200);
  assert.equal(kwhEq(100, 'GAS', KWH_FACTOR), 1069);
  assert.equal(kwhEq(100, 'ACQUA', KWH_FACTOR), 0);
  assert.equal(unitCost(250, 1000), 0.25);
  assert.equal(unitCost(250, 0), null);
  const agg = aggregateMonthly([{ vector: 'ELETTRICO', monthly: { '2026-01': { qty: 1000, cost: 250 } } }, { vector: 'GAS', monthly: { '2026-01': { qty: 100, cost: 110 } } }], { co2Factors: CO2_DEFAULT, kwhFactors: KWH_FACTOR });
  assert.equal(agg['2026-01'].kwh, 2069);
  assert.equal(agg['2026-01'].co2, 458);
  assert.equal(agg['2026-01'].cost, 360);
  assert.equal(agg['2026-01'].by_vector.GAS.qty, 100);
});

test('anno su anno: mesi, cumulato da inizio anno sugli stessi mesi', () => {
  const s = { '2025-01': 100, '2025-02': 100, '2025-03': 100, '2026-01': 110, '2026-02': 90 };
  const y = yoy(s, 2026);
  assert.equal(y.months[0].delta_pct, 10);
  assert.equal(y.months[1].delta_pct, -10);
  assert.equal(y.months[2].cur, null);
  assert.deepEqual(y.ytd, { months: 2, cur: 200, prev: 200, delta_pct: 0 });
});

test('anomalie: oltre +20% sullo stesso mese dell\'anno prima o sulla media mobile di tre mesi', () => {
  const s = { '2025-01': 1000, '2025-02': 1000, '2025-03': 1000, '2025-04': 1000, '2026-01': 1050, '2026-02': 1000, '2026-03': 1000, '2026-04': 1300 };
  const a = anomalies(s, { pct: 20 });
  assert.equal(a.length, 1);
  assert.equal(a[0].month, '2026-04');
  assert.equal(a[0].delta_pct, 30);
  assert.ok(a[0].refs.includes('ANNO_PRECEDENTE'));
  // senza l'anno precedente vale la media mobile
  const b = anomalies({ '2026-01': 100, '2026-02': 100, '2026-03': 100, '2026-04': 125 }, { pct: 20 });
  assert.deepEqual(b.map((x) => [x.month, x.ref_kind]), [['2026-04', 'MEDIA_MOBILE']]);
  assert.equal(anomalies({ '2026-01': 100, '2026-02': 100, '2026-03': 100, '2026-04': 119 }, { pct: 20 }).length, 0);
});

test('intensità: kWh/m2 annualizzato, per accettazione e per ora; classifica e benchmark', () => {
  const i = intensity({ kwh: 30000, co2: 7800, sqm: 400, accettazioni: 6000, ore: 1200, months: 6 });
  assert.equal(i.kwh_m2, 75);
  assert.equal(i.kwh_m2_anno, 150);
  assert.equal(i.kwh_per_acc, 5);
  assert.equal(i.kwh_per_ora, 25);
  assert.equal(i.co2_m2, 19.5);
  assert.equal(i.annualizzato, true);
  assert.equal(intensity({ kwh: 1000, sqm: null, months: 12 }).kwh_m2_anno, null);
  const rk = ranking([{ name: 'A', x: 5 }, { name: 'B', x: 3 }, { name: 'C', x: null }, { name: 'D', x: 4 }], 'x');
  assert.deepEqual(rk.map((r) => [r.name, r.rank]), [['B', 1], ['D', 2], ['A', 3], ['C', null]]);
  assert.equal(rk[0].vs_media_pct, -25);
  assert.equal(benchmarkPosition(BENCHMARK_KWH_M2, 'LABORATORIO', 600).position, 'SOPRA');
  assert.equal(benchmarkPosition(BENCHMARK_KWH_M2, 'PUNTO_PRELIEVI', 100).position, 'NELLA_FASCIA');
  assert.equal(benchmarkPosition(BENCHMARK_KWH_M2, 'SCONOSCIUTO', 10).position, 'SOTTO');
  assert.equal(estimateOpeningHours(42, '2026-02'), 168);
});

test('obiettivi: riduzione sugli stessi mesi dell\'anno base', () => {
  const s = { '2025-01': 100, '2025-02': 100, '2025-03': 100, '2026-01': 90, '2026-02': 95 };
  const t = targetProgress({ series: s, year: 2026, baselineYear: 2025, targetPct: 5 });
  assert.equal(t.status, 'RAGGIUNTO');
  assert.equal(t.reduction_pct, 7.5);
  assert.equal(t.months, 2);
  assert.equal(targetProgress({ series: s, year: 2026, baselineYear: 2025, targetPct: 10 }).status, 'IN_LINEA');
  assert.equal(targetProgress({ series: s, year: 2026, baselineYear: 2025, targetPct: 20 }).status, 'FUORI_LINEA');
  assert.equal(targetProgress({ series: {}, year: 2026, baselineYear: 2025, targetPct: 5 }).status, 'NESSUN_DATO');
});

test('seed del Catalogo dispositivi: almeno 35 voci valide con la nota "da confermare"', () => {
  assert.ok(ASSET_TYPES_SEED.length >= 35, `voci: ${ASSET_TYPES_SEED.length}`);
  assert.deepEqual(validateAssetTypes(), []);
  for (const c of Object.keys(ASSET_CATEGORIES)) assert.ok(ASSET_TYPES_SEED.some((t) => t.category === c), `categoria senza voci: ${c}`);
  for (const code of ['ESTINTORE_POLVERE', 'PORTA_REI', 'MANIGLIONE_ANTIPANICO', 'ILLUMINAZIONE_EMERGENZA', 'DAE', 'ASCENSORE', 'IMPIANTO_ELETTRICO_TERRA', 'LEGIONELLA']) assert.ok(ASSET_TYPES_SEED.some((t) => t.code === code), code);
  assert.deepEqual(validateAssetTypes([{ code: 'x', category: 'NO', check_kind: 'ALTRO', applies_to_kinds: ['BAR'], benchmark_note: '' }]).length, 6);
});
