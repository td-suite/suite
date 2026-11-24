// Recupero Crediti · impostazioni (tabella impostazioni, valori JSON) con i predefiniti del memo, registro dei contatti e audit.
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { PREDEFINITE } from './regole.js';

export const CHIAVI_MODELLO = ['modello_1_oggetto', 'modello_1_testo', 'modello_2_oggetto', 'modello_2_testo', 'modello_3_oggetto', 'modello_3_testo', 'modello_5_oggetto', 'modello_5_testo', 'modello_ricevuta_testo'];
const NUMERI = { giorni_avviso: [1, 30], giorni_sollecito_1: [1, 120], giorni_sollecito_2: [2, 180], giorni_chiamata: [3, 240], giorni_legale: [5, 365], giorni_piano_dopo_chiamata: [1, 30], giorni_termine_1: [1, 60], giorni_termine_2: [1, 60], ore_banca_fresca: [2, 96],
  giorni_bonifici_dubbi: [1, 60], tolleranza_promessa: [0, 15], giorni_attesa_pagato: [1, 20], soglia_minima: [0, 1e7], soglia_dir: [0, 1e9], ora_invio_da: [0, 23], ora_invio_a: [1, 24] };

export async function impostazioni() {
  const rows = await many('SELECT key, value FROM impostazioni');
  const s = { ...PREDEFINITE, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  for (const [k, [min, max]] of Object.entries(NUMERI)) { const n = Number(s[k]); s[k] = Number.isFinite(n) && n >= min && n <= max ? n : PREDEFINITE[k]; }
  // la scala deve restare ordinata: un valore incoerente torna al predefinito
  if (!(s.giorni_sollecito_1 < s.giorni_sollecito_2 && s.giorni_sollecito_2 < s.giorni_chiamata && s.giorni_chiamata < s.giorni_legale)) for (const k of ['giorni_sollecito_1', 'giorni_sollecito_2', 'giorni_chiamata', 'giorni_legale']) s[k] = PREDEFINITE[k];
  s.modalita = s.modalita === 'ATTIVA' ? 'ATTIVA' : 'PROVA';
  s.giorni_invio = Array.isArray(s.giorni_invio) && s.giorni_invio.length ? s.giorni_invio.map(Number).filter((n) => n >= 1 && n <= 7) : PREDEFINITE.giorni_invio;
  s.casella = config.mailboxEnv || String(s.casella || '').trim().toLowerCase() || config.mailboxDefault;
  if (!s.fatture_dal) s.fatture_dal = `${new Date().getFullYear()}-01-01`;
  s.tasso_mora_pct = s.tasso_mora_pct === null || s.tasso_mora_pct === '' ? null : Number(s.tasso_mora_pct) || null;
  return s;
}
export async function salvaImpostazione(key, value, userId = null) {
  await q('INSERT INTO impostazioni (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by', [key, JSON.stringify(value), userId]);
}
export async function evento(organizationId, tipo, testo, { userId = null, dati = null } = {}, client = null) {
  const run = client ? client.query.bind(client) : q;
  await run('INSERT INTO eventi (organization_id, tipo, testo, user_id, dati) VALUES ($1,$2,$3,$4,$5)', [organizationId || null, tipo, String(testo).slice(0, 1000), userId, dati ? JSON.stringify(dati) : null]);
}
export async function audit(req, action, { entity = null, entityId = null, label = null, data = null } = {}) {
  try { await q('INSERT INTO audit_log (user_id, action, entity, entity_id, label, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req?.user?.id || null, action, entity, entityId != null ? String(entityId) : null, label, data ? JSON.stringify(data) : null, req?.ip || null]); }
  catch (e) { console.warn('[crediti audit]', e.message); }
}
export const oggiRoma = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
export const oraRoma = (d = new Date()) => Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(d));
export { one, many, q };
