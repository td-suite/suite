// Cockpit direzionale · Monitor (parole del CEO, 08/11/2026: "Immaginati che io proietto il cockpit su un monitor fisso! e deve
// aggiornarsi ogni 5 minuti. Deve riportare una sintesi delle scadenze della settimana in corso e della prossima. Poi tutti indicatori
// numerici"). Un solo JSON per la pagina /cockpit: { generato_at, oggi, scadenze, indicatori, gruppi, fonti }.
//
// Regole (stessa tecnica safe() del Cockpit, lib/legacy.js): ogni fonte di un modulo si legge solo se il modulo è LIVE nella Suite, con
// il pool del modulo (search_path = <modulo>, public). Modulo non LIVE o lettura fallita = indicatore con non_disponibile: true e il
// motivo, mai uno zero finto. Il risultato resta in cache in memoria per 60 secondi (la pagina lo chiede ogni 5 minuti; più monitor
// non moltiplicano le query). Le scadenze vengono da scadenzeDirezione (lib/scadenzario.js), senza le viste ("Segna come vista" vale
// solo nello scadenzario completo); le righe dei moduli riservati si filtrano per utente dopo la cache (visibiliA).
// Indicatori, fonti, formule e ipotesi: docs/COCKPIT.md, sezione "Monitor". Test: server/test/cockpit-monitor.test.mjs.
import { many } from '../db.js';
import { getModuleState, moduleDb } from './modules.js';
import { scadenzeDirezione, visibiliA, settimana, addGiorni, addMesi, fineMese, oggiRoma, itData, ordina, MODULI_RISERVATI, GRAVITA } from './scadenzario.js';

// ------------------------------------------------------------------ costanti
export const GRUPPI = [
  { key: 'INCASSI', titolo: 'Incassi' },
  { key: 'RICAVI_COSTI', titolo: 'Ricavi e costi' },
  { key: 'FINANCE', titolo: 'Processi finance' },
  { key: 'OPERATIONS', titolo: 'Operations' },
  { key: 'RETAIL_FLOW', titolo: 'Retail e Flow' },
  { key: 'PERSONE', titolo: 'Persone e qualità' },
];
export const NOMI_MODULI = {
  cash: 'Cash Management', retail: 'Retail Assistant', finance: 'Finance Management', nc: 'Non conformità', orders: 'Ordini e Magazzino',
  shipments: 'Spedizioni e Kit', referti: 'Referti esterni', room: 'Room Planning', business: 'Business Hub', ferie: 'Piano Ferie',
  audit: 'Audit SGI', ticket: 'Ticket', circolari: 'Circolari', core: 'Anagrafica della Suite',
};
export const MAX_RIGHE_SCADENZE = 8;     // righe per blocco nella pagina; il resto è "+N altre"
export const CACHE_MS = 60_000;
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const STATI_CASH = `('CLOSED','PROCESSED','PICKED_UP','VERIFIED','DEPOSITED')`;   // rendiconti chiusi o successivi (non DRAFT)

// ------------------------------------------------------------------ funzioni pure (testate)
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const eur = (v) => Number(v || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const ggmm = (d) => (d ? itData(d).slice(0, 5) : '');
export const etichettaMese = (mk) => `${MESI_BREVI[Number(mk.slice(5, 7)) - 1]} ${mk.slice(2, 4)}`;

/** Settimana in corso (da lunedì a domenica, comprese le scadute dei giorni già passati) e prossima settimana, anche a cavallo d'anno. */
export function settimaneMonitor(oggi) {
  const lun = settimana(oggi).chiave;
  const dom = addGiorni(lun, 6);
  const lun2 = addGiorni(lun, 7);
  const dom2 = addGiorni(lun, 13);
  const et = (a, b) => `dal ${itData(a).slice(0, 5)} al ${itData(b)}`;
  return { corrente: { key: 'corrente', titolo: 'Questa settimana', da: lun, a: dom, periodo: et(lun, dom) }, prossima: { key: 'prossima', titolo: 'Prossima settimana', da: lun2, a: dom2, periodo: et(lun2, dom2) } };
}

/** Blocco di scadenze di una settimana: conteggi per gravità (e scadute) ed elenco ordinato per data (righe dello scadenzario). */
export function bloccoScadenze(righe, sett, max = MAX_RIGHE_SCADENZE) {
  const dentro = ordina(righe.filter((r) => r.data >= sett.da && r.data <= sett.a));
  const conteggi = { totale: dentro.length, scadute: dentro.filter((r) => r.stato === 'SCADUTA').length };
  for (const g of GRAVITA) conteggi[g] = dentro.filter((r) => r.gravita === g).length;
  return {
    ...sett, conteggi, altre: Math.max(0, dentro.length - max),
    righe: dentro.slice(0, max).map((r) => ({ id: r.id, data: r.data, giorni: r.giorni, stato: r.stato, gravita: r.gravita, titolo: r.titolo, oggetto: r.oggetto, tipo: r.tipo, modulo: r.modulo, modulo_nome: r.modulo_nome, area: r.area, importo: r.importo, stima: r.stima })),
  };
}

/**
 * Confronto con lo stesso periodo precedente. meglio: 'su' (crescere è un bene, es. incassi), 'giu' (es. costi, NC), null (neutro).
 * unita '%': delta in punti percentuali, senza variazione percentuale. Ritorna null se il termine di confronto manca.
 */
export function confronto(cur, prev, { meglio = 'su', unita = null, etichetta = '' } = {}) {
  if (cur == null || prev == null || Number.isNaN(Number(cur)) || Number.isNaN(Number(prev))) return null;
  const c = Number(cur), p = Number(prev);
  const delta = r2(c - p);
  const delta_pct = unita === '%' || !p ? null : Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
  const segno = delta > 0 ? 'su' : delta < 0 ? 'giu' : 'pari';
  const esito = segno === 'pari' || !meglio ? 'neutro' : segno === meglio ? 'meglio' : 'peggio';
  return { valore_precedente: r2(p), delta, delta_pct, segno, esito, punti: unita === '%', etichetta };
}

/** Indicatore normalizzato. Senza valore e con motivo = "non disponibile" (card attenuata con il motivo), mai zero. */
export function indicatore({ chiave, titolo, gruppo, valore = null, unita = 'n', confronto: cf = null, dettaglio = null, serie = [], fonte = null, aggiornato = null,
  parti = null, tabella = null, nota = null, secondario = null, meglio = 'su', non_disponibile = false, motivo = null }) {
  const nd = Boolean(non_disponibile) || (valore == null && !tabella);
  return {
    chiave, titolo, gruppo, unita, meglio,
    valore: nd ? null : (typeof valore === 'number' ? r2(valore) : valore),
    confronto: nd ? null : cf, dettaglio: nd ? null : dettaglio, serie: nd ? [] : (serie || []).slice(-12), parti: nd ? null : parti, tabella: nd ? null : tabella,
    secondario: nd ? null : secondario, fonte, aggiornato, nota,
    non_disponibile: nd, motivo: nd ? (motivo || 'Dato non disponibile') : null,
  };
}

/** Periodi di confronto: mese in corso fino a oggi, stesso periodo del mese precedente e dello stesso mese dell'anno precedente. */
export function periodi(oggi) {
  const inizio = `${oggi.slice(0, 7)}-01`;
  const mesePrec = addMesi(inizio, -1);
  const annoPrec = addMesi(inizio, -12);
  return {
    oggi, inizio, fine: fineMese(oggi),
    mese_prec: { da: mesePrec, a: addMesi(oggi, -1) > fineMese(mesePrec) ? fineMese(mesePrec) : addMesi(oggi, -1) },
    anno_prec: { da: annoPrec, a: addMesi(oggi, -12) },
    settimana_prec: addGiorni(oggi, -7),
    mesi12: Array.from({ length: 12 }, (_, i) => addMesi(inizio, i - 11).slice(0, 7)),
    giorni12: Array.from({ length: 12 }, (_, i) => addGiorni(oggi, i - 11)),
  };
}

/** Serie mensile dei 12 mesi (riempie con 0 i mesi senza righe: si usa solo per fonti lette davvero). */
export const serieMesi = (mesi, rows, campo = 'v') => mesi.map((mk) => ({ etichetta: etichettaMese(mk), valore: r2(Number(rows.find((r) => r.mk === mk)?.[campo] || 0)) }));
export const serieGiorni = (giorni, rows, campo = 'v') => giorni.map((d) => ({ etichetta: ggmm(d), valore: r2(Number(rows.find((r) => r.d === d)?.[campo] || 0)) }));

// --- Room: copertura degli ambulatori (pure) ----------------------------------------------------------------------------------
const t2m = (s) => { if (!s) return 0; const p = String(s).split(':'); return Number(p[0]) * 60 + (Number(p[1]) || 0); };
const ranges = (r) => (Array.isArray(r) ? r : []).map((x) => [t2m(x.from), t2m(x.to)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
const inters = (list, [s, e]) => list.map(([a, b]) => [Math.max(a, s), Math.min(b, e)]).filter(([a, b]) => b > a);
function merge(list) {
  const out = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
function sottrai(base, via) {
  let out = base.map((x) => [...x]);
  for (const [a, b] of via) out = out.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a]] : []), ...(b < y ? [[b, y]] : [])]));
  return out;
}
const somma = (list) => list.reduce((t, [a, b]) => t + (b - a), 0);
const dowLun0 = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;   // lunedì = 0, come il motore di Room (hours[0] = lunedì)

/**
 * % di copertura degli ambulatori nel mese: minuti prenotabili degli ambulatori (fasce dell'ambulatorio dentro l'orario di apertura
 * della sede, meno le fasce riservate ai prelievi: stessa regola del motore di Room) coperti da un turno con professionista assegnato
 * sullo stesso ambulatorio (turni.room_id), sul totale dei minuti prenotabili dei giorni del mese, senza i giorni di chiusura della sede.
 * sedi: [{ id, hours: {0..6: {closed, open, close}}, ambulatori: [{ id, nome, disp: {0..6: [{from,to}]}, discipline, prelievi }] }]
 * turni: [{ sede_id, data, ora_da, ora_a, room_id, prof_id }]; chiusure: [{ sede_id, dal, al }]; giorni: ['AAAA-MM-GG'].
 */
export function coperturaAmbulatori({ sedi = [], turni = [], chiusure = [], giorni = [] }) {
  let aperti = 0, coperti = 0, ambulatori = 0;
  const idsAmb = new Set();
  for (const s of sedi) {
    const amb = Array.isArray(s.ambulatori) ? s.ambulatori : [];
    ambulatori += amb.length;
    for (const r of amb) {
      idsAmb.add(`${s.id}|${r.id}`);
      for (const d of giorni) {
        if (chiusure.some((c) => (c.sede_id == null || Number(c.sede_id) === Number(s.id)) && c.dal <= d && c.al >= d)) continue;
        const g = dowLun0(d);
        const h = s.hours?.[g];
        if (!h || h.closed) continue;
        const prel = (r.discipline || []).includes('Punto Prelievi') ? ranges((r.prelievi || {})[g]) : [];
        const disp = sottrai(inters(ranges(r.disp?.[g]), [t2m(h.open), t2m(h.close)]), prel);
        if (!disp.length) continue;
        aperti += somma(disp);
        const tt = merge(turni.filter((t) => t.prof_id != null && Number(t.sede_id) === Number(s.id) && t.room_id === r.id && t.data === d).map((t) => [t2m(t.ora_da), t2m(t.ora_a)]).filter(([a, b]) => b > a));
        coperti += somma(tt.flatMap((x) => inters(disp, x)));
      }
    }
  }
  const senzaAmb = turni.filter((t) => t.prof_id != null && (!t.room_id || !idsAmb.has(`${t.sede_id}|${t.room_id}`))).length;
  return { minuti_aperti: aperti, minuti_coperti: coperti, ore_aperte: r2(aperti / 60), ore_coperte: r2(coperti / 60), pct: aperti ? Math.round((coperti / aperti) * 1000) / 10 : null, ambulatori, sedi: sedi.length, turni_senza_ambulatorio: senzaAmb };
}

// ------------------------------------------------------------------ lettura difensiva
async function statoModulo(key) {
  const st = await getModuleState(key).catch(() => null);
  return st?.mode === 'LIVE' && st.schema_ready !== false ? 'LIVE' : (st?.mode || 'OFF');
}
const motivoNonLive = (key, st) => `${NOMI_MODULI[key] || key}: ${st === 'OFF' ? 'modulo non avviato nella Suite' : `modulo in stato ${st}, si legge solo quando è LIVE`}`;

// ------------------------------------------------------------------ indicatori
// Ogni costruttore riceve ctx = { oggi, P (periodi), live: { modulo: true|stato }, db(key), scad } e ritorna uno o più indicatori.

async function incassi(ctx) {
  const { P } = ctx;
  const G = 'INCASSI';
  const cashLive = ctx.live.cash === true, retailLive = ctx.live.retail === true;
  if (!cashLive && !retailLive) {
    const m = `${motivoNonLive('cash', ctx.live.cash)}; ${motivoNonLive('retail', ctx.live.retail)}`;
    return [indicatore({ chiave: 'incassi_oggi', titolo: 'Incassi di oggi', gruppo: G, unita: 'EUR', motivo: m, fonte: 'Cash Management o Retail' }),
      indicatore({ chiave: 'incassi_mese', titolo: 'Incassi del mese', gruppo: G, unita: 'EUR', motivo: m, fonte: 'Cash Management o Retail' }),
      indicatore({ chiave: 'incassi_sedi', titolo: 'Incassi per sede del mese', gruppo: G, unita: 'EUR', motivo: m, fonte: 'Cash Management o Retail' })];
  }
  // Cash: rendiconti chiusi o successivi (contanti da versare + POS + bonifici)
  const cash = cashLive ? ctx.db('cash') : null;
  const CASH_TOT = 'sum(r.cash_to_deposit + r.pos_total + r.transfer_total)';
  const cashGiorni = cash ? await cash.many(`SELECT r.report_date::text AS d, ${CASH_TOT} AS v, count(DISTINCT r.site_id)::int AS sedi FROM cash_reports r
      WHERE r.status IN ${STATI_CASH} AND r.report_date BETWEEN $1::date AND $2::date GROUP BY 1`, [P.giorni12[0], P.oggi]) : [];
  const cashUltimo = cash ? (await cash.many(`SELECT max(report_date)::text AS d FROM cash_reports WHERE status IN ${STATI_CASH} AND report_date <= $1::date`, [P.oggi]))[0]?.d : null;
  // Retail: vendite nette (senza dimostrative e senza le prestazioni B2B fatturate alle aziende, che non sono incassi di sportello)
  const retail = retailLive ? ctx.db('retail') : null;
  const RET_W = `s.source <> 'DEMO' AND s.b2b_customer_id IS NULL`;
  const retGiorni = retail ? await retail.many(`SELECT s.sale_date::text AS d, sum(s.net_amount) AS v, count(DISTINCT s.site_id)::int AS sedi FROM sales s
      WHERE ${RET_W} AND s.sale_date BETWEEN $1::date AND $2::date GROUP BY 1`, [P.giorni12[0], P.oggi]) : [];
  const retUltimo = retail ? (await retail.many(`SELECT max(sale_date)::text AS d FROM sales s WHERE ${RET_W} AND s.sale_date <= $1::date`, [P.oggi]))[0]?.d : null;
  const out = [];

  // --- incassi di oggi: Cash se c'è almeno un rendiconto di oggi, altrimenti Retail (dichiarato)
  const cOggi = cashGiorni.find((x) => x.d === P.oggi);
  if (cOggi) {
    const prev = cashGiorni.find((x) => x.d === P.settimana_prec);
    out.push(indicatore({ chiave: 'incassi_oggi', titolo: 'Incassi di oggi', gruppo: G, unita: 'EUR', valore: Number(cOggi.v),
      confronto: confronto(Number(cOggi.v), prev ? Number(prev.v) : 0, { etichetta: `stesso giorno della settimana scorsa (${ggmm(P.settimana_prec)})` }),
      dettaglio: `${cOggi.sedi} ${cOggi.sedi === 1 ? 'sede' : 'sedi'} con il rendiconto di oggi chiuso`, serie: serieGiorni(P.giorni12, cashGiorni), fonte: `Cash, rendiconti del ${ggmm(P.oggi)}`, aggiornato: P.oggi }));
  } else if (retail) {
    const r = retGiorni.find((x) => x.d === P.oggi);
    const prev = retGiorni.find((x) => x.d === P.settimana_prec);
    out.push(indicatore({ chiave: 'incassi_oggi', titolo: 'Incassi di oggi', gruppo: G, unita: 'EUR', valore: Number(r?.v || 0),
      confronto: confronto(Number(r?.v || 0), Number(prev?.v || 0), { etichetta: `stesso giorno della settimana scorsa (${ggmm(P.settimana_prec)})` }),
      dettaglio: r ? `Vendite nette Retail di ${r.sedi} ${r.sedi === 1 ? 'sede' : 'sedi'}: Cash non ha ancora rendiconti di oggi` : `Nessuna vendita Retail registrata oggi; Cash non ha ancora rendiconti di oggi`,
      serie: serieGiorni(P.giorni12, retGiorni), fonte: `Retail, vendite nette${retUltimo ? ` (ultimo dato del ${ggmm(retUltimo)})` : ''}`, aggiornato: retUltimo,
      nota: cash ? `Ultimo rendiconto Cash: ${cashUltimo ? itData(cashUltimo) : 'nessuno'}` : motivoNonLive('cash', ctx.live.cash) }));
  } else {
    out.push(indicatore({ chiave: 'incassi_oggi', titolo: 'Incassi di oggi', gruppo: G, unita: 'EUR', fonte: 'Cash Management',
      motivo: `Cash non ha ancora rendiconti di oggi (ultimo del ${cashUltimo ? itData(cashUltimo) : '—'}) e ${motivoNonLive('retail', ctx.live.retail)}` }));
  }

  // --- incassi del mese e per sede: stessa logica sul mese in corso (Cash se ha rendiconti nel mese, altrimenti Retail)
  const sqlCashSedi = `SELECT s.name AS sede, ${CASH_TOT} AS v FROM cash_reports r JOIN public.sites s ON s.id = r.site_id WHERE r.status IN ${STATI_CASH} AND r.report_date BETWEEN $1::date AND $2::date GROUP BY s.name ORDER BY v DESC`;
  const sqlRetSedi = `SELECT coalesce(si.name, 'Senza sede') AS sede, sum(s.net_amount) AS v FROM sales s LEFT JOIN public.sites si ON si.id = s.site_id WHERE ${RET_W} AND s.sale_date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY v DESC`;
  const cashSedi = cash ? await cash.many(sqlCashSedi, [P.inizio, P.oggi]) : [];
  const usaCash = cashSedi.length > 0;
  const db = usaCash ? cash : retail;
  if (!db) {
    out.push(indicatore({ chiave: 'incassi_mese', titolo: 'Incassi del mese', gruppo: G, unita: 'EUR', fonte: 'Cash Management', motivo: `Cash non ha rendiconti nel mese e ${motivoNonLive('retail', ctx.live.retail)}` }));
    out.push(indicatore({ chiave: 'incassi_sedi', titolo: 'Incassi per sede del mese', gruppo: G, unita: 'EUR', fonte: 'Cash Management', motivo: `Cash non ha rendiconti nel mese e ${motivoNonLive('retail', ctx.live.retail)}` }));
    return out;
  }
  const sedi = usaCash ? cashSedi : await retail.many(sqlRetSedi, [P.inizio, P.oggi]);
  const tot = sedi.reduce((t, x) => t + Number(x.v || 0), 0);
  const sqlTot = usaCash ? `SELECT ${CASH_TOT} AS v FROM cash_reports r WHERE r.status IN ${STATI_CASH} AND r.report_date BETWEEN $1::date AND $2::date`
    : `SELECT sum(s.net_amount) AS v FROM sales s WHERE ${RET_W} AND s.sale_date BETWEEN $1::date AND $2::date`;
  const prevAnno = Number((await db.many(sqlTot, [P.anno_prec.da, P.anno_prec.a]))[0]?.v || 0);
  const sqlMesi = usaCash ? `SELECT to_char(r.report_date, 'YYYY-MM') AS mk, ${CASH_TOT} AS v FROM cash_reports r WHERE r.status IN ${STATI_CASH} AND r.report_date BETWEEN $1::date AND $2::date GROUP BY 1`
    : `SELECT to_char(s.sale_date, 'YYYY-MM') AS mk, sum(s.net_amount) AS v FROM sales s WHERE ${RET_W} AND s.sale_date BETWEEN $1::date AND $2::date GROUP BY 1`;
  const mesi = await db.many(sqlMesi, [`${P.mesi12[0]}-01`, P.oggi]);
  const ultimo = usaCash ? cashUltimo : retUltimo;
  const fonte = usaCash ? `Cash, rendiconti chiusi${ultimo ? ` (ultimo del ${ggmm(ultimo)})` : ''}` : `Retail, vendite nette${ultimo ? ` (ultimo dato del ${ggmm(ultimo)})` : ''}`;
  out.push(indicatore({ chiave: 'incassi_mese', titolo: 'Incassi del mese', gruppo: G, unita: 'EUR', valore: tot,
    confronto: confronto(tot, prevAnno, { etichetta: `stesso periodo dell'anno scorso (${ggmm(P.anno_prec.da)}-${itData(P.anno_prec.a)})` }),
    dettaglio: `${sedi.length} ${sedi.length === 1 ? 'sede' : 'sedi'} dal ${ggmm(P.inizio)} a oggi${usaCash ? '' : ' · Cash non ha rendiconti nel mese'}`, serie: serieMesi(P.mesi12, mesi), fonte, aggiornato: ultimo }));
  out.push(indicatore({ chiave: 'incassi_sedi', titolo: 'Incassi per sede del mese', gruppo: G, unita: 'sedi', valore: sedi.length,
    tabella: sedi.slice(0, 8).map((x) => ({ etichetta: x.sede, valore: r2(x.v) })), dettaglio: sedi.length > 8 ? `prime 8 di ${sedi.length} sedi` : `${sedi.length} ${sedi.length === 1 ? 'sede' : 'sedi'}`, fonte, aggiornato: ultimo }));
  return out;
}

// Conto economico di Finance Management (lib/controlloData.js e contoEconomico.js): mese in corso e anno in corso, confronto con lo stesso
// periodo dell'anno precedente (come la pagina del modulo), serie degli ultimi 12 mesi (in cache 15 minuti: i mesi chiusi cambiano poco).
let serieContoCache = { chiave: null, at: 0, data: null };
async function contoEconomicoMonitor(ctx) {
  const { P } = ctx;
  const G = 'RICAVI_COSTI';
  const KEYS = [['ricavi_mese', 'Ricavi del mese', 'su'], ['ricavi_anno', 'Ricavi dell\'anno', 'su'], ['costi_mese', 'Costi del mese', 'giu'], ['costi_anno', 'Costi dell\'anno', 'giu'],
    ['margine_mese', 'Margine del mese', 'su'], ['margine_anno', 'Margine dell\'anno', 'su'], ['fatturato', 'Produzione (fatturabile)', 'su']];
  if (ctx.live.finance !== true) return KEYS.map(([k, t]) => indicatore({ chiave: k, titolo: t, gruppo: G, unita: 'EUR', fonte: 'Finance Management · Conto economico', motivo: motivoNonLive('finance', ctx.live.finance) }));
  const CD = await import('../modules/finance/lib/controlloData.js');
  const CE = await import('../modules/finance/lib/contoEconomico.js');
  const anno = Number(P.oggi.slice(0, 4)), mese = Number(P.oggi.slice(5, 7));
  const [cm, ca] = [await CD.contoEconomico(CE.periodo(anno, mese)), await CD.contoEconomico(CE.periodo(anno, null, P.oggi))];
  // serie: un conto per mese degli ultimi 12 (stesse regole, senza confronto)
  const chiave = P.mesi12.join(',');
  if (serieContoCache.chiave !== chiave || Date.now() - serieContoCache.at > 15 * 60_000) {
    const imp = await CD.impostazioniControllo();
    const s = [];
    for (const mk of P.mesi12) {
      const per = CE.periodo(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)));
      const sedi = await CD.sediDelConto(per, imp);
      const { movimenti, fonti } = await CD.movimentiConto(per, imp, sedi);
      const c = CE.componiConto({ sedi: sedi.sedi.map((x) => ({ id: x.id, code: x.code, name: x.name, kind: x.kind })), centrali: sedi.centrali, movimenti, fonti });
      const costi = r2(c.totale.costi_diretti + c.totale.costi_centrali);
      s.push({ mk, ricavi: c.totale.ricavi, costi, margine: r2(c.totale.ricavi - costi) });
    }
    serieContoCache = { chiave, at: Date.now(), data: s };
  }
  const serie = (campo) => serieContoCache.data.map((x) => ({ etichetta: etichettaMese(x.mk), valore: x[campo] }));
  const tot = (c) => { const costi = r2(c.totale.costi_diretti + c.totale.costi_centrali); const margine = r2(c.totale.ricavi - costi); return { ricavi: c.totale.ricavi, costi, margine, pct: c.totale.ricavi > 0 ? Math.round((margine / c.totale.ricavi) * 1000) / 10 : null }; };
  const prec = (c) => { const p = c.totale.precedente; const costi = r2(p.costi_diretti + p.costi_centrali); return { ricavi: p.ricavi, costi, margine: r2(p.ricavi - costi) }; };
  const mancanti = (c) => Object.entries(c.fonti).filter(([, f]) => f.disponibile === false).map(([k]) => CE.RIGHE.find((x) => x.key === k)?.label || k);
  const parziale = (c) => c.colonne.some((x) => x.parziale) || c.centrali.parziale;
  const notaConto = (c) => { const m = mancanti(c); return m.length ? `Parziale: non disponibili ${m.join(', ')}` : parziale(c) ? 'Parziale: importi da indicare (compensi variabili, produzione Service senza valore)' : null; };
  const M = tot(cm), A = tot(ca), Mp = prec(cm), Ap = prec(ca);
  const etM = `${CE.MESI_LUNGHI[mese - 1]} ${anno - 1}`, etA = `${ca.periodo.etichetta.replace(String(anno), String(anno - 1))}`;
  const fonte = 'Finance Management · Conto economico di sede';
  const agg = P.oggi;
  const retail = cm.totale.voci.ricavi_retail || 0, service = cm.totale.voci.ricavi_service || 0;
  return [
    indicatore({ chiave: 'ricavi_mese', titolo: 'Ricavi del mese', gruppo: G, unita: 'EUR', valore: M.ricavi, confronto: confronto(M.ricavi, Mp.ricavi, { etichetta: etM }),
      dettaglio: `Produzione: Retail ${eur(retail)} · Service ${eur(service)}`, serie: serie('ricavi'), fonte, aggiornato: agg, nota: notaConto(cm) }),
    indicatore({ chiave: 'ricavi_anno', titolo: 'Ricavi dell\'anno', gruppo: G, unita: 'EUR', valore: A.ricavi, confronto: confronto(A.ricavi, Ap.ricavi, { etichetta: etA }),
      dettaglio: `Produzione, ${ca.periodo.etichetta}`, serie: serie('ricavi'), fonte, aggiornato: agg, nota: notaConto(ca) }),
    indicatore({ chiave: 'costi_mese', titolo: 'Costi del mese', gruppo: G, unita: 'EUR', valore: M.costi, meglio: 'giu', confronto: confronto(M.costi, Mp.costi, { meglio: 'giu', etichetta: etM }),
      dettaglio: `Diretti di sede ${eur(cm.totale.costi_diretti)} · centrali ${eur(cm.totale.costi_centrali)}`, serie: serie('costi'), fonte, aggiornato: agg, nota: notaConto(cm) }),
    indicatore({ chiave: 'costi_anno', titolo: 'Costi dell\'anno', gruppo: G, unita: 'EUR', valore: A.costi, meglio: 'giu', confronto: confronto(A.costi, Ap.costi, { meglio: 'giu', etichetta: etA }),
      dettaglio: `Diretti di sede ${eur(ca.totale.costi_diretti)} · centrali ${eur(ca.totale.costi_centrali)}`, serie: serie('costi'), fonte, aggiornato: agg, nota: notaConto(ca) }),
    indicatore({ chiave: 'margine_mese', titolo: 'Margine del mese', gruppo: G, unita: 'EUR', valore: M.margine, confronto: confronto(M.margine, Mp.margine, { etichetta: etM }),
      secondario: M.pct != null ? { valore: M.pct, unita: '%', etichetta: 'margine %' } : null, dettaglio: M.pct != null ? `Margine ${String(M.pct).replace('.', ',')}% dei ricavi` : 'Margine % non calcolabile (ricavi a zero)',
      serie: serie('margine'), fonte, aggiornato: agg, nota: notaConto(cm) }),
    indicatore({ chiave: 'margine_anno', titolo: 'Margine dell\'anno', gruppo: G, unita: 'EUR', valore: A.margine, confronto: confronto(A.margine, Ap.margine, { etichetta: etA }),
      secondario: A.pct != null ? { valore: A.pct, unita: '%', etichetta: 'margine %' } : null, dettaglio: A.pct != null ? `Margine ${String(A.pct).replace('.', ',')}% dei ricavi` : 'Margine % non calcolabile (ricavi a zero)',
      serie: serie('margine'), fonte, aggiornato: agg, nota: notaConto(ca) }),
    // Decisione 12 del CEO: la fatturazione attiva è fuori perimetro. Nessun fatturato inventato: si mostra la produzione fatturabile.
    indicatore({ chiave: 'fatturato', titolo: 'Produzione (fatturabile)', gruppo: G, unita: 'EUR', valore: M.ricavi, confronto: confronto(M.ricavi, Mp.ricavi, { etichetta: etM }),
      dettaglio: `Mese in corso: Retail ${eur(retail)} + Service a listino ${eur(service)}`, serie: serie('ricavi'), fonte, aggiornato: agg,
      nota: 'Non è il fatturato emesso: la Suite non ha la fatturazione attiva (decisione 12), si mostra la produzione Retail + Service a listino' }),
  ];
}

async function processiFinance(ctx) {
  const { P } = ctx;
  const G = 'FINANCE';
  const out = [];
  if (ctx.live.finance !== true) {
    const m = motivoNonLive('finance', ctx.live.finance);
    for (const [k, t] of [['istanze_in_firma', 'Istanze in firma'], ['istanze_da_eseguire', 'Firmate da eseguire'], ['istanze_eseguite', 'Pagamenti eseguiti'], ['scadenziario_30', 'Scadenziario a 30 giorni']]) out.push(indicatore({ chiave: k, titolo: t, gruppo: G, unita: 'n', fonte: 'Finance Management', motivo: m }));
    return out;
  }
  const db = ctx.db('finance');
  const st = (await db.many(`SELECT status, count(*)::int AS n, coalesce(sum(amount), 0) AS v, max(updated_at) AS agg FROM payment_requests WHERE status IN ('IN_FIRMA','FIRMATA') GROUP BY status`));
  const agg = (await db.many(`SELECT max(updated_at) AS t FROM payment_requests`))[0]?.t;
  const aggTxt = agg ? new Date(agg).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
  const fonte = `Finance, istanze di pagamento${aggTxt ? ` (ultima modifica del ${ggmm(aggTxt)})` : ''}`;
  const f = st.find((x) => x.status === 'IN_FIRMA') || { n: 0, v: 0 };
  const e = st.find((x) => x.status === 'FIRMATA') || { n: 0, v: 0 };
  out.push(indicatore({ chiave: 'istanze_in_firma', titolo: 'Istanze in firma', gruppo: G, valore: f.n, secondario: { valore: r2(f.v), unita: 'EUR', etichetta: 'importo' }, dettaglio: `Importo in attesa di firma ${eur(f.v)}`, fonte, aggiornato: aggTxt, meglio: 'giu' }));
  out.push(indicatore({ chiave: 'istanze_da_eseguire', titolo: 'Firmate da eseguire', gruppo: G, valore: e.n, secondario: { valore: r2(e.v), unita: 'EUR', etichetta: 'importo' }, dettaglio: `Importo autorizzato da pagare ${eur(e.v)}`, fonte, aggiornato: aggTxt, meglio: 'giu' }));
  const ese = (await db.many(`SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS v FROM payment_requests WHERE status = 'ESEGUITA' AND executed_at BETWEEN $1::date AND $2::date`, [P.inizio, P.oggi]))[0];
  const eseP = (await db.many(`SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS v FROM payment_requests WHERE status = 'ESEGUITA' AND executed_at BETWEEN $1::date AND $2::date`, [P.mese_prec.da, P.mese_prec.a]))[0];
  const eseM = await db.many(`SELECT to_char(executed_at, 'YYYY-MM') AS mk, sum(amount) AS v FROM payment_requests WHERE status = 'ESEGUITA' AND executed_at BETWEEN $1::date AND $2::date GROUP BY 1`, [`${P.mesi12[0]}-01`, P.oggi]);
  out.push(indicatore({ chiave: 'istanze_eseguite', titolo: 'Pagamenti eseguiti', gruppo: G, unita: 'EUR', valore: Number(ese.v), secondario: { valore: ese.n, unita: 'n', etichetta: 'istanze' },
    confronto: confronto(Number(ese.v), Number(eseP.v), { meglio: null, etichetta: `stesso periodo del mese scorso (${ggmm(P.mese_prec.da)}-${ggmm(P.mese_prec.a)})` }),
    dettaglio: `${ese.n} ${ese.n === 1 ? 'istanza eseguita' : 'istanze eseguite'} dal ${ggmm(P.inizio)} (data di esecuzione)`, serie: serieMesi(P.mesi12, eseM), fonte, aggiornato: aggTxt }));
  // Scadenziario strutture: eventi dello scadenzario di direzione (fonte finance_scadenziario) da oggi a 30 giorni
  const fs = ctx.scad.fonti.find((x) => x.key === 'finance_scadenziario');
  if (!fs || fs.stato !== 'OK') out.push(indicatore({ chiave: 'scadenziario_30', titolo: 'Scadenziario a 30 giorni', gruppo: G, unita: 'EUR', fonte: 'Finance · Scadenziario strutture', motivo: fs?.nota || 'Fonte non letta' }));
  else {
    const a = addGiorni(P.oggi, 30);
    const rr = ctx.scad.righe.filter((r) => r.fonte === 'finance_scadenziario' && r.data >= P.oggi && r.data <= a);
    const conImporto = rr.filter((r) => r.importo != null);
    const v = conImporto.reduce((t, r) => t + Number(r.importo), 0);
    const stime = conImporto.filter((r) => r.stima).length;
    out.push(indicatore({ chiave: 'scadenziario_30', titolo: 'Scadenziario a 30 giorni', gruppo: G, unita: 'EUR', valore: v, meglio: null,
      dettaglio: `${rr.length} ${rr.length === 1 ? 'scadenza' : 'scadenze'} fino al ${itData(a)}${stime ? `, di cui ${stime} con importo stimato` : ''}${rr.length - conImporto.length ? `, ${rr.length - conImporto.length} senza importo` : ''}`,
      fonte: 'Finance · Scadenziario strutture (canoni, ISTAT, registro, bollette)', aggiornato: P.oggi }));
  }
  return out;
}

async function operations(ctx) {
  const { P } = ctx;
  const G = 'OPERATIONS';
  const out = [];
  const nd = (k, t, mod, u = 'n') => indicatore({ chiave: k, titolo: t, gruppo: G, unita: u, fonte: NOMI_MODULI[mod], motivo: motivoNonLive(mod, ctx.live[mod]) });
  // NC
  if (ctx.live.nc !== true) out.push(nd('nc_aperte', 'NC aperte', 'nc'), nd('nc_chiuse_mese', 'NC chiuse nel mese', 'nc'));
  else {
    const db = ctx.db('nc');
    const a = (await db.many(`SELECT count(*)::int AS n, count(*) FILTER (WHERE stato = 'INVIATA_SEDE' AND sla_due_at < now())::int AS oltre,
        count(*) FILTER (WHERE gravita = 'CRITICA')::int AS critiche, max(updated_at) AS agg FROM nc WHERE stato NOT IN ('CHIUSA','VERIFICATA','ANNULLATA')`))[0];
    const agg = (await db.many(`SELECT max(updated_at) AS t FROM nc`))[0]?.t;
    const aggTxt = agg ? new Date(agg).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
    out.push(indicatore({ chiave: 'nc_aperte', titolo: 'NC aperte', gruppo: G, valore: a.n, meglio: 'giu', secondario: { valore: a.oltre, unita: 'n', etichetta: 'oltre il termine' },
      dettaglio: `di cui ${a.oltre} oltre il termine di risposta della sede${a.critiche ? ` · ${a.critiche} critiche` : ''}`, fonte: `Non conformità${aggTxt ? ` (ultima modifica del ${ggmm(aggTxt)})` : ''}`, aggiornato: aggTxt }));
    const ch = async (da, al) => (await db.many(`SELECT count(*)::int AS n FROM nc WHERE stato IN ('CHIUSA','VERIFICATA') AND (closed_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date`, [da, al]))[0].n;
    const chM = await db.many(`SELECT to_char((closed_at AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM') AS mk, count(*)::int AS v FROM nc WHERE stato IN ('CHIUSA','VERIFICATA') AND (closed_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date GROUP BY 1`, [`${P.mesi12[0]}-01`, P.oggi]);
    const n = await ch(P.inizio, P.oggi);
    out.push(indicatore({ chiave: 'nc_chiuse_mese', titolo: 'NC chiuse nel mese', gruppo: G, valore: n, confronto: confronto(n, await ch(P.mese_prec.da, P.mese_prec.a), { etichetta: `stesso periodo del mese scorso` }),
      dettaglio: `Chiuse o verificate dal ${ggmm(P.inizio)}`, serie: serieMesi(P.mesi12, chM), fonte: 'Non conformità (data di chiusura)', aggiornato: aggTxt }));
  }
  // Ordini
  if (ctx.live.orders !== true) out.push(nd('ordini_in_corso', 'Ordini in corso', 'orders'), nd('ordini_mese', 'Ordini del mese', 'orders'));
  else {
    const db = ctx.db('orders');
    const f = await db.many(`SELECT status, count(*)::int AS n FROM orders WHERE status IN ('INVIATO','APPROVATO','PRESO_IN_CARICO','SPEDITO') GROUP BY status`);
    const c = (s) => f.filter((x) => s.includes(x.status)).reduce((t, x) => t + x.n, 0);
    const parti = [{ etichetta: 'Da approvare', valore: c(['INVIATO']) }, { etichetta: 'In preparazione', valore: c(['APPROVATO', 'PRESO_IN_CARICO']) }, { etichetta: 'In consegna', valore: c(['SPEDITO']) }];
    const agg = (await db.many(`SELECT max(updated_at) AS t FROM orders`))[0]?.t;
    const aggTxt = agg ? new Date(agg).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
    out.push(indicatore({ chiave: 'ordini_in_corso', titolo: 'Ordini in corso', gruppo: G, valore: parti.reduce((t, x) => t + x.valore, 0), parti, meglio: null,
      dettaglio: parti.map((x) => `${x.etichetta} ${x.valore}`).join(' · '), fonte: `Ordini e Magazzino${aggTxt ? ` (ultima modifica del ${ggmm(aggTxt)})` : ''}`, aggiornato: aggTxt }));
    const inv = async (da, al) => (await db.many(`SELECT count(*)::int AS n FROM orders WHERE status <> 'BOZZA' AND (submitted_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date`, [da, al]))[0].n;
    const invM = await db.many(`SELECT to_char((submitted_at AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM') AS mk, count(*)::int AS v FROM orders WHERE status <> 'BOZZA' AND (submitted_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date GROUP BY 1`, [`${P.mesi12[0]}-01`, P.oggi]);
    const n = await inv(P.inizio, P.oggi);
    out.push(indicatore({ chiave: 'ordini_mese', titolo: 'Ordini del mese', gruppo: G, valore: n, meglio: null, confronto: confronto(n, await inv(P.mese_prec.da, P.mese_prec.a), { meglio: null, etichetta: 'stesso periodo del mese scorso' }),
      dettaglio: `Ordini inviati dalle strutture dal ${ggmm(P.inizio)}`, serie: serieMesi(P.mesi12, invM), fonte: 'Ordini e Magazzino (data di invio)', aggiornato: aggTxt }));
  }
  // Kit (Spedizioni)
  if (ctx.live.shipments !== true) out.push(nd('kit_in_gestione', 'Kit in gestione', 'shipments'));
  else {
    const db = ctx.db('shipments');
    const k = await db.many(`SELECT status, count(*)::int AS n FROM kits WHERE status IN ('ASSIGNED','SHIPPED','DELIVERED','SAMPLE_RECEIVED','SHIPPED_TO_LAB') GROUP BY status`);
    const c = (s) => k.filter((x) => s.includes(x.status)).reduce((t, x) => t + x.n, 0);
    // righe economiche non ancora in un periodo di rendiconto chiuso (stessa regola della Rendicontazione del modulo)
    const rend = (await db.many(`SELECT
        count(*) FILTER (WHERE o.fee_shipping IS NOT NULL AND o.status <> 'CANCELLED' AND (o.ship_billing_period_id IS NULL OR ps.status = 'OPEN'))::int AS sped,
        coalesce(sum(o.fee_shipping) FILTER (WHERE o.fee_shipping IS NOT NULL AND o.status <> 'CANCELLED' AND (o.ship_billing_period_id IS NULL OR ps.status = 'OPEN')), 0) AS sped_v,
        count(*) FILTER (WHERE o.fee_sample IS NOT NULL AND (o.sample_billing_period_id IS NULL OR pc.status = 'OPEN'))::int AS camp,
        coalesce(sum(o.fee_sample) FILTER (WHERE o.fee_sample IS NOT NULL AND (o.sample_billing_period_id IS NULL OR pc.status = 'OPEN')), 0) AS camp_v
      FROM orders o LEFT JOIN billing_periods ps ON ps.id = o.ship_billing_period_id LEFT JOIN billing_periods pc ON pc.id = o.sample_billing_period_id`))[0];
    const daRend = rend.sped + rend.camp;
    const parti = [{ etichetta: 'In viaggio', valore: c(['SHIPPED']) }, { etichetta: 'Al paziente', valore: c(['ASSIGNED', 'DELIVERED', 'SAMPLE_RECEIVED']) }, { etichetta: 'Al laboratorio', valore: c(['SHIPPED_TO_LAB']) }, { etichetta: 'Da rendicontare', valore: daRend }];
    const agg = (await db.many(`SELECT max(updated_at) AS t FROM kits`))[0]?.t;
    const aggTxt = agg ? new Date(agg).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
    out.push(indicatore({ chiave: 'kit_in_gestione', titolo: 'Kit in gestione', gruppo: G, valore: c(['ASSIGNED', 'SHIPPED', 'DELIVERED', 'SAMPLE_RECEIVED', 'SHIPPED_TO_LAB']), parti, meglio: null,
      dettaglio: `Da rendicontare: ${rend.sped} spedizioni e ${rend.camp} campioni (${eur(Number(rend.sped_v) + Number(rend.camp_v))})`, fonte: `Spedizioni e Kit${aggTxt ? ` (ultima modifica del ${ggmm(aggTxt)})` : ''}`, aggiornato: aggTxt }));
  }
  // Referti esterni
  if (ctx.live.referti !== true) out.push(nd('referti_da_trascrivere', 'Referti da trascrivere', 'referti'));
  else {
    const db = ctx.db('referti');
    const x = (await db.many(`SELECT (SELECT count(*) FROM schede WHERE stato = 'BOZZA')::int AS bozze, (SELECT count(*) FROM elaborazioni WHERE stato = 'CARICATO')::int AS caricati,
        (SELECT min(created_at) FROM schede WHERE stato = 'BOZZA') AS piu_vecchia, (SELECT max(created_at) FROM elaborazioni) AS agg`))[0];
    const aggTxt = x.agg ? new Date(x.agg).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
    const vecchia = x.piu_vecchia ? new Date(x.piu_vecchia).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
    out.push(indicatore({ chiave: 'referti_da_trascrivere', titolo: 'Referti da trascrivere', gruppo: G, valore: x.bozze, meglio: 'giu',
      dettaglio: `Schede in bozza da confermare${vecchia ? `, la più vecchia del ${itData(vecchia)}` : ''}${x.caricati ? ` · ${x.caricati} PDF caricati non ancora elaborati` : ''}`, fonte: `Referti esterni${aggTxt ? ` (ultimo caricamento del ${ggmm(aggTxt)})` : ''}`, aggiornato: aggTxt }));
  }
  return out;
}

async function retailFlow(ctx) {
  const { P } = ctx;
  const G = 'RETAIL_FLOW';
  const out = [];
  const nd = (k, t, mod, u = 'n') => indicatore({ chiave: k, titolo: t, gruppo: G, unita: u, fonte: NOMI_MODULI[mod], motivo: motivoNonLive(mod, ctx.live[mod]) });
  const mese = P.oggi.slice(0, 7);
  // Room: copertura turni e degli ambulatori
  if (ctx.live.room !== true) out.push(nd('copertura_turni', 'Copertura turni del mese', 'room', '%'), nd('copertura_ambulatori', 'Copertura ambulatori', 'room', '%'));
  else {
    const db = ctx.db('room');
    const tm = await db.many(`SELECT mese AS mk, count(*)::int AS tot, count(*) FILTER (WHERE prof_id IS NOT NULL)::int AS cop FROM turni WHERE mese = ANY($1::text[]) GROUP BY mese`, [P.mesi12]);
    const mesePrec = addMesi(P.inizio, -1).slice(0, 7);
    const pct = (x) => (x && x.tot ? Math.round((x.cop / x.tot) * 1000) / 10 : null);
    const cur = tm.find((x) => x.mk === mese), prev = tm.find((x) => x.mk === mesePrec);
    const stato = (await db.many(`SELECT stato FROM turni_mesi WHERE mese = $1`, [mese]))[0]?.stato || null;
    const turniPct = pct(cur);
    const fonteT = `Room Planning, turni di ${etichettaMese(mese)}${stato ? ` (${stato === 'CONFERMATO' ? 'confermati' : 'in bozza'})` : ''}`;
    out.push(indicatore({ chiave: 'copertura_turni', titolo: 'Copertura turni del mese', gruppo: G, unita: '%', valore: turniPct, secondario: cur ? { valore: cur.tot - cur.cop, unita: 'n', etichetta: 'scoperti' } : null,
      confronto: confronto(turniPct, pct(prev), { unita: '%', etichetta: 'mese scorso' }), dettaglio: cur ? `${cur.cop} turni coperti su ${cur.tot}` : null,
      serie: P.mesi12.map((mk) => ({ etichetta: etichettaMese(mk), valore: pct(tm.find((x) => x.mk === mk)) ?? 0 })), fonte: fonteT, aggiornato: P.oggi,
      motivo: cur ? null : `Nessun turno pianificato in Room per ${etichettaMese(mese)}` }));
    // % copertura ambulatori: ore prenotabili degli ambulatori coperte da un professionista (turni con ambulatorio) sul totale del mese
    const { loadSedi, joinStruttura } = await import('../modules/room/lib/strutture.js');
    const sedi = (await loadSedi({ onlyConfigured: true })).map((x) => { const s = joinStruttura(x.lite, {}); return { id: x.row.id, hours: s.hours, ambulatori: s.ambulatori || [] }; });
    const turni = await db.many(`SELECT sede_id, data::text AS data, ora_da, ora_a, room_id, prof_id FROM turni WHERE mese = $1`, [mese]);
    const chiusure = (await db.many(`SELECT sede_id, dal::text AS dal, al::text AS al FROM eventi WHERE kind = 'CHIUSURA' AND al >= $1::date AND dal <= $2::date`, [P.inizio, P.fine]));
    const giorni = []; for (let d = P.inizio; d <= P.fine; d = addGiorni(d, 1)) giorni.push(d);
    const cop = coperturaAmbulatori({ sedi, turni, chiusure, giorni });
    if (cop.pct != null && turni.length) {
      out.push(indicatore({ chiave: 'copertura_ambulatori', titolo: 'Copertura ambulatori', gruppo: G, unita: '%', valore: cop.pct,
        dettaglio: `${Math.round(cop.ore_coperte)} ore coperte su ${Math.round(cop.ore_aperte)} prenotabili · ${cop.ambulatori} ambulatori in ${cop.sedi} sedi${cop.turni_senza_ambulatorio ? ` · ${cop.turni_senza_ambulatorio} turni senza ambulatorio non contati` : ''}`,
        fonte: `Room Planning, ambulatori configurati e turni di ${etichettaMese(mese)}`, aggiornato: P.oggi,
        nota: 'Ore prenotabili = fasce degli ambulatori dentro l\'orario di apertura della sede, senza le fasce dei prelievi e i giorni di chiusura; configurazione attuale degli ambulatori (nessuno storico)' }));
    } else {
      // il dato di Room non permette il calcolo: si dichiara e si usa la copertura dei turni
      const perche = !sedi.length ? 'nessuna sede configurata in Room' : !cop.ambulatori ? 'nessun ambulatorio configurato nelle sedi di Room' : !cop.minuti_aperti ? 'nessuna fascia prenotabile degli ambulatori nel mese' : 'nessun turno del mese';
      out.push(indicatore({ chiave: 'copertura_ambulatori', titolo: 'Copertura ambulatori', gruppo: G, unita: '%', valore: turniPct,
        dettaglio: cur ? `Copertura dei turni (${cur.cop} su ${cur.tot}) al posto di quella degli ambulatori` : null, fonte: fonteT, aggiornato: P.oggi,
        nota: `Ore degli ambulatori non calcolabili (${perche}): si usa la copertura dei turni`, motivo: `Ore degli ambulatori non calcolabili (${perche}) e nessun turno nel mese` }));
    }
  }
  // Retail: richiami scaduti (stessa regola del contatore del widget)
  if (ctx.live.retail !== true) out.push(nd('richiami_scaduti', 'Richiami Retail scaduti', 'retail'));
  else {
    const db = ctx.db('retail');
    const x = (await db.many(`SELECT count(*) FILTER (WHERE due < $1::date)::int AS n, count(*) FILTER (WHERE due BETWEEN $1::date AND $1::date + 30)::int AS prossimi FROM (
        SELECT s.customer_id, p.id, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due FROM sales s JOIN products p ON p.id = s.product_id
        WHERE s.customer_id IS NOT NULL AND p.periodicity_months IS NOT NULL GROUP BY s.customer_id, p.id) t`, [P.oggi]))[0];
    out.push(indicatore({ chiave: 'richiami_scaduti', titolo: 'Richiami Retail scaduti', gruppo: G, valore: x.n, meglio: 'giu', dettaglio: `Pazienti con un esame periodico da ripetere già scaduto · ${x.prossimi} in scadenza nei prossimi 30 giorni`,
      fonte: 'Retail, ultima vendita per paziente e prodotto + periodicità del prodotto', aggiornato: P.oggi }));
  }
  // Business Hub: clienti attivi Service e MdL, pipeline, contratti firmati nel mese
  if (ctx.live.business !== true) out.push(nd('clienti_attivi', 'Clienti attivi Service e MdL', 'business'), nd('pipeline', 'Pipeline in fase 4-5', 'business'), nd('contratti_firmati', 'Contratti firmati nel mese', 'business'));
  else {
    const db = ctx.db('business');
    const cl = await many(`SELECT linea, livello, count(*)::int AS n FROM public.clienti_attivi_v GROUP BY 1, 2`);
    const c = (l, lv) => cl.filter((x) => x.linea === l && (!lv || x.livello === lv)).reduce((t, x) => t + x.n, 0);
    out.push(indicatore({ chiave: 'clienti_attivi', titolo: 'Clienti attivi Service e MdL', gruppo: G, valore: c('SRV') + c('MDL'),
      parti: [{ etichetta: 'Service', valore: c('SRV') }, { etichetta: 'MdL', valore: c('MDL') }], dettaglio: `Attivi ${c('SRV', 'ATTIVO') + c('MDL', 'ATTIVO')} · in avvio (contrattualizzati) ${c('SRV', 'CONTRATTUALIZZATO') + c('MDL', 'CONTRATTUALIZZATO')}`,
      fonte: 'Business Hub (vista clienti_attivi_v)', aggiornato: P.oggi }));
    const pip = await db.many(`SELECT fase_corrente AS f, linea, count(*)::int AS n FROM accounts WHERE fase_corrente IN (4, 5) GROUP BY 1, 2`);
    const pf = (f) => pip.filter((x) => x.f === f).reduce((t, x) => t + x.n, 0);
    const pl = (l) => pip.filter((x) => x.linea === l).reduce((t, x) => t + x.n, 0);
    out.push(indicatore({ chiave: 'pipeline', titolo: 'Pipeline in fase 4-5', gruppo: G, valore: pf(4) + pf(5), parti: [{ etichetta: 'Offerta inviata', valore: pf(4) }, { etichetta: 'In negoziazione', valore: pf(5) }],
      dettaglio: `Service ${pl('SRV')} · Punti prelievo ${pl('PP')} · MdL ${pl('MDL')}`, fonte: 'Business Hub, account per fase', aggiornato: P.oggi }));
    const firm = async (da, al) => (await db.many(`SELECT count(*)::int AS n FROM contracts WHERE kind IN ('PP','SRV','MDL') AND status IN ('FIRMATO','AUTORIZZATO','ATTIVO','CESSATO') AND signed_at BETWEEN $1::date AND $2::date`, [da, al]))[0].n;
    const fm = await db.many(`SELECT to_char(signed_at, 'YYYY-MM') AS mk, count(*)::int AS v FROM contracts WHERE kind IN ('PP','SRV','MDL') AND status IN ('FIRMATO','AUTORIZZATO','ATTIVO','CESSATO') AND signed_at BETWEEN $1::date AND $2::date GROUP BY 1`, [`${P.mesi12[0]}-01`, P.oggi]);
    const n = await firm(P.inizio, P.oggi);
    out.push(indicatore({ chiave: 'contratti_firmati', titolo: 'Contratti firmati nel mese', gruppo: G, valore: n, confronto: confronto(n, await firm(P.mese_prec.da, P.mese_prec.a), { etichetta: 'stesso periodo del mese scorso' }),
      dettaglio: 'Contratti Service, Punti prelievo e MdL con data di firma nel mese', serie: serieMesi(P.mesi12, fm), fonte: 'Business Hub, contratti (data di firma)', aggiornato: P.oggi }));
  }
  return out;
}

async function persone(ctx) {
  const { P } = ctx;
  const G = 'PERSONE';
  const out = [];
  const nd = (k, t, mod, u = 'n') => indicatore({ chiave: k, titolo: t, gruppo: G, unita: u, fonte: NOMI_MODULI[mod], motivo: motivoNonLive(mod, ctx.live[mod]) });
  // anagrafica della Suite: sempre leggibile
  const p = (await many(`SELECT count(*) FILTER (WHERE kind IN ('DIPENDENTE','DIRIGENTE'))::int AS dip, count(*) FILTER (WHERE kind = 'DIRIGENTE')::int AS dir,
      count(*) FILTER (WHERE kind IN ('LP','MEDICO','SANITARIO'))::int AS prof, max(updated_at) AS agg FROM public.people WHERE status = 'ATTIVO'`))[0];
  out.push(indicatore({ chiave: 'dipendenti_attivi', titolo: 'Dipendenti attivi', gruppo: G, valore: p.dip, meglio: null, dettaglio: `di cui ${p.dir} dirigenti · ${p.prof} professionisti (LP, medici, sanitari) attivi`,
    fonte: 'Anagrafica della Suite (persone ATTIVE)', aggiornato: P.oggi }));
  // Piano Ferie: assenti oggi (piani approvati o definitivi con un periodo che comprende oggi)
  if (ctx.live.ferie !== true) out.push(nd('assenti_oggi', 'Assenti oggi', 'ferie'));
  else {
    const db = ctx.db('ferie');
    const a = (await db.many(`SELECT count(DISTINCT r.person_id) FILTER (WHERE r.tipo = 'FERIE')::int AS ferie, count(DISTINCT r.person_id) FILTER (WHERE r.tipo = 'ROL')::int AS rol,
        count(DISTINCT r.person_id)::int AS tot FROM richieste r JOIN piani pi ON pi.id = r.piano_id AND pi.stato IN ('APPROVATO','DEFINITIVO') JOIN public.people p ON p.id = r.person_id AND p.status = 'ATTIVO'
       WHERE r.stato IN ('APPROVATA','GODUTA') AND $1::date BETWEEN r.data_inizio AND r.data_fine`, [P.oggi]))[0];
    out.push(indicatore({ chiave: 'assenti_oggi', titolo: 'Assenti oggi', gruppo: G, valore: a.tot, meglio: null, dettaglio: `In ferie ${a.ferie} · permessi (ROL) ${a.rol} · dai piani approvati o definitivi`,
      fonte: `Piano Ferie, periodi del ${ggmm(P.oggi)}`, aggiornato: P.oggi }));
  }
  // Audit SGI: auto-audit del mese non inviati dalle sedi struttura in esercizio (stessa regola del contatore del widget)
  if (ctx.live.audit !== true) out.push(nd('autoaudit_mancanti', 'Auto-audit mancanti', 'audit'));
  else {
    const db = ctx.db('audit');
    const x = (await db.many(`SELECT count(*)::int AS sedi, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM audits a WHERE a.kind = 'AUTO' AND a.site_id = s.id AND a.period = $1::date AND a.deleted_at IS NULL AND a.status <> 'BOZZA'))::int AS mancanti
      FROM sites_v s WHERE s.in_esercizio AND s.kind IN ('PUNTO_PRELIEVI','CENTRO_DIAGNOSTICO','CENTRO_MEDICO','POLIAMBULATORIO','LABORATORIO')`, [P.inizio]))[0];
    const daVer = (await db.many(`SELECT count(*)::int AS n FROM audits WHERE kind = 'AUTO' AND status = 'INVIATO' AND deleted_at IS NULL`))[0].n;
    out.push(indicatore({ chiave: 'autoaudit_mancanti', titolo: 'Auto-audit mancanti', gruppo: G, valore: x.mancanti, meglio: 'giu', secondario: { valore: x.sedi, unita: 'n', etichetta: 'sedi struttura' },
      dettaglio: `${x.sedi - x.mancanti} inviati su ${x.sedi} sedi struttura · ${daVer} inviati da verificare`, fonte: `Audit SGI, auto-audit di ${etichettaMese(P.oggi.slice(0, 7))}`, aggiornato: P.oggi }));
  }
  // Ticket aperti (stessa regola del contatore del widget)
  if (ctx.live.ticket !== true) out.push(nd('ticket_aperti', 'Ticket aperti', 'ticket'));
  else {
    const db = ctx.db('ticket');
    const t = await db.many(`SELECT priorita, count(*)::int AS n FROM tickets WHERE stato NOT IN ('CHIUSO','ANNULLATO') GROUP BY 1`);
    const tot = t.reduce((s, x) => s + x.n, 0);
    const pr = (k) => t.find((x) => x.priorita === k)?.n || 0;
    out.push(indicatore({ chiave: 'ticket_aperti', titolo: 'Ticket aperti', gruppo: G, valore: tot, meglio: 'giu', parti: ['P1', 'P2', 'P3', 'P4'].map((k) => ({ etichetta: k, valore: pr(k) })),
      dettaglio: `Priorità P1 ${pr('P1')} · P2 ${pr('P2')} · P3 ${pr('P3')} · P4 ${pr('P4')}`, fonte: 'Ticket (non chiusi né annullati)', aggiornato: P.oggi }));
  }
  // Circolari al personale degli ultimi 90 giorni: quante con conferme mancanti e % di presa visione
  if (ctx.live.circolari !== true) out.push(nd('circolari_da_confermare', 'Circolari da confermare', 'circolari'));
  else {
    const db = ctx.db('circolari');
    const circ = await db.many(`SELECT id FROM circolari WHERE stato = 'PUBBLICATA' AND segmento = 'PERSONALE' AND published_at IS NOT NULL AND (published_at AT TIME ZONE 'Europe/Rome')::date >= $1::date`, [addGiorni(P.oggi, -90)]);
    const { isInterno } = await import('../modules/circolari/lib/visibilita.js');
    const utenti = (await many(`SELECT u.id, u.level, u.is_external, p.kind AS person_kind, o.kind AS organization_kind FROM public.users u LEFT JOIN public.people p ON p.id = u.person_id
        LEFT JOIN public.organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.status = 'ACTIVE'`)).filter(isInterno).map((u) => u.id);
    const prese = circ.length ? await db.many(`SELECT circolare_id, user_id FROM prese_visione WHERE circolare_id = ANY($1::int[]) AND user_id = ANY($2::int[])`, [circ.map((c) => c.id), utenti]) : [];
    const attese = circ.length * utenti.length;
    const conMancanti = circ.filter((c) => prese.filter((p) => p.circolare_id === c.id).length < utenti.length).length;
    const pct = attese ? Math.round((prese.length / attese) * 1000) / 10 : null;
    out.push(indicatore({ chiave: 'circolari_da_confermare', titolo: 'Circolari da confermare', gruppo: G, valore: conMancanti, meglio: 'giu', secondario: pct != null ? { valore: pct, unita: '%', etichetta: 'presa visione' } : null,
      dettaglio: circ.length ? `${circ.length} circolari al personale negli ultimi 90 giorni · presa visione ${String(pct).replace('.', ',')}% (${prese.length} conferme su ${attese} attese, ${utenti.length} utenti interni)` : 'Nessuna circolare al personale pubblicata negli ultimi 90 giorni',
      fonte: 'Circolari, prese di visione del personale', aggiornato: P.oggi }));
  }
  return out;
}

// ------------------------------------------------------------------ composizione e cache
const MODULI_LETTI = ['cash', 'retail', 'finance', 'nc', 'orders', 'shipments', 'referti', 'room', 'business', 'ferie', 'audit', 'ticket', 'circolari'];
const COSTRUTTORI = [['incassi', incassi, 'INCASSI'], ['conto', contoEconomicoMonitor, 'RICAVI_COSTI'], ['finance', processiFinance, 'FINANCE'], ['operations', operations, 'OPERATIONS'], ['retail_flow', retailFlow, 'RETAIL_FLOW'], ['persone', persone, 'PERSONE']];

/** Calcolo completo (senza cache, senza filtri per utente). */
export async function calcolaMonitor({ oggi = oggiRoma() } = {}) {
  const P = periodi(oggi);
  const live = {};
  for (const k of MODULI_LETTI) { const st = await statoModulo(k); live[k] = st === 'LIVE' ? true : st; }
  const S = settimaneMonitor(oggi);
  // una sola lettura dello scadenzario: da lunedì della settimana in corso a 30 giorni da oggi (copre la prossima settimana e lo Scadenziario a 30 giorni)
  let scad;
  try { scad = await scadenzeDirezione({ da: S.corrente.da, a: addGiorni(oggi, 30), oggi, fresco: true }); }   // al più una lettura al minuto (cache del monitor)
  catch (e) { console.warn(`[cockpit:monitor] scadenzario: ${e.message}`); scad = { righe: [], fonti: [], errore: e.message }; }
  const ctx = { oggi, P, live, scad, db: (k) => moduleDb(k) };
  const indicatori = [];
  for (const [nome, fn, gruppo] of COSTRUTTORI) {
    try { indicatori.push(...(await fn(ctx))); }
    catch (e) {
      console.warn(`[cockpit:monitor:${nome}] ${e.message}`);
      indicatori.push(indicatore({ chiave: `${nome}_errore`, titolo: GRUPPI.find((g) => g.key === gruppo).titolo, gruppo, motivo: `Lettura non riuscita: ${String(e.message).slice(0, 160)}` }));
    }
  }
  return { generato_at: new Date().toISOString(), oggi, settimane: S, scad, indicatori, moduli: live };
}

let cache = { at: 0, oggi: null, data: null, promise: null };
export const svuotaCacheMonitor = () => { cache = { at: 0, oggi: null, data: null, promise: null }; serieContoCache = { chiave: null, at: 0, data: null }; };
/** Calcolo in cache per 60 secondi (una sola esecuzione alla volta: più monitor aspettano la stessa). */
export async function monitorInCache({ oggi = oggiRoma(), fresco = false } = {}) {
  if (!fresco && cache.data && cache.oggi === oggi && Date.now() - cache.at < CACHE_MS) return { ...cache.data, cache: { eta_s: Math.round((Date.now() - cache.at) / 1000) } };
  if (!cache.promise) {
    cache.promise = calcolaMonitor({ oggi }).then((d) => { cache = { at: Date.now(), oggi, data: d, promise: null }; return d; }).catch((e) => { cache.promise = null; throw e; });
  }
  const d = await cache.promise;
  return { ...d, cache: { eta_s: 0 } };
}

/** JSON della pagina per l'utente: scadenze dei moduli riservati solo a chi le può vedere (come lo scadenzario), viste ignorate. */
export async function monitorPerUtente(user, opts = {}) {
  const d = await monitorInCache(opts);
  const righe = visibiliA(d.scad.righe || [], user);
  const riservate = (d.scad.righe || []).length - righe.length;
  const admin = user?.level === 'OWNER' || user?.level === 'ADMIN';
  const fontiScad = (d.scad.fonti || []).map((f) => (MODULI_RISERVATI.includes(f.modulo) && !admin && !user?.grants?.[f.modulo] ? { key: f.key, nome: f.nome, stato: 'RISERVATA', nota: 'Riservata a chi ha il modulo' } : { key: f.key, nome: f.nome, stato: f.stato, nota: f.nota, righe: f.righe }));
  return {
    generato_at: d.generato_at, oggi: d.oggi, cache: d.cache, aggiorna_ogni_s: 300,
    scadenze: {
      blocchi: [bloccoScadenze(righe, d.settimane.corrente), bloccoScadenze(righe, d.settimane.prossima)],
      riservate, errore: d.scad.errore || null,
      fonti: { lette: fontiScad.filter((f) => f.stato === 'OK').length, totale: fontiScad.length, non_disponibili: fontiScad.filter((f) => f.stato !== 'OK') },
    },
    gruppi: GRUPPI,
    indicatori: d.indicatori,
    moduli: Object.fromEntries(Object.entries(d.moduli).map(([k, v]) => [k, v === true ? 'LIVE' : v])),
  };
}
