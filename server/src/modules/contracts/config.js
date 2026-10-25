// Configurazione del modulo Contracts (Contratti del Personale), letta da process.env con le stesse chiavi dell'app di origine.
// L'autenticazione (sessione, Entra, TOTP), gli utenti e i profili sono della Suite: qui restano solo i parametri funzionali.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  baseUrl: `${(suite.baseUrl || env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')}/contracts`,
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 25),
  // pacchetto iniziale (zip con manifest.json e dossier): fino a 600 MB come nell'app di origine
  maxPackMb: Number(env.MAX_PACK_MB || 600),
  // LibreOffice headless per i PDF: presente nell'immagine Docker di produzione, in locale la generazione degrada a solo DOCX
  sofficeBin: env.SOFFICE_BIN || 'soffice',
  // Lettura dei CV, dei contratti e degli allegati con l'API Claude (facoltativa). I documenti del personale sono dati
  // sensibili: la funzione si attiva solo con una chiave dedicata (CONTRACTS_ANTHROPIC_API_KEY) oppure, in modo esplicito,
  // con CONTRACTS_AI_ENABLED=true per riusare la chiave della Suite. Senza chiave le letture restano euristiche, come nell'app.
  anthropicKey: env.CONTRACTS_ANTHROPIC_API_KEY || (env.CONTRACTS_AI_ENABLED === 'true' ? env.ANTHROPIC_API_KEY || '' : ''),
  anthropicModel: env.CONTRACTS_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  appName: 'Toscana Diagnostica · Contracts',
};
