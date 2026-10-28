// Referti esterni dentro la Suite: voci di menu disegnate dalla Suite. Solo chi ha il grant entra nel modulo (open_to_all FALSE).
// Profili: LAB (elabora e conferma), QUALITA (registro e impostazioni), VIEWER (consultazione). Il contatore "da_confermare"
// (schede in bozza) arriva da GET /api/referti/badges.
export default {
  key: 'referti',
  title: 'Referti esterni',
  kicker: 'Operations',
  area: 'OPERATIONS',
  nav: [
    { to: '', icon: 'upload', label: 'Inbox', end: true, badge: 'da_confermare' },
    { to: 'archivio', icon: 'folder', label: 'Archivio' },
    { to: 'registro', icon: 'list', label: 'Registro' },
    { group: 'Impostazioni', profiles: ['QUALITA'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['QUALITA'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
