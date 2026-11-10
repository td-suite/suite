// Synclab Data API v1: motore di sincronizzazione (ciclo completo, delta, ripresa, riallineamento conservativo) e lavoro notturno.
// Protocollo (docs/synclab-data-api/01_CONTRATTO_API.md, "Persistenza del consumer"):
//   carica l'ambito; pagina in sospeso → riprendi url, since e cursor salvati; altrimenti delta dal checkpoint confermato o completo;
//   finché 202 salva snapshotId e cursor e attendi Retry-After; ogni pagina 200 in UNA transazione (dati + avanzamento); all'ultima
//   pagina conferma syncToken come checkpoint. 409 cursor_expired → ciclo da capo senza cursor (checkpoint intatto); 409
//   full_sync_required o checkpoint oltre deltaWindowDays → nuovo completo fuso con la copia (RICONCILIAZIONE) e /sync/status per gli
//   id che non ricompaiono. Un lock per ambito (in_corso + lock_at, stantio dopo 2 ore) e una coda nel processo: una cattura alla volta.
// Architettura e lettura dei run: docs/SYNCLAB_DATA_API.md.
import { pool, one, many, q, tx } from '../../db.js';
import { getConnector, saveConnector } from '../connectors.js';
import * as API from './client.js';
import { upsertAggregato, appartenenza, applicaOperazione, svuotaDatiPaziente, TABELLE } from './persistenza.js';

export const { DATASETS, NOMI_DATASET } = API;
// v0.68.5: stati_erogati (stati dell'accettazione che valgono come produzione) e sync_intraday_minuti (delta delle accettazioni ogni N minuti
// fra le 7 e le 21 ora di Roma; 0 = spento). v0.68.6 (CEO 10/11/2026, quadratura con il report del gestionale): predefinito = ACCETTATO,
// tutti gli stati tranne 11 (NC mai arrivato); nuova sconto_testata (APPLICA | NON_APPLICARE, predefinita NON_APPLICARE = importi di riga
// come il report "Riepilogo Esami" di StudioLab).
export const STATI_EROGATI_PREDEFINITI = [10, 15, 18, 20, 25, 30, 40, 50];
export const STATI_EROGATI_V0685 = [18, 20, 25, 40, 50];
export const SCONTI_TESTATA = ['APPLICA', 'NON_APPLICARE'];
export const IMPOSTAZIONI_PREDEFINITE = { data_api_enabled: false, sync_ora: '02:30', page_size: 100, page_size_listini: 10, include_patient: false, data_api_timeout_ms: 120000, operating_company: '', datasets: [...API.DATASETS],
  stati_erogati: [...STATI_EROGATI_PREDEFINITI], sync_intraday_minuti: 60, sconto_testata: 'NON_APPLICARE' };
export const INTRADAY_DALLE = '07:00';
export const INTRADAY_ALLE = '21:00';
const LOCK_STANTIO_MS = 2 * 3600_000;
const ATTESA_MASSIMA_CATTURA_MS = 2 * 3600_000;   // oltre: errore, la pagina in sospeso resta e "Riprendi" continua con lo stesso cursor

// ---------------------------------------------------------------- impostazioni (connettore STUDIOLAB, settings jsonb)
export async function impostazioni() {
  const c = await getConnector('STUDIOLAB');
  const st = c.settings || {};
  const x = { ...IMPOSTAZIONI_PREDEFINITE };
  for (const k of Object.keys(x)) if (st[k] !== undefined && st[k] !== null && st[k] !== '') x[k] = st[k];
  x.data_api_enabled = st.data_api_enabled === true || st.data_api_enabled === 'true';
  x.include_patient = st.include_patient === true || st.include_patient === 'true';
  x.page_size = Math.max(1, Number(x.page_size) || 100);
  x.page_size_listini = Math.max(1, Number(x.page_size_listini) || 10);
  x.data_api_timeout_ms = Math.min(600_000, Math.max(5000, Number(x.data_api_timeout_ms) || 120000));
  x.sync_ora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.sync_ora)) ? String(x.sync_ora) : '02:30';
  const ds = Array.isArray(x.datasets) ? x.datasets : String(x.datasets || '').split(/[,\s]+/);
  x.datasets = API.DATASETS.filter((d) => ds.includes(d));
  x.operating_company = String(x.operating_company || '').trim();
  const se = (Array.isArray(x.stati_erogati) ? x.stati_erogati : String(x.stati_erogati || '').split(/[,;\s]+/)).map((v) => String(v).trim()).filter((v) => /^\d{1,3}$/.test(v)).map(Number);
  x.stati_erogati = se.length ? [...new Set(se)].sort((a, b) => a - b) : [...STATI_EROGATI_PREDEFINITI];
  x.sconto_testata = String(x.sconto_testata || '').trim().toUpperCase() === 'APPLICA' ? 'APPLICA' : 'NON_APPLICARE';
  const im = Number(x.sync_intraday_minuti);
  x.sync_intraday_minuti = Number.isFinite(im) && im >= 0 ? Math.min(720, Math.round(im)) : 60;
  return { ...x, client_name: c.credentials?.client_name || null, auth_kind: c.auth_kind, base_url: c.base_url, connettore_attivo: c.active };
}

/** Salva le impostazioni della Data API nel connettore; spegnere la proiezione paziente svuota i dati opt-in già importati. */
export async function salvaImpostazioni(patch, userId = null) {
  const prima = await impostazioni();
  const settings = {};
  for (const k of Object.keys(IMPOSTAZIONI_PREDEFINITE)) if (patch[k] !== undefined) settings[k] = patch[k];
  await saveConnector('STUDIOLAB', { settings }, userId);
  let svuotati = null;
  if (prima.include_patient && settings.include_patient === false) svuotati = await tx((c) => svuotaDatiPaziente(c));
  return { impostazioni: await impostazioni(), svuotati };
}

/** Filtri canonici dell'ambito: solo quelli ammessi per l'insieme di dati (gli altri il server li rifiuterebbe). */
export function filtriCanonici(dataset, { operatingCompany = null, clientId = null } = {}) {
  const f = {};
  const ammessi = API.FILTRI_AMMESSI[dataset] || [];
  if (clientId && ammessi.includes('clientId')) f.clientId = String(clientId);
  if (operatingCompany && ammessi.includes('operatingCompany')) f.operatingCompany = String(operatingCompany);
  return Object.fromEntries(Object.keys(f).sort().map((k) => [k, f[k]]));
}
const corrispondeFiltri = (dataset, d, f) => {
  if (f.clientId && (dataset === 'clients' ? String(d.id) : String(d.clientId ?? '')) !== f.clientId) return false;
  if (f.operatingCompany && String(d.operatingCompany ?? '') !== f.operatingCompany) return false;
  return true;
};

// ---------------------------------------------------------------- ambito e lock
export async function ambito({ instanceId, clientName, dataset, filtri = {}, includePatient = false }) {
  return one(`INSERT INTO synclab.sync_scope (instance_id, client_name, dataset, filtri_canonici, include_patient) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (instance_id, client_name, dataset, filtri_canonici, include_patient) DO UPDATE SET updated_at = synclab.sync_scope.updated_at RETURNING *`,
  [instanceId, clientName, dataset, JSON.stringify(filtri), Boolean(includePatient)]);
}
async function prendiLock(scopeId) {
  return one(`UPDATE synclab.sync_scope SET in_corso=TRUE, lock_at=now(), lock_pid=$2, updated_at=now()
     WHERE id=$1 AND (NOT in_corso OR lock_at IS NULL OR lock_at < now() - ($3 || ' milliseconds')::interval) RETURNING *`, [scopeId, `${process.pid}`, String(LOCK_STANTIO_MS)]);
}
const lasciaLock = (scopeId) => q('UPDATE synclab.sync_scope SET in_corso=FALSE, lock_at=NULL, lock_pid=NULL, updated_at=now() WHERE id=$1', [scopeId]);
const salvaSospeso = (c, scopeId, p) => c.query('UPDATE synclab.sync_scope SET pagina_in_sospeso=$2, updated_at=now() WHERE id=$1', [scopeId, p ? JSON.stringify(p) : null]);

// coda del processo: un solo ciclo alla volta sull'installazione (le richieste successive aspettano il loro turno)
let coda = Promise.resolve();
let inEsecuzione = null;
export const inCorso = () => inEsecuzione;
function inCoda(fn) { const p = coda.then(fn, fn); coda = p.catch(() => {}); return p; }

// ---------------------------------------------------------------- ciclo
/**
 * Un ciclo di un insieme di dati per l'ambito configurato. modo: AUTO (riprende la pagina in sospeso, altrimenti delta o completo),
 * COMPLETO (completo forzato: scarta la pagina in sospeso, fonde con la copia esistente), DELTA (come AUTO ma senza completo: errore
 * se manca il checkpoint). prova: { primaDelCommit(p), dopoCommit(p) } agganci per i test di interruzione.
 * Ritorna { dataset, scope_id, run_id, tipo, esito, pagine, record, conteggi, durata_ms } oppure { saltato }.
 */
export function eseguiCiclo(dataset, opzioni = {}) {
  const p = inCoda(() => cicloInterno(dataset, opzioni));
  // v0.68.5: dopo ogni ciclo riuscito dei clienti (completo o delta) si riallineano gli abbinamenti client ↔ Legal entity e sede
  if (dataset === 'clients' && opzioni.abbinamenti !== false) {
    p.then((r) => { if (r?.esito === 'OK') return import('./abbinamenti.js').then((A) => A.allineaAbbinamenti({ origine: `dopo il ciclo dei clienti (${(r.tipo || '').toLowerCase()})` })); return null; })
      .catch((e) => console.warn(`[synclab:abbinamenti] ${e.message}`));
  }
  return p;
}

async function cicloInterno(dataset, { modo = 'AUTO', filtri = null, includePatient = null, origine = 'MANUALE', prova = {} } = {}) {
  if (!API.DATASETS.includes(dataset)) throw new API.SynclabError(`Insieme di dati sconosciuto: ${dataset}`, { tipo: 'CONFIGURAZIONE' });
  const imp = await impostazioni();
  if (!imp.client_name) throw new API.SynclabError('Nome del client (client_name) non impostato nel connettore StudioLAB', { tipo: 'CONFIGURAZIONE' });
  const meta = await API.metadata();
  if (!meta?.instanceId) throw new API.SynclabError('I metadati della Data API non riportano instanceId', { tipo: 'CONFIGURAZIONE' });
  if (Array.isArray(meta.datasets) && meta.datasets.length && !meta.datasets.includes(dataset)) throw new API.SynclabError(`L'installazione non pubblica l'insieme di dati ${dataset}`, { tipo: 'CONFIGURAZIONE' });
  const f = filtri ? filtriCanonici(dataset, filtri) : filtriCanonici(dataset, { operatingCompany: imp.operating_company });
  // proiezione paziente: solo per le accettazioni (unico insieme con colonne paziente); i documenti restano sempre standard
  const ip = dataset === 'requests' ? Boolean(includePatient ?? imp.include_patient) : false;
  const sc = await ambito({ instanceId: meta.instanceId, clientName: imp.client_name, dataset, filtri: f, includePatient: ip });
  const lock = await prendiLock(sc.id);
  if (!lock) return { dataset, scope_id: sc.id, saltato: 'sincronizzazione già in corso per questo ambito' };
  const maxPage = Number(meta.maxPageSize) > 0 ? Number(meta.maxPageSize) : 500;
  const pageSize = Math.min(maxPage, dataset === 'price-lists' ? imp.page_size_listini : imp.page_size);
  inEsecuzione = { dataset, scope_id: sc.id, dal: new Date().toISOString(), origine };
  const ctx = { dataset, imp, meta, filtri: f, includePatient: ip, pageSize, origine, prova, t0: Date.now() };
  let forzaCompleto = modo === 'COMPLETO'; let riallinea = false; let riavvii = 0;
  try {
    for (;;) {
      try {
        return await passo(sc.id, ctx, { forzaCompleto, riallinea, soloDelta: modo === 'DELTA' });
      } catch (e) {
        const p = (await one('SELECT pagina_in_sospeso FROM synclab.sync_scope WHERE id=$1', [sc.id]))?.pagina_in_sospeso;
        if (e.tipo === 'CURSORE_SCADUTO' && riavvii++ < 2) {
          // il riferimento non vale più: ciclo da capo senza cursor, il checkpoint confermato resta quello di prima
          await chiudiRun(p?.run_id, { esito: 'INTERROTTO', errore: `cursore scaduto (${e.message}); ciclo ripreso da capo`, correlation_id: e.correlationId });
          await salvaSospeso(pool, sc.id, null);
          forzaCompleto = p?.tipo !== 'DELTA' && Boolean(p); riallinea = riallinea || p?.tipo === 'RICONCILIAZIONE';
          continue;
        }
        if (e.tipo === 'COMPLETO_RICHIESTO' && riavvii++ < 2) {
          await chiudiRun(p?.run_id, { esito: 'INTERROTTO', errore: `il server chiede un nuovo completo (${e.code}); avviato il riallineamento`, correlation_id: e.correlationId });
          await salvaSospeso(pool, sc.id, null);
          forzaCompleto = true; riallinea = true;
          continue;
        }
        if (e.tipo === 'CATTURA_FALLITA') await salvaSospeso(pool, sc.id, null);   // fotografia fallita: si riparte dal checkpoint confermato
        await chiudiRun(p?.run_id, { esito: 'ERRORE', errore: e.message, correlation_id: e.correlationId || null, durata_ms: Date.now() - ctx.t0 });
        await esitoAmbito(sc.id, { stato: 'ERRORE', errore: e.message, correlationId: e.correlationId || null, tipo_errore: e.tipo || null, run_id: p?.run_id || null, durata_ms: Date.now() - ctx.t0 });
        throw e;
      }
    }
  } finally {
    inEsecuzione = null;
    await lasciaLock(sc.id).catch(() => {});
  }
}

async function chiudiRun(runId, { esito, errore = null, correlation_id = null, durata_ms = null }) {
  if (!runId) return;
  await q(`UPDATE synclab.sync_run SET esito=$2, errore=$3, correlation_id=coalesce($4, correlation_id), finito=now(), durata_ms=coalesce($5, durata_ms) WHERE id=$1`, [runId, esito, errore ? String(errore).slice(0, 1000) : null, correlation_id, durata_ms]);
}
const esitoAmbito = (scopeId, x) => q('UPDATE synclab.sync_scope SET ultimo_esito=$2, updated_at=now() WHERE id=$1', [scopeId, JSON.stringify({ ...x, at: new Date().toISOString() })]);

async function passo(scopeId, ctx, { forzaCompleto, riallinea, soloDelta }) {
  const { dataset } = ctx;
  let sc = await one('SELECT * FROM synclab.sync_scope WHERE id=$1', [scopeId]);
  let p = forzaCompleto ? null : sc.pagina_in_sospeso;
  if (forzaCompleto && sc.pagina_in_sospeso) await salvaSospeso(pool, scopeId, null);
  if (!p) {
    const giorni = Number(ctx.meta.deltaWindowDays) > 0 ? Number(ctx.meta.deltaWindowDays) : null;
    const scaduto = Boolean(sc.checkpoint && giorni && sc.checkpoint_at && Date.now() - new Date(sc.checkpoint_at).getTime() > giorni * 86400_000);
    const completo = forzaCompleto || !sc.checkpoint || scaduto;
    if (completo && soloDelta) throw new API.SynclabError(scaduto ? `Checkpoint oltre la finestra di ${giorni} giorni: serve un completo` : 'Nessun checkpoint confermato: serve un completo', { tipo: 'CONFIGURAZIONE' });
    const locali = completo ? Number((await one('SELECT count(*)::int AS n FROM synclab.scope_records WHERE scope_id=$1', [scopeId])).n) : 0;
    const tipo = !completo ? 'DELTA' : (riallinea || scaduto) ? 'RICONCILIAZIONE' : 'COMPLETO';
    const run = await one(`INSERT INTO synclab.sync_run (scope_id, dataset, tipo, origine, prima_importazione) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [scopeId, dataset, tipo, ctx.origine, completo && !sc.ultimo_completo_at]);
    p = completo
      ? { tipo, riconcilia: locali > 0, fase: 'PAGINE', run_id: run.id, path: `/api/v1/data/${dataset}`, query: API.queryPagina(dataset, { pageSize: ctx.pageSize, includePatient: ctx.includePatient, filtri: ctx.filtri }), cursor: null, snapshot_id: null, pagine_fatte: 0, record_fatti: 0, iniziato: new Date().toISOString() }
      : { tipo, riconcilia: false, fase: 'PAGINE', run_id: run.id, path: '/api/v1/data/sync/changes', query: API.queryDelta(dataset, { since: sc.checkpoint, pageSize: ctx.pageSize, includePatient: ctx.includePatient, filtri: ctx.filtri }), cursor: null, snapshot_id: null, pagine_fatte: 0, record_fatti: 0, iniziato: new Date().toISOString() };
    await salvaSospeso(pool, scopeId, p);
  } else {
    await q(`UPDATE synclab.sync_run SET esito='IN_CORSO', errore=NULL, finito=NULL, origine=CASE WHEN origine IS NULL THEN $2 ELSE origine END WHERE id=$1`, [p.run_id, 'RIPRESA']);
  }
  const completo = p.tipo !== 'DELTA';
  let attesa = 0; let correlation = null;
  // ---- pagine
  while (p.fase === 'PAGINE') {
    const r = await API.get(p.path, { ...p.query, cursor: p.cursor || undefined }, { logInfo: { dataset } });
    if (r.pending) {
      if (!r.nextCursor) throw new API.SynclabError('Risposta 202 senza nextCursor: impossibile seguire la cattura', { tipo: 'TRANSITORIO' });
      p = { ...p, cursor: r.nextCursor, snapshot_id: r.snapshotId || p.snapshot_id };
      await salvaSospeso(pool, scopeId, p);
      attesa += r.retryAfter * 1000;
      await q('UPDATE synclab.sync_run SET attesa_ms = attesa_ms + $2 WHERE id=$1', [p.run_id, Math.round(r.retryAfter * 1000)]);
      if (attesa > ATTESA_MASSIMA_CATTURA_MS) throw new API.SynclabError(`Cattura ancora in corso dopo ${Math.round(attesa / 60000)} minuti: riprendere più tardi (stesso riferimento)`, { tipo: 'TRANSITORIO' });
      await API.attendi(r.retryAfter * 1000);
      continue;
    }
    const page = r.data;
    if (!page || !Array.isArray(page.items)) throw new API.SynclabError('Pagina non nel formato previsto (manca items)', { tipo: 'TRANSITORIO' });
    correlation = r.correlationId || correlation;
    const ultima = !page.nextCursor;
    if (ultima && !page.syncToken) throw new API.SynclabError('Ultima pagina senza syncToken: checkpoint non confermabile', { tipo: 'TRANSITORIO' });
    const conti = { upsert: 0, remove: 0, fuori_ambito: 0, archived: 0, unavailable: 0, gia_applicati: 0, sconosciute: 0 };
    const capturedAt = page.capturedAt || null;
    const prossimo = await tx(async (c) => {
      const scope = { id: scopeId, include_patient: ctx.includePatient };
      for (const it of page.items) {
        if (completo) {
          await upsertAggregato(c, { instanceId: ctx.meta.instanceId, dataset, d: it, revision: null, capturedAt, includePatient: ctx.includePatient });
          await appartenenza(c, { scopeId, id: it.id, stato: 'ATTIVO', operation: 'completo' });
          if (p.riconcilia) await c.query('INSERT INTO synclab.run_visti (run_id, id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.run_id, String(it.id)]);
          conti.upsert++;
        } else {
          // idempotenza su (id, revision): la stessa operazione con la stessa revisione già applicata non si ripete
          const gia = it.revision != null ? (await c.query('SELECT 1 FROM synclab.scope_records WHERE scope_id=$1 AND id=$2 AND revision=$3 AND operation=$4', [scopeId, String(it.id), String(it.revision), it.operation])).rowCount : 0;
          if (gia) { conti.gia_applicati++; continue; }
          const k = await applicaOperazione(c, { scope, instanceId: ctx.meta.instanceId, dataset, id: it.id, operation: it.operation, reason: it.reason ?? null, revision: it.revision != null ? String(it.revision) : null, data: it.data, capturedAt });
          conti[k] = (conti[k] || 0) + 1;
        }
      }
      if (ctx.prova.primaDelCommit) await ctx.prova.primaDelCommit(p);
      const nuovo = { ...p, pagine_fatte: p.pagine_fatte + 1, record_fatti: p.record_fatti + page.items.length, snapshot_id: page.snapshotId || p.snapshot_id };
      if (!ultima) {
        nuovo.cursor = page.nextCursor;
        await salvaSospeso(c, scopeId, nuovo);
      } else {
        // ultima pagina: il syncToken diventa il checkpoint confermato insieme ai dati (stessa transazione)
        nuovo.cursor = null; nuovo.fase = p.riconcilia ? 'STATUS' : 'FINE';
        await c.query(`UPDATE synclab.sync_scope SET checkpoint=$2, checkpoint_at=$3, pagina_in_sospeso=$4, ultimo_completo_at=CASE WHEN $5 THEN now() ELSE ultimo_completo_at END, updated_at=now() WHERE id=$1`,
          [scopeId, page.syncToken, capturedAt, nuovo.fase === 'STATUS' ? JSON.stringify(nuovo) : null, completo]);
      }
      await c.query(`UPDATE synclab.sync_run SET pagine=pagine+1, record=record+$2, upsert=upsert+$3, remove=remove+$4, fuori_ambito=fuori_ambito+$5, archived=archived+$6, unavailable=unavailable+$7, gia_applicati=gia_applicati+$8,
          correlation_id=coalesce($9, correlation_id) WHERE id=$1`, [p.run_id, page.items.length, conti.upsert, conti.remove, conti.fuori_ambito, conti.archived, conti.unavailable, conti.gia_applicati, r.correlationId || null]);
      return nuovo;
    });
    p = prossimo;
    if (ctx.prova.dopoCommit) await ctx.prova.dopoCommit(p);
  }
  // ---- riconciliazione degli id che non sono ricomparsi nel completo (fusione conservativa: l'assenza non è una cancellazione)
  if (p.fase === 'STATUS') {
    await riconcilia(scopeId, ctx, p);
    await q('DELETE FROM synclab.run_visti WHERE run_id=$1', [p.run_id]);
    await salvaSospeso(pool, scopeId, null);
  }
  const run = await one(`UPDATE synclab.sync_run SET esito='OK', finito=now(), errore=NULL, durata_ms=round(extract(epoch FROM now() - iniziato) * 1000)::int WHERE id=$1 RETURNING *`, [p.run_id]);
  const conteggi = { upsert: run.upsert, remove: run.remove, fuori_ambito: run.fuori_ambito, archived: run.archived, unavailable: run.unavailable, gia_applicati: run.gia_applicati, verificati: run.verificati };
  await esitoAmbito(scopeId, { stato: 'OK', errore: null, correlationId: run.correlation_id || correlation, durata_ms: run.durata_ms, pagine: run.pagine, record: run.record, conteggi, run_id: run.id, tipo: run.tipo });
  return { dataset, scope_id: scopeId, run_id: run.id, tipo: run.tipo, esito: 'OK', pagine: run.pagine, record: run.record, conteggi, durata_ms: run.durata_ms, prima_importazione: run.prima_importazione };
}

async function riconcilia(scopeId, ctx, p) {
  const { dataset } = ctx;
  const ids = (await many(`SELECT r.id FROM synclab.scope_records r WHERE r.scope_id=$1 AND r.stato <> 'RIMOSSO_STATO_ESCLUSO'
      AND NOT EXISTS (SELECT 1 FROM synclab.run_visti v WHERE v.run_id=$2 AND v.id=r.id) ORDER BY r.id`, [scopeId, p.run_id])).map((x) => x.id);
  const conti = { upsert: 0, remove: 0, fuori_ambito: 0, archived: 0, unavailable: 0, sconosciute: 0 };
  for (let i = 0; i < ids.length; i += 200) {
    const blocco = ids.slice(i, i + 200);
    const esiti = await API.stato(dataset, blocco);
    for (const x of esiti) {
      if (!x || x.id == null) continue;
      let op = x.operation; let data = null;
      if (op === 'available') {
        data = await API.dettaglio(dataset, x.id, { includePatient: ctx.includePatient });
        if (!data) { conti.sconosciute++; continue; }   // 404: assente o escluso, nessuna cancellazione
        if (!corrispondeFiltri(dataset, data, ctx.filtri)) { op = 'remove'; x.reason = 'out_of_scope'; data = null; }
      }
      const k = await tx((c) => applicaOperazione(c, { scope: { id: scopeId, include_patient: ctx.includePatient }, instanceId: ctx.meta.instanceId, dataset, id: x.id, operation: op, reason: x.reason ?? null, data }));
      conti[k] = (conti[k] || 0) + 1;
    }
    await q(`UPDATE synclab.sync_run SET verificati=verificati+$2 WHERE id=$1`, [p.run_id, blocco.length]);
  }
  await q(`UPDATE synclab.sync_run SET upsert=upsert+$2, remove=remove+$3, fuori_ambito=fuori_ambito+$4, archived=archived+$5, unavailable=unavailable+$6 WHERE id=$1`,
    [p.run_id, conti.upsert, conti.remove, conti.fuori_ambito, conti.archived, conti.unavailable]);
  return conti;
}

// ---------------------------------------------------------------- tutti gli insiemi di dati
/** Ciclo degli insiemi di dati configurati, uno alla volta nell'ordine exams, clients, price-lists, requests, invoices. */
export async function eseguiTutti({ datasets = null, modo = 'AUTO', origine = 'MANUALE' } = {}) {
  const imp = await impostazioni();
  const elenco = (datasets && datasets.length ? API.DATASETS.filter((d) => datasets.includes(d)) : imp.datasets);
  const out = [];
  for (const d of elenco) {
    try { out.push(await eseguiCiclo(d, { modo, origine })); }
    catch (e) { out.push({ dataset: d, esito: 'ERRORE', errore: e.message, correlationId: e.correlationId || null }); }
  }
  return { esito: out.every((x) => x.esito === 'OK' || x.saltato) ? 'OK' : 'ERRORE', insiemi: out };
}

// ---------------------------------------------------------------- stato per l'interfaccia (mai checkpoint né cursori)
export async function statoSincronizzazione() {
  const imp = await impostazioni();
  const scopes = await many(`SELECT s.id, s.instance_id, s.client_name, s.dataset, s.filtri_canonici, s.include_patient, s.checkpoint IS NOT NULL AS ha_checkpoint, s.checkpoint_at, s.ultimo_completo_at,
      s.pagina_in_sospeso IS NOT NULL AS in_sospeso, s.pagina_in_sospeso->>'tipo' AS sospeso_tipo, s.pagina_in_sospeso->>'fase' AS sospeso_fase, (s.pagina_in_sospeso->>'pagine_fatte')::int AS sospeso_pagine,
      (s.pagina_in_sospeso->>'record_fatti')::int AS sospeso_record, s.in_corso, s.lock_at, s.ultimo_esito, s.updated_at,
      (SELECT count(*)::int FROM synclab.scope_records r WHERE r.scope_id = s.id AND r.stato = 'ATTIVO') AS record_attivi,
      (SELECT row_to_json(x) FROM (SELECT id, tipo, esito, iniziato, finito, durata_ms, pagine, record, errore, correlation_id FROM synclab.sync_run WHERE scope_id = s.id ORDER BY iniziato DESC LIMIT 1) x) AS ultimo_run
    FROM synclab.sync_scope s ORDER BY s.dataset, s.updated_at DESC`);
  const conteggi = {};
  for (const [d, t] of Object.entries(TABELLE)) {
    conteggi[d] = await one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE disponibilita='ATTIVO')::int AS attivi, count(*) FILTER (WHERE disponibilita<>'ATTIVO')::int AS altri FROM ${t}`);
  }
  const atteso = (d) => ({ filtri: filtriCanonici(d, { operatingCompany: imp.operating_company }), include_patient: d === 'requests' ? imp.include_patient : false });
  const insiemi = API.DATASETS.map((d) => {
    const a = atteso(d);
    const mine = scopes.filter((s) => s.dataset === d);
    const corrente = mine.find((s) => s.client_name === imp.client_name && JSON.stringify(s.filtri_canonici) === JSON.stringify(a.filtri) && s.include_patient === a.include_patient) || null;
    return { dataset: d, nome: NOMI_DATASET[d], abilitato: imp.datasets.includes(d), ambito: corrente, altri_ambiti: mine.filter((s) => s !== corrente), locali: conteggi[d] };
  });
  const notturno = (await one(`SELECT value FROM app_settings WHERE key='synclab.notturno'`))?.value || null;
  const intraday = (await one(`SELECT value FROM app_settings WHERE key='synclab.intraday'`))?.value || null;
  const { client_name, auth_kind, base_url, connettore_attivo, ...impostazioniPubbliche } = imp;
  return { impostazioni: impostazioniPubbliche, connettore: { client_name, auth_kind, base_url, attivo: connettore_attivo }, insiemi, in_corso: inEsecuzione, notturno, intraday,
    giorno: { dalle: INTRADAY_DALLE, alle: INTRADAY_ALLE } };
}
export const ultimiRun = (limit = 20) => many(`SELECT r.id, r.scope_id, r.dataset, r.tipo, r.origine, r.iniziato, r.finito, r.esito, r.pagine, r.record, r.upsert, r.remove, r.fuori_ambito, r.archived, r.unavailable,
    r.gia_applicati, r.verificati, r.durata_ms, r.attesa_ms, r.prima_importazione, r.errore, r.correlation_id, s.include_patient, s.filtri_canonici
  FROM synclab.sync_run r JOIN synclab.sync_scope s ON s.id = r.scope_id ORDER BY r.iniziato DESC, r.id DESC LIMIT $1`, [limit]);

// ---------------------------------------------------------------- lavoro notturno
const oraRoma = (d = new Date()) => d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
const oggiRoma = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
/** Il ciclo notturno è da eseguire? Data API accesa, ora di Roma ≥ sync_ora, oggi non ancora completato (al più 3 tentativi). */
export function daEseguire({ imp, stato, ora, oggi }) {
  if (!imp.data_api_enabled) return { esegui: false, motivo: 'Data API non abilitata' };
  if (ora < imp.sync_ora) return { esegui: false, motivo: `prima delle ${imp.sync_ora}` };
  if (stato?.data === oggi && (stato.esito === 'OK' || Number(stato.tentativi || 0) >= 3)) return { esegui: false, motivo: 'già eseguito oggi' };
  return { esegui: true };
}
export async function cicloNotturno({ adesso = new Date() } = {}) {
  const imp = await impostazioni();
  const stato = (await one(`SELECT value FROM app_settings WHERE key='synclab.notturno'`))?.value || null;
  const oggi = oggiRoma(adesso);
  const d = daEseguire({ imp, stato, ora: oraRoma(adesso), oggi });
  if (!d.esegui) return { saltato: d.motivo };
  await q(`DELETE FROM synclab.sync_run WHERE iniziato < now() - interval '90 days'`);
  const t0 = Date.now();
  const r = await eseguiTutti({ origine: 'NOTTURNO' });
  const v = { data: oggi, esito: r.esito, tentativi: (stato?.data === oggi ? Number(stato.tentativi || 0) : 0) + 1, durata_ms: Date.now() - t0, at: new Date().toISOString(), insiemi: r.insiemi.map((x) => ({ dataset: x.dataset, esito: x.esito || (x.saltato ? 'SALTATO' : null), record: x.record ?? null, errore: x.errore || null })) };
  await q(`INSERT INTO app_settings (key, value) VALUES ('synclab.notturno', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(v)]);
  return v;
}
// ---------------------------------------------------------------- aggiornamento di giorno (v0.68.5)
// "Il delta delle accettazioni oggi gira solo di notte": con sync_intraday_minuti > 0 (predefinito 60) fra le 7 e le 21 ora di Roma il
// job esegue il DELTA delle accettazioni ogni N minuti, così la produzione erogata del giorno si aggiorna nei cruscotti. Un ciclo alla
// volta: stessa coda e stesso lock dell'ambito del notturno (un ciclo in corso fa saltare il turno). Solo con la Data API accesa.
/** Il delta di giorno è da eseguire? Puro: { esegui, motivo }. stato = { at, esito } dell'ultimo delta di giorno. */
export function intradayDaEseguire({ imp, stato = null, ora, adesso = new Date(), inCorso: occupato = null }) {
  if (!imp.data_api_enabled) return { esegui: false, motivo: 'Data API non abilitata' };
  const n = Number(imp.sync_intraday_minuti) || 0;
  if (n <= 0) return { esegui: false, motivo: 'aggiornamento di giorno spento (0 minuti)' };
  if (ora < INTRADAY_DALLE || ora >= INTRADAY_ALLE) return { esegui: false, motivo: `fuori dalla fascia ${INTRADAY_DALLE}-${INTRADAY_ALLE}` };
  if (occupato) return { esegui: false, motivo: 'un ciclo è già in corso' };
  if (stato?.at && adesso.getTime() - Date.parse(stato.at) < n * 60_000 - 30_000) return { esegui: false, motivo: `ultimo aggiornamento meno di ${n} minuti fa` };
  return { esegui: true };
}
export async function cicloIntraday({ adesso = new Date() } = {}) {
  const imp = await impostazioni();
  const stato = (await one(`SELECT value FROM app_settings WHERE key='synclab.intraday'`))?.value || null;
  const d = intradayDaEseguire({ imp, stato, ora: oraRoma(adesso), adesso, inCorso: inEsecuzione });
  if (!d.esegui) return { saltato: d.motivo };
  const t0 = Date.now();
  let v;
  try {
    const r = await eseguiCiclo('requests', { modo: 'DELTA', origine: 'GIORNO' });
    v = { at: new Date().toISOString(), esito: r.saltato ? 'SALTATO' : r.esito, record: r.record ?? null, motivo: r.saltato || null, durata_ms: Date.now() - t0 };
  } catch (e) { v = { at: new Date().toISOString(), esito: 'ERRORE', errore: String(e.message).slice(0, 300), durata_ms: Date.now() - t0 }; }
  await q(`INSERT INTO app_settings (key, value) VALUES ('synclab.intraday', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(v)]);
  return v;
}

export function registerSynclabJobs(registerJob) {
  registerJob('synclab:notturno', 15, () => cicloNotturno(), { runAtStart: false });
  registerJob('synclab:intraday', 5, () => cicloIntraday(), { runAtStart: false });
  // abbinamenti client ↔ Legal entity e sede: dopo ogni ciclo riuscito dei clients (eseguiCiclo) e comunque ogni 6 ore
  registerJob('synclab:abbinamenti', 360, async () => {
    const d = await one(`SELECT count(*)::int AS n FROM synclab.clients WHERE disponibilita = 'ATTIVO'`).catch(() => null);
    if (!d?.n) return { saltato: 'nessun client Synclab importato' };
    const A = await import('./abbinamenti.js');
    const r = await A.allineaAbbinamenti({ origine: 'job synclab:abbinamenti' });
    return { abbinati: r.abbinati.length, codici_scritti: r.codici_scritti.length, ambigui: r.ambigui.length, sede_da_scegliere: r.sede_da_scegliere.length };
  }, { runAtStart: false });
}
