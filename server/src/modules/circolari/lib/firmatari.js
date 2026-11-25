// Firmatari delle circolari (v0.98.2, richiesta del CEO del 25/11/2026): si scelgono SOLO dall'elenco del personale, dipendenti e
// liberi professionisti attivi, e portano con sé ruolo e contatti dell'anagrafica (email, telefono d'ufficio con interno; se manca,
// il telefono della sede). Nessun contatto si scrive a mano: si corregge in Anagrafica > Persone e vale per tutte le circolari.
// Il cellulare personale (people.phone) non si usa mai.
import { many } from '../db.js';

const SQL = `SELECT p.id, p.first_name, p.last_name, p.kind, p.email,
    coalesce(nullif(btrim(p.job_title), ''), (SELECT jr.name FROM public.job_roles jr WHERE jr.id = p.role_id), (SELECT jr.name FROM public.org_positions op JOIN public.job_roles jr ON jr.id = op.role_id WHERE op.person_id = p.id ORDER BY op.is_head DESC, op.id LIMIT 1), '') AS ruolo,
    nullif(btrim(p.phone_office), '') AS phone_office, nullif(btrim(p.phone_ext), '') AS phone_ext, nullif(btrim(s.phone), '') AS site_phone
  FROM public.people p LEFT JOIN public.sites s ON s.id = p.site_id
 WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP')`;
const voce = (p) => ({ person_id: p.id, nome: `${p.first_name || ''} ${p.last_name || ''}`.trim(), ruolo: p.ruolo || '', email: (p.email || '').trim(),
  telefono: p.phone_office ? p.phone_office : (p.site_phone ? `${p.site_phone}${p.phone_ext ? ` int. ${p.phone_ext}` : ''}` : ''), tipo: p.kind });
const chiave = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ').sort().join(' ');

/** Elenco per la scelta: [{ person_id, nome, ruolo, email, telefono, tipo }] in ordine di cognome. */
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
    if (!p) return { person_id: null, nome: String(f.nome).trim(), ruolo: f.ruolo || '', email: f.email || '', telefono: f.telefono || '' };
    return { person_id: p.person_id, nome: p.nome, ruolo: p.ruolo || f.ruolo || '', email: p.email, telefono: p.telefono };
  });
}
