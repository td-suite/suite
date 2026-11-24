// Finance Management · quadratura con la banca (v0.95.0, CEO 24/11/2026). I movimenti del conto letti con Enable Banking (lib/banca.js,
// sola lettura) messi a fronte di ciò che la Suite sa: le autorizzazioni al pagamento (ogni uscita dovrebbe avere un'istanza firmata),
// gli incassi dei clienti riconciliati dal Recupero Crediti, e il conto economico del periodo. Cassa e competenza non coincidono per
// natura (crediti, debiti, IVA, tempi di pagamento): la pagina mette i numeri uno accanto all'altro e dichiara la differenza, non la
// forza a zero. Nessuna scrittura: è un prospetto di controllo.
import { many, one } from '../../../db.js';
import { moduleDb } from '../../../lib/modules.js';
import { somiglianzaNome } from '../../crediti/lib/regole.js';
import * as CE from './contoEconomico.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const giorni = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const iban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

/**
 * Abbina le uscite della banca alle istanze di pagamento. Funzione pura.
 * uscite = [{ id, data, importo (positivo), controparte, controparte_iban, causale }]; istanze = [{ id, status, amount, beneficiary_iban,
 * beneficiary_name, executed_at, signed_at, cro_trn }]. Un'uscita, un'istanza. Criteri, in ordine di forza: importo uguale al centesimo E
 * (IBAN del beneficiario uguale, oppure CRO/TRN dell'istanza nella causale, oppure nome del beneficiario molto simile); con il solo
 * importo l'abbinamento vale soltanto se nella finestra di date c'è un unico candidato. Date: istanza eseguita, entro 5 giorni dalla data
 * di esecuzione; istanza firmata e non ancora registrata come eseguita, dal giorno della firma ai 30 successivi.
 */
export function abbinaUscite(uscite, istanze) {
  const coppie = [];
  for (const i of istanze) {
    const amm = r2(i.amount);
    for (const u of uscite) {
      if (r2(u.importo) !== amm) continue;
      if (i.status === 'ESEGUITA') { if (!i.executed_at || Math.abs(giorni(i.executed_at, u.data)) > 5) continue; }
      else { const dal = i.signed_at || i.request_date; if (!dal) continue; const g = giorni(String(dal).slice(0, 10), u.data); if (g < 0 || g > 30) continue; }
      let p = 0, per = null;
      if (iban(i.beneficiary_iban) && iban(i.beneficiary_iban) === iban(u.controparte_iban)) { p = 100; per = 'importo e IBAN del beneficiario'; }
      else if (i.cro_trn && String(i.cro_trn).trim().length >= 6 && String(u.causale || '').toUpperCase().includes(String(i.cro_trn).trim().toUpperCase())) { p = 95; per = 'importo e CRO/TRN'; }
      else if (somiglianzaNome(i.beneficiary_name, u.controparte) >= 0.75) { p = 75; per = 'importo e nome del beneficiario'; }
      else { p = 40; per = 'solo importo e data'; }
      coppie.push({ istanza: i.id, uscita: u.id, p, per, distanza: Math.abs(giorni(String(i.executed_at || i.signed_at || i.request_date).slice(0, 10), u.data)) });
    }
  }
  // i candidati "solo importo" valgono soltanto se unici, per l'istanza e per l'uscita
  const nI = new Map(), nU = new Map();
  for (const c of coppie) { nI.set(c.istanza, (nI.get(c.istanza) || 0) + 1); nU.set(c.uscita, (nU.get(c.uscita) || 0) + 1); }
  const valide = coppie.filter((c) => c.p > 40 || (nI.get(c.istanza) === 1 && nU.get(c.uscita) === 1)).sort((a, b) => b.p - a.p || a.distanza - b.distanza);
  const usI = new Set(), usU = new Set(), out = [];
  for (const c of valide) { if (usI.has(c.istanza) || usU.has(c.uscita)) continue; usI.add(c.istanza); usU.add(c.uscita); out.push(c); }
  return out;
}

export async function quadratura(p, { contoEconomico = null } = {}) {
  const fin = moduleDb('finance');
  const conti = await many(`SELECT a.id, a.iban, a.name, a.saldo, a.saldo_at, a.last_sync_ok_at, c.aspsp_name, c.status, (SELECT min(t.booking_date)::text FROM bank_transactions t WHERE t.iban = a.iban) AS primo
      FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id WHERE a.attivo ORDER BY c.aspsp_name, a.iban`);
  const mov = await many(`SELECT t.id, t.iban, t.booking_date::text AS data, t.importo, t.controparte, t.controparte_iban, t.causale FROM bank_transactions t
      WHERE t.stato = 'BOOK' AND t.booking_date BETWEEN $1::date - 10 AND $2::date + 35 ORDER BY t.booking_date, t.id`, [p.da, p.a]);
  const nelPeriodo = (m) => m.data >= p.da && m.data <= p.a;
  const entrate = mov.filter((m) => Number(m.importo) > 0 && nelPeriodo(m)), uscitePeriodo = mov.filter((m) => Number(m.importo) < 0 && nelPeriodo(m));
  const uscite = mov.filter((m) => Number(m.importo) < 0).map((m) => ({ ...m, importo: -Number(m.importo) }));
  const istanze = await fin.many(`SELECT r.id, r.protocol, r.status, r.amount, r.beneficiary_name, r.beneficiary_iban, r.purpose, r.executed_at::text AS executed_at, r.signed_at, r.request_date::text AS request_date, r.cro_trn, r.payment_method
      FROM payment_requests r WHERE (r.status = 'ESEGUITA' AND r.executed_at BETWEEN $1::date - 10 AND $2::date + 10) OR r.status = 'FIRMATA'`, [p.da, p.a]).catch(() => []);
  const coppie = abbinaUscite(uscite, istanze.map((i) => ({ ...i, signed_at: i.signed_at ? new Date(i.signed_at).toISOString().slice(0, 10) : null })));
  const perUscita = new Map(coppie.map((c) => [String(c.uscita), c])), perIstanza = new Map(coppie.map((c) => [c.istanza, c]));
  const ist = new Map(istanze.map((i) => [i.id, i]));
  const conIstanza = uscitePeriodo.filter((m) => perUscita.has(String(m.id)));
  const senzaIstanza = uscitePeriodo.filter((m) => !perUscita.has(String(m.id)));
  const somma = (xs) => r2(xs.reduce((s, m) => s + Math.abs(Number(m.importo)), 0));
  // entrate: quanto ne ha riconosciuto il Recupero Crediti (se il modulo è attivo)
  let crediti = null;
  try {
    const righe = await many(`SELECT coalesce(m.stato, 'NON_ESAMINATO') AS stato, count(*)::int AS n, coalesce(sum(t.importo), 0) AS importo FROM bank_transactions t LEFT JOIN crediti.movimenti m ON m.bank_transaction_id = t.id
        WHERE t.stato = 'BOOK' AND t.importo > 0 AND t.booking_date BETWEEN $1 AND $2 GROUP BY 1`, [p.da, p.a]);
    crediti = Object.fromEntries(righe.map((x) => [x.stato, { n: x.n, importo: r2(x.importo) }]));
  } catch { crediti = null; }
  let conto = null;
  if (contoEconomico) { try { const d = await contoEconomico(p); conto = { ricavi: d.totale.ricavi, costi_diretti: d.totale.costi_diretti, costi_centrali: d.totale.costi_centrali, margine: d.totale.margine, margine_prima_dei_centrali: d.totale.margine_prima_dei_centrali }; } catch (e) { conto = { errore: e.message }; } }
  const totEntrate = somma(entrate), totUscite = somma(uscitePeriodo);
  const primo = conti.map((c) => c.primo).filter(Boolean).sort()[0] || null;
  return {
    periodo: p, conti: conti.map((c) => ({ ...c, saldo: c.saldo == null ? null : r2(c.saldo) })),
    copertura: { collegata: conti.length > 0, primo_movimento: primo, completa: Boolean(primo && primo <= p.da), avviso: !conti.length ? 'Nessun conto bancario collegato' : !primo ? 'Nessun movimento ancora letto' : primo > p.da ? `I movimenti disponibili partono dal ${primo.split('-').reverse().join('/')}: il periodo è coperto solo in parte` : null },
    banca: { entrate: totEntrate, n_entrate: entrate.length, uscite: totUscite, n_uscite: uscitePeriodo.length, saldo_periodo: r2(totEntrate - totUscite) },
    uscite: {
      con_istanza: { n: conIstanza.length, importo: somma(conIstanza) }, senza_istanza: { n: senzaIstanza.length, importo: somma(senzaIstanza) },
      abbinate: conIstanza.map((m) => { const c = perUscita.get(String(m.id)); const i = ist.get(c.istanza); return { id: m.id, data: m.data, importo: -Number(m.importo), controparte: m.controparte, istanza_id: i.id, protocollo: i.protocol, stato: i.status, per: c.per, debole: c.p <= 40 }; }),
      elenco_senza: senzaIstanza.slice(0, 400).map((m) => ({ id: m.id, data: m.data, importo: -Number(m.importo), controparte: m.controparte, causale: m.causale })),
    },
    istanze: {
      eseguite_senza_movimento: istanze.filter((i) => i.status === 'ESEGUITA' && i.executed_at >= p.da && i.executed_at <= p.a && !perIstanza.has(i.id)).map((i) => ({ id: i.id, protocollo: i.protocol, beneficiario: i.beneficiary_name, importo: r2(i.amount), eseguita: i.executed_at, metodo: i.payment_method })),
      firmate_con_movimento: istanze.filter((i) => i.status === 'FIRMATA' && perIstanza.has(i.id)).map((i) => { const c = perIstanza.get(i.id); const u = uscite.find((x) => String(x.id) === String(c.uscita)); return { id: i.id, protocollo: i.protocol, beneficiario: i.beneficiary_name, importo: r2(i.amount), movimento_del: u?.data, per: c.per, debole: c.p <= 40 }; }),
    },
    entrate: { totale: totEntrate, crediti },
    conto_economico: conto,
    lettura: conto && !conto.errore ? { ricavi_meno_entrate: r2(conto.ricavi - totEntrate), costi_meno_uscite: r2((conto.costi_diretti + (conto.costi_centrali || 0)) - totUscite) } : null,
  };
}
export { CE, one };
