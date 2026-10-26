// Configurazione del modulo Non conformità dentro la Suite: stesse chiavi dell'app di origine (td-nc), lette da process.env.
// Autenticazione, sessioni e utenti sono della Suite; la posta esce dalla casella della Suite (lib/mailer.js).
// Restano qui le voci usate dal codice dell'app: StudioLAB (LIS), destinatari interni, scheduler.
import { config as suite } from '../../config.js';
import { connectorSync, studiolabRoot } from '../../lib/connectors.js';

const env = process.env;
const list = (v, lower = false) => (v || '').split(',').map((s) => (lower ? s.trim().toLowerCase() : s.trim())).filter(Boolean);

export const config = {
  // Indirizzo pubblico del modulo (link nelle email verso le sedi): la Suite più il prefisso del modulo
  get baseUrl() { return `${suite.baseUrl}/nc`; },
  appName: 'Toscana Diagnostica · Non Conformità',
  // StudioLAB ServiceNET (CB Sistemi): base URL, chiave API e segreto in ingresso vengono dal connettore unico della Suite
  // (Amministrazione > Connettori, lib/connectors.js), con ripiego sulle variabili LIS_* finché il connettore non è configurato.
  // Restano qui solo le opzioni di comportamento del modulo (segnalazioni, write-back, mittente).
  lis: {
    get baseUrl() { return studiolabRoot(connectorSync('STUDIOLAB').base_url); },
    get apiKey() { const c = connectorSync('STUDIOLAB'); return c.enabled ? (c.credentials.api_key || '') : ''; },
    get codiceCliente() { return connectorSync('STUDIOLAB').settings.client_code || 'TD'; },
    segnalazioni: (env.LIS_SEGNALAZIONI || 'true') === 'true',
    tipoSegnalazione: Number(env.LIS_TIPO_SEGNALAZIONE || 0),
    mittente: env.LIS_MITTENTE || 'td-nc',
    get pushSecret() { return connectorSync('STUDIOLAB').inbound_secret; },   // solo per lo stato: la verifica usa verifyInbound
    writeBack: (env.LIS_WRITE_BACK || 'false') === 'true',
    get timeoutMs() { return Number(connectorSync('STUDIOLAB').settings.timeout_ms) || 12000; },
    get enabled() { return Boolean(this.apiKey); },
  },
  // Email in uscita: il trasporto è quello della Suite (Microsoft Graph dalla casella suite@, oppure solo registro).
  // "from" resta il mittente logico mostrato nelle impostazioni del modulo; i destinatari interni sono quelli dell'app.
  mail: {
    get provider() { return suite.mail.provider === 'graph' ? 'graph' : 'log'; },
    get from() { return suite.mail.sender; },
    get fromName() { return env.MAIL_FROM_NAME || 'Laboratorio Toscana Diagnostica'; },
    labNotify: list(env.MAIL_LAB_NOTIFY || 'laboratorio@toscanadiagnostica.it', true),
  },
  schedulerMinutes: Number(env.SCHEDULER_MINUTES || 5),
};
