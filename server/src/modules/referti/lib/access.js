// Poteri per profilo: LAB elabora e conferma; QUALITA legge registro e impostazioni (e le modifica), non elabora;
// VIEWER consulta; ADMIN (Owner e Admin della Suite) tutto.
import { forbidden } from '../../../lib/util.js';

// Owner e Admin della Suite sono sempre ADMIN del modulo, qualunque profilo porti il loro grant (il seed del titolare assegna LAB)
export const ruolo = (req) => (['OWNER', 'ADMIN'].includes(req.moduleUser?.suite_level) ? 'ADMIN' : req.moduleUser?.role || 'VIEWER');
export const isAdmin = (req) => ruolo(req) === 'ADMIN';
export const isLab = (req) => ['LAB', 'ADMIN'].includes(ruolo(req));
export const isQualita = (req) => ['QUALITA', 'ADMIN'].includes(ruolo(req));

export const requireLab = (req, _res, next) => (isLab(req) ? next() : next(forbidden('Operazione riservata al personale di laboratorio (profilo Laboratorio)')));
export const requireQualita = (req, _res, next) => (isQualita(req) ? next() : next(forbidden('Operazione riservata a Qualità o all\'amministratore')));
