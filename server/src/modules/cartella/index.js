// Modulo Cartella condivisa: cartelle ad albero e documenti per tutti gli utenti con il grant (nessun permesso per cartella,
// richiesta del CEO: cartella pubblica per chi ha il widget). Nativo, si avvia vuoto (FRESH_MODULES). Profili: ADMIN (gestione),
// VIEWER (consultazione). Owner e Admin della Suite sono ADMIN del modulo. Contenuto dei file in BYTEA nello schema del modulo.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { one } from './db.js';
import { config } from './config.js';
import { reindexDocumenti } from './lib/core.js';
import letturaRoutes from './routes/lettura.js';
import gestioneRoutes from './routes/gestione.js';

const KEY = 'cartella';

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    const u = req.moduleUser;
    res.json({ mode: st.mode, user: { id: req.user.id, module_user_id: u.id, email: req.user.email, full_name: req.user.full_name, role: u.role, isAdmin: u.role === 'ADMIN' },
      limiti: { max_file_mb: config.maxFileBytes / 1024 / 1024, max_files: config.maxFilesPerUpload, estensioni: config.allowedExt, novita_giorni: config.novitaGiorni } });
  }));
  // Contatori per la sidebar: novità (caricati negli ultimi N giorni e non ancora aperti da me) ed evidenza (attivi)
  r.get('/badges', ah(async (req, res) => {
    const x = await one(`SELECT
        (SELECT count(*)::int FROM documenti d WHERE d.created_at > now() - make_interval(days => ${config.novitaGiorni}) AND NOT EXISTS (SELECT 1 FROM letture l WHERE l.documento_id=d.id AND l.user_id=$1)) AS novita,
        (SELECT count(*)::int FROM documenti d WHERE d.in_evidenza AND (d.evidenza_fino IS NULL OR d.evidenza_fino >= CURRENT_DATE)) AS evidenza`, [req.user.id]);
    res.json(x);
  }));
  r.use(blockWritesInMirror);
  r.use(letturaRoutes);
  r.use(gestioneRoutes);
  app.use(`/api/${KEY}`, r);

  // Riallineamento dell'indice di ricerca della Suite (scheduler, disattivabile con DISABLE_SCHEDULER)
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:reindex`, 60, async () => (await live() ? reindexDocumenti() : { skipped: true, reason: 'modulo non LIVE' }), { runAtStart: true });
}
