// Ruoli e perimetro del modulo Shipments. L'autenticazione la fa la Suite: req.user qui è l'utente del modulo
// (riga della tabella users dello schema shipments) con role = profilo del grant Suite (SUPERADMIN, ADMIN, VIEWER, ENDEAVOR).
import { forbidden } from './util.js';

// Costruttore di parametri posizionali per query dinamiche
export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

export const isSuper = (u) => u?.role === 'SUPERADMIN';
// chi opera sul processo (magazzino, richieste, spedizioni, campioni, rendiconti)
export const canOperate = (u) => ['SUPERADMIN', 'ADMIN'].includes(u?.role);
export const OPERATORS = ['SUPERADMIN', 'ADMIN'];

// Profili in sola lettura: VIEWER (Amministrazione) vede tutto in lettura; ENDEAVOR vede solo rendiconti del progetto Endeavor.
// I percorsi sono quelli del modulo dentro la Suite (/api/shipments/...)
const ENDEAVOR_ALLOWED = [/^\/api\/shipments\/(state|auth\/me)$/, /^\/api\/shipments\/reports\//, /^\/api\/shipments\/billing/, /^\/api\/shipments\/modes$/, /^\/api\/shipments\/settings\/public$/];
export function readOnlyGuard(req, _res, next) {
  const role = req.user?.role;
  if (!role || canOperate(req.user)) return next();
  const path = req.originalUrl.split('?')[0];
  if (req.method !== 'GET') return next(forbidden(req.lang === 'en' ? 'Read-only profile' : 'Profilo in sola lettura'));
  if (role === 'ENDEAVOR') {
    if (!ENDEAVOR_ALLOWED.some((re) => re.test(path))) return next(forbidden(req.lang === 'en' ? 'Section not available for this profile' : 'Sezione non disponibile per questo profilo'));
    if (req.query.project && req.query.project !== 'ENDEAVOR') return next(forbidden());
    req.query.project = 'ENDEAVOR';
  }
  next();
}
