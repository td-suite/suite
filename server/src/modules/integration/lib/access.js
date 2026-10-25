// Ruoli dell'app di origine. req.user.role è il profilo del grant Suite (ADMIN, EDITOR, VIEWER): stesso vocabolario.
// loadUser e requireAuth non si portano: autenticazione e sessione sono della Suite.
import { forbidden } from './util.js';

export const ROLES = ['ADMIN', 'EDITOR', 'VIEWER'];

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
export const requireEditor = requireRole('ADMIN', 'EDITOR');
export const requireAdmin = requireRole('ADMIN');
export const isAdmin = (u) => u?.role === 'ADMIN';
export const canEdit = (u) => u?.role === 'ADMIN' || u?.role === 'EDITOR';
