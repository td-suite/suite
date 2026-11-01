// API del Portale Service (sotto /api/service, dopo requireAuth e requireModuleReady):
// - lettura per tutti gli autenticati: stato, JSON dello specchio, voci Servizi rimappate, verifica del Vademecum online, file;
// - EDITOR (e Owner/Admin della Suite): Impostazioni, "Prova l'origine", "Aggiorna adesso", ZIP del repo, cache dei file.
import os from 'node:os';
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { many } from '../../../db.js';
import { ah, audit, bad, parse, forbidden, notFound, HttpError, readLog } from '../../../lib/util.js';
import { activeModuleKeys, moduleHref, getModuleState } from '../../../lib/modules.js';
import { isAdmin } from '../../../lib/access.js';
import { isExternal, clienteService, organizzazioneClienteService, elencoClientiService } from '../../../lib/esterni.js';
import { config as suite } from '../../../config.js';
import { KEY, config, ORIGINE_DEFAULT } from '../config.js';
import { CHIAVI, mappaVoci, valutaIncorporamento } from '../lib/regole.js';
import { origine, setImpostazione, statoSpecchio, contenuto, conteggi, statoCache, svuotaCache, specchio, provaOrigine, importaZip, leggiFile, vademecumDisponibile } from '../lib/specchio.js';
import { inviaFile } from '../lib/invio.js';
import { mioSpazio, mioSpazioVista } from '../lib/mioSpazio.js';
import { orgRichiesta } from '../lib/mioSpazioRegole.js';

const r = Router();
export const isEditor = (req) => ['EDITOR', 'ADMIN'].includes(req.moduleUser?.role);
const requireEditor = (req, _res, next) => (isEditor(req) ? next() : next(forbidden('Riservato a chi gestisce il Portale Service (profilo Gestione contenuti)')));

r.get('/state', ah(async (req, res) => {
  const st = await getModuleState(KEY);
  const cs = await clienteService(req.user);
  const s = await statoSpecchio();
  const n = await conteggi();
  const o = await origine();
  res.json({
    mode: st.mode,
    user: { id: req.user.id, email: req.user.email, full_name: req.user.full_name, role: req.moduleUser.role, editor: isEditor(req), esterno: isExternal(req.user), cliente_service: Boolean(cs) },
    specchio: { caricato: Boolean(s.build), build: s.build, reg006_rev: s.reg006_rev, reg006_data: s.reg006_data, fonte: s.fonte, ultima_lettura: s.ultima_lettura, ultimo_cambio: s.ultimo_cambio, ultimo_errore: s.ultimo_errore, ultimo_errore_at: s.ultimo_errore_at },
    conteggi: { n_pdf: n.n_pdf, n_prestazioni: n.n_prestazioni, n_prep_collegate: n.n_prep_collegate },
    origine: o.url,
  });
}));

// ---- "Il mio spazio" (richiesta del CEO, 01/11/2026): solo per l'accesso esterno Cliente service (lib/esterni.js, riconoscimento con
// certezza: esterno, Legal entity CLIENTE con sedi SERVICE, grant dal profilo di sistema Cliente service). A tutti gli altri, interni e
// Partner ospitanti compresi, 404 "Non disponibile" senza alcun dato. Cache per utente di 60 s (?rinnova=1 per rileggere subito).
// Vista come Legal entity (01/11/2026): il personale TD (utenti non esterni) passa ?org_id=<Legal entity cliente service> e legge "Il mio
// spazio" di quel cliente, sezione per sezione nei limiti dei propri grant (lib/mioSpazio.js, mioSpazioVista); Legal entity non cliente
// service → 404. Per gli esterni org_id è ignorato: vale la loro Legal entity. La vista si registra nel read_log (utente, Legal entity).
r.get('/mio-spazio', ah(async (req, res) => {
  const rinnova = req.query.rinnova === '1';
  res.setHeader('Cache-Control', 'private, no-store');
  const orgId = orgRichiesta({ esterno: isExternal(req.user), orgId: req.query.org_id });
  if (orgId != null) {
    const org = await organizzazioneClienteService(orgId);
    if (!org) throw notFound('Non disponibile');
    await readLog(req, { module: KEY, entity: 'mio_spazio_vista', entityId: orgId });
    return res.json(await mioSpazioVista(req.user, org, { rinnova }));
  }
  const cs = await clienteService(req.user);
  if (!cs) throw notFound('Non disponibile');
  res.json(await mioSpazio(req.user, cs, { rinnova }));
}));

// Legal entity cliente service per il selettore "Visualizza come" (solo personale TD): id, nome, sedi SERVICE, accessi esterni
r.get('/clienti', ah(async (req, res) => {
  if (isExternal(req.user)) throw notFound('Non disponibile');
  res.json(await elencoClientiService());
}));

// JSON dello specchio così come sono sul sito (sola lettura). ETag = sha del contenuto: il browser riusa fulltext.json (1,5 MB)
r.get('/dati/:chiave', ah(async (req, res) => {
  if (!CHIAVI.includes(req.params.chiave)) throw notFound('Contenuto inesistente');
  const c = await contenuto(req.params.chiave);
  if (!c) throw Object.assign(new HttpError(404, 'Portale Service non ancora caricato: lo specchio del sito non è stato eseguito'), { code: 'SPECCHIO_VUOTO' });
  const etag = `"${c.sha256}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.json(c.json);
}));

// Voci del menu Servizi (menu.json) con la rimappatura del CEO: Vademecum interno, Circolari/Ordini/NC → widget della Suite.
// Il widget è "accessibile" con le stesse regole della home (grant, aperto a tutti, amministratori); href = /<modulo> se il modulo è
// dentro la Suite, altrimenti /go/<modulo>.
r.get('/servizi', ah(async (req, res) => {
  const menu = await contenuto('menu');
  const u = req.user;
  const mods = await many(`SELECT key, name, kind, legacy_url, route, restricted, open_to_all, active FROM public.modules WHERE key IN ('circolari','orders','nc','sgi','service')`);
  const active = await activeModuleKeys();
  const ext = isExternal(u);
  const moduli = new Map(mods.map((m) => {
    const vede = m.active && (Boolean(u.grants?.[m.key]) || m.open_to_all || (isAdmin(u) && !m.restricted) || u.level === 'OWNER' || (m.kind === 'PUBLIC' && !ext));
    return [m.key, { nome: m.name, href: moduleHref(m, active), accessibile: Boolean(vede) }];
  }));
  const suiteHosts = [];
  try { suiteHosts.push(new URL(suite.baseUrl).hostname); } catch { /* BASE_URL non valida */ }
  suiteHosts.push('suite.toscanadiagnostica.it', req.hostname);
  res.json({ voci: mappaVoci(menu?.json?.voci || [], moduli, { suiteHosts }), nota: menu?.json?._nota || null });
}));

// ---- Vademecum online: si può incorporare? (HEAD/GET di prova sul sito, cache 1 ora; ?rinnova=1 per chi gestisce il portale)
const provaCache = new Map();
async function provaFrame(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(config.provaFrameTimeoutMs), headers: { 'User-Agent': 'SuiteTD-verifica-frame/1.0', Accept: 'text/html' } });
    const headers = { 'x-frame-options': res.headers.get('x-frame-options'), 'content-security-policy': res.headers.get('content-security-policy') };
    try { await res.body?.cancel(); } catch { /* corpo già chiuso */ }
    return { ok: res.ok, status: res.status, url: res.url, headers: Object.fromEntries(Object.entries(headers).filter(([, v]) => v != null)) };
  } catch (e) { return { errore: e.cause?.code || (e.name === 'TimeoutError' ? 'timeout' : e.message) }; }
}
r.get('/vademecum/embeddabile', ah(async (req, res) => {
  const url = config.vademecumUrl;
  const suiteOrigin = `${req.protocol}://${req.get('host')}`;
  const ck = `${url}|${suiteOrigin}`;
  let v = provaCache.get(ck);
  if (!v || Date.now() - v.at > config.provaFrameCacheMs || (req.query.rinnova === '1' && isEditor(req))) {
    const risposta = await provaFrame(url);
    v = { at: Date.now(), ...valutaIncorporamento(risposta, suiteOrigin, url), status: risposta.status || null, intestazioni: risposta.headers || {}, errore: risposta.errore || null };
    provaCache.set(ck, v);
  }
  const pdf = v.consentito ? null : await vademecumDisponibile();
  res.json({ url, consentito: v.consentito, motivo: v.motivo, status: v.status, intestazioni: v.intestazioni, verificato_at: new Date(v.at).toISOString(), pdf });
}));

// ---- Newsletter di Agorà: il form Brevo (blog.json → newsletter.brevo_url) si può incorporare? Stessa prova del Vademecum, cache 1 ora.
// Se no (intestazioni che lo vietano, sito che non risponde) la pagina mostra subito campo e-mail + "Iscriviti" (mai un riquadro vuoto).
r.get('/newsletter/embeddabile', ah(async (req, res) => {
  const blog = await contenuto('blog');
  const url = blog?.json?.newsletter?.brevo_url || null;
  if (!url || !/^https?:\/\//i.test(url)) return res.json({ url: null, consentito: false, motivo: 'brevo_url assente in blog.json' });
  const suiteOrigin = `${req.protocol}://${req.get('host')}`;
  const ck = `${url}|${suiteOrigin}`;
  let v = provaCache.get(ck);
  if (!v || Date.now() - v.at > config.provaFrameCacheMs) {
    const risposta = await provaFrame(url);
    v = { at: Date.now(), ...valutaIncorporamento(risposta, suiteOrigin, url) };
    provaCache.set(ck, v);
  }
  res.json({ url, consentito: v.consentito, motivo: v.motivo, verificato_at: new Date(v.at).toISOString() });
}));

// ---- File dello specchio (PDF e loghi): dalla cache, altrimenti dal sito di origine e poi in cache
r.get('/file/*', ah(async (req, res) => {
  const { file, da } = await leggiFile(req.params[0]);
  await inviaFile(res, file, { da, scarica: req.query.dl === '1' });
}));

// ---------------------------------------------------------------- Impostazioni (EDITOR)
r.get('/impostazioni', requireEditor, ah(async (_req, res) => {
  const o = await origine();
  res.json({ origine: o.url, origine_fonte: o.fonte, origine_predefinita: ORIGINE_DEFAULT, vademecum_url: config.vademecumUrl, intervallo_ore: Math.round(config.specchioMinuti / 6) / 10,
    specchio: await statoSpecchio(), conteggi: await conteggi(), cache: await statoCache(), zip_max_mb: Math.round(config.zipMaxBytes / 1024 / 1024) });
}));
r.put('/impostazioni', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ origine: z.string().trim().url('Indirizzo dell\'origine non valido').max(300).regex(/^https?:\/\//, 'L\'origine deve iniziare con http:// o https://').nullable() }), req.body || {});
  if (config.origineEnv) throw bad('L\'origine è impostata dalla variabile d\'ambiente SERVICE_PORTAL_URL: si cambia su Render');
  await setImpostazione('origine', b.origine ? b.origine.replace(/\/+$/, '') : null, req.user.id);
  await audit(req, 'SERVICE_ORIGINE', { module: KEY, entity: 'impostazioni', label: b.origine || '(predefinita)' });
  res.json({ ok: true, origine: (await origine()).url });
}));
r.post('/impostazioni/prova', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ origine: z.string().trim().url().max(300).optional() }), req.body || {});
  res.json(await provaOrigine(b.origine || (await origine()).url));
}));
r.post('/aggiorna', requireEditor, ah(async (req, res) => {
  const forza = Boolean(req.body?.forza);
  const esito = await specchio({ forza });
  await audit(req, 'SERVICE_AGGIORNA', { module: KEY, entity: 'specchio', label: esito.cambiato ? `aggiornato: ${esito.motivi.join(', ')}` : 'nessun cambiamento', data: { build: esito.build, forza } });
  res.json(esito);
}));
r.post('/cache/svuota', requireEditor, ah(async (req, res) => {
  const n = await svuotaCache();
  await audit(req, 'SERVICE_CACHE_SVUOTATA', { module: KEY, entity: 'cache', label: `${n} file` });
  res.json({ ok: true, rimossi: n });
}));

// ZIP del repo (fallback): caricato su disco temporaneo, letto con yauzl, poi cancellato
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: config.zipMaxBytes, files: 1 } }).single('file');
const conUpload = (req, res, next) => upload(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, `ZIP troppo grande (massimo ${Math.round(config.zipMaxBytes / 1024 / 1024)} MB)`) : bad(e.message)) : next()));
r.post('/zip', requireEditor, conUpload, ah(async (req, res) => {
  const f = req.file;
  if (!f) throw bad('Nessun file ricevuto (campo "file")');
  try {
    if (!/\.zip$/i.test(f.originalname || '')) throw bad('Serve lo ZIP del repository (.zip)');
    const esito = await importaZip(f.path, f.originalname);
    await audit(req, 'SERVICE_ZIP', { module: KEY, entity: 'specchio', label: f.originalname, data: { build: esito.build, file: esito.file, bytes: esito.bytes } });
    res.json(esito);
  } finally { fs.promises.unlink(f.path).catch(() => {}); }
}));

export default r;
