// Rimborso Spese · contatore della card in Home (area People), calcolato per utente e solo per i dipendenti (gli altri non vedono la
// card): P&C le note approvate da liquidare; il responsabile le note da approvare; il dipendente lo stato della nota del mese precedente
// o del mese corrente in bozza.
import { one } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { isDipendente } from '../../../lib/access.js';
import { contesto, oggi } from './core.js';

export async function contatoreHome(user) {
  if (!isDipendente(user)) return null;
  if ((await getModuleState('rimborsi')).mode !== 'LIVE') return null;
  const ctx = await contesto(user);
  if (!ctx.me) return null;
  if (ctx.isPC) {
    const n = (await one(`SELECT count(*)::int AS n FROM note WHERE stato IN ('APPROVATA','IN_LIQUIDAZIONE') AND person_id <> $1`, [ctx.personId])).n;
    if (n) return { value: n, label: n === 1 ? 'nota da liquidare' : 'note da liquidare' };
  }
  const da = (await one(`SELECT count(*)::int AS n FROM note WHERE stato = 'INVIATA' AND person_id <> $1 AND (responsabile_person_id = $1 OR ($2 AND al_pc))`, [ctx.personId, ctx.isPC])).n;
  if (da || ctx.isResponsabile) return { value: da, label: da === 1 ? 'nota da approvare' : 'note da approvare' };
  const g = oggi();
  const bozze = (await one(`SELECT count(*)::int AS n FROM note WHERE person_id=$1 AND stato='BOZZA' AND (anno * 12 + mese) <= $2`, [ctx.personId, Number(g.slice(0, 4)) * 12 + Number(g.slice(5, 7))])).n;
  return { value: bozze, label: bozze === 1 ? 'nota in bozza' : 'note in bozza' };
}

/** Contatori delle voci di menu (GET /api/rimborsi/badges) */
export async function badges(ctx) {
  const da = (await one(`SELECT count(*)::int AS n FROM note WHERE stato = 'INVIATA' AND person_id <> $1 AND (responsabile_person_id = $1 OR ($2 AND al_pc))`, [ctx.personId, ctx.isPC])).n;
  const liq = ctx.isPC ? (await one(`SELECT count(*)::int AS n FROM note WHERE stato IN ('APPROVATA','IN_LIQUIDAZIONE') AND person_id <> $1`, [ctx.personId])).n : 0;
  const bozze = (await one(`SELECT count(*)::int AS n FROM note WHERE person_id=$1 AND stato='BOZZA'`, [ctx.personId])).n;
  return { da_approvare: da, da_liquidare: liq, bozze, responsabile: ctx.isResponsabile || ctx.isPC || da ? 1 : 0, pc: ctx.isPC ? 1 : 0, gestione: ctx.isPC || ctx.isTitolare ? 1 : 0, dipendente: ctx.me ? 1 : 0 };
}
