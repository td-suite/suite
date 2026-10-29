// Sintesi con Claude: sede, TD complessivo, singolo partner, tutti i partner. Riservate a Qualità, auditor e amministratore;
// la lettura dell'ultima sintesi della sede è aperta anche al site manager (scheda sede).
import { Router } from 'express';
import { many } from '../db.js';
import { ah, audit, forbidden } from '../../../lib/util.js';
import { requireAuditor, canSeeSite, limitedToSites } from '../lib/access.js';
import { KEY, idOf } from '../lib/core.js';
import { sintesiSede, sintesiTD, sintesiLegalEntity, sintesiLegalEntities, ultimaSintesi, aiState } from '../lib/synth.js';

const r = Router();
const ctx = (req) => ({ userId: req.user.id, moduleUserId: req.moduleUser.id });

r.post('/sintesi/sede/:siteId', requireAuditor, ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  const out = await sintesiSede(siteId, ctx(req));
  await audit(req, 'AUDIT_SINTESI', { module: KEY, entity: 'synthesis', entityId: out.id, data: { scope: 'SEDE', site_id: siteId, audit: out.inputs.audit_ids.length, score: out.score, model: out.model } });
  res.status(201).json(out);
}));
r.post('/sintesi/td', requireAuditor, ah(async (req, res) => {
  const out = await sintesiTD(ctx(req));
  await audit(req, 'AUDIT_SINTESI', { module: KEY, entity: 'synthesis', entityId: out.id, data: { scope: 'TD', score: out.score, model: out.model } });
  res.status(201).json(out);
}));
r.post('/sintesi/partner/:orgId', requireAuditor, ah(async (req, res) => {
  const orgId = idOf(req.params.orgId, 'Legal entity non trovata');
  const out = await sintesiLegalEntity(orgId, ctx(req));
  await audit(req, 'AUDIT_SINTESI', { module: KEY, entity: 'synthesis', entityId: out.id, data: { scope: 'LEGAL_ENTITY', organization_id: orgId, score: out.score, model: out.model } });
  res.status(201).json(out);
}));
r.post('/sintesi/partners', requireAuditor, ah(async (req, res) => {
  const out = await sintesiLegalEntities(ctx(req));
  await audit(req, 'AUDIT_SINTESI', { module: KEY, entity: 'synthesis', entityId: out.id, data: { scope: 'LEGAL_ENTITIES', score: out.score, model: out.model } });
  res.status(201).json(out);
}));

// Letture dell'ultima sintesi
r.get('/sintesi/td', ah(async (req, res) => { if (limitedToSites(req)) throw forbidden(); res.json({ sintesi: await ultimaSintesi('TD'), ai: aiState(), storico: await many(`SELECT id, generated_at, score, level, model FROM syntheses WHERE scope='TD' ORDER BY generated_at DESC LIMIT 12`) }); }));
r.get('/sintesi/partners', ah(async (req, res) => { if (limitedToSites(req)) throw forbidden(); res.json({ sintesi: await ultimaSintesi('LEGAL_ENTITIES'), ai: aiState() }); }));
r.get('/sintesi/sede/:siteId', ah(async (req, res) => {
  const siteId = idOf(req.params.siteId, 'Sede non trovata');
  if (!canSeeSite(req, siteId)) throw forbidden();
  res.json({ sintesi: await ultimaSintesi('SEDE', { site_id: siteId }), ai: aiState(), storico: await many(`SELECT id, generated_at, score, level, model FROM syntheses WHERE scope='SEDE' AND site_id=$1 ORDER BY generated_at DESC LIMIT 12`, [siteId]) });
}));

export default r;
