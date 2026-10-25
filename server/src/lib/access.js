import { one, many } from '../db.js';
import { config } from '../config.js';
import { HttpError, forbidden } from './util.js';

// Livelli: OWNER (Francesco: tutto, unico ad assegnare i moduli riservati) · ADMIN (crea utenti, assegna moduli non riservati, anagrafiche) · USER
// L'accesso a un modulo è dato da un grant (modulo → profilo, con eventuali ambiti). I profili sono quelli del modulo.

export async function hydrateUser(id) {
  const u = await one(
    `SELECT u.*, o.kind AS organization_kind, o.name AS organization_name, s.name AS site_name, s.code AS site_code,
            p.kind AS person_kind, p.area AS person_area, p.job_title AS person_job_title, p.title AS person_title, p.phone AS person_phone, p.phone_ext AS person_phone_ext,
            jr.name AS person_role, ou.name AS person_unit
       FROM users u
       LEFT JOIN people p ON p.id = u.person_id
       LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id)
       LEFT JOIN sites s ON s.id = coalesce(p.site_id, u.site_id)
       LEFT JOIN job_roles jr ON jr.id = p.role_id
       LEFT JOIN org_units ou ON ou.id = p.unit_id
      WHERE u.id = $1`, [id]);
  if (!u) return null;
  const grants = await many(
    `SELECT g.id, g.module_key, g.profile, g.proposed, m.area, m.kind, m.restricted,
            coalesce(json_agg(json_build_object('type', gs.scope_type, 'id', gs.scope_id)) FILTER (WHERE gs.grant_id IS NOT NULL), '[]') AS scopes
       FROM grants g JOIN modules m ON m.key = g.module_key
       LEFT JOIN grant_scopes gs ON gs.grant_id = g.id
      WHERE g.user_id = $1 AND g.proposed = FALSE AND m.active
      GROUP BY g.id, m.area, m.kind, m.restricted`, [id]);
  u.grants = {};
  const siteIds = new Set(u.site_id ? [u.site_id] : []);
  const orgIds = new Set(u.organization_id ? [u.organization_id] : []);
  for (const g of grants) {
    u.grants[g.module_key] = { profile: g.profile, scopes: g.scopes, area: g.area, kind: g.kind };
    for (const s of g.scopes) (s.type === 'SITE' ? siteIds : orgIds).add(Number(s.id));
  }
  u.site_ids = [...siteIds];
  u.org_ids = [...orgIds];
  u.internal_domains = config.autoInternalDomains;
  return u;
}

export async function loadUser(req, _res, next) {
  try {
    const id = req.session?.userId;
    if (id) {
      const u = await hydrateUser(id);
      if (u && u.status === 'ACTIVE') req.user = u;
      else if (u && u.status === 'PENDING') req.pendingUser = u;
      else req.session.userId = null;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    if (req.pendingUser) return next(Object.assign(new HttpError(403, 'Account in attesa di abilitazione'), { code: 'PENDING' }));
    return next(new HttpError(401, 'Sessione scaduta o non autenticata'));
  }
  if (req.user.must_change_password && req.session.authMethod === 'LOCAL' && !/^\/api\/auth\//.test(req.originalUrl)) {
    return next(Object.assign(new HttpError(403, 'Cambio password obbligatorio'), { code: 'PASSWORD_CHANGE_REQUIRED' }));
  }
  if (req.session.totpPending) return next(Object.assign(new HttpError(403, 'Verifica a due fattori richiesta'), { code: 'TOTP_REQUIRED' }));
  next();
}

export const isOwner = (u) => u?.level === 'OWNER';
export const isAdmin = (u) => u?.level === 'OWNER' || u?.level === 'ADMIN';
export const requireOwner = (req, _res, next) => (isOwner(req.user) ? next() : next(forbidden('Riservato al titolare della Suite')));
export const requireAdmin = (req, _res, next) => (isAdmin(req.user) ? next() : next(forbidden('Riservato agli amministratori')));

// Accesso a un modulo con, facoltativamente, un insieme di profili ammessi
export const requireModule = (moduleKey, ...profiles) => (req, _res, next) => {
  if (isAdmin(req.user) && !profiles.length) return next();
  const g = req.user?.grants?.[moduleKey];
  if (!g) return next(forbidden('Modulo non assegnato'));
  if (profiles.length && !profiles.includes(g.profile) && !isAdmin(req.user)) return next(forbidden());
  next();
};
export const hasModule = (u, key, ...profiles) => {
  const g = u?.grants?.[key];
  if (!g) return isAdmin(u) && !profiles.length;
  return !profiles.length || profiles.includes(g.profile) || isAdmin(u);
};
export const canSeeSite = (u, siteId) => isAdmin(u) || (u.site_ids || []).includes(Number(siteId));
