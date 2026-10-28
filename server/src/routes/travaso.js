// Travaso dei moduli: stato, esecuzione della copia, confronto conteggi, passaggio a LIVE (solo titolare)
import { Router } from 'express';
import { many } from '../db.js';
import { LEGACY_KEYS } from '../config.js';
import { ah, bad, audit, notFound } from '../lib/util.js';
import { requireAdmin, requireOwner } from '../lib/access.js';
import { runTravaso, compareCounts, goLive, backToMirror, isRunning, FRESH_MODULES } from '../lib/travaso.js';
import { getModuleState } from '../lib/modules.js';
import { sourceEnabled, legacyQuery, legacyQueryLong } from '../lib/legacy.js';
import { buildTemplate } from './importxlsx.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hasCode = (key) => fs.existsSync(path.join(here, '..', 'modules', key, 'migrations'));
const r = Router();

r.get('/travaso', requireAdmin, ah(async (_req, res) => {
  const mods = await many(`SELECT key, name, area FROM modules WHERE key = ANY($1::text[]) ORDER BY area, sort_order`, [LEGACY_KEYS]);
  const out = [];
  for (const m of mods) {
    const st = await getModuleState(m.key);
    const li = await supportsLegacyImport(m.key);
    out.push({ ...m, ...st, fresh: FRESH_MODULES.includes(m.key), source_enabled: sourceEnabled(m.key), code_ready: hasCode(m.key), running: isRunning(m.key), legacy_import: li.ok, legacy_people_xlsx: li.people });
  }
  res.json(out);
}));

// Il modulo sa importare i contenuti dall'app originale (esporta legacyMatch e legacyImport); people = sa anche produrre le righe
// delle persone non abbinate per il modello XLSX di Importazioni (legacyPeopleRows, facoltativa)
const legacyImportCache = new Map();
async function supportsLegacyImport(key) {
  if (!FRESH_MODULES.includes(key) || !hasCode(key)) return { ok: false, people: false };
  if (!legacyImportCache.has(key)) {
    let v = { ok: false, people: false };
    try { const mod = await import(`../modules/${key}/index.js`); v = { ok: typeof mod.legacyMatch === 'function' && typeof mod.legacyImport === 'function', people: typeof mod.legacyPeopleRows === 'function' }; } catch { v = { ok: false, people: false }; }
    legacyImportCache.set(key, v);
  }
  return legacyImportCache.get(key);
}

const check = (key) => { if (!LEGACY_KEYS.includes(key)) throw notFound('Modulo inesistente'); };

r.post('/travaso/:key/run', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  if (!hasCode(req.params.key)) throw bad('Il codice del modulo non è ancora nella Suite (server/src/modules/' + req.params.key + ')');
  const out = await runTravaso(req.params.key, req.user.id).catch((e) => { throw bad(e.message); });
  await audit(req, 'TRAVASO_RUN', { module: req.params.key, data: { rows: out.rows, tables: out.tables, ms: out.ms } });
  res.json(out);
}));

r.get('/travaso/:key/compare', requireAdmin, ah(async (req, res) => {
  check(req.params.key);
  res.json(await compareCounts(req.params.key).catch((e) => { throw bad(e.message); }));
}));

r.post('/travaso/:key/live', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  await goLive(req.params.key, req.user.id).catch((e) => { throw bad(e.message); });
  await audit(req, 'TRAVASO_LIVE', { module: req.params.key });
  res.json({ ok: true });
}));

r.post('/travaso/:key/mirror', requireOwner, ah(async (req, res) => {
  check(req.params.key);
  await backToMirror(req.params.key, req.user.id);
  await audit(req, 'TRAVASO_BACK_TO_MIRROR', { module: req.params.key });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- contenuti dall'app originale nei moduli partiti vuoti
// Il modulo (server/src/modules/<key>/index.js) esporta legacyMatch / legacyImport (interfaccia comune, brief "legacy content"):
// il core verifica lo stato (modulo FRESH, LIVE, sorgente collegata), carica il modulo come fa il travaso per afterTravaso,
// aggiunge il catalogo delle anagrafiche della Suite per la scelta manuale e registra l'esito nell'audit.
async function legacyModule(key) {
  if (!FRESH_MODULES.includes(key)) throw bad('Questo modulo riceve i dati con il travaso completo, non con l\'importazione dei contenuti');
  if (!hasCode(key)) throw bad(`Il codice del modulo non è ancora nella Suite (server/src/modules/${key})`);
  const st = await getModuleState(key);
  if (st.mode !== 'LIVE' || !st.schema_ready) throw bad('Avvia prima il modulo: l\'importazione dei contenuti richiede il modulo attivo nella Suite');
  if (!sourceEnabled(key)) throw bad('Il database dell\'app originale non è collegato: imposta la connessione in Amministrazione > Sorgenti legacy');
  let mod;
  try { mod = await import(`../modules/${key}/index.js`); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') throw bad(`Il modulo ${key} non ha un punto di ingresso nella Suite`); throw e; }
  if (typeof mod.legacyMatch !== 'function' || typeof mod.legacyImport !== 'function') throw bad(`Il modulo ${key} non prevede ancora l'importazione dei contenuti dall'app originale`);
  return mod;
}
const catalogLabel = {
  sites: (s) => [s.code, s.name, s.city ? `(${s.city})` : null, s.active ? null : '· non attiva'].filter(Boolean).join(' '),
  people: (p) => [`${p.last_name} ${p.first_name}`, p.job_title ? `· ${p.job_title}` : null, p.email ? `· ${p.email}` : null, p.status === 'CESSATO' ? '· cessata' : null].filter(Boolean).join(' '),
  organizations: (o) => [o.name, o.vat_number ? `· P.IVA ${o.vat_number}` : null, o.city ? `(${o.city})` : null, o.active ? null : '· non attiva'].filter(Boolean).join(' '),
};
// Anagrafiche della Suite tra cui scegliere a mano: tutte, con etichetta leggibile (il modulo può restringerle con catalog)
async function suiteCatalog() {
  const sites = await many(`SELECT id, code, name, city, kind, active FROM public.sites ORDER BY active DESC, sort_order, lower(name)`);
  const people = await many(`SELECT id, last_name, first_name, job_title, email, status FROM public.people ORDER BY (status = 'CESSATO'), lower(last_name), lower(first_name)`);
  const organizations = await many(`SELECT id, name, vat_number, city, kind, active FROM public.organizations ORDER BY active DESC, lower(name)`);
  return {
    sites: sites.map((s) => ({ id: s.id, label: catalogLabel.sites(s), kind: s.kind, active: s.active })),
    people: people.map((p) => ({ id: p.id, label: catalogLabel.people(p), status: p.status })),
    organizations: organizations.map((o) => ({ id: o.id, label: catalogLabel.organizations(o), kind: o.kind, active: o.active })),
  };
}

r.get('/travaso/:key/legacy-match', requireAdmin, ah(async (req, res) => {
  const { key } = req.params;
  check(key);
  const mod = await legacyModule(key);
  const out = await mod.legacyMatch({ legacyQuery: (sql, params) => legacyQuery(key, sql, params), key }).catch((e) => { throw bad(`Lettura dell'app originale non riuscita: ${e.message}`); });
  const catalog = await suiteCatalog();
  res.json({
    entities: { sites: [], people: [], organizations: [], ...(out.entities || {}) },
    tables: out.tables || [],
    catalog: { ...catalog, ...(out.catalog || {}) },
    warnings: out.warnings || [],
    people_xlsx: typeof mod.legacyPeopleRows === 'function',
  });
}));

// Persone dell'app originale non abbinate: modello XLSX del dataset "people" di Importazioni precompilato con tutto ciò che l'app sa di
// loro (il modulo le descrive con legacyPeopleRows). Caricato in Amministrazione > Importazioni > Persone, una nuova apertura della
// finestra le riconosce (email, codice fiscale, nome) e la seconda importazione copia ciò che la prima aveva saltato.
r.post('/travaso/:key/legacy-people.xlsx', requireAdmin, ah(async (req, res) => {
  const { key } = req.params;
  check(key);
  const mod = await legacyModule(key);
  if (typeof mod.legacyPeopleRows !== 'function') throw bad(`Il modulo ${key} non prevede il file delle persone non abbinate`);
  const mapping = cleanMapping(req.body?.mapping);
  const rows = await mod.legacyPeopleRows({ legacyQuery: (sql, params) => legacyQuery(key, sql, params), mapping, key }).catch((e) => { throw bad(`Lettura dell'app originale non riuscita: ${e.message}`); });
  const mod0 = await many('SELECT name FROM modules WHERE key=$1', [key]);
  const { wb } = await buildTemplate('people', { rows, note: `Persone dell'app originale di ${mod0[0]?.name || key} non abbinate all'anagrafica della Suite (${rows.length}). Dopo il caricamento riapri "Importa i contenuti dall'app originale": verranno riconosciute per email o codice fiscale.` });
  await audit(req, 'LEGACY_PEOPLE_XLSX', { module: key, label: `${rows.length} persone non abbinate nel file`, data: { rows: rows.length } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="SuiteTD_persone_${key}_da_abbinare.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

const cleanMapping = (m) => {
  const out = {};
  for (const ent of ['sites', 'people', 'organizations']) {
    out[ent] = {};
    for (const [lid, sid] of Object.entries((m && m[ent]) || {})) { const n = Number(sid); if (Number.isInteger(n) && n > 0) out[ent][String(lid)] = n; }
  }
  return out;
};

r.post('/travaso/:key/legacy-import', requireAdmin, ah(async (req, res) => {
  const { key } = req.params;
  check(key);
  const mod = await legacyModule(key);
  if (isRunning(key)) throw bad('Travaso già in corso');
  const dryRun = Boolean(req.body?.dryRun);
  const mapping = cleanMapping(req.body?.mapping);
  const t0 = Date.now();
  const out = await mod.legacyImport({
    legacyQuery: (sql, params) => legacyQuery(key, sql, params),
    legacyQueryLong: (sql, params) => legacyQueryLong(key, sql, params),
    mapping, dryRun, userId: req.user.id, key,
  }).catch((e) => { throw bad(`${dryRun ? 'Prova' : 'Importazione'} non riuscita: ${e.message}`); });
  const ms = Date.now() - t0;
  const copied = Object.values(out.stats || {}).reduce((a, s) => a + (s.copied || 0), 0);
  const skipped = (out.skipped || []).length;
  await audit(req, dryRun ? 'LEGACY_IMPORT_DRYRUN' : 'LEGACY_IMPORT', { module: key, label: `${copied} righe ${dryRun ? 'da importare' : 'importate'}, ${skipped} saltate`, data: { stats: out.stats, skipped, mapping: { sites: Object.keys(mapping.sites).length, people: Object.keys(mapping.people).length, organizations: Object.keys(mapping.organizations).length }, ms } });
  res.json({ ...out, dryRun, ms, copied });
}));

export default r;
