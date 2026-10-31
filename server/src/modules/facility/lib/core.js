// Funzioni comuni del modulo Facility e Manutenzioni: impostazioni, sedi gestite, immobili (creati al volo), disponibilità di Payments
// e Room Planning, contratto di affitto da Payments, catalogo dispositivi, generazione e rigenerazione del piano delle scadenze,
// destinatari delle notifiche, allegati. Nei log della Suite solo id e conteggi.
import { q, one, many } from '../db.js';
import { KEY, SETTINGS_DEFAULT } from '../config.js';
import { bad, notFound, today as todayRome } from '../../../lib/util.js';
import { getModuleState } from '../../../lib/modules.js';
import { storeBuffer, dropBlobs } from '../../../lib/moduleStorage.js';
import { contractEnd, stepAt, parseDate as fParse, toIso as fIso } from '../../finance/lib/schedule.js';
import { firstDue, nextDue, streamsFor, obligationPlanKind, addDays } from './calc.js';

export { KEY, todayRome };
export const idOf = (v, msg = 'Elemento non trovato') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw notFound(msg); return n; };

// ---- Impostazioni (facility.app_settings): oggetti fusi con i predefiniti
export async function settings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const out = JSON.parse(JSON.stringify(SETTINGS_DEFAULT));
  for (const r of rows) out[r.key] = (r.value && typeof r.value === 'object' && !Array.isArray(r.value) && out[r.key] && typeof out[r.key] === 'object' && !Array.isArray(out[r.key])) ? { ...out[r.key], ...r.value } : r.value;
  return out;
}
export async function setSetting(key, value, userId) {
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), userId || null]);
}

// ---- Sedi gestite dall'utente (ambito SITE del grant + sedi di cui è manager_email nell'organigramma)
export async function managedSites(suiteUser) {
  const ids = new Set((suiteUser.grants?.[KEY]?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id)));
  const rows = await many('SELECT id FROM sites_v WHERE lower(manager_email)=lower($1)', [suiteUser.email]);
  for (const r of rows) ids.add(r.id);
  return [...ids];
}
// Legal entity del manutentore (per l'accesso esterno): organizzazione della persona o dell'utente, se non è una società del gruppo
export async function vendorOrgOf(suiteUser) {
  const r = await one(`SELECT o.id, o.kind FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id
    JOIN public.organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.id=$1`, [suiteUser.id]);
  return r && !['GRUPPO', 'SOCIETA'].includes(r.kind) ? r.id : null;
}

// ---- Moduli collegati
export async function financeLive() {
  const st = await getModuleState('finance');
  if (st.mode !== 'LIVE' || !st.schema_ready) return false;
  const ok = await one(`SELECT to_regclass('finance.utilities') IS NOT NULL AND to_regclass('finance.utility_bills') IS NOT NULL AND to_regclass('finance.lease_contracts') IS NOT NULL AS ok`);
  return Boolean(ok?.ok);
}
export async function roomReady() {
  const st = await getModuleState('room');
  if (!['LIVE', 'MIRROR'].includes(st.mode) || !st.schema_ready) return false;
  const ok = await one(`SELECT to_regclass('room.struttura_blobs') IS NOT NULL AS ok`);
  return Boolean(ok?.ok);
}
export async function schemaLive(key, table) {
  const st = await getModuleState(key);
  if (!['LIVE', 'MIRROR'].includes(st.mode) || !st.schema_ready) return false;
  const ok = await one(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`${key}.${table}`]);
  return Boolean(ok?.ok);
}
export const FINANCE_OFF = 'Payments non avviato: utenze, bollette e contratti di affitto vivono nello Scadenziario strutture di Payments, che va avviato prima (Amministrazione > Travaso moduli).';
export async function requireFinance() { if (!(await financeLive())) throw Object.assign(bad(FINANCE_OFF), { code: 'FINANCE_OFF' }); }

// ---- Sedi e immobili
export const SITE_COLS = 's.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.organization_id, s.host_organization_id, s.manager_name, s.manager_email, s.active, s.sort_order, s.opened_at';
export async function siteById(id) {
  const s = await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Sede non trovata (le strutture dei clienti service non sono gestite da Facility)');
  return s;
}
// Immobili mancanti creati al volo per tutte le sedi attive non SERVICE: OSPITATA se la sede ha una Legal entity ospitante,
// altrimenti LOCAZIONE (il caso più comune nella rete, modificabile nella scheda)
export async function ensureProperties() {
  await q(`INSERT INTO properties (site_id, tenure, landlord_org_id)
    SELECT s.id, CASE WHEN s.host_organization_id IS NOT NULL THEN 'OSPITATA' ELSE 'LOCAZIONE' END, s.host_organization_id
      FROM public.sites s WHERE s.active AND s.kind <> 'SERVICE' ON CONFLICT (site_id) DO NOTHING`);
}
export async function propertyBySite(siteId) {
  await siteById(siteId);
  await q(`INSERT INTO properties (site_id, tenure, landlord_org_id) SELECT s.id, CASE WHEN s.host_organization_id IS NOT NULL THEN 'OSPITATA' ELSE 'LOCAZIONE' END, s.host_organization_id FROM public.sites s WHERE s.id=$1 ON CONFLICT (site_id) DO NOTHING`, [siteId]);
  return one('SELECT * FROM properties WHERE site_id=$1', [siteId]);
}

// ---- Contratto di affitto da Payments (finance.lease_contracts): quello indicato nell'immobile, altrimenti il contratto attivo della sede
export async function leaseInfo(siteId, leaseId = null) {
  if (!(await financeLive())) return { available: false, lease: null };
  let l = leaseId ? await one(`SELECT l.*, coalesce(l.landlord_name, o.name) AS landlord_label FROM finance.lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id WHERE l.id=$1`, [leaseId]) : null;
  if (l && l.site_id !== siteId) l = null;                                  // riferimento non coerente con la sede: ignorato
  if (!l) l = await one(`SELECT l.*, coalesce(l.landlord_name, o.name) AS landlord_label FROM finance.lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id WHERE l.site_id=$1 AND l.active ORDER BY l.start_date DESC LIMIT 1`, [siteId]);
  if (!l) return { available: true, lease: null };
  const steps = await many('SELECT valid_from, amount, reason, pct FROM finance.lease_steps WHERE lease_id=$1 ORDER BY valid_from', [l.id]);
  const T = fParse(todayRome());
  const cur = stepAt(steps, T);
  const end = contractEnd(l, T);
  const rent = cur ? Number(cur.amount) : null;
  return { available: true, lease: { id: l.id, kind: l.kind, unit: l.unit, start_date: l.start_date, landlord_org_id: l.landlord_org_id, landlord: l.landlord_label, period_months: l.period_months,
    rent, rent_monthly: rent != null ? Math.round((rent / (Number(l.period_months) || 1)) * 100) / 100 : null, rent_annual: rent != null ? Math.round(rent * (12 / (Number(l.period_months) || 1)) * 100) / 100 : null,
    istat: l.istat, deposit: l.deposit, end_date: end ? fIso(end.end) : null, renewals: end?.renewals || 0, expired: Boolean(end?.expired), notice_months: l.notice_months,
    steps, next_step: steps.find((s) => fParse(s.valid_from) > T) || null } };
}

// ---- Catalogo dispositivi (public.asset_types)
export async function assetType(code) {
  const t = await one('SELECT * FROM public.asset_types WHERE code=$1', [code]);
  if (!t) throw bad(`Tipo di dispositivo ${code} non presente nel Catalogo dispositivi (Amministrazione > Anagrafiche)`);
  return t;
}

// ---- Piano delle scadenze
const insertPlan = (c, p) => c.query(`INSERT INTO maintenance_plans (site_id, asset_id, obligation_id, stream, kind, performer, title, interval_months, due_date, generated_from)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`, [p.site_id, p.asset_id || null, p.obligation_id || null, p.stream, p.kind, p.performer, p.title, p.interval_months || null, p.due_date, p.generated_from || null]);
const runner = (client) => client || { query: (t, p) => q(t, p) };

/**
 * Allinea le scadenze aperte di un dispositivo al catalogo: crea la serie mancante (una sola aperta per serie), annulla quelle delle
 * serie non più previste; un dispositivo dismesso o fuori servizio non genera scadenze (le aperte si annullano se dismesso).
 */
export async function syncAssetPlans(assetId, { client, today = todayRome() } = {}) {
  const c = runner(client);
  const a = (await c.query('SELECT * FROM assets WHERE id=$1', [assetId])).rows[0];
  if (!a) return { created: 0 };
  if (a.status === 'DISMESSO') {
    await c.query(`UPDATE maintenance_plans SET status='ANNULLATA', notes=coalesce(notes || ' · ', '') || 'dispositivo dismesso', updated_at=now() WHERE asset_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [assetId]);
    return { created: 0 };
  }
  const t = (await c.query('SELECT * FROM public.asset_types WHERE code=$1', [a.asset_type_code])).rows[0];
  const streams = streamsFor(a, t);
  const open = (await c.query(`SELECT id, stream, due_date FROM maintenance_plans WHERE asset_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [assetId])).rows;
  let created = 0;
  for (const s of streams) {
    if (open.some((p) => p.stream === s.stream)) continue;
    const explicit = s.stream === 'MANUTENZIONE' ? a.next_maintenance_due : s.stream === 'CONTROLLO' ? a.next_check_due : null;
    const due = firstDue({ explicit, installedAt: a.installed_at, intervalMonths: s.interval_months, today });
    const r = await insertPlan(c, { ...s, site_id: a.site_id, asset_id: a.id, due_date: due });
    created += r.rowCount;
  }
  const keep = streams.map((s) => s.stream);
  await c.query(`UPDATE maintenance_plans SET status='ANNULLATA', notes=coalesce(notes || ' · ', '') || 'serie non più prevista dal catalogo', updated_at=now() WHERE asset_id=$1 AND status IN ('PIANIFICATA','SCADUTA') AND NOT (stream = ANY($2::text[]))`, [assetId, keep]);
  await refreshAssetDue(assetId, c);
  return { created };
}
/** Prossime date del dispositivo (scheda e registro) ricalcolate dalle scadenze aperte */
export async function refreshAssetDue(assetId, client) {
  const c = runner(client);
  await c.query(`UPDATE assets a SET
      next_check_due = (SELECT min(due_date) FROM maintenance_plans p WHERE p.asset_id=a.id AND p.status IN ('PIANIFICATA','SCADUTA') AND p.stream IN ('CONTROLLO','SORVEGLIANZA')),
      next_maintenance_due = (SELECT min(due_date) FROM maintenance_plans p WHERE p.asset_id=a.id AND p.status IN ('PIANIFICATA','SCADUTA') AND p.stream='MANUTENZIONE'),
      updated_at = now() WHERE a.id=$1`, [assetId]);
}
/** Scadenza aperta dell'obbligo dell'immobile (una sola), annullata se l'obbligo è disattivato */
export async function syncObligationPlan(obligationId, { client, today = todayRome() } = {}) {
  const c = runner(client);
  const o = (await c.query('SELECT o.*, p.site_id FROM property_obligations o JOIN properties p ON p.id=o.property_id WHERE o.id=$1', [obligationId])).rows[0];
  if (!o) return { created: 0 };
  if (!o.active) {
    await c.query(`UPDATE maintenance_plans SET status='ANNULLATA', updated_at=now() WHERE obligation_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [obligationId]);
    return { created: 0 };
  }
  const open = (await c.query(`SELECT id FROM maintenance_plans WHERE obligation_id=$1 AND status IN ('PIANIFICATA','SCADUTA')`, [obligationId])).rows;
  if (open.length) {
    // titolo e periodicità seguono l'obbligo; la data della scadenza aperta resta (si sposta dal piano)
    await c.query(`UPDATE maintenance_plans SET title=$2, kind=$3, interval_months=$4, updated_at=now() WHERE id=$1`, [open[0].id, o.title, obligationPlanKind(o.kind), o.interval_months]);
    return { created: 0 };
  }
  const hasHistory = (await c.query(`SELECT 1 FROM maintenance_plans WHERE obligation_id=$1 LIMIT 1`, [obligationId])).rows.length;
  const due = hasHistory ? today : o.first_due;
  const r = await insertPlan(c, { site_id: o.site_id, obligation_id: o.id, stream: 'OBBLIGO', kind: obligationPlanKind(o.kind), performer: o.kind === 'NORMATIVO' ? 'ENTE' : 'MANUTENTORE', title: o.title, interval_months: o.interval_months, due_date: due });
  return { created: r.rowCount };
}

/**
 * Chiusura di una scadenza con esito e rigenerazione della successiva della stessa serie (dalla data di esecuzione + periodicità).
 * Ritorna la scadenza successiva creata (o null se la serie non è più prevista).
 */
export async function closePlan(c, plan, { done_at, outcome, cost, notes, report_file_id }, moduleUser) {
  await c.query(`UPDATE maintenance_plans SET status='ESEGUITA', done_at=$2, done_by=$3, done_by_name=$4, outcome=$5, cost=$6, notes=coalesce($7, notes), report_file_id=coalesce($8, report_file_id), updated_at=now() WHERE id=$1`,
    [plan.id, done_at, moduleUser?.id || null, moduleUser?.full_name || null, outcome, cost ?? null, notes || null, report_file_id || null]);
  let next = null;
  const interval = plan.interval_months;
  const due = nextDue(done_at, interval);
  if (due) {
    let still = true;
    if (plan.asset_id) {
      const a = (await c.query('SELECT a.*, t.surveillance_months AS t_s, t.check_interval_months AS t_c, t.maintenance_interval_months AS t_m FROM assets a JOIN public.asset_types t ON t.code=a.asset_type_code WHERE a.id=$1', [plan.asset_id])).rows[0];
      still = a && a.status !== 'DISMESSO';
      if (a && outcome) await c.query('UPDATE assets SET last_outcome=$2, updated_at=now() WHERE id=$1', [a.id, outcome]);
    }
    if (plan.obligation_id) still = Boolean((await c.query('SELECT active FROM property_obligations WHERE id=$1', [plan.obligation_id])).rows[0]?.active);
    if (still) {
      const r = await c.query(`INSERT INTO maintenance_plans (site_id, asset_id, obligation_id, stream, kind, performer, title, interval_months, due_date, generated_from)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id, due_date`, [plan.site_id, plan.asset_id, plan.obligation_id, plan.stream, plan.kind, plan.performer, plan.title, interval, due, plan.id]);
      next = r.rows[0] || null;
    }
  }
  if (plan.asset_id) await refreshAssetDue(plan.asset_id, c);
  return next;
}

// ---- Destinatari delle notifiche
// Facility: utenti con grant FACILITY/ADMIN confermato, più Owner e Admin della Suite
export async function facilityUserIds() {
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u LEFT JOIN public.grants g ON g.user_id=u.id AND g.module_key=$1 AND NOT g.proposed
    WHERE u.status='ACTIVE' AND (u.level IN ('OWNER','ADMIN') OR g.profile IN ('FACILITY','ADMIN'))`, [KEY]);
  return rows.map((r) => r.id);
}
// Site manager della sede: manager_email dell'organigramma oppure grant SITE del modulo con ambito sulla sede
export async function siteManagerUserIds(siteId) {
  const s = await one('SELECT manager_email FROM sites_v WHERE id=$1', [siteId]);
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u
    LEFT JOIN public.grants g ON g.user_id=u.id AND g.module_key=$2 AND NOT g.proposed AND g.profile='SITE'
    LEFT JOIN public.grant_scopes gs ON gs.grant_id=g.id AND gs.scope_type='SITE' AND gs.scope_id=$1
    WHERE u.status='ACTIVE' AND (($3 <> '' AND lower(u.email)=lower($3)) OR gs.grant_id IS NOT NULL)`, [siteId, KEY, s?.manager_email || '']);
  return rows.map((r) => r.id);
}
// Manutentori di una Legal entity (utenti attivi con grant MANUTENTORE la cui organizzazione è il fornitore)
export async function vendorUserIds(orgId) {
  if (!orgId) return [];
  const rows = await many(`SELECT DISTINCT u.id FROM public.users u JOIN public.grants g ON g.user_id=u.id AND g.module_key=$2 AND NOT g.proposed AND g.profile='MANUTENTORE'
    LEFT JOIN public.people p ON p.id=u.person_id WHERE u.status='ACTIVE' AND coalesce(p.organization_id, u.organization_id)=$1`, [orgId, KEY]);
  return rows.map((r) => r.id);
}
// Utente Suite che corrisponde a una riga tecnica del modulo (per notificare chi ha segnalato)
export async function suiteUserIdOf(moduleUserId) {
  if (!moduleUserId) return null;
  const r = await one('SELECT u.id FROM users m JOIN public.users u ON lower(u.email)=lower(m.email) WHERE m.id=$1', [moduleUserId]);
  return r?.id || null;
}
// Utenti Payments che ricevono la proposta di costo di un obbligo (profili CEO, CFO, SUPPORT)
export async function financeUserIds() {
  const rows = await many(`SELECT DISTINCT g.user_id AS id FROM public.grants g JOIN public.users u ON u.id=g.user_id WHERE g.module_key='finance' AND NOT g.proposed AND u.status='ACTIVE' AND g.profile IN ('CEO','CFO','SUPPORT')`);
  return rows.map((r) => r.id);
}

// ---- Allegati (rapportini, foto)
export async function addFile(entity, entityId, file, label, moduleUserId) {
  const stored = await storeBuffer(KEY, entity === 'PLAN' ? 'rapportini' : 'interventi', `${entityId}-${Date.now()}-${file.originalname}`, file.mimetype, file.buffer);
  return one(`INSERT INTO files (entity, entity_id, filename, mime, size, sha256, data, blob_path, label, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, entity, entity_id, filename, mime, size, label, created_at`,
    [entity, entityId, String(file.originalname || 'allegato').slice(0, 200), file.mimetype || 'application/octet-stream', stored.size, stored.sha256, stored.data, stored.blob_path, label || null, moduleUserId || null]);
}
export async function removeFile(fileId) {
  const f = await one('SELECT id, blob_path FROM files WHERE id=$1', [fileId]);
  if (!f) throw notFound('Allegato non trovato');
  await q('DELETE FROM files WHERE id=$1', [fileId]);
  await dropBlobs(KEY, [f.blob_path]);
}
export const isImageOrPdf = (f) => /^(image\/|application\/pdf)/.test(f.mimetype || '') || /\.(pdf|png|jpe?g|webp|heic)$/i.test(f.originalname || '');

// ---- Varie
export const isoToday = () => todayRome();
export const in30 = () => addDays(todayRome(), 30);
