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
// ADMIN e HR possono scrivere; VIEWER è in sola lettura. Il profilo LP scrive SOLO sui liberi professionisti (v0.99.12): il perimetro
// lo decide lpGuard, che gira prima di ogni route del modulo, quindi qui basta lasciarlo passare.
export const canWrite = (u) => ['ADMIN', 'HR', 'LP'].includes(u?.role);
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

// ---------------------------------------------------------------- profilo LP: GESTIONE dei SOLI liberi professionisti
// Decisione del CEO (14/11/2026): chi ha il profilo LP non deve avere "possibilità alcuna" di vedere i dati dei dipendenti. Perciò il
// controllo è un elenco CHIUSO: tutto ciò che non è qui sotto risponde 403, comprese le route che nasceranno in futuro.
// Decisione del CEO (27/11/2026, v0.99.12): il profilo non è più in sola lettura, è EDITOR dei liberi professionisti: li aggiunge,
// li corregge, li modifica, li cessa, li riattiva e li elimina, con dossier, scadenze e contratto di incarico ("altrimenti Room
// Planning non è usabile": i professionisti dei turni vengono da questa anagrafica). Resta chiuso tutto ciò che riguarda dipendenti
// e tirocinanti. Le route con una persona o un documento nell'indirizzo passano solo se la persona è un LP (kind della vista
// resources_v); una persona nuova o modificata deve essere, e restare, un LP; elenchi ed estratto sono filtrati dalle route (soloLp).
export const soloLp = (u) => u?.role === 'LP';
const LP_LIBERE = [/^\/badges$/, /^\/state$/, /^\/auth\/(me|config)$/, /^\/areas$/, /^\/work-sites$/, /^\/job-roles$/, /^\/resources\/?$/, /^\/stats\/(deadlines|costs\.xlsx)$/];
// letture e scritture sulla scheda di una persona: anagrafica, incarico, cessazione e riattivazione, dossier, scadenze, contratto di incarico
const LP_PERSONA = [/^\/resources\/(\d+)$/, /^\/resources\/(\d+)\/(lp|terminate|reactivate)$/, /^\/resources\/(\d+)\/attachments(?:\/analyze|\/analyze-all|\/\d+(?:\/download|\/analyze)?)?$/,
  /^\/resources\/(\d+)\/deadlines(?:\/\d+)?$/, /^\/resources\/(\d+)\/documents\/generate$/];
const LP_DOCUMENTO = [/^\/documents\/(\d+)(?:\/download|\/archive)?$/];
const LP_NUOVA = [/^\/resources$/, /^\/resources\/parse-document$/];   // POST: nuova persona (solo LP) e lettura del documento da cui precompilarla
const NIENTE = 'Il tuo profilo gestisce i soli liberi professionisti';
const tipoHr = (k) => (['DIPENDENTE', 'DIRIGENTE'].includes(k) ? 'DIPENDENTE' : k === 'TIROCINANTE' ? 'TIROCINANTE' : 'LP');   // come hrKind di lib/people.js
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
    const path = req.path.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && LP_LIBERE.some((re) => re.test(path))) return next();
    // nuova persona: deve essere un libero professionista, senza rapporto di lavoro dipendente né tirocinio
    if (req.method === 'POST' && LP_NUOVA.some((re) => re.test(path))) {
      if (path === '/resources') { const k = req.body?.person?.kind; if (!k || tipoHr(k) !== 'LP' || req.body?.employment || req.body?.tirocinio) return next(forbidden('Con questo profilo si inseriscono solo liberi professionisti')); }
      return next();
    }
    for (const re of LP_PERSONA) {
      const m = path.match(re);
      if (!m) continue;
      const r = await one('SELECT kind FROM resources_v WHERE id=$1', [Number(m[1])]);
      if (r?.kind !== 'LP') return next(forbidden(NIENTE));
      // una modifica non può trasformare il professionista in un dipendente o in un tirocinante
      if (req.method !== 'GET' && req.body?.kind && tipoHr(req.body.kind) !== 'LP') return next(forbidden('Con questo profilo la persona resta un libero professionista'));
      return next();
    }
    for (const re of LP_DOCUMENTO) {
      const m = path.match(re);
      if (m) { const r = await one('SELECT r.kind FROM generated_documents g JOIN resources_v r ON r.id=g.resource_id WHERE g.id=$1', [Number(m[1])]); return next(r?.kind === 'LP' ? undefined : forbidden(NIENTE)); }
    }
    return next(forbidden(NIENTE));
  } catch (e) { return next(e); }
}
