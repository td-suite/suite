// Ponte Comunicazione ↔ Circolari (richiesta del CEO, 08/11/2026: "se costruisco una circolare dal widget Comunicazione deve figurare
// anche in Archivio del widget Circolari"). Esiste UNA sola serie di circolari di Toscana Diagnostica, quella di questo modulo:
// - alla pubblicazione in Comunicazione (news kind CIRCOLARE) la circolare prende il protocollo TD-AAAA/NNN dal registro, viene
//   impaginata qui (DOCX e PDF su carta intestata, corpo Markdown convertito in blocchi, allegati agganciati) ed entra nell'archivio
//   come PUBBLICATA con origine COMUNICAZIONE e il legame con la news (news.circolare_id ↔ circolari.news_id);
// - con il modulo non LIVE (o in errore) la news prende il protocollo provvisorio CIRC-AAAA-NNN come prima e la risposta lo dice;
// - le circolari CIRC-… già pubblicate si portano nel registro dalla Diagnostica (controllo D42, "Registra");
// - l'aggiornamento di una circolare pubblicata in Comunicazione registra una revisione TD-AAAA/NNN-rN con il PDF nuovo.
// Tutte le funzioni che scrivono ricevono la connessione della transazione della news (pool della Suite, search_path public): per
// questo le tabelle del modulo sono sempre qualificate con lo schema (circolari.circolari, circolari.invii).
import { config } from '../config.js';
import { getModuleState } from '../../../lib/modules.js';
import { nextNumero, formatProtocollo, newToken } from './protocollo.js';
import { produciFile } from './impagina.js';
import { dataItaliana } from './render.js';

const KEY = 'circolari';
export const AVVISO_NON_ATTIVO = 'protocollo provvisorio: avvia il modulo Circolari per il registro unico';

/** Il registro unico è disponibile solo con il modulo Circolari LIVE (schema creato). */
export async function registroAttivo() {
  try { const st = await getModuleState(KEY); return st.mode === 'LIVE' && Boolean(st.schema_ready); } catch { return false; }
}

export const publicUrlDi = (c) => (c?.pub_token ? `${config.baseUrl}/api/circolari/pub/${c.pub_token}` : null);
export const nomeFilePdf = (protocollo) => `Circolare ${String(protocollo || '').replace(/\//g, '-')}.pdf`;

// ------------------------------------------------------------------ Markdown della news → blocchi della circolare
// Pulizia del Markdown in linea: grassetti, corsivi, codice, collegamenti ("testo (url)"), immagini tolte (restano tra gli allegati)
export function testoInLinea(s) {
  return String(s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                                            // immagini nel testo
    .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, t, u) => {            // collegamenti
      const testo = String(t).trim(); const url = String(u).trim();
      if (/^file:/i.test(url) || !url || url === testo) return testo || url;
      return testo ? `${testo} (${url})` : url;
    })
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')                                 // collegamenti automatici
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un paragrafo oltre i 5000 caratteri si divide alle frasi (mai troncato: nessun testo della news va perso)
function spezza(text, max = 5000) {
  const out = []; let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max); if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max); if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const cellaTabella = (riga) => riga.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((x) => testoInLinea(x));

/**
 * Converte il corpo Markdown di una news nei blocchi del motore di impaginazione: # e ## → titolo di sezione, paragrafi (righe unite),
 * elenchi puntati e numerati (il numero resta nel testo), citazioni come paragrafi, tabelle Markdown → tabella, separatori ignorati.
 */
export function markdownInBlocchi(md) {
  const righe = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let par = []; let elenco = null; let tabella = null; let codice = null;
  const chiudiPar = () => { if (par.length) { const t = testoInLinea(par.join(' ')); for (const x of spezza(t)) if (x) out.push({ type: 'paragrafo', text: x }); } par = []; };
  const chiudiElenco = () => { if (elenco?.length) { const items = elenco.map(testoInLinea).filter(Boolean).map((x) => x.slice(0, 800)); for (let i = 0; i < items.length; i += 50) out.push({ type: 'elenco', items: items.slice(i, i + 50) }); } elenco = null; };
  const chiudiTabella = () => {
    if (tabella) {
      const [testa, ...resto] = tabella;
      const sep = (r) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(r);
      const corpo = resto.filter((r) => !sep(r));
      const colonne = cellaTabella(testa).slice(0, 12).map((x) => x.slice(0, 120));
      if (colonne.length && resto.length && sep(resto[0])) out.push({ type: 'tabella', colonne, righe: corpo.map((r) => { const c = cellaTabella(r); return colonne.map((_, k) => String(c[k] ?? '').slice(0, 400)); }) });
      else for (const r of tabella) par.push(r.replace(/\|/g, ' '));   // non era una tabella Markdown: testo normale
    }
    tabella = null;
  };
  const chiudiTutto = () => { chiudiTabella(); chiudiElenco(); chiudiPar(); };
  for (const raw of righe) {
    const r = raw.replace(/\s+$/, '');
    if (codice) { if (/^\s*(```|~~~)/.test(r)) { out.push(...spezza(codice.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).map((text) => ({ type: 'paragrafo', text }))); codice = null; } else codice.push(r); continue; }
    if (/^\s*(```|~~~)/.test(r)) { chiudiTutto(); codice = []; continue; }
    if (!r.trim()) { chiudiTutto(); continue; }
    if (/^\s*\|.*\|\s*$/.test(r)) { if (!tabella) { chiudiElenco(); chiudiPar(); tabella = []; } tabella.push(r); continue; }
    chiudiTabella();
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(r)) { chiudiElenco(); chiudiPar(); continue; }
    const h = r.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) { chiudiElenco(); chiudiPar(); const t = testoInLinea(h[1]); if (t) out.push({ type: 'titolo', text: t.slice(0, 200) }); continue; }
    const li = r.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) { chiudiPar(); if (!elenco) elenco = []; elenco.push(li[2] ? `${li[2]}. ${li[3]}` : li[3]); continue; }
    if (elenco && /^\s{2,}\S/.test(r)) { elenco[elenco.length - 1] += ` ${r.trim()}`; continue; }   // continuazione della voce
    chiudiElenco();
    const bq = r.match(/^\s*>\s?(.*)$/);
    par.push(bq ? bq[1] : r);
  }
  if (codice) out.push(...spezza(codice.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).map((text) => ({ type: 'paragrafo', text })));
  chiudiTutto();
  return out;
}

// ------------------------------------------------------------------ destinatari dall'audience della news
/** Riga "Destinatari" della circolare: "Personale interno" o il perimetro scelto in Comunicazione (nomi letti dall'anagrafica). */
export async function destinatariDa(audience, client) {
  const run = (sql, p) => client.query(sql, p).then((r) => r.rows);
  const a = audience || { type: 'ALL' };
  const ids = (a.ids || []).map(Number).filter(Number.isInteger);
  let testo;
  switch (a.type) {
    case 'INTERNAL': testo = 'Personale interno'; break;
    case 'SITES': { const n = await run('SELECT name FROM public.sites WHERE id = ANY($1::int[]) ORDER BY name', [ids]); testo = `Personale delle sedi: ${n.map((x) => x.name).join(', ') || ids.join(', ')}`; break; }
    case 'ORGS': { const n = await run('SELECT name FROM public.organizations WHERE id = ANY($1::int[]) ORDER BY name', [ids]); testo = `Utenti delle Legal entity: ${n.map((x) => x.name).join(', ') || ids.join(', ')}`; break; }
    case 'MODULE': { const n = await run('SELECT name FROM public.modules WHERE key = $1', [a.key]); testo = `Utenti del modulo ${n[0]?.name || a.key}`; break; }
    case 'USERS': testo = `Destinatari selezionati (${ids.length})`; break;
    default: testo = 'Tutti gli utenti della Suite';
  }
  return testo.length > 400 ? `${testo.slice(0, 397)}...` : testo;
}

// ------------------------------------------------------------------ registrazione nel registro
const annoDi = (d) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(d ? new Date(d) : new Date()));
const isoGiorno = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d ? new Date(d) : new Date());

async function datiDaNews(client, n) {
  const run = (sql, p) => client.query(sql, p).then((r) => r.rows);
  const allegati = await run(`SELECT f.id, f.filename, f.mime, f.size FROM public.news_files nf JOIN public.files f ON f.id = nf.file_id
                               WHERE nf.news_id = $1 AND f.deleted_at IS NULL ORDER BY f.id`, [n.id]);
  const autore = n.author_id ? (await run(`SELECT u.full_name, u.first_name, u.last_name, u.email, pe.job_title FROM public.users u
                                            LEFT JOIN public.people pe ON pe.id = u.person_id WHERE u.id = $1`, [n.author_id]))[0] : null;
  const corpo = markdownInBlocchi(n.body);
  if (allegati.length) corpo.push({ type: 'titolo', text: 'Allegati' }, { type: 'elenco', items: allegati.map((f) => f.filename) });
  if (!corpo.length) corpo.push({ type: 'paragrafo', text: testoInLinea(n.summary || n.title) });
  const nomeAutore = autore ? ([autore.first_name, autore.last_name].filter(Boolean).join(' ') || autore.full_name) : '';
  const ack = n.requires_ack ? `Presa visione obbligatoria in Comunicazione${n.ack_due ? ` entro il ${dataItaliana(n.ack_due)}` : ''}` : '';
  return {
    allegati,
    cols: {
      tipo: 'INTERNA', linea: '', segmento: 'PERSONALE', titolo: String(n.title).slice(0, 200),
      destinatari: await destinatariDa(n.audience, client), oggetto: '', decorrenza: dataItaliana(n.published_at || new Date()),
      riferimenti: ack, data: isoGiorno(n.published_at), sintesi: n.summary ? String(n.summary).slice(0, 1200) : '',
      corpo, corpo_testo: corpo.map((b) => (b.type === 'elenco' ? b.items.join('. ') : b.type === 'tabella' ? [b.colonne, ...b.righe].map((r) => r.join(' ')).join('. ') : b.text)).join('\n'),
      contatti: autore ? [autore.full_name || nomeAutore, autore.email ? `Mail: ${autore.email}` : null].filter(Boolean) : [],
      firma_nome: nomeAutore, firma_ruolo: autore?.job_title || '',
      audience: n.audience || { type: 'INTERNAL' }, origine: 'COMUNICAZIONE', news_id: n.id, allegati,
    },
  };
}

async function inserisciEImpagina(client, cols, { anno, numero, revisione, parentId, userId, publishedAt }) {
  const protocollo = formatProtocollo(anno, numero, revisione);
  const v = { ...cols, anno, numero, revisione, protocollo, parent_id: parentId || null, stato: 'PUBBLICATA', pub_token: newToken(), orientamento: 'AUTO',
    note_interne: 'Circolare da Comunicazione: presa visione, esiti e questionario nella news.', created_by: userId || null, updated_by: userId || null,
    published_by: userId || null, published_at: publishedAt || new Date() };
  for (const k of ['corpo', 'contatti', 'audience', 'allegati']) v[k] = JSON.stringify(v[k] ?? []);
  const keys = Object.keys(v);
  const row = (await client.query(`INSERT INTO circolari.circolari (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(v))).rows[0];
  const f = await produciFile(row, { publicUrl: publicUrlDi(row) });
  await client.query('UPDATE circolari.circolari SET docx=$2, pdf=$3, pdf_pages=$4, orientamento_eff=$5, render_at=now(), render_error=$6 WHERE id=$1', [row.id, f.docx, f.pdf, f.pages, f.orientamento, f.error]);
  return { id: row.id, protocollo, anno, numero, revisione, has_pdf: Boolean(f.pdf), render_error: f.error, pub_token: row.pub_token };
}

/**
 * Registra la news (circolare pubblicata) nel registro: prossimo numero TD-AAAA/NNN dell'anno di pubblicazione, impaginazione con QR.
 * Idempotente: se la news ha già la sua emissione nel registro la restituisce senza crearne un'altra (niente doppioni).
 * client: connessione della transazione della news (pool della Suite).
 */
export async function registraNews(client, n, { userId = null } = {}) {
  const ex = (await client.query(`SELECT id, protocollo, anno, numero, revisione, pdf IS NOT NULL AS has_pdf, render_error FROM circolari.circolari
                                   WHERE news_id = $1 ORDER BY revisione DESC LIMIT 1`, [n.id])).rows[0];
  if (ex) return { ...ex, esistente: true };
  const { cols } = await datiDaNews(client, n);
  const anno = annoDi(n.published_at);
  const numero = await nextNumero(client, anno);
  return inserisciEImpagina(client, cols, { anno, numero, revisione: 0, userId, publishedAt: n.published_at });
}

/** Revisione TD-AAAA/NNN-rN della circolare della news aggiornata in Comunicazione: le precedenti PUBBLICATE passano a SUPERATA. */
export async function revisionaNews(client, n, { userId = null } = {}) {
  const cur = (await client.query('SELECT id, anno, numero FROM circolari.circolari WHERE id = $1', [n.circolare_id])).rows[0];
  if (!cur?.numero) throw new Error('circolare di origine non trovata nel registro');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`circolari:protocollo:${cur.anno}`]);
  const rev = Number((await client.query('SELECT coalesce(max(revisione), 0) + 1 AS r FROM circolari.circolari WHERE anno = $1 AND numero = $2', [cur.anno, cur.numero])).rows[0].r);
  await client.query(`UPDATE circolari.circolari SET stato='SUPERATA', updated_at=now() WHERE anno=$1 AND numero=$2 AND stato='PUBBLICATA'`, [cur.anno, cur.numero]);
  const { cols } = await datiDaNews(client, n);
  cols.decorrenza = dataItaliana(new Date());
  cols.data = isoGiorno(new Date());
  return inserisciEImpagina(client, cols, { anno: cur.anno, numero: cur.numero, revisione: rev, parentId: cur.id, userId, publishedAt: new Date() });
}

/**
 * Pubblicazione di una circolare in Comunicazione (dentro la transazione della news, riga già PUBLISHED): protocollo dal registro con
 * un SAVEPOINT, così un errore del modulo Circolari non blocca la pubblicazione (loggato, protocollo provvisorio CIRC-…).
 * Ritorna { news, circolare|null, provvisorio, avviso|null, errore|null }.
 */
export async function protocollaNews(client, n, { userId = null, nextProtocol }) {
  let errore = null;
  if (await registroAttivo()) {
    await client.query('SAVEPOINT registro_circolari');
    try {
      const circ = await registraNews(client, n, { userId });
      const row = (await client.query('UPDATE news SET protocol=$2, circolare_id=$3, updated_at=now() WHERE id=$1 RETURNING *', [n.id, circ.protocollo, circ.id])).rows[0];
      await client.query('RELEASE SAVEPOINT registro_circolari');
      return { news: row, circolare: circ, provvisorio: false, avviso: null, errore: null };
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT registro_circolari');
      errore = e.message;
      console.error(`[circolari] registro non disponibile per la news ${n.id}: ${e.message}`);
    }
  }
  const protocol = await nextProtocol('CIRC', client);
  const row = (await client.query('UPDATE news SET protocol=$2, updated_at=now() WHERE id=$1 RETURNING *', [n.id, protocol])).rows[0];
  return { news: row, circolare: null, provvisorio: true, errore,
    avviso: errore ? `protocollo provvisorio: il registro Circolari non ha risposto (${errore}); la circolare si porta nel registro da Amministrazione > Diagnostica (D42)` : AVVISO_NON_ATTIVO };
}

// ------------------------------------------------------------------ diffusione (liste di distribuzione) ed esiti dell'email di avviso
/**
 * Registra la diffusione della circolare da Comunicazione come invio al segmento PERSONALE (una riga per news, mai un secondo invio):
 * destinatari = utenti del perimetro della news; gli esiti si leggono dal registro email della Suite (ref news:<id>).
 * db: { query } della Suite (pool o client). Idempotente.
 */
export async function registraDiffusione(db, { circolareId, news, destinatari, userId = null }) {
  const dest = destinatari.map((u) => ({ email: u.email || null, nome: u.full_name || null, user_id: u.id }));
  const oggetto = news.requires_ack ? `Circolare ${news.protocol}: ${news.title}` : null;
  await db.query(`INSERT INTO circolari.invii (circolare_id, lista_id, destinatari, n_destinatari, n_inviati, n_errori, esito, oggetto_email, inviato_da, inviato_at, news_id, segmento)
                  VALUES ($1, NULL, $2, $3, 0, 0, '[]', $4, $5, coalesce($6, now()), $7, 'PERSONALE') ON CONFLICT (news_id) WHERE news_id IS NOT NULL DO NOTHING`,
  [circolareId, JSON.stringify(dest), dest.length, oggetto, userId, news.published_at || null, news.id]);
  return aggiornaEsiti(db, news.id);
}

/** Esiti dell'email di avviso per destinatario dal registro email della Suite (l'ultimo tentativo vince), scritti sulla riga di invio. */
export async function aggiornaEsiti(db, newsId) {
  const inv = (await db.query('SELECT id, destinatari FROM circolari.invii WHERE news_id = $1', [newsId])).rows[0];
  if (!inv) return null;
  const log = (await db.query(`SELECT lower(to_addr) AS to_addr, status, error FROM public.email_log WHERE ref = $1 ORDER BY id`, [`news:${newsId}`])).rows;
  const e = esitiDiffusione(inv.destinatari || [], log);
  await db.query('UPDATE circolari.invii SET esito=$2, n_inviati=$3, n_errori=$4 WHERE id=$1', [inv.id, JSON.stringify(e.esito), e.inviati, e.errori]);
  return { id: inv.id, ...e };
}

/** Funzione pura: dai destinatari e dalle righe di email_log ricava esito per indirizzo, inviati ed errori. */
export function esitiDiffusione(destinatari, log) {
  const per = new Map(); for (const l of log || []) per.set(String(l.to_addr || '').toLowerCase(), l);
  const esito = (destinatari || []).filter((d) => d.email).map((d) => {
    const l = per.get(String(d.email).toLowerCase());
    if (!l) return { email: d.email, ok: false, stato: 'NON_INVIATA' };
    return l.status === 'FAILED' ? { email: d.email, ok: false, stato: 'FALLITA', error: l.error || null } : { email: d.email, ok: true, stato: l.status === 'SENT' ? 'INVIATA' : 'SOLO_REGISTRATA' };
  });
  return { esito, inviati: esito.filter((x) => x.ok).length, errori: esito.filter((x) => x.stato === 'FALLITA').length };
}

/** PDF impaginato della circolare collegata alla news (per il download dalla news e l'allegato dell'email di avviso). */
export async function pdfDellaNews(db, circolareId) {
  if (!circolareId || !(await registroAttivo())) return null;
  try {
    const r = (await db.query('SELECT id, protocollo, stato, pdf FROM circolari.circolari WHERE id = $1', [circolareId])).rows[0];
    return r?.pdf ? { protocollo: r.protocollo, stato: r.stato, pdf: r.pdf, filename: nomeFilePdf(r.protocollo) } : null;
  } catch { return null; }
}

/** Sintesi della circolare collegata alla news (pagina della news, editor di Comunicazione). Null se il modulo non è LIVE. */
export async function infoCircolare(db, circolareId) {
  if (!circolareId || !(await registroAttivo())) return null;
  try {
    const r = (await db.query('SELECT id, protocollo, stato, revisione, pdf IS NOT NULL AS has_pdf, render_error FROM circolari.circolari WHERE id = $1', [circolareId])).rows[0];
    return r ? { ...r, link: `/circolari/${r.id}` } : null;
  } catch { return null; }
}

/**
 * Diagnostica D42 "Registra": porta nel registro una circolare già pubblicata in Comunicazione con protocollo provvisorio CIRC-….
 * Prende il prossimo TD-AAAA/NNN dell'anno di pubblicazione, conserva lo storico in news.protocol_legacy, crea la riga in Circolari con
 * il PDF e la diffusione (esiti delle email già inviate); nessuna nuova notifica né email. Ritorna { esito, motivo? }.
 */
export async function registraEsistente(newsId, { userId = null } = {}) {
  if (!(await registroAttivo())) return { esito: 'non registrata', motivo: 'il modulo Circolari non è LIVE: avvialo da Amministrazione > Attivazione moduli' };
  const { tx } = await import('../../../db.js');
  const out = await tx(async (c) => {
    const n = (await c.query('SELECT * FROM news WHERE id = $1 FOR UPDATE', [newsId])).rows[0];
    if (!n) return { esito: 'non registrata', motivo: 'news inesistente' };
    if (n.kind !== 'CIRCOLARE' || n.status !== 'PUBLISHED') return { esito: 'non registrata', motivo: 'non è una circolare pubblicata' };
    if (n.circolare_id) return { esito: 'già nel registro', protocollo: n.protocol };
    const circ = await registraNews(c, n, { userId });
    const row = (await c.query(`UPDATE news SET protocol_legacy = coalesce(protocol_legacy, protocol), protocol = $2, circolare_id = $3, updated_at = now() WHERE id = $1 RETURNING *`, [n.id, circ.protocollo, circ.id])).rows[0];
    return { esito: `registrata come ${circ.protocollo}${n.protocol ? ` (era ${n.protocol})` : ''}${circ.has_pdf ? ', PDF impaginato' : `, solo DOCX: ${circ.render_error || 'PDF non disponibile'}`}`, news: row, circolare: circ };
  });
  if (out.news) {
    const { audienceUsers } = await import('../../../lib/community.js');
    const { pool } = await import('../../../db.js');
    await registraDiffusione(pool, { circolareId: out.circolare.id, news: out.news, destinatari: await audienceUsers(out.news.audience), userId }).catch((e) => console.warn('[circolari] diffusione', e.message));
    const { indexNews } = await import('../../../lib/search.js');
    await indexNews(out.news).catch(() => {});
  }
  return out;
}
