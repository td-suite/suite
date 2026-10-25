// Configurazione del modulo Cash Management: stesse chiavi dell'app di origine lette da process.env, BASE_URL della Suite + /cash.
// Autenticazione, sessioni, Entra ID e seed del super amministratore non servono più: li gestisce la Suite.
// Le email partono dalla casella della Suite (lib/mailer.js della Suite): il mittente mostrato nelle pagine è quello.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  baseUrl: `${suite.baseUrl}/cash`,
  databaseUrl: suite.databaseUrl,
  mail: {
    configured: suite.mail.provider === 'graph',
    sender: suite.mail.sender,
  },
  // giorni oltre i quali un rendiconto non versato compare come "in ritardo" quando app_settings non ha il valore
  pickupAlertDaysDefault: Number(env.CASH_PICKUP_ALERT_DAYS || 2),
  appName: 'Toscana Diagnostica · Cash Management',
};
