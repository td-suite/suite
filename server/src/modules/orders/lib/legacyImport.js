// Importazione del catalogo articoli dall'app originale (orders.toscanadiagnostica.it/articoli) nel modulo Ordini avviato vuoto.
// Richiesta del CEO (29/10/2026): "In Ordini, precarica il catalogo articoli che avevamo". Interfaccia comune del core
// (routes/travaso.js): legacyMatch descrive cosa c'è nell'app (nessuna anagrafica da abbinare: il catalogo non dipende da sedi o
// persone); legacyImport copia categorie, articoli e abbinamenti esame → articolo con gli id tradotti (legacy_import_map), ripetibile.
// Non si copiano le confezioni per struttura (packages) né le giacenze: dipendono dalle strutture dell'app, che nella Suite sono sedi e
// Legal entity dell'anagrafica unica.
import { moduleDb } from '../../../lib/modules.js';

const KEY = 'orders';
const db = moduleDb(KEY);

const ART_COLS = ['code', 'category_code', 'name', 'unit', 'pack_size', 'pack_label', 'color', 'gtin', 'coverage_factor', 'min_stock_packs', 'lab_only', 'active', 'sort', 'silva_code', 'source', 'visible_all', 'visible_sedi', 'visible_service'];

// Colonne davvero presenti nell'app originale (versioni diverse del catalogo): si copiano solo quelle
async function legacyColumns(legacyQuery, table) {
  const rows = await legacyQuery(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Set(rows.map((r) => r.column_name));
}

export async function legacyMatch({ legacyQuery }) {
  const cols = await legacyColumns(legacyQuery, 'articles');
  if (!cols.size) throw new Error('nell\'app originale non esiste la tabella articles');
  const [cat, art, map] = await Promise.all([
    legacyQuery('SELECT count(*)::int AS n FROM public.categories'),
    legacyQuery('SELECT count(*)::int AS n, count(*) FILTER (WHERE active)::int AS attivi FROM public.articles'),
    legacyQuery(`SELECT count(*)::int AS n FROM public.exam_mappings`).catch(() => [{ n: 0 }]),
  ]);
  const gia = await db.one(`SELECT count(*)::int AS n FROM legacy_import_map WHERE tabella='articles'`);
  const warnings = [];
  if (gia.n) warnings.push(`${gia.n} articoli sono già stati importati in precedenza: verranno riconosciuti e non duplicati`);
  warnings.push('Le confezioni per struttura e le giacenze dell\'app non si importano: dipendono dalle strutture dell\'app originale, che nella Suite sono le sedi e le Legal entity dell\'anagrafica unica');
  return {
    entities: { sites: [], people: [], organizations: [] },
    tables: [
      { table: 'categories', label: 'Categorie del catalogo', rows: cat[0]?.n || 0 },
      { table: 'articles', label: 'Articoli', rows: art[0]?.n || 0, note: `${art[0]?.attivi || 0} attivi` },
      { table: 'exam_mappings', label: 'Abbinamenti esame → articolo', rows: map[0]?.n || 0 },
    ],
    warnings,
  };
}

export async function legacyImport({ legacyQueryLong, dryRun }) {
  const stats = { categories: { copied: 0, existing: 0, skipped: 0 }, articles: { copied: 0, existing: 0, skipped: 0 }, exam_mappings: { copied: 0, existing: 0, skipped: 0 } };
  const skipped = []; const warnings = [];
  const cols = await legacyColumns(legacyQueryLong, 'articles');
  const artCols = ART_COLS.filter((c) => cols.has(c));
  const mancanti = ART_COLS.filter((c) => !cols.has(c));
  if (mancanti.length) warnings.push(`colonne non presenti nell'app originale, lasciate al valore predefinito: ${mancanti.join(', ')}`);

  const categories = await legacyQueryLong('SELECT code, name, icon, sort FROM public.categories ORDER BY sort, code');
  const articles = await legacyQueryLong(`SELECT id, ${artCols.join(', ')} FROM public.articles ORDER BY sort, code`);
  const mappings = await legacyQueryLong('SELECT id, exam_code, exam_name, article_id, qty_per_exam, active FROM public.exam_mappings ORDER BY id').catch(() => []);

  await db.tx(async (c) => {
    const mapRows = (await c.query(`SELECT tabella, legacy_id, suite_id FROM legacy_import_map WHERE tabella IN ('categories','articles','exam_mappings')`)).rows;
    const done = new Map(mapRows.map((r) => [`${r.tabella}:${r.legacy_id}`, r.suite_id]));
    const ricorda = async (tabella, legacyId, suiteId) => { done.set(`${tabella}:${legacyId}`, String(suiteId)); if (!dryRun) await c.query('INSERT INTO legacy_import_map (tabella, legacy_id, suite_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [tabella, String(legacyId), String(suiteId)]); };

    // categorie: chiave naturale = code (si integra se manca, non si sovrascrive una categoria già presente nella Suite)
    for (const k of categories) {
      const esiste = (await c.query('SELECT code FROM categories WHERE code=$1', [k.code])).rows[0];
      if (esiste || done.has(`categories:${k.code}`)) { stats.categories.existing++; continue; }
      if (!dryRun) await c.query('INSERT INTO categories (code, name, icon, sort) VALUES ($1,$2,$3,$4)', [k.code, k.name, k.icon || 'kit', k.sort || 0]);
      await ricorda('categories', k.code, k.code); stats.categories.copied++;
    }
    // articoli: chiave naturale = code; se il codice esiste già nella Suite si aggancia senza modificarlo
    const artId = new Map();   // id app → id Suite
    for (const a of articles) {
      const gia = done.get(`articles:${a.id}`);
      if (gia) { artId.set(a.id, Number(gia)); stats.articles.existing++; continue; }
      const esiste = (await c.query('SELECT id FROM articles WHERE code=$1', [a.code])).rows[0];
      if (esiste) { artId.set(a.id, esiste.id); await ricorda('articles', a.id, esiste.id); stats.articles.existing++; continue; }
      const catOk = (await c.query('SELECT 1 FROM categories WHERE code=$1', [a.category_code])).rows[0] || (dryRun && categories.some((k) => k.code === a.category_code));
      if (!catOk) { stats.articles.skipped++; skipped.push({ table: 'articles', legacy_id: `${a.code} · ${a.name}`, reason: `categoria ${a.category_code} assente` }); continue; }
      if (dryRun) { artId.set(a.id, -a.id); stats.articles.copied++; continue; }
      const vals = artCols.map((col) => a[col]);
      const r = await c.query(`INSERT INTO articles (${artCols.join(', ')}) VALUES (${artCols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
      artId.set(a.id, r.rows[0].id); await ricorda('articles', a.id, r.rows[0].id); stats.articles.copied++;
    }
    // abbinamenti esame → articolo
    for (const m of mappings) {
      if (done.has(`exam_mappings:${m.id}`)) { stats.exam_mappings.existing++; continue; }
      const aid = artId.get(m.article_id);
      if (!aid) { stats.exam_mappings.skipped++; skipped.push({ table: 'exam_mappings', legacy_id: `${m.exam_code} → articolo ${m.article_id}`, reason: 'articolo non importato' }); continue; }
      if (dryRun) { stats.exam_mappings.copied++; continue; }
      const esiste = (await c.query('SELECT id FROM exam_mappings WHERE exam_code=$1 AND article_id=$2', [m.exam_code, aid])).rows[0];
      if (esiste) { await ricorda('exam_mappings', m.id, esiste.id); stats.exam_mappings.existing++; continue; }
      const r = await c.query('INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam, active) VALUES ($1,$2,$3,$4,$5) RETURNING id', [m.exam_code, m.exam_name, aid, m.qty_per_exam, m.active !== false]);
      await ricorda('exam_mappings', m.id, r.rows[0].id); stats.exam_mappings.copied++;
    }
    if (dryRun) throw Object.assign(new Error('DRY_RUN'), { dryRun: true });
  }).catch((e) => { if (!e.dryRun) throw e; });

  return { stats, skipped, warnings, dryRun: Boolean(dryRun), copied: Object.values(stats).reduce((a, s) => a + s.copied, 0) };
}
