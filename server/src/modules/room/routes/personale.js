// Modulo Personale sanitario (gestione): schede Room dei professionisti dell'anagrafica unica, documenti, disponibilità, turni, presenze, rendiconti, bacheca, fabbisogno, statistiche.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse, getSetting, r2, eur, itDate, HttpError } from '../lib/util.js';
import { isGestione, canSeeStruttura, canConfirmPresenze, siteManagerSedi } from '../lib/access.js';
import { sendMail } from '../lib/mailer.js';
import { computePlan, m2t as m2tE } from '../lib/engine.js';
import { joinStruttura, mutateStruttura, loadSedi } from '../lib/strutture.js';
import { personKey, isAttivita, calcolaRendiconto, oreTra, validMese, dow, meseTxt, sediMap, profLite, isoDate, PROFILI, DOC_TIPI, tariffaPerSede, discipline, PROF_COLS, KIND_LABEL, RUOLO_SANITARIO_RE } from '../lib/personale.js';

const r = Router();
const gest = (req, _res, next) => (isGestione(req.user) ? next() : next(forbidden('Riservato alla gestione del personale sanitario')));
// Chi decide chi è pianificabile: gestione del personale sanitario e pianificatori (non chi è in sola consultazione)
const plan = (req, _res, next) => (isGestione(req.user) || req.user?.role === 'PLANNER' ? next() : next(forbidden('Profilo in sola consultazione')));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'orario hh:mm');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data aaaa-mm-gg');
const mese = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mese aaaa-mm');
const ordered = (d) => d.ora_a > d.ora_da;

// ---------- Professionisti ----------
// Le persone vivono in public.people (Amministrazione > Persone, Contratti del personale): qui si legge l'elenco (vista professionisti_v,
// TUTTE le persone dell'anagrafica unica, qualunque tipo) e si modifica solo la scheda Room (person_ext: tipo, profilo, compenso, contratto,
// assicurazione, competenze, sedi abilitate, recapiti integrativi) e il flag di esclusione dalla pianificazione (planning_excluded).
const siteRef = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive().nullable());
const extSchema = z.object({
  tipo: z.enum(['medico', 'sanitario']), profilo: z.string().trim().max(60).optional().nullable(), dati: z.record(z.any()).optional(),
});
// Riferimenti alle sedi dentro la scheda (sedi abilitate, eccezioni di tariffa): id di public.sites come numeri
function normDati(dati) {
  const d = { ...(dati || {}) };
  const num = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  d.sediAbilitate = [...new Set((d.sediAbilitate || []).map(num).filter(Boolean))];
  if (d.compenso) d.compenso = { ...d.compenso, eccezioniSede: (d.compenso.eccezioniSede || []).map((e) => ({ ...e, sedeId: num(e.sedeId) })).filter((e) => e.sedeId) };
  // i dati anagrafici dell'anagrafica unica non si duplicano nella scheda Room
  if (d.anagrafica) { d.anagrafica = { ...d.anagrafica }; for (const k of ['cognome', 'nome', 'codiceFiscale', 'email', 'telefono', 'cellulare', 'sesso', 'dataNascita', 'luogoNascita', 'partitaIva', 'indirizzo', 'cap', 'citta', 'provincia']) delete d.anagrafica[k]; }
  return d;
}
const SUITE_USER = `(SELECT json_build_object('id', u.id, 'email', u.email, 'status', u.status, 'last_login_at', u.last_login_at, 'profile', g.profile, 'proposed', g.proposed)
    FROM public.users u LEFT JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'room' WHERE u.person_id = p.id ORDER BY u.id LIMIT 1) AS suite_user`;

// ?pianificabili=1 restituisce solo chi può essere scelto in turni, disponibilità, presenze e calendario (attivo e non escluso)
r.get('/professionisti', ah(async (req, res) => {
  const soloPian = ['1', 'true'].includes(String(req.query.pianificabili || ''));
  const rows = await many(`SELECT ${PROF_COLS}, ${SUITE_USER} FROM professionisti_v p WHERE ($1::bool IS FALSE OR p.pianificabile) ORDER BY lower(p.nome)`, [soloPian]);
  if (!isGestione(req.user)) return res.json(rows.filter((p) => p.attivo).map(profLite));
  const docs = await many('SELECT person_id, count(*)::int AS n, min(scadenza) FILTER (WHERE scadenza IS NOT NULL) AS prossima_scadenza FROM professionista_docs GROUP BY person_id');
  const dm = Object.fromEntries(docs.map((d) => [d.person_id, d]));
  res.json(rows.map((p) => ({ ...profLite(p), dati: p.dati, userId: p.suite_user?.id || null, userActive: p.suite_user ? p.suite_user.status === 'ACTIVE' : null, userProfile: p.suite_user?.profile || null, lastLoginAt: p.suite_user?.last_login_at || null,
    nDocs: dm[p.id]?.n || 0, prossimaScadenza: dm[p.id]?.prossima_scadenza || null, updatedAt: p.updated_at })));
}));
// Opzioni dei filtri della pagina Professionisti: tipi di persona, sedi TD (non i punti dei clienti service), ruoli del catalogo, discipline in uso
r.get('/professionisti/opzioni', ah(async (_req, res) => {
  const sedi = await many(`SELECT id, name, short_name, code FROM public.sites WHERE active AND kind <> 'SERVICE' ORDER BY lower(name)`);
  const ruoli = await many(`SELECT id, name FROM public.job_roles WHERE active ORDER BY lower(name)`);
  const disc = await many(`SELECT DISTINCT discipline AS d FROM public.people WHERE coalesce(discipline, '') <> '' ORDER BY 1`);
  res.json({ profili: PROFILI, docTipi: DOC_TIPI, kinds: Object.entries(KIND_LABEL).map(([k, label]) => ({ k, label })), sedi, ruoli, discipline: disc.map((x) => x.d) });
}));
// Esclusione dalla pianificazione di una persona (e rientro): la riga person_ext nasce anche senza scheda Room, solo per il flag
r.put('/professionisti/:id/pianificazione', plan, ah(async (req, res) => {
  const d = parse(z.object({ excluded: z.boolean() }), req.body);
  const p = await one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.id=$1`, [req.params.id]); if (!p) throw notFound('Persona non trovata nell\'anagrafica');
  await q(`INSERT INTO person_ext (person_id, planning_excluded, updated_by) VALUES ($1,$2,$3)
    ON CONFLICT (person_id) DO UPDATE SET planning_excluded=EXCLUDED.planning_excluded, updated_at=now(), updated_by=EXCLUDED.updated_by`, [p.id, d.excluded, req.user.id]);
  if (!d.excluded) await q(`DELETE FROM person_ext WHERE person_id=$1 AND tipo IS NULL AND dati = '{}'::jsonb`, [p.id]);   // riga nata solo per il flag
  await audit(req, d.excluded ? 'PROF_ESCLUDI' : 'PROF_INCLUDI', 'professionista', p.id, { nome: p.nome });
  res.json({ ok: true, planningExcluded: d.excluded });
}));
// Azioni di massa: "Escludi tutti i non sanitari" (kind DIPENDENTE/ESTERNO/DIRIGENTE senza disciplina, senza ruolo sanitario e senza scheda
// Room compilata; MEDICO, SANITARIO e LP restano dentro) e "Includi tutti" (riporta dentro chiunque).
r.post('/professionisti/pianificazione/massa', plan, ah(async (req, res) => {
  const d = parse(z.object({ azione: z.enum(['ESCLUDI_NON_SANITARI', 'INCLUDI_TUTTI']) }), req.body);
  let n = 0;
  if (d.azione === 'ESCLUDI_NON_SANITARI') {
    const rows = await many(`SELECT p.id FROM professionisti_v p WHERE p.attivo AND NOT p.planning_excluded AND NOT p.in_room
      AND p.kind IN ('DIPENDENTE', 'ESTERNO', 'DIRIGENTE') AND coalesce(p.discipline, '') = '' AND NOT coalesce(p.role_name, '') ~* $1`, [RUOLO_SANITARIO_RE]);
    for (const { id } of rows) await q(`INSERT INTO person_ext (person_id, planning_excluded, updated_by) VALUES ($1,TRUE,$2) ON CONFLICT (person_id) DO UPDATE SET planning_excluded=TRUE, updated_at=now(), updated_by=EXCLUDED.updated_by`, [id, req.user.id]);
    n = rows.length;
  } else {
    n = (await q(`UPDATE person_ext SET planning_excluded=FALSE, updated_at=now(), updated_by=$1 WHERE planning_excluded`, [req.user.id])).rowCount;
    await q(`DELETE FROM person_ext WHERE tipo IS NULL AND NOT planning_excluded AND dati = '{}'::jsonb`);   // righe nate solo per il flag
  }
  await audit(req, 'PROF_PIANIFICAZIONE_MASSA', 'professionista', null, { azione: d.azione, n });
  res.json({ ok: true, n });
}));
r.get('/professionisti/:id', gest, ah(async (req, res) => {
  const p = await one(`SELECT ${PROF_COLS}, ${SUITE_USER} FROM professionisti_v p WHERE p.id=$1`, [req.params.id]);
  if (!p) throw notFound('Persona non trovata nell\'anagrafica unica');
  const docs = await many('SELECT id, tipo, nome, mime, size, scadenza, note, created_at FROM professionista_docs WHERE person_id=$1 ORDER BY created_at DESC', [p.id]);
  // Presenza nelle schede di sede (stessa persona per chiave del nome)
  const key = personKey(p.nome);
  const sedi = (await loadSedi()).filter((x) => (x.lite.personale || []).some((y) => personKey(y.nome) === key)).map((x) => ({ id: x.row.id, label: x.lite.denominazione }));
  res.json({ ...p, anagrafica: p.dati?.anagrafica || {}, discipline: discipline(p), docs, sediPresente: sedi, suiteUser: p.suite_user, suite_user: undefined });
}));
// Le persone si creano in Amministrazione > Persone o in Contratti del personale
r.post('/professionisti', gest, ah(async () => { throw new HttpError(405, 'Le persone si creano in Amministrazione > Persone (o in Contratti del personale): qui si compila solo la scheda Room'); }));
r.put('/professionisti/:id', gest, ah(async (req, res) => {
  const d = parse(extSchema, req.body);
  const p = await one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.id=$1`, [req.params.id]); if (!p) throw notFound();
  const dati = normDati(d.dati);
  const profilo = d.profilo || (d.tipo === 'medico' ? 'Medico' : null);
  await q(`INSERT INTO person_ext (person_id, tipo, profilo, dati, updated_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (person_id) DO UPDATE SET tipo=EXCLUDED.tipo, profilo=EXCLUDED.profilo, dati=EXCLUDED.dati, updated_at=now(), updated_by=EXCLUDED.updated_by`, [p.id, d.tipo, profilo, JSON.stringify(dati), req.user.id]);
  // La stessa persona nelle schede di sede: email (dall'anagrafica unica) e profilo del personale sanitario seguono la scheda
  let sediAggiornate = 0;
  const key = personKey(p.nome);
  for (const s of await loadSedi()) {
    const ok = await mutateStruttura(s.row.id, (data) => {
      let ch = false;
      for (const x of data.personale || []) {
        if (personKey(x.nome) !== key) continue;
        if (p.email && (p.email || '') !== (x.email || '')) { x.email = p.email; ch = true; }
        if (d.tipo === 'sanitario' && profilo && x.profilo !== profilo) { x.profilo = profilo; ch = true; }
      }
      return ch;
    }, req.user, `scheda Room di ${p.nome}`);
    if (ok) sediAggiornate++;
  }
  await audit(req, 'PROF_UPDATE', 'professionista', p.id, { nome: p.nome, sediAggiornate });
  res.json({ ok: true, sediAggiornate });
}));
// Collega alle schede di sede: per il personale sanitario censito nelle sedi e già presente in public.people crea la scheda Room se manca.
// Non tocca mai chi ha già la scheda. Le persone delle sedi che non esistono nell'anagrafica vengono segnalate (si creano in Amministrazione).
r.post('/professionisti/importa-da-sedi', gest, ah(async (req, res) => {
  const sedi = await loadSedi();
  const people = await many(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.attivo`);
  const byKey = new Map(people.map((x) => [personKey(x.nome), x]));
  const seen = new Map();
  for (const s of sedi) for (const p of s.lite.personale || []) {
    if (!p.nome?.trim() || p.tipo !== 'sanitario' || isAttivita(p.nome)) continue;
    const key = personKey(p.nome);
    if (seen.has(key)) { const x = seen.get(key); if (!x.sedi.includes(s.row.id)) x.sedi.push(s.row.id); continue; }
    seen.set(key, { key, nome: p.nome.trim(), profilo: p.profilo || null, disc: p.discipline || (p.disciplina ? [p.disciplina] : []), attr: p.attrezzature || [], sedi: [s.row.id] });
  }
  let created = 0; const nonCensiti = [];
  for (const x of seen.values()) {
    const ex = byKey.get(x.key);
    if (!ex) { nonCensiti.push(x.nome); continue; }
    if (ex.in_room) continue;
    const dati = { professionale: { discipline: x.disc, attrezzature: x.attr }, sediAbilitate: x.sedi, compenso: { tipo: 'ORARIO' } };
    await q('INSERT INTO person_ext (person_id, tipo, profilo, dati, updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (person_id) DO UPDATE SET tipo=EXCLUDED.tipo, profilo=EXCLUDED.profilo, dati=EXCLUDED.dati, updated_at=now(), updated_by=EXCLUDED.updated_by WHERE person_ext.tipo IS NULL', [ex.id, 'sanitario', x.profilo || ex.profilo, JSON.stringify(dati), req.user.id]);
    created++;
  }
  await audit(req, 'PROF_IMPORT', 'professionista', null, { created, nonCensiti: nonCensiti.length });
  res.json({ created, riattivati: 0, totale: seen.size, nonCensiti });
}));
// Rimozione della scheda Room di una persona: solo se non ha dati collegati. La persona resta nell'anagrafica unica.
r.delete('/professionisti/:id', gest, ah(async (req, res) => {
  const p = await one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.id=$1`, [req.params.id]); if (!p) throw notFound();
  const dip = await one(`SELECT (SELECT count(*) FROM presenze WHERE prof_id=$1) AS presenze, (SELECT count(*) FROM turni WHERE prof_id=$1) AS turni, (SELECT count(*) FROM rendiconti WHERE prof_id=$1) AS rendiconti, (SELECT count(*) FROM candidature WHERE prof_id=$1) AS candidature`, [p.id]);
  const n = Object.values(dip).reduce((a, v) => a + Number(v), 0);
  if (n > 0) throw bad(`La persona ha dati collegati (${Object.entries(dip).filter(([, v]) => Number(v)).map(([k, v]) => `${v} ${k}`).join(', ')}): la scheda Room non si può rimuovere; lo stato della persona si cambia in Amministrazione > Persone`);
  await tx(async (c) => {
    await c.query('DELETE FROM professionista_docs WHERE person_id=$1', [p.id]); await c.query('DELETE FROM disponibilita WHERE prof_id=$1', [p.id]);
    // se la persona è esclusa dalla pianificazione la riga resta, svuotata, per conservare il flag
    await c.query(`UPDATE person_ext SET tipo=NULL, profilo=NULL, dati='{}'::jsonb, updated_at=now(), updated_by=$2 WHERE person_id=$1 AND planning_excluded`, [p.id, req.user.id]);
    await c.query('DELETE FROM person_ext WHERE person_id=$1 AND NOT planning_excluded', [p.id]);
  });
  await audit(req, 'PROF_DELETE', 'professionista', p.id, { nome: p.nome }); res.json({ ok: true });
}));

// Accesso al portale: l'utente Suite collegato alla persona (public.users.person_id) con il profilo Professionista sul modulo Room Planning.
// Utenti, grant e collegamento alla persona si gestiscono in Amministrazione > Utenti: qui si legge solo lo stato.
r.get('/professionisti/:id/accesso', gest, ah(async (req, res) => {
  const p = await one(`SELECT ${PROF_COLS}, ${SUITE_USER} FROM professionisti_v p WHERE p.id=$1`, [req.params.id]); if (!p) throw notFound();
  const su = p.suite_user;
  const byEmail = !su && p.email ? await one(`SELECT u.id, u.email, u.status, g.profile FROM public.users u LEFT JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'room' WHERE lower(u.email) = lower($1) AND u.person_id IS NULL`, [p.email]) : null;
  const linked = Boolean(su && su.profile === 'PROF' && !su.proposed && su.status === 'ACTIVE');
  const hint = linked ? `Accesso attivo: ${su.email} entra nella Suite e vede il proprio portale.`
    : su ? (su.profile ? `L'utente ${su.email} ha il profilo ${su.profile}${su.proposed ? ' (proposto, da confermare)' : ''} su Room Planning: per il portale serve il profilo Professionista attivo (Amministrazione > Utenti).` : `L'utente ${su.email} è collegato alla persona ma non ha un profilo su Room Planning: assegnare "Professionista" da Amministrazione > Utenti.`)
      : byEmail ? `Esiste l'utente ${byEmail.email} con la stessa email ma non è collegato a questa persona: collegarlo da Amministrazione > Utenti (campo Persona).`
        : p.email ? `Nessun utente Suite collegato: crearlo da Amministrazione > Utenti con email ${p.email}, persona collegata e profilo Professionista su Room Planning.` : 'La persona non ha email nell\'anagrafica: inserirla in Amministrazione > Persone, poi creare l\'utente.';
  res.json({ linked, suiteUser: su, byEmail, hint });
}));

// Documenti del professionista (binari in tabella, max 8 MB ciascuno)
r.get('/professionisti/:id/docs/:docId', gest, ah(async (req, res) => {
  const d = await one('SELECT * FROM professionista_docs WHERE id=$1 AND person_id=$2', [req.params.docId, req.params.id]); if (!d) throw notFound();
  res.setHeader('Content-Type', d.mime); res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.nome)}"`);
  res.send(Buffer.from(d.data, 'base64'));
}));
r.post('/professionisti/:id/docs', gest, ah(async (req, res) => {
  const d = parse(z.object({ tipo: z.enum(DOC_TIPI), nome: z.string().min(1).max(200), mime: z.string().min(3).max(100), base64: z.string().min(4), scadenza: date.optional().nullable().or(z.literal('')), note: z.string().max(500).optional().nullable() }), req.body);
  const size = Math.floor(d.base64.length * 3 / 4); if (size > 8 * 1024 * 1024) throw bad('File troppo grande (max 8 MB)');
  if (!(await one('SELECT id FROM professionisti_v WHERE id=$1', [req.params.id]))) throw notFound();
  const row = await one('INSERT INTO professionista_docs (person_id, tipo, nome, mime, size, scadenza, note, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [req.params.id, d.tipo, d.nome, d.mime, size, d.scadenza || null, d.note || null, d.base64, req.user.id]);
  await audit(req, 'PROF_DOC_ADD', 'professionista', req.params.id, { tipo: d.tipo, nome: d.nome });
  res.status(201).json({ id: row.id });
}));
r.delete('/professionisti/:id/docs/:docId', gest, ah(async (req, res) => {
  await q('DELETE FROM professionista_docs WHERE id=$1 AND person_id=$2', [req.params.docId, req.params.id]);
  await audit(req, 'PROF_DOC_DEL', 'professionista', req.params.id, { docId: req.params.docId }); res.json({ ok: true });
}));

// ---------- Disponibilità (gestione: tutte) ----------
export const dispSchema = z.object({
  kind: z.enum(['SETTIMANALE', 'DATA']), giorno: z.number().int().min(0).max(6).optional().nullable(), data: date.optional().nullable(),
  valid_dal: date.optional().nullable().or(z.literal('')), valid_al: date.optional().nullable().or(z.literal('')), ora_da: time, ora_a: time,
  sedi: z.array(z.union([z.number().int(), z.string()])).optional(), nota: z.string().max(300).optional().nullable(),
}).refine(ordered, { message: "L'ora di fine deve seguire quella di inizio" }).refine((d) => (d.kind === 'SETTIMANALE' ? d.giorno != null : !!d.data), { message: 'Indica il giorno della settimana o la data' });
export async function saveDisp(profId, d, id = null) {
  const sedi = [...new Set((d.sedi || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];   // id di public.sites; JSONB (vedi migrazione 004)
  const vals = [profId, d.kind, d.kind === 'SETTIMANALE' ? d.giorno : null, d.kind === 'DATA' ? d.data : null, d.valid_dal || null, d.valid_al || null, d.ora_da, d.ora_a, JSON.stringify(sedi), d.nota || null];
  if (id) { await q('UPDATE disponibilita SET kind=$2, giorno=$3, data=$4, valid_dal=$5, valid_al=$6, ora_da=$7, ora_a=$8, sedi=$9, nota=$10, updated_at=now() WHERE id=$11 AND prof_id=$1', [...vals, id]); return id; }
  return (await one('INSERT INTO disponibilita (prof_id, kind, giorno, data, valid_dal, valid_al, ora_da, ora_a, sedi, nota) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', vals)).id;
}
r.get('/disponibilita', gest, ah(async (req, res) => {
  const pid = req.query.prof_id ? Number(req.query.prof_id) : null;
  res.json(await many(`SELECT d.*, p.nome, p.tipo, p.profilo FROM disponibilita d JOIN professionisti_v p ON p.id=d.prof_id WHERE ($1::int IS NULL OR d.prof_id=$1) AND p.attivo AND ($1::int IS NOT NULL OR NOT p.planning_excluded) ORDER BY p.nome, d.kind, d.giorno, d.data, d.ora_da`, [pid]));
}));
r.post('/disponibilita', gest, ah(async (req, res) => {
  const { prof_id, ...rest } = req.body || {}; const d = parse(dispSchema, rest);
  const pr = await one('SELECT id, planning_excluded FROM professionisti_v WHERE id=$1', [prof_id]); if (!pr) throw bad('Professionista non valido');
  if (pr.planning_excluded) throw bad('La persona è esclusa dalla pianificazione: riportala tra i pianificabili prima di registrare disponibilità');
  res.status(201).json({ id: await saveDisp(Number(prof_id), d) });
}));
r.put('/disponibilita/:id', gest, ah(async (req, res) => {
  const row = await one('SELECT prof_id FROM disponibilita WHERE id=$1', [req.params.id]); if (!row) throw notFound();
  const d = parse(dispSchema, req.body); await saveDisp(row.prof_id, d, Number(req.params.id)); res.json({ ok: true });
}));
r.delete('/disponibilita/:id', gest, ah(async (req, res) => { await q('DELETE FROM disponibilita WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

/** Disponibilità attive in una data e fascia (prof disponibili): ritorna [{prof_id, ora_da, ora_a, sedi}] */
export async function dispOn(iso, sedeId = null) {
  const g = dow(iso);
  return many(`SELECT d.*, p.nome, p.tipo, p.profilo FROM disponibilita d JOIN professionisti_v p ON p.id=d.prof_id WHERE p.pianificabile AND (
      (d.kind='DATA' AND d.data=$1::date) OR (d.kind='SETTIMANALE' AND d.giorno=$2 AND (d.valid_dal IS NULL OR d.valid_dal<=$1::date) AND (d.valid_al IS NULL OR d.valid_al>=$1::date)))
    AND ($3::int IS NULL OR jsonb_array_length(d.sedi)=0 OR d.sedi @> to_jsonb($3::int))`, [iso, g, sedeId == null ? null : Number(sedeId)]);
}

// ---------- Turni ----------
const turnoSchema = z.object({ sede_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive()), data: date, ora_da: time, ora_a: time, prof_id: z.number().int().optional().nullable(), profilo: z.string().max(60).optional().nullable(), attivita: z.string().max(120).optional().nullable(), room_id: z.string().max(40).optional().nullable(), nota: z.string().max(300).optional().nullable() }).refine(ordered, { message: "L'ora di fine deve seguire quella di inizio" });
async function meseStato(m) { return (await one('SELECT * FROM turni_mesi WHERE mese=$1', [m])) || { mese: m, stato: 'BOZZA' }; }
r.get('/turni/mesi', ah(async (_req, res) => res.json(await many('SELECT t.*, u.full_name AS confermato_da_nome FROM turni_mesi t LEFT JOIN users u ON u.id=t.confermato_da ORDER BY mese DESC'))));
r.get('/turni', ah(async (req, res) => {
  const m = String(req.query.mese || ''); if (!validMese(m)) throw bad('mese richiesto (aaaa-mm)');
  const st = await meseStato(m);
  if (!isGestione(req.user) && st.stato !== 'CONFERMATO') return res.json({ mese: st, turni: [] });
  const sede = req.query.sede_id ? Number(req.query.sede_id) : null;
  let turni = await many(`SELECT t.*, p.nome AS prof_nome, p.profilo AS prof_profilo, p.tipo AS prof_tipo FROM turni t LEFT JOIN professionisti_v p ON p.id=t.prof_id WHERE t.mese=$1 AND ($2::int IS NULL OR t.sede_id=$2) ORDER BY t.data, t.sede_id, t.ora_da`, [m, sede]);
  if (!isGestione(req.user)) turni = turni.filter((t) => canSeeStruttura(req.user, t.sede_id));
  res.json({ mese: st, turni });
}));
r.post('/turni', gest, ah(async (req, res) => {
  const d = parse(turnoSchema, req.body);
  if (d.prof_id) await checkSovrapposizione(d.prof_id, d.data, d.ora_da, d.ora_a, null);
  const row = await one('INSERT INTO turni (mese, sede_id, data, ora_da, ora_a, prof_id, profilo, attivita, room_id, nota, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [d.data.slice(0, 7), d.sede_id, d.data, d.ora_da, d.ora_a, d.prof_id || null, d.profilo || null, d.attivita || null, d.room_id || null, d.nota || null, req.user.id]);
  res.status(201).json({ id: row.id });
}));
r.put('/turni/:id', gest, ah(async (req, res) => {
  const d = parse(turnoSchema, req.body);
  if (d.prof_id) await checkSovrapposizione(d.prof_id, d.data, d.ora_da, d.ora_a, Number(req.params.id));
  await q('UPDATE turni SET mese=$2, sede_id=$3, data=$4, ora_da=$5, ora_a=$6, prof_id=$7, profilo=$8, attivita=$9, room_id=$10, nota=$11, updated_at=now() WHERE id=$1',
    [req.params.id, d.data.slice(0, 7), d.sede_id, d.data, d.ora_da, d.ora_a, d.prof_id || null, d.profilo || null, d.attivita || null, d.room_id || null, d.nota || null]);
  if (d.prof_id) await q("UPDATE posizioni SET stato='ASSEGNATA', updated_at=now() WHERE turno_id=$1 AND stato='APERTA'", [req.params.id]);
  res.json({ ok: true });
}));
r.delete('/turni/:id', gest, ah(async (req, res) => { await q('DELETE FROM turni WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
async function checkSovrapposizione(profId, data, da, a, excludeId) {
  const pr = await one('SELECT nome, planning_excluded FROM professionisti_v WHERE id=$1', [profId]);
  if (!pr) throw bad('Persona non trovata nell\'anagrafica');
  if (pr.planning_excluded) throw bad(`${pr.nome} è esclusa dalla pianificazione: riportala tra i pianificabili dalla pagina Professionisti`);
  const rows = await many('SELECT id, ora_da, ora_a, sede_id FROM turni WHERE prof_id=$1 AND data=$2 AND ($3::int IS NULL OR id<>$3)', [profId, data, excludeId]);
  const o = rows.find((t) => t.ora_da < a && t.ora_a > da);
  if (o) { const sm = await sediMap(); throw bad(`Il professionista ha già un turno ${o.ora_da}–${o.ora_a} in quella data (${sm[o.sede_id] || 'sede ' + o.sede_id})`); }
}
r.post('/turni/mesi/:mese/conferma', gest, ah(async (req, res) => {
  const m = req.params.mese; if (!validMese(m)) throw bad('mese non valido');
  await q(`INSERT INTO turni_mesi (mese, stato, confermato_da, confermato_at, nota) VALUES ($1,'CONFERMATO',$2,now(),$3) ON CONFLICT (mese) DO UPDATE SET stato='CONFERMATO', confermato_da=$2, confermato_at=now(), nota=$3`, [m, req.user.id, req.body?.nota || null]);
  await audit(req, 'TURNI_CONFERMA', 'turni_mesi', m);
  // Avviso ai professionisti con turni nel mese (se email configurata)
  const profs = await many(`SELECT DISTINCT p.id, p.nome, p.email FROM turni t JOIN professionisti_v p ON p.id=t.prof_id WHERE t.mese=$1 AND p.email IS NOT NULL AND p.attivo`, [m]);
  let notified = 0;
  if (req.body?.notifica !== false) for (const p of profs) {
    const mine = await many('SELECT t.data, t.ora_da, t.ora_a, t.sede_id, t.attivita FROM turni t WHERE t.mese=$1 AND t.prof_id=$2 ORDER BY t.data, t.ora_da', [m, p.id]);
    const sm = await sediMap();
    const rr = await sendMail({ kind: 'TURNI_MESE', refKey: `TURNI:${m}:${p.id}:${Date.now()}`, to: p.email, subject: `Turni di ${meseTxt(m)} confermati · Toscana Diagnostica`, title: `Turni di ${meseTxt(m)}`,
      body: `Gentile ${p.nome},\n\ni turni di ${meseTxt(m)} sono stati confermati. I tuoi:\n\n${mine.map((t) => `${itDate(isoDate(t.data))} ${t.ora_da}–${t.ora_a} · ${sm[t.sede_id] || t.sede_id}${t.attivita ? ' · ' + t.attivita : ''}`).join('\n')}\n\nLi trovi sempre aggiornati nel portale Room Planning.`, sentBy: req.user.id });
    if (rr.status === 'INVIATA') notified++;
  }
  res.json({ ok: true, professionisti: profs.length, notificati: notified });
}));
r.post('/turni/mesi/:mese/riapri', gest, ah(async (req, res) => {
  await q(`INSERT INTO turni_mesi (mese, stato) VALUES ($1,'BOZZA') ON CONFLICT (mese) DO UPDATE SET stato='BOZZA', confermato_da=NULL, confermato_at=NULL`, [req.params.mese]);
  await audit(req, 'TURNI_RIAPRI', 'turni_mesi', req.params.mese); res.json({ ok: true });
}));
// Genera i turni del mese dalla pianificazione delle sedi (settimana-tipo applicata ai giorni del mese)
r.post('/turni/genera', gest, ah(async (req, res) => {
  const d = parse(z.object({ mese, sede_id: siteRef.optional(), tipo: z.enum(['tutti', 'medici', 'sanitari']).default('tutti'), sovrascrivi: z.boolean().default(false) }), req.body);
  const sedi = (await loadSedi({ ids: d.sede_id ? [d.sede_id] : null })).map((x) => ({ id: x.row.id, lite: x.lite }));
  const profs = await many('SELECT id, nome, tipo FROM professionisti_v WHERE pianificabile');
  const byKey = Object.fromEntries(profs.map((p) => [personKey(p.nome), p]));
  const [y, mm] = d.mese.split('-').map(Number); const days = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  const chiusure = await many("SELECT sede_id, dal, al FROM eventi WHERE kind='CHIUSURA'");
  let created = 0, skipped = 0, nonCensiti = new Set();
  for (const s of sedi) {
    const str = joinStruttura(s.lite, {}); let plan; try { plan = computePlan(str); } catch { continue; }
    const byId = Object.fromEntries((str.personale || []).map((p) => [p.id, p]));
    if (d.sovrascrivi) await q("DELETE FROM turni WHERE mese=$1 AND sede_id=$2 AND nota='generato dalla pianificazione' AND id NOT IN (SELECT turno_id FROM presenze WHERE turno_id IS NOT NULL)", [d.mese, s.id]);
    for (let day = 1; day <= days; day++) {
      const iso = `${d.mese}-${String(day).padStart(2, '0')}`; const g = dow(iso);
      if (chiusure.some((c) => c.sede_id === s.id && isoDate(c.dal) <= iso && isoDate(c.al) >= iso)) continue;
      const items = [];
      for (const a of plan.assigns.filter((x) => x.d === g)) {
        const med = byId[a.medId]; if (med && d.tipo !== 'sanitari' && !isAttivita(med.nome)) items.push({ persona: med, s: a.s, e: a.e, room: a.roomId, att: 'Ambulatorio ' + (byId[a.roomId]?.nome || '') });
        const san = a.sanId ? byId[a.sanId] : null; if (san && san.tipo === 'sanitario' && d.tipo !== 'medici') items.push({ persona: san, s: a.s, e: a.e, room: a.roomId, att: `Supporto ${med?.nome || ''}` });
      }
      // accorpa per persona le fasce contigue/sovrapposte
      const per = new Map();
      for (const it of items) { const k = personKey(it.persona.nome); (per.get(k) || per.set(k, []).get(k)).push(it); }
      for (const [k, list] of per) {
        const p = byKey[k]; if (!p) { nonCensiti.add(list[0].persona.nome); continue; }
        list.sort((a, b) => a.s - b.s); const merged = [];
        for (const it of list) { const last = merged[merged.length - 1]; if (last && it.s <= last.e) { last.e = Math.max(last.e, it.e); if (!last.att.includes(it.att)) last.att += ', ' + it.att; } else merged.push({ ...it }); }
        for (const mrg of merged) {
          const da = m2tE(mrg.s), a = m2tE(mrg.e);
          if (await one('SELECT id FROM turni WHERE sede_id=$1 AND data=$2 AND prof_id=$3 AND ora_da<$5 AND ora_a>$4', [s.id, iso, p.id, da, a])) { skipped++; continue; }
          await q("INSERT INTO turni (mese, sede_id, data, ora_da, ora_a, prof_id, attivita, room_id, nota, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'generato dalla pianificazione',$9)", [d.mese, s.id, iso, da, a, p.id, mrg.att.slice(0, 120), mrg.room, req.user.id]); created++;
        }
      }
    }
  }
  await audit(req, 'TURNI_GENERA', 'turni_mesi', d.mese, { created, skipped });
  res.json({ created, skipped, nonCensiti: [...nonCensiti] });
}));

// ---------- Presenze ----------
r.get('/presenze/sedi-gestite', ah(async (req, res) => {
  const sm = await sediMap();
  const all = (await loadSedi()).map((x) => ({ id: x.row.id, label: sm[x.row.id] || x.lite.denominazione }));
  const ids = isGestione(req.user) ? all.map((s) => s.id) : await siteManagerSedi(req.user);
  res.json(all.filter((s) => ids.includes(s.id)).sort((a, b) => a.label.localeCompare(b.label, 'it')));
}));
// Giornata di una sede: turni previsti, presenze già confermate, professionisti abbinabili per presenze extra
r.get('/presenze/giorno', ah(async (req, res) => {
  const sede_id = Number(req.query.sede_id), data = req.query.data; if (!sede_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw bad('sede_id e data richiesti');
  if (!(await canConfirmPresenze(req.user, sede_id))) throw forbidden('Non sei il gestore di questa sede');
  const turni = await many('SELECT t.*, p.nome AS prof_nome, p.profilo AS prof_profilo FROM turni t LEFT JOIN professionisti_v p ON p.id=t.prof_id WHERE t.sede_id=$1 AND t.data=$2 ORDER BY t.ora_da', [sede_id, data]);
  const presenze = await many('SELECT pr.*, p.nome AS prof_nome, p.profilo AS prof_profilo, u.full_name AS confermato_da_nome FROM presenze pr JOIN professionisti_v p ON p.id=pr.prof_id LEFT JOIN users u ON u.id=pr.confermato_da WHERE pr.sede_id=$1 AND pr.data=$2 ORDER BY pr.ora_da', [sede_id, data]);
  const profs = await many('SELECT id, nome, tipo, profilo FROM professionisti_v WHERE pianificabile ORDER BY in_room DESC, lower(nome)');
  // dalla pianificazione (settimana-tipo) per il giorno, utile se i turni non sono stati generati
  let pianificati = [];
  const s = (await loadSedi({ ids: [sede_id] }))[0];
  if (s) { try { const str = joinStruttura(s.lite, {}); const plan = computePlan(str); const byId = Object.fromEntries((str.personale || []).map((p) => [p.id, p])); const g = dow(String(data));
    const byKey = Object.fromEntries(profs.map((p) => [personKey(p.nome), p]));
    for (const a of plan.assigns.filter((x) => x.d === g)) { const med = byId[a.medId]; const san = a.sanId ? byId[a.sanId] : null;
      for (const per of [med, san]) if (per && !isAttivita(per.nome)) { const pr = byKey[personKey(per.nome)]; pianificati.push({ nome: per.nome, prof_id: pr?.id || null, ora_da: m2tE(a.s), ora_a: m2tE(a.e), attivita: per === med ? 'Ambulatorio ' + (byId[a.roomId]?.nome || '') : `Supporto ${med?.nome || ''}` }); } }
  } catch { /* */ } }
  res.json({ turni, presenze, professionisti: profs, pianificati, locked: presenze.some((p) => p.rendiconto_id) });
}));
r.post('/presenze/conferma', ah(async (req, res) => {
  const d = parse(z.object({ sede_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive()), data: date, items: z.array(z.object({ id: z.number().int().optional().nullable(), prof_id: z.number().int(), ora_da: time, ora_a: time, stato: z.enum(['CONFERMATA', 'ASSENTE']).default('CONFERMATA'), turno_id: z.number().int().optional().nullable(), origine: z.enum(['TURNO', 'PIANIFICAZIONE', 'EXTRA']).default('TURNO'), attivita: z.string().max(120).optional().nullable(), nota: z.string().max(300).optional().nullable() }).refine(ordered, { message: "L'ora di fine deve seguire quella di inizio" })).max(200) }), req.body);
  if (!(await canConfirmPresenze(req.user, d.sede_id))) throw forbidden('Non sei il gestore di questa sede');
  const ids = [];
  await tx(async (c) => {
    for (const it of d.items) {
      if (it.id) {
        const cur = (await c.query('SELECT rendiconto_id FROM presenze WHERE id=$1 AND sede_id=$2 AND data=$3', [it.id, d.sede_id, d.data])).rows[0];
        if (!cur) continue; if (cur.rendiconto_id) throw bad('Presenza già inclusa in un rendiconto: non modificabile');
        await c.query('UPDATE presenze SET prof_id=$2, ora_da=$3, ora_a=$4, stato=$5, attivita=$6, nota=$7, confermato_da=$8, confermato_at=now() WHERE id=$1', [it.id, it.prof_id, it.ora_da, it.ora_a, it.stato, it.attivita || null, it.nota || null, req.user.id]); ids.push(it.id);
      } else {
        const dup = (await c.query('SELECT id FROM presenze WHERE prof_id=$1 AND sede_id=$2 AND data=$3 AND ora_da<$5 AND ora_a>$4', [it.prof_id, d.sede_id, d.data, it.ora_da, it.ora_a])).rows[0];
        if (dup) throw bad('Presenza sovrapposta a una già registrata per lo stesso professionista');
        const row = (await c.query('INSERT INTO presenze (prof_id, sede_id, data, ora_da, ora_a, origine, turno_id, stato, attivita, nota, confermato_da) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id', [it.prof_id, d.sede_id, d.data, it.ora_da, it.ora_a, it.origine, it.turno_id || null, it.stato, it.attivita || null, it.nota || null, req.user.id])).rows[0]; ids.push(row.id);
      }
    }
  });
  await audit(req, 'PRESENZE_CONFERMA', 'presenze', `${d.sede_id}:${d.data}`, { n: ids.length });
  res.json({ ids });
}));
r.delete('/presenze/:id', ah(async (req, res) => {
  const p = await one('SELECT * FROM presenze WHERE id=$1', [req.params.id]); if (!p) throw notFound();
  if (!(await canConfirmPresenze(req.user, p.sede_id))) throw forbidden(); if (p.rendiconto_id) throw bad('Presenza già in un rendiconto');
  await q('DELETE FROM presenze WHERE id=$1', [p.id]); res.json({ ok: true });
}));
r.get('/presenze', ah(async (req, res) => {
  const { dal, al, sede_id, prof_id } = req.query;
  const ids = isGestione(req.user) ? null : await siteManagerSedi(req.user);
  if (ids && !ids.length) throw forbidden();
  const rows = await many(`SELECT pr.*, p.nome AS prof_nome, p.profilo AS prof_profilo, u.full_name AS confermato_da_nome FROM presenze pr JOIN professionisti_v p ON p.id=pr.prof_id LEFT JOIN users u ON u.id=pr.confermato_da
    WHERE ($1::date IS NULL OR pr.data>=$1) AND ($2::date IS NULL OR pr.data<=$2) AND ($3::int IS NULL OR pr.sede_id=$3) AND ($4::int IS NULL OR pr.prof_id=$4) ORDER BY pr.data DESC, pr.sede_id, pr.ora_da`, [dal || null, al || null, sede_id ? Number(sede_id) : null, prof_id ? Number(prof_id) : null]);
  res.json(ids ? rows.filter((x) => ids.includes(x.sede_id)) : rows);
}));

// ---------- Rendiconti ----------
async function buildRendiconto(profId, m) {
  const prof = await one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.id=$1`, [profId]); if (!prof) throw notFound();
  const pres = await many("SELECT * FROM presenze WHERE prof_id=$1 AND to_char(data,'YYYY-MM')=$2 AND (rendiconto_id IS NULL OR rendiconto_id = (SELECT id FROM rendiconti WHERE prof_id=$1 AND mese=$2)) ORDER BY data, ora_da", [profId, m]);
  return { prof, pres, calc: calcolaRendiconto(prof, pres, await sediMap()) };
}
r.get('/rendiconti', gest, ah(async (req, res) => {
  const m = req.query.mese || null;
  res.json(await many(`SELECT r.id, r.prof_id, r.mese, r.stato, r.ore, r.importo, r.nota, r.generato_at, r.approvato_at, r.inviato_at, p.nome, p.profilo, p.tipo, p.email, ua.full_name AS approvato_da_nome, (r.dettaglio->'oneri'->>'totaleFattura')::numeric AS totale_fattura
    FROM rendiconti r JOIN professionisti_v p ON p.id=r.prof_id LEFT JOIN users ua ON ua.id=r.approvato_da WHERE ($1::text IS NULL OR r.mese=$1) ORDER BY r.mese DESC, lower(p.nome)`, [m]));
}));
r.get('/rendiconti/anteprima', gest, ah(async (req, res) => {
  const m = String(req.query.mese || ''); if (!validMese(m)) throw bad('mese');
  const profs = await many(`SELECT DISTINCT p.id FROM professionisti_v p WHERE p.attivo AND (p.dati->'compenso'->>'tipo'='FISSO' OR EXISTS (SELECT 1 FROM presenze pr WHERE pr.prof_id=p.id AND to_char(pr.data,'YYYY-MM')=$1 AND pr.stato='CONFERMATA'))`, [m]);
  const esistenti = new Set((await many('SELECT prof_id FROM rendiconti WHERE mese=$1', [m])).map((x) => x.prof_id));
  const out = [];
  for (const { id } of profs) { const b = await buildRendiconto(id, m); out.push({ prof_id: id, nome: b.prof.nome, profilo: b.prof.profilo, tipo: b.calc.tipo, ore: b.calc.ore, importo: b.calc.importo, totaleFattura: b.calc.oneri.totaleFattura, presenze: b.pres.length, esiste: esistenti.has(id), tariffaMancante: b.calc.tipo === 'ORARIO' && b.calc.righe.some((x) => !x.tariffa) }); }
  res.json(out.sort((a, b) => a.nome.localeCompare(b.nome, 'it')));
}));
r.post('/rendiconti/genera', gest, ah(async (req, res) => {
  const d = parse(z.object({ mese, prof_ids: z.array(z.number().int()).optional() }), req.body);
  let ids = d.prof_ids;
  if (!ids) ids = (await many(`SELECT DISTINCT p.id FROM professionisti_v p WHERE p.attivo AND (p.dati->'compenso'->>'tipo'='FISSO' OR EXISTS (SELECT 1 FROM presenze pr WHERE pr.prof_id=p.id AND to_char(pr.data,'YYYY-MM')=$1 AND pr.stato='CONFERMATA'))`, [d.mese])).map((x) => x.id);
  let created = 0, updated = 0;
  for (const id of ids) {
    const ex = await one('SELECT id, stato FROM rendiconti WHERE prof_id=$1 AND mese=$2', [id, d.mese]);
    if (ex && !['BOZZA', 'RESPINTO'].includes(ex.stato)) continue;
    const b = await buildRendiconto(id, d.mese);
    const det = JSON.stringify({ ...b.calc, professionista: { nome: b.prof.nome, profilo: b.prof.profilo, email: b.prof.email, cf: b.prof.tax_code || '', piva: b.prof.dati?.anagrafica?.partitaIva || '' } });
    let rid;
    if (ex) { await q("UPDATE rendiconti SET stato='BOZZA', ore=$2, importo=$3, dettaglio=$4, generato_da=$5, generato_at=now(), approvato_da=NULL, approvato_at=NULL WHERE id=$1", [ex.id, b.calc.ore, b.calc.oneri.imponibile, det, req.user.id]); rid = ex.id; updated++; }
    else { rid = (await one('INSERT INTO rendiconti (prof_id, mese, ore, importo, dettaglio, generato_da) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [id, d.mese, b.calc.ore, b.calc.oneri.imponibile, det, req.user.id])).id; created++; }
    await q("UPDATE presenze SET rendiconto_id=$1 WHERE prof_id=$2 AND to_char(data,'YYYY-MM')=$3", [rid, id, d.mese]);
  }
  await audit(req, 'RENDICONTI_GENERA', 'rendiconti', d.mese, { created, updated });
  res.json({ created, updated });
}));
r.get('/rendiconti/:id', gest, ah(async (req, res) => {
  const x = await one('SELECT r.*, p.nome, p.profilo, p.email, p.tax_code, p.dati AS prof_dati, ug.full_name AS generato_da_nome, ua.full_name AS approvato_da_nome FROM rendiconti r JOIN professionisti_v p ON p.id=r.prof_id LEFT JOIN users ug ON ug.id=r.generato_da LEFT JOIN users ua ON ua.id=r.approvato_da WHERE r.id=$1', [req.params.id]);
  if (!x) throw notFound(); res.json(x);
}));
r.post('/rendiconti/:id/stato', gest, ah(async (req, res) => {
  const d = parse(z.object({ stato: z.enum(['DA_APPROVARE', 'RESPINTO', 'BOZZA']), nota: z.string().max(500).optional().nullable() }), req.body);
  const x = await one('SELECT * FROM rendiconti WHERE id=$1', [req.params.id]); if (!x) throw notFound();
  if (x.stato === 'INVIATO') throw bad('Rendiconto già inviato');
  await q('UPDATE rendiconti SET stato=$2, nota=coalesce($3, nota) WHERE id=$1', [x.id, d.stato, d.nota || null]);
  await audit(req, 'RENDICONTO_STATO', 'rendiconti', x.id, { stato: d.stato }); res.json({ ok: true });
}));
// Approvazione del Responsabile del personale sanitario (o admin): approva e invia il rendiconto al professionista con copia ad amministrazione/backoffice
r.post('/rendiconti/:id/approva', gest, ah(async (req, res) => {
  const d = parse(z.object({ attachment: z.object({ filename: z.string().min(1), base64: z.string().min(10) }).optional(), invia: z.boolean().default(true), nota: z.string().max(500).optional().nullable() }), req.body);
  const x = await one('SELECT r.*, p.nome, p.email FROM rendiconti r JOIN professionisti_v p ON p.id=r.prof_id WHERE r.id=$1', [req.params.id]); if (!x) throw notFound();
  if (x.stato === 'INVIATO') throw bad('Rendiconto già inviato');
  await q("UPDATE rendiconti SET stato='APPROVATO', approvato_da=$2, approvato_at=now(), nota=coalesce($3, nota) WHERE id=$1", [x.id, req.user.id, d.nota || null]);
  await audit(req, 'RENDICONTO_APPROVA', 'rendiconti', x.id);
  let mail = null;
  if (d.invia) {
    if (!x.email) throw bad('Rendiconto approvato, ma la persona non ha un indirizzo email nell\'anagrafica: inserirlo in Amministrazione > Persone e poi usare "Invia"');
    const cc = String(await getSetting('rendiconto_cc', '')).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const det = x.dettaglio || {};
    mail = await sendMail({ kind: 'RENDICONTO', refKey: `REND:${x.id}:${Date.now()}`, to: x.email, cc, subject: `Rendiconto compensi ${meseTxt(x.mese)} · Toscana Diagnostica`, title: `Rendiconto di ${meseTxt(x.mese)}`,
      body: `Gentile ${x.nome},\n\nin allegato il rendiconto delle prestazioni di ${meseTxt(x.mese)}, controllato e approvato dal Responsabile del personale sanitario (${await getSetting('resp_san_nome', '')}).\n\nOre: ${Number(x.ore).toLocaleString('it-IT')} · Imponibile: ${eur(x.importo)}${det.oneri ? ` · Totale fattura indicativo: ${eur(det.oneri.totaleFattura)}` : ''}\n\nTi chiediamo di emettere fattura per l'importo indicato, allegando il rendiconto, all'indirizzo di amministrazione in copia.`, attachment: d.attachment ? { filename: d.attachment.filename, base64: d.attachment.base64 } : undefined, sentBy: req.user.id });
    if (mail.status === 'INVIATA') await q("UPDATE rendiconti SET stato='INVIATO', inviato_at=now(), email_log_id=$2 WHERE id=$1", [x.id, mail.id]);
  }
  res.json({ ok: true, mail: mail?.status || null, error: mail?.error || null });
}));
r.delete('/rendiconti/:id', gest, ah(async (req, res) => {
  const x = await one('SELECT * FROM rendiconti WHERE id=$1', [req.params.id]); if (!x) throw notFound();
  if (x.stato === 'INVIATO') throw bad('Rendiconto già inviato: non eliminabile');
  await q('UPDATE presenze SET rendiconto_id=NULL WHERE rendiconto_id=$1', [x.id]); await q('DELETE FROM rendiconti WHERE id=$1', [x.id]); res.json({ ok: true });
}));

// ---------- Bacheca (posizioni aperte) ----------
const posSchema = z.object({ titolo: z.string().trim().min(3).max(140), sede_id: siteRef.optional(), profilo: z.string().max(60).optional().nullable(), descrizione: z.string().max(2000).optional().nullable(), dal: date.optional().nullable().or(z.literal('')), al: date.optional().nullable().or(z.literal('')), giorni: z.array(z.number().int().min(0).max(6)).optional(), ora_da: time.optional().nullable().or(z.literal('')), ora_a: time.optional().nullable().or(z.literal('')), stato: z.enum(['APERTA', 'ASSEGNATA', 'CHIUSA']).optional(), turno_id: z.number().int().optional().nullable() });
r.get('/posizioni', ah(async (req, res) => {
  const rows = await many(`SELECT po.*, (SELECT count(*)::int FROM candidature c WHERE c.posizione_id=po.id) AS n_candidature, (SELECT count(*)::int FROM candidature c WHERE c.posizione_id=po.id AND c.stato='INVIATA') AS n_nuove FROM posizioni po ORDER BY (po.stato='APERTA') DESC, po.created_at DESC`);
  res.json(isGestione(req.user) ? rows : rows.filter((x) => x.stato === 'APERTA'));
}));
r.post('/posizioni', gest, ah(async (req, res) => {
  const d = parse(posSchema, req.body);
  const row = await one('INSERT INTO posizioni (titolo, sede_id, profilo, descrizione, dal, al, giorni, ora_da, ora_a, turno_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id', [d.titolo, d.sede_id || null, d.profilo || null, d.descrizione || null, d.dal || null, d.al || null, JSON.stringify(d.giorni || []), d.ora_da || null, d.ora_a || null, d.turno_id || null, req.user.id]);
  res.status(201).json({ id: row.id });
}));
r.put('/posizioni/:id', gest, ah(async (req, res) => {
  const d = parse(posSchema, req.body);
  await q('UPDATE posizioni SET titolo=$2, sede_id=$3, profilo=$4, descrizione=$5, dal=$6, al=$7, giorni=$8, ora_da=$9, ora_a=$10, stato=coalesce($11, stato), updated_at=now() WHERE id=$1', [req.params.id, d.titolo, d.sede_id || null, d.profilo || null, d.descrizione || null, d.dal || null, d.al || null, JSON.stringify(d.giorni || []), d.ora_da || null, d.ora_a || null, d.stato || null]);
  res.json({ ok: true });
}));
r.delete('/posizioni/:id', gest, ah(async (req, res) => { await q('DELETE FROM posizioni WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
r.get('/posizioni/:id/candidature', gest, ah(async (req, res) => res.json(await many('SELECT c.*, p.nome, p.profilo, p.email, p.tipo FROM candidature c JOIN professionisti_v p ON p.id=c.prof_id WHERE c.posizione_id=$1 ORDER BY c.created_at', [req.params.id]))));
r.post('/candidature/:id/:esito', gest, ah(async (req, res) => {
  const esito = req.params.esito; if (!['accetta', 'rifiuta'].includes(esito)) throw bad('esito');
  const c = await one('SELECT c.*, po.turno_id, po.id AS pid FROM candidature c JOIN posizioni po ON po.id=c.posizione_id WHERE c.id=$1', [req.params.id]); if (!c) throw notFound();
  await q('UPDATE candidature SET stato=$2 WHERE id=$1', [c.id, esito === 'accetta' ? 'ACCETTATA' : 'RIFIUTATA']);
  if (esito === 'accetta') {
    if (c.turno_id) await q('UPDATE turni SET prof_id=$2, updated_at=now() WHERE id=$1 AND prof_id IS NULL', [c.turno_id, c.prof_id]);
    await q("UPDATE posizioni SET stato='ASSEGNATA', updated_at=now() WHERE id=$1", [c.pid]);
    await q("UPDATE candidature SET stato='RIFIUTATA' WHERE posizione_id=$1 AND id<>$2 AND stato='INVIATA'", [c.pid, c.id]);
  }
  await audit(req, 'CANDIDATURA_' + esito.toUpperCase(), 'candidature', c.id); res.json({ ok: true });
}));

// ---------- Fabbisogno ----------
// Per ogni sede: turni scoperti del mese, sessioni della pianificazione senza supporto sanitario, e per ciascuna
// scopertura i professionisti che hanno offerto disponibilità compatibile.
r.get('/fabbisogno', ah(async (req, res) => {
  if (!isGestione(req.user) && req.user.role === 'PROF') throw forbidden();
  const m = String(req.query.mese || ''); if (!validMese(m)) throw bad('mese');
  const sm = await sediMap();
  const scoperti = await many('SELECT * FROM turni WHERE mese=$1 AND prof_id IS NULL ORDER BY data, sede_id, ora_da', [m]);
  const out = [];
  for (const t of scoperti) {
    const cand = (await dispOn(isoDate(t.data), t.sede_id)).filter((d) => d.ora_da <= t.ora_da && d.ora_a >= t.ora_a && (!t.profilo || (d.profilo || '').toLowerCase() === t.profilo.toLowerCase() || (t.profilo === 'Medico' && d.tipo === 'medico')));
    out.push({ kind: 'TURNO', turnoId: t.id, sedeId: t.sede_id, sede: sm[t.sede_id] || t.sede_id, data: isoDate(t.data), ora_da: t.ora_da, ora_a: t.ora_a, profilo: t.profilo || '', attivita: t.attivita || '', ore: r2(oreTra(t.ora_da, t.ora_a)), candidati: cand.map((c) => ({ prof_id: c.prof_id, nome: c.nome, profilo: c.profilo, ora_da: c.ora_da, ora_a: c.ora_a })) });
  }
  // dalla pianificazione: sessioni mediche senza sanitario di supporto (settimana-tipo)
  const sedi = (await loadSedi()).map((x) => ({ id: x.row.id, lite: x.lite }));
  const pian = [];
  for (const s of sedi) { let plan, str; try { str = joinStruttura(s.lite, {}); plan = computePlan(str); } catch { continue; }
    const byId = Object.fromEntries((str.personale || []).map((p) => [p.id, p]));
    for (const u of plan.unassigned.filter((x) => /sanitario/.test(x.reason))) pian.push({ kind: 'PIANIFICAZIONE', sedeId: s.id, sede: sm[s.id], giorno: u.d, ora_da: m2tE(u.s), ora_a: m2tE(u.e), medico: byId[u.medId]?.nome || '', motivo: u.reason, ore: r2((u.e - u.s) / 60) });
  }
  // riepilogo per profilo
  const perProfilo = {};
  for (const t of out) { const k = t.profilo || 'non specificato'; (perProfilo[k] ||= { profilo: k, turni: 0, ore: 0, conCandidati: 0 }); perProfilo[k].turni++; perProfilo[k].ore = r2(perProfilo[k].ore + t.ore); if (t.candidati.length) perProfilo[k].conCandidati++; }
  // offerta complessiva: ore settimanali di disponibilità per profilo
  const disp = await many('SELECT d.*, p.profilo, p.tipo FROM disponibilita d JOIN professionisti_v p ON p.id=d.prof_id WHERE p.pianificabile AND d.kind=\'SETTIMANALE\'');
  const offerta = {};
  for (const d of disp) { const k = d.profilo || (d.tipo === 'medico' ? 'Medico' : 'altro'); (offerta[k] ||= { profilo: k, oreSettimana: 0, professionisti: new Set() }); offerta[k].oreSettimana = r2(offerta[k].oreSettimana + oreTra(d.ora_da, d.ora_a)); offerta[k].professionisti.add(d.prof_id); }
  res.json({ mese: m, turniScoperti: out, pianificazione: pian, perProfilo: Object.values(perProfilo), offerta: Object.values(offerta).map((o) => ({ ...o, professionisti: o.professionisti.size })) });
}));

// ---------- Statistiche ----------
r.get('/statistiche', gest, ah(async (req, res) => {
  const dal = req.query.dal || `${new Date().getFullYear()}-01-01`, al = req.query.al || new Date().toISOString().slice(0, 10);
  const sm = await sediMap();
  const pres = await many("SELECT pr.*, p.nome, p.profilo, p.tipo, p.dati FROM presenze pr JOIN professionisti_v p ON p.id=pr.prof_id WHERE pr.data BETWEEN $1 AND $2 AND pr.stato='CONFERMATA'", [dal, al]);
  const turni = await many('SELECT t.*, p.profilo, p.tipo FROM turni t LEFT JOIN professionisti_v p ON p.id=t.prof_id WHERE t.data BETWEEN $1 AND $2', [dal, al]);
  const rend = await many('SELECT r.*, p.nome FROM rendiconti r JOIN professionisti_v p ON p.id=r.prof_id WHERE r.mese BETWEEN $1 AND $2', [dal.slice(0, 7), al.slice(0, 7)]);
  const perSede = {}, perProf = {}, perProfilo = {}, perMese = {};
  for (const p of pres) { const h = oreTra(p.ora_da, p.ora_a); const c = r2(h * (p.dati?.compenso?.tipo === 'FISSO' ? 0 : tariffaPerSede(p.dati, p.sede_id)));
    const S = (perSede[p.sede_id] ||= { sedeId: p.sede_id, sede: sm[p.sede_id] || p.sede_id, ore: 0, costo: 0, presenze: 0, professionisti: new Set() }); S.ore = r2(S.ore + h); S.costo = r2(S.costo + c); S.presenze++; S.professionisti.add(p.prof_id);
    const P = (perProf[p.prof_id] ||= { prof_id: p.prof_id, nome: p.nome, profilo: p.profilo, ore: 0, costo: 0, presenze: 0, sedi: new Set() }); P.ore = r2(P.ore + h); P.costo = r2(P.costo + c); P.presenze++; P.sedi.add(p.sede_id);
    const k = p.profilo || (p.tipo === 'medico' ? 'Medico' : 'altro'); const F = (perProfilo[k] ||= { profilo: k, ore: 0, costo: 0, professionisti: new Set() }); F.ore = r2(F.ore + h); F.costo = r2(F.costo + c); F.professionisti.add(p.prof_id);
    const mk = isoDate(p.data).slice(0, 7); const M = (perMese[mk] ||= { mese: mk, ore: 0, costo: 0, oreTurni: 0, turniScoperti: 0 }); M.ore = r2(M.ore + h); M.costo = r2(M.costo + c);
  }
  for (const t of turni) { const mk = isoDate(t.data).slice(0, 7); const M = (perMese[mk] ||= { mese: mk, ore: 0, costo: 0, oreTurni: 0, turniScoperti: 0 }); M.oreTurni = r2(M.oreTurni + oreTra(t.ora_da, t.ora_a)); if (!t.prof_id) M.turniScoperti++; }
  const fix = (o) => Object.values(o).map((x) => ({ ...x, professionisti: x.professionisti ? x.professionisti.size : undefined, sedi: x.sedi ? x.sedi.size : undefined }));
  const oreTurniTot = r2(turni.reduce((a, t) => a + oreTra(t.ora_da, t.ora_a), 0)), orePresTot = r2(pres.reduce((a, p) => a + oreTra(p.ora_da, p.ora_a), 0));
  const disp = await many("SELECT d.*, p.profilo FROM disponibilita d JOIN professionisti_v p ON p.id=d.prof_id WHERE p.pianificabile AND d.kind='SETTIMANALE'");
  res.json({ dal, al, totali: { orePresenze: orePresTot, oreTurni: oreTurniTot, turni: turni.length, turniScoperti: turni.filter((t) => !t.prof_id).length, costo: r2(pres.reduce((a, p) => a + oreTra(p.ora_da, p.ora_a) * (p.dati?.compenso?.tipo === 'FISSO' ? 0 : tariffaPerSede(p.dati, p.sede_id)), 0)), fissiMensili: r2(rend.filter((x) => x.dettaglio?.tipo === 'FISSO').reduce((a, x) => a + Number(x.importo), 0)), professionisti: new Set(pres.map((p) => p.prof_id)).size, copertura: oreTurniTot ? Math.round(orePresTot / oreTurniTot * 100) : null, disponibilitaOreSett: r2(disp.reduce((a, d) => a + oreTra(d.ora_da, d.ora_a), 0)) },
    perSede: fix(perSede).sort((a, b) => b.ore - a.ore), perProf: fix(perProf).sort((a, b) => b.ore - a.ore), perProfilo: fix(perProfilo).sort((a, b) => b.ore - a.ore), perMese: Object.values(perMese).sort((a, b) => a.mese.localeCompare(b.mese)), rendiconti: { n: rend.length, inviati: rend.filter((x) => x.stato === 'INVIATO').length, importo: r2(rend.reduce((a, x) => a + Number(x.importo), 0)) } });
}));

export default r;
