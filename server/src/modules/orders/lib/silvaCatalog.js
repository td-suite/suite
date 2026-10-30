// Catalogo e giacenze Silva in lettura (API Silva v1, attivata in produzione il 30/10/2026): la Suite interroga il portale ordini di
// Silva con la chiave X-API-KEY del connettore SILVA (Amministrazione > Connettori).
//   GET {base}/api/v1/catalogo?anno=AAAA                 fotografia completa; header X-Catalog-Updated-At = riferimento da conservare
//   GET {base}/api/v1/catalogo/modifiche?anno=&dal=      articoli nuovi o modificati (anche sola giacenza) + eliminati; campo aggiornatoAl
// Regole del fornitore: riferimento ("dal") separato per ogni anno, aggiornato solo dopo aver importato tutti i dati; data ISO 8601 UTC con
// tutte le cifre delle frazioni di secondo; 409 full_sync_required → ripartire dal completo. Lotti, scadenze e GTIN non ancora valorizzati.
// I riferimenti stanno in connectors.settings.cursors ({ "2026": "2026-10-30T11:10:00.1234567Z" }), così sopravvivono ai riavvii.
import { tx } from '../db.js';
import { getConnector, saveConnector, logConnector } from '../../../lib/connectors.js';
import { setSetting } from '../routes/integrations.js';

const MODULE = 'orders';
export const SILVA_DEFAULT_BASE = 'https://silva.cloud/portaleordini';

const base = (c) => String(c.base_url || SILVA_DEFAULT_BASE).replace(/\/+$/, '');
const annoCorrente = () => new Date().getFullYear();
export const anniDaSincronizzare = (c) => {
  const s = String(c.settings?.catalog_years || '').trim();
  const anni = s ? s.split(/[;,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 2000) : [annoCorrente()];
  return [...new Set(anni)];
};

async function chiama(c, path, { timeoutMs = 60_000 } = {}) {
  const url = `${base(c)}${path}`;
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'X-API-KEY': c.credentials.api_key }, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    const msg = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'nessuna risposta entro il tempo massimo' : `non raggiungibile: ${e.cause?.message || e.message}`;
    logConnector({ kind: 'SILVA', direction: 'OUT', module: MODULE, endpoint: `GET ${url}`, status: 'ERRORE', ms: Date.now() - t0, message: msg });
    throw new Error(msg);
  }
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  logConnector({ kind: 'SILVA', direction: 'OUT', module: MODULE, endpoint: `GET ${url}`, status: res.status, ms: Date.now() - t0, message: res.ok ? `${Array.isArray(data?.articoli) ? data.articoli.length : 0} articoli` : text.slice(0, 300) });
  return { res, data, text, ms: Date.now() - t0 };
}

// Articolo Silva → riga del feed interno (lib applyFeed di routes/integrations.js): codice, descrizione, quantità, unità, barcode
export const mappaArticolo = (a) => ({
  codice: String(a.codiceArticolo || a.codice || '').trim(),
  descrizione: a.descrizione || null,
  quantita: Number(a.quantita ?? 0),
  unita: a.unita || null,
  barcode: a.gtin || null,
  confezione: a.confezione || null,
  unitaPerConfezione: a.unitaPerConfezione || null,
  categoria: a.categoria || null,
  lotti: Array.isArray(a.lotti) ? a.lotti : [],
});
const validaRisposta = (data) => data && Array.isArray(data.articoli) && data.articoli.every((a) => a && typeof a.codiceArticolo === 'string' && typeof a.quantita === 'number');

export async function catalogoCompleto(c, anno) {
  const { res, data, text } = await chiama(c, `/api/v1/catalogo?anno=${anno}`);
  if (!res.ok) throw new Error(`Silva risponde ${res.status}: ${(data && (data.message || data.error || data.title)) || text.slice(0, 200)}`);
  if (!validaRisposta(data)) throw new Error('Risposta non nel formato previsto (articoli con codiceArticolo e quantita)');
  const cursor = res.headers.get('x-catalog-updated-at');
  const year = res.headers.get('x-catalog-year');
  if (year && String(year) !== String(anno)) throw new Error(`Anno della risposta (${year}) diverso da quello richiesto (${anno})`);
  if (!cursor) throw new Error('Manca l\'header X-Catalog-Updated-At: riferimento non conservabile');
  return { articoli: data.articoli, cursor, magazzino: data.magazzino || null };
}
export async function catalogoModifiche(c, anno, dal) {
  const { res, data, text } = await chiama(c, `/api/v1/catalogo/modifiche?anno=${anno}&dal=${encodeURIComponent(dal)}`);
  if (res.status === 409) return { fullSyncRequired: true };
  if (!res.ok) throw new Error(`Silva risponde ${res.status}: ${(data && (data.message || data.error || data.title)) || text.slice(0, 200)}`);
  if (!validaRisposta(data) || !Array.isArray(data.eliminati)) throw new Error('Risposta non nel formato previsto (articoli ed eliminati)');
  if (data.anno != null && Number(data.anno) !== Number(anno)) throw new Error(`Anno della risposta (${data.anno}) diverso da quello richiesto (${anno})`);
  if (!data.aggiornatoAl) throw new Error('Manca aggiornatoAl: riferimento non conservabile');
  return { articoli: data.articoli, eliminati: data.eliminati, cursor: data.aggiornatoAl };
}

// Applica una fotografia completa: nuovo feed, tutte le righe correnti sostituite (come il feed in ingresso)
async function applicaCompleto(articoli, anno) {
  const { applyFeed } = await import('../routes/integrations.js');
  const out = await applyFeed(articoli.map(mappaArticolo), 'API');
  await setSetting(`silva_catalog_full_at_${anno}`, new Date().toISOString());
  return out;
}
// Applica le sole modifiche: per ogni articolo nuovo o modificato si sostituisce la riga corrente; gli eliminati passano a giacenza zero
async function applicaModifiche(articoli, eliminati) {
  const { feedItem } = await import('../routes/integrations.js');
  const errors = [];
  return tx(async (c) => {
    const feed = (await c.query(`INSERT INTO warehouse_feeds (source) VALUES ('API') RETURNING id`)).rows[0];
    let n = 0, newArticles = 0, removed = 0;
    for (const [i, raw] of articoli.entries()) {
      const p = feedItem.safeParse(mappaArticolo(raw));
      if (!p.success) { errors.push(`riga ${i + 1}: ${p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`); continue; }
      const it = p.data;
      let art = (await c.query('SELECT id FROM articles WHERE silva_code=$1 OR (silva_code IS NULL AND code=$1)', [it.codice])).rows[0];
      if (!art) {
        const cat = it.categoria && (await c.query('SELECT 1 FROM categories WHERE code=$1', [it.categoria])).rowCount ? it.categoria : 'MAGAZZINO';
        art = (await c.query(`INSERT INTO articles (code, silva_code, category_code, name, unit, pack_size, pack_label, gtin, source, active, visible_all, visible_sedi, visible_service, sort)
          VALUES ($1,$1,$2,$3,$4,$5,$6,$7,'SILVA',TRUE,FALSE,FALSE,FALSE,(SELECT coalesce(max(sort),0)+1 FROM articles)) RETURNING id`,
        [it.codice, cat, it.descrizione || it.codice, it.unita || 'n.', it.unitaPerConfezione || 1, it.confezione || (it.unitaPerConfezione ? `confezione da ${it.unitaPerConfezione}` : 'confezione'), it.barcode || null])).rows[0];
        newArticles++;
      } else {
        await c.query('UPDATE articles SET silva_code=coalesce(silva_code,$2), gtin=coalesce(gtin,$3), updated_at=now() WHERE id=$1', [art.id, it.codice, it.barcode || null]);
      }
      await c.query('UPDATE warehouse_stock SET current=FALSE WHERE current AND article_id=$1', [art.id]);
      await c.query('INSERT INTO warehouse_stock (feed_id, article_id, silva_code, description, lot, expiry, qty, unit, barcode) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7)',
        [feed.id, art.id, it.codice, it.descrizione || null, it.quantita, it.unita || null, it.barcode || null]);
      n++;
    }
    for (const code of eliminati) {
      const art = (await c.query('SELECT id FROM articles WHERE silva_code=$1 OR (silva_code IS NULL AND code=$1)', [String(code)])).rows[0];
      if (!art) continue;
      const r = await c.query('UPDATE warehouse_stock SET current=FALSE WHERE current AND article_id=$1', [art.id]);
      if (r.rowCount) { await c.query('INSERT INTO warehouse_stock (feed_id, article_id, silva_code, description, qty, unit) VALUES ($1,$2,$3,$4,0,NULL)', [feed.id, art.id, String(code), 'Non più presente nel catalogo Silva']); removed++; }
    }
    await c.query('UPDATE warehouse_feeds SET items=$2, new_articles=$3, errors=$4 WHERE id=$1', [feed.id, n, newArticles, errors.length ? JSON.stringify(errors) : null]);
    return { feedId: feed.id, items: n, newArticles, removed, errors };
  });
}

async function salvaCursor(c, anno, cursor) {
  const cursors = { ...(c.settings?.cursors || {}), [String(anno)]: cursor };
  await saveConnector('SILVA', { settings: { cursors, last_sync_at: new Date().toISOString() } }, null);
}

/** Sincronizzazione di un anno: completo se manca il riferimento (o force), altrimenti sole modifiche; 409 → completo. */
export async function sincronizzaAnno(anno, { force = false } = {}) {
  const c = await getConnector('SILVA');
  if (!c.enabled) return { anno, skipped: 'connettore disattivato' };
  if (!c.credentials?.api_key) return { anno, skipped: 'chiave API Silva non impostata (Amministrazione > Connettori > Silva)' };
  const dal = force ? null : c.settings?.cursors?.[String(anno)] || null;
  if (!dal) {
    const full = await catalogoCompleto(c, anno);
    const out = await applicaCompleto(full.articoli, anno);
    await salvaCursor(c, anno, full.cursor);                       // solo dopo l'importazione riuscita
    await setSetting('silva_last_feed_at', new Date().toISOString());
    return { anno, mode: 'COMPLETO', items: out.items, newArticles: out.newArticles, errors: out.errors, cursor: full.cursor };
  }
  const mod = await catalogoModifiche(c, anno, dal);
  if (mod.fullSyncRequired) {
    const full = await catalogoCompleto(c, anno);
    const out = await applicaCompleto(full.articoli, anno);
    await salvaCursor(c, anno, full.cursor);
    await setSetting('silva_last_feed_at', new Date().toISOString());
    return { anno, mode: 'COMPLETO', reason: 'full_sync_required', items: out.items, newArticles: out.newArticles, errors: out.errors, cursor: full.cursor };
  }
  if (!mod.articoli.length && !mod.eliminati.length) { await salvaCursor(c, anno, mod.cursor); return { anno, mode: 'MODIFICHE', items: 0, removed: 0, cursor: mod.cursor }; }
  const out = await applicaModifiche(mod.articoli, mod.eliminati);
  await salvaCursor(c, anno, mod.cursor);
  await setSetting('silva_last_feed_at', new Date().toISOString());
  return { anno, mode: 'MODIFICHE', items: out.items, newArticles: out.newArticles, removed: out.removed, errors: out.errors, cursor: mod.cursor };
}

/** Tutti gli anni configurati (settings.catalog_years, default anno corrente). Un anno in errore non ferma gli altri. */
export async function sincronizzaCatalogo({ force = false } = {}) {
  const c = await getConnector('SILVA');
  const esiti = [];
  for (const anno of anniDaSincronizzare(c)) {
    try { esiti.push(await sincronizzaAnno(anno, { force })); }
    catch (e) { esiti.push({ anno, error: e.message }); }
  }
  const err = esiti.filter((x) => x.error);
  await saveConnector('SILVA', { settings: { last_sync_status: err.length ? 'ERRORE' : 'OK', last_sync_message: err.length ? err.map((x) => `${x.anno}: ${x.error}`).join(' · ') : esiti.map((x) => `${x.anno}: ${x.skipped || `${x.mode} ${x.items ?? 0} articoli`}`).join(' · ') } }, null).catch(() => {});
  return { esiti };
}

/** Stato per la pagina Magazzino e per il connettore */
export async function statoCatalogo() {
  const c = await getConnector('SILVA');
  return {
    enabled: c.enabled, api_key: Boolean(c.credentials?.api_key), base_url: base(c), years: anniDaSincronizzare(c), cursors: c.settings?.cursors || {},
    last_sync_at: c.settings?.last_sync_at || null, last_sync_status: c.settings?.last_sync_status || null, last_sync_message: c.settings?.last_sync_message || null,
    key_expires_at: c.settings?.key_expires_at || null, sync_minutes: Number(c.settings?.sync_minutes) || 60,
  };
}
