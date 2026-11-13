// Finance Management · Controllo di gestione: lettura delle fonti dei moduli per il conto economico di sede e il margine per cliente
// Service. Ogni fonte di un altro modulo si legge con la tecnica safe() del Cockpit (server/src/lib/legacy.js): solo se il modulo è LIVE
// nella Suite, con il pool del modulo; un modulo non LIVE o una lettura fallita danno una fonte "non disponibile" con la nota, mai
// uno zero silenzioso. Le regole di calcolo sono pure, in lib/contoEconomico.js.
import { many, one } from '../db.js';
import { getModuleState, moduleDb } from '../../../lib/modules.js';
import { getLaboratorio } from '../../../lib/company.js';
import { getSettings } from './rules.js';
import { contractEnd, parseDate, UTILITY_LABEL } from './schedule.js';
import { todayRome } from './util.js';
import { versioneCorrente } from '../../business/lib/listino.js';
import * as CE from './contoEconomico.js';
import { produzionePerOrg, fatturatoPerOrg } from '../../../lib/synclab/letture.js';
import { giorniLavorativi } from '../../business/lib/proQuota.js';

export const NOMI_MODULI = { retail: 'Retail', cash: 'Cash Management', contracts: 'Contratti del personale', facility: 'Facility e Manutenzioni', business: 'Business Hub', orders: 'Ordini', finance: 'Finance Management', rimborsi: 'Rimborso Spese' };
const num = (v) => (v == null || v === '' ? null : Number(v));
const eurTxt = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });

// ---------------------------------------------------------------- impostazioni
export const IMPOSTAZIONI_CONTROLLO = ['pl_coefficiente_oneri', 'pl_sedi_centrali', 'pl_chiave_ripartizione', 'pl_iva_costi', 'srv_costo_ritiro', 'srv_costo_medio_esame'];
export async function impostazioniControllo() {
  const s = await getSettings();
  const ids = String(s.pl_sedi_centrali || '').split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
  return {
    coefficiente: num(s.pl_coefficiente_oneri) > 0 ? Number(s.pl_coefficiente_oneri) : 1.28,
    sedi_centrali: ids, sedi_centrali_predefinite: !ids.length,
    chiave: s.pl_chiave_ripartizione || 'RICAVI',
    iva_costi: s.pl_iva_costi === 'ESCLUSA' ? 'ESCLUSA' : 'COSTO',
    costo_ritiro: num(s.srv_costo_ritiro), costo_medio_esame: num(s.srv_costo_medio_esame),
  };
}

// ---------------------------------------------------------------- lettura difensiva delle fonti
export async function moduloLive(key) {
  if (key === 'finance') return true;
  const st = await getModuleState(key).catch(() => null);
  return Boolean(st && st.mode === 'LIVE' && st.schema_ready);
}
/** { ok, rows, nota }: righe dallo schema del modulo se LIVE, altrimenti la nota del perché la fonte non c'è. */
export async function leggi(key, sql, params = []) {
  if (!(await moduloLive(key))) return { ok: false, rows: [], nota: `${NOMI_MODULI[key] || key}: modulo non attivo (LIVE) nella Suite` };
  try { return { ok: true, rows: await moduleDb(key).many(sql, params), nota: null }; }
  catch (e) { console.warn(`[finance:controllo] ${key}: ${e.message}`); return { ok: false, rows: [], nota: `${NOMI_MODULI[key] || key}: lettura non riuscita (${e.message})` }; }
}

// ---------------------------------------------------------------- sedi
export async function sediDelConto(p, imp) {
  const all = await many(`SELECT id, code, name, short_name, kind, active, closed_at::text AS closed_at, opened_at::text AS opened_at, tenure, rent_amount, rent_period, rent_vat, rent_vat_rate, lease_start::text AS lease_start, sort_order
      FROM public.sites WHERE kind <> 'SERVICE' AND (active OR closed_at >= $1::date) AND (opened_at IS NULL OR opened_at <= $2::date)
     ORDER BY sort_order NULLS LAST, name`, [p.da, p.a]);
  const centraliIds = imp.sedi_centrali.length ? new Set(imp.sedi_centrali) : new Set(all.filter((s) => s.kind === 'HEADQUARTER').map((s) => s.id));
  const centraliTutte = imp.sedi_centrali.length ? await many('SELECT id, code, name, kind FROM public.sites WHERE id = ANY($1::int[]) ORDER BY name', [imp.sedi_centrali]) : all.filter((s) => centraliIds.has(s.id));
  const lab = await getLaboratorio().catch(() => null);
  return { sedi: all.filter((s) => !centraliIds.has(s.id)), centrali: centraliTutte.map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind })), tutte: all, lab };
}

// ---------------------------------------------------------------- pagamenti Finance (comuni a P&L e Service)
// Istanze autorizzate o eseguite, nel periodo per data di esecuzione (o valuta, o richiesta). Escluse quelle create dallo Scadenziario
// (canoni e bollette sono già nelle righe dedicate) e quelle segnate "fuori dal conto economico".
async function pagamenti(p) {
  const rows = await many(`SELECT r.id, r.protocol, r.beneficiary_name, r.purpose, r.amount, r.status, r.site_id, r.org_id, r.cost_center,
        coalesce(r.executed_at, r.value_date, r.request_date)::text AS data
      FROM payment_requests r
     WHERE r.status IN ('FIRMATA','ESEGUITA') AND NOT r.pl_escluso
       AND NOT EXISTS (SELECT 1 FROM schedule_requests sr WHERE sr.request_id = r.id)
       AND coalesce(r.executed_at, r.value_date, r.request_date) BETWEEN $1::date AND $2::date
     ORDER BY 10, r.id`, [p.da, p.a]);
  const esclusi = await one(`SELECT count(*) FILTER (WHERE r.pl_escluso)::int AS esclusi, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM schedule_requests sr WHERE sr.request_id = r.id))::int AS scadenziario
      FROM payment_requests r WHERE r.status IN ('FIRMATA','ESEGUITA') AND coalesce(r.executed_at, r.value_date, r.request_date) BETWEEN $1::date AND $2::date`, [p.da, p.a]);
  return { rows, esclusi };
}

// ---------------------------------------------------------------- Service: produzione e margine per cliente
/**
 * Margine per cliente Service nei mesi del periodo. Clienti = public.clienti_attivi_v linea SRV. v0.68.4 (CEO 10/11/2026): la stima
 * commerciale e la proiezione FY valgono SOLO per i clienti ATTIVI (livello ATTIVO = accounts.cliente_attivo, la regola unica del
 * Business Hub) e la stima è in pro quota sul periodo (CE.stimaProQuota); i CONTRATTUALIZZATI non avviati restano fuori, salvo che
 * abbiano produzione effettiva nel periodo (Synclab, StudioLAB, manuale), che si mostra sempre.
 * Ritorna { clienti: [{ org_id, org_name, livello, attivo, dal, account_id, mesi: { mk: margine }, totale, proiezione_fy }], proiezione,
 * esclusi_non_attivi, fonti, avvisi, impostazioni }.
 */
export async function caricaService(p, { imp = null, orgId = null } = {}) {
  imp = imp || await impostazioniControllo();
  const fonti = {}; const avvisi = [];
  let clienti = [];
  try {
    clienti = await many(`SELECT v.org_id, o.name AS org_name, v.livello, v.dal::text AS dal, v.account_id FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id
       WHERE v.linea = 'SRV' AND ($1::int IS NULL OR v.org_id = $1) ORDER BY lower(o.name)`, [orgId]);
    fonti.clienti = { disponibile: true, nota: null };
  } catch (e) { fonti.clienti = { disponibile: false, nota: `Clienti attivi (public.clienti_attivi_v) non leggibili: ${e.message}` }; }
  const ids = clienti.map((c) => c.org_id);
  const da = `${p.mesi[0]}-01`, a = p.a;
  const vuoto = { ok: true, rows: [], nota: null };
  const [acc, ctr, gl, retail, ordini] = ids.length ? await Promise.all([
    leggi('business', `SELECT id, organization_id, volumi_giornalieri_attesi, volume_fy_atteso, prezzo_medio_esame, fatturato_fy_atteso, listino_corrente_id,
        data_avvio_prevista::text AS data_avvio_prevista, data_avvio_effettiva::text AS data_avvio_effettiva FROM accounts WHERE linea = 'SRV' AND organization_id = ANY($1::int[])`, [ids]),
    leggi('business', `SELECT id, org_id, status, start_date::text AS start_date, end_date::text AS end_date, data->'pickup'->'days' AS days FROM contracts
        WHERE kind = 'SRV' AND org_id = ANY($1::int[]) AND status IN ('FIRMATO','AUTORIZZATO','ATTIVO') ORDER BY org_id, coalesce(start_date, signed_at, proposal_date) DESC, id DESC`, [ids]),
    leggi('business', `SELECT value FROM app_settings WHERE key = 'hub_giorni_lavorativi'`),
    leggi('retail', `SELECT c.organization_id AS org_id, to_char(s.sale_date, 'YYYY-MM') AS mese, upper(coalesce(nullif(s.product_code, ''), '?')) AS codice, max(s.product_desc) AS descrizione,
          sum(s.quantity)::int AS quantita, sum(s.net_amount) AS valore
        FROM sales s JOIN customers c ON c.id = s.b2b_customer_id
       WHERE c.kind = 'B2B' AND c.organization_id = ANY($1::int[]) AND s.sale_date BETWEEN $2::date AND $3::date AND s.source <> 'DEMO' GROUP BY 1, 2, 3`, [ids, da, a]),
    leggi('orders', `SELECT coalesce(p.org_id, si.organization_id) AS org_id, to_char(p.month, 'YYYY-MM') AS mese, upper(p.exam_code) AS codice, max(p.exam_name) AS descrizione, sum(p.qty)::int AS quantita
        FROM production p LEFT JOIN public.sites si ON si.id = p.site_id AND si.kind = 'SERVICE'
       WHERE coalesce(p.org_id, si.organization_id) = ANY($1::int[]) AND p.month BETWEEN $2::date AND $3::date GROUP BY 1, 2, 3`, [ids, da, a]),
  ]) : [vuoto, vuoto, vuoto, vuoto, vuoto];
  // Synclab Data API (core, schema synclab): produzione EROGATA (v0.68.5, definizione unica) e, a parte, i documenti emessi (secondari)
  let syn = new Map(), fat = new Map();
  try { [syn, fat] = ids.length ? await Promise.all([produzionePerOrg(ids, da, a), fatturatoPerOrg(ids, da, a)]) : [syn, fat]; fonti.synclab = { disponibile: true, nota: syn.size || fat.size ? null : 'Synclab Data API: nessuna accettazione né documento dei clienti nel periodo (o client Synclab non abbinati alle Legal entity)' }; }
  catch (e) { console.warn(`[finance:controllo] synclab: ${e.message}`); fonti.synclab = { disponibile: false, nota: `Synclab Data API: lettura non riuscita (${e.message})` }; }
  fonti.business = { disponibile: acc.ok, nota: acc.ok ? null : `${acc.nota}: niente listini, contratti (ritiri) né stime` };
  fonti.retail = { disponibile: retail.ok, nota: retail.nota };
  fonti.orders = { disponibile: ordini.ok, nota: ordini.nota };
  const giorniAnno = num(gl.rows[0]?.value) > 0 ? Number(gl.rows[0].value) : 250;
  const accById = new Map(acc.rows.map((x) => [x.organization_id, x]));
  const accIds = acc.rows.map((x) => x.id);
  const listiniR = accIds.length ? await leggi('business', 'SELECT id, account_id, versione, righe FROM listini WHERE account_id = ANY($1::int[])', [accIds]) : vuoto;
  const listinoDi = (orgIdX) => {
    const a2 = accById.get(orgIdX); if (!a2) return null;
    const vers = listiniR.rows.filter((l) => l.account_id === a2.id);
    const v = versioneCorrente(vers, a2.listino_corrente_id);
    return v ? { id: v.id, versione: v.versione, righe: Array.isArray(v.righe) ? v.righe : [] } : null;
  };
  const contrattoDi = new Map();
  for (const c of ctr.rows) if (!contrattoDi.has(c.org_id)) contrattoDi.set(c.org_id, c);
  const salvate = ids.length ? await many(`SELECT id, org_id, to_char(mese, 'YYYY-MM') AS mese, esami, valore, fonte, righe, note, updated_at FROM produzione_service
      WHERE org_id = ANY($1::int[]) AND mese BETWEEN $2::date AND $3::date`, [ids, da, a]) : [];
  const costi = new Map((await many('SELECT codice, costo FROM costi_esami')).map((x) => [String(x.codice).toUpperCase(), Number(x.costo)]));
  const pg = await pagamenti(p);
  const pagOrg = new Map();
  for (const r of pg.rows) if (r.org_id) { const k = `${r.org_id}|${r.data.slice(0, 7)}`; if (!pagOrg.has(k)) pagOrg.set(k, []); pagOrg.get(k).push(r); }
  const raggruppa = (rows) => { const m = new Map(); for (const r of rows) { const k = `${r.org_id}|${r.mese}`; if (!m.has(k)) m.set(k, { esami: 0, valore: 0, haValore: false, righe: [] }); const x = m.get(k); x.esami += Number(r.quantita || 0); if (r.valore != null) { x.valore += Number(r.valore); x.haValore = true; } x.righe.push({ codice: r.codice, descrizione: r.descrizione, quantita: Number(r.quantita || 0), valore: r.valore != null ? CE.r2(r.valore) : null }); } for (const x of m.values()) x.valore = x.haValore ? CE.r2(x.valore) : null; return m; };
  const rRetail = raggruppa(retail.rows), rOrdini = raggruppa(ordini.rows);
  const oggi = todayRome();
  const annoFy = p.anno + 1;
  const out = clienti.map((c) => {
    const account = accById.get(c.org_id) || null;
    const listino = listinoDi(c.org_id);
    const contratto = contrattoDi.get(c.org_id) || null;
    const attivo = c.livello === 'ATTIVO';
    const avvio = account?.data_avvio_effettiva || account?.data_avvio_prevista || c.dal || null;
    const mesi = {};
    const meseOggi = oggi.slice(0, 7);
    // giorni lavorativi già trascorsi nell'anno prima del periodo (dall'avvio): la somma dei mesi non supera il fatturato FY atteso
    const inizioAnno = `${p.anno}-01-01`, primo = `${p.mesi[0]}-01`;
    const da0 = avvio && avvio > inizioAnno ? avvio : inizioAnno;
    const prima = new Date(Date.parse(`${primo}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    let usati = primo > inizioAnno && prima >= da0 ? Math.min(giorniAnno, giorniLavorativi(da0, prima < oggi ? prima : oggi)) : 0;
    for (const mk of p.mesi) {
      // mesi futuri: nessuna stima né ritiri (il conto registra ciò che è avvenuto)
      if (mk > meseOggi) { mesi[mk] = { ...CE.margineCliente({}), produzione: null, futuro: true, pagamenti_righe: [] }; continue; }
      const k = `${c.org_id}|${mk}`;
      const sal0 = salvate.find((x) => x.org_id === c.org_id && x.mese === mk) || null;
      const sal = sal0 && (attivo || sal0.fonte !== 'STIMA') ? sal0 : null;   // stima salvata solo per i clienti attivi
      const stima = attivo && account ? CE.stimaProQuota(account, mk, { giorniAnno, avvio, oggi, giorniUsati: usati }) : null;
      if (stima) usati += stima.giorni;
      const prod = CE.scegliProduzione({ salvata: sal, synclab: syn.get(k), retail: rRetail.get(k), ordini: rOrdini.get(k), stima });
      const ritiri = contratto ? CE.ritiriNelMese(Array.isArray(contratto.days) ? contratto.days : [], mk, contratto.start_date, contratto.end_date) : null;
      const pags = pagOrg.get(k) || [];
      const m = CE.margineCliente({ produzione: prod, listino: listino?.righe || [], costiEsami: costi, costoMedio: imp.costo_medio_esame, costoRitiro: imp.costo_ritiro, ritiri, pagamenti: pags.reduce((s, x) => s + Number(x.amount), 0), documenti: fat.get(k) || null });
      mesi[mk] = { ...m, produzione: prod ? { fonte: prod.fonte, origine: prod.origine, stima: prod.stima, calcolata: prod.calcolata, id: prod.id || null, note: prod.note, righe: prod.righe ? prod.righe.length : 0, dettaglio_stima: prod.dettaglio_stima || null } : null,
        pagamenti_righe: pags.map((x) => ({ id: x.id, protocol: x.protocol, beneficiary_name: x.beneficiary_name, purpose: x.purpose, amount: Number(x.amount), data: x.data })) };
    }
    const fy = attivo ? CE.fatturatoFyAtteso(account, giorniAnno) : null;
    return { org_id: c.org_id, org_name: c.org_name, livello: c.livello, attivo, dal: c.dal, avvio, account_id: account?.id || c.account_id || null,
      proiezione_fy: fy != null ? { anno: annoFy, importo: fy, fonte: account?.fatturato_fy_atteso > 0 ? 'fatturato FY atteso' : 'volumi giornalieri attesi × prezzo medio per esame' } : null, listino: listino ? { id: listino.id, versione: listino.versione, esami: listino.righe.length } : null,
      contratto: contratto ? { id: contratto.id, status: contratto.status, giorni_ritiro: CE.ritiriNelMese(Array.isArray(contratto.days) ? contratto.days : [], p.mesi[0]).giorni_settimana } : null,
      mesi, totale: sommaMesi(Object.values(mesi)) };
  });
  // contrattualizzati non avviati (livello CONTRATTUALIZZATO) senza produzione effettiva nel periodo: fuori (niente stime né proiezione)
  const esclusi = out.filter((c) => !c.attivo && !Object.values(c.mesi).some((m) => m.produzione && CE.effettiva(m.produzione)));
  const tenuti = out.filter((c) => !esclusi.includes(c));
  const proiezione = { anno: annoFy, importo: CE.r2(tenuti.reduce((a, c) => a + Number(c.proiezione_fy?.importo || 0), 0)), clienti: tenuti.filter((c) => c.proiezione_fy).length,
    attivi_senza_fy: tenuti.filter((c) => c.attivo && !c.proiezione_fy).map((c) => c.org_name) };
  if (proiezione.attivi_senza_fy.length) avvisi.push(`Clienti attivi senza fatturato FY atteso né volumi e prezzo nella scheda account del Business Hub (nessuna stima né proiezione): ${proiezione.attivi_senza_fy.join(', ')}`);
  if (!imp.costo_ritiro) avvisi.push('Costo per ritiro non indicato (Impostazioni > Controllo di gestione): i ritiri restano "da indicare"');
  if (!imp.costo_medio_esame && !costi.size) avvisi.push('Né costo medio per esame né tabella "costi esami" (Impostazioni > Controllo di gestione): il costo analitico resta "da indicare"');
  return { clienti: tenuti, proiezione, esclusi_non_attivi: esclusi.map((c) => ({ org_id: c.org_id, org_name: c.org_name, livello: c.livello })), fonti, avvisi, giorni_lavorativi_anno: giorniAnno, impostazioni: imp, costi_esami: costi.size };
}

/** Somma dei mesi di un cliente (ricavo e margine null se nessun mese li ha; "parziale" se manca qualche mese). */
export function sommaMesi(ms) {
  const s = { esami: 0, ricavo: null, ricavo_effettivo: null, ricavo_stime: null, esami_stimati: 0, mesi_stimati: 0, fatturato_documenti: null, costo_ritiri: 0, costo_esami: 0, pagamenti: 0, costi_diretti: 0, margine: null, margine_pct: null, stime: [], da_indicare: [], ricavo_parziale: false, fonti: [] };
  for (const m of ms) {
    s.esami += Number(m.esami || 0);
    if (m.fatturato_documenti != null) s.fatturato_documenti = CE.r2((s.fatturato_documenti || 0) + m.fatturato_documenti);   // a parte: mai nel ricavo
    if (m.ricavo != null) s.ricavo = CE.r2((s.ricavo || 0) + m.ricavo); else if (m.esami > 0) s.ricavo_parziale = true;
    // v0.68.1: ricavo effettivo (produzione Synclab, StudioLAB, manuale) distinto da quello delle stime commerciali
    if ('ricavo_effettivo' in m) {   // totale di un cliente (somma per il totale di linea)
      if (m.ricavo_effettivo != null) s.ricavo_effettivo = CE.r2((s.ricavo_effettivo || 0) + m.ricavo_effettivo);
      if (m.ricavo_stime != null) s.ricavo_stime = CE.r2((s.ricavo_stime || 0) + m.ricavo_stime);
      s.esami_stimati += Number(m.esami_stimati || 0); s.mesi_stimati += Number(m.mesi_stimati || 0);
    } else if (m.produzione) {       // mese di un cliente
      const stimato = !CE.effettiva(m.produzione);
      if (stimato) { s.esami_stimati += Number(m.esami || 0); s.mesi_stimati += 1; }
      if (m.ricavo != null) { if (stimato) s.ricavo_stime = CE.r2((s.ricavo_stime || 0) + m.ricavo); else s.ricavo_effettivo = CE.r2((s.ricavo_effettivo || 0) + m.ricavo); }
    }
    s.costo_ritiri = CE.r2(s.costo_ritiri + (m.costo_ritiri || 0)); s.costo_esami = CE.r2(s.costo_esami + (m.costo_esami || 0));
    s.pagamenti = CE.r2(s.pagamenti + (m.pagamenti || 0)); s.costi_diretti = CE.r2(s.costi_diretti + (m.costi_diretti || 0));
    for (const x of m.stime || []) if (!s.stime.includes(x)) s.stime.push(x);
    for (const x of m.da_indicare || []) if (!s.da_indicare.includes(x)) s.da_indicare.push(x);
    if (m.produzione?.fonte && !s.fonti.includes(m.produzione.fonte)) s.fonti.push(m.produzione.fonte);
  }
  if (s.ricavo != null) { s.margine = CE.r2(s.ricavo - s.costi_diretti); s.margine_pct = s.ricavo > 0 ? Math.round((s.margine / s.ricavo) * 1000) / 10 : null; }
  // margine "effettivo": ricavo della sola produzione effettiva meno gli stessi costi diretti (le stime non contano)
  s.margine_effettivo = s.ricavo_effettivo != null || s.ricavo_stime != null ? CE.r2((s.ricavo_effettivo || 0) - s.costi_diretti) : null;
  return s;
}

// ---------------------------------------------------------------- conto economico di sede
/** Movimenti di tutte le righe del conto nel periodo + stato delle fonti. */
export async function movimentiConto(p, imp, sedi) {
  const mov = []; const fonti = {}; const note = [];
  const tutte = new Map(sedi.tutte.map((s) => [s.id, s]));
  const fmt = p.mese ? 'YYYY-MM-DD' : 'YYYY-MM';
  const lab = sedi.lab;

  // RICAVI · Retail (produzione: vendite nette, senza i dati dimostrativi; le vendite B2B dei clienti Service vanno nella riga Service)
  const service = await caricaService(p, { imp });
  const srvIds = service.clienti.map((c) => c.org_id);
  const ret = await leggi('retail', `SELECT s.site_id, to_char(s.sale_date, '${fmt}') AS d, count(*)::int AS n, sum(s.net_amount) AS tot,
        sum(s.net_amount) FILTER (WHERE s.b2b_customer_id IS NOT NULL) AS b2b, sum(s.net_amount) FILTER (WHERE s.source = 'GIPO') AS gipo, max(s.sale_date)::text AS ultima
      FROM sales s WHERE s.sale_date BETWEEN $1::date AND $2::date AND s.source <> 'DEMO' AND s.site_id IS NOT NULL
       AND NOT (s.b2b_customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM customers c WHERE c.id = s.b2b_customer_id AND c.organization_id = ANY($3::int[])))
     GROUP BY 1, 2 ORDER BY 2`, [p.da, p.a, srvIds]);
  fonti.ricavi_retail = { disponibile: ret.ok, nota: ret.nota || 'Vendite nette di Retail per sede e data (produzione, non fatturato); escluse le vendite dimostrative e quelle B2B dei clienti Service (riga Service)' };
  for (const r of ret.rows) mov.push({ riga: 'ricavi_retail', site_id: r.site_id, importo: CE.r2(r.tot), gipo: CE.r2(r.gipo || 0), ultima: r.ultima, modulo: 'Retail', data: r.d, descrizione: `${r.n} righe di vendita${Number(r.gipo) && CE.r2(r.gipo) !== CE.r2(r.tot) ? `, di cui GIPO ${eurTxt(r.gipo)}` : ''}${Number(r.b2b) ? `, di cui B2B ${eurTxt(r.b2b)}` : ''}`, link: '/retail' });

  // RICAVI · Service: produzione dei clienti attribuita alla sede del Laboratorio
  if (!lab) fonti.ricavi_service = { disponibile: false, nota: 'Nessuna sede LABORATORIO attiva in Amministrazione > Sedi: i ricavi Service non hanno una sede a cui attribuirli' };
  else {
    fonti.ricavi_service = { disponibile: service.fonti.clienti?.disponibile !== false, nota: [service.fonti.clienti?.nota, `Produzione dei clienti Service attribuita a ${lab.name} (pagina Margine per cliente Service)`, service.fonti.business?.nota].filter(Boolean).join('. ') };
    // v0.68.1: nei ricavi solo la produzione effettiva (Synclab, StudioLAB, manuale); le stime commerciali nella riga separata non sommata
    mov.push(...CE.movimentiService(service.clienti, lab, p));
  }
  fonti.stime_service = { disponibile: true, nota: `Solo clienti Service ATTIVI (regola del Business Hub: niente prospect né contrattualizzati non avviati), nei mesi senza produzione effettiva: fatturato FY atteso × giorni lavorativi del periodo dopo l'avvio (fino a oggi) / ${service.giorni_lavorativi_anno}. Non sono produzione e non entrano nei ricavi né nel margine` };
  fonti.proiezione_fy = { disponibile: true, nota: `Fatturato FY atteso pieno dei ${service.proiezione?.clienti ?? 0} clienti Service attivi (schede account del Business Hub): proiezione dell'anno ${service.proiezione?.anno ?? p.anno + 1}, mai sommata` };

  // CONTROLLO · Cash: incassi dei rendiconti da CLOSED in poi (contanti netti, POS, bonifici), non sommati ai ricavi
  const cash = await leggi('cash', `SELECT site_id, to_char(report_date, '${fmt}') AS d, count(*)::int AS n, sum(pos_total + cash_to_deposit + transfer_total) AS tot
      FROM cash_reports WHERE report_date BETWEEN $1::date AND $2::date AND status IN ('CLOSED','PROCESSED','PICKED_UP','VERIFIED','DEPOSITED') GROUP BY 1, 2 ORDER BY 2`, [p.da, p.a]);
  fonti.incassi_cash = { disponibile: cash.ok, nota: cash.nota || 'Rendiconti di cassa chiusi (contanti da versare + POS + bonifici): riga di controllo, la differenza con Retail misura gli incassi non registrati come produzione o viceversa' };
  for (const r of cash.rows) mov.push({ riga: 'incassi_cash', site_id: r.site_id, importo: CE.r2(r.tot), modulo: 'Cash Management', data: r.d, descrizione: `${r.n} rendiconti`, link: '/cash' });

  // COSTI · canone di locazione: contratto dello Scadenziario (scatti) se c'è, altrimenti il canone dell'anagrafica Sedi
  const leases = await many(`SELECT l.id, l.site_id, l.unit, l.landlord_name, coalesce(l.landlord_name, o.name) AS landlord, l.kind, l.start_date::text AS start_date, l.first_term_years, l.renewal_years,
        l.period_months, l.registry_sync, l.active FROM lease_contracts l LEFT JOIN public.organizations o ON o.id = l.landlord_org_id WHERE l.active`);
  const steps = leases.length ? await many('SELECT lease_id, valid_from::text AS valid_from, amount FROM lease_steps WHERE lease_id = ANY($1::int[])', [leases.map((l) => l.id)]) : [];
  const oggi = parseDate(todayRome());
  const conLease = new Set(leases.map((l) => l.site_id));
  for (const l of leases) {
    const s = tutte.get(l.site_id) || await one('SELECT id, name, kind, rent_vat, rent_vat_rate FROM public.sites WHERE id = $1', [l.site_id]);
    const ce = contractEnd(l, oggi);
    const fine = ce && ce.expired ? new Date(ce.end).toISOString().slice(0, 10) : null;
    let tot = 0; const parti = [];
    for (const mk of p.mesi) {
      const cop = CE.copertura(l.start_date, fine, mk);
      if (!cop) continue;
      const mens = CE.canoneMensileDaScatti(steps.filter((x) => x.lease_id === l.id), l.period_months, mk);
      if (mens == null) continue;
      const v = l.registry_sync ? CE.conIva(mens, s?.rent_vat, s?.rent_vat_rate, imp.iva_costi) : mens;
      tot += v * cop; parti.push(mk);
    }
    if (parti.length) mov.push({ riga: 'canone', site_id: l.site_id, importo: CE.r2(tot), modulo: 'Finance Management · Scadenziario', data: parti.length > 1 ? `${parti[0]} / ${parti[parti.length - 1]}` : parti[0],
      descrizione: `Contratto ${l.unit ? `${l.unit} ` : ''}${l.landlord ? `· ${l.landlord}` : ''} (rata dagli scatti${l.registry_sync ? `, ${s?.rent_vat === 'PIU_IVA' ? (imp.iva_costi === 'COSTO' ? 'IVA sommata' : 'IVA esclusa') : 'IVA come in Sedi'}` : ', importo come registrato'})`, link: `/finance/scadenziario?site_id=${l.site_id}` });
  }
  for (const s of sedi.tutte) {
    if (conLease.has(s.id) || s.tenure !== 'LOCAZIONE' || !(Number(s.rent_amount) > 0)) continue;
    const per = CE.MESI_PERIODO[s.rent_period] || 1;
    let tot = 0;
    for (const mk of p.mesi) tot += CE.conIva(Number(s.rent_amount) / per, s.rent_vat, s.rent_vat_rate, imp.iva_costi) * CE.copertura(s.lease_start, null, mk);
    if (tot) mov.push({ riga: 'canone', site_id: s.id, importo: CE.r2(tot), modulo: 'Amministrazione · Sedi', data: p.mesi.length > 1 ? `${p.anno}` : p.mesi[0], descrizione: `Canone dell'anagrafica Sedi (${eurTxt(s.rent_amount)} ${String(s.rent_period || 'MESE').toLowerCase()}, nessun contratto nello Scadenziario)`, link: `/admin/sites?sede=${s.id}` });
  }
  fonti.canone = { disponibile: true, nota: `Rata vigente dagli scatti del contratto dello Scadenziario (canone di Sedi con IVA ${imp.iva_costi === 'COSTO' ? 'sommata, indetraibile' : 'esclusa'} se dovuta), in proporzione ai giorni di contratto nel mese; senza contratto il canone di Amministrazione > Sedi` };

  // COSTI · utenze e bollette registrate (competenza: periodo della bolletta ripartito per giorni, altrimenti mese di scadenza)
  const bills = await many(`SELECT b.id, b.utility_id, u.site_id, u.kind, coalesce(u.supplier_name, o.name) AS supplier, b.period_from::text AS period_from, b.period_to::text AS period_to, b.due_date::text AS due_date, b.amount
      FROM utility_bills b JOIN utilities u ON u.id = b.utility_id LEFT JOIN public.organizations o ON o.id = u.supplier_org_id
     WHERE (b.period_from IS NOT NULL AND b.period_to IS NOT NULL AND b.period_to >= b.period_from AND b.period_from <= $2::date AND b.period_to >= $1::date)
        OR ((b.period_from IS NULL OR b.period_to IS NULL OR b.period_to < b.period_from) AND b.due_date BETWEEN $1::date AND $2::date)`, [p.da, p.a]);
  for (const b of bills) {
    const per = b.period_from && b.period_to && b.period_to >= b.period_from;
    const quota = per ? Object.values(CE.ripartisciPerGiorni(b.amount, b.period_from, b.period_to, p.mesi)).reduce((x, y) => x + y, 0) : Number(b.amount);
    if (!quota) continue;
    mov.push({ riga: 'utenze', site_id: b.site_id, importo: CE.r2(quota), modulo: 'Finance Management · Scadenziario', data: per ? `${b.period_from} / ${b.period_to}` : b.due_date, descrizione: `${UTILITY_LABEL[b.kind] || b.kind}${b.supplier ? ` · ${b.supplier}` : ''} (bolletta di ${eurTxt(b.amount)}${per ? ', quota del periodo' : ''})`, link: `/finance/scadenziario?site_id=${b.site_id}` });
  }
  fonti.utenze = { disponibile: true, nota: 'Bollette registrate nello Scadenziario (importo come registrato), ripartite per giorni del periodo fatturato; le bollette attese ma non registrate non sono contate' };

  // COSTI · royalties al partner ospitante (rendiconti di royalty di sede confermati in Cash)
  const roy = await leggi('cash', `SELECT id, site_id, period, taxable, vat, total FROM site_royalty_statements WHERE period = ANY($1::text[]) AND cancelled_at IS NULL`, [p.mesi]);
  fonti.royalty = { disponibile: roy.ok, nota: roy.nota || `Royalty di sede confermate in Cash (${imp.iva_costi === 'COSTO' ? 'totale con IVA' : 'imponibile'})` };
  for (const r of roy.rows) mov.push({ riga: 'royalty', site_id: r.site_id, importo: CE.r2(imp.iva_costi === 'COSTO' ? r.total : r.taxable), modulo: 'Cash Management', data: r.period, descrizione: `Royalty ${r.period} (imponibile ${eurTxt(r.taxable)}, IVA ${eurTxt(r.vat)})`, link: '/cash' });

  // COSTI · personale dipendente (Contratti del personale): RAL × coefficiente / 12 per la parte di mese coperta dal rapporto
  const dip = await leggi('contracts', `SELECT e.resource_id AS person_id, p.last_name, p.first_name, p.status, coalesce(e.start_date, p.hired_at)::text AS inizio,
        least(e.end_date, p.terminated_at)::text AS fine, e.ral, e.ral_steps, e.cost_coefficient, e.work_site_id, e.contract_type, e.job_title
      FROM employments e JOIN public.people p ON p.id = e.resource_id WHERE p.status <> 'CANDIDATO'`);
  fonti.personale = { disponibile: dip.ok, nota: dip.nota || `Dipendenti con contratto in Contratti del personale: RAL vigente × coefficiente oneri ${String(imp.coefficiente).replace('.', ',')} (impostazione; quello del contratto se HR l'ha indicato) / 12, per i giorni coperti; senza sede di lavoro o con sede centrale tra i costi centrali` };
  for (const e of dip.rows) {
    if (!e.inizio && e.status !== 'ATTIVO') continue;
    let tot = 0, cop = 0, ral = null, coef = null;
    for (const mk of p.mesi) { const c = CE.costoDipendenteMese(e, mk, imp.coefficiente); tot += c.importo; cop += c.copertura; if (c.ral != null) { ral = c.ral; coef = c.coefficiente; } }
    if (!cop) continue;
    mov.push({ riga: 'personale', site_id: e.work_site_id, importo: CE.r2(tot), modulo: 'Contratti del personale', data: e.inizio || '', descrizione: `${e.last_name} ${e.first_name}${e.job_title ? ` · ${e.job_title}` : ''} · RAL ${eurTxt(ral)} × ${String(coef).replace('.', ',')} / 12 × ${String(CE.r2(cop)).replace('.', ',')} mesi`, link: `/people/${e.person_id}` });
  }

  // COSTI · rimborsi spese liquidati (v0.72.0, Rimborso Spese): le note LIQUIDATE o ARCHIVIATE entrano nella riga del personale della sede
  // di lavoro della persona (people.site_id, allineata da Contratti del personale) per il mese della nota (competenza), con il totale
  // rimborsabile (spese anticipate, chilometri, pedaggi, parcheggi). Le spese pagate con carta aziendale o fuel card non sono qui.
  const rimb = await leggi('rimborsi', `SELECT n.id, n.person_id, n.anno, n.mese, n.tot_rimborsabile, n.liquidazione_data::text AS liquidata, p.last_name, p.first_name, p.site_id
      FROM note n JOIN public.people p ON p.id = n.person_id WHERE n.stato IN ('LIQUIDATA','ARCHIVIATA') AND n.tot_rimborsabile > 0 AND (n.anno::text || '-' || lpad(n.mese::text, 2, '0')) = ANY($1::text[])`, [p.mesi]);
  fonti.rimborsi = { disponibile: rimb.ok, nota: rimb.nota || 'Note spese liquidate del Rimborso Spese (totale rimborsabile) sulla sede della persona, per il mese della nota' };
  for (const x of rimb.rows) mov.push({ riga: 'personale', site_id: x.site_id, importo: CE.r2(x.tot_rimborsabile), modulo: 'Rimborso Spese', data: `${x.anno}-${String(x.mese).padStart(2, '0')}`, descrizione: `${x.last_name} ${x.first_name} · nota spese ${String(x.mese).padStart(2, '0')}/${x.anno} liquidata il ${String(x.liquidata || '').split('-').reverse().join('/')}`, link: `/rimborsi/nota/${x.id}` });

  // COSTI · liberi professionisti: compenso mensile del tariffario se quantificabile, altrimenti "da indicare"
  const lp = await leggi('contracts', `SELECT l.resource_id AS person_id, p.last_name, p.first_name, p.status, p.site_id, l.discipline, l.fees, l.est_monthly_cost, l.auto_renew,
        coalesce(l.start_date, p.hired_at)::text AS inizio, (CASE WHEN l.auto_renew THEN p.terminated_at ELSE least(l.end_date, p.terminated_at) END)::text AS fine
      FROM lp_contracts l JOIN public.people p ON p.id = l.resource_id WHERE p.status <> 'CANDIDATO'`);
  fonti.lp = { disponibile: lp.ok, nota: lp.nota || 'Incarichi dei liberi professionisti (Contratti del personale) sulla sede della persona: compensi fissi mensili del tariffario; compensi orari, a prestazione o variabili "da indicare"' };
  for (const x of lp.rows) {
    if (!x.inizio && x.status !== 'ATTIVO') continue;
    const cop = p.mesi.reduce((s, mk) => s + CE.copertura(x.inizio, x.fine, mk), 0);
    if (!cop) continue;
    const c = CE.compensoLp(x);
    const nome = `${x.last_name} ${x.first_name}${x.discipline ? ` · ${x.discipline}` : ''}`;
    if (c.mensile != null) mov.push({ riga: 'lp', site_id: x.site_id, importo: CE.r2(c.mensile * cop), modulo: 'Contratti del personale', data: x.inizio || '', descrizione: `${nome} · ${eurTxt(c.mensile)} al mese × ${String(CE.r2(cop)).replace('.', ',')} mesi`, link: `/people/${x.person_id}` });
    if (c.mensile == null || c.variabile) mov.push({ riga: 'lp', site_id: x.site_id, importo: null, modulo: 'Contratti del personale', data: x.inizio || '', descrizione: `${nome} · ${c.mensile == null ? 'compenso da indicare' : 'parte variabile da indicare'} (tariffario orario, a prestazione o variabile)`, link: `/people/${x.person_id}` });
  }

  // COSTI · manutenzioni con costo (Facility): interventi chiusi e scadenze del piano eseguite
  const fac = await leggi('facility', `SELECT 'Intervento' AS tipo, id, code, site_id, title, cost, (closed_at AT TIME ZONE 'Europe/Rome')::date::text AS d FROM work_orders
       WHERE cost > 0 AND status = 'CHIUSO' AND (closed_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1::date AND $2::date
      UNION ALL SELECT 'Manutenzione del piano', id, NULL, site_id, title, cost, done_at::text FROM maintenance_plans WHERE cost > 0 AND status = 'ESEGUITA' AND done_at BETWEEN $1::date AND $2::date
      ORDER BY 7`, [p.da, p.a]);
  fonti.manutenzioni = { disponibile: fac.ok, nota: fac.nota || 'Interventi chiusi e manutenzioni del piano eseguite con un costo, alla data di chiusura (importo come registrato)' };
  for (const r of fac.rows) mov.push({ riga: 'manutenzioni', site_id: r.site_id, importo: CE.r2(r.cost), modulo: 'Facility e Manutenzioni', data: r.d, descrizione: `${r.tipo}${r.code ? ` ${r.code}` : ''}: ${r.title}`, link: '/facility' });

  // COSTI · pagamenti Finance (sede = centro di costo; con il solo cliente vanno al Laboratorio; senza sede tra i costi centrali)
  const pg = await pagamenti(p);
  fonti.pagamenti = { disponibile: true, nota: `Istanze autorizzate o eseguite (data di esecuzione, valuta o richiesta). Escluse ${pg.esclusi?.scadenziario || 0} istanze dello Scadenziario (già nelle righe canone e utenze) e ${pg.esclusi?.esclusi || 0} segnate "fuori dal conto economico"` };
  for (const r of pg.rows) {
    const site = r.site_id || (r.org_id && lab ? lab.id : null);
    mov.push({ riga: 'pagamenti', site_id: site, importo: CE.r2(r.amount), modulo: 'Finance Management', data: r.data, descrizione: `${r.protocol || `Istanza n. ${r.id}`} · ${r.beneficiary_name} · ${r.purpose}${!r.site_id && r.org_id ? ' (cliente: al Laboratorio)' : ''}${!r.site_id && !r.org_id && r.cost_center ? ` (centro di costo "${r.cost_center}" non abbinato)` : ''}`, link: `/finance/istanze/${r.id}` });
  }
  return { movimenti: mov, fonti, note, service };
}

/** Conto economico completo del periodo con il confronto dello stesso periodo dell'anno precedente. siteId: filtro sulla colonna. */
export async function contoEconomico(p, { siteId = null } = {}) {
  const imp = await impostazioniControllo();
  const calcola = async (per) => {
    const sedi = await sediDelConto(per, imp);
    const { movimenti, fonti, service } = await movimentiConto(per, imp, sedi);
    const conto = CE.componiConto({ sedi: sedi.sedi.map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind })), centrali: sedi.centrali, movimenti, fonti });
    return { conto, fonti, sedi, service };
  };
  const cur = await calcola(p);
  const prev = await calcola(CE.periodoPrecedente(p));
  const prevBy = new Map(prev.conto.colonne.map((c) => [c.sede.id, c]));
  for (const c of cur.conto.colonne) {
    const x = prevBy.get(c.sede.id);
    c.precedente = x ? { ricavi: x.ricavi, costi_diretti: x.costi_diretti, quota_centrali: x.quota_centrali, margine: x.margine, margine_pct: x.margine_pct } : null;
    c.variazione_margine = x ? CE.variazione(c.margine, x.margine) : null;
    c.variazione_ricavi = x ? CE.variazione(c.ricavi, x.ricavi) : null;
  }
  // anno prima senza nessuna riga nella Suite (né ricavi né costi): si dichiara "nessun dato", non 0,00 € (v0.68.1)
  const vuotoPrev = prev.conto.colonne.every((c) => CE.RIGHE.every((r) => !c.voci[r.key].righe.length)) && CE.RIGHE_COSTI.every((k) => !prev.conto.centrali.voci[k].righe.length);
  cur.conto.totale.precedente = { ricavi: prev.conto.totale.ricavi, costi_diretti: prev.conto.totale.costi_diretti, costi_centrali: prev.conto.totale.costi_centrali, margine: prev.conto.totale.margine, margine_pct: prev.conto.totale.margine_pct, vuoto: vuotoPrev };
  cur.conto.totale.variazione_margine = CE.variazione(cur.conto.totale.margine, prev.conto.totale.margine);
  cur.conto.totale.variazione_ricavi = CE.variazione(cur.conto.totale.ricavi, prev.conto.totale.ricavi);
  for (const c of cur.conto.colonne) if (c.precedente) c.precedente.vuoto = vuotoPrev || !CE.RIGHE.some((r) => prevBy.get(c.sede.id)?.voci[r.key].righe.length);
  const colonne = siteId ? cur.conto.colonne.filter((c) => c.sede.id === Number(siteId)) : cur.conto.colonne;
  const comp = composizioneRicavi(cur.conto);
  cur.conto.totale.composizione = comp;
  return {
    da_dove: daDoveViene({ p, conto: cur.conto, fonti: cur.fonti, comp, imp, lab: cur.sedi.lab, prevVuoto: vuotoPrev }),
    periodo: p, precedente: CE.periodoPrecedente(p), impostazioni: imp,
    righe: CE.RIGHE, fonti: cur.fonti, colonne, totale: cur.conto.totale, centrali: cur.conto.centrali, ripartizione: cur.conto.ripartizione,
    laboratorio: cur.sedi.lab ? { id: cur.sedi.lab.id, name: cur.sedi.lab.name } : null,
    sedi: cur.sedi.sedi.map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind })), avvisi: cur.conto.avvisi,
    filtro_sede: siteId ? Number(siteId) : null,
  };
}

// ---------------------------------------------------------------- "Da dove viene" dei KPI (v0.68.1)
const ggmm = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '');
const GIORNI_MESE = (da, a) => { const g1 = Number(String(da).slice(8, 10)), g2 = Number(String(a).slice(8, 10)); const m = CE.MESI_LUNGHI[Number(String(a).slice(5, 7)) - 1]; return String(da).slice(0, 7) === String(a).slice(0, 7) ? `${g1}-${g2} ${m}` : `dal ${ggmm(da)} al ${ggmm(a)}/${String(a).slice(0, 4)}`; };
const NOMI_FONTE_SRV = { SYNCLAB: 'Synclab', STUDIOLAB: 'StudioLAB (file, Retail o Ordini)', MANUALE: 'inserita a mano' };

/** Composizione dei ricavi del periodo: Retail (con la parte GIPO), Service effettivo con le fonti, stime escluse. */
export function composizioneRicavi(conto) {
  const righeRet = conto.colonne.flatMap((c) => c.voci.ricavi_retail.righe);
  const ultima = righeRet.map((m) => m.ultima).filter(Boolean).sort().pop() || null;
  return {
    retail: conto.totale.voci.ricavi_retail, retail_gipo: CE.r2(righeRet.reduce((a, m) => a + Number(m.gipo || 0), 0)), retail_ultima: ultima,
    service: conto.totale.voci.ricavi_service, service_fonti: conto.totale.service_fonti || [], service_clienti: conto.totale.service_clienti || 0,
    stime: conto.totale.stime || { importo: 0, clienti: 0 },
    proiezione: conto.totale.proiezione || { importo: 0, clienti: 0, anno: null },
  };
}

/** Testi "Da dove viene" per i KPI della pagina: fonti e periodo effettivo (fino a oggi nel periodo in corso). */
export function daDoveViene({ p, conto, fonti, comp, imp, lab, prevVuoto, oggi = todayRome() }) {
  const fino = p.a < oggi ? p.a : oggi;
  const per = GIORNI_MESE(p.da, fino);
  const nd = (k) => (fonti[k]?.disponibile === false ? ` (non disponibile: ${fonti[k].nota})` : '');
  const fontiSrv = comp.service_fonti.length ? comp.service_fonti.map((f) => (f === 'SYNCLAB' ? `Synclab: produzione accettata ${per} (accettazioni negli stati della produzione, importi di riga; sconto di testata secondo l'impostazione)` : NOMI_FONTE_SRV[f] || f)).join('; ') : 'nessuna produzione effettiva';
  const ricavi = [
    `Retail${comp.retail_gipo ? ' (GIPO)' : ''}: vendite nette ${per}${comp.retail_ultima ? `, ultimo dato del ${ggmm(comp.retail_ultima)}` : ''}${nd('ricavi_retail')}`,
    `Service: produzione effettiva di ${comp.service_clienti} ${comp.service_clienti === 1 ? 'cliente' : 'clienti'} attribuita a ${lab?.name || 'Laboratorio'} (${fontiSrv})${nd('ricavi_service')}`,
    comp.stime.importo ? `Stime commerciali escluse: ${eurTxt(comp.stime.importo)}, pro quota ${per} di ${comp.stime.clienti} ${comp.stime.clienti === 1 ? 'cliente attivo' : 'clienti attivi'} senza produzione effettiva (Business Hub, non sommate)` : 'Nessuna stima commerciale nel periodo (solo clienti attivi, in pro quota)',
    comp.proiezione?.clienti ? `Proiezione FY ${comp.proiezione.anno}: ${eurTxt(comp.proiezione.importo)}, fatturato atteso pieno di ${comp.proiezione.clienti} ${comp.proiezione.clienti === 1 ? 'cliente attivo' : 'clienti attivi'} (non sommata)` : 'Nessuna proiezione FY: nessun cliente attivo con fatturato FY atteso',
  ];
  const costi = [`Canoni (Scadenziario o Sedi), bollette registrate, royalties di sede (Cash), personale (RAL × ${String(imp.coefficiente).replace('.', ',')} / 12, più le note spese liquidate del Rimborso Spese), liberi professionisti, manutenzioni (Facility), pagamenti Finance: ${per}`];
  const centrali = [`Costi senza sede o delle sedi centrali ${per}, ripartiti sui ricavi delle sedi`];
  const confronto = prevVuoto ? 'anno prima: nessun dato nella Suite' : `anno prima: stesso periodo (${CE.periodoPrecedente(p).etichetta})`;
  return { periodo: per, ricavi, costi_diretti: costi, costi_centrali: centrali, margine: [...ricavi.slice(0, 2), 'meno costi diretti e quota dei costi centrali'], confronto };
}
