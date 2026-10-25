// Client API del modulo: stesso client della Suite (cookie di sessione, header anti-CSRF td-suite, barra di attività)
// con base /api/integration. In più l'header X-Client-Id del motore GANTT (il client ignora gli eventi SSE generati da sé stesso)
// e la proprietà "current" delle risposte 409 (versione aggiornata della riga, per il controllo di versione).
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export const BASE = '/api/integration';

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
    return await doRequest(method, url, body, isForm);
  } finally {
    if (!opts.silent) setBusy(-1);
  }
}

async function doRequest(method, url, body, isForm) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'td-suite', 'X-Client-Id': window.__TDI_CLIENT_ID || '', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Errore ${res.status}`, data?.code, data?.details);
    if (data && data.current) err.current = data.current;
    if (res.status === 401) window.dispatchEvent(new Event('suite:unauthorized'));
    if (res.status === 403 && ['PENDING', 'PASSWORD_CHANGE_REQUIRED', 'TOTP_REQUIRED'].includes(data?.code)) window.dispatchEvent(new CustomEvent('suite:authstate', { detail: data.code }));
    throw err;
  }
  return data;
}

export const api = {
  get: (u, opts) => request('GET', u, undefined, opts),
  post: (u, b, opts) => request('POST', u, b || {}, opts),
  put: (u, b, opts) => request('PUT', u, b, opts),
  patch: (u, b, opts) => request('PATCH', u, b, opts),
  del: (u, b, opts) => request('DELETE', u, b, opts),
  upload: (u, formData, opts) => request('POST', u, formData, opts),
};

export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
