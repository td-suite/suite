// Ordini e Magazzino · transcodifica dei contenitori (v0.98.1, richiesta del CEO del 25/11/2026).
// Le correlazioni esame → materiale nate prima del catalogo Silva puntano ad articoli GENERICI ("Tappo Viola", "Tappo Giallo"…) che la
// migrazione 020 ha disattivato e nascosto: la Produzione li mostrava come "#6", "#9". Qui ogni contenitore generico ancora usato da una
// correlazione si abbina all'articolo di MAGAZZINO che lo rappresenta (catalogo Silva). La Suite propone, l'Area Operations conferma:
// alla conferma le correlazioni del generico passano all'articolo di magazzino (exam_mappings.articolo_origine_id ricorda da dove
// vengono, così la conferma si può annullare). Nessuna proposta viene applicata da sola.
import { one, many, tx } from '../db.js';

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const COLORI = ['viola', 'azzurro', 'giallo', 'grigio', 'verde', 'oliva', 'rosso', 'rosa', 'blu', 'bianco', 'nero', 'arancio'];
const VUOTE = new Set(['tappo', 'tappi', 'provetta', 'provette', 'contenitore', 'contenitori', 'con', 'per', 'del', 'della', 'dei', 'senza', 'conf', 'pz', 'asp', 'standard']);
const parole = (t) => norm(t).split(' ').filter((w) => w.length >= 3 && !VUOTE.has(w)).map((w) => (w.length > 4 ? w.replace(/[aeio]$/, '') : w));
const TIPI = ['urin', 'fec', 'tampon', 'kit', 'saliv', 'breath'];
const tipi = (t) => { const n = norm(t); return TIPI.filter((k) => new RegExp(`\\b${k}`).test(n)); };
const colori = (t) => { const n = ` ${norm(t).replace(/\bt (?=[a-z])/g, '')} `; return COLORI.filter((c) => new RegExp(c === 'blu' ? '\\bblu\\b' : `\\b${c.slice(0, -1)}[aeio]\\b`).test(n)); };

/**
 * Proposta dell'articolo di magazzino per un contenitore generico (funzione pura). Regola: i colori del tappo devono coincidere tutti
 * (Tappo Verde non è "verde oliva": a parità vince chi non ha colori in più) e così il tipo di contenitore (urine, feci, tampone, kit);
 * senza colore né tipo servono almeno due parole in comune; più candidati alla pari = nessuna proposta. Ritorna { article_id, name, motivo } oppure null: la proposta va sempre confermata da una persona.
 */
export function proponiArticolo(nomeGenerico, articoli) {
  const cg = colori(nomeGenerico); const pg = new Set(parole(nomeGenerico)); const tg = tipi(nomeGenerico);
  let best = null; let pari = false;
  for (const a of articoli) {
    const ca = colori(a.name); const ta = tipi(a.name);
    if (!cg.every((c) => ca.includes(c))) continue;          // tutti i colori del generico
    if (!tg.every((t) => ta.includes(t))) continue;          // stesso tipo di contenitore (urine, feci, tampone, kit…)
    if (!tg.length && ta.length && !cg.length) continue;
    const comuni = parole(a.name).filter((w) => pg.has(w)).length;
    if (!cg.length && !tg.length && comuni < 2) continue;
    const punti = comuni + 2 * cg.length + 2 * tg.length - (ca.length - cg.length) - (ta.length - tg.length);
    if (!best || punti > best.punti) { best = { article_id: a.id, name: a.name, punti, motivo: cg.length ? `stesso colore del tappo (${cg.join(' ')})` : tg.length ? 'stesso tipo di contenitore' : `${comuni} parole in comune` }; pari = false; }
    else if (punti === best.punti) pari = true;
  }
  if (!best || pari) return null;                            // nessun candidato, o più candidati alla pari: sceglie una persona
  const { punti, ...out } = best; void punti;
  return out;
}

const SQL_MAGAZZINO = `SELECT id, code, name, pack_label FROM articles WHERE active ORDER BY name`;

/**
 * Elenco per la sezione "Transcodifica contenitori": gli articoli fuori dal catalogo di magazzino (disattivati e nascosti) ancora
 * usati da una correlazione attiva, con il numero di esami, la proposta e, per quelli già confermati, l'articolo di magazzino.
 */
export async function elencoTranscodifica() {
  const magazzino = await many(SQL_MAGAZZINO);
  const daFare = await many(`SELECT a.id, a.code, a.name, a.unit, count(*)::int AS esami,
        (SELECT string_agg(x.exam_code, ', ' ORDER BY x.exam_code) FROM (SELECT exam_code FROM exam_mappings WHERE article_id = a.id AND active ORDER BY exam_code LIMIT 8) x) AS esempi
      FROM exam_mappings m JOIN articles a ON a.id = m.article_id
     WHERE m.active AND NOT a.active GROUP BY a.id ORDER BY count(*) DESC, a.name`);
  const fatte = await many(`SELECT t.da_article_id AS id, g.code, g.name, g.unit, t.a_article_id, a.name AS a_name, t.confermato_il, u.full_name AS confermato_da,
        (SELECT count(*)::int FROM exam_mappings m WHERE m.articolo_origine_id = t.da_article_id AND m.active) AS esami
      FROM articoli_transcodifica t JOIN articles g ON g.id = t.da_article_id JOIN articles a ON a.id = t.a_article_id LEFT JOIN users u ON u.id = t.confermato_da
     ORDER BY g.name`);
  return { magazzino, da_confermare: daFare.map((g) => ({ ...g, proposta: proponiArticolo(g.name, magazzino) })), confermate: fatte };
}

/** Conferma: le correlazioni attive del contenitore generico `da` passano all'articolo di magazzino `a`. Ritorna { spostate, gia_presenti }. */
export async function confermaTranscodifica(da, a, userId = null) {
  return tx(async (c) => {
    const g = (await c.query('SELECT id, name, source, active FROM articles WHERE id = $1', [da])).rows[0];
    const m = (await c.query(`SELECT id, name FROM articles WHERE id = $1 AND active`, [a])).rows[0];
    if (!g) throw Object.assign(new Error('Contenitore non trovato'), { status: 404 });
    if (!m) throw Object.assign(new Error('Scegli un articolo attivo del catalogo di magazzino'), { status: 400 });
    if (g.active) throw Object.assign(new Error('È già un articolo di magazzino'), { status: 400 });
    // esami che hanno già l'articolo di magazzino: la riga del generico diventa un doppione, si spegne (resta leggibile e ripristinabile)
    const dop = await c.query(`UPDATE exam_mappings x SET active = FALSE, articolo_origine_id = $1, updated_at = now()
       WHERE x.article_id = $1 AND x.active AND EXISTS (SELECT 1 FROM exam_mappings y WHERE y.exam_code = x.exam_code AND y.article_id = $2)`, [da, a]);
    const sp = await c.query(`UPDATE exam_mappings SET article_id = $2, articolo_origine_id = $1, updated_at = now() WHERE article_id = $1 AND active`, [da, a]);
    await c.query(`INSERT INTO articoli_transcodifica (da_article_id, a_article_id, confermato_il, confermato_da) VALUES ($1, $2, now(), $3)
      ON CONFLICT (da_article_id) DO UPDATE SET a_article_id = EXCLUDED.a_article_id, confermato_il = now(), confermato_da = EXCLUDED.confermato_da`, [da, a, userId]);
    return { da: g.name, a: m.name, spostate: sp.rowCount, gia_presenti: dop.rowCount };
  });
}

/** Annulla una conferma: le correlazioni tornano al contenitore generico da cui venivano. */
export async function annullaTranscodifica(da) {
  return tx(async (c) => {
    const t = (await c.query('SELECT * FROM articoli_transcodifica WHERE da_article_id = $1', [da])).rows[0];
    if (!t) throw Object.assign(new Error('Transcodifica non trovata'), { status: 404 });
    const r1 = await c.query(`UPDATE exam_mappings SET article_id = $1, articolo_origine_id = NULL, updated_at = now() WHERE articolo_origine_id = $1 AND article_id = $2`, [da, t.a_article_id]);
    const r2 = await c.query(`UPDATE exam_mappings SET active = TRUE, articolo_origine_id = NULL, updated_at = now() WHERE articolo_origine_id = $1 AND article_id = $1`, [da]);
    await c.query('DELETE FROM articoli_transcodifica WHERE da_article_id = $1', [da]);
    return { ripristinate: r1.rowCount + r2.rowCount };
  });
}

// ------------------------------------------------------------------ strutture con più codici (stesso cliente)
const FORME = /\b(s r l s|s r l|srl|srls|s p a|spa|s a s|sas|s n c|snc|societa a responsabilita limitata|unipersonale)\b/g;
/** Nome senza forma societaria, accenti e punteggiatura: due strutture con lo stesso nome sono lo stesso cliente. */
export const nomeCliente = (t) => norm(t).replace(FORME, ' ').replace(/\s+/g, ' ').trim();

/**
 * Strutture "gemelle" di una struttura: stesso cliente con un altro codice (es. sede TD04 e Legal entity SER0011 dello stesso centro).
 * Regola: stesso nome al netto di forma societaria, accenti e punteggiatura. Ritorna [{ id, code, name }] (senza la struttura stessa).
 */
export async function struttureGemelle(strutturaId) {
  const id = Number(strutturaId);
  const tutte = await many('SELECT id, code, name FROM strutture_v');
  const me = tutte.find((s) => s.id === id);
  const n = me && nomeCliente(me.name);
  if (!n || n.length < 6) return [];
  return tutte.filter((s) => s.id !== id && nomeCliente(s.name) === n);
}
void one;
