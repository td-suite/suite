# Home della Suite

## v0.99.11 · Corsie allineate (27/11/2026)

Scelta del CEO tra cinque alternative ("C · Corsie allineate") dopo aver giudicato la parte centrale della Home "un'accozzaglia di icone". Fascia superiore e piè di pagina non cambiano; non cambia la Community.

- **Una corsia per area**: testata piena del colore dell'area a sinistra (nome breve: "Retail e Flow", "HQS"; quanti strumenti; quanti "da guardare"), strumenti a destra su una **griglia a 7 colonne uguale per tutte le corsie**, così le colonne si allineano da un'area all'altra. Icona sopra, nome sotto, contatore accanto all'icona.
- **Contatori di inventario** (`CONTATORI_INVENTARIO` in `components/Widget.jsx`: SGI Management, Portale Service): contano documenti esistenti, non lavoro da fare. Restano visibili ma in grigio e non entrano nel conteggio "da guardare" dell'area.
- **Pochi strumenti** (fino a 7, es. partner e clienti con più aree): una sola corsia "I tuoi strumenti", ogni strumento col colore della propria area.
- Le celle sono sempre il componente `Widget`: stessi comportamenti (scheda nuova e menu "Apri pagina…" dei portali, applicazioni esterne, contatori, descrizione e profilo nel suggerimento al passaggio del mouse).
- Tema scuro: testata velata del colore dell'area, nome nel colore. Sotto 1100 px la testata passa sopra la corsia; sotto 640 px tre strumenti per riga.
- Stili: blocco "Home a CORSIE ALLINEATE" in `web/src/styles.css` (classe `dash corsie`). La Home del Cliente service (due pulsanti) non cambia.

Le altre quattro alternative scartate (A "Prima ciò che ti aspetta", B "Indice per aree", D "In primo piano i tuoi", E "Un'area alla volta") sono descritte nella nota di progetto del 27/11/2026.
