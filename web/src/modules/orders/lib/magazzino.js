// v0.68.4 · Magazzino Centrale unico (richiesta del CEO del 10/11/2026: "Catalogo articoli" era una sovrapposizione): una sola voce con
// due schede, "Giacenze Silva" e "Articoli ordinabili". Funzioni pure, usate dalle pagine e dai test (server/test/orders-etichette-pivot).
export const SCHEDE_MAGAZZINO = [
  { key: 'giacenze', label: 'Giacenze Silva' },
  { key: 'articoli', label: 'Articoli ordinabili' },
];
// il vecchio indirizzo /orders/articoli porta alla scheda degli articoli
export const REDIRECT_ARTICOLI = 'magazzino?scheda=articoli';

/** Scheda del Magazzino Centrale da ?scheda= (giacenze se assente o sconosciuta). */
export function schedaMagazzino(search) {
  const k = new URLSearchParams(search || '').get('scheda');
  return SCHEDE_MAGAZZINO.some((s) => s.key === k) ? k : 'giacenze';
}

/** Link (relativo al modulo) alla riga di un articolo nella scheda "Articoli ordinabili". */
export const linkArticolo = (id) => `magazzino?scheda=articoli&articolo=${Number(id)}`;
