// Importazione dei contenuti dall'app originale (Integration Plan Management) nel modulo Integration avviato vuoto.
// Interfaccia comune del core (routes/travaso.js, brief "legacy content"):
//   legacyMatch  → target (società da integrare) e persone del team dell'app con la proposta di abbinamento all'anagrafica unica
//   legacyImport → copia dei contenuti con gli id tradotti secondo l'abbinamento confermato; con dryRun solo il piano
// Anagrafica unica (docs/ANAGRAFICA.md, "Integration: le target sono le Legal entity TARGET"): la target dell'app diventa i soli campi del
// piano (org_ext) della Legal entity abbinata; nome, P.IVA, indirizzo, contatti restano in public.organizations e non si toccano.
// Una Legal entity già SOCIETA è un'acquisizione conclusa: il piano si copia comunque ma resta in sola lettura (si avvisa).
// Le persone del team diventano person_ext (ruolo nel piano); owner e support delle attività, che nell'app erano il ruolo o il nome
// del registro team, diventano persone della Suite. Nessuna anagrafica creata; ripetibile (legacy_import_map ricorda cosa è già arrivato).
import { many as suiteMany } from '../../../db.js';
import { modulePool } from '../../../lib/modules.js';
import { normName } from '../../../lib/util.js';

const KEY = 'integration';
const lower = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);
const clean = (s) => (s == null ? null : String(s).trim() || null);
const str = (v) => (v == null ? '' : String(v));
const normCf = (s) => { const c = String(s || '').replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{11,16}$/.test(c) ? c : null; };
const normPiva = (s) => { const c = String(s || '').replace(/\D/g, ''); return c.length === 11 ? c : null; };
const validEmail = (e) => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
const tokens = (s) => normName(s).split(' ').filter((t) => t.length >= 3);
const T_STATUS = ['ATTIVO', 'SOSPESO', 'CONCLUSO'];
const ORG_KINDS = ['TARGET', 'SOCIETA'];

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
    const hits = index.get(crit, value);
    for (const id of hits) if (!cand.includes(id)) cand.push(id);
    if (!proposal && hits.length === 1) proposal = { id: hits[0], label: labelOf(hits[0]), score, how };
  }
  return { proposal, candidates: cand };
}
// Candidati ulteriori per somiglianza del nome (parole in comune), per la scelta manuale
function similar(name, rows, nameOf, limit = 6) {
  const t = tokens(name); if (!t.length) return [];
  return rows.map((r) => ({ id: r.id, n: tokens(nameOf(r)).filter((x) => t.includes(x)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, limit).map((x) => x.id);
}

const orgLabel = (o) => [o.name, o.vat_number ? `· P.IVA ${o.vat_number}` : null, o.city ? `(${o.city})` : null, o.kind === 'SOCIETA' ? '· società del gruppo (già integrata)' : null, o.active ? null : '· non attiva'].filter(Boolean).join(' ');
const personLabel = (p) => [`${p.last_name} ${p.first_name}`, p.job_title ? `· ${p.job_title}` : null, p.email ? `· ${p.email}` : null, p.status === 'CESSATO' ? '· cessata' : null].filter(Boolean).join(' ');

// Legal entity tra cui abbinare le target: quelle da integrare (TARGET) e, per le acquisizioni concluse, le società del gruppo (SOCIETA)
async function suiteOrgs() {
  return suiteMany(`SELECT id, kind, code, name, vat_number, tax_code, email, pec, city, active, legacy_refs->>'${KEY}' AS ref
    FROM public.organizations WHERE kind = ANY($1::text[]) ORDER BY (kind = 'TARGET') DESC, active DESC, lower(name)`, [ORG_KINDS]);
}
async function suitePeople() {
  return suiteMany(`SELECT id, last_name, first_name, email, tax_code, job_title, status, legacy_refs->>'${KEY}' AS ref FROM public.people ORDER BY (status = 'CESSATO'), lower(last_name), lower(first_name)`);
}

const LEGACY_TARGETS_SQL = 'SELECT * FROM public.targets';
const LEGACY_TEAM_SQL = 'SELECT * FROM public.team';
const LEGACY_USERS_SQL = 'SELECT id, email, full_name FROM public.users';

// email delle persone del team: il registro team dell'app ha solo ruolo, funzione e nome; l'email arriva dall'utente dell'app con lo stesso nome
function teamEmails(member, users) {
  const n = normName(member.n); if (!n) return [];
  const parts = n.split(' ');
  const rev = parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0]}` : null;   // "Nome Cognome" ↔ "Cognome Nome"
  const out = [];
  for (const u of users) {
    const un = normName(u.full_name);
    if (un && (un === n || un === rev) && validEmail(lower(u.email))) out.push(lower(u.email));
  }
  return [...new Set(out)];
}

export async function legacyMatch({ legacyQuery }) {
  // ---- target → Legal entity (TARGET prima, poi SOCIETA)
  const orgs = await suiteOrgs();
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const oi = new Index();
  for (const o of orgs) {
    oi.add('ref', o.ref, o.id);
    oi.add('piva', normPiva(o.vat_number), o.id);
    oi.add('cf', normCf(o.tax_code), o.id);
    oi.add('code', lower(o.code), o.id);
    oi.add('email', lower(o.email), o.id);
    oi.add('email', lower(o.pec), o.id);
    oi.add('name', normName(o.name), o.id);
  }
  const targets = await legacyQuery(`${LEGACY_TARGETS_SQL} ORDER BY position, id`);
  const kindFirst = (ids) => [...ids].sort((a, b) => (orgById.get(a)?.kind === 'TARGET' ? 0 : 1) - (orgById.get(b)?.kind === 'TARGET' ? 0 : 1));
  const outOrgs = targets.map((t) => {
    const nome = clean(t.nome), rs = clean(t.rs);
    const crit = [
      { crit: 'ref', value: String(t.id), score: 100, how: 'già abbinata in una importazione precedente' },
      { crit: 'piva', value: normPiva(t.piva), score: 95, how: 'stessa partita IVA' },
      { crit: 'cf', value: normCf(t.piva), score: 90, how: 'stesso codice fiscale' },
      { crit: 'email', value: lower(t.pec), score: 85, how: 'stessa PEC' },
      { crit: 'email', value: lower(t.mail), score: 80, how: 'stessa email' },
      { crit: 'name', value: normName(nome), score: 70, how: 'stessa denominazione' },
      { crit: 'name', value: normName(rs), score: 70, how: 'stessa ragione sociale' },
    ];
    const { proposal, candidates } = propose(oi, crit, (id) => orgLabel(orgById.get(id)));
    for (const id of similar([nome, rs].filter(Boolean).join(' '), orgs, (r) => r.name)) if (!candidates.includes(id)) candidates.push(id);
    return {
      legacy_id: String(t.id), label: [nome || rs || `target ${t.id}`, rs && rs !== nome ? `(${rs})` : null].filter(Boolean).join(' '),
      detail: [t.piva ? `P.IVA ${t.piva}` : null, clean(t.ind), t.closing ? `closing ${t.closing}` : null].filter(Boolean).join(' · ') || null,
      proposal, candidates: kindFirst(candidates).map((id) => ({ id, label: orgLabel(orgById.get(id)) })),
    };
  });

  // ---- persone del team → persone della Suite
  const people = await suitePeople();
  const personById = new Map(people.map((p) => [p.id, p]));
  const pi = new Index();
  for (const p of people) {
    pi.add('ref', p.ref, p.id);
    pi.add('email', lower(p.email), p.id);
    pi.add('name', normName(`${p.last_name} ${p.first_name}`), p.id);
    pi.add('name', normName(`${p.first_name} ${p.last_name}`), p.id);
  }
  const team = await legacyQuery(`${LEGACY_TEAM_SQL} ORDER BY position, id`);
  const users = await legacyQuery(LEGACY_USERS_SQL);
  const outPeople = team.map((m) => {
    const emails = teamEmails(m, users);
    const crit = [
      { crit: 'ref', value: String(m.id), score: 100, how: 'già abbinata in una importazione precedente' },
      ...emails.map((e) => ({ crit: 'email', value: e, score: 90, how: 'stessa email' })),
      { crit: 'name', value: normName(m.n), score: 70, how: 'stesso nome' },
    ];
    const { proposal, candidates } = propose(pi, crit, (id) => personLabel(personById.get(id)));
    for (const id of similar(m.n, people, (r) => `${r.last_name} ${r.first_name}`)) if (!candidates.includes(id)) candidates.push(id);
    return {
      legacy_id: String(m.id), label: clean(m.n) || `persona ${m.id}`,
      detail: [clean(m.r), clean(m.f), emails[0]].filter(Boolean).join(' · ') || null,
      proposal, candidates: candidates.map((id) => ({ id, label: personLabel(personById.get(id)) })),
    };
  });

  // ---- tabelle con il numero di righe
  const tables = [];
  for (const t of ['targets', 'team', 'activities', 'snapshots', 'audit_log']) {
    const r = await legacyQuery(`SELECT count(*)::int AS n FROM public."${t}"`);
    tables.push({ table: t, rows: r[0].n });
  }
  return {
    entities: { sites: [], people: outPeople, organizations: outOrgs },
    tables,
    catalog: { organizations: orgs.map((o) => ({ id: o.id, label: orgLabel(o), kind: o.kind, active: o.active })) },
    warnings: [],
  };
}

// ---------------------------------------------------------------- importazione
const BATCH = 200, BATCH_HEAVY = 20;
// Colonne degli utenti dell'app (updated_by, created_by): NULL, gli accessi sono della Suite. Nel registro (audit_log) l'utente si
// ritrova nella tabella users del modulo per email, quando esiste (chi ha già aperto il modulo nella Suite).

export async function legacyImport({ legacyQueryLong, mapping, dryRun }) {
  const stats = {}; const skipped = []; const warnings = [];
  const st = (t) => (stats[t] ||= { copied: 0, skipped: 0, existing: 0 });
  const skip = (table, legacyId, reason) => { st(table).skipped++; skipped.push({ table, legacy_id: String(legacyId), reason }); };

  // ---- abbinamenti confermati: validi, senza doppioni
  const orgs = await suiteOrgs(); const orgById = new Map(orgs.map((o) => [o.id, o]));
  const people = await suitePeople(); const personOk = new Set(people.map((p) => p.id));
  const orgMap = new Map(); const personMap = new Map();
  const usedOrg = new Map(); const usedPerson = new Map();
  for (const [lid, oid] of Object.entries(mapping.organizations || {})) {
    if (!orgById.has(oid)) { warnings.push(`Target ${lid}: la Legal entity scelta nella Suite (${oid}) non esiste o non è di tipo TARGET / SOCIETA: abbinamento ignorato`); continue; }
    if (usedOrg.has(oid)) throw new Error(`La stessa Legal entity della Suite (${oid}) è abbinata a due target dell'app originale (${usedOrg.get(oid)} e ${lid}): correggi l'abbinamento`);
    usedOrg.set(oid, lid); orgMap.set(String(lid), oid);
  }
  for (const [lid, pid] of Object.entries(mapping.people || {})) {
    if (!personOk.has(pid)) { warnings.push(`Persona ${lid}: la persona scelta nella Suite (${pid}) non esiste: abbinamento ignorato`); continue; }
    if (usedPerson.has(pid)) throw new Error(`La stessa persona della Suite (${pid}) è abbinata a due persone del team dell'app originale (${usedPerson.get(pid)} e ${lid}): correggi l'abbinamento`);
    usedPerson.set(pid, lid); personMap.set(String(lid), pid);
  }
  const org = (v) => (v == null ? null : orgMap.get(String(v)) ?? null);
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

    // ---- 0) legacy_refs sulle righe abbinate dell'anagrafica unica: un'importazione successiva riconosce gli abbinamenti
    for (const [lid, oid] of orgMap) await client.query(`UPDATE public.organizations SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || jsonb_build_object($1::text, $2::text), updated_at = now() WHERE id = $3 AND coalesce(legacy_refs->>$1, '') <> $2`, [KEY, lid, oid]);
    for (const [lid, pid] of personMap) await client.query(`UPDATE public.people SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || jsonb_build_object($1::text, $2::int), updated_at = now() WHERE id = $3 AND coalesce(legacy_refs->>$1, '') <> $2::text`, [KEY, Number(lid), pid]);
    stats.abbinamenti = { copied: orgMap.size + personMap.size, skipped: 0, existing: 0, sedi: 0, persone: personMap.size, organizzazioni: orgMap.size };

    // ---- 1) target: i campi del piano in org_ext (nome, P.IVA, indirizzo e contatti restano quelli della Legal entity)
    const existingExt = new Set((await client.query('SELECT org_id FROM org_ext')).rows.map((r) => r.org_id));
    const targets = await legacyQueryLong(`${LEGACY_TARGETS_SQL} ORDER BY position, id`);
    const targetName = new Map(targets.map((t) => [String(t.id), clean(t.nome) || clean(t.rs) || `target ${t.id}`]));
    let tpos = existingExt.size;
    for (const t of targets) {
      const oid = org(t.id); const nome = targetName.get(String(t.id));
      if (!oid) { skip('parametri_del_piano', t.id, `target "${nome}" non abbinata a una Legal entity della Suite`); continue; }
      const o = orgById.get(oid);
      if (o.kind !== 'TARGET') warnings.push(`Target "${nome}": la Legal entity "${o.name}" è già una società del gruppo (tipo ${o.kind}, acquisizione conclusa): il piano viene copiato ma resta consultabile in sola lettura`);
      if (already('targets', t.id)) { st('parametri_del_piano').existing++; continue; }
      if (existingExt.has(oid)) {
        skip('parametri_del_piano', t.id, `la Legal entity "${o.name}" ha già il piano avviato nella Suite: parametri del piano non sovrascritti`);
        warnings.push(`Target "${nome}": la Legal entity "${o.name}" ha già il piano avviato nella Suite; referente, date, valori e linee dell'app originale non sono stati importati (le attività mancanti sì)`);
        await remember('targets', t.id, oid);   // la target è abbinata: le attività e gli snapshot si importano comunque
        continue;
      }
      const status = T_STATUS.includes(t.status) ? t.status : 'ATTIVO';
      await client.query(
        `INSERT INTO org_ext (org_id, position, status, ref, fatt, pfn, ev, linee, loi, prelim, closing, hor, note, lm, version, updated_by, updated_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,$16,$17)`,
        [oid, Number.isFinite(Number(t.position)) ? Number(t.position) : tpos++, status, str(t.ref), str(t.fatt), str(t.pfn), str(t.ev), json(Array.isArray(t.linee) ? t.linee.map(String) : []),
          str(t.loi), str(t.prelim), str(t.closing), Math.max(8, Math.min(52, Number(t.hor) || 24)), str(t.note), Number(t.lm) || 0, Number(t.version) || 1, t.updated_at || new Date(), t.created_at || new Date()]);
      await remember('targets', t.id, oid); st('parametri_del_piano').copied++;
    }
    const targetImported = (lid) => Boolean(already('targets', lid));
    const targetReason = (lid) => (targetName.has(String(lid)) ? `target "${targetName.get(String(lid))}" non abbinata` : 'target non più presente nell\'app originale');

    // ---- 2) team: ruolo nel piano in person_ext (nome, email e stato restano quelli della persona della Suite)
    const existingPx = new Set((await client.query('SELECT person_id FROM person_ext')).rows.map((r) => r.person_id));
    const team = await legacyQueryLong(`${LEGACY_TEAM_SQL} ORDER BY position, id`);
    let ppos = existingPx.size;
    for (const m of team) {
      const pid = person(m.id); const name = clean(m.n) || `persona ${m.id}`;
      if (!pid) { skip('team_di_integrazione', m.id, `persona del team "${name}" (${clean(m.r) || 'senza ruolo'}) non abbinata a una persona della Suite`); continue; }
      if (already('team', m.id)) { st('team_di_integrazione').existing++; continue; }
      if (existingPx.has(pid)) {
        skip('team_di_integrazione', m.id, `la persona "${name}" fa già parte del team nella Suite: ruolo non sovrascritto`);
        warnings.push(`Persona "${name}": già nel team di integrazione della Suite, il ruolo "${clean(m.r) || ''}" dell'app originale non è stato importato`);
        await remember('team', m.id, pid);
        continue;
      }
      const f = /estern/i.test(str(m.f)) ? 'Esterna' : 'Interna';
      await client.query('INSERT INTO person_ext (person_id, position, r, f, color, lm) VALUES ($1,$2,$3,$4,$5,$6)',
        [pid, Number.isFinite(Number(m.position)) ? Number(m.position) : ppos++, str(m.r), f, clean(m.color) || null, Number(m.lm) || 0]);
      await remember('team', m.id, pid); st('team_di_integrazione').copied++;
    }
    // owner e support delle attività dell'app: id del registro team, oppure ruolo o nome del registro → persona della Suite abbinata
    const teamById = new Map(team.map((m) => [String(m.id), m]));
    const teamByKey = new Map();
    for (const m of team) { for (const k of [normName(m.r), normName(m.n)]) if (k && !teamByKey.has(k)) teamByKey.set(k, m); }
    const unresolvedOwners = new Map();   // valore dell'app → numero di attività
    const resolveOwner = (v) => {
      const s = clean(v); if (!s) return { pid: null, value: null };
      const m = teamById.get(s) || teamByKey.get(normName(s)) || null;
      const pid = m ? person(m.id) : null;
      return { pid, value: s, known: Boolean(m) };
    };
    const noteOwner = (value) => unresolvedOwners.set(value, (unresolvedOwners.get(value) || 0) + 1);
    const translateAct = (a, count = true) => {
      let ownerVals = [a.owner]; let supportVals = Array.isArray(a.support) ? a.support : [];
      if (Array.isArray(a.owners)) { ownerVals = [a.owners[0]]; supportVals = a.owners.slice(1); }
      const o = resolveOwner(ownerVals[0]);
      if (o.value && !o.pid && count) noteOwner(o.value);
      const support = [];
      for (const v of supportVals) {
        const r = resolveOwner(v);
        if (r.value && !r.pid) { if (count) noteOwner(r.value); continue; }
        if (r.pid && r.pid !== o.pid && !support.includes(r.pid)) support.push(r.pid);
      }
      return { owner: o.pid, support };
    };

    // ---- 3) attività (l'id è univoco dentro la target: una riga già presente nella Suite con lo stesso id non si tocca)
    const existingActs = new Set((await client.query('SELECT target_id, id FROM activities')).rows.map((r) => `${r.target_id}|${r.id}`));
    await scan('SELECT * FROM public.activities', 'target_id, position, id', BATCH, async (rows) => {
      for (const a of rows) {
        const lid = `${a.target_id}|${a.id}`; const oid = org(a.target_id);
        const label = `attività ${a.cid || a.id} della target "${targetName.get(String(a.target_id)) || a.target_id}"`;
        if (!oid || !targetImported(a.target_id)) { skip('attività', lid, `${label}: ${targetReason(a.target_id)}`); continue; }
        if (already('activities', lid)) { st('attività').existing++; continue; }
        if (existingActs.has(`${oid}|${a.id}`)) { skip('attività', lid, `${label}: nella Suite esiste già un'attività con lo stesso id (${a.id}) in questa target: non sovrascritta`); continue; }
        const { owner, support } = translateAct(a);
        await client.query(
          `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner_id, dett, note, st, pl, ms, fine, lm, version, updated_by, updated_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,$18,$19)`,
          [oid, String(a.id), Number(a.position) || 0, str(a.cid), a.nome == null || a.nome === '' ? null : json(a.nome), str(a.proc) || 'ops', Math.max(0, Number(a.sw) || 0), Math.max(0, Number(a.ew) || 0), owner,
            str(a.dett), str(a.note), Math.max(0, Math.min(3, Number(a.st) || 0)), Boolean(a.pl), Boolean(a.ms), str(a.fine), Number(a.lm) || 0, Number(a.version) || 1, a.updated_at || new Date(), a.created_at || new Date()]);
        for (let i = 0; i < support.length; i++) await client.query('INSERT INTO activity_support (target_id, activity_id, person_id, position) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [oid, String(a.id), support[i], i]);
        existingActs.add(`${oid}|${a.id}`);
        await remember('activities', lid, `${oid}|${a.id}`); st('attività').copied++;
      }
    });

    // ---- 4) snapshot del piano: target, owner e team tradotti (formato v3 della Suite); le target non abbinate escono dallo snapshot
    const translateSnapshot = (data) => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.targets)) return { data, dropped: [] };
      const dropped = [];
      const targetsOut = [];
      for (const t of data.targets) {
        if (!t || typeof t !== 'object') continue;
        const oid = org(t.id);
        if (!oid) { dropped.push(clean(t.nome) || clean(t.rs) || String(t.id)); continue; }
        const o = orgById.get(oid);
        const atts = (Array.isArray(t.atts) ? t.atts : []).map((a) => {
          if (!a || typeof a !== 'object') return a;
          const { owner, support } = translateAct(a, false);
          const out = { ...a, target_id: oid, owner, support };
          delete out.owners;
          return out;
        });
        targetsOut.push({ ...t, id: oid, legacy_id: String(t.id), nome: o.name, rs: o.name, piva: o.vat_number || '', atts, status: T_STATUS.includes(t.status) ? t.status : 'ATTIVO', note: str(t.note) });
      }
      const teamOut = [];
      for (const m of Array.isArray(data.team) ? data.team : []) {
        if (!m || typeof m !== 'object') continue;
        // nello snapshot dell'app il team non ha id: la persona si ritrova nel registro team per nome o ruolo
        const tm = teamById.get(String(m.id ?? '')) || teamByKey.get(normName(m.n)) || teamByKey.get(normName(m.r)) || null;
        const pid = tm ? person(tm.id) : null; if (!pid) continue;
        teamOut.push({ person_id: pid, position: Number(m.position) || 0, r: str(m.r), f: /estern/i.test(str(m.f)) ? 'Esterna' : 'Interna', color: clean(m.color) || null, lm: Number(m.lm) || 0, n: str(m.n) });
      }
      return { data: { ...data, v: 3, targets: targetsOut, team: teamOut, legacy: { v: data.v ?? null, app: 'originale', target_non_abbinate: dropped } }, dropped };
    };
    const snapDropped = new Map();   // nome della target → numero di snapshot da cui è stata tolta
    await scan('SELECT * FROM public.snapshots', 'id', BATCH_HEAVY, async (rows) => {
      for (const s of rows) {
        if (already('snapshots', s.id)) { st('snapshot').existing++; continue; }
        const { data, dropped } = translateSnapshot(s.data);
        for (const n of dropped) snapDropped.set(n, (snapDropped.get(n) || 0) + 1);
        const r = await client.query('INSERT INTO snapshots (kind, note, data, created_by, created_at) VALUES ($1,$2,$3,NULL,$4) RETURNING id',
          [str(s.kind) || 'manual', [clean(s.note), 'dall\'app originale'].filter(Boolean).join(' · '), json(data), s.created_at || new Date()]);
        await remember('snapshots', s.id, r.rows[0].id); st('snapshot').copied++;
      }
    });
    for (const [n, c] of snapDropped) warnings.push(`Snapshot: la target "${n}" non è abbinata ed è stata tolta da ${c} snapshot copiati`);

    // ---- 5) registro delle modifiche (audit_log): l'utente si ritrova per email tra gli utenti del modulo, la target si traduce
    const legacyUsers = await legacyQueryLong(LEGACY_USERS_SQL);
    const moduleUsers = new Map((await client.query('SELECT id, lower(email) AS email FROM users')).rows.map((u) => [u.email, u.id]));
    const userByLegacy = new Map(legacyUsers.map((u) => [String(u.id), moduleUsers.get(lower(u.email)) || null]));
    await scan('SELECT * FROM public.audit_log', 'id', BATCH, async (rows) => {
      for (const l of rows) {
        if (already('audit_log', l.id)) { st('registro_delle_modifiche').existing++; continue; }
        let tid = null;
        if (l.target_id != null && l.target_id !== '') { tid = org(l.target_id); if (!tid) { skip('registro_delle_modifiche', l.id, `${l.action}: ${targetReason(l.target_id)}`); continue; } }
        let entityId = l.entity_id;
        if (l.entity === 'target' && entityId != null) entityId = org(entityId) != null ? String(org(entityId)) : entityId;
        if (l.entity === 'activity' && typeof entityId === 'string' && entityId.includes('/')) {   // "target/attività"
          const [t, ...rest] = entityId.split('/'); if (org(t) != null) entityId = `${org(t)}/${rest.join('/')}`;
        }
        const r = await client.query('INSERT INTO audit_log (user_id, action, entity, entity_id, target_id, label, data, ip, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [l.user_id == null ? null : userByLegacy.get(String(l.user_id)) || null, l.action, l.entity, entityId, tid == null ? null : String(tid), l.label, l.data == null ? null : json(l.data), l.ip, l.at || new Date()]);
        await remember('audit_log', l.id, r.rows[0].id); st('registro_delle_modifiche').copied++;
      }
    });

    // owner e support dell'app non abbinati: le attività sono state copiate senza quella persona (non saltate)
    for (const [value, n] of unresolvedOwners) {
      const known = teamById.has(value) || teamByKey.has(normName(value));
      warnings.push(known
        ? `Owner / support "${value}": la persona del team non è abbinata a una persona della Suite, ${n} ${n === 1 ? 'attività copiata' : 'attività copiate'} senza di lei (da assegnare nel piano)`
        : `Owner / support "${value}": non corrisponde a nessuna persona del registro team dell'app originale, ${n} ${n === 1 ? 'attività copiata' : 'attività copiate'} senza di lei (da assegnare nel piano)`);
    }

    if (dryRun) await client.query('ROLLBACK'); else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }

  // riepilogo leggibile
  if (!orgMap.size) warnings.unshift('Nessuna target abbinata: parametri del piano, attività e snapshot non possono essere importati');
  if (!personMap.size) warnings.unshift('Nessuna persona del team abbinata: il team resta vuoto e le attività arrivano senza owner');
  return { stats, skipped, warnings: [...new Set(warnings)], dryRun: Boolean(dryRun) };
}
