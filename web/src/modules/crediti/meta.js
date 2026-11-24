// Recupero Crediti dentro la Suite (area Finance). Le voci si mostrano secondo i permessi calcolati dal server (GET /api/crediti/badges):
// vista completa (CEO, CFO, Amministrazione, sola lettura), referente commerciale (i suoi clienti e le chiamate), area legale (le pratiche).
export default {
  key: 'crediti',
  title: 'Recupero Crediti',
  kicker: 'Finance',
  area: 'FINANCE',
  soloInterni: true,
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true, flag: 'v_tutto' },
    { to: 'clienti', icon: 'building', label: 'Clienti e scaduto', flag: 'v_clienti' },
    { group: 'Da fare', flag: 'v_tutto' },
    { to: 'comunicazioni', icon: 'mail', label: 'Solleciti', badge: 'da_approvare', flag: 'v_tutto' },
    { to: 'risposte', icon: 'comment', label: 'Risposte dei clienti', badge: 'risposte', flag: 'v_tutto' },
    { to: 'riconciliazione', icon: 'check', label: 'Incassi da abbinare', badge: 'riconciliazione', flag: 'v_tutto' },
    { to: 'chiamate', icon: 'phone', label: 'Chiamate', badge: 'chiamate', flag: 'v_chiamate' },
    { to: 'legale', icon: 'shield', label: 'Area legale', badge: 'legale', flag: 'v_legale' },
    { group: 'Archivio e regole', flag: 'v_tutto' },
    { to: 'fatture', icon: 'sheet', label: 'Fatture e partitario', flag: 'v_tutto' },
    { to: 'esclusi', icon: 'lock', label: 'Clienti esclusi', flag: 'v_tutto' },
    { to: 'banca', icon: 'building', label: 'Conti bancari', flag: 'v_banca' },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', flag: 'v_tutto' },
  ],
};
