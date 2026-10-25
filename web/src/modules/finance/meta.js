// Modulo Finance (Payments): voci di menu disegnate dalla Suite (la sidebar dell'app non si porta).
// profiles: profili del grant che vedono la voce (OWNER e ADMIN della Suite le vedono tutte).
export default {
  key: 'finance',
  title: 'Payments',
  kicker: 'Finance',
  area: 'FINANCE',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'Autorizzazioni al pagamento' },
    { to: 'istanze/nuova', icon: 'plus', label: 'Nuova istanza', profiles: ['SUPPORT'] },
    { to: 'da-firmare', icon: 'edit', label: 'Da firmare', profiles: ['CEO', 'CFO'], badge: 'da_firmare' },
    { to: 'in-firma', icon: 'mail', label: 'In firma', badge: 'in_firma' },
    { to: 'da-eseguire', icon: 'cash', label: 'Da eseguire', profiles: ['SUPPORT'], badge: 'da_eseguire' },
    { to: 'istanze', icon: 'list', label: 'Tutte le istanze', end: true },
    { to: 'archivio', icon: 'folder', label: 'Archivio' },
    { group: 'Anagrafiche' },
    { to: 'beneficiari', icon: 'users', label: 'Beneficiari e IBAN' },
    { group: 'Amministrazione', profiles: ['SUPPORT'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['SUPPORT'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: [] },
  ],
};
