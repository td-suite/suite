// Configurazione del modulo Portale SGI (variabili d'ambiente con prefisso SGI_, tutte facoltative)
const env = process.env;

export const KEY = 'sgi';
export const ORIGINE_DEFAULT = 'https://sgi.toscanadiagnostica.it';
// Utente HTTP Basic del sito quando è protetto e l'utente non è indicato (app.py: SGI_USER, predefinito "sgi")
export const UTENTE_PREDEFINITO = 'sgi';

export const config = {
  // Origine dello specchio: SGI_PORTAL_URL prevale sul valore salvato in Impostazioni (che prevale sul predefinito)
  origineEnv: (env.SGI_PORTAL_URL || '').trim().replace(/\/+$/, ''),
  // Credenziali dell'origine se il sito ha SGI_PASSWORD impostata su Render (HTTP Basic sul cruscotto, /docs e /data): prevalgono
  // su quelle salvate in Impostazioni (che sono cifrate nel database come le altre credenziali della Suite)
  utenteEnv: (env.SGI_PORTAL_USER || '').trim(),
  passwordEnv: env.SGI_PORTAL_PASSWORD || '',
  // Intervallo dello specchio (minuti): 6 ore
  specchioMinuti: Number(env.SGI_SPECCHIO_MINUTES || 360),
  // Timeout delle letture dall'origine (ms): JSON (fulltext.json pesa circa 6 MB) e PDF
  timeoutMs: Number(env.SGI_TIMEOUT_MS || 30000),
  // ZIP del repo caricato dalle Impostazioni (il repo con i PDF pesa circa 160 MB)
  zipMaxBytes: Number(env.SGI_ZIP_MAX_MB || 400) * 1024 * 1024,
  // Dimensione massima di un singolo file scaricato dall'origine
  fileMaxBytes: Number(env.SGI_FILE_MAX_MB || 60) * 1024 * 1024,
};
