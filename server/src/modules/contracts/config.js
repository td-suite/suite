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
  // Lettura dei CV, dei contratti e degli allegati con l'API Claude: chiave dedicata CONTRACTS_ANTHROPIC_API_KEY se presente,
  // altrimenti la chiave della Suite (Amministrazione > Impostazioni > Integrazioni, oppure ANTHROPIC_API_KEY), letta a ogni
  // uso perché il titolare può impostarla dalla Suite senza riavvio. Senza chiave le letture restano euristiche, come nell'app.
  get anthropicKey() { return env.CONTRACTS_ANTHROPIC_API_KEY || suite.anthropic.apiKey || ''; },
  anthropicModel: env.CONTRACTS_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  appName: 'Toscana Diagnostica · Contracts',
};
