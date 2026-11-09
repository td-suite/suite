// Piano Ferie dentro la Suite (area People): voci di menu disegnate dalla Suite. Aperto a tutti gli interni (openToAll); gli accessi
// esterni non lo vedono (soloInterni: la Home lo nasconde, il server risponde 403). I flag (da GET /api/ferie/badges) nascondono le
// voci a chi non le usa: "dipendente" = nel perimetro, "approvatore" = superiore diretto di qualcuno (approva i piani dei diretti) o
// amministratore, "catena" e "cruscotto" = chi ha riporti nell'anagrafica (la propria catena) e l'amministratore.
export default {
  key: 'ferie',
  title: 'Piano Ferie',
  kicker: 'People',
  area: 'PEOPLE',
  openToAll: true,
  soloInterni: true,
  nav: [
    { to: '', icon: 'calendar', label: 'Il mio piano', end: true, badge: 'mio_piano_bozza', flag: 'dipendente' },
    { to: 'area', icon: 'users', label: 'Piano dell\'area', badge: 'piani_da_approvare', flag: 'area' },
    { to: 'periodi', icon: 'list', label: 'I miei periodi', badge: 'mie_variazioni', flag: 'dipendente' },
    { to: 'assenze', icon: 'clock', label: 'Oggi e prossimi 14 giorni', badge: 'assenti_oggi', flag: 'area' },
    { group: 'Responsabili', flag: 'catena' },
    { to: 'catena', icon: 'tree', label: 'La mia catena', badge: 'piani_da_approvare', flag: 'catena' },
    { to: 'variazioni', icon: 'refresh', label: 'Variazioni da decidere', badge: 'variazioni_da_approvare', flag: 'approvatore' },
    { to: 'cruscotto', icon: 'stats', label: 'Cruscotto', flag: 'cruscotto' },
    { to: 'storico', icon: 'folder', label: 'Storico dei periodi', flag: 'cruscotto' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
