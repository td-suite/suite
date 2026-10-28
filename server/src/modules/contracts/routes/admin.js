import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireRole, requireWrite } from '../lib/access.js';
import { getSettings, CORE_KEYS } from '../lib/payroll.js';
import { config } from '../config.js';
import { pdfAvailable } from '../lib/docgen.js';

const r = Router();

// Gli utenti (creazione, ruoli, reset password) li gestisce la Suite: le route /users dell'app non si portano.

// ---------------- Impostazioni ----------------
const SETTING_KEYS = ['cv_inbox', 'cv_inbox_enabled', 'company_name', 'company_address', 'company_legal_address', 'company_vat', 'company_rea', 'company_capital', 'company_phone', 'company_email', 'company_pec', 'company_website', 'health_director', 'signatory_name', 'signatory_title', 'letter_city', 'cost_inps_pct', 'cost_inail_pct', 'cost_tfr_pct', 'cost_apprentice_inps_pct', 'cost_dirigente_extra_pct', 'irpef_brackets', 'employee_inps_pct', 'addizionale_regionale_pct', 'addizionale_comunale_pct', 'function_allowance_share', 'deadline_alert_days', 'board_signatory_name', 'board_signatory_title', 'dirigenti_minimum', 'dirigenti_monthly_payments'];

r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  res.json({ settings: s, coreKeys: CORE_KEYS, entraEnabled: false, aiEnabled: Boolean(config.anthropicKey), pdfEnabled: await pdfAvailable(), maxUploadMb: config.maxUploadMb });
}));

r.put('/settings', requireRole('ADMIN'), ah(async (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!SETTING_KEYS.includes(k)) throw bad(`Impostazione sconosciuta: ${k}`);
    if (CORE_KEYS.includes(k)) continue;   // dati aziendali: si modificano in Amministrazione > Impostazioni > Dati aziendali
    await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(body[k] ?? '')]);
  }
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, body);
  res.json({ ok: true });
}));

// Catalogo dei ruoli dell'anagrafica unica (Amministrazione > Ruoli): la mansione del contratto si sceglie da qui
r.get('/job-roles', ah(async (_req, res) => res.json(await many(`SELECT id, name, description FROM public.job_roles WHERE active ORDER BY sort_order, name`))));

// ---------------- Aree e sedi ----------------
r.get('/areas', ah(async (_req, res) => res.json(await many(`SELECT a.*, t.path, t.root_id, t.root_name, h.last_name || ' ' || h.first_name AS head_name,
  (SELECT count(*)::int FROM resources_v r WHERE r.status IN ('ATTIVO','IMPEGNO') AND (r.area_id=a.id OR r.id IN (SELECT person_id FROM person_areas WHERE area_id=a.id))) AS headcount,
  (SELECT count(*)::int FROM areas c WHERE c.parent_id=a.id) AS children
  FROM areas a JOIN areas_tree t ON t.id=a.id LEFT JOIN resources_v h ON h.id=a.head_person_id ORDER BY t.sort_path, a.name`))));
r.post('/areas', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2).max(120), sort_order: z.number().int().default(100), parent_id: z.number().int().nullable().optional(), kind: z.enum(['STAFF', 'LINEA']).default('LINEA') }), req.body);
  let level = 1;
  if (d.parent_id) { const p = await one('SELECT level FROM areas WHERE id=$1', [d.parent_id]); if (!p) throw bad('Area di livello superiore inesistente'); if (p.level >= 4) throw bad('Sono previsti al massimo quattro livelli'); level = p.level + 1; }
  const row = await one('INSERT INTO areas(name, sort_order, parent_id, level, kind) VALUES ($1,$2,$3,$4,$5) RETURNING *', [d.name, d.sort_order, d.parent_id || null, level, d.kind]);
  await audit(req, 'AREA_CREATE', 'area', row.id, d);
  res.status(201).json(row);
}));
r.delete('/areas/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const a = await one('SELECT name FROM areas WHERE id=$1', [id]);
  if (!a) throw notFound();
  const n = (await one('SELECT count(*)::int AS n FROM resources_v WHERE area_id=$1 OR id IN (SELECT person_id FROM person_areas WHERE area_id=$1)', [id])).n;
  if (n > 0) throw bad(`L'area "${a.name}" ha ${n} risors${n === 1 ? 'a' : 'e'} assegnat${n === 1 ? 'a' : 'e'}: spostale in un'altra area prima di eliminarla`);
  const c = (await one('SELECT count(*)::int AS n FROM areas WHERE parent_id=$1', [id])).n;
  if (c > 0) throw bad(`L'area "${a.name}" ha ${c} aree di livello inferiore: eliminale o spostale prima`);
  await q('UPDATE org_units SET area_id=NULL WHERE area_id=$1', [id]);
  await q('DELETE FROM areas WHERE id=$1', [id]);
  await audit(req, 'AREA_DELETE', 'area', id, { name: a.name });
  res.json({ ok: true });
}));
r.put('/areas/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT * FROM areas WHERE id=$1', [id]);
  if (!cur) throw notFound();
  const d = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), sort_order: z.number().int().optional(), active: z.boolean().optional(), parent_id: z.number().int().nullable().optional(), head_person_id: z.number().int().nullable().optional(), kind: z.enum(['STAFF', 'LINEA']).optional() }), req.body);
  if (d.parent_id !== undefined) {
    // spostamento nella gerarchia: niente cicli, massimo quattro livelli (contando anche i discendenti)
    let newLevel = 1;
    if (d.parent_id !== null) {
      if (d.parent_id === id) throw bad('Un\'area non può dipendere da sé stessa');
      const p = await one('SELECT id, level FROM areas WHERE id=$1', [d.parent_id]);
      if (!p) throw bad('Area di livello superiore inesistente');
      const desc = await many('WITH RECURSIVE t AS (SELECT id FROM areas WHERE parent_id=$1 UNION ALL SELECT a.id FROM areas a JOIN t ON a.parent_id=t.id) SELECT id FROM t', [id]);
      if (desc.some((x) => x.id === d.parent_id)) throw bad('Spostamento non valido: l\'area scelta dipende già da questa');
      newLevel = p.level + 1;
    }
    const depth = (await one('WITH RECURSIVE t AS (SELECT id, 1 AS d FROM areas WHERE id=$1 UNION ALL SELECT a.id, t.d+1 FROM areas a JOIN t ON a.parent_id=t.id) SELECT max(d)::int AS m FROM t', [id])).m;
    if (newLevel + depth - 1 > 4) throw bad('Sono previsti al massimo quattro livelli: le aree sotto a questa supererebbero il quarto');
    await q('UPDATE areas SET parent_id=$2, level=$3 WHERE id=$1', [id, d.parent_id, newLevel]);
    await q('WITH RECURSIVE t AS (SELECT id, level FROM areas WHERE id=$1 UNION ALL SELECT a.id, t.level+1 FROM areas a JOIN t ON a.parent_id=t.id) UPDATE areas x SET level=t.level FROM t WHERE x.id=t.id AND x.id<>$1', [id]);
    delete d.parent_id;
  }
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE areas SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'AREA_UPDATE', 'area', id, req.body);
  res.json({ ok: true });
}));
// Sedi di lavoro: anagrafica unica della Suite (public.sites). Si creano e modificano in Amministrazione > Sedi, qui solo elenco
// per i selettori (contratto, lettera di impegno, sede della persona); address è l'indirizzo completo per i documenti.
r.get('/work-sites', ah(async (_req, res) => res.json(await many(`SELECT id, code, name, kind, city, province, active,
  nullif(concat_ws(', ', address, nullif(concat_ws(' ', zip, city) || CASE WHEN province IS NOT NULL THEN ' (' || province || ')' ELSE '' END, '')), '') AS address
  FROM public.sites WHERE active ORDER BY sort_order, name`))));

// ---------------- Registro attività ----------------
r.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  const rows = await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

export default r;
