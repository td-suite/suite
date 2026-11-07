// Business Hub · Pacchetto di benvenuto: raccolta dei dati (solo dati presenti nella Suite) e generazione del PDF unico.
// Fonti: account e Legal entity (Business Hub), owner (utenti e persone), contratto della linea con la lettera di offerta (MOD230
// service, MOD231 MdL, contratto del punto prelievi: vedi letteraDiOfferta, sempre rigenerata con il template attuale finché non c'è il
// firmato) o, in mancanza, i dati della proposta dell'account; Dati aziendali (company.js, anche l'Autorizzazione Sanitaria); specchio del
// Portale Service (contatti.json, certificazioni.json, PDF del Vademecum); specchio SGI (Politica Integrata della pagina "Qualità e
// certificazioni", con testi e standard di riferimento delle Impostazioni, app_settings pacchetto.certificazioni);
// accessi esterni della Legal entity (public.users is_external, profili di accesso); credenziali del portale referti
// (portal_credentials del contratto o org_ext della Legal entity; password solo se l'operatore la include); SLA definiti nei moduli
// NC (nc.org_ext.sla_ore o sla_ore_default) e Ticket (ticket.sla); sedi attive dell'anagrafica per la rete (PP).
// Passi: DOCX di ogni sezione nostra sulla carta intestata → un solo giro di LibreOffice → indice con i numeri di pagina veri →
// unione con offerta e Vademecum, numerazione e segnalibri (pacchettoPdf.js).
import QRCode from 'qrcode';
import { one, many } from '../db.js';
import { config as suite } from '../../../config.js';
import { getCompany } from '../../../lib/company.js';
import { getModuleState } from '../../../lib/modules.js';
import { getSettings } from './rules.js';
import { LINEE } from './hub.js';
import { casella as casellaLinea } from './caselle.js';
import { decrypt } from './crypto.js';
import { readBuffer } from './storage.js';
import { docxToPdfBatch } from './docgen.js';
import {
  componiSezioni, modelliDa, sostituisci, valoriSegnaposto, pianoAvvio, referentiDedicati, contattoLaboratorio, certificazioniIso, paginaCredenziali, checklist,
  telefoni, righeReferenti, letteraConOfferta, listinoDopoLaFirma, dataBreve, qualitaCertificazioni, certificazioniDa,
} from './pacchetto.js';
import { versioneCorrente } from './listino.js';
import { modelliFlussoDa, compila, referentiTesto } from './processo.js';
import * as D from './pacchettoDocx.js';
import { assembla, contaPagine, paginaIniziale } from './pacchettoPdf.js';
import { rigeneraDalPacchetto, offertaAllegato1 } from './contrattoGenera.js';
import { politicaQualita } from './politicaQualita.js';

export const CHIAVE_LETTERA = 'pacchetto.lettera_ceo';
export const CHIAVE_EMAIL = 'pacchetto.email';
export const CHIAVE_CERTIFICAZIONI = 'pacchetto.certificazioni';
const VADEMECUM_ONLINE = 'https://referti.toscanadiagnostica.it/vademecum';

async function moduloAttivo(key) {
  const st = await getModuleState(key);
  return Boolean(st.schema_ready) && ['LIVE', 'MIRROR'].includes(st.mode);
}
// Indirizzo pubblico della Suite: quello configurato se è un https pubblico, altrimenti il dominio di produzione (il QR deve funzionare
// anche se il pacchetto si genera da un ambiente di prova)
export function suiteUrl() {
  const b = String(suite.baseUrl || '').replace(/\/+$/, '');
  return /^https:\/\//.test(b) && !/localhost|127\.0\.0\.1/.test(b) ? b : 'https://suite.toscanadiagnostica.it';
}

export async function modelli() {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1::text[])', [[CHIAVE_LETTERA, CHIAVE_EMAIL]]);
  const v = Object.fromEntries(rows.map((x) => [x.key, x.value]));
  return { ...modelliDa({ lettera: v[CHIAVE_LETTERA], email: v[CHIAVE_EMAIL] }), personalizzati: { lettera: Boolean(v[CHIAVE_LETTERA]), email: Boolean(v[CHIAVE_EMAIL]) } };
}

/** Testi e standard della pagina "Qualità e certificazioni" (Impostazioni, app_settings pacchetto.certificazioni) sopra i predefiniti. */
export async function testiCertificazioni() {
  const x = await one('SELECT value FROM app_settings WHERE key=$1', [CHIAVE_CERTIFICAZIONI]);
  let v = null;
  try { v = x?.value ? JSON.parse(x.value) : null; } catch { v = null; }   // app_settings.value è testo (JSON)
  return { ...certificazioniDa(v), personalizzati: Boolean(v) };
}

/**
 * Collegamento alla Politica Integrata per il cliente: la pagina /doc/<codice> del Portale Service pubblico, che apre sempre la revisione
 * in vigore del documento SGI (come il pulsante "Apri il documento" della pagina Certificazioni). Origine dello specchio del Portale
 * Service se è un https pubblico, altrimenti quella di produzione.
 */
async function urlPolitica(code) {
  const codice = String(code || '').replace(/_\d+$/, '');
  if (!codice) return null;
  let base = 'https://service.toscanadiagnostica.it';
  try {
    const S = await import('../../service/lib/specchio.js');
    const o = String((await S.origine())?.url || '').replace(/\/+$/, '');
    if (/^https:\/\//.test(o) && !/localhost|127\.0\.0\.1/.test(o)) base = o;
  } catch { /* modulo Service assente: origine di produzione */ }
  return `${base}/doc/${encodeURIComponent(codice)}`;
}

// ---------------------------------------------------------------- dati
async function owner(userId) {
  if (!userId) return null;
  // nome nell'ordine naturale (Nome Cognome: va nelle frasi della lettera); ruolo = mansione della persona (users.title è il titolo, es. "Dott.")
  const u = await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS full_name,
      u.email, coalesce(nullif(p.phone_office,''), nullif(u.phone,'')) AS telefono, nullif(p.job_title,'') AS ruolo, nullif(p.phone_office,'') AS fisso, nullif(u.phone,'') AS altro
    FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [userId]);
  return u ? { nome: u.full_name, email: u.email || null, telefono: u.telefono || null, telefoni: telefoni({ fisso: u.fisso, altro: u.altro }), ruolo: u.ruolo || null } : null;
}

/**
 * Contatto del CEO per la prima riga della tabella dei referenti (richiesta del CEO del 07/11/2026): nome e ruolo dal legale
 * rappresentante (Impostazioni, lr_name e lr_role), email lr_email; telefoni dall'anagrafica della persona con quell'email (telefono
 * d'ufficio di public.people, telefono dell'utente), in mancanza il telefono del legale rappresentante delle Impostazioni (lr_phone).
 * Il cellulare personale (people.phone) non si pubblica. Nessun numero inventato: se non c'è, la cella resta vuota.
 */
export async function contattoCeo(s) {
  const email = String(s.lr_email || '').trim();
  let x = null;
  if (email) {
    x = await one(`SELECT nullif(p.phone_office,'') AS fisso, nullif(u.phone,'') AS altro,
        nullif(trim(concat_ws(' ', p.first_name, p.last_name)),'') AS nome_persona, nullif(u.full_name,'') AS nome_utente
      FROM (SELECT 1) z
      LEFT JOIN public.users u ON lower(u.email)=lower($1) AND NOT coalesce(u.is_external, false)
      LEFT JOIN public.people p ON p.id = u.person_id OR (u.person_id IS NULL AND lower(p.email)=lower($1))
      ORDER BY (p.phone_office IS NOT NULL) DESC LIMIT 1`, [email]);
  }
  const tel = telefoni({ fisso: x?.fisso || s.lr_phone || null, altro: x?.altro });
  return { nome: s.lr_name || x?.nome_persona || x?.nome_utente || '', ruolo: s.lr_role || 'Chief Executive Officer', email: email || null, telefoni: tel };
}

/** Contratto della linea e lettera di offerta generata (ultima versione), o null. */
export async function offertaDi(a) {
  // Punti Prelievo: una Legal entity può ospitare più punti, vince il contratto della sede del punto (poi quello senza sede)
  const c = await one(`SELECT c.id, c.kind, c.protocol, c.status, c.version, c.signed_at, c.title, c.site_id, c.data FROM contracts c WHERE c.org_id=$1 AND c.kind=$2 AND c.status NOT IN ('ANNULLATO','CESSATO')
      AND ($3::int IS NULL OR c.site_id IS NULL OR c.site_id=$3)
    ORDER BY CASE WHEN $3::int IS NULL OR c.site_id=$3 THEN 0 ELSE 1 END, c.updated_at DESC NULLS LAST, c.id DESC LIMIT 1`, [a.organization_id, a.linea, a.linea === 'PP' ? a.pp_site_id || null : null]);
  if (!c) return { contratto: null, file: null };
  // meta.allegato1_offerta: versione del listino la cui offerta economica è già nell'Allegato 1 del PDF (contratto Service)
  const f = await one(`SELECT id, filename, size, version, data, blob_path, meta, created_at FROM contract_files WHERE contract_id=$1 AND category='GENERATO_PDF' ORDER BY version DESC, created_at DESC LIMIT 1`, [c.id]);
  // contratto firmato caricato (l'ultimo PDF): nel pacchetto è il documento vero
  const firmato = await one(`SELECT id, filename, size, version, data, blob_path, meta, created_at FROM contract_files WHERE contract_id=$1 AND category='FIRMATO'
      AND (mime='application/pdf' OR filename ILIKE '%.pdf') ORDER BY created_at DESC, id DESC LIMIT 1`, [c.id]);
  return { contratto: c, file: f, firmato };
}

/** Versione corrente del listino dell'account Service ({ id, versione, caricato_at, offerta_documento_id }) o null. */
async function listinoCorrente(a) {
  if (a.linea !== 'SRV') return null;
  return versioneCorrente(await many('SELECT id, versione, caricato_at, offerta_documento_id FROM listini WHERE account_id=$1', [a.id]), a.listino_corrente_id) || null;
}

/**
 * Lettera di offerta del pacchetto (terza richiesta del CEO del 07/11/2026: nel pacchetto c'era il PDF salvato giorni prima con il
 * template vecchio). Regola:
 * - contratto con il file FIRMATO (PDF) caricato: si usa il firmato, il documento vero; l'offerta economica corrente si aggiunge come
 *   sezione a sé se la versione del listino è cambiata dopo la firma (listinoDopoLaFirma);
 * - senza firmato (bozza, proposta, o anche attivo/firmato importato senza PDF firmato): la lettera si RENDERIZZA dal contratto corrente
 *   con il template e il codice attuali (rigeneraDalPacchetto: firma TD, Allegato 1 = offerta economica della versione corrente,
 *   Politica in coda) e sostituisce il GENERATO_PDF/GENERATO_DOCX della versione corrente (stessa versione, evento GENERATO);
 * - se la rigenerazione non si può fare (contratto mai generato, dati incompleti, LibreOffice assente) resta il PDF salvato, con l'avviso.
 * attiva = false (sezione esclusa o variante senza offerta): nessuna rigenerazione, solo la fonte prevista.
 * Ritorna { fonte: 'FIRMATO' | 'RIGENERATA' | 'SALVATA' | null, file, pdf (Buffer o null se non letto), nellaLettera (l'offerta economica
 * della versione corrente è già nella lettera), a1 (meta.allegato1_offerta per il segnalibro interno, solo per il PDF generato) }.
 */
export async function letteraDiOfferta(a, off, { attiva = true, userId = null, avvisi = [] } = {}) {
  const out = { fonte: null, file: off.file || null, pdf: null, nellaLettera: false, a1: null };
  if (!off.contratto) return out;
  const cor = await listinoCorrente(a);
  if (off.firmato) {
    out.fonte = 'FIRMATO'; out.file = off.firmato;
    if (cor) {
      // meta del PDF generato della stessa versione del firmato (se c'è): dice se quella lettera aveva già questa versione del listino
      const gen = await one(`SELECT meta FROM contract_files WHERE contract_id=$1 AND category='GENERATO_PDF' AND version=$2 ORDER BY created_at DESC LIMIT 1`, [off.contratto.id, off.firmato.version]);
      out.nellaLettera = !listinoDopoLaFirma(cor.caricato_at, { signedAt: off.contratto.signed_at, caricatoFirmatoAt: off.firmato.created_at, meta: gen?.meta, listinoId: cor.id });
    }
    if (attiva) {
      out.pdf = await readBuffer(off.firmato);
      if (!out.pdf || !(await contaPagine(out.pdf))) { avvisi.push('Il PDF del contratto firmato non è leggibile: nel pacchetto la lettera di offerta salvata'); out.pdf = null; out.fonte = off.file ? 'SALVATA' : null; out.file = off.file || null; out.nellaLettera = Boolean(off.file && cor && letteraConOfferta(off.file.meta, cor.id)); }
    }
    return out;
  }
  if (!attiva) {
    // previsione senza rigenerare (composizione nella scheda): la lettera rigenerata conterrà l'offerta della versione corrente
    out.fonte = off.contratto.protocol && off.contratto.kind !== 'SEDE' ? 'RIGENERATA' : off.file ? 'SALVATA' : null;
    out.nellaLettera = Boolean(cor && (out.fonte === 'RIGENERATA' || letteraConOfferta(off.file?.meta, cor.id)));
    return out;
  }
  try {
    const r = await rigeneraDalPacchetto(off.contratto.id, userId);
    out.fonte = 'RIGENERATA'; out.file = r.file; out.pdf = r.pdf;
    for (const x of r.avvisi || []) avvisi.push(`Lettera di offerta: ${x}`);
  } catch (e) {
    if (off.file) avvisi.push(`Lettera di offerta non rigenerata (${e.message}): nel pacchetto il PDF salvato della versione ${off.file.version}, generato il ${dataBreve(off.file.created_at ? new Date(off.file.created_at).toISOString() : '')}`);
    else if (off.contratto.protocol) avvisi.push(`Lettera di offerta non generata (${e.message})`);
    out.fonte = off.file ? 'SALVATA' : null;
  }
  if (out.file && cor && letteraConOfferta(out.file.meta, cor.id)) { out.nellaLettera = true; out.a1 = out.file.meta.allegato1_offerta; }
  return out;
}
const pct = (x) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Math.abs(Number(x)) * 100)}%`;
const eur = (x) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(x));
/** Righe dell'offerta economica dai dati della proposta dell'account (solo quelli presenti; mai i fatturati attesi, che sono interni). */
export function propostaDi(a) {
  const out = [];
  if (a.listino_riferimento) out.push({ voce: 'Listino di riferimento', valore: a.listino_riferimento });
  if (a.sconto_medio != null && Number(a.sconto_medio) < 0) out.push({ voce: 'Sconto medio sul listino', valore: pct(a.sconto_medio) });   // frazione negativa = sotto listino
  if (a.prezzo_medio_esame != null && Number(a.prezzo_medio_esame) > 0) out.push({ voce: 'Prezzo medio per esame', valore: eur(a.prezzo_medio_esame) });
  if (a.volume_fy_atteso != null && Number(a.volume_fy_atteso) > 0) out.push({ voce: 'Volume annuo stimato', valore: `${new Intl.NumberFormat('it-IT').format(Math.round(a.volume_fy_atteso))} esami` });
  return out;
}

async function accessiEsterni(orgId) {
  return many(`SELECT u.full_name AS nome, u.email, u.status, u.last_login_at AS ultimo_accesso,
      (SELECT string_agg(DISTINCT ap.name, ', ') FROM public.grants g JOIN public.access_profiles ap ON ap.id=g.profile_id WHERE g.user_id=u.id) AS profilo
    FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id
    WHERE u.is_external AND u.status <> 'DISABLED' AND coalesce(p.organization_id, u.organization_id)=$1 ORDER BY u.full_name`, [orgId]);
}

/** Credenziali del portale referti: prima quelle del contratto della linea, poi quelle della Legal entity. Password decifrata solo se serve. */
async function credenzialiPortale(orgId, contrattoId, conPassword, avvisi) {
  const c = contrattoId ? await one('SELECT portal_url, username, password_enc FROM portal_credentials WHERE contract_id=$1', [contrattoId]) : null;
  const o = await one('SELECT portal_url, portal_username AS username, portal_password_enc AS password_enc FROM org_ext WHERE org_id=$1', [orgId]);
  const x = (c && (c.portal_url || c.username)) ? { ...c, fonte: 'contratto' } : (o && (o.portal_url || o.username)) ? { ...o, fonte: 'Legal entity' } : null;
  if (!x) return null;
  let password = null;
  if (conPassword) {
    if (!x.password_enc) avvisi.push('Password del portale referti non registrata: nel pacchetto risulta "comunicata separatamente"');
    else { try { password = decrypt(x.password_enc); } catch (e) { avvisi.push(`Password del portale referti non leggibile (${e.message}): nel pacchetto risulta "comunicata separatamente"`); } }
  }
  return { portal_url: x.portal_url, username: x.username, password, fonte: x.fonte, ha_password: Boolean(x.password_enc) };
}

async function sla(orgId) {
  const out = { nc_ore: null, ticket: [] };
  if (await moduloAttivo('nc')) {
    try {
      const e = await one('SELECT sla_ore FROM nc.org_ext WHERE org_id=$1', [orgId]);
      const g = await one(`SELECT value FROM nc.app_settings WHERE key='sla_ore_default'`);
      const v = Number(e?.sla_ore || g?.value);
      if (v > 0) out.nc_ore = v;
    } catch { /* schema NC diverso o non migrato: nessun numero */ }
  }
  if (await moduloAttivo('ticket')) {
    try { out.ticket = await many('SELECT priorita, etichetta, prima_risposta_ore, risoluzione_ore FROM ticket.sla ORDER BY priorita'); } catch { out.ticket = []; }
  }
  return out;
}

/** Specchio del Portale Service: contatti, certificazioni e PDF del Vademecum (se il modulo è avviato e il file c'è). */
async function specchio({ vademecum }, avvisi) {
  const out = { contatti: null, certificazioni: null, vademecum: null, vademecumPagine: 0 };
  if (!(await moduloAttivo('service'))) { avvisi.push('Portale Service non avviato: referenti e certificazioni dai soli Dati aziendali, Vademecum come link'); return out; }
  try {
    const S = await import('../../service/lib/specchio.js');
    out.contatti = (await S.contenuto('contatti'))?.json || null;
    out.certificazioni = (await S.contenuto('certificazioni'))?.json || null;
    if (vademecum) {
      try {
        const percorso = await S.vademecumPdf();
        const { file } = await S.leggiFile(percorso);
        const buf = await readBuffer(file);
        const n = buf ? await contaPagine(buf) : 0;
        if (n > 0) { out.vademecum = buf; out.vademecumPagine = n; } else avvisi.push('PDF del Vademecum non leggibile: inserito il link al Vademecum online');
      } catch (e) { avvisi.push(`PDF del Vademecum non disponibile (${e.message}): inserito il link al Vademecum online`); }
    }
  } catch (e) { avvisi.push(`Specchio del Portale Service non leggibile: ${e.message}`); }
  return out;
}

const TIPI_SEDE = { LABORATORIO: 'Laboratorio di Analisi', CENTRO_DIAGNOSTICO: 'Centri diagnostici', POLIAMBULATORIO: 'Poliambulatori', CENTRO_MEDICO: 'Centri medici', PUNTO_PRELIEVI: 'Punti prelievo', ALTRO: 'Altre sedi' };
async function sediRete() {
  const l = await many(`SELECT s.name, s.kind, s.address, s.zip, s.city, s.province FROM public.sites s
    WHERE s.active AND s.kind NOT IN ('SERVICE','HEADQUARTER') AND (s.opened_at IS NULL OR s.opened_at <= CURRENT_DATE)
    ORDER BY array_position(ARRAY['LABORATORIO','CENTRO_DIAGNOSTICO','POLIAMBULATORIO','CENTRO_MEDICO','PUNTO_PRELIEVI','ALTRO'], s.kind), s.name`);
  return l.map((s) => ({ nome: s.name, tipo: TIPI_SEDE[s.kind] || 'Altre sedi', indirizzo: [s.address, [s.zip, s.city].filter(Boolean).join(' ') + (s.province ? ` (${s.province})` : '')].filter((x) => x && x.trim()).join(', ') }));
}

/** Referenti dedicati della linea dai soli dati presenti (specchio del Portale Service e Dati aziendali): per le email del processo. */
export async function referentiPerLinea(a) {
  const [company, s] = await Promise.all([getCompany(), getSettings()]);
  const sp = await specchio({ vademecum: false }, []);
  return referentiDedicati({ contatti: sp.contatti, company, linea: a.linea, casella: casellaLinea(a.linea, s).address });
}

const qrPng = (url) => QRCode.toBuffer(url, { type: 'png', margin: 1, width: 600, errorCorrectionLevel: 'M', color: { dark: '#004F5FFF', light: '#FFFFFFFF' } });

/** Offerta economica dal listino StudioLAB corrente dell'account (processo Service): { documento, versione } o null. */
export async function offertaListino(a) {
  if (a.linea !== 'SRV') return null;
  const v = await many('SELECT id, versione, offerta_documento_id FROM listini WHERE account_id=$1', [a.id]);
  const c = versioneCorrente(v, a.listino_corrente_id);
  if (!c?.offerta_documento_id) return null;
  const doc = await one('SELECT id, filename, size, data, blob_path FROM documenti WHERE id=$1', [c.offerta_documento_id]);
  return doc ? { documento: doc, versione: c.versione, listino_id: c.id } : null;
}
/** Credenziali StudioLAB (portale dei referti) senza password: { url, username, ha_password, fonte } o null. */
export async function credenzialiStudiolab(a) {
  const { contratto } = await offertaDi(a);
  const c = await credenzialiPortale(a.organization_id, contratto?.id, false, []);
  return c ? { url: c.portal_url, username: c.username, ha_password: c.ha_password, fonte: c.fonte } : null;
}
/** Modelli dei testi del processo Service (Impostazioni, app_settings flusso.modelli). */
export async function modelliFlusso() {
  const x = await one(`SELECT value FROM app_settings WHERE key='flusso.modelli'`);
  return modelliFlussoDa(x?.value || null);
}

/**
 * Disponibilità per la composizione (senza generare): tipo di offerta, Vademecum, accessi, credenziali del portale.
 */
export async function disponibilita(a, { variante = 'BENVENUTO' } = {}) {
  const off = await offertaDi(a);
  const { contratto } = off;
  // previsione della lettera di offerta senza rigenerarla: firmato, rigenerata alla generazione del pacchetto o salvata
  const lett = await letteraDiOfferta(a, off, { attiva: false });
  const file = lett.file;
  const proposta = propostaDi(a);
  const offerta = lett.fonte ? 'PDF' : proposta.length ? 'ECONOMICA' : null;
  const cred = await credenzialiPortale(a.organization_id, contratto?.id, false, []);
  const accessi = await accessiEsterni(a.organization_id);
  const ol = await offertaListino(a);
  const nellaLettera = Boolean(lett.fonte && ol && lett.nellaLettera);
  return {
    offerta, contratto: contratto ? { id: contratto.id, protocol: contratto.protocol, status: contratto.status, version: contratto.version } : null,
    offerta_file: file ? { id: file.id, filename: file.filename, version: file.version, size: file.size } : null, offerta_fonte: lett.fonte, proposta,
    portale_referti: cred ? { url: cred.portal_url, username: cred.username, ha_password: cred.ha_password, fonte: cred.fonte } : null,
    accessi: accessi.map((x) => ({ nome: x.nome, email: x.email, profilo: x.profilo })),
    service_attivo: await moduloAttivo('service'),
    listino: ol ? { versione: ol.versione, documento_id: ol.documento.id, filename: ol.documento.filename } : null, listino_nella_lettera: nellaLettera,
    studiolab: a.linea === 'SRV' ? Boolean(cred) : undefined, variante,
  };
}

/**
 * Genera il PDF. a = riga dell'account (ACCOUNT_SELECT); opz = { scelte, contatto, includiPassword, data (YYYY-MM-DD), userId (autore
 * della rigenerazione della lettera di offerta) }.
 * Ritorna { pdf, pagine, sezioni: [{ key, titolo, inclusa, motivo, pagina }], avvisi, lettera_fonte, password_inclusa }.
 */
export async function generaPacchetto(a, opz) {
  const avvisi = [];
  const data = opz.data;
  const variante = opz.variante || 'BENVENUTO';
  const [company, s, mod, own, off0, flusso] = await Promise.all([getCompany(), getSettings(), modelli(), owner(a.owner_user_id), offertaDi(a), modelliFlusso()]);
  const proposta = propostaDi(a);
  // lettera di offerta (terza richiesta del CEO del 07/11/2026): il firmato se c'è, altrimenti rigenerata adesso dal contratto corrente
  // con il template attuale (sostituisce i file generati della versione corrente); la rigenerazione si fa solo se la sezione serve
  const vuoleOfferta = variante !== 'PROSPECT' && (opz.scelte || {}).offerta !== false;
  const lett = await letteraDiOfferta(a, off0, { attiva: vuoleOfferta, userId: opz.userId || null, avvisi });
  const off = { ...off0, file: lett.fonte ? lett.file : null };
  // contratto firmato e listino cambiato dopo la firma: l'offerta economica della versione corrente entra come sezione a sé (si genera
  // adesso se per quella versione manca, come per l'Allegato 1)
  if (vuoleOfferta && lett.fonte === 'FIRMATO' && !lett.nellaLettera && a.linea === 'SRV' && !(await offertaListino(a))) {
    const cor = await listinoCorrente(a);
    if (cor) {
      try { await offertaAllegato1({ account_id: a.id, data: off.contratto.data || {} }, cor.id, s, opz.userId || null); } catch (e) { avvisi.push(`Offerta economica v${cor.versione} non generata (${e.message}): sezione omessa`); }
    }
  }
  const ol = await offertaListino(a);
  const tipoOfferta = lett.fonte ? 'PDF' : proposta.length ? 'ECONOMICA' : null;
  const credSl = a.linea === 'SRV' ? await credenzialiPortale(a.organization_id, off.contratto?.id, false, []) : null;
  // offerta economica già nella lettera di offerta (Allegato 1 della stessa versione del listino, o firmato senza cambi di listino dopo
  // la firma): la sezione "Offerta economica" non si ripete; a1 = posizione nel PDF generato, per il segnalibro interno
  const nellaLettera = tipoOfferta === 'PDF' && Boolean(ol) && lett.nellaLettera;
  const a1 = nellaLettera && lett.a1 && Number(lett.a1.listino_id) === Number(ol.listino_id) ? lett.a1 : null;
  const sezioni = componiSezioni(a.linea, opz.scelte || {}, { offerta: tipoOfferta, listino: Boolean(ol), listinoNellaLettera: nellaLettera, studiolab: a.linea === 'SRV' ? Boolean(credSl) : undefined, variante, owner: Boolean(own) });
  if (lett.fonte === 'FIRMATO') { const o = sezioni.find((x) => x.key === 'offerta'); if (o) o.titolo = a.linea === 'PP' ? 'Contratto firmato' : 'Lettera di offerta firmata'; }
  const incl = (k) => sezioni.some((x) => x.key === k && x.inclusa);
  if (!tipoOfferta) avvisi.push('Offerta omessa: nessuna lettera di offerta generata per il contratto della linea e nessun dato della proposta nell\'account');
  else if (tipoOfferta === 'ECONOMICA' && incl('offerta')) avvisi.push('Lettera di offerta non ancora generata: inserita la pagina "Offerta economica" con i dati della proposta');
  if (!own) avvisi.push('Account senza owner: copertina e pagina del referente senza nome');

  // la versione per i prospect porta il Vademecum come link e QR (niente centinaia di pagine in un'email di presentazione)
  const sp = await specchio({ vademecum: incl('vademecum') && variante !== 'PROSPECT' && opz.vademecumPagine !== false }, avvisi);
  const casella = casellaLinea(a.linea, s).address;
  const url = suiteUrl();
  const portaleUrl = a.linea === 'SRV' ? `${url}/service` : url;
  const lineaLabel = LINEE[a.linea].label;
  const cliente = a.org_name;
  const indirizzoCliente = [a.org_address, [a.org_zip, a.citta].filter(Boolean).join(' ') + (a.prov ? ` (${a.prov})` : '')].filter((x) => x && String(x).trim()).join(', ');
  const destinatario = opz.contatto?.nome || null;
  const valori = valoriSegnaposto({ cliente, referente: destinatario, data, owner: own?.nome });
  const referenti = referentiDedicati({ contatti: sp.contatti, company, linea: a.linea, casella });
  // tabella dei referenti del pacchetto: CEO in prima riga, poi i referenti della linea e l'owner dell'account
  const tabellaReferenti = righeReferenti({ ceo: await contattoCeo(s), referenti, owner: own });
  const firma = { nome: s.lr_name || 'Francesco Epifani', ruolo: s.lr_role || 'Chief Executive Officer' };
  const accessi = incl('credenziali') ? await accessiEsterni(a.organization_id) : [];
  // credenziali del portale dei referti: nella pagina StudioLAB se la sezione c'è, altrimenti (PP, MDL) nella pagina degli accessi
  const conStudiolab = incl('studiolab');
  const portaleRef = incl('credenziali') || conStudiolab ? await credenzialiPortale(a.organization_id, off.contratto?.id, Boolean(opz.includiPassword), avvisi) : null;
  const credTutte = paginaCredenziali({ suiteUrl: portaleUrl, accessi, portale: portaleRef, includiPassword: Boolean(opz.includiPassword) });
  const cred = { ...credTutte, referti: conStudiolab || sezioni.some((x) => x.key === 'studiolab') ? null : credTutte.referti };
  if (incl('credenziali') && !accessi.length) avvisi.push('La Legal entity non ha ancora accessi esterni: crearli da Amministrazione > Legal entity > Accessi (Crea accesso esterno)');
  const certJson = sp.certificazioni;
  // Qualità e certificazioni: certificati dallo specchio del Portale Service, testi e standard dalle Impostazioni, Autorizzazione
  // Sanitaria dai Dati aziendali, Politica Integrata dallo specchio SGI (stesso documento dell'Allegato 8 del contratto)
  let qualita = null;
  if (incl('diversi')) {
    const pol = await politicaQualita();
    const politica = pol.doc ? { ...pol.doc, url: await urlPolitica(pol.doc.code) } : null;
    if (!politica) avvisi.push(`Qualità e certificazioni senza il collegamento alla Politica Integrata: ${pol.avviso || 'documento non disponibile dallo specchio SGI'}`);
    qualita = qualitaCertificazioni({ cert: certJson, testi: await testiCertificazioni(), autorizzazione: company.health_authorization, politica });
    if (!qualita.certificati.length) avvisi.push('Qualità e certificazioni senza la tabella dei certificati: certificazioni.json non disponibile dallo specchio del Portale Service');
    for (const x of qualita.differenze) avvisi.push(`Certificazioni: l'elenco degli standard indica ${x.standard}, il certificato ${x.numero} dello specchio ${x.certificato}: nel pacchetto vale il certificato`);
    if (!qualita.autorizzazione) avvisi.push('Autorizzazione Sanitaria non indicata nei Dati aziendali: riga omessa');
  }
  const d = {
    data, cliente, indirizzoCliente, destinatario, linea: a.linea, lineaLabel, owner: own, casella, company, referenti: tabellaReferenti, firma, luogo: company.city || 'Sesto Fiorentino',
    testoLettera: variante === 'BENVENUTO' ? sostituisci(mod.lettera[a.linea], valori) : compila(flusso.lettera_presentazione, { ...valori, referenti: '{{referenti}}' }),
    titoloLettera: variante === 'BENVENUTO' ? null : 'Vi presentiamo Toscana Diagnostica',
    kicker: { KIT: 'PROPOSTA DI COLLABORAZIONE', PROSPECT: 'PRESENTAZIONE' }[variante] || null, titoloPre: variante === 'BENVENUTO' ? null : 'Vi presentiamo',
    studiolab: conStudiolab ? credTutte.referti : null, suiteHost: url.replace(/^https?:\/\//, ''), portaleUrl, sla: incl('portale') ? await sla(a.organization_id) : {},
    laboratorio: contattoLaboratorio(sp.contatti), credenziali: cred, piano: pianoAvvio(a.linea, data), certificazioni: certificazioniIso(certJson), organismo: certJson?.organismo?.nome || null, qualita,
    checklist: checklist(a.linea, { data, offerta: incl('offerta'), firmata: ['FIRMATO', 'AUTORIZZATO', 'ATTIVO'].includes(off.contratto?.status) }),
    aiuto: own?.nome ? `Scrivete o chiamate ${own.nome}${own.email ? ` (${own.email}${own.telefono ? `, ${own.telefono}` : ''})` : ''}, oppure il supporto clienti${company.support_email ? ` a ${company.support_email}` : ''}.` : `Scrivete a ${casella}${company.support_email ? ` o al supporto clienti, ${company.support_email}` : ''}.`,
    proposta, sedi: incl('network') ? await sediRete() : [], vademecumUrl: VADEMECUM_ONLINE,
    qrDidascalia: a.linea === 'SRV' ? 'Inquadrate per aprire il Portale Service' : 'Inquadrate per aprire la Suite',
  };
  const qrSuite = await qrPng(portaleUrl);
  d.qr = true; d.qrCred = true;

  // DOCX delle sezioni nostre (l'indice dopo, con i numeri di pagina)
  const nostre = [];   // { key, docx }
  const imgSuite = (rId) => [{ rId, nome: `${rId}.png`, buffer: qrSuite }];
  for (const x of sezioni.filter((y) => y.inclusa && y.key !== 'indice')) {
    switch (x.key) {
      case 'copertina': nostre.push({ key: x.key, docx: D.costruisci(D.copertina(d), imgSuite('rIdQrCopertina')) }); break;
      case 'lettera': nostre.push({ key: x.key, docx: D.costruisci(D.lettera(d)) }); break;
      case 'offerta': if (tipoOfferta === 'ECONOMICA') nostre.push({ key: x.key, docx: D.costruisci(D.offertaEconomica(d)) }); break;
      case 'portale': nostre.push({ key: x.key, docx: D.costruisci(D.portale(d)) }); break;
      case 'network': nostre.push({ key: x.key, docx: D.costruisci(D.network(d)) }); break;
      case 'mdl': nostre.push({ key: x.key, docx: D.costruisci(D.mdl(d)) }); break;
      case 'credenziali': nostre.push({ key: x.key, docx: D.costruisci(D.credenziali(d), imgSuite('rIdQrCred')) }); break;
      case 'studiolab': if (d.studiolab) nostre.push({ key: x.key, docx: D.costruisci(D.studiolab(d)) }); break;
      case 'avvio': nostre.push({ key: x.key, docx: D.costruisci(D.avvio(d)) }); break;
      case 'referente': nostre.push({ key: x.key, docx: D.costruisci(D.referente(d)) }); break;
      case 'diversi': nostre.push({ key: x.key, docx: D.costruisci(D.diversi(d), [], qualita?.politica?.url ? [{ rId: 'rIdPolitica', url: qualita.politica.url }] : []) }); break;
      case 'checklist': nostre.push({ key: x.key, docx: D.costruisci(D.checklist(d)) }); break;
      case 'vademecum': nostre.push({ key: x.key, docx: D.costruisci(D.vademecumLink(d, { allegato: Boolean(sp.vademecum), pagine: sp.vademecumPagine }), [{ rId: 'rIdQrVad', nome: 'rIdQrVad.png', buffer: await qrPng(VADEMECUM_ONLINE) }]) }); break;
      default: break;
    }
  }
  const pdfs = await docxToPdfBatch(nostre.map((x) => x.docx));
  const pdfDi = Object.fromEntries(nostre.map((x, i) => [x.key, pdfs[i]]));
  let offertaPdf = null;
  if (incl('offerta') && tipoOfferta === 'PDF') {
    offertaPdf = lett.pdf || await readBuffer(off.file);
    if (!offertaPdf || !(await contaPagine(offertaPdf))) {
      avvisi.push('Il PDF della lettera di offerta non è leggibile: sezione omessa'); offertaPdf = null; const o = sezioni.find((y) => y.key === 'offerta'); o.inclusa = false; o.motivo = 'PDF della lettera di offerta non leggibile';
      // senza la lettera l'offerta economica torna sezione a sé
      const l = sezioni.find((y) => y.key === 'listino' && y.nellaLettera);
      if (l) { l.inclusa = true; l.nellaLettera = false; l.motivo = null; }
    }
  }
  // pagine dell'offerta economica dentro la lettera (1-based nella lettera), per l'indice e il segnalibro; solo se coerenti con il PDF
  const a1Dentro = offertaPdf && a1 && sezioni.some((y) => y.key === 'listino' && y.nellaLettera) && a1.pagina >= 1 && a1.pagina + a1.pagine - 1 <= await contaPagine(offertaPdf) ? a1 : null;
  // offerta economica dal listino StudioLAB (PDF già impaginato sulla stessa carta, con i suoi numeri: si coprono con quelli del pacchetto)
  let listinoPdf = null;
  if (incl('listino')) {
    listinoPdf = await readBuffer(ol.documento);
    if (!listinoPdf || !(await contaPagine(listinoPdf))) { avvisi.push('Il PDF dell\'offerta economica non è leggibile: sezione omessa'); listinoPdf = null; const o = sezioni.find((y) => y.key === 'listino'); o.inclusa = false; o.motivo = 'PDF dell\'offerta economica non leggibile'; }
  }
  const studio = sezioni.find((y) => y.key === 'studiolab');
  if (studio?.inclusa && !d.studiolab) { studio.inclusa = false; studio.motivo = 'Nessuna credenziale StudioLAB registrata'; }
  // Parti nell'ordine di stampa (l'indice per ora vale una pagina)
  const parti = [];
  for (const x of sezioni.filter((y) => y.inclusa)) {
    if (x.key === 'indice') { parti.push({ key: 'indice', titolo: 'Indice', pdf: null, numero: 'piede' }); continue; }
    // l'offerta è sulla stessa carta intestata: il suo numero di pagina si copre con quello del pacchetto; il Vademecum ha il suo piè
    if (x.key === 'offerta' && tipoOfferta === 'PDF') {
      parti.push({ key: x.key, titolo: x.titolo, pdf: offertaPdf, numero: 'copri', segnalibriInterni: a1Dentro ? [{ titolo: `Offerta economica (Allegato 1, v${a1Dentro.versione})`, pagina: a1Dentro.pagina }] : [] });
      continue;
    }
    if (x.key === 'listino') { parti.push({ key: x.key, titolo: x.titolo, pdf: listinoPdf, numero: 'copri' }); continue; }
    parti.push({ key: x.key, titolo: x.titolo, pdf: pdfDi[x.key], numero: 'piede' });
    if (x.key === 'vademecum' && sp.vademecum) parti.push({ key: 'vademecum_pdf', titolo: 'Vademecum degli esami (pagine)', pdf: sp.vademecum, numero: 'testa', segnalibro: false });
  }
  const nota = (k, inizi) => {
    if (k === 'offerta' && tipoOfferta === 'PDF' && lett.fonte === 'FIRMATO') {
      return [off.contratto.protocol ? `Contratto ${off.contratto.protocol}` : null, `versione ${off.file.version}`,
        off.contratto.signed_at ? `firmato il ${dataBreve(off.contratto.signed_at)}` : 'firmato'].filter(Boolean).join(', ');
    }
    if (k === 'offerta' && tipoOfferta === 'PDF') {
      return [off.contratto.protocol ? `Proposta ${off.contratto.protocol}` : null, `versione ${off.file.version}`,
        a1Dentro ? `con l'offerta economica v${a1Dentro.versione} nell'Allegato 1 (da pagina ${inizi.offerta + a1Dentro.pagina - 1})` : null].filter(Boolean).join(', ');
    }
    if (k === 'vademecum') return sp.vademecum ? `Guida operativa per i laboratori clienti, ${sp.vademecumPagine} pagine` : 'Online, con il QR code';
    if (k === 'lettera') return `${firma.nome}, ${firma.ruolo}`;
    if (k === 'listino' && ol) return `Dal listino StudioLAB, versione ${ol.versione}`;
    return null;
  };
  let pagineIndice = 1; let indicePdf = null;
  for (let giro = 0; giro < 3; giro++) {
    const conteggi = [];
    for (const x of parti) conteggi.push({ key: x.key, pagine: x.key === 'indice' ? pagineIndice : await contaPagine(x.pdf) });
    const inizi = paginaIniziale(conteggi);
    const voci = parti.filter((x) => !['copertina', 'indice', 'vademecum_pdf'].includes(x.key)).map((x, i) => ({ n: i + 1, titolo: x.titolo, pagina: inizi[x.key], nota: nota(x.key, inizi) }));
    // l'offerta economica dentro la lettera non è "non inclusa"
    const omesse = sezioni.filter((x) => !x.inclusa && !x.nellaLettera).map((x) => x.titolo);
    [indicePdf] = await docxToPdfBatch([D.costruisci(D.indice(voci, { omesse }))]);
    const n = await contaPagine(indicePdf);
    if (n === pagineIndice) break;
    pagineIndice = n;
  }
  parti.find((x) => x.key === 'indice').pdf = indicePdf;
  const titoli = { BENVENUTO: `Benvenuti in Toscana Diagnostica · ${cliente}`, KIT: `Proposta di collaborazione · ${cliente}`, PROSPECT: `Toscana Diagnostica · presentazione per ${cliente}` };
  const out = await assembla(parti, { titolo: titoli[variante] || titoli.BENVENUTO, etichettaEsterne: variante === 'BENVENUTO' ? 'Pacchetto di benvenuto' : variante === 'KIT' ? 'Proposta di collaborazione' : 'Presentazione' });
  for (const x of sezioni) x.pagina = out.inizi[x.key] || null;
  const sl = sezioni.find((x) => x.key === 'listino' && x.nellaLettera);
  if (sl && a1Dentro && out.inizi.offerta) sl.pagina = out.inizi.offerta + a1Dentro.pagina - 1;
  return { pdf: out.pdf, pagine: out.pagine, sezioni, avvisi, lettera_fonte: lett.fonte, password_inclusa: Boolean(credTutte.password_inclusa && (incl('studiolab') || incl('credenziali'))), offerta: tipoOfferta, data, variante, referenti_testo: referentiTesto(referenti) };
}

/** Testo e oggetto dell'email di accompagnamento con i segnaposto sostituiti. */
export async function emailPacchetto(a, { contatto, data }) {
  const mod = await modelli();
  const own = await owner(a.owner_user_id);
  const valori = valoriSegnaposto({ cliente: a.org_name, referente: contatto?.nome, data, owner: own?.nome });
  return { oggetto: sostituisci(mod.oggetto, valori), testo: sostituisci(mod.email, valori) };
}
