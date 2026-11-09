# Integrazione Silva: come funziona nella Suite

Versione della Suite: **0.68.2** (09/11/2026). Fonte del contratto: **Guida tecnica API ordini v1 di Silva** del 9 novembre 2026, in
`docs/silva-api-ordini/` (testo `Guida_Tecnica_v1_con_stato.txt`, PDF, `postman_collection.json`, `esempio_ordine.json`). Dove la nostra
proposta del 31/10 (sezione finale "Storico") differisce dalla guida, vale la guida.

Regola del CEO: **una volta approvato l'ordine da parte di Ops, viene trasmesso a Silva.** Silva chiede che la **prima POST sia
concordata**: per questo la trasmissione automatica parte solo dopo il primo invio fatto a mano e confermato (sezione 5).

## 1. Chiamate

| Chiamata | Quando | Esito nella Suite |
|---|---|---|
| `GET {base}/api/v1/destinazioni` | "Aggiorna destinazioni" in Ordini > Strutture, Prova connessione del connettore, cache di 10 minuti | elenco delle sedi autorizzate da Silva, salvato anche in `orders.app_settings.silva_destinazioni` |
| `POST {base}/api/v1/ordini` | all'approvazione di Ops (automatismo attivo), dal job `orders:silva-push` ogni 5 minuti, dal pulsante nel dettaglio dell'ordine | ricevuta Silva (riferimento e ricevutoAl) sull'ordine |
| `GET {base}/api/v1/ordini/{numero}/stato` | job `orders:silva-stato` ogni 30 minuti, pulsante "Aggiorna stato da Silva", "Aggiorna ora lo stato da Silva" in Impostazioni | avanzamento interno dell'ordine (sezione 4) |
| `GET {base}/api/v1/catalogo` e `/catalogo/modifiche` | job `orders:silva-catalogo` (invariato dalla 0.33) | catalogo e giacenze del Magazzino Centrale |

- `{base}` = `https://silva.cloud/portaleordini` (Base URL del connettore SILVA in Amministrazione > Connettori).
- Header `X-API-KEY` su **ogni** chiamata, con la chiave del connettore. La chiave determina cliente, magazzino e utente di
  attribuzione presso Silva: nel corpo non c'è più il codice cliente. La chiave non compare mai in file, registri o risposte.
- **30 richieste al minuto per IP e processo, condivise con il catalogo.** Tutte le chiamate (catalogo, destinazioni, ordini, stato,
  Prova connessione) passano dallo stesso limitatore (`silvaCall` in `server/src/modules/orders/lib/silva.js`): finestra mobile di
  60 secondi a 28 chiamate (margine di 2 per le prove a mano con Postman) e, dopo un 429, pausa di tutte le chiamate fino al
  `Retry-After`. Lo stato del limitatore è in Ordini > Impostazioni.

## 2. Destinazioni: le strutture associate alle sedi Silva

Ogni struttura che riceve materiale (sede TD o Legal entity cliente del service) va associata a una **destinazione Silva**: il codice
numerico della GET destinazioni. Nella POST parte **solo** `destinazione.codice`; nome e indirizzo li prende Silva dalla sua anagrafica.

- Ordini > Strutture > scheda **Destinazioni Silva** (`/orders/strutture?vista=silva`): per ogni struttura attiva il selettore
  "codice · nome · indirizzo" alimentato dalla GET, lo stato (autorizzata, proposta, manca, codice non valido, non più autorizzata) e
  il pulsante **Aggiorna destinazioni**. Schermata: `docs/screens/orders-silva-destinazioni.png`.
- **Proposta automatica** per le strutture senza destinazione: stesso CAP (+3), stessa città (+2), parole dell'indirizzo in comune
  (fino a +4, +1 se coincide il civico), parole del nome in comune (fino a +3); proposta solo sopra 4 punti e con almeno 0,75 di
  distacco dalla seconda, tra le destinazioni non ancora usate. La proposta si **conferma** riga per riga ("Conferma") o tutte insieme.
- Il codice si salva in `site_ext.silva_code` / `org_ext.silva_code` (vista `strutture_v.silva_code`). Validazione: numerico positivo,
  non già usato da un'altra struttura e, se l'elenco è stato letto, presente tra le destinazioni autorizzate. Il vecchio campo libero
  "Codice cliente Silva" è sostituito dal selettore anche nella modale Impostazioni della struttura; un codice storico non numerico non
  blocca il salvataggio degli altri campi ma l'ordine non parte finché non si sceglie la destinazione.
- **Strutture attive senza destinazione**: elenco in Ordini > Impostazioni (riquadro "Silva: trasmissione ordini") e controllo **D53**
  della Diagnostica.

## 3. Trasmissione dell'ordine approvato

### 3.1 Corpo della POST (solo i campi della guida)

```json
{
  "numero": "ORD-2026-0142",
  "urgenza": "URGENTE",
  "destinazione": { "codice": "10", "noteConsegna": "Consegna al mattino, ingresso laterale" },
  "righe": [
    { "codiceArticolo": "SLV-001", "unitaTotali": 200, "unita": "PZ" },
    { "codiceArticolo": "Slv-003", "unitaTotali": 5, "unita": "PZ" }
  ],
  "note": "Approvato da Ops",
  "motivoUrgenza": "Scorte in esaurimento",
  "dataApprovazione": "2026-11-09T08:12:44.000Z"
}
```

| Campo | Da dove viene | Regola |
|---|---|---|
| `numero` (= `X-Idempotency-Key`) | numero dell'ordine TD (`ORD-2026-0142`) | 1-64 caratteri ASCII `[A-Za-z0-9._-]`, il primo alfanumerico; verificato prima dell'invio |
| `urgenza` | ordine urgente sì/no | `URGENTE` (priorità alta) o `ORDINARIA` (priorità bassa) |
| `destinazione.codice` | destinazione Silva della struttura | numerico positivo; senza, l'ordine non parte |
| `destinazione.noteConsegna` | note per la consegna della struttura | facoltativo, troncato a 1000 caratteri |
| `righe[].codiceArticolo` | `articles.silva_code` | codice **esatto** del catalogo Silva, maiuscole comprese; senza, l'ordine non parte |
| `righe[].unitaTotali` | confezioni approvate × unità per confezione | intero da 1 a 999999 |
| `righe[].unita` | unità principale del catalogo Silva | dall'ultima riga di giacenza letta dal catalogo per quel codice, altrimenti `articles.unit` se l'articolo viene dal catalogo Silva (`source = SILVA`, non il segnaposto `n.`); altrimenti l'ordine non parte |
| `note` | note dell'Area Operations | facoltativo, troncato a 2000 caratteri con avviso nel dettaglio |
| `motivoUrgenza` | motivo dell'urgenza | facoltativo, solo con urgenza, al massimo 1000 caratteri |
| `dataApprovazione` | `approved_at` | ISO 8601 con `Z` |

Fuori dal corpo, rispetto alla proposta del 31/10: cliente, stato, tipoDestinatario, origineDestinatario, codiceSede, nome, indirizzo,
cap, città, provincia, referente, telefono, email, modalità, codiceSilva, gtin, descrizione, confezioni, confezione,
unitaPerConfezione, noteOperations. Al massimo 200 righe; una riga per articolo (due articoli TD con lo stesso codice Silva bloccano
l'invio). La POST si invia senza parametri query.

### 3.2 Controlli prima dell'invio (blocco locale)

Se qualcosa manca l'ordine **non si trasmette**, resta "dati da completare" (`silva_send_status = BLOCCATO`, motivi in
`silva_problemi`) e Ops vede nel riquadro Silva del dettaglio, per esempio: "articolo Tampone X senza codice Silva: abbinalo nel
catalogo", "struttura Punto Prelievi Prato senza destinazione Silva: sceglila in Ordini > Strutture", "articolo Busta Y: unità del
catalogo Silva non nota". Con l'automatismo attivo il job ricontrolla gli ordini bloccati ogni 5 minuti e li invia appena i dati sono
completi.

### 3.3 Risposte

| HTTP | Stato nella Suite (`silva_send_status`) | Cosa succede |
|---|---|---|
| 201 | `INVIATO` | nuovo ordine presso Silva: salvati `silva_reference` (riferimento), `silva_received_at` (ricevutoAl), `silva_sent_at`; evento "Trasmesso a Silva … nuovo ordine in preparazione · rif. …". L'invio è concluso. |
| 200 | `INVIATO` | ricevuta originale di un ordine identico già acquisito: come il 201 ("ricevuta originale"). |
| 400 | `ERRORE_DATI` | non si ritenta. `error`, `message` e `campo` in chiaro nel dettaglio, nell'evento e in un'email all'Area Operations; `campo` `righe[i].x` è tradotto con la riga e il nome dell'articolo ("riga 1 (Ago butterfly 21G, codice SLV-002): unità"). Dopo la correzione si ritrasmette a mano. |
| 400 `immutable_order` | `ERRORE_DATI` | "L'ordine è già presso Silva con dati diversi: non si può modificare, creare un nuovo ordine". Mai ritentato, nemmeno a mano. |
| 401 / 403 | `ERRORE_CHIAVE` | chiave non valida (401) o senza permesso ordini (403). Non si ritenta finché la chiave del connettore non cambia (si confronta un'impronta SHA-256 troncata della chiave, mai la chiave). |
| 413 / 415 | `ERRORE_DATI` | corpo oltre 1 MiB o tipo non JSON: errore nostro, non si ritenta. |
| 429 | `IN_CODA` | si attende `Retry-After` (secondi o data; 60 s se assente), pausa globale del limitatore, poi il job ripete la richiesta originale. |
| 503, altri 5xx, timeout (30 s), rete | `IN_CODA` | nuovo tentativo dopo 5 minuti dal job, al massimo 50 tentativi, **con lo stesso numero e lo stesso contenuto** (il corpo inviato è conservato in `silva_payload`, con le chiavi nell'ordine della guida, anche se nel frattempo i dati dell'ordine cambiano). |

Il 409 della proposta non esiste più. Colonne nuove (migrazione `orders/015_silva_ordini_v1.sql`, idempotente): `silva_received_at`,
`silva_retry_at`, `silva_error_code`, `silva_error_field`, `silva_key_fp`, `silva_problemi`, `silva_stato`, `silva_stato_at`,
`silva_stato_dal`, `silva_stato_msg`.

## 4. Stato presso Silva

`GET {base}/api/v1/ordini/{numero}/stato` per gli ordini `INVIATO` non ancora consegnati né già evasi o annullati (job ogni 30 minuti,
25 ordini per giro dal controllo più vecchio; pulsante nel dettaglio).

| Risposta | Effetto nella Suite |
|---|---|
| `IN_PREPARAZIONE` | "In preparazione presso Silva": stato interno **PRESO_IN_CARICO** (lo stesso del callback presa-in-carico), un solo evento anche se lo stato si rilegge più volte. |
| `EVASO` | DDT emesso e preparazione conclusa: stato interno **SPEDITO**, data = prima rilevazione, evento "Silva ha emesso il DDT: la consegna la conferma la struttura al carico". EVASO **non** certifica la consegna: la fase 4/5 resta alla struttura (carico) o a Ops (consegne). Dopo l'evaso l'ordine esce dal giro. |
| `ANNULLATO` | tutte le righe annullate presso Silva: difformità aperta (tipo Altro) ed email all'Area Operations; se l'ordine era APPROVATO o PRESO_IN_CARICO passa ad **ANNULLATO** con il motivo "Annullato presso Silva". |
| `NON_DISPONIBILE` | mostrato come tale nel badge, ritentato al giro successivo. |
| 404 (`presente: false`) dopo una ricevuta | `silva_stato = ASSENTE`, una sola segnalazione (evento, difformità, email). |
| 401 / 403 / 429 | il giro si interrompe; esito in Impostazioni ("Ultimo controllo dello stato"). |

Niente callback, annullamenti via API, DDT o packing list in questa versione della guida. I callback Silva → Suite esistenti
(`/api/orders/integrations/silva/orders/:numero/presa-in-carico | spedito | consegnato`, polling `GET …/silva/orders`, feed
`POST …/silva/stock`) **restano montati** con il loro JSON esteso (`orderPayloadEsteso`), se un giorno Silva li userà.

## 5. Primo invio concordato e automatismo

Impostazioni del connettore SILVA (Amministrazione > Connettori):

- **Trasmetti a Silva all'approvazione** (`push_orders`, predefinito sì). Spento: solo invio a mano.
- **Primo invio concordato con Silva già fatto** (`primo_invio_confermato`, predefinito **no**). Finché è no la trasmissione automatica
  non parte (né all'approvazione né dal job) e nel dettaglio dell'ordine Ops ha solo il pulsante **"Trasmetti a Silva (invio
  concordato)"**: la modale mostra destinazione, righe con codici, unità totali e unità, il JSON della POST e chiede la spunta "Ho
  concordato con Silva questo invio … e confermo che crea un ordine reale". Il server rifiuta l'invio manuale senza conferma.
- Al primo **201** il connettore annota `primo_invio_at`, `primo_invio_numero`, `primo_invio_riferimento` e la Suite propone
  **"Attiva la trasmissione automatica"** (nel dettaglio dell'ordine e in Ordini > Impostazioni; solo il Super amministratore del
  modulo). L'attivazione salva `primo_invio_confermato_at`: partono da soli gli ordini **approvati da quel momento**; l'arretrato resta
  "da trasmettere" con il pulsante, per non creare presso Silva ordini vecchi già gestiti in altro modo. "Sospendi la trasmissione
  automatica" torna al funzionamento a mano.

## 6. Dove si vede

- **Dettaglio ordine** (riquadro Silva, solo Area Operations; schermata `docs/screens/orders-silva-dettaglio.png`): badge, riferimento e
  ora di ricevuta, ultimo stato e controllo, errori con codice e campo, motivi del blocco con i collegamenti a Strutture e Catalogo,
  pulsanti "Trasmetti a Silva (invio concordato)" / "Trasmetti a Silva" e "Aggiorna stato da Silva", proposta di attivazione.
- **Archivio ordini** e **3 · Trasmissione al magazzino**: colonna "Silva" con *da trasmettere · in coda (ritenta alle …) · inviato
  (rif., ricevuto alle) · in preparazione · evaso (DDT) · annullato · errore dati (messaggio) · errore chiave · dati da completare*.
- **Ordini > Impostazioni**, riquadro "Silva: trasmissione ordini (API v1)": automatismo, destinazioni lette, ultimo invio, ordini da
  trasmettere / in coda / in errore / presso Silva, ultimo controllo dello stato, limitatore, strutture senza destinazione.
- **Amministrazione > Connettori > Silva**: Prova connessione (destinazioni autorizzate, poi catalogo), interruttori, primo invio,
  registro chiamate (metodo, URL, esito, numero d'ordine; mai la chiave).
- Audit del modulo: `ORDER_SILVA_PUSH`, `ORDER_SILVA_STATO`, `SILVA_AUTOMATISMO`, `SILVA_STATO_JOB`, `STRUTTURA_UPDATE`.

API interne della Suite (sessione, Area Operations): `GET /api/orders/silva/stato`, `GET /api/orders/silva/destinazioni[?refresh=1]`,
`GET /api/orders/silva/strutture` (strutture con destinazione e proposta), `POST /api/orders/silva/automatismo {attiva}`,
`POST /api/orders/silva/stato/aggiorna`, `GET /api/orders/orders/:id/silva` (anteprima del corpo e controlli),
`POST /api/orders/orders/:id/silva-push {conferma}`, `POST /api/orders/orders/:id/silva-stato`.

## 7. Messa in produzione (prima POST concordata)

1. Pubblicare la 0.68.2. **Prima** della pubblicazione conviene mettere "Trasmetti a Silva all'approvazione" su no nella 0.68.1 in
   produzione: la versione precedente, con la chiave impostata, prova a inviare ogni ordine approvato con il JSON esteso.
2. Amministrazione > Connettori > Silva: **Prova connessione** → "N destinazioni autorizzate · catalogo … letto" (403 sulle
   destinazioni = chiave senza permesso ordini: chiedere l'abilitazione a Silva).
3. Ordini > Strutture > Destinazioni Silva: **Aggiorna destinazioni**, confermare le proposte, scegliere a mano le altre; D53 a zero
   per le strutture che ordinano.
4. Verificare che gli articoli da ordinare abbiano il codice Silva (Catalogo articoli; quelli letti dal catalogo Silva lo hanno già).
5. Concordare con Silva sede, articoli e quantità del primo ordine; approvarlo; nel dettaglio **"Trasmetti a Silva (invio
   concordato)"** con la spunta. Atteso 201 con riferimento; ripetendo con lo stesso numero Silva risponderebbe 200 (la Suite non
   ripete: l'invio è concluso).
6. "Aggiorna stato da Silva": atteso IN_PREPARAZIONE (presa in carico), poi EVASO quando Silva emette il DDT.
7. **Attiva la trasmissione automatica** (dettaglio o Impostazioni). Da quel momento ogni ordine approvato parte da solo; gli ordini
   approvati prima si trasmettono a mano.

## 8. Collaudo (09/11/2026, database `suite_sv_t`, finto Silva)

Test `server/test/orders-silva-v1.test.mjs` (17 casi: corpo conforme senza campi extra, codici e unità, blocco senza codice Silva,
201 e 200 concludono, immutable_order non ritentato, 400 con campo tradotto, 429 con Retry-After, 503 con lo stesso contenuto, 401 fino
al cambio di chiave, automatismo e arretrato, stati IN_PREPARAZIONE/EVASO/ANNULLATO/NON_DISPONIBILE/404, limitatore, D53). Collaudo con
la Suite vera su database proprio e finto Silva (`/tmp/claude-0/silva_mock.cjs`): Prova connessione "4 destinazioni autorizzate ·
catalogo 2026 letto: 3 articoli"; proposte per CAP/indirizzo su 3 strutture su 4; ordine approvato con automatismo spento → nessuna
POST; invio senza conferma rifiutato; invio concordato dalla modale → 201 rif. "OC 123 (ID 456)" con il corpo della guida e
X-Idempotency-Key = numero; stato IN_PREPARAZIONE → presa in carico, EVASO → spedito; struttura senza destinazione → bloccato;
automatismo attivato → l'ordine approvato successivo parte da solo.

## Storico: proposta del 31/10 e differenze

La proposta che avevamo consegnato a Silva il 31/10/2026 (v0.35) è superata dalla guida definitiva. Differenze principali:

| Proposta 31/10 | Guida v1 definitiva (09/11) |
|---|---|
| corpo esteso: cliente, stato, tipo e origine del destinatario, destinazione con nome, indirizzo, referente, telefono, email, modalità; righe con codice TD, codiceSilva, gtin, descrizione, confezioni | solo numero, urgenza, destinazione {codice, noteConsegna}, righe {codiceArticolo, unitaTotali, unita} e i facoltativi note, motivoUrgenza, dataApprovazione |
| destinazione = codice libero della struttura (es. TD01) | codice numerico della GET destinazioni; nome e indirizzo li prende Silva |
| codiceArticolo = codice TD, codiceSilva a parte | codiceArticolo = codice esatto del catalogo Silva |
| 409 = già presente | non esiste: 200 = ricevuta originale di un ordine identico, 400 immutable_order = stesso numero con dati diversi |
| GET facoltativa `/api/v1/ordini/{numero}` | GET `/api/v1/ordini/{numero}/stato` con quattro stati e 404 |
| avanzamenti con callback Silva → Suite (presa in carico, spedito, consegnato con righe, lotti e barcode) | niente callback, annullamenti, DDT o packing list in questa versione; lo stato si legge |
| nessun limite dichiarato | 30 richieste al minuto per IP e processo, condivise con il catalogo; 429 con Retry-After |
| invio all'approvazione da subito | prima POST concordata con Silva |

Testo della proposta del 31/10, invariato:

### 1. Scopo

Toscana Diagnostica (TD) gestisce le richieste di materiale di consumo delle proprie strutture (punti prelievo, centri polidiagnostici, laboratorio di analisi) e dei clienti service nella **Suite TD**, modulo *Ordini e Magazzino*. Il flusso è in otto fasi: la struttura ordina dal catalogo (1), l'Area Operations verifica la richiesta rispetto alla produzione di laboratorio (StudioLab) e allo storico (2), l'ordine approvato viene trasmesso al magazzino (3), il magazzino consegna (4), la struttura carica il materiale ricevuto (5) e lo scarica all'uso (6), dichiara la giacenza mensile (7) e la Suite tiene la giacenza per struttura (8).

Questa specifica descrive la **fase 3**: all'approvazione dell'Area Operations la Suite trasmette l'ordine in API al gestionale Silva, nello stesso stile dell'API catalogo che Silva ha attivato il 30/10/2026 (base `https://silva.cloud/portaleordini`, header `X-API-KEY`, versione `v1`). Silva risponde con un riscontro immediato e comunica gli avanzamenti (presa in carico, spedizione, consegna) alle API della Suite già disponibili.

Il documento è destinato al team tecnico Silva per l'impostazione della risorsa sul gestionale. Il JSON dell'ordine è **identico** a quello che Silva può già leggere in polling da `GET /api/orders/integrations/silva/orders`: chi ha già impostato la lettura non deve cambiare mappature.

### 2. Riepilogo delle chiamate

| Direzione | Chiamata | Autenticazione | Scopo |
|---|---|---|---|
| TD → Silva | `POST {base}/api/v1/ordini` | chiave Silva→TD | Trasmissione dell'ordine approvato |
| TD → Silva (facoltativa) | `GET {base}/api/v1/ordini/{numero}` | chiave Silva→TD | Stato dell'ordine presso Silva |
| Silva → TD | `POST {suite}/orders/{numero}/presa-in-carico` | segreto TD→Silva | Presa in carico |
| Silva → TD | `POST {suite}/orders/{numero}/spedito` | segreto TD→Silva | Spedizione con DDT |
| Silva → TD | `POST {suite}/orders/{numero}/consegnato` | segreto TD→Silva | Consegna con righe, lotti, scadenze, codici a barre |
| Silva → TD (già attiva) | `GET {suite}/orders?stato=APPROVATO` | segreto TD→Silva | Seconda via: lettura in polling |

`{base}` = `https://silva.cloud/portaleordini` (configurabile nel connettore). `{suite}` = `https://suite.toscanadiagnostica.it/api/orders/integrations/silva`. La chiave Silva→TD è quella rilasciata da Silva a Toscana Diagnostica per l'API catalogo (header `X-API-KEY`); il segreto TD→Silva è rilasciato da Toscana Diagnostica (Amministrazione > Connettori > Silva) e viaggia nello stesso header. Tutte le date sono ISO 8601 con fuso esplicito, preferibilmente UTC con `Z` finale. Tutti i corpi sono `application/json; charset=utf-8`.

### 3. Trasmissione dell'ordine: `POST {base}/api/v1/ordini`

#### 3.1 Quando

Subito dopo che l'Area Operations approva l'ordine (stato interno `APPROVATO`). Se Silva non risponde o risponde con errore 5xx, la Suite ritenta automaticamente ogni 5 minuti finché l'ordine resta approvato (al massimo 50 tentativi); l'Area Operations può forzare un nuovo invio con "Trasmetti a Silva". Quando Silva comunica la presa in carico l'ordine esce dalla coda.

#### 3.2 Intestazioni della richiesta

| Header | Valore |
|---|---|
| `X-API-KEY` | chiave rilasciata da Silva a Toscana Diagnostica (validità 365 giorni) |
| `X-Idempotency-Key` | il numero d'ordine TD (es. `ORD-2026-0142`): la stessa richiesta ripetuta non deve creare un secondo ordine |
| `Content-Type` | `application/json; charset=utf-8` |
| `Accept` | `application/json` |

#### 3.3 Corpo della richiesta

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

#### 3.4 Campi

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

#### 3.5 Risposte attese

| Codice | Significato | Corpo |
|---|---|---|
| `201 Created` | Ordine ricevuto e registrato | `{ "numero": "ORD-2026-0142", "riferimento": "<id o numero interno Silva>", "ricevutoAl": "2026-10-31T08:12:45.1234567Z" }` |
| `200 OK` | Ordine già presente con lo stesso contenuto (ripetizione idempotente) | come sopra |
| `409 Conflict` | Ordine già presente (la Suite lo considera **ricevuto**, non errore) | `{ "error": "duplicate_order", "numero": "...", "riferimento": "..." }` |
| `400 Bad Request` | Corpo non valido (campo mancante, articolo sconosciuto, destinazione sconosciuta) | `{ "error": "<codice>", "message": "<descrizione>", "campo": "righe[1].codiceArticolo" }` |
| `401 / 403` | Chiave assente, errata, scaduta o non autorizzata al cliente | `{ "error": "unauthorized" }` |
| `5xx` | Errore del gestionale | qualunque: la Suite ritenta |

La Suite conserva `riferimento` e lo mostra all'Area Operations; Silva può usarlo o il `numero` TD nelle chiamate di avanzamento (il `numero` TD resta la chiave).

#### 3.6 Verifica facoltativa: `GET {base}/api/v1/ordini/{numero}`

Restituisce lo stato dell'ordine presso Silva: `{ "numero", "riferimento", "stato": "RICEVUTO" | "IN_PREPARAZIONE" | "SPEDITO" | "CONSEGNATO" | "ANNULLATO", "aggiornatoAl" }`. Non è necessaria al funzionamento: gli avanzamenti arrivano con le chiamate del capitolo 4.

### 4. Avanzamenti: Silva → Suite TD

Base: `https://suite.toscanadiagnostica.it/api/orders/integrations/silva`. Header `X-API-KEY` = **segreto in ingresso** che TD rilascia a Silva (diverso dalla chiave del capitolo 3; generato in Amministrazione > Connettori > Silva e comunicato per canale riservato). Risposta `200` con `{ "status": "<nuovo stato TD>" }`; `404` se il numero non esiste; `409` se lo stato non ammette l'avanzamento (es. consegnato prima della presa in carico: la Suite completa comunque i passaggi mancanti quando riceve `consegnato`).

#### 4.1 Presa in carico — `POST .../orders/{numero}/presa-in-carico`

```json
{ "riferimento": "SLV-2026-00981" }
```

Porta l'ordine TD a `PRESO_IN_CARICO` e salva il riferimento Silva.

#### 4.2 Spedizione — `POST .../orders/{numero}/spedito`

```json
{ "ddt": "DDT 2026/4471", "data": "2026-11-03T09:40:00Z" }
```

Porta l'ordine a `SPEDITO`.

#### 4.3 Consegna — `POST .../orders/{numero}/consegnato`

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

### 5. Sicurezza e regole operative

- Due chiavi distinte: la chiave Silva→TD (capitolo 3, rilasciata da Silva, validità 365 giorni) e il segreto TD→Silva (capitolo 4, rilasciato da TD). Entrambe viaggiano solo in header su HTTPS; mai in URL o nei log.
- Idempotenza sul `numero` d'ordine: ripetizioni della stessa trasmissione non devono generare doppioni.
- La Suite registra ogni chiamata (esito, tempi, messaggio) nel registro del connettore; nessun dato di pazienti transita in queste API.
- Ambienti: produzione `https://silva.cloud/portaleordini` ↔ `https://suite.toscanadiagnostica.it`. Per il collaudo Silva può indicare una base di prova; la Suite accetta base URL diverse per connettore.
- Contatti tecnici: Toscana Diagnostica, Area Operations / Suite TD (`info@toscanadiagnostica.it`).

### 6. Cosa chiediamo a Silva

1. Esporre `POST {base}/api/v1/ordini` (e, se possibile, `GET {base}/api/v1/ordini/{numero}`) con il contratto del capitolo 3, autenticato con la stessa `X-API-KEY` dell'API catalogo.
2. Richiamare gli avanzamenti del capitolo 4 sulla Suite con il segreto in ingresso TD, almeno `spedito` e `consegnato` (con righe, lotti e scadenze quando disponibili).
3. Confermare il codice cliente (`TOSCANA-DIAGNOSTICA`) e i codici di destinazione delle sedi (`destinazione.codice`): la Suite può usare i codici Silva se ci vengono comunicati, altrimenti i codici TD.
4. Indicare una base URL di collaudo e una finestra per la prova end-to-end: un ordine di prova trasmesso dalla Suite, presa in carico, spedizione e consegna dal gestionale Silva, carico in sede.

### Allegato A — Schema OpenAPI (estratto)

Il file `silva-api-ordini-v1.openapi.yaml` allegato contiene lo schema OpenAPI 3.0 delle chiamate dei capitoli 3 e 4, utilizzabile per generare la risorsa e per i test con Postman.
