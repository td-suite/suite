// Label · accettazioni e etichette. Fonte: copia Synclab della Suite (synclab.requests / request_items / samples / request_item_samples,
// proiezione standard) oppure, per un'accettazione non ancora nella copia, la lettura diretta dal gestionale salvata in
// etichette.accettazioni_dirette (senza paziente). Il paziente arriva SOLO da etichette.pazienti_recenti.
// Etichette: una per CAMPIONE (barcode, materiale, contenitore) con gli esami che usano quel campione (request_item_samples o sampleIds
// delle righe), più l'etichetta "richiesta" senza barcode se l'impostazione è accesa. Ogni etichetta ha i valori dei segnaposto e lo
// ZPL del modello riempito.
import { one, many } from '../db.js';
import { riempiModello } from './zpl.js';
import { itData, isoData, oraLocale, nomeSede } from './core.js';
import { statoSynclab } from '../../nc/lib/synclabDesk.js';

/** Accettazione con righe e campioni: { fonte: 'COPIA'|'GESTIONALE', testata, righe: [{ id, codice, descrizione, cancellata, campioni }], campioni: [...] } */
export async function caricaAccettazione(instanceId, id) {
  const r = await one(`SELECT instance_id, id, request_number, date::text AS data, created_at_local, client_id, client_code, state, disponibilita, dem_sex
                         FROM synclab.requests WHERE instance_id = $1 AND id = $2 AND deleted_at IS NULL`, [instanceId, id]);
  if (r) {
    const righe = await many(`SELECT i.ord, i.id, i.exam_code AS codice, coalesce(i.description, e.description) AS descrizione, coalesce(i.deleted, FALSE) AS cancellata,
        coalesce((SELECT array_agg(l.sample_id ORDER BY l.sample_id) FROM synclab.request_item_samples l WHERE l.instance_id = i.instance_id AND l.request_id = i.request_id AND l.item_id = i.id), i.sample_ids, '{}') AS campioni
        FROM synclab.request_items i
        LEFT JOIN LATERAL (SELECT x.description FROM synclab.exams x WHERE x.exam_code = i.exam_code AND x.disponibilita = 'ATTIVO' ORDER BY x.updated_at DESC LIMIT 1) e ON TRUE
       WHERE i.instance_id = $1 AND i.request_id = $2 ORDER BY i.ord`, [instanceId, id]);
    const campioni = await many(`SELECT ord, id, barcode, material AS materiale, container AS contenitore FROM synclab.samples WHERE instance_id = $1 AND request_id = $2 ORDER BY ord`, [instanceId, id]);
    return { fonte: 'COPIA', testata: { instance_id: r.instance_id, id: r.id, numero: r.request_number, data: r.data, ora: oraLocale(r.created_at_local), client_id: r.client_id, client_code: r.client_code, stato: r.state, stato_label: statoSynclab(r.state), attiva: r.disponibilita === 'ATTIVO', sesso_demografia: r.dem_sex || null }, righe, campioni };
  }
  const d = await one(`SELECT instance_id, id, request_number, data::text AS data, client_id, raw FROM accettazioni_dirette WHERE instance_id = $1 AND id = $2`, [instanceId, id]);
  if (!d) return null;
  return daGestionale(d.instance_id, d.raw);
}

/** Forma comune da un elemento `requests` della Data API (lettura diretta): nessun dato del paziente. */
export function daGestionale(instanceId, x) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    fonte: 'GESTIONALE',
    testata: { instance_id: instanceId, id: String(x.id), numero: x.requestNumber ?? null, data: isoData(x.date), ora: oraLocale(x.createdAtLocal), client_id: x.clientId ?? null, client_code: x.clientCode ?? null, stato: x.state ?? null, stato_label: statoSynclab(x.state), attiva: true, sesso_demografia: x.demographics?.sex ?? null },
    righe: arr(x.items).map((i, k) => ({ ord: k, id: i.id != null ? String(i.id) : null, codice: i.examCode ?? null, descrizione: i.description ?? null, cancellata: Boolean(i.deleted), campioni: arr(i.sampleIds).map(String) })),
    campioni: arr(x.samples).map((s, k) => ({ ord: k, id: s.id != null ? String(s.id) : null, barcode: s.barcode ?? null, materiale: s.material ?? null, contenitore: s.container ?? null })),
  };
}

/** Elemento della Data API senza paziente e testi storici (quello che si conserva in accettazioni_dirette). */
export function senzaPaziente(x) {
  const o = JSON.parse(JSON.stringify(x || {}));
  delete o.patient;
  for (const it of Array.isArray(o.items) ? o.items : []) delete it.historicalDescription;
  return o;
}

/** Cliente (client Synclab) e sede della Suite abbinata (clients_td). */
export async function clienteESede(instanceId, clientId) {
  if (!clientId) return { cliente: null, site_id: null, sede: null };
  const c = await one(`SELECT ct.site_id, ct.organization_id, coalesce(c.legal_name, ct.legal_name) AS cliente, s.code, s.name
                         FROM synclab.clients_td ct LEFT JOIN synclab.clients c ON c.instance_id = ct.instance_id AND c.id = ct.client_id
                         LEFT JOIN public.sites s ON s.id = ct.site_id WHERE ct.instance_id = $1 AND ct.client_id = $2`, [instanceId, clientId]).catch(() => null);
  return { cliente: c?.cliente || null, site_id: c?.site_id || null, sede: c?.site_id ? nomeSede(c) : null };
}

/**
 * Etichette di un'accettazione (funzione pura). acc = caricaAccettazione(); paziente = riga di pazienti_recenti o null;
 * opz: { richiesta (bool), cliente, sede, modello: { zpl } }. Una etichetta per campione con gli esami NON cancellati che lo usano; un
 * campione legato solo a righe cancellate non si stampa (provetta non più necessaria); un campione senza righe collegate si stampa
 * (legame non dichiarato dal gestionale) con l'elenco esami vuoto. Ritorna [{ chiave, tipo, barcode, materiale, contenitore, esami,
 * valori, zpl, avvisi }].
 */
export function costruisciEtichette(acc, paziente, { richiesta = false, cliente = null, sede = null, modello = null } = {}) {
  const t = acc.testata;
  const vive = acc.righe.filter((r) => !r.cancellata);
  const perCampione = new Map();
  for (const r of acc.righe) for (const s of r.campioni || []) { if (!perCampione.has(s)) perCampione.set(s, []); perCampione.get(s).push(r); }
  const out = [];
  for (const c of acc.campioni) {
    const legate = c.id != null ? (perCampione.get(c.id) || []) : [];
    const esami = legate.filter((r) => !r.cancellata);
    if (legate.length && !esami.length) continue;
    out.push({ chiave: `C:${c.id ?? c.ord}`, tipo: 'CAMPIONE', barcode: c.barcode || null, materiale: c.materiale || null, contenitore: c.contenitore || null, esami: unici(esami), avvisi: c.barcode ? [] : ['Campione senza barcode nel gestionale: l\'etichetta esce senza codice a barre'] });
  }
  if (richiesta) out.push({ chiave: 'R', tipo: 'RICHIESTA', barcode: null, materiale: null, contenitore: 'Richiesta', esami: unici(vive), avvisi: [] });
  const tot = out.length;
  const base = {
    ACCETTAZIONE: t.numero || '', COGNOME: paziente?.cognome || '', NOME: paziente?.nome || '', NASCITA: paziente?.nascita ? itData(paziente.nascita) : '',
    SESSO: paziente?.sesso || t.sesso_demografia || '', DATA: t.data ? itData(t.data) : '', ORA: t.ora || '', CLIENTE: cliente || '', SEDE: sede || '', TOT: String(tot),
  };
  return out.map((e, k) => {
    const valori = { ...base, BARCODE: e.barcode || '', CONTENITORE: e.contenitore || '', MATERIALE: e.materiale || '', ESAMI: e.esami.map((x) => x.codice).filter(Boolean).join(' '), N: String(k + 1) };
    return { ...e, n: k + 1, valori, zpl: modello ? riempiModello(modello.zpl, valori) : null };
  });
}
const unici = (righe) => { const v = new Set(); return righe.filter((r) => { const k = r.codice || r.id; if (v.has(k)) return false; v.add(k); return true; }).map((r) => ({ codice: r.codice || null, descrizione: r.descrizione || null })); };

/** Righe dei risultati di ricerca per un elenco di chiavi [instance_id, id] (copia o lettura diretta), con identità e sede. */
export async function righeRisultato(chiavi) {
  if (!chiavi.length) return [];
  const rows = await many(`WITH k AS (SELECT * FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS k(instance_id, id, n))
    SELECT k.n, k.instance_id, k.id, coalesce(r.request_number, d.request_number) AS numero, coalesce(r.date, d.data)::text AS data,
           coalesce(r.created_at_local, CASE WHEN d.raw->>'createdAtLocal' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' THEN (d.raw->>'createdAtLocal')::timestamp END) AS creata,
           coalesce(r.client_id, d.client_id) AS client_id, coalesce(r.state, CASE WHEN d.raw->>'state' ~ '^[0-9]{1,4}$' THEN (d.raw->>'state')::int END) AS state, r.disponibilita,
           CASE WHEN r.id IS NOT NULL THEN 'COPIA' ELSE 'GESTIONALE' END AS fonte,
           CASE WHEN r.id IS NOT NULL THEN (SELECT count(*) FROM synclab.samples s WHERE s.instance_id = r.instance_id AND s.request_id = r.id)
                ELSE jsonb_array_length(CASE WHEN jsonb_typeof(d.raw->'samples') = 'array' THEN d.raw->'samples' ELSE '[]'::jsonb END) END::int AS provette,
           ct.site_id, coalesce(c.legal_name, ct.legal_name) AS cliente, st.code AS sede_code, st.name AS sede_name,
           p.cognome, p.nome, p.nascita::text AS nascita, (p.request_id IS NOT NULL) AS identita_letta
      FROM k
      LEFT JOIN synclab.requests r ON r.instance_id = k.instance_id AND r.id = k.id AND r.deleted_at IS NULL
      LEFT JOIN accettazioni_dirette d ON r.id IS NULL AND d.instance_id = k.instance_id AND d.id = k.id
      LEFT JOIN synclab.clients_td ct ON ct.instance_id = k.instance_id AND ct.client_id = coalesce(r.client_id, d.client_id)
      LEFT JOIN synclab.clients c ON c.instance_id = k.instance_id AND c.id = coalesce(r.client_id, d.client_id)
      LEFT JOIN public.sites st ON st.id = ct.site_id
      LEFT JOIN pazienti_recenti p ON p.instance_id = k.instance_id AND p.request_id = k.id
     WHERE r.id IS NOT NULL OR d.id IS NOT NULL ORDER BY k.n`, [chiavi.map((x) => x[0]), chiavi.map((x) => String(x[1]))]);
  return rows.map((x) => ({
    instance_id: x.instance_id, id: x.id, numero: x.numero, data: x.data, ora: oraLocale(x.creata), fonte: x.fonte, stato: statoSynclab(x.state),
    attiva: x.fonte === 'GESTIONALE' || x.disponibilita === 'ATTIVO', provette: x.provette, site_id: x.site_id, cliente: x.cliente,
    sede: x.site_id ? nomeSede({ code: x.sede_code, name: x.sede_name }) : null, cognome: x.cognome, nome: x.nome, nascita: x.nascita, identita_letta: x.identita_letta,
  }));
}
