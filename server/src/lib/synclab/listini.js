// Synclab Data API · listini del gestionale per il Business Hub (v0.68.5, CEO 10/11/2026: "In retail/b2b/listini hai già tutti i listini:
// riportali come file XLSX aggregato anche in Business Hub associandoli al cliente corretto").
// Fonte: copia locale synclab.price_lists / price_list_items (listino CORRENTE: priceListId ed extraPriceListId del client; non ricostruisce
// i prezzi storici, che stanno nelle righe delle accettazioni). Cliente = Legal entity abbinata (synclab.clients_td).
//  - listiniDiOrg(orgId): client Synclab della Legal entity con i loro listini (base ed extra), stato, righe;
//  - confrontoConHub(righe, prezziHub): differenze di prezzo con il listino corrente del Business Hub (prezzo offerto, altrimenti listino);
//  - xlsxListiniOrg / xlsxListiniAggregato: file Excel (decimali esatti: un numero che il double non rappresenta esattamente va come testo).
import ExcelJS from 'exceljs';
import { one, many } from '../../db.js';

export const STATO_LISTINO = { 0: 'bozza', 5: 'in revisione', 10: 'approvato', 50: 'annullato' };
export const TIPO_LISTINO = { 0: 'a sconto percentuale', 1: 'a prezzo fisso' };
const etStato = (s) => (s == null ? null : STATO_LISTINO[Number(s)] || `stato ${s}`);
const etTipo = (t) => (t == null ? null : TIPO_LISTINO[Number(t)] || `tipo ${t}`);

/** Valore esatto per Excel: numero se il double lo rappresenta esattamente, altrimenti il testo del decimale; null resta vuoto. */
export function esatto(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  const norm = (x) => { let y = x.replace(/^\+/, ''); if (y.includes('.')) y = y.replace(/0+$/, '').replace(/\.$/, ''); return y.replace(/^(-?)0+(?=\d)/, '$1') || '0'; };
  return norm(String(n)) === norm(t) ? n : t;
}

const SQL_LISTINO = `SELECT l.instance_id, l.id, l.code, l.description, l.type, l.state, l.active, l.disponibilita, l.operating_company,
    (SELECT count(*)::int FROM synclab.price_list_items i WHERE i.instance_id = l.instance_id AND i.price_list_id = l.id) AS righe
  FROM synclab.price_lists l`;
const righeListino = (instanceId, id) => many(`SELECT i.ord, i.exam_code, coalesce(i.description, (SELECT e.description FROM synclab.exams e WHERE e.instance_id = i.instance_id AND upper(e.exam_code) = upper(i.exam_code) ORDER BY e.updated_at DESC LIMIT 1)) AS description,
    i.gross_unit_price_excluding_vat::text AS lordo, i.discount_percent::text AS sconto, i.net_unit_price_excluding_vat::text AS netto, i.vat_rate::text AS iva, i.vat_code, i.vat_treatment
  FROM synclab.price_list_items i WHERE i.instance_id = $1 AND i.price_list_id = $2 ORDER BY i.ord`, [instanceId, id]);

/**
 * Listini del gestionale di una Legal entity: { clients: [{ client_id, client_code, legal_name, active, site_id, site_name, listini: [{ ruolo:
 * BASE|EXTRA, id, code, description, stato, tipo, active, righe, anteprima: [...prime n], tutte? }], orfani: [id] }] }.
 */
export async function listiniDiOrg(orgId, { anteprima = 8, tutte = false } = {}) {
  const clients = await many(`SELECT v.instance_id, v.client_id, v.client_code, v.legal_name, v.active, v.price_list_id, v.extra_price_list_id, v.site_id, s.name AS site_name, s.studiolab_code
      FROM synclab.clients_td v LEFT JOIN public.sites s ON s.id = v.site_id WHERE v.organization_id = $1 AND v.disponibilita = 'ATTIVO' ORDER BY v.client_code`, [orgId]);
  const out = [];
  for (const c of clients) {
    const ids = [c.price_list_id, c.extra_price_list_id].filter(Boolean);
    const ls = ids.length ? await many(`${SQL_LISTINO} WHERE l.instance_id = $1 AND l.id = ANY($2::text[])`, [c.instance_id, ids]) : [];
    const listini = [];
    for (const [ruolo, id] of [['BASE', c.price_list_id], ['EXTRA', c.extra_price_list_id]]) {
      if (!id) continue;
      const l = ls.find((x) => x.id === id);
      if (!l) continue;
      const r = await righeListino(c.instance_id, l.id);
      listini.push({ ruolo, id: l.id, code: l.code, description: l.description, stato: etStato(l.state), state: l.state, tipo: etTipo(l.type), active: l.active, disponibilita: l.disponibilita,
        righe: l.righe, anteprima: r.slice(0, anteprima), ...(tutte ? { tutte: r } : {}) });
    }
    out.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, active: c.active, site_id: c.site_id, site_name: c.site_name, studiolab_code: c.studiolab_code,
      listini, orfani: ids.filter((id) => !ls.some((x) => x.id === id)) });
  }
  return { clients: out, nota: 'Listino corrente del gestionale (Synclab): non ricostruisce i prezzi storici, che stanno nelle righe delle accettazioni' };
}

/**
 * Confronto delle righe di un listino Synclab con il listino del Business Hub (Map codice → { prezzo, offerto, listino, descrizione }).
 * { righe: [{ codice, descrizione, synclab, hub, differenza, differenza_pct }], diverse, solo_synclab, solo_hub, uguali }.
 */
export function confrontoConHub(righe = [], prezziHub = new Map()) {
  const out = []; const visti = new Set();
  let diverse = 0, uguali = 0, soloS = 0;
  for (const r of righe) {
    const cod = String(r.exam_code || '').trim().toUpperCase(); if (!cod || visti.has(cod)) continue; visti.add(cod);
    const s = r.netto == null ? null : Number(r.netto);
    const h = prezziHub.get(cod)?.prezzo ?? null;
    if (h == null) { soloS++; out.push({ codice: cod, descrizione: r.description, synclab: s, hub: null, differenza: null, differenza_pct: null, esito: 'SOLO_SYNCLAB' }); continue; }
    const d = s == null ? null : Number((s - Number(h)).toFixed(6));
    const esito = d == null ? 'SENZA_PREZZO' : Math.abs(d) < 0.005 ? 'UGUALE' : 'DIVERSO';
    if (esito === 'UGUALE') uguali++; else if (esito === 'DIVERSO') diverse++;
    out.push({ codice: cod, descrizione: r.description || prezziHub.get(cod)?.descrizione || null, synclab: s, hub: Number(h), differenza: d, differenza_pct: d != null && Number(h) ? Math.round((d / Number(h)) * 1000) / 10 : null, esito });
  }
  const soloHub = [...prezziHub.entries()].filter(([k]) => !visti.has(k)).map(([k, v]) => ({ codice: k, descrizione: v.descrizione || null, synclab: null, hub: v.prezzo, differenza: null, differenza_pct: null, esito: 'SOLO_HUB' }));
  out.sort((x, y) => ({ DIVERSO: 0, SOLO_SYNCLAB: 1, SENZA_PREZZO: 2, UGUALE: 3 }[x.esito] - { DIVERSO: 0, SOLO_SYNCLAB: 1, SENZA_PREZZO: 2, UGUALE: 3 }[y.esito]) || Math.abs(y.differenza || 0) - Math.abs(x.differenza || 0) || x.codice.localeCompare(y.codice));
  return { righe: [...out, ...soloHub], diverse, uguali, solo_synclab: soloS, solo_hub: soloHub.length };
}

const COL_RIGHE = [
  { header: 'Codice esame', key: 'codice', width: 14 }, { header: 'Descrizione', key: 'descrizione', width: 48 },
  { header: 'Prezzo lordo', key: 'lordo', width: 13, num: true }, { header: 'Sconto %', key: 'sconto', width: 10, num: true }, { header: 'Prezzo netto', key: 'netto', width: 13, num: true },
  { header: 'IVA %', key: 'iva', width: 8, num: true }, { header: 'Trattamento IVA', key: 'trattamento', width: 18 },
];
const FMT = '#,##0.00####';
function foglio(wb, nome, colonne, righe) {
  const ws = wb.addWorksheet(nome.slice(0, 31));
  ws.columns = colonne.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.num ? { numFmt: FMT } : undefined }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of righe) ws.addRow(Object.fromEntries(colonne.map((c) => [c.key, c.num ? esatto(r[c.key]) : (r[c.key] ?? null)])));
  if (righe.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonne.length } };
  return ws;
}
const rigaX = (r) => ({ codice: r.exam_code, descrizione: r.description, lordo: r.lordo, sconto: r.sconto, netto: r.netto, iva: r.iva, trattamento: r.vat_treatment });

/** XLSX dei listini del gestionale di una Legal entity: un foglio per listino (codice, descrizione, lordo, sconto, netto, IVA) e il confronto. */
export async function xlsxListiniOrg({ org, dati, confronti = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD';
  const info = [];
  for (const c of dati.clients) for (const l of c.listini) info.push({ cliente: org.name, codice: c.client_code, client: c.legal_name, listino: `${l.code || l.id}${l.description ? ` · ${l.description}` : ''}`, ruolo: l.ruolo === 'BASE' ? 'base' : 'extra', stato: l.stato, righe: l.righe });
  foglio(wb, 'Riepilogo', [{ header: 'Cliente', key: 'cliente', width: 36 }, { header: 'Codice StudioLab', key: 'codice', width: 16 }, { header: 'Ragione sociale nel gestionale', key: 'client', width: 36 },
    { header: 'Listino', key: 'listino', width: 36 }, { header: 'Ruolo', key: 'ruolo', width: 8 }, { header: 'Stato', key: 'stato', width: 12 }, { header: 'Righe', key: 'righe', width: 8 }], info);
  const nomi = new Set();
  for (const c of dati.clients) for (const l of c.listini) {
    let nome = `${c.client_code || 'client'} ${l.code || l.ruolo}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28);
    for (let i = 2; nomi.has(nome); i++) nome = `${nome.slice(0, 25)} ${i}`;
    nomi.add(nome);
    foglio(wb, nome, COL_RIGHE, (l.tutte || []).map(rigaX));
  }
  for (const k of confronti) {
    if (!k.confronto?.righe?.length) continue;
    foglio(wb, `Confronto ${k.client_code || ''} ${k.code || ''}`.trim().slice(0, 31), [{ header: 'Codice esame', key: 'codice', width: 14 }, { header: 'Descrizione', key: 'descrizione', width: 44 },
      { header: 'Netto Synclab', key: 'synclab', width: 14, num: true }, { header: 'Prezzo Business Hub', key: 'hub', width: 18, num: true }, { header: 'Differenza', key: 'differenza', width: 12, num: true },
      { header: 'Differenza %', key: 'differenza_pct', width: 12, num: true }, { header: 'Esito', key: 'esito', width: 14 }], k.confronto.righe);
  }
  foglio(wb, 'Note', [{ header: 'Voce', key: 'k', width: 26 }, { header: 'Valore', key: 'v', width: 110 }], [
    { k: 'Fonte', v: 'Synclab Data API (copia locale del gestionale StudioLAB): listino corrente del client (priceListId ed extraPriceListId)' },
    { k: 'Avvertenza', v: dati.nota },
    { k: 'Prezzo netto', v: 'netUnitPriceExcludingVat della riga di listino (IVA esclusa); sconto % in punti percentuali; decimali come nel gestionale' },
    { k: 'Confronto', v: 'Listino corrente del Business Hub: prezzo offerto, altrimenti prezzo di listino' },
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Listini del gestionale di tutti i clienti del perimetro (aggregato per il Business Hub): Riepilogo (cliente, codice StudioLab, listino,
 * righe; in fondo i listini Synclab non associati ad alcun client abbinato) e un foglio unico lungo cliente × esame (comodo per le pivot).
 * orgIds = Legal entity del perimetro (null = tutte quelle in perimetro B2B). Ritorna { buffer, clienti, righe, non_associati }.
 */
export async function xlsxListiniAggregato({ orgIds = null } = {}) {
  const cl = await many(`SELECT v.instance_id, v.client_id, v.client_code, v.legal_name, v.active, v.organization_id, o.name AS org_name, v.price_list_id, v.extra_price_list_id
      FROM synclab.clients_td v JOIN public.organizations o ON o.id = v.organization_id
     WHERE v.disponibilita = 'ATTIVO' AND coalesce(v.perimetro_b2b, FALSE) AND ($1::int[] IS NULL OR v.organization_id = ANY($1::int[]))
     ORDER BY lower(o.name), v.client_code`, [orgIds]);
  const riep = []; const lunghe = []; const usati = new Set();
  for (const c of cl) {
    for (const [ruolo, id] of [['base', c.price_list_id], ['extra', c.extra_price_list_id]]) {
      if (!id) continue;
      usati.add(`${c.instance_id}|${id}`);
      const l = await one(`${SQL_LISTINO} WHERE l.instance_id = $1 AND l.id = $2`, [c.instance_id, id]);
      if (!l) { riep.push({ cliente: c.org_name, codice: c.client_code, client: c.legal_name, listino: `${id} (non nella copia)`, ruolo, stato: null, righe: 0 }); continue; }
      const nome = `${l.code || l.id}${l.description ? ` · ${l.description}` : ''}`;
      riep.push({ cliente: c.org_name, codice: c.client_code, client: c.legal_name, listino: nome, ruolo, stato: etStato(l.state), righe: l.righe });
      for (const r of await righeListino(c.instance_id, l.id)) lunghe.push({ cliente: c.org_name, codice_cliente: c.client_code, listino: l.code || l.id, ruolo, ...rigaX(r) });
    }
    if (!c.price_list_id && !c.extra_price_list_id) riep.push({ cliente: c.org_name, codice: c.client_code, client: c.legal_name, listino: 'nessun listino nel gestionale', ruolo: null, stato: null, righe: 0 });
  }
  // listini usati da client abbinati (anche fuori perimetro): per l'elenco dei "non associati" contano tutti i client abbinati
  const abbinati = await many(`SELECT DISTINCT instance_id, unnest(ARRAY[price_list_id, extra_price_list_id]) AS id FROM synclab.clients_td WHERE organization_id IS NOT NULL AND disponibilita = 'ATTIVO'`);
  for (const a of abbinati) if (a.id) usati.add(`${a.instance_id}|${a.id}`);
  const tutti = await many(`${SQL_LISTINO} WHERE l.disponibilita = 'ATTIVO' ORDER BY l.code NULLS LAST, l.id`);
  const nonAssociati = tutti.filter((l) => !usati.has(`${l.instance_id}|${l.id}`)).map((l) => ({ code: l.code, description: l.description, stato: etStato(l.state), tipo: etTipo(l.type), righe: l.righe }));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD';
  const ws = foglio(wb, 'Riepilogo', [{ header: 'Cliente', key: 'cliente', width: 40 }, { header: 'Codice StudioLab', key: 'codice', width: 16 }, { header: 'Ragione sociale nel gestionale', key: 'client', width: 38 },
    { header: 'Listino', key: 'listino', width: 40 }, { header: 'Ruolo', key: 'ruolo', width: 8 }, { header: 'Stato', key: 'stato', width: 12 }, { header: 'Righe', key: 'righe', width: 8 }], riep);
  ws.addRow([]);
  const h = ws.addRow([`Listini Synclab non associati ad alcun cliente abbinato (${nonAssociati.length})`]); h.font = { bold: true };
  if (nonAssociati.length) {
    const hh = ws.addRow(['Codice listino', 'Descrizione', 'Stato', 'Tipo', 'Righe']); hh.font = { bold: true };
    for (const l of nonAssociati) ws.addRow([l.code, l.description, l.stato, l.tipo, l.righe]);
  } else ws.addRow(['Nessuno: ogni listino del gestionale è associato a un client abbinato']);
  foglio(wb, 'Listini cliente × esame', [{ header: 'Cliente', key: 'cliente', width: 40 }, { header: 'Codice StudioLab', key: 'codice_cliente', width: 16 }, { header: 'Listino', key: 'listino', width: 14 },
    { header: 'Ruolo', key: 'ruolo', width: 8 }, ...COL_RIGHE], lunghe);
  foglio(wb, 'Note', [{ header: 'Voce', key: 'k', width: 26 }, { header: 'Valore', key: 'v', width: 110 }], [
    { k: 'Fonte', v: 'Synclab Data API (copia locale del gestionale StudioLAB): listino corrente di ogni client (priceListId ed extraPriceListId)' },
    { k: 'Perimetro', v: 'Client Synclab abbinati a una Legal entity e nel perimetro B2B (cliente attivo o contrattualizzato del Business Hub, oppure incluso a mano in Dati Synclab)' },
    { k: 'Decimali', v: 'Prezzi e sconti come nel gestionale (nessun arrotondamento); prezzo netto = netUnitPriceExcludingVat, IVA esclusa' },
    { k: 'Avvertenza', v: 'Il listino corrente non ricostruisce i prezzi storici delle accettazioni' },
  ]);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), clienti: new Set(cl.map((c) => c.organization_id)).size, client: cl.length, righe: lunghe.length, non_associati: nonAssociati };
}
