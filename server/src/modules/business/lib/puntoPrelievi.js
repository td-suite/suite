// Business Hub · linea Punti Prelievo, parte operativa (richiesta del CEO del 06/11/2026): "Il processo Punti Prelievo lo vedi così:
// Anagrafica [...] flagship [...] o corner [...]. Contratto: quando il punto è in sede di terzi [...] il contratto viene inviato da network@
// alla sede che ospita il punto prelievi. Una volta firmato e ricevuto in risposta alla mail, il widget ascolta la mail e aggiorna il
// fascicolo del punto prelievi; alternativa permette l'upload del pdf [...]. Non appena caricato, il widget scrive al partner inviando le
// credenziali della suite esponendo il widget Cash [...]; scrive a francesco.epifani@ e silvia.sansoni@ [...]; a laboratorio@ e
// valentina.zezza@ per annunciare l'avvio [...]; induce in widget Ordini il primo ordine standard [...]; scrive a valentina.zezza@ per
// l'acquisto di PC fisso, ordine della stampante RICOH e il boccione culligan; a amministrazione@ per [...] il fondo cassa [...] e l'ordine
// del POS; a iacopo.cupelli@ per gli adempimenti correlati ai rifiuti speciali."
// Riusa la meccanica del processo Service (flusso.js, contrattualizza.js, caselle.js): token e form pubblica (variante PARTNER), invio
// registrato dalla casella della linea con le copie fisse, ascolto con il riferimento [TD-B2B-...], contratto firmato con un clic.
// Le regole pure (tipo del punto, passi, primo ordine, destinatari) sono in processo.js. Docs: docs/BUSINESS_HUB.md, "Processo Punti Prelievo".
// Privacy: nei log del server solo id, passi ed esiti; mai indirizzi, oggetti, testi o dati personali.
import { one, many, q } from '../db.js';
import { getCompany } from '../../../lib/company.js';
import { getModuleState } from '../../../lib/modules.js';
import { systemProfile, PROFILO_PARTNER, realignOrgPerimeters } from '../../../lib/esterni.js';
import { getSettings } from './rules.js';
import { LINEE } from './hub.js';
import { casella, ccFissi, inviaAlCliente } from './caselle.js';
import { storeBuffer, readBuffer } from './storage.js';
import { todayRome } from './util.js';
import {
  tipoPunto, prerequisitiContrattoPartner, precompilaPartner, validaPartner, SEZIONI_PARTNER, CAMPI_PARTNER, pianoAvvio, riepilogoAvvio, composizionePrimoOrdine,
  destinatariLinea, elencoDotazione, compila, referentiTesto, etichettaRif, PASSI_AVVIO_PP, STATI_PASSO, TIPI_PUNTO,
} from './processo.js';
import { offertaDi, modelliFlusso, suiteUrl, referentiPerLinea } from './pacchettoGenera.js';
import { attivita, avanzaFase, referentePrincipale, accessiEsterni, statoComune, assicuraToken, linkForm, allegatiRichiesti, salvaFile } from './flusso.js';
import { dataBreve } from './pacchetto.js';

const errore = (status, msg) => Object.assign(new Error(msg), { status });
const eur = (x) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(x));
const DOSSIER_LABEL = { IN_CORSO: 'in preparazione', PRESENTATO: 'presentato al Comune', AUTORIZZATO: 'autorizzato' };
const SOTTOTIPO_PASSO = { CREDENZIALI: 'BENVENUTO_PARTNER', CONFERMA: 'CONFERMA_PP', AVVIO_LAB: 'AVVIO_PP', DOTAZIONE: 'DOTAZIONE_PP', FONDO_CASSA: 'FONDO_CASSA_PP', RIFIUTI: 'RIFIUTI_PP' };

// ---------------------------------------------------------------- anagrafica del punto prelievi
const SEDE_COLS = `s.id, s.code, s.name, s.kind, s.tenure, s.host_organization_id, s.organization_id, s.address, s.zip, s.city, s.province, s.opening_hours, s.opened_at, s.active,
  s.lease_landlord_org_id, ho.name AS host_name, so.name AS organization_name`;
export async function sedeDi(siteId) {
  if (!siteId) return null;
  return one(`SELECT ${SEDE_COLS} FROM public.sites s LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id LEFT JOIN public.organizations so ON so.id=s.organization_id WHERE s.id=$1`, [siteId]);
}
/** Fascicolo di autorizzazione del punto: quello della sede, altrimenti quello del contratto PP. */
async function fascicoloDi(a, contrattoId = null) {
  return one(`SELECT d.id, d.status, d.submitted_at, d.authorized_at, d.authorization_ref, d.contract_id, d.site_id, coalesce(d.title, s.name) AS title FROM dossiers d LEFT JOIN public.sites s ON s.id=d.site_id
    WHERE ($1::int IS NOT NULL AND d.site_id=$1) OR ($2::int IS NOT NULL AND d.contract_id=$2) ORDER BY (d.site_id IS NOT DISTINCT FROM $1::int) DESC, d.created_at DESC LIMIT 1`, [a.pp_site_id || null, contrattoId]);
}
/** Contratto di locazione della sede (flagship): sezione SEDE dei contratti. */
async function contrattoSede(siteId) {
  if (!siteId) return null;
  return one(`SELECT id, protocol, status, title, start_date, end_date FROM contracts WHERE kind='SEDE' AND site_id=$1 AND status NOT IN ('ANNULLATO') ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [siteId]);
}
const indirizzoDi = (sede, a) => {
  const [via, cap, citta, prov] = sede ? [sede.address, sede.zip, sede.city, sede.province] : [a.org_address, a.org_zip, a.citta, a.prov];
  const luogo = [cap, citta, prov ? `(${prov})` : null].filter(Boolean).join(' ');
  return [via, luogo].filter(Boolean).join(', ');
};
export const nomePunto = (a, sede) => sede?.name || a.pp_nome || a.org_name;

/** Quadro del punto prelievi per la scheda account e per le comunicazioni. */
export async function quadroPunto(a) {
  const sede = await sedeDi(a.pp_site_id);
  const tp = tipoPunto({ sede, previsto: a.pp_tipo_previsto });
  const off = await offertaDi(a);
  const [fascicolo, locazione, ref] = await Promise.all([fascicoloDi(a, off.contratto?.id || null), contrattoSede(a.pp_site_id), referentePrincipale(a.id)]);
  const partner = tp.tipo === 'CORNER' ? (sede?.host_organization_id ? { id: sede.host_organization_id, name: sede.host_name } : { id: a.organization_id, name: a.org_name }) : null;
  if (tp.tipo === 'CORNER' && sede?.host_organization_id && Number(sede.host_organization_id) !== Number(a.organization_id)) tp.avvisi.push(`La sede è ospitata da ${sede.host_name}, non dalla Legal entity di questo account`);
  return { sede, tipo: tp, partner, contratto: off.contratto, contratto_file: off.file ? { id: off.file.id, filename: off.file.filename, size: off.file.size, version: off.file.version } : null, fascicolo, locazione, referente: ref, nome: nomePunto(a, sede), indirizzo: indirizzoDi(sede, a) };
}

/** Stato completo per la scheda "Punto prelievi" dell'account. */
export async function statoPuntoPrelievi(a) {
  const s = await getSettings();
  const p = await quadroPunto(a);
  const prereq = prerequisitiContrattoPartner({ tipo: p.tipo.tipo, contratto: p.contratto, file: p.contratto_file, referente: p.referente });
  const passi = a.pp_avvio?.passi || {};
  const piano = pianoAvvio({ tipo: p.tipo.tipo, passi, dataAvvio: a.data_avvio_effettiva, sedeId: a.pp_site_id }).map((x) => ({ ...x, ...(passi[x.key] || {}), stato: passi[x.key]?.stato || x.stato, stato_label: STATI_PASSO[passi[x.key]?.stato || x.stato] }));
  const comune = await statoComune(a, s);
  // sedi Punto prelievi non ancora collegate a un account: le ospitate da questa Legal entity prima, poi le sedi TD (flagship)
  const candidate = await many(`SELECT s.id, s.code, s.name, s.city, s.tenure, s.host_organization_id, ho.name AS host_name FROM public.sites s LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id
    WHERE s.kind='PUNTO_PRELIEVI' AND s.active AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.pp_site_id=s.id AND x.id<>$2)
    ORDER BY (s.host_organization_id=$1) DESC NULLS LAST, s.name`, [a.organization_id, a.id]);
  const accessi = await accessiEsterni(a.organization_id);
  return {
    ...p, prerequisiti: prereq, accessi, dest: destinatariLinea('PP', s), sedi_candidate: candidate,
    date: { prevista: a.data_avvio_prevista, effettiva: a.data_avvio_effettiva },
    avvio: { avviato_at: a.pp_avvio_at, fonte: a.pp_avvio?.fonte || null, piano, riepilogo: p.tipo.tipo ? riepilogoAvvio(p.tipo.tipo, passi) : null },
    ...comune, kit: comune.kit.filter((k) => k.variante === 'CONTRATTO_PARTNER'),
    gia_inviato: p.contratto_file ? comune.kit.find((k) => k.variante === 'CONTRATTO_PARTNER' && k.stato === 'INVIATO' && Number(k.contract_file_id) === Number(p.contratto_file.id)) || null : null,
    contrattualizzato_at: a.contrattualizzato_at, contrattualizzazione: a.contrattualizzazione, tipi: TIPI_PUNTO,
  };
}

/**
 * Anagrafica del punto (sede collegata, nome, tipo previsto, date di avvio). Collegare la sede o impostare la data effettiva fa ripartire
 * i passi dell'avvio in attesa; collegare la sede riallinea il perimetro degli accessi del partner (royalties della nuova sede in Cash).
 */
export async function aggiornaPunto(a, d, { userId = null } = {}) {
  const set = {};
  const note = [];
  if (d.pp_site_id !== undefined) {
    if (d.pp_site_id) {
      const sede = await sedeDi(d.pp_site_id);
      if (!sede) throw errore(400, 'Sede non trovata');
      if (sede.kind !== 'PUNTO_PRELIEVI') throw errore(400, 'Collega una sede di tipo Punto prelievi (Amministrazione > Sedi)');
      if (await one('SELECT 1 FROM accounts WHERE pp_site_id=$1 AND id<>$2', [sede.id, a.id])) throw errore(400, 'Questa sede è già collegata a un altro punto prelievi');
      const tp = tipoPunto({ sede });
      if (tp.tipo === 'CORNER' && sede.host_organization_id && Number(sede.host_organization_id) !== Number(a.organization_id)) throw errore(400, `La sede è ospitata da ${sede.host_name}: il punto corner va sull'account di quella Legal entity`);
      note.push(`Sede collegata: ${sede.name} (${sede.code}), ${tp.tipo === 'CORNER' ? 'corner' : 'flagship'} dalla sede`);
    } else note.push('Sede scollegata');
    set.pp_site_id = d.pp_site_id || null;
  }
  if (d.pp_nome !== undefined) set.pp_nome = d.pp_nome || null;
  if (d.pp_tipo_previsto !== undefined) set.pp_tipo_previsto = d.pp_tipo_previsto || null;
  if (d.data_avvio_prevista !== undefined) set.data_avvio_prevista = d.data_avvio_prevista || null;
  if (d.data_avvio_effettiva !== undefined) {
    set.data_avvio_effettiva = d.data_avvio_effettiva || null;
    if (String(a.data_avvio_effettiva || '').slice(0, 10) !== String(d.data_avvio_effettiva || '')) note.push(`Data di avvio effettiva: ${d.data_avvio_effettiva ? dataBreve(d.data_avvio_effettiva) : 'tolta'}`);
  }
  const cols = Object.keys(set);
  if (!cols.length) return { ok: true };
  await q(`UPDATE accounts SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [a.id, ...cols.map((c) => set[c])]);
  if (note.length) await attivita(a.id, { tipo: 'SISTEMA', oggetto: 'Anagrafica del punto prelievi aggiornata', testo: note.join('\n') }, userId);
  let riallineo = null; let ripresa = null;
  if (set.pp_site_id && a.pp_avvio?.passi?.CREDENZIALI?.stato === 'OK') riallineo = await realignOrgPerimeters(a.organization_id).then((r) => ({ cambiati: r.changed })).catch(() => null);
  if (a.pp_avvio_at && (set.pp_site_id || set.data_avvio_effettiva)) ripresa = await riprendiAvvio(a.id, { userId });
  return { ok: true, riallineo, ripresa };
}

// ---------------------------------------------------------------- contratto al partner (solo corner) da network@
/** Prepara l'invio del contratto PP al partner: PDF generato, riferimento [TD-B2B-...] nell'oggetto, collegamento alla form PARTNER. */
export async function preparaContrattoPartner(a, { contattoId = null } = {}, { userId = null } = {}) {
  const p = await quadroPunto(a);
  const ref = contattoId ? await referentePrincipale(a.id, contattoId) : p.referente;
  const prereq = prerequisitiContrattoPartner({ tipo: p.tipo.tipo, contratto: p.contratto, file: p.contratto_file, referente: ref });
  if (!prereq.pronto) throw errore(400, `Prima dell'invio: ${prereq.voci.filter((v) => !v.ok).map((v) => `${v.label.toLowerCase()} (${v.dettaglio})`).join('; ')}`);
  const tok = await assicuraToken(a, { azione: 'crea', userId });
  const [mod, s, own] = await Promise.all([modelliFlusso(), getSettings(), nomeOwner(a.owner_user_id)]);
  const valori = { punto: p.nome, partner: a.org_name, referente: ref.nome || 'Partner', indirizzo_punto: p.indirizzo, link_form: linkForm(tok.token), scadenza_form: dataBreve(tok.scade), owner: own || 'Il team Punti Prelievo', data: dataBreve(todayRome()) };
  const oggetto = `${compila(mod.pp_contratto_oggetto, valori)} ${etichettaRif(tok.token)}`;
  const testo = compila(mod.pp_contratto_testo, valori);
  const allegati = [{ contract_file_id: p.contratto_file.id, filename: p.contratto_file.filename, size: Number(p.contratto_file.size || 0), ruolo: `Contratto Punto Prelievi ${p.contratto.protocol || ''} da firmare`.trim() }];
  const k = await one(`INSERT INTO kit_proposta (account_id, variante, contract_id, contract_file_id, oggetto, testo, destinatari, allegati, avvisi, preparato_by) VALUES ($1,'CONTRATTO_PARTNER',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.id, p.contratto.id, p.contratto_file.id, oggetto, testo, JSON.stringify([ref.email]), JSON.stringify(allegati), JSON.stringify(p.tipo.avvisi || []), userId]);
  const gia = await one(`SELECT inviato_at FROM kit_proposta WHERE account_id=$1 AND contract_file_id=$2 AND stato='INVIATO' ORDER BY inviato_at DESC LIMIT 1`, [a.id, p.contratto_file.id]);
  return { id: k.id, from: casella('PP', s).address, to: [ref.email], cc: ccFissi('PP', s).filter((x) => x !== ref.email), oggetto, testo, allegati, avvisi: p.tipo.avvisi || [], link: linkForm(tok.token), scade: tok.scade,
    gia_inviato: gia ? { at: gia.inviato_at } : null };
}
async function nomeOwner(userId) {
  if (!userId) return null;
  const u = await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS nome FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [userId]);
  return u?.nome || null;
}

// ---------------------------------------------------------------- form pubblica, variante PARTNER
export async function datiFormPartner(a) {
  const [s, company, ref, sede] = await Promise.all([getSettings(), getCompany(), referentePrincipale(a.id), sedeDi(a.pp_site_id)]);
  const ultima = await one('SELECT dati, versione, inviata_at FROM anagrafiche_b2b WHERE account_id=$1 ORDER BY versione DESC LIMIT 1', [a.id]);
  return {
    variante: 'PARTNER', cliente: a.org_name, punto: nomePunto(a, sede), linea: a.linea, linea_label: LINEE[a.linea].label, scade: String(a.b2b_token_scade).slice(0, 10), casella: casella(a.linea, s).address,
    valori: precompilaPartner({ referente: ref, ultima: ultima?.dati }), ultimo_invio: ultima ? { versione: ultima.versione, at: ultima.inviata_at } : null, contrattualizzato: Boolean(a.contrattualizzato_at),
    allegati: await allegatiRichiesti(a), societa: { nome: company.legal_name, email: company.email, telefono: company.phone, sito: company.website },
    sezioni: SEZIONI_PARTNER, campi: CAMPI_PARTNER.map(({ s: sez, k, label, t, req }) => ({ s: sez, k, label, t, obbligatorio: Boolean(req) })),
  };
}
/** Referente del partner dalla form: aggiorna il referente con la stessa email o ne crea uno principale. */
async function salvaReferente(a, d) {
  const email = String(d.ref_email || '').trim().toLowerCase();
  const c = await one('SELECT id FROM contatti WHERE account_id=$1 AND lower(email)=$2', [a.id, email]);
  if (c) {
    await q(`UPDATE contatti SET nome=$2, ruolo=coalesce(nullif($3,''), ruolo), telefono=coalesce(nullif($4,''), telefono), principale=TRUE, updated_at=now() WHERE id=$1`, [c.id, d.ref_nome, d.ref_ruolo, d.ref_telefono]);
    await q('UPDATE contatti SET principale=FALSE WHERE account_id=$1 AND id<>$2', [a.id, c.id]);
    return { id: c.id, nuovo: false };
  }
  await q('UPDATE contatti SET principale=FALSE WHERE account_id=$1', [a.id]);
  const n = await one(`INSERT INTO contatti (account_id, nome, ruolo, email, telefono, principale, fonte) VALUES ($1,$2,$3,$4,$5,TRUE,'Form online del partner') RETURNING id`, [a.id, d.ref_nome, d.ref_ruolo || null, email, d.ref_telefono || null]);
  return { id: n.id, nuovo: true };
}
/** Invio della form del partner: referente, contratto firmato (e allegati richiesti); con il contratto parte l'avvio del punto prelievi. */
export async function riceviFormPartner(a, input, files, { ip = null, contrattoPerEmail = false } = {}) {
  const { dati, errori } = validaPartner(input);
  const richiesti = await allegatiRichiesti(a);
  for (const r of richiesti) {
    const caricato = r.contratto ? Boolean(files.contratto) : files.allegati.some((x) => x.indice === r.indice);
    if (r.obbligatorio && !caricato && !r.ricevuto && !(r.contratto && contrattoPerEmail)) errori.push({ campo: r.contratto ? 'contratto' : `allegato_${r.indice}`, messaggio: `${r.titolo}: obbligatorio` });
  }
  const pdfOk = (f) => f && (/pdf/i.test(f.mimetype || '') || /\.pdf$/i.test(f.originalname || '')) && f.buffer?.subarray(0, 5).toString() === '%PDF-';
  if (files.contratto && !pdfOk(files.contratto)) errori.push({ campo: 'contratto', messaggio: 'Il contratto firmato va caricato in PDF' });
  if (errori.length) throw Object.assign(errore(400, 'Controllate i campi segnalati'), { details: errori });
  const versione = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM anagrafiche_b2b WHERE account_id=$1', [a.id])).v);
  const rf = await salvaReferente(a, dati);
  const act = await attivita(a.id, { tipo: 'FORM_B2B', oggetto: `Form online del partner${files.contratto ? ': contratto firmato ricevuto' : ''}`, con_chi: dati.ref_nome, contatto_id: rf.id,
    testo: [`Referente del partner ${rf.nuovo ? 'aggiunto' : 'aggiornato'} (principale).`, files.allegati.length ? `Allegati caricati: ${files.allegati.length}.` : null,
      !files.contratto && contrattoPerEmail ? 'Il partner invierà il contratto firmato per email.' : null, dati.note ? `Note del partner: ${dati.note}` : null].filter(Boolean).join('\n'), dati: { versione } });
  const salvati = [];
  let contrattoDoc = null;
  if (files.contratto) { contrattoDoc = await salvaFile(a, files.contratto, 'CONTRATTO_FIRMATO', richiesti.find((r) => r.contratto)?.titolo || 'Contratto firmato', { activityId: act.id }); salvati.push({ documento_id: contrattoDoc.id, etichetta: 'Contratto firmato', categoria: 'CONTRATTO_FIRMATO' }); }
  for (const y of files.allegati) {
    const r = richiesti.find((z) => z.indice === y.indice && !z.contratto);
    const d = await salvaFile(a, y.file, 'ALLEGATO_CONTRATTO', r?.titolo || 'Allegato del contratto', { activityId: act.id });
    salvati.push({ documento_id: d.id, etichetta: r?.titolo || 'Allegato del contratto', categoria: 'ALLEGATO_CONTRATTO' });
  }
  await q(`INSERT INTO anagrafiche_b2b (account_id, versione, dati, ip, activity_id, riempiti, differenze, allegati) VALUES ($1,$2,$3,$4,$5,'[]','[]',$6)`,
    [a.id, versione, JSON.stringify({ variante: 'PARTNER', ...dati }), ip ? String(ip).slice(0, 64) : null, act.id, JSON.stringify(salvati)]);
  await q('UPDATE accounts SET updated_at=now() WHERE id=$1', [a.id]);
  let esito = null;
  if (contrattoDoc) {
    const { contrattualizza } = await import('./contrattualizza.js');
    esito = await contrattualizza(a.id, { documentoId: contrattoDoc.id, fonte: 'form online del partner' });
  }
  console.log(`[business] form del partner account ${a.id}: v${versione}, ${salvati.length} file${esito && !esito.gia ? ', avvio del punto prelievi' : ''}`);
  return { versione, riempiti: 0, differenze: 0, file: salvati.length, contrattualizzato: Boolean(esito && !esito.gia) };
}

// ---------------------------------------------------------------- contratto firmato nel fascicolo di autorizzazione
/** Il contratto PP firmato è la "disponibilità dei locali" del fascicolo di autorizzazione della sede (se il fascicolo c'è già). */
export async function contrattoNelFascicolo(a, doc, contratto, userId = null) {
  const f = await fascicoloDi(a, contratto?.id || null);
  if (!f) return { esito: 'nessun fascicolo di autorizzazione aperto per la sede: il PDF resta nei documenti dell\'account e nel contratto' };
  if (await one(`SELECT 1 FROM dossier_files WHERE dossier_id=$1 AND doc_key='DISPONIBILITA_LOCALI' AND sha256=$2`, [f.id, doc.sha256])) return { esito: 'già nel fascicolo', dossier_id: f.id };
  const buf = await readBuffer(doc);
  const st = await storeBuffer('fascicoli', doc.filename, 'application/pdf', buf);
  await q(`INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, blob_path, label, uploaded_by) VALUES ($1,'DISPONIBILITA_LOCALI','UPLOAD',$2,'application/pdf',$3,$4,$5,$6,$7,$8)`,
    [f.id, doc.filename, st.size, st.sha256, st.data, st.blob_path, 'Contratto firmato con la struttura ospitante (Business Hub)', userId]);
  await q('UPDATE dossiers SET updated_at=now() WHERE id=$1', [f.id]);
  return { esito: 'aggiunto al fascicolo (disponibilità dei locali)', dossier_id: f.id };
}

// ---------------------------------------------------------------- avvio del punto prelievi
// Un avvio alla volta per account (una sola istanza della Suite su Render): le richieste concorrenti aspettano la precedente.
const inCorso = new Map();
function inSerie(accountId, fn) {
  const prima = inCorso.get(accountId) || Promise.resolve();
  const ora = prima.catch(() => 0).then(fn);
  inCorso.set(accountId, ora.finally(() => { if (inCorso.get(accountId) === ora) inCorso.delete(accountId); }));
  return ora;
}

/** Fondo cassa per l'email all'amministrazione: della sede in Cash, altrimenti il predefinito delle Impostazioni di Cash. */
export async function fondoCassa(siteId) {
  const st = await getModuleState('cash');
  if (!st.schema_ready) return { testo: 'da definire in Cash Management (widget non avviato)', fonte: null };
  if (siteId) {
    const e = await one('SELECT cash_float FROM cash.site_ext WHERE site_id=$1', [siteId]).catch(() => null);
    if (e && e.cash_float != null) return { testo: `${eur(e.cash_float)} (definito in Cash Management per la sede)`, fonte: 'sede', valore: Number(e.cash_float) };
  }
  const d = await one(`SELECT value FROM cash.app_settings WHERE key='default_cash_float'`).catch(() => null);
  const v = d && String(d.value).trim() !== '' && Number.isFinite(Number(String(d.value).replace(',', '.'))) ? Number(String(d.value).replace(',', '.')) : null;
  if (v != null) return { testo: `${eur(v)} (fondo cassa predefinito delle Impostazioni di Cash: ${siteId ? 'la sede non è ancora configurata in Cash' : 'la sede non è ancora in anagrafica'})`, fonte: 'predefinito', valore: v };
  return { testo: 'da definire in Cash Management (sede non configurata e nessun fondo cassa predefinito nelle Impostazioni di Cash)', fonte: null };
}

/** Servizi del profilo Partner ospitante, per il benvenuto: nomi dei widget del profilo (Cash con le royalties). */
async function serviziPartner() {
  const prof = await systemProfile(PROFILO_PARTNER);
  if (!prof) return '';
  const mods = await many('SELECT key, name FROM public.modules WHERE key = ANY($1::text[])', [(prof.items || []).map((x) => x.module_key)]);
  return (prof.items || []).map((it) => { const m = mods.find((x) => x.key === it.module_key); return m ? (m.key === 'cash' ? `${m.name} (royalties del punto prelievi, sola visualizzazione)` : m.name) : null; }).filter(Boolean).join(', ');
}

/** Valori dei segnaposto delle comunicazioni dell'avvio (tutti dai dati della Suite). */
async function valoriAvvio(a, p, { fonte = null } = {}) {
  const [s, refs, own] = await Promise.all([getSettings(), referentiPerLinea(a), nomeOwner(a.owner_user_id)]);
  const ref = p.referente;
  const dot = elencoDotazione(s.hub_pp_dotazione_elenco);
  const f = p.fascicolo;
  return {
    punto: p.nome, partner: a.org_name, partner_ospitante: p.tipo.tipo === 'CORNER' ? p.partner?.name || a.org_name : '', tipo: p.tipo.label, data: dataBreve(todayRome()), fonte: fonte || 'contratto firmato',
    sede: p.sede ? `${p.sede.name} (${p.sede.code})` : 'non ancora in anagrafica (Amministrazione > Sedi)', indirizzo_punto: p.indirizzo, orari: p.sede?.opening_hours || '',
    referente: ref?.nome || 'Partner', referente_dettaglio: ref ? [ref.nome + (ref.ruolo ? ` (${ref.ruolo})` : ''), ref.email, ref.telefono].filter(Boolean).join(' · ') : '',
    contratto: p.contratto ? `${p.contratto.protocol || `#${p.contratto.id}`} (${String(p.contratto.status).toLowerCase()})` : '',
    data_avvio: a.data_avvio_effettiva ? dataBreve(String(a.data_avvio_effettiva).slice(0, 10)) : 'da definire',
    data_avvio_prevista: a.data_avvio_prevista ? dataBreve(String(a.data_avvio_prevista).slice(0, 10)) : '',
    autorizzazione: f ? `fascicolo ${DOSSIER_LABEL[f.status] || f.status}${f.authorized_at ? ` il ${dataBreve(String(f.authorized_at).slice(0, 10))}` : ''}${f.authorization_ref ? `, ${f.authorization_ref}` : ''}` : 'fascicolo di autorizzazione non ancora aperto',
    dotazione: dot.testo, dotazione_breve: dot.breve, link_scheda: `${suiteUrl()}/business/account/${a.id}?scheda=punto`, suite_url: suiteUrl(),
    referenti: referentiTesto(refs), owner: own || 'Il team Punti Prelievo',
  };
}

async function loadAcc(id) { const { loadAccount } = await import('../routes/hub.js'); return loadAccount(id); }

/** Primo ordine standard in Ordini (passo d): BOZZA da verificare dall'Area Operations, idempotente per account. */
async function primoOrdine(a, p, userId) {
  const st = await getModuleState('orders');
  if (!st.schema_ready || st.mode !== 'LIVE') throw new Error('il widget Ordini non è avviato (LIVE): avvialo e premi "Riprova"');
  const odb = await import('../../orders/db.js');
  const { nextOrderNumber } = await import('../../orders/lib/orders.js');
  const rif = `BH-PP-${a.id}`;
  const gia = await odb.one(`SELECT id, number, status FROM orders WHERE client_ref=$1 AND status <> 'ANNULLATO' ORDER BY id LIMIT 1`, [rif]);
  if (gia) return { order_id: gia.id, number: gia.number, righe: null, gia: true };
  const s = await odb.one('SELECT id, kind, active, name FROM strutture_v WHERE id=$1', [a.pp_site_id]);
  if (!s) throw new Error('la sede non risulta tra le strutture di Ordini');
  if (!s.active) throw new Error('la sede è disattivata in anagrafica');
  const righe = composizionePrimoOrdine(await odb.many('SELECT id, code, name, active, lab_only, visible_sedi, source, sort FROM articles'));
  if (!righe.length) throw new Error('nessun articolo del Magazzino Centrale visibile ai Punti Prelievo (Ordini > Catalogo articoli, visibilità Punti Prelievo)');
  const out = await odb.tx(async (c) => {
    const number = await nextOrderNumber(c);
    const o = (await c.query(`INSERT INTO orders (number, struttura_id, kind, origin, status, notes, ops_notes, client_ref) VALUES ($1,$2,$3,'SISTEMA','BOZZA',$4,$5,$6) RETURNING id`,
      [number, s.id, s.kind, `Primo ordine standard del punto prelievi ${p.nome}`, 'Creato dal Business Hub all\'avvio del punto prelievi: quantità 1 di ogni articolo destinato ai Punti Prelievo. Da verificare e inviare dall\'Area Operations.', rif])).rows[0];
    for (const r of righe) await c.query('INSERT INTO order_lines (order_id, article_id, qty_requested) VALUES ($1,$2,1)', [o.id, r.article_id]);
    await c.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,NULL,$2,$3)', [o.id, 'Creato dal Business Hub: primo ordine standard del punto prelievi', JSON.stringify({ account_id: a.id, righe: righe.length })]);
    return { order_id: o.id, number };
  });
  void userId;
  return { ...out, righe: righe.length, gia: false };
}

/** Esecuzione di un passo: { stato: OK|FALLITO, esito, errore?, activity_id?, dati? }. */
async function eseguiPasso(key, ctx) {
  const { a, p, valori, mod, dest, userId } = ctx;
  const email = async (chiave, to, allegati = []) => {
    if (!to.length) return { stato: 'FALLITO', errore: 'nessun destinatario: indicali in Impostazioni (Processo Punti Prelievo)' };
    const out = await inviaAlCliente({ account: a, to, subject: compila(mod[`${chiave}_oggetto`], valori), testo: compila(mod[`${chiave}_testo`], valori), allegati, userId,
      sottotipo: SOTTOTIPO_PASSO[key], contattoId: key === 'CREDENZIALI' ? p.referente?.id || null : null, contractId: p.contratto?.id || null, dati: { avvio_pp: key } });
    return out.stato === 'FALLITO' ? { stato: 'FALLITO', errore: out.errore || 'invio non riuscito', activity_id: out.activity_id }
      : { stato: 'OK', esito: `email ${out.stato === 'INVIATO' ? 'inviata' : 'registrata'} a ${out.to.length} ${out.to.length === 1 ? 'destinatario' : 'destinatari'}`, activity_id: out.activity_id, to: out.to, cc: out.cc, email_stato: out.stato };
  };
  switch (key) {
    case 'CREDENZIALI': {
      const { attivaAccessi } = await import('./contrattualizza.js');
      const att = await attivaAccessi(a, { userId });
      if (!att.accessi) return { stato: 'FALLITO', errore: att.avvisi[0] || 'nessun accesso esterno attivato', avvisi: att.avvisi };
      valori.accessi = (att.utenti || []).map((u) => `${u.nome} (${u.email})`).join(', ');
      valori.servizi = await serviziPartner();
      const ref = p.referente?.email ? [p.referente.email] : (att.utenti || []).slice(0, 1).map((u) => u.email);
      const e = await email('pp_benvenuto', ref);
      return { ...e, esito: e.stato === 'OK' ? `profilo Partner ospitante su ${att.accessi} ${att.accessi === 1 ? 'accesso' : 'accessi'}, ${att.inviti.length} ${att.inviti.length === 1 ? 'invito' : 'inviti'} con password provvisoria (senza copie), benvenuto ${e.email_stato === 'INVIATO' ? 'inviato' : 'registrato'}` : e.esito, avvisi: att.avvisi };
    }
    case 'CONFERMA': {
      // il PDF firmato: quello che ha avviato il processo, altrimenti l'ultimo contratto firmato dell'account
      const docId = a.pp_avvio?.documento_id || a.contrattualizzazione?.documento_id || null;
      const doc = docId ? await one('SELECT id, filename, mime, data, blob_path FROM documenti WHERE id=$1 AND account_id=$2', [docId, a.id])
        : await one(`SELECT id, filename, mime, data, blob_path FROM documenti WHERE account_id=$1 AND categoria='CONTRATTO_FIRMATO' ORDER BY created_at DESC LIMIT 1`, [a.id]);
      return email('pp_conferma', dest.conferma, doc ? [{ filename: doc.filename, content: await readBuffer(doc), contentType: 'application/pdf', ref: `documento:${doc.id}` }] : []);
    }
    case 'AVVIO_LAB': return email('pp_avvio', dest.avvio);
    case 'DOTAZIONE': return email('pp_dotazione', dest.dotazione);
    case 'FONDO_CASSA': { const fc = await fondoCassa(a.pp_site_id); valori.fondo_cassa = fc.testo; const e = await email('pp_fondo', dest.amministrazione); return { ...e, dati: { fondo_cassa: fc.fonte, valore: fc.valore ?? null } }; }
    case 'RIFIUTI': return email('pp_rifiuti', dest.rifiuti);
    case 'PRIMO_ORDINE': {
      const o = await primoOrdine(a, p, userId);
      const act = await attivita(a.id, { tipo: 'AVVIO', sottotipo: 'PRIMO_ORDINE', esito: 'ESEGUITO', oggetto: `Primo ordine standard in Ordini: ${o.number}`,
        testo: o.gia ? `L'ordine ${o.number} esisteva già per questo punto prelievi: non se ne crea un altro.` : `${o.righe} articoli del Magazzino Centrale destinati ai Punti Prelievo, quantità 1 ciascuno, nella sede ${p.sede?.name || ''}. Stato bozza: lo verifica e lo invia l'Area Operations.`,
        dati: { order_id: o.order_id, number: o.number, righe: o.righe } }, userId);
      return { stato: 'OK', esito: `ordine ${o.number}${o.gia ? ' (già presente)' : `, ${o.righe} articoli`}`, activity_id: act.id, dati: { order_id: o.order_id, number: o.number } };
    }
    default: return { stato: 'FALLITO', errore: 'passo sconosciuto' };
  }
}

/**
 * Esegue i passi dell'avvio secondo il piano (regola pura pianoAvvio): i riusciti non si ripetono, quelli che aspettano la data o la sede
 * restano in attesa, un passo non riuscito non ferma gli altri. solo: elenco dei passi (Riprova). Ritorna { piano, riepilogo, eseguiti, avvisi }.
 */
export function eseguiAvvio(accountId, { solo = null, userId = null, fonte = null } = {}) {
  return inSerie(Number(accountId), async () => {
    let a = await loadAcc(accountId);
    const p = await quadroPunto(a);
    if (!p.tipo.tipo) throw errore(400, 'Tipo del punto prelievi da definire: collega la sede o indica il tipo previsto');
    const passi = { ...(a.pp_avvio?.passi || {}) };
    const piano = pianoAvvio({ tipo: p.tipo.tipo, passi, dataAvvio: a.data_avvio_effettiva, sedeId: a.pp_site_id, solo });
    const [mod, s] = await Promise.all([modelliFlusso(), getSettings()]);
    const ctx = { a, p, mod, dest: destinatariLinea('PP', s), userId, valori: await valoriAvvio(a, p, { fonte }) };
    const eseguiti = []; const avvisi = [];
    for (const x of piano) {
      if (x.azione === 'ATTESA') {
        if (passi[x.key]?.stato !== x.stato) {
          passi[x.key] = { stato: x.stato, at: new Date().toISOString(), esito: x.motivo };
          await attivita(a.id, { tipo: 'AVVIO', sottotipo: x.key, esito: 'IN_ATTESA', oggetto: `Avvio del punto prelievi: ${x.label}`, testo: `In attesa: ${x.motivo}.` }, userId);
        }
        continue;
      }
      if (x.azione !== 'ESEGUI') continue;
      let r;
      try { r = await eseguiPasso(x.key, ctx); } catch (e) { r = { stato: 'FALLITO', errore: e.message }; }
      if (r.stato === 'FALLITO' && !String(r.activity_id || '')) {
        const act = await attivita(a.id, { tipo: 'AVVIO', sottotipo: x.key, esito: 'FALLITO', oggetto: `Avvio del punto prelievi: ${x.label} non riuscito`, testo: `${r.errore}. Si riprova dalla scheda "Punto prelievi" (Riprova).` }, userId);
        r.activity_id = act.id;
      }
      for (const w of r.avvisi || []) avvisi.push(`${x.label}: ${w}`);
      passi[x.key] = { stato: r.stato, at: new Date().toISOString(), esito: r.esito || null, errore: r.errore || null, activity_id: r.activity_id || null, to: r.to, cc: r.cc, email_stato: r.email_stato, dati: r.dati, tentativi: Number(passi[x.key]?.tentativi || 0) + 1 };
      eseguiti.push({ key: x.key, stato: r.stato });
      // stato salvato a ogni passo: un errore imprevisto più avanti non fa ripetere un'email già partita
      await q(`UPDATE accounts SET pp_avvio=jsonb_set(coalesce(pp_avvio, '{}'::jsonb), '{passi}', $2::jsonb, true), updated_at=now() WHERE id=$1`, [a.id, JSON.stringify(passi)]);
      a = { ...a, pp_avvio: { ...(a.pp_avvio || {}), passi } };
      ctx.a = a;
    }
    await q(`UPDATE accounts SET pp_avvio=jsonb_set(coalesce(pp_avvio, '{}'::jsonb), '{passi}', $2::jsonb, true), updated_at=now() WHERE id=$1`, [a.id, JSON.stringify(passi)]);
    const riepilogo = riepilogoAvvio(p.tipo.tipo, passi);
    if (eseguiti.length) {
      await attivita(a.id, { tipo: 'AVVIO', oggetto: `Avvio del punto prelievi: ${riepilogo.fatti} passi su ${riepilogo.previsti} fatti`, esito: riepilogo.completo ? 'COMPLETATO' : riepilogo.falliti.length ? 'DA_COMPLETARE' : 'IN_CORSO',
        testo: [`Eseguiti ora: ${eseguiti.map((e) => `${PASSI_AVVIO_PP.find((y) => y.key === e.key).lettera}) ${PASSI_AVVIO_PP.find((y) => y.key === e.key).label} (${STATI_PASSO[e.stato]})`).join('; ')}.`,
          riepilogo.da_completare.length ? `Da completare: ${riepilogo.da_completare.map((k) => `${PASSI_AVVIO_PP.find((y) => y.key === k).label} (${STATI_PASSO[passi[k]?.stato || 'DA_FARE']})`).join('; ')}.` : 'Tutti i passi sono completati.'].join('\n'),
        dati: { passi: eseguiti } }, userId);
    }
    console.log(`[business] avvio punto prelievi account ${a.id}: ${eseguiti.map((e) => `${e.key} ${e.stato}`).join(', ') || 'nessun passo eseguito'}`);
    return { piano: pianoAvvio({ tipo: p.tipo.tipo, passi, dataAvvio: a.data_avvio_effettiva, sedeId: a.pp_site_id }), riepilogo, eseguiti, avvisi };
  });
}

/** Avvio (contratto firmato per il corner, "Avvia il punto prelievi" per il flagship): segna l'inizio una volta sola e esegue i passi. */
export async function avviaPuntoPrelievi(accountId, { fonte = null, userId = null, documentoId = null } = {}) {
  await q(`UPDATE accounts SET pp_avvio_at=coalesce(pp_avvio_at, now()),
      pp_avvio=coalesce(pp_avvio, '{"passi":{}}'::jsonb) || jsonb_build_object('fonte', $2::text) || CASE WHEN $3::int IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('documento_id', $3::int) END WHERE id=$1`, [accountId, fonte || 'avvio', documentoId]);
  return eseguiAvvio(accountId, { userId, fonte });
}

/** Ripresa dei passi in attesa (data impostata, sede collegata, job): mai i non riusciti, che aspettano "Riprova". */
export async function riprendiAvvio(accountId, { userId = null } = {}) {
  const a = await loadAcc(accountId);
  if (!a.pp_avvio_at) return null;
  const passi = a.pp_avvio?.passi || {};
  const solo = PASSI_AVVIO_PP.map((p) => p.key).filter((k) => !passi[k] || ['ATTESA_DATA', 'ATTESA_SEDE', 'DA_FARE'].includes(passi[k].stato));
  if (!solo.length) return null;
  return eseguiAvvio(accountId, { solo, userId, fonte: a.pp_avvio?.fonte || null });
}

/** "Avvia il punto prelievi" del flagship: data di avvio effettiva obbligatoria; pipeline alla fase 6 (sede pronta, locazione della sede). */
export async function avviaFlagship(a, { data, userId = null } = {}) {
  const p = await quadroPunto(a);
  if (p.tipo.tipo !== 'FLAGSHIP') throw errore(400, p.tipo.tipo === 'CORNER' ? 'Il corner si avvia con il contratto firmato dal partner' : 'Collega la sede o indica il tipo previsto (flagship)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) throw errore(400, 'Indica la data di avvio effettiva');
  if (a.pp_avvio_at) throw errore(409, `Il punto prelievi è già stato avviato il ${dataBreve(new Date(a.pp_avvio_at).toISOString().slice(0, 10))}: usa "Riprova" sui passi da completare`);
  await q('UPDATE accounts SET data_avvio_effettiva=$2, prospect=FALSE, updated_at=now() WHERE id=$1', [a.id, data]);
  await attivita(a.id, { tipo: 'AVVIO', oggetto: 'Avvio del punto prelievi flagship', testo: `Data di avvio effettiva: ${dataBreve(data)}.${p.locazione ? ` Sede in locazione: contratto ${p.locazione.protocol || `#${p.locazione.id}`} (${String(p.locazione.status).toLowerCase()}).` : ''}${p.fascicolo ? ` Autorizzazione: fascicolo ${DOSSIER_LABEL[p.fascicolo.status] || p.fascicolo.status}.` : ''}` }, userId);
  const fase = await avanzaFase(a.id, 6, data, 'Avvio del punto prelievi flagship (sede TD in locazione o di proprietà): la fase 7 la conferma il CEO.', userId);
  const out = await avviaPuntoPrelievi(a.id, { fonte: 'avvio del flagship', userId });
  return { ...out, fase };
}

/** Job business:avvio-pp: riprende i passi in attesa quando la data o la sede ci sono (sede collegata a mano, data salvata altrove). */
export async function riprendiAvvii() {
  const rows = await many(`SELECT id FROM accounts WHERE linea='PP' AND pp_avvio_at IS NOT NULL AND (
      (pp_site_id IS NOT NULL AND coalesce(pp_avvio->'passi'->'PRIMO_ORDINE'->>'stato','') IN ('','ATTESA_SEDE','DA_FARE'))
      OR (data_avvio_effettiva IS NOT NULL AND coalesce(pp_avvio->'passi'->'AVVIO_LAB'->>'stato','') IN ('','ATTESA_DATA','DA_FARE')))`);
  let n = 0;
  for (const r of rows) { try { if (await riprendiAvvio(r.id)) n++; } catch { console.error(`[business] ripresa dell'avvio account ${r.id} non riuscita`); } }
  return { account: rows.length, ripresi: n };
}

// ---------------------------------------------------------------- elenco e promemoria
/** Pagina "Punti Prelievo": account PP con tipo, sede, partner, fase, autorizzazione, avvio; sedi Punto prelievi ancora senza account. */
export async function elencoPuntiPrelievo() {
  const rows = await many(`SELECT a.id, a.organization_id, o.name AS org_name, o.city AS org_city, a.fase_corrente, a.phase_dates, a.cliente_attivo, a.pp_site_id, a.pp_nome, a.pp_tipo_previsto,
      a.data_avvio_prevista, a.data_avvio_effettiva, a.pp_avvio_at, a.pp_avvio, a.contrattualizzato_at, uo.full_name AS owner_name,
      s.code AS site_code, s.name AS site_name, s.city AS site_city, s.tenure, s.host_organization_id, s.kind AS site_kind, ho.name AS host_name,
      (SELECT json_build_object('id', d.id, 'status', d.status, 'authorized_at', d.authorized_at) FROM dossiers d WHERE d.site_id=a.pp_site_id ORDER BY d.created_at DESC LIMIT 1) AS fascicolo,
      (SELECT json_build_object('id', c.id, 'protocol', c.protocol, 'status', c.status) FROM contracts c WHERE c.org_id=a.organization_id AND c.kind='PP' AND c.status NOT IN ('ANNULLATO','CESSATO')
         AND (a.pp_site_id IS NULL OR c.site_id IS NULL OR c.site_id=a.pp_site_id) ORDER BY CASE WHEN c.site_id=a.pp_site_id THEN 0 ELSE 1 END, c.updated_at DESC NULLS LAST LIMIT 1) AS contratto,
      (SELECT json_build_object('id', c.id, 'protocol', c.protocol, 'status', c.status) FROM contracts c WHERE c.kind='SEDE' AND c.site_id=a.pp_site_id AND c.status NOT IN ('ANNULLATO') ORDER BY c.updated_at DESC NULLS LAST LIMIT 1) AS locazione
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN public.users uo ON uo.id=a.owner_user_id
    LEFT JOIN public.sites s ON s.id=a.pp_site_id LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id
    WHERE a.linea='PP' ORDER BY coalesce(s.name, a.pp_nome, o.name)`);
  const punti = rows.map((r) => {
    const sede = r.pp_site_id ? { kind: r.site_kind, tenure: r.tenure, host_organization_id: r.host_organization_id } : null;
    const tp = tipoPunto({ sede, previsto: r.pp_tipo_previsto });
    const { pp_avvio: avvio, ...x } = r;
    return { ...x, nome: r.site_name || r.pp_nome || r.org_name, tipo: tp.tipo, tipo_fonte: tp.fonte, partner: tp.tipo === 'CORNER' ? r.host_name || r.org_name : null, avvio: tp.tipo && r.pp_avvio_at ? riepilogoAvvio(tp.tipo, avvio?.passi || {}) : null };
  });
  const senza = await many(`SELECT s.id, s.code, s.name, s.city, s.tenure, s.host_organization_id, ho.name AS host_name, s.organization_id, so.name AS organization_name, s.opened_at,
      (SELECT d.status FROM dossiers d WHERE d.site_id=s.id ORDER BY d.created_at DESC LIMIT 1) AS fascicolo_status
    FROM public.sites s LEFT JOIN public.organizations ho ON ho.id=s.host_organization_id LEFT JOIN public.organizations so ON so.id=s.organization_id
    WHERE s.kind='PUNTO_PRELIEVI' AND s.active AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.pp_site_id=s.id) ORDER BY s.name`);
  return { punti, sedi_senza_account: senza.map((s) => ({ ...s, tipo: tipoPunto({ sede: s }).tipo, org_account: s.tenure === 'OSPITATA' || (!s.tenure && s.host_organization_id) ? s.host_organization_id : s.organization_id })) };
}

/** Cruscotto PP: avvii con passi da completare (non riusciti o in attesa) e flagship autorizzati da avviare (promemoria). */
export async function promemoriaPP() {
  const { punti } = await elencoPuntiPrelievo();
  const daCompletare = punti.filter((p) => p.avvio && !p.avvio.completo).map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, falliti: p.avvio.falliti, da_completare: p.avvio.da_completare, fatti: p.avvio.fatti, previsti: p.avvio.previsti }));
  const daAvviare = punti.filter((p) => p.tipo === 'FLAGSHIP' && !p.pp_avvio_at && p.fascicolo?.status === 'AUTORIZZATO')
    .map((p) => ({ id: p.id, nome: p.nome, autorizzato_il: p.fascicolo.authorized_at, data_avvio: p.data_avvio_effettiva || p.data_avvio_prevista || null }));
  return { da_completare: daCompletare, da_avviare: daAvviare };
}
