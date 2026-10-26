// Configurazione del modulo Cartella condivisa (variabili d'ambiente con prefisso CARTELLA_, tutte facoltative)
const env = process.env;

// Tipi ammessi: estensione → MIME servito (non ci si fida del MIME dichiarato dal browser)
export const TIPI = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

export const config = {
  appName: 'Cartella condivisa',
  maxFileBytes: Number(env.CARTELLA_MAX_FILE_MB || 50) * 1024 * 1024,
  maxFilesPerUpload: Number(env.CARTELLA_MAX_FILES || 20),
  allowedExt: Object.keys(TIPI),
  // Giorni entro cui un documento non ancora aperto conta come "nuovo per me"
  novitaGiorni: Number(env.CARTELLA_NOVITA_GIORNI || 30),
};
