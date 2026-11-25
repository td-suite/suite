// Scadenziario strutture · verifica dei pagamenti sul conto corrente (v0.98.0, CEO 25/11/2026: "effettua la verifica del pagamento
// direttamente controllando il conto"). Per ogni canone e ogni bolletta registrata non ancora segnati si cerca tra le USCITE del conto
// (public.bank_transactions, lette da Enable Banking) un movimento dello STESSO importo al centesimo, contabilizzato tra 15 giorni
// prima e 90 giorni dopo la scadenza, non già usato per un'altra scadenza:
//  - CERTO: il movimento nomina il beneficiario (locatore, fornitore) o il codice dell'utenza (POD, PDR, numero cliente): la scadenza
//    viene segnata pagata da sola, con data, conto e causale del movimento;
//  - PROBABILE: stesso importo, un solo movimento possibile, ma senza il nome: resta una proposta da confermare con un clic.
// Non si abbinano importi stimati, pagamenti parziali o un solo bonifico che paga più scadenze: quelle restano da segnare a mano.
import { one, many, q } from '../db.js';
import { buildEvents, parseDate, toIso } from './schedule.js';
import { loadScheduleData } from './scheduleData.js';

const DAY = 86400000;
export const FINESTRA = { prima: 15, dopo: 90, storico: 150 };
const GENERICHE = new Set(['srl', 'spa', 'sas', 'snc', 'srls', 'soc', 'societa', 'coop', 'italia', 'italiana', 'italiane', 'servizi', 'service', 'group', 'gruppo', 'distribuzione', 'the', 'and', 'del', 'della', 'dei', 'per', 'con']);
const semplice = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Parole che identificano un nome: senza forme societarie e parole generiche; le sigle puntate si uniscono ("E.ON" → "eon"). */
export function paroleNome(nome) {
  const t = semplice(nome).replace(/\b([a-z])\.(?=[a-z])/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
  return [...new Set(t.split(' ').filter((w) => w.length >= 3 && !GENERICHE.has(w)))];
}
const haParola = (testo, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(testo);
/** Il movimento nomina il beneficiario (tutte le parole del nome se sono al più due, altrimenti almeno due) o il codice dell'utenza. */
export function nomina(mov, { nomi = [], codice = null } = {}) {
  const testo = semplice(`${mov.controparte || ''} ${mov.causale || ''}`).replace(/\b([a-z])\.(?=[a-z])/g, '$1').replace(/[^a-z0-9]+/g, ' ');
  const cod = semplice(codice).replace(/[^a-z0-9]/g, '');
  if (cod.length >= 6 && testo.replace(/ /g, '').includes(cod)) return true;
  for (const n of nomi) { const p = paroleNome(n); if (!p.length) continue; const trovate = p.filter((w) => haParola(testo, w)).length; if (trovate >= Math.min(p.length, 2)) return true; }
  return false;
}

/**
 * Abbinamento (funzione pura). scadenze: [{ key, date, amount, nomi, codice }]; movimenti: [{ id, booking_date, importo (negativo =
 * uscita), controparte, causale, iban }]; usati: Set di id già agganciati. Ritorna Map key → { livello: 'CERTO'|'PROBABILE', mov }.
 * Le scadenze più vecchie scelgono per prime; tra più movimenti che nominano il beneficiario vince il più vicino alla scadenza.
 */
export function abbinaPagamenti(scadenze, movimenti, usati = new Set()) {
  const out = new Map(); const presi = new Set(usati);
  const uscite = movimenti.filter((m) => Number(m.importo) < 0 && m.booking_date);
  const giorno = (d) => parseDate(String(d instanceof Date ? d.toISOString() : d).slice(0, 10));
  const candidati = (s) => uscite.filter((m) => !presi.has(m.id) && Math.round(Math.abs(Number(m.importo)) * 100) === Math.round(Number(s.amount) * 100)
    && giorno(m.booking_date) >= giorno(s.date) - FINESTRA.prima * DAY && giorno(m.booking_date) <= giorno(s.date) + FINESTRA.dopo * DAY);
  const ordinate = [...scadenze].filter((s) => Number(s.amount) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const s of ordinate) {   // primo giro: i certi
    const c = candidati(s).filter((m) => nomina(m, s)).sort((a, b) => Math.abs(giorno(a.booking_date) - giorno(s.date)) - Math.abs(giorno(b.booking_date) - giorno(s.date)));
    if (c.length) { out.set(s.key, { livello: 'CERTO', mov: c[0] }); presi.add(c[0].id); }
  }
  const proposti = new Set();
  for (const s of ordinate) {   // secondo giro: i probabili (un solo movimento possibile, non proposto ad altre scadenze)
    if (out.has(s.key)) continue;
    const c = candidati(s).filter((m) => !proposti.has(m.id));
    if (c.length === 1) { out.set(s.key, { livello: 'PROBABILE', mov: c[0] }); proposti.add(c[0].id); }
  }
  return out;
}

const itData = (d) => { const s = String(d instanceof Date ? toIso(d.getTime()) : d).slice(0, 10); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
export const descriviMovimento = (m) => ({ id: Number(m.id), data: String(m.booking_date instanceof Date ? toIso(m.booking_date.getTime()) : m.booking_date).slice(0, 10), importo: Math.abs(Number(m.importo)), controparte: m.controparte || null, causale: m.causale ? String(m.causale).slice(0, 200) : null, iban: m.iban || null });

/**
 * Verifica sul conto le scadenze aperte. Segna pagate quelle CERTE; ritorna { movimenti (letti), segnate: [{ key, mov }], proposte:
 * Map key → movimento } (le PROBABILI, da confermare). Senza movimenti bancari nella Suite non fa nulla. data: loadScheduleData già
 * caricato (facoltativo). Mai eccezioni verso chi chiama l'agenda.
 */
export async function verificaPagamenti({ today, data = null } = {}) {
  const out = { movimenti: 0, segnate: [], proposte: new Map() };
  try {
    if (!(await one(`SELECT 1 AS ok FROM public.bank_transactions WHERE importo < 0 LIMIT 1`))) return out;
    const T = parseDate(today);
    const d = data || await loadScheduleData(null);
    const eventi = buildEvents({ ...d, from: toIso(T - FINESTRA.storico * DAY), to: toIso(T + FINESTRA.prima * DAY), today })
      .filter((e) => !e.done && !e.estimate && e.amount > 0 && (e.kind === 'canone' || (e.kind === 'bolletta' && e.bill_id)));
    if (!eventi.length) return out;
    const lease = new Map(d.leases.map((l) => [l.id, l])); const util = new Map(d.utilities.map((u) => [u.id, u]));
    const scadenze = eventi.map((e) => { const o = e.cat === 'AFFITTO' ? lease.get(e.ref) : util.get(e.ref);
      return { key: e.key, date: e.date, amount: e.amount, site_id: e.site_id, kind: e.kind, ref: e.ref, nomi: [o?.landlord_name, o?.supplier_name, o?.beneficiary_name, o?.landlord_org_name, o?.supplier_org_name].filter(Boolean), codice: e.cat === 'UTENZA' ? o?.code : null }; });
    const movimenti = await many(`SELECT id, iban, booking_date::text AS booking_date, importo, controparte, causale FROM public.bank_transactions
       WHERE importo < 0 AND booking_date >= $1::date AND coalesce(stato, 'BOOK') NOT IN ('RJCT', 'CNCL') ORDER BY booking_date`, [toIso(T - (FINESTRA.storico + FINESTRA.prima) * DAY)]);
    out.movimenti = movimenti.length;
    const usati = new Set((await many('SELECT bank_tx_id FROM schedule_done WHERE bank_tx_id IS NOT NULL')).map((r) => Number(r.bank_tx_id)));
    const per = new Map(scadenze.map((s) => [s.key, s]));
    for (const [key, a] of abbinaPagamenti(scadenze, movimenti.map((m) => ({ ...m, id: Number(m.id) })), usati)) {
      const s = per.get(key); const m = descriviMovimento(a.mov);
      if (a.livello !== 'CERTO') { out.proposte.set(key, m); continue; }
      const nota = `Pagamento trovato sul conto ${m.iban ? `${String(m.iban).slice(0, 4)}…${String(m.iban).slice(-4)}` : ''} il ${itData(m.data)}${m.controparte ? `: ${m.controparte}` : ''}${m.causale ? ` · ${m.causale.slice(0, 120)}` : ''}`.replace('  ', ' ');
      const r = await q(`INSERT INTO schedule_done (event_key, site_id, user_id, note, amount, bank_tx_id, source) VALUES ($1,$2,NULL,$3,$4,$5,'BANCA') ON CONFLICT DO NOTHING`, [key, s.site_id, nota.slice(0, 500), m.importo, m.id]);
      if (!r.rowCount) continue;
      if (s.kind === 'bolletta') await q('UPDATE utility_bills SET paid_at = coalesce(paid_at, $3::date) WHERE utility_id = $1 AND due_date = $2::date', [s.ref, s.date, m.data]);
      out.segnate.push({ key, mov: m });
    }
    if (out.segnate.length) console.log(`[finance] scadenziario: ${out.segnate.length} scadenze verificate sul conto`);
  } catch (e) { console.warn('[finance] verifica dei pagamenti sul conto non riuscita:', e.message); }
  return out;
}
