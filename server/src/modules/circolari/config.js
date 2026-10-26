// Configurazione del modulo Circolari (variabili d'ambiente con prefisso CIRCOLARI_, tutte facoltative)
import os from 'node:os';
import { config as suite } from '../../config.js';

const env = process.env;
export const config = {
  appName: 'Circolari aziendali',
  baseUrl: suite.baseUrl,
  // Prefisso del protocollo: TD-2026/012 (decisione di Francesco Epifani, 24/10/2026)
  protocolPrefix: env.CIRCOLARI_PROTOCOL_PREFIX || 'TD',
  sofficeBin: env.SOFFICE_BIN || 'soffice',
  loProfile: env.CIRCOLARI_LO_PROFILE || `${os.tmpdir()}/tdc-lo-profile`,
  // Orientamento automatico: orizzontale se una tabella ha più di queste colonne
  landscapeColumns: Number(env.CIRCOLARI_LANDSCAPE_COLUMNS || 5),
  maxEmailBatch: Number(env.CIRCOLARI_MAX_EMAIL_BATCH || 200),
  // Dati societari del piè di pagina (carta intestata luglio 2026)
  footer: {
    line1: 'Toscana Diagnostica S.r.l.',
    line2: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI). Tel. e Fax: 055776511. Direttore Sanitario: prof. Gian Luigi Taddei.',
    line3: 'P.IVA e C.F.: 07528130482, REA n. FI-709602 – Capitale Sociale: € 50.000,00 i.v.',
  },
  contacts: ['info@toscanadiagnostica.it', 'toscanadiagnostica@pec.it', 'www.toscanadiagnostica.it'],
};
