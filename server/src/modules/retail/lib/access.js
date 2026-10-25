// Autorizzazioni dell'app di origine, senza la parte di autenticazione (login, sessione, onboarding): la fa la Suite.
// req.user dentro il modulo è la riga users dello schema retail con role = profilo del grant Suite (ADMIN, RETAIL, SEDE, VIEWER)
// e site_id / site_ids = sedi dell'app corrispondenti agli scope del grant (per il profilo SEDE).
import { forbidden } from './util.js';

export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
// ADMIN e RETAIL scrivono su tutto; SEDE aggiorna l'esposizione e la struttura della propria sede; VIEWER in sola lettura
export const canWrite = (u) => ['ADMIN', 'RETAIL'].includes(u?.role);
export const requireWrite = (req, _res, next) => (canWrite(req.user) ? next() : next(forbidden('Profilo in sola lettura')));
const ownSites = (u) => (Array.isArray(u?.site_ids) && u.site_ids.length ? u.site_ids : u?.site_id != null ? [u.site_id] : []).map(Number);
export const canEditSite = (u, siteId) => canWrite(u) || (u?.role === 'SEDE' && ownSites(u).includes(Number(siteId)));
export const isAdmin = (u) => u?.role === 'ADMIN';
