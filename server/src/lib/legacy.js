// Suite TD · sorgenti legacy (database delle dieci app esistenti), SOLA LETTURA.
// - un pool per sorgente (max 3 connessioni, statement_timeout 15 s, sessione read only)
// - sincronizzazione utenti, sedi, organizzazioni e persone verso l'anagrafica unica della Suite
// - contatori dei widget e card del Cockpit, con cache di 5 minuti
// Nessuna istruzione di scrittura viene mai inviata ai database legacy: legacyQuery accetta solo SELECT/WITH.
import pg from 'pg';
import crypto from 'node:crypto';
import { config, LEGACY_KEYS } from '../config.js';
import { one, many, q } from '../db.js';
import { normName } from './util.js';
import { MODULES, LEGACY_ROLE_MAP, AREA_GRANT_PROPOSALS } from '../seed/modules.js';

// Una descrizione del ruolo diventa titolo solo se è corta come un titolo (es. "Site Manager"), non se è una frase
const shortRole = (v) => { const t = (v || '').trim(); return t && t.length <= 48 && !/[.;:]/.test(t) ? t : null; };

export const SOURCE_LABELS = {
  cash: 'Cash Management', orders: 'Orders Management', shipments: 'Shipments', room: 'Room Planning', nc: 'Non conformità',
  retail: 'Retail Assistant', business: 'Business', finance: 'Finance', integration: 'Integration', contracts: 'Contracts (People)',
};
// Ordine di sincronizzazione: retail è la base dell'anagrafica sedi, contracts quella delle persone
const SYNC_ORDER = ['retail', 'cash', 'nc', 'orders', 'room', 'contracts', 'shipments', 'business', 'finance', 'integration'];

// ---------------------------------------------------------------- pool e query di sola lettura
const pools = {};
export async function resetSource(key) { const p = pools[key]; delete pools[key]; if (p) await p.end().catch(() => {}); const l = longPools[key]; delete longPools[key]; if (l) await l.end().catch(() => {}); }
export const sourceEnabled = (key) => Boolean(config.legacy[key]);

function poolFor(key) {
  if (!LEGACY_KEYS.includes(key)) throw new Error(`Sorgente legacy sconosciuta: ${key}`);
  const url = config.legacy[key];
  if (!url) throw new Error(`Sorgente legacy "${SOURCE_LABELS[key] || key}" non configurata (manca LEGACY_${key.toUpperCase()}_DATABASE_URL)`);
  if (!pools[key]) {
    let local = true;
    try { const u = new URL(url); local = /localhost|127\.0\.0\.1/.test(u.hostname) || !u.hostname || u.searchParams.has('host'); } catch { /* url non standard: trattata come remota */ local = false; }
    const hasSslMode = /sslmode=/.test(url);
    const p = new pg.Pool({
      connectionString: url, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000, query_timeout: 20_000, application_name: 'td-suite-readonly',
      options: '-c default_transaction_read_only=on',
      ...(local || hasSslMode ? {} : { ssl: { rejectUnauthorized: false } }),
    });
    p.on('error', (e) => console.error(`[legacy:${key}]`, e.message));
    pools[key] = p;
  }
  return pools[key];
}

export async function legacyQuery(key, sql, params = []) {
  const head = String(sql).trim().slice(0, 12).toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(head)) throw new Error('Sui database legacy sono ammesse solo letture (SELECT)');
  const r = await poolFor(key).query(sql, params);
  return r.rows;
}
const lq = legacyQuery;
// Pool "lungo" per il travaso: pochi client, timeout ampi (tabelle con allegati), sempre sola lettura
const longPools = {};
export async function legacyQueryLong(key, sql, params = []) {
  if (!/^(SELECT|WITH)\b/.test(String(sql).trim().slice(0, 12).toUpperCase())) throw new Error('Sui database legacy sono ammesse solo letture (SELECT)');
  const url = config.legacy[key];
  if (!url) throw new Error(`Sorgente legacy "${SOURCE_LABELS[key] || key}" non configurata`);
  if (!longPools[key]) {
    const hasSslMode = /sslmode=/.test(url); let local = false;
    try { const u = new URL(url); local = /localhost|127\.0\.0\.1/.test(u.hostname) || !u.hostname || u.searchParams.has('host'); } catch { /* remota */ }
    longPools[key] = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 20_000, statement_timeout: 600_000, query_timeout: 620_000,
      application_name: 'td-suite-travaso', options: '-c default_transaction_read_only=on', ...(local || hasSslMode ? {} : { ssl: { rejectUnauthorized: false } }) });
    longPools[key].on('error', (e) => console.error(`[legacy-long:${key}]`, e.message));
  }
  return (await longPools[key].query(sql, params)).rows;
}

export async function closeLegacyPools() { for (const k of Object.keys(pools)) { try { await pools[k].end(); } catch { /* ignorato */ } delete pools[k]; } }

// ---------------------------------------------------------------- utilità
const lower = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);
const clean = (s) => (s == null ? null : String(s).trim() || null);
const validEmail = (e) => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
const digits = (s) => String(s || '').replace(/\D+/g, '');
const normVat = (s) => { const d = digits(s); return d.length >= 11 ? d.slice(-11) : null; };
const normCf = (s) => { const c = String(s || '').replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{11,16}$/.test(c) ? c : null; };
const isInternalEmail = (email) => config.autoInternalDomains.includes(String(email || '').split('@')[1] || '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SITE_KINDS = ['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO'];

class Stats {
  constructor() { this.d = {}; }
  inc(entity, what, n = 1) { const e = (this.d[entity] ||= { creati: 0, aggiornati: 0, saltati: 0 }); e[what] = (e[what] || 0) + n; }
  toJSON() { return this.d; }
}

// ---------------------------------------------------------------- riconciliazione sedi
// Chiave: riferimento legacy già salvato → codice uguale (case-insensitive) → codice StudioLAB → nome normalizzato uguale o contenuto.
// Altrimenti nuova sede con codice generato e needs_review=TRUE. Le sedi esistenti non vengono mai cancellate.
class SiteMatcher {
  constructor(key, stats) { this.key = key; this.stats = stats; this.rows = []; }
  async load() { this.rows = await many('SELECT id, code, name, short_name, studiolab_code, legacy_refs FROM sites'); }
  taken(row, legacyId) { const ref = row.legacy_refs?.[this.key]; return ref != null && String(ref) !== String(legacyId); }
  find(legacyId, { code, name, studiolab_code }) {
    const lid = String(legacyId);
    let hit = this.rows.find((r) => r.legacy_refs?.[this.key] != null && String(r.legacy_refs[this.key]) === lid);
    if (hit) return hit;
    const cands = this.rows.filter((r) => !this.taken(r, lid));
    if (code) hit = cands.find((r) => r.code.toLowerCase() === String(code).toLowerCase());
    if (!hit && studiolab_code) hit = cands.find((r) => r.studiolab_code && r.studiolab_code.toLowerCase() === String(studiolab_code).toLowerCase());
    if (!hit && code) hit = cands.find((r) => r.studiolab_code && r.studiolab_code.toLowerCase() === String(code).toLowerCase());
    const n = normName(name);
    if (!hit && n) hit = cands.find((r) => normName(r.name) === n || (r.short_name && normName(r.short_name) === n));
    if (!hit && n.length >= 6) hit = cands.find((r) => { const m = normName(r.name); return m.length >= 6 && (m.includes(n) || n.includes(m)); });
    return hit || null;
  }
  async upsert(legacyId, data) {
    const { code, name } = data;
    if (!name) { this.stats.inc('sedi', 'saltati'); return null; }
    const hit = this.find(legacyId, data);
    const refs = JSON.stringify({ [this.key]: legacyId });
    const fill = ['short_name', 'kind', 'organization_id', 'address', 'zip', 'city', 'province', 'lat', 'lng', 'phone', 'email', 'manager_name', 'opening_hours', 'legacy_brand', 'studiolab_code'];
    if (hit) {
      // Completa solo i campi vuoti: le modifiche fatte dagli amministratori in Suite prevalgono
      const sets = ['legacy_refs = legacy_refs || $2::jsonb', 'updated_at = now()']; const params = [hit.id, refs];
      for (const f of fill) if (data[f] !== undefined && data[f] !== null) { params.push(data[f]); sets.push(`${f} = coalesce(${f}, $${params.length})`); }
      await q(`UPDATE sites SET ${sets.join(', ')} WHERE id=$1`, params);
      const row = this.rows.find((r) => r.id === hit.id); row.legacy_refs = { ...(row.legacy_refs || {}), [this.key]: legacyId }; if (!row.studiolab_code && data.studiolab_code) row.studiolab_code = data.studiolab_code;
      this.stats.inc('sedi', 'aggiornati');
      return hit.id;
    }
    // Codice proprio della sorgente se libero, altrimenti codice generato: in quel caso la sede va verificata (needs_review)
    let newCode = clean(code);
    const ownCode = Boolean(newCode) && !this.rows.some((r) => r.code.toLowerCase() === newCode.toLowerCase());
    if (!ownCode) newCode = `${this.key.toUpperCase()}-${legacyId}`.slice(0, 24);
    const cols = ['code', 'name', 'needs_review', 'legacy_refs', 'active']; const vals = [newCode, name, !ownCode, refs, data.active !== false];
    for (const f of fill) if (data[f] !== undefined && data[f] !== null) { cols.push(f); vals.push(data[f]); }
    const row = await one(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, code, name, short_name, studiolab_code, legacy_refs`, vals);
    this.rows.push(row);
    this.stats.inc('sedi', 'creati');
    return row.id;
  }
  async refMap() { return Object.fromEntries((await many(`SELECT id, legacy_refs->>$1 AS ref FROM sites WHERE legacy_refs ? $1`, [this.key])).map((r) => [r.ref, r.id])); }
}

// ---------------------------------------------------------------- riconciliazione organizzazioni
// Chiave: riferimento legacy → partita IVA → codice fiscale → nome normalizzato.
class OrgMatcher {
  constructor(key, stats) { this.key = key; this.stats = stats; this.rows = []; }
  async load() { this.rows = await many('SELECT id, kind, code, name, vat_number, tax_code, legacy_refs FROM organizations'); }
  find(legacyId, { vat_number, tax_code, name }) {
    const lid = String(legacyId);
    let hit = this.rows.find((r) => r.legacy_refs?.[this.key] != null && String(r.legacy_refs[this.key]) === lid);
    if (hit) return hit;
    const cands = this.rows.filter((r) => { const ref = r.legacy_refs?.[this.key]; return ref == null || String(ref) === lid; });
    const vat = normVat(vat_number), cf = normCf(tax_code);
    if (vat) hit = cands.find((r) => normVat(r.vat_number) === vat || normVat(r.tax_code) === vat);
    if (!hit && cf) hit = cands.find((r) => normCf(r.tax_code) === cf || normCf(r.vat_number) === cf);
    const n = normName(name);
    if (!hit && n) hit = cands.find((r) => normName(r.name) === n);
    return hit || null;
  }
  async upsert(legacyId, data) {
    if (!data.name) { this.stats.inc('organizzazioni', 'saltati'); return null; }
    const hit = this.find(legacyId, data);
    const refs = JSON.stringify({ [this.key]: legacyId });
    const fill = ['code', 'vat_number', 'tax_code', 'sdi', 'pec', 'email', 'phone', 'address', 'zip', 'city', 'province', 'website'];
    if (hit) {
      const sets = ['legacy_refs = legacy_refs || $2::jsonb', 'updated_at = now()']; const params = [hit.id, refs];
      for (const f of fill) if (data[f] != null) { params.push(data[f]); sets.push(`${f} = coalesce(${f}, $${params.length})`); }
      // il codice è univoco: lo completiamo solo se libero
      if (data.code && this.rows.some((r) => r.id !== hit.id && r.code && r.code.toLowerCase() === String(data.code).toLowerCase())) { const i = sets.findIndex((s) => s.startsWith('code =')); if (i >= 0) sets.splice(i, 1); }
      await q(`UPDATE organizations SET ${sets.join(', ')} WHERE id=$1`, params);
      const row = this.rows.find((r) => r.id === hit.id); row.legacy_refs = { ...(row.legacy_refs || {}), [this.key]: legacyId };
      this.stats.inc('organizzazioni', 'aggiornati');
      return hit.id;
    }
    const code = data.code && !this.rows.some((r) => r.code && r.code.toLowerCase() === String(data.code).toLowerCase()) ? data.code : null;
    const cols = ['kind', 'name', 'legacy_refs', 'active', 'needs_review', 'code']; const vals = [data.kind || 'CLIENTE', data.name, refs, data.active !== false, !(normVat(data.vat_number) || normCf(data.tax_code)), code];
    for (const f of fill) if (f !== 'code' && data[f] != null) { cols.push(f); vals.push(data[f]); }
    const row = await one(`INSERT INTO organizations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, kind, code, name, vat_number, tax_code, legacy_refs`, vals);
    this.rows.push(row);
    this.stats.inc('organizzazioni', 'creati');
    return row.id;
  }
  async refMap() { return Object.fromEntries((await many(`SELECT id, legacy_refs->>$1 AS ref FROM organizations WHERE legacy_refs ? $1`, [this.key])).map((r) => [r.ref, r.id])); }
}

// ---------------------------------------------------------------- utenti e grant
const modulesByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));

function profileFor(moduleKey, role) {
  const m = modulesByKey[moduleKey];
  if (!m) return null;
  const keys = m.profiles.map((p) => p.key);
  const mapped = LEGACY_ROLE_MAP[moduleKey]?.[role];
  if (mapped && keys.includes(mapped)) return mapped;
  if (role && keys.includes(role)) return role;
  return keys.find((k) => k === 'VIEWER') || keys.find((k) => k === 'LETTORE') || m.profiles.find((p) => /lettura|consultazione/i.test(p.label))?.key || keys[keys.length - 1];
}

// Crea o aggiorna l'utente della Suite a partire dalla riga users di un'app. Restituisce { id, created }.
async function upsertUser(key, lu, stats) {
  const email = lower(lu.email);
  if (!validEmail(email)) { stats.inc('utenti', 'saltati'); return null; }
  const activeOrigin = lu.status ? lu.status === 'ACTIVE' : lu.active !== false;
  const statusOrigin = lu.status === 'PENDING' ? 'PENDING' : activeOrigin ? 'ACTIVE' : 'DISABLED';
  let provider = ['LOCAL', 'ENTRA', 'BOTH'].includes(lu.auth_provider) ? lu.auth_provider : 'LOCAL';   // STUDIOLAB (orders) → LOCAL
  const hasPwd = Boolean(lu.password_hash);
  if (provider === 'ENTRA' && hasPwd) provider = 'BOTH';
  const lastLogin = lu.last_login_at ? new Date(lu.last_login_at).toISOString() : null;
  const pwdMeta = hasPwd ? { source: key, at: lastLogin || '1970-01-01T00:00:00.000Z', hash: sha(lu.password_hash) } : null;
  const refs = { [key]: lu.id };
  const ex = await one('SELECT id, level, status, password_hash, auth_provider, legacy_refs, full_name, phone, title, created_by FROM users WHERE lower(email)=$1', [email]);
  if (!ex) {
    const u = await one(
      `INSERT INTO users (email, full_name, first_name, last_name, title, phone, level, status, auth_provider, password_hash, must_change_password, totp_secret, totp_enabled, entra_oid, legacy_refs)
       VALUES ($1,$2,$13,$14,$3,$4,'USER',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [email, displayName(splitName(clean(lu.full_name)).last_name, splitName(clean(lu.full_name)).first_name) || email, clean(lu.title), clean(lu.phone || lu.telefono), statusOrigin, provider,
        lu.password_hash || null, hasPwd ? Boolean(lu.must_change_password) : false, hasPwd ? lu.totp_secret || null : null, hasPwd ? Boolean(lu.totp_enabled && lu.totp_secret) : false,
        lu.entra_oid || null, JSON.stringify(pwdMeta ? { ...refs, _password_from: pwdMeta } : refs), splitName(clean(lu.full_name)).first_name, splitName(clean(lu.full_name)).last_name]);
    stats.inc('utenti', 'creati');
    return { id: u.id, created: true };
  }
  // Identità esistente: mai toccare il livello (OWNER/ADMIN restano tali), completare i campi vuoti, aggiornare i riferimenti
  const refsObj = { ...refs };
  const sets = ['legacy_refs = legacy_refs || $2::jsonb', 'updated_at = now()', 'full_name = CASE WHEN full_name = email THEN coalesce($3, full_name) ELSE full_name END', 'first_name = CASE WHEN coalesce(first_name,\'\')=\'\' AND coalesce(last_name,\'\')=\'\' THEN $6 ELSE first_name END', 'last_name = CASE WHEN coalesce(first_name,\'\')=\'\' AND coalesce(last_name,\'\')=\'\' THEN $7 ELSE last_name END', 'phone = coalesce(phone, $4)', 'title = coalesce(title, $5)'];
  const nm = splitName(clean(lu.full_name));
  const params = [ex.id, null, displayName(nm.last_name, nm.first_name) || null, clean(lu.phone || lu.telefono), clean(lu.title), nm.first_name, nm.last_name];
  // Password: la copiamo se la Suite non ne ha una, oppure se quella attuale è ancora una copia da un'app e questa app ha un accesso più recente.
  // Una password scelta dall'utente in Suite (hash diverso da quello copiato) non viene mai sovrascritta.
  const prev = ex.legacy_refs?._password_from;
  const stillCopied = prev && ex.password_hash && sha(ex.password_hash) === prev.hash;
  const newer = prev && pwdMeta && pwdMeta.at > (prev.at || '') && prev.source !== key;
  const sameSourceRefresh = prev && pwdMeta && prev.source === key && stillCopied && pwdMeta.hash !== prev.hash;
  if (hasPwd && (!ex.password_hash || (stillCopied && (newer || sameSourceRefresh)))) {
    params.push(lu.password_hash, lu.totp_secret || null, Boolean(lu.totp_enabled && lu.totp_secret));
    sets.push(`password_hash = $${params.length - 2}`, `totp_secret = coalesce(totp_secret, $${params.length - 1})`, `totp_enabled = (totp_enabled OR $${params.length})`,
      `auth_provider = CASE WHEN auth_provider = 'ENTRA' THEN 'BOTH' ELSE auth_provider END`);
    refsObj._password_from = pwdMeta;
  }
  params[1] = JSON.stringify(refsObj);
  if (ex.status !== 'ACTIVE' && activeOrigin && ex.created_by == null && ex.level === 'USER') sets.push(`status = 'ACTIVE'`);
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id=$1`, params);
  stats.inc('utenti', 'aggiornati');
  return { id: ex.id, created: false };
}

// Grant LEGACY: permesso già in vigore oggi (proposed=FALSE), tranne per i moduli riservati che restano proposte per il titolare.
// Non sovrascrive mai grant MANUAL o SEED.
async function setLegacyGrant(userId, moduleKey, role, scopes = [], stats) {
  const m = modulesByKey[moduleKey];
  const profile = profileFor(moduleKey, role);
  if (!m || !profile) return;
  const proposed = Boolean(m.restricted);
  const g = await one(
    `INSERT INTO grants (user_id, module_key, profile, proposed, source) VALUES ($1,$2,$3,$4,'LEGACY')
     ON CONFLICT (user_id, module_key) DO UPDATE SET profile = EXCLUDED.profile, proposed = (grants.proposed AND EXCLUDED.proposed), source = 'LEGACY', updated_at = now()
       WHERE grants.source IN ('LEGACY','ORG')
     RETURNING id, (xmax = 0) AS inserted`, [userId, moduleKey, profile, proposed]);
  if (!g) { stats.inc('grant', 'saltati'); return; }
  stats.inc('grant', g.inserted ? 'creati' : 'aggiornati');
  const valid = scopes.filter((s) => s && s.id);
  if (valid.length) {
    await q(`DELETE FROM grant_scopes WHERE grant_id=$1 AND scope_type=$2`, [g.id, valid[0].type]);
    for (const s of valid) await q('INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [g.id, s.type, s.id]);
  }
}

// ---------------------------------------------------------------- sincronizzazione per sorgente
const syncers = {
  async retail(stats) {
    const sm = new SiteMatcher('retail', stats); await sm.load();
    const sites = await lq('retail', 'SELECT * FROM sites ORDER BY id');
    for (const s of sites) {
      await sm.upsert(s.id, { code: s.code, name: s.name, kind: SITE_KINDS.includes(s.kind) ? s.kind : 'PUNTO_PRELIEVI', address: s.address, city: s.city, province: s.province, zip: s.zip,
        lat: s.lat, lng: s.lng, phone: s.phone, email: s.email, manager_name: s.manager, legacy_brand: s.legacy_brand, opening_hours: s.opening_hours, active: s.active });
    }
    const om = new OrgMatcher('retail', stats); await om.load();
    const customers = await lq('retail', `SELECT id, company_name, vat_number, tax_code, email, phone, address, zip, city, province, external_code FROM customers WHERE kind='B2B' AND coalesce(company_name,'') <> ''`);
    for (const c of customers) await om.upsert(c.id, { kind: 'CLIENTE', name: c.company_name, vat_number: c.vat_number, tax_code: c.tax_code, email: c.email, phone: c.phone, address: c.address, zip: c.zip, city: c.city, province: c.province });
    const siteRef = await sm.refMap();
    const users = await lq('retail', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) {
      const u = await upsertUser('retail', lu, stats); if (!u) continue;
      const sid = lu.site_id != null ? siteRef[String(lu.site_id)] : null;
      await setLegacyGrant(u.id, 'retail', lu.role, sid ? [{ type: 'SITE', id: sid }] : [], stats);
      if (sid) await q('UPDATE users SET site_id = coalesce(site_id, $2) WHERE id=$1', [u.id, sid]);
    }
  },

  async cash(stats) {
    const om = new OrgMatcher('cash', stats); await om.load();
    const companies = await lq('cash', 'SELECT id, code, name, vat_number, tax_code, address, zip, city, province, phone, email, pec, website, active FROM companies ORDER BY id');
    for (const c of companies) await om.upsert(c.id, { kind: 'SOCIETA', code: c.code, name: c.name, vat_number: c.vat_number, tax_code: c.tax_code, address: c.address, zip: c.zip, city: c.city, province: c.province, phone: c.phone, email: c.email, pec: c.pec, website: c.website, active: c.active });
    const orgRef = await om.refMap();
    const sm = new SiteMatcher('cash', stats); await sm.load();
    const sites = await lq('cash', 'SELECT id, company_id, code, name, address, city, province, active, site_email FROM sites ORDER BY id');
    for (const s of sites) await sm.upsert(s.id, { code: s.code, name: s.name, address: s.address, city: s.city, province: s.province, email: s.site_email, organization_id: orgRef[String(s.company_id)] || null, active: s.active });
    const siteRef = await sm.refMap();
    const users = await lq('cash', 'SELECT * FROM users ORDER BY id');
    const userSites = await lq('cash', 'SELECT user_id, site_id FROM user_sites');
    for (const lu of users) {
      const u = await upsertUser('cash', lu, stats); if (!u) continue;
      const scopes = userSites.filter((x) => x.user_id === lu.id).map((x) => siteRef[String(x.site_id)]).filter(Boolean).map((id) => ({ type: 'SITE', id }));
      const orgId = lu.company_id != null ? orgRef[String(lu.company_id)] : null;
      await setLegacyGrant(u.id, 'cash', lu.role, scopes.length ? scopes : orgId ? [{ type: 'ORG', id: orgId }] : [], stats);
      if (orgId) await q('UPDATE users SET organization_id = coalesce(organization_id, $2) WHERE id=$1', [u.id, orgId]);
      if (scopes.length === 1) await q('UPDATE users SET site_id = coalesce(site_id, $2) WHERE id=$1', [u.id, scopes[0].id]);
    }
  },

  async nc(stats) {
    const KIND = { PUNTO_PRELIEVO: 'PUNTO_PRELIEVI', CENTRO_MEDICO: 'CENTRO_MEDICO', SERVICE: 'SERVICE', LABORATORIO: 'LABORATORIO', ALTRO: 'ALTRO' };
    const sm = new SiteMatcher('nc', stats); await sm.load();
    const sedi = await lq('nc', 'SELECT id, codice, nome, tipo, email_nc, email_nc_override, telefono, referente, indirizzo, citta, attiva FROM sedi ORDER BY id');
    for (const s of sedi) await sm.upsert(s.id, { code: null, studiolab_code: s.codice, name: s.nome, kind: KIND[s.tipo] || 'ALTRO', email: s.email_nc_override || s.email_nc, phone: s.telefono, manager_name: s.referente, address: s.indirizzo, city: s.citta, active: s.attiva });
    const siteRef = await sm.refMap();
    const users = await lq('nc', 'SELECT * FROM users ORDER BY id');
    const userSedi = await lq('nc', 'SELECT user_id, sede_id FROM users_sedi');
    for (const lu of users) {
      const u = await upsertUser('nc', lu, stats); if (!u) continue;
      const scopes = userSedi.filter((x) => x.user_id === lu.id).map((x) => siteRef[String(x.sede_id)]).filter(Boolean).map((id) => ({ type: 'SITE', id }));
      await setLegacyGrant(u.id, 'nc', lu.role, scopes, stats);
    }
  },

  async orders(stats) {
    const om = new OrgMatcher('orders', stats); await om.load();
    const company = await lq('orders', 'SELECT id, name, vat_number, address, zip, city, province, phone, email, pec, website FROM company ORDER BY id');
    for (const c of company) await om.upsert(c.id, { kind: 'SOCIETA', name: c.name, vat_number: c.vat_number, address: c.address, zip: c.zip, city: c.city, province: c.province, phone: c.phone, email: c.email, pec: c.pec, website: c.website });
    const KIND = { CLIENTE: 'SERVICE', SEDE: 'PUNTO_PRELIEVI', LAB: 'LABORATORIO' };
    const sm = new SiteMatcher('orders', stats); await sm.load();
    const strutture = await lq('orders', 'SELECT id, kind, code, name, address, zip, city, province, phone, email, referente, studiolab_code, active FROM strutture ORDER BY id');
    for (const s of strutture) await sm.upsert(s.id, { code: s.code, name: s.name, kind: KIND[s.kind] || 'ALTRO', address: s.address, zip: s.zip, city: s.city, province: s.province, phone: s.phone, email: s.email, manager_name: s.referente, studiolab_code: s.studiolab_code, active: s.active });
    const siteRef = await sm.refMap();
    const users = await lq('orders', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) {
      const u = await upsertUser('orders', lu, stats); if (!u) continue;
      const sid = lu.struttura_id != null ? siteRef[String(lu.struttura_id)] : null;
      await setLegacyGrant(u.id, 'orders', lu.role, sid ? [{ type: 'SITE', id: sid }] : [], stats);
      if (sid) await q('UPDATE users SET site_id = coalesce(site_id, $2) WHERE id=$1', [u.id, sid]);
    }
  },

  async room(stats) {
    const sm = new SiteMatcher('room', stats); await sm.load();
    const strutture = await lq('room', `SELECT id, data->>'denominazione' AS denominazione, data->>'nomeSede' AS nome_sede, data->>'nomeBreve' AS nome_breve, data->>'nome' AS nome,
        data->>'indirizzo' AS indirizzo, data->>'email' AS email, data->>'telefono' AS telefono, data->>'siteManager' AS site_manager FROM strutture WHERE deleted_at IS NULL ORDER BY id`);
    for (const s of strutture) {
      const base = s.denominazione || s.nome; if (!base) { stats.inc('sedi', 'saltati'); continue; }
      const name = s.nome_sede ? `${base} · ${s.nome_sede}` : base;
      await sm.upsert(s.id, { code: null, name, short_name: s.nome_breve || s.nome_sede || null, kind: 'CENTRO_MEDICO', address: s.indirizzo, email: s.email, phone: s.telefono, manager_name: s.site_manager });
    }
    const siteRef = await sm.refMap();
    const users = await lq('room', 'SELECT * FROM users ORDER BY id');
    const userStr = await lq('room', 'SELECT user_id, struttura_id FROM user_strutture');
    for (const lu of users) {
      const u = await upsertUser('room', lu, stats); if (!u) continue;
      const scopes = userStr.filter((x) => x.user_id === lu.id).map((x) => siteRef[x.struttura_id]).filter(Boolean).map((id) => ({ type: 'SITE', id }));
      await setLegacyGrant(u.id, 'room', lu.role, scopes, stats);
    }
    // Professionisti → persone (medici e sanitari)
    await syncRoomPeople(stats);
  },

  async contracts(stats) {
    const sm = new SiteMatcher('contracts', stats); await sm.load();
    const ws = await lq('contracts', 'SELECT id, name, address, active FROM work_sites ORDER BY id');
    for (const s of ws) await sm.upsert(s.id, { code: null, name: s.name, address: s.address, active: s.active });
    const users = await lq('contracts', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) { const u = await upsertUser('contracts', lu, stats); if (u) await setLegacyGrant(u.id, 'contracts', lu.role, [], stats); }
    await syncContractsPeople(stats);
  },

  async shipments(stats) {
    const users = await lq('shipments', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) { const u = await upsertUser('shipments', lu, stats); if (u) await setLegacyGrant(u.id, 'shipments', lu.role, [], stats); }
  },

  async business(stats) {
    const om = new OrgMatcher('business', stats); await om.load();
    const partners = await lq('business', 'SELECT id, name, vat, tax_code, sdi, street, zip, city, prov, email, phone, pec, active FROM partners ORDER BY id');
    for (const p of partners) await om.upsert(p.id, { kind: 'CLIENTE', name: p.name, vat_number: p.vat, tax_code: p.tax_code, sdi: p.sdi, address: p.street, zip: p.zip, city: p.city, province: p.prov, email: p.email, phone: p.phone, pec: p.pec, active: p.active });
    const users = await lq('business', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) { const u = await upsertUser('business', lu, stats); if (u) await setLegacyGrant(u.id, 'business', lu.role, [], stats); }
  },

  async finance(stats) {
    const om = new OrgMatcher('finance', stats); await om.load();
    const ben = await lq('finance', 'SELECT id, name, tax_id FROM beneficiaries ORDER BY id');
    for (const b of ben) { const vat = normVat(b.tax_id); await om.upsert(b.id, { kind: 'FORNITORE', name: b.name, vat_number: vat, tax_code: vat ? null : normCf(b.tax_id) }); }
    const users = await lq('finance', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) { const u = await upsertUser('finance', lu, stats); if (u) await setLegacyGrant(u.id, 'finance', lu.is_admin && lu.role === 'SUPPORT' ? 'SUPPORT' : lu.role, [], stats); }
  },

  async integration(stats) {
    const users = await lq('integration', 'SELECT * FROM users ORDER BY id');
    for (const lu of users) { const u = await upsertUser('integration', lu, stats); if (u) await setLegacyGrant(u.id, 'integration', lu.role, [], stats); }
  },
};

// ---------------------------------------------------------------- persone
class PersonMatcher {
  constructor(key, stats) { this.key = key; this.stats = stats; this.rows = []; }
  async load() { this.rows = await many('SELECT id, last_name, first_name, tax_code, email, legacy_refs FROM people'); }
  find(legacyId, { tax_code, email, last_name, first_name }) {
    const lid = String(legacyId);
    let hit = this.rows.find((r) => r.legacy_refs?.[this.key] != null && String(r.legacy_refs[this.key]) === lid);
    if (hit) return hit;
    const cands = this.rows.filter((r) => { const ref = r.legacy_refs?.[this.key]; return ref == null || String(ref) === lid; });
    const cf = normCf(tax_code); const em = lower(email);
    if (cf) hit = cands.find((r) => normCf(r.tax_code) === cf);
    if (!hit && em) hit = cands.find((r) => lower(r.email) === em);
    if (!hit && last_name && first_name) {
      const a = normName(`${last_name} ${first_name}`), b = normName(`${first_name} ${last_name}`);
      hit = cands.find((r) => { const n = normName(`${r.last_name} ${r.first_name}`); return n === a || n === b; });
    }
    return hit || null;
  }
  async upsert(legacyId, data, { reviewOnCreate = false } = {}) {
    if (!data.last_name || !data.first_name) { this.stats.inc('persone', 'saltati'); return null; }
    const hit = this.find(legacyId, data);
    const refs = JSON.stringify({ [this.key]: legacyId });
    const fields = ['kind', 'status', 'title', 'sex', 'birth_date', 'tax_code', 'email', 'phone', 'phone_office', 'area', 'job_title', 'discipline', 'site_id', 'hired_at', 'terminated_at'];
    if (hit) {
      // Contracts è la fonte autorevole dei dati contrattuali: aggiorna; le altre sorgenti completano solo i campi vuoti
      const authoritative = this.key === 'contracts';
      const sets = ['legacy_refs = legacy_refs || $2::jsonb', 'updated_at = now()']; const params = [hit.id, refs];
      for (const f of fields) if (data[f] !== undefined && data[f] !== null) { params.push(data[f]); sets.push(authoritative && f !== 'site_id' ? `${f} = $${params.length}` : `${f} = coalesce(${f}, $${params.length})`); }
      if (data.tax_code && this.rows.some((r) => r.id !== hit.id && normCf(r.tax_code) === normCf(data.tax_code))) { const i = sets.findIndex((s) => s.startsWith('tax_code')); if (i >= 0) sets.splice(i, 1); }
      await q(`UPDATE people SET ${sets.join(', ')} WHERE id=$1`, params);
      const row = this.rows.find((r) => r.id === hit.id); row.legacy_refs = { ...(row.legacy_refs || {}), [this.key]: legacyId }; if (data.email && !row.email) row.email = data.email; if (data.tax_code && !row.tax_code) row.tax_code = data.tax_code;
      this.stats.inc('persone', 'aggiornati');
      return hit.id;
    }
    const cols = ['last_name', 'first_name', 'legacy_refs', 'needs_review']; const vals = [data.last_name, data.first_name, refs, reviewOnCreate];
    for (const f of fields) if (data[f] !== undefined && data[f] !== null) { cols.push(f); vals.push(data[f]); }
    const row = await one(`INSERT INTO people (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, last_name, first_name, tax_code, email, legacy_refs`, vals);
    this.rows.push(row);
    this.stats.inc('persone', 'creati');
    return row.id;
  }
}

async function syncContractsPeople(stats) {
  const pm = new PersonMatcher('contracts', stats); await pm.load();
  const siteRows = await many('SELECT id, name, short_name FROM sites');
  const siteByName = (name) => { const n = normName(name); if (!n) return null; const s = siteRows.find((r) => normName(r.name) === n || (r.short_name && normName(r.short_name) === n)) || siteRows.find((r) => { const m = normName(r.name); return m.length >= 6 && n.length >= 6 && (m.includes(n) || n.includes(m)); }); return s ? s.id : null; };
  const rows = await lq('contracts', `
    SELECT r.id, r.kind, r.status, r.last_name, r.first_name, r.sex, r.title, r.birth_date, r.tax_code, r.phone, r.email, r.phone_office, r.mobile_company, r.manager_id, r.hired_at, r.terminated_at,
           a.name AS area, e.contract_type, e.job_title, e.qualification, e.work_site, e.reports_to, l.discipline, l.role_description
      FROM resources r
      LEFT JOIN areas a ON a.id = r.area_id
      LEFT JOIN employments e ON e.resource_id = r.id
      LEFT JOIN lp_contracts l ON l.resource_id = r.id
     ORDER BY r.id`);
  let extraAreas = [];
  try { extraAreas = await lq('contracts', 'SELECT ra.resource_id, a.name FROM resource_areas ra JOIN areas a ON a.id = ra.area_id'); } catch { /* tabella assente nelle versioni precedenti */ }
  const legacyToSuite = {};
  for (const r of rows) {
    const kind = r.contract_type === 'DIRIGENTE' ? 'DIRIGENTE' : r.kind === 'LP' ? 'LP' : 'DIPENDENTE';
    const status = ['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO'].includes(r.status) ? r.status : 'ATTIVO';
    const id = await pm.upsert(r.id, {
      kind, status, last_name: clean(r.last_name), first_name: clean(r.first_name), title: clean(r.title), sex: r.sex || null, birth_date: r.birth_date || null,
      tax_code: normCf(r.tax_code), email: validEmail(lower(r.email)) ? lower(r.email) : null, phone: clean(r.mobile_company || r.phone), phone_office: clean(r.phone_office),
      area: clean(r.area), job_title: clean(r.job_title || r.qualification || shortRole(r.role_description)),   // la descrizione lunga del ruolo non è un titolo discipline: clean(r.discipline), site_id: r.work_site ? siteByName(r.work_site) : null,
      hired_at: r.hired_at || null, terminated_at: r.terminated_at || null,
    });
    if (id) legacyToSuite[r.id] = id;
  }
  // Responsabile (manager_id → manager_person_id)
  for (const r of rows) {
    if (!r.manager_id || !legacyToSuite[r.id] || !legacyToSuite[r.manager_id]) continue;
    await q('UPDATE people SET manager_person_id=$2 WHERE id=$1 AND manager_person_id IS DISTINCT FROM $2', [legacyToSuite[r.id], legacyToSuite[r.manager_id]]);
  }
  // Collegamento utenti ↔ persone per email
  await q(`UPDATE users u SET person_id = p.id FROM people p WHERE u.person_id IS NULL AND p.email IS NOT NULL AND lower(u.email) = lower(p.email)`);
  // Persone attive con email: identità in Suite e proposte di grant secondo l'area organizzativa
  const proposalKeys = Object.keys(AREA_GRANT_PROPOSALS).map((k) => [k, normName(k)]);
  for (const r of rows) {
    const pid = legacyToSuite[r.id]; const email = lower(r.email);
    if (!pid || r.status !== 'ATTIVO' || !validEmail(email)) continue;
    let u = await one('SELECT id, status FROM users WHERE lower(email)=$1', [email]);
    const internal = isInternalEmail(email);
    if (!u) {
      u = await one(
        `INSERT INTO users (email, full_name, first_name, last_name, title, phone, level, status, auth_provider, must_change_password, person_id, legacy_refs)
         VALUES ($1,$2,$8,$9,$3,$4,'USER','ACTIVE',$5,$6,$7,'{"contracts_person":true}'::jsonb) RETURNING id, status`,
        [email, displayName(clean(r.last_name), clean(r.first_name)), clean(r.title), clean(r.mobile_company || r.phone), internal ? 'ENTRA' : 'LOCAL', !internal, pid]);
      stats.inc('utenti', 'creati');
    } else {
      // persona collegata e nomi allineati all'anagrafica (forma Cognome Nome)
      await q('UPDATE users SET person_id = coalesce(person_id, $2), first_name=$3, last_name=$4, full_name=$5 WHERE id=$1', [u.id, pid, clean(r.first_name), clean(r.last_name), displayName(clean(r.last_name), clean(r.first_name))]);
    }
    const areas = [r.area, ...extraAreas.filter((x) => x.resource_id === r.id).map((x) => x.name)].filter(Boolean).map((a) => normName(a));
    const proposals = new Map();
    for (const a of areas) for (const [k, nk] of proposalKeys) if (nk && (a === nk || a.includes(nk) || nk.includes(a))) for (const [mod, prof] of AREA_GRANT_PROPOSALS[k]) if (mod !== 'contracts' && !proposals.has(mod)) proposals.set(mod, prof);
    for (const [mod, prof] of proposals) {
      if (!modulesByKey[mod] || modulesByKey[mod].restricted) continue;
      const ins = await one(`INSERT INTO grants (user_id, module_key, profile, proposed, source) VALUES ($1,$2,$3,TRUE,'ORG') ON CONFLICT (user_id, module_key) DO NOTHING RETURNING id`, [u.id, mod, prof]);
      if (ins) stats.inc('proposte', 'creati');
    }
    if (internal) {
      const ins = await one(`INSERT INTO grants (user_id, module_key, profile, proposed, source) VALUES ($1,'rubrica','LETTORE',FALSE,'ORG') ON CONFLICT (user_id, module_key) DO NOTHING RETURNING id`, [u.id]);
      if (ins) stats.inc('grant', 'creati');
    }
  }
}

async function syncRoomPeople(stats) {
  const pm = new PersonMatcher('room', stats); await pm.load();
  const rows = await lq('room', `SELECT id, nome, tipo, profilo, email, attivo, dati->>'cognome' AS cognome, dati->>'nome' AS nome_proprio, dati->>'codiceFiscale' AS cf,
      dati->>'cellulare' AS cellulare, dati->>'telefono' AS telefono, dati->'discipline'->>0 AS disciplina, dati->>'titoloStudio' AS titolo FROM professionisti ORDER BY id`);
  for (const r of rows) {
    let last = clean(r.cognome), first = clean(r.nome_proprio);
    if (!last || !first) { const parts = String(r.nome || '').trim().split(/\s+/); last = parts[0] || null; first = parts.slice(1).join(' ') || null; }
    await pm.upsert(r.id, {
      kind: r.tipo === 'medico' ? 'MEDICO' : 'SANITARIO', status: r.attivo === false ? 'CESSATO' : 'ATTIVO', last_name: last, first_name: first,
      tax_code: normCf(r.cf), email: validEmail(lower(r.email)) ? lower(r.email) : null, phone: clean(r.cellulare || r.telefono), job_title: clean(r.profilo), discipline: clean(r.disciplina),
    }, { reviewOnCreate: !r.cognome });   // nome in un campo unico: la divisione cognome/nome va verificata
  }
  await q(`UPDATE users u SET person_id = p.id FROM people p WHERE u.person_id IS NULL AND p.email IS NOT NULL AND lower(u.email) = lower(p.email)`);
}

// ---------------------------------------------------------------- orchestrazione
const running = new Set();
export async function syncSource(key) {
  if (!syncers[key]) throw new Error(`Sorgente legacy sconosciuta: ${key}`);
  if (!sourceEnabled(key)) { await q(`UPDATE legacy_sources SET enabled=FALSE WHERE key=$1`, [key]); throw new Error(`Sorgente "${SOURCE_LABELS[key]}" non configurata`); }
  if (running.has(key)) return { key, skipped: true, reason: 'sincronizzazione già in corso' };
  running.add(key);
  const stats = new Stats(); const t0 = Date.now();
  try {
    await syncers[key](stats);
    const out = { ...stats.toJSON(), durata_ms: Date.now() - t0 };
    await q(`UPDATE legacy_sources SET enabled=TRUE, last_sync_at=now(), last_status='OK', last_error=NULL, stats=$2 WHERE key=$1`, [key, JSON.stringify(out)]);
    invalidateCaches();
    return { key, status: 'OK', stats: out };
  } catch (e) {
    console.error(`[legacy:${key}] sincronizzazione fallita:`, e.message);
    await q(`UPDATE legacy_sources SET enabled=TRUE, last_sync_at=now(), last_status='ERRORE', last_error=$2, stats=$3 WHERE key=$1`, [key, e.message.slice(0, 500), JSON.stringify({ ...stats.toJSON(), durata_ms: Date.now() - t0 })]);
    return { key, status: 'ERRORE', error: e.message, stats: stats.toJSON() };
  } finally { running.delete(key); }
}

export async function syncAll() {
  const results = [];
  for (const k of SYNC_ORDER) {
    if (!sourceEnabled(k)) { await q(`UPDATE legacy_sources SET enabled=FALSE WHERE key=$1`, [k]); results.push({ key: k, status: 'NON_CONFIGURATA' }); continue; }
    results.push(await syncSource(k));
  }
  return results;
}

export async function listSources() {
  const rows = await many('SELECT key, label, enabled, last_sync_at, last_status, last_error, stats FROM legacy_sources');
  return LEGACY_KEYS.map((k) => { const r = rows.find((x) => x.key === k) || { key: k, label: SOURCE_LABELS[k], stats: {} }; return { ...r, label: r.label || SOURCE_LABELS[k], enabled: sourceEnabled(k), running: running.has(k) }; });
}

// ---------------------------------------------------------------- contatori dei widget (cache 5 minuti)
const CACHE_MS = 5 * 60_000;
let countersCache = { at: 0, data: null, promise: null };
let cockpitCache = { at: 0, data: null, promise: null };
export function invalidateCaches() { countersCache = { at: 0, data: null, promise: null }; cockpitCache = { at: 0, data: null, promise: null }; }

// Esegue una lettura difensiva: qualunque errore (sorgente assente, colonna diversa, timeout) produce null e un log
async function safe(key, sql, params) {
  if (!sourceEnabled(key)) return null;
  try { return await lq(key, sql, params); }
  catch (e) { console.warn(`[legacy:${key}] lettura fallita: ${e.message}`); return null; }
}
const n0 = (rows, col = 'n') => (rows && rows[0] && rows[0][col] != null ? Number(rows[0][col]) : null);

const COUNTER_QUERIES = {
  nc: { label: 'NC aperte', sql: `SELECT count(*)::int AS n FROM nc WHERE stato NOT IN ('CHIUSA','VERIFICATA','ANNULLATA')` },
  orders: { label: 'Ordini da evadere', sql: `SELECT count(*)::int AS n FROM orders WHERE status NOT IN ('BOZZA','CONSEGNATO','IMMAGAZZINATO','CHIUSO','ANNULLATO')` },
  cash: { label: 'Rendiconti da approvare', sql: `SELECT count(*)::int AS n FROM cash_reports WHERE status = 'CLOSED'` },
  finance: { label: 'Autorizzazioni in attesa di firma', sql: `SELECT count(*)::int AS n FROM payment_requests WHERE status = 'IN_FIRMA'` },
  integration: { label: 'Attività M&A in ritardo', sql: `SELECT count(*)::int AS n FROM activities a JOIN targets t ON t.id = a.target_id WHERE a.st < 3 AND t.closing ~ '^\\d{4}-\\d{2}-\\d{2}' AND (t.closing::date + (a.ew * 7)) < CURRENT_DATE` },
  shipments: { label: 'Kit in viaggio', sql: `SELECT count(*)::int AS n FROM kits WHERE status IN ('SHIPPED','SHIPPED_TO_LAB')` },
  room: { label: 'Turni scoperti nel mese', sql: `SELECT count(*)::int AS n FROM turni WHERE prof_id IS NULL AND mese = to_char(CURRENT_DATE, 'YYYY-MM')` },
  contracts: { label: 'Scadenze entro 30 giorni', sql: `SELECT (
      (SELECT count(*) FROM deadlines WHERE done = FALSE AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) +
      (SELECT count(*) FROM attachments a JOIN resources r ON r.id = a.resource_id WHERE r.status = 'ATTIVO' AND a.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) +
      (SELECT count(*) FROM employments e JOIN resources r ON r.id = e.resource_id WHERE r.status = 'ATTIVO' AND e.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) +
      (SELECT count(*) FROM lp_contracts l JOIN resources r ON r.id = l.resource_id WHERE r.status = 'ATTIVO' AND l.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
    )::int AS n` },
};

async function computeCounters() {
  const out = {};
  await Promise.all(Object.entries(COUNTER_QUERIES).map(async ([key, c]) => {
    const v = n0(await safe(key, c.sql));
    if (v != null) out[key] = { value: v, label: c.label };
  }));
  return out;
}
async function cachedCounters() {
  if (countersCache.data && Date.now() - countersCache.at < CACHE_MS) return countersCache.data;
  if (!countersCache.promise) countersCache.promise = computeCounters().then((d) => { countersCache = { at: Date.now(), data: d, promise: null }; return d; }).catch((e) => { countersCache.promise = null; throw e; });
  return countersCache.promise;
}
export async function getCounters(user) {
  const all = await cachedCounters();
  const admin = user?.level === 'OWNER' || user?.level === 'ADMIN';
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k === 'contracts') { if (user?.grants?.contracts) out[k] = v; continue; }
    if (user?.grants?.[k] || admin) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- Cockpit direzionale (cache 5 minuti)
const eur = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

const CARD_BUILDERS = [
  { key: 'cash_today', module_key: 'cash', title: 'Incassi di oggi', unit: 'EUR', link: '/go/cash', async build() {
    const rows = await lq('cash', `SELECT s.name, sum(r.cash_to_deposit + r.pos_total + r.transfer_total) AS tot FROM cash_reports r JOIN sites s ON s.id = r.site_id
      WHERE r.report_date = CURRENT_DATE AND r.status <> 'DRAFT' GROUP BY s.name ORDER BY tot DESC`);
    const total = rows.reduce((a, r) => a + Number(r.tot || 0), 0);
    return { value: eur(total), hint: `${rows.length} sedi con rendiconto chiuso oggi`, series: rows.slice(0, 12).map((r) => ({ label: r.name, value: eur(r.tot) })) };
  } },
  { key: 'cash_month', module_key: 'cash', title: 'Incassi del mese', unit: 'EUR', link: '/go/cash', async build() {
    const rows = await lq('cash', `SELECT s.name, sum(r.cash_to_deposit + r.pos_total + r.transfer_total) AS tot FROM cash_reports r JOIN sites s ON s.id = r.site_id
      WHERE r.report_date >= date_trunc('month', CURRENT_DATE) AND r.status <> 'DRAFT' GROUP BY s.name ORDER BY tot DESC`);
    const prev = await lq('cash', `SELECT sum(cash_to_deposit + pos_total + transfer_total) AS tot FROM cash_reports WHERE status <> 'DRAFT'
      AND report_date >= date_trunc('month', CURRENT_DATE - interval '1 month') AND report_date <= (date_trunc('month', CURRENT_DATE - interval '1 month')::date + (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date))`);
    const total = rows.reduce((a, r) => a + Number(r.tot || 0), 0);
    return { value: eur(total), delta: pct(total, Number(prev[0]?.tot || 0)), hint: 'Contanti netti, POS e bonifici dei rendiconti chiusi; delta sullo stesso periodo del mese scorso', series: rows.slice(0, 12).map((r) => ({ label: r.name, value: eur(r.tot) })) };
  } },
  { key: 'retail_revenue', module_key: 'retail', title: 'Fatturato del mese', unit: 'EUR', link: '/go/retail', async build() {
    const cur = await lq('retail', `SELECT sum(net_amount) AS tot, count(DISTINCT external_ref) AS tickets FROM sales WHERE sale_date >= date_trunc('month', CURRENT_DATE)`);
    const prev = await lq('retail', `SELECT sum(net_amount) AS tot FROM sales WHERE sale_date >= date_trunc('month', CURRENT_DATE - interval '1 month')
      AND sale_date <= (date_trunc('month', CURRENT_DATE - interval '1 month')::date + (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date))`);
    const lines = await lq('retail', `SELECT coalesce(l.name, 'Altro') AS label, sum(s.net_amount) AS tot FROM sales s LEFT JOIN products p ON p.id = s.product_id LEFT JOIN product_lines l ON l.id = p.line_id
      WHERE s.sale_date >= date_trunc('month', CURRENT_DATE) GROUP BY 1 ORDER BY tot DESC`);
    return { value: eur(cur[0]?.tot || 0), delta: pct(Number(cur[0]?.tot || 0), Number(prev[0]?.tot || 0)), hint: `${cur[0]?.tickets || 0} accettazioni nel mese; delta sullo stesso periodo del mese scorso`, series: lines.map((r) => ({ label: r.label, value: eur(r.tot) })) };
  } },
  { key: 'retail_new_customers', module_key: 'retail', title: 'Nuovi pazienti del mese', unit: 'n', link: '/go/retail', async build() {
    const cur = await lq('retail', `SELECT count(*)::int AS n FROM customers WHERE kind = 'B2C' AND coalesce(first_visit, created_at::date) >= date_trunc('month', CURRENT_DATE)`);
    const prev = await lq('retail', `SELECT count(*)::int AS n FROM customers WHERE kind = 'B2C' AND coalesce(first_visit, created_at::date) >= date_trunc('month', CURRENT_DATE - interval '1 month') AND coalesce(first_visit, created_at::date) < date_trunc('month', CURRENT_DATE)`);
    return { value: cur[0]?.n || 0, delta: pct(cur[0]?.n || 0, prev[0]?.n || 0), hint: 'Pazienti B2C con prima visita nel mese; delta sul mese scorso intero' };
  } },
  { key: 'orders_open', module_key: 'orders', title: 'Ordini aperti', unit: 'n', link: '/go/orders', async build() {
    const rows = await lq('orders', `SELECT status, count(*)::int AS n FROM orders WHERE status NOT IN ('BOZZA','CHIUSO','ANNULLATO') GROUP BY status`);
    const packs = await lq('orders', `SELECT coalesce(sum(coalesce(l.qty_approved, l.qty_requested)), 0)::int AS n FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status NOT IN ('BOZZA','CHIUSO','ANNULLATO')`);
    const total = rows.reduce((a, r) => a + r.n, 0);
    return { value: total, hint: `${packs[0]?.n || 0} confezioni in lavorazione; il gestionale ordini non registra il valore economico`, series: rows.map((r) => ({ label: r.status, value: r.n })) };
  } },
  { key: 'nc_open', module_key: 'nc', title: 'Non conformità aperte', unit: 'n', link: '/go/nc', async build() {
    const rows = await lq('nc', `SELECT gravita AS label, count(*)::int AS n FROM nc WHERE stato NOT IN ('CHIUSA','VERIFICATA','ANNULLATA') GROUP BY gravita ORDER BY 1`);
    const rt = await lq('nc', `SELECT avg(EXTRACT(EPOCH FROM (first_response_at - sent_at)) / 3600) AS ore FROM nc WHERE sent_at IS NOT NULL AND first_response_at IS NOT NULL AND opened_at >= CURRENT_DATE - 90`);
    const ore = rt[0]?.ore != null ? Math.round(Number(rt[0].ore) * 10) / 10 : null;
    return { value: rows.reduce((a, r) => a + r.n, 0), hint: ore != null ? `Tempo medio di risposta delle sedi negli ultimi 90 giorni: ${ore} ore` : 'Nessuna risposta registrata negli ultimi 90 giorni', series: rows.map((r) => ({ label: r.label, value: r.n })) };
  } },
  { key: 'finance_pending', module_key: 'finance', title: 'Autorizzazioni in attesa di firma', unit: 'n', link: '/go/finance', async build() {
    const r = await lq('finance', `SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS tot FROM payment_requests WHERE status = 'IN_FIRMA'`);
    return { value: r[0]?.n || 0, hint: `Importo complessivo in attesa: ${eur(r[0]?.tot || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}`, series: [{ label: 'Importo in attesa (EUR)', value: eur(r[0]?.tot || 0) }] };
  } },
  { key: 'integration_progress', module_key: 'integration', title: 'Avanzamento integrazioni', unit: '%', link: '/go/integration', async build() {
    const rows = await lq('integration', `SELECT t.nome AS label, count(a.*)::int AS tot, count(*) FILTER (WHERE a.st = 3)::int AS done FROM targets t LEFT JOIN activities a ON a.target_id = t.id GROUP BY t.id, t.nome, t.position ORDER BY t.position`);
    const tot = rows.reduce((a, r) => a + r.tot, 0), done = rows.reduce((a, r) => a + r.done, 0);
    return { value: tot ? Math.round((done / tot) * 100) : 0, hint: `${done} attività completate su ${tot}, ${rows.length} target`, series: rows.map((r) => ({ label: r.label || 'Target', value: r.tot ? Math.round((r.done / r.tot) * 100) : 0 })) };
  } },
  { key: 'contracts_deadlines', module_key: 'contracts', title: 'Scadenze contrattuali a 30 giorni', unit: 'n', link: '/go/contracts', restricted: true, async build() {
    const r = await lq('contracts', COUNTER_QUERIES.contracts.sql);
    const det = await lq('contracts', `SELECT 'Scadenze manuali' AS label, count(*)::int AS n FROM deadlines WHERE done = FALSE AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
      UNION ALL SELECT 'Documenti del dossier', count(*)::int FROM attachments a JOIN resources x ON x.id = a.resource_id WHERE x.status = 'ATTIVO' AND a.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
      UNION ALL SELECT 'Contratti a termine', count(*)::int FROM employments e JOIN resources x ON x.id = e.resource_id WHERE x.status = 'ATTIVO' AND e.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
      UNION ALL SELECT 'Incarichi LP', count(*)::int FROM lp_contracts l JOIN resources x ON x.id = l.resource_id WHERE x.status = 'ATTIVO' AND l.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`);
    return { value: r[0]?.n || 0, hint: 'Scadenze manuali, documenti del dossier, contratti a termine e incarichi in scadenza', series: det.map((x) => ({ label: x.label, value: x.n })) };
  } },
  { key: 'shipments_transit', module_key: 'shipments', title: 'Kit in viaggio', unit: 'n', link: '/go/shipments', async build() {
    const rows = await lq('shipments', `SELECT project AS label, count(*)::int AS n FROM kits WHERE status IN ('SHIPPED','SHIPPED_TO_LAB') GROUP BY project`);
    const wait = await lq('shipments', `SELECT count(*)::int AS n FROM orders WHERE status = 'NEW'`);
    return { value: rows.reduce((a, r) => a + r.n, 0), hint: `${wait[0]?.n || 0} ordini nuovi da assegnare`, series: rows.map((r) => ({ label: r.label, value: r.n })) };
  } },
  { key: 'room_coverage', module_key: 'room', title: 'Copertura turni ambulatori', unit: '%', link: '/go/room', async build() {
    const r = await lq('room', `SELECT count(*)::int AS tot, count(*) FILTER (WHERE prof_id IS NOT NULL)::int AS coperti FROM turni WHERE mese = to_char(CURRENT_DATE, 'YYYY-MM')`);
    const sedi = await lq('room', `SELECT count(*)::int AS n, coalesce(sum(jsonb_array_length(coalesce(data->'ambulatori', '[]'::jsonb))), 0)::int AS amb FROM strutture WHERE deleted_at IS NULL`);
    const tot = r[0]?.tot || 0, cop = r[0]?.coperti || 0;
    return { value: tot ? Math.round((cop / tot) * 100) : null, hint: `${cop} turni coperti su ${tot} nel mese; ${sedi[0]?.n || 0} sedi e ${sedi[0]?.amb || 0} ambulatori censiti`, series: [{ label: 'Coperti', value: cop }, { label: 'Scoperti', value: tot - cop }] };
  } },
];

async function computeCockpit() {
  const cards = await Promise.all(CARD_BUILDERS.map(async (b) => {
    const base = { key: b.key, module_key: b.module_key, title: b.title, unit: b.unit, link: b.link, restricted: Boolean(b.restricted) };
    if (!sourceEnabled(b.module_key)) return { ...base, value: null, unavailable: true, hint: 'Sorgente non configurata' };
    try { return { ...base, ...(await b.build()) }; }
    catch (e) { console.warn(`[cockpit:${b.key}] ${e.message}`); return { ...base, value: null, unavailable: true, hint: 'Lettura non riuscita' }; }
  }));
  return { generated_at: new Date().toISOString(), cards };
}
async function cachedCockpit() {
  if (cockpitCache.data && Date.now() - cockpitCache.at < CACHE_MS) return cockpitCache.data;
  if (!cockpitCache.promise) cockpitCache.promise = computeCockpit().then((d) => { cockpitCache = { at: Date.now(), data: d, promise: null }; return d; }).catch((e) => { cockpitCache.promise = null; throw e; });
  return cockpitCache.promise;
}
export async function getCockpit(user) {
  const data = await cachedCockpit();
  const cards = data.cards.filter((c) => !c.restricted || Boolean(user?.grants?.contracts)).map(({ restricted, ...c }) => c);
  return { generated_at: data.generated_at, cards };
}

// ---------------------------------------------------------------- lavori di sfondo
export function registerLegacyJobs(registerJob) {
  registerJob('legacy:sync-all', Math.max(5, config.legacySyncMinutes || 30), () => syncAll(), { runAtStart: true });
  registerJob('legacy:counters-cache', 5, async () => { invalidateCaches(); const c = await cachedCounters(); const k = await cachedCockpit(); return { counters: Object.keys(c).length, cards: k.cards.length }; }, { runAtStart: true });
}
