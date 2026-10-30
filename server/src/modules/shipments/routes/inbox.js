// Richieste in arrivo da documento (richiesta del CEO, 30/10/2026): upload di PDF o email (.eml, .txt) in "Richieste in arrivo".
//  - Lifestyle: lettura assistita dei campi della richiesta con Claude (lib/requestReader.js), abbinamento del richiedente alla
//    Legal entity (public.organizations) e righe proposte per la revisione; l'operatore controlla e conferma con la stessa
//    conferma delle email incollate (POST /orders/inbox/:id/confirm). Niente salvataggio automatico delle richieste.
//  - Endeavor: dal testo del documento lo stesso riconoscitore delle email Affinity (lib/parser.js), come "Incolla una email".
// Il file resta nell'archivio a due vie della Suite (lib/moduleStorage.js) e si scarica da GET /inbox/:id/file.
// Qui anche la ricerca delle Legal entity per il richiedente (GET /organizations?q=) e la creazione della Legal entity dal documento.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, badL, notFound, audit, parse, HttpError } from '../lib/util.js';
import { requireRole, OPERATORS } from '../lib/access.js';
import { parseKitEmail } from '../lib/parser.js';
import { storeBuffer, sendFile } from '../../../lib/moduleStorage.js';
import { matchOrg } from '../../../lib/anagraficaMatch.js';
import { indexOrg } from '../../../lib/search.js';
import { textOfFile, readLifestyleRequest, matchRequester, mockEnabled, AI_NOT_CONFIGURED } from '../lib/requestReader.js';
import { aiEnabled } from '../../../lib/claude.js';
import { extractedToItems, lowConfidence, fileKind, MAX_FILE_MB, MAX_FILES, MSG_NOT_SUPPORTED } from '../lib/requestParse.js';

const r = Router();

// Colonne dei messaggi in arrivo restituite al front-end: mai il contenuto del file (bytea), solo se c'è
export const INBOX_COLS = `i.id, i.graph_id, i.source, i.project, i.received_at, i.from_addr, i.subject, i.body_text, i.parsed, i.status, i.error, i.order_ids,
  i.processed_by, i.processed_at, i.created_at, i.filename, i.mime, i.size, i.sha256, (i.data IS NOT NULL OR i.blob_path IS NOT NULL) AS has_file,
  i.extracted, i.extracted_model, i.ocr, i.avvisi, i.requester_match`;
export const loadMessage = (id) => one(`SELECT ${INBOX_COLS} FROM inbox_messages i WHERE i.id=$1`, [id]);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES } }).array('file', MAX_FILES);
const withUpload = (req, res, next) => upload(req, res, (e) => {
  if (!e) return next();
  if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File troppo grande (massimo ${MAX_FILE_MB} MB per file)`));
  if (e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE') return next(bad(`Al massimo ${MAX_FILES} file per volta, nel campo "file"`));
  return next(bad(e.message));
});

// Avvisi legati al richiedente: si ricalcolano a ogni nuova lettura o abbinamento
const UNMATCHED = 'Richiedente non abbinato';
const MATCHED = 'Richiedente abbinato';
const QTY_RE = /^Richiesti \d+ kit: proposte/;
// Revisione Lifestyle: righe proposte, Legal entity proposta e avvisi a partire dal JSON letto
export async function lifestyleReview(extracted, baseAvvisi = []) {
  const match = await matchRequester(extracted);
  const { items, entity, quantity } = extractedToItems(extracted, { match });
  const avvisi = baseAvvisi.filter((a) => !a.startsWith(UNMATCHED) && !a.startsWith(MATCHED) && !QTY_RE.test(a));
  const ric = extracted?.richiedente || {};
  if (entity && match) avvisi.push(`${MATCHED} alla Legal entity "${match.name}" per ${match.how}: verifica che sia quella giusta`);
  else if (entity) avvisi.push(`${UNMATCHED}: "${ric.ragione_sociale || ric.piva || '?'}" non è tra le Legal entity della Suite. Sceglila dall'elenco o creala dal documento`);
  if (quantity > 1) avvisi.push(`Richiesti ${quantity} kit: proposte ${quantity} righe con gli stessi dati, una per kit`);
  return { parsed: items, match, avvisi };
}

// ---------------- Upload ----------------
r.post('/inbox/upload', requireRole(...OPERATORS), withUpload, ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw badL(req, 'Carica almeno un file (PDF o email .eml)', 'Upload at least one file (PDF or .eml email)');
  const { project } = parse(z.object({ project: z.enum(['ENDEAVOR', 'LIFESTYLE']).default('LIFESTYLE') }), { project: req.body?.project || undefined });
  // controlli prima di leggere: formato di tutti i file e, per Lifestyle, il modello configurato
  for (const f of files) {
    const k = fileKind(f.originalname, f.mimetype);
    if (k === 'msg') throw bad(MSG_NOT_SUPPORTED);
    if (!k) throw badL(req, `Formato non ammesso (${f.originalname}): carica un PDF, un'email .eml o un testo .txt`, `Format not allowed (${f.originalname}): upload a PDF, an .eml email or a .txt text`);
  }
  if (project === 'LIFESTYLE' && !mockEnabled() && !aiEnabled()) throw bad(AI_NOT_CONFIGURED);
  const modes = project === 'ENDEAVOR' ? await many('SELECT * FROM shipping_modes WHERE active') : [];
  const knownCodes = project === 'ENDEAVOR' ? await many('SELECT barcode, status FROM kits') : [];
  const out = []; const errori = [];
  for (const f of files) {
    try {
      const tx = await textOfFile(f);
      const avvisi = [...tx.avvisi];
      const stored = await storeBuffer('shipments', 'richieste', f.originalname, f.mimetype || 'application/octet-stream', f.buffer);
      const dup = await one(`SELECT id, received_at, status FROM inbox_messages WHERE sha256=$1 ORDER BY id DESC LIMIT 1`, [stored.sha256]);
      if (dup) avvisi.push(`Lo stesso file è già stato caricato (messaggio #${dup.id}, ${dup.status === 'CONFIRMED' ? 'già elaborato' : dup.status === 'IGNORED' ? 'ignorato' : 'da elaborare'}): controlla di non creare richieste doppie`);
      let parsed; let extracted = null; let model = null; let match = null;
      if (project === 'LIFESTYLE') {
        const rd = await readLifestyleRequest(tx.text, { userId: req.suiteUser?.id || null });
        extracted = rd.extracted; model = rd.model;
        if (model === 'mock') avvisi.unshift('Lettura di prova (SHIPMENTS_AI_MOCK): estrattore a espressioni regolari, non il modello Anthropic');
        const low = lowConfidence(extracted);
        if (low.length) avvisi.push(`Campi letti con confidenza bassa, da verificare: ${low.join(', ')}`);
        const rv = await lifestyleReview(extracted, avvisi);
        parsed = rv.parsed; match = rv.match; avvisi.splice(0, avvisi.length, ...rv.avvisi);
      } else {
        parsed = parseKitEmail(tx.text, modes, { subject: tx.subject || '', knownCodes });
      }
      const row = await one(`INSERT INTO inbox_messages (source, project, received_at, from_addr, subject, body_text, parsed, status, filename, mime, size, sha256, data, blob_path, extracted, extracted_model, ocr, avvisi, requester_match)
        VALUES ('UPLOAD',$1,coalesce($2::timestamptz, now()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [project, tx.date, tx.from_addr || null, tx.subject || f.originalname, tx.text, JSON.stringify(parsed), parsed.length ? 'PARSED' : 'NEW', f.originalname, f.mimetype || null,
        stored.size, stored.sha256, stored.data, stored.blob_path, extracted ? JSON.stringify(extracted) : null, model, tx.ocr, JSON.stringify(avvisi), match ? JSON.stringify(match) : null]);
      await audit(req, 'INBOX_UPLOAD', 'inbox', row.id, { project, filename: f.originalname, size: stored.size, kind: tx.kind, model, ocr: tx.ocr, chars: tx.chars, items: parsed.length, requester_org_id: match?.id || null });
      out.push(await loadMessage(row.id));
    } catch (e) {
      if (files.length === 1) throw e;
      errori.push({ filename: f.originalname, error: e.message });
    }
  }
  if (!out.length) throw bad(errori.map((e) => `${e.filename}: ${e.error}`).join(' · '));
  res.status(201).json({ messages: out, errori });
}));

// ---------------- File caricato ----------------
r.get('/inbox/:id(\\d+)/file', ah(async (req, res) => {
  const f = await one('SELECT id, filename, mime, data, blob_path FROM inbox_messages WHERE id=$1', [Number(req.params.id)]);
  if (!f || (!f.data && !f.blob_path)) throw notFound(req.lang === 'en' ? 'File not found' : 'File non trovato');
  await sendFile(res, { ...f, filename: f.filename || `richiesta-${f.id}` }, { inline: req.query.download !== '1' });
}));

// ---------------- Legal entity dal documento ----------------
// Crea in public.organizations (kind CLIENTE, da rivedere in Amministrazione) il richiedente letto dal documento; se esiste già
// (P.IVA, codice fiscale o nome) restituisce quella. Aggiorna la proposta del messaggio con la Legal entity.
r.post('/inbox/organizations', requireRole(...OPERATORS), ah(async (req, res) => {
  const d = parse(z.object({ from_message_id: z.coerce.number().int().positive() }), req.body);
  const m = await one('SELECT id, extracted, parsed, avvisi, status FROM inbox_messages WHERE id=$1', [d.from_message_id]);
  if (!m) throw notFound();
  const ric = m.extracted?.richiedente;
  if (!ric) throw badL(req, 'Il documento non ha dati del richiedente', 'The document has no requester data');
  const name = String(ric.ragione_sociale || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw badL(req, 'Ragione sociale del richiedente non letta dal documento: crea la Legal entity in Amministrazione', 'Requester company name not read from the document: create the legal entity in Administration');
  let org = await matchOrg({ vat_number: ric.piva, tax_code: ric.cf, name });
  let created = false;
  if (!org) {
    const vat = String(ric.piva || '').replace(/\s+/g, '').slice(0, 20) || null;
    const cf = String(ric.cf || '').replace(/\s+/g, '').toUpperCase().slice(0, 20) || null;
    const row = await one(`INSERT INTO public.organizations (kind, name, vat_number, tax_code, email, phone, needs_review, notes)
      VALUES ('CLIENTE', $1, $2, $3, $4, $5, TRUE, $6) RETURNING *`,
    [name.slice(0, 250), vat, cf, ric.email || null, ric.telefono || null, `Creata da Shipments (Lifestyle) dalla richiesta in arrivo #${m.id}${ric.referente ? ` · referente ${ric.referente}` : ''}`]);
    indexOrg(row).catch(() => {});
    await audit(req, 'ORGANIZATION_CREATE', 'organization', row.id, { name, vat_number: vat, from_message_id: m.id, source: 'shipments' });
    org = { id: row.id, name: row.name, how: 'creata dal documento' };
    created = true;
  }
  if (['NEW', 'PARSED', 'ERROR'].includes(m.status)) {
    const rv = await lifestyleReview(m.extracted, m.avvisi || []);
    // la Legal entity appena creata o trovata vale per tutte le righe proposte (anche se il nome non coincide alla lettera)
    const parsed = rv.parsed.map((it) => ({ ...it, requester_kind: 'LEGAL_ENTITY', requester_org_id: org.id, requester_name: it.requester_name || org.name, warnings: (it.warnings || []).filter((w) => w !== 'requester_unmatched') }));
    const avvisi = rv.avvisi.filter((a) => !a.startsWith(UNMATCHED));
    if (!rv.match) avvisi.push(`${MATCHED} alla Legal entity "${org.name}" (${org.how})`);
    await q('UPDATE inbox_messages SET parsed=$2, requester_match=$3, avvisi=$4 WHERE id=$1', [m.id, JSON.stringify(parsed), JSON.stringify(org), JSON.stringify(avvisi)]);
  }
  res.status(created ? 201 : 200).json({ organization: { id: org.id, name: org.name, how: org.how, existing: !created }, message: await loadMessage(m.id) });
}));

// ---------------- Ricerca Legal entity (richiedente) ----------------
// Per nome, P.IVA o codice fiscale; tutte le Legal entity attive tranne il gruppo e le società TD (GRUPPO, SOCIETA)
r.get('/organizations', ah(async (req, res) => {
  const s = String(req.query.q || '').trim();
  const id = Number(req.query.id) || null;
  if (id) return res.json(await many(`SELECT id, kind, name, vat_number, tax_code, email, phone, city, province FROM public.organizations WHERE id=$1`, [id]));
  if (s.length < 2) return res.json([]);
  const like = `%${s.toLowerCase()}%`;
  const digits = s.replace(/\D/g, '');
  res.json(await many(`SELECT id, kind, name, vat_number, tax_code, email, phone, city, province FROM public.organizations
    WHERE active AND kind NOT IN ('GRUPPO','SOCIETA')
      AND (lower(name) LIKE $1 OR lower(coalesce(vat_number,'')) LIKE $1 OR lower(coalesce(tax_code,'')) LIKE $1 OR ($2 <> '' AND length($2) >= 5 AND regexp_replace(coalesce(vat_number,''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
    ORDER BY (lower(name) LIKE $3) DESC, lower(name) LIMIT 20`, [like, digits, `${s.toLowerCase()}%`]));
}));

export default r;
