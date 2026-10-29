// Poteri per profilo del modulo Audit SGI.
// ADMIN (Owner e Admin della Suite): tutto. QUALITA: tutto il ciclo (conduce audit interni, di terze parti e sui partner, verifica gli
// auto-audit, sintesi, impostazioni, modelli). AUDITOR (Retail Manager, Service, MDL Manager): conduce audit interni e sui partner,
// carica audit di terze parti, verifica gli auto-audit. SITE (ambito sede): compila l'auto-audit della propria sede e vede i propri
// audit e la sintesi della sede. VIEWER: consultazione.
import { forbidden } from '../../../lib/util.js';

export const ruolo = (req) => (['OWNER', 'ADMIN'].includes(req.moduleUser?.suite_level) ? 'ADMIN' : req.moduleUser?.role || 'VIEWER');
export const isAdmin = (req) => ruolo(req) === 'ADMIN';
export const isQualita = (req) => ['QUALITA', 'ADMIN'].includes(ruolo(req));
export const isAuditor = (req) => ['AUDITOR', 'QUALITA', 'ADMIN'].includes(ruolo(req));   // conduce e verifica
export const isSite = (req) => ruolo(req) === 'SITE';
export const isViewer = (req) => ruolo(req) === 'VIEWER';

// Sedi di cui l'utente è site manager: ambito SITE del grant più le sedi di cui è manager_email nell'organigramma (req.managedSiteIds,
// calcolato dal middleware del modulo). Per i profili con visione completa (QUALITA, AUDITOR, ADMIN, VIEWER) la lista non limita la lettura.
export const mySiteIds = (req) => req.managedSiteIds || [];
export const limitedToSites = (req) => isSite(req);
export const canSeeSite = (req, siteId) => !limitedToSites(req) || mySiteIds(req).includes(Number(siteId));
export const isManagerOf = (req, siteId) => mySiteIds(req).includes(Number(siteId));

export const requireAuditor = (req, _res, next) => (isAuditor(req) ? next() : next(forbidden('Operazione riservata a Qualità, agli auditor o all\'amministratore')));
export const requireQualita = (req, _res, next) => (isQualita(req) ? next() : next(forbidden('Operazione riservata a Qualità o all\'amministratore')));
