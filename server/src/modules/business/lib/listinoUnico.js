// Business Hub · listino unico tra la scheda Contratto e la scheda Listino e offerta (richiesta del CEO del 07/11/2026: "che sia alla
// scheda del contratto o qui l'upload del file XLSX deve essere lo stesso file. questa scheda [Listino StudioLAB del cliente] è
// perfetta e va tenuta"). Una sola sorgente: le versioni del listino dell'account (tabella listini).
// - Ogni nuova versione (Excel caricato dalla scheda Listino, dal riquadro "Listino dell'offerta" del contratto, importato dal contratto o
//   revisione dei prezzi in pagina) registra il suo XLSX come LISTINO_XLSX del contratto Service della linea, con listino_id; la copia
//   collegata alla versione precedente si toglie dal contratto (l'originale resta nei documenti e nello storico dell'account).
// - L'offerta economica PDF generata dalla versione corrente diventa il LISTINO_PDF del contratto (stessa sostituzione).
// - I file storici (senza listino_id) restano come sono; se si importano nell'account vengono collegati alla versione creata, senza copia.
// - Contratti senza account (MDL, SEDE, PP senza punto): nessun collegamento, comportamento di prima.
// Così la lettera MOD230 (Allegato 1, prezzi) e il riquadro del contratto vedono sempre il listino corrente.
import ExcelJS from 'exceljs';
import { one, many, q } from '../db.js';
import { storeBuffer, readBuffer, dropBlobs } from './storage.js';
import { versioneCorrente } from './listino.js';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Il contratto ha il listino dell'account? Solo i contratti Service con un account nel Business Hub. Pura. */
export const conListinoAccount = (c) => Boolean(c && c.kind === 'SRV' && c.account_id);

/**
 * Piano del collegamento di un file di una versione al contratto. Pura, testata.
 * files: contract_files del contratto [{ id, category, listino_id }]; categoria: LISTINO_XLSX | LISTINO_PDF; listinoId: versione;
 * esistenteId: file storico del contratto da collegare senza copia (importazione dal contratto).
 * Ritorna { gia: bool (la versione ha già il suo file), collega: id|null, inserisci: bool, rimuovi: [id] (copie di altre versioni) }.
 */
export function pianoCollegamento({ files = [], categoria, listinoId, esistenteId = null }) {
  const stessi = files.filter((f) => f.category === categoria);
  const rimuovi = stessi.filter((f) => f.listino_id != null && Number(f.listino_id) !== Number(listinoId)).map((f) => f.id);
  const gia = stessi.some((f) => Number(f.listino_id) === Number(listinoId));
  if (gia) return { gia: true, collega: null, inserisci: false, rimuovi };
  const es = esistenteId != null ? stessi.find((f) => Number(f.id) === Number(esistenteId) && f.listino_id == null) : null;
  return { gia: false, collega: es ? es.id : null, inserisci: !es, rimuovi };
}

/** Riquadro "Listino dell'offerta" del contratto: versione corrente dell'account { id, versione, data, esami, offerta } e prossima. Pura. */
export function riquadroListino(versioni = [], sceltaId = null) {
  const c = versioneCorrente(versioni, sceltaId);
  const max = versioni.reduce((m, v) => Math.max(m, Number(v.versione) || 0), 0);
  return { corrente: c ? { id: c.id, versione: c.versione, data: c.caricato_at || null, esami: c.riepilogo?.esami ?? null, origine: c.origine || 'EXCEL', offerta_documento_id: c.offerta_documento_id || null } : null, prossima: max + 1, versioni: versioni.length };
}

/** XLSX di una versione nata da una revisione in pagina (nessun file di StudioLAB): stesse colonne riconosciute dall'importatore. */
export async function xlsxDaRighe(righe = [], { titolo = 'Listino' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD · Business Hub';
  const ws = wb.addWorksheet(String(titolo).slice(0, 31));
  ws.addRow(['Codice', 'Descrizione', 'Settore', 'Prezzo di listino', 'Prezzo offerto', 'Sconto %']);
  for (const x of righe) ws.addRow([x.codice || '', x.descrizione || '', x.settore || '', Number(x.listino) || 0, Number(x.offerto) || 0, x.sconto != null ? Number(x.sconto) : null]);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = [12, 48, 22, 16, 16, 10][i]; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Contratto Service della linea dell'account (lo stesso del pacchetto e del kit: il più recente non annullato né cessato), o null. */
export async function contrattoDellAccount(a) {
  if (a.linea !== 'SRV') return null;
  return one(`SELECT id, protocol, version, data FROM contracts WHERE org_id=$1 AND kind='SRV' AND status NOT IN ('ANNULLATO','CESSATO')
    ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`, [a.organization_id]);
}

async function evento(contractId, userId, note, data) {
  await q('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [contractId, 'ALLEGATO', userId || null, note, data ? JSON.stringify(data) : null]);
}
async function aggiornaNomi(contractId) {
  const names = (await many(`SELECT filename FROM contract_files WHERE contract_id=$1 AND category IN ('LISTINO_XLSX','LISTINO_PDF') ORDER BY created_at`, [contractId])).map((f) => f.filename).join(', ');
  await q(`UPDATE contracts SET data = data || jsonb_build_object('price_list_file', $2::text), updated_at=now() WHERE id=$1`, [contractId, names]);
}

/**
 * Registra nel contratto della linea un file della versione `listino` (categoria LISTINO_XLSX o LISTINO_PDF): copia collegata con
 * listino_id, oppure collegamento del file storico esistenteId; toglie le copie collegate alle altre versioni. Idempotente.
 * file: { buffer, filename, mime } o una funzione asincrona che lo produce (si chiama solo se serve). Ritorna l'esito o null.
 */
export async function registraNelContratto(a, listino, categoria, file, { userId = null, esistenteId = null, contratto = null } = {}) {
  const c = contratto || await contrattoDellAccount(a);
  if (!c) return null;
  const files = await many('SELECT id, category, listino_id, filename, blob_path FROM contract_files WHERE contract_id=$1', [c.id]);
  const piano = pianoCollegamento({ files, categoria, listinoId: listino.id, esistenteId });
  const tolti = files.filter((f) => piano.rimuovi.includes(f.id));
  if (tolti.length) {
    await q('DELETE FROM contract_files WHERE id = ANY($1::int[])', [piano.rimuovi]);
    await dropBlobs(tolti.map((f) => f.blob_path));
  }
  let nome = null;
  if (piano.collega) {
    await q('UPDATE contract_files SET listino_id=$2 WHERE id=$1', [piano.collega, listino.id]);
    nome = files.find((f) => f.id === piano.collega)?.filename;
  } else if (piano.inserisci) {
    const f = typeof file === 'function' ? await file() : file;
    if (!f?.buffer) return { contratto: c, gia: false, saltato: 'file non disponibile' };
    const st = await storeBuffer('contratti', f.filename, f.mime, f.buffer);
    await q(`INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, blob_path, version, uploaded_by, listino_id, label)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [c.id, categoria, f.filename, f.mime, st.size, st.sha256, st.data, st.blob_path, c.version, userId, listino.id, `${categoria === 'LISTINO_XLSX' ? 'Listino' : 'Offerta economica'} v${listino.versione} dell'account`]);
    nome = f.filename;
  }
  if (piano.collega || piano.inserisci || tolti.length) {
    const cosa = categoria === 'LISTINO_XLSX' ? 'Listino (XLSX)' : 'Offerta economica (PDF)';
    await evento(c.id, userId, `${cosa} v${listino.versione} dall'account${nome ? `: ${nome}` : ''}${tolti.length ? `; tolto dal contratto ${tolti.map((f) => f.filename).join(', ')} (resta nello storico dell'account)` : ''}`,
      { listino_id: listino.id, versione: listino.versione, categoria, tolti: tolti.map((f) => f.id) });
    await aggiornaNomi(c.id);
  }
  return { contratto: c, gia: piano.gia, collegato: piano.collega, inserito: piano.inserisci && !piano.gia, tolti: tolti.length };
}

/** XLSX della versione: l'Excel caricato (documenti) o, per una revisione, quello ricostruito dalle righe. */
async function fileXlsx(l) {
  if (l.documento_id) {
    const d = await one('SELECT filename, mime, data, blob_path FROM documenti WHERE id=$1', [l.documento_id]);
    const buffer = d ? await readBuffer(d) : null;
    if (buffer) return { buffer, filename: d.filename, mime: d.mime || MIME_XLSX };
  }
  return { buffer: await xlsxDaRighe(l.righe || [], { titolo: `Listino v${l.versione}` }), filename: `Listino_v${l.versione}_revisione.xlsx`, mime: MIME_XLSX };
}

/** Nuova versione del listino → XLSX nel contratto della linea. esistenteId = file storico del contratto da cui è stata importata. */
export async function collegaVersione(a, listinoId, { userId = null, esistenteId = null } = {}) {
  if (a.linea !== 'SRV') return null;
  const l = await one('SELECT id, versione, documento_id, righe FROM listini WHERE id=$1 AND account_id=$2', [listinoId, a.id]);
  if (!l) return null;
  return registraNelContratto(a, l, 'LISTINO_XLSX', () => fileXlsx(l), { userId, esistenteId });
}

/** Offerta economica PDF generata da una versione → LISTINO_PDF del contratto, solo se la versione è la corrente. */
export async function collegaOfferta(a, listinoId, documentoId, { userId = null } = {}) {
  if (a.linea !== 'SRV') return null;
  const v = await many('SELECT id, versione FROM listini WHERE account_id=$1', [a.id]);
  const acc = await one('SELECT listino_corrente_id FROM accounts WHERE id=$1', [a.id]);
  const cor = versioneCorrente(v, acc?.listino_corrente_id);
  if (!cor || Number(cor.id) !== Number(listinoId)) return null;
  const d = await one('SELECT filename, mime, data, blob_path FROM documenti WHERE id=$1', [documentoId]);
  if (!d) return null;
  const l = { id: cor.id, versione: cor.versione };
  // l'offerta rigenerata della stessa versione sostituisce quella già nel contratto
  const c = await contrattoDellAccount(a);
  if (!c) return null;
  const vecchie = await many(`SELECT id, blob_path FROM contract_files WHERE contract_id=$1 AND category='LISTINO_PDF' AND listino_id=$2`, [c.id, l.id]);
  if (vecchie.length) { await q('DELETE FROM contract_files WHERE id = ANY($1::int[])', [vecchie.map((x) => x.id)]); await dropBlobs(vecchie.map((x) => x.blob_path)); }
  return registraNelContratto(a, l, 'LISTINO_PDF', async () => ({ buffer: await readBuffer(d), filename: d.filename, mime: d.mime || 'application/pdf' }), { userId, contratto: c });
}

/**
 * Importazione automatica alla prima apertura dell'account: SRV senza alcuna versione del listino e con un Excel storico nel contratto
 * della linea (LISTINO_XLSX senza listino_id). salva(buffer, filename, note, esistenteId) crea la versione (routes/listino.js).
 * Ritorna l'esito o null; un file non leggibile (colonne non riconosciute) non blocca nulla: resta "Importa dal contratto".
 */
export async function importaAllaPrimaApertura(a, salva) {
  if (a.linea !== 'SRV') return null;
  if (await one('SELECT 1 FROM listini WHERE account_id=$1 LIMIT 1', [a.id])) return null;
  const c = await contrattoDellAccount(a);
  if (!c) return null;
  const f = await one(`SELECT id, filename, mime, data, blob_path FROM contract_files WHERE contract_id=$1 AND category='LISTINO_XLSX' AND listino_id IS NULL ORDER BY created_at DESC LIMIT 1`, [c.id]);
  if (!f) return null;
  const buffer = await readBuffer(f);
  if (!buffer) return null;
  try {
    return await salva({ buffer, filename: f.filename, mime: f.mime || MIME_XLSX, note: `Importato automaticamente dal contratto ${c.protocol || `#${c.id}`} alla prima apertura dell'account`, esistenteId: f.id });
  } catch (e) {
    console.warn(`[business] listino dal contratto ${c.id} non importato automaticamente (account ${a.id}): ${e.message}`);
    return null;
  }
}
