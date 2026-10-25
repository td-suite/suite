// Permessi del modulo Contracts. L'autenticazione la fa la Suite: req.user qui è la riga della tabella users dell'app
// (schema contracts) con role = profilo del grant Suite (ADMIN, HR, VIEWER). Login, Entra, TOTP e gestione utenti non si portano.
import { readLog as suiteReadLog } from '../../../lib/util.js';
import { forbidden } from './util.js';

export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

// Utente senza campi riservati (per /auth/me e /state)
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, totp_secret, entra_oid, failed_logins, locked_until, ...rest } = u;
  return rest;
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
// ADMIN e HR possono scrivere; VIEWER è in sola lettura
export const canWrite = (u) => ['ADMIN', 'HR'].includes(u?.role);
export const requireWrite = (req, _res, next) => (canWrite(req.user) ? next() : next(forbidden('Profilo in sola lettura')));
export const isAdmin = (u) => u?.role === 'ADMIN';

// Audit di lettura della Suite (read_log, modulo contracts): ogni consultazione di una scheda del personale viene registrata
// con l'utente Suite (req.suiteUser), non con la riga users dello schema del modulo.
export async function readLog(req, entity, entityId) {
  await suiteReadLog({ user: req.suiteUser || req.user, ip: req.ip }, { module: 'contracts', entity, entityId });
}
