// Guida GIPO (chiave tecnica `gipoguida`, area Retail and Flow Management dopo Label), v0.70.0: guida completa di GipoNext, FAQ, ricerca e
// domande con risposta. Aperto a tutti gli interni (openToAll); gli accessi esterni non lo vedono (soloInterni: la Home lo nasconde, il
// server risponde 403). Redazione (sezioni, FAQ, domande da risolvere, statistiche) solo al profilo ADMIN; badge "coda" = domande in coda.
export default {
  key: 'gipoguida',
  title: 'Guida GIPO',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  openToAll: true,
  soloInterni: true,
  nav: [
    { to: '', icon: 'comment', label: 'Chiedi', end: true },
    { to: 'guida', icon: 'doc', label: 'Guida' },
    { to: 'faq', icon: 'list', label: 'FAQ' },
    { group: 'Redazione', profiles: ['ADMIN'] },
    { to: 'redazione', icon: 'edit', label: 'Redazione', badge: 'coda', profiles: ['ADMIN'] },
  ],
};
