// Costruzione dei dati per i template documentali
import { itDate, r2 } from './util.js';
import { decompose, decomposeDirigente } from './payroll.js';

export const eurIt = (n) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(Number(n || 0));
const dateLong = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const LEVEL_LABEL = { Q: 'Quadro', 1: '1° livello', 2: '2° livello', '3S': '3° livello Super', 3: '3° livello', '4S': '4° livello Super', 4: '4° livello', 5: '5° livello' };

export const fullName = (r) => `${r.first_name} ${r.last_name}`.trim();

// Segnaposto per i dati non ancora inseriti: restano visibili nel DOCX/PDF come [ETICHETTA] e sono elencati tra i campi mancanti.
export const PH = (label) => `[${String(label).toUpperCase()}]`;
export const isPlaceholder = (v) => typeof v === 'string' && /\[[^\]]+\]/.test(v);
const txt = (v, label) => (v != null && String(v).trim() !== '' ? String(v) : PH(label));
const dateOr = (iso, label) => (iso ? itDate(iso) : PH(label));
const dateLongOr = (iso, label) => (iso ? dateLong(iso) : PH(label));
const moneyOr = (n, label) => (n != null && Number(n) > 0 ? eurIt(n) : PH(label));
/** Elenco dei segnaposto rimasti nei dati (ricorsivo). */
export function missingFields(data) {
  const out = new Set();
  const walk = (v) => { if (typeof v === 'string') { for (const m of v.matchAll(/\[([^\]]+)\]/g)) out.add(m[1]); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(data);
  return [...out];
}
const female = (r) => r.sex === 'F';
const g = (r, f, m) => (female(r) ? f : m);

function workHoursClause(r, autonomous) {
  if (!autonomous) return '';
  return ` Le precisiamo che, ai sensi del D.Lgs. 66/2003, in virtù degli incarichi professionali a Lei attribuiti, che comportano determinazione autonoma del Suo tempo di lavoro, Lei non è ${g(r, 'soggetta', 'soggetto')} ai limiti massimi dell’orario di lavoro.`;
}

function ralStepsSentence(steps) {
  const s = (steps || []).filter((x) => x.from && Number(x.ral) > 0).sort((a, b) => a.from.localeCompare(b.from));
  return s;
}

export function contractData({ resource: r, employment: e, settings: S, letterDate }) {
  const monthly = Number(e.monthly_payments || 14);
  const hasRal = Number(e.ral) > 0;
  const dec = hasRal ? decompose(e.ral, monthly, e.base_pay, Number(S.function_allowance_share || 0.7)) : { base_pay: 0, superminimo: 0, function_allowance: 0, ral_monthly: 0 };
  const basePay = e.base_pay != null ? Number(e.base_pay) : dec.base_pay;
  const superminimo = e.superminimo != null ? Number(e.superminimo) : dec.superminimo;
  const allowance = e.function_allowance != null ? Number(e.function_allowance) : dec.function_allowance;
  const voci = hasRal ? [{ label: 'Paga Base', importo: eurIt(basePay) }] : [{ label: 'Paga Base', importo: PH('paga base') }, { label: 'Superminimo', importo: PH('superminimo') }, { label: 'Indennità di funzione', importo: PH('indennità di funzione') }];
  if (hasRal && superminimo > 0) voci.push({ label: e.superminimo_absorbable ? 'Superminimo assorbibile' : 'Superminimo non assorbibile', importo: eurIt(superminimo) });
  if (hasRal && allowance > 0) voci.push({ label: 'Indennità di funzione', importo: eurIt(allowance) });
  const partTime = Number(e.weekly_hours) < 40;
  const benefits = (e.benefits || []).filter(Boolean).map((b) => String(b).replace(/[;.]\s*$/, '') + ';');
  if (benefits.length) benefits[benefits.length - 1] = benefits[benefits.length - 1].replace(/;$/, '.');
  const hasProbation = !e.probation || !/^nessun/i.test(e.probation.trim());
  return {
    nome_completo: fullName(r),
    indirizzo: txt(r.address, 'indirizzo'),
    cap_citta: r.zip || r.city ? [r.zip, r.city, r.province ? `(${r.province})` : ''].filter(Boolean).join(' ') : PH('cap e città'),
    nato_a: g(r, 'Nata a', 'Nato a'),
    luogo_nascita: txt(r.birth_place, 'luogo di nascita'),
    data_nascita: dateOr(r.birth_date, 'data di nascita'),
    cf: txt(r.tax_code, 'codice fiscale'),
    tipo_contratto: e.contract_type === 'TDET' ? 'determinato' : 'indeterminato',
    regime_orario: partTime ? 'part-time' : 'full-time',
    regime_frase: partTime ? ' full time, riproporzionata per il numero di ore contrattualizzate,' : '',
    prova_premessa: hasProbation ? ', previo superamento del periodo di prova sotto riportato per le mansioni di seguito indicate,' : '',
    citta_lettera: S.letter_city || 'Firenze',
    data_lettera: itDate(letterDate || e.letter_date || new Date().toISOString().slice(0, 10)),
    data_assunzione: dateOr(e.start_date, 'data di assunzione'),
    inquadrato: g(r, 'inquadrata', 'inquadrato'),
    livello: e.level === 'Q' ? 'Quadro' : txt(e.level, 'livello'),
    mansione: txt(e.job_title, 'mansione'),
    ore_settimanali: String(Number(e.weekly_hours || 40)).replace('.', ','),
    giorni_settimanali: String(e.weekly_days || 5),
    giorni_label: e.days_label || 'dal lunedì al venerdì',
    clausola_orario: workHoursClause(r, e.autonomous_hours),
    ral: moneyOr(e.ral, 'ral'),
    mensilita: String(monthly),
    ral_mensile: hasRal ? eurIt(dec.ral_monthly) : PH('ral mensile'),
    composta_intro: ', e sarà così composta:',
    voci,
    scatti: ralStepsSentence(e.ral_steps).map((s) => ({ dal: itDate(s.from), ral: eurIt(s.ral) })),
    mbo: e.mbo_enabled ? [{ mbo_frase: mboClause(e) }] : [],
    periodo_prova: txt(e.probation, 'periodo di prova'),
    sede_lavoro: e.work_site || S.company_address || PH('sede di lavoro'),
    has_benefits: benefits.length > 0,
    benefits,
  };
}

export function mboData({ resource: r, employment: e, settings: S, letterDate }) {
  const year = e.mbo_year || new Date().getFullYear();
  const objectives = (e.mbo_objectives || []).map((o) => ({ area: o.area || '', obiettivo: o.objective || '', kpi: o.kpi || '', target: o.target || '', peso: String(o.weight ?? '') }));
  return {
    nome_completo: fullName(r),
    firmatario: signatoryFor(r, S).name,
    destinatari_label: e.mbo_label || 'Top Management',
    anno: String(year),
    anno_succ: String(year + 1),
    mbo_pct: Number(e.mbo_pct) > 0 ? String(Number(e.mbo_pct)).replace('.', ',') : (Number(e.mbo_amount) > 0 && Number(e.ral) ? String(Math.round(Number(e.mbo_amount) / Number(e.ral) * 10000) / 100).replace('.', ',') : PH('% mbo')),
    premio_frase: mboClause(e, 'piano'),
    luogo_data: `${S.letter_city || 'Firenze'} (FI), ${itDate(letterDate || e.letter_date || new Date().toISOString().slice(0, 10))}`,
    obiettivi: objectives.length ? objectives : [{ area: PH('area'), obiettivo: PH('obiettivo'), kpi: PH('kpi'), target: PH('target'), peso: PH('peso') }],
  };
}

export function commitmentData({ resource: r, letter: l, settings: S }) {
  const steps = ralStepsSentence(l.ral_steps);
  let ralScatti = '';
  if (steps.length) {
    const first = steps[0];
    const dayBefore = new Date(`${first.from}T12:00:00`); dayBefore.setDate(dayBefore.getDate() - 1);
    ralScatti = ` fino al ${itDate(dayBefore.toISOString().slice(0, 10))}`;
    steps.forEach((s) => { ralScatti += `. A decorrere dal ${itDate(s.from)}, la Sua retribuzione lorda annua sarà di euro ${eurIt(s.ral)}`; });
  }
  const level = String(l.level || '');
  return {
    nome_completo: fullName(r),
    firmatario: S.signatory_name || '',
    tipo_contratto: l.contract_type === 'TDET' ? 'determinato' : 'indeterminato',
    data_inizio_max: dateLongOr(l.start_by, 'data massima di decorrenza'),
    sede_lavoro: l.work_site || S.company_address,
    assunto: g(r, 'assunta', 'assunto'),
    qualifica: l.qualification || (level === 'Q' ? 'Quadro' : 'Impiegato'),
    livello_label: LEVEL_LABEL[level] || level || PH('livello'),
    mansione: txt(l.job_title, 'mansione'),
    orario_frase: Number(l.weekly_hours) < 40 ? 'un part-time' : 'quello contrattualmente previsto per i lavoratori a tempo pieno',
    ore_settimanali: String(Number(l.weekly_hours || 40)).replace('.', ','),
    clausola_orario: workHoursClause(r, l.autonomous_hours),
    ral: moneyOr(l.ral, 'ral'),
    ral_scatti: ralScatti,
    mbo_frase: l.mbo_enabled ? ` Per lo specifico ruolo Le potrà essere riconosciuto un premio per obiettivi (MBO) fino al ${String(Number(l.mbo_pct || 0)).replace('.', ',')}% della RAL, disciplinato da specifico accordo annuale.` : '',
    inviata: g(r, 'inviata', 'inviato'),
    validita: dateLongOr(l.valid_until, 'validità della proposta'),
    luogo_data: `${S.letter_city || 'Firenze'} (FI), ${dateOr(l.letter_date, 'data della lettera')}`,
  };
}

const FEE_UNIT = { FISSO: '/mese', ORARIO: '/ora', PRESTAZIONE: '/cad', VARIABILE: '' };
const VAT_LABEL = { CON: ' oltre IVA', SENZA: ' IVA non applicata' };
export function feeLabel(f) {
  const vat = VAT_LABEL[f.vat] || '';
  if (f.type === 'VARIABILE') return `${String(Number(f.amount || 0)).replace('.', ',')}%${vat}`;
  const unit = f.unit ? `/${f.unit}` : (FEE_UNIT[f.type] || '');
  return `€ ${eurIt(f.amount)}${unit}${vat}`;
}

export function lpData({ resource: r, lp, settings: S, letterDate }) {
  const title = (r.title || (female(r) ? 'dott.ssa' : 'dott.')).trim();
  const art = female(r) ? 'la' : 'il';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const residenza = r.city || r.address ? [r.city, r.province ? `(${r.province})` : '', r.address ? `, ${r.address}` : ''].filter(Boolean).join(' ').replace(' ,', ',') : PH('residenza');
  const ordine = lp.order_name ? [lp.order_name, lp.order_province ? `di ${lp.order_province}` : ''].filter(Boolean).join(' ') : PH('ordine professionale');
  const date = letterDate || lp.letter_date || new Date().toISOString().slice(0, 10);
  return {
    art_titolo: `${art} ${title}`,
    Art_titolo: `${cap(art)} ${title}`,
    Titolo: cap(title),
    Il_sottoscritto: female(r) ? 'La sottoscritta' : 'Il sottoscritto',
    nome_completo: fullName(r),
    firmatario: S.signatory_name || '',
    luogo_data: `${S.letter_city || 'Firenze'} (FI), ${itDate(date)}`,
    citta: S.letter_city || 'Firenze',
    data_lettera: itDate(date),
    data_stipula: itDate(lp.start_date || date),
    sede_legale: S.company_legal_address || S.company_address,
    nato: g(r, 'nata', 'nato'),
    domiciliato: g(r, 'domiciliata', 'domiciliato'),
    data_nascita: dateOr(r.birth_date, 'data di nascita'),
    luogo_nascita: txt(r.birth_place, 'luogo di nascita'),
    residenza,
    cf: txt(r.tax_code, 'codice fiscale'),
    piva: txt(r.vat_number, 'partita iva'),
    titoli: (lp.degrees || []).filter(Boolean).length ? (lp.degrees || []).filter(Boolean).map((t) => String(t).replace(/;?$/, ';')) : [PH('titoli di studio')],
    ordine,
    ordine_numero: txt(lp.order_number, 'numero di iscrizione'),
    ordine_dal: dateOr(lp.order_since, 'data di iscrizione'),
    oggetto_prestazione: lp.role_description || `la consulenza sanitaria negli ambiti per cui il Professionista è abilitato`,
    attivita: (lp.activities || []).filter(Boolean).length ? (lp.activities || []).filter(Boolean) : [PH('attività')],
    data_inizio: dateOr(lp.start_date, 'data di inizio'),
    data_fine: dateOr(lp.end_date, 'data di fine'),
    preavviso: `${lp.notice_days || 30} (${numberWords(lp.notice_days || 30)})`,
    massimale: lp.insurance_required ? `${eurIt(lp.insurance_required)}` : PH('massimale rc'),
    tariffe: (lp.fees || []).length ? (lp.fees || []).map((f) => ({ codice: f.code || '-', descrizione: f.description || PH('descrizione'), categoria: f.category || '', tariffa: f.amount ? feeLabel(f) : PH('compenso'), note: f.notes || '-' })) : [{ codice: '-', descrizione: PH('descrizione prestazione'), categoria: '', tariffa: PH('compenso'), note: '-' }],
  };
}

function numberWords(n) {
  const w = { 15: 'quindici', 30: 'trenta', 45: 'quarantacinque', 60: 'sessanta', 90: 'novanta', 120: 'centoventi', 180: 'centottanta' };
  return w[n] || String(n);
}

export const money = r2;


// ---------- Numeri in lettere (italiano), per gli importi dei contratti dirigenziali ----------
const UNITS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
function below1000(n) {
  let out = '';
  const h = Math.floor(n / 100); const rest = n % 100;
  if (h) out += (h === 1 ? 'cento' : UNITS[h] + 'cento');
  if (rest < 20) out += UNITS[rest];
  else {
    const t = Math.floor(rest / 10); const u = rest % 10;
    let tw = TENS[t];
    if (u === 1 || u === 8) tw = tw.slice(0, -1);
    out += tw + UNITS[u];
  }
  return out;
}
export function numberToWordsIt(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'zero';
  let out = '';
  const millions = Math.floor(n / 1e6); const thousands = Math.floor((n % 1e6) / 1000); const rest = n % 1000;
  if (millions) out += millions === 1 ? 'unmilione' : below1000(millions) + 'milioni';
  if (thousands) out += thousands === 1 ? 'mille' : below1000(thousands) + 'mila';
  if (rest) out += below1000(rest);
  return out;
}
const MONTHLY_WORDS = { 12: 'dodici', 13: 'tredici', 14: 'quattordici', 15: 'quindici' };

/** Frase del premio MBO: cifra fissa annua se valorizzata, altrimenti percentuale della RAL. */
export function mboClause(e, mode = 'contratto') {
  const amount = Number(e.mbo_amount) || 0; const pct = Number(e.mbo_pct) || 0;
  if (mode === 'piano') {
    if (amount) return `pari a € ${eurIt(amount)} lordi annui`;
    if (pct) return `pari al ${String(pct).replace('.', ',')}% della Retribuzione Annua Lorda (RAL) del destinatario`;
    return `pari a ${PH('importo o % mbo')}`;
  }
  if (amount) return `fino a € ${eurIt(amount)} lordi annui`;
  if (pct) return `fino al ${String(pct).replace('.', ',')}% della RAL`;
  return `fino a ${PH('importo o % mbo')}`;
}

/** Chi firma per la Società: il firmatario standard, oppure il consigliere delegato quando il destinatario è il firmatario stesso. */
export function signatoryFor(r, S) {
  const std = (S.signatory_name || '').trim().toLowerCase();
  const me = `${r.first_name} ${r.last_name}`.trim().toLowerCase();
  if (std && me === std) return { name: S.board_signatory_name || PH('firmatario'), title: S.board_signatory_title || 'Un Consigliere di Amministrazione' };
  return { name: S.signatory_name || PH('firmatario'), title: S.signatory_title || '' };
}

/** Lettera di assunzione dirigente (CCNL Dirigenti Industria): minimo contrattuale di garanzia + superminimo, 13 mensilità, FASI e Previndai. */
export function dirigenteData({ resource: r, employment: e, settings: S, letterDate }) {
  const monthly = Number(e.monthly_payments || S.dirigenti_monthly_payments || 13);
  const hasRal = Number(e.ral) > 0;
  const dec = decomposeDirigente(e.ral, S, monthly);
  const title = (r.title || (female(r) ? 'dott.ssa' : 'dott.')).trim();
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const benefits = (e.benefits || []).filter(Boolean).map((b) => String(b).replace(/[;.]\s*$/, ''));
  const sign = signatoryFor(r, S);
  return {
    Egr_titolo: `${g(r, 'Gent.ma', 'Egr.')} ${title}`,
    Egregio: g(r, 'Gentile', 'Egregio'),
    Titolo: cap(title),
    nome_completo: fullName(r),
    indirizzo: txt(r.address, 'indirizzo'),
    cap_citta: r.zip || r.city ? [r.zip, r.city, r.province ? `(${r.province})` : ''].filter(Boolean).join(' ') : PH('cap e città'),
    cf: txt(r.tax_code, 'codice fiscale'),
    nato_a: g(r, 'Nata a', 'Nato a'),
    luogo_nascita: txt(r.birth_place, 'luogo di nascita'),
    data_nascita: dateOr(r.birth_date, 'data di nascita'),
    citta_lettera: `${S.letter_city || 'Sesto Fiorentino'} (FI)`,
    data_lettera: itDate(letterDate || e.letter_date || new Date().toISOString().slice(0, 10)),
    data_assunzione: dateOr(e.start_date, 'data di assunzione'),
    assunto: g(r, 'verrà assunta', 'verrà assunto'),
    inquadrato: g(r, 'inquadrata', 'inquadrato'),
    mansione: txt(e.job_title, 'ruolo e funzione'),
    riporta_a: e.reports_to ? e.reports_to : 'al Presidente del Consiglio di Amministrazione della scrivente Società',
    periodo_prova: e.probation && !/^non richiest|^nessun/i.test(e.probation) ? e.probation : 'non richiesta',
    sede_lavoro: e.work_site || S.company_address || PH('sede di lavoro'),
    ral: moneyOr(e.ral, 'retribuzione annua'),
    ral_lettere: hasRal ? numberToWordsIt(e.ral) : PH('importo in lettere'),
    mensilita_lettere: MONTHLY_WORDS[monthly] || String(monthly),
    minimo_dirigenti: eurIt(dec.minimum_annual),
    mbo: e.mbo_enabled ? [{ mbo_frase: mboClause(e).replace('della RAL', 'della retribuzione fissa') }] : [],
    has_benefits: benefits.length > 0,
    benefits,
    firmatario: sign.name,
    firmatario_qualifica: sign.title,
  };
}

/** Piano MBO dirigente: premio in cifra (pct della retribuzione fissa), periodo pro rata se l'assunzione è in corso d'anno. */
export function mboDirigenteData({ resource: r, employment: e, settings: S, letterDate }) {
  const year = e.mbo_year || new Date().getFullYear();
  const objectives = (e.mbo_objectives || []).map((o) => ({ area: o.area || '', obiettivo: o.objective || '', kpi: o.kpi || '', target: o.target || '', peso: String(o.weight ?? '') }));
  const start = e.start_date && e.start_date.slice(0, 4) === String(year) && e.start_date.slice(5) !== '01-01' ? e.start_date : null;
  const periodo = start ? `la porzione del ${year} (${dateLong(start)} – 31 dicembre ${year})` : `l’anno solare ${year} (1° gennaio ${year} – 31 dicembre ${year})`;
  let pct = Number(e.mbo_pct) || 0;
  let premio = Number(e.mbo_amount) || 0; // cifra fissa: prevale e non viene riproporzionata
  if (!premio && pct && Number(e.ral)) { premio = Number(e.ral) * pct / 100; if (start) { const d0 = new Date(`${start}T12:00:00`); premio = premio * (12 - d0.getMonth()) / 12; } }
  if (premio && !pct && Number(e.ral)) pct = Math.round(premio / Number(e.ral) * 10000) / 100;
  const sign = signatoryFor(r, S);
  return {
    nome_completo: fullName(r),
    firmatario: sign.name,
    destinatari_label: e.mbo_label || 'Top Management',
    anno: String(year),
    anno_succ: String(year + 1),
    mbo_pct: pct ? String(pct).replace('.', ',') : PH('% mbo'),
    premio_importo: premio ? eurIt(premio) : PH('importo premio'),
    periodo_frase: periodo,
    luogo_data: `${S.letter_city || 'Firenze'} (FI), ${itDate(letterDate || e.letter_date || new Date().toISOString().slice(0, 10))}`,
    obiettivi: objectives.length ? objectives : [{ area: PH('area'), obiettivo: PH('obiettivo'), kpi: PH('kpi'), target: PH('target'), peso: PH('peso') }],
  };
}
