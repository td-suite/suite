// Calendario delle scadenze: documenti del dossier, contratti, lettere di impegno, MBO, scadenze manuali
// Ogni scadenza ha una chiave stabile (`key`, lib/peopleRules.js deadlineKey) usata dai richiami di people@ come [TD-SCAD-<chiave>].
// Escluse: gli allegati sostituiti da un rinnovo (attachments.superseded_by) e le scadenze chiuse all'approvazione della casella
// People (deadline_closures), salvo includeClosed.
import { many } from '../db.js';
import { CATEGORY_LABELS } from './seedData.js';
import { deadlineKey } from './peopleRules.js';

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
export const TERMINATION_LABELS = { DIMISSIONI: 'Dimissioni', LICENZIAMENTO: 'Licenziamento', SCADENZA_TERMINE: 'Scadenza del termine', RISOLUZIONE_CONSENSUALE: 'Risoluzione consensuale', PENSIONAMENTO: 'Pensionamento', FINE_INCARICO: 'Fine incarico professionale', RECESSO: 'Recesso dall\'incarico', ALTRO: 'Altro' };

export async function computeDeadlines({ resourceId = null, horizonDays = 365, today: todayIso = null, includeClosed = false } = {}) {
  const P = resourceId ? [resourceId] : [];
  const where = resourceId ? 'r.id = $1' : "r.status IN ('ATTIVO','IMPEGNO')";
  const items = [];
  const base = (r) => ({ resource_id: r.id, resource_name: `${r.last_name} ${r.first_name}`, kind: r.kind });

  // Allegati con scadenza. a.id con alias: nella riga "id" è quello della persona (r.id viene dopo e lo sovrascriveva, così
  // ref.attachment_id era l'id della persona); la chiave TD-SCAD A<id> deve essere quella dell'allegato.
  const att = await many(`SELECT a.id AS attachment_id, a.category, a.filename, a.expires_at, r.id, r.last_name, r.first_name, r.kind FROM attachments a JOIN resources_v r ON r.id=a.resource_id WHERE a.expires_at IS NOT NULL AND a.superseded_by IS NULL AND ${where}`, P);
  for (const a of att) items.push({ ...base(a), type: 'DOCUMENTO', title: `Scadenza ${CATEGORY_LABELS[a.category] || a.category}`, detail: a.filename, due_date: a.expires_at, ref: { attachment_id: a.attachment_id } });

  // Cessazioni programmate (decorrenza futura)
  const term = await many(`SELECT r.id, r.last_name, r.first_name, r.kind, r.terminated_at, r.termination_reason FROM resources_v r WHERE r.terminated_at IS NOT NULL AND r.terminated_at >= CURRENT_DATE AND ${where}`, P);
  for (const t of term) items.push({ ...base(t), type: 'CONTRATTO', title: 'Cessazione del rapporto', detail: TERMINATION_LABELS[t.termination_reason] || t.termination_reason || '', due_date: t.terminated_at });

  // Dipendenti: prova, fine contratto, scatti RAL, MBO
  const emp = await many(`SELECT e.*, r.id, r.last_name, r.first_name, r.kind FROM employments e JOIN resources_v r ON r.id=e.resource_id WHERE ${where}`, P);
  for (const e of emp) {
    if (e.probation_end) items.push({ ...base(e), type: 'PROVA', title: 'Fine periodo di prova', due_date: e.probation_end });
    if (e.end_date) items.push({ ...base(e), type: 'CONTRATTO', title: e.contract_type === 'APPRENDISTATO' ? 'Fine periodo di apprendistato' : 'Scadenza contratto a termine', due_date: e.end_date });
    for (const s of e.ral_steps || []) if (s.from) items.push({ ...base(e), type: 'RAL', title: `Scatto RAL a € ${Number(s.ral).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`, detail: 'Formalizzare la nuova ripartizione retributiva', due_date: s.from });
    if (e.mbo_enabled && e.mbo_year) {
      items.push({ ...base(e), type: 'MBO', title: `MBO ${e.mbo_year}: valutazione intermedia`, due_date: `${e.mbo_year}-07-31` });
      items.push({ ...base(e), type: 'MBO', title: `MBO ${e.mbo_year}: valutazione finale`, due_date: `${e.mbo_year + 1}-02-28` });
      items.push({ ...base(e), type: 'MBO', title: `MBO ${e.mbo_year}: erogazione premio (cedolino di marzo)`, due_date: `${e.mbo_year + 1}-03-31` });
    }
  }
  // Liberi professionisti: scadenza/rinnovo incarico, polizza
  const lps = await many(`SELECT l.*, r.id, r.last_name, r.first_name, r.kind FROM lp_contracts l JOIN resources_v r ON r.id=l.resource_id WHERE ${where}`, P);
  for (const l of lps) {
    if (l.end_date) {
      items.push({ ...base(l), type: 'CONTRATTO', title: l.auto_renew ? 'Scadenza incarico (rinnovo automatico salvo disdetta)' : 'Scadenza incarico', due_date: l.end_date });
      if (l.auto_renew) items.push({ ...base(l), type: 'CONTRATTO', title: `Termine ultimo per disdetta (preavviso ${l.notice_days} gg)`, due_date: addDays(l.end_date, -Number(l.notice_days || 30)) });
    }
    if (l.insurance_expiry) items.push({ ...base(l), type: 'DOCUMENTO', title: 'Scadenza polizza RC professionale', detail: l.insurance_policy, due_date: l.insurance_expiry });
  }
  // Lettere di impegno aperte
  const letters = await many(`SELECT c.*, r.id, r.last_name, r.first_name, r.kind FROM commitment_letters c JOIN resources_v r ON r.id=c.resource_id WHERE c.status IN ('BOZZA','INVIATA','ACCETTATA') AND ${resourceId ? 'r.id=$1' : 'TRUE'}`, P);
  for (const c of letters) {
    if (c.valid_until && c.status !== 'ACCETTATA') items.push({ ...base(c), type: 'IMPEGNO', title: 'Scadenza validità lettera di impegno', due_date: c.valid_until, ref: { letter_id: c.id } });
    if (c.start_by) items.push({ ...base(c), type: 'IMPEGNO', title: 'Data ultima di presa servizio (lettera di impegno)', due_date: c.start_by, ref: { letter_id: c.id } });
  }
  // Scadenze manuali
  const man = await many(`SELECT d.*, r.last_name, r.first_name, r.kind FROM deadlines d LEFT JOIN resources_v r ON r.id=d.resource_id WHERE NOT d.done AND ${resourceId ? 'd.resource_id=$1' : 'TRUE'}`, P);
  for (const d of man) items.push({ resource_id: d.resource_id, resource_name: d.resource_id ? `${d.last_name} ${d.first_name}` : null, kind: d.kind, type: 'MANUALE', title: d.title, detail: d.notes, due_date: d.due_date, ref: { deadline_id: d.id } });

  const t = todayIso || today();
  const limit = addDays(t, horizonDays);
  const closed = includeClosed ? new Set() : new Set((await many('SELECT deadline_key FROM deadline_closures')).map((x) => x.deadline_key));
  return items
    .map((i) => ({ ...i, key: deadlineKey(i) }))
    .filter((i) => i.due_date && !closed.has(i.key) && (resourceId || i.due_date <= limit))
    .map((i) => ({ ...i, days: Math.round((new Date(`${i.due_date}T12:00:00Z`) - new Date(`${t}T12:00:00Z`)) / 86400000) }))
    .filter((i) => !(i.days < 0 && ['PROVA', 'RAL', 'MBO', 'IMPEGNO'].includes(i.type)))
    .map((i) => ({ ...i, state: i.days < 0 ? 'SCADUTA' : i.days <= 30 ? 'IMMINENTE' : i.days <= 90 ? 'PROSSIMA' : 'PIANIFICATA' }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// Documenti attesi ma assenti nel dossier
export async function missingDocuments(resourceId, kind) {
  const req = await many('SELECT category, label, required, renew_months FROM dossier_requirements WHERE kind=$1 ORDER BY sort_order', [kind]);
  const have = await many('SELECT category, max(expires_at) AS expires_at, count(*)::int AS n FROM attachments WHERE resource_id=$1 GROUP BY category', [resourceId]);
  const map = Object.fromEntries(have.map((h) => [h.category, h]));
  return req.map((x) => ({ ...x, present: Boolean(map[x.category]), count: map[x.category]?.n || 0, expires_at: map[x.category]?.expires_at || null }));
}
