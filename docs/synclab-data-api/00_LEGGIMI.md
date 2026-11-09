# Synclab Data API — avvio del connettore

Consegna del 9 novembre 2026 per Toscana Diagnostica. Versione applicativa installata: **1.1.0, linea di sviluppo**; versione del contratto: **Data API v1 / 1.0**. Il pacchetto serve a sviluppare e collaudare il connettore della suite e l'alimentazione BI.

## Indirizzi e accesso

| Elemento | Valore |
|---|---|
| Base URL | `https://synclab.toscanadiagnostica.it` |
| Verifica pubblica servizio | `GET /api/v1/health` |
| Login | `POST /api/v1/auth/client/login` |
| Verifica autenticata Data API | `GET /api/v1/data/metadata` |
| Prefisso dati | `/api/v1/data` |
| Nome del client applicativo | `TDSuite` |
| Autenticazione chiamate dati | `Authorization: Bearer <accessToken>` |
| Ruolo previsto | `DataAPI`, valido per tutti i dataset |

La base URL non comprende `/api/` né `/synclab`: aggiungere esattamente i percorsi riportati. Usare le API REST dal backend del connettore.

La password del client va inserita a runtime nella configurazione protetta del connettore. **Non è inclusa negli allegati.** Il client TDSuite risulta già registrato: iniziare dal login. Se la password non è disponibile, concordare con Matteo il ripristino dell'accesso; `register` non cambia una password già impostata.

Configurazione suggerita, con segnaposto:

```dotenv
SYNCLAB_BASE_URL=https://synclab.toscanadiagnostica.it
SYNCLAB_CLIENT_NAME=TDSuite
SYNCLAB_CLIENT_PASSWORD=<IMPOSTARE_NEL_SECRET_STORE>
SYNCLAB_INCLUDE_PATIENT=false
```

Il login riceve:

```http
POST /api/v1/auth/client/login
Content-Type: application/json

{"name":"TDSuite","password":"<PASSWORD_DEL_CLIENT>"}
```

Restituisce `accessToken` e `validTo`. Nella configurazione attuale il JWT dura 15 minuti: usare sempre la scadenza restituita e rinnovarlo mediante login. Il token va conservato nel processo, senza scriverlo nei log.

`GET /api/v1/data/metadata` con il bearer è il controllo corretto per questo connettore. **`/api/v1/auth/client/info` richiede il ruolo Application e con DataAPI restituisce 403 anche quando il login è corretto.**

Swagger interattivo non è attualmente pubblicato su questa installazione. Il contratto completo è nell'OpenAPI allegata: il relativo 404 non impedisce le chiamate Data API.

## Materiale da caricare in Claude

1. Questo file, per indirizzi, autenticazione e stato dell'installazione.
2. [01_CONTRATTO_API.md](01_CONTRATTO_API.md), per endpoint, pagine, checkpoint e recupero.
3. [02_DIZIONARIO_BI.md](02_DIZIONARIO_BI.md), per significato dei campi e importi.
4. [03_PROMPT_CLAUDE.md](03_PROMPT_CLAUDE.md), da usare come istruzione iniziale dell'agente.
5. [openapi.json](openapi.json), per nomi, tipi, nullabilità e schemi esatti.
6. [esempi_sintetici.json](esempi_sintetici.json), per fixture e test locali.
7. [postman_collection.json](postman_collection.json), per prove manuali riproducibili.

La collection contiene URL e nome client già impostati, con password e token vuoti. Le richieste di completo non applicano una data minima. I cursori della collection sono dimostrativi fino alla prima risposta reale; il checkpoint candidato va confermato soltanto dopo il salvataggio dei dati.

## Dati disponibili

- `clients`: clienti, sede, contatti e riferimenti ai listini.
- `exams`: catalogo completo, compresi esami inattivi/non utilizzati.
- `price-lists`: tutti i listini e le righe, compresi inattivi e non associati a clienti.
- `requests`: accettazioni con esami, campioni, importi e legami ai documenti economici.
- `invoices`: fatture e note di credito, comprese quelle manuali.

Le accettazioni comprendono tutte le tipologie ammesse; sono esclusi soltanto gli stati 0, 1 e 29. Per l'importazione della sola B2B configurare l'insieme dei clienti/aziende da importare. `occupationalMedicine=true` identifica la medicina del lavoro e non rappresenta l'intera B2B.

Per default il paziente è rappresentato da età alla data accettazione, sesso e comune/provincia/CAP. `includePatient=true` aggiunge l'identità secondo il dizionario. Non sono compresi risultati clinici, PDF, incassi, costi o contenuti già trasferiti nelle tabelle storiche.

## Primo avvio consigliato

1. Login e lettura dei metadati: acquisire `instanceId`, capacità e limiti.
2. Prova su `exams`: gestire 202, polling, pagine e checkpoint fino alla fine.
3. Importazione iniziale di tutti i dataset; usare ID restituiti e salvare le relazioni anche quando il record riferito non è ancora arrivato.
4. Ciclo notturno incrementale per ciascun dataset e ambito di importazione.
5. Monitorare stato dell'ultimo ciclo, conteggi, durata e data dell'ultimo checkpoint confermato.

L'API è passiva: orario, importazione, database di destinazione, ripetizione e checkpoint sono gestiti dal connettore.

## Riscontri del collaudo

Il 9 novembre sono stati eseguiti 61 controlli effettivi sul servizio installato, senza errori: autenticazione, dataset, pagine, checkpoint/delta, proiezioni paziente, esclusioni e documenti economici. Sono stati verificati 1.634 esami, 115 listini e un campione di righe, accettazione, fatture e nota di credito manuale. Il caso nota di credito standard non è stato esercitato perché assente nei dati disponibili.

Il collaudo è un riscontro sul campione e non una certificazione di ogni elaborazione futura. Per la prima importazione completa iniziare con pagine contenute e misurare tempi e memoria; i listini e le fatture possono avere molti figli.
