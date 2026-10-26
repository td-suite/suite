// Canali in ingresso da StudioLAB, senza sessione utente: protetti dal segreto in ingresso del connettore StudioLAB
// (Amministrazione > Connettori; ripiego sulla variabile LIS_PUSH_SECRET finché il connettore non è configurato).
//  POST /api/nc/lis/push   NotificaPush JSON {IdAccettazione, TipoNotifica, IdDocumento}  -> aggiorna la cache dal LIS
//  POST /api/nc/hl7        messaggio HL7 v2.5 StudioLAB (OML^O21, ORL^O22, MDM^T02/T10, ADT) nel body text/plain -> aggiorna la cache, risponde ACK (sempre HTTP 200)
//  Specifica: CB Sistemi, "Integrazione HL7 con ServiceNET" rev. 3 (27/03/2026). Autenticazione: header X-API-KEY (o X-Push-Secret) = segreto in ingresso del connettore
//  Nella Suite: montati prima di sessione e CSRF (vedi index.js). Con modulo non LIVE i canali rifiutano (l'app originale riceve ancora il flusso).
import { Router } from 'express';
import express from 'express';
import { config } from '../config.js';
import { q } from '../db.js';
import { ah, HttpError } from '../lib/util.js';
import { getModuleState } from '../../../lib/modules.js';
import * as lis from '../lib/lis.js';
import { parseHl7, ack } from '../lib/hl7.js';
import { publish } from '../lib/events.js';
import { findSedeByCodice } from '../lib/sedi.js';
import { verifyInbound, inboundConfigured, logConnector } from '../../../lib/connectors.js';

const r = Router();

// Esito preliminare: segreto e stato del modulo. Ritorna null se si può procedere, altrimenti { status, error }
// Il segreto in ingresso è quello del connettore StudioLAB (Amministrazione > Connettori; ripiego LIS_PUSH_SECRET / STUDIOLAB_INBOUND_KEY)
async function gate(req, endpoint) {
  const t0 = Date.now();
  const refuse = (status, error) => { logConnector({ kind: 'STUDIOLAB', direction: 'IN', module: 'nc', endpoint, status: String(status), ms: Date.now() - t0, message: error }); return { status, error }; };
  if (!inboundConfigured('STUDIOLAB')) return refuse(503, 'Canale non configurato: segreto in ingresso del connettore StudioLAB assente (Amministrazione > Connettori)');
  const given = req.get('X-Push-Secret') || req.get('X-API-KEY') || req.query.secret;
  if (!verifyInbound('STUDIOLAB', given)) return refuse(401, 'Segreto non valido');
  const st = await getModuleState('nc');
  if (st.mode !== 'LIVE') return refuse(423, 'Modulo Non conformità non ancora attivo nella Suite: il flusso StudioLAB resta sull\'app originale');
  return null;
}
const logIn = (endpoint, t0, ok, message) => logConnector({ kind: 'STUDIOLAB', direction: 'IN', module: 'nc', endpoint, status: ok ? 'OK' : 'ERRORE', ms: Date.now() - t0, message });

r.post('/lis/push', express.json({ limit: '1mb' }), ah(async (req, res) => {
  const t0 = Date.now();
  const g = await gate(req, 'POST /api/nc/lis/push'); if (g) return res.status(g.status).json({ error: g.error });
  const id = String(req.body?.IdAccettazione || req.body?.idAccettazione || '').trim();
  if (!id) { await lis.logEvento('PUSH', 'ERRORE', { dettaglio: 'IdAccettazione mancante', payload: JSON.stringify(req.body) }); logIn('POST /api/nc/lis/push', t0, false, 'IdAccettazione mancante'); throw new HttpError(400, 'IdAccettazione mancante'); }
  let row = null;
  try { row = await lis.refreshFromLis(id); } catch (e) { await lis.logEvento('PUSH', 'ERRORE', { accettazioneId: id, dettaglio: e.message, payload: JSON.stringify(req.body) }); logIn('POST /api/nc/lis/push', t0, false, e.message); return res.status(202).json({ ok: false, error: e.message }); }
  if (!row) row = await lis.upsertAccettazione({ id }, 'PUSH');   // conosciuta solo per numero: la preanalitica la completerà
  await lis.logEvento('PUSH', 'OK', { accettazioneId: id, dettaglio: `${req.body?.TipoNotifica || 'notifica'}${req.body?.IdDocumento ? ` · doc ${req.body.IdDocumento}` : ''}`, payload: JSON.stringify(req.body) });
  logIn('POST /api/nc/lis/push', t0, true, `accettazione ${id}`);
  publish({ type: 'acc.updated', accId: id, at: new Date().toISOString() });
  res.json({ ok: true, id });
}));

r.post('/hl7', express.text({ type: '*/*', limit: '4mb' }), ah(async (req, res) => {
  const reply = (parsed, ok, err) => res.status(200).type('text/plain').send(ack(parsed, ok, err));   // Appendice B: sempre 200, esito nel segmento MSA
  const t0 = Date.now();
  const g = await gate(req, 'POST /api/nc/hl7');
  if (g) return g.status === 423 ? reply(null, false, g.error) : res.status(g.status).json({ error: g.error });
  let parsed;
  try { parsed = parseHl7(req.body); }
  catch (e) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: e.message, payload: req.body }); logIn('POST /api/nc/hl7', t0, false, e.message); return reply(null, false, e.message); }
  const a = parsed.accettazione;
  try {
    // Anagrafica: ADT^A05 aggiorna il paziente sulle accettazioni note; ADT^A39 (merge) viene solo registrato
    if (parsed.code === 'ADT') {
      if (parsed.merge) await lis.logEvento('HL7', 'OK', { dettaglio: `merge anagrafiche: ${parsed.merge.idDaEliminare} -> ${a.paziente?.cf || a.paziente?.idPlacer || '?'} (registrato, nessuna azione)`, payload: req.body });
      else if (a.paziente?.cf) {
        const r2 = await q(`UPDATE accettazioni SET paziente_cognome=coalesce($2,paziente_cognome), paziente_nome=coalesce($3,paziente_nome), paziente_nascita=coalesce($4,paziente_nascita), paziente_sesso=coalesce($5,paziente_sesso), updated_at=now() WHERE paziente_cf=$1`, [a.paziente.cf, a.paziente.cognome, a.paziente.nome, a.paziente.nascita, a.paziente.sesso]);
        await lis.logEvento('HL7', 'OK', { dettaglio: `${parsed.type}: anagrafica aggiornata su ${r2.rowCount} accettazioni`, payload: req.body });
      }
      logIn('POST /api/nc/hl7', t0, true, `${parsed.type}`);
      return reply(parsed, true);
    }
    if (!a.id) { await lis.logEvento('HL7', 'ERRORE', { dettaglio: 'numero accettazione assente (PV1-19 / ORC-4 / OBR-20)', payload: req.body }); return reply(parsed, false, 'Numero accettazione assente'); }
    // Sede inviante: codice cliente StudioLAB (ORC-13 / FT1 / MSH-4) cercato in org_ext/site_ext e in public.sites (studiolab_code, code):
    // il codice di un punto SERVICE attribuisce l'accettazione alla Legal entity del punto (sede_id = -organization_id).
    // Nessuna creazione automatica: se il codice non è censito l'accettazione resta senza sede e la preanalitica la assegna dal Desk.
    const sede = a.sede_codice ? await findSedeByCodice(a.sede_codice) : null;
    const row = await lis.upsertAccettazione({
      id: a.id, sede_id: sede?.id ?? null, id_richiesta_cliente: a.id_richiesta_cliente, data_accettazione: a.data_accettazione,
      paziente_cognome: a.paziente?.cognome, paziente_nome: a.paziente?.nome, paziente_nascita: a.paziente?.nascita, paziente_sesso: a.paziente?.sesso, paziente_cf: a.paziente?.cf,
      stato_lis: a.esami.length && a.esami.every((e) => e.stato === 40) ? 40 : (a.esami.some((e) => e.stato === 10) ? 10 : undefined),
      esami: a.esami, raw: { hl7: parsed.type, ctrlId: parsed.ctrlId, controllo: parsed.controlCode, referto: parsed.referto },
    }, 'HL7');
    // se arriva prima il numero placer e poi quello del laboratorio (ORL_O22), collega le due identità
    if (a.id_lab && a.id_placer && a.id_lab !== a.id_placer) await q(`UPDATE nc SET accettazione_id=$1 WHERE accettazione_id=$2`, [a.id_lab, a.id_placer]).catch(() => {});
    const flags = a.esami.filter((e) => e.bloccato || e.nonEseguito).map((e) => `${e.cod}:${e.statoHl7 || e.controllo}`);
    await lis.logEvento('HL7', 'OK', { accettazioneId: a.id, dettaglio: `${parsed.type}${parsed.controlCode ? ` ${parsed.controlCode}` : ''} · sede ${a.sede_codice || '–'}${a.sede_da_msh ? ' (da MSH-4)' : ''}${a.sede_codice && !sede ? ' (codice non censito in anagrafica)' : ''} · ${a.esami.length} esami${flags.length ? ` · NC LIS: ${flags.join(', ')}` : ''}`, payload: req.body });
    publish({ type: 'acc.updated', accId: row.id, at: new Date().toISOString() });
    logIn('POST /api/nc/hl7', t0, true, `${parsed.type} · accettazione ${a.id}`);
    return reply(parsed, true);
  } catch (e) {
    await lis.logEvento('HL7', 'ERRORE', { accettazioneId: a?.id, dettaglio: e.message, payload: req.body });
    logIn('POST /api/nc/hl7', t0, false, e.message);
    return reply(parsed, false, `Errore interno: ${e.message}`);
  }
}));

export default r;
