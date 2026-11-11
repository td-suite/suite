// Server finto della Synclab Data API v1 per i test e il collaudo locale (nessun dato reale, nessuna rete esterna). I contenuti vengono
// SOLO da docs/synclab-data-api/esempi_sintetici.json (dati sintetici di CB Sistemi): gli elementi in più sono copie con id e numeri
// diversi. Protocollo come il contratto (01_CONTRATTO_API.md): login con validTo, Bearer, 202 + Retry-After alla prima richiesta di una
// cattura, pagine con nextCursor opaco (con caratteri da codificare), syncToken solo all'ultima pagina, delta su /sync/changes con since
// ripetuto, /sync/status a blocchi di 200 id, ProblemDetails in application/problem+json. Iniezioni: 401, 429, 500, 503, 409.
// Avvio da riga di comando (collaudo): node test/helpers/fakeSynclab.mjs --port 7199 (password del client nella variabile
// FAKE_SYNCLAB_PASSWORD, mai in argomento; FAKE_SYNCLAB_PROFILO=72 per le accettazioni sintetiche del profilo pazienti).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ESEMPI = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'docs', 'synclab-data-api', 'esempi_sintetici.json'), 'utf8'));
const copia = (o) => JSON.parse(JSON.stringify(o));
const b64 = (s) => Buffer.from(String(s)).toString('base64');   // contiene + / = : il client deve codificarlo

/** Dati iniziali: un elemento per insieme dagli esempi; con `copie` n elementi in più per insieme (id e numeri diversi). */
export function datiIniziali({ copie = 0 } = {}) {
  const req = copia(ESEMPI.optInRequest);   // proiezione completa: il server toglie paziente e testi storici se includePatient=false
  const d = { clients: [copia(ESEMPI.client)], exams: [copia(ESEMPI.exam)], 'price-lists': [copia(ESEMPI.priceList)], requests: [req], invoices: [copia(ESEMPI.invoice), copia(ESEMPI.manualCreditNote)] };
  for (let i = 1; i <= copie; i++) {
    const c = copia(ESEMPI.client); c.id = `${c.id}-${i}`; c.clientCode = `${c.clientCode}-${i}`; d.clients.push(c);
    const e = copia(ESEMPI.exam); e.id = `${e.id}-${i}`; e.examCode = `${e.examCode}${i}`; d.exams.push(e);
    const r = copia(ESEMPI.optInRequest); r.id = `${r.id}-${i}`; r.requestNumber = `${r.requestNumber}-${i}`; r.items = r.items.map((x) => ({ ...x, id: `${x.id}-${i}` })); d.requests.push(r);
  }
  return d;
}

// Profilo dei pazienti (v0.67.1): accettazioni sintetiche per i test e il collaudo, costruite SOLO dalla forma di standardRequest (nessun
// paziente: la proiezione standard non lo ha) con demografia variata (età, sesso, comune/provincia/CAP pubblici di Toscana ed Emilia) e
// codici d'esame copia di quello degli esempi. Tre client (copie del client degli esempi) = tre sedi; date negli ultimi `mesi` mesi fino a
// `oggi` e, con annoPrima, una parte nello stesso periodo dell'anno prima. Generatore pseudo-casuale con seme fisso: dati ripetibili.
export const COMUNI_PROVA = [['Firenze', 'FI', '50100'], ['Sesto Fiorentino', 'FI', '50019'], ['Campi Bisenzio', 'FI', '50013'], ['Scandicci', 'FI', '50018'], ['Calenzano', 'FI', '50041'],
  ['Prato', 'PO', '59100'], ['Montemurlo', 'PO', '59013'], ['Pistoia', 'PT', '51100'], ['Quarrata', 'PT', '51039'], ['Empoli', 'FI', '50053'], ['Lucca', 'LU', '55100'], ['Pisa', 'PI', '56100'],
  ['Bologna', 'BO', '40100'], ['Arezzo', 'AR', '52100'], ['Siena', 'SI', '53100'], ['Poggio a Caiano', 'PO', '59016'], ['Signa', 'FI', '50058'], ['Lastra a Signa', 'FI', '50055'],
  ['Bagno a Ripoli', 'FI', '50012'], ['Fiesole', 'FI', '50014'], ['Agliana', 'PT', '51031'], ['Carmignano', 'PO', '59015'], ['Vaiano', 'PO', '59021'], ['Livorno', 'LI', '57100']];
// coppie materiale/contenitore dimostrative per codice d'esame (solo per il server finto)
export const CONTENITORI_PROVA = { GLU: ['SIERO', 'PROVETTA'], GLU1: ['SANGUE INTERO', 'PROVETTA EDTA'], GLU2: ['SIERO', 'PROVETTA'], GLU3: ['URINE', 'CONTENITORE STERILE'],
  GLU4: ['PLASMA', 'PROVETTA CITRATO'], GLU5: ['SANGUE INTERO', 'PROVETTA EDTA'], GLU6: ['SIERO', 'PROVETTA'], altro: ['PLASMA', 'PROVETTA CITRATO'] };
export function datiProfilo({ n = 72, oggi = new Date().toISOString().slice(0, 10), mesi = 2, annoPrima = true, conPaziente = true } = {}) {
  let seme = 20261109;
  const rnd = () => { seme = (seme * 1103515245 + 12345) % 2147483648; return seme / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const clienti = ['A', 'B', 'C'].map((x) => { const c = copia(ESEMPI.client); c.id = `${c.id}-${x}`; c.clientCode = `${c.clientCode}-${x}`; c.legalName = `${c.legalName} ${x}`; return c; });
  const esami = [copia(ESEMPI.exam), ...[1, 2, 3, 4, 5, 6].map((i) => { const e = copia(ESEMPI.exam); e.id = `${e.id}-${i}`; e.examCode = `${e.examCode}${i}`; e.description = `Esame dimostrativo ${i}`; return e; })];
  const [y, m] = oggi.split('-').map(Number);
  const inizio = new Date(Date.UTC(y, m - mesi, 1)).getTime(), fine = Date.parse(`${oggi}T00:00:00Z`);
  const richieste = [];
  const totale = n + (annoPrima ? Math.round(n / 3) : 0);
  for (let i = 1; i <= totale; i++) {
    const r = copia(ESEMPI.standardRequest); delete r.patient;
    const prima = i > n;
    let t = inizio + Math.floor(rnd() * Math.max(1, fine - inizio + 86400000));
    if (prima) { const d = new Date(t); d.setUTCFullYear(d.getUTCFullYear() - 1); t = d.getTime(); }
    const data = new Date(t).toISOString().slice(0, 10);
    const ora = 7 + Math.floor(rnd() * 5) + (rnd() < 0.2 ? 7 : 0);
    const cli = clienti[i % 3 === 0 ? 2 : i % 2 === 0 ? 1 : 0];
    const com = rnd() < 0.08 ? [null, null, null] : rnd() < 0.55 ? COMUNI_PROVA[[0, 5, 7][clienti.indexOf(cli)]] : pick(COMUNI_PROVA);
    r.id = `${r.id}-P${i}`; r.requestNumber = `2026/P${String(i).padStart(4, '0')}`; r.date = data;
    r.clientId = cli.id; r.clientCode = cli.clientCode;
    r.createdAtLocal = `${data}T${String(ora).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00`;
    r.patientType = rnd() < 0.75 ? 'PRIVATO' : 'CONVENZIONATO';
    r.occupationalMedicine = rnd() < 0.15;
    r.demographics = { ageYears: rnd() < 0.07 ? null : Math.floor(rnd() * 90), sex: rnd() < 0.53 ? 'F' : rnd() < 0.96 ? 'M' : null, city: com[0], province: com[1], postalCode: com[2] };
    const k = 1 + Math.floor(rnd() * 3);
    // campioni: un campione per coppia materiale/contenitore dell'accettazione, legato alle righe con sampleIds (circa il 10% con il
    // contenitore "sbagliato", per provare la percentuale della coppia più frequente)
    r.samples = []; r.invoiceIds = [];
    const campione = (pair) => {
      let c = r.samples.find((x) => x.material === pair[0] && x.container === pair[1]);
      if (!c) { c = { ...copia(ESEMPI.optInRequest.samples[0]), id: `${r.id}-S${r.samples.length + 1}`, barcode: `BC${String(i).padStart(4, '0')}${r.samples.length + 1}`, material: pair[0], container: pair[1], sampleAtLocal: r.createdAtLocal, collectedAtLocal: r.createdAtLocal, checkedInAtLocal: r.createdAtLocal }; r.samples.push(c); }
      return c.id;
    };
    r.items = Array.from({ length: k }, (_, j) => { const e = pick(esami); const pair = rnd() < 0.1 ? CONTENITORI_PROVA.altro : CONTENITORI_PROVA[e.examCode] || CONTENITORI_PROVA.altro;
      return { ...copia(ESEMPI.standardRequest.items[0]), id: `${r.id}-${j}`, examId: e.id, examCode: e.examCode, description: e.description, invoiceIds: [], sampleIds: [campione(pair)] }; });
    if (i % 5 === 0) r.requestNumber = `P26-${String(6700 + i).padStart(6, '0')}`;   // numeri nel formato "P26-00NNNN
    richieste.push(r);
  }
  // un'accettazione con tutte le righe cancellate: non entra nel profilo
  const canc = copia(richieste[0]); canc.id = `${canc.id}-CANC`; canc.requestNumber = '2026/PCANC'; canc.items = canc.items.map((x) => ({ ...x, id: `${x.id}-c`, deleted: true })); richieste.push(canc);
  // l'accettazione degli esempi con il paziente nella proiezione opt-in (Persona Dimostrativa di CB Sistemi): per il recupero puntuale di NC
  if (conPaziente) richieste.push(copia(ESEMPI.optInRequest));
  return { clients: clienti, exams: esami, 'price-lists': [copia(ESEMPI.priceList)], requests: richieste, invoices: [] };
}

const proietta = (dataset, x, includePatient) => {
  const o = copia(x);
  if (!includePatient && dataset === 'requests') { delete o.patient; for (const it of o.items || []) delete it.historicalDescription; }
  return o;
};
const filtra = (dataset, items, q) => items.filter((x) => {
  if (q.clientId && (dataset === 'clients' ? x.id : x.clientId) !== q.clientId) return false;
  if (q.operatingCompany && x.operatingCompany !== q.operatingCompany) return false;
  // v0.69.0 (Label): filtri esatti delle sole accettazioni, come il contratto (requestNumber, sampleBarcode)
  if (dataset === 'requests' && q.requestNumber && x.requestNumber !== q.requestNumber) return false;
  if (dataset === 'requests' && q.sampleBarcode && !(x.samples || []).some((s) => s.barcode === q.sampleBarcode)) return false;
  return true;
});

export function creaFakeSynclab({ password = 'Fittizia-1!', clientName = 'TDSuite', validitaS = 900, polling = 1, retryAfter = 2, dati = datiIniziali(), metadati = {} } = {}) {
  const stato = {
    dati, versione: 1, cambi: [],                   // cambi: { versione, dataset, change, filtro? }
    tokens: new Map(), logins: 0, richieste: [], iniezioni: [], statoIds: new Map(),
    catture: new Map(),                              // snapshotId → { dataset, tipo, items, syncToken, polls, query }
    seq: 0, validitaS, polling, retryAfter, invalidaTokens: false,
  };
  const meta = { instanceId: 'ISTANZA-DIMOSTRATIVA', defaultPageSize: 100, maxPageSize: 500, pageTtlHours: 24, maxCaptureRecords: 100000, contractVersion: '1.0', datasets: ['clients', 'exams', 'price-lists', 'requests', 'invoices'],
    sourceScope: 'standard', sourceTimeZone: 'Europe/Rome', syncTimeZone: 'UTC', deltaWindowDays: 30, captureMode: 'snapshot', consistency: 'snapshot', patientProjectionDefault: false,
    archivedContentSupported: false, archiveDetectionSupported: true, unknownExits: 'unavailable', fullSyncMerge: 'status', ...metadati };

  const problema = (res, status, code, title, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/problem+json; charset=utf-8', ...(extra.retryAfter != null ? { 'Retry-After': String(extra.retryAfter) } : {}) });
    res.end(JSON.stringify({ type: 'about:blank', title, status, code, correlationId: `CORR-${++stato.seq}` }));
  };
  const json = (res, status, body, h = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...h }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const q = Object.fromEntries([...u.searchParams.entries()].filter(([k]) => k !== 'id'));
    const ids = u.searchParams.getAll('id');
    stato.richieste.push({ metodo: req.method, path: u.pathname, query: q, ids, auth: req.headers.authorization ? 'bearer' : null, ua: req.headers['user-agent'] || null });
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        if (req.method === 'GET' && u.pathname === '/api/v1/health') return json(res, 200, { status: 'Healthy' });
        if (req.method === 'POST' && u.pathname === '/api/v1/auth/client/login') {
          let b = {}; try { b = JSON.parse(body || '{}'); } catch { /* corpo non valido */ }
          if (b.name !== clientName || b.password !== password) return problema(res, 401, 'invalid_credentials', 'Credenziali errate o client non autorizzato.');
          stato.logins++;
          const tok = `TOKEN-FINTO-${stato.logins}`;
          const validTo = new Date(Date.now() + stato.validitaS * 1000).toISOString();
          stato.tokens.set(tok, Date.parse(validTo));
          return json(res, 200, { accessToken: tok, validTo });
        }
        // autenticazione
        const auth = String(req.headers.authorization || '');
        const tok = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!tok || !stato.tokens.has(tok) || stato.tokens.get(tok) < Date.now() || stato.invalidaTokens) { stato.invalidaTokens = false; if (tok) stato.tokens.delete(tok); return problema(res, 401, 'unauthorized', 'Token mancante o scaduto'); }
        if (u.pathname === '/api/v1/auth/client/info') return problema(res, 403, 'forbidden', 'Ruolo Application richiesto');
        if (!u.pathname.startsWith('/api/v1/data/')) return problema(res, 404, 'not_found', 'Risorsa inesistente');
        // iniezioni (la prossima richiesta dati che corrisponde)
        const inj = stato.iniezioni.find((x) => x.volte > 0 && (!x.path || u.pathname.includes(x.path)) && (!x.quando || x.quando(u, q)));
        if (inj) { inj.volte--; return problema(res, inj.status, inj.code || null, inj.title || `Errore iniettato ${inj.status}`, { retryAfter: inj.retryAfter }); }
        const rel = u.pathname.slice('/api/v1/data/'.length);
        if (rel === 'metadata') return json(res, 200, meta);
        if (rel === 'sync/status') {
          const ds = q.dataset;
          if (!ids.length || ids.length > 200) return problema(res, 400, 'invalid_ids', 'Da 1 a 200 parametri id');
          return json(res, 200, ids.map((id) => {
            const st = stato.statoIds.get(`${ds}|${id}`);
            if (st) return { id, operation: st.operation, reason: st.reason ?? null };
            return (stato.dati[ds] || []).some((x) => x.id === id) ? { id, operation: 'available', reason: null } : { id, operation: 'unavailable', reason: 'source_exit_unknown' };
          }));
        }
        if (rel === 'sync/changes') return pagina(res, q, 'DELTA');
        const m = rel.match(/^(clients|exams|price-lists|requests|invoices)(?:\/([^/]+))?$/);
        if (!m) return problema(res, 404, 'not_found', 'Risorsa inesistente');
        if (m[2]) {
          const id = decodeURIComponent(m[2]);
          const x = (stato.dati[m[1]] || []).find((y) => y.id === id);
          return x ? json(res, 200, proietta(m[1], x, q.includePatient === 'true')) : problema(res, 404, 'not_found', 'Record assente o escluso');
        }
        return pagina(res, { ...q, dataset: m[1] }, 'COMPLETO');
      } catch (e) { return problema(res, 500, 'errore_interno', e.message); }
    });
  });

  // ----- protocollo delle pagine (completo e delta): 202 alla prima richiesta, polling con il cursor, poi pagine immutabili
  const chiaveAmbito = (q) => JSON.stringify({ d: q.dataset, s: q.since || null, p: q.includePatient || null, c: q.clientId || null, o: q.operatingCompany || null, rn: q.requestNumber || null, sb: q.sampleBarcode || null });
  function pagina(res, q, tipo) {
    const ds = q.dataset;
    if (!stato.dati[ds]) return problema(res, 400, 'invalid_dataset', 'Insieme di dati sconosciuto');
    const size = Math.min(Number(q.pageSize) || meta.defaultPageSize, meta.maxPageSize);
    if (tipo === 'DELTA') {
      if (!q.since) return problema(res, 400, 'since_required', 'since obbligatorio');
      const fr = stato.forza409?.[ds];
      if (fr) { delete stato.forza409[ds]; return problema(res, 409, fr, fr === 'full_sync_required' ? ESEMPI.expired.title : 'Cursore scaduto'); }
    }
    if (!q.cursor) {
      // nuova cattura
      const snap = `SNAP-${++stato.seq}`;
      let items;
      if (tipo === 'COMPLETO') items = filtra(ds, stato.dati[ds], q).map((x) => proietta(ds, x, q.includePatient === 'true'));
      else {
        const da = Number(String(q.since).split(':').pop());
        items = stato.cambi.filter((c) => c.dataset === ds && c.versione > da && (!c.filtro || c.filtro(q))).map((c) => ({ ...copia(c.change), data: c.change.data ? proietta(ds, c.change.data, q.includePatient === 'true') : null }));
      }
      stato.catture.set(snap, { ambito: chiaveAmbito(q), items, polls: stato.polling, syncToken: `CHECKPOINT:${ds}:${stato.versione}`, capturedAt: new Date().toISOString() });
      return json(res, 202, { snapshotId: snap, nextCursor: b64(`${snap}|attesa`), status: 'capturing' }, { 'Retry-After': String(stato.retryAfter) });
    }
    let cur;
    try { cur = Buffer.from(q.cursor, 'base64').toString(); } catch { return problema(res, 400, 'invalid_cursor', 'Cursore non valido'); }
    const [snap, pos] = cur.split('|');
    const cat = stato.catture.get(snap);
    if (!cat) return problema(res, 409, 'cursor_expired', 'Cursore scaduto');
    if (cat.ambito !== chiaveAmbito(q)) return problema(res, 400, 'scope_mismatch', 'Il cursore appartiene a un altro ambito (dataset, since, filtri o proiezione diversi)');
    if (pos === 'attesa') {
      if (cat.polls > 0) { cat.polls--; return json(res, 202, { snapshotId: snap, nextCursor: b64(`${snap}|attesa`), status: 'capturing' }, { 'Retry-After': String(stato.retryAfter) }); }
    }
    const da = pos === 'attesa' ? 0 : Number(pos);
    const items = cat.items.slice(da, da + size);
    const fine = da + size >= cat.items.length;
    return json(res, 200, { items, nextCursor: fine ? null : b64(`${snap}|${da + size}`), snapshotId: snap, syncToken: fine ? cat.syncToken : null, capturedAt: cat.capturedAt, totalCount: cat.items.length });
  }

  const api = {
    stato, meta,
    avvia: (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
    /** registra un cambio per il delta (e aggiorna i dati del completo per coerenza) */
    cambia(dataset, change, { filtro = null } = {}) {
      stato.versione++;
      stato.cambi.push({ versione: stato.versione, dataset, change: copia(change), filtro });
      if (!filtro) {
        const arr = stato.dati[dataset];
        const i = arr.findIndex((x) => x.id === change.id);
        if (change.operation === 'upsert') { if (i >= 0) arr[i] = copia(change.data); else arr.push(copia(change.data)); }
        else if (i >= 0) arr.splice(i, 1);
      }
    },
    inietta(status, { volte = 1, path = null, code = null, retryAfter = null, title = null, quando = null } = {}) { stato.iniezioni.push({ status, volte, path, code, retryAfter, title, quando }); },
    forza409(dataset, code = 'full_sync_required') { stato.forza409 = { ...(stato.forza409 || {}), [dataset]: code }; },
    statoId(dataset, id, operation, reason = null) { stato.statoIds.set(`${dataset}|${id}`, { operation, reason }); },
    richiesteDati: () => stato.richieste.filter((r) => r.path.startsWith('/api/v1/data/')),
  };
  return api;
}

// avvio da riga di comando per il collaudo manuale (porta da --port, password solo dall'ambiente)
if (process.argv[1] && process.argv[1].endsWith('fakeSynclab.mjs')) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 7199;
  const dati = process.env.FAKE_SYNCLAB_PROFILO ? datiProfilo({ n: Number(process.env.FAKE_SYNCLAB_PROFILO) || 72 }) : datiIniziali({ copie: Number(process.env.FAKE_SYNCLAB_COPIE || 3) });
  const f = creaFakeSynclab({ password: process.env.FAKE_SYNCLAB_PASSWORD || 'Fittizia-1!', copie: 0, dati, retryAfter: 1 });
  f.avvia(port).then((u) => console.log(`[fakeSynclab] in ascolto su ${u}`));
  // cambi dimostrativi per il delta, dopo il primo completo: si attivano con SIGUSR2
  process.on('SIGUSR2', () => {
    const r = JSON.parse(JSON.stringify(ESEMPI.changes[0].data)); r.items[0].netUnitPriceExcludingVat = 9.5;
    f.cambia('requests', { ...ESEMPI.changes[0], revision: `REV-${Date.now()}`, data: r });
    console.log('[fakeSynclab] cambio registrato per il delta');
  });
}
