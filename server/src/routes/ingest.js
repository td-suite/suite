// API di ingestione a chiave (automatismi PowerShell, sorgenti macchina). Montata su /api/ingest PRIMA della sessione e del CSRF.
// Autenticazione: Authorization: Bearer tds_... (sha256 confrontato con api_keys.key_hash). Idempotenza per batch_uid.
import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, q, pool } from '../db.js';
import { config } from '../config.js';
import { ah, HttpError, audit, slugify } from '../lib/util.js';

// Anagrafica unica: l'utente collegato prende dalla persona nomi, titolo, telefono, sede e legal entity (quella della sede, se la persona non ne ha una propria)
export const SYNC_USER_SQL = `UPDATE users u SET first_name=p.first_name, last_name=p.last_name, full_name=p.last_name || ' ' || p.first_name, title=p.title, phone=p.phone,
  site_id=p.site_id, organization_id=coalesce(p.organization_id, s.organization_id), updated_at=now()
  FROM people p LEFT JOIN sites s ON s.id=p.site_id WHERE u.person_id=p.id AND p.id=$1`;
import { ensureUnit, upsertPosition } from './orgcat.js';

const r = Router();
const MAX_ROWS = 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const err = (status, message, code, details) => Object.assign(new HttpError(status, message, details), code ? { code } : {});

// ---- autenticazione con chiave API
async function requireApiKey(req, _res, next) {
  try {
    const h = req.get('authorization') || '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m) throw err(401, 'Chiave API mancante: usa l\'header Authorization: Bearer <chiave>', 'API_KEY_MISSING');
    const k = await one(`SELECT k.*, s.code AS site_code, s.name AS site_name FROM api_keys k LEFT JOIN sites s ON s.id = k.site_id WHERE k.key_hash = $1`, [sha256(m[1])]);
    if (!k) throw err(401, 'Chiave API non riconosciuta', 'API_KEY_INVALID');
    if (k.revoked_at) throw err(401, 'Chiave API revocata', 'API_KEY_REVOKED');
    if (k.expires_at && new Date(k.expires_at) < new Date()) throw err(401, 'Chiave API scaduta', 'API_KEY_EXPIRED');
    q('UPDATE api_keys SET last_used_at = now() WHERE id=$1', [k.id]).catch(() => {});
    req.apiKey = k;
    next();
  } catch (e) { next(e); }
}
const hasScope = (k, dataset) => (k.scopes || []).includes('ingest:*') || (k.scopes || []).includes(`ingest:${dataset}`);
const requireScope = (dataset) => (req, _res, next) => (hasScope(req.apiKey, dataset) ? next() : next(err(403, `La chiave non ha il permesso ingest:${dataset}`, 'SCOPE_DENIED')));

const limiter = rateLimit({
  windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, validate: false,
  keyGenerator: (req) => `key:${req.apiKey?.id || 'anon'}`,
  message: { error: 'Troppe richieste per questa chiave: massimo 120 al minuto', code: 'RATE_LIMITED' },
});

r.use(requireApiKey, limiter);

const auditIngest = (req, action, data) => audit({ user: null, ip: req.ip }, action, { module: 'admin', entity: 'ingest_batch', entityId: data?.batch_id, label: `${req.apiKey.source} · ${req.apiKey.name}`, data });

// ---- ping
r.get('/ping', ah(async (req, res) => {
  const k = req.apiKey;
  res.json({ ok: true, source: k.source, name: k.name, scopes: k.scopes, site: k.site_id ? { id: k.site_id, code: k.site_code, name: k.site_name } : null, expires_at: k.expires_at });
}));

// ---- stato di un lotto
r.get('/status/:batch_uid', ah(async (req, res) => {
  const b = await one('SELECT id, batch_uid, source, dataset, status, received_at, applied_at, rows_total, rows_ok, rows_rejected, checksum, error, result FROM ingest_batches WHERE batch_uid=$1', [req.params.batch_uid]);
  if (!b) throw err(404, 'Lotto non trovato', 'NOT_FOUND');
  res.json({ ...b, errors: b.result?.errors || [] , result: undefined });
}));

// ---- schemi delle righe
const str = (max = 200) => z.string().trim().max(max);
const opt = (s) => s.nullable().optional();
const email = opt(z.string().trim().toLowerCase().email());
const dateStr = opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-GG'));
export const ROW_SCHEMAS = {
  people: z.object({
    last_name: str(80).min(1), first_name: str(80).min(1), email, tax_code: opt(str(16)), kind: opt(z.enum(['DIPENDENTE', 'LP', 'MEDICO', 'SANITARIO', 'ESTERNO', 'DIRIGENTE'])),
    status: opt(z.enum(['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO'])), area: opt(str(160)), job_title: opt(str(200)), discipline: opt(str(160)), title: opt(str(20)),
    site_code: opt(str(40)), unit: opt(str(160)), phone: opt(str(40)), phone_office: opt(str(40)), phone_ext: opt(str(10)), manager_email: email, hired_at: dateStr, terminated_at: dateStr, external_id: opt(str(80)),
  }),
  sites: z.object({
    code: str(40).min(2), name: str(250).min(2), short_name: opt(str(120)), kind: opt(z.enum(['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO'])),
    address: opt(str(200)), zip: opt(str(10)), city: opt(str(80)), province: opt(str(4)), lat: opt(z.number()), lng: opt(z.number()), phone: opt(str(40)), email,
    manager_name: opt(str(160)), opening_hours: opt(str(600)), studiolab_code: opt(str(40)), legacy_brand: opt(str(120)), active: opt(z.boolean()), organization_code: opt(str(40)),
  }),
  organizations: z.object({
    name: str(250).min(2), kind: opt(z.enum(['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO'])), code: opt(str(40)), vat_number: opt(str(20)), tax_code: opt(str(20)),
    sdi: opt(str(10)), pec: email, email, phone: opt(str(40)), address: opt(str(200)), zip: opt(str(10)), city: opt(str(80)), province: opt(str(4)), website: opt(str(200)), active: opt(z.boolean()),
  }),
  events: z.object({
    title: str(200).min(2), description: opt(str(4000)), kind: opt(z.enum(['EVENTO', 'RIUNIONE', 'FORMAZIONE', 'SCADENZA', 'TURNO', 'FESTIVITA', 'ALTRO'])),
    starts_at: z.string().datetime({ offset: true }), ends_at: opt(z.string().datetime({ offset: true })), all_day: opt(z.boolean()), location: opt(str(200)),
    site_code: opt(str(24)), audience: opt(z.object({ type: z.enum(['ALL', 'INTERNAL', 'SITES', 'ORGS', 'MODULE', 'USERS']), ids: z.array(z.number().int()).optional(), key: z.string().optional() })),
    external_id: str(120).min(1), link: opt(str(500)),
  }),
  news: z.object({
    title: str(200).min(2), kind: opt(z.enum(['NEWS', 'CIRCOLARE', 'BLOG'])), summary: opt(str(600)), body: z.string().min(1).max(200_000), tags: opt(z.array(str(40)).max(20)),
    requires_ack: opt(z.boolean()), is_public: opt(z.boolean()), external_id: opt(str(120)),
    audience: opt(z.object({ type: z.enum(['ALL', 'INTERNAL', 'SITES', 'ORGS', 'MODULE', 'USERS']), ids: z.array(z.number().int()).optional(), key: z.string().optional() })),
  }),
};
const batchSchema = z.object({
  batch_uid: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9_.:-]+$/, 'caratteri ammessi: lettere, numeri, punto, due punti, trattino'),
  source: z.string().trim().min(2).max(40).optional(),
  manifest: z.record(z.any()).optional(),
  rows: z.array(z.any()),
});

const zodMsg = (e) => e.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; ');
const refs = (k, row) => (row.external_id ? JSON.stringify({ [`ingest:${k.source}`]: row.external_id }) : '{}');

// ---- applicazione riga per riga (ogni riga in un savepoint: un errore non blocca le altre)
export const APPLIERS = {
  async people(c, row, k) {
    const site = row.site_code ? (await c.query('SELECT id FROM sites WHERE lower(code)=lower($1)', [row.site_code])).rows[0] : null;
    if (row.site_code && !site) throw new Error(`sede ${row.site_code} inesistente`);
    const cf = row.tax_code ? row.tax_code.toUpperCase() : null;
    let ex = null;
    if (cf) ex = (await c.query('SELECT id FROM people WHERE upper(tax_code)=$1', [cf])).rows[0];
    if (!ex && row.email) ex = (await c.query('SELECT id FROM people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [row.email])).rows[0];
    if (!ex && row.external_id) ex = (await c.query(`SELECT id FROM people WHERE legacy_refs->>$1 = $2`, [`ingest:${k.source}`, row.external_id])).rows[0];
    // senza email né codice fiscale: stessa persona = stesso cognome e nome (accenti e maiuscole ignorati); gli omonimi vanno distinti con email o CF
    if (!ex) ex = (await c.query(`SELECT id FROM people WHERE lower(unaccent(last_name))=lower(unaccent($1)) AND lower(unaccent(first_name))=lower(unaccent($2)) AND ($3::text IS NULL OR email IS NULL OR lower(email)=$3) AND ($4::text IS NULL OR tax_code IS NULL OR upper(tax_code)=$4) ORDER BY id LIMIT 1`, [row.last_name, row.first_name, row.email || null, cf])).rows[0];
    // ruolo dal catalogo (creato se manca: il caricamento iniziale popola il catalogo, poi si governa da Amministrazione)
    let roleId = null;
    if (row.job_title) { const ex0 = (await c.query('SELECT id, name FROM job_roles WHERE lower(name)=lower($1)', [row.job_title.trim()])).rows[0]; const r0 = ex0 || (await c.query('INSERT INTO job_roles (name) VALUES ($1) RETURNING id, name', [row.job_title.trim()])).rows[0]; roleId = r0.id; row.job_title = r0.name; }
    // reparto: dipende dalla sede; creato se manca
    let unitId = null;
    if (row.unit) { const sid = site?.id || k.site_id; if (!sid) throw new Error(`reparto "${row.unit}" indicato senza sede`); unitId = await ensureUnit(c, sid, row.unit); }
    const manager = row.manager_email ? (await c.query('SELECT id FROM people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [row.manager_email])).rows[0] : null;
    if (row.manager_email && !manager) throw new Error(`responsabile ${row.manager_email} non trovato: caricalo prima (o nella stessa lista, più in alto)`);
    const vals = [row.last_name, row.first_name, row.email || null, cf, row.kind || null, row.status || null, row.area || null, row.job_title || null, row.discipline || null, row.title || null,
      site?.id || k.site_id || null, row.phone || null, row.phone_office || null, row.hired_at || null, row.terminated_at || null, refs(k, row), row.phone_ext || null, manager?.id || null, roleId, unitId];
    if (ex) {
      await c.query(`UPDATE people SET last_name=$2, first_name=$3, email=coalesce($4,email), tax_code=coalesce($5,tax_code), kind=coalesce($6,kind), status=coalesce($7,status), area=coalesce($8,area),
        job_title=coalesce($9,job_title), discipline=coalesce($10,discipline), title=coalesce($11,title), site_id=coalesce($12,site_id), phone=coalesce($13,phone), phone_office=coalesce($14,phone_office),
        hired_at=coalesce($15,hired_at), terminated_at=coalesce($16,terminated_at), legacy_refs=legacy_refs || $17::jsonb, phone_ext=coalesce($18,phone_ext), manager_person_id=coalesce($19,manager_person_id), role_id=coalesce($20,role_id), unit_id=coalesce($21,unit_id), updated_at=now() WHERE id=$1`, [ex.id, ...vals]);
      await c.query(SYNC_USER_SQL, [ex.id]);
      if (unitId) await upsertPosition(c, { unit_id: unitId, person_id: ex.id, role_id: roleId || null, is_head: false });
      return { id: ex.id, action: 'aggiornata' };
    }
    const ins = await c.query(`INSERT INTO people (last_name, first_name, email, tax_code, kind, status, area, job_title, discipline, title, site_id, phone, phone_office, hired_at, terminated_at, legacy_refs, phone_ext, manager_person_id, role_id, unit_id)
      VALUES ($1,$2,$3,$4,coalesce($5,'DIPENDENTE'),coalesce($6,'ATTIVO'),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`, vals);
    // l'utente con la stessa email (se già esiste, es. il titolare) viene agganciato alla persona
    if (row.email) await c.query(`UPDATE users SET person_id=$1, site_id=coalesce(site_id,$3), first_name=$4, last_name=$5, full_name=$6, updated_at=now() WHERE lower(email)=$2 AND person_id IS NULL`, [ins.rows[0].id, row.email, site?.id || null, row.first_name, row.last_name, `${row.last_name} ${row.first_name}`]);
    await c.query(SYNC_USER_SQL, [ins.rows[0].id]);
    if (unitId) await upsertPosition(c, { unit_id: unitId, person_id: ins.rows[0].id, role_id: roleId || null, is_head: false });
    return { id: ins.rows[0].id, action: 'creata' };
  },
  async sites(c, row, k) {
    const org = row.organization_code ? (await c.query('SELECT id FROM organizations WHERE lower(code)=lower($1)', [row.organization_code])).rows[0] : null;
    if (row.organization_code && !org) throw new Error(`organizzazione ${row.organization_code} inesistente`);
    const ex = (await c.query('SELECT id FROM sites WHERE lower(code)=lower($1)', [row.code])).rows[0];
    const vals = [row.name, row.short_name || null, row.kind || null, org?.id || null, row.address || null, row.zip || null, row.city || null, row.province || null, row.lat ?? null, row.lng ?? null,
      row.phone || null, row.email || null, row.manager_name || null, row.opening_hours || null, row.studiolab_code || null, row.legacy_brand || null, row.active ?? null, JSON.stringify({ [`ingest:${k.source}`]: row.code })];
    if (ex) {
      await c.query(`UPDATE sites SET name=$2, short_name=coalesce($3,short_name), kind=coalesce($4,kind), organization_id=coalesce($5,organization_id), address=coalesce($6,address), zip=coalesce($7,zip), city=coalesce($8,city),
        province=coalesce($9,province), lat=coalesce($10,lat), lng=coalesce($11,lng), phone=coalesce($12,phone), email=coalesce($13,email), manager_name=coalesce($14,manager_name), opening_hours=coalesce($15,opening_hours),
        studiolab_code=coalesce($16,studiolab_code), legacy_brand=coalesce($17,legacy_brand), active=coalesce($18,active), legacy_refs=legacy_refs || $19::jsonb, updated_at=now() WHERE id=$1`, [ex.id, ...vals]);
      return { id: ex.id, action: 'aggiornata' };
    }
    const ins = await c.query(`INSERT INTO sites (code, name, short_name, kind, organization_id, address, zip, city, province, lat, lng, phone, email, manager_name, opening_hours, studiolab_code, legacy_brand, active, legacy_refs)
      VALUES ($1,$2,$3,coalesce($4,'PUNTO_PRELIEVI'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,coalesce($18,TRUE),$19) RETURNING id`, [row.code, ...vals]);
    return { id: ins.rows[0].id, action: 'creata' };
  },
  async organizations(c, row, k) {
    let ex = null;
    const vat = row.vat_number ? row.vat_number.replace(/\s+/g, '') : null;
    // Un'organizzazione è una legal entity: una riga per partita IVA. I punti (codici StudioLAB) sono sedi che la referenziano.
    if (vat) ex = (await c.query(`SELECT id FROM organizations WHERE regexp_replace(coalesce(vat_number,''), '\\s', '', 'g') = $1`, [vat])).rows[0];
    if (!ex && row.code) ex = (await c.query('SELECT id FROM organizations WHERE lower(code)=lower($1)', [row.code])).rows[0];
    if (!ex && row.tax_code) ex = (await c.query('SELECT id FROM organizations WHERE upper(tax_code)=upper($1)', [row.tax_code])).rows[0];
    if (!ex) ex = (await c.query('SELECT id FROM organizations WHERE lower(name)=lower($1)', [row.name])).rows[0];
    const vals = [row.name, row.kind || null, row.code || null, vat, row.tax_code || null, row.sdi || null, row.pec || null, row.email || null, row.phone || null, row.address || null, row.zip || null, row.city || null, row.province || null, row.website || null, row.active ?? null, JSON.stringify({ [`ingest:${k.source}`]: row.code || row.vat_number || row.name })];
    if (ex) {
      await c.query(`UPDATE organizations SET name=$2, kind=coalesce($3,kind), code=coalesce(code,$4), vat_number=coalesce($5,vat_number), tax_code=coalesce($6,tax_code), sdi=coalesce($7,sdi), pec=coalesce($8,pec), email=coalesce($9,email),
        phone=coalesce($10,phone), address=coalesce($11,address), zip=coalesce($12,zip), city=coalesce($13,city), province=coalesce($14,province), website=coalesce($15,website), active=coalesce($16,active), legacy_refs=legacy_refs || $17::jsonb, updated_at=now() WHERE id=$1`, [ex.id, ...vals]);
      return { id: ex.id, action: 'aggiornata' };
    }
    const ins = await c.query(`INSERT INTO organizations (name, kind, code, vat_number, tax_code, sdi, pec, email, phone, address, zip, city, province, website, active, legacy_refs)
      VALUES ($1,coalesce($2,'CLIENTE'),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15,TRUE),$16) RETURNING id`, vals);
    return { id: ins.rows[0].id, action: 'creata' };
  },
  async events(c, row, k) {
    const site = row.site_code ? (await c.query('SELECT id FROM sites WHERE lower(code)=lower($1)', [row.site_code])).rows[0] : null;
    if (row.site_code && !site) throw new Error(`sede ${row.site_code} inesistente`);
    const source = 'SYSTEM';
    const extId = `${k.source}:${row.external_id}`;
    const ins = await c.query(`INSERT INTO events (title, description, kind, starts_at, ends_at, all_day, location, site_id, audience, source, external_id, link)
      VALUES ($1,$2,coalesce($3,'EVENTO'),$4,$5,coalesce($6,FALSE),$7,$8,$9,$10,$11,$12)
      ON CONFLICT (source, external_id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, kind=EXCLUDED.kind, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, all_day=EXCLUDED.all_day,
        location=EXCLUDED.location, site_id=EXCLUDED.site_id, audience=EXCLUDED.audience, link=EXCLUDED.link, updated_at=now() RETURNING id, (xmax = 0) AS inserted`,
      [row.title, row.description || null, row.kind || null, row.starts_at, row.ends_at || null, row.all_day ?? null, row.location || null, site?.id || k.site_id || null,
        JSON.stringify(row.audience || (k.site_id ? { type: 'SITES', ids: [k.site_id] } : { type: 'ALL' })), source, extId, row.link || null]);
    return { id: ins.rows[0].id, action: ins.rows[0].inserted ? 'creato' : 'aggiornato' };
  },
  async news(c, row, k) {
    // Le news importate nascono come bozze: la Comunicazione le rivede e le pubblica dalla Suite
    const extKey = `ingest:${k.source}`;
    const ex = row.external_id ? (await c.query(`SELECT id FROM news WHERE status='DRAFT' AND tags @> ARRAY[$1]::text[]`, [`${extKey}=${row.external_id}`])).rows[0] : null;
    const tags = [...(row.tags || []), ...(row.external_id ? [`${extKey}=${row.external_id}`] : [])];
    if (ex) {
      await c.query(`UPDATE news SET title=$2, kind=coalesce($3,kind), summary=$4, body=$5, tags=$6, requires_ack=coalesce($7,requires_ack), is_public=coalesce($8,is_public), audience=coalesce($9,audience), updated_at=now() WHERE id=$1`,
        [ex.id, row.title, row.kind || null, row.summary || null, row.body, tags, row.requires_ack ?? null, row.is_public ?? null, row.audience ? JSON.stringify(row.audience) : null]);
      return { id: ex.id, action: 'aggiornata' };
    }
    let slug = slugify(row.title); const base = slug; let i = 1;
    while ((await c.query('SELECT 1 FROM news WHERE slug=$1', [slug])).rowCount) slug = `${base}-${++i}`;
    const ins = await c.query(`INSERT INTO news (kind, title, slug, summary, body, audience, status, requires_ack, is_public, tags) VALUES (coalesce($1,'NEWS'),$2,$3,$4,$5,$6,'DRAFT',coalesce($7,FALSE),coalesce($8,FALSE),$9) RETURNING id`,
      [row.kind || null, row.title, slug, row.summary || null, row.body, JSON.stringify(row.audience || { type: 'ALL' }), row.requires_ack ?? null, row.is_public ?? null, tags]);
    return { id: ins.rows[0].id, action: 'creata' };
  },
};

export async function applyBatch(batchId, dataset, rows, k) {
  const schema = ROW_SCHEMAS[dataset];
  const errors = []; const applied = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const parsed = schema.safeParse(rows[i]);
      if (!parsed.success) { errors.push({ row: i, error: zodMsg(parsed.error) }); continue; }
      await c.query('SAVEPOINT riga');
      try {
        const out = await APPLIERS[dataset](c, parsed.data, k);
        await c.query('RELEASE SAVEPOINT riga');
        applied.push({ row: i, ...out });
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT riga');
        errors.push({ row: i, error: e.code === '23505' ? 'elemento duplicato (vincolo di unicità)' : e.message.slice(0, 300) });
      }
    }
    const ok = applied.length, rej = errors.length;
    const status = ok === 0 && rej > 0 ? 'REJECTED' : rej > 0 ? 'PARTIAL' : 'APPLIED';
    const result = { errors, applied: applied.slice(0, MAX_ROWS), summary: { creati: applied.filter((a) => /^cre/.test(a.action)).length, aggiornati: applied.filter((a) => /^agg/.test(a.action)).length } };
    await c.query(`UPDATE ingest_batches SET status=$2, applied_at=now(), rows_ok=$3, rows_rejected=$4, result=$5 WHERE id=$1`, [batchId, status, ok, rej, JSON.stringify(result)]);
    await c.query('COMMIT');
    return { status, rows_ok: ok, rows_rejected: rej, errors };
  } catch (e) {
    await c.query('ROLLBACK');
    await q(`UPDATE ingest_batches SET status='REJECTED', applied_at=now(), rows_ok=0, rows_rejected=$2, error=$3 WHERE id=$1`, [batchId, rows.length, e.message.slice(0, 500)]);
    throw e;
  } finally { c.release(); }
}

const batchView = (b) => ({ batch_id: b.id, batch_uid: b.batch_uid, status: b.status, dataset: b.dataset, rows_total: b.rows_total, rows_ok: b.rows_ok, rows_rejected: b.rows_rejected, errors: b.result?.errors || [], received_at: b.received_at, applied_at: b.applied_at });

// ---- file (multipart): campo "file" + batch_uid, folder. Contenuto su Azure Blob tramite lib/blob.js se presente e configurato
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
r.post('/files', requireScope('files'), (req, res, next) => upload.single('file')(req, res, (e) => (e ? next(err(400, e.code === 'LIMIT_FILE_SIZE' ? `File troppo grande (massimo ${config.maxUploadMb} MB)` : e.message, 'UPLOAD_ERROR')) : next())), ah(async (req, res) => {
  const k = req.apiKey;
  const b = z.object({ batch_uid: batchSchema.shape.batch_uid, folder: z.string().trim().max(120).optional(), source: z.string().optional() }).safeParse(req.body || {});
  if (!b.success) throw err(400, `Dati non validi. ${zodMsg(b.error)}`, 'VALIDATION');
  if (!req.file) throw err(400, 'Nessun file ricevuto (campo multipart "file")', 'FILE_MISSING');
  const dup = await one('SELECT * FROM ingest_batches WHERE batch_uid=$1', [b.data.batch_uid]);
  if (dup) return res.json({ ...batchView(dup), status: 'DUPLICATE' });
  if (!config.blob.enabled) throw err(503, 'Archiviazione file non configurata (AZURE_STORAGE_CONNECTION_STRING assente)', 'BLOB_DISABLED');
  let blob;
  try { blob = await import('../lib/blob.js'); } catch { throw err(503, 'Modulo di archiviazione file non disponibile', 'BLOB_DISABLED'); }
  const digest = sha256(req.file.buffer);
  const folder = b.data.folder || k.source.toLowerCase();
  const filename = req.file.originalname.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 200);
  const batch = await one(`INSERT INTO ingest_batches (batch_uid, source, dataset, api_key_id, site_id, status, rows_total, checksum, manifest) VALUES ($1,$2,'files',$3,$4,'RECEIVED',1,$5,$6) RETURNING *`,
    [b.data.batch_uid, k.source, k.id, k.site_id, digest, JSON.stringify({ filename, mime: req.file.mimetype, size: req.file.size, folder })]);
  try {
    let fileRow;
    if (typeof blob.uploadFile === 'function') {
      fileRow = await blob.uploadFile({ buffer: req.file.buffer, filename, mime: req.file.mimetype || 'application/octet-stream', size: req.file.size, scope: 'INGEST', folder, ownerUserId: null, sha256: digest });
    } else if (typeof blob.putBlob === 'function') {
      const blobPath = `ingest/${k.source.toLowerCase()}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${filename}`;
      await blob.putBlob(blobPath, req.file.buffer, req.file.mimetype || 'application/octet-stream');
      fileRow = await one(`INSERT INTO files (scope, owner_user_id, blob_path, filename, mime, size, sha256, folder) VALUES ('INGEST',NULL,$1,$2,$3,$4,$5,$6) RETURNING id`, [blobPath, filename, req.file.mimetype || 'application/octet-stream', req.file.size, digest, folder]);
    } else {
      throw Object.assign(new Error('Il modulo di archiviazione non espone uploadFile o putBlob'), { code: 'BLOB_DISABLED', status: 503 });
    }
    const result = { file_id: fileRow.id, filename, size: req.file.size, sha256: digest, folder };
    await q(`UPDATE ingest_batches SET status='APPLIED', applied_at=now(), rows_ok=1, result=$2 WHERE id=$1`, [batch.id, JSON.stringify(result)]);
    await auditIngest(req, 'INGEST_FILE', { batch_id: batch.id, batch_uid: batch.batch_uid, ...result });
    res.status(201).json({ batch_id: batch.id, status: 'APPLIED', rows_total: 1, rows_ok: 1, rows_rejected: 0, errors: [], file: result });
  } catch (e) {
    await q(`UPDATE ingest_batches SET status='REJECTED', applied_at=now(), rows_rejected=1, error=$2 WHERE id=$1`, [batch.id, e.message.slice(0, 500)]);
    if (e.code === 'BLOB_DISABLED') throw err(503, e.message, 'BLOB_DISABLED');
    throw e;
  }
}));

// ---- lotti JSON: dataset noti applicati riga per riga, dataset sconosciuti solo registrati (RECEIVED)
r.post('/:dataset', ah(async (req, res) => {
  const dataset = String(req.params.dataset || '').toLowerCase();
  if (!/^[a-z0-9_:-]{2,40}$/.test(dataset)) throw err(400, 'Nome del dataset non valido', 'VALIDATION');
  if (!hasScope(req.apiKey, dataset)) throw err(403, `La chiave non ha il permesso ingest:${dataset}`, 'SCOPE_DENIED');
  const k = req.apiKey;
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) throw err(400, `Dati non validi. ${zodMsg(parsed.error)}`, 'VALIDATION');
  const b = parsed.data;
  if (b.rows.length > MAX_ROWS) throw err(413, `Troppe righe nel lotto: massimo ${MAX_ROWS}, ricevute ${b.rows.length}. Spezza il lotto.`, 'TOO_MANY_ROWS');
  const checksum = sha256(JSON.stringify(req.body));
  const dup = await one('SELECT * FROM ingest_batches WHERE batch_uid=$1', [b.batch_uid]);
  if (dup) {
    await auditIngest(req, 'INGEST_DUPLICATE', { batch_id: dup.id, batch_uid: dup.batch_uid, dataset, same_content: dup.checksum === checksum });
    return res.json({ ...batchView(dup), status: 'DUPLICATE', original_status: dup.status });
  }
  const source = k.source;
  const batch = await one(`INSERT INTO ingest_batches (batch_uid, source, dataset, api_key_id, site_id, status, rows_total, checksum, manifest) VALUES ($1,$2,$3,$4,$5,'RECEIVED',$6,$7,$8) RETURNING *`,
    [b.batch_uid, source, dataset, k.id, k.site_id, b.rows.length, checksum, JSON.stringify({ ...(b.manifest || {}), declared_source: b.source || null })]);
  if (!APPLIERS[dataset]) {
    // Dataset per moduli futuri: conservato così com'è (max 1000 righe), nessuna applicazione
    await q(`UPDATE ingest_batches SET result=$2 WHERE id=$1`, [batch.id, JSON.stringify({ rows: b.rows.slice(0, MAX_ROWS) })]);
    await auditIngest(req, 'INGEST_RECEIVED', { batch_id: batch.id, batch_uid: b.batch_uid, dataset, rows: b.rows.length });
    return res.status(202).json({ batch_id: batch.id, status: 'RECEIVED', rows_total: b.rows.length, rows_ok: 0, rows_rejected: 0, errors: [], note: 'Dataset non ancora gestito: lotto registrato per i moduli futuri' });
  }
  const out = await applyBatch(batch.id, dataset, b.rows, k);
  await auditIngest(req, 'INGEST_APPLIED', { batch_id: batch.id, batch_uid: b.batch_uid, dataset, status: out.status, rows_total: b.rows.length, rows_ok: out.rows_ok, rows_rejected: out.rows_rejected });
  res.status(201).json({ batch_id: batch.id, status: out.status, rows_total: b.rows.length, rows_ok: out.rows_ok, rows_rejected: out.rows_rejected, errors: out.errors });
}));

// Errori di questo router: nessuna sessione, risposta JSON uniforme
r.use((e, _req, res, _next) => {
  const status = e.status || (e.type === 'entity.too.large' ? 413 : 500);
  const generic = status >= 500 && !e.code;   // i 503 con codice (BLOB_DISABLED) portano il messaggio chiaro
  if (generic) console.error('[ingest]', e);
  res.status(status).json({ error: generic ? 'Errore interno del server' : e.message, code: e.code, details: e.details });
});

export default r;
