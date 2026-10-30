// Audit SGI dentro la Suite: voci di menu disegnate dalla Suite. Solo chi ha il grant entra nel modulo (open_to_all FALSE).
// Profili: ADMIN, QUALITA, AUDITOR, SITE (ambito sede), VIEWER. I contatori arrivano da GET /api/audit/badges:
// "miei" = ciò che compare in "I miei audit" (da compilare per SITE; da verificare e propri in corso per gli altri); "mancanti" = sedi senza auto-audit del mese (Piano degli Audit).
export default {
  key: 'audit',
  title: 'Audit SGI',
  kicker: 'HQS',
  area: 'HQS',
  nav: [
    { to: '', icon: 'stats', label: 'Cruscotto', end: true },
    { to: 'miei', icon: 'check', label: 'I miei audit', badge: 'miei' },
    { to: 'sedi', icon: 'building', label: 'Piano degli Audit', badge: 'mancanti' },
    { to: 'partner', icon: 'shield', label: 'Audit Partner', profiles: ['QUALITA', 'AUDITOR', 'VIEWER'] },
    { to: 'archivio', icon: 'folder', label: 'Archivio' },
    { to: 'sintesi', icon: 'sparkle', label: 'Sintesi TD', profiles: ['QUALITA', 'AUDITOR', 'VIEWER'] },
    { group: 'Impostazioni', profiles: ['QUALITA'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['QUALITA'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
