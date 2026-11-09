// Integrazione con Silva Group (gestore del magazzino di Toscana Diagnostica).
//
// 1) Trasmissione degli ordini approvati secondo la Guida tecnica API ordini v1 di Silva (09/11/2026, docs/silva-api-ordini/):
//      GET  {base}/api/v1/destinazioni                 sedi autorizzate {destinazioni:[{codice, nome, indirizzo, cap, citta, provincia}]}
//      POST {base}/api/v1/ordini                       ordine approvato (X-Idempotency-Key = numero), ricevuta 201 / 200
//      GET  {base}/api/v1/ordini/{numero}/stato        IN_PREPARAZIONE | EVASO | ANNULLATO | NON_DISPONIBILE, 404 = assente
//    Header X-API-KEY su ogni chiamata (chiave del connettore SILVA, mai scritta in file o registri); 30 richieste al minuto per IP e
//    processo, condivise con il catalogo (silvaCatalog.js): tutte le chiamate passano dal limitatore qui sotto (silvaCall).
//    Regola del CEO: "una volta approvato l'ordine da parte di Ops, viene trasmesso a Silva". Silva chiede che la prima POST sia
//    concordata: finché l'impostazione primo_invio_confermato del connettore è falsa non parte nulla in automatico e Ops trasmette a
//    mano ("Trasmetti a Silva (invio concordato)", con conferma esplicita).
// 2) Canali storici "il fornitore interroga noi" (routes/integrations.js, segreto in ingresso): polling degli ordini, feed giacenze,
//    avanzamenti presa-in-carico / spedito / consegnato. Restano attivi (se un giorno Silva li userà) con il JSON esteso
//    orderPayloadEsteso; in subordine l'ordine in PDF via email alla casella SILVA_ORDER_EMAIL.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { connectorSync, getConnector, saveConnector, logConnector } from '../../../lib/connectors.js';
import { sendMail, opsEmails } from './mailer.js';
import { itDate, bad, HttpError } from './util.js';
import { one, many, q } from '../db.js';
import { event, markPicked, markShipped } from './orderflow.js';

export const SILVA_DEFAULT_BASE = 'https://silva.cloud/portaleordini';
export const baseSilva = (c) => String(c?.base_url || SILVA_DEFAULT_BASE).replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const oraIt = (d) => new Date(d).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dataOraIt = (d) => new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });

export const silvaStatus = () => { const c = connectorSync('SILVA'); return { inboundConfigured: Boolean(config.silva.inboundKey), email: config.silva.email || null, customerCode: config.silva.customerCode, connector: { source: c.source, configured: c.configured, active: c.active, last_test_at: c.last_test_at, last_status: c.last_status } }; };

// ---------------------------------------------------------------------------------------------------------------------
// Limitatore condiviso (catalogo, destinazioni, ordini, stato, prova del connettore): finestra mobile di 60 s con margine sotto le 30
// richieste al minuto della guida; dopo un 429 tutte le chiamate attendono il Retry-After (pausa globale del processo).
const LIMITE_MINUTO = 28;
const FINESTRA_MS = 60_000;
let chiamate = [];
let pausaFino = 0;
export class SilvaLimiteError extends Error {
  constructor(until) { super(`limite di 30 richieste al minuto di Silva: nuove chiamate dalle ${oraIt(until)}`); this.until = until; this.code = 'SILVA_LIMITE'; }
}
export const silvaLimiter = {
  // attende un posto libero nella finestra (al massimo maxAttesaMs); durante una pausa da 429 più lunga di 5 s rinuncia subito
  async acquire({ maxAttesaMs = 65_000 } = {}) {
    for (;;) {
      const now = Date.now();
      if (pausaFino > now) {
        if (pausaFino - now > Math.min(5_000, maxAttesaMs)) throw new SilvaLimiteError(pausaFino);
        await sleep(pausaFino - now);
        continue;
      }
      chiamate = chiamate.filter((t) => now - t < FINESTRA_MS);
      if (chiamate.length < LIMITE_MINUTO) { chiamate.push(now); return; }
      const attesa = FINESTRA_MS - (now - chiamate[0]) + 20;
      if (attesa > maxAttesaMs) throw new SilvaLimiteError(now + attesa);
      await sleep(attesa);
    }
  },
  pausa(ms) { pausaFino = Math.max(pausaFino, Date.now() + Math.max(0, ms)); },
  stato() { const now = Date.now(); return { usate_ultimo_minuto: chiamate.filter((t) => now - t < FINESTRA_MS).length, limite: LIMITE_MINUTO, pausa_fino: pausaFino > now ? new Date(pausaFino).toISOString() : null }; },
  reset() { chiamate = []; pausaFino = 0; },
};
// Retry-After: secondi oppure data HTTP; senza intestazione leggibile si attende un minuto
export function retryAfterMs(v, now = Date.now()) {
  if (v == null || v === '') return 60_000;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : 60_000;
}

/**
 * Chiamata a Silva attraverso il limitatore. Ritorna { res, status, data, text, ms, url }; su errore di rete o tempo scaduto lancia un
 * Error con rete = true (timeout = true se scaduto). Il registro del connettore riceve metodo, URL, esito e un messaggio (mai la chiave).
 */
export async function silvaCall(c, method, path, { body, headers = {}, timeoutMs = 30_000, module = 'orders', messaggio = null, maxAttesaMs } = {}) {
  if (!c?.credentials?.api_key) throw bad('Chiave API Silva non impostata (Amministrazione > Connettori > Silva)');
  await silvaLimiter.acquire(maxAttesaMs ? { maxAttesaMs } : undefined);
  const url = `${baseSilva(c)}${path}`;
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', 'X-API-KEY': c.credentials.api_key, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    const msg = timeout ? `nessuna risposta entro ${Math.round(timeoutMs / 1000)} s` : `non raggiungibile: ${e.cause?.message || e.message}`;
    logConnector({ kind: 'SILVA', direction: 'OUT', module, endpoint: `${method} ${url}`, status: 'ERRORE', ms: Date.now() - t0, message: messaggio ? messaggio(null, null, msg) : msg });
    throw Object.assign(new Error(msg), { rete: true, timeout });
  }
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 429) silvaLimiter.pausa(retryAfterMs(res.headers.get('retry-after')));
  const ms = Date.now() - t0;
  logConnector({ kind: 'SILVA', direction: 'OUT', module, endpoint: `${method} ${url}`, status: res.status, ms, message: messaggio ? messaggio(res, data, text) : res.ok ? null : String(text || '').slice(0, 300) });
  return { res, status: res.status, data, text: text || '', ms, url };
}
const testoErrore = (r) => (r.data && (r.data.message || r.data.error || r.data.title)) || String(r.text || '').slice(0, 200) || r.res?.statusText || '';

// Impronta della chiave (SHA-256 troncato): serve solo a capire se la chiave è cambiata dopo un 401/403. Mai la chiave in chiaro.
export const impronta = (key) => (key ? crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16) : null);
const flag = (v, def) => (v === undefined || v === null || v === '' ? def : v === true || String(v).toLowerCase() === 'true');
export const primoInvioConfermato = (c) => flag(c?.settings?.primo_invio_confermato, false);
export const pushAttivo = (c) => flag(c?.settings?.push_orders, true);
/** Trasmissione automatica all'approvazione: connettore attivo con chiave, push_orders vero e primo invio concordato già confermato */
export const automaticoAttivo = (c) => Boolean(c?.enabled && c?.credentials?.api_key && pushAttivo(c) && primoInvioConfermato(c));
const motivoNonAutomatico = (c) => (!c?.enabled ? 'connettore Silva disattivato' : !c?.credentials?.api_key ? 'chiave API Silva assente'
  : !pushAttivo(c) ? 'trasmissione all\'approvazione disattivata nel connettore (push_orders)'
    : !primoInvioConfermato(c) ? 'trasmissione automatica sospesa finché non si conferma il primo invio concordato con Silva' : null);

// app_settings del modulo (chiave/valore testo)
async function salvaImpostazione(key, value) { await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]); }
async function leggiImpostazione(key) { return (await one('SELECT value FROM app_settings WHERE key=$1', [key]))?.value ?? null; }

// ---------------------------------------------------------------------------------------------------------------------
// Destinazioni Silva: GET /api/v1/destinazioni con cache di 10 minuti in memoria; l'ultima lettura riuscita resta anche in
// app_settings (silva_destinazioni) per la pagina Strutture, la validazione dei codici e la diagnostica dopo un riavvio.
const CACHE_DESTINAZIONI_MS = 10 * 60_000;
let cacheDestinazioni = null;   // { at, dati: { destinazioni, letto_al } }
const normDest = (d) => ({ codice: String(d.codice).trim(), nome: d.nome || '', indirizzo: d.indirizzo || '', cap: d.cap ? String(d.cap) : '', citta: d.citta || '', provincia: d.provincia || '' });
export async function memorizzaDestinazioni(lista) {
  const dati = { destinazioni: lista.map(normDest), letto_al: new Date().toISOString() };
  cacheDestinazioni = { at: Date.now(), dati };
  await salvaImpostazione('silva_destinazioni', JSON.stringify(dati));
  return dati;
}
export const azzeraCacheDestinazioni = () => { cacheDestinazioni = null; };
export const validaDestinazioni = (data) => data && Array.isArray(data.destinazioni) && data.destinazioni.every((d) => d && d.codice != null && /^[1-9][0-9]*$/.test(String(d.codice).trim()));

export async function destinazioniSilva({ force = false } = {}) {
  if (!force && cacheDestinazioni && Date.now() - cacheDestinazioni.at < CACHE_DESTINAZIONI_MS) return { ...cacheDestinazioni.dati, cache: true };
  const c = await getConnector('SILVA');
  if (!c.enabled) throw bad('Connettore Silva disattivato (Amministrazione > Connettori)');
  if (!c.credentials?.api_key) throw bad('Chiave API Silva non impostata (Amministrazione > Connettori > Silva)');
  const r = await silvaCall(c, 'GET', '/api/v1/destinazioni', { messaggio: (res, data, t) => (res?.ok && Array.isArray(data?.destinazioni) ? `${data.destinazioni.length} destinazioni` : t ? String(t).slice(0, 300) : null) });
  if (r.status === 401) throw new HttpError(502, 'Silva rifiuta la chiave (401): verifica la chiave API nel connettore Silva e la sua scadenza');
  if (r.status === 403) throw new HttpError(502, 'La chiave Silva non è abilitata a ordini e destinazioni (403): chiedere l\'abilitazione a Silva');
  if (r.status === 429) throw new HttpError(503, `Silva chiede di attendere (429): riprova dopo le ${oraIt(Date.now() + retryAfterMs(r.res.headers.get('retry-after')))}`);
  if (!r.res.ok) throw new HttpError(502, `Silva risponde ${r.status}: ${testoErrore(r)}`);
  if (!validaDestinazioni(r.data)) throw new HttpError(502, 'Risposta di Silva non nel formato previsto (destinazioni con codice numerico)');
  return memorizzaDestinazioni(r.data.destinazioni);
}
/** Ultime destinazioni lette (cache o app_settings), senza chiamare Silva */
export async function destinazioniSalvate() {
  if (cacheDestinazioni) return cacheDestinazioni.dati;
  const v = await leggiImpostazione('silva_destinazioni');
  if (!v) return null;
  try { const d = JSON.parse(v); return Array.isArray(d?.destinazioni) ? d : null; } catch { return null; }
}

// Proposta automatica della destinazione per una struttura: CAP e città uguali, parole dell'indirizzo (con il civico) e del nome in
// comune. Solo una proposta: Ops la conferma o la cambia nella pagina Strutture.
const PAROLE_VUOTE = new Set(['via', 'viale', 'v', 'le', 'piazza', 'p', 'za', 'piazzale', 'largo', 'corso', 'c', 'so', 'loc', 'localita', 'frazione', 'fraz', 'strada', 'str', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'da', 'de', 'e', 'snc', 'sede', 'punto', 'prelievi', 'prelievo', 'srl', 's', 'r', 'l', 'spa', 'p', 'a', 'toscana', 'diagnostica', 'td', 'centro', 'presso']);
export const normTesto = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const parole = (s) => new Set(normTesto(s).split(' ').filter((t) => t && !PAROLE_VUOTE.has(t) && (t.length > 1 || /\d/.test(t))));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
export function proponiDestinazione(s, destinazioni) {
  if (!s || !Array.isArray(destinazioni) || !destinazioni.length) return null;
  const pi = parole(s.address), pn = parole(s.name), civ = (normTesto(s.address).match(/\b\d+[a-z]?\b/g) || []);
  const valutate = destinazioni.map((d) => {
    const motivi = []; let p = 0;
    if (s.zip && d.cap && String(s.zip).trim() === String(d.cap).trim()) { p += 3; motivi.push('CAP'); }
    if (s.city && d.citta && normTesto(s.city) === normTesto(d.citta)) { p += 2; motivi.push('città'); }
    const ji = jaccard(pi, parole(d.indirizzo));
    if (ji > 0) { p += 4 * ji; motivi.push('indirizzo'); }
    const dc = normTesto(d.indirizzo).match(/\b\d+[a-z]?\b/g) || [];
    if (ji > 0 && civ.length && dc.some((x) => civ.includes(x))) { p += 1; motivi.push('civico'); }
    const jn = jaccard(pn, parole(d.nome));
    if (jn > 0) { p += 3 * jn; motivi.push('nome'); }
    return { d, p: Math.round(p * 100) / 100, motivi };
  }).sort((a, b) => b.p - a.p);
  const [best, second] = valutate;
  if (!best || best.p < 4) return null;
  if (second && best.p - second.p < 0.75) return null;   // ambigua: nessuna proposta
  return { codice: best.d.codice, punteggio: best.p, motivo: best.motivi.join(', '), destinazione: best.d };
}

// ---------------------------------------------------------------------------------------------------------------------
// Corpo della POST conforme alla guida: SOLO numero, urgenza, destinazione {codice, noteConsegna?}, righe [{codiceArticolo,
// unitaTotali, unita}] e i facoltativi note, motivoUrgenza, dataApprovazione. Nome e indirizzo li prende Silva dalla destinazione.
export const NUMERO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DESTINAZIONE_RE = /^[1-9][0-9]{0,9}$/;
export const MAX_RIGHE = 200;
const taglia = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// unità principale del catalogo Silva: quella dell'ultima riga di giacenza letta dal catalogo per il codice; in mancanza l'unità
// dell'articolo se l'articolo viene dal catalogo Silva (source SILVA, non il segnaposto "n." dei feed senza unità)
export const unitaSilva = (l) => (l.unit_silva && String(l.unit_silva).trim()) || (l.source === 'SILVA' && l.unit && l.unit !== 'n.' ? String(l.unit).trim() : null);

/**
 * Compone l'ordine per Silva. lines: righe con qty_approved, pack_size, article_name, silva_code, source, unit, unit_silva.
 * Ritorna { payload, problemi (bloccano l'invio), avvisi, righe (indice payload → articolo, per spiegare campo righe[i]) }.
 */
export function componiOrdineSilva(order, struttura, lines) {
  const problemi = []; const avvisi = [];
  const numero = String(order.number || '');
  if (!NUMERO_RE.test(numero)) problemi.push(`numero d'ordine ${numero || '(vuoto)'} non accettato da Silva (1-64 caratteri tra lettere, numeri, punto, trattino e underscore, il primo alfanumerico)`);
  const dest = struttura?.silva_code ? String(struttura.silva_code).trim() : '';
  if (!dest) problemi.push(`struttura ${struttura?.name || ''} senza destinazione Silva: sceglila in Ordini > Strutture`.replace('  ', ' '));
  else if (!DESTINAZIONE_RE.test(dest)) problemi.push(`struttura ${struttura?.name || ''}: il codice Silva "${dest}" non è un codice destinazione (numerico): sceglila dall'elenco in Ordini > Strutture`);
  const approvate = (lines || []).filter((l) => Number(l.qty_approved || 0) > 0);
  if (!approvate.length) problemi.push('nessuna riga con quantità approvata');
  if (approvate.length > MAX_RIGHE) problemi.push(`${approvate.length} righe: Silva accetta al massimo ${MAX_RIGHE} righe per ordine, dividere l'ordine`);
  const righe = []; const info = []; const visti = new Map();
  for (const l of approvate) {
    const nome = l.article_name || l.article_code || `articolo ${l.article_id}`;
    const codice = l.silva_code ? String(l.silva_code).trim() : '';
    if (!codice) { problemi.push(`articolo ${nome} senza codice Silva: abbinalo nel catalogo`); continue; }
    const unita = unitaSilva(l);
    if (!unita) { problemi.push(`articolo ${nome}: unità del catalogo Silva non nota (l'articolo non viene dal catalogo Silva): abbinalo nel catalogo`); continue; }
    const perConf = Number(l.pack_size) || 1;
    const tot = Number(l.qty_approved) * perConf;
    if (!Number.isInteger(tot)) { problemi.push(`articolo ${nome}: ${l.qty_approved} confezioni × ${perConf} non dà un numero intero di ${unita}`); continue; }
    if (tot < 1 || tot > 999999) { problemi.push(`articolo ${nome}: ${tot} ${unita} fuori dai limiti di Silva (da 1 a 999999)`); continue; }
    if (visti.has(codice)) { problemi.push(`articoli ${visti.get(codice)} e ${nome} hanno lo stesso codice Silva ${codice}: Silva vuole una riga per articolo`); continue; }
    visti.set(codice, nome);
    righe.push({ codiceArticolo: codice, unitaTotali: tot, unita });
    info.push({ article_id: l.article_id, nome, codice, confezioni: Number(l.qty_approved), per_confezione: perConf, unita, unitaTotali: tot });
  }
  const destinazione = { codice: dest };
  const nc = taglia(struttura?.delivery_notes, 1000);
  if (nc) destinazione.noteConsegna = nc;
  const payload = { numero, urgenza: order.urgent ? 'URGENTE' : 'ORDINARIA', destinazione, righe };
  const note = String(order.ops_notes ?? '').trim();
  if (note) {
    if (note.length > 2000) avvisi.push(`note dell'Area Operations troncate a 2000 caratteri (erano ${note.length})`);
    payload.note = taglia(note, 2000);
  }
  if (order.urgent && String(order.urgent_reason ?? '').trim()) payload.motivoUrgenza = taglia(order.urgent_reason, 1000);
  if (order.approved_at) payload.dataApprovazione = new Date(order.approved_at).toISOString();
  return { payload, problemi, avvisi, righe: info };
}
/** Chiavi nell'ordine della guida (il JSONB le riordina): ripetere "la richiesta originale" vuol dire anche lo stesso testo */
export function ordinaPayload(p) {
  if (!p || typeof p !== 'object') return p;
  const out = {};
  for (const k of ['numero', 'urgenza']) if (k in p) out[k] = p[k];
  if (p.destinazione) { out.destinazione = { codice: p.destinazione.codice }; if ('noteConsegna' in p.destinazione) out.destinazione.noteConsegna = p.destinazione.noteConsegna; }
  if (Array.isArray(p.righe)) out.righe = p.righe.map((r) => ({ codiceArticolo: r.codiceArticolo, unitaTotali: r.unitaTotali, unita: r.unita }));
  for (const k of ['note', 'motivoUrgenza', 'dataApprovazione']) if (k in p) out[k] = p[k];
  return out;
}
/** Solo il corpo conforme (per chi non ha bisogno dei controlli) */
export const orderPayload = (order, struttura, lines) => componiOrdineSilva(order, struttura, lines).payload;

/** "campo" di un 400 di Silva in chiaro: righe[0].unita → riga 1 (nome dell'articolo), unità */
const CAMPI = { unita: 'unità', unitaTotali: 'quantità', codiceArticolo: 'codice articolo', codice: 'codice', noteConsegna: 'note di consegna' };
export function spiegaCampo(campo, righe = []) {
  if (!campo) return '';
  const m = String(campo).match(/^righe\[(\d+)\](?:\.(\w+))?/);
  if (m) { const i = Number(m[1]); const r = righe[i]; return `riga ${i + 1}${r ? ` (${r.nome}, codice ${r.codice})` : ''}${m[2] ? `: ${CAMPI[m[2]] || m[2]}` : ''}`; }
  if (/^destinazione/.test(campo)) return `destinazione${campo.includes('noteConsegna') ? ': note di consegna' : ' (codice Silva della struttura)'}`;
  return campo;
}

/** JSON esteso (storico, proposta del 31/10) per il polling GET /api/orders/integrations/silva/orders e per l'email di ripiego */
export function orderPayloadEsteso(order, struttura, lines) {
  return {
    numero: order.number,
    cliente: config.silva.customerCode,
    dataApprovazione: order.approved_at ? new Date(order.approved_at).toISOString() : null,
    stato: order.status,
    urgenza: order.urgent ? 'URGENTE' : 'ORDINARIA',
    motivoUrgenza: order.urgent ? order.urgent_reason || null : null,
    tipoDestinatario: order.kind === 'CLIENTE' ? 'CLIENTE_SERVICE' : order.kind === 'SEDE' ? 'SEDE_TD' : 'LABORATORIO_TD',
    origineDestinatario: struttura.origin === 'ORG' ? 'LEGAL_ENTITY' : 'SEDE',
    note: order.ops_notes || null,
    destinazione: {
      codice: struttura.silva_code || struttura.code, codiceSede: struttura.code, nome: struttura.name, indirizzo: struttura.address, cap: struttura.zip, citta: struttura.city, provincia: struttura.province,
      referente: struttura.referente, telefono: struttura.referente_phone || struttura.phone, email: struttura.email, noteConsegna: struttura.delivery_notes,
      modalita: struttura.delivery_mode === 'RITIRO' ? 'RITIRO_PRESSO_TD' : 'CONSEGNA',
    },
    righe: lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => ({
      codiceArticolo: l.article_code, codiceSilva: l.silva_code || null, gtin: l.gtin || null, descrizione: l.article_name,
      confezioni: l.qty_approved, confezione: l.pack_label, unitaPerConfezione: l.pack_size, unitaTotali: l.qty_approved * l.pack_size, unita: l.unit,
      noteOperations: l.note_ops || null,
    })),
  };
}

/** Ripiego: ordine PDF via email alla casella del fornitore. Ritorna l'esito del registro invii. */
export async function emailOrder({ order, struttura, lines, pdf }) {
  if (!config.silva.email) return { status: 'FALLITA', error: 'Email ordini Silva non impostata (connettore Silva in Amministrazione > Connettori)' };
  const payload = orderPayloadEsteso(order, struttura, lines);
  return sendMail({
    kind: 'ORDINE_FORNITORE', refKey: `SILVA:${order.id}:${Date.now()}`, to: config.silva.email, strutturaId: struttura.id,
    subject: `Ordine ${order.number}${order.urgent ? ' URGENTE' : ''} · consegna a ${struttura.name}`, title: `Ordine di materiale ${order.number}`,
    body: `In allegato l'ordine ${order.number} del ${itDate(payload.dataApprovazione)} da consegnare a ${struttura.name}, ${[struttura.address, struttura.zip, struttura.city].filter(Boolean).join(' ')}.\n\nRighe: ${payload.righe.length}. ${order.urgent ? 'Ordine urgente: ' + (order.urgent_reason || '') : 'Consegna con il primo giro utile.'}\n\nL'avanzamento (presa in carico, spedizione, consegna) va comunicato tramite le API di Orders Management.`,
    attachment: pdf ? { filename: `${order.number}.pdf`, content: pdf } : null,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Trasmissione
export async function datiOrdineSilva(orderId) {
  const o = await one(`SELECT o.*, s.name AS struttura_name FROM orders o JOIN strutture_v s ON s.id=o.struttura_id WHERE o.id=$1`, [orderId]);
  if (!o) throw new HttpError(404, 'Ordine inesistente');
  const s = await one('SELECT * FROM strutture_v WHERE id=$1', [o.struttura_id]);
  const lines = await many(`SELECT l.id, l.article_id, l.qty_approved, l.qty_requested, a.code AS article_code, a.name AS article_name, a.silva_code, a.source, a.unit, a.pack_size,
      (SELECT w.unit FROM warehouse_stock w WHERE w.article_id=a.id AND w.silva_code=a.silva_code AND w.unit IS NOT NULL AND btrim(w.unit) <> '' ORDER BY w.current DESC, w.id DESC LIMIT 1) AS unit_silva
    FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1 ORDER BY a.sort, a.code`, [orderId]);
  return { o, s, lines };
}

/** Anteprima per il dettaglio ordine: corpo che partirebbe, problemi, avvisi e stato del connettore */
export async function anteprimaSilva(orderId) {
  const { o, s, lines } = await datiOrdineSilva(orderId);
  const comp = componiOrdineSilva(o, s, lines);
  const c = await getConnector('SILVA');
  const payload = o.silva_send_status === 'IN_CODA' && o.silva_payload ? ordinaPayload(o.silva_payload) : comp.payload;
  return { ...comp, payload, connettore: connettorePubblico(c) };
}
export const connettorePubblico = (c) => ({
  attivo: Boolean(c.enabled), chiave: Boolean(c.credentials?.api_key), push_orders: pushAttivo(c), primo_invio_confermato: primoInvioConfermato(c),
  primo_invio_confermato_at: c.settings?.primo_invio_confermato_at || null, automatico: automaticoAttivo(c), motivo_non_automatico: motivoNonAutomatico(c),
  primo_invio_at: c.settings?.primo_invio_at || null, primo_invio_numero: c.settings?.primo_invio_numero || null, primo_invio_riferimento: c.settings?.primo_invio_riferimento || null,
});

const RITENTA_MS = 5 * 60_000;
// confronto indipendente dall'ordine delle chiavi (il JSONB le riordina)
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const MAX_TENTATIVI = 50;
const ultimoEvento = async (orderId) => (await one('SELECT event FROM order_events WHERE order_id=$1 ORDER BY at DESC, id DESC LIMIT 1', [orderId]))?.event;
async function eventoUnico(orderId, testo, data) { if ((await ultimoEvento(orderId)) !== testo) await event(orderId, null, testo, data); }
async function avvisaOps({ order, refKey, subject, body }) {
  const to = await opsEmails().catch(() => []);
  if (!to.length) return;
  await sendMail({ kind: 'SILVA_SEGNALAZIONE', refKey, to, strutturaId: order.struttura_id, subject, title: subject, body }).catch((e) => console.warn('[silva] email a Ops:', e.message));
}

async function aggiorna(id, campi) {
  const cols = Object.keys(campi);
  await q(`UPDATE orders SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((k) => (campi[k] !== null && typeof campi[k] === 'object' && !(campi[k] instanceof Date) ? JSON.stringify(campi[k]) : campi[k]))]);
}

/**
 * Trasmette un ordine APPROVATO a Silva (POST /api/v1/ordini). manuale = pulsante di Ops (anche prima della conferma del primo invio,
 * con conferma esplicita); altrimenti trasmissione automatica (approvazione o job), solo con automaticoAttivo.
 * Esiti in orders.silva_send_status: INVIATO, BLOCCATO, IN_CODA (con silva_retry_at), ERRORE_DATI, ERRORE_CHIAVE.
 */
export async function pushOrderToSilva(orderId, { actor = 'sistema', manuale = false, conferma = false } = {}) {
  const c = await getConnector('SILVA');
  if (!c.enabled) return { ok: false, skipped: 'connettore Silva disattivato' };
  if (!c.credentials?.api_key) return { ok: false, skipped: 'chiave API Silva assente' };
  if (!manuale && !automaticoAttivo(c)) return { ok: false, skipped: motivoNonAutomatico(c) };
  if (manuale && !primoInvioConfermato(c) && !conferma) throw bad('Primo invio a Silva: serve la conferma esplicita (la trasmissione crea un ordine reale in preparazione presso Silva)');
  const { o, s, lines } = await datiOrdineSilva(orderId);
  if (o.status !== 'APPROVATO') return { ok: false, skipped: `ordine ${o.status}: si trasmette solo un ordine approvato non ancora preso in carico` };
  if (o.silva_send_status === 'INVIATO') return { ok: true, gia: true, stato: 'INVIATO', message: `già ricevuto da Silva${o.silva_reference ? ` (rif. ${o.silva_reference})` : ''}: l'invio è concluso` };
  if (o.silva_error_code === 'immutable_order') {
    const msg = 'L\'ordine è già presso Silva con dati diversi: non si può modificare né ritrasmettere, creare un nuovo ordine';
    if (manuale) throw bad(msg);
    return { ok: false, skipped: msg };
  }
  const fp = impronta(c.credentials.api_key);
  if (!manuale && o.silva_send_status === 'ERRORE_CHIAVE' && o.silva_key_fp === fp) return { ok: false, skipped: 'chiave rifiutata da Silva: si ritenta quando la chiave del connettore cambia' };
  if (!manuale && o.silva_send_status === 'ERRORE_DATI') return { ok: false, skipped: 'dati rifiutati da Silva: si ritrasmette a mano dopo la correzione' };

  const comp = componiOrdineSilva(o, s, lines);
  if (comp.problemi.length) {
    const msg = `Non trasmesso: ${comp.problemi.join('; ')}`;
    const cambiato = o.silva_send_status !== 'BLOCCATO' || o.silva_send_message !== msg;
    await aggiorna(o.id, { silva_send_status: 'BLOCCATO', silva_send_message: msg, silva_problemi: comp.problemi, silva_retry_at: null });
    if (cambiato) await event(o.id, null, `Trasmissione a Silva bloccata: dati da completare (${actor})`, { problemi: comp.problemi });
    return { ok: false, bloccato: true, stato: 'BLOCCATO', problemi: comp.problemi, message: msg };
  }
  // Dopo un esito incerto (503, timeout, 429) si ripete la richiesta originale: stesso numero e stesso contenuto
  let payload = comp.payload; const avvisi = [...comp.avvisi];
  if (o.silva_send_status === 'IN_CODA' && o.silva_payload && o.silva_payload.numero === o.number) {
    if (JSON.stringify(canon(o.silva_payload)) !== JSON.stringify(canon(comp.payload))) avvisi.push('dati cambiati dopo un invio dall\'esito incerto: si ripete il contenuto originale per non creare un conflitto');
    payload = ordinaPayload(o.silva_payload);
  }
  await aggiorna(o.id, { silva_payload: payload });
  const msgLog = (res, data, t) => `${payload.numero}: ${res ? (res.ok ? `ricevuto${data?.riferimento ? ` rif. ${data.riferimento}` : ''}` : `${data?.error || ''} ${data?.message || String(t || '').slice(0, 200)}`.trim()) : t}`;
  let r;
  try {
    r = await silvaCall(c, 'POST', '/api/v1/ordini', { body: payload, headers: { 'X-Idempotency-Key': payload.numero }, timeoutMs: 30_000, messaggio: msgLog });
  } catch (e) {
    if (e instanceof SilvaLimiteError) {
      const msg = `In coda: ${e.message}`;
      await aggiorna(o.id, { silva_send_status: 'IN_CODA', silva_send_message: msg, silva_retry_at: new Date(e.until) });
      return { ok: false, stato: 'IN_CODA', message: msg, retry_at: new Date(e.until).toISOString() };
    }
    if (!e.rete) throw e;
    const retry = new Date(Date.now() + RITENTA_MS);
    const msg = `Silva ${e.message}: nuovo tentativo alle ${oraIt(retry)} con lo stesso numero e contenuto (il tentativo potrebbe essere già stato acquisito)`;
    await q(`UPDATE orders SET silva_send_status='IN_CODA', silva_send_message=$2, silva_retry_at=$3, silva_send_attempts=silva_send_attempts+1, silva_last_attempt_at=now(), updated_at=now() WHERE id=$1`, [o.id, msg, retry]);
    return { ok: false, stato: 'IN_CODA', message: msg, retry_at: retry.toISOString() };
  }
  await q('UPDATE orders SET silva_send_attempts=silva_send_attempts+1, silva_last_attempt_at=now() WHERE id=$1', [o.id]);
  const st = r.status; const d = r.data || {};
  // 201 nuovo ordine, 200 ricevuta originale di un ordine identico: in entrambi i casi l'invio è concluso
  if (st === 200 || st === 201) {
    const riferimento = d.riferimento ? String(d.riferimento).slice(0, 120) : null;
    const ricevuto = d.ricevutoAl && Number.isFinite(Date.parse(d.ricevutoAl)) ? d.ricevutoAl : null;
    if (d.numero && d.numero !== payload.numero) avvisi.push(`la ricevuta riporta il numero ${d.numero}`);
    const msg = `${st === 201 ? 'Ricevuto da Silva (nuovo ordine)' : 'Ricevuta originale di un ordine identico già acquisito'}${riferimento ? ` · rif. ${riferimento}` : ''}${ricevuto ? ` · ricevuto alle ${dataOraIt(ricevuto)}` : ''}${avvisi.length ? ` · ${avvisi.join('; ')}` : ''}`;
    await q(`UPDATE orders SET silva_send_status='INVIATO', silva_send_message=$2, silva_sent_at=now(), silva_reference=coalesce($3, silva_reference), silva_received_at=coalesce($4::timestamptz, silva_received_at, now()),
      silva_retry_at=NULL, silva_error_code=NULL, silva_error_field=NULL, silva_problemi=NULL, silva_key_fp=NULL, updated_at=now() WHERE id=$1`, [o.id, msg, riferimento, ricevuto]);
    await event(o.id, null, `Trasmesso a Silva (${actor}): ${st === 201 ? 'nuovo ordine in preparazione' : 'ricevuta originale di un ordine identico'}${riferimento ? ` · rif. ${riferimento}` : ''}`, { status: st, riferimento, ricevutoAl: d.ricevutoAl || null, avvisi });
    let primoInvio = false;
    if (st === 201 && !c.settings?.primo_invio_at) {
      primoInvio = true;
      await saveConnector('SILVA', { settings: { primo_invio_at: new Date().toISOString(), primo_invio_numero: payload.numero, primo_invio_riferimento: riferimento } }, null).catch((e) => console.warn('[silva] primo invio non annotato:', e.message));
    }
    return { ok: true, status: st, stato: 'INVIATO', message: msg, riferimento, ricevutoAl: d.ricevutoAl || null, primo_invio: primoInvio, proponi_automatismo: !primoInvioConfermato(c), avvisi };
  }
  if (st === 400 || st === 413 || st === 415) {
    const code = st === 400 ? (d.error ? String(d.error).slice(0, 80) : 'dati_non_validi') : st === 413 ? 'payload_too_large' : 'unsupported_media_type';
    const campo = d.campo ? String(d.campo).slice(0, 120) : null;
    const spiegato = spiegaCampo(campo, comp.righe);
    const msg = code === 'immutable_order'
      ? `L'ordine è già presso Silva con dati diversi: non si può modificare, creare un nuovo ordine${d.message ? ` (Silva: ${d.message})` : ''}`
      : st === 413 ? 'Silva rifiuta il corpo (413): oltre 1 MiB' : st === 415 ? 'Silva rifiuta il formato (415): serve Content-Type application/json'
        : `Silva rifiuta i dati (${code}): ${d.message || testoErrore(r)}${spiegato ? ` · ${spiegato}` : ''}`;
    await aggiorna(o.id, { silva_send_status: 'ERRORE_DATI', silva_send_message: msg, silva_error_code: code, silva_error_field: campo, silva_retry_at: null });
    await event(o.id, null, code === 'immutable_order' ? 'Silva: ordine già presente con dati diversi (immutable_order), non ritrasmissibile' : `Trasmissione a Silva rifiutata: ${code}`, { status: st, error: d.error || null, message: d.message || null, campo, riga: spiegato || null });
    await avvisaOps({ order: o, refKey: `SILVA_ERRORE:${o.id}:${code}:${campo || ''}`, subject: `Ordine ${o.number}: ${code === 'immutable_order' ? 'già presso Silva con dati diversi' : 'rifiutato da Silva'}`,
      body: `${msg}.\n\nOrdine ${o.number} per ${s?.name || ''}. ${code === 'immutable_order' ? 'Non si ritrasmette: se il materiale serve ancora, creare un nuovo ordine.' : 'Correggere i dati indicati e premere "Trasmetti a Silva" nel dettaglio dell\'ordine.'}` });
    return { ok: false, status: st, stato: 'ERRORE_DATI', error: d.error || code, campo, riga: spiegato || null, message: msg };
  }
  if (st === 401 || st === 403) {
    const msg = st === 401 ? 'Silva rifiuta la chiave (401): verifica la chiave API del connettore Silva e la sua scadenza. Non si ritenta finché la chiave non cambia'
      : 'La chiave Silva non è abilitata agli ordini (403): chiedere a Silva l\'abilitazione. Non si ritenta finché la chiave non cambia';
    await aggiorna(o.id, { silva_send_status: 'ERRORE_CHIAVE', silva_send_message: msg, silva_key_fp: fp, silva_error_code: String(st), silva_error_field: null, silva_retry_at: null });
    await eventoUnico(o.id, `Trasmissione a Silva: chiave rifiutata (${st})`, { status: st });
    return { ok: false, status: st, stato: 'ERRORE_CHIAVE', message: msg };
  }
  // 429: attesa del Retry-After e poi la stessa richiesta (dal job); 5xx e ogni altra risposta: ritentativo tra 5 minuti
  const retry = st === 429 ? new Date(Date.now() + retryAfterMs(r.res.headers.get('retry-after'))) : new Date(Date.now() + RITENTA_MS);
  const msg = st === 429 ? `Silva chiede di attendere (429): nuovo tentativo alle ${oraIt(retry)}`
    : `Silva risponde ${st}${testoErrore(r) ? `: ${testoErrore(r)}` : ''}: nuovo tentativo alle ${oraIt(retry)} con lo stesso numero e contenuto`;
  await aggiorna(o.id, { silva_send_status: 'IN_CODA', silva_send_message: msg, silva_retry_at: retry });
  return { ok: false, status: st, stato: 'IN_CODA', message: msg, retry_at: retry.toISOString() };
}

/**
 * Job orders:silva-push (ogni 5 minuti): solo con la trasmissione automatica attiva. Ordini APPROVATO da trasmettere (approvati dopo
 * l'attivazione dell'automatismo, così l'arretrato non parte da solo), in coda con il tentativo scaduto, bloccati (si ricontrollano i
 * dati: partono appena completi) e rifiutati per chiave se la chiave è cambiata. Al massimo 50 tentativi per ordine.
 */
export async function pushPendingOrders() {
  let c = await getConnector('SILVA');
  if (!automaticoAttivo(c)) return { skipped: motivoNonAutomatico(c) };
  if (!c.settings?.primo_invio_confermato_at) c = await saveConnector('SILVA', { settings: { primo_invio_confermato_at: new Date().toISOString() } }, null);
  const fp = impronta(c.credentials.api_key);
  const rows = await many(`SELECT id, number FROM orders WHERE status='APPROVATO' AND silva_send_attempts < $1
      AND (silva_retry_at IS NULL OR silva_retry_at <= now())
      AND (silva_send_status = 'IN_CODA'
           OR (silva_send_status = 'ERRORE_CHIAVE' AND silva_key_fp IS DISTINCT FROM $2)
           OR ((silva_send_status IS NULL OR silva_send_status = 'BLOCCATO') AND approved_at >= $3::timestamptz))
    ORDER BY urgent DESC, approved_at LIMIT 20`, [MAX_TENTATIVI, fp, c.settings.primo_invio_confermato_at]);
  const esiti = [];
  for (const r of rows) {
    try {
      const out = await pushOrderToSilva(r.id, { actor: 'trasmissione automatica' });
      esiti.push({ numero: r.number, ok: out.ok, stato: out.stato || null, message: out.message || out.skipped });
      if (out.stato === 'ERRORE_CHIAVE') break;   // stessa chiave per tutti: inutile proseguire
      if (out.stato === 'IN_CODA' && (out.status === 429 || /limite/.test(out.message || ''))) break;
    } catch (e) { esiti.push({ numero: r.number, ok: false, message: e.message }); }
  }
  return { tentati: rows.length, inviati: esiti.filter((x) => x.stato === 'INVIATO').length, esiti };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stato presso Silva: GET /api/v1/ordini/{numero}/stato. Job orders:silva-stato ogni 30 minuti sugli ordini ricevuti da Silva e non
// ancora consegnati, pulsante "Aggiorna stato da Silva" nel dettaglio. Niente callback in questa versione della guida: i callback
// presa-in-carico / spedito / consegnato di routes/integrations.js restano (se un giorno Silva li userà).
export const STATI_SILVA = ['IN_PREPARAZIONE', 'EVASO', 'ANNULLATO', 'NON_DISPONIBILE'];
const NOTA_EVASO = 'Silva ha emesso il DDT: la consegna la conferma la struttura al carico';

async function segnala(o, { titolo, descrizione, refKey }) {
  const aperta = await one(`SELECT id FROM issues WHERE order_id=$1 AND status='APERTA' AND kind='ALTRO' AND description LIKE $2`, [o.id, `${titolo}%`]);
  if (!aperta) await q(`INSERT INTO issues (order_id, struttura_id, kind, description, opened_by) VALUES ($1,$2,'ALTRO',$3,NULL)`, [o.id, o.struttura_id, `${titolo}. ${descrizione}`]);
  await avvisaOps({ order: o, refKey, subject: `Ordine ${o.number}: ${titolo.toLowerCase()}`, body: `${titolo}. ${descrizione}` });
}

/** Applica allo stato interno l'esito della GET stato. Ritorna { stato, cambiato, azione } */
export async function applicaStatoSilva(o, { status, data }) {
  if (status === 404 || data?.presente === false) {
    const nuovo = o.silva_stato !== 'ASSENTE';
    await q(`UPDATE orders SET silva_stato='ASSENTE', silva_stato_at=now(), silva_stato_dal=CASE WHEN silva_stato IS DISTINCT FROM 'ASSENTE' THEN now() ELSE silva_stato_dal END,
      silva_stato_msg=$2, updated_at=now() WHERE id=$1`, [o.id, 'Silva non trova l\'ordine (404): assente o fuori dal perimetro della chiave']);
    if (nuovo) {
      await event(o.id, null, `Silva non trova l'ordine (404) dopo la ricevuta${o.silva_reference ? ` rif. ${o.silva_reference}` : ''}: segnalato all'Area Operations`, { status: 404 });
      await segnala(o, { titolo: 'Ordine non trovato da Silva', descrizione: `La GET stato risponde 404 (presente=false) per ${o.number}, già ricevuto${o.silva_reference ? ` con rif. ${o.silva_reference}` : ''}. Verificare con Silva.`, refKey: `SILVA_404:${o.id}` });
    }
    return { stato: 'ASSENTE', cambiato: nuovo, azione: nuovo ? 'segnalato' : null };
  }
  const stato = String(data?.stato || '');
  if (!STATI_SILVA.includes(stato)) throw new Error(`stato Silva non riconosciuto: ${stato || '(vuoto)'}`);
  if (data?.numero && data.numero !== o.number) throw new Error(`Silva risponde per il numero ${data.numero} invece di ${o.number}`);
  const cambiato = o.silva_stato !== stato;
  const msg = { IN_PREPARAZIONE: 'In preparazione presso Silva', EVASO: 'Evaso da Silva (DDT emesso): la consegna la conferma la struttura al carico', ANNULLATO: 'Annullato presso Silva: tutte le righe annullate', NON_DISPONIBILE: 'Silva: stato non determinabile ora, si riprova al prossimo controllo' }[stato];
  await q(`UPDATE orders SET silva_stato=$2, silva_stato_at=now(), silva_stato_dal=CASE WHEN silva_stato IS DISTINCT FROM $2 THEN now() ELSE silva_stato_dal END, silva_stato_msg=$3, updated_at=now() WHERE id=$1`, [o.id, stato, msg]);
  let azione = null;
  if (stato === 'IN_PREPARAZIONE' && o.status === 'APPROVATO') {
    await markPicked(o, { reference: o.silva_reference, label: 'In preparazione presso Silva (presa in carico, stato letto dall\'API)' });
    azione = 'PRESO_IN_CARICO';
  } else if (stato === 'EVASO' && ['APPROVATO', 'PRESO_IN_CARICO'].includes(o.status)) {
    await markShipped(o, { label: NOTA_EVASO, data: { stato_silva: 'EVASO', rilevato: new Date().toISOString() } });
    azione = 'SPEDITO';
  } else if (stato === 'ANNULLATO' && cambiato) {
    if (['APPROVATO', 'PRESO_IN_CARICO'].includes(o.status)) {
      await q("DELETE FROM packages WHERE order_id=$1 AND status='ATTESO'", [o.id]);
      await q(`UPDATE orders SET status='ANNULLATO', cancelled_at=now(), cancel_reason=$2, updated_at=now() WHERE id=$1`, [o.id, 'Annullato presso Silva: tutte le righe annullate (stato letto dall\'API)']);
      azione = 'ANNULLATO';
    }
    await event(o.id, null, 'Annullato presso Silva (tutte le righe annullate): segnalato all\'Area Operations', { stato_silva: 'ANNULLATO' });
    await segnala(o, { titolo: 'Ordine annullato presso Silva', descrizione: `Silva riporta ${o.number} come ANNULLATO (tutte le righe articolo annullate).${azione ? ' L\'ordine è stato annullato anche nella Suite.' : ` Nella Suite l'ordine è ${o.status}: verificare.`} Se il materiale serve ancora, creare un nuovo ordine.`, refKey: `SILVA_ANNULLATO:${o.id}` });
    azione = azione || 'segnalato';
  }
  return { stato, cambiato, azione };
}

/** Legge lo stato di un ordine presso Silva e lo applica */
export async function statoOrdineSilva(orderId, { c } = {}) {
  c = c || await getConnector('SILVA');
  if (!c.enabled || !c.credentials?.api_key) throw bad('Connettore Silva non attivo o chiave API assente');
  const o = await one(`SELECT o.*, s.email AS struttura_email, s.name AS struttura_name FROM orders o JOIN strutture_v s ON s.id=o.struttura_id WHERE o.id=$1`, [orderId]);
  if (!o) throw new HttpError(404, 'Ordine inesistente');
  if (o.silva_send_status !== 'INVIATO') throw bad('Lo stato si legge solo per gli ordini già ricevuti da Silva');
  const r = await silvaCall(c, 'GET', `/api/v1/ordini/${encodeURIComponent(o.number)}/stato`, { timeoutMs: 20_000, messaggio: (res, data, t) => `${o.number}: ${res ? (data?.stato || (res.status === 404 ? 'assente' : String(t || '').slice(0, 200))) : t}` });
  if (r.status === 401 || r.status === 403) throw Object.assign(new HttpError(502, r.status === 401 ? 'Silva rifiuta la chiave (401)' : 'La chiave Silva non è abilitata agli ordini (403)'), { chiave: true });
  if (r.status === 429) throw Object.assign(new HttpError(503, `Silva chiede di attendere (429): riprova dopo le ${oraIt(Date.now() + retryAfterMs(r.res.headers.get('retry-after')))}`), { limite: true });
  if (r.status !== 200 && r.status !== 404) {
    await q('UPDATE orders SET silva_stato_at=now(), silva_stato_msg=$2 WHERE id=$1', [o.id, `Lettura dello stato non riuscita: Silva risponde ${r.status}`]);
    throw new HttpError(502, `Silva risponde ${r.status}: ${testoErrore(r)}`);
  }
  return { numero: o.number, ...(await applicaStatoSilva(o, { status: r.status, data: r.data })) };
}

/** Job orders:silva-stato: ordini ricevuti da Silva, non ancora consegnati né evasi/annullati, dal controllo più vecchio */
export async function aggiornaStatiSilva() {
  const c = await getConnector('SILVA');
  if (!c.enabled || !c.credentials?.api_key) return { skipped: !c.enabled ? 'connettore Silva disattivato' : 'chiave API Silva assente' };
  const rows = await many(`SELECT id, number FROM orders WHERE silva_send_status='INVIATO' AND status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO')
      AND coalesce(silva_stato, '') NOT IN ('EVASO','ANNULLATO') ORDER BY silva_stato_at NULLS FIRST, approved_at LIMIT 25`);
  const esiti = []; let interrotto = null;
  for (const r of rows) {
    try { esiti.push(await statoOrdineSilva(r.id, { c })); }
    catch (e) {
      esiti.push({ numero: r.number, errore: e.message });
      if (e.chiave || e.limite || e instanceof SilvaLimiteError) { interrotto = e.message; break; }
    }
  }
  const msg = interrotto ? `interrotto: ${interrotto}` : `${rows.length} ordini controllati${esiti.filter((x) => x.cambiato).length ? `, ${esiti.filter((x) => x.cambiato).length} cambiati` : ''}`;
  await salvaImpostazione('silva_last_stato_at', new Date().toISOString());
  await salvaImpostazione('silva_last_stato_msg', msg);
  return { controllati: rows.length, esiti, interrotto };
}

// ---------------------------------------------------------------------------------------------------------------------
/** Riga di stato per Impostazioni Ordini e per la pagina Strutture */
export async function statoIntegrazioneSilva() {
  const c = await getConnector('SILVA');
  const dest = await destinazioniSalvate();
  const conti = await one(`SELECT
      count(*) FILTER (WHERE status='APPROVATO' AND silva_send_status IS NULL)::int AS da_trasmettere,
      count(*) FILTER (WHERE status='APPROVATO' AND silva_send_status='IN_CODA')::int AS in_coda,
      count(*) FILTER (WHERE status='APPROVATO' AND silva_send_status IN ('ERRORE_DATI','ERRORE_CHIAVE','BLOCCATO','ERRORE'))::int AS in_errore,
      count(*) FILTER (WHERE status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO') AND silva_send_status='INVIATO')::int AS presso_silva
    FROM orders`);
  const ultimo = await one(`SELECT number, silva_sent_at, silva_reference FROM orders WHERE silva_sent_at IS NOT NULL ORDER BY silva_sent_at DESC LIMIT 1`);
  const destinazioni = dest?.destinazioni || [];
  const codici = new Set(destinazioni.map((d) => d.codice));
  const senza = await many(`SELECT id, code, name, city, silva_code, origin FROM strutture_v WHERE active AND NOT delivery_point AND (silva_code IS NULL OR silva_code !~ '^[1-9][0-9]*$') ORDER BY origin DESC, name`);
  const nonAutorizzate = dest ? (await many(`SELECT id, code, name, silva_code FROM strutture_v WHERE active AND NOT delivery_point AND silva_code ~ '^[1-9][0-9]*$' ORDER BY name`)).filter((x) => !codici.has(String(x.silva_code))) : [];
  return {
    connettore: connettorePubblico(c),
    destinazioni: { lette: destinazioni.length, letto_al: dest?.letto_al || null },
    ultimo_invio: ultimo ? { numero: ultimo.number, at: ultimo.silva_sent_at, riferimento: ultimo.silva_reference } : null,
    ...conti,
    ultimo_controllo_stato: { at: await leggiImpostazione('silva_last_stato_at'), esito: await leggiImpostazione('silva_last_stato_msg') },
    strutture_senza_destinazione: senza,
    strutture_destinazione_non_autorizzata: nonAutorizzate,
    limite: silvaLimiter.stato(),
  };
}
