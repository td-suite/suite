// Ordini e Magazzino · fonte Synclab (copia locale della Data API, schema synclab del core; v0.67.1, richieste del CEO dopo il primo
// completo in produzione). Due usi, entrambi in sola lettura della copia:
//  1. PRODUZIONE: per ogni struttura abbinata (client Synclab → synclab.clients_td.site_id / organization_id → struttura del modulo:
//     sede TD = id della sede, punto SERVICE = id del punto, letto dalla sua Legal entity con productionStrutture; solo Legal entity =
//     opposto dell'id) conteggio per mese e codice esame delle righe d'esame NON cancellate delle accettazioni ATTIVE; upsert in
//     production con source 'STUDIOLAB'. Regola: una riga MANUALE o IMPORT dello stesso mese ed esame VINCE (non si sovrascrive). Si
//     ricalcolano tutti i mesi presenti nella copia (il mese in corso compreso) e si tolgono le righe STUDIOLAB di quei mesi che la copia
//     non conferma più (esami cancellati); le righe dei mesi senza dati Synclab (es. HL7 di prima) restano.
//  2. CONTENITORI: coppie (materiale, contenitore) dei campioni (synclab.samples, legati alle righe con request_item_samples), contate
//     per esame; il contenitore più frequente di un esame, abbinato a un articolo, propone la correlazione esame → articolo (fonte
//     SYNCLAB) senza toccare le correlazioni MANUALE o LISTINO.
import { one, many, q, tx } from '../db.js';
import { connectorSync } from '../../../lib/connectors.js';

const KEY_PROD = 'synclab_produzione_ultimo';

/** Data API abilitata e copia con accettazioni? { ok, motivo, accettazioni } */
export async function synclabDisponibile() {
  const c = connectorSync('STUDIOLAB');
  if (!(c.settings?.data_api_enabled === true || c.settings?.data_api_enabled === 'true')) return { ok: false, motivo: 'Data API Synclab disabilitata (Amministrazione > Connettori > StudioLAB > Dati Synclab)' };
  const n = await one(`SELECT count(*)::int AS n FROM synclab.requests WHERE disponibilita = 'ATTIVO'`).catch(() => null);
  if (!n?.n) return { ok: false, motivo: 'Nessuna accettazione nella copia Synclab', accettazioni: 0 };
  return { ok: true, accettazioni: n.n };
}

// righe d'esame valide per struttura, mese e codice
const SQL_PRODUZIONE = `
  WITH m AS (SELECT instance_id, client_id, site_id, organization_id FROM synclab.clients_td WHERE site_id IS NOT NULL OR organization_id IS NOT NULL),
  agg AS (
    SELECT CASE WHEN m.site_id IS NOT NULL THEN m.site_id ELSE -m.organization_id END AS sid, date_trunc('month', r.date)::date AS month,
           trim(i.exam_code) AS code, max(i.description) AS name, count(*)::int AS qty
      FROM synclab.requests r JOIN m ON m.instance_id = r.instance_id AND m.client_id = r.client_id
      JOIN synclab.request_items i ON i.instance_id = r.instance_id AND i.request_id = r.id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date IS NOT NULL AND coalesce(i.deleted, FALSE) = FALSE AND coalesce(trim(i.exam_code), '') <> ''
     GROUP BY 1, 2, 3)
  SELECT agg.*, coalesce((SELECT e.description FROM synclab.exams e WHERE e.disponibilita = 'ATTIVO' AND e.exam_code = agg.code ORDER BY e.updated_at DESC LIMIT 1), agg.name) AS descr
    FROM agg JOIN strutture_v s ON s.id = agg.sid`;

/** Aggiorna la produzione dalla copia Synclab. Ritorna { righe, nuove, aggiornate, invariate, manuali_mantenute, rimosse, strutture, mesi, dal, al, at }. */
export async function aggiornaProduzioneSynclab({ userId = null } = {}) {
  const disp = await synclabDisponibile();
  if (!disp.ok) return { skipped: true, motivo: disp.motivo };
  const out = await tx(async (c) => {
    const rows = (await c.query(SQL_PRODUZIONE)).rows;
    const st = { righe: rows.length, nuove: 0, aggiornate: 0, invariate: 0, manuali_mantenute: 0, rimosse: 0 };
    for (const x of rows) {
      const cur = (await c.query('SELECT qty, source FROM production WHERE struttura_id=$1 AND month=$2 AND exam_code=$3', [x.sid, x.month, x.code])).rows[0];
      if (cur && cur.source !== 'STUDIOLAB') { st.manuali_mantenute++; continue; }   // la riga manuale o importata vince
      if (cur && Number(cur.qty) === x.qty) { st.invariate++; continue; }
      await c.query(`INSERT INTO production (struttura_id, month, exam_code, exam_name, qty, source) VALUES ($1,$2,$3,$4,$5,'STUDIOLAB')
        ON CONFLICT (struttura_id, month, exam_code) DO UPDATE SET qty=EXCLUDED.qty, exam_name=coalesce(EXCLUDED.exam_name, production.exam_name), updated_at=now() WHERE production.source = 'STUDIOLAB'`,
      [x.sid, x.month, x.code, x.descr || null, x.qty]);
      st[cur ? 'aggiornate' : 'nuove']++;
    }
    // righe STUDIOLAB delle (struttura, mese) ricalcolate che la copia non conferma più
    const chiavi = [...new Set(rows.map((x) => `${x.sid}|${x.month}`))];
    if (chiavi.length) {
      const sids = chiavi.map((k) => Number(k.split('|')[0])); const mesi = chiavi.map((k) => k.split('|')[1]);
      const del = await c.query(`DELETE FROM production p USING unnest($1::int[], $2::date[]) AS k(sid, month)
         WHERE p.struttura_id = k.sid AND p.month = k.month AND p.source = 'STUDIOLAB'
           AND NOT EXISTS (SELECT 1 FROM unnest($3::int[], $4::date[], $5::text[]) AS z(sid, month, code) WHERE z.sid = p.struttura_id AND z.month = p.month AND z.code = p.exam_code)`,
      [sids, mesi, rows.map((x) => x.sid), rows.map((x) => x.month), rows.map((x) => x.code)]);
      st.rimosse = del.rowCount;
    }
    const mesi = [...new Set(rows.map((x) => String(x.month).slice(0, 7)))].sort();
    const res = { ...st, strutture: new Set(rows.map((x) => x.sid)).size, mesi: mesi.length, dal: mesi[0] || null, al: mesi[mesi.length - 1] || null, at: new Date().toISOString(), da: userId ? 'manuale' : 'job' };
    await c.query(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY_PROD, JSON.stringify(res)]);
    return res;
  });
  return out;
}

/** Stato per la pagina Produzione: ultimo aggiornamento, disponibilità, client senza struttura. */
export async function statoProduzioneSynclab() {
  const disp = await synclabDisponibile();
  const r = await one('SELECT value FROM app_settings WHERE key=$1', [KEY_PROD]);
  let ultimo = null; try { ultimo = r?.value ? JSON.parse(r.value) : null; } catch { ultimo = null; }
  const nonAbbinati = disp.ok ? (await one(`SELECT count(DISTINCT (r.instance_id, r.client_id))::int AS n FROM synclab.requests r JOIN synclab.clients_td m ON m.instance_id = r.instance_id AND m.client_id = r.client_id
      WHERE r.disponibilita = 'ATTIVO' AND m.site_id IS NULL AND m.organization_id IS NULL`))?.n ?? 0 : null;
  return { disponibile: disp.ok, motivo: disp.motivo || null, accettazioni: disp.accettazioni ?? 0, ultimo, client_senza_struttura: nonAbbinati };
}

// ------------------------------------------------------------------ contenitori e correlazioni
const SQL_COPPIE_ESAME = `
  SELECT trim(i.exam_code) AS code, coalesce(nullif(trim(s.material), ''), '') AS material, coalesce(nullif(trim(s.container), ''), '') AS container, count(*)::int AS n
    FROM synclab.request_items i
    JOIN synclab.requests r ON r.instance_id = i.instance_id AND r.id = i.request_id AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL
    JOIN synclab.request_item_samples l ON l.instance_id = i.instance_id AND l.request_id = i.request_id AND l.item_id = i.id
    JOIN synclab.samples s ON s.instance_id = l.instance_id AND s.request_id = l.request_id AND s.id = l.sample_id
   WHERE coalesce(i.deleted, FALSE) = FALSE AND coalesce(trim(i.exam_code), '') <> ''
   GROUP BY 1, 2, 3`;

/** Aggiorna contenitori_synclab (una riga per coppia vista, osservazioni = campioni delle accettazioni attive); l'abbinamento resta. */
export async function aggiornaContenitori() {
  const r = await q(`INSERT INTO contenitori_synclab (material, container, osservazioni, aggiornato_il)
      SELECT coalesce(nullif(trim(s.material), ''), ''), coalesce(nullif(trim(s.container), ''), ''), count(*)::int, now()
        FROM synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL
       GROUP BY 1, 2
    ON CONFLICT (material, container) DO UPDATE SET osservazioni = EXCLUDED.osservazioni, aggiornato_il = now()`);
  await q(`UPDATE contenitori_synclab c SET osservazioni = 0, aggiornato_il = now() WHERE NOT EXISTS (SELECT 1 FROM synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id AND r.disponibilita = 'ATTIVO'
      WHERE coalesce(nullif(trim(s.material), ''), '') = c.material AND coalesce(nullif(trim(s.container), ''), '') = c.container) AND c.osservazioni <> 0`);
  return { coppie: r.rowCount };
}

export const elencoContenitori = () => many(`SELECT c.*, a.code AS article_code, a.name AS article_name,
    (SELECT count(DISTINCT x.code)::int FROM (${SQL_COPPIE_ESAME}) x WHERE x.material = c.material AND x.container = c.container) AS esami
  FROM contenitori_synclab c LEFT JOIN articles a ON a.id = c.articolo_id ORDER BY c.osservazioni DESC, c.material, c.container`);

/**
 * Per ogni codice esame: la coppia (materiale, contenitore) più frequente, con osservazioni, totale delle righe con un campione e
 * percentuale, l'articolo abbinato alla coppia e la descrizione dal catalogo Synclab. Map codice → { ... }.
 */
export async function coppiePerEsame() {
  const rows = await many(`WITH x AS (${SQL_COPPIE_ESAME}),
      t AS (SELECT code, sum(n)::int AS tot FROM x GROUP BY code),
      top AS (SELECT DISTINCT ON (x.code) x.code, x.material, x.container, x.n FROM x ORDER BY x.code, x.n DESC, x.material, x.container)
    SELECT top.*, t.tot, c.articolo_id, a.name AS article_name,
           (SELECT e.description FROM synclab.exams e WHERE e.disponibilita = 'ATTIVO' AND e.exam_code = top.code ORDER BY e.updated_at DESC LIMIT 1) AS descrizione
      FROM top JOIN t ON t.code = top.code LEFT JOIN contenitori_synclab c ON c.material = top.material AND c.container = top.container LEFT JOIN articles a ON a.id = c.articolo_id`);
  return new Map(rows.map((r) => [r.code, { ...r, pct: r.tot ? Math.round((r.n / r.tot) * 1000) / 10 : null }]));
}

/**
 * Proposta di correlazioni dai contenitori: per gli esami la cui coppia più frequente è abbinata a un articolo.
 * Esiti per esame: NUOVA (nessuna correlazione), CAMBIA (correlazione SYNCLAB verso un altro articolo), INVARIATA (già così),
 * COINCIDE (una correlazione manuale/listino ha già quell'articolo), CONFLITTO (correlazioni manuali/listino verso altri articoli:
 * non si toccano). conferma = true applica NUOVA e CAMBIA.
 */
export async function proponiCorrelazioni({ conferma = false } = {}) {
  const coppie = await coppiePerEsame();
  const esistenti = await many(`SELECT m.id, m.exam_code, m.article_id, m.source, m.active, a.name AS article_name FROM exam_mappings m JOIN articles a ON a.id = m.article_id WHERE m.active`);
  const perCodice = new Map();
  for (const m of esistenti) { if (!perCodice.has(m.exam_code)) perCodice.set(m.exam_code, []); perCodice.get(m.exam_code).push(m); }
  const voci = [];
  for (const [code, c] of coppie) {
    if (!c.articolo_id) continue;
    const ex = perCodice.get(code) || [];
    const prot = ex.filter((m) => m.source !== 'SYNCLAB');
    const syn = ex.filter((m) => m.source === 'SYNCLAB');
    let esito;
    if (prot.some((m) => m.article_id === c.articolo_id)) esito = 'COINCIDE';
    else if (prot.length) esito = 'CONFLITTO';
    else if (syn.some((m) => m.article_id === c.articolo_id) && syn.length === 1) esito = 'INVARIATA';
    else if (syn.length) esito = 'CAMBIA';
    else esito = 'NUOVA';
    voci.push({ exam_code: code, descrizione: c.descrizione, material: c.material, container: c.container, pct: c.pct, osservazioni: c.n, articolo_id: c.articolo_id, articolo: c.article_name,
      attuale: ex.map((m) => `${m.article_name} (${m.source.toLowerCase()})`).join(', ') || null, esito });
  }
  const conta = (e) => voci.filter((v) => v.esito === e).length;
  const sintesi = { nuove: conta('NUOVA'), cambiano: conta('CAMBIA'), invariate: conta('INVARIATA'), coincidono: conta('COINCIDE'), conflitti: conta('CONFLITTO'),
    esami_senza_abbinamento: [...coppie.values()].filter((c) => !c.articolo_id).length };
  if (!conferma) return { anteprima: true, sintesi, voci };
  await tx(async (c) => {
    for (const v of voci.filter((x) => x.esito === 'NUOVA' || x.esito === 'CAMBIA')) {
      await c.query(`DELETE FROM exam_mappings WHERE exam_code = $1 AND source = 'SYNCLAB' AND article_id <> $2`, [v.exam_code, v.articolo_id]);
      await c.query(`INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam, active, source, updated_at) VALUES ($1,$2,$3,1,TRUE,'SYNCLAB',now())
        ON CONFLICT (exam_code, article_id) DO UPDATE SET exam_name = coalesce(EXCLUDED.exam_name, exam_mappings.exam_name), active = TRUE, updated_at = now() WHERE exam_mappings.source = 'SYNCLAB'`,
      [v.exam_code, v.descrizione || null, v.articolo_id]);
    }
  });
  return { anteprima: false, applicate: sintesi.nuove + sintesi.cambiano, sintesi, voci };
}
