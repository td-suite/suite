// Energy management: lettura dei dati (utenze e bollette da Payments, estensione energetica, letture, attività, immobili, obiettivi)
// e costruzione del quadro per sede e per rete (consumi e costi per mese e vettore, CO2, kWh equivalenti, intensità, anno su anno,
// anomalie, classifica tra sedi a parità di attività, obiettivi, fasce di benchmark). Le formule sono in calc.js (pure).
import { many } from '../db.js';
import { KIND_TO_VECTOR, UNIT_DEFAULT, BENCHMARK_KWH_M2, BENCHMARK_SOURCE } from '../config.js';
import { financeLive } from './core.js';
import { utilityMonthly, aggregateMonthly, yoy, anomalies, intensity, ranking, benchmarkPosition, targetProgress, estimateOpeningHours, monthsOfYear, unitCost, co2Kg, kwhEq } from './calc.js';

const r1 = (v, d = 1) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
export const vectorOf = (u) => u.vector || KIND_TO_VECTOR[u.kind] || 'ALTRO';

// Utenze energetiche di Payments (energia, gas, acqua, più quelle che hanno l'estensione Facility) con bollette e letture
export async function loadEnergyData({ siteIds = null } = {}) {
  if (!(await financeLive())) return { available: false };
  const p = siteIds ? [siteIds] : [];
  const sw = siteIds ? 'AND u.site_id = ANY($1::int[])' : '';
  const utilities = await many(`SELECT u.id, u.site_id, u.kind, coalesce(u.supplier_name, o.name) AS supplier_name, u.code, u.holder, u.transfer_status, u.period_months, u.active,
      m.vector, m.pod_pdr, m.contracted_power_kw, m.tariff, m.co2_factor, m.unit AS meta_unit
    FROM finance.utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN utility_meta m ON m.utility_id=u.id
    WHERE (u.kind IN ('ENERGIA','GAS','ACQUA') OR m.utility_id IS NOT NULL) ${sw} ORDER BY u.site_id, u.kind, u.id`, p);
  const ids = utilities.map((u) => u.id);
  const bills = ids.length ? await many('SELECT id, utility_id, period_from, period_to, due_date, amount, consumption, unit, paid_at FROM finance.utility_bills WHERE utility_id = ANY($1::int[]) ORDER BY due_date', [ids]) : [];
  const readings = ids.length ? await many('SELECT id, utility_id, read_at, value, source FROM meter_readings WHERE utility_id = ANY($1::int[]) ORDER BY read_at', [ids]) : [];
  const sites = await many(`SELECT s.id, s.code, s.name, s.kind, s.city, pr.surface_sqm, pr.opening_hours_week, pr.occupancy_days_week FROM sites_v s LEFT JOIN properties pr ON pr.site_id=s.id
    WHERE s.active ${siteIds ? 'AND s.id = ANY($1::int[])' : ''} ORDER BY s.sort_order, s.name`, p);
  const activity = await many(`SELECT site_id, to_char(month, 'YYYY-MM') AS month, accettazioni, prestazioni, ore_apertura, giorni_apertura, source FROM activity_metrics ${siteIds ? 'WHERE site_id = ANY($1::int[])' : ''}`, p);
  const targets = await many(`SELECT t.*, s.name AS site_name FROM energy_targets t LEFT JOIN public.sites s ON s.id=t.site_id ${siteIds ? 'WHERE t.site_id IS NULL OR t.site_id = ANY($1::int[])' : ''} ORDER BY t.year DESC, t.site_id NULLS FIRST`, p);
  for (const u of utilities) {
    u.vector = vectorOf(u);
    u.unit = u.meta_unit || UNIT_DEFAULT[u.vector];
    u.monthly = utilityMonthly(bills.filter((b) => b.utility_id === u.id), readings.filter((r) => r.utility_id === u.id));
  }
  return { available: true, utilities, bills, readings, sites, activity, targets };
}

// Quadro energetico di un insieme di sedi per un anno (sedi singole + rete)
export function buildEnergy(data, settings, year) {
  const co2Factors = settings.co2_factors, kwhFactors = settings.kwh_factors;
  const pct = Number(settings.anomaly_pct) || 20;
  const months = monthsOfYear(year);
  const prevMonths = monthsOfYear(year - 1);
  const actBy = new Map(data.activity.map((a) => [`${a.site_id}:${a.month}`, a]));

  const siteBlock = (site, utils) => {
    const agg = aggregateMonthly(utils, { co2Factors, kwhFactors });
    const kwhSeries = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, v.kwh]));
    const sum = (keys, f) => keys.reduce((a, k) => a + (agg[k] ? f(agg[k]) : 0), 0);
    const withData = months.filter((k) => agg[k] && agg[k].kwh > 0);
    // sedi che contribuiscono (per la rete: quelle con consumi nell'anno), per superficie, attività e ore
    const contributing = site ? [site] : data.sites.filter((s) => utils.some((u) => u.site_id === s.id && months.some((k) => u.monthly[k]?.qty)));
    const tot = { kwh: r1(sum(months, (v) => v.kwh)), co2: r1(sum(months, (v) => v.co2)), cost: r1(sum(months, (v) => v.cost), 2), months: withData.length };
    const prev = { kwh: r1(sum(prevMonths, (v) => v.kwh)), co2: r1(sum(prevMonths, (v) => v.co2)), cost: r1(sum(prevMonths, (v) => v.cost), 2) };
    // confronto omogeneo: stessi mesi dell'anno precedente (quelli con dati nell'anno)
    const prevSame = withData.map((k) => `${year - 1}${k.slice(4)}`);
    const prevYtd = { kwh: r1(sum(prevSame, (v) => v.kwh)), co2: r1(sum(prevSame, (v) => v.co2)), cost: r1(sum(prevSame, (v) => v.cost), 2), months: prevSame.filter((k) => agg[k]?.kwh > 0).length };
    // vettori: quantità nell'unità propria, costo, costo unitario, CO2
    const vectors = {};
    for (const u of utils) {
      const vv = vectors[u.vector] || (vectors[u.vector] = { vector: u.vector, unit: u.unit, qty: 0, cost: 0, co2: 0, kwh: 0, prev_qty: 0, utilities: 0 });
      vv.utilities++;
      for (const k of months) { const m = u.monthly[k]; if (m) { vv.qty += m.qty || 0; vv.cost += m.cost || 0; vv.co2 += co2Kg(m.qty, u.vector, co2Factors, u.co2_factor) || 0; vv.kwh += kwhEq(m.qty, u.vector, kwhFactors) || 0; } }
      for (const k of months) { const m = u.monthly[`${year - 1}${k.slice(4)}`]; if (m && u.monthly[k]?.qty != null) vv.prev_qty += m.qty || 0; }   // stessi mesi
    }
    for (const v of Object.values(vectors)) { v.unit_cost = unitCost(v.cost, v.qty); v.qty = r1(v.qty, 1); v.cost = r1(v.cost, 2); v.co2 = r1(v.co2); v.kwh = r1(v.kwh); v.prev_qty = r1(v.prev_qty, 1); v.delta_pct = v.prev_qty ? r1(((v.qty - v.prev_qty) / v.prev_qty) * 100) : null; }
    // attività e ore (solo i mesi con consumi, per confronti omogenei)
    let acc = 0, accMonths = 0, ore = 0;
    for (const k of withData) {
      for (const sid of contributing.map((s) => s.id)) {
        const a = actBy.get(`${sid}:${k}`);
        if (a?.accettazioni != null) { acc += Number(a.accettazioni); accMonths++; }
        const s = data.sites.find((x) => x.id === sid);
        const h = a?.ore_apertura != null ? Number(a.ore_apertura) : estimateOpeningHours(s?.opening_hours_week, k);
        if (h) ore += h;
      }
    }
    const sqm = contributing.reduce((a, s) => a + (Number(s.surface_sqm) || 0), 0) || null;
    const ind = intensity({ kwh: tot.kwh, co2: tot.co2, sqm, accettazioni: acc || null, ore: ore || null, months: withData.length });
    const elettrico = vectors.ELETTRICO ? intensity({ kwh: vectors.ELETTRICO.kwh, sqm, accettazioni: acc || null, ore: ore || null, months: withData.length }) : null;
    const anomalie = [];
    for (const u of utils) {
      const series = Object.fromEntries(Object.entries(u.monthly).map(([k, v]) => [k, v.qty]));
      for (const a of anomalies(series, { pct })) if (a.month.startsWith(String(year)) || a.month.startsWith(String(year - 1))) anomalie.push({ ...a, utility_id: u.id, vector: u.vector, unit: u.unit, site_id: u.site_id });
    }
    const monthly = months.map((k) => ({ month: k, kwh: agg[k]?.kwh ?? null, prev_kwh: agg[`${year - 1}${k.slice(4)}`]?.kwh ?? null, cost: agg[k]?.cost ?? null, co2: agg[k]?.co2 ?? null, by_vector: agg[k]?.by_vector || {} }));
    return { totals: tot, prev, prev_ytd: prevYtd, delta_kwh_pct: prevYtd.kwh ? r1(((tot.kwh - prevYtd.kwh) / prevYtd.kwh) * 100) : null, vectors: Object.values(vectors), monthly, yoy: yoy(kwhSeries, year), series: kwhSeries,
      activity: { accettazioni: acc || null, mesi_attivita: accMonths, ore: r1(ore) }, sqm, intensity: ind, intensity_elettrico: elettrico, anomalies: anomalie.sort((a, b) => b.month.localeCompare(a.month)) };
  };

  const sites = data.sites.map((s) => {
    const utils = data.utilities.filter((u) => u.site_id === s.id);
    const b = siteBlock(s, utils);
    const bench = benchmarkPosition(BENCHMARK_KWH_M2, s.kind, b.intensity.kwh_m2_anno);
    return { site: s, utilities: utils.map((u) => ({ id: u.id, kind: u.kind, vector: u.vector, unit: u.unit, supplier_name: u.supplier_name, code: u.code, pod_pdr: u.pod_pdr, active: u.active })), ...b, benchmark: bench };
  });
  const network = siteBlock(null, data.utilities);
  // classifica tra sedi a parità di attività e superficie (solo sedi con consumi nell'anno)
  const rows = sites.filter((s) => s.totals.kwh > 0).map((s) => ({ site_id: s.site.id, name: s.site.name, kind: s.site.kind, kwh: s.totals.kwh, kwh_m2_anno: s.intensity.kwh_m2_anno, kwh_per_acc: s.intensity.kwh_per_acc, kwh_per_ora: s.intensity.kwh_per_ora, co2: s.totals.co2, cost: s.totals.cost, benchmark: s.benchmark.position }));
  const classifica = { per_accettazione: ranking(rows, 'kwh_per_acc'), per_m2: ranking(rows, 'kwh_m2_anno'), per_ora: ranking(rows, 'kwh_per_ora') };
  // obiettivi: serie in kWh equivalenti (vettore vuoto) o nella quantità del vettore
  const seriesFor = (siteId, vector) => {
    const utils = data.utilities.filter((u) => (siteId == null || u.site_id === siteId) && (!vector || u.vector === vector));
    if (!vector) { const agg = aggregateMonthly(utils, { co2Factors, kwhFactors }); return Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, v.kwh])); }
    const out = {}; for (const u of utils) for (const [k, v] of Object.entries(u.monthly)) if (v.qty != null) out[k] = (out[k] || 0) + v.qty; return out;
  };
  const obiettivi = data.targets.map((t) => ({ ...t, progress: targetProgress({ series: seriesFor(t.site_id, t.vector), year: t.year, baselineYear: t.baseline_year, targetPct: t.target_pct_reduction }) }));
  return { year, sites, network, classifica, obiettivi, anomalie: sites.flatMap((s) => s.anomalies.map((a) => ({ ...a, site_name: s.site.name }))).sort((a, b) => b.month.localeCompare(a.month)),
    benchmark: { bands: BENCHMARK_KWH_M2, source: BENCHMARK_SOURCE }, factors: { co2: co2Factors, kwh: kwhFactors } };
}

// Sintesi energetica di una sede per la scheda immobile
export async function siteEnergySummary(siteId, settings, year) {
  const data = await loadEnergyData({ siteIds: [siteId] });
  if (!data.available) return { available: false };
  const e = buildEnergy(data, settings, year);
  const s = e.sites.find((x) => x.site.id === siteId);
  if (!s) return { available: true, empty: true };
  return { available: true, year, totals: s.totals, prev: s.prev, prev_ytd: s.prev_ytd, delta_kwh_pct: s.delta_kwh_pct, vectors: s.vectors, intensity: s.intensity, benchmark: s.benchmark, anomalies: s.anomalies.slice(0, 5), monthly: s.monthly };
}
