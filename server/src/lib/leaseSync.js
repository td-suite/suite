// Titolo di godimento e locazione: allineamento a due versi tra l'anagrafica Sedi (public.sites, fonte unica: Amministrazione > Sedi) e
// il contratto dello Scadenziario strutture di Payments (finance.lease_contracts con gli scatti finance.lease_steps). Richiesta del CEO
// del 31/10/2026: il canone e il contratto si inseriscono una volta sola ("in modo da non replicare l'azione").
//   siteToLease: al salvataggio di una sede in LOCAZIONE con canone e decorrenza crea o aggiorna il contratto collegato (registry_sync)
//                con lo scatto INIZIALE; se Payments ha già registrato scatti successivi (ISTAT, rinegoziazioni) non li tocca e, solo
//                se il canone dell'anagrafica è cambiato, aggiunge uno scatto dalla data di oggi con motivo ANAGRAFICA. Collega a
//                Payments il PDF caricato in Sedi (finance.lease_documents.site_document_id, senza copiare il file).
//   leaseToSite: un contratto creato o modificato in Payments aggiorna la sede (tenure LOCAZIONE, canone dallo scatto iniziale,
//                locatore, durata, deposito, registrazione).
// Flag antirimbalzo: le due funzioni girano in un contesto (AsyncLocalStorage) che dice chi ha avviato l'allineamento; una scrittura
// partita da un verso non riavvia mai l'altro. Le funzioni pure in testa sono provate in test/lease-sync.test.mjs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { one, many, tx } from '../db.js';
import { getModuleState } from './modules.js';
import { leaseEndOf, initialSteps } from './leaseAnalysis.js';
import { today as todayRome } from './util.js';

export const TENURE = { PROPRIETA: 'Proprietà', LOCAZIONE: 'Locazione', COMODATO: 'Comodato', OSPITATA: 'Ospitata da Legal entity' };
export const PERIOD_MONTHS = { MESE: 1, TRIMESTRE: 3, SEMESTRE: 6, ANNO: 12 };
// Campi della sede che riguardano la locazione (se uno di questi cambia, si riallinea Payments)
export const LEASE_SITE_KEYS = ['tenure', 'rent_amount', 'rent_period', 'rent_vat', 'rent_vat_rate', 'lease_start', 'lease_years', 'lease_renewal_years', 'lease_notice_months', 'lease_end',
  'lease_landlord_org_id', 'lease_registration', 'guarantee_bank_amount', 'guarantee_insurance_amount', 'deposit_amount', 'guarantee_notes'];
// Campi che hanno senso solo in locazione (svuotati per proprietà e ospitata; il comodato tiene durata e comodante)
const RENT_ONLY = ['rent_amount', 'rent_vat', 'lease_registration', 'guarantee_bank_amount', 'guarantee_insurance_amount', 'deposit_amount', 'guarantee_notes'];
const LEASE_ALL = [...RENT_ONLY, 'lease_start', 'lease_years', 'lease_renewal_years', 'lease_notice_months', 'lease_end', 'lease_landlord_org_id'];

// ---------- funzioni pure ----------
export const periodMonths = (p) => PERIOD_MONTHS[String(p || '').toUpperCase()] || 1;
// Periodicità di Payments (1, 2, 3, 6, 12 mesi) → periodo dell'anagrafica; il bimestrale non c'è e diventa mensile (importo / 2)
export function rentPeriodOf(months) {
  const m = Number(months) || 1;
  const p = { 1: 'MESE', 3: 'TRIMESTRE', 6: 'SEMESTRE', 12: 'ANNO' }[m];
  return p ? { rent_period: p, divisor: 1 } : { rent_period: 'MESE', divisor: m };
}
// Fine del primo periodo: decorrenza + anni (calcolata quando l'utente la lascia vuota)
export const leaseEnd = (start, years) => leaseEndOf(start, years);
// Tipologia del contratto di Payments dalla durata
export function leaseKindOf(tenure, years, renewal) {
  if (tenure === 'COMODATO') return 'COMODATO';
  const y = Number(years), r = Number(renewal);
  if (y === 6 && (r === 6 || !renewal)) return 'COMMERCIALE_6_6';
  if (y === 9) return 'COMMERCIALE_9_9';
  if (y === 4 && r === 4) return 'ABITATIVO_4_4';
  if (y === 3 && r === 2) return 'ABITATIVO_3_2';
  if (y && y * 12 < 18) return 'TRANSITORIO';
  return y ? 'ALTRO' : null;
}
// Titolo proposto dal form: ospitata se c'è la Legal entity ospitante
export const suggestedTenure = ({ host_organization_id, tenure } = {}) => (host_organization_id ? 'OSPITATA' : tenure || 'LOCAZIONE');
// Regola di coerenza titolo / ospitante: messaggio di errore o null
export function tenureIssue({ tenure, host_organization_id } = {}) {
  if (tenure === 'OSPITATA' && !host_organization_id) return 'Una sede ospitata richiede la Legal entity ospitante: indicala o scegli un altro titolo di godimento';
  if (tenure && !TENURE[tenure]) return 'Titolo di godimento non valido';
  return null;
}
// Normalizza i campi della locazione secondo il titolo: proprietà e ospitata non hanno canone né garanzie; lease_end calcolata se vuota
export function normalizeLeaseFields(b) {
  const out = { ...b };
  if (out.tenure === 'PROPRIETA' || out.tenure === 'OSPITATA') for (const k of LEASE_ALL) out[k] = null;
  else if (out.tenure === 'COMODATO') for (const k of RENT_ONLY) out[k] = null;
  if ((out.lease_end == null || out.lease_end === '') && out.lease_start && out.lease_years != null) out.lease_end = leaseEnd(out.lease_start, out.lease_years);
  if (out.rent_vat && out.rent_vat !== 'ESENTE' && out.rent_vat_rate == null) out.rent_vat_rate = 22;
  return out;
}
// Fusione della proposta letta dal PDF con i campi del form: i campi letti sostituiscono quelli del form (overwrite, dopo un nuovo
// caricamento) oppure riempiono solo quelli vuoti; null e undefined della proposta non toccano mai il form
export function mergeProposal(current, proposal, { overwrite = true } = {}) {
  const out = { ...current };
  for (const [k, v] of Object.entries(proposal || {})) {
    if (v == null || v === '') continue;
    if (!(k in out)) continue;
    if (overwrite || out[k] == null || out[k] === '') out[k] = v;
  }
  return out;
}
// Dalla sede ai campi di finance.lease_contracts
export function leaseFieldsFromSite(s) {
  return { landlord_org_id: s.lease_landlord_org_id ?? null, start_date: s.lease_start, first_term_years: s.lease_years ?? null, renewal_years: s.lease_renewal_years ?? null,
    notice_months: s.lease_notice_months ?? null, period_months: periodMonths(s.rent_period), deposit: s.deposit_amount ?? null, registration: s.lease_registration ?? null,
    kind: leaseKindOf(s.tenure, s.lease_years, s.lease_renewal_years) };
}
// Dal contratto di Payments (e dall'importo dello scatto iniziale) ai campi della sede
export function siteFieldsFromLease(l, initialAmount) {
  const p = rentPeriodOf(l.period_months);
  const start = l.start_date ? String(l.start_date).slice(0, 10) : null;
  return { tenure: 'LOCAZIONE', rent_amount: initialAmount != null ? Math.round((Number(initialAmount) / p.divisor) * 100) / 100 : null, rent_period: p.rent_period,
    lease_start: start, lease_years: l.first_term_years ?? null, lease_renewal_years: l.renewal_years ?? null, lease_notice_months: l.notice_months ?? null,
    lease_end: leaseEnd(start, l.first_term_years), lease_landlord_org_id: l.landlord_org_id ?? null, lease_registration: l.registration ?? null, deposit_amount: l.deposit ?? null };
}
/**
 * Cosa fare sugli scatti del canone quando il canone dell'anagrafica è `amount` (rata nel periodo di Payments):
 * - nessuno scatto: crea l'INIZIALE alla decorrenza;
 * - nessuno scatto dopo l'iniziale: aggiorna l'INIZIALE (importo, e data = decorrenza se non ci sono rate ridotte prima);
 * - scatti successivi registrati in Payments: non si toccano; solo se il canone è cambiato in anagrafica (rentChanged) si aggiunge uno
 *   scatto ANAGRAFICA dalla data di oggi (o si aggiorna quello già presente in quella data).
 * Ritorna { type: 'none' | 'insert_initial' | 'update_initial' | 'add_step' | 'update_step', ... }.
 */
export function planRentChange(steps, { amount, start, today, rentChanged = false }) {
  const list = [...(steps || [])].map((x) => ({ ...x, valid_from: String(x.valid_from).slice(0, 10) })).sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  if (amount == null || !start) return { type: 'none' };
  if (!list.length) return { type: 'insert_initial', valid_from: start, amount };
  const ini = list.find((x) => x.reason === 'INIZIALE') || list[0];
  const before = list.filter((x) => x.valid_from < ini.valid_from);
  const later = list.filter((x) => x.valid_from > ini.valid_from);
  if (!later.length) {
    const from = before.length ? ini.valid_from : start;
    if (Number(ini.amount) === Number(amount) && ini.valid_from === from) return { type: 'none' };
    return { type: 'update_initial', id: ini.id, amount, valid_from: from };
  }
  if (!rentChanged) return { type: 'none', reason: 'scatti successivi in Payments' };
  const last = list[list.length - 1];
  if (Number(last.amount) === Number(amount)) return { type: 'none' };
  const from = today > start ? today : start;
  const same = list.find((x) => x.valid_from === from);
  if (same) return { type: 'update_step', id: same.id, amount, valid_from: from };
  return { type: 'add_step', valid_from: from, amount };
}

// ---------- flag antirimbalzo ----------
const origin = new AsyncLocalStorage();
export const syncOrigin = () => origin.getStore() || null;

// Payments avviato e con lo schema dello scadenziario (e la colonna registry_sync della migrazione 004)
export async function financeReady() {
  const st = await getModuleState('finance');
  if (st.mode !== 'LIVE' || !st.schema_ready) return false;
  const r = await one(`SELECT to_regclass('finance.lease_contracts') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='finance' AND table_name='lease_contracts' AND column_name='registry_sync') AS ok`);
  return Boolean(r?.ok);
}

// Contratto di Payments collegato all'anagrafica per una sede (o null)
export async function registryLease(siteId) {
  if (!(await financeReady())) return null;
  return one(`SELECT l.*, coalesce(l.landlord_name, o.name) AS landlord_label FROM finance.lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id
    WHERE l.site_id=$1 AND l.active ORDER BY l.registry_sync DESC, l.start_date DESC, l.id DESC LIMIT 1`, [siteId]);
}

// PDF dei contratti caricati in Sedi collegati al contratto di Payments (righe senza byte, puntano a public.site_documents)
async function linkDocuments(c, siteId, leaseId) {
  const r = await c.query(`INSERT INTO finance.lease_documents (lease_id, filename, mime, size, sha256, extracted, extracted_at, model, text_chars, ocr, site_document_id)
    SELECT $2, d.filename, d.mime, d.size, d.sha256, d.extracted, d.extracted_at, d.model, d.text_chars, d.ocr, d.id FROM public.site_documents d
     WHERE d.site_id=$1 AND d.kind='CONTRATTO_LOCAZIONE' AND NOT EXISTS (SELECT 1 FROM finance.lease_documents x WHERE x.lease_id=$2 AND x.site_document_id=d.id)`, [siteId, leaseId]);
  return r.rowCount;
}

/**
 * Anagrafica → Payments. Ritorna { status: 'ok' | 'skip', reason?, lease_id?, created?, step?, documents? }.
 * opts.rentChanged: il canone è cambiato in questo salvataggio (serve a non annullare gli scatti ISTAT registrati in Payments).
 */
export async function siteToLease(siteId, { rentChanged = false } = {}) {
  if (syncOrigin() === 'FINANCE') return { status: 'skip', reason: 'allineamento partito da Payments' };
  return origin.run('CORE', async () => {
    const s = await one('SELECT * FROM public.sites WHERE id=$1', [siteId]);
    if (!s) return { status: 'skip', reason: 'sede inesistente' };
    if (!(await financeReady())) return { status: 'skip', reason: 'Payments non avviato: il contratto resta solo in anagrafica' };
    if (s.tenure !== 'LOCAZIONE') {
      const l = await one('SELECT id FROM finance.lease_contracts WHERE site_id=$1 AND registry_sync AND active', [siteId]);
      return { status: 'skip', reason: l ? 'La sede non è più in locazione: il contratto in Payments resta attivo, chiudilo nello Scadenziario strutture' : 'sede non in locazione', lease_id: l?.id || null };
    }
    if (s.rent_amount == null || !s.lease_start) return { status: 'skip', reason: 'Canone e decorrenza servono per creare il contratto in Payments' };
    const f = leaseFieldsFromSite(s);
    const amount = Math.round(Number(s.rent_amount) * 100) / 100;   // la rata dell'anagrafica è già nel periodo di Payments
    const doc = await one(`SELECT id, extracted FROM public.site_documents WHERE site_id=$1 AND kind='CONTRATTO_LOCAZIONE' ORDER BY created_at DESC LIMIT 1`, [siteId]);
    return tx(async (c) => {
      let l = (await c.query('SELECT * FROM finance.lease_contracts WHERE site_id=$1 AND registry_sync AND active FOR UPDATE', [siteId])).rows[0];
      if (!l) {   // contratto attivo già registrato in Payments per la sede: diventa quello dell'anagrafica
        l = (await c.query('SELECT * FROM finance.lease_contracts WHERE site_id=$1 AND active ORDER BY start_date DESC, id DESC LIMIT 1 FOR UPDATE', [siteId])).rows[0];
        if (l) await c.query('UPDATE finance.lease_contracts SET registry_sync=TRUE WHERE id=$1', [l.id]);
      }
      let created = false;
      if (!l) {
        const istat = Boolean(doc?.extracted?.canone?.istat?.previsto);
        l = (await c.query(`INSERT INTO finance.lease_contracts (site_id, landlord_org_id, kind, start_date, first_term_years, renewal_years, notice_months, period_months, deposit, registration, istat, notes, registry_sync)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE) RETURNING *`,
        [siteId, f.landlord_org_id, f.kind || 'ALTRO', f.start_date, f.first_term_years, f.renewal_years, f.notice_months, f.period_months, f.deposit, f.registration, istat,
          'Dati dall\'anagrafica Sedi (Amministrazione): canone, durata, locatore e garanzie si modificano in Amministrazione > Sedi'])).rows[0];
        created = true;
      } else {
        await c.query(`UPDATE finance.lease_contracts SET landlord_org_id=$2, start_date=$3, first_term_years=$4, renewal_years=$5, notice_months=$6, period_months=$7, deposit=$8,
            registration=$9, kind=coalesce($10, kind), updated_at=now() WHERE id=$1`,
        [l.id, f.landlord_org_id, f.start_date, f.first_term_years, f.renewal_years, f.notice_months, f.period_months, f.deposit, f.registration, f.kind]);
      }
      // scatti del canone
      const steps = (await c.query('SELECT id, valid_from, amount, reason FROM finance.lease_steps WHERE lease_id=$1 ORDER BY valid_from', [l.id])).rows;
      let plan;
      if (!steps.length && doc?.extracted) {
        // primo contratto dal PDF: rate iniziali ridotte (ALTRO) + canone a regime (INIZIALE), come nello Scadenziario
        const ini = initialSteps(doc.extracted, { start_date: f.start_date, amount }).filter((x) => x.valid_from >= f.start_date);
        for (const st of ini) await c.query('INSERT INTO finance.lease_steps (lease_id, valid_from, amount, reason, notes) VALUES ($1,$2,$3,$4,$5)', [l.id, st.valid_from, st.amount, st.reason, st.notes || null]);
        plan = { type: 'insert_initial', steps: ini.length };
      } else {
        plan = planRentChange(steps, { amount, start: f.start_date, today: todayRome(), rentChanged: rentChanged || created });
        if (plan.type === 'insert_initial') await c.query(`INSERT INTO finance.lease_steps (lease_id, valid_from, amount, reason) VALUES ($1,$2,$3,'INIZIALE')`, [l.id, plan.valid_from, plan.amount]);
        else if (plan.type === 'update_initial') await c.query('UPDATE finance.lease_steps SET amount=$2, valid_from=$3 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM finance.lease_steps x WHERE x.lease_id=$4 AND x.valid_from=$3 AND x.id<>$1)', [plan.id, plan.amount, plan.valid_from, l.id]);
        else if (plan.type === 'update_step') await c.query(`UPDATE finance.lease_steps SET amount=$2, reason='ANAGRAFICA', notes='Canone modificato in Amministrazione > Sedi' WHERE id=$1`, [plan.id, plan.amount]);
        else if (plan.type === 'add_step') await c.query(`INSERT INTO finance.lease_steps (lease_id, valid_from, amount, reason, notes) VALUES ($1,$2,$3,'ANAGRAFICA','Canone modificato in Amministrazione > Sedi')`, [l.id, plan.valid_from, plan.amount]);
      }
      const documents = await linkDocuments(c, siteId, l.id);
      return { status: 'ok', lease_id: l.id, created, step: plan.type, documents };
    });
  });
}

/**
 * Payments → anagrafica. Un contratto creato o modificato nello Scadenziario aggiorna la sede: tenure LOCAZIONE, canone dallo scatto
 * iniziale, locatore, durata, deposito, registrazione. Vale per il contratto collegato (registry_sync) o, se la sede non ne ha, per
 * questo contratto, che diventa quello collegato. Ritorna { status, reason?, site_id?, tenure_before? }.
 */
export async function leaseToSite(leaseId) {
  if (syncOrigin() === 'CORE') return { status: 'skip', reason: 'allineamento partito dall\'anagrafica' };
  return origin.run('FINANCE', async () => {
    if (!(await financeReady())) return { status: 'skip', reason: 'schema Payments non aggiornato' };
    const l = await one('SELECT * FROM finance.lease_contracts WHERE id=$1', [leaseId]);
    if (!l || !l.active) return { status: 'skip', reason: 'contratto non attivo' };
    if (!l.registry_sync) {
      const other = await one('SELECT id FROM finance.lease_contracts WHERE site_id=$1 AND registry_sync AND active AND id<>$2', [l.site_id, l.id]);
      if (other) return { status: 'skip', reason: 'la sede ha già un altro contratto collegato all\'anagrafica' };
      await one('UPDATE finance.lease_contracts SET registry_sync=TRUE WHERE id=$1 RETURNING id', [l.id]);
    }
    const steps = await many('SELECT valid_from, amount, reason FROM finance.lease_steps WHERE lease_id=$1 ORDER BY valid_from', [l.id]);
    const ini = steps.find((x) => x.reason === 'INIZIALE') || steps[0] || null;
    const f = siteFieldsFromLease(l, ini?.amount ?? null);
    const before = await one('SELECT tenure FROM public.sites WHERE id=$1', [l.site_id]);
    if (!before) return { status: 'skip', reason: 'sede inesistente' };
    // i valori assenti nel contratto non cancellano quelli dell'anagrafica
    const cols = Object.keys(f);
    await one(`UPDATE public.sites SET ${cols.map((k, i) => (k === 'tenure' ? `${k}=$${i + 2}` : `${k}=coalesce($${i + 2}, ${k})`)).join(', ')}, updated_at=now() WHERE id=$1 RETURNING id`, [l.site_id, ...cols.map((k) => f[k])]);
    return { status: 'ok', site_id: l.site_id, tenure_before: before.tenure };
  });
}
