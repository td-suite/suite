// Label · identità recenti dei pazienti (decisione del CEO del 10/11/2026: "identità conservata solo per gli ultimi giorni").
// La proiezione paziente globale di Synclab resta SPENTA (impostazione include_patient del connettore: qui non si legge né si tocca):
// le identità arrivano dal dettaglio opt-in di UNA accettazione alla volta (GET /api/v1/data/requests/{id}?includePatient=true,
// client.js `dettaglio`) e finiscono SOLO in etichette.pazienti_recenti: cognome, nome, nascita, sesso. Il codice fiscale non si salva.
// Job `etichette:identita` ogni 15 minuti tra le 6 e le 22 (ora di Roma): per le accettazioni ATTIVE degli ultimi N giorni (impostazione
// giorni_identita, predefinito 7, massimo 30) dei client abbinati a una sede della Suite, senza identità, al più 30 chiamate per giro
// (dentro le 60 al minuto del contratto: il limitatore di client.js è comune a tutta la Suite); purga quotidiana delle righe più vecchie
// di N giorni. Nessun nome nei log: nel registro dei connettori il percorso è /api/v1/data/requests/{id} senza query.
import { q, one, many } from '../db.js';
import { dettaglio } from '../../../lib/synclab/client.js';
import { getModuleState } from '../../../lib/modules.js';
import { config } from '../config.js';
import { KEY, settings, dataApiAttiva, oggiRoma, oraRoma, isoData } from './core.js';

const testo = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
const dataValida = (v) => { const d = isoData(v); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '1900-01-01' ? d : null; };

/**
 * Salva l'identità di un elemento `requests` della Data API (dettaglio o lista opt-in). Senza paziente salva una riga vuota (letta,
 * senza paziente: il job non la richiede di nuovo per N giorni). Il codice fiscale non si salva mai. Ritorna la riga.
 */
export async function salvaIdentita(instanceId, d) {
  const p = d?.patient && typeof d.patient === 'object' ? d.patient : null;
  return one(`INSERT INTO pazienti_recenti (instance_id, request_id, request_number, data_accettazione, cognome, nome, nascita, sesso, cf, letto_il)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,now())
              ON CONFLICT (instance_id, request_id) DO UPDATE SET request_number = EXCLUDED.request_number, data_accettazione = EXCLUDED.data_accettazione,
                cognome = EXCLUDED.cognome, nome = EXCLUDED.nome, nascita = EXCLUDED.nascita, sesso = EXCLUDED.sesso, cf = NULL, letto_il = now()
              RETURNING instance_id, request_id, request_number, data_accettazione::text AS data_accettazione, cognome, nome, nascita::text AS nascita, sesso, letto_il`,
  [instanceId, String(d.id), testo(d.requestNumber, 60), dataValida(d.date), testo(p?.lastName, 80), testo(p?.firstName, 80), dataValida(p?.birthDate), testo(d.demographics?.sex, 10)]);
}

export const identitaDi = (instanceId, requestId) => one(`SELECT instance_id, request_id, request_number, data_accettazione::text AS data_accettazione, cognome, nome, nascita::text AS nascita, sesso, letto_il
  FROM pazienti_recenti WHERE instance_id = $1 AND request_id = $2`, [instanceId, String(requestId)]);

// Apertura di un'accettazione senza identità: al più una chiamata per accettazione ogni 2 minuti (memoria del processo)
const ultimaApertura = new Map();
export const azzeraAperture = () => ultimaApertura.clear();   // per i test
export const INTERVALLO_APERTURA_MS = 2 * 60 * 1000;

/**
 * Identità per l'apertura di un'accettazione: dalla tabella, altrimenti (Data API accesa) una chiamata al dettaglio opt-in.
 * Ritorna { identita, esito: PRESENTE | LETTA | SENZA_PAZIENTE | DISATTIVATA | ATTESA | NON_TROVATA | ERRORE, messaggio? }. Mai eccezioni.
 */
export async function identitaPerApertura(instanceId, requestId, { numero = null } = {}) {
  const gia = await identitaDi(instanceId, requestId);
  if (gia?.cognome || gia?.nome) return { identita: gia, esito: 'PRESENTE' };
  const da = await dataApiAttiva();
  if (!da.ok) return { identita: null, esito: 'DISATTIVATA', messaggio: `Nome del paziente non disponibile: ${da.motivo}` };
  const k = `${instanceId}|${requestId}`;
  const prima = ultimaApertura.get(k);
  if (prima && Date.now() - prima < INTERVALLO_APERTURA_MS) return { identita: gia, esito: gia ? 'SENZA_PAZIENTE' : 'ATTESA', messaggio: 'Il gestionale è appena stato interrogato per questa accettazione: riprova tra un paio di minuti' };
  ultimaApertura.set(k, Date.now());
  try {
    const d = await dettaglio('requests', requestId, { includePatient: true });
    if (!d) return { identita: null, esito: 'NON_TROVATA', messaggio: 'Il gestionale non restituisce l\'accettazione (assente o esclusa)' };
    if (String(d.id) !== String(requestId) && (!numero || String(d.requestNumber ?? '') !== String(numero))) return { identita: null, esito: 'ERRORE', messaggio: 'Il dettaglio del gestionale non corrisponde all\'accettazione: nessun dato salvato' };
    const r = await salvaIdentita(instanceId, { ...d, id: requestId });
    return r.cognome || r.nome ? { identita: r, esito: 'LETTA' } : { identita: null, esito: 'SENZA_PAZIENTE', messaggio: 'Il gestionale non ha restituito i dati del paziente per questa accettazione' };
  } catch (e) {
    return { identita: null, esito: 'ERRORE', messaggio: `Il gestionale non ha risposto: ${String(e.message || e).slice(0, 160)}` };
  }
}

/** Purga: identità e letture dirette più vecchie di N giorni (data di lettura o dell'accettazione); letture dirette già nella copia. */
export async function purga(giorni) {
  const n = Math.max(1, Math.min(30, Number(giorni) || 7));
  const a = await q(`DELETE FROM pazienti_recenti WHERE letto_il < now() - make_interval(days => $1::int) OR data_accettazione < (now() AT TIME ZONE 'Europe/Rome')::date - $1::int`, [n]);
  const b = await q(`DELETE FROM accettazioni_dirette d WHERE d.letto_il < now() - make_interval(days => $1::int) OR d.data < (now() AT TIME ZONE 'Europe/Rome')::date - $1::int
                       OR EXISTS (SELECT 1 FROM synclab.requests r WHERE r.instance_id = d.instance_id AND r.id = d.id AND r.deleted_at IS NULL)`, [n]);
  // Lab Control (v0.71.0): letture puntuali "Aggiorna dal gestionale" (senza paziente) più vecchie di N giorni o superate dalla copia
  const c = await q(`DELETE FROM lc_letture l WHERE l.letto_il < now() - make_interval(days => $1::int)
                       OR EXISTS (SELECT 1 FROM synclab.requests r WHERE r.instance_id = l.instance_id AND r.id = l.id AND r.updated_at > l.letto_il)`, [n]).catch(() => ({ rowCount: 0 }));
  return { identita: a.rowCount, letture_dirette: b.rowCount, letture_puntuali: c.rowCount };
}

async function salvaStato(patch) {
  const cols = Object.keys(patch);
  await q(`INSERT INTO job_stato (nome, ${cols.join(',')}) VALUES ('identita', ${cols.map((_, i) => `$${i + 1}`).join(',')})
           ON CONFLICT (nome) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`, Object.values(patch).map((v) => (v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)));
}
export const statoJob = () => one(`SELECT nome, ultimo_giro, ultimo_ok, ultima_purga::text AS ultima_purga, esito, errore FROM job_stato WHERE nome = 'identita'`);

/** Accettazioni candidate: ATTIVE, degli ultimi N giorni, di client abbinati a una sede, senza identità (più recenti prima). */
export async function candidati(giorni, limite) {
  return many(`SELECT r.instance_id, r.id, r.request_number FROM synclab.requests r
      JOIN synclab.clients_td ct ON ct.instance_id = r.instance_id AND ct.client_id = r.client_id AND ct.site_id IS NOT NULL
     WHERE r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.date >= (now() AT TIME ZONE 'Europe/Rome')::date - $1::int
       AND NOT EXISTS (SELECT 1 FROM pazienti_recenti p WHERE p.instance_id = r.instance_id AND p.request_id = r.id)
     ORDER BY r.date DESC, r.created_at_local DESC NULLS LAST, r.id LIMIT $2::int`, [giorni, limite]);
}

/**
 * Un giro del job. opz: { forza (ignora l'orario), max (chiamate), adesso (Date, per i test) }. Ritorna l'esito (anche salvato in
 * job_stato): { skipped?, motivo?, chiamate, salvate, senza_paziente, errori, purga? }.
 */
export async function giroIdentita({ forza = false, max = config.maxChiamateGiro, adesso = new Date() } = {}) {
  if ((await getModuleState(KEY)).mode !== 'LIVE') return { skipped: true, motivo: 'modulo non LIVE' };
  const h = oraRoma(adesso);
  if (!forza && (h < config.oraInizio || h >= config.oraFine)) return { skipped: true, motivo: `fuori orario (${config.oraInizio}-${config.oraFine})` };
  const da = await dataApiAttiva();
  if (!da.ok) { await salvaStato({ ultimo_giro: adesso, esito: { skipped: true, motivo: da.motivo }, errore: null }); return { skipped: true, motivo: da.motivo }; }
  const imp = await settings();
  const out = { chiamate: 0, salvate: 0, senza_paziente: 0, non_trovate: 0, errori: 0 };
  const st = await statoJob();
  if (st?.ultima_purga !== oggiRoma(adesso)) { out.purga = await purga(imp.giorni_identita); await salvaStato({ ultima_purga: oggiRoma(adesso) }); }
  let errore = null;
  let consecutivi = 0;
  for (const c of await candidati(imp.giorni_identita, Math.max(0, Math.min(config.maxChiamateGiro, Number(max) || 0)))) {
    out.chiamate++;
    try {
      const d = await dettaglio('requests', c.id, { includePatient: true });
      if (!d) { out.non_trovate++; await salvaIdentita(c.instance_id, { id: c.id, requestNumber: c.request_number }); continue; }
      const r = await salvaIdentita(c.instance_id, { ...d, id: c.id });
      if (r.cognome || r.nome) out.salvate++; else out.senza_paziente++;
      consecutivi = 0;
    } catch (e) {
      out.errori++;
      errore = String(e.message || e).slice(0, 300);
      if (++consecutivi >= 3) break;   // gestionale in difficoltà: il prossimo giro riprova
    }
  }
  const ok = out.errori === 0 || out.errori < out.chiamate;
  await salvaStato({ ultimo_giro: adesso, ...(ok ? { ultimo_ok: adesso } : {}), esito: out, errore: ok ? null : errore });
  return out;
}
