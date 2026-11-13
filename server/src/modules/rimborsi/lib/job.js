// Rimborso Spese · job rimborsi:promemoria (scheduler della Suite, ogni ora, solo con modulo LIVE; lavora dalle 8 ora di Roma):
// 1. al dipendente con la nota del mese precedente ancora in BOZZA (con almeno una riga), dal giorno N-3 del mese (N = giorno limite)
//    e dopo, una volta al giorno;
// 2. al responsabile (o a P&C per le note del vertice) con note in attesa da più di 5 giorni (impostazione), una volta al giorno per nota;
// 3. a P&C il riepilogo delle note approvate da liquidare, una volta al giorno.
import { q, many } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { settings, setSetting, perimetro, personePc, utentiDiPersone, notifica, oggi, linkNota } from './core.js';
import { nomeMese, finestraInvio, itData, eur } from './calcoli.js';

const oraRoma = (d = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
const meseIndietro = (anno, mese) => (mese === 1 ? { anno: anno - 1, mese: 12 } : { anno, mese: mese - 1 });

export async function eseguiJob({ forza = false, now = new Date() } = {}) {
  if ((await getModuleState('rimborsi')).mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
  if (!forza && oraRoma(now) < 8) return { skipped: true, reason: 'prima delle 8' };
  const s = await settings();
  const g = oggi();
  const out = { promemoria_bozze: 0, promemoria_responsabili: 0, riepilogo_pc: 0 };
  const [y, m, d] = g.split('-').map(Number);

  // 1. bozze del mese precedente (e più vecchie) con righe, dal giorno N-3
  const prima = Math.max(0, Number(s.promemoria_bozza_giorni_prima ?? 3));
  const lim = Number(s.giorno_limite || 10);
  if (d >= Math.max(1, lim - prima)) {
    const prec = meseIndietro(y, m);
    const bozze = await many(`SELECT n.id, n.person_id, n.anno, n.mese FROM note n WHERE n.stato = 'BOZZA' AND (n.anno * 12 + n.mese) <= $1
        AND (EXISTS (SELECT 1 FROM spese x WHERE x.nota_id = n.id) OR EXISTS (SELECT 1 FROM viaggi x WHERE x.nota_id = n.id))
        AND (n.promemoria_at IS NULL OR (n.promemoria_at AT TIME ZONE 'Europe/Rome')::date < $2::date)`, [prec.anno * 12 + prec.mese, g]);
    for (const b of bozze) {
      const f = finestraInvio({ anno: b.anno, mese: b.mese, oggi: g, giornoLimite: lim });
      const dest = await utentiDiPersone([b.person_id]);
      if (!dest.length) continue;
      await notifica(dest, { title: f.in_ritardo ? `La nota spese di ${nomeMese(b.anno, b.mese)} andava inviata entro il ${itData(f.scadenza)}` : `Invia la nota spese di ${nomeMese(b.anno, b.mese)} entro il ${itData(f.scadenza)}`,
        body: 'Controlla spese, viaggi e giustificativi e premi "Invia al responsabile".', link: linkNota(b), ref: `rimborsi:${b.id}:promemoria` });
      await q('UPDATE note SET promemoria_at=now() WHERE id=$1', [b.id]);
      await q(`INSERT INTO eventi (nota_id, tipo, dati) VALUES ($1, 'PROMEMORIA', $2)`, [b.id, JSON.stringify({ a: 'dipendente', scadenza: f.scadenza })]);
      out.promemoria_bozze++;
    }
  }

  // 2. note in attesa del responsabile da più di N giorni
  const gg = Math.max(1, Number(s.promemoria_responsabile_giorni || 5));
  const attesa = await many(`SELECT n.*, p.last_name || ' ' || p.first_name AS persona FROM note n JOIN public.people p ON p.id = n.person_id
      WHERE n.stato = 'INVIATA' AND n.inviata_at < now() - ($1 || ' days')::interval AND (n.promemoria_at IS NULL OR n.promemoria_at < now() - interval '20 hours') ORDER BY n.inviata_at`, [String(gg)]);
  const perim = attesa.length ? await perimetro() : null;
  const pc = perim ? await personePc(perim, s) : new Set();
  for (const n of attesa) {
    const dest = n.al_pc ? await utentiDiPersone([...pc].filter((id) => id !== n.person_id)) : await utentiDiPersone([n.responsabile_person_id]);
    if (!dest.length) continue;
    const giorni = Math.floor((now.getTime() - new Date(n.inviata_at).getTime()) / 86400000);
    await notifica(dest, { title: `Promemoria: la nota spese di ${n.persona} (${nomeMese(n.anno, n.mese)}) attende da ${giorni} giorni`, body: `Totale rimborsabile ${eur(n.tot_rimborsabile)}. Approva, escludi righe o respingi con il motivo.`, link: linkNota(n), ref: `rimborsi:${n.id}:promemoria-resp` });
    await q('UPDATE note SET promemoria_at=now() WHERE id=$1', [n.id]);
    await q(`INSERT INTO eventi (nota_id, tipo, dati) VALUES ($1, 'PROMEMORIA', $2)`, [n.id, JSON.stringify({ a: n.al_pc ? 'P&C' : 'responsabile', giorni })]);
    out.promemoria_responsabili++;
  }

  // 3. riepilogo a P&C delle approvate da liquidare (una volta al giorno)
  if (s.ultimo_riepilogo_pc !== g) {
    const da = await many(`SELECT n.id, n.tot_rimborsabile, n.saldo, n.approvata_at FROM note n WHERE n.stato IN ('APPROVATA','IN_LIQUIDAZIONE') ORDER BY n.approvata_at`);
    if (da.length) {
      const pr = perim || (await perimetro());
      const dest = await utentiDiPersone([...(pc.size ? pc : await personePc(pr, s))]);
      const tot = da.reduce((a, x) => a + Math.max(0, Number(x.saldo)), 0);
      if (dest.length) {
        await notifica(dest, { title: `Rimborso Spese: ${da.length} ${da.length === 1 ? 'nota approvata' : 'note approvate'} da liquidare`, body: `Saldo complessivo a favore dei dipendenti ${eur(tot)}. La più vecchia è approvata dal ${itData(new Date(da[0].approvata_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }))}.`, link: '/rimborsi/liquidazione', ref: `rimborsi:riepilogo:${g}` });
        out.riepilogo_pc = da.length;
      }
    }
    await setSetting('ultimo_riepilogo_pc', g);
  }
  return out;
}
