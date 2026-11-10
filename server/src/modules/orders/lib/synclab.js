// Ordini e Magazzino · fonte Synclab (copia locale della Data API, schema synclab del core; v0.67.1, richieste del CEO dopo il primo
// completo in produzione). Due usi, entrambi in sola lettura della copia:
//  1. PRODUZIONE: per ogni struttura abbinata (client Synclab → synclab.clients_td.site_id / organization_id → struttura del modulo:
//     sede TD = id della sede, punto SERVICE = id del punto, letto dalla sua Legal entity con productionStrutture; solo Legal entity =
//     opposto dell'id) conteggio per mese e codice esame delle righe d'esame NON cancellate delle accettazioni ATTIVE; upsert in
//     production con source 'STUDIOLAB'. Regola: una riga MANUALE o IMPORT dello stesso mese ed esame VINCE (non si sovrascrive). Si
//     ricalcolano tutti i mesi presenti nella copia (il mese in corso compreso) e si tolgono le righe STUDIOLAB di quei mesi che la copia
//     non conferma più (esami cancellati); le righe dei mesi senza dati Synclab (es. HL7 di prima) restano.
//  2. ETICHETTE (v0.68.4, prima coppie materiale/contenitore): testo dell'etichetta dei campioni (synclab.samples.container, legati alle
//     righe con request_item_samples) e, in seconda battuta, del catalogo ServiceNET (exam_catalog.label_text); una riga per etichetta in
//     etichette_synclab, abbinata a un articolo di magazzino. L'etichetta più frequente di un esame, abbinata, propone la correlazione
//     esame → articolo (fonte SYNCLAB) senza toccare le correlazioni MANUALE o LISTINO.
//  3. PRODUZIONE PER ARTICOLO (v0.68.4): pivot dei CAMPIONI per mese ed etichetta → articolo (un campione = un contenitore), usata dalla
//     pagina Produzione e dal consumo medio mensile (lib/studiolab.js consumptionByArticle) al posto di esami × correlazione.
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

// ------------------------------------------------------------------ etichette e correlazioni (v0.68.4)
// Chiave = TESTO DELL'ETICHETTA del campione (synclab.samples.container: è il campo con cui la Data API espone contenitore/etichetta),
// senza spazi doppi e in maiuscolo; in seconda battuta il testo delle etichette dell'esame letto da ServiceNET (exam_catalog.label_text,
// /api/esami con IncludiEtichette). Il materiale biologico (SIERO, PLASMA…) resta solo come informazione secondaria, mai chiave.
export const SEP_ETICHETTE = ' | ';
/** Chiave di un testo di etichetta (stessa regola dell'SQL CHIAVE e della migrazione 017). */
export const chiaveEtichetta = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const CHIAVE = (col) => `upper(regexp_replace(btrim(coalesce(${col}, '')), '\\s+', ' ', 'g'))`;
const TESTO = (col) => `regexp_replace(btrim(coalesce(${col}, '')), '\\s+', ' ', 'g')`;
// campioni delle accettazioni attive (una riga = un campione = un contenitore)
const CAMPIONI_ATTIVI = `synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL`;

// righe d'esame non cancellate legate ai campioni: per esame ed etichetta, con il materiale più visto (informazione secondaria)
const SQL_ETICHETTE_ESAME = `
  SELECT trim(i.exam_code) AS code, ${CHIAVE('s.container')} AS chiave, max(${TESTO('s.container')}) AS testo, count(*)::int AS n,
         mode() WITHIN GROUP (ORDER BY nullif(trim(s.material), '')) AS materiale
    FROM synclab.request_items i
    JOIN synclab.requests r ON r.instance_id = i.instance_id AND r.id = i.request_id AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL
    JOIN synclab.request_item_samples l ON l.instance_id = i.instance_id AND l.request_id = i.request_id AND l.item_id = i.id
    JOIN synclab.samples s ON s.instance_id = l.instance_id AND s.request_id = l.request_id AND s.id = l.sample_id
   WHERE coalesce(i.deleted, FALSE) = FALSE AND coalesce(trim(i.exam_code), '') <> ''
   GROUP BY 1, 2`;

/** Etichette di ServiceNET per esame: [{ code, chiave, testo }] da exam_catalog.label_text (più etichette separate da " | "). */
async function etichetteServiceNet() {
  const rows = await many(`SELECT code, label_text FROM exam_catalog WHERE coalesce(btrim(label_text), '') <> ''`);
  const out = [];
  for (const r of rows) for (const t of String(r.label_text).split(SEP_ETICHETTE)) { const testo = t.trim().replace(/\s+/g, ' '); if (testo) out.push({ code: r.code, chiave: chiaveEtichetta(testo), testo }); }
  return out;
}

/**
 * Aggiorna etichette_synclab: una riga per testo di etichetta visto nei campioni delle accettazioni attive (campioni, materiali come
 * informazione secondaria); poi le etichette del catalogo ServiceNET non viste nei campioni (fonte SERVICENET, 0 campioni). Le
 * etichette non più viste tornano a 0 campioni. L'abbinamento all'articolo resta sempre.
 */
export async function aggiornaEtichette() {
  return tx(async (c) => {
    const r = await c.query(`WITH x AS (
        SELECT ${CHIAVE('s.container')} AS chiave, ${TESTO('s.container')} AS testo, nullif(trim(s.material), '') AS materiale FROM ${CAMPIONI_ATTIVI}),
      g AS (SELECT chiave, count(*)::int AS campioni FROM x GROUP BY chiave),
      t AS (SELECT DISTINCT ON (chiave) chiave, testo FROM (SELECT chiave, testo, count(*) AS n FROM x GROUP BY 1, 2) y ORDER BY chiave, n DESC, testo),
      m AS (SELECT chiave, string_agg(materiale || ' ' || n, ', ' ORDER BY n DESC, materiale) AS materiali FROM (SELECT chiave, materiale, count(*) AS n FROM x WHERE materiale IS NOT NULL GROUP BY 1, 2) y GROUP BY chiave)
      INSERT INTO etichette_synclab (chiave, etichetta, campioni, materiali, fonte, aggiornato_il)
      SELECT g.chiave, t.testo, g.campioni, m.materiali, 'CAMPIONI', now() FROM g JOIN t USING (chiave) LEFT JOIN m USING (chiave)
      ON CONFLICT (chiave) DO UPDATE SET etichetta = EXCLUDED.etichetta, campioni = EXCLUDED.campioni, materiali = EXCLUDED.materiali, fonte = 'CAMPIONI', aggiornato_il = now()
      RETURNING chiave`);
    const viste = r.rows.map((x) => x.chiave);
    await c.query(`UPDATE etichette_synclab SET campioni = 0, aggiornato_il = now() WHERE campioni <> 0 AND NOT (chiave = ANY($1::text[]))`, [viste]);
    // seconda fonte: etichette dal catalogo ServiceNET (solo testi non visti nei campioni)
    const sn = (await etichetteServiceNet()).filter((e) => !viste.includes(e.chiave));
    const uniche = [...new Map(sn.map((e) => [e.chiave, e])).values()];
    for (const e of uniche) {
      await c.query(`INSERT INTO etichette_synclab (chiave, etichetta, campioni, fonte, aggiornato_il) VALUES ($1, $2, 0, 'SERVICENET', now())
        ON CONFLICT (chiave) DO UPDATE SET fonte = 'SERVICENET', aggiornato_il = now() WHERE etichette_synclab.campioni = 0`, [e.chiave, e.testo]);
    }
    return { etichette: viste.length + uniche.length, da_campioni: viste.length, da_servicenet: uniche.length };
  });
}

/** Esami che usano ogni etichetta: Map chiave → [{ code, n, fonte }] (campioni prima, poi catalogo ServiceNET). */
async function esamiPerEtichetta() {
  const map = new Map();
  const add = (k, v) => { if (!map.has(k)) map.set(k, []); if (!map.get(k).some((x) => x.code === v.code)) map.get(k).push(v); };
  for (const x of await many(`SELECT code, chiave, n FROM (${SQL_ETICHETTE_ESAME}) x ORDER BY n DESC, code`)) add(x.chiave, { code: x.code, n: x.n, fonte: 'CAMPIONI' });
  for (const e of await etichetteServiceNet()) add(e.chiave, { code: e.code, n: null, fonte: 'SERVICENET' });
  return map;
}

/** Elenco per la pagina Correlazioni: etichetta, campioni, esami che la usano (numero e primi codici con descrizione), articolo abbinato. */
export async function elencoEtichette() {
  const rows = await many(`SELECT e.*, a.code AS article_code, a.name AS article_name FROM etichette_synclab e LEFT JOIN articles a ON a.id = e.articolo_id
    ORDER BY e.campioni DESC, e.etichetta`);
  const esami = await esamiPerEtichetta();
  const codici = [...new Set([...esami.values()].flat().map((x) => x.code))];
  const descr = new Map((await many(`SELECT DISTINCT ON (trim(exam_code)) trim(exam_code) AS code, description FROM synclab.exams WHERE disponibilita = 'ATTIVO' AND trim(exam_code) = ANY($1::text[]) ORDER BY trim(exam_code), updated_at DESC`, [codici])).map((x) => [x.code, x.description]));
  const cat = new Map((await many(`SELECT code, description FROM exam_catalog WHERE code = ANY($1::text[])`, [codici])).map((x) => [x.code, x.description]));
  return rows.map((r) => { const l = esami.get(r.chiave) || []; return { ...r, esami: l.length, esami_elenco: l.slice(0, 12).map((x) => ({ ...x, descrizione: descr.get(x.code) || cat.get(x.code) || null })) }; });
}

/**
 * Per ogni codice esame: l'etichetta più frequente nei campioni (osservazioni, totale delle righe con un campione, percentuale) e
 * l'articolo abbinato; per gli esami senza campioni la prima etichetta del catalogo ServiceNET. Map codice → { ... }.
 */
export async function etichettePerEsame() {
  const rows = await many(`WITH x AS (${SQL_ETICHETTE_ESAME}),
      t AS (SELECT code, sum(n)::int AS tot FROM x GROUP BY code),
      top AS (SELECT DISTINCT ON (x.code) x.code, x.chiave, x.testo, x.n, x.materiale FROM x ORDER BY x.code, x.n DESC, x.chiave)
    SELECT top.*, t.tot, coalesce(e.etichetta, top.testo) AS etichetta, e.articolo_id, a.name AS article_name,
           (SELECT d.description FROM synclab.exams d WHERE d.disponibilita = 'ATTIVO' AND d.exam_code = top.code ORDER BY d.updated_at DESC LIMIT 1) AS descrizione
      FROM top JOIN t ON t.code = top.code LEFT JOIN etichette_synclab e ON e.chiave = top.chiave LEFT JOIN articles a ON a.id = e.articolo_id`);
  const out = new Map(rows.map((r) => [r.code, { ...r, fonte: 'CAMPIONI', pct: r.tot ? Math.round((r.n / r.tot) * 1000) / 10 : null }]));
  const sn = (await etichetteServiceNet()).filter((e) => !out.has(e.code));
  if (sn.length) {
    const et = new Map((await many(`SELECT e.chiave, e.etichetta, e.articolo_id, a.name AS article_name FROM etichette_synclab e LEFT JOIN articles a ON a.id = e.articolo_id WHERE e.chiave = ANY($1::text[])`, [sn.map((e) => e.chiave)])).map((x) => [x.chiave, x]));
    const cat = new Map((await many(`SELECT code, description FROM exam_catalog WHERE code = ANY($1::text[])`, [sn.map((e) => e.code)])).map((x) => [x.code, x.description]));
    for (const e of sn) {
      if (out.has(e.code)) continue;
      const r = et.get(e.chiave);
      out.set(e.code, { code: e.code, chiave: e.chiave, testo: e.testo, etichetta: r?.etichetta || e.testo, n: null, tot: null, pct: null, materiale: null, articolo_id: r?.articolo_id || null, article_name: r?.article_name || null, descrizione: cat.get(e.code) || null, fonte: 'SERVICENET' });
    }
  }
  return out;
}

/**
 * Proposta di correlazioni dalle etichette: per gli esami la cui etichetta più frequente è abbinata a un articolo.
 * Esiti per esame: NUOVA (nessuna correlazione), CAMBIA (correlazione SYNCLAB verso un altro articolo), INVARIATA (già così),
 * COINCIDE (una correlazione manuale/listino ha già quell'articolo), CONFLITTO (correlazioni manuali/listino verso altri articoli:
 * non si toccano). conferma = true applica NUOVA e CAMBIA.
 */
export async function proponiCorrelazioni({ conferma = false } = {}) {
  const etichette = await etichettePerEsame();
  const esistenti = await many(`SELECT m.id, m.exam_code, m.article_id, m.source, m.active, a.name AS article_name FROM exam_mappings m JOIN articles a ON a.id = m.article_id WHERE m.active`);
  const perCodice = new Map();
  for (const m of esistenti) { if (!perCodice.has(m.exam_code)) perCodice.set(m.exam_code, []); perCodice.get(m.exam_code).push(m); }
  const voci = [];
  for (const [code, c] of etichette) {
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
    voci.push({ exam_code: code, descrizione: c.descrizione, etichetta: c.etichetta, materiale: c.materiale, fonte_etichetta: c.fonte, pct: c.pct, osservazioni: c.n, articolo_id: c.articolo_id, articolo: c.article_name,
      attuale: ex.map((m) => `${m.article_name} (${m.source.toLowerCase()})`).join(', ') || null, esito });
  }
  const conta = (e) => voci.filter((v) => v.esito === e).length;
  const sintesi = { nuove: conta('NUOVA'), cambiano: conta('CAMBIA'), invariate: conta('INVARIATA'), coincidono: conta('COINCIDE'), conflitti: conta('CONFLITTO'),
    esami_senza_abbinamento: [...etichette.values()].filter((c) => !c.articolo_id).length };
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

// ------------------------------------------------------------------ produzione per articolo dai campioni (v0.68.4)
// Un campione = un contenitore consumato, anche quando serve più esami: la pivot conta i CAMPIONI delle accettazioni attive dei client
// abbinati alla struttura (stessa regola di SQL_PRODUZIONE: sede → id della sede, Legal entity → −id, punti SERVICE sommati dalla Legal
// entity con productionStrutture), per mese (requests.date) ed etichetta, e li porta sull'articolo abbinato all'etichetta. Calcolo a
// richiesta sulla copia (nessuna tabella): un abbinamento cambiato vale subito, senza aspettare il job orario.
const SQL_CAMPIONI_STRUTTURA = `
  WITH m AS (SELECT instance_id, client_id, CASE WHEN site_id IS NOT NULL THEN site_id ELSE -organization_id END AS sid FROM synclab.clients_td WHERE site_id IS NOT NULL OR organization_id IS NOT NULL),
  x AS (
    SELECT date_trunc('month', r.date)::date AS month, ${CHIAVE('s.container')} AS chiave, max(${TESTO('s.container')}) AS testo, count(*)::int AS n
      FROM synclab.samples s JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id
      JOIN m ON m.instance_id = r.instance_id AND m.client_id = r.client_id
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date IS NOT NULL AND m.sid = ANY($1::int[]) AND ($2::date IS NULL OR r.date >= $2::date)
     GROUP BY 1, 2)
  SELECT to_char(x.month, 'YYYY-MM') AS mese, x.chiave, coalesce(e.etichetta, x.testo) AS etichetta, x.n, e.articolo_id, a.code AS article_code, a.name AS article_name, a.pack_size, a.pack_label, a.unit
    FROM x LEFT JOIN etichette_synclab e ON e.chiave = x.chiave LEFT JOIN articles a ON a.id = e.articolo_id`;

/** Campioni per mese ed etichetta (con l'articolo abbinato) delle strutture ids, dal mese `dal` (AAAA-MM-01) o da sempre. */
export const campioniStruttura = (ids, dal = null) => many(SQL_CAMPIONI_STRUTTURA, [ids.map(Number), dal]);

const r1 = (v) => Math.round(v * 10) / 10;
/**
 * Pivot per articolo (funzione pura): righe { mese, chiave, etichetta, n, articolo_id, article_name, … } → colonne = mesi con campioni
 * (dal più recente), una riga per articolo con quantità = campioni, totale e media mensile (totale / mesi con campioni), le etichette
 * che la compongono; le etichette non abbinate a un articolo in una riga a parte con il dettaglio per etichetta.
 */
export function componiPivot(righe) {
  const mesi = [...new Set(righe.map((x) => x.mese))].sort().reverse();
  const nM = mesi.length;
  const art = new Map(); const non = new Map();
  for (const x of righe) {
    if (x.articolo_id) {
      const a = art.get(x.articolo_id) || { article_id: x.articolo_id, code: x.article_code, name: x.article_name, pack_size: x.pack_size, pack_label: x.pack_label, unit: x.unit, mesi: {}, totale: 0, etichette: new Map() };
      a.mesi[x.mese] = (a.mesi[x.mese] || 0) + x.n; a.totale += x.n;
      a.etichette.set(x.chiave, { etichetta: x.etichetta, totale: (a.etichette.get(x.chiave)?.totale || 0) + x.n });
      art.set(x.articolo_id, a);
    } else {
      const e = non.get(x.chiave) || { chiave: x.chiave, etichetta: x.etichetta, mesi: {}, totale: 0 };
      e.mesi[x.mese] = (e.mesi[x.mese] || 0) + x.n; e.totale += x.n;
      non.set(x.chiave, e);
    }
  }
  const articoli = [...art.values()].map((a) => ({ ...a, media: nM ? r1(a.totale / nM) : 0, confezioni_mese: nM && a.pack_size ? Math.round((a.totale / nM / a.pack_size) * 100) / 100 : null,
    etichette: [...a.etichette.values()].sort((p, q) => q.totale - p.totale) })).sort((p, q) => q.totale - p.totale || String(p.name).localeCompare(String(q.name)));
  const etNon = [...non.values()].map((e) => ({ ...e, media: nM ? r1(e.totale / nM) : 0 })).sort((p, q) => q.totale - p.totale || p.etichetta.localeCompare(q.etichetta));
  const nonMesi = {}; for (const e of etNon) for (const [m, v] of Object.entries(e.mesi)) nonMesi[m] = (nonMesi[m] || 0) + v;
  const totNon = etNon.reduce((s, e) => s + e.totale, 0);
  return { mesi, articoli, non_abbinate: { mesi: nonMesi, totale: totNon, media: nM ? r1(totNon / nM) : 0, etichette: etNon },
    campioni: articoli.reduce((s, a) => s + a.totale, 0) + totNon };
}

/** Pivot della pagina Produzione per una struttura (ids da productionStrutture) sugli ultimi `months` mesi più il mese in corso. */
export async function pivotArticoli(ids, months = 6) {
  const disp = await synclabDisponibile();
  if (!disp.ok) return { disponibile: false, motivo: disp.motivo, ...componiPivot([]) };
  const dal = (await one(`SELECT (date_trunc('month', now()) - ($1 || ' months')::interval)::date AS d`, [String(months)])).d;
  return { disponibile: true, motivo: null, ...componiPivot(await campioniStruttura(ids, dal)) };
}

/**
 * Consumo medio mensile per articolo dai campioni (per consumptionByArticle): ultimi `months` mesi con campioni della struttura.
 * Ritorna null se Synclab non è disponibile o la struttura non ha campioni nella copia (si ricade su esami × correlazione); altrimenti
 * { map: article_id → { units, packs, months, fonte: 'CAMPIONI', detail }, months, articoliEtichetta: Set degli articoli abbinati a
 * un'etichetta (per questi il consumo viene SOLO dai campioni) }.
 */
export async function consumoDaCampioni(ids, months = 3) {
  const disp = await synclabDisponibile();
  if (!disp.ok) return null;
  const righe = await campioniStruttura(ids, null);
  if (!righe.length) return null;
  const mesi = [...new Set(righe.map((x) => x.mese))].sort().reverse().slice(0, Math.max(1, Number(months) || 3));
  const nM = mesi.length;
  const map = new Map();
  for (const x of righe) {
    if (!x.articolo_id || !mesi.includes(x.mese)) continue;
    const a = map.get(x.articolo_id) || { tot: 0, pack_size: x.pack_size, detail: [] };
    a.tot += x.n; a.detail.push({ etichetta: x.etichetta, month: `${x.mese}-01`, qty: x.n });
    map.set(x.articolo_id, a);
  }
  const out = new Map();
  for (const [id, a] of map) {
    const units = a.tot / nM;
    out.set(id, { units: Math.round(units * 100) / 100, packs: Math.round((units / (a.pack_size || 1)) * 100) / 100, months: nM, fonte: 'CAMPIONI',
      detail: a.detail.sort((p, q) => q.month.localeCompare(p.month) || p.etichetta.localeCompare(q.etichetta)) });
  }
  const articoliEtichetta = new Set((await many(`SELECT DISTINCT articolo_id FROM etichette_synclab WHERE articolo_id IS NOT NULL`)).map((x) => x.articolo_id));
  return { map: out, months: nM, articoliEtichetta };
}
