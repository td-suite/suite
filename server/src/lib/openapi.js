// Openapi in tutta la Suite, fase 1 (v0.80.0, richiesta del CEO del 17/11/2026: "integrale in tutti i campi in cui migliora la resa, i
// controlli, il ribaltamento dei dati; voglio che diventi tutto automatico").
// - API Company, GET /IT-advanced/{partita IVA o codice fiscale}: scheda dell'impresa (ragione sociale, sede legale, PEC, codice SDI, ATECO,
//   forma giuridica, REA, stato attività, ultimo bilancio, soci). Specifica letta il 17/11/2026 su console.openapi.com/oas/it/company.openapi.json.
// - API Cap (host cap.openapi.it), GET /cap/{cap}: comuni, provincia e regione di un CAP. Specifica: .../oas/it/cap.openapi.json.
// Stesso token del connettore OPENAPI (Amministrazione > Connettori): deve avere gli scope di IT-advanced e, per i CAP, dell'API Cap.
// Regole:
// - ogni scheda è a pagamento: cache (openapi_cache) e tetto mensile di schede (impostazione del connettore `tetto_schede_mese`, 200);
// - RIBALTAMENTO AUTOMATICO SOLO NEI CAMPI VUOTI: un dato già scritto in anagrafica non viene mai sovrascritto da solo; se differisce dal
//   registro resta com'è e la differenza viene segnalata (organizations.registry_diff) per la decisione di una persona;
// - controllo periodico delle Legal entity con partita IVA o codice fiscale: cessazioni e variazioni di sede, PEC, SDI.
import { getConnector, logConnector } from './connectors.js';
import { one, many, q } from '../db.js';
import { audit } from './util.js';

const HOST_CAP = { 'https://company.openapi.com': 'https://cap.openapi.it', 'https://test.company.openapi.com': 'https://test.cap.openapi.it' };
export const pulisciCodice = (c) => String(c || '').replace(/^IT/i, '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
export const codiceValido = (c) => /^(\d{11}|[A-Z0-9]{16})$/.test(pulisciCodice(c));
const mese = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7);
const titolo = (s) => String(s || '').toLowerCase().replace(/(^|[\s'’.-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase());

export async function impostazioniOpenapi() {
  const c = await getConnector('OPENAPI');
  const s = c.settings || {};
  const n = (v, d, min, max) => { const x = Number(v); return Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : d; };
  return { attivo: Boolean(c.active && c.credentials?.api_key), tetto_schede_mese: n(s.tetto_schede_mese, 200, 0, 100000), giorni_cache: n(s.giorni_cache, 30, 1, 365), giorni_verifica: n(s.giorni_verifica, 90, 7, 730),
    verifiche_per_notte: n(s.verifiche_per_notte, 25, 0, 500), verifica_automatica: s.verifica_automatica !== false && s.verifica_automatica !== 'false' };
}
export async function usoMese(servizio = 'impresa') { return (await one('SELECT chiamate FROM openapi_uso WHERE mese=$1 AND servizio=$2', [mese(), servizio]))?.chiamate || 0; }
const conta = (servizio) => q(`INSERT INTO openapi_uso (mese, servizio, chiamate) VALUES ($1,$2,1) ON CONFLICT (mese, servizio) DO UPDATE SET chiamate = openapi_uso.chiamate + 1`, [mese(), servizio]);

/** Chiamata GET a un servizio Openapi con il token del connettore; ogni esito va nel registro chiamate. */
async function chiama(servizio, percorso, { modulo = 'core', fetchFn = fetch, timeoutMs = 30_000 } = {}) {
  const c = await getConnector('OPENAPI');
  if (!c.active || !c.credentials?.api_key) throw Object.assign(new Error('Il connettore Openapi non è attivo: token e interruttore in Amministrazione > Connettori > Openapi'), { status: 400 });
  const company = String(c.base_url || 'https://company.openapi.com').replace(/\/+$/, '');
  // CAP: host proprio di Openapi; con una Base URL che non è di Openapi (prove, proxy) resta sullo stesso indirizzo
  const base = servizio === 'cap' ? HOST_CAP[company] || (/openapi\.(com|it)$/i.test(new URL(company).hostname) ? 'https://cap.openapi.it' : company) : company;
  const t0 = Date.now(); let r; let testo = '';
  try { r = await fetchFn(`${base}${percorso}`, { headers: { Authorization: `Bearer ${c.credentials.api_key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); testo = await r.text(); }
  catch (e) { await logConnector({ kind: 'OPENAPI', direction: 'OUT', module: modulo, endpoint: `GET ${servizio}${percorso.replace(/\/[^/]+$/, '/…')}`, status: 'ERRORE', ms: Date.now() - t0, message: e.message }); throw Object.assign(new Error(`Openapi non raggiungibile (${e.name === 'TimeoutError' ? 'nessuna risposta in tempo' : e.cause?.code || e.message})`), { status: 502 }); }
  let j = null; try { j = testo ? JSON.parse(testo) : null; } catch { /* non JSON */ }
  const ok = r.status === 200 || r.status === 204 || r.status === 404;
  // nel registro non finisce la partita IVA cercata: solo il tipo di chiamata
  await logConnector({ kind: 'OPENAPI', direction: 'OUT', module: modulo, endpoint: `GET ${servizio}${percorso.replace(/\/[^/]+$/, '/…')}`, status: ok ? 'OK' : 'ERRORE', ms: Date.now() - t0, message: ok ? (r.status === 200 ? null : `risposta ${r.status}`) : String(j?.message || testo).slice(0, 200) });
  if (r.status === 204 || r.status === 404) return { trovato: false, j };
  if (!ok) {
    const perche = r.status === 401 || r.status === 403 ? `token non valido o senza il permesso per ${servizio === 'cap' ? 'l\'API Cap' : 'la scheda impresa (IT-advanced)'}: rigenera il token in console.openapi.com/it/oauth includendo quel permesso`
      : r.status === 402 ? `credito insufficiente sul conto Openapi${j?.message ? ` (${j.message})` : ''}` : (j?.message || testo.slice(0, 200) || `risposta ${r.status}`);
    throw Object.assign(new Error(`Openapi: ${perche}`), { status: 400, codice: r.status });
  }
  return { trovato: true, j };
}

/** Risposta di IT-advanced (o IT-start) → scheda con i nomi della Suite. Campi mancanti = null. */
export function normalizzaImpresa(d) {
  if (!d || typeof d !== 'object') return null;
  const s = d.address?.registeredOffice || {};
  const at = d.atecoClassification || {}; const ateco = at.ateco2022?.code ? at.ateco2022 : at.ateco2007?.code ? at.ateco2007 : at.ateco || {};
  const b = d.balanceSheets?.last || null;
  const via = s.streetName || [s.toponym, s.street, s.streetNumber].filter(Boolean).join(' ') || null;
  const gps = Array.isArray(s.gps?.coordinates) && s.gps.coordinates.length === 2 ? { lon: Number(s.gps.coordinates[0]), lat: Number(s.gps.coordinates[1]) } : null;
  const cessata = d.cessata === true || /CESSAT|CANCELLAT|INATTIV/i.test(String(d.activityStatus || '')) || Boolean(d.endDate);
  return {
    ragione_sociale: d.companyName ? String(d.companyName).trim() : null, partita_iva: d.vatCode ? pulisciCodice(d.vatCode) : null, codice_fiscale: d.taxCode ? pulisciCodice(d.taxCode) : null,
    indirizzo: via ? titolo(via) : null, cap: s.zipCode || null, citta: s.town ? titolo(s.town) : null, frazione: s.hamlet ? titolo(s.hamlet) : null, provincia: s.province || null, regione: s.region?.description ? titolo(s.region.description) : null,
    pec: d.pec ? String(d.pec).trim().toLowerCase() : null, sdi: d.sdiCode ? String(d.sdiCode).trim().toUpperCase() : null,
    stato_attivita: d.activityStatus || null, cessata, data_cessazione: d.endDate || null, data_inizio: d.startDate || null, data_iscrizione: d.registrationDate || null,
    ateco: ateco.code || null, ateco_descrizione: ateco.description || null, forma_giuridica: d.detailedLegalForm?.description ? titolo(d.detailedLegalForm.description) : null, rea: d.reaCode && d.cciaa ? `${d.cciaa}-${d.reaCode}` : d.reaCode || null,
    gruppo_iva: d.gruppo_iva?.vatGroupParticipation === true,
    bilancio: b ? { anno: b.year ?? null, fatturato: b.turnover ?? null, dipendenti: b.employees ?? null, patrimonio_netto: b.netWorth ?? null, capitale_sociale: b.shareCapital ?? null, costo_personale: b.totalStaffCost ?? null, attivo: b.totalAssets ?? null } : null,
    soci: Array.isArray(d.shareHolders) ? d.shareHolders.slice(0, 30).map((x) => ({ nome: x.companyName || [x.surname, x.name].filter(Boolean).join(' ') || null, codice_fiscale: x.taxCode || null, quota: x.percentShare ?? null })) : [],
    gps, id_openapi: d.id || null,
  };
}

/**
 * Scheda dell'impresa da partita IVA o codice fiscale. Usa la cache se recente; altrimenti chiama Openapi (a pagamento) nei limiti del tetto.
 * Ritorna { scheda | null, daCache, letto_at, trovata }. opts.soloCache: non spende mai.
 */
export async function schedaImpresa(codice, { forza = false, soloCache = false, modulo = 'core', fetchFn } = {}) {
  const k = pulisciCodice(codice);
  if (!codiceValido(k)) throw Object.assign(new Error('Partita IVA (11 cifre) o codice fiscale non validi'), { status: 400 });
  const S = await impostazioniOpenapi();
  const cache = await one('SELECT dati, letto_at FROM openapi_cache WHERE chiave=$1', [`impresa:${k}`]);
  const fresca = cache && (Date.now() - new Date(cache.letto_at).getTime()) < S.giorni_cache * 86400000;
  if (cache && (soloCache || (fresca && !forza))) return { scheda: cache.dati?.scheda || null, trovata: Boolean(cache.dati?.scheda), daCache: true, letto_at: cache.letto_at };
  if (soloCache) return { scheda: null, trovata: false, daCache: true, letto_at: null, assente: true };
  if (S.tetto_schede_mese > 0 && await usoMese('impresa') >= S.tetto_schede_mese) throw Object.assign(new Error(`Raggiunto il tetto di ${S.tetto_schede_mese} schede impresa per questo mese (Amministrazione > Connettori > Openapi)`), { status: 429, codice: 'TETTO' });
  const r = await chiama('company', `/IT-advanced/${encodeURIComponent(k)}`, { modulo, fetchFn });
  await conta('impresa');
  const grezza = r.trovato ? (Array.isArray(r.j?.data) ? r.j.data[0] : r.j?.data) : null;
  const scheda = normalizzaImpresa(grezza);
  await q(`INSERT INTO openapi_cache (chiave, dati, letto_at) VALUES ($1,$2,now()) ON CONFLICT (chiave) DO UPDATE SET dati=EXCLUDED.dati, letto_at=now()`, [`impresa:${k}`, JSON.stringify({ scheda })]);
  return { scheda, trovata: Boolean(scheda), daCache: false, letto_at: new Date().toISOString() };
}

/** Comuni, provincia e regione di un CAP (cache di un anno: i CAP cambiano di rado). */
export async function infoCap(cap, { fetchFn } = {}) {
  const c = String(cap || '').trim();
  if (!/^\d{5}$/.test(c)) throw Object.assign(new Error('CAP non valido: cinque cifre'), { status: 400 });
  const cache = await one('SELECT dati, letto_at FROM openapi_cache WHERE chiave=$1', [`cap:${c}`]);
  if (cache && (Date.now() - new Date(cache.letto_at).getTime()) < 365 * 86400000) return { ...cache.dati, daCache: true };
  const r = await chiama('cap', `/cap/${c}`, { fetchFn });
  await conta('cap');
  const d = r.trovato ? r.j?.data : null;
  const dati = d ? { cap: c, trovato: true, provincia: d.provincia || null, sigla_provincia: d.sigla_provincia || null, regione: d.regione || null,
    comuni: [...new Map((d.comuni || []).map((x) => [x.comune, { comune: x.comune, istat: x.comune_istat || x.istat || null, frazioni: [] }])).values()].map((x) => ({ ...x, frazioni: (d.comuni || []).filter((y) => y.comune === x.comune && y.frazione).map((y) => y.frazione) })) }
    : { cap: c, trovato: false, comuni: [] };
  await q(`INSERT INTO openapi_cache (chiave, dati, letto_at) VALUES ($1,$2,now()) ON CONFLICT (chiave) DO UPDATE SET dati=EXCLUDED.dati, letto_at=now()`, [`cap:${c}`, JSON.stringify(dati)]);
  return { ...dati, daCache: false };
}

// ---------------------------------------------------------------- confronto con la Legal entity
// campo dell'anagrafica ← campo della scheda
export const CAMPI_ORG = [
  ['name', 'ragione_sociale', 'Ragione sociale'], ['vat_number', 'partita_iva', 'Partita IVA'], ['tax_code', 'codice_fiscale', 'Codice fiscale'], ['address', 'indirizzo', 'Indirizzo'],
  ['zip', 'cap', 'CAP'], ['city', 'citta', 'Città'], ['province', 'provincia', 'Provincia'], ['pec', 'pec', 'PEC'], ['sdi', 'sdi', 'Codice SDI'],
];
const piatto = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|societa a responsabilita limitata|societa per azioni)\b/g, '').replace(/[^a-z0-9]/g, '');
/** Per ogni campo: VUOTO (in anagrafica manca, il registro lo ha), DIVERSO (entrambi presenti e differenti), UGUALE. */
export function confrontaOrg(org, scheda) {
  if (!scheda) return { proposte: [], vuoti: [], diversi: [] };
  const proposte = [];
  for (const [campo, sorgente, etichetta] of CAMPI_ORG) {
    const reg = scheda[sorgente]; if (reg == null || reg === '') continue;
    const att = org[campo];
    const tipo = att == null || String(att).trim() === '' ? 'VUOTO' : piatto(att) === piatto(reg) ? 'UGUALE' : 'DIVERSO';
    if (tipo !== 'UGUALE') proposte.push({ campo, etichetta, attuale: att ?? null, registro: reg, tipo });
  }
  return { proposte, vuoti: proposte.filter((p) => p.tipo === 'VUOTO'), diversi: proposte.filter((p) => p.tipo === 'DIVERSO') };
}
const riassunto = (s) => (s ? { stato_attivita: s.stato_attivita, cessata: s.cessata, data_cessazione: s.data_cessazione, ateco: s.ateco, ateco_descrizione: s.ateco_descrizione, forma_giuridica: s.forma_giuridica, rea: s.rea,
  data_inizio: s.data_inizio, gruppo_iva: s.gruppo_iva, bilancio: s.bilancio, soci: s.soci, regione: s.regione, gps: s.gps } : null);

/**
 * Verifica una Legal entity sul registro: riempie i SOLI campi vuoti, registra stato, differenze e avviso. Ritorna l'esito.
 * opts: { forza (ignora la cache), req (per l'audit), origine, fetchFn }
 */
export async function verificaOrganizzazione(orgId, { forza = false, req = null, origine = 'controllo automatico', fetchFn } = {}) {
  const org = await one('SELECT * FROM organizations WHERE id=$1', [orgId]);
  if (!org) throw Object.assign(new Error('Legal entity non trovata'), { status: 404 });
  const codice = codiceValido(org.vat_number) ? org.vat_number : codiceValido(org.tax_code) ? org.tax_code : null;
  if (!codice) return { id: org.id, saltata: 'senza partita IVA o codice fiscale validi' };
  const r = await schedaImpresa(codice, { forza, fetchFn });
  if (!r.trovata) {
    await q(`UPDATE organizations SET registry_checked_at=now(), registry_status='NON_TROVATA', registry_alert='Non trovata nel registro imprese con la partita IVA o il codice fiscale in anagrafica', registry_diff=NULL WHERE id=$1`, [org.id]);
    return { id: org.id, trovata: false };
  }
  const c = confrontaOrg(org, r.scheda);
  const sets = []; const par = [org.id]; const riempiti = [];
  for (const p of c.vuoti) { par.push(p.registro); sets.push(`${p.campo}=$${par.length}`); riempiti.push(p.campo); }
  const avvisi = [];
  if (r.scheda.cessata) avvisi.push(`Risulta cessata nel registro imprese${r.scheda.data_cessazione ? ` dal ${String(r.scheda.data_cessazione).split('-').reverse().join('/')}` : ''}`);
  // la ragione sociale diversa non fa avviso (in anagrafica c'è spesso il nome d'uso): resta tra le differenze da guardare nella scheda
  const daAvviso = c.diversi.filter((d) => d.campo !== 'name');
  if (daAvviso.length) avvisi.push(`Dati diversi dal registro: ${daAvviso.map((d) => d.etichetta.toLowerCase()).join(', ')}`);
  par.push(r.scheda.stato_attivita || (r.scheda.cessata ? 'CESSATA' : 'ATTIVA'), avvisi.join('. ') || null, JSON.stringify(riassunto(r.scheda)), c.diversi.length ? JSON.stringify(c.diversi) : null);
  const n = par.length;
  await q(`UPDATE organizations SET ${sets.length ? `${sets.join(', ')}, updated_at=now(), ` : ''}registry_checked_at=now(), registry_status=$${n - 3}, registry_alert=$${n - 2}, registry_data=$${n - 1}, registry_diff=$${n} WHERE id=$1`, par);
  if (riempiti.length) {
    await audit(req || { user: null, ip: null }, 'ORG_REGISTRO_COMPILA', { entity: 'organization', entityId: org.id, label: org.name, data: { origine, campi: riempiti } }).catch(() => {});
    // stessi effetti di una modifica a mano: indice di ricerca e sedi SERVICE che ereditano l'indirizzo
    const dopo = await one('SELECT * FROM organizations WHERE id=$1', [org.id]);
    import('./search.js').then((m) => m.indexOrg(dopo)).catch(() => {});
    if (riempiti.some((k) => ['address', 'zip', 'city', 'province'].includes(k))) await import('./clienti.js').then((m) => m.allineaSediDaOrg(org.id, { req, origine: 'Registro imprese (Openapi)' })).catch((e) => console.warn('[openapi sedi]', org.id, e.message));
  }
  return { id: org.id, trovata: true, riempiti, diversi: c.diversi, cessata: r.scheda.cessata, daCache: r.daCache, avviso: avvisi.join('. ') || null };
}

/** Giro notturno: le Legal entity attive con partita IVA mai verificate o verificate da più di giorni_verifica, nei limiti di tetto e lotto. */
export async function verificaPeriodica({ limite = null, fetchFn } = {}) {
  const S = await impostazioniOpenapi();
  if (!S.attivo) return { saltato: 'connettore Openapi non attivo' };
  if (!S.verifica_automatica) return { saltato: 'verifica automatica spenta' };
  const lotto = limite ?? S.verifiche_per_notte;
  const righe = await many(`SELECT id FROM organizations WHERE active AND (coalesce(vat_number,'') <> '' OR coalesce(tax_code,'') <> '')
      AND (registry_checked_at IS NULL OR registry_checked_at < now() - ($1 || ' days')::interval) ORDER BY registry_checked_at NULLS FIRST, id LIMIT $2`, [String(S.giorni_verifica), lotto]);
  const out = { esaminate: 0, compilate: 0, con_avviso: 0, non_trovate: 0, saltate: 0, errore: null };
  for (const x of righe) {
    try {
      const r = await verificaOrganizzazione(x.id, { fetchFn });
      out.esaminate++;
      if (r.saltata) { out.saltate++; await q('UPDATE organizations SET registry_checked_at=now() WHERE id=$1', [x.id]); }
      else if (!r.trovata) out.non_trovate++;
      else { if (r.riempiti.length) out.compilate++; if (r.avviso) out.con_avviso++; }
    } catch (e) { out.errore = e.message; if (e.codice === 'TETTO' || e.codice === 401 || e.codice === 402 || e.codice === 403) break; }
  }
  return out;
}

/** Una volta al giorno, di notte: il lavoro gira ogni ora e parte solo tra le 2 e le 5 se oggi non è già passato. */
let ultimoGiro = null;
export function registerOpenapiJobs(registerJob) {
  registerJob('openapi:verifica-imprese', 60, async () => {
    const ora = new Date(); const giorno = ora.toISOString().slice(0, 10);
    const h = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(ora));
    if (h < 2 || h > 5 || ultimoGiro === giorno) return { saltato: 'fuori orario o già eseguito oggi' };
    ultimoGiro = giorno;
    return verificaPeriodica();
  }, { runAtStart: false });
}
