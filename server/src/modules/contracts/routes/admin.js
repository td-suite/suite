import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse, HttpError } from '../lib/util.js';
import { requireRole, requireWrite } from '../lib/access.js';
import { getSettings, CORE_KEYS } from '../lib/payroll.js';
import { config } from '../config.js';
import { graphConfigured, inboxStatus } from '../lib/inbox.js';
import { pdfAvailable } from '../lib/docgen.js';

const r = Router();

// Gli utenti (creazione, ruoli, reset password) li gestisce la Suite: le route /users dell'app non si portano.

// ---------------- Impostazioni ----------------
const SETTING_KEYS = ['cv_inbox', 'cv_inbox_mailbox', 'cv_inbox_enabled', 'company_name', 'company_address', 'company_legal_address', 'company_vat', 'company_rea', 'company_capital', 'company_phone', 'company_email', 'company_pec', 'company_website', 'health_director', 'signatory_name', 'signatory_title', 'letter_city', 'cost_inps_pct', 'cost_inail_pct', 'cost_tfr_pct', 'cost_apprentice_inps_pct', 'cost_dirigente_extra_pct', 'irpef_brackets', 'employee_inps_pct', 'addizionale_regionale_pct', 'addizionale_comunale_pct', 'function_allowance_share', 'deadline_alert_days', 'board_signatory_name', 'board_signatory_title', 'dirigenti_minimum', 'dirigenti_monthly_payments'];

r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  res.json({ settings: s, coreKeys: CORE_KEYS, entraEnabled: graphConfigured(), aiEnabled: Boolean(config.anthropicKey), inbox: await inboxStatus(), pdfEnabled: await pdfAvailable(), maxUploadMb: config.maxUploadMb });
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
  , a.core_unit_id, (SELECT u.name FROM public.org_units u WHERE u.id=a.core_unit_id) AS core_unit_name
  FROM areas a JOIN areas_tree t ON t.id=a.id LEFT JOIN resources_v h ON h.id=a.head_person_id ORDER BY t.sort_path, a.name`))));
// B8 (programma anagrafica unica, 08/11/2026): le aree del modulo sono le unità di primo livello dell'organigramma del core
// (areas.core_unit_id, migrazione 020). Non si creano, rinominano, spostano o eliminano qui: Amministrazione > Organizzazione.
// "Allinea al core" crea le aree mancanti per le unità di primo livello e ne allinea i nomi (lib/aree.js).
const AREE_DAL_CORE = 'Le aree sono le unità di primo livello dell\'organigramma: si gestiscono in Amministrazione > Organizzazione (qui "Allinea al core")';
r.post('/areas', ah(async () => { throw new HttpError(410, AREE_DAL_CORE); }));
r.delete('/areas/:id', ah(async () => { throw new HttpError(410, AREE_DAL_CORE); }));
r.put('/areas/:id', ah(async () => { throw new HttpError(410, AREE_DAL_CORE); }));
r.post('/areas/allinea', requireRole('ADMIN'), ah(async (req, res) => {
  const { allineaAreeDalCore } = await import('../lib/aree.js');
  const out = await allineaAreeDalCore();
  await audit(req, 'AREE_ALLINEATE_AL_CORE', 'area', null, out);
  res.json(out);
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
