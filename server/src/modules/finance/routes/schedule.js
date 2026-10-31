// Scadenziario strutture (Payments): contratti di affitto (con gli scatti del canone), utenze (con le bollette), agenda delle
// scadenze, esiti, istanze di pagamento create dalle scadenze, previsione dei costi ed esportazione. Montato su /api/finance/scadenziario.
// Accesso: tutti gli utenti del modulo leggono; SUPPORT e amministratori (canManage) scrivono; CEO e CFO possono segnare gli esiti.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome, itDate, eur } from '../lib/util.js';
import { canManage, isSigner, requireManage } from '../lib/access.js';
import { buildEvents, kpis, forecast, contractEnd, stepAt, toIso, parseDate, addMonths, isOverdue, UTILITY_LABEL, LEASE_KIND_LABEL, REGISTRATION_LABEL, TRANSFER_LABEL } from '../lib/schedule.js';
import { loadScheduleData, scheduleSettings, siteName, EVENT_KEY_RE } from '../lib/scheduleData.js';
import { requestSchema, createRequest } from '../lib/requestCreate.js';
import { storeBuffer, sendFile, dropBlobs, readBuffer } from '../../../lib/moduleStorage.js';
import { extractText, analyzeText, buildProposal, mockEnabled, AI_NOT_CONFIGURED } from '../lib/leaseAnalysis.js';
import { aiEnabled } from '../../../lib/claude.js';
import { matchOrg } from '../../../lib/anagraficaMatch.js';
import { leaseToSite } from '../../../lib/leaseSync.js';

const uploadPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const DOC_COLS = 'id, lease_id, filename, mime, size, sha256, (extracted IS NOT NULL) AS analyzed, extracted_at, model, ocr, uploaded_by, created_at, site_document_id, (site_document_id IS NOT NULL) AS from_registry';

const r = Router();
const requireWrite = requireManage;
// esiti: anche i firmatari (CEO, CFO) possono segnare una scadenza come pagata / fatta
const requireDone = (req, _res, next) => (canManage(req.user) || isSigner(req.user) ? next() : next(forbidden('Profilo in sola lettura sullo scadenziario')));
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG').refine((v) => { const t = parseDate(v); return t != null && toIso(t) === v; }, 'data inesistente');
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const optText = (max) => opt(z.string().trim().max(max));
const money = z.coerce.number().min(0).max(100_000_000);
const intId = z.coerce.number().int().positive();

// ---- sedi (nessun perimetro per utente in Payments) ----
async function scopedSiteIds(req) {
  const asked = req.query.site_id ? Number(req.query.site_id) : null;
  return asked ? [asked] : null;
}
async function assertSiteAccess(_user, siteId) {
  const site = await one(`SELECT id, code, name FROM public.sites WHERE id=$1 AND kind IS DISTINCT FROM 'SERVICE'`, [siteId]);
  if (!site) throw notFound('Sede non trovata nell\'anagrafica della Suite (le strutture dei clienti service non si gestiscono qui)');
  return site;
}
async function assertBeneficiary(id) {
  if (id == null) return;
  if (!await one('SELECT 1 FROM beneficiaries WHERE id=$1', [id])) throw bad('Beneficiario Payments inesistente');
}
async function assertOrg(id, label) {
  if (id == null) return;
  if (!await one('SELECT 1 FROM public.organizations WHERE id=$1', [id])) throw bad(`${label} inesistente: scegli una Legal entity dell'anagrafica`);
}
async function getLease(req, id) {
  const l = await one('SELECT l.*, coalesce(l.landlord_name, o.name) AS landlord_name, b.name AS beneficiary_name FROM lease_contracts l LEFT JOIN public.organizations o ON o.id=l.landlord_org_id LEFT JOIN beneficiaries b ON b.id=l.beneficiary_id WHERE l.id=$1', [id]);
  if (!l) throw notFound('Contratto non trovato');
  await assertSiteAccess(req.user, l.site_id);
  return l;
}
async function getUtility(req, id) {
  const u = await one('SELECT u.*, coalesce(u.supplier_name, o.name) AS supplier_name, b.name AS beneficiary_name FROM utilities u LEFT JOIN public.organizations o ON o.id=u.supplier_org_id LEFT JOIN beneficiaries b ON b.id=u.beneficiary_id WHERE u.id=$1', [id]);
  if (!u) throw notFound('Utenza non trovata');
  await assertSiteAccess(req.user, u.site_id);
  return u;
}

// ---- sedi e Legal entity per i selettori ----
r.get('/sites', ah(async (req, res) => {
  const rows = await many(`SELECT s.id, s.code, s.name, s.city, s.province, s.address, s.active, s.kind,
      (SELECT count(*)::int FROM lease_contracts l WHERE l.site_id=s.id AND l.active) AS leases_count,
      (SELECT count(*)::int FROM utilities u WHERE u.site_id=s.id AND u.active) AS utilities_count,
      (SELECT count(*)::int FROM utilities u WHERE u.site_id=s.id AND u.active AND u.transfer_status IN ('DA_AVVIARE','IN_CORSO')) AS transfers_open
    FROM public.sites s WHERE s.kind IS DISTINCT FROM 'SERVICE' ${req.query.active === '1' ? 'AND s.active' : ''} ORDER BY s.name`);
  // prossima scadenza per sede (eventi futuri non fatti)
  const data = await loadScheduleData(rows.map((x) => x.id));
  const today = todayRome();
  const events = buildEvents({ ...data, today, from: today, to: toIso(parseDate(today) + 400 * 86400000) });
  for (const s of rows) {
    const next = events.find((e) => e.site_id === s.id && e.days >= 0 && !e.done);
    s.next_event = next ? { date: next.date, title: next.title, amount: next.amount, kind: next.kind } : null;
    s.overdue = events.filter((e) => e.site_id === s.id && isOverdue(e)).length;
  }
  res.json(rows);
}));

r.get('/organizations', ah(async (_req, res) => {
  res.json(await many(`SELECT id, kind, code, name, vat_number, tax_code, city, active, (iban IS NOT NULL AND iban <> '') AS has_iban FROM public.organizations WHERE active ORDER BY lower(name)`));
}));

// ---- agenda ----
r.get('/events', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const today = todayRome();
  const from = req.query.from && DATE.safeParse(req.query.from).success ? req.query.from : toIso(parseDate(today) - 60 * 86400000);
  const to = req.query.to && DATE.safeParse(req.query.to).success ? req.query.to : toIso(parseDate(today) + 400 * 86400000);
  const data = await loadScheduleData(siteIds);
  let events = buildEvents({ ...data, from, to, today });
  const cat = String(req.query.cat || '').toUpperCase();
  if (['AFFITTO', 'UTENZA'].includes(cat)) events = events.filter((e) => e.cat === cat);
  const names = new Map(data.sites.map((s) => [s.id, s]));
  for (const e of events) { const s = names.get(e.site_id); e.site_name = s?.name || `Sede ${e.site_id}`; e.site_code = s?.code || null; }
  const settings = await scheduleSettings();
  res.json({ today, from, to, events, kpi: kpis({ events: buildEvents({ ...data, from, to, today }), leases: data.leases, steps: data.steps, utilities: data.utilities, today }), sites: data.sites, alert_days: settings.alert_days, can_write: canManage(req.user), can_done: canManage(req.user) || isSigner(req.user) });
}));

const KEY_RE = EVENT_KEY_RE;
r.post('/events/done', requireDone, ah(async (req, res) => {
  const d = parse(z.object({ key: z.string().regex(KEY_RE, 'chiave evento non valida'), note: optText(500), amount: opt(money) }), req.body);
  const [, kind, type, id, date] = d.key.match(KEY_RE);
  const owner = type === 'lease' ? await getLease(req, Number(id)) : await getUtility(req, Number(id));
  await tx(async (c) => {
    await c.query(`INSERT INTO schedule_done (event_key, site_id, user_id, note, amount) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (event_key) DO UPDATE SET done_at=now(), user_id=EXCLUDED.user_id, note=EXCLUDED.note, amount=EXCLUDED.amount`, [d.key, owner.site_id, req.user.id, d.note || null, d.amount ?? null]);
    // una bolletta registrata segnata come pagata prende la data di oggi come pagamento
    if (kind === 'bolletta' && type === 'utility') await c.query('UPDATE utility_bills SET paid_at=coalesce(paid_at, $3::date) WHERE utility_id=$1 AND due_date=$2::date', [owner.id, date, todayRome()]);
  });
  await audit(req, 'SCHEDULE_DONE', type, id, { key: d.key, note: d.note, amount: d.amount });
  res.status(201).json({ ok: true });
}));

r.delete('/events/done/:key', requireDone, ah(async (req, res) => {
  const key = String(req.params.key);
  const m = key.match(KEY_RE);
  if (!m) throw bad('Chiave evento non valida');
  const [, kind, type, id, date] = m;
  const owner = type === 'lease' ? await getLease(req, Number(id)) : await getUtility(req, Number(id));
  await tx(async (c) => {
    await c.query('DELETE FROM schedule_done WHERE event_key=$1', [key]);
    if (kind === 'bolletta' && type === 'utility') await c.query('UPDATE utility_bills SET paid_at=NULL WHERE utility_id=$1 AND due_date=$2::date', [owner.id, date]);
  });
  await audit(req, 'SCHEDULE_UNDONE', type, id, { key });
  res.json({ ok: true });
}));

// Istanze collegate non ancora eseguite (bozza, in firma, autorizzata) per mese della scadenza: quanto del previsto è già in corso
function openRequestsByMonth(data, months) {
  const row = months.map(() => 0); const items = [];
  for (const rq of data.requests) {
    if (!['BOZZA', 'IN_FIRMA', 'FIRMATA'].includes(rq.status)) continue;
    const m = rq.event_key.match(EVENT_KEY_RE); if (!m) continue;
    const i = months.indexOf(m[4].slice(0, 7));
    if (i >= 0) row[i] = Math.round((row[i] + Number(rq.amount)) * 100) / 100;
    items.push({ key: rq.event_key, request_id: rq.request_id, protocol: rq.protocol, status: rq.status, amount: Number(rq.amount), date: m[4] });
  }
  return { months: row, sum: Math.round(row.reduce((a, b) => a + b, 0) * 100) / 100, count: items.length, items };
}

// ---- previsione ----
r.get('/forecast', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const months = Math.max(1, Math.min(36, Number(req.query.months) || 12));
  const data = await loadScheduleData(siteIds);
  const settings = await scheduleSettings();
  const f = forecast({ ...data, settings, months, today: todayRome() });
  const names = new Map(data.sites.map((s) => [s.id, s]));
  for (const s of f.sites) { s.site_name = names.get(s.site_id)?.name || `Sede ${s.site_id}`; s.site_code = names.get(s.site_id)?.code || null; }
  for (const s of f.previous.sites) s.site_name = names.get(s.site_id)?.name || `Sede ${s.site_id}`;
  f.requests_open = openRequestsByMonth(data, f.months);
  res.json(f);
}));

// ---- istanza di pagamento da una scadenza ----
// Crea un'istanza in bozza con le regole di POST /requests (lib/requestCreate.js): beneficiario dal beneficiario Payments del
// contratto/utenza (ultimo IBAN noto), altrimenti dal locatore/fornitore e dalla Legal entity collegata (IBAN del core).
r.post('/events/request', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ key: z.string().regex(KEY_RE, 'chiave evento non valida'), amount: opt(money) }), req.body);
  const [, kind, type, id, date] = d.key.match(KEY_RE);
  if (!['canone', 'registro', 'bolletta'].includes(kind)) throw bad('Si crea un\'istanza solo per canoni, imposta di registro e bollette');
  const owner = type === 'lease' ? await getLease(req, Number(id)) : await getUtility(req, Number(id));
  const data = await loadScheduleData([owner.site_id]);
  const today = todayRome();
  const ev = buildEvents({ ...data, from: toIso(parseDate(date) - 86400000), to: toIso(parseDate(date) + 86400000), today }).find((e) => e.key === d.key);
  if (!ev) throw notFound('Scadenza non trovata');
  if (ev.done) throw bad('La scadenza è già segnata come pagata');
  if (ev.request && !['ANNULLATA', 'RIFIUTATA'].includes(ev.request.status)) throw bad(`Esiste già l'istanza ${ev.request.protocol || `n. ${ev.request.id}`} per questa scadenza`);
  const amount = d.amount ?? ev.amount;
  if (!(amount > 0)) throw bad(ev.estimate ? 'Indica l\'importo da pagare: la scadenza è una stima' : 'Importo della scadenza mancante: indica la rata nel contratto o l\'importo della bolletta');
  // beneficiario
  const site = siteName(data.sites, owner.site_id);
  const orgId = type === 'lease' ? owner.landlord_org_id : owner.supplier_org_id;
  const org = orgId ? await one('SELECT name, vat_number, tax_code, iban, bic, bank_name FROM public.organizations WHERE id=$1', [orgId]) : null;
  const ben = owner.beneficiary_id ? await one(`SELECT b.id, b.name, b.tax_id, i.iban, i.bic, i.bank FROM beneficiaries b
      LEFT JOIN LATERAL (SELECT iban, bic, bank FROM beneficiary_ibans WHERE beneficiary_id=b.id ORDER BY verified_at DESC NULLS LAST, first_seen_at DESC LIMIT 1) i ON TRUE WHERE b.id=$1`, [owner.beneficiary_id]) : null;
  const who = type === 'lease' ? 'locatore' : 'fornitore';
  const name = ben?.name || (type === 'lease' ? owner.landlord_name : owner.supplier_name) || org?.name;
  if (!name) throw bad(`Indica il ${who} (beneficiario Payments, Legal entity o nome) nella scheda ${type === 'lease' ? 'del contratto' : 'dell\'utenza'}`);
  const iban = ben?.iban || org?.iban;
  if (!iban) throw bad(`Indica l'IBAN del ${who} nel beneficiario Payments o nella Legal entity`);
  const period = kind === 'bolletta' && ev.bill_id ? await one('SELECT period_from, period_to FROM utility_bills WHERE id=$1', [ev.bill_id]) : null;
  const when = period?.period_from && period?.period_to ? `periodo ${itDate(period.period_from)} - ${itDate(period.period_to)}` : kind === 'canone' ? `${MESI_LUNGHI[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : `scadenza ${itDate(date)}`;
  const body = {
    request_date: today, requester: req.user.full_name,
    beneficiary_name: name, beneficiary_tax_id: ben?.tax_id || org?.vat_number || org?.tax_code || null, beneficiary_iban: iban, beneficiary_bic: ben?.bic || org?.bic || null, beneficiary_bank: ben?.bank || org?.bank_name || null,
    amount, purpose: `${ev.title} ${site} ${when}`.slice(0, 600),
    doc_type: kind === 'bolletta' ? 'FATTURA' : 'CONTRATTO',
    doc_number: (kind === 'bolletta' ? owner.code : [owner.unit, owner.landlord_name].filter(Boolean).join(' - ')) || null,
    doc_date: kind === 'bolletta' ? null : owner.start_date,
    payment_method: kind === 'registro' ? 'F24' : 'SEPA', value_date: date,
    // canoni e bollette sono pagamenti ricorrenti già approvati (contratto / utenza); nessuna soglia lo vieta (la delibera CdA oltre
    // soglia si soddisfa anche con prior_approval), l'imposta di registro resta senza approvazione preventiva
    prior_approval: kind !== 'registro', prior_approval_ref: kind === 'canone' ? 'Contratto di affitto' : kind === 'bolletta' ? 'Utenza' : null,
    checks: {}, notes: `Scadenziario: ${d.key}${ev.estimate ? ' (importo stimato, confermato alla creazione)' : ''}`,
  };
  const parsed = parse(requestSchema, body);
  const out = await tx(async (c) => {
    const created = await createRequest(parsed, req.user, { client: c });
    await c.query('INSERT INTO schedule_requests (event_key, request_id) VALUES ($1,$2) ON CONFLICT (event_key) DO UPDATE SET request_id=EXCLUDED.request_id, created_at=now()', [d.key, created.id]);
    return created;
  });
  await audit(req, 'SCHEDULE_REQUEST_CREATE', 'payment_request', out.id, { key: d.key, amount, beneficiary: name });
  res.status(201).json(await out.load());
}));

// Beneficiario Payments dal locatore / fornitore: nome e codice fiscale della Legal entity (o il nome indicato), IBAN dal core se c'è
r.post('/beneficiaries', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ org_id: opt(intId), name: optText(200), tax_id: optText(40) }), req.body);
  const org = d.org_id ? await one('SELECT name, vat_number, tax_code, iban, bic, bank_name FROM public.organizations WHERE id=$1', [d.org_id]) : null;
  if (d.org_id && !org) throw bad('Legal entity inesistente');
  const name = (org?.name || d.name || '').trim();
  if (name.length < 2) throw bad('Indica il nome del beneficiario');
  const taxId = org?.vat_number || org?.tax_code || d.tax_id || null;
  let b = taxId ? await one('SELECT * FROM beneficiaries WHERE lower(tax_id)=lower($1)', [taxId]) : null;
  if (!b) b = await one('SELECT * FROM beneficiaries WHERE lower(name)=lower($1)', [name]);
  if (!b) b = await one('INSERT INTO beneficiaries (name, tax_id) VALUES ($1,$2) RETURNING *', [name, taxId]);
  else if (!b.tax_id && taxId) await q('UPDATE beneficiaries SET tax_id=$2 WHERE id=$1', [b.id, taxId]);
  if (org?.iban) await q('INSERT INTO beneficiary_ibans (beneficiary_id, iban, bic, bank) VALUES ($1,$2,$3,$4) ON CONFLICT (beneficiary_id, iban) DO NOTHING', [b.id, org.iban.replace(/\s+/g, '').toUpperCase(), org.bic || null, org.bank_name || null]);
  await audit(req, 'BENEFICIARY_CREATE', 'beneficiary', b.id, { name, tax_id: taxId, org_id: d.org_id, from: 'scadenziario' });
  const ibans = await many('SELECT iban, bic, bank, verified_at FROM beneficiary_ibans WHERE beneficiary_id=$1 ORDER BY first_seen_at DESC', [b.id]);
  res.status(201).json({ ...b, ibans });
}));

// ---- contratto in PDF: lettura con Claude e documenti ----
// Analisi: salva il documento (lease_id vuoto, o il contratto indicato per "Rileggi dal PDF"), estrae il testo (OCR se scansione),
// chiede a Claude il JSON del contratto, abbina sede, locatore e beneficiario e propone i campi del form. Niente salvataggio automatico.
async function analyzeUpload(req, res, lease) {
  if (!req.file) throw bad('Carica il contratto in PDF');
  if (!(req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname))) throw bad('Formato ammesso: PDF');
  if (!mockEnabled() && !aiEnabled()) throw bad(AI_NOT_CONFIGURED);
  const text = await extractText(req.file.buffer);
  const avvisi = [...text.avvisi];
  const { extracted, model } = await analyzeText(text.text, { userId: req.suiteUser?.id || null });
  const stored = await storeBuffer('finance', 'contratti', req.file.originalname, 'application/pdf', req.file.buffer);
  const doc = await one(`INSERT INTO lease_documents (lease_id, filename, mime, size, sha256, data, blob_path, extracted, extracted_at, model, text_chars, ocr, uploaded_by)
    VALUES ($1,$2,'application/pdf',$3,$4,$5,$6,$7,now(),$8,$9,$10,$11) RETURNING ${DOC_COLS}`,
  [lease?.id || null, req.file.originalname, stored.size, stored.sha256, stored.data, stored.blob_path, JSON.stringify(extracted), model, text.chars, text.ocr, req.user.id]);
  const proposta = await buildProposal(extracted, { avvisi });
  if (model === 'mock') avvisi.unshift('Lettura di prova (FINANCE_AI_MOCK): estrattore a espressioni regolari, non il modello Anthropic');
  await audit(req, 'LEASE_DOCUMENT_ANALYZE', 'lease_document', doc.id, { filename: doc.filename, size: doc.size, model, ocr: text.ocr, chars: text.chars, lease_id: lease?.id || null });
  res.status(201).json({ document_id: doc.id, document: doc, extracted, proposta, avvisi, text_chars: text.chars, pages: text.pages, ocr: text.ocr, model });
}
r.post('/leases/analizza', requireWrite, uploadPdf.single('file'), ah(async (req, res) => analyzeUpload(req, res, null)));
r.post('/leases/:id/analizza', requireWrite, uploadPdf.single('file'), ah(async (req, res) => analyzeUpload(req, res, await getLease(req, Number(req.params.id)))));

// Allegato senza analisi
r.post('/leases/:id/documenti', requireWrite, uploadPdf.single('file'), ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  if (!req.file) throw bad('Nessun file');
  const stored = await storeBuffer('finance', 'contratti', req.file.originalname, req.file.mimetype || 'application/octet-stream', req.file.buffer);
  const doc = await one(`INSERT INTO lease_documents (lease_id, filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${DOC_COLS}`,
    [l.id, req.file.originalname, req.file.mimetype || 'application/octet-stream', stored.size, stored.sha256, stored.data, stored.blob_path, req.user.id]);
  await audit(req, 'LEASE_DOCUMENT_UPLOAD', 'lease', l.id, { document_id: doc.id, filename: doc.filename, size: doc.size });
  res.status(201).json(doc);
}));
r.get('/documenti/:id', ah(async (req, res) => {
  let f = await one('SELECT * FROM lease_documents WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound('Documento non trovato');
  // contratto caricato in Amministrazione > Sedi: il file è uno solo, in public.site_documents
  if (f.site_document_id) f = await one('SELECT filename, mime, data, blob_path FROM public.site_documents WHERE id=$1', [f.site_document_id]);
  if (!f) throw notFound('Documento non trovato');
  await sendFile(res, f, { inline: req.query.download !== '1' });
}));
r.get('/documenti/:id/lettura', ah(async (req, res) => {
  const f = await one(`SELECT ${DOC_COLS}, extracted FROM lease_documents WHERE id=$1`, [Number(req.params.id)]);
  if (!f) throw notFound('Documento non trovato');
  res.json({ ...f, proposta: f.extracted ? await buildProposal(f.extracted, { avvisi: [] }) : null });
}));
r.delete('/documenti/:id', requireWrite, ah(async (req, res) => {
  const f = await one('SELECT id, lease_id, filename, blob_path, site_document_id FROM lease_documents WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound('Documento non trovato');
  if (f.site_document_id) throw bad('Il contratto è stato caricato in Amministrazione > Sedi: si sostituisce o si elimina da lì');
  if (f.lease_id) await getLease(req, f.lease_id);
  await q('DELETE FROM lease_documents WHERE id=$1', [f.id]);
  await dropBlobs('finance', [f.blob_path]);
  await audit(req, 'LEASE_DOCUMENT_DELETE', 'lease', f.lease_id, { document_id: f.id, filename: f.filename });
  res.json({ ok: true });
}));

// Legal entity dal locatore letto nel contratto (public.organizations, kind PARTNER, da rivedere in Amministrazione)
r.post('/organizations', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ from_document_id: intId }), req.body);
  const f = await one('SELECT id, extracted FROM lease_documents WHERE id=$1', [d.from_document_id]);
  if (!f?.extracted?.locatore) throw bad('Il documento non ha dati del locatore');
  const loc = f.extracted.locatore;
  const name = String(loc.ragione_sociale || '').trim();
  if (name.length < 2) throw bad('Ragione sociale del locatore non letta dal contratto: crea la Legal entity in Amministrazione');
  const hit = await matchOrg({ vat_number: loc.piva, tax_code: loc.cf, name });
  if (hit) return res.json({ id: hit.id, name: hit.name, existing: true, how: hit.how });
  const addr = String(loc.indirizzo || '');
  const mCity = addr.match(/,\s*([^,(]+?)\s*(?:\(([A-Z]{2})\))?\s*$/);
  const row = await one(`INSERT INTO public.organizations (kind, name, vat_number, tax_code, pec, address, city, province, needs_review, notes)
    VALUES ('PARTNER', $1, $2, $3, $4, $5, $6, $7, TRUE, $8) RETURNING id, name, kind, vat_number, tax_code, city`,
  [name, loc.piva || null, loc.cf || null, loc.pec || null, mCity ? addr.slice(0, mCity.index).trim() || null : addr || null, mCity ? mCity[1].trim() : null, mCity?.[2] || null,
    `Creata dallo Scadenziario strutture (Payments) dal contratto di affitto in PDF${loc.legale_rappresentante ? ` · legale rappresentante ${loc.legale_rappresentante}` : ''}`]);
  await audit(req, 'ORGANIZATION_CREATE', 'organization', row.id, { name, vat_number: loc.piva, from_document_id: f.id, source: 'scadenziario' });
  res.status(201).json({ ...row, existing: false });
}));

// ---- contratti ----
const leaseSchema = z.object({
  site_id: intId,
  landlord_org_id: opt(intId),
  landlord_name: optText(200),
  beneficiary_id: opt(intId),      // beneficiario Payments del locatore
  unit: optText(200),
  kind: z.enum(['COMMERCIALE_6_6', 'COMMERCIALE_9_9', 'ABITATIVO_4_4', 'ABITATIVO_3_2', 'TRANSITORIO', 'COMODATO', 'ALTRO']).default('COMMERCIALE_6_6'),
  start_date: DATE,
  first_term_years: opt(z.coerce.number().int().min(0).max(99)),
  renewal_years: opt(z.coerce.number().int().min(0).max(99)),
  notice_months: opt(z.coerce.number().int().min(0).max(60)),
  period_months: z.coerce.number().int().refine((v) => [1, 2, 3, 6, 12].includes(v), 'periodicità ammessa: 1, 2, 3, 6, 12 mesi').default(1),
  first_due: opt(DATE),
  deposit: opt(money),
  registration: opt(z.enum(['IMPOSTA_ANNUALE', 'UNICA_SOLUZIONE', 'CEDOLARE_SECCA', 'DA_REGISTRARE'])),
  istat: z.boolean().default(false),
  auto_pay: z.boolean().default(false),
  business_contract_id: opt(intId),
  notes: optText(2000),
  active: z.boolean().default(true),
  amount: opt(money),      // importo iniziale della rata: crea o aggiorna lo scatto INIZIALE
  document_id: opt(intId), // contratto in PDF analizzato (lease_documents con lease_id vuoto): viene collegato alla creazione
  initial_steps: z.array(z.object({ valid_from: DATE, amount: money, reason: z.enum(['INIZIALE', 'ISTAT', 'RINEGOZIAZIONE', 'ALTRO']).default('ALTRO'), notes: optText(300) })).max(12).optional(),   // scatti iniziali proposti dalla lettura (rate iniziali diverse)
});
const LEASE_COLS = ['site_id', 'landlord_org_id', 'landlord_name', 'beneficiary_id', 'unit', 'kind', 'start_date', 'first_term_years', 'renewal_years', 'notice_months', 'period_months', 'first_due', 'deposit', 'registration', 'istat', 'auto_pay', 'business_contract_id', 'notes', 'active'];
const partialOf = (schema) => z.object(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()])));

// Contratto arricchito: canone vigente, scadenza, disdetta, scatti
function decorateLease(l, steps, today) {
  const T = parseDate(today);
  const ls = steps.filter((s) => s.lease_id === l.id).sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)));
  const cur = stepAt(ls, T);
  const ce = contractEnd(l, T);
  const pm = Number(l.notice_months) || 0;
  return { ...l, steps: ls, current_amount: cur ? Number(cur.amount) : null, current_step_from: cur?.valid_from || null, monthly_amount: cur ? Math.round((Number(cur.amount) / (Number(l.period_months) || 1)) * 100) / 100 : null,
    end_date: ce ? toIso(ce.end) : null, expired: !!ce?.expired, renewals: ce?.renewals || 0, notice_by: ce && pm ? toIso(addMonths(ce.end, -pm)) : null,
    kind_label: LEASE_KIND_LABEL[l.kind] || l.kind, registration_label: l.registration ? REGISTRATION_LABEL[l.registration] : null };
}

// Dati dall'anagrafica Sedi (Amministrazione) per i contratti collegati (registry_sync): titolo, canone con IVA, garanzie
const REGISTRY_COLS = `s.id AS site_id, s.tenure, s.rent_amount, s.rent_period, s.rent_vat, s.rent_vat_rate, s.lease_start, s.lease_years, s.lease_renewal_years, s.lease_end,
  s.guarantee_bank_amount, s.guarantee_insurance_amount, s.deposit_amount, s.guarantee_notes, s.lease_landlord_org_id, o.name AS landlord_name`;
async function registryOf(siteIds) {
  if (!siteIds.length) return new Map();
  const rows = await many(`SELECT ${REGISTRY_COLS} FROM public.sites s LEFT JOIN public.organizations o ON o.id=s.lease_landlord_org_id WHERE s.id = ANY($1::int[])`, [siteIds]);
  return new Map(rows.map((x) => [x.site_id, x]));
}

r.get('/leases', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const data = await loadScheduleData(siteIds, { includeInactive: req.query.all === '1' });
  const today = todayRome();
  const docs = data.leases.length ? await many(`SELECT ${DOC_COLS} FROM lease_documents WHERE lease_id = ANY($1::int[]) ORDER BY created_at`, [data.leases.map((l) => l.id)]) : [];
  const reg = await registryOf([...new Set(data.leases.filter((l) => l.registry_sync).map((l) => l.site_id))]);
  res.json(data.leases.map((l) => ({ ...decorateLease(l, data.steps, today), site_name: siteName(data.sites, l.site_id), documents: docs.filter((d) => d.lease_id === l.id), registry: l.registry_sync ? reg.get(l.site_id) || null : null })));
}));

r.get('/leases/:id', ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const steps = await many('SELECT s.*, u.full_name AS created_by_name FROM lease_steps s LEFT JOIN users u ON u.id=s.created_by WHERE s.lease_id=$1 ORDER BY s.valid_from', [l.id]);
  const site = await one('SELECT id, code, name FROM public.sites WHERE id=$1', [l.site_id]);
  const documents = await many(`SELECT ${DOC_COLS} FROM lease_documents WHERE lease_id=$1 ORDER BY created_at`, [l.id]);
  const registry = l.registry_sync ? (await registryOf([l.site_id])).get(l.site_id) || null : null;
  res.json({ ...decorateLease(l, steps, todayRome()), site_name: site?.name, documents, registry });
}));

r.post('/leases', requireWrite, ah(async (req, res) => {
  const d = parse(leaseSchema, req.body);
  await assertSiteAccess(req.user, d.site_id);
  await assertOrg(d.landlord_org_id, 'Locatore');
  await assertBeneficiary(d.beneficiary_id);
  if (d.first_due && d.first_due < d.start_date) throw bad('La prima scadenza della rata non può precedere la decorrenza');
  const doc = d.document_id ? await one('SELECT id, lease_id FROM lease_documents WHERE id=$1', [d.document_id]) : null;
  if (d.document_id && !doc) throw bad('Documento analizzato non trovato: ricarica il PDF');
  if (doc?.lease_id) throw bad('Il documento è già collegato a un altro contratto');
  // scatti iniziali: quelli proposti dalla lettura del PDF (rate iniziali diverse + canone a regime), altrimenti INIZIALE alla decorrenza
  const steps = (d.initial_steps && d.initial_steps.length ? d.initial_steps : (d.amount != null ? [{ valid_from: d.start_date, amount: d.amount, reason: 'INIZIALE', notes: null }] : []))
    .filter((st) => st.valid_from >= d.start_date);
  if (new Set(steps.map((st) => st.valid_from)).size !== steps.length) throw bad('Gli scatti iniziali hanno date ripetute');
  const row = await tx(async (c) => {
    const l = (await c.query(`INSERT INTO lease_contracts (${LEASE_COLS.join(', ')}, created_by) VALUES (${LEASE_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${LEASE_COLS.length + 1}) RETURNING *`, [...LEASE_COLS.map((k) => d[k] ?? null), req.user.id])).rows[0];
    for (const st of steps) await c.query(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [l.id, st.valid_from, st.amount, st.reason, st.notes || null, req.user.id]);
    if (doc) await c.query('UPDATE lease_documents SET lease_id=$2 WHERE id=$1', [doc.id, l.id]);
    return l;
  });
  // anagrafica Sedi: una sede che non era in locazione diventa LOCAZIONE con canone, locatore e durata del contratto (lib/leaseSync.js)
  const registry = await leaseToSite(row.id).catch((e) => ({ status: 'error', reason: e.message }));
  await audit(req, 'LEASE_CREATE', 'lease', row.id, { site_id: d.site_id, unit: d.unit, amount: d.amount, steps: steps.length, document_id: doc?.id || null, registry: registry.status });
  res.status(201).json({ ...row, registry_sync_result: registry });
}));

r.put('/leases/:id', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const d = parse(partialOf(leaseSchema), req.body);
  if (d.site_id != null && d.site_id !== l.site_id) await assertSiteAccess(req.user, d.site_id);
  if (d.landlord_org_id !== undefined) await assertOrg(d.landlord_org_id, 'Locatore');
  if (d.beneficiary_id != null) await assertBeneficiary(d.beneficiary_id);
  const start = d.start_date ?? l.start_date;
  const firstDue = d.first_due === undefined ? l.first_due : d.first_due;
  if (firstDue && firstDue < start) throw bad('La prima scadenza della rata non può precedere la decorrenza');
  await tx(async (c) => {
    const cols = LEASE_COLS.filter((k) => d[k] !== undefined);
    if (cols.length) await c.query(`UPDATE lease_contracts SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [l.id, ...cols.map((k) => d[k])]);
    // scatto INIZIALE allineato alla decorrenza e all'importo iniziale
    const ini = (await c.query(`SELECT id FROM lease_steps WHERE lease_id=$1 AND reason='INIZIALE' ORDER BY valid_from LIMIT 1`, [l.id])).rows[0];
    if (d.amount != null) {
      if (ini) await c.query('UPDATE lease_steps SET amount=$2, valid_from=$3 WHERE id=$1', [ini.id, d.amount, start]);
      else await c.query(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, created_by) VALUES ($1,$2,$3,'INIZIALE',$4) ON CONFLICT (lease_id, valid_from) DO UPDATE SET amount=EXCLUDED.amount`, [l.id, start, d.amount, req.user.id]);
    } else if (ini && d.start_date && d.start_date !== l.start_date) {
      await c.query('UPDATE lease_steps SET valid_from=$2 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM lease_steps x WHERE x.lease_id=$3 AND x.valid_from=$2 AND x.id<>$1)', [ini.id, start, l.id]);
    }
  });
  const registry = await leaseToSite(l.id).catch((e) => ({ status: 'error', reason: e.message }));
  await audit(req, 'LEASE_UPDATE', 'lease', l.id, { ...d, registry: registry.status });
  res.json({ ...(await one('SELECT * FROM lease_contracts WHERE id=$1', [l.id])), registry_sync_result: registry });
}));

r.delete('/leases/:id', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  await tx(async (c) => {
    await c.query('DELETE FROM lease_contracts WHERE id=$1', [l.id]);
    await c.query(`DELETE FROM schedule_done WHERE event_key LIKE '%:lease:' || $1 || ':%'`, [String(l.id)]);
    await c.query(`DELETE FROM schedule_requests WHERE event_key LIKE '%:lease:' || $1 || ':%'`, [String(l.id)]);
  });
  await audit(req, 'LEASE_DELETE', 'lease', l.id, { site_id: l.site_id, unit: l.unit });
  res.json({ ok: true });
}));

// ---- scatti del canone ----
const stepSchema = z.object({
  valid_from: DATE,
  amount: money,
  reason: z.enum(['INIZIALE', 'ISTAT', 'RINEGOZIAZIONE', 'ALTRO', 'ANAGRAFICA']).default('ALTRO'),
  pct: opt(z.coerce.number().min(-100).max(999)),
  notes: optText(500),
});
r.post('/leases/:id/steps', requireWrite, ah(async (req, res) => {
  const l = await getLease(req, Number(req.params.id));
  const d = parse(stepSchema, req.body);
  if (d.valid_from < l.start_date) throw bad('Lo scatto non può precedere la decorrenza del contratto');
  if (await one('SELECT 1 FROM lease_steps WHERE lease_id=$1 AND valid_from=$2', [l.id, d.valid_from])) throw bad('Esiste già uno scatto con questa data: modificalo o scegli un\'altra data');
  const row = await one(`INSERT INTO lease_steps (lease_id, valid_from, amount, reason, pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [l.id, d.valid_from, d.amount, d.reason, d.pct ?? null, d.notes || null, req.user.id]);
  await audit(req, 'LEASE_STEP_CREATE', 'lease', l.id, d);
  res.status(201).json(row);
}));
r.put('/steps/:id', requireWrite, ah(async (req, res) => {
  const s = await one('SELECT * FROM lease_steps WHERE id=$1', [Number(req.params.id)]);
  if (!s) throw notFound('Scatto non trovato');
  const l = await getLease(req, s.lease_id);
  const d = parse(partialOf(stepSchema), req.body);
  if (d.valid_from && d.valid_from < l.start_date) throw bad('Lo scatto non può precedere la decorrenza del contratto');
  if (d.valid_from && d.valid_from !== s.valid_from && await one('SELECT 1 FROM lease_steps WHERE lease_id=$1 AND valid_from=$2', [l.id, d.valid_from])) throw bad('Esiste già uno scatto con questa data');
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE lease_steps SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [s.id, ...cols.map((k) => d[k])]);
  // lo scatto iniziale è il canone dell'anagrafica Sedi: si riallinea la sede (solo per il contratto collegato, vedi lib/leaseSync.js)
  if (s.reason === 'INIZIALE' || d.reason === 'INIZIALE') await leaseToSite(l.id).catch((e) => console.warn('[scadenziario] allineamento anagrafica:', e.message));
  await audit(req, 'LEASE_STEP_UPDATE', 'lease', l.id, { step_id: s.id, ...d });
  res.json(await one('SELECT * FROM lease_steps WHERE id=$1', [s.id]));
}));
r.delete('/steps/:id', requireWrite, ah(async (req, res) => {
  const s = await one('SELECT * FROM lease_steps WHERE id=$1', [Number(req.params.id)]);
  if (!s) throw notFound('Scatto non trovato');
  const l = await getLease(req, s.lease_id);
  await q('DELETE FROM lease_steps WHERE id=$1', [s.id]);
  await audit(req, 'LEASE_STEP_DELETE', 'lease', l.id, { step_id: s.id, valid_from: s.valid_from, amount: s.amount });
  res.json({ ok: true });
}));

// ---- utenze ----
const utilitySchema = z.object({
  site_id: intId,
  kind: z.enum(['ENERGIA', 'GAS', 'ACQUA', 'TARI', 'TELEFONIA', 'CONDOMINIO', 'VIGILANZA', 'PULIZIE', 'ALTRO']).default('ALTRO'),
  supplier_org_id: opt(intId),
  supplier_name: optText(200),
  beneficiary_id: opt(intId),      // beneficiario Payments del fornitore
  code: optText(100),
  holder: optText(200),
  transfer_status: z.enum(['DA_AVVIARE', 'IN_CORSO', 'COMPLETATA', 'NON_NECESSARIA']).default('NON_NECESSARIA'),
  period_months: z.coerce.number().int().refine((v) => [1, 2, 3, 4, 6, 12].includes(v), 'fatturazione ammessa: 1, 2, 3, 4, 6, 12 mesi').default(2),
  ref_due: opt(DATE),
  avg_amount: opt(money),
  offer_end: opt(DATE),
  auto_pay: z.boolean().default(false),
  notes: optText(2000),
  active: z.boolean().default(true),
});
const UTILITY_COLS = ['site_id', 'kind', 'supplier_org_id', 'supplier_name', 'beneficiary_id', 'code', 'holder', 'transfer_status', 'period_months', 'ref_due', 'avg_amount', 'offer_end', 'auto_pay', 'notes', 'active'];

function decorateUtility(u, bills, today) {
  const ub = bills.filter((b) => b.utility_id === u.id).sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
  const T = parseDate(today), from12 = new Date(T); from12.setUTCFullYear(from12.getUTCFullYear() - 1);
  const recent = ub.filter((b) => parseDate(b.due_date) > from12.getTime() && parseDate(b.due_date) <= T);
  const avgBill = recent.length ? Math.round((recent.reduce((a, b) => a + Number(b.amount), 0) / recent.length) * 100) / 100 : null;
  return { ...u, bills: ub, bills_count: ub.length, avg_bill_12m: avgBill, estimate: avgBill ?? (u.avg_amount != null ? Number(u.avg_amount) : null), estimate_source: avgBill != null ? 'bollette' : u.avg_amount != null ? 'media' : null,
    unpaid: ub.filter((b) => !b.paid_at).length, kind_label: UTILITY_LABEL[u.kind] || u.kind, transfer_label: TRANSFER_LABEL[u.transfer_status] || u.transfer_status };
}

r.get('/utilities', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const data = await loadScheduleData(siteIds, { includeInactive: req.query.all === '1' });
  const today = todayRome();
  let rows = data.utilities.map((u) => ({ ...decorateUtility(u, data.bills, today), site_name: siteName(data.sites, u.site_id) }));
  if (req.query.transfers === '1') rows = rows.filter((u) => ['DA_AVVIARE', 'IN_CORSO'].includes(u.transfer_status));
  res.json(rows);
}));

r.get('/utilities/:id', ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const bills = await many('SELECT b.*, x.full_name AS created_by_name FROM utility_bills b LEFT JOIN users x ON x.id=b.created_by WHERE b.utility_id=$1 ORDER BY b.due_date DESC', [u.id]);
  const site = await one('SELECT id, code, name FROM public.sites WHERE id=$1', [u.site_id]);
  res.json({ ...decorateUtility(u, bills, todayRome()), site_name: site?.name });
}));

r.post('/utilities', requireWrite, ah(async (req, res) => {
  const d = parse(utilitySchema, req.body);
  await assertSiteAccess(req.user, d.site_id);
  await assertOrg(d.supplier_org_id, 'Fornitore');
  await assertBeneficiary(d.beneficiary_id);
  const row = await one(`INSERT INTO utilities (${UTILITY_COLS.join(', ')}, created_by) VALUES (${UTILITY_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${UTILITY_COLS.length + 1}) RETURNING *`, [...UTILITY_COLS.map((k) => d[k] ?? null), req.user.id]);
  await audit(req, 'UTILITY_CREATE', 'utility', row.id, { site_id: d.site_id, kind: d.kind, supplier: d.supplier_name });
  res.status(201).json(row);
}));

r.put('/utilities/:id', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const d = parse(partialOf(utilitySchema), req.body);
  if (d.site_id != null && d.site_id !== u.site_id) await assertSiteAccess(req.user, d.site_id);
  if (d.supplier_org_id !== undefined) await assertOrg(d.supplier_org_id, 'Fornitore');
  if (d.beneficiary_id != null) await assertBeneficiary(d.beneficiary_id);
  const cols = UTILITY_COLS.filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE utilities SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [u.id, ...cols.map((k) => d[k])]);
  await audit(req, 'UTILITY_UPDATE', 'utility', u.id, d);
  res.json(await one('SELECT * FROM utilities WHERE id=$1', [u.id]));
}));

r.delete('/utilities/:id', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  await tx(async (c) => {
    await c.query('DELETE FROM utilities WHERE id=$1', [u.id]);
    await c.query(`DELETE FROM schedule_done WHERE event_key LIKE '%:utility:' || $1 || ':%'`, [String(u.id)]);
    await c.query(`DELETE FROM schedule_requests WHERE event_key LIKE '%:utility:' || $1 || ':%'`, [String(u.id)]);
  });
  await audit(req, 'UTILITY_DELETE', 'utility', u.id, { site_id: u.site_id, kind: u.kind });
  res.json({ ok: true });
}));

// ---- bollette ----
const billSchema = z.object({
  period_from: opt(DATE),
  period_to: opt(DATE),
  due_date: DATE,
  amount: money,
  consumption: opt(z.coerce.number().min(0)),
  unit: optText(20),
  paid_at: opt(DATE),
  notes: optText(500),
});
r.post('/utilities/:id/bills', requireWrite, ah(async (req, res) => {
  const u = await getUtility(req, Number(req.params.id));
  const d = parse(billSchema, req.body);
  if (d.period_from && d.period_to && d.period_to < d.period_from) throw bad('Il periodo della bolletta non è valido');
  const row = await one(`INSERT INTO utility_bills (utility_id, period_from, period_to, due_date, amount, consumption, unit, paid_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [u.id, d.period_from ?? null, d.period_to ?? null, d.due_date, d.amount, d.consumption ?? null, d.unit || null, d.paid_at ?? null, d.notes || null, req.user.id]);
  await audit(req, 'UTILITY_BILL_CREATE', 'utility', u.id, { bill_id: row.id, due_date: d.due_date, amount: d.amount });
  res.status(201).json(row);
}));
r.put('/bills/:id', requireWrite, ah(async (req, res) => {
  const b = await one('SELECT * FROM utility_bills WHERE id=$1', [Number(req.params.id)]);
  if (!b) throw notFound('Bolletta non trovata');
  const u = await getUtility(req, b.utility_id);
  const d = parse(partialOf(billSchema), req.body);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (cols.length) await q(`UPDATE utility_bills SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [b.id, ...cols.map((k) => d[k])]);
  await audit(req, 'UTILITY_BILL_UPDATE', 'utility', u.id, { bill_id: b.id, ...d });
  res.json(await one('SELECT * FROM utility_bills WHERE id=$1', [b.id]));
}));
r.delete('/bills/:id', requireWrite, ah(async (req, res) => {
  const b = await one('SELECT * FROM utility_bills WHERE id=$1', [Number(req.params.id)]);
  if (!b) throw notFound('Bolletta non trovata');
  const u = await getUtility(req, b.utility_id);
  await q('DELETE FROM utility_bills WHERE id=$1', [b.id]);
  await audit(req, 'UTILITY_BILL_DELETE', 'utility', u.id, { bill_id: b.id, due_date: b.due_date, amount: b.amount });
  res.json({ ok: true });
}));

// ---- esportazione XLSX: Agenda, Contratti, Utenze, Previsione ----
r.get('/export.xlsx', ah(async (req, res) => {
  const siteIds = await scopedSiteIds(req);
  const today = todayRome();
  const data = await loadScheduleData(siteIds);
  const settings = await scheduleSettings();
  const from = req.query.from && DATE.safeParse(req.query.from).success ? req.query.from : toIso(parseDate(today) - 60 * 86400000);
  const to = req.query.to && DATE.safeParse(req.query.to).success ? req.query.to : toIso(parseDate(today) + 400 * 86400000);
  const events = buildEvents({ ...data, from, to, today });
  const f = forecast({ ...data, settings, months: Math.max(1, Math.min(36, Number(req.query.months) || 12)), today });
  const wb = new ExcelJS.Workbook(); wb.creator = 'TD Cash Management';
  const head = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const money = '#,##0.00 €';
  const name = (id) => siteName(data.sites, id);

  const a = wb.addWorksheet('Agenda');
  a.columns = [{ header: 'Data', key: 'date', width: 12 }, { header: 'Sede', key: 'site', width: 28 }, { header: 'Categoria', key: 'cat', width: 10 }, { header: 'Scadenza', key: 'title', width: 32 }, { header: 'Dettaglio', key: 'desc', width: 50 }, { header: 'Importo', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Stima', key: 'est', width: 7 }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Stato', key: 'state', width: 16 }, { header: 'Nota', key: 'note', width: 30 }];
  for (const e of events) a.addRow({ date: itDate(e.date), site: name(e.site_id), cat: e.cat === 'AFFITTO' ? 'Affitto' : 'Utenza', title: e.title, desc: e.desc, amount: e.amount, est: e.estimate ? 'sì' : '', auto: e.auto ? 'sì' : '', state: e.done ? 'fatta' : isOverdue(e) ? `scaduta da ${-e.days} gg` : e.days < 0 ? 'passata' : e.days === 0 ? 'oggi' : `tra ${e.days} gg`, note: e.done_note || '' });
  head(a);

  const c = wb.addWorksheet('Contratti');
  c.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Immobile / unità', key: 'unit', width: 24 }, { header: 'Locatore', key: 'landlord', width: 28 }, { header: 'Tipologia', key: 'kind', width: 16 }, { header: 'Decorrenza', key: 'start', width: 12 }, { header: 'Periodicità (mesi)', key: 'period', width: 10 }, { header: 'Rata vigente', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Dal', key: 'from', width: 12 }, { header: 'Scadenza', key: 'end', width: 12 }, { header: 'Disdetta entro', key: 'notice', width: 12 }, { header: 'Rinnovo (anni)', key: 'renewal', width: 10 }, { header: 'ISTAT', key: 'istat', width: 7 }, { header: 'Registrazione', key: 'reg', width: 16 }, { header: 'Deposito', key: 'deposit', width: 12, style: { numFmt: money } }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Scatti', key: 'steps', width: 60 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const l of data.leases) {
    const d = decorateLease(l, data.steps, today);
    c.addRow({ site: name(l.site_id), unit: l.unit, landlord: l.landlord_name, kind: d.kind_label, start: itDate(l.start_date), period: l.period_months, amount: d.current_amount, from: itDate(d.current_step_from), end: itDate(d.end_date), notice: itDate(d.notice_by), renewal: l.renewal_years, istat: l.istat ? 'sì' : '', reg: d.registration_label || '', deposit: l.deposit, auto: l.auto_pay ? 'sì' : '',
      steps: d.steps.map((s) => `${itDate(s.valid_from)}: ${eur(s.amount)} (${s.reason.toLowerCase()}${s.pct != null ? ` ${s.pct}%` : ''})`).join('; '), notes: l.notes || '' });
  }
  head(c);

  const u = wb.addWorksheet('Utenze');
  u.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Tipo', key: 'kind', width: 18 }, { header: 'Fornitore', key: 'supplier', width: 28 }, { header: 'Codice', key: 'code', width: 20 }, { header: 'Intestatario', key: 'holder', width: 24 }, { header: 'Voltura', key: 'transfer', width: 14 }, { header: 'Fatturazione (mesi)', key: 'period', width: 10 }, { header: 'Scadenza nota', key: 'ref', width: 12 }, { header: 'Importo medio', key: 'avg', width: 14, style: { numFmt: money } }, { header: 'Media bollette 12 mesi', key: 'avg12', width: 14, style: { numFmt: money } }, { header: 'Fine offerta', key: 'offer', width: 12 }, { header: 'Automatico', key: 'auto', width: 11 }, { header: 'Bollette registrate', key: 'bills', width: 12 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const x of data.utilities) {
    const d = decorateUtility(x, data.bills, today);
    u.addRow({ site: name(x.site_id), kind: d.kind_label, supplier: x.supplier_name, code: x.code, holder: x.holder, transfer: d.transfer_label, period: x.period_months, ref: itDate(x.ref_due), avg: x.avg_amount, avg12: d.avg_bill_12m, offer: itDate(x.offer_end), auto: x.auto_pay ? 'sì' : '', bills: d.bills_count, notes: x.notes || '' });
  }
  head(u);

  const b = wb.addWorksheet('Bollette');
  b.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Utenza', key: 'kind', width: 18 }, { header: 'Fornitore', key: 'supplier', width: 24 }, { header: 'Periodo dal', key: 'pf', width: 12 }, { header: 'al', key: 'pt', width: 12 }, { header: 'Scadenza', key: 'due', width: 12 }, { header: 'Importo', key: 'amount', width: 14, style: { numFmt: money } }, { header: 'Consumo', key: 'cons', width: 12 }, { header: 'Unità', key: 'unit', width: 8 }, { header: 'Pagata il', key: 'paid', width: 12 }, { header: 'Note', key: 'notes', width: 30 }];
  for (const bill of data.bills) { const x = data.utilities.find((y) => y.id === bill.utility_id); if (!x) continue; b.addRow({ site: name(x.site_id), kind: UTILITY_LABEL[x.kind] || x.kind, supplier: x.supplier_name, pf: itDate(bill.period_from), pt: itDate(bill.period_to), due: itDate(bill.due_date), amount: Number(bill.amount), cons: bill.consumption != null ? Number(bill.consumption) : null, unit: bill.unit, paid: itDate(bill.paid_at), notes: bill.notes || '' }); }
  head(b);

  const p = wb.addWorksheet('Previsione');
  const mlabel = (mk) => { const [y, m] = mk.split('-'); return `${['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][Number(m) - 1]} ${y}`; };
  p.columns = [{ header: 'Sede', key: 'site', width: 28 }, { header: 'Voce', key: 'row', width: 20 }, ...f.months.map((mk) => ({ header: mlabel(mk), key: mk, width: 12, style: { numFmt: money } })), { header: 'Totale', key: 'sum', width: 14, style: { numFmt: money } }];
  const line = (site, row, arr) => p.addRow({ site, row, ...Object.fromEntries(f.months.map((mk, i) => [mk, arr[i]])), sum: arr.reduce((s, v) => s + v, 0) });
  for (const s of f.sites) { line(s.site_name, 'Affitti', s.rent); if (s.registry.some(Boolean)) line(s.site_name, 'Imposta di registro', s.registry); line(s.site_name, 'Utenze', s.utilities); const tr = line(s.site_name, 'Totale sede', s.total); tr.font = { bold: true }; }
  line('Rete', 'Affitti', f.totals.rent); if (f.totals.registry.some(Boolean)) line('Rete', 'Imposta di registro', f.totals.registry); line('Rete', 'Utenze', f.totals.utilities); const tot = line('Rete', 'Totale', f.totals.total); tot.font = { bold: true };
  p.addRow({});
  p.addRow({ site: 'Ipotesi', row: `ISTAT ${f.assumptions.istat_pct}% annuo · crescita utenze ${f.assumptions.utility_growth_pct}% annuo · imposta di registro ${f.assumptions.registry_pct}% del canone annuo (minimo ${f.assumptions.registry_min} €)` });
  p.addRow({ site: 'Ultimi 12 mesi registrati', row: `Affitti ${eur(f.previous.sum_rent)} · Utenze ${eur(f.previous.sum_utilities)} · Totale ${eur(f.previous.sum)}` });
  head(p);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Scadenziario_strutture_${today}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
