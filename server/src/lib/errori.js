// Gestore unico degli errori delle API (debug pre-produzione del 05/11/2026, M1 e L3).
// - Errori del database dovuti a dati non validi (classe SQLSTATE 22: testo non numerico in un id, numero fuori intervallo, data
//   impossibile, LIMIT negativo, carattere NUL) → 400 "Parametro non valido", non più 500 con lo stack nel log.
// - Vincoli violati (classe 23): duplicato → 409, riferimento inesistente o ancora in uso → 409/400, campo obbligatorio → 400.
// - Il codice SQLSTATE non esce mai nella risposta: `code` resta solo per gli errori applicativi (HttpError con un codice nostro,
//   es. TOTP_REQUIRED, PASSWORD_CHANGE_REQUIRED).
// - MODULE_OFF (modulo non ancora travasato o avviato) → 503 con il suo messaggio, invece di "Errore interno del server".

// Errore di PostgreSQL (driver pg): ha un codice SQLSTATE di cinque caratteri e la severità
export const erroreDb = (err) => Boolean(err) && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && typeof err.severity === 'string';

/** Stato HTTP, messaggio e codice pubblico di un errore. Funzione pura (test in test/errori.test.mjs). */
export function rispostaErrore(err) {
  if (erroreDb(err)) {
    const c = err.code;
    if (c === '23505') return { status: 409, error: 'Elemento duplicato' };
    if (c === '23503') return /still referenced/i.test(err.detail || '') ? { status: 409, error: 'Elemento collegato ad altri dati: non si può eliminare' } : { status: 400, error: 'Riferimento non valido: l\'elemento collegato non esiste' };
    if (c === '23502') return { status: 400, error: 'Campo obbligatorio mancante' };
    if (c === '23514' || c === '23P01') return { status: 400, error: 'Valore non ammesso' };
    if (c.startsWith('22')) return { status: 400, error: 'Parametro non valido' };
    return { status: 500, error: 'Errore interno del server' };
  }
  if (err?.type === 'entity.parse.failed') return { status: 400, error: 'Corpo della richiesta non valido (JSON malformato)' };
  if (err?.type === 'entity.too.large') return { status: 413, error: 'Richiesta troppo grande' };
  if (err?.code === 'LIMIT_FILE_SIZE') return { status: 413, error: 'File troppo grande' };
  const status = Number(err?.status || err?.statusCode) || 500;
  const pubblico = typeof err?.code === 'string' && !/^[0-9A-Z]{5}$/.test(err.code) ? err.code : undefined;
  if (err?.code === 'MODULE_OFF') return { status: 503, error: err.message || 'Modulo non ancora avviato nella Suite', code: 'MODULE_OFF' };
  // 503 applicativi (archivio file non configurato, servizio esterno non raggiungibile): il messaggio è nostro e utile
  if (status === 503 && err?.message && err.status) return { status, error: err.message, code: pubblico };
  if (status >= 500) return { status, error: 'Errore interno del server' };
  return { status, error: err?.message || 'Richiesta non valida', code: pubblico };
}

export function gestoreErrori(err, req, res, _next) {
  const r = rispostaErrore(err);
  // nel log solo i 500 veri (non i dati non validi: non sono guasti) e mai i dati della richiesta
  if (r.status >= 500 && err?.code !== 'MODULE_OFF') console.error(`[${req.method} ${req.path}]`, err);
  if (res.headersSent) return res.end();
  res.status(r.status).json({ error: r.error, code: r.code, details: r.status < 500 ? err?.details : undefined, current: r.status < 500 ? err?.current : undefined });
}

// Toglie i caratteri NUL da stringhe e chiavi di un valore JSON (ricorsivo, con limite di profondità)
export function senzaNul(v, depth = 0) {
  if (depth > 40) return v;
  if (typeof v === 'string') return v.includes('\u0000') ? v.replace(/\u0000/g, '') : v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = senzaNul(v[i], depth + 1); return v; }
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
    for (const k of Object.keys(v)) {
      const val = senzaNul(v[k], depth + 1);
      if (k.includes('\u0000')) { delete v[k]; v[k.replace(/\u0000/g, '')] = val; } else v[k] = val;
    }
  }
  return v;
}
export function togliNul(req, _res, next) {
  if (req.body && typeof req.body === 'object') senzaNul(req.body);
  next();
}
