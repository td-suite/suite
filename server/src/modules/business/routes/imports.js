// Caricamento dello status quo (richiesta del CEO, 28/10/2026): pacchetti ZIP con manifest.json + files/ preparati dalle cartelle OneDrive
// (Punti Prelievo e Centri Medici, Service di Laboratorio, Medicina del Lavoro, Autorizzazioni Sanitarie). Il pacchetto porta:
//   organizations: controparti → Legal entity dell'anagrafica unica (abbinate per P.IVA, codice fiscale o nome; create se mancano)
//   contracts: contratti PP / SRV / MDL / SEDE con controparte, sede TD (abbinata per città e nome), date, dati, eventi e documenti
//   dossiers: fascicoli di autorizzazione sanitaria per sede TD con documenti classificati per voce del catalogo (lib/dossier.js)
// Idempotente: ogni contratto e fascicolo ha una chiave di importazione; rieseguire aggiorna i dati e aggiunge solo i documenti nuovi
// (per impronta sha256). Prova (dry run) senza scrivere nulla: restituisce il piano con abbinamenti e avvisi.
// I documenti vanno su Azure Blob Storage se configurato (lib/storage.js); senza blob il pacchetto si accetta solo se piccolo.
import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import yauzl from 'yauzl';
import { one, many, q } from '../db.js';
import { ah, bad, audit } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { config } from '../config.js';
import { storeBuffer, storageMode } from '../lib/storage.js';
import { sha256 } from '../lib/crypto.js';
import { DOC_BY_KEY, defaultChecklists, DEFAULT_HOURS } from '../lib/dossier.js';
import { addEvent, nextProtocol } from './contracts.js';
import { getSettings } from '../lib/rules.js';
import { indexOrg } from '../../../lib/search.js';
import { matchOrg, matchSite } from '../../../lib/anagraficaMatch.js';

const r = Router();
const upload = multer({ storage: multer.diskStorage({ destination: os.tmpdir() }), limits: { fileSize: Number(process.env.BUSINESS_PACK_MAX_MB || 400) * 1024 * 1024 } });
const DB_ONLY_LIMIT = Number(process.env.BUSINESS_PACK_DB_LIMIT_MB || 60) * 1024 * 1024;   // senza archivio blob i documenti finiscono nel database: si accettano solo pacchetti piccoli

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip', txt: 'text/plain', p7m: 'application/pkcs7-mime', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822', json: 'application/json' };
const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
const CONTRACT_CATS = new Set(['GENERATO_DOCX', 'GENERATO_PDF', 'FIRMATO', 'LISTINO_XLSX', 'LISTINO_PDF', 'PLANIMETRIA', 'ASSICURAZIONE', 'ALTRO']);
const KINDS = new Set(['PP', 'SRV', 'MDL', 'SEDE']);
const STATUSES = new Set(['BOZZA', 'PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO', 'ANNULLATO']);
const ORG_KINDS = new Set(['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO']);

function openZip(file) { return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)))); }
function readEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => {
    if (err) return reject(err);
    const chunks = []; stream.on('data', (c) => chunks.push(c)); stream.on('end', () => resolve(Buffer.concat(chunks))); stream.on('error', reject);
  }));
}
async function walkZip(file, handler) {
  const zip = await openZip(file);
  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      try { if (!/\/$/.test(entry.fileName)) await handler(entry, () => readEntry(zip, entry)); zip.readEntry(); } catch (e) { zip.close(); reject(e); }
    });
    zip.on('end', resolve); zip.on('error', reject);
  });
}

// ---- abbinamenti con l'anagrafica unica
// Abbinamento a Legal entity e sedi: lib/anagraficaMatch.js della Suite (condiviso con lo Scadenziario strutture di Payments)
function clean(o, keys) { const out = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = typeof o[k] === 'string' ? o[k].trim() : o[k]; return out; }
const ORG_COLS = ['name', 'kind', 'vat_number', 'tax_code', 'sdi', 'pec', 'email', 'phone', 'address', 'zip', 'city', 'province', 'website', 'notes'];
const EXT_COLS = ['legal_rep', 'signer', 'signer_role', 'contract_services', 'lab_reference', 'billing_ref', 'sales_contact', 'sales_email', 'sales_phone', 'svc_contact', 'svc_email', 'svc_mobile', 'svc_address', 'proc_contact', 'proc_email', 'proc_mobile', 'proc_address', 'pay_method', 'pay_terms', 'vat_territoriality', 'intent_declaration', 'tax_values', 'portal_url', 'portal_username', 'notes'];

// Organizzazione: abbina o crea; completa i campi vuoti del core senza sovrascrivere ciò che c'è
async function upsertOrg(o, userId, dryRun, report) {
  const hit = await matchOrg(o);
  const data = clean(o, ORG_COLS);
  if (!ORG_KINDS.has(data.kind)) data.kind = 'CLIENTE';
  if (hit) {
    report.organizations.matched.push({ key: o.key, name: o.name, org_id: hit.id, org_name: hit.name, how: hit.how });
    if (!dryRun) {
      const cur = await one('SELECT * FROM public.organizations WHERE id=$1', [hit.id]);
      const sets = []; const params = [hit.id];
      for (const [k, v] of Object.entries(data)) if (k !== 'kind' && k !== 'name' && (cur[k] === null || cur[k] === '')) { params.push(v); sets.push(`${k}=$${params.length}`); }
      params.push(JSON.stringify({ business_pack: o.key })); sets.push(`legacy_refs=coalesce(legacy_refs,'{}'::jsonb) || $${params.length}::jsonb`);
      await q(`UPDATE public.organizations SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      await upsertExt(hit.id, o.ext, userId);
      indexOrg(await one('SELECT * FROM public.organizations WHERE id=$1', [hit.id])).catch(() => {});
    }
    return hit.id;
  }
  report.organizations.created.push({ key: o.key, name: o.name, kind: data.kind, vat_number: data.vat_number || null });
  if (dryRun) return null;
  const cols = Object.keys(data); const vals = Object.values(data);
  const row = await one(`INSERT INTO public.organizations (${cols.join(', ')}, legacy_refs) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING *`, [...vals, JSON.stringify({ business_pack: o.key })]);
  await upsertExt(row.id, o.ext, userId);
  indexOrg(row).catch(() => {});
  return row.id;
}
async function upsertExt(orgId, ext, userId) {
  const data = clean(ext || {}, EXT_COLS);
  if (!Object.keys(data).length) return;
  const cur = await one('SELECT * FROM org_ext WHERE org_id=$1', [orgId]);
  if (!cur) {
    const cols = Object.keys(data);
    await q(`INSERT INTO org_ext (org_id, ${cols.join(', ')}, created_by, updated_by) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, $${cols.length + 2})`, [orgId, ...Object.values(data), userId]);
    return;
  }
  const sets = []; const params = [orgId];
  for (const [k, v] of Object.entries(data)) if (cur[k] === null || cur[k] === '') { params.push(v); sets.push(`${k}=$${params.length}`); }
  if (sets.length) { params.push(userId); await q(`UPDATE org_ext SET ${sets.join(', ')}, updated_by=$${params.length}, updated_at=now() WHERE org_id=$1`, params); }
}

const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);

r.post('/import/pack', requireAdmin, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const dryRun = req.body.dry_run === '1' || req.body.dry_run === 'true';
  const file = req.file.path;
  const report = { dry_run: dryRun, storage: storageMode(), organizations: { matched: [], created: [] }, contracts: { created: 0, updated: 0, skipped: [] }, dossiers: { created: 0, updated: 0, skipped: [] }, files: { stored: 0, skipped_existing: 0, missing: [] , bytes: 0 }, warnings: [] };
  try {
    let manifest = null; let totalBytes = 0; const entries = new Map();
    await walkZip(file, async (entry, read) => {
      if (entry.fileName === 'manifest.json') manifest = JSON.parse((await read()).toString('utf8'));
      else { entries.set(entry.fileName, entry.uncompressedSize); totalBytes += entry.uncompressedSize; }
    });
    if (!manifest || manifest.format !== 'td-business-pack') throw bad('manifest.json mancante o non valido (atteso format "td-business-pack")');
    if (storageMode() === 'db' && totalBytes > DB_ONLY_LIMIT) throw bad(`L'archivio file (Azure Blob Storage) non è configurato: nel database si accettano solo pacchetti fino a ${Math.round(DB_ONLY_LIMIT / 1e6)} MB di documenti (questo ne ha ${Math.round(totalBytes / 1e6)}). Configura AZURE_STORAGE_CONNECTION_STRING su Render e riprova.`);
    const userId = req.user.id;
    const settings = await getSettings();

    // 1) controparti → Legal entity
    const orgIds = {};
    for (const o of manifest.organizations || []) {
      if (!o.key || !o.name) { report.warnings.push(`Organizzazione senza chiave o nome: ${JSON.stringify(o).slice(0, 80)}`); continue; }
      orgIds[o.key] = await upsertOrg(o, userId, dryRun, report);
    }

    // 2) contratti
    const contractIds = {};
    for (const c of manifest.contracts || []) {
      try {
        if (!c.key || !KINDS.has(c.kind)) throw new Error('chiave o sezione mancante');
        let orgId = c.org_key ? orgIds[c.org_key] : null;
        if (c.org_key && !(c.org_key in orgIds)) {
          // controparte caricata da un pacchetto precedente: la si ritrova dal riferimento salvato sulla Legal entity
          const prev = await one(`SELECT id FROM public.organizations WHERE legacy_refs->>'business_pack'=$1`, [c.org_key]);
          if (!prev) throw new Error(`controparte "${c.org_key}" non presente nel pacchetto né tra le Legal entity già caricate: carica prima il pacchetto 01`);
          orgId = prev.id;
        }
        const site = await matchSite(c.site);
        if (c.site && !site) {
          report.contracts.skipped.push({ key: c.key, title: c.title, reason: `sede TD non trovata nell'anagrafica (${c.site.city || ''} ${(c.site.names || []).join(' / ')}): creala in Amministrazione > Sedi e ripeti il caricamento` });
          continue;
        }
        if ((c.kind === 'PP' || c.kind === 'SEDE') && !site) throw new Error('la sezione richiede la sede TD');
        if (!orgId && !site && !dryRun) throw new Error('né controparte né sede');
        const status = STATUSES.has(c.status) ? c.status : 'BOZZA';
        const cur = await one('SELECT id, status FROM contracts WHERE import_key=$1', [c.key]);
        if (dryRun) { if (cur) report.contracts.updated++; else report.contracts.created++; contractIds[c.key] = cur?.id || null; if (site) report.warnings.push(`Contratto ${c.key}: sede ${site.name} (${site.how})`); continue; }
        const params = [c.kind, c.protocol || null, status, orgId, site?.id || null, c.title || null, dateOrNull(c.proposal_date) || dateOrNull(c.start_date) || new Date().toISOString().slice(0, 10), dateOrNull(c.start_date), dateOrNull(c.end_date), JSON.stringify(c.data || {}), c.notes || null, dateOrNull(c.signed_at), userId, c.key];
        let id;
        if (cur) {
          id = cur.id;
          await q(`UPDATE contracts SET kind=$1, protocol=coalesce($2, protocol), status=$3, org_id=coalesce($4, org_id), site_id=coalesce($5, site_id), title=coalesce($6, title), proposal_date=$7, start_date=$8, end_date=$9, data=$10, notes=coalesce($11, notes), signed_at=coalesce($12, signed_at), updated_at=now() WHERE import_key=$13`, [...params.slice(0, 12), c.key]);
          report.contracts.updated++;
        } else {
          // protocollo del modulo per i contratti che sono già oltre la bozza (proposte inviate, firmati, attivi, cessati): anno della proposta
          if (!params[1] && status !== 'BOZZA') params[1] = await nextProtocol(c.kind, Number(String(params[6]).slice(0, 4)) || new Date().getFullYear(), settings, { query: q });
          id = (await one(`INSERT INTO contracts (kind, protocol, status, org_id, site_id, title, proposal_date, start_date, end_date, data, notes, signed_at, created_by, import_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, params)).id;
          await addEvent(id, 'IMPORTATO', userId, `Caricato dal pacchetto ${req.file.originalname}`);
          for (const ev of c.events || []) await addEvent(id, ev.kind || 'NOTA', userId, ev.note || null, ev.data || null);
          report.contracts.created++;
        }
        contractIds[c.key] = id;
      } catch (e) { report.contracts.skipped.push({ key: c.key, title: c.title, reason: e.message }); }
    }

    // 3) fascicoli
    const dossierIds = {};
    for (const d of manifest.dossiers || []) {
      try {
        if (!d.key) throw new Error('chiave mancante');
        const site = await matchSite(d.site);
        const contractId = d.contract_key ? (contractIds[d.contract_key] || (await one('SELECT id FROM contracts WHERE import_key=$1', [d.contract_key]))?.id || null) : null;
        if (d.contract_key && !contractId) report.warnings.push(`Fascicolo ${d.key}: contratto ${d.contract_key} non ancora caricato (carica prima il pacchetto dei contratti): il fascicolo nasce senza collegamento al contratto`);
        const orgId = d.org_key ? (orgIds[d.org_key] || (await one(`SELECT id FROM public.organizations WHERE legacy_refs->>'business_pack'=$1`, [d.org_key]))?.id) : (contractId ? (await one('SELECT org_id FROM contracts WHERE id=$1', [contractId]))?.org_id : null);
        if (!site && !orgId) { report.dossiers.skipped.push({ key: d.key, title: d.title, reason: `sede TD non trovata (${d.site?.city || ''} ${(d.site?.names || []).join(' / ')}): creala in Amministrazione > Sedi` }); continue; }
        const cur = await one('SELECT id FROM dossiers WHERE import_key=$1', [d.key]) || (contractId ? await one('SELECT id FROM dossiers WHERE contract_id=$1', [contractId]) : null);
        if (dryRun) { if (cur) report.dossiers.updated++; else report.dossiers.created++; continue; }
        const status = ['IN_CORSO', 'PRESENTATO', 'AUTORIZZATO'].includes(d.status) ? d.status : 'IN_CORSO';
        let id;
        if (cur) {
          id = cur.id;
          await q(`UPDATE dossiers SET status=$2, title=coalesce($3, title), site_id=coalesce($4, site_id), org_id=coalesce($5, org_id), submitted_at=coalesce($6, submitted_at), authorized_at=coalesce($7, authorized_at), authorization_ref=coalesce($8, authorization_ref), extra=extra || $9::jsonb, import_key=$10, contract_id=coalesce(contract_id, $11), updated_at=now() WHERE id=$1`,
            [id, status, d.title || null, site?.id || null, orgId || null, dateOrNull(d.submitted_at), dateOrNull(d.authorized_at), d.authorization_ref || null, JSON.stringify(d.extra || {}), d.key, contractId]);
          if (contractId && status === 'AUTORIZZATO') await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1 AND status='FIRMATO'`, [contractId]);
          report.dossiers.updated++;
        } else {
          id = (await one(`INSERT INTO dossiers (contract_id, org_id, site_id, title, status, doc_date, hours, staff, equipment, checklists, doc_state, extra, submitted_at, authorized_at, authorization_ref, created_by, import_key)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [contractId, orgId || null, site?.id || null, d.title || null, status, dateOrNull(d.doc_date), JSON.stringify(d.hours || DEFAULT_HOURS), JSON.stringify(d.staff || []), JSON.stringify(d.equipment || []), JSON.stringify(d.checklists || defaultChecklists()), JSON.stringify(d.doc_state || {}), JSON.stringify(d.extra || {}), dateOrNull(d.submitted_at), dateOrNull(d.authorized_at), d.authorization_ref || null, userId, d.key])).id;
          report.dossiers.created++;
          if (contractId && status === 'AUTORIZZATO') await q(`UPDATE contracts SET status='AUTORIZZATO', updated_at=now() WHERE id=$1 AND status='FIRMATO'`, [contractId]);
        }
        dossierIds[d.key] = id;
      } catch (e) { report.dossiers.skipped.push({ key: d.key, title: d.title, reason: e.message }); }
    }

    // 4) documenti (lettura in streaming dallo zip; impronta sha256 per non duplicare)
    // lo stesso documento può appartenere a più contratti o fascicoli (stesso percorso nello zip, più destinatari)
    const fileIndex = {};
    for (const c of manifest.contracts || []) for (const f of c.files || []) (fileIndex[f.path] ||= []).push({ ...f, owner: 'contract', key: c.key });
    for (const d of manifest.dossiers || []) for (const f of d.files || []) (fileIndex[f.path] ||= []).push({ ...f, owner: 'dossier', key: d.key });
    for (const p of Object.keys(fileIndex)) if (!entries.has(p)) report.files.missing.push(p);
    if (!dryRun) {
      await walkZip(file, async (entry, read) => {
        const owners = fileIndex[entry.fileName];
        if (!owners) return;
        let buf = null;
        for (const f of owners) {
        const targetId = f.owner === 'contract' ? contractIds[f.key] : dossierIds[f.key];
        if (!targetId) continue;
        if (!buf) buf = await read();
        const digest = sha256(buf);
        const filename = f.filename || path.basename(entry.fileName);
        if (f.owner === 'contract') {
          if (await one('SELECT 1 FROM contract_files WHERE contract_id=$1 AND sha256=$2', [targetId, digest])) { report.files.skipped_existing++; continue; }
          const cat = CONTRACT_CATS.has(f.category) ? f.category : 'ALTRO';
          const st = await storeBuffer('contratti', filename, mimeOf(filename), buf);
          await q('INSERT INTO contract_files (contract_id, category, filename, mime, size, sha256, data, blob_path, label, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)', [targetId, cat, filename, mimeOf(filename), st.size, st.sha256, st.data, st.blob_path, f.label || null, userId]);
        } else {
          if (await one('SELECT 1 FROM dossier_files WHERE dossier_id=$1 AND sha256=$2', [targetId, digest])) { report.files.skipped_existing++; continue; }
          const key = DOC_BY_KEY[f.doc_key] ? f.doc_key : 'ALTRO';
          const st = await storeBuffer('fascicoli', filename, mimeOf(filename), buf);
          await q('INSERT INTO dossier_files (dossier_id, doc_key, source, filename, mime, size, sha256, data, blob_path, label, uploaded_by) VALUES ($1,$2,\'UPLOAD\',$3,$4,$5,$6,$7,$8,$9,$10)', [targetId, key, filename, mimeOf(filename), st.size, st.sha256, st.data, st.blob_path, f.label || null, userId]);
        }
        report.files.stored++; report.files.bytes += buf.length;
        }
      });
    } else report.files.planned = Object.entries(fileIndex).filter(([p]) => entries.has(p)).reduce((a, [, v]) => a + v.length, 0);

    const summary = { ...report, organizations: { matched: report.organizations.matched.length, created: report.organizations.created.length } };
    await q('INSERT INTO import_runs (filename, dry_run, user_id, summary) VALUES ($1,$2,$3,$4)', [req.file.originalname, dryRun, userId, JSON.stringify(summary)]);
    if (!dryRun) await audit(req, 'IMPORT_PACK', 'import', null, summary);
    res.json(report);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}));

r.get('/import/runs', requireAdmin, ah(async (_req, res) => {
  res.json(await many('SELECT r.id, r.filename, r.dry_run, r.at, r.summary, u.full_name AS user_name FROM import_runs r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.at DESC LIMIT 30'));
}));

export default r;
