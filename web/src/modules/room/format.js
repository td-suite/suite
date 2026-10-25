export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : '');
export const ROLE = { ADMIN: 'Amministratore', PLANNER: 'Pianificatore', VIEWER: 'Consultazione', RESP_SAN: 'Responsabile personale sanitario', PROF: 'Professionista' };
export const ROLE_HELP = {
  ADMIN: 'Tutto: pianifica ogni sede, gestisce utenti, backup, cestino e impostazioni.',
  PLANNER: 'Modifica anagrafica, ambulatori, personale e planimetria delle sedi (tutte, o solo quelle assegnate).',
  VIEWER: 'Consulta la pianificazione e scarica PDF ed Excel, senza modificare nulla.',
  RESP_SAN: 'Responsabile del personale sanitario: anagrafiche e compensi dei professionisti, turni, presenze, approvazione dei rendiconti, bacheca; consulta le sedi.',
  PROF: 'Professionista (medico, infermiere, tecnico, ostetrica…): accede solo al proprio portale. Si crea con l\'invito dalla scheda del professionista.',
};
export const PROVIDER = { LOCAL: 'Email e password', ENTRA: 'Solo Microsoft 365', BOTH: 'Microsoft 365 o password' };
