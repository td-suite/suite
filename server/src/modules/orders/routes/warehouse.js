// Fase 0 · Magazzino Centrale (il magazzino del fornitore Silva, letto dall'API Silva): giacenze (lotti, scadenze, quantità) e
// visibilità degli articoli per tipologia di struttura (Punti Prelievo, Centro Polidiagnostico, Laboratorio di Analisi, Service, Tutti)
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse, getSetting, itDate } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { applyFeed } from './integrations.js';
import { sincronizzaCatalogo, statoCatalogo, reinterpretaArticoli, pulisciNonSilva } from '../lib/silvaCatalog.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Giacenze correnti del magazzino per articolo, con i lotti
r.get('/', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const rows = await many(`SELECT a.id AS article_id, a.code, a.silva_code, a.name, a.category_code, c.name AS category_name, c.icon, a.color, a.unit, a.pack_size, a.pack_label, a.gtin, a.source, a.active,
      a.visible_all, a.visible_sedi, a.visible_poli, a.visible_lab, a.visible_service,
      coalesce((SELECT sum(w.qty) FROM warehouse_stock w WHERE w.article_id=a.id AND w.current),0)::numeric AS qty,
      (SELECT min(w.expiry) FROM warehouse_stock w WHERE w.article_id=a.id AND w.current AND w.qty > 0) AS next_expiry,
      (SELECT count(*)::int FROM warehouse_stock w WHERE w.article_id=a.id AND w.current AND w.qty > 0) AS lots,
      (SELECT json_agg(json_build_object('lot', w.lot, 'expiry', w.expiry, 'qty', w.qty, 'barcode', w.barcode) ORDER BY w.expiry NULLS LAST) FROM warehouse_stock w WHERE w.article_id=a.id AND w.current) AS lot_detail
    FROM articles a JOIN categories c ON c.code=a.category_code ORDER BY c.sort, a.sort, a.code`);
  const feeds = await many('SELECT f.*, (SELECT count(*)::int FROM warehouse_stock w WHERE w.feed_id=f.id) AS rows FROM warehouse_feeds f ORDER BY f.received_at DESC LIMIT 20');
  res.json({ rows, feeds, last_feed_at: await getSetting('silva_last_feed_at', null), last_poll_at: await getSetting('silva_last_poll_at', null), silva: await statoCatalogo() });
}));
// Icone per interpretazione: categoria e colore dalla descrizione degli articoli Silva ancora in MAGAZZINO (force = tutti)
r.post('/silva/reinterpreta', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const out = await reinterpretaArticoli({ force: Boolean(req.body?.force) });
  await audit(req, 'SILVA_REINTERPRETA', 'warehouse', null, out);
  res.json(out);
}));
// Pulizia del catalogo caricato a mano: solo il super amministratore; dry_run per vedere il piano
r.post('/pulizia-non-silva', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const out = await pulisciNonSilva({ dryRun: Boolean(req.body?.dry_run) });
  if (!out.dryRun) await audit(req, 'CATALOGO_PULIZIA_NON_SILVA', 'warehouse', null, { eliminati: out.eliminati.length, disattivati: out.disattivati.length });
  res.json(out);
}));
// Lettura del catalogo Silva su richiesta (force = fotografia completa, altrimenti sole modifiche dal riferimento salvato)
r.post('/silva/sync', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const out = await sincronizzaCatalogo({ force: Boolean(req.body?.force) });
  await audit(req, 'SILVA_CATALOG_SYNC', 'warehouse', null, out);
  res.json(out);
}));

// Visibilità: quali strutture vedono l'articolo nel catalogo (tutti, punti prelievo, centri polidiagnostici, laboratorio, clienti Service)
const VIS = ['visible_all', 'visible_sedi', 'visible_poli', 'visible_lab', 'visible_service'];
const visFields = Object.fromEntries(VIS.map((k) => [k, z.boolean().optional()]));
r.put('/articles/:id/visibility', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ ...visFields, active: z.boolean().optional() }), req.body);
  const cols = Object.keys(d);
  if (!cols.length) throw bad('Nessun dato');
  const row = await one(`UPDATE articles SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1 RETURNING id, code, ${VIS.join(', ')}, active`, [req.params.id, ...cols.map((c) => d[c])]);
  if (!row) throw bad('Articolo inesistente');
  await audit(req, 'ARTICLE_VISIBILITY', 'article', row.id, d);
  res.json(row);
}));
r.put('/visibility', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ ids: z.array(z.coerce.number().int()).min(1), ...visFields }), req.body);
  const cols = VIS.filter((k) => d[k] !== undefined);
  if (!cols.length) throw bad('Nessun dato');
  await q(`UPDATE articles SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id = ANY($1)`, [d.ids, ...cols.map((c) => d[c])]);
  await audit(req, 'ARTICLE_VISIBILITY_BULK', 'article', d.ids.join(','), d);
  res.json({ ok: true });
}));

// Import manuale del feed (XLSX/CSV con le stesse colonne dell'API) finché il fornitore non chiama l'API
r.post('/import', requireRole(...OPS_ROLES), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const wb = new ExcelJS.Workbook();
  let rows = [];
  if (/\.csv$/i.test(req.file.originalname)) {
    const txt = req.file.buffer.toString('utf8'); const sep = txt.split('\n')[0].includes(';') ? ';' : ',';
    const lines = txt.split(/\r?\n/).filter(Boolean); const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    rows = lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim()])));
  } else {
    await wb.xlsx.load(req.file.buffer); const ws = wb.worksheets[0];
    const head = ws.getRow(1).values.slice(1).map((h) => String(h || '').trim().toLowerCase());
    ws.eachRow((row, i) => { if (i > 1) rows.push(Object.fromEntries(row.values.slice(1).map((v, j) => [head[j], v && typeof v === 'object' ? (v.text ?? (v instanceof Date ? v.toISOString().slice(0, 10) : v.result ?? '')) : v]))); });
  }
  const items = rows.map((x) => ({ codice: x.codice ?? x.code ?? x.articolo, descrizione: x.descrizione, barcode: x.barcode ?? x.gtin ?? x.ean, lotto: x.lotto ?? x.lot, scadenza: x.scadenza ? String(x.scadenza).slice(0, 10) : null, quantita: x.quantita ?? x.qta ?? x.qty ?? 0, unita: x.unita ?? x.um, confezione: x.confezione, unitaPerConfezione: x.unitaperconfezione ?? x.pezzi })).filter((x) => x.codice);
  if (!items.length) throw bad('Nessuna riga valida: colonne attese codice, descrizione, barcode, lotto, scadenza, quantita, unita, confezione, unitaPerConfezione');
  const out = await applyFeed(items, 'IMPORT');
  await audit(req, 'WAREHOUSE_IMPORT', 'warehouse', out.feedId, { items: out.items, newArticles: out.newArticles });
  res.json(out);
}));

r.get('/import/template.xlsx', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Giacenze magazzino');
  ws.addRow(['codice', 'descrizione', 'barcode', 'lotto', 'scadenza', 'quantita', 'unita', 'confezione', 'unitaPerConfezione']);
  ws.addRow(['PRV07', 'Provette tappo viola', '08012345678905', 'LOT2026A', '2027-12-31', 120, 'confezioni', 'confezione da 100 provette', 100]);
  ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 22; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modello_giacenze_magazzino.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
export { itDate };
