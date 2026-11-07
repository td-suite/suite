// Business Hub · revisione del listino/offerta (richiesta del CEO del 07/11/2026): "nel listino/offerta devi prevedere una sezione di
// revisione listino/offerta in cui può cambiare anche solo un prezzo e noi rigeneriamo a quel punto solo il PDF del listino/offerta e
// mandiamo rifirmato solo quello!"
// Parte operativa (database): nuova versione del listino dalle righe della corrente con i prezzi cambiati in pagina (regola pura
// applicaRevisione in listino.js), testo dell'email "Invia per la firma" dal modello delle Impostazioni, offerta firmata che torna
// (caricata o riconosciuta da un allegato della casella). Nessuna contrattualizzazione: il contratto resta quello già firmato.
// Docs: docs/BUSINESS_HUB.md, "Listino: revisione".
import { one, many, q } from '../db.js';
import { applicaRevisione, testoRigheCambiate, versioneCorrente } from './listino.js';
import { compila } from './processo.js';
import { modelliFlusso } from './pacchettoGenera.js';
import { attivita } from './flusso.js';
import { dataBreve } from './pacchetto.js';
import { todayRome } from './util.js';

const errore = (status, msg) => Object.assign(new Error(msg), { status });
const pct = (x) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Number(x || 0))}%`;

/** Versione corrente del listino dell'account (riga completa) o null. */
export async function corrente(a) {
  const v = await many('SELECT id, versione FROM listini WHERE account_id=$1', [a.id]);
  const c = versioneCorrente(v, a.listino_corrente_id);
  return c ? one('SELECT * FROM listini WHERE id=$1', [c.id]) : null;
}

/**
 * Salva la revisione come nuova versione (N+1) della versione corrente: stesse righe, prezzi modificati, mapping e intestazioni
 * ereditati, differenze calcolate, note = motivo, origine REVISIONE. La nuova versione diventa la corrente e lo sconto medio dell'account
 * la segue. Nel diario: LISTINO con le righe cambiate (prima → dopo).
 */
export async function salvaRevisione(a, listinoId, { righe: modifiche, motivo }, userId = null) {
  const base = await one('SELECT * FROM listini WHERE id=$1 AND account_id=$2', [listinoId, a.id]);
  if (!base) throw errore(404, 'Versione del listino non trovata');
  const cor = await corrente(a);
  if (cor && cor.id !== base.id) throw errore(400, `La revisione parte dalla versione corrente (v${cor.versione}), non dalla v${base.versione}`);
  const out = applicaRevisione(base.righe || [], modifiche);
  const versione = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM listini WHERE account_id=$1', [a.id])).v);
  const row = await one(`INSERT INTO listini (account_id, versione, filename, documento_id, note, mapping, intestazioni, righe, riepilogo, differenze, caricato_by, origine, base_listino_id)
    VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,'REVISIONE',$11) RETURNING id`,
  [a.id, versione, `Revisione della v${base.versione}`, motivo, JSON.stringify(base.mapping || {}), base.intestazioni ? JSON.stringify(base.intestazioni) : null,
    JSON.stringify(out.righe), JSON.stringify(out.riepilogo), JSON.stringify(out.differenze), userId, base.id]);
  await q('UPDATE accounts SET listino_corrente_id=NULL, sconto_medio=$2, updated_at=now() WHERE id=$1', [a.id, -Number(out.riepilogo.sconto_medio || 0) / 100]);
  const d = out.differenze;
  const testo = [`Motivo: ${motivo}`, `${d.cambiate.length} ${d.cambiate.length === 1 ? 'riga cambiata' : 'righe cambiate'} rispetto alla v${base.versione} (prima → dopo):`, testoRigheCambiate(d.cambiate),
    `Sconto medio ${pct(d.sconto_medio_prima)} → ${pct(d.sconto_medio_dopo)}; lo sconto medio dell'account segue la nuova versione.`].join('\n');
  await attivita(a.id, { tipo: 'LISTINO', sottotipo: 'REVISIONE', oggetto: `Revisione del listino/offerta: v${versione} dalla v${base.versione}`, testo, dati: { listino_id: row.id, versione, base_listino_id: base.id, cambiate: d.cambiate.length } }, userId);
  return { id: row.id, versione, base: base.versione, riepilogo: out.riepilogo, differenze: d, avvisi: out.avvisi };
}

/**
 * Email "Invia per la firma" della versione: oggetto e testo dal modello "Revisione dell'offerta economica" delle Impostazioni
 * (segnaposto {{cliente}}, {{versione}}, {{righe_cambiate}}, {{data}}), offerta economica PDF della versione da allegare.
 */
export async function emailRevisione(a, listinoId) {
  const l = await one('SELECT l.*, d.filename AS offerta_filename, d.size AS offerta_size FROM listini l LEFT JOIN documenti d ON d.id=l.offerta_documento_id WHERE l.id=$1 AND l.account_id=$2', [listinoId, a.id]);
  if (!l) throw errore(404, 'Versione del listino non trovata');
  if (!l.offerta_documento_id) throw errore(400, `Genera prima l'offerta economica della v${l.versione}`);
  const mod = await modelliFlusso();
  const valori = { cliente: a.org_name, versione: String(l.versione), righe_cambiate: testoRigheCambiate(l.differenze?.cambiate || []), data: dataBreve(todayRome()) };
  return {
    subject: compila(mod.revisione_oggetto, valori), testo: compila(mod.revisione_testo, valori),
    documento: { id: l.offerta_documento_id, filename: l.offerta_filename, size: l.offerta_size }, versione: l.versione, listino_id: l.id,
    inviata_at: l.revisione_inviata_at, firmata_at: l.firmata_at,
  };
}

/** Invio per la firma registrato sulla versione (dopo l'EMAIL_OUT sottotipo OFFERTA_REVISIONE). */
export async function segnaInviata(listinoId, activityId, stato) {
  if (stato === 'FALLITO') return;
  await q('UPDATE listini SET revisione_inviata_at=now(), revisione_activity_id=$2 WHERE id=$1', [listinoId, activityId]);
}

/** Versione a cui si riferisce un'offerta firmata in arrivo: l'ultima inviata per la firma e non ancora firmata, altrimenti la corrente. */
export async function versioneDaFirmare(a) {
  const inviata = await one('SELECT * FROM listini WHERE account_id=$1 AND revisione_inviata_at IS NOT NULL AND firmata_at IS NULL ORDER BY versione DESC LIMIT 1', [a.id]);
  return inviata || corrente(a);
}

/**
 * Offerta economica firmata ricevuta (caricata dalla scheda o riconosciuta da un allegato della casella): il documento prende l'etichetta
 * "Offerta economica vN firmata", la versione ha firmata_at e resta (o torna) la corrente; nel diario un'attività OFFERTA_ECONOMICA.
 * Nessuna contrattualizzazione: il contratto non cambia. Idempotente: una seconda firma della stessa versione si registra solo nel diario.
 */
export async function registraOffertaFirmata(a, listinoId, documentoId, { userId = null, fonte = 'caricamento' } = {}) {
  const l = await one('SELECT * FROM listini WHERE id=$1 AND account_id=$2', [listinoId, a.id]);
  if (!l) throw errore(404, 'Versione del listino non trovata');
  const doc = await one('SELECT * FROM documenti WHERE id=$1 AND account_id=$2', [documentoId, a.id]);
  if (!doc) throw errore(404, 'Documento non trovato');
  if (!(/pdf/i.test(doc.mime || '') || /\.pdf$/i.test(doc.filename || ''))) throw errore(400, 'L\'offerta firmata deve essere un PDF');
  const etichetta = `Offerta economica v${l.versione} firmata`;
  await q(`UPDATE documenti SET categoria='OFFERTA_ECONOMICA', etichetta=$2, da_verificare=FALSE, verificato_at=coalesce(verificato_at, now()), verificato_by=coalesce(verificato_by, $3) WHERE id=$1`, [doc.id, etichetta, userId]);
  if (doc.activity_id && !(await one('SELECT 1 FROM documenti WHERE activity_id=$1 AND da_verificare', [doc.activity_id]))) await q(`UPDATE activities SET esito='VERIFICATO' WHERE id=$1 AND esito='DA_VERIFICARE'`, [doc.activity_id]);
  if (l.firmata_at) {
    await attivita(a.id, { tipo: 'OFFERTA_ECONOMICA', sottotipo: 'OFFERTA_FIRMATA', oggetto: `${etichetta}: ricevuta di nuovo (${fonte})`, testo: `La v${l.versione} risultava già firmata: il PDF è tra i documenti, nient'altro cambia.`, dati: { listino_id: l.id, documento_id: doc.id } }, userId);
    return { gia: true, versione: l.versione, documento_id: doc.id };
  }
  await q('UPDATE listini SET firmata_at=now(), firmata_documento_id=$2, firmata_by=$3 WHERE id=$1', [l.id, doc.id, userId]);
  // la versione firmata resta la corrente: se non è l'ultima diventa la scelta manuale; lo sconto medio dell'account la segue
  const ultima = await one('SELECT max(versione)::int AS v FROM listini WHERE account_id=$1', [a.id]);
  await q('UPDATE accounts SET listino_corrente_id=$2, sconto_medio=$3, updated_at=now() WHERE id=$1', [a.id, ultima.v === l.versione ? null : l.id, -Number(l.riepilogo?.sconto_medio || 0) / 100]);
  const act = await attivita(a.id, { tipo: 'OFFERTA_ECONOMICA', sottotipo: 'OFFERTA_FIRMATA', oggetto: `${etichetta} ricevuta (${fonte})`,
    testo: [`${doc.filename} tra i documenti dell'account. La v${l.versione} è la versione corrente del listino.`, 'Firma della sola offerta economica: non avvia la contrattualizzazione e non modifica il contratto.'].join('\n'),
    dati: { listino_id: l.id, versione: l.versione, documento_id: doc.id } }, userId);
  if (!doc.activity_id) await q('UPDATE documenti SET activity_id=$2 WHERE id=$1', [doc.id, act.id]);
  return { gia: false, versione: l.versione, documento_id: doc.id };
}
