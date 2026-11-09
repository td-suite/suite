# Synclab Data API v1 nella Suite (connettore StudioLAB, CB Sistemi)

Consegna di CB Sistemi del 09/11/2026 (documentazione in `docs/synclab-data-api/`: 00_LEGGIMI, 01_CONTRATTO_API, 02_DIZIONARIO_BI,
openapi.json, esempi_sintetici.json, postman_collection.json). Installazione: `https://synclab.toscanadiagnostica.it`, client `TDSuite`,
ruolo `DataAPI`, contratto 1.0. La Suite tiene una **copia locale in sola lettura** dei cinque insiemi di dati del gestionale (clienti,
esami, listini, accettazioni, documenti economici) e la usa per il Controllo di gestione, il catalogo esami di Ordini, il Cockpit e la
Diagnostica. Non scrive nulla nel gestionale. Non conformità e Ordini continuano a usare ServiceNET per le loro scritture e letture per
accettazione.

## Architettura

| Pezzo | File | Cosa fa |
|---|---|---|
| Login | `server/src/lib/connectors.js` `studiolabClientToken()` | Connettore STUDIOLAB in `CLIENT_JWT`: `POST /api/v1/auth/client/login`, token in memoria fino a 2 minuti prima del `validTo` **restituito** (circa 15 minuti in questa installazione; senza `validTo` leggibile il token vale per la sola richiesta). |
| Client HTTP | `server/src/lib/synclab/client.js` | `get(path, query, {timeoutMs})`, `metadata()`, `pagina()`, `delta()`, `stato()` (blocchi di 200 id), `dettaglio()`. Gestione 202/401/429/5xx/409, decimali esatti, limitatore 60 chiamate al minuto, registro. |
| Persistenza | `server/src/lib/synclab/persistenza.js` | Upsert = sostituzione completa dell'aggregato e dei figli; marcatura delle uscite; appartenenze per ambito; svuotamento dei dati paziente. |
| Motore | `server/src/lib/synclab/sync.js` | `eseguiCiclo(dataset, {modo, filtri, includePatient})`, `eseguiTutti()`, lock per ambito, coda di processo, riconciliazione, job `synclab:notturno`, stato per l'interfaccia. |
| Letture | `server/src/lib/synclab/letture.js` | `produzioneMensile`, `fatturatoMensile`, `produzionePerOrg`, `fatturatoPerOrg`, `catalogoEsami`, `listinoCliente`, `indicatoriLaboratorio`. |
| API | `server/src/routes/synclab.js` su `/api/synclab` (solo amministratori) | stato, impostazioni, sincronizza/riprendi/completo, storico, clienti Synclab e abbinamento, listino di un client. |
| Pagina | `web/src/pages/admin/SynclabDati.jsx` → `/admin/connectors/synclab` | Amministrazione > Connettori > StudioLAB > "Dati Synclab (Data API)": schede Stato, Clienti Synclab, Impostazioni, Storico dei cicli. |
| Schema | `server/src/migrations/052_synclab_data_api.sql` (core) | Schema `synclab`, tabelle, ponti, vista `clients_td`. |
| Prova a riga di comando | `server/scripts/synclab-smoke.mjs` | health, login, metadata, prima pagina di exams (con il 202), conteggi. |
| Server finto | `server/test/helpers/fakeSynclab.mjs` | Solo dati sintetici di CB Sistemi; usato dai test e dal collaudo. |

Il registro delle chiamate è quello dei connettori (`public.connector_log`, modulo `synclab`): metodo, percorso **senza query**, esito,
millisecondi, numero di elementi, "altre pagine/ultima pagina", correlationId. Mai corpi, token, cursori, checkpoint o password; i
percorsi di dettaglio sono scritti come `/api/v1/data/requests/{id}`.

## Tabelle (schema `synclab`, migrazione core 052)

- **Stato**: `sync_scope` (un ambito = istanza, client tecnico, insieme di dati, filtri canonici, proiezione paziente; checkpoint
  confermato e `checkpoint_at` = capturedAt della fotografia, `ultimo_completo_at`, `pagina_in_sospeso`, lock `in_corso`/`lock_at`/
  `lock_pid`, `ultimo_esito`), `sync_run` (storico dei cicli: tipo COMPLETO, DELTA o RICONCILIAZIONE, origine NOTTURNO/MANUALE/RIPRESA,
  esito, pagine, record, aggiornati, rimossi, fuori ambito, archiviati, uscita incerta, già applicati, verificati, durata, attesa della
  cattura, prima importazione, errore, correlationId; tenuto 90 giorni), `scope_records` (appartenenza di ogni id a ogni ambito, con
  revisione e operazione), `run_visti` (id visti durante un completo, per la riconciliazione anche dopo un'interruzione).
- **Insiemi di dati**: `clients` (colonne del DataClientDto + `site_*`), `exams`, `price_lists` + `price_list_items`, `requests`
  (+ `dem_*` demografia, `patient_*` solo opt-in) + `request_items` + `samples`, `invoices` + `invoice_items`. Chiave
  `(instance_id, id)`; i figli `(instance_id, <padre>_id, ord)` con il loro id opaco in colonna. Importi, quantità, aliquote e sconti
  in `numeric` senza scala; null resta null; ogni riga conserva il JSON originale in `raw` (i numeri che un double non rappresenta
  esattamente arrivano come testo esatto: `JSON.rawJSON`).
- **Colonne comuni**: `revision`, `disponibilita` (ATTIVO, RIMOSSO_STATO_ESCLUSO, FUORI_AMBITO, ARCHIVIATO, USCITA_INCERTA),
  `disponibilita_reason`, `captured_at`, `first_seen_at`, `updated_at`, `deleted_at` (solo per i remove).
- **Ponti** (anche verso record non ancora arrivati, nessuna FK fra insiemi): `request_invoices` (con `lato` REQUEST o INVOICE: chi ha
  dichiarato il legame), `request_item_invoices`, `request_item_samples`.
- **Abbinamento**: `client_map` (scelta salvata: Legal entity e sede, `fonte` AUTO = proposta confermata o MANUALE, `perimetro_b2b`
  forzato) e la vista `clients_td` (proposta automatica, stato dell'abbinamento, perimetro B2B calcolato ed effettivo).

## Il ciclo

1. Metadati (`/api/v1/data/metadata`): instanceId, maxPageSize, deltaWindowDays, insiemi pubblicati.
2. Ambito: filtri dalle impostazioni (azienda operativa, solo dove il contratto la ammette: clienti, listini, accettazioni, documenti) e
   proiezione (solo le accettazioni possono essere opt-in). Lock dell'ambito: un secondo avvio sullo stesso ambito si salta; un lock più
   vecchio di 2 ore è stantio e si riprende. Una coda nel processo fa girare un ciclo alla volta (una sola cattura sull'installazione).
3. Pagina in sospeso? Si riprende da lì (stesso url, `since`, cursor). Altrimenti **delta** dal checkpoint confermato, **completo** se
   non c'è (o è più vecchio di `deltaWindowDays`, o il modo è "Completo forzato").
4. **202**: si salvano snapshotId e nextCursor nella pagina in sospeso, si attende `Retry-After` (2 s se manca) e si ripete con il
   cursor; dopo 2 ore di attesa errore, la pagina resta in sospeso per "Riprendi".
5. **200**: in UNA transazione si applicano gli elementi, si salva il prossimo cursor; all'ultima pagina il `syncToken` diventa il
   checkpoint confermato e `capturedAt` la sua data. Durante un delta `since` non cambia; filtri e proiezione non cambiano mai nel ciclo.
6. Delta: `upsert` sostituisce aggregato e figli (le righe assenti dalla nuova versione spariscono); `remove/excluded_state` marca
   RIMOSSO_STATO_ESCLUSO, valorizza `deleted_at` e toglie figli e ponti; `remove/out_of_scope` toglie il record dall'ambito (diventa
   FUORI_AMBITO solo se nessun altro ambito lo tiene attivo); `archived` conserva e marca ARCHIVIATO; `unavailable` conserva e marca
   USCITA_INCERTA. La stessa (id, revisione, operazione) già applicata non si ripete ("già applicati"). Un motivo di remove non
   riconosciuto si tratta come out_of_scope (nessuna cancellazione).
7. Listini come aggregato (pagine da 10 listini, ognuno con tutte le righe); `/price-lists/{id}/items` non entra nel ciclo.
8. Ordine notturno: exams, clients, price-lists, requests, invoices, uno alla volta; un errore su un insieme non ferma gli altri.

## Ripresa e riallineamento

- **Arresto a metà** (deploy, crash): la pagina confermata è in `pagina_in_sospeso` con il cursor della successiva; il ciclo successivo
  (notturno o "Riprendi") continua da lì nello stesso run, senza una nuova cattura. Se l'arresto avviene prima del commit, la pagina si
  ripete: la sostituzione completa dà lo stesso risultato.
- **409 cursor_expired**: run INTERROTTO, pagina in sospeso tolta, ciclo da capo senza cursor; il checkpoint confermato resta.
- **409 full_sync_required** (o checkpoint oltre `deltaWindowDays`): run INTERROTTO e nuovo completo di tipo RICONCILIAZIONE, fuso con la
  copia. Gli id dell'ambito che non ricompaiono **non si cancellano**: `/sync/status` a blocchi di 200 id; `available` → si legge il
  dettaglio e si verifica il filtro (fuori filtro = FUORI_AMBITO), `remove/excluded_state` → RIMOSSO, `archived` → ARCHIVIATO,
  `unavailable` → USCITA_INCERTA; un 404 del dettaglio lascia il record com'è. La fase di verifica sopravvive a un'interruzione.
- **503**: cattura fallita; dopo due ripetizioni con attesa crescente errore, pagina in sospeso tolta (nessun import parziale), il
  prossimo ciclo riparte dal checkpoint confermato.
- **429**: attesa di `Retry-After` e ripetizione (fino a 5 volte); **500/502/504** e rete: 3 ripetizioni con attesa 2, 4, 8 s, poi
  errore con la pagina in sospeso intatta.
- **400/403/`scope_mismatch`**: errore di configurazione, nessun avanzamento, nessuna ripetizione; **401**: un login nuovo e la stessa
  richiesta con lo stesso cursor.

## Impostazioni (connettore STUDIOLAB, `settings`; scheda Impostazioni della pagina)

| Chiave | Predefinito | Note |
|---|---|---|
| `data_api_enabled` | false | Accende il ciclo notturno: lo accende il CEO dopo la Prova connessione. Le sincronizzazioni manuali funzionano anche spenta. |
| `sync_ora` | 02:30 | Ora di Roma. Il job `synclab:notturno` controlla ogni 15 minuti: parte da quest'ora in poi, una volta al giorno (fino a 3 tentativi se fallisce). |
| `page_size` | 100 | Record per pagina (massimo = maxPageSize dei metadati). |
| `page_size_listini` | 10 | Listini per pagina. |
| `include_patient` | false | Opt-in della proiezione paziente, solo per le accettazioni, con avviso in pagina. Crea un ambito distinto (nuovo completo). Spegnerla svuota `patient_*`, `historical_description` e `raw.patient` già importati. |
| `data_api_timeout_ms` | 120000 | Tempo massimo per pagina. Chiave distinta da `timeout_ms` (12 s, usato da login, NC e Ordini). |
| `operating_company` | vuoto | Filtro facoltativo; cambiarlo crea un nuovo ambito (nuovo completo); i record del vecchio ambito restano nella copia. |
| `datasets` | tutti e 5 | Insiemi del ciclo notturno. |

## Prova connessione

Con `CLIENT_JWT`: health (senza token) → login → **`GET /api/v1/data/metadata`** (istanza, contratto, insiemi, pagina massima, finestra
delta) → `/api/v1/auth/client/info` solo come secondo passo: con il ruolo DataAPI risponde 403 e la Prova dice "ruolo DataAPI: info non
disponibile, metadati ok". Su un'installazione senza Data API (metadata 404) vale ancora la verifica di prima su info.

## Uso dei dati nella Suite

- **Finance Management > Margine per cliente Service**: fonte di produzione `SYNCLAB` subito dopo la riga salvata a mano e prima di
  Retail e Ordini (origine "Synclab Data API: accettazioni del gestionale"): righe d'esame non cancellate delle accettazioni ATTIVE con
  data nel mese; ricavo = somma dei netti di riga storici (le righe senza prezzo al listino corrente del Business Hub se c'è, altrimenti
  "da indicare"); lo sconto di testata è riportato nella nota, non applicato. Colonna separata **"Fatturato da documenti (Synclab)"**:
  `netRevenueContribution` una volta per documento con data nel mese; non è sommata al ricavo né al margine.
- **Ordini**: `syncExamCatalog` usa gli esami di Synclab se la Data API è abilitata e il catalogo è importato (code = examCode,
  description, sector = category o branchCode; materiale e "esame service" restano quelli presenti); altrimenti ServiceNET `/api/esami`.
- **Cockpit**, gruppo Operations: "Accettazioni ieri (Synclab)" e "Fatturato laboratorio mese (Synclab)" solo se ci sono dati importati
  (altrimenti non compaiono).
- **Diagnostica**: D48 "Clienti Synclab senza Legal entity abbinata" (INFO), D49 "Sincronizzazione Synclab ferma" (ATTENZIONE: con la
  Data API abilitata, insieme mai sincronizzato, checkpoint più vecchio di 2 giorni o ultimo ciclo in errore), D50 "Legal entity cliente
  attiva senza cliente Synclab" (INFO, solo quando i clienti sono stati importati).

### Abbinamento client Synclab ↔ Legal entity e perimetro B2B
Proposta automatica: `clientCode` = codice StudioLAB di una sede della Suite (`sites.studiolab_code`, la regola di retail/lib/b2b.js) →
Legal entity della sede; altrimenti partita IVA o codice fiscale di **una sola** Legal entity (partite IVA tutte a zero ignorate).
"Abbina" conferma la proposta (fonte AUTO), "Scegli" sceglie a mano (MANUALE). Perimetro B2B calcolato = client abbinati a una Legal
entity CLIENTE attiva con livello ATTIVO o CONTRATTUALIZZATO (`public.cliente_livello`, cioè `clienti_attivi_v` del Business Hub);
"Includi"/"Escludi" lo forzano, "Ripristina" torna al calcolo. `occupationalMedicine` non decide il perimetro (resta il flag della
medicina del lavoro).

## Come leggere i run (scheda "Storico dei cicli")

- *completo / variazioni / riallineamento*; *prima importazione* = primo completo di quell'ambito: durata e record misurano la prima
  importazione completa (dato richiesto dal contratto per tarare pagine e memoria).
- *attesa* = tempo passato ad aspettare la cattura (202) e i Retry-After: non è tempo di elaborazione della Suite.
- *interrotto* = ciclo abbandonato e ripartito da capo (cursore scaduto o completo richiesto dal server): il run successivo è quello buono.
- *in errore* con la pagina in sospeso = "Riprendi" continua dallo stesso punto; il correlationId va comunicato a CB Sistemi.

## Collaudo e test

`server/test/synclab.test.mjs` (server finto `test/helpers/fakeSynclab.mjs`, password del client finto casuale a ogni esecuzione):
login e rinnovo (cache sul validTo, 401 → login nuovo e stessa pagina), 202 con Retry-After e polling con lo stesso cursor codificato,
tre pagine con syncToken solo all'ultima e checkpoint solo dopo il commit, pagina ripetuta idempotente, arresto fra commit e avanzamento,
delta con figlio modificato e figlio rimosso, le quattro operazioni, due ambiti con filtri diversi, 409 full_sync_required con
`/sync/status` a blocchi di 200, 429/500/503, null e precisione (12.5, 20, 10; decimali oltre il double), nota di credito manuale,
proiezione paziente (default e opt-in, svuotamento), produzioneMensile e fatturatoMensile, scegliProduzione con SYNCLAB, D48-D50, Prova
connessione con i metadati, regola del ciclo notturno.

Prova sull'istanza vera (credenziali solo da ambiente o connettore): `cd server && node scripts/synclab-smoke.mjs` (vedi intestazione
dello script).

## Da confermare con CB Sistemi
- Nome esatto dei parametri di query: il contratto e Postman usano `pageSize`, `cursor`, `includePatient` (OpenAPI li scrive con
  l'iniziale maiuscola): la Suite usa la forma del contratto.
- Se `correlationId` arriva anche in un'intestazione HTTP (la Suite lo legge solo dal ProblemDetails).
- Comportamento di `/sync/status` per id mai esistiti e significato operativo di `unavailable` nel lungo periodo (quando ricontrollare).
- Tempi e dimensioni reali della prima importazione completa di accettazioni e documenti (pagine da 100 sufficienti? timeout di 120 s?).
- Il caso nota di credito standard (non esercitato nel loro collaudo per assenza di dati).
