// Guida GIPO · seme versionato dei contenuti (server/src/modules/gipoguida/content/): un file markdown per capitolo più faq.md.
// Formato di un capitolo:
//   ---                                  front-matter del capitolo
//   capitolo: 3
//   titolo: Agenda
//   intro: una riga di presentazione
//   ---
//   === sezione                          intestazione di ogni sezione (chiave: valore, fino alla riga "===")
//   ordine: 1
//   slug: agenda-classica
//   titolo: Agenda classica
//   percorso_gipo: /Agende/Classic
//   parole_chiave: agenda, calendario
//   ===
//   corpo in markdown (fino alla sezione successiva)
// faq.md: blocchi "=== faq" con chiave, sezione (slug), ruolo, domanda; sotto la risposta in markdown.
// Nei testi un collegamento a un'altra sezione si scrive [titolo](sezione:slug).
//
// Caricamento (caricaSeme): alla prima attivazione e a ogni avvio (rilascio). Una sezione o FAQ nuova si inserisce (sezioni DA_VALIDARE);
// una già presente si aggiorna SOLO se nessuno l'ha toccata: il suo contenuto ha ancora l'impronta del seme caricato l'ultima volta
// (seme_hash) e, per le sezioni, non è VALIDATA. Le altre restano come sono ("protette": la Redazione vede che il seme è cambiato e può
// ripristinarlo). Nulla si cancella: una voce tolta dal seme resta nel database.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, one } from '../db.js';

export const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
/** Impronta del contenuto di una sezione (titolo, corpo, percorso, parole chiave): uguale tra seme e database se nessuno l'ha toccata */
export const improntaSezione = (s) => sha(JSON.stringify([norm(s.titolo), norm(s.corpo), norm(s.percorso_gipo), norm(s.parole_chiave)]));
export const improntaFaq = (f) => sha(JSON.stringify([norm(f.domanda), norm(f.risposta), norm(f.sezione_slug ?? f.sezione), norm(f.ruolo)]));

function leggiChiavi(righe) {
  const o = {};
  for (const r of righe) {
    const m = r.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (m) o[m[1].toLowerCase()] = m[2].trim();
  }
  return o;
}

/** Analizza un file del seme: { meta (front-matter), blocchi: [{ tipo: 'sezione'|'faq', campi, corpo }] }. Funzione pura. */
export function analizzaFile(testo) {
  const righe = String(testo).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let meta = {};
  if (righe[0]?.trim() === '---') {
    const fine = righe.indexOf('---', 1);
    if (fine < 0) throw new Error('front-matter non chiuso');
    meta = leggiChiavi(righe.slice(1, fine));
    i = fine + 1;
  }
  const blocchi = [];
  let cur = null;
  for (; i < righe.length; i++) {
    const r = righe[i];
    const h = r.match(/^===\s+(sezione|faq)\s*$/i);
    if (h) {
      if (cur) blocchi.push(cur);
      const fine = righe.findIndex((x, k) => k > i && x.trim() === '===');
      if (fine < 0) throw new Error(`intestazione "${r}" non chiusa (riga ${i + 1})`);
      cur = { tipo: h[1].toLowerCase(), campi: leggiChiavi(righe.slice(i + 1, fine)), righe: [] };
      i = fine;
      continue;
    }
    if (cur) cur.righe.push(r);
  }
  if (cur) blocchi.push(cur);
  return { meta, blocchi: blocchi.map((b) => ({ tipo: b.tipo, campi: b.campi, corpo: norm(b.righe.join('\n')) })) };
}

/** Legge tutto il seme dalla cartella: { capitoli, sezioni, faq, impronta } con controlli di coerenza (slug unici, FAQ con sezione esistente). */
export function leggiSeme(dir = CONTENT_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const capitoli = []; const sezioni = []; const faq = [];
  const errori = [];
  for (const f of files) {
    const testo = fs.readFileSync(path.join(dir, f), 'utf8');
    let a;
    try { a = analizzaFile(testo); } catch (e) { errori.push(`${f}: ${e.message}`); continue; }
    if (a.meta.capitolo != null && a.meta.capitolo !== '') {
      const numero = Number(a.meta.capitolo);
      capitoli.push({ numero, titolo: a.meta.titolo, intro: a.meta.intro || null, file: f });
      for (const b of a.blocchi.filter((x) => x.tipo === 'sezione')) {
        sezioni.push({ capitolo: numero, ordine: Number(b.campi.ordine) || 0, slug: b.campi.slug, titolo: b.campi.titolo, percorso_gipo: b.campi.percorso_gipo || null,
          parole_chiave: b.campi.parole_chiave || null, corpo: b.corpo, file: f });
      }
    }
    for (const b of a.blocchi.filter((x) => x.tipo === 'faq')) {
      faq.push({ chiave: b.campi.chiave, sezione_slug: b.campi.sezione || null, ruolo: b.campi.ruolo || null, domanda: b.campi.domanda, risposta: b.corpo, file: f });
    }
  }
  const slugs = new Set();
  for (const s of sezioni) {
    if (!s.slug || !/^[a-z0-9-]+$/.test(s.slug)) errori.push(`${s.file}: slug non valido "${s.slug}"`);
    if (slugs.has(s.slug)) errori.push(`${s.file}: slug ripetuto "${s.slug}"`);
    slugs.add(s.slug);
    if (!s.titolo) errori.push(`${s.file}: sezione ${s.slug} senza titolo`);
    if (!s.corpo) errori.push(`${s.file}: sezione ${s.slug} senza testo`);
  }
  const chiavi = new Set();
  faq.forEach((x, i) => {
    x.ordine = i + 1;
    if (!x.chiave || chiavi.has(x.chiave)) errori.push(`${x.file}: FAQ con chiave mancante o ripetuta "${x.chiave}"`);
    chiavi.add(x.chiave);
    if (!x.domanda || !x.risposta) errori.push(`${x.file}: FAQ ${x.chiave} senza domanda o risposta`);
    if (x.sezione_slug && !slugs.has(x.sezione_slug)) errori.push(`${x.file}: FAQ ${x.chiave} collegata a una sezione inesistente "${x.sezione_slug}"`);
  });
  // collegamenti interni [testo](sezione:slug) verso sezioni esistenti
  for (const t of [...sezioni.map((s) => [s.slug, s.corpo]), ...faq.map((x) => [x.chiave, x.risposta])]) {
    for (const m of t[1].matchAll(/\(sezione:([a-z0-9-]+)\)/g)) if (!slugs.has(m[1])) errori.push(`${t[0]}: collegamento a una sezione inesistente "${m[1]}"`);
  }
  if (errori.length) throw new Error(`Seme della Guida GIPO non valido:\n- ${errori.join('\n- ')}`);
  const impronta = sha(JSON.stringify([capitoli, sezioni.map((s) => [s.capitolo, s.ordine, s.slug, improntaSezione(s)]), faq.map((x) => [x.chiave, x.ordine, improntaFaq(x)])]));
  return { capitoli, sezioni, faq, impronta };
}

let semeCache = null;
/** Seme letto una volta per processo (i file cambiano solo con un rilascio) */
export function seme() { if (!semeCache) semeCache = leggiSeme(); return semeCache; }
export function _azzeraCacheSeme() { semeCache = null; }

/**
 * Carica il seme nel database (transazione unica). forza: rilegge anche se l'impronta complessiva non è cambiata.
 * Ritorna { impronta, saltato?, capitoli, sezioni: { nuove, aggiornate, invariate, protette: [slug] }, faq: { ... } }.
 */
export async function caricaSeme({ forza = false, dir = null } = {}) {
  const s = dir ? leggiSeme(dir) : seme();
  const prima = (await one(`SELECT value FROM impostazioni WHERE key = 'seme'`))?.value;
  if (!forza && prima?.impronta === s.impronta) return { impronta: s.impronta, saltato: true };
  const out = { impronta: s.impronta, capitoli: s.capitoli.length, sezioni: { nuove: 0, aggiornate: 0, invariate: 0, protette: [] }, faq: { nuove: 0, aggiornate: 0, invariate: 0, protette: [] } };
  await tx(async (c) => {
    for (const k of s.capitoli) {
      await c.query(`INSERT INTO capitoli (numero, titolo, intro) VALUES ($1,$2,$3)
        ON CONFLICT (numero) DO UPDATE SET titolo = EXCLUDED.titolo, intro = EXCLUDED.intro, updated_at = now()
        WHERE capitoli.titolo IS DISTINCT FROM EXCLUDED.titolo OR capitoli.intro IS DISTINCT FROM EXCLUDED.intro`, [k.numero, k.titolo, k.intro]);
    }
    for (const x of s.sezioni) {
      const h = improntaSezione(x);
      const cur = (await c.query('SELECT * FROM sezioni WHERE slug = $1', [x.slug])).rows[0];
      if (!cur) {
        await c.query(`INSERT INTO sezioni (capitolo, ordine, titolo, slug, corpo, percorso_gipo, parole_chiave, stato, origine, seme_hash)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'DA_VALIDARE','SEME',$8)`, [x.capitolo, x.ordine, x.titolo, x.slug, x.corpo, x.percorso_gipo, x.parole_chiave, h]);
        out.sezioni.nuove++;
        continue;
      }
      // posizione: segue sempre il seme per le sezioni nate dal seme
      if (cur.origine === 'SEME' && (cur.capitolo !== x.capitolo || cur.ordine !== x.ordine)) await c.query('UPDATE sezioni SET capitolo = $2, ordine = $3 WHERE id = $1', [cur.id, x.capitolo, x.ordine]);
      if (cur.seme_hash === h) { out.sezioni.invariate++; continue; }
      const intatta = improntaSezione(cur) === cur.seme_hash && cur.stato !== 'VALIDATA';
      if (!intatta) { out.sezioni.protette.push(x.slug); continue; }
      await c.query(`INSERT INTO revisioni (sezione_id, titolo, corpo, percorso_gipo, parole_chiave, stato, fonte, nota) VALUES ($1,$2,$3,$4,$5,$6,'SEME',$7)`,
        [cur.id, cur.titolo, cur.corpo, cur.percorso_gipo, cur.parole_chiave, cur.stato, 'Versione sostituita dal seme di un nuovo rilascio']);
      await c.query(`UPDATE sezioni SET titolo = $2, corpo = $3, percorso_gipo = $4, parole_chiave = $5, seme_hash = $6, aggiornata_il = now(), aggiornata_da = NULL WHERE id = $1`,
        [cur.id, x.titolo, x.corpo, x.percorso_gipo, x.parole_chiave, h]);
      out.sezioni.aggiornate++;
    }
    const idSezione = new Map((await c.query('SELECT id, slug FROM sezioni')).rows.map((r) => [r.slug, r.id]));
    for (const x of s.faq) {
      const h = improntaFaq(x);
      const sid = x.sezione_slug ? idSezione.get(x.sezione_slug) || null : null;
      const cur = (await c.query(`SELECT f.*, s.slug AS sezione_slug FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id WHERE f.seme_chiave = $1`, [x.chiave])).rows[0];
      if (!cur) {
        await c.query(`INSERT INTO faq (domanda, risposta, sezione_id, ordine, origine, ruolo, pubblicata, seme_chiave, seme_hash) VALUES ($1,$2,$3,$4,'SEME',$5,TRUE,$6,$7)`,
          [x.domanda, x.risposta, sid, x.ordine, x.ruolo, x.chiave, h]);
        out.faq.nuove++;
        continue;
      }
      if (cur.ordine !== x.ordine) await c.query('UPDATE faq SET ordine = $2 WHERE id = $1', [cur.id, x.ordine]);
      if (cur.seme_hash === h) { out.faq.invariate++; continue; }
      if (improntaFaq(cur) !== cur.seme_hash) { out.faq.protette.push(x.chiave); continue; }
      await c.query(`UPDATE faq SET domanda = $2, risposta = $3, sezione_id = $4, ruolo = $5, seme_hash = $6, aggiornata_il = now(), aggiornata_da = NULL WHERE id = $1`,
        [cur.id, x.domanda, x.risposta, sid, x.ruolo, h]);
      out.faq.aggiornate++;
    }
    await c.query(`INSERT INTO impostazioni (key, value) VALUES ('seme', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ impronta: s.impronta, at: new Date().toISOString(), esito: out })]);
  });
  return out;
}

/** La versione del seme di una sezione (per "Ripristina dal seme" e per l'avviso "il seme è cambiato") */
export const sezioneDelSeme = (slug) => seme().sezioni.find((x) => x.slug === slug) || null;
