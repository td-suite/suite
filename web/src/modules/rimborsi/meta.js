// Rimborso Spese dentro la Suite (area People): voci di menu disegnate dalla Suite. SOLO per i dipendenti (regola SOLO_DIPENDENTI del
// server: la Home lo mostra solo a loro, l'API risponde 403 a tutti gli altri). Nessun grant: i flag (GET /api/rimborsi/badges) mostrano
// "Da approvare" a chi ha riporti in organigramma (o è P&C), "Liquidazione" a P&C, "Impostazioni" a P&C e al titolare.
export default {
  key: 'rimborsi',
  title: 'Rimborso Spese',
  kicker: 'People',
  area: 'PEOPLE',
  openToAll: true,
  soloInterni: true,
  nav: [
    { to: '', icon: 'doc', label: 'Le mie note spese', end: true, badge: 'bozze', flag: 'dipendente' },
    { to: 'veicoli', icon: 'key', label: 'Veicoli e fuel card', flag: 'dipendente' },
    { to: 'archivio', icon: 'folder', label: 'Archivio', flag: 'dipendente' },
    { group: 'Responsabili', flag: 'responsabile' },
    { to: 'da-approvare', icon: 'check', label: 'Da approvare', badge: 'da_approvare', flag: 'responsabile' },
    { group: 'P&C', flag: 'gestione' },
    { to: 'liquidazione', icon: 'stats', label: 'Liquidazione', badge: 'da_liquidare', flag: 'pc' },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', flag: 'gestione' },
  ],
};
