# Data API v1 — contratto del connettore

Versione contratto 1.0. Gli schemi esatti sono in [openapi.json](openapi.json); gli indirizzi dell'installazione e il login sono in [00_LEGGIMI.md](00_LEGGIMI.md).

## Risorse

Tutti i percorsi sotto `/api/v1/data` richiedono JWT con ruolo DataAPI.

| Metodo | Percorso relativo | Contenuto |
|---|---|---|
| GET | `/metadata` | Installazione, capacità, limiti e finestra delta |
| GET | `/clients` e `/clients/{id}` | Clienti e sede |
| GET | `/exams` e `/exams/{id}` | Catalogo completo |
| GET | `/price-lists` e `/price-lists/{id}` | Listini con tutte le righe |
| GET | `/price-lists/{id}/items` | Righe di un listino paginate |
| GET | `/requests` e `/requests/{id}` | Accettazioni con esami e campioni |
| GET | `/invoices` e `/invoices/{id}` | Fatture e note di credito con righe |
| GET | `/sync/changes?dataset=...&since=...` | Delta di uno dei cinque dataset |
| GET | `/sync/status?dataset=...&id=...&id=...` | Riconciliazione da 1 a 200 ID |

Le liste di accettazioni e fatture contengono già i figli: evitare una chiamata di dettaglio per ogni record. I figli non vengono troncati. `pageSize` limita gli aggregati, non i byte o il numero di righe figlie. Il dettaglio manuale campione aveva oltre 2.000 righe.

## Parametri delle liste

| Parametro | Regola |
|---|---|
| `pageSize` | Default 100, massimo 500 sull'installazione verificata; leggere `/metadata` |
| `cursor` | Riferimento opaco restituito dal server; URL encoding a ogni invio |
| `includePatient` | Default false; mantenerlo identico nel ciclo e nel relativo delta |
| `clientId` | ID opaco ottenuto da clients; valido per clients, requests e invoices |
| `operatingCompany` | Codice azienda operativa; valido per clients, price-lists, requests e invoices |
| `from`, `to` | Date `yyyy-MM-dd`, entrambe incluse; requests sulla data accettazione, invoices sulla data documento |
| `requestNumber` | Solo requests, confronto esatto sul numero accettazione |
| `sampleBarcode` | Solo requests, confronto esatto sul barcode campione |

Nessuna data minima implicita. Senza filtro data sono compresi anche record con data nulla. Filtri non applicabili e intervalli errati vengono rifiutati. `9999-12-31` non è ammessa come `to`.

Gli ID sono stringhe opache: preservarli integralmente, senza decodificarli o costruirli dai numeri documento. Numero richiesta/fattura e ID sono proprietà distinte. La chiave del record importato è `(instanceId, dataset, id)`; gli ID dei figli sono nel contesto del rispettivo aggregato. I riferimenti possono essere multipli o non risolvibili subito.

Gli stati richiesta 0, 1 e 29 sono sempre esclusi, anche dai dettagli. Tutti gli altri sono ammessi. Non introdurre filtri impliciti sui soli record chiusi, recenti o MDL.

## Primo caricamento

Esempio senza filtro temporale:

```http
GET /api/v1/data/requests?includePatient=false&pageSize=100
Authorization: Bearer <TOKEN>
```

La prima richiesta restituisce 202 con `Retry-After: 2` e:

```json
{"snapshotId":"SNAPSHOT_DIMOSTRATIVO","nextCursor":"CURSORE_DIMOSTRATIVO","status":"capturing"}
```

Ripetere la stessa richiesta aggiungendo il cursore:

```http
GET /api/v1/data/requests?includePatient=false&pageSize=100&cursor=<CURSORE_URL_ENCODED>
```

Finché la risposta è 202 attendere `Retry-After`. Non ripetere la richiesta iniziale senza cursor durante il polling: il riferimento ricevuto serve anche a riprendere il lavoro dopo un arresto del connettore.

La risposta pronta è 200:

```json
{
  "items": [],
  "nextCursor": null,
  "snapshotId": "SNAPSHOT_DIMOSTRATIVO",
  "syncToken": "CHECKPOINT_DIMOSTRATIVO",
  "capturedAt": "2026-11-09T12:00:00Z",
  "totalCount": 0
}
```

`nextCursor` non nullo indica altre pagine. **`syncToken` è presente soltanto all'ultima pagina** e diventa il checkpoint confermato solo dopo il commit locale di tutte le pagine. Anche un dataset vuoto può produrre un checkpoint valido.

Le pagine sono immutabili nella stessa fotografia; una pagina ripetuta ha gli stessi dati. Non basarsi sull'uguaglianza testuale dei cursori: sono opachi. È possibile cambiare pageSize. Conservare dataset, filtri e proiezione; in particolare non aggiungere o togliere filtri durante il polling.

La risorsa `/price-lists/{id}/items` ha una paginazione autonoma e non emette un checkpoint per il dataset: per i delta sincronizzare `price-lists` come aggregato.

## Incrementale

```http
GET /api/v1/data/sync/changes?dataset=requests&since=<CHECKPOINT_URL_ENCODED>&includePatient=false&pageSize=100
```

Ripetere anche gli eventuali filtri del completo. Il delta usa lo stesso protocollo 202/polling/pagine. Durante la sua paginazione ripetere **sia since sia cursor**, oltre a dataset, filtri e includePatient.

Ogni elemento contiene `id`, `revision`, `operation`, `reason` e `data`:

| Operazione | Applicazione locale |
|---|---|
| `upsert` | Sostituire l'aggregato e l'insieme completo dei suoi figli con `data` |
| `remove`, `excluded_state` | Rimuovere dalla copia attiva la richiesta passata a uno stato escluso |
| `remove`, `out_of_scope` | Togliere dal sottoinsieme del filtro; il record esiste ancora nella sorgente standard |
| `archived`, `confirmed_archive` | Conservare il contenuto già importato e marcarlo archiviato |
| `unavailable`, `source_exit_unknown` | Conservare il contenuto e l'indicazione di uscita incerta |

Per le uscite `data` è null. `revision` è un riferimento opaco del contenuto/evento; usare identità e revisione per l'idempotenza. Una fattura annullata ancora presente può arrivare come upsert con `cancelled=true` e contributo economico zero.

Il delta rileva anche modifiche a figli, dati demografici e relazioni. Gestire un upsert come sostituzione, compresi figli rimossi dalla nuova versione; non limitarsi ad aggiungere le righe ricevute.

## Persistenza del consumer

Mantenere uno stato separato per `(instanceId, client tecnico, dataset, filtri canonici, includePatient)`. Cambiare filtro, proiezione o client richiede un nuovo completo per quel nuovo ambito.

```text
carica ambito e checkpoint confermato
se esiste una pagina in sospeso: riprendi URL, since e cursor salvati
altrimenti: avvia completo oppure delta dal checkpoint
finché 202: salva riferimento tecnico, attendi Retry-After, ripeti con cursor
per ciascuna pagina 200, in una transazione locale:
    applica gli elementi in modo idempotente
    salva snapshotId e riferimento della prossima pagina
    se ultima pagina: conferma syncToken e chiudi il ciclo
```

Il commit dati e quello del progresso devono essere atomici. Dopo un crash ripetere una pagina deve dare lo stesso risultato. Conservare l'ultimo checkpoint completo mentre si elabora il successivo. I dataset hanno fotografie indipendenti: i riferimenti possono arrivare prima dei record collegati.

Usare un lock locale per impedire due sincronizzazioni concorrenti dello stesso ambito. I filtri cliente/azienda selezionano un sottoinsieme e non sono autorizzazioni aggiuntive. Se più ambiti si sovrappongono, mantenere appartenenze separate: un `out_of_scope` non cancella globalmente un record presente in un altro ambito.

## Scadenze e riallineamento

- Pagine disponibili per 24 ore dal completamento, secondo i metadati.
- Checkpoint incrementale valido per 30 giorni dalla cattura.
- Fotografie completate sopravvivono al riavvio del servizio; quelle interrotte non producono un successo parziale.
- Le sorgenti della prima versione sono quelle standard; il contenuto già archiviato non viene recuperato dal server.

Con 409 `full_sync_required` effettuare un nuovo completo e **fonderlo con la copia esistente**, preservando gli archivi già importati. Per gli ID che non ricompaiono, interrogare `/sync/status` a blocchi di massimo 200 parametri `id` ripetuti:

```http
GET /api/v1/data/sync/status?dataset=requests&id=<ID1>&id=<ID2>
```

La risposta è un array con `id`, `operation` e `reason`, senza contenuto paziente. `available` significa presente e ammesso nelle sorgenti standard: leggerne il dettaglio e verificare il filtro; `remove/excluded_state` conferma l'esclusione; `archived` conserva la copia; `unavailable` conserva copia e incertezza. La sola assenza da un completo non è un comando di cancellazione.

Per suddividere il completo per periodi usare intervalli non sovrapposti, checkpoint distinti e gestione delle appartenenze. Il delta di ogni intervallo va continuato anche per modifiche retrodatate; una sola finestra mobile recente non garantisce di intercettarle tutte.

## Errori e ripetizioni

Decodificare UTF-8 sia `application/json` sia `application/problem+json`. ProblemDetails espone `status`, `title`, `code` e `correlationId`.

| Risposta | Comportamento |
|---|---|
| 400 | Correggere parametri/cursore; `scope_mismatch` non va aggirato mescolando ambiti |
| 401 | Ripetere login, poi la stessa richiesta con il riferimento esistente |
| 403 | Verificare ruolo e rotta; per DataAPI usare metadata come verifica autenticata |
| 404 | Risorsa assente/esclusa; non trasformare in cancellazione generale |
| 409 `cursor_expired` | Riavviare quel ciclo senza cursor, conservando il checkpoint confermato |
| 409 `full_sync_required` | Nuovo completo e riconciliazione conservativa |
| 429 | Rispettare Retry-After, limitare frequenza e concorrenza |
| 500 | Ripetizioni limitate con attesa crescente; conservare correlationId per assistenza |
| 503 | Cattura fallita/interrotta: niente import parziale, ripartire dal checkpoint confermato |

Il riferimento attuale è 60 chiamate/minuto per client; gestire sempre il 429 effettivo. Un solo lavoro acquisisce le fotografie alla volta nell'installazione. Pianificare un ciclo notturno con concorrenza contenuta.

Per i listini usare pagine più piccole se necessario: il collaudo ha misurato circa 27 MB di JSON per i 115 listini completi. I timeout HTTP devono tollerare le risposte di dettaglio; il polling 202 evita di mantenere aperta la prima chiamata per l'intera cattura.
