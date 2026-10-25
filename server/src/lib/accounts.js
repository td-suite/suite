// Regola (25/10/2026): ogni utente è una persona dell'anagrafica. L'accesso nasce dalla persona quando è ATTIVA e ha un'email:
// Microsoft 365 per i domini aziendali, credenziali locali con invito per gli altri. I moduli li assegna un amministratore;
// dall'area organizzativa nascono proposte di grant (da confermare in Amministrazione > Utenti).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { displayName, normName, audit } from './util.js';
import { sendMail, layout } from './mailer.js';
import { AREA_GRANT_PROPOSALS } from '../seed/modules.js';

const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}A1!`;

export async function proposeGrantsFromArea(userId, area, createdBy) {
  if (!area) return 0;
  const a = normName(area);
  let n = 0;
  for (const [k, pairs] of Object.entries(AREA_GRANT_PROPOSALS)) {
    const nk = normName(k);
    if (!nk || !(a === nk || a.includes(nk) || nk.includes(a))) continue;
    for (const [mod, prof] of pairs) {
      if (mod === 'contracts') continue;   // il modulo riservato non si propone mai
      const r = await q(`INSERT INTO grants (user_id, module_key, profile, proposed, source, created_by) VALUES ($1,$2,$3,TRUE,'ORG',$4) ON CONFLICT (user_id, module_key) DO NOTHING`, [userId, mod, prof, createdBy || null]);
      n += r.rowCount || 0;
    }
  }
  return n;
}

/**
 * Crea (o aggancia) l'accesso di una persona. Ritorna { user, created, provider, temporaryPassword }.
 * - persona senza email: nessun accesso (errore con messaggio chiaro se richiesto esplicitamente)
 * - utente già esistente con la stessa email: viene collegato alla persona e allineato (nomi, sede)
 * opts: { sendInvite (default true), level ('USER'), actor (utente che agisce, per audit), onlyIfActive (default true) }
 */
export async function ensureUserForPerson(personId, opts = {}) {
  const { sendInvite = true, level = 'USER', actor = null, onlyIfActive = true } = opts;
  const p = await one('SELECT * FROM people WHERE id=$1', [personId]);
  if (!p) throw new Error('Persona non trovata');
  if (!p.email) throw new Error('La persona non ha un\'email: senza email non si crea l\'accesso');
  if (onlyIfActive && p.status !== 'ATTIVO') throw new Error(`La persona è in stato ${p.status}: l'accesso nasce quando diventa ATTIVA (assunzione o incarico)`);
  const email = p.email.toLowerCase();
  const full = displayName(p.last_name, p.first_name);
  let u = await one('SELECT * FROM users WHERE lower(email)=$1', [email]);
  if (u) {
    await q('UPDATE users SET person_id=$2 WHERE id=$1', [u.id, p.id]);
    await syncUserFromPerson(p.id);
    u = await one('SELECT * FROM users WHERE id=$1', [u.id]);
    return { user: u, created: false, provider: u.auth_provider, temporaryPassword: null };
  }
  const internal = config.autoInternalDomains.includes(email.split('@')[1]);
  const provider = internal ? 'ENTRA' : 'LOCAL';
  const plain = provider === 'LOCAL' ? genPassword() : null;
  u = await one(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, site_id, person_id, password_hash, must_change_password, created_by)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11) RETURNING *`,
    [email, full, p.first_name, p.last_name, level, provider, p.site_id, p.id, plain ? await bcrypt.hash(plain, 12) : null, Boolean(plain), actor?.id || null]);
  await syncUserFromPerson(p.id);
  const proposals = await proposeGrantsFromArea(u.id, p.area, actor?.id);
  await audit({ user: actor, ip: null }, 'USER_CREATED_FROM_PERSON', { entity: 'user', entityId: u.id, label: `${email} (${provider}) da persona ${p.id}`, data: { person_id: p.id, proposals } });
  if (sendInvite) {
    const hint = provider === 'ENTRA'
      ? `<p>Accedi con il tuo account Microsoft 365 aziendale: <a href="${config.baseUrl}">${config.baseUrl}</a></p>`
      : `<p>Accedi su <a href="${config.baseUrl}">${config.baseUrl}</a> con questa email e la password provvisoria <code>${plain}</code>: al primo accesso dovrai sceglierne una nuova.</p>`;
    sendMail({ to: email, subject: 'Benvenuto in Suite TD', ref: `invite:${u.id}`, html: layout(`Benvenuto, ${p.first_name}`, `<p>È stato creato il tuo accesso a <b>Suite TD</b>, l'intranet e operating suite di Toscana Diagnostica.</p>${hint}`) })
      .catch((e) => console.warn('[accounts] invito non inviato:', e.message));
  }
  return { user: u, created: true, provider, temporaryPassword: plain };
}

/** Sede, legal entity, nomi, titolo e telefono dell'utente vengono dalla persona: una sola anagrafica, nessuna copia da compilare. */
export async function syncUserFromPerson(personId) {
  await q(`UPDATE users u SET first_name=p.first_name, last_name=p.last_name, full_name=p.last_name || ' ' || p.first_name, title=p.title, phone=p.phone,
      site_id=p.site_id, organization_id=coalesce(p.organization_id, s.organization_id), updated_at=now()
    FROM people p LEFT JOIN sites s ON s.id=p.site_id WHERE u.person_id=p.id AND p.id=$1`, [personId]);
}

/** Da chiamare quando una persona cambia: se è attiva con email e non ha accesso, l'accesso nasce da solo (senza bloccare il chiamante). */
export function autoAccountForPerson(personId, actor) {
  syncUserFromPerson(personId).catch((e) => console.warn('[accounts] sync', e.message));
  ensureUserForPerson(personId, { actor, onlyIfActive: true }).catch((e) => { if (!/email|stato/.test(e.message)) console.warn('[accounts]', e.message); });
}

/** Utenti senza persona (eredità): elenco per l'Amministrazione */
export async function usersWithoutPerson() {
  return many(`SELECT id, email, full_name, level FROM users WHERE person_id IS NULL AND level <> 'OWNER' ORDER BY full_name`);
}
