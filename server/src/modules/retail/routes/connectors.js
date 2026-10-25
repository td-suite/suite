import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, audit, parse } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { testConnector, syncConnector, getConnector } from '../lib/connectors.js';

const r = Router();

const publicRow = (c) => {
  let creds = {};
  try { creds = c.credentials ? JSON.parse(decrypt(c.credentials)) : {}; } catch { creds = {}; }
  const masked = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v ? `${String(v).slice(0, 2)}••••` : '']));
  return { ...c, credentials: undefined, has_credentials: Boolean(c.credentials), credential_keys: masked };
};

r.get('/', requireRole('ADMIN', 'RETAIL'), ah(async (_req, res) => {
  const rows = await many('SELECT * FROM connectors ORDER BY kind');
  const logs = await many('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 30');
  res.json({ connectors: rows.map(publicRow), logs });
}));

r.put('/:kind', requireRole('ADMIN'), ah(async (req, res) => {
  const kind = req.params.kind.toUpperCase();
  const c = await getConnector(kind);
  const d = parse(z.object({ enabled: z.boolean().optional(), base_url: z.string().nullable().optional(), auth_kind: z.enum(['API_KEY', 'BASIC', 'OAUTH2', 'SFTP']).optional(), schedule: z.enum(['MANUALE', 'HOURLY', 'DAILY']).optional(), settings: z.record(z.string(), z.any()).optional(), credentials: z.record(z.string(), z.string()).optional() }), req.body);
  const sets = []; const vals = [c.id];
  if (d.enabled !== undefined) { sets.push(`enabled=$${vals.push(d.enabled)}`); }
  if (d.base_url !== undefined) { sets.push(`base_url=$${vals.push(d.base_url)}`); }
  if (d.auth_kind) { sets.push(`auth_kind=$${vals.push(d.auth_kind)}`); }
  if (d.schedule) { sets.push(`schedule=$${vals.push(d.schedule)}`); }
  if (d.settings) { sets.push(`settings=$${vals.push(JSON.stringify({ ...(c.settings || {}), ...d.settings }))}`); }
  if (d.credentials && Object.keys(d.credentials).length) {
    let cur = {}; try { cur = c.credentials ? JSON.parse(decrypt(c.credentials)) : {}; } catch { cur = {}; }
    const merged = { ...cur }; for (const [k, v] of Object.entries(d.credentials)) if (v && !v.includes('••••')) merged[k] = v;
    sets.push(`credentials=$${vals.push(encrypt(JSON.stringify(merged)))}`);
  }
  if (sets.length) await q(`UPDATE connectors SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, vals);
  await audit(req, 'CONNECTOR_UPDATE', 'connector', kind, { fields: Object.keys(d) });
  res.json(publicRow(await getConnector(kind)));
}));

r.post('/:kind/test', requireRole('ADMIN', 'RETAIL'), ah(async (req, res) => {
  const out = await testConnector(req.params.kind.toUpperCase());
  await q('UPDATE connectors SET last_status=$2, last_message=$3 WHERE kind=$1', [req.params.kind.toUpperCase(), out.ok ? 'OK' : 'ERRORE', out.message]);
  res.json(out);
}));

r.post('/:kind/sync', requireRole('ADMIN', 'RETAIL'), ah(async (req, res) => {
  const { from, to } = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.body || {});
  const out = await syncConnector(req.params.kind.toUpperCase(), req.user.id, { from, to });
  await audit(req, 'CONNECTOR_SYNC', 'connector', req.params.kind.toUpperCase(), { rows_ok: out.rows_ok });
  res.json(out);
}));

export default r;
