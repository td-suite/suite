// Suite TD · indice di ricerca unificato (tabella search_index, full-text italiano + trigram sul titolo).
// Ogni voce porta il proprio perimetro di visibilità (audience) e il flag sensitive (mai passato a modelli esterni).
import { q, many } from '../db.js';
import { audienceSql, isInternal } from './audience.js';
import { RUBRICA_PUBLIC_SQL } from './esterni.js';

const ALL = { type: 'ALL' };
const INTERNAL = { type: 'INTERNAL' };
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n).trim()}...` : t; };
const stripMd = (s) => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~|]/g, ' ');

export async function upsertIndex({ kind, ref_id, module_key = null, title, body = null, link, audience = ALL, sensitive = false }) {
  await q(`INSERT INTO search_index (kind, ref_id, module_key, title, body, link, audience, sensitive, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (kind, ref_id) DO UPDATE SET module_key=EXCLUDED.module_key, title=EXCLUDED.title, body=EXCLUDED.body, link=EXCLUDED.link,
             audience=EXCLUDED.audience, sensitive=EXCLUDED.sensitive, updated_at=now()`,
    [kind, String(ref_id), module_key, clip(title, 300) || '(senza titolo)', body ? clip(body, 20000) : null, link, JSON.stringify(audience || ALL), Boolean(sensitive)]);
}
export async function removeFromIndex(kind, ref_id) {
  await q('DELETE FROM search_index WHERE kind=$1 AND ref_id=$2', [kind, String(ref_id)]);
}
// Toglie dall'indice le voci di un tipo che non compaiono più tra quelle valide
async function pruneKind(kind, keep) {
  await q('DELETE FROM search_index WHERE kind=$1 AND NOT (ref_id = ANY($2::text[]))', [kind, keep.map(String)]);
}

const newsKind = (n) => (n.kind === 'CIRCOLARE' ? 'circolare' : n.kind === 'BLOG' ? 'blog' : 'news');

// ---- News, circolari, blog: solo pubblicate, con la propria audience
export async function indexNews(n) {
  if (!n) return;
  if (n.status !== 'PUBLISHED') { await removeNews(n); return; }
  const extra = [n.protocol, n.summary, stripMd(n.body), (n.tags || []).join(' ')].filter(Boolean).join('\n');
  await upsertIndex({ kind: newsKind(n), ref_id: n.id, module_key: 'comunicazione', title: n.title, body: extra, link: `/community/news/${n.slug}`, audience: n.audience || ALL, sensitive: false });
}
export async function removeNews(n) {
  for (const k of ['news', 'circolare', 'blog']) await removeFromIndex(k, n.id);
}

// ---- Post in bacheca: primi 300 caratteri
export async function indexPost(p, author) {
  if (!p) return;
  if (p.deleted_at) { await removeFromIndex('post', p.id); return; }
  const who = author?.full_name || p.author_name || 'Bacheca';
  const text = clip(p.body, 300);
  await upsertIndex({ kind: 'post', ref_id: p.id, module_key: 'comunicazione', title: `${who}: ${clip(p.body, 80)}`, body: text, link: `/community/posts/${p.id}`, audience: p.audience || ALL, sensitive: false });
}

// ---- Eventi
export async function indexEvent(e) {
  if (!e) return;
  const when = e.starts_at ? new Date(e.starts_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: e.all_day ? undefined : 'short' }) : '';
  const body = [e.kind, when, e.location, e.site_name, e.description].filter(Boolean).join(' · ');
  await upsertIndex({ kind: 'event', ref_id: e.id, module_key: 'comunicazione', title: e.title, body, link: `/community/calendar?event=${e.id}`, audience: e.audience || ALL, sensitive: false });
}

// ---- Avvisi (solo quelli non scaduti)
export async function indexNotice(n) {
  if (!n) return;
  if (n.ends_at && new Date(n.ends_at) < new Date()) { await removeFromIndex('notice', n.id); return; }
  await upsertIndex({ kind: 'notice', ref_id: n.id, module_key: 'comunicazione', title: n.title, body: [n.severity, n.body].filter(Boolean).join(' · '), link: n.link || '/', audience: n.audience || ALL, sensitive: false });
}

// ---- Persone attive: solo nome, ruolo, area, sede e contatti aziendali (sensitive=false). Niente dati personali
export async function indexPerson(p) {
  if (!p) return;
  if (p.status !== 'ATTIVO') { await removeFromIndex('person', p.id); return; }
  const body = [p.job_title, p.discipline, p.area, p.site_name, p.email, p.phone_office || p.phone].filter(Boolean).join(' · ');
  await upsertIndex({ kind: 'person', ref_id: p.id, module_key: 'rubrica', title: `${p.last_name} ${p.first_name}`, body, link: `/people/${p.id}`, audience: ALL, sensitive: false });
}
const PERSON_SQL = `SELECT p.id, p.status, p.last_name, p.first_name, p.job_title, p.discipline, p.area, p.email, p.phone, p.phone_office, s.name AS site_name
                      FROM people p LEFT JOIN sites s ON s.id=p.site_id`;
export async function indexPersonById(id) { await indexPerson(await (await q(`${PERSON_SQL} WHERE p.id=$1`, [id])).rows[0]); }

// ---- Sedi
export async function indexSite(s) {
  if (!s) return;
  if (!s.active) { await removeFromIndex('site', s.id); return; }
  const body = [s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email, s.opening_hours, s.organization_name].filter(Boolean).join(' · ');
  await upsertIndex({ kind: 'site', ref_id: s.id, module_key: null, title: [s.code, s.name].filter(Boolean).join(' · '), body, link: `/sites/${s.id}`, audience: ALL, sensitive: false });
}

// ---- Organizzazioni: dati di business, solo utenti interni e mai verso il modello
export async function indexOrg(o) {
  if (!o) return;
  if (!o.active) { await removeFromIndex('org', o.id); return; }
  const body = [o.kind, o.city, o.province, o.vat_number, o.email, o.phone, o.website].filter(Boolean).join(' · ');
  await upsertIndex({ kind: 'org', ref_id: o.id, module_key: null, title: o.name, body, link: `/organizations/${o.id}`, audience: INTERNAL, sensitive: true });
}

// ---- Moduli (widget): titolo e tagline, link = href usato dalla home
export async function indexModule(m) {
  if (!m) return;
  if (!m.active) { await removeFromIndex('module', m.key); return; }
  const href = m.kind === 'NATIVE' ? (m.route || '/') : `/go/${m.key}`;
  const audience = m.kind === 'PUBLIC' ? ALL : m.key === 'admin' ? { type: 'USERS', ids: [] } : { type: 'MODULE', key: m.key };
  await upsertIndex({ kind: 'module', ref_id: m.key, module_key: m.key, title: m.name, body: [m.tagline, m.description].filter(Boolean).join(' · '), link: href, audience, sensitive: false });
}

// ---- Ricostruzione completa
export async function reindexAll() {
  const stats = {};
  const news = await many('SELECT * FROM news WHERE status=\'PUBLISHED\'');
  for (const n of news) await indexNews(n);
  for (const k of ['news', 'circolare', 'blog']) await pruneKind(k, news.filter((n) => newsKind(n) === k).map((n) => n.id));
  stats.news = news.length;

  const posts = await many('SELECT p.*, u.full_name AS author_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.deleted_at IS NULL');
  for (const p of posts) await indexPost(p);
  await pruneKind('post', posts.map((p) => p.id));
  stats.posts = posts.length;

  const events = await many('SELECT e.*, s.name AS site_name FROM events e LEFT JOIN sites s ON s.id=e.site_id WHERE e.starts_at > now() - interval \'180 days\'');
  for (const e of events) await indexEvent(e);
  await pruneKind('event', events.map((e) => e.id));
  stats.events = events.length;

  const notices = await many('SELECT * FROM notices WHERE ends_at IS NULL OR ends_at > now()');
  for (const n of notices) await indexNotice(n);
  await pruneKind('notice', notices.map((n) => n.id));
  stats.notices = notices.length;

  const people = await many(`${PERSON_SQL} WHERE p.status='ATTIVO'`);
  for (const p of people) await indexPerson(p);
  await pruneKind('person', people.map((p) => p.id));
  stats.people = people.length;

  const sites = await many('SELECT s.*, o.name AS organization_name FROM sites s LEFT JOIN organizations o ON o.id=s.organization_id WHERE s.active');
  for (const s of sites) await indexSite(s);
  await pruneKind('site', sites.map((s) => s.id));
  stats.sites = sites.length;

  const orgs = await many('SELECT * FROM organizations WHERE active');
  for (const o of orgs) await indexOrg(o);
  await pruneKind('org', orgs.map((o) => o.id));
  stats.orgs = orgs.length;

  const mods = await many('SELECT * FROM modules WHERE active');
  for (const m of mods) await indexModule(m);
  await pruneKind('module', mods.map((m) => m.key));
  stats.modules = mods.length;
  return stats;
}

// ---- Ricerca: full-text (plainto_tsquery italiano) + similarità trigram sul titolo, filtrata per audience. Massimo 30 risultati
export async function search(user, qtext, kind = '') {
  const text = String(qtext || '').trim().slice(0, 200);
  if (text.length < 2) return [];
  const params = [text];
  const a = audienceSql(user, 's.audience', params);
  let kindSql = '';
  if (kind) { params.push(String(kind)); kindSql = `AND s.kind = $${params.length}`; }
  // Accessi esterni (29/10/2026): persone solo delle unità con contatto pubblico, sedi solo del proprio perimetro (ambiti dei grant
  // e sedi della Legal entity), niente Legal entity (audience INTERNAL già). Gli altri tipi seguono la loro audience.
  if (!isInternal(user)) {
    params.push((user.site_ids || []).map(Number)); const sitesP = `$${params.length}`;
    params.push(user.organization_id ? Number(user.organization_id) : -1); const orgP = `$${params.length}`;
    kindSql += ` AND (s.kind NOT IN ('person','site','org')
      OR (s.kind = 'person' AND EXISTS (SELECT 1 FROM people p WHERE p.id::text = s.ref_id AND p.status = 'ATTIVO' AND ${RUBRICA_PUBLIC_SQL}))
      OR (s.kind = 'site' AND EXISTS (SELECT 1 FROM sites st WHERE st.id::text = s.ref_id AND (st.id = ANY(${sitesP}::int[]) OR st.organization_id = ${orgP}))))`;
  }
  const rows = await many(
    `WITH qq AS (SELECT plainto_tsquery('italian', $1) AS tsq, lower($1) AS lq)
     SELECT s.kind, s.ref_id, s.title, s.link, s.module_key, s.sensitive,
            ts_headline('italian', coalesce(s.body, s.title), qq.tsq, 'MaxWords=28, MinWords=10, ShortWord=3, MaxFragments=1, StartSel=<b>, StopSel=</b>') AS snippet,
            left(coalesce(s.body, ''), 600) AS body,
            (CASE WHEN qq.tsq::text <> '' AND s.tsv @@ qq.tsq THEN ts_rank_cd(s.tsv, qq.tsq) ELSE 0 END) + similarity(lower(s.title), qq.lq) * 0.6
              + (CASE WHEN lower(s.title) LIKE '%' || qq.lq || '%' THEN 0.3 ELSE 0 END) AS score
       FROM search_index s, qq
      WHERE ((qq.tsq::text <> '' AND s.tsv @@ qq.tsq) OR similarity(lower(s.title), qq.lq) > 0.25 OR lower(s.title) LIKE '%' || qq.lq || '%')
        AND ${a.sql} ${kindSql}
      ORDER BY score DESC, s.updated_at DESC
      LIMIT 30`, params);
  return rows;
}

export function registerSearchJobs(registerJob) {
  registerJob('search:reindex', 60, reindexAll, { runAtStart: true });
}
