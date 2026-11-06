// Modulo Business Hub (ex "Contratti B2C/B2B", rinominato dal CEO il 06/11/2026: "è il centro del Business di Toscana Diagnostica"):
// CRM a fasi per Legal entity e linea (service, punti prelievo, medicina del lavoro) con diario dei contatti, referenti, criticità,
// feed da NC, Ordini, Ticket, Circolari e Portale, caselle di linea (service@, network@, mdl@) in lettura e invio, import del DB
// Opportunità del CEO e vista navigabile (docs/BUSINESS_HUB.md). I contratti in quattro sezioni (punti prelievo, sedi in locazione,
// service, medicina del lavoro), i fascicoli di autorizzazione, i protocolli, le credenziali dei portali e la generazione DOCX/PDF
// restano e sono un "di cui" del percorso commerciale dell'account.
// Anagrafica unica (docs/ANAGRAFICA.md): le controparti sono le Legal entity public.organizations (impostazioni Business in
// business.org_ext), le sedi TD sono public.sites (kind <> 'SERVICE'). Contratti e fascicoli si collegano alla controparte e/o
// alla sede TD (almeno una delle due). Nessuna anagrafica propria; le controparti arrivano dai pacchetti di caricamento come Legal entity.
// Travasato dall'app business.toscanadiagnostica.it: il codice delle route è quello dell'app, cambiano accesso e montaggio.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { HttpError } from '../../lib/util.js';
import { config } from './config.js';
import { publicUser } from './lib/access.js';
import adminRoutes from './routes/admin.js';
import contractRoutes, { filesRouter } from './routes/contracts.js';
import dossierRoutes, { dossierFilesRouter } from './routes/dossier.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/imports.js';
import hubRoutes from './routes/hub.js';
import opportunitaRoutes from './routes/opportunita.js';
import caselleRoutes from './routes/caselle.js';
import pacchettoRoutes from './routes/pacchetto.js';
import listinoRoutes from './routes/listino.js';
import processoRoutes from './routes/processo.js';
import { mountB2b } from './routes/b2b.js';
import { eseguiRichiamo } from './lib/richiamo.js';
import { registerJob } from '../../lib/jobs.js';
import { pollCaselle } from './lib/caselle.js';
import { inviaAvvisi } from './lib/avvisi.js';
import { riprendiAvvii } from './lib/puntoPrelievi.js';

const KEY = 'business';

// Form online pubblica del processo Service (/api/business/b2b/<token>): prima della sessione, senza login (routes/b2b.js)
export function mountPublic(app) { mountB2b(app); }

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // Gli accessi esterni (clienti, partner) non vedono il Business Hub, nemmeno con un grant assegnato per errore
  r.use((req, _res, next) => (req.user?.is_external ? next(new HttpError(403, 'Il Business Hub è riservato al personale di Toscana Diagnostica')) : next()));
  // l'app ragiona con il "suo" utente: la riga della tabella users dello schema business, con role = profilo del grant Suite
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });

  // Contatori di menu: contratti in scadenza entro 60 giorni o scaduti ancora attivi, fascicoli in corso
  r.get('/badges', async (_req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const c = await one(`SELECT count(*)::int AS n FROM contracts WHERE status IN ('FIRMATO','AUTORIZZATO','ATTIVO') AND end_date IS NOT NULL AND end_date <= CURRENT_DATE + 60`);
      const f = await one(`SELECT count(*)::int AS n FROM dossiers WHERE status IN ('IN_CORSO','PRESENTATO')`);
      const e = await one(`SELECT count(*)::int AS n FROM email_in WHERE stato='DA_ASSEGNARE'`);
      const k = await one(`SELECT count(DISTINCT x.account_id)::int AS n FROM activities x JOIN accounts a ON a.id=x.account_id WHERE x.esito='DA_CONFERMARE' AND NOT a.cliente_attivo`);
      const v = await one(`SELECT count(DISTINCT account_id)::int AS n FROM documenti WHERE da_verificare AND account_id IS NOT NULL`);
      res.json({ contratti_in_scadenza: c.n, fascicoli_aperti: f.n, email_da_assegnare: e.n, da_confermare: k.n, da_verificare: v.n });
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res, next) => {
    try {
      const st = await getModuleState(KEY);
      res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) });
    } catch (e) { next(e); }
  });
  // stessa forma che il front-end dell'app si aspetta da /auth/me
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE', onboarding: null }));
  r.get('/auth/config', (_req, res) => res.json({ appName: config.appName, entraEnabled: false }));

  r.use(blockWritesInMirror);
  r.use(adminRoutes);            // settings, organizations (org_ext), sites, audit (gli utenti li gestisce la Suite)
  r.use('/contracts', contractRoutes);
  r.use('/dossiers', dossierRoutes);
  r.use(filesRouter);            // GET /contract-files/:id
  r.use(dossierFilesRouter);     // GET /dossier-files/:id
  r.use('/stats', statsRoutes);
  r.use(importRoutes);           // POST /import/pack (pacchetti dello status quo), GET /import/runs
  r.use('/hub', hubRoutes);      // CRM: account, fasi, cliente attivo, diario, referenti, criticità, documenti, email, cruscotto
  r.use('/hub', opportunitaRoutes); // vista DB Opportunità con export, import del file del CEO
  r.use('/hub', pacchettoRoutes);   // Pacchetto di benvenuto: composizione, generazione del PDF unico, modelli dei testi
  r.use('/hub', listinoRoutes);     // Listino StudioLAB per cliente (versioni) e Offerta economica in PDF
  r.use('/hub', processoRoutes);    // processo Service: kit di proposta, form online, contrattualizzazione, clienti, richiamo dei prospect
  r.use(caselleRoutes);          // /hub/caselle (stato e prove), /inbox/simula (collaudo)
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

  // Errori propri del modulo (multer, duplicati): il resto lo gestisce l'error handler della Suite
  r.use((err, req, _res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (max ${config.maxUploadMb} MB)`));
    if (err?.code === '23505') return next(new HttpError(409, 'Elemento duplicato'));
    next(err);
  });

  app.use(`/api/${KEY}`, r);

  // Caselle di linea (ogni 10 minuti) e avvisi agli owner degli account (scheduler della Suite, disattivabile con DISABLE_SCHEDULER)
  const live = async () => (await getModuleState(KEY)).mode === 'LIVE';
  registerJob(`${KEY}:inbox`, config.inboxMinutes, async () => (await live() ? pollCaselle() : { skipped: true, reason: 'modulo non LIVE' }));
  registerJob(`${KEY}:avvisi`, config.avvisiMinutes, async () => (await live() ? inviaAvvisi() : { skipped: true, reason: 'modulo non LIVE' }));
  // Richiamo dei prospect: controllo ogni ora, invio una volta al giorno dopo le 9 e solo con l'interruttore acceso (lib/richiamo.js)
  registerJob(`${KEY}:richiamo-prospect`, 60, async () => (await live() ? eseguiRichiamo() : { skipped: true, reason: 'modulo non LIVE' }));
  // Punti Prelievo: ripresa dei passi dell'avvio in attesa della sede o della data (mai i non riusciti, che aspettano "Riprova")
  registerJob(`${KEY}:avvio-pp`, 30, async () => (await live() ? riprendiAvvii() : { skipped: true, reason: 'modulo non LIVE' }));
}
