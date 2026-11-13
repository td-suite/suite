// Rimborso Spese · flusso della nota: BOZZA → INVIATA (al responsabile diretto dell'organigramma, notifica nella Suite ed email) →
// APPROVATA (eventualmente con righe escluse, con motivo) oppure RESPINTA (torna in BOZZA al dipendente con il motivo) → IN_LIQUIDAZIONE
// (P&C controlla: può rimandare al responsabile o al dipendente con motivo) → LIQUIDATA (data, importo, riferimento del cedolino o del
// bonifico) → ARCHIVIATA (PDF definitivo). Separazione dei ruoli: nessuno approva né liquida la propria nota. Ogni passaggio scrive un
// evento nello storico della nota e l'audit della Suite.
import { Router } from 'express';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { ah, bad, forbidden, parse, audit } from '../../../lib/util.js';
import { sendFile, storeBuffer } from '../../../lib/moduleStorage.js';
import { sanitizeFilename } from '../../../lib/blob.js';
import { KEY, userContext, notaVisibile, caricaNota, ricalcola, evento, notifica, utentiDiPersone, titoloNota, linkNota, invalidaPerimetro } from '../lib/core.js';
import { azioni, eur, testoSaldo, nomeMese, STATO_LABEL } from '../lib/calcoli.js';
import { scheda } from '../lib/scheda.js';
import { notaPdf } from '../lib/pdf.js';
import { inviaPdfApprovazione } from '../lib/invioApprovazione.js';

const r = Router();
const motivoSchema = z.object({ motivo: z.string().trim().min(3, 'scrivi il motivo').max(1000) });

async function conAzione(req, azione) {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  const az = azioni(n, ctx.ruolo(n));
  if (!az[azione]) {
    if (n.person_id === ctx.personId && ['approva', 'respingi', 'escludi', 'liquida', 'prendi_in_carico', 'rimanda', 'archivia'].includes(azione)) throw forbidden('Separazione dei ruoli: nessuno approva o liquida la propria nota');
    throw forbidden(`Operazione non consentita sulla nota (${STATO_LABEL[n.stato].toLowerCase()})`);
  }
  return { ctx, n };
}
const risposta = async (res, ctx, id) => res.json(await scheda(await caricaNota(id), ctx));
const dipendenteUtenti = (n) => utentiDiPersone([n.person_id]);

// ---------------------------------------------------------------- invio
r.post('/note/:id/invia', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  if (!azioni(n, ctx.ruolo(n)).invia) throw forbidden('Solo il dipendente invia la propria nota in bozza');
  invalidaPerimetro();
  const ctx2 = await userContext(Object.assign(req, { rimbCtx: null }));
  const sc = await scheda(n, ctx2);
  if (sc.controlli.bloccanti.length) throw bad(`La nota non si può inviare: ${sc.controlli.bloccanti.join('; ')}`, { bloccanti: sc.controlli.bloccanti });
  const p = ctx2.perim.persone.get(n.person_id);
  // vertice dell'organigramma (nessun superiore) e titolare: approvazione automatica alla conferma (CEO, 13/11/2026). Solo il vertice:
  // chi ha un superiore non raggiungibile continua a salire (P&C)
  if (p?.vertice && ctx2.user.level === 'OWNER') return inviaVertice(req, res, ctx2, n, sc);
  const alPc = !p || p.al_pc || !p.approvatore_id;
  const pcAltri = [...ctx2.pc].filter((id) => id !== n.person_id);
  if (alPc && !pcAltri.length) throw bad('Non hai un responsabile in organigramma e non c\'è un P&C diverso da te che possa approvare la nota: va indicato P&C in Impostazioni (pc_person_ids) o nel grant Amministratore di Contratti del personale');
  const ritardo = sc.controlli.finestra.in_ritardo;
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato='INVIATA', responsabile_person_id=$2, responsabile_origine=$3, al_pc=$4, inviata_at=now(), inviata_da=$5, in_ritardo=$6,
        approvata_at=NULL, approvata_da=NULL, approvata_person_id=NULL, approvazione_automatica=FALSE, presa_in_carico_at=NULL, presa_in_carico_da=NULL, promemoria_at=NULL, versione=versione+1, updated_at=now() WHERE id=$1`,
    [n.id, alPc ? null : p.approvatore_id, p?.origine || 'persona fuori dal perimetro', alPc, ctx.uid, ritardo]);
    await ricalcola(n.id, c);
    await evento(n.id, 'INVIATA', { userId: ctx.uid, personId: ctx.personId, testo: alPc ? 'a P&C (secondo controllo: nessun superiore in organigramma)' : `a ${p.approvatore_nome}`,
      dati: { responsabile_person_id: alPc ? null : p.approvatore_id, origine: p?.origine, saltati: p?.saltati || [], in_ritardo: ritardo, avvisi: sc.controlli.avvisi, totale: sc.riepilogo.tot_rimborsabile, saldo: sc.riepilogo.saldo } }, c);
  });
  const nn = await caricaNota(n.id);
  const dest = alPc ? await utentiDiPersone(pcAltri) : await utentiDiPersone([p.approvatore_id]);
  await notifica(dest, { title: `Nota spese di ${nn.persona} (${nomeMese(n.anno, n.mese)}) da approvare`, body: `Totale rimborsabile ${eur(nn.tot_rimborsabile)}, ${testoSaldo(nn.saldo)}${ritardo ? '. Inviata in ritardo' : ''}.`, link: linkNota(n), ref: `rimborsi:${n.id}:invio` });
  await audit(req, 'RIMBORSI_NOTA_INVIATA', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(n.anno, n.mese)} · ${nn.persona}`, data: { responsabile: nn.responsabile_person_id, al_pc: alPc, totale: nn.tot_rimborsabile, in_ritardo: ritardo } });
  await risposta(res, ctx2, n.id);
}));

/** Invio del vertice: INVIATA e subito APPROVATA (approvatore = sé stesso, "approvazione automatica del vertice"), poi P&C e il PDF */
async function inviaVertice(req, res, ctx, n, sc) {
  const ritardo = sc.controlli.finestra.in_ritardo;
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato='APPROVATA', responsabile_person_id=$2, responsabile_origine='approvazione automatica del vertice', al_pc=FALSE, approvazione_automatica=TRUE,
        inviata_at=now(), inviata_da=$3, in_ritardo=$4, approvata_at=now(), approvata_da=$3, approvata_person_id=$2, presa_in_carico_at=NULL, presa_in_carico_da=NULL,
        email_approvazione_esito=NULL, email_approvazione_errore=NULL, promemoria_at=NULL, versione=versione+1, updated_at=now() WHERE id=$1`, [n.id, ctx.personId, ctx.uid, ritardo]);
    await ricalcola(n.id, c);
    await evento(n.id, 'INVIATA', { userId: ctx.uid, personId: ctx.personId, testo: 'confermata dal vertice dell\'organigramma', dati: { in_ritardo: ritardo, totale: sc.riepilogo.tot_rimborsabile, saldo: sc.riepilogo.saldo } }, c);
    await evento(n.id, 'APPROVATA', { userId: ctx.uid, personId: ctx.personId, testo: 'Approvata automaticamente: nessun superiore in organigramma', dati: { automatica: true } }, c);
  });
  const nn = await caricaNota(n.id);
  await notifica(await utentiDiPersone([...ctx.pc].filter((id) => id !== n.person_id)), { title: `Nota spese di ${nn.persona} (${nomeMese(n.anno, n.mese)}) approvata da liquidare`, body: `Approvazione automatica del vertice dell'organigramma. Totale rimborsabile ${eur(nn.tot_rimborsabile)}.`, link: linkNota(n), ref: `rimborsi:${n.id}:auto` });
  await audit(req, 'RIMBORSI_NOTA_APPROVATA', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(n.anno, n.mese)} · ${nn.persona}`, data: { automatica: true, totale: nn.tot_rimborsabile } });
  await inviaPdfApprovazione(n.id, { userId: ctx.uid });
  await risposta(res, ctx, n.id);
}

// ---------------------------------------------------------------- responsabile: escludi o includi una riga, approva, respingi
const rigaSchema = z.object({ tipo: z.enum(['SPESA', 'VIAGGIO']), riga_id: z.coerce.number().int(), motivo: z.string().trim().max(1000).optional() });
async function escludi(c, n, b, ctx, esclusa) {
  const tab = b.tipo === 'SPESA' ? 'spese' : 'viaggi';
  const u = await c.query(`UPDATE ${tab} SET esclusa=$3, esclusa_motivo=$4, esclusa_da=$5, esclusa_at=CASE WHEN $3 THEN now() END, updated_at=now() WHERE id=$1 AND nota_id=$2 RETURNING id`,
    [b.riga_id, n.id, esclusa, esclusa ? b.motivo : null, esclusa ? ctx.uid : null]);
  if (!u.rowCount) throw bad('Riga inesistente');
  await evento(n.id, esclusa ? 'RIGA_ESCLUSA' : 'RIGA_INCLUSA', { userId: ctx.uid, personId: ctx.personId, testo: esclusa ? b.motivo : null, dati: { tipo: b.tipo, riga_id: b.riga_id } }, c);
}
r.post('/note/:id/escludi', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'escludi');
  const b = parse(rigaSchema, req.body || {});
  if (!b.motivo || b.motivo.length < 3) throw bad('Scrivi il motivo dell\'esclusione: lo vede il dipendente');
  await tx(async (c) => { await escludi(c, n, b, ctx, true); await ricalcola(n.id, c); });
  await audit(req, 'RIMBORSI_RIGA_ESCLUSA', { module: KEY, entity: 'nota', entityId: n.id, data: b });
  await risposta(res, ctx, n.id);
}));
r.post('/note/:id/includi', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'escludi');
  const b = parse(rigaSchema, req.body || {});
  await tx(async (c) => { await escludi(c, n, b, ctx, false); await ricalcola(n.id, c); });
  await risposta(res, ctx, n.id);
}));

r.post('/note/:id/approva', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'approva');
  const b = parse(z.object({ nota: z.string().trim().max(1000).optional() }), req.body || {});
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato='APPROVATA', approvata_at=now(), approvata_da=$2, approvata_person_id=$3, email_approvazione_esito=NULL, email_approvazione_errore=NULL, promemoria_at=NULL, updated_at=now() WHERE id=$1`, [n.id, ctx.uid, ctx.personId]);
    await ricalcola(n.id, c);
    await evento(n.id, 'APPROVATA', { userId: ctx.uid, personId: ctx.personId, testo: b.nota || (n.al_pc ? 'approvata da P&C (secondo controllo)' : null) }, c);
  });
  const nn = await caricaNota(n.id);
  const escluse = Number(nn.tot_escluso) > 0;
  await notifica(await dipendenteUtenti(n), { title: `La tua ${titoloNota(n)} è approvata${escluse ? ' con righe escluse' : ''}`, body: `Totale rimborsabile ${eur(nn.tot_rimborsabile)}${escluse ? `, escluse righe per ${eur(nn.tot_escluso)}` : ''}. Passa a P&C per la liquidazione.`, link: linkNota(n), ref: `rimborsi:${n.id}:approvata` });
  await audit(req, 'RIMBORSI_NOTA_APPROVATA', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(n.anno, n.mese)} · ${nn.persona}`, data: { totale: nn.tot_rimborsabile, escluso: nn.tot_escluso } });
  // PDF di approvazione ai destinatari di Impostazioni (da people@): un errore d'invio non annulla l'approvazione
  await inviaPdfApprovazione(n.id, { userId: ctx.uid });
  await risposta(res, ctx, n.id);
}));

r.post('/note/:id/respingi', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'respingi');
  const b = parse(motivoSchema, req.body || {});
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato='BOZZA', promemoria_at=NULL, updated_at=now() WHERE id=$1`, [n.id]);
    await evento(n.id, 'RESPINTA', { userId: ctx.uid, personId: ctx.personId, testo: b.motivo }, c);
  });
  await notifica(await dipendenteUtenti(n), { title: `La tua ${titoloNota(n)} è stata respinta`, body: `Motivo: ${b.motivo}. Correggi e invia di nuovo.`, link: linkNota(n), ref: `rimborsi:${n.id}:respinta` });
  await audit(req, 'RIMBORSI_NOTA_RESPINTA', { module: KEY, entity: 'nota', entityId: n.id, label: nomeMese(n.anno, n.mese), data: { motivo: b.motivo } });
  await risposta(res, ctx, n.id);
}));

// P&C o titolare: la nota in attesa torna al responsabile calcolato oggi (es. il responsabile è cambiato o è assente da giorni)
r.post('/note/:id/ricalcola-responsabile', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'ricalcola_responsabile');
  invalidaPerimetro();
  const ctx2 = await userContext(Object.assign(req, { rimbCtx: null }));
  const p = ctx2.perim.persone.get(n.person_id);
  if (!p?.approvatore_id) throw bad('Nessun superiore raggiungibile in organigramma: la nota va rimandata al dipendente o approvata da P&C');
  if (p.approvatore_id === n.responsabile_person_id) throw bad(`Il responsabile resta ${p.approvatore_nome}: niente da cambiare`);
  await tx(async (c) => {
    await c.query('UPDATE note SET responsabile_person_id=$2, responsabile_origine=$3, promemoria_at=NULL, updated_at=now() WHERE id=$1', [n.id, p.approvatore_id, p.origine]);
    await evento(n.id, 'RESPONSABILE_RICALCOLATO', { userId: ctx.uid, personId: ctx.personId, testo: `da ${n.responsabile_nome || 'nessuno'} a ${p.approvatore_nome}`, dati: { origine: p.origine } }, c);
  });
  await notifica(await utentiDiPersone([p.approvatore_id]), { title: `Nota spese di ${n.persona} (${nomeMese(n.anno, n.mese)}) da approvare`, body: `Totale rimborsabile ${eur(n.tot_rimborsabile)}.`, link: linkNota(n), ref: `rimborsi:${n.id}:ricalcolo` });
  await risposta(res, ctx2, n.id);
}));

// P&C e titolare: nuovo invio del PDF di approvazione (dopo un errore, o dopo aver corretto i destinatari)
r.post('/note/:id/reinvia-approvazione', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  if (!ctx.isPC && !ctx.isTitolare) throw forbidden('Reinvio riservato a P&C e al titolare');
  if (!['APPROVATA', 'IN_LIQUIDAZIONE', 'LIQUIDATA', 'ARCHIVIATA'].includes(n.stato)) throw bad('La nota non è approvata');
  const esito = await inviaPdfApprovazione(n.id, { userId: ctx.uid, reinvio: true });
  await audit(req, 'RIMBORSI_PDF_REINVIATO', { module: KEY, entity: 'nota', entityId: n.id, data: { esito: esito.esito, errore: esito.errore || null } });
  await risposta(res, ctx, n.id);
}));

// ---------------------------------------------------------------- P&C: presa in carico, rimando, liquidazione, archivio
r.post('/note/:id/prendi-in-carico', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'prendi_in_carico');
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato='IN_LIQUIDAZIONE', presa_in_carico_at=now(), presa_in_carico_da=$2, updated_at=now() WHERE id=$1`, [n.id, ctx.uid]);
    await evento(n.id, 'IN_LIQUIDAZIONE', { userId: ctx.uid, personId: ctx.personId }, c);
  });
  await risposta(res, ctx, n.id);
}));

r.post('/note/:id/rimanda', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'rimanda');
  const b = parse(motivoSchema.extend({ a: z.enum(['RESPONSABILE', 'DIPENDENTE']) }), req.body || {});
  if (b.a === 'RESPONSABILE' && (n.al_pc || n.approvazione_automatica)) throw bad('Questa nota non ha un responsabile (vertice dell\'organigramma): rimandala al dipendente');
  await tx(async (c) => {
    await c.query(`UPDATE note SET stato=$2, approvata_at=NULL, approvata_da=NULL, approvata_person_id=NULL, approvazione_automatica=FALSE, presa_in_carico_at=NULL, presa_in_carico_da=NULL, promemoria_at=NULL, updated_at=now() WHERE id=$1`,
      [n.id, b.a === 'RESPONSABILE' ? 'INVIATA' : 'BOZZA']);
    await evento(n.id, b.a === 'RESPONSABILE' ? 'RIMANDATA_RESPONSABILE' : 'RIMANDATA_DIPENDENTE', { userId: ctx.uid, personId: ctx.personId, testo: b.motivo }, c);
  });
  if (b.a === 'RESPONSABILE') await notifica(await utentiDiPersone([n.responsabile_person_id]), { title: `P&C ti rimanda la nota spese di ${n.persona} (${nomeMese(n.anno, n.mese)})`, body: `Motivo: ${b.motivo}`, link: linkNota(n), ref: `rimborsi:${n.id}:rimando` });
  else await notifica(await dipendenteUtenti(n), { title: `P&C ti rimanda la ${titoloNota(n)}`, body: `Motivo: ${b.motivo}. Correggi e invia di nuovo.`, link: linkNota(n), ref: `rimborsi:${n.id}:rimando` });
  await audit(req, 'RIMBORSI_NOTA_RIMANDATA', { module: KEY, entity: 'nota', entityId: n.id, data: b });
  await risposta(res, ctx, n.id);
}));

r.post('/note/:id/liquida', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'liquida');
  const b = parse(z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data del pagamento non valida'),
    importo: z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().min(0).max(100000)),
    riferimento: z.string().trim().min(2, 'indica il riferimento del cedolino o del bonifico').max(200),
  }), req.body || {});
  await tx(async (c) => {
    if (n.stato === 'APPROVATA') await evento(n.id, 'IN_LIQUIDAZIONE', { userId: ctx.uid, personId: ctx.personId }, c);
    await c.query(`UPDATE note SET stato='LIQUIDATA', presa_in_carico_at=coalesce(presa_in_carico_at, now()), presa_in_carico_da=coalesce(presa_in_carico_da, $2), liquidata_at=now(), liquidata_da=$2,
        liquidazione_data=$3, liquidazione_importo=$4, liquidazione_rif=$5, updated_at=now() WHERE id=$1`, [n.id, ctx.uid, b.data, b.importo, b.riferimento]);
    await evento(n.id, 'LIQUIDATA', { userId: ctx.uid, personId: ctx.personId, testo: `${eur(b.importo)} il ${b.data.split('-').reverse().join('/')}, rif. ${b.riferimento}`, dati: b }, c);
  });
  await notifica(await dipendenteUtenti(n), { title: `La tua ${titoloNota(n)} è liquidata`, body: `${eur(b.importo)} con pagamento del ${b.data.split('-').reverse().join('/')} (rif. ${b.riferimento}).`, link: linkNota(n), ref: `rimborsi:${n.id}:liquidata` });
  await audit(req, 'RIMBORSI_NOTA_LIQUIDATA', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(n.anno, n.mese)} · ${n.persona}`, data: b });
  await risposta(res, ctx, n.id);
}));

/** Archiviazione: PDF definitivo salvato con la nota (archivio a due vie), stato ARCHIVIATA */
export async function archivia(n, ctx) {
  const sc = await scheda(n, ctx, { perPdf: true });
  sc.nota = { ...sc.nota, stato: 'ARCHIVIATA' };
  const buf = await notaPdf(sc);
  const nome = sanitizeFilename(`Nota_spese_${n.anno}-${String(n.mese).padStart(2, '0')}_${n.persona}.pdf`);
  const st = await storeBuffer('rimborsi', `${n.anno}-${String(n.mese).padStart(2, '0')}`, nome, 'application/pdf', buf);
  await tx(async (c) => {
    const a = (await c.query(`INSERT INTO allegati (nota_id, riga_tipo, riga_id, filename, mime, size, sha256, data, blob_path, caricato_da) VALUES ($1,'NOTA',NULL,$2,'application/pdf',$3,$4,$5,$6,$7) RETURNING id`,
      [n.id, nome, st.size, st.sha256, st.data, st.blob_path, ctx.uid])).rows[0];
    await c.query(`UPDATE note SET stato='ARCHIVIATA', archiviata_at=now(), archiviata_da=$2, pdf_allegato_id=$3, updated_at=now() WHERE id=$1`, [n.id, ctx.uid, a.id]);
    await evento(n.id, 'ARCHIVIATA', { userId: ctx.uid, personId: ctx.personId, dati: { pdf: a.id, sha256: st.sha256 } }, c);
  });
  return st;
}
r.post('/note/:id/archivia', ah(async (req, res) => {
  const { ctx, n } = await conAzione(req, 'archivia');
  const st = await archivia(n, ctx);
  await audit(req, 'RIMBORSI_NOTA_ARCHIVIATA', { module: KEY, entity: 'nota', entityId: n.id, label: nomeMese(n.anno, n.mese), data: { sha256: st.sha256 } });
  await risposta(res, ctx, n.id);
}));

// ---------------------------------------------------------------- PDF della nota: definitivo se archiviata, altrimenti generato ora
r.get('/note/:id/pdf', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  const inline = req.query.inline === '1';
  if (n.pdf_allegato_id) {
    const a = await one('SELECT * FROM allegati WHERE id=$1 AND nota_id=$2', [n.pdf_allegato_id, n.id]);
    if (a) return sendFile(res, a, { inline });
  }
  const buf = await notaPdf(await scheda(n, ctx, { perPdf: true }));
  await sendFile(res, { filename: `Nota_spese_${n.anno}-${String(n.mese).padStart(2, '0')}_${sanitizeFilename(n.persona)}${n.stato === 'ARCHIVIATA' ? '' : '_provvisoria'}.pdf`, data: buf, mime: 'application/pdf' }, { inline });
}));

export default r;
