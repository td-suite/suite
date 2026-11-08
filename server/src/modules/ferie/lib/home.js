// Contatore della card Piano Ferie nella Home (area People), calcolato per utente:
// - chi approva (responsabile dall'organigramma, delegato, RESPONSABILE) e HR: "richieste da approvare";
// - il dipendente del perimetro: "giorni residui" (disponibile dell'anno: residuo meno le richieste in attesa).
// Gli accessi esterni e chi è fuori perimetro senza approvazioni non hanno contatore. Solo con modulo LIVE.
import { one } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { isExternal } from '../../../lib/esterni.js';
import { contesto, saldoPersona, oggi } from './core.js';

export async function contatoreHome(user) {
  if (!user || isExternal(user)) return null;
  if ((await getModuleState('ferie')).mode !== 'LIVE') return null;
  const admin = user.level === 'OWNER' || user.level === 'ADMIN';
  const role = user.grants?.ferie?.profile || (admin ? 'ADMIN' : 'DIPENDENTE');
  const ctx = await contesto(user, role);
  if (ctx.isAdmin || ctx.isApprovatore) {
    const ids = [...ctx.approva];
    const n = ctx.isAdmin ? (await one(`SELECT count(*)::int AS n FROM richieste WHERE stato='RICHIESTA'`)).n
      : (await one(`SELECT count(*)::int AS n FROM richieste WHERE stato='RICHIESTA' AND person_id = ANY($1::int[])`, [ids])).n;
    if (n > 0 || !ctx.me) return { value: n, label: n === 1 ? 'richiesta da approvare' : 'richieste da approvare' };
  }
  if (ctx.me) {
    const s = await saldoPersona(ctx.me, Number(oggi().slice(0, 4)), ctx.settings);
    return { value: s.disponibile, label: 'giorni residui' };
  }
  return null;
}
