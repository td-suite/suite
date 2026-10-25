// Modulo Business (Contratti B2C/B2B): voci di navigazione disegnate dalla Suite (la sidebar dell'app non si porta)
export default {
  key: 'business',
  title: 'Contratti B2C/B2B',
  kicker: 'Business',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'home', label: 'Dashboard', end: true },
    { group: 'Anagrafiche' },
    { to: 'partner', icon: 'building', label: 'Partner e clienti B2B' },
    { to: 'contratti', icon: 'list', label: 'Tutti i contratti' },
    { to: 'fascicoli', icon: 'folder', label: 'Fascicoli autorizzazione' },
    { group: 'Sezioni' },
    { to: 'punti-prelievo', icon: 'pin', label: 'Punti Prelievo' },
    { to: 'sedi', icon: 'room', label: 'Sedi TD in locazione' },
    { to: 'service', icon: 'service', label: 'Service di Laboratorio' },
    { to: 'medicina-del-lavoro', icon: 'user', label: 'Medicina del Lavoro' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
    { to: 'importazione', icon: 'import', label: 'Importazione', profiles: ['ADMIN'] },
  ],
};
