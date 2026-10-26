// Circolari: bozza (da form o da file grezzo del laboratorio), strutturazione con Claude, anteprima impaginata, pubblicazione con
// protocollo TD-AAAA/NNN, DOCX e PDF, archivio con ricerca sul contenuto, revisioni, annullamento, invio alle liste.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { q, one, many, tx } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad, HttpError } from '../../../lib/util.js';
import { upsertIndex, removeFromIndex } from '../../../lib/search.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { config } from '../config.js';
import { renderDocx, effectiveOrientation, dataItaliana } from '../lib/render.js';
import { docxToPdf, pdfAvailable, pdfPages } from '../lib/pdf.js';
import { extract, fromText, heuristicStructure, clampBlocks } from '../lib/extract.js';
import { structureDraft } from '../lib/ai.js';
import { nextNumero, formatProtocollo, newToken } from '../lib/protocollo.js';

const r = Router();
const KEY = 'circolari';
const SEGMENTI = ['CLIENTI_SERVICE', 'PUNTI_PRELIEVO', 'MEDICINA_LAVORO', 'PERSONALE', 'PARTNER', 'ALTRO'];
const canEdit = (u) => ['ADMIN', 'PUBBLICATORE', 'REDATTORE'].includes(u.role);
const canPublish = (u) => ['ADMIN', 'PUBBLICATORE'].includes(u.role);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('file');
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const blocco = z.discriminatedUnion('type', [
  z.object({ type: z.literal('titolo'), text: z.string().trim().max(200) }),
  z.object({ type: z.literal('paragrafo'), text: z.string().trim().max(5000) }),
  z.object({ type: z.literal('elenco'), items: z.array(z.string().trim().max(800)).max(50) }),
  z.object({ type: z.literal('tabella'), colonne: z.array(z.string().trim().max(120)).min(1).max(12), righe: z.array(z.array(z.string().trim().max(400))).max(300) }),
]);
const schema = z.object({
  tipo: z.string().trim().max(80).optional(), linea: z.string().trim().max(80).optional(), segmento: z.enum(SEGMENTI).optional(),
  titolo: z.string().trim().min(3, 'il titolo è obbligatorio').max(200), destinatari: z.string().trim().max(400).optional(), oggetto: z.string().trim().max(400).optional(),
  decorrenza: z.string().trim().max(160).optional(), riferimenti: z.string().trim().max(400).optional(), luogo: z.string().trim().max(80).optional(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida').optional(), sintesi: z.string().trim().max(1200).optional(), corpo: z.array(blocco).max(80).optional(),
  contatti: z.array(z.string().trim().max(200)).max(8).optional(), firma_nome: z.string().trim().max(80).optional(), firma_ruolo: z.string().trim().max(80).optional(),
  orientamento: z.enum(['AUTO', 'VERTICALE', 'ORIZZONTALE']).optional(), audience: z.object({ type: z.string(), ids: z.array(z.union([z.number(), z.string()])).optional(), key: z.string().optional() }).optional(),
  note_interne: z.string().trim().max(2000).optional(),
});

const corpoTesto = (corpo) => (corpo || []).map((b) => (b.type === 'elenco' ? (b.items || []).join('. ') : b.type === 'tabella' ? [b.colonne, ...(b.righe || [])].map((r) => (r || []).join(' ')).join('. ') : b.text || '')).join('\n');
const LIST_COLS = `id, anno, numero, revisione, protocollo, parent_id, stato, tipo, linea, segmento, titolo, destinatari, oggetto, decorrenza, riferimenti, luogo, data, sintesi, orientamento, orientamento_eff, pub_token, pdf IS NOT NULL AS has_pdf, docx IS NOT NULL AS has_docx, pdf_pages, render_at, render_error, sorgente_nome, published_at, created_at, updated_at, created_by, published_by`;
const FULL_COLS = `${LIST_COLS}, corpo, contatti, firma_nome, firma_ruolo, audience, note_interne, sorgente_testo, updated_by`;
const publicUrl = (c) => (c.pub_token ? `${config.baseUrl}/api/circolari/pub/${c.pub_token}` : null);
const fileBase = (c) => `Circolare ${(c.protocollo || `bozza-${c.id}`).replace(/\//g, '-')}`;
const nomi = async (ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await many('SELECT id, full_name FROM public.users WHERE id = ANY($1::int[])', [list]);
  return Object.fromEntries(rows.map((x) => [x.id, x.full_name]));
};

async function load(id) {
  const c = await one(`SELECT ${FULL_COLS} FROM circolari WHERE id=$1`, [id]);
  if (!c) throw notFound('Circolare non trovata');
  return c;
}

// Impaginazione: DOCX sempre, PDF se LibreOffice è disponibile. Salva i file e lo stato dell'impaginazione
async function impagina(c, { client } = {}) {
  const runner = client ? client.query.bind(client) : q;
  const { buffer, orientamento } = await renderDocx(c, { publicUrl: c.stato === 'BOZZA' ? null : publicUrl(c) });
  let pdf = null, pages = null, error = null;
  if (await pdfAvailable()) {
    try { pdf = await docxToPdf(buffer); pages = pdfPages(pdf); } catch (e) { error = e.message; }
  } else error = 'LibreOffice non disponibile su questo server: generato solo il DOCX';
  await runner('UPDATE circolari SET docx=$2, pdf=$3, pdf_pages=$4, orientamento_eff=$5, render_at=now(), render_error=$6 WHERE id=$1', [c.id, buffer, pdf, pages, orientamento, error]);
  return { orientamento, pdf: Boolean(pdf), pages, error };
}

// Indice di ricerca della Suite (kind circolare_td: distinto dalle circolari della Community)
function indexBody(c) {
  return [c.protocollo, c.oggetto, c.destinatari, c.decorrenza, c.riferimenti, c.sintesi, corpoTesto(c.corpo)].filter(Boolean).join('\n');
}
async function indexCircolare(c) {
  if (c.stato !== 'PUBBLICATA') { await removeFromIndex('circolare_td', `circolari:${c.id}`); return; }
  await upsertIndex({ kind: 'circolare_td', ref_id: `circolari:${c.id}`, module_key: KEY, title: `${c.protocollo} · ${c.titolo}`, body: indexBody(c), link: `/circolari/${c.id}`, audience: c.audience || { type: 'INTERNAL' }, sensitive: false });
}
export async function reindexCircolari() {
  const rows = await many(`SELECT ${FULL_COLS} FROM circolari WHERE stato IN ('PUBBLICATA','SUPERATA','ANNULLATA')`);
  for (const c of rows) await indexCircolare(c);
  return { circolari: rows.filter((c) => c.stato === 'PUBBLICATA').length };
}

// ---- Elenco e ricerca sul contenuto
r.get('/circolari', ah(async (req, res) => {
  const f = parse(z.object({ q: z.string().trim().max(200).optional().default(''), stato: z.string().max(20).optional().default(''), anno: z.coerce.number().int().optional(), segmento: z.string().max(30).optional().default(''), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
  const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  if (f.stato) where.push(`stato = ${p(f.stato)}`);
  if (f.anno) where.push(`anno = ${p(f.anno)}`);
  if (f.segmento) where.push(`segmento = ${p(f.segmento)}`);
  let rank = 'NULL::real AS rank', snippet = 'NULL::text AS snippet', order = 'coalesce(published_at, updated_at) DESC';
  if (f.q) {
    const qi = p(f.q);
    where.push(`(fts @@ websearch_to_tsquery('italian', ${qi}) OR protocollo ILIKE '%' || ${qi} || '%' OR titolo ILIKE '%' || ${qi} || '%')`);
    rank = `ts_rank_cd(fts, websearch_to_tsquery('italian', ${qi})) AS rank`;
    snippet = `ts_headline('italian', coalesce(titolo,'') || '. ' || coalesce(sintesi,'') || '. ' || coalesce(corpo_testo,''), websearch_to_tsquery('italian', ${qi}), 'MaxWords=30, MinWords=12, ShortWord=3, MaxFragments=2, StartSel=<b>, StopSel=</b>') AS snippet`;
    order = 'rank DESC, coalesce(published_at, updated_at) DESC';
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT count(*)::int AS n FROM circolari ${w}`, params)).n;
  const rows = await many(`SELECT ${LIST_COLS}, ${rank}, ${snippet} FROM circolari ${w} ORDER BY ${order} LIMIT ${p(f.pageSize)} OFFSET ${p((f.page - 1) * f.pageSize)}`, params);
  const names = await nomi(rows.flatMap((x) => [x.created_by, x.published_by]));
  res.json({ total, page: f.page, pageSize: f.pageSize, rows: rows.map((x) => ({ ...x, created_by_name: names[x.created_by] || null, published_by_name: names[x.published_by] || null })) });
}));

r.get('/circolari/riepilogo', ah(async (_req, res) => {
  const anni = await many(`SELECT anno, count(*)::int AS n FROM circolari WHERE anno IS NOT NULL GROUP BY anno ORDER BY anno DESC`);
  const stati = await many(`SELECT stato, count(*)::int AS n FROM circolari GROUP BY stato`);
  const ultime = await many(`SELECT ${LIST_COLS} FROM circolari WHERE stato='PUBBLICATA' ORDER BY published_at DESC LIMIT 5`);
  const invii = await one(`SELECT count(*)::int AS n, coalesce(sum(n_inviati),0)::int AS inviati FROM invii`);
  const letture = await one(`SELECT count(*)::int AS n FROM letture`);
  res.json({ anni, stati: Object.fromEntries(stati.map((s) => [s.stato, s.n])), ultime, invii, letture: letture.n });
}));

// ---- Nuova bozza da form
r.post('/circolari', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Le bozze si creano con il profilo Redazione');
  const b = parse(schema, req.body);
  const c = await inserisci(b, req);
  await audit(req, 'CIRCOLARE_BOZZA', { module: KEY, entity: 'circolare', entityId: c.id, label: c.titolo });
  res.status(201).json(c);
}));

async function inserisci(b, req, extra = {}) {
  const cols = { tipo: b.tipo ?? 'Comunicazione ai clienti', linea: b.linea ?? 'Laboratorio di Analisi', segmento: b.segmento ?? 'CLIENTI_SERVICE', titolo: b.titolo, destinatari: b.destinatari ?? '', oggetto: b.oggetto ?? '', decorrenza: b.decorrenza ?? '', riferimenti: b.riferimenti ?? '', luogo: b.luogo ?? 'Sesto Fiorentino (FI)', data: b.data ?? new Date().toISOString().slice(0, 10), sintesi: b.sintesi ?? '', corpo: JSON.stringify(b.corpo ?? []), corpo_testo: corpoTesto(b.corpo), contatti: JSON.stringify(b.contatti ?? ['Servizio Clienti', 'Tel. 055776511 – Mail: info@toscanadiagnostica.it']), firma_nome: b.firma_nome ?? 'Francesco Epifani', firma_ruolo: b.firma_ruolo ?? 'Chief Executive Officer', orientamento: b.orientamento ?? 'AUTO', audience: JSON.stringify(b.audience ?? { type: 'INTERNAL' }), note_interne: b.note_interne ?? '', created_by: req.user.suite_user_id, updated_by: req.user.suite_user_id, ...extra };
  const keys = Object.keys(cols);
  return one(`INSERT INTO circolari (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${FULL_COLS}`, Object.values(cols));
}

// ---- Nuova bozza da file grezzo (DOCX, PDF, TXT): estrazione del testo e strutturazione (Claude se configurato, altrimenti euristica)
r.post('/circolari/importa', (req, res, next) => upload(req, res, (e) => (e ? next(bad(e.code === 'LIMIT_FILE_SIZE' ? 'File troppo grande (massimo 25 MB)' : e.message)) : next())), ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Le bozze si creano con il profilo Redazione');
  const hint = String(req.body?.hint || '').slice(0, 500);
  const useAi = String(req.body?.ai ?? '1') !== '0';
  let text = String(req.body?.testo || '');
  let blocchi = null; let nome = null;
  if (req.file) {
    const ex = await extract(req.file.buffer, req.file.originalname, req.file.mimetype);
    text = ex.text; blocchi = ex.blocchi; nome = req.file.originalname;
  } else if (text.trim()) {
    const ex = fromText(text); blocchi = ex.blocchi;
  } else throw bad('Carica un file (DOCX, PDF, TXT) oppure incolla il testo della bozza');
  if (!text.trim()) throw bad('Dal file non è stato possibile estrarre testo');
  const s = useAi ? await structureDraft({ text, blocchi, hint, userId: req.user.suite_user_id }) : { ...heuristicStructure(blocchi), ai: false };
  s.corpo = clampBlocks(s.corpo);
  const cut = (x, n) => String(x || '').slice(0, n);
  const b = parse(schema, { titolo: cut(s.titolo, 200) || (nome ? nome.replace(/\.[^.]+$/, '') : 'Nuova circolare'), oggetto: cut(s.oggetto, 400), destinatari: cut(s.destinatari, 400), decorrenza: cut(s.decorrenza, 160), riferimenti: cut(s.riferimenti, 400), sintesi: cut(s.sintesi, 1200), tipo: s.tipo || undefined, linea: s.linea || undefined, corpo: s.corpo, segmento: SEGMENTI.includes(req.body?.segmento) ? req.body.segmento : undefined });
  const c = await inserisci(b, req, { sorgente_nome: nome, sorgente_testo: text.slice(0, 200000) });
  await audit(req, 'CIRCOLARE_IMPORTATA', { module: KEY, entity: 'circolare', entityId: c.id, label: c.titolo, data: { file: nome, ai: s.ai, ai_error: s.ai_error || null } });
  res.status(201).json({ ...c, ai: s.ai, ai_error: s.ai_error || null });
}));

// ---- Dettaglio
r.get('/circolari/:id', ah(async (req, res) => {
  const c = await load(req.params.id);
  const invii = await many('SELECT i.id, i.lista_id, l.nome AS lista_nome, i.n_destinatari, i.n_inviati, i.n_errori, i.oggetto_email, i.inviato_da, i.inviato_at FROM invii i LEFT JOIN liste l ON l.id=i.lista_id WHERE i.circolare_id=$1 ORDER BY i.inviato_at DESC', [c.id]);
  const letture = (await one('SELECT count(*)::int AS n FROM letture WHERE circolare_id=$1', [c.id])).n;
  const revisioni = c.numero ? await many(`SELECT id, revisione, protocollo, stato, published_at, titolo FROM circolari WHERE anno=$1 AND numero=$2 ORDER BY revisione`, [c.anno, c.numero]) : [];
  const names = await nomi([c.created_by, c.published_by, c.updated_by, ...invii.map((i) => i.inviato_da)]);
  res.json({ ...c, created_by_name: names[c.created_by] || null, published_by_name: names[c.published_by] || null, updated_by_name: names[c.updated_by] || null, public_url: c.stato === 'BOZZA' ? null : publicUrl(c), orientamento_previsto: effectiveOrientation(c), invii: invii.map((i) => ({ ...i, inviato_da_name: names[i.inviato_da] || null })), letture, revisioni });
}));

// ---- Modifica (solo bozze)
r.put('/circolari/:id', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Le bozze si modificano con il profilo Redazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'BOZZA') throw bad('Una circolare pubblicata non si modifica: crea una revisione');
  const b = parse(schema, { ...cur, ...req.body, data: req.body.data ?? (cur.data instanceof Date ? cur.data.toISOString().slice(0, 10) : String(cur.data).slice(0, 10)) });
  const c = await one(`UPDATE circolari SET tipo=$2, linea=$3, segmento=$4, titolo=$5, destinatari=$6, oggetto=$7, decorrenza=$8, riferimenti=$9, luogo=$10, data=$11, sintesi=$12, corpo=$13, contatti=$14, firma_nome=$15, firma_ruolo=$16, orientamento=$17, audience=$18, note_interne=$19, updated_by=$20, corpo_testo=$21, updated_at=now(), render_at=NULL, docx=NULL, pdf=NULL, pdf_pages=NULL, render_error=NULL WHERE id=$1 RETURNING ${FULL_COLS}`,
    [cur.id, b.tipo ?? cur.tipo, b.linea ?? cur.linea, b.segmento ?? cur.segmento, b.titolo, b.destinatari ?? '', b.oggetto ?? '', b.decorrenza ?? '', b.riferimenti ?? '', b.luogo ?? cur.luogo, b.data, b.sintesi ?? '', JSON.stringify(b.corpo ?? cur.corpo), JSON.stringify(b.contatti ?? cur.contatti), b.firma_nome ?? cur.firma_nome, b.firma_ruolo ?? cur.firma_ruolo, b.orientamento ?? cur.orientamento, JSON.stringify(b.audience ?? cur.audience), b.note_interne ?? cur.note_interne, req.user.suite_user_id, corpoTesto(b.corpo ?? cur.corpo)]);
  await audit(req, 'CIRCOLARE_MODIFICATA', { module: KEY, entity: 'circolare', entityId: c.id, label: c.titolo });
  res.json(c);
}));

// ---- Ristrutturazione con Claude della bozza grezza (nuova proposta, da confermare salvando)
r.post('/circolari/:id/struttura', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Operazione riservata alla Redazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'BOZZA') throw bad('Solo le bozze si possono ristrutturare');
  const text = String(req.body?.testo || cur.sorgente_testo || '').trim();
  if (!text) throw bad('Nessun testo di partenza: carica un file o incolla il testo');
  const s = await structureDraft({ text, blocchi: fromText(text).blocchi, hint: String(req.body?.hint || '').slice(0, 500), userId: req.user.suite_user_id });
  s.corpo = clampBlocks(s.corpo);
  res.json(s);
}));

// ---- Anteprima impaginata della bozza (DOCX + PDF senza protocollo)
r.post('/circolari/:id/anteprima', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Operazione riservata alla Redazione');
  const cur = await load(req.params.id);
  const out = await impagina(cur);
  res.json(out);
}));

const sendFile = (res, c, kind) => {
  if (kind === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${fileBase(c)}.pdf"`); return res.send(c.pdf); }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase(c)}.docx"`);
  return res.send(c.docx);
};
r.get('/circolari/:id/docx', ah(async (req, res) => {
  const c = await one('SELECT id, protocollo, docx FROM circolari WHERE id=$1', [req.params.id]);
  if (!c) throw notFound('Circolare non trovata');
  if (!c.docx) throw new HttpError(409, 'Documento non ancora impaginato: genera l\'anteprima');
  sendFile(res, c, 'docx');
}));
r.get('/circolari/:id/pdf', ah(async (req, res) => {
  const c = await one('SELECT id, protocollo, pdf, render_error FROM circolari WHERE id=$1', [req.params.id]);
  if (!c) throw notFound('Circolare non trovata');
  if (!c.pdf) throw new HttpError(409, c.render_error || 'PDF non ancora generato: genera l\'anteprima');
  sendFile(res, c, 'pdf');
}));

r.get('/circolari/:id/qr.png', ah(async (req, res) => {
  const c = await one('SELECT id, pub_token, stato FROM circolari WHERE id=$1', [req.params.id]);
  if (!c || !c.pub_token) throw notFound('QR non disponibile');
  const { qrPng } = await import('../lib/render.js');
  res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(await qrPng(publicUrl(c)));
}));

// ---- Pubblicazione: protocollo assegnato dal database in transazione, impaginazione definitiva con QR, indice di ricerca
r.post('/circolari/:id/pubblica', ah(async (req, res) => {
  if (!canPublish(req.user)) throw forbidden('La pubblicazione è riservata al profilo Pubblicazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'BOZZA') throw bad('La circolare è già pubblicata');
  if (!cur.titolo || !(cur.corpo || []).length) throw bad('Titolo e corpo sono obbligatori per pubblicare');
  const c = await tx(async (client) => {
    const anno = Number(String(cur.data).slice(0, 4)) || new Date().getFullYear();
    let numero = cur.numero, rev = cur.revisione || 0, annoEff = anno;
    if (cur.parent_id) {
      // revisione: stesso numero del protocollo d'origine, le precedenti diventano superate
      const parent = (await client.query('SELECT anno, numero FROM circolari WHERE id=$1', [cur.parent_id])).rows[0];
      if (!parent?.numero) throw bad('La circolare di origine non ha protocollo');
      annoEff = parent.anno; numero = parent.numero;
      await client.query(`UPDATE circolari SET stato='SUPERATA', updated_at=now() WHERE anno=$1 AND numero=$2 AND stato='PUBBLICATA'`, [annoEff, numero]);
    } else {
      numero = await nextNumero(client, anno); rev = 0;
    }
    const protocollo = formatProtocollo(annoEff, numero, rev);
    const row = (await client.query(`UPDATE circolari SET anno=$2, numero=$3, revisione=$4, protocollo=$5, stato='PUBBLICATA', pub_token=coalesce(pub_token, $6), published_by=$7, published_at=now(), updated_by=$7, updated_at=now() WHERE id=$1 RETURNING ${FULL_COLS}`, [cur.id, annoEff, numero, rev, protocollo, newToken(), req.user.suite_user_id])).rows[0];
    await impagina(row, { client });
    return row;
  });
  const full = await load(c.id);
  await indexCircolare(full);
  if (cur.parent_id) for (const prev of await many(`SELECT ${FULL_COLS} FROM circolari WHERE anno=$1 AND numero=$2 AND id<>$3`, [full.anno, full.numero, full.id])) await indexCircolare(prev);
  await audit(req, 'CIRCOLARE_PUBBLICATA', { module: KEY, entity: 'circolare', entityId: full.id, label: `${full.protocollo} ${full.titolo}`, data: { orientamento: full.orientamento_eff, pdf: Boolean(full.has_pdf), revisione: full.revisione } });
  res.json({ ...full, public_url: publicUrl(full) });
}));

// ---- Nuova revisione di una circolare pubblicata: bozza che eredita tutto, stesso protocollo con suffisso -rN alla pubblicazione
r.post('/circolari/:id/revisione', ah(async (req, res) => {
  if (!canPublish(req.user)) throw forbidden('Le revisioni sono riservate al profilo Pubblicazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'PUBBLICATA') throw bad('Solo una circolare pubblicata si può revisionare');
  const open = await one(`SELECT id FROM circolari WHERE anno=$1 AND numero=$2 AND stato='BOZZA'`, [cur.anno, cur.numero]);
  if (open) throw bad(`Esiste già una revisione in bozza (id ${open.id})`);
  const maxRev = (await one('SELECT max(revisione) AS r FROM circolari WHERE anno=$1 AND numero=$2', [cur.anno, cur.numero])).r;
  const c = await one(`INSERT INTO circolari (anno, numero, revisione, parent_id, stato, tipo, linea, segmento, titolo, destinatari, oggetto, decorrenza, riferimenti, luogo, data, sintesi, corpo, corpo_testo, contatti, firma_nome, firma_ruolo, orientamento, audience, note_interne, sorgente_nome, sorgente_testo, pub_token, created_by, updated_by)
    SELECT anno, numero, $2, id, 'BOZZA', tipo, linea, segmento, titolo, destinatari, oggetto, decorrenza, riferimenti, luogo, CURRENT_DATE, sintesi, corpo, corpo_testo, contatti, firma_nome, firma_ruolo, orientamento, audience, note_interne, sorgente_nome, sorgente_testo, NULL, $3, $3 FROM circolari WHERE id=$1 RETURNING ${FULL_COLS}`, [cur.id, Number(maxRev) + 1, req.user.suite_user_id]);
  await audit(req, 'CIRCOLARE_REVISIONE', { module: KEY, entity: 'circolare', entityId: c.id, label: `${cur.protocollo} rev. ${c.revisione}` });
  res.status(201).json(c);
}));

// ---- Annullamento (resta in archivio con il protocollo) ed eliminazione delle bozze
r.post('/circolari/:id/annulla', ah(async (req, res) => {
  if (!canPublish(req.user)) throw forbidden('Operazione riservata al profilo Pubblicazione');
  const cur = await load(req.params.id);
  if (cur.stato === 'BOZZA') throw bad('Una bozza si elimina, non si annulla');
  const motivo = String(req.body?.motivo || '').slice(0, 500);
  const c = await one(`UPDATE circolari SET stato='ANNULLATA', note_interne = note_interne || $2, updated_by=$3, updated_at=now() WHERE id=$1 RETURNING ${FULL_COLS}`, [cur.id, motivo ? `\nAnnullata: ${motivo}` : '\nAnnullata', req.user.suite_user_id]);
  await indexCircolare(c);
  await audit(req, 'CIRCOLARE_ANNULLATA', { module: KEY, entity: 'circolare', entityId: c.id, label: `${c.protocollo} ${c.titolo}`, data: { motivo } });
  res.json(c);
}));
r.delete('/circolari/:id', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Operazione riservata alla Redazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'BOZZA') throw bad('Solo le bozze si eliminano: le circolari pubblicate si annullano');
  await q('DELETE FROM circolari WHERE id=$1', [cur.id]);
  await audit(req, 'CIRCOLARE_BOZZA_ELIMINATA', { module: KEY, entity: 'circolare', entityId: cur.id, label: cur.titolo });
  res.json({ ok: true });
}));

// ---- Invio alle liste di distribuzione (PDF allegato + collegamento alla versione digitale)
r.post('/circolari/:id/invia', ah(async (req, res) => {
  if (!canPublish(req.user)) throw forbidden('L\'invio è riservato al profilo Pubblicazione');
  const cur = await load(req.params.id);
  if (cur.stato !== 'PUBBLICATA') throw bad('Si invia solo una circolare pubblicata');
  const b = parse(z.object({ lista_id: z.coerce.number().int().optional(), emails: z.array(z.string().trim().toLowerCase().email()).max(500).optional(), oggetto: z.string().trim().max(200).optional(), messaggio: z.string().trim().max(3000).optional() }), req.body || {});
  let dest = [];
  let lista = null;
  if (b.lista_id) { lista = await one('SELECT * FROM liste WHERE id=$1', [b.lista_id]); if (!lista) throw notFound('Lista non trovata'); dest = lista.destinatari || []; }
  if (b.emails?.length) dest = dest.concat(b.emails.map((email) => ({ email })));
  const seen = new Set(); dest = dest.filter((d) => d.email && !seen.has(d.email) && seen.add(d.email));
  if (!dest.length) throw bad('Nessun destinatario');
  if (dest.length > config.maxEmailBatch) throw bad(`Massimo ${config.maxEmailBatch} destinatari per invio`);
  const file = await one('SELECT pdf, docx FROM circolari WHERE id=$1', [cur.id]);
  const subject = b.oggetto || `Circolare ${cur.protocollo}: ${cur.titolo}`;
  const url = publicUrl(cur);
  const html = layout(`Circolare ${cur.protocollo}`, `<p>${escapeHtml(b.messaggio || 'Gentile Cliente, in allegato la circolare in oggetto.')}</p><p><b>${escapeHtml(cur.titolo)}</b><br>${escapeHtml(cur.sintesi)}</p><p>Versione digitale sempre aggiornata: <a href="${url}">${url}</a></p><p>Toscana Diagnostica S.r.l.<br>${escapeHtml(cur.firma_nome)}, ${escapeHtml(cur.firma_ruolo)}</p>`);
  const attachments = file?.pdf ? [{ filename: `${fileBase(cur)}.pdf`, content: file.pdf, contentType: 'application/pdf' }] : file?.docx ? [{ filename: `${fileBase(cur)}.docx`, content: file.docx, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] : [];
  const esito = [];
  for (const d of dest) {
    try { await sendMail({ to: d.email, subject, html, ref: `circolare:${cur.id}`, attachments }); esito.push({ email: d.email, ok: true }); }
    catch (e) { esito.push({ email: d.email, ok: false, error: String(e.message || e).slice(0, 200) }); }
  }
  const inv = await one('INSERT INTO invii (circolare_id, lista_id, destinatari, n_destinatari, n_inviati, n_errori, esito, oggetto_email, inviato_da) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [cur.id, lista?.id || null, JSON.stringify(dest), dest.length, esito.filter((x) => x.ok).length, esito.filter((x) => !x.ok).length, JSON.stringify(esito), subject, req.user.suite_user_id]);
  await audit(req, 'CIRCOLARE_INVIATA', { module: KEY, entity: 'circolare', entityId: cur.id, label: `${cur.protocollo} → ${lista?.nome || 'destinatari indicati'}`, data: { n: dest.length, inviati: inv.n_inviati, errori: inv.n_errori } });
  res.json(inv);
}));

r.get('/circolari/:id/invii/:invioId', ah(async (req, res) => {
  const inv = await one('SELECT * FROM invii WHERE id=$1 AND circolare_id=$2', [req.params.invioId, req.params.id]);
  if (!inv) throw notFound('Invio non trovato');
  res.json(inv);
}));

export default r;
export { dataItaliana };
