// Infrastruttura comune ai moduli travasati dalle app esistenti.
// Ogni modulo ha uno schema PostgreSQL con il suo nome e un pool con search_path = <schema>, public: il codice SQL dell'app
// di origine funziona senza modifiche (le sue tabelle "users", "audit_log", ... risolvono nello schema del modulo, mentre
// le anagrafiche della Suite restano raggiungibili come public.sites, public.users ...).
import pg from 'pg';
import { config } from '../config.js';
import { one, many, q } from '../db.js';
import { HttpError, forbidden } from './util.js';

const pools = {};
export function modulePool(key) {
  if (!/^[a-z_]+$/.test(key)) throw new Error('Nome modulo non valido');
  if (!pools[key]) {
    pools[key] = new pg.Pool({ connectionString: config.databaseUrl, max: 8, options: `-c search_path=${key},public`, application_name: `td-suite-${key}` });
    pools[key].on('error', (e) => console.error(`[module:${key}]`, e.message));
  }
  return pools[key];
}
// Helper nello stile delle app TD (q/one/many/tx) legati allo schema del modulo
export function moduleDb(key) {
  const pool = modulePool(key);
  const run = (text, params) => pool.query(text, params);
  return {
    pool,
    q: run,
    one: async (t, p) => (await run(t, p)).rows[0] || null,
    many: async (t, p) => (await run(t, p)).rows,
    tx: async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } },
  };
}

export async function getModuleState(key) {
  return (await one('SELECT * FROM public.module_state WHERE key=$1', [key])) || { key, mode: 'OFF', schema_ready: false };
}
export async function setModuleState(key, patch, userId) {
  const cols = Object.keys(patch);
  const vals = Object.values(patch);
  await q(`INSERT INTO public.module_state (key, ${cols.join(',')}, updated_by) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}, $${cols.length + 2})
           ON CONFLICT (key) DO UPDATE SET ${cols.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, ...vals, userId || null]);
}

// L'utente del modulo: la riga della tabella users dell'app di origine (nello schema del modulo) che corrisponde all'utente Suite.
// Si cerca per email; se manca viene creata, così le chiavi esterne dell'app (created_by, updated_by, user_id) restano valide.
// Il ruolo è il profilo del grant della Suite; l'ambito (sedi) viene dagli scope del grant tradotti negli id dell'app tramite sites.legacy_refs.
export async function moduleUser(key, suiteUser, { roleColumn = 'role', extraColumns = {} } = {}) {
  const db = moduleDb(key);
  const grant = suiteUser.grants?.[key];
  const isSuiteAdmin = suiteUser.level === 'OWNER' || suiteUser.level === 'ADMIN';
  if (!grant && !isSuiteAdmin) throw forbidden('Modulo non assegnato');
  const role = grant?.profile || extraColumns.defaultAdminRole || 'ADMIN';
  let row = await db.one('SELECT * FROM users WHERE lower(email)=lower($1)', [suiteUser.email]);
  if (!row) {
    const cols = ['email', 'full_name', roleColumn, ...Object.keys(extraColumns.insert || {})];
    const vals = [suiteUser.email, suiteUser.full_name, role, ...Object.values(extraColumns.insert || {})];
    row = await db.one(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  } else if (row[roleColumn] !== role) {
    row = await db.one(`UPDATE users SET ${roleColumn}=$2 WHERE id=$1 RETURNING *`, [row.id, role]);
  }
  // Ambito: id delle sedi dell'app di origine corrispondenti agli scope SITE del grant
  const siteIds = (grant?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id));
  const legacySiteIds = siteIds.length
    ? (await many(`SELECT legacy_refs->>$2 AS ref FROM public.sites WHERE id = ANY($1::int[]) AND legacy_refs ? $2`, [siteIds, key])).map((r) => (/^\d+$/.test(r.ref) ? Number(r.ref) : r.ref))
    : [];
  // site_ids: id delle sedi dell'anagrafica unica (public.sites) negli scope del grant. I moduli sull'anagrafica unica usano questi;
  // legacy_site_ids resta per i moduli non ancora convertiti (id della sede nell'app di origine)
  return { ...row, first_name: suiteUser.first_name, last_name: suiteUser.last_name, role, suite_user_id: suiteUser.id, suite_level: suiteUser.level, person_id: suiteUser.person_id || null, site_ids: siteIds, legacy_site_ids: legacySiteIds, active: true };
}

// Middleware: il modulo deve essere in MIRROR o LIVE e l'utente deve averne il grant; prepara req.moduleUser
export const requireModuleReady = (key, opts) => async (req, _res, next) => {
  try {
    const st = await getModuleState(key);
    if (st.mode === 'OFF' || !st.schema_ready) return next(Object.assign(new HttpError(503, 'Modulo non ancora travasato nella Suite'), { code: 'MODULE_OFF' }));
    req.moduleUser = await moduleUser(key, req.user, opts);
    req.moduleMode = st.mode;
    next();
  } catch (e) { next(e); }
};

// In modalità MIRROR le scritture sono bloccate: i dati arrivano dall'app di origine e verrebbero sovrascritti dalla copia successiva
export const blockWritesInMirror = (req, _res, next) => {
  if (req.moduleMode === 'MIRROR' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next(Object.assign(new HttpError(423, 'Modulo in sola lettura: fino al passaggio definitivo le modifiche si fanno nell\'app originale'), { code: 'MODULE_MIRROR' }));
  }
  next();
};

// Moduli già dentro la Suite (MIRROR o LIVE): i collegamenti aprono /<key> invece dell'app originale
export async function activeModuleKeys() {
  const r = await q(`SELECT key, mode FROM module_state WHERE mode IN ('MIRROR','LIVE')`);
  return new Map(r.rows.map((x) => [x.key, x.mode]));
}
export function moduleHref(m, active) {
  if (m.kind === 'NATIVE') return m.route || '/';
  return active?.has(m.key) ? `/${m.key}` : `/go/${m.key}`;
}
