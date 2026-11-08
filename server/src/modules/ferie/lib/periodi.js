// Conteggio e controlli di un periodo di ferie per una persona (piano annuale, variazioni, anteprima): giorni lavorativi con festivi,
// patrono e settimana del contratto; sovrapposizioni con gli altri periodi attivi; saldo dopo il periodo; chiusure collettive.
import { many } from '../db.js';
import { bad } from '../../../lib/util.js';
import { saldoPersona, calendarioPersona } from './core.js';
import { contaGiorni, isoWeekday } from './calendario.js';
import { chiusureGruppo } from './piano.js';

/**
 * b: { tipo, data_inizio, data_fine, mezza_inizio, mezza_fine, ore }. escludiId: periodo da non considerare nelle sovrapposizioni
 * (spostamento). Ritorna { anno, giorni, ore, dettaglio, festivi, conflitti, saldo, saldo_dopo, avvisi, chiusure, settimana }.
 */
export async function analizza(ctx, p, b, escludiId = null) {
  const tipo = b.tipo || 'FERIE';
  if (b.data_inizio.slice(0, 4) !== b.data_fine.slice(0, 4)) throw bad('Il periodo è a cavallo di due anni: dividilo in due periodi, uno per ogni piano annuale');
  const anno = Number(b.data_inizio.slice(0, 4));
  const cal = await calendarioPersona(p, [anno], ctx.settings);
  if (tipo === 'ROL') {
    if (!ctx.settings.rol_attivi) throw bad('La voce ROL/permessi non è attiva (Impostazioni del modulo)');
    if (b.data_inizio !== b.data_fine) throw bad('Un permesso ROL si chiede per un solo giorno, in ore');
    if (!b.ore) throw bad('Indica le ore del permesso');
  }
  const c = tipo === 'ROL' ? { giorni: 0, dettaglio: [{ data: b.data_inizio, quota: 0 }] } : contaGiorni({ inizio: b.data_inizio, fine: b.data_fine, mezza_inizio: b.mezza_inizio, mezza_fine: b.mezza_fine }, cal);
  if (c.errore) throw bad(c.errore);
  if (tipo === 'FERIE' && c.giorni <= 0) throw bad('Nel periodo non ci sono giorni lavorativi (festivi o giorni di riposo della settimana lavorativa)');
  if (tipo === 'ROL' && !cal.settimana.includes(isoWeekday(b.data_inizio))) throw bad('Il giorno scelto non è lavorativo nella settimana del contratto');
  // nessuna sovrapposizione con altri periodi attivi della stessa persona (nel piano, variazioni in attesa, approvati, goduti)
  const conflitti = await many(`SELECT id, tipo, stato, data_inizio, data_fine FROM richieste WHERE person_id=$1 AND stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA')
      AND data_fine >= $2 AND data_inizio <= $3 AND ($4::int IS NULL OR id <> $4)`, [p.id, b.data_inizio, b.data_fine, escludiId]);
  const saldo = await saldoPersona(p, anno, ctx.settings);
  const prima = escludiId ? Number((await many('SELECT giorni FROM richieste WHERE id=$1 AND stato IN (\'PIANIFICATA\',\'APPROVATA\',\'GODUTA\')', [escludiId]))[0]?.giorni || 0) : 0;
  const dopo = tipo === 'FERIE' ? Math.round((saldo.da_pianificare + prima - c.giorni) * 100) / 100 : null;
  const avvisi = [];
  if (dopo != null && dopo < 0) avvisi.push(`Con questo periodo i giorni da pianificare vanno a ${dopo.toLocaleString('it-IT')} (anticipo di ferie: deciderà il responsabile)`);
  if ((p.inizio && b.data_inizio < p.inizio) || (p.fine && b.data_fine > p.fine)) avvisi.push('Il periodo esce dalle date del contratto di lavoro');
  const chiusure = await chiusureGruppo(p.gruppo, b.data_inizio, b.data_fine);
  return { anno, giorni: c.giorni, ore: tipo === 'ROL' ? b.ore : null, dettaglio: c.dettaglio, festivi: c.dettaglio.filter((d) => d.festivo), conflitti, saldo, saldo_dopo: dopo, avvisi, chiusure, settimana: cal.settimana_etichetta };
}

export const testoConflitti = (conflitti) => `Il periodo si sovrappone a ${conflitti.length === 1 ? 'un altro periodo' : `${conflitti.length} periodi`} (${conflitti.map((x) => `${x.data_inizio} → ${x.data_fine}`).join('; ')})`;
