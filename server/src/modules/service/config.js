// Configurazione del modulo Portale Service (variabili d'ambiente con prefisso SERVICE_, tutte facoltative)
const env = process.env;

export const KEY = 'service';
export const ORIGINE_DEFAULT = 'https://service.toscanadiagnostica.it';
export const VADEMECUM_ONLINE_DEFAULT = 'https://referti.toscanadiagnostica.it/vademecum';
// PDF del Vademecum nello specchio quando menu.json (voce vademecum, campo "pdf") e lo ZIP non dicono altro
export const VADEMECUM_PDF_DEFAULT = 'vademecum/Toscana Diagnostica - Vademecum degli esami.pdf';

export const config = {
  // Origine dello specchio: SERVICE_PORTAL_URL prevale sul valore salvato in Impostazioni (che prevale sul predefinito)
  origineEnv: (env.SERVICE_PORTAL_URL || '').trim().replace(/\/+$/, ''),
  // Vademecum online da incorporare. Solo da variabile d'ambiente: la sua origine entra nella CSP della Suite (frame-src) all'avvio
  vademecumUrl: (env.SERVICE_VADEMECUM_URL || VADEMECUM_ONLINE_DEFAULT).trim(),
  // Intervallo dello specchio (minuti): 6 ore
  specchioMinuti: Number(env.SERVICE_SPECCHIO_MINUTES || 360),
  // Timeout delle letture dall'origine (ms): JSON e PDF
  timeoutMs: Number(env.SERVICE_TIMEOUT_MS || 20000),
  // Verifica dell'incorporamento del Vademecum: timeout e durata della cache (1 ora)
  provaFrameTimeoutMs: Number(env.SERVICE_FRAME_TIMEOUT_MS || 8000),
  provaFrameCacheMs: 60 * 60 * 1000,
  // ZIP del repo caricato dalle Impostazioni (il repo con i PDF pesa circa 60 MB)
  zipMaxBytes: Number(env.SERVICE_ZIP_MAX_MB || 200) * 1024 * 1024,
  // Dimensione massima di un singolo file scaricato dall'origine
  fileMaxBytes: Number(env.SERVICE_FILE_MAX_MB || 60) * 1024 * 1024,
};
