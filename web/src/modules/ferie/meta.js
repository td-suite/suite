// Piano Ferie dentro la Suite (area People): voci di menu disegnate dalla Suite. Aperto a tutti gli interni (openToAll); gli accessi
// esterni non lo vedono (soloInterni: la Home lo nasconde, il server risponde 403). I flag (da GET /api/ferie/badges) nascondono le
// voci a chi non le usa: "dipendente" = nel perimetro, "approvatore" = approva qualcuno o HR, "cruscotto" = HR, consultazione, responsabili.
export default {
  key: 'ferie',
  title: 'Piano Ferie',
  kicker: 'People',
  area: 'PEOPLE',
  openToAll: true,
  soloInterni: true,
  nav: [
    { to: '', icon: 'home', label: 'Le mie ferie', end: true },
    { to: 'nuova', icon: 'plus', label: 'Nuova richiesta', flag: 'dipendente' },
    { to: 'richieste', icon: 'list', label: 'Le mie richieste', badge: 'mie_in_attesa', flag: 'dipendente' },
    { group: 'Piano' },
    { to: 'piano', icon: 'calendar', label: 'Piano per area' },
    { to: 'assenze', icon: 'users', label: 'Oggi e prossimi 14 giorni', badge: 'assenti_oggi' },
    { group: 'Approvazioni e HR', flag: 'cruscotto' },
    { to: 'approvare', icon: 'check', label: 'Da approvare', badge: 'da_approvare', flag: 'approvatore' },
    { to: 'cruscotto', icon: 'stats', label: 'Cruscotto e saldi', flag: 'cruscotto' },
    { to: 'storico', icon: 'folder', label: 'Storico richieste', flag: 'cruscotto' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida' },
  ],
};
