// Ruoli e perimetro del modulo Cash Management. L'autenticazione la fa la Suite: req.user qui è l'utente del modulo
// (riga della tabella users dello schema cash) con role = profilo del grant Suite (SUPERADMIN, ADMIN, CASSIERE, FINANCE,
// OPERATOR, PARTNER), company_id = azienda dell'app, site_ids = sedi del perimetro (scope SITE del grant Suite tradotti
// negli id dell'app; se il grant non ha sedi, le assegnazioni user_sites dell'app).
import { one } from '../db.js';
import { forbidden, notFound } from './util.js';

// Costruttore di parametri posizionali per query dinamiche
export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

export const isSuper = (u) => u.role === 'SUPERADMIN';
export const isAdmin = (u) => u.role === 'ADMIN' || u.role === 'SUPERADMIN';
// Fasi del processo: chi revisiona e approva i rendiconti (operazione logistica, riconteggio, NC)
export const canReview = (u) => ['SUPERADMIN', 'ADMIN', 'CASSIERE'].includes(u?.role);
// chi gestisce cassaforte, versamenti e accrediti
export const canFinance = (u) => ['SUPERADMIN', 'ADMIN', 'FINANCE'].includes(u?.role);
// chi compila i rendiconti di cassa
export const canCount = (u) => ['SUPERADMIN', 'ADMIN', 'OPERATOR'].includes(u?.role);
// ruoli con perimetro sull'intera azienda (gli altri sono limitati alle sedi assegnate)
export const companyWide = (u) => ['ADMIN', 'FINANCE'].includes(u?.role);
export const REVIEW_ROLES = ['SUPERADMIN', 'ADMIN', 'CASSIERE'];
export const FINANCE_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];

// Clausola SQL che limita le sedi visibili all'utente (alias della tabella sites)
// OPERATOR, CASSIERE e PARTNER vedono solo le sedi assegnate; ADMIN e FINANCE tutta l'azienda
export function siteScope(user, P, alias = 's') {
  if (user.role === 'SUPERADMIN') return 'TRUE';
  if (companyWide(user)) return `${alias}.company_id = ${P.add(user.company_id)}`;
  return `${alias}.id = ANY(${P.add(user.site_ids || [])}::int[])`;
}

// Il Partner (struttura ospitante) è in sola lettura su un perimetro ristretto.
// I percorsi sono quelli del modulo dentro la Suite (/api/cash/...)
const PARTNER_ALLOWED = [/^\/api\/cash\/(state|auth\/me)$/, /^\/api\/cash\/stats\/summary/, /^\/api\/cash\/stats\/export\.csv/, /^\/api\/cash\/sites$/, /^\/api\/cash\/canoni\//, /^\/api\/cash\/nc$/];
export function partnerGuard(req, _res, next) {
  if (req.user?.role !== 'PARTNER') return next();
  const path = req.originalUrl.split('?')[0];
  if (req.method !== 'GET') return next(forbidden('Profilo in sola lettura'));
  if (!PARTNER_ALLOWED.some((re) => re.test(path))) return next(forbidden('Sezione non disponibile per il profilo Partner'));
  next();
}

export function companyScope(user, P, col = 'company_id') {
  if (user.role === 'SUPERADMIN') return 'TRUE';
  return `${col} = ${P.add(user.company_id)}`;
}

export function canSite(user, site) {
  if (!site) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (companyWide(user)) return site.company_id === user.company_id;
  return (user.site_ids || []).includes(site.id);
}

export async function assertSite(user, siteId) {
  const site = await one('SELECT * FROM sites WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata');
  if (!canSite(user, site)) throw forbidden('Sede non autorizzata');
  return site;
}

export function assertCompany(user, companyId) {
  if (user.role === 'SUPERADMIN') return;
  if (Number(companyId) !== user.company_id) throw forbidden('Azienda non autorizzata');
}
