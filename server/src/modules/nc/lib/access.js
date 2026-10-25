// Ruoli e perimetro del modulo Non conformità dentro la Suite.
// req.user è la riga users dello schema nc (req.moduleUser) con role = profilo del grant Suite e sedi = id delle sedi
// dell'app corrispondenti agli scope SITE del grant (legacy_site_ids). Login, sessione e gestione utenti sono della Suite.
//
// ADMIN    direzione / amministratore dell'applicazione: tutto
// QUALITA  responsabile qualità (RSQ): analisi causa radice, CAPA, chiusura, verifica efficacia, catalogo, sedi, statistiche
// LAB      operatori di preanalitica / laboratorio: rilevazione, trattamento, dialogo con la sede, chiusura
// SEDE     punti prelievo, centri medici, clienti Service: vedono e rispondono solo alle NC delle proprie sedi
// VIEWER   sola lettura interna (direzione, auditor)
import { forbidden } from './util.js';

export const ROLES = ['ADMIN', 'QUALITA', 'LAB', 'SEDE', 'VIEWER'];
export const INTERNAL_ROLES = ['ADMIN', 'QUALITA', 'LAB', 'VIEWER'];

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
export const requireAdmin = requireRole('ADMIN');
export const requireQualita = requireRole('ADMIN', 'QUALITA');
export const requireLab = requireRole('ADMIN', 'QUALITA', 'LAB');
export const requireInternal = requireRole(...INTERNAL_ROLES);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const isQualita = (u) => u?.role === 'ADMIN' || u?.role === 'QUALITA';
export const isLab = (u) => ['ADMIN', 'QUALITA', 'LAB'].includes(u?.role);
export const isSede = (u) => u?.role === 'SEDE';
export const isInternal = (u) => INTERNAL_ROLES.includes(u?.role);

// Una NC è visibile a un utente SEDE solo se appartiene a una delle sue sedi
export const canSeeSede = (u, sedeId) => isInternal(u) || (isSede(u) && (u.sedi || []).includes(Number(sedeId)));
