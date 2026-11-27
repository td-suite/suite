// Magazzino TD (v0.99.14): articoli interni, giacenza a movimenti, ordini da evadere con uscita verso il destinatario.
// Montate sotto /api/orders/td, solo Area Operations.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { ORDER_COLS, ORDER_JOINS } from '../lib/orderflow.js';
import { giacenzeTd, registraMovimento, ordiniTd, registraUscita, avvisaMagazzinoTd, emailMagazzinoTd } from '../lib/magazzinoTd.js';

const r = Router();
r.use(requireRole(...OPS_ROLES));
const opt = (s) => s.optional().nullable().transform((v) => (v === '' || v === undefined ? null : v));

r.get('/', ah(async (_req, res) => {
  const articoli = await giacenzeTd();
  res.json({ email: await emailMagazzinoTd(), articoli, ordini: await ordiniTd(), categorie: await many('SELECT code, name FROM categories ORDER BY sort'),
    sotto_scorta: articoli.filter((a) => a.active && a.min_stock_packs > 0 && a.giacenza - a.impegnate < a.min_stock_packs).length });
}));

// Articoli interni: il codice si assegna da solo (TD-0001, TD-0002, …); non hanno codice Silva e non entrano nel catalogo Silva
const campi = {
  name: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(60), pack_size: z.coerce.number().int().min(1).max(100000), pack_label: z.string().trim().min(1).max(120),
  category_code: z.string().optional(), min_stock_packs: z.coerce.number().int().min(0).max(100000).optional(), active: z.boolean().optional(),
  visible_all: z.boolean().optional(), visible_sedi: z.boolean().optional(), visible_poli: z.boolean().optional(), visible_lab: z.boolean().optional(), visible_service: z.boolean().optional(),
};
r.post('/articoli', ah(async (req, res) => {
  const d = parse(z.object({ ...campi, giacenza_iniziale: z.coerce.number().int().min(0).max(100000).optional() }), req.body);
  const { giacenza_iniziale: iniziale, ...a } = d;
  a.category_code = a.category_code || 'MAGAZZINO';
  if (!(await one('SELECT 1 FROM categories WHERE code=$1', [a.category_code]))) throw bad('Categoria inesistente');
  if (await one(`SELECT 1 FROM articles WHERE source='TD' AND lower(name)=lower($1)`, [a.name])) throw bad(`Nel Magazzino TD esiste già un articolo "${a.name}"`);
  if (![a.visible_all, a.visible_sedi, a.visible_poli, a.visible_lab, a.visible_service].some((v) => v !== undefined)) a.visible_all = true;
  const n = (await one(`SELECT coalesce(max(substring(code from '^TD-([0-9]+)$')::int), 0) + 1 AS n FROM articles WHERE code ~ '^TD-[0-9]+$'`)).n;
  const cols = Object.keys(a);
  const row = await one(`INSERT INTO articles (code, ${cols.join(',')}, source, sort) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}, 'TD', (SELECT coalesce(max(sort),0)+1 FROM articles)) RETURNING id, code`,
    [`TD-${String(n).padStart(4, '0')}`, ...cols.map((c) => a[c])]);
  if (iniziale) await registraMovimento({ article_id: row.id, kind: 'CARICO', qty: iniziale, note: 'Giacenza iniziale' }, req.user.id);
  await audit(req, 'TD_ARTICOLO_CREA', 'article', row.id, { ...a, code: row.code, giacenza_iniziale: iniziale || 0 });
  res.status(201).json(row);
}));
r.put('/articoli/:id', ah(async (req, res) => {
  const d = parse(z.object(Object.fromEntries(Object.entries(campi).map(([k, v]) => [k, v.optional()]))), req.body);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!cols.length) throw bad('Nessun dato');
  if (d.category_code && !(await one('SELECT 1 FROM categories WHERE code=$1', [d.category_code]))) throw bad('Categoria inesistente');
  const out = await q(`UPDATE articles SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1 AND source='TD'`, [req.params.id, ...cols.map((c) => d[c])]);
  if (!out.rowCount) throw notFound('Articolo del Magazzino TD non trovato');
  await audit(req, 'TD_ARTICOLO_MODIFICA', 'article', req.params.id, d);
  res.json({ ok: true });
}));

// Carico e rettifica; l'uscita si registra solo dall'ordine
r.post('/movimenti', ah(async (req, res) => {
  const d = parse(z.object({ article_id: z.coerce.number().int(), kind: z.enum(['CARICO', 'RETTIFICA']), qty: z.coerce.number().int().min(-100000).max(100000), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), note: opt(z.string().max(300)) }), req.body);
  const out = await registraMovimento(d, req.user.id);
  await audit(req, d.kind === 'CARICO' ? 'TD_CARICO' : 'TD_RETTIFICA', 'article', d.article_id, d);
  res.status(201).json(out);
}));
r.get('/movimenti', ah(async (req, res) => {
  const aid = req.query.article_id ? Number(req.query.article_id) : null;
  res.json(await many(`SELECT m.id, m.article_id, a.code, a.name, m.kind, m.qty, m.lot, m.expiry, m.note, m.created_at, m.order_id, o.number AS order_number, u.full_name AS user_name
      FROM td_stock_movements m JOIN articles a ON a.id=m.article_id LEFT JOIN orders o ON o.id=m.order_id LEFT JOIN users u ON u.id=m.user_id
     WHERE ($1::int IS NULL OR m.article_id=$1) ORDER BY m.created_at DESC, m.id DESC LIMIT 300`, [aid]));
}));

// Uscita verso il destinatario: scala la giacenza e porta l'ordine a SPEDITO
r.post('/ordini/:id/uscita', ah(async (req, res) => {
  const d = parse(z.object({ lines: z.array(z.object({ line_id: z.coerce.number().int(), qty: z.coerce.number().int().min(0).max(100000) })).optional(), ddt: opt(z.string().max(80)), note: opt(z.string().max(300)) }), req.body || {});
  const out = await registraUscita(Number(req.params.id), { lines: d.lines || null, ddt: d.ddt, note: d.note, userId: req.user.id, actor: req.user.full_name });
  await audit(req, 'TD_USCITA', 'order', req.params.id, { ...d, confezioni: out.confezioni });
  res.json(out);
}));
// Nuovo invio dell'email dell'ordine al Magazzino TD
r.post('/ordini/:id/email', ah(async (req, res) => {
  const o = await one(`SELECT ${ORDER_COLS} ${ORDER_JOINS} WHERE o.id=$1`, [req.params.id]);
  if (!o) throw notFound();
  if (o.channel !== 'TD') throw bad('Non è un ordine del Magazzino TD');
  const out = await avvisaMagazzinoTd(o, { pdf: o.pdf || null, userId: req.user.id, ripeti: true });
  await audit(req, 'TD_EMAIL', 'order', o.id, { status: out.status, to: out.to });
  res.json({ ok: out.status === 'INVIATA', status: out.status, error: out.error || null, to: out.to });
}));
// Casella del Magazzino TD
r.put('/email', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().email().max(200) }), req.body);
  await q(`INSERT INTO app_settings (key, value) VALUES ('td_warehouse_email', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [d.email]);
  await audit(req, 'TD_EMAIL_CASELLA', 'settings', null, d);
  res.json({ ok: true });
}));

export default r;
