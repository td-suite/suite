// Community: home, bacheca (post, reazioni, commenti, allegati), news e circolari con presa visione, blog pubblico,
// avvisi, calendario, frase del giorno, meteo. Audience filtrata con lib/audience.js su ogni lettura.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, audit, parse, notFound, forbidden, slugify, itDate, getSetting, HttpError } from '../lib/util.js';
import { isAdmin, hasModule, canSeeSite } from '../lib/access.js';
import { audienceSql, canSee } from '../lib/audience.js';
import { sendMail, layout } from '../lib/mailer.js';
import { normalizeAudience, audienceUsers, notify, ensureDailyQuote, nextProtocol } from '../lib/community.js';
import { aiEnabled, generateQuotes, generateQuiz } from '../lib/claude.js';
import { weatherForSite, weatherForPoint } from '../lib/weather.js';
import { indexNews, removeNews, indexPost, indexEvent, indexNotice, removeFromIndex } from '../lib/search.js';
import * as blob from '../lib/blob.js';
import { streamFile } from './files.js';

const r = Router();
const MODULE = 'comunicazione';

// ---- Permessi: redazione (EDITOR o PUBLISHER del modulo comunicazione, oppure amministratori), pubblicazione (PUBLISHER o amministratori)
const canEdit = (u) => isAdmin(u) || hasModule(u, MODULE, 'EDITOR', 'PUBLISHER');
const canPublish = (u) => isAdmin(u) || hasModule(u, MODULE, 'PUBLISHER');
const requireEditor = (req, _res, next) => (canEdit(req.user) ? next() : next(forbidden('Riservato alla redazione (modulo Comunicazione)')));
const requirePublisher = (req, _res, next) => (canPublish(req.user) ? next() : next(forbidden('Riservato a chi pubblica (profilo Pubblicazione o amministratori)')));

const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }),
  z.object({ type: z.literal('INTERNAL') }),
  z.object({ type: z.literal('SITES'), ids: z.array(z.coerce.number().int()).min(1) }),
  z.object({ type: z.literal('ORGS'), ids: z.array(z.coerce.number().int()).min(1) }),
  z.object({ type: z.literal('MODULE'), key: z.string().min(1).max(40) }),
  z.object({ type: z.literal('USERS'), ids: z.array(z.coerce.number().int()).min(1) }),
]);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data nel formato AAAA-MM-GG');
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'data e ora non valide');
const idParam = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('Identificativo non valido'); return n; };

// ---- Questionario delle circolari (news_quiz): domande senza la risposta corretta per i lettori, complete per la redazione
async function quizFor(newsId) {
  const qz = await one('SELECT questions, model, created_at FROM news_quiz WHERE news_id=$1', [newsId]);
  return qz ? { questions: qz.questions, model: qz.model, created_at: qz.created_at } : null;
}
const publicQuiz = (quiz) => (quiz ? { questions: quiz.questions.map(({ q, options }) => ({ q, options })), created_at: quiz.created_at } : null);
async function buildQuiz(n, userId) {
  if (n.kind !== 'CIRCOLARE' || !aiEnabled()) return null;
  const questions = await generateQuiz({ title: n.title, body: `${n.summary ? `${n.summary}\n\n` : ''}${n.body}` }, { userId });
  await q(`INSERT INTO news_quiz (news_id, questions, model, created_by) VALUES ($1,$2,$3,$4)
           ON CONFLICT (news_id) DO UPDATE SET questions=EXCLUDED.questions, model=EXCLUDED.model, created_by=EXCLUDED.created_by, created_at=now()`,
    [n.id, JSON.stringify(questions), config.anthropic.model, userId]);
  await q('DELETE FROM news_quiz_answers WHERE news_id=$1', [n.id]);   // domande nuove, esiti da rifare
  return quizFor(n.id);
}
const audienceLabel = (a) => ({ ALL: 'tutti', INTERNAL: 'personale interno', SITES: 'sedi selezionate', ORGS: 'organizzazioni selezionate', MODULE: `utenti del modulo ${a.key}`, USERS: 'utenti selezionati' }[a?.type] || 'tutti');

// Un utente può scegliere un'audience solo se vi rientra lui stesso (salvo la redazione), così non invia contenuti dove non vede
function checkAudienceChoice(u, a) {
  if (canEdit(u)) return a;
  if (!canSee(u, a)) throw forbidden('Non puoi pubblicare verso un perimetro di cui non fai parte');
  return a;
}

// ---- Vincolo sugli allegati: file non cancellati, dello scope giusto e (per i post) dell'autore
async function checkFiles(ids, scope, ownerId) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!list.length) return [];
  const rows = await many(`SELECT id, owner_user_id, scope FROM files WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND scope=$2`, [list, scope]);
  if (rows.length !== list.length) throw bad('Uno o più allegati non sono validi');
  if (ownerId && rows.some((f) => f.owner_user_id !== ownerId)) throw bad('Puoi allegare solo file caricati da te');
  return list;
}

// =====================================================================================================
// Bacheca
// =====================================================================================================
const POST_SELECT = (userParam) => `
  SELECT p.id, p.body, p.audience, p.site_id, p.pinned, p.created_at, p.updated_at,
         json_build_object('id', a.id, 'full_name', a.full_name, 'avatar_file_id', a.avatar_file_id, 'job_title', coalesce(pe.job_title, a.title)) AS author,
         s.name AS site_name,
         coalesce((SELECT json_agg(json_build_object('id', f.id, 'filename', f.filename, 'mime', f.mime, 'size', f.size) ORDER BY f.id)
                     FROM post_files pf JOIN files f ON f.id=pf.file_id WHERE pf.post_id=p.id AND f.deleted_at IS NULL), '[]'::json) AS files,
         coalesce((SELECT json_object_agg(x.kind, x.n) FROM (SELECT kind, count(*)::int AS n FROM post_reactions WHERE post_id=p.id GROUP BY kind) x), '{}'::json) AS reactions,
         (SELECT kind FROM post_reactions WHERE post_id=p.id AND user_id=${userParam}) AS my_reaction,
         (SELECT count(*)::int FROM post_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comments_count
    FROM posts p
    JOIN users a ON a.id=p.author_id
    LEFT JOIN people pe ON pe.id=a.person_id
    LEFT JOIN sites s ON s.id=p.site_id`;

async function loadPost(user, id, { ignoreAudience = false } = {}) {
  const p = await one(`${POST_SELECT('$2')} WHERE p.id=$1 AND p.deleted_at IS NULL`, [id, user.id]);
  if (!p) throw notFound('Post non trovato');
  if (!ignoreAudience && !canSee(user, p.audience) && p.author.id !== user.id) throw notFound('Post non trovato');
  return p;
}

r.get('/community/posts', ah(async (req, res) => {
  const { before, site_id, limit } = parse(z.object({ before: isoDate.optional(), site_id: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  const params = [req.user.id];
  const a = audienceSql(req.user, 'p.audience', params);
  const where = ['p.deleted_at IS NULL', `(${a.sql} OR p.author_id = $1)`];
  if (before) { params.push(new Date(before)); where.push(`p.created_at < $${params.length}`); }
  if (site_id) { params.push(site_id); where.push(`p.site_id = $${params.length}`); }
  params.push(limit);
  const rows = await many(`${POST_SELECT('$1')} WHERE ${where.join(' AND ')} ORDER BY ${before ? '' : 'p.pinned DESC, '}p.created_at DESC LIMIT $${params.length}`, params);
  res.json(rows);
}));

r.post('/community/posts', ah(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(5000), audience: audienceSchema.optional(), site_id: z.number().int().nullable().optional(), file_ids: z.array(z.number().int()).max(10).optional() }), req.body);
  const audience = checkAudienceChoice(req.user, normalizeAudience(b.audience || { type: 'ALL' }));
  if (b.site_id && !canSeeSite(req.user, b.site_id)) throw forbidden('Non fai parte di questa sede');
  const fileIds = await checkFiles(b.file_ids, 'POST', req.user.id);
  const id = await tx(async (c) => {
    const p = (await c.query('INSERT INTO posts (author_id, body, audience, site_id) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, b.body, JSON.stringify(audience), b.site_id || null])).rows[0];
    for (const f of fileIds) await c.query('INSERT INTO post_files (post_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, f]);
    return p.id;
  });
  const post = await loadPost(req.user, id, { ignoreAudience: true });
  await audit(req, 'POST_CREATED', { module: MODULE, entity: 'post', entityId: id, label: b.body.slice(0, 80), data: { audience, site_id: b.site_id || null, files: fileIds.length } });
  indexPost({ id, body: b.body, audience, deleted_at: null }, { full_name: req.user.full_name }).catch((e) => console.warn('[search]', e.message));
  res.status(201).json(post);
}));

r.delete('/community/posts/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const p = await one('SELECT id, author_id, body FROM posts WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!p) throw notFound('Post non trovato');
  if (p.author_id !== req.user.id && !isAdmin(req.user)) throw forbidden('Puoi eliminare solo i tuoi post');
  await q('UPDATE posts SET deleted_at=now(), updated_at=now() WHERE id=$1', [id]);
  await audit(req, 'POST_DELETED', { module: MODULE, entity: 'post', entityId: id, label: p.body.slice(0, 80) });
  removeFromIndex('post', id).catch(() => {});
  res.json({ ok: true });
}));

r.put('/community/posts/:id/pin', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ pinned: z.boolean().optional() }), req.body || {});
  const p = await one('SELECT id, pinned FROM posts WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!p) throw notFound('Post non trovato');
  const pinned = b.pinned ?? !p.pinned;
  await q('UPDATE posts SET pinned=$2, updated_at=now() WHERE id=$1', [id, pinned]);
  await audit(req, pinned ? 'POST_PINNED' : 'POST_UNPINNED', { module: MODULE, entity: 'post', entityId: id });
  res.json({ ok: true, pinned });
}));

r.post('/community/posts/:id/react', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ kind: z.enum(['LIKE', 'CLAP', 'HEART', 'IDEA']).nullable() }), req.body);
  await loadPost(req.user, id);
  if (b.kind) await q('INSERT INTO post_reactions (post_id, user_id, kind) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET kind=EXCLUDED.kind, at=now()', [id, req.user.id, b.kind]);
  else await q('DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2', [id, req.user.id]);
  const p = await loadPost(req.user, id);
  res.json({ reactions: p.reactions, my_reaction: p.my_reaction });
}));

r.get('/community/posts/:id/comments', ah(async (req, res) => {
  const id = idParam(req.params.id);
  await loadPost(req.user, id);
  const rows = await many(`SELECT c.id, c.body, c.created_at, json_build_object('id', u.id, 'full_name', u.full_name, 'avatar_file_id', u.avatar_file_id) AS author
                             FROM post_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at`, [id]);
  res.json(rows);
}));

r.post('/community/posts/:id/comments', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  const p = await loadPost(req.user, id);
  const c = await one('INSERT INTO post_comments (post_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at', [id, req.user.id, b.body]);
  await audit(req, 'COMMENT_CREATED', { module: MODULE, entity: 'post', entityId: id, label: b.body.slice(0, 80) });
  if (p.author.id !== req.user.id) {
    await notify([p.author.id], { kind: 'INFO', module_key: MODULE, title: `${req.user.full_name} ha commentato il tuo post`, body: b.body.slice(0, 200), link: `/community/posts/${id}` });
  }
  res.status(201).json({ ...c, author: { id: req.user.id, full_name: req.user.full_name, avatar_file_id: req.user.avatar_file_id } });
}));

r.delete('/community/comments/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const c = await one('SELECT c.id, c.author_id, c.post_id, p.author_id AS post_author FROM post_comments c JOIN posts p ON p.id=c.post_id WHERE c.id=$1 AND c.deleted_at IS NULL', [id]);
  if (!c) throw notFound('Commento non trovato');
  if (c.author_id !== req.user.id && c.post_author !== req.user.id && !isAdmin(req.user)) throw forbidden('Puoi eliminare solo i tuoi commenti');
  await q('UPDATE post_comments SET deleted_at=now() WHERE id=$1', [id]);
  await audit(req, 'COMMENT_DELETED', { module: MODULE, entity: 'post', entityId: c.post_id, data: { comment_id: id } });
  res.json({ ok: true });
}));

// =====================================================================================================
// News, circolari, blog
// =====================================================================================================
const NEWS_LIST = `n.id, n.kind, n.title, n.slug, n.summary, n.cover_file_id, n.audience, n.status, n.published_at, n.requires_ack, n.ack_due, n.protocol, n.is_public, n.tags, n.created_at, n.updated_at,
  n.author_id, u.full_name AS author_name`;
const newsSchema = z.object({
  kind: z.enum(['NEWS', 'CIRCOLARE', 'BLOG']).default('NEWS'),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(600).nullable().optional(),
  body: z.string().min(1).max(100000),
  cover_file_id: z.number().int().nullable().optional(),
  audience: audienceSchema.optional(),
  requires_ack: z.boolean().optional(),
  ack_due: dateStr.nullable().optional(),
  is_public: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  file_ids: z.array(z.number().int()).max(20).optional(),
});

async function uniqueSlug(title, excludeId) {
  const base = slugify(title);
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const hit = await one('SELECT id FROM news WHERE slug=$1', [s]);
    if (!hit || hit.id === excludeId) return s;
  }
  return `${base}-${Date.now()}`;
}
const newsFiles = (id) => many('SELECT f.id, f.filename, f.mime, f.size FROM news_files nf JOIN files f ON f.id=nf.file_id WHERE nf.news_id=$1 AND f.deleted_at IS NULL ORDER BY f.id', [id]);

r.get('/community/news', ah(async (req, res) => {
  const { kind, page, pageSize } = parse(z.object({ kind: z.enum(['NEWS', 'CIRCOLARE', 'BLOG']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  const params = [];
  const a = audienceSql(req.user, 'n.audience', params);
  const where = [`n.status='PUBLISHED'`, a.sql];
  if (kind) { params.push(kind); where.push(`n.kind=$${params.length}`); }
  const total = (await one(`SELECT count(*)::int AS n FROM news n WHERE ${where.join(' AND ')}`, params)).n;
  params.push(req.user.id);
  const uid = `$${params.length}`;
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await many(`SELECT ${NEWS_LIST}, EXISTS (SELECT 1 FROM news_acks k WHERE k.news_id=n.id AND k.user_id=${uid}) AS acked
                             FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE ${where.join(' AND ')}
                            ORDER BY n.published_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ total, page, pageSize, rows });
}));

r.get('/community/news/:slug', ah(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  const n = await one(`SELECT n.*, u.full_name AS author_name, EXISTS (SELECT 1 FROM news_acks k WHERE k.news_id=n.id AND k.user_id=$2) AS acked,
                              (SELECT count(*)::int FROM news_acks k WHERE k.news_id=n.id) AS acks_count
                         FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE n.slug=$1`, [slug, req.user.id]);
  if (!n) throw notFound('Contenuto non trovato');
  const editor = canEdit(req.user);
  if (!editor && (n.status !== 'PUBLISHED' || !canSee(req.user, n.audience))) throw notFound('Contenuto non trovato');
  const quiz = await quizFor(n.id);
  const mine = quiz ? await one('SELECT answers, score, total, at FROM news_quiz_answers WHERE news_id=$1 AND user_id=$2', [n.id, req.user.id]) : null;
  res.json({ ...n, files: await newsFiles(n.id), can_edit: editor, can_publish: canPublish(req.user),
    quiz: quiz ? { ...publicQuiz(quiz), answered: Boolean(mine), my: mine ? { ...mine, correct: quiz.questions.map((x) => x.answer) } : null } : null });
}));

// Risposte al questionario della circolare: una sola volta per utente; restituisce punteggio e risposte corrette
r.post('/community/news/:id/quiz', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one('SELECT id, title, protocol, audience, status FROM news WHERE id=$1', [id]);
  if (!n || n.status !== 'PUBLISHED' || !canSee(req.user, n.audience)) throw notFound('Contenuto non trovato');
  const quiz = await quizFor(id);
  if (!quiz) throw bad('Questa circolare non ha un questionario');
  if (await one('SELECT 1 FROM news_quiz_answers WHERE news_id=$1 AND user_id=$2', [id, req.user.id])) throw bad('Hai già risposto a questo questionario');
  const { answers } = parse(z.object({ answers: z.array(z.number().int().min(0).max(5)).min(1).max(5) }), req.body);
  if (answers.length !== quiz.questions.length) throw bad('Rispondi a tutte le domande');
  const score = quiz.questions.reduce((acc, x, i) => acc + (answers[i] === x.answer ? 1 : 0), 0);
  await q('INSERT INTO news_quiz_answers (news_id, user_id, answers, score, total) VALUES ($1,$2,$3,$4,$5)', [id, req.user.id, JSON.stringify(answers), score, quiz.questions.length]);
  await audit(req, 'NEWS_QUIZ_ANSWERED', { module: MODULE, entity: 'news', entityId: id, label: n.protocol || n.title, data: { score, total: quiz.questions.length } });
  res.json({ ok: true, score, total: quiz.questions.length, correct: quiz.questions.map((x) => x.answer) });
}));

r.post('/community/news/:id/ack', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one('SELECT id, title, slug, protocol, audience, status, requires_ack FROM news WHERE id=$1', [id]);
  if (!n || n.status !== 'PUBLISHED' || !canSee(req.user, n.audience)) throw notFound('Contenuto non trovato');
  if (!n.requires_ack) throw bad('Questo contenuto non richiede presa visione');
  if (await one('SELECT 1 FROM news_quiz WHERE news_id=$1', [id]) && !(await one('SELECT 1 FROM news_quiz_answers WHERE news_id=$1 AND user_id=$2', [id, req.user.id]))) throw bad('Rispondi prima al questionario di comprensione, poi conferma la presa visione');
  const ins = await q('INSERT INTO news_acks (news_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.id]);
  if (ins.rowCount) await audit(req, 'NEWS_ACKED', { module: MODULE, entity: 'news', entityId: id, label: n.protocol || n.title });
  // Le notifiche relative a questa circolare risultano lette
  await q(`UPDATE notifications SET read_at=coalesce(read_at, now()) WHERE user_id=$1 AND kind='CIRCOLARE' AND link=$2`, [req.user.id, `/community/news/${n.slug}`]).catch(() => {});
  res.json({ ok: true, acked: true });
}));

r.get('/community/news/:id/acks', requirePublisher, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one('SELECT id, title, protocol, audience, status, requires_ack, ack_due, published_at FROM news WHERE id=$1', [id]);
  if (!n) throw notFound('Contenuto non trovato');
  const expected = await audienceUsers(n.audience);
  const acks = await many('SELECT k.user_id, k.at, u.full_name, u.email FROM news_acks k JOIN users u ON u.id=k.user_id WHERE k.news_id=$1 ORDER BY k.at', [id]);
  const ackedIds = new Set(acks.map((a) => a.user_id));
  const missing = expected.filter((u) => !ackedIds.has(u.id)).map((u) => ({ user_id: u.id, full_name: u.full_name, email: u.email }));
  // Esiti del questionario: solo qui, per chi gestisce il widget
  const quiz = await quizFor(id);
  let quizReport = null;
  if (quiz) {
    const rows = await many('SELECT a.user_id, a.answers, a.score, a.total, a.at, u.full_name, u.email FROM news_quiz_answers a JOIN users u ON u.id=a.user_id WHERE a.news_id=$1 ORDER BY a.at', [id]);
    const perQuestion = quiz.questions.map((x, i) => ({ q: x.q, options: x.options, answer: x.answer, counts: x.options.map((_, oi) => rows.filter((r) => r.answers[i] === oi).length), correct: rows.filter((r) => r.answers[i] === x.answer).length }));
    quizReport = { questions: perQuestion, answered: rows.length, avg: rows.length ? Math.round((rows.reduce((a, r) => a + r.score, 0) / rows.length) * 10) / 10 : null, total: quiz.questions.length, rows, created_at: quiz.created_at };
  }
  res.json({ news: n, expected: expected.length, acked: acks, missing, quiz: quizReport });
}));

// ---- Gestione redazionale
r.get('/community/manage/news', requireEditor, ah(async (req, res) => {
  const { kind, status, page, pageSize } = parse(z.object({ kind: z.enum(['NEWS', 'CIRCOLARE', 'BLOG']).optional(), status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
  const params = []; const where = ['TRUE'];
  if (kind) { params.push(kind); where.push(`n.kind=$${params.length}`); }
  if (status) { params.push(status); where.push(`n.status=$${params.length}`); }
  const total = (await one(`SELECT count(*)::int AS n FROM news n WHERE ${where.join(' AND ')}`, params)).n;
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await many(`SELECT ${NEWS_LIST}, (SELECT count(*)::int FROM news_acks k WHERE k.news_id=n.id) AS acks_count
                             FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE ${where.join(' AND ')}
                            ORDER BY (n.status='DRAFT') DESC, coalesce(n.published_at, n.updated_at) DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ total, page, pageSize, rows });
}));

// Lettura completa di un contenuto per la scheda di modifica (l'elenco non porta il testo)
r.get('/community/manage/news/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one(`SELECT n.*, u.full_name AS author_name, (SELECT count(*)::int FROM news_acks k WHERE k.news_id=n.id) AS acks_count FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE n.id=$1`, [id]);
  if (!n) throw notFound('Contenuto non trovato');
  res.json({ ...n, files: await newsFiles(n.id), quiz: await quizFor(n.id) });
}));

r.post('/community/manage/news', requireEditor, ah(async (req, res) => {
  const b = parse(newsSchema, req.body);
  const audience = normalizeAudience(b.audience || { type: 'ALL' });
  if (b.cover_file_id) await checkFiles([b.cover_file_id], 'NEWS');
  const fileIds = await checkFiles(b.file_ids, 'NEWS');
  const requiresAck = b.kind === 'CIRCOLARE' ? (b.requires_ack ?? true) : false;
  const slug = await uniqueSlug(b.title);
  const n = await tx(async (c) => {
    const row = (await c.query(
      `INSERT INTO news (kind, title, slug, summary, body, cover_file_id, author_id, audience, requires_ack, ack_due, is_public, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.kind, b.title, slug, b.summary || null, b.body, b.cover_file_id || null, req.user.id, JSON.stringify(audience), requiresAck, requiresAck ? (b.ack_due || null) : null,
        b.kind === 'BLOG' ? Boolean(b.is_public) : false, b.tags || []])).rows[0];
    for (const f of fileIds) await c.query('INSERT INTO news_files (news_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, f]);
    return row;
  });
  await audit(req, 'NEWS_CREATED', { module: MODULE, entity: 'news', entityId: n.id, label: n.title, data: { kind: n.kind, audience } });
  res.status(201).json({ ...n, files: await newsFiles(n.id) });
}));

r.put('/community/manage/news/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(newsSchema.partial(), req.body);
  const cur = await one('SELECT * FROM news WHERE id=$1', [id]);
  if (!cur) throw notFound('Contenuto non trovato');
  if (cur.status === 'PUBLISHED' && !canPublish(req.user)) throw forbidden('Un contenuto pubblicato lo modifica solo chi può pubblicare');
  if (b.cover_file_id) await checkFiles([b.cover_file_id], 'NEWS');
  const fileIds = b.file_ids !== undefined ? await checkFiles(b.file_ids, 'NEWS') : null;
  const kind = b.kind || cur.kind;
  const sets = []; const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
  if (b.kind !== undefined) set('kind', b.kind);
  if (b.title !== undefined && b.title !== cur.title) { set('title', b.title); if (cur.status === 'DRAFT') set('slug', await uniqueSlug(b.title, id)); }
  if (b.summary !== undefined) set('summary', b.summary || null);
  if (b.body !== undefined) set('body', b.body);
  if (b.cover_file_id !== undefined) set('cover_file_id', b.cover_file_id || null);
  let audience = cur.audience;
  if (b.audience !== undefined) { audience = normalizeAudience(b.audience); set('audience', JSON.stringify(audience)); }
  const requiresAck = kind === 'CIRCOLARE' ? (b.requires_ack ?? cur.requires_ack) : false;
  set('requires_ack', requiresAck);
  if (b.ack_due !== undefined || !requiresAck) set('ack_due', requiresAck ? (b.ack_due ?? cur.ack_due) : null);
  if (b.is_public !== undefined || kind !== 'BLOG') set('is_public', kind === 'BLOG' ? Boolean(b.is_public ?? cur.is_public) : false);
  if (b.tags !== undefined) set('tags', b.tags);
  const n = await tx(async (c) => {
    const row = (await c.query(`UPDATE news SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, params)).rows[0];
    if (fileIds) {
      await c.query('DELETE FROM news_files WHERE news_id=$1', [id]);
      for (const f of fileIds) await c.query('INSERT INTO news_files (news_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, f]);
    }
    return row;
  });
  await audit(req, 'NEWS_UPDATED', { module: MODULE, entity: 'news', entityId: id, label: n.title, data: { ...b, body: b.body ? '(aggiornato)' : undefined } });
  indexNews(n).catch((e) => console.warn('[search]', e.message));
  res.json({ ...n, files: await newsFiles(n.id) });
}));

r.post('/community/manage/news/:id/publish', requirePublisher, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await one('SELECT * FROM news WHERE id=$1', [id]);
  if (!cur) throw notFound('Contenuto non trovato');
  if (cur.status === 'PUBLISHED') {
    // Già pubblicato: le modifiche sono già visibili; si aggiorna solo l'indice di ricerca, senza nuove notifiche
    await indexNews(cur).catch((e) => console.warn('[search]', e.message));
    return res.json({ ...cur, files: await newsFiles(cur.id), notified: 0, emails: 0, already_published: true });
  }
  const n = await tx(async (c) => {
    let protocol = cur.protocol;
    if (cur.kind === 'CIRCOLARE' && !protocol) protocol = await nextProtocol('CIRC', c);
    return (await c.query(`UPDATE news SET status='PUBLISHED', published_at=coalesce(published_at, now()), protocol=$2, updated_at=now() WHERE id=$1 RETURNING *`, [id, protocol])).rows[0];
  });
  await audit(req, 'NEWS_PUBLISHED', { module: MODULE, entity: 'news', entityId: id, label: n.protocol ? `${n.protocol} ${n.title}` : n.title, data: { kind: n.kind, audience: n.audience, requires_ack: n.requires_ack } });
  // Circolari: questionario di comprensione generato dal testo (se l'intelligenza artificiale è configurata); un errore non blocca la pubblicazione
  let quiz = null; let quizError = null;
  if (n.kind === 'CIRCOLARE' && !(await one('SELECT 1 FROM news_quiz WHERE news_id=$1', [id]))) {
    try { quiz = await buildQuiz(n, req.user.id); } catch (e) { quizError = e.message; console.warn('[quiz]', e.message); }
  }
  await indexNews(n).catch((e) => console.warn('[search]', e.message));

  // Notifica in app a tutti gli utenti nel perimetro; email solo per le circolari con presa visione obbligatoria
  const recipients = await audienceUsers(n.audience);
  const link = `/community/news/${n.slug}`;
  const isCirc = n.kind === 'CIRCOLARE';
  const notified = await notify(recipients.map((u) => u.id), {
    kind: isCirc ? 'CIRCOLARE' : 'NEWS', module_key: MODULE,
    title: isCirc ? `Nuova circolare ${n.protocol}: ${n.title}` : `${n.kind === 'BLOG' ? 'Nuovo articolo' : 'Nuova news'}: ${n.title}`,
    body: n.requires_ack ? `Presa visione richiesta${n.ack_due ? ` entro il ${itDate(n.ack_due)}` : ''}.` : (n.summary || null), link,
  });
  let emails = 0;
  if (isCirc && n.requires_ack) {
    const url = `${config.baseUrl}${link}`;
    const html = layout(`Circolare ${n.protocol}: ${n.title}`,
      `<p>${n.summary ? escapeHtml(n.summary) : 'È stata pubblicata una nuova circolare che richiede la tua presa visione.'}</p>` +
      `${n.ack_due ? `<p>Conferma la presa visione entro il <strong>${itDate(n.ack_due)}</strong>.</p>` : ''}` +
      `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#1C505E;color:#fff;border-radius:8px;text-decoration:none">Leggi e conferma</a></p>` +
      `<p style="color:#5b6f75;font-size:12px">Destinatari: ${audienceLabel(n.audience)}.</p>`);
    const targets = recipients.filter((u) => u.notify_email && u.email);
    emails = targets.length;
    // Invio in sfondo: la risposta non aspetta la posta
    setImmediate(() => Promise.allSettled(targets.map((u) => sendMail({ to: u.email, subject: `Circolare ${n.protocol}: ${n.title}`, html, ref: `news:${n.id}` }))).catch(() => {}));
  }
  res.json({ ...n, files: await newsFiles(n.id), notified, emails, quiz: publicQuiz(quiz), quiz_error: quizError });
}));

// Questionario: rigenera (anche su circolari pubblicate: gli esiti precedenti si azzerano) o rimuove
r.post('/community/manage/news/:id/quiz', requirePublisher, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one('SELECT * FROM news WHERE id=$1', [id]);
  if (!n) throw notFound('Contenuto non trovato');
  if (n.kind !== 'CIRCOLARE') throw bad('Il questionario è previsto solo per le circolari');
  if (!aiEnabled()) throw bad('Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni');
  const quiz = await buildQuiz(n, req.user.id);
  await audit(req, 'NEWS_QUIZ_GENERATED', { module: MODULE, entity: 'news', entityId: id, label: n.protocol || n.title });
  res.json({ quiz });
}));
r.delete('/community/manage/news/:id/quiz', requirePublisher, ah(async (req, res) => {
  const id = idParam(req.params.id);
  await q('DELETE FROM news_quiz WHERE news_id=$1', [id]);
  await q('DELETE FROM news_quiz_answers WHERE news_id=$1', [id]);
  await audit(req, 'NEWS_QUIZ_REMOVED', { module: MODULE, entity: 'news', entityId: id });
  res.json({ ok: true });
}));

r.delete('/community/manage/news/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await one('SELECT * FROM news WHERE id=$1', [id]);
  if (!cur) throw notFound('Contenuto non trovato');
  if (cur.status === 'DRAFT') {
    await q('DELETE FROM news WHERE id=$1', [id]);
    await audit(req, 'NEWS_DELETED', { module: MODULE, entity: 'news', entityId: id, label: cur.title });
  } else {
    // Contenuti già pubblicati: si archiviano (restano protocollo e prese visione), non si cancellano
    if (!canPublish(req.user)) throw forbidden('Un contenuto pubblicato lo archivia solo chi può pubblicare');
    await q(`UPDATE news SET status='ARCHIVED', updated_at=now() WHERE id=$1`, [id]);
    await audit(req, 'NEWS_ARCHIVED', { module: MODULE, entity: 'news', entityId: id, label: cur.protocol ? `${cur.protocol} ${cur.title}` : cur.title });
  }
  removeNews(cur).catch(() => {});
  res.json({ ok: true, archived: cur.status !== 'DRAFT' });
}));

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// =====================================================================================================
// Avvisi
// =====================================================================================================
const noticeSchema = z.object({
  title: z.string().trim().min(2).max(200), body: z.string().trim().max(2000).nullable().optional(),
  severity: z.enum(['INFO', 'WARN', 'CRIT']).default('INFO'), audience: audienceSchema.optional(), link: z.string().max(500).nullable().optional(),
  starts_at: isoDate.optional(), ends_at: isoDate.nullable().optional(),
});
const activeNoticesSql = (user, params) => {
  const a = audienceSql(user, 'n.audience', params);
  return `n.starts_at <= now() AND (n.ends_at IS NULL OR n.ends_at > now()) AND ${a.sql}`;
};

r.get('/community/notices', ah(async (req, res) => {
  const params = [];
  const where = activeNoticesSql(req.user, params);
  res.json(await many(`SELECT n.id, n.title, n.body, n.severity, n.audience, n.link, n.starts_at, n.ends_at, n.created_at FROM notices n WHERE ${where} ORDER BY (n.severity='CRIT') DESC, (n.severity='WARN') DESC, n.starts_at DESC`, params));
}));
r.get('/community/manage/notices', requireEditor, ah(async (_req, res) => {
  res.json(await many(`SELECT n.*, u.full_name AS author_name, (n.starts_at <= now() AND (n.ends_at IS NULL OR n.ends_at > now())) AS active FROM notices n LEFT JOIN users u ON u.id=n.author_id ORDER BY n.starts_at DESC LIMIT 200`));
}));
r.post('/community/manage/notices', requireEditor, ah(async (req, res) => {
  const b = parse(noticeSchema, req.body);
  const audience = normalizeAudience(b.audience || { type: 'ALL' });
  if (b.ends_at && b.starts_at && new Date(b.ends_at) <= new Date(b.starts_at)) throw bad('La fine deve essere successiva all\'inizio');
  const n = await one(`INSERT INTO notices (title, body, severity, audience, link, starts_at, ends_at, author_id) VALUES ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8) RETURNING *`,
    [b.title, b.body || null, b.severity, JSON.stringify(audience), b.link || null, b.starts_at || null, b.ends_at || null, req.user.id]);
  await audit(req, 'NOTICE_CREATED', { module: MODULE, entity: 'notice', entityId: n.id, label: n.title, data: { severity: n.severity, audience } });
  indexNotice(n).catch(() => {});
  res.status(201).json(n);
}));
r.put('/community/manage/notices/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(noticeSchema.partial(), req.body);
  const sets = []; const params = [id];
  for (const [k, v] of Object.entries(b)) {
    params.push(k === 'audience' ? JSON.stringify(normalizeAudience(v)) : v ?? null);
    sets.push(`${k}=$${params.length}`);
  }
  if (!sets.length) return res.json({ ok: true });
  const n = await one(`UPDATE notices SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  if (!n) throw notFound('Avviso non trovato');
  await audit(req, 'NOTICE_UPDATED', { module: MODULE, entity: 'notice', entityId: id, label: n.title, data: b });
  indexNotice(n).catch(() => {});
  res.json(n);
}));
r.delete('/community/manage/notices/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one('DELETE FROM notices WHERE id=$1 RETURNING id, title', [id]);
  if (!n) throw notFound('Avviso non trovato');
  await audit(req, 'NOTICE_DELETED', { module: MODULE, entity: 'notice', entityId: id, label: n.title });
  removeFromIndex('notice', id).catch(() => {});
  res.json({ ok: true });
}));

// =====================================================================================================
// Calendario
// =====================================================================================================
const eventSchema = z.object({
  title: z.string().trim().min(2).max(200), description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(['EVENTO', 'RIUNIONE', 'FORMAZIONE', 'SCADENZA', 'TURNO', 'FESTIVITA', 'ALTRO']).default('EVENTO'),
  starts_at: isoDate, ends_at: isoDate.nullable().optional(), all_day: z.boolean().default(false),
  location: z.string().trim().max(200).nullable().optional(), site_id: z.number().int().nullable().optional(),
  audience: audienceSchema.optional(), link: z.string().max(500).nullable().optional(),
});
const EVENT_SELECT = `e.id, e.title, e.description, e.kind, e.starts_at, e.ends_at, e.all_day, e.location, e.site_id, s.name AS site_name, e.audience, e.source, e.link, e.author_id, u.full_name AS author_name, e.created_at`;
const isSelfReminder = (u, a) => a.type === 'USERS' && a.ids.length === 1 && a.ids[0] === u.id;

r.get('/community/events', ah(async (req, res) => {
  const { from, to, site_id } = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), site_id: z.coerce.number().int().optional() }), req.query);
  const params = [req.user.id];
  const a = audienceSql(req.user, 'e.audience', params);
  const where = [`(${a.sql} OR e.author_id = $1)`];
  const start = from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000);
  const end = to ? new Date(to) : new Date(start.getTime() + 62 * 24 * 3600 * 1000);
  if (end <= start) throw bad('Intervallo di date non valido');
  if (end - start > 400 * 24 * 3600 * 1000) throw bad('Intervallo troppo ampio (massimo 400 giorni)');
  params.push(start, end); where.push(`coalesce(e.ends_at, e.starts_at) >= $${params.length - 1} AND e.starts_at < $${params.length}`);
  if (site_id) { params.push(site_id); where.push(`(e.site_id = $${params.length} OR e.site_id IS NULL)`); }
  res.json(await many(`SELECT ${EVENT_SELECT} FROM events e LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN users u ON u.id=e.author_id WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 500`, params));
}));

r.post('/community/events', ah(async (req, res) => {
  const b = parse(eventSchema, req.body);
  const audience = normalizeAudience(b.audience || (canEdit(req.user) ? { type: 'ALL' } : { type: 'USERS', ids: [req.user.id] }));
  if (!canEdit(req.user) && !isSelfReminder(req.user, audience)) throw forbidden('Puoi creare solo promemoria personali (audience: te stesso)');
  if (b.ends_at && new Date(b.ends_at) < new Date(b.starts_at)) throw bad('La fine deve essere successiva all\'inizio');
  const e = await one(`INSERT INTO events (title, description, kind, starts_at, ends_at, all_day, location, site_id, audience, link, author_id)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [b.title, b.description || null, b.kind, new Date(b.starts_at), b.ends_at ? new Date(b.ends_at) : null, b.all_day, b.location || null, b.site_id || null, JSON.stringify(audience), b.link || null, req.user.id]);
  const row = await one(`SELECT ${EVENT_SELECT} FROM events e LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN users u ON u.id=e.author_id WHERE e.id=$1`, [e.id]);
  await audit(req, 'EVENT_CREATED', { module: MODULE, entity: 'event', entityId: e.id, label: b.title, data: { kind: b.kind, starts_at: b.starts_at, audience } });
  indexEvent(row).catch(() => {});
  res.status(201).json(row);
}));

async function loadEditableEvent(req, id) {
  const e = await one('SELECT * FROM events WHERE id=$1', [id]);
  if (!e) throw notFound('Evento non trovato');
  if (e.source !== 'MANUAL' && !isAdmin(req.user)) throw forbidden('Evento sincronizzato da un\'altra fonte: non modificabile');
  if (!canEdit(req.user) && e.author_id !== req.user.id) throw forbidden('Puoi modificare solo i tuoi eventi');
  return e;
}
r.put('/community/events/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await loadEditableEvent(req, id);
  const b = parse(eventSchema.partial(), req.body);
  const sets = []; const params = [id];
  for (const [k, v] of Object.entries(b)) {
    let val = v ?? null;
    if (k === 'audience') {
      const a = normalizeAudience(v);
      if (!canEdit(req.user) && !isSelfReminder(req.user, a)) throw forbidden('Puoi gestire solo promemoria personali');
      val = JSON.stringify(a);
    }
    if ((k === 'starts_at' || k === 'ends_at') && val) val = new Date(val);
    params.push(val); sets.push(`${k}=$${params.length}`);
  }
  if (!sets.length) return res.json({ ok: true });
  await q(`UPDATE events SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
  const row = await one(`SELECT ${EVENT_SELECT} FROM events e LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN users u ON u.id=e.author_id WHERE e.id=$1`, [id]);
  if (row.ends_at && new Date(row.ends_at) < new Date(row.starts_at)) { await q('UPDATE events SET ends_at=NULL WHERE id=$1', [id]); row.ends_at = null; }
  await audit(req, 'EVENT_UPDATED', { module: MODULE, entity: 'event', entityId: id, label: row.title, data: b });
  indexEvent(row).catch(() => {});
  res.json(row);
}));
r.delete('/community/events/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await loadEditableEvent(req, id);
  await q('DELETE FROM events WHERE id=$1', [id]);
  await audit(req, 'EVENT_DELETED', { module: MODULE, entity: 'event', entityId: id, label: cur.title });
  removeFromIndex('event', id).catch(() => {});
  res.json({ ok: true });
}));

// =====================================================================================================
// Frase del giorno
// =====================================================================================================
const quoteView = (x) => (x ? { id: x.id, text: x.text, author_label: x.author_label, theme: x.theme, for_date: x.for_date } : null);
r.get('/community/quote', ah(async (_req, res) => res.json(quoteView(await ensureDailyQuote()))));

r.get('/community/manage/quotes', requireEditor, ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'PUBLISHED']).optional() }), req.query);
  const params = []; let where = '';
  if (status) { params.push(status); where = 'WHERE q.status=$1'; }
  res.json(await many(`SELECT q.*, a.full_name AS approved_by_name FROM quotes q LEFT JOIN users a ON a.id=q.approved_by ${where} ORDER BY (q.status='PROPOSED') DESC, (q.for_date >= CURRENT_DATE) DESC, q.for_date ASC NULLS LAST, q.created_at DESC LIMIT 600`, params));
}));
r.post('/community/manage/quotes/generate', requireEditor, ah(async (req, res) => {
  const { n } = parse(z.object({ n: z.number().int().min(1).max(20).default(7) }), req.body || {});
  if (!aiEnabled()) return res.status(503).json({ error: 'Ricerca intelligente non configurata', code: 'AI_DISABLED' });
  const values = await getSetting('community.values', []);
  const quotes = await generateQuotes(values, n, { userId: req.user.id });
  if (!quotes.length) throw new HttpError(502, 'Nessuna frase generata');
  const rows = [];
  for (const x of quotes) rows.push(await one('INSERT INTO quotes (text, author_label, theme, status, created_by) VALUES ($1,$2,$3,\'PROPOSED\',$4) RETURNING *', [x.text, x.author_label, x.theme, req.user.id]));
  await audit(req, 'QUOTES_GENERATED', { module: MODULE, entity: 'quote', data: { n: rows.length } });
  res.status(201).json(rows);
}));
// Inserimento manuale (in aggiunta alla generazione): nasce PROPOSED, oppure APPROVED se lo chiede chi pubblica
r.post('/community/manage/quotes', requireEditor, ah(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(12).max(180), author_label: z.string().trim().max(120).nullable().optional(), theme: z.string().trim().max(60).nullable().optional(), status: z.enum(['PROPOSED', 'APPROVED']).default('PROPOSED') }), req.body);
  if (/[–—]/.test(b.text)) throw bad('Il testo non deve contenere trattini lunghi');
  const status = b.status === 'APPROVED' && canPublish(req.user) ? 'APPROVED' : 'PROPOSED';
  const row = await one('INSERT INTO quotes (text, author_label, theme, status, created_by, approved_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.text, b.author_label || 'Valori Toscana Diagnostica', b.theme || null, status, req.user.id, status === 'APPROVED' ? req.user.id : null]);
  await audit(req, 'QUOTE_CREATED', { module: MODULE, entity: 'quote', entityId: row.id, label: row.text.slice(0, 80) });
  res.status(201).json(row);
}));
r.put('/community/manage/quotes/:id', requireEditor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED']).optional(), text: z.string().trim().min(12).max(180).optional(), author_label: z.string().trim().max(120).nullable().optional(), theme: z.string().trim().max(60).nullable().optional(), for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }), req.body);
  const cur = await one('SELECT * FROM quotes WHERE id=$1', [id]);
  if (!cur) throw notFound('Frase non trovata');
  if (cur.status === 'PUBLISHED' && b.status) throw bad('Una frase già pubblicata non cambia stato');
  if (b.text && /[\u2013\u2014]/.test(b.text)) throw bad('Il testo non deve contenere trattini lunghi');
  const sets = []; const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
  if (b.text !== undefined) set('text', b.text);
  if (b.author_label !== undefined) set('author_label', b.author_label);
  if (b.theme !== undefined) set('theme', b.theme);
  if (b.for_date !== undefined) { if (b.for_date && await one('SELECT 1 FROM quotes WHERE for_date=$1 AND id<>$2', [b.for_date, id])) throw bad('Per quella data è già programmata un\'altra frase'); set('for_date', b.for_date); }
  if (b.status !== undefined) { set('status', b.status); set('approved_by', b.status === 'APPROVED' ? req.user.id : null); }
  if (!sets.length) return res.json(cur);
  const row = await one(`UPDATE quotes SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  await audit(req, 'QUOTE_UPDATED', { module: MODULE, entity: 'quote', entityId: id, label: row.text.slice(0, 80), data: b });
  res.json(row);
}));

// =====================================================================================================
// Meteo
// =====================================================================================================
async function weatherFor(user, siteId) {
  const id = siteId || user.site_id || user.site_ids?.[0] || null;
  if (id) {
    const site = await one('SELECT id, code, name, city, lat, lng FROM sites WHERE id=$1', [id]);
    if (site) return weatherForSite(site);
  }
  const def = await getSetting('community.weather_default', null);
  if (def?.lat != null && def?.lng != null) return weatherForPoint(def);
  const hq = await one(`SELECT id, code, name, city, lat, lng FROM sites WHERE active ORDER BY (kind='HEADQUARTER') DESC, sort_order, id LIMIT 1`);
  if (hq) return weatherForSite(hq);
  return { site: null, city: null, unavailable: true, reason: 'Nessuna sede configurata' };
}
// Meteo della sede da cui si apre la Suite: con la posizione del browser (lat/lng) si prende la sede attiva più vicina
// entro 25 km; altrimenti il punto stesso; senza posizione, la sede dell'utente (o la sede principale).
const distKm = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
r.get('/community/weather', ah(async (req, res) => {
  const { site_id, lat, lng } = parse(z.object({ site_id: z.coerce.number().int().optional(), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }), req.query);
  if (lat != null && lng != null && !site_id) {
    const sites = await many('SELECT id, code, name, city, lat, lng FROM sites WHERE active AND lat IS NOT NULL AND lng IS NOT NULL');
    const here = { lat, lng };
    const near = sites.map((s) => ({ s, d: distKm(here, { lat: Number(s.lat), lng: Number(s.lng) }) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 25) return res.json({ ...(await weatherForSite(near.s)), located: true, distance_km: Math.round(near.d) });
    return res.json({ ...(await weatherForPoint({ lat, lng, city: 'La tua posizione' })), located: true });
  }
  res.json(await weatherFor(req.user, site_id));
}));

// =====================================================================================================
// Home: riepilogo
// =====================================================================================================
r.get('/community/home', ah(async (req, res) => {
  const u = req.user;
  const noticesP = (async () => { const params = []; const where = activeNoticesSql(u, params); return many(`SELECT n.id, n.title, n.body, n.severity, n.link, n.starts_at, n.ends_at FROM notices n WHERE ${where} ORDER BY (n.severity='CRIT') DESC, (n.severity='WARN') DESC, n.starts_at DESC LIMIT 10`, params); })();
  const newsP = (async () => {
    const params = [u.id]; const a = audienceSql(u, 'n.audience', params);
    return many(`SELECT n.id, n.kind, n.title, n.slug, n.summary, n.cover_file_id, n.published_at, n.requires_ack, n.protocol, n.tags, EXISTS (SELECT 1 FROM news_acks k WHERE k.news_id=n.id AND k.user_id=$1) AS acked
                   FROM news n WHERE n.status='PUBLISHED' AND ${a.sql} ORDER BY n.published_at DESC LIMIT 5`, params);
  })();
  const circP = (async () => {
    const params = [u.id]; const a = audienceSql(u, 'n.audience', params);
    return many(`SELECT n.id, n.title, n.slug, n.summary, n.published_at, n.ack_due, n.protocol FROM news n
                  WHERE n.status='PUBLISHED' AND n.requires_ack AND ${a.sql} AND NOT EXISTS (SELECT 1 FROM news_acks k WHERE k.news_id=n.id AND k.user_id=$1)
                  ORDER BY n.ack_due NULLS LAST, n.published_at DESC LIMIT 20`, params);
  })();
  const eventsP = (async () => {
    const params = [u.id]; const a = audienceSql(u, 'e.audience', params);
    return many(`SELECT ${EVENT_SELECT} FROM events e LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN users u ON u.id=e.author_id
                  WHERE (${a.sql} OR e.author_id=$1) AND coalesce(e.ends_at, e.starts_at) >= now() - interval '1 hour' AND e.starts_at < now() + interval '7 days'
                  ORDER BY e.starts_at LIMIT 20`, params);
  })();
  const postsP = (async () => {
    const params = [u.id]; const a = audienceSql(u, 'p.audience', params);
    return many(`${POST_SELECT('$1')} WHERE p.deleted_at IS NULL AND (${a.sql} OR p.author_id=$1) ORDER BY p.pinned DESC, p.created_at DESC LIMIT 3`, params);
  })();
  const birthdaysP = many(`SELECT p.id, p.last_name, p.first_name, p.job_title, s.name AS site_name FROM people p LEFT JOIN sites s ON s.id=p.site_id
                            WHERE p.status='ATTIVO' AND p.birth_date IS NOT NULL
                              AND to_char(p.birth_date, 'MM-DD') = to_char((now() AT TIME ZONE 'Europe/Rome')::date, 'MM-DD') ORDER BY p.last_name LIMIT 20`);
  const quoteP = ensureDailyQuote().catch(() => null);
  const weatherP = weatherFor(u, null).catch(() => ({ unavailable: true }));
  const [notices, news, circolari_da_leggere, events, posts, birthdays, quote, weather] = await Promise.all([noticesP, newsP, circP, eventsP, postsP, birthdaysP, quoteP, weatherP]);
  res.json({ notices, news, circolari_da_leggere, events, quote: quoteView(quote), weather, posts, birthdays });
}));

// =====================================================================================================
// Vetrina pubblica (montata su /api/public senza login): blog con is_public e PUBLISHED
// =====================================================================================================
const pub = Router();
const BLOG_PUBLIC = `n.id, n.title, n.slug, n.summary, n.cover_file_id, n.published_at, n.tags, u.full_name AS author_name`;
pub.get('/blog', ah(async (req, res) => {
  const { page, pageSize, tag } = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12), tag: z.string().max(40).optional() }), req.query);
  const params = []; const where = [`n.kind='BLOG'`, 'n.is_public', `n.status='PUBLISHED'`];
  if (tag) { params.push(tag); where.push(`$${params.length} = ANY(n.tags)`); }
  const total = (await one(`SELECT count(*)::int AS n FROM news n WHERE ${where.join(' AND ')}`, params)).n;
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await many(`SELECT ${BLOG_PUBLIC} FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE ${where.join(' AND ')} ORDER BY n.published_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.set('Cache-Control', 'public, max-age=120');
  res.json({ total, page, pageSize, rows });
}));
pub.get('/blog/:slug', ah(async (req, res) => {
  const n = await one(`SELECT ${BLOG_PUBLIC}, n.body FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE n.slug=$1 AND n.kind='BLOG' AND n.is_public AND n.status='PUBLISHED'`, [String(req.params.slug).slice(0, 120)]);
  if (!n) throw notFound('Articolo non trovato');
  res.set('Cache-Control', 'public, max-age=120');
  res.json(n);
}));
// Immagini di copertina e allegati degli articoli pubblici (unici file leggibili senza sessione)
pub.get('/blog-files/:id', blob.requireBlob, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const f = await one(`SELECT f.* FROM files f WHERE f.id=$1 AND f.deleted_at IS NULL AND f.scope='NEWS'
                         AND EXISTS (SELECT 1 FROM news n WHERE n.kind='BLOG' AND n.is_public AND n.status='PUBLISHED' AND (n.cover_file_id=f.id OR n.id IN (SELECT news_id FROM news_files WHERE file_id=f.id)))`, [id]);
  if (!f) throw notFound('File non trovato');
  await streamFile(res, f);
}));
r.public = pub;

export default r;
