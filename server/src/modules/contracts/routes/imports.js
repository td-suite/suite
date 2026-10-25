// Import del pacchetto iniziale (zip con manifest.json + files/): risorse, contratti, lettere, dossier, CV box
import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import yauzl from 'yauzl';
import { one, q, tx } from '../db.js';
import { ah, bad, audit } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { config } from '../config.js';
import { personSchema, employmentSchema, lpSchema, upsertEmployment, upsertLp } from './resources.js';
import { createPerson, updatePerson, reindexPerson } from '../lib/people.js';

const r = Router();
// Nomi delle aree usati nei pacchetti precedenti all'allineamento con l'organigramma SGI
const AREA_ALIASES = {"Punti Prelievo e Accettazione": "Network Punti Prelievo", "Diagnostica per Immagini": "Diagnostic Center", "People & Culture": "Legal, People and Organization", "Finance e Amministrazione": "Finance", "Retail e Comunicazione": "Retail & Communications Management", "Qualità, Sicurezza e SGI": "HSQ Management", "Qualità Sicurezza e SGI": "HSQ Management", "Procurement e Logistica": "Operations", "Medicina del Lavoro": "B2B", "Medicina Specialistica": "Direzione Generale", "Legale": "Direzione Generale", "IT e Sistemi Informativi": "Direzione Generale", "Lab Operations": "Lab Operations Management"};
const upload = multer({ storage: multer.diskStorage({ destination: os.tmpdir() }), limits: { fileSize: config.maxPackMb * 1024 * 1024 } });

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', zip: 'application/zip', txt: 'text/plain' };
const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip))));
}
function readEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => {
    if (err) return reject(err);
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  }));
}
// Itera le voci dello zip in sequenza; handler(entry) può restituire false per saltare la lettura
async function walkZip(file, handler) {
  const zip = await openZip(file);
  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      try {
        if (!/\/$/.test(entry.fileName)) await handler(entry, () => readEntry(zip, entry));
        zip.readEntry();
      } catch (e) { zip.close(); reject(e); }
    });
    zip.on('end', resolve);
    zip.on('error', reject);
  });
}

r.post('/pack', requireRole('ADMIN'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const mode = req.body.mode === 'update' ? 'update' : 'skip';
  const file = req.file.path;
  const log = []; const stats = { resources_created: 0, resources_updated: 0, resources_skipped: 0, attachments: 0, attachments_skipped: 0, letters: 0, cv: 0, errors: 0 };
  try {
    let manifest = null;
    await walkZip(file, async (entry, read) => { if (entry.fileName === 'manifest.json') manifest = JSON.parse((await read()).toString('utf8')); });
    if (!manifest?.resources) throw bad('manifest.json mancante o non valido');
    // 1) risorse e dati contrattuali
    const keyToId = {};
    for (const item of manifest.resources) {
      try {
        const { area_name, manager_key, ...rawPerson } = item.person;
        const person = personSchema.parse(rawPerson);
        if (area_name) person.area_id = (await one('SELECT id FROM areas WHERE lower(name)=lower($1)', [AREA_ALIASES[area_name] || area_name]))?.id || null;
        const existing = person.tax_code ? await one('SELECT id FROM public.people WHERE upper(tax_code)=upper($1)', [person.tax_code]) : await one('SELECT id FROM public.people WHERE lower(last_name)=lower($1) AND lower(first_name)=lower($2)', [person.last_name, person.first_name]);
        let id;
        if (existing && mode === 'skip') { keyToId[item.key] = existing.id; stats.resources_skipped++; continue; }
        await tx(async (c) => {
          // anagrafica unica: public.people + person_ext con audit della Suite
          if (existing) {
            await updatePerson(c, req, existing.id, person);
            id = existing.id; stats.resources_updated++;
          } else {
            id = await createPerson(c, req, person);
            stats.resources_created++;
          }
          if (item.employment) { const e = employmentSchema.parse(item.employment); await upsertEmployment(c, id, e); if (e.start_date && !person.hired_at) await updatePerson(c, req, id, { hired_at: e.start_date }, { audit: false }); }
          if (item.lp) { const l = lpSchema.parse(item.lp); await upsertLp(c, id, l); if (l.start_date && !person.hired_at) await updatePerson(c, req, id, { hired_at: l.start_date }, { audit: false }); }
          for (const l of item.letters || []) {
            if ((await c.query('SELECT 1 FROM commitment_letters WHERE resource_id=$1 AND letter_date=$2', [id, l.letter_date || null])).rows.length) continue;
            await c.query(`INSERT INTO commitment_letters (resource_id, status, letter_date, start_by, valid_until, level, qualification, job_title, weekly_hours, autonomous_hours, ral, ral_steps, mbo_enabled, mbo_pct, work_site_id, contract_type, accepted_at, notes, created_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
              [id, l.status || 'ACCETTATA', l.letter_date || null, l.start_by || null, l.valid_until || null, l.level || null, l.qualification || null, l.job_title || null, l.weekly_hours || 40, Boolean(l.autonomous_hours), l.ral || 0, JSON.stringify(l.ral_steps || []), Boolean(l.mbo_enabled), l.mbo_pct || null, l.work_site_id || null, l.contract_type || 'TIND', l.accepted_at || null, l.notes || null, req.user.id]);
            stats.letters++;
          }
        });
        keyToId[item.key] = id; reindexPerson(id);
      } catch (e) { stats.errors++; log.push(`Risorsa ${item.key}: ${e.message}`); }
    }
    // 1b) responsabili (riferimenti tra chiavi)
    for (const item of manifest.resources) {
      const mk = item.person?.manager_key;
      if (mk && keyToId[item.key] && keyToId[mk]) await updatePerson(null, req, keyToId[item.key], { manager_id: keyToId[mk] }, { audit: false });
    }
    // 2) allegati (streaming dallo zip)
    const attIndex = {};
    for (const item of manifest.resources) for (const a of item.attachments || []) attIndex[a.path] = { ...a, key: item.key };
    const cvIndex = {};
    for (const c of manifest.cv_box || []) cvIndex[c.path] = c;
    await walkZip(file, async (entry, read) => {
      const a = attIndex[entry.fileName];
      if (a) {
        const id = keyToId[a.key];
        if (!id) return;
        const buf = await read();
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        if (await one('SELECT 1 FROM attachments WHERE resource_id=$1 AND sha256=$2', [id, sha])) { stats.attachments_skipped++; return; }
        const filename = a.filename || path.basename(entry.fileName);
        const row = await one(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, sha256, issued_at, expires_at, signed, notes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [id, a.category || 'ALTRO', filename, mimeOf(filename), buf.length, buf, sha, a.issued_at || null, a.expires_at || null, Boolean(a.signed), a.notes || null, req.user.id]);
        if (a.is_cv) await updatePerson(null, req, id, { cv_attachment_id: row.id }, { audit: false });
        stats.attachments++;
        return;
      }
      const c = cvIndex[entry.fileName];
      if (c) {
        const buf = await read();
        const filename = c.filename || path.basename(entry.fileName);
        if (await one('SELECT 1 FROM cv_box WHERE filename=$1 AND size=$2', [filename, buf.length])) return;
        await q(`INSERT INTO cv_box (last_name, first_name, email, phone, area_id, role_target, summary, status, source, filename, mime, size, data, received_at, uploaded_by)
          VALUES ($1,$2,$3,$4,(SELECT id FROM areas WHERE lower(name)=lower($5)),$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14, CURRENT_DATE),$15)`,
          [c.last_name || null, c.first_name || null, c.email || null, c.phone || null, c.area || null, c.role_target || null, c.summary || null, c.status || 'NUOVO', c.source || 'Import', filename, mimeOf(filename), buf.length, buf, c.received_at || null, req.user.id]);
        stats.cv++;
      }
    });
    await audit(req, 'IMPORT_PACK', 'import', null, stats);
    res.json({ stats, log });
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}));

export default r;
