// Funzioni comuni del modulo Referti esterni: impostazioni, registro, nome del file, elaborazione di un PDF caricato,
// generazione e conferma di una scheda. Privacy: nessun nome di paziente nei log del server; l'audit della Suite riceve solo id e conteggi.
import { q, one, many, tx } from '../db.js';
import { KEY, SORGENTI, SETTINGS_DEFAULT } from '../config.js';
import { notFound, bad, HttpError } from '../../../lib/util.js';
import { estraiTesto, ritagliaPagine } from './pdf.js';
import { elabora } from './parsers/index.js';
import { anomalia } from './parsers/common.js';
import { generaDocx, generaPdf, testoDocx } from './docgen.js';
import { controllaCoerenza } from './coerenza.js';
import { storeBuffer, readBuffer, dropBlobs } from './storage.js';
import { nomeFileSicuro, compattaSpazi } from './text.js';

export { KEY, SORGENTI };
export const idOf = (v, msg = 'Elemento non trovato') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw notFound(msg); return n; };

// ---- Impostazioni (app_settings dello schema del modulo)
export async function settings() {
  const rows = await many('SELECT key, value FROM app_settings');
  const out = { ...SETTINGS_DEFAULT };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setSetting(key, value, userId) {
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), userId || null]);
}
export async function templateAttivo() {
  return one('SELECT id, filename, size, sha256, data, created_at, uploaded_by FROM templates WHERE attivo ORDER BY id DESC LIMIT 1');
}

// ---- Registro del modulo
export async function registra(azione, { scheda_id = null, elaborazione_id = null, user_id = null, dettagli = {} } = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  await runner('INSERT INTO registro (scheda_id, elaborazione_id, azione, user_id, dettagli) VALUES ($1,$2,$3,$4,$5)', [scheda_id, elaborazione_id, azione, user_id, JSON.stringify(dettagli || {})]);
}

// ---- Nome del file: "Referto - COGNOME NOME" (+ suffisso tra parentesi se esiste già per un'altra scheda)
export const nomeBase = (cognomeNome) => nomeFileSicuro(`Referto - ${compattaSpazi(cognomeNome || 'PAZIENTE').toUpperCase()}`);

// Suffisso descrittivo: primo esame (es. "KPC"), sorgente (es. "Bianalisi"), oppure data di accettazione
export function suffissoPer(dati, modo = 'ESAME') {
  const a = dati.anagrafica || {};
  const breve = { BIANALISI: 'Bianalisi', CERBA_RDI: 'Cerba RDI', CERBA_NUOVA_IGEA: 'Nuova Igea', ALTRO: 'Esterno' }[dati.sorgente] || 'Esterno';
  if (modo === 'SORGENTE') return breve;
  if (modo === 'DATA') return (a.data_acc || a.referto_data || a.accettazione_data || '').replace(/\//g, '-') || breve;
  const primo = Number(dati.corpo) === 2 ? dati.esami?.[0]?.titolo : (dati.settori || []).flatMap((s) => s.righe || []).find((r) => r.tipo === 'esame')?.nome;
  if (!primo) return breve;
  let s = compattaSpazi(primo).replace(/^\w\s*-\s*/, '').replace(/\(\d+\)/g, '').replace(/\s+(test|di conferma|colturale|PCR).*$/i, '').trim();
  if (/^urinocoltura$/i.test(s)) s = 'Urinocoltura';
  if (s.length > 24) s = s.slice(0, 24).trim();
  return s || breve;
}

// Nome definitivo con suffisso se un'altra scheda confermata ha già lo stesso nome (e non si tratta di sostituzione)
export async function risolviNomeFile(scheda, dati, imp) {
  const base = scheda.nome_file || nomeBase(dati.anagrafica?.cognome_nome);
  const altra = await one(`SELECT id FROM schede WHERE id<>$1 AND stato='CONFERMATA' AND lower(nome_file)=lower($2) AND sostituita_da IS NULL ORDER BY id DESC LIMIT 1`, [scheda.id, base]);
  if (!altra) return { nome: base, doppio: null };
  const sostituisce = (dati.note || []).some((n) => /annulla e sostituisce/i.test(n));
  if (sostituisce) return { nome: base, doppio: altra.id, sostituisce: true };
  let nome = `${base} (${suffissoPer(dati, imp.suffisso_predefinito)})`;
  let k = 2;
  while (await one(`SELECT 1 FROM schede WHERE id<>$1 AND stato='CONFERMATA' AND lower(nome_file)=lower($2)`, [scheda.id, nome])) nome = `${base} (${suffissoPer(dati, imp.suffisso_predefinito)} ${k++})`;
  return { nome, doppio: altra.id, sostituisce: false };
}

// ---- Caricamento ed elaborazione di un PDF: una elaborazione + N schede in BOZZA
export async function elaboraUpload(file, userId) {
  const buf = file.buffer;
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad(`"${file.originalname}": non è un file PDF`);
  const stored = await storeBuffer('sorgenti', `${Date.now()}-${file.originalname}`, 'application/pdf', buf);
  const el = await one(`INSERT INTO elaborazioni (filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,'application/pdf',$2,$3,$4,$5,$6) RETURNING *`,
    [String(file.originalname || 'referto.pdf').slice(0, 200), stored.size, stored.sha256, stored.data, stored.blob_path, userId]);
  let estratto;
  try { estratto = await estraiTesto(buf); } catch (e) {
    await q(`UPDATE elaborazioni SET stato='SCARTATO', motivo_scarto=$2 WHERE id=$1`, [el.id, e.message]);
    await registra('SCARTATO', { elaborazione_id: el.id, user_id: userId, dettagli: { motivo: e.message } });
    return { ...el, stato: 'SCARTATO', motivo_scarto: e.message, schede: [] };
  }
  const r = elabora(estratto);
  if (r.motivo_scarto) {
    await q(`UPDATE elaborazioni SET stato='SCARTATO', motivo_scarto=$2, pagine=$3, sorgente=$4, ocr=$5 WHERE id=$1`, [el.id, r.motivo_scarto, estratto.n_pagine, r.sorgente, estratto.ocr]);
    await registra('SCARTATO', { elaborazione_id: el.id, user_id: userId, dettagli: { motivo: r.motivo_scarto, pagine: estratto.n_pagine } });
    return { ...el, stato: 'SCARTATO', motivo_scarto: r.motivo_scarto, pagine: estratto.n_pagine, sorgente: r.sorgente, schede: [] };
  }
  const schede = [];
  await tx(async (c) => {
    for (const s of r.schede) {
      const a = s.dati.anagrafica || {};
      // testo sorgente = riga anagrafica + riquadro dei risultati (indicazione del CEO 29/10/2026); il PDF intero resta in elaborazioni
      const testo = s.testo_sorgente || '';
      const nome = nomeBase(a.cognome_nome);
      // il nome esiste già per un'altra scheda confermata: anomalia (il suffisso si decide alla conferma)
      const anomalie = [...s.anomalie];
      const doppio = (await c.query(`SELECT 1 FROM schede WHERE stato='CONFERMATA' AND lower(nome_file)=lower($1) AND sostituita_da IS NULL`, [nome])).rows[0];
      if (doppio) anomalie.push(anomalia('NOME_DOPPIO'));
      // accettazione/referto esterni: solo colonne interne di tracciabilità (registro), mai nel DOCX
      const row = (await c.query(`INSERT INTO schede (elaborazione_id, pagine, sorgente, cognome_nome, data_nascita, sesso, luogo_nascita, indirizzo, accettazione, data_acc, referto_codice, referto_data, dati, dati_orig, testo_sorgente, anomalie, nome_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16) RETURNING id`,
      [el.id, s.pagine, s.dati.sorgente, a.cognome_nome || '', a.data_nascita || null, a.sesso || null, a.luogo_nascita || null, a.indirizzo || null, a.accettazione_n || a.accettazione_codice || null, a.data_acc || a.accettazione_data || null,
        a.referto_codice || null, a.referto_data || null, JSON.stringify(s.dati), testo, JSON.stringify(anomalie), nome])).rows[0];
      schede.push({ id: row.id, pagine: s.pagine, cognome_nome: a.cognome_nome || '', anomalie, stato: 'BOZZA' });
    }
    await c.query(`UPDATE elaborazioni SET stato='ELABORATO', pagine=$2, sorgente=$3, ocr=$4 WHERE id=$1`, [el.id, estratto.n_pagine, r.sorgente, estratto.ocr]);
    await registra('CARICATO', { elaborazione_id: el.id, user_id: userId, dettagli: { schede: schede.length, pagine: estratto.n_pagine, sorgente: r.sorgente, ocr: estratto.ocr } }, c);
  });
  return { ...el, stato: 'ELABORATO', pagine: estratto.n_pagine, sorgente: r.sorgente, ocr: estratto.ocr, schede };
}

// ---- Lettura
export const S_COLS = `s.id, s.elaborazione_id, s.pagine, s.sorgente, s.cognome_nome, s.data_nascita, s.sesso, s.luogo_nascita, s.indirizzo, s.accettazione, s.data_acc, s.referto_codice, s.referto_data,
  s.anomalie, s.stato, s.nome_file, s.sostituisce_id, s.sostituita_da, s.confirmed_by, s.confirmed_at, s.created_at, s.updated_at,
  e.filename AS elaborazione_filename, e.pagine AS elaborazione_pagine, e.ocr, cu.full_name AS confirmed_by_nome`;
export const S_FROM = `schede s JOIN elaborazioni e ON e.id=s.elaborazione_id LEFT JOIN public.users cu ON cu.id=s.confirmed_by`;

export async function loadScheda(id, { conDati = true } = {}) {
  const s = await one(`SELECT ${S_COLS}${conDati ? ', s.dati, s.dati_orig' : ''} FROM ${S_FROM} WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Scheda non trovata');
  s.file = await many(`SELECT id, kind, filename, mime, size, intero, created_at FROM file_prodotti WHERE scheda_id=$1 ORDER BY CASE kind WHEN 'SORGENTE_PDF' THEN 0 WHEN 'DOCX' THEN 1 ELSE 2 END`, [id]);
  return s;
}

export async function elaborazioneCon(id) {
  const e = await one(`SELECT e.id, e.filename, e.size, e.pagine, e.sorgente, e.stato, e.motivo_scarto, e.ocr, e.uploaded_by, e.created_at, u.full_name AS uploaded_by_nome FROM elaborazioni e LEFT JOIN public.users u ON u.id=e.uploaded_by WHERE e.id=$1`, [id]);
  if (!e) throw notFound('Elaborazione non trovata');
  e.schede = await many(`SELECT ${S_COLS} FROM ${S_FROM} WHERE s.elaborazione_id=$1 ORDER BY s.id`, [id]);
  return e;
}

// ---- Generazione (anteprima e conferma)
export async function generaPer(scheda, imp) {
  const tpl = await templateAttivo();
  const docx = await generaDocx(scheda.dati, { template: tpl ? Buffer.from(tpl.data) : null });
  const testo = testoDocx(docx);
  const coerenza = controllaCoerenza({ datiOrig: scheda.dati_orig, dati: scheda.dati, testoSorgente: scheda.testo_sorgente, testoDocx: testo });
  const pdf = imp.genera_pdf === false ? null : await generaPdf(docx);
  return { docx, pdf, coerenza, template: tpl ? tpl.filename : 'predefinito' };
}

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Conferma: controllo di coerenza (salvo force), file definitivi, nome con suffisso o sostituzione tracciata, registro
export async function confermaScheda(id, userId, { force = false } = {}) {
  const s = await one(`SELECT s.*, e.data AS e_data, e.blob_path AS e_blob_path, e.pagine AS e_pagine, e.filename AS e_filename, e.size AS e_size FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'BOZZA') throw bad('La scheda non è in bozza');
  const imp = await settings();
  const gen = await generaPer(s, imp);
  if (!gen.coerenza.ok && !force) throw new HttpError(400, 'Il controllo di coerenza non è superato: correggi la scheda oppure conferma comunque', { coerenza: gen.coerenza });
  const { nome, doppio, sostituisce } = await risolviNomeFile(s, s.dati, imp);
  const fileDocx = await storeBuffer('prodotti', `${id}-${nome}.docx`, MIME_DOCX, gen.docx);
  const filePdf = gen.pdf ? await storeBuffer('prodotti', `${id}-${nome}.pdf`, 'application/pdf', gen.pdf) : null;
  // PDF sorgente: ritaglio delle pagine della scheda (pdf-lib) se il PDF ha più pagine della scheda; altrimenti rimando al PDF intero
  let sorgente = null;
  const pagineTot = Number(s.e_pagine || 0);
  const serveRitaglio = pagineTot > (s.pagine || []).length;
  if (serveRitaglio) {
    const buf = await readBuffer({ data: s.e_data, blob_path: s.e_blob_path });
    const rit = buf ? await ritagliaPagine(buf, s.pagine) : null;
    if (rit) sorgente = await storeBuffer('sorgenti', `${id}-${nome} (sorgente).pdf`, 'application/pdf', rit);
  }
  const risultato = await tx(async (c) => {
    await c.query('DELETE FROM file_prodotti WHERE scheda_id=$1', [id]);
    await c.query(`INSERT INTO file_prodotti (scheda_id, kind, filename, mime, size, sha256, data, blob_path, elaborazione_id, intero) VALUES ($1,'SORGENTE_PDF',$2,'application/pdf',$3,$4,$5,$6,$7,$8)`,
      [id, `${nome} (sorgente).pdf`, sorgente ? sorgente.size : s.e_size || 0, sorgente ? sorgente.sha256 : null, sorgente ? sorgente.data : null, sorgente ? sorgente.blob_path : null, sorgente ? null : s.elaborazione_id, !sorgente && serveRitaglio]);
    await c.query(`INSERT INTO file_prodotti (scheda_id, kind, filename, mime, size, sha256, data, blob_path) VALUES ($1,'DOCX',$2,$3,$4,$5,$6,$7)`, [id, `${nome}.docx`, MIME_DOCX, fileDocx.size, fileDocx.sha256, fileDocx.data, fileDocx.blob_path]);
    if (filePdf) await c.query(`INSERT INTO file_prodotti (scheda_id, kind, filename, mime, size, sha256, data, blob_path) VALUES ($1,'PDF',$2,'application/pdf',$3,$4,$5,$6)`, [id, `${nome}.pdf`, filePdf.size, filePdf.sha256, filePdf.data, filePdf.blob_path]);
    await c.query(`UPDATE schede SET stato='CONFERMATA', nome_file=$2, sostituisce_id=$3, confirmed_by=$4, confirmed_at=now(), updated_at=now() WHERE id=$1`, [id, nome, sostituisce ? doppio : null, userId]);
    if (sostituisce && doppio) {
      await c.query(`UPDATE schede SET sostituita_da=$2, updated_at=now() WHERE id=$1`, [doppio, id]);
      await registra('SOSTITUZIONE', { scheda_id: id, user_id: userId, dettagli: { sostituisce_scheda_id: doppio, nome_file: nome } }, c);
    }
    await registra('CONFERMATA', { scheda_id: id, user_id: userId, dettagli: { nome_file: nome, forzata: !gen.coerenza.ok, coerenza_ok: gen.coerenza.ok, anomalie: (s.anomalie || []).length, pdf: Boolean(filePdf), suffisso: doppio && !sostituisce ? true : false, pdf_sorgente_intero: !sorgente && serveRitaglio, template: gen.template } }, c);
    return { id, nome_file: nome, forzata: !gen.coerenza.ok, coerenza: gen.coerenza, sostituisce: sostituisce ? doppio : null, suffisso: Boolean(doppio && !sostituisce), pdf_sorgente_intero: !sorgente && serveRitaglio };
  });
  return risultato;
}

// Eliminazione dei contenuti oltre la retention (solo i PDF sorgente delle elaborazioni, i file prodotti restano)
export async function applicaRetention() {
  const imp = await settings();
  const giorni = Number(imp.retention_giorni || 0);
  if (!giorni) return { skipped: true, reason: 'retention disattivata' };
  const rows = await many(`SELECT id, blob_path FROM elaborazioni WHERE created_at < now() - make_interval(days => $1) AND (data IS NOT NULL OR blob_path IS NOT NULL)`, [giorni]);
  if (!rows.length) return { eliminati: 0 };
  await dropBlobs(rows.map((r) => r.blob_path));
  await q(`UPDATE elaborazioni SET data=NULL, blob_path=NULL WHERE id = ANY($1::int[])`, [rows.map((r) => r.id)]);
  return { eliminati: rows.length };
}
