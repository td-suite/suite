// Configurazione del modulo Room Planning dentro la Suite: stesse chiavi dell'app di origine, lette da process.env.
// Autenticazione, sessioni e utenti sono della Suite: qui restano solo le voci usate dal codice dell'app.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  // Indirizzo pubblico del modulo (link nelle email): la Suite più il prefisso del modulo
  get baseUrl() { return `${suite.baseUrl}/room`; },
  appName: 'Toscana Diagnostica · Room Planning',
  // Nella Suite l'accesso Microsoft 365 è gestito dalla Suite stessa: il modulo lo espone solo in lettura (pagina Impostazioni)
  entra: {
    get enabled() { return suite.entra.enabled; },
    autoProvisionRole: env.ENTRA_AUTO_ROLE === undefined ? 'VIEWER' : env.ENTRA_AUTO_ROLE,
    allowedDomains: suite.autoInternalDomains,
  },
  seed: { loadInitialData: false },
};
