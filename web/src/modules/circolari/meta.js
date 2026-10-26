// Circolari aziendali dentro la Suite: voci di menu disegnate dalla Suite.
// Profili: ADMIN, PUBBLICATORE (pubblica, invia, revisiona), REDATTORE (bozze e anteprime), VIEWER.
const REDAZIONE = ['ADMIN', 'PUBBLICATORE', 'REDATTORE'];
const PUBBLICAZIONE = ['ADMIN', 'PUBBLICATORE'];
export default {
  key: 'circolari',
  title: 'Circolari',
  kicker: 'Comunicazione',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'Circolari' },
    { to: 'archivio', icon: 'folder', label: 'Archivio e ricerca' },
    { to: 'bozze', icon: 'edit', label: 'Bozze', badge: 'bozze', profiles: REDAZIONE },
    { to: 'nuova', icon: 'plus', label: 'Nuova circolare', profiles: REDAZIONE },
    { group: 'Diffusione', profiles: PUBBLICAZIONE },
    { to: 'liste', icon: 'users', label: 'Liste di distribuzione', profiles: PUBBLICAZIONE },
    { group: 'Aiuto' },
    { to: 'guida', icon: 'info', label: 'Guida all\'uso' },
  ],
};
