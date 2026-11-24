// Recupero Crediti (chiave `crediti`, area FINANCE), v0.95.0. Casella mittente e di ascolto: amministrazione@toscanadiagnostica.it
// (CREDITI_MAILBOX la cambia senza toccare le impostazioni).
export const KEY = 'crediti';
export const config = {
  mailboxEnv: (process.env.CREDITI_MAILBOX || '').trim().toLowerCase() || null,
  mailboxDefault: 'amministrazione@toscanadiagnostica.it',
  aiMock: () => process.env.NODE_ENV !== 'production' && process.env.CREDITI_AI_MOCK === '1',
};
