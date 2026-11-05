// Regola (25/10/2026): ogni utente è una persona dell'anagrafica. L'accesso nasce dalla persona quando è ATTIVA e ha un'email:
// Microsoft 365 per i domini aziendali, credenziali locali con invito per gli altri. I moduli li assegna un amministratore;
// dall'area organizzativa nascono proposte di grant (da confermare in Amministrazione > Utenti).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { displayName, normName, audit, getSetting } from './util.js';
import { sendMail, layout } from './mailer.js';
import { AREA_GRANT_PROPOSALS } from '../seed/modules.js';
import { proposeGrantsForPerson } from './grantRules.js';
import { applyDefaultProfile } from './accessProfiles.js';

const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}A1!`;

// Account automatico solo per i domini aziendali (decisione del CEO del 05/11/2026, debug pre-produzione M9): elenco configurabile in
// app_settings 'accounts.domini_automatici' (predefinito: i domini interni, AUTO_INTERNAL_DOMAINS). Per le altre email (medici, fornitori,
// candidati, partner e clienti) nessun account nasce da solo: lo si crea dal pulsante "Crea accesso" della Legal entity, da Utenti o
// dalla scheda persona. Vale per Persone, Contratti del personale e importazioni XLSX.
export async function dominiAutomatici() {
  const v = await getSetting('accounts.domini_automatici', null).catch(() => null);
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : config.autoInternalDomains;
  return list.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}
export const dominioDi = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';
export async function accountAutomatico(email) {
  return (await dominiAutomatici()).includes(dominioDi(email));
}

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
  await marcaEsterno(u.id);
  const proposals = await proposeGrantsForPerson(p.id, actor?.id);
  // ogni nuovo account parte col profilo di accesso predefinito (Default), in merge: le proposte restano, i grant mancanti nascono confermati
  const def = await applyDefaultProfile(u.id, actor?.id).catch((e) => { console.warn('[accounts] profilo predefinito:', e.message); return null; });
  await audit({ user: actor, ip: null }, 'USER_CREATED_FROM_PERSON', { entity: 'user', entityId: u.id, label: `${email} (${provider}) da persona ${p.id}`, data: { person_id: p.id, proposals, default_profile: def ? { id: def.profile.id, added: def.added, updated: def.updated } : null } });
  if (sendInvite) {
    const hint = provider === 'ENTRA'
      ? `<p>Accedi con il tuo account Microsoft 365 aziendale: <a href="${config.baseUrl}">${config.baseUrl}</a></p>`
      : `<p>Accedi su <a href="${config.baseUrl}">${config.baseUrl}</a> con questa email e la password provvisoria <code>${plain}</code>: al primo accesso dovrai sceglierne una nuova.</p>`;
    sendMail({ to: email, subject: 'Benvenuto in Suite TD', ref: `invite:${u.id}`, html: layout(`Benvenuto, ${p.first_name}`, `<p>È stato creato il tuo accesso a <b>Suite TD</b>, l'intranet e operating suite di Toscana Diagnostica.</p>${hint}`) })
      .catch((e) => console.warn('[accounts] invito non inviato:', e.message));
  }
  return { user: u, created: true, provider, temporaryPassword: plain };
}

/**
 * Marca come esterno (users.is_external, debug pre-produzione A2) l'accesso che nasce esterno: livello USER, email fuori dai domini
 * aziendali e Legal entity (della persona o dell'utente) non del gruppo. Il segno non si toglie mai da qui: un esterno torna interno
 * solo da Amministrazione > Utenti (scelta esplicita, con audit). Ritorna true se l'utente è (o era già) esterno.
 */
export async function marcaEsterno(userId) {
  const r = await one(`UPDATE users u SET is_external = TRUE, updated_at = now()
      FROM users x LEFT JOIN people p ON p.id = x.person_id LEFT JOIN organizations o ON o.id = coalesce(p.organization_id, x.organization_id)
     WHERE u.id = x.id AND u.id = $1 AND NOT u.is_external AND u.level = 'USER'
       AND coalesce(o.kind, '') NOT IN ('GRUPPO','SOCIETA') AND NOT (lower(split_part(u.email, '@', 2)) = ANY($2::text[]))
     RETURNING u.id`, [userId, config.autoInternalDomains]);
  if (r) return true;
  return Boolean((await one('SELECT is_external FROM users WHERE id=$1', [userId]))?.is_external);
}

/** Sede, legal entity, nomi, titolo e telefono dell'utente vengono dalla persona: una sola anagrafica, nessuna copia da compilare. */
export async function syncUserFromPerson(personId) {
  await q(`UPDATE users u SET first_name=p.first_name, last_name=p.last_name, full_name=p.last_name || ' ' || p.first_name, title=p.title, phone=p.phone,
      site_id=p.site_id, organization_id=coalesce(p.organization_id, s.organization_id), updated_at=now()
    FROM people p LEFT JOIN sites s ON s.id=p.site_id WHERE u.person_id=p.id AND p.id=$1`, [personId]);
}

/** Da chiamare quando una persona cambia: se è attiva con un'email di un dominio automatico e non ha accesso, l'accesso nasce da solo
 *  (senza bloccare il chiamante). Per le altre email nessun account automatico (M9). */
export function autoAccountForPerson(personId, actor) {
  syncUserFromPerson(personId).catch((e) => console.warn('[accounts] sync', e.message));
  proposeGrantsForPerson(personId, actor?.id).catch((e) => console.warn('[accounts] regole', e.message));
  (async () => {
    const p = await one('SELECT email FROM people WHERE id=$1', [personId]);
    if (!p?.email || !(await accountAutomatico(p.email))) return;
    await ensureUserForPerson(personId, { actor, onlyIfActive: true });
  })().catch((e) => { if (!/email|stato/.test(e.message)) console.warn('[accounts]', e.message); });
}

/** Accessi mancanti: ogni persona ATTIVA con un'email dei domini automatici (M9) ha un account (Microsoft 365 per i domini aziendali).
 *  Le persone con altre email non ricevono un account in blocco: si contano in skipped_other_domains (accesso dalla Legal entity o da
 *  Utenti). Ritorna il riepilogo. */
export async function createMissingAccounts({ actor = null, sendInvite = false } = {}) {
  const domini = await dominiAutomatici();
  const all = await many(`SELECT p.id, p.email FROM people p WHERE p.status='ATTIVO' AND p.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.person_id=p.id) AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(p.email)) ORDER BY p.last_name`);
  const rows = all.filter((r) => domini.includes(dominioDi(r.email)));
  const out = { created: 0, entra: 0, local: 0, errors: [], skipped_other_domains: all.length - rows.length };
  for (const r of rows) {
    try { const res = await ensureUserForPerson(r.id, { actor, sendInvite, onlyIfActive: true }); if (res.created) { out.created++; out[res.provider === 'ENTRA' ? 'entra' : 'local']++; } }
    catch (e) { out.errors.push(`${r.id}: ${e.message}`); }
  }
  // persone attive con email che hanno già un utente con la stessa email ma non collegato
  await q(`UPDATE users u SET person_id=p.id FROM people p WHERE u.person_id IS NULL AND lower(u.email)=lower(p.email)`);
  return out;
}

/** Utenti senza persona (eredità): elenco per l'Amministrazione */
export async function usersWithoutPerson() {
  return many(`SELECT id, email, full_name, level FROM users WHERE person_id IS NULL AND level <> 'OWNER' ORDER BY full_name`);
}
