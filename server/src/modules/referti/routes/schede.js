// Schede: dettaglio (dati a blocchi, anomalie, file, versioni), correzioni manuali (PATCH, versione MANUALE), "Chiedi una correzione"
// a Claude (versione CORREZIONE) e "Annulla l'ultima correzione", "Rielabora dal PDF", anteprima DOCX+PDF temporanea, conferma
// (controllo di coerenza), scarto, riapertura, invio al mittente; download dei file prodotti e del PDF sorgente.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, audit, bad, notFound, parse, HttpError } from '../../../lib/util.js';
import { requireLab } from '../lib/access.js';
import { KEY, idOf, loadScheda, settings, generaPer, confermaScheda, eliminaScheda, registra, riapriScheda, aggiornaDati, chiediCorrezione, annullaCorrezione, rielaboraScheda, daRielaborare } from '../lib/core.js';
import { dopoConferma, inviaAlMittente } from '../lib/casella.js';
import { sendFile } from '../lib/storage.js';
import { datiSchema } from '../lib/blocchi.js';

const r = Router();

const inBozza = (s) => { if (s.stato !== 'BOZZA') throw bad('La scheda non è più in bozza'); };

r.get('/schede/:id', ah(async (req, res) => {
  const s = await loadScheda(idOf(req.params.id, 'Scheda non trovata'));
  res.json(s);
}));

// Correzioni manuali del JSON a blocchi e del nome file (profilo LAB): nuova versione MANUALE, colonne di ricerca e anomalie riallineate
r.patch('/schede/:id', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const cur = await one('SELECT id, stato, dati, da_rielaborare, nome_file FROM schede WHERE id=$1', [id]);
  if (!cur) throw notFound('Scheda non trovata');
  inBozza(cur);
  const b = parse(z.object({ dati: datiSchema.optional(), nome_file: z.string().trim().max(150).optional() }), req.body || {});
  if (b.dati && daRielaborare(cur)) throw bad('Scheda del motore precedente: usa "Rielabora dal PDF" prima di modificarla');
  const out = b.dati || b.nome_file != null ? await aggiornaDati(id, b.dati || cur.dati, { origine: 'MANUALE', userId: req.user.id, nomeFile: b.nome_file }) : null;
  await registra('MODIFICATA', { scheda_id: id, user_id: req.user.id, dettagli: { campi: Object.keys(b), versione: out?.n, nome_file: out && out.nome_file !== cur.nome_file ? out.nome_file : undefined } });
  res.json(await loadScheda(id));
}));

// Anteprima per la risposta di correzione/annullamento (stesso formato di POST /anteprima)
async function anteprimaDi(id) {
  const s = await one('SELECT * FROM schede WHERE id=$1', [id]);
  const imp = await settings();
  const gen = await generaPer(s, { ...imp, genera_pdf: true });
  return { coerenza: gen.coerenza, template: gen.template, pdf: gen.pdf ? gen.pdf.toString('base64') : null, docx: gen.docx.toString('base64'), nome_file: s.nome_file };
}

// "Chiedi una correzione" (LAB, scheda in BOZZA, anche dopo Riapri): Claude riceve PDF, JSON corrente e istruzione e restituisce il
// JSON corretto; si salva come nuova versione e si rigenerano anteprima e controllo di coerenza
r.post('/schede/:id/correzione', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const b = parse(z.object({ istruzione: z.string().trim().min(3, 'Scrivi cosa correggere').max(2000) }), req.body || {});
  const out = await chiediCorrezione(id, b.istruzione, req.user.id);
  await audit(req, 'REFERTI_CORREZIONE_AI', { module: KEY, entity: 'scheda', entityId: id, data: { versione: out.versione, lettura: out.modo } });   // senza l'istruzione né dati del paziente
  res.json({ ...out, anteprima: await anteprimaDi(id), scheda: await loadScheda(id) });
}));

r.post('/schede/:id/annulla-correzione', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const out = await annullaCorrezione(id, req.user.id);
  await audit(req, 'REFERTI_CORREZIONE_ANNULLATA', { module: KEY, entity: 'scheda', entityId: id, data: out });
  res.json({ ...out, anteprima: await anteprimaDi(id), scheda: await loadScheda(id) });
}));

// "Rielabora dal PDF": nuova lettura (schede del motore precedente o rilettura voluta); nuova versione LETTURA
r.post('/schede/:id/rielabora', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const out = await rielaboraScheda(id, req.user.id);
  await audit(req, 'REFERTI_RIELABORA', { module: KEY, entity: 'scheda', entityId: id, data: out });
  res.json({ ...out, scheda: await loadScheda(id) });
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
  const gen = await generaPer(s, { genera_pdf: false });
  res.json(gen.coerenza);
}));

r.post('/schede/:id/conferma', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const force = Boolean(req.body?.force);
  try {
    const out = await confermaScheda(id, req.user.id, { force });
    // scheda arrivata dalla casella: il PDF parte al mittente alla prima conferma (se "Invia al mittente" è acceso)
    const invio = await dopoConferma(id, req.user.id);
    await audit(req, 'REFERTI_CONFERMA', { module: KEY, entity: 'scheda', entityId: id, data: { forzata: out.forzata, suffisso: out.suffisso, sostituisce: out.sostituisce, versione: out.versione, invio: invio?.stato || null } });
    res.json({ ...out, invio, scheda: await loadScheda(id) });
  } catch (e) {
    if (e instanceof HttpError && e.status === 400 && e.details?.coerenza) return res.status(400).json({ error: e.message, code: 'COERENZA', coerenza: e.details.coerenza });
    throw e;
  }
}));

r.post('/schede/:id/scarta', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const cur = await one('SELECT id, stato, riaperta_at FROM schede WHERE id=$1', [id]);
  if (!cur) throw notFound('Scheda non trovata');
  inBozza(cur);
  if (cur.riaperta_at) throw bad('Il referto è stato emesso e riaperto: riconfermalo, oppure eliminalo dall\'Archivio');
  const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
  await q(`UPDATE schede SET stato='SCARTATA', updated_at=now() WHERE id=$1`, [id]);
  await registra('SCARTATA', { scheda_id: id, user_id: req.user.id, dettagli: { motivo } });
  await audit(req, 'REFERTI_SCARTO', { module: KEY, entity: 'scheda', entityId: id });
  res.json(await loadScheda(id));
}));

// Riapertura di un referto emesso (anche già inviato): torna BOZZA, i file prodotti restano finché non si riconferma
r.post('/schede/:id/riapri', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const out = await riapriScheda(id, req.user.id);
  await audit(req, 'REFERTI_RIAPRI', { module: KEY, entity: 'scheda', entityId: id, data: { versione: out.versione, inviato: out.inviato } });
  res.json({ ...out, scheda: await loadScheda(id) });
}));

// Invio manuale al mittente della mail ("Invia al mittente"; con { reinvia: true } è "Reinvia", azione esplicita)
r.post('/schede/:id/invia', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  const reinvia = Boolean(req.body?.reinvia);
  const out = await inviaAlMittente(id, { userId: req.user.id, esplicito: reinvia });
  if (!out.stato) throw bad(`Invio non eseguito: ${out.motivo}`);
  await audit(req, 'REFERTI_INVIO', { module: KEY, entity: 'scheda', entityId: id, data: { stato: out.stato, reinvio: reinvia } });   // solo id ed esito
  res.json({ ...out, scheda: await loadScheda(id) });
}));

// Eliminazione di una scheda con i suoi file (Archivio; LAB o admin). Se confermata serve { force: true }: altrimenti 409.
r.delete('/schede/:id', requireLab, ah(async (req, res) => {
  const id = idOf(req.params.id, 'Scheda non trovata');
  try {
    const out = await eliminaScheda(id, req.user.id, { force: Boolean(req.body?.force) });
    await audit(req, 'REFERTI_ELIMINA_SCHEDA', { module: KEY, entity: 'scheda', entityId: id, data: { stato: out.stato, file: out.file } });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return res.status(409).json({ error: e.message, code: 'CONFERMATE', confermate: 1, details: { confermate: 1 } });
    throw e;
  }
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
