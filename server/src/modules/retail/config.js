// Configurazione del modulo Retail Assistant dentro la Suite: stesse chiavi dell'app di origine, lette da process.env.
// Autenticazione, sessioni e utenti sono della Suite: qui restano solo le voci usate dal codice dell'app.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  // Indirizzo pubblico del modulo: la Suite più il prefisso del modulo
  get baseUrl() { return `${suite.baseUrl}/retail`; },
  appName: 'Toscana Diagnostica · Retail',
  // Chiave di cifratura delle credenziali dei connettori (AES-256-GCM): derivata dal SESSION_SECRET della Suite.
  // ATTENZIONE: le credenziali cifrate nell'app di origine con un altro SESSION_SECRET non sono leggibili dopo il travaso
  // (vanno reinserite dalla pagina Connettori); RETAIL_SESSION_SECRET permette di indicare quello dell'app di origine.
  sessionSecret: env.RETAIL_SESSION_SECRET || suite.sessionSecret,
  maxUploadMb: Number(env.MAX_UPLOAD_MB || suite.maxUploadMb || 40),
  anthropicKey: env.ANTHROPIC_API_KEY || suite.anthropic?.apiKey || '',
  anthropicModel: env.ANTHROPIC_MODEL || suite.anthropic?.model || 'claude-sonnet-5-5',
  entra: { get enabled() { return Boolean(suite.entra?.enabled); } },
};
