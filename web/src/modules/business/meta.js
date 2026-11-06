// Modulo Business Hub (ex "Contratti B2C/B2B", 06/11/2026): voci di navigazione disegnate dalla Suite (la sidebar dell'app non si porta).
// La chiave resta `business`: percorsi /business, API /api/business, grant e profili invariati.
export default {
  key: 'business',
  title: 'Business Hub',
  kicker: 'Business',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'pipeline', icon: 'stats', label: 'Pipeline' },
    { to: 'clienti', icon: 'users', label: 'Clienti e prospect', badge: 'da_confermare' },
    { to: 'db-opportunita', icon: 'sheet', label: 'DB Opportunità' },
    { to: 'email', icon: 'mail', label: 'Email da assegnare', badge: 'email_da_assegnare' },
    { group: 'Contratti e autorizzazioni' },
    { to: 'contratti-panoramica', icon: 'grid', label: 'Panoramica contratti' },
    { to: 'contratti', icon: 'list', label: 'Tutti i contratti', badge: 'contratti_in_scadenza' },
    { to: 'fascicoli', icon: 'folder', label: 'Fascicoli autorizzazione', badge: 'fascicoli_aperti' },
    { to: 'punti-prelievo', icon: 'pin', label: 'Punti Prelievo' },
    { to: 'sedi', icon: 'room', label: 'Sedi TD in locazione' },
    { to: 'service', icon: 'service', label: 'Service di Laboratorio' },
    { to: 'medicina-del-lavoro', icon: 'user', label: 'Medicina del Lavoro' },
    { to: 'organizzazioni', icon: 'building', label: 'Organizzazioni e sedi' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
