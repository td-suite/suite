// Modulo Audit SGI (area HQS). Richiesta del CEO del 29/10/2026: conduzione, archiviazione e gestione degli audit del Sistema di
// Gestione Integrato. Auto-audit mensili delle sedi (compilati dal Site Manager, verificati da Qualità/Retail/AD con colonna
// parallela), audit interni, audit di terze parti (PDF di certificatori, ASL, ispezioni), audit ISO 37001 sui partner (Legal entity),
// sintesi con Claude per sede (esito numerico in public.site_sgi_scores letto da Retail Assistant), per la rete e per i partner,
// archivio con cestino ed esportazioni XLSX/PDF, alert del 17 al site manager.
// Nativo, si avvia vuoto (FRESH_MODULES). Accesso solo con grant (open_to_all FALSE): profili ADMIN, QUALITA, AUDITOR, SITE (ambito
// sede), VIEWER; Owner e Admin della Suite sono ADMIN del modulo.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { storageMode } from '../../lib/moduleStorage.js';
import { one } from './db.js';
import { config, KINDS, STATUS_LABEL, ENTE_TIPI, ESITI_TERZI, STRUCTURE_KINDS } from './config.js';
import { ruolo, isAdmin, isQualita, isAuditor, isSite, mySiteIds, limitedToSites } from './lib/access.js';
import { ensureTemplates, managedSites } from './lib/core.js';
import { monthStart, LEVELS } from './lib/scoring.js';
import { aiState } from './lib/synth.js';
import { runAlert17 } from './lib/alerts.js';
import auditsRoutes from './routes/audits.js';
import sitesRoutes from './routes/sites.js';
import synthRoutes from './routes/synth.js';
import archiveRoutes from './routes/archive.js';
import settingsRoutes from './routes/settings.js';

const KEY = 'audit';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // sedi gestite dall'utente (ambito SITE del grant + manager_email dell'organigramma) e modelli seminati
  r.use(ah(async (req, _res, next) => { await ensureTemplates(); req.managedSiteIds = await managedSites(req.user); next(); }));

  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const u = req.moduleUser;
    res.json({ mode: st.mode, user: { id: req.user.id, module_user_id: u.id, email: req.user.email, full_name: req.user.full_name, role: ruolo(req), isAdmin: isAdmin(req), isQualita: isQualita(req), isAuditor: isAuditor(req), isSite: isSite(req), site_ids: mySiteIds(req), limited: limitedToSites(req) },
      limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerUpload }, kinds: KINDS, status: STATUS_LABEL, ente_tipi: ENTE_TIPI, esiti_terzi: ESITI_TERZI, structure_kinds: STRUCTURE_KINDS, levels: LEVELS, storage: storageMode(), ai: aiState() });
  }));

  // Contatori per la sidebar e la card della home: auto-audit del mese mancanti (o "da compilare" per SITE), inviati da verificare
  r.get('/badges', ah(async (req, res) => {
    const period = monthStart(new Date());
    const limited = limitedToSites(req);
    const mine = mySiteIds(req);
    const x = await one(`SELECT
        (SELECT count(*)::int FROM sites_v s WHERE s.in_esercizio AND s.kind = ANY($1) ${limited ? 'AND s.id = ANY($3::int[])' : ''}
           AND NOT EXISTS (SELECT 1 FROM audits a WHERE a.kind='AUTO' AND a.site_id=s.id AND a.period=$2 AND a.deleted_at IS NULL AND a.status <> 'BOZZA')) AS mancanti,
        (SELECT count(*)::int FROM audits a WHERE a.kind='AUTO' AND a.status='INVIATO' AND a.deleted_at IS NULL ${limited ? 'AND a.site_id = ANY($3::int[])' : ''}) AS da_verificare`,
    limited ? [STRUCTURE_KINDS, period, mine] : [STRUCTURE_KINDS, period]);
    // "I miei audit" conta solo ciò che compare in quella pagina: per il site manager gli auto-audit del mese da compilare; per gli altri
    // gli inviati da verificare, gli audit propri in corso e gli auto-audit delle sedi di cui è responsabile. Le sedi senza auto-audit
    // del mese (mancanti) stanno sul Piano degli Audit.
    let miei = x?.mancanti || 0;
    if (!limited) {
      const y = await one(`SELECT count(*)::int AS n FROM audits a WHERE a.deleted_at IS NULL AND a.status NOT IN ('CHIUSO','VERIFICATO')
        AND ((a.kind='AUTO' AND a.status='INVIATO') OR a.conducted_by=$1 OR a.created_by=$1 OR (a.kind='AUTO' AND a.period=$2 AND a.site_id = ANY($3::int[])))`, [req.moduleUser.id, period, mine]);
      miei = y?.n || 0;
    }
    res.json({ mancanti: x?.mancanti || 0, da_verificare: limited ? 0 : (x?.da_verificare || 0), miei });
  }));

  r.use(blockWritesInMirror);
  r.use(auditsRoutes);
  r.use(sitesRoutes);
  r.use(synthRoutes);
  r.use(archiveRoutes);
  r.use(settingsRoutes);
  app.use(`/api/${KEY}`, r);

  // Alert del 17 (scheduler della Suite, disattivabile con DISABLE_SCHEDULER): ogni ora, solo con modulo LIVE
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:alert17`, config.jobMinutes, async () => (await live() ? runAlert17() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: false });
}
