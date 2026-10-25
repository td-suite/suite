// Ruoli e perimetro dell'app Room Planning. Nella Suite req.user è la riga users dello schema del modulo con:
// role = profilo del grant Suite (ADMIN, PLANNER, RESP_SAN, PROF, VIEWER) e struttura_ids = sedi degli scope del grant
// (legacy_site_ids), al posto della tabella user_strutture dell'app. Login, sessione e utenti li gestisce la Suite.
import { many } from '../db.js';
import { forbidden } from './util.js';

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
export const isAdmin = (u) => u?.role === 'ADMIN';
export const canEdit = (u) => u?.role === 'ADMIN' || u?.role === 'PLANNER';
// Gestione del personale sanitario: amministratori e Responsabile del personale sanitario
export const isGestione = (u) => u?.role === 'ADMIN' || u?.role === 'RESP_SAN';
export const isProf = (u) => u?.role === 'PROF';
// Perimetro: ADMIN/RESP_SAN tutte; PLANNER/VIEWER tutte se nessuna assegnazione, altrimenti solo le sedi assegnate; PROF nessuna
export const canSeeStruttura = (u, id) => !isProf(u) && (isGestione(u) || !(u.struttura_ids || []).length || u.struttura_ids.includes(id));
// Sedi di cui l'utente è gestore (email del site manager in Anagrafica della sede): può confermare le presenze
export async function siteManagerSedi(u) {
  if (!u) return [];
  return (await many(`SELECT id FROM strutture WHERE deleted_at IS NULL AND lower(coalesce(data->>'siteManagerEmail','')) = lower($1)`, [u.email])).map((r) => r.id);
}
export async function canConfirmPresenze(u, sedeId) { return isGestione(u) || (await siteManagerSedi(u)).includes(sedeId); }
// I professionisti usano solo il proprio portale (percorsi relativi al router del modulo)
export const PROF_PREFIXES = ['/portale/', '/portale', '/state', '/auth/me'];
export const canEditStruttura = (u, id) => canEdit(u) && canSeeStruttura(u, id);
