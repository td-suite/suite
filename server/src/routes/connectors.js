// Amministrazione > Connettori: un connettore per sistema esterno (StudioLAB, GIPO, TuoTempo, Silva), valido per tutta la Suite.
// Solo amministratori. Le credenziali non si rileggono mai in chiaro: si espone "impostata" e gli ultimi 4 caratteri.
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { CONNECTOR_KINDS, AUTH_KINDS, publicConnector, saveConnector, testConnector, connectorLog, newInboundSecret } from '../lib/connectors.js';

const r = Router();
r.use(requireAdmin);

const kindOf = (req) => {
  const k = String(req.params.kind || '').toUpperCase();
  if (!CONNECTOR_KINDS.includes(k)) throw notFound('Connettore inesistente');
  return k;
};

r.get('/', ah(async (_req, res) => {
  const rows = [];
  for (const k of CONNECTOR_KINDS) rows.push(await publicConnector(k));
  res.json(rows);
}));

r.get('/:kind', ah(async (req, res) => res.json(await publicConnector(kindOf(req)))));

const settingsSchema = z.object({
  client_code: z.string().trim().max(40).optional(),
  instance: z.string().trim().max(80).optional(),
  lang: z.string().trim().max(5).optional(),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).optional(),
  ip_allowlist: z.array(z.string().trim().max(64)).max(50).optional(),
  customer_code: z.string().trim().max(60).optional(),
  order_email: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
}).passthrough();

r.put('/:kind', ah(async (req, res) => {
  const kind = kindOf(req);
  const b = parse(z.object({
    enabled: z.boolean().optional(),
    base_url: z.string().trim().max(300).nullable().optional(),
    auth_kind: z.enum(AUTH_KINDS).optional(),
    schedule: z.enum(['MANUALE', 'HOURLY', 'DAILY']).optional(),
    settings: settingsSchema.optional(),
    credentials: z.record(z.string(), z.string().max(2000).nullable()).nullable().optional(),
    inbound_secret: z.string().max(400).nullable().optional(),
  }), req.body);
  if (b.base_url) { try { const u = new URL(b.base_url); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { throw bad('La base URL deve iniziare con https:// (o http://)'); } }
  if (b.inbound_secret && b.inbound_secret.trim().length < 16) throw bad('Il segreto in ingresso deve avere almeno 16 caratteri');
  if (b.settings?.ip_allowlist) b.settings.ip_allowlist = b.settings.ip_allowlist.filter(Boolean);
  await saveConnector(kind, b, req.user.id);
  await audit(req, 'CONNECTOR_UPDATED', { entity: 'connector', entityId: kind, label: kind, data: { fields: Object.keys(b), credentials_set: b.credentials ? Object.keys(b.credentials).filter((k) => b.credentials[k]) : undefined, credentials_removed: b.credentials === null || undefined, inbound_set: typeof b.inbound_secret === 'string' || undefined, inbound_removed: b.inbound_secret === null || undefined } });
  res.json(await publicConnector(kind));
}));

// Prova di connessione: mai un 500, l'esito (anche negativo) torna con ok:false e resta registrato
r.post('/:kind/test', ah(async (req, res) => {
  const kind = kindOf(req);
  const out = await testConnector(kind);
  await audit(req, 'CONNECTOR_TESTED', { entity: 'connector', entityId: kind, label: `${kind}: ${out.ok ? 'OK' : 'ERRORE'}`, data: { message: out.message } });
  res.json(out);
}));

// Nuovo segreto in ingresso: generato qui, mostrato una sola volta, salvato cifrato
r.post('/:kind/rotate-inbound', ah(async (req, res) => {
  const kind = kindOf(req);
  const secret = newInboundSecret();
  await saveConnector(kind, { inbound_secret: secret }, req.user.id);
  await audit(req, 'CONNECTOR_INBOUND_ROTATED', { entity: 'connector', entityId: kind, label: kind });
  res.json({ secret, hint: secret.slice(-4) });
}));

r.get('/:kind/log', ah(async (req, res) => res.json(await connectorLog(kindOf(req), Math.min(200, Number(req.query.limit) || 50)))));

export default r;
