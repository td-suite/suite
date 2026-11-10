// Synclab Data API: letture della copia locale per gli altri moduli (Finance, Ordini, Cockpit, Diagnostica, Retail, Business Hub).
// Nessuna regola inventata:
//  - PRODUZIONE EROGATA (v0.68.5, richiesta del CEO del 10/11/2026: "A me non interessa il dato delle fatture ma il dato delle
//    accettazioni in stato erogato"): la grandezza principale di ricavo B2B in tutta la Suite. Definizione UNICA, qui:
//      accettazioni ATTIVE (disponibilita ATTIVO, non cancellate) con stato in stati_erogati (impostazione del connettore StudioLAB,
//      predefinita 18, 20, 25, 40, 50 = dal prelievo eseguito in poi; esclusi 10 prenotata, 11 NC mai arrivato, 15 in attesa, 30 attende
//      prelievo: IPOTESI DA CONFERMARE); valore = Σ righe d'esame non cancellate di netUnitPriceExcludingVat × quantity ×
//      (1 − headerDiscountPercent/100): lo sconto di testata si applica UNA volta, qui (netUnitPriceExcludingVat è il netto di riga PRIMA
//      dello sconto di testata); righe con prezzo (o quantità) null contate a parte ("n esami senza prezzo"); data = data dell'accettazione.
//    Funzioni: produzioneErogata (per giorno, mese, cliente/Legal entity, sede, ripartizione B2B/Laboratorio in sede, con l'anno prima),
//    produzioneGiornaliera, topClientiProduzione, e le letture storiche che ora la usano (produzioneMensile, produzionePerOrg, cteLab);
//  - fatturato da documenti = netRevenueContribution una sola volta per documento con data nel mese (NC già negative, annullati e
//    proforma a zero, tipo sconosciuto con contributo null: esclusi e contati). Dato SECONDARIO ("Documenti emessi"): mai il KPI
//    principale, mai sommato alla produzione;
//  - listino del cliente = listino corrente (priceListId / extraPriceListId): non ricostruisce i prezzi storici.
// Un client Synclab appartiene a una Legal entity secondo synclab.clients_td (abbinamento confermato, altrimenti proposto).
import { one, many } from '../../db.js';

// ------------------------------------------------------------------ stati e sconto di testata (v0.68.5, v0.68.6)
/** Legenda dei codici di stato dell'accettazione (docs/synclab-data-api/02_DIZIONARIO_BI.md). */
export const LEGENDA_STATI = { 10: 'prenotata', 11: 'NC mai arrivato', 15: 'in attesa', 18: 'prelievo eseguito', 20: 'in lavorazione', 25: 'in firma', 30: 'attende prelievo', 40: 'referto pronto', 50: 'chiuso' };
/**
 * v0.68.6 (CEO 10/11/2026, discrepanza con il report "Riepilogo Esami" di StudioLab): la produzione dei cruscotti è l'ACCETTATO = tutte
 * le accettazioni del periodo negli stati inclusi dal gestionale tranne 11 (NC mai arrivato). È il predefinito dell'impostazione
 * `stati_erogati` (nome storico della chiave; etichetta "Stati che contano come produzione accettata").
 */
export const STATI_ACCETTATO = [10, 15, 18, 20, 25, 30, 40, 50];
/** Definizione della v0.68.5 ("erogati": dal prelievo eseguito in poi): resta come variante della quadratura. */
export const STATI_EROGATI_STORICI = [18, 20, 25, 40, 50];
/** Predefinito in vigore (dalla v0.68.6 = accettato). */
export const STATI_EROGATI_PREDEFINITI = STATI_ACCETTATO;
/** Sconto di testata: APPLICA (netto vero, v0.68.5) o NON_APPLICARE (importi di riga, come il report del gestionale: predefinito v0.68.6). */
export const SCONTO_TESTATA = { APPLICA: 'applicato (netto di riga meno lo sconto di testata)', NON_APPLICARE: 'non applicato (importi di riga, come il report del gestionale)' };
export const SCONTO_TESTATA_PREDEFINITO = 'NON_APPLICARE';
export const normalizzaSconto = (v) => (v === true || String(v ?? '').trim().toUpperCase() === 'APPLICA' ? 'APPLICA' : 'NON_APPLICARE');
/** Normalizza un elenco di stati (array o testo "18, 20"): interi 0-999 distinti e ordinati; vuoto o non valido = predefiniti. */
export function normalizzaStati(v) {
  const lista = Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/);
  const out = [...new Set(lista.map((x) => String(x).trim()).filter((x) => /^\d{1,3}$/.test(x)).map(Number))].sort((x, y) => x - y);
  return out.length ? out : [...STATI_EROGATI_PREDEFINITI];
}
/** Stati in vigore (impostazione `stati_erogati` del connettore StudioLAB, letta da synclab.stati_erogati(): fonte unica). */
export async function statiErogati() {
  const r = await one('SELECT synclab.stati_erogati() AS s').catch(() => null);
  return normalizzaStati(r?.s);
}
/** Regola dello sconto di testata in vigore (impostazione `sconto_testata`, letta da synclab.sconto_testata_applicato()). */
export async function scontoTestata() {
  const r = await one('SELECT synclab.sconto_testata_applicato() AS a').catch(() => null);
  return r?.a === true ? 'APPLICA' : 'NON_APPLICARE';
}
/** Regola completa della produzione in vigore: { stati, sconto: 'APPLICA'|'NON_APPLICARE', applica }. */
export async function regolaProduzione() {
  const [stati, sconto] = [await statiErogati(), await scontoTestata()];
  return { stati, sconto, applica: sconto === 'APPLICA' };
}
// opzione `sconto` delle letture: true/'APPLICA' = applica; false/'NON_APPLICARE' = importi di riga; null/undefined = impostazione
const applicaDa = async (sconto) => (sconto == null ? (await scontoTestata()) === 'APPLICA' : normalizzaSconto(sconto) === 'APPLICA');
/** "18 prelievo eseguito, 20 in lavorazione, …" */
export const descriviStati = (stati) => normalizzaStati(stati).map((s) => `${s}${LEGENDA_STATI[s] ? ` ${LEGENDA_STATI[s]}` : ''}`).join(', ');
const oraRoma = (t) => new Date(t).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
const dataRoma = (t) => new Date(t).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
/** "importi di riga (sconto di testata non applicato)" oppure "netto di riga e sconto di testata" */
export const descriviSconto = (sconto) => (normalizzaSconto(sconto) === 'APPLICA' ? 'netto di riga e sconto di testata' : 'importi di riga (sconto di testata non applicato)');
/**
 * Fonte dichiarata della produzione sotto ogni numero: "Synclab, produzione accettata (stati 10, 15, 18, 20, 25, 30, 40, 50), importi di
 * riga (sconto di testata non applicato), copia al 10/11/2026 · aggiornato alle 14:05". checkpointAt = capturedAt dell'ultima copia delle
 * accettazioni; sconto = regola dello sconto di testata (predefinita NON_APPLICARE).
 */
export function fonteProduzione(stati, checkpointAt = null, sconto = SCONTO_TESTATA_PREDEFINITO) {
  const copia = checkpointAt ? `copia al ${dataRoma(checkpointAt)} · aggiornato alle ${oraRoma(checkpointAt)}` : 'nessuna copia delle accettazioni';
  return `Synclab, produzione accettata (stati ${normalizzaStati(stati).join(', ')}), ${descriviSconto(sconto)}, ${copia}`;
}
/** "aggiornato alle HH:MM" (oggi) oppure "aggiornato al gg/mm/aaaa HH:MM" */
export function aggiornatoAlle(t, oggi = null) {
  if (!t) return null;
  const g = new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const o = oggi || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  return g === o ? `aggiornato alle ${oraRoma(t)}` : `aggiornato al ${dataRoma(t)} ${oraRoma(t)}`;
}
// valore di una riga d'esame: netto di riga × quantità, × (1 − sconto di testata) solo se la regola lo applica; null se prezzo o quantità mancano
const SQL_VALORE_RIGA = (i = 'i', r = 'r', applica = false) => (applica ? `(${i}.net_unit_price_excluding_vat * ${i}.quantity * (1 - coalesce(${r}.header_discount_percent, 0) / 100.0))`
  : `(${i}.net_unit_price_excluding_vat * ${i}.quantity)`);
// parte di sconto di testata della riga (sempre calcolata: "di cui sconti di testata")
const SQL_SCONTO_RIGA = (i = 'i', r = 'r') => `(${i}.net_unit_price_excluding_vat * ${i}.quantity * coalesce(${r}.header_discount_percent, 0) / 100.0)`;

const meseRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const limiti = (mese) => {
  if (!meseRe.test(String(mese))) throw Object.assign(new Error('mese nel formato AAAA-MM'), { status: 400 });
  const [y, m] = mese.split('-').map(Number);
  return { da: `${mese}-01`, a: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
// condizione sul cliente: client_id esplicito oppure tutti i client Synclab abbinati alla Legal entity
const filtroCliente = (alias, { organization_id = null, client_id = null }, params) => {
  if (client_id) { params.push(String(client_id)); return `${alias}.client_id = $${params.length}`; }
  if (organization_id) { params.push(Number(organization_id)); return `(${alias}.instance_id, ${alias}.client_id) IN (SELECT instance_id, client_id FROM synclab.clients_td WHERE organization_id = $${params.length})`; }
  throw Object.assign(new Error('Indicare organization_id oppure client_id'), { status: 400 });
};

/** Ci sono dati Synclab importati? { clients, exams, price_lists, requests, invoices } (righe ATTIVE) */
export async function disponibilita() {
  return one(`SELECT (SELECT count(*) FROM synclab.clients WHERE disponibilita='ATTIVO')::int AS clients, (SELECT count(*) FROM synclab.exams WHERE disponibilita='ATTIVO')::int AS exams,
    (SELECT count(*) FROM synclab.price_lists WHERE disponibilita='ATTIVO')::int AS price_lists, (SELECT count(*) FROM synclab.requests WHERE disponibilita='ATTIVO')::int AS requests,
    (SELECT count(*) FROM synclab.invoices WHERE disponibilita='ATTIVO')::int AS invoices`).catch(() => null);
}

/**
 * Produzione erogata aggregata per mese, codice d'esame e prezzo netto di riga storico; base comune di produzioneMensile e
 * produzionePerOrg. pStati = segnaposto dell'elenco degli stati erogati (es. '$3'). valore = netto di riga × quantità × (1 − sconto di
 * testata), una volta: la Finance e il Business Hub sommano questi valori.
 */
function sqlProduzione(where, pStati, applica = false) {
  return `SELECT to_char(r.date, 'YYYY-MM') AS mese, upper(coalesce(nullif(i.exam_code, ''), '?')) AS codice, max(i.description) AS descrizione,
        i.net_unit_price_excluding_vat AS prezzo_netto, count(*)::int AS righe, sum(i.quantity) AS quantita,
        sum(${SQL_VALORE_RIGA('i', 'r', applica)}) AS valore, sum(i.net_unit_price_excluding_vat * i.quantity) AS valore_righe,
        count(*) FILTER (WHERE ${SQL_VALORE_RIGA('i', 'r', applica)} IS NULL)::int AS senza_prezzo
      FROM synclab.requests r JOIN synclab.request_items i ON i.instance_id = r.instance_id AND i.request_id = r.id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.state = ANY(${pStati}::int[]) AND coalesce(i.deleted, FALSE) = FALSE AND ${where}
     GROUP BY 1, 2, 4 ORDER BY 2, 4`;
}
// testate delle accettazioni erogate con almeno una riga d'esame non cancellata (stessa regola di cteLab): conteggio e sconto di testata
const sqlTestate = (where, pStati, gruppo = '') => `SELECT ${gruppo}count(*)::int AS accettazioni, count(*) FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0)::int AS con_sconto,
      string_agg(DISTINCT r.header_discount_percent::text || '%', ', ') FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0) AS percentuali,
      sum((SELECT sum(${SQL_SCONTO_RIGA('i2', 'r')}) FROM synclab.request_items i2 WHERE i2.instance_id = r.instance_id AND i2.request_id = r.id AND coalesce(i2.deleted, FALSE) = FALSE)) AS sconto_importo
    FROM synclab.requests r WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.state = ANY(${pStati}::int[])
      AND EXISTS (SELECT 1 FROM synclab.request_items i WHERE i.instance_id = r.instance_id AND i.request_id = r.id AND coalesce(i.deleted, FALSE) = FALSE) AND ${where}`;
function sintesiProduzione(rows, testate, applica = false) {
  const righe = rows.map((x) => ({ codice: x.codice, descrizione: x.descrizione, prezzo_netto: x.prezzo_netto, righe: x.righe, quantita: x.quantita, valore: x.valore }));
  const esami = rows.reduce((a, x) => a + Number(x.righe), 0);
  const senza = rows.reduce((a, x) => a + Number(x.senza_prezzo), 0);
  const conValore = rows.filter((x) => x.valore != null);
  const valore = conValore.length ? conValore.reduce((a, x) => a + Number(x.valore), 0) : null;
  const note = [];
  if (senza) note.push(`${senza} esami senza prezzo su ${esami}: valore parziale`);
  const sconto = testate?.sconto_importo != null && Number(testate.sconto_importo) !== 0 ? Math.round(Number(testate.sconto_importo) * 100) / 100 : null;
  const imp = sconto != null ? ` (${applica ? '−' : ''}${sconto.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €)` : '';
  if (testate?.con_sconto) note.push(applica ? `${testate.con_sconto} accettazioni con sconto di testata (${testate.percentuali}): applicato una volta ai netti di riga${imp}`
    : `${testate.con_sconto} accettazioni con sconto di testata (${testate.percentuali}): non applicato, importi di riga come il report del gestionale${imp}`);
  return { esami, valore, righe_senza_prezzo: senza, righe, accettazioni: testate?.accettazioni ?? null, sconto_testata: testate?.con_sconto ? { accettazioni: testate.con_sconto, percentuali: testate.percentuali, importo: sconto, applicato: applica } : null, note: note.join('. ') || null };
}

/**
 * Produzione erogata del mese di un cliente (Legal entity o client Synclab): { esami (righe), valore (netto vero, null se nessun
 * prezzo), righe: [{ codice, descrizione, prezzo_netto, righe, quantita, valore }], righe_senza_prezzo, accettazioni, sconto_testata, note }.
 */
export async function produzioneMensile({ organization_id = null, client_id = null, mese, stati = null, sconto = null }) {
  const { da, a } = limiti(mese);
  const params = [da, a, stati ? normalizzaStati(stati) : await statiErogati()];
  const applica = await applicaDa(sconto);
  const fc = filtroCliente('r', { organization_id, client_id }, params);
  const rows = await many(sqlProduzione(`r.date BETWEEN $1::date AND $2::date AND ${fc}`, '$3', applica), params);
  const t = await one(sqlTestate(`r.date BETWEEN $1::date AND $2::date AND ${fc}`, '$3'), params);
  return { mese, ...sintesiProduzione(rows, t, applica) };
}

/** Produzione erogata per Legal entity e mese nel periodo [da, a] (Finance, Business Hub): Map 'org|AAAA-MM' → sintesi come produzioneMensile. */
export async function produzionePerOrg(orgIds, da, a, { stati = null, sconto = null } = {}) {
  const out = new Map();
  if (!orgIds?.length) return out;
  const st = stati ? normalizzaStati(stati) : await statiErogati();
  const applica = await applicaDa(sconto);
  const rows = await many(`WITH m AS (SELECT instance_id, client_id, organization_id FROM synclab.clients_td WHERE organization_id = ANY($1::int[]))
    SELECT m.organization_id AS org_id, x.* FROM m CROSS JOIN LATERAL (${sqlProduzione(`r.date BETWEEN $2::date AND $3::date AND r.instance_id = m.instance_id AND r.client_id = m.client_id`, '$4', applica)}) x`, [orgIds, da, a, st]);
  const t = await many(`WITH m AS (SELECT instance_id, client_id, organization_id FROM synclab.clients_td WHERE organization_id = ANY($1::int[]))
    SELECT m.organization_id AS org_id, x.* FROM m CROSS JOIN LATERAL (${sqlTestate(`r.date BETWEEN $2::date AND $3::date AND r.instance_id = m.instance_id AND r.client_id = m.client_id`, '$4', "to_char(r.date, 'YYYY-MM') AS mese, ")} GROUP BY 1) x`, [orgIds, da, a, st]);
  // più client Synclab della stessa Legal entity: testate sommate per mese
  const testate = new Map();
  for (const x of t) {
    const k = `${x.org_id}|${x.mese}`; const p = testate.get(k);
    testate.set(k, p ? { accettazioni: p.accettazioni + x.accettazioni, con_sconto: p.con_sconto + x.con_sconto, percentuali: [p.percentuali, x.percentuali].filter(Boolean).join(', ') || null,
      sconto_importo: p.sconto_importo == null && x.sconto_importo == null ? null : Number(p.sconto_importo || 0) + Number(x.sconto_importo || 0) } : x);
  }
  const gruppi = new Map();
  for (const r of rows) { const k = `${r.org_id}|${r.mese}`; if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(r); }
  // le righe di più client con lo stesso codice e prezzo si sommano
  for (const [k, rr] of gruppi) {
    const fuse = new Map();
    for (const r of rr) {
      const kk = `${r.codice}|${r.prezzo_netto}`; const p = fuse.get(kk);
      fuse.set(kk, p ? { ...p, righe: p.righe + r.righe, quantita: Number(p.quantita || 0) + Number(r.quantita || 0), senza_prezzo: p.senza_prezzo + r.senza_prezzo,
        valore: p.valore == null && r.valore == null ? null : Number(p.valore || 0) + Number(r.valore || 0) } : r);
    }
    out.set(k, sintesiProduzione([...fuse.values()], testate.get(k), applica));
  }
  return out;
}

const AGG_FATTURATO = `count(*)::int AS documenti,
    count(*) FILTER (WHERE v.net_revenue_contribution IS NOT NULL)::int AS con_contributo,
    sum(v.net_revenue_contribution) AS fatturato,
    count(*) FILTER (WHERE v.document_type = 'credit_note')::int AS note_credito,
    count(*) FILTER (WHERE coalesce(v.cancelled, FALSE) OR coalesce(v.proforma, FALSE))::int AS annullati_proforma,
    count(*) FILTER (WHERE v.document_type = 'unknown' OR v.document_type IS NULL)::int AS tipo_sconosciuto,
    count(*) FILTER (WHERE v.net_revenue_contribution IS NULL AND coalesce(v.document_type, 'unknown') <> 'unknown')::int AS senza_contributo`;
const sqlFatturato = (where) => `SELECT ${AGG_FATTURATO} FROM synclab.invoices v WHERE v.disponibilita = 'ATTIVO' AND v.deleted_at IS NULL AND ${where}`;
function sintesiFatturato(x) {
  const note = [];
  if (x.tipo_sconosciuto) note.push(`${x.tipo_sconosciuto} documenti con tipo sconosciuto (contributo non disponibile, esclusi)`);
  if (x.senza_contributo) note.push(`${x.senza_contributo} documenti senza contributo al fatturato (esclusi)`);
  return { documenti: x.documenti, fatturato: x.con_contributo ? x.fatturato : null, note_credito: x.note_credito, annullati_proforma: x.annullati_proforma, tipo_sconosciuto: x.tipo_sconosciuto, senza_contributo: x.senza_contributo, note: note.join('. ') || null };
}

/** Fatturato del mese di un cliente dai documenti economici: contributo netto, una volta per documento. */
export async function fatturatoMensile({ organization_id = null, client_id = null, mese }) {
  const { da, a } = limiti(mese);
  const params = [da, a];
  const fc = filtroCliente('v', { organization_id, client_id }, params);
  return { mese, ...sintesiFatturato(await one(sqlFatturato(`v.date BETWEEN $1::date AND $2::date AND ${fc}`), params)) };
}
/** Fatturato per Legal entity e mese nel periodo: Map 'org|AAAA-MM' → sintesi come fatturatoMensile. */
export async function fatturatoPerOrg(orgIds, da, a) {
  const out = new Map();
  if (!orgIds?.length) return out;
  const rows = await many(`SELECT m.organization_id AS org_id, to_char(v.date, 'YYYY-MM') AS mese, ${AGG_FATTURATO}
      FROM synclab.clients_td m JOIN synclab.invoices v ON v.instance_id = m.instance_id AND v.client_id = m.client_id
     WHERE m.organization_id = ANY($1::int[]) AND v.disponibilita = 'ATTIVO' AND v.deleted_at IS NULL AND v.date BETWEEN $2::date AND $3::date GROUP BY 1, 2`, [orgIds, da, a]);
  for (const r of rows) out.set(`${r.org_id}|${r.mese}`, sintesiFatturato(r));
  return out;
}

/**
 * Indicatori del laboratorio per il Cockpit (gruppo Operations): accettazioni erogate di ieri, produzione erogata del mese (tutti i client)
 * e, come dato secondario, i documenti emessi nel mese. null se non ci sono dati importati.
 */
export async function indicatoriLaboratorio({ ieri, inizioMese, oggi }) {
  const d = await disponibilita();
  if (!d) return null;
  const { stati, sconto } = await regolaProduzione();
  const acc = d.requests ? await one(`SELECT count(*)::int AS n FROM synclab.requests WHERE disponibilita='ATTIVO' AND deleted_at IS NULL AND date = $1::date AND state = ANY($2::int[])`, [ieri, stati]) : null;
  const prod = d.requests ? (await produzioneErogata({ da: inizioMese, a: oggi, stati, sconto })).totale : null;
  const fat = d.invoices ? sintesiFatturato(await one(sqlFatturato('v.date BETWEEN $1::date AND $2::date'), [inizioMese, oggi])) : null;
  return { accettazioni_ieri: acc ? acc.n : null, produzione_mese: prod, fatturato_mese: fat, stati, sconto, disponibilita: d };
}

/** Catalogo esami di Synclab (tutti, anche inattivi: il catalogo li comprende). */
export const catalogoEsami = () => many(`SELECT id, exam_code, description, category, branch_code, specialty_code, regional_code, active, disponibilita FROM synclab.exams
  WHERE disponibilita = 'ATTIVO' ORDER BY exam_code`);

/** Listino CORRENTE del client (priceListId ed extraPriceListId): non ricostruisce i prezzi storici delle accettazioni. */
export async function listinoCliente(clientId) {
  const c = await one(`SELECT instance_id, id, client_code, legal_name, price_list_id, extra_price_list_id FROM synclab.clients WHERE id = $1 ORDER BY updated_at DESC LIMIT 1`, [String(clientId)]);
  if (!c) return null;
  const listini = await many(`SELECT l.id, l.code, l.description, l.type, l.state, l.active, l.disponibilita, CASE WHEN l.id = $2::text THEN 'BASE' ELSE 'EXTRA' END AS ruolo,
      coalesce((SELECT json_agg(json_build_object('id', i.id, 'exam_code', i.exam_code, 'description', i.description, 'lordo', i.gross_unit_price_excluding_vat, 'sconto', i.discount_percent,
        'netto', i.net_unit_price_excluding_vat, 'iva', i.vat_rate, 'trattamento_iva', i.vat_treatment) ORDER BY i.ord) FROM synclab.price_list_items i WHERE i.instance_id = l.instance_id AND i.price_list_id = l.id), '[]') AS righe
    FROM synclab.price_lists l WHERE l.instance_id = $1 AND l.id = ANY($3::text[]) ORDER BY (l.id = $2::text) DESC`, [c.instance_id, c.price_list_id, [c.price_list_id, c.extra_price_list_id].filter(Boolean)]);
  const trovati = new Set(listini.map((l) => l.id));
  return { client: { id: c.id, client_code: c.client_code, legal_name: c.legal_name }, listini, orfani: [c.price_list_id, c.extra_price_list_id].filter((x) => x && !trovati.has(x)), nota: 'Listino corrente del gestionale: non ricostruisce i prezzi storici, che stanno nelle righe delle accettazioni' };
}

// ================================================================== Profilo dei pazienti del laboratorio (Retail, v0.67.1)
// Decisione del CEO del 09/11/2026: profilazione con provenienza, età e sesso dalla PROIEZIONE STANDARD (demographics) delle
// accettazioni; la proiezione paziente (includePatient) resta spenta e queste letture non leggono mai le colonne patient_*.
// Unità di misura: le ACCETTAZIONI, non le persone (senza identità i pazienti distinti non sono calcolabili).
// Sorgente: synclab.requests ATTIVE, non cancellate, con almeno una riga d'esame non cancellata; sede = synclab.clients_td.site_id
// (client Synclab abbinato a una sede della Suite). Età = demographics.ageYears (anni compiuti alla data dell'accettazione); sesso =
// codice così come arriva (F, M; gli altri codici come "altro codice"); provenienza = residenza corrente disponibile; ore da
// created_at_local (ora locale di Roma già senza offset: nessuna conversione).
export const FASCE_ETA = [
  { key: '0-17', da: 0, a: 17 }, { key: '18-29', da: 18, a: 29 }, { key: '30-44', da: 30, a: 44 },
  { key: '45-59', da: 45, a: 59 }, { key: '60-74', da: 60, a: 74 }, { key: '75+', da: 75, a: null },
];
export const FASCIA_ND = 'ND';
export const SESSI = ['F', 'M', 'ALTRO', 'ND'];
const SQL_FASCIA = `CASE WHEN r.dem_age_years IS NULL OR r.dem_age_years < 0 THEN 'ND' ${FASCE_ETA.map((f) => (f.a == null ? `ELSE '${f.key}'` : `WHEN r.dem_age_years <= ${f.a} THEN '${f.key}'`)).join(' ')} END`;
const SQL_SESSO = `CASE WHEN nullif(trim(coalesce(r.dem_sex, '')), '') IS NULL THEN 'ND' WHEN upper(trim(r.dem_sex)) IN ('F','M') THEN upper(trim(r.dem_sex)) ELSE 'ALTRO' END`;
// classificazione della provenienza rispetto alla sede: COMUNE (stesso comune), PROVINCIA (altro comune, stessa provincia), FUORI
// (comune diverso E provincia diversa = "fuori area"), NV (non valutabile: sede senza abbinamento o dati mancanti)
const SQL_AREA = `CASE WHEN x.site_id IS NULL OR x.sede_comune IS NULL OR x.comune IS NULL THEN 'NV'
  WHEN lower(x.comune) = lower(x.sede_comune) THEN 'COMUNE'
  WHEN x.provincia IS NULL OR x.sede_provincia IS NULL THEN 'NV'
  WHEN x.provincia = x.sede_provincia THEN 'PROVINCIA' ELSE 'FUORI' END`;

const iso = (d) => d.toISOString().slice(0, 10);
const giornoRe = /^\d{4}-\d{2}-\d{2}$/;
/** Stessa data un anno prima (29 febbraio → 28 febbraio). */
export function annoPrima(d) {
  const [y, m, g] = String(d).split('-').map(Number);
  const fine = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(g, fine)).padStart(2, '0')}`;
}
/**
 * Periodo del profilo: '12m' (predefinito: dal primo giorno del mese di 11 mesi fa a oggi), 'AAAA-MM' (mese), 'AAAA-Qn' (trimestre),
 * 'AAAA' (anno), oppure da/a espliciti. Ritorna { tipo, da, a, etichetta, prec: { da, a } } con il confronto allo stesso periodo
 * dell'anno prima.
 */
export function periodoProfilo({ periodo = '12m', da = null, a = null, oggi = iso(new Date()) } = {}) {
  let tipo, d1, d2, etichetta;
  const p = String(periodo || '12m').trim();
  if (da && a && giornoRe.test(da) && giornoRe.test(a)) { tipo = 'intervallo'; d1 = da; d2 = a; etichetta = `dal ${da} al ${a}`; }
  else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) { tipo = 'mese'; ({ da: d1, a: d2 } = limiti(p)); etichetta = p; }
  else if (/^\d{4}-Q[1-4]$/i.test(p)) {
    tipo = 'trimestre'; const y = Number(p.slice(0, 4)); const t = Number(p.slice(-1));
    d1 = `${y}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`; d2 = iso(new Date(Date.UTC(y, t * 3, 0))); etichetta = `${t}° trimestre ${y}`;
  } else if (/^\d{4}$/.test(p)) { tipo = 'anno'; d1 = `${p}-01-01`; d2 = `${p}-12-31`; etichetta = `anno ${p}`; }
  else {
    tipo = '12m'; const [y, m] = oggi.split('-').map(Number);
    d1 = iso(new Date(Date.UTC(y, m - 12, 1))); d2 = oggi; etichetta = 'ultimi 12 mesi';
  }
  if (d1 > d2) throw Object.assign(new Error('Periodo non valido: la data iniziale è dopo quella finale'), { status: 400 });
  return { tipo, da: d1, a: d2, etichetta, prec: { da: annoPrima(d1), a: annoPrima(d2) } };
}

/** Filtri del profilo normalizzati: sede (id o 'ND'), tipo paziente (valore così come arriva o '__ND__'), mdl (si|no), sesso, fascia. */
export function filtriProfilo(q = {}) {
  const f = {};
  if (q.site_id != null && q.site_id !== '') f.site_id = String(q.site_id) === 'ND' ? 'ND' : Number(q.site_id);
  if (f.site_id !== undefined && f.site_id !== 'ND' && !Number.isInteger(f.site_id)) throw Object.assign(new Error('Sede non valida'), { status: 400 });
  if (q.patient_type != null && q.patient_type !== '') f.patient_type = String(q.patient_type);
  if (['si', 'no'].includes(String(q.mdl || ''))) f.mdl = String(q.mdl);
  if (q.sex && SESSI.includes(String(q.sex).toUpperCase())) f.sex = String(q.sex).toUpperCase();
  if (q.fascia && (q.fascia === FASCIA_ND || FASCE_ETA.some((x) => x.key === q.fascia))) f.fascia = String(q.fascia);
  // perimetro (v0.68.0, riordino di Retail): B2B o Laboratorio in sede secondo la ripartizione dei client Synclab; con l'impostazione
  // synclab_privati_in_b2c a false il Laboratorio in sede è vuoto e il B2B è tutto Synclab
  if (q.perimetro && Object.keys(RIPARTIZIONI).includes(String(q.perimetro))) {
    f.perimetro = String(q.perimetro);
    f.privati = !(q.privati_in_b2c === false || q.privati_in_b2c === 'false');
  }
  return f;
}

/** CTE "x" delle accettazioni del profilo nel periodo [da, a] con i filtri; params condivisi (i primi due sono da e a). */
function cteProfilo(da, a, f = {}) {
  const params = [da, a];
  const w = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.site_id === 'ND') w.push('x.site_id IS NULL'); else if (f.site_id != null) w.push(`x.site_id = ${p(f.site_id)}`);
  if (f.patient_type === '__ND__') w.push('x.patient_type IS NULL'); else if (f.patient_type != null) w.push(`x.patient_type = ${p(f.patient_type)}`);
  if (f.mdl === 'si') w.push('x.occupational_medicine IS TRUE'); else if (f.mdl === 'no') w.push('x.occupational_medicine IS FALSE');
  if (f.sex) w.push(`x.sx = ${p(f.sex)}`);
  if (f.fascia) w.push(`x.fascia = ${p(f.fascia)}`);
  if (f.perimetro) w.push(`x.ripartizione = ${p(f.perimetro)}`);
  const m = f.perimetro ? `${ctePc(params, f.privati)}, m AS (SELECT instance_id, client_id, site_id, ripartizione FROM pc)`
    : `m AS MATERIALIZED (SELECT instance_id, client_id, site_id, NULL::text AS ripartizione FROM synclab.clients_td)`;
  const sql = `${m},
  x0 AS (
    SELECT r.instance_id, r.id, r.date, r.created_at_local, r.patient_type, r.occupational_medicine,
           CASE WHEN r.dem_age_years >= 0 THEN r.dem_age_years END AS eta, ${SQL_SESSO} AS sx, ${SQL_FASCIA} AS fascia,
           nullif(trim(r.dem_city), '') AS comune, nullif(upper(trim(r.dem_province)), '') AS provincia, nullif(trim(r.dem_postal_code), '') AS cap,
           m.site_id, s.name AS sede, nullif(trim(s.city), '') AS sede_comune, nullif(upper(trim(s.province)), '') AS sede_provincia,
           coalesce(m.ripartizione, 'B2B') AS ripartizione
      FROM synclab.requests r
      LEFT JOIN m ON m.instance_id = r.instance_id AND m.client_id = r.client_id
      LEFT JOIN public.sites s ON s.id = m.site_id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $1::date AND $2::date
       AND EXISTS (SELECT 1 FROM synclab.request_items i WHERE i.instance_id = r.instance_id AND i.request_id = r.id AND coalesce(i.deleted, FALSE) = FALSE)
  ),
  x AS MATERIALIZED (SELECT x.*, ${SQL_AREA} AS area FROM x0 x${w.length ? ` WHERE ${w.join(' AND ')}` : ''})`;
  return { sql, params };
}
const conCte = async (da, a, f, corpo) => { const c = cteProfilo(da, a, f); return many(`WITH ${c.sql} ${corpo}`, c.params); };

const quota = (n, d) => (d ? Math.round((Number(n) / Number(d)) * 1000) / 10 : null);
const SQL_SINTESI = `SELECT count(*)::int AS accettazioni, percentile_cont(0.5) WITHIN GROUP (ORDER BY eta) AS eta_mediana,
    count(*) FILTER (WHERE sx = 'F')::int AS donne, count(*) FILTER (WHERE sx = 'M')::int AS uomini, count(*) FILTER (WHERE sx = 'ALTRO')::int AS sesso_altro,
    count(*) FILTER (WHERE sx = 'ND')::int AS sesso_nd, count(*) FILTER (WHERE eta IS NULL)::int AS eta_nd,
    count(*) FILTER (WHERE area = 'FUORI')::int AS fuori_area, count(*) FILTER (WHERE area <> 'NV')::int AS area_valutabili,
    count(*) FILTER (WHERE site_id IS NULL)::int AS senza_sede, count(DISTINCT site_id)::int AS sedi, min(date) AS prima, max(date) AS ultima FROM x`;
function formaSintesi(s) {
  if (!s) return null;
  return { ...s, eta_mediana: s.eta_mediana == null ? null : Math.round(Number(s.eta_mediana) * 10) / 10,
    quota_donne: quota(s.donne, s.accettazioni), quota_uomini: quota(s.uomini, s.accettazioni), quota_eta_nd: quota(s.eta_nd, s.accettazioni),
    quota_fuori_area: quota(s.fuori_area, s.area_valutabili) };
}

/** Stato della copia Synclab per l'avviso della pagina: ultimo checkpoint delle accettazioni e conteggi. */
export async function statoProfilo() {
  const d = await disponibilita();
  const cp = await one(`SELECT max(checkpoint_at) AS checkpoint_at, max(ultimo_completo_at) AS ultimo_completo_at, bool_or(include_patient) AS ambito_paziente
    FROM synclab.sync_scope WHERE dataset = 'requests'`).catch(() => null);
  return { accettazioni_importate: d?.requests ?? 0, esami_catalogo: d?.exams ?? 0, checkpoint_at: cp?.checkpoint_at || null, ultimo_completo_at: cp?.ultimo_completo_at || null };
}

/**
 * Profilo dei pazienti del laboratorio. q: { periodo|da+a, site_id, patient_type, mdl, sex, fascia, oggi }.
 * Blocchi: sintesi (con l'anno prima), fasce × sesso (con l'anno prima), provenienza (province, comuni top 20 + altri, CAP della sede
 * scelta, fuori area, bacino per sede), andamento mensile (per sede, per tipo paziente, medicina del lavoro a parte), esami più
 * richiesti (top 15 per fascia e sesso e per sede), orari (giorno della settimana × ora di created_at_local).
 */
export async function profiloPazienti(q = {}) {
  const per = periodoProfilo(q);
  const f = filtriProfilo(q);
  const stato = await statoProfilo();
  const base = { periodo: per, filtri: f, stato, unita: 'accettazioni, non persone' };
  const [cur] = await conCte(per.da, per.a, f, SQL_SINTESI);
  const [prev] = await conCte(per.prec.da, per.prec.a, f, SQL_SINTESI);
  const sintesi = { ...formaSintesi(cur), anno_prima: formaSintesi(prev), pazienti_distinti: null,
    nota_pazienti: 'Accettazioni, non persone: senza i dati identificativi (proiezione paziente spenta per scelta) i pazienti distinti non sono calcolabili' };

  // ---- 2. fasce d'età × sesso, con l'anno prima
  const fx = await conCte(per.da, per.a, f, 'SELECT fascia, sx, count(*)::int AS n FROM x GROUP BY 1, 2');
  const fp = await conCte(per.prec.da, per.prec.a, f, 'SELECT fascia, sx, count(*)::int AS n FROM x GROUP BY 1, 2');
  const cella = (rows, fa, s) => rows.filter((r) => r.fascia === fa && (!s || r.sx === s)).reduce((t, r) => t + r.n, 0);
  const fasce = [...FASCE_ETA.map((x) => x.key), FASCIA_ND].map((k) => {
    const tot = cella(fx, k), totp = cella(fp, k);
    return { fascia: k, etichetta: k === FASCIA_ND ? 'Età non disponibile' : `${k} anni`, F: cella(fx, k, 'F'), M: cella(fx, k, 'M'), ALTRO: cella(fx, k, 'ALTRO'), ND: cella(fx, k, 'ND'), totale: tot,
      quota: quota(tot, cur.accettazioni), anno_prima: { F: cella(fp, k, 'F'), M: cella(fp, k, 'M'), totale: totp }, delta: totp ? tot - totp : null, delta_pct: totp ? Math.round(((tot - totp) / totp) * 1000) / 10 : null };
  });

  // ---- 3. provenienza
  const province = (await conCte(per.da, per.a, f, `SELECT coalesce(provincia, '') AS provincia, count(*)::int AS n, count(*) FILTER (WHERE area = 'FUORI')::int AS fuori FROM x GROUP BY 1 ORDER BY 2 DESC, 1`))
    .map((r) => ({ provincia: r.provincia || null, etichetta: r.provincia || 'Provincia non disponibile', n: r.n, quota: quota(r.n, cur.accettazioni), fuori_area: r.fuori }));
  const comuniTutti = await conCte(per.da, per.a, f, `SELECT coalesce(comune, '') AS comune, coalesce(provincia, '') AS provincia, count(*)::int AS n FROM x GROUP BY 1, 2 ORDER BY 3 DESC, 1`);
  const conComune = comuniTutti.filter((r) => r.comune);
  const top = conComune.slice(0, 20).map((r) => ({ comune: r.comune, provincia: r.provincia || null, n: r.n, quota: quota(r.n, cur.accettazioni) }));
  const altri = conComune.slice(20);
  const senzaComune = comuniTutti.find((r) => !r.comune)?.n || 0;
  const comuni = { top, altri: altri.length ? { comuni: altri.length, n: altri.reduce((t, r) => t + r.n, 0), quota: quota(altri.reduce((t, r) => t + r.n, 0), cur.accettazioni) } : null,
    non_disponibile: senzaComune, totale_comuni: conComune.length };
  let cap = null;
  if (f.site_id != null && f.site_id !== 'ND') {
    const rows = await conCte(per.da, per.a, f, `SELECT coalesce(cap, '') AS cap, string_agg(DISTINCT comune, ', ') AS comuni, count(*)::int AS n FROM x GROUP BY 1 ORDER BY 3 DESC, 1`);
    cap = rows.map((r) => ({ cap: r.cap || null, comuni: r.comuni || null, n: r.n, quota: quota(r.n, cur.accettazioni) }));
  }
  const fuoriArea = { fuori: cur.fuori_area, valutabili: cur.area_valutabili, non_valutabili: cur.accettazioni - cur.area_valutabili, quota: quota(cur.fuori_area, cur.area_valutabili),
    anno_prima: prev ? { fuori: prev.fuori_area, valutabili: prev.area_valutabili, quota: quota(prev.fuori_area, prev.area_valutabili) } : null,
    regola: 'Fuori area = comune di residenza diverso da quello della sede e provincia diversa; non valutabili le accettazioni senza sede abbinata o senza comune/provincia' };
  const bac = await conCte(per.da, per.a, { ...f }, `SELECT site_id, max(sede) AS sede, max(sede_comune) AS sede_comune, max(sede_provincia) AS sede_provincia, count(*)::int AS n,
      count(*) FILTER (WHERE area = 'COMUNE')::int AS comune, count(*) FILTER (WHERE area = 'PROVINCIA')::int AS provincia, count(*) FILTER (WHERE area = 'FUORI')::int AS fuori,
      count(*) FILTER (WHERE area = 'NV')::int AS nv, percentile_cont(0.5) WITHIN GROUP (ORDER BY eta) AS eta_mediana FROM x GROUP BY site_id ORDER BY 5 DESC`);
  const bacTop = await conCte(per.da, per.a, f, `SELECT site_id, comune, provincia, n FROM (SELECT site_id, comune, provincia, count(*)::int AS n,
      row_number() OVER (PARTITION BY site_id ORDER BY count(*) DESC, comune) AS rn FROM x WHERE comune IS NOT NULL GROUP BY site_id, comune, provincia) t WHERE rn <= 5 ORDER BY site_id, n DESC`);
  const bacino = bac.map((b) => ({ site_id: b.site_id, sede: b.site_id ? b.sede : 'Senza sede abbinata', sede_comune: b.sede_comune, sede_provincia: b.sede_provincia, n: b.n,
    stesso_comune: b.comune, stessa_provincia: b.provincia, fuori_area: b.fuori, non_valutabili: b.nv, quota_fuori_area: quota(b.fuori, b.n - b.nv),
    eta_mediana: b.eta_mediana == null ? null : Math.round(Number(b.eta_mediana) * 10) / 10,
    comuni: bacTop.filter((t) => (t.site_id ?? null) === (b.site_id ?? null)).map((t) => ({ comune: t.comune, provincia: t.provincia, n: t.n, quota: quota(t.n, b.n) })) }));

  // ---- 4. andamento mensile (per sede, per tipo paziente esclusa la medicina del lavoro, medicina del lavoro a parte)
  const mesi = [];
  for (let d = `${per.da.slice(0, 7)}-01`; d <= per.a; d = iso(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)))) mesi.push(d.slice(0, 7));
  const ms = await conCte(per.da, per.a, f, `SELECT to_char(date, 'YYYY-MM') AS mese, site_id, max(sede) AS sede, count(*)::int AS n FROM x GROUP BY 1, 2`);
  const mt = await conCte(per.da, per.a, f, `SELECT to_char(date, 'YYYY-MM') AS mese, coalesce(patient_type, '') AS tipo, count(*)::int AS n FROM x WHERE occupational_medicine IS NOT TRUE GROUP BY 1, 2`);
  const mm = await conCte(per.da, per.a, f, `SELECT to_char(date, 'YYYY-MM') AS mese, count(*)::int AS n FROM x WHERE occupational_medicine IS TRUE GROUP BY 1`);
  const sediSerie = [...new Map(ms.map((r) => [r.site_id ?? 'ND', { key: r.site_id == null ? 'ND' : String(r.site_id), label: r.site_id == null ? 'Senza sede abbinata' : r.sede }])).values()];
  const tipiSerie = [...new Set(mt.map((r) => r.tipo))].map((t) => ({ key: t || '__ND__', label: t || 'Tipo non indicato' }));
  const tot = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  sediSerie.sort((a, b) => tot(ms.filter((r) => String(r.site_id ?? 'ND') === b.key), 'n') - tot(ms.filter((r) => String(r.site_id ?? 'ND') === a.key), 'n'));
  tipiSerie.sort((a, b) => tot(mt.filter((r) => (r.tipo || '__ND__') === b.key), 'n') - tot(mt.filter((r) => (r.tipo || '__ND__') === a.key), 'n'));
  const andamento = {
    mesi,
    per_sede: { serie: sediSerie, righe: mesi.map((mk) => ({ mese: mk, ...Object.fromEntries(sediSerie.map((s) => [s.key, ms.find((r) => r.mese === mk && String(r.site_id ?? 'ND') === s.key)?.n || 0])) })) },
    per_tipo: { serie: tipiSerie, righe: mesi.map((mk) => ({ mese: mk, ...Object.fromEntries(tipiSerie.map((s) => [s.key, mt.find((r) => r.mese === mk && (r.tipo || '__ND__') === s.key)?.n || 0])) })),
      nota: 'Tipi paziente così come arrivano dal gestionale (patientType), senza la medicina del lavoro' },
    medicina_lavoro: mesi.map((mk) => ({ mese: mk, n: mm.find((r) => r.mese === mk)?.n || 0 })),
  };

  // ---- 5. esami più richiesti (righe d'esame non cancellate): top 15 complessivo, per fascia, per sesso, per fascia × sesso, per sede
  const c5 = cteProfilo(per.da, per.a, f);
  const es = await many(`WITH ${c5.sql}, e AS (
      SELECT x.fascia, x.sx, x.site_id, upper(coalesce(nullif(trim(i.exam_code), ''), '?')) AS codice, i.description, x.id AS req
        FROM x JOIN synclab.request_items i ON i.instance_id = x.instance_id AND i.request_id = x.id AND coalesce(i.deleted, FALSE) = FALSE),
    g AS (SELECT CASE WHEN GROUPING(fascia) = 0 AND GROUPING(sx) = 0 THEN 'FS' WHEN GROUPING(fascia) = 0 THEN 'F' WHEN GROUPING(sx) = 0 THEN 'S' WHEN GROUPING(site_id) = 0 THEN 'SEDE' ELSE 'TOT' END AS gruppo,
           fascia, sx, site_id, codice, max(description) AS descr_riga, count(*)::int AS esami, count(DISTINCT req)::int AS accettazioni
           FROM e GROUP BY GROUPING SETS ((codice), (fascia, codice), (sx, codice), (fascia, sx, codice), (site_id, codice))),
    r AS (SELECT g.*, row_number() OVER (PARTITION BY gruppo, fascia, sx, site_id ORDER BY esami DESC, codice) AS rn FROM g)
    SELECT r.gruppo, r.fascia, r.sx, r.site_id, r.codice, coalesce((SELECT ex.description FROM synclab.exams ex WHERE ex.disponibilita = 'ATTIVO' AND upper(ex.exam_code) = r.codice ORDER BY ex.updated_at DESC LIMIT 1), r.descr_riga) AS descrizione,
           r.esami, r.accettazioni, r.rn FROM r WHERE r.rn <= 15 ORDER BY r.gruppo, r.fascia, r.sx, r.site_id, r.rn`, c5.params);
  const riga = (r) => ({ codice: r.codice, descrizione: r.descrizione, esami: r.esami, accettazioni: r.accettazioni });
  const esami = { top: es.filter((r) => r.gruppo === 'TOT').map(riga), per_fascia: {}, per_sesso: {}, per_fascia_sesso: {}, per_sede: [] };
  for (const r of es) {
    if (r.gruppo === 'F') (esami.per_fascia[r.fascia] ||= []).push(riga(r));
    if (r.gruppo === 'S') (esami.per_sesso[r.sx] ||= []).push(riga(r));
    if (r.gruppo === 'FS') (esami.per_fascia_sesso[`${r.fascia}|${r.sx}`] ||= []).push(riga(r));
  }
  const sedeNome = new Map(bacino.map((b) => [b.site_id ?? 'ND', b.sede]));
  for (const r of es.filter((x) => x.gruppo === 'SEDE')) {
    const k = r.site_id ?? 'ND';
    let s = esami.per_sede.find((x) => (x.site_id ?? 'ND') === k);
    if (!s) { s = { site_id: r.site_id ?? null, sede: sedeNome.get(k) || 'Senza sede abbinata', esami: [] }; esami.per_sede.push(s); }
    s.esami.push(riga(r));
  }

  // ---- 6. orari: giorno della settimana (1 = lunedì) e ora di created_at_local, senza conversioni di fuso
  const or = await conCte(per.da, per.a, f, `SELECT extract(isodow FROM created_at_local)::int AS dow, extract(hour FROM created_at_local)::int AS ora, count(*)::int AS n FROM x WHERE created_at_local IS NOT NULL GROUP BY 1, 2`);
  const GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const orari = {
    giorni: GIORNI.map((g, i) => ({ dow: i + 1, giorno: g, n: or.filter((r) => r.dow === i + 1).reduce((t, r) => t + r.n, 0) })),
    ore: Array.from({ length: 24 }, (_, h) => ({ ora: h, etichetta: `${String(h).padStart(2, '0')}:00`, n: or.filter((r) => r.ora === h).reduce((t, r) => t + r.n, 0) })),
    matrice: or.map((r) => ({ dow: r.dow, ora: r.ora, n: r.n })),
    senza_orario: cur.accettazioni - or.reduce((t, r) => t + r.n, 0),
    nota: 'Ora di creazione dell\'accettazione (createdAtLocal, ora locale di Roma senza offset)',
  };

  // elenchi per i filtri: sedi con accettazioni abbinate e tipi paziente presenti nella copia
  const opzioni = {
    sedi: await many(`SELECT DISTINCT m.site_id AS id, s.name, s.code FROM synclab.clients_td m JOIN public.sites s ON s.id = m.site_id
        WHERE EXISTS (SELECT 1 FROM synclab.requests r WHERE r.instance_id = m.instance_id AND r.client_id = m.client_id AND r.disponibilita = 'ATTIVO') ORDER BY s.name`),
    tipi_paziente: (await many(`SELECT patient_type AS v, count(*)::int AS n FROM synclab.requests WHERE disponibilita = 'ATTIVO' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`)).map((r) => ({ v: r.v ?? '__ND__', label: r.v ?? 'Tipo non indicato', n: r.n })),
    fasce: [...FASCE_ETA.map((x) => ({ v: x.key, label: `${x.key} anni` })), { v: FASCIA_ND, label: 'Età non disponibile' }],
  };
  return { ...base, sintesi, fasce, provenienza: { province, comuni, cap, fuori_area: fuoriArea, bacino }, andamento, esami, orari, opzioni };
}

/** Sintesi per il Cockpit (età mediana e quota fuori area) di un intervallo, senza filtri; null se non ci sono accettazioni importate. */
export async function sintesiProfilo(da, a) {
  const d = await disponibilita();
  if (!d?.requests) return null;
  const [s] = await conCte(da, a, {}, SQL_SINTESI);
  return formaSintesi(s);
}

/** Comuni di provenienza (per la mappa): { comune, provincia, n } del periodo con i filtri, tutti, ordinati per numero. */
export async function comuniProfilo(q = {}) {
  const per = periodoProfilo(q);
  return conCte(per.da, per.a, filtriProfilo(q), `SELECT comune, provincia, count(*)::int AS n FROM x WHERE comune IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`);
}

// ================================================================== Retail: B2B (StudioLab/Synclab) e Laboratorio in sede (v0.68.0)
// Decisione del CEO del 09/11/2026 sera: in Retail un cruscotto complessivo e due sezioni, B2C (TuoTempo + GIPO) e B2B (tutto da
// StudioLab). Ripartizione delle accettazioni Synclab (impostazione di Retail `synclab_privati_in_b2c`, predefinita true):
//   - client Synclab abbinato a una SEDE TD (clients_td.site_id → sede non SERVICE della Legal entity di TD: Dati aziendali, o società
//     del gruppo GRUPPO/SOCIETA) = "Laboratorio in sede" (LAB_SEDE, sezione B2C); un client abbinato alla Legal entity di TD senza sede
//     è anch'esso interno (non è una Legal entity esterna) e va nel Laboratorio in sede;
//   - client abbinato a una Legal entity esterna o non abbinato = B2B;
//   - con l'impostazione a false tutto Synclab è B2B.
// Cliente = Legal entity abbinata (chiave = id) oppure, per i client non abbinati, il client Synclab (chiave 'c-' + id del client).
// Accettazioni = accettazioni ATTIVE non cancellate con almeno una riga d'esame non cancellata (stessa regola del profilo); esami = righe
// d'esame non cancellate; valore = Σ netto di riga × quantità (le righe senza prezzo sono contate a parte: valore parziale).
// Documenti: netRevenueContribution UNA volta per documento; note di credito separate (già negative); annullati e proforma esclusi e
// contati; tipo sconosciuto escluso e contato.
export const RIPARTIZIONI = { LAB_SEDE: 'Laboratorio in sede', B2B: 'B2B' };
const SQL_TD_ORG = `(SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::int WHEN (value #>> '{}') ~ '^[0-9]+$' THEN (value #>> '{}')::int END
  FROM public.app_settings WHERE key = 'company_org_id')`;

/** CTE "pc": client Synclab con chiave cliente, nome, sede e ripartizione. Aggiunge a params il valore dell'impostazione. */
function ctePc(params, privatiInB2c = true) {
  params.push(privatiInB2c !== false);
  const p = `$${params.length}::boolean`;
  return `pc AS MATERIALIZED (
    SELECT m.instance_id, m.client_id, m.client_code, m.legal_name, m.organization_id, m.site_id, m.stato_abbinamento, coalesce(m.perimetro_b2b, FALSE) AS perimetro_b2b,
           m.price_list_id, m.extra_price_list_id, m.disponibilita,
           CASE WHEN m.organization_id IS NOT NULL THEN m.organization_id::text ELSE 'c-' || m.client_id END AS chiave,
           coalesce(o.name, m.legal_name, m.client_code, m.client_id) AS cliente, s.name AS sede,
           CASE WHEN ${p} AND ((s.id IS NOT NULL AND s.kind <> 'SERVICE' AND (so.kind IN ('GRUPPO','SOCIETA') OR so.id = td.id))
                               OR (s.id IS NULL AND o.id IS NOT NULL AND (o.kind IN ('GRUPPO','SOCIETA') OR o.id = td.id)))
                THEN 'LAB_SEDE' ELSE 'B2B' END AS ripartizione
      FROM synclab.clients_td m
      CROSS JOIN (SELECT ${SQL_TD_ORG} AS id) td
      LEFT JOIN public.organizations o ON o.id = m.organization_id
      LEFT JOIN public.sites s ON s.id = m.site_id
      LEFT JOIN public.organizations so ON so.id = s.organization_id)`;
}

/**
 * Accettazioni (acc) e righe d'esame (it) del periodo con cliente e ripartizione; filtri facoltativi su ripartizione, chiave, sede.
 * v0.68.5: produzione erogata. stati = stati erogati (obbligatorio: conLab lo legge se manca); soloErogate (predefinito) tiene solo le
 * accettazioni erogate, altrimenti tutte con la colonna `erogata` (per contare anche le registrate). it.valore_riga = netto di riga ×
 * quantità, × (1 − sconto di testata) solo con applica (v0.68.6: regola `sconto_testata`; null senza prezzo o quantità); it.netto_riga = netto di riga × quantità (senza lo sconto di
 * testata: è il prezzo confrontabile con i listini); it.sconto_riga = la parte di sconto di testata.
 */
function cteLab({ da, a, privatiInB2c = true, ripartizione = null, chiave = null, siteId = null, stati, soloErogate = true, applica = false }) {
  const params = [da, a];
  const pc = ctePc(params, privatiInB2c);
  const w = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const pSt = p(normalizzaStati(stati));
  if (soloErogate) w.push('acc.erogata');
  if (ripartizione) w.push(`acc.ripartizione = ${p(ripartizione)}`);
  if (chiave != null) w.push(`acc.chiave = ${p(String(chiave))}`);
  if (siteId === 'ND') w.push('acc.site_id IS NULL'); else if (siteId != null) w.push(`acc.site_id = ${p(Number(siteId))}`);
  const sql = `${pc},
  acc0 AS (
    SELECT r.instance_id, r.id, r.date, to_char(r.date, 'YYYY-MM') AS mese, r.client_id, r.header_discount_percent, r.state,
           coalesce(r.state = ANY(${pSt}::int[]), FALSE) AS erogata,
           coalesce(pc.chiave, 'c-' || r.client_id) AS chiave, coalesce(pc.cliente, r.client_code, r.client_id) AS cliente, pc.organization_id,
           coalesce(pc.ripartizione, 'B2B') AS ripartizione, coalesce(pc.perimetro_b2b, FALSE) AS perimetro_b2b, pc.site_id, pc.sede,
           coalesce(pc.stato_abbinamento, 'DA_ABBINARE') AS stato_abbinamento
      FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $1::date AND $2::date
       AND EXISTS (SELECT 1 FROM synclab.request_items i WHERE i.instance_id = r.instance_id AND i.request_id = r.id AND coalesce(i.deleted, FALSE) = FALSE)),
  acc AS MATERIALIZED (SELECT * FROM acc0 acc${w.length ? ` WHERE ${w.join(' AND ')}` : ''}),
  it AS (
    SELECT acc.instance_id, acc.id AS request_id, acc.date, acc.mese, acc.chiave, acc.cliente, acc.organization_id, acc.ripartizione, acc.site_id, acc.sede, acc.erogata,
           upper(coalesce(nullif(trim(i.exam_code), ''), '?')) AS codice, i.description AS descr_riga, i.quantity AS quantita,
           i.net_unit_price_excluding_vat AS netto, i.net_unit_price_excluding_vat * i.quantity AS netto_riga,
           ${SQL_VALORE_RIGA('i', 'acc', applica)} AS valore_riga, ${SQL_SCONTO_RIGA('i', 'acc')} AS sconto_riga
      FROM acc JOIN synclab.request_items i ON i.instance_id = acc.instance_id AND i.request_id = acc.id AND coalesce(i.deleted, FALSE) = FALSE)`;
  return { sql, params };
}
const conLab = async (opz, corpo) => { const c = cteLab({ ...opz, stati: opz.stati || await statiErogati(), applica: await applicaDa(opz.sconto) }); return many(`WITH ${c.sql} ${corpo}`, c.params); };

/** Documenti economici del periodo con cliente, ripartizione e classe (FATTURA, NC, ANNULLATO, SCONOSCIUTO). */
function cteDoc({ da, a, privatiInB2c = true, ripartizione = null, chiave = null }) {
  const params = [da, a];
  const pc = ctePc(params, privatiInB2c);
  const w = [];
  if (ripartizione) { params.push(ripartizione); w.push(`doc.ripartizione = $${params.length}`); }
  if (chiave != null) { params.push(String(chiave)); w.push(`doc.chiave = $${params.length}`); }
  const sql = `${pc},
  doc0 AS (
    SELECT v.instance_id, v.id, v.invoice_number, v.date, to_char(v.date, 'YYYY-MM') AS mese, v.document_type, v.net_revenue_contribution AS contributo, v.total,
           coalesce(pc.chiave, 'c-' || v.client_id) AS chiave, coalesce(pc.cliente, v.client_id) AS cliente, pc.organization_id, coalesce(pc.ripartizione, 'B2B') AS ripartizione,
           CASE WHEN coalesce(v.cancelled, FALSE) OR coalesce(v.proforma, FALSE) THEN 'ANNULLATO'
                WHEN v.document_type IS NULL OR v.document_type = 'unknown' THEN 'SCONOSCIUTO'
                WHEN v.document_type = 'credit_note' THEN 'NC' ELSE 'FATTURA' END AS classe
      FROM synclab.invoices v LEFT JOIN pc ON pc.instance_id = v.instance_id AND pc.client_id = v.client_id
     WHERE v.disponibilita = 'ATTIVO' AND v.deleted_at IS NULL AND v.date BETWEEN $1::date AND $2::date),
  doc AS MATERIALIZED (SELECT * FROM doc0 doc${w.length ? ` WHERE ${w.join(' AND ')}` : ''})`;
  return { sql, params };
}
const conDoc = async (opz, corpo) => { const c = cteDoc(opz); return many(`WITH ${c.sql} ${corpo}`, c.params); };

// v0.68.5: accettazioni = erogate (con soloErogate falso anche `registrate` = tutte); esami, valore e righe senza prezzo solo delle erogate
const AGG_ACC = `count(*) FILTER (WHERE erogata)::int AS accettazioni, count(*)::int AS registrate`;
const AGG_IT = `count(*) FILTER (WHERE erogata)::int AS esami, sum(valore_riga) FILTER (WHERE erogata) AS valore, count(*) FILTER (WHERE erogata AND valore_riga IS NULL)::int AS righe_senza_prezzo,
  sum(sconto_riga) FILTER (WHERE erogata) AS sconto_testata`;
const AGG_DOC = `count(*)::int AS documenti, count(*) FILTER (WHERE classe = 'FATTURA')::int AS fatture, count(*) FILTER (WHERE classe = 'NC')::int AS note_credito,
  count(*) FILTER (WHERE classe = 'ANNULLATO')::int AS annullati, count(*) FILTER (WHERE classe = 'SCONOSCIUTO')::int AS tipo_sconosciuto,
  count(*) FILTER (WHERE classe IN ('FATTURA','NC') AND contributo IS NULL)::int AS senza_contributo,
  sum(contributo) FILTER (WHERE classe = 'FATTURA') AS fatturato_fatture, sum(contributo) FILTER (WHERE classe = 'NC') AS importo_nc,
  sum(contributo) FILTER (WHERE classe IN ('FATTURA','NC')) AS fatturato`;
const n2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const varPct = (cur, prev) => (prev == null || Number(prev) === 0 || cur == null ? null : Math.round(((Number(cur) - Number(prev)) / Number(prev)) * 1000) / 10);
const formaDoc = (x) => (x ? { documenti: x.documenti, fatture: x.fatture, note_credito: x.note_credito, annullati: x.annullati, tipo_sconosciuto: x.tipo_sconosciuto, senza_contributo: x.senza_contributo,
  fatturato_fatture: n2(x.fatturato_fatture), importo_nc: n2(x.importo_nc), fatturato: n2(x.fatturato) } : null);
const docVuoto = { documenti: 0, fatture: 0, note_credito: 0, annullati: 0, tipo_sconosciuto: 0, senza_contributo: 0, fatturato_fatture: null, importo_nc: null, fatturato: null };
const prodVuota = { accettazioni: 0, esami: 0, valore: null, righe_senza_prezzo: 0 };
const prodVuotaR = { ...prodVuota, registrate: 0, sconto_testata: null };
const formaProd = (a, i) => ({ accettazioni: a?.accettazioni || 0, esami: i?.esami || 0, valore: n2(i?.valore), righe_senza_prezzo: i?.righe_senza_prezzo || 0 });
const formaProdR = (a, i) => ({ ...formaProd(a, i), registrate: a?.registrate || 0, sconto_testata: n2(i?.sconto_testata) });
const mesiTra = (da, a) => { const out = []; for (let d = `${da.slice(0, 7)}-01`; d <= a; d = iso(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)))) out.push(d.slice(0, 7)); return out; };
const giorniPrima = (d, n) => iso(new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400000));

/** Stato della copia per insieme di dati: ultimo checkpoint, ultimo completo, ultimo esito (per dichiarare la fonte nelle pagine). */
export async function statoCopia() {
  const rows = await many(`SELECT dataset, max(checkpoint_at) AS checkpoint_at, max(ultimo_completo_at) AS ultimo_completo_at FROM synclab.sync_scope GROUP BY dataset`).catch(() => []);
  const d = await disponibilita();
  const per = Object.fromEntries(rows.map((r) => [r.dataset, { checkpoint_at: r.checkpoint_at, ultimo_completo_at: r.ultimo_completo_at }]));
  const tutti = rows.map((r) => r.checkpoint_at).filter(Boolean).sort();
  return { insiemi: per, ultimo_checkpoint: tutti.length ? tutti[tutti.length - 1] : null, conteggi: d || null };
}

/** Elenco dei client Synclab con chiave cliente e ripartizione (Laboratorio in sede / B2B). */
export async function ripartizioneClienti({ privatiInB2c = true } = {}) {
  const params = [];
  return many(`WITH ${ctePc(params, privatiInB2c)} SELECT instance_id, client_id, client_code, legal_name, organization_id, site_id, sede, stato_abbinamento, perimetro_b2b, chiave, cliente, ripartizione, disponibilita
    FROM pc ORDER BY ripartizione, lower(cliente), client_code`, params);
}

/**
 * Quadro del laboratorio per il cruscotto di rete: per ripartizione accettazioni, esami, valore, clienti con produzione e documenti
 * economici, nel periodo e nello stesso periodo dell'anno prima. { periodo, LAB_SEDE: {...}, B2B: {...}, totale }.
 */
export async function quadroLaboratorio({ da, a, privatiInB2c = true, stati = null, sconto = null }) {
  stati = stati ? normalizzaStati(stati) : await statiErogati();
  sconto = sconto == null ? await scontoTestata() : normalizzaSconto(sconto);
  const prec = { da: annoPrima(da), a: annoPrima(a) };
  const leggiP = async (d1, d2) => {
    const o = { da: d1, a: d2, privatiInB2c, stati, sconto, soloErogate: false };
    const acc = await conLab(o, `SELECT ripartizione, ${AGG_ACC}, count(DISTINCT chiave) FILTER (WHERE erogata)::int AS clienti FROM acc GROUP BY 1`);
    const it = await conLab(o, `SELECT ripartizione, ${AGG_IT} FROM it GROUP BY 1`);
    const doc = await conDoc({ da: d1, a: d2, privatiInB2c }, `SELECT ripartizione, ${AGG_DOC} FROM doc GROUP BY 1`);
    const out = {};
    for (const k of Object.keys(RIPARTIZIONI)) {
      const x = acc.find((r) => r.ripartizione === k);
      out[k] = { ...formaProdR(x, it.find((r) => r.ripartizione === k)), clienti: x?.clienti || 0, documenti: formaDoc(doc.find((r) => r.ripartizione === k)) || { ...docVuoto } };
    }
    return out;
  };
  const cur = await leggiP(da, a), prev = await leggiP(prec.da, prec.a);
  const out = { periodo: { da, a, prec }, privati_in_b2c: privatiInB2c !== false, stati, sconto };
  for (const k of Object.keys(RIPARTIZIONI)) out[k] = { ...cur[k], anno_prima: prev[k], var_accettazioni: varPct(cur[k].accettazioni, prev[k].accettazioni), var_valore: varPct(cur[k].valore, prev[k].valore) };
  return out;
}

/**
 * Produzione per cliente e mese: { mesi, clienti: [{ chiave, cliente, organization_id, perimetro_b2b, stato_abbinamento, totale, mesi: { 'AAAA-MM': {...} } }], totale }.
 * ripartizione: 'B2B' (predefinita), 'LAB_SEDE' o null (tutte).
 */
export async function produzioneClientiMesi({ da, a, privatiInB2c = true, ripartizione = 'B2B', chiave = null, stati = null, sconto = null }) {
  const o = { da, a, privatiInB2c, ripartizione, chiave, stati, sconto };
  const acc = await conLab(o, `SELECT chiave, max(cliente) AS cliente, max(organization_id) AS organization_id, bool_or(perimetro_b2b) AS perimetro_b2b, max(stato_abbinamento) AS stato_abbinamento,
      max(ripartizione) AS ripartizione, mese, ${AGG_ACC} FROM acc GROUP BY chiave, mese`);
  const it = await conLab(o, `SELECT chiave, mese, ${AGG_IT} FROM it GROUP BY chiave, mese`);
  const mesi = mesiTra(da, a);
  const m = new Map();
  for (const r of acc) {
    if (!m.has(r.chiave)) m.set(r.chiave, { chiave: r.chiave, cliente: r.cliente, organization_id: r.organization_id, perimetro_b2b: r.perimetro_b2b, stato_abbinamento: r.stato_abbinamento, ripartizione: r.ripartizione, mesi: {} });
    m.get(r.chiave).mesi[r.mese] = formaProdR(r, it.find((x) => x.chiave === r.chiave && x.mese === r.mese));
  }
  // v0.68.6: anche "di cui sconti di testata" (sconto_testata) e le registrate
  const somma = sommaProd;
  const clienti = [...m.values()].map((c) => ({ ...c, totale: somma(Object.values(c.mesi)) }))
    .sort((x, y) => (Number(y.totale.valore || 0) - Number(x.totale.valore || 0)) || (y.totale.esami - x.totale.esami) || String(x.cliente).localeCompare(String(y.cliente), 'it'));
  const perMese = Object.fromEntries(mesi.map((mk) => [mk, somma(clienti.map((c) => c.mesi[mk]).filter(Boolean))]));
  return { mesi, clienti, per_mese: perMese, totale: somma(clienti.map((c) => c.totale)) };
}

/** Fatturato da documenti per cliente e mese (stesse chiavi di produzioneClientiMesi). */
export async function fatturatoClientiMesi({ da, a, privatiInB2c = true, ripartizione = 'B2B', chiave = null }) {
  const rows = await conDoc({ da, a, privatiInB2c, ripartizione, chiave }, `SELECT chiave, max(cliente) AS cliente, max(organization_id) AS organization_id, mese, ${AGG_DOC} FROM doc GROUP BY chiave, mese`);
  const tot = await conDoc({ da, a, privatiInB2c, ripartizione, chiave }, `SELECT ${AGG_DOC} FROM doc`);
  const mesi = mesiTra(da, a);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.chiave)) m.set(r.chiave, { chiave: r.chiave, cliente: r.cliente, organization_id: r.organization_id, mesi: {} });
    m.get(r.chiave).mesi[r.mese] = formaDoc(r);
  }
  const somma = (lista) => { const t = { ...docVuoto }; for (const x of lista) for (const k of Object.keys(t)) { if (x[k] == null) continue; t[k] = k.startsWith('fatturato') || k === 'importo_nc' ? n2((t[k] || 0) + Number(x[k])) : t[k] + x[k]; } return t; };
  const clienti = [...m.values()].map((c) => ({ ...c, totale: somma(Object.values(c.mesi)) }))
    .sort((x, y) => (Number(y.totale.fatturato || 0) - Number(x.totale.fatturato || 0)) || String(x.cliente).localeCompare(String(y.cliente), 'it'));
  const perMese = Object.fromEntries(mesi.map((mk) => [mk, somma(clienti.map((c) => c.mesi[mk]).filter(Boolean))]));
  return { mesi, clienti, per_mese: perMese, totale: formaDoc(tot[0]) || { ...docVuoto },
    regola: 'contributo netto, una volta per documento; note di credito separate (già negative); annullati e proforma esclusi e contati; tipo sconosciuto escluso e contato' };
}

/**
 * Cruscotto B2B del mese: clienti con produzione, esami, valore, fatturato da documenti (con l'anno prima), top 10, clienti in calo
 * oltre il 20% sullo stesso mese dell'anno prima, clienti senza produzione da 60 giorni (attivi negli ultimi 12 mesi), client Synclab
 * non abbinati. mese = 'AAAA-MM' (predefinito: il mese di oggi).
 */
export async function cruscottoB2B({ mese = null, privatiInB2c = true, oggi = iso(new Date()), sogliaCalo = 20, giorniSenza = 60 } = {}) {
  const mk = mese && meseRe.test(mese) ? mese : oggi.slice(0, 7);
  const { da, a: fineMese } = limiti(mk);
  const a = fineMese > oggi && da <= oggi ? oggi : fineMese;   // mese in corso: fino a oggi, l'anno prima allo stesso giorno
  const prec = { da: annoPrima(da), a: annoPrima(a) };
  const base = { privatiInB2c, ripartizione: 'B2B' };
  const cur = await produzioneClientiMesi({ ...base, da, a });
  const prev = await produzioneClientiMesi({ ...base, da: prec.da, a: prec.a });
  const fat = await fatturatoClientiMesi({ ...base, da, a });
  const fatPrev = await fatturatoClientiMesi({ ...base, da: prec.da, a: prec.a });
  const prevDi = new Map(prev.clienti.map((c) => [c.chiave, c.totale]));
  const fatDi = new Map(fat.clienti.map((c) => [c.chiave, c.totale]));
  const righe = cur.clienti.map((c) => ({ chiave: c.chiave, cliente: c.cliente, organization_id: c.organization_id, perimetro_b2b: c.perimetro_b2b, stato_abbinamento: c.stato_abbinamento,
    ...c.totale, fatturato: fatDi.get(c.chiave)?.fatturato ?? null, anno_prima: prevDi.get(c.chiave) || null }));
  const top10 = righe.slice(0, 10);
  // in calo: confronto sul valore quando c'è in entrambi i periodi, altrimenti sugli esami; compresi i clienti a zero nel mese
  const curDi = new Map(cur.clienti.map((c) => [c.chiave, c]));
  const calo = [];
  for (const p of prev.clienti) {
    const c = curDi.get(p.chiave)?.totale || { ...prodVuota };
    const suValore = p.totale.valore != null && Number(p.totale.valore) > 0 && (c.valore != null || c.esami === 0);
    const v = suValore ? varPct(c.valore || 0, p.totale.valore) : varPct(c.esami, p.totale.esami);
    if (v != null && v <= -sogliaCalo) calo.push({ chiave: p.chiave, cliente: p.cliente, organization_id: p.organization_id, base: suValore ? 'valore' : 'esami', variazione: v, mese: c, anno_prima: p.totale });
  }
  calo.sort((x, y) => x.variazione - y.variazione);
  // senza produzione da N giorni: ultima accettazione più vecchia di N giorni ma entro i 12 mesi
  const limite = giorniPrima(oggi, giorniSenza);
  const fermi = await conLab({ da: giorniPrima(oggi, 365), a: oggi, ...base }, `SELECT chiave, max(cliente) AS cliente, max(organization_id) AS organization_id, max(date) AS ultima, count(*)::int AS accettazioni_12m
      FROM acc GROUP BY chiave ORDER BY max(date) DESC`);
  const senzaProduzione = fermi.filter((r) => String(r.ultima).slice(0, 10) < limite).map((r) => ({ ...r, giorni: Math.round((Date.parse(`${oggi}T00:00:00Z`) - Date.parse(`${String(r.ultima).slice(0, 10)}T00:00:00Z`)) / 86400000) }));
  // client Synclab non abbinati (attivi nella copia), con le accettazioni degli ultimi 12 mesi
  const pNa = [giorniPrima(oggi, 365), oggi];
  const nonAbbinati = await many(`WITH ${ctePc(pNa, privatiInB2c)}
    SELECT pc.client_id, pc.client_code, pc.legal_name, pc.stato_abbinamento,
           (SELECT count(*)::int FROM synclab.requests r WHERE r.instance_id = pc.instance_id AND r.client_id = pc.client_id AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $1::date AND $2::date) AS accettazioni_12m
      FROM pc WHERE pc.stato_abbinamento IN ('DA_ABBINARE','PROPOSTO') AND pc.disponibilita = 'ATTIVO' ORDER BY (pc.stato_abbinamento = 'DA_ABBINARE') DESC, 5 DESC, pc.client_code`, pNa);
  const kpi = { clienti: righe.length, accettazioni: cur.totale.accettazioni, esami: cur.totale.esami, valore: cur.totale.valore, righe_senza_prezzo: cur.totale.righe_senza_prezzo,
    fatturato: fat.totale, anno_prima: { clienti: prev.clienti.length, accettazioni: prev.totale.accettazioni, esami: prev.totale.esami, valore: prev.totale.valore, fatturato: fatPrev.totale } };
  return { mese: mk, periodo: { da, a, prec }, kpi, top10, clienti: righe, in_calo: calo, soglia_calo: sogliaCalo, senza_produzione: senzaProduzione, giorni_senza: giorniSenza,
    non_abbinati: nonAbbinati.filter((x) => x.stato_abbinamento === 'DA_ABBINARE'), proposti: nonAbbinati.filter((x) => x.stato_abbinamento === 'PROPOSTO') };
}

/**
 * Prezzi netti applicati per esame e cliente (Σ netto × quantità / Σ quantità sulle righe con prezzo) contro il listino CORRENTE di
 * Synclab del client (listino base, poi extra). Il listino del Business Hub lo affianca il modulo Retail (non è un dato Synclab).
 */
export async function prezziApplicati({ da, a, privatiInB2c = true, ripartizione = 'B2B', chiave = null, stati = null }) {
  // prezzo applicato = netto di riga (prima dello sconto di testata): è quello confrontabile con il listino
  const c = cteLab({ da, a, privatiInB2c, ripartizione, chiave, stati: stati || await statiErogati(), applica: await applicaDa(null) });
  const rows = await many(`WITH ${c.sql},
    g AS (SELECT chiave, max(cliente) AS cliente, codice, max(descr_riga) AS descr_riga, count(*)::int AS righe, sum(quantita) AS quantita,
             sum(netto_riga) / nullif(sum(quantita) FILTER (WHERE netto IS NOT NULL), 0) AS prezzo_medio, min(netto) AS prezzo_min, max(netto) AS prezzo_max,
             count(*) FILTER (WHERE netto IS NULL)::int AS righe_senza_prezzo FROM it GROUP BY chiave, codice)
    SELECT g.*, coalesce((SELECT ex.description FROM synclab.exams ex WHERE ex.disponibilita = 'ATTIVO' AND upper(ex.exam_code) = g.codice ORDER BY ex.updated_at DESC LIMIT 1), g.descr_riga) AS descrizione,
           (SELECT pli.net_unit_price_excluding_vat FROM pc p2 JOIN synclab.price_lists pl ON pl.instance_id = p2.instance_id AND pl.id IN (p2.price_list_id, p2.extra_price_list_id) AND pl.disponibilita = 'ATTIVO'
              JOIN synclab.price_list_items pli ON pli.instance_id = pl.instance_id AND pli.price_list_id = pl.id AND upper(pli.exam_code) = g.codice
             WHERE p2.chiave = g.chiave ORDER BY (pl.id = p2.price_list_id) DESC, pli.ord LIMIT 1) AS listino_synclab
      FROM g ORDER BY lower(g.cliente), g.righe DESC, g.codice`, c.params);
  return rows.map((r) => {
    const pm = n2(r.prezzo_medio), ls = r.listino_synclab != null ? Number(r.listino_synclab) : null;
    return { chiave: r.chiave, cliente: r.cliente, codice: r.codice, descrizione: r.descrizione, righe: r.righe, quantita: Number(r.quantita), prezzo_medio: pm, prezzo_min: n2(r.prezzo_min), prezzo_max: n2(r.prezzo_max),
      righe_senza_prezzo: r.righe_senza_prezzo, listino_synclab: ls, scost_synclab: pm != null && ls != null ? n2(pm - ls) : null, scost_synclab_pct: pm != null && ls ? varPct(pm, ls) : null };
  });
}

/**
 * Scheda di un cliente B2B (chiave = id della Legal entity, oppure 'c-' + id del client Synclab): client Synclab collegati, andamento
 * mensile di produzione e fatturato, esami più richiesti, prezzi applicati, documenti del periodo.
 */
export async function schedaClienteSynclab({ chiave, da, a, privatiInB2c = true }) {
  const k = String(chiave);
  const params = [k];
  const clients = await many(`WITH ${ctePc(params, privatiInB2c)} SELECT instance_id, client_id, client_code, legal_name, organization_id, site_id, sede, stato_abbinamento, perimetro_b2b, ripartizione, price_list_id, extra_price_list_id, disponibilita,
      (SELECT l.code || coalesce(' · ' || l.description, '') FROM synclab.price_lists l WHERE l.instance_id = pc.instance_id AND l.id = pc.price_list_id LIMIT 1) AS listino_base,
      (SELECT l.code || coalesce(' · ' || l.description, '') FROM synclab.price_lists l WHERE l.instance_id = pc.instance_id AND l.id = pc.extra_price_list_id LIMIT 1) AS listino_extra
    FROM pc WHERE pc.chiave = $1 ORDER BY client_code`, params);
  const prod = await produzioneClientiMesi({ da, a, privatiInB2c, ripartizione: null, chiave: k });
  const fat = await fatturatoClientiMesi({ da, a, privatiInB2c, ripartizione: null, chiave: k });
  const esami = await conLab({ da, a, privatiInB2c, chiave: k }, `SELECT codice, max(descr_riga) AS descr_riga, count(*)::int AS esami, count(DISTINCT request_id)::int AS accettazioni, sum(valore_riga) AS valore,
      sum(netto_riga) / nullif(sum(quantita) FILTER (WHERE netto IS NOT NULL), 0) AS prezzo_medio FROM it GROUP BY codice ORDER BY 3 DESC, 1 LIMIT 15`);
  const desc = esami.length ? new Map((await many(`SELECT DISTINCT ON (upper(exam_code)) upper(exam_code) AS codice, description FROM synclab.exams WHERE disponibilita = 'ATTIVO' AND upper(exam_code) = ANY($1::text[]) ORDER BY upper(exam_code), updated_at DESC`, [esami.map((e) => e.codice)])).map((x) => [x.codice, x.description])) : new Map();
  const documenti = await conDoc({ da, a, privatiInB2c, chiave: k }, `SELECT id, invoice_number, date, mese, document_type, classe, contributo, total FROM doc ORDER BY date DESC, invoice_number DESC LIMIT 500`);
  const c0 = prod.clienti[0] || fat.clienti[0] || null;
  return {
    chiave: k, cliente: c0?.cliente || clients[0]?.legal_name || null, organization_id: clients[0]?.organization_id ?? c0?.organization_id ?? null, clients,
    ripartizione: clients[0]?.ripartizione || 'B2B', periodo: { da, a },
    andamento: prod.mesi.map((mk) => ({ mese: mk, ...(prod.clienti[0]?.mesi[mk] || prodVuota), documenti: fat.clienti[0]?.mesi[mk] || { ...docVuoto } })),
    totale: { ...(prod.clienti[0]?.totale || prodVuota), documenti: fat.totale },
    esami: esami.map((e) => ({ codice: e.codice, descrizione: desc.get(e.codice) || e.descr_riga, esami: e.esami, accettazioni: e.accettazioni, valore: n2(e.valore), prezzo_medio: n2(e.prezzo_medio) })),
    prezzi: await prezziApplicati({ da, a, privatiInB2c, ripartizione: null, chiave: k }),
    documenti: documenti.map((d) => ({ ...d, contributo: n2(d.contributo), total: n2(d.total) })),
    // v0.68.5: progressione giornaliera della produzione erogata nell'ultimo mese del periodo
    giornaliero: await produzioneGiornaliera({ da: `${a.slice(0, 7)}-01` < da ? da : `${a.slice(0, 7)}-01`, a, privatiInB2c, chiave: k }),
  };
}

/**
 * Laboratorio in sede (sezione B2C): accettazioni Synclab dei punti TD per sede e mese, esami più richiesti (rete e per sede), confronto
 * con lo stesso periodo dell'anno prima. Con l'impostazione a false: { attivo: false } (tutto Synclab è B2B).
 */
export async function laboratorioInSede({ da, a, privatiInB2c = true, siteId = null }) {
  if (privatiInB2c === false) return { attivo: false, motivo: 'Impostazione "Accettazioni dei punti TD nel B2C" spenta: tutto Synclab è B2B' };
  const prec = { da: annoPrima(da), a: annoPrima(a) };
  const o = { da, a, privatiInB2c, ripartizione: 'LAB_SEDE', siteId };
  const op = { ...o, da: prec.da, a: prec.a };
  const sedeMese = await conLab(o, `SELECT site_id, max(sede) AS sede, mese, ${AGG_ACC} FROM acc GROUP BY site_id, mese`);
  const itSedeMese = await conLab(o, `SELECT site_id, mese, ${AGG_IT} FROM it GROUP BY site_id, mese`);
  const sedePrev = await conLab(op, `SELECT site_id, max(sede) AS sede, ${AGG_ACC} FROM acc GROUP BY site_id`);
  const itSedePrev = await conLab(op, `SELECT site_id, ${AGG_IT} FROM it GROUP BY site_id`);
  const mesi = mesiTra(da, a);
  const ks = (x) => (x == null ? 'ND' : String(x));
  const sedi = new Map();
  for (const r of [...sedeMese, ...sedePrev]) if (!sedi.has(ks(r.site_id))) sedi.set(ks(r.site_id), { site_id: r.site_id, sede: r.site_id == null ? 'Legal entity TD senza sede indicata' : r.sede, mesi: {} });
  for (const r of sedeMese) sedi.get(ks(r.site_id)).mesi[r.mese] = formaProd(r, itSedeMese.find((x) => ks(x.site_id) === ks(r.site_id) && x.mese === r.mese));
  const righe = [...sedi.values()].map((s) => {
    const t = Object.values(s.mesi).reduce((acc, x) => ({ accettazioni: acc.accettazioni + x.accettazioni, esami: acc.esami + x.esami, valore: x.valore == null ? acc.valore : n2((acc.valore || 0) + x.valore), righe_senza_prezzo: acc.righe_senza_prezzo + x.righe_senza_prezzo }), { ...prodVuota });
    const p = formaProd(sedePrev.find((x) => ks(x.site_id) === ks(s.site_id)), itSedePrev.find((x) => ks(x.site_id) === ks(s.site_id)));
    return { ...s, totale: t, anno_prima: p, var_accettazioni: varPct(t.accettazioni, p.accettazioni) };
  }).sort((x, y) => y.totale.accettazioni - x.totale.accettazioni);
  const sommaR = (lista) => lista.reduce((acc, x) => ({ accettazioni: acc.accettazioni + x.accettazioni, esami: acc.esami + x.esami, valore: x.valore == null ? acc.valore : n2((acc.valore || 0) + x.valore), righe_senza_prezzo: acc.righe_senza_prezzo + x.righe_senza_prezzo }), { ...prodVuota });
  const totale = sommaR(righe.map((r) => r.totale)), totPrev = sommaR(righe.map((r) => r.anno_prima));
  const esamiRete = await conLab(o, `SELECT codice, max(descr_riga) AS descr_riga, count(*)::int AS esami, count(DISTINCT request_id)::int AS accettazioni FROM it GROUP BY codice ORDER BY 3 DESC, 1 LIMIT 15`);
  const esamiPrev = await conLab(op, `SELECT codice, count(*)::int AS esami FROM it GROUP BY codice`);
  const esamiSede = await conLab(o, `SELECT site_id, codice, esami FROM (SELECT site_id, codice, count(*)::int AS esami, row_number() OVER (PARTITION BY site_id ORDER BY count(*) DESC, codice) AS rn FROM it GROUP BY site_id, codice) t WHERE rn <= 5 ORDER BY site_id, esami DESC`);
  const codici = [...new Set([...esamiRete, ...esamiSede].map((e) => e.codice))];
  const desc = codici.length ? new Map((await many(`SELECT DISTINCT ON (upper(exam_code)) upper(exam_code) AS codice, description FROM synclab.exams WHERE disponibilita = 'ATTIVO' AND upper(exam_code) = ANY($1::text[]) ORDER BY upper(exam_code), updated_at DESC`, [codici])).map((x) => [x.codice, x.description])) : new Map();
  const per_mese = mesi.map((mk) => ({ mese: mk, ...sommaR(righe.map((r) => r.mesi[mk]).filter(Boolean)) }));
  return {
    attivo: true, periodo: { da, a, prec }, mesi, sedi: righe, per_mese, totale, anno_prima: totPrev, var_accettazioni: varPct(totale.accettazioni, totPrev.accettazioni),
    esami: esamiRete.map((e) => { const p = esamiPrev.find((x) => x.codice === e.codice)?.esami || 0; return { codice: e.codice, descrizione: desc.get(e.codice) || e.descr_riga, esami: e.esami, accettazioni: e.accettazioni, anno_prima: p, variazione: varPct(e.esami, p) }; }),
    esami_per_sede: righe.map((s) => ({ site_id: s.site_id, sede: s.sede, esami: esamiSede.filter((e) => ks(e.site_id) === ks(s.site_id)).map((e) => ({ codice: e.codice, descrizione: desc.get(e.codice) || null, esami: e.esami })) })),
  };
}

// ================================================================== Produzione erogata (v0.68.5): la grandezza principale
const PER = {
  giorno: { k: `to_char(date, 'YYYY-MM-DD')`, nome: `NULL::text` },
  mese: { k: 'mese', nome: `NULL::text` },
  cliente: { k: 'chiave', nome: 'max(cliente)', extra: 'max(organization_id) AS organization_id, max(stato_abbinamento) AS stato_abbinamento, max(ripartizione) AS ripartizione' },
  sede: { k: `coalesce(site_id::text, 'ND')`, nome: 'max(sede)' },
  ripartizione: { k: 'ripartizione', nome: 'max(ripartizione)' },
};
const giorniTra = (da, a) => { const out = []; for (let t = Date.parse(`${da}T00:00:00Z`), e = Date.parse(`${a}T00:00:00Z`); t <= e && out.length < 1200; t += 86400000) out.push(iso(new Date(t))); return out; };
const sommaProd = (lista) => {
  const t = { ...prodVuotaR }; let conValore = false, conSconto = false;
  for (const x of lista) {
    t.accettazioni += x.accettazioni || 0; t.registrate += x.registrate || 0; t.esami += x.esami || 0; t.righe_senza_prezzo += x.righe_senza_prezzo || 0;
    if (x.valore != null) { t.valore = (t.valore || 0) + Number(x.valore); conValore = true; }
    if (x.sconto_testata != null) { t.sconto_testata = (t.sconto_testata || 0) + Number(x.sconto_testata); conSconto = true; }
  }
  if (conValore) t.valore = n2(t.valore); if (conSconto) t.sconto_testata = n2(t.sconto_testata);
  return t;
};

/**
 * PRODUZIONE EROGATA (definizione unica, v0.68.5). Periodo [da, a]; per = null (solo totale) | 'giorno' | 'mese' | 'cliente' | 'sede' |
 * 'ripartizione'; filtri: ripartizione ('B2B' | 'LAB_SEDE' | null = tutte), chiave (id della Legal entity o 'c-' + client Synclab), siteId;
 * annoPrima = stesso periodo dell'anno prima (totale e, per cliente/sede/ripartizione, per voce). stati: stati erogati (predefinito
 * l'impostazione del connettore). Ritorna { periodo, stati, totale: { accettazioni, esami, valore, righe_senza_prezzo, sconto_testata },
 * righe: [{ chiave, nome, ...totale }], anno_prima, regola }. Per giorno e mese le righe coprono tutto il periodo (anche a zero).
 */
export async function produzioneErogata({ da, a, per = null, privatiInB2c = true, ripartizione = null, chiave = null, siteId = null, annoPrima: conAnnoPrima = false, stati = null, sconto = null } = {}) {
  if (!giornoRe.test(String(da)) || !giornoRe.test(String(a)) || da > a) throw Object.assign(new Error('Periodo non valido (da/a nel formato AAAA-MM-GG)'), { status: 400 });
  if (per && !PER[per]) throw Object.assign(new Error(`Raggruppamento non valido: ${per}`), { status: 400 });
  const st = stati ? normalizzaStati(stati) : await statiErogati();
  const sc = sconto == null ? await scontoTestata() : normalizzaSconto(sconto);
  const leggi = async (d1, d2) => {
    const o = { da: d1, a: d2, privatiInB2c, ripartizione, chiave, siteId, stati: st, sconto: sc };
    const g = per ? PER[per] : null;
    const sel = g ? `${g.k} AS k, ${g.nome} AS nome${g.extra ? `, ${g.extra}` : ''},` : '';
    const grp = g ? 'GROUP BY 1' : '';
    const acc = await conLab(o, `SELECT ${sel} ${AGG_ACC} FROM acc ${grp}`);
    const it = await conLab(o, `SELECT ${g ? `${g.k} AS k,` : ''} ${AGG_IT} FROM it ${grp}`);
    if (!g) return { totale: formaProdR(acc[0], it[0]), righe: [] };
    const righe = acc.map((x) => ({ chiave: x.k, nome: x.nome ?? null, ...(per === 'cliente' ? { organization_id: x.organization_id, stato_abbinamento: x.stato_abbinamento, ripartizione: x.ripartizione } : {}),
      ...formaProdR(x, it.find((y) => y.k === x.k)) }));
    return { totale: sommaProd(righe), righe };
  };
  const cur = await leggi(da, a);
  let righe = cur.righe;
  if (per === 'giorno' || per === 'mese') {
    const chiavi = per === 'giorno' ? giorniTra(da, a) : mesiTra(da, a);
    const m = new Map(righe.map((x) => [x.chiave, x]));
    righe = chiavi.map((k) => m.get(k) || { chiave: k, nome: null, ...prodVuotaR });
  } else if (per) righe = [...righe].sort((x, y) => (Number(y.valore || 0) - Number(x.valore || 0)) || (y.esami - x.esami) || String(x.nome ?? x.chiave).localeCompare(String(y.nome ?? y.chiave), 'it'));
  const out = { periodo: { da, a }, per, stati: st, sconto: sc, totale: cur.totale, righe,
    regola: `Produzione accettata (stati ${st.join(', ')}); valore = Σ netto di riga × quantità${sc === 'APPLICA' ? ' × (1 − sconto di testata)' : ' (sconto di testata non applicato, come il report del gestionale)'}, righe d'esame non cancellate; esami = righe non cancellate comprese quelle senza prezzo (contate anche a parte); data = data dell'accettazione` };
  if (conAnnoPrima) {
    const prec = { da: annoPrima(da), a: annoPrima(a) };
    const p = await leggi(prec.da, prec.a);
    out.periodo.prec = prec;
    out.anno_prima = { totale: p.totale, per_chiave: per && !['giorno', 'mese'].includes(per) ? Object.fromEntries(p.righe.map((x) => [x.chiave, x])) : null };
    out.var_valore = varPct(cur.totale.valore, p.totale.valore);
  }
  return out;
}

/** Produzione erogata giorno per giorno nel periodo (tutti i giorni, anche a zero): { giorni: [{ giorno, ...totale }], totale, stati }. */
export async function produzioneGiornaliera(opz) {
  const p = await produzioneErogata({ ...opz, per: 'giorno' });
  return { periodo: p.periodo, stati: p.stati, sconto: p.sconto, totale: p.totale, giorni: p.righe.map(({ chiave, nome, ...x }) => ({ giorno: chiave, ...x })), regola: p.regola };
}

/**
 * TOP N clienti per produzione erogata del periodo con la quota sul totale della ripartizione e la variazione sullo stesso periodo del
 * mese prima (prec = { da, a }, facoltativo). { righe: [{ pos, chiave, cliente, valore, esami, quota, prima, variazione }], totale, clienti }.
 */
export async function topClientiProduzione({ da, a, prec = null, n = 5, privatiInB2c = true, ripartizione = 'B2B', stati = null, sconto = null }) {
  const st = stati ? normalizzaStati(stati) : await statiErogati();
  const sc = sconto == null ? await scontoTestata() : normalizzaSconto(sconto);
  const cur = await produzioneErogata({ da, a, per: 'cliente', privatiInB2c, ripartizione, stati: st, sconto: sc });
  const pr = prec ? await produzioneErogata({ da: prec.da, a: prec.a, per: 'cliente', privatiInB2c, ripartizione, stati: st, sconto: sc }) : null;
  const pm = new Map((pr?.righe || []).map((x) => [String(x.chiave), x.valore]));
  const tot = cur.totale.valore;
  const righe = cur.righe.filter((x) => x.valore != null).slice(0, n).map((x, i) => {
    const p = pm.has(String(x.chiave)) ? pm.get(String(x.chiave)) : null;
    return { pos: i + 1, chiave: String(x.chiave), cliente: x.nome, organization_id: x.organization_id ?? null, valore: n2(x.valore), esami: x.esami, accettazioni: x.accettazioni,
      quota: tot && Number(tot) > 0 ? Math.round((Number(x.valore) / Number(tot)) * 1000) / 10 : null,
      prima: p == null ? null : n2(p), variazione: p == null || !Number(p) ? null : Math.round(((Number(x.valore) - Number(p)) / Math.abs(Number(p))) * 1000) / 10 };
  });
  return { righe, totale: n2(tot), clienti: cur.righe.length, stati: st, periodo: cur.periodo, prec };
}

/**
 * Produzione erogata per cliente e giorno (Retail > B2B > Produzione, dettaglio giornaliero): { giorni, clienti: [{ chiave, cliente,
 * organization_id, stato_abbinamento, totale, giorni: { 'AAAA-MM-GG': {...} } }], per_giorno, totale, stati }.
 */
export async function produzioneClientiGiorni({ da, a, privatiInB2c = true, ripartizione = 'B2B', chiave = null, stati = null, sconto = null }) {
  const st = stati ? normalizzaStati(stati) : await statiErogati();
  const sc = sconto == null ? await scontoTestata() : normalizzaSconto(sconto);
  const o = { da, a, privatiInB2c, ripartizione, chiave, stati: st, sconto: sc };
  const acc = await conLab(o, `SELECT chiave, max(cliente) AS cliente, max(organization_id) AS organization_id, max(stato_abbinamento) AS stato_abbinamento, to_char(date, 'YYYY-MM-DD') AS giorno, ${AGG_ACC} FROM acc GROUP BY chiave, giorno`);
  const it = await conLab(o, `SELECT chiave, to_char(date, 'YYYY-MM-DD') AS giorno, ${AGG_IT} FROM it GROUP BY chiave, giorno`);
  const giorni = giorniTra(da, a);
  const m = new Map();
  for (const r of acc) {
    if (!m.has(r.chiave)) m.set(r.chiave, { chiave: r.chiave, cliente: r.cliente, organization_id: r.organization_id, stato_abbinamento: r.stato_abbinamento, giorni: {} });
    m.get(r.chiave).giorni[r.giorno] = formaProdR(r, it.find((x) => x.chiave === r.chiave && x.giorno === r.giorno));
  }
  const clienti = [...m.values()].map((c) => ({ ...c, totale: sommaProd(Object.values(c.giorni)) }))
    .sort((x, y) => (Number(y.totale.valore || 0) - Number(x.totale.valore || 0)) || String(x.cliente).localeCompare(String(y.cliente), 'it'));
  const perGiorno = Object.fromEntries(giorni.map((g) => [g, sommaProd(clienti.map((c) => c.giorni[g]).filter(Boolean))]));
  return { giorni, clienti, per_giorno: perGiorno, totale: sommaProd(clienti.map((c) => c.totale)), stati: st, sconto: sc };
}

// ================================================================== Quadratura con il report di StudioLab (v0.68.6)
// Richiesta del CEO del 10/11/2026: "C'è una discrepanza tra il valore dell'accettato di StudioLab a ieri e quello del Cockpit o comunque
// della Suite. Trovare l'errore e correggere." Il report "Riepilogo Esami" del gestionale è per CLIENTE (tutti i client: B2B e Laboratorio
// in sede), una riga per codice esame con Q.ta e importo (righe senza importo comprese). Questa lettura dà, per client Synclab e per il
// periodo, tutto quello che serve per confrontarlo con le quattro varianti (stati accettato / erogati × sconto di testata sì / no) e per
// attribuire le cause (stati esclusi, righe cancellate, righe senza prezzo, sconto di testata, copia più vecchia della fine del periodo).
// Il confronto con il report e l'attribuzione delle cause sono in lib/synclab/quadratura.js (funzioni pure, testate).
export const VARIANTI_QUADRATURA = [
  { chiave: 'ACCETTATO_RIGA', stati: STATI_ACCETTATO, sconto: 'NON_APPLICARE', etichetta: 'Accettato · importi di riga' },
  { chiave: 'ACCETTATO_SCONTO', stati: STATI_ACCETTATO, sconto: 'APPLICA', etichetta: 'Accettato · sconto di testata applicato' },
  { chiave: 'EROGATI_RIGA', stati: STATI_EROGATI_STORICI, sconto: 'NON_APPLICARE', etichetta: 'Erogati (v0.68.5) · importi di riga' },
  { chiave: 'EROGATI_SCONTO', stati: STATI_EROGATI_STORICI, sconto: 'APPLICA', etichetta: 'Erogati (v0.68.5) · sconto di testata applicato' },
];
/** Variante della quadratura: chiave di VARIANTI_QUADRATURA oppure { stati, sconto } (per esempio l'impostazione in vigore). */
export function varianteQuadratura(v) {
  if (v && typeof v === 'object') return { chiave: 'PERSONALIZZATA', stati: normalizzaStati(v.stati), sconto: normalizzaSconto(v.sconto), etichetta: 'Impostazione in vigore' };
  return VARIANTI_QUADRATURA.find((x) => x.chiave === String(v || '')) || VARIANTI_QUADRATURA[0];
}
const somma0 = (rows, f) => rows.reduce((t, x) => t + Number(f(x) || 0), 0);
/**
 * Calcolo di una variante sulle righe aggregate di quadratura (pura): per client e in totale.
 * righe: [{ instance_id, client_id, state, deleted, accettazioni, righe, quantita, importo_riga, sconto, senza_prezzo }]
 */
export function calcolaVariante(righe, variante) {
  const v = varianteQuadratura(variante);
  const st = new Set(v.stati);
  const applica = v.sconto === 'APPLICA';
  const dentro = righe.filter((x) => st.has(Number(x.state)));
  const fuori = righe.filter((x) => !st.has(Number(x.state)));
  const vive = dentro.filter((x) => !x.deleted), cancellate = dentro.filter((x) => x.deleted);
  const valore = (rr) => somma0(rr, (x) => x.importo_riga) - (applica ? somma0(rr, (x) => x.sconto) : 0);
  const accettazioni = (rr) => somma0(rr.filter((x) => !x.deleted), (x) => x.accettazioni);
  const statiEsclusi = {};
  for (const x of fuori.filter((y) => !y.deleted)) {
    const k = String(x.state ?? 'ND');
    const t = (statiEsclusi[k] ||= { stato: x.state == null ? null : Number(x.state), etichetta: LEGENDA_STATI[x.state] || (x.state == null ? 'stato non indicato' : 'altro codice'), accettazioni: 0, righe: 0, quantita: 0, importo: 0 });
    t.accettazioni += Number(x.accettazioni || 0); t.righe += Number(x.righe || 0); t.quantita += Number(x.quantita || 0); t.importo += Number(x.importo_riga || 0) - (applica ? Number(x.sconto || 0) : 0);
  }
  return {
    variante: v,
    accettazioni: accettazioni(dentro), righe: somma0(vive, (x) => x.righe), quantita: somma0(vive, (x) => x.quantita), importo: n2(valore(vive)) ?? 0,
    righe_senza_prezzo: somma0(vive, (x) => x.senza_prezzo), sconto_testata: n2(somma0(vive, (x) => x.sconto)) ?? 0, sconto_applicato: applica,
    stati_esclusi: Object.values(statiEsclusi).map((x) => ({ ...x, importo: n2(x.importo) })).sort((a, b) => b.importo - a.importo),
    esclusi: { accettazioni: accettazioni(fuori), righe: somma0(fuori.filter((x) => !x.deleted), (x) => x.righe), quantita: somma0(fuori.filter((x) => !x.deleted), (x) => x.quantita), importo: n2(valore(fuori.filter((x) => !x.deleted))) ?? 0 },
    cancellate: { righe: somma0(cancellate, (x) => x.righe), quantita: somma0(cancellate, (x) => x.quantita), importo: n2(somma0(cancellate, (x) => x.importo_riga)) ?? 0 },
  };
}

/**
 * Dati della Suite per la quadratura del periodo [da, a] (data dell'accettazione), per client Synclab: tutte le accettazioni ATTIVE della
 * copia (qualunque stato), righe d'esame cancellate e no, quantità (null = 1, come una riga del report), importi di riga, sconto di testata,
 * righe senza prezzo. variante: chiave di VARIANTI_QUADRATURA o { stati, sconto } (predefinita: l'impostazione in vigore).
 * { periodo, variante, varianti: [{ chiave, etichetta, stati, sconto, totale }], clienti: [{ client_id, client_code, legal_name, sede_gestionale,
 *   organization_id, cliente, ripartizione, righe (aggregate), calcolo }], totale, copia: { checkpoint_at, ultimo_completo_at }, regola }
 */
export async function quadratura({ da, a, variante = null, privatiInB2c = true } = {}) {
  if (!giornoRe.test(String(da)) || !giornoRe.test(String(a)) || da > a) throw Object.assign(new Error('Periodo non valido (da/a nel formato AAAA-MM-GG)'), { status: 400 });
  const vigore = await regolaProduzione();
  const v = variante == null ? varianteQuadratura({ stati: vigore.stati, sconto: vigore.sconto }) : varianteQuadratura(variante);
  const params = [da, a];
  const righe = await many(`WITH ${ctePc(params, privatiInB2c)},
    rq AS (SELECT r.instance_id, r.id, r.client_id, r.state, r.header_discount_percent FROM synclab.requests r
            WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $1::date AND $2::date)
    SELECT rq.instance_id, rq.client_id, rq.state, coalesce(i.deleted, FALSE) AS deleted, count(DISTINCT rq.id)::int AS accettazioni, count(i.ord)::int AS righe,
           coalesce(sum(CASE WHEN i.ord IS NOT NULL THEN coalesce(i.quantity, 1) END), 0) AS quantita, coalesce(sum(i.net_unit_price_excluding_vat * i.quantity), 0) AS importo_riga,
           coalesce(sum(${SQL_SCONTO_RIGA('i', 'rq')}), 0) AS sconto, count(*) FILTER (WHERE i.ord IS NOT NULL AND (i.net_unit_price_excluding_vat IS NULL OR i.quantity IS NULL))::int AS senza_prezzo
      FROM rq LEFT JOIN synclab.request_items i ON i.instance_id = rq.instance_id AND i.request_id = rq.id
     GROUP BY 1, 2, 3, 4`, params);
  const pc = await ripartizioneClienti({ privatiInB2c });
  const cl = await many(`SELECT instance_id, id AS client_id, client_code, legal_name, site_description, site_city FROM synclab.clients`);
  const anag = new Map(cl.map((c) => [`${c.instance_id}|${c.client_id}`, c]));
  const rip = new Map(pc.map((c) => [`${c.instance_id}|${c.client_id}`, c]));
  const perClient = new Map();
  for (const r of righe) {
    const k = `${r.instance_id}|${r.client_id}`;
    if (!perClient.has(k)) {
      const c = anag.get(k) || {}, p = rip.get(k) || {};
      perClient.set(k, { instance_id: r.instance_id, client_id: r.client_id, client_code: c.client_code || null, legal_name: c.legal_name || null, sede_gestionale: c.site_description || null,
        comune: c.site_city || null, organization_id: p.organization_id ?? null, cliente: p.cliente || c.legal_name || r.client_id, ripartizione: p.ripartizione || 'B2B', righe: [] });
    }
    perClient.get(k).righe.push({ ...r, quantita: Number(r.quantita), importo_riga: Number(r.importo_riga), sconto: Number(r.sconto) });
  }
  // anche i client senza accettazioni nel periodo (per abbinare i nomi del report)
  for (const c of cl) {
    const k = `${c.instance_id}|${c.client_id}`;
    if (!perClient.has(k)) { const p = rip.get(k) || {}; perClient.set(k, { instance_id: c.instance_id, client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, sede_gestionale: c.site_description || null, comune: c.site_city || null, organization_id: p.organization_id ?? null, cliente: p.cliente || c.legal_name || c.client_id, ripartizione: p.ripartizione || 'B2B', righe: [] }); }
  }
  const clienti = [...perClient.values()].map((c) => ({ ...c, calcolo: calcolaVariante(c.righe, v) }));
  const varianti = [...VARIANTI_QUADRATURA, ...(VARIANTI_QUADRATURA.some((x) => String(x.stati) === String(vigore.stati) && x.sconto === vigore.sconto) ? [] : [varianteQuadratura({ stati: vigore.stati, sconto: vigore.sconto })])]
    .map((x) => { const t = calcolaVariante(righe.map((r) => ({ ...r, quantita: Number(r.quantita), importo_riga: Number(r.importo_riga), sconto: Number(r.sconto) })), x);
      return { chiave: x.chiave, etichetta: x.etichetta, stati: x.stati, sconto: x.sconto, in_vigore: String(x.stati) === String(vigore.stati) && x.sconto === vigore.sconto, totale: t }; });
  const cp = await one(`SELECT max(checkpoint_at) AS checkpoint_at, max(ultimo_completo_at) AS ultimo_completo_at FROM synclab.sync_scope WHERE dataset = 'requests'`).catch(() => null);
  return {
    periodo: { da, a }, variante: v, in_vigore: vigore, varianti, clienti,
    totale: calcolaVariante(righe.map((r) => ({ ...r, quantita: Number(r.quantita), importo_riga: Number(r.importo_riga), sconto: Number(r.sconto) })), v),
    copia: { checkpoint_at: cp?.checkpoint_at || null, ultimo_completo_at: cp?.ultimo_completo_at || null },
    regola: 'Accettazioni ATTIVE della copia con data nel periodo, tutti i client (B2B e Laboratorio in sede); righe d\'esame non cancellate comprese quelle senza prezzo; quantità mancante = 1; importo = Σ netto di riga × quantità (meno lo sconto di testata solo nelle varianti che lo applicano)',
  };
}
