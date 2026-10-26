// Ruoli e perimetro del modulo Orders. L'autenticazione la fa la Suite: req.user qui è l'utente del modulo
// (riga della tabella users dello schema orders) con role = profilo del grant Suite (SUPERADMIN, PROCUREMENT, CLIENTE, SEDE, LAB)
// e struttura_id = chiave della struttura nell'ambito del grant: id della sede TD (public.sites, > 0) oppure opposto dell'id
// della Legal entity (public.organizations, < 0), come nella vista strutture_v (migrazione 005).
import { one } from '../db.js';
import { bad, forbidden, notFound } from './util.js';

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

// Clausola SQL che limita le sedi visibili (alias della vista strutture_v o colonna struttura_id)
export function strutturaScope(user, P, col = 's.id') {
  if (isOps(user)) return 'TRUE';
  return `${col} = ${P.add(user.struttura_id)}`;
}

export async function assertStruttura(user, strutturaId) {
  const s = await one('SELECT * FROM strutture_v WHERE id=$1', [Number(strutturaId) || 0]);
  if (!s) throw notFound('Struttura non trovata');
  if (!isOps(user) && s.id !== user.struttura_id) throw forbidden('Struttura non autorizzata');
  // I punti dei clienti service non sono strutture a sé: ordini, giacenze e consegne stanno sulla loro Legal entity
  if (s.delivery_point) throw bad(s.organization_id ? `${s.name} è un punto di consegna: ordini e giacenze si gestiscono sulla Legal entity ${s.organization_name}` : `${s.name} è un punto service senza Legal entity: collegalo a una Legal entity in Amministrazione > Sedi`);
  return s;
}

// La struttura della Legal entity a cui appartiene una sede SERVICE (chiave negativa), altrimenti la sede stessa
export const strutturaKeyOfSite = (site) => (site?.kind === 'SERVICE' && site.organization_id ? -site.organization_id : site?.id ?? null);
