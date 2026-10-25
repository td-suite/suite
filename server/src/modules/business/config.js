// Configurazione del modulo Business (Contratti B2C/B2B), letta da process.env con le stesse chiavi dell'app di origine.
// L'autenticazione (sessione, Entra, TOTP) e gli utenti sono della Suite: qui restano solo i parametri funzionali.
import { config as suite } from '../../config.js';

const env = process.env;
const DEV_CREDENTIALS_KEY = 'dev-only-business-credentials-key';

export const config = {
  baseUrl: `${(suite.baseUrl || env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')}/business`,
  // chiave per cifrare le credenziali dei portali (AES-256-GCM): in produzione DEVE essere la stessa dell'app di origine,
  // altrimenti le password copiate dal travaso non si decifrano
  // La chiave deve essere IDENTICA a quella dell'app Business originale (CREDENTIALS_KEY del servizio td-business su Render): va copiata in BUSINESS_CREDENTIALS_KEY della Suite
  credentialsKey: env.BUSINESS_CREDENTIALS_KEY || env.CREDENTIALS_KEY || DEV_CREDENTIALS_KEY,
  credentialsKeySet: Boolean(env.BUSINESS_CREDENTIALS_KEY || env.CREDENTIALS_KEY),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 40),
  sofficeBin: env.SOFFICE_BIN || 'soffice',
  appName: 'Toscana Diagnostica · Business',
};

if (!config.credentialsKeySet) {
  console.warn('[business] CREDENTIALS_KEY non impostata: le credenziali dei portali vengono cifrate con una chiave di sviluppo (le password travasate dalla produzione non saranno decifrabili)');
}
