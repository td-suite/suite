// Firmatari delle circolari: si scelgono SOLO dall'elenco del personale (dipendenti e liberi professionisti attivi).
// v0.99.2 (CEO, 26/11/2026): i contatti in firma sono quelli di LAVORO dell'UTENTE della Suite collegato alla persona (users: email,
// cellulare del profilo, sede di lavoro con il suo indirizzo), MAI i dati della scheda del dipendente (people.email, people.phone,
// people.phone_office, residenza), che possono essere personali. Chi non ha un utente attivo firma con nome e ruolo, senza contatti.
import { many } from '../db.js';

const SQL = `SELECT p.id, p.first_name, p.last_name, p.kind, u.id AS user_id, nullif(btrim(u.email), '') AS email, nullif(btrim(u.phone), '') AS phone,
    coalesce(nullif(btrim(u.title), ''), nullif(btrim(p.job_title), ''), (SELECT jr.name FROM public.job_roles jr WHERE jr.id = p.role_id), (SELECT jr.name FROM public.org_positions op JOIN public.job_roles jr ON jr.id = op.role_id WHERE op.person_id = p.id ORDER BY op.is_head DESC, op.id LIMIT 1), '') AS ruolo,
    s.name AS site_name, s.address AS site_address, s.zip AS site_zip, s.city AS site_city, s.province AS site_province
  FROM public.people p
  LEFT JOIN LATERAL (SELECT x.* FROM public.users x WHERE x.person_id = p.id AND x.status = 'ACTIVE' AND NOT coalesce(x.is_external, FALSE) ORDER BY x.id LIMIT 1) u ON TRUE
  LEFT JOIN public.sites s ON s.id = coalesce(u.site_id, p.site_id) AND u.id IS NOT NULL
 WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP')`;
const indirizzoDi = (p) => { const loc = [p.site_zip, p.site_city].filter(Boolean).join(' '); const t = [p.site_address, `${loc}${p.site_province ? ` (${p.site_province})` : ''}`.trim()].filter(Boolean).join(', '); return t ? `${p.site_name ? `${p.site_name}, ` : ''}${t}` : ''; };
const voce = (p) => ({ person_id: p.id, nome: `${p.first_name || ''} ${p.last_name || ''}`.trim(), ruolo: p.ruolo || '', email: p.email || '', telefono: p.phone || '', indirizzo: indirizzoDi(p), tipo: p.kind, utente: Boolean(p.user_id) });
const chiave = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ').sort().join(' ');

/** Elenco per la scelta: [{ person_id, nome, ruolo, email, telefono (cellulare dell'utente), indirizzo (sede di lavoro), tipo, utente }]. */
export async function personaleFirmatari() {
  return (await many(`${SQL} ORDER BY p.last_name, p.first_name`)).map(voce);
}

/**
 * Porta ogni firmatario ai dati dell'anagrafica: per person_id, altrimenti per nome e cognome (in qualunque ordine) quando la
 * corrispondenza è una sola. Chi non è (più) nel personale resta com'era, senza person_id. L'ordine non cambia.
 */
export async function risolviFirmatari(lista) {
  const l = (Array.isArray(lista) ? lista : []).filter((f) => f && String(f.nome || '').trim());
  if (!l.length) return [];
  const persone = (await many(SQL)).map(voce);
  const perId = new Map(persone.map((p) => [p.person_id, p]));
  const perNome = new Map();
  for (const p of persone) { const k = chiave(p.nome); perNome.set(k, perNome.has(k) ? null : p); }
  return l.map((f) => {
    const p = (f.person_id && perId.get(Number(f.person_id))) || perNome.get(chiave(f.nome)) || null;
    if (!p) return { person_id: null, nome: String(f.nome).trim(), ruolo: f.ruolo || '', email: f.email || '', telefono: f.telefono || '', indirizzo: f.indirizzo || '' };
    return { person_id: p.person_id, nome: p.nome, ruolo: p.ruolo || f.ruolo || '', email: p.email, telefono: p.telefono, indirizzo: p.indirizzo };
  });
}
