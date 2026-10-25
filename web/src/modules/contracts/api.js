// Client API del modulo Contracts: stesse chiamate dell'app di origine, base /api/contracts, sessione e anti-CSRF della Suite
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export const BASE = '/contracts';          // prefisso dei percorsi del modulo nel router della Suite
export const API_BASE = '/api/contracts';  // prefisso delle API del modulo (anche per i link di download e le anteprime)

// Indicatore di attività della Suite (barra in alto)
let pending = 0;
const setBusy = (delta) => {
  pending = Math.max(0, pending + delta);
  document.documentElement.classList.toggle('is-busy', pending > 0);
  window.dispatchEvent(new CustomEvent('suite:busy', { detail: pending }));
};

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  setBusy(1);
  try {
    return await doRequest(method, url, body, isForm);
  } finally {
    setBusy(-1);
  }
}

async function doRequest(method, url, body, isForm) {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'td-suite', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Errore ${res.status}`, data?.code, data?.details);
    if (Array.isArray(data?.errors)) err.errors = data.errors;
    if (res.status === 401) window.dispatchEvent(new Event('suite:unauthorized'));
    if (res.status === 403 && ['PENDING', 'PASSWORD_CHANGE_REQUIRED', 'TOTP_REQUIRED'].includes(data?.code)) window.dispatchEvent(new CustomEvent('suite:authstate', { detail: data.code }));
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, formData) => request('POST', u, formData),
};

export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== '' && v != null);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
