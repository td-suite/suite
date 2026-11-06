// Business Hub · Pacchetto di benvenuto: raccolta dei dati (solo dati presenti nella Suite) e generazione del PDF unico.
// Fonti: account e Legal entity (Business Hub), owner (utenti e persone), contratto della linea con la lettera di offerta generata
// (contract_files GENERATO_PDF: MOD230 service, MOD231 MdL, contratto del punto prelievi) o, in mancanza, i dati della proposta
// dell'account; Dati aziendali (company.js); specchio del Portale Service (contatti.json, certificazioni.json, PDF del Vademecum);
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
} from './pacchetto.js';
import * as D from './pacchettoDocx.js';
import { assembla, contaPagine, paginaIniziale } from './pacchettoPdf.js';

export const CHIAVE_LETTERA = 'pacchetto.lettera_ceo';
export const CHIAVE_EMAIL = 'pacchetto.email';
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

// ---------------------------------------------------------------- dati
async function owner(userId) {
  if (!userId) return null;
  // nome nell'ordine naturale (Nome Cognome: va nelle frasi della lettera); ruolo = mansione della persona (users.title è il titolo, es. "Dott.")
  const u = await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS full_name,
      u.email, coalesce(nullif(p.phone_office,''), nullif(u.phone,'')) AS telefono, nullif(p.job_title,'') AS ruolo
    FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [userId]);
  return u ? { nome: u.full_name, email: u.email || null, telefono: u.telefono || null, ruolo: u.ruolo || null } : null;
}

/** Contratto della linea e lettera di offerta generata (ultima versione), o null. */
export async function offertaDi(a) {
  const c = await one(`SELECT c.id, c.protocol, c.status, c.version, c.signed_at, c.title FROM contracts c WHERE c.org_id=$1 AND c.kind=$2 AND c.status NOT IN ('ANNULLATO','CESSATO')
    ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 1`, [a.organization_id, a.linea]);
  if (!c) return { contratto: null, file: null };
  const f = await one(`SELECT id, filename, size, version, data, blob_path FROM contract_files WHERE contract_id=$1 AND category='GENERATO_PDF' ORDER BY version DESC, created_at DESC LIMIT 1`, [c.id]);
  return { contratto: c, file: f };
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

const qrPng = (url) => QRCode.toBuffer(url, { type: 'png', margin: 1, width: 600, errorCorrectionLevel: 'M', color: { dark: '#004F5FFF', light: '#FFFFFFFF' } });

/**
 * Disponibilità per la composizione (senza generare): tipo di offerta, Vademecum, accessi, credenziali del portale.
 */
export async function disponibilita(a) {
  const { contratto, file } = await offertaDi(a);
  const proposta = propostaDi(a);
  const offerta = file ? 'PDF' : proposta.length ? 'ECONOMICA' : null;
  const cred = await credenzialiPortale(a.organization_id, contratto?.id, false, []);
  const accessi = await accessiEsterni(a.organization_id);
  return {
    offerta, contratto: contratto ? { id: contratto.id, protocol: contratto.protocol, status: contratto.status, version: contratto.version } : null,
    offerta_file: file ? { id: file.id, filename: file.filename, version: file.version, size: file.size } : null, proposta,
    portale_referti: cred ? { url: cred.portal_url, username: cred.username, ha_password: cred.ha_password, fonte: cred.fonte } : null,
    accessi: accessi.map((x) => ({ nome: x.nome, email: x.email, profilo: x.profilo })),
    service_attivo: await moduloAttivo('service'),
  };
}

/**
 * Genera il PDF. a = riga dell'account (ACCOUNT_SELECT); opz = { scelte, contatto, includiPassword, data (YYYY-MM-DD) }.
 * Ritorna { pdf, pagine, sezioni: [{ key, titolo, inclusa, motivo, pagina }], avvisi, password_inclusa }.
 */
export async function generaPacchetto(a, opz) {
  const avvisi = [];
  const data = opz.data;
  const [company, s, mod, own, off] = await Promise.all([getCompany(), getSettings(), modelli(), owner(a.owner_user_id), offertaDi(a)]);
  const proposta = propostaDi(a);
  const tipoOfferta = off.file ? 'PDF' : proposta.length ? 'ECONOMICA' : null;
  const sezioni = componiSezioni(a.linea, opz.scelte || {}, { offerta: tipoOfferta });
  const incl = (k) => sezioni.some((x) => x.key === k && x.inclusa);
  if (!tipoOfferta) avvisi.push('Offerta omessa: nessuna lettera di offerta generata per il contratto della linea e nessun dato della proposta nell\'account');
  else if (tipoOfferta === 'ECONOMICA' && incl('offerta')) avvisi.push('Lettera di offerta non ancora generata: inserita la pagina "Offerta economica" con i dati della proposta');
  if (!own) avvisi.push('Account senza owner: copertina e pagina del referente senza nome');

  const sp = await specchio({ vademecum: incl('vademecum') }, avvisi);
  const casella = casellaLinea(a.linea, s).address;
  const url = suiteUrl();
  const portaleUrl = a.linea === 'SRV' ? `${url}/service` : url;
  const lineaLabel = LINEE[a.linea].label;
  const cliente = a.org_name;
  const indirizzoCliente = [a.org_address, [a.org_zip, a.citta].filter(Boolean).join(' ') + (a.prov ? ` (${a.prov})` : '')].filter((x) => x && String(x).trim()).join(', ');
  const destinatario = opz.contatto?.nome || null;
  const valori = valoriSegnaposto({ cliente, referente: destinatario, data, owner: own?.nome });
  const referenti = referentiDedicati({ contatti: sp.contatti, company, linea: a.linea, casella });
  const firma = { nome: s.lr_name || 'Francesco Epifani', ruolo: s.lr_role || 'Chief Executive Officer' };
  const accessi = incl('credenziali') ? await accessiEsterni(a.organization_id) : [];
  const portaleRef = incl('credenziali') ? await credenzialiPortale(a.organization_id, off.contratto?.id, Boolean(opz.includiPassword), avvisi) : null;
  const cred = paginaCredenziali({ suiteUrl: portaleUrl, accessi, portale: portaleRef, includiPassword: Boolean(opz.includiPassword) });
  if (incl('credenziali') && !accessi.length) avvisi.push('La Legal entity non ha ancora accessi esterni: crearli da Amministrazione > Legal entity > Accessi (Crea accesso esterno)');
  const certJson = sp.certificazioni;
  const d = {
    data, cliente, indirizzoCliente, destinatario, linea: a.linea, lineaLabel, owner: own, casella, company, referenti, firma, luogo: company.city || 'Sesto Fiorentino',
    testoLettera: sostituisci(mod.lettera[a.linea], valori), suiteHost: url.replace(/^https?:\/\//, ''), portaleUrl, sla: incl('portale') ? await sla(a.organization_id) : {},
    laboratorio: contattoLaboratorio(sp.contatti), credenziali: cred, piano: pianoAvvio(a.linea, data), certificazioni: certificazioniIso(certJson), organismo: certJson?.organismo?.nome || null,
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
      case 'avvio': nostre.push({ key: x.key, docx: D.costruisci(D.avvio(d)) }); break;
      case 'referente': nostre.push({ key: x.key, docx: D.costruisci(D.referente(d)) }); break;
      case 'diversi': nostre.push({ key: x.key, docx: D.costruisci(D.diversi(d)) }); break;
      case 'checklist': nostre.push({ key: x.key, docx: D.costruisci(D.checklist(d)) }); break;
      case 'vademecum': nostre.push({ key: x.key, docx: D.costruisci(D.vademecumLink(d, { allegato: Boolean(sp.vademecum), pagine: sp.vademecumPagine }), [{ rId: 'rIdQrVad', nome: 'rIdQrVad.png', buffer: await qrPng(VADEMECUM_ONLINE) }]) }); break;
      default: break;
    }
  }
  const pdfs = await docxToPdfBatch(nostre.map((x) => x.docx));
  const pdfDi = Object.fromEntries(nostre.map((x, i) => [x.key, pdfs[i]]));
  let offertaPdf = null;
  if (incl('offerta') && tipoOfferta === 'PDF') {
    offertaPdf = await readBuffer(off.file);
    if (!offertaPdf || !(await contaPagine(offertaPdf))) { avvisi.push('Il PDF della lettera di offerta non è leggibile: sezione omessa'); offertaPdf = null; const o = sezioni.find((y) => y.key === 'offerta'); o.inclusa = false; o.motivo = 'PDF della lettera di offerta non leggibile'; }
  }
  // Parti nell'ordine di stampa (l'indice per ora vale una pagina)
  const parti = [];
  for (const x of sezioni.filter((y) => y.inclusa)) {
    if (x.key === 'indice') { parti.push({ key: 'indice', titolo: 'Indice', pdf: null, numero: 'piede' }); continue; }
    // l'offerta è sulla stessa carta intestata: il suo numero di pagina si copre con quello del pacchetto; il Vademecum ha il suo piè
    if (x.key === 'offerta' && tipoOfferta === 'PDF') { parti.push({ key: x.key, titolo: x.titolo, pdf: offertaPdf, numero: 'copri' }); continue; }
    parti.push({ key: x.key, titolo: x.titolo, pdf: pdfDi[x.key], numero: 'piede' });
    if (x.key === 'vademecum' && sp.vademecum) parti.push({ key: 'vademecum_pdf', titolo: 'Vademecum degli esami (pagine)', pdf: sp.vademecum, numero: 'testa', segnalibro: false });
  }
  const nota = (k) => {
    if (k === 'offerta' && tipoOfferta === 'PDF') return [off.contratto.protocol ? `Proposta ${off.contratto.protocol}` : null, `versione ${off.file.version}`].filter(Boolean).join(', ');
    if (k === 'vademecum') return sp.vademecum ? `Guida operativa per i laboratori clienti, ${sp.vademecumPagine} pagine` : 'Online, con il QR code';
    if (k === 'lettera') return `${firma.nome}, ${firma.ruolo}`;
    return null;
  };
  let pagineIndice = 1; let indicePdf = null;
  for (let giro = 0; giro < 3; giro++) {
    const conteggi = [];
    for (const x of parti) conteggi.push({ key: x.key, pagine: x.key === 'indice' ? pagineIndice : await contaPagine(x.pdf) });
    const inizi = paginaIniziale(conteggi);
    const voci = parti.filter((x) => !['copertina', 'indice', 'vademecum_pdf'].includes(x.key)).map((x, i) => ({ n: i + 1, titolo: x.titolo, pagina: inizi[x.key], nota: nota(x.key) }));
    const omesse = sezioni.filter((x) => !x.inclusa).map((x) => x.titolo);
    [indicePdf] = await docxToPdfBatch([D.costruisci(D.indice(voci, { omesse }))]);
    const n = await contaPagine(indicePdf);
    if (n === pagineIndice) break;
    pagineIndice = n;
  }
  parti.find((x) => x.key === 'indice').pdf = indicePdf;
  const out = await assembla(parti, { titolo: `Benvenuti in Toscana Diagnostica · ${cliente}` });
  for (const x of sezioni) x.pagina = out.inizi[x.key] || null;
  return { pdf: out.pdf, pagine: out.pagine, sezioni, avvisi, password_inclusa: cred.password_inclusa, offerta: tipoOfferta, data };
}

/** Testo e oggetto dell'email di accompagnamento con i segnaposto sostituiti. */
export async function emailPacchetto(a, { contatto, data }) {
  const mod = await modelli();
  const own = await owner(a.owner_user_id);
  const valori = valoriSegnaposto({ cliente: a.org_name, referente: contatto?.nome, data, owner: own?.nome });
  return { oggetto: sostituisci(mod.oggetto, valori), testo: sostituisci(mod.email, valori) };
}
