// Configurazione del modulo Integration: stesse chiavi d'ambiente dell'app di origine.
// Autenticazione, sessioni, Entra e seed sono della Suite e non compaiono più qui.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  baseUrl: `${suite.baseUrl}/integration`,
  snapshotHourRome: Number(env.SNAPSHOT_HOUR || 2),   // snapshot giornaliero automatico (ora di Roma), solo con modulo LIVE
  appName: 'Toscana Diagnostica · Integration Plan',
};
