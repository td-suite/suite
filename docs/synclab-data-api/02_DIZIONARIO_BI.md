# Data API v1 — dizionario per l'importazione e la BI

Questo documento descrive il significato dei dati pubblici. [openapi.json](openapi.json) definisce proprietà, tipi e nullabilità esatti; [esempi_sintetici.json](esempi_sintetici.json) contiene fixture interamente dimostrative.

## Regole comuni

- ID e riferimenti `*Id` sono stringhe opache. Conservarli integralmente, insieme a `instanceId` e dataset; i figli appartengono al relativo aggregato.
- `null` significa dato non disponibile, non zero o stringa vuota. Conservare anche codici e campi non riconosciuti senza attribuire significati inventati.
- Importi, quantità, aliquote e sconti sono numeri decimali: usare un tipo decimal nel consumer e nel database. Preservare la precisione, senza arrotondare indiscriminatamente i prezzi unitari a due decimali.
- `discountPercent=20` significa 20%; non moltiplicare ancora per 100.
- Date civili: `yyyy-MM-dd`, senza fuso. Timestamp `*AtLocal`: data/ora locale Europe/Rome, senza offset. `capturedAt` e scadenze di sincronizzazione: UTC ISO 8601.
- Le relazioni possono essere multiple, mancanti o temporaneamente non risolte. Non dedurle da descrizioni libere.

## Clienti e sedi: clients

| Gruppo | Proprietà principali e significato |
|---|---|
| Identità | `id`, `clientCode`, `legalName` |
| Fatturazione | `billingClientId`, dati fiscali `vatNumber`/`fiscalCode` del cliente business |
| Ambito | `operatingCompany`, `active` |
| Contatti | Indirizzo, città, provincia, CAP, telefoni, email, email fatture e NC |
| Listini | `priceListId`, `extraPriceListId` |
| Sede | `site` con descrizione, indirizzo e contatti disponibili |

`active=false` non comporta l'esclusione dall'export. La sede è quella disponibile nel record cliente. Un riferimento al listino può risultare orfano: conservarlo per riconciliazione successiva.

## Catalogo esami: exams

`id`, `examCode`, `description`, `category`, `branchCode`, `specialtyCode`, `regionalCode`, `active`.

Il catalogo comprende anche esami non più utilizzati. La descrizione è quella corrente disponibile, anche quando usata nella proiezione standard di una vecchia accettazione.

## Listini: price-lists

Testata: `id`, `code`, `description`, `type`, `state`, `active`, `operatingCompany`, `items`.

- `type`: 0 a sconto percentuale, 1 a prezzo fisso; preservare altri codici.
- `state`: 0 bozza, 5 in revisione, 10 approvato, 50 annullato.
- `active` significa non annullato; non equivale necessariamente ad approvato.
- L'export contiene tutti i listini disponibili, anche senza associazioni a clienti. Sono listini privati; i tariffari regionali non sono un dataset di questa prima versione.

| Riga listino | Significato |
|---|---|
| `id`, `examId`, `examCode`, `description` | Identità e riferimento esame |
| `grossUnitPriceExcludingVat` | Prezzo memorizzato prima dello sconto, IVA esclusa |
| `discountPercent` | Sconto in punti percentuali |
| `netUnitPriceExcludingVat` | Prezzo memorizzato dopo sconto, IVA esclusa |
| `vatCode`, `vatRate`, `vatAmount` | Null quando l'IVA applicata non è disponibile |
| `vatTreatment` | `not_available` in assenza di trattamento IVA disponibile |

Il listino corrente non ricostruisce i prezzi storici delle accettazioni. I valori applicati sono nelle relative righe.

## Accettazioni: requests

| Gruppo | Proprietà e significato |
|---|---|
| Identità | `id`, `requestNumber`, `date` |
| Cliente | `clientId`, `clientCode`, `operatingCompany` |
| Classificazione | `state`, `patientType`, `occupationalMedicine` |
| Date operative | `createdAtLocal`, `modifiedAtLocal`, `bookingAtLocal`, `reportAtLocal` |
| Economia | `sourceAmount`, importo di testata, e `headerDiscountPercent`, sconto testata separato |
| Relazioni | `invoiceIds`, cardinalità 0..N; comprende i documenti collegati disponibili |
| Contenuti | `demographics`, `items`, `samples`, eventuale `patient` opt-in |

Stati 0, 1 e 29 esclusi. Fra i codici inclusi: 10 prenotata, 11 NC mai arrivato, 15 in attesa, 18 prelievo eseguito, 20 in lavorazione, 25 in firma, 30 attende prelievo, 40 referto pronto, 50 chiuso. Non scartare altri codici inclusi dal server.

`occupationalMedicine` identifica la medicina del lavoro. Per selezionare la sola B2B occorre la regola business sui clienti/aziende da importare; non ridurla automaticamente a questo flag.

### Demografia e identità opzionale

| Proprietà | Regola |
|---|---|
| `demographics.ageYears` | Anni compiuti alla data accettazione; null con date mancanti/invalide. Non è l'età di oggi |
| `demographics.sex` | Codice sesso disponibile, senza normalizzazioni presunte |
| `demographics.city`, `province`, `postalCode` | Residenza corrente disponibile, senza promessa di fotografia storica |
| `patient` | Assente per default; presente solo se richiesto con includePatient=true |
| `patient.id`, `lastName`, `firstName`, `birthDate`, `fiscalCode` | Identificativo, cognome, nome, data di nascita e CF nella proiezione opt-in |

Per la BI standard mantenere `includePatient=false`. Il parametro seleziona la proiezione e usa lo stesso ruolo DataAPI. Checkpoint e cursori delle due proiezioni sono distinti.

### Righe esame e campioni

| Riga esame | Significato |
|---|---|
| `id`, `examId`, `examCode` | Identità e riferimento al catalogo |
| `description` | Descrizione del catalogo corrente; null se non reperibile |
| `historicalDescription` | Testo storico libero, assente salvo includePatient=true |
| `quantity` | Una riga rappresenta un esame; quantità esposta 1 |
| `grossUnitPriceExcludingVat` | Prezzo storico prima dello sconto di riga, IVA esclusa |
| `discountPercent` | Percentuale già normalizzata dal servizio |
| `netUnitPriceExcludingVat` | Prezzo storico dopo sconto riga, prima dell'eventuale sconto di testata |
| `vatCode`, `vatRate`, `vatAmount`, `vatTreatment` | Dati IVA disponibili; null/not_available non equivale a esenzione |
| `deleted`, `notPerformedCode`, `reportReady` | Stato della riga distinto dallo stato accettazione |
| `executedAtLocal`, `validatedAtLocal` | Date operative locali disponibili |
| `invoiceIds`, `sampleIds` | Riferimenti 0..N ai documenti e ai campioni |

Conservare anche le righe marcate `deleted` presenti nell'aggregato e il relativo flag. Una nuova versione dell'aggregato sostituisce l'insieme precedente dei figli.

Campioni: `id`, `barcode`, `material`, `container`, `sampleAtLocal`, `collectedAtLocal`, `checkedInAtLocal`, `preparedAtLocal`, `checkedOutAtLocal`. Non sono risultati clinici. Associare i campioni agli esami tramite sampleIds, senza inferenze dal testo.

## Documenti economici: invoices

| Campo | Significato |
|---|---|
| `id`, `invoiceNumber` | Identità opaca e numero documento; famiglie standard/manuali possono avere numeri uguali |
| `source` | `requests` oppure `manual` |
| `documentType` | `invoice`, `credit_note` oppure `unknown` |
| `sourceDocumentType` | Codice originale disponibile, da conservare |
| `cancelled`, `proforma`, `state` | Indicatori distinti dal tipo documento e dallo stato richiesta |
| `date`, `competenceFrom`, `competenceTo` | Date civili documento/competenza disponibili |
| `clientId`, `operatingCompany`, `vatRegister` | Collegamenti e ambito contabile |
| `sourceGrossTaxableAmount`, `discountPercent` | Valori sorgente, con sconto in punti percentuali |
| `netTaxableAmount` | Netto residuo documento esposto, con rettifiche/acconti applicabili |
| `vatAmount`, `stampDuty`, `pensionContribution`, `transportAmount`, `total` | Componenti e totale, preservando il segno sorgente |
| `netRevenueContribution` | Contributo al fatturato netto già normalizzato per il tipo documento |
| `requestIds`, `items` | Accettazioni collegate e righe complete |

Per il fatturato usare **netRevenueContribution una sola volta per documento**: NC negativa senza doppia inversione, documenti annullati/proforma con contributo zero, tipo sconosciuto con valore null. Non moltiplicare nuovamente per -1 leggendo `credit_note`. Non duplicare il totale di testata per ogni richiesta o riga collegata.

Le relazioni 0..N devono essere tabelle ponte. Una riga esame può riferire più fatture/rettifiche. Per le manuali il legame può esistere solo a livello di documento: l'assenza di un collegamento esatto di riga va conservata.

### Righe documento e IVA

Le righe espongono `id`, `code`, `description`, eventuali `requestId`/`requestItemId`, `parentCode`, `prescriptionId`, `quantity`, `sourceUnitPriceExcludingVat`, `sourceAmountExcludingVat`, `discountPercent`, `netAmountExcludingVat`, `vatCode`, `vatRate`, `sourceVatAmount`, `vatAmount`, `vatTreatment`, `competenceDate`.

- Per le righe standard `netAmountExcludingVat` può essere null: dettagli e riepiloghi SSN/ticket non rappresentano sempre contributi additivi. Il totale fiscale di testata è la fonte autorevole.
- Per le manuali `sourceAmountExcludingVat` e `sourceVatAmount` conservano la sorgente; `netAmountExcludingVat` e `vatAmount` sono normalizzati per le NC. Non invertire nuovamente il segno.
- `description` usa il catalogo quando il collegamento è disponibile; i testi liberi manuali sono null per default. includePatient=true abilita anche i testi storici, che possono contenere identificativi.
- L'aliquota è quella storica disponibile. Non ricalcolarla usando il catalogo fiscale o il listino corrente.
- `vatTreatment`: `not_available`, `zero_rate_or_exempt`, `taxable`. L'aliquota zero da sola non determina la natura fiscale.
- Null di quantità, aliquota o importo rimane null. Non inventare un valore unitario o un'esenzione.

## Suggerimento per il tracciato analitico

Per un dettaglio accettazioni/esami usare una riga per `(instanceId, request.id, request.items.id)`, riportando cliente, data, stato, demografia, codice/descrizione esame, quantità e prezzi applicati. Conservare separatamente sconto di riga e di testata.

Mantenere campioni, documenti e relative relazioni in strutture figlie/ponte. Espandere più invoiceIds nello stesso tracciato senza una regola di allocazione può duplicare prezzi e fatturato. Nella proiezione standard omettere le colonne identificative paziente; se richieste, valorizzarle solo dalla proiezione opt-in.
