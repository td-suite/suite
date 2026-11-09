// TuoTempo (Docplanner), Fase 1 del piano di integrazione (richiesta del CEO del 09/11/2026: "Le sedi sono sedi, su Retail, ovunque. E
// devono quadrare con TuoTempo"). Allineamento delle Key Entities (documento "Tuotempo Api integration (Key Entities)", API v3):
//   - aree (centri) ↔ sedi dell'anagrafica unica: proposta automatica (abbinamento già salvato, legacyid = codice sede, indirizzo + CAP,
//     nome simile con pg_trgm), conferma, scelta manuale, "Crea la sede" (saveSite del core), "non nostra / ignora" per area;
//     la fonte dell'abbinamento è public.sites.legacy_refs->>'tuotempo' (scritta solo da saveSite), retail.site_ext.tuotempo_area_id è lo
//     specchio; confronto dei dati (indirizzo, CAP, città, telefono, orari) con "Copia da TuoTempo" (saveSite);
//   - attività → catalogo prestazioni (durata, prezzo online, regole di prezzo, preparazione, visibilità, prima disponibilità, legacyid)
//     e storico giornaliero della prima disponibilità per sede e tipologia (retail.tuotempo_attivita);
//   - risorse → retail.tuotempo_risorse con la proposta di abbinamento alle persone (email, poi nome) e la conferma
//     (public.people.legacy_refs->>'tuotempo');
//   - assicurazioni → retail.tuotempo_assicurazioni.
// Vincoli di Docplanner rispettati: chiamate solo dal server, Bearer api_key dell'istanza, parametro fields sempre valorizzato, User-Agent
// "TD-Suite/<versione>", al massimo 600 chiamate al minuto per IP (una chiamata ogni 110 ms al massimo e una pausa tra le pagine).
// Perimetro: solo Key Entities (niente prenotazioni né pazienti). La Suite legge e confronta, non scrive su TuoTempo.
// Docs: docs/RETAIL_TUOTEMPO.md.
import { one, many, q } from '../db.js';
import { HttpError } from './util.js';
import { APP_VERSION } from '../../../version.js';
import { getConnector as getCoreConnector, logConnector } from '../../../lib/connectors.js';
import { audit as auditCore } from '../../../lib/util.js';

// ------------------------------------------------------------------ costanti
// fields obbligatorio su ogni chiamata (Docplanner può bloccare in produzione le chiamate senza): solo i campi che la Suite usa
export const TT_FIELDS = {
  typologies: 'typologyid,typologyTitle,legacyid',
  activities: 'activityid,activityTitle,duration,price,price_rules,preparation,typologyid,typologyTitle,legacyid,isHidden,first_availability,first_availability_areaTitle',
  areas: 'areaid,areaTitle,webTitle,isHidden,isDefault,legacyid,address,cp,city,province,region,latitude,longitude,mobile,landline,opening_hrs,tags',
  resources: 'resourceid,machid,resourceName,name,email,rphone,status,isHidden,is_machine,satisfaction,areas,legacyid,idnumber',
  insurances: 'insuranceid,insurance_title,legacyid,legacyTitle,isDefault,IsHidden,tags',
  // elenchi di soli identificativi per area (prestazioni prenotabili e risorse che lavorano nell'area)
  activities_id: 'activityid,isHidden',
  resources_id: 'resourceid,machid',
};
export const ttUserAgent = () => `TD-Suite/${APP_VERSION}`;
export const TIPI_PRENOTABILI = ['PUNTO_PRELIEVI', 'CENTRO_MEDICO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO'];
export const TIPI_DA_AREA = TIPI_PRENOTABILI;   // tipi tra cui l'utente sceglie in "Crea la sede"
const LIMITE_PAGINA = 500;
const PAUSA_MIN_MS = () => Math.max(0, Number(process.env.TUOTEMPO_PAUSA_MS ?? 110));         // ~545 chiamate al minuto al massimo
const PAUSA_PAGINE_MS = () => Math.max(0, Number(process.env.TUOTEMPO_PAUSA_PAGINE_MS ?? 300));
const SOGLIA_NOME = 0.45;   // somiglianza minima (pg_trgm) per proporre una sede per nome

// ------------------------------------------------------------------ funzioni pure (test: server/test/retail-tuotempo.test.mjs)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = (v) => (v == null ? '' : String(v).trim());
const nn = (v) => (s(v) === '' ? null : s(v));
const uno = (v) => v === 1 || v === '1' || v === true || v === 'true';
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** Normalizzazione dei testi (stessa regola della funzione SQL retail.tt_norm). */
export function normTesto(t) {
  if (t == null) return null;
  let x = String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ');
  x = x.replace(/\b(v\.le|vle)\b/g, 'viale').replace(/\b(p\.zza|p\.za|pza|pzza)\b/g, 'piazza').replace(/\b(v\.|v)\s/g, 'via ').replace(/\b(c\.so|cso)\b/g, 'corso').replace(/\bs\.\s*/g, 'san ');
  x = x.replace(/[^a-z0-9]/g, '');
  return x || null;
}
export const normCap = (v) => (s(v).replace(/\D/g, '') || null);
export const normTel = (v) => { const d = s(v).replace(/\D/g, ''); return (/^(0039|39)\d{9,11}$/.test(d) ? d.replace(/^(0039|39)/, '') : d) || null; };

/** Timestamp TuoTempo (Unix in secondi come stringa, oppure data e ora) → Date o null. */
export function parseTs(v) {
  if (v == null || v === '' || v === '0') return null;
  if (/^\d{9,11}$/.test(String(v))) return new Date(Number(v) * 1000);
  if (/^\d{12,14}$/.test(String(v))) return new Date(Number(v));
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Giorni di attesa dal momento dell'allineamento al primo slot libero (2 decimali, mai negativi). */
export function giorniAttesa(firstAvailability, ora = new Date()) {
  const d = parseTs(firstAvailability);
  if (!d) return null;
  return Math.max(0, Math.round(((d.getTime() - ora.getTime()) / 86_400_000) * 100) / 100);
}
export function mediana(valori) {
  const v = valori.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100;
}
/** Telefono dell'area: fisso, altrimenti cellulare. */
export const telefonoArea = (a) => nn(a.landline) || nn(a.mobile);

/**
 * Proposta della sede per un'area, nell'ordine deciso dal CEO: 1) abbinamento già salvato (fonte public.sites.legacy_refs, poi lo specchio
 * retail.site_ext); 2) legacyid = codice sede; 3) indirizzo + CAP normalizzati; 4) nome simile (pg_trgm, somiglianza >= 0,45).
 * area: { areaid, legacyid, indirizzo, cap, citta }; sedi: [{ id, code, address, zip, city, area_fonte, area_specchio }]; simili: [{ site_id, sim }]
 * (già calcolati per l'area, sui nomi senza le parole comuni: retail.tt_nome); occupate: Set degli id di sede già abbinati ad altre aree
 * (esclusi dalle proposte 2-4). Il nome conta solo tra sedi della stessa città, quando area e sede la indicano.
 * Ritorna { site_id, metodo: SALVATO|LEGACYID|INDIRIZZO|NOME, punteggio? } oppure null.
 */
export function proponiSede(area, sedi, { simili = [], occupate = new Set() } = {}) {
  const salvata = sedi.find((x) => s(x.area_fonte) === s(area.areaid)) || sedi.find((x) => !x.area_fonte && s(x.area_specchio) === s(area.areaid));
  if (salvata) return { site_id: salvata.id, metodo: 'SALVATO' };
  const libere = sedi.filter((x) => !occupate.has(Number(x.id)));
  const leg = s(area.legacyid).toUpperCase();
  if (leg) { const x = libere.find((y) => s(y.code).toUpperCase() === leg); if (x) return { site_id: x.id, metodo: 'LEGACYID' }; }
  const ind = normTesto(area.indirizzo); const cap = normCap(area.cap);
  if (ind && cap) { const x = libere.find((y) => normTesto(y.address) === ind && normCap(y.zip) === cap); if (x) return { site_id: x.id, metodo: 'INDIRIZZO' }; }
  // nome simile solo tra sedi della stessa città (quando entrambe la indicano): un nome generico non basta
  const citta = normTesto(area.citta);
  const stessaCitta = (id) => { const x = sedi.find((y) => Number(y.id) === Number(id)); return !citta || !x || !normTesto(x.city) || normTesto(x.city) === citta; };
  const best = simili.filter((x) => !occupate.has(Number(x.site_id)) && Number(x.sim) >= SOGLIA_NOME && stessaCitta(x.site_id)).sort((a, b) => Number(b.sim) - Number(a.sim))[0];
  if (best) return { site_id: best.site_id, metodo: 'NOME', punteggio: Math.round(Number(best.sim) * 100) / 100 };
  return null;
}
export const METODI = { SALVATO: 'abbinamento salvato', LEGACYID: 'codice sede (legacyid)', INDIRIZZO: 'indirizzo e CAP', NOME: 'nome simile' };

// Nome di una risorsa ridotto a parole ordinate senza titoli (Dott., Dr.ssa, Prof., ...): "Dott.ssa Maria Rossi" → "maria rossi"
const TITOLI = new Set(['dr', 'dott', 'dottssa', 'dottoressa', 'dottor', 'dottore', 'drssa', 'prof', 'profssa', 'professor', 'professore', 'professoressa', 'dssa', 'sig', 'sigra', 'ing', 'tsrm', 'inf', 'infermiere', 'infermiera']);
export function paroleNome(n) {
  return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’,]/g, '').split(/\s+/).filter((w) => w && !TITOLI.has(w)).sort().join(' ') || null;
}
/**
 * Proposta della persona per una risorsa (non macchina): prima per email (uguale, senza maiuscole), poi per nome (stesse parole, senza
 * titoli) se una sola persona corrisponde. persone: [{ id, email, first_name, last_name }]. Ritorna { person_id, come: EMAIL|NOME } o null.
 */
export function proponiPersona(risorsa, persone) {
  if (uno(risorsa.is_machine)) return null;
  const em = s(risorsa.email).toLowerCase();
  if (em) { const p = persone.filter((x) => s(x.email).toLowerCase() === em); if (p.length === 1) return { person_id: p[0].id, come: 'EMAIL' }; }
  const nome = paroleNome(risorsa.name || risorsa.resourceName);
  if (nome) { const p = persone.filter((x) => paroleNome(`${x.first_name || ''} ${x.last_name || ''}`) === nome); if (p.length === 1) return { person_id: p[0].id, come: 'NOME' }; }
  return null;
}

// ------------------------------------------------------------------ chiamate a TuoTempo
let ultimaChiamata = 0;
async function turno() {
  const attesa = ultimaChiamata + PAUSA_MIN_MS() - Date.now();
  if (attesa > 0) await sleep(attesa);
  ultimaChiamata = Date.now();
}
const ttResults = (j) => (Array.isArray(j?.return?.results) ? j.return.results : Array.isArray(j?.results) ? j.results : Array.isArray(j?.return?.results?.results) ? j.return.results.results : []);

/** Configurazione dal connettore unico (Amministrazione > Connettori). */
async function configurazione() {
  const core = await getCoreConnector('TUOTEMPO');
  if (!core.active) throw new HttpError(400, 'Connettore TuoTempo non configurato o disabilitato: Amministrazione > Connettori');
  const settings = core.settings || {};
  if (!settings.instance) throw new HttpError(400, 'Impostare l\'identificativo dell\'istanza TuoTempo (dbName) nel connettore (Amministrazione > Connettori)');
  const creds = core.credentials || {};
  const token = creds.api_key || creds.token || creds.password;
  if (!token) throw new HttpError(400, 'Impostare l\'api_key TuoTempo nel connettore (Amministrazione > Connettori)');
  return { base: (core.base_url || 'https://app.tuotempo.com/api/v3').replace(/\/+$/, ''), instance: settings.instance, lang: settings.lang || 'it', token };
}

/** Una chiamata GET. fields è sempre valorizzato (dalla tabella TT_FIELDS o dal chiamante): senza, la chiamata non parte. */
export async function ttGet(cfg, risorsa, params = {}, { campi = null } = {}) {
  const fields = params.fields || TT_FIELDS[campi || risorsa];
  if (!fields) throw new Error(`fields mancante per ${risorsa}`);
  const url = new URL(`${cfg.base}/${encodeURIComponent(cfg.instance)}/${risorsa}`);
  for (const [k, v] of Object.entries({ ...params, fields, lang: cfg.lang })) if (v != null && v !== '') url.searchParams.set(k, v);
  await turno();
  const t0 = Date.now();
  const log = (status, message) => logConnector({ kind: 'TUOTEMPO', direction: 'OUT', module: 'retail', endpoint: `GET /${risorsa}${params.areaid ? '?areaid' : ''}${params.page > 1 ? ` p.${params.page}` : ''}`, status, ms: Date.now() - t0, message }).catch(() => {});
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json; charset=utf-8', 'user-agent': ttUserAgent(), authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(20000) });
  } catch (e) { log('ERRORE', e.cause?.message || e.message); throw new HttpError(502, `TuoTempo non raggiungibile: ${e.cause?.message || e.message}`); }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non JSON */ }
  if (!res.ok || (json && json.result && json.result !== 'OK')) {
    const msg = json?.msg || text.slice(0, 200);
    const hint = res.status === 429 || /too many|rate/i.test(msg) ? ' · Limite di 600 chiamate al minuto superato: riprova tra qualche minuto.'
      : /not logged in|permission/i.test(msg) ? ' · Verifica: api_key corretta per questa istanza, IP statici in uscita di Render autorizzati da Docplanner, risorsa inclusa nel perimetro (Key Entities).' : '';
    log(String(res.status), msg);
    throw new HttpError(502, `TuoTempo ${res.status}${json?.exception ? ` ${json.exception}` : ''}: ${msg}${hint}`);
  }
  if (!json) { log('ERRORE', 'risposta non JSON'); throw new HttpError(502, 'Risposta TuoTempo non in formato JSON'); }
  log('OK', null);
  return json;
}
/** Elenco completo: paginato per attività, risorse e assicurazioni (istanze standalone), con una pausa tra le pagine. */
async function ttElenco(cfg, risorsa, params = {}, { campi = null, paginata = true } = {}) {
  if (!paginata) return ttResults(await ttGet(cfg, risorsa, params, { campi }));
  const out = [];
  for (let page = 1; page <= 40; page++) {
    if (page > 1) await sleep(PAUSA_PAGINE_MS());
    const rows = ttResults(await ttGet(cfg, risorsa, { ...params, page, limit: LIMITE_PAGINA }, { campi }));
    out.push(...rows);
    if (rows.length < LIMITE_PAGINA) break;
  }
  return out;
}

// ------------------------------------------------------------------ sedi dell'anagrafica e abbinamenti
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const sites = () => import('../../../lib/sites.js');
const errore = (status, msg) => new HttpError(status, msg);

/** Sedi candidate all'abbinamento: le sedi TD (non SERVICE) attive o in apertura, con la fonte e lo specchio dell'area. */
async function sediCandidate() {
  return many(`SELECT s.id, s.code, s.name, s.short_name, s.kind, s.active, s.opened_at, s.address, s.zip, s.city, s.province, s.phone, s.opening_hours,
      s.legacy_refs->>'tuotempo' AS area_fonte, e.tuotempo_area_id AS area_specchio
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id
    WHERE s.kind <> 'SERVICE' AND (s.active OR s.opened_at > CURRENT_DATE OR s.legacy_refs ? 'tuotempo') ORDER BY lower(s.name)`);
}

/** Specchio retail.site_ext.tuotempo_area_id allineato alla fonte (public.sites.legacy_refs->>'tuotempo'). */
async function allineaSpecchio() {
  await q(`INSERT INTO site_ext (site_id, tuotempo_area_id) SELECT s.id, s.legacy_refs->>'tuotempo' FROM public.sites s
      WHERE s.legacy_refs ? 'tuotempo' AND NOT EXISTS (SELECT 1 FROM site_ext e WHERE e.site_id = s.id) ON CONFLICT (site_id) DO NOTHING`);
  const r = await q(`UPDATE site_ext e SET tuotempo_area_id = s.legacy_refs->>'tuotempo', updated_at = now() FROM public.sites s
      WHERE s.id = e.site_id AND e.tuotempo_area_id IS DISTINCT FROM s.legacy_refs->>'tuotempo'`);
  return r.rowCount;
}

/**
 * Prima di ogni allineamento: gli abbinamenti salvati finora solo nello specchio (sync per nome delle versioni precedenti) passano nella
 * fonte con saveSite (audit SITE_UPDATED, origine "Retail > TuoTempo"), se nessun'altra sede ha già quell'area; poi lo specchio segue la fonte.
 */
export async function portaSpecchioNellaFonte({ actorId = null } = {}) {
  const rows = await many(`SELECT e.site_id, e.tuotempo_area_id AS areaid FROM site_ext e JOIN public.sites s ON s.id = e.site_id
     WHERE e.tuotempo_area_id IS NOT NULL AND NOT (s.legacy_refs ? 'tuotempo')
       AND NOT EXISTS (SELECT 1 FROM public.sites x WHERE x.legacy_refs->>'tuotempo' = e.tuotempo_area_id)`);
  const { saveSite } = await sites();
  const visti = new Set(); let portati = 0;
  for (const r of rows) {
    if (visti.has(r.areaid)) continue;   // due sedi con la stessa area nello specchio: la prima resta, la seconda si ripulisce sotto
    visti.add(r.areaid);
    await saveSite({ id: r.site_id, data: {}, extra: { legacy_refs: { tuotempo: r.areaid } }, origine: 'Retail > TuoTempo (abbinamento salvato prima della 0.66.0)', actorId });
    portati++;
  }
  const specchio = await allineaSpecchio();
  return { portati, specchio_allineato: specchio };
}

async function area(areaid) {
  const a = await one('SELECT * FROM tuotempo_aree WHERE areaid=$1', [areaid]);
  if (!a) throw errore(404, 'Area TuoTempo non trovata: esegui "Allinea adesso"');
  return a;
}

/** Abbina l'area alla sede (conferma della proposta o scelta dal selettore). Un'area, una sede: l'eventuale abbinamento precedente si toglie. */
export async function abbinaArea(areaid, siteId, { req = null, actorId = null } = {}) {
  const a = await area(areaid);
  const sede = await one('SELECT id, code, name, kind, legacy_refs->>\'tuotempo\' AS area_fonte FROM public.sites WHERE id=$1', [siteId]);
  if (!sede) throw errore(404, 'Sede non trovata');
  if (sede.kind === 'SERVICE') throw errore(400, 'Le strutture dei clienti service non sono aree TuoTempo: scegli una sede di Toscana Diagnostica');
  if (sede.area_fonte && sede.area_fonte !== a.areaid) {
    const altra = await one('SELECT titolo FROM tuotempo_aree WHERE areaid=$1', [sede.area_fonte]);
    throw errore(409, `La sede ${sede.code} è già abbinata all'area "${altra?.titolo || sede.area_fonte}": scollegala prima da quell'area`);
  }
  const { saveSite } = await sites();
  const origine = 'Retail > TuoTempo (abbinamento area ↔ sede)';
  const prima = await many(`SELECT id FROM public.sites WHERE legacy_refs->>'tuotempo' = $1 AND id <> $2`, [a.areaid, sede.id]);
  for (const p of prima) await saveSite({ id: p.id, data: {}, extra: { legacy_refs: { tuotempo: null } }, origine, req, actorId });
  await saveSite({ id: sede.id, data: {}, extra: { legacy_refs: { tuotempo: a.areaid } }, origine, req, actorId });
  await q('UPDATE tuotempo_aree SET ignorata=FALSE, ignorata_nota=NULL, ignorata_da=NULL, ignorata_at=NULL WHERE areaid=$1', [a.areaid]);
  await allineaSpecchio();
  await q(`UPDATE tuotempo_attivita SET site_id=$2 WHERE areaid=$1 AND data=(SELECT max(data) FROM tuotempo_attivita)`, [a.areaid, sede.id]);
  return { areaid: a.areaid, site_id: sede.id, sede: `${sede.code} ${sede.name}`, scollegate: prima.map((x) => x.id) };
}

/** Toglie l'abbinamento dell'area (la sede resta com'è; si toglie solo il riferimento). */
export async function scollegaArea(areaid, { req = null, actorId = null } = {}) {
  const { saveSite } = await sites();
  const rows = await many(`SELECT id FROM public.sites WHERE legacy_refs->>'tuotempo' = $1`, [areaid]);
  for (const r of rows) await saveSite({ id: r.id, data: {}, extra: { legacy_refs: { tuotempo: null } }, origine: 'Retail > TuoTempo (abbinamento tolto)', req, actorId });
  await allineaSpecchio();
  return { areaid, scollegate: rows.length };
}

/** "Non nostra / ignora": impostazione per area (resta fino a quando non la si toglie o non si abbina l'area). */
export async function ignoraArea(areaid, { ignorata = true, nota = null, userId = null } = {}) {
  await area(areaid);
  if (ignorata && (await one(`SELECT 1 FROM public.sites WHERE legacy_refs->>'tuotempo' = $1`, [areaid]))) throw errore(409, 'L\'area è abbinata a una sede: scollegala prima di segnarla "non nostra"');
  await q('UPDATE tuotempo_aree SET ignorata=$2, ignorata_nota=$3, ignorata_da=$4, ignorata_at=CASE WHEN $2 THEN now() END WHERE areaid=$1', [areaid, ignorata, ignorata ? nota || null : null, ignorata ? userId : null]);
  return { areaid, ignorata };
}

/**
 * "Crea la sede" dall'area: saveSite del core con nome, indirizzo, CAP, città, provincia, coordinate, telefono, orari (se il testo di
 * TuoTempo è interpretabile), tipo scelto dall'utente, Legal entity di TD (la propone saveSite dai Dati aziendali) e
 * legacy_refs.tuotempo = areaid. Il codice lo indica l'utente (proposto: legacyid dell'area).
 */
export async function creaSedeDaArea(areaid, { code, kind, name = null, req = null, actorId = null } = {}) {
  const a = await area(areaid);
  if (!TIPI_DA_AREA.includes(kind)) throw errore(400, `Tipo di sede non valido: scegli tra ${TIPI_DA_AREA.join(', ')}`);
  if (!code || String(code).trim().length < 2) throw errore(400, 'Indica il codice della nuova sede');
  if (await one(`SELECT 1 FROM public.sites WHERE legacy_refs->>'tuotempo' = $1`, [areaid])) throw errore(409, 'L\'area è già abbinata a una sede');
  if (await one('SELECT 1 FROM public.sites WHERE upper(code) = upper($1)', [String(code).trim()])) throw errore(409, `Esiste già una sede con il codice ${String(code).trim()}`);
  const { saveSite, orariDaTesto } = await sites();
  const avvisi = [];
  const orari = orariDaTesto(a.opening_hrs);
  if (a.opening_hrs && !orari) avvisi.push(`Orari di TuoTempo non interpretabili ("${a.opening_hrs}"): inseriscili nella scheda della sede`);
  const prov = nn(a.provincia);
  if (prov && prov.length > 4) avvisi.push(`Provincia "${prov}" non in sigla: indicala nella scheda della sede`);
  const data = {
    code: String(code).trim().toUpperCase(), name: nn(name) || nn(a.titolo) || nn(a.web_title) || a.areaid, kind,
    address: nn(a.indirizzo), zip: nn(a.cap), city: nn(a.citta), province: prov && prov.length <= 4 ? prov.toUpperCase() : null,
    lat: a.lat ?? null, lng: a.lng ?? null, phone: telefonoArea({ landline: a.landline, mobile: a.mobile }), active: true,
    ...(orari ? { opening_hours_json: orari } : {}),
  };
  for (const k of Object.keys(data)) if (data[k] === null) delete data[k];
  const site = await saveSite({ data, extra: { legacy_refs: { tuotempo: a.areaid } }, origine: 'Retail > TuoTempo (Crea la sede dall\'area)', req, actorId });
  await q('UPDATE tuotempo_aree SET ignorata=FALSE, ignorata_nota=NULL WHERE areaid=$1', [a.areaid]);
  await allineaSpecchio();
  await q(`UPDATE tuotempo_attivita SET site_id=$2 WHERE areaid=$1 AND data=(SELECT max(data) FROM tuotempo_attivita)`, [a.areaid, site.id]);
  return { site_id: site.id, code: site.code, name: site.name, avvisi: [...avvisi, ...(site.avvisi || [])] };
}

export const CAMPI_COPIA = { indirizzo: 'indirizzo, CAP e città', telefono: 'telefono', orari: 'orari' };
/** "Copia da TuoTempo": indirizzo (con CAP, città, provincia), telefono e/o orari dell'area nella sede abbinata, con saveSite. */
export async function copiaDaTuotempo(siteId, campi = [], { req = null, actorId = null, origine = 'Retail > TuoTempo (Copia da TuoTempo)' } = {}) {
  const scelti = [...new Set(campi)].filter((c) => CAMPI_COPIA[c]);
  if (!scelti.length) throw errore(400, 'Scegli cosa copiare: indirizzo, telefono o orari');
  const x = await one(`SELECT s.id, s.legacy_refs->>'tuotempo' AS areaid FROM public.sites s WHERE s.id=$1`, [siteId]);
  if (!x) throw errore(404, 'Sede non trovata');
  if (!x.areaid) throw errore(400, 'La sede non è abbinata a un\'area TuoTempo');
  const a = await area(x.areaid);
  const { saveSite, orariDaTesto } = await sites();
  const data = {}; const non = [];
  if (scelti.includes('indirizzo')) {
    if (!nn(a.indirizzo) && !nn(a.citta)) non.push('indirizzo (vuoto su TuoTempo)');
    else { data.address = nn(a.indirizzo); data.zip = nn(a.cap); data.city = nn(a.citta); const p = nn(a.provincia); if (p && p.length <= 4) data.province = p.toUpperCase(); }
  }
  if (scelti.includes('telefono')) { const t = telefonoArea({ landline: a.landline, mobile: a.mobile }); if (t) data.phone = t; else non.push('telefono (vuoto su TuoTempo)'); }
  if (scelti.includes('orari')) { const o = orariDaTesto(a.opening_hrs); if (o) data.opening_hours_json = o; else non.push(`orari (testo di TuoTempo non interpretabile${a.opening_hrs ? `: "${a.opening_hrs}"` : ''})`); }
  if (!Object.keys(data).length) throw errore(400, `Niente da copiare: ${non.join('; ')}`);
  const site = await saveSite({ id: siteId, data, origine, req, actorId });
  return { site_id: siteId, copiati: Object.keys(data), non_copiati: non, modificato: site.modificato };
}

// ------------------------------------------------------------------ elenco delle aree con proposte e confronto
/** Tabella "Aree TuoTempo" (Retail > Connettori e Amministrazione > Sedi). */
export async function elencoAree() {
  const aree = await many('SELECT areaid, titolo, web_title, indirizzo, cap, citta, provincia, landline, mobile, opening_hrs, orari_norm, legacyid, is_hidden, is_default, presente, ignorata, ignorata_nota, ignorata_at, jsonb_array_length(attivita) AS n_attivita, synced_at FROM tuotempo_aree ORDER BY presente DESC, is_hidden, lower(coalesce(titolo, areaid))');
  const sedi = await sediCandidate();
  const simili = aree.length && sedi.length ? await many(`SELECT a.areaid, s.id AS site_id, greatest(similarity(tt_nome(a.titolo), tt_nome(s.name)), similarity(tt_nome(a.titolo), tt_nome(s.short_name)),
        similarity(tt_nome(a.web_title), tt_nome(s.name))) AS sim
      FROM tuotempo_aree a CROSS JOIN public.sites s WHERE s.kind <> 'SERVICE' AND (s.active OR s.opened_at > CURRENT_DATE) AND a.presente`).catch(() => []) : [];
  const confronto = await many('SELECT * FROM tuotempo_confronto_v');
  const occupate = new Set(sedi.filter((x) => x.area_fonte).map((x) => Number(x.id)));
  const byId = Object.fromEntries(sedi.map((x) => [x.id, x]));
  const righe = aree.map((a) => {
    const p = proponiSede(a, sedi, { simili: simili.filter((x) => x.areaid === a.areaid), occupate });
    const sede = p ? byId[p.site_id] : null;
    const abbinata = Boolean(sede && sede.area_fonte === a.areaid);
    const cf = abbinata ? confronto.find((c) => c.areaid === a.areaid) : null;
    const differenze = cf ? ['indirizzo', 'cap', 'citta', 'telefono', 'orari'].filter((k) => cf[`diff_${k}`]).map((k) => ({ campo: k, tuotempo: cf[`tt_${k}`], anagrafica: cf[k] })) : [];
    const stato = abbinata ? 'ABBINATA' : a.ignorata ? 'IGNORATA' : p ? 'PROPOSTA' : 'DA_ABBINARE';
    return {
      ...a, telefono: telefonoArea(a), stato,
      sede: sede ? { id: sede.id, code: sede.code, name: sede.name, kind: sede.kind, active: sede.active, address: sede.address, zip: sede.zip, city: sede.city, phone: sede.phone, opening_hours: sede.opening_hours } : null,
      metodo: p?.metodo || null, metodo_label: p ? METODI[p.metodo] : null, punteggio: p?.punteggio ?? null,
      differenze, orari_non_interpretabili: Boolean(a.opening_hrs && !a.orari_norm),
    };
  });
  const presenti = righe.filter((r) => r.presente);
  const riepilogo = {
    aree: presenti.length, abbinate: presenti.filter((r) => r.stato === 'ABBINATA').length,
    da_abbinare: presenti.filter((r) => ['PROPOSTA', 'DA_ABBINARE'].includes(r.stato)).length,
    con_proposta: presenti.filter((r) => r.stato === 'PROPOSTA').length, ignorate: presenti.filter((r) => r.stato === 'IGNORATA').length,
    nascoste: presenti.filter((r) => r.is_hidden).length, con_differenze: presenti.filter((r) => r.differenze.length).length,
    non_piu_su_tuotempo: righe.filter((r) => !r.presente).length,
    ultimo_allineamento: aree.reduce((m, a) => (!m || a.synced_at > m ? a.synced_at : m), null),
  };
  return { righe, riepilogo, sedi: sedi.filter((x) => x.active || x.opened_at).map((x) => ({ id: x.id, code: x.code, name: x.name, kind: x.kind, city: x.city, active: x.active, areaid: x.area_fonte })), tipi: TIPI_DA_AREA };
}

// ------------------------------------------------------------------ risorse ↔ persone
async function personeCandidate() {
  return many(`SELECT id, first_name, last_name, email, status, kind, legacy_refs->>'tuotempo' AS risorsa FROM public.people WHERE status IN ('ATTIVO','IMPEGNO') ORDER BY last_name, first_name`);
}
export async function elencoRisorse() {
  const rows = await many(`SELECT r.*, pp.last_name || ' ' || pp.first_name AS proposta_nome, pc.last_name || ' ' || pc.first_name AS persona_nome,
      (SELECT string_agg(coalesce(a.titolo, a.areaid), ', ' ORDER BY a.titolo) FROM tuotempo_aree a WHERE r.areas ? a.areaid) AS aree_nomi
    FROM tuotempo_risorse r LEFT JOIN public.people pp ON pp.id = r.proposta_person_id LEFT JOIN public.people pc ON pc.id = r.person_id
    ORDER BY r.presente DESC, r.is_machine, lower(r.name)`);
  const righe = rows.map((r) => ({ ...r, dati: undefined, stato: r.is_machine ? 'MACCHINA' : r.person_id ? 'ABBINATA' : r.proposta_person_id ? 'PROPOSTA' : 'DA_ABBINARE' }));
  const pers = righe.filter((r) => r.presente && !r.is_machine);
  return { righe, riepilogo: { risorse: righe.filter((r) => r.presente).length, persone: pers.length, macchine: righe.filter((r) => r.presente && r.is_machine).length, abbinate: pers.filter((r) => r.stato === 'ABBINATA').length, proposte: pers.filter((r) => r.stato === 'PROPOSTA').length, da_abbinare: pers.filter((r) => r.stato === 'DA_ABBINARE').length } };
}

/** Conferma dell'abbinamento risorsa ↔ persona: people.legacy_refs.tuotempo = resourceid (una risorsa, una persona), audit PERSON_UPDATED. */
export async function confermaRisorsa(resourceid, personId, { req = null, actorId = null } = {}) {
  const r = await one('SELECT * FROM tuotempo_risorse WHERE resourceid=$1', [resourceid]);
  if (!r) throw errore(404, 'Risorsa TuoTempo non trovata');
  if (r.is_machine) throw errore(400, 'È una macchina, non una persona');
  const p = await one(`SELECT id, first_name, last_name, legacy_refs->>'tuotempo' AS risorsa FROM public.people WHERE id=$1`, [personId]);
  if (!p) throw errore(404, 'Persona non trovata');
  if (p.risorsa && p.risorsa !== resourceid) throw errore(409, `${p.last_name} ${p.first_name} è già abbinata a un'altra risorsa TuoTempo (${p.risorsa}): scollegala prima`);
  const attore = req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null };
  const altre = await many(`SELECT id FROM public.people WHERE legacy_refs->>'tuotempo' = $1 AND id <> $2`, [resourceid, p.id]);
  for (const x of altre) {
    await q(`UPDATE public.people SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) - 'tuotempo', updated_at=now() WHERE id=$1`, [x.id]);
    await auditCore(attore, 'PERSON_UPDATED', { entity: 'person', entityId: x.id, label: 'Risorsa TuoTempo scollegata', data: { origine: 'Retail > TuoTempo (risorse)', legacy_refs: { tuotempo: null } } });
  }
  await q(`UPDATE public.people SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || jsonb_build_object('tuotempo', $2::text), updated_at=now() WHERE id=$1`, [p.id, resourceid]);
  await auditCore(attore, 'PERSON_UPDATED', { entity: 'person', entityId: p.id, label: `${p.last_name} ${p.first_name}: risorsa TuoTempo ${r.name || resourceid}`, data: { origine: 'Retail > TuoTempo (risorse)', legacy_refs: { tuotempo: resourceid } } });
  await q('UPDATE tuotempo_risorse SET person_id=$2, confermata_at=now(), confermata_da=$3 WHERE resourceid=$1', [resourceid, p.id, req?.suiteUser?.id || req?.user?.id || actorId || null]);
  await q('UPDATE tuotempo_risorse SET person_id=NULL, confermata_at=NULL WHERE person_id=$1 AND resourceid<>$2', [p.id, resourceid]);
  return { resourceid, person_id: p.id };
}
export async function scollegaRisorsa(resourceid, { req = null, actorId = null } = {}) {
  const attore = req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null };
  const rows = await many(`SELECT id FROM public.people WHERE legacy_refs->>'tuotempo' = $1`, [resourceid]);
  for (const x of rows) {
    await q(`UPDATE public.people SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) - 'tuotempo', updated_at=now() WHERE id=$1`, [x.id]);
    await auditCore(attore, 'PERSON_UPDATED', { entity: 'person', entityId: x.id, label: 'Risorsa TuoTempo scollegata', data: { origine: 'Retail > TuoTempo (risorse)', legacy_refs: { tuotempo: null } } });
  }
  await q('UPDATE tuotempo_risorse SET person_id=NULL, confermata_at=NULL, confermata_da=NULL WHERE resourceid=$1', [resourceid]);
  return { resourceid, scollegate: rows.length };
}

// ------------------------------------------------------------------ allineamento completo ("Allinea adesso" e job notturno)
/**
 * Legge le Key Entities e aggiorna le tabelle della Suite. Nessuna scrittura su public.sites (gli abbinamenti si confermano a mano), salvo
 * il passaggio una tantum dallo specchio alla fonte (portaSpecchioNellaFonte). Ritorna il riepilogo per il registro e la pagina.
 */
export async function allineaTuotempo({ userId = null, actorId = null } = {}) {
  const cfg = await configurazione();
  const { orariDaTesto, hoursText } = await sites();
  const ora = new Date();
  const oggi = oggiRoma();
  // 1. aree (non paginate) e, per ogni area, prestazioni prenotabili e risorse che ci lavorano (solo identificativi)
  const aree = await ttElenco(cfg, 'areas', {}, { paginata: false });
  const attivitaPerArea = {}; const risorsePerArea = {};
  for (const a of aree) {
    const id = s(a.areaid); if (!id) continue;
    attivitaPerArea[id] = (await ttElenco(cfg, 'activities', { areaid: id }, { campi: 'activities_id' })).filter((x) => !uno(x.isHidden)).map((x) => s(x.activityid)).filter(Boolean);
    risorsePerArea[id] = (await ttElenco(cfg, 'resources', { areaid: id }, { campi: 'resources_id' })).map((x) => s(x.resourceid || x.machid)).filter(Boolean);
  }
  // 2. elenchi completi
  const attivita = await ttElenco(cfg, 'activities');
  const risorse = await ttElenco(cfg, 'resources');
  const assicurazioni = await ttElenco(cfg, 'insurances');

  // --- aree
  const idAree = [];
  for (const a of aree) {
    const id = s(a.areaid); if (!id) continue;
    idAree.push(id);
    const orari = orariDaTesto(nn(a.opening_hrs));
    await q(`INSERT INTO tuotempo_aree (areaid, titolo, web_title, indirizzo, cap, citta, provincia, regione, lat, lng, mobile, landline, opening_hrs, orari_norm, tags, legacyid, is_hidden, is_default, presente, attivita, dati, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE,$19,$20,now())
      ON CONFLICT (areaid) DO UPDATE SET titolo=EXCLUDED.titolo, web_title=EXCLUDED.web_title, indirizzo=EXCLUDED.indirizzo, cap=EXCLUDED.cap, citta=EXCLUDED.citta, provincia=EXCLUDED.provincia,
        regione=EXCLUDED.regione, lat=EXCLUDED.lat, lng=EXCLUDED.lng, mobile=EXCLUDED.mobile, landline=EXCLUDED.landline, opening_hrs=EXCLUDED.opening_hrs, orari_norm=EXCLUDED.orari_norm, tags=EXCLUDED.tags,
        legacyid=EXCLUDED.legacyid, is_hidden=EXCLUDED.is_hidden, is_default=EXCLUDED.is_default, presente=TRUE, attivita=EXCLUDED.attivita, dati=EXCLUDED.dati, synced_at=now()`,
    [id, nn(a.areaTitle), nn(a.webTitle), nn(a.address), nn(a.cp), nn(a.city), nn(a.province), nn(a.region), num(a.latitude), num(a.longitude), nn(a.mobile), nn(a.landline), nn(a.opening_hrs), orari ? hoursText(orari) : null,
      nn(a.tags), nn(a.legacyid), uno(a.isHidden), uno(a.isDefault), JSON.stringify(attivitaPerArea[id] || []), JSON.stringify(a)]);
  }
  await q('UPDATE tuotempo_aree SET presente=FALSE WHERE NOT (areaid = ANY($1::text[]))', [idAree]);
  const fonte = await portaSpecchioNellaFonte({ actorId: actorId || userId });

  // --- attività → catalogo prestazioni (codice = legacyid, altrimenti TT-<activityid>; price resta il listino della Suite)
  const areaDaTitolo = Object.fromEntries((await many('SELECT areaid, lower(titolo) AS t, lower(web_title) AS w FROM tuotempo_aree WHERE presente')).flatMap((x) => [[x.t, x.areaid], [x.w, x.areaid]]).filter(([k]) => k));
  const sedeDiArea = Object.fromEntries((await many(`SELECT legacy_refs->>'tuotempo' AS areaid, id FROM public.sites WHERE legacy_refs ? 'tuotempo'`)).map((x) => [x.areaid, x.id]));
  let nuove = 0; let aggiornate = 0; let storico = 0; const avvisiAtt = [];
  for (const x of attivita) {
    const id = s(x.activityid); if (!id || !nn(x.activityTitle)) continue;
    const leg = nn(x.legacyid); const code = leg || `TT-${id}`;
    const fa = parseTs(x.first_availability);
    const v = { tt_typology_id: nn(x.typologyid), tt_typology: nn(x.typologyTitle), tt_price: num(x.price), tt_price_rules: Array.isArray(x.price_rules) && x.price_rules.length ? JSON.stringify(x.price_rules) : null,
      tt_preparation: nn(x.preparation), tt_hidden: uno(x.isHidden), tt_first_availability: fa, tt_first_availability_area: nn(x.first_availability_areaTitle), tt_legacyid: leg, duration: num(x.duration) };
    const esiste = await one('SELECT id, tt_activity_id FROM products WHERE tt_activity_id=$1', [id]) || await one('SELECT id, tt_activity_id FROM products WHERE upper(code)=upper($1)', [code]);
    if (esiste && esiste.tt_activity_id && esiste.tt_activity_id !== id) { avvisiAtt.push(`Codice ${code} già usato dall'attività ${esiste.tt_activity_id}: attività ${id} non collegata`); continue; }
    const params = [id, v.tt_typology_id, v.tt_typology, v.tt_price, v.tt_price_rules, v.tt_preparation, v.tt_hidden, v.tt_first_availability, v.tt_first_availability_area, v.tt_legacyid, v.duration != null ? Math.round(v.duration) : null];
    if (esiste) {
      await q(`UPDATE products SET tt_activity_id=$1, tt_typology_id=$2, tt_typology=$3, tt_price=$4, tt_price_rules=$5, tt_preparation=$6, tt_hidden=$7, tt_first_availability=$8, tt_first_availability_area=$9, tt_legacyid=$10,
          duration_min=coalesce($11, duration_min), tt_synced_at=now(), updated_at=now() WHERE id=$12`, [...params, esiste.id]);
      aggiornate++;
    } else {
      await q(`INSERT INTO products (tt_activity_id, tt_typology_id, tt_typology, tt_price, tt_price_rules, tt_preparation, tt_hidden, tt_first_availability, tt_first_availability_area, tt_legacyid, duration_min,
          code, description, specialty, price, source, external_id, active, tt_synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$3,$4,'TUOTEMPO',$1,TRUE,now())`, [...params, code, s(x.activityTitle)]);
      nuove++;
    }
    // storico giornaliero della prima disponibilità: solo le prestazioni visibili online
    if (fa && !v.tt_hidden) {
      const areaid = v.tt_first_availability_area ? areaDaTitolo[v.tt_first_availability_area.toLowerCase()] || null : null;
      await q(`INSERT INTO tuotempo_attivita (data, activityid, areaid, site_id, typologyid, first_availability, giorni_attesa) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (data, activityid) DO UPDATE SET areaid=EXCLUDED.areaid, site_id=EXCLUDED.site_id, typologyid=EXCLUDED.typologyid, first_availability=EXCLUDED.first_availability, giorni_attesa=EXCLUDED.giorni_attesa`,
      [oggi, id, areaid, areaid ? sedeDiArea[areaid] || null : null, v.tt_typology_id, fa, giorniAttesa(x.first_availability, ora)]);
      storico++;
    }
  }

  // --- risorse (aree dalla lista se ci sono, altrimenti dalle chiamate per area) e proposte di abbinamento alle persone
  const persone = await personeCandidate();
  const confermate = Object.fromEntries(persone.filter((p) => p.risorsa).map((p) => [p.risorsa, p.id]));
  const idRis = [];
  for (const r of risorse) {
    const id = s(r.resourceid || r.machid); if (!id) continue;
    idRis.push(id);
    const areeR = Array.isArray(r.areas) && r.areas.length ? r.areas.map((x) => s(typeof x === 'object' ? x.areaid : x)).filter(Boolean) : Object.entries(risorsePerArea).filter(([, ids]) => ids.includes(id)).map(([a]) => a);
    const prop = proponiPersona({ ...r, name: r.name || r.resourceName }, persone);
    await q(`INSERT INTO tuotempo_risorse (resourceid, name, email, phone, status, is_hidden, is_machine, satisfaction, areas, legacyid, idnumber, presente, proposta_person_id, proposta_come, person_id, dati, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14,$15,now())
      ON CONFLICT (resourceid) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone, status=EXCLUDED.status, is_hidden=EXCLUDED.is_hidden, is_machine=EXCLUDED.is_machine,
        satisfaction=EXCLUDED.satisfaction, areas=EXCLUDED.areas, legacyid=EXCLUDED.legacyid, idnumber=EXCLUDED.idnumber, presente=TRUE, proposta_person_id=EXCLUDED.proposta_person_id,
        proposta_come=EXCLUDED.proposta_come, person_id=EXCLUDED.person_id, dati=EXCLUDED.dati, synced_at=now()`,
    [id, nn(r.name || r.resourceName), nn(r.email), nn(r.rphone), nn(r.status), uno(r.isHidden), uno(r.is_machine), num(r.satisfaction), JSON.stringify(areeR), nn(r.legacyid), nn(r.idnumber),
      prop?.person_id ?? null, prop?.come ?? null, confermate[id] ?? null, JSON.stringify({ ...r, areas: undefined })]);
  }
  await q('UPDATE tuotempo_risorse SET presente=FALSE WHERE NOT (resourceid = ANY($1::text[]))', [idRis]);

  // --- assicurazioni
  const idAss = [];
  for (const x of assicurazioni) {
    const id = s(x.insuranceid); if (!id) continue;
    idAss.push(id);
    await q(`INSERT INTO tuotempo_assicurazioni (insuranceid, titolo, legacyid, legacy_title, is_default, is_hidden, tags, presente, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,now())
      ON CONFLICT (insuranceid) DO UPDATE SET titolo=EXCLUDED.titolo, legacyid=EXCLUDED.legacyid, legacy_title=EXCLUDED.legacy_title, is_default=EXCLUDED.is_default, is_hidden=EXCLUDED.is_hidden, tags=EXCLUDED.tags, presente=TRUE, synced_at=now()`,
    [id, nn(x.insurance_title), nn(x.legacyid), nn(x.legacyTitle), uno(x.isDefault), uno(x.IsHidden), nn(x.tags)]);
  }
  await q('UPDATE tuotempo_assicurazioni SET presente=FALSE WHERE NOT (insuranceid = ANY($1::text[]))', [idAss]);

  const { riepilogo } = await elencoAree();
  const ris = await elencoRisorse();
  const summary = {
    synced_at: new Date().toISOString(), aree: riepilogo.aree, aree_abbinate: riepilogo.abbinate, aree_da_abbinare: riepilogo.da_abbinare, aree_con_proposta: riepilogo.con_proposta, aree_ignorate: riepilogo.ignorate,
    aree_con_differenze: riepilogo.con_differenze, attivita: attivita.length, attivita_nuove: nuove, attivita_aggiornate: aggiornate, storico_prima_disponibilita: storico,
    risorse: ris.riepilogo.risorse, risorse_abbinate: ris.riepilogo.abbinate, risorse_proposte: ris.riepilogo.proposte, macchine: ris.riepilogo.macchine,
    assicurazioni: assicurazioni.length, abbinamenti_portati_nella_fonte: fonte.portati, avvisi: avvisiAtt.slice(0, 20),
  };
  const message = `TuoTempo: ${summary.aree} aree (${summary.aree_abbinate} ${summary.aree_abbinate === 1 ? 'abbinata' : 'abbinate'}, ${summary.aree_da_abbinare} da abbinare${summary.aree_ignorate ? `, ${summary.aree_ignorate} ${summary.aree_ignorate === 1 ? 'non nostra' : 'non nostre'}` : ''}), ${summary.attivita} attività (${nuove} nuove, ${aggiornate} aggiornate), prima disponibilità di ${storico} prestazioni online, ${summary.risorse} risorse (${summary.risorse_abbinate} abbinate a persone, ${summary.risorse_proposte} proposte), ${summary.assicurazioni} assicurazioni`;
  return { ...summary, message, rows_read: aree.length + attivita.length + risorse.length + assicurazioni.length, rows_ok: nuove + aggiornate };
}

// ------------------------------------------------------------------ letture per scheda sede, listino e cockpit
/** Blocco "Prenotazione online" della scheda sede di Retail. */
export async function prenotazioneOnline(siteId) {
  const a = await one(`SELECT a.* FROM public.sites s JOIN tuotempo_aree a ON a.areaid = s.legacy_refs->>'tuotempo' WHERE s.id=$1`, [siteId]);
  if (!a) return { abbinata: false };
  const ids = Array.isArray(a.attivita) ? a.attivita : [];
  const prest = ids.length ? await one(`SELECT count(*)::int AS n FROM products WHERE tt_activity_id = ANY($1::text[]) AND NOT coalesce(tt_hidden, FALSE)`, [ids]) : { n: 0 };
  const med = await one(`SELECT count(*) FILTER (WHERE status='a' AND NOT is_hidden)::int AS attivi, count(*)::int AS tutti, round(avg(satisfaction) FILTER (WHERE status='a' AND satisfaction IS NOT NULL), 2) AS soddisfazione,
      count(*) FILTER (WHERE status='a' AND satisfaction IS NOT NULL)::int AS con_soddisfazione
    FROM tuotempo_risorse WHERE presente AND NOT is_machine AND areas ? $1`, [a.areaid]);
  const att = await many(`SELECT giorni_attesa FROM tuotempo_attivita WHERE site_id=$1 AND data=(SELECT max(data) FROM tuotempo_attivita WHERE site_id=$1)`, [siteId]);
  const ultimo = await one('SELECT max(data) AS d FROM tuotempo_attivita WHERE site_id=$1', [siteId]);
  const cf = await one('SELECT * FROM tuotempo_confronto_v WHERE site_id=$1', [siteId]);
  return {
    abbinata: true, area: { areaid: a.areaid, titolo: a.titolo, is_hidden: a.is_hidden, telefono: telefonoArea(a), orari: a.opening_hrs, indirizzo: [a.indirizzo, [a.cap, a.citta].filter(Boolean).join(' ')].filter(Boolean).join(', '), synced_at: a.synced_at },
    prestazioni_online: prest.n, prestazioni_area: ids.length, medici_attivi: med.attivi, medici_totali: med.tutti, soddisfazione_media: med.soddisfazione != null ? Number(med.soddisfazione) : null, con_soddisfazione: med.con_soddisfazione,
    attesa_mediana_giorni: mediana(att.map((x) => x.giorni_attesa)), attesa_prestazioni: att.length, attesa_data: ultimo?.d || null,
    differenze: cf ? ['indirizzo', 'cap', 'citta', 'telefono', 'orari'].filter((k) => cf[`diff_${k}`]).map((k) => ({ campo: k, tuotempo: cf[`tt_${k}`], anagrafica: cf[k] })) : [],
  };
}

/**
 * "Listino online vs prezzo di cassa": prezzo TuoTempo contro il prezzo medio delle vendite GIPO per prodotto (incasso netto diviso
 * quantità, vendite private: payment_kind vuoto o PRIVATO, ultimi `mesi` mesi, senza vendite dimostrative).
 */
export async function listinoOnlineVsCassa({ mesi = 12 } = {}) {
  const m = Math.min(36, Math.max(1, Number(mesi) || 12));
  const rows = await many(`SELECT p.id, p.code, p.description, p.tt_typology AS tipologia, p.tt_price, p.price AS listino, p.tt_hidden, p.tt_activity_id,
      v.n_vendite, v.quantita, v.prezzo_medio
    FROM products p LEFT JOIN LATERAL (
      SELECT count(*)::int AS n_vendite, sum(s.quantity)::int AS quantita, round(sum(s.net_amount) / nullif(sum(s.quantity), 0), 2) AS prezzo_medio
        FROM sales s WHERE s.product_id = p.id AND s.source = 'GIPO' AND (s.payment_kind IS NULL OR upper(s.payment_kind) = 'PRIVATO') AND s.sale_date >= (CURRENT_DATE - ($1 || ' months')::interval)) v ON TRUE
    WHERE p.tt_activity_id IS NOT NULL ORDER BY p.tt_hidden NULLS FIRST, lower(p.description)`, [String(m)]);
  const righe = rows.map((r) => {
    const tt = r.tt_price != null ? Number(r.tt_price) : null; const cassa = r.prezzo_medio != null ? Number(r.prezzo_medio) : null;
    return { ...r, tt_price: tt, prezzo_medio: cassa, listino: r.listino != null ? Number(r.listino) : null, differenza: tt != null && cassa != null ? Math.round((tt - cassa) * 100) / 100 : null, differenza_pct: tt != null && cassa ? Math.round(((tt - cassa) / cassa) * 1000) / 10 : null };
  });
  return { mesi: m, righe, con_vendite: righe.filter((r) => r.n_vendite).length, senza_vendite: righe.filter((r) => !r.n_vendite).length };
}
