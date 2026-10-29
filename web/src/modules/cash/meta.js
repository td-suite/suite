// Voci di menu del modulo Cash Management nella sidebar della Suite (percorsi relativi a /cash).
// Riproducono la sidebar dell'app di origine, per fase del processo:
// SUPERADMIN tutto; ADMIN tutto sulla propria azienda; CASSIERE revisione e approvazione; FINANCE cassaforte, versamenti e accrediti;
// OPERATOR rendiconti delle sedi assegnate; PARTNER (struttura ospitante, accesso esterno) "Le tue royalties", royalty di sede e
// statistiche in sola lettura sulle sole sedi ospitate: ogni altra voce resta nascosta (e il server la rifiuta, partnerGuard).
const ALL = ['SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR'];
const ADMINS = ['SUPERADMIN', 'ADMIN'];
const COUNT = ['SUPERADMIN', 'ADMIN', 'OPERATOR'];
const REVIEW = ['SUPERADMIN', 'ADMIN', 'CASSIERE'];
const FINANCE = ['SUPERADMIN', 'ADMIN', 'FINANCE'];
export default {
  key: 'cash',
  title: 'Cash Management',
  kicker: 'Finance',
  area: 'FINANCE',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true, profiles: ALL },
    { group: 'Rendicontazione' },
    { to: 'rendiconti/nuovo', icon: 'plus', label: 'Nuovo rendiconto', profiles: COUNT },
    { to: 'rendiconti', icon: 'cash', label: 'Rendiconti', end: true, profiles: ALL },
    { group: 'Revisione e approvazione' },
    { to: 'revisione', icon: 'check', label: 'Revisione e approvazione', badge: 'revisione', profiles: REVIEW },
    { to: 'nc', icon: 'alert', label: 'Errori e NC', profiles: ALL },
    { to: 'controllo', icon: 'list', label: 'Controllo giornaliero', profiles: ADMINS },
    { group: 'Finance' },
    { to: 'cassaforte', icon: 'shield', label: 'Cassaforte', profiles: FINANCE },
    { to: 'versamenti', icon: 'send', label: 'Versamento al portavalori', profiles: FINANCE },
    { to: 'accrediti', icon: 'building', label: 'Conferma dell\'accredito', profiles: FINANCE },
    { group: 'Royalties', onlyProfiles: true, profiles: ['PARTNER'] },
    { to: 'royalties', icon: 'sheet', label: 'Le tue royalties', onlyProfiles: true, profiles: ['PARTNER'] },
    { group: 'Analisi' },
    { to: 'statistiche', icon: 'stats', label: 'Statistiche', profiles: [...ALL, 'PARTNER'] },
    { to: 'canoni', icon: 'sheet', label: 'Royalty di sede', profiles: ['SUPERADMIN', 'ADMIN', 'PARTNER'] },
    { to: 'riconciliazione', icon: 'refresh', label: 'Riconciliazione bancaria', profiles: ADMINS },
    { to: 'controllo-mensile', icon: 'check', label: 'Controllo mensile casse', profiles: ['SUPERADMIN'] },
    { to: 'royalty', icon: 'external', label: 'Partner: royalty e SEPA', profiles: ['SUPERADMIN'] },
    { group: 'Anagrafiche' },
    { to: 'aziende', icon: 'building', label: 'Aziende', profiles: ADMINS },
    { to: 'sedi', icon: 'pin', label: 'Sedi e fondo cassa', profiles: ADMINS },
    { to: 'operatori', icon: 'users', label: 'Operatori', profiles: ADMINS },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ADMINS },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['SUPERADMIN'] },
  ],
};
