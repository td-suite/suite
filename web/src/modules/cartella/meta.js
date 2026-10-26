// Cartella condivisa dentro la Suite: voci di menu disegnate dalla Suite. Solo chi ha il grant (VIEWER o ADMIN) entra nel modulo;
// i contatori "evidenza" e "novita" arrivano da GET /api/cartella/badges.
export default {
  key: 'cartella',
  title: 'Cartella condivisa',
  kicker: 'Retail & Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'folder', label: 'Cartella', end: true },
    { to: 'evidenza', icon: 'star', label: 'In evidenza', badge: 'evidenza' },
    { to: 'novita', icon: 'sparkle', label: 'Novità', badge: 'novita' },
    { to: 'cerca', icon: 'search', label: 'Cerca' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'gestione', icon: 'gear', label: 'Gestione', profiles: ['ADMIN'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
