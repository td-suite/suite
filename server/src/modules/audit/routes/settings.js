// Impostazioni (QUALITA/ADMIN): giorno dell'alert, promemoria, modelli di checklist (anteprima, nuova revisione JSON, attivazione),
// modalità di archiviazione dei file, esecuzione manuale del job alert17 (con data di test fuori produzione).
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { ah, audit, bad, parse } from '../../../lib/util.js';
import { storageMode } from '../../../lib/moduleStorage.js';
import { mailStatus } from '../../../lib/mailer.js';
import { requireQualita } from '../lib/access.js';
import { KEY, settings, setSetting, templateById } from '../lib/core.js';
import { validateTemplate, itemsOf, sectionsOf } from '../lib/scoring.js';
import { runAlert17 } from '../lib/alerts.js';
import { aiState } from '../lib/synth.js';
import { fontName } from '../lib/export.js';

const r = Router();

async function stato() {
  const imp = await settings();
  const templates = await many(`SELECT id, code, title, rev, rev_date, kind, active, created_at, (SELECT count(*)::int FROM audits a WHERE a.template_id=t.id AND a.deleted_at IS NULL) AS n_audits FROM templates t ORDER BY kind, id DESC`);
  const ultimoAlert = await one(`SELECT period, max(sent_at) AS sent_at, count(*)::int AS n FROM alerts_sent GROUP BY period ORDER BY period DESC LIMIT 1`);
  return { ...imp, templates, storage: storageMode(), mail: mailStatus(), ai: aiState(), pdf_font: fontName(), ultimo_alert: ultimoAlert };
}

r.get('/settings', requireQualita, ah(async (_req, res) => res.json(await stato())));
r.put('/settings', requireQualita, ah(async (req, res) => {
  const b = parse(z.object({ alert_day: z.coerce.number().int().min(1).max(28).optional(), reminder_every_days: z.coerce.number().int().min(0).max(15).optional() }), req.body || {});
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, v, req.user.id);
  await audit(req, 'AUDIT_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', ') });
  res.json(await stato());
}));

// Modelli: lettura (anche per i non Qualità: serve al form), anteprima strutturata
r.get('/templates', ah(async (_req, res) => res.json(await many(`SELECT id, code, title, rev, rev_date, kind, active, created_at FROM templates ORDER BY kind, id DESC`))));
r.get('/templates/:id', ah(async (req, res) => {
  const t = await templateById(Number(req.params.id));
  res.json({ ...t, items: itemsOf(t.body), sections: sectionsOf(t.body) });
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('file');
r.post('/templates', requireQualita, (req, res, next) => upload(req, res, (e) => (e ? next(bad(e.message)) : next())), ah(async (req, res) => {
  let body;
  try { body = req.file ? JSON.parse(req.file.buffer.toString('utf8')) : req.body?.body; } catch { throw bad('Il file non è un JSON valido'); }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw bad('JSON non valido'); } }
  const errs = validateTemplate(body);
  if (errs.length) throw bad(`Modello non valido: ${errs.join('; ')}`);
  const kind = ['SEDE', 'LEGAL_ENTITY'].includes(req.body?.kind) ? req.body.kind : (body.header_fields || []).some((f) => f.source === 'organization') ? 'LEGAL_ENTITY' : 'SEDE';
  if (await one('SELECT 1 FROM templates WHERE code=$1 AND rev=$2', [body.code, String(body.rev)])) throw bad(`La revisione ${body.rev} del modello ${body.code} esiste già: aumenta il numero di revisione`);
  const activate = String(req.body?.activate ?? 'true') !== 'false';
  if (activate) await q('UPDATE templates SET active=FALSE WHERE kind=$1', [kind]);
  const row = await one('INSERT INTO templates (code, title, rev, rev_date, kind, body, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [body.code, body.title, String(body.rev), body.rev_date || null, kind, JSON.stringify(body), activate, req.user.id]);
  await audit(req, 'AUDIT_MODELLO', { module: KEY, entity: 'template', entityId: row.id, data: { code: body.code, rev: body.rev, kind, voci: itemsOf(body).length } });
  res.status(201).json(await stato());
}));
r.put('/templates/:id', requireQualita, ah(async (req, res) => {
  const t = await templateById(Number(req.params.id));
  const b = parse(z.object({ active: z.boolean() }), req.body || {});
  if (b.active) await q('UPDATE templates SET active=FALSE WHERE kind=$1', [t.kind]);
  await q('UPDATE templates SET active=$2 WHERE id=$1', [t.id, b.active]);
  res.json(await stato());
}));

// Job dell'alert eseguito a mano (data di test ammessa solo fuori produzione)
r.post('/jobs/alert17/run', requireQualita, ah(async (req, res) => {
  const today = process.env.NODE_ENV !== 'production' && /^\d{4}-\d{2}-\d{2}$/.test(req.body?.today || '') ? req.body.today : undefined;
  const out = await runAlert17({ today, dryRun: Boolean(req.body?.dry_run) });
  await audit(req, 'AUDIT_ALERT_RUN', { module: KEY, entity: 'job', label: 'alert17', data: { sedi: out.sedi, notifiche: out.notifiche, email: out.email, test_date: today || null } });
  res.json(out);
}));

export default r;
