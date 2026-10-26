// Sedi invianti sull'anagrafica unica della Suite, due origini (docs/ANAGRAFICA.md, migrazione 004): le sedi TD (public.sites,
// kind <> 'SERVICE') e le Legal entity (public.organizations: laboratori clienti del service, fornitori, partner). L'elenco viene
// dalla vista sedi_v (id > 0 sede, id < 0 Legal entity); le impostazioni NC (codice cliente StudioLAB, canale, email/PEC di notifica,
// SLA, attiva per NC) stanno in nc.site_ext / nc.org_ext e si salvano con upsert. I punti SERVICE compaiono come punti della
// loro Legal entity (colonna punti). Qui non si creano, rinominano o eliminano sedi e Legal entity: si fa in Amministrazione
// (/admin/sites, /admin/organizations).
import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireQualita, isSede } from '../lib/access.js';
import { extOf, utentiSedeCountSql } from '../lib/sedi.js';

const r = Router();
const CANALI = ['EMAIL', 'PEC', 'PORTALE', 'NESSUNO'];
const cols = `s.*,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.stato IN ('APERTA','INVIATA_SEDE','RISPOSTA_SEDE','IN_TRATTAMENTO')) AS nc_aperte,
  (SELECT count(*)::int FROM nc n WHERE n.sede_id=s.id AND n.opened_at > now() - interval '90 days' AND n.stato <> 'ANNULLATA') AS nc_90gg,
  ${utentiSedeCountSql('s.id')} AS n_utenti`;
// Nessun punto SERVICE come sede a sé (resta nella vista solo per i riferimenti residui)
const BASE_WHERE = 'NOT s.punto_service';

// Elenco: interno completo (attive per NC; ?tutte=1 anche le disattivate; ?origin=SITE|ORG per tipo); utente SEDE solo le proprie (scope del grant Suite)
r.get('/sedi', ah(async (req, res) => {
  if (isSede(req.user)) return res.json(await many(`SELECT ${cols} FROM sedi_v s WHERE s.id = ANY($1::int[]) ORDER BY s.nome`, [req.user.sedi || []]));
  const w = [BASE_WHERE];
  if (req.query.tutte !== '1') w.push('s.attiva');
  if (req.query.origin === 'SITE' || req.query.origin === 'ORG') w.push(`s.origin = '${req.query.origin}'`);
  res.json(await many(`SELECT ${cols} FROM sedi_v s WHERE ${w.join(' AND ')} ORDER BY s.attiva DESC, s.origin DESC, s.configurata DESC, s.sort_order, s.nome`));
}));

r.get('/sedi/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id === 0) throw notFound('Sede non trovata');
  if (isSede(req.user) && !(req.user.sedi || []).includes(id)) throw notFound('Sede non trovata');
  const s = await one(`SELECT ${cols} FROM sedi_v s WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Sede non trovata');
  res.json(s);
}));

// Impostazioni NC della sede o della Legal entity: upsert su site_ext / org_ext (la riga nasce alla prima scrittura)
const schema = z.object({
  codice_lis: z.string().max(40).nullable().optional(),
  canale: z.enum(CANALI).optional(),
  email_nc: z.string().max(400).nullable().optional(), pec: z.string().max(200).nullable().optional(), email_cc: z.string().max(400).nullable().optional(),
  sla_ore: z.number().int().min(1).max(240).nullable().optional(), attiva: z.boolean().optional(), note: z.string().max(2000).nullable().optional(),
});
const clean = (v) => { const t = (v ?? '').toString().trim(); return t || null; };

r.put('/sedi/:id', requireQualita, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id === 0) throw notFound('Sede non trovata');
  const b = parse(schema, req.body);
  const { table, col, key } = extOf(id);
  const anag = id > 0
    ? await one(`SELECT id, code, name, kind, studiolab_code FROM public.sites WHERE id=$1`, [key])
    : await one(`SELECT id, code, name, kind FROM public.organizations WHERE id=$1`, [key]);
  if (!anag) throw notFound(id > 0 ? 'Sede non trovata nell\'anagrafica della Suite' : 'Legal entity non trovata nell\'anagrafica della Suite');
  if (id > 0 && anag.kind === 'SERVICE') throw bad('Un punto StudioLAB di un cliente del service non è una sede inviante: le impostazioni NC si fanno sulla sua Legal entity');
  const cur = (await one(`SELECT * FROM ${table} WHERE ${col}=$1`, [key])) || {};
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
    // Il codice StudioLAB identifica una sola sede inviante, qualunque sia l'origine
    const dup = await one(`SELECT 1 FROM sedi_v v WHERE lower(v.codice_lis)=lower($1) AND v.id<>$2`, [next.codice_lis, id]);
    if (dup) throw bad(`Il codice StudioLAB "${next.codice_lis}" è già assegnato a un'altra sede`);
    // ... né il codice StudioLAB o il codice Suite di un'altra sede o di un punto di un'altra Legal entity
    const dupAnag = await one(`SELECT s.id, s.name FROM public.sites s
       WHERE (lower(s.studiolab_code)=lower($1) OR lower(s.code)=lower($1))
         AND CASE WHEN s.kind='SERVICE' AND s.organization_id IS NOT NULL THEN -s.organization_id ELSE s.id END <> $2`, [next.codice_lis, id]);
    if (dupAnag) throw bad(`Il codice StudioLAB "${next.codice_lis}" identifica già "${dupAnag.name}" nell'anagrafica della Suite`);
  }
  const anagPec = id < 0 ? (await one('SELECT pec FROM public.organizations WHERE id=$1', [key]))?.pec : null;
  if (next.canale === 'PEC' && !next.pec && !next.email_nc && !anagPec) throw bad(id > 0 ? 'Con il canale PEC serve l\'indirizzo PEC della sede' : 'Con il canale PEC serve l\'indirizzo PEC della Legal entity (qui o in Amministrazione)');
  await one(`INSERT INTO ${table} (${col}, codice_lis, canale, email_nc, pec, email_cc, sla_ore, attiva, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (${col}) DO UPDATE SET codice_lis=EXCLUDED.codice_lis, canale=EXCLUDED.canale, email_nc=EXCLUDED.email_nc, pec=EXCLUDED.pec, email_cc=EXCLUDED.email_cc,
      sla_ore=EXCLUDED.sla_ore, attiva=EXCLUDED.attiva, note=EXCLUDED.note, updated_at=now() RETURNING ${col}`,
  [key, next.codice_lis, next.canale, next.email_nc, next.pec, next.email_cc, next.sla_ore, next.attiva, next.note]);
  const s = await one(`SELECT ${cols} FROM sedi_v s WHERE s.id=$1`, [id]);
  await audit(req, 'SEDE_UPDATED', { entity: id > 0 ? 'sede' : 'legal_entity', entityId: key, label: `${anag.name} (${s.codice}) · impostazioni NC${id < 0 ? ' · Legal entity' : ''}`, data: b });
  res.json(s);
}));

export default r;
