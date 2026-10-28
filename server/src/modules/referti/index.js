// Modulo Referti esterni (area Operations, solo personale di laboratorio): referti PDF dei laboratori esterni (Bianalisi, Cerba RDI
// Limena, Cerba Nuova Igea) trascritti sul format Toscana Diagnostica in DOCX e PDF, con archivio per paziente e registro.
// Nativo, si avvia vuoto (FRESH_MODULES). Accesso solo con grant (open_to_all FALSE): profili LAB (elabora e conferma),
// QUALITA (registro e impostazioni), VIEWER (consultazione); Owner e Admin della Suite sono ADMIN del modulo.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { one } from './db.js';
import { config, SORGENTI } from './config.js';
import { ruolo, isLab, isQualita, isAdmin } from './lib/access.js';
import { applicaRetention } from './lib/core.js';
import { storageMode } from './lib/storage.js';
import elaborazioniRoutes from './routes/elaborazioni.js';
import schedeRoutes from './routes/schede.js';
import archivioRoutes from './routes/archivio.js';
import settingsRoutes from './routes/settings.js';

const KEY = 'referti';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const u = req.moduleUser;
    res.json({ mode: st.mode, user: { id: req.user.id, module_user_id: u.id, email: req.user.email, full_name: req.user.full_name, role: ruolo(req), isAdmin: isAdmin(req), isLab: isLab(req), isQualita: isQualita(req) },
      limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerUpload }, sorgenti: SORGENTI, storage: storageMode() });
  }));
  // Contatore per la sidebar: schede in bozza da confermare
  r.get('/badges', ah(async (_req, res) => {
    const x = await one(`SELECT count(*)::int AS da_confermare FROM schede WHERE stato='BOZZA'`);
    res.json(x || { da_confermare: 0 });
  }));
  r.use(blockWritesInMirror);
  r.use(elaborazioniRoutes);
  r.use(schedeRoutes);
  r.use(archivioRoutes);
  r.use(settingsRoutes);
  app.use(`/api/${KEY}`, r);

  // Retention dei PDF sorgente (scheduler della Suite, disattivabile con DISABLE_SCHEDULER)
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:retention`, config.jobMinutes, async () => (await live() ? applicaRetention() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: false });
}
