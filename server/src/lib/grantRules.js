// Regole di accesso: da afferenza, ruolo, tipo di sede e responsabilità alle proposte di moduli (grants.proposed = TRUE, source ORG).
// Si rivalutano quando nasce l'accesso, quando cambia la collocazione della persona e dal pulsante "Rigenera proposte".
import { one, many, q } from '../db.js';

const seedRules = [
  // tecnostruttura (per nome dell'unità: le regole si agganciano all'unità quando esiste)
  ['Finance', null, null, false, 'finance', 'SUPPORT', 'ALL'], ['Finance', null, null, false, 'cash', 'FINANCE', 'ALL'], ['Finance', null, null, false, 'cockpit', 'VIEWER', 'ALL'],
  ['Operations', null, null, false, 'orders', 'PROCUREMENT', 'ALL'], ['Operations', null, null, false, 'shipments', 'ADMIN', 'ALL'], ['Operations', null, null, false, 'cash', 'ADMIN', 'ALL'], ['Operations', null, null, false, 'room', 'PLANNER', 'ALL'],
  ['Flow & Back Office Management', null, null, false, 'orders', 'PROCUREMENT', 'ALL'], ['Flow & Back Office Management', null, null, false, 'shipments', 'ADMIN', 'ALL'],
  ['Retail & Communications Management', null, null, false, 'retail', 'RETAIL', 'ALL'], ['Retail & Communications Management', null, null, false, 'comunicazione', 'EDITOR', 'ALL'],
  ['HSQ Management', null, null, false, 'nc', 'QUALITA', 'ALL'], ['HSQ Management', null, null, false, 'sgi', 'EDITOR', 'ALL'], ['HSQ Management', null, null, false, 'service', 'EDITOR', 'ALL'],
  ['Legal, People and Organization', null, null, false, 'business', 'VIEWER', 'ALL'], ['Legal, People and Organization', null, null, false, 'contracts', 'HR', 'ALL'],
  // pettine
  ['Laboratorio di Analisi', null, null, false, 'nc', 'LAB', 'ALL'], ['Laboratorio di Analisi', null, null, false, 'orders', 'LAB', 'ALL'],
  ['B2B', null, null, false, 'business', 'OPERATOR', 'ALL'],
  // per tipo di sede di lavoro
  [null, null, 'PUNTO_PRELIEVI', false, 'cash', 'CASSIERE', 'SITE'], [null, null, 'PUNTO_PRELIEVI', false, 'retail', 'SEDE', 'SITE'], [null, null, 'PUNTO_PRELIEVI', false, 'orders', 'SEDE', 'SITE'], [null, null, 'PUNTO_PRELIEVI', false, 'nc', 'SEDE', 'SITE'],
  [null, null, 'CENTRO_DIAGNOSTICO', false, 'cash', 'CASSIERE', 'SITE'], [null, null, 'CENTRO_DIAGNOSTICO', false, 'room', 'VIEWER', 'SITE'], [null, null, 'CENTRO_DIAGNOSTICO', false, 'nc', 'SEDE', 'SITE'],
  [null, null, 'CENTRO_MEDICO', false, 'cash', 'CASSIERE', 'SITE'], [null, null, 'CENTRO_MEDICO', false, 'room', 'VIEWER', 'SITE'], [null, null, 'CENTRO_MEDICO', false, 'nc', 'SEDE', 'SITE'],
  // responsabili di unità
  [null, null, null, true, 'cockpit', 'VIEWER', 'ALL'], [null, null, null, true, 'room', 'PLANNER', 'SITE'], [null, null, null, true, 'orders', 'SEDE', 'SITE'],
  // per ruolo
  [null, 'Direttore Sanitario', null, false, 'room', 'RESP_SAN', 'ALL'], [null, 'Direttore Sanitario', null, false, 'nc', 'QUALITA', 'ALL'],
  [null, 'Site Manager', null, false, 'cash', 'ADMIN', 'SITE'], [null, 'Site Manager', null, false, 'retail', 'SEDE', 'SITE'], [null, 'Site Manager', null, false, 'room', 'PLANNER', 'SITE'],
];

/** Regole iniziali (una volta sola, se la tabella è vuota): agganciate a unità e ruoli per nome, se esistono */
export async function seedGrantRules() {
  if ((await one('SELECT count(*)::int AS n FROM grant_rules')).n) return 0;
  let n = 0;
  for (const [unitName, roleName, siteKind, heads, mod, profile, scope] of seedRules) {
    const unit = unitName ? await one('SELECT id FROM org_units WHERE lower(name)=lower($1) ORDER BY id LIMIT 1', [unitName]) : null;
    if (unitName && !unit) continue;
    const role = roleName ? await one('SELECT id FROM job_roles WHERE lower(name)=lower($1)', [roleName]) : null;
    if (roleName && !role) continue;
    if (!(await one('SELECT 1 FROM modules WHERE key=$1', [mod]))) continue;
    const name = unitName ? `Afferenza ${unitName}` : roleName ? `Ruolo ${roleName}` : siteKind ? `Sede ${siteKind}` : heads ? 'Responsabili di unità' : 'Regola';
    await q(`INSERT INTO grant_rules (name, unit_id, role_id, site_kind, only_heads, module_key, profile, scope, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, unit?.id || null, role?.id || null, siteKind, heads, mod, profile, scope, n * 10]);
    n++;
  }
  return n;
}

/** Regole che valgono per una persona */
export async function rulesForPerson(personId) {
  return many(`
    WITH p AS (SELECT p.*, s.kind AS site_kind, EXISTS (SELECT 1 FROM org_positions op WHERE op.person_id=p.id AND op.is_head) AS is_head FROM people p LEFT JOIN sites s ON s.id=p.site_id WHERE p.id=$1),
    anc AS (WITH RECURSIVE up AS (SELECT u.id, u.parent_id FROM org_units u, p WHERE u.id = p.unit_id UNION ALL SELECT u.id, u.parent_id FROM org_units u JOIN up ON u.id = up.parent_id) SELECT id FROM up),
    pos_units AS (SELECT op.unit_id AS id FROM org_positions op, p WHERE op.person_id = p.id)
    SELECT r.*, m.scope_type AS module_scope FROM grant_rules r JOIN modules m ON m.key=r.module_key, p
    WHERE r.active
      AND (r.unit_id IS NULL OR r.unit_id IN (SELECT id FROM anc) OR r.unit_id IN (SELECT id FROM pos_units))
      AND (r.role_id IS NULL OR r.role_id = p.role_id OR EXISTS (SELECT 1 FROM org_positions op WHERE op.person_id=p.id AND op.role_id=r.role_id))
      AND (r.site_kind IS NULL OR r.site_kind = p.site_kind)
      AND (NOT r.only_heads OR p.is_head)
    ORDER BY r.sort_order, r.id`, [personId]);
}

const RANK = ['VIEWER', 'LETTORE', 'PROF', 'SEDE', 'OPERATOR', 'CASSIERE', 'EDITOR', 'LAB', 'RETAIL', 'SUPPORT', 'HR', 'PLANNER', 'PROCUREMENT', 'QUALITA', 'RESP_SAN', 'FINANCE', 'PUBLISHER', 'CFO', 'DIREZIONE', 'ADMIN', 'CEO', 'SUPERADMIN'];
const stronger = (a, b) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

/** Applica le regole a una persona con accesso: crea o aggiorna le PROPOSTE (mai i grant confermati). Ritorna quante proposte sono state scritte. */
export async function proposeGrantsForPerson(personId, actorId = null) {
  const u = await one('SELECT id, site_id FROM users WHERE person_id=$1', [personId]);
  if (!u) return 0;
  const rules = await rulesForPerson(personId);
  const byModule = new Map();
  for (const r of rules) { const cur = byModule.get(r.module_key); byModule.set(r.module_key, { profile: cur ? stronger(cur.profile, r.profile) : r.profile, scope: cur && cur.scope === 'ALL' ? 'ALL' : r.scope, module_scope: r.module_scope }); }
  // proposte non più coperte da nessuna regola spariscono (quelle confermate restano)
  const keys = [...byModule.keys()];
  await q(`DELETE FROM grants WHERE user_id=$1 AND proposed AND source='ORG' AND NOT (module_key = ANY($2::text[]))`, [u.id, keys]);
  let n = 0;
  for (const [mod, g] of byModule) {
    if (mod === 'contracts') continue;   // il modulo riservato non si propone mai
    const r = await one(`INSERT INTO grants (user_id, module_key, profile, proposed, source, created_by) VALUES ($1,$2,$3,TRUE,'ORG',$4)
      ON CONFLICT (user_id, module_key) DO UPDATE SET profile = CASE WHEN grants.proposed THEN EXCLUDED.profile ELSE grants.profile END, updated_at=now() RETURNING id, proposed`, [u.id, mod, g.profile, actorId]);
    if (r.proposed && g.module_scope === 'SITE' && g.scope === 'SITE' && u.site_id) {
      await q(`DELETE FROM grant_scopes WHERE grant_id=$1`, [r.id]);
      await q(`INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,'SITE',$2) ON CONFLICT DO NOTHING`, [r.id, u.site_id]);
    }
    if (r.proposed) n++;
  }
  return n;
}

export async function proposeGrantsForAll(actorId = null) {
  const rows = await many(`SELECT person_id FROM users WHERE person_id IS NOT NULL AND status='ACTIVE' AND level <> 'OWNER'`);
  let n = 0; for (const r of rows) n += await proposeGrantsForPerson(r.person_id, actorId);
  return { users: rows.length, proposals: n };
}
