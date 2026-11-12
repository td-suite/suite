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
import { APP_VERSION } from '../version.js';
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
  // i turni del desk di accettazione (generati dal piano dalla v0.68.4, profilo 'Accettazione') non sono sessioni d'ambulatorio: non si segnalano
  const senzaAmb = turni.filter((t) => t.prof_id != null && t.profilo !== 'Accettazione' && (!t.room_id || !idsAmb.has(`${t.sede_id}|${t.room_id}`))).length;
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
  // Laboratorio e Service dal gestionale (Synclab Data API, schema synclab del core): gli indicatori compaiono SOLO se ci sono dati
  // importati; senza dati non compaiono affatto (non sono "non disponibili": la Data API può essere spenta per scelta).
  try {
    const { indicatoriLaboratorio } = await import('./synclab/letture.js');
    const ieri = addGiorni(P.oggi, -1);
    const lab = await indicatoriLaboratorio({ ieri, inizioMese: P.inizio, oggi: P.oggi });
    const agg = lab ? (await many(`SELECT max(finito) AS t FROM synclab.sync_run WHERE esito = 'OK'`))[0]?.t : null;
    const aggTxt = agg ? new Date(agg).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
    if (lab?.accettazioni_ieri != null && lab.disponibilita.requests > 0) out.push(indicatore({ chiave: 'synclab_accettazioni_ieri', titolo: 'Accettazioni ieri (Synclab)', gruppo: G, valore: lab.accettazioni_ieri, meglio: null,
      dettaglio: `Accettazioni del gestionale con data ${itData(ieri)} negli stati della produzione accettata (${lab.stati.join(', ')})`, fonte: `Synclab Data API${aggTxt ? ` (ultima sincronizzazione ${aggTxt})` : ''}`, aggiornato: P.oggi }));
    // v0.68.5 (CEO 10/11/2026): la grandezza del mese è la PRODUZIONE (v0.68.6: accettata); i documenti emessi restano un dato secondario, mai sommato
    if (lab?.produzione_mese && lab.produzione_mese.valore != null) out.push(indicatore({ chiave: 'synclab_produzione_mese', titolo: 'Produzione accettata laboratorio mese (Synclab)', gruppo: G, unita: 'EUR', valore: Number(lab.produzione_mese.valore), meglio: 'su',
      secondario: lab.fatturato_mese?.fatturato != null ? { valore: Number(lab.fatturato_mese.fatturato), unita: 'EUR', etichetta: 'documenti emessi (secondario)' } : { valore: lab.produzione_mese.esami, unita: 'n', etichetta: 'esami' },
      dettaglio: `Produzione accettata dal ${itData(P.inizio)} a oggi, tutti i client: ${lab.produzione_mese.esami} esami${lab.produzione_mese.righe_senza_prezzo ? `, di cui ${lab.produzione_mese.righe_senza_prezzo} senza prezzo` : ''} · ${lab.sconto === 'APPLICA' ? 'netto di riga e sconto di testata' : 'importi di riga (sconto di testata non applicato)'}`,
      nota: 'I documenti emessi sono un dato secondario: non si sommano alla produzione', fonte: `Synclab, produzione accettata (stati ${lab.stati.join(', ')})${aggTxt ? ` (ultima sincronizzazione ${aggTxt})` : ''}`, aggiornato: P.oggi }));
  } catch (e) { console.warn(`[cockpit:monitor] synclab: ${e.message}`); }
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
    const turni = await db.many(`SELECT sede_id, data::text AS data, ora_da, ora_a, room_id, prof_id, profilo FROM turni WHERE mese = $1`, [mese]);
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
  // Retail · TuoTempo: attesa alla prima disponibilità (giorni dal momento dell'allineamento notturno al primo slot libero delle prestazioni
  // online), mediana della rete e mediana per sede dall'ultimo giorno dello storico retail.tuotempo_attivita (docs/RETAIL_TUOTEMPO.md)
  if (ctx.live.retail !== true) out.push(nd('attesa_prima_disponibilita', 'Attesa alla prima disponibilità', 'retail', 'giorni'));
  else {
    const db = ctx.db('retail');
    const ok = (await db.many(`SELECT to_regclass('retail.tuotempo_attivita') IS NOT NULL AS ok`))[0]?.ok;
    const ultimo = ok ? (await db.many('SELECT max(data)::text AS d FROM tuotempo_attivita'))[0]?.d : null;
    if (!ultimo) out.push(indicatore({ chiave: 'attesa_prima_disponibilita', titolo: 'Attesa alla prima disponibilità', gruppo: G, unita: 'giorni', meglio: 'giu', fonte: 'Retail · TuoTempo (prima disponibilità delle prestazioni online)', motivo: 'Nessun allineamento con TuoTempo ancora eseguito (Retail > Connettori, "Allinea adesso")' }));
    else {
      const med = (rows) => { const v = rows.map((x) => Number(x.g)).filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : r2((v[m - 1] + v[m]) / 2); };
      const righe = await db.many(`SELECT t.site_id, s.name AS sede, t.giorni_attesa AS g FROM tuotempo_attivita t LEFT JOIN public.sites s ON s.id = t.site_id WHERE t.data = $1::date`, [ultimo]);
      const perSede = Object.values(righe.filter((x) => x.site_id).reduce((acc, x) => { (acc[x.site_id] ||= { sede: x.sede, rows: [] }).rows.push(x); return acc; }, {}))
        .map((x) => ({ etichetta: x.sede, valore: med(x.rows) })).sort((a, b) => b.valore - a.valore);
      const storia = await db.many(`SELECT data::text AS d, percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS v FROM tuotempo_attivita WHERE data > $1::date - 12 GROUP BY data ORDER BY data`, [ultimo]);
      const rete = med(righe);
      const sett = (await db.many(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS v FROM tuotempo_attivita WHERE data = $1::date - 7`, [ultimo]))[0]?.v;
      out.push(indicatore({ chiave: 'attesa_prima_disponibilita', titolo: 'Attesa alla prima disponibilità', gruppo: G, unita: 'giorni', meglio: 'giu', valore: rete,
        confronto: confronto(rete, sett != null ? Number(sett) : null, { meglio: 'giu', etichetta: 'una settimana prima' }),
        tabella: perSede.slice(0, 8), dettaglio: `Mediana di ${righe.length} prestazioni online · ${perSede.length} ${perSede.length === 1 ? 'sede' : 'sedi'} con l'area abbinata${righe.some((x) => !x.site_id) ? ` · ${righe.filter((x) => !x.site_id).length} prestazioni con il primo slot in un'area non abbinata` : ''}`,
        serie: storia.map((x) => ({ etichetta: ggmm(x.d), valore: r2(Number(x.v)) })), fonte: `Retail · TuoTempo, prima disponibilità del ${ggmm(ultimo)}`, aggiornato: ultimo,
        nota: 'Giorni dall\'allineamento notturno al primo slot libero di ogni prestazione prenotabile online, attribuita alla sede del primo slot; è il dato del "tempo dei pazienti" (Key Entities: nessuna prenotazione letta)' }));
    }
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
  // Profilo dei pazienti del laboratorio (Synclab, proiezione standard: Retail > Profilo dei pazienti): età mediana e quota fuori area
  // del mese in corso, confronto con lo stesso periodo del mese scorso. Compaiono SOLO se ci sono accettazioni importate.
  try {
    const { sintesiProfilo } = await import('./synclab/letture.js');
    const cur = await sintesiProfilo(P.inizio, P.oggi);
    if (cur) {
      const prev = await sintesiProfilo(P.mese_prec.da, P.mese_prec.a);
      const fonte = 'Synclab Data API, accettazioni del laboratorio (proiezione standard, nessuna identità)';
      const et = 'stesso periodo del mese scorso';
      out.push(indicatore({ chiave: 'synclab_eta_mediana', titolo: 'Età mediana pazienti laboratorio (mese)', gruppo: G, unita: 'anni', valore: cur.eta_mediana, meglio: null,
        confronto: confronto(cur.eta_mediana, prev?.eta_mediana, { meglio: null, etichetta: et }),
        dettaglio: cur.accettazioni ? `${cur.accettazioni} accettazioni del mese · donne ${cur.quota_donne ?? 0}% · uomini ${cur.quota_uomini ?? 0}% · età non disponibile ${cur.quota_eta_nd ?? 0}%` : null,
        nota: 'Accettazioni, non persone: età alla data dell\'accettazione', fonte, aggiornato: P.oggi, motivo: cur.accettazioni ? 'Nessuna accettazione del mese con l\'età disponibile' : 'Nessuna accettazione del laboratorio nel mese in corso' }));
      out.push(indicatore({ chiave: 'synclab_fuori_area', titolo: 'Quota fuori area', gruppo: G, unita: '%', valore: cur.quota_fuori_area, meglio: null,
        confronto: confronto(cur.quota_fuori_area, prev?.quota_fuori_area, { meglio: null, unita: '%', etichetta: et }),
        dettaglio: cur.area_valutabili ? `${cur.fuori_area} accettazioni su ${cur.area_valutabili} valutabili da comune e provincia diversi da quelli della sede` : null,
        nota: 'Fuori area = comune di residenza diverso da quello della sede e provincia diversa; valutabili le accettazioni con sede abbinata e provenienza nota', fonte, aggiornato: P.oggi,
        motivo: cur.accettazioni ? 'Nessuna accettazione del mese con sede abbinata e provenienza nota' : 'Nessuna accettazione del laboratorio nel mese in corso' }));
    }
  } catch (e) { console.warn(`[cockpit:monitor] profilo pazienti: ${e.message}`); }
  return out;
}

async function persone(ctx) {
  const { P } = ctx;
  const G = 'PERSONE';
  const out = [];
  const nd = (k, t, mod, u = 'n') => indicatore({ chiave: k, titolo: t, gruppo: G, unita: u, fonte: NOMI_MODULI[mod], motivo: motivoNonLive(mod, ctx.live[mod]) });
  // anagrafica della Suite: sempre leggibile
  const p = (await many(`SELECT count(*) FILTER (WHERE kind = 'DIPENDENTE')::int AS dip, 0::int AS dir,
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

// ------------------------------------------------------------------ schermo unico (v0.68.1, v0.68.5, ridisegnato v0.68.6)
// v0.68.6 (CEO 10/11/2026): "Troppa enfasi sulle attività in scadenza, poca sui numeri e sui grafici della produzione che mi interessano ben
// di più. Aggiungi almeno una statistica significativa per ogni widget." Sempre UNA schermata senza scorrimento (1920×1080 e 1366×768):
//   - ~60% produzione: 4 grandi KPI (`kpi`: Ricavi oggi, Ricavi del mese, Produzione laboratorio oggi e del mese), ciascuno con il confronto
//     con l'anno prima e statistiche (vs media giornaliera del mese, proiezione a fine mese = media per giorno lavorativo × giorni lavorativi
//     del mese, % sul mese precedente allo stesso giorno); `grafici`: barre giornaliere del mese della produzione laboratorio (B2B e in sede
//     impilate, linea della media e del mese precedente, B2C GIPO affiancato), andamento mensile degli ultimi 12 mesi, TOP 5 clienti Service,
//     ripartizione B2B / in sede / B2C;
//   - ~25% `operativita`: tessere compatte, ognuna con il numero e una statistica significativa;
//   - ~15% `scadenze_sintesi` (per utente, in monitorPerUtente): contatori di questa settimana, della prossima e delle scadute e le 3 più vicine.
// Produzione laboratorio = TUTTO Synclab (B2B + Laboratorio in sede), PRODUZIONE ACCETTATA (lib/synclab/letture.js, stati e sconto di testata
// dalle impostazioni del connettore); Ricavi = B2C GIPO + produzione laboratorio. Ogni numero ha la sua fonte; un dato che manca è null con
// "non disponibile" e il motivo, mai uno zero finto (i mesi e i giorni prima del primo dato importato sono null).
// I campi della v0.68.5 (ricavi, laboratorio, top5, andamento, retail, persone) restano nel JSON con le stesse chiavi.
export const MAX_RIGHE_SCHERMO = 6;
const G_SCHERMO = 'SCHERMO';
const GIORNI_SETT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Somma dichiarata di due componenti (B2C + laboratorio): null se mancano entrambe; parziale se ne manca una. */
export function sommaComponenti(b2c, b2b) {
  const vals = [b2c, b2b].filter((x) => x != null && !Number.isNaN(Number(x)));
  return { valore: vals.length ? r2(vals.reduce((t, x) => t + Number(x), 0)) : null, parziale: vals.length === 1, mancanti: [b2c == null ? 'B2C' : null, b2b == null ? 'laboratorio' : null].filter(Boolean) };
}

/**
 * TOP N clienti B2B per fatturato del periodo: quota sul totale B2B (%) e variazione % sullo stesso periodo del mese prima.
 * cur / prev: [{ chiave, cliente, fatturato }]; totale: fatturato B2B complessivo del periodo.
 */
export function topClienti(cur = [], prev = [], totale = null, n = 5) {
  const pm = new Map(prev.map((x) => [String(x.chiave), x.fatturato]));
  return [...cur].filter((x) => x.fatturato != null).sort((a, b) => Number(b.fatturato) - Number(a.fatturato) || String(a.cliente).localeCompare(String(b.cliente), 'it')).slice(0, n)
    .map((x, i) => {
      const p = pm.has(String(x.chiave)) ? pm.get(String(x.chiave)) : null;
      return { pos: i + 1, chiave: String(x.chiave), cliente: x.cliente, fatturato: r2(x.fatturato), quota: totale && Number(totale) > 0 ? Math.round((Number(x.fatturato) / Number(totale)) * 1000) / 10 : null,
        mese_prima: p == null ? null : r2(p), variazione: p == null || !Number(p) ? null : Math.round(((Number(x.fatturato) - Number(p)) / Math.abs(Number(p))) * 1000) / 10 };
    });
}

/** Giorni lavorativi (lunedì-venerdì, festivi non considerati: stessa regola del pro quota del Business Hub) fra da e a compresi. */
export function giorniLavorativiTra(da, a) {
  if (!da || !a || a < da) return 0;
  let n = 0;
  for (let d = da; d <= a; d = addGiorni(d, 1)) { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
const pctVar = (cur, prev) => (cur == null || prev == null || !Number(prev) ? null : Math.round(((Number(cur) - Number(prev)) / Math.abs(Number(prev))) * 1000) / 10);
const pct1 = (num, den) => (num == null || den == null || !Number(den) ? null : Math.round((Number(num) / Number(den)) * 1000) / 10);

/**
 * Statistiche del mese (pure, testate): media per giorno lavorativo dei giorni COMPLETI (dal 1° a ieri), proiezione a fine mese (media ×
 * giorni lavorativi del mese) e confronto di oggi con la media. giorni: { 'AAAA-MM-GG': valore } (valori null = non disponibili).
 */
export function statisticheMese({ giorni = {}, oggi, valoreOggi = null }) {
  const inizio = `${oggi.slice(0, 7)}-01`, fine = fineMese(oggi), ieri = addGiorni(oggi, -1);
  const glFatti = giorniLavorativiTra(inizio, ieri), glMese = giorniLavorativiTra(inizio, fine);
  const valori = Object.entries(giorni).filter(([d]) => d >= inizio && d <= ieri);
  const completi = valori.length > 0 && valori.every(([, v]) => v != null);
  const fatto = completi ? valori.reduce((t, [, v]) => t + Number(v), 0) : null;
  const media = glFatti > 0 && fatto != null ? r2(fatto / glFatti) : null;
  return {
    giorni_lavorativi_fatti: glFatti, giorni_lavorativi_mese: glMese, fino_a_ieri: fatto == null ? null : r2(fatto), media,
    proiezione: media == null ? null : r2((fatto / glFatti) * glMese),
    vs_media: media == null || valoreOggi == null ? null : pctVar(valoreOggi, media),
    motivo: glFatti === 0 ? 'nessun giorno lavorativo completo nel mese (si calcola da domani)' : fatto == null ? 'dati dei giorni del mese non completi' : null,
  };
}

/** Media dello stesso giorno della settimana nelle `settimane` precedenti, solo nei giorni coperti dai dati (dal = primo giorno disponibile). */
export function mediaStessoGiorno({ serie = {}, oggi, settimane = 8, dal = null }) {
  const vals = [];
  for (let k = 1; k <= settimane; k++) { const d = addGiorni(oggi, -7 * k); if (dal && d < dal) break; if (serie[d] != null) vals.push(Number(serie[d])); }
  return { n: vals.length, media: vals.length ? r2(vals.reduce((t, v) => t + v, 0) / vals.length) : null, giorno: GIORNI_SETT[new Date(`${oggi}T12:00:00Z`).getUTCDay()] };
}

/** Sintesi delle scadenze per la fascia bassa: conteggi di questa settimana, della prossima e delle scadute, le 3 più vicine da oggi. */
export function sintesiScadenze(righe, settimane, oggi, n = 3) {
  const dentro = (s) => righe.filter((r) => r.data >= s.da && r.data <= s.a);
  const prossime = ordina(righe.filter((r) => r.data >= oggi)).slice(0, n);
  return {
    questa: dentro(settimane.corrente).length, prossima: dentro(settimane.prossima).length, scadute: righe.filter((r) => r.stato === 'SCADUTA').length,
    critiche: righe.filter((r) => r.data >= oggi && r.data <= settimane.prossima.a && ['CRITICA', 'ALTA'].includes(r.gravita)).length,
    periodo_questa: settimane.corrente.periodo, periodo_prossima: settimane.prossima.periodo,
    prime: prossime.map((r) => ({ id: r.id, data: r.data, giorni: r.giorni, stato: r.stato, gravita: r.gravita, titolo: r.titolo, oggetto: r.oggetto, modulo_nome: r.modulo_nome, area: r.area })),
  };
}

const n0 = (v) => Number(v || 0).toLocaleString('it-IT', { maximumFractionDigits: 2, useGrouping: 'always' });
const dataBreve = (d) => (d ? itData(String(d).slice(0, 10)).slice(0, 5) : '');
const quandoIso = (t) => (t ? new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : null);
const stat = (etichetta, valore, unita, testo, { meglio = 'su' } = {}) => ({ etichetta, valore: valore == null ? null : (typeof valore === 'number' ? r2(valore) : valore), unita, testo: testo || null,
  esito: valore == null || unita === 'EUR' || unita === 'n' || !meglio ? 'neutro' : Number(valore) === 0 ? 'neutro' : (Number(valore) > 0) === (meglio === 'su') ? 'meglio' : 'peggio', non_disponibile: valore == null });

async function schermoMonitor(ctx, indicatori) {
  const { P } = ctx;
  const ieri = addGiorni(P.oggi, -1);
  const ap = (d) => { const [y, m, g] = d.split('-').map(Number); const fine = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(g, fine)).padStart(2, '0')}`; };
  const oggiAP = ap(P.oggi), inizioAP = ap(P.inizio);
  const byKey = Object.fromEntries(indicatori.map((x) => [x.chiave, x]));
  const out = { fonti: [], ricavi: [], laboratorio: [], top5: null, andamento: null, retail: [], persone: [], kpi: [], grafici: {}, operativita: [], regola: null };
  const etAP = `stesso giorno dell'anno prima (${dataBreve(oggiAP)}/${oggiAP.slice(0, 4)})`;
  const etMeseAP = `stesso periodo dell'anno prima (${dataBreve(inizioAP)}-${dataBreve(P.anno_prec.a)}/${P.anno_prec.a.slice(0, 4)})`;
  const meseNome = (mk) => `${MESI_LUNGHI[Number(mk.slice(5, 7)) - 1]} ${mk.slice(0, 4)}`;
  const etMP = `stesso periodo di ${meseNome(P.mese_prec.da.slice(0, 7))} (${dataBreve(P.mese_prec.da)}-${dataBreve(P.mese_prec.a)})`;
  const inizioPrec = P.mese_prec.da, finePrec = fineMese(P.mese_prec.da);

  // ---- GIPO (Retail): vendite nette e accettazioni dei privati (righe senza committente B2B, niente dimostrative)
  let gipo = null, gipoNota = null;
  if (ctx.live.retail !== true) gipoNota = motivoNonLive('retail', ctx.live.retail);
  else {
    try {
      const db = ctx.db('retail');
      const W = `s.source = 'GIPO' AND s.b2b_customer_id IS NULL`;
      const q = async (da, a) => (await db.many(`SELECT coalesce(sum(s.net_amount), 0) AS v, count(DISTINCT s.external_ref)::int AS acc, count(*)::int AS righe FROM sales s WHERE ${W} AND s.sale_date BETWEEN $1::date AND $2::date`, [da, a]))[0];
      const [g0, g0p, gm, gmp, gmPrec] = [await q(P.oggi, P.oggi), await q(oggiAP, oggiAP), await q(P.inizio, P.oggi), await q(inizioAP, P.anno_prec.a), await q(P.mese_prec.da, P.mese_prec.a)];
      const ultima = (await db.many(`SELECT max(sale_date)::text AS d, min(sale_date)::text AS prima FROM sales WHERE source = 'GIPO'`))[0] || {};
      const imp = (await db.many(`SELECT max(created_at) AS t FROM import_batches WHERE source = 'GIPO'`).catch(() => [{}]))[0]?.t || null;
      const fuori = async (da, a) => (await db.many(`WITH x AS (SELECT DISTINCT s.external_ref, nullif(lower(trim(c.city)), '') AS comune, nullif(upper(trim(c.province)), '') AS provincia,
            nullif(lower(trim(st.city)), '') AS sede_comune, nullif(upper(trim(st.province)), '') AS sede_provincia
          FROM sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN public.sites st ON st.id = s.site_id WHERE ${W} AND s.sale_date BETWEEN $1::date AND $2::date)
        SELECT count(*) FILTER (WHERE comune IS NOT NULL AND sede_comune IS NOT NULL AND (comune = sede_comune OR (provincia IS NOT NULL AND sede_provincia IS NOT NULL)))::int AS valutabili,
               count(*) FILTER (WHERE comune IS NOT NULL AND sede_comune IS NOT NULL AND comune <> sede_comune AND provincia IS NOT NULL AND sede_provincia IS NOT NULL AND provincia <> sede_provincia)::int AS fuori FROM x`, [da, a]))[0];
      const giorniG = await db.many(`SELECT s.sale_date::text AS d, sum(s.net_amount) AS v FROM sales s WHERE ${W} AND s.sale_date BETWEEN $1::date AND $2::date GROUP BY 1`, [P.inizio, P.oggi]);
      const mesiG = await db.many(`SELECT to_char(s.sale_date, 'YYYY-MM') AS mk, sum(s.net_amount) AS v FROM sales s WHERE ${W} AND s.sale_date BETWEEN $1::date AND $2::date GROUP BY 1`, [`${P.mesi12[0]}-01`, P.oggi]);
      const perSede = await db.many(`SELECT s.site_id, sum(s.net_amount) AS v FROM sales s WHERE ${W} AND s.sale_date BETWEEN $1::date AND $2::date AND s.site_id IS NOT NULL GROUP BY 1`, [P.inizio, P.oggi]);
      gipo = { oggi: g0, oggi_ap: g0p, mese: gm, mese_ap: gmp, mese_prec: gmPrec, ultima: ultima.d || null, prima: ultima.prima || null, import: imp, fuori: await fuori(P.inizio, P.oggi), fuori_prec: await fuori(P.mese_prec.da, P.mese_prec.a),
        giorni: Object.fromEntries(giorniG.map((x) => [x.d, Number(x.v)])), mesi: Object.fromEntries(mesiG.map((x) => [x.mk, Number(x.v)])), per_sede: perSede };
    } catch (e) { gipoNota = `Retail · GIPO: lettura non riuscita (${String(e.message).slice(0, 120)})`; }
  }
  // ---- Synclab (v0.68.6): PRODUZIONE ACCETTATA di tutto il laboratorio (B2B + Laboratorio in sede), stati e sconto di testata dalle impostazioni
  let syn = null, synNota = null;
  try {
    const L = await import('./synclab/letture.js');
    const d = await L.disponibilita();
    if (!d || !d.requests) synNota = 'Synclab: nessuna accettazione importata (Amministrazione > Connettori > StudioLAB > Dati Synclab)';
    else {
      const pv = (await many(`SELECT value FROM public.app_settings WHERE key = 'synclab_privati_in_b2c'`).catch(() => []))[0];
      const privatiInB2c = !(pv && String(typeof pv.value === 'string' ? pv.value : JSON.stringify(pv.value)).replace(/"/g, '').trim().toLowerCase() === 'false');
      const { stati, sconto } = await L.regolaProduzione();
      const o = { privatiInB2c, stati, sconto };
      // per ripartizione: { totale, B2B, LAB_SEDE }
      const rip = async (da, a) => { const x = await L.produzioneErogata({ da, a, per: 'ripartizione', ...o }); const by = Object.fromEntries(x.righe.map((r) => [r.chiave, r])); return { totale: x.totale, B2B: by.B2B || null, LAB_SEDE: by.LAB_SEDE || null }; };
      const [p0, p0p, pm, pmp, pmPrec] = [await rip(P.oggi, P.oggi), await rip(oggiAP, oggiAP), await rip(P.inizio, P.oggi), await rip(inizioAP, P.anno_prec.a), await rip(P.mese_prec.da, P.mese_prec.a)];
      // B2B solo (righe della v0.68.5: produzione B2B di oggi e del mese, TOP 5 e andamento B2B)
      const b2b = (da, a) => L.produzioneErogata({ da, a, ripartizione: 'B2B', ...o });
      const [b0, b0p, bm, bmp] = [await b2b(P.oggi, P.oggi), await b2b(oggiAP, oggiAP), await b2b(P.inizio, P.oggi), await b2b(inizioAP, P.anno_prec.a)];
      const top = await L.topClientiProduzione({ da: P.inizio, a: P.oggi, prec: P.mese_prec, n: 5, ripartizione: 'B2B', ...o });
      const gB2B = await L.produzioneGiornaliera({ da: P.inizio, a: P.oggi, ripartizione: 'B2B', ...o });
      const gSede = privatiInB2c ? await L.produzioneGiornaliera({ da: P.inizio, a: P.oggi, ripartizione: 'LAB_SEDE', ...o }) : null;
      const gPrec = await L.produzioneGiornaliera({ da: inizioPrec, a: finePrec, ...o });
      const g8 = await L.produzioneGiornaliera({ da: addGiorni(P.oggi, -56), a: P.oggi, ...o });   // accettazioni dello stesso giorno della settimana
      const mB2B = await L.produzioneErogata({ da: `${P.mesi12[0]}-01`, a: P.oggi, per: 'mese', ripartizione: 'B2B', ...o });
      const mSede = privatiInB2c ? await L.produzioneErogata({ da: `${P.mesi12[0]}-01`, a: P.oggi, per: 'mese', ripartizione: 'LAB_SEDE', ...o }) : null;
      const clientiMese = await L.produzioneErogata({ da: P.inizio, a: P.oggi, per: 'cliente', ...o });
      const qd = (da, a) => L.quadroLaboratorio({ da, a, privatiInB2c, stati, sconto });
      const [qi, qo, qm] = [await qd(ieri, ieri), await qd(P.oggi, P.oggi), await qd(P.inizio, P.oggi)];
      const docMese = d.invoices ? await L.fatturatoClientiMesi({ da: P.inizio, a: P.oggi, privatiInB2c, ripartizione: 'B2B' }).catch(() => null) : null;
      const prima = (await many(`SELECT min(date)::text AS d FROM synclab.requests WHERE disponibilita = 'ATTIVO' AND deleted_at IS NULL`).catch(() => []))[0]?.d || null;
      const sediLab = privatiInB2c ? (await L.ripartizioneClienti({ privatiInB2c })).filter((c) => c.ripartizione === 'LAB_SEDE' && c.site_id).map((c) => Number(c.site_id)) : [];
      const tot = (q, k) => (q.LAB_SEDE?.[k] || 0) + (q.B2B?.[k] || 0);
      const totAP = (q, k) => (q.LAB_SEDE?.anno_prima?.[k] || 0) + (q.B2B?.anno_prima?.[k] || 0);
      const stato = await L.statoCopia().catch(() => null);
      const run = (await many(`SELECT max(finito) AS t FROM synclab.sync_run WHERE esito = 'OK'`).catch(() => []))[0]?.t || null;
      const cpAcc = stato?.insiemi?.requests?.checkpoint_at || null;
      syn = { d, L, privatiInB2c, stati, sconto, p0, p0p, pm, pmp, pmPrec, b0, b0p, bm, bmp, top, gB2B, gSede, gPrec, g8, mB2B, mSede, clientiMese, qi, qo, qm, docMese, tot, totAP, stato, run, cpAcc, prima, sediLab,
        fonteProd: L.fonteProduzione(stati, cpAcc || run, sconto), aggiornato: L.aggiornatoAlle(cpAcc || run, P.oggi), regolaBreve: `stati ${stati.join(', ')} · ${L.descriviSconto(sconto)}` };
    }
  } catch (e) { synNota = `Synclab: lettura non riuscita (${String(e.message).slice(0, 120)})`; }

  out.regola = syn ? { stati: syn.stati, sconto: syn.sconto, testo: `Produzione accettata: ${syn.regolaBreve}` } : null;
  // ---- 1. fonti con la data di ciascuna
  out.fonti.push({ chiave: 'GIPO', nome: 'GIPO', data: gipo ? (gipo.ultima || null) : null, testo: gipo ? (gipo.ultima ? `vendite al ${dataBreve(gipo.ultima)}${gipo.import ? ` · import ${quandoIso(gipo.import)}` : ''}` : 'nessuna vendita importata') : gipoNota, ok: Boolean(gipo?.ultima) });
  const tt = byKey.attesa_prima_disponibilita;
  out.fonti.push({ chiave: 'TUOTEMPO', nome: 'TuoTempo', data: tt?.aggiornato || null, testo: tt?.non_disponibile ? tt.motivo : tt?.aggiornato ? `prima disponibilità del ${dataBreve(tt.aggiornato)}` : 'nessun allineamento', ok: Boolean(tt && !tt.non_disponibile) });
  out.fonti.push({ chiave: 'SYNCLAB', nome: 'Synclab', data: syn?.cpAcc || syn?.run || null, testo: syn ? `accettazioni ${syn.aggiornato || 'mai aggiornate'}` : synNota, ok: Boolean(syn) });

  // ---- serie giornaliere del mese (laboratorio e B2C), con null prima del primo dato importato
  const giorniMese = []; for (let x = P.inizio; x <= P.oggi; x = addGiorni(x, 1)) giorniMese.push(x);
  const valG = (g, d) => { const x = g?.giorni?.find((y) => y.giorno === d); return x ? Number(x.valore || 0) : 0; };
  const labGiorno = {}, ricGiorno = {}, gipoGiorno = {};
  for (const x of giorniMese) {
    labGiorno[x] = syn ? (syn.prima && x < syn.prima ? null : r2(valG(syn.gB2B, x) + valG(syn.gSede, x))) : null;
    gipoGiorno[x] = gipo ? (gipo.prima && x < gipo.prima ? null : r2(gipo.giorni[x] || 0)) : null;
    ricGiorno[x] = labGiorno[x] == null && gipoGiorno[x] == null ? null : r2(Number(labGiorno[x] || 0) + Number(gipoGiorno[x] || 0));
  }
  // doppio conteggio possibile (punto aperto): GIPO ha vendite nelle stesse sedi del Laboratorio in sede e nei dati GIPO non c'è un criterio
  // certo per riconoscere le vendite di laboratorio (la linea di prodotto LAB è dedotta dal testo all'import): nulla viene tolto, si dichiara
  const gipoInSede = gipo && syn?.sediLab?.length ? r2(gipo.per_sede.filter((x) => syn.sediLab.includes(Number(x.site_id))).reduce((t, x) => t + Number(x.v || 0), 0)) : 0;
  const notaDoppio = syn?.privatiInB2c && Number(syn.pm.LAB_SEDE?.valore || 0) > 0 && gipoInSede > 0
    ? `Possibile doppio conteggio: GIPO ha ${eur(gipoInSede)} di vendite del mese nelle sedi con Laboratorio in sede e i dati GIPO non hanno un criterio certo per separare le vendite di laboratorio; nulla è stato tolto (punto aperto, docs/COCKPIT.md)` : null;

  // ---- 2. Ricavi (v0.68.6): B2C GIPO + produzione laboratorio StudioLab (TUTTA: B2B + Laboratorio in sede)
  const fGipo = gipo ? `GIPO vendite nette${gipo.ultima ? ` (al ${dataBreve(gipo.ultima)})` : ''}` : null;
  const fSyn = syn ? `Synclab produzione accettata (${syn.regolaBreve}; ${syn.aggiornato || 'copia'})` : null;
  const vTot = (x) => (x ? Number(x.totale.valore || 0) : null);
  const vRip = (x, k) => (x ? Number(x[k]?.valore || 0) : null);
  const ricavo = (chiave, titolo, b2c, b2cAP, lab, labAP, et, extra = {}) => {
    const s0 = sommaComponenti(b2c, lab), sp = sommaComponenti(b2cAP, labAP);
    const motivo = [gipoNota, synNota].filter(Boolean).join(' · ');
    return indicatore({ chiave, titolo, gruppo: G_SCHERMO, unita: 'EUR', valore: s0.valore, confronto: s0.valore != null && sp.valore != null ? confronto(s0.valore, sp.valore, { etichetta: et }) : null,
      parti: [{ etichetta: 'B2C GIPO', valore: b2c == null ? null : r2(b2c) }, { etichetta: 'Laboratorio StudioLab', valore: lab == null ? null : r2(lab) }],
      dettaglio: `Ricavi = B2C (GIPO, vendite nette) + produzione laboratorio StudioLab (tutto Synclab: B2B e Laboratorio in sede, produzione accettata)${s0.parziale ? ` · parziale: manca ${s0.mancanti.join(' e ')}` : ''}`,
      fonte: [fGipo, fSyn].filter(Boolean).join(' + ') || 'GIPO + Synclab', aggiornato: P.oggi, nota: [s0.parziale ? motivo : null, notaDoppio].filter(Boolean).join(' · ') || null, motivo: motivo || 'Nessuna fonte di ricavo', ...extra });
  };
  // un periodo di confronto anteriore al primo dato importato non vale zero: non è disponibile (null), mai uno zero finto
  const copreS = (d) => Boolean(syn) && (!syn.prima || syn.prima <= d), copreG = (d) => Boolean(gipo) && (!gipo.prima || gipo.prima <= d);
  const confrontabile = (d) => (!gipo || copreG(d)) && (!syn || copreS(d));
  const rOggi = ricavo('ricavi_oggi', 'Ricavi di oggi', gipo ? Number(gipo.oggi.v) : null, confrontabile(oggiAP) && gipo ? Number(gipo.oggi_ap.v) : null, syn ? vTot(syn.p0) : null, confrontabile(oggiAP) && syn ? vTot(syn.p0p) : null, etAP);
  const rMese = ricavo('ricavi_mese', 'Ricavi del mese', gipo ? Number(gipo.mese.v) : null, confrontabile(inizioAP) && gipo ? Number(gipo.mese_ap.v) : null, syn ? vTot(syn.pm) : null, confrontabile(inizioAP) && syn ? vTot(syn.pmp) : null, etMeseAP);
  out.ricavi.push(rOggi, rMese);

  // ---- 3. KPI grandi con le statistiche
  const glTesto = (s) => `${s.giorni_lavorativi_fatti} giorni lavorativi completi (lun-ven) dal ${dataBreve(P.inizio)} a ieri`;
  const statMedia = (s) => stat('vs media giornaliera del mese', s.vs_media, '%', s.media == null ? `non disponibile: ${s.motivo}` : `media ${eur(s.media)} per giorno lavorativo · ${glTesto(s)}`);
  const statProiezione = (s) => stat('proiezione a fine mese', s.proiezione, 'EUR', s.proiezione == null ? `non disponibile: ${s.motivo}` : `media ${eur(s.media)} × ${s.giorni_lavorativi_mese} giorni lavorativi del mese`);
  const statMesePrima = (cur, prev) => stat('vs mese precedente allo stesso giorno', pctVar(cur, prev), '%', prev == null ? 'non disponibile: mese precedente senza dati' : `${etMP}: ${eur(prev)}`);
  const sRic = statisticheMese({ giorni: ricGiorno, oggi: P.oggi, valoreOggi: rOggi.valore });
  const sLab = statisticheMese({ giorni: labGiorno, oggi: P.oggi, valoreOggi: syn ? vTot(syn.p0) : null });
  const ricMesePrec = confrontabile(P.mese_prec.da) ? sommaComponenti(gipo ? Number(gipo.mese_prec.v) : null, syn ? vTot(syn.pmPrec) : null).valore : null;
  const kpi = (x, statistiche, extra = {}) => ({ ...x, statistiche: x.non_disponibile ? [] : statistiche, ...extra });
  out.kpi.push(kpi(rOggi, [statMedia(sRic)]));
  out.kpi.push(kpi(rMese, [statProiezione(sRic), statMesePrima(rMese.valore, ricMesePrec)]));
  const ndLab = (chiave, titolo) => indicatore({ chiave, titolo, gruppo: G_SCHERMO, unita: 'EUR', fonte: 'Synclab Data API', motivo: synNota || 'Synclab non disponibile' });
  if (!syn) out.kpi.push({ ...ndLab('lab_oggi', 'Produzione laboratorio oggi'), statistiche: [] }, { ...ndLab('lab_mese', 'Produzione laboratorio del mese'), statistiche: [] });
  else {
    const partiLab = (x) => (syn.privatiInB2c ? [{ etichetta: 'B2B (Service)', valore: r2(vRip(x, 'B2B')) }, { etichetta: 'Laboratorio in sede', valore: r2(vRip(x, 'LAB_SEDE')) }] : [{ etichetta: 'B2B (tutto Synclab)', valore: r2(vTot(x)) }]);
    const det = (x) => `${n0(x.totale.accettazioni)} accettazioni · ${n0(x.totale.esami)} esami${x.totale.righe_senza_prezzo ? `, di cui ${n0(x.totale.righe_senza_prezzo)} senza prezzo` : ''}${x.totale.sconto_testata ? ` · sconti di testata ${eur(x.totale.sconto_testata)} ${syn.sconto === 'APPLICA' ? 'applicati' : 'non applicati'}` : ''}`;
    const labO = indicatore({ chiave: 'lab_oggi', titolo: 'Produzione laboratorio oggi', gruppo: G_SCHERMO, unita: 'EUR', valore: vTot(syn.p0), parti: partiLab(syn.p0),
      confronto: copreS(oggiAP) ? confronto(vTot(syn.p0), vTot(syn.p0p), { etichetta: etAP }) : null, dettaglio: det(syn.p0), fonte: syn.fonteProd, aggiornato: P.oggi });
    const labM = indicatore({ chiave: 'lab_mese', titolo: 'Produzione laboratorio del mese', gruppo: G_SCHERMO, unita: 'EUR', valore: vTot(syn.pm), parti: partiLab(syn.pm),
      confronto: copreS(inizioAP) ? confronto(vTot(syn.pm), vTot(syn.pmp), { etichetta: etMeseAP }) : null, dettaglio: det(syn.pm), fonte: syn.fonteProd, aggiornato: P.oggi });
    out.kpi.push(kpi(labO, [statMedia(sLab)]), kpi(labM, [statProiezione(sLab), statMesePrima(vTot(syn.pm), copreS(P.mese_prec.da) ? vTot(syn.pmPrec) : null)]));
  }

  // ---- 4. Laboratorio (celle della v0.68.5, conservate nel JSON)
  const nd = (chiave, titolo, unita = 'n') => indicatore({ chiave, titolo, gruppo: G_SCHERMO, unita, fonte: 'Synclab Data API', motivo: synNota || 'Synclab non disponibile' });
  if (!syn) {
    out.laboratorio.push(nd('lab_acc_ieri', 'Accettazioni ieri'), nd('lab_acc_oggi', 'Accettazioni oggi'), nd('lab_acc_mese', 'Accettazioni del mese'), nd('lab_esami_mese', 'Esami del mese'), nd('lab_prod_oggi', 'Produzione B2B oggi', 'EUR'), nd('lab_prod_mese', 'Produzione B2B del mese', 'EUR'));
    out.top5 = { righe: [], non_disponibile: true, motivo: synNota, fonte: 'Synclab Data API' };
    out.andamento = { giorni: [], non_disponibile: true, motivo: synNota };
  } else {
    const fonteL = `Synclab, produzione accettata (stati ${syn.stati.join(', ')}), ${syn.aggiornato || 'copia'}`;
    const parti = (q, k) => [{ etichetta: 'B2B', valore: q.B2B?.[k] || 0 }, { etichetta: 'in sede', valore: q.LAB_SEDE?.[k] || 0 }];
    const lab = (chiave, titolo, q, k, et, det) => indicatore({ chiave, titolo, gruppo: G_SCHERMO, valore: syn.tot(q, k), meglio: null, parti: syn.privatiInB2c ? parti(q, k) : null,
      confronto: confronto(syn.tot(q, k), syn.totAP(q, k), { meglio: null, etichetta: et }), dettaglio: det || `Accettazioni di tutti i client${syn.privatiInB2c ? ' (B2B e Laboratorio in sede)' : ''} · registrate ${syn.tot(q, 'registrate')}`, fonte: fonteL, aggiornato: P.oggi });
    out.laboratorio.push(lab('lab_acc_ieri', 'Accettazioni ieri', syn.qi, 'accettazioni', `stesso giorno dell'anno prima`));
    out.laboratorio.push(lab('lab_acc_oggi', 'Accettazioni oggi', syn.qo, 'accettazioni', etAP));
    out.laboratorio.push(lab('lab_acc_mese', 'Accettazioni del mese', syn.qm, 'accettazioni', etMeseAP));
    out.laboratorio.push(lab('lab_esami_mese', 'Esami del mese', syn.qm, 'esami', etMeseAP, `Righe d'esame non cancellate, comprese ${n0(syn.tot(syn.qm, 'righe_senza_prezzo'))} senza prezzo`));
    const senza = (x) => (x.totale.righe_senza_prezzo ? ` · ${x.totale.righe_senza_prezzo} esami senza prezzo` : '');
    const prodB2B = (chiave, titolo, x, xp, et, secondario = null) => indicatore({ chiave, titolo, gruppo: G_SCHERMO, unita: 'EUR', valore: Number(x.totale.valore || 0),
      secondario: secondario || { valore: x.totale.esami || 0, unita: 'n', etichetta: 'esami' },
      confronto: confronto(Number(x.totale.valore || 0), Number(xp.totale.valore || 0), { etichetta: et }),
      dettaglio: `${x.totale.accettazioni} accettazioni · ${syn.L.descriviSconto(syn.sconto)}${senza(x)}`, fonte: syn.fonteProd, aggiornato: P.oggi });
    out.laboratorio.push(prodB2B('lab_prod_oggi', 'Produzione B2B oggi', syn.b0, syn.b0p, etAP));
    const doc = syn.docMese?.totale?.fatturato;
    out.laboratorio.push(prodB2B('lab_prod_mese', 'Produzione B2B del mese', syn.bm, syn.bmp, etMeseAP, doc != null ? { valore: Number(doc), unita: 'EUR', etichetta: 'documenti emessi (secondario, non sommati)' } : null));
    out.top5 = { righe: syn.top.righe.map((x) => ({ ...x, produzione: x.valore })), totale_b2b: syn.top.totale, clienti: syn.top.clienti,
      fonte: `${syn.fonteProd} · % sul totale B2B del mese · variazione sullo stesso periodo del mese prima (${dataBreve(P.mese_prec.da)}-${dataBreve(P.mese_prec.a)})` };
    out.andamento = { titolo: 'Produzione B2B giorno per giorno', giorni: syn.gB2B.giorni.map((g) => ({ giorno: g.giorno, valore: g.valore == null ? 0 : r2(g.valore), esami: g.esami })),
      totale: syn.gB2B.totale.valore, fonte: syn.fonteProd };
  }

  // ---- 5. grafici della produzione
  const precPerGiorno = syn ? Object.fromEntries(syn.gPrec.giorni.map((g) => [Number(g.giorno.slice(8, 10)), syn.prima && g.giorno < syn.prima ? null : r2(Number(g.valore || 0))])) : {};
  out.grafici.giornaliero = !syn && !gipo ? { non_disponibile: true, motivo: [synNota, gipoNota].filter(Boolean).join(' · ') || 'Nessuna fonte' } : {
    titolo: 'Produzione giorno per giorno', mese: P.oggi.slice(0, 7), oggi: P.oggi,
    giorni: giorniMese.map((x) => ({ giorno: x, b2b: syn ? (syn.prima && x < syn.prima ? null : r2(valG(syn.gB2B, x))) : null, sede: syn?.gSede ? (syn.prima && x < syn.prima ? null : r2(valG(syn.gSede, x))) : null,
      lab: labGiorno[x], b2c: gipoGiorno[x], esami: syn ? (syn.gB2B.giorni.find((g) => g.giorno === x)?.esami || 0) + (syn.gSede?.giorni.find((g) => g.giorno === x)?.esami || 0) : null })),
    fine_mese: P.fine, media: sLab.media, media_testo: sLab.media == null ? `media non disponibile: ${sLab.motivo}` : `media laboratorio ${eur(sLab.media)} per giorno lavorativo`,
    prec: syn ? Array.from({ length: Number(P.fine.slice(8, 10)) }, (_, i) => ({ giorno: i + 1, valore: precPerGiorno[i + 1] ?? null })) : [],
    prec_etichetta: meseNome(inizioPrec.slice(0, 7)), laboratorio: Boolean(syn), b2c: Boolean(gipo), in_sede: Boolean(syn?.gSede),
    fonte: [syn ? syn.fonteProd : synNota, gipo ? fGipo : null].filter(Boolean).join(' · '),
  };
  const mk12 = P.mesi12;
  const valM = (x, mk) => { const r = x?.righe?.find((y) => y.chiave === mk); return r ? Number(r.valore || 0) : 0; };
  const primoMeseSyn = syn?.prima ? syn.prima.slice(0, 7) : null, primoMeseGipo = gipo?.prima ? gipo.prima.slice(0, 7) : null;
  out.grafici.mensile = !syn && !gipo ? { non_disponibile: true, motivo: [synNota, gipoNota].filter(Boolean).join(' · ') || 'Nessuna fonte' } : {
    titolo: 'Ultimi 12 mesi', mesi: mk12.map((mk) => {
      const okS = syn && (!primoMeseSyn || mk >= primoMeseSyn), okG = gipo && (!primoMeseGipo || mk >= primoMeseGipo);
      const b2b = okS ? r2(valM(syn.mB2B, mk)) : null, sede = okS && syn.mSede ? r2(valM(syn.mSede, mk)) : null, b2c = okG ? r2(gipo.mesi[mk] || 0) : null;
      return { mese: mk, etichetta: etichettaMese(mk), b2b, sede, b2c, lab: okS ? r2(Number(b2b || 0) + Number(sede || 0)) : null, parziale: mk === P.oggi.slice(0, 7) };
    }), laboratorio: Boolean(syn), b2c: Boolean(gipo), in_sede: Boolean(syn?.mSede),
    nota: [primoMeseSyn && primoMeseSyn > mk12[0] ? `Synclab dal ${dataBreve(syn.prima)}/${syn.prima.slice(0, 4)} (mesi prima non disponibili)` : null, primoMeseGipo && primoMeseGipo > mk12[0] ? `GIPO dal ${dataBreve(gipo.prima)}/${gipo.prima.slice(0, 4)}` : null].filter(Boolean).join(' · ') || null,
    fonte: [syn ? `Synclab produzione accettata (${syn.regolaBreve})` : synNota, gipo ? 'GIPO vendite nette' : null].filter(Boolean).join(' · '),
  };
  out.grafici.top5 = out.top5;
  if (!syn && !gipo) out.grafici.ripartizione = { non_disponibile: true, motivo: [synNota, gipoNota].filter(Boolean).join(' · ') };
  else {
    const parti = [
      { chiave: 'B2B', etichetta: 'B2B (Service)', valore: syn ? r2(syn.privatiInB2c ? vRip(syn.pm, 'B2B') : vTot(syn.pm)) : null },
      ...(syn?.privatiInB2c ? [{ chiave: 'LAB_SEDE', etichetta: 'Laboratorio in sede', valore: r2(vRip(syn.pm, 'LAB_SEDE')) }] : []),
      { chiave: 'B2C', etichetta: 'B2C GIPO', valore: gipo ? r2(Number(gipo.mese.v)) : null },
    ];
    const totale = r2(parti.reduce((t, x) => t + Number(x.valore || 0), 0));
    out.grafici.ripartizione = { titolo: 'Ripartizione del mese', parti: parti.map((x) => ({ ...x, quota: x.valore == null ? null : pct1(x.valore, totale) })), totale,
      mancanti: parti.filter((x) => x.valore == null).map((x) => x.etichetta), nota: notaDoppio, fonte: [fSyn, fGipo].filter(Boolean).join(' + ') };
  }

  // ---- 6. Retail B2C (celle della v0.68.5)
  const ndR = (chiave, titolo, unita = 'n') => indicatore({ chiave, titolo, gruppo: G_SCHERMO, unita, fonte: 'Retail · GIPO', motivo: gipoNota || 'GIPO non disponibile' });
  const sc = (x) => (x?.acc ? r2(Number(x.v) / x.acc) : null);
  const qFuori = (f) => (f?.valutabili ? Math.round((f.fuori / f.valutabili) * 1000) / 10 : null);
  if (!gipo) out.retail.push(ndR('gipo_acc_oggi', 'Accettazioni GIPO oggi'), ndR('gipo_acc_mese', 'Accettazioni GIPO del mese'), ndR('gipo_scontrino', 'Scontrino medio', 'EUR'));
  else {
    out.retail.push(indicatore({ chiave: 'gipo_acc_oggi', titolo: 'Accettazioni GIPO oggi', gruppo: G_SCHERMO, valore: gipo.oggi.acc, meglio: 'su', confronto: confronto(gipo.oggi.acc, gipo.oggi_ap.acc, { etichetta: etAP }),
      dettaglio: `${gipo.oggi.righe} righe di vendita dei privati`, fonte: fGipo, aggiornato: gipo.ultima }));
    out.retail.push(indicatore({ chiave: 'gipo_acc_mese', titolo: 'Accettazioni GIPO del mese', gruppo: G_SCHERMO, valore: gipo.mese.acc, meglio: 'su', confronto: confronto(gipo.mese.acc, gipo.mese_ap.acc, { etichetta: etMeseAP }),
      dettaglio: `dal ${dataBreve(P.inizio)} a oggi`, fonte: fGipo, aggiornato: gipo.ultima }));
    out.retail.push(indicatore({ chiave: 'gipo_scontrino', titolo: 'Scontrino medio', gruppo: G_SCHERMO, unita: 'EUR', valore: sc(gipo.mese), meglio: 'su', confronto: confronto(sc(gipo.mese), sc(gipo.mese_ap), { etichetta: etMeseAP }),
      dettaglio: 'vendite nette del mese / accettazioni GIPO', fonte: fGipo, aggiornato: gipo.ultima, motivo: 'Nessuna accettazione GIPO nel mese' }));
  }
  const tt2 = byKey.attesa_prima_disponibilita;
  out.retail.push(tt2 ? { ...tt2, gruppo: G_SCHERMO, titolo: 'Prima disponibilità online', tabella: null, serie: [], chiave: 'tt_prima_disponibilita' } : ndR('tt_prima_disponibilita', 'Prima disponibilità online', 'giorni'));
  if (!gipo) out.retail.push(ndR('gipo_fuori_area', 'Quota fuori area', '%'));
  else {
    out.retail.push(indicatore({ chiave: 'gipo_fuori_area', titolo: 'Quota fuori area', gruppo: G_SCHERMO, unita: '%', valore: qFuori(gipo.fuori), meglio: null,
      dettaglio: gipo.fuori.valutabili ? `${gipo.fuori.fuori} accettazioni su ${gipo.fuori.valutabili} valutabili` : null, fonte: `GIPO, clienti del mese (comune e provincia diversi da quelli della sede)`, aggiornato: gipo.ultima,
      motivo: 'Nessuna accettazione GIPO del mese con comune e provincia del cliente e della sede' }));
  }

  // ---- 7. persone e operations (celle della v0.68.5)
  const prendi = (k, titolo) => (byKey[k] ? { ...byKey[k], gruppo: G_SCHERMO, titolo, serie: [] } : null);
  const ferie = prendi('assenti_oggi', 'Ferie e permessi oggi');
  const ncA = prendi('nc_aperte', 'NC aperte');
  const ord = byKey.ordini_in_corso;
  const ordAttesa = !ord ? null : ord.non_disponibile ? { ...ord, chiave: 'ordini_attesa', titolo: 'Ordini in attesa', gruppo: G_SCHERMO }
    : indicatore({ chiave: 'ordini_attesa', titolo: 'Ordini in attesa', gruppo: G_SCHERMO, valore: ord.parti?.find((x) => x.etichetta === 'Da approvare')?.valore ?? 0, meglio: 'giu',
      dettaglio: `da approvare · ${(ord.parti || []).filter((x) => x.etichetta !== 'Da approvare').map((x) => `${x.etichetta.toLowerCase()} ${x.valore}`).join(' · ')}`, fonte: ord.fonte, aggiornato: ord.aggiornato });
  out.persone = [ferie, ncA, ordAttesa].filter(Boolean);

  // ---- 8. operatività: tessere compatte, ognuna con il numero e una statistica significativa
  const tessera = (x, statistiche) => ({ ...x, gruppo: G_SCHERMO, serie: [], tabella: null, statistiche: x.non_disponibile ? [] : statistiche.filter(Boolean) });
  const T = [];
  // 1) accettazioni oggi vs media dello stesso giorno della settimana
  if (!syn) T.push(tessera(nd('op_acc_oggi', 'Accettazioni oggi'), []));
  else {
    const serieAcc = Object.fromEntries(syn.g8.giorni.map((g) => [g.giorno, g.accettazioni]));
    const m = mediaStessoGiorno({ serie: serieAcc, oggi: P.oggi, dal: syn.prima });
    const v = syn.p0.totale.accettazioni;
    T.push(tessera(indicatore({ chiave: 'op_acc_oggi', titolo: 'Accettazioni oggi', gruppo: G_SCHERMO, valore: v, meglio: null, dettaglio: syn.privatiInB2c ? `B2B ${n0(syn.p0.B2B?.accettazioni || 0)} · in sede ${n0(syn.p0.LAB_SEDE?.accettazioni || 0)}` : null, fonte: `Synclab, produzione accettata (${syn.aggiornato || 'copia'})`, aggiornato: P.oggi }),
      [stat(`vs media dei ${m.giorno}`, m.media == null ? null : pctVar(v, m.media), '%', m.media == null ? 'non disponibile: nessuno stesso giorno della settimana nei dati importati' : `media ${n0(m.media)} su ${m.n} ${m.n === 1 ? 'settimana' : 'settimane'} precedenti`)]));
  }
  // 2-4) Lab Control (v0.71.0, CEO 12/11/2026): in lavorazione ora, in ritardo oltre la soglia, TAT mediano degli ultimi 7 giorni. Tutta la
  // rete, dalla copia Synclab con le regole di Lab Control (soglie dalle sue impostazioni); nessun link (regola del monitor). Sostituiscono
  // "Esami del mese", "Quota fuori area" e "Clienti Service con produzione" (dati che restano nelle loro pagine).
  let lab = null, labNota = synNota || 'Synclab non disponibile';
  if (syn) {
    try {
      const { indicatoriCockpit } = await import('../modules/etichette/lib/lab.js');
      const adesso = P.oggi === oggiRoma() ? new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T') : `${P.oggi}T23:59:59`;
      lab = await indicatoriCockpit({ adesso });
      if (!lab) labNota = 'Nessuna accettazione nella copia Synclab';
    } catch (e) { lab = null; labNota = `Lettura non riuscita (${String(e.message).slice(0, 100)})`; }
  }
  const fLab = `Lab Control, copia Synclab (${syn?.aggiornato || 'copia'})`;
  if (!lab) {
    T.push(tessera(indicatore({ chiave: 'op_lab_lavorazione', titolo: 'In lavorazione ora', gruppo: G_SCHERMO, fonte: 'Lab Control', motivo: labNota }), []));
    T.push(tessera(indicatore({ chiave: 'op_lab_ritardo', titolo: 'Accettazioni in ritardo', gruppo: G_SCHERMO, fonte: 'Lab Control', motivo: labNota }), []));
    T.push(tessera(indicatore({ chiave: 'op_lab_tat', titolo: 'TAT mediano 7 giorni', gruppo: G_SCHERMO, unita: 'ore', fonte: 'Lab Control', motivo: labNota }), []));
  } else {
    T.push(tessera(indicatore({ chiave: 'op_lab_lavorazione', titolo: 'In lavorazione ora', gruppo: G_SCHERMO, valore: lab.in_corso, meglio: null,
      dettaglio: `accettazioni in attesa, prelievo eseguito, in lavorazione o in firma (ultimi ${lab.giorni_finestra} giorni)`, fonte: fLab, aggiornato: P.oggi }),
    [stat('referti pronti non chiusi', lab.referti_aperti, 'n', `${n0(lab.referti_aperti)} accettazioni con il referto pronto (stato 40) non ancora chiuse`, { meglio: null })]));
    T.push(tessera(indicatore({ chiave: 'op_lab_ritardo', titolo: `In ritardo (oltre ${lab.soglia} ore)`, gruppo: G_SCHERMO, valore: lab.in_ritardo, meglio: 'giu',
      dettaglio: `accettazioni in corso oltre ${lab.soglia} ore dall'accettazione senza referto pronto`, fonte: fLab, aggiornato: P.oggi }),
    [stat('delle accettazioni in corso', lab.in_corso ? pct1(lab.in_ritardo, lab.in_corso) : null, '%', lab.in_corso ? `${n0(lab.in_ritardo)} su ${n0(lab.in_corso)} in corso` : 'nessuna accettazione in corso', { meglio: 'giu' })]));
    const t7 = lab.tat7, tp = lab.tat7_prima;
    T.push(tessera(indicatore({ chiave: 'op_lab_tat', titolo: 'TAT mediano 7 giorni', gruppo: G_SCHERMO, unita: 'ore', valore: t7.n ? t7.mediana : null, meglio: 'giu',
      dettaglio: t7.n ? `accettazione → referto pronto, ${n0(t7.n)} referti degli ultimi 7 giorni` : null, fonte: fLab, aggiornato: P.oggi, motivo: 'Nessun referto pronto negli ultimi 7 giorni' }),
    [stat('vs 7 giorni prima', t7.n && tp.n ? pctVar(t7.mediana, tp.mediana) : null, '%', tp.n ? `7 giorni prima: ${n0(tp.mediana)} ore (${n0(tp.n)} referti)` : 'non disponibile: nessun referto nei 7 giorni prima', { meglio: 'giu' }),
      t7.n ? stat('90° percentile', t7.p90, 'ore', `il 90% dei referti entro ${n0(t7.p90)} ore`, { meglio: 'giu' }) : null]));
  }
  // 3) scontrino medio GIPO vs mese prima
  if (!gipo) T.push(tessera(ndR('op_scontrino', 'Scontrino medio GIPO', 'EUR'), []));
  else {
    const s0 = sc(gipo.mese), sp = sc(gipo.mese_prec);
    T.push(tessera(indicatore({ chiave: 'op_scontrino', titolo: 'Scontrino medio GIPO', gruppo: G_SCHERMO, unita: 'EUR', valore: s0, meglio: 'su', dettaglio: `vendite nette / ${n0(gipo.mese.acc)} accettazioni del mese`, fonte: fGipo, aggiornato: gipo.ultima, motivo: 'Nessuna accettazione GIPO nel mese' }),
      [stat('vs mese prima', pctVar(s0, sp), '%', sp == null ? 'non disponibile: nessuna accettazione GIPO nel mese prima' : `${etMP}: ${eur(sp)}`)]));
  }
  // 4) prima disponibilità online (TuoTempo) vs una settimana prima
  const tt3 = byKey.attesa_prima_disponibilita;
  if (!tt3) T.push(tessera(ndR('op_prima_disp', 'Prima disponibilità online', 'giorni'), []));
  else T.push(tessera({ ...tt3, chiave: 'op_prima_disp', titolo: 'Prima disponibilità online', confronto: null },
    [stat('vs una settimana prima', tt3.confronto ? tt3.confronto.delta : null, 'giorni', tt3.confronto ? `una settimana prima ${n0(tt3.confronto.valore_precedente)} giorni (mediana della rete)` : 'non disponibile: nessun dato di una settimana prima', { meglio: 'giu' })]));
  // 6) NC aperte: tasso su 1.000 accettazioni del mese e % oltre il termine
  if (ctx.live.nc !== true || !ncA) T.push(tessera(ncA ? { ...ncA, chiave: 'op_nc' } : indicatore({ chiave: 'op_nc', titolo: 'NC aperte', gruppo: G_SCHERMO, fonte: 'Non conformità', motivo: motivoNonLive('nc', ctx.live.nc) }), []));
  else {
    let aperteMese = null;
    try { aperteMese = (await ctx.db('nc').many(`SELECT count(*)::int AS n FROM nc WHERE (opened_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date AND stato <> 'ANNULLATA'`, [P.inizio, P.oggi]))[0].n; } catch { aperteMese = null; }
    const acc = syn ? syn.pm.totale.accettazioni : null;
    const oltre = ncA.secondario?.valore ?? null;
    T.push(tessera({ ...ncA, chiave: 'op_nc', titolo: 'NC aperte', secondario: null }, [
      stat('ogni 1.000 accettazioni del mese', aperteMese != null && acc ? Math.round((aperteMese / acc) * 10000) / 10 : null, 'n', aperteMese != null && acc ? `${n0(aperteMese)} NC aperte nel mese su ${n0(acc)} accettazioni Synclab` : `non disponibile: ${!syn ? 'accettazioni Synclab mancanti' : !acc ? 'nessuna accettazione nel mese' : 'NC del mese non lette'}`),
      stat('oltre il termine', ncA.valore ? pct1(oltre, ncA.valore) : null, '%', ncA.valore ? `${n0(oltre)} su ${n0(ncA.valore)} aperte` : 'nessuna NC aperta', { meglio: 'giu' }),
    ]));
  }
  // 7) ordini in attesa: tempo medio di approvazione (ultimi 90 giorni)
  if (!ordAttesa || ordAttesa.non_disponibile) T.push(tessera(ordAttesa ? { ...ordAttesa, chiave: 'op_ordini' } : indicatore({ chiave: 'op_ordini', titolo: 'Ordini in attesa', gruppo: G_SCHERMO, fonte: 'Ordini e Magazzino', motivo: motivoNonLive('orders', ctx.live.orders) }), []));
  else {
    let tm = null;
    try { tm = (await ctx.db('orders').many(`SELECT count(*)::int AS n, avg(extract(epoch FROM (approved_at - submitted_at)) / 3600.0) AS ore FROM orders WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL AND approved_at >= submitted_at AND approved_at >= now() - interval '90 days'`))[0]; } catch { tm = null; }
    const ore = tm?.n ? Number(tm.ore) : null;
    T.push(tessera({ ...ordAttesa, chiave: 'op_ordini', titolo: 'Ordini da approvare' }, [stat('tempo medio di approvazione', ore == null ? null : (ore >= 48 ? r2(ore / 24) : r2(ore)), ore != null && ore >= 48 ? 'giorni' : 'ore',
      ore == null ? 'non disponibile: nessun ordine approvato negli ultimi 90 giorni' : `${n0(tm.n)} ordini approvati negli ultimi 90 giorni (dall'invio all'approvazione)`, { meglio: 'giu' })]));
  }
  // 8) ferie oggi: % dell'organico (dipendenti attivi)
  const dip = byKey.dipendenti_attivi?.valore ?? null;
  if (!ferie) T.push(tessera(indicatore({ chiave: 'op_ferie', titolo: 'Ferie e permessi oggi', gruppo: G_SCHERMO, fonte: 'Piano Ferie', motivo: motivoNonLive('ferie', ctx.live.ferie) }), []));
  else T.push(tessera({ ...ferie, chiave: 'op_ferie' }, [stat('dell\'organico', ferie.valore != null && dip ? pct1(ferie.valore, dip) : null, '%', dip ? `${n0(ferie.valore)} su ${n0(dip)} dipendenti attivi` : 'non disponibile: organico non letto', { meglio: null })]));
  // 10) clienti in ritardo sul pro quota (semaforo del Business Hub)
  if (ctx.live.business !== true) {
    const m = motivoNonLive('business', ctx.live.business);
    T.push(tessera(indicatore({ chiave: 'op_clienti_ritardo', titolo: 'Clienti in ritardo sul pro quota', gruppo: G_SCHERMO, fonte: 'Business Hub + Synclab', motivo: m }), []));
  } else {
    try {
      const S = await import('../modules/business/lib/synclabAccount.js');
      const accts = await ctx.db('business').many(`SELECT id, organization_id, linea, fatturato_fy_atteso, data_avvio_effettiva::text, data_avvio_prevista::text, attivo_dal::text, cliente_attivo FROM accounts WHERE cliente_attivo AND linea IN ('SRV','MDL')`);
      const c = await S.correlazioneAccounts(accts, { oggi: P.oggi });
      const valutati = [...c.per_account.values()].filter((x) => x.semaforo);
      const rit = valutati.filter((x) => S.IN_RITARDO(x.semaforo));
      T.push(tessera(indicatore({ chiave: 'op_clienti_ritardo', titolo: 'Clienti in ritardo sul pro quota', gruppo: G_SCHERMO, valore: c.disponibile && valutati.length ? rit.length : null, meglio: 'giu',
        dettaglio: 'semaforo giallo o rosso del Business Hub: maturato dell\'anno (produzione accettata) sotto il pro quota del fatturato FY atteso', fonte: 'Business Hub + Synclab (stesse regole della Pipeline)', aggiornato: P.oggi,
        motivo: c.nota || 'Nessun cliente attivo con fatturato FY atteso e client Synclab abbinato' }),
      [stat('rossi (oltre −25%)', valutati.length ? rit.filter((x) => x.semaforo === 'ROSSO').length : null, 'n', valutati.length ? `${n0(rit.length)} su ${n0(valutati.length)} clienti valutabili` : null)]));
    } catch (e) { T.push(tessera(indicatore({ chiave: 'op_clienti_ritardo', titolo: 'Clienti in ritardo sul pro quota', gruppo: G_SCHERMO, fonte: 'Business Hub + Synclab', motivo: `Lettura non riuscita (${String(e.message).slice(0, 100)})` }), [])); }
  }
  out.operativita = T;
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
  // v0.68.6: da 30 giorni fa (le scadute della fascia bassa, come l'intervallo predefinito dello scadenzario) a 30 giorni da oggi
  const daScad = addGiorni(oggi, -30) < S.corrente.da ? addGiorni(oggi, -30) : S.corrente.da;
  try { scad = await scadenzeDirezione({ da: daScad, a: addGiorni(oggi, 30), oggi, fresco: true }); }   // al più una lettura al minuto (cache del monitor)
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
  let schermo = null;
  try { schermo = await schermoMonitor(ctx, indicatori); }
  catch (e) { console.warn(`[cockpit:monitor:schermo] ${e.message}`); schermo = { errore: `Lettura non riuscita: ${String(e.message).slice(0, 160)}` }; }
  return { generato_at: new Date().toISOString(), oggi, settimane: S, scad, indicatori, schermo, moduli: live };
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
    // schermo unico (v0.68.1): righe fisse della pagina, scadenze con al più 6 righe per settimana
    schermo: d.schermo ? { ...d.schermo, versione: APP_VERSION, scadenze: [bloccoScadenze(righe, d.settimane.corrente, MAX_RIGHE_SCHERMO), bloccoScadenze(righe, d.settimane.prossima, MAX_RIGHE_SCHERMO)],
      // v0.68.6: una sola fascia bassa con i contatori e le 3 scadenze più vicine (il dettaglio resta nello Scadenzario completo)
      scadenze_sintesi: { ...sintesiScadenze(righe, d.settimane, d.oggi), riservate, fonte: `Scadenzario di direzione: ${fontiScad.filter((f) => f.stato === 'OK').length} fonti lette su ${fontiScad.length}; scadute degli ultimi 30 giorni` } } : null,
    moduli: Object.fromEntries(Object.entries(d.moduli).map(([k, v]) => [k, v === true ? 'LIVE' : v])),
  };
}
