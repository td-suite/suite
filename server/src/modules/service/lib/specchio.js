// Portale Service · specchio del sito pubblico service.toscanadiagnostica.it (una sola fonte, due presentazioni identiche).
// - specchio(): legge /api/meta e /data/*.json dall'origine; se meta.build o lo sha di un JSON cambia salva tutto (contenuti, stato)
//   e invalida la cache dei file. Lo chiama il job service:specchio (ogni 6 ore), "Aggiorna adesso" e il primo avvio del modulo.
// - importaZip(): stessa pipeline a partire dallo ZIP del repo (fallback se il sito non risponde dalla rete di Render), con i file.
// - leggiFile(): un PDF dalla cache (archivio a due vie del modulo) o, se manca, scaricato dall'origine e messo in cache.
// Nessuna scrittura verso il sito di origine: la Suite legge soltanto.
import path from 'node:path';
import yauzl from 'yauzl';
import { q, one, many, tx } from '../db.js';
import { storeBuffer, dropBlobs } from '../../../lib/moduleStorage.js';
import { HttpError } from '../../../lib/util.js';
import { config, ORIGINE_DEFAULT, VADEMECUM_PDF_DEFAULT } from '../config.js';
import { CHIAVI, shaJson, confrontaSpecchio, validaContenuti, percorsoValido, mimeDi, urlFile, costruisciIndice, radiceZip, normalizzaNomeZip, senzaNul } from './regole.js';

const UA = 'SuiteTD-specchio/1.0 (+https://suite.toscanadiagnostica.it)';

// ---------------------------------------------------------------- impostazioni
export async function getImpostazione(chiave, def = null) {
  const r = await one('SELECT valore FROM impostazioni WHERE chiave=$1', [chiave]);
  return r ? r.valore : def;
}
export async function setImpostazione(chiave, valore, userId) {
  await q(`INSERT INTO impostazioni (chiave, valore, updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore, updated_at=now(), updated_by=EXCLUDED.updated_by`, [chiave, JSON.stringify(valore), userId || null]);
}
/** Origine in uso: { url, fonte: 'env'|'impostazioni'|'predefinita' } (SERVICE_PORTAL_URL prevale). */
export async function origine() {
  if (config.origineEnv) return { url: config.origineEnv, fonte: 'env' };
  const v = await getImpostazione('origine');
  if (v && typeof v === 'string') return { url: v.replace(/\/+$/, ''), fonte: 'impostazioni' };
  return { url: ORIGINE_DEFAULT, fonte: 'predefinita' };
}

// ---------------------------------------------------------------- lettura dall'origine
async function scarica(url, { timeoutMs = config.timeoutMs, accept = 'application/json' } = {}) {
  let res;
  try { res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: accept } }); }
  catch (e) { throw new HttpError(424, `Sito di origine non raggiungibile (${url}): ${e.cause?.code || e.name === 'TimeoutError' ? (e.cause?.code || 'timeout') : e.message}`); }
  return res;
}
async function jsonDa(url) {
  const res = await scarica(url);
  if (!res.ok) throw new HttpError(424, `${url} risponde ${res.status}`);
  const testo = await res.text();
  try { return { json: JSON.parse(testo), bytes: Buffer.byteLength(testo) }; } catch { throw new HttpError(424, `${url} non restituisce un JSON valido`); }
}

/** Legge i nove JSON dall'origine (meta da /api/meta, gli altri da /data/<chiave>.json). */
export async function leggiOrigine(base) {
  const b = base.replace(/\/+$/, '');
  const contenuti = {}; const bytes = {};
  const meta = await jsonDa(`${b}/api/meta`);
  contenuti.meta = meta.json; bytes.meta = meta.bytes;
  for (const k of CHIAVI.filter((x) => x !== 'meta')) {
    const r = await jsonDa(`${b}/data/${k}.json`);
    contenuti[k] = r.json; bytes[k] = r.bytes;
  }
  return { contenuti, bytes };
}

/** Prova dell'origine (Impostazioni): /api/meta e /healthz, con i tempi. Non salva nulla. */
export async function provaOrigine(url) {
  const t0 = Date.now();
  try {
    const { json } = await jsonDa(`${url.replace(/\/+$/, '')}/api/meta`);
    if (!json?.build) return { ok: false, message: 'L\'origine risponde ma /api/meta non contiene "build": non sembra il Portale Service', ms: Date.now() - t0 };
    return { ok: true, message: `Origine raggiungibile: pubblicazione del ${json.build}, REG006 rev. ${json.reg006_rev} del ${json.reg006_data}, ${json.n_pdf} PDF, ${json.n_prestazioni} prestazioni`, meta: json, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, message: e.message, ms: Date.now() - t0 }; }
}

// ---------------------------------------------------------------- stato e contenuti
export async function statoSpecchio() {
  const s = await one('SELECT * FROM stato WHERE id=1');
  const righe = await many('SELECT chiave, sha256, bytes, fetched_at FROM contenuti ORDER BY chiave');
  return { ...(s || {}), contenuti: righe };
}
export async function contenuto(chiave) {
  const r = await one('SELECT json, sha256 FROM contenuti WHERE chiave=$1', [chiave]);
  return r || null;
}

// Indice dei link stabili in memoria, ricostruito quando cambia lo sha di docs o preparazioni (anche se lo specchio lo aggiorna un'altra istanza)
let indiceCache = { firma: null, indice: null };
export async function indice() {
  const shas = await many(`SELECT chiave, sha256 FROM contenuti WHERE chiave IN ('docs','preparazioni') ORDER BY chiave`);
  const firma = shas.map((r) => r.sha256).join(':');
  if (!firma) return null;
  if (indiceCache.firma !== firma) {
    const rows = await many(`SELECT chiave, json FROM contenuti WHERE chiave IN ('docs','preparazioni')`);
    const by = Object.fromEntries(rows.map((r) => [r.chiave, r.json]));
    indiceCache = { firma, indice: costruisciIndice(by.docs || [], by.preparazioni || {}) };
  }
  return indiceCache.indice;
}

/** Conteggi dello specchio confrontabili con meta.json (n_pdf = documenti in docs.json, n_prestazioni = righe di preparazioni.json). */
export async function conteggi() {
  const r = await one(`SELECT
      (SELECT jsonb_array_length(json) FROM contenuti WHERE chiave='docs') AS n_pdf,
      (SELECT jsonb_array_length(json->'righe') FROM contenuti WHERE chiave='preparazioni') AS n_prestazioni,
      (SELECT count(*) FROM jsonb_array_elements((SELECT json->'righe' FROM contenuti WHERE chiave='preparazioni')) x WHERE jsonb_array_length(coalesce(x->'link','[]'::jsonb)) > 0) AS n_prep_collegate,
      (SELECT json FROM contenuti WHERE chiave='meta') AS meta`);
  return { n_pdf: r?.n_pdf ?? null, n_prestazioni: r?.n_prestazioni ?? null, n_prep_collegate: r?.n_prep_collegate != null ? Number(r.n_prep_collegate) : null, meta: r?.meta || null };
}

export async function statoCache() {
  const r = await one(`SELECT count(*)::int AS n, coalesce(sum(size),0)::bigint AS bytes, count(*) FILTER (WHERE fonte='ZIP')::int AS da_zip FROM file_cache`);
  return { n: r.n, bytes: Number(r.bytes), da_zip: r.da_zip };
}
export async function svuotaCache() {
  const rows = await many('DELETE FROM file_cache RETURNING blob_path');
  await dropBlobs('service', rows.map((r) => r.blob_path));
  return rows.length;
}

async function segnaErrore(msg) {
  await q(`UPDATE stato SET ultimo_errore=$1, ultimo_errore_at=now(), updated_at=now() WHERE id=1`, [String(msg).slice(0, 1000)]).catch(() => {});
}

/**
 * Pipeline comune (origine e ZIP): confronta con lo specchio salvato e, se è cambiato (o forza), sostituisce i contenuti, aggiorna lo
 * stato e svuota la cache dei file. Ritorna { cambiato, motivi, build }.
 */
async function applica(contenuti, bytes, { fonte, origineUsata, forza = false, vademecumPdf } = {}) {
  for (const k of Object.keys(contenuti)) contenuti[k] = senzaNul(contenuti[k]);
  const errori = validaContenuti(contenuti);
  if (errori.length) throw new HttpError(422, `Contenuti non validi: ${errori.join('; ')}`);
  const sha = Object.fromEntries(CHIAVI.map((k) => [k, shaJson(contenuti[k])]));
  const prec = await one('SELECT build FROM stato WHERE id=1');
  const prevSha = Object.fromEntries((await many('SELECT chiave, sha256 FROM contenuti')).map((r) => [r.chiave, r.sha256]));
  const { cambiato, motivi } = confrontaSpecchio(Object.keys(prevSha).length ? { build: prec?.build, sha: prevSha } : null, { build: contenuti.meta.build, sha });
  if (!cambiato && !forza) {
    await q(`UPDATE stato SET ultima_lettura=now(), ultimo_errore=NULL, ultimo_errore_at=NULL, origine_usata=$1, fonte=$2, updated_at=now() WHERE id=1`, [origineUsata, fonte]);
    return { cambiato: false, motivi: [], build: contenuti.meta.build };
  }
  await tx(async (c) => {
    for (const k of CHIAVI) {
      await c.query(`INSERT INTO contenuti (chiave, json, sha256, bytes, fetched_at) VALUES ($1,$2,$3,$4,now())
        ON CONFLICT (chiave) DO UPDATE SET json=EXCLUDED.json, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, fetched_at=now()`, [k, JSON.stringify(contenuti[k]), sha[k], bytes?.[k] || 0]);
    }
    const m = contenuti.meta;
    await c.query(`UPDATE stato SET build=$1, reg006_rev=$2, reg006_data=$3, fonte=$4, origine_usata=$5, ultima_lettura=now(), ultimo_cambio=now(),
        ultimi_motivi=$6, ultimo_errore=NULL, ultimo_errore_at=NULL, vademecum_pdf=coalesce($7, CASE WHEN $4='ZIP' THEN NULL ELSE vademecum_pdf END), updated_at=now() WHERE id=1`,
    [String(m.build), m.reg006_rev != null ? String(m.reg006_rev) : null, m.reg006_data || null, fonte, origineUsata, JSON.stringify(cambiato ? motivi : ['sostituzione forzata']), vademecumPdf || null]);
  });
  const rimossi = await svuotaCache();
  console.log(`[service] specchio aggiornato da ${fonte} (${origineUsata}): build ${contenuti.meta.build}; ${(cambiato ? motivi : ['forzato']).join(', ')}; cache svuotata (${rimossi} file)`);
  return { cambiato: true, motivi: cambiato ? motivi : ['sostituzione forzata'], build: contenuti.meta.build, cache_svuotata: rimossi };
}

let inCorso = null;
/** Specchio dall'origine. Un solo aggiornamento alla volta per istanza; gli errori restano nello stato ("ultimo errore"). */
export function specchio(opts = {}) {
  if (inCorso) return inCorso;
  inCorso = (async () => {
    const o = await origine();
    try {
      const { contenuti, bytes } = await leggiOrigine(o.url);
      return { ...(await applica(contenuti, bytes, { fonte: 'ORIGINE', origineUsata: o.url, forza: Boolean(opts.forza) })), origine: o.url };
    } catch (e) { await segnaErrore(e.message); throw e; }
  })().finally(() => { inCorso = null; });
  return inCorso;
}

// ---------------------------------------------------------------- ZIP del repo
const apriZip = (file) => new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip))));
async function vociZip(zip) {
  return new Promise((resolve, reject) => {
    const out = [];
    zip.on('entry', (e) => { out.push(e); zip.readEntry(); });
    zip.on('end', () => resolve(out));
    zip.on('error', reject);
    zip.readEntry();
  });
}
const leggiVoce = (zip, e) => new Promise((resolve, reject) => zip.openReadStream(e, (err, s) => {
  if (err) return reject(err);
  const chunks = []; s.on('data', (c) => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks))); s.on('error', reject);
}));

/**
 * Importa lo ZIP del repo (lo stesso che il CEO esporta da GitHub): JSON da data/, PDF da docs/, stampabili/, certificati/,
 * vademecum/ e loghi da static/. Sostituisce sempre lo specchio (fonte ZIP) e riempie la cache con tutti i file.
 */
export async function importaZip(file, nome) {
  const zip = await apriZip(file);
  try {
    const voci = (await vociZip(zip)).filter((e) => !/\/$/.test(e.fileName));
    const radice = radiceZip(voci.map((e) => e.fileName));
    if (radice == null) throw new HttpError(422, 'Lo ZIP non contiene data/meta.json: non è il repo del Portale Service');
    const per = new Map(voci.filter((e) => e.fileName.startsWith(radice)).map((e) => [normalizzaNomeZip(e.fileName.slice(radice.length)), e]));
    const contenuti = {}; const bytes = {};
    for (const k of CHIAVI) {
      const e = per.get(`data/${k}.json`);
      if (!e) continue;
      const buf = await leggiVoce(zip, e);
      try { contenuti[k] = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); bytes[k] = buf.length; } catch { throw new HttpError(422, `data/${k}.json nello ZIP non è un JSON valido`); }
    }
    const file_ = [...per.keys()].map((p) => ({ p, ok: percorsoValido(p) })).filter((x) => x.ok === x.p);
    const vademecumPdf = file_.map((x) => x.p).filter((p) => p.startsWith('vademecum/')).sort()[0] || null;
    const esito = await applica(contenuti, bytes, { fonte: 'ZIP', origineUsata: `ZIP ${nome || ''}`.trim(), forza: true, vademecumPdf });
    let n = 0, tot = 0;
    for (const { p } of file_) {
      const e = per.get(p);
      if (e.uncompressedSize > config.fileMaxBytes) continue;
      const buf = await leggiVoce(zip, e);
      await salvaInCache(p, buf, { build: esito.build, fonte: 'ZIP' });
      n++; tot += buf.length;
    }
    return { ...esito, file: n, bytes: tot, radice: radice || '(radice)', vademecum_pdf: vademecumPdf };
  } finally { zip.close(); }
}

// ---------------------------------------------------------------- cache dei file
async function salvaInCache(p, buf, { build, fonte }) {
  const mime = mimeDi(p);
  const st = await storeBuffer('service', 'cache', path.posix.basename(p), mime, buf);
  const r = await q(`INSERT INTO file_cache (percorso, mime, size, sha256, data, blob_path, build, fonte) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (percorso) DO NOTHING`, [p, mime, st.size, st.sha256, st.data, st.blob_path, build || null, fonte]);
  if (!r.rowCount && st.blob_path) await dropBlobs('service', [st.blob_path]);   // un'altra richiesta l'ha già messo in cache
  return { percorso: p, mime, size: st.size, sha256: st.sha256, data: buf, blob_path: null };
}

const inVolo = new Map();
/**
 * File dello specchio: { file: { percorso, mime, size, data|blob_path, filename }, da: 'cache'|'origine' }.
 * 404 se il percorso non è ammesso o l'origine non ha il file; 502 se l'origine non risponde.
 */
export async function leggiFile(percorso) {
  const p = percorsoValido(percorso);
  if (!p) throw new HttpError(404, 'File non disponibile');
  const row = await one('SELECT percorso, mime, size, sha256, data, blob_path, build FROM file_cache WHERE percorso=$1', [p]);
  if (row) {
    q('UPDATE file_cache SET hits=hits+1, last_hit_at=now() WHERE percorso=$1', [p]).catch(() => {});
    return { file: { ...row, filename: path.posix.basename(p) }, da: 'cache' };
  }
  if (inVolo.has(p)) return inVolo.get(p);
  const pr = (async () => {
    const o = await origine();
    const url = urlFile(o.url, p);
    const res = await scarica(url, { accept: '*/*' });
    if (res.status === 404) throw new HttpError(404, 'Il file non è presente sul sito di origine');
    if (!res.ok) throw new HttpError(424, `Il sito di origine risponde ${res.status} per ${p}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > config.fileMaxBytes) throw new HttpError(413, 'File troppo grande');
    const buf = Buffer.from(await res.arrayBuffer());
    // il sito risponde con una pagina HTML (404 personalizzata, login di un proxy): non va in cache
    if (mimeDi(p) === 'application/pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(424, `Il sito di origine non ha restituito un PDF per ${p}`);
    const st = await one('SELECT build FROM stato WHERE id=1');
    const f = await salvaInCache(p, buf, { build: st?.build, fonte: 'ORIGINE' });
    return { file: { ...f, filename: path.posix.basename(p) }, da: 'origine' };
  })().finally(() => inVolo.delete(p));
  inVolo.set(p, pr);
  return pr;
}

/** PDF del Vademecum nello specchio: menu.json (voce vademecum, campo "pdf"), poi quello trovato nello ZIP, poi il predefinito. */
export async function vademecumPdf() {
  const menu = await contenuto('menu');
  const voce = (menu?.json?.voci || []).find((v) => v.id === 'vademecum');
  const daMenu = voce?.pdf && percorsoValido(voce.pdf);
  if (daMenu) return daMenu;
  const st = await one('SELECT vademecum_pdf FROM stato WHERE id=1');
  return st?.vademecum_pdf || VADEMECUM_PDF_DEFAULT;
}
/** Il PDF è disponibile (in cache o scaricabile adesso)? Lo scarica se manca: serve al ripiego della pagina Vademecum. */
export async function vademecumDisponibile() {
  const p = await vademecumPdf();
  try { await leggiFile(p); return { pdf: p, disponibile: true }; } catch (e) { return { pdf: p, disponibile: false, errore: e.message }; }
}
