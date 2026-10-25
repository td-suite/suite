// Single Sign-On dalla Suite verso le app esistenti: token HMAC-SHA256 di breve durata, un segreto per modulo.
// Formato: base64url(header).base64url(payload).base64url(hmac) (JWT HS256 compatibile). Verifica lato app in legacy-sso/suite-sso.js
import crypto from 'node:crypto';
import { config } from '../config.js';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function moduleSecret(moduleKey, dbSecret) {
  return dbSecret || config.sso.perModule[moduleKey] || config.sso.defaultSecret || '';
}

export function signSsoToken(moduleKey, secret, user, grant, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.baseUrl, aud: moduleKey, iat: now, exp: now + config.sso.tokenSeconds, jti: crypto.randomUUID(),
    sub: String(user.id), email: user.email, name: user.full_name,
    level: user.level, profile: grant?.profile || null,
    scopes: (grant?.scopes || []).map((s) => `${s.type}:${s.id}`),
    site_codes: extra.siteCodes || [], org_codes: extra.orgCodes || [],
    return_url: config.baseUrl,
  };
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}
