// Accesso al piano: lettura completa, mappatura righe <-> oggetti del motore, snapshot, ripristino.
// Anagrafica unica: le target sono TUTTE le Legal entity public.organizations di tipo TARGET; il modulo conserva solo i
// parametri del piano in org_ext (org_id -> public.organizations). Una target senza riga org_ext è "da avviare"
// (configured=false); una target con piano il cui tipo è diventato SOCIETA è "integrata" (integrated=true, sola lettura).
// Owner e support delle attività sono public.people; il team è person_ext (ruolo nel piano) sulle persone della Suite.
import { many, one, q, tx } from '../db.js';

// campi del piano modificabili dal modulo (gli altri dati della target vengono da public.organizations)
export const T_FIELDS = ['ref', 'fatt', 'pfn', 'ev', 'linee', 'loi', 'prelim', 'closing', 'hor', 'note', 'status', 'lm'];
export const A_FIELDS = ['cid', 'nome', 'proc', 'sw', 'ew', 'owner', 'support', 'dett', 'note', 'st', 'pl', 'ms', 'fine', 'lm'];
export const T_STATUS = ['ATTIVO', 'SOSPESO', 'CONCLUSO'];

export const FIELD_LABELS = {
  nome: 'nome', ref: 'referente', fatt: 'fatturato', pfn: 'PFN', ev: 'EV', linee: 'linee di attività', loi: 'LOI', prelim: 'preliminare', closing: 'closing',
  hor: 'orizzonte', note: 'note', status: 'stato del piano',
  cid: 'codice', proc: 'processo', sw: 'settimana inizio', ew: 'settimana fine', owner: 'owner', support: 'support', dett: 'dettaglio',
  st: 'stato', pl: 'P&L', ms: 'milestone', fine: 'data fine effettiva', position: 'ordine',
};
export const STATUS_LABELS = { 0: 'da iniziare', 1: 'in corso', 2: 'completata', 3: 'bloccata' };

const numOrEmpty = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
};
const str = (v) => (v === null || v === undefined ? '' : String(v));
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const personId = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const personIds = (arr) => {
  const out = [];
  for (const v of Array.isArray(arr) ? arr : []) { const n = personId(v); if (n && !out.includes(n)) out.push(n); }
  return out;
};

export function targetRowToObj(r) {
  return {
    id: r.id, kind: r.kind, code: r.code, nome: r.nome, rs: r.rs, ind: r.ind, piva: r.piva, tel: r.tel, mail: r.mail, web: r.web, pec: r.pec,
    ref: r.ref, fatt: numOrEmpty(r.fatt), pfn: numOrEmpty(r.pfn), ev: numOrEmpty(r.ev), linee: r.linee || [],
    loi: r.loi, prelim: r.prelim, closing: r.closing, hor: r.hor, note: r.note || '', status: r.status || 'ATTIVO',
    lm: Number(r.lm) || 0, version: r.version, position: r.position, updated_at: r.updated_at, updated_by: r.updated_by,
    active: r.active !== false, configured: r.configured !== false, integrated: r.integrated === true,
  };
}
export function actRowToObj(r) {
  return {
    id: r.id, target_id: r.target_id, cid: r.cid, nome: r.nome ?? null, proc: r.proc, sw: r.sw, ew: r.ew,
    owner: r.owner_id ?? null, support: (r.support || []).map(Number),
    dett: r.dett, note: r.note, st: r.st, pl: r.pl, ms: r.ms, fine: r.fine, lm: Number(r.lm) || 0,
    version: r.version, position: r.position, updated_at: r.updated_at, updated_by: r.updated_by,
  };
}

// normalizzazione dei valori in ingresso (dal client o da uno snapshot)
export function normTarget(o) {
  return {
    ref: str(o.ref), fatt: str(numOrEmpty(o.fatt)), pfn: str(numOrEmpty(o.pfn)), ev: str(numOrEmpty(o.ev)),
    linee: Array.isArray(o.linee) ? o.linee.map(String) : [],
    loi: str(o.loi), prelim: str(o.prelim), closing: str(o.closing), hor: Math.max(8, Math.min(52, int(o.hor, 24))),
    note: str(o.note), status: T_STATUS.includes(o.status) ? o.status : 'ATTIVO', lm: int(o.lm, 0),
  };
}
export function normAct(a) {
  let support = personIds(a.support);
  let owner = personId(a.owner);
  if (Array.isArray(a.owners)) { owner = personId(a.owners[0]); support = personIds(a.owners.slice(1)); }
  support = support.filter((p) => p !== owner);
  let nome = a.nome;
  if (nome === undefined || nome === '') nome = null;
  if (nome !== null && typeof nome !== 'string' && typeof nome !== 'object') nome = String(nome);
  const st = Math.max(0, Math.min(3, int(a.st, 0)));
  return {
    cid: str(a.cid), nome, proc: str(a.proc) || 'ops', sw: Math.max(0, int(a.sw, 0)), ew: Math.max(0, int(a.ew, 0)), owner, support,
    dett: str(a.dett), note: str(a.note), st, pl: Boolean(a.pl), ms: Boolean(a.ms), fine: str(a.fine), lm: int(a.lm, 0),
  };
}

// SELECT delle attività con il support aggregato (array di person_id ordinato)
export const ACT_SELECT = `SELECT a.*, coalesce((SELECT array_agg(s.person_id ORDER BY s.position, s.person_id) FROM activity_support s
  WHERE s.target_id = a.target_id AND s.activity_id = a.id), '{}'::int[]) AS support FROM activities a`;

export async function readTarget(id, client) {
  const runner = client ? (t, p) => client.query(t, p).then((r) => r.rows[0] || null) : one;
  return runner('SELECT * FROM targets_v WHERE id=$1', [id]);
}
// Target con il piano avviato e ancora modificabile: 404 se non è in anagrafica, 400 se il piano non è stato avviato
// o se la Legal entity non è più TARGET (acquisizione conclusa: il piano resta consultabile ma non si modifica).
export async function readEditableTarget(id, client) {
  const t = await readTarget(id, client);
  if (!t) throw Object.assign(new Error('Target non trovata'), { status: 404 });
  if (!t.configured) throw Object.assign(new Error(`Il piano di "${t.nome}" non è ancora stato avviato: usa "Avvia il piano" dalla scheda della società`), { status: 400 });
  if (t.integrated) throw Object.assign(new Error(`"${t.nome}" è ormai una società del gruppo (tipo ${t.kind}): il piano di integrazione è chiuso e resta consultabile`), { status: 400 });
  return t;
}
export async function readAct(tid, id, client) {
  const runner = client ? (t, p) => client.query(t, p).then((r) => r.rows[0] || null) : one;
  return runner(`${ACT_SELECT} WHERE a.target_id=$1 AND a.id=$2`, [tid, id]);
}

// owner e support devono esistere in public.people (altrimenti 400 con messaggio chiaro invece dell'errore di chiave esterna)
export async function assertPeople(ids, client) {
  const list = [...new Set(ids.filter((x) => x))];
  if (!list.length) return;
  const runner = client ? (t, p) => client.query(t, p).then((r) => r.rows) : many;
  const found = new Set((await runner('SELECT id FROM public.people WHERE id = ANY($1::int[])', [list])).map((p) => p.id));
  const missing = list.filter((i) => !found.has(i));
  if (missing.length) throw Object.assign(new Error(`Persona non trovata in anagrafica: ${missing.join(', ')}`), { status: 400 });
}

// scrive il support di un'attività (sostituzione completa)
export async function writeSupport(client, tid, aid, ids) {
  await client.query('DELETE FROM activity_support WHERE target_id=$1 AND activity_id=$2', [tid, aid]);
  for (let i = 0; i < ids.length; i++) {
    await client.query('INSERT INTO activity_support (target_id, activity_id, person_id, position) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [tid, aid, ids[i], i]);
  }
}

// persone citate dal piano (team + owner e support delle attività), per mostrare i nomi anche di chi non è più nel team
async function readPeople(runner) {
  return (await runner(`SELECT p.id, p.last_name || ' ' || p.first_name AS name, p.email, p.job_title, p.status,
      (x.person_id IS NOT NULL) AS in_team
    FROM public.people p LEFT JOIN person_ext x ON x.person_id = p.id
    WHERE x.person_id IS NOT NULL OR p.id IN (SELECT owner_id FROM activities WHERE owner_id IS NOT NULL UNION SELECT person_id FROM activity_support)
    ORDER BY lower(p.last_name), lower(p.first_name)`)).rows;
}
async function readTeam(runner) {
  return (await runner('SELECT person_id, position, r, f, color, lm, n, email, job_title, person_status FROM team_v ORDER BY position, lower(n)')).rows
    .map((m) => ({ ...m, lm: Number(m.lm) || 0 }));
}

export async function readPlan() {
  const runner = (t, p) => q(t, p);
  const targets = (await many('SELECT * FROM targets_v ORDER BY configured DESC, position, created_at, lower(nome)')).map(targetRowToObj);
  const acts = (await many(`${ACT_SELECT} ORDER BY a.target_id, a.position, a.created_at`)).map(actRowToObj);
  const byT = new Map(targets.map((t) => [t.id, t]));
  for (const t of targets) t.atts = [];
  for (const a of acts) byT.get(a.target_id)?.atts.push(a);
  return { targets, team: await readTeam(runner), people: await readPeople(runner), meta: await readMeta() };
}

export async function readMeta() {
  const n = await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity IN ('activity','target','team','plan')`);
  const log = await many(
    `SELECT a.id, a.at, a.label, a.action, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity IN ('activity','target','team','plan') ORDER BY a.at DESC, a.id DESC LIMIT 10`);
  return { rev: n.n, log: log.map((l) => ({ rev: l.id, by: l.full_name || 'sistema', at: l.at, what: l.label || l.action })) };
}

// snapshot integrale (JSON) del piano: target con piano avviato (org_id + parametri), attività con owner/support (person_id),
// team (person_id + ruolo). Le Legal entity TARGET senza piano non hanno dati del modulo e non entrano nello snapshot.
export async function takeSnapshot(kind, note, userId, client) {
  const runner = client ? (t, p) => client.query(t, p) : q;
  const targets = (await runner('SELECT * FROM targets_v WHERE configured ORDER BY position')).rows.map(targetRowToObj);
  const acts = (await runner(`${ACT_SELECT} ORDER BY a.target_id, a.position`)).rows.map(actRowToObj);
  for (const t of targets) t.atts = acts.filter((a) => a.target_id === t.id);
  const team = (await runner('SELECT person_id, position, r, f, color, lm, n FROM team_v ORDER BY position, lower(n)')).rows.map((m) => ({ ...m, lm: Number(m.lm) || 0 }));
  const data = { v: 3, takenAt: new Date().toISOString(), targets, team };
  const r = await runner('INSERT INTO snapshots (kind, note, data, created_by) VALUES ($1,$2,$3,$4) RETURNING id, created_at', [kind, note || null, JSON.stringify(data), userId || null]);
  return r.rows[0];
}

// Ripristino di uno snapshot (v3): le target il cui org_id non esiste più in anagrafica vengono scartate e contate;
// con replace=true il piano viene sostituito, altrimenti le righe più recenti (lm) aggiornano quelle attuali e le nuove si aggiungono.
export async function importPlan(state, { userId, replace = false } = {}) {
  const rep = { tN: 0, tU: 0, aN: 0, aU: 0, team: 0, scartate: 0 };
  if ((state?.v || 0) < 3) throw Object.assign(new Error('Snapshot di una versione precedente del modulo (target e persone non erano ancora quelle dell\'anagrafica unica): non ripristinabile'), { status: 400 });
  await tx(async (c) => {
    await takeSnapshot(replace ? 'pre-restore' : 'pre-import', null, userId, c);
    if (replace) { await c.query('DELETE FROM activities'); await c.query('DELETE FROM org_ext'); await c.query('DELETE FROM person_ext'); }
    const curT = new Map((await c.query('SELECT * FROM org_ext')).rows.map((r) => [r.org_id, r]));
    const curA = new Map((await c.query('SELECT * FROM activities')).rows.map((r) => [`${r.target_id}|${r.id}`, r]));
    const orgs = new Set((await c.query('SELECT id FROM public.organizations')).rows.map((r) => r.id));
    const people = new Set((await c.query('SELECT id FROM public.people')).rows.map((r) => r.id));
    const okPerson = (p) => (p && people.has(p) ? p : null);
    let tpos = curT.size;
    for (const t of state.targets || []) {
      const oid = personId(t?.id);
      if (!oid) continue;
      if (!orgs.has(oid)) { rep.scartate++; continue; }
      const nt = normTarget(t);
      const ex = curT.get(oid);
      if (!ex) {
        await c.query(
          `INSERT INTO org_ext (org_id, position, status, ref, fatt, pfn, ev, linee, loi, prelim, closing, hor, note, lm, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [oid, t.position ?? tpos++, nt.status, nt.ref, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee), nt.loi, nt.prelim, nt.closing, nt.hor, nt.note, nt.lm, userId || null]);
        rep.tN++;
      } else if (replace || (nt.lm || 0) > (Number(ex.lm) || 0)) {
        await c.query(
          `UPDATE org_ext SET status=$2, ref=$3, fatt=$4, pfn=$5, ev=$6, linee=$7, loi=$8, prelim=$9, closing=$10, hor=$11, note=$12, lm=$13,
             version=version+1, updated_by=$14, updated_at=now() WHERE org_id=$1`,
          [oid, nt.status, nt.ref, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee), nt.loi, nt.prelim, nt.closing, nt.hor, nt.note, nt.lm, userId || null]);
        rep.tU++;
      }
      let apos = [...curA.values()].filter((a) => a.target_id === oid).length;
      for (const a of t.atts || []) {
        if (!a || !a.id) continue;
        const na = normAct(a);
        na.owner = okPerson(na.owner); na.support = na.support.filter(okPerson);
        const k = `${oid}|${a.id}`;
        const exa = curA.get(k);
        if (!exa) {
          await c.query(
            `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner_id, dett, note, st, pl, ms, fine, lm, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [oid, String(a.id), a.position ?? apos++, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
              na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, userId || null]);
          await writeSupport(c, oid, String(a.id), na.support);
          rep.aN++;
        } else if (replace || (na.lm || 0) > (Number(exa.lm) || 0)) {
          await c.query(
            `UPDATE activities SET cid=$3, nome=$4, proc=$5, sw=$6, ew=$7, owner_id=$8, dett=$9, note=$10, st=$11, pl=$12, ms=$13, fine=$14, lm=$15,
               version=version+1, updated_by=$16, updated_at=now() WHERE target_id=$1 AND id=$2`,
            [oid, String(a.id), na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
              na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, userId || null]);
          await writeSupport(c, oid, String(a.id), na.support);
          rep.aU++;
        }
      }
    }
    // team: aggiunta delle persone mancanti (per person_id); chi non esiste più in anagrafica viene saltato
    const curTeam = new Map((await c.query('SELECT * FROM person_ext')).rows.map((r) => [r.person_id, r]));
    let pos = curTeam.size;
    for (const m of state.team || []) {
      const pid = personId(m?.person_id);
      if (!pid || !people.has(pid)) continue;
      const ex = curTeam.get(pid);
      const f = m.f === 'Esterna' ? 'Esterna' : 'Interna';
      if (!ex) { await c.query('INSERT INTO person_ext (person_id, position, r, f, color, lm) VALUES ($1,$2,$3,$4,$5,$6)', [pid, m.position ?? pos++, str(m.r), f, m.color || null, int(m.lm, 0)]); rep.team++; }
      else if (int(m.lm, 0) > (Number(ex.lm) || 0)) { await c.query('UPDATE person_ext SET r=$2, f=$3, color=$4, lm=$5 WHERE person_id=$1', [pid, str(m.r ?? ex.r), f, m.color || ex.color, int(m.lm, 0)]); rep.team++; }
    }
  });
  return rep;
}
