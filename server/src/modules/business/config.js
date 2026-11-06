// Configurazione del modulo Business Hub (ex Contratti B2C/B2B), letta da process.env con le stesse chiavi dell'app di origine.
// L'autenticazione (sessione, Entra, TOTP) e gli utenti sono della Suite: qui restano solo i parametri funzionali.
import { config as suite } from '../../config.js';

const env = process.env;
const DEV_CREDENTIALS_KEY = 'dev-only-business-credentials-key';

export const config = {
  baseUrl: `${(suite.baseUrl || env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')}/business`,
  // chiave per cifrare le credenziali dei portali (AES-256-GCM): in produzione DEVE essere la stessa dell'app di origine,
  // altrimenti le password copiate dal travaso non si decifrano
  // La chiave deve essere IDENTICA a quella dell'app Business originale (CREDENTIALS_KEY del servizio td-business su Render): va copiata in BUSINESS_CREDENTIALS_KEY della Suite
  // In produzione la chiave di sviluppo non si usa mai (debug pre-produzione, M5): senza chiave le credenziali dei portali sono
  // disattivate (lettura e scrittura rispondono 503 con il motivo), il resto del modulo e della Suite funziona
  credentialsKey: env.BUSINESS_CREDENTIALS_KEY || env.CREDENTIALS_KEY || (env.NODE_ENV === 'production' ? null : DEV_CREDENTIALS_KEY),
  credentialsKeySet: Boolean(env.BUSINESS_CREDENTIALS_KEY || env.CREDENTIALS_KEY),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 40),
  sofficeBin: env.SOFFICE_BIN || 'soffice',
  appName: 'Toscana Diagnostica · Business Hub',
  // Caselle di linea del Business Hub: la variabile d'ambiente prevale sull'indirizzo salvato in Impostazioni (sola lettura)
  mailboxEnv: { SRV: (env.BUSINESS_MAILBOX_SRV || '').trim().toLowerCase() || null, PP: (env.BUSINESS_MAILBOX_PP || '').trim().toLowerCase() || null, MDL: (env.BUSINESS_MAILBOX_MDL || '').trim().toLowerCase() || null },
  inboxMinutes: Number(env.BUSINESS_INBOX_MINUTES || 10),
  avvisiMinutes: Number(env.BUSINESS_AVVISI_MINUTES || 30),
};

if (!config.credentialsKeySet) {
  if (env.NODE_ENV === 'production') console.error('[business] BUSINESS_CREDENTIALS_KEY (o CREDENTIALS_KEY) mancante in produzione: credenziali dei portali DISATTIVATE finché la chiave non viene impostata');
  else console.warn('[business] CREDENTIALS_KEY non impostata: le credenziali dei portali vengono cifrate con una chiave di sviluppo (le password travasate dalla produzione non saranno decifrabili)');
}
