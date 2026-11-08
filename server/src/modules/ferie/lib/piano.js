// Dati del piano ferie per area: persone del gruppo, assenze nel periodo, chiusure collettive, festivi, giorni sotto la copertura
// minima. Usati dalla vista a calendario, dalla valutazione delle richieste e dalle esportazioni XLSX e PDF.
import { many } from '../db.js';
import { calendarioPersona, settings } from './core.js';
import { settimanaDaContratto, giorniTra } from './calendario.js';
import { regoleDelGruppo, scoperture, valutaRichiesta } from './copertura.js';
import { siteDiGruppo, nomeGruppo } from './perimetro.js';

export async function ruoliNomi() {
  return new Map((await many('SELECT id, name FROM public.job_roles')).map((r) => [r.id, r.name]));
}
export async function regoleCopertura() {
  return many('SELECT c.*, jr.name AS role_name FROM coperture c LEFT JOIN public.job_roles jr ON jr.id = c.role_id ORDER BY c.ambito, jr.name NULLS FIRST');
}

/** Membri di un gruppo con settimana lavorativa (per la copertura) */
export function membriGruppo(perim, gruppo) {
  return [...perim.persone.values()].filter((p) => p.gruppo === gruppo).map((p) => ({ id: p.id, nome: p.nome, ruoli: p.ruoli, role_name: p.role_name, settimana: settimanaDaContratto(p.contratto && (p.contratto.weekly_days || p.contratto.days_label) ? p.contratto : null).giorni }));
}

/** Chiusure collettive che riguardano un gruppo (le sue + quelle di TUTTE) nel periodo */
export async function chiusureGruppo(gruppo, da, a) {
  return many(`SELECT id, gruppo, data_inizio, data_fine, descrizione FROM chiusure WHERE (gruppo = $1 OR gruppo = 'TUTTE') AND data_fine >= $2 AND data_inizio <= $3 ORDER BY data_inizio`, [gruppo, da, a]);
}

/**
 * Piano di un gruppo tra due date. stati: quali periodi mostrare (predefinito: periodi del piano, variazioni in attesa, approvati, goduti).
 * Ritorna { gruppo, nome, persone, assenze, chiusure, festivi, scoperture, regole }.
 */
export async function pianoGruppo(perim, gruppo, da, a, { stati = ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'GODUTA'], s } = {}) {
  const st = s || (await settings());
  const membri = membriGruppo(perim, gruppo);
  const ids = membri.map((m) => m.id);
  const assenze = ids.length ? await many(`SELECT id, piano_id, person_id, tipo, stato, variazione, variazione_proposta, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, ore, note FROM richieste
      WHERE person_id = ANY($1::int[]) AND stato = ANY($2::text[]) AND data_fine >= $3 AND data_inizio <= $4 ORDER BY data_inizio`, [ids, stati, da, a]) : [];
  const chiusure = await chiusureGruppo(gruppo, da, a);
  const sid = siteDiGruppo(gruppo);
  const site = sid ? perim.siti.get(sid) : null;
  // festivi del gruppo: calendario di un membro qualunque (stessa sede, stesso patrono); senza membri, i soli nazionali
  const anni = [...new Set([Number(da.slice(0, 4)), Number(a.slice(0, 4))])];
  const rif = [...perim.persone.values()].find((p) => p.gruppo === gruppo) || { site_id: sid, gruppo };
  const cal = await calendarioPersona(rif, anni, st);
  const regole = regoleDelGruppo(await regoleCopertura(), gruppo, site?.kind || null);
  const rn = await ruoliNomi();
  // scoperture con i periodi del piano (anche quelli non ancora approvati: il piano si costruisce guardando la copertura);
  // le variazioni in attesa si valutano una per una
  const decise = assenze.filter((x) => ['PIANIFICATA', 'APPROVATA', 'GODUTA'].includes(x.stato) && x.tipo === 'FERIE');
  const sc = regole.length ? scoperture({ date: giorniTra(da, a), regole, membri, assenze: decise, festivi: cal.festivi, ruoliNomi: rn }) : [];
  return {
    gruppo, nome: nomeGruppo(gruppo, perim.siti), site_kind: site?.kind || null,
    persone: membri.map((m) => ({ id: m.id, nome: m.nome, ruolo: m.role_name, settimana: m.settimana })),
    assenze, chiusure, festivi: [...cal.festivi.entries()].filter(([d]) => d >= da && d <= a).map(([data, nome]) => ({ data, nome })),
    regole: regole.map((r) => ({ id: r.id, ambito: r.ambito, ruolo: r.role_name || 'qualunque ruolo', minimo: r.minimo })), scoperture: sc,
  };
}

/** Valutazione della copertura per una richiesta (avviso all'approvatore). Ritorna l'elenco dei giorni sotto il minimo. */
export async function coperturaRichiesta(perim, richiesta, persona, dettaglioGiorni, s) {
  const st = s || (await settings());
  const gruppo = persona.gruppo;
  if (!gruppo || gruppo === 'DA_ASSEGNARE' || richiesta.tipo === 'ROL') return [];
  const sid = siteDiGruppo(gruppo);
  const site = sid ? perim.siti.get(sid) : null;
  const regole = regoleDelGruppo(await regoleCopertura(), gruppo, site?.kind || null);
  if (!regole.length) return [];
  const membri = membriGruppo(perim, gruppo);
  const giorni = dettaglioGiorni.filter((d) => d.quota > 0).map((d) => d.data);
  if (!giorni.length) return [];
  const da = giorni[0], a = giorni[giorni.length - 1];
  const assenze = await many(`SELECT id, person_id, data_inizio, data_fine, mezza_inizio, mezza_fine FROM richieste WHERE person_id = ANY($1::int[]) AND tipo='FERIE'
      AND stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA') AND data_fine >= $2 AND data_inizio <= $3`, [membri.map((m) => m.id), da, a]);
  const cal = await calendarioPersona(persona, [...new Set([Number(da.slice(0, 4)), Number(a.slice(0, 4))])], st);
  return valutaRichiesta({ richiesta, persona, giorni, regole, membri, assenze, festivi: cal.festivi, ruoliNomi: await ruoliNomi() });
}
