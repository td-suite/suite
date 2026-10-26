// Travaso di un'app esistente nella Suite: schema dedicato, migrazioni originali, copia completa dei dati dal database di origine.
// Ripetibile: ogni esecuzione svuota e ricopia le tabelle (modalità MIRROR) finché il modulo non passa a LIVE; da LIVE il job si rifiuta di copiare.
// Sola lettura verso l'origine (legacyQuery accetta solo SELECT), scrittura solo nello schema del modulo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q, one } from '../db.js';
import { legacyQuery, legacyQueryLong, sourceEnabled, resetSource } from './legacy.js';
import { getModuleState, setModuleState, modulePool } from './modules.js';
import { LEGACY_KEYS } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulesDir = path.join(here, '..', 'modules');
const running = new Set();

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

// Migrazioni dell'app di origine, copiate in server/src/modules/<key>/migrations, applicate nello schema del modulo
async function ensureSchema(key) {
  const dir = path.join(modulesDir, key, 'migrations');
  if (!fs.existsSync(dir)) throw new Error(`Modulo "${key}": cartella migrations assente (server/src/modules/${key}/migrations)`);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${ident(key)}`);
  const c = await modulePool(key).connect();   // search_path = <key>, public per tutta la connessione
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS ${ident(key)}.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
    const done = new Set((await c.query(`SELECT name FROM ${ident(key)}.schema_migrations`)).rows.map((r) => r.name));
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query(`INSERT INTO ${ident(key)}.schema_migrations(name) VALUES ($1)`, [f]);
        await c.query('COMMIT');
        console.log(`[migrate] ${key}: applicata ${f}`);
      } catch (e) { await c.query('ROLLBACK'); throw new Error(`Migrazione ${key}/${f}: ${e.message}`); }
    }
    // Chiavi esterne differibili: la copia avviene in un'unica transazione senza dipendere dall'ordine delle tabelle
    const fks = await c.query(`SELECT conname, conrelid::regclass AS tbl FROM pg_constraint WHERE contype='f' AND connamespace = $1::regnamespace AND NOT condeferrable`, [key]);
    for (const r of fks.rows) await c.query(`ALTER TABLE ${r.tbl} ALTER CONSTRAINT ${ident(r.conname)} DEFERRABLE INITIALLY DEFERRED`);
  } finally { c.release(); }
}

// Tabelle dell'origine (schema public) che esistono anche nello schema del modulo: solo queste vengono copiate
async function tablesToCopy(key) {
  const src = (await legacyQuery(key, `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).map((r) => r.table_name);
  const dst = new Set((await q(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'`, [key])).rows.map((r) => r.table_name));
  const skip = new Set(['session', 'schema_migrations']);
  return src.filter((t) => dst.has(t) && !skip.has(t));
}

// Colonne del modulo che referenziano l'anagrafica unica (public.sites, public.people, public.users): i valori dell'app di origine
// vengono tradotti con i riferimenti legacy salvati dalla sincronizzazione (legacy_refs->><modulo>).
const UNIFIED = { sites: 'sites', people: 'people', users: 'users' };
async function unifiedRefs(key, table) {
  const rows = (await q(`SELECT kcu.column_name, ccu.table_name AS ref_table, col.is_nullable
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      JOIN information_schema.columns col ON col.table_schema = tc.table_schema AND col.table_name = tc.table_name AND col.column_name = kcu.column_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2 AND ccu.table_schema='public' AND ccu.table_name = ANY($3::text[])`, [key, table, Object.keys(UNIFIED)])).rows;
  return new Map(rows.map((r) => [r.column_name, { ref: r.ref_table, nullable: r.is_nullable === 'YES' }]));
}
const mapCache = new Map();
async function legacyMap(key, refTable) {
  const ck = `${key}:${refTable}`;
  if (!mapCache.has(ck)) {
    const rows = (await q(`SELECT id, legacy_refs->>$1 AS ref FROM public.${ident(refTable)} WHERE legacy_refs ? $1`, [key])).rows;
    mapCache.set(ck, new Map(rows.map((r) => [String(r.ref), r.id])));
  }
  return mapCache.get(ck);
}

async function columnsOf(key, table) {
  const src = (await legacyQuery(key, `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]));
  const dst = new Map((await q(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`, [key, table])).rows.map((r) => [r.column_name, r]));
  const refs = await unifiedRefs(key, table);
  // tipo di destinazione: decide la serializzazione (json/jsonb → JSON.stringify; array → valore JS; bytea → Buffer; resto → valore)
  const cols = src.filter((c) => dst.has(c.column_name)).map((c) => ({ name: c.column_name, dstType: dst.get(c.column_name).data_type, dstUdt: dst.get(c.column_name).udt_name, unified: refs.get(c.column_name) || null }));
  for (const c of cols) if (c.unified) c.map = await legacyMap(key, c.unified.ref);
  return cols;
}
function serialize(col, v) {
  if (v === null || v === undefined) return null;
  if (col.dstType === 'json' || col.dstType === 'jsonb') return JSON.stringify(v);
  if (col.dstType === 'ARRAY') return Array.isArray(v) ? v : (typeof v === 'string' && v.startsWith('[') ? JSON.parse(v) : v);
  return v;
}

// Copia a lotti: SELECT dall'origine (ordinata per chiave primaria se esiste), INSERT multiriga nello schema del modulo.
// Tabelle con colonne bytea (allegati, PDF): lotti piccoli e connessione con timeout lunghi, per non saturare memoria e tempo
async function copyTable(client, key, table, stats) {
  const cols = await columnsOf(key, table);
  if (!cols.length) return;
  const pk = (await legacyQuery(key, `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ('public.' || quote_ident($1))::regclass AND i.indisprimary ORDER BY a.attnum LIMIT 1`, [table]))[0]?.attname;
  const heavy = cols.some((c) => c.dstType === 'bytea') || ['struttura_blobs', 'struttura_history', 'attachments', 'contract_files', 'dossier_files', 'request_attachments', 'generated_documents', 'nc_allegati', 'professionista_docs'].includes(table);
  const colList = cols.map((c) => ident(c.name)).join(', ');
  const target = `${ident(key)}.${ident(table)}`;
  const BATCH = heavy ? 20 : 500;
  let offset = 0, n = 0;
  for (;;) {
    const rows = await legacyQueryLong(key, `SELECT ${colList} FROM public.${ident(table)} ${pk ? `ORDER BY ${ident(pk)}` : ''} LIMIT ${BATCH} OFFSET ${offset}`);
    if (!rows.length) break;
    const values = []; const params = [];
    for (const r of rows) {
      // traduzione dei riferimenti all'anagrafica unica: id dell'app di origine → id della Suite; riga scartata se il riferimento
      // obbligatorio non ha corrispondenza (la sede o la persona vanno prima riconciliate in Amministrazione)
      let drop = false;
      const vals = cols.map((c) => {
        let v = r[c.name];
        if (c.unified && v != null) { const m = c.map.get(String(v)); if (m == null && !c.unified.nullable) drop = true; v = m ?? null; }
        return serialize(c, v);
      });
      if (drop) { stats.__scartate = (stats.__scartate || {}); stats.__scartate[table] = (stats.__scartate[table] || 0) + 1; continue; }
      const ph = vals.map((v) => { params.push(v); return `$${params.length}`; });
      values.push(`(${ph.join(',')})`);
    }
    if (values.length) await client.query(`INSERT INTO ${target} (${colList}) VALUES ${values.join(',')}`, params);
    n += values.length; offset += rows.length;
    if (rows.length < BATCH) break;
  }
  stats[table] = n;
}


async function resetSequences(client, key) {
  const seqs = await client.query(`SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col FROM pg_class s JOIN pg_depend d ON d.objid=s.oid JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid JOIN pg_namespace n ON n.oid=s.relnamespace WHERE s.relkind='S' AND n.nspname=$1`, [key]);
  for (const r of seqs.rows) {
    await client.query(`SELECT setval($1::regclass, COALESCE((SELECT MAX(${ident(r.col)}) FROM ${ident(key)}.${ident(r.tbl)}), 0) + 1, false)`, [`${ident(key)}.${ident(r.seq)}`]);
  }
}

// All'avvio del server: le migrazioni nuove dei moduli con schema già creato (MIRROR o LIVE) si applicano subito, come quelle
// della Suite. Senza questo passo una migrazione aggiunta a un modulo LIVE non arriverebbe mai al database.
export async function applyModuleMigrations() {
  const rows = (await q(`SELECT key FROM public.module_state WHERE schema_ready ORDER BY key`)).rows;
  for (const { key } of rows) {
    if (!fs.existsSync(path.join(modulesDir, key, 'migrations'))) continue;
    try { await ensureSchema(key); }
    catch (e) { console.error(`[migrate] ${key}:`, e.message); throw e; }
  }
}

// Moduli sull'anagrafica unica: partono vuoti (schema creato, subito LIVE), nessuna copia dall'app di origine
export const FRESH_MODULES = ['cash', 'room', 'nc', 'orders', 'retail', 'contracts', 'business', 'integration'];
export async function startFresh(key, userId) {
  if (!FRESH_MODULES.includes(key)) throw new Error('Questo modulo si avvia con il travaso dei dati');
  const st = await getModuleState(key);
  if (st.mode === 'LIVE') throw new Error('Il modulo è già attivo');
  await ensureSchema(key);
  await modulePool(key).query(`ANALYZE`).catch(() => {});
  await setModuleState(key, { schema_ready: true, mode: 'LIVE', live_since: new Date(), last_copy_at: null, last_copy_stats: JSON.stringify({ fresh: true }), last_error: null }, userId);
  return { ok: true, fresh: true };
}

export async function runTravaso(key, userId) {
  if (!LEGACY_KEYS.includes(key)) throw new Error('Modulo sconosciuto');
  if (FRESH_MODULES.includes(key)) return startFresh(key, userId);
  if (!sourceEnabled(key)) throw new Error('Sorgente non collegata: imposta prima la connessione in Sorgenti legacy');
  const st = await getModuleState(key);
  if (st.mode === 'LIVE') throw new Error('Il modulo è LIVE: la copia dall\'app originale è disattivata per non sovrascrivere i dati della Suite');
  if (running.has(key)) throw new Error('Travaso già in corso');
  running.add(key);
  const t0 = Date.now();
  try {
    await ensureSchema(key);
    await setModuleState(key, { schema_ready: true }, userId);
    const tables = await tablesToCopy(key);
    const stats = {};
    const client = await modulePool(key).connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      // svuotamento in un solo comando: le chiavi esterne tra tabelle del modulo non bloccano (CASCADE resta dentro lo schema)
      if (tables.length) await client.query(`TRUNCATE ${tables.map((t) => `${ident(key)}.${ident(t)}`).join(', ')} CASCADE`);
      for (const t of tables) await copyTable(client, key, t, stats);
      // passo del modulo (es. riempimento di site_ext / person_ext dall'origine), nella stessa transazione
      try {
        const mod = await import(`../modules/${key}/index.js`);
        if (typeof mod.afterTravaso === 'function') await mod.afterTravaso(client, key, { legacyQuery: (sql, params) => legacyQueryLong(key, sql, params), legacyMap: (refTable) => legacyMap(key, refTable), stats });
      } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
      await resetSequences(client, key);
      await client.query('COMMIT');
      await client.query('ANALYZE').catch(() => {});
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    const ms = Date.now() - t0;
    const scartate = stats.__scartate || {}; delete stats.__scartate;
    mapCache.clear();
    const rowsN = Object.values(stats).reduce((a, b) => a + b, 0);
    await setModuleState(key, { mode: st.mode === 'OFF' ? 'MIRROR' : st.mode, last_copy_at: new Date(), last_copy_ms: ms, last_copy_stats: JSON.stringify({ tables: stats, rows: rowsN, scartate }), last_error: null }, userId);
    return { ok: true, tables: Object.keys(stats).length, rows: rowsN, ms, stats, scartate };
  } catch (e) {
    mapCache.clear();
    await setModuleState(key, { last_error: e.message }, userId).catch(() => {});
    throw e;
  } finally { running.delete(key); }
}

// Confronto conteggi origine / Suite, per il collaudo con i referenti
export async function compareCounts(key) {
  const st = await getModuleState(key);
  const tables = await tablesToCopy(key);
  const out = [];
  for (const t of tables) {
    const a = (await legacyQuery(key, `SELECT count(*)::int AS n FROM public.${ident(t)}`))[0].n;
    const b = (await one(`SELECT count(*)::int AS n FROM ${ident(key)}.${ident(t)}`)).n;
    // la tabella users del modulo cresce quando un utente Suite entra per la prima volta: differenza attesa, non blocca
    const scart = Number(st.last_copy_stats?.scartate?.[t] || 0);
    out.push({ table: t, origine: a, suite: b, scartate: scart || undefined, ok: a === b || t === 'users' || a === b + scart, nota: t === 'users' && a !== b ? 'utenti Suite aggiunti al primo accesso' : scart ? `${scart} righe senza sede o persona riconciliata` : undefined });
  }
  return out;
}

export async function goLive(key, userId) {
  const st = await getModuleState(key);
  if (st.mode === 'LIVE') return;   // i moduli che partono vuoti sono già LIVE dall'avvio
  if (!st.schema_ready || !st.last_copy_at) throw new Error('Esegui almeno un travaso prima del passaggio definitivo');
  // ultimo travaso immediatamente prima del passaggio: nulla di inserito nell'app originale nel frattempo va perso
  await runTravaso(key, userId);
  const diff = (await compareCounts(key)).filter((r) => !r.ok);
  if (diff.length) throw new Error(`Conteggi non allineati (${diff.map((d) => `${d.table}: ${d.origine} vs ${d.suite}`).join(', ')}): esegui un ultimo travaso e riprova`);
  await setModuleState(key, { mode: 'LIVE', live_since: new Date() }, userId);
  // La sorgente legacy resta collegata per il cockpit storico finché non viene scollegata dal titolare
  return { ok: true };
}

export async function backToMirror(key, userId) {
  await setModuleState(key, { mode: 'MIRROR', live_since: null }, userId);
  await resetSource(key).catch(() => {});
  return { ok: true };
}

export const isRunning = (key) => running.has(key);
