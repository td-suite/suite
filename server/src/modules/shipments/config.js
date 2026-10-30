// Configurazione del modulo Shipments: stesse chiavi d'ambiente dell'app di origine, BASE_URL della Suite + /shipments.
// Casella letta per le richieste in arrivo: SHIPMENTS_GRAPH_INBOX (oppure GRAPH_INBOX). Le credenziali Graph sono quelle della
// Suite (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET, con ricaduta su ENTRA_*).
import { config as suite } from '../../config.js';

const env = process.env;

export const config = {
  baseUrl: `${suite.baseUrl}/shipments`,
  graph: {
    tenantId: suite.mail.graph.tenantId,
    clientId: suite.mail.graph.clientId,
    clientSecret: suite.mail.graph.clientSecret,
    sender: suite.mail.sender,                                  // le comunicazioni partono dalla casella della Suite
    // casella letta per le richieste in arrivo: variabile d'ambiente, altrimenti l'impostazione del modulo (inbox_address), altrimenti shipments@
    inboxEnv: env.SHIPMENTS_GRAPH_INBOX || env.GRAPH_INBOX || '',
    inboxDefault: 'shipments@toscanadiagnostica.it',
    get inbox() { return this.inboxEnv || this.inboxOverride || this.inboxDefault; },
    inboxOverride: '',
    pollMinutes: Number(env.GRAPH_POLL_MINUTES || 5),
    get enabled() { return Boolean(this.tenantId && this.clientId && this.clientSecret); },
  },
  tracking: {
    provider: (env.TRACKING_PROVIDER || 'none').toLowerCase(), // none | 17track | aftership
    apiKey: env.TRACKING_API_KEY || '',
    fedexClientId: env.FEDEX_CLIENT_ID || '',
    fedexClientSecret: env.FEDEX_CLIENT_SECRET || '',
    fedexBase: env.FEDEX_API_BASE || 'https://apis.fedex.com',
    pollMinutes: Number(env.TRACKING_POLL_MINUTES || 30),
  },
  appName: 'Toscana Diagnostica · Shipments',
};
