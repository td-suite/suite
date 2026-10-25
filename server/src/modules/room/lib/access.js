// Ruoli e perimetro dell'app Room Planning. Nella Suite req.user è la riga users dello schema del modulo con:
// role = profilo del grant Suite (ADMIN, PLANNER, RESP_SAN, PROF, VIEWER), site_ids = id di public.sites negli scope del grant
// (anagrafica unica, al posto della tabella user_strutture dell'app) e person_id = persona dell'utente in public.people.
// Login, sessione e utenti li gestisce la Suite.
import { many } from '../db.js';
import { forbidden } from './util.js';

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
export const isAdmin = (u) => u?.role === 'ADMIN';
export const canEdit = (u) => u?.role === 'ADMIN' || u?.role === 'PLANNER';
// Gestione del personale sanitario: amministratori e Responsabile del personale sanitario
export const isGestione = (u) => u?.role === 'ADMIN' || u?.role === 'RESP_SAN';
export const isProf = (u) => u?.role === 'PROF';
// Perimetro: ADMIN/RESP_SAN tutte; PLANNER/VIEWER tutte se nessuna sede negli scope, altrimenti solo quelle; PROF nessuna
export const canSeeStruttura = (u, id) => !isProf(u) && (isGestione(u) || !(u.site_ids || []).length || u.site_ids.includes(Number(id)));
// Sedi di cui l'utente è gestore (email del site manager nelle impostazioni Room della sede): può confermare le presenze
export async function siteManagerSedi(u) {
  if (!u) return [];
  return (await many(`SELECT e.site_id FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE s.active AND lower(coalesce(e.data->>'siteManagerEmail','')) = lower($1)`, [u.email])).map((r) => r.site_id);
}
export async function canConfirmPresenze(u, sedeId) { return isGestione(u) || (await siteManagerSedi(u)).includes(Number(sedeId)); }
// I professionisti usano solo il proprio portale (percorsi relativi al router del modulo)
export const PROF_PREFIXES = ['/portale/', '/portale', '/state', '/auth/me'];
export const canEditStruttura = (u, id) => canEdit(u) && canSeeStruttura(u, id);
