// Configurazione del modulo Orders: stesse chiavi d'ambiente dell'app di origine, BASE_URL della Suite + /orders.
// Autenticazione, sessione e seed del super amministratore non servono più (li fa la Suite); la posta parte dalla casella
// della Suite (lib/mailer.js) con le credenziali Graph della Suite.
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  baseUrl: `${suite.baseUrl}/orders`,
  // Integrazione StudioLab ServiceNET (CB Sistemi): REST con header X-API-KEY (catalogo esami, whoami) e
  // ricezione HL7 over HTTPS (notifiche di accettazione, da cui si ricava la produzione per cliente)
  studiolab: {
    baseUrl: (env.STUDIOLAB_API_URL || 'https://servicenet.toscanadiagnostica.it/API').trim().replace(/\/+$/, ''),
    apiKey: env.STUDIOLAB_API_KEY || '',             // chiave fornita da CB Sistemi: solo nel pannello di hosting
    clientCode: env.STUDIOLAB_CLIENT_CODE || 'TD',   // CodiceCliente da passare alle chiamate
    inboundKey: env.STUDIOLAB_INBOUND_KEY || '',     // chiave che StudioLab usa per inviarci i messaggi HL7
    get enabled() { return Boolean(this.apiKey); },
  },
  // Integrazione Silva Group (gestore del magazzino): il fornitore interroga le nostre API ogni 5 minuti con la chiave
  // SILVA_INBOUND_KEY (header X-API-KEY): feed giacenze in ingresso, ordini da preparare in uscita, avanzamento consegne.
  silva: {
    inboundKey: env.SILVA_INBOUND_KEY || '',
    email: env.SILVA_ORDER_EMAIL || '',
    customerCode: env.SILVA_CUSTOMER_CODE || 'TOSCANA-DIAGNOSTICA',
  },
  entra: { get enabled() { return suite.entra.enabled; } },
  appName: 'Toscana Diagnostica · Orders Management',
};
