import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Issuer, generators } from 'openid-client';
import { many } from '../db.js';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, HttpError } from '../lib/util.js';
import { requireAuth, onboardingState } from '../lib/access.js';
import { suiteSsoRoute } from '../lib/suiteSso.js';

const r = Router();
authenticator.options = { window: 1 };

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Troppi tentativi. Riprova tra qualche minuto.' } });

const MAX_FAILED = 5;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);
const LOCK_MIN = 15;

function regenerate(req) {
  return new Promise((res, rej) => req.session.regenerate((e) => (e ? rej(e) : res())));
}

async function completeLogin(req, user, method) {
  await regenerate(req); // previene session fixation
  req.session.userId = user.id;
  req.session.authMethod = method;
  await q('UPDATE users SET last_login_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [user.id]);
  req.user = user;
  await audit(req, 'LOGIN', 'user', user.id, { method });
}

// ---- Accesso dalla Suite TD (SSO): token HS256 firmato dalla Suite con SUITE_SSO_SECRET, verificato in lib/suiteSso.js.
// Rotta pubblica (la protezione è il token). Metodo di sessione 'SUITE': l'utente è già autenticato dalla Suite (con TOTP se richiesto),
// quindi onboardingState non impone cambio password o TOTP locali (controlla authMethod === 'LOCAL').
const SUITE_ROLES = ['ADMIN', 'PLANNER', 'VIEWER', 'PROF', 'RESP_SAN'];
const roleFromSuiteProfile = (profile, p) => (SUITE_ROLES.includes(profile) ? profile : p.level === 'OWNER' ? 'ADMIN' : 'VIEWER');

r.get('/suite', suiteSsoRoute({
  secret: process.env.SUITE_SSO_SECRET || '',
  audience: 'room',
  issuer: (process.env.SUITE_URL || 'https://suite.toscanadiagnostica.it').replace(/\/$/, ''),
  roleFromProfile: roleFromSuiteProfile,
  async findOrCreateUser(p, req) {
    let u = await one('SELECT * FROM users WHERE lower(email)=$1', [p.email]);
    if (u && !u.active) return null;   // disattivato in Room Planning: la Suite non riapre l'accesso
    if (!u) {
      u = await one(`INSERT INTO users (email, full_name, role, auth_provider, must_change_password) VALUES ($1,$2,$3,'ENTRA',FALSE) RETURNING *`, [p.email, p.name || p.email, p.role]);
      await audit({ ...req, user: u }, 'USER_AUTOPROVISION', 'user', u.id, { email: p.email, role: u.role, via: 'SUITE' });
    } else if (p.profile && u.role !== p.role) {
      // Il profilo assegnato in Suite è la fonte dei permessi: allinea il ruolo locale (tranne gli amministratori locali, che restano tali)
      if (u.role !== 'ADMIN' || p.level === 'OWNER') {
        u = await one('UPDATE users SET role=$2, updated_at=now() WHERE id=$1 RETURNING *', [u.id, p.role]);
        await audit({ ...req, user: u }, 'USER_ROLE_FROM_SUITE', 'user', u.id, { role: p.role, profile: p.profile });
      }
    }
    // Sedi assegnate (PLANNER/VIEWER con ambiti): site_codes = "<codice Suite>|<id struttura in Room Planning>"
    const ids = (p.site_codes || []).map((c) => String(c).split('|')[1]).filter(Boolean);
    if (ids.length && ['PLANNER', 'VIEWER'].includes(u.role)) {
      const existing = (await many('SELECT id FROM strutture WHERE id = ANY($1::text[]) AND deleted_at IS NULL', [ids])).map((x) => x.id);
      if (existing.length) {
        await q('DELETE FROM user_strutture WHERE user_id=$1', [u.id]);
        for (const id of existing) await q('INSERT INTO user_strutture VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, id]);
      }
    }
    return u;
  },
  async finishLogin(req, user) { await completeLogin(req, user, 'SUITE'); },
}));

r.get('/config', (_req, res) => {
  res.json({ entraEnabled: config.entra.enabled, appName: config.appName, autoProvision: Boolean(config.entra.autoProvisionRole) });
});

r.post('/login', loginLimiter, ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const u = await one('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
  const generic = new HttpError(401, 'Credenziali non valide');
  if (!u || !u.active || !u.password_hash || u.auth_provider === 'ENTRA') {
    await bcrypt.compare(password, DUMMY_HASH); // tempo costante
    throw generic;
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new HttpError(423, 'Account temporaneamente bloccato per troppi tentativi. Riprova più tardi.');
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const failed = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MIN} minutes' ELSE NULL END WHERE id=$1`, [u.id, failed]);
    await audit(req, 'LOGIN_FAILED', 'user', u.id);
    throw generic;
  }
  if (u.totp_enabled) {
    await regenerate(req);
    req.session.pendingUserId = u.id;
    req.session.pendingAt = Date.now();
    return res.json({ totpRequired: true });
  }
  await completeLogin(req, u, 'LOCAL');
  res.json({ ok: true, onboarding: onboardingState(req) });
}));

r.post('/totp', loginLimiter, ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const id = req.session.pendingUserId;
  if (!id || Date.now() - (req.session.pendingAt || 0) > 5 * 60 * 1000) throw new HttpError(401, 'Sessione di accesso scaduta, ripeti il login');
  const u = await one('SELECT * FROM users WHERE id=$1 AND active', [id]);
  if (!u || !authenticator.check(code, u.totp_secret)) {
    await audit(req, 'TOTP_FAILED', 'user', id);
    throw new HttpError(401, 'Codice non valido');
  }
  await completeLogin(req, u, 'LOCAL');
  res.json({ ok: true, onboarding: onboardingState(req) });
}));

r.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, 'LOGOUT', 'user', req.user.id);
  req.session.destroy(() => res.json({ ok: true }));
}));

r.get('/me', ah(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  res.json({ user: req.user, authMethod: req.session.authMethod, onboarding: onboardingState(req) });
}));

// Inviti dei professionisti: verifica del token e impostazione della password (pubblici)
import crypto from 'node:crypto';
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
async function invitoValido(token) {
  const inv = await one('SELECT i.*, u.email, u.full_name, u.active FROM inviti i JOIN users u ON u.id=i.user_id WHERE i.token_hash=$1', [tokenHash(token)]);
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date() || !inv.active) return null;
  return inv;
}
r.get('/invito/:token', ah(async (req, res) => {
  const inv = await invitoValido(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invito non valido o scaduto: chiedi un nuovo invito al Responsabile del personale sanitario' });
  res.json({ email: inv.email, nome: inv.full_name });
}));
r.post('/invito/:token', loginLimiter, ah(async (req, res) => {
  const inv = await invitoValido(req.params.token);
  if (!inv) throw new HttpError(404, 'Invito non valido o scaduto');
  const { password } = parse(z.object({ password: pwdSchemaLazy() }), req.body);
  await q('UPDATE users SET password_hash=$2, must_change_password=false, auth_provider=CASE WHEN auth_provider=\'ENTRA\' THEN \'BOTH\' ELSE auth_provider END, updated_at=now() WHERE id=$1', [inv.user_id, await bcrypt.hash(password, 12)]);
  await q('UPDATE inviti SET used_at=now() WHERE id=$1', [inv.id]);
  const user = await one('SELECT * FROM users WHERE id=$1', [inv.user_id]);
  await completeLogin(req, user, 'LOCAL');
  res.json({ ok: true });
}));
function pwdSchemaLazy() { return pwdSchema; }

const pwdSchema = z.string().min(12, 'minimo 12 caratteri')
  .regex(/[A-Z]/, 'serve una maiuscola').regex(/[a-z]/, 'serve una minuscola').regex(/\d/, 'serve un numero');

r.post('/change-password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: pwdSchema }), req.body);
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!u.password_hash || !(await bcrypt.compare(currentPassword, u.password_hash))) throw bad('Password attuale errata');
  if (currentPassword === newPassword) throw bad('La nuova password deve essere diversa');
  await q('UPDATE users SET password_hash=$2, must_change_password=FALSE, updated_at=now() WHERE id=$1', [req.user.id, await bcrypt.hash(newPassword, 12)]);
  await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
  res.json({ ok: true });
}));

r.post('/totp/setup', requireAuth, ah(async (req, res) => {
  const secret = authenticator.generateSecret();
  req.session.totpSetupSecret = secret;
  const uri = authenticator.keyuri(req.user.email, 'Toscana Diagnostica Room Planning', secret);
  res.json({ secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#01212C', light: '#FFFFFF' } }) });
}));

r.post('/totp/enable', requireAuth, ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const secret = req.session.totpSetupSecret;
  if (!secret) throw bad('Avvia prima la configurazione');
  if (!authenticator.check(code, secret)) throw bad('Codice non valido, riprova');
  await q('UPDATE users SET totp_secret=$2, totp_enabled=TRUE, updated_at=now() WHERE id=$1', [req.user.id, secret]);
  delete req.session.totpSetupSecret;
  await audit(req, 'TOTP_ENABLED', 'user', req.user.id);
  res.json({ ok: true });
}));

// ---- Microsoft Entra ID (Office 365) via OpenID Connect ----
let entraClient = null;
async function getEntraClient() {
  if (entraClient) return entraClient;
  const issuer = await Issuer.discover(`https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`);
  entraClient = new issuer.Client({
    client_id: config.entra.clientId,
    client_secret: config.entra.clientSecret,
    redirect_uris: [`${config.baseUrl}/api/auth/entra/callback`],
    response_types: ['code'],
  });
  return entraClient;
}

r.get('/entra/login', ah(async (req, res) => {
  if (!config.entra.enabled) throw bad('Accesso Microsoft non configurato');
  const client = await getEntraClient();
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  req.session.oidc = { state, nonce, verifier };
  res.redirect(client.authorizationUrl({
    scope: 'openid profile email',
    state, nonce,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }));
}));

r.get('/entra/callback', ah(async (req, res) => {
  const fail = (m) => res.redirect(`/login?error=${encodeURIComponent(m)}`);
  const o = req.session.oidc;
  if (!o) return fail('Sessione di accesso scaduta');
  const client = await getEntraClient();
  let claims;
  try {
    const params = client.callbackParams(req);
    const tokens = await client.callback(`${config.baseUrl}/api/auth/entra/callback`, params,
      { state: o.state, nonce: o.nonce, code_verifier: o.verifier });
    claims = tokens.claims();
  } catch (e) {
    console.error('[entra]', e.message);
    return fail('Accesso Microsoft non riuscito');
  }
  if (claims.tid !== config.entra.tenantId) return fail('Tenant Microsoft non autorizzato');
  const email = (claims.email || claims.preferred_username || '').toLowerCase();
  let u = await one(`SELECT * FROM users WHERE (entra_oid = $1 OR lower(email) = $2)`, [claims.oid, email]);
  if (u && !u.active) return fail(`Utente ${email} disattivato. Rivolgiti all'amministratore.`);
  if (u && u.auth_provider === 'LOCAL') return fail(`L'utente ${email} accede con email e password.`);
  if (!u) {
    // Auto-registrazione: un account Microsoft 365 del tenant entra la prima volta con il ruolo di default (consultazione)
    const domainOk = !config.entra.allowedDomains.length || config.entra.allowedDomains.includes(email.split('@')[1] || '');
    if (!config.entra.autoProvisionRole || !domainOk || !email) return fail(`Utente ${email} non abilitato. Chiedi all'amministratore di registrarti.`);
    u = await one(`INSERT INTO users (email, full_name, role, auth_provider, entra_oid, must_change_password)
                   VALUES ($1,$2,$3,'ENTRA',$4,FALSE) RETURNING *`, [email, claims.name || email, config.entra.autoProvisionRole, claims.oid]);
    await audit({ ...req, user: u }, 'USER_AUTOPROVISION', 'user', u.id, { email, role: u.role });
  }
  if (!u.entra_oid) await q('UPDATE users SET entra_oid=$2 WHERE id=$1', [u.id, claims.oid]);
  await completeLogin(req, u, 'ENTRA');
  res.redirect('/');
}));

export default r;
