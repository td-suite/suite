// Configurazione del modulo Audit SGI (variabili d'ambiente con prefisso AUDIT_, tutte facoltative)
const env = process.env;

export const KEY = 'audit';
export const MB = 1024 * 1024;

export const config = {
  appName: 'Audit SGI',
  // PDF delle terze parti e allegati: fino a 25 MB l'uno, più file per caricamento
  maxFileBytes: Number(env.AUDIT_MAX_FILE_MB || 25) * MB,
  maxFilesPerUpload: Number(env.AUDIT_MAX_FILES || 10),
  // Testo estratto da un PDF di terze parti conservato per la sintesi (caratteri)
  maxTerziText: Number(env.AUDIT_TERZI_TEXT_MAX || 60_000),
  // Nel prompt della sintesi: per ciascun PDF di terze parti e in totale
  synthTerziEach: 8_000,
  synthTerziTotal: 60_000,
  // Intervallo del lavoro dell'alert del 17 (minuti)
  jobMinutes: Number(env.AUDIT_JOB_MINUTES || 60),
  // Sintesi simulata senza chiave Anthropic (solo fuori produzione): costruita dai punteggi reali con testi standard
  aiMock: env.AUDIT_AI_MOCK === '1' && env.NODE_ENV !== 'production',
};

// Impostazioni del modulo (app_settings dello schema) con i valori predefiniti
export const SETTINGS_DEFAULT = {
  alert_day: 17,              // giorno del mese in cui parte l'avviso al site manager per l'auto-audit del mese
  reminder_every_days: 5,     // promemoria ogni N giorni finché l'auto-audit non è inviato (0 = nessun promemoria)
};

export const KINDS = { AUTO: 'Auto-audit', INTERNO: 'Audit interno', TERZI: 'Audit di terze parti', LEGAL_ENTITY: 'Audit partner ISO 37001' };
export const STATUS_LABEL = { BOZZA: 'Bozza', INVIATO: 'Inviato', VERIFICATO: 'Verificato', CHIUSO: 'Chiuso', CARICATO: 'Caricato' };
export const ENTE_TIPI = ['CERTIFICATORE', 'ASL', 'ISPETTIVO', 'ALTRO'];
export const ESITI_TERZI = ['CONFORME', 'CONFORME_CON_RILIEVI', 'NON_CONFORME', 'ALTRO'];
export const ANSWER_VALUES = ['SI', 'NO', 'NC', 'NA'];
// Sedi "struttura" soggette all'auto-audit mensile (non SERVICE, non HEADQUARTER)
export const STRUCTURE_KINDS = ['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'CENTRO_MEDICO', 'POLIAMBULATORIO', 'LABORATORIO'];
// Legal entity interne al gruppo (non auditabili come partner)
export const INTERNAL_ORG_KINDS = ['GRUPPO', 'SOCIETA'];
