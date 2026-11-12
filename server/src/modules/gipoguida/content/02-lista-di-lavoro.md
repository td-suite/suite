---
capitolo: 2
titolo: Lista di lavoro e giornata tipo dell'accettazione
intro: La pagina iniziale di GIPO: appuntamenti del giorno, filtri, stati e il menu Azioni di ogni riga.
---

=== sezione
ordine: 1
slug: lista-di-lavoro
titolo: La Lista di lavoro: filtri, schede e colonne
percorso_gipo: /Home
parole_chiave: lista di lavoro, home, appuntamenti del giorno, filtri, periodo, mattina, pomeriggio, stato, confermati, disdetti, richiami, semplificata, standard
===
### A cosa serve
È la pagina iniziale di GIPO e il punto di lavoro dell'accettazione: mostra gli appuntamenti del periodo scelto e da ogni riga permette di accettare, fatturare, avviare la visita, refertare e chiudere.

### Dove si trova
Menu **Lista di Lavoro** (percorso /Home). Si apre anche da sola dopo l'accesso.

### Cosa c'è nella schermata
Filtri:
- **Periodo** (Dal / Al) e **Orario**, con le scorciatoie **Mattina**, **Pomeriggio**, **Tutto il giorno**.
- **Sede**, **Agende**, **Medici**.
- **Stato**: Tutte / Aperte / Chiuse.
- **Stato Appuntamento**: Confermati e non confermati / Solo confermati / Solo disdetti.

Schede: **Standard**, **Semplificata**, **Richiami**.

Colonne: Data, Ora, Stato (per esempio "Prenotata"), Stato appuntamento (Confermato / Non confermato), Paziente, Prestazione, Listino, Medici, Assegnazione (numero), Fattura, Agende, Nota. In alto il comando **Excel**.

Su ogni riga il pulsante **Azioni** (vedi [Il menu Azioni](sezione:lista-menu-azioni)).

### Come si fa
1. Imposta **Periodo** sulla data di oggi e scegli **Mattina** o **Pomeriggio** se lavori su un turno.
2. Scegli la tua **Sede** (e se serve le **Agende** o i **Medici**).
3. Con **Stato** su "Aperte" vedi solo gli appuntamenti ancora da completare.
4. Usa **Stato Appuntamento** per separare confermati, non confermati e disdetti.

### Attenzioni
- Le colonne **Assegnazione** e **Fattura** mostrano il numero quando esistono: una riga senza numero di assegnazione con ogni probabilità non è ancora stata accettata (da verificare).
- Il contenuto preciso delle schede **Semplificata** e **Richiami** non è stato osservato: vedi [Richiami e vista semplificata](sezione:lista-richiami).

=== sezione
ordine: 2
slug: lista-menu-azioni
titolo: Il menu Azioni: ogni voce spiegata
percorso_gipo: /Home
parole_chiave: azioni, accetta, accetta e assegnazione, accetta e fattura, fattura, inizia visita, inizia visita sportiva, inizia visita e referta, termina visita, referta, chiudi, vai ad assegnazione, vai ad appuntamento, conferma appuntamento, reset conferma, annulla appuntamento
===
### A cosa serve
Il pulsante **Azioni** su ogni riga della Lista di lavoro raccoglie tutte le operazioni sull'appuntamento. Qui sotto ogni voce con il suo significato, ricavato dal nome: gli effetti esatti vanno validati.

### Le voci
- **Accetta**: registra l'arrivo del paziente per quell'appuntamento.
- **Accetta e assegnazione**: accetta e apre l'assegnazione collegata (la "pratica" con prestazioni, listino, impegnativa, fatture), per controllarla o completarla.
- **Accetta e fattura**: accetta e passa subito alla fattura della prestazione; è la scelta naturale quando il paziente paga allo sportello.
- **Fattura**: crea la fattura per un appuntamento già accettato.
- **Inizia visita**: segna l'inizio della prestazione.
- **Inizia visita sportiva**: come sopra, per le visite di medicina dello sport (vedi [Nuova visita sportiva](sezione:sport-nuova-visita)).
- **Inizia visita e referta**: avvia la visita e apre il referto in un solo passaggio.
- **Termina visita**: segna la fine della prestazione.
- **Referta**: apre il referto della prestazione (vedi [Da dove si avvia un referto](sezione:referto-avvio)).
- **Chiudi**: chiude la riga (lo Stato passa tra le "Chiuse").
- **Vai ad assegnazione**: apre l'assegnazione collegata.
- **Vai ad appuntamento**: apre l'appuntamento in agenda.
- **Conferma appuntamento**: segna che il paziente ha confermato.
- **Reset conferma**: toglie la conferma.
- **Annulla appuntamento**: disdice l'appuntamento.

### Come si fa
1. Trova la riga del paziente (filtri e colonna Ora).
2. Premi **Azioni** sulla riga.
3. Scegli la voce corrispondente al momento del percorso: arrivo (Accetta), pagamento (Accetta e fattura o Fattura), prestazione (Inizia / Termina visita), referto (Referta), fine (Chiudi).

### Attenzioni
- Alcune voci possono comparire solo in certi stati (per esempio Termina visita dopo Inizia visita): l'elenco sopra è quello completo osservato, la disponibilità voce per voce non è stata verificata.
- **Annulla appuntamento** e **Chiudi** non vanno usati per correggere un errore di fatturazione: per stornare una fattura serve una nota di credito (vedi [Nota di credito](sezione:nota-di-credito)).

=== sezione
ordine: 3
slug: giornata-tipo-accettazione
titolo: La giornata tipo dell'accettazione
percorso_gipo: /Home
parole_chiave: giornata tipo, accettazione, arrivo paziente, sportello, flusso, procedura, apertura, chiusura giornata, cassa
===
### A cosa serve
Mette in fila le operazioni di una giornata allo sportello, collegando le sezioni della guida. È una traccia: l'ordine esatto e le regole interne vanno confermati dal referente.

### Come si fa
1. **Apertura**: apri la **Lista di lavoro**, imposta Periodo su oggi, la tua Sede e (se serve) Mattina o Pomeriggio.
2. **Controllo delle conferme**: con **Stato Appuntamento** verifica i non confermati; per chi conferma usa **Azioni > Conferma appuntamento**, per chi disdice **Azioni > Annulla appuntamento**.
3. **Arrivo del paziente**: cerca la riga, verifica i dati anagrafici (se necessario apri il paziente, vedi [Archivio pazienti](sezione:archivio-pazienti)) e usa **Azioni > Accetta**, oppure **Accetta e fattura** se il paziente paga subito.
4. **Paziente senza appuntamento**: prenotalo dall'agenda (vedi [Prenotare un appuntamento](sezione:agenda-prenotare)) o dal wizard, poi accettalo dalla Lista di lavoro.
5. **Impegnativa SSN**: controlla nell'assegnazione la scheda SSN (vedi [Impegnativa e Budget SSN](sezione:assegnazione-ssn)).
6. **Pagamento**: completa la fattura con metodo e condizione di pagamento (vedi [Nuova fattura](sezione:nuova-fattura)).
7. **Firme e consensi**: raccogli i consensi e la modulistica (vedi [Consensi e privacy](sezione:paziente-consensi)).
8. **Durante la giornata**: il personale sanitario usa **Inizia visita**, **Termina visita** e **Referta**.
9. **Fine giornata**: controlla con **Stato** su "Aperte" cosa resta, poi esegui la chiusura di cassa (vedi [Gestione cassa e chiusura di giornata](sezione:gestione-cassa)).

### Attenzioni
- Le regole interne su chi incassa, chi chiude e chi stampa la chiusura di cassa sono decise dalla direzione: questa guida descrive solo dove si trovano le funzioni.

=== sezione
ordine: 4
slug: lista-richiami
titolo: Richiami e vista semplificata
percorso_gipo: /Home
parole_chiave: richiami, semplificata, standard, schede, lista di lavoro, richiamare
===
### A cosa serve
La Lista di lavoro ha tre schede: **Standard**, **Semplificata** e **Richiami**.

### Cosa si sa
- **Standard** è la vista completa con tutte le colonne descritte in [La Lista di lavoro](sezione:lista-di-lavoro).
- **Semplificata** è, dal nome, una vista ridotta.
- **Richiami** è, dal nome, l'elenco dei pazienti da richiamare.

### Attenzioni
- Il contenuto di **Semplificata** e **Richiami** **non è stato osservato** durante l'analisi: come si genera un richiamo e cosa mostra la scheda va chiesto al referente o all'assistenza Gipo. La redazione completerà questa sezione.

=== sezione
ordine: 5
slug: conferme-e-disdette
titolo: Conferme, disdette e annullamenti
percorso_gipo: /Home
parole_chiave: conferma appuntamento, reset conferma, annulla appuntamento, disdetta, disdire, annullare, cancellare appuntamento, solo disdetti, non confermato
===
### A cosa serve
Gestire lo stato di conferma degli appuntamenti e le disdette dalla Lista di lavoro.

### Cosa c'è nella schermata
- Colonna **Stato appuntamento**: Confermato / Non confermato.
- Filtro **Stato Appuntamento**: Confermati e non confermati / Solo confermati / Solo disdetti.
- Nel menu **Azioni**: **Conferma appuntamento**, **Reset conferma**, **Annulla appuntamento**.
- In agenda, nelle preferenze personali, l'opzione **Mostra appuntamenti annullati** (vedi [Preferenze personali dell'agenda](sezione:agenda-preferenze)).

### Come si fa
1. Per confermare: **Azioni > Conferma appuntamento** sulla riga.
2. Per togliere una conferma messa per errore: **Azioni > Reset conferma**.
3. Per una disdetta: **Azioni > Annulla appuntamento**. L'appuntamento dovrebbe poi comparire con il filtro **Solo disdetti** (da verificare).
4. Per spostare un appuntamento la guida non ha osservato una voce dedicata: con ogni probabilità si apre l'appuntamento (**Azioni > Vai ad appuntamento**) e si modifica in agenda. Da verificare con il referente.

### Attenzioni
- Se è richiesto un motivo dell'annullamento e se il paziente riceve un avviso non è stato osservato.
- Un appuntamento già fatturato non va semplicemente annullato: prima va sistemata la fattura (vedi [Nota di credito](sezione:nota-di-credito)).
