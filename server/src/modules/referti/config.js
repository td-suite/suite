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
};

// Impostazioni del modulo (app_settings dello schema) con i valori predefiniti
export const SETTINGS_DEFAULT = {
  onedrive_folder: 'OneDrive - Toscana Diagnostica S.r.l\\Laboratorio di Analisi\\EXT - Referti Microbiologia\\',
  genera_pdf: true,
  retention_giorni: 0,          // 0 = i PDF sorgente non vengono mai eliminati
  suffisso_predefinito: 'ESAME',   // ESAME | SORGENTE | DATA: come si compone il suffisso tra parentesi quando il nome file esiste già
};
