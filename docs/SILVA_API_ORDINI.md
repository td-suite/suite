---
title: "Toscana Diagnostica · Suite TD — Trasmissione degli ordini al gestionale Silva"
subtitle: "Specifica dell'interfaccia API v1 (ordini in ingresso per Silva, avanzamenti in uscita verso la Suite)"
author: "Toscana Diagnostica S.r.l. — Area Operations / Suite TD"
date: "31 ottobre 2026 — versione 1.0"
lang: it
---

# 1. Scopo

Toscana Diagnostica (TD) gestisce le richieste di materiale di consumo delle proprie strutture (punti prelievo, centri polidiagnostici, laboratorio di analisi) e dei clienti service nella **Suite TD**, modulo *Ordini e Magazzino*. Il flusso è in otto fasi: la struttura ordina dal catalogo (1), l'Area Operations verifica la richiesta rispetto alla produzione di laboratorio (StudioLab) e allo storico (2), l'ordine approvato viene trasmesso al magazzino (3), il magazzino consegna (4), la struttura carica il materiale ricevuto (5) e lo scarica all'uso (6), dichiara la giacenza mensile (7) e la Suite tiene la giacenza per struttura (8).

Questa specifica descrive la **fase 3**: all'approvazione dell'Area Operations la Suite trasmette l'ordine in API al gestionale Silva, nello stesso stile dell'API catalogo che Silva ha attivato il 30/10/2026 (base `https://silva.cloud/portaleordini`, header `X-API-KEY`, versione `v1`). Silva risponde con un riscontro immediato e comunica gli avanzamenti (presa in carico, spedizione, consegna) alle API della Suite già disponibili.

Il documento è destinato al team tecnico Silva per l'impostazione della risorsa sul gestionale. Il JSON dell'ordine è **identico** a quello che Silva può già leggere in polling da `GET /api/orders/integrations/silva/orders`: chi ha già impostato la lettura non deve cambiare mappature.

# 2. Riepilogo delle chiamate

| Direzione | Chiamata | Autenticazione | Scopo |
|---|---|---|---|
| TD → Silva | `POST {base}/api/v1/ordini` | chiave Silva→TD | Trasmissione dell'ordine approvato |
| TD → Silva (facoltativa) | `GET {base}/api/v1/ordini/{numero}` | chiave Silva→TD | Stato dell'ordine presso Silva |
| Silva → TD | `POST {suite}/orders/{numero}/presa-in-carico` | segreto TD→Silva | Presa in carico |
| Silva → TD | `POST {suite}/orders/{numero}/spedito` | segreto TD→Silva | Spedizione con DDT |
| Silva → TD | `POST {suite}/orders/{numero}/consegnato` | segreto TD→Silva | Consegna con righe, lotti, scadenze, codici a barre |
| Silva → TD (già attiva) | `GET {suite}/orders?stato=APPROVATO` | segreto TD→Silva | Seconda via: lettura in polling |

`{base}` = `https://silva.cloud/portaleordini` (configurabile nel connettore). `{suite}` = `https://suite.toscanadiagnostica.it/api/orders/integrations/silva`. La chiave Silva→TD è quella rilasciata da Silva a Toscana Diagnostica per l'API catalogo (header `X-API-KEY`); il segreto TD→Silva è rilasciato da Toscana Diagnostica (Amministrazione > Connettori > Silva) e viaggia nello stesso header. Tutte le date sono ISO 8601 con fuso esplicito, preferibilmente UTC con `Z` finale. Tutti i corpi sono `application/json; charset=utf-8`.

# 3. Trasmissione dell'ordine: `POST {base}/api/v1/ordini`

## 3.1 Quando

Subito dopo che l'Area Operations approva l'ordine (stato interno `APPROVATO`). Se Silva non risponde o risponde con errore 5xx, la Suite ritenta automaticamente ogni 5 minuti finché l'ordine resta approvato (al massimo 50 tentativi); l'Area Operations può forzare un nuovo invio con "Trasmetti a Silva". Quando Silva comunica la presa in carico l'ordine esce dalla coda.

## 3.2 Intestazioni della richiesta

| Header | Valore |
|---|---|
| `X-API-KEY` | chiave rilasciata da Silva a Toscana Diagnostica (validità 365 giorni) |
| `X-Idempotency-Key` | il numero d'ordine TD (es. `ORD-2026-0142`): la stessa richiesta ripetuta non deve creare un secondo ordine |
| `Content-Type` | `application/json; charset=utf-8` |
| `Accept` | `application/json` |

## 3.3 Corpo della richiesta

```json
{
  "numero": "ORD-2026-0142",
  "cliente": "TOSCANA-DIAGNOSTICA",
  "dataApprovazione": "2026-10-31T08:12:44.000Z",
  "stato": "APPROVATO",
  "urgenza": "ORDINARIA",
  "motivoUrgenza": null,
  "tipoDestinatario": "SEDE_TD",
  "origineDestinatario": "SEDE",
  "note": "Consegna entro venerdì se possibile",
  "destinazione": {
    "codice": "TD01",
    "codiceSede": "TD01",
    "nome": "Punto Prelievi Quarrata",
    "indirizzo": "Via della Repubblica, 88/C",
    "cap": "51039",
    "citta": "Quarrata",
    "provincia": "PT",
    "referente": "Gucci Lorenzo",
    "telefono": "0573774050",
    "email": "quarrata@toscanadiagnostica.it",
    "noteConsegna": "Consegnare al mattino, ingresso laterale",
    "modalita": "CONSEGNA"
  },
  "righe": [
    {
      "codiceArticolo": "SLV-001",
      "codiceSilva": "SLV-001",
      "gtin": null,
      "descrizione": "Provetta siero gel 5 ml tappo giallo",
      "confezioni": 8,
      "confezione": "confezione da 100 provette",
      "unitaPerConfezione": 100,
      "unitaTotali": 800,
      "unita": "PZ",
      "noteOperations": null
    },
    {
      "codiceArticolo": "SLV-002",
      "codiceSilva": "SLV-002",
      "gtin": null,
      "descrizione": "Ago butterfly 21G",
      "confezioni": 5,
      "confezione": "scatola da 50",
      "unitaPerConfezione": 50,
      "unitaTotali": 250,
      "unita": "PZ",
      "noteOperations": "con holder"
    }
  ]
}
```

## 3.4 Campi

| Campo | Tipo | Obbligatorio | Significato |
|---|---|---|---|
| `numero` | stringa | sì | Numero d'ordine TD, univoco (`ORD-AAAA-NNNN`). Chiave di tutte le chiamate successive. |
| `cliente` | stringa | sì | Codice cliente di TD presso Silva (concordato: `TOSCANA-DIAGNOSTICA`). |
| `dataApprovazione` | data-ora ISO 8601 | sì | Momento dell'approvazione dell'Area Operations. |
| `stato` | stringa | sì | Sempre `APPROVATO` in trasmissione. |
| `urgenza` | `ORDINARIA` \| `URGENTE` | sì | Priorità richiesta. |
| `motivoUrgenza` | stringa o null | no | Motivo indicato dalla struttura se urgente. |
| `tipoDestinatario` | `SEDE_TD` \| `LABORATORIO_TD` \| `CLIENTE_SERVICE` | sì | Punto prelievi/centro TD, laboratorio TD, cliente service. |
| `origineDestinatario` | `SEDE` \| `LEGAL_ENTITY` | sì | La destinazione è una sede TD o una persona giuridica (cliente/partner). |
| `note` | stringa o null | no | Note dell'Area Operations per il magazzino. |
| `destinazione.codice` | stringa | sì | Codice della destinazione come noto a Silva (`codiceSilva` della struttura se concordato, altrimenti il codice TD). |
| `destinazione.codiceSede` | stringa | sì | Codice TD della struttura. |
| `destinazione.nome`, `indirizzo`, `cap`, `citta`, `provincia` | stringa | sì | Recapito di consegna. |
| `destinazione.referente`, `telefono`, `email` | stringa o null | no | Contatto in sede. |
| `destinazione.noteConsegna` | stringa o null | no | Indicazioni di consegna (orari, accessi). |
| `destinazione.modalita` | `CONSEGNA` \| `RITIRO_PRESSO_TD` | sì | Consegna al recapito o ritiro da parte di TD presso il magazzino. |
| `righe[].codiceArticolo` | stringa | sì | Codice articolo del catalogo Silva (coincide con `codiceArticolo` dell'API catalogo). |
| `righe[].codiceSilva` | stringa o null | no | Ridondante con `codiceArticolo` per gli articoli nati dal catalogo Silva. |
| `righe[].gtin` | stringa o null | no | GTIN del produttore se noto. |
| `righe[].descrizione` | stringa | sì | Descrizione dell'articolo. |
| `righe[].confezioni` | intero > 0 | sì | **Quantità ordinata, in confezioni.** |
| `righe[].confezione`, `unitaPerConfezione`, `unitaTotali`, `unita` | stringa / intero | sì | Descrizione della confezione, unità per confezione, unità totali (= confezioni × unità per confezione), unità di misura. |
| `righe[].noteOperations` | stringa o null | no | Nota dell'Area Operations sulla riga. |

Le righe con quantità approvata zero non vengono trasmesse. Le quantità sono in **confezioni** (nell'API catalogo Silva le giacenze sono in unità fisiche contabili: `unitaTotali` serve al raccordo).

## 3.5 Risposte attese

| Codice | Significato | Corpo |
|---|---|---|
| `201 Created` | Ordine ricevuto e registrato | `{ "numero": "ORD-2026-0142", "riferimento": "<id o numero interno Silva>", "ricevutoAl": "2026-10-31T08:12:45.1234567Z" }` |
| `200 OK` | Ordine già presente con lo stesso contenuto (ripetizione idempotente) | come sopra |
| `409 Conflict` | Ordine già presente (la Suite lo considera **ricevuto**, non errore) | `{ "error": "duplicate_order", "numero": "...", "riferimento": "..." }` |
| `400 Bad Request` | Corpo non valido (campo mancante, articolo sconosciuto, destinazione sconosciuta) | `{ "error": "<codice>", "message": "<descrizione>", "campo": "righe[1].codiceArticolo" }` |
| `401 / 403` | Chiave assente, errata, scaduta o non autorizzata al cliente | `{ "error": "unauthorized" }` |
| `5xx` | Errore del gestionale | qualunque: la Suite ritenta |

La Suite conserva `riferimento` e lo mostra all'Area Operations; Silva può usarlo o il `numero` TD nelle chiamate di avanzamento (il `numero` TD resta la chiave).

## 3.6 Verifica facoltativa: `GET {base}/api/v1/ordini/{numero}`

Restituisce lo stato dell'ordine presso Silva: `{ "numero", "riferimento", "stato": "RICEVUTO" | "IN_PREPARAZIONE" | "SPEDITO" | "CONSEGNATO" | "ANNULLATO", "aggiornatoAl" }`. Non è necessaria al funzionamento: gli avanzamenti arrivano con le chiamate del capitolo 4.

# 4. Avanzamenti: Silva → Suite TD

Base: `https://suite.toscanadiagnostica.it/api/orders/integrations/silva`. Header `X-API-KEY` = **segreto in ingresso** che TD rilascia a Silva (diverso dalla chiave del capitolo 3; generato in Amministrazione > Connettori > Silva e comunicato per canale riservato). Risposta `200` con `{ "status": "<nuovo stato TD>" }`; `404` se il numero non esiste; `409` se lo stato non ammette l'avanzamento (es. consegnato prima della presa in carico: la Suite completa comunque i passaggi mancanti quando riceve `consegnato`).

## 4.1 Presa in carico — `POST .../orders/{numero}/presa-in-carico`

```json
{ "riferimento": "SLV-2026-00981" }
```

Porta l'ordine TD a `PRESO_IN_CARICO` e salva il riferimento Silva.

## 4.2 Spedizione — `POST .../orders/{numero}/spedito`

```json
{ "ddt": "DDT 2026/4471", "data": "2026-11-03T09:40:00Z" }
```

Porta l'ordine a `SPEDITO`.

## 4.3 Consegna — `POST .../orders/{numero}/consegnato`

```json
{
  "ddt": "DDT 2026/4471",
  "data": "2026-11-04T10:15:00Z",
  "righe": [
    { "codiceArticolo": "SLV-001", "confezioni": 8, "lotto": "L24A77", "scadenza": "2027-06-30", "barcodes": ["8012345000011", "8012345000012"] },
    { "codiceArticolo": "SLV-002", "confezioni": 5, "lotto": "B9912", "scadenza": "2028-01-31" }
  ]
}
```

Porta l'ordine a `CONSEGNATO` e crea in Suite una confezione attesa per ogni unità consegnata (con lotto, scadenza e, se presenti, i codici a barre per confezione: così la struttura carica leggendo il codice). `righe` è facoltativo: senza righe la Suite genera le confezioni dalle quantità approvate. Codici articolo non riconosciuti vengono restituiti in `unknown` e ignorati.

# 5. Sicurezza e regole operative

- Due chiavi distinte: la chiave Silva→TD (capitolo 3, rilasciata da Silva, validità 365 giorni) e il segreto TD→Silva (capitolo 4, rilasciato da TD). Entrambe viaggiano solo in header su HTTPS; mai in URL o nei log.
- Idempotenza sul `numero` d'ordine: ripetizioni della stessa trasmissione non devono generare doppioni.
- La Suite registra ogni chiamata (esito, tempi, messaggio) nel registro del connettore; nessun dato di pazienti transita in queste API.
- Ambienti: produzione `https://silva.cloud/portaleordini` ↔ `https://suite.toscanadiagnostica.it`. Per il collaudo Silva può indicare una base di prova; la Suite accetta base URL diverse per connettore.
- Contatti tecnici: Toscana Diagnostica, Area Operations / Suite TD (`info@toscanadiagnostica.it`).

# 6. Cosa chiediamo a Silva

1. Esporre `POST {base}/api/v1/ordini` (e, se possibile, `GET {base}/api/v1/ordini/{numero}`) con il contratto del capitolo 3, autenticato con la stessa `X-API-KEY` dell'API catalogo.
2. Richiamare gli avanzamenti del capitolo 4 sulla Suite con il segreto in ingresso TD, almeno `spedito` e `consegnato` (con righe, lotti e scadenze quando disponibili).
3. Confermare il codice cliente (`TOSCANA-DIAGNOSTICA`) e i codici di destinazione delle sedi (`destinazione.codice`): la Suite può usare i codici Silva se ci vengono comunicati, altrimenti i codici TD.
4. Indicare una base URL di collaudo e una finestra per la prova end-to-end: un ordine di prova trasmesso dalla Suite, presa in carico, spedizione e consegna dal gestionale Silva, carico in sede.

# Allegato A — Schema OpenAPI (estratto)

Il file `silva-api-ordini-v1.openapi.yaml` allegato contiene lo schema OpenAPI 3.0 delle chiamate dei capitoli 3 e 4, utilizzabile per generare la risorsa e per i test con Postman.
