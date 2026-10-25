// Sedi invianti sull'anagrafica unica della Suite: l'elenco viene da public.sites (vista sites_v), le impostazioni NC
// (codice cliente StudioLAB, canale, email/PEC di notifica, SLA, attiva per NC) stanno in nc.site_ext e si salvano con upsert.
// Qui non si creano, rinominano o eliminano sedi: si fa in Amministrazione > Sedi (/admin/sites).
import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireQualita, isSede } from '../lib/access.js';

const r = Router();
const CANALI = ['EMAIL', 'PEC', 'PORTALE', 'NESSUNO'];
const cols = `s.*,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO')) AS nc_aperte,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.opened_at > now() - interval '90 days' AND n.stato <> 'ANNULLATA') AS nc_90gg,
  (SELECT count(DISTINCT u.id)::int FROM public.users u JOIN public.grants g ON g.user_id=u.id AND g.module_key='nc' AND g.profile='SEDE' AND NOT g.proposed
     JOIN public.grant_scopes gs ON gs.grant_id=g.id AND gs.scope_type='SITE' AND gs.scope_id=s.id WHERE u.status='ACTIVE') AS n_utenti`;

// Elenco: interno completo (attive per NC; ?tutte=1 anche le disattivate); utente SEDE solo le proprie (scope del grant Suite)
r.get('/sedi', ah(async (req, res) => {
  if (isSede(req.user)) return res.json(await many(`SELECT ${cols} FROM sites_v s WHERE s.id = ANY($1::int[]) ORDER BY s.nome`, [req.user.sedi || []]));
  const attive = req.query.tutte === '1' ? '' : 'WHERE s.attiva';
  res.json(await many(`SELECT ${cols} FROM sites_v s ${attive} ORDER BY s.attiva DESC, s.configurata DESC, s.tipo, s.nome`));
}));

r.get('/sedi/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (isSede(req.user) && !(req.user.sedi || []).includes(id)) throw notFound('Sede non trovata');
  const s = await one(`SELECT ${cols} FROM sites_v s WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Sede non trovata');
  res.json(s);
}));

// Impostazioni NC della sede: upsert su site_ext (la riga nasce alla prima scrittura)
const schema = z.object({
  codice_lis: z.string().max(40).nullable().optional(),
  canale: z.enum(CANALI).optional(),
  email_nc: z.string().max(400).nullable().optional(), pec: z.string().max(200).nullable().optional(), email_cc: z.string().max(400).nullable().optional(),
  sla_ore: z.number().int().min(1).max(240).nullable().optional(), attiva: z.boolean().optional(), note: z.string().max(2000).nullable().optional(),
});
const clean = (v) => { const t = (v ?? '').toString().trim(); return t || null; };

r.put('/sedi/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(schema, req.body);
  const site = await one('SELECT id, code, name, studiolab_code FROM public.sites WHERE id=$1', [id]);
  if (!site) throw notFound('Sede non trovata nell\'anagrafica della Suite');
  const cur = (await one('SELECT * FROM site_ext WHERE site_id=$1', [id])) || {};
  const next = {
    codice_lis: 'codice_lis' in b ? clean(b.codice_lis) : cur.codice_lis ?? null,
    canale: b.canale ?? cur.canale ?? 'EMAIL',
    email_nc: 'email_nc' in b ? clean(b.email_nc)?.toLowerCase() ?? null : cur.email_nc ?? null,
    pec: 'pec' in b ? clean(b.pec)?.toLowerCase() ?? null : cur.pec ?? null,
    email_cc: 'email_cc' in b ? clean(b.email_cc) : cur.email_cc ?? null,
    sla_ore: 'sla_ore' in b ? (b.sla_ore ?? null) : cur.sla_ore ?? null,
    attiva: b.attiva ?? cur.attiva ?? true,
    note: 'note' in b ? clean(b.note) : cur.note ?? null,
  };
  if (next.codice_lis) {
    const dup = await one('SELECT site_id FROM site_ext WHERE lower(codice_lis)=lower($1) AND site_id<>$2', [next.codice_lis, id]);
    if (dup) throw bad(`Il codice StudioLAB "${next.codice_lis}" è già assegnato a un'altra sede`);
  }
  if (next.canale === 'PEC' && !next.pec && !next.email_nc) throw bad('Con il canale PEC serve l\'indirizzo PEC della sede');
  await one(`INSERT INTO site_ext (site_id, codice_lis, canale, email_nc, pec, email_cc, sla_ore, attiva, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (site_id) DO UPDATE SET codice_lis=EXCLUDED.codice_lis, canale=EXCLUDED.canale, email_nc=EXCLUDED.email_nc, pec=EXCLUDED.pec, email_cc=EXCLUDED.email_cc,
      sla_ore=EXCLUDED.sla_ore, attiva=EXCLUDED.attiva, note=EXCLUDED.note, updated_at=now() RETURNING site_id`,
  [id, next.codice_lis, next.canale, next.email_nc, next.pec, next.email_cc, next.sla_ore, next.attiva, next.note]);
  const s = await one(`SELECT ${cols} FROM sites_v s WHERE s.id=$1`, [id]);
  await audit(req, 'SEDE_UPDATED', { entity: 'sede', entityId: id, label: `${site.name} (${s.codice}) · impostazioni NC`, data: b });
  res.json(s);
}));

export default r;
