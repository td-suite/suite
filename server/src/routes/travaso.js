// Travaso dei moduli: stato, esecuzione della copia, confronto conteggi, passaggio a LIVE (solo titolare)
import { Router } from 'express';
import { many } from '../db.js';
import { LEGACY_KEYS } from '../config.js';
import { ah, bad, audit, notFound } from '../lib/util.js';
import { requireAdmin, requireOwner } from '../lib/access.js';
import { runTravaso, compareCounts, goLive, backToMirror, isRunning } from '../lib/travaso.js';
import { getModuleState } from '../lib/modules.js';
import { sourceEnabled } from '../lib/legacy.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hasCode = (key) => fs.existsSync(path.join(here, '..', 'modules', key, 'migrations'));
const r = Router();

r.get('/travaso', requireAdmin, ah(async (_req, res) => {
  const mods = await many(`SELECT key, name, area FROM modules WHERE key = ANY($1::text[]) ORDER BY area, sort_order`, [LEGACY_KEYS]);
  const out = [];
  for (const m of mods) {
    const st = await getModuleState(m.key);
    out.push({ ...m, ...st, source_enabled: sourceEnabled(m.key), code_ready: hasCode(m.key), running: isRunning(m.key) });
  }
  res.json(out);
}));

const check = (key) => { if (!LEGACY_KEYS.includes(key)) throw notFound('Modulo inesistente'); };

r.post('/travaso/:key/run', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  if (!hasCode(req.params.key)) throw bad('Il codice del modulo non è ancora nella Suite (server/src/modules/' + req.params.key + ')');
  const out = await runTravaso(req.params.key, req.user.id).catch((e) => { throw bad(e.message); });
  await audit(req, 'TRAVASO_RUN', { module: req.params.key, data: { rows: out.rows, tables: out.tables, ms: out.ms } });
  res.json(out);
}));

r.get('/travaso/:key/compare', requireAdmin, ah(async (req, res) => {
  check(req.params.key);
  res.json(await compareCounts(req.params.key).catch((e) => { throw bad(e.message); }));
}));

r.post('/travaso/:key/live', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  await goLive(req.params.key, req.user.id).catch((e) => { throw bad(e.message); });
  await audit(req, 'TRAVASO_LIVE', { module: req.params.key });
  res.json({ ok: true });
}));

r.post('/travaso/:key/mirror', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  await backToMirror(req.params.key, req.user.id);
  await audit(req, 'TRAVASO_BACK_TO_MIRROR', { module: req.params.key });
  res.json({ ok: true });
}));

export default r;
