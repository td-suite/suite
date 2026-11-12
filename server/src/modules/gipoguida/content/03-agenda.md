---
capitolo: 3
titolo: Agenda
intro: Agenda classica, wizard di prenotazione, panoramica, ricerca dello spazio libero, incroci tra agende e preferenze personali.
---

=== sezione
ordine: 1
slug: agenda-classica
titolo: Agenda classica: com'è fatta
percorso_gipo: /Agende/Classic
parole_chiave: agenda classica, calendario, agende, filtra agende, mini calendario, oggi, giorno, settimana, mese, lista, visualizzazione estesa, stampa, agende nel periodo, tipi di risorsa, prenotare
===
### A cosa serve
È la vista calendario delle agende: mostra gli appuntamenti e gli spazi liberi per giorno, settimana o mese ed è il punto da cui si prenota "a vista".

### Dove si trova
Menu **Agenda > Classica** (percorso /Agende/Classic).

### Cosa c'è nella schermata
A sinistra:
- l'elenco delle agende raggruppate per sede o risorsa, con il filtro **Filtra agende...** e **Seleziona tutto**;
- il mini calendario del mese.

Barra in alto:
- **Oggi**, le frecce per il periodo precedente e successivo;
- **Trova spazio libero** (vedi [Trova spazio libero](sezione:agenda-trova-spazio));
- **Altro**, **Agende nel periodo**, **Stampa**;
- la vista: **Giorno**, **Settimana lavorativa**, **Settimana**, **Mese**, **Lista**, **Visualizzazione estesa**.

Le risorse possono essere di questi tipi: Altro, Ambulatorio, Box, Macchina, Medico, Risorsa Generica, Stanza, Terapista.

### Come si fa
1. Nell'elenco a sinistra spunta le agende che ti servono (scrivi in **Filtra agende...** per trovarle).
2. Scegli la data dal mini calendario o con **Oggi** e le frecce.
3. Scegli la vista: **Giorno** per lo sportello, **Settimana** per pianificare, **Lista** per un elenco.
4. Per stampare il periodo visualizzato usa **Stampa**.

### Attenzioni
- Molte agende selezionate insieme rendono la vista lenta e confusa: seleziona solo quelle che servono, oppure usa [Raggruppare, incrociare e affiancare](sezione:agenda-incrocia-affianca).
- Il contenuto di **Altro** e di **Agende nel periodo** non è stato descritto in dettaglio nell'analisi.

=== sezione
ordine: 2
slug: agenda-prenotare
titolo: Prenotare un appuntamento dall'agenda classica
percorso_gipo: /Agende/Classic
parole_chiave: prenotare, prenotazione, nuovo appuntamento, fissare appuntamento, slot, spazio libero, agenda
===
### A cosa serve
Fissare un appuntamento scegliendo lo spazio direttamente sul calendario.

### Come si fa
La finestra di nuovo appuntamento **non è stata aperta** durante l'analisi: i passi seguenti sono dedotti e vanno validati.
1. Apri **Agenda > Classica** e seleziona l'agenda giusta (medico, ambulatorio o macchina).
2. Trova un orario libero sul calendario oppure usa **Trova spazio libero**.
3. Fai clic sullo spazio libero: dovrebbe aprirsi la finestra del nuovo appuntamento, dove indicare paziente, prestazione e listino (da verificare).
4. Salva e controlla che l'appuntamento compaia nell'agenda e nella **Lista di lavoro** del giorno.

In alternativa:
- il [Wizard di prenotazione](sezione:agenda-wizard), che cerca gli spazi partendo dalla prestazione;
- i pulsanti **Prenota** e **Prenota Wizard** dentro un'assegnazione (vedi [Prenotare e refertare dall'assegnazione](sezione:assegnazione-prenota-referta)).

### Attenzioni
- Per pazienti nuovi conviene creare prima l'anagrafica (vedi [Nuovo paziente](sezione:nuovo-paziente)) per evitare doppioni.
- Se lo spazio non accetta l'appuntamento, l'agenda potrebbe non essere configurata per quella prestazione (vedi [Configurazione delle agende](sezione:config-agende)).

=== sezione
ordine: 3
slug: agenda-incrocia-affianca
titolo: Raggruppare, incrociare e affiancare le agende
percorso_gipo: /Agende/Classic
parole_chiave: raggruppa agende, per risorsa, per specialità, incrocia disponibilità, incrocia tutto, affianca tutto, espandi tutto, riduci tutto, deseleziona tutto, azioni di gruppo, configurazione agenda
===
### A cosa serve
Quando servono più agende insieme (per esempio un medico e un ambulatorio, o tutti i medici di una specialità) l'agenda classica permette di raggrupparle, affiancarle o incrociarne le disponibilità.

### Cosa c'è nella schermata
- Menu **Raggruppa agende**: **Per risorsa**, **Per specialità**.
- **Incrocia disponibilità**: **Incrocia tutto**, **Affianca tutto**.
- **Azioni di gruppo**: **Espandi tutto**, **Riduci tutto**, **Deseleziona tutto**.
- **Configurazione**: **Agende e disponibilità**, **Risorse e ordinamento**, **Calendario e festivi** (portano alla configurazione, vedi il capitolo 12).

### Come si fa
1. Seleziona le agende interessate nell'elenco a sinistra.
2. Per vederle una accanto all'altra usa **Affianca tutto**.
3. Per vedere solo gli orari in cui tutte sono libere usa **Incrocia tutto** (dal nome: disponibilità comune, da verificare).
4. Con **Raggruppa agende** ordini l'elenco a sinistra per risorsa o per specialità.
5. **Deseleziona tutto** riparte da zero.

### Attenzioni
- Le voci di **Configurazione** modificano le impostazioni generali: vanno usate solo da chi amministra le agende.
- Nelle preferenze personali esiste l'opzione **Incrocia sempre disponibilità** (vedi [Preferenze personali](sezione:agenda-preferenze)).

=== sezione
ordine: 4
slug: agenda-trova-spazio
titolo: Trova spazio libero
percorso_gipo: /Agende/Classic
parole_chiave: trova spazio libero, primo posto libero, disponibilità, durata appuntamento, due settimane, un mese, tre mesi
===
### A cosa serve
Cerca il primo spazio disponibile nelle agende selezionate, senza scorrere il calendario a mano.

### Cosa c'è nella finestra
- **Periodo di riferimento**: Da qui a due settimane / Da qui a un mese / Da qui a tre mesi.
- **Durata appuntamento**.

### Come si fa
1. In **Agenda > Classica** seleziona le agende in cui cercare.
2. Premi **Trova spazio libero**.
3. Scegli il **Periodo di riferimento** e la **Durata appuntamento** adatta alla prestazione.
4. Conferma e scegli uno degli spazi proposti (come vengono mostrati i risultati non è stato osservato).

### Attenzioni
- Se la durata è più lunga dello slot dell'agenda la ricerca può non trovare nulla: prova un periodo più lungo o controlla la durata della prestazione.

=== sezione
ordine: 5
slug: agenda-wizard
titolo: Wizard di prenotazione (prenotazione guidata)
percorso_gipo: /Agende/Wizard
parole_chiave: wizard, prenotazione guidata, carrello, aggiungi al carrello, prestazione e listino, solo prestazione, qta, prezzo, sconto, durata, nota prestazione, nota appuntamento, slot disponibili
===
### A cosa serve
È una prenotazione "a carrello": si scelgono prima le prestazioni e poi GIPO mostra gli spazi disponibili sulle agende selezionate. Utile quando un paziente deve fare più prestazioni.

### Dove si trova
Menu **Agenda > Wizard** (percorso /Agende/Wizard). Dall'assegnazione: pulsante **Prenota Wizard**.

### Cosa c'è nella schermata
- Schede: **Prestazione - Listino** e **Solo prestazione**.
- Campi: **PRESTAZIONE E LISTINO** ("Digita codice o nome prestazione..."), **QTA**, **PREZZO**, **SCONTO %**, **DURATA**, **NOTA PRESTAZIONE**, **Dal** / **Al**, "Nota appuntamento...".
- Pulsanti: **Aggiungi al carrello**, **Cerca**.
- Risultato: una griglia **Ora / Agende** con gli slot disponibili sulle agende selezionate a sinistra.

### Come si fa
1. Seleziona a sinistra le agende in cui cercare.
2. Nel campo **PRESTAZIONE E LISTINO** digita codice o nome della prestazione e scegli la voce (con la scheda **Solo prestazione** si sceglie la prestazione senza listino: da verificare).
3. Controlla **QTA**, **PREZZO**, **SCONTO %** e **DURATA**; aggiungi se serve una **NOTA PRESTAZIONE**.
4. Premi **Aggiungi al carrello**; ripeti per altre prestazioni.
5. Imposta **Dal** / **Al** e premi **Cerca**.
6. Scegli lo slot nella griglia Ora / Agende e completa la prenotazione (il passaggio finale non è stato osservato: da verificare).

### Attenzioni
- Il prezzo proposto viene dal listino: cambiarlo a mano qui va fatto solo secondo le regole interne su sconti e listini.

=== sezione
ordine: 6
slug: agenda-panoramica
titolo: Panoramica agende
percorso_gipo: /agende/planner
parole_chiave: panoramica, planner, occupazione, vista d'insieme, agende
===
### A cosa serve
Dà una vista d'insieme dell'occupazione delle agende.

### Dove si trova
Menu **Agenda > Panoramica** (percorso /agende/planner).

### Attenzioni
- È una schermata nuova di GIPO e il suo contenuto **non era leggibile** durante l'analisi: come si legge e cosa permette di fare va chiesto al referente o all'assistenza Gipo.

=== sezione
ordine: 7
slug: agenda-preferenze
titolo: Preferenze personali dell'agenda
percorso_gipo: /Agende/Classic
parole_chiave: configurazione agenda, preferenze, orari visualizzati, settimana lavorativa, incrocia sempre disponibilità, scroll con trascinamento, mostra note su agende affiancate, mostra appuntamenti annullati, colora slot per prestazione
===
### A cosa serve
Il pannello **Configurazione agenda** contiene le preferenze personali di visualizzazione dell'agenda classica.

### Cosa c'è nel pannello
- **Orari visualizzati**.
- **Settimana lavorativa**: giorno di inizio e di fine.
- **Interfaccia**, con le opzioni:
  - **Incrocia sempre disponibilità**
  - **Scroll con trascinamento**
  - **Mostra note su agende affiancate**
  - **Mostra appuntamenti annullati**
  - **Colora slot per prestazione**

### Come si fa
1. In **Agenda > Classica** apri il pannello **Configurazione agenda**.
2. Imposta gli orari che vuoi vedere (per esempio solo l'orario di apertura della tua sede).
3. Attiva le opzioni utili: per esempio **Mostra appuntamenti annullati** quando devi ricontrollare le disdette.

### Attenzioni
- Queste preferenze sono personali: non vanno confuse con **Configurazione > Agende > Calendario**, che vale per tutti (vedi [Calendario, risorse e centri di lavoro](sezione:config-calendario-risorse)).
- Dove si apre esattamente il pannello (pulsante o menu) non è stato annotato nell'analisi.

=== sezione
ordine: 8
slug: agenda-cerca-prenotati-tessera
titolo: Cerca prenotati e lettura della tessera sanitaria
percorso_gipo: /Agende/Classic
parole_chiave: cerca prenotati, cercare appuntamento paziente, tessera sanitaria, lettore, strisciare la tessera, codice fiscale
===
### A cosa serve
- **Cerca prenotati** trova gli appuntamenti di un paziente.
- La lettura della **tessera sanitaria** riempie i dati del paziente senza digitarli.

### Cosa c'è
- Finestra **Cerca prenotati**.
- Finestra "Strisciare la tessera sanitaria nel lettore...": compare quando si avvia la lettura della tessera.

### Come si fa
1. Per trovare gli appuntamenti di un paziente apri **Cerca prenotati** e cerca il paziente (i campi di ricerca non sono stati annotati).
2. Per leggere la tessera avvia la lettura e, quando compare il messaggio "Strisciare la tessera sanitaria nel lettore...", passa la tessera nel lettore collegato al PC.

### Attenzioni
- Serve un lettore di tessere collegato e funzionante sul PC della postazione.
- La stessa lettura è disponibile in **Nuovo paziente** e in **Nuova assegnazione** (vedi [Lettura della tessera sanitaria](sezione:paziente-tessera-sanitaria)).
