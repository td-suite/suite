import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse } from '../lib/util.js';
import { requireRole, isSuper, Params, siteScope, companyWide, canSite, assertCompany, assertSite, FINANCE_ROLES, grantSiteIdsSql } from '../lib/access.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const ibanRe = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

// ---------------- Aziende (anagrafica unica) ----------------
// Le aziende di Cash sono le organizzazioni della Suite con kind SOCIETA o GRUPPO (public.organizations, Amministrazione >
// Organizzazioni): ragione sociale, partita IVA, indirizzo e contatti si modificano lì. Qui restano i soli campi Cash
// (org_ext): piè di pagina e logo della distinta, IBAN di versamento, riferimenti SEPA, capofila. La riga di org_ext nasce
// alla prima scrittura (upsert).
const EXT_FIELDS = {
  letterhead_footer: opt(z.string().max(600)),
};
const sepaFields = {
  iban: opt(z.string().transform((v) => v.replace(/\s/g, '').toUpperCase()).refine((v) => !v || ibanRe.test(v), 'IBAN non valido')),
  bic: opt(z.string().max(11)),
  sepa_mandate_id: opt(z.string().max(35)),
  sepa_mandate_date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  is_franchisor: z.boolean().optional(),
};
const ORG_EXT_COLS = ['letterhead_footer', 'iban', 'bic', 'sepa_mandate_id', 'sepa_mandate_date', 'is_franchisor'];
const COMPANY_COLS = `c.id, c.code, c.name, c.kind, c.vat_number, c.tax_code, c.address, c.zip, c.city, c.province, c.phone, c.email, c.pec, c.website,
  c.letterhead_footer, c.iban, c.bic, c.sepa_mandate_id, c.sepa_mandate_date, c.sepa_first_done, c.is_franchisor, c.active, c.configured,
  (c.logo IS NOT NULL) AS has_logo, c.created_at`;

r.get('/companies', ah(async (req, res) => {
  const P = new Params();
  const rows = await many(`SELECT ${COMPANY_COLS},
      (SELECT count(*)::int FROM sites_v s WHERE s.company_id=c.id AND s.active) AS sites_count,
      (SELECT count(*)::int FROM users u WHERE u.company_id=c.id AND u.active) AS users_count,
      (SELECT count(*)::int FROM company_bank_accounts b WHERE b.company_id=c.id AND b.active) AS accounts_count
    FROM companies_v c WHERE ${isSuper(req.user) ? 'TRUE' : `c.id = ${P.add(req.user.company_id)}`} ORDER BY c.is_franchisor DESC, c.active DESC, c.name`, P.values);
  res.json(rows);
}));

// Impostazioni Cash dell'azienda: upsert su org_ext. SUPERADMIN tutto, ADMIN solo il piè di pagina della propria azienda.
r.put('/companies/:id', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  if (!await one('SELECT 1 FROM companies_v WHERE id=$1', [id])) throw notFound('Organizzazione non presente nell\'anagrafica (serve una società o un gruppo)');
  const schema = isSuper(req.user) ? z.object({ ...EXT_FIELDS, ...sepaFields }).partial() : z.object(EXT_FIELDS).partial();
  const d = parse(schema, req.body);
  const cols = ORG_EXT_COLS.filter((k) => d[k] !== undefined);
  if (!cols.length) return res.json({ ok: true });
  await q(`INSERT INTO org_ext (org_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
    ON CONFLICT (org_id) DO UPDATE SET ${cols.map((k) => `${k}=EXCLUDED.${k}`).join(', ')}, updated_at=now()`, [id, ...cols.map((k) => d[k])]);
  await audit(req, 'COMPANY_UPDATE', 'company', id, d);
  res.json({ ok: true });
}));

r.post('/companies/:id/logo', requireRole('SUPERADMIN', 'ADMIN'), upload.single('logo'), ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  if (!await one('SELECT 1 FROM companies_v WHERE id=$1', [id])) throw notFound();
  if (!req.file) throw bad('File mancante');
  if (!['image/png', 'image/jpeg'].includes(req.file.mimetype)) throw bad('Formato ammesso: PNG o JPEG');
  await q(`INSERT INTO org_ext (org_id, logo, logo_mime) VALUES ($1,$2,$3) ON CONFLICT (org_id) DO UPDATE SET logo=EXCLUDED.logo, logo_mime=EXCLUDED.logo_mime, updated_at=now()`, [id, req.file.buffer, req.file.mimetype]);
  await audit(req, 'COMPANY_LOGO', 'company', id);
  res.json({ ok: true });
}));

r.get('/companies/:id/logo', ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  const c = await one('SELECT logo, logo_mime FROM org_ext WHERE org_id=$1', [id]);
  if (!c?.logo) throw notFound();
  res.type(c.logo_mime).set('Cache-Control', 'private, max-age=300').send(c.logo);
}));

// ---------------- Sedi ----------------
// Impostazioni Cash della sede (site_ext). Codice, nome, indirizzo, città, provincia e stato attivo sono dell'anagrafica unica.
const siteSchema = z.object({
  company_id: z.number().int().optional(),
  site_email: opt(z.string().email().or(z.literal(''))),
  host_email: opt(z.string().email().or(z.literal(''))),
  cash_float: z.number().min(0).max(100000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data di avvio non valida'),
  ownership: z.enum(['PROPRIA', 'OSPITATA']).default('OSPITATA'),
  // orari: chiavi 1..7 (lun..dom) -> { open: 'HH:MM', close: 'HH:MM' }
  hours: z.record(z.string().regex(/^[1-7]$/), z.object({ open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional() })).default({}),
  hours_note: opt(z.string().max(300)),
  expected_registers: z.number().int().min(1).max(20).default(1),
  operating_days: z.string().regex(/^[01]{7}$/).default('1111110'),
  pos_terminals: opt(z.string().max(300)),
  float_reason: z.string().max(300).optional(),
  host_name: opt(z.string().max(200)),
  host_vat: opt(z.string().max(20)),
  royalty_fixed_monthly: z.number().min(0).max(1_000_000).default(0),
  royalty_pct: z.number().min(0).max(100).default(0),
  royalty_base: z.enum(['TOTALE', 'CONTANTI_POS', 'CONTANTI']).default('TOTALE'),
  royalty_vat_rate: z.number().min(0).max(100).default(0),
  royalty_notes: opt(z.string().max(1000)),
});
// ---------------- Conti correnti aziendali ----------------
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const accountSchema = z.object({
  label: z.string().trim().min(2).max(80),
  bank_name: z.string().trim().max(120).nullable().optional(),
  iban: z.string().trim().transform((v) => v.replace(/\s+/g, '').toUpperCase()).refine((v) => IBAN_RE.test(v), 'IBAN non valido'),
  bic: z.string().trim().max(11).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  is_default: z.boolean().default(false),
  active: z.boolean().default(true),
});

// Elenco: chi conferma gli accrediti deve poter scegliere il conto
r.get('/companies/:id/bank-accounts', requireRole(...FINANCE_ROLES), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  res.json(await many('SELECT id, company_id, label, bank_name, iban, bic, notes, is_default, active, created_at FROM company_bank_accounts WHERE company_id=$1 ORDER BY active DESC, is_default DESC, label', [cid]));
}));

r.post('/companies/:id/bank-accounts', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  const d = parse(accountSchema, req.body);
  if (await one('SELECT 1 FROM company_bank_accounts WHERE company_id=$1 AND iban=$2', [cid, d.iban])) throw bad('IBAN già presente per questa azienda');
  const row = await tx(async (c) => {
    if (d.is_default) await c.query('UPDATE company_bank_accounts SET is_default=FALSE WHERE company_id=$1', [cid]);
    return (await c.query(`INSERT INTO company_bank_accounts (company_id, label, bank_name, iban, bic, notes, is_default, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cid, d.label, d.bank_name || null, d.iban, d.bic || null, d.notes || null, d.is_default, d.active])).rows[0];
  });
  await audit(req, 'BANK_ACCOUNT_CREATE', 'bank_account', row.id, { company_id: cid, label: d.label, iban: d.iban });
  res.status(201).json(row);
}));

r.put('/companies/:id/bank-accounts/:aid', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  const acc = await one('SELECT * FROM company_bank_accounts WHERE id=$1 AND company_id=$2', [Number(req.params.aid), cid]);
  if (!acc) throw notFound('Conto non trovato');
  const d = parse(z.object(Object.fromEntries(Object.entries(accountSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()]))), req.body);
  await tx(async (c) => {
    if (d.is_default) await c.query('UPDATE company_bank_accounts SET is_default=FALSE WHERE company_id=$1', [cid]);
    const cols = Object.keys(d);
    if (cols.length) await c.query(`UPDATE company_bank_accounts SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [acc.id, ...cols.map((k) => d[k])]);
  });
  await audit(req, 'BANK_ACCOUNT_UPDATE', 'bank_account', acc.id, d);
  res.json(await one('SELECT * FROM company_bank_accounts WHERE id=$1', [acc.id]));
}));

const ROYALTY_COLS = ['royalty_fixed_monthly', 'royalty_pct', 'royalty_vat_rate', 'royalty_base'];
const EXT_COLS = ['company_id', 'cash_float', 'operating_days', 'pos_terminals', 'start_date', 'ownership', 'hours', 'hours_note', 'expected_registers',
  'site_email', 'host_name', 'host_vat', 'host_email', ...ROYALTY_COLS, 'royalty_notes'];
// Utenti del modulo con la sede negli scope del grant Suite (sostituisce il conteggio su user_sites)
const USERS_COUNT_SQL = `(SELECT count(DISTINCT pu.id)::int FROM public.grants g JOIN public.grant_scopes gs ON gs.grant_id=g.id JOIN public.users pu ON pu.id=g.user_id
      WHERE g.module_key='cash' AND NOT g.proposed AND gs.scope_type='SITE' AND gs.scope_id=s.id AND pu.status='ACTIVE')`;

// ---------------- Sedi (anagrafica unica) ----------------
// Le sedi vivono in public.sites (Amministrazione > Sedi): qui si leggono con le impostazioni Cash (site_ext).
// Senza `all=1` l'elenco contiene solo le sedi configurate in Cash (vista sites_v): è quello usato dai selettori.
// Con `all=1` (pagina Sedi) l'elenco è l'intera anagrafica visibile all'utente, con `configured` a indicare la presenza
// delle impostazioni Cash: l'amministratore può configurare una sede nuova senza crearla qui.
r.get('/sites', ah(async (req, res) => {
  const P = new Params();
  if (req.query.all === '1') {
    const where = [];
    if (isSuper(req.user)) where.push('TRUE');
    else if (companyWide(req.user)) where.push(`(e.company_id = ${P.add(req.user.company_id)} OR e.site_id IS NULL)`);
    else where.push(`s.id = ANY(${P.add(req.user.site_ids || [])}::int[])`);
    if (req.query.company_id) where.push(`e.company_id = ${P.add(Number(req.query.company_id))}`);
    if (req.query.active === '1') where.push('s.active');
    const rows = await many(`SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
        (e.site_id IS NOT NULL) AS configured, e.company_id, e.cash_float, e.operating_days, e.pos_terminals, e.start_date, e.ownership, e.hours, e.hours_note,
        e.expected_registers, e.site_email, e.host_name, e.host_vat, e.host_email, e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
        e.created_at, e.updated_at, c.name AS company_name, c.code AS company_code, ${USERS_COUNT_SQL} AS users_count
      FROM public.sites s LEFT JOIN site_ext e ON e.site_id=s.id LEFT JOIN companies_v c ON c.id=e.company_id
      WHERE ${where.join(' AND ')} ORDER BY (e.site_id IS NULL), c.name NULLS LAST, s.name`, P.values);
    return res.json(rows);
  }
  const where = [siteScope(req.user, P)];
  if (req.query.company_id) where.push(`s.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.active === '1') where.push('s.active');
  const rows = await many(`SELECT s.*, TRUE AS configured, c.name AS company_name, c.code AS company_code, ${USERS_COUNT_SQL} AS users_count
    FROM sites_v s JOIN companies_v c ON c.id=s.company_id WHERE ${where.join(' AND ')} ORDER BY c.name, s.name`, P.values);
  res.json(rows);
}));

r.get('/sites/:id/float-history', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  await assertSite(req.user, Number(req.params.id));
  res.json(await many(`SELECT h.*, u.full_name FROM cash_float_history h LEFT JOIN users u ON u.id=h.changed_by
    WHERE site_id=$1 ORDER BY changed_at DESC`, [Number(req.params.id)]));
}));

// Impostazioni Cash di una sede dell'anagrafica unica: upsert su site_ext (la riga nasce alla prima scrittura).
// Non si creano, rinominano o disattivano sedi: si fa in Amministrazione > Sedi.
r.put('/sites/:id', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const reg = await one('SELECT id, code, name, active FROM public.sites WHERE id=$1', [id]);
  if (!reg) throw notFound('Sede non presente nell\'anagrafica della Suite');
  const site = await one('SELECT * FROM sites_v WHERE id=$1', [id]);
  if (site && !canSite(req.user, site)) throw forbidden('Sede non autorizzata');
  // partial() applica comunque i default: li rimuovo per non azzerare i campi omessi
  const partial = z.object(Object.fromEntries(Object.entries(siteSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()])));
  const d = parse(site ? partial : siteSchema, req.body);
  if (!site) {
    if (!isSuper(req.user)) d.company_id = req.user.company_id;
    if (!d.company_id) throw bad('Indica l\'azienda Cash della sede');
    assertCompany(req.user, d.company_id);
    if (!await one('SELECT 1 FROM companies_v WHERE id=$1', [d.company_id])) throw bad('Azienda inesistente: scegli una società o un gruppo dell\'anagrafica');
  } else if (d.company_id != null && d.company_id !== site.company_id) {
    if (!isSuper(req.user)) throw forbidden('Solo il super amministratore sposta una sede su un\'altra azienda');
    if (await one('SELECT 1 FROM cash_reports WHERE site_id=$1', [id])) throw bad('La sede ha rendiconti: l\'azienda non si può cambiare');
  }
  if ((d.ownership || site?.ownership) === 'PROPRIA') Object.assign(d, { host_name: null, host_vat: null, host_email: null, royalty_fixed_monthly: 0, royalty_pct: 0, royalty_vat_rate: 0, royalty_notes: null });
  await tx(async (c) => {
    if (!site) {
      await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,NULL,$2,$3,$4)', [id, d.cash_float, req.user.id, 'Impostazione iniziale']);
      await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, d.royalty_fixed_monthly, d.royalty_pct, d.royalty_vat_rate, d.royalty_base, req.user.id]);
    } else {
      if (d.cash_float != null && Number(d.cash_float) !== Number(site.cash_float)) {
        if (!d.float_reason) throw bad('Indica il motivo della variazione del fondo cassa');
        await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,$2,$3,$4,$5)',
          [id, site.cash_float, d.cash_float, req.user.id, d.float_reason]);
      }
      if (ROYALTY_COLS.some((k) => d[k] != null && String(d[k]) !== String(site[k]))) {
        await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, d.royalty_fixed_monthly ?? site.royalty_fixed_monthly, d.royalty_pct ?? site.royalty_pct, d.royalty_vat_rate ?? site.royalty_vat_rate, d.royalty_base ?? site.royalty_base, req.user.id]);
      }
    }
    delete d.float_reason;
    if (d.hours !== undefined) d.hours = JSON.stringify(d.hours);
    const cols = EXT_COLS.filter((k) => d[k] !== undefined);
    if (!cols.length) return;
    if (site) await c.query(`UPDATE site_ext SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE site_id=$1`, [id, ...cols.map((k) => d[k])]);
    else await c.query(`INSERT INTO site_ext (site_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [id, ...cols.map((k) => d[k])]);
  });
  await audit(req, site ? 'SITE_UPDATE' : 'SITE_CONFIGURE', 'site', id, req.body);
  res.json({ ok: true, id });
}));

// ---------------- Utenti ----------------
// Gli utenti, i profili e le sedi assegnate si gestiscono nella Suite (Amministrazione > Utenti): qui resta l'elenco in sola
// lettura (serve per aprire la cassa di un operatore e per il controllo mensile) e il fondo cassa personale dell'operatore,
// che è un dato del processo di cassa e non dell'account.
r.get('/users', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `u.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.company_id) where.push(`u.company_id = ${P.add(Number(req.query.company_id))}`);
  const rows = await many(`SELECT u.id, u.email, u.full_name, u.role, u.company_id, u.auth_provider, u.active, u.cash_float, u.last_login_at, c.name AS company_name,
      ${grantSiteIdsSql('u.email')} AS site_ids
    FROM users u LEFT JOIN companies_v c ON c.id=u.company_id WHERE ${where.join(' AND ')} ORDER BY u.active DESC, u.full_name`, P.values);
  res.json(rows);
}));

r.put('/users/:id/cash-float', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const u = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!u) throw notFound();
  if (!isSuper(req.user) && (u.role === 'SUPERADMIN' || u.company_id !== req.user.company_id)) throw forbidden();
  const d = parse(z.object({ cash_float: z.number().min(0).max(100000).nullable() }), req.body);
  await q('UPDATE users SET cash_float=$2, updated_at=now() WHERE id=$1', [id, u.role === 'OPERATOR' ? d.cash_float : null]);
  await audit(req, 'USER_CASH_FLOAT', 'user', id, d);
  res.json({ ok: true });
}));

// ---------------- Impostazioni (creditore SEPA) ----------------
const SETTINGS_KEYS = ['creditor_name', 'creditor_iban', 'creditor_bic', 'creditor_id', 'royalty_invoice_prefix', 'pickup_alert_days', 'daily_alert_hour', 'daily_alert_enabled', 'daily_summary_admins', 'closing_alert_delay_minutes'];

r.get('/settings', requireRole('SUPERADMIN'), ah(async (_req, res) => {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [SETTINGS_KEYS]);
  res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
}));

r.put('/settings', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({
    creditor_name: z.string().max(70).optional(),
    creditor_iban: z.string().transform((v) => v.replace(/\s/g, '').toUpperCase()).refine((v) => !v || ibanRe.test(v), 'IBAN non valido').optional(),
    creditor_bic: z.string().max(11).optional(),
    creditor_id: z.string().max(35).optional(),
    royalty_invoice_prefix: z.string().max(10).optional(),
    pickup_alert_days: z.string().regex(/^\d{1,2}$/).optional(),
    daily_alert_hour: z.string().regex(/^([01]?\d|2[0-3])$/).optional(),
    closing_alert_delay_minutes: z.string().regex(/^\d{1,3}$/).optional(),
    daily_alert_enabled: z.enum(['true', 'false']).optional(),
    daily_summary_admins: z.enum(['true', 'false']).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) {
    await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  }
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, d);
  res.json({ ok: true });
}));

// ---------------- Audit ----------------
r.get('/audit', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `u.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.action) where.push(`a.action = ${P.add(req.query.action)}`);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ${limit}`, P.values));
}));

export default r;
