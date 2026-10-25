import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireAdmin, requireManager } from '../lib/access.js';
import { getSettings, DEFAULT_SETTINGS } from '../lib/rules.js';
import { config } from '../config.js';
import { pdfAvailable } from '../lib/docgen.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { audit as suiteAudit } from '../../../lib/util.js';

const r = Router();

// Gli utenti li gestisce la Suite (grant del modulo): le route /users dell'app di origine non sono state portate.

// ---------------- Impostazioni ----------------
r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  res.json({ settings: s, defaults: DEFAULT_SETTINGS, pdfEnabled: await pdfAvailable(), maxUploadMb: config.maxUploadMb, credentialsKeySet: config.credentialsKeySet });
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

// ---------------- Organizzazioni (anagrafica unica della Suite) ----------------
// Ragione sociale, P.IVA, indirizzo, PEC e stato si modificano in Amministrazione > Organizzazioni (public.organizations).
// Qui si leggono tutte le organizzazioni e si modificano le sole impostazioni Business (org_ext, tracciato TD-SGI-MOD173).
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const orgExtSchema = z.object({
  legal_rep: optStr(160), signer: optStr(160), signer_role: optStr(120),
  contract_services: optStr(200), lab_reference: optStr(200), billing_ref: optStr(200),
  sales_contact: optStr(160), sales_email: optStr(160), sales_phone: optStr(60),
  svc_contact: optStr(160), svc_email: optStr(160), svc_mobile: optStr(60), svc_address: optStr(200),
  proc_contact: optStr(160), proc_email: optStr(160), proc_mobile: optStr(60), proc_address: optStr(200),
  pay_method: optStr(80), pay_terms: optStr(120), currency: z.string().trim().max(5).default('EUR'),
  withholding: z.boolean().default(false), vat_territoriality: optStr(80), intent_declaration: optStr(120), split_payment: z.boolean().default(false), tax_values: optStr(120),
  bank_name: optStr(160), iban: optStr(40),
  portal_url: optStr(300), portal_username: optStr(160), portal_password: optStr(200),
  notes: optStr(2000),
});
export const ORG_EXT_COLS = Object.keys(orgExtSchema.shape).filter((k) => k !== 'portal_password');

const ORG_LIST = `SELECT v.*, (SELECT count(*)::int FROM contracts c WHERE c.org_id=v.id AND c.status<>'ANNULLATO') AS contracts,
      (SELECT json_agg(json_build_object('id', c.id, 'kind', c.kind, 'protocol', c.protocol, 'status', c.status, 'title', c.title) ORDER BY c.created_at DESC) FROM contracts c WHERE c.org_id=v.id) AS contract_list
    FROM orgs_v v`;

r.get('/organizations', ah(async (req, res) => {
  const qs = String(req.query.q || '').trim().toLowerCase();
  const kind = String(req.query.kind || '').trim();
  const rows = await many(`${ORG_LIST} WHERE ($1='' OR lower(v.name) LIKE '%'||$1||'%' OR lower(coalesce(v.vat,'')) LIKE '%'||$1||'%' OR lower(coalesce(v.city,'')) LIKE '%'||$1||'%')
      AND ($2='' OR v.kind=$2) ORDER BY v.name LIMIT 500`, [qs, kind]);
  res.json(rows);
}));
r.get('/organizations/:id', ah(async (req, res) => {
  const o = await one(`${ORG_LIST} WHERE v.id=$1`, [Number(req.params.id)]);
  if (!o) throw notFound('Organizzazione non trovata');
  res.json(o);
}));

// Impostazioni Business dell'organizzazione: upsert di org_ext (la riga nasce alla prima scrittura)
r.put('/organizations/:id/ext', requireManager, ah(async (req, res) => {
  const id = Number(req.params.id);
  const org = await one('SELECT id, name FROM public.organizations WHERE id=$1', [id]);
  if (!org) throw notFound('Organizzazione non trovata: creala in Amministrazione > Organizzazioni');
  const d = parse(orgExtSchema.partial(), req.body);
  if (d.iban) d.iban = d.iban.replace(/\s+/g, '').toUpperCase();
  const { portal_password, ...fields } = d;
  if (portal_password !== undefined && portal_password !== null) fields.portal_password_enc = encrypt(portal_password);
  const cols = Object.keys(fields);
  await q(`INSERT INTO org_ext (org_id, created_by, updated_by${cols.map((c) => `, ${c}`).join('')}) VALUES ($1, $2, $2${cols.map((_, i) => `, $${i + 3}`).join('')})
    ON CONFLICT (org_id) DO UPDATE SET updated_by=$2, updated_at=now()${cols.map((c) => `, ${c}=EXCLUDED.${c}`).join('')}`, [id, req.user.id, ...cols.map((c) => fields[c])]);
  await audit(req, 'ORG_EXT_UPDATE', 'organization', id, { name: org.name, fields: cols.filter((c) => c !== 'portal_password_enc').concat(portal_password ? ['portal_password'] : []) });
  res.json(await one(`${ORG_LIST} WHERE v.id=$1`, [id]));
}));

// Password del portale dell'organizzazione in chiaro (solo manager, registrata nel registro attività)
r.get('/organizations/:id/portal-password', requireManager, ah(async (req, res) => {
  const id = Number(req.params.id);
  const x = await one('SELECT portal_password_enc FROM org_ext WHERE org_id=$1', [id]);
  if (!x?.portal_password_enc) return res.json({ password: '' });
  if (req.moduleMode === 'MIRROR') await suiteAudit({ user: req.suiteUser, ip: req.ip }, 'CREDENTIALS_REVEAL', { module: 'business', entity: 'organization', entityId: id });
  else await audit(req, 'CREDENTIALS_REVEAL', 'organization', id);
  res.json({ password: decrypt(x.portal_password_enc) });
}));

// Sedi dell'anagrafica unica per i selettori dei form (punti prelievo e sedi TD in locazione).
// I profili Business non sono di sede: se il grant ha scope di sede si limita alle sedi del grant.
r.get('/sites', ah(async (req, res) => {
  const ids = Array.isArray(req.user.site_ids) ? req.user.site_ids : [];
  const all = req.query.all === '1';
  const rows = await many(`SELECT s.id, s.code, s.name, s.kind, s.address, s.zip, s.city, s.province, s.active, s.organization_id, o.name AS organization_name
    FROM public.sites s LEFT JOIN public.organizations o ON o.id=s.organization_id
    WHERE ($1::int[] = '{}' OR s.id = ANY($1::int[])) AND ($2 OR s.active) ORDER BY s.sort_order, s.name`, [ids, all]);
  res.json(rows);
}));

// ---------------- Registro attività ----------------
r.get('/audit', requireAdmin, ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  res.json(await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));

// Azzeramento dei contratti (contratti, fascicoli, credenziali, contatori di protocollo). Le organizzazioni e le sedi sono
// dell'anagrafica unica e non si toccano; le impostazioni Business delle organizzazioni (org_ext) restano.
r.post('/reset', requireAdmin, ah(async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
  if (confirm !== 'AZZERA') throw bad('Per confermare scrivi AZZERA');
  const before = await one('SELECT (SELECT count(*) FROM contracts)::int AS contracts');
  await q('DELETE FROM contracts');
  await q('DELETE FROM protocol_counters');
  await audit(req, 'DATA_RESET', 'system', null, before);
  res.json({ ok: true, deleted: before });
}));

export default r;
