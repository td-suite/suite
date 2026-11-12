// Lab Control (chiave tecnica `etichette`, area Retail and Flow Management dopo il Business Hub), v0.71.0 (CEO 12/11/2026; già Label
// v0.69.0): controllo del laboratorio sulle accettazioni StudioLab (cruscotto, accettazioni con le fasi, campioni, ritardi, tempi di
// refertazione, esami non eseguiti, clienti) e, come sezione, Label con il suo menu di prima (stampa etichette, modelli, registro,
// impostazioni). OPERATORE: sedi del proprio perimetro; LABORATORIO: tutte le accettazioni, senza impostazioni; ADMIN: tutto.
export default {
  key: 'etichette',
  title: 'Lab Control',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'stats', label: 'Cruscotto', end: true },
    { to: 'accettazioni', icon: 'list', label: 'Accettazioni' },
    { to: 'campioni', icon: 'tag', label: 'Campioni' },
    { to: 'ritardi', icon: 'alert', label: 'In ritardo' },
    { to: 'tat', icon: 'clock', label: 'Tempi di refertazione' },
    { to: 'non-eseguiti', icon: 'x', label: 'Esami non eseguiti' },
    { to: 'clienti', icon: 'building', label: 'Clienti' },
    { group: 'Label' },
    { to: 'label', icon: 'printer', label: 'Stampa etichette', end: true },
    { to: 'label/modelli', icon: 'etichette', label: 'Modelli', profiles: ['ADMIN'] },
    { to: 'label/registro', icon: 'list', label: 'Registro stampe', profiles: ['ADMIN'] },
    { to: 'label/impostazioni', icon: 'gear', label: 'Impostazioni Label', profiles: ['ADMIN'] },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
  ],
};
