// Configurazione del modulo Rimborso Spese (variabili d'ambiente con prefisso RIMBORSI_, tutte facoltative). I parametri di lavoro
// (giorno limite, tariffa predefinita, categorie, massimali, eccezioni, P&C) sono impostazioni del modulo, non variabili.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as suite } from '../../config.js';

const env = process.env;
export const KEY = 'rimborsi';
export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
export const config = {
  appName: 'Rimborso Spese',
  baseUrl: suite.baseUrl,
  // Intervallo del job rimborsi:promemoria (minuti): una volta all'ora, il job decide da solo cosa inviare (al massimo uno al giorno)
  jobMinutes: Number(env.RIMBORSI_JOB_MINUTES || 60),
  // Dimensione massima di un giustificativo (le foto arrivano già compresse dal browser, circa 1600 px in JPEG)
  maxFileBytes: Number(env.RIMBORSI_MAX_FILE_MB || 15) * 1024 * 1024,
};

// Modulistica cartacea in uso (documenti SGI dell'azienda, copiati come risorse del modulo): codice, revisione 00 del 12/04/2026
export const MODULI_CARTACEI = {
  MOD025: { codice: 'TD-SGI-MOD025', revisione: '00', data: '2026-04-12', titolo: 'Modulo Rimborso Spese', file: 'TD-SGI-MOD025_00_Rimborso_Spese.pdf' },
  MOD029: { codice: 'TD-SGI-MOD029', revisione: '00', data: '2026-04-12', titolo: 'Modulo Rimborso Chilometrico', file: 'TD-SGI-MOD029_00_Rimborso_Chilometrico.pdf' },
};
export const RIF_PROCEDURA = 'TD-SGI-PRO024';
