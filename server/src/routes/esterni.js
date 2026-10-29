// Accessi esterni dalla scheda Legal entity (richiesta del CEO, 29/10/2026): utenti collegati all'organizzazione, creazione di un
// accesso esterno (persona ESTERNO + utente LOCAL con invito + profilo di sistema), riallineamento dei perimetri.
// Solo amministratori. Documentazione in docs/ACCESSI_ESTERNI.md.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { indexPersonById } from '../lib/search.js';
import { orgAccessSummary, realignOrgPerimeters, systemProfile, SYSTEM_PROFILES_SQL, PROFILO_PARTNER, PROFILO_CLIENTE } from '../lib/esterni.js';
import { createUserAccount } from './users.js';

const r = Router();

// Quadro degli accessi di una Legal entity: utenti collegati (con i grant), persone dell'organizzazione senza accesso,
// sedi ospitate e sedi SERVICE, profilo proposto, profili di sistema disponibili
r.get('/organizations/:id/access', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const summary = await orgAccessSummary(id);
  if (!summary) throw notFound('Legal entity inesistente');
  const users = await many(`SELECT u.id, u.email, u.full_name, u.level, u.status, u.auth_provider, u.last_login_at, u.created_at, u.person_id,
      (SELECT json_agg(json_build_object('module_key', g.module_key, 'profile', g.profile, 'proposed', g.proposed, 'access_profile', ap.name,
         'scopes', (SELECT coalesce(json_agg(json_build_object('type', gs.scope_type, 'id', gs.scope_id)), '[]') FROM grant_scopes gs WHERE gs.grant_id = g.id)) ORDER BY g.module_key)
         FROM grants g LEFT JOIN access_profiles ap ON ap.id = g.profile_id WHERE g.user_id = u.id) AS grants
    FROM users u LEFT JOIN people p ON p.id = u.person_id
    WHERE u.organization_id = $1 OR p.organization_id = $1 ORDER BY lower(u.full_name)`, [id]);
  const people = await many(`SELECT p.id, p.last_name, p.first_name, p.email, p.kind, p.status, p.job_title, p.phone_office, p.phone
    FROM people p WHERE p.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id OR (p.email IS NOT NULL AND lower(u.email) = lower(p.email)))
    ORDER BY lower(p.last_name), lower(p.first_name)`, [id]);
  const profiles = await many(SYSTEM_PROFILES_SQL);
  res.json({ ...summary, users, people, profiles });
}));

const extSchema = z.object({
  first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), email: z.string().trim().email(),
  profile_key: z.enum([PROFILO_PARTNER, PROFILO_CLIENTE]), person_id: z.number().int().nullable().optional(),
  job_title: z.string().trim().max(160).nullable().optional(), phone_office: z.string().trim().max(40).nullable().optional(),
  send_invite: z.boolean().optional(),
});

// Crea l'accesso esterno: la persona (kind ESTERNO, ATTIVO, collegata alla Legal entity) se manca, poi l'utente con la stessa funzione
// di POST /api/users (auth LOCAL, level USER, organization_id, invito email) e il profilo di sistema scelto, i cui ambiti si risolvono
// dall'organizzazione (lib/esterni.js). Audit USER_CREATED con origin LEGAL_ENTITY.
r.post('/organizations/:id/external-access', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const org = await one('SELECT * FROM organizations WHERE id=$1', [id]);
  if (!org) throw notFound('Legal entity inesistente');
  if (!org.active) throw bad('La Legal entity non è attiva');
  if (['GRUPPO', 'SOCIETA'].includes(org.kind)) throw bad('Le società del gruppo non hanno accessi esterni: i loro utenti sono interni (Amministrazione > Utenti)');
  const b = parse(extSchema, req.body);
  const email = b.email.toLowerCase();
  const profile = await systemProfile(b.profile_key);
  if (!profile) throw bad('Profilo di sistema non trovato: riavvia il server per seminarlo');
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [email])) throw bad('Esiste già un utente con questa email');

  // persona: quella scelta, oppure quella con la stessa email, oppure nuova (ESTERNO, ATTIVO, della Legal entity)
  let person = b.person_id ? await one('SELECT * FROM people WHERE id=$1', [b.person_id]) : null;
  if (b.person_id && !person) throw bad('Persona non trovata');
  if (!person) person = await one('SELECT * FROM people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [email]);
  let personCreated = false;
  if (!person) {
    person = await one(`INSERT INTO people (kind, status, last_name, first_name, email, job_title, phone_office, organization_id)
      VALUES ('ESTERNO','ATTIVO',$1,$2,$3,$4,$5,$6) RETURNING *`, [b.last_name, b.first_name, email, b.job_title || null, b.phone_office || null, id]);
    personCreated = true;
    await audit(req, 'PERSON_CREATED', { entity: 'person', entityId: person.id, label: `${person.last_name} ${person.first_name}`, data: { origin: 'LEGAL_ENTITY', organization_id: id } });
    indexPersonById(person.id).catch(() => {});
  } else {
    // la persona esiste: si aggancia alla Legal entity e prende l'email indicata se non ne aveva una; deve essere attiva per entrare
    const sets = []; const params = [person.id];
    if (person.organization_id !== id) { params.push(id); sets.push(`organization_id=$${params.length}`); }
    if (!person.email) { params.push(email); sets.push(`email=$${params.length}`); }
    if (person.email && person.email.toLowerCase() !== email) throw bad(`La persona scelta ha un'altra email (${person.email}): correggila in Persone oppure crea una persona nuova`);
    if (person.status !== 'ATTIVO') { params.push('ATTIVO'); sets.push(`status=$${params.length}`); }
    if (sets.length) person = await one(`UPDATE people SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  }

  const out = await createUserAccount(req, {
    email, first_name: person.first_name, last_name: person.last_name, level: 'USER', status: 'ACTIVE', auth_provider: 'LOCAL',
    organization_id: id, person_id: person.id, lang: 'it', send_invite: b.send_invite !== false, origin: 'LEGAL_ENTITY', access_profile_id: profile.id,
  });
  await q('UPDATE users SET organization_id=$2 WHERE id=$1', [out.id, id]);
  await audit(req, 'EXTERNAL_ACCESS_CREATED', { entity: 'organization', entityId: id, label: `${org.name} → ${email} (${profile.name})`, data: { user_id: out.id, person_id: person.id, person_created: personCreated, profile_key: b.profile_key, invited: out.invited } });
  res.status(201).json({ ...out, person_id: person.id, person_created: personCreated, profile: { id: profile.id, name: profile.name, key: profile.system_key } });
}));

// Ricalcola gli ambiti dei grant nati da un profilo per tutti gli utenti esterni della Legal entity (nuovo punto prelievi ospitato,
// nuova sede SERVICE collegata). I grant manuali non si toccano.
r.post('/organizations/:id/realign-perimeters', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const org = await one('SELECT id, name FROM organizations WHERE id=$1', [id]);
  if (!org) throw notFound('Legal entity inesistente');
  const report = await realignOrgPerimeters(id, { actorId: req.user.id });
  await audit(req, 'EXTERNAL_PERIMETERS_REALIGNED', { entity: 'organization', entityId: id, label: `${org.name}: ${report.changed} grant riallineati su ${report.users} utenti`, data: { users: report.users, grants: report.grants, changed: report.changed, warnings: report.warnings.slice(0, 50), context: report.context } });
  res.json(report);
}));

export default r;
