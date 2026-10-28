// Impostazioni (admin o QUALITA): cartella OneDrive di destinazione (informativa), genera anche PDF, retention, suffisso predefinito,
// template DOCX della carta intestata (caricamento, verifica, rimozione).
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, audit, bad, parse, HttpError } from '../../../lib/util.js';
import { requireQualita } from '../lib/access.js';
import { KEY, settings, setSetting, templateAttivo, registra } from '../lib/core.js';
import { verificaTemplate } from '../lib/docgen.js';
import { sha256 } from '../lib/storage.js';
import { storageMode } from '../lib/storage.js';

const r = Router();

async function stato() {
  const imp = await settings();
  const tpl = await templateAttivo();
  return { ...imp, template: tpl ? { id: tpl.id, filename: tpl.filename, size: tpl.size, created_at: tpl.created_at } : null, storage: storageMode() };
}

r.get('/settings', requireQualita, ah(async (_req, res) => res.json(await stato())));

r.put('/settings', requireQualita, ah(async (req, res) => {
  const b = parse(z.object({
    onedrive_folder: z.string().trim().max(500).optional(),
    genera_pdf: z.boolean().optional(),
    retention_giorni: z.coerce.number().int().min(0).max(3650).optional(),
    suffisso_predefinito: z.enum(['ESAME', 'SORGENTE', 'DATA']).optional(),
  }), req.body || {});
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, v, req.user.id);
  await registra('IMPOSTAZIONI', { user_id: req.user.id, dettagli: { chiavi: Object.keys(b) } });
  await audit(req, 'REFERTI_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', ') });
  res.json(await stato());
}));

// Template della carta intestata (DOCX): se presente, il generatore usa header, footer e sectPr del template
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single('file');
const conUpload = (req, res, next) => upload(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'Template troppo grande (massimo 15 MB)') : bad(e.message)) : next()));

r.post('/settings/template', requireQualita, conUpload, ah(async (req, res) => {
  const f = req.file;
  if (!f) throw bad('Nessun file ricevuto (campo "file")');
  if (!/\.docx$/i.test(f.originalname || '')) throw bad('Il template deve essere un file Word (.docx)');
  const v = verificaTemplate(f.buffer);
  if (!v.ok) throw bad(v.errore);
  await q('UPDATE templates SET attivo=FALSE WHERE attivo');
  const row = await one('INSERT INTO templates (filename, size, sha256, data, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [String(f.originalname).slice(0, 200), f.size, sha256(f.buffer), f.buffer, req.user.id]);
  await registra('TEMPLATE', { user_id: req.user.id, dettagli: { template_id: row.id, filename: f.originalname, headers: v.headers, footers: v.footers } });
  await audit(req, 'REFERTI_TEMPLATE', { module: KEY, entity: 'template', entityId: row.id, data: { size: f.size } });
  res.status(201).json(await stato());
}));

r.delete('/settings/template', requireQualita, ah(async (req, res) => {
  await q('UPDATE templates SET attivo=FALSE WHERE attivo');
  await registra('TEMPLATE', { user_id: req.user.id, dettagli: { rimosso: true } });
  res.json(await stato());
}));

r.get('/settings/template', requireQualita, ah(async (_req, res) => {
  const tpl = await templateAttivo();
  if (!tpl) throw bad('Nessun template caricato: è in uso la carta intestata predefinita');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(tpl.filename)}`);
  res.send(Buffer.from(tpl.data));
}));

export default r;
