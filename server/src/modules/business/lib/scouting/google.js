// Ricerca prospect · GOOGLE PLACES, ricerca "dal vivo". Regola di Google (Places API Policies, verificata il 16/11/2026): dei contenuti
// dell'API si può conservare SOLO l'identificativo del luogo (place ID). Perciò i risultati si mostrano a chi cerca e NON si salvano;
// quando una struttura viene scelta la Suite conserva il place ID e legge il sito della struttura: nome, partita IVA, recapiti e
// persone arrivano da lì, cioè dal sito dell'azienda, non da Google. È un servizio a pagamento a consumo sul conto Google di TD.
// Chiave: connettore GOOGLE (Amministrazione > Connettori) oppure la chiave server di Google Maps già usata dalla Suite.
import { getConnector, logConnector } from '../../../../lib/connectors.js';
import { PROVINCE } from './scoperta.js';

const CAMPI = 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.businessStatus,nextPageToken';
/** Ricerca testuale: { luoghi: [{ id, nome, indirizzo, sito, telefono, tipo }], altre } — solo per la visualizzazione immediata */
export async function cercaGoogle(testo, { provincia = null, pagine = 2, fetchFn = fetch } = {}) {
  const c = await getConnector('GOOGLE');
  const chiave = c.credentials.api_key;
  if (!chiave) throw Object.assign(new Error('Chiave Google non impostata: inseriscila in Amministrazione > Connettori > Google Places (deve avere "Places API (New)" abilitata)'), { status: 400 });
  const base = String(c.base_url || 'https://places.googleapis.com').replace(/\/+$/, '');
  const query = `${String(testo).trim()}${provincia && PROVINCE[provincia] ? ` provincia di ${PROVINCE[provincia]}` : ''}`;
  const luoghi = []; let token = null; let altre = false;
  for (let i = 0; i < Math.max(1, Math.min(3, pagine)); i += 1) {
    const t0 = Date.now(); let r; let j = null;
    try {
      r = await fetchFn(`${base}/v1/places:searchText`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': chiave, 'X-Goog-FieldMask': CAMPI },
        body: JSON.stringify({ textQuery: query, languageCode: 'it', regionCode: 'IT', pageSize: 20, ...(token ? { pageToken: token } : {}) }), signal: AbortSignal.timeout(20_000) });
      j = await r.json().catch(() => null);
    } catch (e) { await logConnector({ kind: 'GOOGLE', direction: 'OUT', module: 'business', endpoint: 'POST places:searchText', status: 'ERRORE', ms: Date.now() - t0, message: e.message }); throw new Error(`Google non raggiungibile (${e.name === 'TimeoutError' ? 'nessuna risposta in tempo' : e.cause?.code || e.message})`); }
    await logConnector({ kind: 'GOOGLE', direction: 'OUT', module: 'business', endpoint: 'POST places:searchText', status: r.ok ? 'OK' : 'ERRORE', ms: Date.now() - t0, message: r.ok ? null : String(j?.error?.message || r.status).slice(0, 200) });
    if (!r.ok) {
      const m = String(j?.error?.message || `risposta ${r.status}`);
      throw Object.assign(new Error(`Google: ${/has not been used|is disabled|not enabled|SERVICE_DISABLED/i.test(m) ? 'sulla chiave non è abilitata "Places API (New)": abilitala nella console Google Cloud del progetto' : /API key not valid|API_KEY_INVALID/i.test(m) ? 'chiave non valida' : /billing/i.test(m) ? 'fatturazione non attiva sul progetto Google Cloud' : m.slice(0, 200)}`), { status: 400 });
    }
    for (const p of j?.places || []) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      luoghi.push({ id: p.id, nome: p.displayName?.text || '', indirizzo: p.formattedAddress || '', sito: p.websiteUri || null, telefono: p.nationalPhoneNumber || null, tipo: p.primaryTypeDisplayName?.text || null });
    }
    token = j?.nextPageToken || null; altre = Boolean(token);
    if (!token) break;
  }
  return { luoghi, altre, query };
}
