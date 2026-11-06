// Business Hub: regole pure (senza database) del CRM a fasi. Usate dalle route, dal job delle caselle e dai test.
// - Fasi: 0 = prospect censito (nessuna data), 1..7 = Lead, Primo contatto, Sopralluogo, Offerta inviata, Negoziazione, Contratto
//   firmato, Attivo / Starting. La fase corrente è l'ultima con una data (come la colonna calcolata "Fase Attuale" del DB del CEO),
//   ma la fase 7 richiede il cliente attivo: senza, la fase resta 6 e la data della fase 7 resta registrata.
// - Cliente attivo: lo imposta a mano SOLO il CEO (Owner della Suite) o un Admin del modulo. Contratti, autorizzazioni e import non
//   lo cambiano: le righe del DB con "Toscana Diagnostica" + "Cliente TD attivo" diventano un'attività "da confermare dal CEO".
// - Stallo: fase 1..6 senza avanzamenti da più della soglia (45 giorni predefiniti, Impostazioni), come l'"Alert stallo" del DB: chi ha
//   la data di Attivo / Starting (in attesa della conferma del CEO) non è in stallo.
// - Email in arrivo: abbinamento all'account per indirizzo del mittente (referenti, persone, Legal entity) o per dominio (mai i
//   domini dei provider di posta), preferendo l'account della linea della casella.
// - DB Opportunità (XLSX del CEO, 49 colonne): mappatura delle colonne, "n.d." = vuoto con nota, accorpamento delle righe dello
//   stesso gruppo o ente gestore in una sola Legal entity (mai per le descrizioni generiche come "istituto religioso").
import { norm } from '../../../lib/anagraficaMatch.js';

export const LINEE = {
  SRV: { label: 'Service di Laboratorio', casella: 'service@toscanadiagnostica.it', ruolo: 'SERVICE', segmento: 'CLIENTI_SERVICE' },
  PP: { label: 'Punti Prelievo', casella: 'network@toscanadiagnostica.it', ruolo: 'RETAIL', segmento: 'PUNTI_PRELIEVO' },
  MDL: { label: 'Medicina del Lavoro', casella: 'mdl@toscanadiagnostica.it', ruolo: 'MDL', segmento: 'MEDICINA_LAVORO' },
};
export const LINEE_KEYS = Object.keys(LINEE);

// Copie fisse su ogni email inviata dal widget (precisazione del CEO del 06/11/2026), modificabili in Impostazioni per linea
export const CC_PREDEFINITI = {
  SRV: ['francesco.epifani@toscanadiagnostica.it', 'rosetta.greco@toscanadiagnostica.it'],
  PP: ['francesco.epifani@toscanadiagnostica.it', 'silvia.sansoni@toscanadiagnostica.it'],
  MDL: ['francesco.epifani@toscanadiagnostica.it', 'angelica.corradi@toscanadiagnostica.it'],
};

export const FASI = [
  { n: 0, key: 'PROSPECT', label: 'Prospect censito', db: '0. Prospect' },
  { n: 1, key: 'LEAD', label: 'Lead', db: '1. Lead' },
  { n: 2, key: 'PRIMO_CONTATTO', label: 'Primo contatto', db: '2. Primo Contatto' },
  { n: 3, key: 'SOPRALLUOGO', label: 'Sopralluogo', db: '3. Sopralluogo' },
  { n: 4, key: 'OFFERTA_INVIATA', label: 'Offerta inviata', db: '4. Offerta Inviata' },
  { n: 5, key: 'NEGOZIAZIONE', label: 'In negoziazione', db: '5. In Negoziazione' },
  { n: 6, key: 'CONTRATTO_FIRMATO', label: 'Contratto firmato', db: '6. Contratto Firmato' },
  { n: 7, key: 'ATTIVO', label: 'Attivo / Starting', db: '7. Attivo' },
];
export const faseLabel = (n) => FASI[Number(n)]?.label || '–';
export const faseDb = (n) => FASI[Number(n)]?.db || '';

const isoData = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);

// Ultima fase con una data (0 se nessuna)
export function faseDaDate(phaseDates = {}) {
  let f = 0;
  for (let n = 1; n <= 7; n++) if (isoData(phaseDates?.[n] ?? phaseDates?.[String(n)])) f = n;
  return f;
}
// Fase corrente con la regola del cliente attivo: la 7 vale solo se il cliente è attivo
export function faseEffettiva(phaseDates, clienteAttivo) {
  const f = faseDaDate(phaseDates);
  return f === 7 && !clienteAttivo ? 6 : f;
}
export function puoAndareInFase(fase, clienteAttivo) {
  const f = Number(fase);
  if (!Number.isInteger(f) || f < 0 || f > 7) return { ok: false, motivo: 'Fase non valida' };
  if (f === 7 && !clienteAttivo) return { ok: false, motivo: 'La fase 7 (Attivo / Starting) richiede il cliente attivo: lo imposta il CEO o un Admin del modulo dalla scheda account' };
  return { ok: true };
}
// Chi può dire che il cliente è attivo: Admin del modulo o Owner della Suite (il CEO)
export const puoImpostareAttivo = (moduleRole, suiteLevel) => moduleRole === 'ADMIN' || suiteLevel === 'OWNER';

// Data dell'ultimo avanzamento (la più recente tra le date di fase)
export function ultimoAvanzamento(phaseDates = {}) {
  let max = null;
  for (let n = 1; n <= 7; n++) { const d = isoData(phaseDates?.[n] ?? phaseDates?.[String(n)]); if (d && (!max || d > max)) max = d; }
  return max;
}
export function giorniDa(data, oggi = new Date().toISOString().slice(0, 10)) {
  const d = isoData(data); if (!d) return null;
  return Math.round((Date.parse(`${oggi}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
}
// Stallo: fasi 1..6, nessun avanzamento da più di `soglia` giorni (un avanzamento con data futura non è uno stallo)
export function inStallo({ fase_corrente, phase_dates }, soglia = 45, oggi) {
  const f = Number(fase_corrente);
  if (!(f >= 1 && f <= 6)) return false;
  if (isoData(phase_dates?.[7] ?? phase_dates?.['7'])) return false;   // Attivo / Starting registrato: attende la conferma del CEO, non è uno stallo
  const g = giorniDa(ultimoAvanzamento(phase_dates), oggi);
  return g != null && g > Number(soglia);
}

// Spostamento in una fase (Pipeline): la data della fase di arrivo è quella indicata (oggi se assente); andando indietro le date
// delle fasi successive si tolgono (restano nell'attività di avanzamento)
export function spostaFase(phaseDates = {}, fase, data) {
  const out = {}; const tolte = {};
  for (let n = 1; n <= 7; n++) {
    const d = isoData(phaseDates?.[n] ?? phaseDates?.[String(n)]);
    if (!d) continue;
    if (n > fase) tolte[n] = d; else out[n] = d;
  }
  if (fase >= 1) out[fase] = isoData(data) || out[fase] || new Date().toISOString().slice(0, 10);
  return { phase_dates: out, tolte };
}

// ---------------- Email ----------------
export const DOMINI_GENERICI = new Set(['gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it', 'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'alice.it', 'tim.it', 'tin.it', 'virgilio.it', 'tiscali.it', 'fastwebnet.it', 'email.it', 'inwind.it', 'pec.it', 'legalmail.it', 'postecert.it', 'arubapec.it', 'pec.aruba.it', 'cert.legalmail.it', 'gigapec.it', 'pecveneto.it', 'toscanadiagnostica.it']);
export const emailValida = (s) => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(String(s || '').trim());
export const dominio = (email) => { const m = String(email || '').trim().toLowerCase().match(/@([^@\s>]+)$/); return m ? m[1] : null; };
export const dominioPec = (d) => Boolean(d) && /(^|\.)pec\.|\.pec$|^pec[.-]|legalmail|postecert|arubapec/.test(d);
export const dominioGenerico = (d) => !d || DOMINI_GENERICI.has(d) || dominioPec(d);

/**
 * Indice per l'abbinamento: voci { email, account_id, linea, fonte } (referenti, persone, Legal entity, sedi del gruppo).
 * Restituisce { account_id, come } oppure { account_id: null, candidati: [...] } (nessuno o più di uno: da assegnare a mano).
 */
export function abbinaEmail(fromEmail, voci = [], linea = null) {
  const e = String(fromEmail || '').trim().toLowerCase();
  if (!emailValida(e)) return { account_id: null, candidati: [], come: 'mittente non valido' };
  const scegli = (lista, come) => {
    const ids = [...new Set(lista.map((v) => v.account_id))];
    if (ids.length === 1) return { account_id: ids[0], come };
    const stessaLinea = [...new Set(lista.filter((v) => v.linea === linea).map((v) => v.account_id))];
    if (stessaLinea.length === 1) return { account_id: stessaLinea[0], come: `${come} (linea della casella)` };
    return null;
  };
  const esatte = voci.filter((v) => String(v.email || '').trim().toLowerCase() === e);
  if (esatte.length) {
    const r = scegli(esatte, `email di ${esatte[0].fonte || 'contatto'}`);
    if (r) return r;
    return { account_id: null, candidati: [...new Set(esatte.map((v) => v.account_id))], come: 'indirizzo presente su più account' };
  }
  const d = dominio(e);
  if (dominioGenerico(d)) return { account_id: null, candidati: [], come: 'dominio generico: nessun abbinamento per dominio' };
  const perDominio = voci.filter((v) => dominio(v.email) === d);
  if (perDominio.length) {
    const r = scegli(perDominio, `dominio ${d}`);
    if (r) return r;
    return { account_id: null, candidati: [...new Set(perDominio.map((v) => v.account_id))], come: `dominio ${d} su più account` };
  }
  return { account_id: null, candidati: [], come: 'mittente sconosciuto' };
}

// Indirizzi di una stringa "a@b.it; c@d.it" → array normalizzato, senza doppioni
export const indirizzi = (s) => [...new Set(String(Array.isArray(s) ? s.join(',') : s || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(emailValida))];

// ---------------- DB Opportunità (XLSX del CEO) ----------------
// Colonne nell'ordine del file: intestazione, chiave, tipo (t testo, n numero, d data, i intero)
export const COLONNE_DB = [
  ['ID', 'id', 'i'], ['Ragione Sociale / Denominazione', 'ragione_sociale', 't'], ['Gruppo / Ente Gestore', 'gruppo', 't'], ['Tipologia', 'tipologia', 't'],
  ['Segmento Lab', 'segmento_lab', 't'], ['Indirizzo', 'indirizzo', 't'], ['Città', 'citta', 't'], ['Prov.', 'prov', 't'], ['Accreditata SSR', 'accreditata_ssr', 't'],
  ['Discipline', 'discipline', 't'], ['Fatturato struttura (€)', 'fatturato_struttura', 'n'], ['Anno bil.', 'anno_bilancio', 't'], ['Email', 'email', 't'],
  ['Telefono', 'telefono', 't'], ['Referente / Contatti noti', 'referente', 't'], ['Modalità di contatto', 'modalita_contatto', 't'],
  ['Fornitore Lab attuale', 'fornitore_attuale', 't'], ['Situazione fornitore', 'situazione_fornitore', 't'], ['Contratto TD', 'contratto_td', 't'],
  ['Listino di riferimento', 'listino_riferimento', 't'], ['Priorità', 'priorita', 't'], ['Fonte priorità', 'fonte_priorita', 't'], ['In Pipeline', 'in_pipeline', 't'],
  ['Cliente Pipeline', 'cliente_pipeline', 't'], ['Affidabilità match', 'affidabilita_match', 't'], ['Stato Cartella', 'stato_cartella', 't'],
  ['1. Lead', 'fase_1', 'd'], ['2. Primo Contatto', 'fase_2', 'd'], ['3. Sopralluogo', 'fase_3', 'd'], ['4. Offerta Inviata', 'fase_4', 'd'],
  ['5. In Negoziazione', 'fase_5', 'd'], ['6. Contratto Firmato', 'fase_6', 'd'], ['7. Attivo / Starting', 'fase_7', 'd'], ['Fase Attuale', 'fase_attuale', 't'],
  ['Ultimo avanzamento', 'ultimo_avanzamento', 'd'], ['Giorni da ultimo avanz.', 'giorni_da_avanzamento', 'i'], ['Alert stallo (>45 gg)', 'alert_stallo', 't'],
  ['Prossima azione', 'prossima_azione', 't'], ['Data prossima azione', 'data_prossima_azione', 'd'], ['Owner TD', 'owner', 't'],
  ['Sconto medio % vs listino', 'sconto_medio', 'n'], ['Volume FY atteso (esami/anno)', 'volume_fy_atteso', 'n'], ['Prezzo medio €/esame', 'prezzo_medio_esame', 'n'],
  ['Fatturato FY atteso (€)', 'fatturato_fy_atteso', 'n'], ['Fatturato 2026 da starting (€)', 'fatturato_2026', 'n'], ['Fatturato 2027 (€)', 'fatturato_2027', 'n'],
  ['Alert riconciliazione DB vs Pipeline', 'alert_riconciliazione', 't'], ['Note', 'note', 't'], ['Fonte censimento', 'fonte_censimento', 't'],
].map(([h, k, t]) => ({ h, k, t }));
// Colonne calcolate dal file (non si importano: la Suite le ricalcola)
export const COLONNE_CALCOLATE = new Set(['fase_attuale', 'ultimo_avanzamento', 'giorni_da_avanzamento', 'alert_stallo']);

const ND = /^\s*n\.?\s*d\.?\s*$/i;
// Valore di una cella exceljs: formule (risultato), testo ricco, collegamenti, date
export function valoreCella(x) {
  if (x == null) return null;
  if (x instanceof Date) return x;
  if (typeof x === 'object') {
    if ('result' in x) return valoreCella(x.result);
    if ('formula' in x || 'sharedFormula' in x) return null;
    if (Array.isArray(x.richText)) return x.richText.map((t) => t.text).join('');
    if ('text' in x) return x.text;
    if ('error' in x) return null;
  }
  return x;
}
const numero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const data = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

/**
 * Riga del DB → { valori normalizzati, nd: [intestazioni "n.d."], testi: { colonna: testo non numerico }, raw }.
 * headers: array delle intestazioni del foglio; values: array dei valori (stessi indici). "n.d." diventa null con nota.
 */
export function leggiRiga(headers, values) {
  const raw = {}; const out = { nd: [], testi: {} };
  headers.forEach((h, i) => { const v = valoreCella(values[i]); raw[String(h || '').trim()] = v instanceof Date ? v.toISOString().slice(0, 10) : v; });
  for (const c of COLONNE_DB) {
    let v = raw[c.h];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (typeof v === 'string' && ND.test(v)) { out.nd.push(c.h); v = null; }
    if (v != null) {
      if (c.t === 'n') { const n = numero(v); if (n == null) { out.testi[c.h] = String(v); } v = n; }
      else if (c.t === 'i') { const n = numero(v); v = n == null ? null : Math.round(n); }
      else if (c.t === 'd') { const d = data(v); if (!d) out.testi[c.h] = String(v); v = d; }
      else v = String(v);
    }
    out[c.k] = v;
  }
  if (out.priorita) out.priorita = String(out.priorita).toUpperCase();
  if (!['ALTA', 'MEDIA', 'BASSA'].includes(out.priorita)) out.priorita = null;
  out.phase_dates = {};
  for (let n = 1; n <= 7; n++) if (out[`fase_${n}`]) out.phase_dates[n] = out[`fase_${n}`];
  out.raw = raw;
  return out;
}

// Intestazioni attese e mancanti nel foglio
export function intestazioniMancanti(headers) {
  const set = new Set((headers || []).map((h) => String(h || '').trim()));
  return COLONNE_DB.filter((c) => !set.has(c.h)).map((c) => c.h);
}

// Campo Email del DB: "biolabor@pec.it (PEC)", "info@x.it (email gruppo; NV 800 ...)" → { email, pec, nota }
export function parseEmailCampo(s) {
  const txt = String(s || '').trim();
  if (!txt) return { email: null, pec: null, nota: null };
  const found = txt.match(/[^\s;,()<>]+@[^\s;,()<>]+\.[a-z]{2,}/gi) || [];
  let email = null; let pec = null;
  const unaPec = /\(pec\)/i.test(txt) && found.length === 1;
  for (const a of found) {
    const low = a.toLowerCase();
    if ((unaPec || dominioPec(dominio(low))) && !pec) pec = low; else if (!email) email = low;
  }
  const rest = txt.replace(/[^\s;,()<>]+@[^\s;,()<>]+\.[a-z]{2,}/gi, '').replace(/\((pec)\)/i, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return { email, pec, nota: rest && !/^[;,.\s]*$/.test(rest) ? rest : null };
}

// "Riccardo Baronti, Marco Romanelli" → ['Riccardo Baronti', 'Marco Romanelli']
export const splitReferenti = (s) => String(s || '').split(/[,;\n]|\s+e\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length >= 2 && !ND.test(x));

// Gruppo o ente gestore che NON accorpa (descrizioni del tipo di gestione, non nomi di un soggetto)
const GRUPPO_GENERICO = /^(misericordia|pubblica assistenza|istituto religioso|congregazione religiosa|societ[aà] mista.*|gestione\b.*|ente\b.*|fondazione privata.*|fondazione \(da verificare\)|fondazione\s*\/.*|opera pia.*|cooperativa.*)$/i;
export const gruppoGenerico = (g) => GRUPPO_GENERICO.test(String(g || '').trim());
export function chiaveGruppo(g) {
  const s = String(g || '').trim();
  if (!s || gruppoGenerico(s)) return null;
  return norm(s) || null;
}

/**
 * Accorpamento delle righe del DB in unità (= una Legal entity e un account): stesso gruppo o ente gestore (non generico) oppure
 * stessa ragione sociale normalizzata (anche con città diversa). Ritorna [{ chiave, gruppo, righe: [...] }] nell'ordine del file.
 */
export function raggruppa(righe) {
  const unita = []; const perChiave = new Map();
  for (const r of righe) {
    const kg = chiaveGruppo(r.gruppo);
    const kn = `nome:${norm(r.ragione_sociale)}`;
    let u = (kg && perChiave.get(`gruppo:${kg}`)) || perChiave.get(kn);
    if (!u) { u = { chiave: kg ? `gruppo:${kg}` : kn, gruppo: kg ? r.gruppo : null, righe: [] }; unita.push(u); }
    u.righe.push(r);
    if (kg) perChiave.set(`gruppo:${kg}`, u);
    perChiave.set(kn, u);
  }
  for (const u of unita) if (u.righe.length === 1) u.gruppo = null;   // un gruppo di una sola riga è una struttura e basta
  return unita;
}

// Riga principale dell'unità: la più avanzata (fase), poi il fatturato atteso più alto, poi l'ordine del file
export function rigaPrincipale(righe) {
  return [...righe].sort((a, b) => faseDaDate(b.phase_dates) - faseDaDate(a.phase_dates) || (Number(b.fatturato_fy_atteso) || 0) - (Number(a.fatturato_fy_atteso) || 0))[0];
}
const PRIO = { ALTA: 3, MEDIA: 2, BASSA: 1 };
export const prioritaMassima = (righe) => righe.map((r) => r.priorita).filter((p) => PRIO[p]).sort((a, b) => PRIO[b] - PRIO[a])[0] || null;
// Somma dei valori presenti (null se nessuna riga ne ha)
export function somma(righe, k) {
  const v = righe.map((r) => r[k]).filter((x) => x != null && Number.isFinite(Number(x)));
  return v.length ? Math.round(v.reduce((a, x) => a + Number(x), 0) * 100) / 100 : null;
}

// Regola del cliente attivo all'import: mai attivo da solo; "Toscana Diagnostica" + "Cliente TD attivo" → da confermare dal CEO
export function regolaImportAttivo(r) {
  const td = /toscana\s*diagnostica/i.test(String(r.fornitore_attuale || ''));
  const attivo = /cliente\s*td\s*attivo/i.test(String(r.situazione_fornitore || ''));
  if (td && attivo) return { cliente_attivo: false, da_confermare: true, motivo: `Il DB Opportunità indica "${r.fornitore_attuale}" e "${r.situazione_fornitore}"${r.fase_7 ? ` (Attivo / Starting dal ${r.fase_7})` : ''}: da confermare dal CEO, che imposta il cliente attivo dalla scheda account` };
  if (r.fase_7) return { cliente_attivo: false, da_confermare: true, motivo: `Il DB Opportunità ha la data della fase 7 (Attivo / Starting: ${r.fase_7}): la fase resta 6 finché il CEO non conferma il cliente attivo` };
  return { cliente_attivo: false, da_confermare: false, motivo: null };
}

// Esito dell'abbinamento per somiglianza del nome (pg_trgm): ≥ 90% abbinato, 72-90% dubbio da confermare a mano, sotto nuovo
export const esitoSomiglianza = (s) => (s >= 0.9 ? 'ABBINATO' : s >= 0.72 ? 'DUBBIO' : 'NUOVO');

// Differenze tra la riga del DB e la pipeline del contratto (data.pipeline dei pacchetti, 21/07/2026): fase, date, valori
const PIPE_DATE = { 1: 'data_lead', 2: 'data_primo_contatto', 3: 'data_sopralluogo', 4: 'data_offerta_inviata', 5: 'data_in_negoziazione', 6: 'data_contratto_firmato', 7: 'data_attivo_starting' };
export function differenzePipeline(r, p) {
  if (!p) return [];
  const diff = [];
  const fDb = faseDb(faseDaDate(r.phase_dates)) || '0. Prospect';
  if (p.fase_attuale && String(p.fase_attuale).trim() !== fDb) diff.push({ campo: 'Fase attuale', db: fDb, contratto: p.fase_attuale });
  for (let n = 1; n <= 7; n++) {
    const a = r.phase_dates?.[n] || null; const b = isoData(p[PIPE_DATE[n]]);
    if ((a || b) && a !== b) diff.push({ campo: FASI[n].db, db: a, contratto: b });
  }
  const num = (k, kp, label) => { const a = r[k]; const b = p[kp]; if ((a != null || b != null) && Math.abs(Number(a || 0) - Number(b || 0)) > 0.5) diff.push({ campo: label, db: a, contratto: b }); };
  num('fatturato_fy_atteso', 'fatturato_fy_atteso_eur', 'Fatturato FY atteso (€)');
  num('fatturato_2026', 'fatturato_2026_da_starting_eur', 'Fatturato 2026 da starting (€)');
  num('prezzo_medio_esame', 'prezzo_medio_eur', 'Prezzo medio €/esame');
  return diff;
}
