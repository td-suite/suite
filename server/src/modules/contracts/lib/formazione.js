// Formazione aziendale e crediti ECM della persona (v0.77.0, richiesta del CEO del 16/11/2026).
// - Ogni corso è una riga di `formazione` (svolto o programmato); l'attestato è un allegato del dossier.
// - Contatore ECM solo per le professioni sanitarie: obbligo del triennio meno riduzioni meno crediti acquisiti nel triennio.
//   Obbligo e triennio stanno nelle Impostazioni del modulo (ecm_obbligo_triennio, ecm_triennio_inizio). Il valore predefinito è 150
//   crediti nel triennio 2026-2028 (Commissione nazionale per la formazione continua, delibera n. 1 del 5 marzo 2026): non 180.
// - Lettura dell'attestato con l'API Claude (stesso lettore degli allegati del dossier): propone titolo, ente, data, ore e crediti;
//   la riga nasce solo dopo la conferma di chi carica. Senza chiave API: euristica sul testo, sempre da confermare.
import { one, many } from '../db.js';
import { config } from '../config.js';
import { getSettings } from './payroll.js';
import { extractAnyText } from './contractParse.js';
// stessa regola di lib/peopleMail.js (qui ripetuta per non creare un ciclo di import con lib/deadlines.js)
const aiMock = () => process.env.NODE_ENV !== 'production' && process.env.CONTRACTS_AI_MOCK === '1';

export const TIPI_FORMAZIONE = {
  SICUREZZA_GENERALE: 'Sicurezza: formazione generale', SICUREZZA_SPECIFICA: 'Sicurezza: formazione specifica', SICUREZZA_AGGIORNAMENTO: 'Sicurezza: aggiornamento',
  PREPOSTO: 'Preposto', DIRIGENTE_SICUREZZA: 'Dirigente per la sicurezza', RLS: 'Rappresentante dei lavoratori (RLS)', ANTINCENDIO: 'Addetto antincendio',
  PRIMO_SOCCORSO: 'Addetto primo soccorso', BLSD: 'BLSD', RADIOPROTEZIONE: 'Radioprotezione', PRIVACY: 'Privacy e protezione dei dati',
  MOD231: 'Modello 231 e codice etico', QUALITA: 'Sistema di gestione integrato', AZIENDALE: 'Formazione aziendale', ECM: 'Evento ECM', ALTRO: 'Altro',
};
// Validità proposta quando l'attestato non la indica (mesi): modificabile riga per riga da chi inserisce
export const RINNOVO_MESI = { SICUREZZA_GENERALE: null, SICUREZZA_SPECIFICA: 60, SICUREZZA_AGGIORNAMENTO: 60, PREPOSTO: 24, DIRIGENTE_SICUREZZA: 60, RLS: 12, ANTINCENDIO: 60, PRIMO_SOCCORSO: 36, BLSD: 24 };

const num = (v, d) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : d; };
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
export const addMonths = (d, n) => { const x = new Date(`${iso(d)}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/** Obbligo ECM e triennio in corso dalle Impostazioni del modulo. I trienni si susseguono dall'anno di inizio impostato. */
export function ecmRegole(S = {}, oggi = new Date().toISOString().slice(0, 10)) {
  const obbligo = num(S.ecm_obbligo_triennio, 150);
  const primo = Math.round(num(S.ecm_triennio_inizio, 2026));
  const anno = Number(oggi.slice(0, 4));
  const inizio = primo + Math.floor((anno - primo) / 3) * 3;
  return { obbligo, inizio, fine: inizio + 2, dal: `${inizio}-01-01`, al: `${inizio + 2}-12-31`, annuale: Math.round(obbligo / 3 * 100) / 100, anno };
}

// Professioni sanitarie riconosciute da mansione o disciplina quando la posizione ECM non è stata fissata a mano
const SANITARIA_RE = /(medic|infermier|ostetric|fisioterap|biolog|chimic|fisic[oa]\b|psicolog|dietist|logoped|radiolog|tecnic[oa] (sanitari|di laboratorio|di radiologia|audiometr|ortoped|neurofisiopat)|tsrm|tslb|farmacist|odontoiatr|veterinar|igienista dentale|podolog|ortottist|assistente sanitari|educatore professionale|terapista)/i;
/** true se la persona è soggetta all'obbligo ECM: scelta esplicita (ecm_profili.soggetto) oppure riconoscimento automatico. */
export function soggettoEcm(r, profilo) {
  if (profilo && profilo.soggetto !== null && profilo.soggetto !== undefined) return { soggetto: Boolean(profilo.soggetto), automatico: false };
  if (r.kind === 'TIROCINANTE') return { soggetto: false, automatico: true };
  const testo = [profilo?.professione, r.job_title, r.discipline, r.person_job_title, r.person_discipline].filter(Boolean).join(' ');
  return { soggetto: ['MEDICO', 'SANITARIO'].includes(r.person_kind) || SANITARIA_RE.test(testo), automatico: true };
}

/** Calcolo puro del contatore: crediti per anno del triennio, residuo sull'obbligo, obiettivo progressivo a fine anno. */
export function contatoreEcm({ regole, profilo, corsi }) {
  const obbligo = profilo?.obbligo_triennio != null ? Number(profilo.obbligo_triennio) : regole.obbligo;
  const riduzione = Number(profilo?.riduzione || 0);
  const dovuti = Math.max(0, Math.round((obbligo - riduzione) * 100) / 100);
  const anni = [regole.inizio, regole.inizio + 1, regole.inizio + 2].map((a) => ({ anno: a, crediti: 0 }));
  for (const c of corsi) {
    const d = iso(c.data);
    if (c.stato !== 'SVOLTA' || !d || d < regole.dal || d > regole.al) continue;
    const a = anni.find((x) => x.anno === Number(d.slice(0, 4))); if (a) a.crediti = Math.round((a.crediti + Number(c.crediti_ecm || 0)) * 100) / 100;
  }
  // anni in cui la risorsa non va considerata (ecm_profili.anni_esclusi): niente obiettivo, scadenze né richiami per quell'anno
  const esclusi = new Set((profilo?.anni_esclusi || []).map(Number));
  for (const a of anni) a.escluso = esclusi.has(a.anno);
  const acquisiti = Math.round(anni.reduce((s, a) => s + a.crediti, 0) * 100) / 100;
  const residuo = Math.max(0, Math.round((dovuti - acquisiti) * 100) / 100);
  // Obiettivo progressivo: a fine dell'anno N del triennio un terzo, due terzi, tutto (indicativo: il vincolo di legge è sul triennio)
  // L'obiettivo si distribuisce sui soli anni considerati: chi è escluso un anno recupera sugli altri due, non a fine dell'anno escluso.
  const considerati = anni.filter((a) => !a.escluso);
  const trascorsi = considerati.filter((a) => a.anno <= regole.anno).length;
  const esclusoAnno = esclusi.has(regole.anno);
  const attesi = considerati.length ? Math.round(dovuti * trascorsi / considerati.length * 100) / 100 : 0;
  return { obbligo, riduzione, dovuti, acquisiti, residuo, anni, obiettivo_anno: attesi, mancano_anno: esclusoAnno ? 0 : Math.max(0, Math.round((attesi - acquisiti) * 100) / 100), escluso_anno: esclusoAnno, anno: regole.anno, esclusione_motivo: esclusoAnno ? profilo?.esclusione_motivo || null : null,
    triennio: `${regole.inizio}-${regole.fine}`, dal: regole.dal, al: regole.al, completato: residuo === 0 };
}

/** Posizione ECM completa di una persona (riga di resources_v con mansione e disciplina). */
export async function statoEcm(r, { oggi = null, S = null } = {}) {
  const profilo = await one('SELECT * FROM ecm_profili WHERE resource_id=$1', [r.id]);
  const sog = soggettoEcm(r, profilo);
  const regole = ecmRegole(S || await getSettings(), oggi || undefined);
  const corsi = sog.soggetto ? await many(`SELECT stato, data, crediti_ecm FROM formazione WHERE resource_id=$1 AND crediti_ecm > 0`, [r.id]) : [];
  return { ...sog, profilo: profilo || null, regole, contatore: sog.soggetto ? contatoreEcm({ regole, profilo, corsi }) : null };
}

/** Persone attive con mansione e disciplina (per elenchi, contatori e scadenze). */
export async function personePerEcm(resourceId = null) {
  return many(`SELECT r.id, r.last_name, r.first_name, r.kind, r.person_kind, r.status, r.person_job_title, r.person_discipline, e.job_title, l.discipline
    FROM resources_v r LEFT JOIN employments e ON e.resource_id=r.id LEFT JOIN lp_contracts l ON l.resource_id=r.id
    WHERE ${resourceId ? 'r.id=$1' : "r.status IN ('ATTIVO','IMPEGNO')"}`, resourceId ? [resourceId] : []);
}

// ---------------------------------------------------------------- lettura dell'attestato
const ymd = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const it = String(s).match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/); if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  return null;
};
const IMG = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/gif' };

/** Normalizza la proposta (da Claude o dall'euristica): tipi ammessi, numeri non negativi, date valide. */
export function normalizzaLettura(j, { method }) {
  const tipo = TIPI_FORMAZIONE[String(j.tipo || '').toUpperCase()] ? String(j.tipo).toUpperCase() : (Number(j.crediti_ecm) > 0 ? 'ECM' : 'AZIENDALE');
  const pos = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null; };
  return { titolo: j.titolo ? String(j.titolo).trim().slice(0, 300) : null, ente: j.ente ? String(j.ente).trim().slice(0, 200) : null, tipo,
    data: ymd(j.data), ore: pos(j.ore), crediti_ecm: pos(j.crediti_ecm) || 0, scadenza: ymd(j.scadenza), codice_evento: j.codice_evento ? String(j.codice_evento).trim().slice(0, 60) : null,
    intestatario: j.intestatario ? String(j.intestatario).trim().slice(0, 120) : null, altra_persona: Boolean(j.altra_persona), confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)),
    note: j.note ? String(j.note).trim().slice(0, 400) : null, method };
}

/** Euristica senza API: crediti, ore e date vicino alle parole chiave. Sempre "debole": chi carica deve confermare ogni campo. */
export function euristicaAttestato(text, filename = '') {
  const t = String(text || '').replace(/\s+/g, ' ');
  const n = (re) => { const m = t.match(re); return m ? m[1].replace(',', '.') : null; };
  const crediti = n(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:\(.{1,30}?\)\s*)?crediti\s+(?:formativi\s+)?(?:e\.?\s?c\.?\s?m\.?)/i) || n(/crediti\s+(?:formativi\s+)?e\.?\s?c\.?\s?m\.?[^\d]{0,40}(\d{1,3}(?:[.,]\d{1,2})?)/i) || n(/n\.?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*crediti/i);
  const ore = n(/durata[^\d]{0,30}(\d{1,3}(?:[.,]\d{1,2})?)\s*ore/i) || n(/(\d{1,3}(?:[.,]\d{1,2})?)\s*ore\b/i);
  const D = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{4})';
  const data = (t.match(new RegExp(`(?:svolt[oa]|tenut[oa]|conclus[oa]|in data|il giorno|rilasciat[oa]\\s+il|data)[^\\d]{0,30}${D}`, 'i')) || t.match(new RegExp(D)) || [])[1];
  const evento = n(/(?:evento|id evento|codice evento)\s*(?:n\.?|n°|:)?\s*([0-9]{3,}[-–/]?[0-9]*)/i);
  const titolo = (t.match(/(?:corso|evento(?: formativo)?|convegno|seminario)\s*(?:dal titolo|denominato|:)?\s*[“"«]([^”"»]{8,200})[”"»]/i) || [])[1] || String(filename).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  return normalizzaLettura({ titolo, crediti_ecm: crediti, ore, data, codice_evento: evento, tipo: crediti ? 'ECM' : /sicurezza|81\/2008|81\/08/i.test(t) ? 'SICUREZZA_SPECIFICA' : 'AZIENDALE', confidence: 0.3,
    note: 'Lettura senza intelligenza artificiale: controlla ogni campo sull\'attestato' }, { method: 'euristica' });
}

/** Legge un attestato di formazione: PDF e immagini passano a Claude come tali, gli altri formati come testo estratto. */
export async function leggiAttestato({ buffer, mime, filename, personName }) {
  const testo = async () => { try { return (await extractAnyText(buffer, mime, filename)).text || ''; } catch { return ''; } };
  if (aiMock() || !config.anthropicKey) return { ...euristicaAttestato(await testo(), filename), method: aiMock() ? 'mock' : 'euristica' };
  const content = [];
  if ((mime === 'application/pdf' || /\.pdf$/i.test(filename)) && buffer.length <= 20 * 1024 * 1024) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } });
  else if (IMG[mime] && buffer.length <= 4.5 * 1024 * 1024) content.push({ type: 'image', source: { type: 'base64', media_type: IMG[mime], data: buffer.toString('base64') } });
  else { const t = await testo(); if (t.replace(/\s/g, '').length < 30) return euristicaAttestato(t, filename); content.push({ type: 'text', text: `Testo estratto dall'attestato (file ${filename}):\n\n${t.slice(0, 15000)}` }); }
  content.push({ type: 'text', text: `Sei l'ufficio del personale di Toscana Diagnostica. Il documento allegato è un attestato di formazione${personName ? ` che dovrebbe essere intestato a ${personName}` : ''}.
Rispondi SOLO con un oggetto JSON con le chiavi:
- titolo: titolo del corso o dell'evento, come scritto sull'attestato;
- ente: provider o ente che ha erogato la formazione;
- tipo: uno tra ${Object.keys(TIPI_FORMAZIONE).join(', ')} (ECM se l'attestato riconosce crediti ECM);
- data: data di conseguimento o di fine corso in formato AAAA-MM-GG;
- ore: durata in ore (numero), null se non indicata;
- crediti_ecm: numero di crediti ECM riconosciuti al partecipante (numero, anche decimale), 0 se l'attestato non riconosce crediti ECM;
- scadenza: data di scadenza o di validità in formato AAAA-MM-GG se l'attestato la indica, altrimenti null;
- codice_evento: codice dell'evento ECM o identificativo del provider se presente, altrimenti null;
- intestatario: nome e cognome del partecipante come scritto sull'attestato, altrimenti null;
- altra_persona: true se l'attestato è chiaramente intestato a una persona diversa da quella indicata, altrimenti false;
- confidence: numero tra 0 e 1;
- note: una frase in italiano con ciò che è utile sapere (per esempio "crediti assegnati come docente").
Non inventare: se un dato non è leggibile usa null (0 per i crediti).` });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
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
  let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  if (!j) return euristicaAttestato(await testo(), filename);
  return normalizzaLettura(j, { method: 'claude' });
}
