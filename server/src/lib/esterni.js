// Accessi esterni dalle Legal entity (richiesta del CEO, 29/10/2026): partner che ospitano punti prelievo e clienti service.
// Qui stanno le regole pure (testabili senza database) e le letture dall'anagrafica unica che le alimentano:
// - un utente è esterno se non è interno (lib/audience.js: Owner/Admin, Legal entity GRUPPO/SOCIETA o dominio aziendale);
// - gli ambiti dei grant di un esterno si risolvono dalla sua organizzazione, non dalla sede della persona:
//   Cash → le sedi TD ospitate (cash.site_ext.host_org_id), NC → la Legal entity stessa (scope ORG, letto da perimetroSedi),
//   gli altri moduli per sede → le sedi dell'organizzazione (public.sites.organization_id);
// - in Rubrica un esterno vede solo le persone delle unità con public_contact e di ciascuna solo nome, ruolo, email e telefono ufficio;
// - il profilo di accesso proposto a una Legal entity dipende dal tipo e dalle sedi (ospitate → Partner ospitante, SERVICE → Cliente service).
import { one, many, q } from '../db.js';
import { isInternal } from './audience.js';

export const PROFILO_PARTNER = 'PARTNER_OSPITANTE';
export const PROFILO_CLIENTE = 'CLIENTE_SERVICE';

/** Esterno = utente autenticato che non appartiene alla rete TD (vedi isInternal). Owner e Admin non sono mai esterni. */
export const isExternal = (u) => Boolean(u) && !isInternal(u);

/**
 * Profilo di sistema proposto per una Legal entity: dal tipo e dalle sedi collegate.
 * - ospita punti prelievo (hostedSites > 0) → Partner ospitante, qualunque sia il tipo (PARTNER o CLIENTE);
 * - CLIENTE con sedi SERVICE (serviceSites > 0) → Cliente service;
 * - PARTNER senza sedi ospitate → Partner ospitante (il perimetro arriverà con il riallineamento);
 * - CLIENTE senza sedi → Cliente service (contratto service scelto a mano);
 * - altri tipi → nessuna proposta (si sceglie a mano).
 */
export function proposeProfileKey({ kind, hostedSites = 0, serviceSites = 0 }) {
  if (hostedSites > 0) return PROFILO_PARTNER;
  if (serviceSites > 0) return PROFILO_CLIENTE;
  if (kind === 'PARTNER') return PROFILO_PARTNER;
  if (kind === 'CLIENTE') return PROFILO_CLIENTE;
  return null;
}

/**
 * Ambiti di un grant per un utente esterno, dall'organizzazione (funzione pura).
 * module: { key, scope_type } del catalogo; ctx: { orgId, hostedSiteIds, orgSiteIds }.
 * Ritorna { scopes: [{type, id}], warning: string|null }.
 */
export function resolveExternalScopes(module, { orgId, hostedSiteIds = [], orgSiteIds = [] }, profileScoped = true) {
  const uniq = (a) => [...new Set((a || []).map(Number).filter(Number.isFinite))].sort((x, y) => x - y);
  if (!module?.scope_type) return { scopes: [], warning: null };
  if (!orgId) return { scopes: [], warning: `${module.key}: l'utente esterno non ha una Legal entity, grant senza ambito` };
  if (module.key === 'cash') {
    const ids = uniq(hostedSiteIds);
    return { scopes: ids.map((id) => ({ type: 'SITE', id })), warning: ids.length ? null : 'cash: la Legal entity non ospita nessun punto prelievi (Amministrazione > Sedi > Legal entity ospitante): grant senza sedi, nessuna royalty visibile' };
  }
  if (module.key === 'nc') {
    // il perimetro NC accetta lo scope ORG (perimetroSedi: chiave -org_id): tutte le NC della Legal entity e dei suoi punti SERVICE
    return { scopes: [{ type: 'ORG', id: Number(orgId) }], warning: null };
  }
  if (module.scope_type === 'ORG') return { scopes: [{ type: 'ORG', id: Number(orgId) }], warning: null };
  const ids = uniq(orgSiteIds);
  if (!ids.length && profileScoped) return { scopes: [], warning: `${module.key}: la Legal entity non ha sedi collegate, grant senza ambito` };
  return { scopes: ids.map((id) => ({ type: 'SITE', id })), warning: null };
}

/** Campi della scheda persona visibili a un esterno in Rubrica: nome, ruolo, email e telefono ufficio. Niente altro. */
export const RUBRICA_EXTERNAL_FIELDS = ['id', 'last_name', 'first_name', 'title', 'job_title', 'unit_name', 'email', 'phone_office', 'phone_ext', 'avatar_file_id', 'photo_file_id'];
export function filterRubricaRow(row) {
  if (!row) return null;
  const out = {};
  for (const k of RUBRICA_EXTERNAL_FIELDS) if (row[k] !== undefined) out[k] = row[k];
  out.phone = null;   // mai il cellulare personale
  return out;
}

// Condizione SQL (alias p = people) che limita alle persone delle unità con public_contact: afferenza o incarico
export const RUBRICA_PUBLIC_SQL = `(EXISTS (SELECT 1 FROM org_units pu WHERE pu.id = p.unit_id AND pu.public_contact AND pu.active)
  OR EXISTS (SELECT 1 FROM org_positions pop JOIN org_units pu ON pu.id = pop.unit_id WHERE pop.person_id = p.id AND pu.public_contact AND pu.active))`;

// ---- Letture dall'anagrafica unica

/** Sedi TD ospitate dalla Legal entity (public.sites.host_organization_id, con cash.site_ext.host_org_id come riserva). */
export async function hostedSiteIds(orgId) {
  if (!orgId) return [];
  const ok = await one(`SELECT to_regclass('cash.site_ext') IS NOT NULL AS ok`);
  // fonte: public.sites.host_organization_id (Amministrazione > Sedi > Legal entity ospitante); cash.site_ext.host_org_id come riserva
  const rows = ok?.ok
    ? await many(`SELECT s.id AS site_id FROM sites s LEFT JOIN cash.site_ext e ON e.site_id = s.id WHERE coalesce(s.host_organization_id, e.host_org_id) = $1 AND s.active ORDER BY s.id`, [orgId])
    : await many(`SELECT s.id AS site_id FROM sites s WHERE s.host_organization_id = $1 AND s.active ORDER BY s.id`, [orgId]);
  return rows.map((r) => r.site_id);
}

/** Sedi collegate alla Legal entity nell'anagrafica unica (punti SERVICE dei clienti, sedi delle società). */
export async function orgSiteIds(orgId) {
  if (!orgId) return [];
  const rows = await many('SELECT id FROM sites WHERE organization_id = $1 AND active ORDER BY id', [orgId]);
  return rows.map((r) => r.id);
}

/** Contesto per la risoluzione degli ambiti di un esterno: Legal entity, sedi ospitate, sedi dell'organizzazione. */
export async function externalScopeContext(orgId) {
  return { orgId: orgId || null, hostedSiteIds: await hostedSiteIds(orgId), orgSiteIds: await orgSiteIds(orgId) };
}

/** Legal entity dell'utente come la vede l'anagrafica: quella della persona, altrimenti quella dell'utente. */
export async function userOrganization(userId) {
  const u = await one(`SELECT u.id, u.email, u.level, coalesce(p.organization_id, u.organization_id) AS organization_id, o.kind AS organization_kind
      FROM users u LEFT JOIN people p ON p.id = u.person_id LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.id = $1`, [userId]);
  return u || null;
}

export const SYSTEM_PROFILES_SQL = `SELECT id, name, description, items, system, system_key FROM access_profiles WHERE system ORDER BY sort_order`;

/** Profilo di sistema per chiave (PARTNER_OSPITANTE, CLIENTE_SERVICE). */
export async function systemProfile(key) {
  return one('SELECT * FROM access_profiles WHERE system AND system_key = $1', [key]);
}

/** Quadro della Legal entity per la sezione Accessi: tipo, sedi ospitate, sedi SERVICE, profilo proposto. */
export async function orgAccessSummary(orgId) {
  const org = await one('SELECT id, kind, name, code, email, city, active FROM organizations WHERE id = $1', [orgId]);
  if (!org) return null;
  const hosted = await hostedSiteIds(orgId);
  const hostedSites = hosted.length ? await many('SELECT id, code, name, city, kind FROM sites WHERE id = ANY($1::int[]) ORDER BY name', [hosted]) : [];
  const serviceSites = await many(`SELECT id, code, name, city, kind, studiolab_code FROM sites WHERE organization_id = $1 AND kind = 'SERVICE' AND active ORDER BY name`, [orgId]);
  const otherSites = await many(`SELECT id, code, name, city, kind FROM sites WHERE organization_id = $1 AND kind <> 'SERVICE' AND active ORDER BY name`, [orgId]);
  const proposed = proposeProfileKey({ kind: org.kind, hostedSites: hostedSites.length, serviceSites: serviceSites.length });
  return { org, hosted_sites: hostedSites, service_sites: serviceSites, other_sites: otherSites, proposed_profile_key: proposed };
}

/**
 * Riallinea gli ambiti dei grant nati da un profilo (profile_id non nullo o source PROFILE) per tutti gli utenti esterni della
 * Legal entity: quando TD apre un nuovo punto prelievi presso lo stesso partner, le royalty della sede nuova diventano visibili.
 * I grant manuali non si toccano. Ritorna { users, grants, changed, warnings, rows }.
 */
export async function realignOrgPerimeters(orgId, { actorId = null } = {}) {
  const users = await many(`SELECT DISTINCT u.id, u.email, u.full_name, u.level FROM users u LEFT JOIN people p ON p.id = u.person_id
      WHERE u.status IN ('ACTIVE','PENDING') AND (u.organization_id = $1 OR p.organization_id = $1) ORDER BY u.id`, [orgId]);
  const modules = await many('SELECT key, name, scope_type, profiles FROM modules');
  const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));
  const ctx = await externalScopeContext(orgId);
  const report = { organization_id: orgId, users: 0, grants: 0, changed: 0, warnings: [], rows: [], context: { hosted_sites: ctx.hostedSiteIds.length, org_sites: ctx.orgSiteIds.length } };
  for (const u of users) {
    if (u.level !== 'USER') { report.warnings.push(`${u.full_name}: livello ${u.level}, non è un esterno: saltato`); continue; }
    const grants = await many(`SELECT g.id, g.module_key, g.profile, coalesce(json_agg(json_build_object('type', gs.scope_type, 'id', gs.scope_id) ORDER BY gs.scope_type, gs.scope_id) FILTER (WHERE gs.grant_id IS NOT NULL), '[]') AS scopes
        FROM grants g LEFT JOIN grant_scopes gs ON gs.grant_id = g.id WHERE g.user_id = $1 AND (g.profile_id IS NOT NULL OR g.source = 'PROFILE') GROUP BY g.id`, [u.id]);
    const row = { user_id: u.id, email: u.email, full_name: u.full_name, grants: 0, changed: 0, warnings: [] };
    for (const g of grants) {
      const m = byKey[g.module_key];
      if (!m?.scope_type) continue;
      const prof = (m.profiles || []).find((p) => p.key === g.profile);
      const { scopes, warning } = resolveExternalScopes(m, ctx, Boolean(prof?.scoped));
      if (warning) row.warnings.push(warning);
      row.grants++;
      const cur = (g.scopes || []).map((s) => `${s.type}:${s.id}`).sort().join(',');
      const next = scopes.map((s) => `${s.type}:${s.id}`).sort().join(',');
      if (cur === next) continue;
      await q('DELETE FROM grant_scopes WHERE grant_id = $1', [g.id]);
      for (const s of scopes) await q('INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [g.id, s.type, s.id]);
      await q('UPDATE grants SET updated_at = now() WHERE id = $1', [g.id]);
      row.changed++;
    }
    report.users++; report.grants += row.grants; report.changed += row.changed;
    for (const w of row.warnings) report.warnings.push(`${u.full_name}: ${w}`);
    report.rows.push(row);
  }
  void actorId;
  return report;
}
