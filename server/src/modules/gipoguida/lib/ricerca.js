// Guida GIPO · ricerca full text italiano su sezioni e FAQ pubblicate (tsvector 'italian' generati nelle tabelle, indici GIN).
// Ogni parola della ricerca diventa un gruppo di alternative: la parola (stemming italiano), i sinonimi minimi del brief ("prenotare /
// appuntamento", "incasso / cassa", "storno / nota di credito", "ricetta / impegnativa") e, per l'ultima parola mentre si scrive, il
// prefisso. I gruppi vanno tutti trovati (AND); se così non c'è nulla si riprova con almeno un gruppo (OR, risultati "parziali").
// Ordinamento: ts_rank_cd + somiglianza del titolo (pg_trgm). Evidenziazione con ts_headline (<b>…</b>, come la ricerca della Suite).
// cercaGuida(q) è esportata anche per la ricerca globale della Suite (lib/search.js).
import { many, q as query } from '../db.js';

// Sinonimi minimi: radice (inizio della parola, senza accenti) → parole da cercare in alternativa
export const SINONIMI = [
  { radici: ['prenot'], alternative: ['appuntamento', 'agenda'] },
  { radici: ['appuntament'], alternative: ['prenotazione'] },
  { radici: ['incass'], alternative: ['cassa'] },
  { radici: ['cassa', 'casse'], alternative: ['incasso'] },
  { radici: ['storn'], alternative: ['nota di credito'] },
  { radici: ['ricett'], alternative: ['impegnativa'] },
  { radici: ['impegnativ'], alternative: ['ricetta'] },
  { radici: ['disdett', 'disdir'], alternative: ['annulla appuntamento'] },
  { radici: ['scontrin'], alternative: ['fattura'] },
];
const senzaAccenti = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Parole della ricerca (minuscole, almeno 2 caratteri, al più 8) e alternative per ciascuna. Funzione pura. */
export function gruppiRicerca(testo) {
  const parole = (String(testo || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((p) => p.length >= 2).slice(0, 8);
  return parole.map((p) => {
    const base = senzaAccenti(p);
    const alt = new Set();
    for (const s of SINONIMI) if (s.radici.some((r) => base.startsWith(r))) s.alternative.forEach((a) => alt.add(a));
    return { parola: p, alternative: [...alt] };
  });
}

/**
 * Costruisce il testo della tsquery: per ogni gruppo (parola | sinonimi | prefisso) normalizzati da PostgreSQL con plainto_tsquery('italian').
 * Le parole vuote (stopword: "come", "dove", "il"...) spariscono. Ritorna { tutti, almenoUno } (stringhe tsquery, '' se vuote).
 */
export async function tsqueryDi(testo, { prefisso = true } = {}) {
  const gruppi = gruppiRicerca(testo);
  if (!gruppi.length) return { tutti: '', almenoUno: '', parti: [] };
  const voci = [...new Set(gruppi.flatMap((g) => [g.parola, ...g.alternative]))];
  const norm = new Map((await many(`SELECT t, plainto_tsquery('italian', t)::text AS q FROM unnest($1::text[]) t`, [voci])).map((r) => [r.t, r.q]));
  const parti = gruppi.map((g, i) => {
    const alt = [g.parola, ...g.alternative].map((v) => norm.get(v)).filter(Boolean).map((x) => (x.includes('&') ? `( ${x} )` : x));
    // ultima parola mentre si scrive: prefisso della parola (ripulita) con :* ("fatt" trova "fattura", "prenotaz" trova "prenotazione")
    const ultima = i === gruppi.length - 1;
    const pulita = senzaAccenti(g.parola).replace(/[^a-z0-9]/g, '');
    if (prefisso && ultima && pulita.length >= 3) alt.push(`'${pulita.slice(0, Math.max(3, Math.min(pulita.length, pulita.length >= 7 ? pulita.length - 2 : pulita.length)))}':*`);
    return alt.length ? (alt.length > 1 ? `( ${[...new Set(alt)].join(' | ')} )` : alt[0]) : null;
  }).filter(Boolean);
  if (!parti.length) return { tutti: '', almenoUno: '', parti: [] };
  return { tutti: parti.join(' & '), almenoUno: parti.join(' | '), parti };
}

// Corpo senza segni markdown e senza destinazioni dei collegamenti, per l'evidenziazione
const CORPO_PULITO = `regexp_replace(regexp_replace(regexp_replace(regexp_replace(%s, '\\[([^\\]]*)\\]\\((sezione:|https?:)[^)]*\\)', '\\1', 'g'), '(^|\\n)\\s*>\\s?', '\\1', 'g'), '[#*_\`|]+', ' ', 'g'), '\\s+', ' ', 'g')`;
const HL = `'MaxWords=32, MinWords=14, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … ", StartSel=<b>, StopSel=</b>'`;

async function esegui(tsq, testo, { limite, tipi }) {
  const p = [tsq, String(testo || '').toLowerCase().slice(0, 200), limite];
  const parti = [];
  if (tipi.includes('sezione')) {
    parti.push(`SELECT 'sezione' AS tipo, s.id, s.titolo, s.slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, NULL::int AS sezione_id, NULL::text AS sezione_slug,
        coalesce(ts_headline('italian', ${CORPO_PULITO.replace('%s', 's.corpo')}, qq.tsq, ${HL}), left(${CORPO_PULITO.replace('%s', 's.corpo')}, 240)) AS snippet,
        left(s.corpo, 4000) AS testo,
        (CASE WHEN qq.ok AND s.tsv @@ qq.tsq THEN ts_rank_cd(s.tsv, qq.tsq) ELSE 0 END) + similarity(lower(s.titolo), qq.lq) * 0.8
          + (CASE WHEN length(qq.lq) >= 4 AND lower(s.titolo) LIKE '%' || qq.lq || '%' THEN 0.4 ELSE 0 END) AS score
      FROM sezioni s LEFT JOIN capitoli k ON k.numero = s.capitolo, qq
      WHERE (qq.ok AND s.tsv @@ qq.tsq) OR similarity(lower(s.titolo), qq.lq) > 0.35`);
  }
  if (tipi.includes('faq')) {
    parti.push(`SELECT 'faq' AS tipo, f.id, f.domanda AS titolo, NULL::text AS slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, f.sezione_id, s.slug AS sezione_slug,
        coalesce(ts_headline('italian', ${CORPO_PULITO.replace('%s', 'f.risposta')}, qq.tsq, ${HL}), left(${CORPO_PULITO.replace('%s', 'f.risposta')}, 240)) AS snippet,
        left(f.risposta, 3000) AS testo,
        (CASE WHEN qq.ok AND f.tsv @@ qq.tsq THEN ts_rank_cd(f.tsv, qq.tsq) ELSE 0 END) * 1.1 + similarity(lower(f.domanda), qq.lq) * 0.8 AS score
      FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id LEFT JOIN capitoli k ON k.numero = s.capitolo, qq
      WHERE f.pubblicata AND ((qq.ok AND f.tsv @@ qq.tsq) OR similarity(lower(f.domanda), qq.lq) > 0.35)`);
  }
  if (!parti.length) return [];
  return many(`WITH qq AS (SELECT CASE WHEN $1 = '' THEN NULL ELSE $1::tsquery END AS tsq, $1 <> '' AS ok, $2::text AS lq)
    SELECT * FROM (${parti.join(' UNION ALL ')}) x ORDER BY score DESC, tipo DESC, titolo LIMIT $3`, p);
}

export const linkSezione = (slug) => `/gipoguida/guida/${slug}`;
export const linkFaq = (id) => `/gipoguida/faq?voce=${id}`;

/**
 * Ricerca nella guida: sezioni e FAQ pubblicate, i più pertinenti per primi.
 * Ritorna [{ tipo, id, titolo, slug, capitolo, capitolo_titolo, percorso_gipo, stato, sezione_slug, snippet, testo, score, link }] con
 * `parziale: true` sui risultati della seconda passata (solo alcune parole trovate).
 */
export async function cercaGuida(testo, { limite = 10, tipi = ['sezione', 'faq'], prefisso = true } = {}) {
  const t = String(testo || '').trim().slice(0, 200);
  if (t.length < 2) return [];
  const { tutti, almenoUno, parti } = await tsqueryDi(t, { prefisso });
  let righe = await esegui(tutti, t, { limite, tipi });
  let parziale = false;
  if (!righe.length && almenoUno && almenoUno !== tutti) { righe = await esegui(almenoUno, t, { limite, tipi }); parziale = true; }
  // risultati parziali: quota delle parole della ricerca trovate in ciascuno (copertura), per distinguere i brani pertinenti dal rumore
  const copertura = new Map();
  if (parziale && righe.length && parti.length > 1) {
    const somma = parti.map((x, k) => `(tsv @@ $${k + 2}::tsquery)::int`).join(' + ');
    const ids = (tipo) => righe.filter((r) => r.tipo === tipo).map((r) => r.id);
    for (const [tipo, tab] of [['sezione', 'sezioni'], ['faq', 'faq']]) {
      if (!ids(tipo).length) continue;
      for (const x of await many(`SELECT id, (${somma})::float / ${parti.length} AS c FROM ${tab} WHERE id = ANY($1::int[])`, [ids(tipo), ...parti])) copertura.set(`${tipo}:${x.id}`, Number(x.c));
    }
  }
  return righe.map((r) => ({ ...r, score: Number(r.score) || 0, parziale, copertura: parziale ? (copertura.get(`${r.tipo}:${r.id}`) ?? 0) : 1, link: r.tipo === 'sezione' ? linkSezione(r.slug) : linkFaq(r.id) }));
}

/**
 * Registra una ricerca per le statistiche (testo già mascherato). Le battute successive della stessa ricerca (stesso utente, entro 60
 * secondi, testo che estende o accorcia il precedente) aggiornano la riga invece di aggiungerne una.
 */
export async function registraRicerca(utente, testo, risultati) {
  const t = String(testo || '').trim().slice(0, 200);
  if (t.length < 2) return;
  const ult = (await query(`SELECT id, testo FROM ricerche WHERE utente IS NOT DISTINCT FROM $1 AND aggiornata_il > now() - interval '60 seconds' ORDER BY aggiornata_il DESC LIMIT 1`, [utente || null])).rows[0];
  const a = t.toLowerCase(); const b = ult?.testo?.toLowerCase();
  if (ult && (a.startsWith(b) || b.startsWith(a))) {
    await query('UPDATE ricerche SET testo = $2, risultati = $3, aggiornata_il = now() WHERE id = $1', [ult.id, t, risultati]);
  } else {
    await query('INSERT INTO ricerche (utente, testo, risultati) VALUES ($1,$2,$3)', [utente || null, t, risultati]);
  }
}
