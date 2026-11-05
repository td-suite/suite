// Impostazioni (admin o QUALITA): cartella OneDrive di destinazione (informativa), genera anche PDF, retention, suffisso predefinito,
// template DOCX del format TD (predefinito "Format TD (BARONI VERA)", caricamento di un altro, verifica, rimozione); "Prova la lettura"
// (motore del 03/11/2026): un PDF di prova letto come in Inbox, con JSON e anteprima, senza creare elaborazioni né schede.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, audit, bad, parse, HttpError } from '../../../lib/util.js';
import { requireQualita } from '../lib/access.js';
import { KEY, settings, setSetting, templateAttivo, registra } from '../lib/core.js';
import fs from 'node:fs';
import { verificaTemplate, generaDocx, generaPdf, TEMPLATE_DEFAULT_NOME, TEMPLATE_DEFAULT } from '../lib/formatTD.js';
import { estraiTesto } from '../lib/pdf.js';
import { leggiReferto, modoLettura, MODI } from '../lib/lettura.js';
import { controllaCoerenza } from '../lib/coerenza.js';
import { testoDocx } from '../lib/formatTD.js';
import { sha256 } from '../lib/storage.js';
import { storageMode } from '../lib/storage.js';
import { config } from '../config.js';
import { casella } from '../lib/casella.js';

const r = Router();

async function stato() {
  const imp = await settings();
  const tpl = await templateAttivo();
  const mb = await casella(imp);
  const modo = modoLettura();
  return { ...imp, casella_indirizzo: mb.address, casella_source: mb.source, template: tpl ? { id: tpl.id, filename: tpl.filename, size: tpl.size, created_at: tpl.created_at } : null, template_predefinito: TEMPLATE_DEFAULT_NOME,
    lettura: { modo, nome: MODI[modo] }, storage: storageMode() };
}

r.get('/settings', requireQualita, ah(async (_req, res) => res.json(await stato())));

r.put('/settings', requireQualita, ah(async (req, res) => {
  const b = parse(z.object({
    onedrive_folder: z.string().trim().max(500).optional(),
    genera_pdf: z.boolean().optional(),
    retention_mesi: z.coerce.number().int().min(0).max(120).optional(),   // conservazione dei PDF sorgente (L15)
    suffisso_predefinito: z.enum(['ESAME', 'SORGENTE', 'DATA']).optional(),
    // casella template@ (REFERTI_MAILBOX prevale sull'indirizzo salvato)
    casella_indirizzo: z.string().trim().toLowerCase().email('Indirizzo della casella non valido').max(200).optional(),
    casella_lettura: z.boolean().optional(),
    invio_mittente: z.boolean().optional(),
  }), req.body || {});
  if (b.casella_indirizzo !== undefined && config.mailboxEnv) delete b.casella_indirizzo;   // impostata da variabile d'ambiente: sola lettura
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

// "Prova la lettura": un PDF di prova, letto come in Inbox (Claude, simulazione o parser di riserva), restituisce per ogni scheda il JSON,
// le anomalie, la checklist di coerenza e l'anteprima PDF; nulla viene salvato (nessuna elaborazione, nessuna scheda, nessun file)
const uploadProva = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 1 } }).single('file');
const conProva = (req, res, next) => uploadProva(req, res, (e) => (e ? next(e.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, `File troppo grande (massimo ${config.maxFileBytes / 1024 / 1024} MB)`) : bad(e.message)) : next()));
r.post('/settings/prova-lettura', requireQualita, conProva, ah(async (req, res) => {
  const f = req.file;
  if (!f) throw bad('Nessun file ricevuto (campo "file")');
  if (!f.buffer || f.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad('Il file non è un PDF');
  const estratto = await estraiTesto(f.buffer);
  const out = await leggiReferto({ buffer: f.buffer, estratto, rif: 'prova dalle Impostazioni', userId: req.user.id });
  const tpl = await templateAttivo();
  const schede = [];
  for (const s of (out.schede || []).slice(0, 5)) {
    const docx = await generaDocx(s.dati, { template: tpl ? Buffer.from(tpl.data) : null });
    const pdf = await generaPdf(docx).catch(() => null);
    schede.push({ pagine: s.pagine, dati: s.dati, anomalie: s.anomalie, coerenza: controllaCoerenza({ dati: s.dati, testoSorgente: s.testo_sorgente, testoDocx: testoDocx(docx), antibioticiSorgente: s.antibiotici_sorgente }), pdf: pdf ? pdf.toString('base64') : null });
  }
  await audit(req, 'REFERTI_PROVA_LETTURA', { module: KEY, entity: 'impostazioni', data: { lettura: out.modo, pagine: estratto.n_pagine, schede: schede.length, non_referto: Boolean(out.non_referto) } });   // solo conteggi
  res.json({ modo: out.modo, modo_nome: MODI[out.modo], non_referto: Boolean(out.non_referto), motivo: out.motivo || null, pagine: estratto.n_pagine, ms: out.ms, errore_claude: out.errore_claude || null, schede, altre: Math.max(0, (out.schede || []).length - schede.length) });
}));

r.get('/settings/template-predefinito', requireQualita, ah(async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${TEMPLATE_DEFAULT_NOME}.docx`)}`);
  res.send(fs.readFileSync(TEMPLATE_DEFAULT));
}));

r.get('/settings/template', requireQualita, ah(async (_req, res) => {
  const tpl = await templateAttivo();
  if (!tpl) throw bad(`Nessun template caricato: è in uso il template predefinito ${TEMPLATE_DEFAULT_NOME}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(tpl.filename)}`);
  res.send(Buffer.from(tpl.data));
}));

export default r;
