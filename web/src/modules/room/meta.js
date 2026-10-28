// Room Planning dentro la Suite: voci di menu disegnate dalla Suite (nessuna sidebar propria).
// I professionisti (PROF) vedono solo il proprio portale: riepilogo, disponibilità, turni e presenze, rendiconti, bacheca.
// Amministratore e Planner (e il titolare della Suite, che nel modulo è ADMIN) hanno le stesse due pagine nel gruppo
// "Portale dei professionisti", con la tendina per scegliere il professionista (richiesta del CEO, 28/10/2026).
// I gruppi hanno anch'essi "profiles", così la Suite non mostra intestazioni vuote; onlyProfiles evita il doppione per il titolare.
const INTERNI = ['ADMIN', 'PLANNER', 'RESP_SAN', 'VIEWER'];
const GESTIONE = ['ADMIN', 'RESP_SAN'];
const PORTALE_INTERNI = ['ADMIN', 'PLANNER'];
export default {
  key: 'room',
  title: 'Room Planning',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { group: 'Il mio portale', profiles: ['PROF'], onlyProfiles: true },
    { to: 'portale', icon: 'home', label: 'Riepilogo', profiles: ['PROF'], onlyProfiles: true },
    { to: 'disponibilita', icon: 'list', label: 'Le mie disponibilità', profiles: ['PROF'], onlyProfiles: true },
    { group: 'Network', profiles: INTERNI },
    { to: '', icon: 'home', label: 'Cruscotto', end: true, profiles: INTERNI },
    { to: 'specialisti', icon: 'users', label: 'Tutti i professionisti', profiles: INTERNI },
    { to: 'calendario', icon: 'calendar', label: 'Calendario', profiles: INTERNI },
    { group: 'Pianificazione', profiles: INTERNI },
    { to: 'sedi', icon: 'building', label: 'Sedi e ambulatori', profiles: INTERNI },
    { group: 'Portale dei professionisti', profiles: PORTALE_INTERNI },
    { to: 'portale', icon: 'home', label: 'Riepilogo', profiles: PORTALE_INTERNI },
    { to: 'disponibilita', icon: 'list', label: 'Disponibilità', profiles: PORTALE_INTERNI },
    { group: 'Personale sanitario' },
    { to: 'professionisti', icon: 'user', label: 'Professionisti', profiles: GESTIONE },
    { to: 'turni', icon: 'clock', label: 'Turni' },
    { to: 'presenze', icon: 'check', label: 'Presenze', profiles: INTERNI },
    { to: 'rendiconti', icon: 'cash', label: 'Rendiconti', profiles: ['ADMIN', 'RESP_SAN', 'PROF'] },
    { to: 'fabbisogno', icon: 'alert', label: 'Fabbisogno', badge: 'scoperti', profiles: INTERNI },
    { to: 'bacheca', icon: 'megaphone', label: 'Comunicazioni ai professionisti' },
    { to: 'statistiche', icon: 'stats', label: 'Statistiche', profiles: GESTIONE },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni e backup', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
