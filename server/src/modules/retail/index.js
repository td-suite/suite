// Modulo Retail Assistant (retail.toscanadiagnostica.it) travasato nella Suite: clienti B2C e B2B, vendite, prestazioni,
// campagne, calendario promozionale, esposizione e book retail, budget e scostamenti, import dai gestionali, connettori.
// Autenticazione, utenti e profili sono della Suite; il codice dell'app lavora con la "sua" riga users nello schema retail
// (req.moduleUser) con role = profilo del grant (ADMIN, RETAIL, SEDE, VIEWER) e site_ids = sedi dell'anagrafica unica negli scope del grant.
// Sedi e persone sono quelle della Suite (public.sites, public.people): il modulo tiene solo site_ext e person_ext (docs/ANAGRAFICA.md).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { many } from './db.js';
import { config } from './config.js';
import { syncConnector, migrateCredentialsToCore } from './lib/connectors.js';
import adminRoutes from './routes/admin.js';
import customerRoutes from './routes/customers.js';
import productRoutes from './routes/products.js';
import salesRoutes from './routes/sales.js';
import campaignRoutes from './routes/campaigns.js';
import promotionRoutes from './routes/promotions.js';
import exposureRoutes from './routes/exposure.js';
import connectorRoutes from './routes/connectors.js';
import statsRoutes from './routes/stats.js';
import budgetRoutes from './routes/budget.js';
import structureRoutes from './routes/structure.js';
import intornoRoutes from './routes/intorno.js';
import tuotempoRoutes from './routes/tuotempo.js';
import profiloPazientiRoutes from './routes/profiloPazienti.js';
import b2bRoutes from './routes/b2b.js';
import prenotazioniRoutes from './routes/prenotazioni.js';
import laboratorioRoutes from './routes/laboratorio.js';
import { rilevazioneMensile, mockAttivo as intornoMock } from './lib/intorno.js';
import { chiaveServer } from '../../lib/googleMaps.js';

const KEY = 'retail';

// Stessa forma dell'utente che il front-end dell'app si aspetta da /auth/me
export const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, site_id: u.site_id ?? null, site_ids: u.site_ids || [],
  auth_provider: u.auth_provider || 'ENTRA', must_change_password: false, totp_enabled: false, active: true,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

// Dopo migrazioni e caricamento dei connettori: le credenziali dei connettori dell'app di origine (retail.connectors) si copiano
// una volta nel connettore unico della Suite, se quello è ancora vuoto
export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.schema_ready) await migrateCredentialsToCore();
  // TuoTempo: gli abbinamenti area ↔ sede salvati finora solo nello specchio (retail.site_ext) passano nella fonte (public.sites.legacy_refs,
  // con saveSite e audit); idempotente, non fa nulla quando fonte e specchio coincidono
  if (st.schema_ready) {
    try { const { portaSpecchioNellaFonte } = await import('./lib/tuotempo.js'); const r = await portaSpecchioNellaFonte(); if (r.portati) console.log(`[retail] TuoTempo: abbinamenti area ↔ sede portati nell'anagrafica: ${r.portati}`); }
    catch (e) { console.warn('[retail] TuoTempo, abbinamenti nello specchio:', e.message); }
  }
}

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // L'app ragiona con il suo utente: la riga users dello schema retail, con il ruolo = profilo del grant Suite.
  // Il perimetro del profilo SEDE sono gli id di public.sites negli scope SITE del grant (anagrafica unica, req.moduleUser.site_ids).
  r.use((req, _res, next) => {
    req.suiteUser = req.user;
    const siteIds = (req.moduleUser.site_ids || []).map(Number).filter(Number.isFinite);
    req.user = { ...req.moduleUser, site_id: siteIds[0] ?? null, site_ids: siteIds };
    next();
  });
  // Contatori di menu: richiami periodici scaduti, campagne in corso
  r.get('/badges', async (_req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const rc = await one(`SELECT count(*) FILTER (WHERE due < CURRENT_DATE)::int AS overdue FROM (SELECT s.customer_id, p.id, (max(s.sale_date) + (p.periodicity_months || ' months')::interval)::date AS due FROM sales s JOIN products p ON p.id=s.product_id WHERE s.customer_id IS NOT NULL AND p.periodicity_months IS NOT NULL GROUP BY s.customer_id, p.id) x`);
      const ca = await one(`SELECT count(*)::int AS n FROM campaigns WHERE status='ATTIVA'`);
      // voce "Laboratorio in sede" visibile solo con l'impostazione synclab_privati_in_b2c a true (flag del menu)
      const { privatiInB2c } = await import('./lib/b2b.js');
      res.json({ richiami_scaduti: rc.overdue, campagne_attive: ca.n, laboratorio_in_sede: (await privatiInB2c()) ? 1 : 0 });
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res, next) => {
    try { const st = await getModuleState(KEY); res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) }); } catch (e) { next(e); }
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), onboarding: null, authMethod: 'SUITE' }));
  r.use(blockWritesInMirror);
  r.use(adminRoutes);                 // settings, demo, sites, product-lines, audit
  r.use('/customers', customerRoutes);
  r.use('/products', productRoutes);
  r.use('/sales', salesRoutes);
  r.use('/campaigns', campaignRoutes);
  r.use('/promotions', promotionRoutes);
  r.use('/exposure', exposureRoutes);
  r.use('/connectors', connectorRoutes);
  r.use('/tuotempo', tuotempoRoutes);   // TuoTempo Fase 1: aree ↔ sedi, risorse ↔ persone, prenotazione online, listino (docs/RETAIL_TUOTEMPO.md)
  r.use('/profilo-pazienti', profiloPazientiRoutes);   // Profilo dei pazienti del laboratorio (Synclab, proiezione standard: docs/RETAIL_PROFILO_PAZIENTI.md)
  r.use('/stats', statsRoutes);           // anche /stats/rete: cruscotto complessivo B2C + B2B (riordino del 09/11/2026, docs/RETAIL.md)
  r.use('/b2b', b2bRoutes);               // sezione B2B: tutto da StudioLab (Synclab): cruscotto, clienti, scheda, produzione, fatturato, listini, budget
  r.use('/prenotazioni', prenotazioniRoutes);   // B2C: prenotazioni online e prima disponibilità (TuoTempo)
  r.use('/laboratorio', laboratorioRoutes);     // B2C: Laboratorio in sede (Synclab dei punti TD, con l'impostazione synclab_privati_in_b2c)
  r.use(budgetRoutes);                // working-days, budgets, variance, market
  r.use('/structure', structureRoutes);
  r.use(intornoRoutes);               // Intorno: luoghi intorno alle sedi e indirizzi valutati (Google Places, docs/RETAIL_INTORNO.md)
  // Errori specifici dell'app (duplicati, file troppo grandi) con i messaggi dell'app; il resto al gestore della Suite
  r.use((err, _req, res, next) => {
    if (err?.code === '23505') return res.status(409).json({ error: 'Elemento duplicato (codice, codice fiscale, partita IVA o email già presenti)' });
    if (err?.code === '23503') return res.status(400).json({ error: 'Riferimento non valido: la sede, la persona o l\'organizzazione indicata non esiste nell\'anagrafica della Suite' });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File troppo grande (max ${config.maxUploadMb} MB)` });
    next(err);
  });
  app.use(`/api/${KEY}`, r);

  // Sincronizzazione schedulata dei connettori abilitati (come lo scheduler dell'app, controllo ogni 15 minuti): solo con modulo LIVE
  registerJob(`${KEY}:sync-connettori`, 15, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    // TuoTempo ha il suo job notturno (retail:tuotempo): qui solo gli altri connettori con una pianificazione
    const rows = await many("SELECT kind, schedule, last_sync_at FROM connectors WHERE enabled AND schedule<>'MANUALE' AND kind<>'TUOTEMPO'");
    const done = [];
    for (const c of rows) {
      const hours = c.schedule === 'HOURLY' ? 1 : 24;
      if (c.last_sync_at && Date.now() - new Date(c.last_sync_at).getTime() < hours * 3600 * 1000) continue;
      try { await syncConnector(c.kind, null); done.push({ kind: c.kind, ok: true }); } catch (e) { done.push({ kind: c.kind, error: e.message }); }
    }
    return { synced: done };
  });

  // TuoTempo, Fase 1: allineamento notturno delle Key Entities (aree, attività con la prima disponibilità del giorno, risorse,
  // assicurazioni). Il job si controlla ogni ora e lavora una volta per notte, tra le 2 e le 5 (ora di Roma), se il connettore della
  // Suite è attivo; "Allinea adesso" fa lo stesso a richiesta. Solo con modulo LIVE.
  registerJob(`${KEY}:tuotempo`, 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    const ora = Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (ora < 2 || ora >= 5) return { skipped: true, reason: 'fuori dalla finestra notturna (2-5)' };
    const { getConnector: core } = await import('../../lib/connectors.js');
    const c = await core('TUOTEMPO').catch(() => null);
    if (!c?.active) return { skipped: true, reason: 'connettore TuoTempo non attivo (Amministrazione > Connettori)' };
    const ult = (await many("SELECT last_sync_at FROM connectors WHERE kind='TUOTEMPO'"))[0]?.last_sync_at;
    if (ult && Date.now() - new Date(ult).getTime() < 20 * 3600 * 1000) return { skipped: true, reason: 'già allineato nelle ultime 20 ore' };
    const out = await syncConnector('TUOTEMPO', null);
    return { aree: out.aree, abbinate: out.aree_abbinate, attivita: out.attivita, risorse: out.risorse };
  });

  // Intorno: rilevazione mensile di tutte le sedi attive del network (docs/RETAIL_INTORNO.md). Il job gira ogni giorno e rileva solo
  // le sedi senza una rilevazione nel mese corrente, fermandosi al tetto giornaliero: le restanti il giorno dopo. Solo con modulo
  // LIVE e con la chiave server (o le risposte di prova INTORNO_MOCK=1 fuori produzione).
  registerJob(`${KEY}:intorno`, 24 * 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    if (!chiaveServer() && !intornoMock()) return { skipped: true, reason: 'GOOGLE_MAPS_SERVER_KEY non impostata' };
    return rilevazioneMensile();
  });
}
