-- Il catalogo per gli ordini è quello del magazzino Silva (richiesta del CEO, 30/10/2026): gli articoli importati da Silva sono
-- ordinabili da tutte le strutture appena arrivano (visible_all), salvo che l'Area Operations li nasconda; gli articoli caricati a
-- mano (MOD252/MANUALE) restano solo per lo storico e non compaiono più in "Nuovo ordine" quando esiste almeno un articolo Silva.
UPDATE articles SET visible_all = TRUE WHERE source = 'SILVA' AND NOT visible_all AND NOT visible_sedi AND NOT visible_service;
