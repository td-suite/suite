// Ricerca prospect · REGISTRO IMPRESE tramite l'API Company di Openapi (la società di www.ufficiocamerale.it), secondo la specifica
// ufficiale letta il 16/11/2026 (console.openapi.com/oas/it/company.openapi.json): GET /IT-search con Authorization: Bearer <token>,
// parametri province, atecoCode, minEmployees, activityStatus, dataEnrichment, skip, limit, dryRun; al massimo 1000 risultati per
// richiesta. È un servizio A PAGAMENTO: ogni ricerca vera parte solo dopo la stima gratuita (dryRun) e la conferma di chi la lancia.
// I dati del registro si possono conservare. Token e indirizzo stanno nel connettore OPENAPI (Amministrazione > Connettori).
import { getConnector, logConnector } from '../../../../lib/connectors.js';
import { pivaValida } from './estrai.js';
import { maiuscolette } from './fonti.js';
import { PROVINCE } from './scoperta.js';

// codici ATECO proposti per tipologia (modificabili in pagina: la stima gratuita dice subito quante imprese corrispondono).
// VERIFICATO SUL SERVIZIO VERO il 17/11/2026 (stime gratuite su Firenze e Prato): Openapi confronta il codice PER INTERO con quello che ha
// in archivio per l'impresa, e lo ha a precisione variabile, 3 o 4 cifre (869 → 25 imprese, 8690 → 0, 8691 → 2; 871 → 19, 8710 → 0;
// 8622 → 67, 862 → 2; 4773 → 58, 477 → 2). Non accetta prefissi. Per questo ogni tipologia propone più varianti: quelle senza imprese
// non costano nulla. 869 è il gruppo generico "altri servizi di assistenza sanitaria": contiene i laboratori ma anche altro.
export const ATECO = {
  RSA: ['871', '873', '8710', '8730'], CASA_DI_CURA: ['861', '8610'], POLIAMBULATORIO: ['8622', '862'], STUDIO_MEDICO: ['8621', '862'], LABORATORIO: ['869', '8690', '8691'], FISIOTERAPIA: ['869', '8690'], DENTISTA: ['8623'], VETERINARIO: ['750', '7500'], FARMACIA: ['4773', '477'], AZIENDA: [],
};
const pulisciCodice = (c) => String(c || '').replace(/[^0-9A-Za-z]/g, '');

async function chiama(percorso, parametri, { fetchFn = fetch, timeoutMs = 60_000 } = {}) {
  const c = await getConnector('OPENAPI');
  if (!c.active || !c.credentials.api_key) throw Object.assign(new Error('Il connettore Openapi non è attivo: inserisci il token in Amministrazione > Connettori > Openapi Company e abilitalo'), { status: 400 });
  const base = String(c.base_url || 'https://company.openapi.com').replace(/\/+$/, '');
  const qs = new URLSearchParams(Object.entries(parametri).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const t0 = Date.now(); let r; let testo = '';
  try { r = await fetchFn(`${base}${percorso}?${qs}`, { headers: { Authorization: `Bearer ${c.credentials.api_key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); testo = await r.text(); }
  catch (e) { await logConnector({ kind: 'OPENAPI', direction: 'OUT', module: 'business', endpoint: `GET ${percorso}`, status: 'ERRORE', ms: Date.now() - t0, message: e.message }); throw new Error(`Openapi non raggiungibile (${e.name === 'TimeoutError' ? 'nessuna risposta in tempo' : e.cause?.code || e.message})`); }
  let j = null; try { j = testo ? JSON.parse(testo) : null; } catch { /* risposta non JSON */ }
  const ok = r.status === 200 || r.status === 204;
  await logConnector({ kind: 'OPENAPI', direction: 'OUT', module: 'business', endpoint: `GET ${percorso}?${[...qs.keys()].join('&')}`, status: ok ? 'OK' : 'ERRORE', ms: Date.now() - t0, message: ok ? null : String(j?.message || testo).slice(0, 200) });
  if (r.status === 204) return { data: [], vuoto: true };
  if (!ok) {
    const perche = r.status === 401 || r.status === 403 ? 'token non valido o senza il permesso per questa ricerca (scope IT-search)' : r.status === 402 ? `credito insufficiente sul conto Openapi (${j?.message || ''})` : (j?.message || testo.slice(0, 200) || `risposta ${r.status}`);
    throw Object.assign(new Error(`Openapi: ${perche}`), { status: 400, codice: r.status });
  }
  return j || { data: [] };
}
// la forma della risposta di prova non è descritta nella specifica: si leggono i campi più probabili e, se non ci sono, si mostra la risposta così com'è
function leggiStima(j) {
  const d = j?.data; const cerca = (o, nomi) => { for (const n of nomi) if (o && typeof o === 'object' && Number.isFinite(Number(o[n]))) return Number(o[n]); return null; };
  const dove = Array.isArray(d) ? d[0] : d;
  const n = cerca(dove, ['count', 'total', 'totalCount', 'records', 'results', 'found']) ?? cerca(j, ['count', 'total']);
  const prezzo = cerca(dove, ['price', 'cost', 'amount', 'totalPrice']) ?? cerca(j, ['price', 'cost']);
  return { imprese: j?.vuoto ? 0 : n, prezzo, grezzo: n == null ? JSON.stringify(d ?? j).slice(0, 300) : null };
}
/** Stima gratuita: quante imprese e a che prezzo, per ogni provincia e codice attività. Nessun dato scaricato. */
export async function stimaRegistro({ province, codici, minEmployees = null, arricchimento = 'advanced' }, opts = {}) {
  const righe = []; let imprese = 0; let prezzo = 0; let incerta = false;
  for (const p of province) for (const cod of codici.map(pulisciCodice).filter(Boolean)) {
    const j = await chiama('/IT-search', { dryRun: 1, province: p, atecoCode: cod, activityStatus: 'ATTIVA', minEmployees: minEmployees || undefined, dataEnrichment: arricchimento }, opts);
    const s = leggiStima(j);
    if (s.imprese == null) incerta = true; else imprese += s.imprese;
    if (s.prezzo != null) prezzo += s.prezzo;
    righe.push({ provincia: p, codice: cod, ...s, testo: s.imprese != null ? `${PROVINCE[p] || p}, codice ${cod}: ${s.imprese} imprese${s.prezzo != null ? `, ${s.prezzo.toFixed(2)} €` : ''}` : `${PROVINCE[p] || p}, codice ${cod}: ${s.grezzo}` });
  }
  return { righe, imprese: incerta ? null : imprese, prezzo: prezzo ? Math.round(prezzo * 100) / 100 : (incerta ? null : 0), incerta };
}
const NOME_CAT = { LABORATORIO: /laborator|analisi|diagnost|biomedic|patolog/i, RSA: /\brsa\b|residenz|casa di riposo|anziani|assistit/i, CASA_DI_CURA: /casa di cura|clinica|ospedal|villa/i,
  POLIAMBULATORIO: /poliambulator|centro medico|medical|ambulator|salute|diagnost/i, STUDIO_MEDICO: /studio|medic|dott/i, FISIOTERAPIA: /fisio|riabilit|kines/i, VETERINARIO: /veterinar/i, FARMACIA: /farmac/i, DENTISTA: /dent|odonto/i };
const nomeConferma = (nome, cat) => (NOME_CAT[cat] ? NOME_CAT[cat].test(nome) : true);
const CAT_DA_ATECO = [[/^871|^873|^87/, 'RSA'], [/^861/, 'CASA_DI_CURA'], [/^8622/, 'POLIAMBULATORIO'], [/^8621/, 'STUDIO_MEDICO'], [/^8623/, 'DENTISTA'], [/^86901|^8690/, 'LABORATORIO'], [/^75/, 'VETERINARIO'], [/^4773/, 'FARMACIA']];
/** Impresa del registro (arricchimento advanced) → candidato, con i dipendenti e il fatturato dell'ultimo bilancio come segnali */
export function candidatoDaImpresa(x, { categoria = null, linea = 'SRV' } = {}) {
  const a = x.address?.registeredOffice || {};
  const at = x.atecoClassification || {}; const cod = String(at.ateco2007?.code || at.ateco2022?.code || at.ateco?.code || '');
  const b = x.balanceSheets?.last || null;
  const nome = String(x.companyName || '').trim(); if (!nome) return null;
  const prov = String(a.province || '').toUpperCase();
  const piva = String(x.vatCode || '').replace(/\D/g, '');
  const fonte = 'Registro imprese (Openapi)';
  const segnali = {};
  if (b && Number(b.employees) > 0) segnali.DIPENDENTI = { valore: Number(b.employees), evidenza: `${fonte}: ${b.employees} dipendenti al bilancio ${b.year || ''}`.trim(), url: null };
  if (piva) segnali.PIVA_NOTA = { valore: piva, evidenza: fonte, url: null };
  if (x.pec) segnali.PEC_NOTA = { valore: String(x.pec).toLowerCase(), evidenza: fonte, url: null };
  return {
    fonte: 'REGISTRO', fonte_ref: String(x.id || piva || x.taxCode || nome).slice(0, 200), nome: maiuscolette(nome).slice(0, 200),
    // il codice di dettaglio dell'impresa decide la tipologia; se Openapi ha solo il gruppo generico (3 cifre) la tipologia scelta in ricerca
    // vale solo se il nome la conferma, altrimenti resta "Altro" da verificare (869 comprende laboratori, ma anche studi di altro tipo)
    categoria: linea === 'MDL' ? (categoria || 'AZIENDA') : (CAT_DA_ATECO.find(([re]) => re.test(cod) && cod.length >= 4) || [])[1]
      || (categoria && (cod.length >= 4 || !cod || nomeConferma(nome, categoria)) ? categoria : null) || (CAT_DA_ATECO.find(([re]) => re.test(cod)) || [])[1] || 'ALTRO',
    indirizzo: a.streetName ? maiuscolette(a.streetName) : null, cap: a.zipCode || null, comune: a.town ? maiuscolette(a.town) : null, provincia: PROVINCE[prov] ? prov : (prov || null),
    lat: a.gps?.coordinates?.[1] ?? null, lon: a.gps?.coordinates?.[0] ?? null, telefono: null, email: null, pec: x.pec ? String(x.pec).toLowerCase() : null, sito: null, dominio: null,
    piva: pivaValida(piva) ? piva : null, operatore: null, segnali,
    tags: { elenco: 'Registro imprese', ateco: cod || null, ateco_descrizione: at.ateco2007?.description || at.ateco2022?.description || at.ateco?.description || null, forma: x.detailedLegalForm?.description || null,
      dipendenti: b?.employees ?? null, fatturato: b?.turnover ?? null, bilancio: b?.year ?? null, codice_fiscale: x.taxCode || null, rea: x.reaCode ? `${x.cciaa || ''} ${x.reaCode}`.trim() : null, pubblico: false },
  };
}
/** Scarica le imprese (a pagamento): una richiesta per provincia e codice, paginata, con un tetto complessivo. { candidati, scaricate, tagliata } */
export async function cercaRegistro({ province, codici, minEmployees = null, max = 300, categoria = null, linea = 'SRV', progresso = () => {} }, opts = {}) {
  const visti = new Set(); const candidati = []; let tagliata = false;
  fuori: for (const p of province) for (const cod of codici.map(pulisciCodice).filter(Boolean)) {
    for (let skip = 0; skip < 1000; skip += 100) {
      const resto = max - candidati.length; if (resto <= 0) { tagliata = true; break fuori; }
      await progresso(`${PROVINCE[p] || p}, codice ${cod}: scarico dal registro (${candidati.length} finora)`);
      const j = await chiama('/IT-search', { province: p, atecoCode: cod, activityStatus: 'ATTIVA', minEmployees: minEmployees || undefined, dataEnrichment: 'advanced', skip, limit: Math.min(100, resto) }, opts);
      const dati = Array.isArray(j?.data) ? j.data : [];
      for (const x of dati) { const c = candidatoDaImpresa(x, { categoria, linea }); if (c && !visti.has(c.fonte_ref)) { visti.add(c.fonte_ref); candidati.push(c); } }
      if (dati.length < Math.min(100, resto)) break;
    }
  }
  return { candidati, scaricate: candidati.length, tagliata };
}
