import { isInternal } from '../lib/audience.js';
import { displayName, splitName } from '../lib/util.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, HttpError } from '../lib/util.js';
import { hydrateUser, isAdmin } from '../lib/access.js';
import { beginLogin, completeLogin } from '../lib/entra.js';
import { clienteService } from '../lib/esterni.js';
import { statoPer } from '../lib/consensi.js';

const r = Router();
const TROPPI = { error: 'Troppi tentativi. Riprova tra qualche minuto.' };
// Rate limit del login (debug pre-produzione, M3): contano solo i tentativi falliti. Due limiti: per coppia IP + email (25 in 15 minuti,
// chi sbaglia la propria password non blocca i colleghi dietro lo stesso NAT) e per IP (100 falliti in 15 minuti, contro chi prova
// molte email diverse). Il blocco dell'account dopo 5 errori resta (MAX_FAILED).
const emailDi = (req) => String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${emailDi(req)}`, message: TROPPI });
const loginIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: TROPPI });
// Codice TOTP, password dimenticata e reimpostazione: per IP, contano tutte le richieste (la risposta di /forgot è sempre 200)
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false, message: TROPPI });
const MAX_FAILED = 5, LOCK_MIN = 15;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);
const regenerate = (req) => new Promise((res, rej) => req.session.regenerate((e) => (e ? rej(e) : res())));

// Sessione completamente autenticata (debug pre-produzione, B2 e B3): password verificata, secondo fattore verificato se attivo,
// utente attivo e, salvo il cambio password stesso, password provvisoria già cambiata. Le operazioni sull'account (TOTP, password,
// profilo) seguono le stesse regole di requireAuth: con il solo primo fattore non si tocca nulla.
function sessioneCompleta(req, { ammettiCambioPassword = false } = {}) {
  if (!req.session?.userId) throw new HttpError(401, 'Non autenticato');
  if (req.session.totpPending) throw Object.assign(new HttpError(403, 'Verifica a due fattori richiesta'), { code: 'TOTP_REQUIRED' });
  if (!req.user) {
    if (req.pendingUser) throw Object.assign(new HttpError(403, 'Account in attesa di abilitazione'), { code: 'PENDING' });
    throw new HttpError(401, 'Non autenticato');
  }
  if (!ammettiCambioPassword && req.user.must_change_password && req.session.authMethod === 'LOCAL') {
    throw Object.assign(new HttpError(403, 'Cambio password obbligatorio'), { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  return req.user;
}
// Chiude le altre sessioni dell'utente (cambio password, disattivazione del secondo fattore): resta valida solo quella corrente
async function chiudiAltreSessioni(req, userId) {
  await q(`DELETE FROM session WHERE (sess->>'userId')::text = $1 AND sid <> $2`, [String(userId), req.sessionID || '']).catch((e) => console.warn('[auth] sessioni', e.message));
}

export const publicUser = (u) => u && ({
  id: u.id, email: u.email, full_name: u.full_name, first_name: u.first_name, last_name: u.last_name, title: u.title, phone: u.phone, level: u.level, status: u.status,
  auth_provider: u.auth_provider, must_change_password: u.must_change_password, totp_enabled: u.totp_enabled, lang: u.lang,
  organization_id: u.organization_id, organization_name: u.organization_name, site_id: u.site_id, site_name: u.site_name, site_code: u.site_code,
  person_id: u.person_id, person_area: u.person_area, person_job_title: u.person_job_title, avatar_file_id: u.avatar_file_id, bio: u.bio,
  notify_email: u.notify_email, is_internal: isInternal(u), is_external: !isInternal(u), organization_kind: u.organization_kind, grants: u.grants || {}, site_ids: u.site_ids || [], org_ids: u.org_ids || [],
  needs_totp: Boolean(config.requireTotpForAdmins && isAdmin(u) && !u.totp_enabled && u.auth_provider !== 'ENTRA'),
});

async function finishLogin(req, user, method) {
  await regenerate(req);
  req.session.userId = user.id;
  req.session.authMethod = method;
  // Accesso locale con TOTP attivo: la sessione resta sospesa finché il codice non viene verificato
  req.session.totpPending = method === 'LOCAL' && user.totp_enabled;
  await q('UPDATE users SET last_login_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [user.id]);
  await audit({ user, ip: req.ip }, 'LOGIN', { entity: 'user', entityId: user.id, data: { method } });
}

r.get('/config', (_req, res) => res.json({
  appName: config.appName, tagline: config.appTagline, entraEnabled: config.entra.enabled, blobEnabled: config.blob.enabled,
  aiEnabled: config.anthropic.enabled, mailProvider: config.mail.provider, baseUrl: config.baseUrl,
}));

r.get('/me', ah(async (req, res) => {
  if (req.session?.totpPending && req.session.userId) {
    return res.json({ user: null, totpRequired: true, authMethod: 'LOCAL' });
  }
  // cliente_service: accesso esterno riconosciuto come Cliente service (lib/esterni.js): il front-end mostra "Il mio spazio" nel Portale Service
  // consensi_da_accettare: informative (PRIVACY, IA) non ancora accettate nella versione corrente; il front-end mostra la presa d'atto
  // dopo l'eventuale cambio password e prima della Home (lib/consensi.js)
  if (req.user) {
    const [cliente, cons] = await Promise.all([clienteService(req.user).catch(() => null), statoPer(req.user.id)]);
    return res.json({ user: { ...publicUser(req.user), cliente_service: Boolean(cliente), consensi_da_accettare: cons.daAccettare, informative: cons.informative }, authMethod: req.session.authMethod, pending: false });
  }
  if (req.pendingUser) return res.json({ user: publicUser(req.pendingUser), authMethod: req.session.authMethod, pending: true });
  res.status(401).json({ error: 'Non autenticato' });
}));

r.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, 'LOGOUT', { entity: 'user', entityId: req.user.id });
  req.session.destroy(() => res.json({ ok: true }));
}));

// ---- credenziali locali (esterni: sedi ospitanti, clienti service, medici senza account aziendale)
r.post('/login', loginIpLimiter, loginLimiter, ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const u = await one('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
  const generic = new HttpError(401, 'Credenziali non valide');
  if (!u || u.status === 'DISABLED' || !u.password_hash || u.auth_provider === 'ENTRA') { await bcrypt.compare(password, DUMMY_HASH); throw generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporaneamente bloccato per troppi tentativi. Riprova più tardi.');
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const failed = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MIN} minutes' ELSE NULL END WHERE id=$1`, [u.id, failed]);
    await audit({ user: u, ip: req.ip }, 'LOGIN_FAILED', { entity: 'user', entityId: u.id });
    throw generic;
  }
  await finishLogin(req, u, 'LOCAL');
  res.json({ ok: true, pending: u.status === 'PENDING', mustChangePassword: u.must_change_password, totpRequired: u.totp_enabled });
}));

// Secondo fattore (TOTP) dopo la password
r.post('/totp/verify', authLimiter, ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  if (!req.session.userId || !req.session.totpPending) throw bad('Nessuna verifica in corso');
  const u = await one('SELECT id, totp_secret FROM users WHERE id=$1', [req.session.userId]);
  if (!u?.totp_secret || !authenticator.check(code, u.totp_secret)) { await audit({ user: u, ip: req.ip }, 'TOTP_FAILED', { entity: 'user', entityId: u?.id }); throw new HttpError(401, 'Codice non valido'); }
  req.session.totpPending = false;
  res.json({ ok: true });
}));

// Attivazione TOTP dal profilo: solo con la sessione completa (mai durante la verifica del secondo fattore in sospeso)
r.post('/totp/setup', ah(async (req, res) => {
  sessioneCompleta(req);
  const secret = authenticator.generateSecret();
  req.session.totpSetup = secret;
  const uri = authenticator.keyuri(req.user.email, 'Suite TD', secret);
  res.json({ secret, qr: await QRCode.toDataURL(uri) });
}));
r.post('/totp/enable', ah(async (req, res) => {
  sessioneCompleta(req);
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const secret = req.session.totpSetup;
  if (!secret || !authenticator.check(code, secret)) throw bad('Codice non valido: riprova con il codice attuale dell\'app');
  await q('UPDATE users SET totp_secret=$2, totp_enabled=TRUE, updated_at=now() WHERE id=$1', [req.user.id, secret]);
  delete req.session.totpSetup;
  await audit(req, 'TOTP_ENABLED', { entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
}));
// Disattivazione: sessione completa, password corrente e codice attuale dell'app (chi ha solo la password non spegne il secondo fattore)
r.post('/totp/disable', authLimiter, ah(async (req, res) => {
  sessioneCompleta(req);
  const { password, code } = parse(z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/, 'codice a sei cifre dell\'app') }), req.body);
  const u = await one('SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id=$1', [req.user.id]);
  if (!u.password_hash || !(await bcrypt.compare(password, u.password_hash))) throw bad('Password errata');
  if (u.totp_enabled && (!u.totp_secret || !authenticator.check(code, u.totp_secret))) throw bad('Codice non valido: inserisci il codice attuale dell\'app di autenticazione');
  await q('UPDATE users SET totp_secret=NULL, totp_enabled=FALSE, updated_at=now() WHERE id=$1', [req.user.id]);
  await chiudiAltreSessioni(req, req.user.id);
  await audit(req, 'TOTP_DISABLED', { entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
}));

export const pwdSchema = z.string().min(12, 'minimo 12 caratteri').regex(/[A-Z]/, 'serve una maiuscola').regex(/[a-z]/, 'serve una minuscola').regex(/\d/, 'serve un numero');
r.post('/change-password', authLimiter, ah(async (req, res) => {
  // mai con il secondo fattore in sospeso; ammesso invece con la password provvisoria (è proprio il cambio obbligatorio)
  if (req.session?.totpPending) throw Object.assign(new HttpError(403, 'Verifica a due fattori richiesta'), { code: 'TOTP_REQUIRED' });
  const u0 = req.user || req.pendingUser || (req.session.userId ? await hydrateUser(req.session.userId) : null);
  if (!u0) throw new HttpError(401, 'Non autenticato');
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: pwdSchema }), req.body);
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [u0.id]);
  if (!u.password_hash || !(await bcrypt.compare(currentPassword, u.password_hash))) throw bad('Password attuale errata');
  if (currentPassword === newPassword) throw bad('La nuova password deve essere diversa');
  await q('UPDATE users SET password_hash=$2, must_change_password=FALSE, updated_at=now() WHERE id=$1', [u0.id, await bcrypt.hash(newPassword, 12)]);
  await chiudiAltreSessioni(req, u0.id);   // L11: le altre sessioni (altri dispositivi, chi ha rubato la password) si chiudono
  await audit({ user: u0, ip: req.ip }, 'PASSWORD_CHANGED', { entity: 'user', entityId: u0.id });
  res.json({ ok: true });
}));

// Password dimenticata: token via email (valido 30 minuti). Risposta sempre identica per non rivelare gli indirizzi
r.post('/forgot', authLimiter, ah(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  const u = await one(`SELECT id, email, full_name FROM users WHERE lower(email)=lower($1) AND status<>'DISABLED' AND auth_provider IN ('LOCAL','BOTH')`, [email]);
  if (u) {
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(24).toString('base64url');
    await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [`reset:${createHash('sha256').update(token).digest('hex')}`, JSON.stringify({ user_id: u.id, exp: Date.now() + 30 * 60 * 1000 })]);
    const { sendMail, layout } = await import('../lib/mailer.js');
    const link = `${config.baseUrl}/reset?token=${token}`;
    await sendMail({ to: u.email, subject: 'Suite TD · reimposta la password', ref: `reset:${u.id}`,
      html: layout('Reimposta la tua password', `<p>Ciao ${u.full_name},</p><p>hai chiesto di reimpostare la password di accesso a Suite TD. Il collegamento vale 30 minuti.</p><p><a href="${link}" style="background:#1C505E;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Scegli una nuova password</a></p><p style="color:#5b6f75;font-size:12px">Se non sei stato tu, ignora questo messaggio: la password attuale resta valida.</p>`) });
  }
  res.json({ ok: true });
}));
r.post('/reset', authLimiter, ah(async (req, res) => {
  const { token, newPassword } = parse(z.object({ token: z.string().min(10), newPassword: pwdSchema }), req.body);
  const { createHash } = await import('node:crypto');
  const key = `reset:${createHash('sha256').update(token).digest('hex')}`;
  const row = await one('SELECT value FROM app_settings WHERE key=$1', [key]);
  if (!row || row.value.exp < Date.now()) throw bad('Collegamento scaduto o non valido');
  await q('UPDATE users SET password_hash=$2, must_change_password=FALSE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [row.value.user_id, await bcrypt.hash(newPassword, 12)]);
  await q('DELETE FROM app_settings WHERE key=$1', [key]);
  await q(`DELETE FROM session WHERE (sess->>'userId')::text = $1`, [String(row.value.user_id)]).catch(() => {});   // L11: tutte le sessioni
  await audit({ user: { id: row.value.user_id }, ip: req.ip }, 'PASSWORD_RESET', { entity: 'user', entityId: row.value.user_id });
  res.json({ ok: true });
}));

// Profilo personale (debug pre-produzione, B3): solo i campi della persona che usa la Suite (telefono, titolo, presentazione,
// preferenze). Sede, Legal entity, livello, ruoli e grant si cambiano solo da Amministrazione; per gli esterni il perimetro viene
// sempre dalla Legal entity. Un campo non ammesso (site_id, organization_id, level, ...) viene rifiutato, non ignorato in silenzio.
const meSchema = z.object({
  phone: z.string().max(40).nullable().optional(), bio: z.string().max(4000).nullable().optional(), notify_email: z.boolean().optional(),
  lang: z.enum(['it', 'en']).optional(), title: z.string().max(20).nullable().optional(),
}).strict();
r.put('/me', ah(async (req, res) => {
  sessioneCompleta(req);
  const extra = Object.keys(req.body || {}).filter((k) => !Object.keys(meSchema.shape).includes(k));
  if (extra.length) throw Object.assign(new HttpError(403, `Campi non modificabili dal profilo: ${extra.join(', ')} (si cambiano da Amministrazione)`), { code: 'CAMPI_RISERVATI' });
  const b = parse(meSchema, req.body);
  await q(`UPDATE users SET phone=coalesce($2,phone), bio=coalesce($3,bio), notify_email=coalesce($4,notify_email), lang=coalesce($5,lang),
           title=coalesce($6,title), updated_at=now() WHERE id=$1`,
    [req.user.id, b.phone ?? null, b.bio ?? null, b.notify_email ?? null, b.lang ?? null, b.title ?? null]);
  res.json({ ok: true });
}));

// ---- Microsoft Entra ID
// Ritorno dopo l'accesso (debug pre-produzione, M4): solo percorsi interni. "//host", "/\\host" e schemi (javascript:, https:)
// porterebbero fuori dalla Suite (open redirect); in quel caso si torna alla Home.
export function percorsoInterno(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.length > 2000) return '/';
  if (/^\/[\/\\]/.test(next) || /[\u0000-\u001f\\]/.test(next)) return '/';
  try { const u = new URL(next, 'http://suite.invalid'); if (u.origin !== 'http://suite.invalid') return '/'; return u.pathname + u.search + u.hash; } catch { return '/'; }
}
r.get('/entra/login', ah(async (req, res) => {
  if (!config.entra.enabled) throw bad('Accesso Microsoft non configurato');
  const { url, state, nonce, verifier } = beginLogin();
  req.session.oidc = { state, nonce, verifier, at: Date.now(), next: percorsoInterno(req.query.next) };
  res.redirect(url);
}));

r.get('/entra/callback', ah(async (req, res) => {
  const fail = (m) => res.redirect(`/login?error=${encodeURIComponent(m)}`);
  const o = req.session.oidc;
  delete req.session.oidc;
  if (!o || Date.now() - o.at > 10 * 60 * 1000) return fail('Sessione di accesso scaduta, riprova');
  if (req.query.error) return fail(`Accesso Microsoft non riuscito: ${req.query.error_description || req.query.error}`);
  if (req.query.state !== o.state || !req.query.code) return fail('Risposta di accesso non valida');
  let claims;
  try { claims = await completeLogin({ code: String(req.query.code), verifier: o.verifier, nonce: o.nonce }); }
  catch (e) { console.error('[entra]', e.message); return fail(e.code === 'TENANT' ? e.message : 'Accesso Microsoft non riuscito'); }

  let u = await one('SELECT * FROM users WHERE entra_oid=$1 OR lower(email)=$2 ORDER BY (entra_oid=$1) DESC LIMIT 1', [claims.oid, claims.email]);
  if (!u) {
    // Primo accesso: dominio aziendale → utente attivo con la sola Community (i moduli li assegnano Owner e Admin); altri domini → in attesa
    const domain = claims.email.split('@')[1];
    const internal = config.autoInternalDomains.includes(domain);
    const td = internal ? await one(`SELECT id FROM organizations WHERE code='TD'`) : null;
    const person = await one('SELECT id, site_id, first_name, last_name FROM people WHERE lower(email)=$1 ORDER BY status=\'ATTIVO\' DESC LIMIT 1', [claims.email]);
    const nm = person ? { first_name: person.first_name, last_name: person.last_name } : claims.family_name ? { first_name: claims.given_name || '', last_name: claims.family_name } : splitName(claims.name);
    u = await one(
      `INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, organization_id, person_id, site_id, entra_tid, entra_oid, is_external)
       VALUES ($1,$2,$3,$4,'USER',$5,'ENTRA',$6,$7,$8,$9,$10,$11) RETURNING *`,
      [claims.email, displayName(nm.last_name, nm.first_name) || claims.name, nm.first_name, nm.last_name, internal ? 'ACTIVE' : 'PENDING', td?.id || null, person?.id || null, person?.site_id || null, claims.tid, claims.oid, !internal]);
    await audit({ user: u, ip: req.ip }, 'USER_SELF_REGISTERED', { entity: 'user', entityId: u.id, label: `${u.email} (${u.status})` });
  } else {
    if (u.status === 'DISABLED') return fail(`Account ${claims.email} disabilitato. Contatta l'amministratore.`);
    if (u.auth_provider === 'LOCAL') await q(`UPDATE users SET auth_provider='BOTH' WHERE id=$1`, [u.id]);
    if (config.seed.ownerEmail && claims.email === config.seed.ownerEmail && u.level !== 'OWNER') await q(`UPDATE users SET level='OWNER', status='ACTIVE' WHERE id=$1`, [u.id]);
    // nomi mancanti (utente creato dall'email): dai claim Entra, in forma Cognome Nome
    const nm = claims.family_name ? { first_name: claims.given_name || '', last_name: claims.family_name } : splitName(claims.name);
    await q(`UPDATE users SET entra_oid=coalesce(entra_oid,$2), entra_tid=coalesce(entra_tid,$3),
             first_name = CASE WHEN coalesce(first_name,'')='' AND coalesce(last_name,'')='' THEN $4 ELSE first_name END,
             last_name  = CASE WHEN coalesce(first_name,'')='' AND coalesce(last_name,'')='' THEN $5 ELSE last_name END,
             full_name  = CASE WHEN coalesce(first_name,'')='' AND coalesce(last_name,'')='' THEN coalesce(nullif($6,''), full_name) ELSE full_name END WHERE id=$1`,
      [u.id, claims.oid, claims.tid, nm.first_name, nm.last_name, displayName(nm.last_name, nm.first_name)]);
  }
  await finishLogin(req, u, 'ENTRA');
  res.redirect(percorsoInterno(o.next));
}));

export default r;
