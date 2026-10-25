// Sedi invianti sull'anagrafica unica della Suite (public.sites) con le impostazioni NC in site_ext.
// La vista sites_v (migrazione 003) espone le colonne che il codice dell'app si aspettava dalla vecchia tabella sedi:
// id, codice, nome, tipo, telefono, referente, indirizzo, citta, attiva, email_effettiva, email_cc, sla_ore, canale ...
import { one, many } from '../db.js';

export const loadSede = (id) => one('SELECT * FROM sites_v WHERE id=$1', [Number(id)]);

// Riconoscimento della sede dal codice cliente StudioLAB (HL7 ORC-13 / FT1, push, import): prima il codice LIS impostato
// nel modulo, poi studiolab_code e code dell'anagrafica unica. Nessuna creazione automatica: le sedi nascono in Amministrazione.
export async function findSedeByCodice(codice) {
  const c = String(codice || '').trim();
  if (!c) return null;
  return one(`SELECT v.* FROM sites_v v LEFT JOIN site_ext e ON e.site_id = v.id
    WHERE lower(e.codice_lis) = lower($1) OR lower(v.studiolab_code) = lower($1) OR lower(v.suite_code) = lower($1)
    ORDER BY (lower(e.codice_lis) = lower($1)) DESC, (lower(v.studiolab_code) = lower($1)) DESC, v.attiva DESC, v.id LIMIT 1`, [c]);
}

// Utenti di sede della Suite che ricevono le notifiche NC: grant del modulo con profilo SEDE e scope sulla sede.
// La preferenza "notify_email" resta nella riga users del modulo (per email); senza riga si assume attiva.
export async function sedeUtentiEmail(siteId) {
  const rows = await many(`SELECT u.email FROM public.users u
      JOIN public.grants g ON g.user_id = u.id AND g.module_key = 'nc' AND g.profile = 'SEDE' AND NOT g.proposed
      JOIN public.grant_scopes gs ON gs.grant_id = g.id AND gs.scope_type = 'SITE' AND gs.scope_id = $1
      LEFT JOIN users mu ON lower(mu.email) = lower(u.email)
      WHERE u.status = 'ACTIVE' AND coalesce(mu.notify_email, TRUE)
      ORDER BY u.email`, [Number(siteId)]);
  return rows.map((r) => r.email);
}

// Destinatari di una comunicazione alla sede: casella NC del canale scelto + utenti di sede della Suite
export async function sedeDestinatari(sede) {
  if (!sede) return [];
  if (sede.canale === 'NESSUNO') return [];
  const users = await sedeUtentiEmail(sede.id);
  return [...new Set([sede.email_effettiva, ...users].filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
}
