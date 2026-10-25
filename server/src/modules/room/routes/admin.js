import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { BLOB_KINDS, splitStruttura, joinStruttura, sortStrutture } from '../lib/strutture.js';
import { config } from '../config.js';
import { criticita, runDailyAlert } from '../lib/alerts.js';
import { mailStatus } from '../lib/mailer.js';

const r = Router();

// Gli utenti (creazione, ruoli, reset password e TOTP) sono gestiti dalla Suite: la sezione Utenti dell'app non viene portata.

// ---------------- Impostazioni ----------------
r.get('/settings', ah(async (_req, res) => {
  const rows = await many('SELECT key, value FROM app_settings');
  const s = Object.fromEntries(rows.map((x) => [x.key, x.value]));
  let brand = null; try { brand = s.brand ? JSON.parse(s.brand) : null; } catch { brand = null; }
  res.json({ brand, entraEnabled: config.entra.enabled, autoProvisionRole: config.entra.autoProvisionRole, allowedDomains: config.entra.allowedDomains, mail: mailStatus(),
    crit_soglia: s.crit_soglia || '5', crit_alert_enabled: s.crit_alert_enabled || 'false', crit_alert_hour: s.crit_alert_hour || '8', crit_alert_last_run: s.crit_alert_last_run || '', rendiconto_cc: s.rendiconto_cc || '', resp_san_nome: s.resp_san_nome || '' });
}));

r.put('/settings', requireRole('ADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ crit_soglia: z.string().regex(/^\d{1,3}$/).optional(), crit_alert_enabled: z.enum(['true', 'false']).optional(), crit_alert_hour: z.string().regex(/^([01]?\d|2[0-3])$/).optional(), rendiconto_cc: z.string().max(500).optional(), resp_san_nome: z.string().max(120).optional() }), req.body);
  for (const [k, v] of Object.entries(d)) await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, d);
  res.json({ ok: true });
}));

// Criticità di tutte le sedi rispetto alla soglia (banner del cruscotto); invio manuale dell'avviso
r.get('/criticita', ah(async (_req, res) => res.json(await criticita())));
r.post('/criticita/invia', requireRole('ADMIN'), ah(async (req, res) => { const out = await runDailyAlert({ force: true }); await audit(req, 'AVVISO_CRITICITA_MANUALE', 'strutture', null, { over: out.over }); res.json(out); }));

// ---------------- Backup completo e importazione ----------------
r.get('/backup', requireRole('ADMIN'), ah(async (req, res) => {
  const rows = await many('SELECT id, data, version, updated_at, deleted_at FROM strutture ORDER BY id');
  const blobs = await many('SELECT struttura_id, kind, data FROM struttura_blobs');
  const byId = {};
  for (const b of blobs) (byId[b.struttura_id] ||= {})[b.kind] = b.data;
  const brandRow = await one(`SELECT value FROM app_settings WHERE key='brand'`);
  const strutture = sortStrutture(rows.filter((x) => !x.deleted_at || req.query.trash === '1').map((x) => ({ ...joinStruttura(x.data, byId[x.id] || {}), _version: x.version, _updatedAt: x.updated_at, _deletedAt: x.deleted_at })));
  const env = { app: config.appName, version: 4, savedAt: new Date().toISOString(), savedBy: req.user.full_name, data: { brand: brandRow ? JSON.parse(brandRow.value) : null, strutture } };
  await audit(req, 'BACKUP_EXPORT', 'strutture', null, { n: strutture.length });
  res.setHeader('Content-Disposition', `attachment; filename="Backup_RoomPlanning_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json"`);
  res.json(env);
}));

// Importa un backup (stesso formato del file OneDrive / artifact). mode=merge (default): aggiorna o crea le sedi del file; mode=replace: sostituisce tutto.
r.post('/backup/import', requireRole('ADMIN'), ah(async (req, res) => {
  const { envelope, mode } = parse(z.object({ envelope: z.any(), mode: z.enum(['merge', 'replace']).default('merge') }), req.body);
  const d = envelope?.data?.strutture ? envelope.data : envelope;
  if (!d || !Array.isArray(d.strutture)) throw bad('Formato non riconosciuto');
  let created = 0, updated = 0;
  await tx(async (c) => {
    if (mode === 'replace') {
      // le sedi non presenti nel file finiscono nel cestino, non vengono cancellate
      const ids = d.strutture.map((s) => s.id);
      await c.query('UPDATE strutture SET deleted_at=now(), deleted_by=$2 WHERE deleted_at IS NULL AND NOT (id = ANY($1))', [ids, req.user.id]);
    }
    for (const s of d.strutture) {
      const { lite, blobs } = splitStruttura(s);
      if (!lite.id) continue;
      const ex = await c.query('SELECT version FROM strutture WHERE id=$1', [lite.id]);
      let version = 1;
      if (ex.rows.length) {
        version = ex.rows[0].version + 1; updated++;
        await c.query('UPDATE strutture SET data=$2, version=$3, updated_at=now(), updated_by=$4, deleted_at=NULL, deleted_by=NULL WHERE id=$1', [lite.id, JSON.stringify(lite), version, req.user.id]);
      } else {
        created++;
        await c.query('INSERT INTO strutture (id, data, version, updated_by) VALUES ($1,$2,1,$3)', [lite.id, JSON.stringify(lite), req.user.id]);
      }
      for (const k of BLOB_KINDS) {
        if (blobs[k]) await c.query('INSERT INTO struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [lite.id, k, blobs[k]]);
      }
      await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,$4,$5,$6)', [lite.id, version, JSON.stringify(lite), req.user.id, req.user.full_name, `importazione backup (${envelope.savedAt || 'data sconosciuta'})`]);
    }
    if (d.brand) await c.query(`INSERT INTO app_settings (key, value) VALUES ('brand', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ c: d.brand.c })]);
  });
  await audit(req, 'BACKUP_IMPORT', 'strutture', null, { mode, created, updated });
  res.json({ ok: true, created, updated });
}));

// ---------------- Audit ----------------
r.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const params = []; let where = 'TRUE';
  if (req.query.action) { params.push(req.query.action); where = `a.action = $1`; }
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.at DESC LIMIT ${limit}`, params));
}));

export default r;
