---
capitolo: 5
titolo: Assegnazioni
intro: L'assegnazione è la pratica del paziente: prestazioni, listino, prezzi, impegnativa SSN, appuntamenti e fatture in un solo posto.
---

=== sezione
ordine: 1
slug: assegnazione-cos-e
titolo: Che cos'è un'assegnazione
percorso_gipo: /Assegnazioni/Index
parole_chiave: assegnazione, pratica, episodio, cos'è, prestazioni, listino, impegnativa, fatture, appuntamenti
sintesi: Che cos'è l'assegnazione, la pratica del paziente con prestazioni, listino, impegnativa, appuntamenti e fatture.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
In GIPO l'**assegnazione** è la "pratica" del paziente: raccoglie le prestazioni da erogare con il loro listino e i prezzi, l'eventuale impegnativa SSN, gli appuntamenti e le fatture. Quasi tutto il lavoro di accettazione e fatturazione passa da un'assegnazione.

### Cosa contiene
- **Testata**: Paziente, Dati assegnazione, Fatturare a, Inizio terapia, Fine terapia, nome dell'episodio, numero (assegnato in automatico).
- **Prestazioni**: righe con stato, impegnativa, prestazione, listino, prezzi, quota assicurazione, medici, appuntamento, fatturazione.
- **Schede** collegate: SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note, Note Interne.

### Come nasce
- Dalla Lista di lavoro, con **Accetta e assegnazione** o **Vai ad assegnazione** (vedi [Il menu Azioni](sezione:lista-menu-azioni)).
- A mano, da **Assegnazioni > Nuova assegnazione** (vedi [Nuova assegnazione](sezione:nuova-assegnazione)).

### Attenzioni
- Il numero dell'assegnazione compare nella colonna **Assegnazione** della Lista di lavoro: è il riferimento da usare quando si chiede aiuto a un collega.
- Se una prenotazione crei automaticamente l'assegnazione o se nasca all'accettazione non è stato verificato: chiedi al referente come lavora la tua sede.

=== sezione
ordine: 2
slug: nuova-assegnazione
titolo: Nuova assegnazione: testata e pulsanti
percorso_gipo: /Assegnazioni/Create
parole_chiave: nuova assegnazione, creare assegnazione, testata, fatturare a, inizio terapia, fine terapia, episodio, salva e chiudi, pulsanti
sintesi: Crea a mano una nuova pratica per un paziente.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Crea a mano una nuova pratica per un paziente.

### Dove si trova
Menu **Assegnazioni > Nuova assegnazione** (percorso /Assegnazioni/Create).

### Cosa c'è nella schermata
Testata: **Paziente**, **Dati assegnazione**, **Fatturare a**, "Inizio terapia", "Fine terapia", nome dell'episodio, numero (automatico).

Pulsanti: **Salva** (con **Salva** e **Salva e chiudi**), **Indietro**, **Modulistica**, **Informazioni**, **Prenota**, **Prenota Wizard**, **Cambio listino**, **Associa medico**, **Budget SSN**, **Referta**, **Applica nota**, **Excel**, **Preferenze**.

Schede: **Prestazioni**, **SSN**, **Appuntamenti**, **Fatture**, **Stato prestazioni**, **Assicurazione**, **Note**, **Note Interne** (vedi [Le schede dell'assegnazione](sezione:assegnazione-schede)).

### Come si fa
1. Apri **Assegnazioni > Nuova assegnazione**.
2. Scegli il **Paziente** (oppure usa la lettura della tessera sanitaria).
3. Controlla **Fatturare a**: di norma il paziente; un'azienda o un altro soggetto se paga qualcun altro (da verificare con l'amministrazione).
4. Aggiungi le prestazioni (vedi [Aggiungere prestazioni](sezione:assegnazione-prestazioni)).
5. Se la terapia dura nel tempo compila **Inizio terapia** e **Fine terapia** e dai un nome all'episodio.
6. Premi **Salva** (resti nella pratica) o **Salva e chiudi**.

### Attenzioni
- Prima di salvare controlla il listino delle righe: cambiarlo dopo richiede **Cambio listino** (vedi [Cambio listino, Associa medico, Applica nota](sezione:assegnazione-listino-medico-nota)).
- **Note Interne** è, dal nome, per il personale; **Note** potrebbe finire su stampe o documenti (da verificare): non scrivere in **Note** commenti non destinati al paziente.

=== sezione
ordine: 3
slug: assegnazione-schede
titolo: Le schede dell'assegnazione
percorso_gipo: /Assegnazioni/Index
parole_chiave: schede assegnazione, prestazioni, ssn, appuntamenti, fatture, stato prestazioni, assicurazione, note, note interne
sintesi: Panoramica delle schede dell'assegnazione (Prestazioni, SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note, Note Interne).
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Le schede dell'assegnazione mostrano le diverse facce della stessa pratica.

### Le schede
- **Prestazioni**: le righe delle prestazioni con listino, prezzi, impegnativa, medici e stato di fatturazione.
- **SSN**: i dati dell'impegnativa per le prestazioni a carico del Servizio sanitario (vedi [Impegnativa e Budget SSN](sezione:assegnazione-ssn)).
- **Appuntamenti**: gli appuntamenti collegati alle prestazioni.
- **Fatture**: le fatture emesse sulla pratica.
- **Stato prestazioni**: a che punto è ogni prestazione.
- **Assicurazione**: i dati dell'eventuale assicurazione che copre una parte dell'importo.
- **Note** e **Note Interne**.

### Come si fa
1. Apri l'assegnazione (dalla Lista di lavoro con **Vai ad assegnazione** o da **Gestione assegnazioni**).
2. Passa da una scheda all'altra secondo quello che devi controllare: pagamenti in **Fatture**, date in **Appuntamenti**, avanzamento in **Stato prestazioni**.

### Attenzioni
- Il dettaglio di ogni scheda (colonne e pulsanti di SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note Interne) è in [Assegnazione: schede SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note interne](sezione:assegnazione-schede-interne).

=== sezione
ordine: 4
slug: assegnazione-prestazioni
titolo: Aggiungere prestazioni e leggere la griglia
percorso_gipo: /Assegnazioni/Create
parole_chiave: aggiungere prestazione, prestazione listino, quantità, impegnativa, colonne, prezzo, sconto, quota assicurazione, importo paziente, iva, tot riga, fatturata
sintesi: Inserire nella pratica le prestazioni da erogare e controllarne prezzi e stato.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Inserire nella pratica le prestazioni da erogare e controllarne prezzi e stato.

### Cosa c'è nella schermata
Riga di inserimento: **Prestazione - Listino**, **Qta**, **Impegnativa**, **Aggiungi**.

Colonne della griglia: Stato, Impegnativa, Prestazione, Specialità, Listino, Prezzo, Sconto, Q.ta, Quota assicurazione, Importo ass., Importo paziente, Iva %, Tot. riga, Medici, Data/ora appuntamento, Fatturata, Nota.

### Come si fa
1. Nella scheda **Prestazioni**, nel campo **Prestazione - Listino** scrivi il codice o il nome della prestazione e scegli la voce con il listino giusto.
2. Indica la **Qta**.
3. Se la prestazione è su impegnativa SSN, indica l'**Impegnativa**.
4. Premi **Aggiungi**: la riga compare nella griglia.
5. Controlla **Prezzo**, **Sconto**, **Importo paziente** e **Tot. riga**; se c'è un'assicurazione controlla **Quota assicurazione** e **Importo ass.**.
6. Salva l'assegnazione.

### Attenzioni
- **Importo paziente** è quanto paga il paziente; con un'assicurazione una parte va in **Importo ass.**.
- La colonna **Fatturata** dice se la riga è già in una fattura: una riga fatturata non andrebbe modificata senza sistemare la fattura (da verificare il comportamento di GIPO).
- **Excel** esporta le righe; **Preferenze** contiene impostazioni della schermata non osservate.

=== sezione
ordine: 5
slug: assegnazione-pacchetti-cicli
titolo: Pacchetti e cicli terapeutici
percorso_gipo: /Assegnazioni/Create
parole_chiave: pacchetto, ciclo terapeutico, raggruppamento, split pacchetto, split quantità, terapia, sedute
sintesi: Raggruppare più prestazioni in un pacchetto o in un ciclo terapeutico (per esempio una serie di sedute), e separarle di nuovo quando serve.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Raggruppare più prestazioni in un **pacchetto** o in un **ciclo terapeutico** (per esempio una serie di sedute), e separarle di nuovo quando serve.

### Cosa c'è nella schermata
- **Raggruppamento**: Nessun raggruppamento / Pacchetto / Ciclo terapeutico.
- **Split pacchetto** e **Split quantità**.
- Nella configurazione delle prestazioni esistono **Prestazione ciclica** e **Q.ta ciclo terapeutico** (vedi [Archivio e scheda prestazione](sezione:config-prestazioni)).

### Come si fa
1. Inserisci le prestazioni nell'assegnazione.
2. Scegli il **Raggruppamento**: **Pacchetto** per un insieme di prestazioni venduto insieme, **Ciclo terapeutico** per una serie di sedute.
3. Per dividere una riga con quantità maggiore di 1 in righe singole (per esempio per prenotare le sedute in giorni diversi) usa **Split quantità**; per separare le prestazioni di un pacchetto usa **Split pacchetto**.

### Attenzioni
- Gli effetti di Split su prezzi e fatture non sono stati osservati: prova prima su un caso semplice o chiedi al referente.

=== sezione
ordine: 6
slug: assegnazione-listino-medico-nota
titolo: Cambio listino, Associa medico, Applica nota
percorso_gipo: /Assegnazioni/Create
parole_chiave: cambio listino, cambiare listino, associa medico, applica nota, prestazioni selezionate, convenzione, prezzo sbagliato
sintesi: Correggere in blocco le righe dell'assegnazione.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Correggere in blocco le righe dell'assegnazione.

### Cosa c'è
- **Cambio listino**: finestra per cambiare il listino delle prestazioni (per esempio da privato a una convenzione).
- **Associa medico**: finestra per indicare il medico che esegue le prestazioni (serve anche al calcolo dei compensi).
- **Applica nota**: finestra "Applica nota alle prestazioni selezionate".

### Come si fa
1. Seleziona le righe interessate nella griglia delle prestazioni.
2. Premi il pulsante (**Cambio listino**, **Associa medico** o **Applica nota**).
3. Nella finestra scegli il nuovo listino, il medico o scrivi la nota, e conferma.
4. Controlla i nuovi prezzi e salva.

### Attenzioni
- Il cambio listino ricalcola i prezzi (dal significato del comando): controlla **Tot. riga** dopo l'operazione.
- Se le righe sono già fatturate il cambio potrebbe non essere permesso o richiedere una nota di credito: da verificare.
- Il medico associato alle prestazioni è quello usato da **Compensi** (vedi [Calcolo compensi](sezione:compensi-calcolo)).

=== sezione
ordine: 7
slug: assegnazione-prenota-referta
titolo: Prenotare e refertare dall'assegnazione
percorso_gipo: /Assegnazioni/Create
parole_chiave: prenota, prenota wizard, referta, assegnazione, appuntamenti, informazioni, modulistica, note preparazione
sintesi: Dall'assegnazione si possono prenotare gli appuntamenti delle prestazioni e aprire il referto, senza passare dal menu.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Dall'assegnazione si possono prenotare gli appuntamenti delle prestazioni e aprire il referto, senza passare dal menu.

### Cosa c'è
- **Prenota**: prenotazione dall'agenda.
- **Prenota Wizard**: prenotazione guidata (vedi [Wizard di prenotazione](sezione:agenda-wizard)).
- **Referta**: apre il referto della prestazione.
- **Modulistica**, **Informazioni**, finestra **Note preparazione** (indicazioni di preparazione dell'esame, dal nome).

### Come si fa
1. Apri l'assegnazione e seleziona la prestazione.
2. Premi **Prenota** o **Prenota Wizard** e scegli lo spazio.
3. Controlla nella scheda **Appuntamenti** e nella colonna **Data/ora appuntamento** che la data sia registrata.
4. A prestazione eseguita, **Referta** apre il referto (vedi [Da dove si avvia un referto](sezione:referto-avvio)).

### Attenzioni
- Le **Note preparazione** vengono dalla scheda della prestazione (campo Note preparazione): se mancano, segnalalo a chi gestisce le prestazioni.

=== sezione
ordine: 8
slug: assegnazione-ssn
titolo: Impegnativa e Budget SSN nell'assegnazione
percorso_gipo: /Assegnazioni/Create
parole_chiave: impegnativa, ricetta, ssn, budget ssn, totali impegnativa, ticket, esenzione, convenzionata, servizio sanitario
sintesi: Per le prestazioni a carico del Servizio sanitario l'assegnazione collega le righe all'impegnativa (la ricetta) e tiene conto del budget SSN.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Per le prestazioni a carico del Servizio sanitario l'assegnazione collega le righe all'impegnativa (la ricetta) e tiene conto del budget SSN.

### Cosa c'è
- Colonna e campo **Impegnativa** nelle righe delle prestazioni.
- Scheda **SSN** dell'assegnazione.
- Pulsante **Budget SSN**.
- Finestra **Totali impegnativa**.

### Come si fa
1. Inserisci la prestazione indicando l'**Impegnativa** nella riga di inserimento.
2. Compila la scheda **SSN** con i dati dell'impegnativa (i campi della scheda non sono stati annotati: da verificare).
3. Apri **Totali impegnativa** per controllare gli importi (ticket, quota fissa, totale).
4. Con **Budget SSN** verifichi il budget disponibile (vedi [Configurazione SSN](sezione:config-ssn)).

### Attenzioni
- In configurazione esistono regole come il numero massimo di prestazioni per impegnativa e l'avviso per lo stesso esame sulla stessa impegnativa: se compare un avviso, leggilo prima di proseguire.
- Le impegnative si controllano e confermano poi nel **Riepilogo Asl** (vedi [Riepilogo Asl](sezione:ssn-riepilogo-asl)).

=== sezione
ordine: 9
slug: gestione-assegnazioni
titolo: Gestione assegnazioni: cercare e lavorare le pratiche
percorso_gipo: /Assegnazioni/Index
parole_chiave: gestione assegnazioni, elenco assegnazioni, lista prestazioni, filtri, fatturato, non fatturate, da fatturare, refertata, data assegnazione, centro di lavoro
sintesi: Trovare le assegnazioni e le prestazioni con filtri (per esempio quelle non ancora fatturate) e agire sulle righe.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Trovare le assegnazioni e le prestazioni con filtri (per esempio quelle non ancora fatturate) e agire sulle righe.

### Dove si trova
Menu **Assegnazioni > Gestione assegnazioni** (percorso /Assegnazioni/Index).

### Cosa c'è nella schermata
Schede: **Gestione assegnazioni** e **Lista Prestazioni**.

Filtri:
- **Data Assegnazione** (Dal / Al, **Cancella date**).
- **Fatturato**: Tutte / No / Parzialmente / Totalmente.
- **Sede**, **Medico**.
- **Altro**: Inizio Terapia, Fine Terapia, Data Appuntamento, Numero impegnativa, Data creazione odierna, Centro di lavoro, Tipo cliente fatturazione (Tutti / Persone fisiche / Aziende).

Colonne: Paziente, Prestazione, N. Assegnazione, Stato, Appuntamento, Fatturata, Listino, Prezzo, Sconto, Quantità, Totale Iva, Totale Riga, Medici, Data Appuntamento, Nota, Refertata.

Azioni di riga: **Fattura**, **Referta**, **Chiudi**, **Vai ad assegnazione**, **Vai ad appuntamento**.

### Come si fa
1. Per trovare le prestazioni da fatturare: **Fatturato** = No (o Parzialmente) e il periodo in **Data Assegnazione**.
2. Per trovare le prestazioni ancora senza referto guarda la colonna **Refertata**.
3. Per agire su una riga usa le azioni: **Fattura**, **Referta**, **Chiudi**, oppure apri la pratica con **Vai ad assegnazione**.
4. Per un controllo esterno usa **Excel**.

### Attenzioni
- **Cancella date** toglie il filtro sulle date: con molte pratiche l'elenco può diventare lungo.
- Per fatturare più assegnazioni in un'unica fattura vedi [Gruppo assegnazioni](sezione:gruppo-assegnazioni).

=== sezione
ordine: 10
slug: assegnazione-schede-interne
titolo: Assegnazione: schede SSN, Appuntamenti, Fatture, Stato prestazioni, Assicurazione, Note interne
percorso_gipo: /Assegnazioni/Index
parole_chiave: scheda ssn assegnazione, fattura tutto, fattura selezionate, conferma tutto, impegnative assegnazione, medico prescrittore, diagnosi, priorità accesso, tipo ricetta, modalità accesso, tipo accesso, posizione contabile, appuntamenti assegnazione, nuovo appuntamento, cancella selezionati, stampa selezionati, fatture assegnazione, di acconto, stato prestazioni, assicurazione, numero pratica, note interne
sintesi: Colonne e pulsanti delle schede interne dell'assegnazione: SSN (Fattura tutto, Conferma tutto, impegnative), Appuntamenti (Nuovo appuntamento, Stampa e Cancella selezionati), Fatture, Stato prestazioni, Assicurazione (Numero pratica), Note interne.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Dice cosa c'è in ogni scheda interna dell'assegnazione e cosa si fa da lì. Le schede si aprono dall'assegnazione (**Vai ad assegnazione** dalla Lista di lavoro, oppure **Gestione assegnazioni**).

### Scheda SSN
- Riepilogo in alto: **Prestazioni private**, **Prestazioni convenzionate senza impegnativa**, **Totale impegnative**, **Totale assegnazione**.
- Pulsanti: **Fattura tutto**, **Fattura selezionate**, **Conferma tutto**.
- Colonne: Conferma, Scartata, Num. Impegnativa, Data Impegnativa, Medico prescrittore, Diagnosi, Codice esenzione, Num. Prestazioni, Totale prestazioni, Ticket, Quota fissa, Totale Impegnativa, Data Prenotazione, Posizione Contabile, Priorità Accesso, Tipo Ricetta, Modalità Accesso, Tipo Accesso.

Come si usa:
1. Controlla per ogni impegnativa **Medico prescrittore**, **Codice esenzione**, **Ticket** e **Priorità Accesso** (sono i controlli della [Fase 3](sezione:fase3-impegnativa)).
2. **Conferma tutto** conferma le impegnative della pratica (lo stesso dato **Confermata** del Riepilogo Asl, da verificare).
3. **Fattura tutto** o **Fattura selezionate** prepara la fattura del ticket per le impegnative scelte.

### Scheda Appuntamenti
- Pulsanti: **Stampa selezionati**, **Nuovo appuntamento**, **Cancella selezionati**.
- Colonne: Data Inizio, Ora, Descrizione, Stato Appuntamento.

Come si usa: **Nuovo appuntamento** per fissarne uno dalla pratica; spunta gli appuntamenti e **Stampa selezionati** per dare al paziente il promemoria; **Cancella selezionati** per toglierli (attenzione: un appuntamento già fatturato va prima stornato).

### Scheda Fatture
Colonne: Num., Data, Sez., Di Acconto, CF\PIVA, Totale fattura, Totale Iva, Ritenuta d'acconto, Netto dovuto, Data pagamento, Condizione di pagamento, Origine. **Di Acconto** distingue le fatture di acconto. Per stampare o stornare una fattura vai in [Gestione fatture](sezione:gestione-fatture).

### Scheda Stato prestazioni
Colonne: **Data e ora**, **Prestazione\Prodotto**: la cronologia dei cambi di stato delle prestazioni della pratica.

### Scheda Assicurazione
Campi: **Assicurazione**, **Numero pratica**. Qui si indica l'ente e il numero della pratica dell'assicurazione (regole TD: [Fase 2: canale assicurazione](sezione:fase2-canale-assicurazione)).

### Note e Note Interne
- **Note**: le note della pratica.
- **Note Interne**: colonne **Testo**, **Utente**, **Data creazione**: note di servizio tra colleghi, con autore e data. Non scrivere dati clinici non necessari.

### Attenzioni
- Colonne e pulsanti sono quelli osservati il 13/11/2026; gli effetti di **Conferma tutto** e **Fattura tutto** sono dedotti dai nomi: da provare su una pratica di prova.
