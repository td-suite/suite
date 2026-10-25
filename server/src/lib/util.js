import { q } from '../db.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, d) => new HttpError(400, msg, d);
export const forbidden = (msg = 'Operazione non consentita') => new HttpError(403, msg);
export const notFound = (msg = 'Elemento non trovato') => new HttpError(404, msg);
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function audit(req, action, { module, entity, entityId, label, data } = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  try {
    const r = await runner(
      `INSERT INTO audit_log (user_id, action, module_key, entity, entity_id, label, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, at`,
      [req.user?.id || null, action, module || null, entity || null, entityId != null ? String(entityId) : null, label || null,
        data ? JSON.stringify(data) : null, req.ip || null]);
    return r.rows[0];
  } catch (e) { console.error('[audit]', e.message); return null; }
}

export async function readLog(req, { module, entity, entityId }) {
  try { await q('INSERT INTO read_log (user_id, module_key, entity, entity_id, ip) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, module || null, entity, String(entityId), req.ip || null]); }
  catch (e) { console.error('[readlog]', e.message); }
}

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; ');
    throw bad(`Dati non validi. ${msg}`);
  }
  return r.data;
}

export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });   // YYYY-MM-DD in Italia

export function diff(before, after, fields) {
  const out = {};
  for (const k of fields) {
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = [a ?? null, b ?? null];
  }
  return out;
}

export const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'voce';
export const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function getSetting(key, fallback = null) {
  const r = await q('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : fallback;
}
export async function setSetting(key, value, userId) {
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), userId || null]);
}

// Forma visualizzata dei nomi in tutta la Suite: "Cognome Nome"
export const displayName = (last, first) => [last, first].map((x) => (x || '').trim()).filter(Boolean).join(' ');
// Spezza un "Nome Cognome" (es. da Entra o da un'app di origine): ipotesi cognome = ultima parola
export const splitName = (full) => { const t = (full || '').trim().split(/\s+/).filter(Boolean); if (t.length < 2) return { first_name: t[0] || '', last_name: '' }; return { first_name: t.slice(0, -1).join(' '), last_name: t[t.length - 1] }; };
