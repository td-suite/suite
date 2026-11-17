# Retail Assistant · Sviluppo rete

Richiesta del CEO del 17/11/2026: confronto del posizionamento con i concorrenti, valutazione di un indirizzo per un punto prelievi
con ciò che ha intorno, suggerimento di dove aprire in Toscana incrociando anche clienti e prospect B2B. Dalla v0.81.0, menu
Retail > Sviluppo rete. Poggia sull'Intorno (docs/RETAIL_INTORNO.md): stessi dati di Google Places, stesso tetto giornaliero.

## Posizionamento
Per ogni sede attiva del network, dall'ultima rilevazione dell'Intorno: la nostra scheda Google (voto e recensioni), posto per voto
tra i concorrenti con almeno 10 recensioni, posto per numero di recensioni, concorrenti entro 500 m, 1 km e nel raggio, quanti sono
aperti il sabato, concorrenti nuovi e scomparsi rispetto alla rilevazione precedente, elenco completo.
- La scheda TD è riconosciuta da sola se entro 150 m c'è un luogo che si chiama "Toscana Diagnostica"; altrimenti la si sceglie a
  mano tra i luoghi entro 150 m. Le schede Toscana Diagnostica non sono mai contate tra i concorrenti.
- Prezzi dei concorrenti: Google non li pubblica. Si registrano a mano (prestazione, prezzo loro, prezzo nostro, data, fonte).

## Valuta un indirizzo
Pagina dedicata con l'elenco degli indirizzi valutati; la scheda di un indirizzo aggiunge all'Intorno:
- **Resa delle sedi TD più simili**: intervallo e mediana delle accettazioni e dei ricavi B2C mensili (ultimi 12 mesi chiusi) delle 3
  sedi TD con l'intorno più simile (concorrenti, prescrittori, attrattori, contesto entro 1 km, residenti del comune). Confronto con i
  soli punti prelievo se ce ne sono almeno 3 con dati. Non è una previsione: è ciò che fanno oggi sedi comparabili. Con meno di 2 sedi
  con intorno rilevato e vendite la stima non viene calcolata.
- **Rete**: sede TD più vicina e sedi entro 5 km (sotto 3 km: rischio di togliere pazienti a una nostra sede).
- **B2B**: clienti attivi (Business Hub) e prospect della Ricerca prospect nel raggio, se hanno coordinate, altrimenti nel comune.
- **Centri commerciali**: nuova categoria dell'Intorno (tipo Google `shopping_mall`), tra il contesto.

## Dove aprire
I 273 comuni della Toscana (codice ISTAT, residenti del censimento permanente 2021, coordinate). In classifica quelli sopra la soglia
di residenti (predefinita 5.000: 154 comuni).
- **Rilevazione di un comune**: 7 categorie entro 3 km dal centro (laboratori, centri diagnostici, poliambulatori, medici, farmacie,
  centri commerciali, supermercati), circa 9 chiamate a Google. Alla prima rilevazione il centro è cercato con la geocodifica, perché
  il baricentro del territorio può cadere fuori dall'abitato. Scansione notturna a lotti (predefinito 12 comuni per notte, dai più
  popolosi), ricontrollo ogni 180 giorni; a mano dalla pagina.
- **Punteggio su 100**, sempre con le componenti: bacino 25, concorrenza 25, traino 15, spazio 15, B2B 20. Bacino, concorrenza, traino
  e B2B sono posizioni relative tra i comuni in classifica; lo spazio dipende dalla distanza dalla sede TD più vicina (zero sotto 3 km,
  pieno tra 8 e 30 km, ridotto oltre). Un comune non rilevato ha un punteggio parziale su 60 e sta in fondo.
- **Limiti dichiarati**: Google restituisce al massimo 20 luoghi per ricerca per tipo, quindi nelle città grandi medici, farmacie e
  supermercati sono un minimo ("20+"); la quota di residenti anziani non è caricata e non entra nel punteggio; clienti e prospect
  sono attribuiti al comune per nome della città.

## Chiave Google
Senza la variabile `GOOGLE_MAPS_SERVER_KEY` vale la chiave del connettore Google Places (Amministrazione > Connettori). Per la
geocodifica la chiave deve avere abilitata anche la Geocoding API.
