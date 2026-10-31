// Profili di accesso (richiesta del CEO, 28/10/2026): pacchetti "widget → profilo" applicati a uno o più utenti.
// - merge (predefinito): aggiunge i grant mancanti; aggiorna quelli esistenti solo se erano proposte o nati da un profilo (o da una
//   regola dell'organigramma); un grant manuale con profilo diverso resta com'è e finisce nel rapporto. Non toglie mai nulla.
// - replace: sostituisce tutti i grant dell'utente con quelli del profilo (solo su richiesta esplicita).
// I grant nascono confermati (proposed FALSE, source PROFILE, profile_id); per i moduli con scope_type SITE lo scope è la sede della
// persona (people.site_id, altrimenti users.site_id); senza sede il grant nasce senza scope e il rapporto lo segnala.
// Utenti esterni (29/10/2026, lib/esterni.js): gli ambiti si risolvono dalla Legal entity dell'utente (Cash → sedi ospitate,
// NC → la Legal entity, altri moduli per sede → le sedi dell'organizzazione) e si riallineano a ogni applicazione del profilo.
import { one, many, tx } from '../db.js';
import { config } from '../config.js';
import { isInternal } from './audience.js';
import { resolveExternalScopes, externalScopeContext } from './esterni.js';

const isOwnerLevel = (u) => u?.level === 'OWNER';
// Ordine di "forza" dei profili dei moduli (dal più basso): serve a non declassare un grant nato da un altro profilo di accesso
const RANK = ['VIEWER', 'LETTORE', 'PROF', 'CLIENTE', 'PARTNER', 'SEDE', 'SITE', 'OPERATOR', 'MANUTENTORE', 'CASSIERE', 'REDATTORE', 'EDITOR', 'LAB', 'RETAIL', 'SERVICE', 'MDL', 'ENDEAVOR', 'SUPPORT', 'HR', 'HQS', 'PLANNER', 'RESPONSABILE', 'PROCUREMENT', 'FACILITY', 'AUDITOR', 'QUALITA', 'RESP_SAN', 'FINANCE', 'PUBBLICATORE', 'PUBLISHER', 'CFO', 'DIREZIONE', 'ADMIN', 'CEO', 'SUPERADMIN'];
const rank = (p) => RANK.indexOf(p);

async function loadActor(actorId) {
  if (!actorId) return null;
  return one('SELECT id, level, email FROM users WHERE id=$1', [actorId]);
}

/** Profilo per id, con gli item validati contro il catalogo dei moduli. */
export async function getProfile(profileId) {
  const p = await one('SELECT * FROM access_profiles WHERE id=$1', [profileId]);
  return p || null;
}

export async function getDefaultProfile() {
  return one('SELECT * FROM access_profiles WHERE is_default ORDER BY id LIMIT 1');
}

/**
 * Applica un profilo a più utenti. opts: { actorId, mode: 'merge' | 'replace' }.
 * Ritorna { profile: {id, name}, mode, users, added, updated, kept, removed, warnings: [string], rows: [{user_id, email, added, updated, kept, removed, warnings}] }.
 */
export async function applyProfile(profileId, userIds, { actorId = null, mode = 'merge' } = {}) {
  const profile = await getProfile(profileId);
  if (!profile) throw Object.assign(new Error('Profilo di accesso inesistente'), { status: 404 });
  if (!['merge', 'replace'].includes(mode)) throw Object.assign(new Error('Modalità non valida'), { status: 400 });
  const actor = await loadActor(actorId);
  const owner = isOwnerLevel(actor);
  const modules = await many('SELECT key, name, restricted, active, scope_type, profiles FROM modules');
  const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));

  // Item validi del profilo (una volta sola): modulo esistente e attivo, profilo previsto, modulo riservato solo per il titolare
  const report = { profile: { id: profile.id, name: profile.name }, mode, users: 0, added: 0, updated: 0, kept: 0, removed: 0, warnings: [], rows: [] };
  const items = [];
  for (const it of Array.isArray(profile.items) ? profile.items : []) {
    const m = byKey[it.module_key];
    if (!m) { report.warnings.push(`Widget "${it.module_key}" inesistente: saltato`); continue; }
    if (m.active === false) { report.warnings.push(`Widget "${m.name}" disattivato: saltato`); continue; }
    const prof = (m.profiles || []).find((p) => p.key === it.profile);
    if (!prof) { report.warnings.push(`Profilo "${it.profile}" non previsto da "${m.name}": saltato`); continue; }
    if (m.restricted && !owner) { report.warnings.push(`"${m.name}" è un widget riservato: lo assegna solo il titolare, saltato`); continue; }
    items.push({ module: m, profile: prof.key, scoped: Boolean(prof.scoped) });
  }
  const itemKeys = new Set(items.map((i) => i.module.key));

  const ids = [...new Set((userIds || []).map(Number).filter(Number.isFinite))];
  for (const uid of ids) {
    const u = await one(`SELECT u.id, u.email, u.full_name, u.level, u.status, coalesce(p.site_id, u.site_id) AS site_id,
                                coalesce(p.organization_id, u.organization_id) AS organization_id, o.kind AS organization_kind
                           FROM users u LEFT JOIN people p ON p.id=u.person_id LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.id=$1`, [uid]);
    if (!u) { report.warnings.push(`Utente n. ${uid} inesistente: saltato`); continue; }
    if (u.level === 'OWNER' && !owner) { report.warnings.push(`${u.full_name}: il titolare lo modifica solo il titolare, saltato`); continue; }
    const row = { user_id: u.id, email: u.email, full_name: u.full_name, added: 0, updated: 0, kept: 0, removed: 0, warnings: [] };
    // Esterno (Legal entity CLIENTE/PARTNER/... o dominio non aziendale): gli ambiti si risolvono dall'organizzazione, non dalla
    // sede della persona (lib/esterni.js: Cash → sedi ospitate, NC → la Legal entity, altri → sedi dell'organizzazione)
    const external = !isInternal({ ...u, internal_domains: config.autoInternalDomains });
    const extCtx = external ? await externalScopeContext(u.organization_id) : null;
    if (external && !u.organization_id) row.warnings.push('utente esterno senza Legal entity: i grant per sede nascono senza ambito');
    // Ambiti del grant per un item del profilo: [{type, id}] (esterno: dall'organizzazione; interno: la sede della persona)
    const scopesFor = (it) => {
      const m = it.module;
      if (external) {
        const r = resolveExternalScopes(m, extCtx, it.scoped);
        if (r.warning && it.scoped) row.warnings.push(r.warning);
        return r.scopes;
      }
      if (m.scope_type === 'SITE' && u.site_id) return [{ type: 'SITE', id: u.site_id }];
      if (m.scope_type === 'SITE' && !u.site_id && it.scoped) row.warnings.push(`${m.name} (${it.profile}): la persona non ha una sede, grant senza ambito`);
      return [];
    };
    await tx(async (c) => {
      const { rows: existing } = await c.query('SELECT id, module_key, profile, proposed, source, profile_id FROM grants WHERE user_id=$1', [u.id]);
      const have = Object.fromEntries(existing.map((g) => [g.module_key, g]));
      if (mode === 'replace') {
        for (const g of existing) {
          if (itemKeys.has(g.module_key)) continue;   // viene riallineato sotto
          const m = byKey[g.module_key];
          if (m?.restricted && !owner) { row.warnings.push(`${m.name}: widget riservato, lasciato`); row.kept++; continue; }
          await c.query('DELETE FROM grants WHERE id=$1', [g.id]);
          row.removed++;
        }
      }
      for (const it of items) {
        const m = it.module;
        const scopes = scopesFor(it);
        const addScopes = async (gid) => { for (const s of scopes) await c.query(`INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [gid, s.type, s.id]); };
        const g = have[m.key];
        if (!g) {
          const { rows: [ng] } = await c.query(
            `INSERT INTO grants (user_id, module_key, profile, proposed, source, profile_id, created_by) VALUES ($1,$2,$3,FALSE,'PROFILE',$4,$5) RETURNING id`,
            [u.id, m.key, it.profile, profile.id, actorId]);
          await addScopes(ng.id);
          row.added++;
          continue;
        }
        // grant già presente: si tocca solo se era una proposta, nato da un profilo o da una regola dell'organigramma (mode replace: sempre).
        // Un grant manuale resta com'è; un grant nato da un altro profilo si aggiorna solo se il nuovo profilo non è più basso
        // (così "Applica il Default a tutti" non declassa chi ha già Site Manager o Direzione).
        const fromProfile = g.profile_id != null || g.source === 'PROFILE' || g.source === 'ORG';
        const overridable = mode === 'replace' || g.proposed || fromProfile;
        if (!overridable) {
          if (g.profile !== it.profile) row.warnings.push(`${m.name}: grant manuale "${g.profile}" lasciato (il profilo prevede "${it.profile}")`);
          row.kept++;
          continue;
        }
        if (g.profile === it.profile && !g.proposed) {
          // stesso profilo: resta, agganciato a questo profilo di accesso se non ne aveva uno; per un esterno gli ambiti
          // dall'organizzazione si completano (un nuovo punto prelievi ospitato entra nel perimetro)
          if (g.profile_id == null) await c.query(`UPDATE grants SET source='PROFILE', profile_id=$2, updated_at=now() WHERE id=$1`, [g.id, profile.id]);
          if (external) await addScopes(g.id);
          row.kept++;
          continue;
        }
        if (mode === 'merge' && !g.proposed && g.profile_id !== profile.id && rank(g.profile) > rank(it.profile)) {
          row.warnings.push(`${m.name}: "${g.profile}" (già da un profilo) è più alto di "${it.profile}", lasciato`);
          row.kept++;
          continue;
        }
        await c.query(`UPDATE grants SET profile=$2, proposed=FALSE, source='PROFILE', profile_id=$3, updated_at=now() WHERE id=$1`, [g.id, it.profile, profile.id]);
        if (scopes.length) {
          if (g.proposed || mode === 'replace' || external) await c.query('DELETE FROM grant_scopes WHERE grant_id=$1', [g.id]);
          await addScopes(g.id);
        }
        row.updated++;
      }
    });
    report.users++; report.added += row.added; report.updated += row.updated; report.kept += row.kept; report.removed += row.removed;
    for (const w of row.warnings) report.warnings.push(`${u.full_name}: ${w}`);
    report.rows.push(row);
  }
  return report;
}

/** Applica il profilo predefinito (se esiste) a un utente appena nato, in modalità merge. Ritorna il rapporto o null.
 *  Gli utenti esterni (Legal entity CLIENTE/PARTNER/... o dominio non aziendale) ne sono esclusi: il Default è il pacchetto dei
 *  membri della rete TD (cartella, room, retail...), gli esterni ricevono solo il profilo di sistema scelto nella scheda Legal entity. */
export async function applyDefaultProfile(userId, actorId = null) {
  const d = await getDefaultProfile();
  if (!d) return null;
  const u = await one(`SELECT u.id, u.email, u.level, o.kind AS organization_kind FROM users u LEFT JOIN people p ON p.id=u.person_id
      LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.id=$1`, [userId]);
  if (u && !isInternal({ ...u, internal_domains: config.autoInternalDomains })) return { profile: { id: d.id, name: d.name }, mode: 'merge', users: 0, added: 0, updated: 0, kept: 0, removed: 0, warnings: ['utente esterno: il profilo Default non si applica (solo profili di sistema dalla scheda Legal entity)'], rows: [], skipped_external: true };
  return applyProfile(d.id, [userId], { actorId, mode: 'merge' });
}

/** Applica il profilo predefinito a tutti gli utenti attivi o in attesa (merge). */
export async function applyDefaultToAll(actorId = null) {
  const d = await getDefaultProfile();
  if (!d) throw Object.assign(new Error('Nessun profilo predefinito: segna un profilo come "predefinito per tutti i nuovi utenti"'), { status: 400 });
  // esclusi gli esterni (vedi applyDefaultProfile)
  const rows = await many(`SELECT u.id FROM users u LEFT JOIN people p ON p.id=u.person_id LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id)
    WHERE u.status IN ('ACTIVE','PENDING') AND (u.level IN ('OWNER','ADMIN') OR coalesce(o.kind,'') IN ('GRUPPO','SOCIETA') OR lower(split_part(u.email,'@',2)) = ANY($1::text[])) ORDER BY u.id`, [config.autoInternalDomains]);
  return applyProfile(d.id, rows.map((r) => r.id), { actorId, mode: 'merge' });
}
