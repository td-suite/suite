// Permessi del modulo Business. L'autenticazione la fa la Suite: req.user qui è la riga della tabella users dell'app
// (schema business) con role = profilo del grant Suite (ADMIN, SERVICE, RETAIL, MDL, HQS, VIEWER).
import { forbidden } from './util.js';
import { canEditKind, canEditDossier } from './rules.js';

export const USER_COLS = 'id, email, full_name, title, role, auth_provider, must_change_password, totp_enabled, active, last_login_at, created_at';

// Utente senza campi riservati (per /auth/me e /state)
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, totp_secret, entra_oid, failed_logins, locked_until, ...rest } = u;
  return rest;
}

export const isAdmin = (u) => u?.role === 'ADMIN';
// Chi gestisce almeno una sezione (anagrafiche partner incluse)
export const isManager = (u) => ['ADMIN', 'SERVICE', 'RETAIL', 'MDL', 'HQS'].includes(u?.role);
export const requireAdmin = (req, _res, next) => (isAdmin(req.user) ? next() : next(forbidden('Riservato al Superamministratore')));
export const requireManager = (req, _res, next) => (isManager(req.user) ? next() : next(forbidden('Operazione riservata ai manager di sezione')));
export const requireKind = (kind, user) => { if (!canEditKind(user, kind)) throw forbidden('Non hai i permessi su questa sezione'); };
export const requireDossier = (user) => { if (!canEditDossier(user)) throw forbidden('Il fascicolo è riservato a HQS Manager e Retail Manager'); };
