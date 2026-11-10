// Room Planning · impegni della settimana-tipo di una sede (v0.68.4, CEO 10/11/2026): "l'impegno assegnato in Sedi e ambulatori deve
// arrivare in Calendario, Turni e Presenze". Dal piano calcolato della sede (computePlan) si ricavano TUTTI gli impegni delle persone
// del personale di sede, non solo i medici:
//   - medico: sessione in ambulatorio (assegnazione medico → ambulatorio e fascia);
//   - personale sanitario: supporto a un medico (assegnazione del sanitario di supporto) e copertura del Punto prelievi (fasce prelievi
//     degli ambulatori, date al primo sanitario libero in quella fascia, nell'ordine del personale di sede);
//   - accettazione: turni del desk calcolati dal piano (deskWeeks; con la turnazione le settimane A e B si alternano: settimane ISO
//     dispari = A, pari = B).
// Codice puro, IDENTICO in server/src/modules/room/lib/impegni.js e web/src/modules/room/lib/impegni.js (lo verifica il test
// room-impegni.test.mjs): lo usano la generazione dei turni e le presenze sul server, il Calendario e il network nel browser.
import { computePlan, sanRanges, intersectM, subtractM, mergeM } from './engine.js';

export const GRUPPI = { medico: 'Medico', sanitario: 'Personale sanitario', accettazione: 'Accettazione' };
const ATTIVITA = /^(punto prelievi|rm |rx|mammograf|tc\b|moc|opt|seminolog|anatomia patolog|medicina del lavoro)/i;
/** Righe del personale che sono attività (Punto prelievi, RM, RX, ...) e non persone. */
export const rigaAttivita = (p) => ATTIVITA.test(String(p?.nome || '').trim());
export const dowIso = (iso) => (new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7;   // 0 = lunedì

/** Numero della settimana ISO 8601 di una data 'AAAA-MM-GG'. */
export function settimanaIso(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const g = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - g + 3);   // giovedì della stessa settimana
  const primo = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - primo) / 86400000 - 3 + ((primo.getUTCDay() + 6) % 7)) / 7);
}
/** Settimana della turnazione del desk per una data: 0 = A (settimane ISO dispari), 1 = B (pari). */
export const settimanaTurnazione = (iso) => (settimanaIso(iso) % 2 === 1 ? 0 : 1);

const nomeDi = (p) => String(p?.nome || '').trim();
const persona = (p) => ({ rowId: p.id, nome: nomeDi(p), person_id: p.person_id != null && p.person_id !== '' ? Number(p.person_id) : null, gruppo: p.tipo, profilo: p.profilo || null });

/**
 * Impegni della settimana-tipo: [{ d (0 = lunedì), sett (null | 0 = A | 1 = B), rowId, nome, person_id, gruppo, profilo, s, e (minuti),
 * roomId, room, attivita }]. str: documento della sede (lo stesso del planner); plan: esito di computePlan (si calcola se manca).
 */
export function impegniSettimana(str, plan = null) {
  plan = plan || computePlan(str);
  const byId = plan.byId || {};
  const out = [];
  const busy = {};   // rowId|d → fasce già impegnate (supporto) per la copertura dei prelievi
  const occupa = (id, d, s, e) => { (busy[`${id}|${d}`] ||= []).push([s, e]); };
  for (const a of plan.assigns || []) {
    const m = byId[a.medId], r = byId[a.roomId];
    const room = r?.nome || '';
    if (m && nomeDi(m) && !rigaAttivita(m)) {
      const disc = (Array.isArray(m.discipline) && m.discipline.length ? m.discipline : m.disciplina ? [m.disciplina] : []).join(', ');
      out.push({ ...persona(m), d: a.d, sett: null, s: a.s, e: a.e, roomId: a.roomId, room, attivita: `${/^ambulatori/i.test(room) ? room : `Ambulatorio ${room}`.trim()}${disc ? ` · ${disc}` : ''}` });
    }
    const san = a.sanId ? byId[a.sanId] : null;
    if (san && nomeDi(san) && !rigaAttivita(san)) {
      out.push({ ...persona(san), d: a.d, sett: null, s: a.s, e: a.e, roomId: a.roomId, room, attivita: `Supporto ${nomeDi(m)}${room ? ` (${room})` : ''}` });
      occupa(san.id, a.d, a.s, a.e);
    }
  }
  // Punto prelievi: fasce prelievi degli ambulatori coperte dai sanitari della sede liberi in quella fascia
  const sanitari = (str.personale || []).filter((p) => p.tipo === 'sanitario' && nomeDi(p) && !rigaAttivita(p));
  for (const x of plan.prelievi || []) {
    let resto = [[x.s, x.e]];
    for (const p of sanitari) {
      if (!resto.length) break;
      const libere = subtractM(sanRanges(p, x.d, plan.open?.[x.d] || null), busy[`${p.id}|${x.d}`] || []);
      const date = mergeM(resto.flatMap((seg) => intersectM(libere, seg))).filter(([s, e]) => e - s >= 30);
      for (const [s, e] of date) {
        out.push({ ...persona(p), d: x.d, sett: null, s, e, roomId: x.roomId, room: byId[x.roomId]?.nome || '', attivita: `Punto prelievi${byId[x.roomId]?.nome ? ` (${byId[x.roomId].nome})` : ''}` });
        occupa(p.id, x.d, s, e);
      }
      resto = subtractM(resto, date);
    }
  }
  // Accettazione: turni del desk (una settimana, o A e B con la turnazione)
  const settimane = plan.deskWeeks || [];
  settimane.forEach((wk, w) => {
    for (const sh of wk.deskShifts || []) {
      const p = byId[sh.personId];
      if (!p || !nomeDi(p) || rigaAttivita(p)) continue;
      out.push({ ...persona(p), d: sh.d, sett: settimane.length > 1 ? w : null, s: sh.s, e: sh.e, roomId: null, room: 'Accettazione', attivita: `Accettazione (desk${settimane.length > 1 ? `, ${wk.label}` : ''})` });
    }
  });
  return out.sort((a, b) => a.d - b.d || a.s - b.s || a.nome.localeCompare(b.nome, 'it'));
}

/** Impegni di una data reale (giorno della settimana e, con la turnazione, settimana A o B). */
export function impegniDelGiorno(str, plan, iso, settimana = null) {
  const d = dowIso(iso);
  const w = settimanaTurnazione(iso);
  return (settimana || impegniSettimana(str, plan)).filter((x) => x.d === d && (x.sett == null || x.sett === w));
}

/** Persone del personale di sede (non attività) con il gruppo: medico, sanitario, accettazione. */
export const personeDiSede = (str) => (str.personale || []).filter((p) => nomeDi(p) && !rigaAttivita(p) && GRUPPI[p.tipo]).map(persona);
