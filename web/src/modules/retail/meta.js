// Retail Assistant dentro la Suite: voci di menu disegnate dalla Suite (nessuna sidebar propria).
// Profili: ADMIN (tutto), RETAIL (tutto tranne connettori, impostazioni e registro), SEDE (lettura e book della propria sede), VIEWER (sola lettura).
const WRITERS = ['ADMIN', 'RETAIL'];
export default {
  key: 'retail',
  title: 'Retail Assistant',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'Clienti' },
    { to: 'clienti', icon: 'users', label: 'Clienti e profilazione', end: true },
    { to: 'clienti/b2b', icon: 'building', label: 'Aziende e strutture (B2B)' },
    { to: 'richiami', icon: 'bell', label: 'Richiami periodici', badge: 'richiami_scaduti' },
    { group: 'Vendite' },
    { to: 'prodotti', icon: 'list', label: 'Prestazioni e prodotti' },
    { to: 'vendite', icon: 'cash', label: 'Accettazioni e vendite' },
    { to: 'import', icon: 'upload', label: 'Import dai gestionali', profiles: WRITERS },
    { group: 'Controllo e marketing' },
    { to: 'budget', icon: 'stats', label: 'Budget e scostamenti' },
    { to: 'campagne', icon: 'megaphone', label: 'Campagne', badge: 'campagne_attive' },
    { to: 'promozioni', icon: 'calendar', label: 'Calendario promozionale' },
    { group: 'Retail in sede' },
    { to: 'esposizione', icon: 'image', label: 'Esposizione e book retail' },
    { to: 'sedi', icon: 'pin', label: 'Sedi del network' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'connettori', icon: 'cloud', label: 'Connettori', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
