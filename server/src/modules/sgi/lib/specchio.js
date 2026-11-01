// Portale SGI · specchio del sito pubblico sgi.toscanadiagnostica.it (una sola fonte, due presentazioni identiche).
// Meccanica comune al Portale Service in server/src/lib/specchioPortale.js; qui i parametri del SGI:
// - quattro JSON (meta da /api/meta, docs, preparazioni, fulltext da /data/), file da docs/ e stampabili/;
// - origine protetta facoltativa: se sul sito è impostata SGI_PASSWORD, cruscotto, /data e /docs chiedono HTTP Basic. La Suite manda
//   l'intestazione Authorization con le credenziali di SGI_PORTAL_USER/SGI_PORTAL_PASSWORD o, in loro assenza, con quelle salvate in
//   Impostazioni (password cifrata AES-256-GCM con lib/secrets.js). Utente e password non compaiono mai nei log né nelle risposte.
import { q, one, many, tx } from '../db.js';
import { creaSpecchio } from '../../../lib/specchioPortale.js';
import { encrypt, decrypt } from '../../../lib/secrets.js';
import { config, ORIGINE_DEFAULT, UTENTE_PREDEFINITO, KEY } from '../config.js';
import { CHIAVI, validaContenuti, percorsoValido, costruisciIndice, autorizzazioneSgi } from './regole.js';

// ---------------------------------------------------------------- credenziali dell'origine
async function leggiImp(chiave) {
  const r = await one('SELECT valore FROM impostazioni WHERE chiave=$1', [chiave]);
  return r ? r.valore : null;
}
/**
 * Credenziali in uso: { utente, password, fonte: 'env'|'impostazioni'|null }. La password non esce mai da questo modulo verso il
 * browser (le Impostazioni ricevono solo "password impostata sì/no").
 */
export async function credenziali() {
  if (config.passwordEnv) return { utente: config.utenteEnv || UTENTE_PREDEFINITO, password: config.passwordEnv, fonte: 'env' };
  const utente = await leggiImp('utente');
  const pw = await leggiImp('password');
  let password = '';
  if (pw?.enc) {
    try { password = decrypt(pw.enc); } catch (e) { console.warn(`[sgi] password dell'origine non leggibile (${e.message}): reimpostala in Impostazioni`); }
  }
  return { utente: typeof utente === 'string' && utente ? utente : (password ? UTENTE_PREDEFINITO : ''), password, fonte: password ? 'impostazioni' : null };
}
/** Salva utente e password dell'origine. password: stringa = nuova, '' o null = rimuovi, undefined = lascia com'è. */
export async function salvaCredenziali({ utente, password }, userId) {
  const set = (chiave, valore) => q(`INSERT INTO impostazioni (chiave, valore, updated_by) VALUES ($1,$2,$3)
    ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore, updated_at=now(), updated_by=EXCLUDED.updated_by`, [chiave, JSON.stringify(valore), userId || null]);
  if (utente !== undefined) await set('utente', utente ? String(utente).trim() : null);
  if (password !== undefined) await set('password', password ? { enc: encrypt(password), at: new Date().toISOString() } : null);
}
async function autorizzazione() {
  const c = await credenziali();
  return autorizzazioneSgi(c.utente, c.password);
}

const S = creaSpecchio({
  key: KEY,
  nome: 'Portale SGI',
  db: { q, one, many, tx },
  config,
  origineDefault: ORIGINE_DEFAULT,
  chiavi: CHIAVI,
  percorsoValido,
  validaContenuti,
  costruisciIndice,
  descriviMeta: (m) => `pubblicazione del ${m.build}, REG006 rev. ${m.reg006_rev} del ${m.reg006_data}, ${m.n_docs} documenti attivi, ${m.n_stampabili} stampabili, ${m.n_prestazioni} prestazioni`,
  autorizzazione,
  // /api/meta è sempre aperta anche con il sito protetto: la prova legge anche un JSON dell'area documentale per verificare le credenziali
  percorsoProva: '/data/meta.json',
  suggerimentoCredenziali: 'imposta utente e password in SGI Management > Impostazioni (oppure SGI_PORTAL_USER e SGI_PORTAL_PASSWORD su Render)',
});

export const { getImpostazione, setImpostazione, origine, leggiOrigine, provaOrigine, statoSpecchio, contenuto, indice, statoCache, svuotaCache, specchio, importaZip, leggiFile } = S;
export const specchioSgi = S;

/** Conteggi dello specchio confrontabili con meta.json: n_docs/n_pdf (docs.json), n_stampabili, n_prestazioni (preparazioni.json). */
export async function conteggi() {
  const r = await one(`SELECT
      (SELECT jsonb_array_length(json) FROM contenuti WHERE chiave='docs') AS n_docs,
      (SELECT count(*) FROM jsonb_array_elements((SELECT json FROM contenuti WHERE chiave='docs')) d WHERE coalesce(d->>'pdf','') <> '') AS n_pdf,
      (SELECT count(*) FROM jsonb_array_elements((SELECT json FROM contenuti WHERE chiave='docs')) d WHERE coalesce(d->>'stampabile','') <> '') AS n_stampabili,
      (SELECT jsonb_array_length(json->'righe') FROM contenuti WHERE chiave='preparazioni') AS n_prestazioni,
      (SELECT json FROM contenuti WHERE chiave='meta') AS meta`);
  const n = (v) => (v != null ? Number(v) : null);
  const vuoto = r?.n_docs == null;
  return { n_docs: n(r?.n_docs), n_pdf: vuoto ? null : n(r?.n_pdf), n_stampabili: vuoto ? null : n(r?.n_stampabili), n_prestazioni: n(r?.n_prestazioni), meta: r?.meta || null };
}
