// Finance Management · Controllo di gestione: regole pure (senza database) del conto economico di sede (P&L) e del margine per cliente
// Service. Le usano lib/controlloData.js (che legge le fonti dei moduli) e i test (server/test/finance-controllo.test.mjs).
// Decisioni del CEO (programma "anagrafica unica", 08/11/2026): 11) costi centrali e personale condiviso attribuiti alle sedi in
// proporzione ai ricavi della sede sul totale; 12) la fatturazione attiva è fuori perimetro: i ricavi sono la PRODUZIONE.
// Date: stringhe 'YYYY-MM-DD'; mesi: 'YYYY-MM'. Aritmetica sui giorni UTC come lo Scadenziario (lib/schedule.js).

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v == null || v === '' ? null : Number(v));
const DAY = 86400000;
const t = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const giorniMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const meseKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/**
 * Periodo del conto: un mese (mese 1-12) o l'anno (mese vuoto). L'anno in corso si ferma al mese corrente (oggiIso 'YYYY-MM-DD'): un
 * conto economico registra ciò che è avvenuto, non i mesi futuri; il confronto con l'anno precedente usa gli stessi mesi.
 * { anno, mese, da, a, mesi: ['YYYY-MM'], fino (ultimo mese, 1-12), etichetta }
 */
export function periodo(anno, mese = null, oggiIso = null, fino = null) {
  const y = Number(anno);
  if (!(y >= 2000 && y <= 2100)) throw Object.assign(new Error('Anno non valido'), { status: 400 });
  const m = mese == null || mese === '' ? null : Number(mese);
  if (m != null && !(m >= 1 && m <= 12)) throw Object.assign(new Error('Mese non valido (1-12)'), { status: 400 });
  let ultimo = 12;
  if (!m && fino) ultimo = Number(fino);
  else if (!m && oggiIso && Number(String(oggiIso).slice(0, 4)) === y) ultimo = Number(String(oggiIso).slice(5, 7));
  const mesi = m ? [meseKey(y, m)] : Array.from({ length: ultimo }, (_, i) => meseKey(y, i + 1));
  const da = m ? `${meseKey(y, m)}-01` : `${y}-01-01`;
  const mf = m || ultimo;
  const a = `${meseKey(y, mf)}-${String(giorniMese(y, mf)).padStart(2, '0')}`;
  const etichetta = m ? `${MESI_LUNGHI[m - 1]} ${y}` : ultimo === 12 ? `anno ${y}` : `anno ${y} (${MESI_LUNGHI[0]}-${MESI_LUNGHI[ultimo - 1]})`;
  return { anno: y, mese: m, da, a, mesi, fino: m ? null : ultimo, etichetta };
}
/** Stesso periodo dell'anno precedente (gli stessi mesi) */
export const periodoPrecedente = (p) => periodo(p.anno - 1, p.mese, null, p.fino);

/** Quota del mese 'YYYY-MM' coperta dall'intervallo [da, a] (estremi inclusi; null = aperto): 0..1, a giorni. */
export function copertura(da, a, mk) {
  const [y, m] = mk.split('-').map(Number);
  const inizio = Date.UTC(y, m - 1, 1), fine = Date.UTC(y, m - 1, giorniMese(y, m));
  const s = da ? Math.max(t(da), inizio) : inizio;
  const e = a ? Math.min(t(a), fine) : fine;
  if (e < s) return 0;
  return ((e - s) / DAY + 1) / giorniMese(y, m);   // esatta: si arrotonda solo l'importo
}

/** Ripartizione di un importo distribuito su [da, a] nei mesi indicati, in proporzione ai giorni (bollette per periodo). */
export function ripartisciPerGiorni(importo, da, a, mesi) {
  const s = t(da), e = t(a);
  if (!(e >= s)) return {};
  const tot = (e - s) / DAY + 1;
  const out = {};
  for (const mk of mesi) {
    const [y, m] = mk.split('-').map(Number);
    const ms = Math.max(s, Date.UTC(y, m - 1, 1)), me = Math.min(e, Date.UTC(y, m - 1, giorniMese(y, m)));
    if (me >= ms) out[mk] = r2(Number(importo) * (((me - ms) / DAY + 1) / tot));
  }
  return out;
}

// ---------------------------------------------------------------- personale
/** RAL vigente alla data con gli scatti programmati (stessa regola di contracts/lib/payroll.js ralAt). */
export function ralAt(e, data) {
  let ral = Number(e.ral || 0);
  const steps = Array.isArray(e.ral_steps) ? e.ral_steps : [];
  for (const s of steps) if (s.from && s.from <= data && Number(s.ral) > 0) ral = Number(s.ral);
  return ral;
}
/**
 * Costo aziendale di un dipendente nel mese: RAL vigente × coefficiente / 12 × quota del mese coperta dal rapporto. Il coefficiente è
 * quello del contratto (contracts.employments.cost_coefficient, se indicato da HR) altrimenti l'impostazione pl_coefficiente_oneri.
 */
export function costoDipendenteMese(e, mk, coeffDefault) {
  const cop = copertura(e.inizio, e.fine, mk);
  if (!cop) return { importo: 0, copertura: 0 };
  const ral = ralAt(e, `${mk}-01`);
  const coef = Number(e.cost_coefficient) > 0 ? Number(e.cost_coefficient) : Number(coeffDefault);
  return { importo: r2(ral * coef / 12 * cop), copertura: cop, ral, coefficiente: coef };
}
/**
 * Compenso mensile di un libero professionista dal tariffario dell'incarico (lp_contracts): est_monthly_cost (per Contracts = somma dei
 * compensi FISSI al mese, o la stima scritta da HR). Variabili (ORARIO, PRESTAZIONE, VARIABILE) non quantificabili senza le ore o le
 * prestazioni: la riga è "da indicare". { mensile: number|null, variabile: bool }
 */
export function compensoLp(lp) {
  const fees = Array.isArray(lp.fees) ? lp.fees : [];
  const fissi = fees.filter((f) => f.type === 'FISSO' && (!f.unit || f.unit === 'mese')).reduce((a, f) => a + Number(f.amount || 0), 0);
  const variabile = fees.some((f) => f.type && f.type !== 'FISSO');
  const stima = num(lp.est_monthly_cost);
  const mensile = stima != null && stima > 0 ? stima : fissi > 0 ? fissi : null;
  return { mensile: mensile != null ? r2(mensile) : null, variabile };
}

// ---------------------------------------------------------------- canone di locazione
export const MESI_PERIODO = { MESE: 1, TRIMESTRE: 3, SEMESTRE: 6, ANNO: 12 };
/** Importo con o senza IVA secondo l'impostazione pl_iva_costi (COSTO = IVA indetraibile sommata, ESCLUSA = imponibile). */
export function conIva(importo, regime, aliquota, ivaCosti) {
  const a = Number(aliquota ?? 22) / 100;
  if (regime === 'PIU_IVA' && ivaCosti === 'COSTO') return r2(importo * (1 + a));
  if (regime === 'IVA_INCLUSA' && ivaCosti === 'ESCLUSA') return r2(importo / (1 + a));
  return r2(importo);
}
/** Canone mensile dagli scatti di un contratto dello Scadenziario: scatto vigente al primo del mese / periodicità (in mesi). */
export function canoneMensileDaScatti(steps, periodMonths, mk) {
  const d = `${mk}-01`;
  const valid = [...(steps || [])].filter((s) => String(s.valid_from).slice(0, 10) <= d).sort((x, y) => String(x.valid_from).localeCompare(String(y.valid_from)));
  // contratto che parte nel corso del mese: vale il primo scatto
  const s = valid.length ? valid[valid.length - 1] : [...(steps || [])].sort((x, y) => String(x.valid_from).localeCompare(String(y.valid_from)))[0];
  if (!s) return null;
  return r2(Number(s.amount) / (Number(periodMonths) || 1));
}

// ---------------------------------------------------------------- ritiri dei campioni (Service)
const GIORNI = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/**
 * Ritiri del mese dai giorni del contratto Service (data.pickup.days: lunedì-sabato, modalità FISSO | CHIAMATA | NO). Si contano i
 * giorni del mese a orario FISSO entro la durata del contratto [da, a]; i ritiri a chiamata non sono quantificabili (contati a parte).
 * Festività non considerate.
 */
export function ritiriNelMese(days, mk, da = null, a = null) {
  const [y, m] = mk.split('-').map(Number);
  const arr = Array.isArray(days) ? days : [];
  const modo = (i) => { const d = arr[i]; if (!d) return null; return d.mode || null; };
  let fissi = 0, chiamata = 0;
  for (let g = 1; g <= giorniMese(y, m); g++) {
    const w = new Date(Date.UTC(y, m - 1, g)).getUTCDay();   // 0 domenica
    if (w === 0) continue;
    const giorno = `${mk}-${String(g).padStart(2, '0')}`;
    if ((da && giorno < String(da).slice(0, 10)) || (a && giorno > String(a).slice(0, 10))) continue;   // fuori dal contratto
    const md = modo(w - 1);
    if (md === 'FISSO') fissi++; else if (md === 'CHIAMATA') chiamata++;
  }
  return { fissi, chiamata, giorni_settimana: GIORNI.filter((_, i) => modo(i) === 'FISSO') };
}

// ---------------------------------------------------------------- ricavo e costi del cliente Service
const codiceKey = (c) => String(c ?? '').trim().toUpperCase();
/**
 * Ricavo ai prezzi dell'offerta del cliente: Σ quantità × prezzo offerto (o di listino se manca l'offerto) per codice d'esame del listino
 * corrente. I codici senza prezzo nel listino valgono il valore registrato dalla fonte, se c'è (`valore` della riga), altrimenti restano
 * scoperti (contati). { ricavo, esami, esami_prezzati, esami_senza_prezzo, valore_senza_prezzo, codici_senza_prezzo }
 */
export function ricavoDaListino(righe = [], listino = []) {
  const prezzi = new Map();
  for (const x of listino || []) {
    const p = num(x.offerto) ?? num(x.listino);
    if (x.codice != null && p != null) prezzi.set(codiceKey(x.codice), p);
  }
  let ricavo = 0, esami = 0, prezzati = 0, senza = 0, valoreSenza = 0; const scoperti = new Set();
  for (const r of righe || []) {
    const q = Number(r.quantita || 0); esami += q;
    const p = prezzi.get(codiceKey(r.codice));
    if (p != null) { ricavo += q * p; prezzati += q; }
    else {
      senza += q; scoperti.add(codiceKey(r.codice));
      if (num(r.valore) != null) { ricavo += Number(r.valore); valoreSenza += Number(r.valore); }
    }
  }
  return { ricavo: r2(ricavo), esami, esami_prezzati: prezzati, esami_senza_prezzo: senza, valore_senza_prezzo: r2(valoreSenza), codici_senza_prezzo: [...scoperti].filter(Boolean).slice(0, 30) };
}
/**
 * Costo analitico degli esami: per codice dalla tabella "costi esami" quando le righe hanno il codice e il costo è noto; gli altri esami
 * al costo medio (impostazione srv_costo_medio_esame). Senza costo medio gli esami scoperti restano "da indicare".
 * { costo, esami_per_codice, esami_al_medio, esami_scoperti, stima }
 */
export function costoAnalitico({ righe = null, esami = 0 }, costiEsami = new Map(), costoMedio = null) {
  const medio = num(costoMedio);
  let costo = 0, perCodice = 0, alMedio = 0, scoperti = 0;
  if (Array.isArray(righe) && righe.length) {
    for (const r of righe) {
      const q = Number(r.quantita || 0);
      const c = costiEsami.get(codiceKey(r.codice));
      if (c != null) { costo += q * c; perCodice += q; }
      else if (medio != null) { costo += q * medio; alMedio += q; }
      else scoperti += q;
    }
  } else if (Number(esami) > 0) {
    if (medio != null) { costo = Number(esami) * medio; alMedio = Number(esami); } else scoperti = Number(esami);
  }
  return { costo: r2(costo), esami_per_codice: perCodice, esami_al_medio: alMedio, esami_scoperti: scoperti, stima: alMedio > 0 };
}
/**
 * Stima della produzione del mese dall'account del Business Hub: volumi giornalieri attesi (o volume annuo / giorni lavorativi) ×
 * giorni lavorativi del mese (hub_giorni_lavorativi / 12); valore al prezzo medio per esame dell'account, altrimenti fatturato annuo
 * atteso / volume annuo atteso. Prima della data di avvio (o di contrattualizzazione) nessuna stima. null se mancano i volumi.
 */
export function stimaProduzione(acc, mk, giorniLavorativiAnno = 250, avvio = null) {
  if (!acc) return null;
  const gl = Number(giorniLavorativiAnno) > 0 ? Number(giorniLavorativiAnno) : 250;
  const g = num(acc.volumi_giornalieri_attesi) > 0 ? Number(acc.volumi_giornalieri_attesi) : num(acc.volume_fy_atteso) > 0 ? Number(acc.volume_fy_atteso) / gl : null;
  if (g == null) return null;
  const quota = avvio ? copertura(avvio, null, mk) : 1;
  if (!quota) return null;
  const esami = Math.round(g * (gl / 12) * quota);
  const prezzo = num(acc.prezzo_medio_esame) > 0 ? Number(acc.prezzo_medio_esame)
    : (num(acc.fatturato_fy_atteso) > 0 && num(acc.volume_fy_atteso) > 0 ? Number(acc.fatturato_fy_atteso) / Number(acc.volume_fy_atteso) : null);
  return { esami, valore: prezzo != null ? r2(esami * prezzo) : null, prezzo_medio: prezzo != null ? r2(prezzo) : null, volumi_giornalieri: r2(g), giorni_mese: r2(gl / 12 * quota) };
}

/**
 * Produzione del cliente nel mese, dalla fonte migliore disponibile:
 *  1. riga salvata in Finance Management con fonte MANUALE o STUDIOLAB (scelta esplicita di chi la inserisce o carica il file);
 *  2. Synclab Data API (09/11/2026): accettazioni del gestionale importate nella Suite, con il prezzo netto storico di ogni riga
 *     (lib/synclab/letture.js produzionePerOrg). È il dato del gestionale, non una stima: viene prima di Retail e Ordini;
 *  3. StudioLAB arrivato alla Suite: vendite B2B di Retail (codice StudioLAB abbinato alla Legal entity, con valore e codici d'esame);
 *  4. StudioLAB arrivato alla Suite: produzione di Ordini (HL7 / import, per codice d'esame, senza valore);
 *  5. stima salvata (fonte STIMA) o, in mancanza, stima calcolata al momento dall'account del Business Hub.
 * Ritorna { fonte, origine, esami, valore, righe, stima, calcolata, note } oppure null (nessuna produzione né stima).
 */
export const ORIGINE_SYNCLAB = 'Synclab Data API: accettazioni del gestionale';
export function scegliProduzione({ salvata = null, synclab = null, retail = null, ordini = null, stima = null } = {}) {
  const base = (x) => ({ esami: Number(x.esami || 0), valore: x.valore == null ? null : r2(x.valore), righe: Array.isArray(x.righe) && x.righe.length ? x.righe : null, note: x.note || null });
  if (salvata && salvata.fonte !== 'STIMA') return { ...base(salvata), fonte: salvata.fonte, origine: salvata.fonte === 'STUDIOLAB' ? 'File StudioLAB caricato in Finance Management' : 'Inserita in Finance Management', stima: false, calcolata: false, id: salvata.id };
  if (synclab && Number(synclab.esami) > 0) return { ...base(synclab), fonte: 'SYNCLAB', origine: ORIGINE_SYNCLAB, stima: false, calcolata: false };
  if (retail && Number(retail.esami) > 0) return { ...base(retail), fonte: 'STUDIOLAB', origine: 'Retail: vendite B2B dal gestionale StudioLAB', stima: false, calcolata: false };
  if (ordini && Number(ordini.esami) > 0) return { ...base(ordini), fonte: 'STUDIOLAB', origine: 'Ordini: produzione StudioLAB (HL7 o import)', stima: false, calcolata: false };
  if (salvata) return { ...base(salvata), fonte: 'STIMA', origine: 'Stima salvata in Finance Management', stima: true, calcolata: false, id: salvata.id };
  if (stima) return { esami: stima.esami, valore: stima.valore, righe: null, note: null, fonte: 'STIMA', origine: 'Stima dall\'account del Business Hub', stima: true, calcolata: true, dettaglio_stima: stima };
  return null;
}

/**
 * Margine di un cliente Service in un mese. produzione: esito di scegliProduzione (o null); listino: righe del listino corrente;
 * costiEsami: Map codice → costo; impostazioni { costo_medio_esame, costo_ritiro }; ritiri: esito di ritiriNelMese (o null senza
 * contratto); pagamenti: importo dei pagamenti Finance con org_id = cliente.
 */
export function margineCliente({ produzione = null, listino = [], costiEsami = new Map(), costoMedio = null, costoRitiro = null, ritiri = null, pagamenti = 0, documenti = null }) {
  // documenti: fatturato del mese dai documenti economici di Synclab (netRevenueContribution): grandezza diversa dalla produzione,
  // mostrata accanto e MAI sommata al ricavo né usata nel margine
  const out = { fatturato_documenti: documenti && documenti.fatturato != null ? r2(documenti.fatturato) : null, documenti: documenti || null, esami: 0, valore_produzione: null, ricavo: null, ricavo_da: null, costo_ritiri: null, costo_esami: null, pagamenti: r2(pagamenti || 0), costi_diretti: null, margine: null, margine_pct: null, stime: [], da_indicare: [] };
  if (produzione) {
    out.esami = produzione.esami; out.valore_produzione = produzione.valore;
    if (produzione.stima) out.stime.push('produzione stimata');
    // Synclab: le righe hanno il prezzo netto storico applicato dal gestionale (valore). Si usa quello; solo le righe senza prezzo nel
    // gestionale si valorizzano al listino corrente del Business Hub, se lo ha (altrimenti restano "da indicare").
    if (produzione.fonte === 'SYNCLAB' && produzione.righe) {
      const conValore = produzione.righe.filter((x) => num(x.valore) != null);
      const senza = produzione.righe.filter((x) => num(x.valore) == null).map((x) => ({ ...x, quantita: Number(x.quantita ?? x.righe ?? 0), valore: null }));
      const daListino = senza.length && (listino || []).length ? ricavoDaListino(senza, listino) : null;
      const scoperti = senza.reduce((a, x) => a + Number(x.quantita || 0), 0) - (daListino ? daListino.esami_prezzati : 0);
      out.ricavo = r2(conValore.reduce((a, x) => a + Number(x.valore), 0) + (daListino ? daListino.ricavo : 0)); out.ricavo_da = 'SYNCLAB';
      if (daListino) out.listino = daListino;
      if (scoperti > 0) out.da_indicare.push(`${scoperti} esami senza prezzo nel gestionale né nel listino`);
    }
    const conPrezzi = produzione.fonte !== 'SYNCLAB' && produzione.righe && (listino || []).length ? ricavoDaListino(produzione.righe, listino) : null;
    if (produzione.fonte === 'SYNCLAB' && out.ricavo_da === 'SYNCLAB') { /* già valorizzato */ }
    else if (conPrezzi && conPrezzi.esami_prezzati > 0) {
      out.ricavo = conPrezzi.ricavo; out.ricavo_da = 'LISTINO'; out.listino = conPrezzi;
      if (conPrezzi.esami_senza_prezzo > 0 && conPrezzi.valore_senza_prezzo < 0.005) out.da_indicare.push(`${conPrezzi.esami_senza_prezzo} esami senza prezzo nel listino`);
    } else if (produzione.valore != null) { out.ricavo = r2(produzione.valore); out.ricavo_da = produzione.stima ? 'STIMA' : 'VALORE'; }
    else if (produzione.esami > 0) out.da_indicare.push('valore della produzione (manca il listino per esame e il valore)');
  }
  const r = ritiri ? Number(ritiri.fissi || 0) : 0;
  if (ritiri && r > 0) {
    if (num(costoRitiro) != null) { out.costo_ritiri = r2(r * Number(costoRitiro)); out.stime.push('costo del ritiro'); } else out.da_indicare.push('costo per ritiro (Impostazioni)');
  } else out.costo_ritiri = 0;
  if (ritiri && ritiri.chiamata > 0) out.ritiri_a_chiamata = ritiri.chiamata;
  out.ritiri = ritiri ? r : null;
  if (produzione && (produzione.esami > 0)) {
    const ca = costoAnalitico({ righe: produzione.righe, esami: produzione.esami }, costiEsami, costoMedio);
    out.costo_esami = ca.esami_scoperti === produzione.esami && !ca.costo ? null : ca.costo;
    out.costo_esami_dettaglio = ca;
    if (ca.stima) out.stime.push('costo medio per esame');
    if (ca.esami_scoperti > 0) out.da_indicare.push(`costo di ${ca.esami_scoperti} esami (costi esami o costo medio in Impostazioni)`);
  } else out.costo_esami = 0;
  out.costi_diretti = r2((out.costo_ritiri || 0) + (out.costo_esami || 0) + out.pagamenti);
  if (out.ricavo != null) {
    out.margine = r2(out.ricavo - out.costi_diretti);
    out.margine_pct = out.ricavo > 0 ? Math.round((out.margine / out.ricavo) * 1000) / 10 : null;
  }
  return out;
}

// ---------------------------------------------------------------- ripartizione dei costi centrali (decisione 11)
/**
 * Quota dei costi centrali per sede in proporzione ai ricavi della sede sul totale. Con ricavi totali a zero (o negativi) la ripartizione
 * non è possibile: null e il motivo. { ripartibile, motivo, quote: { [siteId]: { pct, quota } }, totale_ricavi }
 */
export function ripartisciCentrali(totaleCentrali, ricaviPerSede = {}) {
  const ids = Object.keys(ricaviPerSede);
  const tot = ids.reduce((a, k) => a + Math.max(0, Number(ricaviPerSede[k] || 0)), 0);
  if (!(tot > 0)) return { ripartibile: false, motivo: 'Ricavi del periodo a zero: i costi centrali non si possono ripartire in proporzione ai ricavi', quote: {}, totale_ricavi: r2(tot) };
  const quote = {};
  let assegnato = 0;
  ids.forEach((k) => {
    const pct = Math.max(0, Number(ricaviPerSede[k] || 0)) / tot;
    const q = r2(Number(totaleCentrali || 0) * pct);
    quote[k] = { pct: Math.round(pct * 10000) / 100, quota: q };
    assegnato += q;
  });
  // arrotondamento: la differenza di centesimi va alla sede con la quota più alta, così la somma torna al totale
  const diff = r2(Number(totaleCentrali || 0) - assegnato);
  if (diff && ids.length) { const k = ids.reduce((a, b) => (quote[b].quota > quote[a].quota ? b : a), ids[0]); quote[k].quota = r2(quote[k].quota + diff); }
  return { ripartibile: true, motivo: null, quote, totale_ricavi: r2(tot) };
}

// ---------------------------------------------------------------- composizione del conto economico
export const RIGHE = [
  { key: 'ricavi_retail', gruppo: 'RICAVI', label: 'Ricavi Retail (produzione)', modulo: 'retail' },
  { key: 'ricavi_service', gruppo: 'RICAVI', label: 'Ricavi Service (produzione dei clienti)', modulo: 'business' },
  { key: 'incassi_cash', gruppo: 'CONTROLLO', label: 'Incassi Cash (controllo, non sommati)', modulo: 'cash' },
  { key: 'canone', gruppo: 'COSTI', label: 'Canone di locazione', modulo: 'finance' },
  { key: 'utenze', gruppo: 'COSTI', label: 'Utenze e bollette', modulo: 'finance' },
  { key: 'royalty', gruppo: 'COSTI', label: 'Royalties al partner ospitante', modulo: 'cash' },
  { key: 'personale', gruppo: 'COSTI', label: 'Personale dipendente', modulo: 'contracts' },
  { key: 'lp', gruppo: 'COSTI', label: 'Liberi professionisti', modulo: 'contracts' },
  { key: 'manutenzioni', gruppo: 'COSTI', label: 'Manutenzioni (Facility)', modulo: 'facility' },
  { key: 'pagamenti', gruppo: 'COSTI', label: 'Pagamenti Finance', modulo: 'finance' },
];
export const RIGHE_RICAVI = RIGHE.filter((r) => r.gruppo === 'RICAVI').map((r) => r.key);
export const RIGHE_COSTI = RIGHE.filter((r) => r.gruppo === 'COSTI').map((r) => r.key);

const voce = () => ({ importo: 0, righe: [], da_indicare: 0 });
const add = (v, m) => {
  if (m.importo == null) v.da_indicare += 1; else v.importo = r2(v.importo + Number(m.importo));
  v.righe.push(m);
};

/**
 * Conto economico del periodo.
 *  sedi: [{ id, code, name, kind }] colonne del conto (sedi attive non SERVICE, escluse le centrali)
 *  centrali: [{ id, name }] sedi centrali (impostazione): i loro costi vanno nel paniere dei costi centrali
 *  movimenti: [{ riga, site_id|null, importo|null (null = da indicare), modulo, descrizione, data, rif, link }]
 *  fonti: { [riga]: { disponibile, nota } } stato delle fonti (riga non disponibile = mai zero silenzioso)
 * Ritorna { colonne, centrali, ripartizione, totale, avvisi }: per sede le voci (importo, righe di dettaglio, da indicare), i ricavi,
 * i costi diretti, la quota dei costi centrali con la percentuale, il margine e il margine %, e se il margine è parziale (fonti
 * mancanti o compensi da indicare).
 */
export function componiConto({ sedi = [], centrali = [], movimenti = [], fonti = {} }) {
  const colIds = new Set(sedi.map((s) => Number(s.id)));
  const centraliIds = new Set(centrali.map((s) => Number(s.id)));
  const col = new Map(sedi.map((s) => [Number(s.id), { sede: s, voci: Object.fromEntries(RIGHE.map((r) => [r.key, voce()])) }]));
  const centro = Object.fromEntries(RIGHE_COSTI.map((k) => [k, voce()]));
  const avvisi = [];
  const fuori = { ricavi: 0, n: 0 };
  for (const m of movimenti) {
    const sid = m.site_id == null ? null : Number(m.site_id);
    const r = RIGHE.find((x) => x.key === m.riga);
    if (!r) continue;
    if (r.gruppo === 'COSTI') {
      if (sid != null && colIds.has(sid)) add(col.get(sid).voci[m.riga], m);
      else add(centro[m.riga], { ...m, centrale: sid == null ? 'senza sede' : centraliIds.has(sid) ? 'sede centrale' : 'sede fuori dal conto (SERVICE o chiusa)' });
    } else if (sid != null && colIds.has(sid)) add(col.get(sid).voci[m.riga], m);
    else if (r.gruppo === 'RICAVI' && m.importo) { fuori.ricavi = r2(fuori.ricavi + Number(m.importo)); fuori.n += 1; }
  }
  if (fuori.n) avvisi.push(`Ricavi registrati su sedi fuori dal conto (sedi centrali, SERVICE o chiuse): ${fuori.ricavi.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' })} in ${fuori.n} righe, non attribuiti`);
  const disp = (k) => fonti[k]?.disponibile !== false;

  const ricaviSede = {};
  for (const [id, c] of col) ricaviSede[id] = r2(RIGHE_RICAVI.filter(disp).reduce((a, k) => a + c.voci[k].importo, 0));
  const totCentrali = r2(RIGHE_COSTI.filter(disp).reduce((a, k) => a + centro[k].importo, 0));
  const rip = ripartisciCentrali(totCentrali, ricaviSede);
  const centraliParziale = RIGHE_COSTI.some((k) => !disp(k) || centro[k].da_indicare > 0);

  const colonne = [...col.values()].map(({ sede, voci }) => {
    const ricavi = ricaviSede[sede.id];
    const diretti = r2(RIGHE_COSTI.filter(disp).reduce((a, k) => a + voci[k].importo, 0));
    const q = rip.ripartibile ? rip.quote[sede.id] : null;
    const quota = q ? q.quota : 0;
    const margine = r2(ricavi - diretti - quota);
    const mancanti = RIGHE.filter((r) => r.gruppo !== 'CONTROLLO' && !disp(r.key)).map((r) => r.label);
    const daIndicare = RIGHE.filter((r) => r.gruppo !== 'CONTROLLO').reduce((a, r) => a + voci[r.key].da_indicare, 0);
    // controllo Cash solo per le sedi con rendiconti nel periodo (una sede senza Cash non ha una "differenza")
    const cash = disp('incassi_cash') && voci.incassi_cash.righe.length ? voci.incassi_cash.importo : null;
    return {
      sede, voci, ricavi, costi_diretti: diretti, quota_centrali: rip.ripartibile ? quota : null, quota_pct: q ? q.pct : null,
      margine: rip.ripartibile ? margine : null, margine_prima_dei_centrali: r2(ricavi - diretti),
      margine_pct: rip.ripartibile && ricavi > 0 ? Math.round((margine / ricavi) * 1000) / 10 : null,
      controllo_cash: cash == null ? null : { incassi: cash, retail: voci.ricavi_retail.importo, differenza: r2(cash - voci.ricavi_retail.importo) },
      parziale: mancanti.length > 0 || daIndicare > 0 || centraliParziale, mancanti, da_indicare: daIndicare,
    };
  });
  const somma = (f) => r2(colonne.reduce((a, c) => a + (f(c) || 0), 0));
  const totale = {
    voci: Object.fromEntries(RIGHE.map((r) => [r.key, r2(colonne.reduce((a, c) => a + c.voci[r.key].importo, 0))])),
    ricavi: somma((c) => c.ricavi), costi_diretti: somma((c) => c.costi_diretti), quota_centrali: rip.ripartibile ? totCentrali : null,
    costi_centrali: totCentrali,
  };
  totale.margine = rip.ripartibile ? r2(totale.ricavi - totale.costi_diretti - totCentrali) : null;
  totale.margine_prima_dei_centrali = r2(totale.ricavi - totale.costi_diretti);
  totale.margine_pct = totale.margine != null && totale.ricavi > 0 ? Math.round((totale.margine / totale.ricavi) * 1000) / 10 : null;
  const conCash = colonne.filter((c) => c.controllo_cash);
  totale.controllo_cash = disp('incassi_cash') && conCash.length ? (() => { const i = r2(conCash.reduce((a, c) => a + c.controllo_cash.incassi, 0)); const rr = r2(conCash.reduce((a, c) => a + c.controllo_cash.retail, 0)); return { incassi: i, retail: rr, differenza: r2(i - rr), sedi: conCash.length }; })() : null;
  return { colonne, centrali: { voci: centro, totale: totCentrali, parziale: centraliParziale, sedi: centrali }, ripartizione: { chiave: 'RICAVI', ...rip }, totale, avvisi };
}

/** Variazione % (null se il termine di confronto è zero o mancante) */
export const variazione = (cur, prev) => (cur == null || prev == null || !Number(prev) ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);
