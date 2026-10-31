// Modulo Contracts (Contratti del Personale, People): dipendenti e liberi professionisti, dossier con allegati, CCNL e
// minimi tabellari, simulatore busta paga, generazione DOCX/PDF di contratti, MBO, lettere di impegno e contratti LP,
// organigramma generato dai ruoli, scadenze, CV Box, caricamento massivo e pacchetto iniziale.
// Casella People (people@toscanadiagnostica.it, routes/people.js): richiami automatici sulle scadenze ai diretti destinatari e
// lettura della casella con i documenti a supporto della chiusura, che il CEO o l'HR Manager approvano prima dell'upload nel dossier.
// Travasato dall'app contracts.toscanadiagnostica.it: il codice delle route è quello dell'app, cambiano solo accesso
// (sessione e grant della Suite) e montaggio sotto /api/contracts.
// MODULO RISERVATO: entra solo chi ha il grant contracts oppure il titolare della Suite (OWNER). Un ADMIN Suite senza grant
// non vede nulla, a differenza degli altri moduli. Ogni lettura di una scheda viene registrata nel read_log della Suite.
// ANAGRAFICA UNICA (docs/ANAGRAFICA.md, migrazione 016): le persone sono public.people e questo è il modulo HR che le crea e le
// modifica (lib/people.js, con audit PERSON_CREATED / PERSON_UPDATED della Suite); il dossier riservato sta in contracts.person_ext,
// le sedi di lavoro sono public.sites. Niente tabelle resources e work_sites; le letture passano dalla vista resources_v.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { HttpError, forbidden } from '../../lib/util.js';
import { config } from './config.js';
import { publicUser } from './lib/access.js';
import { applyDueTerminations } from './lib/termination.js';
import { ensureSeed } from './lib/seed.js';
import { pollRecruitingInbox } from './lib/inbox.js';
import { runReminders } from './lib/peopleMail.js';
import { pollPeopleInbox } from './lib/peopleInbox.js';
import adminRoutes from './routes/admin.js';
import resourceRoutes from './routes/resources.js';
import documentRoutes from './routes/documents.js';
import scoutingRoutes from './routes/scouting.js';
import ccnlRoutes from './routes/ccnl.js';
import orgRoutes from './routes/org.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/imports.js';
import peopleRoutes from './routes/people.js';

const KEY = 'contracts';

export default function mount(app) {
  const r = Router();
  // Modulo riservato: il controllo sta prima di requireModuleReady così un ADMIN Suite senza grant viene respinto (403)
  // senza che venga creata la sua riga nella tabella users dello schema del modulo. defaultAdminRole 'ADMIN' vale quindi SOLO per OWNER.
  const requireGrantOrOwner = (req, _res, next) => (req.user.level === 'OWNER' || req.user.grants?.[KEY] ? next() : next(forbidden('Modulo riservato: accesso consentito solo con un profilo assegnato dal titolare')));
  r.use(requireAuth, requireGrantOrOwner, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  r.use((req, _res, next) => {
    if (req.user.level !== 'OWNER' && !req.user.grants?.[KEY]) return next(forbidden('Modulo riservato'));   // difesa in profondità
    // l'app ragiona con il "suo" utente: la riga della tabella users dello schema contracts, con role = profilo del grant Suite
    req.suiteUser = req.user;
    req.user = req.moduleUser;
    next();
  });

  // Contatori accanto alle voci di menu (richiesta del CEO: notifiche su tutti i widget)
  r.get('/badges', async (_req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const { computeDeadlines } = await import('./lib/deadlines.js');
      const { getSettings } = await import('./lib/payroll.js');
      const deadlines = await computeDeadlines({ horizonDays: Number((await getSettings()).deadline_alert_days || 60) });
      const cv = await one(`SELECT count(*)::int AS n FROM cv_box WHERE status='NUOVO'`);
      const lettere = await one(`SELECT count(*)::int AS n FROM commitment_letters WHERE status IN ('BOZZA','INVIATA')`);
      const people = await one(`SELECT count(*)::int AS n FROM people_inbox WHERE status='DA_APPROVARE'`);
      res.json({ scadenze: deadlines.filter((d) => d.days <= 30).length, cv_nuovi: cv.n, lettere_aperte: lettere.n, people_da_approvare: people.n });
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

  // Il simulatore busta paga è un POST di solo calcolo (nessuna scrittura): resta disponibile anche in MIRROR
  r.use('/ccnl', (req, res, next) => (req.method === 'POST' && (req.path === '/simulate' || req.path === '/simulate/export') ? ccnlRoutes(req, res, next) : next()));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);                // settings, areas, work-sites (elenco di public.sites), audit (gli utenti li gestisce la Suite)
  r.use('/resources', resourceRoutes);
  r.use(documentRoutes);              // /resources/:id/documents/generate, /documents/...
  r.use('/scouting', scoutingRoutes);
  r.use('/ccnl', ccnlRoutes);
  r.use('/org', orgRoutes);
  r.use('/stats', statsRoutes);
  r.use('/import', importRoutes);
  r.use('/people-inbox', peopleRoutes);   // casella People: impostazioni, richiami, messaggi da approvare
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));

  // Errori propri del modulo (multer, duplicati): il resto lo gestisce l'error handler della Suite
  r.use((err, req, _res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (max ${req.path.startsWith('/import') ? config.maxPackMb : config.maxUploadMb} MB)`));
    if (err?.code === '23505') return next(new HttpError(409, 'Elemento duplicato (codice fiscale o email già presenti)'));
    next(err);
  });

  app.use(`/api/${KEY}`, r);

  // Cessazioni con decorrenza raggiunta: una volta al giorno, solo con modulo LIVE (in MIRROR i dati arrivano dall'app originale)
  // Dati di base (livelli e minimi CCNL, requisiti del dossier): una volta al giorno e all'avvio, solo con modulo pronto
  registerJob(`${KEY}:dati-base`, 24 * 60, async () => {
    const st = await getModuleState(KEY);
    if (!st.schema_ready) return { skipped: true };
    return ensureSeed();
  }, { runAtStart: true });
  // Casella recruitment@: ogni 10 minuti i CV allegati alle email entrano nel CV Box (solo modulo LIVE)
  registerJob(`${KEY}:cv-inbox`, 10, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    return pollRecruitingInbox();
  }, { runAtStart: true });
  // Casella People: richiami sulle scadenze dal mittente people@ (ogni 60 minuti; ogni scadenza e soglia una volta sola)
  registerJob(`${KEY}:richiami`, 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    return runReminders();
  });
  // Casella People: ogni 10 minuti i messaggi con allegati entrano in "Casella People" da approvare (nessun upload automatico)
  registerJob(`${KEY}:people-inbox`, 10, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    return pollPeopleInbox();
  }, { runAtStart: true });
  registerJob(`${KEY}:cessazioni`, 24 * 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, mode: st.mode };
    const n = await applyDueTerminations();
    return { cessate: n };
  });
}
