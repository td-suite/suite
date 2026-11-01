// SGI Management dentro la Suite (01/11/2026): copia conforme del sito pubblico sgi.toscanadiagnostica.it, stesse funzioni del cruscotto
// e stesse scorciatoie della barra laterale del sito. Aperto a tutti gli autenticati (openToAll; SGI pubblico per decisione AD
// 01/10/2026), clienti service compresi; Impostazioni solo per EDITOR (e amministratori).
export default {
  key: 'sgi',
  title: 'SGI Management',
  kicker: 'HQS',
  area: 'HQS',
  openToAll: true,
  // per il personale TD la card in Home apre il portale in una scheda nuova con il menu "Apri pagina…" (come il Portale Service)
  homeSchedaNuova: true,
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto documentale', end: true },
    { to: 'preparazioni', icon: 'heart', label: 'Preparazioni agli esami' },
    { group: 'Scorciatoie' },
    { to: 'ultime', icon: 'clock', label: 'Ultime emissioni' },
    { to: 'cardine', icon: 'star', label: 'Documenti cardine' },
    { to: 'stampabili', icon: 'file', label: 'Versioni stampabili' },
    { to: 'indice', icon: 'list', label: 'Indice REG006' },
    { to: 'mappa', icon: 'tree', label: 'Mappa concettuale' },
    { to: 'politica', icon: 'shield', label: 'Politica integrata' },
    { group: 'Supporto' },
    { to: 'contatti', icon: 'mail', label: 'Scrivi alla Qualità' },
    { group: 'Gestione', profiles: ['EDITOR'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['EDITOR'] },
  ],
};
