// Persona cessata (correzione A11 del programma "anagrafica unica", 08/11/2026). Quando una persona passa a CESSATO (job e scheda del
// modulo Contratti, cambio di stato manuale in Amministrazione > Persone, correzioni D19/D18e della Diagnostica):
// 1. gli accessi collegati diventano DISABLED (prima restavano ACTIVE); un amministratore si disattiva solo con conferma esplicita,
//    il titolare mai (avviso);
// 2. gli incarichi nell'organigramma si chiudono (righe di org_positions eliminate, head_person_id azzerato), così la persona non resta
//    responsabile di sede, destinataria degli avvisi di Audit, Room, Ordini;
// 3. se era responsabile di una sede gli amministratori ricevono l'avviso "sede senza responsabile".
import { one, many, q } from '../db.js';
import { audit } from './util.js';
import { notify } from './community.js';

const attore = ({ req, actorId }) => (req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null });

/** Utenti amministratori attivi della persona: servono la conferma prima di disattivarli. */
export async function adminDaConfermare(personId) {
  return many(`SELECT id, email, level FROM users WHERE person_id=$1 AND status IN ('ACTIVE','PENDING') AND level IN ('ADMIN','OWNER')`, [personId]);
}

/**
 * Effetti della cessazione. opts: { req | actorId, confermaAdmin (disattiva anche gli ADMIN), origine }.
 * Ritorna { utenti_disattivati, admin_da_confermare, incarichi_chiusi, responsabile_di, avvisi }.
 */
export async function effettiCessazione(personId, { req = null, actorId = null, confermaAdmin = false, origine = 'Amministrazione > Persone' } = {}) {
  const p = await one('SELECT id, last_name, first_name, status FROM people WHERE id=$1', [personId]);
  if (!p) return null;
  const out = { utenti_disattivati: [], admin_da_confermare: [], incarichi_chiusi: 0, responsabile_di: [], avvisi: [] };
  if (p.status !== 'CESSATO') { out.avvisi.push('La persona non è cessata: nessun effetto'); return out; }
  const nome = `${p.last_name} ${p.first_name}`;
  // 1. accessi
  for (const u of await many(`SELECT id, email, level FROM users WHERE person_id=$1 AND status IN ('ACTIVE','PENDING')`, [personId])) {
    if (u.level === 'OWNER') { out.avvisi.push(`${u.email}: è il titolare della Suite, l'accesso non si disattiva da qui`); continue; }
    if (u.level === 'ADMIN' && !confermaAdmin) { out.admin_da_confermare.push({ id: u.id, email: u.email }); continue; }
    await q(`UPDATE users SET status='DISABLED', updated_at=now() WHERE id=$1`, [u.id]);
    out.utenti_disattivati.push({ id: u.id, email: u.email, level: u.level });
  }
  // 2. incarichi (e responsabilità di sede)
  out.responsabile_di = await many(`SELECT DISTINCT u.id AS unit_id, u.name AS unit_name, u.kind, s.id AS site_id, s.code AS site_code, s.name AS site_name
      FROM org_positions op JOIN org_units u ON u.id=op.unit_id LEFT JOIN sites s ON s.id=u.site_id WHERE op.person_id=$1 AND op.is_head ORDER BY u.name`, [personId]);
  out.incarichi_chiusi = (await q('DELETE FROM org_positions WHERE person_id=$1', [personId])).rowCount;
  await q('UPDATE org_units SET head_person_id=NULL, updated_at=now() WHERE head_person_id=$1', [personId]);
  // 3. avviso agli amministratori: sedi rimaste senza responsabile, accessi da amministratore da confermare
  const sedi = out.responsabile_di.filter((x) => x.kind === 'SEDE');
  const admins = (await many(`SELECT id FROM users WHERE level IN ('OWNER','ADMIN') AND status='ACTIVE'`)).map((r) => r.id);
  if (sedi.length && admins.length) {
    await notify(admins, { kind: 'AVVISO', title: `Sede senza responsabile: ${nome} è cessato/a`,
      body: `Era responsabile di ${sedi.map((x) => x.site_name || x.unit_name).join(', ')}. Nomina il nuovo responsabile in Amministrazione > Organizzazione (Audit, Room e Ordini usano il responsabile del nodo Sede).`, link: '/admin/organization' }).catch(() => {});
  }
  if (out.admin_da_confermare.length && admins.length) {
    await notify(admins, { kind: 'AVVISO', title: `Accesso da amministratore ancora attivo: ${nome} è cessato/a`,
      body: `Disattivalo in Amministrazione > Utenti o dalla Diagnostica anagrafica (controllo D19, con conferma): ${out.admin_da_confermare.map((u) => u.email).join(', ')}`, link: '/admin/diagnostica' }).catch(() => {});
  }
  await audit(attore({ req, actorId }), 'PERSON_TERMINATED_EFFECTS', { entity: 'person', entityId: personId, label: `${nome}: effetti della cessazione (${origine})`, data: out });
  return out;
}
