// Non conformità · recupero PUNTUALE del paziente dal gestionale (Synclab Data API), decisione del CEO del 09/11/2026 sera:
// la proiezione paziente in massa resta spenta (nessuna identità nella copia synclab); quando una NC ha bisogno del paziente e la cache
// delle accettazioni non lo ha (paziente_cognome vuoto) e ServiceNET non risponde o non trova l'accettazione, si cerca l'accettazione
// nella copia Synclab per numero (synclab.requests.request_number) o per barcode del campione (synclab.samples.barcode), si prende l'id
// opaco e si legge UNA accettazione con GET /api/v1/data/requests/{id}?includePatient=true (client.js dettaglio).
// Regole:
//  - cognome, nome, data di nascita, sesso (demografia del record) e codice fiscale finiscono SOLO nella cache delle accettazioni di NC,
//    con la stessa funzione di merge di ServiceNET (lis.upsertAccettazione); nulla si salva nelle tabelle synclab;
//  - al più una chiamata per accettazione ogni 10 minuti (memoria del processo), per restare dentro le 60 chiamate al minuto;
//  - Data API spenta (connettore StudioLAB non attivo, non in CLIENT_JWT o data_api_enabled off) → nessuna chiamata, messaggio chiaro;
//  - più accettazioni Synclab con lo stesso numero/barcode → nessuna scelta a caso: messaggio, nessuna scrittura;
//  - il dettaglio deve corrispondere (stesso numero di accettazione o un campione con quel barcode), altrimenti nessuna scrittura;
//  - registro: riga di audit di NC "Paziente recuperato dal gestionale per la NC …" SENZA il nome; nel registro dei connettori il
//    percorso è /api/v1/data/requests/{id} senza query (client.js). Nessun dato del paziente nei log.
import { one, many } from '../db.js';
import { getConnector } from '../../../lib/connectors.js';
import { dettaglio } from '../../../lib/synclab/client.js';
import { upsertAccettazione, logEvento } from './lis.js';

export const INTERVALLO_MS = 10 * 60 * 1000;
const ultimaChiamata = new Map();   // id accettazione → ms dell'ultima chiamata al gestionale
export const azzeraLimite = () => ultimaChiamata.clear();   // per i test

/** La Data API è utilizzabile per il recupero puntuale? { ok, motivo } */
export async function dataApiAttiva() {
  const c = await getConnector('STUDIOLAB').catch(() => null);
  if (!c || !c.active) return { ok: false, motivo: 'Connettore StudioLAB non attivo (Amministrazione > Connettori)' };
  if (c.auth_kind !== 'CLIENT_JWT') return { ok: false, motivo: 'Il connettore StudioLAB non usa il client registrato (CLIENT_JWT) richiesto dalla Data API' };
  const st = c.settings || {};
  if (!(st.data_api_enabled === true || st.data_api_enabled === 'true')) return { ok: false, motivo: 'Data API Synclab disabilitata (Amministrazione > Connettori > StudioLAB > Dati Synclab)' };
  return { ok: true };
}

/** Accettazioni della copia Synclab con quel numero o quel barcode: [{ instance_id, id, request_number, via }] (al più 3). */
export async function cercaInCopia(numero) {
  const v = String(numero || '').trim();
  if (!v) return [];
  return many(`SELECT DISTINCT ON (instance_id, id) instance_id, id, request_number, via FROM (
      SELECT r.instance_id, r.id, r.request_number, 'NUMERO' AS via, (r.disponibilita = 'ATTIVO') AS attiva, r.updated_at FROM synclab.requests r WHERE r.request_number = $1 AND r.deleted_at IS NULL
      UNION ALL
      SELECT r.instance_id, r.id, r.request_number, 'BARCODE' AS via, (r.disponibilita = 'ATTIVO') AS attiva, r.updated_at FROM synclab.samples s
        JOIN synclab.requests r ON r.instance_id = s.instance_id AND r.id = s.request_id WHERE s.barcode = $1 AND r.deleted_at IS NULL) t
    ORDER BY instance_id, id, (via = 'NUMERO') DESC LIMIT 3`, [v]).catch(() => []);
}

const sessoDa = (v) => { const s = String(v ?? '').trim().toUpperCase(); return s ? s.slice(0, 10) : undefined; };

/**
 * Recupera il paziente di un'accettazione già in cache (riga di nc.accettazioni). opz: { forza, ncCodice, ncId, req, motivoLis }.
 * Ritorna { esito, messaggio, accettazione? } con esito in: PRESENTE (c'era già), RECUPERATO, DISATTIVATA, NON_IN_COPIA, AMBIGUA,
 * NON_TROVATA (il gestionale non ha restituito il dettaglio), SENZA_PAZIENTE, ATTESA (limite dei 10 minuti), ERRORE. Mai eccezioni.
 */
export async function recuperaPaziente(acc, { ncCodice = null, ncId = null, req = null, audit = null } = {}) {
  if (!acc?.id) return { esito: 'ERRORE', messaggio: 'Accettazione non indicata' };
  if (acc.paziente_cognome) return { esito: 'PRESENTE', messaggio: 'Il paziente è già nella scheda dell\'accettazione' };
  const da = await dataApiAttiva();
  if (!da.ok) return { esito: 'DISATTIVATA', messaggio: `Recupero del paziente dal gestionale non disponibile: ${da.motivo}` };
  const trovate = await cercaInCopia(acc.id);
  if (!trovate.length) return { esito: 'NON_IN_COPIA', messaggio: `L'accettazione ${acc.id} non è nella copia Synclab della Suite (numero o barcode): il paziente va inserito a mano o attende HL7/ServiceNET` };
  if (trovate.length > 1) return { esito: 'AMBIGUA', messaggio: `Più accettazioni Synclab corrispondono a ${acc.id}: nessun recupero automatico, verificare in StudioLAB` };
  const t = trovate[0];
  const ora = Date.now();
  const prima = ultimaChiamata.get(acc.id);
  if (prima && ora - prima < INTERVALLO_MS) {
    const min = Math.ceil((INTERVALLO_MS - (ora - prima)) / 60000);
    return { esito: 'ATTESA', messaggio: `Il gestionale è già stato interrogato per questa accettazione: nuovo tentativo possibile tra ${min} minut${min === 1 ? 'o' : 'i'}` };
  }
  ultimaChiamata.set(acc.id, ora);
  let d;
  try { d = await dettaglio('requests', t.id, { includePatient: true }); }
  catch (e) {
    await logEvento('SYNCLAB', 'ERRORE', { accettazioneId: acc.id, dettaglio: `dettaglio accettazione (includePatient): ${e.status || ''} ${e.code || e.tipo || ''}`.trim() });
    return { esito: 'ERRORE', messaggio: `Il gestionale non ha risposto: ${String(e.message || e).slice(0, 200)}` };
  }
  if (!d) {
    await logEvento('SYNCLAB', 'ERRORE', { accettazioneId: acc.id, dettaglio: 'dettaglio accettazione: 404 (assente o esclusa)' });
    return { esito: 'NON_TROVATA', messaggio: `Il gestionale non restituisce l'accettazione ${acc.id} (assente o esclusa)` };
  }
  const corrisponde = String(d.requestNumber ?? '') === String(acc.id) || (Array.isArray(d.samples) && d.samples.some((s) => String(s?.barcode ?? '') === String(acc.id)));
  if (!corrisponde) return { esito: 'ERRORE', messaggio: 'Il dettaglio restituito dal gestionale non corrisponde all\'accettazione: nessun dato scritto' };
  const p = d.patient && typeof d.patient === 'object' ? d.patient : null;
  if (!p || !(p.lastName || p.firstName)) {
    await logEvento('SYNCLAB', 'OK', { accettazioneId: acc.id, dettaglio: 'dettaglio letto, nessun paziente nella proiezione' });
    return { esito: 'SENZA_PAZIENTE', messaggio: 'Il gestionale non ha restituito i dati del paziente per questa accettazione' };
  }
  const row = await upsertAccettazione({
    id: acc.id,
    paziente_cognome: p.lastName ? String(p.lastName) : undefined, paziente_nome: p.firstName ? String(p.firstName) : undefined,
    paziente_nascita: p.birthDate ? String(p.birthDate).slice(0, 10) : undefined, paziente_sesso: sessoDa(d.demographics?.sex), paziente_cf: p.fiscalCode ? String(p.fiscalCode) : undefined,
  }, acc.origine);
  await logEvento('SYNCLAB', 'OK', { accettazioneId: acc.id, dettaglio: `paziente recuperato dal gestionale (ricerca per ${t.via === 'NUMERO' ? 'numero' : 'barcode'})` });
  if (audit && req) await audit(req, 'ACC_PAZIENTE_SYNCLAB', { entity: 'accettazione', entityId: acc.id, ncId, label: `Paziente recuperato dal gestionale per la NC ${ncCodice || `in compilazione sull'accettazione ${acc.id}`}`, data: { fonte: 'Synclab Data API', ricerca: t.via } });
  return { esito: 'RECUPERATO', messaggio: 'Paziente recuperato dal gestionale (Synclab)', accettazione: row };
}

/** Codice e id della NC aperta più recente sull'accettazione (per la riga di audit), se c'è. */
export const ncDellAccettazione = (id) => one(`SELECT id, codice FROM nc WHERE accettazione_id = $1 AND stato <> 'ANNULLATA' ORDER BY opened_at DESC LIMIT 1`, [id]).catch(() => null);
