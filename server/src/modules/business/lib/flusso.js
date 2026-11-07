// Business Hub · processo Service (richiesta del CEO del 06/11/2026), parte operativa: stato del processo di un account, accesso alla
// Suite per il prospect (senza widget fino alla firma), collegamento alla form pubblica, kit di proposta (preparazione e invio da
// service@), form online ricevuta (anagrafica MOD173, contratto firmato, allegati), verifica degli allegati arrivati per email,
// applicazione delle differenze dell'anagrafica. Le regole pure sono in processo.js; contratto firmato e comunicazioni in
// contrattualizza.js; richiamo dei prospect in richiamo.js. Docs: docs/BUSINESS_HUB.md, "Processo Service".
// Privacy: nei log del server solo id ed esiti, mai indirizzi, oggetti, testi o dati dell'anagrafica.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { one, many, q } from '../db.js';
import { getCompany } from '../../../lib/company.js';
import { splitName, displayName } from '../../../lib/util.js';
import { getSettings } from './rules.js';
import { LINEE, indirizzi, emailValida, spostaFase, faseEffettiva, faseLabel } from './hub.js';
import { casella, ccFissi, inviaAlCliente } from './caselle.js';
import { storeBuffer, readBuffer } from './storage.js';
import { versioneCorrente } from './listino.js';
import { todayRome } from './util.js';
import {
  nuovoToken, scadenzaToken, statoToken, etichettaRif, rifDaOggetto, prerequisitiKit, volumiGiornalieri, ribaltaDaAvvio, datiClienteMancanti, precompila, validaMod173, confrontaAnagrafica,
  compila, allegatiDa, CAMPO_MOD173, pianoAccessi, accessiPerTutti,
} from './processo.js';
import { offertaDi, credenzialiStudiolab, modelliFlusso, suiteUrl } from './pacchettoGenera.js';
import { mod173Pdf } from './mod173Pdf.js';
import { dataBreve, letteraConOfferta } from './pacchetto.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
// Circolare del trasporto dei campioni: Allegato 3 del MOD230 dal 07/11/2026 (prima 4: Allegati 1 e 2 accorpati, lib/mod230.js)
export const CIRCOLARE = { file: path.join(TEMPLATES, 'circolare_trasporto_campioni_2003-05-08.pdf'), filename: 'Allegato 3 - Circolare Ministero 8 Maggio 2003.pdf', etichetta: 'Circolare trasporto dei campioni (Ministero della Salute, 8 maggio 2003)' };
export const CHIAVE_ALLEGATI = 'b2b.allegati';
export const CHIAVE_MODELLI = 'flusso.modelli';
const errore = (status, msg) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- diario
export async function attivita(accountId, x, userId = null) {
  return one(`INSERT INTO activities (account_id, tipo, at, user_id, con_chi, contatto_id, oggetto, testo, esito, fase_da, fase_a, dati, sottotipo)
    VALUES ($1,$2,coalesce($3::timestamptz, now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
  [accountId, x.tipo, x.at || null, userId, x.con_chi || null, x.contatto_id || null, x.oggetto || null, x.testo || null, x.esito || null, x.fase_da ?? null, x.fase_a ?? null, x.dati ? JSON.stringify(x.dati) : null, x.sottotipo || null]);
}
/** Avanzamento automatico della pipeline fino alla fase indicata (mai indietro), con l'attività di sistema come dalla Pipeline. */
export async function avanzaFase(accountId, fase, data, motivo, userId = null) {
  const a = await one('SELECT id, fase_corrente, phase_dates, cliente_attivo FROM accounts WHERE id=$1', [accountId]);
  if (!a || Number(a.fase_corrente) >= fase) return null;
  const { phase_dates: pd } = spostaFase(a.phase_dates, fase, data);
  // le date delle fasi successive già registrate (es. 7 dal DB) restano: si aggiunge solo la data della fase raggiunta
  const tutte = { ...(a.phase_dates || {}), [fase]: pd[fase] };
  const nuova = faseEffettiva(tutte, a.cliente_attivo);
  await q('UPDATE accounts SET phase_dates=$2, fase_corrente=$3, updated_at=now() WHERE id=$1', [a.id, JSON.stringify(tutte), nuova]);
  await attivita(a.id, { tipo: 'SISTEMA', oggetto: `Fase: ${faseLabel(a.fase_corrente)} → ${faseLabel(nuova)}`, fase_da: a.fase_corrente, fase_a: nuova, testo: `Data della fase ${fase}: ${tutte[fase]}\n${motivo}`, dati: { phase_dates_prima: a.phase_dates, automatico: true } }, userId);
  return nuova;
}

// ---------------------------------------------------------------- letture
export async function referentePrincipale(accountId, contattoId = null) {
  if (contattoId) {
    const c = await one('SELECT id, nome, ruolo, email, telefono, person_id FROM contatti WHERE id=$1 AND account_id=$2', [contattoId, accountId]);
    if (!c) throw errore(400, 'Referente non valido per questo account');
    return c;
  }
  return one('SELECT id, nome, ruolo, email, telefono, person_id FROM contatti WHERE account_id=$1 AND email IS NOT NULL ORDER BY principale DESC, id LIMIT 1', [accountId]);
}
/** Accessi esterni della Legal entity con il numero di widget (grant confermati). */
export async function accessiEsterni(orgId) {
  return many(`SELECT u.id, u.email, u.full_name, u.status, u.last_login_at, u.created_at,
      (SELECT count(*)::int FROM public.grants g WHERE g.user_id=u.id AND NOT g.proposed) AS widget
    FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id
    WHERE u.is_external AND u.level='USER' AND u.status <> 'DISABLED' AND coalesce(p.organization_id, u.organization_id)=$1 ORDER BY u.created_at`, [orgId]);
}
const org = (orgId) => one('SELECT id, name, vat_number, tax_code, sdi, address, zip, city, province, email, phone, pec, iban, bank_name FROM public.organizations WHERE id=$1', [orgId]);
const ext = (orgId) => one('SELECT * FROM org_ext WHERE org_id=$1', [orgId]);
export const linkForm = (token) => `${suiteUrl()}/b2b/${token}`;

/**
 * Parte comune alle linee (Service e Punti Prelievo): collegamento alla form pubblica, allegati arrivati da verificare, contratto firmato
 * e allegati nel fascicolo, registro dei kit / invii del contratto, casella e copie fisse della linea.
 */
export async function statoComune(a, s = null) {
  const set = s || await getSettings();
  const daVerificare = await many(`SELECT d.id, d.filename, d.size, d.categoria, d.created_at, d.email_in_id, e.from_email, e.received_at FROM documenti d LEFT JOIN email_in e ON e.id=d.email_in_id
    WHERE d.account_id=$1 AND d.da_verificare ORDER BY d.created_at DESC`, [a.id]);
  const contratti = await many(`SELECT id, filename, size, created_at, etichetta FROM documenti WHERE account_id=$1 AND categoria IN ('CONTRATTO_FIRMATO','ALLEGATO_CONTRATTO') ORDER BY created_at DESC`, [a.id]);
  const kit = await many(`SELECT k.id, k.variante, k.stato, k.listino_id, k.listino_versione, k.contract_id, k.contract_file_id, k.oggetto, k.destinatari, k.allegati, k.avvisi, k.preparato_at, k.inviato_at, k.inviato_stato, k.pacchetto_id,
      u.full_name AS preparato_da, x.email_to AS inviato_a, x.email_cc AS inviato_cc FROM kit_proposta k LEFT JOIN users u ON u.id=k.preparato_by LEFT JOIN activities x ON x.id=k.inviato_activity_id
    WHERE k.account_id=$1 ORDER BY k.preparato_at DESC LIMIT 20`, [a.id]);
  const tok = statoToken({ token: a.b2b_token, scade: a.b2b_token_scade }, todayRome());
  return {
    form: { token: a.b2b_token ? true : false, link: a.b2b_token ? linkForm(a.b2b_token) : null, rif: a.b2b_token ? etichettaRif(a.b2b_token) : null, scade: a.b2b_token_scade, ...tok, giorni: Number(set.hub_b2b_token_giorni) || 60 },
    kit, da_verificare: daVerificare, documenti_contratto: contratti, casella: casella(a.linea, set).address, cc_fissi: ccFissi(a.linea, set),
  };
}

/** File utili del contratto della linea: l'ultimo Excel del listino (LISTINO_XLSX) e l'ultimo PDF dell'offerta (LISTINO_PDF, o un
 *  allegato con "offerta" nel nome). */
export async function filesContratto(contractId) {
  const files = await many(`SELECT id, category, filename, size, created_at FROM contract_files WHERE contract_id=$1 ORDER BY created_at DESC`, [contractId]);
  const xlsx = files.find((f) => f.category === 'LISTINO_XLSX') || files.find((f) => /\.xlsx?$/i.test(f.filename) && /listino|offerta/i.test(f.filename) && !['GENERATO_DOCX', 'GENERATO_PDF', 'FIRMATO'].includes(f.category)) || null;
  const pdf = files.find((f) => f.category === 'LISTINO_PDF') || files.find((f) => /\.pdf$/i.test(f.filename) && /offerta|listino/i.test(f.filename) && !['GENERATO_PDF', 'FIRMATO'].includes(f.category)) || null;
  return { listino_xlsx: xlsx, offerta_pdf: pdf };
}

/** Stato del processo di un account per la scheda "Kit e contrattualizzazione". */
export async function statoProcesso(a) {
  const s = await getSettings();
  const vers = await many('SELECT id, versione, riepilogo, offerta_documento_id, offerta_at FROM listini WHERE account_id=$1', [a.id]);
  const cor = versioneCorrente(vers, a.listino_corrente_id);
  const [ref, o, sl, acc, off] = await Promise.all([referentePrincipale(a.id), org(a.organization_id), a.linea === 'SRV' ? credenzialiStudiolab(a) : null, accessiEsterni(a.organization_id), offertaDi(a)]);
  const accesso = acc[0] || null;
  // Dati già presenti nel contratto della linea (07/11/2026, il CEO: "i dati di Tutti i contratti vanno travasati in Clienti e prospect"):
  // l'Excel del listino allegato al contratto si importa con un clic; il PDF dell'offerta allegato al contratto vale come offerta economica.
  const nelContratto = off.contratto ? await filesContratto(off.contratto.id) : { listino_xlsx: null, offerta_pdf: null };
  const offertaContratto = !cor?.offerta_documento_id && nelContratto.offerta_pdf ? nelContratto.offerta_pdf : null;
  const prereq = prerequisitiKit({
    listino: cor ? { versione: cor.versione, esami: cor.riepilogo?.esami } : null, referente: ref, datiMancanti: datiClienteMancanti(o || {}),
    studiolab: sl, accesso: accesso ? { email: accesso.email, widget: accesso.widget } : null,
    offerta: cor?.offerta_documento_id ? { versione: cor.versione } : offertaContratto ? { contratto: true, filename: offertaContratto.filename } : null,
    lettera: off.file ? { filename: off.file.filename, protocol: off.contratto?.protocol } : null,
  });
  if (!cor && nelContratto.listino_xlsx) { const v = prereq.voci.find((x) => x.key === 'listino'); v.dettaglio = `Excel allegato al contratto ${off.contratto.protocol || ''}: ${nelContratto.listino_xlsx.filename}. Importalo con "Importa dal contratto"`; v.nel_contratto = { id: nelContratto.listino_xlsx.id, filename: nelContratto.listino_xlsx.filename }; }
  if (offertaContratto) { const v = prereq.voci.find((x) => x.key === 'offerta'); v.dettaglio = `allegata al contratto ${off.contratto.protocol || ''}: ${offertaContratto.filename}`; }
  if (a.linea !== 'SRV') { const st = prereq.voci.find((v) => v.key === 'studiolab'); st.ok = true; st.dettaglio = 'non richieste per questa linea'; prereq.pronto = prereq.voci.every((v) => v.ok || v.auto); }
  const anagrafiche = await many(`SELECT id, versione, inviata_at, documento_id, riempiti, differenze, allegati, applicata_at FROM anagrafiche_b2b WHERE account_id=$1 ORDER BY versione DESC`, [a.id]);
  const comune = await statoComune(a, s);
  const kit = comune.kit.filter((k) => k.variante !== 'CONTRATTO_PARTNER');
  return {
    linea: a.linea, prerequisiti: prereq, listino: cor ? { id: cor.id, versione: cor.versione, riepilogo: cor.riepilogo, offerta_documento_id: cor.offerta_documento_id } : null,
    // con_offerta: la lettera (PDF del contratto) ha già nell'Allegato 1 l'offerta economica della versione corrente del listino
    referente: ref, accessi: acc, studiolab: sl, lettera: off.file ? { id: off.file.id, filename: off.file.filename, contratto: off.contratto, con_offerta: letteraConOfferta(off.file.meta, cor?.id) } : null, contratto: off.contratto,
    offerta_contratto: offertaContratto ? { id: offertaContratto.id, filename: offertaContratto.filename, size: Number(offertaContratto.size || 0) } : null, listino_nel_contratto: !cor && nelContratto.listino_xlsx ? { id: nelContratto.listino_xlsx.id, filename: nelContratto.listino_xlsx.filename } : null,
    ...comune, kit, gia_inviato: cor ? kit.find((k) => k.stato === 'INVIATO' && k.listino_id === cor.id) || null : null,
    anagrafiche,
    contrattualizzato_at: a.contrattualizzato_at, contrattualizzazione: a.contrattualizzazione, volumi_giornalieri_attesi: a.volumi_giornalieri_attesi, data_avvio_prevista: a.data_avvio_prevista,
    volumi: volumiGiornalieri(a, s.hub_giorni_lavorativi), giorni_lavorativi: Number(s.hub_giorni_lavorativi) || 250,
    ribaltamento: ribaltaDaAvvio({ ...a, data_avvio: a.data_avvio_effettiva || a.data_avvio_prevista }, s.hub_giorni_lavorativi),
  };
}

// ---------------------------------------------------------------- accesso alla Suite (senza widget fino alla firma)
const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}A1!`;
/** Email dell'invito con le credenziali: il testo vero parte, nel diario resta una nota senza la password. */
function testoInvito({ nome, email, password, url, attivo, linea }) {
  return `Gentile ${nome},

è stato creato il vostro accesso personale alla Suite di Toscana Diagnostica.

Indirizzo: ${url}
Utente: ${email}
Password provvisoria: ${password}

Al primo accesso la Suite vi chiede di scegliere una password personale e di prendere visione delle informative; dal profilo potete attivare il secondo fattore di autenticazione.
${attivo ? (linea === 'PP' ? 'Nella Suite trovate, in Cash Management, gli importi mensili delle royalties del punto prelievi che ospitate.' : 'I servizi della Suite per la vostra struttura sono attivi.') : 'I servizi della Suite (Portale Service, non conformità, ordini, circolari, rubrica e ticket) si attivano con la firma del contratto.'}

Toscana Diagnostica`;
}
/** Invia (o reinvia con una nuova password provvisoria) l'invito a un accesso esterno, dalla casella della linea, senza copie. */
export async function invitaAccesso(a, user, { attivo = false, userId = null } = {}) {
  const password = genPassword();
  await q('UPDATE public.users SET password_hash=$2, must_change_password=TRUE, updated_at=now() WHERE id=$1', [user.id, await bcrypt.hash(password, 12)]);
  const nome = user.full_name || user.email;
  const out = await inviaAlCliente({ account: a, to: [user.email], subject: 'Benvenuto in Suite TD · Toscana Diagnostica', testo: testoInvito({ nome, email: user.email, password, url: suiteUrl(), attivo, linea: a.linea }),
    testoDiario: `Invito con la password provvisoria per ${user.email} (il testo non si conserva perché contiene la password).`, userId, sottotipo: 'INVITO_SUITE', senzaCopie: true,
    dati: { user_id: user.id }, logSubject: `Business Hub · invito account ${a.id}` });
  // con la posta in modalità registro la password non arriva a nessuno: torna a chi ha premuto il pulsante (come in Amministrazione)
  return { ...out, password_provvisoria: out.stato === 'REGISTRATO' ? password : undefined };
}
/**
 * Crea l'accesso esterno per il referente: persona ESTERNO della Legal entity (se manca), utente LOCAL esterno SENZA grant (nessun widget
 * prima della firma: lib/esterni.js esternoInAttesa), invito con la password provvisoria dalla casella della linea.
 */
export async function creaAccesso(a, contatto, { suiteUserId = null, userId = null, attivo = false } = {}) {
  const email = String(contatto?.email || '').trim().toLowerCase();
  if (!emailValida(email)) throw errore(400, 'Serve un referente con un indirizzo email valido');
  const esiste = await one(`SELECT u.id, u.email, u.full_name, u.is_external, u.level, coalesce(p.organization_id, u.organization_id) AS org_id FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE lower(u.email)=$1`, [email]);
  if (esiste) {
    if (esiste.is_external && esiste.level === 'USER' && Number(esiste.org_id) === Number(a.organization_id)) return { user_id: esiste.id, email, gia_presente: true };
    throw errore(400, 'Esiste già un utente della Suite con questa email, non collegato a questa Legal entity: verificalo in Amministrazione > Utenti');
  }
  let person = await one('SELECT * FROM public.people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [email]);
  if (person && person.organization_id && Number(person.organization_id) !== Number(a.organization_id)) throw errore(400, 'Questa email è di una persona di un\'altra Legal entity: verificala in Amministrazione > Persone');
  const nomi = splitName(contatto.nome || email.split('@')[0]);
  if (!person) {
    person = await one(`INSERT INTO public.people (kind, status, last_name, first_name, email, job_title, organization_id) VALUES ('ESTERNO','ATTIVO',$1,$2,$3,$4,$5) RETURNING *`,
      [nomi.last_name || nomi.first_name, nomi.last_name ? nomi.first_name : '', email, contatto.ruolo || null, a.organization_id]);
  } else if (!person.organization_id || person.status !== 'ATTIVO') {
    person = await one(`UPDATE public.people SET organization_id=$2, status='ATTIVO', updated_at=now() WHERE id=$1 RETURNING *`, [person.id, a.organization_id]);
  }
  const full = displayName(person.last_name, person.first_name) || email;
  const user = await one(`INSERT INTO public.users (email, full_name, first_name, last_name, level, status, auth_provider, organization_id, person_id, lang, password_hash, must_change_password, created_by, is_external)
    VALUES ($1,$2,$3,$4,'USER','ACTIVE','LOCAL',$5,$6,'it',$7,TRUE,$8,TRUE) RETURNING id, email, full_name`,
  [email, full, person.first_name, person.last_name, a.organization_id, person.id, await bcrypt.hash(genPassword(), 12), suiteUserId]);
  if (contatto.id) await q('UPDATE contatti SET person_id=coalesce(person_id, $2) WHERE id=$1', [contatto.id, person.id]);
  await q(`INSERT INTO public.audit_log (user_id, action, entity, entity_id, label, data) VALUES ($1,'EXTERNAL_ACCESS_CREATED','organization',$2,$3,$4)`,
    [suiteUserId, String(a.organization_id), `Business Hub, account ${a.id}: accesso esterno${attivo ? '' : ' senza widget'}`, JSON.stringify({ user_id: user.id, origin: 'BUSINESS_HUB', widget: 0 })]).catch(() => 0);
  const inv = await invitaAccesso(a, user, { userId, attivo });
  await attivita(a.id, { tipo: 'ACCESSO', oggetto: `Accesso alla Suite creato per ${full}`, contatto_id: contatto.id || null, con_chi: full,
    testo: attivo ? `Utente ${email}: i servizi si attivano con il profilo della linea. Invito con la password provvisoria (senza copie): ${inv.stato.toLowerCase()}.`
      : `Utente ${email}, nessun widget fino alla firma del contratto (solo la form online, che non richiede l'accesso). Invito con la password provvisoria: ${inv.stato.toLowerCase()}.`, dati: { user_id: user.id } }, userId);
  console.log(`[business] accesso esterno creato per l'account ${a.id} (utente ${user.id}, invito ${inv.stato})`);
  return { user_id: user.id, email, invito: inv.stato, password_provvisoria: inv.password_provvisoria };
}

/**
 * Accessi al portale per i referenti dell'account (richiesta del CEO del 07/11/2026): per ogni referente con email senza accesso crea
 * l'accesso esterno con creaAccesso (invito con la password provvisoria a ciascuno, senza copie; attività ACCESSO nel diario per
 * ciascuno), idempotente: chi ha già l'accesso resta com'è. soloPrincipale: come prima, il solo referente principale. contattoIds:
 * limita ai referenti indicati. Ritorna { righe: [{ contatto_id, nome, email, esito: CREATO|HA_ACCESSO|SALTATO|ERRORE, motivo }], creati }.
 */
export async function creaAccessiReferenti(a, { soloPrincipale = false, contattoIds = null, attivo = false, userId = null, suiteUserId = null, diario = true } = {}) {
  const contatti = await many('SELECT id, nome, ruolo, email, telefono, person_id, principale FROM contatti WHERE account_id=$1 ORDER BY principale DESC, id', [a.id]);
  const piano = pianoAccessi({ contatti, accessi: await accessiEsterni(a.organization_id), soloPrincipale })
    .filter((x) => !contattoIds || contattoIds.includes(Number(x.contatto_id)));
  const righe = [];
  for (const x of piano) {
    if (x.esito !== 'DA_CREARE') { righe.push(x); continue; }
    try {
      const c = await creaAccesso(a, contatti.find((k) => k.id === x.contatto_id), { suiteUserId, userId, attivo });
      righe.push({ ...x, esito: c.gia_presente ? 'HA_ACCESSO' : 'CREATO', user_id: c.user_id, invito: c.invito || null, password_provvisoria: c.password_provvisoria });
    } catch (e) { righe.push({ ...x, esito: 'ERRORE', motivo: e.message }); }
  }
  const creati = righe.filter((r) => r.esito === 'CREATO');
  if (diario && (creati.length || righe.some((r) => r.esito === 'ERRORE'))) {
    const etichetta = { CREATO: 'creato', HA_ACCESSO: 'aveva già l\'accesso', SALTATO: 'saltato', ERRORE: 'non creato' };
    await attivita(a.id, { tipo: 'ACCESSO', oggetto: `Accessi al portale per i referenti: ${creati.length} ${creati.length === 1 ? 'creato' : 'creati'}`,
      testo: righe.map((r) => `- ${r.nome || r.email || 'referente'}${r.email ? ` (${r.email})` : ''}: ${etichetta[r.esito]}${r.motivo ? `, ${r.motivo}` : ''}${r.invito ? `, invito ${String(r.invito).toLowerCase()}` : ''}`).join('\n'),
      dati: { creati: creati.map((r) => r.user_id), solo_principale: soloPrincipale } }, userId);
  }
  return { righe, creati: creati.length };
}

// ---------------------------------------------------------------- collegamento alla form pubblica
/** Token della form: crea se manca, rinnova (stesso link, nuova scadenza) o rigenera (link nuovo, il vecchio non vale più). */
export async function assicuraToken(a, { azione = 'crea', userId = null } = {}) {
  const s = await getSettings();
  const scade = scadenzaToken(todayRome(), s.hub_b2b_token_giorni);
  const st = statoToken({ token: a.b2b_token, scade: a.b2b_token_scade }, todayRome());
  if (azione === 'crea' && st.valido) return { token: a.b2b_token, scade: String(a.b2b_token_scade).slice(0, 10), nuovo: false };
  const token = azione === 'rigenera' || !a.b2b_token ? nuovoToken() : a.b2b_token;
  await q('UPDATE accounts SET b2b_token=$2, b2b_token_scade=$3, b2b_token_at=now(), updated_at=now() WHERE id=$1', [a.id, token, scade]);
  await attivita(a.id, { tipo: 'SISTEMA', oggetto: azione === 'rigenera' ? 'Form online: nuovo collegamento (il precedente non vale più)' : a.b2b_token ? 'Form online: collegamento rinnovato' : 'Form online: collegamento creato', testo: `Valido fino al ${dataBreve(scade)}.` }, userId);
  a.b2b_token = token; a.b2b_token_scade = scade;
  return { token, scade, nuovo: true };
}

// ---------------------------------------------------------------- kit di proposta
async function documentoDaFile(a, { file, filename, etichetta, categoria = 'ALTRO' }, userId) {
  const gia = await one('SELECT id, filename, size FROM documenti WHERE account_id=$1 AND etichetta=$2 ORDER BY id DESC LIMIT 1', [a.id, etichetta]);
  if (gia) return gia;
  const buf = fs.readFileSync(file);
  const st = await storeBuffer('hub', filename, 'application/pdf', buf);
  return one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by, etichetta) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7,$8,$9) RETURNING id, filename, size`,
    [a.id, categoria, filename, st.size, st.sha256, st.data, st.blob_path, userId, etichetta]);
}
/** MOD173 compilabile precompilato con i dati della Suite (documento dell'account). */
export async function mod173Compilabile(a, ref, userId = null) {
  const [o, x, s, company] = await Promise.all([org(a.organization_id), ext(a.organization_id), getSettings(), getCompany()]);
  const ultima = await one('SELECT dati FROM anagrafiche_b2b WHERE account_id=$1 ORDER BY versione DESC LIMIT 1', [a.id]);
  const dati = precompila({ org: o || {}, ext: x || {}, referente: ref, linea: a.linea, labAddress: s.lab_address, ultima: ultima?.dati });
  const pdf = await mod173Pdf(dati, { modalita: 'compilabile', company, cliente: a.org_name });
  const filename = `TD-SGI-MOD173_00_Anagrafica_Clienti_B2B_${String(a.org_name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 50)}.pdf`;
  const st = await storeBuffer('hub', filename, 'application/pdf', pdf);
  return one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by, etichetta) VALUES ($1,'MOD173',$2,'application/pdf',$3,$4,$5,$6,$7,'MOD173 compilabile') RETURNING id, filename, size`,
    [a.id, filename, st.size, st.sha256, st.data, st.blob_path, userId]);
}
const MB = 1024 * 1024;
/**
 * Prepara il kit: controlla i prerequisiti, crea l'accesso se manca, assicura il collegamento alla form, genera il pacchetto della
 * proposta (variante KIT), il MOD173 compilabile, prende la lettera di offerta, l'offerta economica e la circolare, compone l'email
 * dal modello. Nessun invio: la riga kit_proposta resta PREPARATO con l'anteprima.
 */
export async function preparaKit(a, { contattoId = null, includiPassword = false, vademecum = true } = {}, { userId = null, suiteUserId = null } = {}) {
  const { creaPacchetto } = await import('../routes/pacchetto.js');
  const stato = await statoProcesso(a);
  if (!stato.prerequisiti.pronto) throw errore(400, `Prima di preparare il kit: ${stato.prerequisiti.voci.filter((v) => !v.ok && !v.auto).map((v) => v.label.toLowerCase()).join(', ')}`);
  const ref = await referentePrincipale(a.id, contattoId);
  if (!ref?.email) throw errore(400, 'Il referente destinatario deve avere un\'email');
  const avvisi = [];
  let accesso = stato.accessi[0] || null;
  // accessi al portale (07/11/2026): per tutti i referenti con email (impostazione hub_accessi_portale), idempotente
  const sAcc = await getSettings();
  if (accessiPerTutti(sAcc)) {
    const tutti = await creaAccessiReferenti(a, { userId, suiteUserId });
    for (const r of tutti.righe) if (r.esito === 'CREATO') avvisi.push(`Accesso alla Suite creato per ${r.email} (invito ${String(r.invito || '').toLowerCase()})`); else if (r.esito === 'ERRORE') avvisi.push(`Accesso per ${r.email} non creato: ${r.motivo}`);
    accesso = (await accessiEsterni(a.organization_id))[0] || accesso;
  } else if (!accesso) { const c = await creaAccesso(a, ref, { suiteUserId, userId }); accesso = { email: c.email, id: c.user_id }; avvisi.push(`Accesso alla Suite creato per ${c.email} (invito ${c.invito.toLowerCase()})`); }
  const tok = await assicuraToken(a, { azione: 'crea', userId });
  const oggi = todayRome();
  const pk = await creaPacchetto(a, { contatto: ref, includiPassword, data: oggi, variante: 'KIT', vademecumPagine: vademecum !== false }, userId);
  for (const x of pk.avvisi || []) avvisi.push(`Pacchetto: ${x}`);
  // il pacchetto rigenera la lettera di offerta dal contratto corrente (pacchettoGenera.js, letteraDiOfferta): file e meta si rileggono
  stato.lettera = (await statoProcesso(a)).lettera;
  const mod = await mod173Compilabile(a, ref, userId);
  const circ = await documentoDaFile(a, { file: CIRCOLARE.file, filename: CIRCOLARE.filename, etichetta: CIRCOLARE.etichetta }, userId);
  const off = stato.listino?.offerta_documento_id ? await one('SELECT id, filename, size FROM documenti WHERE id=$1', [stato.listino.offerta_documento_id]) : null;
  // niente doppione (seconda richiesta del CEO del 07/11/2026): se la lettera MOD230 contiene già l'offerta economica della versione
  // corrente nel suo Allegato 1, il PDF dell'offerta non si allega una seconda volta
  const conOfferta = Boolean(stato.lettera?.con_offerta);
  const allegati = [
    { documento_id: pk.documento_id, filename: pk.filename, size: pk.bytes, ruolo: 'Pacchetto della proposta (presentazione, Portale Service, credenziali, Vademecum)' },
    stato.lettera ? { contract_file_id: stato.lettera.id, filename: stato.lettera.filename, size: Number((await one('SELECT size FROM contract_files WHERE id=$1', [stato.lettera.id]))?.size || 0),
      ruolo: conOfferta ? `Lettera di offerta (con l'offerta economica del listino v${stato.listino.versione} nell'Allegato 1)` : 'Lettera di offerta' } : null,
    conOfferta ? null : off ? { documento_id: off.id, filename: off.filename, size: off.size, ruolo: `Offerta economica (listino v${stato.listino.versione})` }
      : stato.offerta_contratto ? { contract_file_id: stato.offerta_contratto.id, filename: stato.offerta_contratto.filename, size: stato.offerta_contratto.size, ruolo: 'Offerta economica (allegata al contratto)' } : null,
    { documento_id: circ.id, filename: circ.filename, size: circ.size, ruolo: 'Circolare per il trasporto dei campioni' },
    { documento_id: mod.id, filename: mod.filename, size: mod.size, ruolo: 'Modulo Anagrafica Clienti B2B (MOD173) compilabile' },
  ].filter(Boolean);
  const peso = allegati.reduce((n, x) => n + Number(x.size || 0), 0);
  if (peso > 25 * MB) avvisi.push(`Allegati per ${(peso / MB).toFixed(1)} MB: oltre 25 MB Microsoft rifiuta il messaggio. Rigenera il kit con il Vademecum come link`);
  else if (peso > 3 * MB) avvisi.push(`Allegati per ${(peso / MB).toFixed(1)} MB: verificare che la casella invii messaggi di queste dimensioni (Impostazioni, "Prova l'invio")`);
  const [mod2, own, s] = await Promise.all([modelliFlusso(), a.owner_user_id ? one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS nome FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [a.owner_user_id]) : null, getSettings()]);
  const sl = stato.studiolab;
  const valori = {
    cliente: a.org_name, referente: ref.nome || 'Cliente', link_form: linkForm(tok.token), scadenza_form: dataBreve(tok.scade), suite_url: suiteUrl(), utente_suite: accesso.email,
    studiolab: sl ? [sl.url ? `indirizzo ${sl.url}` : null, sl.username ? `utente ${sl.username}` : null, pk.password_inclusa ? 'password nel pacchetto allegato' : 'password comunicata separatamente'].filter(Boolean).join(', ') : '',
    listino_versione: String(stato.listino.versione), owner: own?.nome || 'Il team commerciale', data: dataBreve(oggi),
  };
  const oggetto = `${compila(mod2.kit_oggetto, valori)} ${etichettaRif(tok.token)}`;
  const testo = compila(mod2.kit_testo, valori);
  const k = await one(`INSERT INTO kit_proposta (account_id, listino_id, listino_versione, oggetto, testo, destinatari, allegati, pacchetto_id, avvisi, preparato_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [a.id, stato.listino.id, stato.listino.versione, oggetto, testo, JSON.stringify([ref.email]), JSON.stringify(allegati), pk.id, JSON.stringify(avvisi), userId]);
  await attivita(a.id, { tipo: 'KIT', oggetto: `Kit di proposta preparato (listino v${stato.listino.versione})`, contatto_id: ref.id, con_chi: ref.nome,
    testo: `Allegati: ${allegati.map((x) => x.filename).join(', ')}.\nForm online valida fino al ${dataBreve(tok.scade)}.${avvisi.length ? `\nAvvisi: ${avvisi.join('; ')}` : ''}`, dati: { kit_id: k.id } }, userId);
  return { id: k.id, from: casella(a.linea, s).address, to: [ref.email], cc: ccFissi(a.linea, s).filter((x) => x !== ref.email), oggetto, testo, allegati, peso, avvisi, link: linkForm(tok.token), scade: tok.scade,
    gia_inviato: stato.gia_inviato ? { at: stato.gia_inviato.inviato_at, versione: stato.gia_inviato.listino_versione } : null };
}

/**
 * Invio del kit preparato dalla casella della linea (copie fisse), con conferma. Variante KIT (Service): un secondo invio per la stessa
 * versione del listino chiede "reinvia". Variante CONTRATTO_PARTNER (Punti Prelievo): idem per lo stesso PDF del contratto.
 */
export async function inviaKit(kitId, { conferma = false, reinvia = false, oggetto = null, testo = null, altri = [] } = {}, { userId = null } = {}) {
  const k = await one('SELECT * FROM kit_proposta WHERE id=$1', [kitId]);
  if (!k) throw errore(404, 'Kit non trovato');
  if (k.stato !== 'PREPARATO') throw errore(400, `Questo kit è già ${k.stato.toLowerCase()}: preparane uno nuovo`);
  if (!conferma) throw errore(400, 'Conferma l\'invio dopo aver letto l\'anteprima');
  const { loadAccount } = await import('../routes/hub.js');
  const a = await loadAccount(k.account_id);
  const partner = k.variante === 'CONTRATTO_PARTNER';
  const gia = partner
    ? k.contract_file_id ? await one(`SELECT inviato_at FROM kit_proposta WHERE account_id=$1 AND contract_file_id=$2 AND stato='INVIATO' ORDER BY inviato_at DESC LIMIT 1`, [a.id, k.contract_file_id]) : null
    : k.listino_id ? await one(`SELECT inviato_at FROM kit_proposta WHERE account_id=$1 AND listino_id=$2 AND stato='INVIATO' ORDER BY inviato_at DESC LIMIT 1`, [a.id, k.listino_id]) : null;
  if (gia && !reinvia) throw Object.assign(errore(409, `${partner ? 'Questo contratto è già stato inviato al partner' : `Il kit per il listino v${k.listino_versione} è già stato inviato`} il ${dataBreve(new Date(gia.inviato_at).toISOString())}: conferma il nuovo invio`), { code: 'KIT_GIA_INVIATO' });
  const allegati = [];
  for (const x of k.allegati || []) {
    const f = x.documento_id ? await one('SELECT id, filename, mime, data, blob_path FROM documenti WHERE id=$1 AND account_id=$2', [x.documento_id, a.id])
      : await one('SELECT f.id, f.filename, f.mime, f.data, f.blob_path FROM contract_files f JOIN contracts c ON c.id=f.contract_id WHERE f.id=$1 AND c.org_id=$2', [x.contract_file_id, a.organization_id]);
    if (!f) throw errore(400, `Allegato non più disponibile: ${x.filename}. Prepara di nuovo il kit`);
    allegati.push({ filename: f.filename, content: await readBuffer(f), contentType: f.mime || 'application/pdf', ref: x.documento_id ? `documento:${f.id}` : `contract_file:${f.id}` });
  }
  if (allegati.reduce((n, x) => n + (x.content?.length || 0), 0) > 25 * MB) throw errore(400, 'Allegati oltre 25 MB: Microsoft rifiuta il messaggio. Prepara il kit con il Vademecum come link');
  const rif = rifDaOggetto(k.oggetto);
  let subj = String(oggetto || k.oggetto).trim();
  if (rif && !rifDaOggetto(subj)) subj = `${subj} [TD-B2B-${rif}]`;   // il riferimento serve all'ascolto della casella: resta sempre
  const to = [...new Set([...(k.destinatari || []), ...indirizzi(altri)])];
  const out = await inviaAlCliente({ account: a, to, subject: subj, testo: String(testo || k.testo), allegati, userId, sottotipo: partner ? 'CONTRATTO_PARTNER' : 'KIT_PROPOSTA', contractId: k.contract_id || null,
    dati: partner ? { kit_id: k.id, contract_id: k.contract_id, contract_file_id: k.contract_file_id } : { kit_id: k.id, listino_versione: k.listino_versione } });
  await q(`UPDATE kit_proposta SET stato=$2, inviato_activity_id=$3, inviato_at=now(), inviato_stato=$4, oggetto=$5, testo=$6, destinatari=$7 WHERE id=$1`,
    [k.id, out.stato === 'FALLITO' ? 'FALLITO' : 'INVIATO', out.activity_id, out.stato, subj, String(testo || k.testo), JSON.stringify(to)]);
  for (const x of k.allegati || []) if (x.documento_id) await q('UPDATE documenti SET activity_id=coalesce(activity_id, $2) WHERE id=$1', [x.documento_id, out.activity_id]);
  if (k.pacchetto_id) await q('UPDATE pacchetti SET inviato_activity_id=$2, inviato_at=now(), inviato_stato=$3 WHERE id=$1', [k.pacchetto_id, out.activity_id, out.stato]);
  let fase = null;
  if (out.stato !== 'FALLITO') fase = await avanzaFase(a.id, 4, todayRome(), partner ? `Contratto inviato al partner da ${out.from}.` : `Kit di proposta inviato da ${out.from} (listino v${k.listino_versione}).`, userId);
  if (partner && out.stato !== 'FALLITO' && k.contract_id) await q('INSERT INTO contract_events(contract_id, kind, user_id, note) VALUES ($1,$2,$3,$4)', [k.contract_id, 'INVIATO', userId, `Contratto inviato al partner da ${out.from} (Business Hub)`]).catch(() => 0);
  console.log(`[business] ${partner ? 'contratto al partner' : 'kit di proposta'} ${k.id} account ${a.id}: ${out.stato}`);
  return { ...out, fase };
}

// ---------------------------------------------------------------- form pubblica
/** Account dal token (valido) per la form pubblica, o errore 404/410. */
export async function accountDaToken(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) throw errore(404, 'Collegamento non valido');
  const a = await one(`SELECT a.*, o.name AS org_name FROM accounts a JOIN public.organizations o ON o.id=a.organization_id WHERE a.b2b_token=$1`, [t]);
  if (!a) throw errore(404, 'Collegamento non valido');
  const st = statoToken({ token: a.b2b_token, scade: a.b2b_token_scade }, todayRome());
  if (!st.valido) throw errore(410, `${st.motivo}: scrivete a ${LINEE[a.linea].casella} per riceverne uno nuovo`);
  return a;
}
/** Allegati richiesti per la linea (Impostazioni) con quelli già ricevuti. */
export async function allegatiRichiesti(a) {
  const x = await one('SELECT value FROM app_settings WHERE key=$1', [CHIAVE_ALLEGATI]);
  const lista = allegatiDa(x?.value || null)[a.linea] || [];
  const ricevuti = await many(`SELECT etichetta, categoria, max(created_at) AS at FROM documenti WHERE account_id=$1 AND categoria IN ('CONTRATTO_FIRMATO','ALLEGATO_CONTRATTO') GROUP BY etichetta, categoria`, [a.id]);
  return lista.map((l, i) => ({ ...l, indice: i, ricevuto: ricevuti.find((r) => (l.contratto ? r.categoria === 'CONTRATTO_FIRMATO' : r.etichetta === l.titolo))?.at || null }));
}
/** Dati della pagina pubblica: cliente, campi precompilati, allegati richiesti, recapiti di TD (dai Dati aziendali). */
export async function datiForm(a) {
  if (a.linea === 'PP') return (await import('./puntoPrelievi.js')).datiFormPartner(a);
  const [o, x, s, company, ref] = await Promise.all([org(a.organization_id), ext(a.organization_id), getSettings(), getCompany(), referentePrincipale(a.id)]);
  const ultima = await one('SELECT dati, versione, inviata_at FROM anagrafiche_b2b WHERE account_id=$1 ORDER BY versione DESC LIMIT 1', [a.id]);
  return {
    cliente: a.org_name, linea: a.linea, linea_label: LINEE[a.linea].label, scade: String(a.b2b_token_scade).slice(0, 10), casella: casella(a.linea, s).address,
    valori: precompila({ org: o || {}, ext: x || {}, referente: ref, linea: a.linea, labAddress: s.lab_address, ultima: ultima?.dati }),
    ultimo_invio: ultima ? { versione: ultima.versione, at: ultima.inviata_at } : null, contrattualizzato: Boolean(a.contrattualizzato_at),
    allegati: await allegatiRichiesti(a), societa: { nome: company.legal_name, email: company.email, telefono: company.phone, sito: company.website },
  };
}
export async function salvaFile(a, f, categoria, etichetta, { activityId = null, daVerificare = false, userId = null } = {}) {
  const st = await storeBuffer('hub', f.originalname, f.mimetype, f.buffer);
  return one(`INSERT INTO documenti (account_id, activity_id, categoria, filename, mime, size, sha256, data, blob_path, etichetta, da_verificare, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, filename`,
    [a.id, activityId, categoria, String(f.originalname || 'documento.pdf').slice(0, 250), f.mimetype || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path, etichetta, daVerificare, userId]);
}
/** Scrive i campi vuoti della Legal entity (org) e delle impostazioni Business (org_ext) dall'anagrafica ricevuta. */
async function scriviCampi(orgId, voci, userId = null) {
  const perOrg = voci.filter((v) => v.tabella === 'org'); const perExt = voci.filter((v) => v.tabella === 'ext');
  if (perOrg.length) await q(`UPDATE public.organizations SET ${perOrg.map((v, i) => `${v.colonna}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [orgId, ...perOrg.map((v) => v.valore)]);
  if (perExt.length) {
    await q('INSERT INTO org_ext (org_id, created_by) VALUES ($1,$2) ON CONFLICT (org_id) DO NOTHING', [orgId, userId]);
    await q(`UPDATE org_ext SET ${perExt.map((v, i) => `${v.colonna}=$${i + 2}`).join(', ')}, updated_by=$${perExt.length + 2}, updated_at=now() WHERE org_id=$1`, [orgId, ...perExt.map((v) => v.valore), userId]);
  }
}
/**
 * Invio della form: anagrafica (versione nuova, MOD173 compilato in PDF nel fascicolo), file (contratto firmato e allegati), campi vuoti
 * della Legal entity riempiti, differenze proposte all'operatore, attività FORM_B2B; con il contratto firmato parte la
 * contrattualizzazione. files: { contratto: file|null, allegati: [{ indice, file }] }.
 */
export async function riceviForm(a, input, files, { ip = null, contrattoPerEmail = false } = {}) {
  if (a.linea === 'PP') return (await import('./puntoPrelievi.js')).riceviFormPartner(a, input, files, { ip, contrattoPerEmail });
  const { dati, errori } = validaMod173(input);
  const richiesti = await allegatiRichiesti(a);
  for (const r of richiesti) {
    const caricato = r.contratto ? Boolean(files.contratto) : files.allegati.some((x) => x.indice === r.indice);
    if (r.obbligatorio && !caricato && !r.ricevuto && !(r.contratto && contrattoPerEmail)) errori.push({ campo: r.contratto ? 'contratto' : `allegato_${r.indice}`, messaggio: `${r.titolo}: obbligatorio` });
  }
  const pdfOk = (f) => f && (/pdf/i.test(f.mimetype || '') || /\.pdf$/i.test(f.originalname || '')) && f.buffer?.subarray(0, 5).toString() === '%PDF-';
  if (files.contratto && !pdfOk(files.contratto)) errori.push({ campo: 'contratto', messaggio: 'Il contratto firmato va caricato in PDF' });
  if (errori.length) throw Object.assign(errore(400, 'Controllate i campi segnalati'), { details: errori });
  const [company, o, x] = await Promise.all([getCompany(), org(a.organization_id), ext(a.organization_id)]);
  const versione = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM anagrafiche_b2b WHERE account_id=$1', [a.id])).v);
  const oggi = todayRome();
  const confronto = confrontaAnagrafica({ org: o || {}, ext: x || {} }, dati);
  await scriviCampi(a.organization_id, confronto.riempire);
  const pdf = await mod173Pdf(dati, { modalita: 'compilato', company, data: oggi, cliente: a.org_name, versione });
  const st = await storeBuffer('hub', `TD-SGI-MOD173_00_compilato_v${versione}.pdf`, 'application/pdf', pdf);
  const doc = await one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, etichetta) VALUES ($1,'MOD173',$2,'application/pdf',$3,$4,$5,$6,$7) RETURNING id`,
    [a.id, `TD-SGI-MOD173_00_Anagrafica_Clienti_B2B_compilato_v${versione}.pdf`, st.size, st.sha256, st.data, st.blob_path, `MOD173 compilato online v${versione}`]);
  const act = await attivita(a.id, { tipo: 'FORM_B2B', oggetto: `Form online compilata: anagrafica v${versione}${files.contratto ? ' e contratto firmato' : ''}`, con_chi: dati.svc_contatto || null,
    esito: confronto.differenze.length ? 'DA_VERIFICARE' : null,
    testo: [`Anagrafica Clienti B2B (MOD173) compilata online, PDF nel fascicolo.`, confronto.riempire.length ? `Campi vuoti della Legal entity completati: ${confronto.riempire.map((v) => v.label).join(', ')}.` : null,
      confronto.differenze.length ? `Differenze da verificare (scheda "Kit e contrattualizzazione", Applica): ${confronto.differenze.map((v) => v.label).join(', ')}.` : null,
      files.allegati.length ? `Allegati caricati: ${files.allegati.length}.` : null, !files.contratto && contrattoPerEmail ? 'Il cliente invierà il contratto firmato per email.' : null].filter(Boolean).join('\n'),
    dati: { versione, documento_id: doc.id } });
  await q('UPDATE documenti SET activity_id=$2 WHERE id=$1', [doc.id, act.id]);
  const salvati = [];
  let contrattoDoc = null;
  if (files.contratto) { contrattoDoc = await salvaFile(a, files.contratto, 'CONTRATTO_FIRMATO', richiesti.find((r) => r.contratto)?.titolo || 'Contratto firmato', { activityId: act.id }); salvati.push({ documento_id: contrattoDoc.id, etichetta: 'Contratto firmato', categoria: 'CONTRATTO_FIRMATO' }); }
  for (const y of files.allegati) {
    const r = richiesti.find((z) => z.indice === y.indice && !z.contratto);
    const d = await salvaFile(a, y.file, 'ALLEGATO_CONTRATTO', r?.titolo || 'Allegato del contratto', { activityId: act.id });
    salvati.push({ documento_id: d.id, etichetta: r?.titolo || 'Allegato del contratto', categoria: 'ALLEGATO_CONTRATTO' });
  }
  await q(`INSERT INTO anagrafiche_b2b (account_id, versione, dati, ip, documento_id, activity_id, riempiti, differenze, allegati) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [a.id, versione, JSON.stringify(dati), ip ? String(ip).slice(0, 64) : null, doc.id, act.id, JSON.stringify(confronto.riempire.map(({ valore: _v, ...v }) => v)), JSON.stringify(confronto.differenze), JSON.stringify(salvati)]);
  await q('UPDATE accounts SET updated_at=now() WHERE id=$1', [a.id]);
  const own = await one('SELECT owner_user_id FROM accounts WHERE id=$1', [a.id]);
  if (own?.owner_user_id) {
    const { notify } = await import('../../../lib/community.js');
    await notify([own.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `${a.org_name}: form online compilata`.slice(0, 200), body: files.contratto ? 'Anagrafica e contratto firmato ricevuti.' : 'Anagrafica ricevuta.', link: `/business/account/${a.id}` }).catch(() => 0);
  }
  let contrattualizzazione = null;
  if (contrattoDoc) {
    const { contrattualizza } = await import('./contrattualizza.js');
    contrattualizzazione = await contrattualizza(a.id, { documentoId: contrattoDoc.id, fonte: 'form online' });
  }
  console.log(`[business] form online account ${a.id}: anagrafica v${versione}, ${salvati.length} file${contrattualizzazione ? ', contrattualizzazione avviata' : ''}`);
  return { versione, riempiti: confronto.riempire.length, differenze: confronto.differenze.length, file: salvati.length, contrattualizzato: Boolean(contrattualizzazione && !contrattualizzazione.gia) };
}

/** Applica le differenze scelte dall'operatore (campi già valorizzati che il cliente ha indicato diversi). */
export async function applicaDifferenze(a, anagraficaId, campi = [], userId = null) {
  const r = await one('SELECT * FROM anagrafiche_b2b WHERE id=$1 AND account_id=$2', [anagraficaId, a.id]);
  if (!r) throw errore(404, 'Anagrafica non trovata');
  const voci = (r.differenze || []).filter((v) => campi.includes(v.campo)).map((v) => ({ ...v, valore: CAMPO_MOD173[v.campo]?.t === 'b' ? v.proposto === 'Sì' : v.proposto }));
  if (!voci.length) throw errore(400, 'Scegli almeno un campo da applicare');
  await scriviCampi(a.organization_id, voci, userId);
  const resto = (r.differenze || []).filter((v) => !campi.includes(v.campo));
  await q('UPDATE anagrafiche_b2b SET differenze=$2, applicata_at=now(), applicata_by=$3 WHERE id=$1', [r.id, JSON.stringify(resto), userId]);
  await attivita(a.id, { tipo: 'SISTEMA', oggetto: `Anagrafica v${r.versione}: differenze applicate alla Legal entity`, testo: voci.map((v) => `${v.label}: "${v.attuale}" → "${v.proposto}"`).join('\n') }, userId);
  if (!resto.length) await q(`UPDATE activities SET esito=NULL WHERE id=$1 AND esito='DA_VERIFICARE'`, [r.activity_id]);
  return { applicati: voci.length, restanti: resto.length };
}

/**
 * Esito della verifica di un allegato arrivato dal cliente: CONTRATTO (avvia la contrattualizzazione), ALLEGATO, NON_PERTINENTE,
 * OFFERTA_FIRMATA (offerta economica rifirmata dopo una revisione del listino: lib/revisioneOfferta.js, nessuna contrattualizzazione).
 */
export async function verificaDocumento(a, documentoId, esito, { userId = null, etichetta = null } = {}) {
  const d = await one('SELECT * FROM documenti WHERE id=$1 AND account_id=$2', [documentoId, a.id]);
  if (!d) throw errore(404, 'Documento non trovato');
  if (!['CONTRATTO', 'ALLEGATO', 'NON_PERTINENTE', 'OFFERTA_FIRMATA'].includes(esito)) throw errore(400, 'Esito non valido');
  if (esito === 'OFFERTA_FIRMATA') {
    const rev = await import('./revisioneOfferta.js');
    const l = await rev.versioneDaFirmare(a);
    if (!l) throw errore(400, 'Nessuna versione del listino a cui collegare l\'offerta firmata');
    return { esito, offerta: await rev.registraOffertaFirmata(a, l.id, d.id, { userId, fonte: d.email_in_id ? 'email' : 'caricamento' }) };
  }
  if (esito === 'CONTRATTO' && !(/pdf/i.test(d.mime) || /\.pdf$/i.test(d.filename))) throw errore(400, 'Il contratto firmato deve essere un PDF');
  const cat = esito === 'CONTRATTO' ? 'CONTRATTO_FIRMATO' : esito === 'ALLEGATO' ? 'ALLEGATO_CONTRATTO' : d.categoria;
  await q('UPDATE documenti SET categoria=$2, da_verificare=FALSE, verificato_at=now(), verificato_by=$3, etichetta=coalesce($4, etichetta) WHERE id=$1',
    [d.id, cat, userId, esito === 'CONTRATTO' ? 'Contratto firmato' : esito === 'ALLEGATO' ? (etichetta || 'Allegato del contratto') : null]);
  if (d.activity_id && !(await one('SELECT 1 FROM documenti WHERE activity_id=$1 AND da_verificare', [d.activity_id]))) await q(`UPDATE activities SET esito='VERIFICATO' WHERE id=$1 AND esito='DA_VERIFICARE'`, [d.activity_id]);
  await attivita(a.id, { tipo: 'SISTEMA', oggetto: `Allegato verificato: ${d.filename}`, testo: { CONTRATTO: 'È il contratto firmato.', ALLEGATO: `Allegato del contratto${etichetta ? `: ${etichetta}` : ''}.`, NON_PERTINENTE: 'Non pertinente al contratto.' }[esito] }, userId);
  if (esito !== 'CONTRATTO') return { esito };
  const { contrattualizza } = await import('./contrattualizza.js');
  return { esito, contrattualizzazione: await contrattualizza(a.id, { documentoId: d.id, fonte: d.email_in_id ? 'email' : 'caricamento', userId }) };
}
