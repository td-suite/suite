// Copertura minima per giorno: per ogni area o sede, numero minimo di presenti per ruolo (es. almeno 1 infermiere e 1 addetto
// all'accettazione in ogni punto prelievi). Una richiesta che fa scendere un giorno sotto il minimo NON è bloccata: è segnalata
// all'approvatore (sotto_copertura + dettaglio dei giorni). Funzioni pure, i dati li prepara chi chiama (routes/piano.js, richieste.js).
//
// Ipotesi dichiarate: contano solo le persone del perimetro (dipendenti) della stessa area o sede; una mezza giornata di assenza vale
// mezza presenza; un giorno non lavorativo per la persona (settimana del contratto) non la conta tra i presenti; le richieste in attesa
// si considerano assenze quando si valuta una richiesta (scenario prudente per l'approvatore).
import { isoWeekday, quotaInData } from './calendario.js';
import { siteDiGruppo } from './perimetro.js';

/** Regole di copertura che valgono per un gruppo (DIR, LAB, SEDE:<id>) dato il tipo della sede */
export function regoleDelGruppo(regole, gruppo, siteKind = null) {
  return (regole || []).filter((r) => r.ambito === gruppo || (siteDiGruppo(gruppo) && siteKind && r.ambito === `KIND:${siteKind}`));
}

/**
 * Presenti in un giorno per una regola. membri: [{ id, ruoli: [role_id], settimana: [1..7] }]; assenze: [{ person_id, data_inizio,
 * data_fine, mezza_inizio, mezza_fine }]; festivi: Map del gruppo (un festivo vale per tutti: nessuno è presente, regola non valutata).
 */
export function presenti(regola, data, membri, assenze) {
  let n = 0;
  for (const m of membri) {
    if (regola.role_id && !(m.ruoli || []).includes(regola.role_id)) continue;
    if (!(m.settimana || [1, 2, 3, 4, 5]).includes(isoWeekday(data))) continue;
    let q = 0;
    for (const a of assenze) if (a.person_id === m.id) q = Math.max(q, quotaInData(a, data));
    n += 1 - Math.min(1, q);
  }
  return n;
}

/**
 * Giorni sotto la copertura minima in un insieme di date. Ritorna [{ data, regola_id, ruolo, minimo, presenti }].
 * Le date festive del gruppo e quelle in cui nessun membro con quel ruolo lavora non si valutano (sede chiusa).
 */
export function scoperture({ date, regole, membri, assenze, festivi = new Map(), ruoliNomi = new Map() }) {
  const out = [];
  for (const d of date) {
    if (festivi.has(d)) continue;
    for (const r of regole) {
      const lavoranti = membri.filter((m) => (!r.role_id || (m.ruoli || []).includes(r.role_id)) && (m.settimana || [1, 2, 3, 4, 5]).includes(isoWeekday(d)));
      if (!lavoranti.length) continue;
      const p = presenti(r, d, membri, assenze);
      if (p < r.minimo) out.push({ data: d, regola_id: r.id, ruolo: r.role_id ? ruoliNomi.get(r.role_id) || `ruolo ${r.role_id}` : 'qualunque ruolo', minimo: r.minimo, presenti: p });
    }
  }
  return out;
}

/**
 * Valutazione di una richiesta: giorni (con quota > 0) in cui, considerando anche questa richiesta, una regola che riguarda il
 * richiedente (regola senza ruolo o con un suo ruolo) scende sotto il minimo.
 */
export function valutaRichiesta({ richiesta, persona, giorni, regole, membri, assenze, festivi, ruoliNomi }) {
  const mie = (regole || []).filter((r) => !r.role_id || (persona.ruoli || []).includes(r.role_id));
  if (!mie.length) return [];
  const conQuesta = [...assenze.filter((a) => a.id !== richiesta.id), { ...richiesta, person_id: persona.id }];
  return scoperture({ date: giorni, regole: mie, membri, assenze: conQuesta, festivi, ruoliNomi });
}
