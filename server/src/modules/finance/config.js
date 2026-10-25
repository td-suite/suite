// Configurazione del modulo Finance (Payments) dentro la Suite TD.
// Stesse chiavi d'ambiente dell'app di origine; BASE_URL della Suite + '/finance' (link di firma nelle email).
// Autenticazione, sessione, Entra e posta sono quelli della Suite (config principale).
import { config as suite } from '../../config.js';

const env = process.env;
const bool = (v, d = false) => (v == null || v === '' ? d : String(v).toLowerCase() === 'true');

export const config = {
  baseUrl: `${suite.baseUrl}/finance`,
  suiteBaseUrl: suite.baseUrl,
  maxUploadMb: Number(env.FINANCE_MAX_UPLOAD_MB || env.MAX_UPLOAD_MB || 25),
  sofficeBin: env.SOFFICE_BIN || 'soffice',
  // La firma richiede una sessione Microsoft 365 (authMethod ENTRA della Suite). SIGN_ALLOW_LOCAL=true solo per sviluppo locale.
  signAllowLocal: bool(env.SIGN_ALLOW_LOCAL, false),
  entra: {
    get enabled() { return suite.entra.enabled; },
  },
  mail: {
    // GRAPH: invio reale tramite il mailer della Suite (casella suite@). LOG: nessun invio, link di firma nel log e nell'app.
    get mode() { return suite.mail.provider === 'graph' ? 'GRAPH' : 'LOG'; },
    get sender() { return suite.mail.sender; },
    get senderName() { return suite.mail.senderName; },
  },
  appName: 'Toscana Diagnostica · Finance',
};
