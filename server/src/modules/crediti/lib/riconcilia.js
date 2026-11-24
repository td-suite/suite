// Recupero Crediti · riconciliazione dei bonifici in entrata (movimenti letti dalla banca con Enable Banking, lib/banca.js) con le
// fatture aperte. Regola (lib/regole.js proponiAbbinamento): si conferma da sola SOLO la corrispondenza certa, cioè numero di fattura
// in causale e importo uguale al residuo; tutto il resto è una proposta che una persona conferma, corregge o rifiuta. Un bonifico
// riconosciuto ma non ancora confermato ferma i solleciti automatici a quel cliente (lib/motore.js).
import { one, many, q, tx } from '../db.js';
import { proponiAbbinamento } from './regole.js';
import { registraIncasso, ricalcola, fattureAperte, r2 } from './fatture.js';
import { evento, oggiRoma } from './impostazioni.js';
import { eur } from './testi.js';

const bad = (m) => Object.assign(new Error(m), { status: 400 });

async function contesto(oggi) {
  const fatture = (await fattureAperte({ oggi })).filter((f) => f.organization_id && f.residuo > 0);
  const ibanNoti = new Map((await many('SELECT iban, organization_id FROM clienti_iban')).map((r) => [r.iban, r.organization_id]));
  return { fatture, ibanNoti };
}

/** Esamina i bonifici in entrata non ancora esaminati (e riprova quelli rimasti senza abbinamento negli ultimi 45 giorni). */
export async function esaminaMovimenti(imp, { oggi = oggiRoma() } = {}) {
  const out = { esaminati: 0, automatici: 0, proposti: 0, da_abbinare: 0 };
  const mov = await many(`SELECT t.id, t.importo, t.booking_date::text AS data, t.controparte, t.controparte_iban, t.causale, m.stato AS gia
      FROM public.bank_transactions t LEFT JOIN movimenti m ON m.bank_transaction_id = t.id
     WHERE t.importo > 0 AND t.stato = 'BOOK' AND t.booking_date >= $1::date
       AND (m.bank_transaction_id IS NULL OR (m.stato = 'DA_ABBINARE' AND m.user_id IS NULL AND t.booking_date > $2::date - 45))
     ORDER BY t.booking_date, t.id LIMIT 1000`, [imp.fatture_dal, oggi]);
  if (!mov.length) return out;
  let ctx = await contesto(oggi);
  for (const m of mov) {
    out.esaminati++;
    const p = proponiAbbinamento({ importo: Number(m.importo), controparte: m.controparte, controparte_iban: m.controparte_iban, causale: m.causale }, ctx.fatture, { ibanNoti: ctx.ibanNoti });
    if (p.esito === 'AUTO' && imp.riconciliazione_automatica) {
      try {
        await applica(m.id, p.righe, { userId: null, automatico: true, punteggio: p.punteggio, motivo: p.motivo, per: p.per });
        out.automatici++; ctx = await contesto(oggi);
        continue;
      } catch (e) { p.esito = 'PROPOSTO'; p.motivo = `${p.motivo} (conferma automatica non riuscita: ${e.message})`; }
    }
    const stato = p.esito === 'NESSUNO' ? 'DA_ABBINARE' : 'PROPOSTO';
    await tx(async (c) => {
      await c.query(`DELETE FROM incassi WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [m.id]);
      await c.query(`INSERT INTO movimenti (bank_transaction_id, stato, organization_id, riconosciuto_per, residuo, nota) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (bank_transaction_id) DO UPDATE SET stato = EXCLUDED.stato, organization_id = EXCLUDED.organization_id, riconosciuto_per = EXCLUDED.riconosciuto_per, residuo = EXCLUDED.residuo, nota = EXCLUDED.nota, updated_at = now()`,
        [m.id, stato, p.organization_id, p.per, p.residuo, p.motivo]);
      if (stato === 'PROPOSTO') for (const r of p.righe) await c.query(`INSERT INTO incassi (fattura_id, importo, data, origine, bank_transaction_id, stato, automatico, punteggio, motivo) VALUES ($1,$2,$3,'BANCA',$4,'PROPOSTO',TRUE,$5,$6)`, [r.fattura_id, r.importo, m.data, m.id, p.punteggio, p.motivo]);
    });
    if (stato === 'PROPOSTO') out.proposti++; else if (m.gia !== 'DA_ABBINARE') out.da_abbinare++;
  }
  return out;
}

/** Attribuisce un bonifico alle fatture (righe: [{ fattura_id, importo }]) e lo chiude come abbinato. Un bonifico, un solo cliente. */
export async function applica(movId, righe, { userId = null, automatico = false, punteggio = null, motivo = null, per = null } = {}) {
  return tx(async (c) => {
    const t = (await c.query(`SELECT id, importo, booking_date::text AS data, controparte, controparte_iban, stato FROM public.bank_transactions WHERE id = $1 FOR UPDATE`, [movId])).rows[0];
    if (!t || !(Number(t.importo) > 0)) throw bad('Movimento non trovato o non in entrata');
    if (t.stato !== 'BOOK') throw bad('Il movimento non è ancora contabilizzato dalla banca');
    const m = (await c.query('SELECT * FROM movimenti WHERE bank_transaction_id = $1 FOR UPDATE', [movId])).rows[0];
    if (m?.stato === 'ABBINATO') throw bad('Movimento già abbinato: annulla prima l\'abbinamento esistente');
    const pulite = (righe || []).map((r) => ({ fattura_id: Number(r.fattura_id), importo: r2(r.importo) })).filter((r) => r.fattura_id && r.importo > 0);
    if (!pulite.length) throw bad('Indica almeno una fattura e un importo');
    if (new Set(pulite.map((r) => r.fattura_id)).size !== pulite.length) throw bad('La stessa fattura è indicata più volte');
    const somma = r2(pulite.reduce((s, r) => s + r.importo, 0));
    if (somma > r2(t.importo) + 0.005) throw bad(`Il totale attribuito (${somma.toFixed(2)}) supera l'importo del bonifico (${Number(t.importo).toFixed(2)})`);
    const ff = (await c.query('SELECT id, organization_id, numero FROM fatture WHERE id = ANY($1::int[])', [pulite.map((r) => r.fattura_id)])).rows;
    const org = new Set(ff.map((f) => f.organization_id));
    if (ff.length !== pulite.length || org.size !== 1 || !ff[0].organization_id) throw bad('Le fatture devono essere dello stesso cliente (abbinato a una Legal entity)');
    await c.query(`DELETE FROM incassi WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [movId]);
    for (const r of pulite) await registraIncasso(r.fattura_id, { importo: r.importo, data: t.data, origine: 'BANCA', bankTransactionId: movId, automatico, punteggio, motivo, userId }, c);
    const orgId = ff[0].organization_id, residuo = r2(Number(t.importo) - somma);
    await c.query(`INSERT INTO movimenti (bank_transaction_id, stato, organization_id, riconosciuto_per, residuo, nota, user_id) VALUES ($1,'ABBINATO',$2,$3,$4,$5,$6)
       ON CONFLICT (bank_transaction_id) DO UPDATE SET stato = 'ABBINATO', organization_id = EXCLUDED.organization_id, riconosciuto_per = coalesce(EXCLUDED.riconosciuto_per, movimenti.riconosciuto_per), residuo = EXCLUDED.residuo, nota = EXCLUDED.nota, user_id = EXCLUDED.user_id, updated_at = now()`,
      [movId, orgId, per, residuo, motivo || (automatico ? null : 'Abbinato a mano'), userId]);
    if (t.controparte_iban) await c.query('INSERT INTO clienti_iban (iban, organization_id) VALUES ($1,$2) ON CONFLICT (iban) DO NOTHING', [t.controparte_iban, orgId]);
    await evento(orgId, 'INCASSO', `Incasso di € ${eur(somma)} del ${t.data.split('-').reverse().join('/')} ${automatico ? 'riconosciuto in automatico' : 'abbinato'} su ${ff.length === 1 ? `fattura n. ${ff[0].numero}` : `${ff.length} fatture (${ff.map((f) => f.numero).join(', ')})`}${residuo > 0 ? `; restano € ${eur(residuo)} non attribuiti` : ''}`, { userId, dati: { bank_transaction_id: movId } }, c);
    return { organization_id: orgId, attribuito: somma, residuo };
  });
}
/** Rifiuta la proposta: il bonifico torna da abbinare e non viene più riproposto in automatico. */
export async function rifiuta(movId, userId) {
  await tx(async (c) => {
    await c.query(`DELETE FROM incassi WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [movId]);
    const r = await c.query(`UPDATE movimenti SET stato = 'DA_ABBINARE', user_id = $2, nota = 'Proposta rifiutata', updated_at = now() WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [movId, userId]);
    if (!r.rowCount) throw bad('Nessuna proposta da rifiutare su questo movimento');
  });
}
/** Il bonifico non riguarda una fattura cliente (giroconto, incasso POS, rimborso...): esce dall'elenco. */
export async function ignora(movId, nota, userId) {
  if (!String(nota || '').trim()) throw bad('Scrivi perché il movimento non riguarda una fattura');
  await tx(async (c) => {
    const m = (await c.query('SELECT stato FROM movimenti WHERE bank_transaction_id = $1 FOR UPDATE', [movId])).rows[0];
    if (m?.stato === 'ABBINATO') throw bad('Movimento già abbinato');
    await c.query(`DELETE FROM incassi WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [movId]);
    await c.query(`INSERT INTO movimenti (bank_transaction_id, stato, nota, user_id) VALUES ($1,'IGNORATO',$2,$3)
       ON CONFLICT (bank_transaction_id) DO UPDATE SET stato = 'IGNORATO', nota = EXCLUDED.nota, user_id = EXCLUDED.user_id, organization_id = NULL, updated_at = now()`, [movId, String(nota).trim().slice(0, 500), userId]);
  });
}
/** Annulla un abbinamento confermato (errore): gli incassi di quel bonifico si tolgono e le fatture tornano aperte. */
export async function annulla(movId, userId) {
  return tx(async (c) => {
    const m = (await c.query('SELECT * FROM movimenti WHERE bank_transaction_id = $1 FOR UPDATE', [movId])).rows[0];
    if (!m || !['ABBINATO', 'IGNORATO'].includes(m.stato)) throw bad('Nulla da annullare su questo movimento');
    const inc = (await c.query(`DELETE FROM incassi WHERE bank_transaction_id = $1 RETURNING fattura_id, importo`, [movId])).rows;
    for (const i of inc) await ricalcola(i.fattura_id, c);
    await c.query(`UPDATE movimenti SET stato = 'DA_ABBINARE', user_id = $2, nota = 'Abbinamento annullato', residuo = NULL, updated_at = now() WHERE bank_transaction_id = $1`, [movId, userId]);
    if (m.organization_id && inc.length) await evento(m.organization_id, 'INCASSO_ANNULLATO', `Abbinamento di un bonifico annullato: € ${eur(inc.reduce((s, i) => s + Number(i.importo), 0))} tornano da incassare`, { userId, dati: { bank_transaction_id: movId } }, c);
    return { fatture: inc.length };
  });
}

/** Elenco per la pagina Riconciliazione. stato: PROPOSTO | DA_ABBINARE | ABBINATO | IGNORATO. */
export async function elencoMovimenti({ stato = 'PROPOSTO', limite = 200 } = {}) {
  const righe = await many(`SELECT t.id, t.booking_date::text AS data, t.importo, t.controparte, t.controparte_iban, t.causale, t.iban AS conto, m.stato, m.organization_id, o.name AS cliente, m.riconosciuto_per, m.residuo, m.nota, m.updated_at, u.full_name AS utente
      FROM movimenti m JOIN public.bank_transactions t ON t.id = m.bank_transaction_id LEFT JOIN public.organizations o ON o.id = m.organization_id LEFT JOIN public.users u ON u.id = m.user_id
     WHERE m.stato = $1 ORDER BY t.booking_date DESC, t.id DESC LIMIT $2`, [stato, Math.min(500, Number(limite) || 200)]);
  const inc = righe.length ? await many(`SELECT i.bank_transaction_id, i.fattura_id, i.importo, i.stato, i.punteggio, i.automatico, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, (f.importo - f.incassato) AS residuo, f.importo AS totale
      FROM incassi i JOIN fatture f ON f.id = i.fattura_id WHERE i.bank_transaction_id = ANY($1::bigint[]) ORDER BY f.scadenza`, [righe.map((r) => r.id)]) : [];
  return righe.map((r) => ({ ...r, importo: r2(r.importo), residuo: r.residuo == null ? null : r2(r.residuo), righe: inc.filter((i) => String(i.bank_transaction_id) === String(r.id)).map((i) => ({ fattura_id: i.fattura_id, numero: i.numero, data: i.data, scadenza: i.scadenza, importo: r2(i.importo), residuo_fattura: r2(i.residuo), stato: i.stato, punteggio: i.punteggio, automatico: i.automatico })) }));
}
export async function contaMovimenti() {
  const r = await many(`SELECT stato, count(*)::int AS n FROM movimenti WHERE stato IN ('PROPOSTO','DA_ABBINARE') GROUP BY stato`);
  return { proposti: r.find((x) => x.stato === 'PROPOSTO')?.n || 0, da_abbinare: r.find((x) => x.stato === 'DA_ABBINARE')?.n || 0 };
}
/**
 * Bonifici recenti che potrebbero essere il pagamento di questo cliente e che nessuno ha ancora confermato: quelli riconosciuti come
 * suoi, più quelli senza cliente il cui importo coincide con una delle fatture o con il loro totale. Fermano l'invio automatico.
 */
export async function bonificiDubbi(orgId, residui, giorni, oggi = oggiRoma()) {
  const importi = [...new Set([...residui.map(r2), r2(residui.reduce((s, x) => s + x, 0))])];
  return many(`SELECT t.id, t.booking_date::text AS data, t.importo FROM movimenti m JOIN public.bank_transactions t ON t.id = m.bank_transaction_id
     WHERE m.stato IN ('PROPOSTO','DA_ABBINARE') AND t.booking_date > $2::date - $3::int AND (m.organization_id = $1 OR (m.organization_id IS NULL AND t.importo = ANY($4::numeric[]))) ORDER BY t.booking_date DESC LIMIT 5`, [orgId, oggi, giorni, importi]);
}
