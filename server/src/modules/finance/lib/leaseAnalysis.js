// Scadenziario strutture: lettura di un contratto di affitto in PDF con Claude (richiesta del CEO, 28/10/2026). Il testo estratto
// (lib/pdftext.js della Suite: pdftotext, OCR se scansione) viene passato al modello con un prompt da trascrittore fedele; la risposta
// JSON (locatore, conduttore, immobile, durata, canone, registrazione, tipo, clausole, confidenza per campo con citazione) viene poi
// mappata sui campi del form del contratto e abbinata alle anagrafiche (lib/anagraficaMatch.js: sede TD, Legal entity, beneficiario
// Payments). Lettura assistita: l'utente controlla e salva, niente salvataggio automatico. Ogni chiamata finisce in ai_log (claude.js).
// FINANCE_AI_MOCK=1 (solo fuori produzione) sostituisce il modello con un estrattore a espressioni regolari per il collaudo del flusso.
import { aiEnabled, askJson } from '../../../lib/claude.js';
import { config as suite } from '../../../config.js';
import { matchOrg, matchSite, cfOrVat } from '../../../lib/anagraficaMatch.js';
import { estraiTesto } from '../../../lib/pdftext.js';
import { one } from '../db.js';
import { bad } from './util.js';
import { addMonths, parseDate, toIso } from './schedule.js';

export const MAX_CHARS = 60_000;
export const AI_NOT_CONFIGURED = 'Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni';
export const mockEnabled = () => process.env.NODE_ENV !== 'production' && process.env.FINANCE_AI_MOCK === '1';

const SYSTEM = [
  'Sei un trascrittore fedele di contratti di locazione italiani per l\'ufficio amministrativo di Toscana Diagnostica.',
  'Leggi il testo del contratto e riporta SOLO ciò che il testo dice, senza interpretazioni libere e senza inventare: dove il testo non indica un dato scrivi null.',
  'Date in formato AAAA-MM-GG, importi come numeri (punto decimale, senza simbolo di valuta), percentuali come numeri.',
  'Per ogni campo che compili indica la confidenza (alta, media, bassa) e la citazione testuale breve (massimo 200 caratteri) da cui lo hai ricavato.',
  'Rispondi esclusivamente con un oggetto JSON, senza testo prima o dopo, con questa struttura:',
  '{"locatore":{"ragione_sociale":"","piva":"","cf":"","indirizzo":"","pec":"","legale_rappresentante":""},',
  '"conduttore":{"ragione_sociale":"","piva":"","cf":""},',
  '"immobile":{"indirizzo":"","cap":"","citta":"","provincia":"","descrizione":"","dati_catastali":""},',
  '"durata":{"decorrenza":"AAAA-MM-GG","anni":0,"rinnovo_anni":0,"preavviso_mesi":0,"scadenza":"AAAA-MM-GG"},',
  '"canone":{"importo":0,"periodo":"MESE|TRIMESTRE|SEMESTRE|ANNO","iva":"PIU_IVA|IVA_INCLUSA|ESENTE","rate_iniziali_diverse":"testo o null","rate_iniziali":[{"dal":"AAAA-MM-GG","al":"AAAA-MM-GG","importo":0,"nota":""}],"istat":{"previsto":true,"regola":""},"deposito":0,"fideiussione":0,"spese":""},',
  '"registrazione":"IMPOSTA_ANNUALE|UNICA_SOLUZIONE|CEDOLARE_SECCA|DA_REGISTRARE|null",',
  '"tipo_contratto":"COMMERCIALE_6_6|COMMERCIALE_9_9|ABITATIVO_4_4|ABITATIVO_3_2|TRANSITORIO|COMODATO|ALTRO",',
  '"clausole_rilevanti":["recesso: ...","manutenzioni: ...","sublocazione: ..."],',
  '"confidenza":{"<campo in notazione puntata, es. canone.importo>":{"livello":"alta|media|bassa","citazione":"..."}}}',
  'Regole: "canone.importo" è l\'importo della singola rata a regime e "canone.periodo" la sua periodicità; se il contratto indica solo il canone annuo con rate mensili, importo = canone annuo / 12 e periodo = MESE.',
  'Se i primi mesi hanno importi diversi (rate iniziali ridotte) elencali in rate_iniziali con le date e riporta il testo in rate_iniziali_diverse.',
  'tipo_contratto: 6 anni con rinnovo di 6 = COMMERCIALE_6_6; 9+9 = COMMERCIALE_9_9; abitativo 4+4 o 3+2; durata inferiore a 18 mesi = TRANSITORIO; comodato gratuito = COMODATO; altrimenti ALTRO.',
  'registrazione: IMPOSTA_ANNUALE se le parti pagano l\'imposta di registro ogni anno (o a carico ripartito senza altra indicazione), UNICA_SOLUZIONE se versata per l\'intera durata, CEDOLARE_SECCA se il locatore opta per la cedolare, DA_REGISTRARE se il contratto lo dice; null se il testo non lo indica.',
].join('\n');

// ---------- estrazione del testo ----------
export async function extractText(buffer) {
  const r = await estraiTesto(buffer);
  let text = r.pagine.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const avvisi = [];
  if (r.ocr) avvisi.push(`Il PDF è una scansione: testo letto con OCR${r.ocr_lingua && r.ocr_lingua !== 'ita' ? ` (lingua ${r.ocr_lingua})` : ''}, possibili errori di lettura`);
  if (text.length > MAX_CHARS) { avvisi.push(`Testo del contratto molto lungo (${text.length.toLocaleString('it-IT')} caratteri): la lettura si ferma ai primi ${MAX_CHARS.toLocaleString('it-IT')}`); text = text.slice(0, MAX_CHARS); }
  if (!text.replace(/\s+/g, '').length) throw bad('Il PDF non contiene testo leggibile');
  return { text, chars: text.length, pages: r.n_pagine, ocr: r.ocr, avvisi };
}

// ---------- chiamata al modello ----------
export async function analyzeText(text, { userId } = {}) {
  if (mockEnabled()) return { extracted: mockExtract(text), model: 'mock' };
  if (!aiEnabled()) throw bad(AI_NOT_CONFIGURED);
  const user = `Testo del contratto di locazione (${text.length} caratteri):\n\n${text}`;
  const extracted = await askJson({ kind: 'lease_contract', system: SYSTEM, user, maxTokens: 3000, userId, query: 'scadenziario: lettura contratto di affitto', timeoutMs: 120_000 });
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) throw bad('Risposta del modello non interpretabile');
  return { extracted, model: suite.anthropic.model };
}

// ---------- estrattore finto per il collaudo (FINANCE_AI_MOCK=1, mai in produzione) ----------
// Riempie la stessa struttura da espressioni regolari sul testo: P.IVA, decorrenza, durata, canone, rate iniziali, deposito,
// fideiussione, IVA, ISTAT, registro. Serve a provare il flusso senza chiave Anthropic; il prompt reale resta quello sopra.
const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const itDate = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dateFrom = (s) => { const m = String(s || '').match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); return m ? itDate(m[1], m[2], m[3]) : null; };
const WORDS_NUM = { uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12, diciotto: 18 };
const toInt = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : WORDS_NUM[String(s).toLowerCase()] ?? null);
export function mockExtract(raw) {
  const t = raw.replace(/\s+/g, ' ');
  const conf = {};
  const set = (key, livello, citazione) => { conf[key] = { livello, citazione: String(citazione || '').slice(0, 200) }; };
  const out = { locatore: { ragione_sociale: null, piva: null, cf: null, indirizzo: null, pec: null, legale_rappresentante: null }, conduttore: { ragione_sociale: null, piva: null, cf: null },
    immobile: { indirizzo: null, cap: null, citta: null, provincia: null, descrizione: null, dati_catastali: null }, durata: { decorrenza: null, anni: null, rinnovo_anni: null, preavviso_mesi: null, scadenza: null },
    canone: { importo: null, periodo: null, iva: null, rate_iniziali_diverse: null, rate_iniziali: [], istat: { previsto: null, regola: null }, deposito: null, fideiussione: null, spese: null },
    registrazione: null, tipo_contratto: null, clausole_rilevanti: [], confidenza: conf };
  // locatore: "(LOCATORE) <nome>, C.F. x, P.IVA y con sede a <città> in <via>"
  let m = t.match(/LOCATORE\)\s*([^,]+?),\s*(?:C\.?F\.?\s*([A-Z0-9]{11,16}))?,?\s*(?:P\.?\s*IVA\s*(\d{11}))?\s*con sede (?:a|in)\s+([^,]+?)\s+in\s+(Via[^,]+?)(?:,|\s+nella)/i);
  if (m) { out.locatore.ragione_sociale = m[1].trim(); out.locatore.cf = m[2] || null; out.locatore.piva = m[3] || m[2] || null; out.locatore.indirizzo = `${m[5].trim()}, ${m[4].trim()}`; set('locatore.ragione_sociale', 'alta', m[0]); set('locatore.piva', 'alta', m[0]); set('locatore.indirizzo', 'media', m[0]); }
  m = t.match(/legale rappresentante\s+((?:Dr\.|Dott\.|Sig\.|Avv\.)?\s*[A-Z][a-zà-ü]+\s+[A-Z][a-zà-ü]+)/);
  if (m) { out.locatore.legale_rappresentante = m[1].trim(); set('locatore.legale_rappresentante', 'media', m[0]); }
  m = t.match(/alla\s+società\s+([A-Z][A-Z\s.]+?S\.?R\.?L\.?)[,\s].{0,80}?p\.?\s*iva\s*(\d{11})/i);
  if (m) { out.conduttore.ragione_sociale = m[1].replace(/\s+/g, ' ').trim(); out.conduttore.piva = m[2]; out.conduttore.cf = m[2]; set('conduttore.ragione_sociale', 'alta', m[0]); }
  m = t.match(/immobile sito (?:a|in)\s+([A-Za-zà-ü' ]+?)\s*\(([A-Z]{2})\)\s+in\s+(Via[^,]+?)\s+(p\.[^,]+?|piano[^,]+?)?,?\s*iscritto.{0,80}?(fgl\..{0,80}?cat\.\s*[A-Z]\/\d+)/i);
  if (m) { out.immobile.citta = m[1].trim(); out.immobile.provincia = m[2]; out.immobile.indirizzo = m[3].trim(); out.immobile.descrizione = (m[4] || '').trim() || null; out.immobile.dati_catastali = m[5].trim(); set('immobile.indirizzo', 'alta', m[0]); set('immobile.citta', 'alta', m[0]); set('immobile.dati_catastali', 'media', m[0]); }
  m = t.match(/durata di anni\s+(\d+)\s*(?:\([a-z]+\))?\s*con inizio dal\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:.{0,80}?rinnovazione tacita per ulteriori\s+(\w+)\s+anni)?/i);
  if (m) { out.durata.anni = Number(m[1]); out.durata.decorrenza = dateFrom(m[2]); out.durata.rinnovo_anni = toInt(m[3]); set('durata.anni', 'alta', m[0]); set('durata.decorrenza', 'alta', m[0]); if (m[3]) set('durata.rinnovo_anni', 'alta', m[0]); }
  m = t.match(/disdetta.{0,160}?(\w+)\s+mesi prima della scadenza/i);
  if (m) { out.durata.preavviso_mesi = toInt(m[1]); set('durata.preavviso_mesi', 'media', m[0]); }
  if (out.durata.decorrenza && out.durata.anni) out.durata.scadenza = toIso(addMonths(parseDate(out.durata.decorrenza), out.durata.anni * 12));
  m = t.match(/canone di locazione è stabilito.{0,160}?(?:Euro|€)\s*([\d.]+,\d{2}).{0,120}?rate\s+(mensili|trimestrali|semestrali|annuali).{0,80}?(?:Euro|€)\s*([\d.]+,\d{2})/i);
  if (m) { out.canone.importo = num(m[3]); out.canone.periodo = { mensili: 'MESE', trimestrali: 'TRIMESTRE', semestrali: 'SEMESTRE', annuali: 'ANNO' }[m[2].toLowerCase()]; set('canone.importo', 'alta', m[0]); set('canone.periodo', 'alta', m[0]); }
  else { m = t.match(/canone[^.]{0,120}?(?:Euro|€)\s*([\d.]+,\d{2})/i); if (m) { out.canone.importo = num(m[1]); out.canone.periodo = /mensil/i.test(m[0]) ? 'MESE' : /annu/i.test(m[0]) ? 'ANNO' : null; set('canone.importo', 'media', m[0]); } }
  // rate iniziali: "tra il 15 aprile 2026 ed il 30 aprile 2026 ... Euro 2.500,00" e "per il mese di Maggio 2026 ... Euro 5.000,00"
  const rate = [];
  for (const r of t.matchAll(/tra il (\d{1,2}) (\w+) (\d{4}) ed? il (\d{1,2}) (\w+) (\d{4}).{0,160}?(?:Euro|€)\s*([\d.]+,\d{2})/gi)) {
    const m1 = MESI[r[2].toLowerCase()], m2 = MESI[r[5].toLowerCase()];
    if (m1 && m2) rate.push({ dal: itDate(r[1], m1, r[3]), al: itDate(r[4], m2, r[6]), importo: num(r[7]), nota: r[0].slice(0, 160) });
  }
  for (const r of t.matchAll(/per il mese di (\w+) (\d{4}).{0,160}?(?:Euro|€)\s*([\d.]+,\d{2})/gi)) {
    const mm = MESI[r[1].toLowerCase()];
    if (mm) { const last = new Date(Date.UTC(Number(r[2]), mm, 0)).getUTCDate(); rate.push({ dal: itDate(1, mm, r[2]), al: itDate(last, mm, r[2]), importo: num(r[3]), nota: r[0].slice(0, 160) }); }
  }
  if (rate.length) { out.canone.rate_iniziali = rate; const mr = t.match(/Le parti concordano che per il periodo[^.]*\.[^.]*\./i); out.canone.rate_iniziali_diverse = (mr ? mr[0] : rate.map((r) => r.nota).join(' ')).slice(0, 600); set('canone.rate_iniziali', 'media', out.canone.rate_iniziali_diverse); }
  if (/esente iva/i.test(t)) { out.canone.iva = 'ESENTE'; set('canone.iva', 'alta', (t.match(/[^.]*esente iva[^.]*/i) || [''])[0]); }
  else if (/oltre iva|più iva|\+ ?iva/i.test(t)) { out.canone.iva = 'PIU_IVA'; set('canone.iva', 'media', (t.match(/[^.]*(oltre|più) iva[^.]*/i) || [''])[0]); }
  m = t.match(/ISTAT/i);
  if (m) { const frase = (t.match(/[^.]*ISTAT[^.]*\./i) || [''])[0]; out.canone.istat = { previsto: true, regola: frase.trim().slice(0, 300) }; set('canone.istat', 'media', frase); }
  m = t.match(/deposito cauzionale.{0,160}?(?:euro|€)\s*([\d.]+,\d{2})/i);
  if (m) { out.canone.deposito = num(m[1]); set('canone.deposito', 'alta', m[0]); }
  m = t.match(/fideiussoria.{0,160}?(?:euro|€)?\s*([\d.]+,\d{2})\s*(?:euro)?/i);
  if (m) { out.canone.fideiussione = num(m[1]); set('canone.fideiussione', 'media', m[0]); }
  m = t.match(/Nel canone non sono compresi[^.]*\./i);
  if (m) { out.canone.spese = m[0].slice(0, 300); set('canone.spese', 'media', m[0]); }
  m = t.match(/imposta di registro[^.]{0,80}?(50%|annual|ogni anno|unica soluzione|cedolare)/i);
  if (m) { out.registrazione = /cedolare/i.test(m[1]) ? 'CEDOLARE_SECCA' : /unica/i.test(m[1]) ? 'UNICA_SOLUZIONE' : 'IMPOSTA_ANNUALE'; set('registrazione', 'bassa', m[0]); }
  if (out.durata.anni === 6 && out.durata.rinnovo_anni === 6) out.tipo_contratto = 'COMMERCIALE_6_6';
  else if (out.durata.anni === 9) out.tipo_contratto = 'COMMERCIALE_9_9';
  else if (out.durata.anni && out.durata.anni * 12 < 18) out.tipo_contratto = 'TRANSITORIO';
  else if (/comodato/i.test(t)) out.tipo_contratto = 'COMODATO';
  else if (out.durata.anni) out.tipo_contratto = 'ALTRO';
  if (out.tipo_contratto) set('tipo_contratto', 'media', `durata ${out.durata.anni} anni, rinnovo ${out.durata.rinnovo_anni ?? 'non indicato'}`);
  for (const [k, re] of [['recesso', /[^.]*facoltà di recedere[^.]*\./i], ['manutenzioni', /[^.]*manutenzione (?:ordinaria|straordinaria)[^.]*\./i], ['sublocazione', /[^.]*sublo[^.]*\./i]]) { const c = t.match(re); if (c) out.clausole_rilevanti.push(`${k}: ${c[0].trim().slice(0, 240)}`); }
  return out;
}

// ---------- dal JSON letto ai campi del form e alle anagrafiche ----------
const PERIOD_MONTHS = { MESE: 1, TRIMESTRE: 3, SEMESTRE: 6, ANNO: 12 };
const dateOk = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDate(s) != null && toIso(parseDate(s)) === s ? s : null);
const n = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const KINDS = ['COMMERCIALE_6_6', 'COMMERCIALE_9_9', 'ABITATIVO_4_4', 'ABITATIVO_3_2', 'TRANSITORIO', 'COMODATO', 'ALTRO'];
const REGS = ['IMPOSTA_ANNUALE', 'UNICA_SOLUZIONE', 'CEDOLARE_SECCA', 'DA_REGISTRARE'];

// Scatti iniziali dalle rate iniziali diverse: ALTRO per i periodi ridotti, INIZIALE (importo a regime) dal primo giorno successivo
export function initialSteps(ex, lease) {
  const regime = n(lease.amount);
  const start = dateOk(lease.start_date);
  const rate = (ex?.canone?.rate_iniziali || []).map((r) => ({ dal: dateOk(r.dal), al: dateOk(r.al), importo: n(r.importo), nota: r.nota || null })).filter((r) => r.dal && r.importo != null).sort((a, b) => a.dal.localeCompare(b.dal));
  if (!start || regime == null) return [];
  if (!rate.length) return [{ valid_from: start, amount: regime, reason: 'INIZIALE', notes: null }];
  const steps = [];
  let lastEnd = null;
  for (const r of rate) {
    const from = r.dal < start ? start : r.dal;
    if (!steps.some((s) => s.valid_from === from)) steps.push({ valid_from: from, amount: r.importo, reason: 'ALTRO', notes: `Rata iniziale ridotta${r.al ? ` fino al ${r.al.split('-').reverse().join('/')}` : ''}${r.nota ? `: ${String(r.nota).slice(0, 160)}` : ''}` });
    if (r.al && (!lastEnd || r.al > lastEnd)) lastEnd = r.al;
  }
  const regimeFrom = lastEnd ? toIso(parseDate(lastEnd) + 86400000) : null;
  if (regimeFrom && !steps.some((s) => s.valid_from === regimeFrom)) steps.push({ valid_from: regimeFrom, amount: regime, reason: 'INIZIALE', notes: 'Canone a regime dal contratto' });
  else if (!regimeFrom) steps.push({ valid_from: start, amount: regime, reason: 'INIZIALE', notes: null });
  return steps.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

export async function buildProposal(ex, { avvisi = [] } = {}) {
  const out = { site_id: null, site_label: null, site_how: null, landlord_org_id: null, landlord_label: null, landlord_how: null, beneficiary_id: null, beneficiary_label: null, lease: {}, initial_steps: [] };
  const conf = ex?.confidenza && typeof ex.confidenza === 'object' ? ex.confidenza : {};
  const loc = ex?.locatore || {}, imm = ex?.immobile || {}, dur = ex?.durata || {}, can = ex?.canone || {};
  // sede TD: città e indirizzo dell'immobile, poi nome
  const site = await matchSite({ city: imm.citta, address: imm.indirizzo, names: [imm.indirizzo, imm.descrizione].filter(Boolean) });
  if (site) { out.site_id = site.id; out.site_label = `${site.name} (${site.code})`; out.site_how = site.how; }
  else if (imm.citta || imm.indirizzo) avvisi.push(`Nessuna sede dell'anagrafica abbinata all'immobile (${[imm.indirizzo, imm.citta].filter(Boolean).join(', ')}): scegli la sede a mano`);
  // locatore: Legal entity per P.IVA / CF / nome
  if (loc.ragione_sociale || loc.piva || loc.cf) {
    const org = await matchOrg({ vat_number: loc.piva, tax_code: loc.cf, name: loc.ragione_sociale });
    if (org) { out.landlord_org_id = org.id; out.landlord_label = org.name; out.landlord_how = org.how; }
    else avvisi.push(`Il locatore ${loc.ragione_sociale || loc.piva} non è tra le Legal entity dell'anagrafica: puoi crearlo dal contratto`);
    // beneficiario Payments per P.IVA / nome
    const vat = cfOrVat(loc.piva || loc.cf);
    const ben = (vat && await one(`SELECT id, name FROM beneficiaries WHERE regexp_replace(upper(coalesce(tax_id,'')), '[^A-Z0-9]', '', 'g') IN ($1, $2)`, [vat, `IT${vat}`]))
      || (loc.ragione_sociale && await one('SELECT id, name FROM beneficiaries WHERE lower(name)=lower($1)', [loc.ragione_sociale]));
    if (ben) { out.beneficiary_id = ben.id; out.beneficiary_label = ben.name; }
  } else avvisi.push('Locatore non riconosciuto nel testo: indicalo a mano');
  // conduttore diverso da Toscana Diagnostica
  const cond = ex?.conduttore || {};
  const tdVat = cfOrVat(suite.company?.vat || '');
  if (cond.ragione_sociale || cond.piva) {
    const isTd = /toscana\s+diagnostica/i.test(cond.ragione_sociale || '') || (tdVat && cfOrVat(cond.piva) === tdVat) || !!(await one(`SELECT 1 FROM public.organizations WHERE kind IN ('SOCIETA','GRUPPO') AND (regexp_replace(upper(coalesce(vat_number,'')), '[^A-Z0-9]', '', 'g') = $1 OR lower(name) = lower($2))`, [cfOrVat(cond.piva) || '-', cond.ragione_sociale || '-']));
    if (!isTd) avvisi.push(`Il conduttore letto è "${cond.ragione_sociale || cond.piva}": non risulta Toscana Diagnostica né una sua società, controlla il contratto`);
  }
  // campi del form
  const periodMonths = PERIOD_MONTHS[String(can.periodo || '').toUpperCase()] || 1;
  const lease = {
    site_id: out.site_id, landlord_org_id: out.landlord_org_id, landlord_name: out.landlord_org_id ? null : (loc.ragione_sociale || null), beneficiary_id: out.beneficiary_id,
    unit: [imm.indirizzo, imm.descrizione].filter(Boolean).join(' · ').slice(0, 200) || null,
    kind: KINDS.includes(ex?.tipo_contratto) ? ex.tipo_contratto : 'ALTRO',
    start_date: dateOk(dur.decorrenza), first_term_years: n(dur.anni), renewal_years: n(dur.rinnovo_anni) ?? 0, notice_months: n(dur.preavviso_mesi),
    period_months: periodMonths, first_due: null,
    amount: n(can.importo), deposit: n(can.deposito),
    registration: REGS.includes(ex?.registrazione) ? ex.registrazione : null,
    istat: !!(can.istat && (can.istat === true || can.istat.previsto === true)), auto_pay: false,
    notes: [can.iva ? `IVA: ${{ PIU_IVA: 'più IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente' }[can.iva] || can.iva}` : null, can.fideiussione != null ? `Fideiussione ${Number(can.fideiussione).toLocaleString('it-IT')} euro` : null, can.spese ? `Spese: ${String(can.spese).slice(0, 200)}` : null, imm.dati_catastali ? `Catasto: ${imm.dati_catastali}` : null, ...(Array.isArray(ex?.clausole_rilevanti) ? ex.clausole_rilevanti.slice(0, 5).map(String) : [])].filter(Boolean).join('\n').slice(0, 2000) || null,
  };
  out.lease = lease;
  out.initial_steps = initialSteps(ex, lease);
  if (out.initial_steps.some((s) => s.reason === 'ALTRO')) avvisi.push(`Rate iniziali diverse dal canone a regime: proposti ${out.initial_steps.length} scatti (${out.initial_steps.map((s) => `${s.valid_from.split('-').reverse().join('/')} ${Number(s.amount).toLocaleString('it-IT')} €`).join(', ')})`);
  // confidenza per campo del form (mappa dai campi letti) e avvisi sui campi a bassa confidenza
  const MAP = { site_id: ['immobile.indirizzo', 'immobile.citta'], landlord_org_id: ['locatore.ragione_sociale', 'locatore.piva'], landlord_name: ['locatore.ragione_sociale'], unit: ['immobile.indirizzo', 'immobile.descrizione'], kind: ['tipo_contratto'], start_date: ['durata.decorrenza'], first_term_years: ['durata.anni'], renewal_years: ['durata.rinnovo_anni'], notice_months: ['durata.preavviso_mesi'], period_months: ['canone.periodo'], amount: ['canone.importo'], deposit: ['canone.deposito'], registration: ['registrazione'], istat: ['canone.istat'] };
  const rank = { alta: 3, media: 2, bassa: 1 };
  out.confidence = {};
  for (const [field, keys] of Object.entries(MAP)) {
    const found = keys.map((k) => conf[k]).filter((c) => c && c.livello);
    if (!found.length) continue;
    const worst = found.sort((a, b) => (rank[a.livello] || 0) - (rank[b.livello] || 0))[0];
    out.confidence[field] = { level: worst.livello, quote: found.map((c) => c.citazione).filter(Boolean).join(' | ').slice(0, 400) };
  }
  const low = Object.entries(out.confidence).filter(([, c]) => c.level === 'bassa').map(([f]) => f);
  if (low.length) avvisi.push(`Campi letti con bassa confidenza, da verificare sul contratto: ${low.join(', ')}`);
  if (lease.amount == null) avvisi.push('Importo della rata non riconosciuto: indicalo a mano');
  if (!lease.start_date) avvisi.push('Decorrenza non riconosciuta: indicala a mano');
  return out;
}
