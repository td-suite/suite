// Scrittura delle persone sull'anagrafica unica (public.people + contracts.person_ext) in un'unica transazione.
// Contratti del personale è l'ingresso HR: l'unico modulo autorizzato a creare e modificare public.people (oltre ad
// Amministrazione > Persone). Ogni creazione o modifica viene registrata nell'audit della Suite con l'utente Suite (req.suiteUser),
// non con la riga users dello schema del modulo. Le letture passano dalla vista resources_v (migrazione 016).
import { autoAccountForPerson } from '../../../lib/accounts.js';
import { audit as suiteAudit } from '../../../lib/util.js';
import { indexPersonById } from '../../../lib/search.js';
import { one, q } from '../db.js';

// Colonne di public.people (anagrafica generale, visibile nella Rubrica) e di person_ext (dossier HR riservato)
// Luogo di nascita, partita IVA e residenza sono dati personali dell'anagrafica unica (migrazione core 018, docs/IMPOSTAZIONI.md)
export const PEOPLE_COLS = ['kind', 'status', 'last_name', 'first_name', 'sex', 'title', 'birth_date', 'birth_place', 'tax_code', 'vat_number', 'email', 'phone', 'phone_office', 'phone_ext', 'address', 'zip', 'city', 'province', 'manager_person_id', 'site_id', 'hired_at', 'terminated_at', 'job_title', 'discipline'];
export const EXT_COLS = ['mobile_company', 'iban', 'badge_number', 'nationality', 'emergency_contact', 'area_id', 'approver_id', 'cv_attachment_id', 'termination_reason', 'termination_notes', 'interview_notes', 'notes'];
// Nomi usati dall'app di origine (e dal front-end) che corrispondono a colonne di public.people con altro nome
const ALIASES = { manager_id: 'manager_person_id' };
// Tipo di persona dell'anagrafica unica: DIPENDENTE e DIRIGENTE hanno un rapporto subordinato (employments), gli altri un incarico (lp_contracts)
export const PERSON_KINDS = ['DIPENDENTE', 'DIRIGENTE', 'LP', 'MEDICO', 'SANITARIO'];
export const hrKind = (personKind) => (['DIPENDENTE', 'DIRIGENTE'].includes(personKind) ? 'DIPENDENTE' : 'LP');

const suiteReq = (req) => ({ user: req.suiteUser || req.user, ip: req.ip });
const runner = (c) => (c ? c.query.bind(c) : q);

/** Divide i campi del form (schema personSchema) tra public.people e person_ext. */
export function splitPerson(data) {
  const people = {}; const ext = {};
  for (const [k0, v] of Object.entries(data || {})) {
    const k = ALIASES[k0] || k0;
    if (PEOPLE_COLS.includes(k)) people[k] = v;
    else if (EXT_COLS.includes(k)) ext[k] = v;
  }
  return { people, ext };
}

/** Allinea su public.people i campi derivati dal dossier: area (nome dell'area principale), mansione e disciplina dal contratto. */
export async function syncDerived(c, id) {
  const run = runner(c);
  await run(`UPDATE public.people p SET
      area = coalesce((SELECT a.name FROM person_ext x JOIN areas a ON a.id = x.area_id WHERE x.person_id = p.id), p.area),
      job_title = coalesce((SELECT e.job_title FROM employments e WHERE e.resource_id = p.id), (SELECT l.role_description FROM lp_contracts l WHERE l.resource_id = p.id), p.job_title),
      discipline = coalesce((SELECT l.discipline FROM lp_contracts l WHERE l.resource_id = p.id), p.discipline),
      updated_at = now()
    WHERE p.id = $1`, [id]);
}

/** Crea la persona (public.people + person_ext) e registra PERSON_CREATED. Ritorna l'id di public.people. */
// L'accesso nasce dalla persona attiva con email: dopo il COMMIT della transazione del chiamante (il client è quello del modulo)
function queueAccount(c, personId, req) {
  const actor = req?.suiteUser || req?.user || null;
  // breve differimento: la transazione del modulo deve essere chiusa prima che la Suite legga la persona con il pool principale
  setTimeout(() => autoAccountForPerson(personId, actor), 1500);
}

export async function createPerson(c, req, data) {
  const { people, ext } = splitPerson(data);
  if (!people.kind) people.kind = 'DIPENDENTE';
  if (!people.status) people.status = 'ATTIVO';
  const pc = Object.keys(people);
  const row = (await c.query(`INSERT INTO public.people (${pc.join(',')}) VALUES (${pc.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, last_name, first_name`, pc.map((k) => people[k]))).rows[0];
  const ec = Object.keys(ext);
  await c.query(`INSERT INTO person_ext (person_id, created_by${ec.length ? ', ' + ec.join(',') : ''}) VALUES ($1, $2${ec.map((_, i) => `, $${i + 3}`).join('')})`, [row.id, req.user?.id || null, ...ec.map((k) => ext[k])]);
  await syncDerived(c, row.id);
  queueAccount(c, row.id, req);
  await suiteAudit(suiteReq(req), 'PERSON_CREATED', { module: 'contracts', entity: 'person', entityId: row.id, label: `${row.last_name} ${row.first_name}`, data: { kind: people.kind, status: people.status } });
  return row.id;
}

/** Aggiorna la persona (campi di public.people e/o di person_ext) e registra PERSON_UPDATED. La riga person_ext nasce alla prima scrittura. */
export async function updatePerson(c, req, id, data, { audit = true } = {}) {
  const run = runner(c);
  const { people, ext } = splitPerson(data);
  const pc = Object.keys(people);
  let row = null;
  if (pc.length) {
    row = (await run(`UPDATE public.people SET ${pc.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING id, last_name, first_name`, [id, ...pc.map((k) => people[k])])).rows[0];
    if (!row) return null;
  }
  const ec = Object.keys(ext);
  if (ec.length) {
    await run(`INSERT INTO person_ext (person_id, created_by, ${ec.join(',')}) VALUES ($1, $2, ${ec.map((_, i) => `$${i + 3}`).join(',')})
      ON CONFLICT (person_id) DO UPDATE SET ${ec.map((k) => `${k}=EXCLUDED.${k}`).join(', ')}, updated_at=now()`, [id, req.user?.id || null, ...ec.map((k) => ext[k])]);
  } else if (!pc.length) return null;
  await syncDerived(c, id);
  queueAccount(c, id, req);
  if (audit) {
    row = row || (await run('SELECT id, last_name, first_name FROM public.people WHERE id=$1', [id])).rows[0];
    if (row) await suiteAudit(suiteReq(req), 'PERSON_UPDATED', { module: 'contracts', entity: 'person', entityId: id, label: `${row.last_name} ${row.first_name}`, data });
  }
  return id;
}

/** Elimina la persona dall'anagrafica unica (con il dossier HR, in cascata) e registra PERSON_DELETED. */
export async function deletePerson(c, req, id, reason) {
  const run = runner(c);
  const row = (await run('SELECT id, last_name, first_name FROM public.people WHERE id=$1', [id])).rows[0];
  if (!row) return null;
  await run('UPDATE public.people SET manager_person_id=NULL WHERE manager_person_id=$1', [id]);
  await run('UPDATE person_ext SET approver_id=NULL WHERE approver_id=$1', [id]);
  await run('UPDATE areas SET head_person_id=NULL WHERE head_person_id=$1', [id]);
  await run('DELETE FROM public.people WHERE id=$1', [id]);
  await suiteAudit(suiteReq(req), 'PERSON_DELETED', { module: 'contracts', entity: 'person', entityId: id, label: `${row.last_name} ${row.first_name}`, data: { reason } });
  return row;
}

/** Aggiorna l'indice di ricerca della Suite dopo il commit (non blocca la risposta). */
export const reindexPerson = (id) => indexPersonById(id).catch((e) => console.error('[contracts] indice persona', e.message));

/** Etichetta della sede di lavoro (public.sites) per documenti e schede: indirizzo completo, altrimenti il nome. */
export async function siteLabel(siteId, c) {
  if (!siteId) return null;
  const s = (await runner(c)('SELECT name, address, zip, city, province FROM public.sites WHERE id=$1', [siteId])).rows[0];
  if (!s) return null;
  const addr = [s.address, [s.zip, s.city].filter(Boolean).join(' ') + (s.province ? ` (${s.province})` : '')].filter((x) => x && x.trim()).join(', ');
  return addr || s.name;
}
