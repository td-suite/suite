// Modulo Room Planning (planning.toscanadiagnostica.it) travasato nella Suite: pianificazione ambulatori, sedi, personale sanitario.
// Autenticazione, utenti e profili sono della Suite; sedi e persone sono quelle dell'anagrafica unica (public.sites, public.people,
// docs/ANAGRAFICA.md) con le estensioni Room in site_ext / person_ext. Il codice dell'app lavora con la "sua" riga users nello schema
// room (req.moduleUser) con role = profilo del grant, site_ids = sedi degli scope del grant e person_id = persona dell'utente.
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { HttpError } from '../../lib/util.js';
import { PROF_PREFIXES } from './lib/access.js';
import { runDailyAlert } from './lib/alerts.js';
import { extData } from './lib/strutture.js';
import struttureRoutes from './routes/strutture.js';
import calendarioRoutes from './routes/calendario.js';
import commsRoutes from './routes/comms.js';
import personaleRoutes from './routes/personale.js';
import portaleRoutes from './routes/portale.js';
import adminRoutes from './routes/admin.js';

const KEY = 'room';

// Stessa forma dell'utente che il front-end dell'app si aspetta da /auth/me
export const publicUser = (u) => ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name || null, last_name: u.last_name || null, role: u.role, auth_provider: u.auth_provider || 'ENTRA',
  must_change_password: false, totp_enabled: false, active: true, site_ids: u.site_ids || [], person_id: u.person_id || null,
  suite_user_id: u.suite_user_id, suite_level: u.suite_level,
});

// ---------------------------------------------------------------- travaso: estensioni dall'app di origine
// Eseguito dal job di travaso nella stessa transazione, dopo la copia generica delle tabelle. Le anagrafiche dell'app (strutture,
// professionisti) non esistono più nel modulo: qui si riempiono site_ext e person_ext dall'origine traducendo gli id con legacy_refs.
// Persone dell'origine senza corrispondenza in public.people: si cercano per codice fiscale o email (riaggancio, legacy_refs.room aggiunto)
// e, se mancano del tutto, si creano in public.people (Room è il modulo con i dati veri: nessun medico va perso). Siccome la copia
// generica è avvenuta prima, le righe che dipendono da queste persone vengono ricopiate qui (turni aggiornati, le altre reinserite).
const lower = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);
const clean = (s) => (s == null ? null : String(s).trim() || null);
const normCf = (s) => { const c = String(s || '').replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{11,16}$/.test(c) ? c : null; };
const validEmail = (e) => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

export async function afterTravaso(client, key, { legacyQuery, legacyMap, stats }) {
  const siteMap = await legacyMap('sites');
  const peopleMap = new Map(await legacyMap('people'));
  const site = (v) => (v == null ? null : siteMap.get(String(v)) ?? null);
  const scart = (t, n = 1) => { stats.__scartate = stats.__scartate || {}; stats.__scartate[t] = (stats.__scartate[t] || 0) + n; };
  const recovered = (t, n) => { if (!n || !stats.__scartate?.[t]) return; stats.__scartate[t] = Math.max(0, stats.__scartate[t] - n); if (!stats.__scartate[t]) delete stats.__scartate[t]; };

  // 1) sedi: impostazioni Room (documento senza anagrafica e senza binari) in site_ext
  await client.query('DELETE FROM site_ext');
  const strutture = await legacyQuery('SELECT id, data, version, created_at, updated_at, updated_by, deleted_at FROM public.strutture ORDER BY id');
  let nSites = 0;
  for (const s of strutture) {
    if (s.deleted_at) { stats.strutture_cestino = (stats.strutture_cestino || 0) + 1; continue; }   // il cestino dell'app non si porta: la sede non esiste nell'anagrafica
    const sid = site(s.id);
    if (!sid) { scart('site_ext'); continue; }
    await client.query(`INSERT INTO site_ext (site_id, data, version, created_at, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (site_id) DO UPDATE SET data=EXCLUDED.data, version=EXCLUDED.version, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by`,
    [sid, JSON.stringify(extData(s.data || {})), s.version || 1, s.created_at, s.updated_at, s.updated_by]);
    nSites++;
  }
  stats.site_ext = nSites;

  // 2) persone: riaggancio o creazione in public.people di chi manca
  const profs = await legacyQuery('SELECT p.*, u.email AS user_email FROM public.professionisti p LEFT JOIN public.users u ON u.id = p.user_id ORDER BY p.id');
  const nuove = [];   // id dell'app di origine delle persone non presenti nella mappa al momento della copia generica
  for (const p of profs) {
    if (peopleMap.has(String(p.id))) continue;
    const an = p.dati?.anagrafica || {};
    const email = [p.email, p.user_email, an.email].map(lower).find(validEmail) || null;
    const cf = normCf(an.codiceFiscale || p.dati?.codiceFiscale);
    let hit = cf ? (await client.query('SELECT id FROM public.people WHERE upper(tax_code) = $1 LIMIT 1', [cf])).rows[0] : null;
    if (!hit && email) hit = (await client.query(`SELECT id FROM public.people WHERE lower(email) = $1 AND NOT (legacy_refs ? 'room') ORDER BY id LIMIT 1`, [email])).rows[0];
    if (hit) {
      await client.query(`UPDATE public.people SET legacy_refs = legacy_refs || jsonb_build_object('room', $2::int), updated_at = now() WHERE id = $1`, [hit.id, p.id]);
      peopleMap.set(String(p.id), hit.id); nuove.push(p.id);
      stats.persone_riagganciate = (stats.persone_riagganciate || 0) + 1;
      continue;
    }
    let last = clean(an.cognome || p.dati?.cognome), first = clean(an.nome || p.dati?.nome);
    if (!last || !first) { const parts = String(p.nome || '').trim().split(/\s+/); last = parts[0] || '?'; first = parts.slice(1).join(' ') || ''; }
    const discipline = p.dati?.professionale?.discipline?.[0] || p.dati?.discipline?.[0] || null;
    const row = (await client.query(`INSERT INTO public.people (kind, status, last_name, first_name, tax_code, email, phone, job_title, discipline, legacy_refs, needs_review)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,jsonb_build_object('room', $10::int), TRUE) RETURNING id`,
    [p.tipo === 'medico' ? 'MEDICO' : 'SANITARIO', p.attivo === false ? 'CESSATO' : 'ATTIVO', last, first, cf, email, clean(an.cellulare || an.telefono), clean(p.profilo), clean(discipline), p.id])).rows[0];
    peopleMap.set(String(p.id), row.id); nuove.push(p.id);
    stats.persone_create = (stats.persone_create || 0) + 1;
  }
  const person = (v) => (v == null ? null : peopleMap.get(String(v)) ?? null);

  // 3) schede Room in person_ext (riferimenti alle sedi tradotti; i dati che vivono in public.people non si duplicano)
  await client.query('DELETE FROM person_ext');
  const translateDati = (dati) => {
    const d = { ...(dati || {}) };
    d.sediAbilitate = [...new Set((d.sediAbilitate || []).map(site).filter(Boolean))];
    if (d.compenso) d.compenso = { ...d.compenso, eccezioniSede: (d.compenso.eccezioniSede || []).map((e) => ({ ...e, sedeId: site(e.sedeId) })).filter((e) => e.sedeId) };
    if (d.anagrafica) { d.anagrafica = { ...d.anagrafica }; for (const k of ['cognome', 'nome', 'codiceFiscale', 'email', 'telefono', 'cellulare', 'sesso', 'dataNascita']) delete d.anagrafica[k]; }
    for (const k of ['cognome', 'nome', 'codiceFiscale', 'cellulare', 'telefono', 'discipline']) delete d[k];   // vecchio formato piatto
    return d;
  };
  let nExt = 0;
  for (const p of profs) {
    const pid = person(p.id);
    if (!pid) { scart('person_ext'); continue; }
    const r = await client.query(`INSERT INTO person_ext (person_id, tipo, profilo, dati, created_at, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (person_id) DO UPDATE SET tipo=EXCLUDED.tipo, profilo=EXCLUDED.profilo, dati=person_ext.dati || EXCLUDED.dati, updated_at=GREATEST(person_ext.updated_at, EXCLUDED.updated_at) RETURNING (xmax = 0) AS inserted`,
    [pid, p.tipo === 'medico' ? 'medico' : 'sanitario', clean(p.profilo), JSON.stringify(translateDati(p.dati)), p.created_at, p.updated_at, p.updated_by]);
    if (r.rows[0].inserted) nExt++; else stats.persone_unite = (stats.persone_unite || 0) + 1;
  }
  stats.person_ext = nExt;

  // 4) righe dipendenti dalle persone create o riagganciate qui (la copia generica le ha scartate o lasciate senza persona)
  if (nuove.length) {
    // i turni (prof_id NULL ammesso) sono stati copiati senza persona: si riagganciano; le altre tabelle (prof_id obbligatorio) si reinseriscono
    const turni = await legacyQuery('SELECT id, prof_id FROM public.turni WHERE prof_id = ANY($1::int[])', [nuove]);
    for (const t of turni) await client.query('UPDATE turni SET prof_id=$2 WHERE id=$1', [t.id, person(t.prof_id)]);
    stats.turni_riagganciati = turni.length;
    const reinsert = async (table, cols, rows) => {
      if (!rows.length) return 0;
      let n = 0;
      for (const r of rows) {
        const vals = cols.map((c) => r[c]);
        await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, vals);
        n++;
      }
      recovered(table, n); stats[table] = (stats[table] || 0) + n;
      return n;
    };
    const disp = (await legacyQuery('SELECT * FROM public.disponibilita WHERE prof_id = ANY($1::int[])', [nuove])).map((r) => ({ ...r, prof_id: person(r.prof_id), sedi: JSON.stringify((Array.isArray(r.sedi) ? r.sedi : []).map(site).filter(Boolean)) }));
    await reinsert('disponibilita', ['id', 'prof_id', 'kind', 'giorno', 'data', 'valid_dal', 'valid_al', 'ora_da', 'ora_a', 'sedi', 'nota', 'created_at', 'updated_at'], disp);
    const pres = (await legacyQuery('SELECT * FROM public.presenze WHERE prof_id = ANY($1::int[])', [nuove])).map((r) => ({ ...r, prof_id: person(r.prof_id), sede_id: site(r.sede_id) })).filter((r) => r.sede_id);
    await reinsert('presenze', ['id', 'prof_id', 'sede_id', 'data', 'ora_da', 'ora_a', 'origine', 'turno_id', 'stato', 'attivita', 'nota', 'confermato_da', 'confermato_at', 'rendiconto_id'], pres);
    const rend = (await legacyQuery('SELECT * FROM public.rendiconti WHERE prof_id = ANY($1::int[])', [nuove])).map((r) => ({ ...r, prof_id: person(r.prof_id), dettaglio: JSON.stringify(r.dettaglio || {}) }));
    await reinsert('rendiconti', ['id', 'prof_id', 'mese', 'stato', 'ore', 'importo', 'dettaglio', 'nota', 'generato_da', 'generato_at', 'approvato_da', 'approvato_at', 'inviato_at', 'email_log_id'], rend);
    const cand = (await legacyQuery('SELECT * FROM public.candidature WHERE prof_id = ANY($1::int[])', [nuove])).map((r) => ({ ...r, prof_id: person(r.prof_id) }));
    await reinsert('candidature', ['id', 'posizione_id', 'prof_id', 'nota', 'stato', 'created_at'], cand);
    const docs = (await legacyQuery('SELECT * FROM public.professionista_docs WHERE prof_id = ANY($1::int[])', [nuove])).map((r) => ({ ...r, person_id: person(r.prof_id) }));
    await reinsert('professionista_docs', ['id', 'person_id', 'tipo', 'nome', 'mime', 'size', 'scadenza', 'note', 'data', 'created_at', 'created_by'], docs);
  }

  // 5) riferimenti alle sedi dentro i JSON copiati dalla copia generica: disponibilita.sedi e rendiconti.dettaglio
  const dispRows = (await client.query('SELECT id, sedi FROM disponibilita')).rows;
  for (const d of dispRows) {
    const cur = Array.isArray(d.sedi) ? d.sedi : [];
    const tr = [...new Set(cur.map((v) => (typeof v === 'number' ? v : site(v))).filter(Boolean))];
    if (JSON.stringify(tr) !== JSON.stringify(cur)) await client.query('UPDATE disponibilita SET sedi=$2 WHERE id=$1', [d.id, JSON.stringify(tr)]);
  }
  const rendRows = (await client.query('SELECT id, dettaglio FROM rendiconti')).rows;
  for (const r of rendRows) {
    const det = r.dettaglio || {}; let changed = false;
    const fix = (x) => { if (x && typeof x.sedeId === 'string') { const sid = site(x.sedeId); if (sid) { x.sedeId = sid; changed = true; } } };
    (det.righe || []).forEach(fix); (det.perSede || []).forEach(fix);
    if (changed) await client.query('UPDATE rendiconti SET dettaglio=$2 WHERE id=$1', [r.id, JSON.stringify(det)]);
  }
}

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role', extraColumns: { defaultAdminRole: 'ADMIN' } }));
  // L'app ragiona con il suo utente: la riga users dello schema room, con il ruolo = profilo del grant Suite.
  // Il perimetro (ex user_strutture dell'app) sono gli id di public.sites negli scope SITE del grant (req.user.site_ids).
  r.use((req, _res, next) => {
    req.suiteUser = req.user;
    const mu = req.moduleUser;
    req.user = { ...mu, site_ids: [...new Set((mu.site_ids || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b), person_id: mu.person_id || null };
    next();
  });
  // Contatori per la sidebar della Suite (voci di menu con badge in meta.js)
  r.get('/badges', async (req, res, next) => {
    try {
      const { one } = await import('./db.js');
      const r = await one(`SELECT count(*)::int AS n FROM turni WHERE prof_id IS NULL AND mese = to_char(CURRENT_DATE, 'YYYY-MM')`);
      res.json({ scoperti: r.n });
    } catch (e) { next(e); }
  });
  r.get('/state', async (req, res, next) => {
    try { const st = await getModuleState(KEY); res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) }); } catch (e) { next(e); }
  });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), onboarding: null, authMethod: 'SUITE' }));
  // I professionisti (profilo PROF) usano solo il proprio portale
  r.use((req, _res, next) => (req.user?.role === 'PROF' && !PROF_PREFIXES.some((p) => req.path.startsWith(p)) ? next(new HttpError(403, 'Area riservata al personale interno')) : next()));
  r.use(blockWritesInMirror);
  r.use('/personale', personaleRoutes);
  r.use('/portale', portaleRoutes);
  r.use('/strutture', struttureRoutes);
  r.use('/calendario', calendarioRoutes);
  r.use('/comms', commsRoutes);
  r.use(adminRoutes);   // settings, criticita, backup, audit
  app.use(`/api/${KEY}`, r);

  // Avviso giornaliero sulle criticità delle sedi (come lo scheduler dell'app): solo con modulo LIVE
  registerJob(`${KEY}:avvisi-criticita`, 10, async () => {
    const st = await getModuleState(KEY);
    if (st.mode !== 'LIVE') return { skipped: true, reason: 'modulo non LIVE' };
    return (await runDailyAlert()) || { skipped: true, reason: 'non dovuto' };
  });
}
