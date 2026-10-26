// Liste di distribuzione delle circolari: destinatari esterni (clienti service, punti prelievo, medicina del lavoro, partner)
// e interni. Le proposte di destinatari vengono dall'anagrafica unica (public.sites, public.organizations, public.users).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { many as suiteMany } from '../../../db.js';
import { ah, parse, audit, notFound, forbidden } from '../../../lib/util.js';

const r = Router();
const KEY = 'circolari';
const SEGMENTI = ['CLIENTI_SERVICE', 'PUNTI_PRELIEVO', 'MEDICINA_LAVORO', 'PERSONALE', 'PARTNER', 'ALTRO'];
const canManage = (u) => ['ADMIN', 'PUBBLICATORE'].includes(u.role);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const destSchema = z.array(z.object({ email: z.string().trim().toLowerCase().regex(EMAIL, 'email non valida').max(200), nome: z.string().trim().max(200).optional().default(''), organizzazione: z.string().trim().max(200).optional().default('') })).max(2000);
const listaSchema = z.object({ nome: z.string().trim().min(2).max(120), descrizione: z.string().trim().max(500).optional().default(''), segmento: z.enum(SEGMENTI).optional().default('CLIENTI_SERVICE'), destinatari: destSchema.optional().default([]), attiva: z.boolean().optional().default(true) });

const dedupe = (arr) => { const seen = new Set(); return arr.filter((d) => (seen.has(d.email) ? false : (seen.add(d.email), true))); };

r.get('/liste', ah(async (_req, res) => {
  const rows = await many(`SELECT id, nome, descrizione, segmento, attiva, jsonb_array_length(destinatari) AS n_destinatari, updated_at, (SELECT count(*)::int FROM invii i WHERE i.lista_id=l.id) AS n_invii FROM liste l ORDER BY lower(nome)`);
  res.json(rows);
}));

// Proposte di destinatari dall'anagrafica unica, per segmento
r.get('/liste/proposte', ah(async (req, res) => {
  const { segmento } = parse(z.object({ segmento: z.enum(SEGMENTI) }), req.query);
  let rows = [];
  if (segmento === 'CLIENTI_SERVICE' || segmento === 'PUNTI_PRELIEVO' || segmento === 'PARTNER') {
    const kinds = segmento === 'CLIENTI_SERVICE' ? ['SERVICE'] : segmento === 'PUNTI_PRELIEVO' ? ['PUNTO_PRELIEVI'] : ['SERVICE', 'PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'ALTRO'];
    rows = await suiteMany(`SELECT lower(s.email) AS email, s.name AS nome, coalesce(o.name, '') AS organizzazione FROM public.sites s LEFT JOIN public.organizations o ON o.id=s.organization_id WHERE s.active AND s.email IS NOT NULL AND s.email <> '' AND s.kind = ANY($1::text[]) ORDER BY lower(s.name)`, [kinds]);
    const orgs = await suiteMany(`SELECT lower(o.email) AS email, o.name AS nome, o.name AS organizzazione FROM public.organizations o WHERE o.email IS NOT NULL AND o.email <> '' AND o.kind IN ('CLIENTE','PARTNER') ORDER BY lower(o.name)`).catch(() => []);
    rows = rows.concat(orgs);
  } else if (segmento === 'PERSONALE') {
    rows = await suiteMany(`SELECT lower(u.email) AS email, coalesce(u.full_name, u.email) AS nome, 'Toscana Diagnostica' AS organizzazione FROM public.users u WHERE u.status='ACTIVE' ORDER BY lower(coalesce(u.full_name, u.email))`).catch(() => []);
  } else if (segmento === 'MEDICINA_LAVORO') {
    rows = await suiteMany(`SELECT lower(o.email) AS email, o.name AS nome, o.name AS organizzazione FROM public.organizations o WHERE o.email IS NOT NULL AND o.email <> '' AND o.kind IN ('CLIENTE') ORDER BY lower(o.name)`).catch(() => []);
  }
  res.json(dedupe(rows.filter((x) => EMAIL.test(x.email || ''))));
}));

r.get('/liste/:id', ah(async (req, res) => {
  const l = await one('SELECT * FROM liste WHERE id=$1', [req.params.id]);
  if (!l) throw notFound('Lista non trovata');
  res.json(l);
}));

r.post('/liste', ah(async (req, res) => {
  if (!canManage(req.user)) throw forbidden('Le liste di distribuzione si gestiscono con il profilo Pubblicazione');
  const b = parse(listaSchema, req.body);
  const l = await one('INSERT INTO liste (nome, descrizione, segmento, destinatari, attiva, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *', [b.nome, b.descrizione, b.segmento, JSON.stringify(dedupe(b.destinatari)), b.attiva, req.user.suite_user_id]);
  await audit(req, 'CIRCOLARI_LISTA_CREATA', { module: KEY, entity: 'lista', entityId: l.id, label: l.nome, data: { n: l.destinatari.length } });
  res.status(201).json(l);
}));

r.put('/liste/:id', ah(async (req, res) => {
  if (!canManage(req.user)) throw forbidden('Le liste di distribuzione si gestiscono con il profilo Pubblicazione');
  const cur = await one('SELECT * FROM liste WHERE id=$1', [req.params.id]);
  if (!cur) throw notFound('Lista non trovata');
  const b = parse(listaSchema, { ...cur, ...req.body, destinatari: req.body.destinatari ?? cur.destinatari });
  const l = await one('UPDATE liste SET nome=$2, descrizione=$3, segmento=$4, destinatari=$5, attiva=$6, updated_by=$7, updated_at=now() WHERE id=$1 RETURNING *', [cur.id, b.nome, b.descrizione, b.segmento, JSON.stringify(dedupe(b.destinatari)), b.attiva, req.user.suite_user_id]);
  await audit(req, 'CIRCOLARI_LISTA_MODIFICATA', { module: KEY, entity: 'lista', entityId: l.id, label: l.nome, data: { n: l.destinatari.length } });
  res.json(l);
}));

r.delete('/liste/:id', ah(async (req, res) => {
  if (!canManage(req.user)) throw forbidden('Le liste di distribuzione si gestiscono con il profilo Pubblicazione');
  const cur = await one('SELECT id, nome FROM liste WHERE id=$1', [req.params.id]);
  if (!cur) throw notFound('Lista non trovata');
  await q('DELETE FROM liste WHERE id=$1', [cur.id]);
  await audit(req, 'CIRCOLARI_LISTA_ELIMINATA', { module: KEY, entity: 'lista', entityId: cur.id, label: cur.nome });
  res.json({ ok: true });
}));

export default r;
