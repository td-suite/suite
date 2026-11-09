// TuoTempo, Fase 1 (lib/tuotempo.js, docs/RETAIL_TUOTEMPO.md): tabella "Aree TuoTempo" con proposte, abbinamento, scelta, "Crea la sede",
// "non nostra / ignora", confronto e "Copia da TuoTempo"; tabella "Risorse TuoTempo" con proposta e conferma dell'abbinamento alle persone;
// "Allinea adesso"; blocco "Prenotazione online" della scheda sede; vista "Listino online vs prezzo di cassa".
// Lettura: profili ADMIN e RETAIL del modulo (la scheda sede e il listino anche SEDE e VIEWER). Scrittura sull'anagrafica (sedi e persone):
// Admin del modulo o amministratori della Suite (Amministrazione > Sedi e Persone usano le stesse API), sempre con le funzioni del core.
import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, audit, parse, forbidden } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { syncConnector } from '../lib/connectors.js';
import {
  elencoAree, abbinaArea, scollegaArea, ignoraArea, creaSedeDaArea, copiaDaTuotempo, elencoRisorse, confermaRisorsa, scollegaRisorsa,
  prenotazioneOnline, listinoOnlineVsCassa, TIPI_DA_AREA, CAMPI_COPIA,
} from '../lib/tuotempo.js';

const r = Router();
const suiteAdmin = (req) => ['OWNER', 'ADMIN'].includes(req.suiteUser?.level);
const lettore = (req, _res, next) => (['ADMIN', 'RETAIL'].includes(req.user?.role) || suiteAdmin(req) ? next() : next(forbidden()));
// scrivono sull'anagrafica (legacy_refs di sedi e persone, nuove sedi, dati copiati): Admin del modulo o amministratori della Suite
const anagrafica = (req, _res, next) => (req.user?.role === 'ADMIN' || suiteAdmin(req) ? next() : next(forbidden('Operazione riservata agli amministratori (Retail o Suite): tocca l\'anagrafica')));

r.get('/aree', lettore, ah(async (_req, res) => res.json(await elencoAree())));
r.post('/aree/:areaid/abbina', anagrafica, ah(async (req, res) => {
  const d = parse(z.object({ site_id: z.coerce.number().int().positive() }), req.body || {});
  const out = await abbinaArea(req.params.areaid, d.site_id, { req });
  await audit(req, 'TUOTEMPO_AREA_ABBINATA', 'site', d.site_id, { areaid: req.params.areaid });
  res.json(out);
}));
r.post('/aree/:areaid/scollega', anagrafica, ah(async (req, res) => {
  const out = await scollegaArea(req.params.areaid, { req });
  await audit(req, 'TUOTEMPO_AREA_SCOLLEGATA', 'tuotempo_area', req.params.areaid, out);
  res.json(out);
}));
r.post('/aree/:areaid/ignora', anagrafica, ah(async (req, res) => {
  const d = parse(z.object({ ignorata: z.boolean().default(true), nota: z.string().max(500).nullable().optional() }), req.body || {});
  const out = await ignoraArea(req.params.areaid, { ignorata: d.ignorata, nota: d.nota || null, userId: req.suiteUser?.id || null });
  await audit(req, d.ignorata ? 'TUOTEMPO_AREA_IGNORATA' : 'TUOTEMPO_AREA_RIPRESA', 'tuotempo_area', req.params.areaid, { nota: d.nota || null });
  res.json(out);
}));
r.post('/aree/:areaid/crea-sede', anagrafica, ah(async (req, res) => {
  const d = parse(z.object({ code: z.string().min(2).max(40), kind: z.enum(TIPI_DA_AREA), name: z.string().max(250).nullable().optional() }), req.body || {});
  const out = await creaSedeDaArea(req.params.areaid, { ...d, req });
  await audit(req, 'TUOTEMPO_SEDE_CREATA', 'site', out.site_id, { areaid: req.params.areaid, code: out.code });
  res.status(201).json(out);
}));
// "Copia da TuoTempo" (anche dalla Diagnostica): campi scelti, con la conferma esplicita
r.post('/sedi/:siteId/copia', anagrafica, ah(async (req, res) => {
  const d = parse(z.object({ campi: z.array(z.enum(Object.keys(CAMPI_COPIA))).min(1), conferma: z.literal('COPIA', { errorMap: () => ({ message: 'Conferma la copia (COPIA)' }) }) }), req.body || {});
  const out = await copiaDaTuotempo(Number(req.params.siteId), d.campi, { req });
  await audit(req, 'TUOTEMPO_DATI_COPIATI', 'site', Number(req.params.siteId), { campi: out.copiati });
  res.json(out);
}));
r.get('/sedi/:siteId', ah(async (req, res) => res.json(await prenotazioneOnline(Number(req.params.siteId)))));

r.get('/risorse', lettore, ah(async (_req, res) => res.json(await elencoRisorse())));
r.post('/risorse/:id/conferma', anagrafica, ah(async (req, res) => {
  const d = parse(z.object({ person_id: z.coerce.number().int().positive() }), req.body || {});
  const out = await confermaRisorsa(req.params.id, d.person_id, { req });
  await audit(req, 'TUOTEMPO_RISORSA_ABBINATA', 'person', d.person_id, { resourceid: req.params.id });
  res.json(out);
}));
r.post('/risorse/:id/scollega', anagrafica, ah(async (req, res) => {
  const out = await scollegaRisorsa(req.params.id, { req });
  await audit(req, 'TUOTEMPO_RISORSA_SCOLLEGATA', 'tuotempo_risorsa', req.params.id, out);
  res.json(out);
}));
r.get('/assicurazioni', lettore, ah(async (_req, res) => res.json(await many('SELECT insuranceid, titolo, legacyid, legacy_title, is_default, is_hidden, tags, presente, synced_at FROM tuotempo_assicurazioni ORDER BY presente DESC, lower(titolo)'))));
r.get('/listino', ah(async (req, res) => res.json(await listinoOnlineVsCassa({ mesi: req.query.mesi }))));

// "Allinea adesso" (Retail > Impostazioni/Connettori e Amministrazione > Sedi): stessa funzione del job notturno
r.post('/allinea', lettore, ah(async (req, res) => {
  const out = await syncConnector('TUOTEMPO', req.user.id, { actorId: req.suiteUser?.id || null });
  await audit(req, 'CONNECTOR_SYNC', 'connector', 'TUOTEMPO', { rows_ok: out.rows_ok, aree: out.aree, abbinate: out.aree_abbinate });
  res.json(out);
}));

export default r;
