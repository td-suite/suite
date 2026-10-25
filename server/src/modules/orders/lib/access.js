// Ruoli e perimetro del modulo Orders. L'autenticazione la fa la Suite: req.user qui è l'utente del modulo
// (riga della tabella users dello schema orders) con role = profilo del grant Suite (SUPERADMIN, PROCUREMENT, CLIENTE, SEDE, LAB)
// e struttura_id = id della sede dell'anagrafica unica (public.sites) nell'ambito del grant (req.user.site_ids[0]).
import { one } from '../db.js';
import { forbidden, notFound } from './util.js';

// Costruttore di parametri posizionali per query dinamiche
export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));

export const isSuper = (u) => u?.role === 'SUPERADMIN';
// Area Operations Management (profilo Procurement) e super amministratore: vedono e gestiscono tutto
export const isOps = (u) => ['SUPERADMIN', 'PROCUREMENT'].includes(u?.role);
// Profili di struttura: operano solo sulla propria struttura
export const isStruttura = (u) => ['CLIENTE', 'SEDE', 'LAB'].includes(u?.role);
export const OPS_ROLES = ['SUPERADMIN', 'PROCUREMENT'];
export const STRUTTURA_ROLES = ['CLIENTE', 'SEDE', 'LAB'];

// Clausola SQL che limita le sedi visibili (alias della vista sites_v o colonna struttura_id)
export function strutturaScope(user, P, col = 's.id') {
  if (isOps(user)) return 'TRUE';
  return `${col} = ${P.add(user.struttura_id)}`;
}

export async function assertStruttura(user, strutturaId) {
  const s = await one('SELECT * FROM sites_v WHERE id=$1', [strutturaId]);
  if (!s) throw notFound('Sede non trovata');
  if (!isOps(user) && s.id !== user.struttura_id) throw forbidden('Sede non autorizzata');
  return s;
}
