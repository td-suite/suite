// Prova rapida (smoke test) della Synclab Data API v1 dall'ambiente della Suite, in sola lettura. Non scrive nulla nel database.
// Passi: health (senza token) → login → metadata → prima pagina di exams (gestendo il 202 e il polling con lo stesso cursor) → conteggi.
// Stampa per ogni passo: esito HTTP, durata, conteggi e correlationId. Mai corpi, token, cursori o password.
//
// Credenziali SOLO da ambiente o dal connettore (mai in argomento):
//   a) variabili d'ambiente: SYNCLAB_BASE_URL (es. https://synclab.toscanadiagnostica.it), SYNCLAB_CLIENT_NAME (TDSuite),
//      SYNCLAB_CLIENT_PASSWORD (dal secret store);
//   b) oppure, senza le variabili, il connettore STUDIOLAB della Suite (DATABASE_URL e CREDENTIALS_KEY / SESSION_SECRET dell'ambiente):
//      base URL, nome e password del client salvati cifrati in Amministrazione > Connettori.
// Uso (da server/):  node scripts/synclab-smoke.mjs [--page-size 5] [--max-polling 30]
import { APP_VERSION } from '../src/version.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const pageSize = Number(arg('--page-size', 5));
const maxPolling = Number(arg('--max-polling', 30));
const UA = `TD-Suite/${APP_VERSION} (smoke)`;
const riga = (passo, x) => console.log(`${passo.padEnd(10)} ${String(x.status ?? '-').padEnd(4)} ${String(x.ms ?? '-').padStart(6)} ms  ${x.nota || ''}`);

async function credenziali() {
  if (process.env.SYNCLAB_BASE_URL && process.env.SYNCLAB_CLIENT_NAME && process.env.SYNCLAB_CLIENT_PASSWORD) {
    return { base: process.env.SYNCLAB_BASE_URL.replace(/\/+$/, ''), name: process.env.SYNCLAB_CLIENT_NAME, password: process.env.SYNCLAB_CLIENT_PASSWORD, extra: {}, fonte: 'variabili d\'ambiente' };
  }
  const { loadSecrets } = await import('../src/lib/secrets.js');
  await loadSecrets().catch(() => {});
  const { getConnector, studiolabExtraHeaders } = await import('../src/lib/connectors.js');
  const c = await getConnector('STUDIOLAB');
  if (c.auth_kind !== 'CLIENT_JWT') throw new Error('Il connettore STUDIOLAB non è in modalità CLIENT_JWT e le variabili SYNCLAB_* non sono impostate');
  if (!c.credentials.client_name || !c.credentials.password) throw new Error('Nome o password del client non impostati nel connettore');
  return { base: String(c.base_url).replace(/\/+$/, ''), name: c.credentials.client_name, password: c.credentials.password, extra: studiolabExtraHeaders(c), fonte: 'connettore STUDIOLAB' };
}

async function chiama(url, { method = 'GET', headers = {}, body } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { method, headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, body, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non JSON */ }
  return { status: res.status, ms: Date.now() - t0, data, retryAfter: Number(res.headers.get('retry-after')) || 2 };
}
const problema = (d) => (d && typeof d === 'object' ? [d.code, d.title, d.correlationId ? `correlationId ${d.correlationId}` : null].filter(Boolean).join(' · ') : '');

async function main() {
  const t0 = Date.now();
  const k = await credenziali();
  console.log(`Synclab Data API · smoke test · ${k.base} · credenziali da ${k.fonte}`);
  const h = await chiama(`${k.base}/api/v1/health`, { headers: k.extra });
  riga('health', { ...h, nota: h.status === 200 ? 'servizio raggiungibile' : problema(h.data) });
  const l = await chiama(`${k.base}/api/v1/auth/client/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...k.extra }, body: JSON.stringify({ name: k.name, password: k.password }) });
  if (l.status !== 200 || !l.data?.accessToken) { riga('login', { ...l, nota: `rifiutato ${problema(l.data)}` }); process.exitCode = 1; return; }
  riga('login', { ...l, nota: `token ricevuto, valido fino al ${l.data.validTo || 'n.d.'}` });
  const auth = { Authorization: `Bearer ${l.data.accessToken}`, ...k.extra };
  const m = await chiama(`${k.base}/api/v1/data/metadata`, { headers: auth });
  if (m.status !== 200) { riga('metadata', { ...m, nota: problema(m.data) }); process.exitCode = 1; return; }
  const md = m.data || {};
  riga('metadata', { ...m, nota: `istanza ${md.instanceId} · contratto ${md.contractVersion} · insiemi ${(md.datasets || []).join(', ')} · pagina max ${md.maxPageSize} · finestra delta ${md.deltaWindowDays} giorni` });
  // prima pagina di exams: 202 → polling con lo stesso cursor (URL-encoded) fino al 200
  const qs = (cursor) => new URLSearchParams({ pageSize: String(pageSize), ...(cursor ? { cursor } : {}) }).toString();
  let r = await chiama(`${k.base}/api/v1/data/exams?${qs()}`, { headers: auth });
  let polling = 0; let attesa = 0;
  while (r.status === 202 && polling < maxPolling) {
    const cursor = r.data?.nextCursor;
    riga('exams', { ...r, nota: `cattura in corso (${r.data?.status || 'n.d.'}), nuova richiesta tra ${r.retryAfter} s` });
    if (!cursor) { console.log('202 senza nextCursor: interrotto'); process.exitCode = 1; return; }
    await new Promise((x) => setTimeout(x, r.retryAfter * 1000)); attesa += r.retryAfter;
    polling++;
    r = await chiama(`${k.base}/api/v1/data/exams?${qs(cursor)}`, { headers: auth });
  }
  if (r.status !== 200) { riga('exams', { ...r, nota: r.status === 202 ? `cattura ancora in corso dopo ${polling} tentativi` : problema(r.data) }); process.exitCode = 1; return; }
  const p = r.data || {};
  riga('exams', { ...r, nota: `${(p.items || []).length} elementi su ${p.totalCount ?? 'n.d.'} · ${p.nextCursor ? 'altre pagine' : 'ultima pagina'} · checkpoint ${p.syncToken ? 'presente (non stampato)' : 'assente (atteso solo all\'ultima pagina)'} · fotografia ${p.capturedAt || 'n.d.'}` });
  console.log(`Esito: OK · polling ${polling} (attesa ${attesa} s) · durata totale ${Date.now() - t0} ms`);
}
main().catch((e) => { console.error(`Esito: ERRORE · ${e.message}`); process.exitCode = 1; }).finally(async () => { try { const { pool } = await import('../src/db.js'); await pool.end(); } catch { /* nessun database */ } });
