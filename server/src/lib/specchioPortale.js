// Portali specchiati (Portale Service, Portale SGI) · lo specchio di un sito pubblico dentro la Suite, comune ai due moduli.
// Una sola fonte, due presentazioni identiche: il sito (Flask su Render, aggiornato dalla routine RSGI) resta la fonte; la Suite ne tiene
// uno specchio di sola lettura nello schema del modulo (tabelle contenuti, stato, impostazioni, file_cache: stessa forma nei due moduli).
// - specchio(): legge /api/meta e /data/*.json dall'origine; se meta.build o lo sha di un JSON cambia salva tutto e svuota la cache.
// - importaZip(): stessa pipeline a partire dallo ZIP del repo (fallback se il sito non risponde dalla rete di Render), con i file.
// - leggiFile(): un PDF dalla cache (archivio a due vie del modulo) o, se manca, scaricato dall'origine e messo in cache.
// - montaLinkStabili(): /<modulo>/p|m|doc/<codice> serviti dal server della Suite (PDF senza redirect, come app.py).
// Parametri per modulo: chiavi dei JSON, cartelle ammesse, messaggi, credenziali HTTP Basic dell'origine (SGI), colonne extra dello stato
// (Vademecum del Service). Nessuna scrittura verso il sito di origine: la Suite legge soltanto.
import path from 'node:path';
import yauzl from 'yauzl';
import { storeBuffer, dropBlobs, sendFile } from './moduleStorage.js';
import { HttpError } from './util.js';
import { getModuleState } from './modules.js';
import { shaJson, confrontaSpecchio, senzaNul, mimeDi, urlFile, radiceZip, normalizzaNomeZip, risolviLink } from './specchioRegole.js';

const UA = 'SuiteTD-specchio/1.0 (+https://suite.toscanadiagnostica.it)';

/**
 * Crea lo specchio di un portale.
 * opts: {
 *   key: schema e prefisso dell'archivio ('service' | 'sgi'); nome: nome del portale nei messaggi ('Portale Service');
 *   db: { q, one, many, tx } del modulo; config: { origineEnv, timeoutMs, fileMaxBytes }; origineDefault: URL predefinito;
 *   chiavi: JSON in data/ (meta compreso); percorsoValido(p); validaContenuti(c); costruisciIndice(docs, prep);
 *   descriviMeta(meta): testo dell'esito di "Prova l'origine";
 *   autorizzazione?: async () => 'Basic …' | null  (origine protetta: intestazione Authorization per JSON e file);
 *   percorsoProva?: percorso protetto da leggere in "Prova l'origine" oltre a /api/meta (verifica delle credenziali);
 *   suggerimentoCredenziali?: testo dell'errore 401 quando mancano le credenziali;
 *   aggiornaStato?: async (client, { fonte, extra }) dentro la transazione di sostituzione; extraDaZip?: (percorsi) => extra;
 * }
 */
export function creaSpecchio(opts) {
  const { key, nome, db, config, origineDefault, chiavi, percorsoValido, validaContenuti, costruisciIndice, descriviMeta } = opts;
  const { q, one, many, tx } = db;

  // ---------------------------------------------------------------- impostazioni
  async function getImpostazione(chiave, def = null) {
    const r = await one('SELECT valore FROM impostazioni WHERE chiave=$1', [chiave]);
    return r ? r.valore : def;
  }
  async function setImpostazione(chiave, valore, userId) {
    await q(`INSERT INTO impostazioni (chiave, valore, updated_by) VALUES ($1,$2,$3)
             ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore, updated_at=now(), updated_by=EXCLUDED.updated_by`, [chiave, JSON.stringify(valore), userId || null]);
  }
  /** Origine in uso: { url, fonte: 'env'|'impostazioni'|'predefinita' } (la variabile d'ambiente prevale). */
  async function origine() {
    if (config.origineEnv) return { url: config.origineEnv, fonte: 'env' };
    const v = await getImpostazione('origine');
    if (v && typeof v === 'string') return { url: v.replace(/\/+$/, ''), fonte: 'impostazioni' };
    return { url: origineDefault, fonte: 'predefinita' };
  }

  // ---------------------------------------------------------------- lettura dall'origine
  const autorizzazione = async (forzata) => (forzata !== undefined ? forzata : opts.autorizzazione ? opts.autorizzazione() : null);
  // 401 dall'origine: credenziali assenti o rifiutate. Il messaggio non contiene mai utente né password.
  const errore401 = (url, conCredenziali) => new HttpError(424, conCredenziali
    ? `L'origine ha rifiutato utente e password (HTTP 401 su ${url}): verificali in Impostazioni`
    : `L'origine è protetta da password (HTTP 401 su ${url}): ${opts.suggerimentoCredenziali || 'servono utente e password'}`);

  async function scarica(url, { timeoutMs = config.timeoutMs, accept = 'application/json', auth = null } = {}) {
    const headers = { 'User-Agent': UA, Accept: accept };
    if (auth) headers.Authorization = auth;
    let res;
    try { res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers }); }
    catch (e) { throw new HttpError(424, `Sito di origine non raggiungibile (${url}): ${e.cause?.code || e.name === 'TimeoutError' ? (e.cause?.code || 'timeout') : e.message}`); }
    return res;
  }
  async function jsonDa(url, auth) {
    const res = await scarica(url, { auth });
    if (res.status === 401 && opts.autorizzazione) { try { await res.body?.cancel(); } catch { /* chiuso */ } throw errore401(url, Boolean(auth)); }
    if (!res.ok) throw new HttpError(424, `${url} risponde ${res.status}`);
    const testo = await res.text();
    try { return { json: JSON.parse(testo), bytes: Buffer.byteLength(testo) }; } catch { throw new HttpError(424, `${url} non restituisce un JSON valido`); }
  }

  /** Legge i JSON dall'origine (meta da /api/meta, gli altri da /data/<chiave>.json). */
  async function leggiOrigine(base, { auth } = {}) {
    const b = base.replace(/\/+$/, '');
    const a = await autorizzazione(auth);
    const contenuti = {}; const bytes = {};
    const meta = await jsonDa(`${b}/api/meta`, a);
    contenuti.meta = meta.json; bytes.meta = meta.bytes;
    for (const k of chiavi.filter((x) => x !== 'meta')) {
      const r = await jsonDa(`${b}/data/${k}.json`, a);
      contenuti[k] = r.json; bytes[k] = r.bytes;
    }
    return { contenuti, bytes };
  }

  /** Prova dell'origine (Impostazioni): /api/meta (e il percorso protetto, se il portale lo prevede), con i tempi. Non salva nulla. */
  async function provaOrigine(url, { auth } = {}) {
    const t0 = Date.now();
    const b = url.replace(/\/+$/, '');
    try {
      const a = await autorizzazione(auth);
      const { json } = await jsonDa(`${b}/api/meta`, a);
      if (!json?.build) return { ok: false, message: `L'origine risponde ma /api/meta non contiene "build": non sembra il ${nome}`, ms: Date.now() - t0 };
      if (opts.percorsoProva) await jsonDa(`${b}${opts.percorsoProva}`, a);
      return { ok: true, message: `Origine raggiungibile: ${descriviMeta(json)}${opts.percorsoProva ? (a ? '; area protetta accessibile con le credenziali' : '; area documentale aperta') : ''}`, meta: json, ms: Date.now() - t0 };
    } catch (e) { return { ok: false, message: e.message, ms: Date.now() - t0 }; }
  }

  // ---------------------------------------------------------------- stato e contenuti
  async function statoSpecchio() {
    const s = await one('SELECT * FROM stato WHERE id=1');
    const righe = await many('SELECT chiave, sha256, bytes, fetched_at FROM contenuti ORDER BY chiave');
    return { ...(s || {}), contenuti: righe };
  }
  async function contenuto(chiave) {
    const r = await one('SELECT json, sha256 FROM contenuti WHERE chiave=$1', [chiave]);
    return r || null;
  }

  // Indice dei link stabili in memoria, ricostruito quando cambia lo sha di docs o preparazioni (anche se lo specchio lo aggiorna un'altra istanza)
  let indiceCache = { firma: null, indice: null };
  async function indice() {
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

  async function statoCache() {
    const r = await one(`SELECT count(*)::int AS n, coalesce(sum(size),0)::bigint AS bytes, count(*) FILTER (WHERE fonte='ZIP')::int AS da_zip FROM file_cache`);
    return { n: r.n, bytes: Number(r.bytes), da_zip: r.da_zip };
  }
  async function svuotaCache() {
    const rows = await many('DELETE FROM file_cache RETURNING blob_path');
    await dropBlobs(key, rows.map((r) => r.blob_path));
    return rows.length;
  }

  async function segnaErrore(msg) {
    await q(`UPDATE stato SET ultimo_errore=$1, ultimo_errore_at=now(), updated_at=now() WHERE id=1`, [String(msg).slice(0, 1000)]).catch(() => {});
  }

  /**
   * Pipeline comune (origine e ZIP): confronta con lo specchio salvato e, se è cambiato (o forza), sostituisce i contenuti, aggiorna lo
   * stato e svuota la cache dei file. Ritorna { cambiato, motivi, build }.
   */
  async function applica(contenuti, bytes, { fonte, origineUsata, forza = false, extra = {} } = {}) {
    for (const k of Object.keys(contenuti)) contenuti[k] = senzaNul(contenuti[k]);
    const errori = validaContenuti(contenuti);
    if (errori.length) throw new HttpError(422, `Contenuti non validi: ${errori.join('; ')}`);
    const sha = Object.fromEntries(chiavi.map((k) => [k, shaJson(contenuti[k])]));
    const prec = await one('SELECT build FROM stato WHERE id=1');
    const prevSha = Object.fromEntries((await many('SELECT chiave, sha256 FROM contenuti')).map((r) => [r.chiave, r.sha256]));
    const { cambiato, motivi } = confrontaSpecchio(Object.keys(prevSha).length ? { build: prec?.build, sha: prevSha } : null, { build: contenuti.meta.build, sha }, chiavi);
    if (!cambiato && !forza) {
      await q(`UPDATE stato SET ultima_lettura=now(), ultimo_errore=NULL, ultimo_errore_at=NULL, origine_usata=$1, fonte=$2, updated_at=now() WHERE id=1`, [origineUsata, fonte]);
      return { cambiato: false, motivi: [], build: contenuti.meta.build };
    }
    await tx(async (c) => {
      for (const k of chiavi) {
        await c.query(`INSERT INTO contenuti (chiave, json, sha256, bytes, fetched_at) VALUES ($1,$2,$3,$4,now())
          ON CONFLICT (chiave) DO UPDATE SET json=EXCLUDED.json, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, fetched_at=now()`, [k, JSON.stringify(contenuti[k]), sha[k], bytes?.[k] || 0]);
      }
      const m = contenuti.meta;
      await c.query(`UPDATE stato SET build=$1, reg006_rev=$2, reg006_data=$3, fonte=$4, origine_usata=$5, ultima_lettura=now(), ultimo_cambio=now(),
          ultimi_motivi=$6, ultimo_errore=NULL, ultimo_errore_at=NULL, updated_at=now() WHERE id=1`,
      [String(m.build), m.reg006_rev != null ? String(m.reg006_rev) : null, m.reg006_data || null, fonte, origineUsata, JSON.stringify(cambiato ? motivi : ['sostituzione forzata'])]);
      if (opts.aggiornaStato) await opts.aggiornaStato(c, { fonte, extra });
    });
    const rimossi = await svuotaCache();
    console.log(`[${key}] specchio aggiornato da ${fonte} (${origineUsata}): build ${contenuti.meta.build}; ${(cambiato ? motivi : ['forzato']).join(', ')}; cache svuotata (${rimossi} file)`);
    return { cambiato: true, motivi: cambiato ? motivi : ['sostituzione forzata'], build: contenuti.meta.build, cache_svuotata: rimossi };
  }

  let inCorso = null;
  /** Specchio dall'origine. Un solo aggiornamento alla volta per istanza; gli errori restano nello stato ("ultimo errore"). */
  function specchio(o2 = {}) {
    if (inCorso) return inCorso;
    inCorso = (async () => {
      const o = await origine();
      try {
        const { contenuti, bytes } = await leggiOrigine(o.url);
        return { ...(await applica(contenuti, bytes, { fonte: 'ORIGINE', origineUsata: o.url, forza: Boolean(o2.forza) })), origine: o.url };
      } catch (e) { await segnaErrore(e.message); throw e; }
    })().finally(() => { inCorso = null; });
    return inCorso;
  }

  // ---------------------------------------------------------------- ZIP del repo
  const apriZip = (file) => new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip))));
  const vociZip = (zip) => new Promise((resolve, reject) => {
    const out = [];
    zip.on('entry', (e) => { out.push(e); zip.readEntry(); });
    zip.on('end', () => resolve(out));
    zip.on('error', reject);
    zip.readEntry();
  });
  const leggiVoce = (zip, e) => new Promise((resolve, reject) => zip.openReadStream(e, (err, s) => {
    if (err) return reject(err);
    const chunks = []; s.on('data', (c) => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks))); s.on('error', reject);
  }));

  /**
   * Importa lo ZIP del repo (lo stesso che si esporta da GitHub): JSON da data/, file dalle cartelle ammesse. Sostituisce sempre lo
   * specchio (fonte ZIP) e riempie la cache con tutti i file. extraDaZip (facoltativo) ricava dai percorsi dati per lo stato.
   */
  async function importaZip(file, nomeZip) {
    const zip = await apriZip(file);
    try {
      const voci = (await vociZip(zip)).filter((e) => !/\/$/.test(e.fileName));
      const radice = radiceZip(voci.map((e) => e.fileName));
      if (radice == null) throw new HttpError(422, `Lo ZIP non contiene data/meta.json: non è il repo del ${nome}`);
      const per = new Map(voci.filter((e) => e.fileName.startsWith(radice)).map((e) => [normalizzaNomeZip(e.fileName.slice(radice.length)), e]));
      const contenuti = {}; const bytes = {};
      for (const k of chiavi) {
        const e = per.get(`data/${k}.json`);
        if (!e) continue;
        const buf = await leggiVoce(zip, e);
        try { contenuti[k] = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); bytes[k] = buf.length; } catch { throw new HttpError(422, `data/${k}.json nello ZIP non è un JSON valido`); }
      }
      const percorsi = [...per.keys()].filter((p) => percorsoValido(p) === p);
      const extra = opts.extraDaZip ? opts.extraDaZip(percorsi) : {};
      const esito = await applica(contenuti, bytes, { fonte: 'ZIP', origineUsata: `ZIP ${nomeZip || ''}`.trim(), forza: true, extra });
      let n = 0, tot = 0;
      for (const p of percorsi) {
        const e = per.get(p);
        if (e.uncompressedSize > config.fileMaxBytes) continue;
        const buf = await leggiVoce(zip, e);
        await salvaInCache(p, buf, { build: esito.build, fonte: 'ZIP' });
        n++; tot += buf.length;
      }
      return { ...esito, file: n, bytes: tot, radice: radice || '(radice)', ...extra };
    } finally { zip.close(); }
  }

  // ---------------------------------------------------------------- cache dei file
  async function salvaInCache(p, buf, { build, fonte }) {
    const mime = mimeDi(p);
    const st = await storeBuffer(key, 'cache', path.posix.basename(p), mime, buf);
    const r = await q(`INSERT INTO file_cache (percorso, mime, size, sha256, data, blob_path, build, fonte) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (percorso) DO NOTHING`, [p, mime, st.size, st.sha256, st.data, st.blob_path, build || null, fonte]);
    if (!r.rowCount && st.blob_path) await dropBlobs(key, [st.blob_path]);   // un'altra richiesta l'ha già messo in cache
    return { percorso: p, mime, size: st.size, sha256: st.sha256, data: buf, blob_path: null };
  }

  const inVolo = new Map();
  /**
   * File dello specchio: { file: { percorso, mime, size, data|blob_path, filename }, da: 'cache'|'origine' }.
   * 404 se il percorso non è ammesso o l'origine non ha il file; 424 se l'origine non risponde o chiede credenziali.
   */
  async function leggiFile(percorso) {
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
      const a = await autorizzazione();
      const res = await scarica(url, { accept: '*/*', auth: a });
      if (res.status === 404) throw new HttpError(404, 'Il file non è presente sul sito di origine');
      if (res.status === 401 && opts.autorizzazione) throw errore401(url, Boolean(a));
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

  return { getImpostazione, setImpostazione, origine, leggiOrigine, provaOrigine, statoSpecchio, contenuto, indice, statoCache, svuotaCache, specchio, importaZip, leggiFile };
}

/**
 * Consegna di un file dello specchio: intestazioni come il sito di origine (PDF inline, nosniff, cache di un'ora nel browser);
 * l'intestazione `intestazioneCache` (X-Service-Cache, X-SGI-Cache) dice se il file è arrivato dalla cache della Suite (HIT) o dal
 * sito di origine (MISS).
 */
export async function inviaFilePortale(res, file, { da, scarica = false, intestazioneCache }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader(intestazioneCache, da === 'cache' ? 'HIT' : 'MISS');
  if (file.sha256) res.setHeader('ETag', `"${file.sha256}"`);
  await sendFile(res, { mime: file.mime, filename: file.filename, data: file.data, blob_path: file.blob_path }, { inline: !scarica });
}

/**
 * Link stabili sotto il dominio della Suite: /<base>/p/<shortcut>, /<base>/m/<codice>, /<base>/doc/<codice> consegnano il PDF senza
 * redirect (come il sito di origine). Senza sessione → login e ritorno; modulo non attivo o specchio vuoto → pagina del modulo;
 * prestazione sconosciuta o con più preparazioni → urlElenco(codice); documento inesistente → urlNonTrovato(codice).
 * opts: { key, base ('/service'), specchio (creaSpecchio), invia(res, file, { da }), urlElenco, urlNonTrovato }.
 */
export function montaLinkStabili(app, { key, base, specchio, invia, urlElenco, urlNonTrovato }) {
  for (const tipo of ['p', 'm', 'doc']) {
    app.get(`${base}/${tipo}/:codice`, async (req, res, next) => {
      if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      try {
        const st = await getModuleState(key);
        const idx = st.mode === 'LIVE' ? await specchio.indice() : null;
        if (!idx) return res.redirect(base);
        const esito = risolviLink(tipo, req.params.codice, idx);
        if (!esito) return res.redirect(urlNonTrovato(req.params.codice));
        if (esito.elenco) return res.redirect(urlElenco(esito.elenco));
        const { file, da } = await specchio.leggiFile(esito.file);
        await invia(res, file, { da });
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return res.redirect(urlNonTrovato(req.params.codice));
        next(e);
      }
    });
  }
}
