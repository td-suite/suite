// Business Hub · generazione del documento del contratto (DOCX dal template + PDF da LibreOffice con i ritocchi di contrattoPdf.js),
// condivisa dalla scheda Contratto (POST /contracts/:id/generate) e dal Pacchetto di benvenuto (richiesta del CEO del 07/11/2026: il
// pacchetto mostrava la lettera di offerta salvata giorni prima con il template vecchio, "gli stessi errori" anche a codice corretto).
// - rendiContratto(): rende DOCX e PDF con il template e il codice attuali: firma di TD, Allegato 1 = offerta economica della versione
//   corrente del listino dell'account (generata al momento se manca), Politica della Qualità in coda, controllo del margine inferiore
//   (nessun testo del corpo sopra il piè di pagina, testoSulPiede in mod230.js). Non scrive i file del contratto.
// - salvaGenerati(): registra GENERATO_DOCX e GENERATO_PDF della versione corrente; con `sostituisci` aggiorna sul posto le righe
//   esistenti della stessa versione (stesso id: il kit di proposta e gli invii che le richiamano restano validi) invece di aggiungerne.
// - Regola della rigenerazione (regolaRigenerazione, pura): finché il contratto non ha un file FIRMATO il documento si rigenera
//   liberamente sulla stessa versione; con il firmato caricato serve una nuova revisione.
// - rigeneraDalPacchetto(): rigenerazione sulla versione corrente senza revisione né cambio di stato, evento GENERATO "rigenerato dal
//   pacchetto". La usa pacchettoGenera.js quando il contratto non ha un file FIRMATO.
import { terminiPagamento } from './docgen.js';
import { one, many, q } from '../db.js';
import { todayRome } from './util.js';
import { getSettings } from './rules.js';
import { contractData, renderDocx, docxToPdf, pdfAvailable, CONTRACT_TEMPLATE, CONTRACT_DOCNAME } from './docgen.js';

/**
 * B14: sede SERVICE del contratto Service: quella della Legal entity con il nome del punto del contratto (site_name) se ce ne sono più,
 * altrimenti la più vecchia attiva. null se il cliente non ha ancora la sede (la crea la contrattualizzazione, A7).
 */
export async function sedeServiceDi(c) {
  const rows = await many(`SELECT id, code, name, address, zip, city, province, phone, email, opening_hours_json FROM public.sites WHERE organization_id=$1 AND kind='SERVICE' AND active ORDER BY id`, [c.org_id]);
  if (!rows.length) return null;
  const nome = String(c.data?.site_name || '').trim().toLowerCase();
  return (nome && rows.find((r) => r.name.trim().toLowerCase() === nome)) || rows[0];
}
import { storeBuffer, readBuffer, dropBlobs } from './storage.js';
import { versioneCorrente } from './listino.js';
import { collegaVersione } from './listinoUnico.js';
import { leggiFirma, firmatario } from './firmaTd.js';
import { apponiFirma, accodaPdf, inserisciOffertaAllegato1, controllaPiede } from './contrattoPdf.js';
import { contaPagine } from './pacchettoPdf.js';
import { addGiorni } from './pacchetto.js';
import { politicaQualita } from './politicaQualita.js';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const caricaContratto = async (id) => (await import('../routes/contracts.js')).loadContract(id);

/** Il contratto ha un file FIRMATO caricato (una versione qualsiasi)? files = contract_files [{ category }]. Pura. */
export const haFirmato = (files = []) => (files || []).some((f) => f.category === 'FIRMATO');

/**
 * Regola della generazione dalla scheda Contratto. c = { status, version, files: [{ category, version }] }. Pura, testata.
 * Ritorna { modo: 'PROPOSTA' (bozza o proposta: nuova versione, file sostituiti) | 'RIGENERA' (oltre la proposta senza firmato: stessa
 * versione, file della versione sostituiti) | 'REVISIONE' (oltre la proposta con il firmato: documento della revisione appena salvata),
 * errore: testo o null }.
 */
export function regolaRigenerazione(c) {
  const st = c?.status;
  if (['BOZZA', 'PROPOSTA'].includes(st)) return { modo: 'PROPOSTA', errore: null };
  if (['CESSATO', 'ANNULLATO'].includes(st)) return { modo: null, errore: 'Un contratto cessato o annullato non si rigenera' };
  if (!haFirmato(c?.files)) return { modo: 'RIGENERA', errore: null };
  const gia = (c?.files || []).some((f) => f.category === 'GENERATO_DOCX' && Number(f.version) === Number(c.version));
  return gia
    ? { modo: 'REVISIONE', errore: `Il contratto firmato è caricato e il documento della versione ${c.version} esiste già: per cambiare i termini salva prima una nuova revisione con "Modifica"` }
    : { modo: 'REVISIONE', errore: null };
}

/**
 * Allegato 1 del contratto Service (seconda richiesta del CEO del 07/11/2026): l'Offerta economica PDF della versione `listinoId` del
 * listino dell'account. Se per quella versione non è ancora stata generata (o il file non si legge) si genera adesso con creaOfferta,
 * come dalla scheda Listino e offerta: documento OFFERTA_ECONOMICA dell'account, attività nel diario, LISTINO_PDF del contratto.
 * Condizioni di pagamento: quelle del contratto, poi quelle della Legal entity, poi il predefinito; validità e destinatario come i
 * predefiniti della scheda. Ritorna { listino, documento_id, filename, pdf, pagine, generata }.
 */
export async function offertaAllegato1(c, listinoId, s, userId) {
  const l = await one('SELECT id, versione, caricato_at, riepilogo, offerta_documento_id FROM listini WHERE id=$1', [listinoId]);
  const leggi = async (id) => {
    const d = id ? await one('SELECT id, filename, data, blob_path FROM documenti WHERE id=$1', [id]) : null;
    const pdf = d ? await readBuffer(d) : null;
    const pagine = pdf ? await contaPagine(pdf) : 0;
    return pagine ? { documento_id: d.id, filename: d.filename, pdf, pagine } : null;
  };
  const esistente = await leggi(l.offerta_documento_id);
  if (esistente) return { listino: l, ...esistente, generata: false };
  const [{ creaOfferta }, { loadAccount }] = await Promise.all([import('../routes/listino.js'), import('../routes/hub.js')]);
  const a = await loadAccount(c.account_id);
  const ext = await one('SELECT pay_method, pay_terms FROM org_ext WHERE org_id=$1', [a.organization_id]);
  const ref = await one('SELECT id FROM contatti WHERE account_id=$1 AND principale ORDER BY id LIMIT 1', [a.id]);
  const oggi = todayRome();
  const out = await creaOfferta(a, l.id, {
    data: oggi, validita: addGiorni(oggi, Number(s.hub_offerta_validita_giorni) || 60),
    condizioni: terminiPagamento(ext || {}, s) || null, contatto_id: ref?.id || null,
  }, userId);
  const nuova = await leggi(out.documento_id);
  if (!nuova) throw new Error('PDF dell\'offerta economica generato ma non leggibile');
  return { listino: l, ...nuova, generata: true };
}

/**
 * Rende DOCX e PDF del contratto con template e codice attuali. c = loadContract(id) con il protocollo già assegnato.
 * Ritorna { c (ricaricato se il listino è stato collegato), docx, pdf (null se LibreOffice manca o fallisce), pdfError, avvisi, esito:
 * { firmato_td, firma, politica, allegato1, piede }, base (nome dei file senza estensione) }.
 */
export async function rendiContratto(c, s, userId) {
  // MOD230 (07/11/2026): referente principale e listino corrente dell'account (Allegati 2 e 1), Politica della Qualità dallo specchio
  // SGI (Allegato 8, pagine in coda al PDF); firma di TD nel PDF di MOD230 e MOD231 se caricata e non esclusa dalla spunta
  const avvisi = [];
  const extra = { referente: c.referente_principale || null };
  let politica = null;
  const pdfOk = await pdfAvailable();
  // Allegato 1 = Offerta economica impaginata della versione corrente del listino dell'account (seconda richiesta del CEO del
  // 07/11/2026): le sue pagine entrano nel PDF dopo la pagina dell'Allegato 1; senza listino o senza PDF "verrà allegata"
  let offerta1 = null;
  if (c.kind === 'SRV') {
    if (c.account_id) {
      const acc = await one('SELECT listino_corrente_id FROM accounts WHERE id=$1', [c.account_id]);
      const v = versioneCorrente(await many('SELECT id, versione FROM listini WHERE account_id=$1', [c.account_id]), acc?.listino_corrente_id);
      // listino unico: la versione dell'Allegato 1 è anche il listino (XLSX) del contratto
      if (v) { const { loadAccount } = await import('../routes/hub.js'); await collegaVersione(await loadAccount(c.account_id), v.id, { userId }); }
      if (v && pdfOk) {
        try { offerta1 = await offertaAllegato1(c, v.id, s, userId); } catch (e) { avvisi.push(`Offerta economica v${v.versione} non disponibile per l'Allegato 1 (${e.message}): nel contratto "verrà allegata alla sottoscrizione"`); }
      } else if (v) avvisi.push(`LibreOffice non disponibile: l'offerta economica v${v.versione} non entra nell'Allegato 1`);
      // i file del listino collegati al contratto (XLSX e offerta PDF) entrano nella frase del listino dell'Allegato 1
      if (v) c = await caricaContratto(c.id);
    }
    if (offerta1) extra.allegato1 = { versione: offerta1.listino.versione, data: offerta1.listino.caricato_at, esami: offerta1.listino.riepilogo?.esami };
    politica = await politicaQualita();
    if (politica.avviso) avvisi.push(politica.avviso);
    extra.politica = { doc: politica.doc, inCoda: Boolean(politica.pdf) };
  }
  if (c.kind === 'SRV' && c.org_id) extra.sedeService = await sedeServiceDi(c);   // B14
  const data = contractData(c, c.org, s, extra);
  const docx = renderDocx(CONTRACT_TEMPLATE[c.kind], data);
  const base = `${CONTRACT_DOCNAME[c.kind]}_${c.protocol}_v${c.version}`;
  let pdfError = null; let pdf = null;
  const esito = { firmato_td: false, firma: null, politica: null, allegato1: null, piede: null };
  if (pdfOk) {
    try {
      pdf = await docxToPdf(docx);
      // margine inferiore (07/11/2026): nessun testo del contratto nella fascia del piè di pagina; il controllo è sul documento del
      // contratto, prima dell'offerta economica (che ha la sua impaginazione) e della Politica della Qualità
      try {
        const k = await controllaPiede(pdf);
        esito.piede = { pagine: k.pagine, violazioni: k.violazioni.length, esempi: k.violazioni.slice(0, 5) };
        if (k.violazioni.length) {
          const pag = [...new Set(k.violazioni.map((x) => x.pagina))];
          avvisi.push(`Testo sopra il piè di pagina in ${pag.length === 1 ? 'pagina' : 'pagine'} ${pag.slice(0, 10).join(', ')} del contratto: controllare il PDF`);
        }
      } catch (e) { esito.piede = { errore: e.message }; }
      if (['SRV', 'MDL'].includes(c.kind)) {
        const firma = c.data?.firma_td === false ? null : await leggiFirma();
        if (c.data?.firma_td === false) esito.firma = 'esclusa dalla spunta del contratto';
        else if (!firma) esito.firma = 'nessuna firma caricata in Impostazioni';
        else {
          const chi = firmatario(s);
          const r = await apponiFirma(pdf, { mime: firma.mime, buffer: firma.buffer }, chi);
          if (r.apposte) { pdf = r.pdf; esito.firmato_td = true; esito.firma = { nome: chi.nome, qualifica: chi.ruolo, blocchi: r.apposte, sha256: firma.sha256 }; }
          else { esito.firma = 'spazio della firma non trovato nel PDF'; avvisi.push('Firma di TD non apposta: spazio della firma non trovato nel PDF (nome e qualifica del firmatario devono comparire nel blocco firme)'); }
        }
      }
      // l'offerta si inserisce dopo la firma (il suo blocco "Per Toscana Diagnostica" non deve ricevere la firma del contratto) e prima
      // della Politica della Qualità in coda
      if (offerta1) {
        try {
          const r = await inserisciOffertaAllegato1(pdf, offerta1.pdf, { titolo: `Allegato 1 · Offerta economica v${offerta1.listino.versione}` });
          pdf = r.pdf;
          esito.allegato1 = { listino_id: offerta1.listino.id, versione: offerta1.listino.versione, documento_id: offerta1.documento_id, filename: offerta1.filename, pagine: r.pagine, pagina: r.posizione.indice + 1, generata: offerta1.generata, segnalibro: r.segnalibro };
        } catch (e) { avvisi.push(`Offerta economica v${offerta1.listino.versione} non inserita nell'Allegato 1 del PDF (${e.message}): il testo dell'allegato la richiama, va allegata a mano`); }
      }
      if (politica?.pdf) {
        try { const r = await accodaPdf(pdf, politica.pdf); pdf = r.pdf; esito.politica = { ...politica.doc, pagine: r.pagine }; } catch (e) { avvisi.push(`Politica della Qualità non accodata al PDF: ${e.message}`); }
      }
    } catch (e) { pdfError = e.message; pdf = null; }
  } else pdfError = 'LibreOffice non disponibile: generato solo il DOCX';
  return { c, docx, pdf, pdfError, avvisi, esito, base };
}

/** meta del GENERATO_PDF: { allegato1_offerta: { listino_id, versione, documento_id, pagine, pagina } } se l'offerta è dentro, o null. */
export function metaPdf(esito) {
  if (!esito?.allegato1) return null;
  const { filename: _f, generata: _g, segnalibro: _s, ...a1 } = esito.allegato1;
  return { allegato1_offerta: a1 };
}

/**
 * Registra DOCX e PDF della versione corrente. sostituisci = true: le righe GENERATO_DOCX/GENERATO_PDF della stessa versione si
 * aggiornano sul posto (stesso id, blob vecchio eliminato), quelle mancanti si inseriscono; false: si inseriscono sempre.
 * Ritorna { docx_id, pdf_id }.
 */
export async function salvaGenerati(c, g, userId, { sostituisci = false } = {}) {
  const scrivi = async (cat, filename, mime, buf, meta = null) => {
    const st = await storeBuffer('contratti', filename, mime, buf);
    const vecchio = sostituisci ? await one('SELECT id, blob_path FROM contract_files WHERE contract_id=$1 AND category=$2 AND version=$3 ORDER BY created_at DESC LIMIT 1', [c.id, cat, c.version]) : null;
    if (vecchio) {
      await q(`UPDATE contract_files SET filename=$2, mime=$3, size=$4, sha256=$5, data=$6, blob_path=$7, uploaded_by=$8, meta=$9, created_at=now() WHERE id=$1`,
        [vecchio.id, filename, mime, st.size, st.sha256, st.data, st.blob_path, userId || null, meta ? JSON.stringify(meta) : null]);
      if (vecchio.blob_path && vecchio.blob_path !== st.blob_path) await dropBlobs([vecchio.blob_path]);
      return vecchio.id;
    }
    return (await one('INSERT INTO contract_files(contract_id, category, filename, mime, size, sha256, data, blob_path, version, uploaded_by, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
      [c.id, cat, filename, mime, st.size, st.sha256, st.data, st.blob_path, c.version, userId || null, meta ? JSON.stringify(meta) : null])).id;
  };
  const docxId = await scrivi('GENERATO_DOCX', `${g.base}.docx`, MIME_DOCX, g.docx);
  // senza PDF nuovo (LibreOffice assente o in errore) il PDF della versione resta quello di prima: meglio di nessuno, l'errore lo dice
  const pdfId = g.pdf ? await scrivi('GENERATO_PDF', `${g.base}.pdf`, 'application/pdf', g.pdf, metaPdf(g.esito)) : null;
  return { docx_id: docxId, pdf_id: pdfId };
}

/** Nota dell'evento GENERATO. */
export function notaGenerazione(c, g, { revisione = false, rigenerazione = false, origine = null } = {}) {
  const e = g.esito;
  return [origine, revisione ? `Revisione v${c.version} (stato ${c.status} invariato, versioni precedenti conservate)` : null,
    rigenerazione ? `Rigenerazione della versione ${c.version} (nessun contratto firmato caricato: stato ${c.status} invariato)` : null,
    e.firmato_td ? `PDF firmato da Toscana Diagnostica (${e.firma.nome}, ${e.firma.qualifica})` : null,
    e.allegato1 ? `Allegato 1: offerta economica v${e.allegato1.versione} (${e.allegato1.pagine} pagine)` : null,
    e.allegato1?.generata ? `Offerta economica v${e.allegato1.versione} generata per l'Allegato 1 (${e.allegato1.filename})` : null,
    e.politica ? `Politica della Qualità ${e.politica.code} in coda (${e.politica.pagine} pagine)` : null,
    e.piede && !e.piede.errore && !e.piede.violazioni ? 'Margine inferiore rispettato in tutte le pagine del contratto' : null,
    ...g.avvisi, g.pdfError].filter(Boolean).join(' · ') || null;
}

export async function eventoContratto(id, kind, userId, note, data) {
  await q('INSERT INTO contract_events(contract_id, kind, user_id, note, data) VALUES ($1,$2,$3,$4,$5)', [id, kind, userId || null, note || null, data ? JSON.stringify(data) : null]);
}

/**
 * Rigenerazione dal Pacchetto di benvenuto: solo contratti con protocollo (già generati almeno una volta), senza file FIRMATO, con i
 * dati completi. Stessa versione, nessuna revisione, stato invariato; i file GENERATO della versione corrente si sostituiscono sul posto.
 * Ritorna { file (riga GENERATO_PDF nuova, con meta), pdf, esito, avvisi } o lancia con il motivo (il pacchetto ripiega sul file salvato).
 */
export async function rigeneraDalPacchetto(contrattoId, userId) {
  const { loadContract, completenessErrors } = await import('../routes/contracts.js');
  const c0 = await loadContract(contrattoId);
  if (!c0.protocol) throw new Error('contratto mai generato (nessun protocollo): si genera dalla scheda Contratto');
  if (c0.kind === 'SEDE') throw new Error('per le sedi in locazione il contratto lo predispone il locatore');
  if (haFirmato(c0.files)) throw new Error('il contratto firmato è caricato: nel pacchetto va il firmato');
  if (['CESSATO', 'ANNULLATO'].includes(c0.status)) throw new Error(`contratto ${c0.status.toLowerCase()}`);
  const errori = completenessErrors(c0);
  if (errori.length) throw new Error(`dati del contratto incompleti (${errori.join(' ')})`);
  const s = await getSettings();
  const g = await rendiContratto(c0, s, userId);
  if (!g.pdf) throw new Error(g.pdfError || 'PDF non prodotto');
  const c = g.c;
  const ids = await salvaGenerati(c, g, userId, { sostituisci: true });
  const nota = notaGenerazione(c, g, { origine: `Documento della versione ${c.version} rigenerato dal pacchetto di benvenuto con il template attuale (stato ${c.status} invariato)` });
  await eventoContratto(c.id, 'GENERATO', userId, nota, { protocol: c.protocol, version: c.version, revisione: false, rigenerato_dal_pacchetto: true, firmato_td: g.esito.firmato_td, firma: g.esito.firma, politica: g.esito.politica, allegato1: g.esito.allegato1, piede: g.esito.piede, avvisi: g.avvisi });
  await q('UPDATE contracts SET updated_at=now() WHERE id=$1', [c.id]);
  const file = await one('SELECT id, filename, size, version, data, blob_path, meta, created_at FROM contract_files WHERE id=$1', [ids.pdf_id]);
  return { file, pdf: g.pdf, esito: g.esito, avvisi: g.avvisi, contratto: c };
}
