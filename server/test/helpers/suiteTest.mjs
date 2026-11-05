// Infrastruttura dei test d'integrazione (debug pre-produzione L9): avvia la Suite vera (node src/index.js) su una porta libera con un
// database temporaneo, come fanno i collaudi, e offre un client HTTP con sessione e intestazione anti CSRF.
// Serve DATABASE_URL_TEST: la connessione a un PostgreSQL di prova con diritto di creare database (es.
// postgres://postgres@/postgres?host=/tmp). Senza, i test che la usano si saltano con un messaggio esplicito (vedi SALTA).
// Il database temporaneo si chiama suite_test_<pid>_<casuale> e viene eliminato alla fine. Nessun dato reale: tutto fittizio.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', '..');
export const URL_TEST = process.env.DATABASE_URL_TEST || '';
export const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante (PostgreSQL di prova): test d\'integrazione saltato';
export const OWNER = { email: 'titolare.test@toscanadiagnostica.it', password: 'Provvisoria-Test-2026!', finale: 'Definitiva-Test-2026x' };

const portaLibera = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
// sostituisce il nome del database nella stringa di connessione (anche nella forma con host vuoto: postgres://utente@/db?host=/tmp)
const dbUrl = (base, nome) => { const m = base.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); if (!m) throw new Error('DATABASE_URL_TEST non valida'); return `${m[1]}${nome}${m[3]}`; };

async function admin(sql) {
  const c = new pg.Client({ connectionString: URL_TEST });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

/** Avvia la Suite su un database nuovo. Ritorna { base, stop, log }. */
export async function avviaSuite({ env = {} } = {}) {
  const nome = `suite_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const url = dbUrl(URL_TEST, nome);   // prima della creazione: una stringa non valida non lascia database orfani
  await admin(`CREATE DATABASE ${nome}`);
  const port = await portaLibera();
  const base = `http://localhost:${port}`;
  const righe = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER,
    env: { ...process.env, PORT: String(port), DATABASE_URL: url, DISABLE_SCHEDULER: 'true', MAIL_PROVIDER: 'log', BASE_URL: base,
      SEED_OWNER_EMAIL: OWNER.email, SEED_OWNER_NAME: 'Titolare Test', SEED_OWNER_PASSWORD: OWNER.password, WEB_DIR: path.join(SERVER, 'nessuna-cartella-web'),
      NODE_ENV: 'test', ANTHROPIC_API_KEY: '', AZURE_STORAGE_CONNECTION_STRING: '', ENTRA_CLIENT_ID: '', ENTRA_CLIENT_SECRET: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => righe.push(String(d)));
  child.stderr.on('data', (d) => righe.push(String(d)));
  let ok = false;
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch(`${base}/api/health`); if (r.ok) { ok = true; break; } } catch { /* non ancora in ascolto */ }
  }
  const stop = async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((r) => { child.once('exit', r); setTimeout(r, 5000); }); }
    if (child.exitCode === null) child.kill('SIGKILL');
    await admin(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`).catch((e) => console.warn(`[test] database ${nome} non eliminato: ${e.message}`));
  };
  if (!ok) { await stop(); throw new Error(`La Suite non è partita:\n${righe.join('').slice(-3000)}`); }
  return { base, stop, log: () => righe.join('') };
}

/** Client HTTP con il cookie di sessione suite.sid e l'intestazione anti CSRF della Suite */
export function client(base) {
  let cookie = '';
  const call = async (method, p, body, { csrf = true, raw = false } = {}) => {
    const h = { ...(csrf ? { 'X-Requested-With': 'td-suite' } : {}) };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const r = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc && /suite\.sid=/.test(sc)) cookie = sc.split(';')[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* non JSON */ }
    return { s: r.status, j, text, headers: r.headers, raw: raw ? text : undefined };
  };
  return {
    get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b ?? {}, o), del: (p, o) => call('DELETE', p, undefined, o),
    login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  };
}

/** Accesso con cambio della password provvisoria e presa d'atto delle informative */
export async function entra(c, email, provvisoria, finale) {
  let r = await c.login(email, finale);
  if (r.s !== 200) {
    r = await c.login(email, provvisoria);
    if (r.s !== 200) throw new Error(`login ${email}: ${r.s} ${r.text}`);
    if (r.j?.mustChangePassword) { const ch = await c.post('/api/auth/change-password', { currentPassword: provvisoria, newPassword: finale }); if (ch.s !== 200) throw new Error(`cambio password ${ch.s} ${ch.text}`); }
  }
  const me = await c.get('/api/auth/me');
  const da = me.j?.user?.consensi_da_accettare || [];
  if (da.length) await c.post('/api/consensi/accetta', { documenti: da });
  return c;
}

/**
 * Anagrafica di prova minima (fittizia): Legal entity del gruppo, un partner che ospita un punto prelievi, due clienti con una sede
 * SERVICE ciascuno, un dipendente interno senza grant, gli accessi esterni del partner e del primo cliente, contenuti di bacheca con
 * audience INTERNAL, ORGS e SITES. Ritorna gli id e i client già autenticati.
 */
export async function datiProva(base) {
  const o = await entra(client(base), OWNER.email, OWNER.password, OWNER.finale);
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const org = async (name, kind, code) => must(await o.post('/api/organizations', { name, kind, code, city: 'Firenze' }), `org ${code}`);
  const td = await org('Gruppo Prova', 'GRUPPO', 'TD'); const p1 = await org('Farmacia Test Uno', 'PARTNER', 'TP1');
  const c1 = await org('Cliente Test Uno', 'CLIENTE', 'TC1'); const c2 = await org('Cliente Test Due', 'CLIENTE', 'TC2');
  const site = async (b) => must(await o.post('/api/sites', { city: 'Firenze', province: 'FI', address: 'Via di Prova 1', ...b }), `sede ${b.code}`);
  const hq = await site({ code: 'T-HQ', name: 'Sede Test', kind: 'HEADQUARTER', organization_id: td.id });
  const pp1 = await site({ code: 'T-PP1', name: 'Punto Prelievi Test', kind: 'PUNTO_PRELIEVI', organization_id: td.id, host_organization_id: p1.id, tenure: 'OSPITATA' });
  const sv1 = await site({ code: 'T-SV1', name: 'Service Test Uno', kind: 'SERVICE', organization_id: c1.id });
  const sv2 = await site({ code: 'T-SV2', name: 'Service Test Due Riservata', kind: 'SERVICE', organization_id: c2.id });
  const pInt = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Internotest', first_name: 'Ivo', email: 'ivo.internotest@toscanadiagnostica.it', phone: '+39 333 1111111', site_id: hq.id }), 'persona interna');
  const ext = async (orgId, key, last, first, email) => must(await o.post(`/api/organizations/${orgId}/external-access`, { last_name: last, first_name: first, email, profile_key: key, send_invite: false }), `accesso ${email}`);
  const aP = await ext(p1.id, 'PARTNER_OSPITANTE', 'Partnertest', 'Pia', 'pia.partner@farmacia-test.test');
  const aC = await ext(c1.id, 'CLIENTE_SERVICE', 'Clientetest', 'Ciro', 'ciro.cliente@cliente-test.test');
  const PW = 'Esterno-Test-2026x';
  const partner = await entra(client(base), 'pia.partner@farmacia-test.test', aP.temporaryPassword, PW);
  const cliente = await entra(client(base), 'ciro.cliente@cliente-test.test', aC.temporaryPassword, PW);
  must(await o.post('/api/community/posts', { body: 'MARCATORE-INTERNO post per la rete', audience: { type: 'INTERNAL' } }), 'post INTERNAL');
  must(await o.post('/api/community/posts', { body: 'MARCATORE-ALTRUI post per il Cliente Due', audience: { type: 'ORGS', ids: [c2.id] } }), 'post ORGS');
  must(await o.post('/api/community/posts', { body: 'MARCATORE-ALTRUI post per la sede SV2', audience: { type: 'SITES', ids: [sv2.id] } }), 'post SITES');
  return { o, partner, cliente, PW, org: { td: td.id, p1: p1.id, c1: c1.id, c2: c2.id }, site: { hq: hq.id, pp1: pp1.id, sv1: sv1.id, sv2: sv2.id }, person: { interno: pInt.id }, acc: { partner: aP, cliente: aC } };
}
