// Sorgenti legacy, riconciliazione, Cockpit, contatori dei widget, chiavi API e registro delle importazioni
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { LEGACY_KEYS } from '../config.js';
import { ah, bad, audit, parse, notFound, forbidden } from '../lib/util.js';
import { requireAdmin, isAdmin, hasModule } from '../lib/access.js';
import { listSources, syncSource, syncAll, getCockpit, getCounters, sourceEnabled, resetSource, legacyQuery } from '../lib/legacy.js';
import { setSecret, secretStatus, onSecretChange } from '../lib/secrets.js';
import { requireOwner } from '../lib/access.js';
import * as blobLib from '../lib/blob.js';
import * as claudeLib from '../lib/claude.js';
import pg from 'pg';

// Quando una credenziale cambia dall'Amministrazione: pool e client si azzerano e ripartono con il nuovo valore
onSecretChange((name) => {
  if (name.startsWith('legacy:')) resetSource(name.slice(7)).catch(() => {});
  if (name === 'azure_storage_connection_string') blobLib.resetClient();
  if (name === 'anthropic_api_key') claudeLib.resetClient();
});

const r = Router();

// ---- Sorgenti legacy (stato e sincronizzazione)
r.get('/legacy/sources', requireAdmin, ah(async (_req, res) => res.json(await listSources())));

// Stato delle credenziali impostabili dall'Amministrazione (solo titolare per vedere la provenienza e modificare)
r.get('/legacy/sources/:key/credential', requireOwner, ah(async (req, res) => {
  if (!LEGACY_KEYS.includes(req.params.key)) throw notFound('Sorgente inesistente');
  res.json(await secretStatus(`legacy:${req.params.key}`));
}));

// Imposta la connessione al database legacy: prova la connessione (SELECT 1 in sola lettura) e poi salva cifrata
r.put('/legacy/sources/:key/credential', requireOwner, ah(async (req, res) => {
  const key = req.params.key;
  if (!LEGACY_KEYS.includes(key)) throw notFound('Sorgente inesistente');
  const b = parse(z.object({ database_url: z.string().trim().max(600).nullable() }), req.body);
  if (b.database_url) {
    if (!/^postgres(ql)?:\/\//.test(b.database_url)) throw bad('La connessione deve iniziare con postgresql://');
    const url = b.database_url;
    const test = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, ...(/sslmode=/.test(url) || /localhost|127\.0\.0\.1/.test(url) ? {} : { ssl: { rejectUnauthorized: false } }) });
    try { await test.query('SELECT 1'); } catch (e) { throw bad(`Connessione non riuscita: ${e.message}`); } finally { await test.end().catch(() => {}); }
  }
  await setSecret(`legacy:${key}`, b.database_url, req.user.id);
  await q('UPDATE legacy_sources SET enabled=$2, last_status=NULL, last_error=NULL WHERE key=$1', [key, Boolean(b.database_url)]);
  await audit(req, b.database_url ? 'LEGACY_CREDENTIAL_SET' : 'LEGACY_CREDENTIAL_REMOVED', { entity: 'legacy_source', entityId: key });
  res.json({ ok: true, enabled: sourceEnabled(key) });
}));

// Integrazioni: chiave Anthropic e Azure Blob (solo titolare)
r.get('/integrations', requireOwner, ah(async (_req, res) => {
  res.json({ anthropic: await secretStatus('anthropic_api_key'), azure_blob: await secretStatus('azure_storage_connection_string') });
}));
r.put('/integrations/:name', requireOwner, ah(async (req, res) => {
  const map = { anthropic: 'anthropic_api_key', azure_blob: 'azure_storage_connection_string' };
  const name = map[req.params.name];
  if (!name) throw notFound('Integrazione inesistente');
  const b = parse(z.object({ value: z.string().trim().max(2000).nullable() }), req.body);
  if (name === 'anthropic_api_key' && b.value && !/^sk-ant-/.test(b.value)) throw bad('La chiave Anthropic inizia con sk-ant-');
  if (name === 'azure_storage_connection_string' && b.value && !/AccountName=/.test(b.value)) throw bad('Stringa di connessione Azure non riconosciuta (manca AccountName=)');
  try { await setSecret(name, b.value, req.user.id); } catch (e) { throw bad(e.message); }
  if (name === 'azure_storage_connection_string' && b.value) {
    try { await blobLib.ensureContainer?.(); } catch (e) { await setSecret(name, null, req.user.id); throw bad(`Azure non raggiungibile: ${e.message}`); }
  }
  await audit(req, 'INTEGRATION_CREDENTIAL_SET', { entity: 'integration', entityId: req.params.name, data: { set: Boolean(b.value) } });
  res.json({ ok: true });
}));

r.post('/legacy/sources/:key/sync', requireAdmin, ah(async (req, res) => {
  const key = req.params.key;
  if (!LEGACY_KEYS.includes(key)) throw notFound('Sorgente inesistente');
  if (!sourceEnabled(key)) throw bad('Sorgente non configurata: imposta la connessione al database dalla card (titolare) oppure la variabile LEGACY_' + key.toUpperCase() + '_DATABASE_URL su Render');
  const out = await syncSource(key);
  await audit(req, 'LEGACY_SYNC', { module: key, entity: 'legacy_source', entityId: key, label: `Sincronizzazione ${key}: ${out.status || 'saltata'}`, data: out });
  res.json(out);
}));

r.post('/legacy/sync-all', requireAdmin, ah(async (req, res) => {
  const out = await syncAll();
  await audit(req, 'LEGACY_SYNC_ALL', { entity: 'legacy_source', label: 'Sincronizzazione di tutte le sorgenti', data: out.map((o) => ({ key: o.key, status: o.status })) });
  res.json(out);
}));

// ---- Riconciliazione: elementi da verificare e possibili duplicati (pg_trgm, somiglianza > 0.6)
r.get('/legacy/review', requireAdmin, ah(async (_req, res) => {
  const sites = await many(`SELECT s.*, o.name AS organization_name FROM sites s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.needs_review ORDER BY s.name`);
  const people = await many(`SELECT p.id, p.kind, p.status, p.last_name, p.first_name, p.email, p.area, p.job_title, p.legacy_refs, s.name AS site_name FROM people p LEFT JOIN sites s ON s.id = p.site_id WHERE p.needs_review ORDER BY p.last_name, p.first_name`);
  const organizations = await many(`SELECT * FROM organizations WHERE needs_review ORDER BY name`);
  const siteDuplicates = await many(`
    SELECT a.id AS id_a, a.code AS code_a, a.name AS name_a, a.city AS city_a, b.id AS id_b, b.code AS code_b, b.name AS name_b, b.city AS city_b, round(similarity(lower(a.name), lower(b.name))::numeric, 2) AS score
      FROM sites a JOIN sites b ON a.id < b.id AND similarity(lower(a.name), lower(b.name)) > 0.6
     ORDER BY score DESC LIMIT 200`);
  const peopleDuplicates = await many(`
    SELECT a.id AS id_a, a.last_name || ' ' || a.first_name AS name_a, a.email AS email_a, b.id AS id_b, b.last_name || ' ' || b.first_name AS name_b, b.email AS email_b,
           round(similarity(lower(a.last_name || ' ' || a.first_name), lower(b.last_name || ' ' || b.first_name))::numeric, 2) AS score
      FROM people a JOIN people b ON a.id < b.id AND similarity(lower(a.last_name || ' ' || a.first_name), lower(b.last_name || ' ' || b.first_name)) > 0.6
     ORDER BY score DESC LIMIT 200`);
  const orgDuplicates = await many(`
    SELECT a.id AS id_a, a.name AS name_a, a.vat_number AS vat_a, b.id AS id_b, b.name AS name_b, b.vat_number AS vat_b, round(similarity(lower(a.name), lower(b.name))::numeric, 2) AS score
      FROM organizations a JOIN organizations b ON a.id < b.id AND similarity(lower(a.name), lower(b.name)) > 0.6
     ORDER BY score DESC LIMIT 200`);
  res.json({ sites, people, organizations, duplicates: { sites: siteDuplicates, people: peopleDuplicates, organizations: orgDuplicates } });
}));

// ---- Cockpit direzionale (modulo cockpit o amministratori) e contatori dei widget
r.get('/cockpit', ah(async (req, res) => {
  if (!isAdmin(req.user) && !hasModule(req.user, 'cockpit')) throw forbidden('Il Cockpit è riservato alla direzione');
  res.json(await getCockpit(req.user));
}));

r.get('/home/counters', ah(async (req, res) => res.json(await getCounters(req.user))));

// ---- Chiavi API per l'ingestione
const apiKeySchema = z.object({
  name: z.string().min(2).max(80),
  source: z.string().min(2).max(40).regex(/^[A-Za-z0-9_.-]+$/, 'solo lettere, numeri, punto, trattino e trattino basso'),
  site_id: z.number().int().nullable().optional(),
  organization_id: z.number().int().nullable().optional(),
  scopes: z.array(z.string().regex(/^ingest:(\*|[a-z0-9_:-]+)$/, 'formato ingest:<dataset> oppure ingest:*')).min(1),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});
const API_KEY_COLS = `k.id, k.name, k.prefix, k.source, k.site_id, k.organization_id, k.scopes, k.created_by, k.created_at, k.expires_at, k.revoked_at, k.last_used_at,
  s.name AS site_name, o.name AS organization_name, u.full_name AS created_by_name,
  (SELECT count(*)::int FROM ingest_batches b WHERE b.api_key_id = k.id) AS batches`;

r.get('/api-keys', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT ${API_KEY_COLS} FROM api_keys k LEFT JOIN sites s ON s.id = k.site_id LEFT JOIN organizations o ON o.id = k.organization_id LEFT JOIN users u ON u.id = k.created_by ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`));
}));

r.post('/api-keys', requireAdmin, ah(async (req, res) => {
  const b = parse(apiKeySchema, req.body);
  const key = `tds_${crypto.randomBytes(30).toString('base64url')}`;   // tds_ + 40 caratteri base64url
  const prefix = key.slice(0, 12);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const row = await one(
    `INSERT INTO api_keys (name, prefix, key_hash, source, site_id, organization_id, scopes, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, prefix`,
    [b.name, prefix, hash, b.source.toUpperCase(), b.site_id ?? null, b.organization_id ?? null, b.scopes, req.user.id, b.expires_at || null]);
  await audit(req, 'API_KEY_CREATED', { entity: 'api_key', entityId: row.id, label: `${b.name} (${prefix})`, data: { source: b.source, scopes: b.scopes, expires_at: b.expires_at || null } });
  res.status(201).json({ id: row.id, key, prefix });   // la chiave in chiaro compare una sola volta
}));

r.delete('/api-keys/:id', requireAdmin, ah(async (req, res) => {
  const row = await one('UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id=$1 RETURNING id, name, prefix', [Number(req.params.id)]);
  if (!row) throw notFound('Chiave inesistente');
  await audit(req, 'API_KEY_REVOKED', { entity: 'api_key', entityId: row.id, label: `${row.name} (${row.prefix})` });
  res.json({ ok: true });
}));

// ---- Registro delle importazioni
r.get('/ingest-batches', requireAdmin, ah(async (req, res) => {
  const { source = '', dataset = '', status = '', page = 1 } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (source) where.push(`b.source = ${p(String(source).toUpperCase())}`);
  if (dataset) where.push(`b.dataset = ${p(dataset)}`);
  if (status) where.push(`b.status = ${p(status)}`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT count(*)::int AS n FROM ingest_batches b ${w}`, params)).n;
  const rows = await many(`SELECT b.id, b.batch_uid, b.source, b.dataset, b.api_key_id, b.site_id, b.received_at, b.applied_at, b.status, b.rows_total, b.rows_ok, b.rows_rejected, b.checksum, b.error,
      k.name AS api_key_name, k.prefix AS api_key_prefix, s.name AS site_name
    FROM ingest_batches b LEFT JOIN api_keys k ON k.id = b.api_key_id LEFT JOIN sites s ON s.id = b.site_id ${w}
    ORDER BY b.received_at DESC LIMIT 50 OFFSET ${p((Math.max(1, Number(page)) - 1) * 50)}`, params);
  res.json({ total, rows });
}));

r.get('/ingest-batches/:id', requireAdmin, ah(async (req, res) => {
  const row = await one(`SELECT b.*, k.name AS api_key_name, k.prefix AS api_key_prefix, s.name AS site_name FROM ingest_batches b LEFT JOIN api_keys k ON k.id = b.api_key_id LEFT JOIN sites s ON s.id = b.site_id WHERE b.id=$1`, [Number(req.params.id)]);
  if (!row) throw notFound('Lotto inesistente');
  res.json(row);
}));

export default r;
