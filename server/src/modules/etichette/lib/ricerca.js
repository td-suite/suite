// Label · ricerca delle accettazioni.
// (a) Numero di accettazione o barcode del campione (il testo contiene cifre): ricerca nella copia Synclab con la stessa funzione del Desk
//     NC (nc/lib/synclabDesk.js cercaAccettazioniSynclab: esatta, normalizzata, anno + numero; riuso, non copia); poi le letture dirette
//     già fatte; se nulla, la chiamata diretta al gestionale GET /api/v1/data/requests?requestNumber=… poi ?sampleBarcode=… (confronto
//     esatto, proiezione opt-in per avere subito il paziente), con il 202 della cattura gestito con un'attesa breve: così si trova anche
//     un'accettazione fatta due minuti fa, prima del delta di giorno.
// (b) Cognome (almeno 2 lettere, anche parziale: inizio del cognome; "cognome nome" filtra anche il nome) e data facoltativa: SOLO sulle
//     identità recenti (etichette.pazienti_recenti).
// I risultati sono limitati al perimetro di sedi dell'utente (client Synclab → sede con synclab.clients_td; ADMIN tutto).
import { one, many, q } from '../db.js';
import { pagina, attendi, metadata } from '../../../lib/synclab/client.js';
import { cercaAccettazioniSynclab, normCodice } from '../../nc/lib/synclabDesk.js';
import { config } from '../config.js';
import { dataApiAttiva } from './core.js';
import { righeRisultato, senzaPaziente } from './accettazioni.js';
import { salvaIdentita } from './identita.js';

/** Tipo di ricerca dal testo: CODICE (contiene cifre), COGNOME (solo lettere, almeno 2), null (troppo corto). */
export function tipoRicerca(testo) {
  const v = String(testo ?? '').trim();
  if (!v) return null;
  if (/\d/.test(v)) return 'CODICE';
  return v.replace(/[^\p{L}]/gu, '').length >= 2 ? 'COGNOME' : null;
}
/** Normalizzazione per il confronto dei nomi: minuscolo, senza accenti, apostrofi e spazi multipli. */
export const normNome = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
export const SQL_NORM = (c) => `regexp_replace(regexp_replace(translate(lower(coalesce(${c}, '')), 'àáâäãèéêëìíîïòóôöõùúûüçñ''’\`', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z ]', ' ', 'g'), ' +', ' ', 'g')`;

/** Filtra le righe per perimetro: { visibili, fuori } (fuori = quante nascoste, senza dettagli). */
export function perPerimetro(righe, ctx) {
  const visibili = righe.filter((r) => ctx.vede(r.site_id));
  return { visibili, fuori: righe.length - visibili.length };
}

/** Lettura diretta dal gestionale con un filtro esatto (requestNumber | sampleBarcode): elementi `requests` opt-in (con paziente). */
export async function letturaDiretta(filtri, { attesaMs = config.attesaDirettaMs } = {}) {
  const t0 = Date.now();
  const opz = { includePatient: true, pageSize: 5, filtri, timeoutMs: 15000 };
  let r = await pagina('requests', opz);
  while (r.status === 202) {
    const ra = Math.max(0.2, Number(r.retryAfter) || 2) * 1000;
    if (Date.now() - t0 + ra > attesaMs) throw Object.assign(new Error('Il gestionale sta ancora preparando la risposta: riprova tra qualche secondo'), { code: 'ATTESA' });
    await attendi(ra);
    r = await pagina('requests', { ...opz, cursor: r.nextCursor });
  }
  return Array.isArray(r.data?.items) ? r.data.items : [];
}

/** Salva una lettura diretta (senza paziente) e l'identità; ritorna la chiave [instance_id, id]. */
async function salvaDiretta(instanceId, x) {
  await q(`INSERT INTO accettazioni_dirette (instance_id, id, request_number, data, client_id, raw, letto_il) VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (instance_id, id) DO UPDATE SET request_number = EXCLUDED.request_number, data = EXCLUDED.data, client_id = EXCLUDED.client_id, raw = EXCLUDED.raw, letto_il = now()`,
  [instanceId, String(x.id), x.requestNumber ?? null, /^\d{4}-\d{2}-\d{2}/.test(String(x.date || '')) ? String(x.date).slice(0, 10) : null, x.clientId ?? null, JSON.stringify(senzaPaziente(x))]);
  await salvaIdentita(instanceId, x);
  return [instanceId, String(x.id)];
}

let istanzaCache = null;
async function istanza() {
  const r = await one(`SELECT instance_id FROM synclab.sync_scope ORDER BY updated_at DESC LIMIT 1`).catch(() => null);
  if (r?.instance_id) return r.instance_id;
  if (!istanzaCache) istanzaCache = (await metadata())?.instanceId || null;
  return istanzaCache;
}

/**
 * Ricerca per numero o barcode. Ritorna { tipo: 'CODICE', fonte, passo, risultati, fuori, messaggio? }.
 * fonte: COPIA (copia Synclab), GESTIONALE (lettura diretta, ora o nei giorni scorsi), NESSUNA.
 */
export async function cercaCodice(testo, ctx, { diretta = true } = {}) {
  const v = String(testo ?? '').trim();
  const { passo, candidati } = await cercaAccettazioniSynclab(v);
  if (candidati.length) {
    const { visibili, fuori } = perPerimetro(await righeRisultato(candidati.map((c) => [c.instance_id, c.id])), ctx);
    return { tipo: 'CODICE', fonte: 'COPIA', passo, risultati: visibili, fuori };
  }
  // letture dirette già fatte (numero esatto o normalizzato, oppure barcode di un campione)
  const n = normCodice(v);
  const gia = await many(`SELECT instance_id, id FROM accettazioni_dirette d WHERE d.request_number = $1 OR regexp_replace(upper(coalesce(d.request_number, '')), '[[:space:]/._\\\\-]+', '', 'g') = $2
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.raw->'samples') = 'array' THEN d.raw->'samples' ELSE '[]'::jsonb END) s WHERE s->>'barcode' = $1)
      ORDER BY d.letto_il DESC LIMIT 20`, [v, n]);
  if (gia.length) {
    const { visibili, fuori } = perPerimetro(await righeRisultato(gia.map((c) => [c.instance_id, c.id])), ctx);
    return { tipo: 'CODICE', fonte: 'GESTIONALE', passo: 'LETTURA_DIRETTA', risultati: visibili, fuori };
  }
  if (!diretta) return { tipo: 'CODICE', fonte: 'NESSUNA', passo: null, risultati: [], fuori: 0 };
  const da = await dataApiAttiva();
  if (!da.ok) return { tipo: 'CODICE', fonte: 'NESSUNA', passo: null, risultati: [], fuori: 0, messaggio: `Nessuna accettazione con questo numero o barcode nella copia Synclab; la ricerca diretta nel gestionale non è disponibile (${da.motivo})` };
  try {
    const inst = await istanza();
    if (!inst) return { tipo: 'CODICE', fonte: 'NESSUNA', passo: null, risultati: [], fuori: 0, messaggio: 'Istanza Synclab sconosciuta: eseguire prima una sincronizzazione' };
    let items = await letturaDiretta({ requestNumber: v });
    let via = 'NUMERO';
    if (!items.length) { items = await letturaDiretta({ sampleBarcode: v }); via = 'BARCODE'; }
    if (!items.length) return { tipo: 'CODICE', fonte: 'NESSUNA', passo: null, risultati: [], fuori: 0, messaggio: 'Nessuna accettazione con questo numero o barcode, né nella copia Synclab né nel gestionale' };
    const chiavi = [];
    for (const x of items.slice(0, 5)) chiavi.push(await salvaDiretta(inst, x));
    const { visibili, fuori } = perPerimetro(await righeRisultato(chiavi), ctx);
    return { tipo: 'CODICE', fonte: 'GESTIONALE', passo: via === 'NUMERO' ? 'GESTIONALE_NUMERO' : 'GESTIONALE_BARCODE', risultati: visibili, fuori };
  } catch (e) {
    return { tipo: 'CODICE', fonte: 'NESSUNA', passo: null, risultati: [], fuori: 0, messaggio: e.code === 'ATTESA' ? e.message : `Ricerca nel gestionale non riuscita: ${String(e.message || e).slice(0, 160)}` };
  }
}

/** Ricerca per cognome (inizio del cognome; seconda parola = inizio del nome) e data facoltativa, solo sulle identità recenti. */
export async function cercaCognome(testo, ctx, { data = null } = {}) {
  const parole = normNome(testo).split(' ').filter(Boolean);
  if (!parole.length || parole.join('').length < 2) return { tipo: 'COGNOME', fonte: 'IDENTITA', risultati: [], fuori: 0, messaggio: 'Scrivi almeno 2 lettere del cognome' };
  // "cognome nome": la prima parola sul cognome; se il cognome ha più parole (De Luca) si prova anche tutto il testo sul cognome
  const tutto = parole.join(' ');
  const [cog, ...resto] = parole;
  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? data : null;
  const rows = await many(`SELECT p.instance_id, p.request_id FROM pazienti_recenti p
     WHERE (p.cognome IS NOT NULL OR p.nome IS NOT NULL)
       AND (${SQL_NORM('p.cognome')} LIKE $1 || '%' OR (${SQL_NORM('p.cognome')} LIKE $2 || '%' AND ($3 = '' OR ${SQL_NORM('p.nome')} LIKE $3 || '%')))
       AND ($4::date IS NULL OR p.data_accettazione = $4::date)
     ORDER BY p.data_accettazione DESC NULLS LAST, p.cognome, p.nome LIMIT 200`, [tutto, cog, resto.join(' '), dataOk]);
  const { visibili, fuori } = perPerimetro(await righeRisultato(rows.map((r) => [r.instance_id, r.request_id])), ctx);
  return { tipo: 'COGNOME', fonte: 'IDENTITA', risultati: visibili.slice(0, 50), fuori, troppi: visibili.length > 50 };
}
