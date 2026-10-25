import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireAdmin, requireManager } from '../lib/access.js';
import { getSettings, DEFAULT_SETTINGS } from '../lib/rules.js';
import { config } from '../config.js';
import { pdfAvailable } from '../lib/docgen.js';
import multer from 'multer';
import os from 'node:os';
import { importPackage } from '../lib/importer.js';

const r = Router();

// Gli utenti li gestisce la Suite (grant del modulo): le route /users dell'app di origine non sono state portate.

// ---------------- Impostazioni ----------------
r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  res.json({ settings: s, defaults: DEFAULT_SETTINGS, pdfEnabled: await pdfAvailable(), maxUploadMb: config.maxUploadMb, maxImportMb: config.maxImportMb, credentialsKeySet: config.credentialsKeySet });
}));

r.put('/settings', requireAdmin, ah(async (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!(k in DEFAULT_SETTINGS)) throw bad(`Impostazione sconosciuta: ${k}`);
    await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(body[k] ?? '')]);
  }
  // nel registro non finiscono i dati anagrafici personali
  const keys = Object.keys(body).filter((k) => !/_(birth|residence|tax_code)/.test(k));
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, { keys });
  res.json({ ok: true });
}));

// ---------------- Anagrafica partner / clienti B2B (MOD173) ----------------
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const partnerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  vat: optStr(20), tax_code: optStr(20), sdi: optStr(10),
  street: optStr(200), zip: optStr(10), city: optStr(120), prov: optStr(4), country: z.string().trim().max(60).default('Italia'),
  email: optStr(160), phone: optStr(60), pec: optStr(160),
  legal_rep: optStr(160), signer: optStr(160), signer_role: optStr(120),
  contract_services: optStr(200), lab_reference: optStr(200), billing_ref: optStr(200),
  svc_contact: optStr(160), svc_email: optStr(160), svc_mobile: optStr(60), svc_address: optStr(200),
  proc_contact: optStr(160), proc_email: optStr(160), proc_mobile: optStr(60), proc_address: optStr(200),
  pay_method: optStr(80), pay_terms: optStr(120), currency: z.string().trim().max(5).default('EUR'),
  withholding: z.boolean().default(false), vat_territoriality: optStr(80), intent_declaration: optStr(120), split_payment: z.boolean().default(false), tax_values: optStr(120),
  bank_name: optStr(160), iban: optStr(40), notes: optStr(2000), active: z.boolean().default(true),
});
export const PARTNER_COLS = Object.keys(partnerSchema.shape);

r.get('/partners', ah(async (req, res) => {
  const qs = String(req.query.q || '').trim().toLowerCase();
  const rows = await many(`SELECT p.*, (SELECT count(*)::int FROM contracts c WHERE c.partner_id=p.id AND c.status<>'ANNULLATO') AS contracts,
      (SELECT json_agg(json_build_object('id', c.id, 'kind', c.kind, 'protocol', c.protocol, 'status', c.status, 'title', c.title) ORDER BY c.created_at DESC) FROM contracts c WHERE c.partner_id=p.id) AS contract_list
    FROM partners p WHERE $1='' OR lower(p.name) LIKE '%'||$1||'%' OR lower(coalesce(p.vat,'')) LIKE '%'||$1||'%' OR lower(coalesce(p.city,'')) LIKE '%'||$1||'%' ORDER BY p.name LIMIT 500`, [qs]);
  res.json(rows);
}));
r.get('/partners/:id', ah(async (req, res) => {
  const p = await one('SELECT * FROM partners WHERE id=$1', [Number(req.params.id)]);
  if (!p) throw notFound();
  res.json(p);
}));
r.post('/partners', requireManager, ah(async (req, res) => {
  const d = parse(partnerSchema, req.body);
  if (d.iban) d.iban = d.iban.replace(/\s+/g, '').toUpperCase();
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO partners (${cols.join(',')}, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}) RETURNING *`, [...cols.map((c) => d[c]), req.user.id]);
  await audit(req, 'PARTNER_CREATE', 'partner', row.id, { name: d.name });
  res.status(201).json(row);
}));
r.put('/partners/:id', requireManager, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(partnerSchema.partial(), req.body);
  if (d.iban) d.iban = d.iban.replace(/\s+/g, '').toUpperCase();
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE partners SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'PARTNER_UPDATE', 'partner', id, { fields: cols });
  res.json(await one('SELECT * FROM partners WHERE id=$1', [id]));
}));
r.delete('/partners/:id', requireManager, ah(async (req, res) => {
  const id = Number(req.params.id);
  const n = (await one('SELECT count(*)::int AS n FROM contracts WHERE partner_id=$1', [id])).n;
  if (n) throw bad('Partner con contratti collegati: disattivalo invece di eliminarlo');
  await q('DELETE FROM partners WHERE id=$1', [id]);
  await audit(req, 'PARTNER_DELETE', 'partner', id);
  res.json({ ok: true });
}));

// ---------------- Registro attività ----------------
r.get('/audit', requireAdmin, ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  res.json(await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));

// ---------------- Importazione dello status quo (pacchetti ZIP) ----------------
const importUpload = multer({ storage: multer.diskStorage({ destination: os.tmpdir(), filename: (_req, _file, cb) => cb(null, `td-import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.zip`) }), limits: { fileSize: config.maxImportMb * 1024 * 1024, files: 1 } });

r.post('/import', requireAdmin, importUpload.single('package'), ah(async (req, res) => {
  if (!req.file) throw bad('Carica un pacchetto ZIP');
  const dryRun = String(req.body.dry_run || '') === '1';
  const result = await importPackage(req.file.path, { userId: req.user.id, dryRun, filename: req.file.originalname });
  const summary = { counts: result.counts, errors: result.errors, ok: result.ok, items: result.items.length };
  await q('INSERT INTO import_runs(filename, dry_run, user_id, summary) VALUES ($1,$2,$3,$4)', [req.file.originalname, dryRun, req.user.id, JSON.stringify(summary)]);
  await audit(req, dryRun ? 'IMPORT_DRY_RUN' : 'IMPORT_RUN', 'import', req.file.originalname, summary);
  res.json({ filename: req.file.originalname, ...result });
}));

r.get('/import/runs', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT i.id, i.filename, i.dry_run, i.summary, i.at, u.full_name AS user_name FROM import_runs i LEFT JOIN users u ON u.id=i.user_id ORDER BY i.at DESC LIMIT 50`));
}));

// Azzeramento dei dati contrattuali (partner, contratti, fascicoli, credenziali, contatori di protocollo, registro importazioni).
// Serve per ripartire a pulito prima dell'importazione dello status quo. Utenti, impostazioni e registro attività restano.
r.post('/import/reset', requireAdmin, ah(async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
  if (confirm !== 'AZZERA') throw bad('Per confermare scrivi AZZERA');
  const before = await one('SELECT (SELECT count(*) FROM contracts)::int AS contracts, (SELECT count(*) FROM partners)::int AS partners');
  await q('DELETE FROM contracts');
  await q('DELETE FROM partners');
  await q('DELETE FROM protocol_counters');
  await q('DELETE FROM import_runs');
  await audit(req, 'DATA_RESET', 'system', null, before);
  res.json({ ok: true, deleted: before });
}));

export default r;
