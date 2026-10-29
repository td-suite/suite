// Schede: dettaglio (dati, anomalie, file), correzioni (PATCH), anteprima DOCX+PDF temporanea, conferma (controllo di coerenza),
// scarto; download dei file prodotti e del PDF sorgente.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, audit, bad, notFound, parse, HttpError } from '../../../lib/util.js';
import { requireLab } from '../lib/access.js';
import { KEY, idOf, loadScheda, settings, generaPer, confermaScheda, registra, nomeBase } from '../lib/core.js';
import { controllaCoerenza } from '../lib/coerenza.js';
import { sendFile } from '../lib/storage.js';
import { generaDocx, testoDocx } from '../lib/docgen.js';
import { nomeFileSicuro } from '../lib/text.js';

const r = Router();

const str = z.string().max(2000).optional().nullable().transform((v) => (v == null ? '' : String(v)));
const rigaSchema = z.object({ tipo: z.enum(['esame', 'antibiotico', 'legenda', 'testo']), nome: str, risultato: str, unita: str, riferimento: str, esito: str, mic: str, testo: str, descrizione: str, sotto: z.array(z.string().max(500)).optional(), ricomposto: z.boolean().optional() }).passthrough();
const datiSchema = z.object({
  sorgente: z.string().max(40).optional(),
  variante: z.enum(['A', 'B']).optional(),
  corpo: z.coerce.number().int().min(1).max(2).optional(),
  anagrafica: z.object({ cognome_nome: str, data_nascita: str, sesso: str, luogo_nascita: str, indirizzo: str, eta: z.union([z.number(), z.string(), z.null()]).optional(), accettazione_n: str, data_acc: str, referto_codice: str, referto_data: str, accettazione_codice: str, accettazione_data: str, variante: z.string().optional() }).passthrough(),
  settori: z.array(z.object({ titolo: str, righe: z.array(rigaSchema).default([]) }).passthrough()).default([]),
  esami: z.array(z.object({ settore: z.coerce.number().int().min(0).default(0), titolo: str, metodo: str, materiale: str, sede: str, nota: str, campi: z.array(z.object({ etichetta: str, valore: str, unita: str, libero: z.boolean().optional() }).passthrough()).default([]) }).passthrough()).default([]),
  antibiogrammi: z.array(z.object({ esame: z.coerce.number().int().min(0).default(0), n: z.coerce.number().int().min(1).default(1), specie: str, carica: str, carica_label: str, legenda: str, righe: z.array(z.object({ antibiotico: str, sir: str, mic: str }).passthrough()).default([]) }).passthrough()).default([]),
  note: z.array(z.string().max(1000)).default([]),
  conteggi: z.object({ antibiotici_sorgente: z.number().optional() }).passthrough().optional(),
}).passthrough();

const inBozza = (s) => { if (s.stato !== 'BOZZA') throw bad('La scheda non è più in bozza'); };

r.get('/schede/:id', ah(async (req, res) => {
  const s = await loadScheda(idOf(req.params.id, 'Scheda non trovata'));
  res.json(s);
}));

// Correzioni del JSON intermedio e del nome file (profilo LAB). Le colonne di ricerca si riallineano all'anagrafica.
r.patch('/schede/:id', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const cur = await one('SELECT * FROM schede WHERE id=$1', [id]);
  if (!cur) throw notFound('Scheda non trovata');
  inBozza(cur);
  const b = parse(z.object({ dati: datiSchema.optional(), nome_file: z.string().trim().max(150).optional() }), req.body || {});
  const dati = b.dati ? { ...cur.dati, ...b.dati, sorgente: cur.dati.sorgente || cur.sorgente, conteggi: cur.dati.conteggi } : cur.dati;
  const a = dati.anagrafica || {};
  let nome = b.nome_file != null ? nomeFileSicuro(b.nome_file.replace(/\.(docx|pdf)$/i, '')) : cur.nome_file;
  if (!nome) nome = nomeBase(a.cognome_nome);
  if (b.dati && b.nome_file == null && cur.nome_file === nomeBase(cur.cognome_nome)) nome = nomeBase(a.cognome_nome);   // nome non personalizzato: segue il paziente
  await q(`UPDATE schede SET dati=$2, cognome_nome=$3, data_nascita=$4, sesso=$5, luogo_nascita=$6, indirizzo=$7, accettazione=$8, data_acc=$9, referto_codice=$10, referto_data=$11, nome_file=$12, updated_at=now() WHERE id=$1`,
    [id, JSON.stringify(dati), a.cognome_nome || '', a.data_nascita || null, a.sesso || null, a.luogo_nascita || null, a.indirizzo || null, a.accettazione_n || a.accettazione_codice || null, a.data_acc || a.accettazione_data || null, a.referto_codice || null, a.referto_data || null, nome]);
  await registra('MODIFICATA', { scheda_id: id, user_id: req.user.id, dettagli: { campi: Object.keys(b), nome_file: nome !== cur.nome_file ? nome : undefined } });
  res.json(await loadScheda(id));
}));

// Anteprima: DOCX e PDF temporanei (base64) + checklist di coerenza, senza confermare
r.post('/schede/:id/anteprima', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const s = await one('SELECT * FROM schede WHERE id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  const imp = await settings();
  const gen = await generaPer(s, { ...imp, genera_pdf: true });
  res.json({ coerenza: gen.coerenza, template: gen.template, pdf: gen.pdf ? gen.pdf.toString('base64') : null, docx: gen.docx.toString('base64'), nome_file: s.nome_file });
}));

// Solo la checklist di coerenza (senza PDF)
r.get('/schede/:id/coerenza', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const s = await one('SELECT * FROM schede WHERE id=$1', [id]);
  if (!s) throw notFound('Scheda non trovata');
  const docx = await generaDocx(s.dati);
  res.json(controllaCoerenza({ datiOrig: s.dati_orig, dati: s.dati, testoSorgente: s.testo_sorgente, testoDocx: testoDocx(docx) }));
}));

r.post('/schede/:id/conferma', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const force = Boolean(req.body?.force);
  try {
    const out = await confermaScheda(id, req.user.id, { force });
    await audit(req, 'REFERTI_CONFERMA', { module: KEY, entity: 'scheda', entityId: id, data: { forzata: out.forzata, suffisso: out.suffisso, sostituisce: out.sostituisce } });
    res.json({ ...out, scheda: await loadScheda(id) });
  } catch (e) {
    if (e instanceof HttpError && e.status === 400 && e.details?.coerenza) return res.status(400).json({ error: e.message, code: 'COERENZA', coerenza: e.details.coerenza });
    throw e;
  }
}));

r.post('/schede/:id/scarta', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const cur = await one('SELECT id, stato FROM schede WHERE id=$1', [id]);
  if (!cur) throw notFound('Scheda non trovata');
  inBozza(cur);
  const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
  await q(`UPDATE schede SET stato='SCARTATA', updated_at=now() WHERE id=$1`, [id]);
  await registra('SCARTATA', { scheda_id: id, user_id: req.user.id, dettagli: { motivo } });
  await audit(req, 'REFERTI_SCARTO', { module: KEY, entity: 'scheda', entityId: id });
  res.json(await loadScheda(id));
}));

// PDF sorgente di un'elaborazione (anteprima affiancata: iframe con #page=N)
r.get('/elaborazioni/:id/pdf', ah(async (req, res) => {
  const id = idOf(req.params.id, 'Elaborazione non trovata');
  const e = await one('SELECT id, filename, mime, data, blob_path FROM elaborazioni WHERE id=$1', [id]);
  if (!e) throw notFound('Elaborazione non trovata');
  if (!e.data && !e.blob_path) throw notFound('Il PDF sorgente non è più disponibile (retention)');
  await sendFile(res, { ...e, filename: e.filename }, { inline: req.query.inline === '1' });
}));

// File prodotti (SORGENTE_PDF, DOCX, PDF). Il PDF sorgente senza contenuto proprio rimanda al PDF intero dell'elaborazione.
r.get('/file/:id', ah(async (req, res) => {
  const id = idOf(req.params.id, 'File non trovato');
  const f = await one('SELECT * FROM file_prodotti WHERE id=$1', [id]);
  if (!f) throw notFound('File non trovato');
  const inline = req.query.inline === '1';
  if (!f.data && !f.blob_path && f.elaborazione_id) {
    const e = await one('SELECT filename, mime, data, blob_path FROM elaborazioni WHERE id=$1', [f.elaborazione_id]);
    if (!e || (!e.data && !e.blob_path)) throw notFound('Il PDF sorgente non è più disponibile (retention)');
    if (f.intero) res.setHeader('X-Referti-Pdf-Intero', '1');
    return sendFile(res, { ...e, filename: f.filename }, { inline });
  }
  if (!f.data && !f.blob_path) throw notFound('Contenuto non disponibile');
  await sendFile(res, f, { inline });
}));

export default r;
