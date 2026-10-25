// Non conformità dentro la Suite: voci di menu disegnate dalla Suite (nessuna sidebar propria).
// I profili sono quelli dell'app: ADMIN, QUALITA, LAB (laboratorio), SEDE (sedi invianti e clienti Service), VIEWER.
const LAB = ['ADMIN', 'QUALITA', 'LAB'];
const INTERNI = ['ADMIN', 'QUALITA', 'LAB', 'VIEWER'];
const QUALITA = ['ADMIN', 'QUALITA'];
export default {
  key: 'nc',
  title: 'Non conformità',
  kicker: 'HQS',
  area: 'HQS',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'Preanalitica', profiles: LAB },
    { to: 'desk', icon: 'search', label: 'Desk accettazioni', profiles: LAB },
    { to: 'nc', icon: 'nc', label: 'Non conformità', end: true },
    { to: 'nc/oltre-sla', icon: 'clock', label: 'Oltre SLA', profiles: LAB },
    { group: 'Le mie sedi', profiles: ['SEDE'], onlyProfiles: true },
    { to: 'accettazioni', icon: 'list', label: 'Accettazioni con NC', profiles: ['SEDE'], onlyProfiles: true },
    { group: 'Analisi' },
    { to: 'statistiche', icon: 'stats', label: 'Statistiche' },
    { to: 'sedi', icon: 'building', label: 'Sedi invianti', profiles: INTERNI },
    { group: 'Qualità', profiles: QUALITA },
    { to: 'nc/da-verificare', icon: 'check', label: 'Da verificare', profiles: QUALITA },
    { to: 'tipi', icon: 'grid', label: 'Catalogo tipologie', profiles: QUALITA },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: QUALITA },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni e LIS', profiles: QUALITA },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida all\'uso' },
    { to: 'notifiche', icon: 'bell', label: 'Le mie notifiche' },
  ],
};
