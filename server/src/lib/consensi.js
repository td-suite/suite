// Presa d'atto delle informative (Privacy e uso dell'intelligenza artificiale) al primo accesso e a ogni cambio di versione.
// Regole pure (documentiDaAccettare, documentiDaRegistrare, csv) testate in test/consensi.test.mjs; letture dal db per le route
// (routes/consensi.js) e per /api/auth/me (consensi_da_accettare).
import { many, q } from '../db.js';

export const DOCUMENTI = ['PRIVACY', 'IA'];
export const ETICHETTE = { PRIVACY: 'Informativa sulla privacy', IA: "Informativa sull'uso dell'intelligenza artificiale" };
export const CHIAVI = {
  PRIVACY: { url: 'consensi.privacy_url', versione: 'consensi.privacy_versione' },
  IA: { url: 'consensi.ia_url', versione: 'consensi.ia_versione' },
};
// Valori di ripiego se le chiavi mancano (stessi della migrazione 039)
export const PREDEFINITI = {
  PRIVACY: { url: 'https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf', versione: '2026-11' },
  IA: { url: '/informativa-ia', versione: '1.0' },
};

const testo = (v) => (v == null ? '' : String(v).trim());

// Configurazione corrente: { PRIVACY: { url, versione, data }, IA: {...} } dalle righe di app_settings ({ key, value, updated_at })
export function configDaRighe(righe = []) {
  const per = Object.fromEntries(righe.map((r) => [r.key, r]));
  const out = {};
  for (const d of DOCUMENTI) {
    const rv = per[CHIAVI[d].versione];
    out[d] = {
      documento: d,
      titolo: ETICHETTE[d],
      url: testo(per[CHIAVI[d].url]?.value) || PREDEFINITI[d].url,
      versione: testo(rv?.value) || PREDEFINITI[d].versione,
      data: rv?.updated_at || null,   // da quando vale la versione corrente
    };
  }
  return out;
}

// Documenti che l'utente deve ancora accettare nella versione corrente. accettati: righe { documento, versione }
export function documentiDaAccettare(cfg, accettati = []) {
  const fatti = new Set(accettati.map((a) => `${a.documento}|${testo(a.versione)}`));
  return DOCUMENTI.filter((d) => !fatti.has(`${d}|${cfg[d].versione}`));
}

// Documenti da registrare a fronte di una presa d'atto: solo quelli richiesti, validi e non ancora accettati nella versione corrente
export function documentiDaRegistrare(cfg, accettati, richiesti = []) {
  const mancanti = new Set(documentiDaAccettare(cfg, accettati));
  return [...new Set(richiesti)].filter((d) => DOCUMENTI.includes(d) && mancanti.has(d));
}

// CSV con separatore ";" (Excel in italiano), campi tra virgolette quando serve
export function csv(intestazioni, righe) {
  const cella = (v) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [intestazioni, ...righe].map((r) => r.map(cella).join(';')).join('\r\n') + '\r\n';
}

// ---- letture dal db
export async function leggiConfig() {
  const chiavi = DOCUMENTI.flatMap((d) => [CHIAVI[d].url, CHIAVI[d].versione]);
  return configDaRighe(await many('SELECT key, value, updated_at FROM app_settings WHERE key = ANY($1)', [chiavi]));
}
// Configurazione in memoria per il controllo di requireAuth (L14): riletta al massimo ogni 30 secondi o dopo una modifica
let cache = { at: 0, cfg: null };
export async function configConsensi() {
  if (cache.cfg && Date.now() - cache.at < 30_000) return cache.cfg;
  cache = { at: Date.now(), cfg: await leggiConfig() };
  return cache.cfg;
}
export const invalidaConfigConsensi = () => { cache = { at: 0, cfg: null }; };
export const accettatiDa = (userId) => many('SELECT documento, versione, accettato_at FROM consensi WHERE user_id=$1', [userId]);

// Per /api/auth/me: documenti da accettare e URL delle due informative (le icone della Home e della barra laterale)
export async function statoPer(userId) {
  const [cfg, acc] = await Promise.all([leggiConfig(), accettatiDa(userId)]);
  return { daAccettare: documentiDaAccettare(cfg, acc), informative: Object.fromEntries(DOCUMENTI.map((d) => [d, { url: cfg[d].url, versione: cfg[d].versione }])) };
}

export async function registra(userId, documenti, cfg, { ip, userAgent }) {
  for (const d of documenti) {
    await q(`INSERT INTO consensi (user_id, documento, versione, ip, user_agent) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (user_id, documento, versione) DO NOTHING`, [userId, d, cfg[d].versione, ip || null, userAgent ? String(userAgent).slice(0, 500) : null]);
  }
}
