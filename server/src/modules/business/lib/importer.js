// Importazione dello status quo da un pacchetto ZIP: manifest.json + documenti.
// Idempotente: partner e contratti hanno una chiave di importazione (import_key); ciò che esiste già viene saltato.
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import { z } from 'zod';
import { tx, one } from '../db.js';
import { bad } from './util.js';
import { getSettings, HAS_DOSSIER } from './rules.js';
import { encrypt, sha256 } from './crypto.js';
import { defaultChecklists, DEFAULT_HOURS, DOC_BY_KEY } from './dossier.js';
import { validateData, nextProtocol } from '../routes/contracts.js';

const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const keyStr = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{1,80}$/, 'chiave non valida');

const partnerSchema = z.object({
  key: keyStr, name: z.string().trim().min(2).max(200),
  vat: optStr(20), tax_code: optStr(20), sdi: optStr(10), street: optStr(200), zip: optStr(10), city: optStr(120), prov: optStr(4),
  email: optStr(160), phone: optStr(60), pec: optStr(160), legal_rep: optStr(160), signer: optStr(160), signer_role: optStr(120),
  pay_method: optStr(120), pay_terms: optStr(160), bank_name: optStr(120), iban: optStr(40), notes: optStr(2000),
});
const fileSchema = z.object({ path: z.string().min(1).max(400), category: z.enum(['GENERATO_PDF', 'FIRMATO', 'LISTINO_XLSX', 'LISTINO_PDF', 'PLANIMETRIA', 'ASSICURAZIONE', 'ALTRO']), label: optStr(200) });
const dossierFileSchema = z.object({ path: z.string().min(1).max(400), doc_key: z.string().min(2).max(40), label: optStr(200) });
const contractSchema = z.object({
  append: z.boolean().optional(),
  key: keyStr, kind: z.enum(['PP', 'SRV', 'MDL', 'SEDE']), partner_key: keyStr, title: optStr(160),
  status: z.enum(['BOZZA', 'PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO']).default('BOZZA'),
  proposal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start_date: optDate, end_date: optDate, signed_at: optDate, notes: optStr(4000),
  data: z.any().default({}), files: z.array(fileSchema).default([]),
  credentials: z.object({ portal_url: optStr(300), username: optStr(160), password: optStr(200), notes: optStr(500) }).nullable().optional(),
  dossier: z.object({
    status: z.enum(['IN_CORSO', 'PRESENTATO', 'AUTORIZZATO']).default('IN_CORSO'),
    submitted_at: optDate, authorized_at: optDate, authorization_ref: optStr(300), files: z.array(dossierFileSchema).default([]),
  }).nullable().optional(),
});
const manifestSchema = z.object({ version: z.number().int().default(1), generated: optStr(40), partners: z.array(partnerSchema), contracts: z.array(contractSchema) });

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', zip: 'application/zip' };
const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
const baseName = (p) => p.split('/').pop().replace(/^\d{3}_/, '');

// Lettura dello ZIP: indice delle voci, poi lettura dei singoli file quando servono (nessun caricamento integrale in memoria)
async function openZip(zipPath) {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  const entries = new Map();
  for await (const e of zip.eachEntry()) {
    if (!/\/$/.test(e.fileName)) entries.set(e.fileName.replace(/\\/g, '/'), e);
  }
  const read = async (name) => {
    const e = entries.get(name);
    if (!e) throw bad(`File mancante nel pacchetto: ${name}`);
    const stream = await zip.openReadStreamPromise(e);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
  };
  return { entries, read, close: () => zip.close() };
}

export async function importPackage(zipPath, { userId, dryRun = false, filename = '' }) {
  const zip = await openZip(zipPath);
  try {
    if (!zip.entries.has('manifest.json')) throw bad('Il pacchetto non contiene manifest.json');
    let manifest;
    try { manifest = JSON.parse((await zip.read('manifest.json')).toString('utf8')); } catch (e) { throw bad(`manifest.json non leggibile: ${e.message}`); }
    const r = manifestSchema.safeParse(manifest);
    if (!r.success) throw bad(`Manifest non valido: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const m = r.data;
    const settings = await getSettings();
    const items = []; const errors = [];
    const counts = { partners: 0, partners_existing: 0, contracts: 0, contracts_skipped: 0, contracts_appended: 0, files: 0, dossier_files: 0, credentials: 0 };
    const partnersByKey = new Map(m.partners.map((p) => [p.key, p]));

    // Verifiche preliminari: file referenziati, partner esistenti, dati di sezione
    for (const c of m.contracts) {
      if (!partnersByKey.has(c.partner_key)) errors.push(`${c.key}: partner ${c.partner_key} non presente nel manifest`);
      for (const f of c.files) if (!zip.entries.has(f.path)) errors.push(`${c.key}: file mancante ${f.path}`);
      if (c.dossier) {
        if (!HAS_DOSSIER(c.kind)) errors.push(`${c.key}: fascicolo previsto solo per Punti Prelievo e Sedi`);
        for (const f of c.dossier.files) {
          if (!zip.entries.has(f.path)) errors.push(`${c.key}: file del fascicolo mancante ${f.path}`);
          if (!DOC_BY_KEY[f.doc_key]) errors.push(`${c.key}: documento del fascicolo sconosciuto ${f.doc_key}`);
        }
      }
      try { validateData(c.kind, c.data); } catch (e) { errors.push(`${c.key}: ${e.message}`); }
      if (['FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO'].includes(c.status) && !c.signed_at) c.signed_at = c.proposal_date;
    }
    if (errors.length) return { ok: false, dryRun, errors, counts, items };

    // Ordine: per sezione e data proposta, così i protocolli seguono la cronologia
    const ordered = [...m.contracts].sort((a, b) => (a.kind + a.proposal_date + a.key).localeCompare(b.kind + b.proposal_date + b.key));
    const existingContracts = new Set((await one(`SELECT array_agg(import_key) AS k FROM contracts WHERE import_key = ANY($1)`, [ordered.map((c) => c.key)]))?.k?.filter(Boolean) || []);
    const existingPartners = new Map();
    for (const p of m.partners) {
      const ex = await one('SELECT id, name FROM partners WHERE import_key=$1', [p.key]);
      if (ex) existingPartners.set(p.key, ex);
    }

    if (dryRun) {
      for (const c of ordered) {
        const exists = existingContracts.has(c.key);
        const skip = exists && !c.append;
        items.push({ key: c.key, kind: c.kind, title: c.title || partnersByKey.get(c.partner_key).name, status: c.status, action: skip ? 'già presente' : exists ? 'da integrare' : 'da creare', files: c.files.length + (c.dossier?.files.length || 0), credentials: Boolean(c.credentials?.username) });
        if (skip) counts.contracts_skipped++; else if (exists) { counts.contracts_appended++; counts.files += c.files.length; counts.dossier_files += c.dossier?.files.length || 0; } else { counts.contracts++; counts.files += c.files.length; counts.dossier_files += c.dossier?.files.length || 0; if (c.credentials?.username) counts.credentials++; }
      }
      for (const p of m.partners) { if (existingPartners.has(p.key)) counts.partners_existing++; else counts.partners++; }
      return { ok: true, dryRun, errors, counts, items, generated: m.generated };
    }

    const partnerIds = new Map([...existingPartners].map(([k, v]) => [k, v.id]));
    for (const c of ordered) {
      const p = partnersByKey.get(c.partner_key);
      if (existingContracts.has(c.key)) {
        if (!c.append) { counts.contracts_skipped++; items.push({ key: c.key, kind: c.kind, title: c.title, status: c.status, action: 'già presente' }); continue; }
        // Integrazione: il contratto esiste (pacchetto precedente), si aggiungono solo i file mancanti (stesso nome e stesso contenuto).
        const added = await tx(async (client) => {
          const row = (await client.query('SELECT id, protocol FROM contracts WHERE import_key=$1', [c.key])).rows[0];
          const cid = row.id; let nFiles = 0; let nDoss = 0;
          const have = new Set((await client.query('SELECT filename, sha256 FROM contract_files WHERE contract_id=$1', [cid])).rows.map((r) => `${r.filename}|${r.sha256}`));
          for (const f of c.files) {
            const buf = await zip.read(f.path); const name = baseName(f.path); const h = sha256(buf);
            if (have.has(`${name}|${h}`)) continue;
            await client.query('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)', [cid, f.category, name, mimeOf(name), buf.length, h, buf, userId]);
            nFiles++;
          }
          const priceLists = (await client.query(`SELECT filename FROM contract_files WHERE contract_id=$1 AND category LIKE 'LISTINO%' ORDER BY id`, [cid])).rows.map((r) => r.filename);
          if (priceLists.length) await client.query(`UPDATE contracts SET data = data || jsonb_build_object('price_list_file', $2::text) WHERE id=$1`, [cid, priceLists.join(', ')]);
          if (HAS_DOSSIER(c.kind) && c.dossier?.files?.length) {
            const did = (await client.query('SELECT id FROM dossiers WHERE contract_id=$1', [cid])).rows[0]?.id;
            if (did) {
              const haveD = new Set((await client.query('SELECT doc_key, filename, sha256 FROM dossier_files WHERE dossier_id=$1', [did])).rows.map((r) => `${r.doc_key}|${r.filename}|${r.sha256}`));
              for (const f of c.dossier.files) {
                const buf = await zip.read(f.path); const name = baseName(f.path); const h = sha256(buf);
                if (haveD.has(`${f.doc_key}|${name}|${h}`)) continue;
                await client.query('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, label, uploaded_by) VALUES ($1,$2,\'UPLOAD\',$3,$4,$5,$6,$7,$8,$9)', [did, f.doc_key, name, mimeOf(name), buf.length, h, buf, f.label || null, userId]);
                nDoss++;
              }
            }
          }
          if (c.credentials && (c.credentials.username || c.credentials.password)) {
            const hasCred = (await client.query('SELECT 1 FROM portal_credentials WHERE contract_id=$1', [cid])).rowCount > 0;
            if (!hasCred) { await client.query('INSERT INTO portal_credentials(contract_id, portal_url, username, password_enc, notes, updated_by) VALUES ($1,$2,$3,$4,$5,$6)', [cid, c.credentials.portal_url, c.credentials.username, encrypt(c.credentials.password), c.credentials.notes, userId]); counts.credentials++; }
          }
          if (nFiles || nDoss) await client.query('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [cid, 'IMPORTATO', userId, `Integrato dallo status quo (${filename || 'pacchetto'}): ${nFiles} documenti${nDoss ? `, ${nDoss} documenti del fascicolo` : ''}`, JSON.stringify({ import_key: c.key, append: true })]);
          return { id: cid, protocol: row.protocol, nFiles, nDoss };
        });
        counts.contracts_appended++; counts.files += added.nFiles; counts.dossier_files += added.nDoss;
        items.push({ key: c.key, kind: c.kind, id: added.id, title: c.title || p.name, status: c.status, protocol: added.protocol, action: 'integrato', files: added.nFiles + added.nDoss });
        continue;
      }
      const result = await tx(async (client) => {
        let partnerId = partnerIds.get(p.key);
        if (!partnerId) {
          const row = (await client.query(`INSERT INTO partners (name, vat, tax_code, sdi, street, zip, city, prov, email, phone, pec, legal_rep, signer, signer_role, pay_method, pay_terms, bank_name, iban, notes, import_key, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [p.name, p.vat, p.tax_code, p.sdi, p.street, p.zip, p.city, p.prov, p.email, p.phone, p.pec, p.legal_rep, p.signer, p.signer_role, p.pay_method, p.pay_terms, p.bank_name, p.iban, p.notes, p.key, userId])).rows[0];
          partnerId = row.id; partnerIds.set(p.key, partnerId); counts.partners++;
        }
        const data = validateData(c.kind, c.data);
        const title = c.title || p.name;
        let protocol = null;
        if (c.status !== 'BOZZA') protocol = await nextProtocol(c.kind, Number(c.proposal_date.slice(0, 4)), settings, client);
        const endDate = c.end_date;
        const row = (await client.query(`INSERT INTO contracts (kind, partner_id, title, proposal_date, start_date, end_date, notes, data, status, protocol, signed_at, import_key, created_by, cancel_reason, cancelled_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [c.kind, partnerId, title, c.proposal_date, c.start_date, endDate, c.notes, JSON.stringify(data), c.status, protocol, c.signed_at, c.key, userId, c.status === 'CESSATO' ? 'Cessato prima dell’importazione' : null, c.status === 'CESSATO' ? new Date() : null])).rows[0];
        const cid = row.id;
        let nFiles = 0; let nDoss = 0;
        for (const f of c.files) {
          const buf = await zip.read(f.path);
          const name = baseName(f.path);
          await client.query('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)', [cid, f.category, f.label ? `${name}` : name, mimeOf(name), buf.length, sha256(buf), buf, userId]);
          nFiles++;
        }
        const priceLists = c.files.filter((f) => f.category.startsWith('LISTINO')).map((f) => baseName(f.path));
        if (priceLists.length) await client.query(`UPDATE contracts SET data = data || jsonb_build_object('price_list_file', $2::text) WHERE id=$1`, [cid, priceLists.join(', ')]);
        if (HAS_DOSSIER(c.kind)) {
          const d = c.dossier || { status: 'IN_CORSO', files: [] };
          const docState = c.kind === 'SEDE' ? { ATTO_CONDIVISIONE: { not_applicable: true, note: 'Sede intestata a Toscana Diagnostica: nessuna struttura ospitante' }, DUVRI: { not_applicable: true, note: 'Sede intestata a Toscana Diagnostica: nessuna interferenza con una struttura ospitante' } } : {};
          const did = (await client.query('INSERT INTO dossiers (contract_id, status, hours, checklists, doc_date, doc_state, submitted_at, authorized_at, authorization_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
            [cid, d.status, JSON.stringify(DEFAULT_HOURS), JSON.stringify(defaultChecklists()), c.proposal_date, JSON.stringify(docState), d.submitted_at || null, d.authorized_at || null, d.authorization_ref || null])).rows[0].id;
          for (const f of d.files) {
            const buf = await zip.read(f.path);
            const name = baseName(f.path);
            await client.query('INSERT INTO dossier_files(dossier_id, doc_key, source, filename, mime, size, sha256, data, label, uploaded_by) VALUES ($1,$2,\'UPLOAD\',$3,$4,$5,$6,$7,$8,$9)', [did, f.doc_key, name, mimeOf(name), buf.length, sha256(buf), buf, f.label || null, userId]);
            nDoss++;
          }
        }
        if (c.credentials && (c.credentials.username || c.credentials.password)) {
          await client.query('INSERT INTO portal_credentials(contract_id, portal_url, username, password_enc, notes, updated_by) VALUES ($1,$2,$3,$4,$5,$6)', [cid, c.credentials.portal_url, c.credentials.username, encrypt(c.credentials.password), c.credentials.notes, userId]);
          counts.credentials++;
        }
        const note = `Importato dallo status quo (${filename || 'pacchetto'}): stato ${c.status}${protocol ? `, protocollo ${protocol}` : ''}, ${nFiles} documenti${nDoss ? `, ${nDoss} documenti del fascicolo` : ''}`;
        await client.query('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [cid, 'IMPORTATO', userId, note, JSON.stringify({ import_key: c.key, status: c.status, protocol })]);
        return { id: cid, protocol, nFiles, nDoss };
      });
      counts.contracts++; counts.files += result.nFiles; counts.dossier_files += result.nDoss;
      items.push({ key: c.key, kind: c.kind, id: result.id, title: c.title || p.name, status: c.status, protocol: result.protocol, action: 'creato', files: result.nFiles + result.nDoss });
    }
    counts.partners_existing = existingPartners.size;
    return { ok: true, dryRun: false, errors, counts, items, generated: m.generated };
  } finally {
    zip.close();
    fs.promises.unlink(zipPath).catch(() => {});
  }
}
