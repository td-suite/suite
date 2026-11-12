// Lab Control (chiave `etichette`, già Label) · funzioni comuni: impostazioni, contesto dell'utente (profilo e perimetro di sedi), Data
// API, date, avviso di validazione delle etichette.
import { q, one, many } from '../db.js';
import { forbidden } from '../../../lib/util.js';
import { dataApiAttiva } from '../../nc/lib/pazienteSynclab.js';   // stessa regola del recupero puntuale di NC (riuso, non copia)

export const KEY = 'etichette';
export { dataApiAttiva };

// ---------------------------------------------------------------- impostazioni
export const DEFAULTS = {
  giorni_identita: 7,          // identità recenti conservate per N giorni (max 30): ricerca per cognome e stampa
  etichetta_richiesta: false,  // oltre alle etichette dei campioni, un'etichetta "richiesta" senza barcode
  // Lab Control (v0.71.0)
  ore_ritardo: 72,             // accettazione in corso oltre N ore dall'accettazione senza referto pronto = in ritardo
  soglie_fase: {},             // { "18": 24, ... } ore massime dall'ultimo aggiornamento del gestionale in quello stato (vuoto = spente)
  ore_campioni: 24,            // campioni raccolti e non arrivati (check-in) da più di N ore
  giorni_finestra: 60,         // finestra (giorni) per "in lavorazione ora", ritardi e campioni in viaggio: le accettazioni più vecchie non contano
  colonne_predefinite: null,   // colonne dell'elenco accettazioni per chi non le ha scelte (null = tutte)
};
export const GIORNI_MAX = 30;
export const STATI_SOGLIA = [15, 18, 20, 25];
export const COLONNE = ['numero', 'data', 'cliente', 'sede', 'paziente', 'tipo', 'esami', 'campioni', 'fase', 'aggiornata', 'valore', 'fattura', 'nc', 'ritardo'];
const intera = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
export async function settings() {
  const rows = await many('SELECT key, value FROM impostazioni');
  const s = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  s.giorni_identita = Math.min(GIORNI_MAX, Math.max(1, Number(s.giorni_identita) || DEFAULTS.giorni_identita));
  s.etichetta_richiesta = s.etichetta_richiesta === true || s.etichetta_richiesta === 'true';
  s.ore_ritardo = intera(s.ore_ritardo, 1, 2000, DEFAULTS.ore_ritardo);
  s.ore_campioni = intera(s.ore_campioni, 1, 720, DEFAULTS.ore_campioni);
  s.giorni_finestra = intera(s.giorni_finestra, 7, 365, DEFAULTS.giorni_finestra);
  const sf = s.soglie_fase && typeof s.soglie_fase === 'object' ? s.soglie_fase : {};
  s.soglie_fase = Object.fromEntries(STATI_SOGLIA.map((k) => [k, intera(sf[k], 1, 2000, null)]).filter(([, v]) => v != null));
  s.colonne_predefinite = Array.isArray(s.colonne_predefinite) ? s.colonne_predefinite.filter((c) => COLONNE.includes(c)) : null;
  return s;
}
export async function setSetting(key, value) {
  await q('INSERT INTO impostazioni (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}

// ---------------------------------------------------------------- contesto
/**
 * Contesto dell'utente: ADMIN (grant ADMIN o Owner/Admin della Suite: tutto, impostazioni, modelli, registro), LABORATORIO (v0.71.0:
 * personale del laboratorio, vede e stampa tutte le accettazioni, senza Impostazioni, Modelli e Registro) oppure OPERATORE (sedi del
 * proprio perimetro = scope SITE del grant). Un OPERATORE senza sedi nel grant non vede nessuna accettazione (dati dei pazienti: niente
 * perimetro implicito "tutte le sedi"). tutte = vede tutte le sedi (ADMIN e LABORATORIO); un client non abbinato a una sede lo vedono solo loro.
 */
export function contesto(req) {
  const mu = req.moduleUser || {};
  const isAdmin = mu.role === 'ADMIN';
  const isLab = mu.role === 'LABORATORIO';
  const tutte = isAdmin || isLab;
  const siteIds = (mu.site_ids || []).map(Number).filter(Number.isFinite);
  return { isAdmin, isLab, tutte, role: mu.role || null, siteIds, userId: req.user?.id || null, vede: (siteId) => tutte || (siteId != null && siteIds.includes(Number(siteId))) };
}
export function soloAdmin(req, _res, next) {
  if (contesto(req).isAdmin) return next();
  return next(forbidden('Sezione riservata agli amministratori di Lab Control'));
}

// ---------------------------------------------------------------- date (ora di Roma)
export const itData = (s) => { const v = s instanceof Date ? s.toISOString() : String(s || ''); return /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''; };
/** "YYYY-MM-DD" di una DATE di PostgreSQL (il driver la dà come Date a mezzanotte locale) o di un testo. */
export const isoData = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const m = String(d).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
/** "AAAA-MM-GGTHH:MM:SS" adesso, ora locale di Roma (le date *AtLocal del gestionale sono in ora di Roma, senza fuso). */
export const adessoRoma = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T');
/** "HH:MM" di un TIMESTAMP locale (senza fuso: è l'ora del gestionale). */
export const oraLocale = (t) => {
  if (!t) return '';
  if (t instanceof Date) return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const m = String(t).match(/T?(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
};
export const oggiRoma = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const oraRoma = (d = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).slice(0, 2)) % 24;

// ---------------------------------------------------------------- modelli
/** C'è almeno un modello attivo validato dal laboratorio? (altrimenti l'avviso fisso del modulo) */
export async function modelloValidato() {
  return Boolean((await one(`SELECT 1 AS ok FROM modelli WHERE attivo AND validato_il IS NOT NULL LIMIT 1`))?.ok);
}
export const AVVISO_VALIDAZIONE = 'Modello non ancora validato: prima dell\'uso sulle provette va confrontato con l\'etichetta di StudioLab e letto dagli strumenti del laboratorio';

/** Modello da usare per una sede: quello assegnato alla sede (se attivo), altrimenti il predefinito, altrimenti il primo attivo. */
export async function modelloPerSede(siteId) {
  if (siteId) {
    const m = await one(`SELECT m.* FROM modelli_sede ms JOIN modelli m ON m.id = ms.modello_id WHERE ms.site_id = $1 AND m.attivo`, [siteId]);
    if (m) return m;
  }
  return one(`SELECT * FROM modelli WHERE attivo ORDER BY predefinito DESC, id LIMIT 1`);
}

/** Etichetta leggibile di una sede della Suite. */
export const nomeSede = (s) => (s ? [s.code, s.name].filter(Boolean).join(' ') : null);
