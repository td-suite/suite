// Configurazione del modulo Piano Ferie (variabili d'ambiente con prefisso FERIE_, tutte facoltative).
// I parametri di lavoro (spettanze, coperture, chiusure, patroni, promemoria, email) sono impostazioni del modulo, non variabili.
import { config as suite } from '../../config.js';

const env = process.env;
export const config = {
  appName: 'Piano Ferie',
  baseUrl: suite.baseUrl,
  // Intervallo del job ferie:promemoria (minuti): una volta al giorno
  jobMinutes: Number(env.FERIE_JOB_MINUTES || 24 * 60),
  // Dimensione massima del file XLSX dei residui
  maxXlsxBytes: Number(env.FERIE_MAX_XLSX_MB || 5) * 1024 * 1024,
};
