// Caricamento delle anagrafiche da file XLSX (Amministrazione > Importazioni). La Suite parte vuota e si popola una volta sola:
// Sedi, Organizzazioni, Persone, Utenti con moduli e profili. Modelli scaricabili con foglio "Istruzioni" e valori ammessi.
// Riusa schemi e appliers dell'API di ingestione (stesso lotto in ingest_batches, sorgente "xlsx").
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, HttpError, audit, displayName } from '../lib/util.js';
import { requireAdmin, requireOwner } from '../lib/access.js';
import { sendMail, layout } from '../lib/mailer.js';
import { ROW_SCHEMAS, APPLIERS, applyBatch } from './ingest.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const bad = (m) => new HttpError(400, m);

const SITE_KINDS = ['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO'];
const ORG_KINDS = ['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO'];
const PERSON_KINDS = ['DIPENDENTE', 'LP', 'MEDICO', 'SANITARIO', 'ESTERNO', 'DIRIGENTE'];
const PERSON_STATUS = ['CANDIDATO', 'IMPEGNO', 'ATTIVO', 'CESSATO'];

// Colonne dei modelli: chiave tecnica (intestazione), etichetta e spiegazione in italiano, valori ammessi
const DATASETS = {
  sites: {
    title: 'Sedi', sheet: 'Sedi', order: 2,
    columns: [
      ['code', 'Codice', 'Codice breve univoco della sede (es. FI-CEC). Obbligatorio. È la chiave con cui le persone e gli utenti vengono collegati alla sede.'],
      ['name', 'Denominazione', 'Nome completo della sede. Obbligatorio.'],
      ['short_name', 'Nome breve', 'Nome corto per i menu e i widget.'],
      ['kind', 'Tipo', `Uno tra: ${SITE_KINDS.join(', ')}. Predefinito PUNTO_PRELIEVI. Le strutture dei clienti service hanno tipo SERVICE.`],
      ['organization_code', 'Codice organizzazione', 'Codice dell\'organizzazione proprietaria (foglio Organizzazioni), per le strutture dei clienti service o delle società del gruppo.'],
      ['address', 'Indirizzo', 'Via e numero civico.'], ['zip', 'CAP', ''], ['city', 'Città', 'Usata anche per il meteo.'], ['province', 'Provincia', 'Sigla (FI, PO, PT...).'],
      ['phone', 'Telefono', ''], ['email', 'Email', ''], ['manager_name', 'Responsabile di sede', 'Nome e cognome del site manager.'],
      ['opening_hours', 'Orari di apertura', 'Testo libero, es. "Lun-Ven 7:30-12:30, Sab 7:30-11:00".'],
      ['studiolab_code', 'Codice StudioLAB', 'Codice della sede nel LIS StudioLAB (riconoscimento HL7, ordini, NC).'],
      ['active', 'Attiva', 'SI oppure NO. Predefinito SI.'],
    ],
    example: ['ES-01', 'Esempio · Punto prelievi Esempiopoli', 'Esempiopoli', 'PUNTO_PRELIEVI', '', 'Via dell\'Esempio 1', '00000', 'Esempiopoli', 'XX', '000 0000000', 'esempio@esempio.it', 'Mario Esempio', 'Lun-Ven 7:30-12:30', 'ESE', 'SI'],
  },
  organizations: {
    title: 'Organizzazioni e clienti', sheet: 'Organizzazioni', order: 1,
    columns: [
      ['code', 'Codice', 'Codice breve univoco (es. TD, LAB-SCANDICCI). Consigliato: serve per collegare le sedi.'],
      ['name', 'Ragione sociale', 'Obbligatoria.'],
      ['kind', 'Tipo', `Uno tra: ${ORG_KINDS.join(', ')}. CLIENTE = laboratorio o struttura cliente del service; SOCIETA = società del gruppo; TARGET = acquisizione in corso.`],
      ['studiolab_code', 'Codice StudioLAB', 'Codice cliente nel LIS StudioLAB. Per i clienti del service è la chiave: due codici con la stessa partita IVA sono due organizzazioni distinte. Per ogni codice la Suite crea da sola la sede operativa gemella (tipo SERVICE), che non va messa nel file Sedi.'],
      ['vat_number', 'Partita IVA', 'Senza spazi. Riconosce l\'organizzazione se già presente (quando non c\'è il codice StudioLAB).'], ['tax_code', 'Codice fiscale', ''],
      ['sdi', 'Codice SDI', ''], ['pec', 'PEC', ''], ['email', 'Email', ''], ['phone', 'Telefono', ''],
      ['address', 'Indirizzo', ''], ['zip', 'CAP', ''], ['city', 'Città', ''], ['province', 'Provincia', 'Sigla.'], ['website', 'Sito web', ''],
      ['active', 'Attiva', 'SI oppure NO. Predefinito SI.'],
    ],
    example: ['ESEMPIO', 'Esempio S.r.l.', 'CLIENTE', 'ES001', '00000000000', '', '', 'esempio@pec.it', 'info@esempio.it', '000 0000000', 'Via dell\'Esempio 1', '00000', 'Esempiopoli', 'XX', 'https://www.esempio.it', 'SI'],
  },
  people: {
    title: 'Persone', sheet: 'Persone', order: 3,
    columns: [
      ['last_name', 'Cognome', 'Obbligatorio.'], ['first_name', 'Nome', 'Obbligatorio.'], ['title', 'Titolo', 'Dott., Dott.ssa, Ing. ...'],
      ['email', 'Email', 'Email aziendale: è la chiave che collega la persona al suo utente e al responsabile. Senza email la persona compare in Rubrica ma non può avere un accesso.'],
      ['tax_code', 'Codice fiscale', 'Usato per riconoscere la persona se già presente.'],
      ['kind', 'Tipo', `Uno tra: ${PERSON_KINDS.join(', ')}. Predefinito DIPENDENTE. MEDICO e SANITARIO sono i professionisti di Room Planning.`],
      ['status', 'Stato', `Uno tra: ${PERSON_STATUS.join(', ')}. Predefinito ATTIVO.`],
      ['area', 'Area organizzativa', 'Es. Direzione Generale, Lab Operations Management, Retail. Compare nella Rubrica e nell\'organigramma.'],
      ['job_title', 'Ruolo', 'Mansione o incarico, breve (es. Site Manager, Tecnico di laboratorio biomedico).'],
      ['discipline', 'Disciplina', 'Per medici e professionisti: Ginecologia, Cardiologia...'],
      ['site_code', 'Codice sede', 'Sede di lavoro principale (foglio Sedi).'],
      ['manager_email', 'Email del responsabile', 'Email della persona a cui riporta: deve essere già caricata o comparire più in alto nella stessa lista.'],
      ['phone', 'Cellulare', ''], ['phone_office', 'Telefono ufficio', ''], ['phone_ext', 'Interno centralino', 'Es. 101.'],
      ['hired_at', 'Data di assunzione', 'AAAA-MM-GG.'], ['terminated_at', 'Data di cessazione', 'AAAA-MM-GG.'],
    ],
    example: ['Esempio', 'Mario', 'Dott.', 'mario.esempio@esempio.it', '', 'DIPENDENTE', 'ATTIVO', 'Area di esempio', 'Ruolo di esempio', '', 'ES-01', '', '000 0000000', '000 0000000', '100', '2026-01-01', ''],
  },
  users: {
    title: 'Utenti e profili', sheet: 'Utenti', order: 4,
    columns: [
      ['email', 'Email', 'Obbligatoria. Se esiste una persona con la stessa email, l\'utente viene collegato a lei (nome, sede, ruolo).'],
      ['last_name', 'Cognome', 'Facoltativo se la persona esiste già.'], ['first_name', 'Nome', 'Facoltativo se la persona esiste già.'],
      ['level', 'Livello', 'USER (predefinito) oppure ADMIN. Il titolare è unico e non si importa.'],
      ['auth', 'Accesso', 'ENTRA = Microsoft 365 (predefinito per le email dei domini aziendali), LOCAL = credenziali locali con password provvisoria inviata via email (esterni).'],
      ['site_code', 'Codice sede', 'Sede principale dell\'utente (meteo, perimetro predefinito).'],
      ['grants', 'Moduli e profili', 'Elenco separato da punto e virgola: modulo:PROFILO oppure modulo:PROFILO:SEDE1|SEDE2 per i profili di sede. Esempio: cash:CASSIERE:FI-CEC|FI-NOV; nc:SEDE:FI-CEC; room:PROF. Moduli e profili ammessi nel foglio "Moduli".'],
      ['send_invite', 'Invia invito', 'SI per inviare l\'email di benvenuto (con password provvisoria per gli accessi LOCAL). Predefinito NO.'],
    ],
    example: ['mario.esempio@esempio.it', 'Esempio', 'Mario', 'USER', 'LOCAL', 'ES-01', 'cash:CASSIERE:ES-01; nc:SEDE:ES-01; room:PROF', 'NO'],
  },
};

const usersRowSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  last_name: z.string().trim().max(60).optional().nullable(), first_name: z.string().trim().max(60).optional().nullable(),
  level: z.enum(['USER', 'ADMIN']).optional().nullable(), auth: z.enum(['ENTRA', 'LOCAL']).optional().nullable(),
  site_code: z.string().trim().max(24).optional().nullable(), grants: z.string().trim().max(2000).optional().nullable(), send_invite: z.boolean().optional().nullable(),
});
const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}A1!`;

// Utente + grant: una riga per utente. I moduli e i profili sono validati sul catalogo; le sedi sui codici dell'anagrafica.
async function applyUserRow(c, row, ctx) {
  const email = row.email;
  const person = (await c.query('SELECT id, last_name, first_name, site_id FROM people WHERE lower(email)=$1 ORDER BY id LIMIT 1', [email])).rows[0] || null;
  const last = row.last_name || person?.last_name, first = row.first_name || person?.first_name;
  if (!last || !first) throw new Error('cognome e nome mancanti e nessuna persona con questa email');
  const internal = config.autoInternalDomains.includes(email.split('@')[1]);
  const provider = row.auth || (internal ? 'ENTRA' : 'LOCAL');
  const site = row.site_code ? (await c.query('SELECT id FROM sites WHERE lower(code)=lower($1)', [row.site_code])).rows[0] : null;
  if (row.site_code && !site) throw new Error(`sede ${row.site_code} inesistente`);
  // grant: "modulo:PROFILO[:SEDE|SEDE]; ..."
  const grants = [];
  for (const part of String(row.grants || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [mk, prof, scopes] = part.split(':').map((x) => (x || '').trim());
    const m = ctx.modules.get(mk.toLowerCase());
    if (!m) throw new Error(`modulo "${mk}" inesistente`);
    const p = (m.profiles || []).find((x) => x.key.toLowerCase() === (prof || '').toLowerCase());
    if (!p) throw new Error(`profilo "${prof}" non previsto dal modulo ${m.key} (ammessi: ${(m.profiles || []).map((x) => x.key).join(', ')})`);
    if (m.restricted && !ctx.owner) throw new Error(`il modulo ${m.key} è riservato: solo il titolare lo assegna`);
    const ids = [];
    for (const code of (scopes || '').split('|').map((x) => x.trim()).filter(Boolean)) {
      const s = (await c.query('SELECT id FROM sites WHERE lower(code)=lower($1)', [code])).rows[0];
      if (!s) throw new Error(`sede ${code} inesistente (grant ${m.key})`);
      ids.push(s.id);
    }
    if (p.scoped && !ids.length) throw new Error(`il profilo ${p.key} di ${m.key} richiede almeno una sede (modulo:PROFILO:SEDE)`);
    grants.push({ module_key: m.key, profile: p.key, scope_type: m.scope_type || 'SITE', ids });
  }
  const ex = (await c.query('SELECT id, level FROM users WHERE lower(email)=$1', [email])).rows[0];
  let plain = null; let userId; let action;
  if (ex) {
    if (ex.level === 'OWNER') throw new Error('il titolare non si modifica da file');
    await c.query(`UPDATE users SET last_name=$2, first_name=$3, full_name=$4, level=coalesce($5, level), site_id=coalesce($6, site_id), person_id=coalesce($7, person_id), updated_at=now() WHERE id=$1`,
      [ex.id, last, first, displayName(last, first), row.level || null, site?.id || person?.site_id || null, person?.id || null]);
    userId = ex.id; action = 'aggiornato';
  } else {
    plain = provider === 'LOCAL' ? genPassword() : null;
    const ins = await c.query(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, site_id, person_id, password_hash, must_change_password, created_by)
      VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11) RETURNING id`,
      [email, displayName(last, first), first, last, row.level || 'USER', provider, site?.id || person?.site_id || null, person?.id || null, plain ? await bcrypt.hash(plain, 12) : null, Boolean(plain), ctx.userId]);
    userId = ins.rows[0].id; action = 'creato';
  }
  for (const g of grants) {
    const { rows: [gr] } = await c.query(`INSERT INTO grants (user_id, module_key, profile, proposed, source, created_by) VALUES ($1,$2,$3,FALSE,'MANUAL',$4)
      ON CONFLICT (user_id, module_key) DO UPDATE SET profile=EXCLUDED.profile, proposed=FALSE, source='MANUAL', updated_at=now() RETURNING id`, [userId, g.module_key, g.profile, ctx.userId]);
    await c.query('DELETE FROM grant_scopes WHERE grant_id=$1', [gr.id]);
    for (const id of g.ids) await c.query('INSERT INTO grant_scopes (grant_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [gr.id, g.scope_type, id]);
  }
  if (row.send_invite) {
    const hint = provider === 'ENTRA' ? `<p>Accedi con il tuo account Microsoft 365 aziendale: <a href="${config.baseUrl}">${config.baseUrl}</a></p>`
      : `<p>Accedi su <a href="${config.baseUrl}">${config.baseUrl}</a> con questa email e la password provvisoria <code>${plain || '(già impostata)'}</code>: al primo accesso dovrai sceglierne una nuova.</p>`;
    sendMail({ to: email, subject: 'Benvenuto in Suite TD', ref: `invite:${userId}`, html: layout(`Benvenuto, ${first}`, `<p>È stato creato il tuo accesso a <b>Suite TD</b>, l'intranet e operating suite di Toscana Diagnostica.</p>${hint}`) }).catch((e) => console.warn('[import] invito non inviato:', e.message));
  }
  return { id: userId, action, grants: grants.length };
}

// ---- Modelli XLSX
r.get('/import/templates/:dataset', requireAdmin, ah(async (req, res) => {
  const d = DATASETS[req.params.dataset];
  if (!d) throw new HttpError(404, 'Modello inesistente');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD';
  const ws = wb.addWorksheet(d.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = d.columns.map(([key, label]) => ({ header: key, key, width: Math.max(14, Math.min(40, label.length + 6)) }));
  ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0F2' } };
  ws.addRow(d.example);
  ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7F85' } };
  // Validazioni a tendina per i campi con valori ammessi
  const lists = { kind: req.params.dataset === 'sites' ? SITE_KINDS : req.params.dataset === 'organizations' ? ORG_KINDS : PERSON_KINDS, status: PERSON_STATUS, active: ['SI', 'NO'], send_invite: ['SI', 'NO'], level: ['USER', 'ADMIN'], auth: ['ENTRA', 'LOCAL'] };
  d.columns.forEach(([key], i) => {
    if (!lists[key]) return;
    const col = ws.getColumn(i + 1).letter;
    for (let row = 2; row <= 1001; row++) ws.getCell(`${col}${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${lists[key].join(',')}"`] };
  });
  const info = wb.addWorksheet('Istruzioni');
  info.columns = [{ header: 'Colonna', key: 'k', width: 24 }, { header: 'Etichetta', key: 'l', width: 26 }, { header: 'Istruzioni', key: 'i', width: 110 }];
  info.getRow(1).font = { bold: true };
  for (const [key, label, help] of d.columns) info.addRow({ k: key, l: label, i: help });
  info.addRow({}); info.addRow({ k: 'Note', i: `Compila il foglio "${d.sheet}" lasciando la riga 1 (intestazioni) così com'è; la riga 2 è un esempio da sostituire o cancellare. Massimo 1000 righe per file. Le righe già presenti (stessa chiave) vengono aggiornate, non duplicate. Carica il file in Amministrazione > Importazioni.` });
  if (req.params.dataset === 'users') {
    const mods = await many(`SELECT key, name, restricted, scope_type, profiles FROM modules WHERE active AND kind <> 'PUBLIC' ORDER BY area, sort_order`);
    const ms = wb.addWorksheet('Moduli');
    ms.columns = [{ header: 'modulo', key: 'k', width: 16 }, { header: 'Nome', key: 'n', width: 30 }, { header: 'Profili ammessi (* = richiede le sedi)', key: 'p', width: 70 }, { header: 'Note', key: 'x', width: 40 }];
    ms.getRow(1).font = { bold: true };
    for (const m of mods) ms.addRow({ k: m.key, n: m.name, p: (m.profiles || []).map((p) => `${p.key}${p.scoped ? '*' : ''}${p.label ? ` (${p.label})` : ''}`).join(', '), x: m.restricted ? 'Riservato: solo il titolare' : '' });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="SuiteTD_modello_${d.sheet.toLowerCase()}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

r.get('/import/datasets', requireAdmin, ah(async (_req, res) => {
  res.json(Object.entries(DATASETS).sort((a, b) => a[1].order - b[1].order).map(([key, d]) => ({ key, title: d.title, sheet: d.sheet, columns: d.columns.map(([k, l]) => ({ key: k, label: l })) })));
}));

// ---- Caricamento
const cellText = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') { if (v.richText) return v.richText.map((x) => x.text).join(''); if (v.text) return String(v.text); if (v.result != null) return String(v.result); if (v instanceof Date) return v.toISOString().slice(0, 10); }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};
const BOOL_COLS = new Set(['active', 'send_invite', 'all_day', 'requires_ack', 'is_public']);
const NUM_COLS = new Set(['lat', 'lng']);

r.post('/import/:dataset', requireAdmin, upload.single('file'), ah(async (req, res) => {
  const dataset = req.params.dataset;
  const d = DATASETS[dataset];
  if (!d) throw new HttpError(404, 'Dataset inesistente');
  if (!req.file) throw bad('Nessun file ricevuto: carica un XLSX compilato dal modello');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('File non leggibile: serve un XLSX (Excel) salvato dal modello'); }
  const ws = wb.getWorksheet(d.sheet) || wb.worksheets[0];
  if (!ws) throw bad('Foglio dati assente');
  const headers = []; ws.getRow(1).eachCell((c, i) => { headers[i] = String(cellText(c.value) || '').trim(); });
  const known = new Set(d.columns.map(([k]) => k));
  const unknown = headers.filter(Boolean).filter((h) => !known.has(h));
  if (unknown.length) throw bad(`Colonne non riconosciute: ${unknown.join(', ')}. Usa le intestazioni del modello.`);
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {}; let empty = true;
    row.eachCell({ includeEmpty: false }, (c, i) => {
      const k = headers[i]; if (!k) return;
      let v = cellText(c.value); if (v != null) v = v.trim();
      if (v === '' || v == null) return;
      empty = false;
      if (BOOL_COLS.has(k)) v = /^(si|sì|s|yes|y|true|1|x)$/i.test(v);
      else if (NUM_COLS.has(k)) v = Number(String(v).replace(',', '.'));
      obj[k] = v;
    });
    if (!empty) rows.push({ __row: n, ...obj });
  });
  // la riga di esempio del modello viene ignorata se è rimasta identica
  const ex = d.example; const isExample = (o) => d.columns.every(([k], i) => (ex[i] === '' ? o[k] == null : String(o[k] ?? '') === String(BOOL_COLS.has(k) ? /^si$/i.test(ex[i]) : ex[i])));
  const data = rows.filter((o) => !isExample(o));
  if (!data.length) throw bad('Il file non contiene righe da importare (oltre all\'esempio)');
  if (data.length > 1000) throw bad('Massimo 1000 righe per file: spezza il caricamento');
  const batchUid = `xlsx:${dataset}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`;
  const batch = await one(`INSERT INTO ingest_batches (batch_uid, source, dataset, status, rows_total, checksum, manifest) VALUES ($1,'xlsx',$2,'RECEIVED',$3,$4,$5) RETURNING *`,
    [batchUid, dataset, data.length, crypto.createHash('sha256').update(req.file.buffer).digest('hex'), JSON.stringify({ filename: req.file.originalname, by: req.user.email })]);
  const k = { source: 'xlsx', site_id: null, id: null };
  let out;
  if (dataset === 'users') {
    const mods = new Map((await many('SELECT key, restricted, scope_type, profiles FROM modules')).map((m) => [m.key, m]));
    const ctx = { modules: mods, owner: req.user.level === 'OWNER', userId: req.user.id };
    ROW_SCHEMAS.users = usersRowSchema; APPLIERS.users = (c, row) => applyUserRow(c, row, ctx);
    out = await applyBatch(batch.id, 'users', data.map(({ __row, ...o }) => o), k);
  } else {
    out = await applyBatch(batch.id, dataset, data.map(({ __row, ...o }) => o), k);
  }
  // numeri di riga del foglio (la riga 1 è l'intestazione) al posto degli indici
  const errors = out.errors.map((e) => ({ ...e, row: data[e.row]?.__row ?? e.row + 2 }));
  await audit(req, 'IMPORT_XLSX', { entity: 'ingest_batch', entityId: batch.id, label: `${d.title}: ${out.rows_ok} ok, ${out.rows_rejected} scartate`, data: { dataset, filename: req.file.originalname } });
  res.status(201).json({ batch_id: batch.id, status: out.status, rows_total: data.length, rows_ok: out.rows_ok, rows_rejected: out.rows_rejected, errors });
}));

// ---- Azzeramento (titolare): la Suite torna vuota. Restano il titolare, le impostazioni, le credenziali cifrate, il catalogo dei moduli,
// le frasi del giorno. Vengono eliminati: sedi, persone, organizzazioni, utenti (tranne il titolare) e grant, contenuti Community, indice,
// lotti di importazione, e gli schemi di tutti i moduli (che tornano OFF).
r.post('/admin/reset', requireOwner, ah(async (req, res) => {
  const b = z.object({ confirm: z.literal('AZZERA LA SUITE') }).safeParse(req.body);
  if (!b.success) throw bad('Conferma mancante: scrivi esattamente "AZZERA LA SUITE"');
  const schemas = (await many(`SELECT key FROM module_state`)).map((x) => x.key);
  for (const s of schemas) await q(`DROP SCHEMA IF EXISTS "${String(s).replace(/"/g, '')}" CASCADE`).catch(() => {});
  await q(`UPDATE module_state SET mode='OFF', schema_ready=FALSE, last_copy_at=NULL, last_copy_stats=NULL, last_error=NULL, live_since=NULL, updated_by=NULL`);
  // Mai TRUNCATE ... CASCADE sulle anagrafiche: propagherebbe agli utenti. Cancellazioni esplicite, nell'ordine delle dipendenze.
  const owner = req.user.id;
  await q(`UPDATE users SET created_by=NULL WHERE created_by IS NOT NULL AND created_by <> $1`, [owner]);
  await q(`UPDATE grants SET created_by=NULL`); await q(`UPDATE app_settings SET updated_by=NULL WHERE updated_by <> $1`, [owner]);
  for (const t of ['grant_scopes', 'grants', 'notifications', 'read_log', 'search_index', 'ingest_batches', 'post_reactions', 'post_comments', 'post_files', 'posts', 'news_acks', 'news_files', 'news', 'events', 'notices', 'api_keys']) {
    await q(`DELETE FROM ${t}`).catch((e) => console.warn('[reset]', t, e.message));
  }
  await q(`UPDATE users SET avatar_file_id=NULL, person_id=NULL, site_id=NULL`);
  await q(`DELETE FROM users WHERE level <> 'OWNER'`);
  await q(`DELETE FROM files`).catch((e) => console.warn('[reset] files', e.message));
  await q(`UPDATE people SET manager_person_id=NULL`);
  await q(`DELETE FROM people`); await q(`DELETE FROM sites`); await q(`DELETE FROM organizations`);
  await q(`UPDATE legacy_sources SET last_sync_at=NULL, last_status=NULL, last_error=NULL, stats=NULL`).catch(() => {});
  // il titolare torna ad avere tutti i moduli
  const mods = await many('SELECT key, profiles FROM modules');
  for (const m of mods) {
    const profile = ((m.profiles || []).find((p) => ['OWNER', 'SUPERADMIN', 'ADMIN', 'CEO', 'DIREZIONE', 'PUBLISHER', 'EDITOR'].includes(p.key)) || (m.profiles || [])[0])?.key;
    if (profile) await q(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,$2,$3,'SEED') ON CONFLICT DO NOTHING`, [req.user.id, m.key, profile]);
  }
  await audit(req, 'SUITE_RESET', { entity: 'suite', label: 'Azzeramento completo delle anagrafiche e dei moduli' });
  res.json({ ok: true });
}));

export default r;
