// Funzioni comuni del modulo Referti esterni: impostazioni, registro, nome del file, elaborazione di un PDF caricato (lettura con
// Claude, lib/lettura.js), versioni dei dati della scheda ("Chiedi una correzione"), generazione (lib/formatTD.js, porting del generatore
// del progetto) e conferma. Privacy: nessun nome di paziente nei log del server; l'audit della Suite riceve solo id e conteggi.
import { q, one, many, tx } from '../db.js';
import { KEY, SORGENTI, SETTINGS_DEFAULT } from '../config.js';
import { notFound, bad, HttpError } from '../../../lib/util.js';
import { estraiTesto, ritagliaPagine } from './pdf.js';
import { anomalia } from './parsers/common.js';
import { generaDocx, generaPdf, testoDocx, TEMPLATE_DEFAULT_NOME } from './formatTD.js';
import { controllaCoerenza } from './coerenza.js';
import { leggiReferto, correggiScheda } from './lettura.js';
import { isSchemaBlocchi, colonneAnagrafica, anomalieAutomatiche, primoEsame, testiParagrafi, validaDati, senzaRimandiLaboratorio } from './blocchi.js';
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
  const col = colonneAnagrafica(dati.anagrafica || {});
  const breve = { BIANALISI: 'Bianalisi', CERBA_RDI: 'Cerba RDI', CERBA_NUOVA_IGEA: 'Nuova Igea', ALTRO: 'Esterno' }[dati.sorgente] || 'Esterno';
  if (modo === 'SORGENTE') return breve;
  if (modo === 'DATA') return (col.data_acc || col.referto_data || '').replace(/\//g, '-') || breve;
  const primo = primoEsame(dati);
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
  const sostituisce = testiParagrafi(dati).some((n) => /annulla\s+e\s+sostituisce/i.test(n));
  if (sostituisce) return { nome: base, doppio: altra.id, sostituisce: true };
  let nome = `${base} (${suffissoPer(dati, imp.suffisso_predefinito)})`;
  let k = 2;
  while (await one(`SELECT 1 FROM schede WHERE id<>$1 AND stato='CONFERMATA' AND lower(nome_file)=lower($2)`, [scheda.id, nome])) nome = `${base} (${suffissoPer(dati, imp.suffisso_predefinito)} ${k++})`;
  return { nome, doppio: altra.id, sostituisce: false };
}

// ---- Caricamento ed elaborazione di un PDF: una elaborazione + N schede in BOZZA
// origine: { origine: 'UPLOAD' | 'CASELLA', graph_id, from_email, from_name, subject, received_at, message_id } (allegato di una mail
// arrivata alla casella template@: lib/casella.js); userId NULL per la casella
export async function elaboraUpload(file, userId, origine = {}) {
  const buf = file.buffer;
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad(`"${file.originalname}": non è un file PDF`);
  const stored = await storeBuffer('sorgenti', `${Date.now()}-${file.originalname}`, 'application/pdf', buf);
  const o = origine || {};
  const el = await one(`INSERT INTO elaborazioni (filename, mime, size, sha256, data, blob_path, uploaded_by, origine, graph_id, from_email, from_name, subject, received_at, message_id)
    VALUES ($1,'application/pdf',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [String(file.originalname || 'referto.pdf').slice(0, 200), stored.size, stored.sha256, stored.data, stored.blob_path, userId || null, o.origine === 'CASELLA' ? 'CASELLA' : 'UPLOAD',
      o.graph_id || null, o.from_email || null, o.from_name ? String(o.from_name).slice(0, 200) : null, o.subject ? String(o.subject).slice(0, 500) : null, o.received_at || null, o.message_id || null]);
  let estratto;
  try { estratto = await estraiTesto(buf); } catch (e) {
    await q(`UPDATE elaborazioni SET stato='SCARTATO', motivo_scarto=$2 WHERE id=$1`, [el.id, e.message]);
    await registra('SCARTATO', { elaborazione_id: el.id, user_id: userId || null, dettagli: { motivo: e.message, origine: el.origine } });
    return { ...el, stato: 'SCARTATO', motivo_scarto: e.message, schede: [] };
  }
  const r = await leggiReferto({ buffer: buf, estratto, rif: `elaborazione ${el.id}`, userId });
  const sorgenteEl = r.schede?.[0]?.dati?.sorgente || 'ALTRO';
  if (r.non_referto || !r.schede?.length) {
    const motivo = (/^Il PDF\b/i.test(r.motivo || '') ? r.motivo : `Il PDF non è un referto di laboratorio: ${r.motivo || 'nessun paziente riconosciuto'}`).slice(0, 500);
    await q(`UPDATE elaborazioni SET stato='SCARTATO', motivo_scarto=$2, pagine=$3, sorgente=$4, ocr=$5 WHERE id=$1`, [el.id, motivo, estratto.n_pagine, 'ALTRO', estratto.ocr]);
    await registra('SCARTATO', { elaborazione_id: el.id, user_id: userId || null, dettagli: { motivo, pagine: estratto.n_pagine, origine: el.origine, lettura: r.modo } });
    return { ...el, stato: 'SCARTATO', motivo_scarto: motivo, pagine: estratto.n_pagine, sorgente: 'ALTRO', lettura: r.modo, schede: [] };
  }
  const schede = [];
  await tx(async (c) => {
    for (const s of r.schede) {
      const row = await inserisciScheda(c, el.id, s, r.modo, userId);
      schede.push({ id: row.id, pagine: s.pagine, cognome_nome: s.colonne.cognome_nome, anomalie: row.anomalie, stato: 'BOZZA' });
    }
    await c.query(`UPDATE elaborazioni SET stato='ELABORATO', pagine=$2, sorgente=$3, ocr=$4 WHERE id=$1`, [el.id, estratto.n_pagine, sorgenteEl, estratto.ocr]);
    await registra('CARICATO', { elaborazione_id: el.id, user_id: userId || null, dettagli: { schede: schede.length, pagine: estratto.n_pagine, sorgente: sorgenteEl, ocr: estratto.ocr, origine: el.origine, from_email: el.from_email || undefined, lettura: r.modo, ms: r.ms, token: r.usage || undefined } }, c);
  });
  return { ...el, stato: 'ELABORATO', pagine: estratto.n_pagine, sorgente: sorgenteEl, ocr: estratto.ocr, lettura: r.modo, schede };
}

// Nome già usato da un'altra scheda confermata: anomalia (il suffisso si decide alla conferma)
async function anomalieConNome(c, schedaId, dati, base) {
  const nome = nomeBase(colonneAnagrafica(dati.anagrafica).cognome_nome);
  const doppio = (await c.query(`SELECT 1 FROM schede WHERE stato='CONFERMATA' AND lower(nome_file)=lower($1) AND sostituita_da IS NULL AND id<>$2`, [nome, schedaId || 0])).rows[0];
  return doppio ? [...base, anomalia('NOME_DOPPIO')] : base;
}

// Inserimento di una scheda letta (versione 1, origine LETTURA)
async function inserisciScheda(c, elaborazioneId, s, modo, userId) {
  const col = s.colonne;
  const anomalie = await anomalieConNome(c, null, s.dati, s.anomalie);
  const row = (await c.query(`INSERT INTO schede (elaborazione_id, pagine, sorgente, cognome_nome, data_nascita, sesso, luogo_nascita, indirizzo, accettazione, data_acc, referto_codice, referto_data, dati, dati_orig, testo_sorgente, anomalie, nome_file, lettura, antibiotici_sorgente)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18) RETURNING id`,
  [elaborazioneId, s.pagine, s.dati.sorgente, col.cognome_nome || '', col.data_nascita, col.sesso, col.luogo_nascita, col.indirizzo, col.accettazione, col.data_acc, col.referto_codice, col.referto_data,
    JSON.stringify(s.dati), s.testo_sorgente || '', JSON.stringify(anomalie), nomeBase(col.cognome_nome), modo, s.antibiotici_sorgente ?? null])).rows[0];
  await c.query(`INSERT INTO scheda_versioni (scheda_id, n, dati, origine, user_id) VALUES ($1,1,$2,'LETTURA',$3)`, [row.id, JSON.stringify(s.dati), userId || null]);
  return { id: row.id, anomalie };
}

// ---- Versioni dei dati ("Chiedi una correzione", modifiche manuali, rielaborazione)
export async function versioni(schedaId) {
  return many(`SELECT v.id, v.n, v.origine, v.istruzione, v.at, u.full_name AS user_nome FROM scheda_versioni v LEFT JOIN public.users u ON u.id=v.user_id WHERE v.scheda_id=$1 ORDER BY v.n DESC`, [schedaId]);
}

// Nuovi dati della scheda: colonne di ricerca riallineate, anomalie ricalcolate, nome file che segue il paziente se non personalizzato,
// nuova versione (salvo nuovaVersione false: ripristino di una versione esistente). opzioni: { origine, istruzione, userId, nomeFile, nuovaVersione }
export async function aggiornaDati(id, dati, { origine = 'MANUALE', istruzione = null, userId = null, nomeFile = undefined, nuovaVersione = true } = {}) {
  return tx(async (c) => {
    const cur = (await c.query('SELECT s.*, e.ocr FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1 FOR UPDATE OF s', [id])).rows[0];
    if (!cur) throw notFound('Scheda non trovata');
    const col = colonneAnagrafica(dati.anagrafica);
    let nome = nomeFile != null ? nomeFileSicuro(String(nomeFile).replace(/\.(docx|pdf)$/i, '')) : cur.nome_file;
    if (!nome) nome = nomeBase(col.cognome_nome);
    if (nomeFile == null && cur.nome_file === nomeBase(cur.cognome_nome)) nome = nomeBase(col.cognome_nome);   // nome non personalizzato: segue il paziente
    const d = { ...dati, sorgente: cur.dati?.sorgente || cur.sorgente, nome_file: nomeBase(col.cognome_nome) };
    const anomalie = await anomalieConNome(c, id, d, anomalieAutomatiche(d, { ocr: cur.ocr, modo: cur.lettura || 'CLAUDE' }));
    const n = Number((await c.query('SELECT coalesce(max(n),0)::int AS n FROM scheda_versioni WHERE scheda_id=$1', [id])).rows[0].n) + (nuovaVersione ? 1 : 0);
    await c.query(`UPDATE schede SET dati=$2, cognome_nome=$3, data_nascita=$4, sesso=$5, luogo_nascita=$6, indirizzo=$7, accettazione=$8, data_acc=$9, referto_codice=$10, referto_data=$11, nome_file=$12, anomalie=$13, updated_at=now() WHERE id=$1`,
      [id, JSON.stringify(d), col.cognome_nome || '', col.data_nascita, col.sesso, col.luogo_nascita, col.indirizzo, col.accettazione, col.data_acc, col.referto_codice, col.referto_data, nome, JSON.stringify(anomalie)]);
    if (nuovaVersione) await c.query(`INSERT INTO scheda_versioni (scheda_id, n, dati, origine, istruzione, user_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, n, JSON.stringify(d), origine, istruzione ? String(istruzione).slice(0, 2000) : null, userId || null]);
    return { n, nome_file: nome, anomalie };
  });
}

// PDF da mandare a Claude per una scheda: le sole pagine della scheda (pdf-lib, se disponibile), altrimenti il PDF intero
async function pdfScheda(s) {
  const e = await one('SELECT data, blob_path, pagine FROM elaborazioni WHERE id=$1', [s.elaborazione_id]);
  const buf = e ? await readBuffer(e) : null;
  if (!buf) return { buffer: null, intero: false };
  if (Number(e.pagine || 0) > (s.pagine || []).length) { const rit = await ritagliaPagine(buf, s.pagine); if (rit) return { buffer: rit, intero: false }; return { buffer: buf, intero: true }; }
  return { buffer: buf, intero: false };
}

// "Chiedi una correzione" (LAB, scheda in BOZZA, anche dopo Riapri): istruzione → JSON corretto → nuova versione CORREZIONE
export async function chiediCorrezione(id, istruzione, userId) {
  const testo = compattaSpazi(istruzione);
  if (testo.length < 3) throw bad('Scrivi cosa correggere');
  if (testo.length > 2000) throw bad('Istruzione troppo lunga (massimo 2000 caratteri)');
  const s = await one('SELECT id, stato, dati, elaborazione_id, pagine, da_rielaborare FROM schede WHERE id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'BOZZA') throw bad('La scheda non è in bozza: riaprila per correggerla');
  if (s.da_rielaborare || !isSchemaBlocchi(s.dati)) throw bad('Scheda del motore precedente: rielaborala dal PDF prima di chiedere una correzione');
  const pdf = await pdfScheda(s);
  const istr = pdf.intero && (s.pagine || []).length ? `${testo}\n(La scheda riguarda le pagine ${s.pagine.join(', ')} del PDF allegato.)` : testo;
  const out = await correggiScheda({ buffer: pdf.buffer, dati: s.dati, istruzione: istr, rif: `scheda ${id}`, userId });
  const v = await aggiornaDati(id, out.dati, { origine: 'CORREZIONE', istruzione: testo, userId });
  await registra('CORREZIONE_AI', { scheda_id: id, user_id: userId, dettagli: { istruzione: testo.slice(0, 500), versione: v.n, lettura: out.modo, token: out.usage || undefined } });
  return { versione: v.n, modo: out.modo };
}

// "Annulla l'ultima correzione": si toglie l'ultima versione CORREZIONE e si torna ai dati della versione precedente (ripetibile:
// più correzioni di seguito si annullano una alla volta; l'annullamento resta nel registro)
export async function annullaCorrezione(id, userId) {
  const s = await one('SELECT id, stato FROM schede WHERE id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'BOZZA') throw bad('La scheda non è in bozza');
  const [ultima, prec] = await many('SELECT id, n, origine, dati, istruzione FROM scheda_versioni WHERE scheda_id=$1 ORDER BY n DESC LIMIT 2', [id]);
  if (!ultima || ultima.origine !== 'CORREZIONE' || !prec) throw bad('Non c\'è una correzione da annullare (l\'ultima modifica non è una correzione richiesta a Claude)');
  await q('DELETE FROM scheda_versioni WHERE id=$1', [ultima.id]);
  await aggiornaDati(id, prec.dati, { userId, nuovaVersione: false });
  await registra('CORREZIONE_ANNULLATA', { scheda_id: id, user_id: userId, dettagli: { versione_annullata: ultima.n, istruzione: String(ultima.istruzione || '').slice(0, 500) } });
  return { versione: ultima.n, ripristinata: prec.n };
}

// "Rielabora dal PDF": nuova lettura delle pagine della scheda (schede del motore precedente, o rilettura voluta dall'operatore)
export async function rielaboraScheda(id, userId) {
  const s = await one('SELECT s.id, s.stato, s.pagine, s.elaborazione_id, s.cognome_nome, e.data AS e_data, e.blob_path AS e_blob_path FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'BOZZA') throw bad('La scheda non è in bozza: riaprila per rielaborarla');
  const buf = await readBuffer({ data: s.e_data, blob_path: s.e_blob_path });
  if (!buf) throw bad('Il PDF sorgente non è più disponibile (retention): la scheda non si può rielaborare');
  const estratto = await estraiTesto(buf);
  const r = await leggiReferto({ buffer: buf, estratto, rif: `rielaborazione scheda ${id}`, userId });
  if (r.non_referto || !r.schede?.length) throw bad(`La nuova lettura non ha trovato un referto: ${r.motivo || 'nessun paziente'}`);
  const stesse = (x) => (x.pagine || []).some((p) => (s.pagine || []).includes(p));
  const nuova = r.schede.find(stesse) || r.schede.find((x) => compattaSpazi(x.colonne.cognome_nome).toUpperCase() === compattaSpazi(s.cognome_nome).toUpperCase()) || (r.schede.length === 1 ? r.schede[0] : null);
  if (!nuova) throw bad('Nella nuova lettura non si trova il paziente di questa scheda: verifica il PDF');
  await q(`UPDATE schede SET dati_orig=$2, testo_sorgente=$3, antibiotici_sorgente=$4, lettura=$5, pagine=$6, da_rielaborare=FALSE, sorgente=$7 WHERE id=$1`,
    [id, JSON.stringify(nuova.dati), nuova.testo_sorgente || '', nuova.antibiotici_sorgente ?? null, r.modo, nuova.pagine, nuova.dati.sorgente]);
  const v = await aggiornaDati(id, nuova.dati, { origine: 'LETTURA', istruzione: 'Rielaborazione dal PDF', userId });
  await registra('RIELABORATA', { scheda_id: id, user_id: userId, dettagli: { versione: v.n, lettura: r.modo, pagine: nuova.pagine.length, ms: r.ms } });
  return { versione: v.n, lettura: r.modo };
}

// ---- Lettura
export const S_COLS = `s.id, s.elaborazione_id, s.pagine, s.sorgente, s.cognome_nome, s.data_nascita, s.sesso, s.luogo_nascita, s.indirizzo, s.accettazione, s.data_acc, s.referto_codice, s.referto_data,
  s.anomalie, s.stato, s.nome_file, s.sostituisce_id, s.sostituita_da, s.confirmed_by, s.confirmed_at, s.created_at, s.updated_at, s.versione, s.riaperta_at,
  s.lettura, s.da_rielaborare, s.antibiotici_sorgente,
  e.filename AS elaborazione_filename, e.pagine AS elaborazione_pagine, e.ocr, e.origine, e.from_email, e.from_name, e.subject, e.received_at, cu.full_name AS confirmed_by_nome,
  ru.full_name AS riaperta_by_nome`;
export const S_FROM = `schede s JOIN elaborazioni e ON e.id=s.elaborazione_id LEFT JOIN public.users cu ON cu.id=s.confirmed_by LEFT JOIN public.users ru ON ru.id=s.riaperta_by`;

export async function loadScheda(id, { conDati = true } = {}) {
  const s = await one(`SELECT ${S_COLS}${conDati ? ', s.dati, s.dati_orig' : ''} FROM ${S_FROM} WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Scheda non trovata');
  s.file = await many(`SELECT id, kind, filename, mime, size, sha256, intero, created_at FROM file_prodotti WHERE scheda_id=$1 ORDER BY CASE kind WHEN 'SORGENTE_PDF' THEN 0 WHEN 'DOCX' THEN 1 ELSE 2 END`, [id]);
  s.versioni = await versioni(id);
  s.invii = await many(`SELECT i.id, i.to_email, i.from_email, i.stato, i.errore, i.file_sha256, i.versione, i.automatico, i.at, u.full_name AS user_nome FROM invii i LEFT JOIN public.users u ON u.id=i.user_id WHERE i.scheda_id=$1 ORDER BY i.at DESC, i.id DESC`, [id]);
  return s;
}

export async function elaborazioneCon(id) {
  const e = await one(`SELECT e.id, e.filename, e.size, e.pagine, e.sorgente, e.stato, e.motivo_scarto, e.ocr, e.uploaded_by, e.created_at, e.origine, e.from_email, e.from_name, e.subject, e.received_at, u.full_name AS uploaded_by_nome FROM elaborazioni e LEFT JOIN public.users u ON u.id=e.uploaded_by WHERE e.id=$1`, [id]);
  if (!e) throw notFound('Elaborazione non trovata');
  e.schede = await many(`SELECT ${S_COLS} FROM ${S_FROM} WHERE s.elaborazione_id=$1 ORDER BY s.id`, [id]);
  return e;
}

// ---- Generazione (anteprima e conferma)
// Scheda del motore precedente (JSON senza blocchi): non si genera, va riletta dal PDF
export const daRielaborare = (scheda) => Boolean(scheda.da_rielaborare || !isSchemaBlocchi(scheda.dati));
export async function generaPer(scheda, imp) {
  if (daRielaborare(scheda)) throw bad('Scheda del motore precedente: usa "Rielabora dal PDF" per rileggerla con il nuovo motore');
  const tpl = await templateAttivo();
  // le note sui laboratori esecutori e i rimandi "(1)"/"(RDI)" non entrano mai nel referto TD (anche dopo modifiche manuali)
  const docx = await generaDocx(senzaRimandiLaboratorio(scheda.dati), { template: tpl ? Buffer.from(tpl.data) : null });
  const coerenza = coerenzaDi(scheda, docx);
  const pdf = imp.genera_pdf === false ? null : await generaPdf(docx);
  return { docx, pdf, coerenza, template: tpl ? tpl.filename : TEMPLATE_DEFAULT_NOME };
}
export const coerenzaDi = (scheda, docx) => controllaCoerenza({ dati: scheda.dati, testoSorgente: scheda.testo_sorgente, testoDocx: testoDocx(docx), antibioticiSorgente: scheda.antibiotici_sorgente });

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Conferma: controllo di coerenza (salvo force), file definitivi, nome con suffisso o sostituzione tracciata, registro.
// automatica: conferma della casella template@ (coerenza verde e nessuna anomalia, mai forzata): confirmed_by NULL, registro
// CONFERMATA_AUTO. Riconferma dopo "Riapri": i file DOCX/PDF/sorgente della stessa scheda si rigenerano e sostituiscono i precedenti
// (versione + 1, blob vecchi eliminati); la catena sostituisce_id/sostituita_da verso un'altra scheda resta quella della prima conferma.
export async function confermaScheda(id, userId, { force = false, automatica = false } = {}) {
  const s = await one(`SELECT s.*, e.data AS e_data, e.blob_path AS e_blob_path, e.pagine AS e_pagine, e.filename AS e_filename, e.size AS e_size FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1`, [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'BOZZA') throw bad('La scheda non è in bozza');
  if (automatica && (force || (s.anomalie || []).length)) throw bad('Conferma automatica non ammessa: la scheda ha anomalie');
  const imp = await settings();
  const gen = await generaPer(s, imp);
  if (!gen.coerenza.ok && !force) throw new HttpError(400, 'Il controllo di coerenza non è superato: correggi la scheda oppure conferma comunque', { coerenza: gen.coerenza });
  const riconferma = Boolean(s.riaperta_at);
  const versione = riconferma ? Number(s.versione || 1) + 1 : Number(s.versione || 1);
  const vecchi = riconferma ? await many('SELECT blob_path FROM file_prodotti WHERE scheda_id=$1 AND blob_path IS NOT NULL', [id]) : [];
  let { nome, doppio, sostituisce } = await risolviNomeFile(s, s.dati, imp);
  if (riconferma && s.sostituisce_id && !doppio) { doppio = s.sostituisce_id; sostituisce = true; }   // catena della prima conferma conservata
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
    await c.query(`UPDATE schede SET stato='CONFERMATA', nome_file=$2, sostituisce_id=$3, confirmed_by=$4, confirmed_at=now(), updated_at=now(), versione=$5, riaperta_at=NULL, riaperta_by=NULL WHERE id=$1`, [id, nome, sostituisce ? doppio : null, automatica ? null : userId, versione]);
    if (sostituisce && doppio && !(riconferma && s.sostituisce_id === doppio)) {
      await c.query(`UPDATE schede SET sostituita_da=$2, updated_at=now() WHERE id=$1`, [doppio, id]);
      await registra('SOSTITUZIONE', { scheda_id: id, user_id: automatica ? null : userId, dettagli: { sostituisce_scheda_id: doppio, nome_file: nome } }, c);
    }
    await registra(automatica ? 'CONFERMATA_AUTO' : 'CONFERMATA', { scheda_id: id, user_id: automatica ? null : userId, dettagli: { nome_file: nome, forzata: !gen.coerenza.ok, coerenza_ok: gen.coerenza.ok, anomalie: (s.anomalie || []).length, pdf: Boolean(filePdf), suffisso: doppio && !sostituisce ? true : false, pdf_sorgente_intero: !sorgente && serveRitaglio, template: gen.template, versione, riconferma: riconferma || undefined, automatica: automatica || undefined } }, c);
    return { id, nome_file: nome, forzata: !gen.coerenza.ok, coerenza: gen.coerenza, sostituisce: sostituisce ? doppio : null, suffisso: Boolean(doppio && !sostituisce), pdf_sorgente_intero: !sorgente && serveRitaglio, versione, riconferma, pdf_sha256: filePdf?.sha256 || null };
  });
  // file della versione precedente (blob): eliminati dopo la sostituzione
  if (vecchi.length) await dropBlobs(vecchi.map((f) => f.blob_path));
  return risultato;
}

// ---- Riapertura di un referto emesso (richiesta del CEO del 31/10/2026: "permetti sempre di riaprire il referto emesso e di
// modificarlo"): la scheda CONFERMATA (anche già inviata) torna BOZZA, i file prodotti restano scaricabili finché non si riconferma
export async function riapriScheda(id, userId) {
  const s = await one('SELECT id, stato, nome_file, versione, dati FROM schede WHERE id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato !== 'CONFERMATA') throw bad('Si può riaprire solo un referto confermato');
  const vecchioMotore = !isSchemaBlocchi(s.dati);   // referto emesso con il motore precedente: si rilegge dal PDF
  const inviato = await one(`SELECT count(*)::int AS n FROM invii WHERE scheda_id=$1 AND stato IN ('INVIATO','REGISTRATO')`, [id]);
  await tx(async (c) => {
    await c.query(`UPDATE schede SET stato='BOZZA', riaperta_at=now(), riaperta_by=$2, updated_at=now(), da_rielaborare=$3 WHERE id=$1`, [id, userId, vecchioMotore]);
    await registra('RIAPERTA', { scheda_id: id, user_id: userId, dettagli: { nome_file: s.nome_file, versione: s.versione, inviato: inviato.n > 0, da_rielaborare: vecchioMotore || undefined } }, c);
  });
  return { id, versione: s.versione, inviato: inviato.n > 0, da_rielaborare: vecchioMotore };
}

// ---- Eliminazione (richiesta del CEO: "permettimi di cancellare i file da elaborazioni recenti")
// Elaborazione con schede e file prodotti (anche i blob). Con schede confermate serve force: altrimenti 409 con il conteggio.
// Nel registro del modulo resta un'azione ELABORAZIONE_ELIMINATA (filename, schede, file; i nomi dei pazienti possono restare nel
// registro interno, mai nei log della Suite).
export async function eliminaElaborazione(id, userId, { force = false } = {}) {
  const e = await one('SELECT id, filename, blob_path, pagine, sorgente, stato FROM elaborazioni WHERE id=$1', [id]);
  if (!e) throw notFound('Elaborazione non trovata');
  const schede = await many('SELECT id, cognome_nome, stato, nome_file FROM schede WHERE elaborazione_id=$1 ORDER BY id', [id]);
  const confermate = schede.filter((s) => s.stato === 'CONFERMATA');
  if (confermate.length && !force) throw new HttpError(409, `Ci sono ${confermate.length} ${confermate.length === 1 ? 'referto confermato' : 'referti confermati'}: verranno rimossi dall'archivio. Conferma l'eliminazione per procedere`, { confermate: confermate.length, code: 'CONFERMATE' });
  const file = await many('SELECT id, blob_path FROM file_prodotti WHERE scheda_id = ANY($1::int[]) OR elaborazione_id=$2', [schede.map((s) => s.id), id]);
  await tx(async (c) => {
    await registra('ELABORAZIONE_ELIMINATA', { elaborazione_id: id, user_id: userId, dettagli: { filename: e.filename, pagine: e.pagine, sorgente: e.sorgente, schede: schede.length, confermate: confermate.length, file: file.length, forzata: Boolean(confermate.length), pazienti: schede.map((s) => s.cognome_nome).filter(Boolean) } }, c);
    await c.query('DELETE FROM elaborazioni WHERE id=$1', [id]);   // schede e file_prodotti in cascata
  });
  await dropBlobs([e.blob_path, ...file.map((f) => f.blob_path)]);
  return { id, filename: e.filename, schede: schede.length, confermate: confermate.length, file: file.length };
}

// Singola scheda (dall'Archivio): con stato CONFERMATA serve force. L'elaborazione resta (il PDF di partenza può avere altre schede).
export async function eliminaScheda(id, userId, { force = false } = {}) {
  const s = await one('SELECT s.id, s.cognome_nome, s.stato, s.nome_file, s.elaborazione_id, e.filename FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id WHERE s.id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  if (s.stato === 'CONFERMATA' && !force) throw new HttpError(409, 'Il referto è confermato: verrà rimosso dall\'archivio. Conferma l\'eliminazione per procedere', { confermate: 1, code: 'CONFERMATE' });
  const file = await many('SELECT id, blob_path FROM file_prodotti WHERE scheda_id=$1', [id]);
  await tx(async (c) => {
    await registra('SCHEDA_ELIMINATA', { elaborazione_id: s.elaborazione_id, user_id: userId, dettagli: { filename: s.filename, nome_file: s.nome_file, paziente: s.cognome_nome, stato: s.stato, file: file.length, forzata: s.stato === 'CONFERMATA' } }, c);
    await c.query('UPDATE schede SET sostituita_da=NULL WHERE sostituita_da=$1', [id]);
    await c.query('DELETE FROM schede WHERE id=$1', [id]);
  });
  await dropBlobs(file.map((f) => f.blob_path));
  return { id, stato: s.stato, file: file.length };
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
