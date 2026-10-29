// Funzioni pure del modulo Audit SGI: voci di un modello, punteggio, livelli, mese dell'alert, destinatari.
// Nessun accesso al database: sono le funzioni coperte da server/test/audit-scoring.test.mjs.

export const ANSWER_VALUES = ['SI', 'NO', 'NC', 'NA'];

// Chiave stabile di una voce di primo livello ("Sic 1" → "Sic1"); le sotto-voci hanno già la chiave nel modello ("19a")
export const itemKey = (n) => String(n || '').replace(/\s+/g, '');

/** Voci rispondibili di un modello, in ordine: [{ key, part_key, part_title, section_key, section_title, n, label, parent, rev, free, group }].
 *  Le voci con sotto-voci non si rispondono (si rispondono le sotto-voci); le voci libere ripetute diventano key_1, key_2... */
export function itemsOf(template) {
  const out = [];
  for (const part of template?.parts || []) {
    for (const sec of part.sections || []) {
      for (const it of sec.items || []) {
        const base = { part_key: part.key, part_title: part.title, section_key: sec.key, section_title: sec.title, group: it.group || null };
        if (Array.isArray(it.sub) && it.sub.length) {
          for (const s of it.sub) {
            const k = s.key || `${itemKey(it.n)}${s.n || ''}`;
            if (s.free) { const rep = Math.max(1, Number(s.repeat) || 1); for (let i = 1; i <= rep; i++) out.push({ ...base, key: `${k}_${i}`, n: `${it.n}`, label: s.text, parent: it.text, rev: Boolean(s.rev), free: true }); }
            else out.push({ ...base, key: k, n: `${it.n}`, label: s.text, parent: it.text, rev: Boolean(s.rev), free: false });
          }
        } else if (it.free) {
          const rep = Math.max(1, Number(it.repeat) || 1);
          for (let i = 1; i <= rep; i++) out.push({ ...base, key: `${itemKey(it.n)}_${i}`, n: String(it.n), label: it.text, parent: null, rev: Boolean(it.rev), free: true });
        } else {
          out.push({ ...base, key: itemKey(it.n), n: String(it.n), label: it.text, parent: null, rev: Boolean(it.rev), free: false });
        }
      }
    }
  }
  return out;
}

/** Sezioni del modello in ordine: [{ key, title, part_key, part_title }] */
export const sectionsOf = (template) => (template?.parts || []).flatMap((p) => (p.sections || []).map((s) => ({ key: s.key, title: s.title, hint: s.hint || null, part_key: p.key, part_title: p.title })));

/** Verifica strutturale di un modello: chiavi uniche, campi obbligatori. Restituisce la lista degli errori (vuota se valido). */
export function validateTemplate(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['Il modello deve essere un oggetto JSON'];
  for (const f of ['code', 'title', 'rev']) if (!t[f]) errors.push(`Campo obbligatorio mancante: ${f}`);
  if (!Array.isArray(t.parts) || !t.parts.length) errors.push('Il modello deve avere almeno una parte (parts)');
  const seenSec = new Set();
  for (const p of t.parts || []) {
    if (!p.key || !p.title) errors.push('Ogni parte deve avere key e title');
    if (!Array.isArray(p.sections) || !p.sections.length) errors.push(`La parte ${p.key || '?'} non ha sezioni`);
    for (const s of p.sections || []) {
      if (!s.key || !s.title) errors.push(`Sezione senza key o title nella parte ${p.key}`);
      if (seenSec.has(s.key)) errors.push(`Chiave di sezione duplicata: ${s.key}`);
      seenSec.add(s.key);
      if (!Array.isArray(s.items) || !s.items.length) errors.push(`La sezione ${s.key} non ha voci`);
      for (const it of s.items || []) {
        if (it.n == null || it.n === '') errors.push(`Voce senza numero nella sezione ${s.key}`);
        if (!it.text) errors.push(`Voce ${it.n} senza testo nella sezione ${s.key}`);
        for (const sub of it.sub || []) { if (!sub.key) errors.push(`Sotto-voce senza key nella voce ${it.n}`); if (!sub.text) errors.push(`Sotto-voce ${sub.key} senza testo`); }
      }
    }
  }
  const keys = itemsOf(t).map((i) => i.key);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) errors.push(`Chiavi di voce duplicate: ${[...new Set(dup)].join(', ')}`);
  if (!t.report || !Array.isArray(t.report.nc_columns)) errors.push('Manca report.nc_columns');
  return errors;
}

/** Punteggio di una colonna di risposte. SI = 1, NO = 0, NC = 0 (e conta come non conformità), NA escluso dal denominatore;
 *  voci libere non conteggiate se il testo libero è vuoto; voci senza risposta non entrano nel denominatore ma contano come "da rispondere".
 *  Restituisce { score (0-100 o null), si, no, nc, na, answered, total, by_section: { key: { score, si, no, nc, na, answered, total } } } */
export function computeScore(template, answers = {}) {
  const items = itemsOf(template);
  const tot = { si: 0, no: 0, nc: 0, na: 0, answered: 0, total: 0 };
  const by = {};
  for (const it of items) {
    const a = answers?.[it.key] || {};
    if (it.free && !String(a.free || '').trim()) continue;   // voce libera senza testo: non esiste
    const s = by[it.section_key] || (by[it.section_key] = { si: 0, no: 0, nc: 0, na: 0, answered: 0, total: 0 });
    s.total++; tot.total++;
    const v = ANSWER_VALUES.includes(a.v) ? a.v : null;
    if (!v) continue;
    s.answered++; tot.answered++;
    const f = v.toLowerCase();
    s[f]++; tot[f]++;
  }
  const pct = (x) => { const den = x.si + x.no + x.nc; return den ? Math.round((x.si / den) * 1000) / 10 : null; };
  for (const k of Object.keys(by)) by[k].score = pct(by[k]);
  return { score: pct(tot), ...tot, by_section: by };
}

/** Livello dal punteggio: A ≥ 90 Allineato, B 75-89 Sostanzialmente allineato, C 60-74 Parzialmente allineato, D < 60 Critico */
export const LEVELS = [
  { letter: 'A', min: 90, label: 'Allineato', tone: 'green' },
  { letter: 'B', min: 75, label: 'Sostanzialmente allineato', tone: 'teal' },
  { letter: 'C', min: 60, label: 'Parzialmente allineato', tone: 'amber' },
  { letter: 'D', min: 0, label: 'Critico', tone: 'red' },
];
export function levelOf(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const s = Number(score);
  return LEVELS.find((l) => s >= l.min) || LEVELS[LEVELS.length - 1];
}
export const levelLetter = (score) => levelOf(score)?.letter || null;
export const levelLabel = (letter) => LEVELS.find((l) => l.letter === letter)?.label || null;

/** Punteggio che fa fede per un audit: per gli AUTO con colonna del verificatore compilata (almeno una risposta) vale quella;
 *  altrimenti la colonna della sede/auditor. Restituisce { score, source: 'VERIFICA'|'SEDE', delta } */
export function effectiveScore(audit) {
  const hasVer = audit.kind === 'AUTO' && audit.score_verifier != null;
  const score = hasVer ? Number(audit.score_verifier) : (audit.score == null ? null : Number(audit.score));
  const delta = hasVer && audit.score != null ? Math.round((Number(audit.score_verifier) - Number(audit.score)) * 10) / 10 : null;
  return { score, source: hasVer ? 'VERIFICA' : 'SEDE', delta };
}

/** Riepilogo punteggi di un audit: colonne, sezioni e conteggi, pronti per il salvataggio */
export function scoreAudit(template, audit) {
  const a = computeScore(template, audit.answers || {});
  const hasVerifier = audit.kind === 'AUTO' && Object.values(audit.verifier_answers || {}).some((x) => ANSWER_VALUES.includes(x?.v));
  const v = hasVerifier ? computeScore(template, audit.verifier_answers || {}) : null;
  const by = {};
  for (const sec of sectionsOf(template)) {
    const sa = a.by_section[sec.key] || { score: null, si: 0, no: 0, nc: 0, na: 0, answered: 0, total: 0 };
    const sv = v?.by_section?.[sec.key];
    by[sec.key] = { title: sec.title, ...sa, score_verifier: sv ? sv.score : null, nc_verifier: sv ? sv.nc : null };
  }
  return { score: a.score, score_verifier: v ? v.score : null, by_section: by, answered: a.answered, total: a.total, nc: a.nc, nc_verifier: v ? v.nc : null, si: a.si, no: a.no, na: a.na };
}

// ---- Date (senza date cablate: tutto in funzione della data passata)
const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Primo giorno del mese di una data (YYYY-MM-01) */
export const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
/** Etichetta italiana del mese di un periodo "YYYY-MM-01" */
export const monthLabel = (period) => { const [y, m] = String(period).slice(0, 7).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); };

/** Finestra dell'alert: dal giorno alert_day fino a fine mese. Restituisce { due: bool, period, day, reminder: bool } dove reminder è vero
 *  nei giorni in cui tocca un promemoria (ogni reminder_every_days dal primo avviso), per una sede che non ha ancora inviato. */
export function alertWindow(today, { alert_day = 17, reminder_every_days = 5 } = {}) {
  const d = today instanceof Date ? today : new Date(`${today}T12:00:00`);
  const day = d.getDate();
  const alertDay = Math.min(28, Math.max(1, Number(alert_day) || 17));
  const period = monthStart(d);
  if (day < alertDay) return { due: false, period, day, reminder: false };
  const every = Number(reminder_every_days) || 0;
  const reminder = day > alertDay && every > 0 && (day - alertDay) % every === 0;
  return { due: true, period, day, reminder };
}

/** Data del giorno in Italia come YYYY-MM-DD (oppure la data di test passata) */
export const todayIt = (override) => override || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

/** Sedi a cui mandare l'alert oggi: per ogni sede attiva di tipo struttura, senza auto-audit inviato nel mese, se oggi è il giorno
 *  dell'alert (o successivo) e non è già stato mandato l'avviso (o, per il promemoria, non è stato mandato oggi).
 *  sites: [{ id, kind, active }], sent: [{ site_id, period, sent_at, kind }], audits: [{ site_id, period, status }] */
export function sitesToAlert({ today, settings, sites, audits, sent, structureKinds }) {
  const w = alertWindow(today, settings);
  if (!w.due) return [];
  const todayStr = isoDate(today instanceof Date ? today : new Date(`${today}T12:00:00`));
  const out = [];
  for (const s of sites) {
    if (!s.active || !structureKinds.includes(s.kind)) continue;
    const inviato = audits.some((a) => a.site_id === s.id && String(a.period).slice(0, 10) === w.period && ['INVIATO', 'VERIFICATO', 'CHIUSO'].includes(a.status));
    if (inviato) continue;
    const giaInviati = sent.filter((x) => x.site_id === s.id && String(x.period).slice(0, 10) === w.period);
    if (!giaInviati.length) { out.push({ site_id: s.id, period: w.period, kind: 'ALERT' }); continue; }
    if (w.reminder && !giaInviati.some((x) => isoDate(new Date(x.sent_at)) === todayStr)) out.push({ site_id: s.id, period: w.period, kind: 'REMINDER' });
  }
  return out;
}

/** Destinatari dell'alert di una sede: utenti attivi con email = manager_email della sede oppure con grant SITE del modulo su quella sede.
 *  users: [{ id, email, status }], grants: [{ user_id, site_id }] (grant audit con scope SITE) */
export function alertRecipients(site, users, grants) {
  const ids = new Set();
  const me = String(site.manager_email || '').toLowerCase();
  for (const u of users) {
    if (u.status && u.status !== 'ACTIVE') continue;
    if (me && String(u.email || '').toLowerCase() === me) ids.add(u.id);
  }
  for (const g of grants) if (Number(g.site_id) === Number(site.id)) { const u = users.find((x) => x.id === g.user_id); if (!u || !u.status || u.status === 'ACTIVE') ids.add(g.user_id); }
  return [...ids];
}
