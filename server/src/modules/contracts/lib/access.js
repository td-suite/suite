// Permessi del modulo Contracts. L'autenticazione la fa la Suite: req.user qui è la riga della tabella users dell'app
// (schema contracts) con role = profilo del grant Suite (ADMIN, HR, VIEWER). Login, Entra, TOTP e gestione utenti non si portano.
import { readLog as suiteReadLog } from '../../../lib/util.js';
import { forbidden } from './util.js';
import { one } from '../db.js';

export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

// Utente senza campi riservati (per /auth/me e /state)
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, totp_secret, entra_oid, failed_logins, locked_until, ...rest } = u;
  return rest;
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
// ADMIN e HR possono scrivere; VIEWER è in sola lettura
export const canWrite = (u) => ['ADMIN', 'HR'].includes(u?.role);
export const requireWrite = (req, _res, next) => (canWrite(req.user) ? next() : next(forbidden('Profilo in sola lettura')));
export const isAdmin = (u) => u?.role === 'ADMIN';
// Casella People: approvano l'upload nel dossier e la chiusura della scadenza il CEO (titolare della Suite, OWNER) e l'HR Manager
// (profilo HR o ADMIN del modulo). VIEWER mai.
export const canApprove = (u) => u?.suite_level === 'OWNER' || ['ADMIN', 'HR'].includes(u?.role);
export const requireApprover = (req, _res, next) => (canApprove(req.user) ? next() : next(forbidden('Solo il CEO o l\'HR Manager approvano i documenti della casella People')));

// Audit di lettura della Suite (read_log, modulo contracts): ogni consultazione di una scheda del personale viene registrata
// con l'utente Suite (req.suiteUser), non con la riga users dello schema del modulo.
export async function readLog(req, entity, entityId) {
  await suiteReadLog({ user: req.suiteUser || req.user, ip: req.ip }, { module: 'contracts', entity, entityId });
}

// ---------------------------------------------------------------- profilo LP: sola lettura dei SOLI liberi professionisti
// Decisione del CEO (14/11/2026): chi ha il profilo LP non deve avere "possibilità alcuna" di vedere i dati dei dipendenti. Perciò il
// controllo è un elenco CHIUSO: tutto ciò che non è qui sotto risponde 403, comprese le route che nasceranno in futuro. Le route con
// una persona o un documento nell'indirizzo passano solo se la persona è un LP (kind della vista resources_v); gli elenchi e
// l'estratto sono poi filtrati sugli LP dalle route stesse (soloLp).
export const soloLp = (u) => u?.role === 'LP';
const LP_LIBERE = [/^\/badges$/, /^\/state$/, /^\/auth\/(me|config)$/, /^\/areas$/, /^\/work-sites$/, /^\/job-roles$/, /^\/resources\/?$/, /^\/stats\/(deadlines|costs\.xlsx)$/];
const LP_PERSONA = [/^\/resources\/(\d+)$/, /^\/resources\/(\d+)\/attachments\/\d+\/download$/];
const LP_DOCUMENTO = [/^\/documents\/(\d+)(?:\/download)?$/];
const NIENTE = 'Il tuo profilo consente la sola consultazione dei liberi professionisti';
// ---------------------------------------------------------------- profilo MDL: sola lettura delle scadenze di medicina del lavoro
// Richiesta del CEO (17/11/2026), per il responsabile HQS. Elenco chiuso come per il profilo LP: vede soltanto il calendario della
// sorveglianza (persona, mansione, sede, ultima visita, prossima visita, visita fissata). Mai il giudizio di idoneità né le prescrizioni,
// mai schede, dossier, contratti o dati economici. Non convoca.
export const soloMdlProfilo = (u) => u?.role === 'MDL';
const MDL_LIBERE = [/^\/badges$/, /^\/state$/, /^\/auth\/(me|config)$/, /^\/mdl\/scadenze$/];
const NIENTE_MDL = 'Il tuo profilo consente la sola consultazione delle scadenze di medicina del lavoro';
export async function lpGuard(req, _res, next) {
  try {
    if (soloMdlProfilo(req.user)) {
      const path = req.path.replace(/\/+$/, '') || '/';
      return next(req.method === 'GET' && MDL_LIBERE.some((re) => re.test(path)) ? undefined : forbidden(NIENTE_MDL));
    }
    if (!soloLp(req.user)) return next();
    if (req.method !== 'GET') return next(forbidden(NIENTE));
    const path = req.path.replace(/\/+$/, '') || '/';
    if (LP_LIBERE.some((re) => re.test(path))) return next();
    for (const re of LP_PERSONA) {
      const m = path.match(re);
      if (m) { const r = await one('SELECT kind FROM resources_v WHERE id=$1', [Number(m[1])]); return next(r?.kind === 'LP' ? undefined : forbidden(NIENTE)); }
    }
    for (const re of LP_DOCUMENTO) {
      const m = path.match(re);
      if (m) { const r = await one('SELECT r.kind FROM generated_documents g JOIN resources_v r ON r.id=g.resource_id WHERE g.id=$1', [Number(m[1])]); return next(r?.kind === 'LP' ? undefined : forbidden(NIENTE)); }
    }
    return next(forbidden(NIENTE));
  } catch (e) { return next(e); }
}
