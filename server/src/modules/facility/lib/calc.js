// Funzioni pure del modulo Facility e Manutenzioni (nessun accesso al database: testate in server/test/facility.test.mjs).
// Date in formato ISO AAAA-MM-GG trattate in UTC (mezzanotte), mesi come chiave AAAA-MM.
//  - scadenze: prima scadenza, successiva alla chiusura, serie di un dispositivo, stato effettivo, promemoria 30/7/0 giorni
//  - interventi: SLA per priorità, transizioni di stato, MTTR, rispetto delle scadenze
//  - energia: consumi mensili da bollette (ripartite pro rata sui giorni del periodo) e da letture, CO2, kWh equivalenti,
//    indicatori di intensità, confronto anno su anno, anomalie, classifica tra sedi, obiettivi, fasce di benchmark

// ------------------------------------------------------------------ date
const DAY = 86_400_000;
export function parseIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export const toIso = (t) => (t == null ? null : new Date(t).toISOString().slice(0, 10));
export const isoOf = (v) => toIso(parseIso(v));
export function addMonths(iso, n) {
  const t = parseIso(iso); if (t == null) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + Number(n), day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();      // fine mese: 31/01 + 1 mese = 28 o 29/02
  return toIso(Date.UTC(y, m, Math.min(day, last)));
}
export const addDays = (iso, n) => toIso(parseIso(iso) + Number(n) * DAY);
export const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / DAY);   // b - a in giorni
export const monthKey = (iso) => String(isoOf(iso) || '').slice(0, 7);
export const monthStart = (iso) => `${monthKey(iso)}-01`;
export const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const prevYearKey = (key) => `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`;
export function monthsOfYear(year) { return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`); }
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// ------------------------------------------------------------------ scadenze
/**
 * Prima scadenza di una serie: la data indicata (es. "prossimo controllo" dalla scheda), altrimenti installazione + periodicità;
 * se quella data è già passata (storia dei controlli sconosciuta) la scadenza è oggi: il controllo va fatto e registrato.
 */
export function firstDue({ explicit, installedAt, intervalMonths, today }) {
  if (explicit) return isoOf(explicit);
  if (installedAt && intervalMonths) {
    const d = addMonths(installedAt, intervalMonths);
    return parseIso(d) < parseIso(today) ? isoOf(today) : d;
  }
  return isoOf(today);
}
/** Successiva alla chiusura: dalla data di esecuzione effettiva (prassi dei registri antincendio e delle verifiche periodiche) */
export const nextDue = (doneAt, intervalMonths) => (intervalMonths ? addMonths(doneAt, intervalMonths) : null);

/** Serie di scadenze di un dispositivo dal catalogo (con le periodicità proprie del dispositivo che prevalgono) */
export function streamsFor(asset, type) {
  if (!type) return [];
  const pick = (own, cat) => (own != null && own !== '' ? Number(own) : cat != null ? Number(cat) : null);
  const surv = pick(asset.surveillance_months, type.surveillance_months);
  const chk = pick(asset.check_interval_months, type.check_interval_months);
  const man = pick(asset.maintenance_interval_months, type.maintenance_interval_months);
  const nome = asset.name || type.name;
  const out = [];
  if (surv) out.push({ stream: 'SORVEGLIANZA', kind: 'CONTROLLO', performer: 'SEDE', interval_months: surv, title: `Sorveglianza di sede · ${nome}` });
  if (chk) out.push({ stream: 'CONTROLLO', kind: type.check_kind === 'VERIFICA_NORMATIVA' ? 'VERIFICA_NORMATIVA' : 'CONTROLLO', performer: type.check_kind === 'VERIFICA_NORMATIVA' ? 'ENTE' : 'MANUTENTORE', interval_months: chk, title: `${type.check_kind === 'VERIFICA_NORMATIVA' ? 'Verifica periodica' : 'Controllo periodico'} · ${nome}` });
  if (man) out.push({ stream: 'MANUTENZIONE', kind: 'MANUTENZIONE', performer: 'MANUTENTORE', interval_months: man, title: `Manutenzione · ${nome}` });
  return out;
}
/** Tipo di scadenza di un obbligo dell'immobile */
export const obligationPlanKind = (kind) => (kind === 'NORMATIVO' ? 'VERIFICA_NORMATIVA' : 'CONTROLLO');

/** Stato effettivo di una scadenza aperta: scaduta se la data è passata, altrimenti pianificata (anche se un job l'aveva segnata
 *  scaduta e poi è stata spostata in avanti); eseguite e annullate restano tali */
export function effectiveStatus(plan, today) {
  if (!['PIANIFICATA', 'SCADUTA'].includes(plan.status)) return plan.status;
  return parseIso(plan.due_date) < parseIso(today) ? 'SCADUTA' : 'PIANIFICATA';
}

/**
 * Promemoria a 30, 7 e 0 giorni, mai doppi: restituisce lo stadio da inviare (il più urgente raggiunto e non ancora inviato) e gli
 * stadi meno urgenti da segnare come inviati insieme (una scadenza nata a 5 giorni riceve solo D7, e D30 non partirà più).
 * days = giorni alla scadenza (negativi = scaduta).
 */
export function reminderStage(days, sent = [], thresholds = [30, 7, 0]) {
  const ths = [...thresholds].map(Number).sort((a, b) => b - a);            // 30, 7, 0
  const reached = ths.filter((t) => days <= t);
  if (!reached.length) return null;
  const stage = `D${reached[reached.length - 1]}`;                         // il più urgente raggiunto
  if (sent.includes(stage)) return null;
  return { stage, mark: reached.map((t) => `D${t}`).filter((s) => !sent.includes(s)) };
}

// ------------------------------------------------------------------ interventi
export const SLA_DEFAULT = { URGENTE: 24, ALTA: 72, MEDIA: 240, BASSA: 720 };
export function slaDueAt(openedAt, priority, slaHours = SLA_DEFAULT) {
  const h = Number((slaHours || SLA_DEFAULT)[priority] ?? SLA_DEFAULT[priority] ?? 240);
  return new Date(new Date(openedAt).getTime() + h * 3_600_000).toISOString();
}
/** Stato dello SLA: ore residue (negative = in ritardo); per un intervento chiuso, se è stato chiuso entro la scadenza */
export function slaState(wo, now = new Date()) {
  if (!wo.due_at) return { late: false, hours_left: null };
  const due = new Date(wo.due_at).getTime();
  const end = wo.closed_at ? new Date(wo.closed_at).getTime() : new Date(now).getTime();
  const left = (due - end) / 3_600_000;
  return { late: left < 0, hours_left: round(left, 1), closed: Boolean(wo.closed_at) };
}
export const WO_FLOW = {
  APERTO: ['ASSEGNATO', 'IN_CORSO', 'CHIUSO'],
  ASSEGNATO: ['IN_CORSO', 'SOSPESO', 'CHIUSO', 'APERTO'],
  IN_CORSO: ['SOSPESO', 'CHIUSO', 'ASSEGNATO'],
  SOSPESO: ['IN_CORSO', 'CHIUSO', 'ASSEGNATO'],
  CHIUSO: ['IN_CORSO'],                                                    // riapertura
};
export const canTransition = (from, to) => Boolean(WO_FLOW[from]?.includes(to));
/** MTTR (tempo medio di ripristino) in ore sugli interventi chiusi: chiusura meno apertura */
export function mttrHours(wos) {
  const closed = wos.filter((w) => w.closed_at && w.opened_at);
  if (!closed.length) return null;
  const tot = closed.reduce((a, w) => a + (new Date(w.closed_at) - new Date(w.opened_at)) / 3_600_000, 0);
  return round(tot / closed.length, 1);
}
/** Scadenze rispettate: quota delle eseguite entro la data di scadenza (in %) */
export function onTimeRate(plans) {
  const done = plans.filter((p) => p.status === 'ESEGUITA' && p.done_at);
  if (!done.length) return null;
  return round((done.filter((p) => parseIso(p.done_at) <= parseIso(p.due_date)).length / done.length) * 100, 1);
}

// ------------------------------------------------------------------ energia: consumi mensili
/** Ripartisce un valore sui mesi del periodo [from, to] (estremi compresi) in proporzione ai giorni */
export function spreadByMonth(from, to, value) {
  const a = parseIso(from), b = parseIso(to);
  if (a == null || b == null || b < a || value == null) return {};
  const tot = (b - a) / DAY + 1;
  const out = {};
  for (let t = a; t <= b; t += DAY) { const k = toIso(t).slice(0, 7); out[k] = (out[k] || 0) + Number(value) / tot; }
  return out;
}
/**
 * Bollette → mesi: consumo e importo ripartiti sul periodo di fatturazione; senza periodo, tutto nel mese di fine periodo o, in
 * mancanza, nel mese precedente la scadenza di pagamento (le bollette si pagano dopo il periodo consumato).
 */
export function billsToMonthly(bills) {
  const out = {};
  for (const b of bills) {
    let parts;
    if (b.period_from && b.period_to) {
      const qty = spreadByMonth(b.period_from, b.period_to, b.consumption == null ? 0 : Number(b.consumption));
      const cost = spreadByMonth(b.period_from, b.period_to, Number(b.amount || 0));
      parts = Object.keys(cost).map((k) => [k, b.consumption == null ? null : qty[k], cost[k]]);
    } else {
      const k = b.period_to ? monthKey(b.period_to) : monthKey(addMonths(b.due_date, -1));
      parts = [[k, b.consumption == null ? null : Number(b.consumption), Number(b.amount || 0)]];
    }
    for (const [k, qty, cost] of parts) {
      const o = out[k] || (out[k] = { qty: null, cost: 0 });
      if (qty != null) o.qty = (o.qty || 0) + qty;
      o.cost += cost;
    }
  }
  return out;
}
/** Letture del contatore → mesi: differenza tra letture consecutive ripartita sui giorni tra le due (azzeramenti scartati) */
export function readingsToMonthly(readings) {
  const rs = [...readings].filter((r) => r.read_at && r.value != null).sort((a, b) => parseIso(a.read_at) - parseIso(b.read_at));
  const out = {};
  for (let i = 1; i < rs.length; i++) {
    const delta = Number(rs[i].value) - Number(rs[i - 1].value);
    if (delta < 0) continue;                                                // contatore sostituito o azzerato
    const parts = spreadByMonth(addDays(rs[i - 1].read_at, 1), rs[i].read_at, delta);
    for (const [k, v] of Object.entries(parts)) out[k] = (out[k] || 0) + v;
  }
  return out;
}
/**
 * Serie mensile di un'utenza: consumi dalle bollette se riportano il consumo, altrimenti dalle letture; costi sempre dalle bollette.
 * Ritorna { 'AAAA-MM': { qty, cost, source } }.
 */
export function utilityMonthly(bills = [], readings = []) {
  const fromBills = billsToMonthly(bills);
  const billQty = bills.some((b) => b.consumption != null);
  const fromRead = billQty ? {} : readingsToMonthly(readings);
  const keys = new Set([...Object.keys(fromBills), ...Object.keys(fromRead)]);
  const out = {};
  for (const k of keys) {
    const qty = billQty ? fromBills[k]?.qty ?? null : fromRead[k] ?? null;
    out[k] = { qty: qty == null ? null : round(qty, 3), cost: fromBills[k] ? round(fromBills[k].cost, 2) : null, source: billQty ? 'BOLLETTE' : (fromRead[k] != null ? 'LETTURE' : 'BOLLETTE') };
  }
  return out;
}
export const co2Kg = (qty, vector, factors = {}, override = null) => (qty == null ? null : round(Number(qty) * Number(override ?? factors[vector] ?? 0), 2));
export const kwhEq = (qty, vector, factors = {}) => (qty == null ? null : round(Number(qty) * Number(factors[vector] ?? 0), 2));
/** Costo unitario (€/kWh, €/Smc, €/m3) */
export const unitCost = (cost, qty) => (cost == null || !qty ? null : round(Number(cost) / Number(qty), 4));

/**
 * Totali per mese di un insieme di utenze: per vettore (qty, cost) e in kWh equivalenti e CO2.
 * utilities: [{ vector, co2_factor, monthly: { 'AAAA-MM': { qty, cost } } }]
 */
export function aggregateMonthly(utilities, { co2Factors = {}, kwhFactors = {} } = {}) {
  const out = {};
  for (const u of utilities) {
    for (const [k, v] of Object.entries(u.monthly || {})) {
      const o = out[k] || (out[k] = { kwh: 0, co2: 0, cost: 0, by_vector: {} });
      const bv = o.by_vector[u.vector] || (o.by_vector[u.vector] = { qty: 0, cost: 0 });
      if (v.qty != null) { bv.qty += v.qty; o.kwh += kwhEq(v.qty, u.vector, kwhFactors) || 0; o.co2 += co2Kg(v.qty, u.vector, co2Factors, u.co2_factor) || 0; }
      if (v.cost != null) { bv.cost += v.cost; o.cost += v.cost; }
    }
  }
  for (const o of Object.values(out)) { o.kwh = round(o.kwh, 2); o.co2 = round(o.co2, 2); o.cost = round(o.cost, 2); for (const b of Object.values(o.by_vector)) { b.qty = round(b.qty, 3); b.cost = round(b.cost, 2); } }
  return out;
}

/**
 * Confronto anno su anno di una serie mensile { 'AAAA-MM': numero }: per ogni mese dell'anno valore, anno precedente e variazione %;
 * cumulato da inizio anno fino all'ultimo mese con dati nell'anno (stessi mesi dell'anno precedente).
 */
export function yoy(series, year) {
  const pct = (a, b) => (a == null || !b ? null : round(((a - b) / b) * 100, 1));
  const months = monthsOfYear(year).map((k) => {
    const cur = series[k] ?? null, prev = series[prevYearKey(k)] ?? null;
    return { month: k, cur, prev, delta_pct: pct(cur, prev) };
  });
  const lastIdx = months.reduce((a, m, i) => (m.cur != null ? i : a), -1);
  const ytd = months.slice(0, lastIdx + 1);
  const cumCur = ytd.reduce((a, m) => a + (m.cur || 0), 0);
  const cumPrev = ytd.reduce((a, m) => a + (m.prev || 0), 0);
  return { months, ytd: { months: ytd.length, cur: round(cumCur, 2), prev: ytd.some((m) => m.prev != null) ? round(cumPrev, 2) : null, delta_pct: ytd.some((m) => m.prev != null) ? pct(cumCur, cumPrev) : null } };
}

/**
 * Anomalie di una serie mensile: mese oltre +pct% rispetto allo stesso mese dell'anno precedente oppure alla media mobile dei tre
 * mesi precedenti (servono tre mesi). Si ignorano i valori sotto minValue (rumore delle piccole utenze).
 */
export function anomalies(series, { pct = 20, minValue = 0 } = {}) {
  const keys = Object.keys(series).filter((k) => series[k] != null).sort();
  const out = [];
  for (const k of keys) {
    const v = Number(series[k]);
    if (!(v > minValue)) continue;
    const refs = [];
    const py = series[prevYearKey(k)];
    if (py != null && py > 0) refs.push({ ref_kind: 'ANNO_PRECEDENTE', ref: Number(py) });
    const [y, m] = k.split('-').map(Number);
    const prev3 = [1, 2, 3].map((i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return series[d.toISOString().slice(0, 7)]; });
    if (prev3.every((x) => x != null)) { const avg = prev3.reduce((a, b) => a + Number(b), 0) / 3; if (avg > 0) refs.push({ ref_kind: 'MEDIA_MOBILE', ref: avg }); }
    const hits = refs.map((r) => ({ ...r, delta_pct: round(((v - r.ref) / r.ref) * 100, 1) })).filter((r) => r.delta_pct > pct);
    if (hits.length) {
      const top = hits.sort((a, b) => b.delta_pct - a.delta_pct)[0];
      out.push({ month: k, value: round(v, 2), ref: round(top.ref, 2), ref_kind: top.ref_kind, delta_pct: top.delta_pct, refs: hits.map((h) => h.ref_kind) });
    }
  }
  return out;
}

/** Ore di apertura del mese stimate dalle ore settimanali dell'immobile */
export const estimateOpeningHours = (hoursWeek, key) => (hoursWeek ? round((Number(hoursWeek) * daysInMonth(key)) / 7, 1) : null);

/**
 * Indicatori di intensità: kWh/m2 (anno; annualizzato se i mesi con dati sono meno di 12), kWh per accettazione, kWh per ora di
 * apertura, kgCO2/m2. months = mesi con consumo.
 */
export function intensity({ kwh, co2 = null, sqm, accettazioni, ore, months = 12 }) {
  const k = kwh == null ? null : Number(kwh);
  const annual = k != null && months > 0 ? (k * 12) / months : null;
  return {
    kwh: round(k, 1),
    kwh_m2: k != null && sqm ? round(k / Number(sqm), 1) : null,
    kwh_m2_anno: annual != null && sqm ? round(annual / Number(sqm), 1) : null,
    kwh_per_acc: k != null && accettazioni ? round(k / Number(accettazioni), 2) : null,
    kwh_per_ora: k != null && ore ? round(k / Number(ore), 2) : null,
    co2_m2: co2 != null && sqm ? round(Number(co2) / Number(sqm), 2) : null,
    annualizzato: months > 0 && months < 12,
  };
}

/** Classifica tra sedi per un indicatore (più basso = più efficiente); le sedi senza dato restano in fondo senza posizione */
export function ranking(rows, key) {
  const withV = rows.filter((r) => r[key] != null).sort((a, b) => a[key] - b[key]);
  const media = withV.length ? withV.reduce((a, r) => a + r[key], 0) / withV.length : null;
  return [...withV.map((r, i) => ({ ...r, rank: i + 1, vs_media_pct: media ? round(((r[key] - media) / media) * 100, 1) : null })), ...rows.filter((r) => r[key] == null).map((r) => ({ ...r, rank: null, vs_media_pct: null }))];
}

/** Fascia di benchmark indicativa per tipologia di sede e posizione del valore (kWh/m2 anno) */
export function benchmarkPosition(bands, kind, kwhM2) {
  const b = bands[kind] || bands.ALTRO;
  if (!b || kwhM2 == null) return { band: b || null, position: null };
  return { band: b, position: kwhM2 < b.min ? 'SOTTO' : kwhM2 > b.max ? 'SOPRA' : 'NELLA_FASCIA' };
}

/**
 * Obiettivo di riduzione: confronto tra gli stessi mesi dell'anno obiettivo e dell'anno base (i mesi dell'anno in corso con dati).
 * Riduzione ottenuta in % e stato: RAGGIUNTO (≥ obiettivo), IN_LINEA (≥ metà dell'obiettivo), FUORI_LINEA, NESSUN_DATO.
 */
export function targetProgress({ series, year, baselineYear, targetPct }) {
  const cur = monthsOfYear(year).filter((k) => series[k] != null);
  if (!cur.length) return { status: 'NESSUN_DATO', months: 0, cur: null, base: null, reduction_pct: null, target_pct: Number(targetPct) };
  const baseKeys = cur.map((k) => `${baselineYear}${k.slice(4)}`).filter((k) => series[k] != null);
  if (!baseKeys.length) return { status: 'NESSUN_DATO', months: cur.length, cur: null, base: null, reduction_pct: null, target_pct: Number(targetPct) };
  const sameCur = cur.filter((k) => series[`${baselineYear}${k.slice(4)}`] != null);
  const c = sameCur.reduce((a, k) => a + Number(series[k]), 0);
  const b = baseKeys.reduce((a, k) => a + Number(series[k]), 0);
  const red = b ? round(((b - c) / b) * 100, 1) : null;
  const t = Number(targetPct);
  const status = red == null ? 'NESSUN_DATO' : red >= t ? 'RAGGIUNTO' : red >= t / 2 ? 'IN_LINEA' : 'FUORI_LINEA';
  return { status, months: sameCur.length, cur: round(c, 1), base: round(b, 1), reduction_pct: red, target_pct: t };
}

/** Codice dell'intervento: WO-AAAA-NNNN */
export const workOrderCode = (year, n) => `WO-${year}-${String(n).padStart(4, '0')}`;
