// Openapi nella Suite (v0.80.0): scheda dell'impresa dal registro, confronto e ribaltamento sulla Legal entity, dati del CAP.
// Lettura della scheda e del CAP: amministratori della Suite e chi lavora in Business Hub (dove nascono clienti e prospect).
// Applicazione dei dati a una Legal entity: solo amministratori, come ogni modifica dell'anagrafica.
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, audit, parse, notFound, forbidden } from '../lib/util.js';
import { requireAuth, requireAdmin } from '../lib/access.js';
import { one, many, q } from '../db.js';
import { schedaImpresa, infoCap, confrontaOrg, verificaOrganizzazione, verificaPeriodica, impostazioniOpenapi, usoMese, CAMPI_ORG, codiceValido } from '../lib/openapi.js';

const r = Router();
r.use(requireAuth);
const admin = (u) => u?.level === 'OWNER' || u?.level === 'ADMIN';
const puoLeggere = (req, _res, next) => (admin(req.user) || req.user.grants?.business ? next() : next(forbidden('Riservato agli amministratori e a chi lavora in Business Hub')));
const errore = (e) => Object.assign(new Error(e.message), { status: e.status || 400 });

// Stato: connettore, uso del mese, tetto, Legal entity da guardare
r.get('/stato', requireAdmin, ah(async (_req, res) => {
  const S = await impostazioniOpenapi();
  const n = await one(`SELECT count(*) FILTER (WHERE coalesce(vat_number,'') <> '' OR coalesce(tax_code,'') <> '')::int AS con_codice, count(*) FILTER (WHERE registry_checked_at IS NOT NULL)::int AS verificate,
      count(*) FILTER (WHERE registry_alert IS NOT NULL)::int AS con_avviso FROM organizations WHERE active`);
  const avvisi = await many(`SELECT id, name, kind, vat_number, registry_status, registry_alert, registry_checked_at FROM organizations WHERE active AND registry_alert IS NOT NULL ORDER BY (registry_status ILIKE '%CESS%') DESC, lower(name) LIMIT 200`);
  res.json({ impostazioni: S, uso: { impresa: await usoMese('impresa'), cap: await usoMese('cap') }, legal_entity: n, avvisi });
}));

// Scheda dell'impresa da partita IVA o codice fiscale (a pagamento se non è in cache)
r.get('/impresa/:codice', puoLeggere, ah(async (req, res) => {
  try { res.json(await schedaImpresa(req.params.codice, { forza: req.query.forza === '1' && admin(req.user), modulo: admin(req.user) ? 'core' : 'business' })); } catch (e) { throw errore(e); }
}));

// Confronto tra una Legal entity e il registro: cosa manca, cosa è diverso
r.get('/organizations/:id/confronto', requireAdmin, ah(async (req, res) => {
  const org = await one('SELECT * FROM organizations WHERE id=$1', [Number(req.params.id)]);
  if (!org) throw notFound('Legal entity non trovata');
  const codice = codiceValido(org.vat_number) ? org.vat_number : codiceValido(org.tax_code) ? org.tax_code : null;
  if (!codice) throw bad('La Legal entity non ha una partita IVA o un codice fiscale validi: inseriscili e riprova');
  let s; try { s = await schedaImpresa(codice, { forza: req.query.forza === '1' }); } catch (e) { throw errore(e); }
  res.json({ trovata: s.trovata, daCache: s.daCache, letto_at: s.letto_at, scheda: s.scheda, ...confrontaOrg(org, s.scheda) });
}));

// Verifica adesso (riempie i campi vuoti, registra stato e differenze)
r.post('/organizations/:id/verifica', requireAdmin, ah(async (req, res) => {
  try { res.json(await verificaOrganizzazione(Number(req.params.id), { forza: req.body?.forza === true, req, origine: 'Amministrazione > Legal entity' })); } catch (e) { throw errore(e); }
}));

// Applica alla Legal entity i campi scelti (anche quelli diversi: qui decide una persona)
r.post('/organizations/:id/applica', requireAdmin, ah(async (req, res) => {
  const d = parse(z.object({ campi: z.array(z.enum(CAMPI_ORG.map((c) => c[0]))).min(1) }), req.body || {});
  const org = await one('SELECT * FROM organizations WHERE id=$1', [Number(req.params.id)]);
  if (!org) throw notFound('Legal entity non trovata');
  const codice = codiceValido(org.vat_number) ? org.vat_number : org.tax_code;
  let s; try { s = await schedaImpresa(codice); } catch (e) { throw errore(e); }
  if (!s.trovata) throw bad('Impresa non trovata nel registro');
  const sets = []; const par = [org.id]; const applicati = {};
  for (const [campo, sorgente] of CAMPI_ORG) {
    if (!d.campi.includes(campo) || s.scheda[sorgente] == null) continue;
    par.push(s.scheda[sorgente]); sets.push(`${campo}=$${par.length}`); applicati[campo] = { da: org[campo] ?? null, a: s.scheda[sorgente] };
  }
  if (!sets.length) throw bad('Nessuno dei campi scelti è presente nel registro');
  await q(`UPDATE organizations SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, par);
  await audit(req, 'ORG_REGISTRO_APPLICA', { entity: 'organization', entityId: org.id, label: org.name, data: applicati });
  const esito = await verificaOrganizzazione(org.id, { req, origine: 'Amministrazione > Legal entity' });   // ricalcola differenze e avviso (dalla cache: non spende)
  const dopo = await one('SELECT * FROM organizations WHERE id=$1', [org.id]);
  import('../lib/search.js').then((m) => m.indexOrg(dopo)).catch(() => {});
  if (Object.keys(applicati).some((k) => ['address', 'zip', 'city', 'province'].includes(k))) await import('../lib/clienti.js').then((m) => m.allineaSediDaOrg(org.id, { req, origine: 'Registro imprese (Openapi)' })).catch(() => {});
  res.json({ ok: true, applicati: Object.keys(applicati), organizzazione: dopo, avviso: esito.avviso || null });
}));

// Giro di verifica su richiesta (lo stesso della notte), con un lotto piccolo
r.post('/verifica-periodica', requireAdmin, ah(async (req, res) => {
  const out = await verificaPeriodica({ limite: Math.min(50, Number(req.body?.limite) || 10) });
  await audit(req, 'OPENAPI_VERIFICA_PERIODICA', { data: out });
  res.json(out);
}));

// Dati di un CAP: comuni, provincia, regione
r.get('/cap/:cap', ah(async (req, res) => {
  try { res.json(await infoCap(req.params.cap)); } catch (e) { throw errore(e); }
}));

export default r;
