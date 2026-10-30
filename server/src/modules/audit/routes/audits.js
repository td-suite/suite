// Audit: "i miei audit", auto-audit del mese (creato al volo), audit interni e sui partner, caricamento dei PDF di terze parti,
// lettura, salvataggio (colonna principale e colonna Verifica), invio, conferma delle risposte della sede, chiusura, riapertura,
// cestino (soft delete), allegati, esportazione del singolo audit (XLSX, PDF).
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { config, MB, ENTE_TIPI, ESITI_TERZI, ANSWER_VALUES } from '../config.js';
import { ah, audit, bad, parse, HttpError, forbidden, notFound } from '../../../lib/util.js';
import { estraiTesto } from '../../../lib/pdftext.js';
import { sendFile } from '../../../lib/moduleStorage.js';
import { requireAuditor, isAuditor, isQualita, isSite, mySiteIds, canSeeSite, limitedToSites } from '../lib/access.js';
import { KEY, idOf, loadAudit, listAudits, getOrCreateAuto, createAudit, saveAudit, inviaAuto, confermaRisposteSede, chiudi, riapri, softDelete, addFile, removeFile, assertCanSee, canEditAnswers, canVerify, canDelete, siteById, isStructure, inEsercizio, decorate, A_COLS, A_FROM } from '../lib/core.js';
import { monthStart } from '../lib/scoring.js';
import { auditXlsx, auditPdf } from '../lib/export.js';

const r = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: config.maxFilesPerUpload } }).array('file', config.maxFilesPerUpload);
const conUpload = (req, res, next) => upload(req, res, (e) => {
  if (!e) return next();
  if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${config.maxFileBytes / MB} MB)`));
  if (e.code === 'LIMIT_FILE_COUNT') return next(bad(`Massimo ${config.maxFilesPerUpload} file per caricamento`));
  next(bad(e.message));
});

const answerSchema = z.record(z.object({ v: z.enum(['SI', 'NO', 'NC', 'NA']).nullable().optional(), note: z.string().max(2000).nullable().optional(), rev: z.string().max(40).nullable().optional(), free: z.string().max(300).nullable().optional(), risk: z.enum(['BASSO', 'MEDIO', 'ALTO']).nullable().optional() }).passthrough());
const ncSchema = z.array(z.object({ n: z.string().max(40).nullable().optional(), descrizione: z.string().max(2000).nullable().optional(), cause: z.string().max(2000).nullable().optional(), soluzione: z.string().max(2000).nullable().optional(), azione_correttiva: z.string().max(2000).nullable().optional(), persona_riferimento: z.string().max(200).nullable().optional(), entro: z.string().max(40).nullable().optional() }).passthrough()).max(200);
const patchSchema = z.object({ answers: answerSchema.optional(), verifier_answers: answerSchema.optional(), header: z.record(z.any()).optional(), ncs: ncSchema.optional(), observations: z.string().max(10000).nullable().optional(), report: z.record(z.any()).optional() });
const clean = (ans) => { if (!ans) return ans; const out = {}; for (const [k, v] of Object.entries(ans)) { if (!v) continue; const o = {}; if (ANSWER_VALUES.includes(v.v)) o.v = v.v; if (v.note) o.note = String(v.note); if (v.rev) o.rev = String(v.rev); if (v.free) o.free = String(v.free); if (v.risk) o.risk = v.risk; if (Object.keys(o).length) out[k] = o; } return out; };

// ---- I miei audit: SITE → auto-audit delle proprie sedi (mese corrente creato al volo) e audit delle sedi; altri profili → audit in carico
r.get('/audits/miei', ah(async (req, res) => {
  const mine = mySiteIds(req);
  const period = monthStart(new Date());
  const correnti = [];
  for (const sid of mine) {
    try { const s = await siteById(sid); if (inEsercizio(s, period) && isStructure(s)) { const { id } = await getOrCreateAuto(sid, period, req.moduleUser.id); correnti.push(id); } } catch { /* sede non struttura o non trovata */ }
  }
  let rows;
  if (limitedToSites(req)) rows = await listAudits(req, { ...req.query, limit: 300 });
  else {
    const params = [req.moduleUser.id, mine];
    const w = [`a.deleted_at IS NULL AND (a.conducted_by=$1 OR a.created_by=$1 OR a.verified_by=$1 OR (a.kind='AUTO' AND a.status='INVIATO') OR a.site_id = ANY($2::int[]))`];
    params.push(300);
    rows = (await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE ${w.join(' AND ')} ORDER BY (a.kind='AUTO' AND a.status='INVIATO') DESC, coalesce(a.conducted_at, a.created_at) DESC, a.id DESC LIMIT $${params.length}`, params)).map(decorate);
  }
  res.json({ period, correnti, rows, can_conduct: isAuditor(req), can_verify: isAuditor(req), my_site_ids: mine });
}));

// Auto-audit del mese (creato se manca). SITE solo sulle proprie sedi.
r.post('/audits/auto', ah(async (req, res) => {
  const b = parse(z.object({ site_id: z.coerce.number().int().positive(), period: z.string().regex(/^\d{4}-\d{2}-01$/).optional() }), req.body || {});
  if (!canSeeSite(req, b.site_id)) throw forbidden('Sede non assegnata');
  if (isSite(req) && b.period && b.period !== monthStart(new Date())) throw forbidden('Il site manager compila l\'auto-audit del mese corrente');
  const out = await getOrCreateAuto(b.site_id, b.period, req.moduleUser.id);
  if (out.created) await audit(req, 'AUDIT_AUTO_CREATO', { module: KEY, entity: 'audit', entityId: out.id, data: { site_id: b.site_id, period: b.period || monthStart(new Date()) } });
  res.status(out.created ? 201 : 200).json(out);
}));

// Nuovo audit interno (sede) o partner ISO 37001 (Legal entity)
r.post('/audits', requireAuditor, ah(async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['INTERNO', 'LEGAL_ENTITY']), site_id: z.coerce.number().int().positive().optional(), organization_id: z.coerce.number().int().positive().optional(), header: z.record(z.any()).optional() }), req.body || {});
  if (b.kind === 'INTERNO' && !b.site_id) throw bad('Indica la sede');
  if (b.kind === 'LEGAL_ENTITY' && !b.organization_id) throw bad('Indica la Legal entity');
  const id = await createAudit(b, req.moduleUser.id, req.user.full_name);
  await audit(req, 'AUDIT_CREATO', { module: KEY, entity: 'audit', entityId: id, data: { kind: b.kind, site_id: b.site_id || null, organization_id: b.organization_id || null } });
  res.status(201).json({ id });
}));

// Audit di terze parti: PDF (anche più file) + metadati; testo estratto con pdftext (OCR se scansione) per la sintesi
r.post('/audits/terzi', requireAuditor, conUpload, ah(async (req, res) => {
  const b = parse(z.object({ site_id: z.coerce.number().int().positive(), ente_tipo: z.enum(ENTE_TIPI), ente: z.string().trim().min(1).max(200), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), esito: z.enum(ESITI_TERZI), note: z.string().max(4000).optional().or(z.literal('')) }), req.body || {});
  const files = (req.files || []).filter((f) => /\.pdf$/i.test(f.originalname || '') || f.mimetype === 'application/pdf');
  if (!files.length) throw bad('Carica almeno un PDF del rapporto');
  const site = await siteById(b.site_id);
  const testi = []; let ocr = false; let pagine = 0;
  for (const f of files) {
    try { const e = await estraiTesto(f.buffer); testi.push(`[${f.originalname}]\n${e.pagine.join('\n')}`); ocr = ocr || e.ocr; pagine += e.n_pagine; }
    catch (e) { testi.push(`[${f.originalname}] testo non estraibile: ${e.message}`); }
  }
  const sintesi_testo = testi.join('\n\n').slice(0, config.maxTerziText);
  const tp = { ente_tipo: b.ente_tipo, ente: b.ente, data: b.data || null, esito: b.esito, note: b.note || null, sintesi_testo, ocr, pagine, caratteri: sintesi_testo.length, troncato: testi.join('\n\n').length > config.maxTerziText };
  const row = await one(`INSERT INTO audits (kind, site_id, status, conducted_by, conducted_at, created_by, header, third_party) VALUES ('TERZI',$1,'CARICATO',$2,$3,$2,$4,$5) RETURNING id`,
    [b.site_id, req.moduleUser.id, b.data ? `${b.data}T12:00:00` : new Date(), JSON.stringify({ sede: site.name, effettuato_da: b.ente, data: b.data || null }), JSON.stringify(tp)]);
  for (const f of files) await addFile(row.id, f, 'Rapporto', req.moduleUser.id);
  await audit(req, 'AUDIT_TERZI_CARICATO', { module: KEY, entity: 'audit', entityId: row.id, data: { site_id: b.site_id, file: files.length, pagine, ocr, caratteri: sintesi_testo.length } });
  res.status(201).json({ id: row.id, file: files.length, pagine, ocr, caratteri: sintesi_testo.length });
}));

// Lettura
r.get('/audits/:id', ah(async (req, res) => {
  const a = await loadAudit(idOf(req.params.id, 'Audit non trovato'));
  assertCanSee(req, a);
  res.json({ ...a, can_edit: canEditAnswers(req, a), can_verify: canVerify(req, a), can_delete: canDelete(req, a), can_close: a.kind === 'AUTO' ? (a.status === 'BOZZA' ? canEditAnswers(req, a) : canVerify(req, a)) : (a.kind === 'TERZI' ? isAuditor(req) && a.status === 'CARICATO' : isAuditor(req) && a.status === 'BOZZA'), can_reopen: isQualita(req) && ['VERIFICATO', 'CHIUSO', 'INVIATO'].includes(a.status), can_attach: isAuditor(req) || canEditAnswers(req, a) });
}));

// Salvataggio (bozza): colonna principale da chi compila; colonna Verifica dal verificatore (AUTO inviato)
r.put('/audits/:id', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  assertCanSee(req, a);
  const b = parse(patchSchema, req.body || {});
  let sc;
  if (b.verifier_answers) {
    if (!canVerify(req, a)) throw forbidden('La colonna Verifica si compila dopo l\'invio della sede, da Qualità o dagli auditor');
    sc = await saveAudit(id, { verifier_answers: clean(b.verifier_answers), ncs: b.ncs, observations: b.observations, report: b.report }, { verifier: true });
  } else {
    if (!canEditAnswers(req, a)) {
      // il verificatore può aggiornare NC e osservazioni anche senza colonna
      if (canVerify(req, a) && (b.ncs || b.observations !== undefined || b.report)) sc = await saveAudit(id, { ncs: b.ncs, observations: b.observations, report: b.report }, { verifier: true });
      else throw forbidden(a.status === 'BOZZA' ? 'Non puoi compilare questo audit' : 'L\'audit non è più in bozza');
    } else sc = await saveAudit(id, { answers: clean(b.answers), header: b.header, ncs: b.ncs, observations: b.observations, report: b.report });
  }
  res.json({ ok: true, score: sc.score, score_verifier: sc.score_verifier, by_section: sc.by_section, answered: sc.answered, total: sc.total, nc: sc.nc });
}));

// Invio dell'auto-audit (sede → verificatori)
r.post('/audits/:id/invia', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  assertCanSee(req, a);
  if (!canEditAnswers(req, a)) throw forbidden('Solo il site manager della sede (o un auditor) invia l\'auto-audit');
  const out = await inviaAuto(id);
  await audit(req, 'AUDIT_INVIATO', { module: KEY, entity: 'audit', entityId: id, data: { site_id: a.site_id, score: out.score, notificati: out.notified } });
  res.json(out);
}));

// Verificatore: copia la colonna della sede nella colonna Verifica
r.post('/audits/:id/conferma-sede', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  if (!canVerify(req, a)) throw forbidden('Operazione riservata al verificatore di un auto-audit inviato');
  const sc = await confermaRisposteSede(id);
  res.json({ ok: true, score_verifier: sc.score_verifier, by_section: sc.by_section });
}));

// Chiusura: AUTO inviato → VERIFICATO (verificatore); INTERNO/LEGAL_ENTITY in bozza → CHIUSO (auditor); TERZI → CHIUSO
r.post('/audits/:id/chiudi', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  assertCanSee(req, a);
  if (a.kind === 'AUTO' ? !canVerify(req, a) : !isAuditor(req)) throw forbidden('Operazione riservata a Qualità, agli auditor o all\'amministratore');
  const status = await chiudi(id, req.moduleUser.id);
  await audit(req, 'AUDIT_CHIUSO', { module: KEY, entity: 'audit', entityId: id, data: { status, site_id: a.site_id, organization_id: a.organization_id } });
  res.json({ ok: true, status });
}));

r.post('/audits/:id/riapri', ah(async (req, res) => {
  if (!isQualita(req)) throw forbidden('Riapertura riservata a Qualità o all\'amministratore');
  const id = idOf(req.params.id, 'Audit non trovato');
  const status = await riapri(id);
  await audit(req, 'AUDIT_RIAPERTO', { module: KEY, entity: 'audit', entityId: id, data: { status } });
  res.json({ ok: true, status });
}));

// Cestino (soft delete)
r.delete('/audits/:id', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  assertCanSee(req, a);
  if (!canDelete(req, a)) throw forbidden(['CHIUSO', 'VERIFICATO'].includes(a.status) ? 'Un audit chiuso o verificato lo elimina solo Qualità o l\'amministratore' : 'Puoi eliminare solo le bozze della tua sede');
  await softDelete(id, req.moduleUser.id);
  await audit(req, 'AUDIT_ELIMINATO', { module: KEY, entity: 'audit', entityId: id, data: { kind: a.kind, status: a.status, site_id: a.site_id, organization_id: a.organization_id } });
  res.json({ ok: true });
}));

// Allegati (evidenze): foto, PDF
r.post('/audits/:id/files', conUpload, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Audit non trovato');
  const a = await loadAudit(id, { withAnswers: false });
  assertCanSee(req, a);
  if (!(isAuditor(req) || canEditAnswers(req, a))) throw forbidden('Non puoi allegare evidenze a questo audit');
  const files = req.files || [];
  if (!files.length) throw bad('Nessun file ricevuto (campo "file")');
  const out = [];
  for (const f of files) {
    if (!/^(image\/|application\/pdf)/.test(f.mimetype || '') && !/\.(pdf|png|jpe?g|webp|heic)$/i.test(f.originalname || '')) throw bad(`"${f.originalname}": sono ammessi PDF e immagini`);
    out.push(await addFile(id, f, String(req.body?.label || '').slice(0, 120) || null, req.moduleUser.id));
  }
  await audit(req, 'AUDIT_ALLEGATI', { module: KEY, entity: 'audit', entityId: id, data: { file: out.length } });
  res.status(201).json({ files: out });
}));
r.get('/files/:id', ah(async (req, res) => {
  const f = await one('SELECT f.*, a.site_id, a.kind FROM audit_files f JOIN audits a ON a.id=f.audit_id WHERE f.id=$1', [idOf(req.params.id, 'Allegato non trovato')]);
  if (!f) throw notFound('Allegato non trovato');
  if (limitedToSites(req) && (f.kind === 'LEGAL_ENTITY' || !canSeeSite(req, f.site_id))) throw forbidden();
  await sendFile(res, f, { inline: req.query.inline === '1' });
}));
r.delete('/files/:id', ah(async (req, res) => {
  const fid = idOf(req.params.id, 'Allegato non trovato');
  const f = await one('SELECT f.audit_id FROM audit_files f WHERE f.id=$1', [fid]);
  if (!f) throw notFound('Allegato non trovato');
  const a = await loadAudit(f.audit_id, { withAnswers: false });
  if (!(isAuditor(req) || canEditAnswers(req, a))) throw forbidden();
  await removeFile(fid);
  res.json({ ok: true });
}));

// Esportazione del singolo audit
r.get('/audits/:id/export.xlsx', ah(async (req, res) => {
  const a = await loadAudit(idOf(req.params.id, 'Audit non trovato')); assertCanSee(req, a);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`Audit ${a.id} ${a.subject || ''}.xlsx`)}`);
  res.send(await auditXlsx(a));
}));
r.get('/audits/:id/export.pdf', ah(async (req, res) => {
  const a = await loadAudit(idOf(req.params.id, 'Audit non trovato')); assertCanSee(req, a);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(`Audit ${a.id} ${a.subject || ''}.pdf`)}`);
  res.send(await auditPdf(a));
}));

export default r;
