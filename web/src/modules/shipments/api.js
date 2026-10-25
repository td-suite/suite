// Client API del modulo Shipments: stesso client della Suite con base /api/shipments (sessione via cookie, header anti-CSRF).
// L'indicatore di attività è quello della Suite (evento suite:busy).
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export const BASE = '/shipments';           // percorso del modulo nel front-end della Suite
export const API_BASE = '/api/shipments';   // base delle API del modulo (anche per i download)

let pending = 0;
const setBusy = (delta) => {
  pending = Math.max(0, pending + delta);
  document.documentElement.classList.toggle('is-busy', pending > 0);
  window.dispatchEvent(new CustomEvent('suite:busy', { detail: pending }));
};

async function request(method, url, body, opts = {}) {
  const isForm = body instanceof FormData;
  if (!opts.silent) setBusy(1);
  try {
    return await doRequest(method, url, body, isForm, opts.absolute);
  } finally {
    if (!opts.silent) setBusy(-1);
  }
}

async function doRequest(method, url, body, isForm, absolute) {
  const res = await fetch(`${absolute ? '/api' : API_BASE}${url}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'td-suite', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Errore ${res.status}`, data?.code, data?.details);
    if (res.status === 401) window.dispatchEvent(new Event('suite:unauthorized'));
    throw err;
  }
  return data;
}

export const api = {
  get: (u, opts) => request('GET', u, undefined, opts),
  post: (u, b, opts) => request('POST', u, b || {}, opts),
  put: (u, b, opts) => request('PUT', u, b, opts),
  del: (u, b, opts) => request('DELETE', u, b, opts),
  upload: (u, formData, opts) => request('POST', u, formData, opts),
};

// Chiamate alle API della Suite (fuori dal modulo), es. la lingua del profilo
export const suiteApi = {
  put: (u, b) => request('PUT', u, b, { absolute: true }),
};

export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== '' && v != null);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
