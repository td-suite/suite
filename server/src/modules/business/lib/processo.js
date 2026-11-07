// Business Hub · Processo Service da prospect a cliente contrattualizzato (richiesta del CEO del 06/11/2026). Regole pure, senza database
// né rete, usate dalle route, dal job del richiamo e dai test (server/test/business-service-flow.test.mjs):
// - prerequisiti del kit di proposta ("una volta e solo una volta inserito l'excel dell'offerta, tutti i dati del cliente, le credenziali
//   derivanti da StudioLab, prepariamo la mail");
// - token della form pubblica /b2b/<token> (per account, scadenza in giorni, rinnovabile) e riferimento [TD-B2B-...] nell'oggetto;
// - campi del modulo TD-SGI-MOD173 "Anagrafica Clienti B2B", precompilazione dai dati della Suite, confronto con la Legal entity
//   (i campi vuoti si riempiono, le differenze si propongono all'operatore);
// - volumi giornalieri attesi (campo dell'account o volume FY / giorni lavorativi);
// - selezione dei prospect da richiamare (ogni N giorni, limite giornaliero, mai chi è cliente o non vuole essere contattato);
// - modelli dei testi delle email con i segnaposto (modificabili in Impostazioni). Nessun nome, numero o impegno inventato: i valori
//   arrivano dai dati della Suite e una riga senza dato resta vuota.
import crypto from 'node:crypto';

// ---------------------------------------------------------------- token della form pubblica
export const nuovoToken = () => crypto.randomBytes(24).toString('base64url');
export const RIF_LEN = 10;
/** Riferimento breve del token per l'oggetto delle email: [TD-B2B-xxxxxxxxxx] (il link completo è solo nel testo). */
export const rifToken = (token) => String(token || '').slice(0, RIF_LEN);
export const etichettaRif = (token) => `[TD-B2B-${rifToken(token)}]`;
/** Riferimento nell'oggetto di un'email in arrivo (anche dentro "R: ..." o "Fwd: ..."), o null. */
export function rifDaOggetto(subject) {
  const m = String(subject || '').match(/\[\s*TD-B2B-([A-Za-z0-9_-]{6,64})\s*\]/i);
  return m ? m[1].slice(0, RIF_LEN) : null;
}
const isoGiorno = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
export function aggiungiGiorni(data, n) {
  const t = new Date(`${isoGiorno(data)}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + Number(n || 0));
  return t.toISOString().slice(0, 10);
}
/** Scadenza del token: oggi + giorni (Impostazioni hub_b2b_token_giorni, predefinito 60). */
export const scadenzaToken = (oggi, giorni = 60) => aggiungiGiorni(oggi, Number(giorni) > 0 ? Number(giorni) : 60);
/** Stato del token: { valido, motivo } (scade a fine giornata della data di scadenza). */
export function statoToken({ token, scade } = {}, oggi) {
  if (!token) return { valido: false, motivo: 'Collegamento non ancora creato' };
  if (!scade) return { valido: false, motivo: 'Collegamento senza scadenza: rinnovalo' };
  if (isoGiorno(scade) < isoGiorno(oggi)) return { valido: false, motivo: `Collegamento scaduto il ${isoGiorno(scade).split('-').reverse().join('/')}` };
  return { valido: true, motivo: null };
}

// ---------------------------------------------------------------- volumi giornalieri attesi
/** { valore, fonte: 'campo'|'calcolo'|null, testo }: il campo dell'account se c'è, altrimenti volume FY / giorni lavorativi. */
export function volumiGiornalieri({ volumi_giornalieri_attesi: g, volume_fy_atteso: fy } = {}, giorniLavorativi = 250) {
  const fmt = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(n);
  if (g != null && Number(g) > 0) return { valore: Number(g), fonte: 'campo', testo: `${fmt(Number(g))} esami al giorno` };
  const gl = Number(giorniLavorativi) > 0 ? Number(giorniLavorativi) : 250;
  if (fy != null && Number(fy) > 0) { const v = Math.round((Number(fy) / gl) * 10) / 10; return { valore: v, fonte: 'calcolo', testo: `circa ${fmt(v)} esami al giorno (volume annuo atteso ${fmt(Number(fy))} su ${gl} giorni lavorativi)` }; }
  return { valore: null, fonte: null, testo: 'non indicati (compilare "Volumi giornalieri attesi" nella scheda account)' };
}

// ---------------------------------------------------------------- ribaltamento dalla data di avvio
/**
 * Dalla data di avvio e dai dati economici annui ricava volumi e fatturato dell'anno di avvio e dell'anno seguente (07/11/2026, il CEO:
 * "i volumi vanno ribaltati in automatico dalla data di avvio inserita"). Giorni lavorativi = lun-ven, senza festivi (approssimazione
 * dichiarata). Ritorna null senza data o senza dati annui.
 */
export function ribaltaDaAvvio({ data_avvio, volume_fy_atteso: fy, fatturato_fy_atteso: fatt, volumi_giornalieri_attesi: g } = {}, giorniLavorativi = 250) {
  const d = data_avvio ? new Date(`${String(data_avvio).slice(0, 10)}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const gl = Number(giorniLavorativi) > 0 ? Number(giorniLavorativi) : 250;
  const anno = d.getUTCFullYear();
  let residui = 0;
  for (let x = new Date(d); x.getUTCFullYear() === anno; x.setUTCDate(x.getUTCDate() + 1)) { const w = x.getUTCDay(); if (w !== 0 && w !== 6) residui++; }
  const quota = Math.min(1, residui / gl);
  const giorn = g != null && Number(g) > 0 ? Number(g) : fy != null && Number(fy) > 0 ? Number(fy) / gl : null;
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  return {
    anno, giorni_lavorativi_residui: residui, quota_anno: r2(quota), volumi_giornalieri: r2(giorn),
    volume_anno_avvio: giorn != null ? Math.round(giorn * residui) : null,
    fatturato_anno_avvio: fatt != null && Number(fatt) > 0 ? Math.round(Number(fatt) * quota) : null,
    fatturato_anno_seguente: fatt != null && Number(fatt) > 0 ? Math.round(Number(fatt)) : null,
  };
}

// ---------------------------------------------------------------- prerequisiti del kit
/**
 * Checklist del kit. s = { listino, referente, datiMancanti: [], studiolab, accesso, offerta, lettera }.
 * Ritorna { voci: [{ key, label, ok, dettaglio, auto }], pronto }. "Accesso alla Suite" si crea da solo alla preparazione (auto) se
 * c'è un referente con email; tutto il resto deve essere verde.
 */
export function prerequisitiKit(s = {}) {
  const voci = [
    { key: 'listino', label: 'Listino StudioLAB caricato', ok: Boolean(s.listino), dettaglio: s.listino ? `versione ${s.listino.versione}, ${s.listino.esami} esami` : 'carica l\'Excel nella scheda "Listino e offerta"' },
    { key: 'referente', label: 'Referente con email', ok: Boolean(s.referente?.email), dettaglio: s.referente?.email ? `${s.referente.nome} · ${s.referente.email}` : 'aggiungi un referente con email (scheda Referenti)' },
    { key: 'dati', label: 'Dati del cliente completi', ok: !(s.datiMancanti || []).length, dettaglio: (s.datiMancanti || []).length ? `mancano: ${s.datiMancanti.join(', ')}` : 'ragione sociale, P.IVA, indirizzo, città, email o PEC' },
    { key: 'studiolab', label: 'Credenziali StudioLAB presenti', ok: Boolean(s.studiolab?.url || s.studiolab?.username), dettaglio: s.studiolab ? `${s.studiolab.url || ''}${s.studiolab.username ? ` · utente ${s.studiolab.username}` : ''} (${s.studiolab.fonte})` : 'inseriscile nel contratto della linea (Credenziali del portale) o nella Legal entity (Organizzazioni)' },
    { key: 'accesso', label: 'Accesso alla Suite creato', ok: Boolean(s.accesso), auto: !s.accesso && Boolean(s.referente?.email), dettaglio: s.accesso ? `${s.accesso.email}${s.accesso.widget ? `, ${s.accesso.widget} widget` : ', nessun widget fino alla firma'}` : s.referente?.email ? `si crea alla preparazione per ${s.referente.email} (o con "Crea accesso")` : 'serve un referente con email' },
    { key: 'offerta', label: 'Offerta economica', ok: Boolean(s.offerta), dettaglio: s.offerta ? (s.offerta.contratto ? `allegata al contratto: ${s.offerta.filename}` : `generata dal listino v${s.offerta.versione}`) : s.listino ? `genera l'offerta dal listino v${s.listino.versione}` : 'prima il listino' },
    { key: 'lettera', label: 'Lettera di offerta', ok: Boolean(s.lettera), dettaglio: s.lettera ? `${s.lettera.filename}${s.lettera.protocol ? ` (${s.lettera.protocol})` : ''}` : 'genera la proposta MOD230 dal contratto della linea (Contratti)' },
  ];
  return { voci, pronto: voci.every((v) => v.ok || v.auto) };
}

/** Dati del cliente indispensabili (Legal entity): etichette dei mancanti. */
export function datiClienteMancanti(o = {}) {
  const m = [];
  if (!String(o.name || '').trim()) m.push('ragione sociale');
  if (!String(o.vat_number || '').trim()) m.push('P.IVA');
  if (!String(o.address || '').trim()) m.push('indirizzo');
  if (!String(o.city || '').trim()) m.push('città');
  if (!String(o.email || '').trim() && !String(o.pec || '').trim()) m.push('email o PEC');
  return m;
}

// ---------------------------------------------------------------- MOD173 Anagrafica Clienti B2B
// Campi del modulo nell'ordine di stampa: sezione, chiave, etichetta, tipo (t testo, e email, s scelta, b sì/no, m testo lungo),
// destinazione nella Suite (org = public.organizations, ext = business.org_ext) e opzioni
export const SEZIONI_MOD173 = [
  { key: 'registrazione', titolo: 'Registrazione dell\'anagrafica' },
  { key: 'identificazione', titolo: 'Identificazione del cliente / partner' },
  { key: 'servizio', titolo: 'Riferimenti per la gestione del servizio' },
  { key: 'approvvigionamento', titolo: 'Riferimenti per l\'approvvigionamento' },
  { key: 'pagamento', titolo: 'Condizioni di pagamento e classificazione fiscale' },
  { key: 'banca', titolo: 'Istituto di credito di riferimento' },
  { key: 'note', titolo: 'Note' },
];
export const CAMPI_MOD173 = [
  { s: 'registrazione', k: 'stato', label: 'Stato', t: 's', opzioni: ['Attiva', 'Non attiva'] },
  { s: 'registrazione', k: 'business_line', label: 'Business line', t: 's', opzioni: ['B2C', 'Service di Laboratorio', 'Medicina del Lavoro'] },
  { s: 'identificazione', k: 'ragione_sociale', label: 'Ragione sociale', t: 't', req: true, org: 'name' },
  { s: 'identificazione', k: 'piva', label: 'IVA Reg. Nr. / TAX Nr.', t: 't', req: true, org: 'vat_number' },
  { s: 'identificazione', k: 'codice_fiscale', label: 'Codice fiscale', t: 't', org: 'tax_code' },
  { s: 'identificazione', k: 'codice_sdi', label: 'Codice SDI', t: 't', org: 'sdi' },
  { s: 'identificazione', k: 'indirizzo', label: 'Indirizzo fiscale', t: 't', req: true, org: 'address' },
  { s: 'identificazione', k: 'citta', label: 'Città', t: 't', req: true, org: 'city' },
  { s: 'identificazione', k: 'cap', label: 'Codice postale (CAP)', t: 't', org: 'zip' },
  { s: 'identificazione', k: 'nazione', label: 'Nazione', t: 't' },
  { s: 'identificazione', k: 'email', label: 'E-mail', t: 'e', req: true, org: 'email' },
  { s: 'identificazione', k: 'telefono', label: 'Telefono', t: 't', org: 'phone' },
  { s: 'identificazione', k: 'pec', label: 'PEC', t: 'e', org: 'pec' },
  { s: 'identificazione', k: 'servizi_contratto', label: 'Servizi a contratto', t: 't', ext: 'contract_services' },
  { s: 'identificazione', k: 'laboratorio_riferimento', label: 'Laboratorio di riferimento', t: 't', ext: 'lab_reference' },
  { s: 'identificazione', k: 'riferimento_fatturazione', label: 'Riferimento fatturazione', t: 't', ext: 'billing_ref' },
  { s: 'servizio', k: 'svc_contatto', label: 'Contatto di riferimento', t: 't', ext: 'svc_contact' },
  { s: 'servizio', k: 'svc_email', label: 'Mail', t: 'e', ext: 'svc_email' },
  { s: 'servizio', k: 'svc_cellulare', label: 'Cellulare', t: 't', ext: 'svc_mobile' },
  { s: 'servizio', k: 'svc_indirizzo', label: 'Indirizzo', t: 't', ext: 'svc_address' },
  { s: 'approvvigionamento', k: 'proc_contatto', label: 'Contatto di riferimento', t: 't', ext: 'proc_contact' },
  { s: 'approvvigionamento', k: 'proc_email', label: 'Mail', t: 'e', ext: 'proc_email' },
  { s: 'approvvigionamento', k: 'proc_cellulare', label: 'Cellulare', t: 't', ext: 'proc_mobile' },
  { s: 'approvvigionamento', k: 'proc_indirizzo', label: 'Indirizzo', t: 't', ext: 'proc_address' },
  { s: 'pagamento', k: 'metodo_pagamento', label: 'Metodo di pagamento', t: 't', ext: 'pay_method' },
  { s: 'pagamento', k: 'termine_pagamento', label: 'Termine di pagamento', t: 't', ext: 'pay_terms' },
  { s: 'pagamento', k: 'valuta', label: 'Valuta', t: 't', ext: 'currency' },
  { s: 'pagamento', k: 'ritenuta', label: 'Soggetto a ritenuta d\'acconto', t: 'b', ext: 'withholding' },
  { s: 'pagamento', k: 'territorialita_iva', label: 'Territorialità IVA', t: 't', ext: 'vat_territoriality' },
  { s: 'pagamento', k: 'dichiarazione_intento', label: 'Dichiarazione d\'intento IVA', t: 't', ext: 'intent_declaration' },
  { s: 'pagamento', k: 'split_payment', label: 'Split payment', t: 'b', ext: 'split_payment' },
  { s: 'pagamento', k: 'tax_values', label: 'Tax values', t: 't', ext: 'tax_values' },
  // coordinate bancarie della Legal entity (public.organizations dal 26/10/2026: org_ext non le ha più)
  { s: 'banca', k: 'banca_nome', label: 'Nome della banca', t: 't', org: 'bank_name' },
  { s: 'banca', k: 'iban', label: 'IBAN', t: 't', org: 'iban' },
  { s: 'note', k: 'note', label: 'Note', t: 'm' },
];
export const CAMPO_MOD173 = Object.fromEntries(CAMPI_MOD173.map((c) => [c.k, c]));
const LINEA_BUSINESS = { SRV: 'Service di Laboratorio', MDL: 'Medicina del Lavoro', PP: 'B2C' };
const siNo = (v) => (v === true || /^(si|sì|s|true|1|yes)$/i.test(String(v ?? '').trim()) ? 'Sì' : v === false || /^(no|n|false|0)$/i.test(String(v ?? '').trim()) ? 'No' : '');
const pulisci = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Precompilazione dai dati della Suite: Legal entity (org), impostazioni Business (ext), referente principale (per i riferimenti del
 * servizio se mancano), linea dell'account, indirizzo del laboratorio (Impostazioni lab_address).
 */
export function precompila({ org = {}, ext = {}, referente = null, linea = 'SRV', labAddress = '', ultima = null } = {}) {
  const out = {};
  for (const c of CAMPI_MOD173) {
    let v = '';
    if (c.org) v = org[c.org];
    else if (c.ext) v = c.t === 'b' ? (ext[c.ext] ? 'Sì' : '') : ext[c.ext];
    out[c.k] = c.t === 'b' ? siNo(v) : pulisci(v);
  }
  out.stato = 'Attiva';
  out.business_line = LINEA_BUSINESS[linea] || 'Service di Laboratorio';
  out.nazione = out.nazione || 'Italia';
  out.valuta = out.valuta || 'EUR';
  if (!out.laboratorio_riferimento && labAddress) out.laboratorio_riferimento = pulisci(labAddress);
  if (referente) {
    if (!out.svc_contatto) out.svc_contatto = pulisci(referente.nome);
    if (!out.svc_email) out.svc_email = pulisci(referente.email);
    if (!out.svc_cellulare && referente.telefono) out.svc_cellulare = pulisci(referente.telefono);
  }
  // un invio precedente del cliente vale più della precompilazione (riapre la form con i suoi dati)
  if (ultima) for (const c of CAMPI_MOD173) if (pulisci(ultima[c.k])) out[c.k] = c.t === 'b' ? siNo(ultima[c.k]) : pulisci(ultima[c.k]);
  return out;
}

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
/** Validazione dei campi di una form pubblica (MOD173 o variante PARTNER): { dati normalizzati, errori: [{ campo, messaggio }] }. */
function validaCampi(campi, input = {}) {
  const dati = {}; const errori = [];
  for (const c of campi) {
    let v = input[c.k];
    v = c.t === 'b' ? siNo(v) : c.t === 'm' ? String(v ?? '').trim().slice(0, 3000) : pulisci(v).slice(0, 300);
    if (c.t === 's' && v && !c.opzioni.includes(v)) { errori.push({ campo: c.k, messaggio: `${c.label}: valore non previsto` }); v = ''; }
    if (c.t === 'e' && v && !EMAIL_RE.test(v)) errori.push({ campo: c.k, messaggio: `${c.label}: indirizzo non valido` });
    if (c.req && !v) errori.push({ campo: c.k, messaggio: `${c.label}: obbligatorio` });
    dati[c.k] = v;
  }
  return { dati, errori };
}
/** Validazione dell'invio dalla form: { dati normalizzati, errori: [{ campo, messaggio }] }. */
export function validaMod173(input = {}) {
  const dati = {}; const errori = [];
  for (const c of CAMPI_MOD173) {
    let v = input[c.k];
    v = c.t === 'b' ? siNo(v) : c.t === 'm' ? String(v ?? '').trim().slice(0, 3000) : pulisci(v).slice(0, 300);
    if (c.t === 's' && v && !c.opzioni.includes(v)) { errori.push({ campo: c.k, messaggio: `${c.label}: valore non previsto` }); v = ''; }
    if (c.t === 'e' && v && !EMAIL_RE.test(v)) errori.push({ campo: c.k, messaggio: `${c.label}: indirizzo non valido` });
    if (c.req && !v) errori.push({ campo: c.k, messaggio: `${c.label}: obbligatorio` });
    dati[c.k] = v;
  }
  if (dati.iban) { dati.iban = dati.iban.replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(dati.iban)) errori.push({ campo: 'iban', messaggio: 'IBAN: formato non valido' }); }
  if (dati.piva && !/^[A-Z]{0,2}\s?[0-9A-Z]{8,14}$/i.test(dati.piva.replace(/\s+/g, ''))) errori.push({ campo: 'piva', messaggio: 'P.IVA: formato non valido' });
  return { dati, errori };
}

/**
 * Confronto tra l'anagrafica ricevuta e quella della Suite. Ritorna { riempire: [...], differenze: [...] } con voci
 * { campo, label, tabella: 'org'|'ext', colonna, attuale, proposto, valore } (valore = da scrivere: booleano per i sì/no).
 * Regola: un campo vuoto nella Suite si riempie da solo; un campo già valorizzato e diverso diventa una proposta da applicare a mano.
 * I booleani di org_ext (ritenuta, split payment) valgono FALSE di default: "Sì" su FALSE si riempie, "No" su TRUE è una differenza.
 */
export function confrontaAnagrafica({ org = {}, ext = {} } = {}, dati = {}) {
  const riempire = []; const differenze = [];
  const norm = (x) => pulisci(x).toLowerCase().replace(/\s+/g, '');
  for (const c of CAMPI_MOD173) {
    if (!c.org && !c.ext) continue;
    const proposto = dati[c.k];
    if (proposto == null || proposto === '') continue;
    const tabella = c.org ? 'org' : 'ext'; const colonna = c.org || c.ext;
    const attualeRaw = tabella === 'org' ? org[colonna] : ext[colonna];
    if (c.t === 'b') {
      const nuovo = proposto === 'Sì';
      const att = Boolean(attualeRaw);
      if (nuovo === att) continue;
      const voce = { campo: c.k, label: c.label, tabella, colonna, attuale: att ? 'Sì' : 'No', proposto, valore: nuovo };
      if (nuovo && !att) riempire.push(voce); else differenze.push(voce);
      continue;
    }
    const attuale = pulisci(attualeRaw);
    if (c.k === 'valuta' && attuale === 'EUR' && proposto === 'EUR') continue;
    if (!attuale) { riempire.push({ campo: c.k, label: c.label, tabella, colonna, attuale: '', proposto, valore: proposto }); continue; }
    if (norm(attuale) !== norm(proposto)) differenze.push({ campo: c.k, label: c.label, tabella, colonna, attuale, proposto, valore: proposto });
  }
  return { riempire, differenze };
}

// ---------------------------------------------------------------- allegati del contratto (Impostazioni, per linea)
export const ALLEGATI_DEFAULT = {
  SRV: [{ titolo: 'Lettera di offerta firmata (contratto)', obbligatorio: true, contratto: true }],
  PP: [{ titolo: 'Proposta di contratto firmata', obbligatorio: true, contratto: true }],
  MDL: [{ titolo: 'Lettera di offerta firmata (contratto)', obbligatorio: true, contratto: true }],
};
/** Allegati salvati (JSON) → lista per linea; il contratto firmato c'è sempre (primo, obbligatorio). */
export function allegatiDa(salvati) {
  let x = salvati;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  const out = {};
  for (const l of Object.keys(ALLEGATI_DEFAULT)) {
    const extra = Array.isArray(x?.[l]) ? x[l].filter((a) => a && String(a.titolo || '').trim()).map((a) => ({ titolo: pulisci(a.titolo).slice(0, 160), obbligatorio: Boolean(a.obbligatorio), contratto: false })) : [];
    out[l] = [ALLEGATI_DEFAULT[l][0], ...extra.filter((a) => !/firmat/i.test(a.titolo) || !/(contratto|offerta)/i.test(a.titolo))];
  }
  return out;
}

// ---------------------------------------------------------------- richiamo dei prospect
/**
 * Prospect da richiamare oggi. accounts: [{ id, linea, fase_corrente, cliente_attivo, non_contattare, contrattualizzato_at, email,
 * ultimo_richiamo_at, ultima_email_at, priorita, org_name }]. Regole: linea SRV, fase 0-5, non cliente, non "non contattare",
 * con un indirizzo email, nessun richiamo e nessuna email inviata negli ultimi `giorni` giorni. Ordine: mai richiamati prima, poi il
 * richiamo più vecchio, poi priorità alta. Il limite giornaliero taglia la lista (gli altri restano "in coda").
 */
export function prospectDaRichiamare(accounts = [], { oggi, giorni = 60, limite = 20 } = {}) {
  const soglia = aggiungiGiorni(oggi, -Math.max(1, Number(giorni) || 60));
  const esclusi = []; const candidati = [];
  const PRIO = { ALTA: 0, MEDIA: 1, BASSA: 2 };
  for (const a of accounts) {
    const no = (motivo) => esclusi.push({ id: a.id, org_name: a.org_name, motivo });
    if (a.linea !== 'SRV') { no('non è della linea Service'); continue; }
    if (a.cliente_attivo || a.contrattualizzato_at || Number(a.fase_corrente) >= 6) { no('è già cliente'); continue; }
    if (a.non_contattare) { no('non contattare'); continue; }
    if (!a.email) { no('nessun indirizzo email'); continue; }
    if (a.ultimo_richiamo_at && isoGiorno(new Date(a.ultimo_richiamo_at)) > soglia) { no(`richiamato il ${isoGiorno(new Date(a.ultimo_richiamo_at))}`); continue; }
    if (a.ultima_email_at && isoGiorno(new Date(a.ultima_email_at)) > soglia) { no(`email inviata il ${isoGiorno(new Date(a.ultima_email_at))}`); continue; }
    candidati.push(a);
  }
  candidati.sort((x, y) => (x.ultimo_richiamo_at ? 1 : 0) - (y.ultimo_richiamo_at ? 1 : 0)
    || String(x.ultimo_richiamo_at || '').localeCompare(String(y.ultimo_richiamo_at || ''))
    || (PRIO[x.priorita] ?? 3) - (PRIO[y.priorita] ?? 3) || String(x.org_name || '').localeCompare(String(y.org_name || '')));
  const n = Math.max(0, Number(limite) || 0);
  return { selezionati: candidati.slice(0, n), in_coda: candidati.slice(n), esclusi };
}

// ---------------------------------------------------------------- modelli dei testi
// Segnaposto: {{nome}}. Valori sconosciuti restano come sono (l'editor li mostra); una riga i cui segnaposto sono tutti vuoti si toglie.
export function compila(testo, valori = {}) {
  const righe = String(testo ?? '').split('\n').map((riga) => {
    let vuoti = 0; let pieni = 0;
    const out = riga.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}(\.?)/g, (m, k, punto) => {
      const key = k.toLowerCase();
      if (!(key in valori)) return m;
      const v = valori[key] == null ? '' : String(valori[key]);
      if (v.trim()) pieni++; else vuoti++;
      return punto && v.endsWith('.') ? v : v + punto;   // "... S.r.l." a fine frase: un solo punto
    });
    return vuoti && !pieni ? null : out;   // "Referente: {{referente_dettaglio}}" senza dato: la riga non compare (niente righe inventate)
  });
  return righe.filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const segnapostoDi = (testo) => [...new Set([...String(testo || '').matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase()))];

export const MODELLI_DEFAULT = {
  kit_oggetto: 'Toscana Diagnostica · Proposta di collaborazione per {{cliente}}',
  kit_testo: `Gentile {{referente}},

a nome di Toscana Diagnostica vi inviamo la nostra proposta per il Service di Laboratorio preparata per {{cliente}}.

In allegato trovate:
- il pacchetto di presentazione: lettera di presentazione dell'azienda, il Portale Service, le credenziali di accesso e il Vademecum degli esami;
- la lettera di offerta e l'offerta economica (listino versione {{listino_versione}});
- la circolare ministeriale per il trasporto dei campioni;
- il modulo Anagrafica Clienti B2B (TD-SGI-MOD173), anche in versione compilabile.

Per diventare nostri clienti completate online l'anagrafica e caricate la lettera di offerta firmata da questa pagina, preparata per voi:
{{link_form}}
Il collegamento è personale e resta valido fino al {{scadenza_form}}. In alternativa potete rispondere a questa email allegando i documenti firmati.

Le vostre credenziali:
- Suite Toscana Diagnostica: {{suite_url}}, utente {{utente_suite}}. La password provvisoria arriva con un'email separata; i servizi (Portale Service, non conformità, ordini, circolari, rubrica, ticket) si attivano con la firma del contratto.
- StudioLAB: {{studiolab}}

Restiamo a disposizione per qualsiasi chiarimento.

Un cordiale saluto,
{{owner}}
Toscana Diagnostica`,
  interna_oggetto: 'Avvenuta contrattualizzazione: {{cliente}}',
  interna_testo: `Il cliente {{cliente}} ha restituito il contratto firmato ({{fonte}}, {{data}}).

Referente: {{referente_dettaglio}}
Listino: {{listino}}
Volumi attesi: {{volumi_giornalieri}}
Data di partenza prevista: {{data_avvio}}

Scheda nel Business Hub: {{link_scheda}}

La pipeline è passata alla fase 6 (Contratto firmato). La fase 7 (Attivo / Starting) la conferma il CEO dalla scheda.`,
  benvenuto_oggetto: 'Benvenuti in Toscana Diagnostica · {{cliente}}',
  benvenuto_testo: `Gentile {{referente}},

grazie per aver scelto Toscana Diagnostica: abbiamo ricevuto il contratto firmato e da oggi {{cliente}} fa parte della community dei laboratori e delle strutture che lavorano con noi.

Nella Suite di Toscana Diagnostica ({{suite_url}}) trovate il Portale Service con preparazioni, documenti, certificazioni e Vademecum degli esami, le non conformità sui vostri campioni con le risposte, gli ordini del materiale, le circolari con la presa visione, la rubrica dei contatti e i ticket per ogni richiesta.
I servizi sono attivi per: {{accessi}}.

Per entrare usate la vostra email e la password ricevuta con l'invito "Benvenuto in Suite TD"; se non la ricordate, dalla pagina di accesso usate "Password dimenticata".

I vostri riferimenti in Toscana Diagnostica:
{{referenti}}

Per qualunque domanda potete rispondere a questa email.

Un cordiale saluto,
{{owner}}
Toscana Diagnostica`,
  laboratorio_oggetto: 'Nuovo cliente contrattualizzato: {{cliente}}',
  laboratorio_testo: `Vi informiamo che {{cliente}} è un nuovo cliente del Service di Laboratorio: contratto firmato ricevuto il {{data}}.

Volumi giornalieri attesi: {{volumi_giornalieri}}
Data di partenza prevista: {{data_avvio}}
Referente del cliente: {{referente_dettaglio}}
Listino applicato: {{listino}}

Scheda del cliente nel Business Hub: {{link_scheda}}`,
  richiamo_oggetto: 'Toscana Diagnostica · Service di Laboratorio per {{cliente}}',
  richiamo_testo: `Gentile {{referente}},

vi scriviamo per presentarvi Toscana Diagnostica e il nostro Service di Laboratorio. In allegato trovate la presentazione dell'azienda, dei servizi e del Portale Service, lo strumento con cui i nostri clienti seguono ogni giorno campioni, non conformità, ordini del materiale e comunicazioni del laboratorio.

Saremmo lieti di preparare per {{cliente}} un'offerta dedicata. Per parlarne rispondete a questa email (arriva a {{casella}}) oppure scrivete a {{contatto_commerciale}}.

I nostri recapiti:
{{recapiti}}

Un cordiale saluto,
Toscana Diagnostica`,
  // revisione del listino/offerta (richiesta del CEO del 07/11/2026): solo l'offerta economica rigenerata, da rifirmare
  revisione_oggetto: 'Toscana Diagnostica · Offerta economica aggiornata (v{{versione}}) · {{cliente}}',
  revisione_testo: `Gentile Cliente,

vi inviamo in allegato l'offerta economica aggiornata per {{cliente}} (versione {{versione}} del {{data}}).

Prezzi modificati rispetto alla versione precedente:
{{righe_cambiate}}

Le altre righe dell'offerta non cambiano. Vi chiediamo di restituircela firmata rispondendo a questa email.

Un cordiale saluto,
Toscana Diagnostica`,
  lettera_presentazione: `Gentile {{referente}},

con questa lettera desidero presentarvi Toscana Diagnostica e invitarvi a diventare nostri clienti. Nelle pagine che seguono, dedicate a {{cliente}}, trovate chi siamo, il portale che i nostri clienti usano ogni giorno e le persone a cui rivolgervi.

Toscana Diagnostica è una rete sanitaria integrata nata nell'aprile 2026 in Toscana. Riunisce il Laboratorio di Analisi, la Diagnostica per Immagini, la Medicina Specialistica e la Medicina del Lavoro sotto un'unica direzione e un unico sistema di regole. Il principio che ci guida è semplice: ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta. Per una struttura che ci affida i propri campioni questo significa risultati affidabili, nei tempi dichiarati, e un interlocutore che risponde.

Per i laboratori e le strutture clienti svolgiamo il service di laboratorio: eseguiamo gli esami che ci affidate, organizziamo il ritiro dei campioni nei giorni e negli orari concordati, forniamo il materiale per il prelievo e il confezionamento e rendiamo disponibili i referti in formato digitale. I tempi di refertazione di ogni esame sono scritti nel Vademecum, consultabile online.

Il modo in cui lavoriamo è scritto, verificato e misurato. Il nostro Sistema di Gestione Integrato è certificato secondo le norme ISO 9001, ISO 14001, ISO 45001 e ISO 37001, partecipiamo ai programmi di Valutazione Esterna di Qualità e ogni campione è tracciato dall'arrivo al referto. Quello che vediamo noi lo vedono anche i nostri clienti, sul Portale Service.

La nostra sede e il nostro laboratorio sono a Sesto Fiorentino, in Via di Pratignone 13/4.

Qui sotto trovate le persone a cui rivolgervi; {{owner}} è a vostra disposizione per costruire con voi la proposta più adatta.

{{referenti}}

Sarò lieto di accogliervi tra i nostri clienti.

Con i migliori saluti,`,
  // ---- linea Punti Prelievo (richiesta del CEO del 06/11/2026): contratto al partner e comunicazioni dell'avvio del punto prelievi.
  // Nessun nome, prezzo, fornitore o impegno inventato: i dati arrivano dalla Suite (account, sede, Cash, Impostazioni).
  pp_contratto_oggetto: 'Toscana Diagnostica · Contratto del punto prelievi · {{punto}}',
  pp_contratto_testo: `Gentile {{referente}},

vi inviamo in allegato il contratto per il punto prelievi di Toscana Diagnostica presso {{partner}}, da far firmare al legale rappresentante.
Indirizzo del punto prelievi: {{indirizzo_punto}}

Per restituirlo firmato potete caricarlo in PDF da questa pagina, preparata per voi, dove trovate anche i dati del referente da verificare:
{{link_form}}
Il collegamento è personale e resta valido fino al {{scadenza_form}}. In alternativa potete rispondere a questa email allegando il contratto firmato.

Con il contratto firmato riceverete le credenziali della Suite di Toscana Diagnostica, dove potrete consultare gli importi delle royalties del punto prelievi.

Restiamo a disposizione per qualsiasi chiarimento.

Un cordiale saluto,
{{owner}}
Toscana Diagnostica`,
  pp_benvenuto_oggetto: 'Benvenuti nella rete Toscana Diagnostica · punto prelievi {{punto}}',
  pp_benvenuto_testo: `Gentile {{referente}},

grazie: abbiamo ricevuto il contratto firmato per il punto prelievi {{punto}} presso {{partner}}.

Da oggi avete un accesso alla Suite di Toscana Diagnostica ({{suite_url}}). In Cash Management trovate, in sola visualizzazione, gli importi mensili delle royalties del punto prelievi che ospitate.
Servizi attivi: {{servizi}}.
Accessi: {{accessi}}.

Per entrare usate la vostra email e la password provvisoria ricevuta con l'email "Benvenuto in Suite TD": al primo accesso la Suite vi chiede di sceglierne una personale. Se non la ricordate, dalla pagina di accesso usate "Password dimenticata".

Data di avvio del punto prelievi: {{data_avvio}}

I vostri riferimenti in Toscana Diagnostica:
{{referenti}}

Per qualunque domanda potete rispondere a questa email.

Un cordiale saluto,
{{owner}}
Toscana Diagnostica`,
  pp_conferma_oggetto: 'Contratto punto prelievi firmato: {{punto}}',
  pp_conferma_testo: `Il contratto per il punto prelievi {{punto}} è stato restituito firmato da {{partner}} ({{fonte}}, {{data}}).

Tipo: {{tipo}}
Sede: {{sede}}
Referente del partner: {{referente_dettaglio}}
Contratto: {{contratto}}
Data di avvio prevista: {{data_avvio_prevista}}
Data di avvio effettiva: {{data_avvio}}

Scheda nel Business Hub: {{link_scheda}}

La pipeline è passata alla fase 6 (Contratto firmato); la fase 7 (Attivo / Starting) la conferma il CEO dalla scheda. I passi dell'avvio sono nella scheda "Punto prelievi".`,
  pp_avvio_oggetto: 'Avvio del nuovo punto prelievi {{punto}}',
  pp_avvio_testo: `Vi informiamo che il nuovo punto prelievi {{punto}} avvia l'attività il {{data_avvio}}.

Tipo: {{tipo}}
Indirizzo: {{indirizzo_punto}}
Partner ospitante: {{partner_ospitante}}
Orari: {{orari}}
Autorizzazione sanitaria: {{autorizzazione}}

Scheda nel Business Hub: {{link_scheda}}`,
  pp_dotazione_oggetto: 'Dotazione del nuovo punto prelievi {{punto}}: {{dotazione_breve}}',
  pp_dotazione_testo: `Per il nuovo punto prelievi {{punto}} vi chiediamo di procedere con:
{{dotazione}}

Indirizzo: {{indirizzo_punto}}
Data di avvio: {{data_avvio}}

Scheda nel Business Hub: {{link_scheda}}

Grazie.`,
  pp_fondo_oggetto: 'Fondo cassa e POS per il nuovo punto prelievi {{punto}}',
  pp_fondo_testo: `Per il nuovo punto prelievi {{punto}} vi chiediamo di:
- predisporre il fondo cassa: {{fondo_cassa}};
- ordinare il POS per il punto prelievi.

Indirizzo: {{indirizzo_punto}}
Data di avvio: {{data_avvio}}

Scheda nel Business Hub: {{link_scheda}}

Grazie.`,
  pp_rifiuti_oggetto: 'Adempimenti rifiuti speciali per il nuovo punto prelievi {{punto}}',
  pp_rifiuti_testo: `Per il nuovo punto prelievi {{punto}} vi chiediamo di curare gli adempimenti correlati ai rifiuti speciali.

Tipo: {{tipo}}
Indirizzo: {{indirizzo_punto}}
Partner ospitante: {{partner_ospitante}}
Data di avvio: {{data_avvio}}

Scheda nel Business Hub: {{link_scheda}}

Grazie.`,
};
export const MODELLI_LABEL = {
  kit: 'Kit di proposta (al cliente)', interna: 'Avvenuta contrattualizzazione (interna)', benvenuto: 'Ringraziamento e benvenuto (al cliente)',
  laboratorio: 'Nuovo cliente (al laboratorio)', richiamo: 'Richiamo dei prospect', revisione: 'Revisione dell\'offerta economica', lettera_presentazione: 'Lettera di presentazione (pacchetto del kit e del richiamo)',
  pp_contratto: 'PP · contratto al partner', pp_benvenuto: 'PP · credenziali e benvenuto al partner', pp_conferma: 'PP · contratto firmato (interna)',
  pp_avvio: 'PP · avvio al laboratorio', pp_dotazione: 'PP · dotazione', pp_fondo: 'PP · fondo cassa e POS', pp_rifiuti: 'PP · rifiuti speciali',
};
export const SEGNAPOSTO_MODELLI = {
  kit: ['cliente', 'referente', 'link_form', 'scadenza_form', 'suite_url', 'utente_suite', 'studiolab', 'listino_versione', 'owner', 'data'],
  interna: ['cliente', 'fonte', 'data', 'referente_dettaglio', 'listino', 'volumi_giornalieri', 'data_avvio', 'link_scheda'],
  benvenuto: ['cliente', 'referente', 'suite_url', 'accessi', 'referenti', 'owner', 'data'],
  laboratorio: ['cliente', 'data', 'volumi_giornalieri', 'data_avvio', 'referente_dettaglio', 'listino', 'link_scheda'],
  richiamo: ['cliente', 'referente', 'casella', 'contatto_commerciale', 'recapiti', 'data'],
  revisione: ['cliente', 'versione', 'righe_cambiate', 'data'],
  lettera_presentazione: ['cliente', 'referente', 'data', 'owner', 'referenti'],
  pp_contratto: ['punto', 'partner', 'referente', 'indirizzo_punto', 'link_form', 'scadenza_form', 'owner', 'data'],
  pp_benvenuto: ['punto', 'partner', 'referente', 'suite_url', 'servizi', 'accessi', 'data_avvio', 'referenti', 'owner', 'data'],
  pp_conferma: ['punto', 'partner', 'fonte', 'data', 'tipo', 'sede', 'referente_dettaglio', 'contratto', 'data_avvio_prevista', 'data_avvio', 'link_scheda'],
  pp_avvio: ['punto', 'data_avvio', 'tipo', 'indirizzo_punto', 'partner_ospitante', 'orari', 'autorizzazione', 'link_scheda'],
  pp_dotazione: ['punto', 'dotazione', 'dotazione_breve', 'indirizzo_punto', 'data_avvio', 'link_scheda'],
  pp_fondo: ['punto', 'fondo_cassa', 'indirizzo_punto', 'data_avvio', 'link_scheda'],
  pp_rifiuti: ['punto', 'tipo', 'indirizzo_punto', 'partner_ospitante', 'data_avvio', 'link_scheda'],
};
/** Modelli salvati (JSON in app_settings flusso.modelli) → modelli completi con i predefiniti. */
export function modelliFlussoDa(salvati) {
  let x = salvati;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  const out = { ...MODELLI_DEFAULT };
  if (x && typeof x === 'object') for (const k of Object.keys(MODELLI_DEFAULT)) if (typeof x[k] === 'string' && x[k].trim()) out[k] = x[k];
  return out;
}

/** Blocco dei contatti in testo (email): "- Ruolo: Nome · email · telefono (nota)". */
// ---------------------------------------------------------------- accessi al portale per tutti i referenti
// Richiesta del CEO del 07/11/2026: "crea gli accessi al portale per tutti i referenti inclusi in anagrafica". Impostazione
// hub_accessi_portale: TUTTI (predefinito: ogni referente con email) o PRINCIPALE (solo il referente principale, come prima).
export const ACCESSI_PORTALE = { TUTTI: 'Tutti i referenti con email', PRINCIPALE: 'Solo il referente principale' };
export const accessiPerTutti = (s = {}) => String(s.hub_accessi_portale || 'TUTTI').toUpperCase() !== 'PRINCIPALE';
const EMAIL_ACCESSO = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
/**
 * Piano degli accessi della Legal entity per i referenti dell'account (pura): per ogni referente { contatto_id, nome, ruolo, email,
 * principale, esito, motivo, user_id }. esito: HA_ACCESSO (utente esterno della Legal entity con quell'email), DA_CREARE, SALTATO
 * (senza email, email non valida, email ripetuta in un altro referente). soloPrincipale: gli altri referenti restano fuori (SALTATO).
 * contatti: [{ id, nome, ruolo, email, principale }]; accessi: utenti esterni della Legal entity [{ id, email }].
 */
export function pianoAccessi({ contatti = [], accessi = [], soloPrincipale = false } = {}) {
  const perEmail = new Map(accessi.map((u) => [String(u.email || '').trim().toLowerCase(), u]));
  const viste = new Set();
  const ordinati = [...contatti].sort((x, y) => Number(Boolean(y.principale)) - Number(Boolean(x.principale)) || Number(x.id) - Number(y.id));
  const principaleId = ordinati.find((c) => String(c.email || '').trim())?.id ?? null;
  return ordinati.map((c) => {
    const email = String(c.email || '').trim().toLowerCase();
    const base = { contatto_id: c.id, nome: c.nome || '', ruolo: c.ruolo || null, email: email || null, principale: Boolean(c.principale), user_id: null };
    if (!email) return { ...base, esito: 'SALTATO', motivo: 'senza email' };
    if (!EMAIL_ACCESSO.test(email)) return { ...base, esito: 'SALTATO', motivo: 'email non valida' };
    if (viste.has(email)) return { ...base, esito: 'SALTATO', motivo: 'stessa email di un altro referente' };
    viste.add(email);
    const u = perEmail.get(email);
    if (u) return { ...base, esito: 'HA_ACCESSO', motivo: null, user_id: u.id };
    if (soloPrincipale && c.id !== principaleId) return { ...base, esito: 'SALTATO', motivo: 'impostazione "solo il referente principale"' };
    return { ...base, esito: 'DA_CREARE', motivo: null };
  });
}

export function referentiTesto(voci = []) {
  return voci.map((v) => `- ${v.ruolo}: ${[v.nome, v.email, v.telefono].filter(Boolean).join(' · ')}${v.nota ? ` (${v.nota})` : ''}`).join('\n');
}

// ================================================================ linea Punti Prelievo (richiesta del CEO del 06/11/2026)
// "Anagrafica: il punto prelievi può essere un flagship (cioè in sede in locazione) o un corner (in sede di terzi, ovvero il partner)."
// Regole pure del processo PP: tipo del punto dalla sede, prerequisiti dell'invio del contratto al partner, campi della form pubblica in
// variante PARTNER, passi dell'avvio con l'idempotenza, composizione del primo ordine standard, destinatari interni per linea.

export const TIPI_PUNTO = { FLAGSHIP: 'Flagship (sede TD in locazione o di proprietà)', CORNER: 'Corner (sede del partner ospitante)' };
/**
 * Flagship o corner, senza un campo nuovo: lo dice la sede TD collegata (public.sites). Sede ospitata (tenure OSPITATA, o senza titolo ma
 * con la Legal entity ospitante) = CORNER; proprietà, locazione o comodato senza ospitante = FLAGSHIP. Senza sede vale il "tipo previsto"
 * dell'account, da confermare quando la sede viene creata. Ritorna { tipo, fonte: 'sede'|'previsto'|null, label, avvisi }.
 */
export function tipoPunto({ sede = null, previsto = null } = {}) {
  const avvisi = [];
  if (sede) {
    const corner = sede.tenure === 'OSPITATA' || (!sede.tenure && Boolean(sede.host_organization_id));
    const tipo = corner ? 'CORNER' : 'FLAGSHIP';
    if (sede.kind && sede.kind !== 'PUNTO_PRELIEVI') avvisi.push(`La sede collegata è di tipo ${sede.kind}, non Punto prelievi`);
    if (corner && !sede.host_organization_id) avvisi.push('Sede ospitata senza Legal entity ospitante: indicala in Amministrazione > Sedi');
    if (previsto && previsto !== tipo) avvisi.push(`Il tipo previsto era ${previsto === 'CORNER' ? 'corner' : 'flagship'}, la sede dice ${corner ? 'corner' : 'flagship'}: vale la sede`);
    return { tipo, fonte: 'sede', label: TIPI_PUNTO[tipo], avvisi };
  }
  if (previsto && TIPI_PUNTO[previsto]) return { tipo: previsto, fonte: 'previsto', label: TIPI_PUNTO[previsto], avvisi: ['Tipo previsto: da confermare quando la sede viene creata e collegata'] };
  return { tipo: null, fonte: null, label: 'da definire', avvisi: ['Collega la sede TD o indica il tipo previsto (flagship o corner)'] };
}

/** Prerequisiti di "Invia il contratto al partner da network@" (solo corner). s = { tipo, contratto, file, referente }. */
export function prerequisitiContrattoPartner(s = {}) {
  const c = s.contratto;
  const voci = [
    { key: 'tipo', label: 'Punto prelievi corner (in sede del partner)', ok: s.tipo === 'CORNER', dettaglio: s.tipo === 'FLAGSHIP' ? 'flagship: niente contratto al partner (vale la locazione della sede)' : s.tipo === 'CORNER' ? 'sede del partner ospitante' : 'collega la sede o indica il tipo previsto' },
    { key: 'contratto', label: 'Contratto PP generato', ok: Boolean(c && s.file && ['BOZZA', 'PROPOSTA'].includes(c.status)), dettaglio: !c ? 'crea la proposta di contratto Punto Prelievi (Contratti)' : !['BOZZA', 'PROPOSTA'].includes(c.status) ? `contratto ${c.protocol || ''} già ${String(c.status).toLowerCase()}` : s.file ? `${c.protocol || `bozza #${c.id}`} · ${s.file.filename}` : 'genera il PDF del contratto (Contratti, "Genera")' },
    { key: 'referente', label: 'Referente del partner con email', ok: Boolean(s.referente?.email), dettaglio: s.referente?.email ? `${s.referente.nome} · ${s.referente.email}` : 'aggiungi il referente del partner con email (scheda Referenti)' },
  ];
  return { voci, pronto: voci.every((v) => v.ok) };
}

// Form pubblica in variante PARTNER: solo i dati del referente del partner e il contratto firmato (il MOD173 al partner non serve)
export const SEZIONI_PARTNER = [{ key: 'referente', titolo: 'Referente del partner per il punto prelievi' }, { key: 'note', titolo: 'Note' }];
export const CAMPI_PARTNER = [
  { s: 'referente', k: 'ref_nome', label: 'Nome e cognome', t: 't', req: true },
  { s: 'referente', k: 'ref_ruolo', label: 'Ruolo', t: 't' },
  { s: 'referente', k: 'ref_email', label: 'Email', t: 'e', req: true },
  { s: 'referente', k: 'ref_telefono', label: 'Telefono', t: 't' },
  { s: 'note', k: 'note', label: 'Note', t: 'm' },
];
export function precompilaPartner({ referente = null, ultima = null } = {}) {
  const out = { ref_nome: pulisci(referente?.nome), ref_ruolo: pulisci(referente?.ruolo), ref_email: pulisci(referente?.email), ref_telefono: pulisci(referente?.telefono), note: '' };
  if (ultima) for (const c of CAMPI_PARTNER) if (pulisci(ultima[c.k])) out[c.k] = c.t === 'm' ? String(ultima[c.k]).trim() : pulisci(ultima[c.k]);
  return out;
}
export const validaPartner = (input = {}) => validaCampi(CAMPI_PARTNER, input);

// ---------------------------------------------------------------- avvio del punto prelievi
// Passi nell'ordine della richiesta del CEO. solo: il passo vale solo per quel tipo; serve: 'data' (data di avvio effettiva) o 'sede'
// (struttura in Ordini = sede TD collegata). Un passo riuscito (OK) non si ripete mai: "Riprova" agisce solo sugli altri.
export const PASSI_AVVIO_PP = [
  { key: 'CREDENZIALI', lettera: 'a', label: 'Credenziali della Suite e benvenuto al partner', solo: 'CORNER' },
  { key: 'CONFERMA', lettera: 'b', label: 'Conferma interna del contratto firmato', solo: 'CORNER' },
  { key: 'AVVIO_LAB', lettera: 'c', label: 'Annuncio dell\'avvio al laboratorio', serve: 'data' },
  { key: 'PRIMO_ORDINE', lettera: 'd', label: 'Primo ordine standard in Ordini', serve: 'sede' },
  { key: 'DOTAZIONE', lettera: 'e', label: 'Dotazione: PC, stampante, boccione' },
  { key: 'FONDO_CASSA', lettera: 'f', label: 'Fondo cassa e POS all\'amministrazione' },
  { key: 'RIFIUTI', lettera: 'g', label: 'Adempimenti per i rifiuti speciali' },
];
export const STATI_PASSO = { OK: 'fatto', FALLITO: 'non riuscito', ATTESA_DATA: 'in attesa della data di avvio', ATTESA_SEDE: 'in attesa della sede', DA_FARE: 'da fare', NON_PREVISTO: 'non previsto' };
/**
 * Piano dell'avvio: per ogni passo { key, lettera, label, stato (salvato o DA_FARE), azione: ESEGUI | FATTO | ATTESA | NON_PREVISTO | SALTA,
 * motivo }. passi = stato salvato { KEY: { stato, ... } }; solo = elenco dei passi da eseguire (Riprova), gli altri non si toccano.
 */
export function pianoAvvio({ tipo, passi = {}, dataAvvio = null, sedeId = null, solo = null } = {}) {
  return PASSI_AVVIO_PP.map((p) => {
    const salvato = passi?.[p.key] || null;
    const base = { key: p.key, lettera: p.lettera, label: p.label, stato: salvato?.stato || 'DA_FARE' };
    if (p.solo && p.solo !== tipo) return { ...base, stato: 'NON_PREVISTO', azione: 'NON_PREVISTO', motivo: `solo per i punti ${p.solo === 'CORNER' ? 'corner' : 'flagship'}` };
    if (salvato?.stato === 'OK') return { ...base, azione: 'FATTO', motivo: null };
    if (solo && !solo.includes(p.key)) return { ...base, azione: 'SALTA', motivo: null };
    if (p.serve === 'data' && !dataAvvio) return { ...base, stato: 'ATTESA_DATA', azione: 'ATTESA', motivo: 'parte quando si imposta la data di avvio effettiva' };
    if (p.serve === 'sede' && !sedeId) return { ...base, stato: 'ATTESA_SEDE', azione: 'ATTESA', motivo: 'parte quando la sede TD è creata e collegata al punto prelievi' };
    return { ...base, azione: 'ESEGUI', motivo: null };
  });
}
/** Riepilogo per cruscotto e scheda: { previsti, fatti, da_completare: [keys falliti o in attesa], completo }. */
export function riepilogoAvvio(tipo, passi = {}) {
  const previsti = PASSI_AVVIO_PP.filter((p) => !p.solo || p.solo === tipo);
  const fatti = previsti.filter((p) => passi?.[p.key]?.stato === 'OK');
  const da = previsti.filter((p) => passi?.[p.key]?.stato !== 'OK').map((p) => p.key);
  return { previsti: previsti.length, fatti: fatti.length, da_completare: da, falliti: da.filter((k) => passi?.[k]?.stato === 'FALLITO'), completo: da.length === 0 };
}

/**
 * Primo ordine standard: quantità 1 di tutti gli articoli del Magazzino Centrale destinati ai Punti Prelievo (visible_sedi), attivi, non
 * riservati al laboratorio. Come in "Nuovo ordine" di Ordini: se esiste almeno un articolo del Magazzino Centrale (source SILVA) valgono
 * solo quelli; gli articoli visibili "a tutti" ma non segnati per i Punti Prelievo non entrano (si aggiungono a mano dall'Area Operations).
 * articoli: [{ id, code, name, active, lab_only, visible_sedi, source, sort }]. Ritorna le righe [{ article_id, qty: 1, code, name }].
 */
export function composizionePrimoOrdine(articoli = []) {
  const magazzino = articoli.some((a) => a.source === 'SILVA' && a.active !== false);
  const visti = new Set();
  return articoli
    .filter((a) => a.active !== false && !a.lab_only && a.visible_sedi === true && (!magazzino || a.source === 'SILVA'))
    .filter((a) => (visti.has(a.id) ? false : visti.add(a.id)))
    .sort((x, y) => (Number(x.sort) || 0) - (Number(y.sort) || 0) || String(x.code || '').localeCompare(String(y.code || '')))
    .map((a) => ({ article_id: a.id, qty: 1, code: a.code || null, name: a.name || null }));
}

// Destinatari interni per linea (Impostazioni del Business Hub; predefiniti quelli indicati dal CEO)
export const DESTINATARI_PROCESSO = {
  SRV: { contrattualizzazione: 'hub_dest_contrattualizzazione', laboratorio: 'hub_dest_laboratorio' },
  PP: { conferma: 'hub_pp_dest_conferma', avvio: 'hub_pp_dest_avvio', dotazione: 'hub_pp_dest_dotazione', amministrazione: 'hub_pp_dest_amministrazione', rifiuti: 'hub_pp_dest_rifiuti' },
};
const listaEmail = (s) => [...new Set(String(s || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x)))];
/** Destinatari interni del processo della linea dalle Impostazioni: { chiave: [indirizzi] } (vuoto per MDL, che non ha un processo). */
export function destinatariLinea(linea, s = {}) {
  return Object.fromEntries(Object.entries(DESTINATARI_PROCESSO[linea] || {}).map(([k, chiave]) => [k, listaEmail(s[chiave])]));
}
/** Elenco della dotazione (Impostazioni, una voce per riga): righe per l'email e forma breve per l'oggetto. */
export function elencoDotazione(testo) {
  const voci = String(testo || '').split('\n').map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  return { voci, testo: voci.map((v) => `- ${v}`).join('\n'), breve: voci.join(', ') };
}
