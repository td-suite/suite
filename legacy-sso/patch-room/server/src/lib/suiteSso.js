// Suite TD · accesso Single Sign-On dalla Suite verso questa app. Da copiare in server/src/lib/suiteSso.js.
// Nessuna dipendenza oltre node:crypto. La Suite firma un token HS256 (JWT compatibile) di 90 secondi con il segreto
// condiviso del modulo (variabile SUITE_SSO_SECRET nel pannello Render). Questa app lo verifica, trova o crea l'utente
// per email tramite le callback fornite, apre la sessione come farebbe il login normale e reindirizza a `next`.
//
// Payload del token (vedi suite/server/src/lib/sso.js):
//   iss = indirizzo della Suite, aud = chiave del modulo (cash, orders, room, ...), iat, exp, jti,
//   sub = id utente in Suite, email, name, level (OWNER|ADMIN|USER), profile = profilo del modulo (es. PLANNER),
//   scopes = ["SITE:12", ...] (id delle sedi in Suite), site_codes = ["FI-CAL|cal01", ...] (codice Suite | id in questa app, quando noto),
//   org_codes, return_url.
import crypto from 'node:crypto';

const b64uToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64');

export function verifySuiteToken(token, { secret, audience, issuer, clockSkewSeconds = 30 }) {
  if (!secret) throw new Error('Segreto SSO non configurato');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Token malformato');
  const [h, p, s] = parts;
  let header, payload;
  try { header = JSON.parse(b64uToBuf(h).toString('utf8')); payload = JSON.parse(b64uToBuf(p).toString('utf8')); }
  catch { throw new Error('Token non leggibile'); }
  if (header.alg !== 'HS256') throw new Error('Algoritmo non ammesso');
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = b64uToBuf(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw new Error('Firma non valida');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + clockSkewSeconds < now) throw new Error('Token scaduto');
  if (typeof payload.iat === 'number' && payload.iat - clockSkewSeconds > now) throw new Error('Token non ancora valido');
  if (audience && payload.aud !== audience) throw new Error('Token destinato a un altro modulo');
  if (issuer && payload.iss !== issuer) throw new Error('Emittente non riconosciuto');
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new Error('Email assente nel token');
  return payload;
}

// Protezione anti riuso: i jti visti negli ultimi minuti (il token vive 90 secondi, la memoria resta piccola)
const seen = new Map();
function markUsed(jti, exp) {
  const now = Date.now();
  for (const [k, until] of seen) if (until < now) seen.delete(k);
  if (jti && seen.has(jti)) return false;
  if (jti) seen.set(jti, (exp || 0) * 1000 + 120_000);
  return true;
}

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !/[\r\n]/.test(n) ? n : '/');

/**
 * Restituisce l'handler Express per GET /api/auth/suite?token=...&next=/...
 * @param {object} o
 * @param {string} o.secret               segreto condiviso con la Suite (process.env.SUITE_SSO_SECRET)
 * @param {string} [o.audience]           chiave del modulo attesa (es. 'room'); se omessa non viene controllata
 * @param {string} [o.issuer]             indirizzo della Suite atteso (es. 'https://suite.toscanadiagnostica.it'); se omesso non viene controllato
 * @param {(payload, req) => Promise<object|null>} o.findOrCreateUser  trova o crea l'utente locale per email; null = accesso negato
 * @param {(req, user, payload) => Promise<void>} o.finishLogin        apre la sessione come nel login dell'app (regenerate, userId, audit)
 * @param {(profile, payload) => string} [o.roleFromProfile]           mappa il profilo della Suite nel ruolo dell'app (usata da findOrCreateUser se vuole)
 * @param {(req, res, message) => void} [o.onError]                    risposta in caso di errore (default: redirect a /login?error=...)
 * @param {boolean} [o.setOriginCookie=true]                            imposta il cookie suite_origin=1 per mostrare la barra "Suite TD · Home"
 */
export function suiteSsoRoute({ secret, audience, issuer, findOrCreateUser, finishLogin, roleFromProfile = (p) => p, onError, setOriginCookie = true }) {
  if (typeof findOrCreateUser !== 'function' || typeof finishLogin !== 'function') throw new Error('suiteSsoRoute: findOrCreateUser e finishLogin sono obbligatorie');
  const fail = (req, res, message) => (onError ? onError(req, res, message) : res.redirect(`/login?error=${encodeURIComponent(message)}`));
  return async function suiteSso(req, res, next) {
    try {
      if (!secret) return fail(req, res, 'Accesso dalla Suite non configurato su questa app');
      let payload;
      try { payload = verifySuiteToken(req.query.token, { secret, audience, issuer }); }
      catch (e) { return fail(req, res, `Accesso dalla Suite non riuscito: ${e.message}`); }
      if (!markUsed(payload.jti, payload.exp)) return fail(req, res, 'Accesso dalla Suite già utilizzato, ripeti dalla Suite');
      const ctx = { ...payload, email: String(payload.email).toLowerCase(), role: roleFromProfile(payload.profile, payload) };
      const user = await findOrCreateUser(ctx, req);
      if (!user) return fail(req, res, `Utente ${ctx.email} non abilitato a questa applicazione`);
      await finishLogin(req, user, ctx);
      if (setOriginCookie) res.cookie('suite_origin', '1', { httpOnly: false, sameSite: 'lax', secure: req.secure || req.get('x-forwarded-proto') === 'https', maxAge: 12 * 3600 * 1000, path: '/' });
      res.redirect(safeNext(req.query.next));
    } catch (e) { next(e); }
  };
}

export default suiteSsoRoute;
