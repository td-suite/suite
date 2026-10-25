// Moduli (home a widget), anagrafiche (sedi, organizzazioni, persone), rubrica, notifiche, audit
import { getSetting, normName } from '../lib/util.js';
import { ensureUserForPerson, autoAccountForPerson } from '../lib/accounts.js';
import { syncPositionFromPerson, ensureSiteNodes } from './orgcat.js';
import { geocodeAddress, autoGeocodeSite } from '../lib/geocode.js';
import { applyCentralino } from '../lib/centralino.js';
import { resolveCatalog } from './orgcat.js';
import { Router } from 'express';
import { activeModuleKeys, moduleHref } from '../lib/modules.js';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound, readLog } from '../lib/util.js';
import { requireAdmin, isAdmin, hasModule } from '../lib/access.js';
import { indexPersonById, indexSite, indexOrg, removeFromIndex } from '../lib/search.js';

const r = Router();

// ---- Home: i moduli visibili all'utente, raggruppati per area, con contatori (riempiti dal modulo cockpit/legacy quando disponibili)
export const AREAS = [
  { key: 'DIREZIONE', name: 'Direzione', color: '#01212C' },
  { key: 'FINANCE', name: 'Finance', color: '#1C505E' },
  { key: 'RETAIL_FLOW', name: 'Retail and Flow Management', color: '#C77D2A' },
  { key: 'OPERATIONS', name: 'Operations', color: '#2F7D5B' },
  { key: 'HQS', name: 'HQS · Qualità, Sicurezza, SGI', color: '#71B1BD' },
  { key: 'PEOPLE', name: 'People', color: '#8E5BA6' },
];

r.get('/home/modules', ah(async (req, res) => {
  const mods = await many('SELECT key, area, name, tagline, icon, kind, legacy_url, route, restricted, sort_order, scope_type FROM modules WHERE active ORDER BY area, sort_order');
  const u = req.user;
  const active = await activeModuleKeys();   // moduli travasati (MIRROR/LIVE): si aprono dentro la Suite
  const visible = mods.filter((m) => {
    if (m.key === 'admin') return isAdmin(u);
    if (m.kind === 'PUBLIC') return true;                 // vetrine pubbliche: sempre raggiungibili
    return Boolean(u.grants[m.key]) || (isAdmin(u) && !m.restricted) || (u.level === 'OWNER');
  }).map((m) => ({ ...m, profile: u.grants[m.key]?.profile || (isAdmin(u) ? 'ADMIN' : null), href: moduleHref(m, active), inside: m.kind === 'NATIVE' || active.has(m.key), module_mode: active.get(m.key) || null }));
  const areas = AREAS.map((a) => ({ ...a, modules: visible.filter((m) => m.area === a.key) })).filter((a) => a.modules.length);
  res.json({ areas });
}));

r.get('/modules', ah(async (req, res) => {
  const rows = await many('SELECT * FROM modules ORDER BY area, sort_order');
  res.json(rows.map((m) => ({ ...m, sso_secret: undefined, sso_configured: Boolean(m.sso_secret) })));
}));
r.put('/modules/:key', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).optional(), tagline: z.string().nullable().optional(), legacy_url: z.string().url().nullable().optional(),
    active: z.boolean().optional(), sort_order: z.number().int().optional(), sso_secret: z.string().min(24).nullable().optional() }), req.body);
  if (b.sso_secret !== undefined && req.user.level !== 'OWNER') throw bad('Il segreto SSO lo imposta solo il titolare');
  const sets = []; const params = [req.params.key];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  await q(`UPDATE modules SET ${sets.join(', ')}, updated_at=now() WHERE key=$1`, params);
  await audit(req, 'MODULE_UPDATED', { module: req.params.key, data: { ...b, sso_secret: b.sso_secret ? '(impostato)' : undefined } });
  res.json({ ok: true });
}));

// ---- Sedi
const siteSchema = z.object({
  code: z.string().min(2).max(40), name: z.string().min(2).max(250), short_name: z.string().max(120).nullable().optional(),
  kind: z.enum(['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO']).optional(),
  organization_id: z.number().int().nullable().optional(), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(),
  province: z.string().max(4).nullable().optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(), org_node: z.boolean().optional(), opening_hours: z.string().nullable().optional(), opening_hours_json: z.record(z.array(z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) })).max(3)).nullable().optional(), legacy_brand: z.string().nullable().optional(),
  studiolab_code: z.string().nullable().optional(), active: z.boolean().optional(), needs_review: z.boolean().optional(), sort_order: z.number().int().optional(), notes: z.string().nullable().optional(),
});

// Orari strutturati → testo riassuntivo (es. "Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00"), giorni consecutivi uguali raggruppati
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; const DAY_LABEL = { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Gio', fri: 'Ven', sat: 'Sab', sun: 'Dom' };
export function hoursText(j) {
  if (!j) return null;
  const fmt = (d) => (j[d] || []).map((r) => `${r.from.replace(/^0/, '')}-${r.to.replace(/^0/, '')}`).join(', ');
  const groups = [];
  for (const d of DAYS) { const t = fmt(d); if (!t) continue; const last = groups[groups.length - 1]; if (last && last.t === t && DAYS.indexOf(last.to) === DAYS.indexOf(d) - 1) last.to = d; else groups.push({ from: d, to: d, t }); }
  return groups.map((g) => `${DAY_LABEL[g.from]}${g.from !== g.to ? `-${DAY_LABEL[g.to]}` : ''} ${g.t}`).join('; ') || null;
}
const withHours = (b) => { if (b.opening_hours_json !== undefined) { b.opening_hours_json = b.opening_hours_json ? JSON.stringify(b.opening_hours_json) : null; if (b.opening_hours_json) b.opening_hours = hoursText(JSON.parse(b.opening_hours_json)); } return b; };

r.get('/sites', ah(async (req, res) => {
  const all = isAdmin(req.user) || req.query.all === '1';
  // Responsabile di sede: dall'organigramma (responsabile del nodo Sede collegato), mai testo libero
  const rows = await many(`SELECT s.*, o.name AS organization_name, (SELECT count(*)::int FROM users u WHERE u.site_id=s.id AND u.status='ACTIVE') AS users_count,
      h.person_id AS manager_person_id, h.person_name AS manager_name, h.role_name AS manager_role, h.unit_id AS org_unit_id
    FROM sites s LEFT JOIN organizations o ON o.id=s.organization_id
    LEFT JOIN LATERAL (SELECT op.person_id, op.unit_id, pp.last_name || ' ' || pp.first_name AS person_name, jr.name AS role_name FROM org_units u JOIN org_positions op ON op.unit_id=u.id AND op.is_head
        JOIN people pp ON pp.id=op.person_id LEFT JOIN job_roles jr ON jr.id=op.role_id WHERE u.kind='SEDE' AND u.site_id=s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
    ${all ? '' : 'WHERE s.active'} ORDER BY lower(s.name)`);
  res.json(rows.map((s) => (isAdmin(req.user) ? s : { ...s, legacy_refs: undefined, notes: undefined })));
}));
const saveCoords = (id, g) => q('UPDATE sites SET lat=$2, lng=$3, updated_at=now() WHERE id=$1 AND (lat IS NULL OR lng IS NULL)', [id, g.lat, g.lng]);
// Coordinate dall'indirizzo (pulsante nel form Sedi). Non salva: restituisce lat/lng da confermare nel form.
r.post('/geocode', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({ address: z.string().max(250).nullable().optional(), zip: z.string().max(10).nullable().optional(), city: z.string().max(120).nullable().optional(), province: z.string().max(4).nullable().optional() }), req.body);
  const g = await geocodeAddress(b);
  if (!g) throw bad('Indirizzo non trovato: controlla via, civico e città');
  res.json(g);
}));
// Completa le coordinate mancanti di tutte le sedi (una al secondo, in coda)
r.post('/sites/geocode-missing', requireAdmin, ah(async (req, res) => {
  const rows = await many(`SELECT id, address, zip, city, province FROM sites WHERE (lat IS NULL OR lng IS NULL) AND (address IS NOT NULL OR city IS NOT NULL) ORDER BY id`);
  (async () => { for (const s of rows) { try { const g = await geocodeAddress(s); if (g) await saveCoords(s.id, g); } catch (e) { console.warn('[geocode]', s.id, e.message); } } })();
  res.json({ queued: rows.length });
}));
r.post('/sites', requireAdmin, ah(async (req, res) => {
  const b = withHours(parse(siteSchema, req.body));
  const cols = Object.keys(b); const vals = Object.values(b);
  const s = await one(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'SITE_CREATED', { entity: 'site', entityId: s.id, label: `${s.code} ${s.name}` });
  indexSite(s).catch(() => {});
  autoGeocodeSite(s, saveCoords);
  await ensureSiteNodes().catch(() => {});
  res.status(201).json(s);
}));
r.put('/sites/:id', requireAdmin, ah(async (req, res) => {
  const b = withHours(parse(siteSchema.partial(), req.body));
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const s = await one(`UPDATE sites SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!s) throw notFound();
  await audit(req, 'SITE_UPDATED', { entity: 'site', entityId: s.id, label: `${s.code} ${s.name}`, data: b });
  indexSite(s).catch(() => {});
  autoGeocodeSite(s, saveCoords);
  res.json(s);
}));
// Unione di due sedi duplicate: la sorgente confluisce nella destinazione (riferimenti legacy, utenti, persone)

// ---- Organizzazioni
const orgSchema = z.object({
  kind: z.enum(['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO']).optional(), code: z.string().max(40).nullable().optional(), name: z.string().min(2).max(250),
  vat_number: z.string().max(20).nullable().optional(), tax_code: z.string().max(20).nullable().optional(), sdi: z.string().max(10).nullable().optional(), pec: z.string().nullable().optional(),
  email: z.string().nullable().optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(), zip: z.string().nullable().optional(), city: z.string().nullable().optional(),
  province: z.string().max(4).nullable().optional(), website: z.string().nullable().optional(), active: z.boolean().optional(), needs_review: z.boolean().optional(), notes: z.string().nullable().optional(),
});
r.get('/organizations', ah(async (req, res) => {
  const rows = await many(`SELECT o.*, (SELECT count(*)::int FROM sites s WHERE s.organization_id=o.id) AS sites_count, (SELECT count(*)::int FROM users u WHERE u.organization_id=o.id) AS users_count FROM organizations o ORDER BY lower(o.name)`);
  res.json(isAdmin(req.user) ? rows : rows.map((o) => ({ id: o.id, kind: o.kind, code: o.code, name: o.name, city: o.city, province: o.province })));
}));
r.post('/organizations', requireAdmin, ah(async (req, res) => {
  const b = parse(orgSchema, req.body);
  const cols = Object.keys(b); const vals = Object.values(b);
  const o = await one(`INSERT INTO organizations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'ORG_CREATED', { entity: 'organization', entityId: o.id, label: o.name });
  indexOrg(o).catch(() => {});
  res.status(201).json(o);
}));
r.put('/organizations/:id', requireAdmin, ah(async (req, res) => {
  const b = parse(orgSchema.partial(), req.body);
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const o = await one(`UPDATE organizations SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!o) throw notFound();
  await audit(req, 'ORG_UPDATED', { entity: 'organization', entityId: o.id, label: o.name, data: b });
  indexOrg(o).catch(() => {});
  res.json(o);
}));

// ---- Persone e rubrica (modulo "rubrica"; i dati contrattuali restano in Contracts: qui solo chi è, dove, cosa fa)
const personSchema = z.object({
  kind: z.enum(['DIPENDENTE', 'LP', 'MEDICO', 'SANITARIO', 'ESTERNO', 'DIRIGENTE']).optional(), status: z.enum(['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO']).optional(),
  last_name: z.string().min(1), first_name: z.string().min(1), title: z.string().max(20).nullable().optional(), sex: z.enum(['F', 'M']).nullable().optional(),
  email: z.string().email().nullable().optional(), phone: z.string().nullable().optional(), phone_office: z.string().nullable().optional(), phone_ext: z.string().max(10).nullable().optional(), area: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(), role_id: z.number().int().nullable().optional(), unit_id: z.number().int().nullable().optional(), unit: z.string().max(160).nullable().optional(), discipline: z.string().nullable().optional(), manager_person_id: z.number().int().nullable().optional(), no_manager: z.boolean().optional(), site_id: z.number().int().nullable().optional(),
  organization_id: z.number().int().nullable().optional(), tax_code: z.string().max(16).nullable().optional(), needs_review: z.boolean().optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), birth_place: z.string().max(120).nullable().optional(), vat_number: z.string().max(20).nullable().optional(),
  address: z.string().max(250).nullable().optional(), zip: z.string().max(10).nullable().optional(), city: z.string().max(120).nullable().optional(), province: z.string().max(4).nullable().optional(),
  hired_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), terminated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const PERSONAL_COLS = 'p.sex, p.birth_date, p.birth_place, p.tax_code, p.vat_number, p.address, p.zip, p.city, p.province, p.hired_at, p.terminated_at';
const RUBRICA_COLS = `p.id, p.kind, p.status, p.last_name, p.first_name, p.title, p.email, p.phone, p.phone_office, p.phone_ext, p.area, p.job_title, p.role_id, p.unit_id, (SELECT name FROM org_units ou WHERE ou.id=p.unit_id) AS unit_name, org_unit_path(p.unit_id) AS unit_path, p.discipline, people_manager(p.id) AS manager_person_id, p.manager_person_id AS manager_override_id, p.no_manager, people_manager_auto(p.id) AS manager_auto_id, (SELECT ma.last_name || ' ' || ma.first_name FROM people ma WHERE ma.id = people_manager_auto(p.id)) AS manager_auto_name, p.site_id, p.organization_id, p.photo_file_id,
  s.name AS site_name, s.city AS site_city, o.name AS organization_name, (SELECT mm.last_name || ' ' || mm.first_name FROM people mm WHERE mm.id = people_manager(p.id)) AS manager_name,
  (SELECT u.id FROM users u WHERE u.person_id=p.id LIMIT 1) AS user_id, (SELECT u.level FROM users u WHERE u.person_id=p.id LIMIT 1) AS user_level, (SELECT u.avatar_file_id FROM users u WHERE u.person_id=p.id LIMIT 1) AS avatar_file_id,
  (SELECT coalesce(json_agg(json_build_object('id', op.id, 'unit_id', op.unit_id, 'unit_name', ou.name, 'unit_kind', ou.kind, 'parent_name', pu.name, 'role_id', op.role_id, 'role_name', jr.name, 'is_head', op.is_head) ORDER BY op.is_head DESC, ou.kind, ou.name), '[]')
     FROM org_positions op JOIN org_units ou ON ou.id=op.unit_id LEFT JOIN org_units pu ON pu.id=ou.parent_id LEFT JOIN job_roles jr ON jr.id=op.role_id WHERE op.person_id=p.id) AS positions`;
r.get('/people', ah(async (req, res) => {
  const { qtext = '', area = '', role_id = '', kind = '', site_id = '', unit_id = '', status = 'ATTIVO', all = '' } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (qtext) where.push(`lower(unaccent(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,'') || ' ' || coalesce(p.area,''))) LIKE lower(unaccent(${p(`%${qtext}%`)}))`);
  if (area) where.push(`p.area = ${p(area)}`);
  if (role_id) where.push(`p.role_id = ${p(Number(role_id))}`);
  if (kind) where.push(`p.kind = ${p(kind)}`);
  if (site_id) where.push(`p.site_id = ${p(Number(site_id))}`);
  if (unit_id) where.push(`(p.unit_id = ${p(Number(unit_id))} OR EXISTS (SELECT 1 FROM org_positions op WHERE op.person_id=p.id AND op.unit_id = ${p(Number(unit_id))}))`);
  if (status && !all) where.push(`p.status = ${p(status)}`);
  const rows = await many(`SELECT ${RUBRICA_COLS}${isAdmin(req.user) ? `, ${PERSONAL_COLS}` : ''} FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(p.last_name), lower(p.first_name) LIMIT 1000`, params);
  // Dati personali minimi per chi non è amministratore: niente codice fiscale, niente date; telefoni visibili (rubrica aziendale)
  res.json(rows);
}));
// Accesso dalla persona (amministratori): crea o aggancia l'utente, con password provvisoria per gli esterni
r.post('/people/:id/account', requireAdmin, ah(async (req, res) => {
  try {
    const out = await ensureUserForPerson(Number(req.params.id), { actor: req.user, onlyIfActive: false, sendInvite: req.body?.send_invite !== false });
    res.status(out.created ? 201 : 200).json({ user_id: out.user.id, created: out.created, provider: out.provider, temporaryPassword: out.temporaryPassword });
  } catch (e) { throw bad(e.message); }
}));
// ---- Eliminazioni (amministratori). Un elemento referenziato da dati operativi non si elimina: si disattiva.
async function moduleRefs(table, col, id) {
  // tabelle di qualsiasi schema (moduli compresi) con FK verso public.<table>: quante righe puntano a questo id
  const fks = (await q(`SELECT tc.table_schema, tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_schema='public' AND ccu.table_name=$1 AND ccu.column_name=$2`, [table, col])).rows;
  const out = [];
  for (const f of fks) {
    if (f.table_schema === 'public' && ['grant_scopes', 'users', 'people', 'sites', 'read_log', 'audit_log', 'search_index', 'notifications', 'files', 'api_keys', 'ingest_batches', 'module_state', 'grants', 'app_settings', 'org_units', 'org_positions'].includes(f.table_name)) continue;
    if (/_ext$/.test(f.table_name) || f.table_name === 'person_areas') continue;   // estensioni: vanno via in cascata
    const n = (await q(`SELECT count(*)::int AS n FROM "${f.table_schema}"."${f.table_name}" WHERE "${f.column_name}"=$1`, [id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    if (n) out.push(`${f.table_schema === 'public' ? '' : f.table_schema + ': '}${f.table_name} (${n})`);
  }
  return out;
}
r.delete('/sites/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const s = await one('SELECT * FROM sites WHERE id=$1', [id]); if (!s) throw notFound();
  const refs = await moduleRefs('sites', 'id', id);
  if (refs.length) throw bad(`La sede ha dati collegati (${refs.join(', ')}): disattivala invece di eliminarla`);
  await q('UPDATE people SET site_id=NULL WHERE site_id=$1', [id]); await q('UPDATE users SET site_id=NULL WHERE site_id=$1', [id]);
  await q('DELETE FROM grant_scopes WHERE scope_type=\'SITE\' AND scope_id=$1', [id]);
  await q('DELETE FROM sites WHERE id=$1', [id]);
  await audit(req, 'SITE_DELETED', { entity: 'site', entityId: id, label: `${s.code} · ${s.name}` });
  res.json({ ok: true });
}));
r.delete('/organizations/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const o = await one('SELECT * FROM organizations WHERE id=$1', [id]); if (!o) throw notFound();
  const sites = (await one('SELECT count(*)::int AS n FROM sites WHERE organization_id=$1', [id])).n;
  if (sites) throw bad(`L'organizzazione ha ${sites} sed${sites === 1 ? 'e' : 'i'} collegat${sites === 1 ? 'a' : 'e'}: eliminale o spostale prima`);
  const refs = await moduleRefs('organizations', 'id', id);
  if (refs.length) throw bad(`L'organizzazione ha dati collegati (${refs.join(', ')}): disattivala invece di eliminarla`);
  await q('UPDATE people SET organization_id=NULL WHERE organization_id=$1', [id]); await q('UPDATE users SET organization_id=NULL WHERE organization_id=$1', [id]);
  await q('DELETE FROM grant_scopes WHERE scope_type=\'ORG\' AND scope_id=$1', [id]);
  await q('DELETE FROM organizations WHERE id=$1', [id]);
  await audit(req, 'ORGANIZATION_DELETED', { entity: 'organization', entityId: id, label: o.name });
  res.json({ ok: true });
}));
// Duplicati: stessa persona (cognome e nome, email e CF compatibili) caricata più volte. Si tiene la scheda più vecchia,
// le copie senza dati collegati vengono eliminate; il responsabile e gli utenti che puntavano alle copie passano alla scheda tenuta.
r.post('/people/dedupe', requireAdmin, ah(async (req, res) => {
  const rows = await many(`SELECT id, last_name, first_name, lower(email) AS email, upper(tax_code) AS cf FROM people ORDER BY id`);
  const groups = new Map();
  for (const p of rows) {
    const key = `${normName(p.last_name)}|${normName(p.first_name)}`;
    const g = groups.get(key) || []; g.push(p); groups.set(key, g);
  }
  let removed = 0, kept = 0; const blocked = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = g[0]; kept++;
    for (const dup of g.slice(1)) {
      // omonimi veri: email o CF diversi e valorizzati su entrambi → non si toccano
      if ((dup.email && keep.email && dup.email !== keep.email) || (dup.cf && keep.cf && dup.cf !== keep.cf)) continue;
      const refs = await moduleRefs('people', 'id', dup.id);
      if (refs.length) { blocked.push(`${dup.last_name} ${dup.first_name} (${refs.join(', ')})`); continue; }
      await q('UPDATE people SET manager_person_id=$2 WHERE manager_person_id=$1', [dup.id, keep.id]);
      await q('UPDATE users SET person_id=$2 WHERE person_id=$1 AND NOT EXISTS (SELECT 1 FROM users x WHERE x.person_id=$2)', [dup.id, keep.id]);
      await q('UPDATE users SET person_id=NULL WHERE person_id=$1', [dup.id]);
      // campi vuoti della scheda tenuta completati dalla copia
      await q(`UPDATE people k SET email=coalesce(k.email,d.email), tax_code=coalesce(k.tax_code,d.tax_code), phone=coalesce(k.phone,d.phone), phone_office=coalesce(k.phone_office,d.phone_office), phone_ext=coalesce(k.phone_ext,d.phone_ext),
        area=coalesce(k.area,d.area), job_title=coalesce(k.job_title,d.job_title), discipline=coalesce(k.discipline,d.discipline), site_id=coalesce(k.site_id,d.site_id), manager_person_id=coalesce(k.manager_person_id,d.manager_person_id), title=coalesce(k.title,d.title), updated_at=now()
        FROM people d WHERE k.id=$1 AND d.id=$2`, [keep.id, dup.id]);
      await q('DELETE FROM people WHERE id=$1', [dup.id]);
      await removeFromIndex('person', dup.id).catch(() => {});
      removed++;
    }
  }
  await audit(req, 'PEOPLE_DEDUPED', { entity: 'person', label: `${removed} copie eliminate`, data: { removed, blocked } });
  res.json({ removed, groups: kept, blocked });
}));
r.delete('/people/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const p = await one('SELECT * FROM people WHERE id=$1', [id]); if (!p) throw notFound();
  const u = await one('SELECT id, level FROM users WHERE person_id=$1', [id]);
  if (u?.level === 'OWNER') throw bad('La persona del titolare non si elimina');
  const refs = await moduleRefs('people', 'id', id);
  if (refs.length) throw bad(`La persona ha dati collegati (${refs.join(', ')}): mettila in stato CESSATO invece di eliminarla`);
  await q('UPDATE people SET manager_person_id=NULL WHERE manager_person_id=$1', [id]);
  if (u) { await q('DELETE FROM grants WHERE user_id=$1', [u.id]); await q('DELETE FROM users WHERE id=$1', [u.id]); }
  await q('DELETE FROM people WHERE id=$1', [id]);
  await removeFromIndex('person', id).catch(() => {});
  await audit(req, 'PERSON_DELETED', { entity: 'person', entityId: id, label: `${p.last_name} ${p.first_name}`, data: { user_deleted: Boolean(u) } });
  res.json({ ok: true });
}));

r.get('/people/switchboard', ah(async (_req, res) => { res.json(await getSetting('community.switchboard', null)); }));
r.get('/people/areas', ah(async (_req, res) => {
  res.json(await many(`SELECT area, count(*)::int AS n FROM people WHERE area IS NOT NULL AND status='ATTIVO' GROUP BY area ORDER BY area`));
}));
r.get('/people/org-chart', ah(async (_req, res) => {
  const rows = await many(`SELECT ${RUBRICA_COLS} FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id WHERE p.status='ATTIVO' ORDER BY lower(p.last_name)`);
  res.json(rows);
}));
r.get('/people/:id', ah(async (req, res) => {
  const row = await one(`SELECT ${RUBRICA_COLS}, ${PERSONAL_COLS}, p.legacy_refs, p.needs_review FROM people p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN people m ON m.id=p.manager_person_id WHERE p.id=$1`, [Number(req.params.id)]);
  if (!row) throw notFound();
  if (!isAdmin(req.user)) { for (const k of ['legacy_refs', 'hired_at', 'terminated_at', 'sex', 'birth_date', 'birth_place', 'tax_code', 'vat_number', 'address', 'zip', 'city', 'province']) delete row[k]; }
  const reports = await many(`SELECT id, last_name, first_name, job_title FROM people WHERE people_manager(id)=$1 AND status='ATTIVO' ORDER BY last_name`, [row.id]);
  // Presentazione scritta dalla persona stessa nel proprio profilo Suite
  const bio = row.user_id ? (await one('SELECT bio FROM users WHERE id=$1', [row.user_id]))?.bio || null : null;
  await readLog(req, { module: 'rubrica', entity: 'person', entityId: row.id });
  res.json({ ...row, reports, bio });
}));
r.post('/people', requireAdmin, ah(async (req, res) => {
  const b = await resolveCatalog(parse(personSchema, req.body));
  const cols = Object.keys(b); const vals = Object.values(b);
  const row = await one(`INSERT INTO people (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
  await audit(req, 'PERSON_CREATED', { entity: 'person', entityId: row.id, label: `${row.last_name} ${row.first_name}` });
  indexPersonById(row.id).catch(() => {});
  autoAccountForPerson(row.id, req.user);   // ogni utente è una persona: l'accesso nasce dalla persona attiva con email
  await syncPositionFromPerson(row);        // reparto + ruolo della scheda = incarico nell'organigramma
  await applyCentralino(row.id);
  res.status(201).json(row);
}));
r.put('/people/:id', ah(async (req, res) => {
  if (!isAdmin(req.user) && !hasModule(req.user, 'rubrica', 'EDITOR')) throw bad('Operazione riservata');
  const b = await resolveCatalog(parse(personSchema.partial(), req.body));
  const sets = []; const params = [Number(req.params.id)];
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE people SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!row) throw notFound();
  await audit(req, 'PERSON_UPDATED', { entity: 'person', entityId: row.id, label: `${row.last_name} ${row.first_name}`, data: b });
  indexPersonById(row.id).catch(() => {});
  if (isAdmin(req.user)) autoAccountForPerson(row.id, req.user);
  if (b.unit_id !== undefined || b.role_id !== undefined) await syncPositionFromPerson(row);
  if (b.phone_ext !== undefined) await applyCentralino(row.id);
  res.json(row);
}));

// ---- Notifiche
r.get('/notifications', ah(async (req, res) => {
  const rows = await many('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  const unread = (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id])).n;
  res.json({ unread, rows });
}));
r.post('/notifications/read', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }), req.body);
  if (b.all) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  else if (b.ids?.length) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::bigint[])', [req.user.id, b.ids]);
  res.json({ ok: true });
}));

// ---- Audit e impostazioni (amministrazione)
r.get('/audit', requireAdmin, ah(async (req, res) => {
  const { action = '', user_id = '', qtext = '', page = 1 } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (action) where.push(`a.action = ${p(action)}`);
  if (user_id) where.push(`a.user_id = ${p(Number(user_id))}`);
  if (qtext) where.push(`(lower(coalesce(a.label,'')) LIKE ${p(`%${String(qtext).toLowerCase()}%`)} OR lower(coalesce(u.full_name,'')) LIKE ${p(`%${String(qtext).toLowerCase()}%`)})`);
  const rows = await many(`SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT 100 OFFSET ${p((Math.max(1, Number(page)) - 1) * 100)}`, params);
  res.json(rows);
}));
r.get('/read-log', requireAdmin, ah(async (req, res) => {
  if (req.user.level !== 'OWNER') throw bad('Riservato al titolare');
  res.json(await many('SELECT r.*, u.full_name AS user_name FROM read_log r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.at DESC LIMIT 200'));
}));
r.get('/settings', requireAdmin, ah(async (_req, res) => {
  res.json(Object.fromEntries((await many(`SELECT key, value FROM app_settings WHERE key NOT LIKE 'reset:%' AND key NOT LIKE 'secret:%'`)).map((s) => [s.key, s.value])));
}));
r.put('/settings/:key', requireAdmin, ah(async (req, res) => {
  if (req.params.key.startsWith('reset:') || req.params.key.startsWith('secret:')) throw bad('Chiave non valida');
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [req.params.key, JSON.stringify(req.body.value), req.user.id]);
  await audit(req, 'SETTING_UPDATED', { entity: 'setting', entityId: req.params.key });
  res.json({ ok: true });
}));

export default r;
