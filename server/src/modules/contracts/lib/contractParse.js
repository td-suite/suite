// Lettura di contratti già sottoscritti (PDF con testo, PDF scansionato via OCR, DOCX) e UNILAV:
// estrazione euristica dei dati della persona e del rapporto, con eventuale rifinitura via API Claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import PizZip from 'pizzip';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

// ---------------- Estrazione testo ----------------
export async function extractAnyText(buffer, mime, filename = '') {
  const lower = filename.toLowerCase();
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx')) return { text: docxText(buffer), method: 'docx', tables: docxTables(buffer) };
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    let text = '';
    // pdf-parse 1.x: caricato dal file della libreria, perché il suo index.js in assenza di module.parent (ESM) tenta di leggere un file di test
    try { const pdfParse = require('pdf-parse/lib/pdf-parse.js'); text = ((await pdfParse(buffer, { max: 10 })).text || '').trim(); } catch (e) { console.error('[parse] pdf-parse', e.message); }
    if (text.replace(/\s/g, '').length > 300) return { text, method: 'pdf' };
    const ocr = await ocrPdf(buffer);
    return { text: ocr, method: ocr ? 'ocr' : 'none' };
  }
  if (mime === 'text/plain') return { text: buffer.toString('utf8'), method: 'text' };
  return { text: '', method: 'none' };
}

function docxXml(buffer) { return new PizZip(buffer).file('word/document.xml')?.asText() || ''; }
function docxText(buffer) {
  const xml = docxXml(buffer);
  return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/[ \t]+\n/g, '\n');
}
function docxTables(buffer) {
  const xml = docxXml(buffer);
  const tables = [];
  for (const t of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
    const rows = [];
    for (const r of t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
      const cells = (r.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).map((c) => c.replace(/<\/w:p>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
      rows.push(cells);
    }
    tables.push(rows);
  }
  return tables;
}

export async function ocrAvailable() {
  try { await run('tesseract', ['--version']); await run('pdftoppm', ['-v']); return true; } catch { return false; }
}
async function ocrPdf(buffer) {
  if (!await ocrAvailable()) return '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-ocr-'));
  try {
    const pdf = path.join(dir, 'in.pdf'); fs.writeFileSync(pdf, buffer);
    await run('pdftoppm', ['-r', '170', '-gray', '-f', '1', '-l', '4', '-png', pdf, path.join(dir, 'p')]); // prime 4 pagine: i dati contrattuali stanno lì
    let lang = 'eng';
    try { const { stdout } = await run('tesseract', ['--list-langs']); if (/\bita\b/.test(stdout)) lang = 'ita'; } catch { /* eng */ }
    const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    let out = '';
    for (const p of pages) { const { stdout } = await run('tesseract', [path.join(dir, p), '-', '-l', lang, '--psm', '4'], { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, OMP_THREAD_LIMIT: '1' } }); out += stdout + '\n'; }
    return out.trim();
  } catch (e) { console.error('[parse] OCR fallito:', e.message); return ''; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------------- Utilità ----------------
const AMOUNT = '(\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d{2})?)';
const toNum = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[.\s]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const isoDate = (s) => { const m = String(s || '').match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/[|]/g, '').trim();
const deacc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const MONTHS_WORDS = { dodici: 12, tredici: 13, quattordici: 14, quindici: 15 };
const CF_RE = /\b([A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z])\b/;
const PROV_FIX = (p) => (p || '').toUpperCase().replace('FL', 'FI').replace('F1', 'FI');

function splitName(full) {
  const parts = clean(full).replace(/,$/, '').split(' ').filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] || null, last_name: null };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}
function sexFromCf(cf) { if (!cf) return null; const d = Number(cf.slice(9, 11)); return Number.isFinite(d) ? (d > 40 ? 'F' : 'M') : null; }

// ---------------- Riconoscimento del tipo di documento ----------------
export function detectKind(text) {
  const t = deacc(text).toLowerCase();
  if (/comunicazioni obbligatorie/.test(t) && /codice comunicazione/.test(t)) return 'UNILAV';
  if (/management by objectives|piano mbo|\bmbo\b/.test(t) && /obiettiv/.test(t) && !/lettera di assunzione/.test(t)) return 'MBO';
  if (/ccnl dirigenti|qualifica di dirigente/.test(t)) return 'CONTRATTO_DIRIGENTE';
  if (/lettera di impegno/.test(t)) return 'LETTERA_IMPEGNO';
  if (/prestazione professionale|libero professionista|partita iva/.test(t) && /tariffario|compens/.test(t)) return 'CONTRATTO_LP';
  if (/assunzione|rapporto di lavoro|contratto a tempo/.test(t)) return 'CONTRATTO';
  return 'SCONOSCIUTO';
}

// ---------------- Contratto / lettera di assunzione (format TD, dipendenti e dirigenti) ----------------
export function parseContract(text) {
  const T = text.replace(/\r/g, '').replace(/\(F[l1]\)/g, '(FI)').replace(/Societa\b/g, 'Società');
  const flat = T.replace(/\s+/g, ' ');
  const lines = T.split('\n').map((l) => l.trim()).filter(Boolean);
  const person = {}; const employment = {}; const notes = [];
  const dirigente = /ccnl dirigenti|qualifica di dirigente/i.test(deacc(flat));

  // Intestazione: nome, indirizzo, CAP città, CF, nascita
  const head = lines.slice(0, 12);
  const nameIdx = head.findIndex((l) => /^(egr\.?|gent\.?ma|gent\.le|spett\.le|dott\.ssa|dott\.|dr\.|sig\.ra|sig\.)/i.test(l) || (/^[A-ZÀ-Ü][a-zà-ü'’]+(\s+[A-ZÀ-Ü][a-zà-ü'’]+)+$/.test(l)));
  if (nameIdx >= 0) {
    const l = head[nameIdx];
    const title = (l.match(/dott\.ssa|dott\.|dr\.ssa|dr\.|sig\.ra|sig\./i) || [])[0] || null;
    const nm = l.replace(/^(egr\.?|gent\.?ma|gent\.le|spett\.le)\s*/i, '').replace(/dott\.ssa|dott\.|dr\.ssa|dr\.|sig\.ra|sig\./i, '').trim();
    Object.assign(person, splitName(nm)); if (title) person.title = title.toLowerCase();
    const addr = head[nameIdx + 1]; const cap = head[nameIdx + 2];
    if (addr && !/^C\.?F/i.test(addr) && !/^Nat/i.test(addr)) person.address = clean(addr);
    const m = (cap || '').match(/(\d{5})\s+(.+?)\s*\((\w{2})\)/);
    if (m) { person.zip = m[1].replace(/^9(\d{4})$/, '5$1'); person.city = clean(m[2]); person.province = PROV_FIX(m[3]); }
  }
  const cf = flat.match(CF_RE); if (cf) { person.tax_code = cf[1]; person.sex = sexFromCf(cf[1]); }
  const born = flat.match(/Nat([oa]) a\s+(.+?)\s+il\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (born) { person.sex = born[1].toLowerCase() === 'a' ? 'F' : 'M'; person.birth_place = clean(born[2]); person.birth_date = isoDate(born[3]); }
  const ltr = flat.match(/([A-Za-zÀ-ü'’ ]+?\s*\(\w{2}\))[;,]\s*(\d{1,2}\/\d{1,2}\/\d{4})/) || flat.match(/\b(Firenze|Sesto Fiorentino|Livorno)[;,]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (ltr) employment.letter_date = isoDate(ltr[2]);
  const start = flat.match(/(?:inizier[àa] il|a far data dal|con decorrenza dal)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (start) employment.start_date = isoDate(start[1]);
  const end = flat.match(/(?:fino al|sino al|scadenza(?: il)?)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (end && /tempo determinato/i.test(flat)) employment.end_date = isoDate(end[1]);

  employment.contract_type = dirigente ? 'DIRIGENTE' : /apprendistat/i.test(flat) ? 'APPRENDISTATO' : /tempo determinato/i.test(flat) ? 'TDET' : 'TIND';
  if (dirigente) {
    employment.level = 'DIRIGENTE'; employment.qualification = 'Dirigente'; employment.monthly_payments = 13;
    const role = flat.match(/ruolo e funzione di\s+([^.]{3,120}?)\s+della (?:scrivente )?Societ/i); if (role) employment.job_title = clean(role[1]);
    const rep = flat.match(/riporter[àa]\s+(.+?)(?:\s+[o0] ad altro|\.)/i); if (rep) employment.reports_to = clean(rep[1]);
    const pr = flat.match(/Periodo di prova:?\s*(.+?)(?:\s+\d\.\s|\s+Luogo di svolgimento)/i); employment.probation = pr ? clean(pr[1]) : 'Non richiesto';
    const ral = flat.match(new RegExp('di\\s*€\\s*' + AMOUNT + '\\s*\\(')); if (ral) employment.ral = toNum(ral[1]);
    const mens = flat.match(/in\s+(dodici|tredici|quattordici)\s+mensilit/i); if (mens) employment.monthly_payments = MONTHS_WORDS[mens[1].toLowerCase()];
    const minimo = flat.match(new RegExp('minimo tabellare pari a\\s*€\\s*' + AMOUNT)); if (minimo) notes.push(`Minimo contrattuale indicato nel contratto: € ${minimo[1]}`);
    const sede = flat.match(/uffici della Societ[àa], in\s+(.+?),\s+restando/i); if (sede) employment.work_site = clean(sede[1]);
    employment.autonomous_hours = true; employment.weekly_hours = 40; employment.weekly_days = 5;
    employment.mbo_enabled = /retribuzione variabile \(MBO\)|piano di MBO/i.test(flat);
    const pct = flat.match(/fino al\s+(\d+(?:,\d+)?)\s*%/i); if (pct) employment.mbo_pct = toNum(pct[1]);
    const ben = benefitsBetween(lines, /assegnati i seguenti beni/i, /^(In aggiunta|\d+\.\s|Assistenza Sanitaria)/i); if (ben.length) employment.benefits = ben;
  } else {
    const lv = flat.match(/Livello\s+(Q|1|2|3S|3|4S|4|5)\b/i); if (lv) employment.level = lv[1].toUpperCase();
    employment.qualification = employment.level === 'Q' ? 'Quadro' : 'Impiegato';
    const job = flat.match(/mansione sar[àa] di\s+(.+?)[;.]/i); if (job) employment.job_title = clean(job[1]);
    const hrs = flat.match(/(\d{1,2}(?:[.,]\d)?)\s*ore settimanali/i); if (hrs) employment.weekly_hours = toNum(hrs[1].replace('.', ','));
    const days = flat.match(/su\s+(\d)\s+giorni settimanali\s*(dal luned[ìi] al [a-zìi]+)?/i); if (days) { employment.weekly_days = Number(days[1]); if (days[2]) employment.days_label = clean(days[2]).toLowerCase(); }
    employment.autonomous_hours = /D\.?\s?Lgs\.?\s*66\/2003/i.test(flat) && /non [èe] soggett/i.test(flat);
    const ral = flat.match(new RegExp('retribuzione.*?sar[àa] di euro\\s*' + AMOUNT + '\\s*lordi annui', 'i')); if (ral) employment.ral = toNum(ral[1]);
    const mens = flat.match(/in\s+(\d{2}|dodici|tredici|quattordici)\s+mensilit/i); if (mens) employment.monthly_payments = MONTHS_WORDS[mens[1].toLowerCase()] || Number(mens[1]);
    const base = flat.match(new RegExp('Paga Base:?\\s*euro\\s*' + AMOUNT, 'i')); if (base) employment.base_pay = toNum(base[1]);
    const sup = flat.match(new RegExp('Superminimo( non)?( assorbibile)?:?\\s*euro\\s*' + AMOUNT, 'i')); if (sup) { employment.superminimo = toNum(sup[3]); employment.superminimo_absorbable = !sup[1]; }
    const fa = flat.match(new RegExp('Indennit[àa] di funzione:?\\s*euro\\s*' + AMOUNT, 'i')); if (fa) employment.function_allowance = toNum(fa[1]);
    const steps = [...flat.matchAll(new RegExp('con decorrenza\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s+la Sua retribuzione passer[àa] ad euro\\s*' + AMOUNT, 'gi'))].map((m) => ({ from: isoDate(m[1]), ral: toNum(m[2]) }));
    if (steps.length) employment.ral_steps = steps;
    const pct = flat.match(/premio per obiettivi \(MBO\) fino al\s+(\d+(?:,\d+)?)\s*%/i); if (pct) { employment.mbo_enabled = true; employment.mbo_pct = toNum(pct[1]); }
    const pr = flat.match(/Periodo di Prova:?\s*(.+?)(?=\s+Sede di Lavoro:|\s+Benefits)/i); if (pr) employment.probation = clean(pr[1]);
    const sede = flat.match(/Sede di Lavoro:?\s*(.+?)(?=\s+Benefits|\s+Per svolgere|\.\s+[A-Z])/i); if (sede) employment.work_site = clean(sede[1]).replace(/\.$/, '');
    const ben = benefitsBetween(lines, /benefits e\/o dotazioni di lavoro:/i, /^(Nel rispetto|Le ricordiamo|Il rapporto|La preghiamo|Con i migliori|\d+\.\s)/i); if (ben.length) employment.benefits = ben;
    employment.smart_working = /lavoro agile|smart working/i.test(flat);
  }
  if (!person.last_name) notes.push('Nome non riconosciuto nell\'intestazione');
  if (!employment.ral) notes.push('RAL non riconosciuta');
  if (!employment.start_date) notes.push('Data di assunzione non riconosciuta');
  return { kind: 'DIPENDENTE', person, employment, notes };
}

function benefitsBetween(lines, startRe, stopRe) {
  const i = lines.findIndex((l) => startRe.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1, i + 14)) {
    if (stopRe.test(l) || /:$/.test(l)) break;
    const t = clean(l).replace(/^[•\-–*·]\s*/, '').replace(/^[a-z]\.\s+/, '').replace(/[;.]$/, '');
    if (t.length > 2 && t.length < 160 && !/^(Periodo|Sede)/i.test(t)) out.push(t);
  }
  return out;
}

// ---------------- Piano MBO ----------------
export function parseMbo(text, tables = []) {
  const flat = text.replace(/\s+/g, ' ');
  const mbo = { mbo_enabled: true };
  const notes = [];
  const yr = flat.match(/Esercizio\s+(\d{4})/i) || flat.match(/per l[’']esercizio\s+(\d{4})/i); if (yr) mbo.mbo_year = Number(yr[1]);
  const pct = flat.match(/pari al\s+(\d+(?:,\d+)?)\s*% della Retribuzione/i); if (pct) mbo.mbo_pct = toNum(pct[1]);
  const fixed = flat.match(new RegExp('premio MBO per l[’\']Anno \\d{4} [èe] pari a\\s*' + AMOUNT + '\\s*euro', 'i')); if (fixed) mbo.mbo_fixed_amount = toNum(fixed[1]);
  const lbl = flat.match(/\b(Top Management|Middle Management|Management)\s*-\s*Esercizio/i); if (lbl) mbo.mbo_label = lbl[1];
  const dt = flat.match(/\((?:FI|PO|LI)\),\s*(\d{1,2}\/\d{1,2}\/\d{4})/); if (dt) mbo.letter_date = isoDate(dt[1]);
  const att = flat.match(/Alla cortese attenzione di\s+(.+?)\s+(SEDE|Via|Piazza)/i); const person = att ? splitName(att[1]) : {};
  // Tabella obiettivi (DOCX): intestazione Area | Obiettivo | KPI | Target | Peso
  const tbl = tables.find((t) => t[0] && /area/i.test(t[0][0] || '') && /peso/i.test(t[0][t[0].length - 1] || ''));
  const objectives = [];
  if (tbl) for (const r of tbl.slice(1)) if (r.length >= 5 && r[1]) objectives.push({ area: r[0], objective: r[1], kpi: r[2], target: r[3], weight: toNum((r[4] || '').replace('%', '')) });
  if (!objectives.length) {
    // PDF: righe "… NN%" in sequenza dopo l'intestazione della tabella (approssimazione)
    const seg = flat.split(/Peso\b/i)[1] || '';
    const rows = [...seg.matchAll(/([A-ZÀ-Ü][^%]{15,220}?)\s(\d{1,3})\s?%/g)].slice(0, 8);
    for (const m of rows) { if (/criteri di valutazione/i.test(m[1])) break; objectives.push({ area: '', objective: clean(m[1]), kpi: '', target: '', weight: Number(m[2]) }); }
    if (objectives.length) notes.push('Obiettivi letti dal PDF: area, KPI e target da sistemare a mano');
  }
  if (objectives.length) mbo.mbo_objectives = objectives;
  const ind = objectives.find((o) => /individual/i.test(o.area || '') || /individual/i.test(o.objective || '')); if (ind) mbo.mbo_individual = ind.objective;
  return { kind: 'DIPENDENTE', person, employment: mbo, notes };
}

// ---------------- UNILAV (comunicazione obbligatoria) ----------------
export function parseUnilav(text) {
  const raw = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = [];
  for (let i = 0; i < raw.length; i++) { // etichette spezzate su due righe ("Comune di" + "domicilio:")
    if (!/:$/.test(raw[i]) && raw[i + 1] && /^[a-zà-ü].*:$/.test(raw[i + 1]) && raw[i].length < 30) { lines.push(`${raw[i]} ${raw[i + 1]}`); i++; } else lines.push(raw[i]);
  }
  const get = (label, from = 0) => { const i = lines.findIndex((l, k) => k >= from && deacc(l).toLowerCase().startsWith(deacc(label).toLowerCase())); if (i < 0) return null; const same = lines[i].slice(label.length).replace(/^:/, '').trim(); if (same) return same; const nx = lines[i + 1] || ''; return /:$/.test(nx) ? null : nx; };
  const idxLav = lines.findIndex((l) => /^Lavoratore$/i.test(l));
  const person = {
    tax_code: get('Codice fiscale', idxLav), sex: get('Sesso', idxLav), last_name: cap(get('Cognome', idxLav)), first_name: cap(get('Nome', idxLav)),
    birth_place: cap(get('Comune di nascita', idxLav)), birth_date: isoDate(get('Data di nascita', idxLav)),
    zip: get('CAP domicilio', idxLav), city: cap(get('Comune di domicilio', idxLav) || get('Comune di', idxLav)), address: cap(get('Indirizzo di domicilio', idxLav) || get('Indirizzo di', idxLav)),
  };
  const tipo = (get('Tipologia contrattuale') || '').toUpperCase();
  const employment = {
    start_date: isoDate(get('Data inizio rapporto')), end_date: isoDate(get('Data fine rapporto')),
    contract_type: /DETERMINATO/.test(tipo) && !/INDETERMINATO/.test(tipo) ? 'TDET' : /APPRENDIST/.test(tipo) ? 'APPRENDISTATO' : 'TIND',
    weekly_hours: toNum(get('Ore settimali medie') || get('Ore settimanali medie')) || 40,
    ral: toNum(get('Retribuzione / Compenso')), unilav_ref: get('Codice comunicazione'),
  };
  const lv = (get('Livello di inquadramento') || '').trim();
  if (/quadro/i.test(lv)) employment.level = 'Q'; else if (/dirigent/i.test(lv) || /DIRIGENTI/.test((get('Contratto collettivo applicato') || '').toUpperCase())) employment.contract_type = 'DIRIGENTE'; else { const m = lv.match(/\b(1|2|3S|3|4S|4|5)\b/i); if (m) employment.level = m[1].toUpperCase(); }
  const note = get('Note'); const mans = (note || '').match(/MANSIONE CORRETTA:\s*(.+)/i);
  employment.job_title = mans ? clean(mans[1]) : cap(get('Qualifica professionale'));
  if (/PART/i.test(get('Tipo orario') || '')) employment.weekly_hours = employment.weekly_hours || 20;
  return { kind: 'DIPENDENTE', person, employment, notes: ['Dati letti dalla comunicazione UNILAV: la RAL indicata è quella comunicata al Centro per l\'Impiego'] };
}
function cap(s) { if (!s) return null; return clean(s).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }

// ---------------- Rifinitura con API Claude (facoltativa) ----------------
export async function refineWithAi(text, kind) {
  if (!config.anthropicKey || !text) return null;
  const schema = kind === 'MBO'
    ? '{"mbo_year": 2026, "mbo_pct": 10, "mbo_fixed_amount": null, "mbo_label": "Top Management", "letter_date": "YYYY-MM-DD", "mbo_objectives": [{"area": "", "objective": "", "kpi": "", "target": "", "weight": 25}]}'
    : '{"person": {"first_name": "", "last_name": "", "title": "dott.", "sex": "M|F", "birth_place": "", "birth_date": "YYYY-MM-DD", "tax_code": "", "address": "", "zip": "", "city": "", "province": "FI"}, "employment": {"contract_type": "TIND|TDET|APPRENDISTATO|DIRIGENTE", "level": "Q|1|2|3S|3|4S|4|5|DIRIGENTE", "qualification": "", "job_title": "", "reports_to": "", "start_date": "YYYY-MM-DD", "end_date": null, "letter_date": "YYYY-MM-DD", "weekly_hours": 40, "weekly_days": 5, "autonomous_hours": true, "ral": 0, "monthly_payments": 14, "base_pay": 0, "superminimo": 0, "superminimo_absorbable": true, "function_allowance": 0, "ral_steps": [{"from": "YYYY-MM-DD", "ral": 0}], "probation": "", "work_site": "", "benefits": [""], "mbo_enabled": false, "mbo_pct": null, "smart_working": false}}';
  const prompt = `Estrai i dati dal seguente ${kind === 'MBO' ? 'piano MBO' : 'contratto di lavoro'} italiano (il testo può provenire da OCR, correggi gli errori evidenti). Rispondi SOLO con un JSON con questa forma, usando null per i dati assenti, importi come numeri (es. 90000), date ISO:\n${schema}\n\nTESTO:\n${text.slice(0, 14000)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = (data.content || []).map((c) => c.text || '').join('');
    const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch (e) { console.error('[parse] AI', e.message); return null; }
}

const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v; return out; };

/** Punto di ingresso: riconosce il documento ed estrae i dati; con API Claude rifinisce il risultato. */
export async function parseDocument(buffer, mime, filename) {
  const { text, method, tables } = await extractAnyText(buffer, mime, filename);
  if (!text) return { detected: 'SCONOSCIUTO', method, person: {}, employment: {}, notes: ['Nessun testo leggibile nel file (se è una scansione, serve l\'OCR sul server)'] };
  const detected = detectKind(text);
  let out;
  if (detected === 'UNILAV') out = parseUnilav(text);
  else if (detected === 'MBO') out = parseMbo(text, tables);
  else if (detected === 'CONTRATTO' || detected === 'CONTRATTO_DIRIGENTE') out = parseContract(text);
  else out = { kind: 'DIPENDENTE', person: {}, employment: {}, notes: ['Formato non riconosciuto: nessun dato estratto'] };
  if (detected === 'MBO' || detected === 'CONTRATTO' || detected === 'CONTRATTO_DIRIGENTE') {
    const ai = await refineWithAi(text, detected === 'MBO' ? 'MBO' : 'CONTRATTO');
    if (ai) {
      if (detected === 'MBO') out.employment = merge(out.employment, ai);
      else { out.person = merge(out.person, ai.person); out.employment = merge(out.employment, ai.employment); }
      out.notes.push('Dati rifiniti con API Claude');
    }
  }
  return { detected, method, ...out, text_excerpt: text.slice(0, 600) };
}
