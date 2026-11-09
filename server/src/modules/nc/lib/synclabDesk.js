// Non conformità · Desk: ricerca dell'accettazione anche nella COPIA SYNCLAB (schema synclab del core, proiezione standard) quando la
// cache di NC (HL7/ServiceNET) non la ha (richiesta del CEO dopo il primo completo in produzione, v0.67.1).
// Ricerca su synclab.requests.request_number e synclab.samples.barcode, in tre passi:
//   1. ESATTA;
//   2. NORMALIZZATA: senza maiuscole/minuscole, spazi, trattini, barre, punti e trattini bassi;
//   3. ANNO + NUMERO (solo numero di accettazione): il formato del gestionale non è noto ("2026/6743", "P26-006743"…), quindi si confronta
//      l'ultimo gruppo di cifre senza zeri iniziali e, se il testo cercato contiene anche l'anno (primo gruppo di 2 o 4 cifre), l'anno a due
//      cifre (quello del numero del candidato o, in mancanza, della sua data).
// Al primo passo che trova qualcosa ci si ferma. Una sola accettazione: si importa nella cache di NC con la funzione di merge di
// ServiceNET (numero, data, stato tradotto dal dizionario, esami non cancellati, campioni, sede inviante dal client abbinato); più di
// una: elenco per scegliere. Nessun dato del paziente: la copia è in proiezione standard; il paziente arriva dal recupero puntuale.
import { one, many } from '../db.js';
import { upsertAccettazione, logEvento } from './lis.js';
import { loadSede, sedeKeyOfSite, findSedeByCodice } from './sedi.js';

// Stati delle accettazioni (docs/synclab-data-api/02_DIZIONARIO_BI.md): 0, 1 e 29 sono esclusi dal servizio
export const STATO_SYNCLAB = { 10: 'Prenotata', 11: 'NC mai arrivato', 15: 'In attesa', 18: 'Prelievo eseguito', 20: 'In lavorazione', 25: 'In firma', 30: 'Attende prelievo', 40: 'Referto pronto', 50: 'Chiusa' };
export const statoSynclab = (s) => (s == null ? null : STATO_SYNCLAB[Number(s)] || `Stato ${s} del gestionale`);

/** Testo normalizzato: maiuscolo, senza spazi, trattini, barre, punti e trattini bassi. */
export const normCodice = (s) => String(s ?? '').toUpperCase().replace(/[\s\-_/.\\]+/g, '');
/** { anno: 'AA' | null, numero: 'N' senza zeri iniziali | null } dai gruppi di cifre del testo. */
export function annoNumero(s) {
  const g = String(s ?? '').match(/\d+/g) || [];
  if (!g.length) return { anno: null, numero: null };
  const numero = g[g.length - 1].replace(/^0+(?=\d)/, '');
  const anno = g.length >= 2 && (g[0].length === 2 || g[0].length === 4) ? g[0].slice(-2) : null;
  return { anno, numero };
}

const COLS = `r.instance_id, r.id, r.request_number, r.date, r.created_at_local, r.client_id, r.client_code, r.state, r.disponibilita`;
const BASE = `FROM synclab.requests r WHERE r.deleted_at IS NULL`;

/** Accettazioni della copia che corrispondono al testo: { passo: 'ESATTA'|'NORMALIZZATA'|'ANNO_NUMERO'|null, candidati: [...] } */
export async function cercaAccettazioniSynclab(testo) {
  const v = String(testo ?? '').trim();
  if (!v) return { passo: null, candidati: [] };
  const lim = 'ORDER BY (r.disponibilita = \'ATTIVO\') DESC, r.date DESC NULLS LAST LIMIT 20';
  const viaBarcode = (cond) => `SELECT DISTINCT ${COLS} FROM synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id WHERE r.deleted_at IS NULL AND ${cond}`;
  let rows = await many(`SELECT * FROM (SELECT ${COLS} ${BASE} AND r.request_number = $1 UNION ${viaBarcode('s.barcode = $1')}) r ${lim}`, [v]).catch(() => []);
  if (rows.length) return { passo: 'ESATTA', candidati: rows };
  const n = normCodice(v);
  if (n) {
    const norm = (c) => `regexp_replace(upper(coalesce(${c}, '')), '[[:space:]/._\\\\-]+', '', 'g')`;
    rows = await many(`SELECT * FROM (SELECT ${COLS} ${BASE} AND ${norm('r.request_number')} = $1 UNION ${viaBarcode(`${norm('s.barcode')} = $1`)}) r ${lim}`, [n]).catch(() => []);
    if (rows.length) return { passo: 'NORMALIZZATA', candidati: rows };
  }
  const { anno, numero } = annoNumero(v);
  if (numero && numero.length >= 3) {
    // ultimo gruppo di cifre del numero del candidato = numero (zeri iniziali ignorati), poi l'anno in JS
    const c = await many(`SELECT ${COLS} ${BASE} AND r.request_number ~ ('(^|[^0-9])0*' || $1::text || '$') ${lim.replace('LIMIT 20', 'LIMIT 200')}`, [numero]).catch(() => []);
    rows = c.filter((x) => {
      if (!anno) return true;
      const a = annoNumero(x.request_number).anno || (x.date ? String(x.date).slice(2, 4) : null);
      return a === anno;
    }).slice(0, 20);
    if (rows.length) return { passo: 'ANNO_NUMERO', candidati: rows };
  }
  return { passo: null, candidati: [] };
}

/** Sede inviante di un client Synclab: abbinamento con una sede della Suite (clients_td.site_id, confermato o proposto per codice). */
export async function sedeDaClient(instanceId, clientId, clientCode) {
  const m = await one(`SELECT site_id, organization_id, stato_abbinamento FROM synclab.clients_td WHERE instance_id = $1 AND client_id = $2`, [instanceId, clientId]).catch(() => null);
  if (m?.site_id) {
    const s = await one('SELECT id, kind, organization_id FROM public.sites WHERE id = $1', [m.site_id]);
    const k = sedeKeyOfSite(s);
    if (k && await loadSede(k)) return { sede_id: k, come: m.stato_abbinamento === 'PROPOSTO' ? 'PROPOSTA_CODICE' : 'ABBINATA' };
  }
  if (m?.organization_id && await loadSede(-m.organization_id)) return { sede_id: -m.organization_id, come: m.stato_abbinamento === 'PROPOSTO' ? 'PROPOSTA_CODICE' : 'ABBINATA' };
  const p = clientCode ? await findSedeByCodice(clientCode) : null;
  return p ? { sede_id: null, proposta: { id: p.id, nome: p.nome, codice: p.codice }, come: 'DA_ASSEGNARE' } : { sede_id: null, come: 'DA_ASSEGNARE' };
}

/** Candidato leggibile per l'elenco di scelta del Desk (nessun dato del paziente). */
export async function descriviCandidati(candidati) {
  const out = [];
  for (const c of candidati) {
    const cli = await one('SELECT legal_name FROM synclab.clients WHERE instance_id = $1 AND id = $2', [c.instance_id, c.client_id]).catch(() => null);
    const n = await one(`SELECT count(*) FILTER (WHERE coalesce(deleted, FALSE) = FALSE)::int AS esami FROM synclab.request_items WHERE instance_id = $1 AND request_id = $2`, [c.instance_id, c.id]);
    out.push({ synclab_id: c.id, numero: c.request_number, data: c.date, stato: statoSynclab(c.state), cliente: cli?.legal_name || c.client_code || null, esami: n?.esami ?? 0, attiva: c.disponibilita === 'ATTIVO' });
  }
  return out;
}

/** Importa un'accettazione della copia Synclab nella cache di NC (merge come ServiceNET). Ritorna { row, sede }. */
export async function importaDaSynclab(instanceId, synclabId) {
  const r = await one(`SELECT ${COLS} FROM synclab.requests r WHERE r.instance_id = $1 AND r.id = $2`, [instanceId, synclabId]);
  if (!r) return null;
  const items = await many(`SELECT exam_code, description FROM synclab.request_items WHERE instance_id = $1 AND request_id = $2 AND coalesce(deleted, FALSE) = FALSE ORDER BY ord`, [instanceId, synclabId]);
  const cat = await many(`SELECT DISTINCT ON (exam_code) exam_code, description FROM synclab.exams WHERE disponibilita = 'ATTIVO' AND exam_code = ANY($1::text[]) ORDER BY exam_code, updated_at DESC`, [items.map((i) => i.exam_code).filter(Boolean)]);
  const desc = new Map(cat.map((x) => [x.exam_code, x.description]));
  const campioni = await many(`SELECT barcode, material, container FROM synclab.samples WHERE instance_id = $1 AND request_id = $2 ORDER BY ord`, [instanceId, synclabId]);
  const sede = await sedeDaClient(instanceId, r.client_id, r.client_code);
  const cur = await one('SELECT sede_id, lis_json FROM accettazioni WHERE id = $1', [r.request_number]);
  const visti = new Set();
  const esami = items.filter((i) => i.exam_code && !visti.has(i.exam_code) && visti.add(i.exam_code))
    .map((i) => ({ cod: String(i.exam_code).trim(), descrizione: desc.get(i.exam_code) || i.description || '', stato: null, bloccato: false, idEsame: null }));
  const dataAcc = r.created_at_local ? (await one(`SELECT ($1::timestamp AT TIME ZONE 'Europe/Rome') AS t`, [r.created_at_local])).t : r.date;
  const synclab = { fonte: 'Synclab Data API (copia della Suite)', id: r.id, stato: r.state, stato_label: statoSynclab(r.state), campioni, client_code: r.client_code, sede: sede.come, sede_proposta: sede.proposta || null, importata_il: new Date().toISOString() };
  const row = await upsertAccettazione({
    id: r.request_number, sede_id: cur?.sede_id ?? sede.sede_id ?? undefined, data_accettazione: dataAcc, esami,
    raw: { ...(cur?.lis_json && typeof cur.lis_json === 'object' ? cur.lis_json : {}), synclab },
  }, 'SYNCLAB');
  await logEvento('SYNCLAB', 'OK', { accettazioneId: r.request_number, dettaglio: `accettazione importata dalla copia Synclab (${esami.length} esami, ${campioni.length} campioni, sede ${sede.come.toLowerCase()})` });
  return { row, sede };
}

/** Data dell'ultimo checkpoint delle accettazioni nella copia (per il messaggio "aggiornata al …"); null se la copia è vuota. */
export async function aggiornamentoCopia() {
  const x = await one(`SELECT (SELECT count(*)::int FROM synclab.requests) AS n, (SELECT max(checkpoint_at) FROM synclab.sync_scope WHERE dataset = 'requests') AS at`).catch(() => null);
  return x ? { accettazioni: x.n, checkpoint_at: x.at } : { accettazioni: 0, checkpoint_at: null };
}
