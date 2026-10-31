// Facility e Manutenzioni dentro la Suite: voci di menu disegnate dalla Suite. Solo chi ha il grant entra nel modulo (open_to_all FALSE).
// Profili: ADMIN, FACILITY, MANUTENTORE, SITE (ambito sede), VIEWER. Contatori da GET /api/facility/badges: "scadute" (scadenze del
// piano scadute) e "urgenti" (interventi URGENTE o ALTA aperti).
export default {
  key: 'facility',
  title: 'Facility e Manutenzioni',
  kicker: 'Operations',
  area: 'OPERATIONS',
  nav: [
    { to: '', icon: 'stats', label: 'Cruscotto', end: true },
    { to: 'immobili', icon: 'building', label: 'Immobili', profiles: ['FACILITY', 'SITE', 'VIEWER'] },
    { to: 'dispositivi', icon: 'qr', label: 'Dispositivi' },
    { to: 'piano', icon: 'calendar', label: 'Piano manutenzioni', badge: 'scadute' },
    { to: 'interventi', icon: 'wrench', label: 'Interventi', badge: 'urgenti' },
    { group: 'Energia', profiles: ['FACILITY', 'SITE', 'VIEWER'] },
    { to: 'utenze', icon: 'bolt', label: 'Utenze', profiles: ['FACILITY', 'SITE', 'VIEWER'] },
    { to: 'energia', icon: 'sun', label: 'Energia', profiles: ['FACILITY', 'SITE', 'VIEWER'] },
    { to: 'report', icon: 'pdf', label: 'Report' },
    { group: 'Impostazioni', profiles: ['FACILITY'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['FACILITY'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
