import { many, q } from '../db.js';
import { getLaboratorio } from '../../../lib/company.js';

const DEFAULTS = {
  sla_ore_default: '24', sla_sollecito_ore: '0', sla_escalation_ore: '24', ricorrenza_soglia: '3', orario_lavoro: '08:00-18:00',
  lab_nome: 'Laboratorio di Analisi Toscana Diagnostica', lab_indirizzo: 'Via di Pratignone 13/4, 50019 Sesto Fiorentino (FI)',
  lab_email: 'laboratorio@toscanadiagnostica.it', lab_telefono: '',
};
export const SETTING_KEYS = Object.keys(DEFAULTS);
export const LAB_KEYS = ['lab_nome', 'lab_indirizzo'];
let cache = null, cacheAt = 0;

export async function getSettings(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30_000) return cache;
  const rows = await many('SELECT key, value FROM app_settings');
  cache = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  // B9: nome e indirizzo del Laboratorio dalla sede LABORATORIO di Amministrazione > Sedi (email e telefono restano del modulo: sono il
  // canale delle notifiche NC del laboratorio, non l'anagrafica)
  const lab = await getLaboratorio();
  if (lab) { cache.lab_nome = lab.name; if (lab.indirizzo) cache.lab_indirizzo = lab.indirizzo; cache.lab_da_sede = lab.code; }
  cacheAt = Date.now();
  return cache;
}
export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!SETTING_KEYS.includes(k) || (LAB_KEYS.includes(k) && (await getLaboratorio()))) continue;   // B9: dati del Laboratorio dalla sede
    await q('INSERT INTO app_settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [k, String(v ?? '')]);
  }
  cache = null;
  return getSettings(true);
}
export const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
