// Contatore della card Piano Ferie nella Home (area People), calcolato per utente (piano annuale, decisione del CEO dell'08/11/2026):
// - ADMIN: piani da approvare (inviati o in revisione) di tutte le aree, più le variazioni in attesa;
// - responsabile dell'area: piani (e variazioni) da approvare dei dipendenti che gestisce;
// - dipendente del perimetro: "giorni da pianificare" del piano dell'anno, oppure "piano definitivo" quando lo è.
// Gli accessi esterni e chi è fuori perimetro senza approvazioni non hanno contatore. Solo con modulo LIVE.
import { one } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { isExternal } from '../../../lib/esterni.js';
import { contesto, saldoPersona, oggi } from './core.js';

/** Piani e variazioni da approvare per un insieme di persone (null = tutte) e un anno */
export async function daApprovare(ids, anni) {
  const filtro = ids ? 'AND person_id = ANY($2::int[])' : '';
  const par = ids ? [anni, ids] : [anni];
  const piani = (await one(`SELECT count(*)::int AS n FROM piani WHERE stato IN ('PROPOSTO','IN_REVISIONE') AND anno = ANY($1::int[]) ${filtro}`, par)).n;
  const variazioni = (await one(`SELECT count(*)::int AS n FROM richieste WHERE (stato='RICHIESTA' OR (variazione_proposta IS NOT NULL AND stato IN ('PIANIFICATA','APPROVATA'))) AND anno = ANY($1::int[]) ${filtro}`, par)).n;
  return { piani, variazioni };
}

export async function contatoreHome(user) {
  if (!user || isExternal(user)) return null;
  if ((await getModuleState('ferie')).mode !== 'LIVE') return null;
  const admin = user.level === 'OWNER' || user.level === 'ADMIN';
  const role = user.grants?.ferie?.profile || (admin ? 'ADMIN' : 'DIPENDENTE');
  const ctx = await contesto(user, role);
  const anno = Number(oggi().slice(0, 4));
  const anni = [anno, anno + 1];
  if (ctx.isAdmin || ctx.isApprovatore) {
    const { piani, variazioni } = await daApprovare(ctx.isAdmin ? null : [...ctx.approva], anni);
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
