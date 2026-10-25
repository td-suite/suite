import { one, q } from '../db.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, d) => new HttpError(400, msg, d);
export const forbidden = (msg = 'Operazione non consentita') => new HttpError(403, msg);
export const notFound = (msg = 'Elemento non trovato') => new HttpError(404, msg);

// wrapper async per express
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// arrotondamento monetario a 2 decimali, evitando errori binari
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sum = (arr, f = (x) => x) => r2(arr.reduce((a, x) => a + Number(f(x) || 0), 0));

export const eur = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
export const itDate = (iso) => {
  if (!iso) return '';
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const itDateTime = (d) =>
  d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '';

export async function audit(req, action, entity, entityId, data) {
  try {
    await q('INSERT INTO audit_log (user_id, action, entity, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6)', [
      req.user?.id || null, action, entity || null, entityId != null ? String(entityId) : null,
      data ? JSON.stringify(data) : null, req.ip,
    ]);
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

export async function getSetting(key, def = null) {
  const r = await one('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r ? r.value : def;
}

// Validazione con zod -> 400 leggibile
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; ');
    throw bad(`Dati non validi. ${msg}`);
  }
  return r.data;
}

export const todayRome = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

// Messaggio bilingue in base alla lingua della richiesta
export const L = (req, it, en) => (req?.lang === 'en' ? en : it);
export const badL = (req, it, en, d) => bad(L(req, it, en), d);

export const monthOf = (d) => (d ? String(typeof d === 'string' ? d : d.toISOString()).slice(0, 7) : null);
export const dateOnly = (d) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(d)) : null);

export async function logEvent(c, { orderId = null, kitId = null, event, data = null, userId = null }) {
  const run = c?.query ? (t, p) => c.query(t, p) : q;
  await run('INSERT INTO order_events (order_id, kit_id, event, data, user_id) VALUES ($1,$2,$3,$4,$5)', [orderId, kitId, event, data ? JSON.stringify(data) : null, userId]);
}
