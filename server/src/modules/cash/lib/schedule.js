// Scadenziario strutture: calcolo delle scadenze e della previsione dei costi (funzioni pure, senza database).
// Le scadenze non si salvano: si ricavano ogni volta da contratti di affitto (con gli scatti del canone) e utenze (con le
// bollette registrate). Gli esiti (schedule_done) e gli avvisi (schedule_notified) sono le sole cose persistite.
// Le date sono stringhe 'YYYY-MM-DD' (come le restituisce il db della Suite); l'aritmetica è sui giorni UTC, come nella bozza.

const DAY = 86400000;
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function parseDate(iso) {
  if (!iso) return null;
  const s = typeof iso === 'string' ? iso.slice(0, 10) : new Date(iso).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function toIso(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// Somma di mesi che rispetta il fine mese (31 gen + 1 mese = 28/29 feb)
export function addMonths(t, n) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(day, last));
}
const fmt = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${MESI[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const monthKey = (t) => toIso(t).slice(0, 7);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v == null || v === '' ? null : Number(v));
const low = (s) => (s === 'TARI' ? s : String(s).toLowerCase());

// Occorrenze di una ricorrenza mensile (passo in mesi) a partire da `start`, comprese tra `from` e `to`
export function occurrences(start, step, from, to) {
  const out = [];
  if (start == null || !(step > 0)) return out;
  const s = new Date(start), f = new Date(from);
  const mDiff = (f.getUTCFullYear() - s.getUTCFullYear()) * 12 + (f.getUTCMonth() - s.getUTCMonth());
  let k = mDiff > step ? Math.floor(mDiff / step) - 1 : 0;
  for (let i = 0; i < 1200; i++, k++) {
    const t = addMonths(start, k * step);
    if (t > to) break;
    if (t >= from) out.push(t);
  }
  return out;
}

// Scadenza attuale del contratto: primo periodo, poi rinnovi taciti finché la scadenza non supera oggi
export function contractEnd(lease, today) {
  const d = parseDate(lease.start_date);
  const P = Number(lease.first_term_years) || 0;
  if (d == null || !P) return null;
  let end = addMonths(d, P * 12);
  const R = Number(lease.renewal_years) || 0;
  let renewals = 0;
  if (R > 0) while (end < today && renewals < 60) { end = addMonths(end, R * 12); renewals++; }
  return { end, renewals, expired: end < today };
}

// Canone vigente a una data: ultimo scatto con valid_from <= data (null se nessuno scatto è ancora valido)
export function stepAt(steps, t) {
  let cur = null;
  for (const s of steps) {
    const v = parseDate(s.valid_from);
    if (v != null && v <= t && (cur == null || v >= parseDate(cur.valid_from))) cur = s;
  }
  return cur;
}

const sortSteps = (steps) => [...steps].sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)));
const byId = (rows, key) => { const m = new Map(); for (const r of rows || []) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

// Importo stimato di una bolletta: media delle bollette registrate negli ultimi 12 mesi, altrimenti importo medio dichiarato
export function billEstimate(utility, bills, today) {
  const from = addMonths(today, -12);
  const recent = (bills || []).filter((b) => { const d = parseDate(b.due_date); return d != null && d > from && d <= today; });
  if (recent.length) return { amount: r2(recent.reduce((a, b) => a + Number(b.amount || 0), 0) / recent.length), source: 'bollette', n: recent.length };
  const avg = num(utility.avg_amount);
  return avg != null ? { amount: r2(avg), source: 'media', n: 0 } : { amount: null, source: null, n: 0 };
}

export const UTILITY_LABEL = { ENERGIA: 'Energia elettrica', GAS: 'Gas', ACQUA: 'Acqua', TARI: 'TARI', TELEFONIA: 'Telefonia / Internet', CONDOMINIO: 'Condominio', VIGILANZA: 'Vigilanza', PULIZIE: 'Pulizie', ALTRO: 'Altro' };
export const LEASE_KIND_LABEL = { COMMERCIALE_6_6: 'Commerciale 6+6', COMMERCIALE_9_9: 'Commerciale 9+9', ABITATIVO_4_4: 'Abitativo 4+4', ABITATIVO_3_2: 'Abitativo 3+2', TRANSITORIO: 'Transitorio', COMODATO: 'Comodato', ALTRO: 'Altro' };
export const REGISTRATION_LABEL = { IMPOSTA_ANNUALE: 'Imposta annuale', UNICA_SOLUZIONE: 'Unica soluzione', CEDOLARE_SECCA: 'Cedolare secca', DA_REGISTRARE: 'Da registrare' };
export const TRANSFER_LABEL = { DA_AVVIARE: 'Da avviare', IN_CORSO: 'In corso', COMPLETATA: 'Completata', NON_NECESSARIA: 'Non necessaria' };

// Eventi dello scadenziario tra `from` e `to` (ISO). Ogni evento:
// { key, kind, cat (AFFITTO|UTENZA), site_id, ref (id contratto o utenza), date, title, desc, amount, estimate, auto, done, days }
// kind: canone | istat | registro | fine | disdetta | bolletta | offerta. Scadute = date < oggi, non done, non auto.
export function buildEvents({ leases = [], steps = [], utilities = [], bills = [], done = [], from, to, today }) {
  const T = parseDate(today) ?? parseDate(new Date().toISOString());
  const F = parseDate(from) ?? T - 60 * DAY;
  const TO = parseDate(to) ?? T + 400 * DAY;
  const doneMap = new Map();
  for (const d of done || []) doneMap.set(d.event_key || d.key, d);
  const stepsBy = byId(steps, 'lease_id');
  const billsBy = byId(bills, 'utility_id');
  const out = [];
  const push = (e) => {
    const key = e.key || `${e.kind}:${e.cat === 'AFFITTO' ? 'lease' : 'utility'}:${e.ref}:${toIso(e.t)}`;
    const dn = doneMap.get(key);
    out.push({ key, kind: e.kind, cat: e.cat, site_id: e.site_id, ref: e.ref, date: toIso(e.t), title: e.title, desc: e.desc || '',
      amount: e.amount == null ? null : r2(e.amount), estimate: !!e.estimate, auto: !!e.auto, done: !!dn || !!e.done,
      done_at: dn?.done_at || e.done_at || null, done_amount: dn?.amount != null ? Number(dn.amount) : null, done_note: dn?.note || null,
      bill_id: e.bill_id || null, days: Math.round((e.t - T) / DAY) });
  };

  for (const c of leases) {
    if (c.active === false) continue;
    const base = { cat: 'AFFITTO', site_id: c.site_id, ref: c.id };
    const who = [c.unit, c.landlord_name].filter(Boolean).join(' · ');
    const lsteps = sortSteps(stepsBy.get(c.id) || []);
    const step = Number(c.period_months) || 1;
    const start = parseDate(c.first_due) ?? parseDate(c.start_date);
    const ce = contractEnd(c, T);
    const stop = ce && ce.expired ? ce.end : TO;
    const per = { 1: 'mensile', 2: 'bimestrale', 3: 'trimestrale', 6: 'semestrale', 12: 'annuale' }[step] || '';
    for (const t of occurrences(start, step, F, Math.min(TO, stop))) {
      const s = stepAt(lsteps, t);
      push({ ...base, kind: 'canone', t, title: `Canone di affitto ${per}`.trim(), desc: who, amount: s ? Number(s.amount) : null, auto: !!c.auto_pay });
    }
    const d0 = parseDate(c.start_date);
    if (d0 != null && c.istat) for (const t of occurrences(addMonths(d0, 12), 12, F, TO)) push({ ...base, kind: 'istat', t, title: 'Adeguamento ISTAT', desc: who || 'Aggiorna il canone all\'indice FOI e registra il nuovo scatto' });
    if (d0 != null && c.registration === 'IMPOSTA_ANNUALE') {
      for (const t of occurrences(addMonths(d0, 12), 12, F - 30 * DAY, TO)) {
        const due = t + 30 * DAY;
        if (due < F || due > TO) continue;
        const s = stepAt(lsteps, t);
        const annual = s ? Number(s.amount) * (12 / step) : null;
        push({ ...base, kind: 'registro', t: due, title: 'Imposta di registro annuale', desc: `Entro 30 giorni dall'annualità (${fmt(t)}) · F24 ELIDE`, amount: annual != null ? Math.max(67, r2(annual * 0.02)) : null, estimate: true });
      }
    }
    if (ce) {
      // la scadenza compare nel periodo; un contratto scaduto senza rinnovo compare sempre (da gestire: rinnovo, chiusura o cessazione)
      if ((ce.end >= F && ce.end <= TO) || ce.expired) {
        const R = Number(c.renewal_years) || 0;
        push({ ...base, kind: 'fine', t: ce.end, title: ce.expired ? 'Contratto scaduto' : 'Scadenza contratto', desc: [LEASE_KIND_LABEL[c.kind] || c.kind, ce.renewals ? `rinnovato ${ce.renewals} ${ce.renewals === 1 ? 'volta' : 'volte'}` : null, R ? `poi rinnovo tacito di ${R} anni` : 'nessun rinnovo automatico'].filter(Boolean).join(' · ') });
      }
      const pm = Number(c.notice_months) || 0;
      if (pm) {
        const dd = addMonths(ce.end, -pm);
        if (dd >= F && dd <= TO) push({ ...base, kind: 'disdetta', t: dd, title: 'Termine invio disdetta', desc: `Preavviso di ${pm} mesi rispetto alla scadenza del ${fmt(ce.end)}` });
      }
    }
  }

  for (const u of utilities) {
    if (u.active === false) continue;
    const base = { cat: 'UTENZA', site_id: u.site_id, ref: u.id };
    const label = UTILITY_LABEL[u.kind] || u.kind || 'utenza';
    const who = [label, u.supplier_name].filter(Boolean).join(' · ') + (u.code ? ` · ${u.code}` : '');
    const ubills = billsBy.get(u.id) || [];
    const est = billEstimate(u, ubills, T);
    // bollette registrate nel periodo: importo reale, fatta se pagata
    const regMonths = new Set();
    let lastReg = null;
    for (const b of ubills) {
      const d = parseDate(b.due_date);
      if (d == null) continue;
      if (lastReg == null || d > lastReg) lastReg = d;
      if (d < F || d > TO) continue;
      regMonths.add(monthKey(d));
      push({ ...base, kind: 'bolletta', t: d, key: `bolletta:utility:${u.id}:${toIso(d)}`, bill_id: b.id, title: `Bolletta ${low(label)}`, desc: who + (b.period_from && b.period_to ? ` · periodo ${fmt(parseDate(b.period_from))} – ${fmt(parseDate(b.period_to))}` : ''), amount: Number(b.amount), auto: !!u.auto_pay, done: !!b.paid_at, done_at: b.paid_at || null });
    }
    // bollette attese: dalla scadenza nota, saltando i mesi con una bolletta registrata e quelle precedenti all'ultima registrata
    const r = parseDate(u.ref_due);
    if (r != null) {
      for (const t of occurrences(r, Number(u.period_months) || 1, F, TO)) {
        if (regMonths.has(monthKey(t))) continue;
        if (lastReg != null && t <= lastReg) continue;
        push({ ...base, kind: 'bolletta', t, title: `Pagamento ${low(label)}`, desc: who + (est.source === 'bollette' ? ` · stima sulla media di ${est.n} bollette` : est.source === 'media' ? ' · stima sull\'importo medio' : ''), amount: est.amount, estimate: true, auto: !!u.auto_pay });
      }
    }
    const f = parseDate(u.offer_end);
    if (f != null && f >= F && f <= TO) push({ ...base, kind: 'offerta', t: f, title: `Fine offerta ${low(label)}`, desc: who + ' · valuta rinnovo o cambio offerta' });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.ref - b.ref);
}

export const isOverdue = (e) => e.days < 0 && !e.done && !e.auto;

// Indicatori della striscia in alto (sugli eventi già filtrati per sede e perimetro)
export function kpis({ events, leases = [], steps = [], utilities = [], today }) {
  const T = parseDate(today);
  const overdue = events.filter(isOverdue);
  const next30 = events.filter((e) => e.days >= 0 && e.days <= 30 && !e.done);
  const notices = events.filter((e) => e.kind === 'disdetta' && e.days >= 0 && e.days <= 180 && !e.done);
  const stepsBy = byId(steps, 'lease_id');
  let monthly = 0, activeLeases = 0;
  for (const c of leases) {
    if (c.active === false) continue;
    const ce = contractEnd(c, T);
    if (ce && ce.expired) continue;
    activeLeases++;
    const s = stepAt(sortSteps(stepsBy.get(c.id) || []), T);
    if (s) monthly += Number(s.amount) / (Number(c.period_months) || 1);
  }
  const transfers = utilities.filter((u) => u.active !== false && ['DA_AVVIARE', 'IN_CORSO'].includes(u.transfer_status));
  return { overdue: overdue.length, overdue_amount: r2(overdue.reduce((a, e) => a + (e.amount || 0), 0)), next30: next30.length, next30_amount: r2(next30.reduce((a, e) => a + (e.amount || 0), 0)),
    notices: notices.length, first_notice: notices[0]?.date || null, transfers_open: transfers.length, monthly_rent: r2(monthly), leases_active: activeLeases, utilities_active: utilities.filter((u) => u.active !== false).length };
}

// Previsione dei costi per i prossimi N mesi, per sede: affitti (rata vigente ripartita per mese, rivalutazione ISTAT ipotetica
// dal prossimo anniversario se istat, imposta di registro, nulla dopo la scadenza senza rinnovo) + utenze (media mensile reale o
// stimata con crescita ipotetica annua). Confronto con i 12 mesi precedenti registrati (bollette pagate + rate segnate fatte).
export function forecast({ leases = [], steps = [], utilities = [], bills = [], done = [], settings = {}, months = 12, today }) {
  const T = parseDate(today) ?? parseDate(new Date().toISOString());
  const N = Math.max(1, Math.min(36, Number(months) || 12));
  const istatPct = Number(settings.istat_pct ?? settings.schedule_istat_pct ?? 1.5) || 0;
  const growthPct = Number(settings.utility_growth_pct ?? settings.schedule_utility_growth_pct ?? 0) || 0;
  const m0 = Date.UTC(new Date(T).getUTCFullYear(), new Date(T).getUTCMonth(), 1);
  const cols = Array.from({ length: N }, (_, i) => monthKey(addMonths(m0, i)));
  const stepsBy = byId(steps, 'lease_id');
  const billsBy = byId(bills, 'utility_id');
  const siteIds = [...new Set([...leases, ...utilities].map((x) => x.site_id))].sort((a, b) => a - b);
  const zero = () => cols.map(() => 0);
  const sites = new Map(siteIds.map((id) => [id, { site_id: id, rent: zero(), registry: zero(), utilities: zero(), total: zero(), leases: [], utilities_detail: [] }]));

  for (const c of leases) {
    if (c.active === false) continue;
    const S = sites.get(c.site_id);
    const lsteps = sortSteps(stepsBy.get(c.id) || []);
    const period = Number(c.period_months) || 1;
    const ce = contractEnd(c, T);
    const d0 = parseDate(c.start_date);
    // anniversari futuri (dal prossimo >= oggi) ai quali applicare la rivalutazione ipotetica
    const anniversaries = [];
    if (d0 != null) for (let k = 1; k < 60; k++) { const a = addMonths(d0, 12 * k); if (a > addMonths(m0, N)) break; if (a >= T) anniversaries.push(a); }
    const row = { id: c.id, unit: c.unit, landlord_name: c.landlord_name, monthly: zero(), end: ce ? toIso(ce.end) : null, renews: !!(Number(c.renewal_years) || 0) };
    cols.forEach((mk, i) => {
      const mid = addMonths(m0, i) + 14 * DAY;      // metà mese
      // nessun costo dopo la scadenza senza rinnovo
      if (ce && !(Number(c.renewal_years) > 0) && mid > ce.end) return;
      if (d0 != null && mid < d0) return;
      const s = stepAt(lsteps, mid);
      if (!s) return;
      let amount = Number(s.amount) / period;
      if (c.istat && istatPct) {
        const stepFrom = parseDate(s.valid_from);
        const passed = anniversaries.filter((a) => a <= mid && a > stepFrom).length;
        amount *= Math.pow(1 + istatPct / 100, passed);
      }
      row.monthly[i] = r2(amount);
      S.rent[i] = r2(S.rent[i] + amount);
      if (c.registration === 'IMPOSTA_ANNUALE' && d0 != null) {
        // imposta di registro: 2% del canone annuo (minimo 67 euro), entro 30 giorni dall'annualità
        for (let k = 1; k < 60; k++) { const a = addMonths(d0, 12 * k); if (a > addMonths(m0, N)) break; if (monthKey(a + 30 * DAY) === mk) S.registry[i] = r2(S.registry[i] + Math.max(67, amount * 12 * 0.02)); }
      }
    });
    S.leases.push(row);
  }

  for (const u of utilities) {
    if (u.active === false) continue;
    const S = sites.get(u.site_id);
    const est = billEstimate(u, billsBy.get(u.id) || [], T);
    const period = Number(u.period_months) || 1;
    const monthly = est.amount != null ? est.amount / period : 0;
    const row = { id: u.id, kind: u.kind, supplier_name: u.supplier_name, monthly: zero(), source: est.source };
    cols.forEach((_, i) => {
      const v = monthly * Math.pow(1 + growthPct / 100, i / 12);
      row.monthly[i] = r2(v);
      S.utilities[i] = r2(S.utilities[i] + v);
    });
    S.utilities_detail.push(row);
  }

  const totals = { rent: zero(), registry: zero(), utilities: zero(), total: zero() };
  for (const S of sites.values()) {
    cols.forEach((_, i) => {
      S.total[i] = r2(S.rent[i] + S.registry[i] + S.utilities[i]);
      totals.rent[i] = r2(totals.rent[i] + S.rent[i]); totals.registry[i] = r2(totals.registry[i] + S.registry[i]);
      totals.utilities[i] = r2(totals.utilities[i] + S.utilities[i]); totals.total[i] = r2(totals.total[i] + S.total[i]);
    });
    S.sum = r2(S.total.reduce((a, b) => a + b, 0));
  }
  const sum = (arr) => r2(arr.reduce((a, b) => a + b, 0));

  // 12 mesi precedenti registrati: bollette pagate (per mese di pagamento) + rate di canone e imposte segnate fatte
  const pcols = Array.from({ length: 12 }, (_, i) => monthKey(addMonths(m0, i - 12)));
  const prev = { months: pcols, rent: pcols.map(() => 0), utilities: pcols.map(() => 0), total: pcols.map(() => 0), sites: new Map(siteIds.map((id) => [id, { rent: pcols.map(() => 0), utilities: pcols.map(() => 0) }])) };
  const idx = (mk) => pcols.indexOf(mk);
  for (const b of bills) {
    const u = utilities.find((x) => x.id === b.utility_id);
    if (!u || !b.paid_at) continue;
    const i = idx(String(b.paid_at).slice(0, 7));
    if (i < 0) continue;
    prev.utilities[i] = r2(prev.utilities[i] + Number(b.amount));
    const S = prev.sites.get(u.site_id); if (S) S.utilities[i] = r2(S.utilities[i] + Number(b.amount));
  }
  const past = buildEvents({ leases, steps, utilities, bills: [], done, from: toIso(addMonths(m0, -12)), to: toIso(m0 - DAY), today });
  for (const e of past) {
    if (e.cat !== 'AFFITTO' || !e.done || !['canone', 'registro'].includes(e.kind)) continue;
    const amount = e.done_amount ?? e.amount ?? 0;
    const i = idx(e.date.slice(0, 7));
    if (i < 0) continue;
    prev.rent[i] = r2(prev.rent[i] + amount);
    const S = prev.sites.get(e.site_id); if (S) S.rent[i] = r2(S.rent[i] + amount);
  }
  pcols.forEach((_, i) => { prev.total[i] = r2(prev.rent[i] + prev.utilities[i]); });

  return {
    today: toIso(T), months: cols, assumptions: { istat_pct: istatPct, utility_growth_pct: growthPct, registry_pct: 2, registry_min: 67 },
    sites: [...sites.values()],
    totals: { ...totals, sum_rent: sum(totals.rent), sum_registry: sum(totals.registry), sum_utilities: sum(totals.utilities), sum: sum(totals.total) },
    previous: { months: pcols, rent: prev.rent, utilities: prev.utilities, total: prev.total, sum_rent: sum(prev.rent), sum_utilities: sum(prev.utilities), sum: sum(prev.total),
      sites: [...prev.sites.entries()].map(([site_id, v]) => ({ site_id, ...v, sum: sum(v.rent) + sum(v.utilities) })) },
  };
}
