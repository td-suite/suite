# Retail Assistant · Intorno

Richiesta del CEO del 07/11/2026: "integrare Google Maps nel Retail per avere dati su cosa c'è intorno" alle sedi. Questa guida
descrive cosa fa la funzione, quali dati chiede a Google, come si calcola il punteggio, quanto costa e cosa va impostato su Google
Cloud e su Render.

## Cosa fa
- **Scheda "Intorno" nella sede** (Retail > Sedi del network > sede > Intorno): tre numeri di sintesi (concorrenti diretti entro
  1 km, prescrittori + attrattori entro 1 km, attrattività con le sue componenti), mappa Google con la sede al centro, pin colorati per
  categoria e cerchi a 500 m, 1 km e 3 km (più il raggio della rilevazione se diverso), clic sul pin = scheda del luogo; tabella
  filtrabile per categoria, sottocategoria, distanza e novità con distanza, rating, recensioni, orari di oggi, sito, telefono e
  "nuovo" / "scomparso" / "cambiato" rispetto alla rilevazione precedente; export XLSX; "Rileva adesso" (ADMIN e RETAIL); storico delle
  rilevazioni con "Apri". Senza la chiave del browser la mappa non si disegna e resta la tabella.
- **Geocodifica della sede** senza coordinate: pulsante "Geocodifica" nella scheda Intorno (ADMIN) o nel form Amministrazione > Sedi;
  mostra l'indirizzo trovato con la precisione (civico, via, comune) e salva solo alla conferma.
- **Sede extraurbana**: spunta in Amministrazione > Sedi; la sede usa il raggio extraurbano (10 km) invece di quello urbano (3 km).
- **Cruscotto Retail > "Il territorio"**: confronto tra tutte le sedi attive del network (ultima rilevazione, contatori entro 1 km
  per categoria, attrattività con le componenti, nuovi/scomparsi) e "Valuta un indirizzo": indirizzo e raggio → geocodifica →
  conferma dell'indirizzo trovato → rilevazione → stessa scheda Intorno, salvata in "Indirizzi valutati" con il suo storico (si
  rileva di nuovo dalla sua pagina; ADMIN può eliminarlo).
- **Rilevazione mensile**: il lavoro di sfondo `retail:intorno` gira ogni giorno e rileva le sedi attive del network con coordinate
  che non hanno ancora una rilevazione riuscita nel mese, dalla meno recente, fermandosi al tetto giornaliero (le restanti il giorno
  dopo). "Esegui ora" in Amministrazione > Moduli > Lavori di sfondo o in Retail > Impostazioni > Intorno.
- **Storico**: ogni luogo ha `prima_vista` (prima rilevazione in cui compare), `ultima_vista`, `chiuso_at` (data in cui è scomparso
  o in cui Google lo dà chiuso definitivamente). I luoghi scomparsi restano nella rilevazione in cui spariscono (riga attenuata).
  Il confronto considera solo le categorie lette senza errori in entrambe le rilevazioni e, per gli scomparsi, i luoghi entro il
  raggio attuale (se il raggio si restringe, i lontani non risultano "scomparsi"). "Cambiato" = nome, indirizzo, stato dell'attività,
  telefono o sito diversi.

## Categorie e chiamate a Google
Places API (New), `languageCode: it`, `regionCode: IT`, al massimo 20 risultati per chiamata. `searchNearby` = ricerca per tipi
(Table A) con `locationRestriction` circolare e `rankPreference: DISTANCE` (i 20 più vicini); `searchText` = query in italiano con
`locationBias` circolare (i risultati oltre il raggio si scartano dopo il calcolo della distanza) e, solo se la prima pagina è piena
e tutta dentro il raggio, una seconda pagina (`nextPageToken`).

| Categoria TD | Sottocategoria | Chiamate |
|---|---|---|
| Concorrenti diretti | Laboratorio di analisi | `searchNearby` tipi `medical_lab` + `searchText` «laboratorio analisi cliniche» |
| | Centro diagnostico | `searchText` «centro diagnostico» |
| | Radiologia | `searchText` «radiologia» |
| | Poliambulatorio | `searchText` «poliambulatorio» |
| Prescrittori | Medico / studio medico | `searchNearby` `doctor` (riserva: «studio medico») |
| Attrattori | Farmacia | `searchNearby` `pharmacy`, `drugstore` (riserva: «farmacia») |
| | RSA | `searchText` «RSA residenza sanitaria assistenziale» |
| | Casa di cura | `searchText` «casa di cura» |
| | Ospedale | `searchNearby` `hospital` (riserva: «ospedale») |
| | ASL / distretto sanitario | `searchText` «ASL distretto sanitario» |
| Contesto | Supermercato | `searchNearby` `supermarket`, `grocery_store` (riserva: «supermercato») |
| | Ufficio postale | `searchNearby` `post_office` (riserva: «ufficio postale») |
| | Banca | `searchNearby` `bank` (riserva: «banca») |
| | Scuola | `searchNearby` `school`, `primary_school`, `secondary_school` (riserva: «scuola») |
| | Parcheggio | `searchNearby` `parking` (riserva: «parcheggio») |
| | Fermata bus / tram / treno | `searchNearby` `bus_station`, `bus_stop`, `transit_station`, `train_station`, `light_rail_station` (riserva: «fermata autobus tramvia stazione») |

- **Incertezza dichiarata**: l'elenco ufficiale dei tipi della nuova API non era consultabile da qui (rete del cantiere). I tipi usati
  sono quelli noti della Table A; per RSA, case di cura, centri diagnostici, radiologie, poliambulatori e ASL non esiste un tipo
  dedicato e si usa la ricerca testuale. Se Google rifiuta un tipo (400 INVALID_ARGUMENT che cita il tipo) la rilevazione passa da
  sola alla query di riserva; qualsiasi altro errore resta sulla sola sottocategoria (rilevazione "parziale", indicata in pagina).
  Da verificare con "Prova la chiave" e con la prima rilevazione reale.
- Un luogo trovato da più chiamate compare una volta sola: nella sottocategoria il cui elenco di tipi contiene il suo tipo principale
  (una farmacia trovata cercando «laboratorio analisi» resta farmacia), altrimenti nella prima dell'ordine della tabella.
- Le ricerche testuali possono restituire luoghi non pertinenti (es. un reparto di radiologia di un ospedale): la tabella mostra i tipi
  Google nell'export per il controllo.
- Campi richiesti (`X-Goog-FieldMask`): id, displayName, formattedAddress, location, types, primaryType, rating, userRatingCount,
  regularOpeningHours, websiteUri, nationalPhoneNumber, businessStatus.
- Categorie attive: Retail > Impostazioni > Intorno (spunte). Ogni sottocategoria costa una chiamata per rilevazione (il laboratorio
  due): con tutte attive **17 chiamate**, fino a 22 se le ricerche testuali chiedono la seconda pagina.

## Punteggio di attrattività
Formula semplice e dichiarata, mostrata sempre con le componenti (mai il numero da solo):

    Attrattività = 2 × prescrittori + 1 × attrattori + 0,5 × contesto (massimo 10 punti) − 3 × concorrenti

contando i luoghi **aperti** (non chiusi temporaneamente o definitivamente, non scomparsi) **entro 1 km**. Il contesto ha un tetto
perché in centro città fermate e parcheggi sono decine e coprirebbero tutto il resto. I pesi sono nel codice (`PESI` in
`server/src/modules/retail/lib/intorno.js`): è un indicatore di confronto tra sedi e indirizzi, non una previsione di fatturato.

## Tetto giornaliero e costi
- Ogni chiamata a Google (Places e Geocoding, prova compresa) passa dal contatore `retail.intorno_chiamate` (una riga per giorno,
  fuso Europe/Rome, incremento atomico). Tetto in Retail > Impostazioni > Intorno (predefinito 300). Prima di iniziare una rilevazione
  si controlla che restino almeno le chiamate minime (17 con tutte le categorie): altrimenti errore 429 chiaro senza consumare nulla.
  Se il tetto si raggiunge a metà (altre rilevazioni in parallelo) la rilevazione si ferma ("interrotta dal tetto") e non diventa la
  base del confronto.
- **Costi stimati, da verificare sul listino ufficiale** (https://mapsplatform.google.com/pricing/, non consultabile da qui: valori
  come li ricordo per il listino in vigore dal marzo 2025). Con i campi richiesti (rating, orari, sito, telefono) le ricerche sono
  fatturate come SKU "Enterprise" di Nearby Search / Text Search, nell'ordine di 35 USD ogni 1.000 chiamate con una quota gratuita
  mensile per SKU; Geocoding nell'ordine di 5 USD ogni 1.000 con quota gratuita; Maps JavaScript (mappe dinamiche) nell'ordine di
  7 USD ogni 1.000 caricamenti con quota gratuita. Ordine di grandezza: chiamate al mese ≈ numero di sedi × 17-22 (rilevazione mensile)
  + 17-22 per ogni rilevazione a mano o indirizzo valutato + 1 per ogni geocodifica. Il tetto giornaliero è la protezione
  dall'imprevisto: impostare anche le quote e un avviso di budget su Google Cloud (sotto).

## Chiavi e cosa fare su Google Cloud (Francesco)
Le chiavi stanno SOLO nelle variabili d'ambiente (mai nel repo, nei log, nei test o nelle impostazioni):

1. Google Cloud Console → progetto (può essere lo stesso delle rubriche) → **Fatturazione** collegata al progetto (le API Maps la
   richiedono anche per la quota gratuita). Consigliato: **Budget e avvisi** con soglia mensile.
2. **API e servizi → Libreria**: abilitare **Places API (New)**, **Geocoding API**, **Maps JavaScript API**.
3. **Credenziali → Crea chiave API** due volte:
   - **Chiave server** → `GOOGLE_MAPS_SERVER_KEY`. Restrizioni API: solo *Places API (New)* e *Geocoding API*. Restrizioni
     dell'applicazione: nessun referrer (la usa il server di Render; facoltativo: restrizione per indirizzo IP se Render offre un IP
     di uscita fisso).
   - **Chiave browser** → `GOOGLE_MAPS_BROWSER_KEY`. Restrizioni API: solo *Maps JavaScript API*. Restrizioni dell'applicazione:
     *Siti web (referrer HTTP)* `https://suite.toscanadiagnostica.it/*`. È visibile a chi apre la pagina (come ogni chiave delle
     mappe nel browser): la protezione è il referrer.
4. **Quote** (API e servizi → Places API (New) → Quote): facoltativo un limite giornaliero di richieste coerente con il tetto della Suite.

## Render
Variabili (render.yaml, `sync: false`): `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_BROWSER_KEY`. Dopo l'inserimento e il riavvio:
Retail > Impostazioni > Intorno → "Prova la chiave" (una chiamata di farmacie entro 500 m dalla prima sede con coordinate, risposta
grezza di Google con la chiave mascherata), poi "Rileva adesso" su una sede. La CSP della Suite ammette i domini delle mappe Google
(script da maps.googleapis.com / maps.gstatic.com, immagini e connessioni *.googleapis.com, *.gstatic.com, *.google.com, font
fonts.gstatic.com): se la mappa non compare, guardare la console del browser per un dominio bloccato.

## Dettagli tecnici
- Server: `server/src/lib/googleMaps.js` (chiavi, maschera, Geocoding; usata anche dalla geocodifica di Amministrazione > Sedi, che
  con la chiave server passa prima da Google e poi da OpenStreetMap), `server/src/modules/retail/lib/intorno.js` (categorie,
  normalizzazione, distanza con l'emisenoverso, unione, confronto, punteggio, contatore, rilevazioni, job, prova, risposte di prova),
  `server/src/modules/retail/routes/intorno.js`, migrazioni retail `010_intorno.sql` (`intorno_rilevazioni`, `intorno_luoghi`,
  `intorno_chiamate`) e core `042_site_extraurbana.sql`.
- API (`/api/retail`): `GET /intorno/config` (chiave browser o null, raggi, cerchi, categorie, pesi), `GET /sedi/:id/intorno`
  (ultima rilevazione con luoghi, confronto, sintesi, storico), `POST /sedi/:id/intorno/rileva` (ADMIN/RETAIL),
  `POST /sedi/:id/intorno/geocodifica` e `PUT /sedi/:id/intorno/coordinate` (ADMIN, conferma), `POST /intorno/geocodifica` e
  `POST /intorno/valuta { indirizzo | lat, lng, raggio }` (ADMIN/RETAIL), `GET /intorno/rilevazioni/:id` (+ `/export.xlsx`),
  `POST /intorno/rilevazioni/:id/rileva`, `GET /intorno/confronto` (tutte le sedi + indirizzi valutati), `GET /intorno/valutazioni`,
  `DELETE /intorno/valutazioni/:id` (ADMIN), `GET|PUT /intorno/impostazioni`, `POST /intorno/prova`, `POST /intorno/job` (ADMIN).
- Sviluppo e collaudo: `INTORNO_MOCK=1` (ignorata con `NODE_ENV=production`) sostituisce Google con risposte finte dichiarate di
  prova (una decina di luoghi per sottocategoria intorno al punto richiesto, nomi "… di prova N", indirizzi "dato di prova, non
  reale", siti su `.example`); dalla seconda rilevazione dello stesso punto manca una farmacia e ne compare una nuova. Il contatore
  conta anche le chiamate finte. Test: `server/test/retail-intorno.test.mjs` (nessuna chiamata reale, fetch finto).
