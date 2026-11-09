// Contatore della card Piano Ferie nella Home (area People), calcolato per utente (piano annuale, decisione del CEO dell'08/11/2026;
// approvatore = superiore diretto dell'anagrafica, decisione del 09/11/2026):
// - chi approva (superiore diretto o delegato): piani (e variazioni) da approvare dei suoi DIRETTI;
// - ADMIN: i propri diretti più i piani senza approvatore raggiungibile (anagrafica incompleta), che decide solo l'amministratore;
// - dipendente del perimetro: "giorni da pianificare" del piano dell'anno, oppure "piano definitivo" quando lo è.
// Gli accessi esterni e chi è fuori perimetro senza approvazioni non hanno contatore. Solo con modulo LIVE.
import { one } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { isExternal } from '../../../lib/esterni.js';
import { contesto, saldoPersona, oggi } from './core.js';

/** Piani e variazioni da approvare per un insieme di persone (null = tutte) e un anno */
export async function daApprovare(ids, anni) {
  if (ids && !ids.length) return { piani: 0, variazioni: 0 };
  const filtro = ids ? 'AND person_id = ANY($2::int[])' : '';
  const par = ids ? [anni, ids] : [anni];
  const piani = (await one(`SELECT count(*)::int AS n FROM piani WHERE stato IN ('PROPOSTO','IN_REVISIONE') AND anno = ANY($1::int[]) ${filtro}`, par)).n;
  const variazioni = (await one(`SELECT count(*)::int AS n FROM richieste WHERE (stato='RICHIESTA' OR (variazione_proposta IS NOT NULL AND stato IN ('PIANIFICATA','APPROVATA'))) AND anno = ANY($1::int[]) ${filtro}`, par)).n;
  return { piani, variazioni };
}

/** Persone i cui piani e variazioni l'utente deve decidere: i diretti; per l'ADMIN anche chi non ha un approvatore raggiungibile */
export const idsDaApprovare = (ctx) => [...new Set([...ctx.approva, ...(ctx.isAdmin ? ctx.orfani : [])])].filter((id) => id !== ctx.personId);

export async function contatoreHome(user) {
  if (!user || isExternal(user)) return null;
  if ((await getModuleState('ferie')).mode !== 'LIVE') return null;
  const admin = user.level === 'OWNER' || user.level === 'ADMIN';
  const role = user.grants?.ferie?.profile || (admin ? 'ADMIN' : 'DIPENDENTE');
  const ctx = await contesto(user, role);
  const anno = Number(oggi().slice(0, 4));
  const anni = [anno, anno + 1];
  if (ctx.isAdmin || ctx.isApprovatore) {
    const { piani, variazioni } = await daApprovare(idsDaApprovare(ctx), anni);
    const n = piani + variazioni;
    if (n > 0 || !ctx.me) return { value: n, label: variazioni ? (piani ? 'piani e variazioni da approvare' : (variazioni === 1 ? 'variazione da approvare' : 'variazioni da approvare')) : (piani === 1 ? 'piano da approvare' : 'piani da approvare') };
  }
  if (ctx.me) {
    const piano = await one('SELECT stato FROM piani WHERE person_id=$1 AND anno=$2', [ctx.me.id, anno]);
    if (piano?.stato === 'DEFINITIVO') return { value: 0, label: 'piano definitivo' };
    const s = await saldoPersona(ctx.me, anno, ctx.settings);
    return { value: s.da_pianificare, label: 'giorni da pianificare' };
  }
  return null;
}
