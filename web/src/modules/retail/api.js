// Client API del modulo Retail Assistant: base /api/retail, sessione via cookie della Suite, header anti-CSRF della Suite
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const BASE = '/api/retail';
let pending = 0;
const setBusy = (delta) => {
  pending = Math.max(0, pending + delta);
  document.documentElement.classList.toggle('is-busy', pending > 0);
  window.dispatchEvent(new CustomEvent('suite:busy', { detail: pending }));
};
async function request(method, url, body, opts = {}) {
  const isForm = body instanceof FormData;
  if (!opts.silent) setBusy(1);
  try { return await doRequest(method, url, body, isForm); } finally { if (!opts.silent) setBusy(-1); }
}
async function doRequest(method, url, body, isForm) {
  const res = await fetch(`${BASE}${url}`, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'td-suite', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || `Errore ${res.status}`, data?.code, data?.details);
    if (Array.isArray(data?.errors)) err.errors = data.errors;
    if (res.status === 401) window.dispatchEvent(new Event('suite:unauthorized'));
    if (res.status === 403 && ['PENDING', 'PASSWORD_CHANGE_REQUIRED', 'TOTP_REQUIRED'].includes(data?.code)) window.dispatchEvent(new CustomEvent('suite:authstate', { detail: data.code }));
    throw err;
  }
  return data;
}
export const api = {
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b, o) => request('POST', u, b || {}, o),
  put: (u, b, o) => request('PUT', u, b, o),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, formData) => request('POST', u, formData),
};
export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== '' && v != null);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
// Percorsi assoluti dentro la Suite: il modulo vive sotto /retail, le API sotto /api/retail
export const base = '/retail';
export const apiBase = BASE;
