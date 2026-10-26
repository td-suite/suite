// Configurazione del modulo Orders: stesse chiavi d'ambiente dell'app di origine, BASE_URL della Suite + /orders.
// Autenticazione, sessione e seed del super amministratore non servono più (li fa la Suite); la posta parte dalla casella
// della Suite (lib/mailer.js) con le credenziali Graph della Suite.
import { config as suite } from '../../config.js';
import { connectorSync, studiolabRoot } from '../../lib/connectors.js';

const env = process.env;

export const config = {
  baseUrl: `${suite.baseUrl}/orders`,
  // Integrazione StudioLab ServiceNET (CB Sistemi): base URL, chiave API (header X-API-KEY) e chiave in ingresso per l'HL7
  // vengono dal connettore unico della Suite (Amministrazione > Connettori, lib/connectors.js), con ripiego sulle variabili
  // STUDIOLAB_* / LIS_* finché il connettore non è configurato.
  studiolab: {
    get baseUrl() { return studiolabRoot(connectorSync('STUDIOLAB').base_url); },
    get apiKey() { const c = connectorSync('STUDIOLAB'); return c.enabled ? (c.credentials.api_key || '') : ''; },
    get clientCode() { return connectorSync('STUDIOLAB').settings.client_code || 'TD'; },   // CodiceCliente da passare alle chiamate
    get inboundKey() { return connectorSync('STUDIOLAB').inbound_secret; },                   // solo per lo stato: la verifica usa verifyInbound
    get enabled() { return Boolean(this.apiKey); },
  },
  // Integrazione Silva Group (gestore del magazzino): il fornitore interroga le nostre API ogni 5 minuti con il segreto in
  // ingresso del connettore SILVA (header X-API-KEY; ripiego SILVA_INBOUND_KEY): feed giacenze, ordini da preparare, consegne.
  silva: {
    get inboundKey() { return connectorSync('SILVA').inbound_secret; },
    get email() { return connectorSync('SILVA').settings.order_email || ''; },
    get customerCode() { return connectorSync('SILVA').settings.customer_code || 'TOSCANA-DIAGNOSTICA'; },
  },
  entra: { get enabled() { return suite.entra.enabled; } },
  appName: 'Toscana Diagnostica · Orders Management',
};
