// Referenti del Business Hub ↔ persone dell'anagrafica (correzione B7 del programma "anagrafica unica", 08/11/2026). Un referente
// (business.contatti) si collega alla persona di Amministrazione > Persone con la stessa email anche se non ha un accesso alla Suite
// (prima il collegamento nasceva solo all'invito, lib/flusso.js). Mai una persona di un'altra Legal entity: in quel caso il referente
// resta senza persona e il controllo D23 della Diagnostica lo segnala. La persona ESTERNO continua a nascere all'invito (flusso.js).
import { one, many, q } from '../db.js';

/** Persona da collegare (funzione pura): { person_id } oppure { motivo } */
export function sceltaPersona(persone, orgId) {
  const stesse = persone.filter((p) => p.organization_id == null || Number(p.organization_id) === Number(orgId));
  if (stesse.length === 1) return { person_id: stesse[0].id };
  if (stesse.length > 1) { const o = stesse.find((p) => Number(p.organization_id) === Number(orgId)); return o ? { person_id: o.id } : { motivo: 'più persone con questa email: scegli in Amministrazione > Persone' }; }
  if (persone.length) return { motivo: 'la persona con questa email è di un\'altra Legal entity' };
  return { motivo: 'nessuna persona con questa email in Amministrazione > Persone (nasce all\'invito)' };
}

/**
 * Collega i referenti (tutti, di un account o gli `ids`) alla persona con la stessa email. Ritorna [{ id, email, esito, motivo? }].
 */
export async function collegaReferenti({ accountId = null, ids = null, anche_collegati = false } = {}) {
  const rows = await many(`SELECT k.id, k.email, k.person_id, a.organization_id FROM contatti k JOIN accounts a ON a.id=k.account_id
     WHERE coalesce(k.email,'') <> '' AND ($1::int IS NULL OR k.account_id=$1) AND ($2::int[] IS NULL OR k.id = ANY($2::int[]))
       AND (k.person_id IS NULL OR $3::boolean) ORDER BY k.id`, [accountId, ids, anche_collegati]);
  const out = [];
  for (const r of rows) {
    const persone = await many(`SELECT id, organization_id FROM public.people WHERE lower(email)=lower($1) ORDER BY (status='ATTIVO') DESC, id`, [r.email]);
    const s = sceltaPersona(persone, r.organization_id);
    if (s.person_id && Number(s.person_id) !== Number(r.person_id)) {
      await q('UPDATE contatti SET person_id=$2, updated_at=now() WHERE id=$1', [r.id, s.person_id]);
      out.push({ id: r.id, email: r.email, esito: `collegato alla persona #${s.person_id}` });
    } else out.push({ id: r.id, email: r.email, esito: s.person_id ? 'già collegato' : 'non collegato', motivo: s.motivo });
  }
  return out;
}

/** Al salvataggio di un referente: collegamento immediato per email (silenzioso). */
export async function collegaReferente(id) {
  const k = await one('SELECT id FROM contatti WHERE id=$1 AND person_id IS NULL AND coalesce(email, \'\') <> \'\'', [id]);
  if (k) await collegaReferenti({ ids: [id] }).catch(() => null);
}
