// Modulo Business Hub (ex "Contratti B2C/B2B", 06/11/2026): voci di navigazione disegnate dalla Suite (la sidebar dell'app non si porta).
// La chiave resta `business`: percorsi /business, API /api/business, grant e profili invariati.
// Menu del CEO (06/11/2026): "Prima sezione: Management con Panoramica contratti e Tutti i contratti e Organizzazione e Sedi. Poi Service di
// Laboratorio con Cruscotto, Pipeline, Clienti e prospect, DB Opportunità, Email da assegnare, Clienti. Poi Punti Prelievo con Punti Prelievo
// e Sedi TD in locazione. Poi Medicina del Lavoro. Infine Amministrazione." Cruscotto e Pipeline della sezione Service sono filtrati sulla
// linea SRV (?linea=SRV, dalla pagina si vedono anche tutte le linee); i Fascicoli autorizzazione si aprono dalla pagina Punti Prelievo.
// Una voce con `to` che inizia per "?" resta sulla pagina principale del modulo con il filtro nell'indirizzo (components/Shell.jsx).
export default {
  key: 'business',
  title: 'Business Hub',
  kicker: 'Business',
  area: 'RETAIL_FLOW',
  nav: [
    { group: 'Management' },
    { to: 'contratti-panoramica', icon: 'grid', label: 'Panoramica contratti' },
    { to: 'contratti', icon: 'list', label: 'Tutti i contratti', badge: 'contratti_in_scadenza' },
    { to: 'organizzazioni', icon: 'building', label: 'Organizzazioni e sedi' },
    { group: 'Service di Laboratorio' },
    { to: '?linea=SRV', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'pipeline?linea=SRV', icon: 'stats', label: 'Pipeline' },
    { to: 'clienti', icon: 'users', label: 'Clienti e prospect', badge: 'da_confermare' },
    { to: 'db-opportunita', icon: 'sheet', label: 'DB Opportunità' },
    { to: 'email', icon: 'mail', label: 'Email da assegnare', badge: 'email_da_assegnare' },
    { to: 'clienti-attivi', icon: 'check', label: 'Clienti', badge: 'da_verificare' },
    { group: 'Punti Prelievo' },
    { to: 'punti-prelievo', icon: 'pin', label: 'Punti Prelievo', badge: 'fascicoli_aperti' },
    { to: 'sedi', icon: 'room', label: 'Sedi TD in locazione' },
    { group: 'Medicina del Lavoro' },
    { to: 'medicina-del-lavoro', icon: 'user', label: 'Medicina del Lavoro' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
