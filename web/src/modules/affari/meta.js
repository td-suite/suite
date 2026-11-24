// Public Affairs dentro la Suite (area Direzione): novità da avvisi, bandi e normativa sanitaria; fonti e impostazioni per chi gestisce.
export default {
  key: 'affari',
  title: 'Public Affairs',
  kicker: 'Direzione',
  area: 'DIREZIONE',
  soloInterni: true,
  nav: [
    { to: '', icon: 'news', label: 'Novità', end: true, badge: 'novita' },
    { to: 'archivio', icon: 'folder', label: 'Archivio' },
    { to: 'normativa', icon: 'shield', label: 'Normativa di riferimento' },
    { to: 'fonti', icon: 'list', label: 'Fonti monitorate', badge: 'fonti_errore' },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni' },
  ],
};
