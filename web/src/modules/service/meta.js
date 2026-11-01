// Portale Service dentro la Suite (01/11/2026): copia conforme del sito pubblico service.toscanadiagnostica.it, stesse sezioni e
// stessi testi. Aperto a tutti gli autenticati (openToAll), clienti service compresi; Impostazioni solo per EDITOR (e amministratori).
// Le voci Servizi seguono la rimappatura del CEO: Vademecum incorporato, Circolari/Ordini/NC aprono i widget della Suite.
export default {
  key: 'service',
  title: 'Portale Service',
  kicker: 'HQS',
  area: 'HQS',
  openToAll: true,
  nav: [
    { to: '', icon: 'heart', label: 'Preparazioni e documenti', end: true },
    { to: 'certificazioni', icon: 'shield', label: 'Certificazioni di qualità' },
    { to: 'veq', icon: 'stats', label: 'VEQ · Valutazione Esterna di Qualità' },
    { to: 'agora', icon: 'news', label: 'Agorà · blog' },
    { group: 'Servizi' },
    { to: 'servizi', icon: 'grid', label: 'Tutti i servizi', end: true },
    { to: 'vademecum', icon: 'doc', label: 'Vademecum' },
    { to: 'servizi/circolari', icon: 'list', label: 'Circolari e aggiornamenti operativi' },
    { to: 'servizi/ordine-materiale', icon: 'folder', label: 'Ordine del materiale' },
    { to: 'servizi/promozioni', icon: 'star', label: 'Check-up e promozioni mensili' },
    { to: 'servizi/portale-nc', icon: 'shield', label: 'Portale NC' },
    { to: 'contatti', icon: 'users', label: 'Contatti' },
    { group: 'Gestione', profiles: ['EDITOR'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['EDITOR'] },
  ],
};
