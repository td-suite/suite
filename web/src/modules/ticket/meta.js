// Ticket dentro la Suite: voci di menu disegnate dalla Suite. Aperto a tutti gli utenti autenticati (openToAll).
// "Da gestire" compare solo a chi è responsabile di almeno una casella, agli ADMIN e ai VIEWER (flag "gestore" da GET /badges).
export default {
  key: 'ticket',
  title: 'Ticket',
  kicker: 'HQS',
  area: 'HQS',
  openToAll: true,
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'Ticket' },
    { to: 'miei', icon: 'user', label: 'I miei ticket', badge: 'miei' },
    { to: 'gestione', icon: 'users', label: 'Da gestire', badge: 'gestione', flag: 'gestore' },
    { to: 'nuovo', icon: 'plus', label: 'Nuovo ticket' },
    { to: 'archivio', icon: 'folder', label: 'Archivio' },
    { to: 'statistiche', icon: 'stats', label: 'Statistiche' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
