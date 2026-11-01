// Circolari aziendali dentro la Suite: voci di menu disegnate dalla Suite.
// Profili: ADMIN, PUBBLICATORE (pubblica, invia, revisiona), REDATTORE (bozze e anteprime), VIEWER.
const REDAZIONE = ['ADMIN', 'PUBBLICATORE', 'REDATTORE'];
const PUBBLICAZIONE = ['ADMIN', 'PUBBLICATORE'];
export default {
  key: 'circolari',
  title: 'Circolari',
  kicker: 'Comunicazione',
  area: 'RETAIL_FLOW',
  // Aperto a tutti gli account (seme open_to_all, server con openToAll): senza questo flag la cornice dei moduli rifiutava chi non ha il
  // grant, anche se la card è in home e la voce "Circolari e aggiornamenti" del Portale Service vi porta (01/11/2026)
  openToAll: true,
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
