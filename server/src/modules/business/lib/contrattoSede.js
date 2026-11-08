// Contratto Punti Prelievo ↔ anagrafica Sedi (correzione A1 del programma "anagrafica unica", decisione 2 del CEO dell'08/11/2026).
// - Alla FIRMA (contrattualizzazione PP, stato FIRMATO / AUTORIZZATO / ATTIVO dalla scheda o manuale): se la sede del contratto non ha
//   ospitante, la Suite imposta da sola in Sedi tenure = OSPITATA e Legal entity ospitante = controparte, con la funzione unica del core
//   (lib/sites.js saveSite: audit, Cash, perimetri del partner). Se l'ospitante c'è ed è un'altra Legal entity: solo avviso, nessuna
//   scrittura. Se è già la controparte e il titolo è OSPITATA: nulla da fare.
// - Alla CESSAZIONE del contratto non rinnovato (nessun altro contratto PP non annullato sulla stessa sede) la sede SI CHIUDE: active =
//   false, closed_at = data di cessazione, con il quadro d'impatto (B17 minimo) registrato negli eventi del contratto.
// - Alla creazione del contratto: solo verifica (avviso nella risposta).
import { one, q } from '../db.js';
import { saveSite } from '../../../lib/sites.js';
import { todayRome } from './util.js';

const VIGENTI = ['FIRMATO', 'AUTORIZZATO', 'ATTIVO'];
// userId è l'utente del modulo (business.users, per gli eventi del contratto); l'audit del core vuole l'utente della Suite (stessa email)
async function suiteIdDi(userId) {
  if (!userId) return null;
  return (await one('SELECT su.id FROM users bu JOIN public.users su ON lower(su.email)=lower(bu.email) WHERE bu.id=$1', [userId]).catch(() => null))?.id || null;
}

async function evento(contractId, kind, userId, note, data) {
  await q('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [contractId, kind, userId || null, note, data ? JSON.stringify(data) : null]).catch(() => {});
}

// B13: alla firma la proposta delle royalties per Cash (dai fee.items del contratto) si prepara e si annota negli eventi del contratto;
// si conferma nella pagina Punti Prelievo o in Cash > Sedi (mai scritta da sola)
async function notaRoyalty(c, siteId, userId) {
  const { propostaRoyalty } = await import('../../../lib/royaltyPP.js');
  const p = await propostaRoyalty(siteId).catch(() => null);
  if (!p || !['NUOVA', 'DIVERSA'].includes(p.stato)) return p ? { stato: p.stato } : null;
  await evento(c.id, 'ROYALTY_PROPOSTA', userId, `Royalties per Cash dal contratto: ${p.proposta.voci.join('; ') || 'nessuna voce'}. ${p.stato === 'DIVERSA' ? 'Cash ha già royalties diverse: ' : ''}da confermare in Business Hub > Punti Prelievo o in Cash > Sedi`, { site_id: siteId, proposta: p.proposta, differenze: p.differenze });
  return { stato: p.stato, differenze: p.differenze };
}

/** Coerenza tra contratto PP e sede (funzione pura, usata anche dall'elenco Punti Prelievo e dalla Diagnostica D04). */
export function coerenzaPP({ sede, orgId }) {
  if (!sede) return { stato: 'SENZA_SEDE', testo: 'Il contratto non indica la sede del punto prelievi' };
  if (sede.tenure === 'OSPITATA' && Number(sede.host_organization_id) === Number(orgId)) return { stato: 'OK', testo: 'Sede ospitata dalla controparte del contratto' };
  if (sede.host_organization_id == null) return { stato: 'DA_IMPOSTARE', testo: 'La sede non ha la Legal entity ospitante: alla firma diventa Ospitata dalla controparte' };
  if (Number(sede.host_organization_id) !== Number(orgId)) return { stato: 'CONFLITTO', testo: `La sede è ospitata da un'altra Legal entity (${sede.host_name || `#${sede.host_organization_id}`}): decisione del CEO, nessuna modifica automatica` };
  return { stato: 'DA_IMPOSTARE', testo: `Ospitante uguale alla controparte ma titolo ${sede.tenure}: alla firma diventa Ospitata` };
}

const caricaContratto = (id) => one(`SELECT c.id, c.kind, c.status, c.protocol, c.org_id, c.site_id, c.end_date, o.name AS org_name FROM contracts c LEFT JOIN public.organizations o ON o.id=c.org_id WHERE c.id=$1`, [id]);
const caricaSede = (id) => one(`SELECT s.id, s.code, s.name, s.tenure, s.host_organization_id, s.active, ho.name AS host_name FROM public.sites s LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id WHERE s.id=$1`, [id]);

/**
 * Alla firma del contratto PP: allinea la sede (decisione 2). opts: { req, userId }.
 * Ritorna { esito: 'COERENTE' | 'IMPOSTATA' | 'CONFLITTO' | 'SENZA_SEDE' | 'NON_PP', avviso?, perimetri? }.
 */
export async function allineaSedeAllaFirma(contractId, { req = null, userId = null } = {}) {
  const c = await caricaContratto(contractId);
  if (!c || c.kind !== 'PP') return { esito: 'NON_PP' };
  if (!c.org_id) return { esito: 'SENZA_CONTROPARTE', avviso: 'Contratto PP senza controparte: la sede non si aggiorna' };
  const sede = c.site_id ? await caricaSede(c.site_id) : null;
  const co = coerenzaPP({ sede, orgId: c.org_id });
  if (co.stato === 'OK') return { esito: 'COERENTE', royalty: await notaRoyalty(c, sede.id, userId) };
  if (co.stato === 'SENZA_SEDE') { await evento(c.id, 'SEDE_AVVISO', userId, co.testo); return { esito: 'SENZA_SEDE', avviso: co.testo }; }
  if (co.stato === 'CONFLITTO') {
    await evento(c.id, 'SEDE_AVVISO', userId, `Firma: ${co.testo}`, { site_id: sede.id, host_organization_id: sede.host_organization_id, controparte: c.org_id });
    return { esito: 'CONFLITTO', avviso: `${sede.name}: ${co.testo}` };
  }
  const s = await saveSite({ id: sede.id, data: { tenure: 'OSPITATA', host_organization_id: c.org_id }, origine: `Business Hub, firma del contratto PP ${c.protocol || `#${c.id}`}`, req, actorId: req ? null : await suiteIdDi(userId) });
  await evento(c.id, 'SEDE_ALLINEATA', userId, `Sede ${sede.name} (${sede.code}) impostata in Amministrazione > Sedi come Ospitata da ${c.org_name}`, { site_id: sede.id, prima: { tenure: sede.tenure, host_organization_id: sede.host_organization_id }, perimetri: s.perimetri });
  const royalty = await notaRoyalty(c, sede.id, userId);
  return { esito: 'IMPOSTATA', perimetri: s.perimetri, avviso: null, royalty };
}

/**
 * Al contratto PP CESSATO: se non è rinnovato (nessun altro contratto PP non annullato né cessato sulla stessa sede) la sede si chiude
 * (active=false, closed_at = data di cessazione) e si registra il quadro d'impatto. ANNULLATO: nessuna modifica (solo avviso).
 */
export async function chiudiSedeAllaCessazione(contractId, { req = null, userId = null } = {}) {
  const c = await caricaContratto(contractId);
  if (!c || c.kind !== 'PP' || !c.site_id) return { esito: 'NON_APPLICABILE' };
  if (c.status !== 'CESSATO') return { esito: 'NON_CESSATO' };
  const sede = await caricaSede(c.site_id);
  if (!sede) return { esito: 'SENZA_SEDE' };
  const rinnovo = await one(`SELECT id, protocol, status FROM contracts WHERE kind='PP' AND site_id=$1 AND id<>$2 AND status NOT IN ('ANNULLATO','CESSATO') ORDER BY id DESC LIMIT 1`, [c.site_id, c.id]);
  if (rinnovo) {
    await evento(c.id, 'SEDE_AVVISO', userId, `Cessazione: la sede ${sede.name} resta aperta perché c'è il contratto ${rinnovo.protocol || `#${rinnovo.id}`} (${rinnovo.status.toLowerCase()})`);
    return { esito: 'RINNOVATO', rinnovo };
  }
  if (!sede.active) return { esito: 'GIA_CHIUSA' };
  const data = String(c.end_date || todayRome()).slice(0, 10);
  const s = await saveSite({ id: sede.id, data: { active: false, closed_at: data }, origine: `Business Hub, contratto PP ${c.protocol || `#${c.id}`} cessato e non rinnovato`, req, actorId: req ? null : await suiteIdDi(userId) });
  await evento(c.id, 'SEDE_CHIUSA', userId, `Sede ${sede.name} (${sede.code}) chiusa in Amministrazione > Sedi dal ${data}${s.impatto?.voci?.length ? `. Restano collegati: ${s.impatto.voci.join('; ')}` : ''}`, { site_id: sede.id, impatto: s.impatto });
  return { esito: 'CHIUSA', impatto: s.impatto, closed_at: data };
}

/** Dopo un cambio di stato del contratto: firma → allinea, cessazione → chiudi. Non blocca mai il chiamante. */
export async function dopoCambioStato(contractId, nuovoStato, opts = {}) {
  try {
    if (VIGENTI.includes(nuovoStato)) return { sede: await allineaSedeAllaFirma(contractId, opts) };
    if (nuovoStato === 'CESSATO') return { sede: await chiudiSedeAllaCessazione(contractId, opts) };
  } catch (e) { console.warn('[business] contratto PP e Sedi:', contractId, e.message); return { sede: { esito: 'ERRORE', avviso: e.message } }; }
  return {};
}

/** Alla creazione: solo verifica, per l'avviso nella risposta. */
export async function verificaSedePP(orgId, siteId) {
  const sede = siteId ? await caricaSede(siteId) : null;
  return coerenzaPP({ sede, orgId });
}

/**
 * B1 (08/11/2026): la data di avvio effettiva del punto prelievi è l'apertura della sede (public.sites.opened_at). Si scrive con saveSite
 * solo se la sede non ha ancora una data di apertura; se ne ha un'altra resta quella dell'anagrafica (avviso: decide Amministrazione).
 * Ritorna { esito: 'SCRITTA' | 'GIA_ALLINEATA' | 'DIVERSA' | 'SENZA_SEDE', avviso? }.
 */
export async function dataAvvioInSede(siteId, data, { req = null, userId = null } = {}) {
  if (!siteId || !data) return { esito: 'SENZA_SEDE' };
  const s = await one('SELECT id, code, name, opened_at FROM public.sites WHERE id=$1', [siteId]);
  if (!s) return { esito: 'SENZA_SEDE' };
  const cur = s.opened_at ? String(s.opened_at).slice(0, 10) : null;
  const d = String(data).slice(0, 10);
  if (cur === d) return { esito: 'GIA_ALLINEATA' };
  if (cur) return { esito: 'DIVERSA', avviso: `La sede ${s.code} ha già la data di apertura ${cur.split('-').reverse().join('/')} in Amministrazione > Sedi: resta quella (la data di avvio del punto la segue)` };
  await saveSite({ id: s.id, data: { opened_at: d }, origine: 'Business Hub, data di avvio effettiva del punto prelievi', req, actorId: req ? null : await suiteIdDi(userId) });
  return { esito: 'SCRITTA' };
}
