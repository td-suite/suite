// Versione della Suite (tag git della consegna). Visibile in /api/health e in Amministrazione > Impostazioni: serve a capire
// quale consegna gira in produzione quando una funzione "non si trova".
export const APP_VERSION = process.env.APP_VERSION || '0.40.1';
