// Accesso al piano: lettura completa, mappatura righe <-> oggetti del motore, snapshot, import.
import { many, one, q, tx } from '../db.js';

export const T_FIELDS = ['nome', 'rs', 'ind', 'piva', 'ref', 'tel', 'mail', 'web', 'pec', 'fatt', 'pfn', 'ev', 'linee', 'loi', 'prelim', 'closing', 'hor', 'lm'];
export const A_FIELDS = ['cid', 'nome', 'proc', 'sw', 'ew', 'owner', 'support', 'dett', 'note', 'st', 'pl', 'ms', 'fine', 'lm'];

export const FIELD_LABELS = {
  nome: 'nome', rs: 'ragione sociale', ind: 'indirizzo', piva: 'P.IVA', ref: 'referente', tel: 'telefono', mail: 'email', web: 'sito', pec: 'PEC',
  fatt: 'fatturato', pfn: 'PFN', ev: 'EV', linee: 'linee di attività', loi: 'LOI', prelim: 'preliminare', closing: 'closing', hor: 'orizzonte',
  cid: 'codice', proc: 'processo', sw: 'settimana inizio', ew: 'settimana fine', owner: 'owner', support: 'support', dett: 'dettaglio', note: 'note',
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

export function targetRowToObj(r) {
  return {
    id: r.id, nome: r.nome, rs: r.rs, ind: r.ind, piva: r.piva, ref: r.ref, tel: r.tel, mail: r.mail, web: r.web, pec: r.pec,
    fatt: numOrEmpty(r.fatt), pfn: numOrEmpty(r.pfn), ev: numOrEmpty(r.ev), linee: r.linee || [],
    loi: r.loi, prelim: r.prelim, closing: r.closing, hor: r.hor, lm: r.lm || 0, version: r.version, position: r.position,
    updated_at: r.updated_at, updated_by: r.updated_by,
  };
}
export function actRowToObj(r) {
  return {
    id: r.id, target_id: r.target_id, cid: r.cid, nome: r.nome ?? null, proc: r.proc, sw: r.sw, ew: r.ew, owner: r.owner,
    support: r.support || [], dett: r.dett, note: r.note, st: r.st, pl: r.pl, ms: r.ms, fine: r.fine, lm: r.lm || 0,
    version: r.version, position: r.position, updated_at: r.updated_at, updated_by: r.updated_by,
  };
}

// normalizzazione dei valori in ingresso (dal client o da un file importato)
export function normTarget(o) {
  return {
    nome: str(o.nome), rs: str(o.rs), ind: str(o.ind), piva: str(o.piva), ref: str(o.ref), tel: str(o.tel), mail: str(o.mail), web: str(o.web), pec: str(o.pec),
    fatt: str(numOrEmpty(o.fatt)), pfn: str(numOrEmpty(o.pfn)), ev: str(numOrEmpty(o.ev)),
    linee: Array.isArray(o.linee) ? o.linee.map(String) : [],
    loi: str(o.loi), prelim: str(o.prelim), closing: str(o.closing), hor: Math.max(8, Math.min(52, int(o.hor, 24))), lm: int(o.lm, 0),
  };
}
export function normAct(a) {
  let support = Array.isArray(a.support) ? a.support.map(String) : [];
  let owner = str(a.owner);
  if (Array.isArray(a.owners)) { owner = str(a.owners[0]); support = a.owners.slice(1).map(String); }
  let nome = a.nome;
  if (nome === undefined || nome === '' ) nome = null;
  if (nome !== null && typeof nome !== 'string' && typeof nome !== 'object') nome = String(nome);
  const st = Math.max(0, Math.min(3, int(a.st, 0)));
  return {
    cid: str(a.cid), nome, proc: str(a.proc) || 'ops', sw: Math.max(0, int(a.sw, 0)), ew: Math.max(0, int(a.ew, 0)), owner, support,
    dett: str(a.dett), note: str(a.note), st, pl: Boolean(a.pl), ms: Boolean(a.ms), fine: str(a.fine), lm: int(a.lm, 0),
  };
}

export async function readPlan() {
  const targets = (await many('SELECT * FROM targets ORDER BY position, created_at')).map(targetRowToObj);
  const acts = (await many('SELECT * FROM activities ORDER BY target_id, position, created_at')).map(actRowToObj);
  const byT = new Map(targets.map((t) => [t.id, t]));
  for (const t of targets) t.atts = [];
  for (const a of acts) byT.get(a.target_id)?.atts.push(a);
  const team = await many('SELECT id, position, r, f, n, lm FROM team ORDER BY position, id');
  return { targets, team, meta: await readMeta() };
}

export async function readMeta() {
  const n = await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity IN ('activity','target','team','plan')`);
  const log = await many(
    `SELECT a.id, a.at, a.label, a.action, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity IN ('activity','target','team','plan') ORDER BY a.at DESC, a.id DESC LIMIT 10`);
  return { rev: n.n, log: log.map((l) => ({ rev: l.id, by: l.full_name || 'sistema', at: l.at, what: l.label || l.action })) };
}

// snapshot integrale (JSON) del piano
export async function takeSnapshot(kind, note, userId, client) {
  const runner = client ? (t, p) => client.query(t, p) : q;
  const targets = (await runner('SELECT * FROM targets ORDER BY position')).rows.map(targetRowToObj);
  const acts = (await runner('SELECT * FROM activities ORDER BY target_id, position')).rows.map(actRowToObj);
  for (const t of targets) t.atts = acts.filter((a) => a.target_id === t.id);
  const team = (await runner('SELECT position, r, f, n, lm FROM team ORDER BY position, id')).rows;
  const data = { v: 2, takenAt: new Date().toISOString(), targets, team };
  const r = await runner('INSERT INTO snapshots (kind, note, data, created_by) VALUES ($1,$2,$3,$4) RETURNING id, created_at', [kind, note || null, JSON.stringify(data), userId || null]);
  return r.rows[0];
}

// Import/merge di uno stato completo (file dell'app originale, XLSX con foglio _dati, snapshot):
// target e attività con lm più recente sostituiscono le attuali; le nuove vengono aggiunte; nulla viene cancellato.
export async function importPlan(state, { userId, replace = false } = {}) {
  const rep = { tN: 0, tU: 0, aN: 0, aU: 0, team: 0 };
  await tx(async (c) => {
    await takeSnapshot(replace ? 'pre-restore' : 'pre-import', null, userId, c);
    if (replace) { await c.query('DELETE FROM activities'); await c.query('DELETE FROM targets'); await c.query('DELETE FROM team'); }
    const curT = new Map((await c.query('SELECT * FROM targets')).rows.map((r) => [r.id, r]));
    const curA = new Map((await c.query('SELECT * FROM activities')).rows.map((r) => [`${r.target_id}|${r.id}`, r]));
    let tpos = curT.size;
    for (const t of state.targets || []) {
      if (!t || !t.id) continue;
      const nt = normTarget(t);
      const ex = curT.get(t.id);
      if (!ex) {
        await c.query(
          `INSERT INTO targets (id, position, nome, rs, ind, piva, ref, tel, mail, web, pec, fatt, pfn, ev, linee, loi, prelim, closing, hor, lm, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [t.id, t.position ?? tpos++, nt.nome, nt.rs, nt.ind, nt.piva, nt.ref, nt.tel, nt.mail, nt.web, nt.pec, nt.fatt, nt.pfn, nt.ev,
            JSON.stringify(nt.linee), nt.loi, nt.prelim, nt.closing, nt.hor, nt.lm, userId || null]);
        rep.tN++;
      } else if (replace || (nt.lm || 0) > (ex.lm || 0)) {
        await c.query(
          `UPDATE targets SET nome=$2, rs=$3, ind=$4, piva=$5, ref=$6, tel=$7, mail=$8, web=$9, pec=$10, fatt=$11, pfn=$12, ev=$13, linee=$14,
             loi=$15, prelim=$16, closing=$17, hor=$18, lm=$19, version=version+1, updated_by=$20, updated_at=now() WHERE id=$1`,
          [t.id, nt.nome, nt.rs, nt.ind, nt.piva, nt.ref, nt.tel, nt.mail, nt.web, nt.pec, nt.fatt, nt.pfn, nt.ev, JSON.stringify(nt.linee),
            nt.loi, nt.prelim, nt.closing, nt.hor, nt.lm, userId || null]);
        rep.tU++;
      }
      let apos = [...curA.values()].filter((a) => a.target_id === t.id).length;
      for (const a of t.atts || []) {
        if (!a || !a.id) continue;
        const na = normAct(a);
        const k = `${t.id}|${a.id}`;
        const exa = curA.get(k);
        if (!exa) {
          await c.query(
            `INSERT INTO activities (target_id, id, position, cid, nome, proc, sw, ew, owner, support, dett, note, st, pl, ms, fine, lm, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [t.id, a.id, a.position ?? apos++, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner,
              JSON.stringify(na.support), na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, userId || null]);
          rep.aN++;
        } else if (replace || (na.lm || 0) > (exa.lm || 0)) {
          await c.query(
            `UPDATE activities SET cid=$3, nome=$4, proc=$5, sw=$6, ew=$7, owner=$8, support=$9, dett=$10, note=$11, st=$12, pl=$13, ms=$14, fine=$15, lm=$16,
               version=version+1, updated_by=$17, updated_at=now() WHERE target_id=$1 AND id=$2`,
            [t.id, a.id, na.cid, na.nome === null ? null : JSON.stringify(na.nome), na.proc, na.sw, na.ew, na.owner, JSON.stringify(na.support),
              na.dett, na.note, na.st, na.pl, na.ms, na.fine, na.lm, userId || null]);
          rep.aU++;
        }
      }
    }
    // team: aggiunta dei ruoli mancanti (per ruolo)
    const curTeam = new Map((await c.query('SELECT * FROM team')).rows.map((r) => [r.r, r]));
    let pos = curTeam.size;
    for (const m of state.team || []) {
      if (!m || !m.r) continue;
      const ex = curTeam.get(m.r);
      if (!ex) { await c.query('INSERT INTO team (position, r, f, n, lm) VALUES ($1,$2,$3,$4,$5)', [m.position ?? pos++, m.r, m.f || 'Interna', m.n || '', int(m.lm, 0)]); rep.team++; }
      else if ((int(m.lm, 0)) > (ex.lm || 0)) { await c.query('UPDATE team SET f=$2, n=$3, lm=$4 WHERE id=$1', [ex.id, m.f || ex.f, m.n ?? ex.n, int(m.lm, 0)]); rep.team++; }
    }
  });
  return rep;
}
