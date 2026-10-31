// Poteri per profilo del modulo Facility e Manutenzioni.
// ADMIN (Owner e Admin della Suite) e FACILITY (Operations): tutto. MANUTENTORE: vede piano e interventi (se esterno, solo quelli
// assegnati alla sua Legal entity o a lui), chiude le scadenze ed esegue gli interventi. SITE (site manager, ambito sede): solo le
// proprie sedi; segnala guasti e conferma i controlli di sede (sorveglianza). VIEWER (Qualità/HSQ): consultazione e report.
import { forbidden } from '../../../lib/util.js';

export const ruolo = (req) => (['OWNER', 'ADMIN'].includes(req.moduleUser?.suite_level) ? 'ADMIN' : req.moduleUser?.role || 'VIEWER');
export const isAdmin = (req) => ruolo(req) === 'ADMIN';
export const isFacility = (req) => ['FACILITY', 'ADMIN'].includes(ruolo(req));          // gestione completa
export const isManutentore = (req) => ruolo(req) === 'MANUTENTORE';
export const isSite = (req) => ruolo(req) === 'SITE';
export const isViewer = (req) => ruolo(req) === 'VIEWER';
// esegue scadenze e interventi
export const canExecute = (req) => isFacility(req) || isManutentore(req);

// Sedi del site manager: ambito SITE del grant + sedi di cui è manager_email nell'organigramma (req.managedSiteIds)
export const mySiteIds = (req) => req.managedSiteIds || [];
export const limitedToSites = (req) => isSite(req);
export const canSeeSite = (req, siteId) => !limitedToSites(req) || mySiteIds(req).includes(Number(siteId));
export const assertSite = (req, siteId) => { if (!canSeeSite(req, siteId)) throw forbidden('Sede non assegnata'); };
// manutentore esterno: vede solo ciò che è assegnato alla sua Legal entity o a lui
export const vendorScope = (req) => (isManutentore(req) && req.vendorOrgId ? { orgId: req.vendorOrgId, userId: req.user.id } : null);

export const requireFacility = (req, _res, next) => (isFacility(req) ? next() : next(forbidden('Operazione riservata a Facility (Operations) o all\'amministratore')));
export const requireExecute = (req, _res, next) => (canExecute(req) ? next() : next(forbidden('Operazione riservata a Facility e ai manutentori')));
// tutto ciò che non è consultazione: VIEWER mai
export const requireWrite = (req, _res, next) => (isViewer(req) ? next(forbidden('Profilo in sola consultazione')) : next());
// sezioni non disponibili al manutentore esterno né al site manager (impostazioni, energia di rete, utenze)
export const requireInternalFull = (req, _res, next) => (isFacility(req) || isViewer(req) ? next() : next(forbidden('Sezione riservata a Facility e alla consultazione')));
