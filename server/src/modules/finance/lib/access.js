// Ruoli e permessi dell'app Finance. L'autenticazione e il caricamento dell'utente li fa la Suite:
// req.user dentro il modulo è la riga users dello schema finance con role = profilo del grant Suite
// e is_admin = flag dell'app oppure livello OWNER/ADMIN della Suite (vedi index.js).
import { forbidden } from './util.js';

export const USER_COLS = 'id, email, full_name, title, role, is_admin, auth_provider, must_change_password, totp_enabled, active, last_login_at, created_at';

export const isAdmin = (u) => Boolean(u?.is_admin);
export const isSigner = (u) => ['CEO', 'CFO'].includes(u?.role);
// Finance Support (e gli amministratori) inseriscono e gestiscono le istanze
export const canManage = (u) => u?.role === 'SUPPORT' || isAdmin(u);
export const requireAdmin = (req, _res, next) => (isAdmin(req.user) ? next() : next(forbidden('Riservato agli amministratori')));
export const requireManage = (req, _res, next) => (canManage(req.user) ? next() : next(forbidden('Operazione riservata a Finance Support')));
export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
