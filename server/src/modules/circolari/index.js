// Modulo Circolari aziendali: registro unico delle circolari con protocollo progressivo TD-AAAA/NNN, impaginazione
// sulla carta intestata (DOCX + PDF), archivio con ricerca sul contenuto, liste di distribuzione e invio ai clienti,
// versione digitale raggiungibile dal QR code. Si avvia vuoto sull'anagrafica unica (FRESH_MODULES).
// Profili: ADMIN (tutto, impostazioni), PUBBLICATORE (pubblica, invia, revisiona), REDATTORE (bozze e anteprime), VIEWER.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { ah } from '../../lib/util.js';
import { one } from './db.js';
import circolariRoutes, { reindexCircolari } from './routes/circolari.js';
import listeRoutes from './routes/liste.js';
import publicRoutes from './routes/public.js';
import { pdfAvailable } from './lib/pdf.js';
import { perimetro } from './lib/visibilita.js';
import { aiEnabled } from '../../lib/claude.js';

const KEY = 'circolari';

export const publicUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, suite_user_id: u.suite_user_id, suite_level: u.suite_level });

// Versione digitale delle circolari (QR code): raggiungibile senza sessione, montata dalla Suite prima di sessione e CSRF
export function mountPublic(app) { app.use(`/api/${KEY}/pub`, publicRoutes); }

export default function mount(app) {
  const r = Router();
  // openToAll: chiunque sia autenticato entra come VIEWER; il perimetro di lettura lo calcola lib/visibilita.js dall'anagrafica unica
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN', openToAll: true, defaultRole: 'VIEWER' } }));
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });
  r.get('/state', ah(async (req, res) => {
    const st = await getModuleState(KEY);
    res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: { ...publicUser(req.user), perimetro: await perimetro(req) } });
  }));
  r.get('/auth/me', ah(async (req, res) => res.json({ user: { ...publicUser(req.user), perimetro: await perimetro(req) }, authMethod: 'SUITE' })));
  r.get('/capabilities', ah(async (_req, res) => res.json({ pdf: await pdfAvailable(), ai: aiEnabled() })));
  r.get('/badges', ah(async (_req, res) => {
    const per = await perimetro(_req);
    const x = per.tutte
      ? await one(`SELECT count(*) FILTER (WHERE stato='BOZZA')::int AS bozze, count(*) FILTER (WHERE stato='PUBBLICATA')::int AS pubblicate FROM circolari`)
      : await one(`SELECT 0 AS bozze, count(*)::int AS pubblicate FROM circolari WHERE stato='PUBBLICATA' AND segmento = ANY($1)`, [per.segmenti]);
    res.json(x || {});
  }));
  r.use(blockWritesInMirror);
  r.use(listeRoutes);
  r.use(circolariRoutes);
  app.use(`/api/${KEY}`, r);

  // Indice di ricerca della Suite: riallineamento periodico delle circolari pubblicate (solo modulo LIVE)
  registerJob(`${KEY}:reindex`, 60, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    return reindexCircolari();
  }, { runAtStart: true });
}
