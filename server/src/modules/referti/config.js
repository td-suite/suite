// Configurazione del modulo Referti esterni (variabili d'ambiente con prefisso REFERTI_, tutte facoltative)
const env = process.env;

export const KEY = 'referti';
export const SORGENTI = {
  BIANALISI: 'Bianalisi S.p.A. – Laboratorio Firenze',
  CERBA_RDI: 'Cerba HealthCare – Rete Diagnostica Italiana (Limena)',
  CERBA_NUOVA_IGEA: 'Cerba HealthCare Toscana – Nuova Igea (Firenze)',
  ALTRO: 'Sorgente non riconosciuta',
};

export const config = {
  appName: 'Referti esterni',
  maxFileBytes: Number(env.REFERTI_MAX_FILE_MB || 20) * 1024 * 1024,
  maxFilesPerUpload: Number(env.REFERTI_MAX_FILES || 20),
  pdftotextBin: env.PDFTOTEXT_BIN || 'pdftotext',
  pdfinfoBin: env.PDFINFO_BIN || 'pdfinfo',
  pdftoppmBin: env.PDFTOPPM_BIN || 'pdftoppm',
  tesseractBin: env.TESSERACT_BIN || 'tesseract',
  ocrLang: env.REFERTI_OCR_LANG || 'ita',
  // Sotto questa soglia di caratteri per pagina il PDF si considera senza testo estraibile: si tenta l'OCR
  ocrSogliaCaratteri: Number(env.REFERTI_OCR_SOGLIA || 40),
  // Intervallo del lavoro di retention (minuti)
  jobMinutes: Number(env.REFERTI_JOB_MINUTES || 720),
  // Casella in lettura (richiesta del CEO del 31/10/2026): i PDF che arrivano a template@ diventano elaborazioni e il referto
  // riprodotto riparte da qui al mittente. REFERTI_MAILBOX, se impostata, prevale sull'impostazione del modulo.
  mailboxEnv: (env.REFERTI_MAILBOX || '').trim().toLowerCase(),
  // Intervallo della lettura della casella (minuti)
  inboxMinutes: Number(env.REFERTI_INBOX_MINUTES || 10),
  // Lettura del PDF con Claude (motore del 03/11/2026): spazio di risposta e tempo massimo di una lettura o di una correzione
  letturaMaxTokens: Number(env.REFERTI_AI_MAX_TOKENS || 16000),
  letturaTimeoutMs: Number(env.REFERTI_AI_TIMEOUT_MS || 180_000),
  // REFERTI_AI_MOCK=1 (solo con NODE_ENV diverso da production): lettura e correzione simulate con i JSON attesi delle fixture
  // (server/test/fixtures/referti/lettura), per i test e il collaudo senza chiave Anthropic. Non impostarla su Render.
  get aiMock() { return env.REFERTI_AI_MOCK === '1' && env.NODE_ENV !== 'production'; },
  aiMockDir: env.REFERTI_AI_MOCK_DIR || '',
};

export const MAILBOX_DEFAULT = 'template@toscanadiagnostica.it';

// Impostazioni del modulo (app_settings dello schema) con i valori predefiniti
export const SETTINGS_DEFAULT = {
  onedrive_folder: 'OneDrive - Toscana Diagnostica S.r.l\\Laboratorio di Analisi\\EXT - Referti Microbiologia\\',
  genera_pdf: true,
  // Conservazione dei PDF sorgente (debug pre-produzione L15, decisione del CEO del 05/11/2026): 24 mesi, poi restano la scheda e i file
  // prodotti. 0 = mai eliminati. Si cambia in Referti esterni > Impostazioni.
  retention_mesi: 24,
  suffisso_predefinito: 'ESAME',   // ESAME | SORGENTE | DATA: come si compone il suffisso tra parentesi quando il nome file esiste già
  casella_indirizzo: 'template@toscanadiagnostica.it',   // casella letta (REFERTI_MAILBOX prevale)
  casella_lettura: true,        // "Leggi la casella": job referti:inbox ogni 10 minuti
  invio_mittente: true,         // "Invia al mittente": acceso di default (richiesta del CEO del 31/10/2026)
};
