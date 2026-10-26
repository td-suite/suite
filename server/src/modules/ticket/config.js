// Configurazione del modulo Ticket (variabili d'ambiente con prefisso TICKET_, tutte facoltative)
import { config as suite } from '../../config.js';

const env = process.env;
export const config = {
  appName: 'Ticket',
  baseUrl: suite.baseUrl,
  protocolPrefix: env.TICKET_PROTOCOL_PREFIX || 'TK',
  // Allegati: tipi ammessi, dimensione massima e numero massimo per ticket
  maxFileBytes: Number(env.TICKET_MAX_FILE_MB || 10) * 1024 * 1024,
  maxFilesPerTicket: Number(env.TICKET_MAX_FILES || 10),
  allowedExt: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'xlsx', 'txt', 'csv'],
  // Giorni entro cui il richiedente può riaprire un ticket RISOLTO
  riaperturaGiorni: Number(env.TICKET_RIAPERTURA_GIORNI || 7),
  // Intervallo del job (minuti): SLA sforati, escalation, chiusura automatica
  jobMinutes: Number(env.TICKET_JOB_MINUTES || 15),
};
