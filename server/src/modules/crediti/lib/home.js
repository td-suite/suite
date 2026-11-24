// Recupero Crediti · contatore della card in home: cosa aspetta QUESTA persona.
import { one } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { ruoloDi } from './access.js';

export async function contatoreHome(user) {
  if (!user?.grants?.crediti && user?.level !== 'OWNER') return null;
  if ((await getModuleState('crediti')).mode !== 'LIVE') return null;
  const ruolo = ruoloDi(user);
  if (ruolo === 'COMMERCIALE') { const n = (await one(`SELECT count(*)::int AS n FROM attivita WHERE stato = 'APERTA' AND NOT simulata AND assegnata_user_id = $1`, [user.id])).n; return { value: n, label: n === 1 ? 'chiamata da fare' : 'chiamate da fare' }; }
  if (ruolo === 'LEGALE') { const n = (await one(`SELECT count(*)::int AS n FROM pratiche_legali WHERE stato = 'AUTORIZZATA'`)).n; return { value: n, label: n === 1 ? 'fascicolo da prendere in carico' : 'fascicoli da prendere in carico' }; }
  if (ruolo === 'VIEWER') return null;
  const k = await one(`SELECT (SELECT count(*)::int FROM comunicazioni WHERE stato = 'DA_APPROVARE' AND ($1 OR fase < 3)) AS a, (SELECT count(*)::int FROM risposte WHERE stato = 'DA_GESTIRE') AS r,
      (SELECT count(*)::int FROM pratiche_legali WHERE stato = 'PROPOSTA' AND NOT simulata) AS l, (SELECT count(*)::int FROM movimenti WHERE stato = 'PROPOSTO') AS m`, [['CEO', 'CFO'].includes(ruolo)]);
  const n = k.a + k.r + (['CEO', 'CFO'].includes(ruolo) ? k.l : 0) + (ruolo === 'ATT' ? k.m : 0);
  return { value: n, label: n === 1 ? 'cosa da decidere' : 'cose da decidere' };
}
