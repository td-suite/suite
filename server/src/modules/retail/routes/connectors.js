import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, audit, parse } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { testConnector, syncConnector, getConnector, coreStatus } from '../lib/connectors.js';

const r = Router();

// Credenziali e base URL stanno nel connettore della Suite (Amministrazione > Connettori): qui solo pianificazione ed esiti
const publicRow = (c) => ({ ...c, credentials: undefined, has_credentials: false, credential_keys: {} });

r.get('/', requireRole('ADMIN', 'RETAIL'), ah(async (_req, res) => {
  const rows = await many('SELECT * FROM connectors ORDER BY kind');
  const logs = await many('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 30');
  const core = {};
  for (const c of rows) { try { core[c.kind] = await coreStatus(c.kind); } catch { core[c.kind] = null; } }
  res.json({ connectors: rows.map((c) => ({ ...publicRow(c), core: core[c.kind] })), logs });
}));

r.put('/:kind', requireRole('ADMIN'), ah(async (req, res) => {
  const kind = req.params.kind.toUpperCase();
  const c = await getConnector(kind);
  // base_url, auth_kind e credentials non si accettano più qui: si impostano in Amministrazione > Connettori
  const d = parse(z.object({ enabled: z.boolean().optional(), schedule: z.enum(['MANUALE', 'HOURLY', 'DAILY']).optional(), settings: z.record(z.string(), z.any()).optional() }).passthrough(), req.body);
  const sets = []; const vals = [c.id];
  if (d.enabled !== undefined) { sets.push(`enabled=$${vals.push(d.enabled)}`); }
  if (d.schedule) { sets.push(`schedule=$${vals.push(d.schedule)}`); }
  if (d.settings) { const st = { ...d.settings }; delete st.instance; sets.push(`settings=$${vals.push(JSON.stringify({ ...(c.settings || {}), ...st }))}`); }
  if (sets.length) await q(`UPDATE connectors SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, vals);
  await audit(req, 'CONNECTOR_UPDATE', 'connector', kind, { fields: Object.keys(d).filter((k) => ['enabled', 'schedule', 'settings'].includes(k)) });
  res.json({ ...publicRow(await getConnector(kind)), core: await coreStatus(kind).catch(() => null) });
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
