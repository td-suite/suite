// Modulo Facility e Manutenzioni (area OPERATIONS). Richiesta del CEO del 31/10/2026: facility management e gestione delle manutenzioni.
// Immobili (contratti di affitto e canone da Payments, planimetria dall'anagrafica Sedi pubblicata in Room Planning, obblighi di controllo),
// utenze e bollette scritte nello Scadenziario strutture di Payments (finance), energy management per sede e di rete (consumi, costi,
// CO2, intensità a parità di attività, anno su anno, anomalie, obiettivi, report per le certificazioni, analisi con Claude),
// dispositivi dal Catalogo di Amministrazione (public.asset_types) con piano delle scadenze, interventi e segnalazioni guasti, KPI.
// Nativo, si avvia vuoto (FRESH_MODULES). Solo con grant (open_to_all FALSE): ADMIN (Owner e Admin della Suite), FACILITY, MANUTENTORE,
// SITE (ambito sede), VIEWER. Documentazione: docs/FACILITY.md.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { storageMode } from '../../lib/moduleStorage.js';
import { one } from './db.js';
import { config, TENURE, DOC_KINDS, OBLIGATION_KINDS, PLAN_KINDS, PLAN_STATUS, OUTCOMES, STREAMS, WO_STATUS, PRIORITIES, ASSET_STATUS, VECTORS, UNIT_DEFAULT } from './config.js';
import { ruolo, isAdmin, isFacility, isManutentore, isSite, isViewer, mySiteIds, limitedToSites, vendorScope } from './lib/access.js';
import { managedSites, vendorOrgOf, financeLive, roomReady, settings } from './lib/core.js';
import { runScadenze } from './lib/alerts.js';
import { aiState } from './lib/ai.js';
import propertiesRoutes from './routes/properties.js';
import utilitiesRoutes from './routes/utilities.js';
import energyRoutes from './routes/energy.js';
import assetsRoutes from './routes/assets.js';
import plansRoutes from './routes/plans.js';
import workordersRoutes from './routes/workorders.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';

const KEY = 'facility';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // sedi del site manager (grant + organigramma) e Legal entity del manutentore esterno
  r.use(ah(async (req, _res, next) => {
    req.managedSiteIds = await managedSites(req.user);
    req.vendorOrgId = isManutentore(req) ? await vendorOrgOf(req.user) : null;
    next();
  }));

  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const imp = await settings();
    res.json({ mode: st.mode, user: { id: req.user.id, module_user_id: req.moduleUser.id, email: req.user.email, full_name: req.user.full_name, role: ruolo(req), isAdmin: isAdmin(req), isFacility: isFacility(req),
      isManutentore: isManutentore(req), isSite: isSite(req), isViewer: isViewer(req), site_ids: mySiteIds(req), limited: limitedToSites(req), vendor_org_id: vendorScope(req)?.orgId || null },
    finance: await financeLive(), room: await roomReady(), limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerUpload }, storage: storageMode(), ai: aiState(), sla_hours: imp.sla_hours,
    labels: { tenure: TENURE, doc_kinds: DOC_KINDS, obligation_kinds: OBLIGATION_KINDS, plan_kinds: PLAN_KINDS, plan_status: PLAN_STATUS, outcomes: OUTCOMES, streams: STREAMS, wo_status: WO_STATUS, priorities: PRIORITIES, asset_status: ASSET_STATUS, vectors: VECTORS, units: UNIT_DEFAULT } });
  }));

  // Contatori della sidebar: scadenze scadute e interventi URGENTE/ALTA aperti (nel perimetro dell'utente)
  r.get('/badges', ah(async (req, res) => {
    const ids = limitedToSites(req) ? mySiteIds(req) : null;
    const vs = vendorScope(req);
    const p = []; const sw = (col) => (ids ? ` AND ${col} = ANY($${p.push(ids) && p.length}::int[])` : '');
    const plW = sw('p.site_id') + (vs ? ` AND a.vendor_org_id = $${p.push(vs.orgId) && p.length}` : '');
    const scadute = await one(`SELECT count(*)::int AS n FROM maintenance_plans p LEFT JOIN assets a ON a.id=p.asset_id WHERE p.status IN ('PIANIFICATA','SCADUTA') AND p.due_date < CURRENT_DATE${plW}`, p);
    const p2 = []; const woW = (ids ? ` AND w.site_id = ANY($${p2.push(ids) && p2.length}::int[])` : '') + (vs ? ` AND (w.vendor_org_id = $${p2.push(vs.orgId) && p2.length} OR w.assigned_user_id = $${p2.push(vs.userId) && p2.length})` : '');
    const urgenti = await one(`SELECT count(*)::int AS n FROM work_orders w WHERE w.status <> 'CHIUSO' AND w.priority IN ('URGENTE','ALTA')${woW}`, p2);
    res.json({ scadute: scadute?.n || 0, urgenti: urgenti?.n || 0, totale: (scadute?.n || 0) + (urgenti?.n || 0) });
  }));

  r.use(blockWritesInMirror);
  r.use(propertiesRoutes);
  r.use(utilitiesRoutes);
  r.use(energyRoutes);
  r.use(assetsRoutes);
  r.use(plansRoutes);
  r.use(workordersRoutes);
  r.use(reportsRoutes);
  r.use(settingsRoutes);
  app.use(`/api/${KEY}`, r);

  // Scadenze, promemoria 30/7/0 giorni, attività e anomalie: una volta al giorno, solo con modulo LIVE
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:scadenze`, config.jobMinutes, async () => (await live() ? runScadenze() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: false });
}
