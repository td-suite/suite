// API del Portale SGI (sotto /api/sgi, dopo requireAuth e requireModuleReady):
// - lettura per tutti gli autenticati: stato, JSON dello specchio, codici dei documenti (per il Portale Service), file;
// - EDITOR (e Owner/Admin della Suite): Impostazioni (origine e credenziali dell'origine), "Prova l'origine", "Aggiorna adesso",
//   ZIP del repository, cache dei file. La password dell'origine non esce mai: le Impostazioni ricevono solo se è impostata.
import os from 'node:os';
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ah, audit, bad, parse, forbidden, notFound, HttpError } from '../../../lib/util.js';
import { getModuleState } from '../../../lib/modules.js';
import { isExternal } from '../../../lib/esterni.js';
import { KEY, config, ORIGINE_DEFAULT, UTENTE_PREDEFINITO } from '../config.js';
import { CHIAVI, codiciBase, urlConCredenziali, autorizzazioneSgi } from '../lib/regole.js';
import { origine, setImpostazione, statoSpecchio, contenuto, conteggi, statoCache, svuotaCache, specchio, provaOrigine, importaZip, leggiFile, credenziali, salvaCredenziali } from '../lib/specchio.js';
import { inviaFile } from '../lib/invio.js';

const r = Router();
export const isEditor = (req) => ['EDITOR', 'ADMIN'].includes(req.moduleUser?.role);
const requireEditor = (req, _res, next) => (isEditor(req) ? next() : next(forbidden('Riservato a chi gestisce il Portale SGI (profilo Gestione documenti)')));

r.get('/state', ah(async (req, res) => {
  const st = await getModuleState(KEY);
  const s = await statoSpecchio();
  const n = await conteggi();
  const o = await origine();
  res.json({
    mode: st.mode,
    user: { id: req.user.id, email: req.user.email, full_name: req.user.full_name, role: req.moduleUser.role, editor: isEditor(req), esterno: isExternal(req.user) },
    specchio: { caricato: Boolean(s.build), build: s.build, reg006_rev: s.reg006_rev, reg006_data: s.reg006_data, fonte: s.fonte, ultima_lettura: s.ultima_lettura, ultimo_cambio: s.ultimo_cambio, ultimo_errore: s.ultimo_errore, ultimo_errore_at: s.ultimo_errore_at },
    conteggi: { n_docs: n.n_docs, n_stampabili: n.n_stampabili, n_prestazioni: n.n_prestazioni },
    origine: o.url,
  });
}));

// JSON dello specchio così come sono sul sito (sola lettura). ETag = sha del contenuto: il browser riusa fulltext.json (6 MB)
r.get('/dati/:chiave', ah(async (req, res) => {
  if (!CHIAVI.includes(req.params.chiave)) throw notFound('Contenuto inesistente');
  const c = await contenuto(req.params.chiave);
  if (!c) throw Object.assign(new HttpError(404, 'Portale SGI non ancora caricato: lo specchio del sito non è stato eseguito'), { code: 'SPECCHIO_VUOTO' });
  const etag = `"${c.sha256}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.json(c.json);
}));

// Codici base dei documenti nello specchio (senza revisione): il Portale Service li usa per il rimando "Apri nel SGI"
r.get('/codici', ah(async (req, res) => {
  const c = await contenuto('docs');
  if (!c) return res.json({ codici: [] });
  const etag = `"c-${c.sha256}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.json({ codici: codiciBase(c.json) });
}));

// ---- File dello specchio (PDF): dalla cache, altrimenti dal sito di origine (con le credenziali, se protetto) e poi in cache
r.get('/file/*', ah(async (req, res) => {
  const { file, da } = await leggiFile(req.params[0]);
  await inviaFile(res, file, { da, scarica: req.query.dl === '1' });
}));

// ---------------------------------------------------------------- Impostazioni (EDITOR)
async function vistaCredenziali() {
  const c = await credenziali();
  return { fonte: c.fonte || (config.passwordEnv ? 'env' : null), utente: c.utente || '', password_impostata: Boolean(c.password), da_env: Boolean(config.passwordEnv), utente_predefinito: UTENTE_PREDEFINITO };
}
r.get('/impostazioni', requireEditor, ah(async (_req, res) => {
  const o = await origine();
  res.json({ origine: o.url, origine_fonte: o.fonte, origine_predefinita: ORIGINE_DEFAULT, intervallo_ore: Math.round(config.specchioMinuti / 6) / 10,
    credenziali: await vistaCredenziali(), specchio: await statoSpecchio(), conteggi: await conteggi(), cache: await statoCache(), zip_max_mb: Math.round(config.zipMaxBytes / 1024 / 1024) });
}));
const urlOrigine = z.string().trim().url('Indirizzo dell\'origine non valido').max(300).regex(/^https?:\/\//, 'L\'origine deve iniziare con http:// o https://')
  .refine((u) => !urlConCredenziali(u), 'Niente utente e password nell\'indirizzo: vanno nei campi delle credenziali');
r.put('/impostazioni', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ origine: urlOrigine.nullable() }), req.body || {});
  if (config.origineEnv) throw bad('L\'origine è impostata dalla variabile d\'ambiente SGI_PORTAL_URL: si cambia su Render');
  await setImpostazione('origine', b.origine ? b.origine.replace(/\/+$/, '') : null, req.user.id);
  await audit(req, 'SGI_ORIGINE', { module: KEY, entity: 'impostazioni', label: b.origine || '(predefinita)' });
  res.json({ ok: true, origine: (await origine()).url });
}));
// Credenziali HTTP Basic dell'origine: password undefined = invariata, '' o null = rimossa. Nel registro solo l'utente e l'operazione.
const utenteSchema = z.string().trim().max(120).refine((u) => !u.includes(':'), 'Il nome utente non può contenere ":"');
r.put('/impostazioni/credenziali', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ utente: utenteSchema.nullable().optional(), password: z.string().max(300).nullable().optional() }), req.body || {});
  if (config.passwordEnv) throw bad('Le credenziali dell\'origine sono impostate dalle variabili d\'ambiente SGI_PORTAL_USER e SGI_PORTAL_PASSWORD: si cambiano su Render');
  await salvaCredenziali({ utente: b.utente, password: b.password }, req.user.id);
  const op = b.password === undefined ? 'utente aggiornato' : b.password ? 'password impostata' : 'credenziali rimosse';
  await audit(req, 'SGI_CREDENZIALI', { module: KEY, entity: 'impostazioni', label: `${op}${b.utente ? ` (utente ${b.utente})` : ''}` });
  res.json({ ok: true, credenziali: await vistaCredenziali() });
}));
// Prova: origine e credenziali del modulo (salvate) oppure quelle scritte nel modulo e non ancora salvate
r.post('/impostazioni/prova', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ origine: urlOrigine.optional(), utente: utenteSchema.optional(), password: z.string().max(300).optional() }), req.body || {});
  let auth;
  if (b.password || b.utente !== undefined) {
    const c = await credenziali();
    auth = autorizzazioneSgi(b.utente !== undefined ? b.utente : c.utente, b.password || c.password);
  }
  res.json(await provaOrigine(b.origine || (await origine()).url, { auth }));
}));
r.post('/aggiorna', requireEditor, ah(async (req, res) => {
  const forza = Boolean(req.body?.forza);
  const esito = await specchio({ forza });
  await audit(req, 'SGI_AGGIORNA', { module: KEY, entity: 'specchio', label: esito.cambiato ? `aggiornato: ${esito.motivi.join(', ')}` : 'nessun cambiamento', data: { build: esito.build, forza } });
  res.json(esito);
}));
r.post('/cache/svuota', requireEditor, ah(async (req, res) => {
  const n = await svuotaCache();
  await audit(req, 'SGI_CACHE_SVUOTATA', { module: KEY, entity: 'cache', label: `${n} file` });
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
    await audit(req, 'SGI_ZIP', { module: KEY, entity: 'specchio', label: f.originalname, data: { build: esito.build, file: esito.file, bytes: esito.bytes } });
    res.json(esito);
  } finally { fs.promises.unlink(f.path).catch(() => {}); }
}));

export default r;
