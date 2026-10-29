import { displayName, splitName } from '../lib/util.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { syncUserFromPerson } from '../lib/accounts.js';
import { applyDefaultProfile, applyProfile } from '../lib/accessProfiles.js';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, notFound, forbidden } from '../lib/util.js';
import { requireAdmin, isOwner, isAdmin, hydrateUser } from '../lib/access.js';
import { sendMail, layout } from '../lib/mailer.js';
import { publicUser } from './auth.js';

const r = Router();

const userSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(120).optional(),
  first_name: z.string().max(60).optional(),
  last_name: z.string().max(60).optional(),
  title: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  level: z.enum(['OWNER', 'ADMIN', 'USER']).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'DISABLED']).optional(),
  auth_provider: z.enum(['LOCAL', 'ENTRA', 'BOTH']).optional(),
  organization_id: z.number().int().nullable().optional(),
  site_id: z.number().int().nullable().optional(),
  person_id: z.number().int().nullable().optional(),
  lang: z.enum(['it', 'en']).optional(),
  password: z.string().min(12).optional(),       // facoltativa: altrimenti viene generata e inviata via email
  send_invite: z.boolean().optional(),
});

const grantSchema = z.object({
  module_key: z.string().min(1),
  profile: z.string().min(1),
  scopes: z.array(z.object({ type: z.enum(['SITE', 'ORG']), id: z.number().int() })).optional(),
});

// Nomi: la forma visualizzata è sempre "Cognome Nome"; un full_name senza cognome/nome separati viene spezzato (ipotesi: cognome = ultima parola)
function namesFrom(b) {
  let first = (b.first_name || '').trim(), last = (b.last_name || '').trim();
  if (!first && !last && b.full_name) ({ first_name: first, last_name: last } = splitName(b.full_name));
  return { first_name: first, last_name: last, full_name: displayName(last, first) };
}
function assertCanGrant(req, module) {
  if (!module) throw notFound('Modulo inesistente');
  if (module.restricted && !isOwner(req.user)) throw forbidden(`Il modulo "${module.name}" è riservato: solo il titolare della Suite può assegnarlo`);
}
function assertCanManage(req, target) {
  if (!target) throw notFound('Utente inesistente');
  if (target.level === 'OWNER' && !isOwner(req.user)) throw forbidden('Solo il titolare può modificare il proprio account');
}
const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}A1!`;

// ---- elenco e dettaglio
r.get('/users', requireAdmin, ah(async (req, res) => {
  const { qtext = '', status = '', module = '', level = '', page = 1, pageSize = 50, site_id = '' } = req.query;
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (qtext) where.push(`(lower(u.full_name) LIKE ${p(`%${String(qtext).toLowerCase()}%`)} OR lower(u.email) LIKE ${p(`%${String(qtext).toLowerCase()}%`)})`);
  if (status) where.push(`u.status = ${p(status)}`);
  if (level) where.push(`u.level = ${p(level)}`);
  if (site_id) where.push(`(u.site_id = ${p(Number(site_id))} OR EXISTS (SELECT 1 FROM grants g JOIN grant_scopes gs ON gs.grant_id=g.id WHERE g.user_id=u.id AND gs.scope_type='SITE' AND gs.scope_id=${p(Number(site_id))}))`);
  if (module) where.push(`EXISTS (SELECT 1 FROM grants g WHERE g.user_id=u.id AND g.module_key=${p(module)} AND g.proposed=FALSE)`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT count(*)::int AS n FROM users u ${w}`, params)).n;
  const rows = await many(
    `SELECT u.id, u.email, u.full_name, u.title, u.level, u.status, u.auth_provider, u.totp_enabled, u.last_login_at, u.created_at, u.site_id, u.organization_id, u.person_id,
            o.name AS organization_name, o.kind AS organization_kind, s.name AS site_name, p.area AS person_area, p.job_title AS person_job_title, p.kind AS person_kind,
            (u.level = 'USER' AND coalesce(o.kind, '') NOT IN ('GRUPPO','SOCIETA') AND NOT (lower(split_part(u.email, '@', 2)) = ANY(${p(config.autoInternalDomains)}::text[]))) AS is_external,
            (SELECT json_agg(json_build_object('module_key', g.module_key, 'profile', g.profile, 'proposed', g.proposed) ORDER BY g.module_key) FROM grants g WHERE g.user_id=u.id) AS grants
       FROM users u LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN sites s ON s.id=u.site_id LEFT JOIN people p ON p.id=u.person_id
       ${w} ORDER BY lower(u.full_name) LIMIT ${p(Math.min(Number(pageSize), 200))} OFFSET ${p((Math.max(1, Number(page)) - 1) * Math.min(Number(pageSize), 200))}`, params);
  res.json({ total, rows });
}));

r.get('/users/summary', requireAdmin, ah(async (_req, res) => {
  const s = await one(`SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active, count(*) FILTER (WHERE status='PENDING')::int AS pending,
                              count(*) FILTER (WHERE status='DISABLED')::int AS disabled,
                              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM grants g WHERE g.user_id=users.id AND g.proposed))::int AS with_proposals FROM users`);
  res.json(s);
}));

r.get('/users/:id', requireAdmin, ah(async (req, res) => {
  const u = await hydrateUser(Number(req.params.id));
  if (!u) throw notFound();
  const grants = await many(`SELECT g.*, m.name AS module_name, m.area, m.restricted, m.scope_type, ap.name AS access_profile_name,
      coalesce(json_agg(json_build_object('type', gs.scope_type, 'id', gs.scope_id)) FILTER (WHERE gs.grant_id IS NOT NULL), '[]') AS scopes
    FROM grants g JOIN modules m ON m.key=g.module_key LEFT JOIN access_profiles ap ON ap.id=g.profile_id LEFT JOIN grant_scopes gs ON gs.grant_id=g.id WHERE g.user_id=$1 GROUP BY g.id, m.name, m.area, m.restricted, m.scope_type, m.sort_order, ap.name ORDER BY m.area, m.sort_order`, [u.id]);
  const audit_ = await many(`SELECT at, action, label, data FROM audit_log WHERE (entity='user' AND entity_id=$1) OR user_id=$2 ORDER BY at DESC LIMIT 30`, [String(u.id), u.id]);
  // dati della persona collegata (anagrafica unica): publicUser li filtra per la sessione, qui servono tutti
  const person = { person_kind: u.person_kind, person_title: u.person_title, person_phone: u.person_phone, person_phone_office: u.person_phone_office, person_phone_ext: u.person_phone_ext, person_role: u.person_role, person_unit: u.person_unit, person_unit_path: u.person_unit_path };
  // controllo del collegamento: esiste una persona con la stessa email diversa da quella collegata?
  const byEmail = await one('SELECT id, last_name, first_name FROM people WHERE lower(email)=lower($1) ORDER BY id LIMIT 1', [u.email]);
  const person_suggested = byEmail && byEmail.id !== u.person_id ? byEmail : null;
  res.json({ user: { ...publicUser(u), ...person, person_suggested, legacy_refs: u.legacy_refs, entra_oid: u.entra_oid, last_login_at: u.last_login_at, created_at: u.created_at }, grants, audit: audit_ });
}));

// ---- creazione: l'amministratore crea l'utente e, nello stesso passaggio, i grant per widget.
// La stessa funzione serve agli accessi esterni creati dalla scheda Legal entity (routes/esterni.js): origin 'LEGAL_ENTITY' nell'audit,
// access_profile_id = profilo di accesso da applicare subito dopo (ambiti risolti dall'organizzazione per gli esterni).
export const createUserSchema = userSchema.extend({ grants: z.array(grantSchema).optional(), origin: z.enum(['LEGAL_ENTITY']).optional(), access_profile_id: z.number().int().nullable().optional() });
export async function createUserAccount(req, b) {
  if (b.level === 'OWNER') throw forbidden('Il livello titolare non è assegnabile');
  if (b.level === 'ADMIN' && !isOwner(req.user)) throw forbidden('Solo il titolare crea amministratori');
  const email = b.email.toLowerCase();
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [email])) throw bad('Esiste già un utente con questa email');
  // Ogni utente è una persona dell'anagrafica: l'email deve corrispondere a una persona (Amministrazione > Persone o Contratti del personale)
  const personRow = await one('SELECT id, first_name, last_name, site_id, organization_id FROM people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [email]);
  if (!personRow) throw bad('Nessuna persona con questa email: crea prima la persona in Persone (o in Contratti del personale), poi l\'accesso');
  b.person_id = personRow.id; b.first_name = personRow.first_name; b.last_name = personRow.last_name; if (b.site_id == null) b.site_id = personRow.site_id;
  if (b.organization_id == null) b.organization_id = personRow.organization_id;   // la Legal entity della persona (esterni)
  const internal = config.autoInternalDomains.includes(email.split('@')[1]);
  const provider = b.auth_provider || (internal ? 'ENTRA' : 'LOCAL');
  const plain = provider !== 'ENTRA' ? (b.password || genPassword()) : null;
  const modules = await many('SELECT * FROM modules');
  const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));
  for (const g of b.grants || []) assertCanGrant(req, byKey[g.module_key]);
  const nm = namesFrom(b);
  if (!nm.full_name) throw bad('Cognome e nome obbligatori');

  const u = await tx(async (c) => {
    const { rows: [u] } = await c.query(
      `INSERT INTO users (email, full_name, first_name, last_name, title, phone, level, status, auth_provider, organization_id, site_id, person_id, lang, password_hash, must_change_password, created_by)
       VALUES ($1,$2,$15,$16,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [email, nm.full_name, b.title || null, b.phone || null, b.level || 'USER', b.status || 'ACTIVE', provider, b.organization_id ?? null, b.site_id ?? null, b.person_id ?? null, b.lang || 'it',
        plain ? await bcrypt.hash(plain, 12) : null, Boolean(plain), req.user.id, nm.first_name, nm.last_name]);
    for (const g of b.grants || []) {
      const { rows: [gr] } = await c.query(`INSERT INTO grants (user_id, module_key, profile, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [u.id, g.module_key, g.profile, req.user.id]);
      for (const s of g.scopes || []) await c.query('INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [gr.id, s.type, s.id]);
    }
    return u;
  });
  // profilo di accesso predefinito (Default) dopo i grant indicati: aggiunge solo ciò che manca, non declassa quanto scelto qui
  const def = await applyDefaultProfile(u.id, req.user.id).catch((e) => { console.warn('[users] profilo predefinito:', e.message); return null; });
  // profilo di accesso scelto (es. Partner ospitante / Cliente service dalla scheda Legal entity): applicato dopo il Default, in merge
  let chosen = null;
  if (b.access_profile_id) {
    chosen = await applyProfile(b.access_profile_id, [u.id], { actorId: req.user.id, mode: 'merge' }).catch((e) => { console.warn('[users] profilo scelto:', e.message); return { error: e.message }; });
  }
  await audit(req, 'USER_CREATED', { entity: 'user', entityId: u.id, label: u.email, data: { level: u.level, provider, origin: b.origin || 'ADMIN', organization_id: u.organization_id, grants: (b.grants || []).map((g) => `${g.module_key}:${g.profile}`),
    default_profile: def ? { id: def.profile.id, added: def.added, updated: def.updated } : null,
    access_profile: chosen ? (chosen.error ? { id: b.access_profile_id, error: chosen.error } : { id: chosen.profile.id, name: chosen.profile.name, added: chosen.added, updated: chosen.updated, warnings: chosen.warnings }) : null } });

  let invited = false;
  if (b.send_invite !== false) {
    const loginHint = provider === 'ENTRA' ? `<p>Accedi con il tuo account Microsoft 365 aziendale: <a href="${config.baseUrl}">${config.baseUrl}</a></p>`
      : `<p>Le tue credenziali:</p><p><b>Email</b>: ${email}<br><b>Password provvisoria</b>: <code>${plain}</code></p><p>Al primo accesso ti verrà chiesto di scegliere una password personale. Ti consigliamo di attivare la verifica a due fattori dal tuo profilo.</p><p><a href="${config.baseUrl}/login" style="background:#1C505E;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Entra in Suite TD</a></p>`;
    const out = await sendMail({ to: email, subject: 'Benvenuto in Suite TD', ref: `invite:${u.id}`, html: layout(`Benvenuto, ${b.full_name}`, `<p>È stato creato il tuo accesso a <b>Suite TD</b>, l'intranet e operating suite di Toscana Diagnostica.</p>${loginHint}`) });
    invited = out.ok;
  }
  return { id: u.id, invited, temporaryPassword: invited ? undefined : plain || undefined, access_profile: chosen && !chosen.error ? { id: chosen.profile.id, name: chosen.profile.name, added: chosen.added, updated: chosen.updated, warnings: chosen.warnings } : null, access_profile_error: chosen?.error || null };
}
r.post('/users', requireAdmin, ah(async (req, res) => {
  const b = parse(createUserSchema, req.body);
  res.status(201).json(await createUserAccount(req, b));
}));

r.put('/users/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  const b = parse(userSchema.partial().omit({ password: true, send_invite: true }), req.body);
  if (b.level && b.level !== target.level) {
    if (!isOwner(req.user)) throw forbidden('Solo il titolare cambia il livello degli utenti');
    if (b.level === 'OWNER' || target.level === 'OWNER') throw forbidden('Il livello titolare non si assegna né si rimuove');
  }
  if (b.email && b.email.toLowerCase() !== target.email && await one('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [b.email.toLowerCase(), id])) throw bad('Email già in uso');
  const fields = ['email', 'first_name', 'last_name', 'full_name', 'title', 'phone', 'level', 'status', 'auth_provider', 'organization_id', 'site_id', 'person_id', 'lang'];
  // Anagrafica unica: se l'utente è una persona, nomi, titolo, telefono, sede e legal entity vengono dalla scheda persona (non si compilano qui)
  const personId = b.person_id !== undefined ? b.person_id : target.person_id;
  if (personId) for (const k of ['first_name', 'last_name', 'full_name', 'title', 'phone', 'organization_id', 'site_id']) delete b[k];
  if (b.first_name !== undefined || b.last_name !== undefined) { const nm = namesFrom({ first_name: b.first_name ?? target.first_name, last_name: b.last_name ?? target.last_name }); b.first_name = nm.first_name; b.last_name = nm.last_name; b.full_name = nm.full_name; }
  const sets = []; const params = [id];
  for (const f of fields) if (b[f] !== undefined) { params.push(f === 'email' ? b[f].toLowerCase() : b[f]); sets.push(`${f}=$${params.length}`); }
  if (sets.length) await q(`UPDATE users SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
  if (personId) await syncUserFromPerson(personId);
  await audit(req, 'USER_UPDATED', { entity: 'user', entityId: id, label: target.email, data: b });
  res.json({ ok: true });
}));

r.post('/users/:id/reset-password', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  if (target.auth_provider === 'ENTRA') throw bad('L\'utente accede solo con Microsoft 365');
  const plain = genPassword();
  await q('UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [id, await bcrypt.hash(plain, 12)]);
  await audit(req, 'USER_PASSWORD_RESET', { entity: 'user', entityId: id, label: target.email });
  const out = await sendMail({ to: target.email, subject: 'Suite TD · nuova password provvisoria', ref: `reset:${id}`, html: layout('Nuova password provvisoria', `<p>Ciao ${target.full_name},</p><p>un amministratore ha reimpostato la tua password: <code>${plain}</code></p><p>Al prossimo accesso dovrai sceglierne una nuova.</p>`) });
  res.json({ ok: true, temporaryPassword: out.ok ? undefined : plain });
}));

r.post('/users/:id/reset-totp', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  await q('UPDATE users SET totp_secret=NULL, totp_enabled=FALSE, updated_at=now() WHERE id=$1', [id]);
  await audit(req, 'USER_TOTP_RESET', { entity: 'user', entityId: id, label: target.email });
  res.json({ ok: true });
}));

// ---- grant: assegna, aggiorna, conferma proposte, rimuove
r.put('/users/:id/grants/:module', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  const m = await one('SELECT * FROM modules WHERE key=$1', [req.params.module]);
  assertCanGrant(req, m);
  const b = parse(grantSchema.omit({ module_key: true }), req.body);
  if (!(m.profiles || []).some((p) => p.key === b.profile)) throw bad('Profilo non previsto dal modulo');
  await tx(async (c) => {
    const { rows: [g] } = await c.query(
      `INSERT INTO grants (user_id, module_key, profile, proposed, source, created_by) VALUES ($1,$2,$3,FALSE,'MANUAL',$4)
       ON CONFLICT (user_id, module_key) DO UPDATE SET profile=EXCLUDED.profile, proposed=FALSE, source='MANUAL', profile_id=NULL, updated_at=now() RETURNING id`, [id, m.key, b.profile, req.user.id]);
    if (b.scopes) {
      await c.query('DELETE FROM grant_scopes WHERE grant_id=$1', [g.id]);
      for (const s of b.scopes) await c.query('INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [g.id, s.type, s.id]);
    }
  });
  await audit(req, 'GRANT_SET', { module: m.key, entity: 'user', entityId: id, label: `${target.email} → ${m.key}:${b.profile}`, data: { scopes: b.scopes } });
  if (m.restricted) await audit(req, 'RESTRICTED_GRANT_SET', { module: m.key, entity: 'user', entityId: id, label: target.email });
  res.json({ ok: true });
}));

r.post('/users/:id/grants/confirm-all', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  const restricted = isOwner(req.user) ? '' : 'AND m.restricted = FALSE';
  const { rowCount } = await q(`UPDATE grants g SET proposed=FALSE, updated_at=now() FROM modules m WHERE m.key=g.module_key AND g.user_id=$1 AND g.proposed ${restricted}`, [id]);
  await audit(req, 'GRANTS_CONFIRMED', { entity: 'user', entityId: id, label: target.email, data: { n: rowCount } });
  res.json({ ok: true, confirmed: rowCount });
}));

// Eliminazione dell'accesso: la persona resta in anagrafica. Il titolare non si elimina; gli amministratori li elimina solo il titolare.
r.delete('/users/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!target) throw notFound('Utente inesistente');
  if (target.level === 'OWNER') throw forbidden('Il titolare non si elimina');
  if (target.level === 'ADMIN' && !isOwner(req.user)) throw forbidden('Solo il titolare elimina un amministratore');
  if (id === req.user.id) throw bad('Non puoi eliminare il tuo accesso');
  await q('DELETE FROM grants WHERE user_id=$1', [id]);
  await q('UPDATE users SET created_by=NULL WHERE created_by=$1', [id]);
  await q('DELETE FROM users WHERE id=$1', [id]);
  await audit(req, 'USER_DELETED', { entity: 'user', entityId: id, label: target.email });
  res.json({ ok: true });
}));

r.delete('/users/:id/grants/:module', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const target = await one('SELECT * FROM users WHERE id=$1', [id]);
  assertCanManage(req, target);
  const m = await one('SELECT * FROM modules WHERE key=$1', [req.params.module]);
  assertCanGrant(req, m);
  await q('DELETE FROM grants WHERE user_id=$1 AND module_key=$2', [id, m.key]);
  await audit(req, 'GRANT_REMOVED', { module: m.key, entity: 'user', entityId: id, label: `${target.email} ✕ ${m.key}` });
  res.json({ ok: true });
}));

// Assegnazione massiva: stesso modulo e profilo a più utenti (es. tutti i dipendenti → Community già implicito; es. tutte le sedi → Orders SEDE)
r.post('/grants/bulk', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({ user_ids: z.array(z.number().int()).min(1).max(500), module_key: z.string(), profile: z.string() }), req.body);
  const m = await one('SELECT * FROM modules WHERE key=$1', [b.module_key]);
  assertCanGrant(req, m);
  if (!(m.profiles || []).some((p) => p.key === b.profile)) throw bad('Profilo non previsto dal modulo');
  let n = 0;
  for (const uid of b.user_ids) {
    const t = await one('SELECT level FROM users WHERE id=$1', [uid]);
    if (!t || (t.level === 'OWNER' && !isOwner(req.user))) continue;
    await q(`INSERT INTO grants (user_id, module_key, profile, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, module_key) DO UPDATE SET profile=EXCLUDED.profile, proposed=FALSE, source='MANUAL', profile_id=NULL, updated_at=now()`, [uid, m.key, b.profile, req.user.id]);
    n++;
  }
  await audit(req, 'GRANT_BULK', { module: m.key, label: `${m.key}:${b.profile} × ${n}` });
  res.json({ ok: true, n });
}));

export default r;
