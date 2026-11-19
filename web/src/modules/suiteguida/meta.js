// Guida alla Suite (chiave `suiteguida`, area Direzione), v0.89.0: il Manuale d'uso TD-SGI-MAN009 dentro la Suite, FAQ, ricerca, domande
// con risposta e "Guida al widget". Visibile a tutti gli account, esterni compresi. Redazione solo al profilo ADMIN.
export default {
  key: 'suiteguida',
  title: 'Guida alla Suite',
  kicker: 'Direzione',
  area: 'DIREZIONE',
  openToAll: true,
  nav: [
    { to: '', icon: 'comment', label: 'Chiedi', end: true },
    { to: 'guida', icon: 'doc', label: 'Guida' },
    { to: 'faq', icon: 'list', label: 'FAQ' },
    { group: 'Redazione', profiles: ['ADMIN'] },
    { to: 'redazione', icon: 'edit', label: 'Redazione', badge: 'coda', profiles: ['ADMIN'] },
  ],
};
