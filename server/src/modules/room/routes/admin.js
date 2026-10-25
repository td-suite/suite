import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { BLOB_KINDS, splitStruttura, joinStruttura, sortStrutture, liteOf, extData, SITE_COLS } from '../lib/strutture.js';
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
// Il backup contiene le impostazioni Room delle sedi configurate (con l'anagrafica attuale di public.sites per leggibilità) e i binari.
r.get('/backup', requireRole('ADMIN'), ah(async (req, res) => {
  const rows = await many(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.configurata ORDER BY s.id`);
  const blobs = await many('SELECT struttura_id, kind, data FROM struttura_blobs');
  const byId = {};
  for (const b of blobs) (byId[b.struttura_id] ||= {})[b.kind] = b.data;
  const brandRow = await one(`SELECT value FROM app_settings WHERE key='brand'`);
  const strutture = sortStrutture(rows.map((x) => ({ ...joinStruttura(liteOf(x), byId[x.id] || {}), _version: x.version, _updatedAt: x.updated_at, _siteCode: x.code })));
  const env = { app: config.appName, version: 5, savedAt: new Date().toISOString(), savedBy: req.user.full_name, data: { brand: brandRow ? JSON.parse(brandRow.value) : null, strutture } };
  await audit(req, 'BACKUP_EXPORT', 'strutture', null, { n: strutture.length });
  res.setHeader('Content-Disposition', `attachment; filename="Backup_RoomPlanning_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json"`);
  res.json(env);
}));

// Importa un backup (stesso formato del file OneDrive / artifact). Aggiorna le impostazioni Room delle sedi che esistono nell'anagrafica
// unica: per id di public.sites, per codice (_siteCode) o per riferimento legacy (id dell'app di origine in sites.legacy_refs->>'room').
// Le sedi del file che non esistono nell'anagrafica vengono saltate e segnalate: si creano in Amministrazione > Sedi.
r.post('/backup/import', requireRole('ADMIN'), ah(async (req, res) => {
  const { envelope } = parse(z.object({ envelope: z.any(), mode: z.enum(['merge', 'replace']).optional() }), req.body);
  const d = envelope?.data?.strutture ? envelope.data : envelope;
  if (!d || !Array.isArray(d.strutture)) throw bad('Formato non riconosciuto');
  const sites = await many(`SELECT id, code, name, active, legacy_refs->>'room' AS legacy FROM public.sites`);
  const resolve = (s) => {
    const sid = Number(s.id);
    return sites.find((x) => Number.isInteger(sid) && x.id === sid) || (s._siteCode && sites.find((x) => x.code.toLowerCase() === String(s._siteCode).toLowerCase()))
      || sites.find((x) => x.legacy != null && String(x.legacy) === String(s.id)) || null;
  };
  let updated = 0; const saltate = [];
  await tx(async (c) => {
    for (const s of d.strutture) {
      const site = resolve(s);
      if (!site || !site.active) { saltate.push(s.denominazione ? `${s.denominazione}${s.nomeSede ? ' · ' + s.nomeSede : ''}` : String(s.id)); continue; }
      const { lite, blobs } = splitStruttura(s);
      const ext = extData(lite);
      const cur = (await c.query('SELECT version FROM site_ext WHERE site_id=$1', [site.id])).rows[0];
      const version = (cur?.version || 0) + 1; updated++;
      await c.query(`INSERT INTO site_ext (site_id, data, version, updated_by) VALUES ($1,$2,$3,$4)
        ON CONFLICT (site_id) DO UPDATE SET data=EXCLUDED.data, version=EXCLUDED.version, updated_at=now(), updated_by=EXCLUDED.updated_by`, [site.id, JSON.stringify(ext), version, req.user.id]);
      for (const k of BLOB_KINDS) {
        if (blobs[k]) await c.query('INSERT INTO struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (struttura_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [site.id, k, blobs[k]]);
      }
      await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,$4,$5,$6)', [site.id, version, JSON.stringify(ext), req.user.id, req.user.full_name, `importazione backup (${envelope.savedAt || 'data sconosciuta'})`]);
    }
    if (d.brand) await c.query(`INSERT INTO app_settings (key, value) VALUES ('brand', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ c: d.brand.c })]);
  });
  await audit(req, 'BACKUP_IMPORT', 'strutture', null, { updated, saltate: saltate.length });
  res.json({ ok: true, created: 0, updated, saltate });
}));

// ---------------- Audit ----------------
r.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const params = []; let where = 'TRUE';
  if (req.query.action) { params.push(req.query.action); where = `a.action = $1`; }
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.at DESC LIMIT ${limit}`, params));
}));

export default r;
