// Business Hub · contratto firmato ricevuto (richiesta del CEO del 06/11/2026): "Il widget rimane in ascolto e lo salva nel fascicolo del
// cliente. E questo aggiorna la pipeline, gli offre il portale service (prima no!) e gli altri widget dedicati al cliente [...]. Appena
// ricevuto il contratto firmato, il widget da service@ invia mail a francesco.epifani@ e rosetta.greco@ di avvenuta contrattualizzazione
// del cliente. Subito dopo il cliente riceve una mail di ringraziamento e di benvenuto nella community [...]. Successivamente il widget
// scrive a laboratorio@ e valentina.zezza@ per informarli del nuovo cliente contrattualizzato, dei volumi giornalieri attesi, della data
// di partenza."
// Un solo passaggio, idempotente (contrattualizzato_at): contratto del modulo FIRMATO con il PDF, pipeline alla fase 6, profilo Cliente
// service sugli accessi esterni della Legal entity (con invito a chi non è mai entrato), email interna, benvenuto al cliente, email al
// laboratorio. Mittente sempre la casella della linea, copie fisse, tutto nel diario e nel registro invii. La fase 7 la conferma il CEO.
// Linea Punti Prelievo (06/11/2026): stessa parte comune (contratto FIRMATO, fascicolo, fase 6), poi l'avvio del punto prelievi in passi
// registrati (lib/puntoPrelievi.js: credenziali al partner con il profilo Partner ospitante, conferma interna, laboratorio, primo ordine,
// dotazione, fondo cassa e POS, rifiuti speciali).
import { one, many, q } from '../db.js';
import { applyProfile } from '../../../lib/accessProfiles.js';
import { systemProfile, PROFILO_CLIENTE, PROFILO_PARTNER, hostedSiteIds } from '../../../lib/esterni.js';
import { notify } from '../../../lib/community.js';
import { getSettings } from './rules.js';
import { indirizzi } from './hub.js';
import { inviaAlCliente } from './caselle.js';
import { storeBuffer, readBuffer } from './storage.js';
import { versioneCorrente } from './listino.js';
import { todayRome } from './util.js';
import { compila, volumiGiornalieri, referentiTesto, accessiPerTutti } from './processo.js';
import { offertaDi, modelliFlusso, suiteUrl, referentiPerLinea } from './pacchettoGenera.js';
import { attivita, avanzaFase, accessiEsterni, referentePrincipale, creaAccesso, invitaAccesso, creaAccessiReferenti } from './flusso.js';
import { dataBreve } from './pacchetto.js';

// Profilo di sistema degli accessi esterni per linea: Service → Cliente service; Punti Prelievo → Partner ospitante (royalties in Cash)
export const PROFILO_LINEA = { SRV: { key: PROFILO_CLIENTE, label: 'Cliente service' }, PP: { key: PROFILO_PARTNER, label: 'Partner ospitante' } };

/** Profilo di sistema della linea su alcuni accessi (accessi creati dopo la contrattualizzazione): nessun invito, l'hanno appena ricevuto. */
export async function profiloLineaSu(a, userIds = []) {
  if (!userIds.length) return { aggiunti: 0, avvisi: [] };
  const pl = PROFILO_LINEA[a.linea] || PROFILO_LINEA.SRV;
  const prof = await systemProfile(pl.key);
  if (!prof) return { aggiunti: 0, avvisi: [`Profilo di sistema ${pl.label} non trovato`] };
  const rep = await applyProfile(prof.id, userIds, { actorId: null, mode: 'merge' });
  return { aggiunti: rep.added + rep.updated, avvisi: rep.warnings.slice(0, 10), profilo: pl.label };
}

/** Attivazione dei widget: profilo di sistema della linea sugli accessi esterni della Legal entity, invito a chi non è mai entrato. */
export async function attivaAccessi(a, { userId = null } = {}) {
  const out = { accessi: 0, aggiunti: 0, inviti: [], avvisi: [], creato: null };
  const pl = PROFILO_LINEA[a.linea] || PROFILO_LINEA.SRV;
  let utenti = await accessiEsterni(a.organization_id);
  // accessi al portale per tutti i referenti con email (richiesta del CEO del 07/11/2026; impostazione hub_accessi_portale): idempotente,
  // chi ha già l'accesso resta com'è; ognuno dei nuovi riceve l'invito con la password provvisoria (e non un secondo invito qui sotto)
  const creati = new Set();
  if (accessiPerTutti(await getSettings())) {
    const t = await creaAccessiReferenti(a, { attivo: a.linea === 'PP', userId });
    for (const r of t.righe) {
      if (r.esito === 'CREATO') { creati.add(r.user_id); if (r.invito) out.inviti.push({ email: r.email, stato: r.invito }); } else if (r.esito === 'ERRORE') out.avvisi.push(`Accesso per ${r.email} non creato: ${r.motivo}`);
    }
    if (creati.size) { out.creato = [...creati][0]; utenti = await accessiEsterni(a.organization_id); }
  }
  if (!utenti.length) {
    const ref = await referentePrincipale(a.id);
    if (!ref?.email) { out.avvisi.push(`Nessun accesso esterno e nessun referente con email: ${a.linea === 'PP' ? 'aggiungi il referente del partner (scheda Referenti)' : 'crea l\'accesso dalla scheda "Kit e contrattualizzazione"'}`); return out; }
    // l'accesso appena creato riceve già l'invito con la password provvisoria: non si invita una seconda volta qui sotto
    try { const c = await creaAccesso(a, ref, { userId, attivo: a.linea === 'PP' }); out.creato = c.user_id; if (c.invito) out.inviti.push({ email: c.email, stato: c.invito }); utenti = await accessiEsterni(a.organization_id); } catch (e) { out.avvisi.push(`Accesso non creato: ${e.message}`); return out; }
  }
  const prof = await systemProfile(pl.key);
  if (!prof) { out.avvisi.push(`Profilo di sistema ${pl.label} non trovato`); return out; }
  const rep = await applyProfile(prof.id, utenti.map((u) => u.id), { actorId: null, mode: 'merge' });
  out.accessi = rep.users; out.aggiunti = rep.added + rep.updated;
  out.avvisi.push(...rep.warnings.slice(0, 10));
  if (a.linea === 'PP') {
    if (!(await hostedSiteIds(a.organization_id)).length) out.avvisi.push('La Legal entity non ospita ancora nessun punto prelievi in anagrafica: le royalties in Cash restano senza sede finché la sede non viene creata con la Legal entity ospitante (Amministrazione > Sedi); al collegamento della sede il perimetro si riallinea da solo');
  } else {
    const sedi = await one(`SELECT count(*)::int AS n FROM public.sites WHERE organization_id=$1 AND kind='SERVICE' AND active`, [a.organization_id]);
    if (!sedi.n) out.avvisi.push('La Legal entity non ha ancora una sede SERVICE in anagrafica: "Il mio spazio", Non conformità e Ordini restano senza ambito finché non la crei (Amministrazione > Sedi, tipo Service) e premi "Riallinea perimetri" nella Legal entity');
  }
  for (const u of utenti) {
    if (u.last_login_at || u.id === out.creato || creati.has(u.id)) continue;
    const inv = await invitaAccesso(a, u, { attivo: true, userId });
    out.inviti.push({ email: u.email, stato: inv.stato });
  }
  out.utenti = utenti.map((u) => ({ id: u.id, nome: u.full_name, email: u.email }));
  await attivita(a.id, { tipo: 'ATTIVAZIONE', oggetto: `Servizi della Suite attivati: profilo ${pl.label} su ${out.accessi} accessi`,
    testo: [`${a.linea === 'PP' ? 'Cash Management (royalties delle sedi ospitate, sola visualizzazione) e gli altri servizi del profilo' : 'Portale Service, SGI, Non conformità, Ordini, Circolari, Rubrica e Ticket'} per: ${out.utenti.map((u) => u.email).join(', ')}.`, `Widget aggiunti o aggiornati: ${out.aggiunti}.`,
      out.inviti.length ? `Invito con nuova password provvisoria a chi non era ancora entrato: ${out.inviti.map((x) => `${x.email} (${x.stato.toLowerCase()})`).join(', ')}.` : null,
      out.avvisi.length ? `Avvisi: ${out.avvisi.join(' · ')}` : null].filter(Boolean).join('\n'), dati: { profilo: pl.key, utenti: out.utenti.map((u) => u.id) } }, userId);
  return out;
}

/**
 * Contratto della linea: FIRMATO (da BOZZA o PROPOSTA) con la data e il PDF firmato tra i suoi file. contrattoId: il contratto scelto
 * (caricamento dalla scheda Contratto), altrimenti quello della linea (offertaDi: il più recente non annullato né cessato).
 */
export async function firmaContratto(a, doc, data, fonte, userId, contrattoId = null) {
  const contratto = contrattoId
    ? await one('SELECT id, protocol, status, version FROM contracts WHERE id=$1 AND org_id=$2 AND kind=$3', [contrattoId, a.organization_id, a.linea])
    : (await offertaDi(a)).contratto;
  if (!contratto) return { esito: 'nessun contratto della linea: crea la proposta in Contratti e carica il PDF firmato' };
  const buf = await readBuffer(doc);
  const st = await storeBuffer('contratti', doc.filename, 'application/pdf', buf);
  await q('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, blob_path, version, uploaded_by) VALUES ($1,\'FIRMATO\',$2,\'application/pdf\',$3,$4,$5,$6,$7,$8)',
    [contratto.id, doc.filename, st.size, st.sha256, st.data, st.blob_path, contratto.version, userId]);
  const r = await q(`UPDATE contracts SET status='FIRMATO', signed_at=$2, updated_at=now() WHERE id=$1 AND status IN ('BOZZA','PROPOSTA')`, [contratto.id, data]);
  await q('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [contratto.id, r.rowCount ? 'FIRMATO' : 'ALLEGATO', userId,
    r.rowCount ? `Contratto sottoscritto il ${dataBreve(data)}: PDF firmato ricevuto dal Business Hub (${fonte})` : `PDF firmato ricevuto dal Business Hub (${fonte})`, JSON.stringify({ documento_id: doc.id })]);
  return { id: contratto.id, protocol: contratto.protocol, stato_prima: contratto.status, esito: r.rowCount ? 'FIRMATO' : `già ${contratto.status.toLowerCase()}: PDF aggiunto` };
}

/**
 * Contrattualizzazione dell'account. Idempotente: alla seconda volta il PDF va nel contratto e nel diario, le comunicazioni non ripartono.
 * opz: { documentoId (PDF firmato tra i documenti dell'account), fonte ('form online'|'email'|'caricamento'|'scheda Contratto'), userId,
 * data, contrattoId (il contratto su cui si è caricato il PDF dalla scheda Contratto; senza, quello della linea) }.
 * Una sola strada (07/11/2026): form online, casella, "Carica il PDF firmato" della scheda Kit e contrattualizzazione e "Carica firmato"
 * della scheda Contratto (routes/contracts.js, linee Service e Punti Prelievo) passano tutti da qui.
 */
export async function contrattualizza(accountId, { documentoId, fonte = 'form online', userId = null, data = null, contrattoId = null } = {}) {
  const { loadAccount } = await import('../routes/hub.js');
  const a = await loadAccount(accountId);
  const doc = await one('SELECT * FROM documenti WHERE id=$1 AND account_id=$2', [documentoId, a.id]);
  if (!doc) throw Object.assign(new Error('Documento del contratto non trovato'), { status: 404 });
  const giorno = data || todayRome();
  const presa = await one('UPDATE accounts SET contrattualizzato_at=now(), updated_at=now() WHERE id=$1 AND contrattualizzato_at IS NULL RETURNING contrattualizzato_at', [a.id]);
  const contratto = await firmaContratto(a, doc, giorno, fonte, userId, contrattoId);
  if (!presa) {
    await attivita(a.id, { tipo: 'CONTRATTO_FIRMATO', oggetto: `Contratto firmato ricevuto di nuovo (${fonte})`, testo: `Il cliente risulta già contrattualizzato: il PDF è nel fascicolo e nel contratto (${contratto.esito}); le comunicazioni non ripartono.`, dati: { documento_id: doc.id } }, userId);
    return { gia: true, contratto };
  }
  const avvisi = [];
  await attivita(a.id, { tipo: 'CONTRATTO_FIRMATO', oggetto: `Contratto firmato ricevuto (${fonte})`, testo: `${doc.filename} nel fascicolo del cliente. Contratto del modulo: ${contratto.protocol ? `${contratto.protocol}, ` : ''}${contratto.esito}.`, dati: { documento_id: doc.id, contratto_id: contratto.id || null } }, userId);
  if (!contratto.id) avvisi.push(contratto.esito);
  const fase = await avanzaFase(a.id, 6, giorno, `Contratto firmato ricevuto (${fonte}).`, userId);
  if (a.linea === 'PP') {
    // Punti Prelievo: contratto nel fascicolo di autorizzazione della sede (disponibilità dei locali) e avvio del punto in passi registrati
    const pp = await import('./puntoPrelievi.js');
    // A1 (decisione 2 del CEO): alla firma la sede del contratto diventa Ospitata dalla controparte se non ha ospitante (avviso se ne ha un'altra)
    if (contratto.id) {
      const { allineaSedeAllaFirma } = await import('./contrattoSede.js');
      const al = await allineaSedeAllaFirma(contratto.id, { userId }).catch((e) => ({ esito: 'ERRORE', avviso: e.message }));
      if (al.avviso) avvisi.push(al.avviso);
    }
    const fascicolo = await pp.contrattoNelFascicolo(a, doc, contratto, userId).catch((e) => ({ esito: `non aggiunto al fascicolo: ${e.message}` }));
    const avvio = await pp.avviaPuntoPrelievi(a.id, { fonte, userId, documentoId: doc.id });
    const esito = { at: new Date().toISOString(), fonte, documento_id: doc.id, contratto, fase, fascicolo, avvio: avvio.riepilogo, avvisi: [...avvisi, ...(avvio.avvisi || [])] };
    await q('UPDATE accounts SET contrattualizzazione=$2, prospect=FALSE, updated_at=now() WHERE id=$1', [a.id, JSON.stringify(esito)]);
    const fr = await loadAccount(a.id);
    if (fr.owner_user_id) await notify([fr.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `${a.org_name}: contratto del punto prelievi firmato`.slice(0, 200), body: `Pipeline alla fase 6, avvio del punto prelievi: ${avvio.riepilogo.fatti} passi su ${avvio.riepilogo.previsti} fatti.`, link: `/business/account/${a.id}?scheda=punto` }).catch(() => 0);
    console.log(`[business] contratto punto prelievi account ${a.id}: avvio ${avvio.riepilogo.fatti}/${avvio.riepilogo.previsti}`);
    return esito;
  }
  // A7 (decisione 5): sede SERVICE del cliente creata dalla contrattualizzazione (prima solo un avviso), prima dell'attivazione
  // degli accessi: saveSite riallinea i perimetri e "Il mio spazio", NC e Ordini hanno subito il loro ambito
  const sede = await sedeServiceAllaFirma(a, { contrattoId: contratto.id || null, userId, fonte });
  avvisi.push(...sede.avvisi);
  const attivazione = await attivaAccessi(a, { userId });
  avvisi.push(...attivazione.avvisi);

  // ---- comunicazioni
  const [s, mod, ref, refs] = await Promise.all([getSettings(), modelliFlusso(), referentePrincipale(a.id), referentiPerLinea(a)]);
  const vers = await many('SELECT id, versione, riepilogo, caricato_at, offerta_documento_id FROM listini WHERE account_id=$1', [a.id]);
  const lst = versioneCorrente(vers, a.listino_corrente_id);
  const fresco = await loadAccount(a.id);
  const own = fresco.owner_user_id ? await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS nome FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [fresco.owner_user_id]) : null;
  const vg = volumiGiornalieri(fresco, s.hub_giorni_lavorativi);
  const valori = {
    cliente: a.org_name, data: dataBreve(giorno), fonte, referente: ref?.nome || 'Cliente',
    referente_dettaglio: ref ? [ref.nome + (ref.ruolo ? ` (${ref.ruolo})` : ''), ref.email, ref.telefono].filter(Boolean).join(' · ') : '',
    listino: lst ? `versione ${lst.versione}${lst.caricato_at ? ` del ${dataBreve(new Date(lst.caricato_at).toISOString())}` : ''} (${lst.riepilogo?.esami} esami, sconto medio ${lst.riepilogo?.sconto_medio}%)` : '',
    volumi_giornalieri: vg.testo, data_avvio: fresco.data_avvio_prevista ? dataBreve(String(fresco.data_avvio_prevista).slice(0, 10)) : 'da definire (campo "Data di avvio prevista" della scheda account)',
    link_scheda: `${suiteUrl()}/business/account/${a.id}`, suite_url: suiteUrl(),
    accessi: (attivazione.utenti || []).map((u) => `${u.nome} (${u.email})`).join(', '), referenti: referentiTesto(refs), owner: own?.nome || 'Il team commerciale',
  };
  const email = {};
  const invia = async (chiave, to, sottotipo, allegati = []) => {
    if (!to.length) { avvisi.push(`${chiave}: nessun destinatario`); email[chiave] = { stato: 'NON_INVIATA' }; return; }
    const out = await inviaAlCliente({ account: a, to, subject: compila(mod[`${chiave}_oggetto`], valori), testo: compila(mod[`${chiave}_testo`], valori), allegati, userId, sottotipo, contattoId: chiave === 'benvenuto' ? ref?.id || null : null, dati: { contrattualizzazione: true } });
    email[chiave] = { stato: out.stato, to: out.to, cc: out.cc, activity_id: out.activity_id, errore: out.errore || undefined };
  };
  const pdfFirmato = { filename: doc.filename, content: await readBuffer(doc), contentType: 'application/pdf', ref: `documento:${doc.id}` };
  await invia('interna', indirizzi(s.hub_dest_contrattualizzazione), 'CONTRATTUALIZZAZIONE', [pdfFirmato]);
  const cliente = ref?.email ? [ref.email] : indirizzi([fresco.org_email].filter(Boolean));
  await invia('benvenuto', cliente, 'BENVENUTO');
  const offPdf = lst?.offerta_documento_id ? await one('SELECT id, filename, mime, data, blob_path FROM documenti WHERE id=$1', [lst.offerta_documento_id]) : null;
  await invia('laboratorio', indirizzi(s.hub_dest_laboratorio), 'NUOVO_CLIENTE_LAB', offPdf ? [{ filename: offPdf.filename, content: await readBuffer(offPdf), contentType: 'application/pdf', ref: `documento:${offPdf.id}` }] : []);
  if (vg.fonte !== 'campo') avvisi.push(`Volumi giornalieri ${vg.fonte === 'calcolo' ? 'calcolati dal volume annuo atteso' : 'non indicati'}: compila "Volumi giornalieri attesi" nella scheda account`);
  if (!fresco.data_avvio_prevista) avvisi.push('Data di avvio prevista non indicata nella scheda account');

  const esito = { at: new Date().toISOString(), fonte, documento_id: doc.id, contratto, fase, sede_service: sede.site ? { id: sede.site.id, code: sede.site.code, esito: sede.esito } : null, attivazione: { accessi: attivazione.accessi, aggiunti: attivazione.aggiunti, inviti: attivazione.inviti }, email, avvisi };
  await q('UPDATE accounts SET contrattualizzazione=$2, prospect=FALSE, updated_at=now() WHERE id=$1', [a.id, JSON.stringify(esito)]);
  if (fresco.owner_user_id) await notify([fresco.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `${a.org_name}: contratto firmato`.slice(0, 200), body: 'Pipeline alla fase 6, comunicazioni inviate, servizi della Suite attivati.', link: `/business/account/${a.id}` }).catch(() => 0);
  console.log(`[business] contrattualizzazione account ${a.id}: interna ${email.interna?.stato}, benvenuto ${email.benvenuto?.stato}, laboratorio ${email.laboratorio?.stato}, ${attivazione.accessi} accessi attivati`);
  return esito;
}

/**
 * A7: sede SERVICE del cliente alla contrattualizzazione (Service e Medicina del Lavoro) con saveSite (lib/clienti.js creaSedeService):
 * nome = ragione sociale, indirizzo del contratto se indicato altrimenti della Legal entity, orari di ritiro dal contratto, codice
 * StudioLAB se già inserito nell'account. Idempotente: se la Legal entity ha già una sede SERVICE attiva non crea nulla.
 * Ritorna { esito: 'creata'|'esistente'|'errore', site?, avvisi }.
 */
export async function sedeServiceAllaFirma(a, { contrattoId = null, userId = null, fonte = 'contrattualizzazione' } = {}) {
  const { creaSedeService } = await import('../../../lib/clienti.js');
  try {
    const r = await creaSedeService({ orgId: a.organization_id, linea: a.linea, contrattoId, origine: `Business Hub, contrattualizzazione ${a.linea} (${fonte})`, actorId: userId });
    if (r.esito === 'creata') {
      await attivita(a.id, { tipo: 'SISTEMA', oggetto: `Sede SERVICE creata in anagrafica: ${r.site.code}`,
        testo: [`${r.site.name}${r.site.address ? `, ${[r.site.address, r.site.city].filter(Boolean).join(' ')}` : ''}${r.site.address_from_org ? ' (indirizzo della Legal entity)' : ''}.`,
          r.site.studiolab_code ? `Codice StudioLAB: ${r.site.studiolab_code}.` : 'Codice StudioLAB da inserire nella scheda account (campo "Codice StudioLAB").'].join('\n'),
        dati: { site_id: r.site.id } }, userId);
    }
    return r;
  } catch (e) {
    console.warn(`[business] sede SERVICE account ${a.id}: ${e.message}`);
    return { esito: 'errore', avvisi: [`Sede SERVICE non creata: ${e.message} (Amministrazione > Diagnostica anagrafica, D13)`] };
  }
}

/**
 * A5: contratto Service o Medicina del Lavoro FIRMATO o ATTIVO (caricamento del firmato senza account, cambio di stato) → account
 * coerente: prospect FALSE, fase almeno 6, sede SERVICE. Per la Medicina del Lavoro la firma è la contrattualizzazione
 * (contrattualizzato_at, una volta sola): niente comunicazioni automatiche né profili degli accessi (non previsti per la linea).
 * Per il Service contrattualizzato_at resta della contrattualizzazione con il PDF firmato (lib/contrattualizza.js), che manda le email.
 * Ritorna null se il contratto non c'entra, altrimenti { account_id, fase, contrattualizzato, sede, avvisi }.
 */
export async function allineaAccountAlContratto(contrattoId, { userId = null, fonte = 'cambio di stato del contratto' } = {}) {
  const c = await one('SELECT id, kind, status, org_id, protocol, signed_at FROM contracts WHERE id=$1', [contrattoId]);
  if (!c || !['SRV', 'MDL'].includes(c.kind) || !['FIRMATO', 'ATTIVO'].includes(c.status) || !c.org_id) return null;
  const { loadAccount } = await import('../routes/hub.js');
  const acc = await one('SELECT id FROM accounts WHERE organization_id=$1 AND linea=$2', [c.org_id, c.kind]);
  if (!acc) return { account_id: null, avvisi: ['Nessun account del Business Hub per questa Legal entity e linea: la sede SERVICE si crea dalla Diagnostica anagrafica (D13)'] };
  const a = await loadAccount(acc.id);
  const giorno = c.signed_at ? String(c.signed_at instanceof Date ? c.signed_at.toISOString() : c.signed_at).slice(0, 10) : todayRome();
  const presa = c.kind === 'MDL'
    ? await one(`UPDATE accounts SET contrattualizzato_at=coalesce($2::date::timestamptz, now()), prospect=FALSE, updated_at=now() WHERE id=$1 AND contrattualizzato_at IS NULL RETURNING id`, [a.id, c.signed_at])
    : null;
  await q('UPDATE accounts SET prospect=FALSE, updated_at=now() WHERE id=$1 AND prospect', [a.id]);
  if (presa) await attivita(a.id, { tipo: 'CONTRATTO_FIRMATO', oggetto: `Contratto Medicina del Lavoro ${c.protocol || `#${c.id}`} ${c.status.toLowerCase()} (${fonte})`, testo: 'Cliente contrattualizzato: compare tra i clienti della Suite (Ordini, Non conformità, Portale, Circolari). La fase 7 la conferma il CEO.', dati: { contratto_id: c.id } }, userId);
  const fase = await avanzaFase(a.id, 6, giorno, `Contratto ${c.protocol || `#${c.id}`} ${c.status.toLowerCase()} (${fonte}).`, userId);
  const sede = await sedeServiceAllaFirma(a, { contrattoId: c.id, userId, fonte });
  return { account_id: a.id, fase, contrattualizzato: Boolean(presa), sede: sede.site ? { id: sede.site.id, code: sede.site.code, esito: sede.esito } : null, avvisi: sede.avvisi };
}

/**
 * Correzione D12 della Diagnostica anagrafica (A5): account con contratto della linea vigente ma ancora prospect, sotto la fase 6 o
 * senza data di contrattualizzazione → contrattualizzato alla data della firma, prospect FALSE, fase 6, sede SERVICE (Service e MdL).
 * Nessuna comunicazione automatica (email interna, benvenuto, laboratorio): si registra nel diario che sono state saltate.
 */
export async function contrattualizzatoDaDiagnostica(accountId, { userId = null } = {}) {
  const a = await one('SELECT id, organization_id, linea FROM accounts WHERE id=$1', [accountId]);
  if (!a) return { esito: 'account inesistente' };
  const c = await one(`SELECT id, protocol, status, signed_at FROM contracts WHERE org_id=$1 AND kind=$2 AND status IN ('FIRMATO','AUTORIZZATO','ATTIVO') ORDER BY signed_at NULLS LAST, id LIMIT 1`, [a.organization_id, a.linea]);
  if (!c) return { esito: 'nessun contratto vigente della linea' };
  const presa = await one(`UPDATE accounts SET contrattualizzato_at=coalesce($2::date::timestamptz, now()), prospect=FALSE, updated_at=now() WHERE id=$1 AND contrattualizzato_at IS NULL RETURNING id`, [a.id, c.signed_at]);
  await q('UPDATE accounts SET prospect=FALSE, updated_at=now() WHERE id=$1 AND prospect', [a.id]);
  const giorno = c.signed_at ? String(c.signed_at instanceof Date ? c.signed_at.toISOString() : c.signed_at).slice(0, 10) : todayRome();
  const fase = await avanzaFase(a.id, 6, giorno, `Contratto ${c.protocol || `#${c.id}`} ${c.status.toLowerCase()} (Diagnostica anagrafica, D12).`, userId);
  if (presa) await attivita(a.id, { tipo: 'SISTEMA', oggetto: 'Contrattualizzazione registrata dalla Diagnostica anagrafica (D12)', testo: `Contratto ${c.protocol || `#${c.id}`} ${c.status.toLowerCase()}: cliente contrattualizzato alla data della firma. Le comunicazioni automatiche della contrattualizzazione non sono state inviate.`, dati: { contratto_id: c.id } }, userId);
  let sede = null;
  if (['SRV', 'MDL'].includes(a.linea)) {
    const { loadAccount } = await import('../routes/hub.js');
    sede = await sedeServiceAllaFirma(await loadAccount(a.id), { contrattoId: c.id, userId, fonte: 'Diagnostica anagrafica D12' });
  }
  return { esito: `contrattualizzato${presa ? '' : ' (data già presente)'}, fase ${fase ?? 'invariata'}${sede?.site ? `, sede SERVICE ${sede.site.code} ${sede.esito}` : ''}`, avvisi: sede?.avvisi || [] };
}

/**
 * Ogni contratto Service o Medicina del Lavoro con controparte ha il suo account nella sezione della linea ("Come mai figurano in tutti
 * i contratti e non nella sezione Medicina del Lavoro???", CEO 08/11/2026; regola del 07/11: tutti i dati dei contratti finiscono nelle
 * schede dei clienti). Se l'account manca lo crea (prospect) e porta la fase allo stato del contratto: BOZZA → fase 3, PROPOSTA →
 * fase 4 (offerta inviata) alla data della proposta, FIRMATO/ATTIVO → allineaAccountAlContratto (fase 6, sede SERVICE). Mai indietro.
 * Ritorna null se il contratto non c'entra, altrimenti { account_id, creato, fase }.
 */
export async function accountDaContratto(contrattoId, { userId = null, fonte = 'contratto' } = {}) {
  const c = await one('SELECT id, kind, status, org_id, protocol, proposal_date, created_at FROM contracts WHERE id=$1', [contrattoId]);
  if (!c || !['SRV', 'MDL'].includes(c.kind) || !c.org_id || c.status === 'ANNULLATO') return null;
  let acc = await one('SELECT id FROM accounts WHERE organization_id=$1 AND linea=$2', [c.org_id, c.kind]);
  let creato = false;
  if (!acc) {
    acc = await one(`INSERT INTO accounts (organization_id, linea, prospect, created_by) VALUES ($1,$2,TRUE,$3) RETURNING id`, [c.org_id, c.kind, userId]);
    creato = true;
    await attivita(acc.id, { tipo: 'SISTEMA', oggetto: `Scheda creata dal contratto ${c.protocol || `#${c.id}`}`, testo: `Account della linea creato automaticamente perché il contratto esisteva senza scheda (${fonte}).`, dati: { contratto_id: c.id } }, userId);
  }
  const giorno = (c.proposal_date ? String(c.proposal_date instanceof Date ? c.proposal_date.toISOString() : c.proposal_date) : String(c.created_at?.toISOString?.() || todayRome())).slice(0, 10);
  let fase = null;
  if (['FIRMATO', 'ATTIVO', 'CESSATO'].includes(c.status)) {
    const r = await allineaAccountAlContratto(c.id, { userId, fonte });
    fase = r?.fase ?? null;
  } else if (c.status === 'PROPOSTA') fase = await avanzaFase(acc.id, 4, giorno, `Proposta ${c.protocol || `#${c.id}`} inviata (${fonte}).`, userId);
  else if (c.status === 'BOZZA') fase = await avanzaFase(acc.id, 3, giorno, `Proposta ${c.protocol || `#${c.id}`} in preparazione (${fonte}).`, userId);
  return { account_id: acc.id, creato, fase };
}

/** Tutti i contratti SRV/MDL con controparte senza account della linea: rapporto (esegui=false) o creazione. */
export async function contrattiSenzaAccount({ esegui = false, userId = null } = {}) {
  const rows = await many(`SELECT c.id, c.kind, c.status, c.protocol, c.org_id, o.name AS org_name FROM contracts c JOIN public.organizations o ON o.id=c.org_id
    WHERE c.kind IN ('SRV','MDL') AND c.status <> 'ANNULLATO' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.organization_id=c.org_id AND a.linea=c.kind) ORDER BY c.kind, o.name`);
  if (!esegui) return rows;
  const out = [];
  for (const r of rows) {
    try { const x = await accountDaContratto(r.id, { userId, fonte: 'Diagnostica anagrafica' }); out.push({ id: r.id, esito: x ? `scheda ${x.creato ? 'creata' : 'esistente'} #${x.account_id}${x.fase ? `, fase ${x.fase}` : ''}` : 'non pertinente' }); }
    catch (e) { out.push({ id: r.id, esito: 'errore', motivo: e.message }); }
  }
  return out;
}
