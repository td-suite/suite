// Importazione dei contenuti dall'app originale (planning.toscanadiagnostica.it) nel modulo Room Planning avviato vuoto.
// Interfaccia comune del core (routes/travaso.js, brief "legacy content"):
//   legacyMatch  → sedi (strutture) e persone (professionisti) dell'app con la proposta di abbinamento all'anagrafica unica
//   legacyImport → copia dei contenuti con gli id tradotti secondo l'abbinamento confermato; con dryRun solo il piano
// Regole: nessuna scrittura su public.* tranne legacy_refs delle righe abbinate; nessuna anagrafica creata; le righe che puntano a
// una sede o persona non abbinata si saltano e finiscono nel rapporto; ripetibile (legacy_import_map ricorda cosa è già arrivato).
import { many as suiteMany } from '../../../db.js';
import { modulePool } from '../../../lib/modules.js';
import { normName } from '../../../lib/util.js';
import { extData } from './strutture.js';

const KEY = 'room';
const lower = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);
const clean = (s) => (s == null ? null : String(s).trim() || null);
const normCf = (s) => { const c = String(s || '').replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{11,16}$/.test(c) ? c : null; };
const normPiva = (s) => { const c = String(s || '').replace(/\D/g, ''); return c.length === 11 ? c : null; };
const validEmail = (e) => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
const tokens = (s) => normName(s).split(' ').filter((t) => t.length >= 3);

// ---------------------------------------------------------------- abbinamento
// Indice per criterio: ogni valore punta all'elenco degli id della Suite che lo hanno; proposta solo se il valore è univoco
class Index {
  constructor() { this.by = new Map(); }
  add(crit, value, id) { if (!value) return; const k = `${crit}\u0001${value}`; const l = this.by.get(k) || []; if (!l.includes(id)) l.push(id); this.by.set(k, l); }
  get(crit, value) { return value ? this.by.get(`${crit}\u0001${value}`) || [] : []; }
}
// Ordine dei criteri (dal più sicuro): un criterio univoco decide la proposta, gli altri alimentano i candidati
function propose(index, criteria, labelOf) {
  let proposal = null; const cand = [];
  for (const { crit, value, score, how } of criteria) {
    for (const id of index.get(crit, value)) if (!cand.includes(id)) cand.push(id);
    const hits = index.get(crit, value);
    if (!proposal && hits.length === 1) proposal = { id: hits[0], label: labelOf(hits[0]), score, how };
  }
  return { proposal, candidates: cand };
}
// Candidati ulteriori per somiglianza del nome (parole in comune), per la scelta manuale
function similar(name, rows, nameOf, limit = 6) {
  const t = tokens(name); if (!t.length) return [];
  return rows.map((r) => ({ id: r.id, n: tokens(nameOf(r)).filter((x) => t.includes(x)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, limit).map((x) => x.id);
}

const siteLabel = (s) => [s.code, s.name, s.city ? `(${s.city})` : null, s.active ? null : '· non attiva'].filter(Boolean).join(' ');
const personLabel = (p) => [`${p.last_name} ${p.first_name}`, p.job_title ? `· ${p.job_title}` : null, p.email ? `· ${p.email}` : null, p.status === 'CESSATO' ? '· cessata' : null].filter(Boolean).join(' ');

async function suiteSites() {
  // le sedi service (clienti) non ospitano ambulatori Room
  return suiteMany(`SELECT id, code, name, short_name, kind, address, city, email, phone, active, legacy_refs->>'${KEY}' AS ref FROM public.sites WHERE kind <> 'SERVICE' ORDER BY active DESC, sort_order, lower(name)`);
}
async function suitePeople() {
  return suiteMany(`SELECT id, last_name, first_name, email, tax_code, vat_number, job_title, status, legacy_refs->>'${KEY}' AS ref FROM public.people ORDER BY (status = 'CESSATO'), lower(last_name), lower(first_name)`);
}

const LEGACY_PROFS_SQL = `SELECT p.id, p.persona_key, p.nome, p.tipo, p.profilo, p.email, p.attivo, p.dati, p.created_at, p.updated_at, u.email AS user_email
  FROM public.professionisti p LEFT JOIN public.users u ON u.id = p.user_id ORDER BY p.id`;
const LEGACY_SITES_SQL = `SELECT id, data, version, created_at, updated_at FROM public.strutture WHERE deleted_at IS NULL ORDER BY lower(data->>'denominazione'), id`;

function profIdentity(p) {
  const an = (p.dati && p.dati.anagrafica) || {};
  const flat = p.dati || {};
  const cognome = clean(an.cognome || flat.cognome), nome = clean(an.nome || flat.nome);
  const emails = [...new Set([p.email, p.user_email, an.email].map(lower).filter(validEmail))];
  return { cognome, nome, emails, cf: normCf(an.codiceFiscale || flat.codiceFiscale), piva: normPiva(an.partitaIva || flat.partitaIva), full: clean(p.nome) || [cognome, nome].filter(Boolean).join(' ') };
}

export async function legacyMatch({ legacyQuery }) {
  // ---- sedi
  const sites = await suiteSites();
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const si = new Index();
  for (const s of sites) {
    si.add('ref', s.ref, s.id);
    si.add('code', lower(s.code), s.id);
    si.add('email', lower(s.email), s.id);
    si.add('name', normName(s.name), s.id);
    si.add('name', normName(s.short_name), s.id);
    si.add('name', normName(s.code), s.id);
  }
  const strutture = await legacyQuery(LEGACY_SITES_SQL);
  const outSites = strutture.map((s) => {
    const d = s.data || {};
    const den = clean(d.denominazione), nomeSede = clean(d.nomeSede), code = clean(d.codice || d.code);
    const crit = [
      { crit: 'ref', value: String(s.id), score: 100, how: 'già abbinata in una importazione precedente' },
      { crit: 'code', value: lower(code), score: 95, how: 'stesso codice' },
      { crit: 'email', value: lower(d.email), score: 90, how: 'stessa email' },
      { crit: 'name', value: normName(den), score: 70, how: 'stessa denominazione' },
      { crit: 'name', value: normName([den, nomeSede].filter(Boolean).join(' ')), score: 70, how: 'stessa denominazione' },
      { crit: 'name', value: normName(nomeSede), score: 65, how: 'stesso nome della sede' },
    ];
    const { proposal, candidates } = propose(si, crit, (id) => siteLabel(siteById.get(id)));
    for (const id of similar([den, nomeSede].filter(Boolean).join(' '), sites, (r) => `${r.name} ${r.short_name || ''}`)) if (!candidates.includes(id)) candidates.push(id);
    return {
      legacy_id: String(s.id), label: [den || '(senza denominazione)', nomeSede].filter(Boolean).join(' · '),
      detail: [d.indirizzo, d.email, d.telefono].filter(Boolean).join(' · ') || null,
      proposal, candidates: candidates.map((id) => ({ id, label: siteLabel(siteById.get(id)) })),
    };
  });

  // ---- persone
  const people = await suitePeople();
  const personById = new Map(people.map((p) => [p.id, p]));
  const pi = new Index();
  for (const p of people) {
    pi.add('ref', p.ref, p.id);
    pi.add('email', lower(p.email), p.id);
    pi.add('cf', normCf(p.tax_code), p.id);
    pi.add('piva', normPiva(p.vat_number), p.id);
    pi.add('name', normName(`${p.last_name} ${p.first_name}`), p.id);
    pi.add('name', normName(`${p.first_name} ${p.last_name}`), p.id);
  }
  const profs = await legacyQuery(LEGACY_PROFS_SQL);
  const outPeople = profs.map((p) => {
    const idn = profIdentity(p);
    const crit = [
      { crit: 'ref', value: String(p.id), score: 100, how: 'già abbinata in una importazione precedente' },
      ...idn.emails.map((e) => ({ crit: 'email', value: e, score: 90, how: 'stessa email' })),
      { crit: 'cf', value: idn.cf, score: 85, how: 'stesso codice fiscale' },
      { crit: 'piva', value: idn.piva, score: 85, how: 'stessa partita IVA' },
      { crit: 'name', value: normName(`${idn.cognome || ''} ${idn.nome || ''}`), score: 70, how: 'stesso nome' },
      { crit: 'name', value: normName(idn.full), score: 70, how: 'stesso nome' },
    ];
    const { proposal, candidates } = propose(pi, crit, (id) => personLabel(personById.get(id)));
    for (const id of similar(idn.full, people, (r) => `${r.last_name} ${r.first_name}`)) if (!candidates.includes(id)) candidates.push(id);
    return {
      legacy_id: String(p.id), label: idn.full || `professionista ${p.id}`,
      detail: [p.profilo || (p.tipo === 'medico' ? 'Medico' : 'Sanitario'), idn.emails[0], idn.cf, p.attivo === false ? 'non attivo' : null].filter(Boolean).join(' · ') || null,
      proposal, candidates: candidates.map((id) => ({ id, label: personLabel(personById.get(id)) })),
    };
  });

  // ---- tabelle con il numero di righe
  const tables = [];
  for (const t of ['strutture', 'struttura_blobs', 'struttura_history', 'eventi', 'email_log', 'professionisti', 'professionista_docs', 'disponibilita', 'turni', 'turni_mesi', 'presenze', 'rendiconti', 'posizioni', 'candidature']) {
    const r = await legacyQuery(`SELECT count(*)::int AS n FROM public."${t}"${t === 'strutture' ? ' WHERE deleted_at IS NULL' : ''}`);
    tables.push({ table: t, rows: r[0].n });
  }
  return {
    entities: { sites: outSites, people: outPeople, organizations: [] },
    tables,
    catalog: { sites: sites.map((s) => ({ id: s.id, label: siteLabel(s), active: s.active })) },
    warnings: [],
  };
}

// ---------------------------------------------------------------- fusione delle impostazioni Room di una sede
// Una sezione è una chiave di primo livello del documento di site_ext (ambulatori, personale, prestazioni, hours, deskCapacity, note,
// plan = marker della planimetria...). Vuota = assente, null, stringa vuota, elenco vuoto, oggetto vuoto (per plan: nessun marker).
const isEmptyValue = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const sectionEmpty = (k, v) => (k === 'plan' ? isEmptyValue(v && v.markers) : isEmptyValue(v));
const sameSection = (k, a, b) => JSON.stringify(k === 'plan' ? (a && a.markers) || {} : a) === JSON.stringify(k === 'plan' ? (b && b.markers) || {} : b);
const SECTION_LABEL = { plan: 'marker della planimetria', hours: 'orari', note: 'note', deskCapacity: 'postazioni desk', deskCapAM: 'postazioni desk (mattina)', deskCapPM: 'postazioni desk (pomeriggio)', deskSplit: 'cambio turno desk' };
const sectionLabel = (k) => SECTION_LABEL[k] || k;
const lvPlan = (ext) => (ext.plan && typeof ext.plan === 'object' ? ext.plan : {});
const ambIds = (list) => new Set((Array.isArray(list) ? list : []).map((a) => String(a && a.id)));

/** Fonde le impostazioni dell'app originale in quelle della Suite, sezione per sezione (vince la Suite dove è già valorizzata).
 *  Ritorna { data, taken: [etichette integrate], kept: [etichette mantenute dalla Suite], warnings } e non modifica gli argomenti. */
export function mergeSiteExt(suiteData, legacyExt) {
  const data = { ...(suiteData || {}) };
  const taken = []; const kept = []; const warnings = [];
  const takenKeys = new Set();
  for (const k of Object.keys(legacyExt || {})) {
    const lv = legacyExt[k];
    if (sectionEmpty(k, lv)) continue;                              // l'app non ha nulla per questa sezione
    if (sectionEmpty(k, data[k])) { data[k] = lv; takenKeys.add(k); taken.push(sectionLabel(k)); }
    else if (!sameSection(k, data[k], lv)) kept.push(sectionLabel(k));   // già uguale all'app (es. importata prima): nulla da dire
  }
  // Riferimenti interni: i marker della planimetria puntano agli id degli ambulatori. Marker e ambulatori di origine diversa non si mischiano.
  const ambFromApp = takenKeys.has('ambulatori'), markersFromApp = takenKeys.has('plan');
  if (markersFromApp && !ambFromApp && !sectionEmpty('ambulatori', data.ambulatori)) {
    const ids = ambIds(data.ambulatori);   // ambulatori della Suite
    const mk = legacyExt.plan.markers; const ok = {};
    for (const id of Object.keys(mk)) if (ids.has(String(id))) ok[id] = mk[id];
    const dropped = Object.keys(mk).length - Object.keys(ok).length;
    if (!Object.keys(ok).length) {
      data.plan = { ...(suiteData.plan || {}), markers: (suiteData.plan && suiteData.plan.markers) || {} }; takenKeys.delete('plan');
      taken.splice(taken.indexOf(sectionLabel('plan')), 1);
      warnings.push('i marker della planimetria dell\'app originale puntano ad ambulatori diversi da quelli della Suite: non integrati, da riposizionare in Room Planning');
    } else {
      data.plan = { ...lvPlan(legacyExt), markers: ok };
      if (dropped) warnings.push(`${dropped} marker della planimetria dell'app originale puntano ad ambulatori che nella Suite non esistono: tolti, gli altri integrati`);
    }
  }
  if (ambFromApp && !markersFromApp && !sectionEmpty('plan', data.plan)) {
    const ids = ambIds(data.ambulatori);   // ambulatori dell'app
    const orphan = Object.keys(data.plan.markers).filter((id) => !ids.has(String(id)));
    if (orphan.length) warnings.push(`i marker della planimetria della Suite (${orphan.join(', ')}) non corrispondono agli ambulatori integrati dall'app originale: controlla la planimetria in Room Planning`);
  }
  return { data, taken, kept, warnings };
}
// ---------------------------------------------------------------- persone non abbinate → righe del dataset "people" (XLSX di Importazioni)
// Per i professionisti dell'app originale NON presenti in mapping.people: tutto ciò che l'app sa della persona, nel formato del modello
// Persone di Amministrazione > Importazioni (routes/importxlsx.js). Caricato il file, una nuova apertura della finestra li riconosce
// per email o codice fiscale (o nome) e la seconda importazione copia i contenuti saltati dalla prima.
const DISC_LABEL = (d) => (Array.isArray(d) ? d.filter(Boolean).join(', ') : clean(d));
function splitNome(full) {
  // "Cognome Nome" (formato dell'app): il primo termine è il cognome, il resto il nome; con un solo termine resta il cognome
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { cognome: null, nome: null };
  return { cognome: parts[0], nome: parts.slice(1).join(' ') || null };
}
export async function legacyPeopleRows({ legacyQuery, mapping }) {
  const matched = new Set(Object.keys((mapping && mapping.people) || {}).map(String));
  const siteMap = new Map(Object.entries((mapping && mapping.sites) || {}).map(([lid, sid]) => [String(lid), Number(sid)]));
  const codes = new Map((await suiteMany('SELECT id, code FROM public.sites')).map((s) => [s.id, s.code]));
  const profs = await legacyQuery(LEGACY_PROFS_SQL);
  const rows = [];
  for (const p of profs) {
    if (matched.has(String(p.id))) continue;
    const an = (p.dati && p.dati.anagrafica) || {}; const flat = p.dati || {}; const prof = (p.dati && p.dati.professionale) || {};
    const idn = profIdentity(p);
    const sn = splitNome(p.nome);
    const cognome = idn.cognome || sn.cognome, nome = idn.nome || sn.nome;
    if (!cognome) continue;
    const tipo = p.tipo === 'medico' ? 'MEDICO' : 'SANITARIO';
    const sesso = clean(an.sesso) ? String(an.sesso).trim().toUpperCase().slice(0, 1) : null;
    const titolo = clean(an.titolo) || (tipo === 'MEDICO' ? (sesso === 'F' ? 'Dott.ssa' : 'Dott.') : null);
    // sede principale: la prima delle sedi abilitate che risulta abbinata a una sede della Suite
    let siteCode = null;
    for (const lid of flat.sediAbilitate || []) { const sid = siteMap.get(String(lid)); if (sid && codes.get(sid)) { siteCode = codes.get(sid); break; } }
    rows.push({
      legacy_id: String(p.id),
      last_name: cognome, first_name: nome || '', title: titolo,
      email: idn.emails[0] || null, tax_code: idn.cf || clean(an.codiceFiscale || flat.codiceFiscale) || null,
      kind: tipo, status: p.attivo === false ? 'CESSATO' : 'ATTIVO',
      job_title: clean(p.profilo) || clean(prof.profilo) || null,
      discipline: DISC_LABEL(prof.discipline || flat.discipline) || null,
      site_code: siteCode,
      phone: clean(an.cellulare || flat.cellulare) || null, phone_office: clean(an.telefono || flat.telefono) || null,
      sex: sesso && ['F', 'M'].includes(sesso) ? sesso : null,
      birth_date: clean(an.dataNascita) || null, birth_place: clean(an.luogoNascita) || null,
      vat_number: idn.piva || clean(an.partitaIva || flat.partitaIva) || null,
      address: clean(an.indirizzo) || null, zip: clean(an.cap) || null, city: clean(an.citta) || null, province: clean(an.provincia) ? String(an.provincia).trim().toUpperCase() : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- importazione
const BATCH = 200, BATCH_HEAVY = 20;
// Colonne degli utenti dell'app (created_by, updated_by, user_id, sent_by, confermato_da, generato_da, approvato_da) → NULL:
// gli accessi sono della Suite e nessuna di queste colonne è obbligatoria; userId resta disponibile per usi futuri

export async function legacyImport({ legacyQueryLong, mapping, dryRun }) {
  const stats = {}; const skipped = []; const warnings = [];
  const st = (t) => (stats[t] ||= { copied: 0, skipped: 0, existing: 0 });
  const skip = (table, legacyId, reason) => { st(table).skipped++; skipped.push({ table, legacy_id: String(legacyId), reason }); };

  // ---- abbinamenti confermati: validi, senza doppioni
  const sites = await suiteSites(); const siteOk = new Set(sites.map((s) => s.id));
  const people = await suitePeople(); const personOk = new Set(people.map((p) => p.id));
  const siteMap = new Map(); const personMap = new Map();
  const usedSite = new Map(); const usedPerson = new Map();
  for (const [lid, sid] of Object.entries(mapping.sites || {})) {
    if (!siteOk.has(sid)) { warnings.push(`Sede ${lid}: la sede scelta nella Suite (${sid}) non esiste o è un cliente service: abbinamento ignorato`); continue; }
    if (usedSite.has(sid)) warnings.push(`La sede della Suite ${sid} è abbinata a due sedi dell'app originale (${usedSite.get(sid)} e ${lid}): i contenuti confluiscono nella stessa sede`);
    if (!usedSite.has(sid)) usedSite.set(sid, lid); siteMap.set(String(lid), sid);
  }
  for (const [lid, pid] of Object.entries(mapping.people || {})) {
    if (!personOk.has(pid)) { warnings.push(`Persona ${lid}: la persona scelta nella Suite (${pid}) non esiste: abbinamento ignorato`); continue; }
    if (usedPerson.has(pid)) warnings.push(`La persona della Suite ${pid} è abbinata a due professionisti dell'app originale (${usedPerson.get(pid)} e ${lid}): i contenuti confluiscono nella stessa persona`);
    if (!usedPerson.has(pid)) usedPerson.set(pid, lid); personMap.set(String(lid), pid);
  }
  const site = (v) => (v == null ? null : siteMap.get(String(v)) ?? null);
  const person = (v) => (v == null ? null : personMap.get(String(v)) ?? null);

  const client = await modulePool(KEY).connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    // mappa delle righe già importate (tabella → legacy_id → suite_id)
    const imported = new Map();
    for (const r of (await client.query('SELECT tabella, legacy_id, suite_id FROM legacy_import_map')).rows) {
      if (!imported.has(r.tabella)) imported.set(r.tabella, new Map());
      imported.get(r.tabella).set(r.legacy_id, r.suite_id);
    }
    const already = (t, lid) => imported.get(t)?.get(String(lid));
    const remember = async (t, lid, sid) => {
      if (!imported.has(t)) imported.set(t, new Map());
      imported.get(t).set(String(lid), String(sid));
      await client.query('INSERT INTO legacy_import_map (tabella, legacy_id, suite_id) VALUES ($1,$2,$3) ON CONFLICT (tabella, legacy_id) DO UPDATE SET suite_id = EXCLUDED.suite_id, imported_at = now()', [t, String(lid), String(sid)]);
    };
    // id di una riga dell'app già copiata (riferimenti interni: turno della presenza, posizione della candidatura...)
    const newId = (t, lid) => { const v = already(t, lid); return v == null ? null : Number(v); };

    // inserimento a lotti con traduzione già fatta: rows = [{ legacy_id, values: {col: val} }]; RETURNING id nell'ordine dei VALUES
    async function insertBatch(table, rows, { returning = 'id', mapTable = table } = {}) {
      if (!rows.length) return;
      const cols = Object.keys(rows[0].values);
      const params = []; const tuples = rows.map((r) => `(${cols.map((c) => { params.push(r.values[c]); return `$${params.length}`; }).join(',')})`);
      const res = await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(',')}${returning ? ` RETURNING ${returning}` : ''}`, params);
      for (let i = 0; i < rows.length; i++) {
        const sid = returning ? res.rows[i][returning] : rows[i].natural;
        await remember(mapTable, rows[i].legacy_id, sid);
        st(table).copied++;
      }
    }
    // lettura a lotti dall'app originale (ordinata per chiave, LIMIT/OFFSET), per non caricare tutto in memoria
    async function scan(sql, pk, batch, fn) {
      let offset = 0;
      for (;;) {
        const rows = await legacyQueryLong(`${sql} ORDER BY ${pk} LIMIT ${batch} OFFSET ${offset}`);
        if (!rows.length) break;
        await fn(rows);
        offset += rows.length;
        if (rows.length < batch) break;
      }
    }
    const json = (v) => JSON.stringify(v == null ? null : v);
    const dateTxt = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d));

    // ---- 0) legacy_refs sulle righe abbinate dell'anagrafica unica: un'importazione successiva riconosce gli abbinamenti
    for (const [lid, sid] of siteMap) await client.query(`UPDATE public.sites SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || jsonb_build_object($1::text, $2::text), updated_at = now() WHERE id = $3 AND coalesce(legacy_refs->>$1, '') <> $2`, [KEY, lid, sid]);
    for (const [lid, pid] of personMap) await client.query(`UPDATE public.people SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || jsonb_build_object($1::text, $2::int), updated_at = now() WHERE id = $3 AND coalesce(legacy_refs->>$1, '') <> $2::text`, [KEY, Number(lid), pid]);
    stats.abbinamenti = { copied: siteMap.size + personMap.size, skipped: 0, existing: 0, sedi: siteMap.size, persone: personMap.size };

    // ---- 1) sedi: impostazioni Room della sede (documento senza anagrafica e senza binari) in site_ext.
    // Sede già configurata nella Suite (es. solo la planimetria): fusione per sezione, non salto. Ogni chiave di primo livello del
    // JSON dell'app (ambulatori, personale, prestazioni, hours, desk*, plan.markers, note e qualunque altra) entra solo se nella Suite
    // manca o è vuota; le sezioni già valorizzate nella Suite restano e vengono segnalate. La fusione si ripete anche per una sede
    // già importata (legacy_import_map): le sezioni ancora vuote vengono integrate (è il caso di una prima importazione che ha saltato).
    const existingExt = new Map((await client.query('SELECT site_id, data, version FROM site_ext')).rows.map((r) => [r.site_id, r]));
    const strutture = await legacyQueryLong(LEGACY_SITES_SQL);
    const mergedSites = new Set();   // sedi della Suite già fuse in questa esecuzione (due strutture dell'app sulla stessa sede)
    for (const s of strutture) {
      const sid = site(s.id);
      const den = s.data?.denominazione || s.id;
      if (!sid) { skip('site_ext', s.id, `sede "${den}" non abbinata a una sede della Suite`); continue; }
      const legacyExt = extData(s.data || {});
      const cur = existingExt.get(sid);
      if (!cur) {
        await client.query('INSERT INTO site_ext (site_id, data, version, created_at, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,NULL)', [sid, json(legacyExt), s.version || 1, s.created_at, s.updated_at]);
        existingExt.set(sid, { site_id: sid, data: legacyExt, version: s.version || 1 });   // seconda struttura abbinata alla stessa sede: si fonde
        await remember('strutture', s.id, sid); st('site_ext').copied++;
        continue;
      }
      const m = mergeSiteExt(cur.data || {}, legacyExt);
      for (const w of m.warnings) warnings.push(`Sede "${den}": ${w}`);
      if (!m.taken.length) {
        if (already('strutture', s.id) || mergedSites.has(sid)) st('site_ext').existing++;
        else { skip('site_ext', s.id, `la sede "${den}" ha già tutte le impostazioni Room nella Suite: ${m.kept.length ? `sezioni ${m.kept.join(', ')} mantenute dalla Suite` : 'nulla da integrare'}`); await remember('strutture', s.id, sid); }
        if (m.kept.length && !mergedSites.has(sid)) warnings.push(`Sede "${den}": sezioni ${m.kept.join(', ')} mantenute dalla Suite (già valorizzate), non sovrascritte con quelle dell'app originale`);
        continue;
      }
      const newVersion = (cur.version || 0) + 1;
      const note = `Integrazione dall'app originale: ${m.taken.join(', ')}${m.kept.length ? ` (mantenute dalla Suite: ${m.kept.join(', ')})` : ''}`;
      await client.query('UPDATE site_ext SET data=$2, version=$3, updated_at=now(), updated_by=NULL WHERE site_id=$1', [sid, json(m.data), newVersion]);
      await client.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name, note) VALUES ($1,$2,$3,NULL,$4,$5)', [sid, newVersion, json(m.data), 'Importazione dall\'app originale', note]);
      existingExt.set(sid, { site_id: sid, data: m.data, version: newVersion }); mergedSites.add(sid);
      warnings.push(`Sede "${den}": integrate dall'app originale le sezioni ${m.taken.join(', ')}${m.kept.length ? `; sezioni ${m.kept.join(', ')} mantenute dalla Suite` : ''}`);
      await remember('strutture', s.id, sid); st('site_ext').copied++;
    }
    const siteImported = (lid) => Boolean(already('strutture', lid));
    const legacySiteIds = new Set(strutture.map((s) => String(s.id)));
    // motivo dello scarto per una sede dell'app: nel cestino dell'app, oppure non abbinata
    const siteReason = (lid) => (legacySiteIds.has(String(lid)) ? 'sede non abbinata' : 'sede eliminata nell\'app originale');

    // ---- 2) planimetrie e loghi (binari in base64: lotti piccoli)
    await scan('SELECT struttura_id, kind, data, updated_at FROM public.struttura_blobs', 'struttura_id, kind', BATCH_HEAVY, async (rows) => {
      for (const b of rows) {
        const lid = `${b.struttura_id}:${b.kind}`; const sid = site(b.struttura_id);
        if (!sid || !siteImported(b.struttura_id)) { skip('struttura_blobs', lid, siteReason(b.struttura_id)); continue; }
        if (already('struttura_blobs', lid)) { st('struttura_blobs').existing++; continue; }
        const r = await client.query('INSERT INTO struttura_blobs (struttura_id, kind, data, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (struttura_id, kind) DO NOTHING RETURNING struttura_id', [sid, b.kind, b.data, b.updated_at]);
        if (!r.rows.length) { skip('struttura_blobs', lid, 'la sede ha già questo file nella Suite: non sovrascritto'); continue; }
        await remember('struttura_blobs', lid, `${sid}:${b.kind}`); st('struttura_blobs').copied++;
      }
    });

    // ---- 3) cronologia delle sedi
    await scan('SELECT id, struttura_id, version, data, user_id, user_name, note, at FROM public.struttura_history', 'id', BATCH_HEAVY, async (rows) => {
      const batch = [];
      for (const h of rows) {
        const sid = site(h.struttura_id);
        if (!sid || !siteImported(h.struttura_id)) { skip('struttura_history', h.id, siteReason(h.struttura_id)); continue; }
        if (already('struttura_history', h.id)) { st('struttura_history').existing++; continue; }
        batch.push({ legacy_id: h.id, values: { struttura_id: sid, version: h.version, data: json(extData(h.data || {})), user_id: null, user_name: h.user_name, note: h.note, at: h.at } });
      }
      await insertBatch('struttura_history', batch);
    });

    // ---- 4) persone: scheda Room in person_ext (i dati anagrafici restano in public.people e non si toccano)
    const translateDati = (dati) => {
      const d = { ...(dati || {}) };
      d.sediAbilitate = [...new Set((d.sediAbilitate || []).map(site).filter(Boolean))];
      if (d.compenso) d.compenso = { ...d.compenso, eccezioniSede: (d.compenso.eccezioniSede || []).map((e) => ({ ...e, sedeId: site(e.sedeId) })).filter((e) => e.sedeId) };
      if (d.anagrafica && typeof d.anagrafica === 'object') {
        d.anagrafica = { ...d.anagrafica };
        for (const k of ['cognome', 'nome', 'codiceFiscale', 'email', 'telefono', 'cellulare', 'sesso', 'dataNascita', 'luogoNascita', 'partitaIva', 'indirizzo', 'cap', 'citta', 'provincia']) delete d.anagrafica[k];
      }
      for (const k of ['cognome', 'nome', 'codiceFiscale', 'cellulare', 'telefono', 'discipline']) delete d[k];   // vecchio formato piatto
      return d;
    };
    const existingPx = new Map((await client.query('SELECT person_id, tipo FROM person_ext')).rows.map((r) => [r.person_id, r.tipo]));
    const coreById = new Map(people.map((x) => [x.id, x]));
    const corePersonal = new Map((await suiteMany(`SELECT id, phone, birth_date, birth_place, address, city FROM public.people WHERE id = ANY($1::int[])`, [[...personMap.values()]])).map((x) => [x.id, x]));
    // dati personali presenti nell'app e assenti nell'anagrafica unica: non si scrivono (l'anagrafica si cura in Amministrazione), si segnalano
    const missingCore = (p, pid) => {
      const an = (p.dati && p.dati.anagrafica) || {}; const flat = p.dati || {};
      const core = { ...(coreById.get(pid) || {}), ...(corePersonal.get(pid) || {}) };
      const miss = [];
      if (!core.tax_code && normCf(an.codiceFiscale || flat.codiceFiscale)) miss.push('codice fiscale');
      if (!core.vat_number && normPiva(an.partitaIva || flat.partitaIva)) miss.push('partita IVA');
      if (!core.email && [p.email, p.user_email, an.email].map(lower).some(validEmail)) miss.push('email');
      if (!core.phone && clean(an.cellulare || an.telefono || flat.cellulare || flat.telefono)) miss.push('telefono');
      if (!core.birth_date && clean(an.dataNascita)) miss.push('data di nascita');
      if (!core.birth_place && clean(an.luogoNascita)) miss.push('luogo di nascita');
      if (!core.address && !core.city && clean(an.indirizzo || an.citta)) miss.push('residenza');
      return miss;
    };
    const profs = await legacyQueryLong(LEGACY_PROFS_SQL);
    for (const p of profs) {
      const pid = person(p.id);
      const name = p.nome || `professionista ${p.id}`;
      if (!pid) { skip('person_ext', p.id, `professionista "${name}" non abbinato a una persona della Suite`); continue; }
      const miss = missingCore(p, pid);
      if (miss.length) warnings.push(`Persona "${name}": nell'app originale ha ${miss.join(', ')} che manca nell'anagrafica della Suite: i dati personali non si importano, vanno completati in Amministrazione > Persone`);
      if (already('professionisti', p.id)) { st('person_ext').existing++; continue; }
      const tipo = p.tipo === 'medico' ? 'medico' : 'sanitario';
      const dati = json(translateDati(p.dati));
      if (existingPx.has(pid) && existingPx.get(pid)) {
        skip('person_ext', p.id, `la persona "${name}" ha già la scheda Room nella Suite: non sovrascritta`);
        warnings.push(`Persona "${name}": scheda Room già presente nella Suite, compenso, contratto e sedi abilitate dell'app originale non sono stati importati`);
        await remember('professionisti', p.id, pid);   // la persona è abbinata: turni, presenze e documenti si importano comunque
        continue;
      }
      if (existingPx.has(pid)) {
        // riga nata nella Suite solo per il flag di esclusione: la scheda arriva dall'app, il flag resta
        await client.query('UPDATE person_ext SET tipo=$2, profilo=$3, dati=$4::jsonb || dati, updated_at=GREATEST(updated_at, $5), updated_by=NULL WHERE person_id=$1', [pid, tipo, clean(p.profilo), dati, p.updated_at]);
      } else {
        await client.query('INSERT INTO person_ext (person_id, tipo, profilo, dati, created_at, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6,NULL)', [pid, tipo, clean(p.profilo), dati, p.created_at, p.updated_at]);
        existingPx.set(pid, tipo);
      }
      await remember('professionisti', p.id, pid); st('person_ext').copied++;
    }
    const personImported = (lid) => Boolean(already('professionisti', lid));
    const legacyProfIds = new Set(profs.map((p) => String(p.id)));
    const personReason = (lid) => (legacyProfIds.has(String(lid)) ? 'persona non abbinata' : 'professionista non più presente nell\'app originale');

    // ---- 5) documenti dei professionisti (base64: lotti piccoli)
    await scan('SELECT id, prof_id, tipo, nome, mime, size, scadenza, note, data, created_at FROM public.professionista_docs', 'id', BATCH_HEAVY, async (rows) => {
      const batch = [];
      for (const d of rows) {
        const pid = person(d.prof_id);
        if (!pid || !personImported(d.prof_id)) { skip('professionista_docs', d.id, `documento "${d.nome}": ${personReason(d.prof_id)}`); continue; }
        if (already('professionista_docs', d.id)) { st('professionista_docs').existing++; continue; }
        batch.push({ legacy_id: d.id, values: { person_id: pid, tipo: d.tipo, nome: d.nome, mime: d.mime, size: d.size, scadenza: d.scadenza, note: d.note, data: d.data, created_at: d.created_at, created_by: null } });
      }
      await insertBatch('professionista_docs', batch);
    });

    // ---- 6) disponibilità (sedi: elenco di id dell'app → id della Suite)
    await scan('SELECT * FROM public.disponibilita', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const r of rows) {
        const pid = person(r.prof_id);
        if (!pid || !personImported(r.prof_id)) { skip('disponibilita', r.id, personReason(r.prof_id)); continue; }
        if (already('disponibilita', r.id)) { st('disponibilita').existing++; continue; }
        const sedi = Array.isArray(r.sedi) ? r.sedi : [];
        const tr = [...new Set(sedi.map(site).filter(Boolean))];
        if (sedi.length && !tr.length) { skip('disponibilita', r.id, 'nessuna delle sedi indicate è abbinata'); continue; }
        if (tr.length < new Set(sedi).size) warnings.push(`Disponibilità ${r.id}: una o più sedi non abbinate sono state tolte dall'elenco`);
        batch.push({ legacy_id: r.id, values: { prof_id: pid, kind: r.kind, giorno: r.giorno, data: r.data, valid_dal: r.valid_dal, valid_al: r.valid_al, ora_da: r.ora_da, ora_a: r.ora_a, sedi: json(tr), nota: r.nota, created_at: r.created_at, updated_at: r.updated_at } });
      }
      await insertBatch('disponibilita', batch);
    });

    // ---- 7) turni (prof_id NULL = turno scoperto, ammesso)
    await scan('SELECT * FROM public.turni', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const t of rows) {
        const sid = site(t.sede_id);
        if (!sid || !siteImported(t.sede_id)) { skip('turni', t.id, `turno del ${dateTxt(t.data)}: ${siteReason(t.sede_id)}`); continue; }
        let pid = null;
        if (t.prof_id != null) { pid = person(t.prof_id); if (!pid || !personImported(t.prof_id)) { skip('turni', t.id, `turno del ${dateTxt(t.data)}: ${personReason(t.prof_id)}`); continue; } }
        if (already('turni', t.id)) { st('turni').existing++; continue; }
        batch.push({ legacy_id: t.id, values: { mese: t.mese, sede_id: sid, data: t.data, ora_da: t.ora_da, ora_a: t.ora_a, prof_id: pid, profilo: t.profilo, attivita: t.attivita, room_id: t.room_id, nota: t.nota, created_by: null, created_at: t.created_at, updated_at: t.updated_at } });
      }
      await insertBatch('turni', batch);
    });

    // ---- 8) stato dei mesi di turni
    for (const m of await legacyQueryLong('SELECT * FROM public.turni_mesi ORDER BY mese')) {
      if (already('turni_mesi', m.mese)) { st('turni_mesi').existing++; continue; }
      const r = await client.query('INSERT INTO turni_mesi (mese, stato, confermato_da, confermato_at, nota) VALUES ($1,$2,NULL,$3,$4) ON CONFLICT (mese) DO NOTHING RETURNING mese', [m.mese, m.stato, m.confermato_at, m.nota]);
      if (!r.rows.length) { skip('turni_mesi', m.mese, `il mese ${m.mese} ha già uno stato nella Suite: non sovrascritto`); continue; }
      await remember('turni_mesi', m.mese, m.mese); st('turni_mesi').copied++;
    }

    // ---- 9) registro email (la sede, se indicata, deve essere abbinata)
    await scan('SELECT * FROM public.email_log', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const e of rows) {
        let sid = null;
        if (e.sede_id != null) { sid = site(e.sede_id); if (!sid || !siteImported(e.sede_id)) { skip('email_log', e.id, siteReason(e.sede_id)); continue; } }
        if (already('email_log', e.id)) { st('email_log').existing++; continue; }
        batch.push({ legacy_id: e.id, values: { kind: e.kind, ref_key: e.ref_key, sede_id: sid, to_addr: e.to_addr, cc_addr: e.cc_addr, subject: e.subject, body: e.body, attachment_name: e.attachment_name, status: e.status, error: e.error, sent_by: null, at: e.at } });
      }
      await insertBatch('email_log', batch);
    });

    // ---- 10) rendiconti (il dettaglio contiene id di sedi e presenze: le sedi si traducono subito, le presenze dopo averle copiate)
    const fixDettaglio = (det) => {
      const d = det && typeof det === 'object' ? { ...det } : {};
      const fix = (x) => (x && x.sedeId != null ? { ...x, sedeId: site(x.sedeId) ?? x.sedeId } : x);
      if (Array.isArray(d.righe)) d.righe = d.righe.map(fix);
      if (Array.isArray(d.perSede)) d.perSede = d.perSede.map(fix);
      return d;
    };
    await scan('SELECT * FROM public.rendiconti', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const r of rows) {
        const pid = person(r.prof_id);
        if (!pid || !personImported(r.prof_id)) { skip('rendiconti', r.id, `rendiconto ${r.mese}: ${personReason(r.prof_id)}`); continue; }
        if (already('rendiconti', r.id)) { st('rendiconti').existing++; continue; }
        const dup = await client.query('SELECT id FROM rendiconti WHERE prof_id=$1 AND mese=$2', [pid, r.mese]);
        if (dup.rows.length) { skip('rendiconti', r.id, `rendiconto ${r.mese}: la persona ha già un rendiconto di quel mese nella Suite`); continue; }
        batch.push({ legacy_id: r.id, values: { prof_id: pid, mese: r.mese, stato: r.stato, ore: r.ore, importo: r.importo, dettaglio: json(fixDettaglio(r.dettaglio)), nota: r.nota, generato_da: null, generato_at: r.generato_at, approvato_da: null, approvato_at: r.approvato_at, inviato_at: r.inviato_at, email_log_id: r.email_log_id == null ? null : newId('email_log', r.email_log_id) } });
      }
      await insertBatch('rendiconti', batch);
    });

    // ---- 11) presenze
    await scan('SELECT * FROM public.presenze', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const p of rows) {
        const pid = person(p.prof_id); const sid = site(p.sede_id);
        if (!pid || !personImported(p.prof_id)) { skip('presenze', p.id, `presenza del ${dateTxt(p.data)}: ${personReason(p.prof_id)}`); continue; }
        if (!sid || !siteImported(p.sede_id)) { skip('presenze', p.id, `presenza del ${dateTxt(p.data)}: ${siteReason(p.sede_id)}`); continue; }
        if (already('presenze', p.id)) { st('presenze').existing++; continue; }
        batch.push({ legacy_id: p.id, values: { prof_id: pid, sede_id: sid, data: p.data, ora_da: p.ora_da, ora_a: p.ora_a, origine: p.origine, turno_id: p.turno_id == null ? null : newId('turni', p.turno_id), stato: p.stato, attivita: p.attivita, nota: p.nota, confermato_da: null, confermato_at: p.confermato_at, rendiconto_id: p.rendiconto_id == null ? null : newId('rendiconti', p.rendiconto_id) } });
      }
      await insertBatch('presenze', batch);
    });
    // id delle presenze dentro il dettaglio dei rendiconti copiati ora
    const presMap = imported.get('presenze') || new Map();
    const rendMap = imported.get('rendiconti') || new Map();
    if (rendMap.size && presMap.size) {
      const rows = (await client.query('SELECT id, dettaglio FROM rendiconti WHERE id = ANY($1::int[])', [[...rendMap.values()].map(Number)])).rows;
      for (const r of rows) {
        const det = r.dettaglio || {}; let changed = false;
        if (Array.isArray(det.righe)) det.righe = det.righe.map((x) => { if (x && x.presenzaId != null && presMap.has(String(x.presenzaId))) { changed = true; return { ...x, presenzaId: Number(presMap.get(String(x.presenzaId))) }; } return x; });
        if (changed) await client.query('UPDATE rendiconti SET dettaglio=$2 WHERE id=$1', [r.id, json(det)]);
      }
    }

    // ---- 12) eventi del calendario (assenze, chiusure, sessioni extra)
    await scan('SELECT * FROM public.eventi', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const e of rows) {
        let sid = null;
        if (e.sede_id != null) { sid = site(e.sede_id); if (!sid || !siteImported(e.sede_id)) { skip('eventi', e.id, `${e.kind} dal ${dateTxt(e.dal)}: ${siteReason(e.sede_id)}`); continue; } }
        if (already('eventi', e.id)) { st('eventi').existing++; continue; }
        batch.push({ legacy_id: e.id, values: { kind: e.kind, persona_key: e.persona_key, persona_nome: e.persona_nome, sede_id: sid, persona_id: e.persona_id, dal: e.dal, al: e.al, sost_persona_id: e.sost_persona_id, sost_nome: e.sost_nome, room_id: e.room_id, ora_da: e.ora_da, ora_a: e.ora_a, nota: e.nota, created_by: null, created_at: e.created_at } });
      }
      await insertBatch('eventi', batch);
    });

    // ---- 13) bacheca: posizioni e candidature
    await scan('SELECT * FROM public.posizioni', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const p of rows) {
        let sid = null;
        if (p.sede_id != null) { sid = site(p.sede_id); if (!sid || !siteImported(p.sede_id)) { skip('posizioni', p.id, `posizione "${p.titolo}": ${siteReason(p.sede_id)}`); continue; } }
        if (already('posizioni', p.id)) { st('posizioni').existing++; continue; }
        batch.push({ legacy_id: p.id, values: { titolo: p.titolo, sede_id: sid, profilo: p.profilo, descrizione: p.descrizione, dal: p.dal, al: p.al, giorni: json(Array.isArray(p.giorni) ? p.giorni : []), ora_da: p.ora_da, ora_a: p.ora_a, stato: p.stato, turno_id: p.turno_id == null ? null : newId('turni', p.turno_id), created_by: null, created_at: p.created_at, updated_at: p.updated_at } });
      }
      await insertBatch('posizioni', batch);
    });
    await scan('SELECT * FROM public.candidature', 'id', BATCH, async (rows) => {
      const batch = [];
      for (const c of rows) {
        const pid = person(c.prof_id); const pos = newId('posizioni', c.posizione_id);
        if (!pid || !personImported(c.prof_id)) { skip('candidature', c.id, personReason(c.prof_id)); continue; }
        if (!pos) { skip('candidature', c.id, 'la posizione della bacheca non è stata importata'); continue; }
        if (already('candidature', c.id)) { st('candidature').existing++; continue; }
        const dup = await client.query('SELECT id FROM candidature WHERE posizione_id=$1 AND prof_id=$2', [pos, pid]);
        if (dup.rows.length) { skip('candidature', c.id, 'candidatura già presente nella Suite'); continue; }
        batch.push({ legacy_id: c.id, values: { posizione_id: pos, prof_id: pid, nota: c.nota, stato: c.stato, created_at: c.created_at } });
      }
      await insertBatch('candidature', batch);
    });

    if (dryRun) await client.query('ROLLBACK'); else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }

  // riepilogo leggibile
  const persone = (mapping.people && Object.keys(mapping.people).length) || 0, sedi = (mapping.sites && Object.keys(mapping.sites).length) || 0;
  if (!sedi) warnings.unshift('Nessuna sede abbinata: impostazioni, planimetrie, turni e presenze delle sedi non possono essere importati');
  if (!persone) warnings.unshift('Nessuna persona abbinata: schede, documenti, disponibilità, presenze e rendiconti non possono essere importati');
  return { stats, skipped, warnings: [...new Set(warnings)], dryRun: Boolean(dryRun) };
}
