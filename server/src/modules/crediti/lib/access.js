// Recupero Crediti · profili e permessi. Profili del grant: CEO, CFO (il Responsabile Amministrazione e Finanza del memo), ATT
// (Amministrazione), COMMERCIALE (referente commerciale: vede e lavora solo i suoi clienti), LEGALE (solo le pratiche autorizzate),
// VIEWER (sola lettura). Il titolare della Suite senza grant entra come CEO; un amministratore della Suite senza grant come VIEWER:
// le decisioni del processo (esclusione di un cliente dai solleciti, modalità Attiva, firma del 2° sollecito, autorizzazione dell'area
// legale) sono SOLO di CEO e CFO, come chiesto dal CEO il 24/11/2026.
import { forbidden } from '../../../lib/util.js';
import { many } from '../db.js';

export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'VIEWER' } };
export const PROFILI = ['CEO', 'CFO', 'ATT', 'COMMERCIALE', 'LEGALE', 'VIEWER'];

export function ruoloDi(user) {
  const g = user?.grants?.crediti?.profile;
  if (PROFILI.includes(g)) return g;
  return user?.level === 'OWNER' ? 'CEO' : 'VIEWER';
}
/** Middleware: req.cred = { ruolo, dirige, opera, commerciale, legale, lettura } */
export function contesto(req, _res, next) {
  const ruolo = ruoloDi(req.user);
  req.cred = { ruolo, dirige: ['CEO', 'CFO'].includes(ruolo), opera: ['CEO', 'CFO', 'ATT'].includes(ruolo), commerciale: ruolo === 'COMMERCIALE', legale: ruolo === 'LEGALE',
    tutto: ['CEO', 'CFO', 'ATT', 'VIEWER'].includes(ruolo) };
  next();
}
export const soloDirezione = (req, _res, next) => (req.cred.dirige ? next() : next(forbidden('Decisione riservata a CEO e CFO')));
export const soloOperativi = (req, _res, next) => (req.cred.opera ? next() : next(forbidden('Operazione riservata all\'Amministrazione, al CFO e al CEO')));
export const soloVistaCompleta = (req, _res, next) => (req.cred.tutto ? next() : next(forbidden('Sezione non prevista dal tuo profilo')));

/**
 * Clienti visibili: null = tutti (CEO, CFO, ATT, VIEWER); altrimenti l'elenco degli id. Il referente commerciale vede i clienti di cui
 * è referente (scelto nella scheda crediti, altrimenti titolare dell'account del Business Hub); l'area legale quelli con una pratica
 * autorizzata o trasmessa.
 */
export async function clientiVisibili(req) {
  if (req.cred.tutto) return null;
  if (req.cred.commerciale) {
    const hub = await many(`SELECT to_regclass('business.accounts') IS NOT NULL AS c`);
    const daHub = hub[0].c ? await many(`SELECT DISTINCT a.organization_id AS id FROM business.accounts a WHERE a.owner_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM clienti c WHERE c.organization_id = a.organization_id AND c.referente_user_id IS NOT NULL)`, [req.user.id]) : [];
    const scelti = await many('SELECT organization_id AS id FROM clienti WHERE referente_user_id = $1', [req.user.id]);
    return [...new Set([...daHub, ...scelti].map((r) => r.id))];
  }
  if (req.cred.legale) return (await many(`SELECT DISTINCT organization_id AS id FROM pratiche_legali WHERE stato IN ('AUTORIZZATA','TRASMESSA','CHIUSA')`)).map((r) => r.id);
  return [];
}
export async function puoVedereCliente(req, orgId) { const v = await clientiVisibili(req); return v === null || v.includes(Number(orgId)); }

/** Utenti della Suite da avvisare per profilo (più il titolare per CEO). */
export async function utentiConProfilo(...profili) {
  return (await many(`SELECT DISTINCT u.id FROM public.users u LEFT JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'crediti' AND NOT g.proposed
     WHERE u.status = 'ACTIVE' AND (g.profile = ANY($1::text[]) OR ($2 AND u.level = 'OWNER' AND g.id IS NULL))`, [profili, profili.includes('CEO')])).map((r) => r.id);
}
