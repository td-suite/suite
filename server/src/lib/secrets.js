// Credenziali impostabili dall'Amministrazione (titolare): cifrate AES-256-GCM nel database con CREDENTIALS_KEY.
// La variabile d'ambiente, se presente, ha sempre la precedenza. Al salvataggio il valore entra subito in uso (config mutata, client azzerati).
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { config, LEGACY_KEYS } from '../config.js';

// Chiave primaria da CREDENTIALS_KEY; in sua assenza (o per valori salvati prima che esistesse) si usa quella derivata da SESSION_SECRET
const derive = (s) => crypto.createHash('sha256').update(s).digest();
const KEYS = [...(process.env.CREDENTIALS_KEY ? [derive(process.env.CREDENTIALS_KEY)] : []), derive(config.sessionSecret)];
const KEY = KEYS[0];

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
function decryptWith(k, blob) {
  const [, iv, tag, data] = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
export function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Formato credenziale non valido');
  let lastErr;
  for (const k of KEYS) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Decifratura non riuscita');
}

// Nomi ammessi: legacy:<key>, anthropic_api_key, azure_storage_connection_string
export const SECRET_NAMES = [...LEGACY_KEYS.map((k) => `legacy:${k}`), 'anthropic_api_key', 'azure_storage_connection_string'];
const envOf = (name) => name.startsWith('legacy:') ? (process.env[`LEGACY_${name.slice(7).toUpperCase()}_DATABASE_URL`] || '')
  : name === 'anthropic_api_key' ? (process.env.ANTHROPIC_API_KEY || '') : (process.env.AZURE_STORAGE_CONNECTION_STRING || '');

// Indizio mostrato in Amministrazione: host del database per le connessioni, ultime 4 cifre per le chiavi
const hintOf = (name, v) => { if (name.startsWith('legacy:')) { try { return new URL(v).hostname || v.slice(-4); } catch { return v.slice(-4); } } if (name === 'azure_storage_connection_string') { const m = /AccountName=([^;]+)/.exec(v); return m ? m[1] : v.slice(-4); } return v.slice(-4); };
const listeners = [];
export const onSecretChange = (fn) => listeners.push(fn);

function apply(name, value) {
  if (name.startsWith('legacy:')) config.legacy[name.slice(7)] = value || '';
  else if (name === 'anthropic_api_key') config.anthropic.apiKey = value || '';
  else if (name === 'azure_storage_connection_string') config.blob.connectionString = value || '';
  for (const fn of listeners) { try { fn(name); } catch (e) { console.error('[secrets]', e.message); } }
}

// All'avvio: per ogni credenziale senza variabile d'ambiente, carica il valore salvato nel database
export async function loadSecrets() {
  // modello Anthropic scelto in Amministrazione (prevale sulla variabile ANTHROPIC_MODEL)
  try { const m = await q(`SELECT value FROM app_settings WHERE key='anthropic_model'`); const v = m.rows[0]?.value; if (typeof v === 'string' && v.trim()) config.anthropic.model = v.trim(); } catch { /* tabella non ancora pronta */ }
  const rows = await q(`SELECT key, value FROM app_settings WHERE key LIKE 'secret:%'`);
  for (const r of rows.rows) {
    const name = r.key.slice(7);
    if (!SECRET_NAMES.includes(name) || envOf(name)) continue;
    try {
      const value = decrypt(r.value.enc);
      apply(name, value);
      // ricifra con la chiave primaria se il valore era stato salvato con quella di ripiego
      const fresh = encrypt(value); try { decryptWith(KEY, r.value.enc); } catch { await q('UPDATE app_settings SET value = value || $2 WHERE key=$1', [r.key, JSON.stringify({ enc: fresh })]); }
    } catch (e) { console.error(`[secrets] ${name}: ${e.message}`); }
  }
}

export async function setSecret(name, value, userId) {
  if (!SECRET_NAMES.includes(name)) throw new Error('Credenziale sconosciuta');
  if (envOf(name)) throw new Error('Questa credenziale è impostata nelle variabili d\'ambiente di Render e ha la precedenza: va modificata lì');
  if (!value) {
    await q('DELETE FROM app_settings WHERE key=$1', [`secret:${name}`]);
    apply(name, '');
    return;
  }
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [`secret:${name}`, JSON.stringify({ enc: encrypt(value), hint: hintOf(name, value), at: new Date().toISOString() }), userId || null]);
  apply(name, value);
}

export async function secretStatus(name) {
  const env = envOf(name);
  if (env) return { set: true, source: 'env', hint: hintOf(name, env) };
  const row = await one('SELECT value, updated_at FROM app_settings WHERE key=$1', [`secret:${name}`]);
  return row ? { set: true, source: 'db', hint: row.value.hint, updated_at: row.updated_at } : { set: false };
}
