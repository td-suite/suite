// Lab Control (v0.71.0) · letture della copia Synclab per il controllo del laboratorio: elenco delle accettazioni con fase e avanzamento,
// cruscotto, scheda, documento economico, campioni, ritardi, tempi di refertazione (TAT), esami non eseguiti, clienti.
// Regole:
//  - fonte = copia Synclab della Suite in sola lettura (synclab.requests / request_items / samples / invoices), solo accettazioni ATTIVE
//    e non cancellate; nessuna scrittura verso StudioLab. Stati e date si aggiornano col delta orario di giorno (7-21);
//  - cliente = client Synclab; sede e Legal entity dall'abbinamento synclab.clients_td (stessa regola di Label);
//  - perimetro: OPERATORE = sedi del grant; ADMIN e LABORATORIO = tutto (anche i client non abbinati a una sede);
//  - fase e linea del tempo: lib/fasi.js (faseAccettazione, una sola regola); ritardi: ore dall'accettazione oltre `ore_ritardo` (e soglie
//    per stato facoltative), solo per le accettazioni in corso (15, 18, 20, 25) degli ultimi `giorni_finestra` giorni;
//  - valore = produzione ACCETTATA con la definizione unica di lib/synclab/letture.js (stati e sconto di testata dalle impostazioni del
//    connettore): Σ netto di riga × quantità delle righe non cancellate, × (1 − sconto di testata) solo se la regola lo applica; righe senza
//    prezzo contate a parte; accettazioni fuori dagli stati della produzione senza valore;
//  - paziente: SOLO le identità recenti di Label (etichette.pazienti_recenti, codice fiscale mai); altrimenti età e sesso della demografia.
// Prestazioni: elenco paginato lato server (count + pagina di id ordinati), poi UNA query per righe e UNA per campioni della pagina (niente
// N+1); indici della migrazione 002.
import { one, many } from '../db.js';
import { statiErogati, scontoTestata, LEGENDA_STATI } from '../../../lib/synclab/letture.js';
import { cercaAccettazioniSynclab } from '../../nc/lib/synclabDesk.js';
import { getModuleState } from '../../../lib/modules.js';
import { settings, oggiRoma, adessoRoma, nomeSede } from './core.js';
import { SQL_NORM, normNome } from './ricerca.js';
import { FASI, STATI_IN_CORSO, statiDellaFase, faseAccettazione, ritardo, statoEsame, tsLocale, minutiTra, SQL_FASE, STATO_LABEL } from './fasi.js';

const giornoRe = /^\d{4}-\d{2}-\d{2}$/;
const addGiorni = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMesi = (d, n) => { const [y, m, g] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); const fine = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); return `${x.toISOString().slice(0, 8)}${String(Math.min(g, fine)).padStart(2, '0')}`; };
const n2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const o1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

// client Synclab con Legal entity e sede abbinate (pochi: si materializzano una volta per query)
export const SQL_PC = `pc AS MATERIALIZED (
    SELECT ct.instance_id, ct.client_id, ct.client_code, coalesce(ct.legal_name, ct.client_code, ct.client_id) AS cliente, ct.organization_id, ct.site_id,
           ct.stato_abbinamento, s.code AS sede_code, s.name AS sede_name, o.name AS org_name
      FROM synclab.clients_td ct LEFT JOIN public.sites s ON s.id = ct.site_id LEFT JOIN public.organizations o ON o.id = ct.organization_id)`;

/**
 * Periodo da parametri: periodo = oggi | ieri | 7g | 30g | mese | anno | intervallo (con da e a). Ritorna { periodo, da, a }.
 * Predefinito: `predefinito` (7g per l'elenco).
 */
export function periodo(q = {}, { oggi = oggiRoma(), predefinito = '7g' } = {}) {
  let per = String(q.periodo || '').trim() || predefinito;
  if (per === 'intervallo' || (q.da && q.a && !q.periodo)) {
    const da = giornoRe.test(String(q.da || '')) ? q.da : null, a = giornoRe.test(String(q.a || '')) ? q.a : null;
    if (da && a) return da <= a ? { periodo: 'intervallo', da, a } : { periodo: 'intervallo', da: a, a: da };
    per = predefinito;
  }
  if (per === 'tutto') return { periodo: 'tutto', da: null, a: null };
  const P = { oggi: [oggi, oggi], ieri: [addGiorni(oggi, -1), addGiorni(oggi, -1)], '7g': [addGiorni(oggi, -6), oggi], '30g': [addGiorni(oggi, -29), oggi],
    mese: [`${oggi.slice(0, 7)}-01`, oggi], anno: [`${oggi.slice(0, 4)}-01-01`, oggi], '90g': [addGiorni(oggi, -89), oggi] };
  const [da, a] = P[per] || P[predefinito] || P['7g'];
  return { periodo: P[per] ? per : predefinito, da, a };
}

/** La tabella delle NC esiste ed è del modulo NC LIVE? (badge, filtro "con NC", scheda) */
export async function ncDisponibile() {
  const st = await getModuleState('nc').catch(() => ({ mode: 'OFF' }));
  if (st.mode !== 'LIVE') return false;
  return Boolean((await one(`SELECT to_regclass('nc.nc') IS NOT NULL AS ok`))?.ok);
}

/** Condizione SQL "in ritardo" (stesse regole di fasi.js ritardo). p = funzione che aggiunge un parametro. */
export function sqlRitardo(p, imp, adesso) {
  const a = p(adesso);
  const parti = [`r.created_at_local < ${a}::timestamp - make_interval(hours => ${p(imp.ore_ritardo)}::int)`];
  for (const [st, ore] of Object.entries(imp.soglie_fase || {})) {
    if (Number.isFinite(Number(st)) && Number.isFinite(Number(ore))) parti.push(`(r.state = ${Number(st)} AND coalesce(r.modified_at_local, r.created_at_local) < ${a}::timestamp - make_interval(hours => ${Number(ore)}))`);
  }
  return `(r.state IN (${STATI_IN_CORSO.join(',')}) AND r.date >= (${a}::timestamp)::date - ${p(imp.giorni_finestra)}::int AND (${parti.join(' OR ')}))`;
}

/**
 * Filtri comuni dell'elenco (e di export, clienti, ritardi): ritorna { where, params, p, filtri } dove filtri = la versione normalizzata.
 * q: { periodo, da, a, cliente ('123' Legal entity | 'c-<id client>'), sede (id | 'ND'), fase (chiave di FASI o NC), stato, ritardo ('1'),
 * nc ('1'), non_fatturate ('1'), q (numero, barcode o cognome), tipo (tipo paziente), mdl ('1') }.
 */
export async function filtriElenco(q, ctx, imp, { oggi = oggiRoma(), adesso = adessoRoma(), predefinito = '7g', conPeriodo = true } = {}) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const w = ['r.deleted_at IS NULL', `r.disponibilita = 'ATTIVO'`];
  const f = {};
  if (!ctx.tutte) w.push(`pc.site_id = ANY(${p(ctx.siteIds)}::int[])`);
  if (conPeriodo) {
    const per = periodo(q, { oggi, predefinito });
    Object.assign(f, per);
    if (per.da) w.push(`r.date BETWEEN ${p(per.da)}::date AND ${p(per.a)}::date`);
  }
  const cli = String(q.cliente || '').trim();
  if (/^\d+$/.test(cli)) { f.cliente = cli; w.push(`pc.organization_id = ${p(Number(cli))}`); }
  else if (/^c-.{1,200}$/.test(cli)) { f.cliente = cli; w.push(`r.client_id = ${p(cli.slice(2))}`); }
  const sede = String(q.sede || '').trim();
  if (sede === 'ND') { f.sede = 'ND'; w.push('pc.site_id IS NULL'); } else if (/^\d+$/.test(sede)) { f.sede = sede; w.push(`pc.site_id = ${p(Number(sede))}`); }
  if (q.fase) { const st = statiDellaFase(String(q.fase)); if (st.length) { f.fase = String(q.fase); w.push(`r.state = ANY(${p(st)}::int[])`); } }
  if (/^\d{1,3}$/.test(String(q.stato || ''))) { f.stato = Number(q.stato); w.push(`r.state = ${p(Number(q.stato))}`); }
  if (q.in_corso === '1') { f.in_corso = '1'; w.push(`r.state IN (${STATI_IN_CORSO.join(',')})`); }
  if (q.ritardo === '1') { f.ritardo = '1'; w.push(sqlRitardo(p, imp, adesso)); }
  if (q.non_fatturate === '1') { f.non_fatturate = '1'; w.push(`coalesce(cardinality(r.invoice_ids), 0) = 0 AND NOT EXISTS (SELECT 1 FROM synclab.request_invoices ri WHERE ri.instance_id = r.instance_id AND ri.request_id = r.id)`); }
  if (q.mdl === '1') { f.mdl = '1'; w.push('r.occupational_medicine IS TRUE'); }
  if (q.tipo) { f.tipo = String(q.tipo).slice(0, 40); w.push(`r.patient_type = ${p(f.tipo)}`); }
  if (q.nc === '1') {
    f.nc = '1';
    if (await ncDisponibile()) w.push(`r.request_number IN (SELECT n.accettazione_id FROM nc.nc n WHERE n.stato <> 'ANNULLATA')`);
    else { w.push('FALSE'); f.nc_non_disponibile = true; }
  }
  if (q.non_eseguiti === '1') { f.non_eseguiti = '1'; w.push(`EXISTS (SELECT 1 FROM synclab.request_items i WHERE i.instance_id = r.instance_id AND i.request_id = r.id AND i.not_performed_code IS NOT NULL AND coalesce(i.deleted, FALSE) = FALSE)`); }
  if (q.referti_aperti === '1') { f.referti_aperti = '1'; w.push('r.state = 40'); }
  const testo = String(q.q || '').trim().slice(0, 80);
  if (testo) {
    f.q = testo;
    if (/\d/.test(testo)) {
      const { candidati } = await cercaAccettazioniSynclab(testo);
      w.push(candidati.length ? `(r.instance_id, r.id) IN (SELECT * FROM unnest(${p(candidati.map((c) => c.instance_id))}::text[], ${p(candidati.map((c) => String(c.id)))}::text[]))` : 'FALSE');
    } else {
      // cognome (inizio; "cognome nome"): SOLO le identità recenti, come la ricerca di Label
      const parole = normNome(testo).split(' ').filter(Boolean);
      if (parole.join('').length < 2) w.push('FALSE');
      else {
        const [cog, ...resto] = parole;
        w.push(`(r.instance_id, r.id) IN (SELECT pr.instance_id, pr.request_id FROM pazienti_recenti pr WHERE (pr.cognome IS NOT NULL OR pr.nome IS NOT NULL)
          AND (${SQL_NORM('pr.cognome')} LIKE ${p(parole.join(' '))} || '%' OR (${SQL_NORM('pr.cognome')} LIKE ${p(cog)} || '%' AND (${p(resto.join(' '))} = '' OR ${SQL_NORM('pr.nome')} LIKE ${p(resto.join(' '))} || '%'))))`);
      }
    }
  }
  return { where: w.join(' AND '), params, p, filtri: f };
}

// ordinamenti ammessi (colonne con indice o calcolabili senza leggere le righe)
const ORDINI = {
  data: 'r.created_at_local', numero: 'r.request_number', cliente: 'lower(coalesce(pc.cliente, r.client_code))', sede: 'lower(coalesce(pc.sede_code, \'\'))',
  fase: `coalesce(${SQL_FASE('r.state')}, -1)`, aggiornata: 'coalesce(r.modified_at_local, r.created_at_local)', ritardo: 'r.created_at_local',
};
const ordineSql = (ord, dir) => {
  const c = ORDINI[ord] || ORDINI.data;
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  // "ritardo" decrescente = più vecchie prima
  const dd = ord === 'ritardo' ? (d === 'ASC' ? 'DESC' : 'ASC') : d;
  return `${c} ${dd} NULLS LAST, r.date ${dd}, r.id ${dd}`;
};

/** Regola della produzione in vigore (stati e sconto di testata): una lettura per richiesta. */
export async function regolaValore() {
  const [stati, sconto] = [await statiErogati(), await scontoTestata()];
  return { stati, applica: sconto === 'APPLICA', sconto };
}

/**
 * Dettagli di un elenco di accettazioni (chiavi [instance_id, id] in ordine): testata, cliente, sede, righe, campioni, fatture, NC,
 * identità recente; fase, avanzamento, ritardo e valore. Tre query in tutto (testate, righe, campioni) + fatture e NC.
 */
export async function dettagliElenco(chiavi, { imp, regola, adesso = adessoRoma(), oggi = oggiRoma(), conNomi = true, nc = null } = {}) {
  if (!chiavi.length) return [];
  const inst = chiavi.map((k) => k[0]), ids = chiavi.map((k) => String(k[1]));
  const testate = await many(`WITH ${SQL_PC}, k AS (SELECT * FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS k(instance_id, id, n))
    SELECT k.n, r.instance_id, r.id, r.request_number, r.date::text AS data, r.client_id, r.client_code, r.state, r.patient_type, r.occupational_medicine,
           r.created_at_local, r.modified_at_local, r.booking_at_local, r.report_at_local, r.header_discount_percent, r.dem_age_years, r.dem_sex, r.invoice_ids,
           r.updated_at AS copia_il, pc.cliente, pc.organization_id, pc.site_id, pc.sede_code, pc.sede_name, pc.stato_abbinamento, pc.org_name,
           ${conNomi ? 'pr.cognome, pr.nome' : 'NULL::text AS cognome, NULL::text AS nome'}
      FROM k JOIN synclab.requests r ON r.instance_id = k.instance_id AND r.id = k.id
      LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
      LEFT JOIN pazienti_recenti pr ON pr.instance_id = r.instance_id AND pr.request_id = r.id
     ORDER BY k.n`, [inst, ids]);
  const righe = await many(`SELECT i.instance_id, i.request_id, i.deleted, i.not_performed_code, i.report_ready, i.executed_at_local, i.validated_at_local,
      i.net_unit_price_excluding_vat * i.quantity AS netto, i.exam_code FROM synclab.request_items i WHERE i.request_id = ANY($2::text[]) AND i.instance_id = ANY($1::text[])`, [inst, ids]);
  const campioni = await many(`SELECT s.instance_id, s.request_id, s.collected_at_local, s.sample_at_local, s.checked_in_at_local FROM synclab.samples s WHERE s.request_id = ANY($2::text[]) AND s.instance_id = ANY($1::text[])`, [inst, ids]);
  const tutteFatture = [...new Set(testate.flatMap((t) => t.invoice_ids || []))];
  const fatture = tutteFatture.length ? await many(`SELECT instance_id, id, invoice_number, document_type, date::text AS data FROM synclab.invoices WHERE id = ANY($1::text[])`, [tutteFatture]) : [];
  const ncMap = new Map();
  if (nc) {
    const numeri = [...new Set(testate.map((t) => t.request_number).filter(Boolean))];
    if (numeri.length) for (const x of await many(`SELECT accettazione_id, count(*) FILTER (WHERE stato NOT IN ('CHIUSA','VERIFICATA','ANNULLATA'))::int AS aperte, count(*) FILTER (WHERE stato <> 'ANNULLATA')::int AS totale FROM nc.nc WHERE accettazione_id = ANY($1::text[]) GROUP BY 1`, [numeri])) ncMap.set(x.accettazione_id, x);
  }
  const per = (lista) => { const m = new Map(); for (const x of lista) { const k = `${x.instance_id}|${x.request_id}`; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const R = per(righe), C = per(campioni);
  const F = new Map(fatture.map((x) => [`${x.instance_id}|${x.id}`, x]));
  const dal = addGiorni(oggi, -imp.giorni_finestra);
  return testate.map((t) => {
    const k = `${t.instance_id}|${t.id}`;
    const rr = R.get(k) || [], cc = C.get(k) || [];
    const fase = faseAccettazione(t, cc, rr);
    const vive = rr.filter((x) => !x.deleted);
    const erogata = regola.stati.includes(Number(t.state));
    const conPrezzo = vive.filter((x) => x.netto != null);
    const valore = erogata && conPrezzo.length ? n2(conPrezzo.reduce((s, x) => s + Number(x.netto), 0) * (regola.applica ? 1 - Number(t.header_discount_percent || 0) / 100 : 1)) : null;
    const rit = ritardo({ state: t.state, created_at_local: t.created_at_local, modified_at_local: t.modified_at_local, data: t.data }, { ...imp, dal }, adesso);
    const fat = (t.invoice_ids || []).map((id) => F.get(`${t.instance_id}|${id}`) || { id, invoice_number: null });
    const n = ncMap.get(t.request_number);
    const identita = Boolean(t.cognome || t.nome);
    return {
      instance_id: t.instance_id, id: t.id, numero: t.request_number, data: t.data, creata_il: tsLocale(t.created_at_local), aggiornata_il: tsLocale(t.modified_at_local), copia_il: t.copia_il,
      client_id: t.client_id, client_code: t.client_code, cliente: t.cliente || t.client_code || t.client_id, organization_id: t.organization_id, abbinamento: t.stato_abbinamento || 'DA_ABBINARE',
      site_id: t.site_id, sede: t.site_id ? nomeSede({ code: t.sede_code, name: t.sede_name }) : null,
      paziente: identita ? `${t.cognome || ''} ${t.nome || ''}`.trim() : null, eta: t.dem_age_years, sesso: t.dem_sex || null,
      tipo_paziente: t.patient_type || null, medicina_lavoro: t.occupational_medicine === true,
      esami: fase.esami.totale, esami_pronti: fase.esami.pronti, esami_validati: fase.esami.validati, esami_non_eseguiti: fase.esami.non_eseguiti, campioni: cc.length,
      stato: t.state, stato_label: fase.stato_label, fase: { key: fase.key, label: fase.label, indice: fase.indice, fuori_linea: fase.fuori_linea, tappe: fase.tappe.map((x) => ({ key: x.key, data: x.data, raggiunta: x.raggiunta })) },
      valore, valore_parziale: erogata && conPrezzo.length < vive.length, erogata,
      fatture: fat.map((x) => ({ id: x.id, numero: x.invoice_number, tipo: x.document_type || null, data: x.data || null })),
      nc: n ? { aperte: n.aperte, totale: n.totale } : null,
      ritardo: rit, referto_il: tsLocale(t.report_at_local), tat_min: minutiTra(t.created_at_local, t.report_at_local),
    };
  });
}

/** Elenco paginato: { totale, pagina, per_pagina, righe, filtri, adesso }. */
export async function elencoAccettazioni(q, ctx, { perPagina = 50 } = {}) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const { where, params, p, filtri } = await filtriElenco(q, ctx, imp, { oggi, adesso });
  const pagina = Math.max(1, Math.min(10000, Number(q.pagina) || 1));
  const pp = Math.max(10, Math.min(200, Number(q.per_pagina) || perPagina));
  const tot = await one(`WITH ${SQL_PC} SELECT count(*)::int AS n FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id WHERE ${where}`, params);
  const ord = ORDINI[q.ord] ? q.ord : 'data';
  const dir = q.dir === 'asc' ? 'asc' : 'desc';
  const ids = await many(`WITH ${SQL_PC} SELECT r.instance_id, r.id FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
     WHERE ${where} ORDER BY ${ordineSql(ord, dir)} LIMIT ${p(pp)} OFFSET ${p((pagina - 1) * pp)}`, params);
  const regola = await regolaValore();
  const nc = await ncDisponibile();
  const righe = await dettagliElenco(ids.map((x) => [x.instance_id, x.id]), { imp, regola, adesso, oggi, nc });
  return { totale: tot.n, pagina, per_pagina: pp, ord, dir, righe, filtri, adesso, nc_disponibile: nc, soglia: { ore_ritardo: imp.ore_ritardo, soglie_fase: imp.soglie_fase, giorni_finestra: imp.giorni_finestra }, regola: { stati: regola.stati, sconto: regola.sconto } };
}

/** Tutte le accettazioni filtrate (export), a blocchi; al più `max`. Senza nomi dei pazienti. */
export async function tutteLeAccettazioni(q, ctx, { max = 20000 } = {}) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const { where, params } = await filtriElenco(q, ctx, imp, { oggi, adesso });
  const ord = ORDINI[q.ord] ? q.ord : 'data';
  const ids = await many(`WITH ${SQL_PC} SELECT r.instance_id, r.id FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
     WHERE ${where} ORDER BY ${ordineSql(ord, q.dir === 'asc' ? 'asc' : 'desc')} LIMIT ${Number(max) + 1}`, params);
  const regola = await regolaValore();
  const nc = await ncDisponibile();
  const out = [];
  for (let i = 0; i < Math.min(ids.length, max); i += 2000) {
    out.push(...await dettagliElenco(ids.slice(i, Math.min(i + 2000, max)).map((x) => [x.instance_id, x.id]), { imp, regola, adesso, oggi, nc, conNomi: false }));
  }
  return { righe: out, troncato: ids.length > max, max };
}

/** Stato della copia delle accettazioni: { checkpoint_at, ultimo_completo_at } (per "copia aggiornata alle HH:MM"). */
export async function copiaAccettazioni() {
  const r = await one(`SELECT max(checkpoint_at) AS checkpoint_at, max(ultimo_completo_at) AS ultimo_completo_at FROM synclab.sync_scope WHERE dataset = 'requests'`).catch(() => null);
  return { checkpoint_at: r?.checkpoint_at || null, ultimo_completo_at: r?.ultimo_completo_at || null };
}

// ------------------------------------------------------------------ cruscotto
/**
 * Cruscotto: accettazioni di oggi per stato e fase, in lavorazione ora, referti pronti non chiusi, in ritardo, TAT medio e mediano
 * accettazione → referto (oggi, 7 giorni, per sede negli ultimi 7 giorni), campioni in viaggio (raccolti e non arrivati, e quanti oltre
 * `ore_campioni`), esami non eseguiti di oggi. Ogni numero ha il filtro dell'elenco che lo apre.
 */
export async function cruscotto(ctx) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const per = ctx.tutte ? 'TRUE' : `pc.site_id = ANY(${p(ctx.siteIds)}::int[])`;
  const base = `synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO' AND ${per}`;
  const pOggi = p(oggi), pAdesso = p(adesso), pFin = p(imp.giorni_finestra), pOreC = p(imp.ore_campioni);
  const rit = sqlRitardo(p, imp, adesso);
  const x = await one(`WITH ${SQL_PC},
    oggi AS (SELECT r.state, count(*)::int AS n FROM ${base} AND r.date = ${pOggi}::date GROUP BY r.state),
    aperte AS (SELECT r.state, count(*)::int AS n FROM ${base} AND r.state IN (${STATI_IN_CORSO.join(',')}, 40) AND r.date >= ${pOggi}::date - ${pFin}::int GROUP BY r.state),
    ritardo AS (SELECT count(*)::int AS n FROM ${base} AND ${rit}),
    tat AS (SELECT r.report_at_local, pc.site_id, pc.sede_code, pc.sede_name, extract(epoch FROM (r.report_at_local - r.created_at_local)) / 3600.0 AS ore
              FROM ${base} AND r.report_at_local >= ${pAdesso}::timestamp - interval '7 days' AND r.created_at_local IS NOT NULL AND r.report_at_local >= r.created_at_local),
    viaggio AS (SELECT count(*)::int AS n, count(*) FILTER (WHERE coalesce(s.collected_at_local, s.sample_at_local) < ${pAdesso}::timestamp - make_interval(hours => ${pOreC}::int))::int AS oltre
              FROM synclab.samples s, ${base} AND s.instance_id = r.instance_id AND s.request_id = r.id
               AND coalesce(s.collected_at_local, s.sample_at_local) IS NOT NULL AND s.checked_in_at_local IS NULL AND r.date >= ${pOggi}::date - ${pFin}::int AND r.state NOT IN (11, 40, 50)),
    ne AS (SELECT count(*)::int AS righe, count(DISTINCT (r.instance_id, r.id))::int AS accettazioni FROM ${base} AND r.date = ${pOggi}::date
              AND EXISTS (SELECT 1 FROM synclab.request_items i WHERE i.instance_id = r.instance_id AND i.request_id = r.id AND i.not_performed_code IS NOT NULL AND coalesce(i.deleted, FALSE) = FALSE))
    SELECT (SELECT coalesce(json_agg(oggi), '[]') FROM oggi) AS oggi, (SELECT coalesce(json_agg(aperte), '[]') FROM aperte) AS aperte, (SELECT n FROM ritardo) AS ritardo,
      (SELECT json_build_object('n', count(*), 'media', avg(ore), 'mediana', percentile_cont(0.5) WITHIN GROUP (ORDER BY ore)) FROM tat WHERE report_at_local::date = ${pOggi}::date) AS tat_oggi,
      (SELECT json_build_object('n', count(*), 'media', avg(ore), 'mediana', percentile_cont(0.5) WITHIN GROUP (ORDER BY ore), 'p90', percentile_cont(0.9) WITHIN GROUP (ORDER BY ore)) FROM tat) AS tat_7,
      (SELECT coalesce(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT site_id, max(sede_code) AS sede_code, max(sede_name) AS sede_name, count(*)::int AS n, avg(ore) AS media, percentile_cont(0.5) WITHIN GROUP (ORDER BY ore) AS mediana FROM tat GROUP BY site_id) t) AS tat_sedi,
      (SELECT row_to_json(viaggio) FROM viaggio) AS viaggio,
      (SELECT count(*)::int FROM synclab.request_items i JOIN synclab.requests r ON r.instance_id = i.instance_id AND r.id = i.request_id LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
        WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO' AND ${per} AND r.date = ${pOggi}::date AND i.not_performed_code IS NOT NULL AND coalesce(i.deleted, FALSE) = FALSE) AS ne_righe,
      (SELECT accettazioni FROM ne) AS ne_accettazioni`, params);
  const oggiPerStato = Object.fromEntries((x.oggi || []).map((r) => [r.state, r.n]));
  const fasiOggi = FASI.map((f, i) => ({ key: f.key, label: f.label, breve: f.breve, indice: i, n: f.stati.reduce((s, st) => s + (oggiPerStato[st] || 0), 0) }));
  const aperte = Object.fromEntries((x.aperte || []).map((r) => [r.state, r.n]));
  const totOggi = Object.values(oggiPerStato).reduce((s, n) => s + n, 0);
  const t = (o) => (o ? { n: Number(o.n) || 0, media: o1(o.media), mediana: o1(o.mediana), p90: o1(o.p90) } : null);
  return {
    oggi, adesso, soglia: { ore_ritardo: imp.ore_ritardo, ore_campioni: imp.ore_campioni, giorni_finestra: imp.giorni_finestra, soglie_fase: imp.soglie_fase },
    oggi_totale: totOggi, oggi_fasi: fasiOggi, oggi_nc: oggiPerStato[11] || 0,
    oggi_altri: Object.entries(oggiPerStato).filter(([s]) => ![...FASI.flatMap((f) => f.stati), 11].includes(Number(s))).map(([s, n]) => ({ stato: Number(s), label: `Stato ${s} del gestionale`, n })),
    in_lavorazione: STATI_IN_CORSO.reduce((s, st) => s + (aperte[st] || 0), 0),
    in_lavorazione_stati: STATI_IN_CORSO.map((st) => ({ stato: st, label: STATO_LABEL[st], n: aperte[st] || 0 })),
    referti_non_chiusi: aperte[40] || 0, in_ritardo: x.ritardo || 0,
    tat_oggi: t(x.tat_oggi), tat_7: t(x.tat_7),
    tat_sedi: (x.tat_sedi || []).map((s) => ({ site_id: s.site_id, sede: s.site_id ? nomeSede({ code: s.sede_code, name: s.sede_name }) : 'Client non abbinati a una sede', n: s.n, media: o1(s.media), mediana: o1(s.mediana) })),
    campioni_viaggio: x.viaggio?.n || 0, campioni_viaggio_oltre: x.viaggio?.oltre || 0,
    non_eseguiti_oggi: { righe: x.ne_righe || 0, accettazioni: x.ne_accettazioni || 0 },
  };
}

// ------------------------------------------------------------------ campioni
export const STATI_CAMPIONE = {
  NON_RACCOLTO: { label: 'Non ancora raccolto', sql: 's.collected_at_local IS NULL AND s.sample_at_local IS NULL AND s.checked_in_at_local IS NULL' },
  IN_VIAGGIO: { label: 'Raccolto, non arrivato', sql: 'coalesce(s.collected_at_local, s.sample_at_local) IS NOT NULL AND s.checked_in_at_local IS NULL' },
  ARRIVATO: { label: 'Arrivato (check-in)', sql: 's.checked_in_at_local IS NOT NULL AND s.prepared_at_local IS NULL AND s.checked_out_at_local IS NULL' },
  PREPARATO: { label: 'Preparato', sql: 's.prepared_at_local IS NOT NULL AND s.checked_out_at_local IS NULL' },
  USCITO: { label: 'Uscito (check-out)', sql: 's.checked_out_at_local IS NOT NULL' },
};
export const statoCampione = (s) => (s.checked_out_at_local ? 'USCITO' : s.prepared_at_local ? 'PREPARATO' : s.checked_in_at_local ? 'ARRIVATO' : (s.collected_at_local || s.sample_at_local) ? 'IN_VIAGGIO' : 'NON_RACCOLTO');

/** Campioni paginati: filtri sede, periodo (data dell'accettazione), stato del campione, "non arrivati da più di N ore", barcode. */
export async function elencoCampioni(q, ctx) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const w = ['r.deleted_at IS NULL', `r.disponibilita = 'ATTIVO'`];
  if (!ctx.tutte) w.push(`pc.site_id = ANY(${p(ctx.siteIds)}::int[])`);
  const bc = String(q.barcode || '').trim().slice(0, 80);
  const per = periodo(q, { oggi, predefinito: bc || q.viaggio === '1' || q.non_arrivati === '1' ? 'tutto' : '7g' });
  if (per.da) w.push(`r.date BETWEEN ${p(per.da)}::date AND ${p(per.a)}::date`);
  const sede = String(q.sede || '');
  if (sede === 'ND') w.push('pc.site_id IS NULL'); else if (/^\d+$/.test(sede)) w.push(`pc.site_id = ${p(Number(sede))}`);
  const cli = String(q.cliente || '').trim();
  if (/^\d+$/.test(cli)) w.push(`pc.organization_id = ${p(Number(cli))}`); else if (/^c-.{1,200}$/.test(cli)) w.push(`r.client_id = ${p(cli.slice(2))}`);
  if (STATI_CAMPIONE[q.stato]) w.push(`(${STATI_CAMPIONE[q.stato].sql})`);
  const ore = Number(q.ore) > 0 ? Math.min(720, Number(q.ore)) : imp.ore_campioni;
  // in viaggio (come il cruscotto): raccolti e non arrivati, accettazioni non chiuse né refertate né NC, nella finestra; non_arrivati =
  // in viaggio da più di N ore (impostazione ore_campioni)
  if (q.viaggio === '1' || q.non_arrivati === '1') {
    w.push(`(${STATI_CAMPIONE.IN_VIAGGIO.sql}) AND r.state NOT IN (11, 40, 50) AND r.date >= ${p(oggi)}::date - ${p(imp.giorni_finestra)}::int`);
    if (q.non_arrivati === '1') w.push(`coalesce(s.collected_at_local, s.sample_at_local) < ${p(adesso)}::timestamp - make_interval(hours => ${p(ore)}::int)`);
  }
  if (bc) w.push(`(s.barcode = ${p(bc)} OR regexp_replace(upper(coalesce(s.barcode, '')), '[[:space:]/._\\\\-]+', '', 'g') = ${p(bc.toUpperCase().replace(/[\s\-_/.\\]+/g, ''))})`);
  const where = w.join(' AND ');
  const from = `synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id`;
  const tot = await one(`WITH ${SQL_PC} SELECT count(*)::int AS n FROM ${from} WHERE ${where}`, params);
  const pagina = Math.max(1, Number(q.pagina) || 1), pp = Math.max(10, Math.min(200, Number(q.per_pagina) || 50));
  const rows = await many(`WITH ${SQL_PC} SELECT s.instance_id, s.request_id, s.ord, s.id, s.barcode, s.material, s.container, s.sample_at_local, s.collected_at_local, s.checked_in_at_local,
      s.prepared_at_local, s.checked_out_at_local, r.request_number, r.date::text AS data, r.state, r.client_id, r.client_code, pc.cliente, pc.organization_id, pc.site_id, pc.sede_code, pc.sede_name,
      (SELECT string_agg(DISTINCT i.exam_code, ' ' ORDER BY i.exam_code) FROM synclab.request_items i
        WHERE i.instance_id = s.instance_id AND i.request_id = s.request_id AND coalesce(i.deleted, FALSE) = FALSE
          AND (s.id = ANY(i.sample_ids) OR EXISTS (SELECT 1 FROM synclab.request_item_samples l WHERE l.instance_id = i.instance_id AND l.request_id = i.request_id AND l.item_id = i.id AND l.sample_id = s.id))) AS esami
    FROM ${from} WHERE ${where}
    ORDER BY coalesce(s.collected_at_local, s.sample_at_local, r.created_at_local) ${q.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, r.id, s.ord LIMIT ${p(pp)} OFFSET ${p((pagina - 1) * pp)}`, params);
  return {
    totale: tot.n, pagina, per_pagina: pp, periodo: per, ore, adesso,
    righe: rows.map((s) => {
      const st = statoCampione(s);
      const raccolto = tsLocale(s.collected_at_local || s.sample_at_local);
      return {
        instance_id: s.instance_id, request_id: s.request_id, id: s.id, barcode: s.barcode, materiale: s.material, contenitore: s.container, esami: s.esami || null,
        prelevato_il: tsLocale(s.sample_at_local), raccolto_il: tsLocale(s.collected_at_local), checkin_il: tsLocale(s.checked_in_at_local), preparato_il: tsLocale(s.prepared_at_local), checkout_il: tsLocale(s.checked_out_at_local),
        stato: st, stato_label: STATI_CAMPIONE[st].label, ore_viaggio: st === 'IN_VIAGGIO' && raccolto ? Math.floor(minutiTra(raccolto, adesso) / 60) : null,
        numero: s.request_number, data: s.data, stato_accettazione: STATO_LABEL[s.state] || (s.state != null ? `Stato ${s.state}` : null),
        client_id: s.client_id, cliente: s.cliente || s.client_code || s.client_id, organization_id: s.organization_id, site_id: s.site_id, sede: s.site_id ? nomeSede({ code: s.sede_code, name: s.sede_name }) : null,
      };
    }),
  };
}

// ------------------------------------------------------------------ ritardi
/**
 * Accettazioni in ritardo (tutte, al più 2.000), raggruppate per cliente e per sede, con gli esami che bloccano (righe non cancellate,
 * non "non eseguite", senza validazione né referto pronto).
 */
export async function ritardi(q, ctx) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const { where, params } = await filtriElenco({ ...q, ritardo: '1', periodo: q.periodo || 'tutto' }, ctx, imp, { oggi, adesso, predefinito: 'tutto' });
  const ids = await many(`WITH ${SQL_PC} SELECT r.instance_id, r.id FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
    WHERE ${where} ORDER BY r.created_at_local ASC NULLS LAST, r.id LIMIT 2001`, params);
  const regola = await regolaValore();
  const righe = await dettagliElenco(ids.slice(0, 2000).map((x) => [x.instance_id, x.id]), { imp, regola, adesso, oggi, nc: await ncDisponibile() });
  const bl = righe.length ? await many(`SELECT i.instance_id, i.request_id, i.exam_code, coalesce(i.description, e.description) AS descrizione, i.executed_at_local
      FROM synclab.request_items i LEFT JOIN LATERAL (SELECT x.description FROM synclab.exams x WHERE x.exam_code = i.exam_code AND x.disponibilita = 'ATTIVO' ORDER BY x.updated_at DESC LIMIT 1) e ON TRUE
     WHERE i.request_id = ANY($2::text[]) AND i.instance_id = ANY($1::text[]) AND coalesce(i.deleted, FALSE) = FALSE AND i.not_performed_code IS NULL
       AND i.validated_at_local IS NULL AND coalesce(i.report_ready, FALSE) = FALSE ORDER BY i.ord`, [righe.map((r) => r.instance_id), righe.map((r) => r.id)]) : [];
  const B = new Map();
  for (const b of bl) { const k = `${b.instance_id}|${b.request_id}`; if (!B.has(k)) B.set(k, []); B.get(k).push({ codice: b.exam_code, descrizione: b.descrizione, eseguito: Boolean(b.executed_at_local) }); }
  const conBlocchi = righe.map((r) => ({ ...r, bloccanti: B.get(`${r.instance_id}|${r.id}`) || [] }));
  const gruppo = (chiave, nome) => {
    const m = new Map();
    for (const r of conBlocchi) {
      const k = chiave(r);
      if (!m.has(k)) m.set(k, { chiave: k, nome: nome(r), client_id: r.client_id, organization_id: r.organization_id, site_id: r.site_id, n: 0, ore_max: 0, fasi: {} });
      const g = m.get(k); g.n++; g.ore_max = Math.max(g.ore_max, r.ritardo.ore || 0); g.fasi[r.fase.key || 'ALTRO'] = (g.fasi[r.fase.key || 'ALTRO'] || 0) + 1;
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.ore_max - a.ore_max);
  };
  const esami = new Map();
  for (const r of conBlocchi) for (const b of r.bloccanti) { const k = b.codice || '?'; if (!esami.has(k)) esami.set(k, { codice: k, descrizione: b.descrizione, accettazioni: 0 }); esami.get(k).accettazioni++; }
  return {
    adesso, soglia: { ore_ritardo: imp.ore_ritardo, soglie_fase: imp.soglie_fase, giorni_finestra: imp.giorni_finestra }, totale: ids.length > 2000 ? '2000+' : ids.length,
    righe: conBlocchi, per_cliente: gruppo((r) => `${r.instance_id}|${r.client_id}`, (r) => r.cliente), per_sede: gruppo((r) => String(r.site_id ?? 'ND'), (r) => r.sede || 'Client non abbinati a una sede'),
    esami_bloccanti: [...esami.values()].sort((a, b) => b.accettazioni - a.accettazioni).slice(0, 20),
  };
}

// ------------------------------------------------------------------ tempi di refertazione (TAT)
/**
 * TAT accettazione → referto (ore) delle accettazioni del periodo CON reportAtLocal: mediana, 90° percentile, media, % entro la soglia
 * (ore_ritardo); per cliente, per sede, andamento settimanale, i 10 esami più lenti (per esame: dall'accettazione alla validazione della
 * riga, o al referto se la riga non ha la validazione), confronto con lo stesso periodo del mese precedente.
 */
export async function tat(q, ctx) {
  const imp = await settings();
  const oggi = oggiRoma();
  const per = periodo(q, { oggi, predefinito: '30g' });
  const soglia = Number(q.soglia) > 0 ? Math.min(2000, Number(q.soglia)) : imp.ore_ritardo;
  const esame = String(q.esame || '').trim().toUpperCase().slice(0, 40);
  const leggi = async (da, a) => {
    const { where, params, p } = await filtriElenco({ ...q, periodo: 'intervallo', da, a, q: '' }, ctx, imp, { oggi });
    const w = `${where} AND r.report_at_local IS NOT NULL AND r.created_at_local IS NOT NULL AND r.report_at_local >= r.created_at_local
      ${esame ? `AND EXISTS (SELECT 1 FROM synclab.request_items ie WHERE ie.instance_id = r.instance_id AND ie.request_id = r.id AND upper(ie.exam_code) = ${p(esame)} AND coalesce(ie.deleted, FALSE) = FALSE)` : ''}`;
    const pS = p(soglia);
    const cte = `WITH ${SQL_PC}, t AS MATERIALIZED (SELECT r.instance_id, r.id, r.date, r.client_id, r.created_at_local, r.report_at_local, pc.cliente, pc.organization_id, pc.site_id, pc.sede_code, pc.sede_name,
        extract(epoch FROM (r.report_at_local - r.created_at_local)) / 3600.0 AS ore FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id WHERE ${w})`;
    const AGG = `count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY ore) AS mediana, percentile_cont(0.9) WITHIN GROUP (ORDER BY ore) AS p90, avg(ore) AS media, count(*) FILTER (WHERE ore <= ${pS})::int AS entro`;
    const x = await one(`${cte} SELECT (SELECT row_to_json(z) FROM (SELECT ${AGG} FROM t) z) AS tot,
      (SELECT coalesce(json_agg(z ORDER BY z.settimana), '[]') FROM (SELECT to_char(date_trunc('week', date), 'YYYY-MM-DD') AS settimana, ${AGG} FROM t GROUP BY 1) z) AS settimane,
      (SELECT coalesce(json_agg(z ORDER BY z.n DESC), '[]') FROM (SELECT instance_id, client_id, max(cliente) AS cliente, max(organization_id) AS organization_id, ${AGG} FROM t GROUP BY instance_id, client_id) z) AS clienti,
      (SELECT coalesce(json_agg(z ORDER BY z.n DESC), '[]') FROM (SELECT site_id, max(sede_code) AS sede_code, max(sede_name) AS sede_name, ${AGG} FROM t GROUP BY site_id) z) AS sedi,
      (SELECT coalesce(json_agg(z ORDER BY z.mediana DESC), '[]') FROM (
         SELECT upper(i.exam_code) AS codice, max(coalesce(i.description, '')) AS descrizione, count(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (coalesce(i.validated_at_local, t.report_at_local) - t.created_at_local)) / 3600.0) AS mediana,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (coalesce(i.validated_at_local, t.report_at_local) - t.created_at_local)) / 3600.0) AS p90
           FROM t JOIN synclab.request_items i ON i.instance_id = t.instance_id AND i.request_id = t.id AND coalesce(i.deleted, FALSE) = FALSE AND i.not_performed_code IS NULL AND i.exam_code IS NOT NULL
          WHERE coalesce(i.validated_at_local, t.report_at_local) >= t.created_at_local
          GROUP BY upper(i.exam_code) HAVING count(*) >= ${p(Math.max(1, Number(q.min_esami) || 3))} ORDER BY 4 DESC LIMIT 10) z) AS esami`, params);
    const f = (z) => (z ? { n: Number(z.n) || 0, mediana: o1(z.mediana), p90: o1(z.p90), media: o1(z.media), entro: Number(z.entro) || 0, entro_pct: z.n ? o1((Number(z.entro) / Number(z.n)) * 100) : null } : { n: 0 });
    return {
      totale: f(x.tot), settimane: (x.settimane || []).map((z) => ({ settimana: z.settimana, ...f(z) })),
      clienti: (x.clienti || []).map((z) => ({ client_id: z.client_id, instance_id: z.instance_id, cliente: z.cliente || z.client_id, organization_id: z.organization_id, ...f(z) })),
      sedi: (x.sedi || []).map((z) => ({ site_id: z.site_id, sede: z.site_id ? nomeSede({ code: z.sede_code, name: z.sede_name }) : 'Client non abbinati a una sede', ...f(z) })),
      esami_lenti: (x.esami || []).map((z) => ({ codice: z.codice, descrizione: z.descrizione || null, n: z.n, mediana: o1(z.mediana), p90: o1(z.p90) })),
    };
  };
  const cur = await leggi(per.da || '2000-01-01', per.a || oggi);
  const prec = per.da ? { da: addMesi(per.da, -1), a: addMesi(per.a, -1) } : null;
  const pr = prec ? await leggi(prec.da, prec.a) : null;
  // descrizioni del catalogo per gli esami più lenti senza descrizione di riga
  const senza = cur.esami_lenti.filter((e) => !e.descrizione).map((e) => e.codice);
  if (senza.length) {
    const d = new Map((await many(`SELECT DISTINCT ON (upper(exam_code)) upper(exam_code) AS c, description FROM synclab.exams WHERE upper(exam_code) = ANY($1::text[]) ORDER BY upper(exam_code), updated_at DESC`, [senza])).map((x) => [x.c, x.description]));
    for (const e of cur.esami_lenti) if (!e.descrizione) e.descrizione = d.get(e.codice) || null;
  }
  return { periodo: per, soglia, esame: esame || null, ...cur, mese_prima: pr ? { periodo: prec, totale: pr.totale } : null };
}

// ------------------------------------------------------------------ esami non eseguiti
/** Righe d'esame con notPerformedCode del periodo: per codice, per esame, per cliente, per settimana, e le righe (100 per pagina). */
export async function nonEseguiti(q, ctx) {
  const imp = await settings();
  const oggi = oggiRoma();
  const { where, params, p, filtri } = await filtriElenco({ ...q, q: '' }, ctx, imp, { oggi, predefinito: '30g' });
  const esame = String(q.esame || '').trim().toUpperCase().slice(0, 40);
  const codice = /^-?\d{1,6}$/.test(String(q.codice ?? '')) ? Number(q.codice) : null;
  // totale delle righe d'esame del periodo (per la percentuale): parametri propri, prima di aggiungere quelli delle righe non eseguite
  const pt = [...params];
  const tot = await one(`WITH ${SQL_PC} SELECT count(*)::int AS n FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
      JOIN synclab.request_items i ON i.instance_id = r.instance_id AND i.request_id = r.id AND coalesce(i.deleted, FALSE) = FALSE WHERE ${where}${esame ? ` AND upper(i.exam_code) = $${pt.push(esame)}` : ''}`, pt);
  const wi = `coalesce(i.deleted, FALSE) = FALSE AND i.not_performed_code IS NOT NULL${esame ? ` AND upper(i.exam_code) = ${p(esame)}` : ''}${codice != null ? ` AND i.not_performed_code = ${p(codice)}` : ''}`;
  const cte = `WITH ${SQL_PC}, ne AS MATERIALIZED (SELECT r.instance_id, r.id AS request_id, r.request_number, r.date, r.client_id, pc.cliente, pc.organization_id, pc.site_id, pc.sede_code, pc.sede_name,
      i.exam_code, coalesce(i.description, '') AS descrizione, i.not_performed_code AS codice
      FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
      JOIN synclab.request_items i ON i.instance_id = r.instance_id AND i.request_id = r.id WHERE ${where} AND ${wi})`;
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const x = await one(`${cte} SELECT (SELECT count(*)::int FROM ne) AS righe, (SELECT count(DISTINCT (instance_id, request_id))::int FROM ne) AS accettazioni,
      (SELECT coalesce(json_agg(z ORDER BY z.n DESC), '[]') FROM (SELECT codice, count(*)::int AS n FROM ne GROUP BY codice) z) AS codici,
      (SELECT coalesce(json_agg(z ORDER BY z.n DESC), '[]') FROM (SELECT upper(exam_code) AS esame, max(descrizione) AS descrizione, count(*)::int AS n FROM ne GROUP BY upper(exam_code) ORDER BY 3 DESC LIMIT 20) z) AS esami,
      (SELECT coalesce(json_agg(z ORDER BY z.n DESC), '[]') FROM (SELECT instance_id, client_id, max(cliente) AS cliente, max(organization_id) AS organization_id, count(*)::int AS n FROM ne GROUP BY instance_id, client_id ORDER BY 5 DESC LIMIT 20) z) AS clienti,
      (SELECT coalesce(json_agg(z ORDER BY z.settimana), '[]') FROM (SELECT to_char(date_trunc('week', date), 'YYYY-MM-DD') AS settimana, count(*)::int AS n FROM ne GROUP BY 1) z) AS settimane,
      (SELECT coalesce(json_agg(z), '[]') FROM (SELECT instance_id, request_id, request_number, date::text AS data, client_id, cliente, organization_id, site_id, sede_code, sede_name, exam_code, descrizione, codice
                 FROM ne ORDER BY date DESC, request_number DESC, exam_code LIMIT 100 OFFSET ${p((pagina - 1) * 100)}) z) AS elenco`, params);
  const desc = new Map();
  const cod = [...new Set([...(x.esami || []).map((e) => e.esame), ...(x.elenco || []).map((e) => String(e.exam_code || '').toUpperCase())])].filter(Boolean);
  if (cod.length) for (const d of await many(`SELECT DISTINCT ON (upper(exam_code)) upper(exam_code) AS c, description FROM synclab.exams WHERE upper(exam_code) = ANY($1::text[]) ORDER BY upper(exam_code), updated_at DESC`, [cod])) desc.set(d.c, d.description);
  return {
    periodo: { periodo: filtri.periodo, da: filtri.da, a: filtri.a }, filtri: { ...filtri, esame: esame || null, codice }, righe: x.righe, accettazioni: x.accettazioni, esami_totali: tot.n,
    quota_pct: tot.n ? o1((x.righe / tot.n) * 100) : null,
    per_codice: x.codici || [], per_esame: (x.esami || []).map((e) => ({ ...e, descrizione: e.descrizione || desc.get(e.esame) || null })),
    per_cliente: (x.clienti || []).map((c) => ({ ...c, cliente: c.cliente || c.client_id })), settimane: x.settimane || [], pagina,
    elenco: (x.elenco || []).map((e) => ({ instance_id: e.instance_id, request_id: e.request_id, numero: e.request_number, data: e.data, client_id: e.client_id, cliente: e.cliente || e.client_id, organization_id: e.organization_id,
      site_id: e.site_id, sede: e.site_id ? nomeSede({ code: e.sede_code, name: e.sede_name }) : null, codice_esame: e.exam_code, descrizione: e.descrizione || desc.get(String(e.exam_code || '').toUpperCase()) || null, codice: e.codice })),
  };
}

// ------------------------------------------------------------------ clienti
/** Client Synclab con accettazioni nel periodo: accettazioni, in corso, in ritardo, referti, valore (produzione accettata), TAT mediano. */
export async function clienti(q, ctx) {
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const { where, params, p, filtri } = await filtriElenco({ ...q, q: '' }, ctx, imp, { oggi, adesso, predefinito: '30g' });
  const regola = await regolaValore();
  const pSt = p(regola.stati);
  const rit = sqlRitardo(p, imp, adesso);
  const testo = String(q.q || '').trim().toLowerCase().slice(0, 60);
  const rows = await many(`WITH ${SQL_PC}, acc AS MATERIALIZED (SELECT r.*, pc.cliente, pc.organization_id, pc.site_id, pc.sede_code, pc.sede_name, pc.stato_abbinamento, pc.org_name, ${rit} AS in_ritardo
        FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id WHERE ${where}),
      v AS (SELECT a.instance_id, a.client_id, sum(i.net_unit_price_excluding_vat * i.quantity * CASE WHEN ${regola.applica ? 'TRUE' : 'FALSE'} THEN 1 - coalesce(a.header_discount_percent, 0) / 100.0 ELSE 1 END) AS valore,
                   count(*) FILTER (WHERE i.net_unit_price_excluding_vat IS NULL OR i.quantity IS NULL)::int AS senza_prezzo
              FROM acc a JOIN synclab.request_items i ON i.instance_id = a.instance_id AND i.request_id = a.id AND coalesce(i.deleted, FALSE) = FALSE
             WHERE a.state = ANY(${pSt}::int[]) GROUP BY 1, 2)
    SELECT a.instance_id, a.client_id, max(a.client_code) AS client_code, max(a.cliente) AS cliente, max(a.organization_id) AS organization_id, max(a.org_name) AS org_name, max(a.site_id) AS site_id,
           max(a.sede_code) AS sede_code, max(a.sede_name) AS sede_name, max(a.stato_abbinamento) AS stato_abbinamento, count(*)::int AS accettazioni,
           count(*) FILTER (WHERE a.state IN (${STATI_IN_CORSO.join(',')}))::int AS in_corso, count(*) FILTER (WHERE a.in_ritardo)::int AS in_ritardo,
           count(*) FILTER (WHERE a.state IN (40, 50))::int AS refertate, count(*) FILTER (WHERE a.state = 11)::int AS nc_mai_arrivato,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.report_at_local - a.created_at_local)) / 3600.0) FILTER (WHERE a.report_at_local >= a.created_at_local) AS tat_mediana,
           max(v.valore) AS valore, max(v.senza_prezzo) AS senza_prezzo
      FROM acc a LEFT JOIN v ON v.instance_id = a.instance_id AND v.client_id = a.client_id
     GROUP BY a.instance_id, a.client_id ORDER BY count(*) DESC, max(a.cliente)`, params);
  const righe = rows.filter((r) => !testo || `${r.cliente || ''} ${r.client_code || ''} ${r.org_name || ''}`.toLowerCase().includes(testo)).map((r) => ({
    instance_id: r.instance_id, client_id: r.client_id, client_code: r.client_code, cliente: r.cliente || r.client_code || r.client_id, organization_id: r.organization_id, org_name: r.org_name,
    site_id: r.site_id, sede: r.site_id ? nomeSede({ code: r.sede_code, name: r.sede_name }) : null, abbinamento: r.stato_abbinamento || 'DA_ABBINARE',
    accettazioni: r.accettazioni, in_corso: r.in_corso, in_ritardo: r.in_ritardo, refertate: r.refertate, nc_mai_arrivato: r.nc_mai_arrivato,
    tat_mediana: o1(r.tat_mediana), valore: n2(r.valore), senza_prezzo: r.senza_prezzo || 0,
  }));
  return { periodo: { periodo: filtri.periodo, da: filtri.da, a: filtri.a }, righe, regola: { stati: regola.stati, sconto: regola.sconto }, soglia: { ore_ritardo: imp.ore_ritardo } };
}

/** Ricerca dei clienti per il filtro (nome, codice StudioLab, Legal entity), nel perimetro: al più 20. */
export async function cercaClienti(testo, ctx) {
  const t = String(testo || '').trim().toLowerCase().slice(0, 60);
  if (t.length < 2) return [];
  const params = [`%${t}%`];
  const per = ctx.tutte ? '' : ` AND pc.site_id = ANY($2::int[])`;
  if (!ctx.tutte) params.push(ctx.siteIds);
  return many(`WITH ${SQL_PC} SELECT pc.instance_id, pc.client_id, pc.client_code, pc.cliente, pc.organization_id, pc.org_name, pc.site_id, pc.sede_code, pc.sede_name
    FROM pc WHERE (lower(pc.cliente) LIKE $1 OR lower(coalesce(pc.client_code, '')) LIKE $1 OR lower(coalesce(pc.org_name, '')) LIKE $1)${per}
    ORDER BY (lower(coalesce(pc.client_code, '')) = ${`$${params.push(t)}`}) DESC, lower(pc.cliente) LIMIT 20`, params);
}

/** Etichetta di un filtro cliente (per mostrarlo quando arriva da un link): Legal entity o client. */
export async function nomeFiltroCliente(cliente) {
  const c = String(cliente || '');
  if (/^\d+$/.test(c)) { const o = await one('SELECT name FROM public.organizations WHERE id = $1', [Number(c)]); return o ? `${o.name} (Legal entity)` : null; }
  if (/^c-/.test(c)) { const x = await one(`SELECT coalesce(legal_name, client_code, client_id) AS n, client_code FROM synclab.clients_td WHERE client_id = $1 LIMIT 1`, [c.slice(2)]); return x ? `${x.n}${x.client_code && x.client_code !== x.n ? ` (${x.client_code})` : ''}` : null; }
  return null;
}

export { LEGENDA_STATI, statoEsame };

// ------------------------------------------------------------------ Cockpit (v0.71.0): tessere dell'operatività
/**
 * Indicatori di Lab Control per il Cockpit (tutta la rete, nessun perimetro, nessun link): in lavorazione ora (stati 15-25 della finestra)
 * con i referti pronti non chiusi; in ritardo oltre la soglia con la quota sulle aperte; TAT mediano accettazione → referto degli ultimi 7
 * giorni con il 90° percentile e il confronto con i 7 giorni prima. Soglie dalle impostazioni del modulo (predefinite se il modulo non è
 * avviato). Ritorna null se la copia non ha accettazioni.
 */
export async function indicatoriCockpit({ adesso = adessoRoma() } = {}) {
  let imp;
  try { imp = await settings(); } catch { imp = { ore_ritardo: 72, soglie_fase: {}, giorni_finestra: 60 }; }
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const pA = p(adesso), pF = p(imp.giorni_finestra);
  const rit = sqlRitardo(p, imp, adesso);
  const x = await one(`SELECT
      (SELECT count(*)::int FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO') AS totale,
      (SELECT count(*)::int FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO' AND r.state IN (${STATI_IN_CORSO.join(',')}) AND r.date >= (${pA}::timestamp)::date - ${pF}::int) AS in_corso,
      (SELECT count(*)::int FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO' AND r.state = 40 AND r.date >= (${pA}::timestamp)::date - ${pF}::int) AS referti_aperti,
      (SELECT count(*)::int FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO' AND ${rit}) AS in_ritardo,
      (SELECT json_build_object('n', count(*), 'mediana', percentile_cont(0.5) WITHIN GROUP (ORDER BY o), 'p90', percentile_cont(0.9) WITHIN GROUP (ORDER BY o))
         FROM (SELECT extract(epoch FROM (r.report_at_local - r.created_at_local)) / 3600.0 AS o FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO'
                 AND r.report_at_local >= ${pA}::timestamp - interval '7 days' AND r.report_at_local <= ${pA}::timestamp AND r.report_at_local >= r.created_at_local) t) AS tat7,
      (SELECT json_build_object('n', count(*), 'mediana', percentile_cont(0.5) WITHIN GROUP (ORDER BY o))
         FROM (SELECT extract(epoch FROM (r.report_at_local - r.created_at_local)) / 3600.0 AS o FROM synclab.requests r WHERE r.deleted_at IS NULL AND r.disponibilita = 'ATTIVO'
                 AND r.report_at_local >= ${pA}::timestamp - interval '14 days' AND r.report_at_local < ${pA}::timestamp - interval '7 days' AND r.report_at_local >= r.created_at_local) t) AS tat7p`, params);
  if (!x?.totale) return null;
  return {
    in_corso: x.in_corso, referti_aperti: x.referti_aperti, in_ritardo: x.in_ritardo, soglia: imp.ore_ritardo, giorni_finestra: imp.giorni_finestra,
    tat7: { n: Number(x.tat7?.n) || 0, mediana: o1(x.tat7?.mediana), p90: o1(x.tat7?.p90) }, tat7_prima: { n: Number(x.tat7p?.n) || 0, mediana: o1(x.tat7p?.mediana) },
  };
}
