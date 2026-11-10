# Integrazione Silva: come funziona nella Suite

Versione della Suite: **0.68.3** (10/11/2026: punto di consegna per le Legal entity con più sedi service e abbinamento automatico
delle destinazioni, sezioni 2 e 2 bis; prima 0.68.2 del 09/11/2026). Fonte del contratto: **Guida tecnica API ordini v1 di Silva** del 9 novembre 2026, in
`docs/silva-api-ordini/` (testo `Guida_Tecnica_v1_con_stato.txt`, PDF, `postman_collection.json`, `esempio_ordine.json`). Dove la nostra
proposta del 31/10 (sezione finale "Storico") differisce dalla guida, vale la guida.

Regola del CEO: **una volta approvato l'ordine da parte di Ops, viene trasmesso a Silva.** Silva chiede che la **prima POST sia
concordata**: per questo la trasmissione automatica parte solo dopo il primo invio fatto a mano e confermato (sezione 5).

## 1. Chiamate

| Chiamata | Quando | Esito nella Suite |
|---|---|---|
| `GET {base}/api/v1/destinazioni` | "Aggiorna destinazioni" in Ordini > Strutture, job `orders:silva-destinazioni` ogni 6 ore (0.68.3), Prova connessione del connettore, cache di 10 minuti | elenco delle sedi autorizzate da Silva, salvato anche in `orders.app_settings.silva_destinazioni`; dopo la lettura, abbinamento automatico delle coincidenze univoche (sezione 2) |
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

## 2. Destinazioni: le unità associate alle sedi Silva

Ogni **unità che riceve merce** va associata a una **destinazione Silva**: il codice numerico della GET destinazioni. Nella POST parte
**solo** `destinazione.codice`; nome e indirizzo li prende Silva dalla sua anagrafica.

**Unità da abbinare** (dalla 0.68.3, vista `orders.silva_unita_v`, migrazione `orders/016_punto_consegna.sql`):

| Tipo | Quali | Chiave (`PUT /api/orders/strutture/:id`) |
|---|---|---|
| Sede TD | sedi TD attive che ricevono merce (non i punti SERVICE; la Direzione `HEADQUARTER` solo se ha già una destinazione o degli ordini) | id della sede, `site_ext.silva_code` |
| Legal entity | Legal entity cliente attive in Ordini **senza** punti service attivi (consegna all'indirizzo della Legal entity) | `-org_id`, `org_ext.silva_code` |
| Punto service | **ogni** punto service attivo delle Legal entity cliente attive (la Legal entity con punti non si abbina: si abbinano i suoi punti) | id del punto, `site_ext.silva_code` |

Nell'elenco l'unità punto si legge "Legal entity · punto" (per esempio "Kos S.p.A. · Villa dei Pini").

**Abbinamento automatico** (senza conferma): una destinazione **coincide** con un'unità quando hanno lo stesso CAP e
- la stessa via normalizzata e lo stesso civico (minuscole, senza accenti e punteggiatura, abbreviazioni sciolte: "V.le" = "viale",
  "P.zza" = "piazza", "C.so" = "corso"; civico come ultimo numero dell'indirizzo con lettera o barra: "88/C" = "88 C" = "88c"),
  oppure
- lo stesso nome normalizzato (nome dell'unità o "Legal entity · punto" uguale al nome della destinazione).

La Suite salva `silva_code` con `silva_match = 'AUTO'` e una riga di audit `STRUTTURA_SILVA_AUTO` "abbinata automaticamente" (unità,
codice, destinazione, motivo) **solo se**: una sola destinazione coincide con l'unità, nessun'altra unità senza destinazione coincide con
la stessa destinazione e il codice non è già usato da un'altra struttura (anche disattivata). Gira dopo **"Aggiorna destinazioni"** e
dal job **`orders:silva-destinazioni` ogni 6 ore** (solo con modulo LIVE e connettore Silva attivo con la chiave; rilegge le
destinazioni e poi abbina). Una destinazione **tolta a mano** resta tolta (`silva_match = 'ESCLUSA'`): l'automatismo non la rimette.
Una scelta a mano salva `silva_match = 'MANUALE'`; le destinazioni scelte prima della 0.68.3 sono marcate MANUALE dalla migrazione.

**Ordini > Strutture > Destinazioni Silva** (`/orders/strutture?vista=silva`, schermata `docs/screens/orders-silva-destinazioni.png`):
- **Da scegliere**: unità con più destinazioni plausibili (per esempio due destinazioni allo stesso indirizzo), con una sola plausibile
  ma non coincidente (proposta per somiglianza da confermare: CAP +3, città +2, parole dell'indirizzo fino a +4 con +1 per il civico,
  parole del nome fino a +3; plausibile da 4 punti), con la coincidente già usata da un'altra unità (si vede da chi: il codice non si
  riassegna da solo) o con un codice non autorizzato.
- **Non presenti in Silva**: unità attive senza alcuna destinazione plausibile, "Silva non l'ha censita sulla nostra chiave": va chiesta
  a Silva. Una destinazione somigliante ma già usata da un'altra unità (per esempio l'altro punto della stessa Legal entity nello stesso
  CAP) non conta come plausibile.
- **Abbinate**: con la destinazione autorizzata e il modo (automatico o manuale) con data; si può cambiare o togliere.
- **Presenti in Silva, non in anagrafica**: destinazioni autorizzate da Silva che non corrispondono a nessuna unità (sede chiusa, unità da
  creare in Amministrazione o errore di censimento presso Silva).
- Validazione del codice: numerico positivo, non già usato da un'altra struttura e, se l'elenco è stato letto, presente tra le
  destinazioni autorizzate. Il punto service ha in più, in Ordini > Strutture (pulsante "consegna" accanto al punto), **solo**
  destinazione Silva, modalità e note di consegna; ogni altro campo sul punto è rifiutato (si configura la Legal entity).
- **Unità senza destinazione**: riquadro "Silva: trasmissione ordini" in Ordini > Impostazioni e controllo **D53** della Diagnostica
  ("Unità senza destinazione Silva", sulla vista `orders.silva_unita_v`: la Legal entity con punti non compare, i suoi punti sì).

## 2 bis. Punto di consegna (Legal entity cliente con più sedi service)

Richiesta del CEO del 10/11/2026: la Legal entity Kos S.p.A. ha due sedi service (Ville di Nozzano e Villa dei Pini); in Ordini si vedeva
solo Kos S.p.A. e non si poteva spedire alle due sedi. **Regola che resta** (decisione A4 dell'anagrafica unica): ordini, giacenze,
produzione e dotazione si gestiscono sulla Legal entity cliente. Cambia solo la **consegna**: l'ordine ha un punto di consegna
(`orders.delivery_site_id`, riferimento logico a `public.sites` senza chiave esterna rigida, con indice; codice `lib/punti.js`).

- **Nuovo ordine** (`/orders/catalogo`), struttura = Legal entity con punti service attivi: campo **"Consegnare a"** con i punti attivi
  (nome, indirizzo, città). Obbligatorio con 2 o più punti, preselezionato con uno solo, assente senza punti (consegna all'indirizzo
  della Legal entity, come prima). L'utente del cliente con perimetro su alcune sedi della Legal entity (sedi nell'ambito del grant)
  sceglie solo tra quelle e con una sola la trova preselezionata. Il server rifiuta l'ordine senza punto ("Indica il punto di consegna: …
  ha 2 sedi service attive"), un punto di un'altra Legal entity o fuori perimetro. Schermata `docs/screens/orders-punto-consegna.png`.
- **Cambio del punto**: l'Area Operations lo cambia fino all'approvazione e anche dopo, finché Silva non ha ricevuto l'ordine
  (`PUT /api/orders/orders/:id/punto-consegna`); la struttura solo in bozza. Dopo la ricevuta di Silva (o con un invio dall'esito incerto
  in coda) il punto è **immutabile** ("già presso Silva: il punto di consegna non si cambia più"). Evento in cronologia e audit
  `ORDER_PUNTO_CONSEGNA`; il PDF archiviato si rigenera; un ordine bloccato si ricontrolla alla trasmissione successiva.
- **Ordini esistenti** di Legal entity con più punti e senza punto: restano come sono. Nel dettaglio compare l'avviso **"Indica il punto
  di consegna"** con il selettore; l'approvazione è rifiutata finché Ops non lo indica. Con un solo punto attivo il punto si assegna
  all'approvazione (evento "unica sede service attiva"). La Dotazione di avvio crea l'ordine senza punto: si indica all'approvazione.
- **Dove si vede** "Kos S.p.A. · Villa dei Pini" (`struttura_label`): archivio ordini (con il filtro **Punto di consegna**, anche "Senza
  punto indicato"), dettaglio (riquadro "Punto di consegna" in testa alla colonna laterale, con indirizzo del punto e destinazione Silva del
  punto), PDF (Sezione A: "Ragione sociale · punto di consegna", indirizzo di consegna del punto), email (nuovo ordine, approvazione,
  consegna, carico, ordine al magazzino via email), 3 · Trasmissione al magazzino, 4 · Consegne, Carico, Cruscotto, Il mio spazio del
  Portale Service, export Excel degli ordini (colonne "Cod. punto di consegna", "Punto di consegna", "Struttura · punto").
- **Trasmissione a Silva**: `destinazione.codice` = `silva_code` del **punto** se l'ordine ne ha uno, altrimenti quello della struttura;
  `noteConsegna` = note del punto se presenti, altrimenti della Legal entity. Blocco locale con messaggio chiaro: "punto di consegna Ville di
  Nozzano (Kos S.p.A.) senza destinazione Silva: sceglila in Ordini > Strutture > Destinazioni Silva"; per un ordine senza punto di una
  Legal entity con 2 o più punti: "… ha 2 sedi service attive (…): indica il punto di consegna nel dettaglio dell'ordine". La modale
  dell'invio concordato mostra "Consegna a Kos S.p.A. · Villa dei Pini · destinazione Silva del punto 30".
- **Giacenze e carichi**: restano sulla Legal entity (nessun cambio). Alla consegna le confezioni annotano il punto dell'ordine
  (`packages.delivery_site_id`, solo informativo; evento "Consegnato al cliente … · punto di consegna Villa dei Pini"; colonna
  "Consegnato al punto (informativo)" nell'export della giacenza). **La giacenza per punto NON è gestita e resta una decisione aperta**:
  oggi la Legal entity ha un'unica giacenza, la somma di quanto consegnato ai suoi punti; il consumo e la giacenza mensile per sede
  service andrebbero decisi con il CEO (chi scarica, chi dichiara, come si ripartisce la produzione Synclab tra i punti).

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
| `destinazione.codice` | destinazione Silva del **punto di consegna** dell'ordine (0.68.3), altrimenti della struttura | numerico positivo; senza, l'ordine non parte |
| `destinazione.noteConsegna` | note per la consegna del punto, altrimenti della struttura | facoltativo, troncato a 1000 caratteri |
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
catalogo", "struttura Punto Prelievi Prato senza destinazione Silva: sceglila in Ordini > Strutture", "punto di consegna Ville di
Nozzano (Kos S.p.A.) senza destinazione Silva", "articolo Busta Y: unità del
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
- Audit del modulo: `ORDER_SILVA_PUSH`, `ORDER_SILVA_STATO`, `SILVA_AUTOMATISMO`, `SILVA_STATO_JOB`, `STRUTTURA_UPDATE` (con
  `abbinamento: manuale | tolto`), `STRUTTURA_SILVA_AUTO` (abbinata automaticamente), `SILVA_ABBINAMENTO_AUTO` (riepilogo di "Aggiorna
  destinazioni"), `ORDER_PUNTO_CONSEGNA`.

API interne della Suite (sessione, Area Operations): `GET /api/orders/silva/stato`, `GET /api/orders/silva/destinazioni[?refresh=1]`
(con `refresh=1` anche l'abbinamento automatico: `abbinate_auto`), `GET /api/orders/silva/strutture` (unità con stato ABBINATA,
DA_SCEGLIERE, NON_IN_SILVA o NON_AUTORIZZATA, candidate, proposta, modo di abbinamento, conteggi e `non_in_anagrafica`),
`GET /api/orders/orders/punti-consegna[?struttura_id=]` (punti per "Consegnare a", anche per i profili di struttura),
`PUT /api/orders/orders/:id/punto-consegna {delivery_site_id}`, `GET /api/orders/orders?delivery_site_id=<id>|nessuno`, `POST /api/orders/silva/automatismo {attiva}`,
`POST /api/orders/silva/stato/aggiorna`, `GET /api/orders/orders/:id/silva` (anteprima del corpo e controlli),
`POST /api/orders/orders/:id/silva-push {conferma}`, `POST /api/orders/orders/:id/silva-stato`.

## 7. Messa in produzione (prima POST concordata)

1. Pubblicare la 0.68.2. **Prima** della pubblicazione conviene mettere "Trasmetti a Silva all'approvazione" su no nella 0.68.1 in
   produzione: la versione precedente, con la chiave impostata, prova a inviare ogni ordine approvato con il JSON esteso.
2. Amministrazione > Connettori > Silva: **Prova connessione** → "N destinazioni autorizzate · catalogo … letto" (403 sulle
   destinazioni = chiave senza permesso ordini: chiedere l'abilitazione a Silva).
3. Ordini > Strutture > Destinazioni Silva: **Aggiorna destinazioni** (le coincidenze univoche si abbinano da sole), poi a mano il
   gruppo "Da scegliere"; chiedere a Silva le unità del gruppo "Non presenti in Silva" (per Kos: i due punti Ville di Nozzano e Villa
   dei Pini, ciascuno con la sua destinazione); D53 a zero per le unità che ordinano.
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

## 9. Collaudo 0.68.3 (10/11/2026, database `suite_pc_t`, finto Silva)

Test `server/test/orders-punto-consegna.test.mjs` (8 casi): destinazione dell'ordine dal punto (codice e note), blocco del punto senza
destinazione e della Legal entity con 2 punti senza scelta, via e civico normalizzati, classificazione (coincidenza univoca automatica,
due coincidenze = da scegliere, codice già usato non si riassegna, nessuna plausibile = non presente in Silva, CAP + nome, tolta a mano
non si rimette); con database: vista delle unità, ordine senza punto rifiutato e con punto ok, perimetro dell'utente, 1 punto
preselezionato, approvazione che chiede il punto, abbinamento automatico con audit, D53, POST con il codice del punto, immutabilità dopo
la ricevuta, confezioni con il punto alla consegna. Collaudo con la Suite vera (porta 3169) e `/tmp/claude-0/silva_mock.cjs`, dati
sintetici (Kos Collaudo S.p.A. con Villa dei Pini e Ville di Nozzano, un cliente con un solo punto, sedi TD Firenze, Prato, Bari,
Laboratorio e Direzione): Prova connessione "4 destinazioni autorizzate"; Aggiorna destinazioni → 3 abbinate automaticamente
(Laboratorio, Firenze, Villa dei Pini per CAP, via e civico), Prato da scegliere (proposta), Bari, Nozzano e il punto unico non presenti
in Silva, la destinazione 11 presente in Silva e non in anagrafica, Direzione esclusa; D53 con le 4 unità senza destinazione; ordine Kos
senza punto rifiutato, con Villa dei Pini → POST con `destinazione.codice` 30 e ricevuta 201; cambio del punto dopo la ricevuta rifiutato;
ordine per Nozzano bloccato con il messaggio del punto, punto cambiato in Villa dei Pini → trasmesso; ordine "di prima" senza punto con
l'avviso e l'approvazione rifiutata; filtro per punto, PDF, email ed Excel con "Kos Collaudo S.p.A. · Villa dei Pini"; job
`orders:silva-destinazioni` eseguito da Amministrazione > Moduli.

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
