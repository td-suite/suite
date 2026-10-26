// Ruoli e perimetro del modulo Cash Management. L'autenticazione la fa la Suite: req.user qui è l'utente del modulo
// (riga della tabella users dello schema cash) con role = profilo del grant Suite (SUPERADMIN, ADMIN, CASSIERE, FINANCE,
// OPERATOR, PARTNER), company_id = azienda dell'app, site_ids = sedi del perimetro: id di public.sites negli scope SITE del
// grant Suite (anagrafica unica). Le sedi si leggono dalla vista sites_v (public.sites + site_ext: le sole sedi TD, mai le strutture
// dei clienti service; `configured` dice se la sede ha le impostazioni Cash).
import { one, q } from '../db.js';
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

// Clausola SQL che limita le sedi visibili all'utente (alias della vista sites_v)
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

// Sede del perimetro, configurata in Cash (riga in site_ext). La vista sites_v contiene tutte le sedi TD, anche quelle senza
// impostazioni Cash (`configured` falso): su quelle non si lavora finché l'amministratore non le configura nella pagina Sedi.
export async function assertSite(user, siteId) {
  const site = await one('SELECT * FROM sites_v WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata nell\'anagrafica della Suite');
  if (!site.configured) throw notFound(`La sede ${site.name} non è ancora configurata in Cash: imposta fondo cassa e data di avvio in Sedi`);
  if (!canSite(user, site)) throw forbidden('Sede non autorizzata');
  return site;
}

// Riga tecnica di cash.users per un utente della Suite (id di public.users): serve per le chiavi esterne dei rendiconti
// (operator_id, created_by, ...) quando un amministratore apre la cassa di un operatore che non è ancora entrato in Cash.
// Nomi, email e profilo restano quelli della Suite (viste users_v / operators_v).
export async function ensureCashUserId(suiteUserId) {
  const op = await one('SELECT id, cash_user_id, email, full_name, role, company_id FROM operators_v WHERE id=$1', [suiteUserId]);
  if (!op) return null;
  if (op.cash_user_id) return op.cash_user_id;
  const byEmail = await one('SELECT id FROM users WHERE lower(email)=lower($1)', [op.email]);
  if (byEmail) { await q('UPDATE users SET suite_user_id=$2, updated_at=now() WHERE id=$1', [byEmail.id, suiteUserId]); return byEmail.id; }
  if (op.role !== 'SUPERADMIN' && !op.company_id) throw notFound(`Per ${op.full_name} non si ricava l'azienda Cash: assegna una sede configurata in Cash nel suo accesso`);
  const row = await one(`INSERT INTO users (email, full_name, role, company_id, suite_user_id, auth_provider, must_change_password) VALUES ($1,$2,$3,$4,$5,'ENTRA',FALSE) RETURNING id`,
    [op.email, op.full_name, op.role, op.role === 'SUPERADMIN' ? null : op.company_id, suiteUserId]);
  return row.id;
}

export function assertCompany(user, companyId) {
  if (user.role === 'SUPERADMIN') return;
  if (Number(companyId) !== user.company_id) throw forbidden('Azienda non autorizzata');
}
