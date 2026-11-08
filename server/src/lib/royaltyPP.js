// Royalties dei punti prelievo dal contratto PP a Cash (correzione B13 del programma "anagrafica unica", decisione 10 del CEO
// dell'08/11/2026: "i termini del contratto PP precompilano Cash, con conferma"). I termini economici stanno nel contratto PP del
// Business Hub (business.contracts.data.fee.items); Cash li usa per il rendiconto delle royalties (cash.site_ext.royalty_*).
// Niente scrittura automatica: alla firma la Suite prepara la proposta, che si conferma da una modale nella pagina Punti Prelievo del
// Business Hub o in Cash > Sedi. Se Cash ha già royalties diverse: avviso, e si sovrascrive solo con la conferma esplicita.
import { one, tx } from '../db.js';
import { audit } from './util.js';

const VIGENTI = ['FIRMATO', 'AUTORIZZATO', 'ATTIVO'];
const MESI = { MESE: 1, TRIMESTRE: 3, ANNO: 12 };
const BASE = { PUNTO_PRELIEVI: 'punto prelievi', CENTRO_DIAGNOSTICO: 'centro diagnostico', POLIAMBULATORIO: 'poliambulatorio', ALTRO: 'altro' };
const PERIODO = { MESE: 'al mese', TRIMESTRE: 'al trimestre', ANNO: "all'anno", UNA_TANTUM: 'una tantum' };
const IVA = { PIU_IVA: '+ IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente IVA' };
const eur = (x) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(x));

/**
 * Voci economiche del contratto PP → campi royalty di Cash (funzione pura, provata nei test).
 * - PERCENT: percentuale sui ricavi (somma se più voci percentuali sulla stessa base; base Cash = TOTALE);
 * - FIXED mensile/trimestrale/annuale: quota fissa mensile (importo / mesi del periodo); UNA_TANTUM solo nelle note;
 * - MINIMUM e TEXT: nelle note (Cash non ha un campo per il minimo garantito);
 * - IVA: 22% se una voce economica è "+ IVA", altrimenti 0.
 * Ritorna { royalty_fixed_monthly, royalty_pct, royalty_base, royalty_vat_rate, royalty_notes, voci }.
 */
export function royaltyDaVoci(items = [], { protocollo = null } = {}) {
  let pct = 0; let fisso = 0; let iva = null; const note = []; const voci = [];
  for (const it of Array.isArray(items) ? items : []) {
    const k = it?.kind || 'PERCENT';
    if (k === 'PERCENT' && it.percent != null) {
      pct += Number(it.percent) || 0;
      voci.push(`${String(it.percent).replace('.', ',')}% sui ricavi ${it.base === 'ALTRO' ? it.base_other || 'altro' : BASE[it.base] || 'punto prelievi'}${it.include_ssr ? ' (SSR compreso)' : ''}`);
      if (it.vat) iva = iva === 'PIU_IVA' ? iva : it.vat;
    } else if (k === 'FIXED' && it.amount != null) {
      if (MESI[it.period || 'MESE']) fisso += (Number(it.amount) || 0) / MESI[it.period || 'MESE'];
      voci.push(`${eur(it.amount)} ${PERIODO[it.period || 'MESE']}${it.purpose ? ` (${it.purpose})` : ''}`);
      if (it.period === 'UNA_TANTUM') note.push(`quota una tantum ${eur(it.amount)}${it.purpose ? ` (${it.purpose})` : ''} non compresa nella quota mensile`);
      if (it.vat) iva = iva === 'PIU_IVA' ? iva : it.vat;
    } else if (k === 'MINIMUM' && it.amount != null) {
      voci.push(`minimo garantito ${eur(it.amount)} ${PERIODO[it.period || 'MESE']}`);
      note.push(`minimo garantito ${eur(it.amount)} ${PERIODO[it.period || 'MESE']}`);
    } else if (k === 'TEXT' && it.text) {
      voci.push(it.text.slice(0, 300)); note.push(it.text.slice(0, 300));
    }
  }
  const notes = [`Dal contratto PP${protocollo ? ` ${protocollo}` : ''}: ${voci.length ? voci.join('; ') : 'nessuna voce economica'}${iva ? ` (${IVA[iva] || iva})` : ''}`, ...note].join('. ');
  return { royalty_fixed_monthly: Math.round(fisso * 100) / 100, royalty_pct: Math.round(pct * 100) / 100, royalty_base: 'TOTALE', royalty_vat_rate: iva === 'PIU_IVA' ? 22 : 0, royalty_notes: notes.slice(0, 1000), voci };
}

const CAMPI = ['royalty_fixed_monthly', 'royalty_pct', 'royalty_base', 'royalty_vat_rate'];
/** Differenze tra la proposta e Cash (solo i campi economici; le note non contano). */
export function differenzeRoyalty(proposta, attuale) {
  if (!attuale) return [];
  return CAMPI.filter((k) => String(proposta[k] ?? '') !== String(attuale[k] ?? '') && !(Number.isFinite(Number(proposta[k])) && Number(proposta[k]) === Number(attuale[k])))
    .map((k) => ({ campo: k, cash: attuale[k], contratto: proposta[k] }));
}
const vuote = (a) => !a || (Number(a.royalty_fixed_monthly || 0) === 0 && Number(a.royalty_pct || 0) === 0);

/**
 * Proposta per una sede: contratto PP vigente più recente, voci → campi Cash, confronto con Cash.
 * Ritorna { site, contratto, proposta, attuale, differenze, stato: 'NUOVA' | 'UGUALE' | 'DIVERSA' | 'SENZA_CONTRATTO' | 'NON_OSPITATA' | 'CASH_NON_AVVIATO', avvisi }.
 */
export async function propostaRoyalty(siteId) {
  const site = await one(`SELECT s.id, s.code, s.name, s.tenure, s.host_organization_id, s.organization_id, o.name AS host_name FROM public.sites s LEFT JOIN public.organizations o ON o.id=s.host_organization_id WHERE s.id=$1`, [siteId]);
  if (!site) return { stato: 'SENZA_SEDE', avvisi: ['Sede inesistente'] };
  const has = async (t) => Boolean((await one('SELECT to_regclass($1) IS NOT NULL AS ok', [t]))?.ok);
  if (!(await has('business.contracts'))) return { site, stato: 'SENZA_CONTRATTO', avvisi: ['Business Hub non avviato'] };
  const c = await one(`SELECT id, protocol, status, org_id, signed_at, data FROM business.contracts WHERE kind='PP' AND site_id=$1 AND status = ANY($2::text[]) ORDER BY coalesce(signed_at, start_date, created_at::date) DESC, id DESC LIMIT 1`, [siteId, VIGENTI]);
  if (!c) return { site, stato: 'SENZA_CONTRATTO', avvisi: ['Nessun contratto PP vigente sulla sede'] };
  const proposta = royaltyDaVoci(c.data?.fee?.items || [], { protocollo: c.protocol });
  const contratto = { id: c.id, protocol: c.protocol, status: c.status, voci: proposta.voci };
  if (!(await has('cash.site_ext'))) return { site, contratto, proposta, stato: 'CASH_NON_AVVIATO', avvisi: ['Cash Management non avviato: la proposta si applica quando il modulo è avviato'] };
  const attuale = await one('SELECT royalty_fixed_monthly, royalty_pct, royalty_base, royalty_vat_rate, royalty_notes, company_id FROM cash.site_ext WHERE site_id=$1', [siteId]);
  if (site.tenure !== 'OSPITATA') return { site, contratto, proposta, attuale, stato: 'NON_OSPITATA', avvisi: ['La sede non è Ospitata in Amministrazione > Sedi: Cash non calcola royalties'] };
  const differenze = differenzeRoyalty(proposta, attuale);
  const stato = vuote(attuale) ? (vuote(proposta) ? 'UGUALE' : 'NUOVA') : differenze.length ? 'DIVERSA' : 'UGUALE';
  const avvisi = stato === 'DIVERSA' ? [`Cash ha già royalties diverse da quelle del contratto (${differenze.map((d) => `${d.campo}: ${d.cash} → ${d.contratto}`).join(', ')}): si sovrascrivono solo con la conferma`] : [];
  return { site, contratto, proposta, attuale, differenze, stato, avvisi };
}

/**
 * Applica la proposta in Cash (cash.site_ext, storico royalty, audit). sovrascrivi = true serve se Cash ha già royalties diverse.
 * La riga di Cash nasce se manca, con l'azienda = Legal entity proprietaria della sede (B6). Ritorna { esito, proposta }.
 */
export async function applicaRoyalty(siteId, { sovrascrivi = false, req = null, actorId = null, origine = 'Business Hub, contratto PP' } = {}) {
  const p = await propostaRoyalty(siteId);
  if (['SENZA_SEDE', 'SENZA_CONTRATTO', 'CASH_NON_AVVIATO', 'NON_OSPITATA'].includes(p.stato)) return { esito: 'NON_APPLICATA', stato: p.stato, avvisi: p.avvisi };
  if (p.stato === 'UGUALE') return { esito: 'GIA_ALLINEATA', stato: p.stato };
  if (p.stato === 'DIVERSA' && !sovrascrivi) return { esito: 'CONFERMA_RICHIESTA', stato: p.stato, differenze: p.differenze, avvisi: p.avvisi };
  const user = req ? (req.suiteUser || req.user) : (actorId ? { id: actorId } : null);
  const cashUser = user?.id ? await one('SELECT id FROM cash.users WHERE suite_user_id=$1 ORDER BY id LIMIT 1', [user.id]).catch(() => null) : null;   // storico di Cash: utente del modulo
  const x = p.proposta;
  await tx(async (c) => {
    const cur = (await c.query('SELECT site_id FROM cash.site_ext WHERE site_id=$1 FOR UPDATE', [siteId])).rows[0];
    if (!cur) {
      if (!p.site.organization_id) throw Object.assign(new Error('La sede non ha la Legal entity proprietaria (Amministrazione > Sedi): Cash non sa a quale azienda intestarla'), { status: 400 });
      await c.query(`INSERT INTO cash.site_ext (site_id, company_id, royalty_fixed_monthly, royalty_pct, royalty_base, royalty_vat_rate, royalty_notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [siteId, p.site.organization_id, x.royalty_fixed_monthly, x.royalty_pct, x.royalty_base, x.royalty_vat_rate, x.royalty_notes]);
    } else {
      await c.query(`UPDATE cash.site_ext SET royalty_fixed_monthly=$2, royalty_pct=$3, royalty_base=$4, royalty_vat_rate=$5, royalty_notes=$6, updated_at=now() WHERE site_id=$1`,
        [siteId, x.royalty_fixed_monthly, x.royalty_pct, x.royalty_base, x.royalty_vat_rate, x.royalty_notes]);
    }
    await c.query('INSERT INTO cash.site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [siteId, x.royalty_fixed_monthly, x.royalty_pct, x.royalty_vat_rate, x.royalty_base, cashUser?.id || null]);
  });
  await audit({ user, ip: req?.ip || null }, 'ROYALTY_DA_CONTRATTO_PP', { module: 'cash', entity: 'site', entityId: siteId, label: `${p.site.code}: royalties dal contratto PP ${p.contratto.protocol || `#${p.contratto.id}`} (${origine})`, data: { prima: p.attuale, dopo: x, sovrascritte: p.stato === 'DIVERSA' } });
  return { esito: 'APPLICATA', stato: p.stato, proposta: x };
}
