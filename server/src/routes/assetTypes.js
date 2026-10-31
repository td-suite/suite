// Catalogo dispositivi (Amministrazione > Anagrafiche > Catalogo dispositivi): tipologie di dispositivi sotto manutenzione, compresi
// quelli di sicurezza, con periodicità di sorveglianza, controllo e manutenzione e riferimenti normativi (benchmark da confermare con RSPP
// e Qualità). Lettura per ogni utente autenticato (serve al modulo Facility e Manutenzioni); scrittura solo Owner e Admin.
// Un tipo usato da dispositivi installati non si elimina (si disattiva): facility.assets.asset_type_code → asset_types.code.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { ASSET_CATEGORIES, SITE_KINDS_FACILITY } from '../seed/assetTypes.js';

const r = Router();
const months = (max) => z.coerce.number().int().min(1).max(max).nullable().optional();
const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, 'codice: lettere maiuscole, numeri e trattino basso (2-40)'),
  name: z.string().trim().min(2).max(160),
  category: z.enum(Object.keys(ASSET_CATEGORIES)),
  description: z.string().max(2000).nullable().optional(),
  surveillance_months: months(120),
  check_interval_months: months(240),
  check_kind: z.enum(['CONTROLLO', 'VERIFICA_NORMATIVA']).optional(),
  maintenance_interval_months: months(240),
  legal_reference: z.string().max(600).nullable().optional(),
  requires_certified_vendor: z.boolean().optional(),
  applies_to_kinds: z.array(z.enum(SITE_KINDS_FACILITY)).max(10).optional(),
  benchmark_note: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.coerce.number().int().min(0).max(100000).optional(),
});
const COLS = ['code', 'name', 'category', 'description', 'surveillance_months', 'check_interval_months', 'check_kind', 'maintenance_interval_months', 'legal_reference', 'requires_certified_vendor', 'applies_to_kinds', 'benchmark_note', 'active', 'sort'];

// Dispositivi installati per tipo (solo se il modulo Facility è avviato: lo schema può non esistere)
async function usage() {
  const ok = await one(`SELECT to_regclass('facility.assets') IS NOT NULL AS ok`);
  if (!ok?.ok) return new Map();
  const rows = await many(`SELECT asset_type_code AS code, count(*)::int AS n FROM facility.assets WHERE status <> 'DISMESSO' GROUP BY 1`);
  return new Map(rows.map((x) => [x.code, x.n]));
}

r.get('/asset-types', ah(async (req, res) => {
  const all = req.query.all === '1';
  const rows = await many(`SELECT * FROM asset_types ${all ? '' : 'WHERE active'} ORDER BY sort, name`);   // il seed è ordinato per gruppi (antincendio, luoghi, impianti, ...)
  const u = await usage();
  res.json({ rows: rows.map((t) => ({ ...t, in_use: u.get(t.code) || 0 })), categories: ASSET_CATEGORIES, site_kinds: SITE_KINDS_FACILITY });
}));

r.post('/asset-types', requireAdmin, ah(async (req, res) => {
  const b = parse(schema, req.body || {});
  if (await one('SELECT 1 FROM asset_types WHERE code=$1', [b.code])) throw bad(`Il codice ${b.code} esiste già`);
  if (!b.surveillance_months && !b.check_interval_months && !b.maintenance_interval_months) throw bad('Indica almeno una periodicità (sorveglianza, controllo o manutenzione)');
  const cols = COLS.filter((k) => b[k] !== undefined);
  const row = await one(`INSERT INTO asset_types (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => b[k]));
  await audit(req, 'ASSET_TYPE_CREATED', { entity: 'asset_type', entityId: row.id, label: `${row.code} ${row.name}` });
  res.status(201).json(row);
}));

r.put('/asset-types/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM asset_types WHERE id=$1', [id]);
  if (!cur) throw notFound('Tipo di dispositivo non trovato');
  const b = parse(schema.partial(), req.body || {});
  const next = { ...cur, ...b };
  if (!next.surveillance_months && !next.check_interval_months && !next.maintenance_interval_months) throw bad('Indica almeno una periodicità (sorveglianza, controllo o manutenzione)');
  if (b.code && b.code !== cur.code && await one('SELECT 1 FROM asset_types WHERE code=$1', [b.code])) throw bad(`Il codice ${b.code} esiste già`);
  const cols = COLS.filter((k) => b[k] !== undefined);
  if (!cols.length) return res.json(cur);
  // il codice si propaga ai dispositivi installati (FK ON UPDATE CASCADE)
  const row = await one(`UPDATE asset_types SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, [id, ...cols.map((k) => b[k])]);
  await audit(req, 'ASSET_TYPE_UPDATED', { entity: 'asset_type', entityId: id, label: `${row.code} ${row.name}`, data: b });
  res.json(row);
}));

r.delete('/asset-types/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM asset_types WHERE id=$1', [id]);
  if (!cur) throw notFound('Tipo di dispositivo non trovato');
  const ok = await one(`SELECT to_regclass('facility.assets') IS NOT NULL AS ok`);
  if (ok?.ok) {
    const n = (await one('SELECT count(*)::int AS n FROM facility.assets WHERE asset_type_code=$1', [cur.code])).n;
    if (n) throw bad(`${n} dispositiv${n === 1 ? 'o usa' : 'i usano'} questo tipo: disattivalo invece di eliminarlo`);
    await q('UPDATE facility.property_obligations SET asset_type_code=NULL WHERE asset_type_code=$1', [cur.code]);
  }
  await q('DELETE FROM asset_types WHERE id=$1', [id]);
  await audit(req, 'ASSET_TYPE_DELETED', { entity: 'asset_type', entityId: id, label: `${cur.code} ${cur.name}` });
  res.json({ ok: true });
}));

export default r;
