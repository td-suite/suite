// Ricerca prospect · verifica della partita IVA sul servizio pubblico VIES della Commissione europea: dice se la partita IVA è attiva e,
// per l'Italia, riporta denominazione e indirizzo dichiarati al fisco. Nessuna chiave. DA COLLAUDARE IN PRODUZIONE: l'ambiente di
// sviluppo non raggiunge il servizio; se la risposta non ha la forma attesa la funzione lo dice, senza inventare nulla.
import { pivaValida } from './estrai.js';

const URL_VIES = () => process.env.SCOUTING_VIES_URL || 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat';
export async function verificaPiva(piva, { fetchFn = fetch } = {}) {
  const p = String(piva || '').replace(/^IT/i, '').replace(/\D/g, '');
  if (!pivaValida(p)) return { ok: false, errore: 'Partita IVA non valida (cifra di controllo)' };
  try {
    const r = await fetchFn(`${URL_VIES()}/${p}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, errore: `Il servizio VIES ha risposto ${r.status}` };
    const j = await r.json();
    if (typeof j?.isValid !== 'boolean') return { ok: false, errore: 'Risposta del servizio VIES non riconosciuta' };
    const pulito = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t && t !== '---' ? t : null; };
    return { ok: true, piva: p, attiva: j.isValid, denominazione: pulito(j.name), indirizzo: pulito(String(j.address || '').replace(/\n/g, ', ')), fonte: 'VIES (Commissione europea)', verificata_at: new Date().toISOString() };
  } catch (e) { return { ok: false, errore: `Servizio VIES non raggiungibile (${e.name === 'TimeoutError' ? 'tempo scaduto' : e.message})` }; }
}
