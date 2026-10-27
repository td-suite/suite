// Sedi invianti sull'anagrafica unica della Suite, due origini (docs/ANAGRAFICA.md, migrazione 004): le sedi TD
// (public.sites, kind <> 'SERVICE', impostazioni NC in site_ext) e le Legal entity (public.organizations: laboratori clienti
// del service, fornitori, partner; impostazioni NC in org_ext). Chiave unica sede_id: > 0 id della sede, < 0 opposto dell'id
// della Legal entity. La vista sedi_v espone le colonne che il codice del modulo si aspetta: id, origin, codice, nome, tipo,
// telefono, referente, indirizzo, citta, attiva, configurata, email_effettiva, email_cc, sla_ore, canale, punti ...
// I punti SERVICE (sites kind = 'SERVICE') non sono sedi: sono punti StudioLAB della loro Legal entity (organization_id).
import { one, many } from '../db.js';

export const loadSede = (id) => one('SELECT * FROM sedi_v WHERE id=$1', [Number(id)]);

// Sede inviante scelta in un form: un punto SERVICE indicato per id porta alla sua Legal entity
export async function loadSedeInviante(id) {
  const s = await loadSede(id);
  return s?.punto_service && s.organization_id ? loadSede(-s.organization_id) : s;
}

// Tabella delle impostazioni e colonna chiave per una chiave unificata
export const extOf = (id) => (Number(id) < 0 ? { table: 'org_ext', col: 'org_id', key: -Number(id) } : { table: 'site_ext', col: 'site_id', key: Number(id) });

// Chiave unificata di una riga di public.sites: la sede stessa, oppure la Legal entity se è un punto SERVICE
export const sedeKeyOfSite = (site) => (!site ? null : site.kind === 'SERVICE' && site.organization_id ? -site.organization_id : site.id);

// Riconoscimento della sede inviante dal codice cliente StudioLAB (HL7 ORC-13 / FT1, push, import): prima il codice LIS
// proprio della Legal entity (org_ext), poi studiolab_code e code dell'anagrafica unica (sedi TD e punti SERVICE: il punto
// porta alla sua Legal entity), infine il codice della Legal entity. Il codice StudioLAB di una sede TD è solo quello
// dell'anagrafica (docs/IMPOSTAZIONI.md). Nessuna creazione automatica: le anagrafiche nascono in Amministrazione.
export async function findSedeByCodice(codice) {
  const c = String(codice || '').trim();
  if (!c) return null;
  const hit = await one(`
    SELECT k.id, k.prio FROM (
      SELECT -e.org_id AS id, 1 AS prio FROM org_ext e WHERE lower(e.codice_lis) = lower($1)
      UNION ALL
      SELECT CASE WHEN s.kind = 'SERVICE' AND s.organization_id IS NOT NULL THEN -s.organization_id ELSE s.id END AS id,
             CASE WHEN lower(s.studiolab_code) = lower($1) THEN 3 ELSE 4 END AS prio
        FROM public.sites s
       WHERE lower(s.studiolab_code) = lower($1) OR lower(s.code) = lower($1)
      UNION ALL
      SELECT -o.id AS id, 5 AS prio FROM public.organizations o WHERE lower(o.code) = lower($1)
    ) k JOIN sedi_v v ON v.id = k.id
    ORDER BY k.prio, v.attiva DESC, v.id DESC LIMIT 1`, [c]);
  return hit ? loadSede(hit.id) : null;
}

// Utenti della Suite che ricevono le notifiche NC della sede: grant del modulo con profilo SEDE e ambito sulla sede TD
// (scope SITE) oppure, per una Legal entity, ambito ORG sulla Legal entity, ambito SITE su un suo punto SERVICE o utenti
// che appartengono alla Legal entity. La preferenza "notify_email" resta nella riga users del modulo; senza riga si assume attiva.
// id = espressione SQL della chiave unificata; extraJoin/extraWhere per la preferenza di notifica
const utentiSedeSql = (id, { join = '', where = '' } = {}) => `
  FROM public.users u ${join}
  JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'nc' AND g.profile = 'SEDE' AND NOT g.proposed
  WHERE u.status = 'ACTIVE' ${where} AND (
    (${id} > 0 AND EXISTS (SELECT 1 FROM public.grant_scopes gs WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE' AND gs.scope_id = ${id}))
    OR (${id} < 0 AND (
      EXISTS (SELECT 1 FROM public.grant_scopes gs WHERE gs.grant_id = g.id AND gs.scope_type = 'ORG' AND gs.scope_id = -(${id}))
      OR EXISTS (SELECT 1 FROM public.grant_scopes gs JOIN public.sites p ON p.id = gs.scope_id AND p.kind = 'SERVICE' AND p.organization_id = -(${id}) WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE')
      OR (u.organization_id = -(${id}) AND NOT EXISTS (SELECT 1 FROM public.grant_scopes gs WHERE gs.grant_id = g.id))
    ))
  )`;
export const utentiSedeCountSql = (idExpr) => `(SELECT count(DISTINCT u.id)::int ${utentiSedeSql(idExpr)})`;

export async function sedeUtentiEmail(sedeId) {
  const rows = await many(`SELECT DISTINCT u.email ${utentiSedeSql('$1::int', { join: 'LEFT JOIN users mu ON lower(mu.email) = lower(u.email)', where: 'AND coalesce(mu.notify_email, TRUE)' })} ORDER BY u.email`, [Number(sedeId)]);
  return rows.map((r) => r.email);
}

// Destinatari di una comunicazione alla sede: casella NC del canale scelto + utenti di sede della Suite
export async function sedeDestinatari(sede) {
  if (!sede) return [];
  if (sede.canale === 'NESSUNO') return [];
  const users = await sedeUtentiEmail(sede.id);
  return [...new Set([sede.email_effettiva, ...users].filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
}

// Perimetro di un utente del modulo: chiavi unificate delle sedi negli scope del grant Suite. Scope SITE = la sede TD
// (un punto SERVICE porta alla sua Legal entity), scope ORG = la Legal entity; senza alcun ambito, la Legal entity
// dell'utente (referente esterno di un cliente del service).
export async function perimetroSedi(suiteUser) {
  const out = new Set();
  const scopes = suiteUser?.grants?.nc?.scopes || [];
  const sids = [...new Set(scopes.filter((s) => s.type === 'SITE').map((s) => Number(s.id)).filter(Number.isFinite))];
  if (sids.length) {
    const rows = await many('SELECT id, kind, organization_id FROM public.sites WHERE id = ANY($1::int[])', [sids]);
    for (const s of rows) out.add(sedeKeyOfSite(s));
  }
  for (const s of scopes) if (s.type === 'ORG' && Number.isFinite(Number(s.id))) out.add(-Number(s.id));
  if (!out.size && suiteUser?.organization_id) out.add(-Number(suiteUser.organization_id));
  return [...out];
}
