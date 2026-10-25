// Configurazione del modulo Non conformità dentro la Suite: stesse chiavi dell'app di origine (td-nc), lette da process.env.
// Autenticazione, sessioni e utenti sono della Suite; la posta esce dalla casella della Suite (lib/mailer.js).
// Restano qui le voci usate dal codice dell'app: StudioLAB (LIS), destinatari interni, scheduler.
import { config as suite } from '../../config.js';

const env = process.env;
const list = (v, lower = false) => (v || '').split(',').map((s) => (lower ? s.trim().toLowerCase() : s.trim())).filter(Boolean);

export const config = {
  // Indirizzo pubblico del modulo (link nelle email verso le sedi): la Suite più il prefisso del modulo
  get baseUrl() { return `${suite.baseUrl}/nc`; },
  appName: 'Toscana Diagnostica · Non Conformità',
  // StudioLAB ServiceNET (CB Sistemi)
  lis: {
    // Produzione Toscana Diagnostica: https://servicenet.toscanadiagnostica.it (nodo ServiceNET "GIPONEXT"); demo CB: https://servicenet.studiolab.it
    baseUrl: (env.LIS_BASE_URL || 'https://servicenet.toscanadiagnostica.it').replace(/\/(API\/?)?$/i, ''),
    apiKey: env.LIS_API_KEY || '',
    codiceCliente: env.LIS_CODICE_CLIENTE || 'TD',
    segnalazioni: (env.LIS_SEGNALAZIONI || 'true') === 'true',
    tipoSegnalazione: Number(env.LIS_TIPO_SEGNALAZIONE || 0),
    mittente: env.LIS_MITTENTE || 'td-nc',
    pushSecret: env.LIS_PUSH_SECRET || '',                 // segreto condiviso per /api/nc/lis/push e /api/nc/hl7
    writeBack: (env.LIS_WRITE_BACK || 'false') === 'true',
    timeoutMs: Number(env.LIS_TIMEOUT_MS || 12000),
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
