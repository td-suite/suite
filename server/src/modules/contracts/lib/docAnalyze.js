// Lettura automatica degli allegati del dossier: firmato, data di rilascio, data di scadenza.
// Con API Claude: il documento viene letto come PDF o immagine (firme comprese); senza: euristica sul testo estratto.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { extractAnyText, ocrAvailable } from './contractParse.js';

const run = promisify(execFile);
const IMG = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/gif' };
const PDF_MAX = 20 * 1024 * 1024, IMG_MAX = 4.5 * 1024 * 1024;

const CATEGORY_HINTS = {
  CI: 'documento di identità (carta d\'identità, passaporto, patente): data di rilascio e data di scadenza stampate sul documento; "firmato" = presente la firma del titolare',
  CF: 'codice fiscale o tessera sanitaria: data di scadenza della tessera se presente',
  PIVA: 'certificato di attribuzione partita IVA: data del certificato',
  ALBO: 'iscrizione o quota annuale a ordine/albo professionale: data del certificato o della ricevuta; scadenza = fine dell\'anno di validità o data indicata',
  POLIZZA_RC: 'polizza assicurativa RC professionale: data di decorrenza (rilascio) e data di scadenza della copertura',
  CONTRATTO_FIRMATO: 'contratto di lavoro o di collaborazione: data della sottoscrizione; scadenza = eventuale termine del contratto; "firmato" = firme di entrambe le parti presenti',
  LETTERA_IMPEGNO: 'lettera di impegno: data della lettera; "firmato" = firma per accettazione del candidato',
  MBO: 'piano MBO: data della sottoscrizione; scadenza = fine dell\'esercizio di riferimento (31/12)',
  UNILAV: 'comunicazione obbligatoria UNILAV: data della comunicazione; scadenza = data fine rapporto se a termine',
  FORMAZIONE_SICUREZZA: 'attestato formazione sicurezza D.Lgs. 81/2008: data dell\'attestato; scadenza = aggiornamento quinquennale (5 anni) se non indicata',
  VISITA_MEDICA: 'giudizio di idoneità del medico competente: data della visita; scadenza = prossima visita indicata (di norma 12 mesi)',
  ECM: 'attestato crediti ECM: data; scadenza = fine del triennio formativo',
  FORMAZIONE: 'attestato di formazione: data; scadenza se l\'attestato indica una validità',
  TITOLO_STUDIO: 'titolo di studio o certificato di laurea: data di conseguimento; nessuna scadenza',
  DETRAZIONI: 'dichiarazione detrazioni d\'imposta: data di firma; scadenza = 31/12 dell\'anno',
  TFR: 'modulo scelta TFR: data di firma',
  L335: 'dichiarazione L. 335/95: data di firma',
  DATI_BANCARI: 'modulo dati bancari: data di firma',
  PRIVACY: 'informativa privacy: data di firma per presa visione',
  POLITICA_SGI: 'politica integrata SGI: data di firma per presa visione',
  REGOLAMENTO: 'regolamento aziendale: data di firma per presa visione',
  MOD231: 'modello 231 e codice etico: data di firma per presa visione',
  SPECIMEN_FIRMA: 'specimen di firma: data; "firmato" = firma presente',
  CONSEGNA_DOTAZIONI: 'verbale consegna dotazioni: data di consegna; "firmato" = firma del dipendente',
  SMART_WORKING: 'accordo smart working: data di sottoscrizione; scadenza = termine dell\'accordo',
  CV: 'curriculum vitae: data di aggiornamento del CV se presente',
};

const ymd = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const it = String(s).match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  return null;
};
const addMonths = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/** Analisi con l'API Claude: PDF e immagini inviati come tali, DOCX come testo. */
async function analyzeWithClaude({ buffer, mime, filename, category, label, renewMonths, personName }) {
  const hint = CATEGORY_HINTS[category] || 'documento del fascicolo del personale';
  const today = new Date().toISOString().slice(0, 10);
  const instr = `Sei l'ufficio del personale di Toscana Diagnostica. Il documento allegato è catalogato come "${label}" (${hint}).${personName ? ` Dovrebbe riguardare ${personName}.` : ''}
Rispondi SOLO con un oggetto JSON con le chiavi:
- signed: true se nel documento è visibile almeno una firma autografa o digitale (scritta a mano, timbro firma, firma elettronica "firmato digitalmente"), false se gli spazi firma sono vuoti o non ci sono firme, null se non determinabile;
- issued_at: data del documento o di rilascio in formato AAAA-MM-GG (per i documenti di identità la data di rilascio; per i contratti e i moduli la data di sottoscrizione; per attestati e certificati la data di emissione), null se assente;
- expires_at: data di scadenza o fine validità in formato AAAA-MM-GG se indicata nel documento${renewMonths ? `; se non indicata ma il documento ha validità periodica, calcola issued_at + ${renewMonths} mesi` : ''}, altrimenti null;
- doc_type: breve descrizione del tipo di documento effettivamente riconosciuto (es. "carta d'identità elettronica", "attestato formazione generale 4 ore");
- holder: nome e cognome dell'intestatario se leggibile, altrimenti null;
- mismatch: true se il documento non corrisponde alla categoria "${label}" o non riguarda la persona indicata, altrimenti false;
- confidence: numero 0-1;
- notes: una frase in italiano con ciò che è utile sapere (es. "numero documento CA12345AA, rilasciata dal Comune di Firenze").
Oggi è ${today}. Non inventare date: se un dato non è leggibile usa null.`;
  const content = [];
  if ((mime === 'application/pdf' || /\.pdf$/i.test(filename)) && buffer.length <= PDF_MAX) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } });
  } else if (IMG[mime] && buffer.length <= IMG_MAX) {
    content.push({ type: 'image', source: { type: 'base64', media_type: IMG[mime], data: buffer.toString('base64') } });
  } else {
    const t = await extractAnyTextWithImages(buffer, mime, filename);
    if (!t || t.replace(/\s/g, '').length < 30) return null;
    content.push({ type: 'text', text: `Testo estratto dal documento (file ${filename}):\n\n${t.slice(0, 15000)}` });
  }
  content.push({ type: 'text', text: instr });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 800, system: 'Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice.', messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    const body = await res.text(); let detail = body;
    try { detail = JSON.parse(body)?.error?.message || body; } catch { /* grezzo */ }
    const e = new Error(`API Claude (${res.status}): ${String(detail).slice(0, 300)}`); e.status = 424; throw e;
  }
  const data = await res.json();
  const txt = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').replace(/```(?:json)?/gi, '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  return { signed: typeof j.signed === 'boolean' ? j.signed : null, issued_at: ymd(j.issued_at), expires_at: ymd(j.expires_at), doc_type: j.doc_type || null, holder: j.holder || null, mismatch: Boolean(j.mismatch), confidence: Number(j.confidence) || null, notes: j.notes || null, method: 'claude' };
}

/** Testo da PDF/DOCX/TXT e, per le immagini, OCR diretto con tesseract. */
async function extractAnyTextWithImages(buffer, mime, filename) {
  if (IMG[mime]) {
    if (!await ocrAvailable()) return '';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-img-'));
    try {
      const f = path.join(dir, 'img'); fs.writeFileSync(f, buffer);
      let lang = 'eng'; try { const { stdout } = await run('tesseract', ['--list-langs']); if (/\bita\b/.test(stdout)) lang = 'ita'; } catch { /* eng */ }
      const { stdout } = await run('tesseract', [f, '-', '-l', lang, '--psm', '6'], { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, OMP_THREAD_LIMIT: '1' }, timeout: 90_000 });
      return stdout;
    } catch (e) { console.error('[doc] OCR immagine fallito:', e.message); return ''; }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return (await extractAnyText(buffer, mime, filename)).text || '';
}

/** Euristica senza API: date vicine a parole chiave; scadenza da periodicità della categoria. Senza parole chiave la proposta è "debole" e non viene applicata in automatico. */
function heuristic(text, { renewMonths }) {
  const t = (text || '').replace(/\s+/g, ' ');
  const today = new Date().toISOString().slice(0, 10);
  const D = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{4})';
  const find = (re) => { const m = t.match(re); return m ? ymd(m[1]) : null; };
  const issued = find(new RegExp(`(?:rilasciat[ao]\\s+(?:il|in\\s+data)|data\\s+di\\s+rilascio|emess[ao]\\s+(?:il|in\\s+data)|data\\s+(?:di\\s+)?emissione|data\\s+del\\s+documento|sottoscritt[oa]\\s+(?:il|in\\s+data)|firmat[oa]\\s+(?:il|in\\s+data)|in\\s+data|data\\s+(?:della\\s+)?(?:visita|attestato|certificato|comunicazione|lettera))\\s*[:\\-]?\\s*${D}`, 'i'))
    || find(new RegExp(`(?:firenze|sesto fiorentino|prato|pistoia|livorno|roma|milano|calenzano|montemurlo|quarrata)\\s*,?\\s*(?:l[ìi]|il|addì)?\\s*${D}`, 'i'));
  const expires = find(new RegExp(`(?:scad(?:enza|e|ente)|valid[ao]\\s+(?:fino\\s+al|sino\\s+al|al)|validit[àa]\\s*(?:fino\\s+al)?|data\\s+di\\s+scadenza|expir(?:y|es)|fino\\s+al)\\s*[:\\-]?\\s*${D}`, 'i'));
  // date in contesto anagrafico (nascita) non sono mai date del documento
  const birthCtx = new Set([...t.matchAll(new RegExp(`(?:nat[oa]\\s+(?:a|il|in)[^\\d]{0,40}|nascita[^\\d]{0,20}|birth[^\\d]{0,20})${D}`, 'gi'))].map((m) => ymd(m[1])));
  const all = [...t.matchAll(new RegExp(D, 'g'))].map((m) => ymd(m[1])).filter((d) => d && !birthCtx.has(d) && d >= '1995-01-01').sort();
  const past = all.filter((d) => d <= today), future = all.filter((d) => d > today);
  const weak = !issued && !expires;
  const issued_at = issued || (past.length ? past[past.length - 1] : null); // senza parola chiave: l'ultima data passata (i documenti si datano in chiusura)
  const expires_at = expires || (issued_at && renewMonths ? addMonths(issued_at, renewMonths) : (future.length ? future[0] : null));
  const signed = /firmato\s+digitalmente|firma\s+digitale|sottoscritt[oa]\s+digitalmente/i.test(t) ? true : null;
  return { signed, issued_at, expires_at, doc_type: null, holder: null, mismatch: false, confidence: weak ? 0.25 : 0.55, weak, notes: all.length ? `Date trovate nel testo: ${[...new Set(all)].map((d) => d.split('-').reverse().join('/')).join(', ')}` : 'Nessuna data leggibile nel documento', method: 'euristica' };
}

export async function analyzeAttachment({ buffer, mime, filename, category, label, renewMonths, personName }) {
  if (config.anthropicKey) {
    const r = await analyzeWithClaude({ buffer, mime, filename, category, label, renewMonths, personName });
    if (r) { if (!r.expires_at && r.issued_at && renewMonths) r.expires_at = addMonths(r.issued_at, renewMonths); return r; }
  }
  const text = await extractAnyTextWithImages(buffer, mime, filename);
  return heuristic(text, { renewMonths });
}
