// Synclab Data API: letture della copia locale per gli altri moduli (Finance, Ordini, Cockpit, Diagnostica). Nessuna regola inventata:
//  - produzione = righe d'esame non cancellate (deleted = false) delle accettazioni ATTIVE con data nel mese, al prezzo netto storico
//    della riga (netUnitPriceExcludingVat × quantity); lo sconto di testata (headerDiscountPercent) si riporta a parte, non si applica;
//  - fatturato = netRevenueContribution una sola volta per documento con data nel mese (NC già negative, annullati e proforma a zero,
//    tipo sconosciuto con contributo null: esclusi e contati). Mai il segno invertito, mai la somma delle righe;
//  - listino del cliente = listino corrente (priceListId / extraPriceListId): non ricostruisce i prezzi storici.
// Un client Synclab appartiene a una Legal entity secondo synclab.clients_td (abbinamento confermato, altrimenti proposto).
import { one, many } from '../../db.js';

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

/** Aggregazione per mese, codice d'esame e prezzo netto storico; base comune di produzioneMensile e produzionePerOrg. */
function sqlProduzione(where) {
  return `SELECT to_char(r.date, 'YYYY-MM') AS mese, upper(coalesce(nullif(i.exam_code, ''), '?')) AS codice, max(i.description) AS descrizione,
        i.net_unit_price_excluding_vat AS prezzo_netto, count(*)::int AS righe, sum(i.quantity) AS quantita,
        sum(i.net_unit_price_excluding_vat * i.quantity) AS valore, count(*) FILTER (WHERE i.net_unit_price_excluding_vat IS NULL)::int AS senza_prezzo
      FROM synclab.requests r JOIN synclab.request_items i ON i.instance_id = r.instance_id AND i.request_id = r.id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND coalesce(i.deleted, FALSE) = FALSE AND ${where}
     GROUP BY 1, 2, 4 ORDER BY 2, 4`;
}
function sintesiProduzione(rows, testate) {
  const righe = rows.map((x) => ({ codice: x.codice, descrizione: x.descrizione, prezzo_netto: x.prezzo_netto, righe: x.righe, quantita: x.quantita, valore: x.valore }));
  const esami = rows.reduce((a, x) => a + Number(x.righe), 0);
  const senza = rows.reduce((a, x) => a + Number(x.senza_prezzo), 0);
  const conValore = rows.filter((x) => x.valore != null);
  const valore = conValore.length ? conValore.reduce((a, x) => a + Number(x.valore), 0) : null;
  const note = [];
  if (senza) note.push(`${senza} righe d'esame su ${esami} senza prezzo nel gestionale: valore parziale`);
  if (testate?.con_sconto) note.push(`${testate.con_sconto} accettazioni con sconto di testata (${testate.percentuali}): riportato a parte, non applicato ai netti di riga`);
  return { esami, valore, righe_senza_prezzo: senza, righe, accettazioni: testate?.accettazioni ?? null, sconto_testata: testate?.con_sconto ? { accettazioni: testate.con_sconto, percentuali: testate.percentuali } : null, note: note.join('. ') || null };
}

/**
 * Produzione del mese di un cliente (Legal entity o client Synclab): { esami (righe), valore (somma dei netti di riga, null se nessun
 * prezzo), righe: [{ codice, descrizione, prezzo_netto, righe, quantita, valore }], righe_senza_prezzo, accettazioni, sconto_testata, note }.
 */
export async function produzioneMensile({ organization_id = null, client_id = null, mese }) {
  const { da, a } = limiti(mese);
  const params = [da, a];
  const fc = filtroCliente('r', { organization_id, client_id }, params);
  const rows = await many(sqlProduzione(`r.date BETWEEN $1::date AND $2::date AND ${fc}`), params);
  const t = await one(`SELECT count(*)::int AS accettazioni, count(*) FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0)::int AS con_sconto,
      string_agg(DISTINCT r.header_discount_percent::text || '%', ', ') FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0) AS percentuali
    FROM synclab.requests r WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $1::date AND $2::date AND ${fc}`, params);
  return { mese, ...sintesiProduzione(rows, t) };
}

/** Produzione per Legal entity e mese nel periodo [da, a] (Finance, margine Service): Map 'org|AAAA-MM' → sintesi come produzioneMensile. */
export async function produzionePerOrg(orgIds, da, a) {
  const out = new Map();
  if (!orgIds?.length) return out;
  const rows = await many(`WITH m AS (SELECT instance_id, client_id, organization_id FROM synclab.clients_td WHERE organization_id = ANY($1::int[]))
    SELECT m.organization_id AS org_id, x.* FROM m CROSS JOIN LATERAL (${sqlProduzione(`r.date BETWEEN $2::date AND $3::date AND r.instance_id = m.instance_id AND r.client_id = m.client_id`)}) x`, [orgIds, da, a]);
  const t = await many(`SELECT m.organization_id AS org_id, to_char(r.date, 'YYYY-MM') AS mese, count(*)::int AS accettazioni, count(*) FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0)::int AS con_sconto,
      string_agg(DISTINCT r.header_discount_percent::text || '%', ', ') FILTER (WHERE coalesce(r.header_discount_percent, 0) <> 0) AS percentuali
    FROM synclab.clients_td m JOIN synclab.requests r ON r.instance_id = m.instance_id AND r.client_id = m.client_id
   WHERE m.organization_id = ANY($1::int[]) AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date BETWEEN $2::date AND $3::date GROUP BY 1, 2`, [orgIds, da, a]);
  const gruppi = new Map();
  for (const r of rows) { const k = `${r.org_id}|${r.mese}`; if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(r); }
  for (const [k, rr] of gruppi) out.set(k, sintesiProduzione(rr, t.find((x) => `${x.org_id}|${x.mese}` === k)));
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

/** Fatturato del mese di un cliente dai documenti economici: netRevenueContribution una volta per documento. */
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

/** Fatturato del laboratorio (tutti i documenti) e accettazioni di un giorno: per il Cockpit. null se non ci sono dati importati. */
export async function indicatoriLaboratorio({ ieri, inizioMese, oggi }) {
  const d = await disponibilita();
  if (!d) return null;
  const acc = d.requests ? await one(`SELECT count(*)::int AS n FROM synclab.requests WHERE disponibilita='ATTIVO' AND deleted_at IS NULL AND date = $1::date`, [ieri]) : null;
  const fat = d.invoices ? sintesiFatturato(await one(sqlFatturato('v.date BETWEEN $1::date AND $2::date'), [inizioMese, oggi])) : null;
  return { accettazioni_ieri: acc ? acc.n : null, fatturato_mese: fat, disponibilita: d };
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
