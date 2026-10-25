// Lancio di un modulo legacy: la Suite firma un token di 90 secondi e reindirizza all'app, che apre la sessione locale (legacy-sso/suite-sso.js)
import { Router } from 'express';
import { one, many } from '../db.js';
import { ah, bad, audit, notFound, forbidden } from '../lib/util.js';
import { isAdmin } from '../lib/access.js';
import { moduleSecret, signSsoToken } from '../lib/sso.js';

const r = Router();

r.get('/sso/launch/:module', ah(async (req, res) => {
  const m = await one('SELECT * FROM modules WHERE key=$1 AND active', [req.params.module]);
  if (!m) throw notFound('Modulo inesistente');
  if (!m.legacy_url) throw bad('Il modulo non ha un indirizzo esterno');
  const grant = req.user.grants[m.key];
  if (!grant && !(m.kind === 'PUBLIC') && !(isAdmin(req.user) && !m.restricted)) throw forbidden('Modulo non assegnato');
  const target = typeof req.query.path === 'string' && req.query.path.startsWith('/') ? req.query.path : '/';
  const secret = moduleSecret(m.key, m.sso_secret);
  if (!secret || m.kind === 'PUBLIC') {
    // Senza segreto configurato (o vetrina pubblica): apertura semplice, l'utente usa le credenziali dell'app
    await audit(req, 'MODULE_OPENED', { module: m.key, data: { sso: false } });
    return res.redirect(`${m.legacy_url}${target === '/' ? '' : target}`);
  }
  const scopeSites = (grant?.scopes || []).filter((s) => s.type === 'SITE').map((s) => Number(s.id));
  const siteRows = scopeSites.length ? await many('SELECT id, code, legacy_refs FROM sites WHERE id = ANY($1::int[])', [scopeSites]) : [];
  const siteCodes = siteRows.map((s) => s.legacy_refs?.[m.key] != null ? `${s.code}|${s.legacy_refs[m.key]}` : s.code);
  const token = signSsoToken(m.key, secret, req.user, grant || { profile: isAdmin(req.user) ? 'ADMIN' : null, scopes: [] }, { siteCodes });
  await audit(req, 'MODULE_OPENED', { module: m.key, data: { sso: true, profile: grant?.profile } });
  res.redirect(`${m.legacy_url}/api/auth/suite?token=${encodeURIComponent(token)}&next=${encodeURIComponent(target)}`);
}));

export default r;
