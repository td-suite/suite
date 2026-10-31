// Voci di menu del modulo Orders nella sidebar della Suite (percorsi relativi a /orders), al posto della sidebar dell'app.
// Profili: SUPERADMIN e PROCUREMENT (Area Operations) gestiscono la filiera; CLIENTE ordina dal catalogo e segue i propri ordini;
// SEDE e LAB (strutture TD) caricano, scaricano e dichiarano la giacenza mensile. Le voci di struttura sono nascoste a OWNER/ADMIN
// (onlyProfiles) perché per loro il modulo si comporta da super amministratore.
const OPS = ['SUPERADMIN', 'PROCUREMENT'];
const TD = ['SEDE', 'LAB'];
export default {
  key: 'orders',
  title: 'Ordini e Magazzino',
  kicker: 'Operations',
  area: 'OPERATIONS',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    // Menu Operations riordinato dal CEO (31/10/2026): Set up, Ordini, Giacenze, Gestione
    { group: 'Set up', profiles: OPS },
    { to: 'magazzino', icon: 'folder', label: 'Magazzino Centrale', profiles: OPS },
    // Dotazione di avvio delle sedi: modelli per tipologia, sedi e Legal entity con data di apertura e Giacenza 0 (badge: aperture entro 60 giorni senza Giacenza 0)
    { to: 'dotazione', icon: 'building', label: 'Dotazione di avvio', badge: 'dotazione', profiles: OPS },
    { group: 'Ordini', profiles: OPS },
    { to: 'catalogo', icon: 'plus', label: '1 · Nuovo ordine per struttura', profiles: OPS },
    { to: 'verifica', icon: 'check', label: '2 · Verifica richieste', badge: 'verifica', profiles: OPS },
    { to: 'fornitore', icon: 'send', label: '3 · Trasmissione al magazzino', profiles: OPS },
    { to: 'consegne', icon: 'import', label: '4 · Consegne', profiles: OPS },
    { group: 'Giacenze', profiles: OPS },
    { to: 'carico', icon: 'import', label: '5 · Carico materiale', profiles: OPS },
    { to: 'scarico', icon: 'send', label: '6 · Scarico materiale', profiles: OPS },
    { to: 'giacenze', icon: 'calendar', label: '7 · Giacenze mensili', profiles: OPS },
    { to: 'giacenza', icon: 'orders', label: '8 · Giacenze per struttura', profiles: OPS },
    { to: 'rete', icon: 'grid', label: 'Scorte della rete', profiles: OPS },
    { group: 'Gestione', profiles: OPS },
    { to: 'strutture', icon: 'building', label: 'Strutture', profiles: OPS },
    { to: 'articoli', icon: 'sheet', label: 'Catalogo articoli', profiles: OPS },
    { to: 'produzione', icon: 'stats', label: 'Produzione StudioLab', profiles: OPS },
    { to: 'correlazioni', icon: 'tree', label: 'Correlazione esami e materiali', profiles: OPS },
    { to: 'ordini', icon: 'list', label: 'Archivio ordini', profiles: OPS },
    { to: 'difformita', icon: 'alert', label: 'Difformità', badge: 'difformita', profiles: OPS },
    { to: 'invii', icon: 'mail', label: 'Registro invii', profiles: OPS },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: OPS },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['SUPERADMIN'] },

    { group: 'Ordini', profiles: ['CLIENTE'], onlyProfiles: true },
    { to: 'catalogo', icon: 'plus', label: '1 · Nuovo ordine', profiles: ['CLIENTE'], onlyProfiles: true },
    { to: 'ordini', icon: 'list', label: 'I miei ordini', profiles: ['CLIENTE'], onlyProfiles: true },
    { to: 'giacenza', icon: 'orders', label: 'Materiale ricevuto', profiles: ['CLIENTE'], onlyProfiles: true },
    { to: 'difformita', icon: 'alert', label: 'Difformità', profiles: ['CLIENTE'], onlyProfiles: true },

    { group: 'Flusso materiale', profiles: TD, onlyProfiles: true },
    { to: 'ordini', icon: 'list', label: 'Ordini della struttura', profiles: TD, onlyProfiles: true },
    { to: 'carico', icon: 'import', label: '5 · Carico magazzino', profiles: TD, onlyProfiles: true },
    { to: 'scarico', icon: 'send', label: '6 · Scarico materiale', profiles: TD, onlyProfiles: true },
    { to: 'giacenze', icon: 'calendar', label: '7 · Giacenza mensile', profiles: TD, onlyProfiles: true },
    { to: 'giacenza', icon: 'orders', label: 'Giacenza attuale', profiles: TD, onlyProfiles: true },
    { to: 'produzione', icon: 'stats', label: 'Produzione', profiles: TD, onlyProfiles: true },
    { to: 'difformita', icon: 'alert', label: 'Difformità', profiles: TD, onlyProfiles: true },
  ],
};
