// Benefit "vettura aziendale" e "fuel card" della persona (v0.72.0, richiesta del CEO del 13/11/2026). Tabelle contracts.benefit_vetture e
// contracts.benefit_fuel_card (migrazione 021). Le scrive P&C (profili ADMIN e HR del modulo) o il titolare dalla scheda della persona;
// le legge il modulo Rimborso Spese con `assegnazioniPersona` (API interna: nessuna copia dei dati nel modulo rimborsi).
// Regole: il numero della carta si salva per intero e si mostra mascherato salvo a P&C, titolare e assegnatario; il PIN non si salva mai
// (nessuna colonna, e un campo "pin" nella richiesta viene rifiutato). Le assegnazioni aggiungono la voce corrispondente al jsonb
// employments.benefits ("Vettura aziendale", "Fuel card") e la tolgono quando non ne resta nessuna.
import { one, many, q } from '../db.js';

export const VOCE_VETTURA = 'Vettura aziendale';
export const VOCE_FUEL = 'Fuel card';
const RE_VETTURA = /\b(vettura|auto(vettura|mobile)?)\s+aziendal/i;
const RE_FUEL = /\bfuel\s*card\b|\bcarta\s+carburante\b/i;

/** Numero della carta senza spazi né trattini */
export const numeroPulito = (n) => String(n || '').replace(/[\s-]+/g, '');
/** Numero mascherato: solo le ultime 4 cifre in chiaro, a gruppi di 4 (es. "•••• •••• •••• 3333") */
export function mascheraNumero(n) {
  const s = numeroPulito(n);
  if (!s) return '';
  const fine = s.slice(-4);
  const nasc = Math.max(0, s.length - 4);
  const pallini = '•'.repeat(nasc).replace(/(.{4})/g, '$1 ').trim();
  return `${pallini}${pallini ? ' ' : ''}${fine}`;
}
/** Numero leggibile a gruppi di 4 */
export const numeroLeggibile = (n) => numeroPulito(n).replace(/(.{4})/g, '$1 ').trim();
/** L'assegnazione è attiva alla data (dal ≤ data ≤ al, al vuoto = in corso)? Date ISO AAAA-MM-GG. */
export const attivaIl = (a, data) => Boolean(a) && String(a.dal).slice(0, 10) <= data && (!a.al || String(a.al).slice(0, 10) >= data);

/**
 * Voci dei benefit del contratto dopo una modifica delle assegnazioni (funzione pura): aggiunge "Vettura aziendale" / "Fuel card" se la
 * persona ne ha almeno una in corso e la voce (o una equivalente scritta a mano, es. "Auto aziendale ad uso promiscuo") manca; toglie solo
 * la voce esatta aggiunta dalla Suite quando non ne resta nessuna. Le altre voci restano com'erano.
 */
export function vociBenefit(benefits, { vettura, fuel }) {
  let out = Array.isArray(benefits) ? benefits.map(String) : [];
  const regola = (attiva, voce, re) => {
    const presente = out.some((b) => re.test(b));
    if (attiva && !presente) out = [...out, voce];
    if (!attiva) out = out.filter((b) => b !== voce);
  };
  regola(vettura, VOCE_VETTURA, RE_VETTURA);
  regola(fuel, VOCE_FUEL, RE_FUEL);
  return out;
}

const disponibile = async () => Boolean((await one(`SELECT to_regclass('contracts.benefit_vetture') IS NOT NULL AS ok`))?.ok);

/** Vetture e fuel card di una persona (tutte, anche passate), con il numero per intero: la maschera la decide chi legge */
export async function assegnazioniPersona(personId) {
  if (!(await disponibile())) return { disponibile: false, vetture: [], fuel_card: [] };
  const vetture = await many(`SELECT id, person_id, marca, modello, targa, alimentazione, dal, al, uso_promiscuo, note, updated_at FROM contracts.benefit_vetture WHERE person_id=$1 ORDER BY dal DESC, id DESC`, [personId]);
  const fuel = await many(`SELECT f.id, f.person_id, f.circuito, f.numero, f.dal, f.al, f.vettura_id, f.note, f.updated_at, v.targa AS vettura_targa, v.marca AS vettura_marca, v.modello AS vettura_modello
      FROM contracts.benefit_fuel_card f LEFT JOIN contracts.benefit_vetture v ON v.id = f.vettura_id WHERE f.person_id=$1 ORDER BY f.dal DESC, f.id DESC`, [personId]);
  return { disponibile: true, vetture, fuel_card: fuel };
}

/** Persone con una vettura o una fuel card in corso alla data (per gli elenchi di P&C) */
export async function personeConBenefit(data) {
  if (!(await disponibile())) return new Map();
  const rows = await many(`SELECT person_id, 'V' AS t FROM contracts.benefit_vetture WHERE dal <= $1::date AND (al IS NULL OR al >= $1::date)
      UNION ALL SELECT person_id, 'F' FROM contracts.benefit_fuel_card WHERE dal <= $1::date AND (al IS NULL OR al >= $1::date)`, [data]);
  const out = new Map();
  for (const r of rows) { const x = out.get(r.person_id) || { vettura: false, fuel: false }; if (r.t === 'V') x.vettura = true; else x.fuel = true; out.set(r.person_id, x); }
  return out;
}

/** Riallinea employments.benefits della persona alle assegnazioni in corso oggi (se la persona ha un rapporto di lavoro) */
export async function allineaBenefit(personId, oggi, runner = q) {
  const e = (await runner('SELECT resource_id, benefits FROM employments WHERE resource_id=$1', [personId])).rows[0];
  if (!e) return null;
  const a = await assegnazioniPersona(personId);
  const nuove = vociBenefit(e.benefits, { vettura: a.vetture.some((v) => attivaIl(v, oggi)), fuel: a.fuel_card.some((f) => attivaIl(f, oggi)) });
  if (JSON.stringify(nuove) !== JSON.stringify(e.benefits || [])) await runner('UPDATE employments SET benefits=$2, updated_at=now() WHERE resource_id=$1', [personId, JSON.stringify(nuove)]);
  return nuove;
}
