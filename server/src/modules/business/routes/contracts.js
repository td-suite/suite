import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse, itDate, todayRome } from '../lib/util.js';
import { requireKind, isAdmin } from '../lib/access.js';
import { getSettings, KIND, canEditKind, HAS_DOSSIER } from '../lib/rules.js';
import { contractData, renderDocx, docxToPdf, pdfAvailable, CONTRACT_TEMPLATE, CONTRACT_DOCNAME } from '../lib/docgen.js';
import { encrypt, decrypt, sha256 } from '../lib/crypto.js';
import { audit as suiteAudit } from '../../../lib/util.js';
import { defaultChecklists, DEFAULT_HOURS } from '../lib/dossier.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida');
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr.nullable());
const optNum = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().nullable());

const privacySchema = z.object({
  role: z.enum(['TITOLARE', 'RESPONSABILE']).nullable().optional(),
  principal: optStr(200), measures: optStr(1000), dpo_name: optStr(160), dpo_contact: optStr(200),
}).default({});

const DATA_SCHEMA = {
  PP: z.object({
    fee: z.object({
      items: z.array(z.object({
        kind: z.enum(['PERCENT', 'FIXED', 'MINIMUM', 'TEXT']).default('PERCENT'),
        percent: optNum, base: z.enum(['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'ALTRO']).default('PUNTO_PRELIEVI'), base_other: optStr(300), include_ssr: z.boolean().default(false),
        amount: optNum, period: z.enum(['MESE', 'TRIMESTRE', 'ANNO', 'UNA_TANTUM']).default('MESE'), purpose: optStr(300),
        vat: z.enum(['PIU_IVA', 'IVA_INCLUSA', 'ESENTE']).default('PIU_IVA'),
        closing: z.boolean().default(true), text: optStr(1500),
      })).max(12).default([]),
    }).default({}),
    services: z.object({ nursing: z.enum(['TD', 'HOST']).default('TD'), reception: z.enum(['HOST', 'TD']).default('HOST') }).default({}),
    duration_years: z.coerce.number().int().min(1).max(10).default(3),
    duvri_costs_clause: optStr(600),
  }),
  SRV: z.object({
    site_name: optStr(200), site_address: optStr(300), client_ds: optStr(160),
    vat_exemption: z.boolean().nullable().optional(), payment_terms: optStr(160),
    price_list_file: optStr(300),
    pickup: z.object({
      site: optStr(200), street: optStr(200), city: optStr(120), contact: optStr(160), phone: optStr(60), email: optStr(160),
      days: z.array(z.object({ mode: z.enum(['FISSO', 'CHIAMATA', 'NO']).default('NO'), time_from: optStr(5), time_to: optStr(5) })).max(6).default([]),
    }).default({}),
    interface_solution: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
    privacy: privacySchema,
  }),
  MDL: z.object({
    service_email: optStr(160), service_contact: optStr(160), service_phone: optStr(60), invoice_email: optStr(160),
    doctor_name: optStr(160), doctor_email: optStr(160),
    vat_exemption: z.boolean().nullable().optional(), payment_terms: optStr(160),
    price_list_file: optStr(300),
    privacy: privacySchema,
  }),
  SEDE: z.object({
    site_type: z.enum(['LABORATORIO', 'PUNTO_PRELIEVI', 'CENTRO_POLIDIAGNOSTICO', 'ALTRO']).default('PUNTO_PRELIEVI'),
    rent: z.object({
      amount: optNum, period: z.enum(['MESE', 'TRIMESTRE', 'ANNO']).default('MESE'), vat: z.enum(['PIU_IVA', 'IVA_INCLUSA', 'ESENTE']).default('PIU_IVA'),
      deposit: optNum, duration_years: optNum, renewal_years: optNum, notice_months: optNum, istat: z.boolean().default(false),
      expenses: optStr(600), registration: optStr(200), notes: optStr(1500),
    }).default({}),
  }),
};

const contractSchema = z.object({
  kind: z.enum(['PP', 'SRV', 'MDL', 'SEDE']),
  // controparte (Legal entity) e sede TD: almeno una delle due (contracts_party_check)
  org_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable()),
  site_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable()),
  title: optStr(160),
  proposal_date: dateStr,
  start_date: optDate,
  end_date: optDate,
  notes: optStr(2000),
  data: z.any().default({}),
});

// La controparte (c.org) è una Legal entity dell'anagrafica unica (public.organizations, via la vista orgs_v con i campi Business);
// la sede TD (c.site) è una sede dell'anagrafica unica (public.sites, kind <> 'SERVICE'). Almeno una delle due è presente:
// il contratto del punto prelievi lega la sede TD al partner che la ospita, la sede in locazione lega la sede TD al locatore.
export const CONTRACT_COLS = `c.id, c.kind, c.protocol, c.status, c.org_id, c.site_id, c.title, c.proposal_date, c.start_date, c.end_date, c.data, c.notes, c.signed_at, c.version, c.created_by, c.cancelled_at, c.cancel_reason, c.created_at, c.updated_at,
  p.name AS org_name, p.city AS org_city, p.prov AS org_prov, p.vat AS org_vat, p.kind AS org_kind,
  s.code AS site_code, s.name AS site_name, s.kind AS site_kind, s.address AS site_street, s.zip AS site_zip, s.city AS site_city, s.province AS site_prov`;
export const CONTRACT_FROM = 'FROM contracts c LEFT JOIN orgs_v p ON p.id=c.org_id LEFT JOIN public.sites s ON s.id=c.site_id';
export const SITE_COLS = 'id, code, name, kind, address AS street, zip, city, province AS prov, active, organization_id';

// Sede TD dell'anagrafica unica: obbligatoria per punti prelievo e sedi in locazione, facoltativa per le altre sezioni;
// sempre attiva e mai un punto dei clienti service (kind SERVICE). Il profilo di sede vede solo le sue sedi.
export async function checkSite(kind, siteId, user) {
  if (!siteId) { if (HAS_DOSSIER(kind)) throw bad('Seleziona la sede TD dall’anagrafica (Amministrazione > Sedi)'); return null; }
  const site = await one(`SELECT ${SITE_COLS} FROM public.sites WHERE id=$1 AND active AND kind <> 'SERVICE'`, [siteId]);
  if (!site) throw bad('Sede TD non trovata o disattivata (i punti dei clienti service non sono sedi TD)');
  const ids = Array.isArray(user?.site_ids) ? user.site_ids : [];
  if (ids.length && !ids.includes(site.id)) throw bad('Sede fuori dal tuo perimetro');
  return site;
}

// Controparte (Legal entity dell'anagrafica unica): se indicata deve esistere ed essere attiva
export async function checkOrg(orgId) {
  if (!orgId) return null;
  const org = await one('SELECT * FROM orgs_v WHERE id=$1 AND active', [orgId]);
  if (!org) throw bad('Legal entity non trovata o disattivata: le organizzazioni si creano in Amministrazione > Legal entity');
  return org;
}

// Documenti del fascicolo che non si applicano quando non c'è una struttura ospitante (sede intestata a TD o nessuna controparte)
export function defaultDocState(noHost) {
  return noHost ? { ATTO_CONDIVISIONE: { not_applicable: true, note: 'Sede intestata a Toscana Diagnostica: nessuna struttura ospitante' }, DUVRI: { not_applicable: true, note: 'Sede intestata a Toscana Diagnostica: nessuna interferenza con una struttura ospitante' } } : {};
}

async function addEvent(id, kind, userId, note, data, client) {
  const run = client ? client.query.bind(client) : q;
  await run('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [id, kind, userId || null, note || null, data ? JSON.stringify(data) : null]);
}

export async function loadContract(id) {
  const c = await one(`SELECT ${CONTRACT_COLS} ${CONTRACT_FROM} WHERE c.id=$1`, [id]);
  if (!c) throw notFound('Contratto non trovato');
  c.org = c.org_id ? await one('SELECT * FROM orgs_v WHERE id=$1', [c.org_id]) : null;
  c.site = c.site_id ? await one(`SELECT ${SITE_COLS} FROM public.sites WHERE id=$1`, [c.site_id]) : null;
  c.files = await many('SELECT f.id, f.category, f.filename, f.mime, f.size, f.sha256, f.version, f.created_at, u.full_name AS uploaded_by_name FROM contract_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.contract_id=$1 ORDER BY f.created_at DESC', [id]);
  c.events = await many('SELECT e.*, u.full_name AS user_name FROM contract_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.contract_id=$1 ORDER BY e.at', [id]);
  c.dossier = await one('SELECT id, status, doc_date, submitted_at, authorized_at, authorization_ref FROM dossiers WHERE contract_id=$1', [id]);
  const cred = await one('SELECT portal_url, username, notes, updated_at, (password_enc IS NOT NULL) AS has_password FROM portal_credentials WHERE contract_id=$1', [id]);
  c.credentials = cred;
  return c;
}

const editable = (st) => ['BOZZA', 'PROPOSTA'].includes(st);

// ---------------- Elenco ----------------
r.get('/', ah(async (req, res) => {
  const { kind, status, q: qs, year, org_id, site_id } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (kind) add('c.kind = ?', kind);
  if (status) { p.push(String(status).split(',')); where.push(`c.status = ANY($${p.length})`); }
  if (year) add('extract(year from c.proposal_date) = ?', Number(year));
  if (org_id) add('c.org_id = ?', Number(org_id));
  if (site_id) add('c.site_id = ?', Number(site_id));
  if (qs) { p.push(String(qs).toLowerCase()); const i = p.length; where.push(`(lower(coalesce(p.name,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(c.protocol,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(c.title,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(p.city,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(s.name,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(s.city,'')) LIKE '%'||$${i}||'%')`); }
  const rows = await many(`SELECT ${CONTRACT_COLS},
      (SELECT count(*)::int FROM contract_files f WHERE f.contract_id=c.id AND f.category='FIRMATO') AS signed_files,
      (SELECT count(*)::int FROM contract_files f WHERE f.contract_id=c.id AND f.category IN ('LISTINO_XLSX','LISTINO_PDF')) AS price_lists,
      (SELECT d.status FROM dossiers d WHERE d.contract_id=c.id) AS dossier_status,
      (SELECT d.id FROM dossiers d WHERE d.contract_id=c.id) AS dossier_id
    ${CONTRACT_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC LIMIT 1000`, p);
  res.json(rows);
}));

r.get('/:id', ah(async (req, res) => res.json(await loadContract(Number(req.params.id)))));

// ---------------- Creazione e modifica ----------------
export function validateData(kind, data) {
  return parse(DATA_SCHEMA[kind], data || {});
}

r.post('/', ah(async (req, res) => {
  const d = parse(contractSchema, req.body);
  requireKind(d.kind, req.user);
  const data = validateData(d.kind, d.data);
  if (!d.org_id && !d.site_id) throw bad('Indica la controparte (Legal entity) o la sede TD: almeno una delle due');
  const org = await checkOrg(d.org_id);
  const site = await checkSite(d.kind, d.site_id, req.user);
  const title = d.title || (d.kind === 'PP' ? `Punto Prelievi ${site.city || site.name}` : d.kind === 'SEDE' ? `${({ LABORATORIO: 'Laboratorio', PUNTO_PRELIEVI: 'Punto Prelievi', CENTRO_POLIDIAGNOSTICO: 'Centro Polidiagnostico', ALTRO: 'Sede' })[data.site_type]} ${site.city || site.name}` : org?.name || site?.name);
  const row = await tx(async (client) => {
    const c = (await client.query(`INSERT INTO contracts (kind, org_id, site_id, title, proposal_date, start_date, end_date, notes, data, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [d.kind, org?.id || null, site?.id || null, title, d.proposal_date, d.start_date, d.end_date, d.notes, JSON.stringify(data), req.user.id])).rows[0];
    if (HAS_DOSSIER(d.kind)) {
      // il fascicolo nasce con la controparte e la sede TD del contratto (dossiers.org_id / site_id) e le segue
      await client.query('INSERT INTO dossiers (contract_id, org_id, site_id, hours, checklists, doc_date, doc_state, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [c.id, org?.id || null, site?.id || null, JSON.stringify(DEFAULT_HOURS), JSON.stringify(defaultChecklists()), d.proposal_date, JSON.stringify(defaultDocState(d.kind === 'SEDE' || !org)), req.user.id]);
    }
    await addEvent(c.id, 'CREATO', req.user.id, null, null, client);
    return c;
  });
  await audit(req, 'CONTRACT_CREATE', 'contract', row.id, { kind: d.kind, org: org?.name, site: site?.name });
  res.status(201).json(await loadContract(row.id));
}));

r.put('/:id', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  if (!editable(c.status)) throw bad('Il contratto è già firmato: per modificare i termini crea una nuova proposta');
  const d = parse(contractSchema.partial().omit({ kind: true }), req.body);
  const data = d.data !== undefined ? validateData(c.kind, d.data) : c.data;
  const orgId = d.org_id !== undefined ? d.org_id : c.org_id;
  const siteId = d.site_id !== undefined ? d.site_id : c.site_id;
  if (!orgId && !siteId) throw bad('Indica la controparte (Legal entity) o la sede TD: almeno una delle due');
  await checkOrg(orgId);
  await checkSite(c.kind, siteId, req.user);
  await q(`UPDATE contracts SET org_id=$2, site_id=$9, title=coalesce($3, title), proposal_date=coalesce($4, proposal_date), start_date=$5, end_date=$6, notes=$7, data=$8, updated_at=now() WHERE id=$1`,
    [c.id, orgId || null, d.title ?? null, d.proposal_date || null, d.start_date ?? c.start_date, d.end_date ?? c.end_date, d.notes ?? c.notes, JSON.stringify(data), siteId || null]);
  // il fascicolo del contratto segue controparte e sede del contratto
  await q('UPDATE dossiers SET org_id=$2, site_id=$3, updated_at=now() WHERE contract_id=$1 AND (org_id IS DISTINCT FROM $2 OR site_id IS DISTINCT FROM $3)', [c.id, orgId || null, siteId || null]);
  await addEvent(c.id, 'MODIFICATO', req.user.id);
  await audit(req, 'CONTRACT_UPDATE', 'contract', c.id);
  res.json(await loadContract(c.id));
}));

// ---------------- Generazione del documento (DOCX + PDF) ----------------
export async function nextProtocol(kind, year, s, client) {
  const row = (await client.query('INSERT INTO protocol_counters(kind, year, last) VALUES ($1,$2,1) ON CONFLICT (kind, year) DO UPDATE SET last=protocol_counters.last+1 RETURNING last', [kind, year])).rows[0];
  return `${s[`protocol_prefix_${kind}`] || kind}-${year}-${String(row.last).padStart(4, '0')}`;
}

r.post('/:id/generate', ah(async (req, res) => {
  let c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  if (c.kind === 'SEDE') throw bad('Per le sedi in locazione il contratto lo predispone il locatore: carica il contratto firmato');
  if (!editable(c.status)) throw bad('Il documento è già stato sottoscritto: non si rigenera');
  const s = await getSettings();
  const errors = completenessErrors(c);
  if (errors.length) throw bad(`Dati incompleti. ${errors.join(' ')}`);
  await tx(async (client) => {
    if (!c.protocol) {
      const protocol = await nextProtocol(c.kind, Number(String(c.proposal_date).slice(0, 4)), s, client);
      await client.query('UPDATE contracts SET protocol=$2 WHERE id=$1', [c.id, protocol]);
    } else {
      await client.query('UPDATE contracts SET version=version+1 WHERE id=$1', [c.id]);
    }
    await client.query(`UPDATE contracts SET status='PROPOSTA', updated_at=now() WHERE id=$1`, [c.id]);
    // le versioni precedenti del documento generato vengono sostituite (il firmato resta)
    await client.query(`DELETE FROM contract_files WHERE contract_id=$1 AND category IN ('GENERATO_DOCX','GENERATO_PDF')`, [c.id]);
  });
  c = await loadContract(c.id);
  const data = contractData(c, c.org, s);
  const docx = renderDocx(CONTRACT_TEMPLATE[c.kind], data);
  const base = `${CONTRACT_DOCNAME[c.kind]}_${c.protocol}_v${c.version}`;
  const ins = (cat, filename, mime, buf) => q('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [c.id, cat, filename, mime, buf.length, sha256(buf), buf, c.version, req.user.id]);
  await ins('GENERATO_DOCX', `${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
  let pdfError = null;
  if (await pdfAvailable()) {
    try { await ins('GENERATO_PDF', `${base}.pdf`, 'application/pdf', await docxToPdf(docx)); } catch (e) { pdfError = e.message; }
  } else pdfError = 'LibreOffice non disponibile: generato solo il DOCX';
  await addEvent(c.id, 'GENERATO', req.user.id, pdfError, { protocol: c.protocol, version: c.version });
  await audit(req, 'CONTRACT_GENERATE', 'contract', c.id, { protocol: c.protocol, version: c.version });
  res.json({ ...(await loadContract(c.id)), pdfError });
}));

// Controlli minimi prima di generare la proposta
function completenessErrors(c) {
  const e = []; const d = c.data || {}; const p = c.org;
  if (!p) { e.push('Indica la controparte (Legal entity): il documento è intestato a lei.'); return e; }
  if (!p.vat && !p.tax_code) e.push('Indica P.IVA o codice fiscale dell’organizzazione (Amministrazione > Organizzazioni).');
  if (!p.street || !p.city) e.push('Completa l’indirizzo dell’organizzazione (Amministrazione > Organizzazioni).');
  if (!p.signer && !p.legal_rep) e.push('Indica il legale rappresentante o il firmatario nelle impostazioni Business dell’organizzazione.');
  if (HAS_DOSSIER(c.kind) && !c.site) e.push('Seleziona la sede TD dall’anagrafica.');
  if (c.kind === 'PP') {
    const items = d.fee?.items || [];
    if (!items.length) e.push('Indica almeno una condizione del corrispettivo (art. 5.1).');
    items.forEach((it, i) => {
      if (it.kind === 'PERCENT' && !(Number(it.percent) > 0)) e.push(`Condizione ${i + 1}: indica la percentuale.`);
      if (it.kind === 'PERCENT' && it.base === 'ALTRO' && !(it.base_other || '').trim()) e.push(`Condizione ${i + 1}: indica la base di calcolo.`);
      if (['FIXED', 'MINIMUM'].includes(it.kind) && !(Number(it.amount) > 0)) e.push(`Condizione ${i + 1}: indica l’importo.`);
      if (it.kind === 'TEXT' && !(it.text || '').trim()) e.push(`Condizione ${i + 1}: scrivi il testo della condizione.`);
    });
    if (!c.start_date) e.push('Indica la data di decorrenza (apertura del Punto Prelievi).');
  }
  if (c.kind === 'SRV' && !p.pec) e.push('Indica la PEC del cliente: le fatture viaggiano via PEC.');
  if (c.kind === 'SEDE' && !(Number(d.rent?.amount) > 0)) e.push('Indica il canone di locazione.');
  return e;
}

// ---------------- File: contratto firmato, listini, altro ----------------
const CAT = { FIRMATO: 'FIRMATO', LISTINO_XLSX: 'LISTINO_XLSX', LISTINO_PDF: 'LISTINO_PDF', PLANIMETRIA: 'PLANIMETRIA', ASSICURAZIONE: 'ASSICURAZIONE', ALTRO: 'ALTRO' };
r.post('/:id/files', upload.array('files', 10), ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  const category = CAT[req.body.category];
  if (!category) throw bad('Categoria non valida');
  if (!req.files?.length) throw bad('Nessun file');
  if (category === 'FIRMATO' && c.status === 'BOZZA' && c.kind !== 'SEDE') throw bad('Genera prima la proposta: il contratto firmato va caricato sulla proposta protocollata');
  if (category === 'FIRMATO' && c.kind === 'SEDE' && !c.protocol) {
    const s = await getSettings();
    await tx(async (client) => { const protocol = await nextProtocol('SEDE', Number(String(c.proposal_date).slice(0, 4)), s, client); await client.query('UPDATE contracts SET protocol=$2 WHERE id=$1', [c.id, protocol]); });
  }
  for (const f of req.files) {
    const isXlsx = /\.xlsx?$/i.test(f.originalname); const isPdf = /\.pdf$/i.test(f.originalname);
    if (category === 'LISTINO_XLSX' && !isXlsx) throw bad(`${f.originalname}: il listino va caricato in formato XLSX`);
    if (category === 'LISTINO_PDF' && !isPdf) throw bad(`${f.originalname}: il listino va caricato in formato PDF`);
    if (category === 'FIRMATO' && !isPdf) throw bad(`${f.originalname}: il contratto firmato va caricato in PDF`);
    await q('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [c.id, category, f.originalname, f.mimetype || 'application/octet-stream', f.size, sha256(f.buffer), f.buffer, c.version, req.user.id]);
  }
  if (category === 'FIRMATO') {
    const signedAt = /^\d{4}-\d{2}-\d{2}$/.test(req.body.signed_at || '') ? req.body.signed_at : todayRome();
    await q(`UPDATE contracts SET status='FIRMATO', signed_at=$2, updated_at=now() WHERE id=$1 AND status IN ('BOZZA','PROPOSTA')`, [c.id, signedAt]);
    await addEvent(c.id, 'FIRMATO', req.user.id, `Contratto sottoscritto il ${itDate(signedAt)}`);
  }
  if (category.startsWith('LISTINO')) {
    const names = (await many(`SELECT filename FROM contract_files WHERE contract_id=$1 AND category IN ('LISTINO_XLSX','LISTINO_PDF') ORDER BY created_at`, [c.id])).map((f) => f.filename).join(', ');
    await q(`UPDATE contracts SET data = data || jsonb_build_object('price_list_file', $2::text), updated_at=now() WHERE id=$1`, [c.id, names]);
  }
  await addEvent(c.id, 'ALLEGATO', req.user.id, `${category}: ${req.files.map((f) => f.originalname).join(', ')}`);
  await audit(req, 'CONTRACT_FILE_UPLOAD', 'contract', c.id, { category, files: req.files.map((f) => f.originalname) });
  res.json(await loadContract(c.id));
}));

r.delete('/:id/files/:fid', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  const f = await one('SELECT id, category, filename FROM contract_files WHERE id=$1 AND contract_id=$2', [Number(req.params.fid), c.id]);
  if (!f) throw notFound();
  if (f.category === 'FIRMATO' && !isAdmin(req.user)) throw bad('Il contratto firmato può essere rimosso solo dal Superamministratore');
  await q('DELETE FROM contract_files WHERE id=$1', [f.id]);
  await addEvent(c.id, 'ALLEGATO_RIMOSSO', req.user.id, f.filename);
  await audit(req, 'CONTRACT_FILE_DELETE', 'contract', c.id, { file: f.filename });
  res.json(await loadContract(c.id));
}));

// ---------------- Stato ----------------
r.post('/:id/status', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  const { status, reason, date } = parse(z.object({ status: z.enum(['ATTIVO', 'CESSATO', 'ANNULLATO', 'FIRMATO', 'AUTORIZZATO']), reason: optStr(500), date: optDate }), req.body);
  if (status === 'ATTIVO' && !['FIRMATO', 'AUTORIZZATO'].includes(c.status)) throw bad('Il contratto diventa attivo dopo la firma (e, per i punti prelievo, dopo l’autorizzazione)');
  if (status === 'AUTORIZZATO' && c.kind !== 'PP') throw bad('Lo stato Autorizzato riguarda i punti prelievo');
  if (status === 'CESSATO' && !['ATTIVO', 'FIRMATO', 'AUTORIZZATO'].includes(c.status)) throw bad('Si cessa un contratto firmato o attivo');
  if (status === 'ANNULLATO' && ['CESSATO'].includes(c.status)) throw bad('Contratto già cessato');
  if (['CESSATO', 'ANNULLATO'].includes(status) && !reason) throw bad('Indica la motivazione');
  await q(`UPDATE contracts SET status=$2, end_date = CASE WHEN $2='CESSATO' THEN coalesce($3::date, end_date, current_date) ELSE end_date END,
    cancelled_at = CASE WHEN $2 IN ('ANNULLATO','CESSATO') THEN now() ELSE cancelled_at END, cancel_reason = CASE WHEN $2 IN ('ANNULLATO','CESSATO') THEN $4 ELSE cancel_reason END, updated_at=now() WHERE id=$1`, [c.id, status, date, reason]);
  await addEvent(c.id, status, req.user.id, reason);
  await audit(req, `CONTRACT_${status}`, 'contract', c.id, { reason });
  res.json(await loadContract(c.id));
}));

r.delete('/:id', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  if (c.status !== 'BOZZA') throw bad('Si elimina solo una bozza: le proposte protocollate si annullano');
  await q('DELETE FROM contracts WHERE id=$1', [c.id]);
  await audit(req, 'CONTRACT_DELETE', 'contract', c.id);
  res.json({ ok: true });
}));

// ---------------- Credenziali del portale (Service e MdL) ----------------
r.get('/:id/credentials', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  const cred = await one('SELECT * FROM portal_credentials WHERE contract_id=$1', [c.id]);
  if (!cred) return res.json(null);
  const reveal = req.query.reveal === '1' && canEditKind(req.user, c.kind);
  if (reveal) {
    // In MIRROR i dati del modulo vengono ricopiati dall'app di origine: la visualizzazione si registra nel registro della Suite
    if (req.moduleMode === 'MIRROR') await suiteAudit({ user: req.suiteUser, ip: req.ip }, 'CREDENTIALS_REVEAL', { module: 'business', entity: 'contract', entityId: c.id, label: c.protocol || c.title });
    else { await audit(req, 'CREDENTIALS_REVEAL', 'contract', c.id); await addEvent(c.id, 'CREDENZIALI_VISUALIZZATE', req.user.id); }
  }
  res.json({ portal_url: cred.portal_url, username: cred.username, notes: cred.notes, updated_at: cred.updated_at, has_password: Boolean(cred.password_enc), password: reveal ? decrypt(cred.password_enc) : undefined });
}));

r.put('/:id/credentials', ah(async (req, res) => {
  const c = await loadContract(Number(req.params.id));
  requireKind(c.kind, req.user);
  const d = parse(z.object({ portal_url: optStr(300), username: optStr(160), password: optStr(200), notes: optStr(500) }), req.body);
  const ex = await one('SELECT password_enc FROM portal_credentials WHERE contract_id=$1', [c.id]);
  const enc = d.password ? encrypt(d.password) : (ex?.password_enc || null);
  await q(`INSERT INTO portal_credentials(contract_id, portal_url, username, password_enc, notes, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (contract_id) DO UPDATE SET portal_url=EXCLUDED.portal_url, username=EXCLUDED.username, password_enc=EXCLUDED.password_enc, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [c.id, d.portal_url, d.username, enc, d.notes, req.user.id]);
  await addEvent(c.id, 'CREDENZIALI', req.user.id, d.password ? 'Credenziali del portale aggiornate (password modificata)' : 'Credenziali del portale aggiornate');
  await audit(req, 'CREDENTIALS_UPDATE', 'contract', c.id, { username: d.username });
  res.json({ ok: true });
}));

// ---------------- Download file ----------------
export const filesRouter = Router();
filesRouter.get('/contract-files/:id', ah(async (req, res) => {
  const f = await one('SELECT filename, mime, data FROM contract_files WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound();
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.send(f.data);
}));

export { addEvent, KIND };
export default r;
