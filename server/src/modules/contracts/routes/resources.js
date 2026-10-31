import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, HttpError } from '../lib/util.js';
import { requireWrite, requireRole, Params, readLog } from '../lib/access.js';
import { config } from '../config.js';
import { parseDocument, ocrAvailable } from '../lib/contractParse.js';
import { buildTemplate, readBulk } from '../lib/bulkImport.js';
import { analyzeAttachment } from '../lib/docAnalyze.js';
import { getSettings, decompose, decomposeDirigente, costCoefficient, companyCost, minimumFor, ralAt } from '../lib/payroll.js';
import { computeDeadlines, missingDocuments } from '../lib/deadlines.js';
import { CATEGORY_LABELS } from '../lib/seedData.js';
import { applyDueTerminations } from '../lib/termination.js';
import { removeFromIndex } from '../../../lib/search.js';
import { PERSON_KINDS, hrKind, createPerson, updatePerson, deletePerson, reindexPerson, syncDerived, siteLabel } from '../lib/people.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
const opt = (s) => z.preprocess((v) => (v === '' || v === 'null' || v === 'undefined' ? null : v), s.optional().nullable()); // stringa vuota (form multipart) = assente
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const optDate = () => opt(z.string().regex(dateRe, 'data non valida (AAAA-MM-GG)'));
const num = () => z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nullable());

// Anagrafica unica: kind è il tipo di persona di public.people (DIPENDENTE e DIRIGENTE = rapporto subordinato; LP, MEDICO e
// SANITARIO = incarico autonomo). I campi anagrafici generali finiscono in public.people, quelli HR riservati in person_ext (lib/people.js).
export const personSchema = z.object({
  kind: z.enum(PERSON_KINDS),
  status: z.enum(['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO']).optional(),
  last_name: z.string().min(1).max(100),
  first_name: z.string().min(1).max(100),
  sex: opt(z.enum(['F', 'M'])),
  title: opt(z.string().max(20)),
  birth_place: opt(z.string().max(120)),
  birth_date: optDate(),
  tax_code: opt(z.string().max(16).transform((v) => v.toUpperCase().trim())),
  vat_number: opt(z.string().max(16)),
  phone: opt(z.string().max(40)),
  phone_office: opt(z.string().max(40)),
  phone_ext: opt(z.string().max(10)),
  mobile_company: opt(z.string().max(40)),
  email: opt(z.string().email().or(z.literal(''))),
  address: opt(z.string().max(200)),
  zip: opt(z.string().max(10)),
  city: opt(z.string().max(100)),
  province: opt(z.string().max(4).transform((v) => v.toUpperCase())),
  iban: opt(z.string().max(34).transform((v) => v.replace(/\s+/g, '').toUpperCase())),
  badge_number: opt(z.string().max(40)),
  nationality: opt(z.string().max(60)),
  emergency_contact: opt(z.string().max(200)),
  interview_notes: opt(z.string().max(4000)),
  site_id: num(),
  area_id: num(),
  manager_id: num(),
  approver_id: num(),
  notes: opt(z.string().max(4000)),
  hired_at: optDate(),
  terminated_at: optDate(),
});

export const employmentSchema = z.object({
  contract_type: z.enum(['TIND', 'TDET', 'APPRENDISTATO', 'DIRIGENTE']).default('TIND'),
  ccnl: z.string().max(40).default('STUDI_PROFESSIONALI'),
  level: opt(z.string().max(12)),
  qualification: opt(z.string().max(60)),
  job_title: opt(z.string().max(160)),
  weekly_hours: num().default(40),
  weekly_days: num().default(5),
  days_label: opt(z.string().max(60)),
  autonomous_hours: z.boolean().default(false),
  ral: num().default(0),
  monthly_payments: num().default(14),
  base_pay: num(),
  superminimo: num(),
  superminimo_absorbable: z.boolean().default(true),
  function_allowance: num(),
  start_date: optDate(),
  end_date: optDate(),
  probation: opt(z.string().max(200)),
  probation_days: num(),
  probation_end: optDate(),
  work_site_id: num(),
  benefits: z.array(z.string().max(200)).default([]),
  smart_working: z.boolean().default(false),
  mbo_enabled: z.boolean().default(false),
  mbo_pct: num().refine((v) => v == null || (v >= 0 && v <= 100), 'La percentuale MBO deve essere tra 0 e 100'),
  mbo_amount: num(),
  mbo_year: num(),
  mbo_objectives: z.array(z.object({ area: z.string().max(120), objective: z.string().max(400), kpi: z.string().max(200), target: z.string().max(100), weight: num() })).default([]),
  mbo_individual: opt(z.string().max(400)),
  ral_steps: z.array(z.object({ from: z.string().regex(dateRe), ral: num() })).default([]),
  cost_coefficient: num(),
  letter_date: optDate(),
  unilav_ref: opt(z.string().max(80)),
  reports_to: opt(z.string().max(300)),
  imported_from: opt(z.string().max(200)),
  notes: opt(z.string().max(4000)),
});

export const lpSchema = z.object({
  discipline: opt(z.string().max(120)),
  role_description: opt(z.string().max(600)),
  activities: z.array(z.string().max(300)).default([]),
  degrees: z.array(z.string().max(300)).default([]),
  order_name: opt(z.string().max(120)),
  order_province: opt(z.string().max(60)),
  order_number: opt(z.string().max(40)),
  order_since: optDate(),
  insurance_required: num(),
  insurance_company: opt(z.string().max(120)),
  insurance_policy: opt(z.string().max(60)),
  insurance_expiry: optDate(),
  start_date: optDate(),
  end_date: optDate(),
  auto_renew: z.boolean().default(true),
  notice_days: num().default(30),
  fees: z.array(z.object({ type: z.enum(['FISSO', 'ORARIO', 'PRESTAZIONE', 'VARIABILE']), code: opt(z.string().max(20)), description: z.string().max(300), category: opt(z.string().max(100)), amount: num(), unit: opt(z.string().max(20)), vat: opt(z.enum(['CON', 'SENZA'])), notes: opt(z.string().max(300)) })).default([]),
  est_monthly_cost: num(),
  vat_regime: opt(z.string().max(60)),
  letter_date: optDate(),
  notes: opt(z.string().max(4000)),
});

const EMP_COLS = Object.keys(employmentSchema.shape);
const LP_COLS = Object.keys(lpSchema.shape);

function lpMonthlyEstimate(lp) {
  if (lp.est_monthly_cost != null) return Number(lp.est_monthly_cost);
  return (lp.fees || []).filter((f) => f.type === 'FISSO').reduce((a, f) => a + Number(f.amount || 0), 0);
}

export async function upsertEmployment(c, id, e) {
  const data = { ...e };
  if (data.contract_type === 'DIRIGENTE') {
    const S = await getSettings();
    data.level = 'DIRIGENTE'; data.ccnl = 'DIRIGENTI_INDUSTRIA'; data.qualification = data.qualification || 'Dirigente';
    if (!data.monthly_payments || data.monthly_payments === 14) data.monthly_payments = Number(S.dirigenti_monthly_payments || 13);
    if (data.ral && !data.base_pay) { const dec = decomposeDirigente(data.ral, S, data.monthly_payments); data.base_pay = dec.base_pay; data.superminimo = dec.superminimo; data.function_allowance = 0; }
    if (!data.probation) data.probation = 'Non richiesto';
  }
  if (data.ral && !data.base_pay && data.level && data.contract_type !== 'DIRIGENTE') {
    const m = await minimumFor(data.level, data.start_date);
    const S = await getSettings();
    const dec = decompose(data.ral, data.monthly_payments || 14, m?.amount ?? null, Number(S.function_allowance_share || 0.7));
    data.base_pay = dec.base_pay; data.superminimo = dec.superminimo; data.function_allowance = dec.function_allowance;
  }
  if (data.probation_days && data.start_date && !data.probation_end) {
    const d = new Date(`${data.start_date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(data.probation_days));
    data.probation_end = d.toISOString().slice(0, 10);
  }
  const cols = EMP_COLS.filter((k) => k in data);
  const vals = cols.map((k) => (['benefits', 'mbo_objectives', 'ral_steps'].includes(k) ? JSON.stringify(data[k]) : data[k]));
  await c.query(`INSERT INTO employments (resource_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
    ON CONFLICT (resource_id) DO UPDATE SET ${cols.map((k) => `${k}=EXCLUDED.${k}`).join(', ')}, updated_at=now()`, [id, ...vals]);
  await syncDerived(c, id);
  // Ruolo dell'anagrafica unica allineato alla mansione (catalogo Ruoli di Amministrazione), quando il nome coincide
  if (data.job_title) await (c ? c.query.bind(c) : q)(`UPDATE public.people SET role_id = coalesce((SELECT r.id FROM public.job_roles r WHERE lower(r.name)=lower($2) LIMIT 1), role_id), updated_at=now() WHERE id=$1`, [id, data.job_title]);
}

export async function upsertLp(c, id, l) {
  const data = { ...l };
  data.est_monthly_cost = lpMonthlyEstimate(data);
  const cols = LP_COLS.filter((k) => k in data);
  const vals = cols.map((k) => (['degrees', 'fees', 'activities'].includes(k) ? JSON.stringify(data[k]) : data[k]));
  await c.query(`INSERT INTO lp_contracts (resource_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
    ON CONFLICT (resource_id) DO UPDATE SET ${cols.map((k) => `${k}=EXCLUDED.${k}`).join(', ')}, updated_at=now()`, [id, ...vals]);
  await syncDerived(c, id);
}

// Costo dell'esercizio corrente pro rata tra ingresso e cessazione
function yearCost(x, annual) {
  const year = new Date().getFullYear();
  const from = x.hired_at && String(x.hired_at).slice(0, 10) > `${year}-01-01` ? String(x.hired_at).slice(0, 10) : `${year}-01-01`;
  const to = x.terminated_at && String(x.terminated_at).slice(0, 10) < `${year}-12-31` ? String(x.terminated_at).slice(0, 10) : `${year}-12-31`;
  const days = Math.max(0, (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 + 1);
  return Math.round(annual * Math.min(1, days / 365) * 100) / 100;
}
// Arricchisce la risorsa con i dati economici (costo azienda, RAL vigente)
async function enrich(rows, S) {
  return rows.map((x) => {
    if (x.kind === 'DIPENDENTE') {
      const coef = costCoefficient(S, x);
      const ral = ralAt(x);
      const mboPct = x.mbo_enabled ? (Number(x.mbo_amount) > 0 && ral ? Number(x.mbo_amount) / ral * 100 : x.mbo_pct) : 0;
      const cost = companyCost(ral, coef, mboPct);
      return { ...x, ral_current: ral, cost_coefficient_used: coef, cost_annual: cost.annual, cost_monthly: cost.monthly, cost_mbo_max: cost.mbo_max, cost_year: yearCost(x, cost.annual) };
    }
    if (x.kind === 'LP') {
      const m = x.est_monthly_cost != null ? Number(x.est_monthly_cost) : 0;
      const annual = Math.round(m * 12 * 100) / 100;
      return { ...x, cost_monthly: m, cost_annual: annual, cost_year: yearCost(x, annual) };
    }
    return x;
  });
}

// Elenco: anagrafica da public.people (vista resources_v), dossier HR da person_ext, contratto da employments / lp_contracts
const LIST_SQL = `SELECT r.*, coalesce(a.name, r.area_label) AS area_name, at.path AS area_path, at.root_name AS area_root, m.last_name || ' ' || m.first_name AS manager_name, ap.last_name || ' ' || ap.first_name AS approver_name,
    s.name AS site_name, ws.name AS work_site_name,
    e.contract_type, e.level, e.job_title, e.ral, e.ral_steps, e.monthly_payments, e.weekly_hours, e.start_date AS emp_start, e.probation_end, e.mbo_enabled, e.mbo_pct, e.mbo_amount, e.cost_coefficient, e.end_date AS emp_end, e.work_site_id,
    l.discipline, l.start_date AS lp_start, l.end_date AS lp_end, l.est_monthly_cost, l.insurance_expiry,
    (SELECT count(*)::int FROM attachments t WHERE t.resource_id=r.id) AS attachments_count,
    (SELECT count(*)::int FROM generated_documents g WHERE g.resource_id=r.id) AS documents_count,
    (SELECT coalesce(json_agg(json_build_object('id', x.id, 'name', x.name, 'path', x.path, 'root_name', x.root_name) ORDER BY x.sort_path), '[]'::json)
       FROM person_areas ra JOIN areas_tree x ON x.id=ra.area_id WHERE ra.person_id=r.id AND ra.area_id IS DISTINCT FROM r.area_id) AS extra_areas
  FROM resources_v r
  LEFT JOIN areas a ON a.id=r.area_id
  LEFT JOIN areas_tree at ON at.id=r.area_id
  LEFT JOIN resources_v m ON m.id=r.manager_id
  LEFT JOIN resources_v ap ON ap.id=r.approver_id
  LEFT JOIN public.sites s ON s.id=r.site_id
  LEFT JOIN employments e ON e.resource_id=r.id
  LEFT JOIN public.sites ws ON ws.id=e.work_site_id
  LEFT JOIN lp_contracts l ON l.resource_id=r.id`;

// ---------------- Caricamento massivo da Excel ----------------
r.get('/bulk-template.xlsx', requireWrite, ah(async (req, res) => {
  const kind = req.query.kind === 'LP' ? 'LP' : 'DIPENDENTE';
  const wb = await buildTemplate(kind);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="format_${kind === 'LP' ? 'liberi_professionisti' : 'dipendenti'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

r.post('/bulk-import', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const kind = req.body.kind === 'LP' ? 'LP' : 'DIPENDENTE';
  let parsed;
  try { parsed = await readBulk(req.file.buffer, kind); } catch (e) { throw bad(`File non leggibile: ${e.message}`); }
  const { rows, errors } = parsed;
  // validazione con gli stessi schemi dell'inserimento manuale
  const valid = [];
  for (const x of rows) {
    try {
      const person = parse(personSchema, x.person);
      const employment = x.employment ? parse(employmentSchema, x.employment) : null;
      const lp = x.lp ? parse(lpSchema, x.lp) : null;
      valid.push({ line: x.line, person, employment, lp });
    } catch (e) { errors.push(`Riga ${x.line}: ${e.message}`); }
  }
  if (errors.length) return res.status(400).json({ error: `File rifiutato: ${errors.length} problem${errors.length === 1 ? 'a' : 'i'}. Nessuna riga caricata.`, errors, rows: rows.length });
  if (req.body.dry_run === '1') return res.json({ ok: true, rows: valid.length, errors: [] });
  let created = 0, updated = 0; const log = []; const ids = [];
  await tx(async (c) => {
    for (const x of valid) {
      const { person, employment, lp } = x;
      const ex = person.tax_code ? await c.query('SELECT id FROM public.people WHERE upper(tax_code)=upper($1)', [person.tax_code]) : { rows: [] };
      let id;
      if (ex.rows[0]) {
        id = ex.rows[0].id;
        const { kind: _k, status: _s, ...upd } = person;
        await updatePerson(c, req, id, upd);
        updated++; log.push(`Riga ${x.line}: ${person.last_name} ${person.first_name} aggiornata`);
      } else {
        id = await createPerson(c, req, person);
        created++; log.push(`Riga ${x.line}: ${person.last_name} ${person.first_name} creata`);
      }
      if (employment) await upsertEmployment(c, id, employment);
      if (lp) await upsertLp(c, id, lp);
      ids.push(id);
    }
  });
  for (const id of ids) reindexPerson(id);
  await audit(req, 'BULK_IMPORT', 'resource', null, { kind, created, updated, file: req.file.originalname });
  res.json({ ok: true, created, updated, log });
}));

r.get('/', ah(async (req, res) => {
  // cessazioni con decorrenza raggiunta: in MIRROR i dati arrivano dall'app di origine e non si toccano
  if (req.moduleMode !== 'MIRROR') await applyDueTerminations();
  const P = new Params();
  const w = ['TRUE'];
  if (req.query.kind) w.push(`r.kind = ${P.add(req.query.kind)}`);
  if (req.query.status) w.push(`r.status = ANY(string_to_array(${P.add(req.query.status)}, ','))`);
  else w.push(`r.status <> 'CANDIDATO'`);
  if (req.query.area_id) { const pid = P.add(Number(req.query.area_id)); w.push(`EXISTS (WITH RECURSIVE d AS (SELECT id FROM areas WHERE id = ${pid} UNION ALL SELECT a.id FROM areas a JOIN d ON a.parent_id = d.id) SELECT 1 FROM d WHERE d.id = r.area_id OR d.id IN (SELECT area_id FROM person_areas WHERE person_id = r.id))`); }
  if (req.query.site_id) w.push(`r.site_id = ${P.add(Number(req.query.site_id))}`);
  if (req.query.person_kind) w.push(`r.person_kind = ${P.add(req.query.person_kind)}`);
  if (req.query.sex) w.push(`r.sex = ${P.add(req.query.sex)}`);
  if (req.query.q) w.push(`(r.last_name || ' ' || r.first_name || ' ' || coalesce(r.first_name,'') || ' ' || coalesce(r.tax_code,'') || ' ' || coalesce(e.job_title,'') || ' ' || coalesce(l.discipline,'')) ILIKE ${P.add(`%${req.query.q}%`)}`);
  const rows = await many(`${LIST_SQL} WHERE ${w.join(' AND ')} ORDER BY r.last_name, r.first_name`, P.values);
  const S = await getSettings();
  const out = await enrich(rows, S);
  if (req.user.role === 'VIEWER') for (const x of out) { delete x.ral; delete x.ral_current; delete x.cost_annual; delete x.cost_monthly; delete x.cost_mbo_max; delete x.cost_year; delete x.est_monthly_cost; delete x.iban; }
  res.json(out);
}));

r.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await many(`${LIST_SQL} WHERE r.id=$1`, [id]);
  if (!row) throw notFound('Risorsa non trovata');
  const S = await getSettings();
  const [res_] = await enrich([row], S);
  const employment = await one('SELECT e.*, ws.name AS work_site_name FROM employments e LEFT JOIN public.sites ws ON ws.id=e.work_site_id WHERE e.resource_id=$1', [id]);
  if (employment) employment.work_site = await siteLabel(employment.work_site_id);
  const lp = await one('SELECT * FROM lp_contracts WHERE resource_id=$1', [id]);
  const letters = await many('SELECT c.*, ws.name AS work_site_name FROM commitment_letters c LEFT JOIN public.sites ws ON ws.id=c.work_site_id WHERE c.resource_id=$1 ORDER BY c.created_at DESC', [id]);
  const documents = await many('SELECT g.id, g.kind, g.ref_id, g.version, g.title, g.generated_at, (g.pdf IS NOT NULL) AS has_pdf, coalesce(g.data->\'_missing\', \'[]\'::jsonb) AS missing, u.full_name AS generated_by_name FROM generated_documents g LEFT JOIN users u ON u.id=g.generated_by WHERE g.resource_id=$1 ORDER BY g.generated_at DESC', [id]);
  // Provenienza degli allegati arrivati dalla casella People (mittente e data) e allegato sostituito da un rinnovo
  const attachments = await many(`SELECT a.id, a.category, a.filename, a.mime, a.size, a.issued_at, a.expires_at, a.signed, a.notes, a.uploaded_at, a.superseded_by, a.inbox_id,
      pi.from_email AS inbox_from, pi.received_at AS inbox_received_at, u.full_name AS uploaded_by_name
    FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by LEFT JOIN people_inbox pi ON pi.id=a.inbox_id WHERE a.resource_id=$1 ORDER BY a.category, a.uploaded_at DESC`, [id]);
  const reminders = await many(`SELECT id, deadline_key, deadline_type, title, due_date, days_before, recipient, to_email, cc_email, from_email, channel, status, error, sent_at
    FROM deadline_reminders WHERE resource_id=$1 ORDER BY sent_at DESC LIMIT 50`, [id]);
  const deadlines = await computeDeadlines({ resourceId: id });
  const checklist = await missingDocuments(id, row.kind);
  let payroll = null;
  if (employment && req.user.role !== 'VIEWER') {
    const m = await minimumFor(employment.level, employment.start_date);
    payroll = { minimum: m, decomposition: decompose(employment.ral, employment.monthly_payments, employment.base_pay ?? m?.amount ?? null, Number(S.function_allowance_share || 0.7)) };
  }
  if (req.user.role === 'VIEWER' && employment) { for (const k of ['ral', 'base_pay', 'superminimo', 'function_allowance', 'ral_steps', 'mbo_pct']) delete employment[k]; }
  if (req.user.role === 'VIEWER') delete res_.iban;
  // Aree di cui la persona è referente (Impostazioni > Modifica area): è il dato che alimenta l'organigramma
  const org_units = await many(`SELECT t.id, t.name, t.path, a.kind, t.level FROM areas a JOIN areas_tree t ON t.id=a.id WHERE a.head_person_id=$1 ORDER BY t.sort_path`, [id]);
  await readLog(req, 'resource', id);   // audit di lettura della Suite: dati contrattuali riservati
  res.json({ resource: res_, employment, lp, letters, documents, attachments, deadlines, checklist, payroll, org_units, reminders, category_labels: CATEGORY_LABELS });
}));

// Lettura di un contratto/MBO/UNILAV già esistente: restituisce i dati per precompilare il percorso di inserimento
r.post('/parse-document', requireWrite, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const out = await parseDocument(req.file.buffer, req.file.mimetype, filename);
  await audit(req, 'DOCUMENT_PARSE', 'resource', null, { filename, detected: out.detected, method: out.method });
  res.json({ ...out, filename, ocr_available: await ocrAvailable() });
}));

r.post('/', requireWrite, ah(async (req, res) => {
  const { extra_area_ids: extraNew, ...personIn } = req.body.person || {};
  const person = parse(personSchema, personIn);
  const extraIds = Array.isArray(extraNew) ? [...new Set(extraNew.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== person.area_id))] : [];
  const isEmp = hrKind(person.kind) === 'DIPENDENTE';
  const employment = isEmp && req.body.employment ? parse(employmentSchema, req.body.employment) : null;
  const lp = !isEmp && req.body.lp ? parse(lpSchema, req.body.lp) : null;
  // public.people + person_ext + contratto in un'unica transazione, con audit PERSON_CREATED della Suite
  const id = await tx(async (c) => {
    const start = employment?.start_date || lp?.start_date || null;
    const pid = await createPerson(c, req, { ...person, hired_at: person.hired_at || start });
    if (employment) await upsertEmployment(c, pid, employment);
    if (lp) await upsertLp(c, pid, lp);
    for (const aid of extraIds) await c.query('INSERT INTO person_areas(person_id, area_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, aid]);
    return pid;
  });
  reindexPerson(id);
  await audit(req, 'RESOURCE_CREATE', 'resource', id, { kind: person.kind, name: `${person.last_name} ${person.first_name}` });
  res.status(201).json({ id });
}));

r.put('/:id', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const { job_title: role, extra_area_ids: extra, ...rest } = req.body || {};
  const d = parse(personSchema.partial(), rest);
  if (!await one('SELECT 1 FROM resources_v WHERE id=$1', [id])) throw notFound('Risorsa non trovata');
  // public.people + person_ext + aree + ruolo in un'unica transazione, con audit PERSON_UPDATED della Suite
  await tx(async (c) => {
    if (Object.keys(d).length) await updatePerson(c, req, id, d);
    // Doppie funzioni: aree aggiuntive oltre a quella principale
    if (Array.isArray(extra)) {
      const ids = [...new Set(extra.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      const primary = d.area_id !== undefined ? d.area_id : (await c.query('SELECT area_id FROM person_ext WHERE person_id=$1', [id])).rows[0]?.area_id;
      await c.query('DELETE FROM person_areas WHERE person_id=$1', [id]);
      for (const aid of ids) if (aid !== primary) await c.query('INSERT INTO person_areas(person_id, area_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, aid]);
      d.extra_area_ids = ids;
    }
    // Ruolo: mansione del dipendente (employments.job_title) o disciplina del professionista (lp_contracts.discipline)
    if (role !== undefined) {
      const val = role === null || String(role).trim() === '' ? null : String(role).trim().slice(0, 160);
      const rsrc = (await c.query('SELECT kind FROM resources_v WHERE id=$1', [id])).rows[0];
      if (rsrc?.kind === 'DIPENDENTE') {
        const ex = (await c.query('SELECT resource_id FROM employments WHERE resource_id=$1', [id])).rows[0];
        if (ex) await c.query('UPDATE employments SET job_title=$2, updated_at=now() WHERE resource_id=$1', [id, val]);
        else if (val) await c.query('INSERT INTO employments(resource_id, job_title) VALUES ($1,$2)', [id, val]);
      } else if (rsrc?.kind === 'LP') {
        const ex = (await c.query('SELECT resource_id FROM lp_contracts WHERE resource_id=$1', [id])).rows[0];
        if (ex) await c.query('UPDATE lp_contracts SET discipline=$2, updated_at=now() WHERE resource_id=$1', [id, val]);
        else if (val) await c.query('INSERT INTO lp_contracts(resource_id, discipline) VALUES ($1,$2)', [id, val]);
      }
      await syncDerived(c, id);
      d.job_title = val;
    }
  });
  reindexPerson(id);
  await audit(req, 'RESOURCE_UPDATE', 'resource', id, d);
  res.json({ ok: true });
}));

r.put('/:id/employment', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const rsrc = await one('SELECT kind FROM resources_v WHERE id=$1', [id]);
  if (!rsrc) throw notFound();
  if (rsrc.kind !== 'DIPENDENTE') throw bad('La risorsa non è un dipendente');
  // aggiornamento parziale: i campi non inviati restano quelli salvati (i default dello schema non li sovrascrivono)
  const cur = await one('SELECT * FROM employments WHERE resource_id=$1', [id]);
  const base = {}; if (cur) for (const k of EMP_COLS) if (cur[k] !== null && cur[k] !== undefined) base[k] = typeof cur[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cur[k]) ? cur[k] : cur[k];
  const e = parse(employmentSchema, { ...base, ...req.body });
  if (req.body.base_pay === undefined && (req.body.ral !== undefined || req.body.level !== undefined)) { delete e.base_pay; delete e.superminimo; delete e.function_allowance; } // RAL o livello cambiati: ricalcolo
  await tx(async (c) => { await upsertEmployment(c, id, e); if (e.start_date) await updatePerson(c, req, id, { hired_at: e.start_date }, { audit: false }); });
  reindexPerson(id);
  await audit(req, 'EMPLOYMENT_UPDATE', 'resource', id, { ral: e.ral, level: e.level, job_title: e.job_title });
  res.json({ ok: true });
}));

r.put('/:id/lp', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const rsrc = await one('SELECT kind FROM resources_v WHERE id=$1', [id]);
  if (!rsrc) throw notFound();
  if (rsrc.kind !== 'LP') throw bad('La risorsa non è un libero professionista');
  const l = parse(lpSchema, req.body);
  await tx(async (c) => { await upsertLp(c, id, l); if (l.start_date) await updatePerson(c, req, id, { hired_at: l.start_date }, { audit: false }); });
  reindexPerson(id);
  await audit(req, 'LP_UPDATE', 'resource', id, { discipline: l.discipline, start_date: l.start_date });
  res.json({ ok: true });
}));

// Cessazione del rapporto: decorrenza, motivo, note. Se la decorrenza è futura la risorsa resta attiva fino a quel giorno (lo stato viene allineato all'avvio e dalla scheda).
const TERMINATION_REASONS = ['DIMISSIONI', 'LICENZIAMENTO', 'SCADENZA_TERMINE', 'RISOLUZIONE_CONSENSUALE', 'PENSIONAMENTO', 'FINE_INCARICO', 'RECESSO', 'ALTRO'];
r.put('/:id/terminate', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one('SELECT id, kind, status FROM resources_v WHERE id=$1', [id]);
  if (!cur) throw notFound();
  const d = parse(z.object({ terminated_at: z.string().regex(dateRe), reason: z.enum(TERMINATION_REASONS), notes: opt(z.string().max(2000)) }), req.body);
  const today = new Date().toISOString().slice(0, 10);
  const status = d.terminated_at <= today ? 'CESSATO' : cur.status;
  await tx(async (c) => {
    await updatePerson(c, req, id, { status, terminated_at: d.terminated_at, termination_reason: d.reason, termination_notes: d.notes ?? null });
    if (cur.kind === 'DIPENDENTE') await c.query('UPDATE employments SET end_date=$2, updated_at=now() WHERE resource_id=$1', [id, d.terminated_at]);
    else await c.query('UPDATE lp_contracts SET end_date=$2, updated_at=now() WHERE resource_id=$1', [id, d.terminated_at]);
  });
  reindexPerson(id);
  // Dalla data di cessazione la persona esce dall'organigramma: i suoi riporti passano al suo responsabile, le aree di cui era referente tornano al calcolo automatico
  const handover = async () => {
    const me = await one('SELECT manager_person_id FROM public.people WHERE id=$1', [id]);
    const up = me?.manager_person_id && me.manager_person_id !== id ? me.manager_person_id : null;
    const moved = (await one('WITH u AS (UPDATE public.people SET manager_person_id=$2, updated_at=now() WHERE manager_person_id=$1 AND id<>$1 RETURNING id) SELECT count(*)::int AS n FROM u', [id, up])).n;
    await q('UPDATE person_ext SET approver_id=NULL, updated_at=now() WHERE approver_id=$1', [id]);
    const heads = (await one('WITH u AS (UPDATE areas SET head_person_id=NULL WHERE head_person_id=$1 RETURNING id) SELECT count(*)::int AS n FROM u', [id])).n;
    return { moved, heads, up };
  };
  const h = status === 'CESSATO' ? await handover() : null;
  await audit(req, 'RESOURCE_TERMINATE', 'resource', id, { terminated_at: d.terminated_at, reason: d.reason, handover: h });
  res.json({ ok: true, status, terminated_at: d.terminated_at, handover: h });
}));
r.put('/:id/reactivate', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (c) => {
    await updatePerson(c, req, id, { status: 'ATTIVO', terminated_at: null, termination_reason: null, termination_notes: null });
    // la data di fine scritta dalla cessazione viene tolta dai rapporti senza termine (TIND, dirigenti); per TDET, apprendistato e LP resta quella contrattuale
    await c.query("UPDATE employments SET end_date=NULL, updated_at=now() WHERE resource_id=$1 AND contract_type IN ('TIND','DIRIGENTE')", [id]);
  });
  reindexPerson(id);
  await audit(req, 'RESOURCE_REACTIVATE', 'resource', id);
  res.json({ ok: true });
}));

r.delete('/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) throw bad('Indicare la motivazione');
  // Eliminazione dall'anagrafica unica (public.people): il dossier HR e i documenti seguono in cascata. Riservata agli ADMIN, con motivazione.
  const rsrc = await tx((c) => deletePerson(c, req, id, reason));
  if (!rsrc) throw notFound();
  removeFromIndex('person', id).catch(() => {});
  await audit(req, 'RESOURCE_DELETE', 'resource', id, { name: `${rsrc.last_name} ${rsrc.first_name}`, reason });
  res.json({ ok: true });
}));

// ---------------- Dossier: allegati ----------------
/** Contesto per la lettura automatica: etichetta della categoria, periodicità, intestatario atteso. */
async function analysisContext(id, category) {
  const r = await one('SELECT kind, first_name, last_name FROM resources_v WHERE id=$1', [id]);
  const req_ = r ? await one('SELECT label, renew_months FROM dossier_requirements WHERE kind=$1 AND category=$2', [r.kind, category]) : null;
  return { label: req_?.label || category, renewMonths: req_?.renew_months || null, personName: r ? `${r.first_name} ${r.last_name}` : null };
}

/** Legge un file prima del caricamento e propone firmato, data di rilascio e scadenza (non salva nulla). */
r.post('/:id/attachments/analyze', requireWrite, upload.single('file'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) throw bad('File mancante');
  const category = String(req.body.category || 'ALTRO');
  const ctx = await analysisContext(id, category);
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const r = await analyzeAttachment({ buffer: req.file.buffer, mime: req.file.mimetype, filename, category, ...ctx });
    res.json(r);
  } catch (e) { throw new HttpError(e.status || 424, e.message); }
}));

/** Analisi massiva del dossier: legge tutti gli allegati (o solo quelli con campi vuoti) e compila firmato, rilascio e scadenza. */
r.post('/:id/attachments/analyze-all', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!await one('SELECT 1 FROM resources_v WHERE id=$1', [id])) throw notFound();
  const onlyMissing = req.body?.only_missing !== false;
  const limit = Math.min(10, Math.max(1, Number(req.body?.limit) || 4));
  const after = Number(req.body?.after) || 0; // a lotti: il client richiama passando l'ultimo id elaborato
  const all = await many(`SELECT id, category, filename, mime, size, issued_at, expires_at, signed, notes FROM attachments WHERE resource_id=$1 ${onlyMissing ? "AND (issued_at IS NULL OR expires_at IS NULL OR signed = FALSE)" : ''} AND id > $2 ORDER BY id`, [id, after]);
  const rows = all.slice(0, limit);
  const report = []; let updated = 0;
  for (const a of rows) {
    if (!/pdf|image|wordprocessingml|text\/plain/i.test(a.mime || '') && !/\.(pdf|docx|txt|png|jpe?g|webp)$/i.test(a.filename || '')) { report.push({ id: a.id, filename: a.filename, category: a.category, skipped: 'formato non leggibile' }); continue; }
    const ctx = await analysisContext(id, a.category);
    const full = await one('SELECT data FROM attachments WHERE id=$1', [a.id]);
    try {
      const r = await analyzeAttachment({ buffer: full.data, mime: a.mime, filename: a.filename, category: a.category, ...ctx });
      const changes = {};
      if (r.weak) { report.push({ id: a.id, filename: a.filename, category: a.category, result: r, changes, skipped: 'nessuna data riconoscibile con certezza (senza API Claude): da compilare a mano' }); continue; }
      if (!a.issued_at && r.issued_at) changes.issued_at = r.issued_at;
      if (!a.expires_at && r.expires_at) changes.expires_at = r.expires_at;
      if (!a.signed && r.signed === true) changes.signed = true;
      if (!a.notes && r.notes) changes.notes = `Lettura automatica: ${r.notes}`.slice(0, 500);
      const cols = Object.keys(changes);
      if (cols.length) { await q(`UPDATE attachments SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [a.id, ...cols.map((c) => changes[c])]); updated++; }
      report.push({ id: a.id, filename: a.filename, category: a.category, result: r, changes });
    } catch (e) {
      report.push({ id: a.id, filename: a.filename, category: a.category, error: e.message });
    }
  }
  if (rows.length) await audit(req, 'ATTACHMENTS_ANALYZE_ALL', 'resource', id, { analyzed: rows.length, updated });
  res.json({ analyzed: rows.length, updated, report, remaining: all.length - rows.length, last_id: rows.length ? rows[rows.length - 1].id : after, total: all.length });
}));

/** Rilegge un allegato già nel dossier; con apply=1 compila i campi vuoti. */
r.post('/:id/attachments/:aid/analyze', requireWrite, ah(async (req, res) => {
  const id = Number(req.params.id), aid = Number(req.params.aid);
  const a = await one('SELECT * FROM attachments WHERE id=$1 AND resource_id=$2', [aid, id]);
  if (!a) throw notFound();
  const ctx = await analysisContext(id, a.category);
  let r;
  try { r = await analyzeAttachment({ buffer: a.data, mime: a.mime, filename: a.filename, category: a.category, ...ctx }); } catch (e) { throw new HttpError(e.status || 424, e.message); }
  if (req.body?.apply && !r.weak) {
    await q(`UPDATE attachments SET issued_at=coalesce(issued_at,$2), expires_at=coalesce(expires_at,$3), signed=CASE WHEN signed THEN TRUE ELSE coalesce($4, signed) END,
      notes=CASE WHEN coalesce(notes,'')='' THEN $5 ELSE notes END WHERE id=$1`, [aid, r.issued_at, r.expires_at, r.signed, r.notes ? `Lettura automatica: ${r.notes}`.slice(0, 500) : null]);
    await audit(req, 'ATTACHMENT_ANALYZE', 'attachment', aid, { method: r.method, issued_at: r.issued_at, expires_at: r.expires_at, signed: r.signed });
  }
  res.json(r);
}));

r.post('/:id/attachments', requireWrite, upload.single('file'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!await one('SELECT 1 FROM resources_v WHERE id=$1', [id])) throw notFound();
  if (!req.file) throw bad('File mancante');
  const d = parse(z.object({ category: z.string().min(2).max(40), issued_at: optDate(), expires_at: optDate(), signed: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false), notes: opt(z.string().max(500)), set_cv: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false) }), req.body);
  const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  let auto = null;
  if (req.body.auto === '1' && (!d.issued_at || !d.expires_at || !d.signed)) {
    try {
      const ctx = await analysisContext(id, d.category);
      auto = await analyzeAttachment({ buffer: req.file.buffer, mime: req.file.mimetype, filename, category: d.category, ...ctx });
      if (auto.weak) throw Object.assign(new Error('nessuna data riconoscibile con certezza'), { weak: true });
      if (!d.issued_at && auto.issued_at) d.issued_at = auto.issued_at;
      if (!d.expires_at && auto.expires_at) d.expires_at = auto.expires_at;
      if (!d.signed && auto.signed === true) d.signed = true;
      if (!d.notes && auto.notes) d.notes = `Lettura automatica: ${auto.notes}`.slice(0, 500);
    } catch (e) { if (!e.weak) console.error('[doc] lettura automatica non riuscita:', e.message); auto = { error: e.message }; }
  }
  const row = await one(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, sha256, issued_at, expires_at, signed, notes, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [id, d.category, filename, req.file.mimetype, req.file.size, req.file.buffer, sha, d.issued_at, d.expires_at, d.signed, d.notes, req.user.id]);
  if (d.set_cv || d.category === 'CV') await updatePerson(null, req, id, { cv_attachment_id: row.id }, { audit: false });
  await audit(req, 'ATTACHMENT_UPLOAD', 'attachment', row.id, { resource_id: id, category: d.category, filename, auto: auto ? { method: auto.method, issued_at: auto.issued_at, expires_at: auto.expires_at, signed: auto.signed } : null });
  res.status(201).json({ id: row.id, auto });
}));

r.put('/:id/attachments/:aid', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ category: z.string().min(2).max(40).optional(), issued_at: optDate(), expires_at: optDate(), signed: z.boolean().optional(), notes: opt(z.string().max(500)) }), req.body);
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE attachments SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(', ')} WHERE id=$1 AND resource_id=$2`, [Number(req.params.aid), Number(req.params.id), ...cols.map((c) => d[c])]);
  res.json({ ok: true });
}));

r.get('/:id/attachments/:aid/download', ah(async (req, res) => {
  const a = await one('SELECT filename, mime, data FROM attachments WHERE id=$1 AND resource_id=$2', [Number(req.params.aid), Number(req.params.id)]);
  if (!a) throw notFound();
  await readLog(req, 'attachment', req.params.aid);
  const inline = req.query.inline === '1' && ['application/pdf', 'image/png', 'image/jpeg'].includes(a.mime);
  res.set('Content-Type', a.mime).set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`).send(a.data);
}));

r.delete('/:id/attachments/:aid', requireWrite, ah(async (req, res) => {
  const a = await one('DELETE FROM attachments WHERE id=$1 AND resource_id=$2 RETURNING filename', [Number(req.params.aid), Number(req.params.id)]);
  if (!a) throw notFound();
  await audit(req, 'ATTACHMENT_DELETE', 'attachment', req.params.aid, { resource_id: Number(req.params.id), filename: a.filename });
  res.json({ ok: true });
}));

// ---------------- Scadenze manuali ----------------
r.post('/:id/deadlines', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ title: z.string().min(2).max(200), due_date: z.string().regex(dateRe), notes: opt(z.string().max(500)) }), req.body);
  const row = await one('INSERT INTO deadlines (resource_id, title, due_date, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [Number(req.params.id), d.title, d.due_date, d.notes, req.user.id]);
  res.status(201).json(row);
}));
r.put('/:id/deadlines/:did', requireWrite, ah(async (req, res) => {
  const d = parse(z.object({ done: z.boolean().optional(), title: z.string().min(2).max(200).optional(), due_date: z.string().regex(dateRe).optional(), notes: opt(z.string().max(500)) }), req.body);
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE deadlines SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(', ')} WHERE id=$1 AND resource_id=$2`, [Number(req.params.did), Number(req.params.id), ...cols.map((c) => d[c])]);
  res.json({ ok: true });
}));
r.delete('/:id/deadlines/:did', requireWrite, ah(async (req, res) => { await q('DELETE FROM deadlines WHERE id=$1 AND resource_id=$2', [Number(req.params.did), Number(req.params.id)]); res.json({ ok: true }); }));

export default r;
