// Room Planning dentro la Suite: voci di menu disegnate dalla Suite (nessuna sidebar propria).
// I professionisti (PROF) vedono solo il proprio portale: riepilogo, disponibilità, turni e presenze, rendiconti, bacheca.
// I gruppi hanno anch'essi "profiles", così la Suite non mostra intestazioni vuote.
const INTERNI = ['ADMIN', 'PLANNER', 'RESP_SAN', 'VIEWER'];
const GESTIONE = ['ADMIN', 'RESP_SAN'];
export default {
  key: 'room',
  title: 'Room Planning',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { group: 'Il mio portale', profiles: ['PROF'] },
    { to: 'portale', icon: 'home', label: 'Riepilogo', profiles: ['PROF'] },
    { to: 'disponibilita', icon: 'list', label: 'Le mie disponibilità', profiles: ['PROF'] },
    { group: 'Network', profiles: INTERNI },
    { to: '', icon: 'home', label: 'Cruscotto', end: true, profiles: INTERNI },
    { to: 'specialisti', icon: 'users', label: 'Tutti i professionisti', profiles: INTERNI },
    { to: 'calendario', icon: 'calendar', label: 'Calendario', profiles: INTERNI },
    { group: 'Pianificazione', profiles: INTERNI },
    { to: 'sedi', icon: 'building', label: 'Sedi e ambulatori', profiles: INTERNI },
    { group: 'Personale sanitario' },
    { to: 'professionisti', icon: 'user', label: 'Professionisti', profiles: GESTIONE },
    { to: 'turni', icon: 'clock', label: 'Turni' },
    { to: 'presenze', icon: 'check', label: 'Presenze', profiles: INTERNI },
    { to: 'rendiconti', icon: 'cash', label: 'Rendiconti', profiles: ['ADMIN', 'RESP_SAN', 'PROF'] },
    { to: 'fabbisogno', icon: 'alert', label: 'Fabbisogno', profiles: INTERNI },
    { to: 'bacheca', icon: 'megaphone', label: 'Bacheca' },
    { to: 'statistiche', icon: 'stats', label: 'Statistiche', profiles: GESTIONE },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni e backup', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
