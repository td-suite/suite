# Synclab Data API v1 nella Suite (connettore StudioLAB, CB Sistemi)

Consegna di CB Sistemi del 09/11/2026 (documentazione in `docs/synclab-data-api/`: 00_LEGGIMI, 01_CONTRATTO_API, 02_DIZIONARIO_BI,
openapi.json, esempi_sintetici.json, postman_collection.json). Installazione: `https://synclab.toscanadiagnostica.it`, client `TDSuite`,
ruolo `DataAPI`, contratto 1.0. La Suite tiene una **copia locale in sola lettura** dei cinque insiemi di dati del gestionale (clienti,
esami, listini, accettazioni, documenti economici) e la usa per il Controllo di gestione, il catalogo esami di Ordini, il Cockpit e la
Diagnostica, e dalla v0.67.1 per il **Profilo dei pazienti** di Retail (docs/RETAIL_PROFILO_PAZIENTI.md). Non scrive nulla nel
gestionale. Non conformità e Ordini continuano a usare ServiceNET per le loro scritture; dalla v0.67.1 il Desk NC cerca le accettazioni anche
nella copia, la produzione e le correlazioni di Ordini la leggono, e NC usa la Data API per il **recupero puntuale del paziente**
quando manca (sotto, "Chi usa i dati" e "Dati paziente: dove e perché").

## Architettura

| Pezzo | File | Cosa fa |
|---|---|---|
| Login | `server/src/lib/connectors.js` `studiolabClientToken()` | Connettore STUDIOLAB in `CLIENT_JWT`: `POST /api/v1/auth/client/login`, token in memoria fino a 2 minuti prima del `validTo` **restituito** (circa 15 minuti in questa installazione; senza `validTo` leggibile il token vale per la sola richiesta). |
| Client HTTP | `server/src/lib/synclab/client.js` | `get(path, query, {timeoutMs})`, `metadata()`, `pagina()`, `delta()`, `stato()` (blocchi di 200 id), `dettaglio()`. Gestione 202/401/429/5xx/409, decimali esatti, limitatore 60 chiamate al minuto, registro. |
| Persistenza | `server/src/lib/synclab/persistenza.js` | Upsert = sostituzione completa dell'aggregato e dei figli; marcatura delle uscite; appartenenze per ambito; svuotamento dei dati paziente. |
| Motore | `server/src/lib/synclab/sync.js` | `eseguiCiclo(dataset, {modo, filtri, includePatient})`, `eseguiTutti()`, lock per ambito, coda di processo, riconciliazione, job `synclab:notturno`, stato per l'interfaccia. |
| Letture | `server/src/lib/synclab/letture.js` | dalla v0.68.5 la **produzione erogata** (`produzioneErogata`, `produzioneGiornaliera`, `produzioneClientiGiorni`, `topClientiProduzione`, `statiErogati`, `fonteProduzione`), poi `produzioneMensile`, `fatturatoMensile`, `produzionePerOrg`, `fatturatoPerOrg`, `catalogoEsami`, `listinoCliente`, `indicatoriLaboratorio`; dalla v0.67.1 `profiloPazienti`, `sintesiProfilo`, `comuniProfilo`, `statoProfilo` (solo demografia). |
| Abbinamenti (v0.68.5) | `server/src/lib/synclab/abbinamenti.js` | `allineaAbbinamenti` (job `synclab:abbinamenti`, "Riallinea abbinamenti"), `decidiClient`, `scegliSede`, `candidatiPerOrg`, `abbinaManuale`: client Synclab ↔ Legal entity e SEDE, codice StudioLAB scritto nella sede. |
| Listini (v0.68.5) | `server/src/lib/synclab/listini.js` | `listiniDiOrg`, `confrontoConHub`, `xlsxListiniOrg`, `xlsxListiniAggregato` (Business Hub). |
| Recupero puntuale NC | `server/src/modules/nc/lib/pazienteSynclab.js` | `recuperaPaziente(acc)`: ricerca nella copia per numero o barcode, `dettaglio('requests', id, { includePatient: true })`, merge nella cache di NC. |
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
| `stati_erogati` | 18, 20, 25, 40, 50 | v0.68.5. Stati dell'accettazione che valgono **produzione erogata** in tutta la Suite (sotto). Scheda Impostazioni con la legenda dei codici. **Ipotesi da confermare** con il CEO e CB Sistemi. Letti anche in SQL da `synclab.stati_erogati()` (migrazione core 055). |
| `sync_intraday_minuti` | 60 | v0.68.5. Fra le 7 e le 21 ora di Roma il job `synclab:intraday` (controllo ogni 5 minuti) esegue il **delta delle accettazioni** ogni N minuti, un ciclo alla volta (stessa coda e stesso lock del notturno; un ciclo in corso fa saltare il turno). 0 = spento. Solo con `data_api_enabled`. Esito in `app_settings` `synclab.intraday`; nei run l'origine è "di giorno" (`GIORNO`). |

## Prova connessione

Con `CLIENT_JWT`: health (senza token) → login → **`GET /api/v1/data/metadata`** (istanza, contratto, insiemi, pagina massima, finestra
delta) → `/api/v1/auth/client/info` solo come secondo passo: con il ruolo DataAPI risponde 403 e la Prova dice "ruolo DataAPI: info non
disponibile, metadati ok". Su un'installazione senza Data API (metadata 404) vale ancora la verifica di prima su info.

## Dati paziente: dove e perché (decisione del CEO del 09/11/2026 sera)

| Dove | Cosa c'è | Perché |
|---|---|---|
| Copia `synclab.requests` (proiezione **standard**, `include_patient` = false: impostazione da lasciare spenta) | `dem_age_years`, `dem_sex`, `dem_city`, `dem_province`, `dem_postal_code`; `patient_*` e `historical_description` **vuoti** | La BI e la profilazione servono con provenienza, età e sesso; nessuna identità in massa nella Suite. Il CEO spegne la proiezione paziente anche lato connettore. |
| Retail > Profilo dei pazienti (laboratorio) | Solo aggregati della demografia (accettazioni, non persone) | Profilazione per sede, provenienza, fasce d'età e sesso (docs/RETAIL_PROFILO_PAZIENTI.md). Le query non leggono mai `patient_*`. |
| Cache delle accettazioni di Non conformità (`nc.accettazioni.paziente_*`) | Cognome, nome, data di nascita, sesso, codice fiscale **di una accettazione** | La NC deve poter avere il paziente quando HL7/ServiceNET non lo hanno dato: **recupero puntuale**, una accettazione alla volta. Lo vedono gli stessi profili che già vedono il paziente nella NC (laboratorio, qualità, direzione, consultazione interna e la sede inviante della propria accettazione); mai nelle email. |

**Recupero puntuale (NC, `modules/nc/lib/pazienteSynclab.js`)**
1. Quando? Il Desk richiama un'accettazione (`GET /api/nc/accettazioni/:id`) e dopo ServiceNET (non collegato, non risponde, non trova
   l'accettazione o non restituisce il paziente) `paziente_cognome` è ancora vuoto; oppure "Recupera dal gestionale" nel Desk o nella
   scheda NC (`POST /api/nc/accettazioni/:id/paziente`, che prima riprova ServiceNET se collegato).
2. Ricerca nella copia: `synclab.requests.request_number` = numero dell'accettazione **oppure** `synclab.samples.barcode` = codice
   letto; se le corrispondenze sono più di una, nessuna scelta a caso (messaggio "verificare in StudioLAB").
3. Una chiamata: `GET /api/v1/data/requests/{id}?includePatient=true` (`client.js` `dettaglio`); il dettaglio deve corrispondere
   (stesso numero o un campione con quel barcode), altrimenti nessuna scrittura.
4. Scrittura **solo** nella cache di NC con la stessa funzione di merge di ServiceNET (`lis.upsertAccettazione`, l'origine della riga non
   cambia); **niente** nelle tabelle synclab (la copia resta in proiezione standard). Il sesso è il codice della demografia del record.
5. Limite: al più **una chiamata per accettazione ogni 10 minuti** (memoria del processo), dentro le 60 chiamate al minuto del contratto.
6. Registro: audit di NC `ACC_PAZIENTE_SYNCLAB` "Paziente recuperato dal gestionale per la NC <codice>" (o "per la NC in compilazione
   sull'accettazione <numero>") **senza il nome**; `lis_eventi` canale SYNCLAB con l'esito senza dati personali; registro dei connettori
   con il percorso `/api/v1/data/requests/{id}` senza query.
7. Data API spenta (connettore StudioLAB non attivo, non `CLIENT_JWT` o `data_api_enabled` off), accettazione non nella copia, 404 del
   gestionale, nessun paziente nella risposta, rete: messaggio chiaro nel Desk/NC, **nessun errore bloccante**, nessuna chiamata quando
   la Data API è spenta.

## Chi usa i dati (v0.67.1, aggiornato v0.68.1)

| Chi | Cosa legge dalla copia | Dove | Regola |
|---|---|---|---|
| Finance Management | righe d'esame e documenti | `modules/finance` (Margine per cliente Service) | sotto, "Uso dei dati nella Suite" |
| Ordini · catalogo esami | `synclab.exams` | `orders/lib/studiolab.js` `syncExamCatalog` | descrizione e settore; materiale da ServiceNET |
| **Ordini · Produzione StudioLab** | righe d'esame non cancellate delle accettazioni ATTIVE, per client abbinato | `orders/lib/synclab.js` `aggiornaProduzioneSynclab`, job `orders:produzione-synclab` (60 min, solo con `data_api_enabled` e dati), pulsante "Aggiorna da Synclab" | conteggio per struttura (sede TD = id sede; punto SERVICE = id del punto, letto dalla Legal entity; solo Legal entity = −id), mese e codice esame → `orders.production` source STUDIOLAB; una riga **MANUALE o IMPORT** dello stesso mese ed esame **vince**; tutti i mesi presenti ricalcolati (il corrente compreso); tolte le righe STUDIOLAB di quei mesi che la copia non conferma |
| **Ordini · Correlazione esami e materiali** | `synclab.samples` (material, container) legati alle righe con `request_item_samples` | `orders/lib/synclab.js`, tabella `orders.etichette_synclab` (migrazione orders 014) | coppia più frequente per esame con percentuale e osservazioni; coppia abbinata a un articolo → proposta di correlazione con fonte SYNCLAB (anteprima e conferma), mai sulle MANUALE/LISTINO |
| **Non conformità · Desk** | `requests.request_number`, `samples.barcode`, righe e campioni | `nc/lib/synclabDesk.js` | se la cache NC non ha l'accettazione: ricerca esatta, normalizzata, anno + numero; una → importata nella cache (origine SYNCLAB, migrazione nc 009); più → elenco; nessuna → registrazione manuale con la data della copia |
| Non conformità · paziente | dettaglio di UNA accettazione (opt-in) | `nc/lib/pazienteSynclab.js` | sotto, "Dati paziente: dove e perché" |
| Retail · Profilo dei pazienti | demografia | `lib/synclab/letture.js` | docs/RETAIL_PROFILO_PAZIENTI.md (filtro perimetro dalla v0.68.0) |
| **Retail · sezione B2B** (v0.68.0) | accettazioni, righe d'esame, documenti, listini correnti, `clients_td` | `lib/synclab/letture.js`: `cruscottoB2B`, `produzioneClientiMesi`, `fatturatoClientiMesi`, `prezziApplicati`, `schedaClienteSynclab`, `statoCopia` | tutto il B2B di Retail deriva da qui; fatturato una volta per documento, NC separate, annullati esclusi e contati (docs/RETAIL.md) |
| **Retail · Cruscotto di rete e Laboratorio in sede** (v0.68.0) | come sopra, per ripartizione | `quadroLaboratorio`, `laboratorioInSede`, `ripartizioneClienti` | ripartizione: client abbinato a una sede TD = Laboratorio in sede (B2C), Legal entity esterna o non abbinato = B2B; impostazione Retail `synclab_privati_in_b2c` (false = tutto B2B) |
| **Business Hub · correlazione** (v0.68.1, v0.68.5) | produzione erogata per Legal entity (`produzionePerOrg`, `produzioneGiornaliera`), documenti come dato secondario (`fatturatoPerOrg`), `clients_td` | `modules/business/lib/synclabAccount.js` | maturato dell'anno = produzione erogata, progressione giornaliera del mese, pro quota e run rate contro il fatturato FY atteso dichiarato; scheda account, Pipeline, Cruscotto, D51 (docs/BUSINESS_HUB.md) |
| **Business Hub · listini e codice StudioLab** (v0.68.5) | listini correnti dei client abbinati, `clients_td`, `client_map` | `lib/synclab/listini.js`, `lib/synclab/abbinamenti.js` | "Listino del gestionale (Synclab)" nella scheda account con XLSX e confronto; "Listini del gestionale (XLSX aggregato)" in Clienti; codice StudioLab e client del gestionale per account e punti; abbinamento automatico e manuale |
| **Finance · Conto economico** (v0.68.1) | come Margine per cliente Service | `modules/finance/lib/contoEconomico.js` `movimentiService` | nei ricavi solo la produzione effettiva (Synclab, StudioLAB, manuale); le stime commerciali in una riga non sommata (docs/FINANCE.md) |
| **Cockpit · schermo unico** (v0.68.1, v0.68.5) | produzione erogata B2B (`produzioneErogata`, `produzioneGiornaliera`, `topClientiProduzione`), accettazioni ed esami (`quadroLaboratorio`), documenti solo come dato secondario, `statoCopia` | `lib/cockpitMonitor.js` `schermoMonitor` | ricavi = B2C (GIPO) + B2B (produzione erogata); laboratorio del giorno e del mese, andamento giornaliero; TOP 5 clienti per produzione erogata (docs/COCKPIT.md) |
| Cockpit, Diagnostica | conteggi e indicatori | `lib/cockpitMonitor.js`, `lib/diagnostica.js` | docs/COCKPIT.md; D51 (maturato sotto il 75% del pro quota) |

Dettagli di Ordini: docs/ORDINI_SYNCLAB.md.

## Uso dei dati nella Suite

- **Finance Management > Margine per cliente Service**: fonte di produzione `SYNCLAB` subito dopo la riga salvata a mano e prima di
  Retail e Ordini (origine "Synclab Data API: produzione erogata …"): dalla v0.68.5 la **produzione erogata** (sotto) con data nel mese;
  ricavo = netti di riga con lo sconto di testata applicato una volta (le righe senza prezzo al listino corrente del Business Hub se c'è,
  altrimenti "da indicare"). Colonna separata **"Documenti emessi (secondario)"** (ex "Fatturato da documenti"):
  `netRevenueContribution` una volta per documento con data nel mese; non è sommata al ricavo né al margine.
- **Ordini**: `syncExamCatalog` usa gli esami di Synclab se la Data API è abilitata e il catalogo è importato (code = examCode,
  description, sector = category o branchCode; materiale e "esame service" restano quelli presenti); altrimenti ServiceNET `/api/esami`.
- **Cockpit**, gruppo Operations: "Accettazioni erogate ieri (Synclab)" e "Produzione erogata laboratorio mese (Synclab)" (v0.68.5, con i documenti emessi come dato secondario) solo se ci sono dati importati
  (altrimenti non compaiono); gruppo Retail e Flow (v0.67.1): "Età mediana pazienti laboratorio (mese)" e "Quota fuori area", con la
  stessa regola.
- **Retail > Profilo dei pazienti (laboratorio)** (v0.67.1): demografia delle accettazioni per sede, provenienza, andamento, esami e
  orari, export Excel (docs/RETAIL_PROFILO_PAZIENTI.md).
- **Non conformità** (v0.67.1): recupero puntuale del paziente mancante (sopra).
- **Retail, riordino del 09/11/2026** (v0.68.0): cruscotto complessivo B2C + B2B, sezione B2B interamente da Synclab (cruscotto, aziende e
  strutture con produzione e fatturato del mese, scheda cliente, produzione cliente × mese con Excel, fatturato da documenti, listini
  applicati contro listino Synclab e Business Hub, budget B2B), Laboratorio in sede nel B2C. Il perimetro B2B dei numeri è la
  ripartizione (sede TD / Legal entity esterna o non abbinato), non `perimetro_b2b`, che resta l'indicatore "cliente attivo del Business
  Hub" mostrato accanto al cliente. Dettagli: docs/RETAIL.md.
- Migrazione core **053** (`053_profilo_pazienti.sql`): cache `public.geo_comuni` per la mappa dei comuni e indici su
  `requests.request_number`, `samples.barcode`, `request_items (instance_id, request_id)`.
- **Diagnostica**: D48 "Clienti Synclab senza Legal entity abbinata" (INFO), D49 "Sincronizzazione Synclab ferma" (ATTENZIONE: con la
  Data API abilitata, insieme mai sincronizzato, checkpoint più vecchio di 2 giorni o ultimo ciclo in errore), D50 "Legal entity cliente
  attiva senza cliente Synclab" (INFO, solo quando i clienti sono stati importati).

## Produzione erogata (v0.68.5, richiesta del CEO del 10/11/2026)

"A me non interessa il dato delle fatture ma il dato delle accettazioni in stato erogato: altrimenti non vedrei la progressione quotidiana
finché non fatturi a inizio del mese successivo. Mi serve nei vari cruscotti." La **produzione erogata** è la grandezza principale dei
ricavi B2B in tutta la Suite (Cockpit, Retail, Business Hub, Finance, Diagnostica). Definizione UNICA in `lib/synclab/letture.js`:

- **accettazioni**: ATTIVE nella copia (`disponibilita` ATTIVO, non cancellate), con almeno una riga d'esame non cancellata, con **stato in
  `stati_erogati`** (impostazione del connettore; predefiniti **18 prelievo eseguito, 20 in lavorazione, 25 in firma, 40 referto pronto, 50
  chiuso** = dal prelievo eseguito in poi; esclusi **10 prenotata, 11 NC mai arrivato, 15 in attesa, 30 attende prelievo**). **Ipotesi da
  confermare** con il CEO e con CB Sistemi (in particolare 25 "in firma" e il trattamento di eventuali altri codici inclusi dal server);
- **valore** = Σ delle righe d'esame non cancellate di `netUnitPriceExcludingVat × quantity × (1 − headerDiscountPercent/100)`: il netto di
  riga è PRIMA dello sconto di testata (dizionario BI), quindi lo sconto di testata si applica **una volta, qui**: è il netto vero. Le righe
  con prezzo (o quantità) null non entrano nel valore e si contano a parte ("n esami senza prezzo"); lo sconto applicato si espone a parte;
- **data** = data dell'accettazione; **esami** = righe d'esame non cancellate delle accettazioni erogate;
- funzioni: `produzioneErogata({ da, a, per: giorno | mese | cliente | sede | ripartizione, ripartizione: B2B | LAB_SEDE, chiave, siteId,
  annoPrima })`, `produzioneGiornaliera`, `produzioneClientiGiorni`, `topClientiProduzione`; `produzioneMensile` e `produzionePerOrg`
  (Finance e Business Hub) e la base `cteLab` di Retail usano la stessa regola;
- **fonte dichiarata** sotto ogni numero (`fonteProduzione`): "Synclab, accettazioni erogate (stati 18, 20, 25, 40, 50), netto di riga e
  sconto di testata, copia al gg/mm/aaaa · aggiornato alle HH:MM" (ora del checkpoint delle accettazioni);
- **documenti emessi** (fatturato da documenti, `netRevenueContribution` una volta per documento) restano un dato **secondario** dove già
  c'erano, mai il KPI principale, mai sommati alla produzione;
- **freschezza**: il delta delle accettazioni gira anche di giorno (`sync_intraday_minuti`, sopra), così la produzione del giorno si aggiorna.

### Abbinamento automatico e codice StudioLab (v0.68.5)
"Perché in Business Hub lato service e lato Punti Prelievo non li associ correttamente al codice StudioLab relativo? Correggi!" (CEO).
Fonte unica del codice resta `public.sites.studiolab_code` (sede SERVICE del cliente o sede TD del punto); `synclab.client_map` è
l'abbinamento. `lib/synclab/abbinamenti.js`, per ogni client ATTIVO nella copia:
1. già abbinato: completa la sede se manca e scrive il codice nella sede se manca; abbinamento tolto a mano (fonte MANUALE senza Legal
   entity): non si tocca più;
2. non abbinato: Legal entity con la prima regola che dà un risultato: **R0** `clientCode` = codice StudioLAB di una sede; **R1**
   `clientCode` = codice della Legal entity (es. SER0033) o di una sede; **R2** partita IVA / codice fiscale (tutti zeri ignorati); **R3**
   ragione sociale normalizzata identica (senza S.r.l., S.p.A., punteggiatura) e stesso comune. Più Legal entity con la stessa regola =
   **ambiguo** (elenco con "Scegli");
3. sede: quella data dalla regola, altrimenti fra le sedi attive della Legal entity del tipo giusto (SERVICE per i clienti; punti e centri,
   cioè non SERVICE, per Toscana Diagnostica e le società del gruppo) l'unica, o quella con lo stesso indirizzo (abbreviazioni sciolte),
   poi stesso comune, poi nome della sede nella descrizione della `site` del client. Una Legal entity con più sedi service può avere più
   client Synclab: ciascuno va alla **sua** sede; una sede già presa da un altro client resta "da scegliere";
4. codice: se la sede non ha `studiolab_code`, il client è attivo e nessun'altra sede ha quel codice, si scrive con `saveSite` (audit
   SITE_UPDATED, origine "codice StudioLAB dal gestionale"); un codice diverso già presente non si sovrascrive mai (conflitti nel rapporto).
Esecuzione: job `synclab:abbinamenti` dopo ogni ciclo riuscito dei `clients` (completo o delta) e ogni 6 ore; "Riallinea abbinamenti" nella
scheda Clienti Synclab (con l'elenco di ambigui, sedi da scegliere e conflitti dell'ultimo allineamento, `app_settings` `synclab.abbinamenti`);
"Abbina al cliente del gestionale" nella scheda account del Business Hub (proposte con le stesse regole, sede proposta, codice scritto nella
sede). API: `GET /api/synclab/abbinamenti` (ultimo, `?anteprima=1` senza scrivere), `POST /api/synclab/abbinamenti/riallinea`.

### Credenziali del portale
**Credenziali del portale: non esposte dalla Data API v1.** Verificato su `openapi.json` (10/11/2026): `DataClientDto` ha solo id,
clientCode, legalName, billingClientId, operatingCompany, vatNumber, fiscalCode, indirizzo, contatti, email (fatture, NC), priceListId,
extraPriceListId, active e `site` (descrizione, indirizzo, contatti); nessun campo di utente, password o accesso al portale referti. Le
credenziali associate al cliente in StudioLab non si vedono né si importano con questa API: nella Suite non è implementato nulla (andrebbero
chieste a CB Sistemi come evoluzione del contratto).

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

`server/test/v0685-produzione-erogata.test.mjs` (v0.68.5): produzione erogata (stati, sconto di testata una volta, prezzi null, giorno,
mese, cliente, sede, anno prima, top clienti, stati dall'impostazione), Cockpit sulla produzione, Business Hub (maturato, progressione
giornaliera, D51), XLSX dei listini (righe esatte, riepilogo, confronto, aggregato con i non associati), abbinamento automatico (univoco,
ambiguo, per sede, codice scritto, conflitto, abbinamento tolto a mano), regola dell'aggiornamento di giorno.
`server/test/synclab.test.mjs` (server finto `test/helpers/fakeSynclab.mjs`, password del client finto casuale a ogni esecuzione):
login e rinnovo (cache sul validTo, 401 → login nuovo e stessa pagina), 202 con Retry-After e polling con lo stesso cursor codificato,
tre pagine con syncToken solo all'ultima e checkpoint solo dopo il commit, pagina ripetuta idempotente, arresto fra commit e avanzamento,
delta con figlio modificato e figlio rimosso, le quattro operazioni, due ambiti con filtri diversi, 409 full_sync_required con
`/sync/status` a blocchi di 200, 429/500/503, null e precisione (12.5, 20, 10; decimali oltre il double), nota di credito manuale,
proiezione paziente (default e opt-in, svuotamento), produzioneMensile e fatturatoMensile, scegliProduzione con SYNCLAB, D48-D50, Prova
connessione con i metadati, regola del ciclo notturno. `server/test/synclab-profilo-nc.test.mjs` (v0.67.1): profilo pazienti (fasce,
provenienza, fuori area, anno prima, età null, export, mappa e cache dei comuni) e recupero puntuale NC (cache vuota → dettaglio opt-in →
cache valorizzata, nulla nella copia e nei registri; limite dei 10 minuti; barcode; Data API spenta → nessuna chiamata).

Prova sull'istanza vera (credenziali solo da ambiente o connettore): `cd server && node scripts/synclab-smoke.mjs` (vedi intestazione
dello script).

## Da confermare con CB Sistemi
- Stati "erogati" (v0.68.5): 18, 20, 25, 40, 50 come produzione erogata; significato operativo degli altri codici inclusi dal server.
- Nome esatto dei parametri di query: il contratto e Postman usano `pageSize`, `cursor`, `includePatient` (OpenAPI li scrive con
  l'iniziale maiuscola): la Suite usa la forma del contratto.
- Se `correlationId` arriva anche in un'intestazione HTTP (la Suite lo legge solo dal ProblemDetails).
- Comportamento di `/sync/status` per id mai esistiti e significato operativo di `unavailable` nel lungo periodo (quando ricontrollare).
- Tempi e dimensioni reali della prima importazione completa di accettazioni e documenti (pagine da 100 sufficienti? timeout di 120 s?).
- Il caso nota di credito standard (non esercitato nel loro collaudo per assenza di dati).
