// Client API del modulo Circolari: base /api/circolari, sessione via cookie della Suite, header anti-CSRF della Suite
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const BASE = '/api/circolari';

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
    const res = await fetch(`${BASE}${url}`, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'td-suite', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new ApiError(res.status, data?.error || `Errore ${res.status}`, data?.code, data?.details);
      if (res.status === 401) window.dispatchEvent(new Event('suite:unauthorized'));
      throw err;
    }
    return data;
  } finally { if (!opts.silent) setBusy(-1); }
}

export const api = {
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b, o) => request('POST', u, b || {}, o),
  put: (u, b, o) => request('PUT', u, b, o),
  del: (u, b, o) => request('DELETE', u, b, o),
  upload: (u, formData, o) => request('POST', u, formData, o),
};
export const qs = (o) => { const p = Object.entries(o).filter(([, v]) => v !== '' && v != null); return p.length ? `?${new URLSearchParams(p).toString()}` : ''; };
export const base = '/circolari';
export const apiBase = BASE;

// Hook di lettura legato al client del modulo (lo useApi della Suite punta a /api, non a /api/circolari)
import { useCallback, useEffect, useState } from 'react';
export function useApi(url, deps = [], opts = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const load = useCallback(async () => {
    if (!url) return setState({ data: null, error: null, loading: false });
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await api.get(url, { silent: opts.silent !== false }), error: null, loading: false }); }
    catch (e) { setState({ data: null, error: e, loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
