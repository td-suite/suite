// Route di configurazione del modulo (impostazioni Ordini delle sedi dell'anagrafica unica, catalogo, correlazioni, impostazioni, registri).
// La gestione utenti (routes users) non viene portata: utenti, profili e ambiti sono della Suite.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, getSetting } from '../lib/util.js';
import { requireRole, isOps, Params, OPS_ROLES } from '../lib/access.js';
import { clausolaVisibilita } from '../lib/dotazione.js';
import { mailStatus, sendMail } from '../lib/mailer.js';
import { companyInfo } from '../lib/orders.js';
import { studiolabStatus } from '../lib/studiolab.js';
import { silvaStatus } from '../lib/silva.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import multer from 'multer';
import ExcelJS from 'exceljs';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const CODE = /^[A-Z0-9_-]{2,16}$/;

// ---------------- Strutture: anagrafica unica della Suite + impostazioni Ordini ----------------
// Due origini (vista strutture_v, migrazione 005): sedi TD (public.sites, kind <> 'SERVICE', id > 0, impostazioni in site_ext) e
// Legal entity (public.organizations, id = -org_id, impostazioni in org_ext). I punti dei clienti service (sites SERVICE) non sono
// strutture a sé: compaiono come punti di consegna della loro Legal entity (colonna points). Nessuna creazione, rinomina o
// disattivazione qui: si fa in Amministrazione > Sedi o > Legal entity. Il modulo salva solo i propri campi operativi con un
// upsert sulla tabella di estensione (la riga nasce alla prima modifica). Referente e telefono del referente sono del core
// (docs/IMPOSTAZIONI.md): la vista strutture_v li calcola dall'organigramma e dall'anagrafica.
const siteExtFields = {
  kind: z.enum(['CLIENTE', 'SEDE', 'LAB']).optional(),
  silva_code: opt(z.string().max(40).transform((v) => v?.trim().toUpperCase() || null)),
  stock_deadline_day: opt(z.coerce.number().int().min(1).max(31)),
  // referente e telefono vengono dal core (responsabile di sede dell'organigramma, contatti della Legal entity): non si scrivono qui
  delivery_mode: z.enum(['GIRO', 'RITIRO']).optional(),
  delivery_notes: opt(z.string().max(500)),
  notes: opt(z.string().max(1000)),
};
const STRUTTURA_COLS = `s.*,
  (SELECT count(*)::int FROM orders o WHERE o.struttura_id=s.id AND o.status NOT IN ('CHIUSO','ANNULLATO')) AS open_orders,
  (SELECT max(month) FROM stock_counts c WHERE c.struttura_id=s.id AND c.status='CONFERMATO') AS last_stock_month,
  (SELECT count(*)::int FROM packages p WHERE p.struttura_id=s.id AND p.status='RICEVUTO') AS packs_in_stock`;

// Elenco unico: sedi TD e Legal entity attive (con ?all=1 anche le disattivate; ?origin=SITE|ORG per una sola origine;
// ?kind= per il ruolo nel flusso). I punti di consegna (sedi SERVICE) non compaiono come righe. I profili di struttura vedono solo la propria.
r.get('/strutture', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'NOT s.delivery_point' : `s.id=${P.add(req.user.struttura_id ?? 0)}`];
  if (req.query.kind) where.push(`s.kind=${P.add(req.query.kind)}`);
  if (req.query.origin) where.push(`s.origin=${P.add(req.query.origin)}`);
  if (req.query.all !== '1') where.push('s.active');
  res.json(await many(`SELECT ${STRUTTURA_COLS} FROM strutture_v s WHERE ${where.join(' AND ')} ORDER BY s.origin DESC, s.kind, s.sort_order, s.name`, P.values));
}));

r.get('/strutture/:id', ah(async (req, res) => {
  const s = await one(`SELECT ${STRUTTURA_COLS} FROM strutture_v s WHERE s.id=$1`, [Number(req.params.id) || 0]);
  if (!s) throw notFound('Struttura non trovata');
  if (!isOps(req.user) && s.id !== req.user.struttura_id) throw forbidden();
  res.json(s);
}));

// Impostazioni Ordini della struttura: upsert su site_ext (sede, id > 0) o su org_ext (Legal entity, id < 0).
// I dati anagrafici (nome, indirizzo, contatti, stato) non si toccano qui.
r.put('/strutture/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const s = await one('SELECT id, origin, site_id, org_id, code, name, delivery_point FROM strutture_v WHERE id=$1', [id]);
  if (!s) throw notFound('Struttura non trovata: sedi e Legal entity si creano in Amministrazione');
  if (s.delivery_point) throw bad('Un punto di un cliente service non ha impostazioni proprie: si configura la sua Legal entity');
  const d = parse(z.object(siteExtFields), req.body);
  const cols = Object.keys(d);
  if (!cols.length) throw bad('Nessun dato');
  if (d.silva_code) {
    const dup = await one('SELECT id, name FROM strutture_v WHERE upper(silva_code)=upper($1) AND id<>$2', [d.silva_code, s.id]);
    if (dup) throw bad(`Codice Silva già assegnato a un'altra struttura (${dup.name})`);
  }
  const [table, keyCol, keyVal] = s.origin === 'ORG' ? ['org_ext', 'org_id', s.org_id] : ['site_ext', 'site_id', s.site_id];
  await q(`INSERT INTO ${table} (${keyCol}, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
    ON CONFLICT (${keyCol}) DO UPDATE SET ${cols.map((c) => `${c}=EXCLUDED.${c}`).join(',')}, updated_at=now()`, [keyVal, ...cols.map((c) => d[c])]);
  await audit(req, 'STRUTTURA_UPDATE', 'struttura', s.id, { origin: s.origin, code: s.code, ...d });
  res.json(await one(`SELECT ${STRUTTURA_COLS} FROM strutture_v s WHERE s.id=$1`, [s.id]));
}));

// ---------------- Utenti: gestiti dalla Suite (Amministrazione > Utenti e profili), nessuna route nel modulo ----------------

// ---------------- Catalogo ----------------
r.get('/categories', ah(async (_req, res) => res.json(await many('SELECT * FROM categories ORDER BY sort'))));

// Catalogo: l'Area Operations vede tutto (con ?all=1 anche i disattivati); le strutture solo gli articoli resi visibili alla loro
// tipologia (fase 0, quattro colonne): la colonna si sceglie dal tipo di sede dell'anagrafica (site_kind) della struttura
// dell'utente, risolto in index.js (resolveStruttura): Punto Prelievi, Centro Polidiagnostico, Laboratorio di Analisi, Service.
export const visibleClause = (user, alias = 'a') => {
  if (isOps(user)) return 'TRUE';
  return clausolaVisibilita({ site_kind: user.struttura_site_kind, origin: user.struttura_origin, kind: user.struttura_kind }, alias);
};
// Il catalogo ordinabile è quello del Magazzino Centrale (articoli letti dall'API Silva): quando esiste almeno un articolo Silva, gli articoli caricati a mano
// (MOD252/MANUALE) escono da "Nuovo ordine" anche se ancora attivi (restano per lo storico e in Catalogo articoli con all=1)
export const soloSilvaClause = (alias = 'a') => `(${alias}.source = 'SILVA' OR NOT EXISTS (SELECT 1 FROM articles z WHERE z.source = 'SILVA' AND z.active))`;
r.get('/articles', ah(async (req, res) => {
  const all = req.query.all === '1' && isOps(req.user);
  res.json(await many(`SELECT a.*, c.name AS category_name, c.icon,
      (SELECT count(*)::int FROM exam_mappings m WHERE m.article_id=a.id AND m.active) AS mappings_count
    FROM articles a JOIN categories c ON c.code=a.category_code WHERE ($1 OR (a.active AND ${soloSilvaClause()})) AND ${visibleClause(req.user)} ORDER BY c.sort, a.sort, a.code`, [all]));
}));

const articleFields = {
  name: z.string().min(2).max(200), unit: z.string().min(1).max(60), pack_size: z.coerce.number().int().min(1), pack_label: z.string().min(1).max(120),
  color: opt(z.string().max(12)), gtin: opt(z.string().max(32)), silva_code: opt(z.string().max(40)), coverage_factor: z.coerce.number().min(0).max(12).optional(),
  visible_all: z.boolean().optional(), visible_sedi: z.boolean().optional(), visible_poli: z.boolean().optional(), visible_lab: z.boolean().optional(), visible_service: z.boolean().optional(),
  min_stock_packs: z.coerce.number().int().min(0).optional(), lab_only: z.boolean().optional(), active: z.boolean().optional(), category_code: z.string().optional(),
};
r.post('/articles', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ code: z.string().regex(CODE), category_code: z.string(), ...articleFields }), req.body);
  if (!(await one('SELECT 1 FROM categories WHERE code=$1', [d.category_code]))) throw bad('Categoria inesistente');
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO articles (${cols.join(',')}, sort) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, (SELECT coalesce(max(sort),0)+1 FROM articles)) RETURNING id`, cols.map((c) => d[c]));
  await audit(req, 'ARTICLE_CREATE', 'article', row.id, d);
  res.status(201).json(row);
}));
r.put('/articles/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object(articleFields), req.body);
  const cols = Object.keys(d);
  const r2 = await q(`UPDATE articles SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [req.params.id, ...cols.map((c) => d[c])]);
  if (!r2.rowCount) throw notFound();
  await audit(req, 'ARTICLE_UPDATE', 'article', req.params.id, d);
  res.json({ ok: true });
}));

// ---------------- Correlazione esami StudioLab -> materiali ----------------
r.get('/mappings', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT m.*, a.code AS article_code, a.name AS article_name, a.unit FROM exam_mappings m JOIN articles a ON a.id=m.article_id ORDER BY m.exam_code, a.code`));
}));
r.post('/mappings', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ exam_code: z.string().min(1).max(40), exam_name: opt(z.string().max(200)), article_id: z.coerce.number().int(), qty_per_exam: z.coerce.number().positive().default(1) }), req.body);
  const row = await one(`INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ($1,$2,$3,$4)
    ON CONFLICT (exam_code, article_id) DO UPDATE SET exam_name=EXCLUDED.exam_name, qty_per_exam=EXCLUDED.qty_per_exam, active=TRUE RETURNING id`, [d.exam_code.trim(), d.exam_name, d.article_id, d.qty_per_exam]);
  await audit(req, 'MAPPING_SAVE', 'mapping', row.id, d);
  res.status(201).json(row);
}));
// Export e import della tabella (XLSX: codice esame, descrizione, codice articolo MOD252, unità per esame)
r.get('/mappings/export.xlsx', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const rows = await many(`SELECT m.exam_code, m.exam_name, a.code AS article_code, a.name AS article_name, m.qty_per_exam FROM exam_mappings m JOIN articles a ON a.id=m.article_id WHERE m.active ORDER BY m.exam_code, a.code`);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Correlazioni');
  ws.addRow(['Codice esame', 'Descrizione esame', 'Codice articolo MOD252', 'Articolo', 'Unità per esame']); ws.getRow(1).font = { bold: true };
  for (const x of rows) ws.addRow([x.exam_code, x.exam_name, x.article_code, x.article_name, Number(x.qty_per_exam)]);
  ws.columns.forEach((c, i) => { c.width = [14, 60, 22, 50, 14][i]; });
  const arts = wb.addWorksheet('Articoli'); arts.addRow(['Codice', 'Articolo', 'Confezione']); arts.getRow(1).font = { bold: true };
  for (const a of await many('SELECT code, name, pack_label FROM articles WHERE active ORDER BY sort')) arts.addRow([a.code, a.name, a.pack_label]);
  arts.columns.forEach((c, i) => { c.width = [12, 60, 30][i]; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="correlazioni_esami_materiali.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

r.post('/mappings/import', requireRole(...OPS_ROLES), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const arts = new Map((await many('SELECT id, code FROM articles')).map((a) => [a.code, a.id]));
  const items = []; const errors = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values.slice(1).map((x) => (x && typeof x === 'object' && 'text' in x ? x.text : x));
    const [exam, name, art, , qty] = v.map((x) => (x == null ? '' : String(x).trim()));
    if (!exam && !art) return;
    if (!arts.has(art)) return errors.push(`riga ${i}: codice articolo "${art}" non in catalogo`);
    items.push({ exam, name, article_id: arts.get(art), qty: Number(String(qty).replace(',', '.')) || 1 });
  });
  if (errors.length) return res.status(400).json({ error: `Importazione non eseguita: ${errors.length} errori`, details: errors.slice(0, 50) });
  const replace = req.query.replace === '1';
  await tx(async (c) => {
    if (replace) await c.query('DELETE FROM exam_mappings');
    for (const it of items) await c.query(`INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ($1,$2,$3,$4) ON CONFLICT (exam_code, article_id) DO UPDATE SET exam_name=EXCLUDED.exam_name, qty_per_exam=EXCLUDED.qty_per_exam, active=TRUE`, [it.exam, it.name || null, it.article_id, it.qty]);
  });
  await audit(req, 'MAPPINGS_IMPORT', 'mapping', null, { rows: items.length, replace });
  res.json({ rows: items.length, replace });
}));

r.delete('/mappings/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  await q('DELETE FROM exam_mappings WHERE id=$1', [req.params.id]);
  await audit(req, 'MAPPING_DELETE', 'mapping', req.params.id);
  res.json({ ok: true });
}));

// ---------------- Impostazioni e registri ----------------
const SETTING_KEYS = ['reorder_formula', 'production_months', 'alerts_enabled', 'alert_hour', 'receipt_reminder_days', 'verify_reminder_days'];
r.get('/settings', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [SETTING_KEYS]);
  const last = Object.fromEntries((await many("SELECT key, value FROM app_settings WHERE key IN ('silva_last_poll_at','silva_last_feed_at','studiolab_last_hl7_at')")).map((x) => [x.key, x.value]));
  res.json({ settings: Object.fromEntries(rows.map((x) => [x.key, x.value])), mail: mailStatus(), studiolab: { ...studiolabStatus(), last_hl7_at: last.studiolab_last_hl7_at || null }, silva: { ...silvaStatus(), last_poll_at: last.silva_last_poll_at || null, last_feed_at: last.silva_last_feed_at || null }, entra: config.entra.enabled, baseUrl: config.baseUrl, integrationsUrl: `${suite.baseUrl}/api/orders/integrations` });
}));
r.put('/settings', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({
    reorder_formula: z.enum(['DIFF_X_FACTOR', 'TARGET_MINUS_STOCK']).optional(), production_months: z.coerce.number().int().min(1).max(12).optional(),
    alerts_enabled: z.enum(['true', 'false']).optional(), alert_hour: z.coerce.number().int().min(0).max(23).optional(),
    receipt_reminder_days: z.coerce.number().int().min(1).max(30).optional(), verify_reminder_days: z.coerce.number().int().min(1).max(30).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v)]);
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, d);
  res.json({ ok: true });
}));
r.post('/settings/test-email', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const to = parse(z.object({ to: z.string().email() }), req.body).to;
  res.json(await sendMail({ kind: 'TEST', to, sentBy: req.user.id, subject: 'Orders Management · email di prova', title: 'Email di prova', body: 'La configurazione di invio funziona.' }));
}));

r.get('/audit', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const P = new Params();
  const where = ['TRUE'];
  if (req.query.action) where.push(`a.action=${P.add(req.query.action)}`);
  const limit = P.add(Math.min(1000, Number(req.query.limit || 300)));
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ${limit}`, P.values));
}));

r.get('/email-log', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT e.id, e.kind, e.to_addr, e.subject, e.status, e.error, e.sent_at, e.attachment_name, s.name AS struttura_name, u.full_name AS sent_by_name
    FROM email_log e LEFT JOIN strutture_v s ON s.id=e.struttura_id LEFT JOIN users u ON u.id=e.sent_by ORDER BY e.sent_at DESC LIMIT 300`));
}));

r.get('/company', ah(async (_req, res) => { const { logo, letterhead_footer, ...c } = await companyInfo(); res.json(c); }));

export default r;
export { getSetting };
