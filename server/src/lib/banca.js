// Collegamento bancario della Suite tramite Enable Banking (https://enablebanking.com, API di informazione sui conti, PSD2).
// v0.95.0, richiesta del CEO del 24/11/2026: movimenti del conto per la riconciliazione con le fatture (Recupero Crediti) e per la
// quadratura di Finance Management. SOLA LETTURA: saldi e movimenti; nessuna disposizione di pagamento.
//
// Come funziona (riferimento API: https://enablebanking.com/docs/api/reference/):
//  - l'applicazione si autentica con un JWT RS256 firmato con la sua chiave privata (kid = identificativo dell'applicazione, iss
//    "enablebanking.com", aud "api.enablebanking.com", durata massima 24 ore);
//  - POST /auth avvia il consenso: la persona con i poteri sul conto viene mandata alla banca, si autentica (SCA) e torna su
//    /api/banca/ritorno?code=...&state=...; POST /sessions { code } restituisce la sessione e i conti;
//  - GET /accounts/{uid}/balances e /accounts/{uid}/transactions (date_from, date_to, continuation_key) leggono saldi e movimenti;
//  - il consenso ha una scadenza (valid_until, al massimo quella consentita dalla banca): alla scadenza serve una nuova
//    autorizzazione in banca. La Suite avvisa prima e, finché il conto non è aggiornato, i solleciti automatici si fermano.
// Credenziali: ENABLEBANKING_APP_ID e ENABLEBANKING_PRIVATE_KEY (PEM; a capo come \n) o ENABLEBANKING_PRIVATE_KEY_B64, solo nelle
// variabili d'ambiente. ENABLEBANKING_API cambia l'indirizzo (collaudo). Nei log: banca, conti e conteggi, mai causali o controparti.
import crypto from 'node:crypto';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { notify } from './community.js';

const API = () => (process.env.ENABLEBANKING_API || 'https://api.enablebanking.com').replace(/\/+$/, '');
const appId = () => (process.env.ENABLEBANKING_APP_ID || '').trim();
function chiavePrivata() {
  const b64 = (process.env.ENABLEBANKING_PRIVATE_KEY_B64 || '').trim();
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  return (process.env.ENABLEBANKING_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
}
export const bancaConfigurata = () => Boolean(appId() && chiavePrivata());
export const GIORNI_CONSENSO = 90;        // consenso richiesto; la banca può concederne meno (maximum_consent_validity)
export const GIORNI_PRIMA_LETTURA = 120;  // storico letto alla prima sincronizzazione di un conto
export const PERIODI_RIDOTTI = [90, 89, 60, 30, 14, 7];   // giorni di storico da provare se la banca rifiuta il periodo della prima lettura
export const GIORNI_RILETTURA = 7;        // a ogni giro si rileggono gli ultimi giorni (movimenti in attesa che diventano contabili)

const b64u = (x) => Buffer.from(x).toString('base64url');
let jwtCache = { token: null, exp: 0 };
export function jwtApplicazione(adesso = Math.floor(Date.now() / 1000)) {
  if (jwtCache.token && jwtCache.exp - 120 > adesso) return jwtCache.token;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId() }));
  const body = b64u(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: adesso, exp: adesso + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(chiavePrivata()).toString('base64url');
  jwtCache = { token: `${head}.${body}.${firma}`, exp: adesso + 3600 };
  return jwtCache.token;
}
export function azzeraJwt() { jwtCache = { token: null, exp: 0 }; }

export class ErroreBanca extends Error { constructor(msg, status, codice) { super(msg); this.status = status; this.codice = codice; } }
async function chiama(metodo, percorso, corpo) {
  if (!bancaConfigurata()) throw new ErroreBanca('Enable Banking non configurato: servono ENABLEBANKING_APP_ID e ENABLEBANKING_PRIVATE_KEY nelle variabili d\'ambiente', 503, 'NON_CONFIGURATO');
  let res;
  try {
    res = await fetch(`${API()}${percorso}`, { method: metodo, headers: { Authorization: `Bearer ${jwtApplicazione()}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(45_000) });
  } catch (e) { throw new ErroreBanca(`Enable Banking non raggiungibile: ${e.message}`, 502, 'RETE'); }
  const testo = await res.text(); let j = null; try { j = JSON.parse(testo); } catch { /* non JSON */ }
  if (!res.ok) {
    const cod = j?.error || j?.code || null;
    const msg = j?.message || j?.detail || testo.slice(0, 200) || `errore ${res.status}`;
    throw new ErroreBanca(`Enable Banking ${res.status}: ${msg}`, res.status, typeof cod === 'string' ? cod : null);
  }
  return j;
}

/** Banche disponibili per il paese (elenco di Enable Banking): nome, paese, tipi di utente, durata massima del consenso. */
export async function elencoBanche(paese = 'IT') {
  const j = await chiama('GET', `/aspsps?country=${encodeURIComponent(paese)}`);
  return (j?.aspsps || []).map((a) => ({ name: a.name, country: a.country, psu_types: a.psu_types || [], max_giorni: a.maximum_consent_validity ? Math.floor(Number(a.maximum_consent_validity) / 86400) : null, beta: Boolean(a.beta) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ritorno = () => `${config.baseUrl}/api/banca/ritorno`;

/** Avvia il consenso: ritorna l'indirizzo della banca a cui mandare chi ha i poteri sul conto. */
export async function avviaCollegamento({ banca, paese = 'IT', psuType = 'business', maxGiorni = null, userId = null }) {
  const state = crypto.randomUUID();
  const giorni = Math.max(1, Math.min(GIORNI_CONSENSO, Number(maxGiorni) || GIORNI_CONSENSO));
  const validUntil = new Date(Date.now() + giorni * 86400000 - 3600000).toISOString();
  const row = await one(`INSERT INTO bank_connections (aspsp_name, aspsp_country, psu_type, state, valid_until, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [banca, paese, psuType, state, validUntil, userId]);
  try {
    const j = await chiama('POST', '/auth', { access: { valid_until: validUntil, balances: true, transactions: true }, aspsp: { name: banca, country: paese }, state, redirect_url: ritorno(), psu_type: psuType, language: 'it' });
    await q('UPDATE bank_connections SET authorization_id=$2, updated_at=now() WHERE id=$1', [row.id, j.authorization_id || null]);
    return { id: row.id, url: j.url };
  } catch (e) { await q(`UPDATE bank_connections SET status='ERRORE', last_error=$2, updated_at=now() WHERE id=$1`, [row.id, e.message.slice(0, 500)]); throw e; }
}

const ibanDi = (a) => String(a?.account_id?.iban || (a?.all_account_ids || []).find((x) => x.scheme_name === 'IBAN')?.identification || '').replace(/\s+/g, '').toUpperCase() || null;

/** Ritorno dalla banca: scambia il codice con la sessione e salva i conti. */
export async function completaCollegamento({ state, code, error }) {
  const c = await one('SELECT * FROM bank_connections WHERE state=$1', [String(state || '')]);
  if (!c) throw new ErroreBanca('Collegamento non riconosciuto: riparti da "Collega un conto"', 400, 'STATE');
  if (error || !code) { await q(`UPDATE bank_connections SET status='ERRORE', last_error=$2, updated_at=now() WHERE id=$1`, [c.id, `Autorizzazione non completata in banca${error ? `: ${String(error).slice(0, 200)}` : ''}`]); throw new ErroreBanca('Autorizzazione non completata in banca', 400, 'ANNULLATA'); }
  if (c.status === 'ATTIVA') return { id: c.id, conti: (await one('SELECT count(*)::int AS n FROM bank_accounts WHERE connection_id=$1', [c.id])).n, gia: true };
  const j = await chiama('POST', '/sessions', { code });
  const fine = j?.access?.valid_until || c.valid_until;
  await q(`UPDATE bank_connections SET session_id=$2, status='ATTIVA', valid_until=$3, authorized_at=now(), last_error=NULL, avviso_scadenza_at=NULL, updated_at=now() WHERE id=$1`, [c.id, j.session_id, fine]);
  let n = 0;
  for (const a of j.accounts || []) {
    if (!a.uid) continue;
    await q(`INSERT INTO bank_accounts (connection_id, uid, identification_hash, iban, name, currency) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (connection_id, uid) DO UPDATE SET iban=EXCLUDED.iban, name=EXCLUDED.name, currency=EXCLUDED.currency`, [c.id, a.uid, a.identification_hash || null, ibanDi(a), a.name || a.details || a.product || null, a.currency || 'EUR']);
    n++;
  }
  // una nuova autorizzazione dello stesso conto (stesso IBAN) sostituisce le sessioni precedenti: i vecchi conti non si leggono più
  await q(`UPDATE bank_accounts o SET attivo = FALSE FROM bank_accounts n WHERE n.connection_id = $1 AND o.connection_id <> $1 AND o.iban IS NOT NULL AND o.iban = n.iban AND o.attivo`, [c.id]);
  await q(`UPDATE bank_connections x SET status='REVOCATA', updated_at=now() WHERE x.id <> $1 AND x.status = 'ATTIVA' AND NOT EXISTS (SELECT 1 FROM bank_accounts a WHERE a.connection_id = x.id AND a.attivo)`, [c.id]);
  console.log(`[banca] collegamento ${c.id} attivo: ${n} conti, consenso fino al ${String(fine).slice(0, 10)}`);
  return { id: c.id, conti: n };
}

const testo = (v) => (Array.isArray(v) ? v.filter(Boolean).join(' ') : v ? String(v) : '').replace(/\s+/g, ' ').trim();
/** Movimento di Enable Banking nella forma della Suite (importo con segno, controparte, causale, chiave stabile). Funzione pura. */
export function normalizzaMovimento(t) {
  const entrata = String(t.credit_debit_indicator || '').toUpperCase() === 'CRDT';
  const importo = Math.round(Math.abs(Number(t.transaction_amount?.amount || 0)) * 100) / 100 * (entrata ? 1 : -1);
  const parte = entrata ? t.debtor : t.creditor; const conto = entrata ? t.debtor_account : t.creditor_account;
  const causale = [testo(t.remittance_information), testo(t.reference_number), testo(t.note)].filter(Boolean).join(' · ') || null;
  const m = { entry_reference: t.entry_reference || t.transaction_id || null, booking_date: t.booking_date || t.transaction_date || t.value_date || null, value_date: t.value_date || null, importo,
    currency: t.transaction_amount?.currency || 'EUR', stato: t.status || 'BOOK', controparte: testo(parte?.name) || null, controparte_iban: String(conto?.iban || '').replace(/\s+/g, '').toUpperCase() || null, causale };
  m.chiave = m.entry_reference || `H${crypto.createHash('sha1').update([m.booking_date, m.value_date, m.importo, m.controparte, m.controparte_iban, m.causale].join('|')).digest('hex').slice(0, 24)}`;
  return m;
}

/** Legge saldo e movimenti di un conto e li salva (i movimenti non si duplicano: chiave per IBAN). */
export async function sincronizzaConto(conto, { oggi = new Date() } = {}) {
  const dal = new Date((conto.last_sync_ok_at ? oggi.getTime() - GIORNI_RILETTURA * 86400000 : oggi.getTime() - GIORNI_PRIMA_LETTURA * 86400000)).toISOString().slice(0, 10);
  const out = { conto: conto.id, letti: 0, nuovi: 0, aggiornati: 0 };
  await q('UPDATE bank_accounts SET last_sync_at=now() WHERE id=$1', [conto.id]);
  try {
    const b = await chiama('GET', `/accounts/${encodeURIComponent(conto.uid)}/balances`).catch((e) => { if (e.status === 401 || e.status === 403) throw e; return null; });
    const scelto = (b?.balances || []).find((x) => ['CLBD', 'ITBD', 'XPCD', 'CLAV'].includes(x.balance_type)) || (b?.balances || [])[0];
    if (scelto) await q('UPDATE bank_accounts SET saldo=$2, saldo_tipo=$3, saldo_at=now() WHERE id=$1', [conto.id, Number(scelto.balance_amount?.amount), scelto.balance_type || null]);
    let chiave = null; let pagine = 0;
    const iban = conto.iban || `UID:${conto.identification_hash || conto.uid}`;
    // v0.97.4 (Intesa Sanpaolo, 25/11/2026: "422 Wrong transactions period requested" alla prima lettura di 120 giorni): ogni banca ha
    // un proprio limite di storico. Se il periodo è rifiutato si riprova con periodi più corti, fino a quello che la banca accetta.
    const giorno = (n) => new Date(oggi.getTime() - n * 86400000).toISOString().slice(0, 10);
    const periodi = conto.last_sync_ok_at ? [dal, giorno(3), giorno(1)] : [dal, ...PERIODI_RIDOTTI.map(giorno)];
    let k = 0;
    do {
      let j;
      try { j = await chiama('GET', `/accounts/${encodeURIComponent(conto.uid)}/transactions?date_from=${periodi[k]}${chiave ? `&continuation_key=${encodeURIComponent(chiave)}` : ''}`); }
      catch (e) {
        if (e.status === 422 && /period|date/i.test(e.message) && !chiave && k < periodi.length - 1) { k++; continue; }
        throw e;
      }
      out.dal = periodi[k];
      for (const t of j?.transactions || []) {
        const m = normalizzaMovimento(t);
        if (!m.booking_date || !Number.isFinite(m.importo) || m.importo === 0) continue;
        const r = await one(`INSERT INTO bank_transactions (iban, account_id, chiave, entry_reference, booking_date, value_date, importo, currency, stato, controparte, controparte_iban, causale, raw)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (iban, chiave) DO UPDATE SET account_id=EXCLUDED.account_id, stato=EXCLUDED.stato, booking_date=EXCLUDED.booking_date, value_date=EXCLUDED.value_date, updated_at=now()
          RETURNING (xmax = 0) AS nuovo`, [iban, conto.id, m.chiave, m.entry_reference, m.booking_date, m.value_date, m.importo, m.currency, m.stato, m.controparte, m.controparte_iban, m.causale, JSON.stringify(t)]);
        out.letti++; if (r.nuovo) out.nuovi++; else out.aggiornati++;
      }
      chiave = j?.continuation_key || null; pagine++;
    } while ((chiave && pagine < 60) || out.dal === undefined);
    await q('UPDATE bank_accounts SET last_sync_ok_at=now(), last_error=NULL WHERE id=$1', [conto.id]);
  } catch (e) {
    await q('UPDATE bank_accounts SET last_error=$2 WHERE id=$1', [conto.id, e.message.slice(0, 500)]);
    // consenso scaduto o revocato in banca: la sessione non vale più
    if (e.status === 401 || e.status === 403 || /EXPIRED|REVOKED|CLOSED|INVALID_SESSION/i.test(`${e.codice || ''} ${e.message}`)) await q(`UPDATE bank_connections SET status='SCADUTA', last_error=$2, updated_at=now() WHERE id=$1 AND status='ATTIVA'`, [conto.connection_id, e.message.slice(0, 500)]);
    out.errore = e.message;
  }
  return out;
}

/** Chi può autorizzare e staccare un conto: titolare della Suite, CEO e CFO di Finance Management o di Recupero Crediti. */
export const puoGestireBanca = (u) => u?.level === 'OWNER' || ['CEO', 'CFO'].includes(u?.grants?.finance?.profile) || ['CEO', 'CFO'].includes(u?.grants?.crediti?.profile);
/** Chi può vedere conti e movimenti: chi li gestisce, più Finance Support e Amministrazione dei crediti. */
export const puoVedereBanca = (u) => puoGestireBanca(u) || ['SUPPORT'].includes(u?.grants?.finance?.profile) || ['ATT'].includes(u?.grants?.crediti?.profile);
async function destinatariBanca() {
  return (await many(`SELECT DISTINCT u.id FROM users u LEFT JOIN grants g ON g.user_id = u.id AND g.module_key IN ('finance','crediti') AND g.profile IN ('CEO','CFO') AND NOT g.proposed
    WHERE u.status = 'ACTIVE' AND (u.level = 'OWNER' OR g.id IS NOT NULL)`)).map((x) => x.id);
}

/** Giro di sincronizzazione: tutti i conti attivi dei collegamenti attivi; consensi scaduti e in scadenza segnalati a CEO e CFO. */
export async function sincronizzaBanca({ adesso = new Date() } = {}) {
  if (!bancaConfigurata()) return { skipped: 'non_configurato' };
  const scaduti = await many(`UPDATE bank_connections SET status='SCADUTA', updated_at=now() WHERE status='ATTIVA' AND valid_until IS NOT NULL AND valid_until < $1 RETURNING id, aspsp_name`, [adesso.toISOString()]);
  const conti = await many(`SELECT a.* FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id WHERE c.status = 'ATTIVA' AND a.attivo ORDER BY a.id`);
  const out = { conti: conti.length, nuovi: 0, errori: 0, scaduti: scaduti.length };
  for (const c of conti) { const r = await sincronizzaConto(c, { oggi: adesso }); out.nuovi += r.nuovi; if (r.errore) out.errori++; }
  // avviso: consenso scaduto oppure in scadenza entro 10 giorni (una volta ogni 3 giorni)
  const avvisi = await many(`SELECT id, aspsp_name, status, valid_until FROM bank_connections WHERE (status = 'SCADUTA' OR (status = 'ATTIVA' AND valid_until < $1::timestamptz + interval '10 days'))
     AND (avviso_scadenza_at IS NULL OR avviso_scadenza_at < $1::timestamptz - interval '3 days') AND EXISTS (SELECT 1 FROM bank_accounts a WHERE a.connection_id = bank_connections.id AND a.attivo)`, [adesso.toISOString()]);
  if (avvisi.length) {
    const dest = await destinatariBanca();
    for (const a of avvisi) {
      await notify(dest, { kind: 'AVVISO', module_key: 'finance', title: a.status === 'SCADUTA' ? `Banca ${a.aspsp_name}: consenso scaduto, i movimenti non si aggiornano` : `Banca ${a.aspsp_name}: il consenso scade il ${new Date(a.valid_until).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
        body: 'Serve una nuova autorizzazione in banca da chi ha i poteri sul conto. Finché i movimenti non sono aggiornati i solleciti automatici restano fermi.', link: '/finance/banca' });
      await q('UPDATE bank_connections SET avviso_scadenza_at=$2 WHERE id=$1', [a.id, adesso.toISOString()]);
    }
  }
  if (conti.length) console.log(`[banca] ${out.conti} conti letti, ${out.nuovi} movimenti nuovi, ${out.errori} errori`);
  return out;
}

/** Stato per le pagine: configurazione, collegamenti, conti, freschezza dei movimenti. */
export async function statoBanca() {
  const collegamenti = await many(`SELECT c.id, c.aspsp_name, c.aspsp_country, c.status, c.valid_until, c.authorized_at, c.last_error, c.created_at, u.full_name AS creato_da
      FROM bank_connections c LEFT JOIN users u ON u.id = c.created_by WHERE c.status <> 'IN_ATTESA' OR c.created_at > now() - interval '1 day' ORDER BY (c.status = 'ATTIVA') DESC, c.created_at DESC LIMIT 20`);
  const conti = await many(`SELECT a.id, a.connection_id, a.iban, a.name, a.currency, a.attivo, a.saldo, a.saldo_at, a.last_sync_at, a.last_sync_ok_at, a.last_error, a.organization_id, c.aspsp_name, c.status AS collegamento_stato, c.valid_until,
      (SELECT count(*)::int FROM bank_transactions t WHERE t.iban = a.iban) AS movimenti, (SELECT max(t.booking_date)::text FROM bank_transactions t WHERE t.iban = a.iban) AS ultimo_movimento
      FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id WHERE a.attivo OR c.status = 'ATTIVA' ORDER BY a.attivo DESC, c.aspsp_name, a.iban`);
  return { configurata: bancaConfigurata(), ritorno: ritorno(), collegamenti, conti, aggiornata: await bancaAggiornata() };
}

/**
 * I movimenti sono abbastanza freschi da fidarsi prima di un sollecito? Vero se esiste almeno un conto attivo e TUTTI i conti attivi
 * sono stati letti con successo nelle ultime `ore` (predefinito 26). Ritorna { ok, motivo, ultimo }.
 */
export async function bancaAggiornata(ore = 26) {
  const r = await one(`SELECT count(*)::int AS conti, count(*) FILTER (WHERE a.last_sync_ok_at > now() - make_interval(hours => $1::int))::int AS freschi, min(a.last_sync_ok_at) AS ultimo
      FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id WHERE a.attivo AND c.status = 'ATTIVA'`, [ore]);
  if (!r.conti) return { ok: false, motivo: 'nessun conto bancario collegato', ultimo: null };
  if (r.freschi < r.conti) return { ok: false, motivo: `movimenti non aggiornati da più di ${ore} ore su ${r.conti - r.freschi} ${r.conti - r.freschi === 1 ? 'conto' : 'conti'}`, ultimo: r.ultimo };
  return { ok: true, motivo: null, ultimo: r.ultimo };
}

export async function scollega(id) {
  const c = await one('SELECT * FROM bank_connections WHERE id=$1', [Number(id)]);
  if (!c) return false;
  if (c.session_id && c.status === 'ATTIVA') await chiama('DELETE', `/sessions/${encodeURIComponent(c.session_id)}`).catch(() => {});
  await q(`UPDATE bank_connections SET status='REVOCATA', updated_at=now() WHERE id=$1`, [c.id]);
  await q('UPDATE bank_accounts SET attivo=FALSE WHERE connection_id=$1', [c.id]);
  return true;
}

/** Lettura dei movimenti ogni ora, dalle 6 alle 21 (ora di Roma): dopo la lettura parte la riconciliazione di Recupero Crediti. */
export function registerBancaJobs(registerJob) {
  registerJob('banca:movimenti', 60, async () => {
    const h = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()));
    if (h < 6 || h > 21) return { saltato: 'fuori orario' };
    return sincronizzaBanca();
  });
}
